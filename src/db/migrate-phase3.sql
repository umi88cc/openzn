-- AI指南（openzn）第三期迁移 v5
-- 执行（在 schema.sql 之后）：npx wrangler d1 execute openzn-db --file=src/db/migrate-phase3.sql
-- 本地：npx wrangler d1 execute openzn-db --local --file=src/db/migrate-phase3.sql
-- 1) 订单商品类型加 'script'（余额买部署脚本）；
-- 2) 新增 audit_logs（后台操作日志）。
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS orders_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL CHECK (product_type IN
    ('monthly','yearly','balance_recharge','card_code','free_script','free_deploy','free_tool','script')),
  product_name TEXT NOT NULL,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT CHECK (pay_method IN ('balance','alipay','wechat',NULL)),
  pay_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','success','rejected','cancelled')),
  remark TEXT DEFAULT '',
  device_type TEXT,
  system_info TEXT,
  contact_qq TEXT,
  deploy_status TEXT CHECK (deploy_status IN ('pending','processing','completed',NULL)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
INSERT OR IGNORE INTO orders_new
  (id, order_no, user_id, product_type, product_name, total_cents, paid_cents, credit_cents,
   pay_method, pay_ref, status, remark, device_type, system_info, contact_qq, deploy_status, created_at, paid_at)
  SELECT id, order_no, user_id, product_type, product_name, total_cents, paid_cents, credit_cents,
   pay_method, pay_ref, status, remark, device_type, system_info, contact_qq, deploy_status, created_at, paid_at
  FROM orders;
DROP TABLE IF EXISTS orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_id, created_at DESC);

PRAGMA foreign_keys = ON;
