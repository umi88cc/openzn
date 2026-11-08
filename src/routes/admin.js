// AI指南 — 后台页面（v5，第三期完整版）
// 7 大分类：基本设置、分类管理、文章管理、用户管理、会员管理、订单管理、财富管理。
// 手机优先：顶部可折叠菜单 + 首页九宫格，不用 7 个底部 tab；
// 表格在手机上变卡片，按钮够大，搜索框放最上面，输入框够大不挤。
// 站长锁死 QQ 446099815 + qq446099815@gmail.com；站长后台时效 7 天。
import { Hono } from 'hono';
import { pageHTML } from '../lib/render.js';
import { requireAdminPage, getSetting, esc } from '../lib/admin.js';
import { SITE, RECHARGE_TIERS } from '../lib/config.js';
import { SHORTCUTS } from '../lib/shortcodes.js';
import { listAIModels, getAISettings, AI_SWITCHES, getChatbotSettings, getAutoReplies, listChatLogsAdmin } from '../lib/ai.js';

export const adminRoutes = new Hono();

const SECTIONS = [
  { id: 'settings', label: '基本设置', icon: '⚙️', href: '/admin/settings' },
  { id: 'categories', label: '分类管理', icon: '🗂️', href: '/admin/categories' },
  { id: 'articles', label: '文章管理', icon: '📝', href: '/admin/articles' },
  { id: 'users', label: '用户管理', icon: '👥', href: '/admin/users' },
  { id: 'members', label: '会员管理', icon: '👑', href: '/admin/members' },
  { id: 'orders', label: '订单管理', icon: '🧾', href: '/admin/orders' },
  { id: 'wealth', label: '财富管理', icon: '💰', href: '/admin/wealth' },
  { id: 'comments', label: '评论审核', icon: '💬', href: '/admin/comments' },
  { id: 'ai', label: '智能管理', icon: '🤖', href: '/admin/ai' },
];

function adminHead() {
  return `<link rel="stylesheet" href="/css/admin.css">`;
}
function adminScript() {
  return `<script src="/js/admin.js" defer></script>`;
}

// 后台外壳：顶部可折叠菜单（手机默认收起，点“☰ 菜单”展开）+ 面包屑 + 回前端
function shell(active, pendingCount, body) {
  const menu = SECTIONS.map((s) =>
    `<a class="admin-menu-item${active === s.id ? ' active' : ''}" href="${s.href}">${s.icon} ${s.label}</a>`).join('');
  return `
  <div class="admin-bar">
    <button type="button" class="admin-menu-btn" id="adminMenuBtn" aria-expanded="false">☰ 菜单</button>
    <strong class="admin-title">后台管理</strong>
    <a class="admin-front" href="/">← 回前端</a>
    ${pendingCount ? `<a class="admin-bell" href="/admin/orders?q=&status=pending" title="待审核订单">🔔 <span class="admin-dot">${pendingCount}</span></a>` : ''}
  </div>
  <nav class="admin-menu" id="adminMenu" hidden>${menu}</nav>
  ${body}${adminScript()}`;
}

async function pendingOrders(db) {
  if (!db) return 0;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status='pending'").bind().first();
  return row?.n || 0;
}

async function guard(c) {
  const { admin, errorPage } = await requireAdminPage(c);
  if (errorPage) {
    return { admin: null, err: c.html(pageHTML({ title: '后台管理', active: '/', bottomActive: 'me', body: `<h1>后台管理</h1><p class="muted">${esc(errorPage.body)}</p><p><a href="/">← 回首页</a></p>` }), errorPage.status) };
  }
  return { admin, err: null };
}

function page(c, admin, active, pending, title, body) {
  return c.html(pageHTML({ title, active: '/', bottomActive: 'me', body: shell(active, pending, body), extraHead: adminHead(), user: admin }));
}

// ---------- 仪表盘：九宫格 + 今日数据 + 待审核提醒 ----------
adminRoutes.get('/admin', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const today = new Date().toISOString().slice(0, 10);
  const counts = {};
  if (db) {
    const q = async (sql) => (await db.prepare(sql).bind().first())?.n || 0;
    counts.usersToday = await q(`SELECT COUNT(*) AS n FROM users WHERE date(created_at)=date('now')`);
    counts.usersTotal = await q('SELECT COUNT(*) AS n FROM users');
    counts.checkinToday = await q(`SELECT COUNT(*) AS n FROM checkins WHERE check_date=date('now','+8 hours')`);
    counts.incomeToday = await q(`SELECT COALESCE(SUM(paid_cents),0) AS n FROM orders WHERE status='success' AND date(created_at)=date('now')`);
    counts.pendingComments = await q(`SELECT COUNT(*) AS n FROM comments WHERE status='pending'`);
    counts.members = await q(`SELECT COUNT(*) AS n FROM memberships WHERE status='active' AND expires_at > datetime('now')`);
    counts.articles = await q(`SELECT COUNT(*) AS n FROM articles WHERE status='published'`);
  }
  const grid = SECTIONS.map((s) => `<a class="admin-grid-item" href="${s.href}"><span class="grid-icon">${s.icon}</span><span>${s.label}</span></a>`).join('');
  const body = `<h1>后台管理</h1>
  <p class="muted">站长：${esc(admin.username)}（QQ ${esc(admin.qq)}）· 仅站长可进 · <a href="/me">个人中心</a></p>
  ${pending ? `<p class="admin-alert">🔔 有 <strong>${pending}</strong> 笔待审核订单，<a href="/admin/orders?status=pending">去审核 →</a></p>` : '<p class="admin-ok">✅ 暂无待审核订单。</p>'}
  <section class="card admin-stats">
    <h2>今日概况</h2>
    <div class="stat-grid">
      <div><strong>${counts.usersToday ?? 0}</strong><span>今日新增用户</span></div>
      <div><strong>${counts.checkinToday ?? 0}</strong><span>今日签到人数</span></div>
      <div><strong>¥${(((counts.incomeToday ?? 0)) / 100).toFixed(2)}</strong><span>今日收入</span></div>
      <div><strong>${counts.pendingComments ?? 0}</strong><span>待审核评论</span></div>
      <div><strong>${counts.members ?? 0}</strong><span>有效会员</span></div>
      <div><strong>${counts.usersTotal ?? 0}</strong><span>注册用户总数</span></div>
    </div>
  </section>
  <div class="admin-grid">${grid}</div>`;
  return page(c, admin, '', pending, '后台管理', body);
});

