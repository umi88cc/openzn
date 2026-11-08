// AI指南 — 后台 API（v5，第三期）
// 7 大分类的写操作全部走这里；前后台共用一个 D1，写完前端同步。
// 通过订单审核时自动开通会员 / 加余额，不分两步手动做。
import { Hono} from 'hono';
import { requireAdmin, getSetting, setSetting, slugify} from '../lib/admin.js';
import { hashPasswordWithSalt} from '../lib/auth.js';
import { grantOrder, getOrder, notifyUser, expiryReminderScan, logAudit} from '../lib/orders.js';
import { sendEmail} from '../lib/mail.js';
import { SITE} from '../lib/config.js';
import { callAI, getAISettings, setAISetting, encryptKey, maskKey, sendFeishu, dailyDigest, polishArticle, pendingOrderRemind, AI_SWITCHES } from '../lib/ai.js';

export const adminApiRoutes = new Hono();

async function adminOnly(c) {
const { res, admin} = await requireAdmin(c);
return { res, admin};
}
const body = async (c) => c.req.json().catch(() => ({}));

// ---------- 基本设置 ----------
adminApiRoutes.post('/api/admin/settings', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const allowed = ['site_name', 'site_domain', 'notify_email', 'notify_email_backup', 'qq_group', 'announcement',
'checkin_min', 'checkin_max', 'tool_points_min', 'tool_points_max', 'nav_items', 'about_lines',
'banned_words', 'resend_from', 'no_refund_notice'];
for (const k of allowed) if (b[k]!== undefined) await setSetting(c.env.DB, k, typeof b[k] === 'string'? b[k]: JSON.stringify(b[k]));
await logAudit(c.env.DB, admin.id, 'settings', '', '更新基本设置');
return c.json({ ok: true, message: '基本设置已保存，前端同步生效'});
});

// ---------- 分类管理 ----------
adminApiRoutes.post('/api/admin/categories', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
if (b.action === 'delete') {
const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE category_id=?').bind(Number(b.id)).first();
if ((count?.n || 0) > 0 &&!b.move_to) {
return c.json({ ok: false, error: `这个分类下还有 ${count.n} 篇文章，先把文章移到别的分类，或先删文章，不能直接弄丢`}, 400);
}
if (b.move_to) await c.env.DB.prepare('UPDATE articles SET category_id=? WHERE category_id=?').bind(Number(b.move_to), Number(b.id)).run();
await c.env.DB.prepare('DELETE FROM categories WHERE id=?').bind(Number(b.id)).run();
await logAudit(c.env.DB, admin.id, 'category_delete', String(b.id), '');
return c.json({ ok: true, message: '分类已删除'});
}
if (b.id) {
await c.env.DB.prepare('UPDATE categories SET name=?, description=?, visibility=?, sort_order=?, is_visible=? WHERE id=?')
.bind(String(b.name || '').slice(0, 20), String(b.description || '').slice(0, 200), b.visibility || 'free', Number(b.sort_order || 0), b.is_visible? 1: 0, Number(b.id)).run();
await logAudit(c.env.DB, admin.id, 'category_update', String(b.id), String(b.name || ''));
return c.json({ ok: true, message: '分类已更新'});
}
const slug = slugify(b.name, 'cat');
const { meta} = await c.env.DB.prepare('INSERT INTO categories (slug, name, description, visibility, sort_order, is_visible) VALUES (?,?,?,?,?, 1)')
.bind(slug, String(b.name || '').slice(0, 20), String(b.description || '').slice(0, 200), b.visibility || 'free', Number(b.sort_order || 0)).run();
await logAudit(c.env.DB, admin.id, 'category_create', String(meta.last_row_id), String(b.name || ''));
return c.json({ ok: true, id: meta.last_row_id, message: '分类已新建'});
});

