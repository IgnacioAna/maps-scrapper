(function () {
  'use strict';

  const ns = (window.__SCM_PASTE = window.__SCM_PASTE || {});

  // Modifier-only keys that should NOT count as "manual typing" interference
  const MODIFIER_ONLY_KEYS = new Set([
    'Shift', 'Control', 'Alt', 'Meta',
    'CapsLock', 'NumLock', 'ScrollLock',
    'Tab', 'Insert',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'Dead',
  ]);

  function createCancelController(opts) {
    const editable = opts && opts.editable;
    const controller = new AbortController();

    function onKeyDown(ev) {
      if (controller.signal.aborted) return;

      if (ev.key === 'Escape') {
        controller.abort('user-cancelled');
        return;
      }

      // Ignore pure-modifier presses; they don't represent intent to type.
      if (MODIFIER_ONLY_KEYS.has(ev.key)) return;

      // Any other keydown while typing = user wants to take over → pause.
      // We only abort if the target is the editable (or descendants) — keys
      // pressed elsewhere on the page aren't "interfering with the message".
      if (editable && (ev.target === editable || editable.contains(ev.target))) {
        controller.abort('user-typing');
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    function dispose() {
      document.removeEventListener('keydown', onKeyDown, true);
    }

    return { signal: controller.signal, dispose };
  }

  ns.createCancelController = createCancelController;
})();
