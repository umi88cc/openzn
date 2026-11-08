-- AI指南（openzn）第五期迁移：网站小助手聊天机器人
-- 执行（在 schema.sql、migrate-phase3.sql、migrate-phase4.sql 之后）：
--   npx wrangler d1 execute openzn-db --file=src/db/migrate-phase5.sql
-- 本地：npx wrangler d1 execute openzn-db --local --file=src/db/migrate-phase5.sql
-- 1) ai_chat_logs：聊天记录（用户只能看自己的，后台站长能看全部用于审核）
-- 2) ai_auto_replies：站长在后台设置的自动回复（关键词命中先回，不走模型省额度）
-- 聊天机器人开关与设置存在 site_settings：
--   ai_chatbot（总开关，默认关）、ai_chatbot_show_qr（聊天框里显示咨询二维码，默认关）
--   chatbot_welcome、chatbot_daily_limit（默认 20）、chatbot_contact_qq、
--   chatbot_contact_group、chatbot_contact_email、chatbot_contact_wechat、
--   chatbot_contact_note（联系方式只填想公开的，绝不填手机号/身份证/地址/密码/Key）

CREATE TABLE IF NOT EXISTS ai_chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat'
    CHECK (kind IN ('chat','contact','auto_reply','ai','refusal')),
  model_name TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_user ON ai_chat_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_created ON ai_chat_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_auto_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,        -- 用户消息里包含这个词就命中（不区分大小写）
  reply TEXT NOT NULL,          -- 自动回复内容（先回这个，不走模型省额度）
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_auto_replies_order ON ai_auto_replies(sort_order, id);
