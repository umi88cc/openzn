// AI指南 — 邮箱验证码（Resend HTTP 发信，第二期）
// Workers 不能直连 smtp.qq.com 这类传统 SMTP，改用 Resend 的 HTTP API。
// Resend 免费每天 100 封，前期够用；后期预付费升级。发件人先用 Resend 测试
// 域名，以后买了 openzn.cc 后用 noreply@openzn.cc（还需在 Cloudflare 做 SPF/DKIM）。
// RESEND_API_KEY 通过 `wrangler secret put RESEND_API_KEY` 设置，绝不写进仓库。
// 限流：每个邮箱、每个 IP 每小时最多发 5 次验证码；验证码 6 位，10 分钟有效，一次性。
import { SITE} from './config.js';

export const CODE_TTL_MINUTES = 10;
export const SEND_LIMIT_PER_HOUR = 5;

export function newCode() {
const n = Math.floor(100000 + Math.random() * 900000);
return String(n);
}

function purposeSubject(purpose) {
return {
register: '注册验证码',
login: '登录验证码',
reset_password: '重置密码验证码',
}[purpose] || '验证码';
}

// 限流：查最近 1 小时内该邮箱 / 该 IP 已发多少次
export async function sendCountInLastHour(db, { email, ip}) {
if (!db) return { byEmail: 0, byIp: 0};
const byEmail = await db.prepare(
"SELECT COUNT(*) AS n FROM email_codes WHERE email=? AND created_at > datetime('now','-1 hour')"
).bind(email).first();
const byIp = ip
? await db.prepare(
"SELECT COUNT(*) AS n FROM email_codes WHERE ip=? AND created_at > datetime('now','-1 hour')"
).bind(ip).first()
: { n: 0};
return { byEmail: byEmail?.n || 0, byIp: byIp?.n || 0};
}

export async function createCode(db, { email, purpose, ip}) {
const code = newCode();
await db.prepare(
"INSERT INTO email_codes (email, code, purpose, ip, expires_at) VALUES (?,?,?,?, datetime('now',?))"
).bind(email, code, purpose, ip || null, `+${CODE_TTL_MINUTES} minutes`).run();
return code;
}

// 校验验证码：未使用、未过期、用途一致；校验通过后标记已使用（一次性）
export async function verifyCode(db, { email, code, purpose}) {
if (!db) return { ok: false, error: '数据库未就绪'};
const row = await db.prepare(
`SELECT * FROM email_codes WHERE email=? AND code=? AND purpose=? AND used=0
AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
).bind(email, code, purpose).first();
if (!row) return { ok: false, error: '验证码错误或已过期，请重新发送'};
await db.prepare('UPDATE email_codes SET used=1 WHERE id=?').bind(row.id).run();
return { ok: true};
}

// 发信。返回 { ok, devMode, error}。
// 未配置 RESEND_API_KEY 时（本地 wrangler dev 调试）：不发信，只记库，
// 并把验证码随接口返回（devMode=true），方便本地验证注册/登录流程；
// 一旦配了密钥，验证码绝不再经接口返回，只能走邮件。
export async function sendVerificationEmail(env, { email, code, purpose}) {
const apiKey = env?.RESEND_API_KEY;
const from = env?.RESEND_FROM || `AI指南 <onboarding@resend.dev>`;
if (!apiKey) {
console.log(`[dev-mode] 验证码未发信（未配 RESEND_API_KEY）：${email} ${purpose} code=${code}`);
return { ok: true, devMode: true, code};
}
const res = await fetch('https://api.resend.com/emails', {
method: 'POST',
headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
body: JSON.stringify({
from,
to: [email],
subject: purposeSubject(purpose),
html: `<p>你好，你的${SITE.name}验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 ${CODE_TTL_MINUTES} 分钟内有效，请勿泄露给他人。如非本人操作请忽略。</p><p>—— ${SITE.name} ${SITE.domain}</p>`,
}),
});
if (!res.ok) {
const text = await res.text().catch(() => '');
console.error('Resend 发送失败', res.status, text.slice(0, 300));
return { ok: false, error: `邮件发送失败（Resend ${res.status}），请稍后重试或联系站长`};
}
return { ok: true, devMode: false};
}

// 通用发信（部署完成、会员到期提醒等第三期用；第二期只接验证码）
export async function sendEmail(env, { to, subject, html}) {
const apiKey = env?.RESEND_API_KEY;
const from = env?.RESEND_FROM || `AI指南 <onboarding@resend.dev>`;
if (!apiKey) {
console.log(`[dev-mode] 邮件未发信（未配 RESEND_API_KEY）：to=${to} subject=${subject}`);
return { ok: false, error: '未配置 RESEND_API_KEY'};
}
const res = await fetch('https://api.resend.com/emails', {
method: 'POST',
headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
body: JSON.stringify({ from, to: [to], subject, html}),
});
return { ok: res.ok, error: res.ok? undefined: `Resend ${res.status}`};
}
