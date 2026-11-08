// AI指南 — 登录框 JS（v5，第二期）
// 登录成功 / 注册成功后直接去个人中心；验证码 60 秒倒计时防刷。
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('authModal');
  const loginForm = document.getElementById('loginForm');
  const loginCodeForm = document.getElementById('loginCodeForm');
  const registerForm = document.getElementById('registerForm');
  const resetForm = document.getElementById('resetForm');

  function done(data) {
    if (data.ok) { location.href = '/me'; return true; }
    alert(data.error || '操作失败');
    return false;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      try {
        const res = await fetch('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)), headers: { 'Content-Type': 'application/json' } });
        done(await res.json().catch(() => ({})));
      } catch { alert('网络异常，请重试。'); }
    });
  }

  if (loginCodeForm) {
    loginCodeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(loginCodeForm);
      try {
        const res = await fetch('/api/auth/login-code', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)), headers: { 'Content-Type': 'application/json' } });
        done(await res.json().catch(() => ({})));
      } catch { alert('网络异常，请重试。'); }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(registerForm);
      if ((fd.get('password') || '').length < 6) return alert('密码要 6 位以上。');
      if (fd.get('password') !== fd.get('password2')) return alert('两次密码不一致。');
      if (!fd.get('qq') || !fd.get('email') || !fd.get('code')) return alert('QQ 号、邮箱、邮箱验证码都要填。');
      try {
        const res = await fetch('/api/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)), headers: { 'Content-Type': 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { alert('注册成功，已直接登录到个人中心'); location.href = '/me'; }
        else alert(data.error || '注册失败');
      } catch { alert('网络异常，请重试。'); }
    });
  }

  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(resetForm);
      try {
        const res = await fetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)), headers: { 'Content-Type': 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (data.ok) { alert(data.message || '密码已重置'); location.href = '/'; }
        else alert(data.error || '重置失败');
      } catch { alert('网络异常，请重试。'); }
    });
  }

  // 发送验证码：按按钮上的 data-purpose 区分注册 / 登录 / 重置；60 秒倒计时
  document.querySelectorAll('[data-send-code]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const purpose = btn.dataset.purpose || 'register';
      const form = btn.closest('form');
      const email = form?.querySelector('[name="email"]')?.value?.trim();
      if (!email) return alert('请先填邮箱。');
      btn.disabled = true;
      try {
        const res = await fetch('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ email, purpose }), headers: { 'Content-Type': 'application/json' } });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          alert(data.devMode ? `本地调试：验证码是 ${data.code}（正式部署配了 Resend 后只走邮件，不再显示）` : '验证码已发到邮箱，10 分钟内有效');
          let left = 60;
          btn.textContent = `${left} 秒后重发`;
          const timer = setInterval(() => {
            left -= 1;
            if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = '发送验证码'; }
            else btn.textContent = `${left} 秒后重发`;
          }, 1000);
        } else {
          btn.disabled = false;
          alert(data.error || '发送失败');
        }
      } catch { btn.disabled = false; alert('网络异常，请重试。'); }
    });
  });
});
