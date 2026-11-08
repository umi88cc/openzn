// AI指南 — 我的（个人中心，第二期实现数据，第三期补会员/订单/后台联动）
// 顶部：头像 + 用户名 + 余额 + 个性签名 + 加入天数
// 下方 tab 顺序：资料、会员、财富、订单、评论、点赞、收藏
// 头像只拉 QQ 头像链接，不存图片本地；不公开显示注册 IP / 上次登录 IP。
import { Hono } from 'hono';
import { pageHTML, escapeHtml } from '../lib/render.js';
import { getSessionUser, publicUser } from '../lib/auth.js';
import { getActiveMembership, shanghaiDate } from '../lib/membership.js';
import { freeToolsUsed, freeScriptQuota, deployQuota, fmtMoney } from '../lib/orders.js';

export const meRoutes = new Hono();

const TABS = [
  { id: 'profile', label: '资料' },
  { id: 'member', label: '会员' },
  { id: 'wealth', label: '财富' },
  { id: 'orders', label: '订单' },
  { id: 'comments', label: '评论' },
  { id: 'likes', label: '点赞' },
  { id: 'favorites', label: '收藏' },
];

function daysSince(createdAt) {
  const start = new Date(String(createdAt || '').replace(' ', 'T') + 'Z');
  if (Number.isNaN(start.getTime())) return 1;
  return Math.max(1, Math.floor((Date.now() - start.getTime()) / 86400000) + 1);
}

