// AI指南 — 会员页 JS（v5，第三期）
// 开通/续费：余额直付或扫码通知站长；部署申请；免费领脚本。
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('payPanel');
  const planName = document.getElementById('payPlanName');
  const planSlug = document.getElementById('payPlanSlug');
  const payQrs = document.getElementById('payQrs');
  const payMsg = document.getElementById('payMsg');
  const paySubmit = document.getElementById('paySubmit');

  document.querySelectorAll('[data-open-member]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!panel) return;
      planSlug.value = btn.dataset.openMember;
      planName.textContent = btn.closest('.plan-card')?.querySelector('h2')?.textContent || '';
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.querySelectorAll('input[name="pay_method"]').forEach((r) => {
    r.addEventListener('change', () => {
      const v = document.querySelector('input[name="pay_method"]:checked')?.value;
      if (payQrs) payQrs.hidden = v === 'balance';
      if (paySubmit) paySubmit.textContent = v === 'balance' ? '余额支付，马上开通' : '我已付款通知站长';
    });
  });

  const payForm = document.getElementById('memberPayForm');
  if (payForm) {
    payForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(payForm);
      const pay_method = document.querySelector('input[name="pay_method"]:checked')?.value || 'balance';
      paySubmit.disabled = true;
      try {
        const res = await fetch('/api/orders/membership', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_slug: fd.get('plan_slug'), pay_method, pay_ref: fd.get('pay_ref') }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { if (payMsg) payMsg.textContent = data.message; alert(data.message || '提交成功'); location.reload(); }
        else {
          if (data.goRecharge) { if (confirm(`${data.error}\n\n现在去充值吗？`)) location.href = '/recharge'; }
          else alert(data.error || '提交失败');
        }
      } catch { alert('网络异常，请重试。'); }
      finally { paySubmit.disabled = false; }
    });
  }

  const deployForm = document.getElementById('deployForm');
  if (deployForm) {
    deployForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(deployForm);
      const msg = document.getElementById('deployMsg');
      const res = await fetch('/api/orders/deploy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_type: fd.get('device_type'), system_info: fd.get('system_info'), contact_qq: fd.get('contact_qq') }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { if (msg) msg.textContent = data.message; alert(data.message); location.reload(); }
      else alert(data.error || '提交失败');
    });
  }

  document.querySelectorAll('[data-free-script]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const msg = document.getElementById('scriptMsg');
      const res = await fetch('/api/orders/free-script', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: Number(btn.dataset.freeScript) }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { if (msg) msg.textContent = data.message; alert(data.message); }
      else alert(data.error || '领取失败');
    });
  });
});