// ---------- 基本设置 ----------
adminRoutes.get('/admin/settings', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const keys = ['site_name', 'site_domain', 'notify_email', 'notify_email_backup', 'qq_group', 'announcement', 'checkin_min', 'checkin_max', 'tool_points_min', 'tool_points_max', 'nav_items', 'about_lines', 'banned_words', 'resend_from', 'no_refund_notice'];
  const vals = {};
  for (const k of keys) vals[k] = await getSetting(db, k, k === 'site_name' ? SITE.name : k === 'site_domain' ? SITE.domain : k === 'notify_email' ? SITE.notifyEmail : k === 'notify_email_backup' ? SITE.notifyEmailBackup : k === 'qq_group' ? SITE.qqGroup : k === 'checkin_min' ? '5' : k === 'checkin_max' ? '15' : k === 'tool_points_min' ? '10' : k === 'tool_points_max' ? '20' : k === 'nav_items' ? '[{"label":"首页","href":"/"},{"label":"文章","href":"/articles"},{"label":"会员","href":"/member"},{"label":"我的","href":"/me"},{"label":"智能简介","href":"/category/intro"},{"label":"部署教程","href":"/category/deploy"}]' : k === 'about_lines' ? JSON.stringify(SITE.aboutLines) : k === 'no_refund_notice' ? '虚拟资源不支持退款：用户付款后即视为同意部署服务或已看中该商品。' : '');
  const body = `<h1>⚙️ 基本设置</h1>
  <form id="settingsForm" class="admin-form">
    <label>站点名<input name="site_name" value="${esc(vals.site_name)}"></label>
    <label>域名<input name="site_domain" value="${esc(vals.site_domain)}"></label>
    <label>通知邮箱（主用）<input name="notify_email" type="email" value="${esc(vals.notify_email)}"></label>
    <label>通知邮箱（备用）<input name="notify_email_backup" type="email" value="${esc(vals.notify_email_backup)}"></label>
    <label>QQ 会员群号<input name="qq_group" value="${esc(vals.qq_group)}"></label>
    <label>公告<textarea name="announcement" rows="2">${esc(vals.announcement)}</textarea></label>
    <label>签到奖励（积分）<span class="form-row"><input name="checkin_min" type="number" value="${esc(vals.checkin_min)}" min="1"> ~ <input name="checkin_max" type="number" value="${esc(vals.checkin_max)}" min="1"></span></label>
    <label>工具积分价区间<span class="form-row"><input name="tool_points_min" type="number" value="${esc(vals.tool_points_min)}" min="1"> ~ <input name="tool_points_max" type="number" value="${esc(vals.tool_points_max)}" min="1"></span></label>
    <label>导航栏（JSON 数组，label + href）<textarea name="nav_items" rows="3">${esc(vals.nav_items)}</textarea></label>
    <label>关于本站 4 句（JSON 数组）<textarea name="about_lines" rows="2">${esc(vals.about_lines)}</textarea></label>
    <label>违规词表（逗号分隔：黄赌毒、法轮功、共产党等）<textarea name="banned_words" rows="3" placeholder="黄赌毒，法轮功，共产党">${esc(vals.banned_words)}</textarea></label>
    <label>发件人（Resend，如 AI指南 &lt;noreply@openzn.cc&gt;；API Key 用 wrangler secret 设置，不存在这里）<input name="resend_from" value="${esc(vals.resend_from)}" placeholder="AI指南 <onboarding@resend.dev>"></label>
    <label>不支持退款说明<textarea name="no_refund_notice" rows="2">${esc(vals.no_refund_notice)}</textarea></label>
    <button type="submit" class="btn-primary admin-big-btn">保存基本设置</button>
    <span class="muted small" id="settingsMsg"></span>
  </form>
  <section class="card"><h2>收款码 / 咨询二维码</h2>
    <p class="muted">收款码（支付宝商家码 AI指南、微信商家码 优米博客）和咨询二维码已放在 public/assets/qr/，更换时直接替换同名文件即可；也可以把新图传到 R2 图库后在编辑器里引用。</p>
    <div class="pay-qrs">
      <figure><img src="/assets/qr/alipay-pay-qr.png" alt="支付宝收款码" width="120" height="120"><figcaption>支付宝收款码</figcaption></figure>
      <figure><img src="/assets/qr/wechat-pay-qr.png" alt="微信收款码" width="120" height="120"><figcaption>微信收款码</figcaption></figure>
      <figure><img src="/assets/qr/qq-consult-qr.png" alt="QQ 咨询码" width="120" height="120"><figcaption>QQ 咨询码</figcaption></figure>
      <figure><img src="/assets/qr/wechat-consult-qr.png" alt="微信咨询码" width="120" height="120"><figcaption>微信咨询码</figcaption></figure>
    </div>
  </section>
  <section class="card"><h2>部署提醒</h2>
    <p class="muted">D1 / KV / R2 都在 wrangler.toml 里配；发信密钥用 <code>npx wrangler secret put RESEND_API_KEY</code> 设置。到期提醒定时任务每天 09:00（上海）自动跑，也可以在会员管理里手动触发。</p>
    <p><button type="button" class="btn-primary" data-expiry-remind>立即扫描到期提醒（7 天内到期）</button> <span class="muted small" id="remindMsg"></span></p>
  </section>`;
  return page(c, admin, 'settings', pending, '基本设置', body);
});

// ---------- 分类管理 ----------
adminRoutes.get('/admin/categories', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const { results } = await db.prepare(
    `SELECT cat.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id=cat.id) AS article_count FROM categories cat ORDER BY sort_order ASC`
  ).all();
  const rows = (results || []).map((r) => `<tr>
    <td data-label="分类">${esc(r.name)} <span class="muted small">/${esc(r.slug)}</span></td>
    <td data-label="权限">${{ free: '免费', reply: '回复可见', points: '积分兑换', member: '会员专享' }[r.visibility] || r.visibility}</td>
    <td data-label="排序">${r.sort_order}</td>
    <td data-label="文章数">${r.article_count}</td>
    <td data-label="显示">${r.is_visible ? '显示' : '隐藏'}</td>
    <td data-label="操作" class="row-actions">
      <button type="button" class="mini-btn" data-cat-edit='${JSON.stringify(r)}'>编辑</button>
      <button type="button" class="mini-btn danger" data-cat-del="${r.id}" data-cat-count="${r.article_count}" data-cat-name="${esc(r.name)}">删除</button>
    </td></tr>`).join('');
  const body = `<h1>🗂️ 分类管理</h1>
  <p class="muted">11 个分类：智能简介、部署教程、环境配置、专属命令、提示词汇、模型接入、部署脚本、工具下载、会员专属、踩坑经历、常见问题。删除有文章的分类时，先把文章移到别的分类。</p>
  <section class="card"><h2>新建分类</h2>
    <form id="catNewForm" class="admin-form inline">
      <input name="name" placeholder="分类名（四字，如 智能简介）" required maxlength="20">
      <input name="description" placeholder="描述" maxlength="200">
      <select name="visibility"><option value="free">免费</option><option value="reply">回复可见</option><option value="points">积分兑换</option><option value="member">会员专享</option></select>
      <input name="sort_order" type="number" value="99" min="0">
      <button type="submit" class="btn-primary">新建</button>
    </form>
  </section>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>分类</th><th>权限</th><th>排序</th><th>文章数</th><th>显示</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>
  <dialog id="catEditDialog" class="admin-dialog"><form id="catEditForm" class="admin-form" method="dialog">
    <h2>编辑分类</h2><input type="hidden" name="id">
    <label>名称<input name="name" required maxlength="20"></label>
    <label>描述<input name="description" maxlength="200"></label>
    <label>权限<select name="visibility"><option value="free">免费</option><option value="reply">回复可见</option><option value="points">积分兑换</option><option value="member">会员专享</option></select></label>
    <label>排序<input name="sort_order" type="number" min="0"></label>
    <label>显示<select name="is_visible"><option value="1">显示</option><option value="0">隐藏</option></select></label>
    <button type="submit" class="btn-primary admin-big-btn">保存</button>
    <button type="button" class="mini-btn" data-close-dialog>取消</button>
  </form></dialog>`;
  return page(c, admin, 'categories', pending, '分类管理', body);
});

