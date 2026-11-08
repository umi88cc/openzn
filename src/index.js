// AI指南（openzn）— Workers 入口（Hono，v5 第一期骨架）
// 只用 Cloudflare 免费层：Workers + KV + D1；前期只部署在主号 228522198@qq.com。
// 每个功能有对应文件，1 层 1 层调用；分享功能已去掉，不做。
import { Hono } from 'hono';
import { pageHTML } from './lib/render.js';
import { homeRoutes } from './routes/home.js';
import { articleRoutes } from './routes/articles.js';
import { categoryRoutes } from './routes/categories.js';
import { searchRoutes } from './routes/search.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { authRoutes } from './routes/auth.js';
import { interactRoutes } from './routes/interact.js';
import { membershipRoutes } from './routes/membership.js';
import { orderRoutes } from './routes/orders.js';
import { wealthRoutes } from './routes/wealth.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';
import { adminApiRoutes } from './routes/admin-api.js';
import { chatbotRoutes } from './routes/chatbot.js';
import { expiryReminderScan } from './lib/orders.js';
import { dailyDigest, pendingOrderRemind } from './lib/ai.js';

const app = new Hono();

// 静态资源（public/）由 wrangler [assets] 托管，免费不限量，不计 Workers 请求数。
app.route('/', homeRoutes);
app.route('/', articleRoutes);
app.route('/', categoryRoutes);
app.route('/', searchRoutes);
app.route('/', leaderboardRoutes);
app.route('/', authRoutes);
app.route('/', interactRoutes);
app.route('/', membershipRoutes);
app.route('/', orderRoutes);
app.route('/', wealthRoutes);
app.route('/', meRoutes);
app.route('/', adminRoutes);
app.route('/', adminApiRoutes);
app.route('/', chatbotRoutes);

// 底部右栏静态页占位（第二期 / 第三期补正式文案）
const simplePage = (title, text) => (c) =>
  c.html(pageHTML({ title, active: '/', bottomActive: 'home', body: `<h1>${title}</h1><p class="muted">${text}</p><p><a href="/">← 回首页</a></p>` }));
app.get('/links', simplePage('友链申请', '友链申请方式由站长在后台基本设置里填写后展示（第三期）。'));
app.get('/disclaimer', simplePage('免责声明', '本站内容仅供学习交流；部署操作请自行备份数据，风险自担。正式文案第三期补。'));
app.get('/ads', simplePage('广告合作', '广告合作请扫底部 QQ / 微信咨询二维码联系站长。'));
app.get('/about', simplePage('关于我们', 'AI指南（openzn.cc）：OpenClaw 与 Hermes 部署指南。智能领航，部署无忧；教程详尽，小白不慌；工具齐备，效率飞扬；会员同行，未来辉煌。'));

// 健康检查（部署后验证用，不占 D1/KV）
app.get('/api/health', (c) => c.json({ ok: true, site: 'AI指南 openzn', phase: 5, spec: 'v5' }));

app.notFound((c) => c.html(pageHTML({
  title: '页面不存在', active: '/', bottomActive: 'home',
  body: '<h1>404 · 页面不存在</h1><p class="muted">这个链接可能被移走了，试试搜一下文章标题。</p><p><a href="/">← 回首页</a></p>',
}), 404));

export default {
  fetch: app.fetch,
  // 定时任务：每天 09:00（上海时间 = UTC 01:00）扫描 7 天内到期会员并邮件提醒。
  // wrangler.toml 的 [triggers] crons = ["0 1 * * *"]；本地 wrangler dev 不跑定时，
  // 后台“基本设置 / 会员管理”里有手动触发按钮（POST /api/admin/expiry-remind）。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(expiryReminderScan(env.DB, env).catch((e) => console.error('expiry reminder failed', e)));
    // 第四期：每日汇总开关开着时，09:00 再推一条飞书汇总（待审核订单/评论/到期会员）。
    ctx.waitUntil(dailyDigest(env.DB, env).catch((e) => console.error('daily digest failed', e)));
    // 第四期补全：待审核订单超时提醒开关开着时，09:00 再推一次超 24 小时没处理的订单。
    ctx.waitUntil(pendingOrderRemind(env.DB, env).catch((e) => console.error('pending order remind failed', e)));
  },
};
