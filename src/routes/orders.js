// AI指南 — 订单 API（v5，第三期）
// 会员开通（余额直付 / 扫码待审核）、余额充值（扫码待审核）、
// 部署申请表即订单、免费领脚本、买脚本（余额）、取消待审核订单、订单详情。
// 不接支付接口：扫码支付一律手动核验，站长后台通过后自动开通/到账。
import { Hono} from 'hono';
import { pageHTML, escapeHtml} from '../lib/render.js';
import { getSessionUser, isAdminAccount} from '../lib/auth.js';
import { getActiveMembership} from '../lib/membership.js';
import { SITE, RECHARGE_TIERS} from '../lib/config.js';
import {
createOrder, getOrder, notifyAdmin, notifyUser, grantOrder,
deployQuota, freeScriptQuota, rechargeTier, fmtMoney,
} from '../lib/orders.js';
import { notifyOrderAI } from '../lib/ai.js';

export const orderRoutes = new Hono();

async function needLogin(c) {
if (!c.env.DB) return { res: c.json({ ok: false, error: '数据库未就绪'}, 503), user: null};
const session = await getSessionUser(c.env.DB, c.req.raw);
if (!session) return { res: c.json({ ok: false, error: '请先登录', loginRequired: true}, 401), user: null};
const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
if (!user) return { res: c.json({ ok: false, error: '请先登录', loginRequired: true}, 401), user: null};
return { res: null, user};
}

function statusLabel(s) {
return { pending: '待审核', success: '交易成功', rejected: '已拒绝', cancelled: '已取消'}[s] || s;
}
function productLabel(t) {
return { monthly: '月费会员', yearly: '年费会员', balance_recharge: '余额充值', card_code: '卡密兑换', free_script: '免费脚本领取', free_deploy: '免费部署', free_tool: '免费工具领取', script: '部署脚本'}[t] || t;
}

// ---------- 订单详情：顶部三步进度 ----------
// 步骤：确认订单详情 → 完成支付 → 订单结果
orderRoutes.get('/orders/:id', async (c) => {
const { res, user} = await needLogin(c);
if (res) return c.html(pageHTML({ title: '订单详情', active: '/me', bottomActive: 'me', body: '<h1>订单详情</h1><p class="muted">请先登录。</p>'}));
const order = await getOrder(c.env.DB, Number(c.req.param('id')));
if (!order) return c.notFound();
if (order.user_id!== user.id &&!isAdminAccount(user)) {
return c.html(pageHTML({ title: '订单详情', active: '/me', bottomActive: 'me', body: '<h1>订单详情</h1><p class="muted">你只能看自己的订单。</p>'}));
}
const step = order.status === 'pending'? 2: order.status === 'success'? 3: 2;
const deployLine = order.product_type === 'free_deploy'? `<p>设备类型：${escapeHtml(order.device_type || '')} · 系统：${escapeHtml(order.system_info || '')} · QQ：${escapeHtml(order.contact_qq || '')} · 部署状态：${{ pending: '待处理', processing: '处理中', completed: '已完成'}[order.deploy_status] || '—'}</p>`: '';
const body = `<h1>订单详情</h1>
<section class="card">
<ol class="order-steps">
<li class="${step >= 1? 'done': ''}">1 · 确认订单详情</li>
<li class="${step >= 2? 'done': ''}">2 · 完成支付</li>
<li class="${step >= 3? 'done': ''}">3 · 订单结果</li>
</ol>
<p>订单号码：<strong>${escapeHtml(order.order_no)}</strong> <button type="button" class="copy-btn" data-copy-order="${escapeHtml(order.order_no)}">复制</button></p>
<p>商品类型：${productLabel(order.product_type)}</p>
<p>商品名称：${escapeHtml(order.product_name)}</p>
<p>下单时间：${escapeHtml(order.created_at)}</p>
<p>支付时间：${escapeHtml(order.paid_at || '—')}</p>
<p>订单总额：${fmtMoney(order.total_cents)} · 实付金额：${fmtMoney(order.paid_cents)}${order.credit_cents? ` · 到账：${fmtMoney(order.credit_cents)}`: ''}</p>
<p>支付状态：${statusLabel(order.status)} · 支付方式：${{ balance: '余额支付', alipay: '支付宝扫码', wechat: '微信扫码'}[order.pay_method] || '—'}</p>
${order.pay_ref? `<p>付款备注：${escapeHtml(order.pay_ref)}</p>`: ''}
${deployLine}
${order.remark? `<p>备注：${escapeHtml(order.remark)}</p>`: ''}
<p class="muted small">虚拟资源不支持退款：用户付款后即视为同意部署服务或已看中该商品。</p>
${order.status === 'pending'? `<button type="button" class="btn-primary" data-cancel-order="${order.id}">取消这笔待审核订单</button>`: ''}
<p><a href="/me?tab=orders">← 回我的订单</a>${isAdminAccount(user)? ` · <a href="/admin/orders">回后台订单管理</a>`: ''}</p>
</section>
<script>document.querySelectorAll('[data-copy-order]').forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(b.dataset.copyOrder);b.textContent='已复制';});document.querySelectorAll('[data-cancel-order]').forEach(b=>b.onclick=async()=>{if(!confirm('确定取消这笔待审核订单吗？'))return;const r=await fetch('/api/orders/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:Number(b.dataset.cancelOrder)})});const d=await r.json().catch(()=>({}));alert(d.ok?'已取消':(d.error||'取消失败'));if(d.ok)location.reload();});</script>`;
return c.html(pageHTML({ title: '订单详情', active: '/me', bottomActive: 'me', body, user}));
});

