// AI指南 — 文章路由（v5，第二期）
// 列表：置顶同步在最上面；详情：代码块带复制、锁卡样式、版权卡片居中、图片防盗。
// 第二期：点赞/收藏真实切换、评论干净直接显示/违规进待审核、
// 回复可见解锁（会员或已提交评论）、会员/积分文章可见门、工具积分兑换入口。
import { Hono } from 'hono';
import { pageHTML, copyrightCardHTML, escapeHtml } from '../lib/render.js';
import { getArticlesByCategory, getArticleBySlug, getLatestArticles } from '../lib/db.js';
import { getSessionUser, publicUser, currentUser } from '../lib/auth.js';
import { getActiveMembership, toolDownloadedFreeInCycle } from '../lib/membership.js';
import { FALLBACK_ARTICLES } from '../lib/seed-data.js';
import { renderContent } from '../lib/shortcodes.js';

export const articleRoutes = new Hono();

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

articleRoutes.get('/articles', async (c) => {
  const db = c.env.DB;
  const user = await currentUser(c);
  let list = await getLatestArticles(db, 50);
  if (!list) list = FALLBACK_ARTICLES;
  const body = `<h1>📄 文章</h1>
  <p class="muted">全部 11 个分类的文章都在这里，置顶文章固定在最上面。</p>
  <div class="article-list">${list.map(articleCard).join('') || '<p>暂无文章。</p>'}</div>`;
  return c.html(pageHTML({ title: '文章', active: '/articles', bottomActive: 'articles', body, user }));
});

