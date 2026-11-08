// AI指南 — 编辑器快捷命令解析（v5 定稿，6 个）
// 点一下编辑器按钮就自动插入下面格式，在中间改内容就行。
//   [reply]...[/reply]        回复可见
//   [vip]...[/vip]            会员可见
//   [points=20]...[/points]   积分可见（10~20，后台自定义）
//   [hide]...[/hide]          隐藏命令（点一下展开）
//   ```bash ... ```           插入代码块（带复制按钮）
//   [img src="..." alt="..."] 插入图片（远程或 R2 图库，自适应+防盗）
// 搜索只搜标题和正文，不搜隐藏块；回复可见解锁只看有没有提交过评论。
import { escapeHtml } from './render.js';

const LOCKS = {
  reply: { label: '回复可见', hint: '评论后即可查看', cls: 'lock-reply' },
  vip: { label: '会员可见', hint: '开通会员后即可查看', cls: 'lock-vip' },
  points: { label: '积分可见', hint: '使用积分兑换后查看', cls: 'lock-points' },
  hide: { label: '隐藏命令', hint: '点击展开查看', cls: 'lock-hide' },
};

function lockCard(type, inner, points) {
  const meta = LOCKS[type];
  const title = type === 'points' ? `${meta.label} · ${points || 20} 积分` : meta.label;
  return `<div class="lock-card ${meta.cls}" data-lock="${type}"${type === 'points' ? ` data-points="${points || 20}"` : ''}>
    <div class="lock-head">🔒 ${escapeHtml(title)}</div>
    <div class="lock-hint">${escapeHtml(meta.hint)}</div>
    <div class="lock-body" hidden>${inner}</div>
    <button class="lock-btn" type="button" data-lock-btn>去解锁</button>
  </div>`;
}

// 极简 Markdown：标题、粗体、行内代码、代码块、段落、链接（仅本站链接放行）
// unlocked: { reply, vip, points } —— 已解锁的锁卡直接显示内容，不再显示锁卡。
//   reply 解锁条件：会员免回复可见，或用户已提交过评论（不管审没审过）；
//   vip 解锁条件：是会员；points 解锁条件：已用积分兑换 / 免费额度领过 / 年费会员。
export function renderContent(raw, unlocked = {}) {
  if (!raw) return '';
  // 图片短代码先占位（避免 escapeHtml 把引号转成 &quot; 后匹配不到）
  const imgs = [];
  let src = raw.replace(/\[img src="([^"]+)" alt="([^"]*)"\]/g, (_, s, alt) => {
    imgs.push({ src: s, alt });
    return `\u0001${imgs.length - 1}\u0001`;
  });
  let html = escapeHtml(src);

  // 代码块 ```lang ... ```（先占位，避免被段落逻辑打散）
  const blocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang: lang || 'bash', code });
    return `\u0000${blocks.length - 1}\u0000`;
  });

  // 短代码锁卡（已解锁的直接放行内容）
  html = html.replace(/\[points=(\d+)\]([\s\S]*?)\[\/points\]/g, (_, n, inner) =>
    unlocked.points ? `<div class="unlocked">${inner}</div>` : lockCard('points', inner, n));
  html = html.replace(/\[reply\]([\s\S]*?)\[\/reply\]/g, (_, inner) =>
    unlocked.reply ? `<div class="unlocked">${inner}</div>` : lockCard('reply', inner));
  html = html.replace(/\[vip\]([\s\S]*?)\[\/vip\]/g, (_, inner) =>
    unlocked.vip ? `<div class="unlocked">${inner}</div>` : lockCard('vip', inner));
  html = html.replace(/\[hide\]([\s\S]*?)\[\/hide\]/g, (_, inner) => lockCard('hide', inner));
  // 图片：占位还原，自适应 + 防盗属性由前端 JS 统一处理
  html = html.replace(/\u0001(\d+)\u0001/g, (_, i) => {
    const im = imgs[Number(i)];
    return `<figure class="article-img"><img src="${escapeHtml(im.src)}" alt="${escapeHtml(im.alt)}" loading="lazy" draggable="false" oncontextmenu="return false"><figcaption>${escapeHtml(im.alt)}</figcaption><span class="img-wm">AI指南 · openzn.cc</span></figure>`;
  });

  // 行内格式
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // 标题
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // 引用
  html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  // 段落：空行分段，单行不成段的直接换行
  html = html.split(/\n{2,}/).map((chunk) => {
    const t = chunk.trim();
    if (!t) return '';
    if (t.startsWith('\u0001')) return t; // 图片占位：不包 <p>
    if (/^<(h1|h2|h3|blockquote|div|figure|\u0000)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // 还原代码块（带复制按钮）
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const b = blocks[Number(i)];
    return `<div class="code-block"><div class="code-head"><span>${escapeHtml(b.lang)}</span><button class="copy-btn" type="button" data-copy>复制</button></div><pre><code>${b.code.replace(/</g, '&lt;')}</code></pre></div>`;
  });
  return html;
}

// 编辑器 6 个快捷命令的插入模板（前端 editor.js 直接用）
export const SHORTCUTS = [
  { key: 'reply', label: '回复可见', insert: '[reply]\n这里写回复后才能看到的内容\n[/reply]' },
  { key: 'vip', label: '会员可见', insert: '[vip]\n这里写只有会员才能看到的内容\n[/vip]' },
  { key: 'points', label: '积分可见', insert: '[points=20]\n这里写要 20 积分才能看到的内容\n[/points]' },
  { key: 'hide', label: '隐藏命令', insert: '[hide]\n这里写要隐藏的命令\n[/hide]' },
  { key: 'code', label: '插入代码块', insert: '```bash\n这里写命令，一行一条\n```' },
  { key: 'img', label: '插入图片', insert: '[img src="图片地址" alt="图片说明"]' },
];
