(function () {
  'use strict';

  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});

  // Speed presets — each maps to delay/pause/typo parameters consumed by typing.js.
  // Picked to span "very natural but slow" → "fast but still humanish".
  const PRESETS = {
    slow: {
      label: '🐢 Lento',
      baseMin: 50, baseMax: 150,
      punctExtraMin: 150, punctExtraMax: 350,
      thinkEnabled: true,
      thinkEveryMin: 25, thinkEveryMax: 60,
      thinkMsMin: 900, thinkMsMax: 2400,
      typoRate: 0.02,
    },
    medium: {
      label: '🚶 Medio',
      baseMin: 30, baseMax: 80,
      punctExtraMin: 80, punctExtraMax: 180,
      thinkEnabled: true,
      thinkEveryMin: 60, thinkEveryMax: 120,
      thinkMsMin: 400, thinkMsMax: 1200,
      typoRate: 0.01,
    },
    fast: {
      label: '🐇 Rápido',
      baseMin: 15, baseMax: 40,
      punctExtraMin: 40, punctExtraMax: 90,
      thinkEnabled: false,
      thinkEveryMin: 0, thinkEveryMax: 0,
      thinkMsMin: 0, thinkMsMax: 0,
      typoRate: 0.005,
    },
    turbo: {
      label: '🐎 Muy rápido',
      baseMin: 8, baseMax: 20,
      punctExtraMin: 20, punctExtraMax: 50,
      thinkEnabled: false,
      thinkEveryMin: 0, thinkEveryMax: 0,
      thinkMsMin: 0, thinkMsMax: 0,
      typoRate: 0,
    },
  };

  const DEFAULT_KEY = 'medium';
  const STORAGE_KEY = 'scmPasteSpeed';

  function isValidKey(k) {
    return typeof k === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, k);
  }

  // Async accessor — reads from chrome.storage.local. Falls back to localStorage
  // when chrome.storage is not available (popup context vs content script context).
  async function getCurrentSpeedKey() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const out = await chrome.storage.local.get([STORAGE_KEY]);
        const k = out && out[STORAGE_KEY];
        if (isValidKey(k)) return k;
      }
    } catch (_) {}
    try {
      const k = localStorage.getItem(STORAGE_KEY);
      if (isValidKey(k)) return k;
    } catch (_) {}
    return DEFAULT_KEY;
  }

  async function setSpeedKey(k) {
    if (!isValidKey(k)) throw new Error('invalid speed key: ' + k);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: k });
      }
    } catch (_) {}
    try { localStorage.setItem(STORAGE_KEY, k); } catch (_) {}
  }

  function getPreset(k) {
    if (isValidKey(k)) return PRESETS[k];
    return PRESETS[DEFAULT_KEY];
  }

  ns.PRESETS = PRESETS;
  ns.DEFAULT_KEY = DEFAULT_KEY;
  ns.getCurrentSpeedKey = getCurrentSpeedKey;
  ns.setSpeedKey = setSpeedKey;
  ns.getPreset = getPreset;
})();