// 我的订单列表（支持按订单号搜）
orderRoutes.get('/api/orders', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const q = String(c.req.query('q') || '').trim();
const { results} = q
? await c.env.DB.prepare('SELECT * FROM orders WHERE user_id=? AND order_no LIKE? ORDER BY created_at DESC LIMIT 50').bind(user.id, `%${q}%`).all()
: await c.env.DB.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
return c.json({ ok: true, orders: (results || []).map((o) => ({...o, status_label: statusLabel(o.status), product_label: productLabel(o.product_type)}))});
});

// ---------- 开通/续费会员 ----------
// 余额支付：余额够直接扣、马上激活、不经人工审核，订单直接交易成功。
// 扫码支付：生成待审核订单 + 发邮件通知站长，站长后台通过后自动激活。
orderRoutes.post('/api/orders/membership', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const { plan_slug, pay_method, pay_ref} = await c.req.json().catch(() => ({}));
if (!['monthly', 'yearly'].includes(plan_slug)) return c.json({ ok: false, error: '套餐不对'}, 400);
if (!['balance', 'alipay', 'wechat'].includes(pay_method)) return c.json({ ok: false, error: '请选择余额支付或支付宝/微信扫码'}, 400);
const plan = await c.env.DB.prepare('SELECT * FROM membership_plans WHERE slug=? AND is_active=1').bind(plan_slug).first();
if (!plan) return c.json({ ok: false, error: '这个套餐还没启用，请联系站长在后台设置价格后启用'}, 400);
if (!plan.price_cents || plan.price_cents <= 0) return c.json({ ok: false, error: '这个套餐价格还没设置，请联系站长'}, 400);
const name = `${plan.name}（${plan.duration_days === 365? '365 天': '30 天'}）`;

if (pay_method === 'balance') {
if ((user.balance_cents || 0) < plan.price_cents) {
return c.json({ ok: false, error: `余额不足（需要 ${fmtMoney(plan.price_cents)}，当前 ${fmtMoney(user.balance_cents)}），请先去充值`, goRecharge: true}, 402);
}
const order = await createOrder(c.env.DB, { userId: user.id, productType: plan_slug, productName: name, totalCents: plan.price_cents, paidCents: plan.price_cents, payMethod: 'balance', status: 'success'});
await c.env.DB.batch([
c.env.DB.prepare('UPDATE users SET balance_cents = balance_cents -? WHERE id=? AND balance_cents >=?').bind(plan.price_cents, user.id, plan.price_cents),
c.env.DB.prepare("UPDATE orders SET paid_at=datetime('now') WHERE id=?").bind(order.id),
c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_cents, reason, order_id) VALUES (?, 'balance',?,?,?)").bind(user.id, -plan.price_cents, `购买会员：${name}`, order.id),
]);
const g = await grantOrder(c.env.DB, order, user);
if (!g.ok) return c.json({ ok: false, error: g.error}, 500);
await notifyOrderAI(c.env.DB, c.env, order, user).catch(() => {}); // 第四期：订单 AI 提醒（只提醒，不自动通过；失败不阻塞下单）
return c.json({ ok: true, order, membership: g.membership, message: `已开通${name}，到期 ${g.membership.expires_at}`});
}

