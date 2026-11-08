// AI指南 — 搜索 JS（v5 定稿）
// 输入 1 字等 0.5 秒再查；先标题后内容；只返回前 10 条；输入越多越精确。
let searchTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('siteSearch');
  const box = document.getElementById('searchResults');
  if (!input || !box) return;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const rows = (data.results || []).slice(0, 10);
        box.innerHTML = rows.length
          ? rows.map((r) => `<a href="/article/${encodeURIComponent(r.slug)}">${escapeHtml(r.title)}</a>`).join('')
          : '<a href="#" onclick="return false">没有找到相关文章，换个词试试</a>';
        box.hidden = false;
      } catch { box.hidden = true; }
    }, 500); // 0.5 秒防抖
  });
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target) && e.target !== input) box.hidden = true;
  });
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
});
