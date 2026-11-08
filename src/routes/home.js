// AI指南 — 首页路由（v5）
// 电脑：Logo + 个人中心图标同一排 → 导航栏 → 长搜索框
// 手机：搜索在导航下面；底部只显示 4 个导航
// 置顶 2~3 篇同步显示在最上面，带置顶标签。
import { Hono } from 'hono';
import { pageHTML, leaderboardCardHTML, escapeHtml } from '../lib/render.js';
import { currentUser } from '../lib/auth.js';
import { CATEGORIES } from '../lib/config.js';
import { getPinnedArticles, getLatestArticles, getLeaderboard } from '../lib/db.js';
import { FALLBACK_ARTICLES, FALLBACK_LEADERBOARD, FALLBACK_CATEGORIES } from '../lib/seed-data.js';

export const homeRoutes = new Hono();

function articleCard(a) {
  return `<article class="article-card">
    <a href="/article/${escapeHtml(a.slug)}">
      ${a.is_pinned ? '<span class="pin-tag">📌 置顶</span>' : ''}
      <span class="cat-tag">${escapeHtml(a.category_name)}</span>
      ${a.tag ? `<span class="tag">${escapeHtml(a.tag)}</span>` : ''}
      <h3>${escapeHtml(a.title)}</h3>
      <p>${escapeHtml(a.summary || '')}</p>
      <div class="card-meta">👁 ${a.views || 0} · 👍 ${a.likes_count || 0} · 💬 ${a.comments_count || 0}</div>
    </a>
  </article>`;
}

homeRoutes.get('/', async (c) => {
  const db = c.env.DB;
  let pinned = await getPinnedArticles(db);
  let latest = await getLatestArticles(db, 20);
  let board = await getLeaderboard(db, 'points');
  if (!pinned) pinned = FALLBACK_ARTICLES.filter((a) => a.is_pinned);
  if (!latest) latest = FALLBACK_ARTICLES;
  if (!board) board = FALLBACK_LEADERBOARD;
  const cats = CATEGORIES;
  const user = await currentUser(c);

  const body = `
  <section class="hero">
    <h1>智能领航，部署无忧</h1>
    <p>OpenClaw 与 Hermes 部署指南：电脑本地、VPS、安卓手机，一步一步带你跑通。</p>
  </section>
  <section class="cat-grid" aria-label="分类">
    ${cats.map((cat) => `<a class="cat-card" href="/category/${cat.slug}"><strong>${escapeHtml(cat.name)}</strong><span>${escapeHtml(cat.desc)}</span><em>${cat.visibility === 'free' ? '免费' : cat.visibility === 'member' ? '会员专享' : cat.visibility === 'points' ? '积分兑换' : '回复可见'}</em></a>`).join('')}
  </section>
  <div class="home-cols">
    <div class="home-main">
      <h2>📌 置顶必读</h2>
      ${pinned.map(articleCard).join('') || '<p>暂无置顶文章。</p>'}
      <h2>最新文章</h2>
      ${latest.map(articleCard).join('') || '<p>暂无文章，站长正在后台撰写中。</p>'}
    </div>
    <aside class="home-side">
      ${leaderboardCardHTML(board, 'points')}
      <section class="card member-cta">
        <h2>👑 开通会员</h2>
        <p>免积分下载工具、每月免费领脚本、每月免费远程部署一次。</p>
        <p class="muted">月费示例 29 元，年费价格由站长在后台自定义。</p>
        <a class="btn-gold" href="/member">查看会员</a>
        <p class="muted small">虚拟资源不支持退款。QQ 会员群：13916509（开通后站长私下拉群）</p>
      </section>
    </aside>
  </div>`;
  return c.html(pageHTML({ title: '首页', active: '/', bottomActive: 'home', body, user }));
});
