-- AI指南（openzn）D1 建表脚本 v5
-- 执行：npx wrangler d1 execute openzn-db --file=src/db/schema.sql
-- 免费层注意：单个 D1 库最大 500MB，账号总计 5GB，最多 10 个库；
-- 每天 500 万行读、10 万行写，超了当天所有写都失败（UTC 0 点重置）。
-- 所有写操作走 Workers API，前后台共用这一个 D1；KV 只做缓存，写完清缓存。
-- 分享功能已去掉，没有 share 相关表。
PRAGMA foreign_keys = ON;

-- ================= 用户 =================
-- 头像：只存 QQ 头像链接（qlogo.cn），不存图片本地；登录时自动拉取最新 QQ 头像
-- 邮箱、QQ 唯一；账号不可改；QQ/微信填入后不可改（后台可操作）；邮箱绑定后不可改
-- 性别每月限改 1 次（靠 gender_changed_at 按月计数）
-- 密码只存哈希，禁止明文；站长锁死 QQ 446099815 + 邮箱 qq446099815@gmail.com（见 is_admin）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  qq TEXT NOT NULL UNIQUE,
  wechat TEXT,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,               -- https://qlogo.cn/headimg_dl?dst_uin=<qq>&spec=100
  gender TEXT CHECK (gender IN ('男','女','保密')) DEFAULT '保密',
  gender_changed_at TEXT,
  signature TEXT DEFAULT '',
  balance_cents INTEGER NOT NULL DEFAULT 0,   -- 余额（分），与积分分开，不可混用
  points INTEGER NOT NULL DEFAULT 0,          -- 积分，只能靠签到获得，不可充值
  is_admin INTEGER NOT NULL DEFAULT 0,        -- 1 = 站长（仅 QQ 446099815 + qq446099815@gmail.com）
  is_banned INTEGER NOT NULL DEFAULT 0,       -- 封禁：不能登录，会员时间照走不暂停
  show_on_points_board INTEGER NOT NULL DEFAULT 1,  -- 排行榜：积分上榜开关（用户自选）
  show_on_balance_board INTEGER NOT NULL DEFAULT 1, -- 排行榜：余额上榜开关（用户自选）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_qq ON users(qq);

-- 登录会话（8 小时；站长后台 7 天，同设备、手机不关机条件下）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin_session INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 邮箱验证码（注册 / 邮箱登录 / 忘记密码共用；限流：每邮箱、每 IP 每小时只能发几次）
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','login','reset_password')),
  ip TEXT,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, purpose);

-- ================= 分类 =================
-- 11 个分类（v5 定稿），不为 OpenClaw / Hermes 各建一套，文章打标签筛选
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,            -- 四字，如 智能简介
  description TEXT DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'free'
    CHECK (visibility IN ('free','reply','points','member')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================= 文章 =================
-- 置顶：is_pinned + pin_order，最多 2~3 篇，顶满需先取消一篇
-- visibility：free / reply（回复可见）/ points（积分换）/ member（会员）
-- hidden_content：回复/会员/积分可见的那一段，不进搜索索引
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  tag TEXT CHECK (tag IN ('OpenClaw','Hermes',NULL)),
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  content TEXT NOT NULL,         -- 正文（Markdown + 快捷命令，见 src/lib/shortcodes.js）
  hidden_content TEXT DEFAULT '',-- 隐藏段（不参与搜索）
  visibility TEXT NOT NULL DEFAULT 'free'
    CHECK (visibility IN ('free','reply','points','member')),
  points_price INTEGER NOT NULL DEFAULT 0,  -- 积分可见时的价格（后台自定义，10~20）
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','published','offline')),
  is_pinned INTEGER NOT NULL DEFAULT 0,
  pin_order INTEGER NOT NULL DEFAULT 0,     -- 1、2、3
  views INTEGER NOT NULL DEFAULT 0,
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  favorites_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id, status);
CREATE INDEX IF NOT EXISTS idx_articles_pinned ON articles(is_pinned, pin_order);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

-- ================= 点赞 / 收藏 / 评论 =================
-- 每人每文只能点赞一次（再点即取消）；每人每文只能收藏一次（收藏+1 / 取消-1）
CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, article_id)
);
-- 评论：干净的直接显示；含违规词/外链的先进 pending，后台通过才显示
-- 回复可见解锁只看有没有提交过评论，不管审没审过
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved','pending','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id, status, created_at DESC);

-- ================= 会员 =================
-- 套餐名称、价格、图标、权限全部后台自定义；月费示例 29 元，年费价格后台自定义（不写死）
-- 周期：月费 30 天、年费 365 天，均按订单生效时刻算；续费从到期那天往后延
CREATE TABLE IF NOT EXISTS membership_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,     -- monthly / yearly
  name TEXT NOT NULL,            -- 如 黄金会员（后台自定义）
  price_cents INTEGER NOT NULL,  -- 价格（分），后台自定义
  icon TEXT DEFAULT '',
  duration_days INTEGER NOT NULL, -- 30 / 365
  permissions_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES membership_plans(id),
  order_id INTEGER REFERENCES orders(id),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,      -- 到期后权限全部收回，变回普通用户；记录保留
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','expired','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status, expires_at);