// ---------- 文章管理（含编辑器 6 个快捷命令由前端 editor 提供；图片走 /api/admin/images） ----------
adminApiRoutes.post('/api/admin/articles', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
if (b.action === 'delete') {
await c.env.DB.prepare('DELETE FROM articles WHERE id=?').bind(Number(b.id)).run();
await logAudit(c.env.DB, admin.id, 'article_delete', String(b.id), '');
return c.json({ ok: true, message: '文章已删除'});
}
if (b.action === 'pin') {
const art = await c.env.DB.prepare('SELECT is_pinned FROM articles WHERE id=?').bind(Number(b.id)).first();
if (!art) return c.json({ ok: false, error: '文章不存在'}, 404);
if (!art.is_pinned) {
const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE is_pinned=1').bind().first();
if ((row?.n || 0) >= 3) return c.json({ ok: false, error: '顶置已满 3 篇，先取消一篇的顶置再顶这篇'}, 400);
const maxOrder = await c.env.DB.prepare('SELECT MAX(pin_order) AS m FROM articles WHERE is_pinned=1').bind().first();
await c.env.DB.prepare('UPDATE articles SET is_pinned=1, pin_order=? WHERE id=?').bind((maxOrder?.m || 0) + 1, Number(b.id)).run();
} else {
await c.env.DB.prepare('UPDATE articles SET is_pinned=0, pin_order=0 WHERE id=?').bind(Number(b.id)).run();
}
await logAudit(c.env.DB, admin.id, 'article_pin', String(b.id), art.is_pinned? '取消顶置': '顶置');
return c.json({ ok: true, message: art.is_pinned? '已取消顶置': '已顶置（首页和文章列表同步显示）'});
}
const title = String(b.title || '').trim();
if (!title) return c.json({ ok: false, error: '请填标题'}, 400);
const points = Math.min(20, Math.max(0, Number(b.points_price || 0)));
if (b.id) {
await c.env.DB.prepare(
`UPDATE articles SET title=?, category_id=?, tag=?, summary=?, content=?, hidden_content=?, visibility=?, points_price=?, status=?, updated_at=datetime('now') WHERE id=?`
).bind(title, Number(b.category_id), b.tag || null, String(b.summary || '').slice(0, 300), String(b.content || ''), String(b.hidden_content || ''), b.visibility || 'free', points, b.status || 'published', Number(b.id)).run();
if (b.script_price_cents!== undefined) await setSetting(c.env.DB, `script_price_${b.id}`, String(Math.max(0, Number(b.script_price_cents || 0))));
await logAudit(c.env.DB, admin.id, 'article_update', String(b.id), title);
return c.json({ ok: true, id: Number(b.id), message: '文章已保存'});
}
const slug = slugify(title);
const { meta} = await c.env.DB.prepare(
`INSERT INTO articles (slug, category_id, tag, title, summary, content, hidden_content, visibility, points_price, status)
VALUES (?,?,?,?,?,?,?,?,?,?)`
).bind(slug, Number(b.category_id), b.tag || null, title, String(b.summary || '').slice(0, 300), String(b.content || ''), String(b.hidden_content || ''), b.visibility || 'free', points, b.status || 'published').run();
if (b.script_price_cents) await setSetting(c.env.DB, `script_price_${meta.last_row_id}`, String(Math.max(0, Number(b.script_price_cents))));
await logAudit(c.env.DB, admin.id, 'article_create', String(meta.last_row_id), title);
return c.json({ ok: true, id: meta.last_row_id, slug, message: '文章已发布'});
});

// ---------- 评论审核：通过 / 拒绝 / 删除 / 回复 / 封禁 ----------
// 通过时评论数 +1（发评论时只有已通过的才计了数，pending 通过要补上）
adminApiRoutes.post('/api/admin/comments', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const cm = await c.env.DB.prepare('SELECT * FROM comments WHERE id=?').bind(Number(b.id)).first();
if (!cm) return c.json({ ok: false, error: '评论不存在'}, 404);
if (b.action === 'delete') {
if (cm.status === 'approved') await c.env.DB.prepare('UPDATE articles SET comments_count = MAX(0, comments_count-1) WHERE id=?').bind(cm.article_id).run();
await c.env.DB.prepare('DELETE FROM comments WHERE id=?').bind(cm.id).run();
} else if (b.action === 'approve' || b.action === 'reject') {
const status = b.action === 'approve'? 'approved': 'rejected';
await c.env.DB.prepare('UPDATE comments SET status=? WHERE id=?').bind(status, cm.id).run();
if (status === 'approved' && cm.status!== 'approved') await c.env.DB.prepare('UPDATE articles SET comments_count = comments_count+1 WHERE id=?').bind(cm.article_id).run();
} else if (b.action === 'reply') {
const text = String(b.reply || '').trim();
if (!text) return c.json({ ok: false, error: '请填回复内容'}, 400);
await c.env.DB.prepare("INSERT INTO comments (article_id, user_id, content, status) VALUES (?,?,?, 'approved')").bind(cm.article_id, admin.id, `站长回复：${text}`).run();
await c.env.DB.prepare('UPDATE articles SET comments_count = comments_count+1 WHERE id=?').bind(cm.article_id).run();
} else if (b.action === 'ban') {
await c.env.DB.prepare('UPDATE users SET is_banned=1 WHERE id=?').bind(cm.user_id).run();
await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(cm.user_id).run();
} else return c.json({ ok: false, error: '操作不对'}, 400);
await logAudit(c.env.DB, admin.id, `comment_${b.action}`, String(cm.id), '');
return c.json({ ok: true, message: '已处理'});
});

// ---------- 点赞 / 收藏异常取消 ----------
adminApiRoutes.post('/api/admin/interactions/cancel', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
if (b.type === 'like') {
await c.env.DB.batch([
c.env.DB.prepare('DELETE FROM likes WHERE user_id=? AND article_id=?').bind(Number(b.user_id), Number(b.article_id)),
c.env.DB.prepare('UPDATE articles SET likes_count = MAX(0, likes_count-1) WHERE id=?').bind(Number(b.article_id)),
]);
} else if (b.type === 'favorite') {
await c.env.DB.batch([
c.env.DB.prepare('DELETE FROM favorites WHERE user_id=? AND article_id=?').bind(Number(b.user_id), Number(b.article_id)),
c.env.DB.prepare('UPDATE articles SET favorites_count = MAX(0, favorites_count-1) WHERE id=?').bind(Number(b.article_id)),
]);
} else return c.json({ ok: false, error: '类型不对'}, 400);
await logAudit(c.env.DB, admin.id, `cancel_${b.type}`, `${b.user_id}/${b.article_id}`, '');
return c.json({ ok: true, message: '已取消，数量已同步减掉'});
});

