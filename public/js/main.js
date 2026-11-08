// AI指南 — 主 JS（v5，第二期）
// 个人中心图标 → 未登录弹登录框（已登录显示 QQ 头像，点击进个人中心）；
// 排行榜切换；锁卡解锁；代码复制；点赞/收藏真实切换。
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('authModal');
  const meIcon = document.getElementById('meIcon');
  const close = document.getElementById('authClose');
  if (meIcon && modal) {
    meIcon.addEventListener('click', () => { modal.hidden = false; });
  }
  if (close && modal) close.addEventListener('click', () => { modal.hidden = true; });
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  // 个人中心页 / 文章页的“去登录”按钮也弹登录框
  document.querySelectorAll('[data-open-auth]').forEach((btn) => {
    btn.addEventListener('click', () => { if (modal) modal.hidden = false; });
  });

  // 登录/注册 tab 切换（默认登录蓝，可选注册绿）
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.authTab;
      document.getElementById('loginForm').hidden = tab !== 'login';
      document.getElementById('loginCodeForm').hidden = true;
      document.getElementById('registerForm').hidden = tab !== 'register';
    });
  });
  // 密码登录 / 验证码登录切换
  document.querySelectorAll('[data-show-code-login]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('loginForm').hidden = true;
      document.getElementById('loginCodeForm').hidden = false;
    });
  });
  document.querySelectorAll('[data-show-pass-login]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('loginCodeForm').hidden = true;
      document.getElementById('loginForm').hidden = false;
    });
  });

  // 排行榜切换（积分榜 / 余额榜，前 10）
  document.querySelectorAll('[data-board]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-board]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const board = btn.dataset.board;
      const list = document.querySelector('.board-list');
      if (!list) return;
      try {
        const res = await fetch(`/api/leaderboard?board=${board}`);
        const data = await res.json();
        list.innerHTML = (data.rows || []).slice(0, 10).map((r, i) =>
          `<li><span class="rank">${i + 1}</span><img class="lb-avatar" src="${escapeHtml(r.avatar_url || '/assets/logo/logo.webp')}" alt="" onerror="this.onerror=null;this.src='/assets/logo/logo.webp'"><span class="lb-name">${escapeHtml(r.username)}</span><span class="lb-val">${board === 'points' ? r.points + ' 积分' : '¥' + (r.balance_cents / 100).toFixed(2)}</span></li>`
        ).join('') || '<li class="empty">暂无上榜用户</li>';
      } catch { list.innerHTML = '<li class="empty">加载失败，请刷新重试</li>'; }
    });
  });

  // 锁卡解锁：回复 → 滚到评论区；会员 → 去会员页；积分 → 调兑换接口；隐藏 → 展开
  document.querySelectorAll('[data-lock-btn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.lock-card');
      const type = card?.dataset.lock;
      if (type === 'hide') {
        const body = card.querySelector('.lock-body');
        if (body) { body.hidden = !body.hidden; btn.textContent = body.hidden ? '去解锁' : '收起'; }
        return;
      }
      if (type === 'reply') {
        const form = document.getElementById('commentForm') || document.getElementById('comments');
        if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else alert('请先在文章下方评论，评论后即可查看。');
        return;
      }
      if (type === 'vip') { location.href = '/member'; return; }
      if (type === 'points') {
        const price = Number(card.dataset.points || 20);
        const articleId = document.querySelector('[data-like]')?.dataset.like;
        const tool = document.querySelector('h1')?.textContent || '文章内容';
        if (!confirm(`用 ${price} 积分兑换这部分内容？`)) return;
        const res = await fetch('/api/tools/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool_name: tool, article_id: articleId ? Number(articleId) : null, points_price: price }) });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { alert(data.message || '兑换成功'); location.reload(); }
        else if (res.status === 401) { if (modal) modal.hidden = false; }
        else alert(data.error || '兑换失败');
      }
    });
  });

  // 代码块复制
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.closest('.code-block')?.querySelector('code')?.innerText || '';
      try { await navigator.clipboard.writeText(code); btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制'; }, 1500); }
      catch { btn.textContent = '复制失败'; }
    });
  });

  // 点赞 / 收藏：真实切换，同步 +1/-1；未登录弹登录框
  document.querySelectorAll('[data-like]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await fetch('/api/like', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ article_id: Number(btn.dataset.like) }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { if (modal) modal.hidden = false; return; }
      if (!data.ok) return alert(data.error || '点赞失败');
      btn.classList.toggle('active', !!data.liked);
      btn.textContent = data.liked ? '👍 已点赞' : '👍 点赞';
      const n = document.getElementById('likeCount');
      if (n) n.textContent = data.likes_count;
    });
  });
  document.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await fetch('/api/favorite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ article_id: Number(btn.dataset.fav) }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { if (modal) modal.hidden = false; return; }
      if (!data.ok) return alert(data.error || '收藏失败');
      btn.classList.toggle('active', !!data.favorited);
      btn.textContent = data.favorited ? '⭐ 已收藏' : '⭐ 收藏';
      const n = document.getElementById('favCount');
      if (n) n.textContent = data.favorites_count;
    });
  });

  // 工具兑换按钮（文章页工具箱 / 积分锁卡外的兑换按钮）
  document.querySelectorAll('[data-redeem-article]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await fetch('/api/tools/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool_name: btn.dataset.tool, article_id: Number(btn.dataset.redeemArticle), points_price: Number(btn.dataset.price || 20) }) });
      const data = await res.json().catch(() => ({}));
      const msg = document.getElementById('redeemMsg');
      if (res.status === 401) { if (modal) modal.hidden = false; return; }
      if (data.ok) { if (msg) msg.textContent = data.message; alert(data.message || '兑换成功'); location.reload(); }
      else { if (msg) msg.textContent = data.error || '兑换失败'; else alert(data.error || '兑换失败'); }
    });
  });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
});
