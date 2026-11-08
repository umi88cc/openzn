// AI指南 — 登录注册 API（v5，第二期实现）
// 注册字段：账号、密码（6 位以上）、确认密码、QQ 号、邮箱、邮箱验证码；
// 注册成功后直接登录到个人中心。邮箱、QQ 都唯一。
// 登录两种方式：账号或邮箱 + 密码；或邮箱 + 验证码登录。
// 忘记密码：邮箱验证码重置。登录时效 8 小时；站长后台 7 天。
// 发信走 Resend（HTTP）；未配 RESEND_API_KEY 时本地调试返回 devMode 验证码（见 mail.js）。
import { Hono } from 'hono';
import { pageHTML } from '../lib/render.js';
import {
  ADMIN_QQ, ADMIN_EMAIL, hashPasswordWithSalt, verifyPassword,
  getSessionUser, createSession, destroySession, sessionTokenFromRequest,
  sessionCookie, clearSessionCookie, refreshAvatar, publicUser, qqAvatarUrl, currentUser,
} from '../lib/auth.js';
import { createCode, verifyCode, sendVerificationEmail, sendCountInLastHour } from '../lib/mail.js';
import { getAISettings, sendFeishu } from '../lib/ai.js';
import { SITE } from '../lib/config.js';

export const authRoutes = new Hono();

function needDb(c) {
  if (!c.env.DB) return c.json({ ok: false, error: '数据库未就绪（本地请先建 D1）' }, 503);
  return null;
}

function isHttps(c) {
  return new URL(c.req.url).protocol === 'https:';
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || ''));
}

async function issueSession(c, user) {
  const { token, maxAge } = await createSession(c.env.DB, user);
  const refreshed = await refreshAvatar(c.env.DB, user);
  const res = c.json({ ok: true, user: publicUser(refreshed) });
  res.headers.set('Set-Cookie', sessionCookie(token, maxAge, isHttps(c)));
  return res;
}

authRoutes.get('/forgot', async (c) => {
  const user = await currentUser(c);
  const body = `<h1>忘记密码</h1>
  <p class="muted">用邮箱验证码重置密码：先填注册邮箱发验证码，再设新密码（6 位以上）。</p>
  <form class="auth-form auth-login" id="resetForm" style="max-width:420px">
    <input name="email" type="email" placeholder="注册邮箱" required>
    <div class="code-row"><input name="code" placeholder="邮箱验证码" required><button type="button" data-send-code data-purpose="reset_password">发送验证码</button></div>
    <input name="password" type="password" placeholder="新密码（6 位以上）" minlength="6" required>
    <button type="submit">重置密码</button>
  </form>
  <script src="/js/auth.js" defer></script>`;
  return c.html(pageHTML({ title: '忘记密码', active: '/', bottomActive: 'me', body, user }));
});

// 当前登录用户（前端用它判断右上角显示 QQ 头像还是弹登录框）
authRoutes.get('/api/auth/me', async (c) => {
  const err = needDb(c);
  if (err) return err;
  const user = await getSessionUser(c.env.DB, c.req.raw);
  if (!user) return c.json({ ok: true, user: null });
  const full = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.user_id).first();
  return c.json({ ok: true, user: publicUser(full) });
});

// 发送验证码：register / login / reset_password；限流每邮箱、每 IP 每小时 5 次
authRoutes.post('/api/auth/send-code', async (c) => {
  const err = needDb(c);
  if (err) return err;
  const { email, purpose } = await c.req.json().catch(() => ({}));
  if (!validEmail(email)) return c.json({ ok: false, error: '邮箱格式不对' }, 400);
  if (!['register', 'login', 'reset_password'].includes(purpose)) {
    return c.json({ ok: false, error: '验证码用途不对' }, 400);
  }
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const { byEmail, byIp } = await sendCountInLastHour(c.env.DB, { email, ip });
  if (byEmail >= 5 || byIp >= 5) {
    return c.json({ ok: false, error: '发送太频繁了，请 1 小时后再试' }, 429);
  }
  // 注册用的邮箱必须还没被注册；登录/重置用的邮箱必须已注册
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (purpose === 'register' && exists) return c.json({ ok: false, error: '这个邮箱已经注册过了，直接登录吧' }, 400);
  if (purpose !== 'register' && !exists) return c.json({ ok: false, error: '这个邮箱还没注册，请先注册' }, 400);
  const code = await createCode(c.env.DB, { email, purpose, ip });
  const sent = await sendVerificationEmail(c.env, { email, code, purpose });
  if (!sent.ok) return c.json({ ok: false, error: sent.error }, 502);
  // 未配 Resend 时本地调试才返回验证码；配了密钥后绝不返回
  return c.json({ ok: true, devMode: !!sent.devMode, ...(sent.devMode ? { code } : {}) });
});