-- 每月免费额度（按 30 天周期走，提前续费不马上刷新）
-- 同一个工具一个月内只算 1 次；年费免费部署每两个月 1 次（一年 6 次）
CREATE TABLE IF NOT EXISTS member_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle_start TEXT NOT NULL,     -- 周期开始（生效时刻）
  cycle_end TEXT NOT NULL,
  free_tools_used INTEGER NOT NULL DEFAULT 0,   -- 免积分工具，已用 / 每月 5
  free_script_used INTEGER NOT NULL DEFAULT 0,  -- 免费脚本，已用 / 每月 1
  free_deploy_used INTEGER NOT NULL DEFAULT 0,  -- 免费部署，已用 / 月费每月 1，年费每两月 1
  UNIQUE (user_id, cycle_start)
);

-- ================= 订单 =================
-- 商品类型：月费、年费、余额充值、卡密、免费脚本领取、免费部署、免费工具领取
-- 免费领取也要生成 0 元订单；部署申请表就是订单（单表设计），不另建表
-- 扫码支付：待审核 → 站长同意后自动开通/到账；余额支付：直接扣，记交易成功
-- 虚拟资源不支持退款
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE, -- 建议格式 OZN-20261108-0001（未最后确认）
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL CHECK (product_type IN
    ('monthly','yearly','balance_recharge','card_code','free_script','free_deploy','free_tool')),
  product_name TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,   -- 订单总额（分）
  paid_cents INTEGER NOT NULL DEFAULT 0,    -- 实付金额（分）
  credit_cents INTEGER NOT NULL DEFAULT 0,  -- 到账金额（分，如充 50 到账 53）
  pay_method TEXT CHECK (pay_method IN ('balance','alipay','wechat',NULL)),
  pay_ref TEXT,              -- 付款方式/金额/时间或交易单号后几位（手动核验用）
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','rejected','cancelled')),
  remark TEXT DEFAULT '',
  -- 部署申请附加字段（仅 product_type='free_deploy' 时用；申请表即订单）
  device_type TEXT,          -- 设备类型：电脑本地 / VPS / 安卓手机
  system_info TEXT,          -- 系统
  contact_qq TEXT,           -- QQ 号
  deploy_status TEXT CHECK (deploy_status IN ('pending','processing','completed',NULL)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

-- ================= 财富：余额 / 积分流水 =================
-- 余额充值档位：10 / 50送3（到账53）/ 120送10（到账130）/ 300送20（到账320），最低 10 元
-- 积分只能靠签到获得，不可充值；工具兑换价后台自定义，10~20 积分
CREATE TABLE IF NOT EXISTS wallet_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('balance','points')),
  change_cents INTEGER NOT NULL DEFAULT 0,  -- 余额变动（分）
  change_points INTEGER NOT NULL DEFAULT 0, -- 积分变动
  reason TEXT NOT NULL,       -- 如 签到 / 兑换工具 / 购买脚本 / 充值 / 卡密兑换
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_logs(user_id, kind, created_at DESC);

-- 签到：每自然日 0 点刷新一次，送 5~15 积分随机，积分不清零
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_date TEXT NOT NULL,   -- YYYY-MM-DD（自然日）
  points_given INTEGER NOT NULL, -- 5~15 随机
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, check_date)
);

-- 下载记录：工具/脚本下载；月费免费额度按（用户，工具，周期）去重
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES articles(id),
  tool_name TEXT NOT NULL,
  cost_type TEXT NOT NULL CHECK (cost_type IN ('free_quota','points','balance','member_free','paid')),
  cost_points INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id, created_at DESC);

-- ================= 卡密 =================
-- 后台生成；金额、有效期都可自定义；每张兑换后都有对应订单，记清是哪个用户兑的
CREATE TABLE IF NOT EXISTS card_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL, -- 余额额度（分）
  status TEXT NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused','used','void')),
  expires_at TEXT,               -- 自定义有效期，可空（一直有效）
  used_by INTEGER REFERENCES users(id),
  used_at TEXT,
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_card_codes_code ON card_codes(code);

-- ================= 排行榜开关 =================
-- 用户在个人中心自选：积分上榜 / 余额上榜两个独立开关；默认都上榜
-- 实际开关存在 users.show_on_points_board / show_on_balance_board，本表留作审计
CREATE TABLE IF NOT EXISTS leaderboard_optins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board TEXT NOT NULL CHECK (board IN ('points','balance')),
  opted_in INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, board)
);

-- ================= 部署申请 =================
-- v5 定稿：申请表就是订单（orders 表，product_type='free_deploy'），不另建表。
-- 本表仅作 v5 之前草案的兼容占位，不再写入新数据；新申请一律走 orders 表。
CREATE TABLE IF NOT EXISTS deployment_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_type TEXT,
  system_info TEXT,
  contact_qq TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ================= 站点设置 =================
-- 导航栏、收款码、通知邮箱、签到规则、会员套餐展示等全部后台基本设置可改
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
