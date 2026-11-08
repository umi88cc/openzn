// AI指南 — 页面渲染（v5 定稿）
// 浅色极简科技风：底白 + 浅灰卡片，深蓝紫主色，金色只给会员。
// 电脑：左上 Logo + 右上个人中心图标同一排 → 导航栏 → 长搜索框
// 手机：搜索在导航下面；底部只显示 4 个导航，不显示电脑三栏底部。
import { SITE, DEFAULT_NAV, daysRunning } from './config.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function headerHTML(active = '/', user = null) {
  const nav = DEFAULT_NAV.map((n) =>
    `<a class="nav-item${active === n.href ? ' active' : ''}" href="${escapeHtml(n.href)}">${escapeHtml(n.label)}</a>`).join('');
  // 已登录：右上角变缩小版 QQ 头像，点头像进个人中心；未登录：点图标弹登录框
  const meButton = user
    ? `<a class="me-avatar-link" href="/me" aria-label="个人中心"><img class="me-avatar-img" src="${escapeHtml(user.avatar_url || '')}" alt="${escapeHtml(user.username)}" width="40" height="40" onerror="this.onerror=null;this.src='/assets/logo/logo.webp'"></a>`
    : `<button class="me-icon" id="meIcon" type="button" aria-label="个人中心">
      <span class="me-icon-svg">👤</span><span class="me-label">我的</span>
    </button>`;
  return `<header class="site-header">
  <div class="header-top">
    <a class="logo" href="/"><img src="/assets/logo/logo.webp" alt="AI指南 openzn.cc" width="264" height="86"></a>
    ${meButton}
  </div>
  <nav class="site-nav" aria-label="导航栏">${nav}</nav>
  <div class="search-wrap">
    <input id="siteSearch" type="search" placeholder="搜文章：先搜标题，再搜内容…" autocomplete="off" aria-label="搜索文章">
    <div id="searchResults" class="search-results" hidden></div>
  </div>
</header>`;
}

// 手机底部 4 导航：首页、文章、会员、我的（文章图标用文档类）
export function bottomNavHTML(active = 'home') {
  const tabs = [
    { id: 'home', label: '首页', href: '/', icon: '🏠' },
    { id: 'articles', label: '文章', href: '/articles', icon: '📄' },
    { id: 'member', label: '会员', href: '/member', icon: '👑' },
    { id: 'me', label: '我的', href: '/me', icon: '👤' },
  ];
  return `<nav class="bottom-nav" aria-label="底部导航">${tabs.map((t) =>
    `<a class="bottom-tab${active === t.id ? ' active' : ''}" href="${t.href}"><span class="tab-icon">${t.icon}</span><span>${t.label}</span></a>`).join('')}</nav>`;
}