articleRoutes.get('/article/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = c.env.DB;
  const user = await currentUser(c);
  let article = await getArticleBySlug(db, slug);
  if (!article) article = FALLBACK_ARTICLES.find((a) => a.slug === slug);
  if (!article) return c.notFound();
  const isFallback = !db || !article.id || FALLBACK_ARTICLES.some((a) => a.slug === slug && !db);

  // 点赞/收藏状态、评论列表、解锁状态（只在有 D1 时查库）
  let liked = false, favorited = false, comments = [], hasCommented = false;
  let membership = null, pointsUnlocked = false;
  if (db && !isFallback) {
    // 浏览量 +1（失败不影响页面）
    try { await db.prepare('UPDATE articles SET views = views+1 WHERE id=?').bind(article.id).run(); article.views = (article.views || 0) + 1; } catch {}
    if (user) {
      liked = !!(await db.prepare('SELECT 1 FROM likes WHERE user_id=? AND article_id=?').bind(user.id, article.id).first());
      favorited = !!(await db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND article_id=?').bind(user.id, article.id).first());
      hasCommented = !!(await db.prepare('SELECT 1 FROM comments WHERE user_id=? AND article_id=? LIMIT 1').bind(user.id, article.id).first());
      membership = await getActiveMembership(db, user.id);
      pointsUnlocked = !!(await db.prepare(
        "SELECT 1 FROM downloads WHERE user_id=? AND article_id=? AND cost_type IN ('points','free_quota','member_free') LIMIT 1"
      ).bind(user.id, article.id).first());
    }
    const { results } = await db.prepare(
      `SELECT cm.id, cm.content, cm.status, cm.created_at, u.username, u.avatar_url
       FROM comments cm JOIN users u ON u.id=cm.user_id
       WHERE cm.article_id=? AND cm.status='approved' ORDER BY cm.created_at ASC LIMIT 100`
    ).bind(article.id).all();
    comments = results || [];
  }
  const isMember = !!membership;
  const unlocked = {
    reply: isMember || hasCommented,
    vip: isMember,
    points: isMember || pointsUnlocked,
  };

  // 会员专属文章：非会员只看摘要 + 锁卡；积分文章：未解锁只看摘要 + 锁卡
  let contentHtml;
  if (article.visibility === 'member' && !isMember) {
    contentHtml = `<p>${escapeHtml(article.summary || '')}</p>
      <div class="lock-card lock-vip"><div class="lock-head">🔒 会员可见</div><div class="lock-hint">开通会员后即可查看</div><button class="lock-btn" type="button" onclick="location.href='/member'">去开通会员</button></div>`;
  } else if (article.visibility === 'points' && !unlocked.points) {
    const price = Math.min(20, Math.max(10, article.points_price || 20));
    contentHtml = `<p>${escapeHtml(article.summary || '')}</p>
      <div class="lock-card lock-points"><div class="lock-head">🔒 积分可见 · ${price} 积分</div><div class="lock-hint">使用积分兑换后查看（每天签到可得 5~15 积分）</div><button class="lock-btn" type="button" data-redeem-article="${article.id}" data-tool="${escapeHtml(article.title)}" data-price="${price}">用 ${price} 积分兑换</button></div>`;
  } else {
    contentHtml = renderContent(article.content, unlocked);
  }

  // 工具下载文章：积分兑换入口（工具分类 / 积分可见文章）
  const isToolArticle = article.category_slug === 'tools' || article.visibility === 'points';
  const toolBox = isToolArticle && db && !isFallback ? `
    <section class="card tool-box">
      <h2>⬇️ 工具下载 / 兑换</h2>
      <p class="muted">每个工具积分价后台自定义（10~20 积分）。月费会员每月免积分下 5 份工具（同一工具一月只算 1 次），第 6 份起用积分兑换；年费会员全部免积分。</p>
      <button type="button" class="btn-gold" data-redeem-article="${article.id}" data-tool="${escapeHtml(article.title)}" data-price="${Math.min(20, Math.max(10, article.points_price || 20))}">兑换 / 下载「${escapeHtml(article.title)}」</button>
      <p class="muted small" id="redeemMsg"></p>
    </section>` : '';

  const commentList = comments.map((cm) => `
    <div class="comment-item">
      <img class="comment-avatar" src="${escapeHtml(cm.avatar_url || '')}" alt="" onerror="this.onerror=null;this.src='/assets/logo/logo.webp'">
      <div><strong>${escapeHtml(cm.username)}</strong> <span class="muted small">${escapeHtml(cm.created_at || '')}</span>
      <p>${escapeHtml(cm.content)}</p></div>
    </div>`).join('') || '<p class="muted">还没有评论，来抢沙发吧。</p>';

  const body = `<article class="article-detail">
    <div class="article-crumb"><a href="/">首页</a> / <a href="/category/${escapeHtml(article.category_slug)}">${escapeHtml(article.category_name)}</a></div>
    <h1>${escapeHtml(article.title)}</h1>
    <div class="article-meta">
      <span class="cat-tag">${escapeHtml(article.category_name)}</span>
      ${article.tag ? `<span class="tag">${escapeHtml(article.tag)}</span>` : ''}
      <span>👁 ${article.views || 0}</span><span>👍 <span id="likeCount">${article.likes_count || 0}</span></span>
      <span>💬 ${article.comments_count || 0}</span><span>⭐ <span id="favCount">${article.favorites_count || 0}</span></span>
    </div>
    <div class="article-actions">
      <button type="button" class="action-btn${liked ? ' active' : ''}" data-like="${article.id}">${liked ? '👍 已点赞' : '👍 点赞'}</button>
      <button type="button" class="action-btn${favorited ? ' active' : ''}" data-fav="${article.id}">${favorited ? '⭐ 已收藏' : '⭐ 收藏'}</button>
    </div>
    <div class="article-content">${contentHtml}</div>
    ${toolBox}
    ${copyrightCardHTML()}
    <section class="card comments-section" id="comments">
      <h2>💬 评论</h2>
      <div class="comment-list">${commentList}</div>
      ${user ? `
      <form id="commentForm" class="comment-form" data-article="${article.id}">
        <textarea name="content" rows="3" placeholder="写评论…干净的直接显示；含违规词或站外链接的进后台人工审核。评论后即可查看“回复可见”的内容。" required></textarea>
        <button type="submit">发布评论</button>
        <span class="muted small">评论即解锁“回复可见”内容（不管审没审过）。</span>
      </form>` : `<p class="muted">请先登录再评论。<button type="button" data-open-auth>去登录</button></p>`}
    </section>
  </article>
  <script src="/js/article.js" defer></script>`;
  return c.html(pageHTML({ title: article.title, active: '/articles', bottomActive: 'articles', body, user }));
});
