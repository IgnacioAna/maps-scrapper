(function () {
  'use strict';

  const MARKER = '__SCM_TYPE__:';
  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});

  // Parse a paste event payload. We do NOT actively read the clipboard —
  // WhatsApp Web's Permissions-Policy blocks both navigator.clipboard.readText()
  // and execCommand('paste'). Instead, we intercept the native `paste` event
  // and read clipboardData synchronously, which the browser allows because
  // the user explicitly pasted (Ctrl+V).
  function parsePastedText(text) {
    if (typeof text !== 'string' || !text.startsWith(MARKER)) {
      return { valid: false };
    }
    return { valid: true, text: text.slice(MARKER.length) };
  }

  ns.MARKER = MARKER;
  ns.parsePastedText = parsePastedText;
})();