// ---------- 文章管理 ----------
adminRoutes.get('/admin/articles', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const q = String(c.req.query('q') || '').trim();
  const { results } = q
    ? await db.prepare(`SELECT a.*, cat.name AS category_name FROM articles a JOIN categories cat ON cat.id=a.category_id WHERE a.title LIKE ? ORDER BY a.created_at DESC LIMIT 100`).bind(`%${q}%`).all()
    : await db.prepare(`SELECT a.*, cat.name AS category_name FROM articles a JOIN categories cat ON cat.id=a.category_id ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 100`).all();
  const rows = (results || []).map((r) => `<tr>
    <td data-label="标题"><a href="/article/${esc(r.slug)}" target="_blank">${esc(r.title)}</a>${r.is_pinned ? ' 📌置顶' : ''}</td>
    <td data-label="分类">${esc(r.category_name)}</td>
    <td data-label="状态">${r.status === 'published' ? '已发布' : r.status === 'draft' ? '草稿' : '已下架'}</td>
    <td data-label="数据">👁${r.views} 👍${r.likes_count} 💬${r.comments_count} ⭐${r.favorites_count}</td>
    <td data-label="操作" class="row-actions">
      <a class="mini-btn" href="/admin/articles/${r.id}/edit">编辑</a>
      <button type="button" class="mini-btn" data-article-pin="${r.id}">${r.is_pinned ? '取消顶置' : '顶置'}</button>
      <button type="button" class="mini-btn danger" data-article-del="${r.id}">删除</button>
    </td></tr>`).join('');
  const body = `<h1>📝 文章管理</h1>
  <form class="admin-search" method="get" action="/admin/articles"><input name="q" placeholder="搜文章标题…" value="${esc(q)}"><button type="submit">搜索</button></form>
  <p><a class="btn-primary admin-big-btn" href="/admin/articles/new">＋ 写新文章</a> <span class="muted small">全局顶置最多 3 篇，顶满需先取消一篇。</span></p>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>标题</th><th>分类</th><th>状态</th><th>数据</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">暂无文章。</td></tr>'}</tbody></table></div>`;
  return page(c, admin, 'articles', pending, '文章管理', body);
});

// 文章编辑器：6 个快捷命令 + 图片插入（远程 URL / R2 图库）+ AI 润色（第四期补全，开关关着不显示）
function editorPage(c, admin, pending, article, categories, polishEnabled = false) {
  const isNew = !article;
  const shortcuts = SHORTCUTS.map((s) => `<button type="button" class="shortcut-btn" data-shortcut='${esc(s.insert)}'>${esc(s.label)}</button>`).join('');
  const polishBox = polishEnabled ? `<section class="card polish-box">
    <h2>✨ AI 润色（只建议，不自动改原文）</h2>
    <p class="muted small">在正文里选中一段文字，只润色选中的；没选就润色整篇正文。结果先放下面预览框，满意点“采用”才替换进编辑器，点“不用”就丢掉。</p>
    <div class="polish-actions">
      <button type="button" class="mini-btn" data-polish-mode="polish">✨ 润色</button>
      <button type="button" class="mini-btn" data-polish-mode="expand">📝 扩写</button>
      <button type="button" class="mini-btn" data-polish-mode="shorten">✂️ 精简</button>
      <button type="button" class="mini-btn" data-polish-mode="title">🏷️ 换标题</button>
      <button type="button" class="mini-btn" data-polish-mode="check">🔍 检查错别字</button>
    </div>
    <label>预览（AI 建议，先看再决定）<textarea id="polishPreview" rows="6" readonly placeholder="点上面任一按钮后，AI 的建议会出现在这里。"></textarea></label>
    <div class="polish-actions">
      <button type="button" class="btn-primary" id="polishApplyBtn" disabled>✅ 采用（替换进编辑器）</button>
      <button type="button" class="mini-btn" id="polishDiscardBtn" disabled>🗑️ 不用</button>
      <span class="muted small" id="polishMsg"></span>
    </div>
  </section>` : '';
  const body = `<h1>${isNew ? '＋ 写新文章' : '编辑文章'}</h1>
  <form id="articleForm" class="admin-form editor-form">
    <input type="hidden" name="id" value="${article?.id || ''}">
    <label>标题<input name="title" required maxlength="120" value="${esc(article?.title || '')}"></label>
    <label>分类<select name="category_id">${categories.map((cat) => `<option value="${cat.id}"${article?.category_id === cat.id ? ' selected' : ''}>${esc(cat.name)}</option>`).join('')}</select></label>
    <label>标签（OpenClaw / Hermes）<select name="tag"><option value="">无</option><option${article?.tag === 'OpenClaw' ? ' selected' : ''}>OpenClaw</option><option${article?.tag === 'Hermes' ? ' selected' : ''}>Hermes</option></select></label>
    <label>摘要<textarea name="summary" rows="2" maxlength="300">${esc(article?.summary || '')}</textarea></label>
    <div class="shortcuts" aria-label="快捷命令">${shortcuts}
      <button type="button" class="shortcut-btn" id="imgInsertBtn">🖼️ 插入图片</button>
    </div>
    <label>正文（Markdown + 快捷命令）<textarea id="contentEditor" name="content" rows="18">${esc(article?.content || '')}</textarea></label>
    ${polishBox}
    <label>隐藏段内容（不参与搜索）<textarea name="hidden_content" rows="3">${esc(article?.hidden_content || '')}</textarea></label>
    <label>可见性<select name="visibility">
      <option value="free"${article?.visibility === 'free' ? ' selected' : ''}>免费</option>
      <option value="reply"${article?.visibility === 'reply' ? ' selected' : ''}>回复可见</option>
      <option value="points"${article?.visibility === 'points' ? ' selected' : ''}>积分兑换</option>
      <option value="member"${article?.visibility === 'member' ? ' selected' : ''}>会员专享</option></select></label>
    <label>积分价（积分可见时，10~20）<input name="points_price" type="number" min="0" max="20" value="${article?.points_price || 20}"></label>
    <label>脚本价格（元，部署脚本类文章用，余额购买；0 表示未定价）<input name="script_price" type="number" min="0" step="0.01" placeholder="如 9.9"></label>
    <label>状态<select name="status"><option value="published"${article?.status === 'published' ? ' selected' : ''}>发布</option><option value="draft"${article?.status === 'draft' ? ' selected' : ''}>草稿</option><option value="offline"${article?.status === 'offline' ? ' selected' : ''}>下架</option></select></label>
    <button type="submit" class="btn-primary admin-big-btn">${isNew ? '发布文章' : '保存修改'}</button>
    <span class="muted small" id="articleMsg"></span>
  </form>
  <dialog id="imgDialog" class="admin-dialog"><form method="dialog" class="admin-form" id="imgForm">
    <h2>插入图片</h2>
    <p class="muted small">远程图片直接贴地址；图库图片先上传到 R2 再选。插入后自适应显示，别人只能看不能下载（右键/拖拽/长按已禁，水印 AI指南 · openzn.cc）。</p>
    <label>远程图片地址<input name="remote_url" placeholder="https://…/xxx.png"></label>
    <button type="button" class="btn-primary admin-big-btn" id="imgRemoteBtn">插入远程图片</button>
    <h3>我的图库（R2）</h3>
    <div id="imgGallery" class="img-gallery"><p class="muted">加载中…</p></div>
    <label>上传新图到图库<input type="file" id="imgUpload" accept="image/*"></label>
    <button type="button" class="mini-btn" data-close-dialog>关闭</button>
  </form></dialog>
  <p><a href="/admin/articles">← 回文章管理</a></p>`;
  return page(c, admin, 'articles', pending, isNew ? '写新文章' : '编辑文章', body);
}

adminRoutes.get('/admin/articles/new', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const { results: categories } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();
  const settings = await getAISettings(c.env.DB);
  return editorPage(c, admin, await pendingOrders(c.env.DB), null, categories || [], !!settings.ai_polish);
});

adminRoutes.get('/admin/articles/:id/edit', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const article = await c.env.DB.prepare('SELECT * FROM articles WHERE id=?').bind(Number(c.req.param('id'))).first();
  if (!article) return c.notFound();
  const { results: categories } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();
  const settings = await getAISettings(c.env.DB);
  return editorPage(c, admin, await pendingOrders(c.env.DB), article, categories || [], !!settings.ai_polish);
});

