// AI指南 — 网站小助手聊天接口（第五期）
// 只有登录用户能发消息；未登录返回 401，前端弹登录框。
// 每人每天限 N 条（后台智能管理可改，默认 20），超了返回 429。
// AI 只回答本站相关问题（src/lib/ai.js 的 answerChatbot 里锁死提示词 + 站内检索）。
import { Hono } from 'hono';
import { getSessionUser } from '../lib/auth.js';
import { answerChatbot, getChatbotSettings, getChatHistory } from '../lib/ai.js';

export const chatbotRoutes = new Hono();

async function needLogin(c) {
  if (!c.env.DB) return { res: c.json({ ok: false, error: '数据库未就绪' }, 503), user: null };
  const session = await getSessionUser(c.env.DB, c.req.raw);
  if (!session) return { res: c.json({ ok: false, error: '请先登录再和小助手聊天', loginRequired: true }, 401), user: null };
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(session.user_id).first();
  if (!user) return { res: c.json({ ok: false, error: '请先登录再和小助手聊天', loginRequired: true }, 401), user: null };
  return { res: null, user };
}

// 前台状态：开没开小助手、欢迎语、今天还剩几条（未登录只给 enabled 和 welcome）
chatbotRoutes.get('/api/ai/chat/status', async (c) => {
  const settings = await getChatbotSettings(c.env.DB);
  const session = await getSessionUser(c.env.DB, c.req.raw).catch(() => null);
  let remaining = null;
  if (session?.user_id && c.env.DB) {
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const row = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_chat_logs WHERE user_id=? AND role='user' AND date(created_at)=?"
    ).bind(session.user_id, today).first().catch(() => ({ n: 0 }));
    remaining = Math.max(0, settings.dailyLimit - (row?.n || 0));
  }
  return c.json({
    ok: true,
    enabled: settings.enabled,
    loggedIn: !!session,
    welcome: settings.welcome,
    dailyLimit: settings.dailyLimit,
    remaining,
    showQr: settings.showQr,
  });
});

// 发消息：登录用户专用；限额、违规拒绝、联系站长、自动回复、站内 AI 回答都在 answerChatbot 里。
chatbotRoutes.post('/api/ai/chat', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const { message } = await c.req.json().catch(() => ({}));
  const out = await answerChatbot(c.env.DB, c.env, { user, message });
  if (!out.ok) {
    const status = out.code === 'limit' ? 429 : out.code === 'disabled' ? 403 : 400;
    return c.json({ ok: false, error: out.error, code: out.code, used: out.used, remaining: out.remaining }, status);
  }
  return c.json({
    ok: true, reply: out.reply, kind: out.kind, model: out.model || null,
    sources: out.sources || [], contact: out.contact || null, hasContact: !!out.hasContact,
    showQr: !!out.showQr, used: out.used, remaining: out.remaining,
  });
});

// 自己的聊天记录：只返回当前登录用户自己的，绝不返回别人的。
chatbotRoutes.get('/api/ai/chat/history', async (c) => {
  const { res, user } = await needLogin(c);
  if (res) return res;
  const rows = await getChatHistory(c.env.DB, user.id, 50);
  return c.json({ ok: true, messages: rows });
});
