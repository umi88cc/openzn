// AI指南 — 后台 JS（v5，第三期，手机优先）
// 顶部可折叠菜单；各模块表单走 fetch；文章编辑器 6 个快捷命令 + 图片插入。
document.addEventListener('DOMContentLoaded', () => {
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { res, data: await res.json().catch(() => ({})) };
  };
  const ok = (data, fallback) => { alert(data.ok ? (data.message || '已保存') : (data.error || fallback || '操作失败')); return !!data.ok; };

  // 顶部可折叠菜单
  const menuBtn = document.getElementById('adminMenuBtn');
  const menu = document.getElementById('adminMenu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    });
  }
  document.querySelectorAll('[data-close-dialog]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));

  // 基本设置
  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(settingsForm);
      const payload = {};
      for (const [k, v] of fd.entries()) payload[k] = v;
      const { data } = await post('/api/admin/settings', payload);
      const msg = document.getElementById('settingsMsg');
      if (msg) msg.textContent = data.ok ? '已保存，前端同步生效' : (data.error || '保存失败');
      if (data.ok) alert('基本设置已保存');
      else alert(data.error || '保存失败');
    });
  }

  // 到期提醒手动触发
  document.querySelectorAll('[data-expiry-remind]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { data } = await post('/api/admin/expiry-remind', {});
      const msg = document.getElementById('remindMsg');
      if (msg) msg.textContent = data.ok ? `扫描到 ${data.scanned} 个 7 天内到期会员，发出 ${data.sent} 封提醒邮件` : (data.error || '扫描失败');
      if (!data.ok) alert(data.error || '扫描失败');
      btn.disabled = false;
    });
  });

  // 分类：新建 / 编辑 / 删除
  const catNew = document.getElementById('catNewForm');
  if (catNew) {
    catNew.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(catNew);
      const { data } = await post('/api/admin/categories', { name: fd.get('name'), description: fd.get('description'), visibility: fd.get('visibility'), sort_order: Number(fd.get('sort_order') || 0) });
      if (ok(data)) location.reload();
    });
  }
  const catDialog = document.getElementById('catEditDialog');
  document.querySelectorAll('[data-cat-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = JSON.parse(b.dataset.catEdit);
      const f = document.getElementById('catEditForm');
      f.id.value = r.id; f.name.value = r.name; f.description.value = r.description || '';
      f.visibility.value = r.visibility; f.sort_order.value = r.sort_order; f.is_visible.value = r.is_visible ? '1' : '0';
      catDialog.showModal();
    });
  });
  const catEditForm = document.getElementById('catEditForm');
  if (catEditForm) {
    catEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(catEditForm);
      const { data } = await post('/api/admin/categories', { id: Number(fd.get('id')), name: fd.get('name'), description: fd.get('description'), visibility: fd.get('visibility'), sort_order: Number(fd.get('sort_order') || 0), is_visible: fd.get('is_visible') === '1' });
      if (ok(data)) location.reload();
    });
  }
  document.querySelectorAll('[data-cat-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      const count = Number(b.dataset.catCount || 0);
      let moveTo = null;
      if (count > 0) {
        moveTo = prompt(`「${b.dataset.catName}」下还有 ${count} 篇文章。\n请输入要把文章移到的分类 ID（去分类管理看 ID），或点取消放弃删除：`);
        if (!moveTo) return;
      } else if (!confirm(`确定删除分类「${b.dataset.catName}」吗？`)) return;
      const { data } = await post('/api/admin/categories', { action: 'delete', id: Number(b.dataset.catDel), move_to: moveTo ? Number(moveTo) : undefined });
      if (ok(data)) location.reload();
    });
  });

  // 文章：顶置 / 删除
  document.querySelectorAll('[data-article-pin]').forEach((b) => {
    b.addEventListener('click', async () => {
      const { data } = await post('/api/admin/articles', { action: 'pin', id: Number(b.dataset.articlePin) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-article-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定删除这篇文章吗？点赞/评论/收藏记录也会一起删掉。')) return;
      const { data } = await post('/api/admin/articles', { action: 'delete', id: Number(b.dataset.articleDel) });
      if (ok(data)) location.reload();
    });
  });

  // 文章编辑器：6 个快捷命令点一下插入；图片插入（远程 / 图库）
  const editor = document.getElementById('contentEditor');
  function insertAtCursor(text) {
    if (!editor) return;
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? editor.value.length;
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    editor.focus();
    editor.selectionStart = editor.selectionEnd = start + text.length;
  }
  document.querySelectorAll('[data-shortcut]').forEach((b) => {
    b.addEventListener('click', () => insertAtCursor(`\n${b.dataset.shortcut}\n`));
  });
  const imgDialog = document.getElementById('imgDialog');
  const imgBtn = document.getElementById('imgInsertBtn');
  if (imgBtn && imgDialog) {
    imgBtn.addEventListener('click', async () => {
      imgDialog.showModal();
      const gal = document.getElementById('imgGallery');
      if (gal) {
        try {
          const res = await fetch('/api/admin/images');
          const data = await res.json();
          gal.innerHTML = (data.images || []).map((im) => `<img src="/img/${encodeURIComponent(im.key)}" alt="" data-img-url="/img/${encodeURIComponent(im.key)}" loading="lazy">`).join('') || '<p class="muted">图库还是空的，先上传图片，或用上面的远程地址。</p>';
          gal.querySelectorAll('img[data-img-url]').forEach((im) => im.addEventListener('click', () => {
            insertAtCursor(`\n[img src="${im.dataset.imgUrl}" alt="图片说明"]\n`);
            imgDialog.close();
          }));
        } catch { gal.innerHTML = '<p class="muted">图库加载失败，先用远程地址。</p>'; }
      }
    });
  }
  const imgRemoteBtn = document.getElementById('imgRemoteBtn');
  if (imgRemoteBtn) {
    imgRemoteBtn.addEventListener('click', () => {
      const url = document.querySelector('#imgForm input[name="remote_url"]')?.value.trim();
      if (!url) return alert('请先填远程图片地址');
      insertAtCursor(`\n[img src="${url}" alt="图片说明"]\n`);
      imgDialog.close();
    });
  }
  const imgUpload = document.getElementById('imgUpload');
  if (imgUpload) {
    imgUpload.addEventListener('change', async () => {
      const file = imgUpload.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/images/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { insertAtCursor(`\n[img src="${data.url}" alt="图片说明"]\n`); imgDialog.close(); }
      else alert(data.error || '上传失败');
    });
  }
  const articleForm = document.getElementById('articleForm');
  if (articleForm) {
    articleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(articleForm);
      const priceYuan = Number(fd.get('script_price') || 0);
      const { data } = await post('/api/admin/articles', {
        id: fd.get('id') ? Number(fd.get('id')) : undefined,
        title: fd.get('title'), category_id: Number(fd.get('category_id')), tag: fd.get('tag') || null,
        summary: fd.get('summary'), content: fd.get('content'), hidden_content: fd.get('hidden_content'),
        visibility: fd.get('visibility'), points_price: Number(fd.get('points_price') || 0),
        status: fd.get('status'), script_price_cents: priceYuan ? Math.round(priceYuan * 100) : 0,
      });
      const msg = document.getElementById('articleMsg');
      if (msg) msg.textContent = data.ok ? '已保存' : (data.error || '保存失败');
      if (data.ok) { alert('文章已保存'); location.href = '/admin/articles'; }
      else alert(data.error || '保存失败');
    });
  }

  // AI 润色（第四期补全）：只建议，不自动改原文；点“采用”才替换进编辑器
  const polishPreview = document.getElementById('polishPreview');
  let polishSelection = null; // {start,end}：选中的一段；null 表示整篇正文
  let polishMode = 'polish';
  if (polishPreview) {
    document.querySelectorAll('[data-polish-mode]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!editor) return;
        const start = editor.selectionStart ?? 0;
        const end = editor.selectionEnd ?? 0;
        const text = start !== end ? editor.value.slice(start, end) : editor.value;
        if (!text.trim()) return alert('请先在正文里写点内容，或选中一段文字再润色');
        polishSelection = start !== end ? { start, end } : null;
        polishMode = b.dataset.polishMode;
        const msg = document.getElementById('polishMsg');
        if (msg) msg.textContent = 'AI 正在处理…（调不通自动切下一个模型，最多 10 秒）';
        b.disabled = true;
        const { data } = await post('/api/admin/ai/polish', { text, mode: polishMode });
        b.disabled = false;
        if (!data.ok) { if (msg) msg.textContent = data.error || '润色失败'; return alert(data.error || '润色失败'); }
        polishPreview.value = data.result || '';
        // 检查错别字模式：预览是问题清单，不是替换文本，不能点“采用”
        document.getElementById('polishApplyBtn').disabled = (polishMode === 'check');
        document.getElementById('polishDiscardBtn').disabled = false;
        if (msg) msg.textContent = polishMode === 'check' ? '检查完了，看预览里的问题，原文没动过' : `已生成（模型 ${data.model || ''}），先看预览，满意再点“采用”`;
      });
    });
    const applyBtn = document.getElementById('polishApplyBtn');
    if (applyBtn) applyBtn.addEventListener('click', () => {
      if (!editor || !polishPreview.value) return;
      if (polishMode === 'title') {
        // 换标题：取建议第一行填进标题框
        const titleInput = document.querySelector('#articleForm input[name="title"]');
        const first = polishPreview.value.split('\n').map((s) => s.trim()).filter(Boolean)[0];
        if (titleInput && first) titleInput.value = first.replace(/^[0-9.、\s]*/, '').slice(0, 120);
      } else if (polishSelection) {
        editor.value = editor.value.slice(0, polishSelection.start) + polishPreview.value + editor.value.slice(polishSelection.end);
      } else {
        editor.value = polishPreview.value;
      }
      polishPreview.value = '';
      applyBtn.disabled = true;
      document.getElementById('polishDiscardBtn').disabled = true;
      const msg = document.getElementById('polishMsg');
      if (msg) msg.textContent = '已采用，记得点文章下面的“发布文章 / 保存修改”才真正保存';
    });
    const discardBtn = document.getElementById('polishDiscardBtn');
    if (discardBtn) discardBtn.addEventListener('click', () => {
      polishPreview.value = '';
      applyBtn.disabled = true;
      discardBtn.disabled = true;
      const msg = document.getElementById('polishMsg');
      if (msg) msg.textContent = '已丢掉，没有改原文';
    });
  }

  // 评论审核
  document.querySelectorAll('[data-comment]').forEach((b) => {
    b.addEventListener('click', async () => {
      const action = b.dataset.comment;
      if ((action === 'delete' || action === 'ban') && !confirm(action === 'ban' ? '确定封禁这个用户吗？封禁后不能登录，会员时间照走。' : '确定删除这条评论吗？')) return;
      const { data } = await post('/api/admin/comments', { action, id: Number(b.dataset.id) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-comment-reply]').forEach((b) => {
    b.addEventListener('click', async () => {
      const text = prompt('站长回复内容：');
      if (!text) return;
      const { data } = await post('/api/admin/comments', { action: 'reply', id: Number(b.dataset.commentReply), reply: text });
      if (ok(data)) location.reload();
    });
  });

  // 用户管理
  const userEditForm = document.getElementById('userEditForm');
  if (userEditForm) {
    userEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(userEditForm);
      const { data } = await post('/api/admin/users', { id: Number(userEditForm.dataset.userId), qq: fd.get('qq'), wechat: fd.get('wechat') });
      const msg = document.getElementById('userMsg');
      if (msg) msg.textContent = data.ok ? '已保存' : (data.error || '保存失败');
      if (data.ok) location.reload();
      else alert(data.error || '保存失败');
    });
  }
  document.querySelectorAll('[data-user-action]').forEach((b) => {
    b.addEventListener('click', async () => {
      const action = b.dataset.userAction;
      if (action === 'delete' && !confirm('确定删除这个用户吗？他的订单/评论/点赞记录也会一起删掉，站长账号不能删。')) return;
      if (action === 'ban' && !confirm('确定封禁这个用户吗？封禁后不能登录，会员时间照走不暂停。')) return;
      const { data } = await post('/api/admin/users', { action, id: Number(b.dataset.id) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-user-reset]').forEach((b) => {
    b.addEventListener('click', async () => {
      const pw = prompt('给这个用户设一个新密码（6 位以上），设完告诉他重新登录：');
      if (!pw) return;
      const { data } = await post('/api/admin/users', { action: 'reset_password', id: Number(b.dataset.userReset), new_password: pw });
      if (ok(data)) location.reload();
    });
  });

  // 会员管理：套餐保存 / 手动开通 / 延长 / 取消
  document.querySelectorAll('.plan-form').forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const { data } = await post('/api/admin/plans', { id: Number(f.dataset.planId), name: fd.get('name'), price_cents: Number(fd.get('price_cents') || 0), icon: fd.get('icon'), duration_days: Number(fd.get('duration_days') || 30), is_active: fd.get('is_active') === '1', permissions_json: {} });
      if (ok(data)) location.reload();
    });
  });
  const grantForm = document.getElementById('memberGrantForm');
  if (grantForm) {
    grantForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(grantForm);
      const { data } = await post('/api/admin/members', { action: 'grant', user_id: Number(fd.get('user_id')), plan_id: Number(fd.get('plan_id')) });
      if (ok(data)) location.reload();
    });
  }
  document.querySelectorAll('[data-member-extend]').forEach((b) => {
    b.addEventListener('click', async () => {
      const plans = document.querySelectorAll('.plan-form');
      const planId = plans[0] ? Number(plans[0].dataset.planId) : 1;
      const { data } = await post('/api/admin/members', { action: 'extend', user_id: Number(b.dataset.memberExtend), plan_id: planId, days: 30 });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-member-cancel]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定取消这个用户的会员吗？到期前权限收回，记录保留。')) return;
      const plans = document.querySelectorAll('.plan-form');
      const planId = plans[0] ? Number(plans[0].dataset.planId) : 1;
      const { data } = await post('/api/admin/members', { action: 'cancel', user_id: Number(b.dataset.memberCancel), plan_id: planId });
      if (ok(data)) location.reload();
    });
  });

  // 订单管理：通过 / 拒绝 / 删除 / 编辑
  document.querySelectorAll('[data-order]').forEach((b) => {
    b.addEventListener('click', async () => {
      const action = b.dataset.order;
      if (action === 'delete' && !confirm('确定删除这笔订单吗？')) return;
      let remark = '';
      if (action === 'reject') { remark = prompt('拒绝原因（会发邮件告诉用户）：') || '站长审核未通过'; }
      const { data } = await post('/api/admin/orders', { action, id: Number(b.dataset.id), remark });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-deploy]').forEach((b) => {
    b.addEventListener('click', async () => {
      const next = b.dataset.deploy;
      if (next === 'completed' && !confirm('确定部署已完成吗？点完成会发邮件通知用户，订单变交易成功，部署次数 +1。')) return;
      const { data } = await post('/api/admin/orders', { action: 'deploy', id: Number(b.dataset.id), deploy_status: next });
      if (ok(data)) location.reload();
    });
  });
  const orderEditForm = document.getElementById('orderEditForm');
  if (orderEditForm) {
    orderEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(orderEditForm);
      const { data } = await post('/api/admin/orders', { action: 'update', id: Number(orderEditForm.dataset.orderId), total_cents: Number(fd.get('total_cents') || 0), paid_cents: Number(fd.get('paid_cents') || 0), remark: fd.get('remark') });
      const msg = document.getElementById('orderMsg');
      if (msg) msg.textContent = data.ok ? '已保存' : (data.error || '保存失败');
      if (data.ok) location.reload();
      else alert(data.error || '保存失败');
    });
  }

  // 财富管理：手动调整 / 卡密生成 / 作废
  const adjustForm = document.getElementById('wealthAdjustForm');
  if (adjustForm) {
    adjustForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(adjustForm);
      const kind = fd.get('kind');
      const { data } = await post('/api/admin/wealth/adjust', { user_id: Number(fd.get('user_id')), kind, change_cents: kind === 'balance' ? Number(fd.get('amount') || 0) : 0, change_points: kind === 'points' ? Number(fd.get('amount') || 0) : 0, reason: fd.get('reason') || '站长手动调整' });
      const msg = document.getElementById('adjustMsg');
      if (msg) msg.textContent = data.ok ? '已调整，流水已记' : (data.error || '调整失败');
      if (data.ok) location.reload();
      else alert(data.error || '调整失败');
    });
  }
  const cardForm = document.getElementById('cardCreateForm');
  if (cardForm) {
    cardForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(cardForm);
      const { data } = await post('/api/admin/cards', { amount_cents: Number(fd.get('amount_cents') || 0), count: Number(fd.get('count') || 1), expires_at: fd.get('expires_at') || null });
      const msg = document.getElementById('cardMsg');
      if (data.ok) {
        if (msg) msg.textContent = `${data.message}：${(data.codes || []).join('、')}`;
        alert(`${data.message}\n${(data.codes || []).join('\n')}`);
        location.reload();
      } else alert(data.error || '生成失败');
    });
  }
  document.querySelectorAll('[data-card-void]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定作废这张卡密吗？作废后不能兑换。')) return;
      const { data } = await post('/api/admin/cards', { action: 'void', id: Number(b.dataset.cardVoid) });
      if (ok(data)) location.reload();
    });
  });

  // ---------- 智能管理（第四期）：飞书 + 开关 + 模型多 Key ----------
  const feishuForm = document.getElementById('feishuForm');
  if (feishuForm) {
    feishuForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(feishuForm);
      const { data } = await post('/api/admin/ai/settings', { feishu_webhook: fd.get('feishu_webhook'), feishu_app_id: fd.get('feishu_app_id'), feishu_app_secret: fd.get('feishu_app_secret') });
      const msg = document.getElementById('feishuMsg');
      if (msg) msg.textContent = data.ok ? '已保存' : (data.error || '保存失败');
      if (!data.ok) alert(data.error || '保存失败');
      else alert('飞书配置已保存');
    });
  }
  const feishuTestBtn = document.getElementById('feishuTestBtn');
  if (feishuTestBtn) {
    feishuTestBtn.addEventListener('click', async () => {
      feishuTestBtn.disabled = true;
      const { data } = await post('/api/admin/ai/feishu-test', {});
      const msg = document.getElementById('feishuTestMsg');
      if (msg) msg.textContent = data.ok ? '已推送，请去飞书群里看一下' : (data.error || '推送失败');
      if (!data.ok) alert(data.error || '推送失败');
      feishuTestBtn.disabled = false;
    });
  }
  const aiSwitchForm = document.getElementById('aiSwitchForm');
  if (aiSwitchForm) {
    aiSwitchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {};
      aiSwitchForm.querySelectorAll('input[type="checkbox"]').forEach((cb) => { payload[cb.name] = cb.checked; });
      const { data } = await post('/api/admin/ai/settings', payload);
      const msg = document.getElementById('aiSwitchMsg');
      if (msg) msg.textContent = data.ok ? '已保存' : (data.error || '保存失败');
      if (data.ok) alert('开关已保存');
      else alert(data.error || '保存失败');
    });
  }
  const aiDigestBtn = document.getElementById('aiDigestBtn');
  if (aiDigestBtn) {
    aiDigestBtn.addEventListener('click', async () => {
      aiDigestBtn.disabled = true;
      const { data } = await post('/api/admin/ai/digest', {});
      const msg = document.getElementById('aiDigestMsg');
      if (msg) msg.textContent = data.ok ? '已推到飞书' : (data.error || '推送失败');
      if (!data.ok) alert(data.error || '推送失败');
      aiDigestBtn.disabled = false;
    });
  }
  const aiPendingRemindBtn = document.getElementById('aiPendingRemindBtn');
  if (aiPendingRemindBtn) {
    aiPendingRemindBtn.addEventListener('click', async () => {
      aiPendingRemindBtn.disabled = true;
      const { data } = await post('/api/admin/ai/pending-remind', {});
      const msg = document.getElementById('aiPendingRemindMsg');
      if (msg) msg.textContent = data.ok ? (data.message || '已推到飞书') : (data.error || '推送失败');
      if (!data.ok) alert(data.error || '推送失败');
      aiPendingRemindBtn.disabled = false;
    });
  }
  const aiModelNewForm = document.getElementById('aiModelNewForm');

  // ---------- 聊天机器人设置（第五期）：欢迎语 / 每日限额 / 站长联系方式 ----------
  const chatbotForm = document.getElementById('chatbotForm');
  if (chatbotForm) {
    chatbotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(chatbotForm);
      const payload = {};
      for (const [k, v] of fd.entries()) payload[k] = v;
      const { data } = await post('/api/admin/ai/chatbot', payload);
      const msg = document.getElementById('chatbotMsg');
      if (msg) msg.textContent = data.ok ? '已保存' : (data.error || '保存失败');
      if (!data.ok) alert(data.error || '保存失败');
      else alert('聊天机器人设置已保存');
    });
  }
  const aiReplyNewForm = document.getElementById('aiReplyNewForm');
  if (aiReplyNewForm) {
    aiReplyNewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(aiReplyNewForm);
      const { data } = await post('/api/admin/ai/auto-replies', { keyword: fd.get('keyword'), reply: fd.get('reply'), sort_order: Number(fd.get('sort_order') || 0) });
      if (ok(data)) location.reload();
    });
  }
  document.querySelectorAll('[data-ai-reply-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const { data } = await post('/api/admin/ai/auto-replies', { action: 'toggle', id: Number(b.dataset.aiReplyToggle) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-ai-reply-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定删除这条自动回复吗？')) return;
      const { data } = await post('/api/admin/ai/auto-replies', { action: 'delete', id: Number(b.dataset.aiReplyDel) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-chat-log-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定删除这条聊天记录吗？')) return;
      const { data } = await post('/api/admin/ai/chat-logs', { action: 'delete', id: Number(b.dataset.chatLogDel) });
      if (ok(data)) location.reload();
    });
  });
  if (aiModelNewForm) {
    aiModelNewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(aiModelNewForm);
      const { data } = await post('/api/admin/ai/models', { name: fd.get('name'), provider: fd.get('provider'), base_url: fd.get('base_url'), model: fd.get('model'), sort_order: Number(fd.get('sort_order') || 0), note: fd.get('note') });
      if (ok(data)) location.reload();
    });
  }
  const aiModelDialog = document.getElementById('aiModelEditDialog');
  document.querySelectorAll('[data-ai-model-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = JSON.parse(b.dataset.aiModelEdit);
      const f = document.getElementById('aiModelEditForm');
      f.id.value = r.id; f.name.value = r.name; f.provider.value = r.provider;
      f.base_url.value = r.base_url; f.model.value = r.model; f.sort_order.value = r.sort_order; f.note.value = r.note || '';
      aiModelDialog.showModal();
    });
  });
  const aiModelEditForm = document.getElementById('aiModelEditForm');
  if (aiModelEditForm) {
    aiModelEditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(aiModelEditForm);
      const { data } = await post('/api/admin/ai/models', { id: Number(fd.get('id')), name: fd.get('name'), provider: fd.get('provider'), base_url: fd.get('base_url'), model: fd.get('model'), sort_order: Number(fd.get('sort_order') || 0), note: fd.get('note') });
      if (ok(data)) location.reload();
    });
  }
  document.querySelectorAll('[data-ai-model-move]').forEach((b) => {
    b.addEventListener('click', async () => {
      const { data } = await post('/api/admin/ai/models', { action: 'move', id: Number(b.dataset.aiModelMove), dir: Number(b.dataset.dir) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-ai-model-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const { data } = await post('/api/admin/ai/models', { action: 'toggle', id: Number(b.dataset.aiModelToggle) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-ai-model-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定删除这个模型吗？它下面的 Key 也会一起删掉。')) return;
      const { data } = await post('/api/admin/ai/models', { action: 'delete', id: Number(b.dataset.aiModelDel) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-ai-model-test]').forEach((b) => {
    b.addEventListener('click', async () => {
      const msg = document.querySelector(`[data-ai-test-msg="${b.dataset.aiModelTest}"]`);
      if (msg) msg.textContent = '测试中…（最多 10 秒，调不通自动切下一个模型）';
      const { data } = await post('/api/admin/ai/models', { action: 'test', id: Number(b.dataset.aiModelTest) });
      if (msg) msg.textContent = data.ok ? data.message : (data.error || '测试失败');
      if (!data.ok) alert(data.error || '测试失败');
    });
  });
  document.querySelectorAll('.ai-key-form').forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const { data } = await post('/api/admin/ai/keys', { model_id: Number(f.dataset.modelId), key: fd.get('key'), label: fd.get('label'), sort_order: Number(fd.get('sort_order') || 0) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-ai-key-toggle]').forEach((b) => {
    b.addEventListener('click', async () => {
      const { data } = await post('/api/admin/ai/keys', { action: 'toggle', id: Number(b.dataset.aiKeyToggle) });
      if (ok(data)) location.reload();
    });
  });
  document.querySelectorAll('[data-ai-key-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('确定删除这个 Key 吗？删了就不能再用它调用模型了。')) return;
      const { data } = await post('/api/admin/ai/keys', { action: 'delete', id: Number(b.dataset.aiKeyDel) });
      if (ok(data)) location.reload();
    });
  });
});
