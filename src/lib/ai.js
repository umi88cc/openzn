// AI指南 — 智能管理核心（第四期）
// 多模型多 Key 自动切换 + 飞书机器人提醒。
// 模型不限英伟达：NVIDIA / OpenRouter / DeepSeek / 通义千问 / Kimi / GLM
// 都是 OpenAI 兼容的 /chat/completions 接口，换 base_url + model + key 就行。
// 原则：AI 只提醒、不自动通过付款订单；通过订单永远是站长手动点。
// Key 安全：只存加密串（v1:base64），前台绝不返回完整 Key，后台只显示后 4 位；
// 加密密钥优先用 wrangler secret AI_KEY_SECRET（npx wrangler secret put AI_KEY_SECRET），
// 没设时用 D1 里随机生成的 ai_key_salt 做混淆——那只是防明文泄露，不是真加密，
// 换了 AI_KEY_SECRET 后旧 Key 要重新填。Key 绝不写进日志、绝不提交到 GitHub。
import { SITE, CATEGORIES, CHECKIN, TOOL_POINTS } from './config.js';
import { shanghaiDate } from './membership.js';
import { moderateComment } from './moderation.js';

export const AI_TIMEOUT_MS = 10000; // 单个模型/Key 最多等 10 秒，超时切下一个
export const AI_SWITCH_WAIT_MS = 1000; // 429 限流时等 1 秒再切下一个，不死循环

// ---------- 开关与飞书配置（存在 site_settings，默认全关） ----------
export const AI_SWITCHES = [
  { key: 'ai_comment_review', label: '评论 AI 审核', desc: '开后新评论先走 AI 审：AI 判违规/广告/外链/骂人进待审核，干净的直接显示，AI 拿不准的也进待审核不直接放行。关了就走原来关键词 + 外链规则。' },
  { key: 'ai_order_notify', label: '订单 AI 提醒', desc: '开后新订单（扫码待审核、免费部署申请、免费领脚本）生成时，AI 先汇总一句话（谁、买什么、多少钱、订单号），再推飞书。AI 只汇总提醒，不自动通过付款订单，通过还是站长手动点。' },
  { key: 'ai_expiry_notify', label: '会员到期 AI 提醒', desc: '开后会员到期提醒（7 天内到期）除了发邮件，也推一条飞书给你。' },
  { key: 'ai_register_notify', label: '新用户注册提醒', desc: '开后有人注册新账号，推一条飞书给你（只写用户名和 QQ，不推密码）。' },
  { key: 'ai_daily_digest', label: '每日汇总', desc: '开后每天 09:00（上海时间）汇总一次待审核订单、待审核评论、7 天内到期会员，推一条飞书，和邮件提醒并行。' },
  { key: 'ai_comment_notify', label: '评论推送', desc: '开后有人在文章下发评论就推一条飞书：谁、在哪篇文章下、评论前 100 字、是直接显示还是待审核。不开就不推。' },
  { key: 'ai_polish', label: 'AI 润色文章', desc: '开后后台写文章的编辑器里出现 AI 润色按钮：润色、扩写、精简、换标题、检查错别字。结果先放预览框，站长点“采用”才替换进编辑器，绝不自动改原文。' },
  { key: 'ai_pending_order_remind', label: '待审核订单超时提醒', desc: '开后有待审核订单超过 24 小时还没处理，每天 09:00 再推一次飞书提醒你，别让订单一直晾着。' },
  { key: 'ai_expiry_3day', label: '会员到期前 3 天再推一次', desc: '开后会员到期前 3 天再推一条飞书（7 天提醒之外多一次），免得只提醒一次站长没看到。' },
  { key: 'ai_like_spike', label: '点赞/收藏异常提醒', desc: '开后同一个用户 10 分钟内点赞加收藏超过 20 次就推一条飞书提醒你（可能是刷数据），1 小时内同一人只推一次。' },
  { key: 'ai_chatbot', label: '网站小助手（前端聊天机器人）', desc: '开后前台右下角显示小机器人按钮，只有登录用户能和小助手聊天；关了前台不显示按钮。' },
  { key: 'ai_chatbot_show_qr', label: '聊天框里显示咨询二维码', desc: '开后小助手聊天框顶部显示 QQ / 微信咨询二维码，方便用户扫码联系站长；关了不显示。' },
];

export const CHATBOT_DEFAULT_WELCOME = '你好，我是 AI指南小助手，有什么部署问题可以问我';
export const CHATBOT_DEFAULT_DAILY_LIMIT = 20;
export const CHATBOT_CONTACT_KEYS = ['chatbot_contact_qq', 'chatbot_contact_group', 'chatbot_contact_email', 'chatbot_contact_wechat', 'chatbot_contact_note'];
export const CHATBOT_SETTING_KEYS = ['chatbot_welcome', 'chatbot_daily_limit', ...CHATBOT_CONTACT_KEYS];

