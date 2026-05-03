// Standalone popup script. Cannot share globals with content scripts (different
// execution context), so it embeds the same PRESETS table as a constant. Keep
// this in sync with lib/settings.js if presets ever change.

const PRESETS = {
  slow:   { label: '🐢 Lento',      time: '~30-40s' },
  medium: { label: '🚶 Medio',      time: '~12-18s' },
  fast:   { label: '🐇 Rápido',     time: '~5-8s' },
  turbo:  { label: '🐎 Muy rápido', time: '~2-4s' },
};

const STORAGE_KEY = 'scmPasteSpeed';
const DEFAULT_KEY = 'medium';

async function getCurrent() {
  try {
    const out = await chrome.storage.local.get([STORAGE_KEY]);
    const k = out && out[STORAGE_KEY];
    if (k && PRESETS[k]) return k;
  } catch (_) {}
  return DEFAULT_KEY;
}

async function setCurrent(k) {
  if (!PRESETS[k]) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: k });
}

function flashSaved() {
  const flash = document.getElementById('saved-flash');
  if (!flash) return;
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 1100);
}

function render(currentKey) {
  const list = document.getElementById('speed-list');
  list.innerHTML = '';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.className = 'speed-btn' + (key === currentKey ? ' active' : '');
    btn.dataset.key = key;
    btn.innerHTML = `<span class="speed-label">${preset.label}</span><span class="speed-time">${preset.time} / 200 chars</span>`;
    btn.addEventListener('click', async () => {
      await setCurrent(key);
      render(key);
      flashSaved();
    });
    list.appendChild(btn);
  }
}

(async () => {
  const k = await getCurrent();
  render(k);
})();
