// AI指南 — 互动 API（v5，第二期）
// 点赞 / 收藏 / 评论 / 签到 / 积分兑换工具 / 排行榜上榜开关。
// 写操作全部走 Workers API，共用一个 D1；KV 只做缓存。
// 第三期不做：会员开通、订单审核、财富充值、后台管理（只留接口）。
import { Hono } from 'hono';
import { getSessionUser, publicUser } from '../lib/auth.js';
import { toggleLike, toggleFavorite, getArticleCounts } from '../lib/db.js';
import { moderateComment } from '../lib/moderation.js';
import { moderateCommentWithAI, getAISettings, notifyComment, notifyLikeSpike, notifyOrderAI } from '../lib/ai.js';
import {
  getActiveMembership, checkToolAccess, shanghaiDate, nextOrderNo,
} from '../lib/membership.js';
import { CHECKIN, TOOL_POINTS } from '../lib/config.js';

export const interactRoutes = new Hono();

async function needLogin(c) {
  if (!c.env.DB) return { res: c.json({ ok: false, error: '数据库未就绪' }, 503), user: null };
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) return { res: c.json({ ok: false, error: '请先登录', loginRequired: true }, 401), user: null };
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  if (!user) return { res: c.json({ ok: false, error: '请先登录', loginRequired: true }, 401), user: null };
  return { res: null, user };
}

async function getArticle(c, articleId) {
  const id = Number(articleId);
  if (!id) return null;
  return c.env.DB.prepare('SELECT * FROM articles WHERE id=? AND status=\'published\'').bind(id).first();
}

// ---------- 点赞：仅登录用户，每人每文一次，再点取消；同步 +1/-1 ----------
interactRoutes.post('/api/like', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const { article_id } = await c.req.json().catch(() => ({}));
  const article = await getArticle(c, article_id);
  if (!article) return c.json({ ok: false, error: '文章不存在' }, 404);
  const result = await toggleLike(c.env.DB, user.id, article.id);
  const counts = await getArticleCounts(c.env.DB, article.id);
  // 第四期补全：点赞/收藏异常提醒（只在新点赞时检查，取消点赞不检查；失败不影响点赞结果）
  if (result.liked) await notifyLikeSpike(c.env.DB, c.env, user).catch(() => {});
  return c.json({ ok: true, ...result, likes_count: counts?.likes_count || 0 });
});

// ---------- 收藏：每人每文一次，收藏+1 / 取消-1 ----------
interactRoutes.post('/api/favorite', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const { article_id } = await c.req.json().catch(() => ({}));
  const article = await getArticle(c, article_id);
  if (!article) return c.json({ ok: false, error: '文章不存在' }, 404);
  const result = await toggleFavorite(c.env.DB, user.id, article.id);
  const counts = await getArticleCounts(c.env.DB, article.id);
  // 第四期补全：点赞/收藏异常提醒（只在新收藏时检查，取消收藏不检查；失败不影响收藏结果）
  if (result.favorited) await notifyLikeSpike(c.env.DB, c.env, user).catch(() => {});
  return c.json({ ok: true, ...result, favorites_count: counts?.favorites_count || 0 });
});

// ---------- 评论 ----------
// 列表：只返回已通过的；登录用户自己的待审核评论也返回（标 pending，自己能看到）
interactRoutes.get('/api/comments', async (c) => {
  const articleId = Number(c.req.query('article_id'));
  if (!articleId) return c.json({ ok: false, error: '缺少文章' }, 400);
  if (!c.env.DB) return c.json({ ok: true, comments: [] });
  const session = await getSessionUser(c.env.DB, c.req.raw);
  const myId = session?.user_id || 0;
  const { results } = await c.env.DB.prepare(
    `SELECT cm.id, cm.content, cm.status, cm.created_at, u.username, u.avatar_url,
            CASE WHEN cm.user_id=? THEN 1 ELSE 0 END AS is_mine
     FROM comments cm JOIN users u ON u.id=cm.user_id
     WHERE cm.article_id=? AND (cm.status='approved' OR (cm.status='pending' AND cm.user_id=?))
     ORDER BY cm.created_at ASC LIMIT 100`
  ).bind(myId, articleId, myId).all();
  return c.json({ ok: true, comments: results });
});

