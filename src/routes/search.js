// AI指南 — 搜索 API（v5 定稿）
// 输入 1 字等 0.5 秒再查（前端防抖）；先标题后内容；只返回前 10 条；不搜隐藏段。
import { Hono } from 'hono';
import { searchArticles } from '../lib/db.js';
import { FALLBACK_ARTICLES } from '../lib/seed-data.js';

export const searchRoutes = new Hono();

searchRoutes.get('/api/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ results: [] });
  const db = c.env.DB;
  let results = await searchArticles(db, q);
  if (results === null) {
    // 无 D1 兜底：先标题后内容，前 10 条
    const lower = q.toLowerCase();
    const byTitle = FALLBACK_ARTICLES.filter((a) => a.title.toLowerCase().includes(lower));
    const byContent = FALLBACK_ARTICLES.filter((a) => !a.title.toLowerCase().includes(lower) && a.content.toLowerCase().includes(lower));
    results = [...byTitle, ...byContent].slice(0, 10).map((a) => ({ id: a.id, slug: a.slug, title: a.title, summary: a.summary, tag: a.tag }));
  }
  return c.json({ results });
});
