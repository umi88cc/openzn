-- AI指南（openzn）第四期迁移：智能管理
-- 执行（在 schema.sql、migrate-phase3.sql 之后）：
--   npx wrangler d1 execute openzn-db --file=src/db/migrate-phase4.sql
-- 本地：npx wrangler d1 execute openzn-db --local --file=src/db/migrate-phase4.sql
-- 1) ai_models：模型配置（提供商 / API 地址 / 模型名 / 排序 / 启用）
-- 2) ai_keys：一个模型可挂多个 Key，按排序轮换；Key 只存加密串，绝不存明文
-- 3) ai_logs：每次调用的记录（模型 / Key 后 4 位 / 成功失败 / 耗时 / 用途）
-- 飞书配置与开关存在 site_settings：feishu_webhook、feishu_app_id、
-- feishu_app_secret、ai_comment_review、ai_order_notify、ai_expiry_notify、
-- ai_register_notify、ai_daily_digest（0 关 / 1 开，默认全关）。
-- 预置两条示例模型（不带真实 Key，站长在后台填自己的 Key 后启用）：
-- NVIDIA 免费模型、OpenRouter 免费模型。

CREATE TABLE IF NOT EXISTS ai_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,            -- 如 NVIDIA Llama、OpenRouter DeepSeek
  provider TEXT NOT NULL DEFAULT 'openrouter'
    CHECK (provider IN ('nvidia','openrouter','deepseek','qwen','kimi','glm','other')),
  base_url TEXT NOT NULL,        -- OpenAI 兼容地址，如 https://integrate.api.nvidia.com/v1
  model TEXT NOT NULL,           -- 如 meta/llama-3.3-70b-instruct、deepseek/deepseek-chat:free
  sort_order INTEGER NOT NULL DEFAULT 0,  -- 数字越小越优先调用
  is_active INTEGER NOT NULL DEFAULT 0,   -- 1 启用 / 0 停用
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_models_order ON ai_models(sort_order, id);

CREATE TABLE IF NOT EXISTS ai_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id INTEGER NOT NULL REFERENCES ai_models(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',         -- 如 备用 Key 1，方便区分
  key_enc TEXT NOT NULL,         -- 加密串（v1:base64），绝不存明文，绝不返回前端
  key_last4 TEXT NOT NULL DEFAULT '****',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_keys_model ON ai_keys(model_id, sort_order, id);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose TEXT NOT NULL,         -- comment_moderation / order_summary / test / daily_digest / expiry
  model_name TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  key_last4 TEXT DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at DESC);

-- 预置示例（不带 Key，默认停用，站长填 Key 后启用）：
-- NVIDIA 免费模型：https://integrate.api.nvidia.com/v1
-- OpenRouter 免费模型：https://openrouter.ai/api/v1
INSERT OR IGNORE INTO ai_models (id, name, provider, base_url, model, sort_order, is_active, note) VALUES
(1, 'NVIDIA 免费模型', 'nvidia', 'https://integrate.api.nvidia.com/v1', 'meta/llama-3.3-70b-instruct', 1, 0, '英伟达免费模型，在 build.nvidia.com 申请 Key，填到下面的 Key 里'),
(2, 'OpenRouter 免费模型', 'openrouter', 'https://openrouter.ai/api/v1', 'deepseek/deepseek-chat:free', 2, 0, 'OpenRouter 免费模型，在 openrouter.ai 申请 Key；也可改成其他免费模型，如 qwen/qwen-2.5-7b-instruct:free');
