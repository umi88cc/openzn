// AI指南 — D1 数据访问层（v5）
// 前后台共用一个 D1；KV 只做缓存，写完清缓存。
// 第一期：读操作（分类、文章、搜索、排行榜）已实现；
// 写操作（点赞/评论/收藏/签到/订单）接口已留好，第二期再接前端。

export async function getCategories(db) {
  if (!db) return null;
  const { results } = await db.prepare(
    'SELECT id, slug, name, description, visibility, sort_order FROM categories WHERE is_visible=1 ORDER BY sort_order ASC'
  ).all();
  return results;
}

export async function getPinnedArticles(db) {
  if (!db) return null;
  const { results } = await db.prepare(
    `SELECT a.id, a.slug, a.title, a.summary, a.tag, a.views, a.likes_count, a.comments_count,
            c.slug AS category_slug, c.name AS category_name
     FROM articles a JOIN categories c ON c.id=a.category_id
     WHERE a.status='published' AND a.is_pinned=1 ORDER BY a.pin_order ASC LIMIT 3`
  ).all();
  return results;
}

export async function getLatestArticles(db, limit = 20) {
  if (!db) return null;
  const { results } = await db.prepare(
    `SELECT a.id, a.slug, a.title, a.summary, a.tag, a.views, a.likes_count, a.comments_count,
            a.favorites_count, a.created_at, c.slug AS category_slug, c.name AS category_name
     FROM articles a JOIN categories c ON c.id=a.category_id
     WHERE a.status='published' ORDER BY a.is_pinned DESC, a.pin_order ASC, a.created_at DESC LIMIT ?`
  ).bind(limit).all();
  return results;
}

export async function getArticlesByCategory(db, slug, limit = 20) {
  if (!db) return null;
  const { results } = await db.prepare(
    `SELECT a.id, a.slug, a.title, a.summary, a.tag, a.views, a.likes_count, a.comments_count,
            a.created_at, c.slug AS category_slug, c.name AS category_name
     FROM articles a JOIN categories c ON c.id=a.category_id
     WHERE a.status='published' AND c.slug=? ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT ?`
  ).bind(slug, limit).all();
  return results;
}

export async function getArticleBySlug(db, slug) {
  if (!db) return null;
  return await db.prepare(
    `SELECT a.*, c.slug AS category_slug, c.name AS category_name
     FROM articles a JOIN categories c ON c.id=a.category_id
     WHERE a.slug=? AND a.status='published'`
  ).bind(slug).first();
}

// 搜索：先标题后内容，只返回前 10 条；不搜隐藏段（hidden_content）
export async function searchArticles(db, q) {
  const query = (q || '').trim();
  if (!query) return [];
  if (!db) return null;
  const like = `%${query}%`;
  const { results } = await db.prepare(
    `SELECT id, slug, title, summary, tag FROM articles
     WHERE status='published' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)
     ORDER BY (title LIKE ?) DESC, (summary LIKE ?) DESC, created_at DESC LIMIT 10`
  ).bind(like, like, like, like, like).all();
  return results;
}

// 排行榜：只取前 10 名；积分榜 / 余额榜分开；只显示用户名/头像+积分/余额
export async function getLeaderboard(db, board = 'points') {
  if (!db) return null;
  const col = board === 'balance' ? 'show_on_balance_board' : 'show_on_points_board';
  const order = board === 'balance' ? 'balance_cents DESC' : 'points DESC';
  const { results } = await db.prepare(
    `SELECT username, avatar_url, points, balance_cents FROM users
     WHERE is_banned=0 AND ${col}=1 ORDER BY ${order} LIMIT 10`
  ).all();
  return results;
}

export async function getArticleCounts(db, articleId) {
  if (!db) return null;
  return await db.prepare(
    'SELECT likes_count, comments_count, favorites_count, views FROM articles WHERE id=?'
  ).bind(articleId).first();
}

// ---- 第二期接口（已定义表结构，前端接好后直接用；第一期不启用写逻辑） ----
export async function toggleLike(db, userId, articleId) {
  // 唯一约束 (user_id, article_id)：存在即取消，不存在即点赞；同步 articles.likes_count
  const found = await db.prepare('SELECT 1 FROM likes WHERE user_id=? AND article_id=?').bind(userId, articleId).first();
  if (found) {
    await db.batch([
      db.prepare('DELETE FROM likes WHERE user_id=? AND article_id=?').bind(userId, articleId),
      db.prepare('UPDATE articles SET likes_count = MAX(0, likes_count-1) WHERE id=?').bind(articleId),
    ]);
    return { liked: false };
  }
  await db.batch([
    db.prepare('INSERT INTO likes (user_id, article_id) VALUES (?, ?)').bind(userId, articleId),
    db.prepare('UPDATE articles SET likes_count = likes_count+1 WHERE id=?').bind(articleId),
  ]);
  return { liked: true };
}

export async function toggleFavorite(db, userId, articleId) {
  const found = await db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND article_id=?').bind(userId, articleId).first();
  if (found) {
    await db.batch([
      db.prepare('DELETE FROM favorites WHERE user_id=? AND article_id=?').bind(userId, articleId),
      db.prepare('UPDATE articles SET favorites_count = MAX(0, favorites_count-1) WHERE id=?').bind(articleId),
    ]);
    return { favorited: false };
  }
  await db.batch([
    db.prepare('INSERT INTO favorites (user_id, article_id) VALUES (?, ?)').bind(userId, articleId),
    db.prepare('UPDATE articles SET favorites_count = favorites_count+1 WHERE id=?').bind(articleId),
  ]);
  return { favorited: true };
}