export async function getAISettings(db) {
  const out = { feishu_webhook: '', feishu_app_id: '', feishu_app_secret: '' };
  for (const s of AI_SWITCHES) out[s.key] = false;
  out.chatbot_welcome = CHATBOT_DEFAULT_WELCOME;
  out.chatbot_daily_limit = String(CHATBOT_DEFAULT_DAILY_LIMIT);
  for (const k of CHATBOT_CONTACT_KEYS) out[k] = '';
  if (!db) return out;
  try {
    const keys = ['feishu_webhook', 'feishu_app_id', 'feishu_app_secret', ...AI_SWITCHES.map((s) => s.key), ...CHATBOT_SETTING_KEYS];
    for (const k of keys) {
      const row = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind(k).first();
      if (row) out[k] = AI_SWITCHES.some((s) => s.key === k) ? row.value === '1' : row.value;
    }
  } catch { /* 旧库没跑迁移也不阻塞 */ }
  return out;
}

// 聊天机器人设置（给聊天接口和后台页面共用）：只返回站长在后台填好的联系方式，没填的不推。
export async function getChatbotSettings(db) {
  const s = await getAISettings(db);
  const limit = Math.min(100, Math.max(1, Number(s.chatbot_daily_limit) || CHATBOT_DEFAULT_DAILY_LIMIT));
  const contact = {
    qq: String(s.chatbot_contact_qq || '').trim(),
    group: String(s.chatbot_contact_group || '').trim(),
    email: String(s.chatbot_contact_email || '').trim(),
    wechat: String(s.chatbot_contact_wechat || '').trim(),
    note: String(s.chatbot_contact_note || '').trim(),
  };
  return {
    enabled: !!s.ai_chatbot,
    showQr: !!s.ai_chatbot_show_qr,
    welcome: String(s.chatbot_welcome || CHATBOT_DEFAULT_WELCOME).slice(0, 200),
    dailyLimit: limit,
    contact,
    hasContact: Object.values(contact).some((v) => v),
  };
}

export async function setAISetting(db, key, value) {
  await db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
  ).bind(key, String(value)).run();
}

// ---------- Key 加密（XOR + SHA-256 密钥，WebCrypto，Workers/Node 都可用） ----------
async function sha256Bytes(secret) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret)));
  return new Uint8Array(data);
}

async function getKeySecret(db, env) {
  if (env?.AI_KEY_SECRET) return String(env.AI_KEY_SECRET);
  if (!db) return 'openzn-dev-only-not-for-production';
  const row = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind('ai_key_salt').first();
  if (row?.value) return row.value;
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  try {
    await db.prepare("INSERT OR IGNORE INTO site_settings (key, value) VALUES ('ai_key_salt', ?)").bind(salt).run();
  } catch { /* 忽略 */ }
  return salt;
}

function b64encode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptKey(db, env, plain) {
  const secret = await getKeySecret(db, env);
  const key = await sha256Bytes(secret);
  const data = new TextEncoder().encode(String(plain));
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return `v1:${b64encode(out)}`;
}

export async function decryptKey(db, env, enc) {
  if (!enc || !String(enc).startsWith('v1:')) return null;
  try {
    const secret = await getKeySecret(db, env);
    const key = await sha256Bytes(secret);
    const data = b64decode(String(enc).slice(3));
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
    return new TextDecoder().decode(out);
  } catch {
    return null; // 换了 AI_KEY_SECRET 后旧 Key 解不开，返回 null，调用方跳过这条 Key
  }
}

export function maskKey(plain) {
  const s = String(plain || '');
  return s.length <= 4 ? '****' : `****${s.slice(-4)}`;
}

// ---------- 模型 + Key 列表 ----------
// listAIModels：给后台页面用，Key 只给后 4 位，绝不给完整 Key。
export async function listAIModels(db) {
  if (!db) return [];
  const { results: models } = await db.prepare(
    'SELECT * FROM ai_models ORDER BY sort_order ASC, id ASC'
  ).all().catch(() => ({ results: [] }));
  const out = [];
  for (const m of models || []) {
    const { results: keys } = await db.prepare(
      'SELECT id, label, key_last4, sort_order, is_active, last_used_at, fail_count, created_at FROM ai_keys WHERE model_id=? ORDER BY sort_order ASC, id ASC'
    ).bind(m.id).all().catch(() => ({ results: [] }));
    out.push({ ...m, keys: keys || [] });
  }
  return out;
}

// getAIEndpoints：内部调用用，按模型排序、Key 排序展开成调用端点，Key 解密后才用。
export async function getAIEndpoints(db, env) {
  const models = await listAIModels(db);
  const endpoints = [];
  for (const m of models) {
    if (!m.is_active) continue;
    for (const k of m.keys || []) {
      if (!k.is_active) continue;
      const plain = await decryptKey(db, env, await db.prepare('SELECT key_enc FROM ai_keys WHERE id=?').bind(k.id).first().then((r) => r?.key_enc));
      if (!plain) continue; // 解不开（换了密钥）就跳过，不阻塞后面的 Key
      endpoints.push({
        modelId: m.id, keyId: k.id, name: m.name, provider: m.provider,
        baseUrl: String(m.base_url || '').replace(/\/$/, ''),
        model: m.model, apiKey: plain, keyLast4: k.key_last4 || maskKey(plain),
      });
    }
  }
  return endpoints;
}