authRoutes.post('/api/auth/register', async (c) => {
  const err = needDb(c);
  if (err) return err;
  const { username, password, password2, qq, email, code } = await c.req.json().catch(() => ({}));
  const name = String(username || '').trim();
  if (!name || name.length < 2 || name.length > 20) return c.json({ ok: false, error: '账号 2~20 个字' }, 400);
  if (!password || password.length < 6) return c.json({ ok: false, error: '密码要 6 位以上' }, 400);
  if (password !== password2) return c.json({ ok: false, error: '两次密码不一致' }, 400);
  if (!/^\d{5,12}$/.test(String(qq || ''))) return c.json({ ok: false, error: 'QQ 号格式不对（5~12 位数字）' }, 400);
  if (!validEmail(email)) return c.json({ ok: false, error: '邮箱格式不对' }, 400);
  if (!code) return c.json({ ok: false, error: '请先填邮箱验证码' }, 400);
  const v = await verifyCode(c.env.DB, { email, code: String(code).trim(), purpose: 'register' });
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  // 邮箱、QQ、账号都唯一
  const dup = await c.env.DB.prepare(
    'SELECT username, email, qq FROM users WHERE username=? OR email=? OR qq=? LIMIT 1'
  ).bind(name, email, String(qq)).first();
  if (dup) {
    if (dup.email === email) return c.json({ ok: false, error: '这个邮箱已经注册过了' }, 400);
    if (dup.qq === String(qq)) return c.json({ ok: false, error: '这个 QQ 号已经绑过一个账号了' }, 400);
    return c.json({ ok: false, error: '这个账号名已经被用了' }, 400);
  }
  const isAdmin = String(qq) === ADMIN_QQ && email === ADMIN_EMAIL;
  const passwordHash = await hashPasswordWithSalt(password);
  const avatarUrl = qqAvatarUrl(String(qq), 100);
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO users (username, email, qq, password_hash, avatar_url, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(name, email, String(qq), passwordHash, avatarUrl, isAdmin ? 1 : 0).run();
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(meta.last_row_id).first();
  // 第四期：新用户注册提醒开关开着时推一条飞书（只写用户名和 QQ，不推密码）。
  // 不阻塞注册返回；失败也不影响注册。
  try {
    const settings = await getAISettings(c.env.DB);
    if (settings.ai_register_notify) {
      const p = sendFeishu(c.env.DB, c.env, {
        title: '👤 新用户注册',
        content: `新用户注册：${user.username}（QQ ${user.qq}），注册时间 ${user.created_at}。`,
        link: `${SITE.url}/admin/users/${user.id}`,
      }).catch(() => {});
      if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(p);
    }
  } catch { /* 忽略 */ }
  return issueSession(c, user);
});

authRoutes.post('/api/auth/login', async (c) => {
  const err = needDb(c);
  if (err) return err;
  const { account, password } = await c.req.json().catch(() => ({}));
  if (!account || !password) return c.json({ ok: false, error: '请填账号和密码' }, 400);
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE username=? OR email=? LIMIT 1'
  ).bind(String(account).trim(), String(account).trim()).first();
  if (!user) return c.json({ ok: false, error: '账号或密码不对' }, 401);
  if (user.is_banned) return c.json({ ok: false, error: '这个账号已被封禁，请联系站长' }, 403);
  if (!(await verifyPassword(password, user.password_hash))) {
    return c.json({ ok: false, error: '账号或密码不对' }, 401);
  }
  return issueSession(c, user);
});

authRoutes.post('/api/auth/login-code', async (c) => {
  const err = needDb(c);
  if (err) return err;
  const { email, code } = await c.req.json().catch(() => ({}));
  if (!validEmail(email) || !code) return c.json({ ok: false, error: '请填邮箱和验证码' }, 400);
  const v = await verifyCode(c.env.DB, { email, code: String(code).trim(), purpose: 'login' });
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (!user) return c.json({ ok: false, error: '这个邮箱还没注册' }, 400);
  if (user.is_banned) return c.json({ ok: false, error: '这个账号已被封禁，请联系站长' }, 403);
  return issueSession(c, user);
});

authRoutes.post('/api/auth/reset-password', async (c) => {
  const err = needDb(c);
  if (err) return err;
  const { email, code, password } = await c.req.json().catch(() => ({}));
  if (!validEmail(email) || !code) return c.json({ ok: false, error: '请填邮箱和验证码' }, 400);
  if (!password || password.length < 6) return c.json({ ok: false, error: '新密码要 6 位以上' }, 400);
  const v = await verifyCode(c.env.DB, { email, code: String(code).trim(), purpose: 'reset_password' });
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (!user) return c.json({ ok: false, error: '这个邮箱还没注册' }, 400);
  const passwordHash = await hashPasswordWithSalt(password);
  await c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(passwordHash, user.id).run();
  // 改密码后旧会话全部失效，需重新登录
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
  return c.json({ ok: true, message: '密码已重置，请用新密码登录' });
});

authRoutes.post('/api/auth/logout', async (c) => {
  const token = sessionTokenFromRequest(c.req.raw);
  if (c.env.DB && token) await destroySession(c.env.DB, token);
  const res = c.json({ ok: true });
  res.headers.set('Set-Cookie', clearSessionCookie());
  return res;
});