// ---------- 用户管理 ----------
adminApiRoutes.post('/api/admin/users', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(Number(b.id)).first();
if (!user) return c.json({ ok: false, error: '用户不存在'}, 404);
if (b.action === 'delete') {
if (user.is_admin) return c.json({ ok: false, error: '站长账号不能删'}, 400);
await c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id).run();
await logAudit(c.env.DB, admin.id, 'user_delete', String(user.id), user.username);
return c.json({ ok: true, message: '用户已删除'});
}
if (b.action === 'ban' || b.action === 'unban') {
await c.env.DB.prepare('UPDATE users SET is_banned=? WHERE id=?').bind(b.action === 'ban'? 1: 0, user.id).run();
if (b.action === 'ban') await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
await logAudit(c.env.DB, admin.id, b.action === 'ban'? 'user_ban': 'user_unban', String(user.id), user.username);
return c.json({ ok: true, message: b.action === 'ban'? '已封禁（不能登录，会员时间照走不暂停）': '已解封'});
}
if (b.action === 'reset_password') {
const pw = String(b.new_password || '');
if (pw.length < 6) return c.json({ ok: false, error: '新密码要 6 位以上'}, 400);
await c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPasswordWithSalt(pw), user.id).run();
await c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id).run();
await logAudit(c.env.DB, admin.id, 'user_reset_password', String(user.id), user.username);
return c.json({ ok: true, message: '密码已重置，该用户需重新登录'});
}
// 编辑 QQ / 微信（后台可操作；用户自己填入后不可改）
await c.env.DB.prepare('UPDATE users SET qq=?, wechat=? WHERE id=?').bind(String(b.qq || user.qq), b.wechat === undefined? user.wechat: String(b.wechat), user.id).run();
await logAudit(c.env.DB, admin.id, 'user_update', String(user.id), user.username);
return c.json({ ok: true, message: '已保存'});
});

// ---------- 会员管理：套餐自定义 + 手动开通/续费/取消 + 改到期 ----------
adminApiRoutes.post('/api/admin/plans', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const perms = b.permissions_json || {};
if (b.id) {
await c.env.DB.prepare('UPDATE membership_plans SET name=?, price_cents=?, icon=?, duration_days=?, permissions_json=?, is_active=? WHERE id=?')
.bind(String(b.name || '').slice(0, 20), Math.max(0, Number(b.price_cents || 0)), String(b.icon || '').slice(0, 10), Number(b.duration_days || 30), typeof perms === 'string'? perms: JSON.stringify(perms), b.is_active? 1: 0, Number(b.id)).run();
await logAudit(c.env.DB, admin.id, 'plan_update', String(b.id), String(b.name || ''));
return c.json({ ok: true, message: '套餐已更新，前端同步显示'});
}
const { meta} = await c.env.DB.prepare("INSERT INTO membership_plans (slug, name, price_cents, duration_days, permissions_json, icon, is_active) VALUES (?,?,?,?,?,?, 1)")
.bind(slugify(b.name, 'plan'), String(b.name || '').slice(0, 20), Math.max(0, Number(b.price_cents || 0)), Number(b.duration_days || 30), typeof perms === 'string'? perms: JSON.stringify(perms), String(b.icon || '').slice(0, 10)).run();
return c.json({ ok: true, id: meta.last_row_id, message: '套餐已新建'});
});

adminApiRoutes.post('/api/admin/members', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const plan = await c.env.DB.prepare('SELECT * FROM membership_plans WHERE id=?').bind(Number(b.plan_id)).first();
if (!plan) return c.json({ ok: false, error: '套餐不存在'}, 404);
const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(Number(b.user_id)).first();
if (!user) return c.json({ ok: false, error: '用户不存在'}, 404);
if (b.action === 'cancel') {
await c.env.DB.prepare("UPDATE memberships SET status='cancelled' WHERE user_id=? AND status='active'").bind(user.id).run();
await logAudit(c.env.DB, admin.id, 'member_cancel', String(user.id), user.username);
return c.json({ ok: true, message: '该用户会员已取消（到期前权限收回，记录保留）'});
}
if (b.action === 'extend') {
const days = Number(b.days || 0);
if (!days) return c.json({ ok: false, error: '请填延长的天数'}, 400);
const m = await c.env.DB.prepare("SELECT * FROM memberships WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1").bind(user.id).first();
if (!m) return c.json({ ok: false, error: '该用户当前没有有效会员'}, 400);
await c.env.DB.prepare("UPDATE memberships SET expires_at=datetime(expires_at,?) WHERE id=?").bind(`+${days} days`, m.id).run();
await logAudit(c.env.DB, admin.id, 'member_extend', String(user.id), `${user.username} +${days}天`);
return c.json({ ok: true, message: `已延长 ${days} 天（从到期日往后延）`});
}
// 手动开通：没有有效会员从现在算；有则从到期日往后延
  const now = new Date();
const cur = await c.env.DB.prepare("SELECT * FROM memberships WHERE user_id=? AND status='active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1").bind(user.id).first();
const start = cur? new Date(String(cur.expires_at).replace(' ', 'T') + 'Z'): now;
const end = new Date(start.getTime() + plan.duration_days * 86400000);
const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
await c.env.DB.prepare("INSERT INTO memberships (user_id, plan_id, starts_at, expires_at, status) VALUES (?,?,?,?, 'active')").bind(user.id, plan.id, fmt(start), fmt(end)).run();
await logAudit(c.env.DB, admin.id, 'member_grant', String(user.id), `${user.username} ${plan.name} 至 ${fmt(end)}`);
await notifyUser(c.env, user, '站长已为你开通会员', `<p>${user.username} 你好：站长已为你开通 ${plan.name}，到期时间 ${fmt(end)}。</p><p>—— AI指南 openzn.cc</p>`);
return c.json({ ok: true, message: `已手动开通 ${plan.name}，到期 ${fmt(end)}`});
});

