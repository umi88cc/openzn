// AI指南 — 个人中心 JS（v5，第二期）
// 签到、保存签名/性别、排行榜上榜开关、退出登录。
document.addEventListener('DOMContentLoaded', () => {
  const checkinBtn = document.querySelector('[data-checkin]');
  if (checkinBtn) {
    checkinBtn.addEventListener('click', async () => {
      checkinBtn.disabled = true;
      try {
        const res = await fetch('/api/checkin', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        const msg = document.getElementById('checkinMsg');
        if (data.ok) {
          if (msg) msg.textContent = data.already ? data.message : `签到成功，+${data.points_given} 积分，当前 ${data.points} 积分`;
          if (!data.already) location.reload();
        } else if (res.status === 401) { location.href = '/'; }
        else alert(data.error || '签到失败');
      } catch { alert('网络异常，请重试。'); }
      finally { checkinBtn.disabled = false; }
    });
  }

  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(profileForm);
      const res = await fetch('/api/me/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: fd.get('signature'), gender: fd.get('gender') }),
      });
      const data = await res.json().catch(() => ({}));
      alert(data.ok ? '已保存' : (data.error || '保存失败'));
      if (data.ok) location.reload();
    });
  }

  document.querySelectorAll('[data-board-optin]').forEach((box) => {
    box.addEventListener('change', async () => {
      const res = await fetch('/api/me/board-optins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: box.dataset.boardOptin, opted_in: box.checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { box.checked = !box.checked; alert(data.error || '设置失败'); }
    });
  });

  document.querySelectorAll('[data-logout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      location.href = '/';
    });
  });
});