// ---------- 评论审核 ----------
adminRoutes.get('/admin/comments', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const status = c.req.query('status') || 'pending';
  const { results } = await db.prepare(
    `SELECT cm.*, a.title AS article_title, a.slug AS article_slug, u.username FROM comments cm
     JOIN articles a ON a.id=cm.article_id JOIN users u ON u.id=cm.user_id
     WHERE cm.status=? ORDER BY cm.created_at DESC LIMIT 100`
  ).bind(status).all();
  const rows = (results || []).map((r) => `<tr>
    <td data-label="评论">${esc(r.content)}<br><span class="muted small">${esc(r.username)} · <a href="/article/${esc(r.article_slug)}" target="_blank">${esc(r.article_title)}</a> · ${esc(r.created_at)}</span></td>
    <td data-label="状态">${r.status === 'approved' ? '已显示' : r.status === 'pending' ? '待审核' : '已拒绝'}</td>
    <td data-label="操作" class="row-actions">
      ${r.status !== 'approved' ? `<button type="button" class="mini-btn" data-comment="approve" data-id="${r.id}">通过</button>` : ''}
      ${r.status !== 'rejected' ? `<button type="button" class="mini-btn danger" data-comment="reject" data-id="${r.id}">拒绝</button>` : ''}
      <button type="button" class="mini-btn" data-comment-reply="${r.id}">回复</button>
      <button type="button" class="mini-btn danger" data-comment="delete" data-id="${r.id}">删除</button>
      <button type="button" class="mini-btn danger" data-comment="ban" data-id="${r.id}">封禁用户</button>
    </td></tr>`).join('');
  const body = `<h1>💬 评论审核</h1>
  <p class="muted">干净的评论直接显示；含违规词（黄赌毒、法轮功、共产党等）和站外链接的先进待审核，通过才显示。</p>
  <div class="tag-filter"><a href="/admin/comments?status=pending" class="${status === 'pending' ? 'active' : ''}">待审核</a><a href="/admin/comments?status=approved" class="${status === 'approved' ? 'active' : ''}">已显示</a><a href="/admin/comments?status=rejected" class="${status === 'rejected' ? 'active' : ''}">已拒绝</a></div>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>评论</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">暂无评论。</td></tr>'}</tbody></table></div>`;
  return page(c, admin, 'comments', pending, '评论审核', body);
});

// ---------- 用户管理 ----------
adminRoutes.get('/admin/users', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const q = String(c.req.query('q') || '').trim();
  const { results } = q
    ? await db.prepare(`SELECT * FROM users WHERE username LIKE ? OR email LIKE ? OR CAST(id AS TEXT)=? ORDER BY created_at DESC LIMIT 100`).bind(`%${q}%`, `%${q}%`, q).all()
    : await db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 100').all();
  const rows = (results || []).map((r) => `<tr>
    <td data-label="用户">${esc(r.username)}${r.is_admin ? ' 👑站长' : ''}${r.is_banned ? ' 🚫已封禁' : ''}<br><span class="muted small">UID ${r.id} · ${esc(r.email)}</span></td>
    <td data-label="QQ / 微信">${esc(r.qq)} / ${esc(r.wechat || '—')}</td>
    <td data-label="财富">余额 ¥${(r.balance_cents / 100).toFixed(2)} · 积分 ${r.points}</td>
    <td data-label="注册">${esc(r.created_at)}</td>
    <td data-label="操作" class="row-actions"><a class="mini-btn" href="/admin/users/${r.id}">查看 / 管理</a></td></tr>`).join('');
  const body = `<h1>👥 用户管理</h1>
  <form class="admin-search" method="get" action="/admin/users"><input name="q" placeholder="搜 UID / 用户名 / 邮箱…" value="${esc(q)}"><button type="submit">搜索</button></form>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>QQ / 微信</th><th>财富</th><th>注册</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">暂无用户。</td></tr>'}</tbody></table></div>`;
  return page(c, admin, 'users', pending, '用户管理', body);
});

adminRoutes.get('/admin/users/:id', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const user = await db.prepare('SELECT * FROM users WHERE id=?').bind(Number(c.req.param('id'))).first();
  if (!user) return c.notFound();
  const [likes, comments, favorites, orders, logs, memberships] = await Promise.all([
    db.prepare(`SELECT a.title, a.slug, l.created_at FROM likes l JOIN articles a ON a.id=l.article_id WHERE l.user_id=? ORDER BY l.created_at DESC LIMIT 20`).bind(user.id).all(),
    db.prepare(`SELECT cm.content, cm.status, a.title FROM comments cm JOIN articles a ON a.id=cm.article_id WHERE cm.user_id=? ORDER BY cm.created_at DESC LIMIT 20`).bind(user.id).all(),
    db.prepare(`SELECT a.title, a.slug FROM favorites f JOIN articles a ON a.id=f.article_id WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT 20`).bind(user.id).all(),
    db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all(),
    db.prepare('SELECT * FROM wallet_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(user.id).all(),
    db.prepare(`SELECT m.*, p.name AS plan_name FROM memberships m JOIN membership_plans p ON p.id=m.plan_id WHERE m.user_id=? ORDER BY m.created_at DESC LIMIT 10`).bind(user.id).all(),
  ]);
  const body = `<h1>用户：${esc(user.username)}${user.is_admin ? ' 👑站长' : ''}</h1>
  <section class="card"><h2>资料</h2>
    <p>UID ${user.id} · 账号 ${esc(user.username)}（不可改）· 注册 ${esc(user.created_at)}</p>
    <p>邮箱 ${esc(user.email)}（不可改）· 性别 ${esc(user.gender)} · 签名 ${esc(user.signature || '—')}</p>
    <p>余额 ¥${(user.balance_cents / 100).toFixed(2)} · 积分 ${user.points} · 状态 ${user.is_banned ? '🚫 已封禁（不能登录，会员时间照走）' : '正常'}</p>
    <form id="userEditForm" class="admin-form inline" data-user-id="${user.id}">
      <label>QQ<input name="qq" value="${esc(user.qq)}"></label>
      <label>微信<input name="wechat" value="${esc(user.wechat || '')}"></label>
      <button type="submit" class="btn-primary">保存 QQ / 微信</button>
    </form>
    <div class="row-actions">
      ${user.is_banned ? `<button type="button" class="mini-btn" data-user-action="unban" data-id="${user.id}">解封</button>` : `<button type="button" class="mini-btn danger" data-user-action="ban" data-id="${user.id}">封禁</button>`}
      <button type="button" class="mini-btn" data-user-reset="${user.id}">重置密码</button>
      ${user.is_admin ? '' : `<button type="button" class="mini-btn danger" data-user-action="delete" data-id="${user.id}">删除用户</button>`}
    </div>
    <span class="muted small" id="userMsg"></span>
  </section>
  <section class="card"><h2>会员记录</h2><ul>${(memberships.results || []).map((m) => `<li>${esc(m.plan_name)} · ${esc(m.starts_at)} → ${esc(m.expires_at)} · ${m.status}</li>`).join('') || '<li class="muted">无会员记录。</li>'}</ul></section>
  <section class="card"><h2>点赞 / 评论 / 收藏</h2>
    <h3>点赞</h3><ul>${(likes.results || []).map((r) => `<li><a href="/article/${esc(r.slug)}">${esc(r.title)}</a> · ${esc(r.created_at)}</li>`).join('') || '<li class="muted">无。</li>'}</ul>
    <h3>评论</h3><ul>${(comments.results || []).map((r) => `<li>${esc(r.content)}（${r.status}）· ${esc(r.title)}</li>`).join('') || '<li class="muted">无。</li>'}</ul>
    <h3>收藏</h3><ul>${(favorites.results || []).map((r) => `<li><a href="/article/${esc(r.slug)}">${esc(r.title)}</a></li>`).join('') || '<li class="muted">无。</li>'}</ul>
  </section>
  <section class="card"><h2>订单 / 财富流水</h2>
    <ul>${(orders.results || []).map((o) => `<li><a href="/admin/orders/${o.id}">${esc(o.order_no)}</a> · ${esc(o.product_name)} · ${o.status}</li>`).join('') || '<li class="muted">无订单。</li>'}</ul>
    <ul>${(logs.results || []).map((l) => `<li>${esc(l.created_at)} · ${l.kind === 'balance' ? `${(l.change_cents / 100).toFixed(2)} 元` : `${l.change_points} 积分`} · ${esc(l.reason)}</li>`).join('') || '<li class="muted">无流水。</li>'}</ul>
  </section>
  <p><a href="/admin/users">← 回用户管理</a></p>`;
  return page(c, admin, 'users', pending, '用户详情', body);
});

