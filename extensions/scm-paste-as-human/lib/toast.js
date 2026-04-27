(function () {
  'use strict';

  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});
  const ID = 'scm-paste-toast';
  let hideTimer = null;

  function showToast(message, opts) {
    const duration = (opts && opts.duration) || 2500;
    const tone = (opts && opts.tone) || 'warn';

    let toast = document.getElementById(ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = ID;
      toast.style.cssText = [
        'position: fixed',
        'top: 20px',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 2147483647',
        'padding: 10px 18px',
        'color: #E5E7E2',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        'font-size: 13px',
        'font-weight: 500',
        'border-radius: 8px',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.4)',
        'pointer-events: none',
        'user-select: none',
        'opacity: 0',
        'transition: opacity 160ms ease',
      ].join(';');
      document.body.appendChild(toast);
    }

    const palette = tone === 'error'
      ? { bg: 'rgba(180,40,40,0.95)', border: 'rgba(255,120,120,0.5)' }
      : tone === 'info'
      ? { bg: 'rgba(15,17,21,0.94)', border: 'rgba(157,133,242,0.4)' }
      : { bg: 'rgba(180,130,30,0.95)', border: 'rgba(255,200,90,0.5)' };

    toast.style.background = palette.bg;
    toast.style.border = '1px solid ' + palette.border;
    toast.textContent = message;

    requestAnimationFrame(() => { toast.style.opacity = '1'; });

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { if (toast && toast.parentNode) toast.remove(); }, 200);
    }, duration);
  }

  ns.showToast = showToast;
})();
