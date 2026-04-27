(function () {
  'use strict';

  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});

  // QWERTY adjacency for typo simulation (lowercase, ASCII).
  // Used only to pick a "believable" typo character.
  const QWERTY_NEIGHBORS = {
    a:'sqwz', b:'vghn', c:'xdfv', d:'serfcx', e:'wsdr34',
    f:'drtgvc', g:'ftyhbv', h:'gyujnb', i:'uoj89kl', j:'huiknm',
    k:'jiolm', l:'kop;', m:'njk,',  n:'bhjm', o:'iklp90',
    p:'ol;[0-', q:'12wa', r:'edft45', s:'awedxz', t:'rfgy56',
    u:'yhji78', v:'cfgb', w:'qsea23', x:'zsdc', y:'tghu67',
    z:'asx',
  };

  function isPunctuation(ch) {
    return /[.,;!?:]/.test(ch);
  }

  function isAlphaLower(ch) {
    return /[a-z]/.test(ch);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function pickTypoFor(ch) {
    const lower = ch.toLowerCase();
    const neighbors = QWERTY_NEIGHBORS[lower];
    if (!neighbors || !neighbors.length) return null;
    const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
    // Preserve case of the original char.
    return ch === ch.toUpperCase() && /[a-z]/i.test(ch) ? pick.toUpperCase() : pick;
  }

  function focusEditableAndCollapseToEnd(editable) {
    editable.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      // Selection setup failed — Lexical may still accept input on focus alone.
      // Log and continue.
      console.warn('[SCM] selection setup failed:', e);
    }
  }

  function findCompose() {
    // Strategy: prefer the currently-focused contenteditable. The user just
    // clicked on the compose to put their cursor there (or pasted into it),
    // so the active element is the most reliable signal across sites.
    // Fall back to known selectors for WhatsApp Web and Instagram.
    const active = document.activeElement;
    if (active && active.isContentEditable) return active;

    // WhatsApp Web — confirmed working.
    let el = document.querySelector('div[contenteditable="true"][role="textbox"]');
    if (el) return el;

    // Instagram DMs — compose is contenteditable inside the message form.
    el = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
         document.querySelector('div[contenteditable="true"][aria-label]') ||
         document.querySelector('form div[contenteditable="true"]') ||
         document.querySelector('div[contenteditable="true"]');
    return el;
  }

  // Insert a single character. Returns true if the primary path (execCommand)
  // worked, false if we fell back to InputEvent dispatch.
  function insertChar(editable, ch) {
    const ok = document.execCommand('insertText', false, ch);
    if (ok) return true;

    editable.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertText', data: ch, bubbles: true, cancelable: true,
    }));
    editable.dispatchEvent(new InputEvent('input', {
      inputType: 'insertText', data: ch, bubbles: true,
    }));
    return false;
  }

  // Delete one character backward (for typo correction).
  function deleteBack(editable) {
    const ok = document.execCommand('delete', false);
    if (ok) return;
    editable.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'deleteContentBackward', bubbles: true, cancelable: true,
    }));
    editable.dispatchEvent(new InputEvent('input', {
      inputType: 'deleteContentBackward', bubbles: true,
    }));
  }

  // Compute delay AFTER having typed `ch`, before typing the next char.
  function postCharDelay(ch) {
    let d = rand(50, 150);
    if (isPunctuation(ch)) d += rand(150, 350);
    return d;
  }

  // Roll for a long "thinking" pause every N chars.
  function maybeThinkingPause(charsSinceLastPause) {
    // Trigger window: somewhere between 25 and 60 chars.
    if (charsSinceLastPause < 25) return 0;
    const trigger = 25 + Math.random() * 35;
    if (charsSinceLastPause >= trigger) {
      return rand(900, 2400);
    }
    return 0;
  }

  /**
   * humanType — types `text` into the focused WA Web compose, char by char.
   *
   * Options:
   *   - onProgress(current, total): called after each successful char insert
   *   - signal: AbortSignal; when aborted, loop exits cleanly
   *   - skipFirst: if true, skip the first char (used by orchestrator that
   *     types the first char synchronously to preserve user-gesture)
   *   - typoRate: probability 0..1 of a simulated typo on alpha chars (default 0.02)
   *   - editable: pre-resolved compose element; if absent, resolved internally
   *
   * Throws (string codes): 'compose-not-found', 'ime-active'
   */
  async function humanType(text, options) {
    const opts = options || {};
    const onProgress = opts.onProgress || function () {};
    const signal = opts.signal;
    const skipFirst = !!opts.skipFirst;
    const typoRate = typeof opts.typoRate === 'number' ? opts.typoRate : 0.02;

    const editable = opts.editable || findCompose();
    if (!editable) throw 'compose-not-found';

    // If user is in IME composition (Asian input), abort.
    // :composing is non-standard; rely on a flag we'd set via compositionstart
    // listener if needed. For now, we trust the caller to not invoke during IME.

    const chars = Array.from(text); // handles surrogate pairs
    const total = chars.length;
    let typedCount = skipFirst ? 1 : 0;
    let charsSinceLastPause = 0;

    if (skipFirst) {
      onProgress(typedCount, total);
      await sleep(postCharDelay(chars[0]));
      charsSinceLastPause = 1;
    }

    for (let i = skipFirst ? 1 : 0; i < total; i++) {
      if (signal && signal.aborted) return { aborted: true, typedCount };

      const ch = chars[i];

      // Maybe inject a typo + correction before typing the real char.
      if (isAlphaLower(ch.toLowerCase()) && Math.random() < typoRate) {
        const typo = pickTypoFor(ch);
        if (typo) {
          insertChar(editable, typo);
          await sleep(rand(80, 180));
          if (signal && signal.aborted) return { aborted: true, typedCount };
          deleteBack(editable);
          await sleep(rand(60, 140));
          if (signal && signal.aborted) return { aborted: true, typedCount };
        }
      }

      insertChar(editable, ch);
      typedCount++;
      onProgress(typedCount, total);
      charsSinceLastPause++;

      await sleep(postCharDelay(ch));

      const thinkPause = maybeThinkingPause(charsSinceLastPause);
      if (thinkPause > 0) {
        if (signal && signal.aborted) return { aborted: true, typedCount };
        await sleep(thinkPause);
        charsSinceLastPause = 0;
      }
    }

    return { aborted: false, typedCount };
  }

  ns.humanType = humanType;
  ns.findCompose = findCompose;
  ns.focusEditableAndCollapseToEnd = focusEditableAndCollapseToEnd;
  ns.insertChar = insertChar;
})();