// 发评论：干净的直接显示；含违规词/站外链接的先进 pending，后台通过才显示。
// 回复可见解锁只看有没有提交过评论，不管审没审过——所以提交即返回 unlocked_reply=true。
interactRoutes.post('/api/comments', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const { article_id, content } = await c.req.json().catch(() => ({}));
  const article = await getArticle(c, article_id);
  if (!article) return c.json({ ok: false, error: '文章不存在' }, 404);
  const text = String(content || '').trim();
  if (!text) return c.json({ ok: false, error: '评论内容不能为空' }, 400);
  if (text.length > 2000) return c.json({ ok: false, error: '评论最多 2000 字' }, 400);
  const mod = moderateComment(text);
  // 第四期：评论 AI 审核开关开着时，先走 AI 审。
  // AI 判违规/拿不准 → 待审核；AI 判干净且关键词规则也干净 → 直接显示；
  // AI 没配模型/调不通 → 退回原来关键词 + 外链规则，不阻塞发评论。
  let status = mod.ok ? 'approved' : 'pending';
  let aiNote = '';
  try {
    const settings = await getAISettings(c.env.DB);
    if (settings.ai_comment_review) {
      const ai = await moderateCommentWithAI(c.env.DB, c.env, text);
      if (ai.used) {
        aiNote = ai.reason ? `AI 审核：${ai.reason}` : '';
        if (ai.verdict === 'violation' || ai.verdict === 'suspicious') status = 'pending';
        else if (ai.verdict === 'clean') status = mod.ok ? 'approved' : 'pending';
      }
    }
  } catch { /* AI 异常不阻塞发评论，走关键词规则 */ }
  const reasons = [...mod.reasons, ...(aiNote ? [aiNote] : [])];
  const { meta } = await c.env.DB.prepare(
    'INSERT INTO comments (article_id, user_id, content, status) VALUES (?, ?, ?, ?)'
  ).bind(article.id, user.id, text, status).run();
  if (status === 'approved') {
    await c.env.DB.prepare('UPDATE articles SET comments_count = comments_count+1 WHERE id=?').bind(article.id).run();
  }
  // 第四期补全：评论推送开关开着时推一条飞书（不管直接显示还是待审核都推）。
  // 推送失败不阻塞发评论；评论本身已入库，返回结果不受影响。
  await notifyComment(c.env.DB, c.env, { commentId: meta.last_row_id, article, user, status, content: text }).catch(() => {});
  return c.json({
    ok: true, id: meta.last_row_id, status, unlocked_reply: true,
    message: status === 'approved' ? '评论已发布' : `评论已提交，待站长人工审核后显示（${reasons.join('；') || 'AI 审核转人工'}）`,
  });
});

// ---------- 签到：按自然日 0 点刷新，送 5~15 积分随机，给积分不是余额，不清零 ----------
interactRoutes.post('/api/checkin', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const today = shanghaiDate();
  const done = await c.env.DB.prepare(
    'SELECT points_given FROM checkins WHERE user_id=? AND check_date=?'
  ).bind(user.id, today).first();
  if (done) {
    return c.json({ ok: true, already: true, points_given: done.points_given, points: user.points, check_date: today, message: '今天已经签到过了，明天 0 点后再来' });
  }
  const points = CHECKIN.min + Math.floor(Math.random() * (CHECKIN.max - CHECKIN.min + 1));
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO checkins (user_id, check_date, points_given) VALUES (?, ?, ?)').bind(user.id, today, points),
    c.env.DB.prepare('UPDATE users SET points = points + ? WHERE id=?').bind(points, user.id),
    c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_points, reason) VALUES (?, 'points', ?, '签到')").bind(user.id, points),
  ]);
  const fresh = await c.env.DB.prepare('SELECT points FROM users WHERE id=?').bind(user.id).first();
  return c.json({ ok: true, already: false, points_given: points, points: fresh?.points || 0, check_date: today });
});

interactRoutes.get('/api/checkin/status', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const today = shanghaiDate();
  const done = await c.env.DB.prepare(
    'SELECT points_given FROM checkins WHERE user_id=? AND check_date=?'
  ).bind(user.id, today).first();
  return c.json({ ok: true, checked_in: !!done, points_given: done?.points_given || 0, points: user.points, check_date: today });
});

