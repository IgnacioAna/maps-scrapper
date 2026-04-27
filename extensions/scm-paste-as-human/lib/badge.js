(function () {
  'use strict';

  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});
  const ID = 'scm-paste-badge';

  function ensureBadge() {
    let badge = document.getElementById(ID);
    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = ID;
    badge.setAttribute('role', 'status');
    badge.style.cssText = [
      'position: fixed',
      'bottom: 16px',
      'right: 16px',
      'z-index: 2147483647',
      'padding: 10px 14px',
      'background: rgba(15,17,21,0.94)',
      'color: #E5E7E2',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'font-size: 13px',
      'line-height: 1.3',
      'border-radius: 8px',
      'border: 1px solid rgba(157,133,242,0.4)',
      'box-shadow: 0 4px 16px rgba(0,0,0,0.4)',
      'pointer-events: none',
      'user-select: none',
      'min-width: 180px',
    ].join(';');

    badge.innerHTML = [
      '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px">',
      '  <span style="color:#9D85F2;font-weight:600">Tipeando…</span>',
      '  <span class="scm-progress" style="opacity:0.85">0/0</span>',
      '</div>',
      '<div style="height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden">',
      '  <div class="scm-bar-fill" style="height:100%;width:0%;background:#9D85F2;transition:width 80ms linear"></div>',
      '</div>',
    ].join('');

    document.body.appendChild(badge);
    return badge;
  }

  function showBadge() {
    return ensureBadge();
  }

  function updateBadge(current, total) {
    const badge = document.getElementById(ID);
    if (!badge) return;
    const txt = badge.querySelector('.scm-progress');
    const bar = badge.querySelector('.scm-bar-fill');
    if (txt) txt.textContent = current + '/' + total;
    if (bar && total > 0) bar.style.width = Math.min(100, (current / total) * 100) + '%';
  }

  function hideBadge() {
    const badge = document.getElementById(ID);
    if (badge) badge.remove();
  }

  ns.showBadge = showBadge;
  ns.updateBadge = updateBadge;
  ns.hideBadge = hideBadge;
})();
