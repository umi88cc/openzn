// AI指南 — 充值 / 卡密页 JS（v5，第三期）
document.addEventListener('DOMContentLoaded', () => {
  const rechargeForm = document.getElementById('rechargeForm');
  if (rechargeForm) {
    rechargeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(rechargeForm);
      const msg = document.getElementById('rechargeMsg');
      const btn = rechargeForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const res = await fetch('/api/orders/recharge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pay_cents: Number(fd.get('pay_cents')), pay_method: fd.get('pay_method'), pay_ref: fd.get('pay_ref') }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { if (msg) msg.textContent = data.message; alert(data.message); location.href = '/me?tab=orders'; }
        else if (res.status === 401) { alert('请先登录'); }
        else alert(data.error || '提交失败');
      } catch { alert('网络异常，请重试。'); }
      finally { btn.disabled = false; }
    });
  }

  const cardForm = document.getElementById('cardForm');
  if (cardForm) {
    cardForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(cardForm);
      const msg = document.getElementById('cardMsg');
      const res = await fetch('/api/card-codes/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fd.get('code') }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { if (msg) msg.textContent = data.message; alert(data.message); location.href = '/me?tab=wealth'; }
      else { if (msg) msg.textContent = data.error || '兑换失败'; alert(data.error || '兑换失败'); }
    });
  }
});