// ---------- 会员管理 ----------
adminRoutes.get('/admin/members', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const { results: plans } = await db.prepare('SELECT * FROM membership_plans ORDER BY duration_days ASC').all();
  const { results: members } = await db.prepare(
    `SELECT m.*, u.username, u.qq, p.name AS plan_name FROM memberships m
     JOIN users u ON u.id=m.user_id JOIN membership_plans p ON p.id=m.plan_id
     WHERE m.status='active' AND m.expires_at > datetime('now') ORDER BY m.expires_at ASC LIMIT 100`
  ).all();
  const { results: deploys } = await db.prepare(
    `SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id
     WHERE o.product_type='free_deploy' ORDER BY o.created_at DESC LIMIT 50`
  ).all();
  const planCards = (plans || []).map((p) => `<section class="card"><h2>${esc(p.icon || '')} ${esc(p.name)}</h2>
    <form class="admin-form plan-form" data-plan-id="${p.id}">
      <label>名称<input name="name" value="${esc(p.name)}" maxlength="20"></label>
      <label>价格（分，如 2900 = 29 元；年费后台自定义，0 表示未定价）<input name="price_cents" type="number" min="0" value="${p.price_cents}"></label>
      <label>图标<input name="icon" value="${esc(p.icon || '')}" maxlength="10"></label>
      <label>周期（天）<input name="duration_days" type="number" min="1" value="${p.duration_days}"></label>
      <label>启用<select name="is_active"><option value="1"${p.is_active ? ' selected' : ''}>启用</option><option value="0"${!p.is_active ? ' selected' : ''}>停用</option></select></label>
      <button type="submit" class="btn-primary">保存套餐</button>
    </form></section>`).join('');
  const memberRows = (members || []).map((m) => {
    return `<tr><td data-label="用户">${esc(m.username)}（QQ ${esc(m.qq)}）</td><td data-label="套餐">${esc(m.plan_name)}</td><td data-label="到期">${esc(m.expires_at)}</td>
    <td data-label="操作" class="row-actions"><button type="button" class="mini-btn" data-member-extend="${m.user_id}">延长 30 天</button><button type="button" class="mini-btn danger" data-member-cancel="${m.user_id}">取消会员</button></td></tr>`;
  }).join('');
  const deployRows = (deploys || []).map((o) => `<tr>
    <td data-label="订单"><a href="/admin/orders/${o.id}">${esc(o.order_no)}</a><br><span class="muted small">${esc(o.username)} · ${esc(o.device_type || '')} ${esc(o.system_info || '')} · QQ ${esc(o.contact_qq || '')}</span></td>
    <td data-label="部署状态">${{ pending: '待处理', processing: '处理中', completed: '已完成' }[o.deploy_status] || '—'}</td>
    <td data-label="订单状态">${o.status === 'success' ? '交易成功' : o.status === 'pending' ? '待审核' : o.status}</td>
    <td data-label="操作" class="row-actions">
      ${o.deploy_status === 'pending' ? `<button type="button" class="mini-btn" data-deploy="processing" data-id="${o.id}">接单（处理中）</button>` : ''}
      ${o.deploy_status === 'processing' ? `<button type="button" class="mini-btn" data-deploy="completed" data-id="${o.id}">点完成</button>` : ''}
    </td></tr>`).join('');
  const body = `<h1>👑 会员管理</h1>
  <p class="muted">套餐名称、价格、图标、权限都可自定义，后台设置了前端同步。续费从到期那天往后延；免费额度按 30 天周期刷新。</p>
  <div class="plan-grid">${planCards}</div>
  <section class="card"><h2>手动开通会员</h2>
    <form id="memberGrantForm" class="admin-form inline">
      <input name="user_id" type="number" placeholder="用户 UID" required>
      <select name="plan_id">${(plans || []).map((p) => `<option value="${p.id}">${esc(p.name)}（${p.duration_days} 天）</option>`).join('')}</select>
      <button type="submit" class="btn-primary">手动开通</button>
    </form>
    <p class="muted small">已有有效会员时，从到期日往后延；没有则从现在算。开通后自动发邮件通知用户。</p>
  </section>
  <h2>有效会员列表</h2>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>套餐</th><th>到期</th><th>操作</th></tr></thead><tbody>${memberRows || '<tr><td colspan="4" class="muted">暂无有效会员。</td></tr>'}</tbody></table></div>
  <h2>部署申请（与订单管理同一条数据）</h2>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>订单</th><th>部署状态</th><th>订单状态</th><th>操作</th></tr></thead><tbody>${deployRows || '<tr><td colspan="4" class="muted">暂无部署申请。</td></tr>'}</tbody></table></div>
  <p><button type="button" class="btn-primary" data-expiry-remind>立即扫描到期提醒（7 天内到期）</button> <span class="muted small" id="remindMsg"></span></p>`;
  return page(c, admin, 'members', pending, '会员管理', body);
});

// ---------- 订单管理 ----------
adminRoutes.get('/admin/orders', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const q = String(c.req.query('q') || '').trim();
  const status = c.req.query('status') || '';
  let sql = `SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id`;
  const conds = []; const params = [];
  if (q) { conds.push('o.order_no LIKE ?'); params.push(`%${q}%`); }
  if (status) { conds.push('o.status=?'); params.push(status); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY o.created_at DESC LIMIT 100';
  const { results } = await db.prepare(sql).bind(...params).all();
  const rows = (results || []).map((o) => `<tr>
    <td data-label="订单"><a href="/admin/orders/${o.id}">${esc(o.order_no)}</a><br><span class="muted small">${esc(o.username)} · ${esc(o.created_at)}</span></td>
    <td data-label="商品">${esc(o.product_name)}</td>
    <td data-label="金额">¥${(o.paid_cents / 100).toFixed(2)}${o.credit_cents ? ` → 到账 ¥${(o.credit_cents / 100).toFixed(2)}` : ''}</td>
    <td data-label="状态">${o.status === 'success' ? '交易成功' : o.status === 'pending' ? '待审核' : o.status === 'cancelled' ? '已取消' : '已拒绝'}</td>
    <td data-label="操作" class="row-actions">
      ${o.status === 'pending' ? `<button type="button" class="mini-btn" data-order="approve" data-id="${o.id}">通过</button><button type="button" class="mini-btn danger" data-order="reject" data-id="${o.id}">拒绝</button>` : ''}
      <a class="mini-btn" href="/admin/orders/${o.id}">查看</a>
    </td></tr>`).join('');
  const body = `<h1>🧾 订单管理</h1>
  <form class="admin-search" method="get" action="/admin/orders"><input name="q" placeholder="按订单号搜索…" value="${esc(q)}"><select name="status"><option value="">全部状态</option><option value="pending"${status === 'pending' ? ' selected' : ''}>待审核</option><option value="success"${status === 'success' ? ' selected' : ''}>交易成功</option><option value="rejected"${status === 'rejected' ? ' selected' : ''}>已拒绝</option><option value="cancelled"${status === 'cancelled' ? ' selected' : ''}>已取消</option></select><button type="submit">搜索</button></form>
  <p class="muted">通过后自动开通会员 / 加余额，不用再去会员管理里手动再开一次。免费领取（脚本 / 部署 / 工具）也会生成 0 元订单。</p>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>订单</th><th>商品</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">暂无订单。</td></tr>'}</tbody></table></div>`;
  return page(c, admin, 'orders', pending, '订单管理', body);
});