// ---------- 订单管理：审核通过自动开通/到账；编辑/删除/保留；部署状态流转 ----------
adminApiRoutes.post('/api/admin/orders', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const order = await getOrder(c.env.DB, Number(b.id));
if (!order) return c.json({ ok: false, error: '订单不存在'}, 404);
const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(order.user_id).first();
if (b.action === 'approve') {
if (order.status!== 'pending') return c.json({ ok: false, error: '只有待审核订单能通过'}, 400);
const g = await grantOrder(c.env.DB, order, user);
if (!g.ok) return c.json({ ok: false, error: g.error}, 500);
await c.env.DB.prepare("UPDATE orders SET status='success', paid_at=datetime('now') WHERE id=?").bind(order.id).run();
await notifyUser(c.env, user, `你的订单已通过 ${order.order_no}`,
`<p>${user?.username || ''} 你好：你的订单 ${order.order_no}（${order.product_name}）已通过审核${order.product_type === 'monthly' || order.product_type === 'yearly'? `，会员已开通，到期 ${g.membership?.expires_at || ''}`: order.product_type === 'balance_recharge'? `，余额已到账 ${((order.credit_cents || 0) / 100).toFixed(2)} 元`: ''}。</p><p>—— AI指南 openzn.cc</p>`);
await logAudit(c.env.DB, admin.id, 'order_approve', order.order_no, order.product_name);
return c.json({ ok: true, message: '已通过，系统已自动开通会员 / 加余额'});
}
if (b.action === 'reject') {
if (order.status!== 'pending') return c.json({ ok: false, error: '只有待审核订单能拒绝'}, 400);
await c.env.DB.prepare("UPDATE orders SET status='rejected', remark=? WHERE id=?").bind(String(b.remark || '站长审核未通过').slice(0, 200), order.id).run();
await notifyUser(c.env, user, `你的订单未通过 ${order.order_no}`, `<p>${user?.username || ''} 你好：你的订单 ${order.order_no}（${order.product_name}）未通过审核，原因：${String(b.remark || '请联系站长')}。虚拟资源不支持退款，请确认付款信息无误后重新提交。</p>`);
await logAudit(c.env.DB, admin.id, 'order_reject', order.order_no, '');
return c.json({ ok: true, message: '已拒绝，并通知了用户'});
}
if (b.action === 'delete') {
await c.env.DB.prepare('DELETE FROM orders WHERE id=?').bind(order.id).run();
await logAudit(c.env.DB, admin.id, 'order_delete', order.order_no, '');
return c.json({ ok: true, message: '订单已删除'});
}
if (b.action === 'deploy') {
// 部署状态：待处理 → 处理中 → 已完成；两步都自动发邮件；完成时订单变交易成功，部署次数 +1
const next = b.deploy_status;
if (!['processing', 'completed'].includes(next)) return c.json({ ok: false, error: '部署状态不对'}, 400);
if (order.product_type!== 'free_deploy') return c.json({ ok: false, error: '这不是部署申请订单'}, 400);
await c.env.DB.prepare('UPDATE orders SET deploy_status=? WHERE id=?').bind(next, order.id).run();
if (next === 'processing') {
await notifyUser(c.env, user, `你的部署申请已接单 ${order.order_no}`, `<p>${user?.username || ''} 你好：你的远程部署申请（${order.order_no}，${order.device_type || ''} / ${order.system_info || ''}）站长已接单，正在处理中，请保持 QQ 畅通。</p>`);
} else {
await c.env.DB.prepare("UPDATE orders SET status='success', paid_at=datetime('now') WHERE id=?").bind(order.id).run();
await notifyUser(c.env, user, `你的远程部署已完成 ${order.order_no}`, `<p>${user?.username || ''} 你好：你的远程部署申请（${order.order_no}）已完成，部署次数 +1。如有问题请联系站长。</p>`);
}
await logAudit(c.env.DB, admin.id, `deploy_${next}`, order.order_no, '');
return c.json({ ok: true, message: next === 'processing'? '已接单，已发邮件通知用户': '已完成，订单已变交易成功，部署次数 +1'});
}
// 编辑：改金额 / 状态 / 备注（保留）
await c.env.DB.prepare('UPDATE orders SET total_cents=?, paid_cents=?, remark=? WHERE id=?')
.bind(Number(b.total_cents?? order.total_cents), Number(b.paid_cents?? order.paid_cents), String(b.remark?? order.remark?? '').slice(0, 200), order.id).run();
await logAudit(c.env.DB, admin.id, 'order_update', order.order_no, '');
return c.json({ ok: true, message: '订单已保存'});
});

