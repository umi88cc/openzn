// AI指南 — 会员页（v5，第三期完整版）
// 只做月费、年费；不要永久会员。名称、价格、图标、权限全部后台自定义，
// 月费示例 29 元，年费价格后台自定义（这里不写死年费价格）。
// 付款：扫码 + 手动核验（不接支付接口）或余额直付。虚拟资源不支持退款。
// 部署申请表即订单：只有会员能看到，填设备类型、系统、QQ 号。
import { Hono } from 'hono';
import { pageHTML, escapeHtml } from '../lib/render.js';
import { currentUser } from '../lib/auth.js';
import { getActiveMembership } from '../lib/membership.js';
import { freeToolsUsed, freeScriptQuota, deployQuota, fmtMoney } from '../lib/orders.js';
import { SITE } from '../lib/config.js';

export const membershipRoutes = new Hono();

membershipRoutes.get('/member', async (c) => {
  const db = c.env.DB;
  const user = await currentUser(c);
  let plans = [];
  if (db) {
    const { results } = await db.prepare(
      "SELECT slug, name, price_cents, duration_days, permissions_json, icon FROM membership_plans WHERE is_active=1 ORDER BY duration_days ASC"
    ).all();
    plans = results || [];
  }
  if (!plans.length) {
    plans = [{ slug: 'monthly', name: '月费会员', price_cents: 2900, duration_days: 30, permissions_json: '{}', icon: '🥈' }];
  }
  const membership = user && db ? await getActiveMembership(db, user.id) : null;
  const quotas = user && db ? {
    tools: await freeToolsUsed(db, user.id, membership),
    script: await freeScriptQuota(db, user.id, membership),
    deploy: await deployQuota(db, user.id, membership),
  } : null;
  let myDeploys = [];
  let scriptArticles = [];
  if (db) {
    const { results } = await db.prepare(
      `SELECT id, title, slug FROM articles a WHERE a.status='published' AND a.category_id=(SELECT id FROM categories WHERE slug='scripts' LIMIT 1) ORDER BY a.created_at DESC LIMIT 20`
    ).all().catch(() => ({ results: [] }));
    scriptArticles = results || [];
  }
  if (user && db) {
    const { results } = await db.prepare(
      "SELECT * FROM orders WHERE user_id=? AND product_type='free_deploy' ORDER BY created_at DESC LIMIT 10"
    ).bind(user.id).all();
    myDeploys = results || [];
  }

  const cards = plans.map((p) => {
    const price = p.price_cents ? `¥${(p.price_cents / 100).toFixed(0)}` : '价格后台自定义';
    const days = p.duration_days === 30 ? '30 天' : p.duration_days === 365 ? '365 天' : `${p.duration_days} 天`;
    const isCurrent = membership && ((p.slug === 'monthly' && membership.duration_days === 30) || (p.slug === 'yearly' && membership.duration_days === 365));
    const perks = p.slug === 'yearly'
      ? ['全部不限制，一路绿灯', '所有收费、脚本、所有工具免积分免费下载', '免回复可见', '可入 QQ 会员群', '可一对一交流学习', '免费远程部署每两个月 1 次（一年 6 次）']
      : ['每月免积分下载 5 份工具（第 6 份起用积分兑换）', '每月免费领 1 份收费脚本（任选）', '每月免费远程部署 1 次', '免回复可见所有回复文章', '可入 QQ 会员群', '可一对一交流学习'];
    return `<section class="card plan-card ${p.slug === 'yearly' ? 'plan-gold' : ''}">
      <h2>${escapeHtml(p.icon || (p.slug === 'yearly' ? '👑' : '🥈'))} ${escapeHtml(p.name)}</h2>
      <div class="plan-price">${price}<span> / ${days}</span></div>
      <ul>${perks.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      <p class="muted small">10 元网费不在网站计划内，只在会员权限里标注说明，用户私下微信或支付宝转给站长。</p>
      ${isCurrent
        ? `<p class="muted">你当前就是这个套餐，到期 ${escapeHtml(membership.expires_at)}，续费从到期那天往后延。</p><button type="button" class="btn-gold" data-open-member="${escapeHtml(p.slug)}">续费</button>`
        : `<button type="button" class="btn-gold" data-open-member="${escapeHtml(p.slug)}">开通</button>`}
    </section>`;
  }).join('');

  const payPanel = user ? `<section class="card" id="payPanel" hidden>
    <h2>开通 / 续费：<span id="payPlanName"></span></h2>
    <p class="muted">当前余额：<strong id="payBalance">${fmtMoney(user.balance_cents)}</strong> · 余额够直接扣、马上开通，不用等审核；余额不够或想扫码，就选下面扫码。</p>
    <div class="pay-methods">
      <label><input type="radio" name="pay_method" value="balance" checked> 余额支付（马上开通）</label>
      <label><input type="radio" name="pay_method" value="alipay"> 支付宝扫码</label>
      <label><input type="radio" name="pay_method" value="wechat"> 微信扫码</label>
    </div>
    <div class="pay-qrs" id="payQrs" hidden>
      <figure><img src="/assets/qr/alipay-pay-qr.png" alt="支付宝商家收款码" width="160" height="160" loading="lazy"><figcaption>支付宝（商家码 · AI指南）</figcaption></figure>
      <figure><img src="/assets/qr/wechat-pay-qr.png" alt="微信商家收款码" width="160" height="160" loading="lazy"><figcaption>微信（商家码 · 优米博客）</figcaption></figure>
    </div>
    <form id="memberPayForm" class="profile-form">
      <input type="hidden" name="plan_slug" id="payPlanSlug">
      <input name="pay_ref" placeholder="扫码付款备注：金额 / 时间或交易单号后几位（余额支付不用填）" maxlength="100">
      <button type="submit" class="btn-gold" id="paySubmit">确认开通</button>
    </form>
    <p class="muted small" id="payMsg">扫码付款后点“我已付款通知站长”，站长核验通过后自动开通；订单号会生成在“我的-订单”里。</p>
    <p class="muted small">虚拟资源不支持退款：付款前请确认好套餐。</p>
  </section>` : `<section class="card"><h2>开通会员</h2><p class="muted">请先登录再开通。<button type="button" data-open-auth>去登录</button></p></section>`;

  const memberArea = membership ? `<section class="card">
    <h2>我的会员</h2>
    <p>当前：<strong>${escapeHtml(membership.plan_name)}</strong>（${membership.isYearly ? '年费' : '月费'}），到期 <strong>${escapeHtml(membership.expires_at)}</strong></p>
    <p class="muted">到期前 7 天会发邮件到你的注册邮箱提醒续费；到期后权限收回变回普通用户，之前的购买/兑换/下载记录保留可查。</p>
    <ul>
      <li>免积分工具：本周期已用 ${quotas?.tools.used ?? 0}/${quotas?.tools.limit ?? 5} 份${quotas?.tools.unlimited ? '（年费不限）' : ''}</li>
      <li>免费脚本：本月已领 ${quotas?.script.used ?? 0}/${quotas?.script.limit ?? 1} 份${quotas?.script.unlimited ? '（年费不限）' : ''}</li>
      <li>免费部署：本周期已用 ${quotas?.deploy.used ?? 0}/${quotas?.deploy.limit ?? 1} 次（${membership.isYearly ? '每两个月 1 次' : '每月 1 次'}）</li>
    </ul>
    <p>QQ 会员群：${SITE.qqGroup}（开通后站长私下将你拉入群）· 可一对一交流学习</p>
  </section>
  <section class="card" id="deploySection">
    <h2>🛠️ 免费远程部署申请</h2>
    <p class="muted">只有会员能申请，普通用户请按文章教程操作。部署本身免费；10 元网费不在网站计划内，私下微信/支付宝转给站长。</p>
    <form id="deployForm" class="profile-form">
      <select name="device_type" required>
        <option value="">设备类型</option><option>电脑本地</option><option>VPS</option><option>安卓手机</option>
      </select>
      <input name="system_info" placeholder="系统，如 Windows 11 / Ubuntu 22.04 / Android 14" required maxlength="120">
      <input name="contact_qq" placeholder="联系 QQ 号" required maxlength="20" value="${escapeHtml(user.qq || '')}">
      <button type="submit" class="btn-primary">提交申请</button>
    </form>
    <p class="muted small" id="deployMsg">提交后马上生成一笔 0 元订单（类型：免费部署，状态：待处理），站长接单/完成后都会发邮件通知你。</p>
    <h3>我的部署申请</h3>
    <ul>${myDeploys.map((o) => `<li><a href="/orders/${o.id}">${escapeHtml(o.order_no)}</a> · ${escapeHtml(o.device_type || '')} ${escapeHtml(o.system_info || '')} · ${{ pending: '待处理', processing: '处理中', completed: '已完成' }[o.deploy_status] || o.deploy_status} · ${o.status === 'success' ? '交易成功' : '待审核'}</li>`).join('') || '<li class="muted">暂无部署申请。</li>'}</ul>
  </section>
  <section class="card">
    <h2>📜 免费领收费脚本（每月 1 份任选，年费不限）</h2>
    <ul>${scriptArticles.map((a) => `<li>${escapeHtml(a.title)} <button type="button" class="btn-primary" data-free-script="${a.id}">免费领</button></li>`).join('') || '<li class="muted">暂无收费脚本，站长正在后台撰写中。</li>'}</ul>
    <p class="muted small" id="scriptMsg">点领取那一刻生成一笔 0 元订单，同时扣掉当月免费次数。</p>
  </section>` : `<section class="card"><h2>🛠️ 免费远程部署 / 免费领脚本</h2><p class="muted">只有会员能看到申请表、免费领脚本。普通用户请按文章教程操作，开通会员后这里会出现申请表。</p></section>`;

  const body = `<h1>👑 会员</h1>
  <p class="muted">会员名称、价格、图标、权限都由站长在后台自定义，后台设置了前端能同步。续费从到期那天往后延。</p>
  <div class="plan-grid">${cards}</div>
  ${payPanel}
  ${memberArea}
  <section class="card">
    <h2>常见问题</h2>
    <ul>
      <li>开通有什么好处？免积分下工具、免费领脚本、免费远程部署、免回复可见。</li>
      <li>能否分享账号？不能，一个账号仅限本人使用。</li>
      <li>能否退款？虚拟资源不支持退款，付款前请确认。</li>
      <li>付款失败怎么办？点“我已付款通知站长”，站长手动核验。</li>
      <li>怎么续费？到期前 7 天会发邮件提醒，续费从到期那天往后延。</li>
      <li>10 元网费是什么？远程部署时的网吧上网费，不在网站计划内，私下微信/支付宝转给站长就行。</li>
    </ul>
  </section>
  <script src="/js/member.js" defer></script>`;
  return c.html(pageHTML({ title: '会员', active: '/member', bottomActive: 'member', body, user }));
});