// 扫码支付：待审核
const order = await createOrder(c.env.DB, { userId: user.id, productType: plan_slug, productName: name, totalCents: plan.price_cents, paidCents: plan.price_cents, payMethod: pay_method, payRef: String(pay_ref || '').slice(0, 100), status: 'pending'});
await notifyAdmin(c.env, `新会员订单待审核 ${order.order_no}`,
`<p>用户 ${user.username}（QQ ${user.qq}）提交了会员订单：</p><p>商品：${name}，金额 ${fmtMoney(plan.price_cents)}，支付方式：${pay_method === 'alipay'? '支付宝': '微信'}，付款备注：${escapeHtml(pay_ref || '—')}</p><p>订单号：${order.order_no}，请到后台订单管理核验，通过后系统自动开通。</p>`);
await notifyOrderAI(c.env.DB, c.env, order, user).catch(() => {}); // 第四期：订单 AI 提醒（只提醒，不自动通过；失败不阻塞下单）
return c.json({ ok: true, order, message: '已通知站长，请等站长核验通过后自动开通（订单号已生成，可在“我的-订单”查看）'});
});

// ---------- 余额充值（扫码，站长手动审核后到账） ----------
orderRoutes.post('/api/orders/recharge', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const { pay_cents, pay_method, pay_ref} = await c.req.json().catch(() => ({}));
const tier = rechargeTier(pay_cents);
if (!tier) return c.json({ ok: false, error: `充值档位不对（可选 ${RECHARGE_TIERS.map((t) => t.pay / 100).join(' / ')} 元，最低 10 元）`}, 400);
if (!['alipay', 'wechat'].includes(pay_method)) return c.json({ ok: false, error: '请选择支付宝或微信扫码充值'}, 400);
const order = await createOrder(c.env.DB, { userId: user.id, productType: 'balance_recharge', productName: `余额充值 ${tier.pay / 100} 元（到账 ${fmtMoney(tier.credit)}）`, totalCents: tier.pay, paidCents: tier.pay, creditCents: tier.credit, payMethod: pay_method, payRef: String(pay_ref || '').slice(0, 100), status: 'pending'});
await notifyAdmin(c.env, `余额充值待审核 ${order.order_no}`,
`<p>用户 ${user.username}（QQ ${user.qq}）提交了余额充值：充 ${tier.pay / 100} 元，到账 ${fmtMoney(tier.credit)}，支付方式：${pay_method === 'alipay'? '支付宝': '微信'}，付款备注：${escapeHtml(pay_ref || '—')}</p><p>订单号：${order.order_no}，请到后台订单管理核验，通过后自动到账。</p>`);
await notifyOrderAI(c.env.DB, c.env, order, user).catch(() => {}); // 第四期：订单 AI 提醒（只提醒，不自动通过；失败不阻塞下单）
return c.json({ ok: true, order, message: `已提交充值申请（充 ${tier.pay / 100} 元，到账 ${fmtMoney(tier.credit)}），已通知站长核验`});
});

// ---------- 取消待审核订单（用户自己能取消） ----------
orderRoutes.post('/api/orders/cancel', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const { order_id} = await c.req.json().catch(() => ({}));
const order = await getOrder(c.env.DB, Number(order_id));
if (!order || order.user_id!== user.id) return c.json({ ok: false, error: '订单不存在'}, 404);
if (order.status!== 'pending') return c.json({ ok: false, error: '只有待审核的订单能取消'}, 400);
await c.env.DB.prepare("UPDATE orders SET status='cancelled' WHERE id=?").bind(order.id).run();
return c.json({ ok: true, message: '订单已取消'});
});

// ---------- 部署申请表即订单（只有会员能看到/提交） ----------
// 提交马上生成一笔 0 元订单：类型免费部署，状态待处理，订单号一起生成。
orderRoutes.post('/api/orders/deploy', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const membership = await getActiveMembership(c.env.DB, user.id);
const quota = await deployQuota(c.env.DB, user.id, membership);
if (!quota.allowed) return c.json({ ok: false, error: quota.reason}, 403);
const { device_type, system_info, contact_qq} = await c.req.json().catch(() => ({}));
if (!device_type ||!system_info ||!contact_qq) return c.json({ ok: false, error: '请填设备类型、系统、QQ 号'}, 400);
const order = await createOrder(c.env.DB, { userId: user.id, productType: 'free_deploy', productName: '免费远程部署', totalCents: 0, paidCents: 0, status: 'pending', deviceType: String(device_type).slice(0, 40), systemInfo: String(system_info).slice(0, 120), contactQq: String(contact_qq).slice(0, 20), deployStatus: 'pending'});
await notifyAdmin(c.env, `新的免费部署申请 ${order.order_no}`,
`<p>会员 ${user.username} 提交了免费远程部署申请：</p><p>设备：${escapeHtml(device_type)}，系统：${escapeHtml(system_info)}，QQ：${escapeHtml(contact_qq)}</p><p>订单号：${order.order_no}，请到后台订单管理接单。</p><p class="muted">10 元网费不在网站计划内，用户私下微信/支付宝转给站长，不生成订单。</p>`);
await notifyOrderAI(c.env.DB, c.env, order, user).catch(() => {}); // 第四期：订单 AI 提醒（只提醒，不自动通过；失败不阻塞下单）
return c.json({ ok: true, order, message: '申请已提交，站长接单后会发邮件通知你（订单号已生成，可在“我的-订单”查看进度）'});
});

