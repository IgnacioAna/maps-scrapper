// This content script runs ONLY on the SCM panel (scm-setting.up.railway.app).
// Its sole purpose: tell the panel JS that the extension is installed, so
// the "Copiar humano" buttons can avoid copying the raw marker (which would
// otherwise leak to WhatsApp messages as visible "__SCM_TYPE__:..." text)
// when the user clicks the button without having the extension to consume it.
(function () {
  'use strict';
  try {
    document.documentElement.setAttribute('data-scm-paste-installed', '1');
    document.documentElement.setAttribute('data-scm-paste-version', '0.2.0');
  } catch (_) {}
})();