async function logAI(db, entry) {
  if (!db) return;
  try {
    await db.prepare(
      'INSERT INTO ai_logs (purpose, model_name, provider, key_last4, ok, error, latency_ms) VALUES (?,?,?,?,?,?,?)'
    ).bind(entry.purpose, entry.modelName || '', entry.provider || '', entry.keyLast4 || '', entry.ok ? 1 : 0, String(entry.error || '').slice(0, 200), entry.latencyMs || 0).run();
  } catch { /* 日志表不存在也不阻塞主流程 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 核心：按顺序试，失败自动切下一个 ----------
// 返回 { ok, text, model, provider, keyLast4, attempts:[{model,keyLast4,ok,error,latencyMs}] }
// 全部试完才报错；429 时等 1 秒再切下一个，不死循环；超时 10 秒切下一个。
export async function callAI(db, env, { prompt, system, purpose = 'chat', timeoutMs = AI_TIMEOUT_MS, maxTokens = 512 } = {}) {
  const endpoints = await getAIEndpoints(db, env);
  const attempts = [];
  if (!endpoints.length) return { ok: false, error: '没有可用的模型：请先在后台智能管理里填 Key 并启用模型', attempts };
  const sys = system || '你是一个简洁的中文助手，只按要求输出，不要多余解释。';
  for (const ep of endpoints) {
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${ep.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${ep.apiKey}`,
          'Content-Type': 'application/json',
          ...(ep.provider === 'openrouter' ? { 'HTTP-Referer': SITE.url, 'X-Title': SITE.name } : {}),
        },
        body: JSON.stringify({
          model: ep.model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
        }),
      });
      const latencyMs = Date.now() - started;
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        const err = res.status === 429 ? `限流 429（${ep.name}）` : `模型返回 ${res.status}（${ep.name}）`;
        attempts.push({ model: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: false, error: err, latencyMs });
        await logAI(db, { purpose, modelName: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: false, error: err, latencyMs });
        try { await db.prepare('UPDATE ai_keys SET fail_count = fail_count + 1 WHERE id=?').bind(ep.keyId).run(); } catch { /* 忽略 */ }
        if (res.status === 429) await sleep(AI_SWITCH_WAIT_MS);
        continue;
      }
      let content = '';
      try { content = JSON.parse(text)?.choices?.[0]?.message?.content || ''; } catch { content = ''; }
      if (!content.trim()) {
        attempts.push({ model: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: false, error: '模型返回空内容', latencyMs });
        await logAI(db, { purpose, modelName: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: false, error: '模型返回空内容', latencyMs });
        continue;
      }
      attempts.push({ model: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: true, latencyMs });
      await logAI(db, { purpose, modelName: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: true, latencyMs });
      try { await db.prepare("UPDATE ai_keys SET last_used_at=datetime('now'), fail_count=0 WHERE id=?").bind(ep.keyId).run(); } catch { /* 忽略 */ }
      return { ok: true, text: content.trim(), model: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, attempts };
    } catch (e) {
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      const err = e?.name === 'AbortError' ? `超时 ${timeoutMs}ms（${ep.name}）` : `调用失败：${e?.message || e}（${ep.name}）`;
      attempts.push({ model: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: false, error: err, latencyMs });
      await logAI(db, { purpose, modelName: ep.name, provider: ep.provider, keyLast4: ep.keyLast4, ok: false, error: err, latencyMs });
      try { await db.prepare('UPDATE ai_keys SET fail_count = fail_count + 1 WHERE id=?').bind(ep.keyId).run(); } catch { /* 忽略 */ }
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: '全部模型都调不通：' + attempts.map((a) => `${a.model}（${a.error}）`).join('；'), attempts };
}

// ---------- 评论 AI 审核 ----------
// 只返回 verdict：clean（干净）/ suspicious（拿不准）/ violation（违规）。
// AI 失败、没配模型时返回 used:false，调用方退回原来关键词规则，不阻塞发评论。
// AI 判不准的也进待审核，绝不直接放行。
export async function moderateCommentWithAI(db, env, content) {
  const r = await callAI(db, env, {
    purpose: 'comment_moderation',
    system: '你是网站评论审核员。只输出 JSON，不要其他文字。',
    prompt: `判断下面这条网站评论是否违规。违规包括：色情、赌博、毒品、法轮功、政治敏感、骂人脏话、广告引流、站外链接、刷单办证。只输出 JSON：{"verdict":"clean" 或 "suspicious" 或 "violation","reason":"一句话原因，不超过30字"}。\n评论内容：${String(content || '').slice(0, 1000)}`,
  });
  if (!r.ok) return { used: false, verdict: 'unknown', reason: r.error };
  const m = String(r.text).match(/\{[^}]*\}/);
  if (!m) return { used: true, verdict: 'suspicious', reason: 'AI 返回格式不对，转人工审核' };
  try {
    const j = JSON.parse(m[0]);
    const verdict = ['clean', 'suspicious', 'violation'].includes(j.verdict) ? j.verdict : 'suspicious';
    return { used: true, verdict, reason: String(j.reason || '').slice(0, 60), model: r.model };
  } catch {
    return { used: true, verdict: 'suspicious', reason: 'AI 返回解析失败，转人工审核' };
  }
}

