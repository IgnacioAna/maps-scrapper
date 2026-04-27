(function () {
  'use strict';

  const ns = window.__SCM_PASTE;
  if (!ns) {
    console.error('[SCM] modules failed to load — extension will not work.');
    return;
  }

  let inFlight = false;

  // Listen for paste events on the document, capture phase, so we can
  // intercept BEFORE WhatsApp's own listeners fire. This works because the
  // browser delivers clipboardData synchronously to paste events — no
  // permission policy to fight.
  function onPaste(ev) {
    // Only act on pastes targeting a compose editable. We accept any
    // contenteditable to support both WhatsApp Web (role="textbox") and
    // Instagram DMs (no role attribute).
    const target = ev.target;
    let editable = null;
    if (target && target.closest) {
      editable = target.closest('div[contenteditable="true"][role="textbox"]') ||
                 target.closest('div[contenteditable="true"]');
    }
    if (!editable) return;

    const cd = ev.clipboardData;
    if (!cd) return;

    const text = cd.getData('text/plain') || cd.getData('text');
    if (!text) return;

    const parsed = ns.parsePastedText(text);
    if (!parsed.valid) {
      // No marker — let the native paste through unchanged.
      return;
    }

    // Got marker — take over.
    ev.preventDefault();
    ev.stopPropagation();

    if (inFlight) {
      ns.showToast('Ya hay un typing en curso, esperá', { tone: 'warn' });
      return;
    }
    inFlight = true;
    runTyping(editable, parsed.text).finally(() => { inFlight = false; });
  }

  async function runTyping(editable, text) {
    if (!text || !text.length) {
      ns.showToast('No hay texto después del marker', { tone: 'warn' });
      return;
    }

    ns.focusEditableAndCollapseToEnd(editable);

    // Type the first char synchronously to keep the user-gesture chain
    // alive (Ctrl+V is a user gesture, but a paste event handler may not
    // count as one for execCommand in some Chromium versions — type the
    // first char immediately to be safe).
    const chars = Array.from(text);
    const firstChar = chars[0];
    const ok = ns.insertChar(editable, firstChar);
    if (!ok) {
      console.warn('[SCM] primary insertText returned false on first char — fallback path active.');
    }

    ns.showBadge();
    ns.updateBadge(1, chars.length);

    const ctl = ns.createCancelController({ editable });

    try {
      const result = await ns.humanType(text, {
        editable,
        onProgress: (cur, total) => ns.updateBadge(cur, total),
        signal: ctl.signal,
        skipFirst: true,
      });
      if (result.aborted) {
        const reason = ctl.signal.reason || 'cancelled';
        if (reason !== 'user-typing') {
          ns.showToast('Typing cancelado', { tone: 'info', duration: 1500 });
        }
      }
    } catch (errCode) {
      console.error('[SCM] typing error:', errCode);
      if (errCode === 'compose-not-found') {
        ns.showToast('No encuentro el campo de texto', { tone: 'error' });
      } else if (errCode === 'ime-active') {
        ns.showToast('Desactivá el IME y reintentá', { tone: 'warn' });
      } else {
        ns.showToast('Error: ' + errCode, { tone: 'error' });
      }
    } finally {
      ctl.dispose();
      ns.hideBadge();
    }
  }

  // Capture phase = run before WhatsApp's listeners.
  document.addEventListener('paste', onPaste, true);

  console.log('[SCM] Pegar como humano — extensión cargada. Copiá desde el panel SCM con marker y hacé Ctrl+V en un chat.');
})();
