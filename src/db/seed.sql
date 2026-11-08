-- AI指南（openzn）D1 种子数据 v5
-- 执行：npx wrangler d1 execute openzn-db --file=src/db/seed.sql
-- 注意：年费价格不写死，后台自定义；下面年费套餐先设为未启用、价格 0，
-- 站长在后台填好价格后再启用。月费示例 29 元（2900 分）。

-- 11 个分类（v5 定稿）
INSERT OR IGNORE INTO categories (id, slug, name, description, visibility, sort_order) VALUES
(1, 'intro', '智能简介', '什么是 OpenClaw、什么是 Hermes，各版本特点，每更新一个版本写一篇更新内容', 'free', 1),
(2, 'deploy', '部署教程', '网上最常见部署方案：电脑本地、VPS、安卓手机如何部署 OpenClaw 或 Hermes', 'free', 2),
(3, 'env', '环境配置', '不同设备所需依赖环境，如何下载配置', 'reply', 3),
(4, 'commands', '专属命令', '所有命令，按每个功能展示，免费供大家使用', 'free', 4),
(5, 'prompts', '提示词汇', '如何正常与 OpenClaw / Hermes 交流，如何让智能体更聪明', 'free', 5),
(6, 'models', '模型接入', '推广各大模型提供商注册链接，教 key、api、url 怎么填', 'free', 6),
(7, 'scripts', '部署脚本', '自己写的一键部署脚本（电脑 / VPS / 安卓），会员或付费才能下载', 'member', 7),
(8, 'tools', '工具下载', 'SSH 工具、各大模型商 APP、安卓 Termux 等', 'points', 8),
(9, 'vip', '会员专属', '最值钱的内容，只有会员可见', 'member', 9),
(10, 'pitfalls', '踩坑经历', '部署路上踩过的坑', 'free', 10),
(11, 'faq', '常见问题', '常见问题解答', 'free', 11);

-- 会员套餐：月费示例 29 元；年费价格后台自定义（此处不写死，先未启用）
INSERT OR IGNORE INTO membership_plans (id, slug, name, price_cents, duration_days, permissions_json, is_active) VALUES
(1, 'monthly', '月费会员', 2900, 30,
 '{"free_tools_per_month":5,"free_script_per_month":1,"free_deploy_per_month":1,"reply_visible_free":true,"qq_group":true,"one_on_one":true}', 1),
(2, 'yearly', '年费会员', 0, 365,
 '{"free_tools_per_month":0,"free_script_per_month":0,"free_deploy_per_2months":1,"reply_visible_free":true,"qq_group":true,"one_on_one":true,"unlimited":true}', 0);

-- 站点设置：导航默认 6 项；关于本站 4 句；通知邮箱；签到规则
INSERT OR IGNORE INTO site_settings (key, value) VALUES
('nav_items', '[{"label":"首页","href":"/"},{"label":"文章","href":"/articles"},{"label":"会员","href":"/member"},{"label":"我的","href":"/me"},{"label":"智能简介","href":"/category/intro"},{"label":"部署教程","href":"/category/deploy"}]'),
('about_lines', '["智能领航，部署无忧","教程详尽，小白不慌","工具齐备，效率飞扬","会员同行，未来辉煌"]'),
('site_launch_date', '2026-11-08'),
('notify_email', 'qq446099815@gmail.com'),
('notify_email_backup', 'v998ip@gmail.com'),
('qq_group', '13916509'),
('checkin_min', '5'),
('checkin_max', '15'),
('tool_points_min', '10'),
('tool_points_max', '20'),
('recharge_tiers', '[{"pay":1000,"credit":1000},{"pay":5000,"credit":5300},{"pay":12000,"credit":13000},{"pay":30000,"credit":32000}]'),
('no_refund_notice', '虚拟资源不支持退款：用户付款后即视为同意部署服务或已看中该商品。');

-- 示例置顶文章（2 篇，v5 定稿示例；正文由站长在后台正式撰写后替换）
INSERT OR IGNORE INTO articles (id, slug, category_id, tag, title, summary, content, visibility, is_pinned, pin_order, status) VALUES
(1, 'what-is-openclaw', 1, 'OpenClaw',
 '什么是 OpenClaw？它有哪些用途？',
 'OpenClaw 入门第一篇：它是什么，能帮你做什么，新人先看这篇再看部署教程。',
 '# 什么是 OpenClaw？它有哪些用途？

> 本文为示例占位正文，正式内容由站长在后台撰写后替换。

OpenClaw 是一个开源的 AI 智能体框架，可以帮你把大模型变成能干活的助手。

[reply]
这里是回复可见的隐藏命令示例，点一下编辑器的“回复可见”就会自动插入这段格式。
[/reply]

```bash
# 示例命令（点右上角复制）
echo "hello openclaw"
```',
 'free', 1, 1, 'published'),
(2, 'what-is-hermes', 1, 'Hermes',
 '什么是 Hermes？它与 OpenClaw 有哪些不同，有什么用途？',
 'Hermes 入门第一篇：它和 OpenClaw 的区别、各自适合什么场景。',
 '# 什么是 Hermes？它与 OpenClaw 有哪些不同？

> 本文为示例占位正文，正式内容由站长在后台撰写后替换。

Hermes 是另一类智能体方案，侧重不同的部署与使用方式，具体区别见正文。

[vip]
这里是会员可见的隐藏内容示例。
[/vip]',
 'free', 1, 2, 'published'),
(3, 'deploy-pc-quickstart', 2, 'OpenClaw',
 '电脑本地快速上手：部署 OpenClaw 第一步',
 '部署教程第一篇：电脑本地部署的完整流程，命令在中后期隐藏，仅回复可见。',
 '# 电脑本地快速上手

先按步骤准备环境，再执行下面的命令。

[reply]
```bash
# 中后期命令（回复可见）
echo "deploy openclaw on pc"
```
[/reply]',
 'free', 0, 0, 'published');