// 电脑版三栏底部（仅电脑显示）：左 Logo+关于本站 4 句；中 QQ 上、微信下；右链接+版权+运行天数
export function footerHTML() {
  const about = SITE.aboutLines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-col footer-left">
      <img src="/assets/logo/logo.webp" alt="AI指南" class="footer-logo">
      <div class="footer-about">${about}</div>
    </div>
    <div class="footer-col footer-mid">
      <figure><img src="/assets/qr/qq-consult-qr.png" alt="QQ 咨询二维码" width="140" height="140" loading="lazy"><figcaption>QQ 咨询</figcaption></figure>
      <figure><img src="/assets/qr/wechat-consult-qr.png" alt="微信咨询二维码" width="140" height="140" loading="lazy"><figcaption>微信咨询</figcaption></figure>
    </div>
    <div class="footer-col footer-right">
      <div class="footer-links">
        <a href="/links">友链申请</a><a href="/disclaimer">免责声明</a>
        <a href="/ads">广告合作</a><a href="/about">关于我们</a>
      </div>
      <p class="footer-copy">© 2026 AI指南 openzn.cc · 已安全运行 ${daysRunning()} 天</p>
      <p class="footer-filing">备案号与认证徽章：待购买 openzn.cc 后补上（现留空）</p>
    </div>
  </div>
</footer>`;
}

// 文章末尾版权说明卡片（v5 定稿）：美化自适应，内容居中，浅灰 + 金边
export function copyrightCardHTML() {
  return `<section class="copyright-card" aria-label="版权声明">
  <div class="copyright-inner">
    <div class="copyright-title">© 版权声明</div>
    <p>本文为 <strong>AI指南（openzn.cc）</strong> 原创文章，作者：站长，未经授权，禁止转载、复制、改编，转载请注明出处：AI指南 openzn.cc。</p>
    <p>本站部署教程、命令、脚本、工具仅供学习交流使用，禁止用于商业用途，禁止转售、倒卖，违者将追究责任。</p>
    <p>如文章内容涉及侵权，请联系站长删除。</p>
  </div>
</section>`;
}

// 排行榜小卡片（电脑端首页）：默认积分榜，可切换余额榜；只显示前 10 名，只显示用户名/头像+积分/余额
export function leaderboardCardHTML(rows = [], board = 'points') {
  const items = rows.slice(0, 10).map((r, i) =>
    `<li><span class="rank">${i + 1}</span><img class="lb-avatar" src="${escapeHtml(r.avatar_url || '/assets/logo/logo.webp')}" alt="" onerror="this.onerror=null;this.src='/assets/logo/logo.webp'"><span class="lb-name">${escapeHtml(r.username)}</span><span class="lb-val">${board === 'points' ? `${r.points} 积分` : `¥${(r.balance_cents / 100).toFixed(2)}`}</span></li>`).join('');
  return `<section class="card leaderboard-card">
  <h2>🏆 排行榜</h2>
  <div class="board-tabs">
    <button type="button" data-board="points" class="${board === 'points' ? 'active' : ''}">积分榜</button>
    <button type="button" data-board="balance" class="${board === 'balance' ? 'active' : ''}">余额榜</button>
  </div>
  <ol class="board-list">${items || '<li class="empty">暂无上榜用户（可在个人中心选择是否上榜）</li>'}</ol>
  <p class="board-note">仅显示前 10 名 · 不显示邮箱与 QQ · 个人中心可自选积分/余额是否上榜</p>
</section>`;
}

// 登录框：默认登录（蓝色），可选注册（绿色）；登录两种方式；注册字段按规格
export function authModalHTML() {
  return `<div class="auth-modal" id="authModal" hidden>
  <div class="auth-card">
    <button class="auth-close" type="button" id="authClose" aria-label="关闭">×</button>
    <div class="auth-tabs">
      <button type="button" data-auth-tab="login" class="active">登录</button>
      <button type="button" data-auth-tab="register">注册</button>
    </div>
    <form id="loginForm" class="auth-form auth-login">
      <input name="account" placeholder="用户名或者邮箱" required>
      <input name="password" type="password" placeholder="密码" required>
      <button type="submit">登录</button>
      <p class="auth-alt">或 <button type="button" data-show-code-login>邮箱 + 验证码登录</button></p>
      <p class="auth-alt"><a href="/forgot">忘记密码？用邮箱验证码重置</a></p>
      <p class="auth-note">登录时效 8 小时，超时需重新输入密码。</p>
    </form>
    <form id="loginCodeForm" class="auth-form auth-login" hidden>
      <input name="email" type="email" placeholder="邮箱" required>
      <div class="code-row"><input name="code" placeholder="邮箱验证码" required><button type="button" data-send-code data-purpose="login">发送验证码</button></div>
      <button type="submit">验证码登录</button>
      <p class="auth-alt">或 <button type="button" data-show-pass-login>账号 + 密码登录</button></p>
    </form>
    <form id="registerForm" class="auth-form auth-register" hidden>
      <input name="username" placeholder="账号（不可更改）" required>
      <input name="password" type="password" placeholder="密码（6 位以上）" minlength="6" required>
      <input name="password2" type="password" placeholder="确认密码" minlength="6" required>
      <input name="qq" placeholder="QQ 号（绑定后不可改）" required>
      <input name="email" type="email" placeholder="邮箱（绑定后不可改）" required>
      <div class="code-row"><input name="code" placeholder="邮箱验证码" required><button type="button" data-send-code>发送验证码</button></div>
      <button type="submit">注册</button>
      <p class="auth-note">注册成功后直接登录到个人中心。一个邮箱只能注册一个账号，一个 QQ 号只能绑一个账号。</p>
    </form>
  </div>
</div>`;
}

// 网站小助手（第五期）：右下角圆形机器人按钮 + 聊天窗口。
// 默认先隐藏，public/js/chatbot.js 问过 /api/ai/chat/status、确认后台开了开关才显示；
// 未登录点开先显示“请先登录”+登录按钮；手机上按钮在底部导航上方，不遮导航。
export function chatbotHTML() {
  return `<button type="button" class="chatbot-fab" id="chatbotFab" aria-label="网站小助手" hidden>🤖</button>
<div class="chatbot-panel" id="chatbotPanel" hidden role="dialog" aria-label="网站小助手">
  <div class="chatbot-head">
    <span class="chatbot-avatar">🤖</span>
    <span class="chatbot-title"><strong>AI指南小助手</strong><small id="chatbotLimit">只回答本站相关问题</small></span>
    <button type="button" class="chatbot-close" id="chatbotClose" aria-label="关闭">×</button>
  </div>
  <div class="chatbot-qr" id="chatbotQr" hidden>
    <figure><img src="/assets/qr/qq-consult-qr.png" alt="QQ 咨询二维码" width="84" height="84" loading="lazy"><figcaption>QQ 咨询</figcaption></figure>
    <figure><img src="/assets/qr/wechat-consult-qr.png" alt="微信咨询二维码" width="84" height="84" loading="lazy"><figcaption>微信咨询</figcaption></figure>
  </div>
  <div class="chatbot-msgs" id="chatbotMsgs" aria-live="polite"></div>
  <div class="chatbot-chips" id="chatbotChips">
    <button type="button" data-chat-q="怎么部署 OpenClaw？">怎么部署 OpenClaw？</button>
    <button type="button" data-chat-q="会员多少钱？有什么用？">会员多少钱？</button>
    <button type="button" data-chat-q="怎么联系站长？">怎么联系站长？</button>
    <button type="button" data-chat-q="签到怎么拿积分？">签到怎么拿积分？</button>
  </div>
  <form class="chatbot-form" id="chatbotForm">
    <input id="chatbotInput" type="text" placeholder="问小助手一个本站问题…" maxlength="500" autocomplete="off" aria-label="问小助手">
    <button type="submit" id="chatbotSend">发送</button>
  </form>
  <p class="chatbot-note">每天最多问 <span id="chatbotDailyLimit">20</span> 条 · 回答只依据本站文章和设置，不编价格和教程</p>
</div>`;
}

export function pageHTML({ title, active, bottomActive, body, extraHead = '', user = null }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)} - AI指南 openzn.cc</title>
<meta name="description" content="AI指南：OpenClaw 与 Hermes 部署指南，电脑本地、VPS、安卓手机部署教程。">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/article.css">
${extraHead}
</head>
<body data-logged-in="${user ? '1' : ''}">
${headerHTML(active, user)}
<main class="page">${body}</main>
${footerHTML()}
${bottomNavHTML(bottomActive)}
${authModalHTML()}
${chatbotHTML()}
<script src="/js/main.js" defer></script>
<script src="/js/search.js" defer></script>
<script src="/js/auth.js" defer></script>
<script src="/js/chatbot.js" defer></script>
</body>
</html>`;
}
