// AI指南 — 文章详情 JS（v5，第二期）
// 图片防盗：右键菜单禁用、拖拽禁用、手机长按保存禁用（配合 CSS user-select）；
// 注意：截图无法完全防止，水印只是增加盗图难度。
// 评论提交：干净的直接显示，违规/外链的进待审核；提交即解锁“回复可见”。
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.article-content img, .article-img img').forEach((img) => {
    img.addEventListener('contextmenu', (e) => e.preventDefault());
    img.addEventListener('dragstart', (e) => e.preventDefault());
    img.addEventListener('touchstart', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    img.setAttribute('draggable', 'false');
  });
  // 底部二维码、付款码同样禁右键保存（咨询/收款码是站长的，同样防盗存）
  document.querySelectorAll('.footer-mid img, .pay-qrs img').forEach((img) => {
    img.addEventListener('contextmenu', (e) => e.preventDefault());
    img.addEventListener('dragstart', (e) => e.preventDefault());
  });

  const form = document.getElementById('commentForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const content = String(fd.get('content') || '').trim();
      if (!content) return alert('评论内容不能为空');
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const res = await fetch('/api/comments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ article_id: Number(form.dataset.article), content }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          const modal = document.getElementById('authModal');
          if (modal) modal.hidden = false;
          return;
        }
        if (!data.ok) return alert(data.error || '评论失败');
        alert(data.message || '评论已发布');
        location.reload(); // 刷新后已通过的评论直接显示，回复可见内容也随之解锁
      } catch { alert('网络异常，请重试。'); }
      finally { btn.disabled = false; }
    });
  }
});