// ---------- 财富管理：手动增减余额/积分；卡密生成/作废 ----------
adminApiRoutes.post('/api/admin/wealth/adjust', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(Number(b.user_id)).first();
if (!user) return c.json({ ok: false, error: '用户不存在'}, 404);
const reason = String(b.reason || '站长手动调整').slice(0, 100);
if (b.kind === 'balance') {
const cents = Number(b.change_cents || 0);
if (!cents) return c.json({ ok: false, error: '请填变动金额（分，可负数）'}, 400);
await c.env.DB.batch([
c.env.DB.prepare('UPDATE users SET balance_cents = balance_cents +? WHERE id=?').bind(cents, user.id),
c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_cents, reason) VALUES (?, 'balance',?,?)").bind(user.id, cents, reason),
]);
} else if (b.kind === 'points') {
const pts = Number(b.change_points || 0);
if (!pts) return c.json({ ok: false, error: '请填变动积分（可负数）'}, 400);
await c.env.DB.batch([
c.env.DB.prepare('UPDATE users SET points = points +? WHERE id=?').bind(pts, user.id),
c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_points, reason) VALUES (?, 'points',?,?)").bind(user.id, pts, reason),
]);
} else return c.json({ ok: false, error: '类型不对'}, 400);
await logAudit(c.env.DB, admin.id, 'wealth_adjust', String(user.id), `${user.username} ${b.kind} ${b.kind === 'balance'? b.change_cents: b.change_points}`);
return c.json({ ok: true, message: '已调整，流水已记'});
});

