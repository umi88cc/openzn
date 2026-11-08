// AI指南 — 财富：余额充值页 + 卡密兑换（v5，第三期）
// 充值档位：10 / 50送3（到账53）/ 120送10（到账130）/ 300送20（到账320），最低 10 元。
// 积分只能靠签到获得，不可充值；余额和积分分开，流水分开记。
// 卡密：后台生成，金额/有效期自定义；兑换生成对应订单，记录是哪个用户兑的。
import { Hono } from 'hono';
import { pageHTML, escapeHtml } from '../lib/render.js';
import { getSessionUser, currentUser } from '../lib/auth.js';
import { RECHARGE_TIERS } from '../lib/config.js';
import { createOrder, fmtMoney } from '../lib/orders.js';

export const wealthRoutes = new Hono();

wealthRoutes.get('/recharge', async (c) => {
  const user = await currentUser(c);
  const tiers = RECHARGE_TIERS.map((t) => `
    <label class="tier-card">
      <input type="radio" name="pay_cents" value="${t.pay}" ${t.pay === 5000 ? 'checked' : ''}>
      <strong>充 ¥${t.pay / 100}</strong>
      <span>到账 ${fmtMoney(t.credit)}${t.gift ? `（送 ${fmtMoney(t.gift)}）` : ''}</span>
    </label>`).join('');
  const body = `<h1>💰 余额充值</h1>
  <p class="muted">当前余额：<strong>${user ? fmtMoney(user.balance_cents) : '未登录'}</strong> · 充值档位最低 10 元，扫码支付后站长手动核验，通过自动到账。</p>
  <section class="card">
    <h2>选档位</h2>
    <div class="tier-grid">${tiers}</div>
    <h2>扫码付款</h2>
    <div class="pay-qrs">
      <figure><img src="/assets/qr/alipay-pay-qr.png" alt="支付宝商家收款码" width="160" height="160" loading="lazy"><figcaption>支付宝（商家码 · AI指南）</figcaption></figure>
      <figure><img src="/assets/qr/wechat-pay-qr.png" alt="微信商家收款码" width="160" height="160" loading="lazy"><figcaption>微信（商家码 · 优米博客）</figcaption></figure>
    </div>
    <form id="rechargeForm" class="profile-form">
      <select name="pay_method" required><option value="alipay">支付宝扫码</option><option value="wechat">微信扫码</option></select>
      <input name="pay_ref" placeholder="付款备注：金额 / 时间或交易单号后几位" maxlength="100">
      <button type="submit" class="btn-primary">我已付款通知站长</button>
    </form>
    <p class="muted small" id="rechargeMsg">提交后生成待审核订单并邮件通知站长，核验通过后自动到账，可在“我的-订单”查看。</p>
  </section>
  <section class="card">
    <h2>🎫 卡密兑换</h2>
    <p class="muted">在群里领到的卡密在这里兑换，兑换后余额直接到账，并生成一笔订单记录。</p>
    <form id="cardForm" class="profile-form">
      <input name="code" placeholder="输入卡密，如 OZN-XXXX-XXXX" required maxlength="64">
      <button type="submit" class="btn-primary">兑换</button>
    </form>
    <p class="muted small" id="cardMsg"></p>
  </section>
  <p><a href="/me?tab=wealth">← 回我的财富</a></p>
  <script src="/js/recharge.js" defer></script>`;
  return c.html(pageHTML({ title: '余额充值', active: '/me', bottomActive: 'me', body, user }));
});

// 卡密兑换：未使用 + 未过期 + 未作废；到账余额，生成订单，记录兑换人。
wealthRoutes.post('/api/card-codes/redeem', async (c) => {
  if (!c.env.DB) return c.json({ ok: false, error: '数据库未就绪' }, 503);
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) return c.json({ ok: false, error: '请先登录', loginRequired: true }, 401);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  if (!user) return c.json({ ok: false, error: '请先登录' }, 401);
  const { code } = await c.req.json().catch(() => ({}));
  const codeText = String(code || '').trim().toUpperCase();
  if (!codeText) return c.json({ ok: false, error: '请填卡密' }, 400);
  const card = await c.env.DB.prepare('SELECT * FROM card_codes WHERE code=?').bind(codeText).first();
  if (!card) return c.json({ ok: false, error: '卡密不存在' }, 404);
  if (card.status === 'used') return c.json({ ok: false, error: '这个卡密已经被兑换过了' }, 400);
  if (card.status === 'void') return c.json({ ok: false, error: '这个卡密已被作废' }, 400);
  if (card.expires_at && new Date(String(card.expires_at).replace(' ', 'T') + 'Z') < new Date()) {
    return c.json({ ok: false, error: '这个卡密已经过期了' }, 400);
  }
  const order = await createOrder(c.env.DB, { userId: user.id, productType: 'card_code', productName: `卡密兑换（${codeText}）`, totalCents: card.amount_cents, paidCents: 0, creditCents: card.amount_cents, status: 'success' });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id=?').bind(card.amount_cents, user.id),
    c.env.DB.prepare("UPDATE card_codes SET status='used', used_by=?, used_at=datetime('now'), order_id=? WHERE id=?").bind(user.id, order.id, card.id),
    c.env.DB.prepare("UPDATE orders SET paid_at=datetime('now') WHERE id=?").bind(order.id),
    c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_cents, reason, order_id) VALUES (?, 'balance', ?, ?, ?)").bind(user.id, card.amount_cents, `卡密兑换：${codeText}`, order.id),
  ]);
  const fresh = await c.env.DB.prepare('SELECT balance_cents FROM users WHERE id=?').bind(user.id).first();
  return c.json({ ok: true, order, amount_cents: card.amount_cents, balance_cents: fresh?.balance_cents || 0, message: `兑换成功，已到账 ${fmtMoney(card.amount_cents)}` });
});
