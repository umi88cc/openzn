// AI指南 — 订单 / 会员开通 / 部署申请 核心逻辑（v5，第三期）
// 申请表即订单（orders 表，product_type='free_deploy'），不另建表。
// 扫码支付：待审核 → 站长同意后自动开通/到账；余额支付：直接扣，记交易成功。
// 续费从到期那天往后延；免费额度只按 30 天周期刷新，不随提前续费刷新。
// 虚拟资源不支持退款。10 元网费不进网站计划，不生成订单。
import { nextOrderNo, currentCycleStart } from './membership.js';
import { sendEmail} from './mail.js';
import { SITE, RECHARGE_TIERS, MONTHLY_QUOTA} from './config.js';
import { notifyExpiryFeishu, notifyExpiry3DayFeishu } from './ai.js';

function toDbTime(d) { return d.toISOString().slice(0, 19).replace('T', ' ');}
function fromDbTime(s) { return new Date(String(s || '').replace(' ', 'T') + 'Z');}
export function fmtMoney(cents) { return `¥${((cents || 0) / 100).toFixed(2)}`;}

export async function createOrder(db, o) {
const orderNo = nextOrderNo();
const { meta} = await db.prepare(
`INSERT INTO orders (order_no, user_id, product_type, product_name, total_cents, paid_cents,
credit_cents, pay_method, pay_ref, status, remark, device_type, system_info, contact_qq, deploy_status)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
).bind(
orderNo, o.userId, o.productType, o.productName, o.totalCents || 0, o.paidCents || 0,
o.creditCents || 0, o.payMethod || null, o.payRef || null, o.status || 'pending',
o.remark || '', o.deviceType || null, o.systemInfo || null, o.contactQq || null,
o.deployStatus || null,
).run();
return db.prepare('SELECT * FROM orders WHERE id=?').bind(meta.last_row_id).first();
}

export async function getOrder(db, id) {
return db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
}

// 通知站长：扫码付款 / 部署申请待处理。发到主邮箱，失败则发备用邮箱。
export async function notifyAdmin(env, subject, html) {
const main = env?.NOTIFY_EMAIL || SITE.notifyEmail;
const r = await sendEmail(env, { to: main, subject, html});
if (r.ok) return { ok: true, to: main};
const backup = env?.NOTIFY_EMAIL_BACKUP || SITE.notifyEmailBackup;
const r2 = await sendEmail(env, { to: backup, subject, html});
return { ok: r2.ok, to: r2.ok? backup: main, error: r2.error};
}

export async function notifyUser(env, user, subject, html) {
if (!user?.email) return { ok: false, error: '用户没有邮箱'};
return sendEmail(env, { to: user.email, subject, html});
}

// 开通/续费会员：从现有到期日往后延（提前续费也从到期日算），没有有效会员则从现在算。
// 返回新建的 memberships 行。
export async function activateMembership(db, userId, plan, orderId) {
const now = new Date();
// 续费基准：取所有未到期会员里到期最晚的那条（含未来才生效的续费记录），否则连续续费两次会重叠。
const current = await db.prepare(`SELECT m.* FROM memberships m WHERE m.user_id=? AND m.status='active' AND m.expires_at > datetime('now') ORDER BY m.expires_at DESC LIMIT 1`).bind(userId).first();
const start = current && fromDbTime(current.expires_at) > now ? fromDbTime(current.expires_at) : now;
const end = new Date(start.getTime() + plan.duration_days * 86400000);
const { meta} = await db.prepare(
`INSERT INTO memberships (user_id, plan_id, order_id, starts_at, expires_at, status)
VALUES (?,?,?,?,?, 'active')`
).bind(userId, plan.id, orderId, toDbTime(start), toDbTime(end)).run();
// 新周期开始时建一条额度记录（额度按 30 天周期走，提前续费不刷新旧周期）
await db.prepare(
`INSERT OR IGNORE INTO member_quotas (user_id, cycle_start, cycle_end) VALUES (?,?,?)`
).bind(userId, toDbTime(start), toDbTime(new Date(start.getTime() + 30 * 86400000))).run();
return db.prepare('SELECT * FROM memberships WHERE id=?').bind(meta.last_row_id).first();
}

// 订单通过后自动执行：开通会员 / 加余额。免费订单（领取/部署）通过时不重复执行。
export async function grantOrder(db, order, user) {
if (order.product_type === 'monthly' || order.product_type === 'yearly') {
const plan = await db.prepare('SELECT * FROM membership_plans WHERE slug=?').bind(order.product_type).first();
if (!plan) return { ok: false, error: '会员套餐不存在'};
const m = await activateMembership(db, order.user_id, plan, order.id);
return { ok: true, membership: m};
}
if (order.product_type === 'balance_recharge' || order.product_type === 'card_code') {
const credit = order.credit_cents || order.total_cents || 0;
if (credit > 0) {
await db.batch([
db.prepare('UPDATE users SET balance_cents = balance_cents +? WHERE id=?').bind(credit, order.user_id),
db.prepare("INSERT INTO wallet_logs (user_id, kind, change_cents, reason, order_id) VALUES (?, 'balance',?,?,?)").bind(
order.user_id, credit, order.product_type === 'card_code'? `卡密兑换：${order.product_name}`: `余额充值：${order.product_name}`, order.id),
]);
}
return { ok: true, credit_cents: credit};
}
return { ok: true, noop: true}; // free_script / free_tool / free_deploy / script：领取时已处理
}

// 部署免费额度：月费每 30 天 1 次；年费每 60 天 1 次（一年 6 次）。
export async function deployQuota(db, userId, membership) {
if (!membership) return { allowed: false, reason: '只有会员才能申请免费远程部署，普通用户请按文章教程操作'};
const windowDays = membership.isYearly? 60: 30;
const start = fromDbTime(membership.starts_at);
const now = new Date();
const elapsed = Math.max(0, now - start);
const winStart = new Date(start.getTime() + Math.floor(elapsed / (windowDays * 86400000)) * windowDays * 86400000);
const row = await db.prepare(
"SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND product_type='free_deploy' AND status IN ('pending','success') AND created_at >=?"
).bind(userId, toDbTime(winStart)).first();
const used = row?.n || 0;
const limit = 1;
return { allowed: used < limit, used, limit, windowDays, windowStart: toDbTime(winStart),
reason: used >= limit? `本${windowDays}天周期内免费部署已用完（${used}/${limit} 次），请等下个周期`: ''};
}

// 免费脚本额度：月费每 30 天 1 份；年费不限。
export async function freeScriptQuota(db, userId, membership) {
if (!membership) return { allowed: false, reason: '只有会员才能免费领收费脚本'};
if (membership.isYearly) return { allowed: true, used: 0, limit: 0, unlimited: true};
const start = toDbTime(currentCycleStart(membership, new Date()));
const row = await db.prepare(
"SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND product_type='free_script' AND created_at >=?"
).bind(userId, start).first();
const used = row?.n || 0;
return { allowed: used < MONTHLY_QUOTA.scripts, used, limit: MONTHLY_QUOTA.scripts,
reason: used >= MONTHLY_QUOTA.scripts? `本月免费脚本已领完（${used}/${MONTHLY_QUOTA.scripts} 份）`: ''};
}

// 本周期免积分工具已用份数（月费 5 份/30 天；年费不限）
export async function freeToolsUsed(db, userId, membership) {
if (!membership || membership.isYearly) return { used: 0, limit: membership?.isYearly? 0: MONTHLY_QUOTA.tools, unlimited:!!membership?.isYearly};
const start = toDbTime(currentCycleStart(membership, new Date()));
const row = await db.prepare(
"SELECT COUNT(*) AS n FROM downloads WHERE user_id=? AND cost_type='free_quota' AND created_at >=?"
).bind(userId, start).first();
return { used: row?.n || 0, limit: MONTHLY_QUOTA.tools, unlimited: false};
}

export function rechargeTier(payCents) {
return RECHARGE_TIERS.find((t) => t.pay === Number(payCents)) || null;
}

// 到期提醒：找出 7 天内到期的有效会员（只提醒一次，记 site_settings）。
// 返回 [{membership, user, sent}]。定时任务每天 09:00（上海）跑一次，后台也可手动触发。
export async function expiryReminderScan(db, env) {
if (!db) return [];
const { results} = await db.prepare(
`SELECT m.*, u.username, u.email FROM memberships m JOIN users u ON u.id=m.user_id
WHERE m.status='active' AND m.expires_at > datetime('now') AND m.expires_at <= datetime('now', '+7 days')
ORDER BY m.expires_at ASC`
).all();
const out = [];
for (const m of results || []) {
const key = `expiry_reminded_${m.id}`;
const done = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind(key).first();
if (done) { out.push({ membership: m, sent: false, reason: '已提醒过'}); continue;}
const r = await notifyUser(env, { email: m.email}, '你的会员再过 7 天就要到期了',
`<p>${m.username} 你好：</p><p>你的 AI指南 会员再过 7 天就要到期了（到期时间：${m.expires_at}），如要续期请登录 AI指南 续费。续费从到期那天往后延。</p><p>—— AI指南 openzn.cc</p>`);
if (r.ok) {
await db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, datetime('now'))").bind(key).run();
}
out.push({ membership: m, sent:!!r.ok, error: r.error});
}
// 第四期：会员到期 AI 提醒开关开着时，邮件之外再推一条飞书（只提醒，不自动续费）。
try {
const expiring = out.filter((o) => o.sent || o.membership).map((o) => o.membership);
await notifyExpiryFeishu(db, env, expiring).catch(() => {});
} catch { /* 飞书失败不影响邮件提醒结果 */ }
// 第四期补全：到期前 3 天再推一次（独立开关 ai_expiry_3day，默认关；每人只推一次）。
try {
const { results: in3 } = await db.prepare(
`SELECT m.*, u.username, u.email FROM memberships m JOIN users u ON u.id=m.user_id
WHERE m.status='active' AND m.expires_at > datetime('now') AND m.expires_at <= datetime('now', '+3 days')
ORDER BY m.expires_at ASC`
).all();
const fresh3 = [];
for (const m of in3 || []) {
const done = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind(`expiry3_reminded_${m.id}`).first();
if (!done) fresh3.push(m);
}
if (fresh3.length) {
const r3 = await notifyExpiry3DayFeishu(db, env, fresh3).catch(() => ({ ok: false }));
if (r3?.ok) for (const m of fresh3) await db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, datetime('now'))").bind(`expiry3_reminded_${m.id}`).run();
}
} catch { /* 飞书失败不影响邮件提醒结果 */ }
return out;
}

// 操作日志（后台审计用）
export async function logAudit(db, adminId, action, target, detail) {
if (!db) return;
try {
await db.prepare(
'INSERT INTO audit_logs (admin_id, action, target, detail) VALUES (?,?,?,?)'
).bind(adminId, action, target || '', detail || '').run();
} catch { /* 旧库没跑迁移时不阻塞主流程 */}
}