// ---------- 飞书推送（webhook 卡片；App ID/Secret 存好备用，以后发应用消息用） ----------
export async function sendFeishu(db, env, { title, content, link }) {
  const settings = await getAISettings(db);
  const webhook = env?.FEISHU_WEBHOOK || settings.feishu_webhook;
  if (!webhook) return { ok: false, error: '未配置飞书机器人 webhook 地址，请先在后台智能管理里填' };
  // 正式地址要求 https；http 只放行本地测试（http://localhost / 127.0.0.1）
  if (!/^https:\/\//.test(webhook) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(webhook)) return { ok: false, error: '飞书机器人地址不对，要以 https:// 开头' };
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'interactive',
        card: {
          header: { title: { tag: 'plain_text', content: String(title || 'AI指南提醒').slice(0, 100) } },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: String(content || '').slice(0, 900) } },
            ...(link ? [{ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '打开后台查看' }, type: 'primary', url: link }] }] : []),
          ],
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data.StatusCode !== undefined && data.StatusCode !== 0)) {
      return { ok: false, error: `飞书推送失败（${res.status}）：${data.msg || data.StatusMessage || '请检查 webhook 地址对不对'}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `飞书推送失败：${e?.message || e}` };
  }
}

// ---------- 订单 AI 汇总 + 推飞书（只提醒，不自动通过） ----------
export async function notifyOrderAI(db, env, order, user) {
  const settings = await getAISettings(db);
  if (!settings.ai_order_notify) return { ok: false, skipped: true, reason: '订单 AI 提醒开关没开' };
  const info = `用户 ${user?.username || ''}（QQ ${user?.qq || ''}），商品：${order.product_name}，金额 ¥${((order.paid_cents || 0) / 100).toFixed(2)}，订单号 ${order.order_no}，状态 ${order.status === 'pending' ? '待审核' : order.status}。`;
  let summary = info;
  const r = await callAI(db, env, {
    purpose: 'order_summary',
    prompt: `把下面这笔订单汇总成一句话（不超过 60 字，说明谁、买什么、多少钱、订单号、要不要审核）：${info}`,
  });
  if (r.ok && r.text) summary = r.text;
  // 汇总文案后面固定附上订单号（AI 汇总可能漏写，站长在飞书里一眼就能看到是哪个订单）。
  const content = `${summary}\n订单号：${order.order_no}`;
  const link = `${SITE.url}/admin/orders/${order.id}`;
  const sent = await sendFeishu(db, env, { title: '🧾 新订单提醒', content, link });
  return { ok: sent.ok, summary, aiUsed: r.ok, model: r.model, feishu: sent };
}

// ---------- 会员到期飞书提醒（邮件之外再推一条） ----------
export async function notifyExpiryFeishu(db, env, expiring) {
  const settings = await getAISettings(db);
  if (!settings.ai_expiry_notify) return { ok: false, skipped: true };
  if (!expiring?.length) return { ok: false, skipped: true, reason: '没有 7 天内到期的会员' };
  const lines = expiring.map((m) => `· ${m.username}（${m.email}）到期 ${m.expires_at}`).join('\n');
  return sendFeishu(db, env, {
    title: '⏰ 会员到期提醒',
    content: `7 天内到期 ${expiring.length} 人：\n${lines}`,
    link: `${SITE.url}/admin/members`,
  });
}

// ---------- 评论推送（第四期补全）：有人发评论就推一条飞书，只提醒不拦截 ----------
// 不管评论是直接显示还是待审核都推；推失败不阻塞发评论（调用方 catch）。
export async function notifyComment(db, env, { commentId, article, user, status, content }) {
  const settings = await getAISettings(db);
  if (!settings.ai_comment_notify) return { ok: false, skipped: true, reason: '评论推送开关没开' };
  const text = String(content || '');
  const preview = text.slice(0, 100) + (text.length > 100 ? '……' : '');
  return sendFeishu(db, env, {
    title: '💬 新评论',
    content: `用户 ${user?.username || ''} 在《${article?.title || ''}》下评论：\n${preview}\n状态：${status === 'approved' ? '直接显示' : '待审核'}`,
    link: `${SITE.url}/admin/comments?status=${status === 'approved' ? 'approved' : 'pending'}`,
  });
}

// ---------- AI 润色文章（第四期补全）：只建议、不自动改原文 ----------
// mode：polish 润色 / expand 扩写 / shorten 精简 / title 换标题 / check 错别字检查。
// 结果由调用方先放预览框，站长点“采用”才替换进编辑器；开关关着时直接拒绝。
export const POLISH_MODES = {
  polish: { label: 'AI 润色', prompt: '把下面这段文字润色得更通顺、更专业，保持原意和 Markdown 格式，不要增删事实，只输出润色后的正文，不要解释。' },
  expand: { label: '扩写', prompt: '把下面这段文字扩写得更详细，补充步骤和注意事项，保持 Markdown 格式，只输出扩写后的正文，不要解释。' },
  shorten: { label: '精简', prompt: '把下面这段文字精简，保留关键信息和步骤，去掉啰嗦的话，只输出精简后的正文，不要解释。' },
  title: { label: '换标题', prompt: '给下面这篇文章起 3 个吸引人的中文标题，每行一个，只输出标题，不要解释。' },
  check: { label: '检查错别字', prompt: '检查下面这段文字的错别字、标点错误和排版问题，列出问题和改正建议，一条一行；没有问题就只输出“没有发现问题”。' },
};

export async function polishArticle(db, env, { text, mode }) {
  const settings = await getAISettings(db);
  if (!settings.ai_polish) return { ok: false, error: 'AI 润色开关没开，请先在后台智能管理里打开“AI 润色文章”' };
  const m = POLISH_MODES[mode];
  if (!m) return { ok: false, error: '润色方式不对（可选：润色 / 扩写 / 精简 / 换标题 / 检查错别字）' };
  const input = String(text || '').trim();
  if (!input) return { ok: false, error: '请先在编辑器里写点内容，或选中一段文字再润色' };
  if (input.length > 8000) return { ok: false, error: '一次最多润色 8000 字，太长请分段润色' };
  const r = await callAI(db, env, {
    purpose: mode === 'check' ? 'spellcheck' : 'polish',
    prompt: `${m.prompt}\n\n${input}`,
    maxTokens: 1024,
  });
  if (!r.ok) return { ok: false, error: r.error, attempts: r.attempts };
  return { ok: true, result: r.text, model: r.model, mode };
}

// ---------- 点赞/收藏异常提醒（第四期补全）：同一人 10 分钟内点赞+收藏超 20 次 ----------
// 只提醒站长看一眼，不自动删点赞、不封号；1 小时内同一人只推一次，免得刷屏。
export async function notifyLikeSpike(db, env, user) {
  const settings = await getAISettings(db);
  if (!settings.ai_like_spike) return { ok: false, skipped: true, reason: '点赞/收藏异常提醒开关没开' };
  if (!db) return { ok: false, error: '数据库未就绪' };
  const likes = await db.prepare("SELECT COUNT(*) AS n FROM likes WHERE user_id=? AND created_at >= datetime('now','-10 minutes')").bind(user.id).first();
  const favs = await db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE user_id=? AND created_at >= datetime('now','-10 minutes')").bind(user.id).first();
  const total = (likes?.n || 0) + (favs?.n || 0);
  if (total < 20) return { ok: false, skipped: true, reason: `10 分钟内 ${total} 次，未到 20 次` };
  const key = `like_spike_${user.id}`;
  const last = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind(key).first();
  if (last?.value && Date.now() - new Date(last.value).getTime() < 3600000) {
    return { ok: false, skipped: true, reason: '1 小时内已提醒过' };
  }
  const sent = await sendFeishu(db, env, {
    title: '⚠️ 点赞/收藏异常',
    content: `用户 ${user.username}（QQ ${user.qq}）10 分钟内点赞加收藏 ${total} 次，可能是刷数据，请到后台看一下。`,
    link: `${SITE.url}/admin/users/${user.id}`,
  });
  if (sent.ok) await setAISetting(db, key, new Date().toISOString());
  return { ok: sent.ok, total, feishu: sent };
}

// ---------- 待审核订单超时提醒（第四期补全）：待审核超 24 小时没处理，每天再推一次 ----------
// 每天 09:00 定时任务跑；每笔订单只提醒一次（记 site_settings），处理完不再推。
export async function pendingOrderRemind(db, env) {
  const settings = await getAISettings(db);
  if (!settings.ai_pending_order_remind) return { ok: false, skipped: true, reason: '待审核订单超时提醒开关没开' };
  if (!db) return { ok: false, error: '数据库未就绪' };
  const { results } = await db.prepare(
    `SELECT o.*, u.username FROM orders o JOIN users u ON u.id=o.user_id
     WHERE o.status='pending' AND o.created_at <= datetime('now','-24 hours')
     ORDER BY o.created_at ASC LIMIT 10`
  ).all().catch(() => ({ results: [] }));
  const fresh = [];
  for (const o of results || []) {
    const done = await db.prepare('SELECT value FROM site_settings WHERE key=?').bind(`pending_reminded_${o.id}`).first();
    if (!done) fresh.push(o);
  }
  if (!fresh.length) return { ok: true, count: 0, message: '没有超过 24 小时没处理的待审核订单' };
  const lines = fresh.map((o) => `· ${o.order_no}（${o.product_name}，${o.username}，${o.created_at}）`).join('\n');
  const sent = await sendFeishu(db, env, {
    title: '⏳ 待审核订单超时提醒',
    content: `有 ${fresh.length} 笔待审核订单超过 24 小时还没处理：\n${lines}`,
    link: `${SITE.url}/admin/orders?status=pending`,
  });
  if (sent.ok) {
    for (const o of fresh) await setAISetting(db, `pending_reminded_${o.id}`, new Date().toISOString());
  }
  return { ok: sent.ok, count: fresh.length, feishu: sent };
}

// ---------- 会员到期前 3 天再推一次（第四期补全）：7 天提醒之外多一次 ----------
// 由到期扫描（每天 09:00 + 后台手动触发）调用；每人只推一次。
export async function notifyExpiry3DayFeishu(db, env, expiring) {
  const settings = await getAISettings(db);
  if (!settings.ai_expiry_3day) return { ok: false, skipped: true, reason: '会员到期前 3 天提醒开关没开' };
  if (!expiring?.length) return { ok: false, skipped: true, reason: '没有 3 天内到期的会员' };
  const lines = expiring.map((m) => `· ${m.username}（${m.email}）到期 ${m.expires_at}`).join('\n');
  return sendFeishu(db, env, {
    title: '⏰ 会员 3 天内到期',
    content: `3 天内到期 ${expiring.length} 人：\n${lines}`,
    link: `${SITE.url}/admin/members`,
  });
}

// ---------- 每日汇总（09:00 定时任务 + 后台手动触发都走这里） ----------
export async function dailyDigest(db, env) {
  const settings = await getAISettings(db);
  if (!settings.ai_daily_digest) return { ok: false, skipped: true, reason: '每日汇总开关没开' };
  if (!db) return { ok: false, error: '数据库未就绪' };
  const q = async (sql) => (await db.prepare(sql).bind().first())?.n || 0;
  const counts = {
    pendingOrders: await q("SELECT COUNT(*) AS n FROM orders WHERE status='pending'"),
    pendingComments: await q("SELECT COUNT(*) AS n FROM comments WHERE status='pending'"),
    newUsersToday: await q("SELECT COUNT(*) AS n FROM users WHERE date(created_at)=date('now')"),
    members: await q("SELECT COUNT(*) AS n FROM memberships WHERE status='active' AND expires_at > datetime('now')"),
  };
  const { results: expiring } = await db.prepare(
    `SELECT m.*, u.username, u.email FROM memberships m JOIN users u ON u.id=m.user_id
     WHERE m.status='active' AND m.expires_at > datetime('now') AND m.expires_at <= datetime('now', '+7 days')
     ORDER BY m.expires_at ASC LIMIT 20`
  ).all().catch(() => ({ results: [] }));
  const info = `待审核订单 ${counts.pendingOrders} 笔，待审核评论 ${counts.pendingComments} 条，今日新增用户 ${counts.newUsersToday} 人，有效会员 ${counts.members} 人，7 天内到期 ${expiring.length} 人。`;
  let summary = `AI指南每日汇总：${info}`;
  const r = await callAI(db, env, {
    purpose: 'daily_digest',
    prompt: `把下面这段网站数据汇总成一段话（不超过 100 字，先说最急的待审核订单和评论，再说到期会员）：${info}`,
  });
  if (r.ok && r.text) summary = r.text;
  const sent = await sendFeishu(db, env, { title: '📊 AI指南每日汇总', content: summary, link: `${SITE.url}/admin` });
  return { ok: sent.ok, counts, expiring: (expiring || []).length, aiUsed: r.ok, model: r.model, feishu: sent };
}

// ---------- 网站小助手聊天机器人（第五期） ----------
// 只有登录用户能聊；AI 只回答与本站相关的问题，依据 D1 里的文章 + 站点设置回答，
// 网站里没有的就说没有，不编价格、不编教程步骤；违规词/站外话题直接礼貌拒绝，不调模型。
// 联系站长只推后台填好的联系方式，没填的不推；手机号、身份证、地址、密码、Key 绝不推。
// 每人每天限 N 条（后台可改，默认 20），超了提示明天再来；聊天记录用户只能看自己的。
export const CHATBOT_REFUSAL = '不好意思，我是 AI指南小助手，只能回答和本站（OpenClaw / Hermes 部署指南、会员、工具、签到、订单）相关的问题，换个本站的问题问我吧。';
export const CHATBOT_NO_CONTENT = '本站暂时没有这方面的内容，你可以在后台让站长补充。';
export const CONTACT_RE = /(联系|加群|怎么找|如何联系|站长|客服|qq群|微信群|qq号|微信号|怎么加入|进群)/i;

function stripShortcodes(text) {
return String(text || '')
.replace(/\[(reply|vip|hide|points[^\]]*)\][\s\S]*?\[\/(reply|vip|hide|points)\]/gi, '（该段内容需登录/回复/会员/积分查看）')
.replace(/```[\s\S]*?```/g, '（代码块见文章正文）')
.replace(/[#>*`]/g, '')
.replace(/\s+/g, ' ')
.trim();
}