// ---------- 积分兑换工具 ----------
// 年费一路绿灯（member_free）；月费每月免积分 5 份（同一工具一月只算 1 次），
// 第 6 份起扣积分；普通用户直接扣积分。扣完马上能下载/查看，记一条流水。
// 免费领取（free_quota / member_free）按 v5 生成一笔 0 元订单（product_type='free_tool'）。
interactRoutes.post('/api/tools/redeem', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const { tool_name, article_id, points_price } = await c.req.json().catch(() => ({}));
  const toolName = String(tool_name || '').trim();
  if (!toolName) return c.json({ ok: false, error: '缺少工具名' }, 400);
  let price = Number(points_price) || 0;
  if (article_id) {
    const article = await c.env.DB.prepare('SELECT points_price FROM articles WHERE id=?').bind(Number(article_id)).first();
    if (article?.points_price) price = article.points_price;
  }
  if (!price) price = TOOL_POINTS.max; // 未填价默认 20（后台自定义 10~20）
  const membership = await getActiveMembership(c.env.DB, user.id);
  const access = await checkToolAccess(c.env.DB, user, membership, { toolName, price });
  if (access.mode === 'insufficient') {
    return c.json({ ok: false, error: access.reason, need: access.price, have: user.points || 0 }, 402);
  }
  const orderNo = nextOrderNo();
  if (access.mode === 'points') {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET points = points - ? WHERE id=? AND points >= ?').bind(access.price, user.id, access.price),
      c.env.DB.prepare("INSERT INTO wallet_logs (user_id, kind, change_points, reason) VALUES (?, 'points', ?, ?)").bind(user.id, -access.price, `兑换工具：${toolName}`),
      c.env.DB.prepare("INSERT INTO downloads (user_id, article_id, tool_name, cost_type, cost_points) VALUES (?, ?, ?, 'points', ?)").bind(user.id, article_id ? Number(article_id) : null, toolName, access.price),
    ]);
    const fresh = await c.env.DB.prepare('SELECT points FROM users WHERE id=?').bind(user.id).first();
    return c.json({ ok: true, mode: 'points', cost_points: access.price, points: fresh?.points || 0, message: `已扣 ${access.price} 积分，现在可以下载 / 查看` });
  }
  // 免费领取：生成 0 元订单 + 下载记录（前台“我的-订单”与后台都能查到）
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO orders (order_no, user_id, product_type, product_name, total_cents, paid_cents, status) VALUES (?, ?, 'free_tool', ?, 0, 0, 'success')"
    ).bind(orderNo, user.id, `免费领取工具：${toolName}`),
    c.env.DB.prepare("INSERT INTO downloads (user_id, article_id, tool_name, cost_type, cost_points) VALUES (?, ?, ?, ?, 0)").bind(user.id, article_id ? Number(article_id) : null, toolName, access.mode),
  ]);
  // 第四期补全：免费领工具也生成了订单，订单 AI 提醒开关开着时同样推飞书（失败不阻塞领取）
  await notifyOrderAI(c.env.DB, c.env, { order_no: orderNo, product_name: `免费领取工具：${toolName}`, paid_cents: 0, status: 'success' }, user).catch(() => {});
  return c.json({ ok: true, mode: access.mode, cost_points: 0, order_no: orderNo, message: access.reason || '免费领取成功，现在可以下载 / 查看' });
});

// ---------- 排行榜上榜开关：积分 / 余额两个独立开关，默认都上榜 ----------
interactRoutes.post('/api/me/board-optins', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const { board, opted_in } = await c.req.json().catch(() => ({}));
  if (!['points', 'balance'].includes(board)) return c.json({ ok: false, error: '榜单不对' }, 400);
  const col = board === 'points' ? 'show_on_points_board' : 'show_on_balance_board';
  const val = opted_in ? 1 : 0;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET ${col}=? WHERE id=?`).bind(val, user.id),
    c.env.DB.prepare(
      "INSERT INTO leaderboard_optins (user_id, board, opted_in) VALUES (?, ?, ?) ON CONFLICT(user_id, board) DO UPDATE SET opted_in=excluded.opted_in, updated_at=datetime('now')"
    ).bind(user.id, board, val),
  ]);
  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
  return c.json({ ok: true, user: publicUser(fresh) });
});