meRoutes.get('/me', async (c) => {
  const tab = TABS.some((t) => t.id === c.req.query('tab')) ? c.req.query('tab') : 'profile';
  if (!c.env.DB) {
    return c.html(pageHTML({ title: '我的', active: '/me', bottomActive: 'me', body: '<h1>我的</h1><p class="muted">数据库未就绪，请先登录。</p>' }));
  }
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) {
    const body = `<h1>我的</h1>
    <section class="card me-top"><div class="me-avatar">👤</div>
    <div><strong>未登录</strong><p class="muted">点右上角个人中心图标登录，登录后这里显示你的 QQ 头像、用户名、余额、个性签名和加入天数。</p></div></section>
    <p><button type="button" data-open-auth>去登录 / 注册</button></p>`;
    return c.html(pageHTML({ title: '我的', active: '/me', bottomActive: 'me', body }));
  }
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  if (!user) {
    return c.html(pageHTML({ title: '我的', active: '/me', bottomActive: 'me', body: '<h1>我的</h1><p class="muted">账号不存在，请重新登录。</p>' }));
  }
  const pub = publicUser(user);
  const membership = await getActiveMembership(c.env.DB, user.id);
  const today = shanghaiDate();
  const checkedIn = await c.env.DB.prepare(
    'SELECT points_given FROM checkins WHERE user_id=? AND check_date=?'
  ).bind(user.id, today).first();

  const tabsHtml = `<nav class="me-tabs" aria-label="个人中心">${TABS.map((t) =>
    `<a href="/me?tab=${t.id}" class="${tab === t.id ? 'active' : ''}">${t.label}</a>`).join('')}</nav>`;

  let section = '';
  if (tab === 'profile') {
    section = `<section class="card"><h2>资料</h2>
      <p>账号：<strong>${escapeHtml(user.username)}</strong>（不可更改）</p>
      <p>QQ：${escapeHtml(user.qq)}（填入后不可改，后台可操作）</p>
      <p>微信：${escapeHtml(user.wechat || '未填写')}（填入后不可改，后台可操作）</p>
      <p>邮箱：${escapeHtml(user.email)}（绑定后不可改）</p>
      <p>性别：${escapeHtml(user.gender || '保密')}（每月限改 1 次）</p>
      <form id="profileForm" class="profile-form">
        <input name="signature" placeholder="个性签名" value="${escapeHtml(user.signature || '')}" maxlength="60">
        <select name="gender">
          <option value="保密"${user.gender === '保密' ? ' selected' : ''}>保密</option>
          <option value="男"${user.gender === '男' ? ' selected' : ''}>男</option>
          <option value="女"${user.gender === '女' ? ' selected' : ''}>女</option>
        </select>
        <button type="submit">保存签名 / 性别</button>
        <span class="muted small">头像跟 QQ 号在注册时确定，不可更换，登录时自动拉取最新 QQ 头像。</span>
      </form>
      <h3>排行榜上榜开关（两个独立开关，默认都上榜）</h3>
      <label><input type="checkbox" data-board-optin="points" ${user.show_on_points_board ? 'checked' : ''}> 积分上榜</label>
      <label><input type="checkbox" data-board-optin="balance" ${user.show_on_balance_board ? 'checked' : ''}> 余额上榜</label>
    </section>`;
  } else if (tab === 'wealth') {
    const { results: logs } = await c.env.DB.prepare(
      "SELECT * FROM wallet_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 30"
    ).bind(user.id).all();
    const { results: checkins } = await c.env.DB.prepare(
      'SELECT * FROM checkins WHERE user_id=? ORDER BY check_date DESC LIMIT 30'
    ).bind(user.id).all();
    section = `<section class="card"><h2>我的财富</h2>
      <p>积分：<strong>${user.points}</strong>（只靠签到获得，不可充值） · 余额：<strong>¥${(user.balance_cents / 100).toFixed(2)}</strong></p>
      <button type="button" class="btn-primary" data-checkin ${checkedIn ? 'disabled' : ''}>${checkedIn ? `今天已签到（+${checkedIn.points_given} 积分）` : '签到领积分（5~15 随机）'}</button>
      <span class="muted small" id="checkinMsg">每天 0 点刷新一次，积分不清零。</span>
      <h3>积分记录</h3>
      <ul>${logs.filter((l) => l.kind === 'points').map((l) => `<li>${escapeHtml(l.created_at)} · ${l.change_points > 0 ? '+' : ''}${l.change_points} 积分 · ${escapeHtml(l.reason)}</li>`).join('') || '<li class="muted">暂无记录，先去签到吧。</li>'}</ul>
      <h3>签到记录</h3>
      <ul>${checkins.map((r) => `<li>${escapeHtml(r.check_date)} · +${r.points_given} 积分</li>`).join('') || '<li class="muted">暂无签到记录。</li>'}</ul>
      <h3>余额流水</h3>
      <p><a class="btn-primary" href="/recharge">去充值（10 / 50送3 / 120送10 / 300送20）</a> <a class="btn-primary" href="/recharge">卡密兑换</a></p>
      <ul>${logs.filter((l) => l.kind === 'balance').map((l) => `<li>${escapeHtml(l.created_at)} · ${(l.change_cents / 100).toFixed(2)} 元 · ${escapeHtml(l.reason)}</li>`).join('') || '<li class="muted">暂无余额流水。扫码充值后站长核验通过自动到账。</li>'}</ul>
    </section>`;
  } else if (tab === 'orders') {
    const q = String(c.req.query('q') || '').trim();
    const { results: orders } = q
      ? await c.env.DB.prepare('SELECT * FROM orders WHERE user_id=? AND order_no LIKE ? ORDER BY created_at DESC LIMIT 50').bind(user.id, `%${q}%`).all()
      : await c.env.DB.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all();
    section = `<section class="card"><h2>订单</h2>
      <p class="muted">免费领取（脚本 / 部署 / 工具）也会生成一笔 0 元订单，这里和后台都能查到。虚拟资源不支持退款。</p>
      <form class="order-search" method="get" action="/me"><input type="hidden" name="tab" value="orders"><input name="q" placeholder="按订单号搜索" value="${escapeHtml(q)}"><button type="submit">搜索</button></form>
      <ul class="order-list">${orders.map((o) => `<li><a href="/orders/${o.id}">${escapeHtml(o.order_no)}</a> · ${escapeHtml(o.product_name)} · ¥${(o.paid_cents / 100).toFixed(2)} · ${o.status === 'success' ? '交易成功' : o.status === 'pending' ? '待审核' : o.status === 'cancelled' ? '已取消' : '已拒绝'} · ${escapeHtml(o.created_at)}${o.status === 'pending' ? ` <button type="button" data-cancel-order="${o.id}">取消</button>` : ''}</li>`).join('') || '<li class="muted">暂无订单。</li>'}</ul>
      <script>document.querySelectorAll('[data-cancel-order]').forEach(b=>b.onclick=async()=>{if(!confirm('确定取消这笔待审核订单吗？'))return;const r=await fetch('/api/orders/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:Number(b.dataset.cancelOrder)})});const d=await r.json().catch(()=>({}));alert(d.ok?'已取消':(d.error||'取消失败'));if(d.ok)location.reload();});</script>
    </section>`;
  } else if (tab === 'comments') {
    const { results } = await c.env.DB.prepare(
      `SELECT cm.*, a.title AS article_title, a.slug AS article_slug FROM comments cm
       JOIN articles a ON a.id=cm.article_id WHERE cm.user_id=? ORDER BY cm.created_at DESC LIMIT 50`
    ).bind(user.id).all();
    section = `<section class="card"><h2>我的评论</h2>
      <ul>${results.map((r) => `<li><a href="/article/${escapeHtml(r.article_slug)}">${escapeHtml(r.article_title)}</a> · ${r.status === 'approved' ? '已显示' : r.status === 'pending' ? '待审核' : '已拒绝'}<br>${escapeHtml(r.content)}</li>`).join('') || '<li class="muted">暂无评论。</li>'}</ul>
    </section>`;
  } else if (tab === 'likes') {
    const { results } = await c.env.DB.prepare(
      `SELECT a.slug, a.title FROM likes l JOIN articles a ON a.id=l.article_id
       WHERE l.user_id=? ORDER BY l.created_at DESC LIMIT 50`
    ).bind(user.id).all();
    section = `<section class="card"><h2>我的点赞</h2>
      <ul>${results.map((r) => `<li><a href="/article/${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a></li>`).join('') || '<li class="muted">暂无点赞，去文章里点个赞吧。</li>'}</ul>
    </section>`;
  } else if (tab === 'favorites') {
    const { results } = await c.env.DB.prepare(
      `SELECT a.slug, a.title FROM favorites f JOIN articles a ON a.id=f.article_id
       WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT 50`
    ).bind(user.id).all();
    section = `<section class="card"><h2>我的收藏</h2>
      <ul>${results.map((r) => `<li><a href="/article/${escapeHtml(r.slug)}">${escapeHtml(r.title)}</a></li>`).join('') || '<li class="muted">暂无收藏，看到喜欢的技术文章就收藏起来下次继续学。</li>'}</ul>
    </section>`;
  } else if (tab === 'member') {
    const tools = await freeToolsUsed(c.env.DB, user.id, membership);
    const scriptQ = await freeScriptQuota(c.env.DB, user.id, membership);
    const deployQ = await deployQuota(c.env.DB, user.id, membership);
    const { results: myDeploys } = await c.env.DB.prepare(
      "SELECT * FROM orders WHERE user_id=? AND product_type='free_deploy' ORDER BY created_at DESC LIMIT 5"
    ).bind(user.id).all();
    section = `<section class="card"><h2>会员</h2>
      ${membership
        ? `<p>当前：<strong>${escapeHtml(membership.plan_name)}</strong>，到期 ${escapeHtml(membership.expires_at)}（${membership.isYearly ? '年费' : '月费'}）</p>
      <p class="muted">续费从到期那天往后延；到期前 7 天会发邮件提醒；到期后权限收回变回普通用户，之前的购买/兑换/下载记录保留可查。</p>
      <ul>
        <li>免积分工具：本周期已用 ${tools.used}/${tools.limit} 份${tools.unlimited ? '（年费不限）' : ''}</li>
        <li>免费脚本：本月已领 ${scriptQ.used}/${scriptQ.limit} 份${scriptQ.unlimited ? '（年费不限）' : ''}</li>
        <li>免费部署：本周期已用 ${deployQ.used}/${deployQ.limit} 次（${membership.isYearly ? '每两个月 1 次' : '每月 1 次'}）</li>
      </ul>
      <h3>我的部署申请</h3>
      <ul>${(myDeploys || []).map((o) => `<li><a href="/orders/${o.id}">${escapeHtml(o.order_no)}</a> · ${escapeHtml(o.device_type || '')} · ${{ pending: '待处理', processing: '处理中', completed: '已完成' }[o.deploy_status] || ''}</li>`).join('') || '<li class="muted">暂无部署申请。</li>'}</ul>`
        : '<p>当前：普通用户（未开通会员）</p>'}
      <p><a class="btn-gold" href="/member">查看会员 / 开通 / 续费</a></p>
      <p class="muted small">虚拟资源不支持退款。QQ 会员群：13916509（开通后站长私下拉群）。</p>
    </section>`;
  }

  const body = `<h1>我的</h1>
  <section class="card me-top">
    <img class="me-avatar-img large" src="${escapeHtml(pub.avatar_url || '')}" alt="${escapeHtml(pub.username)}" width="64" height="64" onerror="this.onerror=null;this.src='/assets/logo/logo.webp'">
    <div>
      <strong>${escapeHtml(pub.username)}</strong>${pub.is_admin ? ' 👑 站长' : ''}
      <p class="muted">余额 ¥${(pub.balance_cents / 100).toFixed(2)} · 积分 ${pub.points} · 个性签名：${escapeHtml(pub.signature || '未填写')} · 来本站已经 ${daysSince(pub.created_at)} 天了</p>
    </div>
    <button type="button" data-logout style="margin-left:auto">退出登录</button>
  </section>
  ${tabsHtml}
  ${section}
  <script src="/js/me.js" defer></script>`;
  return c.html(pageHTML({ title: '我的', active: '/me', bottomActive: 'me', body, user: pub }));
});

// 保存签名 / 性别（性别每月限改 1 次，按自然月计数）
meRoutes.post('/api/me/profile', async (c) => {
  if (!c.env.DB) return c.json({ ok: false, error: '数据库未就绪' }, 503);
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) return c.json({ ok: false, error: '请先登录' }, 401);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  if (!user) return c.json({ ok: false, error: '请先登录' }, 401);
  const { signature, gender } = await c.req.json().catch(() => ({}));
  if (gender && !['男', '女', '保密'].includes(gender)) return c.json({ ok: false, error: '性别不对' }, 400);
  if (gender && gender !== user.gender) {
    const last = user.gender_changed_at ? new Date(String(user.gender_changed_at).replace(' ', 'T') + 'Z') : null;
    const now = new Date();
    if (last && last.getUTCFullYear() === now.getUTCFullYear() && last.getUTCMonth() === now.getUTCMonth()) {
      return c.json({ ok: false, error: '性别每月只能改 1 次，下个月再改吧' }, 400);
    }
    await c.env.DB.prepare("UPDATE users SET gender=?, gender_changed_at=datetime('now') WHERE id=?").bind(gender, user.id).run();
  }
  if (typeof signature === 'string') {
    await c.env.DB.prepare('UPDATE users SET signature=? WHERE id=?').bind(String(signature).slice(0, 60), user.id).run();
  }
  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
  return c.json({ ok: true, user: publicUser(fresh) });
});