async function logChat(db, userId, role, content, kind, modelName = '') {
if (!db) return;
try {
await db.prepare(
"INSERT INTO ai_chat_logs (user_id, role, content, kind, model_name) VALUES (?,?,?,?,?)"
).bind(userId, role, String(content || '').slice(0, 2000), kind, modelName || '').run();
} catch { /* 聊天记录表不存在也不阻塞聊天 */}
}

export async function getChatHistory(db, userId, limit = 50) {
if (!db) return [];
const { results} = await db.prepare(
'SELECT id, role, content, kind, model_name, created_at FROM ai_chat_logs WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT?'
).bind(userId, Math.min(100, Math.max(1, Number(limit) || 50))).all().catch(() => ({ results: []}));
return (results || []).reverse();
}

// 后台看聊天记录：按用户名搜；只能站长调（路由层鉴权），返回用户名不返回密码等隐私字段。
export async function listChatLogsAdmin(db, { q = '', limit = 50} = {}) {
if (!db) return [];
const term = String(q || '').trim();
const { results} = term
? await db.prepare(
`SELECT l.*, u.username FROM ai_chat_logs l JOIN users u ON u.id=l.user_id
WHERE u.username LIKE? ORDER BY l.created_at DESC, l.id DESC LIMIT?`
).bind(`%${term}%`, Math.min(100, Math.max(1, Number(limit) || 50))).all().catch(() => ({ results: [] }))
: await db.prepare(
`SELECT l.*, u.username FROM ai_chat_logs l JOIN users u ON u.id=l.user_id
ORDER BY l.created_at DESC, l.id DESC LIMIT?`
).bind(Math.min(100, Math.max(1, Number(limit) || 50))).all().catch(() => ({ results: [] }));
return results || [];
}

