// AI指南 — 会员与免费额度判定（v5，第二期）
// 周期：月费 30 天、年费 365 天，均按订单生效时刻算；续费从到期那天往后延。
// 免费额度跟 30 天周期走，提前续费不马上刷新；同一个工具一个月内只算 1 次。
// 年费全部不限制；年费免费部署每两个月 1 次（一年 6 次）。
import { MONTHLY_QUOTA } from './config.js';

// 上海自然日（签到按自然日 0 点刷新，不按 24 小时整）
export function shanghaiDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export async function getActiveMembership(db, userId) {
  if (!db) return null;
  // 当前正在生效的那条：starts_at <= 现在 < expires_at。
  // 提前续费会产生一条未来才生效的记录（starts_at=旧到期日），额度周期
  // 必须按当前生效这条算，不能取未来那条，否则周期起点在未来、额度永远算 0。
  const row = await db.prepare(
    `SELECT m.*, p.slug AS plan_slug, p.name AS plan_name, p.duration_days, p.permissions_json
     FROM memberships m JOIN membership_plans p ON p.id=m.plan_id
     WHERE m.user_id=? AND m.status='active' AND m.starts_at <= datetime('now') AND m.expires_at > datetime('now')
     ORDER BY m.expires_at DESC LIMIT 1`
  ).bind(userId).first();
  if (!row) return null;
  let perms = {};
  try { perms = JSON.parse(row.permissions_json || '{}'); } catch { perms = {}; }
  return { ...row, perms, isYearly: row.duration_days === 365 || perms.unlimited === true };
}

export function isMember(membership) {
  return !!membership;
}

// 当前 30 天周期的开始时刻（从生效时刻起每 30 天一滚）
export function currentCycleStart(membership, now = new Date()) {
  const start = new Date(membership.starts_at.replace(' ', 'T') + 'Z');
  const elapsed = Math.max(0, now - start);
  const cycles = Math.floor(elapsed / (30 * 86400000));
  return new Date(start.getTime() + cycles * 30 * 86400000);
}

function toDbTime(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// 本周期内免积分工具已用份数（按 downloads 里 cost_type='free_quota' 计数）
export async function freeToolsUsedInCycle(db, userId, membership, now = new Date()) {
  if (!db || !membership) return 0;
  const start = toDbTime(currentCycleStart(membership, now));
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM downloads WHERE user_id=? AND cost_type='free_quota' AND created_at >= ?"
  ).bind(userId, start).first();
  return row?.n || 0;
}

// 本周期内这个工具是否已用免费额度下过（同一工具一月只算 1 次）
export async function toolDownloadedFreeInCycle(db, userId, toolName, membership, now = new Date()) {
  if (!db || !membership) return false;
  const start = toDbTime(currentCycleStart(membership, now));
  const row = await db.prepare(
    "SELECT 1 FROM downloads WHERE user_id=? AND tool_name=? AND cost_type IN ('free_quota','member_free') AND created_at >= ? LIMIT 1"
  ).bind(userId, toolName, start).first();
  return !!row;
}

// 工具兑换判定：返回 { mode, price, reason }
// mode: member_free（年费一路绿灯）/ free_quota（月费免费额度内）/
//       points（扣积分）/ insufficient（积分不够）
export async function checkToolAccess(db, user, membership, { toolName, price }) {
  const p = Math.min(20, Math.max(10, price || 20)); // 工具积分价后台自定义，控制在 10~20
  if (membership?.isYearly) return { mode: 'member_free', price: 0 };
  if (membership) {
    const used = await freeToolsUsedInCycle(db, user.id, membership);
    const already = await toolDownloadedFreeInCycle(db, user.id, toolName, membership);
    if (already) return { mode: 'free_quota', price: 0, reason: '本月已用免费额度下过该工具，不重复扣次数' };
    if (used < MONTHLY_QUOTA.tools) {
      return { mode: 'free_quota', price: 0, reason: `月费免费额度（本月已用 ${used}/${MONTHLY_QUOTA.tools} 份）` };
    }
  }
  if ((user.points || 0) >= p) return { mode: 'points', price: p };
  return { mode: 'insufficient', price: p, reason: `积分不足，需要 ${p} 积分，当前 ${user.points || 0} 积分，每天签到可得 5~15 积分` };
}

export function nextOrderNo(prefix = 'OZN') {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${ymd}-${rand}`;
}
