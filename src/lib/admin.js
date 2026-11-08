// AI指南 — 后台公共（v5，第三期）
// 站长锁死 QQ 446099815 + qq446099815@gmail.com；别人先注册也进不了后台。
// 站长会话 7 天，普通用户 8 小时（会话时长在登录时按账号决定）。
import { getSessionUser, isAdminAccount } from './auth.js';

export async function requireAdmin(c) {
  if (!c.env.DB) return { res: c.json({ ok: false, error: '数据库未就绪' }, 503), admin: null };
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) return { res: c.json({ ok: false, error: '请先登录', loginRequired: true }, 401), admin: null };
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  if (!user || !user.is_admin || !isAdminAccount(user)) {
    return { res: c.json({ ok: false, error: '只有站长能进后台' }, 403), admin: null };
  }
  return { res: null, admin: user };
}

// 页面用：未登录/非站长直接返回文字页（不暴露后台结构）
export async function requireAdminPage(c) {
  const { res, admin } = await requireAdmin(c);
  if (res) {
    const status = res.status || 403;
    return { admin: null, errorPage: { status, body: status === 401 ? '请先登录。' : '只有站长能进后台（锁死 QQ 446099815 + qq446099815@gmail.com）。' } };
  }
  return { admin, errorPage: null };
}

export async function getSetting(db, key, fallback = '') {
  if (!db) return fallback;
  const row = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind(key).first();
  return row?.value ?? fallback;
}

export async function setSetting(db, key, value) {
  await db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").bind(key, String(value)).run();
}

export function slugify(text, fallback = 'article') {
  const s = String(text || '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || `${fallback}-${Date.now().toString(36)}`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