adminApiRoutes.post('/api/admin/cards', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
if (b.action === 'void') {
await c.env.DB.prepare("UPDATE card_codes SET status='void' WHERE id=? AND status='unused'").bind(Number(b.id)).run();
await logAudit(c.env.DB, admin.id, 'card_void', String(b.id), '');
return c.json({ ok: true, message: '卡密已作废'});
}
// 生成：一次可生成多张，金额/有效期自定义；码格式 OZN-XXXX-XXXX
const amount = Math.max(100, Number(b.amount_cents || 0));
const count = Math.min(100, Math.max(1, Number(b.count || 1)));
const expires = b.expires_at? String(b.expires_at).slice(0, 19).replace('T', ' '): null;
const codes = [];
for (let i = 0; i < count; i++) {
const code = `OZN-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
try {
await c.env.DB.prepare('INSERT INTO card_codes (code, amount_cents, expires_at) VALUES (?,?,?)').bind(code, amount, expires).run();
codes.push(code);
} catch { /* 随机码撞了就跳过这张 */}
}
await logAudit(c.env.DB, admin.id, 'card_create', codes.join(','), `金额 ${amount} 分 × ${codes.length} 张`);
return c.json({ ok: true, codes, message: `已生成 ${codes.length} 张卡密，每张 ${((amount) / 100).toFixed(2)} 元`});
});

// ---------- 智能管理（第四期）：模型多 Key + 飞书 + 开关 ----------
// Key 只存加密串，接口绝不返回完整 Key；前台只显示后 4 位。
const AI_PROVIDERS = ['nvidia', 'openrouter', 'deepseek', 'qwen', 'kimi', 'glm', 'other'];

// 飞书配置 + 开关（每个独立，默认全关）
adminApiRoutes.post('/api/admin/ai/settings', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
for (const k of ['feishu_webhook', 'feishu_app_id', 'feishu_app_secret']) {
if (b[k]!== undefined) await setAISetting(c.env.DB, k, String(b[k]).slice(0, 300));
}
if (b.feishu_webhook && !/^https:\/\//.test(String(b.feishu_webhook)) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(String(b.feishu_webhook))) {
return c.json({ ok: false, error: '飞书机器人地址不对，要以 https:// 开头（飞书群机器人 webhook）'}, 400);
}
for (const s of AI_SWITCHES) {
if (b[s.key]!== undefined) await setAISetting(c.env.DB, s.key, b[s.key]? '1': '0');
}
await logAudit(c.env.DB, admin.id, 'ai_settings', '', '更新智能管理：飞书配置 / 开关');
return c.json({ ok: true, message: '智能管理设置已保存'});
});

// 模型：新建 / 编辑 / 删除 / 上移下移 / 启用停用 / 测试连接
adminApiRoutes.post('/api/admin/ai/models', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const db = c.env.DB;
if (b.action === 'delete') {
await db.batch([
db.prepare('DELETE FROM ai_keys WHERE model_id=?').bind(Number(b.id)),
db.prepare('DELETE FROM ai_models WHERE id=?').bind(Number(b.id)),
]);
await logAudit(db, admin.id, 'ai_model_delete', String(b.id), '');
return c.json({ ok: true, message: '模型及它的 Key 已删除'});
}
if (b.action === 'toggle') {
const m = await db.prepare('SELECT is_active FROM ai_models WHERE id=?').bind(Number(b.id)).first();
if (!m) return c.json({ ok: false, error: '模型不存在'}, 404);
await db.prepare('UPDATE ai_models SET is_active=? WHERE id=?').bind(m.is_active? 0: 1, Number(b.id)).run();
await logAudit(db, admin.id, 'ai_model_toggle', String(b.id), m.is_active? '停用': '启用');
return c.json({ ok: true, message: m.is_active? '模型已停用（调用时跳过它）': '模型已启用'});
}
if (b.action === 'move') {
const dir = Number(b.dir) === -1? -1: 1;
const m = await db.prepare('SELECT * FROM ai_models WHERE id=?').bind(Number(b.id)).first();
if (!m) return c.json({ ok: false, error: '模型不存在'}, 404);
const other = await db.prepare(
dir === -1
? 'SELECT * FROM ai_models WHERE sort_order < ? ORDER BY sort_order DESC, id DESC LIMIT 1'
: 'SELECT * FROM ai_models WHERE sort_order > ? ORDER BY sort_order ASC, id ASC LIMIT 1'
).bind(m.sort_order).first();
if (!other) return c.json({ ok: false, error: dir === -1? '已经在最上面了': '已经在最下面了'}, 400);
await db.batch([
db.prepare('UPDATE ai_models SET sort_order=? WHERE id=?').bind(other.sort_order, m.id),
db.prepare('UPDATE ai_models SET sort_order=? WHERE id=?').bind(m.sort_order, other.id),
]);
await logAudit(db, admin.id, 'ai_model_move', String(b.id), dir === -1? '上移': '下移');
return c.json({ ok: true, message: '排序已调整（数字越小越优先调用）'});
}
if (b.action === 'test') {
const m = await db.prepare('SELECT * FROM ai_models WHERE id=?').bind(Number(b.id)).first();
if (!m) return c.json({ ok: false, error: '模型不存在'}, 404);
const keys = await db.prepare("SELECT id FROM ai_keys WHERE model_id=? AND is_active=1").bind(m.id).all();
if (!keys.results?.length) return c.json({ ok: false, error: '这个模型还没填 Key，先加一个 Key 再测试'}, 400);
const r = await callAI(db, c.env, { prompt: '你好，请只回复 ok', purpose: 'test' });
if (!r.ok) return c.json({ ok: false, error: r.error, attempts: r.attempts }, 500);
return c.json({ ok: true, message: `测试通过：${r.model}（Key ****${r.keyLast4}）返回 ok`, model: r.model, attempts: r.attempts });
}
const name = String(b.name || '').trim();
const baseUrl = String(b.base_url || '').trim().replace(/\/$/, '');
const model = String(b.model || '').trim();
if (!name || !baseUrl || !model) return c.json({ ok: false, error: '名称、API 地址、模型名都要填'}, 400);
if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(baseUrl)) return c.json({ ok: false, error: 'API 地址要以 https:// 开头（本地测试可用 http://localhost）'}, 400);
if (!AI_PROVIDERS.includes(b.provider)) return c.json({ ok: false, error: '提供商不对'}, 400);
if (b.id) {
await db.prepare('UPDATE ai_models SET name=?, provider=?, base_url=?, model=?, sort_order=?, note=? WHERE id=?')
.bind(name.slice(0, 40), b.provider, baseUrl.slice(0, 200), model.slice(0, 120), Number(b.sort_order || 0), String(b.note || '').slice(0, 120), Number(b.id)).run();
await logAudit(db, admin.id, 'ai_model_update', String(b.id), name);
return c.json({ ok: true, message: '模型已保存'});
}
const { meta} = await db.prepare('INSERT INTO ai_models (name, provider, base_url, model, sort_order, note, is_active) VALUES (?,?,?,?,?,?, 0)')
.bind(name.slice(0, 40), b.provider, baseUrl.slice(0, 200), model.slice(0, 120), Number(b.sort_order || 0), String(b.note || '').slice(0, 120)).run();
await logAudit(db, admin.id, 'ai_model_create', String(meta.last_row_id), name);
return c.json({ ok: true, id: meta.last_row_id, message: '模型已新建（默认停用，先加 Key 再启用）'});
});

// Key：新增 / 删除 / 启用停用（新增时只收 Key，不返回完整 Key）
adminApiRoutes.post('/api/admin/ai/keys', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const db = c.env.DB;
if (b.action === 'delete') {
await db.prepare('DELETE FROM ai_keys WHERE id=?').bind(Number(b.id)).run();
await logAudit(db, admin.id, 'ai_key_delete', String(b.id), '');
return c.json({ ok: true, message: 'Key 已删除'});
}
if (b.action === 'toggle') {
const k = await db.prepare('SELECT is_active FROM ai_keys WHERE id=?').bind(Number(b.id)).first();
if (!k) return c.json({ ok: false, error: 'Key 不存在'}, 404);
await db.prepare('UPDATE ai_keys SET is_active=? WHERE id=?').bind(k.is_active? 0: 1, Number(b.id)).run();
await logAudit(db, admin.id, 'ai_key_toggle', String(b.id), k.is_active? '停用': '启用');
return c.json({ ok: true, message: k.is_active? 'Key 已停用': 'Key 已启用'});
}
const model = await db.prepare('SELECT id FROM ai_models WHERE id=?').bind(Number(b.model_id)).first();
if (!model) return c.json({ ok: false, error: '模型不存在'}, 404);
const plain = String(b.key || '').trim();
if (plain.length < 8) return c.json({ ok: false, error: 'Key 太短了，请粘贴完整 Key'}, 400);
const enc = await encryptKey(db, c.env, plain);
const { meta} = await db.prepare('INSERT INTO ai_keys (model_id, label, key_enc, key_last4, sort_order) VALUES (?,?,?,?,?)')
.bind(model.id, String(b.label || '').slice(0, 30), enc, maskKey(plain).replace('****', ''), Number(b.sort_order || 0)).run();
await logAudit(db, admin.id, 'ai_key_create', String(meta.last_row_id), `模型 ${model.id} 新 Key ****${maskKey(plain).replace('****', '')}`);
return c.json({ ok: true, id: meta.last_row_id, message: `Key 已保存（只显示后 4 位 ****${maskKey(plain).replace('****', '')}，完整 Key 不会再显示）`});
});

// 飞书测试推送
adminApiRoutes.post('/api/admin/ai/feishu-test', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const r = await sendFeishu(c.env.DB, c.env, {
title: '🤖 AI指南飞书测试',
content: '这是 AI指南智能管理的测试推送，收到这条说明飞书机器人配好了。以后有新订单、新评论、会员到期都会推到这里。',
link: `${SITE.url}/admin/ai`,
});
if (!r.ok) return c.json({ ok: false, error: r.error }, 400);
await logAudit(c.env.DB, admin.id, 'ai_feishu_test', '', '飞书测试推送成功');
return c.json({ ok: true, message: '测试消息已推到飞书，请去飞书群里看一下'});
});

// 每日汇总手动触发（定时任务每天 09:00 上海时间也会跑）
adminApiRoutes.post('/api/admin/ai/digest', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const r = await dailyDigest(c.env.DB, c.env);
if (!r.ok) return c.json({ ok: false, error: r.feishu?.error || r.reason || r.error || '汇总失败，请先开每日汇总开关并配好飞书'}, 400);
await logAudit(c.env.DB, admin.id, 'ai_digest', '', '手动发了一次每日汇总');
return c.json({ ok: true, message: '每日汇总已推到飞书', counts: r.counts });
});

// AI 润色文章（第四期补全）：只返回建议，不改原文。
// 前端先把结果放预览框，站长点“采用”才替换进编辑器，点“不用”就丢掉。
adminApiRoutes.post('/api/admin/ai/polish', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const r = await polishArticle(c.env.DB, c.env, { text: b.text, mode: b.mode });
if (!r.ok) return c.json({ ok: false, error: r.error }, 400);
await logAudit(c.env.DB, admin.id, 'ai_polish', r.mode, `模型 ${r.model || ''}`);
return c.json({ ok: true, result: r.result, model: r.model, mode: r.mode, message: '已生成建议，先看预览，满意再点“采用”' });
});

// 待审核订单超时提醒手动触发（定时任务每天 09:00 也会跑）
adminApiRoutes.post('/api/admin/ai/pending-remind', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const r = await pendingOrderRemind(c.env.DB, c.env);
if (!r.ok) return c.json({ ok: false, error: r.feishu?.error || r.reason || r.error || '提醒失败，请先开超时提醒开关并配好飞书'}, 400);
await logAudit(c.env.DB, admin.id, 'ai_pending_remind', '', `手动推了一次超时待审核订单提醒（${r.count} 笔）`);
return c.json({ ok: true, message: r.count ? `已推 ${r.count} 笔超时待审核订单到飞书` : '没有超过 24 小时没处理的待审核订单', count: r.count });
});

// ---------- 聊天机器人设置（第五期）：欢迎语 / 每日限额 / 站长联系方式 ----------
// 只保存站长填好的公开联系方式；手机号、身份证、真实地址、密码、Key 绝不要填在这里，
// 后端也不收这些字段。站长没填的联系方式，前端小助手问联系站长时不推。
adminApiRoutes.post('/api/admin/ai/chatbot', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const allowed = {
chatbot_welcome: String(b.chatbot_welcome || '').slice(0, 200),
chatbot_daily_limit: String(Math.min(100, Math.max(1, Number(b.chatbot_daily_limit) || 20))),
chatbot_contact_qq: String(b.chatbot_contact_qq || '').slice(0, 20),
chatbot_contact_group: String(b.chatbot_contact_group || '').slice(0, 20),
chatbot_contact_email: String(b.chatbot_contact_email || '').slice(0, 100),
chatbot_contact_wechat: String(b.chatbot_contact_wechat || '').slice(0, 40),
chatbot_contact_note: String(b.chatbot_contact_note || '').slice(0, 200),
};
for (const [k, v] of Object.entries(allowed)) await setAISetting(c.env.DB, k, v);
await logAudit(c.env.DB, admin.id, 'ai_chatbot_settings', '', '更新聊天机器人设置：欢迎语 / 每日限额 / 站长联系方式');
return c.json({ ok: true, message: '聊天机器人设置已保存（总开关在上面开关列表里，打开后前台才显示小机器人）'});
});

// ---------- 自动回复（第五期）：关键词命中先回，不走模型省额度 ----------
adminApiRoutes.post('/api/admin/ai/auto-replies', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
const db = c.env.DB;
if (b.action === 'delete') {
await db.prepare('DELETE FROM ai_auto_replies WHERE id=?').bind(Number(b.id)).run();
await logAudit(db, admin.id, 'ai_reply_delete', String(b.id), '');
return c.json({ ok: true, message: '自动回复已删除'});
}
if (b.action === 'toggle') {
const r = await db.prepare('SELECT is_active FROM ai_auto_replies WHERE id=?').bind(Number(b.id)).first();
if (!r) return c.json({ ok: false, error: '这条自动回复不存在'}, 404);
await db.prepare('UPDATE ai_auto_replies SET is_active=? WHERE id=?').bind(r.is_active? 0: 1, Number(b.id)).run();
await logAudit(db, admin.id, 'ai_reply_toggle', String(b.id), r.is_active? '停用': '启用');
return c.json({ ok: true, message: r.is_active? '自动回复已停用': '自动回复已启用'});
}
const keyword = String(b.keyword || '').trim().slice(0, 60);
const reply = String(b.reply || '').trim().slice(0, 500);
if (!keyword || !reply) return c.json({ ok: false, error: '关键词和回复内容都要填'}, 400);
const { meta} = await db.prepare('INSERT INTO ai_auto_replies (keyword, reply, sort_order) VALUES (?,?,?)')
.bind(keyword, reply, Number(b.sort_order || 0)).run();
await logAudit(db, admin.id, 'ai_reply_create', String(meta.last_row_id), keyword);
return c.json({ ok: true, id: meta.last_row_id, message: '自动回复已新建（用户消息包含关键词就先回这条）'});
});

// ---------- 聊天记录删除（第五期）：站长可删违规对话 ----------
// 用户只能看自己的记录（/api/ai/chat/history），删除只能站长做。
adminApiRoutes.post('/api/admin/ai/chat-logs', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const b = await body(c);
if (b.action !== 'delete') return c.json({ ok: false, error: '操作不对'}, 400);
await c.env.DB.prepare('DELETE FROM ai_chat_logs WHERE id=?').bind(Number(b.id)).run();
await logAudit(c.env.DB, admin.id, 'ai_chat_log_delete', String(b.id), '');
return c.json({ ok: true, message: '聊天记录已删除'});
});

// ---------- 到期提醒：手动触发扫描（定时任务每天 09:00 上海时间也会跑） ----------
adminApiRoutes.post('/api/admin/expiry-remind', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
const out = await expiryReminderScan(c.env.DB, c.env);
await logAudit(c.env.DB, admin.id, 'expiry_remind', '', `扫描到 ${out.length} 个 7 天内到期会员，发出 ${out.filter((o) => o.sent).length} 封`);
return c.json({ ok: true, scanned: out.length, sent: out.filter((o) => o.sent).length, detail: out.map((o) => ({ user: o.membership.username, expires_at: o.membership.expires_at, sent: o.sent}))});
});

// ---------- 图库：R2 图片（不直接暴露 R2 地址，走 Workers 代理输出） ----------
// 没配 R2 时返回空列表，编辑器仍可用远程 URL 插入图片。
adminApiRoutes.get('/api/admin/images', async (c) => {
const { res} = await adminOnly(c); if (res) return res;
if (!c.env.IMAGES) return c.json({ ok: true, images: [], note: '还没建 R2 图库（openzn-images），先用远程图片地址插入'});
const list = await c.env.IMAGES.list({ limit: 100});
return c.json({ ok: true, images: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded}))});
});

adminApiRoutes.post('/api/admin/images/upload', async (c) => {
const { res, admin} = await adminOnly(c); if (res) return res;
if (!c.env.IMAGES) return c.json({ ok: false, error: '还没建 R2 图库（openzn-images），请先在 Cloudflare 建 R2 再上传'}, 400);
const form = await c.req.formData().catch(() => null);
const file = form?.get('file');
if (!file || typeof file.arrayBuffer!== 'function') return c.json({ ok: false, error: '请选择图片文件'}, 400);
if (file.size > 5 * 1024 * 1024) return c.json({ ok: false, error: '图片不能超过 5MB'}, 400);
const key = `${Date.now()}-${String(file.name || 'img').replace(/[^a-zA-Z0-9._-]/g, '')}`;
await c.env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'image/png'}});
await logAudit(c.env.DB, admin.id, 'image_upload', key, '');
return c.json({ ok: true, key, url: `/img/${encodeURIComponent(key)}`, message: '已上传到 R2 图库，插入时用这个地址'});
});

// 前台图片代理：/img/:key（不暴露 R2 直链；防盗靠前端禁用右键/拖拽/长按 + 水印角标）
adminApiRoutes.get('/img/:key', async (c) => {
if (!c.env.IMAGES) return c.text('图库未配置', 404);
const obj = await c.env.IMAGES.get(decodeURIComponent(c.req.param('key')));
if (!obj) return c.text('图片不存在', 404);
return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/png', 'Cache-Control': 'public, max-age=86400'}});
});

export { SITE, sendEmail};
