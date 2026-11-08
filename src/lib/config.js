// AI指南 — 站点配置（v5 定稿，不写死年费价格）
// 会员价格、套餐名、权限全部后台自定义（membership_plans 表），这里只放展示用常量。
export const SITE = {
  name: 'AI指南',
  domain: 'openzn.cc',
  // 未来域名 openzn.cc（阿里云买后改 Nameserver 到主号）；过渡期先用 workers.dev
  url: 'https://openzn.workers.dev',
  launchDate: '2026-11-08',
  qqGroup: '13916509',
  adminQQ: '446099815',
  adminEmail: 'qq446099815@gmail.com',
  notifyEmail: 'qq446099815@gmail.com',
  notifyEmailBackup: 'v998ip@gmail.com',
  aboutLines: ['智能领航，部署无忧', '教程详尽，小白不慌', '工具齐备，效率飞扬', '会员同行，未来辉煌'],
};

// 默认导航 6 项（后台基本设置可改）
export const DEFAULT_NAV = [
  { label: '首页', href: '/' },
  { label: '文章', href: '/articles' },
  { label: '会员', href: '/member' },
  { label: '我的', href: '/me' },
  { label: '智能简介', href: '/category/intro' },
  { label: '部署教程', href: '/category/deploy' },
];

// 11 个分类（v5 定稿），visibility：free / reply / points / member
export const CATEGORIES = [
  { slug: 'intro', name: '智能简介', visibility: 'free', desc: '什么是 OpenClaw、什么是 Hermes，各版本特点' },
  { slug: 'deploy', name: '部署教程', visibility: 'free', desc: '电脑本地、VPS、安卓手机部署方案' },
  { slug: 'env', name: '环境配置', visibility: 'reply', desc: '不同设备所需依赖环境' },
  { slug: 'commands', name: '专属命令', visibility: 'free', desc: '所有命令，按功能展示' },
  { slug: 'prompts', name: '提示词汇', visibility: 'free', desc: '如何与智能体交流、让它更聪明' },
  { slug: 'models', name: '模型接入', visibility: 'free', desc: '模型商注册链接，key / api / url 怎么填' },
  { slug: 'scripts', name: '部署脚本', visibility: 'member', desc: '一键部署脚本，会员或付费才能下载' },
  { slug: 'tools', name: '工具下载', visibility: 'points', desc: 'SSH 工具、模型商 APP、Termux 等' },
  { slug: 'vip', name: '会员专属', visibility: 'member', desc: '最值钱的内容，只有会员可见' },
  { slug: 'pitfalls', name: '踩坑经历', visibility: 'free', desc: '部署路上踩过的坑' },
  { slug: 'faq', name: '常见问题', visibility: 'free', desc: '常见问题解答' },
];

// 余额充值档位（分）：充 50 到账 53、充 120 到账 130、充 300 到账 320，最低 10 元
export const RECHARGE_TIERS = [
  { pay: 1000, credit: 1000, gift: 0 },
  { pay: 5000, credit: 5300, gift: 300 },
  { pay: 12000, credit: 13000, gift: 1000 },
  { pay: 30000, credit: 32000, gift: 2000 },
];

export const CHECKIN = { min: 5, max: 15 }; // 签到 5~15 积分随机，按自然日 0 点刷新
export const TOOL_POINTS = { min: 10, max: 20 }; // 工具兑换价后台自定义，10~20 积分
export const MONTHLY_QUOTA = { tools: 5, scripts: 1, deploys: 1 }; // 月费每月
export const YEARLY_DEPLOY_EVERY_2_MONTHS = 1; // 年费每两个月 1 次免费部署，一年 6 次

// 免费层额度（Cloudflare 官方免费层，2026-11-08 核对）
export const FREE_LIMITS = {
  workersRequestsPerDay: 100000,
  kvReadsPerDay: 100000,
  kvWritesPerDay: 1000,
  d1RowsReadPerDay: 5000000,
  d1RowsWrittenPerDay: 100000,
  d1MaxPerDbMB: 500,
  d1TotalGB: 5,
};

// 运行天数：从上线日算起
export function daysRunning(now = new Date()) {
  const start = new Date(SITE.launchDate + 'T00:00:00+08:00');
  return Math.max(1, Math.floor((now - start) / 86400000) + 1);
}
