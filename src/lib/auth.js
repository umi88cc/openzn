// AI指南 — 登录 / 会话（v5 定稿，骨架）
// 普通用户登录时效 8 小时；站长后台 7 天（同设备、手机不关机条件下）。
// 站长锁死 QQ 446099815 + 邮箱 qq446099815@gmail.com，别人的账号就算先注册也进不了后台。
// 头像：只存 QQ 头像链接，登录时自动拉取最新 QQ 头像更新。
// 密码只存哈希（SHA-256 + 盐，第一期骨架用 WebCrypto；上线前换 bcrypt/argon2 亦可，
// 哈希格式以 password_hash 字段为准，不存明文）。
export const ADMIN_QQ = '446099815';
export const ADMIN_EMAIL = 'qq446099815@gmail.com';
export const USER_SESSION_HOURS = 8;
export const ADMIN_SESSION_DAYS = 7;

export function qqAvatarUrl(qq, spec = 100) {
  return `https://qlogo.cn/headimg_dl?dst_uin=${encodeURIComponent(qq)}&spec=${spec}`;
}

export function isAdminAccount(user) {
  return user && user.qq === ADMIN_QQ && user.email === ADMIN_EMAIL;
}

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 密码存为 salt$hash；无 $ 的旧格式按无盐兼容（种子里没有用户，实际不会走到）
export function newSalt() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPasswordWithSalt(password) {
  const salt = newSalt();
  return `${salt}$${await hashPassword(password, salt)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const idx = stored.indexOf('$');
  if (idx === -1) return (await hashPassword(password, '')) === stored;
  const salt = stored.slice(0, idx);
  const hash = stored.slice(idx + 1);
  return (await hashPassword(password, salt)) === hash;
}

export function newToken() {
  return crypto.randomUUID();
}

// 建会话：普通用户 8 小时；站长账号 7 天（is_admin_session=1）
export async function createSession(db, user) {
  const token = newToken();
  const isAdmin = isAdminAccount(user);
  const hours = isAdmin ? ADMIN_SESSION_DAYS * 24 : USER_SESSION_HOURS;
  const maxAge = hours * 3600;
  await db.prepare(
    "INSERT INTO sessions (id, user_id, is_admin_session, expires_at) VALUES (?, ?, ?, datetime('now', ?))"
  ).bind(token, user.id, isAdmin ? 1 : 0, `+${hours} hours`).run();
  return { token, maxAge, isAdmin };
}

export async function destroySession(db, token) {
  if (!db || !token) return;
  await db.prepare('DELETE FROM sessions WHERE id=?').bind(token).run();
}

export function sessionTokenFromRequest(request) {
  const cookie = request.headers.get('Cookie') || '';
  return cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('ozn_session='))?.slice('ozn_session='.length) || null;
}

// 从请求 Cookie 取会话；第一期只做解析与过期判断，登录写逻辑在第二期接 /api/auth/*
export async function getSessionUser(db, request) {
  if (!db) return null;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith('ozn_session='))?.slice('ozn_session='.length);
  if (!token) return null;
  const session = await db.prepare(
    `SELECT s.*, u.id AS user_id, u.username, u.email, u.qq, u.avatar_url, u.is_admin, u.is_banned
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  if (!session || session.is_banned) return null;
  return session;
}

export function sessionCookie(token, maxAgeSeconds, isHttps = false) {
  // 本地 http://localhost 调试时 Secure 会导致浏览器丢弃 Cookie，只在 https 下加 Secure
  return `ozn_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isHttps ? '; Secure' : ''}`;
}

export function clearSessionCookie() {
  return 'ozn_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

// 登录后刷新 QQ 头像（只存 qlogo.cn 链接，不存图片本地；QQ 上换头像后登录即跟着换）
export async function refreshAvatar(db, user) {
  if (!db || !user?.qq) return user;
  const url = qqAvatarUrl(user.qq, 100);
  if (user.avatar_url !== url) {
    await db.prepare('UPDATE users SET avatar_url=?, last_login_at=datetime(\'now\') WHERE id=?').bind(url, user.id).run();
    return { ...user, avatar_url: url };
  }
  await db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").bind(user.id).run();
  return user;
}

// 公共字段：绝不把 password_hash、邮箱以外的隐私字段返回给前端
// 当前登录用户（公开字段，供各路由传给页眉显示 QQ 头像；未登录返回 null）
export async function currentUser(c) {
  if (!c.env.DB) return null;
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) return null;
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  return user ? publicUser(user) : null;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id, username: user.username, email: user.email, qq: user.qq,
    avatar_url: user.avatar_url, gender: user.gender, signature: user.signature,
    balance_cents: user.balance_cents, points: user.points,
    is_admin: !!user.is_admin, created_at: user.created_at,
    show_on_points_board: !!user.show_on_points_board,
    show_on_balance_board: !!user.show_on_balance_board,
  };
}
