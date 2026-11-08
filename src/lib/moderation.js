// AI指南 — 评论审核：违规词 + 外链检测（v5，第二期）
// 干净的直接显示；含违规词或站外链接的先进 pending，后台通过才显示。
// 违规词库按规格：黄赌毒、法轮功、共产党等网上禁用词 + 骂人词。
// 站长可在后台基本设置里改词库（第三期）；这里是内置默认值。
// 注意：只用词组不用单字，避免“垃圾清理”“毒株”等正常词被误杀。
export const BANNED_WORDS = [
  '黄色网站', '色情', '色情网站', '赌博', '赌场', '赌球', '毒品', '吸毒', '贩毒',
  '法轮功', '法轮大法', '共产党',
  '傻逼', '傻B', '操你', '他妈的', '王八蛋', '贱人', '去死吧',
  '办证', '代开发票', '刷单', '裸聊',
];

// 本站允许的链接域名：openzn.cc（含子域名）、过渡期免费二级域名、本地调试
export const ALLOWED_LINK_HOSTS = ['openzn.cc', 'workers.dev', 'pages.dev', 'localhost'];

export function isAllowedHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return ALLOWED_LINK_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

// 找出内容里的外链域名；相对链接（/article/...、#锚点）不算外链
export function findExternalLinks(content) {
  const found = [];
  const re = /(?:https?:\/\/|www\.)([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  let m;
  while ((m = re.exec(String(content || '')))) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (!isAllowedHost(host) && !found.includes(host)) found.push(host);
  }
  return found;
}

export function findBannedWords(content) {
  const text = String(content || '');
  return BANNED_WORDS.filter((w) => text.includes(w));
}

// 返回 { ok, pending, reasons[] }：ok=true 可直接显示；pending=true 进待审核
export function moderateComment(content) {
  const reasons = [];
  const bad = findBannedWords(content);
  if (bad.length) reasons.push(`含违规词：${bad.join('、')}`);
  const links = findExternalLinks(content);
  if (links.length) reasons.push(`含站外链接：${links.join('、')}`);
  return { ok: reasons.length === 0, pending: reasons.length > 0, reasons, bad, links };
}
