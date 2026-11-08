// AI指南 — 分类路由（v5）
// 11 个分类；分类不变，文章打 OpenClaw / Hermes 标签筛选。
import { Hono } from 'hono';
import { pageHTML, escapeHtml } from '../lib/render.js';
import { currentUser } from '../lib/auth.js';
import { CATEGORIES } from '../lib/config.js';
import { getArticlesByCategory } from '../lib/db.js';
import { FALLBACK_ARTICLES } from '../lib/seed-data.js';

export const categoryRoutes = new Hono();

categoryRoutes.get('/category/:slug', async (c) => {
  const slug = c.req.param('slug');
  const cat = CATEGORIES.find((x) => x.slug === slug);
  if (!cat) return c.notFound();
  const tag = c.req.query('tag');
  const db = c.env.DB;
  let list = await getArticlesByCategory(db, slug, 50);
  if (!list) list = FALLBACK_ARTICLES.filter((a) => a.category_slug === slug);
  if (tag) list = list.filter((a) => a.tag === tag);
  const visLabel = { free: '全部用户可见', reply: '部分内容回复可见', points: '登录 / 回复 / 积分', member: '只有会员可见' }[cat.visibility];
  const body = `<h1>${escapeHtml(cat.name)}</h1>
  <p class="muted">${escapeHtml(cat.desc)} · ${visLabel}</p>
  <div class="tag-filter">
    <a href="/category/${cat.slug}" class="${!tag ? 'active' : ''}">全部</a>
    <a href="/category/${cat.slug}?tag=OpenClaw" class="${tag === 'OpenClaw' ? 'active' : ''}">OpenClaw</a>
    <a href="/category/${cat.slug}?tag=Hermes" class="${tag === 'Hermes' ? 'active' : ''}">Hermes</a>
  </div>
  <div class="article-list">${list.map((a) => `<article class="article-card"><a href="/article/${escapeHtml(a.slug)}">
    ${a.is_pinned ? '<span class="pin-tag">📌 置顶</span>' : ''}
    ${a.tag ? `<span class="tag">${escapeHtml(a.tag)}</span>` : ''}
    <h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.summary || '')}</p>
    <div class="card-meta">👁 ${a.views || 0} · 👍 ${a.likes_count || 0} · 💬 ${a.comments_count || 0}</div>
  </a></article>`).join('') || '<p>这个分类下暂无文章。</p>'}</div>`;
  const user = await currentUser(c);
  return c.html(pageHTML({ title: cat.name, active: `/category/${slug}`, bottomActive: 'articles', body, user }));
});
