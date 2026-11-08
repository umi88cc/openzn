// AI指南 — 排行榜 API（v5）
// 电脑端首页小卡片：默认积分榜，可切换余额榜；只显示前 10 名；
// 只显示用户名/头像+积分/余额；用户可在个人中心自选积分/余额是否上榜。
import { Hono } from 'hono';
import { getLeaderboard } from '../lib/db.js';
import { FALLBACK_LEADERBOARD } from '../lib/seed-data.js';

export const leaderboardRoutes = new Hono();

leaderboardRoutes.get('/api/leaderboard', async (c) => {
  const board = c.req.query('board') === 'balance' ? 'balance' : 'points';
  const db = c.env.DB;
  let rows = await getLeaderboard(db, board);
  if (!rows) rows = FALLBACK_LEADERBOARD;
  return c.json({ board, rows });
});