export async function getAutoReplies(db) {
if (!db) return [];
const { results} = await db.prepare(
'SELECT * FROM ai_auto_replies ORDER BY sort_order ASC, id ASC'
).all().catch(() => ({ results: []}));
return results || [];
}

function contactCardText(contact) {
const lines = [];
if (contact.qq) lines.push(`站长 QQ：${contact.qq}`);
if (contact.group) lines.push(`QQ 会员群：${contact.group}（开通会员后站长私下拉群）`);
if (contact.wechat) lines.push(`站长微信：${contact.wechat}`);
if (contact.email) lines.push(`站长邮箱：${contact.email}`);
if (contact.note) lines.push(contact.note);
return lines.join('\n');
}

async function searchSiteArticles(db, question) {
if (!db) return [];
const words = String(question || '').split(/[\s，。？！、；：,.?!;:\/]+/).filter((w) => w.length >= 2).slice(0, 5);
const found = new Map();
const addRows = (rows) => {
for (const r of rows || []) {
if (!found.has(r.id)) found.set(r.id, r);
if (found.size >= 3) break;
}
};
// 先搜标题，再搜摘要/正文（标题优先，最多 3 篇）
for (const w of words) {
const { results} = await db.prepare(
`SELECT a.id, a.title, a.slug, a.summary, substr(a.content,1,600) AS snippet, cat.name AS category_name
FROM articles a JOIN categories cat ON cat.id=a.category_id
WHERE a.status='published' AND a.title LIKE? ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 3`
).bind(`%${w}%`).all().catch(() => ({ results: []}));
addRows(results);
if (found.size >= 3) break;
}
if (found.size < 3) {
for (const w of words) {
const { results} = await db.prepare(
`SELECT a.id, a.title, a.slug, a.summary, substr(a.content,1,600) AS snippet, cat.name AS category_name
FROM articles a JOIN categories cat ON cat.id=a.category_id
WHERE a.status='published' AND (a.summary LIKE? OR a.content LIKE?) ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 3`
).bind(`%${w}%`, `%${w}%`).all().catch(() => ({ results: []}));
addRows(results);
if (found.size >= 3) break;
}
}
return [...found.values()].slice(0, 3).map((r) => ({
id: r.id, title: r.title, slug: r.slug, category: r.category_name,
text: stripShortcodes(`${r.summary || ''}\n${r.snippet || ''}`).slice(0, 500),
}));
}