adminRoutes.get('/admin/orders/:id', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const order = await db.prepare(`SELECT o.*, u.username, u.qq, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?`).bind(Number(c.req.param('id'))).first();
  if (!order) return c.notFound();
  const body = `<h1>订单 ${esc(order.order_no)}</h1>
  <section class="card">
    <p>用户：${esc(order.username)}（QQ ${esc(order.qq)} · ${esc(order.email)}）</p>
    <p>商品类型：${esc(order.product_type)} · 商品：${esc(order.product_name)}</p>
    <p>下单：${esc(order.created_at)} · 支付：${esc(order.paid_at || '—')}</p>
    <p>总额 ¥${(order.total_cents / 100).toFixed(2)} · 实付 ¥${(order.paid_cents / 100).toFixed(2)}${order.credit_cents ? ` · 到账 ¥${(order.credit_cents / 100).toFixed(2)}` : ''}</p>
    <p>支付方式：${esc(order.pay_method || '—')} · 付款备注：${esc(order.pay_ref || '—')}</p>
    <p>状态：${order.status}${order.product_type === 'free_deploy' ? ` · 部署状态：${order.deploy_status}（设备 ${esc(order.device_type || '')} / 系统 ${esc(order.system_info || '')} / QQ ${esc(order.contact_qq || '')}）` : ''}</p>
    <form id="orderEditForm" class="admin-form" data-order-id="${order.id}">
      <label>备注<textarea name="remark" rows="2">${esc(order.remark || '')}</textarea></label>
      <label>改总额（分）<input name="total_cents" type="number" value="${order.total_cents}"></label>
      <label>改实付（分）<input name="paid_cents" type="number" value="${order.paid_cents}"></label>
      <button type="submit" class="btn-primary">保存修改</button>
    </form>
    <div class="row-actions">
      ${order.status === 'pending' ? `<button type="button" class="mini-btn" data-order="approve" data-id="${order.id}">通过（自动开通/到账）</button><button type="button" class="mini-btn danger" data-order="reject" data-id="${order.id}">拒绝</button>` : ''}
      ${order.product_type === 'free_deploy' && order.deploy_status === 'pending' ? `<button type="button" class="mini-btn" data-deploy="processing" data-id="${order.id}">接单（处理中）</button>` : ''}
      ${order.product_type === 'free_deploy' && order.deploy_status === 'processing' ? `<button type="button" class="mini-btn" data-deploy="completed" data-id="${order.id}">点完成</button>` : ''}
      <button type="button" class="mini-btn danger" data-order="delete" data-id="${order.id}">删除订单</button>
    </div>
    <span class="muted small" id="orderMsg"></span>
  </section>
  <p><a href="/admin/orders">← 回订单管理</a></p>`;
  return page(c, admin, 'orders', pending, '订单详情', body);
});