// ---------- 免费领收费脚本（会员；月费每月 1 份，年费不限） ----------
orderRoutes.post('/api/orders/free-script', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const membership = await getActiveMembership(c.env.DB, user.id);
const quota = await freeScriptQuota(c.env.DB, user.id, membership);
if (!quota.allowed) return c.json({ ok: false, error: quota.reason}, 403);
const { article_id} = await c.req.json().catch(() => ({}));
const article = await c.env.DB.prepare("SELECT * FROM articles WHERE id=? AND status='published'").bind(Number(article_id)).first();
if (!article) return c.json({ ok: false, error: '脚本文章不存在'}, 404);
const order = await createOrder(c.env.DB, { userId: user.id, productType: 'free_script', productName: `免费领取脚本：${article.title}`, totalCents: 0, paidCents: 0, status: 'success'});
await c.env.DB.prepare("INSERT INTO downloads (user_id, article_id, tool_name, cost_type, cost_points, order_id) VALUES (?,?,?, 'member_free', 0,?)").bind(user.id, article.id, article.title, order.id).run();
await notifyOrderAI(c.env.DB, c.env, order, user).catch(() => {}); // 第四期：订单 AI 提醒（只提醒，不自动通过；失败不阻塞下单）
return c.json({ ok: true, order, message: '已免费领取，现在可以查看 / 下载这个脚本'});
});

// ---------- 余额买部署脚本（脚本价格后台自定义，存在 site_settings） ----------
orderRoutes.post('/api/orders/buy-script', async (c) => {
const { res, user} = await needLogin(c);
if (res) return res;
const { article_id} = await c.req.json().catch(() => ({}));
const article = await c.env.DB.prepare("SELECT * FROM articles WHERE id=? AND status='published'").bind(Number(article_id)).first();
if (!article) return c.json({ ok: false, error: '脚本文章不存在'}, 404);
const row = await c.env.DB.prepare('SELECT value FROM site_settings WHERE key=?').bind(`script_price_${article.id}`).first();
const price = Number(row?.value || 0);
if (!price || price <= 0) return c.json({ ok: false, error: '这个脚本还没定价，请联系站长在后台设置价格'}, 400);
if ((user.balance_cents || 0) < price) {
return c.json({ ok: false, error: `余额不足（需要 ${fmtMoney(price)}，当前 ${fmtMoney(user.balance_cents)}），请先去充值`, goRecharge: true}, 402);
}
const order = await createOrder(c.env.DB, { userId: user.id, productType: 'script', productName: `购买脚本：${article.title}`, totalCents: price, paidCents: price, payMethod: 'balance', status: 'success'});
await c.env.DB.batch([
c.env.DB.prepare('UPDATE users SET balance_cents = balance_cents -? WHERE id=? AND balance_cents >=?').bind(price, user.id, price),
c.env.DB.prepare("UPDATE orders SET paid_at=datetime('now') WHERE id=?").bind(order.id),
c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_cents, reason, order_id) VALUES (?, 'balance',?,?,?)").bind(user.id, -price, `购买脚本：${article.title}`, order.id),
c.env.DB.prepare("INSERT INTO downloads (user_id, article_id, tool_name, cost_type, cost_cents, order_id) VALUES (?,?,?, 'paid',?,?)").bind(user.id, article.id, article.title, price, order.id),
]);
await notifyOrderAI(c.env.DB, c.env, order, user).catch(() => {}); // 第四期：订单 AI 提醒（只提醒，不自动通过；失败不阻塞下单）
return c.json({ ok: true, order, message: '已用余额购买，现在可以查看 / 下载这个脚本'});
});

export { statusLabel, productLabel};
export { SITE};