export async function answerChatbot(db, env, { user, message}) {
const settings = await getChatbotSettings(db);
if (!settings.enabled) return { ok: false, error: '小助手还没开通，站长可以在后台智能管理里打开“网站小助手”开关', code: 'disabled'};
const text = String(message || '').trim();
if (!text) return { ok: false, error: '请先写一句话再发给我', code: 'empty'};
if (text.length > 500) return { ok: false, error: '一句话最多 500 字，太长请分开发', code: 'too_long'};

// 每日限额（按上海自然日算）：先记数，超了直接提示，不调模型省额度。
const today = shanghaiDate();
const usedRow = await db.prepare(
"SELECT COUNT(*) AS n FROM ai_chat_logs WHERE user_id=? AND role='user' AND date(created_at)=?"
).bind(user.id, today).first().catch(() => ({ n: 0}));
const used = usedRow?.n || 0;
if (used >= settings.dailyLimit) {
return { ok: false, error: `今天已经问了 ${settings.dailyLimit} 条，到上限了，明天 0 点后再来问我吧`, code: 'limit', used, remaining: 0};
}

// 违规词 / 站外链接：直接礼貌拒绝，不调模型（复用评论审核的词库）。
const mod = moderateComment(text);
if (!mod.ok) {
await logChat(db, user.id, 'user', text, 'chat');
await logChat(db, user.id, 'assistant', CHATBOT_REFUSAL, 'refusal');
return { ok: true, reply: CHATBOT_REFUSAL, kind: 'refusal', used: used + 1, remaining: Math.max(0, settings.dailyLimit - used - 1)};
}

// 联系站长：只推后台填好的联系方式，没填的不推；推完再补一句引导。
if (CONTACT_RE.test(text)) {
const card = contactCardText(settings.contact);
const reply = card
? `${card}\n\n有问题也可以在群里问，站长看到会回你。`
: '站长还没在后台填联系方式，你可以先在文章下面评论，或者等站长填好后再问我。';
await logChat(db, user.id, 'user', text, 'chat');
await logChat(db, user.id, 'assistant', reply, 'contact');
return {
ok: true, reply, kind: 'contact', contact: settings.contact, hasContact: settings.hasContact,
showQr: settings.showQr, used: used + 1, remaining: Math.max(0, settings.dailyLimit - used - 1),
};
}

// 自动回复：关键词命中先回，不走模型省额度。
const autoReplies = await getAutoReplies(db);
const hit = autoReplies.find((r) => r.is_active && text.toLowerCase().includes(String(r.keyword || '').toLowerCase()));
if (hit) {
await logChat(db, user.id, 'user', text, 'chat');
await logChat(db, user.id, 'assistant', hit.reply, 'auto_reply');
return { ok: true, reply: hit.reply, kind: 'auto_reply', used: used + 1, remaining: Math.max(0, settings.dailyLimit - used - 1)};
}

// 站内知识：相关文章（标题优先，前 3 篇）+ 站点事实（分类、会员套餐、签到、工具积分价）。
const articles = await searchSiteArticles(db, text);
let plans = [];
try {
const { results} = await db.prepare(
'SELECT name, price_cents, duration_days FROM membership_plans WHERE is_active=1 ORDER BY duration_days ASC'
).all();
plans = results || [];
} catch { /* 旧库无套餐表也不阻塞 */}
const facts = [
`站点：${SITE.name}（${SITE.domain}），OpenClaw 与 Hermes 部署指南。`,
`关于本站：${SITE.aboutLines.join('；')}。`,
`分类：${CATEGORIES.map((c) => c.name).join('、')}。`,
plans.length? `会员套餐：${plans.map((p) => `${p.name} ${p.price_cents? (p.price_cents / 100).toFixed(0) + '元': '价格后台自定义'}/${p.duration_days}天`).join('；')}。虚拟资源不支持退款。`: '会员套餐：月费、年费，价格由站长在后台自定义。虚拟资源不支持退款。',
`签到：每天签到送 ${CHECKIN.min}~${CHECKIN.max} 积分（自然日 0 点刷新，积分不清零），积分只能兑换工具，不能买会员。`,
`工具兑换：每个工具 ${TOOL_POINTS.min}~${TOOL_POINTS.max} 积分（后台自定义）；月费会员每月免积分下 5 份工具。`,
'部署教程：电脑本地、VPS、安卓手机三种部署方式，详见部署教程分类。',
].join('\n');
const context = articles.length
? articles.map((a, i) => `相关文章${i + 1}：《${a.title}》（${a.category}，/article/${a.slug}）\n${a.text}`).join('\n\n')
: '（没有搜到相关文章）';
const history = (await getChatHistory(db, user.id, 6)).slice(-6);
const historyText = history.length
? history.map((h) => `${h.role === 'user'? '用户': '小助手'}：${String(h.content || '').slice(0, 200)}`).join('\n')
: '（无）';

const system = `你是 AI指南（openzn.cc）网站的小助手，只回答与本站相关的问题。
本站内容：OpenClaw 与 Hermes 的部署指南（电脑本地、VPS、安卓手机）、部署教程、环境配置、专属命令、提示词汇、模型接入、部署脚本、工具下载、会员专属、踩坑经历、常见问题，以及本站的会员、签到积分、工具兑换、订单、余额充值。
规则（必须遵守）：
1. 只用下面给的站点事实和相关文章回答，不要编价格、不要编教程步骤、不要编不存在的文章或功能。
2. 如果问题与本站无关（政治、色情、赌博、股票、娱乐八卦、其他网站等），只回复这句话，不要多说：${CHATBOT_REFUSAL}
3. 如果相关文章里没有相关内容、站点事实里也没有，就只回复这句话：${CHATBOT_NO_CONTENT}
4. 回答用中文，简短（不超过 200 字），提到文章时给标题和链接，提到会员价格时按站点事实里的写，价格没写就是后台自定义，不要自己定价。
5. 不要索要用户的密码、验证码、银行卡、身份证；不要透露其他用户的任何信息。`;
const prompt = `站点事实：
${facts}

相关文章：
${context}

最近对话：
${historyText}

用户现在问：
${text}`;

const r = await callAI(db, env, { prompt, system, purpose: 'chatbot', maxTokens: 512});
await logChat(db, user.id, 'user', text, 'chat');
if (!r.ok) {
const reply = '小助手现在有点忙（模型暂时调不通），请稍后再试一次。';
await logChat(db, user.id, 'assistant', reply, 'refusal');
return { ok: false, error: reply, code: 'model_error', attempts: r.attempts, used: used + 1, remaining: Math.max(0, settings.dailyLimit - used - 1)};
}
const reply = String(r.text || '').trim() || CHATBOT_NO_CONTENT;
await logChat(db, user.id, 'assistant', reply, 'ai', r.model || '');
return {
ok: true, reply, kind: 'ai', model: r.model,
sources: articles.map((a) => ({ title: a.title, slug: a.slug})),
used: used + 1, remaining: Math.max(0, settings.dailyLimit - used - 1),
};
}
