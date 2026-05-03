(function () {
  'use strict';

  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});

  // QWERTY adjacency for typo simulation (lowercase, ASCII).
  const QWERTY_NEIGHBORS = {
    a:'sqwz', b:'vghn', c:'xdfv', d:'serfcx', e:'wsdr34',
    f:'drtgvc', g:'ftyhbv', h:'gyujnb', i:'uoj89kl', j:'huiknm',
    k:'jiolm', l:'kop;', m:'njk,',  n:'bhjm', o:'iklp90',
    p:'ol;[0-', q:'12wa', r:'edft45', s:'awedxz', t:'rfgy56',
    u:'yhji78', v:'cfgb', w:'qsea23', x:'zsdc', y:'tghu67',
    z:'asx',
  };

  function isPunctuation(ch) { return /[.,;!?:]/.test(ch); }
  function isAlphaLower(ch) { return /[a-z]/.test(ch); }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function pickTypoFor(ch) {
    const lower = ch.toLowerCase();
    const neighbors = QWERTY_NEIGHBORS[lower];
    if (!neighbors || !neighbors.length) return null;
    const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
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
      console.warn('[SCM] selection setup failed:', e);
    }
  }

  function findCompose() {
    const active = document.activeElement;
    if (active && active.isContentEditable) return active;
    let el = document.querySelector('div[contenteditable="true"][role="textbox"]');
    if (el) return el;
    el = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
         document.querySelector('div[contenteditable="true"][aria-label]') ||
         document.querySelector('form div[contenteditable="true"]') ||
         document.querySelector('div[contenteditable="true"]');
    return el;
  }

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

  function postCharDelay(ch, preset) {
    let d = rand(preset.baseMin, preset.baseMax);
    if (isPunctuation(ch)) d += rand(preset.punctExtraMin, preset.punctExtraMax);
    return d;
  }

  function maybeThinkingPause(charsSinceLastPause, preset) {
    if (!preset.thinkEnabled) return 0;
    if (charsSinceLastPause < preset.thinkEveryMin) return 0;
    const trigger = preset.thinkEveryMin + Math.random() * (preset.thinkEveryMax - preset.thinkEveryMin);
    if (charsSinceLastPause >= trigger) {
      return rand(preset.thinkMsMin, preset.thinkMsMax);
    }
    return 0;
  }

  /**
   * humanType — types `text` into the focused compose, char by char.
   *
   * Options:
   *   - onProgress(current, total)
   *   - signal: AbortSignal
   *   - skipFirst: if true, skip the first char (typed sync by caller)
   *   - editable: pre-resolved compose element
   *   - preset: speed preset object from settings.js (PRESETS[key]). If
   *     omitted, falls back to the 'slow' preset (legacy behavior).
   */
  async function humanType(text, options) {
    const opts = options || {};
    const onProgress = opts.onProgress || function () {};
    const signal = opts.signal;
    const skipFirst = !!opts.skipFirst;
    const preset = opts.preset || (ns.getPreset && ns.getPreset('slow')) || {
      baseMin: 50, baseMax: 150, punctExtraMin: 150, punctExtraMax: 350,
      thinkEnabled: true, thinkEveryMin: 25, thinkEveryMax: 60,
      thinkMsMin: 900, thinkMsMax: 2400, typoRate: 0.02,
    };
    const typoRate = typeof opts.typoRate === 'number' ? opts.typoRate : preset.typoRate;

    const editable = opts.editable || findCompose();
    if (!editable) throw 'compose-not-found';

    const chars = Array.from(text);
    const total = chars.length;
    let typedCount = skipFirst ? 1 : 0;
    let charsSinceLastPause = 0;

    if (skipFirst) {
      onProgress(typedCount, total);
      await sleep(postCharDelay(chars[0], preset));
      charsSinceLastPause = 1;
    }

    for (let i = skipFirst ? 1 : 0; i < total; i++) {
      if (signal && signal.aborted) return { aborted: true, typedCount };

      const ch = chars[i];

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

      await sleep(postCharDelay(ch, preset));

      const thinkPause = maybeThinkingPause(charsSinceLastPause, preset);
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