// ---------- 财富管理 ----------
adminRoutes.get('/admin/wealth', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const totals = await db.prepare('SELECT COALESCE(SUM(balance_cents),0) AS b, COALESCE(SUM(points),0) AS p FROM users').bind().first();
  const { results: logs } = await db.prepare('SELECT w.*, u.username FROM wallet_logs w JOIN users u ON u.id=w.user_id ORDER BY w.created_at DESC LIMIT 50').all();
  const { results: checkins } = await db.prepare(`SELECT ck.*, u.username FROM checkins ck JOIN users u ON u.id=ck.user_id ORDER BY ck.check_date DESC LIMIT 30`).all();
  const { results: cards } = await db.prepare(`SELECT cc.*, u.username AS used_by_name FROM card_codes cc LEFT JOIN users u ON u.id=cc.used_by ORDER BY cc.created_at DESC LIMIT 100`).all();
  const logRows = (logs || []).map((l) => `<tr><td data-label="时间">${esc(l.created_at)}</td><td data-label="用户">${esc(l.username)}</td><td data-label="变动">${l.kind === 'balance' ? `${(l.change_cents / 100).toFixed(2)} 元` : `${l.change_points} 积分`}</td><td data-label="原因">${esc(l.reason)}</td></tr>`).join('');
  const cardRows = (cards || []).map((r) => `<tr><td data-label="卡密">${esc(r.code)}</td><td data-label="金额">¥${(r.amount_cents / 100).toFixed(2)}</td><td data-label="状态">${r.status === 'unused' ? '未使用' : r.status === 'used' ? `已用（${esc(r.used_by_name || '')}）` : '已作废'}</td><td data-label="有效期">${esc(r.expires_at || '长期有效')}</td><td data-label="操作">${r.status === 'unused' ? `<button type="button" class="mini-btn danger" data-card-void="${r.id}">作废</button>` : ''}</td></tr>`).join('');
  const body = `<h1>💰 财富管理</h1>
  <section class="card admin-stats"><div class="stat-grid">
    <div><strong>¥${((totals?.b || 0) / 100).toFixed(2)}</strong><span>全站余额总和</span></div>
    <div><strong>${totals?.p || 0}</strong><span>全站积分总和</span></div>
    <div><strong>${(checkins || []).length}</strong><span>近期签到记录（30 条）</span></div>
  </div></section>
  <section class="card"><h2>手动增减余额 / 积分</h2>
    <form id="wealthAdjustForm" class="admin-form inline">
      <input name="user_id" type="number" placeholder="用户 UID" required>
      <select name="kind"><option value="balance">余额（分）</option><option value="points">积分</option></select>
      <input name="amount" type="number" placeholder="变动数（可负数）" required>
      <input name="reason" placeholder="原因，如 活动奖励" maxlength="100">
      <button type="submit" class="btn-primary">调整</button>
    </form>
    <span class="muted small" id="adjustMsg"></span>
  </section>
  <section class="card"><h2>卡密生成</h2>
    <form id="cardCreateForm" class="admin-form inline">
      <input name="amount_cents" type="number" min="100" placeholder="每张金额（分，如 1000=10元）" required>
      <input name="count" type="number" min="1" max="100" value="1" placeholder="张数">
      <input name="expires_at" type="date" placeholder="有效期（可空）">
      <button type="submit" class="btn-primary">生成卡密</button>
    </form>
    <p class="muted small" id="cardMsg">卡密格式 OZN-XXXX-XXXX；兑换后生成对应订单，记录是哪个用户兑的；活动时发群里用。</p>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>卡密</th><th>金额</th><th>状态</th><th>有效期</th><th>操作</th></tr></thead><tbody>${cardRows || '<tr><td colspan="5" class="muted">暂无卡密。</td></tr>'}</tbody></table></div>
  </section>
  <h2>签到记录</h2>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>日期</th><th>用户</th><th>积分</th></tr></thead><tbody>${(checkins || []).map((r) => `<tr><td data-label="日期">${esc(r.check_date)}</td><td data-label="用户">${esc(r.username)}</td><td data-label="积分">+${r.points_given}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">暂无签到。</td></tr>'}</tbody></table></div>
  <h2>余额 / 积分流水</h2>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>用户</th><th>变动</th><th>原因</th></tr></thead><tbody>${logRows || '<tr><td colspan="4" class="muted">暂无流水。</td></tr>'}</tbody></table></div>`;
  return page(c, admin, 'wealth', pending, '财富管理', body);
});

// ---------- 智能管理（第四期） ----------
// 模型多 Key 自动切换 + 飞书机器人提醒。AI 只提醒，不自动通过付款订单。
// Key 只显示后 4 位，完整 Key 绝不返回前端；个人微信推送不做（第三方挂机易封号）。
adminRoutes.get('/admin/ai', async (c) => {
  const { admin, err } = await guard(c); if (err) return err;
  const db = c.env.DB;
  const pending = await pendingOrders(db);
  const settings = await getAISettings(db);
  const models = await listAIModels(db);
  const { results: logs } = await db.prepare(
    'SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT 50'
  ).all().catch(() => ({ results: [] }));
  // 第五期：聊天机器人设置 + 自动回复 + 聊天记录（总开关 ai_chatbot 在上面开关列表里）
  const chatbot = await getChatbotSettings(db);
  const autoReplies = await getAutoReplies(db);
  const chatQ = String(c.req.query('chat_q') || '').trim();
  const chatLogs = await listChatLogsAdmin(db, { q: chatQ, limit: 50 });
  const replyRows = (autoReplies || []).map((r) => `<tr>
    <td data-label="关键词">${esc(r.keyword)}</td>
    <td data-label="回复内容">${esc(r.reply)}</td>
    <td data-label="状态">${r.is_active ? '启用' : '停用'}</td>
    <td data-label="操作" class="row-actions">
      <button type="button" class="mini-btn" data-ai-reply-toggle="${r.id}">${r.is_active ? '停用' : '启用'}</button>
      <button type="button" class="mini-btn danger" data-ai-reply-del="${r.id}">删除</button>
    </td></tr>`).join('');
  const chatLogRows = (chatLogs || []).map((l) => `<tr>
    <td data-label="用户">${esc(l.username)}<br><span class="muted small">${esc(l.created_at)}</span></td>
    <td data-label="角色">${l.role === 'user' ? '用户问' : '小助手回'}</td>
    <td data-label="内容">${esc(String(l.content || '').slice(0, 120))}${String(l.content || '').length > 120 ? '……' : ''}<br><span class="muted small">${esc(l.kind)}${l.model_name ? ` · ${esc(l.model_name)}` : ''}</span></td>
    <td data-label="操作"><button type="button" class="mini-btn danger" data-chat-log-del="${l.id}">删除</button></td></tr>`).join('');
  const switchRows = AI_SWITCHES.map((s) => `<label class="ai-switch">
    <span><input type="checkbox" name="${s.key}"${settings[s.key] ? ' checked' : ''}> <strong>${s.label}</strong></span>
    <span class="muted small">${s.desc}</span></label>`).join('');
  const modelCards = (models || []).map((m) => {
    const keys = (m.keys || []).map((k) => `<tr>
      <td data-label="Key">${esc(k.label || 'Key')} · ****${esc(k.key_last4 || '')}</td>
      <td data-label="排序">${k.sort_order}</td>
      <td data-label="状态">${k.is_active ? '启用' : '停用'}${k.fail_count ? ` · 失败 ${k.fail_count} 次` : ''}${k.last_used_at ? `<br><span class="muted small">上次用 ${esc(k.last_used_at)}</span>` : ''}</td>
      <td data-label="操作" class="row-actions">
        <button type="button" class="mini-btn" data-ai-key-toggle="${k.id}">${k.is_active ? '停用' : '启用'}</button>
        <button type="button" class="mini-btn danger" data-ai-key-del="${k.id}">删除</button>
      </td></tr>`).join('');
    return `<section class="card ai-model-card">
    <h2>${m.is_active ? '✅' : '⏸️'} ${esc(m.name)} <span class="muted small">${esc(m.provider)} · ${esc(m.model)}</span></h2>
    <p class="muted small">地址：${esc(m.base_url)} · 排序 ${m.sort_order}${m.note ? ` · ${esc(m.note)}` : ''}</p>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>Key（只显示后 4 位）</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>${keys || '<tr><td colspan="4" class="muted">还没填 Key，填了 Key 才能用。</td></tr>'}</tbody></table></div>
    <form class="admin-form inline ai-key-form" data-model-id="${m.id}">
      <input name="key" type="password" placeholder="粘贴一个 Key（sk-…，只存加密串）" required autocomplete="off">
      <input name="label" placeholder="备注，如 备用 Key 1" maxlength="30">
      <input name="sort_order" type="number" value="0" min="0" placeholder="排序">
      <button type="submit" class="btn-primary">＋ 加 Key</button>
    </form>
    <div class="row-actions">
      <button type="button" class="mini-btn" data-ai-model-edit='${JSON.stringify({ id: m.id, name: m.name, provider: m.provider, base_url: m.base_url, model: m.model, sort_order: m.sort_order, note: m.note || '' })}'>编辑模型</button>
      <button type="button" class="mini-btn" data-ai-model-move="${m.id}" data-dir="-1">↑ 上移</button>
      <button type="button" class="mini-btn" data-ai-model-move="${m.id}" data-dir="1">↓ 下移</button>
      <button type="button" class="mini-btn" data-ai-model-toggle="${m.id}">${m.is_active ? '停用模型' : '启用模型'}</button>
      <button type="button" class="mini-btn" data-ai-model-test="${m.id}">测试连接</button>
      <button type="button" class="mini-btn danger" data-ai-model-del="${m.id}">删除模型</button>
    </div>
    <span class="muted small" data-ai-test-msg="${m.id}"></span>
  </section>`;
  }).join('');
  const logRows = (logs || []).map((l) => `<tr>
    <td data-label="时间">${esc(l.created_at)}</td>
    <td data-label="用途">${esc(l.purpose)}</td>
    <td data-label="模型">${esc(l.model_name || '—')} · ****${esc(l.key_last4 || '')}</td>
    <td data-label="结果">${l.ok ? '✅ 成功' : `❌ 失败：${esc(l.error || '')}`}</td>
    <td data-label="耗时">${l.latency_ms}ms</td></tr>`).join('');
  const body = `<h1>🤖 智能管理</h1>
  <p class="muted">多模型多 Key 自动切换 + 飞书提醒。AI 只提醒、不自动通过付款订单。Key 只存加密串，完整 Key 绝不显示、不写日志、不提交到 GitHub；正式部署建议再用 <code>npx wrangler secret put AI_KEY_SECRET</code> 设一个加密密钥。</p>
  <section class="card"><h2>飞书机器人</h2>
    <form id="feishuForm" class="admin-form">
      <label>飞书机器人 webhook 地址（主推送通道，飞书群 → 设置 → 群机器人 → 自定义机器人，复制 webhook）<input name="feishu_webhook" placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx" value="${esc(settings.feishu_webhook)}"></label>
      <label>飞书 App ID（以后发应用消息用，先存好，不强制校验）<input name="feishu_app_id" placeholder="cli_xxxx" value="${esc(settings.feishu_app_id)}"></label>
      <label>飞书 App Secret（以后发应用消息用，先存好，不强制校验）<input name="feishu_app_secret" type="password" placeholder="填飞书应用的 App Secret" value="${esc(settings.feishu_app_secret)}"></label>
      <button type="submit" class="btn-primary admin-big-btn">保存飞书配置</button>
      <span class="muted small" id="feishuMsg"></span>
    </form>
    <p><button type="button" class="btn-primary" id="feishuTestBtn">📣 测试推送（往飞书推一条测试消息）</button> <span class="muted small" id="feishuTestMsg"></span></p>
  </section>
  <section class="card"><h2>开关（每个独立，默认全关，站长自己开）</h2>
    <form id="aiSwitchForm" class="admin-form">
      ${switchRows}
      <button type="submit" class="btn-primary admin-big-btn">保存开关</button>
      <span class="muted small" id="aiSwitchMsg"></span>
    </form>
    <p><button type="button" class="btn-primary" id="aiDigestBtn">📊 立即发一次每日汇总（推飞书）</button> <span class="muted small" id="aiDigestMsg"></span></p>
    <p><button type="button" class="btn-primary" id="aiPendingRemindBtn">⏳ 推一次超时待审核订单提醒（超 24 小时没处理的）</button> <span class="muted small" id="aiPendingRemindMsg"></span></p>
  </section>
  <section class="card"><h2>💬 聊天机器人设置（第五期）</h2>
    <p class="muted small">总开关“网站小助手”在上面开关列表里，打开后前台右下角才显示小机器人按钮；只有登录用户能聊。联系方式只填想公开的，手机号、身份证、真实地址、密码、Key 绝不要填在这里。</p>
    <form id="chatbotForm" class="admin-form">
      <label>欢迎语<input name="chatbot_welcome" maxlength="200" value="${esc(chatbot.welcome)}"></label>
      <label>每人每天最多问几条（1~100，默认 20）<input name="chatbot_daily_limit" type="number" min="1" max="100" value="${chatbot.dailyLimit}"></label>
      <label>站长 QQ（有人问怎么联系站长时才推，没填不推）<input name="chatbot_contact_qq" maxlength="20" value="${esc(chatbot.contact.qq)}" placeholder="如 446099815"></label>
      <label>QQ 会员群号<input name="chatbot_contact_group" maxlength="20" value="${esc(chatbot.contact.group)}" placeholder="如 13916509"></label>
      <label>站长邮箱<input name="chatbot_contact_email" type="email" maxlength="100" value="${esc(chatbot.contact.email)}" placeholder="如 qq446099815@gmail.com"></label>
      <label>站长微信号<input name="chatbot_contact_wechat" maxlength="40" value="${esc(chatbot.contact.wechat)}"></label>
      <label>联系说明（一句话，如：工作日晚上 8 点后在线）<input name="chatbot_contact_note" maxlength="200" value="${esc(chatbot.contact.note)}"></label>
      <button type="submit" class="btn-primary admin-big-btn">保存聊天机器人设置</button>
      <span class="muted small" id="chatbotMsg"></span>
    </form>
    <p class="muted small">聊天框里显示咨询二维码的开关在上面开关列表里（“聊天框里显示咨询二维码”）。</p>
  </section>
  <section class="card"><h2>💬 自动回复（关键词命中先回，不走模型省额度）</h2>
    <form id="aiReplyNewForm" class="admin-form">
      <label>关键词（用户消息里包含这个词就命中，如 会员多少钱）<input name="keyword" required maxlength="60" placeholder="如 会员多少钱"></label>
      <label>回复内容<textarea name="reply" rows="3" required maxlength="500" placeholder="如 月费会员 29 元/30 天，年费价格在会员页看，虚拟资源不支持退款。"></textarea></label>
      <label>排序（数字越小越优先命中）<input name="sort_order" type="number" value="0" min="0"></label>
      <button type="submit" class="btn-primary admin-big-btn">新建自动回复</button>
    </form>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>关键词</th><th>回复内容</th><th>状态</th><th>操作</th></tr></thead><tbody>${replyRows || '<tr><td colspan="4" class="muted">暂无自动回复，关键词命中时才回，没命中就走 AI 回答。</td></tr>'}</tbody></table></div>
  </section>
  <section class="card"><h2>💬 聊天记录（站长看全部，用于审核）</h2>
    <form class="admin-search" method="get" action="/admin/ai"><input name="chat_q" placeholder="按用户名搜聊天记录…" value="${esc(chatQ)}"><button type="submit">搜索</button></form>
    <div class="table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>角色</th><th>内容</th><th>操作</th></tr></thead><tbody>${chatLogRows || '<tr><td colspan="4" class="muted">暂无聊天记录。</td></tr>'}</tbody></table></div>
  </section>
  <section class="card"><h2>新建模型</h2>
    <form id="aiModelNewForm" class="admin-form">
      <label>名称<input name="name" placeholder="如 OpenRouter DeepSeek" required maxlength="40"></label>
      <label>提供商<select name="provider"><option value="nvidia">英伟达 NVIDIA</option><option value="openrouter">OpenRouter</option><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 Qwen</option><option value="kimi">Kimi / Moonshot</option><option value="glm">智谱 GLM</option><option value="other">其他（OpenAI 兼容）</option></select></label>
      <label>API 地址（OpenAI 兼容，以 /v1 结尾）<input name="base_url" placeholder="https://openrouter.ai/api/v1" required></label>
      <label>模型名<input name="model" placeholder="如 deepseek/deepseek-chat:free" required maxlength="120"></label>
      <label>排序（数字越小越优先调用）<input name="sort_order" type="number" value="99" min="0"></label>
      <label>备注<input name="note" placeholder="如 免费模型，申请地址" maxlength="120"></label>
      <button type="submit" class="btn-primary admin-big-btn">新建模型（建好后在下面加 Key 再启用）</button>
    </form>
    <p class="muted small">常用地址：英伟达 https://integrate.api.nvidia.com/v1（模型如 meta/llama-3.3-70b-instruct）；OpenRouter https://openrouter.ai/api/v1（免费模型如 deepseek/deepseek-chat:free）；DeepSeek https://api.deepseek.com/v1（deepseek-chat）；通义 https://dashscope.aliyuncs.com/compatible-mode/v1（qwen-plus）；Kimi https://api.moonshot.cn/v1（moonshot-v1-8k）；智谱 https://open.bigmodel.cn/api/paas/v4（glm-4-flash，免费）。</p>
  </section>
  <h2>模型列表（按排序从上往下试，第一个调不通、超时、限流就自动切下一个）</h2>
  ${modelCards || '<p class="muted">暂无模型，先新建一个。</p>'}
  <dialog id="aiModelEditDialog" class="admin-dialog"><form id="aiModelEditForm" class="admin-form" method="dialog">
    <h2>编辑模型</h2><input type="hidden" name="id">
    <label>名称<input name="name" required maxlength="40"></label>
    <label>提供商<select name="provider"><option value="nvidia">英伟达 NVIDIA</option><option value="openrouter">OpenRouter</option><option value="deepseek">DeepSeek</option><option value="qwen">通义千问 Qwen</option><option value="kimi">Kimi / Moonshot</option><option value="glm">智谱 GLM</option><option value="other">其他（OpenAI 兼容）</option></select></label>
    <label>API 地址<input name="base_url" required></label>
    <label>模型名<input name="model" required maxlength="120"></label>
    <label>排序<input name="sort_order" type="number" min="0"></label>
    <label>备注<input name="note" maxlength="120"></label>
    <button type="submit" class="btn-primary admin-big-btn">保存</button>
    <button type="button" class="mini-btn" data-close-dialog>取消</button>
  </form></dialog>
  <h2>调用记录（最近 50 条，只记模型名和 Key 后 4 位，不记完整 Key）</h2>
  <div class="table-wrap"><table class="admin-table"><thead><tr><th>时间</th><th>用途</th><th>模型</th><th>结果</th><th>耗时</th></tr></thead><tbody>${logRows || '<tr><td colspan="5" class="muted">暂无调用记录。</td></tr>'}</tbody></table></div>`;
  return page(c, admin, 'ai', pending, '智能管理', body);
});

adminRoutes.get('/admin/:section', (c) => {
  const section = c.req.param('section');
  return c.html(pageHTML({ title: '后台管理', active: '/', bottomActive: 'me', body: `<h1>后台管理</h1><p class="muted">「${esc(section)}」不存在，请从菜单进。</p><p><a href="/admin">← 回后台首页</a></p>` }));
});
