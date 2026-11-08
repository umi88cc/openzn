// AI指南 — 网站小助手前端（第五期）
// 按钮和窗口默认隐藏，先问 /api/ai/chat/status：后台开关关着就不显示；
// 未登录点开先显示“请先登录”+登录按钮；只有登录用户能发消息。
// 联系站长时后端会返回 contact 对象，前端渲染成联系方式卡片（只推后台填好的）。
document.addEventListener('DOMContentLoaded', () => {
  const fab = document.getElementById('chatbotFab');
  const panel = document.getElementById('chatbotPanel');
  const msgs = document.getElementById('chatbotMsgs');
  const form = document.getElementById('chatbotForm');
  const input = document.getElementById('chatbotInput');
  const sendBtn = document.getElementById('chatbotSend');
  const closeBtn = document.getElementById('chatbotClose');
  const limitLabel = document.getElementById('chatbotLimit');
  const dailyLabel = document.getElementById('chatbotDailyLimit');
  const qrBox = document.getElementById('chatbotQr');
  if (!fab || !panel) return;
  // 后台页面（/admin 开头）不显示前台小助手
  if (location.pathname.startsWith('/admin')) return;

  let enabled = false;
  let loggedIn = false;
  let welcome = '';
  let opened = false;
  let historyLoaded = false;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const scrollDown = () => { msgs.scrollTop = msgs.scrollHeight; };
  function addMsg(text, who, extra) {
    const div = document.createElement('div');
    div.className = `chat-msg ${who}`;
    div.innerHTML = esc(text).replace(/\n/g, '<br>');
    if (extra) div.appendChild(extra);
    msgs.appendChild(div);
    scrollDown();
    return div;
  }
  function contactCard(contact) {
    const card = document.createElement('div');
    card.className = 'chat-contact-card';
    const rows = [];
    if (contact.qq) rows.push(`<p><strong>站长 QQ：</strong>${esc(contact.qq)}</p>`);
    if (contact.group) rows.push(`<p><strong>QQ 会员群：</strong>${esc(contact.group)}</p>`);
    if (contact.wechat) rows.push(`<p><strong>站长微信：</strong>${esc(contact.wechat)}</p>`);
    if (contact.email) rows.push(`<p><strong>站长邮箱：</strong>${esc(contact.email)}</p>`);
    if (contact.note) rows.push(`<p>${esc(contact.note)}</p>`);
    card.innerHTML = `<div class="chat-contact-title">📇 联系站长</div>${rows.join('') || '<p>站长还没在后台填联系方式。</p>'}`;
    return card;
  }
  function openLogin() {
    const modal = document.getElementById('authModal');
    if (modal) modal.hidden = false;
    else location.href = '/me';
  }
  function showLoginPrompt() {
    msgs.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'chat-msg bot';
    div.innerHTML = '请先登录再和小助手聊天，登录后每天可以问我本站的问题。';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary chat-login-btn';
    btn.textContent = '去登录';
    btn.addEventListener('click', openLogin);
    div.appendChild(document.createElement('br'));
    div.appendChild(btn);
    msgs.appendChild(div);
  }
  async function loadHistory() {
    if (historyLoaded || !loggedIn) return;
    historyLoaded = true;
    try {
      const res = await fetch('/api/ai/chat/history');
      const data = await res.json();
      if (data.ok && (data.messages || []).length) {
        msgs.innerHTML = '';
        for (const m of data.messages) addMsg(m.content, m.role === 'user' ? 'me' : 'bot');
      }
    } catch { /* 历史加载失败不阻塞聊天 */ }
  }
  function togglePanel(show) {
    opened = show === undefined ? !opened : show;
    panel.hidden = !opened;
    if (opened) {
      if (!loggedIn) showLoginPrompt();
      else {
        if (!msgs.children.length && welcome) addMsg(welcome, 'bot');
        loadHistory();
      }
      input.focus();
    }
  }
  fab.addEventListener('click', () => togglePanel());
  closeBtn.addEventListener('click', () => togglePanel(false));
  document.querySelectorAll('[data-chat-q]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!loggedIn) { showLoginPrompt(); return; }
      input.value = chip.dataset.chatQ;
      form.requestSubmit();
    });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (!loggedIn) { showLoginPrompt(); return; }
    input.value = '';
    addMsg(text, 'me');
    sendBtn.disabled = true;
    const thinking = addMsg('小助手正在想…', 'bot');
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      thinking.remove();
      if (res.status === 401 || data.loginRequired) { showLoginPrompt(); return; }
      if (!data.ok) {
        addMsg(data.error || '小助手现在有点忙，请稍后再试一次。', 'bot');
        return;
      }
      const extra = data.kind === 'contact' && data.contact ? contactCard(data.contact) : null;
      addMsg(data.reply, 'bot', extra);
      if (data.sources && data.sources.length) {
        const src = document.createElement('div');
        src.className = 'chat-sources';
        src.innerHTML = '相关文章：' + data.sources.map((s) => `<a href="/article/${esc(s.slug)}">${esc(s.title)}</a>`).join(' · ');
        msgs.appendChild(src);
        scrollDown();
      }
      if (typeof data.remaining === 'number' && limitLabel) {
        limitLabel.textContent = `今天还剩 ${data.remaining} 条 · 只回答本站相关问题`;
      }
    } catch {
      thinking.remove();
      addMsg('网络有点问题，请稍后再试一次。', 'bot');
    } finally {
      sendBtn.disabled = false;
    }
  });

  // 先问状态：开关关着就不显示按钮；开着才显示，欢迎语和剩余额度也从这里取。
  fetch('/api/ai/chat/status').then((r) => r.json()).then((data) => {
    if (!data.ok || !data.enabled) return;
    enabled = true;
    loggedIn = !!data.loggedIn;
    welcome = data.welcome || '';
    fab.hidden = false;
    if (data.showQr && qrBox) qrBox.hidden = false;
    if (dailyLabel) dailyLabel.textContent = data.dailyLimit || 20;
    if (typeof data.remaining === 'number' && limitLabel) {
      limitLabel.textContent = `今天还剩 ${data.remaining} 条 · 只回答本站相关问题`;
    }
  }).catch(() => { /* 状态接口失败就不显示按钮，不阻塞页面 */ });
});
