import LOCATIONS_DB from './locations.js';

const COUNTRY_CODES = {
  "Argentina": "54",
  "Chile": "56",
  "Uruguay": "598",
  "Colombia": "57",
  "México": "52",
  "Perú": "51",
  "Ecuador": "593",
  "Paraguay": "595",
  "Bolivia": "591",
  "Venezuela": "58",
  "Costa Rica": "506",
  "Panamá": "507",
  "República Dominicana": "1",
  "España": "34",
  "Estados Unidos": "1",
  "Brasil": "55"
};

// Lista de prefijos conocidos ordenada por longitud DESC para matchear los más
// específicos primero (ej: 598 antes que 5). Usado para detectar si un número
// ya viene con prefijo internacional aunque no sepamos el country del lead.
const KNOWN_PREFIXES = Object.values(COUNTRY_CODES)
  .filter((p, i, arr) => arr.indexOf(p) === i)
  .sort((a, b) => b.length - a.length);

function digitsAlreadyHavePrefix(digits) {
  if (!digits) return false;
  for (const p of KNOWN_PREFIXES) {
    if (digits.startsWith(p) && digits.length >= p.length + 8 && digits.length <= p.length + 12) {
      return true;
    }
  }
  return false;
}

document.addEventListener('DOMContentLoaded', async () => {
    const API_BASE_URL = window.location.origin && window.location.origin !== 'null' && window.location.origin.startsWith('http')
      ? window.location.origin
      : 'http://localhost:3000';

    // Modo "Ver como" (impersonation visual del admin). Persiste en localStorage.
    // Cuando esta activo, las requests a endpoints de leads agregan
    // ?viewAs=role&asSetterId=xxx para que el backend filtre como ese rol.
    // El admin sigue siendo admin para auth — solo el filtrado de leads cambia.
    const VIEW_AS_KEY = 'scm_view_as';
    function getViewAs() {
      try {
        const raw = localStorage.getItem(VIEW_AS_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch { return null; }
    }
    function setViewAs(viewAs) {
      try {
        if (!viewAs) localStorage.removeItem(VIEW_AS_KEY);
        else localStorage.setItem(VIEW_AS_KEY, JSON.stringify(viewAs));
      } catch {}
    }
    const apiUrl = (path) => {
      let url = path.startsWith('http') ? path : new URL(path, API_BASE_URL).toString();
      // Solo el admin REAL puede impersonar (currentUser.realRole === 'admin').
      // Si la url ya tiene viewAs explicito, no la pisamos.
      const viewAs = getViewAs();
      if (viewAs && viewAs.role && currentUser?.realRole === 'admin') {
        const u = new URL(url);
        if (!u.searchParams.has('viewAs')) {
          u.searchParams.set('viewAs', viewAs.role);
          if (viewAs.setterId) u.searchParams.set('asSetterId', viewAs.setterId);
          url = u.toString();
        }
      }
      return url;
    };

    const authScreen = document.getElementById('auth-screen');
    const mainLayout = document.getElementById('main-layout');
    const authForm = document.getElementById('auth-form');
    const authEmail = document.getElementById('auth-email');
    const authPassword = document.getElementById('auth-password');
    const authMessage = document.getElementById('auth-message');
    const invitePanel = document.getElementById('invite-panel');
    const inviteForm = document.getElementById('invite-form');
    const inviteTokenInput = document.getElementById('invite-token');
    const invitePasswordInput = document.getElementById('invite-password');
    const invitePasswordConfirmInput = document.getElementById('invite-password-confirm');
    const logoutBtn = document.getElementById('logout-btn');
    let currentUser = null;

    // ── Timer anti-baneo WSP ──
    (function setupWspTimer() {
      const widget = document.getElementById('wsp-timer-widget');
      const fab = document.getElementById('wsp-timer-fab');
      const display = document.getElementById('wsp-timer-display');
      const minInput = document.getElementById('wsp-timer-minutes');
      const startBtn = document.getElementById('wsp-timer-start');
      const stopBtn = document.getElementById('wsp-timer-stop');
      if (!widget || !fab) return;
      let endAt = 0, intervalId = null;
      // Audit Sprint 37: migrar `wspTimerMinutes` → `scm_wspTimerMinutes` (namespacing).
      // Backward-compat: leemos el viejo si existe y migramos.
      const _legacyWsp = localStorage.getItem('wspTimerMinutes');
      if (_legacyWsp !== null && localStorage.getItem('scm_wspTimerMinutes') === null) {
        localStorage.setItem('scm_wspTimerMinutes', _legacyWsp);
        localStorage.removeItem('wspTimerMinutes');
      }
      const saved = parseInt(localStorage.getItem('scm_wspTimerMinutes') || '3', 10);
      minInput.value = saved;
      minInput.addEventListener('change', () => localStorage.setItem('scm_wspTimerMinutes', minInput.value));

      function tick() {
        const rem = endAt - Date.now();
        if (rem <= 0) {
          display.textContent = '✅ LISTO';
          display.style.color = 'var(--success)';
          clearInterval(intervalId); intervalId = null;
          // Alarma sonora — 3 beeps secuenciales más fuertes
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            const beep = (freq, startMs, durMs) => {
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.value = freq;
              osc.connect(g); g.connect(ctx.destination);
              const t0 = ctx.currentTime + startMs/1000;
              g.gain.setValueAtTime(0, t0);
              g.gain.linearRampToValueAtTime(0.4, t0 + 0.02);
              g.gain.setValueAtTime(0.4, t0 + (durMs/1000) - 0.05);
              g.gain.linearRampToValueAtTime(0, t0 + durMs/1000);
              osc.start(t0);
              osc.stop(t0 + durMs/1000);
            };
            beep(880, 0, 250);
            beep(1100, 300, 250);
            beep(880, 600, 400);
            setTimeout(() => ctx.close(), 1500);
          } catch(e) { console.warn('Alarma falló:', e); }
          // Vibración móvil
          try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch {}
          // Flash visual del display
          let flashes = 0;
          const flashId = setInterval(() => {
            display.style.background = flashes % 2 === 0 ? 'rgba(91,185,116,0.3)' : 'transparent';
            if (++flashes > 6) { clearInterval(flashId); display.style.background = 'transparent'; }
          }, 250);
          // Notificación
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('⏱️ Timer WSP listo', { body: 'Ya podés mandar el próximo mensaje.' });
          }
          return;
        }
        const m = Math.floor(rem / 60000);
        const s = Math.floor((rem % 60000) / 1000);
        display.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        display.style.color = rem < 30000 ? 'var(--warning)' : 'var(--text-primary)';
      }

      startBtn.addEventListener('click', () => {
        const mins = Math.max(0, parseFloat(minInput.value) || 0);
        if (mins <= 0) return;
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
        endAt = Date.now() + mins * 60000;
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(tick, 500);
        tick();
      });
      stopBtn.addEventListener('click', () => {
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
        display.textContent = '--:--';
        display.style.color = 'var(--text-primary)';
      });

      // FAB toggle
      fab.addEventListener('click', () => {
        widget.style.display = 'flex';
        fab.style.display = 'none';
      });
      const closeBtn = widget.querySelector('button[onclick]');
      if (closeBtn) {
        closeBtn.onclick = () => { widget.style.display = 'none'; fab.style.display = 'block'; };
      }
    })();

    // ── Sidebar colapsable ──
    const sidebarEl = document.querySelector('.sidebar');
    const menuToggleBtn = document.querySelector('.menu-toggle');
    if (sidebarEl && menuToggleBtn) {
      // Poner data-label en cada menu-item para tooltips en colapsado
      sidebarEl.querySelectorAll('.menu-item').forEach(item => {
        const label = item.textContent.trim().replace(/^[^\w¿áéíóú]+/i, '').trim();
        if (label && !item.dataset.label) item.dataset.label = label;
      });
      // Audit Sprint 37: migrar `sidebarCollapsed` → `scm_sidebarCollapsed` (namespacing).
      const _legacySidebar = localStorage.getItem('sidebarCollapsed');
      if (_legacySidebar !== null && localStorage.getItem('scm_sidebarCollapsed') === null) {
        localStorage.setItem('scm_sidebarCollapsed', _legacySidebar);
        localStorage.removeItem('sidebarCollapsed');
      }
      if (localStorage.getItem('scm_sidebarCollapsed') === '1') sidebarEl.classList.add('collapsed');
      menuToggleBtn.addEventListener('click', () => {
        sidebarEl.classList.toggle('collapsed');
        localStorage.setItem('scm_sidebarCollapsed', sidebarEl.classList.contains('collapsed') ? '1' : '0');
      });
    }

    const authResp = await fetch(apiUrl('/api/auth/me'));
    const authState = await authResp.json();
    // Anti-flash: el estado real ya llegó. Removemos el style optimista que poníamos
    // en el <head> y dejamos que las clases .hidden manden de acá en adelante.
    const antiFlashStyle = document.getElementById('scm-anti-flash');
    if (antiFlashStyle) antiFlashStyle.remove();
    if (!authState.authenticated) {
      authScreen.classList.remove('hidden');
      mainLayout.classList.add('hidden');

      const inviteToken = new URLSearchParams(window.location.search).get('invite');
      const inviteErrorPanel = document.getElementById('invite-error-panel');
      const inviteErrorText = document.getElementById('invite-error-text');
      const inviteBackBtn = document.getElementById('invite-back-btn');
      const inviteDisplayName = document.getElementById('invite-display-name');
      const inviteDisplayEmail = document.getElementById('invite-display-email');
      const inviteSubmitBtn = document.getElementById('invite-submit-btn');
      const authSubtitle = document.getElementById('auth-subtitle');

      if (inviteToken) {
        // Cuando hay invite: ocultamos el formulario de login (causa de mucha confusion)
        // y validamos el token contra el server. Si invalido -> panel de error con
        // boton para volver al login normal. Si valido -> panel de invite con nombre/email
        // visible para que el setter NO se confunda.
        authForm.classList.add('hidden');
        inviteTokenInput.value = inviteToken;
        try {
          const inviteResp = await fetch(apiUrl('/api/auth/invites/' + inviteToken));
          if (!inviteResp.ok) {
            const errData = await inviteResp.json().catch(() => ({}));
            inviteErrorText.textContent = errData.error || 'Esta invitación no es válida o ya fue usada.';
            inviteErrorPanel.classList.remove('hidden');
            if (authSubtitle) authSubtitle.textContent = 'Invitación inválida';
          } else {
            const inviteData = await inviteResp.json();
            const inv = inviteData.invite || {};
            inviteDisplayName.textContent = inv.name || '—';
            inviteDisplayEmail.textContent = inv.email || '—';
            invitePanel.classList.remove('hidden');
            if (authSubtitle) authSubtitle.textContent = 'Activá tu acceso al sistema';
            // Auto-focus en el primer input de password
            setTimeout(() => invitePasswordInput.focus(), 100);
          }
        } catch (e) {
          inviteErrorText.textContent = 'No se pudo verificar la invitación. Probá de nuevo en unos minutos.';
          inviteErrorPanel.classList.remove('hidden');
        }
        if (inviteBackBtn) {
          inviteBackBtn.addEventListener('click', () => {
            window.location.href = window.location.pathname; // sin query string
          });
        }
      }

      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authMessage.className = 'auth-message';
        authMessage.textContent = 'Entrando...';
        try {
          const resp = await fetch(apiUrl('/api/auth/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: authEmail.value.trim(), password: authPassword.value })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
          window.location.reload();
        } catch (err) {
          authMessage.className = 'auth-message error';
          authMessage.textContent = err.message || 'Error al ingresar.';
        }
      });

      inviteForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authMessage.className = 'auth-message';
        const pw = invitePasswordInput.value;
        const pw2 = invitePasswordConfirmInput.value;
        if (pw.length < 6) {
          authMessage.className = 'auth-message error';
          authMessage.textContent = 'La contraseña debe tener al menos 6 caracteres.';
          invitePasswordInput.focus();
          return;
        }
        if (pw !== pw2) {
          authMessage.className = 'auth-message error';
          authMessage.textContent = 'Las contraseñas no coinciden. Volvé a escribir la segunda.';
          invitePasswordConfirmInput.focus();
          invitePasswordConfirmInput.select();
          return;
        }
        if (inviteSubmitBtn) { inviteSubmitBtn.disabled = true; inviteSubmitBtn.textContent = 'Creando acceso...'; }
        try {
          const resp = await fetch(apiUrl('/api/auth/accept-invite'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inviteTokenInput.value.trim(), password: pw })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'No se pudo activar la invitación.');
          // El server ya seteo la cookie de sesion. Redirect limpio (sin ?invite=)
          // para que el frontend cargue el dashboard normal del setter.
          authMessage.className = 'auth-message success';
          authMessage.textContent = '¡Listo! Entrando al sistema...';
          window.location.href = window.location.pathname;
        } catch (err) {
          authMessage.className = 'auth-message error';
          authMessage.textContent = err.message || 'Error al activar la invitación.';
          if (inviteSubmitBtn) { inviteSubmitBtn.disabled = false; inviteSubmitBtn.textContent = 'Crear acceso y entrar'; }
        }
      });

      return;
    }

    currentUser = authState.user;

    // Heartbeat de presencia: mientras la pestaña esté visible y autenticada,
    // pingear /api/auth/me cada 60s para que attachAuth actualice lastSeen.
    // Antes los setters mostraban 'hace 3 días' aunque tenían la pestaña abierta
    // porque sin acción del usuario no había request al server. Ahora siempre
    // sabe quién está realmente activo.
    if (!window.__presence_heartbeat) {
      window.__presence_heartbeat = setInterval(() => {
        if (document.visibilityState !== 'hidden') {
          fetch(apiUrl('/api/auth/me'), { credentials: 'include' }).catch(() => {});
        }
      }, 60 * 1000);
    }

    // realRole guarda el rol REAL (cookie auth). role puede ser sobrescrito
    // por viewAs si el admin esta impersonando otro rol para preview.
    currentUser.realRole = currentUser.role;
    currentUser.realSetterId = currentUser.setterId;
    currentUser.realName = currentUser.name;
    const _va = getViewAs();
    if (_va && _va.role && currentUser.realRole === 'admin') {
      currentUser.role = _va.role;
      currentUser.setterId = _va.setterId || '';
      // No cambiamos name — para no confundir, el admin sigue viendo su nombre
      // en el sidebar, solo el rol cambia.
    }
    window.__CURRENT_USER__ = currentUser;
    authScreen.classList.add('hidden');
    mainLayout.classList.remove('hidden');
    document.body.dataset.role = currentUser.role;
    if (currentUser.realRole !== currentUser.role) {
      document.body.dataset.viewAs = '1';
    }

    // Sprint 14: Speed-to-Lead Alert — polling cada 15s para detectar
    // leads que respondieron en WA. Toast prominente + sonido beep.
    // Solo admin/supervisor (los que pueden llamar) tienen este alert.
    if (currentUser.role === 'admin' || currentUser.role === 'supervisor') {
      _startSpeedToLeadPolling();
    }
    // Sprint 27: Callback Due polling — admin + supervisor + setter (cada uno
    // ve solo los suyos en backend). Lightweight, cada 90s.
    _startCallbackDuePolling();

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await fetch(apiUrl('/api/auth/logout'), { method: 'POST' });
        } finally {
          window.location.reload();
        }
      });
    }

    document.querySelectorAll('[data-roles]').forEach((el) => {
      const allowed = (el.getAttribute('data-roles') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (allowed.length === 0) return;
      if (!allowed.includes(currentUser.role)) el.classList.add('hidden');
    });

    // ─── Modo "Ver como" (impersonation visual del admin) ──────────────────
    // Solo el admin REAL puede usar esta funcionalidad. Si esta en modo
    // viewAs, mostramos banner sticky + permitimos volver a admin.
    if (currentUser.realRole === 'admin') {
      const viewAsControl = document.getElementById('view-as-control');
      const viewAsSelect = document.getElementById('view-as-select');
      const viewAsBanner = document.getElementById('view-as-banner');
      const viewAsLabel = document.getElementById('view-as-label');
      const viewAsExit = document.getElementById('view-as-exit');

      // Poblar setters disponibles (uno por setter)
      try {
        const r = await fetch(apiUrl('/api/setters'));
        if (r.ok) {
          const sd = await r.json();
          (sd.setters || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = 'setter:' + s.id;
            opt.textContent = 'Setter · ' + s.name;
            viewAsSelect.appendChild(opt);
          });
        }
      } catch {}

      // Setear el value actual segun localStorage
      const _vaState = getViewAs();
      if (_vaState && _vaState.role) {
        const v = _vaState.role === 'setter'
          ? 'setter:' + (_vaState.setterId || '')
          : _vaState.role + ':';
        viewAsSelect.value = v;
        if (viewAsBanner && viewAsLabel) {
          viewAsBanner.classList.remove('hidden');
          if (_vaState.role === 'setter') {
            const opt = viewAsSelect.options[viewAsSelect.selectedIndex];
            viewAsLabel.textContent = opt ? opt.textContent : 'Setter';
          } else {
            viewAsLabel.textContent = _vaState.role.charAt(0).toUpperCase() + _vaState.role.slice(1);
          }
        }
      }
      viewAsControl?.classList.remove('hidden');

      viewAsSelect?.addEventListener('change', () => {
        const v = viewAsSelect.value;
        if (!v) {
          setViewAs(null);
        } else {
          const [role, setterId] = v.split(':');
          setViewAs({ role, setterId });
        }
        window.location.reload();
      });
      viewAsExit?.addEventListener('click', () => {
        setViewAs(null);
        window.location.reload();
      });
    }

    const form = document.getElementById('scrape-form');
    const queryInput = document.getElementById('query');
    const locationInput = document.getElementById('location');
    const maxPagesInput = document.getElementById('max-pages');
    const startPageInput = document.getElementById('start-page');
    const countrySelect = document.getElementById('country-select');
    const citySelect = document.getElementById('city-select');
    const selectedCitiesDiv = document.getElementById('selected-cities');
    const loader = document.querySelector('.loader');
    const searchBtn = document.getElementById('search-btn');
    const tbody = document.querySelector('#results-table tbody');
    const resultsCount = document.getElementById('results-count');
    const downloadBtn = document.getElementById('download-csv');
    const enrichBtn = document.getElementById('enrich-btn');
    const hideDuplicatesCb = document.getElementById('hide-duplicates');
    const hideLandlinesCb = document.getElementById('hide-landlines');

    hideDuplicatesCb.addEventListener('change', () => {
        if (currentData.length > 0) {
            renderTable(currentData);
        }
    });

    if (hideLandlinesCb) {
        hideLandlinesCb.addEventListener('change', () => {
            if (currentData.length > 0) {
                renderTable(currentData);
            }
        });
    }
    
    const enrichProgress = document.getElementById('enrich-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const filterInfo = document.getElementById('filter-info');
    const historyInfo = document.getElementById('history-info');
  
    let currentData = [];
    let selectedCities = [];

    // Sanitizador para prevenir XSS al inyectar en innerHTML.
    // Sprint 37 (HOTSPOT-11): un solo regex en lugar de 5 replace encadenados.
    // Sobre 5200 leads × 40 escapes por row = 10× más rápido en benchmark.
    const _escMap = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
    const escHtml = (str) => {
      if (!str) return '';
      return String(str).replace(/[&<>"']/g, c => _escMap[c]);
    };

    // Sprint 19: Sanitizar a E.164 estricto (Telnyx-compatible).
    // Saca espacios, guiones, paréntesis. Garantiza que arranque con +.
    // Si no tiene +, asume necesita prefijo internacional (devuelve null si
    // no se puede deducir país por longitud).
    // Sprint 37 (VULN-A1): bloquea javascript:/data:/vbscript: URLs.
    // Solo permite http/https/mailto/tel. Si la URL no tiene scheme válido,
    // se prepende "https://" si parece domain o se devuelve "" para evitar
    // que sea clicable como anchor con scheme malicioso.
    function safeUrl(url) {
      if (!url || typeof url !== 'string') return '';
      const trimmed = url.trim();
      if (!trimmed) return '';
      // Si tiene scheme, validar
      const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
      if (schemeMatch) {
        const scheme = schemeMatch[1].toLowerCase();
        if (!['http','https','mailto','tel'].includes(scheme)) return '';
        return trimmed;
      }
      // Sin scheme: asumir https si parece domain (contains '.')
      if (/\./.test(trimmed) && !/\s/.test(trimmed)) return 'https://' + trimmed;
      return '';
    }

    function _sanitizePhoneE164(phone) {
      if (!phone) return null;
      const raw = String(phone).trim();
      if (!raw) return null;
      // Caso 1: ya viene con + → solo limpiar
      if (raw.startsWith('+')) {
        const cleaned = '+' + raw.substring(1).replace(/\D/g, '');
        // Validar: + seguido de 8-15 dígitos (estándar E.164)
        if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
        return null;
      }
      // Caso 2: empieza con 00 → reemplazar por + (prefijo internacional alt)
      if (raw.startsWith('00')) {
        const cleaned = '+' + raw.substring(2).replace(/\D/g, '');
        if (/^\+\d{8,15}$/.test(cleaned)) return cleaned;
        return null;
      }
      // Caso 3 (Sprint 22 + audit fix Sprint 29): dígitos puros 11-15 con
      // primer dígito no-cero. Mínimo 11 dígitos para no confundir números
      // US/CA de 10 dígitos sin código país con prefijos europeos válidos.
      const digits = raw.replace(/\D/g, '');
      if (/^[1-9]\d{10,14}$/.test(digits)) {
        return '+' + digits;
      }
      return null;
    }

    // ───────────────────────────────────────────────────────────────
    // Sprint 14: Speed-to-Lead Polling (solo admin/supervisor)
    // ───────────────────────────────────────────────────────────────
    let _speedLastCheck = new Date().toISOString();
    let _speedPollTimer = null;
    let _speedAudioCtx = null;
    async function _startSpeedToLeadPolling() {
      if (_speedPollTimer) clearInterval(_speedPollTimer);
      _speedLastCheck = new Date().toISOString();
      const poll = async () => {
        // Sprint 37 (HOTSPOT-7): pausar polling cuando la pestaña no está visible.
        if (document.hidden) return;
        try {
          const r = await fetch(apiUrl('/api/setters/recent-responses?since=' + encodeURIComponent(_speedLastCheck)), { credentials: 'include' });
          if (!r.ok) return;
          const d = await r.json();
          _speedLastCheck = d.serverTs || _speedLastCheck;
          if (Array.isArray(d.responses) && d.responses.length > 0) {
            for (const resp of d.responses) {
              _showSpeedToLeadAlert(resp);
            }
          }
        } catch (e) { /* silent */ }
      };
      _speedPollTimer = setInterval(poll, 15000);
      // Primera ejecución después de 2s (no inmediata para no spam al load)
      setTimeout(poll, 2000);
    }
    function _playBeepSound() {
      try {
        if (!_speedAudioCtx) _speedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _speedAudioCtx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        // 2 beeps: 880Hz → 1100Hz (alerta agradable)
        [880, 1100].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now + i * 0.18);
          gain.gain.linearRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
          gain.gain.setValueAtTime(0.18, now + i * 0.18 + 0.13);
          gain.gain.linearRampToValueAtTime(0, now + i * 0.18 + 0.16);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(now + i * 0.18);
          osc.stop(now + i * 0.18 + 0.18);
        });
      } catch {}
    }
    function _showSpeedToLeadAlert(resp) {
      _playBeepSound();
      // Crear toast prominente custom (no usar showToast normal — este es VIP)
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed; top:24px; right:24px; max-width:380px; background:linear-gradient(135deg, #5bb974 0%, #3a8e4e 100%); color:#fff; padding:14px 18px; border-radius:14px; box-shadow:0 12px 40px rgba(91,185,116,0.5), 0 0 0 2px rgba(255,255,255,0.1); z-index:99999; animation:tlxSlideInRight 0.3s cubic-bezier(0.16,1,0.3,1); cursor:pointer;';
      const cityCountry = [resp.leadCity, resp.leadCountry].filter(Boolean).join(', ');
      wrap.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <div style="font-size:24px; flex-shrink:0;">🔥</div>
          <div style="flex:1;">
            <div style="font-size:11px; opacity:0.9; text-transform:uppercase; letter-spacing:0.6px; font-weight:600;">Speed-to-lead — LLAMÁ YA</div>
            <div style="font-size:14px; font-weight:700; margin-top:3px;">${escHtml(resp.leadName || resp.leadPhone || 'Lead')} respondió</div>
            <div style="font-size:11.5px; opacity:0.85; margin-top:2px;">${escHtml(cityCountry)} · ${escHtml(resp.leadPhone || '')}</div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <button data-action="call" style="background:#fff; color:#3a8e4e; border:none; padding:5px 11px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">📞 Llamar ahora</button>
              <button data-action="dismiss" style="background:rgba(255,255,255,0.2); color:#fff; border:1px solid rgba(255,255,255,0.3); padding:5px 11px; border-radius:6px; font-size:11px; cursor:pointer;">Después</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      // Wire botones
      wrap.querySelector('[data-action="call"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.remove();
        // Ir a view-calls
        document.querySelector('[data-target="view-calls"]')?.click();
        // Después de un tick, scroll al lead si está visible
        setTimeout(() => {
          const row = document.querySelector(`.call-row[data-id="${resp.leadId}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.boxShadow = '0 0 0 3px #5bb974';
            setTimeout(() => { row.style.boxShadow = ''; }, 3000);
          } else {
            window.showToast?.(`El lead ${resp.leadName} está en Setteo (WA), no en Llamadas.`, { type: 'info' });
          }
        }, 400);
      });
      wrap.querySelector('[data-action="dismiss"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.remove();
      });
      // Auto-dismiss después de 25s si no clickea
      setTimeout(() => { if (wrap.parentNode) wrap.remove(); }, 25000);
    }
    // CSS animation para el toast
    if (!document.getElementById('tlx-speed-css')) {
      const s = document.createElement('style');
      s.id = 'tlx-speed-css';
      s.textContent = '@keyframes tlxSlideInRight { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }';
      document.head.appendChild(s);
    }

    // ───────────────────────────────────────────────────────────────
    // Sprint 27: Callback Due Polling
    // Cada 90s, fetch callbacks vencidos en los últimos 90 minutos
    // (no notificados aún). Toast + beep distintivo. LocalStorage de
    // IDs notificados para no spammear entre refreshes.
    // ───────────────────────────────────────────────────────────────
    let _cbLastCheck = new Date().toISOString();
    let _cbPollTimer = null;
    function _cbGetNotifiedSet() {
      try {
        const raw = localStorage.getItem('scm_cb_notified_' + (currentUser?.id || 'anon'));
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
      } catch { return new Set(); }
    }
    function _cbAddNotified(id) {
      try {
        const set = _cbGetNotifiedSet();
        set.add(id);
        // Cap a últimos 500 para no crecer indefinidamente
        const arr = [...set].slice(-500);
        localStorage.setItem('scm_cb_notified_' + (currentUser?.id || 'anon'), JSON.stringify(arr));
      } catch {}
    }
    function _playCallbackBeep() {
      // Patrón distinto al speed-to-lead: 3 beeps cortos descendentes
      try {
        if (!_speedAudioCtx) _speedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ctx = _speedAudioCtx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        [1200, 1000, 800].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now + i * 0.13);
          gain.gain.linearRampToValueAtTime(0.14, now + i * 0.13 + 0.015);
          gain.gain.setValueAtTime(0.14, now + i * 0.13 + 0.09);
          gain.gain.linearRampToValueAtTime(0, now + i * 0.13 + 0.11);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(now + i * 0.13);
          osc.stop(now + i * 0.13 + 0.12);
        });
      } catch {}
    }
    function _showCallbackDueAlert(item, withBeep = true) {
      if (withBeep) _playCallbackBeep();
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed; top:24px; right:24px; max-width:380px; background:linear-gradient(135deg, #5BA3F2 0%, #2F70C0 100%); color:#fff; padding:14px 18px; border-radius:14px; box-shadow:0 12px 40px rgba(91,163,242,0.5), 0 0 0 2px rgba(255,255,255,0.1); z-index:99999; animation:tlxSlideInRight 0.3s cubic-bezier(0.16,1,0.3,1); cursor:pointer;';
      const cityCountry = [item.city, item.country].filter(Boolean).join(', ');
      const cbTime = new Date(item.callbackAt);
      const timeStr = `${String(cbTime.getHours()).padStart(2,'0')}:${String(cbTime.getMinutes()).padStart(2,'0')}`;
      wrap.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:10px;">
          <div style="font-size:24px; flex-shrink:0;">📅</div>
          <div style="flex:1;">
            <div style="font-size:11px; opacity:0.9; text-transform:uppercase; letter-spacing:0.6px; font-weight:600;">Callback programado — ${timeStr}</div>
            <div style="font-size:14px; font-weight:700; margin-top:3px;">${escHtml(item.name || item.phone || 'Lead')}</div>
            <div style="font-size:11.5px; opacity:0.85; margin-top:2px;">${escHtml(cityCountry)} · ${escHtml(item.phone || '')}</div>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <button data-action="call" style="background:#fff; color:#2F70C0; border:none; padding:5px 11px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">📞 Llamar ahora</button>
              <button data-action="dismiss" style="background:rgba(255,255,255,0.2); color:#fff; border:1px solid rgba(255,255,255,0.3); padding:5px 11px; border-radius:6px; font-size:11px; cursor:pointer;">Cerrar</button>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      wrap.querySelector('[data-action="call"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.remove();
        document.querySelector('[data-target="view-calls"]')?.click();
        setTimeout(() => {
          const row = document.querySelector(`.call-row[data-id="${CSS.escape(item.id)}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.outline = '2px solid #5BA3F2';
            setTimeout(() => { row.style.outline = ''; }, 2000);
          }
        }, 400);
      });
      wrap.querySelector('[data-action="dismiss"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        wrap.remove();
      });
      // Auto-dismiss tras 40s (más tiempo que speed-to-lead porque es menos urgente)
      setTimeout(() => { if (wrap.parentNode) wrap.remove(); }, 40000);
    }
    async function _startCallbackDuePolling() {
      if (_cbPollTimer) clearInterval(_cbPollTimer);
      _cbLastCheck = '';
      const poll = async () => {
        // Sprint 37 (HOTSPOT-7): pausar polling cuando la pestaña no está visible.
        if (document.hidden) return;
        try {
          const sinceParam = _cbLastCheck ? '&since=' + encodeURIComponent(_cbLastCheck) : '';
          const r = await fetch(apiUrl('/api/setters/callbacks/due?window=90' + sinceParam), { credentials: 'include' });
          if (!r.ok) return;
          const d = await r.json();
          _cbLastCheck = d.serverTime || _cbLastCheck;
          if (Array.isArray(d.items) && d.items.length > 0) {
            const notified = _cbGetNotifiedSet();
            // Sprint 37 (BUG-A6): throttle a 3 toasts simultáneos + delay 2s
            // entre cada uno para no saturar audio context con 100 beeps.
            // El primer toast hace beep, los demás solo visual.
            let shownInBatch = 0;
            for (let i = 0; i < d.items.length; i++) {
              const item = d.items[i];
              const key = `${item.id}:${item.callbackAt}`;
              if (notified.has(key)) continue;
              const delay = Math.min(shownInBatch, 10) * 2000;
              setTimeout(() => _showCallbackDueAlert(item, shownInBatch === 0), delay);
              _cbAddNotified(key);
              shownInBatch++;
              if (shownInBatch >= 20) break; // hard cap por batch
            }
          }
        } catch (e) { /* silent */ }
      };
      _cbPollTimer = setInterval(poll, 90000); // 90s
      setTimeout(poll, 3000); // primera corrida después de 3s
      // Sprint 37 (re-audit fix): visibilitychange listener una sola vez en
      // toda la vida de la app (sino acumula handlers en cada re-login).
      if (!window.__cbVisibilityRegistered) {
        window.__cbVisibilityRegistered = true;
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && _cbPollTimer) setTimeout(() => {
            // re-disparar el polling al volver (sin redeclarar poll)
            _cbPollTimer && _cbPollTimer._fn?.();
          }, 500);
        });
      }
      // Guardar fn en el timer para que el visibilitychange pueda invocarlo
      if (_cbPollTimer) _cbPollTimer._fn = poll;
    }
    function _stopCallbackDuePolling() {
      if (_cbPollTimer) { clearInterval(_cbPollTimer); _cbPollTimer = null; }
    }

    // Poblar selector de países
    const countries = Object.keys(LOCATIONS_DB).sort();
    countries.forEach(country => {
      const opt = document.createElement('option');
      opt.value = country;
      opt.textContent = country;
      countrySelect.appendChild(opt);
    });

    countrySelect.addEventListener('change', () => {
      const country = countrySelect.value;
      citySelect.innerHTML = '';

      if (!country) {
        citySelect.disabled = true;
        citySelect.innerHTML = '<option value="">Ciudad</option>';
        return;
      }

      const cities = LOCATIONS_DB[country] || [];
      citySelect.disabled = false;

      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = `Elegir ciudad...`;
      citySelect.appendChild(allOpt);

      const allCitiesOpt = document.createElement('option');
      allCitiesOpt.value = '__ALL__';
      allCitiesOpt.textContent = `★ Agregar TODAS (${cities.length})`;
      citySelect.appendChild(allCitiesOpt);

      cities.forEach(city => {
        const opt = document.createElement('option');
        opt.value = `${city}, ${country}`;
        opt.textContent = city;
        citySelect.appendChild(opt);
      });
    });

    citySelect.addEventListener('change', () => {
      const value = citySelect.value;
      if (!value) return;

      if (value === '__ALL__') {
        const country = countrySelect.value;
        const cities = LOCATIONS_DB[country] || [];
        cities.forEach(city => {
          const fullCity = `${city}, ${country}`;
          if (!selectedCities.includes(fullCity)) {
            selectedCities.push(fullCity);
          }
        });
      } else {
        if (!selectedCities.includes(value)) {
          selectedCities.push(value);
        }
      }

      updateSelectedCities();
      citySelect.value = '';
    });

    function updateSelectedCities() {
      locationInput.value = selectedCities.join(';');

      if (selectedCities.length === 0) {
        selectedCitiesDiv.innerHTML = '';
        return;
      }

      selectedCitiesDiv.innerHTML = selectedCities.map((city, idx) => {
        // Extraer formato corto ("Ciudad, País" -> "Ciudad") para el badge
        const shortname = city.split(',')[0].trim();
        return `<span class="city-tag">${shortname} <button type="button" class="remove-city" data-idx="${idx}">✕</button></span>`
      }).join('') + `<button type="button" class="btn-table-action" style="border:none; color: var(--danger)" id="clear-cities">Limpiar todo</button>`;

      selectedCitiesDiv.querySelectorAll('.remove-city').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedCities.splice(parseInt(btn.dataset.idx), 1);
          updateSelectedCities();
        });
      });

      document.getElementById('clear-cities')?.addEventListener('click', () => {
        selectedCities = [];
        updateSelectedCities();
      });

      suggestPage();
    }

    const suggestPage = async () => {
      const q = queryInput.value.trim();
      const l = locationInput.value.trim();
      if (!q) return;
      // Si hay multiples keywords, no auto-sugerir (cada una tiene su propio
      // contador independiente y combinarlas da numeros absurdos).
      const lineCount = q.split(/\r?\n/).filter(line => line.trim()).length;
      if (lineCount > 1) {
        startPageInput.value = 1;
        return;
      }
      // Sin pais/ciudad seleccionada no tiene sentido sugerir paginas — el
      // paging es por (query + ciudad). Sin ciudad, default a 1 y esperar.
      if (!l) {
        startPageInput.value = 1;
        return;
      }
      try {
        const r = await fetch(apiUrl(`/api/history/suggest-page?query=${encodeURIComponent(q)}&location=${encodeURIComponent(l)}`));
        const { suggestedPage } = await r.json();
        if (suggestedPage > 1) {
            startPageInput.value = suggestedPage;
            startPageInput.style.color = 'var(--primary-color)';
            startPageInput.style.borderColor = 'var(--primary-color)';
            setTimeout(() => {
                startPageInput.style.color = '';
                startPageInput.style.borderColor = '';
            }, 1000);
        } else {
            startPageInput.value = 1;
        }
      } catch (e) {}
    };

    let debounceTimer;
    queryInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(suggestPage, 500);
    });

    if (currentUser?.role === 'admin') loadHistoryStats();

    async function loadHistoryStats() {
      try {
        const resp = await fetch(apiUrl('/api/history/stats'));
        const stats = await resp.json();
        if (stats.totalEntries > 0) {
          historyInfo.innerHTML = `Historial local: <strong>${stats.totalEntries} leads totales</strong>`;
          historyInfo.classList.remove('hidden');
        } else {
          historyInfo.classList.add('hidden');
        }
      } catch {}
    }
  
    // Función utilitaria para asegurar que la URL del sitio web tiene http(s)
    const normalizeUrl = (url) => {
        if (!url) return '';
        url = url.trim();
        if (!/^https?:\/\//i.test(url)) {
            return `https://${url}`;
        }
        return url;
    };

    // 2026-05-24: TODOS los setters acceden a TODAS las variantes (pedido del user).
    // Antes filtraba por setterId — cada setter solo veia las suyas o globales.
    // Ahora todas son visibles. El campo `setterId` queda como info de ownership
    // pero ya no restringe visibilidad.
    const getVisibleVariables = () => {
      return Array.isArray(variantsList) ? [...variantsList] : [];
    };

    const getVariantById = (id) => variantsList.find((v) => v.id === id) || null;

    const getLeadVariant = (lead) => getVariantById(lead?.varianteId || currentVariableId) || null;

    const buildStageMessage = (lead, variant, stage, block) => {
      if (block?.text) {
        return String(block.text)
          .replace(/\{\{nombre\}\}/g, lead?.name || '')
          .replace(/\{\{name\}\}/g, lead?.name || '')
          .trim();
      }
      const blocks = Array.isArray(variant?.blocks) ? variant.blocks : [];
      const fallback = blocks.find((b) => b.label?.toLowerCase().includes(stage.toLowerCase())) || blocks[0] || null;
      const text = String(fallback?.text || variant?.messages?.apertura || '')
        .replace(/\{\{nombre\}\}/g, lead?.name || '')
        .replace(/\{\{name\}\}/g, lead?.name || '')
        .trim();
      return text || `Buenas, ¿cómo están?`;
    };

    // Helper: copia el link al portapapeles al hacer click (sin bloquear el target="_blank")
    // Muestra toast breve "Link copiado" y permite que el navegador abra WhatsApp normal
    window._waClickCopy = (el, ev) => {
      try {
        if (ev) ev.stopPropagation();
        const url = el.href || el.getAttribute('data-wa-url') || '';
        // Extraer SOLO el número del wa.me URL (lo que el user pega en WAMULTI).
        // Formato: https://wa.me/<digits>?text=... → queremos +<digits>.
        let phone = '';
        const m = url.match(/wa\.me\/(\d+)/);
        if (m) phone = '+' + m[1];
        else {
          // fallback: si el botón trae data-phone explícito, usarlo
          const dp = el.getAttribute('data-phone');
          if (dp) phone = dp.startsWith('+') ? dp : '+' + String(dp).replace(/\D/g, '');
        }
        const toCopy = phone || url;
        if (toCopy && navigator.clipboard) {
          navigator.clipboard.writeText(toCopy).then(() => {
            let t = document.getElementById('_wa-toast');
            if (!t) {
              t = document.createElement('div');
              t.id = '_wa-toast';
              t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transition:opacity .2s;';
              document.body.appendChild(t);
            }
            t.textContent = phone ? `✓ ${phone} copiado — pegalo en el buscador de WAMULTI` : '✓ Link copiado';
            t.style.opacity = '1';
            clearTimeout(window._waToastTimer);
            window._waToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
          }).catch(() => {});
        }
      } catch (e) { console.error(e); }
      // NO llamar preventDefault → el link abre WhatsApp normalmente
      return true;
    };

    // ── WAMULTI v0.5.8: abrir chat en WAMULTI (con elección de cuenta) ──
    // Solo habilitado para Ignacio (admin o setter_ignacio) en fase de testing.
    window._waMultiEnabled = () => {
      const u = currentUser || {};
      return u.realRole === 'admin' || u.realSetterId === 'setter_ignacio' || u.setterId === 'setter_ignacio';
    };
    // Cache de cuentas WA del user (para el popover). Se refresca al abrir.
    let _waAccountsCache = null;
    async function _waLoadAccounts() {
      try {
        const r = await fetch(apiUrl('/api/wa/accounts'), { credentials: 'include' });
        if (!r.ok) return [];
        const accs = await r.json();
        // Mostrar TODAS las cuentas del user. El status del JSON puede estar
        // stale (WAMULTI cerrado lo deja en DISCONNECTED aunque al abrirlo
        // reconecte). WAMULTI decide si puede abrir el chat o no. Marcamos
        // el status para que el popover lo muestre como hint visual.
        _waAccountsCache = accs || [];
        return _waAccountsCache;
      } catch { return []; }
    }
    function _waClosePopover() {
      document.getElementById('_wamulti-popover')?.remove();
      document.removeEventListener('click', _waPopoverOutside, true);
    }
    // Busca un lead por ID en cualquiera de los caches activos (setteo, llamadas).
    function _waFindLead(leadId) {
      if (!leadId) return null;
      try { if (typeof _callsLeadsById !== 'undefined' && _callsLeadsById.has?.(leadId)) return _callsLeadsById.get(leadId); } catch {}
      try { if (typeof setterLeads !== 'undefined') { const l = setterLeads.find(x => x.id === leadId); if (l) return l; } } catch {}
      try { if (typeof callsLeadsCache !== 'undefined') { const l = callsLeadsCache.find(x => x.id === leadId); if (l) return l; } } catch {}
      return null;
    }
    function _waPopoverOutside(e) {
      const pop = document.getElementById('_wamulti-popover');
      if (pop && !pop.contains(e.target)) _waClosePopover();
    }
    // Handler principal del botón. Devuelve true si dejó pasar el comportamiento
    // normal (wa.me), false si interceptó para WAMULTI.
    window._waMultiClick = async (el, ev, leadId) => {
      if (!window._waMultiEnabled()) return true; // no-Ignacio → wa.me normal
      ev.preventDefault();
      ev.stopPropagation();
      // Extraer phone + text del href wa.me
      const url = el.href || el.getAttribute('data-wa-url') || '';
      const mp = url.match(/wa\.me\/(\d+)/);
      const phone = mp ? mp[1] : (el.getAttribute('data-phone') || '').replace(/\D/g, '');
      let text = '';
      const mt = url.match(/[?&]text=([^&]+)/);
      if (mt) { try { text = decodeURIComponent(mt[1]); } catch { text = mt[1]; } }
      if (!phone) { window.showToast?.('No pude leer el número del lead.', { type:'error' }); return false; }
      _waClosePopover();
      // ── ATAJO: si el lead YA fue contactado, abrir DIRECTO la conversación
      // en la cuenta que lo contactó (sin popover, sin mensaje precargado).
      // Pensado para cargar el CRM al final del día: click → ves cómo quedó.
      const leadObj = _waFindLead(leadId);
      let contactedAcc = leadObj && leadObj.contactedFromAccountId ? leadObj.contactedFromAccountId : null;
      let contactedPhone = leadObj && leadObj.contactedFromPhone ? leadObj.contactedFromPhone : null;
      // Si el cache NO dice que fue contactado, consultar el backend (el cache
      // del frontend no se entera del envío hasta recargar la vista — por eso
      // algunos leads ya contactados abrían el popover de nuevo). Verificación
      // fresca antes de decidir.
      if (!contactedAcc && leadId) {
        try {
          const r = await fetch(apiUrl('/api/setters/leads/' + encodeURIComponent(leadId) + '/contact-status'), { credentials: 'include' });
          if (r.ok) {
            const cs = await r.json();
            if (cs && cs.contactedFromAccountId) {
              contactedAcc = cs.contactedFromAccountId;
              contactedPhone = cs.contactedFromPhone;
              // actualizar el cache local para próximos clicks
              if (leadObj) { leadObj.contactedFromAccountId = contactedAcc; leadObj.contactedFromPhone = contactedPhone; leadObj.contactedAt = cs.contactedAt; }
            }
          }
        } catch {}
      }
      if (contactedAcc) {
        const proto = `wamulti://send?phone=${encodeURIComponent(phone)}&text=&accountId=${encodeURIComponent(contactedAcc)}&leadId=${encodeURIComponent(leadId || '')}`;
        window.location.href = proto;
        window.showToast?.(`Abriendo la conversación en ${contactedPhone || 'la cuenta que lo contactó'}…`, { type:'info', duration:3500 });
        return false;
      }
      const accounts = await _waLoadAccounts();
      if (accounts.length === 0) {
        window.showToast?.('No hay cuentas WAMULTI conectadas. Abrí WAMULTI primero.', { type:'warning', duration:4000 });
        return false;
      }
      // Render popover al lado del botón
      const pop = document.createElement('div');
      pop.id = '_wamulti-popover';
      const rect = el.getBoundingClientRect();
      pop.style.cssText = `position:fixed; z-index:10000; top:${Math.min(rect.bottom+6, window.innerHeight-200)}px; left:${Math.min(rect.left, window.innerWidth-260)}px; background:var(--bg-surface,#16181d); border:1px solid var(--border-color,#2a2d35); border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,0.5); padding:8px; min-width:240px;`;
      const flagOf = (c) => ({ ES:'🇪🇸',MX:'🇲🇽',AR:'🇦🇷',CO:'🇨🇴',CL:'🇨🇱',PE:'🇵🇪',UY:'🇺🇾',BO:'🇧🇴',US:'🇺🇸',EC:'🇪🇨' })[c] || '📱';
      pop.innerHTML = `<div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); padding:4px 8px 8px;">¿Desde qué WhatsApp?</div>` +
        accounts.map(a => {
          const conn = a.status === 'CONNECTED';
          const dot = conn ? '🟢' : (a.status === 'QR_PENDING' ? '🟡' : '⚪');
          return `<button type="button" data-acc="${escHtml(a.id)}" style="display:flex; align-items:center; gap:10px; width:100%; text-align:left; padding:9px 10px; border:none; background:transparent; color:var(--text-primary); border-radius:7px; cursor:pointer; font-size:13px; font-family:inherit;" onmouseover="this.style.background='rgba(157,133,242,0.10)'" onmouseout="this.style.background='transparent'">
          <span style="font-size:14px;">${dot}</span>
          <span style="flex:1; min-width:0;"><div style="font-weight:600;">${escHtml(a.label || 'Cuenta')}</div><div style="font-size:11px; color:var(--text-tertiary); font-family:ui-monospace,monospace;">${escHtml(a.phone || '')}</div></span>
        </button>`;
        }).join('');
      document.body.appendChild(pop);
      pop.querySelectorAll('button[data-acc]').forEach(btn => {
        btn.addEventListener('click', () => {
          const accountId = btn.getAttribute('data-acc');
          const proto = `wamulti://send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&accountId=${encodeURIComponent(accountId)}&leadId=${encodeURIComponent(leadId||'')}`;
          window.location.href = proto;
          _waClosePopover();
          window.showToast?.('Abriendo en WAMULTI… revisá y enviá. Se registra al enviar.', { type:'info', duration:4000 });
        });
      });
      setTimeout(() => document.addEventListener('click', _waPopoverOutside, true), 50);
      return false;
    };

    // Wrapper SÍNCRONO para el onclick del botón (el preventDefault debe ser
    // síncrono). Si es Ignacio → intercepta para WAMULTI. Si no → wa.me normal.
    window._waBtnClick = (el, ev, leadId) => {
      if (window._waMultiEnabled()) {
        ev.preventDefault();
        ev.stopPropagation();
        window._waMultiClick(el, ev, leadId);
        return false;
      }
      // no-Ignacio: copiar número + dejar que el link abra wa.me normal
      window._waClickCopy(el, ev);
      return true;
    };

    const buildSetterWaUrl = (lead, stage = 'apertura') => {
      // Si el lead tiene su propia URL de WhatsApp importada (del CSV), usarla directamente en apertura
      if (stage === 'apertura' && lead?.whatsappUrl && lead.whatsappUrl.includes('wa.me/')) {
        // BUGFIX: muchos leads viejos tenian whatsappUrl SIN ?text= (solo wa.me/NUMERO)
        // y openMessage por separado, pero nunca se mergearon. Si falta el text y
        // hay openMessage, lo agregamos al vuelo asi el setter abre WSP con el
        // mensaje pre-cargado.
        if (lead.whatsappUrl.includes('?text=') || lead.whatsappUrl.includes('&text=')) {
          return lead.whatsappUrl;
        }
        if (lead.openMessage) {
          const sep = lead.whatsappUrl.includes('?') ? '&' : '?';
          return `${lead.whatsappUrl}${sep}text=${encodeURIComponent(lead.openMessage)}`;
        }
        return lead.whatsappUrl;
      }
      const phone = lead?.phone || lead?.webWhatsApp || lead?.aiWhatsApp || '';
      if (!phone) return '';
      const variant = getLeadVariant(lead);
      // Si el lead tiene openMessage propio y estamos en apertura, usar ese en vez del de la variante
      const message = (stage === 'apertura' && lead?.openMessage) ? lead.openMessage : buildStageMessage(lead, variant, stage);
      const country = lead?.country || lead?.locationCountry || '';
      let digits = phone.replace(/\D/g, '');
      if (!digits) return '';
      // BUGFIX zona fronteriza: numeros US '(NNN) NNN-NNNN' en clinicas de
      // Tijuana/Juarez/Reynosa. Forzamos +1 ignorando country=Mexico para que
      // el wa.me funcione (sino quedaba wa.me/52NNNNNNNNNN que no existe).
      const looksUSFormat = /^\(\d{3}\)\s?\d{3}[-\s]?\d{4}$/.test(phone.trim());
      if (looksUSFormat && digits.length === 10) {
        return `https://wa.me/1${digits}?text=${encodeURIComponent(message)}`;
      }
      const prefix = COUNTRY_CODES[country] || '';
      if (phone.trim().startsWith('+')) return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      if (prefix && digits.startsWith(prefix) && digits.length >= prefix.length + 8) return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      // Si ya tiene un prefijo internacional conocido aunque no sepamos el country, usar tal cual
      if (digitsAlreadyHavePrefix(digits)) return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      if (digits.startsWith('0')) digits = digits.substring(1);
      if (prefix === '54' && !digits.startsWith('9') && digits.length >= 10) digits = '9' + digits;
      return `https://wa.me/${prefix || '1'}${digits}?text=${encodeURIComponent(message)}`;
    };

    const stageLabels = {
      apertura: 'Apertura',
      problema: 'Calificación 1',
      pruebaSocial: 'Calificación 2',
      cierrePregunta: 'Cierre'
    };

    const renderBlocks = (variant, lead) => {
      const blocks = Array.isArray(variant?.blocks) ? variant.blocks : [];
      const container = document.getElementById('lead-variable-blocks');
      if (!container) return;
      if (!variant || blocks.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column:1/-1; padding:12px;">Sin bloques en esta variable.</div>';
        return;
      }
      container.innerHTML = blocks.map((block) => {
        const text = String(block.text || '').replace(/\{\{nombre\}\}/g, lead?.name || '').replace(/\{\{name\}\}/g, lead?.name || '');
        return `
          <div class="variant-block-card">
            <div class="variant-block-head">
              <strong>${escHtml(block.label || 'Bloque')}</strong>
              <span class="variant-block-meta">${stageLabels?.[block.label?.toLowerCase()] || ''}</span>
            </div>
            <div class="variant-block-text">${escHtml(text)}</div>
            <div class="variant-block-actions">
              <button type="button" class="copy-block-btn" data-copy-text="${escHtml(text)}">Copiar</button>
              <button type="button" class="copy-block-btn" data-copy-human-text="${escHtml(text)}" title="Copiar para Pegar como humano (extensión Chrome)" style="color:var(--accent);">👤 Copiar humano</button>
              <button type="button" class="copy-block-btn" data-open-wa="${escHtml(text)}">Abrir WhatsApp</button>
            </div>
          </div>`;
      }).join('');
      container.querySelectorAll('[data-copy-text]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await copyToClipboard(btn.getAttribute('data-copy-text') || '');
          const prev = btn.textContent;
          btn.textContent = 'Copiado';
          setTimeout(() => { btn.textContent = prev; }, 1200);
        });
      });
      container.querySelectorAll('[data-copy-human-text]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const txt = btn.getAttribute('data-copy-human-text') || '';
          const ext = document.documentElement.getAttribute('data-scm-paste-installed') === '1';
          await copyToClipboard(ext ? ('__SCM_TYPE__:' + txt) : txt);
          const prev = btn.textContent;
          btn.textContent = ext ? '✓ Ctrl+V en WA' : '⚠ Sin extensión — copié normal';
          setTimeout(() => { btn.textContent = prev; }, 2400);
        });
      });
      container.querySelectorAll('[data-open-wa]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const text = btn.getAttribute('data-open-wa') || '';
          const phone = lead?.phone || lead?.webWhatsApp || lead?.aiWhatsApp || '';
          const country = lead?.country || lead?.locationCountry || '';
          let digits = phone.replace(/\D/g, '');
          const prefix = COUNTRY_CODES[country] || '';
          if (!digits) return;
          if (phone.trim().startsWith('+')) {
            window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank');
            return;
          }
          if (prefix && digits.startsWith(prefix) && digits.length >= prefix.length + 8) {
            window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank');
            return;
          }
          if (digitsAlreadyHavePrefix(digits)) {
            window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank');
            return;
          }
          if (digits.startsWith('0')) digits = digits.substring(1);
          if (prefix === '54' && !digits.startsWith('9') && digits.length >= 10) digits = '9' + digits;
          window.open(`https://wa.me/${prefix || '1'}${digits}?text=${encodeURIComponent(text)}`, '_blank');
        });
      });
    };

    const copyToClipboard = async (text) => {
      if (!text) return;
      await navigator.clipboard.writeText(String(text));
    };

    // Función que arma el link internacional para WA
    const buildWaStr = (phone, rawCountryPrefix) => {
        if (!phone) return '';
        let prefix = "1";
        if (rawCountryPrefix && COUNTRY_CODES[rawCountryPrefix]) {
            prefix = COUNTRY_CODES[rawCountryPrefix];
        }

        let digits = phone.replace(/\D/g, '');
        if (digits.length < 7) return phone; // Muy corto para ser teléfono real

        // Si tiene +, ya viene con código internacional
        if (phone.trim().startsWith('+')) {
            return `https://wa.me/${digits}`;
        }

        // Detectar si el número YA contiene el código de país (sin +)
        // Ej: "5491134567890" ya tiene el 54 de Argentina
        if (digits.startsWith(prefix) && digits.length >= (prefix.length + 8)) {
            return `https://wa.me/${digits}`;
        }

        // Si ya arranca con CUALQUIER prefijo conocido (aunque no coincida con
        // el country del lead, ej. lead sin country o country mal cargado), usar tal cual
        if (digitsAlreadyHavePrefix(digits)) {
            return `https://wa.me/${digits}`;
        }

        // Quitar 0 inicial (convención local en muchos países)
        if (digits.startsWith('0')) digits = digits.substring(1);

        // Argentina: insertar 9 después del 54 si es celular (requerido por WA)
        if (prefix === '54' && !digits.startsWith('9') && digits.length >= 10) {
            digits = '9' + digits;
        }

        return `https://wa.me/${prefix}${digits}`;
    };

    // Reglas estrictas de celular por país
    const isMobilePhone = (phone, rawCountryPrefix) => {
        if (!phone) return false;
        let digits = phone.replace(/\D/g, '');
        if (digits.length < 7) return false;

        // Si viene con +, extraer sin el código de país para analizar la parte local
        let prefix = COUNTRY_CODES[rawCountryPrefix] || '';
        let local = digits;
        if (phone.trim().startsWith('+') && prefix && digits.startsWith(prefix)) {
            local = digits.substring(prefix.length);
        }
        // Quitar 0 inicial
        if (local.startsWith('0')) local = local.substring(1);

        switch(rawCountryPrefix) {
           case "Chile":
              // Celulares chilenos: 9XXXXXXXX (9 dígitos empezando con 9)
              return local.length === 9 && local.startsWith('9');
           case "Argentina":
              // Celulares arg: 9 + código área + número = 10 dígitos después del 9
              // O con 15: código área + 15 + número
              if (local.startsWith('9') && local.length >= 10 && local.length <= 11) return true;
              if (local.includes('15') && local.length >= 10) return true;
              // Número local de 10 dígitos que no empieza con dígitos de fijo comunes
              if (local.length === 10 && !local.startsWith('0800') && !local.startsWith('0810')) return true;
              return false;
           case "Colombia":
              // Celulares: 3XXXXXXXXX (10 dígitos empezando con 3)
              return local.length === 10 && local.startsWith('3');
           case "Uruguay":
              // Celulares: 9XXXXXXX (8 dígitos empezando con 9)
              return local.length === 8 && local.startsWith('9');
           case "España":
              // Celulares: 6XX o 7XX (9 dígitos)
              return local.length === 9 && (local.startsWith('6') || local.startsWith('7'));
           case "México":
              // Celulares: 10 dígitos, los fijos también son 10 pero empiezan con ciertos prefijos de ciudad
              // En México la distinción es difícil, pero los que empiezan con código de ciudad + 55 suelen ser fijos en CDMX
              return local.length === 10;
           case "Perú":
              // Celulares: 9XXXXXXXX (9 dígitos empezando con 9)
              return local.length === 9 && local.startsWith('9');
           case "Ecuador":
              // Celulares: 9XXXXXXXX (9 dígitos empezando con 9)
              return local.length === 9 && local.startsWith('9');
           case "Paraguay":
              // Celulares: 9XX (empieza con 9, 10 dígitos con código)
              return local.startsWith('9') && local.length >= 8 && local.length <= 10;
           case "Bolivia":
              // Celulares: 6XXXXXXX o 7XXXXXXX (8 dígitos)
              return local.length === 8 && (local.startsWith('6') || local.startsWith('7'));
           case "Venezuela":
              // Celulares: 4XX (empieza con 4)
              return local.startsWith('4') && local.length === 10;
           case "Costa Rica":
              // Celulares: 8 dígitos empezando con 5, 6, 7 u 8
              return local.length === 8 && ['5','6','7','8'].includes(local[0]);
           case "Panamá":
              // Celulares: 6XXXXXXX (8 dígitos empezando con 6)
              return local.length === 8 && local.startsWith('6');
           case "República Dominicana":
           case "Estados Unidos":
              // NANP: 10 dígitos, no hay distinción fijo/cel confiable
              return local.length === 10;
           case "Brasil":
              // Celulares: 9XXXXXXXX (9 dígitos empezando con 9, después del DDD)
              // Con DDD: 11 dígitos
              if (local.length === 11 && local[2] === '9') return true;
              if (local.length === 9 && local.startsWith('9')) return true;
              return false;
           default:
              return local.length >= 9;
        }
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = queryInput.value.trim();
      const location = locationInput.value.trim();
      const maxPages = maxPagesInput.value;
      const startPage = startPageInput ? startPageInput.value : 1;
  
      if (!query) return;

      const locationCount = location ? location.split(';').filter(l => l.trim()).length : 1;
  
      document.querySelector('#search-btn-top .btn-text').classList.add('hidden');
      loader.classList.remove('hidden');
      searchBtn.disabled = true;
      downloadBtn.disabled = true;
      enrichBtn.disabled = true;
      enrichBtn.textContent = 'Escanear con IA';
      enrichProgress.classList.add('hidden');
      filterInfo.textContent = '';
      const queryLines = query.split('\n').filter(q => q.trim());
      const keywordLabel = queryLines.length > 1 ? `${queryLines.length} keywords` : `"${query}"`;
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Buscando ${keywordLabel} en ${locationCount} ubicación(es) (Pág ${startPage})...</td></tr>`;
      
      try {
        const response = await fetch(apiUrl('/api/scrape'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, location, maxPages, startPage })
        });
  
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Error al obtener datos');
        }

        // Guardar el batchId para poder marcarlo como sentToSetter cuando
        // se haga "Enviar a Setters". Asi el panel Historial deja de
        // decir "NO ENVIADO" cuando en realidad se envio.
        window._lastScrapeBatchId = data.batchId || null;

        currentData = (data.results || []).map(item => ({
          ...item,
          website: normalizeUrl(item.website),
          instagram: '',
          linkedin: '',
          facebook: '',
          email: '',
          owner: '',
          aiRole: '',
          webWhatsApp: '',
          aiWhatsApp: ''
        }));
        
        renderTable(currentData);
        
        let spans = [];
        if (data.newCount !== undefined) {
          spans.push(`<span class="text-success">${data.newCount} nuevos</span>`);
        }
        if (data.dedupRemoved > 0) {
          spans.push(`<span style="color:var(--warning);">${data.dedupRemoved} duplicados removidos</span>`);
        }
        if (data.removedNoContact > 0) {
          spans.push(`<span>${data.removedNoContact} sin contacto</span>`);
        }
        if (data.hasMoreResults) {
          spans.push(`<span class="text-primary">MÁS leads disp. (Sube la página)</span>`);
        }
        filterInfo.innerHTML = spans.join('<span style="color:var(--border-color); margin: 0 8px;">|</span>');

        if (currentData.length > 0) {
          downloadBtn.disabled = false;
          enrichBtn.disabled = false;
          document.getElementById('send-to-setters').disabled = false;
        }

        loadHistoryStats();
  
      } catch (error) {
        console.error(error);
        // Escapar el mensaje porque algunas APIs (SerpAPI con 5xx) devuelven HTML
        // crudo en error.message — sin escape se inyecta como markup y rompe la UI.
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.style.cssText = 'text-align:center;color:var(--danger);padding:2rem;';
        td.textContent = 'Error: ' + (error.message || 'Desconocido');
        tr.appendChild(td);
        tbody.innerHTML = '';
        tbody.appendChild(tr);
      } finally {
        document.querySelector('#search-btn-top .btn-text').classList.remove('hidden');
        loader.classList.add('hidden');
        searchBtn.disabled = false;
      }
    });

    const delay = ms => new Promise(res => setTimeout(res, ms));

    enrichBtn.addEventListener('click', async () => {
      if (currentData.length === 0) return;

      enrichBtn.disabled = true;
      enrichProgress.classList.remove('hidden');

      let processed = 0;
      let phonesFound = 0;
      const BATCH_SIZE = 2; // Procesar 2 en paralelo (balanceado para no gatillar rate limit)

      // Función para enriquecer un item individual
      const enrichItem = async (idx) => {
        const item = currentData[idx];

        // Skip si ya fue enriquecido (tiene datos de IA/redes)
        if (item._enriched) return;

        // Detectar si el "website" es realmente un link de WSP (wa.me, wa.link, etc).
        // En ese caso saltamos el enrich pesado y solo generamos openMessage del
        // banco — no tiene sentido ir a la pagina de WhatsApp y sacar basura.
        // Tambien si no hay website, igual pedimos enrich para que el server
        // devuelva openMessage del banco usando country/city.
        try {
          const resp = await fetch(apiUrl('/api/enrich'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: item.website || '', currentPhone: item.phone, country: item.country || '', city: item.city || '', location: item.locationSearched || '' })
          });
          const social = await resp.json();

          currentData[idx].instagram = social.instagram ? normalizeUrl(social.instagram) : '';
          currentData[idx].linkedin = social.linkedin ? normalizeUrl(social.linkedin) : '';
          currentData[idx].facebook = social.facebook ? normalizeUrl(social.facebook) : '';
          currentData[idx].email = social.email || '';
          currentData[idx].owner = social.owner || '';
          currentData[idx].aiRole = social.aiRole || '';
          currentData[idx].webWhatsApp = social.webWhatsApp || '';
          currentData[idx].aiWhatsApp = social.aiWhatsApp || '';
          currentData[idx].openMessage = social.openMessage || '';

          currentData[idx].ownerInstagram = social.ownerInstagram || '';
          currentData[idx].ownerLinkedin = social.ownerLinkedin || '';
          currentData[idx].ownerFacebook = social.ownerFacebook || '';

          let newFoundPhone = social.phone || social.webWhatsApp || social.aiWhatsApp;
          if (!currentData[idx].phone && newFoundPhone) {
             currentData[idx].phone = newFoundPhone;
             phonesFound++;
          }

          currentData[idx]._enriched = true;
        } catch {}
      };

      // Procesar en lotes paralelos
      for (let batchStart = 0; batchStart < currentData.length; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, currentData.length);
        const batchIndices = [];
        for (let i = batchStart; i < batchEnd; i++) batchIndices.push(i);

        progressText.textContent = `IA procesando lote ${Math.floor(batchStart / BATCH_SIZE) + 1}... (${Math.min(batchEnd, currentData.length)}/${currentData.length})`;
        progressFill.style.width = `${(batchEnd / currentData.length) * 100}%`;

        // Lanzar el lote en paralelo
        await Promise.all(batchIndices.map(idx => enrichItem(idx)));
        processed = batchEnd;

        // Pausa entre lotes para no gatillar rate limit de OpenRouter
        if (batchEnd < currentData.length) {
          await delay(800);
        }

        renderTable(currentData);
      }

      // Contar los que no tienen ningún teléfono (sin mutar currentData)
      const withoutPhone = currentData.filter(item => !item.phone && !item.webWhatsApp && !item.aiWhatsApp).length;

      renderTable(currentData);
      progressFill.style.width = '100%';
      progressText.textContent = `✅ Análisis completado. Tel. rescatados: ${phonesFound}. Sin contacto: ${withoutPhone}`;
      enrichBtn.textContent = '✅ Finalizado';
    });
  
    const ICEBREAKERS = [
      "Buenas tardes, ¿cómo están?", "Buen día, ¿cómo viene la semana?", "Hola, ¿cómo vienen hoy?",
      "Buenas, espero que estén bien.", "Hola, buen día, ¿cómo arrancaron?", "Buenas, ¿cómo les está yendo?",
      "Hola, ¿cómo va todo por ahí?", "Buen día, ¿qué tal la jornada?", "Buenas, ¿cómo viene el mes?",
      "Hola, espero que tengan un lindo día.", "Buenas tardes, ¿cómo marcha todo?", "Buen día, ¿cómo los trata la semana?",
      "Hola, ¿cómo viene el trabajo hoy?", "Buenas, ¿todo bien por ahí?", "Hola, buen día, ¿cómo están llevando la agenda?"
    ];

    downloadBtn.addEventListener('click', () => {
      if (currentData.length === 0) return;
  
      const headers = ['Nombre de la clínica', 'País', 'Ciudad', 'WhatsApp (con mensaje)', 'Doctor', 'Instagram (Clínica)', 'Facebook (Clínica)', 'Página web'];

      const csvRows = [headers.join(',')];
      const cleanStr = (str) => `"${(str || '').toString().replace(/[\n\r]+/g, ' ').replace(/"/g, '""')}"`;

      let exportData = hideDuplicatesCb.checked ? currentData.filter(d => !d.alreadyScraped) : currentData;
      if (hideLandlinesCb && hideLandlinesCb.checked) {
          exportData = exportData.filter(d => (d.phone && isMobilePhone(d.phone, countrySelect.value)) || d.webWhatsApp || d.aiWhatsApp);
      } else {
          exportData = exportData.filter(d => (d.phone && d.phone.trim() !== '') || d.webWhatsApp || d.aiWhatsApp);
      }

      if (exportData.length === 0) return;

      exportData.forEach(row => {
        let doctorInfo = row.aiRole && row.aiRole !== "N/A - Sin identificar" && !row.aiRole.includes("Qwen") && !row.aiRole.includes("N/A") && !row.aiRole.includes("sin contenido") && !row.aiRole.includes("pausada") ? row.aiRole : row.owner;
        // Limpiar doctor basura
        if (doctorInfo && (doctorInfo.includes('N/A') || doctorInfo.includes('Sin identificar') || doctorInfo.includes('soportada') || doctorInfo.includes('Requiere'))) doctorInfo = '';

        let fraseAleatoria = row.openMessage || ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];

        // WhatsApp link con mensaje incluido
        let bestWa = '';
        const mapsPhone = row.phone ? buildWaStr(row.phone, countrySelect.value) : '';
        const webWa = row.webWhatsApp || row.aiWhatsApp;
        const webWaLink = webWa ? buildWaStr(webWa, countrySelect.value) : '';

        if (mapsPhone && mapsPhone.startsWith('http') && isMobilePhone(row.phone, countrySelect.value)) {
          bestWa = mapsPhone;
        } else if (webWaLink && webWaLink.startsWith('http')) {
          bestWa = webWaLink;
        } else if (mapsPhone && mapsPhone.startsWith('http')) {
          bestWa = mapsPhone;
        }

        // Agregar el mensaje de apertura al link de WhatsApp
        if (bestWa) {
          bestWa = bestWa + '?text=' + encodeURIComponent(fraseAleatoria);
        }

        const rowData = [
          cleanStr(row.name),
          cleanStr(row.country || ''),
          cleanStr(row.city || ''),
          cleanStr(bestWa),
          cleanStr(doctorInfo),
          cleanStr(row.instagram),
          cleanStr(row.facebook),
          cleanStr(row.website)
        ];
        csvRows.push(rowData.join(','));
      });
  
      const csvString = csvRows.join('\n');
      const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
      const blob = new Blob([bom, csvString], { type: 'text/csv;charset=utf-8;' });
      
      const fileCount = exportData.length;
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GoogleMaps_Export_${fileCount}leads.csv`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    const exportSettersCsvBtn = document.getElementById('export-setters-csv');
    if (exportSettersCsvBtn) {
      exportSettersCsvBtn.addEventListener('click', async () => {
        const setter = setterSelect.value;
        const url = apiUrl('/api/setters/export' + (setter ? '?setter=' + encodeURIComponent(setter) : ''));
        const resp = await fetch(url);
        const csv = await resp.text();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `setters_export_${Date.now()}.csv`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      });
    }
  
    function renderTable(data) {
      let filteredData = hideDuplicatesCb.checked ? data.filter(d => !d.alreadyScraped) : data;
      if (hideLandlinesCb && hideLandlinesCb.checked) {
          filteredData = filteredData.filter(d => (d.phone && isMobilePhone(d.phone, countrySelect.value)) || d.webWhatsApp || d.aiWhatsApp);
      }
      
      const newOnly = data.filter(d => !d.alreadyScraped);
      const skippedByFilter = newOnly.length - filteredData.filter(d => !d.alreadyScraped).length;
      resultsCount.textContent = filteredData.length;
      if (skippedByFilter > 0 && hideLandlinesCb && hideLandlinesCb.checked) {
        resultsCount.textContent = `${filteredData.length} (${skippedByFilter} sin Wsp omitidos)`;
      }

      if (filteredData.length === 0) {
        if (data.length > 0) {
           tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-state-content"><p>Todos los resultados (<strong>'+ data.length +'</strong>) ya están en tu base de datos.<br>Desactiva "Solo nuevos" para exhibirlos.</p></div></td></tr>';
        } else {
           tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="empty-state-content"><p>No se extrajeron prospectos viables para la consulta.</p></div></td></tr>';
        }
        return;
      }

      tbody.innerHTML = filteredData.map(item => {
        const opacityStyle = item.alreadyScraped ? 'style="opacity: 0.5;"' : '';
        const badge = item.alreadyScraped ? '<span title="Ya en DB" style="color:var(--text-secondary); margin-right:6px">●</span>' : '<span title="Lead Fresco" style="color:var(--success-color); margin-right:6px">●</span>';

        let ownerLine = '<span class="text-muted">Desconocido</span>';
        if (item.aiRole && item.aiRole !== "Requiere clave de Qwen en .env" && item.aiRole !== "N/A - Sin identificar") {
          ownerLine = `<span class="truncate-text" title="${escHtml(item.aiRole)}" style="color:var(--primary-color)">${escHtml(item.aiRole)}</span>`;
          if (item.ownerInstagram || item.ownerLinkedin || item.ownerFacebook) {
             ownerLine += `<div style="display:flex; gap:6px; margin-top:4px;">`;
             if (item.ownerInstagram) ownerLine += `<a href="${escHtml(item.ownerInstagram)}" target="_blank" class="icon-link" title="Instagram del Dueño" style="color:var(--accent); font-size:12px">IG</a>`;
             if (item.ownerLinkedin) ownerLine += `<a href="${escHtml(item.ownerLinkedin)}" target="_blank" class="icon-link" title="LinkedIn del Dueño" style="color:var(--accent); font-size:12px">IN</a>`;
             if (item.ownerFacebook) ownerLine += `<a href="${escHtml(item.ownerFacebook)}" target="_blank" class="icon-link" title="Facebook del Dueño" style="color:var(--info); font-size:12px">FB</a>`;
             ownerLine += `</div>`;
          }
        } else if (item.owner) {
          ownerLine = `<span class="truncate-text" title="${escHtml(item.owner)}" style="color:var(--accent-hover)">${escHtml(item.owner)}</span>`;
        } else if (item.aiRole === "N/A - Sin identificar") {
          ownerLine = `<span class="text-muted truncate-text">IA no encontró directivo</span>`;
        }

        const waLinkStr = buildWaStr(item.phone, countrySelect.value);
        let phoneHtml = `<div class="text-muted" style="font-size:11px">Maps: -</div>`;
        if (item.phone) {
             if (waLinkStr.startsWith('http')) {
                phoneHtml = `<div style="font-size:13px" title="Teléfono de Google Maps">📍 <a href="${escHtml(waLinkStr)}" target="_blank" class="text-link" style="color:var(--text-secondary)">${escHtml(item.phone)}</a></div>`;
             } else {
                phoneHtml = `<div style="font-size:13px" title="Fijo/Desconocido de Google Maps">📍 <span class="text-secondary">${escHtml(item.phone)}</span></div>`;
             }
        }

        let webWaHtml = "";
        let bestWebWa = item.webWhatsApp || item.aiWhatsApp;
        if (bestWebWa) {
            const webWaLink = buildWaStr(bestWebWa, countrySelect.value);
            webWaHtml = `<div style="font-size:13px; margin-top:4px" title="WhatsApp verificado en la web">🌐 <a href="${escHtml(webWaLink)}" target="_blank" class="text-link" style="color: var(--success); font-weight:600;">+WA Web</a></div>`;
        }

        return `
        <tr ${opacityStyle}>
          <td>
            <div style="font-weight: 500; display:flex; align-items:flex-start;">
              ${badge}
              <span class="truncate-text" title="${escHtml(item.name)}">${escHtml(item.name) || '-'}</span>
            </div>
            <div class="text-muted truncate-text" style="font-size:12px; margin-top:2px;" title="${escHtml(item.type)}">${escHtml(item.type) || '-'}</div>
          </td>
          <td>
            <div class="truncate-text" title="${escHtml(item.locationSearched)}">${escHtml(item.locationSearched) || '-'}</div>
            <div class="text-muted truncate-text" style="font-size:12px; margin-top:2px;" title="${escHtml(item.address)}">${escHtml(item.address) || '-'}</div>
          </td>
          <td>
            <div>⭐ ${escHtml(item.rating) || '-'}</div>
            <div class="text-muted" style="font-size:12px; margin-top:2px;">${escHtml(item.reviews) || '0'} revs</div>
          </td>
          <td>
            ${ownerLine}
          </td>
          <td>
            ${phoneHtml}
            ${webWaHtml}
          </td>
          <td>
            <div style="display:flex; gap:8px;">
              ${item.unclaimed === "Sí (Oportunidad)" ? '<span title="Oportunidad: Perfil de negocio no reclamado!" style="color:var(--warning); cursor:help;">⚠️</span>' : ''}
              ${item.instagram ? `<a href="${escHtml(item.instagram)}" target="_blank" class="icon-link" title="Instagram">IG</a>` : ''}
              ${item.facebook ? `<a href="${escHtml(item.facebook)}" target="_blank" class="icon-link" title="Facebook">FB</a>` : ''}
              ${item.linkedin ? `<a href="${escHtml(item.linkedin)}" target="_blank" class="icon-link" title="LinkedIn">IN</a>` : ''}
              ${item.website ? `<a href="${escHtml(item.website)}" target="_blank" class="icon-link" title="Sitio Web">🌐</a>` : ''}
              ${item.email ? `<a href="mailto:${escHtml(item.email)}" class="icon-link" title="Email" style="color:var(--accent-hover)">✉</a>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');
    }

    // --- LÓGICA DE NAVEGACIÓN MODULAR (TABS) ---
    const menuItems = document.querySelectorAll('.sidebar-menu .menu-item[data-target]');
    const moduleViews = document.querySelectorAll('.module-view');

    menuItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const targetId = item.getAttribute('data-target');
        if(!targetId) return;
        
        e.preventDefault();
        
        // Quitar active a todos los menus y modulos
        menuItems.forEach(m => m.classList.remove('active'));
        moduleViews.forEach(v => {
          v.classList.remove('active');
          v.classList.add('hidden');
        });

        // Dar active al presionado y mostrar vista
        item.classList.add('active');
        const targetView = document.getElementById(targetId);
        if(targetView) {
          targetView.classList.remove('hidden');
          targetView.classList.add('active');
        }
      });
    });

    // --- LÓGICA DE APIFY (INSTAGRAM) ---
    const apifyRunBtn = document.getElementById('apify-run-btn');
    const apifyQueryInput = document.getElementById('apify-query');
    const apifyMaxItemsInput = document.getElementById('apify-max-items');
    const apifyResultsBody = document.getElementById('apify-results-body');
    const apifyProgress = document.getElementById('apify-progress');

    if (apifyRunBtn) {
      apifyRunBtn.addEventListener('click', async () => {
        let query = apifyQueryInput.value.trim();
        const maxItems = apifyMaxItemsInput.value;

        if (!query) {
          alert('Por favor, ingresa un hashtag o palabra clave.');
          return;
        }

        // Si hay ciudades seleccionadas, las inyectamos en la búsqueda para localizar resultados
        if (selectedCities.length > 0 && !query.startsWith('http') && !query.startsWith('#')) {
            const locationStr = selectedCities.join(' ');
            query = `${query} ${locationStr}`;
        }

        // Estado cargando
        apifyRunBtn.disabled = true;
        apifyRunBtn.textContent = '⏳ Procesando...';
        apifyProgress.classList.remove('hidden');
        apifyResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">Buscando en Instagram vía Apify...</td></tr>';

        try {
          const resp = await fetch(apiUrl('/api/apify-scrape'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, maxItems })
          });

          const data = await resp.json();

          if (data.error) {
            const errorMsg = typeof data.error === 'object' ? JSON.stringify(data.error) : data.error;
            throw new Error(errorMsg);
          }

          if (data.results) {
              renderApifyResults(data.results);
          } else {
              apifyResultsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No se encontraron resultados.</td></tr>';
          }
        } catch (error) {
          console.error('Apify Frontend Error:', error);
          const displayMsg = error.message.includes('{') ? error.message : `Error al conectar con Apify: ${error.message}`;
          apifyResultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger); padding:40px;">${escHtml(displayMsg)}</td></tr>`;
        } finally {
          apifyRunBtn.disabled = false;
          apifyRunBtn.textContent = 'Ejecutar Extractor Instagram';
          apifyProgress.classList.add('hidden');
        }
      });
    }

    function renderApifyResults(results) {
      if (!results || results.length === 0) {
        apifyResultsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No se encontraron resultados.</td></tr>';
        return;
      }

      apifyResultsBody.innerHTML = results.map(item => `
        <tr>
          <td>
            <strong>@${escHtml(item.username)}</strong><br>
            <a href="${escHtml(item.url)}" target="_blank" class="text-link" style="font-size:11px;">${escHtml(item.url)}</a>
          </td>
          <td>${escHtml(item.fullName) || '-'}</td>
          <td style="font-size:12px; max-width:250px; white-space: normal;">${escHtml(item.bio) || '-'}</td>
          <td>
            ${item.phone ? `
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="color:var(--success)">📱 ${escHtml(item.phone)}</span>
                <a href="https://wa.me/${escHtml(String(item.phone).replace(/\D/g,''))}" target="_blank" title="Abrir WhatsApp" style="text-decoration:none;">💬</a>
              </div>
            ` : '<span style="color:var(--text-secondary)">No detectado</span>'}
          </td>
          <td>${item.followers ? item.followers.toLocaleString() : '0'}</td>
        </tr>
      `).join('');
    }

    // ══════════════════════════════════════════════════════════════
    // MÓDULO SETTERS v2
    // ══════════════════════════════════════════════════════════════
    const setterSelect = document.getElementById('setter-select');
    const variableSelect = document.getElementById('variable-select');
    const sessionBtn = document.getElementById('session-btn');
    const sessionBanner = document.getElementById('session-banner');
    const sessionSetterName = document.getElementById('session-setter-name');
    const sessionTimerEl = document.getElementById('session-timer');
    const endSessionBtn = document.getElementById('end-session-btn');
    const setterLeadsBody = document.getElementById('setter-leads-body');
    const leadModal = document.getElementById('lead-modal');
    const sendToSettersBtn = document.getElementById('send-to-setters');
    const variantsModal = document.getElementById('variants-modal');
    const inlineVarName = document.getElementById('inline-var-name');
    const inlineVarWeek = document.getElementById('inline-var-week');
    const inlineVarSetter = document.getElementById('inline-var-setter');
    const inlineVarBlocks = document.getElementById('inline-var-blocks');
    const inlineAddBlockBtn = document.getElementById('inline-add-block-btn');
    const inlineSaveVariableBtn = document.getElementById('inline-save-variable-btn');
    const cmdVariableSetterFilter = document.getElementById('cmd-variable-setter-filter');
    const cmdVariableSearch = document.getElementById('cmd-variable-search');

    if (currentUser?.role === 'setter') {
      setterSelect.value = currentUser.setterId || '';
      setterSelect.disabled = true;
      setterSelect.style.display = 'none';
    }

    let activeSession = null;
    let sessionTimerInterval = null;
    let setterLeads = [];
    // Cache de los "mis números" del setter actual (lista propia que él
    // mantiene). Setters ven solo los suyos. Admin: vacío hasta que
    // seleccione un setter específico (en este caso no aplica el dropdown).
    let _myPhones = [];
    async function _loadMyPhones() {
      const setterId = currentUser?.setterId;
      if (!setterId) { _myPhones = []; return; }
      try {
        const r = await fetch(apiUrl('/api/setters/team/' + encodeURIComponent(setterId) + '/phones'));
        if (!r.ok) return;
        const d = await r.json();
        _myPhones = d.phones || [];
      } catch (e) { console.warn('[my-phones] load:', e.message); }
    }
    let settersList = [];
    let variantsList = [];
    let currentPipeFilter = 'all';

    // ── Phase 6: Telnyx Calls module ──────────────────────────────────
    // Manejo de llamadas WebRTC desde el browser. API key del lado server,
    // browser solo recibe ephemeral creds. Lazy init: client se crea solo
    // cuando el setter inicia la primera llamada.
    const _telnyx = {
      configured: false,
      client: null,                  // instancia TelnyxRTC
      activeCall: null,              // call object actual
      credentials: null,             // {sipUsername, sipPassword, expiresAt}
      numbers: [],                   // [{id, phone, label, country}]
      countryRouting: { default: '' },

      // Mapeo prefijo telefónico → ISO country code. Heurística simple,
      // suficiente para los países donde operamos.
      _prefixToCountry(phone) {
        const digits = String(phone || '').replace(/\D/g, '');
        if (!digits) return null;
        // Códigos de 3 dígitos primero (más específicos)
        const three = digits.substring(0, 3);
        const two = digits.substring(0, 2);
        const one = digits.substring(0, 1);
        const map = {
          '593': 'EC', '598': 'UY', '591': 'BO', '595': 'PY', '506': 'CR',
          '507': 'PA', '503': 'SV', '504': 'HN', '502': 'GT', '505': 'NI',
          '809': 'DO', '829': 'DO', '849': 'DO',
        };
        if (map[three]) return map[three];
        const twoMap = {
          '34': 'ES', '52': 'MX', '54': 'AR', '55': 'BR', '56': 'CL',
          '57': 'CO', '58': 'VE', '51': 'PE',
        };
        if (twoMap[two]) return twoMap[two];
        if (one === '1') return 'US';
        return null;
      },

      // Decide qué número saliente usar para llamar a destinationPhone.
      // Retorna el objeto number completo o null si no hay match.
      pickNumberForDestination(destinationPhone) {
        const country = this._prefixToCountry(destinationPhone);
        const routing = this.countryRouting || {};
        // 1) Match exacto por país
        if (country && routing[country]) {
          const n = this.numbers.find(x => x.id === routing[country]);
          if (n) return n;
        }
        // 2) Default
        if (routing.default) {
          const n = this.numbers.find(x => x.id === routing.default);
          if (n) return n;
        }
        // 3) Cualquier número activo si no hay routing configurado
        return this.numbers[0] || null;
      },

      async fetchConfig() {
        try {
          const r = await fetch(apiUrl('/api/telnyx/config'), { credentials: 'include' });
          if (!r.ok) { this.configured = false; this.numbers = []; return; }
          const d = await r.json();
          // El setter recibe shape distinto al admin; ambos tienen 'configured' o lo inferimos
          this.configured = d.configured !== undefined ? d.configured : d.hasApiKey;
          this.numbers = d.numbers || [];
          this.countryRouting = d.countryRouting || { default: '' };
        } catch (e) {
          console.warn('[telnyx] fetchConfig:', e.message);
          this.configured = false;
        }
      },

      async fetchCredentials() {
        try {
          const r = await fetch(apiUrl('/api/telnyx/webrtc-credentials'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (!r.ok) {
            const errData = await r.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${r.status}`);
          }
          const d = await r.json();
          this.credentials = {
            sipUsername: d.sipUsername,
            sipPassword: d.sipPassword,
            token: d.token,
            expiresAt: d.expiresIn ? Date.now() + (d.expiresIn * 1000) : 0,
            mode: d.mode,
          };
          return this.credentials;
        } catch (e) {
          console.warn('[telnyx] fetchCredentials failed:', e.message);
          throw e;
        }
      },

      // Lazy init del cliente TelnyxRTC. Re-conecta si las creds expiraron.
      async ensureClient() {
        if (typeof window.TelnyxRTC === 'undefined' && typeof window.TelnyxWebRTC === 'undefined') {
          throw new Error('TelnyxRTC SDK no está cargado en el browser');
        }
        const TelnyxClass = window.TelnyxRTC || window.TelnyxWebRTC?.TelnyxRTC;
        if (!TelnyxClass) throw new Error('TelnyxRTC class no encontrada en el SDK cargado');

        // Si el cliente existe y las creds no expiraron, reusar
        const credsValid = this.credentials && (this.credentials.expiresAt === 0 || this.credentials.expiresAt > Date.now() + 30000);
        if (this.client && credsValid) return this.client;

        // Si hay cliente viejo, desconectar primero
        if (this.client) {
          try { this.client.disconnect(); } catch {}
          this.client = null;
        }

        await this.fetchCredentials();
        if (!this.credentials?.sipUsername) throw new Error('Sin credenciales SIP de Telnyx');

        this.client = new TelnyxClass({
          login: this.credentials.sipUsername,
          password: this.credentials.sipPassword,
          ringtoneFile: null,
          // CRÍTICO: remoteElement le dice al SDK dónde montar el audio del lead.
          // Sin esto, el remote stream del peer connection no se reproduce y vos
          // no escuchás al otro lado (aunque él te escucha a vos).
          remoteElement: 'telnyx-remote-audio',
        });

        // Connect (returns promise resolvable cuando registra)
        await new Promise((resolve, reject) => {
          const onReady = () => { resolve(); cleanup(); };
          const onError = (err) => { reject(err); cleanup(); };
          const cleanup = () => {
            this.client.off?.('telnyx.ready', onReady);
            this.client.off?.('telnyx.error', onError);
          };
          this.client.on?.('telnyx.ready', onReady);
          this.client.on?.('telnyx.error', onError);
          this.client.connect();
          // Timeout 15s
          setTimeout(() => reject(new Error('Timeout conectando con Telnyx (15s)')), 15000);
        });

        // Notification pattern de Telnyx WebRTC v2: TODOS los state changes
        // del call vienen por 'telnyx.notification' con type='callUpdate'.
        // Estados REALES verificados contra source del SDK (BaseCall.setState
        // del bundle.js): new, requesting, trying, recovering, ringing,
        // answering, early, active, held, hangup, destroy, purge.
        // Los terminales son: hangup, destroy, purge (en ese orden de transición
        // típica: BYE recibido → peer.close() → estado limpio).
        // NO existen 'done'/'ended' como Call states (fueron false positives
        // de grep en el bundle minified — son otros enums internos).
        this.client.on?.('telnyx.notification', (notification) => {
          if (!notification || notification.type !== 'callUpdate' || !notification.call) return;
          const call = notification.call;
          const state = call.state;
          if (state === 'ringing' || state === 'early' || state === 'recovering') {
            _setTelnyxCallStatus('Sonando…', 'ringing');
          } else if (state === 'active') {
            // ¡Atendió! Detener ringback fake y mostrar estado activo.
            _stopRingbackTone();
            _setTelnyxCallStatus('En llamada', 'active');
            // Attach manual del remoteStream — el SDK lo hace internamente pero
            // hay race conditions.
            let attachRetries = 0;
            const tryAttachRemoteStream = () => {
              const audioEl = document.getElementById('telnyx-remote-audio');
              const stream = call.remoteStream || _telnyx.activeCall?.remoteStream;
              if (audioEl && stream && stream.getAudioTracks?.().length > 0) {
                if (audioEl.srcObject !== stream) audioEl.srcObject = stream;
                audioEl.volume = 1.0;
                audioEl.muted = false;
                audioEl.play?.().catch(err => {
                  console.warn('[telnyx] remote audio play() rejected:', err?.message);
                });
                // Iniciar grabacion para Whisper transcript (Sprint 7)
                // local stream para setter, remote stream para lead. Audio in-memory,
                // se descarta tras transcribir.
                if (!_setterRecorder && _telnyxCallState.localStreamForRec) {
                  _startCallRecording(_telnyxCallState.localStreamForRec, stream);
                }
                return;
              }
              if (++attachRetries < 16) setTimeout(tryAttachRemoteStream, 250);
              else console.warn('[telnyx] remote audio NOT attached after 4s');
            };
            tryAttachRemoteStream();
          } else if (state === 'held') {
            _setTelnyxCallStatus('En espera', 'ending');
          } else if (state === 'hangup' || state === 'destroy' || state === 'purge') {
            // Estados terminales REALES verificados contra el source del SDK
            // (BaseCall.setState con enum State.[Hangup|Destroy|Purge] lowercased).
            // 'done' / 'ended' NO existen como call states — fueron asunción mía
            // mirando grep del bundle minified (eran otros estados, no de Call).
            _stopRingbackTone();
            if (this.activeCall && _telnyxCallState.startedAt) {
              const sameCall = this.activeCall === call || this.activeCall.id === call.id;
              if (sameCall) _onTelnyxCallEnded(state);
            }
          }
        });

        return this.client;
      },

      // Limpia el cliente (útil al logout o cerrar pestaña)
      disconnect() {
        if (this.activeCall) {
          try { this.activeCall.hangup(); } catch {}
          this.activeCall = null;
        }
        if (this.client) {
          try { this.client.disconnect(); } catch {}
          this.client = null;
        }
        this.credentials = null;
      },
    };
    window._telnyx = _telnyx; // expone para debug en consola
    // Cache de follow-ups del setter actual (refresca al entrar al CRM y cada
    // vez que se tilda un follow-up). Estructura igual a /api/setters/followups/today
    let _followupsCache = null;
    // Mapa rápido leadId → { step, label, status, note } para mostrar el chip
    // en cada lead row cuando se está en filtros 'hacer_hoy' o 'atrasados'.
    let _followupByLead = new Map();

    async function loadFollowups() {
      try {
        // En modo "Ver como setter" (admin impersonando), el backend ve admin via
        // cookie y NO filtra. Hay que pasar setterId explícito.
        const u = window.__CURRENT_USER__;
        const isViewAsSetter = u?.realRole === 'admin' && u?.role === 'setter' && u?.setterId;
        const qs = isViewAsSetter ? '?setter=' + encodeURIComponent(u.setterId) : '';
        const r = await fetch(apiUrl('/api/setters/followups/today' + qs));
        if (!r.ok) return;
        const d = await r.json();
        _followupsCache = d;
        if (window._setFollowupsCacheGlobal) window._setFollowupsCacheGlobal(d);
        _followupByLead = new Map();
        // Tomar el follow-up más urgente por lead (los más antiguos primero)
        const allItems = [
          ...(d.overdue || []).map(f => ({ ...f, statusBucket: 'overdue' })),
          ...(d.dueYesterday || []).map(f => ({ ...f, statusBucket: 'dueYesterday' })),
          ...(d.dueToday || []).map(f => ({ ...f, statusBucket: 'dueToday' })),
        ];
        for (const f of allItems) {
          if (!_followupByLead.has(f.leadId)) _followupByLead.set(f.leadId, f);
        }
        // Update badges de filtros
        const today = (d.counts?.dueToday || 0) + (d.counts?.dueYesterday || 0);
        const overdue = d.counts?.overdue || 0;
        const setBadge = (id, count, btnSelector) => {
          const el = document.getElementById(id);
          const btn = document.querySelector(btnSelector);
          if (el) {
            if (count > 0) { el.textContent = count; el.style.display = 'inline-flex'; }
            else el.style.display = 'none';
          }
          if (btn) btn.classList.toggle('has-items', count > 0);
        };
        setBadge('filter-badge-hacer-hoy', today, '.pipe-filter-urgent');
        setBadge('filter-badge-atrasados', overdue, '.pipe-filter-overdue');
        // Sidebar badge
        if (window._setSidebarFollowupsBadge) window._setSidebarFollowupsBadge(today);
      } catch (e) { console.warn('[followups] load:', e.message); }
    }

    // Helper para que el chip se renderice en lead rows cuando aplica.
    window._followupChipFor = (leadId) => _followupByLead.get(leadId) || null;

    // Renderiza la sección de follow-ups dentro del modal del lead.
    // Muestra los 5 steps (24h/48h/72h/7d/15d) con: estado, fecha, nota,
    // botones marcar hecho / reprogramar.
    // Render simplificado: solo info del follow-up activo (si lo hay).
    // Los checkboxes 24h/48h/72h/7d/15d en la TABLA del CRM son los que el setter
    // tilda. Tildar = "voy a hacer follow-up en X desde este momento". Solo uno
    // activo a la vez. El backend destila los otros automáticamente.
    function _renderModalFollowups(lead) {
      const info = document.getElementById('modal-followups-info');
      if (!info) return;
      const STEPS = {
        '24hs': { label: '24 horas', deltaMs: 24 * 3600 * 1000 },
        '48hs': { label: '48 horas', deltaMs: 48 * 3600 * 1000 },
        '72hs': { label: '72 horas', deltaMs: 72 * 3600 * 1000 },
        '7d':   { label: '7 días',   deltaMs: 7 * 24 * 3600 * 1000 },
        '15d':  { label: '15 días',  deltaMs: 15 * 24 * 3600 * 1000 },
      };
      const fu = lead.followUps || {};
      const activeKey = Object.keys(STEPS).find(k => fu[k] === true);
      if (!activeKey) {
        info.style.display = 'none';
        return;
      }
      const startedAt = lead.followUpStartedAt ? new Date(lead.followUpStartedAt).getTime() : (lead.lastContactAt ? new Date(lead.lastContactAt).getTime() : 0);
      if (!startedAt) {
        info.style.display = 'none';
        return;
      }
      const dueTs = startedAt + STEPS[activeKey].deltaMs;
      const now = Date.now();
      const d = new Date(dueTs);
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = today.getTime() + 24 * 3600 * 1000;
      const yesterday = today.getTime() - 24 * 3600 * 1000;
      const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
      let when;
      if (dayStart.getTime() === today.getTime()) when = 'Hoy ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      else if (dayStart.getTime() === yesterday) when = 'Ayer ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      else if (dayStart.getTime() === tomorrow) when = 'Mañana ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      else when = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      let statusLabel, statusColor;
      if (dueTs > now + 12 * 3600 * 1000) { statusLabel = 'Programado'; statusColor = 'var(--accent)'; }
      else if (dueTs >= now - 12 * 3600 * 1000) { statusLabel = 'Vence ahora'; statusColor = '#5bb974'; }
      else if (dueTs >= now - 36 * 3600 * 1000) { statusLabel = 'Vencido ayer'; statusColor = '#ff8a3d'; }
      else { statusLabel = 'Atrasado'; statusColor = '#f85149'; }

      info.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <span style="font-size:14px;">📅</span>
          <div style="flex:1; min-width:200px;">
            <strong style="color:var(--text-primary);">Follow-up ${STEPS[activeKey].label}</strong>
            <span style="color:${statusColor}; font-weight:600; margin-left:6px; font-size:12px;">· ${statusLabel}</span>
            <div class="muted" style="font-size:11px; margin-top:2px;">Vence: ${when} · Tildado: ${new Date(startedAt).toLocaleString()}</div>
          </div>
          <span class="muted" style="font-size:11px;">Cambialo desde los checkboxes de la tabla.</span>
        </div>
      `;
      info.style.display = 'block';
    }


    let currentModalLeadId = null;
    let currentVariableId = '';
    let editingVariantId = '';
    let draftBlocks = [];
    let inlineEditingVariantId = '';
    let inlineDraftBlocks = [];
    let commandVariableSetterFilterValue = '';
    let commandVariableSearchValue = '';
    let setterPage = 1;
    const SETTER_PAGE_SIZE = 50;

    // Detect if the "Pegar como humano" Chrome extension is installed.
    // The extension injects data-scm-paste-installed="1" on <html> when
    // present. If absent, the human-copy buttons fall back to a plain copy
    // (no marker) so the setter doesn't accidentally paste raw "__SCM_TYPE__:"
    // text into a real WhatsApp conversation.
    const isHumanPasteExtensionInstalled = () => {
      return document.documentElement.getAttribute('data-scm-paste-installed') === '1';
    };

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-block-btn');
      if (!btn) return;
      // The button can either be a normal copy (data-copy-target) or a
      // human-paste copy that prepends the SCM marker (data-copy-human-target).
      // Buttons rendered from app.js use data-copy-text / data-copy-human-text
      // and have their own listeners attached separately — skip those here.
      const targetId = btn.getAttribute('data-copy-target') || btn.getAttribute('data-copy-human-target');
      if (!targetId) return;
      const asHuman = btn.hasAttribute('data-copy-human-target');
      const target = document.getElementById(targetId);
      const text = target ? target.textContent.trim() : '';
      if (!text || text === '—') return;
      try {
        const extensionPresent = asHuman ? isHumanPasteExtensionInstalled() : true;
        // If the user wants human typing but the extension is missing, copy
        // plain text (safe fallback) and warn — never copy the raw marker.
        const finalText = (asHuman && extensionPresent) ? ('__SCM_TYPE__:' + text) : text;
        await copyToClipboard(finalText);
        const prev = btn.textContent;
        if (asHuman && !extensionPresent) {
          btn.textContent = '⚠ Sin extensión — copié normal';
        } else if (asHuman) {
          btn.textContent = '✓ Ctrl+V en WA';
        } else {
          btn.textContent = 'Copiado';
        }
        setTimeout(() => { btn.textContent = prev; }, asHuman ? 2400 : 1200);
      } catch (err) {
        console.error(err);
      }
    });

    async function loadSetterModule() {
      try {
        const setter = setterSelect.value;
        const statsUrl = setter ? apiUrl('/api/setters/stats?setter=' + encodeURIComponent(setter)) : apiUrl('/api/setters/stats');
        const leadsUrl = apiUrl('/api/setters/leads' + (setter ? '?setter=' + encodeURIComponent(setter) : ''));
        const [statsResp, leadsResp] = await Promise.all([fetch(statsUrl), fetch(leadsUrl)]);
        const stats = await statsResp.json();
        const leadsData = await leadsResp.json();
        setterLeads = leadsData.leads || [];
        settersList = stats.setters || [];
        variantsList = stats.variants || [];
        // Exponer al window para el command palette (Ctrl+K) y otras features
        // que necesiten acceso al cache desde scope externo.
        window.__setterLeads = setterLeads;
        window.__settersList = settersList;
        // Cargar "mis números" del setter (para el selector en el modal de lead)
        _loadMyPhones();
        // Phase 6: cargar config Telnyx para saber si el botón "Llamar" se habilita
        _telnyx.fetchConfig().catch(() => {});
        // Cargar follow-ups del setter (se usa para chips, badges y filtros)
        loadFollowups();

        // Repopular filtro de país con los leads cargados
        if (typeof window._populateSetterCountryFilter === 'function') {
          window._populateSetterCountryFilter();
        }

        // Poblar selector de setters (preservar selección).
        // 2026-05-24: filtrar setters con flag `hidden:true` — ej Paula que es
        // supervisora no debe aparecer como setter seleccionable, aunque tenga
        // leads asignados a su setterId (eso lo maneja su propio login).
        const currentVal = setterSelect.value;
        setterSelect.innerHTML = '<option value="">Todos los setters</option>';
        settersList.filter(s => !s.hidden).forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          setterSelect.appendChild(opt);
        });
        if (currentVal) setterSelect.value = currentVal;

        const visibleVariants = getVisibleVariables();
        if (variableSelect) {
          const prevVar = currentVariableId;
          variableSelect.innerHTML = '<option value="">Todas las variables</option>';
          visibleVariants.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.name + (v.weekLabel ? ' — ' + v.weekLabel : '');
            variableSelect.appendChild(opt);
          });
          if (prevVar && visibleVariants.some(v => v.id === prevVar)) {
            variableSelect.value = prevVar;
          } else if (visibleVariants.length > 0) {
            variableSelect.value = visibleVariants[0].id;
            currentVariableId = visibleVariants[0].id;
          } else {
            currentVariableId = '';
          }
        }

        // KPIs: número + porcentaje
        document.getElementById('stat-total').textContent = stats.total || 0;
        document.getElementById('stat-conexiones').textContent = stats.conexiones || 0;
        document.getElementById('stat-pct-conexion').textContent = (stats.pctConexion || '0.0') + '%';
        document.getElementById('stat-apertura').textContent = stats.respondieron || 0;
        document.getElementById('stat-pct-apertura').textContent = (stats.pctApertura || '0.0') + '%';
        document.getElementById('stat-calificacion').textContent = stats.calificados || 0;
        document.getElementById('stat-pct-calificacion').textContent = (stats.pctCalificacion || '0.0') + '%';
        document.getElementById('stat-interesado').textContent = stats.interesados || 0;
        document.getElementById('stat-agendado').textContent = stats.agendados || 0;

        // Variante activa del setter seleccionado
        const activeVariantBox = document.getElementById('active-variant-box');
        const activeVar = getVariantById(variableSelect?.value || currentVariableId);
        if (activeVar) {
          activeVariantBox.classList.remove('hidden');
          document.getElementById('variant-active-name').textContent = activeVar.name + (activeVar.weekLabel ? ' — ' + activeVar.weekLabel : '');
          const blocks = Array.isArray(activeVar.blocks) ? activeVar.blocks : [];
          document.getElementById('vmsg-apertura').textContent = blocks[0]?.text || '—';
          document.getElementById('vmsg-problema').textContent = blocks[1]?.text || '—';
          document.getElementById('vmsg-prueba').textContent = blocks[2]?.text || '—';
          document.getElementById('vmsg-cierre').textContent = blocks[3]?.text || '—';
        } else {
          activeVariantBox.classList.add('hidden');
        }

        sessionBtn.disabled = false;
        renderSetterLeads();
        _showResumeLastLead();
      } catch (e) { console.error('Error cargando módulo setters:', e); }
    }

    // Audit Sprint 37: helper namespaced para "último lead trabajado". Migra
    // claves viejas `lastLeadWorked_<uid>` → `scm_lastLeadWorked_<uid>`.
    const _scmLastLeadKey = () => 'scm_lastLeadWorked_' + (currentUser?.id || 'guest');
    const _scmLegacyLeadKey = () => 'lastLeadWorked_' + (currentUser?.id || 'guest');
    function _migrateLastLeadKey() {
      const k = _scmLastLeadKey(), lk = _scmLegacyLeadKey();
      const legacy = localStorage.getItem(lk);
      if (legacy !== null && localStorage.getItem(k) === null) {
        try { localStorage.setItem(k, legacy); } catch {}
        try { localStorage.removeItem(lk); } catch {}
      }
    }
    function _showResumeLastLead() {
      try {
        _migrateLastLeadKey();
        const raw = localStorage.getItem(_scmLastLeadKey());
        if (!raw) return;
        const info = JSON.parse(raw);
        const exists = setterLeads.find(l => l.id === info.id);
        const banner = document.getElementById('resume-last-lead');
        if (!banner || !exists) return;
        const mins = Math.round((Date.now() - (info.at || 0)) / 60000);
        const ago = mins < 1 ? 'hace segundos' : mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins/60)}h`;
        document.getElementById('resume-last-name').textContent = info.name || exists.name || '—';
        document.getElementById('resume-last-ago').textContent = '(' + ago + ')';
        banner.style.display = 'flex';
        document.getElementById('resume-last-btn').onclick = () => {
          // No abrimos la tarjeta del último lead — saltamos a "Sin contactar" para
          // seguir avanzando con los próximos que faltan mandar.
          currentPipeFilter = 'sin_contactar';
          setterPage = 1;
          document.querySelectorAll('.pipe-filter').forEach(b => {
            b.classList.toggle('active', b.dataset.status === 'sin_contactar');
          });
          renderSetterLeads();
          // Scroll a la tabla del pipeline
          const tableEl = document.querySelector('#view-crm .leads-table-container, #view-crm .leads-table, #view-crm table');
          if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        document.getElementById('resume-last-dismiss').onclick = () => {
          banner.style.display = 'none';
          localStorage.removeItem(_scmLastLeadKey());
        };
      } catch {}
    }

    // Calcula y muestra el contador de cada filtro en su chip. Sirve para que
    // el setter sepa cuántos hay ANTES de hacer click — antes pasaba que
    // hacían click en "Sin contactar" y veían vacío sin entender por qué.
    function _updatePipeFilterCounts() {
      // Counts acumulativos en línea con los filtros: un lead que avanzó por
      // el funnel sigue contado en los pasos previos. Ej: un lead "interesado"
      // suma en interesado + calificado + respondio + enviada (todo lo que
      // logró pasar). Refleja el funnel real, no excluye etapas alcanzadas.
      const counts = {
        all: setterLeads.length,
        sin_contactar: setterLeads.filter(l => !l.conexion).length,
        en_proceso: setterLeads.filter(l => l.conexion && l.conexion !== 'sin_wsp' && l.estado !== 'agendado' && l.estado !== 'descartado').length,
        enviada: setterLeads.filter(l => l.conexion === 'enviada').length,
        respondio: setterLeads.filter(l => l.respondio === true).length,
        calificado: setterLeads.filter(l => l.calificado === true).length,
        interesado: setterLeads.filter(l => l.interes === 'si').length,
        agendado: setterLeads.filter(l => l.estado === 'agendado').length,
        sin_wsp: setterLeads.filter(l => l.conexion === 'sin_wsp').length,
        descartado: setterLeads.filter(l => l.estado === 'descartado').length,
      };
      document.querySelectorAll('.pipe-filter[data-status]').forEach(btn => {
        const k = btn.dataset.status;
        // Skip los chips dinámicos (hacer_hoy / atrasados ya tienen su badge propio)
        if (k === 'hacer_hoy' || k === 'atrasados') return;
        if (!(k in counts)) return;
        let countEl = btn.querySelector('.pipe-filter-count');
        if (!countEl) {
          countEl = document.createElement('span');
          countEl.className = 'pipe-filter-count';
          countEl.style.cssText = 'margin-left:6px; padding:1px 7px; border-radius:999px; background:rgba(255,255,255,0.08); font-size:10px; font-weight:600; opacity:0.75;';
          btn.appendChild(countEl);
        }
        countEl.textContent = counts[k];
        // Visual cue: si el filtro tiene 0, atenuar el chip (no cliquear esperando algo)
        btn.style.opacity = counts[k] === 0 ? '0.45' : '';
      });

    }

    // ═══════════════════════════════════════════════════════════
    // PHASE setter-ux-redesign — Modo tabla simple (7 cols)
    // ═══════════════════════════════════════════════════════════
    // ROLLBACK 2026-05-23: el modo simple ocultaba doctor + variantes + notas
    // inline + chips fu visibles → setters perdian su workflow. Volvemos a
    // 'complete' como default UNIVERSAL. El toggle simple queda como opt-in
    // experimental — nadie arranca ahi.
    const _tableModeKey = 'scm_setter_table_mode_' + (currentUser?.id || 'anon');
    // Reset one-time del localStorage para usuarios que ya tenían 'simple'
    // guardado del deploy anterior. Si la flag de reset no está marcada,
    // limpiamos la preferencia y la marcamos como reseteada.
    try {
      if (!localStorage.getItem('scm_table_mode_reset_v2')) {
        localStorage.removeItem(_tableModeKey);
        localStorage.setItem('scm_table_mode_reset_v2', '1');
      }
    } catch (e) {}
    let _tableMode = (function determineInitialMode() {
      const saved = localStorage.getItem(_tableModeKey);
      // Respetar preferencia explicita (si alguien clickeo el toggle simple a
      // proposito DESPUES del reset); pero si nunca tocó nada → siempre complete.
      if (saved === 'simple') return 'simple';
      return 'complete';
    })();

    // Headers para los 2 modos
    const _theadSimple = `
      <tr>
        <th style="width:3%; text-align:center;">#</th>
        <th style="width:22%;">Lead / Ciudad</th>
        <th style="width:12%;">Teléfono</th>
        <th style="width:11%;">Estado</th>
        <th style="width:9%;">Última acción</th>
        <th style="width:14%;">Próximo paso</th>
        <th style="width:16%; text-align:center;" title="Seguimientos programados: tildá para activar el follow-up en esa franja">📅 Seguimientos</th>
        <th style="width:13%; text-align:center;">Acciones</th>
      </tr>`;
    const _theadComplete = `
      <tr>
        <th style="width:3%">#</th>
        <th style="width:5%">Fecha</th>
        <th style="width:14%">Nombre</th>
        <th style="width:9%">Teléfono</th>
        <th style="width:4%">Web</th>
        <th style="width:7%">Conexión</th>
        <th style="width:5%">Resp?</th>
        <th style="width:5%">Calif?</th>
        <th style="width:5%">Int?</th>
        <th style="width:4%">Var</th>
        <th style="width:14%">Notas</th>
        <th style="width:7%">Doctor</th>
        <th style="width:3%">IG</th>
        <th style="width:3%">24h</th>
        <th style="width:3%">48h</th>
        <th style="width:3%">72h</th>
        <th style="width:3%">7d</th>
        <th style="width:3%">15d</th>
        <th style="width:4%">Est</th>
      </tr>`;

    function _applyTableMode() {
      const table = document.getElementById('setter-table');
      const thead = table?.querySelector('thead');
      if (!table || !thead) return;
      table.setAttribute('data-mode', _tableMode);
      thead.innerHTML = _tableMode === 'simple' ? _theadSimple : _theadComplete;
      const toggleBtn = document.getElementById('setter-table-mode-toggle');
      if (toggleBtn) {
        toggleBtn.textContent = _tableMode === 'simple' ? '🔧 Ver tabla completa' : '◀ Vista simple';
      }
    }
    window._toggleTableMode = function toggleTableMode() {
      _tableMode = _tableMode === 'simple' ? 'complete' : 'simple';
      localStorage.setItem(_tableModeKey, _tableMode);
      _applyTableMode();
      renderSetterLeads();
    };
    document.getElementById('setter-table-mode-toggle')?.addEventListener('click', window._toggleTableMode);
    // Aplicar mode inicial al cargar
    _applyTableMode();

    // Helper: formato "hace X" para fechas relativas (Última acción)
    function _formatAgo(iso) {
      if (!iso) return '—';
      const diff = Date.now() - new Date(iso).getTime();
      if (diff < 0 || isNaN(diff)) return '—';
      const min = Math.floor(diff / 60000);
      if (min < 1) return 'ahora';
      if (min < 60) return `hace ${min}m`;
      const h = Math.floor(min / 60);
      if (h < 24) return `hace ${h}h`;
      const d = Math.floor(h / 24);
      if (d < 7) return `hace ${d}d`;
      if (d < 30) return `hace ${Math.floor(d / 7)}sem`;
      return `hace ${Math.floor(d / 30)}m`;
    }

    // Helper: derivar chip de estado semántico (modo simple)
    function _semanticStatusChip(lead) {
      const map = {
        agendado: ['📅', 'Agendado', 'rgba(91,185,116,0.18)', '#5bb974'],
        cerrado: ['✅', 'Cerrado', 'rgba(91,185,116,0.15)', '#5bb974'],
        descartado: ['🚫', 'Descartado', 'rgba(248,81,73,0.15)', '#f85149'],
        sin_wsp: ['📞', 'Sin WSP', 'rgba(255,200,40,0.12)', '#ffc828'],
      };
      if (lead.estado && map[lead.estado]) {
        const [icon, label, bg, col] = map[lead.estado];
        return `<span class="chip-semantic" style="background:${bg}; color:${col}; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600;">${icon} ${label}</span>`;
      }
      if (lead.interes === 'si') return `<span class="chip-semantic" style="background:rgba(248,81,73,0.15); color:#f85149; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600;">🔥 Interesado</span>`;
      if (lead.calificado === true) return `<span class="chip-semantic" style="background:rgba(157,133,242,0.18); color:#9d85f2; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600;">✓ Calificado</span>`;
      if (lead.respondio === true) return `<span class="chip-semantic" style="background:rgba(255,165,80,0.15); color:#ffa550; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600;">💬 Respondió</span>`;
      if (lead.conexion === 'enviada') return `<span class="chip-semantic" style="background:rgba(121,184,255,0.15); color:#79b8ff; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600;">📤 Enviado</span>`;
      return `<span class="chip-semantic" style="background:rgba(126,132,148,0.12); color:#9CA3AF; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:600;">📋 Sin contactar</span>`;
    }

    // Helper: inferir "próximo paso" sugerido al setter
    function _nextStepFor(lead) {
      if (lead.estado === 'agendado') return ['Esperar reunión', '#5bb974'];
      if (lead.estado === 'cerrado' || lead.estado === 'descartado') return ['Listo', '#7E8494'];
      if (lead.interes === 'si') return ['📅 Agendar reunión', '#f85149'];
      if (lead.calificado === true && lead.interes !== 'no') return ['Marcar interés', '#9d85f2'];
      if (lead.respondio === true) return ['Calificar', '#ffa550'];
      if (lead.conexion === 'enviada') {
        const lc = lead.lastContactAt ? new Date(lead.lastContactAt).getTime() : 0;
        if (lc && (Date.now() - lc) > 24 * 3600 * 1000) return ['Hacer follow-up', '#ffc828'];
        return ['Esperar respuesta', '#7E8494'];
      }
      return ['Mandar saludo', '#79b8ff'];
    }

    // Render en modo simple (8 columnas, mas aireado, focus en accion + seguimientos)
    function _renderRowSimple(lead) {
      const phone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '';
      const lastAgo = _formatAgo(lead.lastContactAt);
      const statusChip = _semanticStatusChip(lead);
      const [nextStep, nextColor] = _nextStepFor(lead);
      const waUrl = phone ? buildSetterWaUrl(lead, 'apertura') : '';
      const city = lead.city || lead.country || '';
      const cityHtml = city ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:3px;">${escHtml(city)}</div>` : '';
      const phoneHtml = phone
        ? `<a href="${escHtml(waUrl)}" target="_blank" class="text-link" style="color:var(--success); white-space:nowrap;" onclick="return window._waBtnClick(this, event, '${escHtml(lead.id)}');">${escHtml(phone)}</a>`
        : '<span class="text-muted">—</span>';
      // Seguimientos: 5 checkboxes compactos para 24h/48h/72h/7d/15d
      // Mismo flow que la tabla completa (window._toggleFU). Si esta tildado,
      // chip violeta visible; si no, checkbox tachado pequenio.
      const fu = lead.followUps || {};
      const fuSteps = [
        { k: '24hs', label: '24h' },
        { k: '48hs', label: '48h' },
        { k: '72hs', label: '72h' },
        { k: '7d',   label: '7d'  },
        { k: '15d',  label: '15d' },
      ];
      const fuHtml = fuSteps.map(s => {
        const active = !!fu[s.k];
        const bg = active ? 'background:rgba(157,133,242,0.18); color:#9d85f2; border:1px solid rgba(157,133,242,0.40);' : 'background:transparent; color:var(--text-tertiary); border:1px solid var(--border-color);';
        return `<label style="display:inline-flex; align-items:center; justify-content:center; min-width:34px; padding:4px 6px; margin:0 2px; border-radius:6px; cursor:pointer; font-size:10px; font-weight:600; ${bg} transition:all 0.15s;" title="Follow-up programado a ${s.label}">
          <input type="checkbox" class="fu-cb" data-id="${escHtml(lead.id)}" data-step="${s.k}" ${active ? 'checked' : ''} onclick="event.stopPropagation(); window._toggleFU(this);" style="display:none;">
          ${s.label}
        </label>`;
      }).join('');
      return '<tr data-lead-id="' + escHtml(lead.id) + '" onclick="window._openLeadModal(\'' + escHtml(lead.id) + '\')" style="cursor:pointer;">' +
        '<td style="text-align:center; color:var(--text-secondary); font-weight:500;">' + (lead.num || '') + '</td>' +
        '<td><div style="font-weight:600; color:var(--text-primary);">' + escHtml(lead.name || '—') + '</div>' + cityHtml + '</td>' +
        '<td onclick="event.stopPropagation()">' + phoneHtml + '</td>' +
        '<td>' + statusChip + '</td>' +
        '<td style="font-size:12px; color:var(--text-secondary);">' + lastAgo + '</td>' +
        '<td><span style="font-size:12px; color:' + nextColor + '; font-weight:500;">' + nextStep + '</span></td>' +
        '<td style="text-align:center; white-space:nowrap;" onclick="event.stopPropagation()">' + fuHtml + '</td>' +
        '<td style="text-align:center; white-space:nowrap;" onclick="event.stopPropagation()">' +
          (phone ? '<a href="' + escHtml(waUrl) + '" target="_blank" title="Abrir WhatsApp (WAMULTI si sos Ignacio)" style="text-decoration:none; padding:6px 10px; border-radius:6px; background:rgba(91,185,116,0.10); color:#5bb974; margin:0 2px; display:inline-block;" onclick="return window._waBtnClick(this, event, \'' + escHtml(lead.id) + '\');">💬</a>' : '') +
          '<a href="#" title="Abrir info del lead" onclick="event.preventDefault(); window._openLeadModal(\'' + escHtml(lead.id) + '\');" style="text-decoration:none; padding:6px 10px; border-radius:6px; background:rgba(157,133,242,0.10); color:#9d85f2; margin:0 2px; display:inline-block;">📋</a>' +
          '<a href="#" title="Programar seguimiento custom" onclick="event.preventDefault(); window._openLeadModal(\'' + escHtml(lead.id) + '\'); setTimeout(()=>window._switchLeadTab(\'programar\'), 100);" style="text-decoration:none; padding:6px 10px; border-radius:6px; background:rgba(121,184,255,0.10); color:#79b8ff; margin:0 2px; display:inline-block;">📅</a>' +
        '</td>' +
      '</tr>';
    }

    function renderSetterLeads() {
      _updatePipeFilterCounts();
      let filtered = [...setterLeads];
      if (currentPipeFilter === 'hacer_hoy') {
        // dueToday + dueYesterday: el setter tiene que hacerlos.
        const ids = new Set([
          ...(_followupsCache?.dueToday || []).map(f => f.leadId),
          ...(_followupsCache?.dueYesterday || []).map(f => f.leadId),
        ]);
        filtered = filtered.filter(l => ids.has(l.id));
      } else if (currentPipeFilter === 'atrasados') {
        const ids = new Set((_followupsCache?.overdue || []).map(f => f.leadId));
        filtered = filtered.filter(l => ids.has(l.id));
      } else if (currentPipeFilter === 'enviada') {
        // 2026-05-04: filtros acumulativos. Antes excluía a los que respondieron
        // → daba la sensación de que "WSP Enviado" perdía leads cuando avanzaban.
        // Ahora muestra TODOS los que recibieron mensaje (los respondió incluidos).
        filtered = filtered.filter(l => l.conexion === 'enviada');
      } else if (currentPipeFilter === 'sin_wsp') {
        filtered = filtered.filter(l => l.conexion === 'sin_wsp');
      } else if (currentPipeFilter === 'respondio') {
        // Acumulativo: todos los que respondieron (incluye calificados/interesados/agendados)
        filtered = filtered.filter(l => l.respondio === true);
      } else if (currentPipeFilter === 'calificado') {
        // Acumulativo: todos los calificados (incluye interesados/agendados)
        filtered = filtered.filter(l => l.calificado === true);
      } else if (currentPipeFilter === 'interesado') {
        filtered = filtered.filter(l => l.interes === 'si');
      } else if (currentPipeFilter === 'sin_contactar') {
        filtered = filtered.filter(l => !l.conexion);
      } else if (currentPipeFilter === 'en_proceso') {
        // En proceso = tiene algún avance pero no llegó a agendado ni está descartado/sin_wsp
        filtered = filtered.filter(l => {
          if (!l.conexion || l.conexion === 'sin_wsp') return false;
          if (l.estado === 'agendado' || l.estado === 'descartado') return false;
          return true;
        });
      } else if (currentPipeFilter !== 'all') {
        filtered = filtered.filter(l => l.estado === currentPipeFilter);
      }

      // Filtro por país (preferencia local del setter)
      const countryFilter = (document.getElementById('setter-country-filter')?.value || '').trim();
      if (countryFilter) {
        filtered = filtered.filter(l => (l.country || '').trim() === countryFilter);
      }

      // Filtro por fecha — pedido de Genaro: "no se puede buscar por fecha?"
      // Permite ver los leads que tocaste hoy/ayer/ultima semana, util para
      // encontrar rapido los del dia. Usa lastContactAt si existe, sino importedAt.
      const dateFilter = (document.getElementById('setter-date-filter')?.value || '').trim();
      const specificDate = (document.getElementById('setter-date-specific')?.value || '').trim();
      const _ts = (l) => {
        const lc = l.lastContactAt ? new Date(l.lastContactAt).getTime() : 0;
        const imp = l.importedAt ? new Date(l.importedAt).getTime() : 0;
        return Math.max(lc, imp);
      };

      // Fecha específica tiene prioridad sobre los presets (más granular)
      if (specificDate) {
        // YYYY-MM-DD → rango de ese día completo en local time
        const [y, m, d] = specificDate.split('-').map(Number);
        const dayStart = new Date(y, m - 1, d).getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000;
        filtered = filtered.filter(l => { const t = _ts(l); return t >= dayStart && t < dayEnd; });
      } else if (dateFilter) {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfYesterday = startOfToday - 24*60*60*1000;
        if (dateFilter === 'today') {
          filtered = filtered.filter(l => _ts(l) >= startOfToday);
        } else if (dateFilter === 'yesterday') {
          filtered = filtered.filter(l => { const t = _ts(l); return t >= startOfYesterday && t < startOfToday; });
        } else if (dateFilter === '7d') {
          const cutoff = startOfToday - 6*24*60*60*1000;
          filtered = filtered.filter(l => _ts(l) >= cutoff);
        } else if (dateFilter === '30d') {
          const cutoff = startOfToday - 29*24*60*60*1000;
          filtered = filtered.filter(l => _ts(l) >= cutoff);
        } else if (dateFilter === 'no-contact') {
          filtered = filtered.filter(l => !l.lastContactAt);
        }
      }

      // Buscador general — tolerante a acentos, mayusculas, espacios y formato de telefono.
      // Antes era includes() puro: si la persona escribia '5422163791147' pero el lead
      // tenia '+54 221 637-9147', no matcheaba. Ahora:
      //   - Normaliza texto: lowercase + sin acentos
      //   - Tokeniza la query por espacios → cada token debe matchear (busqueda AND)
      //   - Para tokens que son digitos, compara contra version solo-digitos de los telefonos
      //   - Soporta busqueda con espacios libres ("dr lopez bogota")
      const rawSearchQ = (document.getElementById('setter-search')?.value || '').trim();
      if (rawSearchQ) {
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const digits = (s) => String(s || '').replace(/\D/g, '');
        const tokens = norm(rawSearchQ).split(/\s+/).filter(Boolean);
        filtered = filtered.filter(l => {
          // Haystack textual: todos los campos legibles concatenados, normalizados
          const textParts = [l.name, l.country, l.city, l.locationSearched, l.address, l.doctor, l.email, l.website, l.instagram, l.facebook, l.notes?.map?.(n=>n.text||n).join(' ')];
          const textHay = norm(textParts.filter(Boolean).join(' '));
          // Haystack solo-digitos: telefonos juntos (sin formato)
          const phoneHay = digits([l.phone, l.webWhatsApp, l.aiWhatsApp].filter(Boolean).join(''));
          return tokens.every(tok => {
            const tokDigits = digits(tok);
            // Si el token tiene >= 4 digitos, lo buscamos en phoneHay (o textHay con digits sueltos)
            if (tokDigits.length >= 4 && tokDigits.length === tok.replace(/[\s+()-]/g, '').length) {
              return phoneHay.includes(tokDigits) || textHay.includes(tok);
            }
            // Token textual normal
            return textHay.includes(tok);
          });
        });
      }

      // Orden 2026-06-04: "último trabajado primero". Los leads que tocaste
      // recién (lastContactAt más reciente) arriba → seguís tu hilo de trabajo.
      // Los nunca contactados (lastContactAt null) van al final, ordenados por
      // más nuevos scrapeados primero (importedAt DESC). Tiebreak estable por id.
      filtered.sort((a, b) => {
        const ta = a.lastContactAt ? new Date(a.lastContactAt).getTime() : 0;
        const tb = b.lastContactAt ? new Date(b.lastContactAt).getTime() : 0;
        if (tb !== ta) return tb - ta;
        const ia = a.importedAt ? new Date(a.importedAt).getTime() : 0;
        const ib = b.importedAt ? new Date(b.importedAt).getTime() : 0;
        if (ib !== ia) return ib - ia;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      if (filtered.length === 0) {
        const cols = _tableMode === 'simple' ? 8 : 19;
        setterLeadsBody.innerHTML = '<tr><td colspan="' + cols + '" class="empty-state"><div class="empty-state-content"><p>No hay leads en esta vista.</p></div></td></tr>';
        // Marcar tabla vacía para que CSS quite el min-width 1800 y no aparezca
        // doble scrollbar al pegarse con el floating scrollbar.
        document.getElementById('setter-table')?.setAttribute('data-empty', '1');
        // Limpiar paginación
        const pag = document.getElementById('setter-pagination');
        if (pag) pag.innerHTML = '';
        return;
      }
      // Tabla con datos: restaurar min-width
      document.getElementById('setter-table')?.removeAttribute('data-empty');

      // Paginación
      const totalPages = Math.ceil(filtered.length / SETTER_PAGE_SIZE);
      if (setterPage > totalPages) setterPage = totalPages;
      const start = (setterPage - 1) * SETTER_PAGE_SIZE;
      const pageLeads = filtered.slice(start, start + SETTER_PAGE_SIZE);

      // Renderizar paginación
      let pagEl = document.getElementById('setter-pagination');
      if (!pagEl) {
        pagEl = document.createElement('div');
        pagEl.id = 'setter-pagination';
        pagEl.style.cssText = 'display:flex;justify-content:center;align-items:center;gap:12px;padding:14px 0;font-size:13px;';
        setterLeadsBody.closest('table').after(pagEl);
      }
      const pagBtnStyle = 'padding:6px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:12px;font-weight:500;transition:all .2s;';
      const pagBtnDisabled = 'padding:6px 14px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:var(--text-secondary);cursor:default;font-size:12px;font-weight:500;opacity:0.4;';
      if (totalPages > 1) {
        pagEl.innerHTML =
          '<button style="' + (setterPage <= 1 ? pagBtnDisabled : pagBtnStyle) + '" ' + (setterPage <= 1 ? 'disabled' : '') + ' onclick="window._setterPageNav(-1)">&larr; Anterior</button>' +
          '<span style="color:var(--text-secondary);font-size:12px;background:var(--bg-secondary);padding:5px 12px;border-radius:6px;border:1px solid var(--border-color);">' + setterPage + ' / ' + totalPages + '</span>' +
          '<span style="color:var(--text-secondary);font-size:11px;">' + filtered.length + ' leads</span>' +
          '<button style="' + (setterPage >= totalPages ? pagBtnDisabled : pagBtnStyle) + '" ' + (setterPage >= totalPages ? 'disabled' : '') + ' onclick="window._setterPageNav(1)">Siguiente &rarr;</button>';
      } else {
        pagEl.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;">' + filtered.length + ' leads</span>';
      }

      // ── Rama: modo SIMPLE renderiza 7 columnas (default setter) ──
      if (_tableMode === 'simple') {
        setterLeadsBody.innerHTML = pageLeads.map(_renderRowSimple).join('');
        _syncFloatingScrollbar();
        if (typeof window.renderHoyWidget === 'function') {
          try { window.renderHoyWidget(); } catch (e) {}
        }
        return;
      }

      // ── Modo COMPLETE (19 columnas, vista admin/power-user) ──
      setterLeadsBody.innerHTML = pageLeads.map(lead => {
        const lastNote = lead.notes && lead.notes.length > 0 ? lead.notes[lead.notes.length - 1] : null;
        const phone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '';
        const visibleVariants = getVisibleVariables();
        const varName = getVariantById(lead.varianteId);
        const fu = lead.followUps || {};
        // Limpiar doctor: no mostrar N/A ni basura de IA
        let doctorClean = lead.doctor || '';
        if (doctorClean.includes('N/A') || doctorClean.includes('Sin identificar') || doctorClean.includes('no soportada') || doctorClean.includes('Requiere') || doctorClean.includes('pausada') || doctorClean.includes('sin contenido')) doctorClean = '';

        // Conexión: select inline
        const conSelect = '<select class="inline-select" data-id="' + lead.id + '" onchange="window._updateField(this, \'conexion\')" onclick="event.stopPropagation()">' +
          '<option value=""' + (!lead.conexion ? ' selected' : '') + '>—</option>' +
          '<option value="enviada"' + (lead.conexion === 'enviada' ? ' selected' : '') + '>Enviada</option>' +
          '<option value="sin_wsp"' + (lead.conexion === 'sin_wsp' ? ' selected' : '') + '>Sin WSP</option>' +
          '</select>';

        // Respondió: select inline
        const respSelect = '<select class="inline-select" data-id="' + lead.id + '" onchange="window._updateResp(this)" onclick="event.stopPropagation()">' +
          '<option value=""' + (lead.respondio !== true && lead.respondioNo !== true ? ' selected' : '') + '>—</option>' +
          '<option value="si"' + (lead.respondio === true ? ' selected' : '') + '>SI</option>' +
          '<option value="no"' + (lead.respondioNo === true ? ' selected' : '') + '>NO</option>' +
          '</select>';

        // Calificado: select inline (—=sin evaluar, SI=calificó, NO=no calificó)
        const calificadoVal = lead.calificado === true ? 'si' : (lead.calificado === 'no' ? 'no' : '');
        const calSelect = '<select class="inline-select" data-id="' + lead.id + '" onchange="window._updateCalif(this)" onclick="event.stopPropagation()">' +
          '<option value=""' + (calificadoVal === '' ? ' selected' : '') + '>—</option>' +
          '<option value="si"' + (calificadoVal === 'si' ? ' selected' : '') + '>SI</option>' +
          '<option value="no"' + (calificadoVal === 'no' ? ' selected' : '') + '>NO</option>' +
          '</select>';

        // Interés: select inline
        const intSelect = '<select class="inline-select" data-id="' + lead.id + '" onchange="window._updateField(this, \'interes\')" onclick="event.stopPropagation()">' +
          '<option value=""' + (!lead.interes ? ' selected' : '') + '>—</option>' +
          '<option value="si"' + (lead.interes === 'si' ? ' selected' : '') + '>SI</option>' +
          '<option value="no"' + (lead.interes === 'no' ? ' selected' : '') + '>NO</option>' +
          '</select>';

        // Mapeo estado → chip semántico del DS
        const estadoChipClass = {
          sin_contactar: '', contactado: 'chip-info', respondio: 'chip-info',
          calificado: 'chip-accent', interesado: 'chip-warning',
          agendado: 'chip-success', cerrado: 'chip-success', descartado: 'chip-danger'
        };
        const estadoLabel = {
          sin_contactar: '', contactado: 'Cont', respondio: 'Resp',
          calificado: 'Calif', interesado: 'Int', agendado: 'Agnd',
          cerrado: 'OK', descartado: 'X'
        };
        const estadoChip = lead.estado && estadoChipClass[lead.estado]
          ? '<span class="chip ' + estadoChipClass[lead.estado] + '">' + estadoLabel[lead.estado] + '</span>'
          : '';

        // Chip de follow-up: aparece en columna nombre cuando estamos en
        // filtros 'hacer_hoy' o 'atrasados' (o si el lead tiene un follow-up
        // urgente y queremos siempre mostrarlo). Por ahora: solo en esos filtros.
        const fuItem = (window._followupChipFor && window._followupChipFor(lead.id)) || null;
        let fuChipHtml = '';
        let fuNoteHtml = '';
        if (fuItem && (currentPipeFilter === 'hacer_hoy' || currentPipeFilter === 'atrasados')) {
          const cls = fuItem.statusBucket === 'dueToday' ? 'followup-chip-today'
            : fuItem.statusBucket === 'dueYesterday' ? 'followup-chip-yesterday'
            : 'followup-chip-overdue';
          fuChipHtml = '<span class="followup-chip ' + cls + '" title="Follow-up ' + escHtml(fuItem.label) + '">📅 ' + escHtml(fuItem.label) + '</span>';
          if (fuItem.note) {
            fuNoteHtml = '<div class="followup-row-note" title="' + escHtml(fuItem.note) + '">📝 ' + escHtml(fuItem.note) + '</div>';
          }
        }

        // Fecha: mostrar fecha de contacto si existe, sino fecha de import
        const displayDate = lead.fechaContacto || (lead.fecha || '').substring(5);

        // Chip pequeño con el número propio del setter usado (si está seteado)
        const myPh = lead.setterPhoneId ? (_myPhones || []).find(p => p.id === lead.setterPhoneId) : null;
        const myWaChip = myPh ? '<span class="chip" style="display:inline-flex; align-items:center; gap:3px; padding:1px 6px; font-size:9px; background:rgba(91,185,116,0.10); color:#5bb974; border:1px solid rgba(91,185,116,0.32); border-radius:6px; margin-left:4px; vertical-align:middle;" title="Contactado desde ' + escHtml(myPh.label || '') + (myPh.phone ? ' (' + escHtml(myPh.phone) + ')' : '') + '">📱 ' + escHtml((myPh.label || '').substring(0, 12)) + '</span>' : '';

        return '<tr data-lead-id="' + escHtml(lead.id) + '" onclick="window._openLeadModal(\'' + escHtml(lead.id) + '\')">' +
          '<td style="color:var(--text-secondary);">' + (lead.num || '') + '</td>' +
          '<td style="font-size:11px; color:var(--text-secondary);">' + escHtml(displayDate) + '</td>' +
          '<td style="font-weight:500;">' + (fuChipHtml ? fuChipHtml + ' ' : '') + escHtml(lead.name).substring(0, 28) + myWaChip + '<div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">' + escHtml((lead.country || '') + (lead.city ? ' / ' + lead.city : '')) + '</div>' + fuNoteHtml + '</td>' +
          '<td style="font-size:11px;">' + (phone ? '<a href="' + escHtml(buildSetterWaUrl(lead, "apertura")) + '" target="_blank" class="text-link" style="color:var(--success);" onclick="return window._waBtnClick(this, event, \'' + escHtml(lead.id) + '\');" title="Abrir WhatsApp (WAMULTI si sos Ignacio)">' + escHtml(phone).substring(0, 18) + '</a>' : '<span class="text-muted">—</span>') + '</td>' +
          '<td style="text-align:center;">' + (lead.website ? '<a href="' + escHtml(lead.website) + '" target="_blank" class="icon-link" onclick="event.stopPropagation()" title="Abrir sitio web"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></a>' : '') + '</td>' +
          '<td>' + conSelect + '</td>' +
          '<td style="text-align:center;">' + respSelect + '</td>' +
          '<td style="text-align:center;">' + calSelect + '</td>' +
          '<td style="text-align:center;">' + intSelect + '</td>' +
          '<td style="color:var(--warning); font-size:11px;">' +
            '<select class="inline-select" data-id="' + escHtml(lead.id) + '" onchange="window._updateVariant(this)" onclick="event.stopPropagation()">' +
            '<option value="">—</option>' +
            visibleVariants.map(v => '<option value="' + escHtml(v.id) + '"' + (lead.varianteId === v.id ? ' selected' : '') + '>' + escHtml(v.name) + '</option>').join('') +
            '</select>' +
            (varName ? '<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">' + escHtml(varName.name) + '</div>' : '') +
          '</td>' +
          '<td style="font-size:11px; color:var(--text-secondary); max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + (lastNote ? escHtml(lastNote.text) : '') + '">' + (lastNote ? (lead.notes.length > 1 ? '<span style="color:var(--warning);font-size:10px;" title="' + lead.notes.length + ' notas">(' + lead.notes.length + ') </span>' : '') + escHtml(lastNote.text) : '') + '</td>' +
          '<td style="font-size:11px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escHtml(doctorClean) + '">' + escHtml(doctorClean) + '</td>' +
          '<td style="text-align:center; white-space:nowrap;">' +
            (lead.instagram ? '<a href="' + escHtml(lead.instagram) + '" target="_blank" class="social-chip" onclick="event.stopPropagation()" title="Instagram">IG</a>' : '') +
            (lead.facebook ? '<a href="' + escHtml(lead.facebook) + '" target="_blank" class="social-chip" onclick="event.stopPropagation()" title="Facebook">FB</a>' : '') +
            (lead.linkedin ? '<a href="' + escHtml(lead.linkedin) + '" target="_blank" class="social-chip" onclick="event.stopPropagation()" title="LinkedIn">IN</a>' : '') +
          '</td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="24hs" ' + (fu['24hs'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="48hs" ' + (fu['48hs'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="72hs" ' + (fu['72hs'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="7d" ' + (fu['7d'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="15d" ' + (fu['15d'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;">' + estadoChip + '</td>' +
        '</tr>';
      }).join('');
      // Despues de renderizar, sincronizar el scrollbar flotante
      _syncFloatingScrollbar();
      // Refrescar widget "Hoy" — depende del estado actual de los leads
      if (typeof window.renderHoyWidget === 'function') {
        try { window.renderHoyWidget(); } catch (e) { /* no critico */ }
      }
    }

    // ── Twin scrollbar flotante (siempre visible al fondo del viewport) ──
    // Solucion al pedido del user: en notebooks chicas, el scrollbar horizontal
    // de la tabla CRM quedaba al fondo del array de leads y habia que scrollear
    // toda la pagina para usarlo. Este scrollbar flotante esta sticky en el
    // fondo del viewport, sincronizado con la tabla en ambos sentidos.
    function _ensureFloatingScrollbar() {
      let bar = document.getElementById('crm-floating-scrollbar');
      if (bar) return bar;
      bar = document.createElement('div');
      bar.id = 'crm-floating-scrollbar';
      const inner = document.createElement('div');
      bar.appendChild(inner);
      document.body.appendChild(bar);
      return bar;
    }
    let _floatingScrollSyncing = false;
    function _syncFloatingScrollbar() {
      const view = document.getElementById('view-crm');
      const bar = _ensureFloatingScrollbar();
      const inner = bar.firstElementChild;
      const tableContainer = view ? view.querySelector('.table-container') : null;
      // Mostrar solo si la vista CRM esta activa Y el container tiene overflow horizontal
      const viewActive = view && !view.classList.contains('hidden');
      if (!viewActive || !tableContainer) {
        bar.style.display = 'none';
        return;
      }
      // Usamos tableContainer.scrollWidth (no table.scrollWidth) — incluye el
      // padding interno y refleja exactamente cuanto se puede scrollear.
      const scrollWidth = tableContainer.scrollWidth;
      const visibleWidth = tableContainer.clientWidth;
      const needsScroll = scrollWidth > visibleWidth + 4;
      if (!needsScroll) { bar.style.display = 'none'; return; }
      // Posicionar la barra alineada con el container
      const rect = tableContainer.getBoundingClientRect();
      bar.style.display = 'block';
      bar.style.left = rect.left + 'px';
      bar.style.width = rect.width + 'px';
      inner.style.width = scrollWidth + 'px';
      // Reflejar scroll position actual
      bar.scrollLeft = tableContainer.scrollLeft;
      // Wire bidireccional una sola vez
      if (!bar.dataset._wired) {
        bar.addEventListener('scroll', () => {
          if (_floatingScrollSyncing) return;
          _floatingScrollSyncing = true;
          tableContainer.scrollLeft = bar.scrollLeft;
          requestAnimationFrame(() => { _floatingScrollSyncing = false; });
        });
        tableContainer.addEventListener('scroll', () => {
          if (_floatingScrollSyncing) return;
          _floatingScrollSyncing = true;
          bar.scrollLeft = tableContainer.scrollLeft;
          requestAnimationFrame(() => { _floatingScrollSyncing = false; });
        });
        bar.dataset._wired = '1';
      }
    }
    // Re-sync en eventos de viewport
    window.addEventListener('resize', _syncFloatingScrollbar);
    // Cuando cambia de vista (clicks en sidebar), volver a evaluar
    document.addEventListener('click', (e) => {
      if (e.target.closest('.menu-item[data-target]')) {
        setTimeout(_syncFloatingScrollbar, 100);
      }
    });
    // Cuando el sidebar toggle abre/cierra, el tablecontainer cambia de ancho
    // y la barra flotante hay que recalcularla. MutationObserver para detectar
    // el toggle de la clase .collapsed en el sidebar.
    const _sidebarEl = document.querySelector('.sidebar');
    if (_sidebarEl && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        // Esperar al fin de la transicion CSS (~250ms tipicamente) antes de medir
        setTimeout(_syncFloatingScrollbar, 50);
        setTimeout(_syncFloatingScrollbar, 320);
      }).observe(_sidebarEl, { attributes: true, attributeFilter: ['class'] });
    }
    // ResizeObserver del container: si por cualquier razon (zoom, fontsize)
    // cambia el ancho, recalcular.
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => _syncFloatingScrollbar());
      // Observamos en el primer renderSetterLeads cuando el container existe
      const _observeOnce = () => {
        const c = document.querySelector('#view-crm .table-container');
        if (c && !c.dataset._roObserved) {
          ro.observe(c);
          c.dataset._roObserved = '1';
        } else if (!c) {
          setTimeout(_observeOnce, 200);
        }
      };
      _observeOnce();
    }

    // Helper: sync lead from server response and refresh UI
    function _syncLeadAndRefresh(id, serverLead, opts = {}) {
      const idx = setterLeads.findIndex(l => l.id === id);
      if (idx >= 0 && serverLead) {
        Object.assign(setterLeads[idx], serverLead);
        // Si es sin_wsp, sacarlo de la lista del setter (va a llamadas)
        if (serverLead.conexion === 'sin_wsp') {
          if (currentModalLeadId === id) {
            document.getElementById('lead-modal')?.classList.add('hidden');
            currentModalLeadId = null;
          }
          setterLeads.splice(idx, 1);
        }
      }
      // Robustez (2026-06-03): el PATCH YA se guardó OK antes de llamar acá.
      // Si el re-render visual falla, NO debe propagarse como "no se pudo
      // guardar" (eso confundía: el dato sí quedó). Envolvemos en try/catch.
      try {
        _updateStatsLocal();
        renderSetterLeads();
      } catch (renderErr) {
        console.error('[syncLeadAndRefresh] error al re-renderizar (el dato YA se guardó):', renderErr);
      }
      // Toast de confirmación: feedback visible cuando se guarda.
      if (opts.confirmMessage && window.showToast) {
        window.showToast(opts.confirmMessage, { type: 'success', duration: 2200 });
      }
    }

    // Calcular stats locales desde setterLeads
    function _updateStatsLocal() {
      const leads = setterLeads;
      const total = leads.length;
      const conexiones = leads.filter(l => l.conexion === 'enviada').length;
      const respondieron = leads.filter(l => l.respondio).length;
      const interesados = leads.filter(l => l.interes === 'si').length;
      const agendados = leads.filter(l => l.estado === 'agendado').length;
      const calificados = leads.filter(l => l.calificado === true).length;
      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-conexiones').textContent = conexiones;
      document.getElementById('stat-pct-conexion').textContent = (total > 0 ? ((conexiones / total) * 100).toFixed(1) : '0.0') + '%';
      document.getElementById('stat-apertura').textContent = respondieron;
      document.getElementById('stat-pct-apertura').textContent = (conexiones > 0 ? ((respondieron / conexiones) * 100).toFixed(1) : '0.0') + '%';
      document.getElementById('stat-calificacion').textContent = calificados;
      document.getElementById('stat-pct-calificacion').textContent = (calificados > 0 ? ((interesados / calificados) * 100).toFixed(1) : '0.0') + '%';
      document.getElementById('stat-interesado').textContent = interesados;
      document.getElementById('stat-agendado').textContent = agendados;
    }

    // Inline field update (conexion, interes)
    // Helper: hace PATCH a un lead, valida la respuesta y devuelve el lead o lanza error.
    // Antes los handlers ignoraban silently 401/403/500 — el setter veía "no queda"
    // sin saber por qué. Ahora cualquier error sale como toast.
    async function _patchLead(id, body) {
      const resp = await fetch(apiUrl('/api/setters/leads/' + id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        const err = new Error(`HTTP ${resp.status}${txt ? ' — ' + txt.substring(0, 120) : ''}`);
        err.status = resp.status;
        throw err;
      }
      const data = await resp.json();
      if (!data.lead) throw new Error('Respuesta sin lead — backend no devolvió data esperada.');
      return data.lead;
    }

    window._updateField = async (el, field) => {
      const id = el.dataset.id;
      const val = el.value;
      const body = {};
      body[field] = val || null;
      try {
        const lead = await _patchLead(id, body);
        const labels = {
          conexion: { 'enviada': '✓ Marcado como WSP enviado', 'sin_wsp': '✓ Movido a Llamadas (Sin WSP)', '': '✓ Conexión limpia' },
          interes: { 'si': '✓ Marcado interesado', 'no': '✓ Marcado no interesa', '': '✓ Interés limpio' },
        };
        const msg = labels[field]?.[val || ''] || '✓ Guardado';
        _syncLeadAndRefresh(id, lead, { confirmMessage: msg });
      } catch (e) {
        console.error('[updateField]', e);
        window.showToast?.('No se pudo guardar: ' + e.message + (e.status === 401 ? ' (sesión expirada — recargá)' : ''), { type: 'error', duration: 5000 });
      }
    };

    window._updateResp = async (el) => {
      const id = el.dataset.id;
      const val = el.value;
      try {
        // SI → respondio:true. NO → respondioNo:true (respondio:false). — → ambos false.
        const body = val === 'si'
          ? { respondio: true, respondioNo: false }
          : (val === 'no'
              ? { respondio: false, respondioNo: true }
              : { respondio: false, respondioNo: false });
        const lead = await _patchLead(id, body);
        const msg = val === 'si' ? '✓ Marcado: respondió' : (val === 'no' ? '✓ Marcado: no respondió' : '✓ Respuesta limpia');
        _syncLeadAndRefresh(id, lead, { confirmMessage: msg });
      } catch (e) {
        console.error('[updateResp]', e);
        window.showToast?.('No se pudo guardar: ' + e.message + (e.status === 401 ? ' (sesión expirada — recargá)' : ''), { type: 'error', duration: 5000 });
      }
    };

    window._updateCalif = async (el) => {
      const id = el.dataset.id;
      const val = el.value;
      try {
        const lead = await _patchLead(id, { calificado: val === 'si' ? true : (val === 'no' ? 'no' : false) });
        const msg = val === 'si' ? '✓ Marcado: calificó' : (val === 'no' ? '✓ Marcado: no calificó' : '✓ Calificación limpia');
        _syncLeadAndRefresh(id, lead, { confirmMessage: msg });
      } catch (e) {
        console.error('[updateCalif]', e);
        window.showToast?.('No se pudo guardar: ' + e.message + (e.status === 401 ? ' (sesión expirada — recargá)' : ''), { type: 'error', duration: 5000 });
      }
    };

    window._updateVariant = async (el) => {
      const id = el.dataset.id;
      const value = el.value || null;
      try {
        const resp = await fetch(apiUrl('/api/setters/leads/' + id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ varianteId: value }) });
        const data = await resp.json();
        _syncLeadAndRefresh(id, data.lead);
      } catch (e) { console.error(e); }
    };

    // Follow-up toggle (determinístico: usa estado del checkbox)
    window._toggleFU = async (el) => {
      const id = el.dataset.id;
      const step = el.dataset.step;
      const value = !!el.checked;
      try {
        const resp = await fetch(apiUrl('/api/setters/leads/' + id + '/followup'), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step, value })
        });
        const data = await resp.json();
        // Actualizar estado local para evitar desync. Importante: el backend
        // destila los otros checkboxes automáticamente (solo uno activo a la
        // vez), entonces el response trae el estado COMPLETO de followUps.
        const idx = setterLeads.findIndex(l => l.id === id);
        if (idx >= 0 && data.followUps) {
          setterLeads[idx].followUps = data.followUps;
          setterLeads[idx].followUpStartedAt = data.followUpStartedAt;
        }
        _updateStatsLocal();
        // Re-render para que los checkboxes destildados por el backend se vean
        // y el chip de follow-up se actualice. Si estamos en filtros 'hacer_hoy'
        // o 'atrasados', el filtro también necesita refresh.
        renderSetterLeads();
        // Refrescar listado de follow-ups (badge sidebar + filtros del CRM)
        if (typeof loadFollowups === 'function') loadFollowups();
      } catch (e) { console.error(e); }
    };

    // Paginación setters
    window._setterPageNav = (dir) => {
      setterPage += dir;
      renderSetterLeads();
    };

    // ═══════════════════════════════════════════════════════════
    // PHASE setter-ux-redesign — helpers nuevos
    // ═══════════════════════════════════════════════════════════

    // Toast unificado para feedback de acciones (reemplaza alerts/sin-feedback).
    // Uso: window.showToast('Texto', { type: 'success'|'error'|'warning'|'info', duration: 2500 })
    window.showToast = function showToast(msg, opts = {}) {
      const { type = 'success', duration = 2500 } = opts;
      let cont = document.getElementById('scm-toast-container');
      if (!cont) {
        cont = document.createElement('div');
        cont.id = 'scm-toast-container';
        document.body.appendChild(cont);
      }
      const toast = document.createElement('div');
      toast.className = 'scm-toast ' + type;
      toast.textContent = msg;
      cont.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 250);
      }, duration);
    };

    // Switch entre tabs del modal del lead.
    window._switchLeadTab = function switchLeadTab(tabId) {
      document.querySelectorAll('.lead-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.leadTab === tabId);
      });
      document.querySelectorAll('.lead-tab-content').forEach(p => {
        p.style.display = p.dataset.leadTabPanel === tabId ? '' : 'none';
      });
    };
    // Wire los botones de tab del modal (una sola vez al init)
    document.querySelectorAll('.lead-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => window._switchLeadTab(btn.dataset.leadTab));
    });

    // Modal de lead
    window._openLeadModal = async (leadId) => {
      const lead = setterLeads.find(l => l.id === leadId);
      if (!lead) return;
      currentModalLeadId = leadId;
      // Exponer el lead actual para handlers fuera de este closure (modal Agendar).
      window.__currentLead = lead;
      // Guardar último lead trabajado (por usuario). Key namespaced `scm_*`.
      try { localStorage.setItem(_scmLastLeadKey(), JSON.stringify({ id: leadId, name: lead.name, at: Date.now() })); } catch {}
      const variant = getLeadVariant(lead);

      document.getElementById('modal-lead-name').textContent = lead.name;
      document.getElementById('modal-city').textContent = [lead.country, lead.city].filter(Boolean).join(' / ') || lead.address || '—';
      const bestPhone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '';
      const openUrl = buildSetterWaUrl(lead, 'apertura');
      document.getElementById('modal-phone').innerHTML = bestPhone ? '<a href="' + escHtml(openUrl) + '" target="_blank" class="text-link" style="color:var(--success);" onclick="return window._waBtnClick(this, event, \'' + escHtml(lead.id) + '\');" title="Abrir WhatsApp (WAMULTI si sos Ignacio)">' + escHtml(bestPhone) + ' 💬</a>' : '—';
      document.getElementById('modal-web').innerHTML = lead.website ? '<a href="' + escHtml(lead.website) + '" target="_blank" class="text-link">' + escHtml(lead.website) + '</a>' : '—';
      document.getElementById('modal-email').textContent = lead.email || '—';
      document.getElementById('modal-owner').textContent = lead.doctor || '—';

      let socialHtml = '';
      if (lead.instagram) socialHtml += '<a href="' + escHtml(lead.instagram) + '" target="_blank" class="text-link" style="margin-right:8px;">IG</a>';
      if (lead.facebook) socialHtml += '<a href="' + escHtml(lead.facebook) + '" target="_blank" class="text-link" style="margin-right:8px;">FB</a>';
      if (lead.linkedin) socialHtml += '<a href="' + escHtml(lead.linkedin) + '" target="_blank" class="text-link" style="margin-right:8px;">IN</a>';
      document.getElementById('modal-social').innerHTML = socialHtml || '—';

      document.getElementById('modal-status-select').value = lead.estado || 'sin_contactar';
      document.getElementById('modal-decisor-select').value = lead.decisor || '';

      // Mi número usado — populate select con teléfonos propios del setter
      const waWrap = document.getElementById('modal-wa-account-wrap');
      const waSel = document.getElementById('modal-wa-account-select');
      if (waWrap && waSel) {
        const opts = ['<option value="">— Sin especificar —</option>'];
        for (const p of _myPhones || []) {
          const txt = (p.label || '(sin nombre)') + (p.phone ? ' · ' + p.phone : '');
          opts.push('<option value="' + escHtml(p.id) + '"' + (lead.setterPhoneId === p.id ? ' selected' : '') + '>' + escHtml(txt) + '</option>');
        }
        opts.push('<option value="__add__">➕ Agregar nuevo número…</option>');
        waSel.innerHTML = opts.join('');
        waWrap.style.display = 'flex';
        waSel.onchange = async (e) => {
          const val = e.target.value || '';
          if (val === '__add__') {
            e.target.value = lead.setterPhoneId || '';
            const label = await window.askText({
              title: '➕ Agregar mi número',
              subtitle: 'Cargá un label corto (cómo lo reconocés) y el número de teléfono. Solo vos lo ves.',
              type: 'input',
              placeholder: 'Label (ej: Línea 1, Maxi nuevo, etc.)',
              confirmLabel: 'Siguiente',
            });
            if (!label) return;
            const phone = await window.askText({
              title: '➕ Número de "' + label + '"',
              subtitle: 'Pegá el número (con prefijo de país si corresponde). Opcional, podés dejarlo vacío.',
              type: 'input',
              placeholder: '+54 11 1234 5678',
              confirmLabel: 'Guardar',
              confirmRequired: false,
            });
            try {
              const r = await fetch(apiUrl('/api/setters/team/' + encodeURIComponent(currentUser.setterId) + '/phones'), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                body: JSON.stringify({ label, phone: phone || '' }),
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
              _myPhones = d.phones || _myPhones;
              window.showToast?.('✓ "' + label + '" agregado a tus números', { type: 'success' });
              // Asignar el nuevo phone a este lead automáticamente
              const newId = d.phone?.id || '';
              if (newId) {
                const r2 = await fetch(apiUrl('/api/setters/leads/' + leadId), {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                  body: JSON.stringify({ setterPhoneId: newId }),
                });
                if (r2.ok) lead.setterPhoneId = newId;
              }
              // Re-renderizar el modal para que aparezca el nuevo número en el dropdown
              window._openLeadModal(leadId);
            } catch (err) {
              window.showToast?.('Error: ' + err.message, { type: 'error' });
            }
            return;
          }
          // Cambio normal: PATCH lead con el setterPhoneId
          try {
            const r = await fetch(apiUrl('/api/setters/leads/' + leadId), {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ setterPhoneId: val }),
            });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            lead.setterPhoneId = val;
            const p = (_myPhones || []).find(x => x.id === val);
            window.showToast?.(val ? ('✓ Marcado: contactado desde ' + (p?.label || 'mi número')) : '✓ Número limpio', { type: 'success', duration: 1800 });
            renderSetterLeads();
          } catch (err) {
            window.showToast?.('Error: ' + err.message, { type: 'error' });
          }
        };
      }

      const visibleVariants = getVisibleVariables();
      const leadVarSelect = document.getElementById('lead-variable-select');
      if (leadVarSelect) {
        leadVarSelect.innerHTML = '<option value="">Sin variable</option>' + visibleVariants.map(v => '<option value="' + escHtml(v.id) + '"' + ((lead.varianteId || currentVariableId) === v.id ? ' selected' : '') + '>' + escHtml(v.name) + '</option>').join('');
      }
      const assignBtn = document.getElementById('assign-variable-btn');
      if (assignBtn && leadVarSelect) {
        assignBtn.onclick = async () => {
          await fetch(apiUrl('/api/setters/leads/' + leadId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ varianteId: leadVarSelect.value || null }) });
          lead.varianteId = leadVarSelect.value || null;
          loadSetterModule();
          window._openLeadModal(leadId);
        };
      }

      renderBlocks(getVariantById(lead.varianteId || currentVariableId), lead);

      // ── Sección de follow-ups con notas + reprogramar ──
      _renderModalFollowups(lead);

      // Historial de llamadas (si lo hay)
      const callLogContainer = document.getElementById('modal-call-log');
      if (callLogContainer) {
        const callLog = Array.isArray(lead.callLog) ? lead.callLog.slice().reverse() : [];
        if (callLog.length > 0) {
          const outcomeLabels = {
            answered_interested: { label: '✅ Interesado', color: 'var(--success)' },
            answered_not_interested: { label: '❌ No interesado', color: 'var(--danger)' },
            no_answer: { label: '📵 No atendió', color: 'var(--text-tertiary)' },
            voicemail: { label: '📭 Buzón', color: 'var(--warning)' },
            wrong_number: { label: '🔢 Equivocado', color: 'var(--danger)' },
            invalid_number: { label: '🚫 No existe', color: 'var(--danger)' },
            callback_later: { label: '🔄 Postpuesto', color: 'var(--info)' },
            scheduled_with_admin: { label: '📅 Agendó con Ignacio', color: 'var(--accent)' }
          };
          callLogContainer.innerHTML =
            '<div style="font-size:11px; font-weight:600; letter-spacing:0.5px; color:var(--text-tertiary); text-transform:uppercase; margin-bottom:8px;">📞 Historial de llamadas (' + callLog.length + ')</div>' +
            '<div style="display:flex; flex-direction:column; gap:6px; max-height:200px; overflow-y:auto;">' +
            callLog.map(c => {
              const o = outcomeLabels[c.outcome] || { label: c.outcome, color: 'var(--text-secondary)' };
              const ts = c.ts ? new Date(c.ts).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
              return '<div style="background:var(--bg-input); border-left:3px solid ' + o.color + '; padding:8px 12px; border-radius:6px;">' +
                '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
                  '<span style="color:' + o.color + '; font-weight:600; font-size:12px;">' + escHtml(o.label) + '</span>' +
                  '<span style="color:var(--text-tertiary); font-size:11px;">' + escHtml(ts) + '</span>' +
                '</div>' +
                (c.notes ? '<div style="color:var(--text-secondary); font-size:12px; margin-top:4px; line-height:1.4;">' + escHtml(c.notes) + '</div>' : '') +
              '</div>';
            }).join('') + '</div>';
          callLogContainer.style.display = 'block';
        } else {
          callLogContainer.style.display = 'none';
        }
      }

      const notesList = document.getElementById('modal-notes-list');
      if (lead.notes && lead.notes.length > 0) {
        notesList.innerHTML = lead.notes.map((n, idx) =>
          '<div class="note-item"><div class="note-item-header"><span>' + escHtml(n.by) + '</span><span>' +
          new Date(n.date).toLocaleString('es-AR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) +
          ' <button class="note-delete-btn" data-note-idx="' + idx + '" title="Borrar nota" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px;padding:0 4px;">✕</button>' +
          '</span></div><div>' + escHtml(n.text) + '</div></div>'
        ).join('');
        notesList.querySelectorAll('.note-delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const noteIdx = btn.getAttribute('data-note-idx');
            if (!confirm('¿Borrar esta nota?')) return;
            try {
              await fetch(apiUrl('/api/setters/leads/' + leadId + '/note/' + noteIdx), { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
              await loadSetterModule();
              window._openLeadModal(leadId);
            } catch (err) { console.error(err); }
          });
        });
        notesList.scrollTop = notesList.scrollHeight;
      } else {
        notesList.innerHTML = '<p class="text-muted" style="font-size:12px; text-align:center; padding:16px;">Sin notas aún.</p>';
      }
      document.getElementById('modal-note-input').value = '';
      // Hidratar seccion 📅 Programar mensaje: input default = mañana 10am,
      // textarea precargado con openMessage actual del lead, lista de
      // programados ya existentes del lead.
      try {
        const dtInput = document.getElementById('schedule-datetime');
        if (dtInput) {
          const tomorrow10 = new Date();
          tomorrow10.setDate(tomorrow10.getDate() + 1);
          tomorrow10.setHours(10, 0, 0, 0);
          // Format yyyy-mm-ddThh:mm (sin segundos)
          const pad = n => String(n).padStart(2, '0');
          dtInput.value = `${tomorrow10.getFullYear()}-${pad(tomorrow10.getMonth() + 1)}-${pad(tomorrow10.getDate())}T${pad(tomorrow10.getHours())}:${pad(tomorrow10.getMinutes())}`;
        }
        const msgArea = document.getElementById('schedule-message');
        if (msgArea) msgArea.value = lead.openMessage || '';
        const cancelCb = document.getElementById('schedule-cancel-on-reply');
        if (cancelCb) cancelCb.checked = true;
        // Cargar programados existentes del lead
        if (typeof window._loadScheduledForLead === 'function') window._loadScheduledForLead(leadId);
      } catch (e) { console.warn('schedule hydrate err:', e); }
      // Reset modal tabs al default: empezar siempre en 💬 Conversación
      if (typeof window._switchLeadTab === 'function') window._switchLeadTab('convo');
      leadModal.classList.remove('hidden');
    };

    document.getElementById('modal-close').addEventListener('click', () => { leadModal.classList.add('hidden'); currentModalLeadId = null; });
    leadModal.addEventListener('click', (e) => { if (e.target === leadModal) { leadModal.classList.add('hidden'); currentModalLeadId = null; } });

    document.getElementById('modal-status-select').addEventListener('change', async (e) => {
      if (!currentModalLeadId) return;
      const estado = e.target.value;
      let update = { estado };
      if (estado === 'contactado') update.conexion = 'enviada';
      if (estado === 'respondio') { update.conexion = 'enviada'; update.respondio = true; }
      if (estado === 'interesado') { update.conexion = 'enviada'; update.respondio = true; update.interes = 'si'; }
      try {
        await fetch(apiUrl('/api/setters/leads/' + currentModalLeadId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
        loadSetterModule();
      } catch (err) { console.error(err); }
    });

    document.getElementById('modal-decisor-select').addEventListener('change', async (e) => {
      if (!currentModalLeadId) return;
      try {
        await fetch(apiUrl('/api/setters/leads/' + currentModalLeadId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decisor: e.target.value }) });
      } catch (err) { console.error(err); }
    });

    document.getElementById('modal-add-note').addEventListener('click', async () => {
      const text = document.getElementById('modal-note-input').value.trim();
      if (!text || !currentModalLeadId) return;
      const setterObj = currentUser?.role === 'setter'
        ? { name: currentUser.name }
        : settersList.find(s => s.id === setterSelect.value);
      const by = setterObj ? setterObj.name : 'Sistema';
      try {
        await fetch(apiUrl('/api/setters/leads/' + currentModalLeadId + '/note'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, by }) });
        await loadSetterModule();
        window._openLeadModal(currentModalLeadId);
      } catch (err) { console.error(err); }
    });

    // ─── 📅 PROGRAMAR MENSAJE ───────────────────────────────────────
    // Phase setter-automations-followups (2026-05-22)
    // Setter elige fecha + escribe mensaje + (opcionalmente) cancelar-si-responde
    // → POST a /api/scheduled-messages → entrada en queue del scheduler server-side
    function _scheduleFormatDatetimeLocal(d) {
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // Presets +24h/+48h/+72h/+7d/+15d → cargan el datetime input
    document.querySelectorAll('[data-schedule-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.schedulePreset;
        const map = { '24h': 24*3600, '48h': 48*3600, '72h': 72*3600, '7d': 7*24*3600, '15d': 15*24*3600 };
        const secs = map[preset];
        if (!secs) return;
        const target = new Date(Date.now() + secs * 1000);
        // Si es +24h o +48h o +72h, mantener la hora actual.
        // Si es +7d o +15d, default a las 10am de ese día (mas razonable como horario laboral)
        if (preset === '7d' || preset === '15d') target.setHours(10, 0, 0, 0);
        const dtInput = document.getElementById('schedule-datetime');
        if (dtInput) dtInput.value = _scheduleFormatDatetimeLocal(target);
      });
    });

    document.getElementById('schedule-submit-btn')?.addEventListener('click', async () => {
      if (!currentModalLeadId) return;
      const dtVal = document.getElementById('schedule-datetime').value;
      const msgVal = document.getElementById('schedule-message').value.trim();
      const cancelOnReply = document.getElementById('schedule-cancel-on-reply').checked;
      if (!dtVal) return alert('Elegí fecha y hora.');
      if (!msgVal) return alert('Escribí el mensaje a mandar.');
      const when = new Date(dtVal);
      if (when.getTime() < Date.now() - 60_000) return alert('La fecha tiene que ser en el futuro.');
      const btn = document.getElementById('schedule-submit-btn');
      btn.disabled = true; const prevTxt = btn.textContent; btn.textContent = 'Programando...';
      try {
        const r = await fetch(apiUrl('/api/scheduled-messages'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: currentModalLeadId,
            scheduledFor: when.toISOString(),
            message: msgVal,
            cancelOnReply,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        btn.textContent = '✓ Programado';
        setTimeout(() => { btn.textContent = prevTxt; btn.disabled = false; }, 1500);
        // Refrescar lista de programados del lead
        if (typeof window._loadScheduledForLead === 'function') window._loadScheduledForLead(currentModalLeadId);
      } catch (e) {
        alert('Error: ' + e.message);
        btn.textContent = prevTxt; btn.disabled = false;
      }
    });

    // Lista de programados de este lead (renderiza dentro del modal)
    window._loadScheduledForLead = async (leadId) => {
      const cont = document.getElementById('schedule-existing-list');
      const countEl = document.getElementById('lead-schedule-count');
      if (!cont) return;
      try {
        const r = await fetch(apiUrl('/api/scheduled-messages?leadId=' + encodeURIComponent(leadId) + '&limit=20'));
        const data = await r.json();
        const list = data.scheduledMessages || [];
        const pending = list.filter(m => m.status === 'pending');
        if (countEl) countEl.textContent = pending.length > 0 ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : '';
        if (list.length === 0) { cont.innerHTML = ''; return; }
        const statusChip = (s) => {
          const map = {
            pending: ['rgba(157,133,242,0.15)', 'var(--accent)', '⏳ Pendiente'],
            sent: ['rgba(91,185,116,0.15)', 'var(--success)', '✓ Enviado'],
            failed: ['rgba(248,81,73,0.15)', 'var(--danger)', '✗ Fallido'],
            cancelled: ['rgba(126,132,148,0.15)', 'var(--text-tertiary)', '⊘ Cancelado'],
            expired: ['rgba(248,81,73,0.10)', 'var(--danger)', '⌛ Expirado'],
          };
          const [bg, col, label] = map[s] || ['rgba(0,0,0,0.1)', 'var(--text)', s];
          return `<span style="font-size:10px; padding:2px 8px; background:${bg}; color:${col}; border-radius:6px;">${label}</span>`;
        };
        cont.innerHTML = '<div style="margin-top:10px; font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Programados de este lead</div>' +
          list.map(m => {
            const when = new Date(m.scheduledFor);
            const whenStr = when.toLocaleString();
            const canCancel = m.status === 'pending';
            return `<div style="display:flex; align-items:start; gap:10px; padding:8px 10px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:8px; margin-top:6px;">
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                  <span style="font-size:12px; color:var(--text-secondary);">${escHtml(whenStr)}</span>
                  ${statusChip(m.status)}
                </div>
                <div style="font-size:12px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escHtml(m.message)}">${escHtml(m.message.slice(0, 100))}${m.message.length > 100 ? '…' : ''}</div>
                ${m.lastFailureReason ? `<div style="font-size:10px; color:var(--danger); margin-top:2px;">⚠ ${escHtml(m.lastFailureReason)}</div>` : ''}
              </div>
              ${canCancel ? `<button onclick="window._cancelScheduled('${escHtml(m.id)}')" style="padding:4px 8px; background:none; border:1px solid var(--danger); color:var(--danger); border-radius:6px; font-size:11px; cursor:pointer;">Cancelar</button>` : ''}
            </div>`;
          }).join('');
      } catch (e) { console.warn('schedule list err:', e); }
    };
    window._cancelScheduled = async (id) => {
      if (!confirm('¿Cancelar este mensaje programado?')) return;
      try {
        const r = await fetch(apiUrl('/api/scheduled-messages/' + encodeURIComponent(id)), { method: 'DELETE' });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'HTTP ' + r.status); }
        if (currentModalLeadId) window._loadScheduledForLead(currentModalLeadId);
      } catch (e) { alert('Error: ' + e.message); }
    };

    // Filtros
    document.querySelectorAll('.pipe-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pipe-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPipeFilter = btn.dataset.status;
        setterPage = 1;
        renderSetterLeads();
      });
    });

    setterSelect.addEventListener('change', () => { setterPage = 1; loadSetterModule(); });
    variableSelect?.addEventListener('change', () => {
      currentVariableId = variableSelect.value || '';
      loadSetterModule();
    });

    // Buscador general en setters
    const setterSearchInput = document.getElementById('setter-search');
    const setterSearchClear = document.getElementById('setter-search-clear');
    let searchDebounce = null;
    if (setterSearchInput) setterSearchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => { setterPage = 1; renderSetterLeads(); }, 300);
    });
    if (setterSearchClear) setterSearchClear.addEventListener('click', () => {
      if (setterSearchInput) setterSearchInput.value = '';
      setterPage = 1;
      renderSetterLeads();
    });

    // Filtro de país (preferencia por usuario, persistida en localStorage)
    const setterCountryFilter = document.getElementById('setter-country-filter');
    if (setterCountryFilter) {
      const savedKey = 'setter_country_filter_' + (currentUser?.id || 'anon');
      const saved = localStorage.getItem(savedKey) || '';
      // Populate al cargar leads
      window._populateSetterCountryFilter = () => {
        const countries = [...new Set((setterLeads || []).map(l => (l.country || '').trim()).filter(Boolean))].sort();
        const flagMap = { 'colombia':'🇨🇴', 'argentina':'🇦🇷', 'méxico':'🇲🇽', 'mexico':'🇲🇽', 'chile':'🇨🇱', 'perú':'🇵🇪', 'peru':'🇵🇪', 'bolivia':'🇧🇴', 'uruguay':'🇺🇾', 'paraguay':'🇵🇾', 'ecuador':'🇪🇨', 'venezuela':'🇻🇪', 'españa':'🇪🇸', 'espana':'🇪🇸' };
        const cur = setterCountryFilter.value;
        setterCountryFilter.innerHTML = '<option value="">🌎 Todos los países</option>' +
          countries.map(c => {
            const flag = flagMap[c.toLowerCase()] || '';
            return `<option value="${escHtml(c)}">${flag} ${escHtml(c)}</option>`;
          }).join('');
        // Restaurar selección: la actual o la guardada
        if (cur && countries.includes(cur)) setterCountryFilter.value = cur;
        else if (saved && countries.includes(saved)) setterCountryFilter.value = saved;
      };
      setterCountryFilter.addEventListener('change', (e) => {
        localStorage.setItem(savedKey, e.target.value);
        setterPage = 1;
        renderSetterLeads();
      });
    }

    // Date filter (pedido de Genaro): re-render al cambiar.
    const setterDateFilter = document.getElementById('setter-date-filter');
    if (setterDateFilter) {
      setterDateFilter.addEventListener('change', () => {
        // Si elige un preset, limpiar la fecha específica
        const sd = document.getElementById('setter-date-specific');
        if (sd && sd.value) sd.value = '';
        const cl = document.getElementById('setter-date-specific-clear');
        if (cl) cl.style.display = 'none';
        setterPage = 1;
        renderSetterLeads();
      });
    }
    // Fecha específica: input type=date
    const setterDateSpecific = document.getElementById('setter-date-specific');
    const setterDateSpecificClear = document.getElementById('setter-date-specific-clear');
    if (setterDateSpecific) {
      setterDateSpecific.addEventListener('change', () => {
        // Si elige una fecha específica, limpiar el preset
        if (setterDateSpecific.value) {
          if (setterDateFilter) setterDateFilter.value = '';
          if (setterDateSpecificClear) setterDateSpecificClear.style.display = '';
        } else {
          if (setterDateSpecificClear) setterDateSpecificClear.style.display = 'none';
        }
        setterPage = 1;
        renderSetterLeads();
      });
    }
    if (setterDateSpecificClear) {
      setterDateSpecificClear.addEventListener('click', () => {
        if (setterDateSpecific) setterDateSpecific.value = '';
        setterDateSpecificClear.style.display = 'none';
        setterPage = 1;
        renderSetterLeads();
      });
    }

    const renderVariantEditor = () => {
      const editor = document.getElementById('variant-block-editor');
      if (!editor) return;
      if (!draftBlocks.length) draftBlocks = [{ id: `draft_${Date.now()}`, label: 'Apertura', text: '' }];
      editor.innerHTML = draftBlocks.map((block, idx) => `
        <div class="variant-block-card" data-index="${idx}" style="margin-bottom:8px;">
          <div class="variant-block-head">
            <input class="setter-input" data-field="label" data-index="${idx}" value="${escHtml(block.label || '')}" placeholder="Etiqueta del bloque">
            <button type="button" class="btn-table-action" style="color:var(--danger);" data-remove-block="${idx}">Eliminar</button>
          </div>
          <textarea class="setter-input" data-field="text" data-index="${idx}" rows="3" style="width:100%;">${escHtml(block.text || '')}</textarea>
        </div>
      `).join('');
      editor.querySelectorAll('[data-field]').forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.getAttribute('data-index'));
          const field = el.getAttribute('data-field');
          draftBlocks[idx] = { ...draftBlocks[idx], [field]: el.value };
        });
      });
      editor.querySelectorAll('[data-remove-block]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.getAttribute('data-remove-block'));
          draftBlocks.splice(idx, 1);
          renderVariantEditor();
        });
      });
      window._renderVariantEditor = renderVariantEditor;
    };

    const renderInlineVariantEditor = () => {
      if (!inlineVarBlocks) return;
      if (!inlineDraftBlocks.length) inlineDraftBlocks = [{ id: `inline_${Date.now()}`, label: 'Apertura', text: '' }];
      inlineVarBlocks.innerHTML = inlineDraftBlocks.map((block, idx) => `
        <div class="variant-block-card" style="margin-bottom:8px;">
          <div class="variant-block-head">
            <input class="setter-input" data-inline-field="label" data-inline-index="${idx}" value="${escHtml(block.label || '')}" placeholder="Etiqueta del bloque">
            <button type="button" class="btn-table-action" style="color:var(--danger);" data-inline-remove="${idx}">Eliminar</button>
          </div>
          <textarea class="setter-input" data-inline-field="text" data-inline-index="${idx}" rows="3" style="width:100%;">${escHtml(block.text || '')}</textarea>
        </div>
      `).join('');
      inlineVarBlocks.querySelectorAll('[data-inline-field]').forEach((el) => {
        el.addEventListener('input', () => {
          const idx = Number(el.getAttribute('data-inline-index'));
          const field = el.getAttribute('data-inline-field');
          inlineDraftBlocks[idx] = { ...inlineDraftBlocks[idx], [field]: el.value };
        });
      });
      inlineVarBlocks.querySelectorAll('[data-inline-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.getAttribute('data-inline-remove'));
          inlineDraftBlocks.splice(idx, 1);
          renderInlineVariantEditor();
        });
      });
    };

    window._forceOpenVariantEditor = () => {
      const editor = document.getElementById('inline-variant-editor');
      if (editor) {
        editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        editor.style.boxShadow = '0 0 0 2px var(--primary-color)';
        setTimeout(() => { editor.style.boxShadow = ''; }, 1500);
      }
    };

    document.getElementById('add-variant-block-btn')?.addEventListener('click', () => {
      draftBlocks.push({ id: `draft_${Date.now()}`, label: `Bloque ${draftBlocks.length + 1}`, text: '' });
      renderVariantEditor();
    });

    inlineAddBlockBtn?.addEventListener('click', () => {
      inlineDraftBlocks.push({ id: `inline_${Date.now()}`, label: `Bloque ${inlineDraftBlocks.length + 1}`, text: '' });
      renderInlineVariantEditor();
    });

    cmdVariableSetterFilter?.addEventListener('change', () => {
      commandVariableSetterFilterValue = cmdVariableSetterFilter.value || '';
      loadCommandCenter();
    });

    cmdVariableSearch?.addEventListener('input', () => {
      commandVariableSearchValue = cmdVariableSearch.value.trim().toLowerCase();
      loadCommandCenter();
    });

    inlineSaveVariableBtn?.addEventListener('click', async () => {
      const name = inlineVarName?.value.trim() || '';
      const weekLabel = inlineVarWeek?.value.trim() || '';
      const setterId = inlineVarSetter?.value.trim() || '';
      const blocks = inlineDraftBlocks.map((block, index) => ({
        id: block.id || `block_${Date.now()}_${index}`,
        label: block.label || `Bloque ${index + 1}`,
        text: (block.text || '').trim(),
        order: index
      })).filter((block) => block.text);
      if (!name) return alert('Poné un nombre a la variable.');
      if (blocks.length === 0) return alert('Agregá al menos un bloque con texto.');
      await fetch(apiUrl('/api/setters/variants'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, weekLabel, setterId, blocks }) });
      inlineVarName.value = '';
      inlineVarWeek.value = '';
      if (inlineVarSetter) inlineVarSetter.value = '';
      inlineDraftBlocks = [{ id: `inline_${Date.now()}`, label: 'Apertura', text: '' }];
      renderInlineVariantEditor();
      loadCommandCenter();
    });

    // ── Sesiones ──
    sessionBtn.addEventListener('click', async () => {
      const setter = currentUser?.role === 'setter' ? currentUser.setterId : setterSelect.value;
      if (!setter) { alert('Seleccioná un setter primero.'); return; }
      try {
        const resp = await fetch(apiUrl('/api/setters/sessions/start'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setter }) });
        const data = await resp.json();
        activeSession = data.session;
        const setterObj = settersList.find(s => s.id === setter);
        startSessionUI(setterObj ? setterObj.name : setter);
      } catch (e) { console.error(e); }
    });

    function startSessionUI(name) {
      sessionBanner.classList.remove('hidden');
      sessionSetterName.textContent = name;
      sessionBtn.disabled = true;
      sessionBtn.querySelector('.btn-text').textContent = 'Sesión activa...';
      const startTime = Date.now();
      sessionTimerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
        const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
        sessionTimerEl.textContent = h + ':' + m + ':' + s;
      }, 1000);
    }

    endSessionBtn.addEventListener('click', async () => {
      if (!activeSession) return;
      let summary = null;
      try {
        const r = await fetch(apiUrl('/api/setters/sessions/end'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setter: activeSession.setter }) });
        const d = await r.json();
        summary = d?.session?.summary || null;
        var aiText = d?.session?.aiSummary || null;
      } catch (e) { console.error(e); }
      clearInterval(sessionTimerInterval);
      sessionBanner.classList.add('hidden');
      sessionBtn.disabled = false;
      sessionBtn.querySelector('.btn-text').textContent = 'Iniciar Sesión';
      activeSession = null;
      if (summary) showSessionSummaryModal(summary, aiText);
    });

    // Modal con resumen post-sesión
    function showSessionSummaryModal(s, aiText) {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card" style="max-width:560px;">
          <div class="modal-header">
            <h3>Resumen de tu sesión</h3>
            <button class="modal-close-btn" data-close>×</button>
          </div>
          <div class="modal-body">
            <div class="session-summary-grid">
              <div class="session-summary-stat"><div class="session-summary-num">${s.durationMin}m</div><div class="session-summary-lbl">Duración</div></div>
              <div class="session-summary-stat"><div class="session-summary-num">${s.connections}</div><div class="session-summary-lbl">Conexiones</div></div>
              <div class="session-summary-stat"><div class="session-summary-num">${s.replies}</div><div class="session-summary-lbl">Respondieron</div></div>
              <div class="session-summary-stat"><div class="session-summary-num">${s.qualified}</div><div class="session-summary-lbl">Calificados</div></div>
              <div class="session-summary-stat"><div class="session-summary-num">${s.interested}</div><div class="session-summary-lbl">Interesados</div></div>
              <div class="session-summary-stat is-highlight"><div class="session-summary-num">${s.scheduled}</div><div class="session-summary-lbl">Agendados</div></div>
              <div class="session-summary-stat"><div class="session-summary-num">${s.notesAdded}</div><div class="session-summary-lbl">Notas</div></div>
              <div class="session-summary-stat"><div class="session-summary-num">${s.sinWsp}</div><div class="session-summary-lbl">Sin WSP</div></div>
            </div>
            ${aiText ? `<div class="session-summary-ai"><div class="session-summary-ai-label">Análisis</div><p>${escHtml(aiText).replace(/\n/g, '<br>')}</p></div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" data-close>Cerrar</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => overlay.remove()));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // ── Variantes modal ──
    document.getElementById('manage-variants-btn').addEventListener('click', () => { loadVariantsModal(); variantsModal.classList.remove('hidden'); });
    document.getElementById('variants-modal-close').addEventListener('click', () => { variantsModal.classList.add('hidden'); });
    variantsModal.addEventListener('click', (e) => { if (e.target === variantsModal) variantsModal.classList.add('hidden'); });

    async function loadVariantsModal() {
      const resp = await fetch(apiUrl('/api/setters/variants'));
      const data = await resp.json();
      let allVariants = data.variants || [];
      const isAdmin = currentUser?.role === 'admin';
      const mySetterId = currentUser?.setterId || '';
      // 2026-05-24: TODOS los setters acceden a TODAS las variantes (pedido del user).
      // Antes solo veian propias o las que un admin compartio. Ahora todas.
      variantsList = allVariants;
      const list = document.getElementById('variants-list');
      renderVariantEditor();

      if (variantsList.length === 0) {
        list.innerHTML = '<p class="text-muted">No hay variantes ' + (isAdmin ? 'creadas aún' : 'asignadas a vos aún') + '.</p>';
        return;
      }

      list.innerHTML = variantsList.map(v => {
        const isOwner = isAdmin || v.setterId === mySetterId;
        // Setters asignados: el owner principal + los compartidos
        const sharedIds = Array.isArray(v.sharedWith) ? v.sharedWith : [];
        const allAssignedIds = [v.setterId, ...sharedIds].filter(Boolean);
        const assignedNames = settersList
          .filter(s => allAssignedIds.includes(s.id))
          .map(s => s.name)
          .join(', ');
        const blocks = [
          { label: 'Apertura',     text: v.messages?.apertura },
          { label: 'Problema',     text: v.messages?.problema },
          { label: 'Prueba social', text: v.messages?.pruebaSocial },
          { label: 'Cierre',       text: v.messages?.cierrePregunta },
        ];
        return '<div class="variant-card">' +
          '<div class="variant-card-header">' +
            '<span class="variant-card-name">' + escHtml(v.name) + (v.weekLabel ? ' <span class="variant-card-week">' + escHtml(v.weekLabel) + '</span>' : '') + '</span>' +
            (isOwner ? '<button class="btn btn-danger btn-sm" onclick="window._deleteVariant(\'' + v.id + '\')">Eliminar</button>' : '') +
          '</div>' +
          '<div class="variant-card-blocks">' +
            blocks.map(b => '<div class="variant-card-block">' +
              '<div class="variant-card-block-label">' + b.label + '</div>' +
              '<div class="variant-card-block-text">' + escHtml(b.text || '—') + '</div>' +
            '</div>').join('') +
          '</div>' +
          (isAdmin ? '<div class="variant-card-assign" style="display:flex; flex-direction:column; gap:10px;">' +
            '<div>' +
              '<span class="variant-card-assign-label">Setters con esta variante:</span>' +
              ' <strong class="variant-card-assign-value" style="color:var(--accent);">' + (assignedNames || 'Ninguno') + '</strong>' +
            '</div>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:8px 10px; background:rgba(157,133,242,0.04); border:1px solid var(--border-color); border-radius:8px;">' +
              '<span style="font-size:11px; color:var(--text-secondary); margin-right:4px;">Tildá los setters que la van a usar:</span>' +
              settersList.map(s => {
                const isAssigned = allAssignedIds.includes(s.id);
                return '<label style="display:inline-flex; align-items:center; gap:5px; font-size:12px; cursor:pointer; padding:4px 10px; border-radius:8px; background:' + (isAssigned ? 'rgba(157,133,242,0.15)' : 'transparent') + '; border:1px solid ' + (isAssigned ? 'var(--accent)' : 'var(--border-color)') + '; transition:all 0.15s;">' +
                  '<input type="checkbox" ' + (isAssigned ? 'checked' : '') + ' onchange="window._toggleVariantSetter(\'' + v.id + '\', \'' + s.id + '\', this.checked)" style="cursor:pointer;">' +
                  escHtml(s.name) +
                '</label>';
              }).join('') +
            '</div>' +
          '</div>' : '') +
        '</div>';
      }).join('');
    }

    // Tildar/destildar un setter para una variante. Maneja owner principal +
    // sharedWith de forma transparente para el admin: se ven todos los tildados
    // como "asignados", sin distinción de owner vs shared.
    window._toggleVariantSetter = async (variantId, setterId, checked) => {
      try {
        const resp = await fetch(apiUrl('/api/setters/variants'));
        const data = await resp.json();
        const v = (data.variants || []).find(x => x.id === variantId);
        if (!v) return;
        const currentShared = Array.isArray(v.sharedWith) ? [...v.sharedWith] : [];
        const currentOwner = v.setterId || '';
        const allCurrent = [currentOwner, ...currentShared].filter(Boolean);

        let newOwner = currentOwner;
        let newShared = [...currentShared];

        if (checked) {
          // Agregar
          if (!allCurrent.includes(setterId)) {
            if (!newOwner) newOwner = setterId;
            else if (!newShared.includes(setterId)) newShared.push(setterId);
          }
        } else {
          // Quitar
          if (newOwner === setterId) {
            newOwner = newShared.shift() || '';
          } else {
            newShared = newShared.filter(id => id !== setterId);
          }
        }
        await fetch(apiUrl('/api/setters/variants/' + variantId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setterId: newOwner, sharedWith: newShared })
        });
        loadVariantsModal();
      } catch (e) {
        console.error('[toggleVariantSetter]', e);
        window.showToast?.('Error: ' + e.message, { type: 'error' });
      }
    };

    window._deleteVariant = async (varId) => {
      if (!confirm('Eliminar variante?')) return;
      await fetch(apiUrl('/api/setters/variants/' + varId), { method: 'DELETE' });
      loadVariantsModal();
      loadSetterModule();
      loadCommandCenter();
    };

    window._assignVariant = async (setterId, varId) => {
      await fetch(apiUrl('/api/setters/variants/' + varId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setterId }) });
      loadVariantsModal();
      loadSetterModule();
    };

    window._assignVariantSetter = async (varId, setterId) => {
      await fetch(apiUrl('/api/setters/variants/' + varId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setterId: setterId || '' }) });
      loadCommandCenter();
    };

    window._assignVariantSetterFromCard = async (varId) => {
      const select = document.getElementById(`variant-setter-${varId}`);
      if (!select) return;
      await window._assignVariantSetter(varId, select.value);
    };

    window._duplicateVariant = async (varId) => {
      const variant = (variantsList || []).find(v => v.id === varId);
      if (!variant) return;
      const blocks = (variant.blocks || []).map((block, index) => ({
        id: `copy_${Date.now()}_${index}`,
        label: block.label || `Bloque ${index + 1}`,
        text: block.text || '',
        order: index,
        usedCount: 0,
        interestedCount: 0,
        createdAt: new Date().toISOString()
      }));
      await fetch(apiUrl('/api/setters/variants'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${variant.name} (copia)`, weekLabel: variant.weekLabel || '', setterId: variant.setterId || '', blocks })
      });
      loadCommandCenter();
    };

    // Limpia el trabajo de un setter — deja todos sus leads como sin_contactar
    // (excepto los sin_wsp que siguen en Llamadas). Útil antes de redistribuir
    // sus leads para que el setter destino los reciba frescos.
    window._resetSetterWork = async (setterId, setterName) => {
      const ok = await window.askConfirm({
        title: '🧹 Limpiar trabajo de ' + setterName,
        message: 'Vas a resetear TODOS los leads trabajados de ' + setterName + ' a "sin contactar". Se borran flags de conexión, respondió, calificado, interés, follow-ups, interacciones y notas de contacto.\n\nNO toca los leads marcados "Sin WSP" (esos siguen en Llamadas).\n\nSe hace backup automático antes. Esta acción es destructiva pero recuperable desde backups.\n\n¿Confirmás?',
        confirmLabel: 'Sí, limpiar trabajo',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await fetch(apiUrl('/api/setters/team/' + setterId + '/reset-work'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        window.showToast?.('✓ ' + d.resetCount + ' leads de ' + d.setterName + ' reseteados a sin_contactar' + (d.skippedSinWsp ? ' (' + d.skippedSinWsp + ' sin_wsp saltados)' : ''), { type: 'success', duration: 4000 });
        loadCommandCenter();
        if (typeof loadSetterModule === 'function') loadSetterModule();
      } catch (e) {
        window.showToast?.('Error: ' + e.message, { type: 'error', duration: 5000 });
      }
    };

    window._duplicateSetter = async (setterId) => {
      if (!setterId) return;
      await fetch(apiUrl('/api/setters/team/' + setterId + '/duplicate'), { method: 'POST' });
      loadCommandCenter();
    };

    window._deleteSetter = async (setterId) => {
      if (!setterId) return;
      const msg = '¿Eliminar este setter por completo?\n\nEsto va a:\n' +
                  '• Sacarlo del equipo\n' +
                  '• Liberar sus leads (quedan sin asignar, NO se borran)\n' +
                  '• Liberar sus variables\n' +
                  '• BORRAR su usuario, cerrar sus sesiones e invalidar sus invites pendientes\n\n' +
                  'Esto NO se puede deshacer. Si más adelante lo necesitás de nuevo, hay que invitarlo otra vez.';
      if (!confirm(msg)) return;
      try {
        const r = await fetch(apiUrl('/api/setters/team/' + setterId), { method: 'DELETE' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
        const partes = [];
        partes.push('Setter "' + (data.setterName || setterId) + '" eliminado.');
        if (data.leadsFreed) partes.push('• ' + data.leadsFreed + ' lead(s) liberado(s)');
        if (data.variantsFreed) partes.push('• ' + data.variantsFreed + ' variante(s) liberada(s)');
        if (data.userDeleted) {
          partes.push('• Usuario ' + (data.userEmail || '') + ' BORRADO');
          if (data.sessionsRevoked) partes.push('• ' + data.sessionsRevoked + ' sesion(es) revocada(s)');
        }
        if (data.invitesRevoked) partes.push('• ' + data.invitesRevoked + ' invite(s) pendientes revocada(s)');
        alert(partes.join('\n'));
      } catch (err) {
        alert('Error eliminando setter: ' + err.message);
      }
      loadCommandCenter();
    };

    window._toggleShareVariant = async (varId, setterId, shared) => {
      try {
        // Obtener estado actual
        const resp = await fetch(apiUrl('/api/setters/variants'));
        const data = await resp.json();
        const v = (data.variants || []).find(x => x.id === varId);
        if (!v) return;
        const current = Array.isArray(v.sharedWith) ? v.sharedWith : [];
        let newShared;
        if (shared && !current.includes(setterId)) newShared = [...current, setterId];
        else if (!shared) newShared = current.filter(id => id !== setterId);
        else newShared = current;
        await fetch(apiUrl('/api/setters/variants/' + varId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sharedWith: newShared })
        });
        loadCommandCenter();
      } catch (e) { console.error(e); alert('Error: ' + e.message); }
    };

    window._editSetter = async (setterId, currentName) => {
      if (!setterId) return;
      const newName = prompt('Nuevo nombre del setter:', currentName || '');
      if (!newName || !newName.trim() || newName.trim() === currentName) return;
      try {
        const resp = await fetch(apiUrl('/api/setters/team/' + setterId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() })
        });
        if (!resp.ok) { const err = await resp.json().catch(() => ({})); alert('Error: ' + (err.error || 'no se pudo actualizar')); return; }
        loadCommandCenter();
      } catch (e) { alert('Error: ' + e.message); }
    };

    window._saveVariantBlocks = async (varId) => {
      const variant = (variantsList || []).find(v => v.id === varId);
      if (!variant) return;
      const blocks = Array.from(document.querySelectorAll(`[data-variant-block="${varId}"]`)).map((card, index) => {
        const label = card.querySelector('[data-block-label]')?.value || '';
        const text = card.querySelector('[data-block-text]')?.value || '';
        const existing = (variant.blocks || [])[index] || {};
        return {
          id: existing.id || `block_${Date.now()}_${index}`,
          label: label.trim() || `Bloque ${index + 1}`,
          text: text.trim(),
          order: index,
          usedCount: Number(existing.usedCount) || 0,
          interestedCount: Number(existing.interestedCount) || 0,
          createdAt: existing.createdAt || new Date().toISOString()
        };
      }).filter(b => b.text);
      await fetch(apiUrl('/api/setters/variants/' + varId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks })
      });
      loadCommandCenter();
    };

    document.getElementById('create-variant-btn').addEventListener('click', async () => {
      const name = document.getElementById('new-var-name').value.trim();
      const weekLabel = document.getElementById('new-var-week').value.trim();
      const setterId = document.getElementById('new-var-setter')?.value.trim() || '';
      const blocks = draftBlocks.map((block, index) => ({
        id: block.id || `block_${Date.now()}_${index}`,
        label: block.label || `Bloque ${index + 1}`,
        text: (block.text || '').trim(),
        order: index
      })).filter((block) => block.text);
      if (!name) { alert('Poné un nombre a la variable.'); return; }
      if (blocks.length === 0) { alert('Agregá al menos un bloque con texto.'); return; }
      await fetch(apiUrl('/api/setters/variants'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, weekLabel, setterId, blocks }) });
      document.getElementById('new-var-name').value = '';
      document.getElementById('new-var-week').value = '';
      document.getElementById('new-var-setter').value = '';
      draftBlocks = [{ id: `draft_${Date.now()}`, label: 'Apertura', text: '' }];
      renderVariantEditor();
      loadVariantsModal();
    });

    // ── Enviar leads a setters desde Maps ──
    sendToSettersBtn.addEventListener('click', async () => {
      if (currentData.length === 0) return;

      // 2026-05-19: respetar los filtros visuales del usuario.
      // Antes: solo filtraba alreadyScraped, ignoraba "Solo Wsp" y
      // "Solo nuevos" — confundía porque mostraba X y enviaba Y.
      // Ahora: usa la misma lógica de filtrado que la tabla.
      let newLeads = currentData.filter(l => !l.alreadyScraped);
      const totalNuevos = newLeads.length;
      let skippedByWspFilter = 0;
      if (hideLandlinesCb && hideLandlinesCb.checked) {
        const before = newLeads.length;
        newLeads = newLeads.filter(l => (l.phone && isMobilePhone(l.phone, countrySelect.value)) || l.webWhatsApp || l.aiWhatsApp);
        skippedByWspFilter = before - newLeads.length;
      }
      const skippedOld = currentData.length - totalNuevos;

      if (newLeads.length === 0) {
        const reason = totalNuevos === 0
          ? 'Todos los ' + currentData.length + ' leads ya fueron scrapeados anteriormente.'
          : 'Los ' + totalNuevos + ' leads nuevos quedaron filtrados por "Solo Wsp". Destildá ese filtro si querés mandar también los sin WhatsApp.';
        window.showToast?.(reason, { type: 'warn', duration: 5000 });
        return;
      }

      const subtitleParts = [`${newLeads.length} leads para repartir`];
      if (skippedOld > 0) subtitleParts.push(`${skippedOld} ya scrapeados descartados`);
      if (skippedByWspFilter > 0) subtitleParts.push(`${skippedByWspFilter} sin Wsp filtrados (porque "Solo Wsp" está tildado)`);
      const subtitle = subtitleParts.join(' · ') + '. Tildá los setters destino y poné cuántos a cada uno.';

      const distribution = await window.pickSettersDistribution({
        totalLeads: newLeads.length,
        subtitle
      });
      if (!distribution || !distribution.length) return; // cancelado

      try {
        const importResp = await fetch(apiUrl('/api/setters/import'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: newLeads, distribution, batchId: window._lastScrapeBatchId || null })
        });
        if (!importResp.ok) {
          const errData = await importResp.text();
          console.error('Import error response:', importResp.status, errData);
          alert('Error al importar (' + importResp.status + '): ' + errData);
          return;
        }
        const result = await importResp.json();
        let summary = 'Total importado: ' + (result.imported || 0) + ' leads\n';
        if (result.perSetter && result.perSetter.length) {
          summary += '\nDistribucion:\n';
          result.perSetter.forEach(p => { summary += '  • ' + (p.setterName || p.setterId) + ': ' + p.imported + (p.skipped ? ' (+' + p.skipped + ' duplicados)' : '') + '\n'; });
        }
        if (result.skipped) summary += '\nYa existían en algún setter: ' + result.skipped;
        if (skippedOld > 0) summary += '\nYa scrapeados antes (no enviados): ' + skippedOld;
        alert(summary);
      } catch (e) { console.error('Import exception:', e); alert('Error al importar: ' + e.message); }
    });

    // ── Vista Llamadas (Sin WSP) — rediseño con dispositions, click-to-call, agendamiento ──
    let callsLeadsCache = [];
    // Sprint 37 (HOTSPOT-4): Map de id → lead para O(1) lookups. Se reconstruye
    // junto con el cache después de cada fetch o mutación.
    let _callsLeadsById = new Map();
    function _rebuildCallsLeadsIndex() {
      _callsLeadsById = new Map(callsLeadsCache.map(l => [l.id, l]));
    }

    function buildTelLink(phone, country) {
      if (!phone) return '';
      let digits = String(phone).replace(/\D/g, '');
      // Si no empieza con código de país, intentar agregarlo según el país del lead
      const prefixMap = { 'colombia':'57','méxico':'52','mexico':'52','argentina':'54','chile':'56','perú':'51','peru':'51','bolivia':'591','uruguay':'598','paraguay':'595','ecuador':'593','venezuela':'58','españa':'34','espana':'34','estados unidos':'1','usa':'1' };
      const c = String(country || '').toLowerCase().trim();
      if (digits.length >= 7 && digits.length <= 10 && prefixMap[c]) {
        digits = prefixMap[c] + digits;
      }
      return '+' + digits;
    }

    function fmtCountry(country) {
      const flags = { 'colombia':'🇨🇴', 'méxico':'🇲🇽', 'mexico':'🇲🇽', 'argentina':'🇦🇷', 'chile':'🇨🇱', 'perú':'🇵🇪', 'peru':'🇵🇪', 'bolivia':'🇧🇴', 'uruguay':'🇺🇾', 'paraguay':'🇵🇾', 'ecuador':'🇪🇨', 'venezuela':'🇻🇪', 'españa':'🇪🇸', 'espana':'🇪🇸', 'costa rica':'🇨🇷', 'panamá':'🇵🇦', 'panama':'🇵🇦', 'estados unidos':'🇺🇸', 'usa':'🇺🇸', 'brasil':'🇧🇷', 'brazil':'🇧🇷', 'guatemala':'🇬🇹' };
      const k = String(country || '').toLowerCase().trim();
      return flags[k] || '';
    }

    // Sprint 38: flag-icons HTML helper. Windows no renderiza emojis de bandera
    // (regional indicator codepoints). Usamos flag-icons CSS (SVG vía background)
    // que se ve idéntico en todos los OS y queda como un CRM B2B real (Apollo,
    // Close, HubSpot usan este approach).
    function countryFlagHTML(country, size = 'sm') {
      const isoMap = {
        'colombia':'co', 'méxico':'mx', 'mexico':'mx', 'argentina':'ar',
        'chile':'cl', 'perú':'pe', 'peru':'pe', 'bolivia':'bo', 'uruguay':'uy',
        'paraguay':'py', 'ecuador':'ec', 'venezuela':'ve', 'españa':'es',
        'espana':'es', 'costa rica':'cr', 'panamá':'pa', 'panama':'pa',
        'estados unidos':'us', 'usa':'us', 'brasil':'br', 'brazil':'br',
        'guatemala':'gt', 'honduras':'hn', 'nicaragua':'ni', 'el salvador':'sv',
        'república dominicana':'do', 'republica dominicana':'do',
      };
      const iso = isoMap[String(country || '').toLowerCase().trim()];
      if (!iso) return '<span style="display:inline-block; width:18px; height:13px; background:rgba(255,255,255,0.08); border-radius:2px;"></span>';
      const dims = size === 'lg' ? 'width:24px; height:18px;' : 'width:18px; height:13px;';
      return `<span class="fi fi-${iso}" style="display:inline-block; ${dims} border-radius:2px; box-shadow:0 0 0 1px rgba(0,0,0,0.15); vertical-align:middle;" aria-hidden="true"></span>`;
    }

    async function loadCallsView() {
      const setter = document.getElementById('calls-setter-select').value;
      // 2026-05-25: si el check "Incluir leads de Setteo" está activo, pedimos
      // también los leads con teléfono accionables (no solo sin_wsp).
      const includeSetteo = document.getElementById('calls-include-setteo')?.checked;
      const params = new URLSearchParams();
      if (setter) params.set('setter', setter);
      if (includeSetteo) params.set('include', 'callable');
      const qs = params.toString();
      const url = '/api/setters/leads/sin-wsp' + (qs ? '?' + qs : '');
      try {
        // Poblar select de setters (solo admin lo ve)
        const infoResp = await fetch(apiUrl('/api/setters'));
        const info = await infoResp.json();
        const callsSelect = document.getElementById('calls-setter-select');
        const curVal = callsSelect.value;
        callsSelect.innerHTML = '<option value="">Todos</option>';
        (info.setters || []).forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id; opt.textContent = s.name;
          callsSelect.appendChild(opt);
        });
        if (curVal) callsSelect.value = curVal;
        // Sprint 31: poblar también el select de bulk-assign con los mismos setters
        const bulkAssign = document.getElementById('calls-bulk-assign-setter');
        if (bulkAssign) {
          const curBulk = bulkAssign.value;
          bulkAssign.innerHTML = '<option value="">Asignar a setter…</option>';
          (info.setters || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.name;
            bulkAssign.appendChild(opt);
          });
          if (curBulk) bulkAssign.value = curBulk;
        }

        const resp = await fetch(apiUrl(url));
        const data = await resp.json();
        callsLeadsCache = data.leads || [];
        _rebuildCallsLeadsIndex();

        // Poblar filtro de país con los países presentes en los leads
        const countries = [...new Set(callsLeadsCache.map(l => (l.country || '').trim()).filter(Boolean))].sort();
        const cf = document.getElementById('calls-country-filter');
        const savedCountry = localStorage.getItem('calls_country_filter_' + (currentUser?.id || 'anon')) || '';
        const curCountry = cf.value || savedCountry;
        cf.innerHTML = '<option value="">🌎 Todos los países</option>' + countries.map(c => `<option value="${escHtml(c)}">${fmtCountry(c)} ${escHtml(c)}</option>`).join('');
        if (curCountry && countries.includes(curCountry)) cf.value = curCountry;

        // Phase 6: refrescar config Telnyx ANTES de render para que los
        // botones "Llamar" salgan como WebRTC (no como fallback `tel:`).
        // Si esta vista carga antes que la de Setteo (que también llama fetchConfig),
        // sin esto _telnyx.configured queda en false y el botón cae a tel:.
        await _telnyx.fetchConfig();

        // Sprint 21: render chips de filtro por país con count
        _callsRenderCountryChips();
        // Sprint 26: render mini-calendario de callbacks futuros
        _callsRenderCallbackAgenda();
        // Sprint 31: refresh bulk-bar (puede haber persistido selección entre views)
        _callsRenderBulkBar();
        renderCallsList();
        renderCallsStats();
        // Sprint 33: render barra de quota diaria si hay setter elegido
        _callsRenderQuota();
        // Contador "Hoy" del Power Dialer: refrescar con el callLog recién traído
        // (tras una disposition con modal, el avance optimista ocurre antes de que
        // loadCallsView traiga la nueva entry; acá se corrige el conteo).
        if (_pd?.active) _pdRenderToday();
      } catch (e) { console.error(e); }
    }

    // Sprint 26: Render agenda de próximos callbacks (próximos 14 días).
    // Agrupado por día. Click en un row → expande ese lead en la lista.
    function _callsRenderCallbackAgenda() {
      const wrap = document.getElementById('calls-callback-agenda-wrap');
      const body = document.getElementById('calls-callback-agenda-body');
      const countEl = document.getElementById('calls-callback-agenda-count');
      if (!wrap || !body) return;

      const now = Date.now();
      const horizon = now + (14 * 24 * 3600 * 1000); // próximas 2 semanas
      const items = callsLeadsCache
        .filter(l => l.callbackAt && !['descartado','agendado'].includes(l.estado))
        .map(l => ({ lead: l, ts: new Date(l.callbackAt).getTime() }))
        .filter(x => x.ts > now && x.ts <= horizon)
        .sort((a, b) => a.ts - b.ts);

      if (items.length === 0) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';
      // Audit fix Sprint 29 (bug 2): null-safe — el span puede no existir
      if (countEl) countEl.textContent = `(${items.length} próximo${items.length === 1 ? '' : 's'})`;

      // Agrupar por día (YYYY-MM-DD local)
      const todayKey = new Date().toISOString().substring(0, 10);
      const tomorrowKey = new Date(now + 86400000).toISOString().substring(0, 10);
      const groups = {};
      const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
      for (const it of items) {
        const d = new Date(it.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (!groups[key]) {
          let label;
          if (key === todayKey) label = '🔥 Hoy';
          else if (key === tomorrowKey) label = '🌞 Mañana';
          else label = `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
          groups[key] = { label, items: [] };
        }
        groups[key].items.push(it);
      }

      const sortedKeys = Object.keys(groups).sort();
      body.innerHTML = sortedKeys.map(k => {
        const g = groups[k];
        return `<div style="display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--text-tertiary); margin-top:6px;">${g.label} <span style="color:var(--text-tertiary); font-weight:500;">· ${g.items.length}</span></div>
          ${g.items.map(({ lead: l, ts }) => {
            const d = new Date(ts);
            const hour = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const overdue = ts <= now;
            const flag = fmtCountry(l.country) || '📞';
            return `<button type="button" class="cb-agenda-item" data-lead-id="${escHtml(l.id)}" style="display:grid; grid-template-columns:54px 20px 1fr auto; gap:10px; align-items:center; padding:7px 10px; background:var(--bg-app); border:1px solid var(--border-subtle); border-radius:7px; cursor:pointer; transition:all 0.15s; font-family:inherit; text-align:left;">
              <span style="font-family:ui-monospace,monospace; font-weight:600; color:${overdue ? 'var(--warning)' : 'var(--accent)'}; font-size:12.5px; font-variant-numeric:tabular-nums;">${hour}</span>
              <span style="font-size:14px;">${flag}</span>
              <span style="color:var(--text-primary); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(l.name)}${l.city ? ' · <span style=\"color:var(--text-tertiary);\">' + escHtml(l.city) + '</span>' : ''}</span>
              <span style="font-size:10px; color:var(--text-tertiary);">${overdue ? '⏰ vencido' : 'click para abrir →'}</span>
            </button>`;
          }).join('')}
        </div>`;
      }).join('');

      // Click handler — abrir el lead en la lista principal
      body.querySelectorAll('.cb-agenda-item').forEach(btn => {
        btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--accent)'; btn.style.background = 'rgba(157,133,242,0.06)'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border-subtle)'; btn.style.background = 'var(--bg-app)'; });
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-lead-id');
          // Sprint 37 (BUG-M9): null check si el lead se borró entre render y click
          const lead = _callsLeadsById.get(id);
          if (!lead) {
            window.showToast?.('Ese lead ya no existe', { type: 'warning' });
            _callsRenderCallbackAgenda();
            return;
          }
          // Limpiar filtros de país que oculten al lead
          const cf = document.getElementById('calls-country-filter');
          if (cf.value && (lead.country || '').trim() !== cf.value) {
            cf.value = '';
            try { localStorage.setItem('calls_country_filter_' + (currentUser?.id || 'anon'), ''); } catch {}
            _callsRenderCountryChips();
          }
          _callsCurrentPage = 1;
          _callsExpanded.add(id);
          _callsForceShow.add(id); // mostrarlo aunque su callback sea futuro (mañana)
          renderCallsList();
          // Scroll al row del lead
          setTimeout(() => {
            const row = document.querySelector(`.call-row[data-id="${CSS.escape(id)}"]`);
            if (row) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.style.outline = '2px solid var(--accent)';
              setTimeout(() => { row.style.outline = ''; }, 1400);
            } else {
              window.showToast?.('No pude mostrar el lead en la lista. Probá quitar filtros.', { type: 'warning', duration: 3500 });
            }
          }, 100);
        });
      });
    }

    const CALLS_PAGE_SIZE = 50;
    let _callsCurrentPage = 1;
    // Sprint 21: estado de expansión por lead (set de IDs abiertos)
    const _callsExpanded = new Set();
    // 2026-06-04: leads que se fuerzan a mostrar aunque su callback sea futuro
    // (cuando clickeás un callback de mañana en la agenda → abrirlo igual).
    const _callsForceShow = new Set();
    // Sprint 31: selección bulk (set de IDs seleccionados)
    const _callsSelected = new Set();
    function _callsRenderBulkBar() {
      const bar = document.getElementById('calls-bulk-bar');
      const countEl = document.getElementById('calls-bulk-count');
      if (!bar) return;
      const isAdmin = currentUser?.role === 'admin';
      if (!isAdmin || _callsSelected.size === 0) {
        bar.style.display = 'none';
        return;
      }
      bar.style.display = 'block';
      if (countEl) countEl.textContent = String(_callsSelected.size);
    }
    window._callsToggleSelect = function(leadId, checked) {
      if (checked) _callsSelected.add(leadId);
      else _callsSelected.delete(leadId);
      _callsRenderBulkBar();
    };

    // ─────────────────────────────────────────────────────────────
    // Sprint 34: Power Dialer — modo full-screen continuous calling
    // ─────────────────────────────────────────────────────────────
    const _pd = {
      active: false,
      queue: [],          // array de lead IDs en orden
      currentIdx: 0,
      processed: 0,
      autopilot: false,     // auto-disca el siguiente lead tras cada disposition
      autopilotArmed: false,// flag interno: el próximo render debe disparar countdown
      autopilotTimer: null, // handle del setInterval del countdown
    };
    function _pdAutopilotKey() { return 'pd_autopilot_' + (currentUser?.id || 'anon'); }
    // Cancela cualquier countdown de autopiloto pendiente y limpia el banner.
    function _pdCancelAutopilot() {
      if (_pd.autopilotTimer) { clearInterval(_pd.autopilotTimer); _pd.autopilotTimer = null; }
      const banner = document.getElementById('pd-autopilot-countdown');
      if (banner) banner.remove();
    }
    // Arranca la cuenta regresiva y, al llegar a 0, disca el lead actual.
    // Se cancela si el usuario interactúa (llamar/saltar/disposition/Esc) o
    // si ya hay una llamada Telnyx activa (panel visible).
    function _pdStartAutopilotCountdown() {
      _pdCancelAutopilot();
      const panel = document.getElementById('telnyx-call-panel');
      if (panel && panel.style.display !== 'none' && panel.style.display !== '') return; // ya hay llamada
      const lead = _callsLeadsById.get(_pd.queue[_pd.currentIdx]);
      if (!lead) return;
      let secs = 3;
      const wrap = document.getElementById('pd-current-wrap');
      if (!wrap) return;
      const banner = document.createElement('div');
      banner.id = 'pd-autopilot-countdown';
      banner.style.cssText = 'margin-top:14px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; background:linear-gradient(135deg, rgba(157,133,242,0.16) 0%, rgba(157,133,242,0.05) 100%); border:1px solid rgba(157,133,242,0.4); border-radius:12px;';
      const render = () => { banner.innerHTML = `<span style="font-size:13px; color:var(--text-primary);">🚀 Autopiloto: llamando a <strong>${escHtml(lead.name)}</strong> en <strong style="color:var(--accent); font-variant-numeric:tabular-nums;">${secs}</strong>…</span><button type="button" onclick="window._pdCancelAutopilotNow()" style="padding:7px 14px; background:transparent; border:1px solid var(--border-default); color:var(--text-secondary); border-radius:8px; cursor:pointer; font-size:12px;">Cancelar (P)</button>`; };
      render();
      wrap.appendChild(banner);
      _pd.autopilotTimer = setInterval(() => {
        secs--;
        if (secs <= 0) {
          _pdCancelAutopilot();
          window._startTelnyxCall?.(lead.id);
        } else { render(); }
      }, 1000);
    }
    window._pdCancelAutopilotNow = function() { _pdCancelAutopilot(); };
    // Refleja el estado del autopiloto en el botón del header.
    function _pdSyncAutopilotToggle() {
      const btn = document.getElementById('pd-autopilot-toggle');
      if (!btn) return;
      if (_pd.autopilot) {
        btn.style.background = 'rgba(157,133,242,0.22)';
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--text-primary)';
        btn.innerHTML = '🚀 Autopiloto: ON';
        btn.title = 'Auto-disca el siguiente lead tras cada resultado. Click o tecla A para apagar.';
      } else {
        btn.style.background = 'transparent';
        btn.style.borderColor = 'rgba(255,255,255,0.15)';
        btn.style.color = 'var(--text-secondary)';
        btn.innerHTML = '🚀 Autopiloto: OFF';
        btn.title = 'Marcá un resultado y discás manualmente. Click o tecla A para encender el discado continuo.';
      }
    }
    window._pdToggleAutopilot = function() {
      _pd.autopilot = !_pd.autopilot;
      localStorage.setItem(_pdAutopilotKey(), _pd.autopilot ? '1' : '0');
      _pdSyncAutopilotToggle();
      if (!_pd.autopilot) _pdCancelAutopilot();
      window.showToast?.(_pd.autopilot ? 'Autopiloto encendido · discado continuo' : 'Autopiloto apagado', { type: _pd.autopilot ? 'success' : 'info', duration: 1800 });
    };
    function _pdBuildQueue() {
      // Tomar los leads visibles según los filtros actuales, sort actual,
      // EXCLUYENDO descartados/agendados/callbacks futuros — esos no se quieren llamar ahora.
      const country = document.getElementById('calls-country-filter')?.value || '';
      const search = (document.getElementById('calls-search')?.value || '').toLowerCase().trim();
      const sortMode = document.getElementById('calls-sort-select')?.value || 'never_called';
      const now = Date.now();
      let leads = callsLeadsCache.slice();
      if (country) leads = leads.filter(l => (l.country || '').trim() === country);
      if (search) leads = leads.filter(l => (
        // Audit Sprint 37: matchear universalmente como el buscador de Setteo
        // (nombre, teléfono, país, ciudad, doctor, dirección, email, website).
        (l.name || '').toLowerCase().includes(search) ||
        (l.phone || '').toLowerCase().includes(search) ||
        (l.city || '').toLowerCase().includes(search) ||
        (l.country || '').toLowerCase().includes(search) ||
        (l.doctor || '').toLowerCase().includes(search) ||
        (l.address || '').toLowerCase().includes(search) ||
        (l.email || '').toLowerCase().includes(search) ||
        (l.website || '').toLowerCase().includes(search)
      ));
      leads = leads.filter(l => !['descartado','agendado'].includes(l.estado));
      leads = leads.filter(l => !l.callbackAt || new Date(l.callbackAt).getTime() <= now);
      // Sort: usar el actual de Llamadas para consistencia
      switch (sortMode) {
        case 'recent':       leads.sort((a, b) => new Date(b.importedAt || 0) - new Date(a.importedAt || 0)); break;
        case 'oldest':       leads.sort((a, b) => new Date(a.importedAt || 0) - new Date(b.importedAt || 0)); break;
        case 'country':      leads.sort((a, b) => (a.country || '').localeCompare(b.country || '')); break;
        case 'attempts_desc':leads.sort((a, b) => (b.callAttempts || 0) - (a.callAttempts || 0)); break;
        case 'attempts_asc': leads.sort((a, b) => (a.callAttempts || 0) - (b.callAttempts || 0)); break;
        case 'last_call':    leads.sort((a, b) => _callsLastCallTs(b) - _callsLastCallTs(a)); break;
        default:             leads.sort((a, b) => (a.callAttempts || 0) - (b.callAttempts || 0)
                                || new Date(a.importedAt || 0) - new Date(b.importedAt || 0)
                                || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
      return leads.map(l => l.id);
    }
    window._pdStart = function() {
      if (callsLeadsCache.length === 0) {
        window.showToast?.('No hay leads cargados en Llamadas', { type: 'warning' });
        return;
      }
      _pd.queue = _pdBuildQueue();
      if (_pd.queue.length === 0) {
        window.showToast?.('No hay leads accionables con los filtros actuales', { type: 'warning' });
        return;
      }
      _pd.currentIdx = 0;
      _pd.processed = 0;
      _pd.active = true;
      _pd.autopilot = localStorage.getItem(_pdAutopilotKey()) === '1';
      _pd.autopilotArmed = false; // no auto-discar el primer lead al abrir
      _pdSyncAutopilotToggle();
      document.getElementById('power-dialer').style.display = 'block';
      document.body.style.overflow = 'hidden';
      _pdRender();
      window.showToast?.(`Power dialer activado · ${_pd.queue.length} leads en cola`, { type: 'success', duration: 2500 });
    };
    window._pdExit = function() {
      // Sprint 37 (BUG-A2): si hay una llamada Telnyx activa, pedir confirm
      // antes de salir — sino la llamada queda "huérfana" sin panel visible.
      if (_telnyx?.activeCall) {
        if (!confirm('Hay una llamada activa. ¿Salir del power dialer? La llamada se va a colgar.')) return;
        try { _telnyx.activeCall.hangup?.(); } catch {}
      }
      _pdCancelAutopilot();
      _pd.active = false;
      document.getElementById('power-dialer').style.display = 'none';
      document.body.style.overflow = '';
      // Refrescar lista de Llamadas para que se actualicen los counts
      loadCallsView();
    };
    // Audit fix Sprint 36 + 37 (HOTSPOT-8): event delegation en lugar de
    // attachar listener por cada menu-item. Previene listener leak si el
    // sidebar se re-renderiza y garantiza idempotencia. Solo se registra
    // 1 vez en TODA la app vida.
    if (!window.__pdSidebarDelegateRegistered) {
      window.__pdSidebarDelegateRegistered = true;
      document.addEventListener('click', (e) => {
        if (e.target?.closest?.('.menu-item[data-target]') && _pd.active) {
          window._pdExit();
        }
      });
    }
    // Contador del día: deriva de callLog real (no de un contador suelto que se
    // pierde al recargar). Cuenta cada entry de hoy en la cola visible. "Hoy" =
    // desde las 00:00 hora local. interesados/agendados = outcomes valiosos.
    function _pdTodayStats() {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const startMs = start.getTime();
      // conversations = atendieron y hablaste (no cuenta no_answer/voicemail/
      // número malo ni "me cortó"). Es la métrica de calidad junto al volumen.
      const CONVO = new Set(['answered_interested', 'answered_not_interested', 'scheduled_with_admin']);
      let dials = 0, conversations = 0, interesados = 0, agendados = 0;
      for (const l of callsLeadsCache) {
        if (!Array.isArray(l.callLog)) continue;
        for (const e of l.callLog) {
          const t = new Date(e.ts).getTime();
          if (isNaN(t) || t < startMs) continue;
          dials++;
          if (CONVO.has(e.outcome)) conversations++;
          if (e.outcome === 'answered_interested') interesados++;
          else if (e.outcome === 'scheduled_with_admin') agendados++;
        }
      }
      return { dials, conversations, interesados, agendados };
    }
    // Objetivo diario de llamadas, persistido por usuario en localStorage.
    function _pdGoalKey() { return 'pd_daily_goal_' + (currentUser?.id || 'anon'); }
    function _pdGetGoal() { const v = parseInt(localStorage.getItem(_pdGoalKey()), 10); return (v && v > 0) ? v : 10; }
    window._pdEditGoal = function() {
      const cur = _pdGetGoal();
      const ans = prompt('¿Cuál es tu objetivo de llamadas para hoy?', cur);
      if (ans === null) return; // canceló
      const n = parseInt(ans, 10);
      if (!n || n <= 0) { alert('Poné un número mayor a 0.'); return; }
      localStorage.setItem(_pdGoalKey(), String(n));
      _pdRenderToday();
    };
    function _pdRenderToday() {
      const el = document.getElementById('pd-today');
      if (!el) return;
      const s = _pdTodayStats();
      const goal = _pdGetGoal();
      const done = s.dials >= goal;
      const pct = Math.min(100, Math.round((s.dials / goal) * 100));
      const labelEl = document.getElementById('pd-today-label');
      const barEl = document.getElementById('pd-today-bar');
      if (labelEl) labelEl.textContent = `🎯 ${s.dials} / ${goal}${done ? ' ✓' : ''}`;
      if (barEl) { barEl.style.width = pct + '%'; barEl.style.background = done ? '#5BB974' : 'var(--accent)'; }
      const convosEl = document.getElementById('pd-today-convos');
      if (convosEl) convosEl.textContent = `💬 ${s.conversations}`;
      // El chip se pone verde al cumplir la meta.
      el.style.borderColor = done ? 'rgba(91,185,116,0.6)' : 'rgba(157,133,242,0.35)';
      el.style.background = done ? 'rgba(91,185,116,0.14)' : 'rgba(157,133,242,0.12)';
      el.title = `Objetivo de hoy: ${goal} llamadas (click para cambiar) · Llevás ${s.dials}`
        + (s.interesados ? ` · ${s.interesados} interesados` : '')
        + (s.agendados ? ` · ${s.agendados} agendados` : '');
    }
    window._pdRenderToday = _pdRenderToday;

    function _pdAdvance() {
      _pdCancelAutopilot();
      _pd.autopilotArmed = _pd.autopilot; // el próximo render dispara el countdown
      _pd.currentIdx++;
      _pd.processed++;
      if (_pd.currentIdx >= _pd.queue.length) {
        // Fin de cola
        document.getElementById('pd-current-content').innerHTML = `<div style="text-align:center; padding:40px 20px;">
          <div style="font-size:48px; margin-bottom:18px;">🎉</div>
          <h2 style="margin:0 0 8px;">¡Cola completa!</h2>
          <p style="color:var(--text-secondary); margin:0 0 24px;">Procesaste ${_pd.processed} leads en esta sesión.</p>
          <button onclick="window._pdExit()" class="btn-primary pill-btn">Salir</button>
        </div>`;
        document.getElementById('pd-queue').innerHTML = '';
        document.getElementById('pd-progress').textContent = `${_pd.processed} procesadas · completado`;
        return;
      }
      _pdRender();
    }
    function _pdRender() {
      _pdCancelAutopilot(); // limpiar countdown previo antes de re-renderizar
      _pdRenderToday();
      const currentId = _pd.queue[_pd.currentIdx];
      const lead = _callsLeadsById.get(currentId);
      if (!lead) { _pdAdvance(); return; }
      if (['descartado','agendado'].includes(lead.estado)) { _pdAdvance(); return; }
      if (lead.callbackAt && new Date(lead.callbackAt).getTime() > Date.now()) { _pdAdvance(); return; }

      const flagHTML = lead.country ? countryFlagHTML(lead.country, 'lg') : '';
      const attempts = lead.callAttempts || 0;
      const callLog = Array.isArray(lead.callLog) ? lead.callLog : [];
      const lastCalls = callLog.slice(-3).reverse();
      const interesado = lead.estado === 'interesado';
      const notesCount = Array.isArray(lead.notes) ? lead.notes.length : 0;
      const lastNote = notesCount > 0 ? lead.notes[lead.notes.length - 1] : null;

      // Sprint 39: helpers para link safe + display de URL
      const safeW = safeUrl(lead.website || '');
      const websiteDisplay = safeW ? safeW.replace(/^https?:\/\//, '').replace(/\/$/, '').substring(0, 50) : '';
      const safeEmail = String(lead.email || '').trim();
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail);
      const igRaw = String(lead.instagram || '').trim();
      const igUrl = igRaw ? (igRaw.startsWith('http') ? safeUrl(igRaw) : 'https://instagram.com/' + igRaw.replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '')) : '';
      const fbRaw = String(lead.facebook || '').trim();
      const fbUrl = fbRaw ? (fbRaw.startsWith('http') ? safeUrl(fbRaw) : 'https://facebook.com/' + fbRaw.replace(/[^a-zA-Z0-9_.\-]/g, '')) : '';
      const mapsQ = encodeURIComponent(`${lead.name} ${lead.city || ''} ${lead.country || ''}`.trim());
      const mapsUrl = lead.name ? `https://www.google.com/maps/search/?api=1&query=${mapsQ}` : '';

      // Construir grid de info enriquecida (solo mostrar los que tienen data).
      // Sin emojis — labels limpios estilo B2B prospecting CRM.
      const infoRows = [];
      if (lead.doctor && !lead.doctor.includes('N/A')) infoRows.push({ label: 'Doctor', value: escHtml(lead.doctor) });
      if (lead.decisor) infoRows.push({ label: 'Decisor', value: escHtml(lead.decisor) });
      if (lead.address) infoRows.push({ label: 'Dirección', value: escHtml(lead.address) });
      if (safeW) infoRows.push({ label: 'Web', value: `<a href="${escHtml(safeW)}" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc; text-decoration:none;">${escHtml(websiteDisplay)}</a>` });
      if (validEmail) infoRows.push({ label: 'Email', value: `<a href="mailto:${escHtml(safeEmail)}" style="color:#7dd3fc; text-decoration:none;">${escHtml(safeEmail)}</a>` });
      if (igUrl) infoRows.push({ label: 'Instagram', value: `<a href="${escHtml(igUrl)}" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc; text-decoration:none;">${escHtml(igRaw)}</a>` });
      if (fbUrl) infoRows.push({ label: 'Facebook', value: `<a href="${escHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc; text-decoration:none;">Perfil</a>` });
      if (lead.aiRole && !lead.aiRole.includes('N/A')) infoRows.push({ label: 'Rol (IA)', value: escHtml(lead.aiRole) });
      if (lead.aiWhatsApp && !lead.aiWhatsApp.includes('N/A')) infoRows.push({ label: 'WSP (IA)', value: escHtml(lead.aiWhatsApp) });
      if (lead.aiDescription || lead.aiResumen) infoRows.push({ label: 'Resumen (IA)', value: escHtml(lead.aiDescription || lead.aiResumen).substring(0, 280) });
      if (lead.linkedin) infoRows.push({ label: 'LinkedIn', value: `<a href="${escHtml(safeUrl(lead.linkedin) || '#')}" target="_blank" rel="noopener noreferrer" style="color:#7dd3fc; text-decoration:none;">Perfil</a>` });
      if (lead.importedAt) infoRows.push({ label: 'Importado', value: new Date(lead.importedAt).toLocaleDateString('es-AR') });

      // Power Dialer 2026-05-23: bloque de follow-up activo. Calcula step tildado,
      // due date, status (programado/vence ahora/vencido) y permite marcar hecho
      // sin salir del dialer. Mismo modelo que _renderModalFollowups del lead modal.
      const _PD_FU_STEPS = {
        '24hs': { label: '24 horas', deltaMs: 24 * 3600 * 1000 },
        '48hs': { label: '48 horas', deltaMs: 48 * 3600 * 1000 },
        '72hs': { label: '72 horas', deltaMs: 72 * 3600 * 1000 },
        '7d':   { label: '7 días',   deltaMs: 7 * 24 * 3600 * 1000 },
        '15d':  { label: '15 días',  deltaMs: 15 * 24 * 3600 * 1000 },
      };
      const _pdFu = lead.followUps || {};
      const _pdFuActive = Object.keys(_PD_FU_STEPS).find(k => _pdFu[k] === true);
      const _pdFuNote = lead.followUpNotes && _pdFuActive ? String(lead.followUpNotes[_pdFuActive] || '').trim() : '';
      let _pdFuBlock = '';
      if (_pdFuActive) {
        const _pdFuStarted = lead.followUpStartedAt
          ? new Date(lead.followUpStartedAt).getTime()
          : (lead.lastContactAt ? new Date(lead.lastContactAt).getTime() : 0);
        if (_pdFuStarted) {
          const _pdFuOverride = lead.followUpDueOverrides && lead.followUpDueOverrides[_pdFuActive];
          const _pdFuDue = _pdFuOverride
            ? new Date(_pdFuOverride).getTime()
            : (_pdFuStarted + _PD_FU_STEPS[_pdFuActive].deltaMs);
          const _now = Date.now();
          const _d = new Date(_pdFuDue);
          const _today0 = new Date(); _today0.setHours(0,0,0,0);
          const _tomorrow0 = _today0.getTime() + 24 * 3600 * 1000;
          const _yesterday0 = _today0.getTime() - 24 * 3600 * 1000;
          const _dayStart = new Date(_d); _dayStart.setHours(0,0,0,0);
          let _when;
          if (_dayStart.getTime() === _today0.getTime()) _when = 'Hoy ' + _d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          else if (_dayStart.getTime() === _yesterday0) _when = 'Ayer ' + _d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          else if (_dayStart.getTime() === _tomorrow0) _when = 'Mañana ' + _d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          else _when = _d.toLocaleDateString('es-AR') + ' ' + _d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          let _statusLabel, _statusColor, _bgGradient, _borderColor;
          if (_pdFuDue > _now + 12 * 3600 * 1000) {
            _statusLabel = 'Programado'; _statusColor = 'var(--accent)';
            _bgGradient = 'linear-gradient(135deg, rgba(157,133,242,0.10) 0%, rgba(157,133,242,0.03) 100%)';
            _borderColor = 'rgba(157,133,242,0.32)';
          } else if (_pdFuDue >= _now - 12 * 3600 * 1000) {
            _statusLabel = 'Vence ahora'; _statusColor = '#5bb974';
            _bgGradient = 'linear-gradient(135deg, rgba(91,185,116,0.12) 0%, rgba(91,185,116,0.03) 100%)';
            _borderColor = 'rgba(91,185,116,0.38)';
          } else if (_pdFuDue >= _now - 36 * 3600 * 1000) {
            _statusLabel = 'Vencido ayer'; _statusColor = '#ff8a3d';
            _bgGradient = 'linear-gradient(135deg, rgba(255,138,61,0.12) 0%, rgba(255,138,61,0.03) 100%)';
            _borderColor = 'rgba(255,138,61,0.38)';
          } else {
            _statusLabel = 'Atrasado'; _statusColor = '#f85149';
            _bgGradient = 'linear-gradient(135deg, rgba(248,81,73,0.12) 0%, rgba(248,81,73,0.03) 100%)';
            _borderColor = 'rgba(248,81,73,0.38)';
          }

          _pdFuBlock = `<div style="margin-top:18px; background:${_bgGradient}; border:1px solid ${_borderColor}; border-left:3px solid ${_statusColor}; padding:14px 16px; border-radius:10px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
                <span style="font-size:18px;">📅</span>
                <div style="min-width:0;">
                  <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:${_statusColor};">Follow-up · ${_PD_FU_STEPS[_pdFuActive].label}</div>
                  <div style="font-size:13.5px; color:var(--text-primary); margin-top:3px;">
                    <strong style="color:${_statusColor};">${_statusLabel}</strong>
                    <span style="color:var(--text-secondary); margin-left:6px;">· vence ${_when}</span>
                  </div>
                  ${_pdFuNote ? `<div style="font-size:11.5px; color:var(--text-secondary); margin-top:6px; padding:6px 9px; background:rgba(255,255,255,0.04); border-radius:6px; line-height:1.4; white-space:pre-wrap;">${escHtml(_pdFuNote)}</div>` : ''}
                </div>
              </div>
              <button type="button" onclick="window._pdMarkFollowupDone('${escHtml(lead.id)}', '${_pdFuActive}')" style="padding:8px 14px; background:rgba(91,185,116,0.18); color:#5bb974; border:1px solid rgba(91,185,116,0.4); border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;">✓ Marcar hecho</button>
            </div>
          </div>`;
        }
      }

      const main = document.getElementById('pd-current-content');
      main.innerHTML = `
      <!-- Bloque 1: Header del lead + acciones primarias -->
      <div style="display:grid; grid-template-columns:auto 1fr auto; gap:22px; align-items:flex-start; padding-bottom:18px; border-bottom:1px solid var(--border-subtle);">
        <div style="display:flex; align-items:center; justify-content:center; width:54px; height:54px; background:var(--bg-app); border:1px solid var(--border-subtle); border-radius:14px;">${flagHTML || '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'}</div>
        <div style="min-width:0;">
          <h2 style="margin:0 0 4px; font-size:24px; font-weight:700; letter-spacing:-0.01em; line-height:1.2;">${escHtml(lead.name)}</h2>
          <div style="color:var(--text-secondary); font-size:13px;">
            ${escHtml(lead.city || '')}${lead.city && lead.country ? ' · ' : ''}${escHtml(lead.country || '')}
          </div>
          <div style="margin-top:8px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
            <span style="font-family:ui-monospace,monospace; font-size:17px; color:var(--accent); font-weight:600; letter-spacing:0.02em;">${escHtml(lead.phone)}</span>
            <span id="pd-rate-badge" data-phone="${escHtml(lead.phone)}" style="font-size:11px; color:var(--text-tertiary); font-family:ui-monospace,monospace;">·</span>
          </div>
          <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;">
            ${attempts > 0 ? `<span style="font-size:10.5px; color:var(--text-tertiary); background:var(--bg-input); padding:3px 9px; border-radius:6px; font-weight:500;">${attempts} intento${attempts>1?'s':''}</span>` : '<span style="font-size:10.5px; color:var(--success); background:rgba(91,185,116,0.1); padding:3px 9px; border-radius:6px; font-weight:600;">🆕 Nunca llamado</span>'}
            ${interesado ? '<span style="background:rgba(91,185,116,0.18); color:var(--success); padding:3px 9px; border-radius:6px; font-size:10.5px; font-weight:700;">✓ INTERESADO</span>' : ''}
            ${lead.rating ? `<span style="font-size:10.5px; color:#FFB341; background:rgba(255,179,65,0.1); padding:3px 9px; border-radius:6px; font-weight:600;">★ ${escHtml(String(lead.rating))}${lead.reviews ? ' · ' + lead.reviews + ' reseñas' : ''}</span>` : ''}
            ${lead.phoneStatus === 'voicemail' ? '<span style="font-size:10.5px; color:#FFB341; background:rgba(255,179,65,0.12); padding:3px 9px; border-radius:6px;">📭 buzón</span>' : ''}
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:9px; min-width:200px;">
          <button onclick="window._startTelnyxCall('${escHtml(lead.id)}')" style="padding:16px 22px; font-size:16px; font-weight:700; background:var(--success); color:#0F1115; border:none; border-radius:12px; cursor:pointer; box-shadow:0 6px 22px rgba(91,185,116,0.32); display:flex; align-items:center; justify-content:center; gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>Llamar</span>
            <kbd style="font-family:ui-monospace,monospace; font-size:11px; padding:1px 5px; background:rgba(15,17,21,0.18); border:1px solid rgba(15,17,21,0.25); border-radius:4px; margin-left:4px;">C</kbd>
          </button>
          <button onclick="window._pdSkip()" style="padding:9px 18px; background:transparent; border:1px solid var(--border-default); color:var(--text-secondary); border-radius:10px; cursor:pointer; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:6px;">
            <span>Saltar</span>
            <kbd style="font-family:ui-monospace,monospace; font-size:10px; padding:1px 5px; background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:4px;">S</kbd>
          </button>
        </div>
      </div>

      <!-- Bloque 2: Pre-call note destacada (si existe) — sin emoji, label limpio -->
      ${lead.precallNote && lead.precallNote.trim() ? `<div style="margin-top:16px; background:linear-gradient(135deg, rgba(255,179,65,0.10) 0%, rgba(255,179,65,0.03) 100%); border:1px solid rgba(255,179,65,0.32); border-left:3px solid #FFB341; padding:12px 14px; border-radius:10px;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#FFB341; margin-bottom:5px;">Pre-call · qué decir</div>
        <div style="color:#fff; font-size:13.5px; line-height:1.55; white-space:pre-wrap;">${escHtml(lead.precallNote)}</div>
      </div>` : ''}

      <!-- Bloque 3: Grid de info enriquecida (scraping + IA) — sin emojis, B2B clean -->
      ${infoRows.length > 0 ? `<div style="margin-top:18px;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); margin-bottom:10px;">Ficha del lead · scraping + IA</div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:9px;">
          ${infoRows.map(r => `<div style="display:grid; grid-template-columns:90px 1fr; gap:10px; align-items:center; padding:8px 12px; background:var(--bg-app); border:1px solid var(--border-subtle); border-left:2px solid var(--accent); border-radius:7px; font-size:12.5px;">
            <span style="color:var(--text-tertiary); font-size:10.5px; text-transform:uppercase; letter-spacing:0.3px; font-weight:600;">${r.label}</span>
            <span style="color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; word-break:break-word;">${r.value}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- Bloque 4: Quick-links acción — sin emojis, look uniforme outline -->
      ${(mapsUrl || safeW || igUrl || validEmail || lead.whatsappUrl) ? `<div style="margin-top:14px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
        ${mapsUrl ? `<a href="${escHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" class="pd-quick-link">Maps</a>` : ''}
        ${safeW ? `<a href="${escHtml(safeW)}" target="_blank" rel="noopener noreferrer" class="pd-quick-link">Sitio web</a>` : ''}
        ${igUrl ? `<a href="${escHtml(igUrl)}" target="_blank" rel="noopener noreferrer" class="pd-quick-link">Instagram</a>` : ''}
        ${validEmail ? `<a href="mailto:${escHtml(safeEmail)}" class="pd-quick-link">Email</a>` : ''}
        ${lead.whatsappUrl ? `<a href="${escHtml(safeUrl(lead.whatsappUrl) || '#')}" target="_blank" rel="noopener noreferrer" class="pd-quick-link" onclick="return window._waBtnClick(this, event, '${escHtml(lead.id)}');">WhatsApp</a>` : ''}
        <button type="button" onclick="window.openPlaceholderModal('${escHtml(lead.id)}')" class="pd-quick-link" style="cursor:pointer; background:transparent; font-family:inherit;" title="Mandar invitación tentativa de calendario por mail">📅 Hold</button>
        ${lead.placeholderSentAt ? `<span style="font-size:10px; color:#5bb974; padding:3px 8px; border:1px solid rgba(91,185,116,0.25); border-radius:6px;">📧 hold enviado</span>` : ''}
      </div>` : ''}

      <!-- Bloque 5: Histórico + última nota — sin emojis, dots de color como cue -->
      ${(lastCalls.length > 0 || lastNote) ? `<div style="margin-top:18px; display:grid; grid-template-columns:${lastCalls.length > 0 && lastNote ? '1fr 1fr' : '1fr'}; gap:14px;">
        ${lastCalls.length > 0 ? `<div>
          <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); margin-bottom:8px;">Últimas ${lastCalls.length} llamada${lastCalls.length>1?'s':''}</div>
          <div style="display:flex; flex-direction:column; gap:5px;">
            ${lastCalls.map(entry => {
              // Dot de color por outcome — más sobrio que emoji
              const dotColor = ({ answered_interested:'#5BB974', answered_not_interested:'#F47272', no_answer:'#888', voicemail:'#FFB341', wrong_number:'#888', invalid_number:'#888', callback_later:'#5BA3F2', scheduled_with_admin:'var(--accent)', hung_up:'#F47272', placeholder_sent:'#7DD3FC' })[entry.outcome] || '#888';
              const t = entry.ts ? new Date(entry.ts).toLocaleString('es-AR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
              // Costo: real (reconciliado de CDR) si existe, sino estimado.
              let costStr = '';
              if (typeof entry.realCost === 'number') costStr = `<span title="costo real facturado por Telnyx" style="color:#ffc828;">$${entry.realCost.toFixed(4)} real</span>`;
              else if (typeof entry.cost === 'number' && entry.cost > 0) costStr = `<span title="costo estimado (tabla local)" style="color:var(--text-tertiary);">~$${entry.cost.toFixed(4)}</span>`;
              return `<div style="display:grid; grid-template-columns:8px 1fr auto; gap:10px; align-items:center; padding:8px 12px; background:var(--bg-app); border:1px solid var(--border-subtle); border-radius:7px; font-size:11.5px;">
                <span style="width:8px; height:8px; border-radius:50%; background:${dotColor};"></span>
                <span style="color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(callOutcomeLabel(entry.outcome).replace(/^[^\w]+\s*/, ''))}${entry.notes ? ' · ' + escHtml(String(entry.notes).substring(0,40)) : ''}</span>
                <span style="color:var(--text-tertiary); font-variant-numeric:tabular-nums; font-size:10.5px; display:flex; gap:8px; align-items:center;">${costStr}${t}</span>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
        ${lastNote ? `<div>
          <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); margin-bottom:8px;">Última nota · ${notesCount} total</div>
          <div style="padding:10px 13px; background:var(--bg-app); border:1px solid var(--border-subtle); border-left:3px solid var(--accent); border-radius:8px; font-size:12px; line-height:1.5;">
            <div style="color:var(--text-primary); white-space:pre-wrap;">${escHtml(String(lastNote.text || '').substring(0, 300))}</div>
            <div style="font-size:10px; color:var(--text-tertiary); margin-top:6px;">${escHtml(lastNote.by || '')} · ${lastNote.date ? new Date(lastNote.date).toLocaleString('es-AR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : ''}</div>
          </div>
        </div>` : ''}
      </div>` : ''}

      <!-- Bloque 5.5: Follow-up activo (si el lead tiene uno tildado) -->
      ${_pdFuBlock}

      <!-- Bloque 6: Disposition — grid sin emojis, barra de color como cue visual -->
      <div style="margin-top:18px;">
        <div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-tertiary); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
          <span>Resultado de la llamada</span>
          <span style="color:var(--text-tertiary); font-weight:500; text-transform:none; letter-spacing:0;">atajos numéricos 1-8</span>
        </div>
        <input id="pd-call-note" type="text" maxlength="500" placeholder="Nota de esta llamada (opcional) — ej: contestó la secre, pedir por Dr. X el martes" style="width:100%; box-sizing:border-box; padding:9px 12px; margin-bottom:10px; border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-app); color:var(--text-primary); font-size:12.5px; font-family:inherit;">
        <div class="pd-disposition-grid">
          ${[
            { v:'answered_interested',     k:'1', label:'Interesado',      sub:'abre agenda ahora',   color:'success' },
            { v:'answered_not_interested', k:'2', label:'No interesado',   sub:'escuchó y dijo no',   color:'danger'  },
            { v:'hung_up',                 k:'3', label:'Me cortó',        sub:'atendió y colgó',     color:'danger'  },
            { v:'no_answer',               k:'4', label:'No atendió',      sub:'sonó, sin respuesta', color:'neutral' },
            { v:'voicemail',               k:'5', label:'Buzón',           sub:'voice mail',          color:'warning' },
            { v:'callback_later',          k:'6', label:'Volver a llamar', sub:'agenda callback',     color:'info'    },
            { v:'wrong_number',            k:'7', label:'Equivocado',      sub:'no es este número',   color:'neutral' },
            { v:'invalid_number',          k:'8', label:'No existe',       sub:'inválido / desact.',  color:'neutral' }
          ].map(d => `<button type="button" class="pd-disp-btn pd-disp-${d.color}" onclick="window._pdHandleDispositionDirect('${escHtml(lead.id)}', '${d.v}')">
            <div class="pd-disp-key">${d.k}</div>
            <div class="pd-disp-text">
              <div class="pd-disp-label">${d.label}</div>
              <div class="pd-disp-sub">${d.sub}</div>
            </div>
          </button>`).join('')}
        </div>
      </div>`;

      // Cola siguiente (próximos 5) — Sprint 39: flag-icons + más info contextual
      const queue = document.getElementById('pd-queue');
      const upcoming = _pd.queue.slice(_pd.currentIdx + 1, _pd.currentIdx + 6);
      queue.innerHTML = upcoming.map((id, i) => {
        const l = _callsLeadsById.get(id);
        if (!l) return '';
        const f = l.country ? countryFlagHTML(l.country) : '';
        const att = l.callAttempts || 0;
        return `<div style="display:grid; grid-template-columns:32px 22px 1fr auto auto; gap:10px; align-items:center; padding:9px 13px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; font-size:12.5px;">
          <span style="color:var(--text-tertiary); font-variant-numeric:tabular-nums; font-weight:500;">${i + 2}.</span>
          <span style="display:flex; align-items:center;">${f}</span>
          <span style="color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(l.name)}${l.city ? ' <span style="color:var(--text-tertiary);">· ' + escHtml(l.city) + '</span>' : ''}${l.doctor && !l.doctor.includes('N/A') ? ' <span style="color:var(--text-tertiary); font-size:11px;">· ' + escHtml(l.doctor) + '</span>' : ''}</span>
          ${att > 0 ? `<span style="font-size:10px; color:var(--text-tertiary); background:var(--bg-app); padding:1px 6px; border-radius:5px;">${att} int</span>` : ''}
          <span style="color:var(--text-tertiary); font-family:ui-monospace,monospace; font-size:11px;">${escHtml(l.phone)}</span>
        </div>`;
      }).join('');

      document.getElementById('pd-progress').textContent = `${_pd.currentIdx + 1} / ${_pd.queue.length} · ${_pd.processed} procesadas`;

      // Badge de tarifa real Telnyx por prefijo. Async para no bloquear el render.
      // Cache por número así no re-fetcheamos en cada re-render del PD.
      const badge = document.getElementById('pd-rate-badge');
      if (badge && lead.phone) {
        _pdFetchRate(lead.phone).then(r => {
          // Solo actualizar si el badge sigue apuntando a este mismo número
          // (puede haber cambiado el lead activo si el setter avanzó rapido)
          if (!badge.isConnected || badge.dataset.phone !== lead.phone) return;
          if (r && r.found) {
            const moneda = '$' + r.ratePerMin.toFixed(4);
            const tipo = r.isMobile ? 'móvil' : 'fijo';
            badge.style.color = r.ratePerMin > 0.10 ? '#F47272' : (r.ratePerMin > 0.05 ? '#FFB341' : '#5BB974');
            badge.innerHTML = `<span title="Tarifa real Telnyx (prefijo ${r.matchedPrefix})">${moneda}/min · ${r.country} ${tipo}</span>`;
          } else {
            badge.style.color = 'var(--text-tertiary)';
            badge.textContent = '· tarifa s/d';
          }
        }).catch(() => {});
      }

      // Autopiloto: si venimos de un advance con autopiloto encendido, arrancar
      // la cuenta regresiva para discar este lead automáticamente.
      if (_pd.autopilotArmed) {
        _pd.autopilotArmed = false;
        _pdStartAutopilotCountdown();
      }
    }
    // Cache de tarifas por número durante la sesión del PD
    const _pdRateCache = new Map();
    async function _pdFetchRate(phone) {
      if (_pdRateCache.has(phone)) return _pdRateCache.get(phone);
      try {
        const r = await fetch(apiUrl('/api/telnyx/rate?phone=' + encodeURIComponent(phone)), { credentials: 'include' });
        if (!r.ok) { _pdRateCache.set(phone, null); return null; }
        const j = await r.json();
        _pdRateCache.set(phone, j);
        return j;
      } catch { return null; }
    }
    window._pdSkip = function() { _pdAdvance(); };
    window._pdAdvance = _pdAdvance;

    // Power Dialer 2026-05-23: marca un follow-up como hecho desde el dialer.
    // PATCH al lead destildando el step + actualiza cache local + re-renderea.
    // NO avanza automaticamente — el setter puede querer llamar igual despues
    // de marcar el follow-up como hecho.
    window._pdMarkFollowupDone = async function(leadId, stepKey) {
      const lead = _callsLeadsById.get(leadId);
      if (!lead) return;
      const prev = { ...(lead.followUps || {}) };
      const next = { ...prev, [stepKey]: false };
      try {
        const r = await fetch(apiUrl(`/api/setters/leads/${encodeURIComponent(leadId)}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ followUps: next }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        // Refrescar lead en cache local con la respuesta del server
        if (data && data.lead) {
          _callsLeadsById.set(leadId, data.lead);
        } else {
          lead.followUps = next;
        }
        window.showToast?.('Follow-up marcado como hecho ✓', { type: 'success' });
        _pdRender();
      } catch (err) {
        window.showToast?.('No pude marcar el follow-up: ' + err.message, { type: 'error' });
      }
    };

    // Sprint 39 — Handler para botones directos del power dialer.
    // Crea un select virtual con el value seleccionado y delega a _pdHandleDisposition.
    window._pdHandleDispositionDirect = function(leadId, outcome) {
      if (!outcome) return;
      const fake = { value: outcome, disabled: false };
      window._pdHandleDisposition(leadId, fake);
    };

    // Audit fix Sprint 36 (bug 1): handler de disposition específico al power
    // dialer. Para outcomes que ABREN modal (callback_later, scheduled_with_admin,
    // answered_not_interested), NO auto-avanzar — el modal define el flow y al
    // cerrarse exitosamente _handleCallDisposition ya refresca _callsLeadsCache.
    // El advance lo dispara el botón explícito del usuario cuando vuelve.
    window._pdHandleDisposition = async function(leadId, selectEl) {
      const outcome = selectEl?.value;
      if (!outcome) return;
      const modalOpening = ['callback_later','scheduled_with_admin','answered_not_interested','answered_interested'].includes(outcome);
      await window._handleCallDisposition(leadId, selectEl);
      // Audit fix Sprint 37 (BUG-A1): garantizar select usable después del flow
      // (el handler base lo deshabilita y solo lo limpia en algunos branches).
      if (selectEl) { selectEl.disabled = false; selectEl.value = ''; }
      // Esperar a que se cierre el modal (si abrió uno) — chequear cada 300ms
      // hasta 30s. Si el setter cierra sin guardar (cancel), no avanza.
      if (modalOpening) {
        const modalIds = ['call-callback-modal','call-schedule-modal','call-objection-modal'];
        // Esperar hasta que TODOS los modales relevantes estén hidden (o cancelaron)
        let waited = 0;
        const check = () => {
          const anyOpen = modalIds.some(id => {
            const m = document.getElementById(id);
            return m && !m.classList.contains('hidden');
          });
          if (anyOpen && waited < 60000) {
            waited += 400;
            setTimeout(check, 400);
            return;
          }
          // Avanzar solo si el lead realmente cambió de estado (la disposition
          // fue confirmada). Si el setter canceló, el lead sigue accionable.
          const lead = _callsLeadsById.get(leadId);
          if (!lead) { _pdAdvance(); return; } // lead borrado durante el flow
          const stillActionable = !['descartado','agendado'].includes(lead.estado) && (!lead.callbackAt || new Date(lead.callbackAt).getTime() <= Date.now());
          if (!stillActionable) _pdAdvance();
        };
        setTimeout(check, 600);
      } else {
        // Outcomes directos (no_answer, voicemail, wrong_number, invalid_number,
        // answered_interested) — auto-avanzar
        setTimeout(() => _pdAdvance(), 600);
      }
    };

    // Wiring botones power dialer
    document.getElementById('calls-power-dialer-btn')?.addEventListener('click', () => window._pdStart());
    document.getElementById('pd-exit-btn')?.addEventListener('click', () => window._pdExit());

    // ── Manual dial: discar un numero arbitrario sin lead asociado ───────────
    // Inyecta un "ghost lead" en _callsLeadsById y reusa _startTelnyxCall.
    const _manualDialModal = document.getElementById('manual-dial-modal');
    const _manualDialInput = document.getElementById('manual-dial-input');
    function _openManualDial() {
      if (!_manualDialModal) return;
      _manualDialInput.value = '';
      _manualDialModal.classList.remove('hidden');
      setTimeout(() => _manualDialInput.focus(), 60);
    }
    function _closeManualDial() {
      _manualDialModal?.classList.add('hidden');
    }
    document.getElementById('calls-manual-dial-btn')?.addEventListener('click', _openManualDial);
    document.getElementById('manual-dial-close')?.addEventListener('click', _closeManualDial);
    document.getElementById('manual-dial-cancel')?.addEventListener('click', _closeManualDial);
    _manualDialModal?.addEventListener('click', (e) => { if (e.target === _manualDialModal) _closeManualDial(); });
    _manualDialInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('manual-dial-go')?.click(); }
      if (e.key === 'Escape') { e.preventDefault(); _closeManualDial(); }
    });
    document.getElementById('manual-dial-go')?.addEventListener('click', () => {
      const raw = (_manualDialInput?.value || '').trim();
      // Sanitizar: dejar solo + y digitos
      const phone = raw.replace(/[^\d+]/g, '');
      if (!phone) { window.showToast?.('Pone un numero', { type: 'warn' }); return; }
      if (!/^\+?\d{8,15}$/.test(phone)) { window.showToast?.('Numero invalido. Formato E.164: +5492954555113', { type: 'error' }); return; }
      const e164 = phone.startsWith('+') ? phone : ('+' + phone);
      // Detectar pais por prefijo para que pickNumberForDestination elija bien caller ID
      const countryByPrefix = { '+54': 'Argentina', '+56': 'Chile', '+57': 'Colombia', '+58': 'Venezuela', '+51': 'Peru', '+591': 'Bolivia', '+593': 'Ecuador', '+595': 'Paraguay', '+598': 'Uruguay', '+52': 'Mexico', '+34': 'Espana', '+1': 'USA', '+506': 'Costa Rica', '+507': 'Panama', '+503': 'El Salvador', '+502': 'Guatemala', '+504': 'Honduras', '+505': 'Nicaragua' };
      let country = '';
      for (const [pref, c] of Object.entries(countryByPrefix)) {
        if (e164.startsWith(pref)) { country = c; break; }
      }
      const ghostId = 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const ghostLead = {
        id: ghostId,
        name: 'Llamada manual a ' + e164,
        phone: e164,
        country,
        city: '',
        assignedTo: currentUser?.setterId || '',
        estado: 'sin_contactar',
        conexion: '',
        callLog: [],
        interactions: [],
        notes: [],
        _isManualDial: true,
      };
      _callsLeadsById.set(ghostId, ghostLead);
      _closeManualDial();
      window._startTelnyxCall?.(ghostId);
    });

    // Volver al lead anterior (por si se marcó un resultado equivocado).
    window._pdBack = function() {
      if (_pd.currentIdx <= 0) { window.showToast?.('Ya estás en el primer lead', { type: 'info', duration: 1500 }); return; }
      _pdCancelAutopilot();
      _pd.autopilotArmed = false; // al volver atrás, no auto-discar
      _pd.currentIdx--;
      if (_pd.processed > 0) _pd.processed--;
      _pdRender();
    };

    // Mapa de teclas numéricas → outcomes (mismo orden que el grid de disposition).
    const _pdKeyOutcomes = ['answered_interested','answered_not_interested','hung_up','no_answer','voicemail','callback_later','wrong_number','invalid_number'];

    // Shortcuts globales para power dialer
    document.addEventListener('keydown', (e) => {
      if (!_pd.active) return;
      // Ignorar si está tipeando en input/textarea/select (excepto Escape)
      const typing = e.target?.matches?.('input,textarea,select');
      if (e.key === 'Escape') { if (_pd.autopilotTimer) { _pdCancelAutopilot(); } else { window._pdExit(); } return; }
      if (typing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') {
        _pdCancelAutopilot();
        const lead = _callsLeadsById.get(_pd.queue[_pd.currentIdx]);
        if (lead) window._startTelnyxCall?.(lead.id);
      }
      else if (e.key === 's' || e.key === 'S') { _pdCancelAutopilot(); window._pdSkip(); }
      else if (e.key === 'b' || e.key === 'B') { window._pdBack(); }
      else if (e.key === 'a' || e.key === 'A') { window._pdToggleAutopilot(); }
      else if (e.key === 'p' || e.key === 'P') { _pdCancelAutopilot(); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.getElementById('pd-call-note')?.focus(); }
      else if (e.key >= '1' && e.key <= '8') {
        const outcome = _pdKeyOutcomes[parseInt(e.key, 10) - 1];
        const lead = _callsLeadsById.get(_pd.queue[_pd.currentIdx]);
        if (lead && outcome) { _pdCancelAutopilot(); window._pdHandleDispositionDirect(lead.id, outcome); }
      }
    });

    // Sprint 33: render barra de quota diaria
    async function _callsRenderQuota() {
      const wrap = document.getElementById('calls-quota-wrap');
      if (!wrap) return;
      // Resolver setterId target: si admin filtra por uno, usar ese; si es setter, usar el suyo
      const role = currentUser?.role;
      const selectedSetter = document.getElementById('calls-setter-select')?.value || '';
      let targetSetterId = '';
      if (role === 'setter') targetSetterId = currentUser?.setterId || '';
      else if (selectedSetter) targetSetterId = selectedSetter;
      if (!targetSetterId) { wrap.style.display = 'none'; return; }
      try {
        const [qResp, cResp] = await Promise.all([
          fetch(apiUrl('/api/setters/team/' + encodeURIComponent(targetSetterId) + '/quota')),
          fetch(apiUrl('/api/setters/team/' + encodeURIComponent(targetSetterId) + '/calls-today'))
        ]);
        if (!qResp.ok || !cResp.ok) { wrap.style.display = 'none'; return; }
        const q = await qResp.json();
        const c = await cResp.json();
        const quota = q.dailyCallQuota || 0;
        const count = c.count || 0;
        if (quota === 0) {
          // Sin quota configurada → mostrar solo si admin (para que pueda editar)
          if (role !== 'admin') { wrap.style.display = 'none'; return; }
          wrap.style.display = 'block';
          document.getElementById('calls-quota-text').textContent = `${count} llamadas · meta sin configurar`;
          document.getElementById('calls-quota-pct').textContent = '—';
          document.getElementById('calls-quota-bar').style.width = '0%';
          return;
        }
        wrap.style.display = 'block';
        const pct = Math.min(100, Math.round((count / quota) * 100));
        document.getElementById('calls-quota-text').textContent = `${count} / ${quota} llamadas`;
        document.getElementById('calls-quota-pct').textContent = pct + '%';
        const bar = document.getElementById('calls-quota-bar');
        bar.style.width = pct + '%';
        // Color: verde si >=75%, amarillo si >=40%, rojo si <40% (asumiendo que el setter ya arrancó el día)
        let grad = 'linear-gradient(90deg, var(--success) 0%, #3a8e4e 100%)';
        if (pct < 40) grad = 'linear-gradient(90deg, #f47272 0%, #c44141 100%)';
        else if (pct < 75) grad = 'linear-gradient(90deg, #FFB341 0%, #d88f1c 100%)';
        bar.style.background = grad;
      } catch (e) { wrap.style.display = 'none'; }
    }
    // Sprint 33: admin edita quota del setter
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('#calls-quota-edit');
      if (!btn) return;
      const selectedSetter = document.getElementById('calls-setter-select')?.value || '';
      if (!selectedSetter) {
        window.showToast?.('Elegí un setter del dropdown primero', { type: 'warning' });
        return;
      }
      const current = (document.getElementById('calls-quota-text')?.textContent || '').match(/\d+/g);
      const currentVal = current && current.length > 1 ? current[1] : '50';
      const nuevo = prompt('Meta diaria de llamadas para este setter (0-999):', currentVal);
      if (nuevo === null) return;
      const n = parseInt(nuevo, 10);
      if (!Number.isFinite(n) || n < 0 || n > 999) {
        alert('Número inválido (0-999)');
        return;
      }
      fetch(apiUrl('/api/setters/team/' + encodeURIComponent(selectedSetter) + '/quota'), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyCallQuota: n })
      }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        window.showToast?.('Meta actualizada', { type: 'success' });
        _callsRenderQuota();
      }).catch(err => window.showToast?.('Error: ' + err.message, { type: 'error' }));
    });
    function _callsLastCallTs(l) {
      const last = l.callLog && l.callLog.length > 0 ? l.callLog[l.callLog.length - 1] : null;
      return last ? new Date(last.ts).getTime() : 0;
    }

    // Sprint 21: Render de chips de filtro por país (con bandera + count)
    function _callsRenderCountryChips() {
      const wrap = document.getElementById('calls-country-chips');
      if (!wrap) return;
      // Audit fix Sprint 30: el count respeta el toggle "ver descartados"
      // para que coincida con lo que se muestra abajo.
      const showDiscarded = document.getElementById('calls-show-discarded')?.checked;
      const counts = {};
      for (const l of callsLeadsCache) {
        if (l.estado === 'agendado') continue;
        if (!showDiscarded && l.estado === 'descartado') continue;
        const c = (l.country || '').trim();
        if (!c) continue;
        counts[c] = (counts[c] || 0) + 1;
      }
      const sortedCountries = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const currentFilter = document.getElementById('calls-country-filter').value || '';
      const totalAll = Object.values(counts).reduce((s, n) => s + n, 0);
      // Sprint 38: chip "Todos" sin emoji, con icono SVG mundo más sutil.
      // Chips de países con flag-icons (SVG) en lugar de emoji Unicode (que
      // no se renderiza en Windows). Look B2B prospecting CRM.
      const chips = [`<button class="calls-country-chip${!currentFilter ? ' is-active' : ''}" data-country="">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.8;"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        <span>Todos</span>
        <span class="chip-count">${totalAll}</span>
      </button>`];
      for (const c of sortedCountries) {
        chips.push(`<button class="calls-country-chip${currentFilter === c ? ' is-active' : ''}" data-country="${escHtml(c)}">
          ${countryFlagHTML(c)}
          <span>${escHtml(c)}</span>
          <span class="chip-count">${counts[c]}</span>
        </button>`);
      }
      wrap.innerHTML = chips.join('');
      // Click handler
      wrap.querySelectorAll('.calls-country-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const c = btn.getAttribute('data-country') || '';
          const select = document.getElementById('calls-country-filter');
          select.value = c;
          try { localStorage.setItem('calls_country_filter_' + (currentUser?.id || 'anon'), c); } catch {}
          _callsCurrentPage = 1;
          _callsRenderCountryChips();
          renderCallsList();
          renderCallsStats();
        });
      });
    }

    // Sprint 21: Toggle expand de una row
    window._callsToggleExpand = function(leadId) {
      if (_callsExpanded.has(leadId)) _callsExpanded.delete(leadId);
      else _callsExpanded.add(leadId);
      renderCallsList();
    };

    // Sprint 21: Agregar nota al lead desde la vista Llamadas
    window._callsAddNote = async function(leadId) {
      const ta = document.getElementById('call-note-input-' + leadId);
      if (!ta) return;
      const text = (ta.value || '').trim();
      if (!text) return;
      const by = currentUser?.name || currentUser?.email || 'Sistema';
      try {
        const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/note'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, by })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        // Actualizar cache local
        const lead = _callsLeadsById.get(leadId);
        if (lead) lead.notes = d.notes;
        ta.value = '';
        renderCallsList();
        window.showToast?.('Nota agregada', { type: 'success', duration: 1500 });
      } catch (e) {
        window.showToast?.('Error guardando nota: ' + e.message, { type: 'error' });
      }
    };

    // Sprint 21: Borrar nota
    window._callsDeleteNote = async function(leadId, noteIdx) {
      if (!confirm('¿Borrar esta nota?')) return;
      try {
        const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/note/' + noteIdx), { method: 'DELETE' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const lead = _callsLeadsById.get(leadId);
        if (lead) lead.notes = d.notes;
        renderCallsList();
      } catch (e) {
        window.showToast?.('Error borrando nota: ' + e.message, { type: 'error' });
      }
    };

    // Sprint 21: Toggle follow-up
    window._callsToggleFollowup = async function(leadId, step) {
      try {
        const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/followup'), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        const lead = _callsLeadsById.get(leadId);
        if (lead) {
          lead.followUps = d.followUps;
          lead.followUpStartedAt = d.followUpStartedAt;
        }
        renderCallsList();
      } catch (e) {
        window.showToast?.('Error guardando follow-up: ' + e.message, { type: 'error' });
      }
    };

    // Sprint 28: Reactivar lead descartado (admin only)
    window._callsReactivate = async function(leadId) {
      if (!confirm('¿Reactivar este lead? Va a volver a estado "sin contactar" y vas a poder llamarlo de nuevo. El histórico de llamadas anteriores se conserva.')) return;
      try {
        const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/reactivate'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        if (!r.ok) {
          const errData = await r.json().catch(() => ({}));
          throw new Error(errData.error || ('HTTP ' + r.status));
        }
        const d = await r.json();
        // Actualizar cache local con el lead reactivado
        const idx = callsLeadsCache.findIndex(l => l.id === leadId);
        if (idx >= 0) callsLeadsCache[idx] = { ...callsLeadsCache[idx], ...d.lead, id: leadId };
        else callsLeadsCache.push({ ...d.lead, id: leadId });
        _callsRenderCountryChips();
        renderCallsList();
        renderCallsStats();
        window.showToast?.('Lead reactivado — ya está en cola para llamar', { type: 'success', duration: 3000 });
      } catch (e) {
        window.showToast?.('Error reactivando: ' + e.message, { type: 'error' });
      }
    };

    // Sprint 24: guardar precallNote (debounced al blur)
    window._callsSavePrecallNote = async function(leadId) {
      const ta = document.getElementById('call-precall-note-' + leadId);
      if (!ta) return;
      const text = (ta.value || '').trim();
      const lead = _callsLeadsById.get(leadId);
      if (lead && (lead.precallNote || '') === text) return; // sin cambios
      try {
        const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/precall-note'), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (lead) lead.precallNote = d.precallNote;
        // Mini feedback visual (sin renderizar todo, solo borde verde 1s)
        ta.style.borderColor = 'var(--success)';
        setTimeout(() => { ta.style.borderColor = ''; }, 800);
      } catch (e) {
        window.showToast?.('Error guardando pre-call: ' + e.message, { type: 'error' });
      }
    };

    // Sprint 21: "Este sí tenía WSP" → vuelve a Setteo (limpia conexion='sin_wsp')
    window._callsMarkHasWsp = async function(leadId) {
      if (!confirm('¿Confirmás que este lead SÍ tiene WhatsApp? Va a volver a la vista de Setteo.')) return;
      try {
        const r = await fetch(apiUrl('/api/setters/leads/' + leadId), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conexion: '' })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // Sacar del cache local
        callsLeadsCache = callsLeadsCache.filter(l => l.id !== leadId);
        _callsLeadsById.delete(leadId);
        _callsExpanded.delete(leadId);
        renderCallsList();
        _callsRenderCountryChips();
        window.showToast?.('Lead movido a Setteo', { type: 'success' });
      } catch (e) {
        window.showToast?.('Error: ' + e.message, { type: 'error' });
      }
    };

    // Sprint 21: Renderiza el panel expandido de un lead en Llamadas.
    // Devuelve HTML que se inserta debajo de la row.
    function _callsRenderExpandedPanel(l) {
      const notes = Array.isArray(l.notes) ? l.notes : [];
      const callLog = Array.isArray(l.callLog) ? l.callLog : [];
      const fups = l.followUps || {};
      const followUpStartedAt = l.followUpStartedAt;
      const fupSteps = [
        { key: '24hs', label: '24h', hours: 24 },
        { key: '48hs', label: '48h', hours: 48 },
        { key: '72hs', label: '72h', hours: 72 },
        { key: '7d', label: '7d', hours: 168 },
        { key: '15d', label: '15d', hours: 360 },
      ];
      const activeFup = fupSteps.find(s => fups[s.key]);
      let dueText = '';
      if (activeFup && followUpStartedAt) {
        const dueAt = new Date(followUpStartedAt).getTime() + activeFup.hours * 3600 * 1000;
        const hoursLeft = (dueAt - Date.now()) / 3600 / 1000;
        if (hoursLeft <= 0) {
          dueText = `⏰ Follow-up vencido (era ${activeFup.label} desde el ${new Date(followUpStartedAt).toLocaleDateString('es-AR')})`;
        } else if (hoursLeft < 24) {
          dueText = `🔔 Falta ${Math.round(hoursLeft)}h para el follow-up`;
        } else {
          dueText = `🔔 Falta ${Math.round(hoursLeft/24)}d para el follow-up`;
        }
      }

      // Ficha rica
      const fichaItems = [];
      if (l.phone) fichaItems.push(`<span class="label">Tel</span><span class="value" style="font-family:ui-monospace,monospace;">${escHtml(l.phone)}</span>`);
      if (l.rating) fichaItems.push(`<span class="label">Rating</span><span class="value">⭐ ${escHtml(String(l.rating))}${l.reviews ? ' · ' + l.reviews + ' reseñas' : ''}</span>`);
      if (l.address) fichaItems.push(`<span class="label">Dirección</span><span class="value">${escHtml(l.address)}</span>`);
      // Sprint 37 (VULN-A1): pasar todas las URLs por safeUrl antes de href
      if (l.website) {
        const safeW = safeUrl(l.website);
        if (safeW) fichaItems.push(`<span class="label">Web</span><span class="value"><a href="${escHtml(safeW)}" target="_blank" rel="noopener noreferrer">${escHtml(safeW.replace(/^https?:\/\//, '').substring(0, 40))}</a></span>`);
      }
      if (l.email) {
        const safeEmail = String(l.email).trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
          fichaItems.push(`<span class="label">Email</span><span class="value"><a href="mailto:${escHtml(safeEmail)}">${escHtml(safeEmail)}</a></span>`);
        }
      }
      if (l.instagram) {
        const igRaw = String(l.instagram).trim();
        const igUrl = igRaw.startsWith('http') ? safeUrl(igRaw) : 'https://instagram.com/' + igRaw.replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '');
        if (igUrl) fichaItems.push(`<span class="label">Instagram</span><span class="value"><a href="${escHtml(igUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(igRaw)}</a></span>`);
      }
      if (l.doctor && !l.doctor.includes('N/A')) fichaItems.push(`<span class="label">Doctor</span><span class="value">${escHtml(l.doctor)}</span>`);
      if (l.facebook) {
        const fbRaw = String(l.facebook).trim();
        const fbUrl = fbRaw.startsWith('http') ? safeUrl(fbRaw) : 'https://facebook.com/' + fbRaw.replace(/[^a-zA-Z0-9_.\-]/g, '');
        if (fbUrl) fichaItems.push(`<span class="label">Facebook</span><span class="value"><a href="${escHtml(fbUrl)}" target="_blank" rel="noopener noreferrer">FB</a></span>`);
      }
      if (l.importedAt) fichaItems.push(`<span class="label">Importado</span><span class="value">${new Date(l.importedAt).toLocaleDateString('es-AR')}</span>`);

      // Histórico
      const historyHtml = callLog.length === 0
        ? '<p style="color:var(--text-tertiary); font-size:12px; margin:0;">Sin llamadas previas.</p>'
        : callLog.slice().reverse().slice(0, 20).map(entry => {
            const icon = ({
              answered_interested: '✅', answered_not_interested: '❌',
              no_answer: '📵', voicemail: '📭',
              wrong_number: '🔢', invalid_number: '🚫',
              callback_later: '🔄', scheduled_with_admin: '📅'
            })[entry.outcome] || '📞';
            const label = callOutcomeLabel(entry.outcome);
            const time = entry.ts ? new Date(entry.ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
            const dur = entry.duration ? ` · ${entry.duration}s` : '';
            const cost = entry.cost ? ` · $${Number(entry.cost).toFixed(3)}` : '';
            // Sprint 25: si la entry tiene objection tags, mostrarlos como chips
            const tagLabelMap = { precio: '💸 precio', ya_tiene_sistema: '⚙️ otro sistema', tiempo: '⏳ tiempo', no_es_decisor: '🪑 no decisor', no_entiende_valor: '🤷 no valor', desconfia: '🛑 desconfía', mal_momento: '📆 mal momento', otra: '➕ otra' };
            const objTags = Array.isArray(entry.objectionTags) ? entry.objectionTags : [];
            const objTagsHtml = objTags.length > 0 ? `<div style="grid-column:2; display:flex; gap:4px; flex-wrap:wrap; margin-top:3px;">${objTags.map(t => `<span style="font-size:9.5px; background:rgba(244,114,114,0.12); border:1px solid rgba(244,114,114,0.28); color:#f47272; padding:1px 6px; border-radius:5px;">${tagLabelMap[t] || t}</span>`).join('')}</div>` : '';
            return `<div class="call-history-item">
              <span class="call-history-icon">${icon}</span>
              <span class="call-history-text">${escHtml(label)}${dur}${cost}${entry.notes ? ' · ' + escHtml(String(entry.notes).substring(0, 60)) : ''}</span>
              <span class="call-history-time">${time}</span>
              ${objTagsHtml}
            </div>`;
          }).join('');

      // Notas
      const notesHtml = notes.length === 0
        ? '<p style="color:var(--text-tertiary); font-size:12px; margin:0;">Sin notas todavía.</p>'
        : notes.slice().reverse().map((n, revIdx) => {
            const realIdx = notes.length - 1 - revIdx;
            const when = n.date ? new Date(n.date).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            return `<div class="call-note-item">
              ${escHtml(n.text)}
              <div class="call-note-meta">
                <span>${escHtml(n.by || '')} · ${when}</span>
                <button class="call-note-delete" onclick="window._callsDeleteNote('${escHtml(l.id)}', ${realIdx})" title="Borrar nota">✕</button>
              </div>
            </div>`;
          }).join('');

      return `<div class="call-detail-panel">
        <!-- Columna izquierda: ficha + histórico -->
        <div class="call-detail-section">
          <h4 class="call-detail-section-title">📋 Ficha del lead</h4>
          <div class="call-detail-grid">${fichaItems.join('')}</div>

          <h4 class="call-detail-section-title" style="margin-top:14px;">📞 Histórico de llamadas (${callLog.length})</h4>
          <div class="call-history-timeline">${historyHtml}</div>

          <div class="call-action-row">
            ${l.estado === 'descartado' ? `<button class="call-action-btn" onclick="window._callsReactivate('${escHtml(l.id)}')" style="background:rgba(91,185,116,0.12); border-color:rgba(91,185,116,0.4); color:#5bb974; font-weight:600;" title="Volver el lead a estado sin_contactar para llamarlo de nuevo">
              🔄 Reactivar lead
            </button>` : ''}
            <button class="call-action-btn is-wsp" onclick="window._callsMarkHasWsp('${escHtml(l.id)}')" title="Si descubrís que el lead SÍ atiende por WhatsApp, mandalo de vuelta a Setteo">
              💬 Este sí tenía WSP → Setteo
            </button>
            ${(() => {
              const safeEmail = String(l.email || '').trim();
              return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail) ? `<a href="mailto:${escHtml(safeEmail)}" class="call-action-btn">✉️ Mandar mail</a>` : '';
            })()}
            ${(() => {
              const safeW = safeUrl(l.website || '');
              return safeW ? `<a href="${escHtml(safeW)}" target="_blank" rel="noopener noreferrer" class="call-action-btn">🌐 Abrir web</a>` : '';
            })()}
          </div>
        </div>

        <!-- Columna derecha: pre-call + notas + follow-ups -->
        <div class="call-detail-section">
          <h4 class="call-detail-section-title">🎯 Nota pre-call (qué decir / contexto)</h4>
          <textarea id="call-precall-note-${escHtml(l.id)}" class="call-note-input" style="min-height:60px; max-height:140px;" placeholder="Antes de discar: contexto del lead, ángulo de apertura, info que vi en su web…" onblur="window._callsSavePrecallNote('${escHtml(l.id)}')">${escHtml(l.precallNote || '')}</textarea>
          <p style="font-size:10px; color:var(--text-tertiary); margin:-4px 0 8px;">Se guarda al hacer click afuera. Aparece también en el panel de llamada activa.</p>

          <h4 class="call-detail-section-title">📅 Follow-up programado</h4>
          <div class="call-followups">
            ${fupSteps.map(s => `<button class="call-fup-chip${fups[s.key] ? ' is-on' : ''}" onclick="window._callsToggleFollowup('${escHtml(l.id)}', '${s.key}')">${s.label}</button>`).join('')}
          </div>
          ${dueText ? `<div class="call-fup-due">${dueText}</div>` : ''}

          <h4 class="call-detail-section-title" style="margin-top:14px;">📝 Notas (${notes.length})</h4>
          <div class="call-notes-list">${notesHtml}</div>
          <div class="call-note-input-row">
            <textarea id="call-note-input-${escHtml(l.id)}" class="call-note-input" placeholder="Nueva nota… (Ctrl+Enter para guardar)" rows="1" onkeydown="if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();window._callsAddNote('${escHtml(l.id)}')}"></textarea>
            <button class="call-note-add-btn" onclick="window._callsAddNote('${escHtml(l.id)}')">+ Nota</button>
          </div>
        </div>
      </div>`;
    }

    function renderCallsList() {
      const list = document.getElementById('calls-list');
      const country = document.getElementById('calls-country-filter').value;
      const search = (document.getElementById('calls-search')?.value || '').toLowerCase().trim();
      const sortMode = document.getElementById('calls-sort-select')?.value || 'never_called';
      const now = Date.now();

      let leads = callsLeadsCache.slice();
      if (country) leads = leads.filter(l => (l.country || '').trim() === country);
      if (search) leads = leads.filter(l => (
        // Audit Sprint 37: matchear universalmente como el buscador de Setteo
        // (nombre, teléfono, país, ciudad, doctor, dirección, email, website).
        (l.name || '').toLowerCase().includes(search) ||
        (l.phone || '').toLowerCase().includes(search) ||
        (l.city || '').toLowerCase().includes(search) ||
        (l.country || '').toLowerCase().includes(search) ||
        (l.doctor || '').toLowerCase().includes(search) ||
        (l.address || '').toLowerCase().includes(search) ||
        (l.email || '').toLowerCase().includes(search) ||
        (l.website || '').toLowerCase().includes(search)
      ));

      // Ocultar leads con callbackAt en el futuro (excepto los que el user
      // forzó a mostrar clickeando su callback en la agenda).
      const showCallbackPending = false;
      if (!showCallbackPending) {
        leads = leads.filter(l => _callsForceShow.has(l.id) || !l.callbackAt || new Date(l.callbackAt).getTime() <= now);
      }

      // Ocultar agendados (ya pasaron). Sprint 28: si toggle "Ver descartados"
      // está ON, los descartados se muestran (con UI degradada y botón reactivar).
      const showDiscarded = document.getElementById('calls-show-discarded')?.checked;
      const hiddenStates = showDiscarded ? ['agendado'] : ['descartado','agendado'];
      leads = leads.filter(l => !hiddenStates.includes(l.estado));

      // "Para seguir": cola de seguimiento = callbacks vencidos + leads cuyo
      // último resultado fue "Me cortó"/"No atendió"/"Buzón" (re-llamables).
      const FOLLOW_OUTCOMES = new Set(['hung_up', 'no_answer', 'voicemail']);
      const _lastOutcome = (l) => (Array.isArray(l.callLog) && l.callLog.length) ? l.callLog[l.callLog.length - 1].outcome : null;
      const _isDueCallback = (l) => l.callbackAt && new Date(l.callbackAt).getTime() <= now;
      if (sortMode === 'follow_up') {
        leads = leads.filter(l => _isDueCallback(l) || FOLLOW_OUTCOMES.has(_lastOutcome(l)));
      }

      // Sort configurable según el dropdown
      switch (sortMode) {
        case 'follow_up':
          leads.sort((a, b) => {
            const ad = _isDueCallback(a), bd = _isDueCallback(b);
            if (ad && !bd) return -1;
            if (bd && !ad) return 1;
            if (ad && bd) return new Date(a.callbackAt) - new Date(b.callbackAt); // más vencido primero
            return _callsLastCallTs(b) - _callsLastCallTs(a); // cortados: más reciente primero
          });
          break;
        case 'recent':
          leads.sort((a, b) => new Date(b.importedAt || 0).getTime() - new Date(a.importedAt || 0).getTime());
          break;
        case 'oldest':
          leads.sort((a, b) => new Date(a.importedAt || 0).getTime() - new Date(b.importedAt || 0).getTime());
          break;
        case 'country':
          leads.sort((a, b) => (a.country || '').localeCompare(b.country || '') || (a.callAttempts || 0) - (b.callAttempts || 0));
          break;
        case 'attempts_desc':
          leads.sort((a, b) => (b.callAttempts || 0) - (a.callAttempts || 0));
          break;
        case 'attempts_asc':
          leads.sort((a, b) => (a.callAttempts || 0) - (b.callAttempts || 0));
          break;
        case 'last_call':
          leads.sort((a, b) => _callsLastCallTs(b) - _callsLastCallTs(a));
          break;
        case 'never_called':
        default:
          // Nunca llamados primero. Sprint 37 (HOTSPOT-12): tiebreaker
          // estable (importedAt → id) para que rows no salten entre re-renders.
          leads.sort((a, b) => (a.callAttempts || 0) - (b.callAttempts || 0)
            || new Date(a.importedAt || 0) - new Date(b.importedAt || 0)
            || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          break;
      }

      // 2026-06-04: los leads forzados a mostrar (callback de mañana clickeado
      // en la agenda) van PRIMERO, así caen en la página 1 y el scroll los
      // encuentra. Sin esto, podían quedar en otra página → "no pasa nada".
      if (_callsForceShow.size > 0) {
        leads.sort((a, b) => (_callsForceShow.has(b.id) ? 1 : 0) - (_callsForceShow.has(a.id) ? 1 : 0));
      }

      // Paginación
      const pagFooter = document.getElementById('calls-pagination');
      const total = leads.length;
      const totalPages = Math.max(1, Math.ceil(total / CALLS_PAGE_SIZE));
      if (_callsCurrentPage > totalPages) _callsCurrentPage = totalPages;
      if (_callsCurrentPage < 1) _callsCurrentPage = 1;
      const startIdx = (_callsCurrentPage - 1) * CALLS_PAGE_SIZE;
      const endIdx = Math.min(startIdx + CALLS_PAGE_SIZE, total);

      if (total === 0) {
        // Sprint 35: empty state con personalidad SCM
        const country = document.getElementById('calls-country-filter')?.value || '';
        const search = (document.getElementById('calls-search')?.value || '').trim();
        let emptyMsg, emptyHint;
        if (search || country) {
          emptyMsg = 'Nada acá con esos filtros.';
          emptyHint = 'Limpiá la búsqueda o el filtro de país y va a aparecer todo de nuevo.';
        } else {
          emptyMsg = 'Cola vacía. Buen trabajo. 💪';
          emptyHint = 'O bien procesaste todo, o el scraper todavía no trajo leads sin WhatsApp. Andá a "Búsqueda" para traer más.';
        }
        list.innerHTML = `<div style="padding:60px 20px; text-align:center;">
          <div style="font-size:48px; margin-bottom:14px; opacity:0.6;">📞</div>
          <h3 style="color:var(--text-primary); font-weight:600; margin:0 0 6px; font-size:16px;">${emptyMsg}</h3>
          <p style="color:var(--text-tertiary); font-size:13px; margin:0 auto; max-width:380px; line-height:1.5;">${emptyHint}</p>
        </div>`;
        if (pagFooter) pagFooter.style.display = 'none';
        return;
      }

      // Render footer de paginación (oculto si hay 1 sola página)
      if (pagFooter) {
        pagFooter.style.display = total > CALLS_PAGE_SIZE ? 'flex' : 'none';
        document.getElementById('calls-pag-from').textContent = startIdx + 1;
        document.getElementById('calls-pag-to').textContent = endIdx;
        document.getElementById('calls-pag-total').textContent = total;
        document.getElementById('calls-pag-current').textContent = _callsCurrentPage;
        document.getElementById('calls-pag-last').textContent = totalPages;
        document.getElementById('calls-pag-first').disabled = _callsCurrentPage === 1;
        document.getElementById('calls-pag-prev').disabled = _callsCurrentPage === 1;
        document.getElementById('calls-pag-next').disabled = _callsCurrentPage === totalPages;
        document.getElementById('calls-pag-end').disabled = _callsCurrentPage === totalPages;
      }
      // Solo renderizar la página actual
      leads = leads.slice(startIdx, endIdx);

      list.innerHTML = leads.map(l => {
        const tel = buildTelLink(l.phone, l.country);
        const flag = fmtCountry(l.country);
        const lastNote = l.notes && l.notes.length > 0 ? l.notes[l.notes.length - 1] : null;
        const lastCall = l.callLog && l.callLog.length > 0 ? l.callLog[l.callLog.length - 1] : null;
        const attempts = l.callAttempts || 0;
        const interesado = l.estado === 'interesado';
        const isExpanded = _callsExpanded.has(l.id);

        // Sprint 21: badges adicionales
        const notesCount = Array.isArray(l.notes) ? l.notes.length : 0;
        const fups = l.followUps || {};
        const hasFup = ['24hs','48hs','72hs','7d','15d'].some(k => fups[k]);
        const notesBadge = notesCount > 0 ? `<span style="font-size:10px; color:var(--accent); background:rgba(157,133,242,0.12); padding:2px 7px; border-radius:6px;">📝 ${notesCount}</span>` : '';
        const fupBadge = hasFup ? '<span style="font-size:10px; color:var(--warning); background:rgba(255,179,65,0.12); padding:2px 7px; border-radius:6px;">🔔 follow-up</span>' : '';
        // Sprint 23: badge de callback programado (si está en el futuro)
        let callbackBadge = '';
        if (l.callbackAt) {
          const cbDate = new Date(l.callbackAt);
          const cbTs = cbDate.getTime();
          if (cbTs > Date.now()) {
            const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
            const cbLabel = `${dayNames[cbDate.getDay()]} ${cbDate.getDate()}/${cbDate.getMonth()+1} ${String(cbDate.getHours()).padStart(2,'0')}:${String(cbDate.getMinutes()).padStart(2,'0')}`;
            callbackBadge = `<span style="font-size:10px; color:var(--info, #5BA3F2); background:rgba(91,163,242,0.12); padding:2px 7px; border-radius:6px;">📅 ${cbLabel}</span>`;
          }
        }

        // Sprint 28: visualizar descartados con UI degradada
        const isDiscarded = l.estado === 'descartado';
        let cardBorder = interesado ? 'border-left:4px solid var(--success);' : '';
        if (isDiscarded) cardBorder = 'border-left:4px solid var(--text-tertiary); opacity:0.65;';
        const interesadoBadge = interesado ? '<span style="background:var(--success-soft); color:var(--success); padding:2px 8px; border-radius:8px; font-size:10px; font-weight:600; letter-spacing:0.3px;">✅ INTERESADO — agendar con Ignacio</span>' : '';
        const discardedBadge = isDiscarded ? `<span style="background:rgba(255,255,255,0.05); color:var(--text-tertiary); padding:2px 8px; border-radius:8px; font-size:10px; font-weight:600; letter-spacing:0.3px;">🗑️ DESCARTADO${l.interes === 'no' ? ' (no interesado)' : l.phoneStatus === 'wrong' ? ' (número equivocado)' : l.phoneStatus === 'invalid' ? ' (no existe)' : ''}</span>` : '';

        const isSelected = _callsSelected.has(l.id);
        const isAdminUser = currentUser?.role === 'admin';
        const checkboxCol = isAdminUser ? `<input type="checkbox" class="call-row-checkbox" data-lead-id="${escHtml(l.id)}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); window._callsToggleSelect('${escHtml(l.id)}', this.checked);" style="accent-color:var(--accent); cursor:pointer; width:16px; height:16px;">` : '';
        const gridCols = isAdminUser ? '22px 30px 1fr auto auto auto' : '36px 1fr auto auto auto';

        // Sprint 38: usar flag-icons (SVG) en lugar de emoji para look B2B consistente
        const flagIcon = l.country ? countryFlagHTML(l.country, 'lg') : '<svg width="22" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.55;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
        const rowHtml = `<div class="call-row${isExpanded ? ' is-expanded' : ''}${isSelected ? ' is-selected' : ''}" data-id="${escHtml(l.id)}" style="background:var(--bg-surface); border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}; ${cardBorder} border-radius:12px; padding:14px 18px; display:grid; grid-template-columns: ${gridCols}; gap:14px; align-items:center;">
          ${checkboxCol}
          <div style="display:flex; align-items:center; justify-content:center;">${flagIcon}</div>

          <div style="min-width:0;">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <strong style="color:var(--text-primary); font-size:14px;">${escHtml(l.name)}</strong>
              ${discardedBadge}
              ${interesadoBadge}
              ${attempts > 0 ? `<span style="font-size:10px; color:var(--text-tertiary); background:var(--bg-input); padding:2px 7px; border-radius:6px;">${attempts} intento${attempts>1?'s':''}</span>` : ''}
              ${l.phoneStatus === 'voicemail' ? '<span style="font-size:10px; color:var(--warning); background:var(--warning-soft); padding:2px 7px; border-radius:6px;">📭 buzón</span>' : ''}
              ${notesBadge}
              ${fupBadge}
              ${callbackBadge}
              ${l.placeholderSentAt ? `<span style="font-size:10px; color:#5bb974; background:rgba(91,185,116,0.10); padding:2px 7px; border-radius:6px;" title="Hold de calendario enviado ${new Date(l.placeholderSentAt).toLocaleString('es-AR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}">📧 hold</span>` : ''}
              ${l.contactedAt ? `<a href="https://wa.me/${escHtml((l.phone||'').replace(/\\D/g,''))}" onclick="return window._waBtnClick(this, event, '${escHtml(l.id)}');" style="font-size:10px; color:#25D366; background:rgba(37,211,102,0.10); padding:2px 7px; border-radius:6px; text-decoration:none; cursor:pointer;" title="Abrir la conversación en ${l.contactedFromPhone ? escHtml(l.contactedFromPhone) : 'WAMULTI'} · contactado ${new Date(l.contactedAt).toLocaleString('es-AR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}">📤 ver chat</a>` : ''}
              <button type="button" onclick="event.stopPropagation(); window.openPlaceholderModal('${escHtml(l.id)}')" title="Mandar hold de calendario por mail" style="font-size:10px; padding:2px 8px; border-radius:6px; background:transparent; border:1px solid var(--border-subtle); color:var(--text-secondary); cursor:pointer; font-family:inherit;">📅 hold</button>
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:3px;">
              ${escHtml(l.city || '')}${l.city && l.country ? ' · ' : ''}${escHtml(l.country || '')}
              ${l.doctor && !l.doctor.includes('N/A') ? ' · ' + escHtml(l.doctor) : ''}
            </div>
            ${lastCall ? `<div style="font-size:11px; color:var(--text-tertiary); margin-top:3px;">Último: ${escHtml(callOutcomeLabel(lastCall.outcome))} · ${new Date(lastCall.ts).toLocaleString('es-AR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</div>` : ''}
            ${lastNote && !lastCall ? `<div style="font-size:11px; color:var(--text-tertiary); margin-top:3px;">📝 ${escHtml(lastNote.text).substring(0, 80)}</div>` : ''}
          </div>

          ${(() => {
            // "Última llamada hace X días" para no quemar leads
            const lastCallTs = _callsLastCallTs(l);
            let lastBadge = '';
            let cooldownWarn = '';
            if (lastCallTs > 0) {
              const hoursAgo = (Date.now() - lastCallTs) / (1000 * 60 * 60);
              const daysAgo = Math.floor(hoursAgo / 24);
              if (hoursAgo < 24) {
                cooldownWarn = `title="⚠ Lo llamaste hace ${Math.round(hoursAgo)}h — esperá 24h+ para no quemar. Click igual si querés." `;
                lastBadge = `<span style="font-size:9px; color:#FFB341; background:rgba(255,179,65,0.15); border:1px solid rgba(255,179,65,0.35); padding:1px 5px; border-radius:4px; margin-left:6px;">hace ${Math.round(hoursAgo)}h</span>`;
              } else if (daysAgo < 7) {
                lastBadge = `<span style="font-size:9px; color:rgba(255,255,255,0.5); background:rgba(255,255,255,0.05); padding:1px 5px; border-radius:4px; margin-left:6px;">hace ${daysAgo}d</span>`;
              }
            }
            const btnTitle = cooldownWarn || (_telnyx.configured ? `title="Llamar por Telnyx WebRTC · ${escHtml(l.phone)}"` : `title="${escHtml(l.phone)} · Telnyx no configurado, abre dialer del SO"`);
            return (_telnyx.configured && _telnyx.numbers.length > 0)
              ? `<button onclick="window._startTelnyxCall('${escHtml(l.id)}')" class="pill-btn" style="background:var(--success); color:#0F1115; border:none; padding:10px 18px; font-weight:600; font-size:13px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;" ${btnTitle}>
                  📞 Llamar${lastBadge}
                </button>`
              : `<a href="tel:${tel}" class="pill-btn" style="background:var(--success); color:#0F1115; text-decoration:none; padding:10px 18px; font-weight:600; font-size:13px; display:inline-flex; align-items:center; gap:6px;" ${btnTitle}>
                  📞 Llamar${lastBadge}
                </a>`;
          })()}

          <select onchange="window._handleCallDisposition('${escHtml(l.id)}', this)" title="Atajos numéricos post-llamada: 1=Interesado · 2=No interesado · 3=No atendió · 4=Buzón · 5=Callback · 6=Equivocado · 7=No existe" style="padding:9px 12px; border-radius:8px; border:1px solid var(--border-default); background:var(--bg-input); color:var(--text-primary); font-size:13px; min-width:230px; cursor:pointer; font-family:inherit;">
            <option value="">— Resultado (1-7 atajos) —</option>
            <optgroup label="Atendió">
              ${interesado ? '<option value="scheduled_with_admin">📅 Agendar con Ignacio</option>' : '<option value="answered_interested">✅ 1 — Interesado</option>'}
              <option value="answered_not_interested">❌ 2 — No interesado</option>
            </optgroup>
            <optgroup label="No atendió">
              <option value="no_answer">📵 3 — No atendió / sonó nada</option>
              <option value="voicemail">📭 4 — Buzón de voz</option>
              <option value="callback_later">🔄 5 — Volver a llamar después</option>
            </optgroup>
            <optgroup label="Número no sirve">
              <option value="wrong_number">🔢 6 — Número equivocado</option>
              <option value="invalid_number">🚫 7 — No existe / no funciona</option>
            </optgroup>
          </select>

          <button class="call-expand-btn${isExpanded ? ' is-open' : ''}" onclick="window._callsToggleExpand('${escHtml(l.id)}')" title="${isExpanded ? 'Cerrar detalle' : 'Ver ficha, notas, follow-ups e histórico'}" aria-label="${isExpanded ? 'Cerrar' : 'Expandir detalle'}">
            ${isExpanded ? '▴' : '▾'}
          </button>
        </div>${isExpanded ? _callsRenderExpandedPanel(l) : ''}`;
        return rowHtml;
      }).join('');
    }

    function callOutcomeLabel(o) {
      const map = {
        answered_interested: '✅ Interesado',
        answered_not_interested: '❌ No interesado',
        no_answer: '📵 No atendió',
        voicemail: '📭 Buzón',
        wrong_number: '🔢 Equivocado',
        invalid_number: '🚫 No existe',
        callback_later: '🔄 Postpuesto',
        scheduled_with_admin: '📅 Agendado',
        hung_up: '🚪 Me cortó',
        placeholder_sent: '📧 Hold enviado'
      };
      return map[o] || o;
    }

    function renderCallsStats() {
      const country = document.getElementById('calls-country-filter').value;
      const today = new Date().toISOString().substring(0, 10);
      let pool = callsLeadsCache;
      if (country) pool = pool.filter(l => (l.country || '').trim() === country);

      let callsToday = 0, answeredToday = 0;
      let scheduled = 0, dead = 0, pending = 0;

      pool.forEach(l => {
        const log = Array.isArray(l.callLog) ? l.callLog : [];
        log.forEach(entry => {
          if ((entry.ts || '').substring(0, 10) === today) {
            callsToday++;
            if (['answered_interested','answered_not_interested','scheduled_with_admin'].includes(entry.outcome)) answeredToday++;
          }
        });
        if (l.estado === 'agendado') scheduled++;
        if (['wrong','invalid'].includes(l.phoneStatus)) dead++;
        if (!l.callAttempts && !['descartado','agendado'].includes(l.estado)) pending++;
      });

      const pctAnswered = callsToday > 0 ? Math.round(answeredToday / callsToday * 100) + '%' : '—';
      document.getElementById('calls-stat-today').textContent = callsToday;
      document.getElementById('calls-stat-answered').textContent = pctAnswered;
      document.getElementById('calls-stat-scheduled').textContent = scheduled;
      document.getElementById('calls-stat-pending').textContent = pending;
      document.getElementById('calls-stat-dead').textContent = dead;
    }

    // ── Phase 6: Telnyx call handlers ─────────────────────────────────
    // Estado de la llamada activa actual (UI). Persistir leadId para luego
    // disparar disposition automática al colgar.
    let _telnyxCallState = { leadId: null, fromNumber: null, startedAt: 0, timerInterval: null, muted: false, scriptIdsUsed: [] };

    // ───────────────────────────────────────────────────────────────
    // Phase 6 Sprint 7: Transcripción Whisper post-llamada
    // Grabamos 2 streams separados (setter mic + lead audio) en memoria del
    // browser. Al colgar, los mandamos como base64 al backend. NO se persiste
    // audio — solo el transcript que vuelve queda en lead.callLog[].transcript.
    // ───────────────────────────────────────────────────────────────
    let _setterRecorder = null;
    let _leadRecorder = null;
    let _setterChunks = [];
    let _leadChunks = [];
    let _localStreamForRecording = null;

    function _startCallRecording(localStream, remoteStream) {
      _setterChunks = [];
      _leadChunks = [];
      _localStreamForRecording = localStream; // referencia para detener tracks al hangup
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      if (!mimeType) {
        console.warn('[transcribe] MediaRecorder no soporta webm — transcripción deshabilitada');
        return;
      }
      try {
        if (localStream) {
          _setterRecorder = new MediaRecorder(localStream, { mimeType, audioBitsPerSecond: 32000 });
          _setterRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) _setterChunks.push(e.data); };
          _setterRecorder.start(1000); // chunk cada 1s
        }
        if (remoteStream) {
          _leadRecorder = new MediaRecorder(remoteStream, { mimeType, audioBitsPerSecond: 32000 });
          _leadRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) _leadChunks.push(e.data); };
          _leadRecorder.start(1000);
        }
        console.log('[transcribe] Grabación iniciada (setter + lead)');
      } catch (e) {
        console.warn('[transcribe] start failed:', e.message);
      }
    }

    async function _stopCallRecordingAndTranscribe(leadId, callStartedAtIso) {
      // Detener recorders. Esperamos un poco para que el último chunk caiga.
      const stopRecorder = (rec) => new Promise((resolve) => {
        if (!rec || rec.state === 'inactive') { resolve(); return; }
        rec.addEventListener('stop', () => resolve(), { once: true });
        try { rec.stop(); } catch { resolve(); }
      });
      await Promise.all([stopRecorder(_setterRecorder), stopRecorder(_leadRecorder)]);
      _setterRecorder = null;
      _leadRecorder = null;
      // Detener tracks del local stream para liberar el mic
      if (_localStreamForRecording) {
        try { _localStreamForRecording.getTracks().forEach(t => t.stop()); } catch {}
        _localStreamForRecording = null;
      }
      const setterBlob = _setterChunks.length ? new Blob(_setterChunks, { type: 'audio/webm' }) : null;
      const leadBlob = _leadChunks.length ? new Blob(_leadChunks, { type: 'audio/webm' }) : null;
      _setterChunks = [];
      _leadChunks = [];
      // Si no hay audio o llamada muy corta, no transcribir
      const totalBytes = (setterBlob?.size || 0) + (leadBlob?.size || 0);
      if (totalBytes < 5000) {
        console.log('[transcribe] Audio muy corto (<5KB), saltando');
        return;
      }
      // Convertir a base64
      const blobToB64 = (blob) => new Promise((resolve) => {
        if (!blob) { resolve(null); return; }
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          const b64 = (dataUrl || '').split(',')[1] || null;
          resolve(b64);
        };
        reader.readAsDataURL(blob);
      });
      try {
        window.showToast?.('🎤 Transcribiendo llamada (Whisper)…', { type: 'info', duration: 4000 });
        const [setterAudioB64, leadAudioB64] = await Promise.all([
          blobToB64(setterBlob),
          blobToB64(leadBlob),
        ]);
        const r = await fetch(apiUrl(`/api/telnyx/calls/${encodeURIComponent(leadId)}/transcribe`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ setterAudioB64, leadAudioB64, mimeType: 'audio/webm', callStartedAt: callStartedAtIso || null }),
        });
        if (!r.ok) {
          let msg = 'HTTP ' + r.status;
          try { const d = await r.json(); if (d?.error) msg = d.error; } catch {}
          console.warn('[transcribe] Error:', msg);
          window.showToast?.('Transcripción no disponible: ' + msg, { type: 'warn', duration: 5000 });
          return;
        }
        const d = await r.json();
        console.log('[transcribe] OK, segments:', d.segmentCount);
        window.showToast?.(`✓ Transcripción lista (${d.segmentCount} fragmentos)`, { type: 'success' });
      } catch (e) {
        console.warn('[transcribe] failed:', e?.message || e);
      }
    }

    // Ringback tone local (440Hz + 480Hz, patrón US: 2s ON / 4s OFF).
    // Telnyx WebRTC v2 NO reproduce el ringback del carrier automáticamente
    // — el setter no escucharía nada mientras suena en el destino. Sintetizamos
    // el tono localmente con Web Audio API. Se inicia en 'ringing' y se detiene
    // en 'answered' / hangup / error / destroy.
    let _ringbackCtx = null;
    let _ringbackNodes = null;
    function _startRingbackTone() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!_ringbackCtx) _ringbackCtx = new Ctx();
        if (_ringbackCtx.state === 'suspended') _ringbackCtx.resume().catch(() => {});
        if (_ringbackNodes) _stopRingbackTone();
        const ctx = _ringbackCtx;
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator(); osc1.type = 'sine'; osc1.frequency.value = 440;
        const osc2 = ctx.createOscillator(); osc2.type = 'sine'; osc2.frequency.value = 480;
        const gain = ctx.createGain(); gain.gain.value = 0;
        // Programar 20 ciclos de 6s = 2min de ringback. Suficiente: si nadie
        // atiende en 2min cancelás vos. El SDK también puede emitir 'hangup'
        // por timeout antes y _stopRingbackTone() corta los osciladores.
        const cycleDuration = 6; // 2s ON + 4s OFF
        for (let i = 0; i < 20; i++) {
          const cycleStart = now + (i * cycleDuration);
          gain.gain.setValueAtTime(0, cycleStart);
          gain.gain.linearRampToValueAtTime(0.12, cycleStart + 0.04);
          gain.gain.setValueAtTime(0.12, cycleStart + 2);
          gain.gain.linearRampToValueAtTime(0, cycleStart + 2.04);
        }
        osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
        osc1.start(now); osc2.start(now);
        _ringbackNodes = { osc1, osc2, gain };
      } catch (e) { console.warn('[ringback] start failed:', e.message); }
    }
    function _stopRingbackTone() {
      if (!_ringbackNodes) return;
      try {
        _ringbackNodes.osc1.stop(); _ringbackNodes.osc2.stop();
        _ringbackNodes.osc1.disconnect(); _ringbackNodes.osc2.disconnect();
        _ringbackNodes.gain.disconnect();
      } catch {}
      _ringbackNodes = null;
    }

    function _updateTelnyxCallTimer() {
      if (!_telnyxCallState.startedAt) return;
      const secs = Math.floor((Date.now() - _telnyxCallState.startedAt) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      const el = document.getElementById('telnyx-call-timer');
      if (el) el.textContent = `${mm}:${ss}`;
    }

    function _closeTelnyxCallPanel() {
      const panel = document.getElementById('telnyx-call-panel');
      if (panel) panel.style.display = 'none';
      // Backdrop fade out
      const backdrop = document.getElementById('telnyx-call-backdrop');
      if (backdrop) backdrop.style.display = 'none';
      // Sprint 15: quitar indicador "has-active-call" del body
      document.body.classList.remove('has-active-call');
      // Limpiar ficha y histórico
      const leadfile = document.getElementById('telnyx-call-leadfile');
      if (leadfile) leadfile.style.display = 'none';
      const history = document.getElementById('telnyx-call-history');
      if (history) history.style.display = 'none';
      // También cerrar el script panel si quedó abierto
      const sp = document.getElementById('telnyx-script-panel');
      if (sp) sp.style.display = 'none';
      document.body.classList.remove('tlx-script-open');
      // Reset mute button visual
      const muteBtn = document.getElementById('telnyx-call-mute');
      if (muteBtn) { muteBtn.classList.remove('tlx-mute-active'); muteBtn.textContent = '🎤 Mute'; }
      if (_telnyxCallState.timerInterval) { clearInterval(_telnyxCallState.timerInterval); _telnyxCallState.timerInterval = null; }
      if (_telnyxCallState.noAnswerTimeout) { clearTimeout(_telnyxCallState.noAnswerTimeout); _telnyxCallState.noAnswerTimeout = null; }
      // Audit fix: liberar tracks del mic si quedaron abiertos (ej. si ensureClient
      // falló después de getUserMedia). Sin esto el mic queda tomado hasta refresh.
      if (_telnyxCallState.localStreamForRec) {
        try { _telnyxCallState.localStreamForRec.getTracks().forEach(t => t.stop()); } catch {}
        _telnyxCallState.localStreamForRec = null;
      }
      _telnyxCallState.startedAt = 0;
      _telnyxCallState.muted = false;
      _telnyxCallState.statusState = null;
      _telnyxCallState.scriptIdsUsed = [];
      _currentCallLead = null;
    }

    // Ficha del lead durante la llamada: muestra todos los datos scrapeados
    // (rating, reseñas, dirección, sitio, instagram, fb, doctor) + quick-links
    // para abrir website / Google Maps / Instagram en pestaña nueva sin perder
    // el contexto de la llamada.
    function _renderLeadFile(lead) {
      const box = document.getElementById('telnyx-call-leadfile');
      const content = document.getElementById('telnyx-call-leadfile-content');
      const links = document.getElementById('telnyx-call-leadfile-quicklinks');
      if (!box || !content) return;
      if (!lead) { box.style.display = 'none'; return; }
      const rows = [];
      // Sprint 24: Nota pre-call — destacada al tope (lo que el setter
      // preparó antes de discar). Si está vacía, no se renderiza.
      if (lead.precallNote && lead.precallNote.trim()) {
        rows.push(`<div style="background:linear-gradient(135deg, rgba(255,179,65,0.12) 0%, rgba(255,179,65,0.04) 100%); border:1px solid rgba(255,179,65,0.35); border-left:3px solid #FFB341; padding:8px 11px; border-radius:8px; margin-bottom:8px;">
          <div style="font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:#FFB341; margin-bottom:4px;">🎯 Pre-call</div>
          <div style="color:#fff; font-size:12px; line-height:1.45; white-space:pre-wrap;">${escHtml(lead.precallNote)}</div>
        </div>`);
      }
      if (lead.doctor && !lead.doctor.includes('N/A')) rows.push(`<div><strong style="color:#fff;">Doctor:</strong> ${escHtml(lead.doctor)}</div>`);
      if (lead.address) rows.push(`<div><strong style="color:rgba(255,255,255,0.55);">📍</strong> ${escHtml(lead.address)}</div>`);
      const ratingReviews = [];
      if (lead.rating) ratingReviews.push(`★ ${escHtml(String(lead.rating))}`);
      if (lead.reviews) ratingReviews.push(`${lead.reviews} reseñas`);
      if (ratingReviews.length) rows.push(`<div><strong style="color:#FFB341;">${ratingReviews.join(' · ')}</strong></div>`);
      if (lead.email && !lead.email.includes('N/A')) rows.push(`<div><strong style="color:rgba(255,255,255,0.55);">✉</strong> ${escHtml(lead.email)}</div>`);
      // Notas previas (últimas 2)
      const recentNotes = (lead.notes || []).slice(-2);
      if (recentNotes.length) {
        const notesHtml = recentNotes.map(n => `<div style="margin-top:4px; padding-left:8px; border-left:2px solid rgba(157,133,242,0.3); color:rgba(255,255,255,0.65);">📝 ${escHtml((n.text || '').substring(0, 100))}${(n.text || '').length > 100 ? '…' : ''}</div>`).join('');
        rows.push(`<div style="margin-top:6px;">${notesHtml}</div>`);
      }
      if (rows.length === 0) {
        box.style.display = 'none';
        return;
      }
      box.style.display = 'block';
      content.innerHTML = rows.join('');
      // Quick-links: abrir website / Google Maps / Instagram / Facebook en pestaña nueva
      // Sprint 37 (VULN-A1): todos los href pasan por safeUrl
      const linkBtns = [];
      if (lead.website && !lead.website.includes('N/A')) {
        const safeW = safeUrl(lead.website);
        if (safeW) linkBtns.push(`<a href="${escHtml(safeW)}" target="_blank" rel="noopener noreferrer" title="Abrir sitio web" style="font-size:11px; padding:2px 7px; background:rgba(125,211,252,0.12); border:1px solid rgba(125,211,252,0.3); color:#7dd3fc; border-radius:5px; text-decoration:none;">🌐 Web</a>`);
      }
      // Google Maps directo desde nombre + ciudad
      if (lead.name) {
        const mapsQuery = encodeURIComponent(`${lead.name} ${lead.city || ''} ${lead.country || ''}`.trim());
        linkBtns.push(`<a href="https://www.google.com/maps/search/?api=1&query=${mapsQuery}" target="_blank" rel="noopener" title="Buscar en Google Maps" style="font-size:11px; padding:2px 7px; background:rgba(91,185,116,0.12); border:1px solid rgba(91,185,116,0.3); color:#5bb974; border-radius:5px; text-decoration:none;">🗺 Maps</a>`);
      }
      if (lead.instagram && !lead.instagram.includes('N/A')) {
        const igRaw = String(lead.instagram).trim();
        const igUrl = igRaw.startsWith('http') ? safeUrl(igRaw) : `https://www.instagram.com/${igRaw.replace(/^@/, '').replace(/[^a-zA-Z0-9_.]/g, '')}/`;
        if (igUrl) linkBtns.push(`<a href="${escHtml(igUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir Instagram" style="font-size:11px; padding:2px 7px; background:rgba(248,81,73,0.12); border:1px solid rgba(248,81,73,0.3); color:#f85149; border-radius:5px; text-decoration:none;">📷 IG</a>`);
      }
      if (lead.facebook && !lead.facebook.includes('N/A')) {
        const fbRaw = String(lead.facebook).trim();
        const fbUrl = fbRaw.startsWith('http') ? safeUrl(fbRaw) : `https://www.facebook.com/${fbRaw.replace(/[^a-zA-Z0-9_.\-]/g, '')}`;
        if (fbUrl) linkBtns.push(`<a href="${escHtml(fbUrl)}" target="_blank" rel="noopener noreferrer" title="Abrir Facebook" style="font-size:11px; padding:2px 7px; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); color:#3b82f6; border-radius:5px; text-decoration:none;">📘 FB</a>`);
      }
      if (links) links.innerHTML = linkBtns.join('');
    }

    // Histórico inline: si el lead ya tiene callLog, mostrar último intento.
    // Permite al setter saber "ya lo llamé el lunes y dijo X" sin ir a buscar.
    function _renderCallHistory(lead) {
      const box = document.getElementById('telnyx-call-history');
      const content = document.getElementById('telnyx-call-history-content');
      if (!box || !content) return;
      const log = (lead && Array.isArray(lead.callLog)) ? lead.callLog : [];
      if (log.length === 0) { box.style.display = 'none'; return; }
      const last = log[log.length - 1];
      const lastDate = new Date(last.ts);
      const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
      const daysTxt = daysAgo === 0 ? 'hoy' : daysAgo === 1 ? 'ayer' : `hace ${daysAgo} días`;
      const outcomeMap = {
        answered_interested: '✅ Interesado',
        answered_not_interested: '❌ No interesado',
        no_answer: '📵 No atendió',
        voicemail: '📭 Buzón',
        wrong_number: '🔢 Número equivocado',
        invalid_number: '🚫 No existe',
        callback_later: '🔄 Callback',
        scheduled_with_admin: '📅 Agendado',
      };
      const outcomeTxt = outcomeMap[last.outcome] || last.outcome || '—';
      const duration = last.duration ? ` · ${Math.floor(last.duration / 60)}:${String(last.duration % 60).padStart(2, '0')}` : '';
      const attemptsCount = log.length;
      content.innerHTML = `
        <div><strong>${outcomeTxt}</strong> — ${daysTxt}${duration}</div>
        ${last.notes ? `<div style="margin-top:3px; font-size:10.5px; color:rgba(255,255,255,0.55); font-style:italic;">"${escHtml(last.notes.substring(0, 120))}${last.notes.length > 120 ? '…' : ''}"</div>` : ''}
        ${attemptsCount > 1 ? `<div style="margin-top:3px; font-size:10px; color:rgba(255,255,255,0.4);">${attemptsCount} intentos totales</div>` : ''}
      `;
      box.style.display = 'block';
    }

    function _setTelnyxCallStatus(text, state) {
      _telnyxCallState.statusState = state;
      const statusEl = document.getElementById('telnyx-call-status');
      const dotEl = document.getElementById('telnyx-call-status-dot');
      if (statusEl) statusEl.textContent = text;
      if (dotEl) {
        // Colores explícitos en hex para asegurar que se vean bien
        const colorMap = {
          connecting: '#FFB341',  // ámbar
          ringing: '#FFB341',     // ámbar (mismo, suena)
          active: '#5BB974',      // verde
          ending: '#9CA3AF',      // gris
        };
        const color = colorMap[state] || '#FFB341';
        dotEl.style.background = color;
        dotEl.style.boxShadow = `0 0 12px ${color}`;
        // Detener animación cuando está en estado "active" o "ending"
        dotEl.style.animation = (state === 'active' || state === 'ending')
          ? 'none' : 'tlxPulse 1.4s ease-in-out infinite';
      }
    }

    // Inicia una llamada Telnyx WebRTC para un lead.
    // Flow: ensureClient() -> abre panel -> client.newCall() -> wire eventos.
    window._startTelnyxCall = async (leadId) => {
      const lead = _callsLeadsById.get(leadId);
      if (!lead?.phone) {
        window.showToast?.('Este lead no tiene teléfono cargado', { type: 'error' });
        return;
      }
      if (_telnyx.activeCall) {
        window.showToast?.('Ya tenés una llamada activa', { type: 'warn' });
        return;
      }
      const fromNum = _telnyx.pickNumberForDestination(lead.phone);
      if (!fromNum) {
        window.showToast?.('No hay número saliente configurado para este destino. Admin debe agregar uno en Centralita Telnyx.', { type: 'error', duration: 6000 });
        return;
      }

      // Abrir panel con estado inicial
      const panel = document.getElementById('telnyx-call-panel');
      const leadName = lead.name || '(sin nombre)';
      document.getElementById('telnyx-call-lead-name').textContent = leadName;
      document.getElementById('telnyx-call-lead-meta').textContent = `${lead.phone}${lead.city ? ' · ' + lead.city : ''}${lead.country ? ' · ' + lead.country : ''}`;
      // Avatar: 2 iniciales del nombre (o phone si no hay nombre)
      const initials = (() => {
        const words = leadName.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ\s]/g, '').trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) return '?';
        if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
        return (words[0][0] + words[1][0]).toUpperCase();
      })();
      const avatarEl = document.getElementById('telnyx-call-avatar');
      if (avatarEl) avatarEl.textContent = initials;
      document.getElementById('telnyx-call-from').textContent = `${fromNum.label || fromNum.country || 'Línea'} · ${fromNum.phone}`;
      _setTelnyxCallStatus('Conectando…', 'connecting');
      document.getElementById('telnyx-call-timer').textContent = '00:00';
      // Limpiar nota rápida del panel anterior
      const quickNoteEl = document.getElementById('telnyx-call-quick-note');
      if (quickNoteEl) quickNoteEl.value = '';
      // Ficha del lead + histórico (datos scrapeados disponibles durante la llamada)
      _renderLeadFile(lead);
      _renderCallHistory(lead);
      // Mostrar backdrop primero, después el panel (orden visual correcto)
      const backdrop = document.getElementById('telnyx-call-backdrop');
      if (backdrop) backdrop.style.display = 'block';
      panel.style.display = 'block';
      // Sprint 15: indicador visual en el sidebar logo (pulse) que hay llamada activa
      document.body.classList.add('has-active-call');
      _telnyxCallState.leadId = leadId;
      _telnyxCallState.fromNumber = fromNum.phone;
      _telnyxCallState.muted = false;
      _telnyxCallState.scriptIdsUsed = []; // Sprint 12: tracking A/B
      _currentCallLead = lead;
      // Pre-cargar scripts si no están en cache (no bloquea la llamada)
      if (_callScriptsCache.length === 0) _loadCallScripts();

      try {
        // Pedir permisos de mic upfront (mejor UX que esperar a Telnyx)
        // Guardamos la referencia para grabar tambien (Sprint 7: transcripcion)
        let localStreamForRec = null;
        try {
          localStreamForRec = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        catch (micErr) {
          _closeTelnyxCallPanel();
          window.showToast?.('Necesitamos permiso del micrófono. Habilitalo en el ícono del candado de la URL y reintentá.', { type: 'error', duration: 8000 });
          return;
        }
        // Guardar para iniciar recording cuando entremos en state='active'
        _telnyxCallState.localStreamForRec = localStreamForRec;

        await _telnyx.ensureClient();
        // Sprint 19: sanitize phone a E.164 estricto antes de pasar a Telnyx.
        // Los leads scrapeados pueden venir con espacios "+591 77750733" o
        // formato raro. Telnyx WebRTC necesita E.164 limpio (+591777507333).
        const cleanDestination = _sanitizePhoneE164(lead.phone);
        if (!cleanDestination) {
          window.showToast?.('Teléfono inválido: ' + (lead.phone || '(vacío)'), { type: 'error' });
          _closeTelnyxCallPanel();
          return;
        }
        const cleanCaller = _sanitizePhoneE164(fromNum.phone);
        const call = _telnyx.client.newCall({
          destinationNumber: cleanDestination,
          callerNumber: cleanCaller || fromNum.phone,
          callerName: 'SCM',
          audio: true,
          video: false,
          // CRÍTICO: el SDK lee remoteElement de options del CALL (no solo del
          // client). Sin esto, attachMediaStream() del SDK puede no encontrar
          // el element y no monta el audio entrante. Confirmado via inspección
          // del source: BaseCall.options.remoteElement es lo que usa el handler
          // 'track' del RTCPeerConnection.
          remoteElement: 'telnyx-remote-audio',
        });
        _telnyx.activeCall = call;
        _telnyxCallState.startedAt = Date.now();
        _telnyxCallState.timerInterval = setInterval(_updateTelnyxCallTimer, 1000);
        _setTelnyxCallStatus('Sonando…', 'ringing');
        // Audio de ringback local — sin esto el setter no escucha nada mientras
        // suena en el destino y cree que se rompió la llamada.
        _startRingbackTone();
        // Los eventos del call vienen por 'telnyx.notification' en el CLIENT
        // (configurado en ensureClient). No usamos call.on() — eso es API de
        // v1 / Twilio. En v2 todos los state changes son via client notifications.

        // Safety timeout: si después de 60s seguimos en estado 'ringing'
        // (nadie atendió), cortamos para no quedar colgados infinitos.
        _telnyxCallState.noAnswerTimeout = setTimeout(() => {
          if (_telnyx.activeCall && _telnyxCallState.startedAt) {
            const secs = Math.floor((Date.now() - _telnyxCallState.startedAt) / 1000);
            // Si pasaron 60s y nunca llegamos a "active" → asumir no answer
            if (secs >= 60 && _telnyxCallState.statusState !== 'active') {
              console.log('[telnyx] No answer timeout (60s), hanging up');
              try { call.hangup(); } catch {}
              _stopRingbackTone();
              _onTelnyxCallEnded('no_answer_timeout');
            }
          }
        }, 60000);
      } catch (e) {
        console.error('[telnyx] startCall failed:', e);
        _closeTelnyxCallPanel();
        window.showToast?.('No se pudo iniciar la llamada: ' + e.message, { type: 'error', duration: 6000 });
      }
    };

    // Llamado al colgar (por cualquier lado: usuario, destino, error).
    // Cierra panel y dispara modal de disposition automático.
    function _onTelnyxCallEnded(reason) {
      const leadId = _telnyxCallState.leadId;
      const durationSecs = _telnyxCallState.startedAt ? Math.floor((Date.now() - _telnyxCallState.startedAt) / 1000) : 0;
      _setTelnyxCallStatus('Finalizando…', 'ending');
      _stopRingbackTone(); // safety: si llegamos acá sin pasar por los listeners
      _telnyx.activeCall = null;
      // Sprint 7: detener recording + disparar transcripción Whisper en background.
      // Solo si la llamada llegó a ser activa (durationSecs > 5 — descarta cuelgues
      // rápidos sin audio significativo).
      if (leadId && durationSecs >= 5 && (_setterRecorder || _leadRecorder)) {
        // No bloquear el cierre del panel por esperar transcripción.
        // Pasar el callStartedAt para que el backend matchee el callLog correcto
        const callStartedAtIso = _telnyxCallState.startedAt ? new Date(_telnyxCallState.startedAt).toISOString() : null;
        _stopCallRecordingAndTranscribe(leadId, callStartedAtIso).catch(e => console.warn('[transcribe] fire-and-forget failed:', e?.message));
      } else {
        // Limpieza si no transcribimos
        try { _setterRecorder?.stop(); } catch {}
        try { _leadRecorder?.stop(); } catch {}
        if (_localStreamForRecording) { try { _localStreamForRecording.getTracks().forEach(t => t.stop()); } catch {}; _localStreamForRecording = null; }
        _setterRecorder = null; _leadRecorder = null;
        _setterChunks = []; _leadChunks = [];
      }
      setTimeout(() => {
        _closeTelnyxCallPanel();
        // Disparar disposition automática solo si la llamada conectó (al menos 1s).
        // Si fue <1s probablemente ni siquiera sonó — no llenar el callLog con ruido.
        if (leadId && durationSecs >= 1) {
          window.showToast?.(`Llamada finalizada · ${Math.floor(durationSecs/60)}:${String(durationSecs%60).padStart(2,'0')} · Marcá el resultado abajo ↓`, { type: 'info', duration: 5000 });
          // Capturar la nota rápida ANTES de cerrar el panel
          const quickNoteText = document.getElementById('telnyx-call-quick-note')?.value?.trim() || '';
          // Guardar metadata pendiente para que el próximo handleCallDisposition la incluya
          _pendingTelnyxCallMetadata[leadId] = {
            durationSecs,
            fromNumber: _telnyxCallState.fromNumber,
            endedAt: new Date().toISOString(),
            quickNote: quickNoteText || null,
            scriptIdsUsed: _telnyxCallState.scriptIdsUsed.slice(), // Sprint 12: A/B tracking
          };
          // Scroll + flash + open al dropdown de disposition
          const callRow = document.querySelector(`.call-row[data-id="${leadId}"]`);
          const dispositionSel = callRow?.querySelector('select');
          if (callRow) {
            callRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Flash visual para destacar (3 pulsos)
            callRow.style.transition = 'box-shadow 0.4s';
            callRow.style.boxShadow = '0 0 0 3px var(--accent)';
            setTimeout(() => { callRow.style.boxShadow = '0 0 0 1px var(--accent)'; }, 400);
            setTimeout(() => { callRow.style.boxShadow = '0 0 0 3px var(--accent)'; }, 800);
            setTimeout(() => { callRow.style.boxShadow = ''; }, 2400);
          }
          if (dispositionSel) {
            setTimeout(() => dispositionSel.focus(), 400);
            // Shortcut numérico 1-7 para elegir disposition rápido sin tocar mouse
            // Solo activo durante 30s post-cuelgue mientras el dropdown está en foco.
            const shortcutMap = {
              '1': 'answered_interested', '2': 'answered_not_interested',
              '3': 'no_answer', '4': 'voicemail', '5': 'callback_later',
              '6': 'wrong_number', '7': 'invalid_number',
            };
            // Audit fix: limpiar handler anterior si quedó colgado de una llamada previa
            // (sino se acumulan listeners si haces 2-3 llamadas en <30s).
            if (window._activeDispositionShortcut) {
              document.removeEventListener('keydown', window._activeDispositionShortcut);
            }
            const keyHandler = (e) => {
              if (shortcutMap[e.key]) {
                // Verificar que el dispositionSel siga en el DOM (puede haber sido re-renderizado)
                if (!dispositionSel.isConnected) {
                  document.removeEventListener('keydown', keyHandler);
                  if (window._activeDispositionShortcut === keyHandler) window._activeDispositionShortcut = null;
                  return;
                }
                const targetOption = dispositionSel.querySelector(`option[value="${shortcutMap[e.key]}"]`);
                if (targetOption) {
                  dispositionSel.value = shortcutMap[e.key];
                  dispositionSel.dispatchEvent(new Event('change'));
                  document.removeEventListener('keydown', keyHandler);
                  if (window._activeDispositionShortcut === keyHandler) window._activeDispositionShortcut = null;
                }
              }
            };
            window._activeDispositionShortcut = keyHandler;
            document.addEventListener('keydown', keyHandler);
            // Auto-remove después de 30s para no quedarse listening
            setTimeout(() => {
              document.removeEventListener('keydown', keyHandler);
              if (window._activeDispositionShortcut === keyHandler) window._activeDispositionShortcut = null;
            }, 30000);
          }
        }
      }, 500);
    }

    // Map de metadata pendiente: leadId → { durationSecs, fromNumber, endedAt }
    // Se popula en _onTelnyxCallEnded y se consume en _handleCallDisposition
    // para enriquecer el callLog con datos reales de la llamada Telnyx.
    const _pendingTelnyxCallMetadata = {};

    // ── Script panel (banco de guiones durante la llamada) ──
    let _callScriptsCache = [];
    let _currentCallLead = null; // se setea en _startTelnyxCall, usado para interpolar variables

    async function _loadCallScripts() {
      try {
        const r = await fetch(apiUrl('/api/telnyx/scripts'), { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        _callScriptsCache = d.scripts || [];
      } catch (e) { console.warn('[call-scripts]', e.message); }
    }

    function _interpolateScript(text, lead) {
      const setterName = window.__CURRENT_USER__?.name || window.__CURRENT_USER__?.email?.split('@')[0] || 'el equipo';
      // Reviews: si tenemos número, lo usamos; si no, fallback genérico
      const reviewsCount = lead?.reviews || lead?.reviewsCount || 0;
      const reviewsTxt = (typeof reviewsCount === 'number' && reviewsCount > 0)
        ? `${reviewsCount} reseñas` : 'varias reseñas';
      // Years: si tenemos años explícitos, los usamos. Si no, derivamos del
      // first_seen del scraping (fecha import) — eso no es real "antigüedad
      // del negocio" pero es una proxy razonable. Si tampoco, fallback genérico.
      let yearsTxt = 'varios años';
      if (lead?.yearsActive && typeof lead.yearsActive === 'number') {
        yearsTxt = `${lead.yearsActive} años`;
      } else if (lead?.importedAt) {
        const importedDate = new Date(lead.importedAt);
        const monthsAgo = Math.floor((Date.now() - importedDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
        if (monthsAgo > 12) yearsTxt = 'varios años';
      }
      const repl = {
        '{name}': (lead?.name || 'doctor/a').toString(),
        '{city}': lead?.city || lead?.country || 'la zona',
        '{country}': lead?.country || '',
        '{years}': yearsTxt,
        '{reviews}': reviewsTxt,
        '{rating}': lead?.rating ? `${lead.rating}★` : '',
        '{setterName}': setterName,
        '{setterPhone}': window.__CURRENT_USER__?.phone || '',
        '{date}': new Date().toLocaleDateString('es-AR'),
        '{time}': new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      };
      let result = text;
      for (const [k, v] of Object.entries(repl)) result = result.split(k).join(v);
      return result;
    }

    function _renderScriptPanel() {
      const triggersBar = document.getElementById('telnyx-script-triggers');
      const textEl = document.getElementById('telnyx-script-text');
      if (!triggersBar || !textEl) return;
      if (_callScriptsCache.length === 0) {
        triggersBar.innerHTML = '<span class="muted" style="font-size:11px;">Sin guiones cargados</span>';
        textEl.textContent = 'Pedile al admin que agregue guiones desde Centralita Telnyx.';
        return;
      }
      // Cache para filtrado por buscador (lo usa el listener del input)
      _renderScriptButtons(_callScriptsCache, '');
      // Pre-cargar primer script no-meta. Saltea 'rules' (son referencia, no
      // se "lee" durante una llamada — están en la PACE card sticky).
      const firstActionable = _callScriptsCache.find(s => s.trigger !== 'rules') || _callScriptsCache[0];
      if (firstActionable) _selectScript(firstActionable.id);
    }

    // Render solo los botones (factorizado para que el buscador pueda re-render).
    // Excluye scripts trigger='rules' del flow (están en PACE card + son meta).
    function _renderScriptButtons(scripts, searchQuery) {
      const triggersBar = document.getElementById('telnyx-script-triggers');
      if (!triggersBar) return;
      const q = (searchQuery || '').toLowerCase().trim();
      // Excluir scripts meta (rules) — esos están en la PACE card sticky arriba
      let pool = scripts.filter(s => s.trigger !== 'rules');
      if (q) {
        pool = pool.filter(s =>
          (s.label || '').toLowerCase().includes(q) ||
          (s.text || '').toLowerCase().includes(q) ||
          (Array.isArray(s.tags) && s.tags.some(t => (t || '').toLowerCase().includes(q)))
        );
      }
      // Orden del flow de llamada
      const triggerOrder = [
        'before_call', 'gatekeeper', 'opener', 'pitch',
        'ask_meeting', 'confirm',
        'objection_brushoff', 'objection_real',
        'callback', 'whatsapp_msg', 'email_template',
        'first_call', 'objection', 'scheduling', 'voicemail', 'general',
      ];
      const grouped = {};
      for (const s of pool) {
        const t = s.trigger || 'general';
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(s);
      }
      const triggerLabels = {
        before_call: '✅ Pre-call', gatekeeper: '🚪 Recepción',
        opener: '🎯 Apertura', pitch: '💡 Pitch',
        ask_meeting: '📅 Pedir reunión', confirm: '🔒 Confirmar',
        objection_brushoff: '⚡ Brush-off', objection_real: '🛡️ Real',
        callback: '🔄 Callback', whatsapp_msg: '💬 WhatsApp', email_template: '📧 Email',
        first_call: '🎯 Apertura', objection: '🛡️ Objeción',
        scheduling: '📅 Cerrar', voicemail: '📭 Buzón', general: '📝 General',
      };
      const triggerColors = {
        before_call: '#7dd3fc',
        gatekeeper: '#5bb974', opener: '#5bb974', pitch: '#5bb974',
        ask_meeting: '#FFB341', confirm: '#FFB341',
        objection_brushoff: '#FFB341', objection_real: '#f85149',
        callback: '#9D85F2', whatsapp_msg: '#5bb974', email_template: '#7dd3fc',
        first_call: '#5bb974', objection: '#f85149',
        scheduling: '#FFB341', voicemail: '#7dd3fc', general: 'rgba(255,255,255,0.5)',
      };
      const sortedTriggers = Object.keys(grouped).sort((a, b) => {
        const ai = triggerOrder.indexOf(a); const bi = triggerOrder.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
      if (sortedTriggers.length === 0) {
        triggersBar.innerHTML = '<span style="font-size:11px; color:rgba(255,255,255,0.4); padding:6px 4px;">Sin resultados para esa búsqueda.</span>';
        return;
      }
      triggersBar.innerHTML = sortedTriggers.map((trigger) => {
        const list = grouped[trigger];
        const color = triggerColors[trigger] || 'rgba(255,255,255,0.5)';
        return list.map(s => `
          <button class="tlx-script-btn" data-script-id="${escHtml(s.id)}" style="font-size:10.5px; padding:5px 10px; background:rgba(255,255,255,0.03); border:1px solid ${color}40; border-radius:7px; cursor:pointer; color:${color}; transition:all 0.15s; font-weight:500;">
            ${triggerLabels[trigger] || s.trigger} · ${escHtml(s.label)}
          </button>
        `).join('');
      }).join('');
      // Wire clicks
      triggersBar.querySelectorAll('.tlx-script-btn').forEach(btn => {
        btn.addEventListener('click', () => _selectScript(btn.dataset.scriptId));
      });
    }

    function _selectScript(scriptId) {
      const s = _callScriptsCache.find(x => x.id === scriptId);
      const textEl = document.getElementById('telnyx-script-text');
      if (!s || !textEl) return;
      textEl.textContent = _interpolateScript(s.text, _currentCallLead);
      textEl.dataset.scriptId = scriptId;
      // Sprint 12: trackear scripts usados en la llamada activa (solo si hay llamada)
      if (_telnyx.activeCall && _telnyxCallState.startedAt > 0 && !_telnyxCallState.scriptIdsUsed.includes(scriptId)) {
        _telnyxCallState.scriptIdsUsed.push(scriptId);
      }
      // Marcar botón activo (compat con el nuevo styling del panel rediseñado)
      document.querySelectorAll('.tlx-script-btn').forEach(btn => {
        const active = btn.dataset.scriptId === scriptId;
        if (active) {
          btn.style.background = 'rgba(157,133,242,0.18)';
          btn.style.borderColor = 'var(--accent)';
          btn.style.boxShadow = '0 0 0 1px rgba(157,133,242,0.4)';
          btn.style.fontWeight = '600';
        } else {
          btn.style.background = 'rgba(255,255,255,0.03)';
          btn.style.boxShadow = '';
          btn.style.fontWeight = '500';
          // El borderColor original se setea en el render — no lo tocamos
        }
      });
    }

    function _openScriptPanel() {
      const panel = document.getElementById('telnyx-script-panel');
      if (panel) panel.style.display = 'flex';
      // Body class triggers el shift del call panel a la izquierda vía CSS
      document.body.classList.add('tlx-script-open');
      if (_callScriptsCache.length === 0) _loadCallScripts().then(_renderScriptPanel);
      else _renderScriptPanel();
    }
    function _closeScriptPanel() {
      const panel = document.getElementById('telnyx-script-panel');
      if (panel) panel.style.display = 'none';
      document.body.classList.remove('tlx-script-open');
    }

    document.getElementById('telnyx-call-script-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('telnyx-script-panel');
      if (panel?.style.display === 'flex') _closeScriptPanel();
      else _openScriptPanel();
    });
    document.getElementById('telnyx-script-close')?.addEventListener('click', _closeScriptPanel);
    // Buscador interno del panel de scripts: re-renderiza botones filtrados
    document.getElementById('telnyx-script-search')?.addEventListener('input', (e) => {
      _renderScriptButtons(_callScriptsCache, e.target.value);
    });
    document.getElementById('telnyx-script-copy')?.addEventListener('click', async () => {
      const text = document.getElementById('telnyx-script-text')?.textContent || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        window.showToast?.('Guion copiado ✓', { type: 'success', duration: 1500 });
      } catch (e) { window.showToast?.('No pude copiar', { type: 'error' }); }
    });

    // Botón colgar del panel
    document.getElementById('telnyx-call-hangup')?.addEventListener('click', () => {
      if (_telnyx.activeCall) {
        try { _telnyx.activeCall.hangup(); } catch (e) { console.warn(e); }
        // El evento 'hangup' del call dispara _onTelnyxCallEnded; pero por las dudas:
        setTimeout(() => { if (_telnyxCallState.startedAt) _onTelnyxCallEnded('local_hangup'); }, 1500);
      } else {
        _closeTelnyxCallPanel();
      }
    });

    // Botón mute toggle — usa class .tlx-mute-active para el state visual
    // (definida en el <style> del panel). Evita el "blanco roto" al setear
    // style.background='' directo.
    document.getElementById('telnyx-call-mute')?.addEventListener('click', () => {
      const btn = document.getElementById('telnyx-call-mute');
      if (!btn || !_telnyx.activeCall) return;
      try {
        if (_telnyxCallState.muted) {
          if (typeof _telnyx.activeCall.unmuteAudio === 'function') _telnyx.activeCall.unmuteAudio();
          _telnyxCallState.muted = false;
          btn.textContent = '🎤 Mute';
          btn.classList.remove('tlx-mute-active');
        } else {
          if (typeof _telnyx.activeCall.muteAudio === 'function') _telnyx.activeCall.muteAudio();
          _telnyxCallState.muted = true;
          btn.textContent = '🔇 Muteado';
          btn.classList.add('tlx-mute-active');
        }
      } catch (e) { console.warn('[telnyx] mute toggle:', e); }
    });

    // Confirm exit si hay llamada activa
    window.addEventListener('beforeunload', (e) => {
      if (_telnyx.activeCall) {
        e.preventDefault();
        e.returnValue = 'Tenés una llamada activa. ¿Salir igual?';
        return e.returnValue;
      }
    });

    // Handler global para el dropdown de disposition
    window._handleCallDisposition = async (leadId, selectEl) => {
      const outcome = selectEl.value;
      if (!outcome) return;
      selectEl.disabled = true;

      try {
        if (outcome === 'callback_later') {
          openCallbackModal(leadId);
          selectEl.value = '';
          selectEl.disabled = false;
          return;
        }
        if (outcome === 'scheduled_with_admin') {
          openScheduleModal(leadId);
          selectEl.value = '';
          selectEl.disabled = false;
          return;
        }
        // 2026-05-30: cuando un solo usuario hace de setter+admin, "Interesado"
        // ya implica "agendar ahora". Abrimos el modal de agenda directo. Si
        // cancela, igual queda logueado como answered_interested (fallback).
        if (outcome === 'answered_interested') {
          openScheduleModal(leadId, { fallbackOnCancel: 'answered_interested' });
          selectEl.value = '';
          selectEl.disabled = false;
          return;
        }
        // Sprint 25: si dijo "No interesado", pedir motivo antes de descartar.
        // El popover deja saltear (skip) si el setter no quiere taggear.
        if (outcome === 'answered_not_interested') {
          openObjectionModal(leadId);
          selectEl.value = '';
          selectEl.disabled = false;
          return;
        }
        // Outcomes directos. Si hay metadata pendiente de una llamada Telnyx,
        // adjuntarla al payload para que el backend la persista en callLog.
        const telnyxMeta = _pendingTelnyxCallMetadata[leadId];
        const body = { outcome };
        if (telnyxMeta) {
          body.telnyxCallMeta = telnyxMeta;
          delete _pendingTelnyxCallMetadata[leadId];
        }
        // Nota rápida del Power Dialer (input pd-call-note). Solo existe en el
        // dialer; en la vista normal de Llamadas no está y queda vacío.
        const pdNoteEl = document.getElementById('pd-call-note');
        const pdNote = pdNoteEl?.value?.trim();
        if (pdNote) { body.notes = pdNote.slice(0, 500); if (pdNoteEl) pdNoteEl.value = ''; }
        const resp = await fetch(apiUrl('/api/setters/leads/' + leadId + '/call-disposition'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        // Actualizar cache local
        const idx = callsLeadsCache.findIndex(l => l.id === leadId);
        if (idx >= 0) callsLeadsCache[idx] = { ...callsLeadsCache[idx], ...data.lead, id: leadId };
        renderCallsList();
        renderCallsStats();
        // Audit fix Sprint 36 (bug 3): refrescar barra de quota tras cada disposition
        _callsRenderQuota?.();
      } catch (e) {
        alert('Error guardando: ' + e.message);
        selectEl.disabled = false;
      }
    };

    // Placeholder de calendario: cuando el prospect dice "mandame info y vemos",
    // en vez de mandar un mail que se ignora, mandamos un .ics tentativo.
    // Le aparece como bloque en su agenda con Aceptar / Proponer otro horario.
    function openPlaceholderModal(leadId) {
      const lead = _callsLeadsById.get(leadId);
      if (!lead) return;
      const modal = document.getElementById('call-placeholder-modal');
      const emailIn = document.getElementById('call-ph-email');
      const fechaIn = document.getElementById('call-ph-fecha');
      const durIn = document.getElementById('call-ph-duration');
      const noteIn = document.getElementById('call-ph-note');
      // Defaults
      emailIn.value = (lead.email || '').trim();
      const m = new Date(); m.setDate(m.getDate() + 1); m.setHours(11, 0, 0, 0);
      fechaIn.value = _toDatetimeLocal(m);
      durIn.value = '30';
      noteIn.value = '';

      // Quickpicks reusando los del callback (mañana 10am, etc.)
      const qp = document.getElementById('call-ph-quickpicks');
      if (qp) {
        const picks = _buildCallbackQuickPicks();
        qp.innerHTML = picks.map((p) => `<button type="button" class="ph-quickpick" data-iso="${p.date.toISOString()}" style="padding:7px 11px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:7px; color:var(--text-primary); font-size:11px; cursor:pointer; font-family:inherit;">${p.label}</button>`).join('');
        qp.querySelectorAll('.ph-quickpick').forEach(btn => {
          btn.addEventListener('click', () => {
            fechaIn.value = _toDatetimeLocal(new Date(btn.getAttribute('data-iso')));
            qp.querySelectorAll('.ph-quickpick').forEach(b => { b.style.borderColor = 'var(--border-subtle)'; b.style.background = 'var(--bg-surface)'; });
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'rgba(157,133,242,0.12)';
          });
        });
      }
      modal.classList.remove('hidden');

      document.getElementById('call-ph-confirm').onclick = async () => {
        const email = emailIn.value.trim();
        const when = fechaIn.value;
        const durationMins = parseInt(durIn.value, 10) || 30;
        const customNote = noteIn.value.trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Email inválido del prospect.'); return; }
        if (!when) { alert('Elegí fecha y hora.'); return; }
        const btn = document.getElementById('call-ph-confirm');
        btn.disabled = true; const old = btn.textContent; btn.textContent = 'Mandando…';
        try {
          const resp = await fetch(apiUrl('/api/setters/leads/' + leadId + '/send-placeholder'), {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ when: new Date(when).toISOString(), durationMins, email, customNote: customNote || undefined }),
          });
          const j = await resp.json().catch(() => ({}));
          if (!resp.ok) throw new Error(j.error || ('HTTP ' + resp.status));
          modal.classList.add('hidden');
          window.showToast?.(`✓ Hold enviado a ${email}`, { type: 'success', duration: 4000 });
          await loadCallsView();
        } catch (e) {
          alert('Error: ' + e.message);
          btn.disabled = false; btn.textContent = old;
        }
      };
    }
    window.openPlaceholderModal = openPlaceholderModal;

    function openCallbackModal(leadId) {
      const modal = document.getElementById('call-callback-modal');
      const fechaInput = document.getElementById('call-cb-fecha');
      // Default: mañana 10am hora local
      const m = new Date(); m.setDate(m.getDate() + 1); m.setHours(10, 0, 0, 0);
      fechaInput.value = _toDatetimeLocal(m);

      // Sprint 23: render quick-picks. Calculados al abrir el modal así
      // siempre son relativos a "ahora" (no se cachean stale).
      const picks = _buildCallbackQuickPicks();
      const qpWrap = document.getElementById('call-cb-quickpicks');
      if (qpWrap) {
        qpWrap.innerHTML = picks.map((p, i) => `<button type="button" class="cb-quickpick" data-iso="${p.date.toISOString()}" style="padding:9px 11px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; color:var(--text-primary); font-size:12px; cursor:pointer; text-align:left; transition:all 0.15s; font-family:inherit;">
          <div style="font-weight:600; font-size:11.5px;">${p.label}</div>
          <div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${p.subtitle}</div>
        </button>`).join('');
        qpWrap.querySelectorAll('.cb-quickpick').forEach(btn => {
          btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--accent)'; btn.style.background = 'rgba(157,133,242,0.06)'; });
          btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--border-subtle)'; btn.style.background = 'var(--bg-surface)'; });
          btn.addEventListener('click', () => {
            const iso = btn.getAttribute('data-iso');
            fechaInput.value = _toDatetimeLocal(new Date(iso));
            // Highlight selected
            qpWrap.querySelectorAll('.cb-quickpick').forEach(b => { b.style.borderColor = 'var(--border-subtle)'; b.style.background = 'var(--bg-surface)'; });
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'rgba(157,133,242,0.12)';
          });
        });
      }

      modal.classList.remove('hidden');
      document.getElementById('call-cb-confirm').onclick = async () => {
        const fecha = fechaInput.value;
        if (!fecha) { alert('Elegí una fecha'); return; }
        const confirmBtn = document.getElementById('call-cb-confirm');
        confirmBtn.disabled = true; const _oldTxt = confirmBtn.textContent; confirmBtn.textContent = 'Guardando…';
        try {
          const callbackIso = new Date(fecha).toISOString();
          const resp = await fetch(apiUrl('/api/setters/leads/' + leadId + '/call-disposition'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outcome: 'callback_later', callbackAt: callbackIso })
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          // Update optimista del cache ANTES de cerrar el modal. El poller del
          // Power Dialer (_pdHandleDisposition) lee lead.callbackAt para decidir si
          // avanza; sin esto hay un race con loadCallsView() (reconstruye el índice
          // async) y el dialer queda trabado en el mismo lead.
          const _ci = callsLeadsCache.findIndex(l => l.id === leadId);
          if (_ci >= 0) callsLeadsCache[_ci].callbackAt = callbackIso;
          const _cached = _callsLeadsById.get(leadId);
          if (_cached) _cached.callbackAt = callbackIso;
          modal.classList.add('hidden');
          await loadCallsView();
        } catch (e) {
          alert('Error: ' + e.message);
          confirmBtn.disabled = false; confirmBtn.textContent = _oldTxt;
        }
      };
    }

    // Sprint 23: helper para input datetime-local (necesita formato sin timezone)
    function _toDatetimeLocal(d) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // Sprint 25: modal para taggear objeción al marcar "No interesado".
    // Se puede saltar (skip) si el setter no quiere etiquetar. Feed para
    // Mercury IA + analytics de objeciones más comunes.
    const OBJECTION_TAGS = [
      { key: 'precio',             label: '💸 Precio',           hint: 'Caro / no tiene presupuesto' },
      { key: 'ya_tiene_sistema',   label: '⚙️ Ya tiene sistema', hint: 'Trabaja con otra agencia/CRM' },
      { key: 'tiempo',             label: '⏳ Tiempo',           hint: 'No tiene tiempo ahora' },
      { key: 'no_es_decisor',      label: '🪑 No es decisor',    hint: 'Hay que hablar con otra persona' },
      { key: 'no_entiende_valor',  label: '🤷 No entiende valor',hint: 'No vio el ROI claro' },
      { key: 'desconfia',          label: '🛑 Desconfía',        hint: 'No cree / cree que es scam' },
      { key: 'mal_momento',        label: '📆 Mal momento',      hint: 'Vacaciones, mudanza, etc.' },
      { key: 'otra',               label: '➕ Otra',             hint: 'Distinta a las anteriores' },
    ];
    function openObjectionModal(leadId) {
      let modal = document.getElementById('call-objection-modal');
      if (!modal) {
        // Inyectar el modal una sola vez
        modal = document.createElement('div');
        modal.id = 'call-objection-modal';
        modal.className = 'modal-overlay hidden';
        modal.style.zIndex = '10000';
        modal.innerHTML = `<div class="modal-card" style="max-width:480px; width:95vw;">
          <div class="modal-header">
            <h3>❌ ¿Por qué dijo que no?</h3>
            <button type="button" aria-label="Cerrar" onclick="document.getElementById('call-objection-modal').classList.add('hidden')" style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer;">✕</button>
          </div>
          <div style="padding:18px 22px;">
            <p style="color:var(--text-secondary); font-size:12.5px; margin:0 0 14px; line-height:1.5;">Elegí uno o más motivos (multi-select). Los tags alimentan al Mercury IA y muestran qué objeciones son las más comunes. Podés saltearlo si no querés taggear.</p>
            <div id="call-obj-tags" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:6px; margin-bottom:16px;"></div>
            <label style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px; display:block; margin-bottom:6px; font-weight:600;">Nota libre (opcional)</label>
            <textarea id="call-obj-note" rows="2" placeholder="Ej: dijo que está pensando en cerrar la clínica…" style="width:100%; padding:9px 11px; border-radius:8px; border:1px solid var(--border-default); background:var(--bg-input); color:var(--text-primary); font-size:12.5px; font-family:inherit; resize:vertical;"></textarea>
            <div style="display:flex; gap:10px; margin-top:16px; justify-content:space-between; align-items:center;">
              <button id="call-obj-skip" class="pill-btn" style="background:transparent; border:1px solid var(--border-default); color:var(--text-secondary);">Saltear</button>
              <button id="call-obj-confirm" class="btn-primary pill-btn">Guardar y descartar</button>
            </div>
          </div>
        </div>`;
        document.body.appendChild(modal);
      }
      // Render tags (re-render limpia selección)
      const selectedTags = new Set();
      const tagsWrap = document.getElementById('call-obj-tags');
      tagsWrap.innerHTML = OBJECTION_TAGS.map(t => `<button type="button" data-tag="${t.key}" class="obj-tag" style="padding:9px 11px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; color:var(--text-primary); font-size:12px; cursor:pointer; text-align:left; transition:all 0.15s; font-family:inherit;">
        <div style="font-weight:600; font-size:11.5px;">${t.label}</div>
        <div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${t.hint}</div>
      </button>`).join('');
      tagsWrap.querySelectorAll('.obj-tag').forEach(btn => {
        btn.addEventListener('click', () => {
          const k = btn.getAttribute('data-tag');
          if (selectedTags.has(k)) {
            selectedTags.delete(k);
            btn.style.borderColor = 'var(--border-subtle)';
            btn.style.background = 'var(--bg-surface)';
          } else {
            selectedTags.add(k);
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'rgba(157,133,242,0.14)';
          }
        });
      });
      // Reset nota libre
      document.getElementById('call-obj-note').value = '';
      modal.classList.remove('hidden');

      // Audit fix Sprint 30 + 36: Esc cierra el modal. Cleanup en cualquier
      // forma de cierre (Esc, X, Saltear, Guardar) para evitar listeners huérfanos.
      const escHandler = (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
          modal.classList.add('hidden');
        }
      };
      document.addEventListener('keydown', escHandler);
      // Observador que limpia el listener cuando el modal se oculta por cualquier vía
      const cleanup = () => { document.removeEventListener('keydown', escHandler); obs.disconnect(); };
      const obs = new MutationObserver(() => {
        if (modal.classList.contains('hidden')) cleanup();
      });
      obs.observe(modal, { attributes: true, attributeFilter: ['class'] });

      const submit = async (withTags) => {
        try {
          const note = document.getElementById('call-obj-note').value.trim();
          const body = {
            outcome: 'answered_not_interested',
            notes: note,
            objectionTags: withTags ? [...selectedTags] : []
          };
          // Adjuntar telnyxMeta si hay
          const telnyxMeta = _pendingTelnyxCallMetadata[leadId];
          if (telnyxMeta) {
            body.telnyxCallMeta = telnyxMeta;
            delete _pendingTelnyxCallMetadata[leadId];
          }
          const resp = await fetch(apiUrl('/api/setters/leads/' + leadId + '/call-disposition'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          // Update optimista: 'No interesado' descarta el lead en el backend; el
          // poller del Power Dialer mira lead.estado para avanzar al siguiente.
          const _oi = callsLeadsCache.findIndex(l => l.id === leadId);
          if (_oi >= 0) callsLeadsCache[_oi].estado = 'descartado';
          const _oc = _callsLeadsById.get(leadId);
          if (_oc) _oc.estado = 'descartado';
          modal.classList.add('hidden');
          await loadCallsView();
        } catch (e) {
          alert('Error guardando: ' + e.message);
        }
      };
      document.getElementById('call-obj-skip').onclick = () => submit(false);
      document.getElementById('call-obj-confirm').onclick = () => submit(true);
    }

    // Sprint 23: quick-picks típicos de callback. Devuelve {label, subtitle, date}.
    function _buildCallbackQuickPicks() {
      const now = new Date();
      const dayNames = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
      const mkDate = (daysAhead, hour, min = 0) => {
        const d = new Date(now); d.setDate(d.getDate() + daysAhead); d.setHours(hour, min, 0, 0); return d;
      };
      const nextWeekday = (targetDay /* 1=lun */) => {
        const d = new Date(now);
        let diff = (targetDay - d.getDay() + 7) % 7;
        if (diff === 0) diff = 7; // siempre la próxima ocurrencia
        d.setDate(d.getDate() + diff); d.setHours(10, 0, 0, 0);
        return d;
      };
      const fmt = (d) => `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth()+1} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const picks = [
        { label: '⏰ En 2 horas',     subtitle: fmt(new Date(now.getTime() + 2*3600*1000)), date: new Date(now.getTime() + 2*3600*1000) },
        { label: '🌞 Mañana 10am',    subtitle: fmt(mkDate(1, 10)),  date: mkDate(1, 10) },
        { label: '🌇 Mañana 4pm',     subtitle: fmt(mkDate(1, 16)),  date: mkDate(1, 16) },
        { label: '📆 Pasado 10am',    subtitle: fmt(mkDate(2, 10)),  date: mkDate(2, 10) },
        { label: '🗓️ Próximo lunes',  subtitle: fmt(nextWeekday(1)), date: nextWeekday(1) },
        { label: '🗓️ Próximo viernes',subtitle: fmt(nextWeekday(5)), date: nextWeekday(5) },
      ];
      return picks;
    }

    function openScheduleModal(leadId, opts = {}) {
      // opts.fallbackOnCancel: si vino acá vía "Interesado" y el user cierra/cancela
      // sin agendar, igual queremos logear el "Interesado" para no perder el signal.
      const fallbackOnCancel = opts.fallbackOnCancel || null;
      const lead = _callsLeadsById.get(leadId);
      const modal = document.getElementById('call-schedule-modal');
      document.getElementById('call-sched-nombre').value = lead?.name || '';
      // Default: mañana 11am. Audit fix Sprint 29 (bug 3): usar _toDatetimeLocal
      // (no toISOString que devuelve UTC y se ve 3hs atrasado en AR).
      const m = new Date(); m.setDate(m.getDate() + 1); m.setHours(11, 0, 0, 0);
      document.getElementById('call-sched-fecha').value = _toDatetimeLocal(m);
      document.getElementById('call-sched-notas').value = '';
      modal.classList.remove('hidden');

      let confirmed = false;
      let observer = null;

      document.getElementById('call-sched-confirm').onclick = async () => {
        const nombre = document.getElementById('call-sched-nombre').value.trim();
        const fecha = document.getElementById('call-sched-fecha').value;
        const notas = document.getElementById('call-sched-notas').value.trim();
        if (!fecha) { alert('Elegí fecha y hora'); return; }
        try {
          const resp = await fetch(apiUrl('/api/setters/leads/' + leadId + '/call-disposition'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              outcome: 'scheduled_with_admin',
              notes: notas,
              scheduled: { fecha: new Date(fecha).toISOString(), nombre }
            })
          });
          if (!resp.ok) throw new Error('HTTP ' + resp.status);
          confirmed = true;
          observer?.disconnect();
          // Update optimista: el poller del Power Dialer mira lead.estado para avanzar.
          const _si = callsLeadsCache.findIndex(l => l.id === leadId);
          if (_si >= 0) callsLeadsCache[_si].estado = 'agendado';
          const _sc = _callsLeadsById.get(leadId);
          if (_sc) _sc.estado = 'agendado';
          modal.classList.add('hidden');
          await loadCallsView();
        } catch (e) { alert('Error: ' + e.message); }
      };

      // Si el modal se abrió desde "Interesado", monitoreamos el cierre sin
      // confirmar para postear el answered_interested como fallback (no perder
      // el signal "atendió + interesado" si el setter no llegó a agendar).
      if (fallbackOnCancel) {
        observer = new MutationObserver(async () => {
          if (modal.classList.contains('hidden') && !confirmed) {
            observer.disconnect();
            try {
              await fetch(apiUrl('/api/setters/leads/' + leadId + '/call-disposition'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ outcome: fallbackOnCancel })
              });
              await loadCallsView();
            } catch (e) { console.warn('[schedule-fallback]', e.message); }
          }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
      }
    }

    const callsMenuItem = document.querySelector('[data-target="view-calls"]');
    if (callsMenuItem) callsMenuItem.addEventListener('click', () => { loadCallsView(); });
    document.getElementById('calls-setter-select').addEventListener('change', () => { _callsCurrentPage = 1; loadCallsView(); });
    document.getElementById('calls-country-filter').addEventListener('change', (e) => {
      localStorage.setItem('calls_country_filter_' + (currentUser?.id || 'anon'), e.target.value);
      _callsCurrentPage = 1;
      renderCallsList();
      renderCallsStats();
    });
    document.getElementById('calls-search').addEventListener('input', () => { _callsCurrentPage = 1; renderCallsList(); });
    // Sprint 28: toggle "Ver descartados"
    document.getElementById('calls-show-discarded')?.addEventListener('change', () => { _callsCurrentPage = 1; _callsRenderCountryChips(); renderCallsList(); });
    // Sprint 31: bulk operations wiring
    document.getElementById('calls-bulk-clear')?.addEventListener('click', () => {
      _callsSelected.clear();
      _callsRenderBulkBar();
      renderCallsList();
    });
    document.getElementById('calls-bulk-select-page')?.addEventListener('click', () => {
      // Seleccionar todos los leads visibles en la página actual
      document.querySelectorAll('.call-row-checkbox').forEach(cb => {
        const id = cb.getAttribute('data-lead-id');
        if (id) { _callsSelected.add(id); cb.checked = true; }
      });
      _callsRenderBulkBar();
      renderCallsList();
    });
    document.querySelectorAll('[data-bulk-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-bulk-action');
        if (_callsSelected.size === 0) {
          window.showToast?.('No hay leads seleccionados', { type: 'warning' });
          return;
        }
        const labels = {
          mark_wrong: 'marcar como número equivocado',
          mark_invalid: 'marcar como número inválido',
          discard: 'descartar (no interesado)',
          assign: 'asignar',
          move_to_setteo: 'mover a Setteo (vista WhatsApp)',
        };
        let assignTo = '';
        if (action === 'assign') {
          assignTo = document.getElementById('calls-bulk-assign-setter')?.value || '';
          if (!assignTo) { window.showToast?.('Elegí un setter primero', { type: 'warning' }); return; }
        }
        if (!confirm(`¿${labels[action]} ${_callsSelected.size} lead(s)? Esta acción se loguea en cada lead.`)) return;
        try {
          const r = await fetch(apiUrl('/api/setters/leads/bulk'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadIds: [..._callsSelected], action, assignTo })
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'HTTP ' + r.status);
          }
          const d = await r.json();
          // Audit fix Sprint 36 (bug 6): comunicar skipped si los hubo
          const msg = d.skipped > 0
            ? `✓ ${d.affected} lead(s) actualizado(s) · ${d.skipped} skipped (no encontrados)`
            : `✓ ${d.affected} lead(s) actualizado(s)`;
          window.showToast?.(msg, { type: 'success' });
          _callsSelected.clear();
          await loadCallsView();
        } catch (e) {
          window.showToast?.('Error bulk: ' + e.message, { type: 'error' });
        }
      });
    });
    // Sort dropdown: persiste en localStorage para no perder la preferencia
    const sortSelect = document.getElementById('calls-sort-select');
    if (sortSelect) {
      const savedSort = localStorage.getItem('calls_sort_' + (currentUser?.id || 'anon'));
      if (savedSort) sortSelect.value = savedSort;
      sortSelect.addEventListener('change', (e) => {
        localStorage.setItem('calls_sort_' + (currentUser?.id || 'anon'), e.target.value);
        _callsCurrentPage = 1;
        renderCallsList();
      });
    }
    // Controles de paginación
    document.getElementById('calls-pag-first')?.addEventListener('click', () => { _callsCurrentPage = 1; renderCallsList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.getElementById('calls-pag-prev')?.addEventListener('click', () => { _callsCurrentPage = Math.max(1, _callsCurrentPage - 1); renderCallsList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.getElementById('calls-pag-next')?.addEventListener('click', () => { _callsCurrentPage = _callsCurrentPage + 1; renderCallsList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    document.getElementById('calls-pag-end')?.addEventListener('click', () => { _callsCurrentPage = 9999; renderCallsList(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

    // Modal "Agregar lead manual" (admin only) — útil para testing y referidos
    let _callsManualEnriched = null; // Sprint 13: datos enriquecidos cacheados
    document.getElementById('calls-add-manual-btn')?.addEventListener('click', () => {
      ['calls-manual-name','calls-manual-phone','calls-manual-country','calls-manual-city','calls-manual-doctor'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      _callsManualEnriched = null;
      const enrichEl = document.getElementById('calls-manual-enrich-result');
      if (enrichEl) { enrichEl.style.display = 'none'; enrichEl.innerHTML = ''; }
      document.getElementById('calls-manual-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('calls-manual-name')?.focus(), 50);
    });

    // Sprint 13: botón "Enriquecer desde Maps"
    document.getElementById('calls-manual-enrich-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const name = document.getElementById('calls-manual-name').value.trim();
      const city = document.getElementById('calls-manual-city').value.trim();
      const country = document.getElementById('calls-manual-country').value.trim();
      const phone = document.getElementById('calls-manual-phone').value.trim();
      if (!name) { window.showToast?.('Ingresá al menos el nombre antes de enriquecer', { type: 'warn' }); return; }
      const enrichEl = document.getElementById('calls-manual-enrich-result');
      btn.disabled = true; const orig = btn.textContent; btn.textContent = '🔍 Buscando…';
      enrichEl.style.display = 'block';
      enrichEl.innerHTML = '<div style="color:var(--text-secondary);">Buscando en Google Maps…</div>';
      try {
        const r = await fetch(apiUrl('/api/setters/leads/enrich-from-maps'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ name, city, country, phone }),
        });
        if (!r.ok) {
          let msg = 'HTTP ' + r.status;
          try { const d = await r.json(); if (d?.error) msg = d.error; } catch {}
          enrichEl.innerHTML = `<div style="color:#f85149;">Error: ${escHtml(msg)}</div>`;
          return;
        }
        const d = await r.json();
        if (d.found === 0 || !d.best) {
          enrichEl.innerHTML = '<div style="color:var(--text-secondary);">Sin resultados en Google Maps. Podés crear igual el lead manualmente.</div>';
          return;
        }
        // Auto-llenar campos
        _callsManualEnriched = d.best;
        const fields = [
          ['calls-manual-phone', d.best.phone],
          ['calls-manual-city', d.best.city],
          ['calls-manual-country', d.best.country],
        ];
        for (const [id, val] of fields) {
          const el = document.getElementById(id);
          if (el && !el.value && val) el.value = val;
        }
        enrichEl.innerHTML = `
          <div style="font-size:11px; color:#5bb974; font-weight:600; margin-bottom:5px;">✓ Encontrado en Google Maps</div>
          <div style="line-height:1.5;">
            <strong>${escHtml(d.best.name)}</strong><br>
            ${d.best.rating ? '★ ' + escHtml(String(d.best.rating)) + ' · ' : ''}${d.best.reviews ? d.best.reviews + ' reseñas' : ''}<br>
            ${d.best.address ? '📍 ' + escHtml(d.best.address) + '<br>' : ''}
            ${d.best.website ? '🌐 <a href="' + escHtml(d.best.website) + '" target="_blank" rel="noopener" style="color:#7dd3fc;">' + escHtml(d.best.website) + '</a><br>' : ''}
            ${d.found > 1 ? `<small style="color:var(--text-tertiary);">Hay ${d.found} candidatos. Mostrando el mejor match.</small>` : ''}
          </div>
        `;
      } catch (err) {
        enrichEl.innerHTML = `<div style="color:#f85149;">Error: ${escHtml(err.message)}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = orig;
      }
    });
    document.getElementById('calls-manual-submit')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const name = document.getElementById('calls-manual-name').value.trim();
      const phone = document.getElementById('calls-manual-phone').value.trim();
      const country = document.getElementById('calls-manual-country').value.trim();
      const city = document.getElementById('calls-manual-city').value.trim();
      const doctor = document.getElementById('calls-manual-doctor').value.trim();
      if (!name) { window.showToast?.('Nombre requerido', { type: 'warn' }); return; }
      if (!phone) { window.showToast?.('Teléfono requerido', { type: 'warn' }); return; }
      if (!/^\+\d{8,15}$/.test(phone)) {
        window.showToast?.('Formato E.164: + seguido de 8-15 dígitos sin espacios. Ej: +5491156789012', { type: 'error', duration: 6000 });
        return;
      }
      btn.disabled = true; const originalText = btn.textContent; btn.textContent = 'Creando…';
      try {
        const setter = document.getElementById('calls-setter-select')?.value || '';
        const payload = { name, phone, country, city, doctor, setterId: setter };
        // Sprint 13: si se enriqueció desde Maps, mandar también los datos extras
        if (_callsManualEnriched) {
          payload.rating = _callsManualEnriched.rating;
          payload.reviews = _callsManualEnriched.reviews;
          payload.website = _callsManualEnriched.website;
          payload.address = _callsManualEnriched.address;
        }
        const r = await fetch(apiUrl('/api/setters/leads/manual-add'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          let msg = 'HTTP ' + r.status;
          try { const d = await r.json(); if (d?.error) msg = d.error; } catch {}
          throw new Error(msg);
        }
        document.getElementById('calls-manual-modal').classList.add('hidden');
        window.showToast?.(`✓ "${name}" agregado a Llamadas`, { type: 'success' });
        await loadCallsView();
      } catch (err) {
        window.showToast?.('Error: ' + err.message, { type: 'error' });
      } finally {
        btn.disabled = false; btn.textContent = originalText;
      }
    });

    // ── Centro de Comando ──
    async function loadCommandCenter() {
      try {
        const resp = await fetch(apiUrl('/api/setters/command'));
        const data = await resp.json();
        const t = data.totals;
        variantsList = data.perVariant || [];

        // Stats generales
        document.getElementById('cmd-stats').innerHTML =
          '<div class="stat-card"><span class="stat-num">' + t.total + '</span><span class="stat-label">Total Leads</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + (t.mensajes || 0) + '</span><span class="stat-label">Mensajes</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + t.conexiones + '</span><span class="stat-pct-sub">' + t.pctConexion + '%</span><span class="stat-label">Conexiones</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + t.respondieron + '</span><span class="stat-pct-sub">' + t.pctApertura + '%</span><span class="stat-label">Apertura</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + (t.calificados || 0) + '</span><span class="stat-pct-sub">' + t.pctCalificacion + '%</span><span class="stat-label">Calificados</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + t.interesados + '</span><span class="stat-label">Interesados</span></div>' +
          '<div class="stat-card stat-card-accent"><span class="stat-num">' + t.agendados + '</span><span class="stat-label">Agendados</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + t.sinWsp + '</span><span class="stat-label">Sin WSP</span></div>';

        // Stats de llamadas
        const ct = data.callTotals || {};
        const callStatsEl = document.getElementById('cmd-call-stats');
        if (callStatsEl) {
          callStatsEl.innerHTML =
            '<div class="stat-card"><span class="stat-num">' + (ct.leadsEnLlamadas || 0) + '</span><span class="stat-label">Leads en Llamadas</span></div>' +
            '<div class="stat-card"><span class="stat-num">' + (ct.totalLlamadas || 0) + '</span><span class="stat-label">Total llamadas</span></div>' +
            '<div class="stat-card"><span class="stat-num">' + (ct.llamadasHoy || 0) + '</span><span class="stat-pct-sub">' + (ct.pctAtendidasHoy || '0.0') + '% atendidas</span><span class="stat-label">Llamadas hoy</span></div>' +
            '<div class="stat-card"><span class="stat-num">' + (ct.atendidasHistorico || 0) + '</span><span class="stat-label">Atendidas (total)</span></div>' +
            '<div class="stat-card"><span class="stat-num">' + (ct.interesadosHistorico || 0) + '</span><span class="stat-label">Interesados</span></div>' +
            '<div class="stat-card stat-card-accent"><span class="stat-num">' + (ct.agendadosConAdmin || 0) + '</span><span class="stat-pct-sub">' + (ct.pctConversion || '0.0') + '% conv.</span><span class="stat-label">Agendados con Ignacio</span></div>' +
            '<div class="stat-card"><span class="stat-num" style="color:var(--warning);">' + (ct.agendamientoPendientes || 0) + '</span><span class="stat-label">Pendientes (cola)</span></div>' +
            '<div class="stat-card"><span class="stat-num" style="color:var(--success);">' + (ct.agendamientoRealizados || 0) + '</span><span class="stat-label">Realizados</span></div>' +
            '<div class="stat-card"><span class="stat-num" style="color:var(--danger);">' + (ct.numerosMuertos || 0) + '</span><span class="stat-pct-sub">' + (ct.pctNumerosMuertos || '0.0') + '%</span><span class="stat-label">Números muertos</span></div>';
        }

        // Tabla por setter (calls)
        const callsBody = document.getElementById('cmd-calls-per-setter-body');
        if (callsBody) {
          const callsPerSetter = data.callsPerSetter || [];
          if (callsPerSetter.length === 0) {
            callsBody.innerHTML = '<tr><td colspan="7" style="padding:18px; text-align:center; color:var(--text-tertiary);">No hay actividad de llamadas todavía.</td></tr>';
          } else {
            callsBody.innerHTML = callsPerSetter.map(s =>
              '<tr style="border-bottom:1px solid var(--border-subtle);">' +
              '<td style="padding:10px; font-weight:600;">' + escHtml(s.name) + '</td>' +
              '<td style="padding:10px;">' + s.leadsAsignados + '</td>' +
              '<td style="padding:10px;">' + s.totalLlamadas + '</td>' +
              '<td style="padding:10px;">' + s.llamadasHoy + '</td>' +
              '<td style="padding:10px;">' + s.interesados + '</td>' +
              '<td style="padding:10px; color:var(--success); font-weight:600;">' + s.agendados + '</td>' +
              '<td style="padding:10px; color:var(--accent);">' + s.pctConversion + '%</td>' +
              '</tr>'
            ).join('');
          }
        }

        // Badge total de leads
        const totalBadge = document.getElementById('setter-leads-total-badge');
        if (totalBadge) totalBadge.textContent = t.total + ' leads totales en setters';

        // Tabla por setter
        document.getElementById('cmd-table-body').innerHTML = data.perSetter.map(s =>
          '<tr>' +
          '<td style="font-weight:600;">' + escHtml(s.name) + '</td>' +
          '<td>' + s.total + '</td>' +
          '<td>' + (s.mensajes || 0) + '</td>' +
          '<td>' + s.conexiones + '</td>' +
          '<td style="color:var(--primary-color);">' + s.pctConexion + '%</td>' +
          '<td>' + s.respondieron + '</td>' +
          '<td style="color:var(--primary-color);">' + s.pctApertura + '%</td>' +
          '<td>' + (s.calificados || 0) + '</td>' +
          '<td>' + s.interesados + '</td>' +
          '<td style="color:var(--primary-color);">' + s.pctCalificacion + '%</td>' +
          '<td style="color:var(--success); font-weight:600;">' + s.agendados + '</td>' +
          '<td style="color:var(--warning);">' + escHtml(s.activeVariant) + '</td>' +
          '</tr>'
        ).join('');

        // Codigo muerto removido: el panel "admin-setters-list" se elimino del HTML.
        // Las acciones por setter (Editar/Duplicar/Eliminar) ahora viven en la
        // tabla "Equipo" arriba (users-table-body), que se popula via loadUsersPanel().

        // Tabla por variante
        const settersForFilter = data.setters || [];
        if (cmdVariableSetterFilter) {
          const prev = commandVariableSetterFilterValue;
          cmdVariableSetterFilter.innerHTML = '<option value="">Todos los setters</option>' + settersForFilter.map(s => '<option value="' + escHtml(s.id) + '">' + escHtml(s.name) + '</option>').join('');
          cmdVariableSetterFilter.value = prev && settersForFilter.some(s => s.id === prev) ? prev : '';
          commandVariableSetterFilterValue = cmdVariableSetterFilter.value || '';
        }

        if (cmdVariableSearch && document.activeElement !== cmdVariableSearch) {
          cmdVariableSearch.value = commandVariableSearchValue;
        }

        const filteredVariants = (data.perVariant || [])
          .filter(v => !commandVariableSetterFilterValue || v.setterId === commandVariableSetterFilterValue)
          .filter(v => {
            if (!commandVariableSearchValue) return true;
            const hay = [v.name, v.weekLabel, ...(Array.isArray(v.blocks) ? v.blocks.map(b => `${b.label || ''} ${b.text || ''}`) : [])].join(' ').toLowerCase();
            return hay.includes(commandVariableSearchValue);
          })
          .sort((a, b) => {
            const scoreA = (Number(b.interesados) || 0) - (Number(a.interesados) || 0);
            if (scoreA !== 0) return scoreA;
            const rateA = parseFloat(b.pctCalificacion || '0') - parseFloat(a.pctCalificacion || '0');
            if (rateA !== 0) return rateA;
            return (Number(b.total) || 0) - (Number(a.total) || 0);
          });

        document.getElementById('cmd-var-body').innerHTML = filteredVariants.map(v =>
          '<tr>' +
          '<td style="font-weight:600; color:var(--warning);">' + escHtml(v.name) + '</td>' +
          '<td>' + v.total + '</td>' +
          '<td>' + (v.mensajes || 0) + '</td>' +
          '<td>' + v.conexiones + '</td>' +
          '<td>' + v.respondieron + '</td>' +
          '<td>' + (v.calificados || 0) + '</td>' +
          '<td style="color:var(--primary-color);">' + v.pctApertura + '%</td>' +
          '<td>' + v.interesados + '</td>' +
          '<td style="color:var(--primary-color);">' + v.pctCalificacion + '%</td>' +
          '</tr>'
        ).join('');

        const summary = document.getElementById('admin-variable-summary');
        if (summary) {
          const vars = data.perVariant || [];
          if (vars.length === 0) {
            summary.innerHTML = 'Todavía no hay variables creadas.';
          } else {
            summary.innerHTML = vars.slice(0, 8).map(v => {
              return '<div style="display:flex; justify-content:space-between; gap:12px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.04);">' +
                '<span>' + escHtml(v.name) + '</span>' +
                '<span style="color:var(--text-secondary);">' + (v.total || 0) + ' leads / ' + (v.mensajes || 0) + ' msgs</span>' +
              '</div>';
            }).join('');
          }
        }

        const adminList = document.getElementById('admin-variable-list');
        if (adminList) {
          const setters = data.setters || [];
          const vars = filteredVariants;
          if (vars.length === 0) {
            adminList.innerHTML = '<p class="text-muted" style="margin:0;">Todavía no hay variables creadas.</p>';
          } else {
            adminList.innerHTML = vars.map(v => {
              const setterOptions = setters.map(s => '<option value="' + escHtml(s.id) + '"' + (v.setterId === s.id ? ' selected' : '') + '>' + escHtml(s.name) + '</option>').join('');
              const blocks = (Array.isArray(v.blocks) ? v.blocks : []).slice().sort((a, b) => {
                const interestDiff = (Number(b.interestedCount) || 0) - (Number(a.interestedCount) || 0);
                if (interestDiff !== 0) return interestDiff;
                const pctA = (Number(a.usedCount) || 0) > 0 ? ((Number(a.interestedCount) || 0) / (Number(a.usedCount) || 0)) * 100 : 0;
                const pctB = (Number(b.usedCount) || 0) > 0 ? ((Number(b.interestedCount) || 0) / (Number(b.usedCount) || 0)) * 100 : 0;
                if (pctB !== pctA) return pctB - pctA;
                return (Number(b.usedCount) || 0) - (Number(a.usedCount) || 0);
              });
              const setterName = setters.find(s => s.id === v.setterId)?.name || 'Sin setter';
              return '<div class="variant-card" style="margin-top:10px;">' +
                '<div class="variant-card-header"><span class="variant-card-name">' + escHtml(v.name) + '</span>' +
                '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
                  '<button type="button" class="btn-table-action" style="color:var(--warning); font-size:11px;" onclick="window._duplicateVariant(\'' + v.id + '\')">Duplicar</button>' +
                  '<button type="button" class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteVariant(\'' + v.id + '\')">Eliminar</button>' +
                '</div></div>' +
                '<div style="display:grid; gap:8px; margin-top:8px; font-size:12px; color:var(--text-secondary);">' +
                  '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
                    '<span>Setter asignado: <strong style="color:var(--text-main);">' + escHtml(setterName) + '</strong></span>' +
                    '<span>' + (v.total || 0) + ' leads</span>' +
                    '<span>' + (v.mensajes || 0) + ' msgs</span>' +
                    '<span>' + (v.usedCount || 0) + ' veces enviada</span>' +
                    '<span>' + (v.interesados || 0) + ' interesados</span>' +
                  '</div>' +
                  '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">' +
                    '<select id="variant-setter-' + v.id + '" class="setter-input" style="min-width:220px;">' +
                    '<option value="">Sin setter</option>' + setterOptions +
                    '</select>' +
                    '<button type="button" class="btn-primary pill-btn" style="padding:8px 14px;" onclick="window._assignVariantSetterFromCard(\'' + v.id + '\')">Asignar</button>' +
                    '<span style="color:var(--text-secondary); font-size:12px;">' + (Array.isArray(v.blocks) ? v.blocks.length : 0) + ' bloques</span>' +
                  '</div>' +
                  '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">' +
                    '<span style="font-size:12px; color:var(--text-secondary);">Asignar rápido:</span>' +
                    setters.map(s => '<button type="button" class="btn-table-action" style="font-size:11px; padding:4px 10px; color:var(--primary-color);" onclick="window._assignVariantSetter(\'' + v.id + '\', \'' + s.id + '\')">' + escHtml(s.name) + '</button>').join('') +
                    '<button type="button" class="btn-table-action" style="font-size:11px; padding:4px 10px; color:var(--danger);" onclick="window._assignVariantSetter(\'' + v.id + '\', \'\')">Quitar</button>' +
                  '</div>' +
                  '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding-top:8px; border-top:1px dashed var(--border-color);">' +
                    '<span style="font-size:12px; color:var(--text-secondary);">🔗 Compartir también con:</span>' +
                    setters.filter(s => s.id !== v.setterId).map(s => {
                      const shared = Array.isArray(v.sharedWith) && v.sharedWith.includes(s.id);
                      return '<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;background:' + (shared ? 'rgba(125,211,252,0.15)' : 'transparent') + ';padding:3px 8px;border-radius:10px;border:1px solid ' + (shared ? '#7dd3fc' : 'var(--border-color)') + ';">' +
                        '<input type="checkbox" ' + (shared ? 'checked' : '') + ' onchange="window._toggleShareVariant(\'' + v.id + '\',\'' + s.id + '\',this.checked)">' + escHtml(s.name) + '</label>';
                    }).join('') +
                  '</div>' +
                '</div>' +
                '<details style="margin-top:10px;">' +
                  '<summary style="cursor:pointer; color:var(--primary-color); font-size:12px;">Ver bloques</summary>' +
                  '<div style="margin-top:8px; display:grid; gap:8px;">' + blocks.map((b, idx) =>
                    '<div data-variant-block="' + v.id + '" style="padding:10px; border:1px solid var(--border-color); border-radius:12px; background:rgba(255,255,255,0.02);">' +
                      '<div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:6px; font-size:12px;">' +
                        '<strong>Bloque ' + (idx + 1) + '</strong>' +
                        '<span style="color:var(--text-secondary);">' + (idx + 1) + '</span>' +
                      '</div>' +
                      '<input class="setter-input" data-block-label type="text" value="' + escHtml(b.label || ('Bloque ' + (idx + 1))) + '" placeholder="Etiqueta del bloque" style="width:100%; margin-bottom:6px;">' +
                      '<textarea class="setter-input" data-block-text rows="3" placeholder="Texto del bloque" style="width:100%;">' + escHtml(b.text || '') + '</textarea>' +
                    '</div>'
                  ).join('') + '</div>' +
                  '<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">' +
                    '<button type="button" class="btn-primary pill-btn" onclick="window._saveVariantBlocks(\'' + v.id + '\')">Guardar bloques</button>' +
                  '</div>' +
                '</details>' +
              '</div>';
            }).join('');

            setTimeout(() => {
              vars.forEach(v => {
                const select = document.getElementById(`variant-setter-${v.id}`);
                if (select) select.value = v.setterId || '';
              });
            }, 0);
          }
        }

        if (inlineVarSetter) {
          inlineVarSetter.innerHTML = '<option value="">Asignar a setter</option>' + (data.setters || []).map(s => '<option value="' + escHtml(s.id) + '">' + escHtml(s.name) + '</option>').join('');
        }

        if (!inlineDraftBlocks.length) {
          inlineDraftBlocks = [{ id: `inline_${Date.now()}`, label: 'Apertura', text: '' }];
        }
        renderInlineVariantEditor();

        await loadUsersPanel();
      } catch (e) { console.error(e); }
    }

    async function loadUsersPanel() {
      const tbody = document.getElementById('users-table-body');
      if (!tbody) return;
      const [usersResp, settersResp, progressResp] = await Promise.all([
        fetch(apiUrl('/api/auth/users')),
        fetch(apiUrl('/api/setters')),
        fetch(apiUrl('/api/onboarding/progress/all')).catch(() => null)
      ]);
      const data = await usersResp.json();
      const settersData = await settersResp.json();
      const users = data.users || [];
      const invites = data.invites || [];
      // Mapa userId -> { completados, total, progreso }. Si fallo el fetch, queda vacio.
      let progressByUser = {};
      let onboardingTotal = 8;
      try {
        if (progressResp && progressResp.ok) {
          const pData = await progressResp.json();
          progressByUser = pData.users || {};
          onboardingTotal = pData.total || 8;
        }
      } catch (e) {}
      const inviteMap = new Map(invites.map(inv => [(inv.email || '').toLowerCase(), inv]));
      const validSetterIds = new Set((settersData.setters || []).map(s => s.id));
      const variableCountBySetter = new Map();
      (settersData.variants || []).forEach(v => {
        if (!v.setterId) return;
        variableCountBySetter.set(v.setterId, (variableCountBySetter.get(v.setterId) || 0) + 1);
      });

      const meIsAdmin = currentUser?.role === 'admin';
      tbody.innerHTML = users.map(user => {
        const inv = inviteMap.get((user.email || '').toLowerCase());
        const varCount = user.role === 'setter' ? (variableCountBySetter.get(user.setterId || '') || 0) : 0;
        // Supervisor no ve acciones (es read-only sobre el equipo).
        let actions = '—';
        if (meIsAdmin) {
          const acts = [];
          // Boton "Rol" para cambiar entre admin/supervisor/setter.
          // Disponible para todos los roles excepto el propio user (no podes cambiarte a vos mismo).
          if (user.id !== currentUser.id) {
            acts.push('<button type="button" class="btn-table-action" style="color:var(--accent); font-size:11px;" onclick="window._changeUserRole(\'' + escHtml(user.id) + '\', \'' + escHtml(user.role || '') + '\', decodeURIComponent(\'' + encodeURIComponent(user.email || '') + '\'))">Rol</button>');
          }
          // Acciones especificas de setter
          if (user.role === 'setter') {
            const isOrphan = !user.setterId || !validSetterIds.has(user.setterId);
            if (isOrphan) {
              acts.push('<span style="font-size:10px;color:var(--text-tertiary);margin:0 4px;">huérfano</span>');
              acts.push('<button type="button" class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteUser(\'' + escHtml(user.id) + '\', decodeURIComponent(\'' + encodeURIComponent(user.email || '') + '\'))">Borrar</button>');
            } else {
              const sid = escHtml(user.setterId);
              const sname = encodeURIComponent(user.name || '');
              acts.push('<button type="button" class="btn-table-action" style="color:var(--info); font-size:11px;" onclick="window._editSetter(\'' + sid + '\', decodeURIComponent(\'' + sname + '\'))">Editar</button>');
              acts.push('<button type="button" class="btn-table-action" style="color:var(--warning); font-size:11px;" onclick="window._duplicateSetter(\'' + sid + '\')">Duplicar</button>');
              acts.push('<button type="button" class="btn-table-action" style="color:#ffc828; font-size:11px;" title="Resetear todos los leads trabajados de este setter a sin_contactar (no toca sin_wsp)" onclick="window._resetSetterWork(\'' + sid + '\', decodeURIComponent(\'' + sname + '\'))">🧹 Limpiar trabajo</button>');
              acts.push('<button type="button" class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteSetter(\'' + sid + '\')">Eliminar</button>');
            }
          } else if (user.id !== currentUser.id) {
            // admin/supervisor que no es el actual: opcion de borrar el user
            acts.push('<button type="button" class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteUser(\'' + escHtml(user.id) + '\', decodeURIComponent(\'' + encodeURIComponent(user.email || '') + '\'))">Borrar</button>');
          }
          if (acts.length) actions = acts.join(' ');
        }
        // Onboarding cell: solo aplica a setters (admin/supervisor no hacen quiz)
        // Click en la celda abre detalle por modulo (intentos, fechas, bloqueado)
        let onboardingCell = '—';
        if (user.role === 'setter') {
          const prog = progressByUser[user.id];
          const done = prog ? (prog.completados || 0) : 0;
          const tot = prog ? (prog.total || onboardingTotal) : onboardingTotal;
          let color = 'var(--text-tertiary)';
          let bg = 'rgba(126,132,148,0.12)';
          if (done >= tot) { color = 'var(--success)'; bg = 'rgba(91,185,116,0.15)'; }
          else if (done > 0) { color = 'var(--info)'; bg = 'rgba(121,184,255,0.12)'; }
          const tipo = done >= tot ? '🏆' : (done > 0 ? '📚' : '🔵');
          const sname = encodeURIComponent(user.name || user.email || '');
          onboardingCell = '<button type="button" onclick="window._showOnboardingDetail(\'' + escHtml(user.id) + '\', decodeURIComponent(\'' + sname + '\'))" style="font-size:11px; color:' + color + '; background:' + bg + '; padding:3px 8px; border-radius:8px; font-weight:600; border:none; cursor:pointer;" title="Click para ver detalle de intentos por modulo">' + tipo + ' ' + done + '/' + tot + ' →</button>';
        }
        return '<tr>' +
          '<td>' + escHtml(user.name || '') + '</td>' +
          '<td>' + escHtml(user.email || '') + '</td>' +
          '<td>' + escHtml(user.role || '') + '</td>' +
          '<td>' + escHtml(user.status || '') + '</td>' +
          '<td>' + (user.role === 'setter' ? varCount : '—') + '</td>' +
          '<td>' + onboardingCell + '</td>' +
          '<td>' + (inv ? 'Pendiente' : '—') + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>';
      }).join('');
    }

    // Drilldown del progreso de onboarding por modulo. Muestra cada modulo
    // con: aprobado SI/NO, ultimo score, cuantos intentos, fecha del ultimo,
    // y si esta bloqueado por cooldown. Asi ves quien estuvo grindeando vs
    // quien lo hizo limpio en 1-2 intentos.
    window._showOnboardingDetail = async (userId, userName) => {
      let modulesMeta = [];
      let detail = null;
      try {
        const [modsR, progR] = await Promise.all([
          fetch(apiUrl('/api/onboarding/modules')),
          fetch(apiUrl('/api/onboarding/progress/' + encodeURIComponent(userId)))
        ]);
        modulesMeta = (await modsR.json()).modules || [];
        if (!progR.ok) throw new Error('No se pudo leer el progreso');
        detail = await progR.json();
      } catch (e) {
        alert('Error cargando detalle: ' + e.message);
        return;
      }
      const prog = detail.progreso || {};
      const now = Date.now();
      const rows = modulesMeta.map(m => {
        const p = prog[String(m.num)] || {};
        const aprobado = !!p.aprobado;
        const intentos = p.intentos || 0;
        const ultimo = p.ultimo_score != null ? p.ultimo_score : '—';
        const fecha = p.ultimaFecha ? new Date(p.ultimaFecha).toLocaleString() : '—';
        const bloq = p.bloqueadoHasta && p.bloqueadoHasta > now;
        const bloqStr = bloq ? Math.ceil((p.bloqueadoHasta - now) / 60000) + ' min' : '—';
        const estado = aprobado
          ? '<span style="color:var(--success); font-weight:600;">✅ Aprobado</span>'
          : (intentos > 0
            ? '<span style="color:var(--warning); font-weight:600;">⚠️ Falló</span>'
            : '<span style="color:var(--text-tertiary);">— sin intentos</span>');
        return '<tr>' +
          '<td style="font-weight:600;">' + m.num + '. ' + escHtml(m.title) + '</td>' +
          '<td>' + estado + '</td>' +
          '<td style="text-align:center;">' + intentos + '</td>' +
          '<td style="text-align:center;">' + ultimo + '/5</td>' +
          '<td style="font-size:11px; color:var(--text-secondary);">' + fecha + '</td>' +
          '<td style="text-align:center; color:' + (bloq ? 'var(--warning)' : 'var(--text-tertiary)') + ';">' + bloqStr + '</td>' +
        '</tr>';
      }).join('');
      const sname = encodeURIComponent(userName || '');
      const totalIntentos = Object.values(prog).reduce((s, p) => s + (p.intentos || 0), 0);
      const aprobados = Object.values(prog).filter(p => p.aprobado).length;
      const eficiencia = totalIntentos > 0 ? Math.round((aprobados / totalIntentos) * 100) : 0;
      const ratioLabel = totalIntentos > 0
        ? aprobados + ' aprobados en ' + totalIntentos + ' intentos (' + eficiencia + '% al primer intento limpio)'
        : 'Todavía no hizo ningún quiz';
      const html = '<div style="position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:9999;" onclick="if(event.target===this) this.remove()">' +
        '<div style="background:var(--surface-color); border:1px solid var(--border-color); border-radius:14px; padding:24px; max-width:900px; width:92%; max-height:88vh; overflow:auto;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">' +
          '<h2 style="margin:0; color:var(--text-primary);">Onboarding · ' + escHtml(userName) + '</h2>' +
          '<button onclick="this.closest(\'[style*=fixed]\').remove()" style="background:none; border:none; color:var(--text-tertiary); font-size:24px; cursor:pointer; padding:0 8px;">×</button>' +
        '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">' +
          '<button onclick="window._unlockAllOnboarding(\'' + escHtml(userId) + '\', decodeURIComponent(\'' + sname + '\'))" style="font-size:12px; background:rgba(63,185,80,0.15); color:var(--success); border:1px solid rgba(63,185,80,0.3); padding:6px 12px; border-radius:8px; cursor:pointer; font-weight:600;">🔓 Marcar 8/8 como aprobado (libre acceso)</button>' +
          '<button onclick="window._resetOnboarding(\'' + escHtml(userId) + '\', decodeURIComponent(\'' + sname + '\'))" style="font-size:12px; background:rgba(248,81,73,0.10); color:var(--danger); border:1px solid rgba(248,81,73,0.25); padding:6px 12px; border-radius:8px; cursor:pointer; font-weight:600;">🗑️ Resetear progreso</button>' +
        '</div>' +
        '<div style="color:var(--text-secondary); font-size:13px; margin-bottom:16px;">' + ratioLabel + '</div>' +
        '<table style="width:100%; border-collapse:collapse;"><thead><tr style="background:rgba(167,139,250,0.06);">' +
          '<th style="text-align:left; padding:8px; font-size:12px; color:var(--text-secondary);">Módulo</th>' +
          '<th style="text-align:left; padding:8px; font-size:12px; color:var(--text-secondary);">Estado</th>' +
          '<th style="text-align:center; padding:8px; font-size:12px; color:var(--text-secondary);">Intentos</th>' +
          '<th style="text-align:center; padding:8px; font-size:12px; color:var(--text-secondary);">Último</th>' +
          '<th style="text-align:left; padding:8px; font-size:12px; color:var(--text-secondary);">Última fecha</th>' +
          '<th style="text-align:center; padding:8px; font-size:12px; color:var(--text-secondary);">Bloqueado</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div style="font-size:11px; color:var(--text-tertiary); margin-top:14px; line-height:1.5;">' +
          '🚨 <strong>Señales de alarma:</strong> Más de 3 intentos en un mismo módulo sugiere que está adivinando o no leyó el material. Cero intentos = no abrió el quiz.<br>' +
          '⏳ El bloqueo se aplica automáticamente al fallar para que tenga que releer.' +
        '</div>' +
        '</div></div>';
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstChild);
    };

    // Marca los 8 modulos como aprobados para "darle libre" a un setter
    // que ya hizo el curso antes del tracking server-side.
    window._unlockAllOnboarding = async (userId, userName) => {
      if (!confirm('¿Marcar los 8 módulos del onboarding como aprobados para "' + userName + '"?\n\n' +
                   'Esto le permite ver/releer cualquier módulo sin restricción. Útil para gente que ya terminó el curso antes y no queremos hacerle rehacer todo.')) return;
      try {
        const r = await fetch(apiUrl('/api/onboarding/progress/' + encodeURIComponent(userId) + '/override'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unlockAll: true })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        alert('Listo. ' + userName + ' ahora tiene acceso libre a los 8 módulos.');
        document.querySelector('[style*="position:fixed"]')?.remove();
        loadUsersPanel();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    };

    // Resetea el progreso (rara vez util — tipo cuando admin se equivoco
    // y le marco aprobados a la persona equivocada).
    window._resetOnboarding = async (userId, userName) => {
      if (!confirm('¿Resetear TODO el progreso de onboarding de "' + userName + '"?\n\nEsto va a:\n• Borrar todos los intentos registrados\n• Volver al estado 0/8\n• Liberar cualquier cooldown activo\n\nNO se puede deshacer.')) return;
      try {
        const r = await fetch(apiUrl('/api/onboarding/progress/' + encodeURIComponent(userId) + '/override'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetAll: true })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        alert('Progreso reseteado.');
        document.querySelector('[style*="position:fixed"]')?.remove();
        loadUsersPanel();
      } catch (e) {
        alert('Error: ' + e.message);
      }
    };

    // Cambiar el rol de un user (admin -> supervisor -> setter o viceversa).
    // El backend libera el setter profile + leads si pasa de setter a otro rol,
    // y crea un setter profile nuevo si pasa a setter desde otro rol.
    window._changeUserRole = async (userId, currentRole, email) => {
      if (!userId) return;
      const next = prompt(
        '¿Cambiar el rol de "' + (email || userId) + '"?\n\n' +
        'Rol actual: ' + currentRole + '\n\n' +
        'Escribí el rol nuevo:\n' +
        '  • admin       (acceso total)\n' +
        '  • supervisor  (ve el equipo, no puede borrar ni scrapear)\n' +
        '  • setter      (operativo, solo ve sus leads)\n\n' +
        'Nota: si era setter, conserva sus leads y su base de prospección.',
        currentRole
      );
      if (!next || next === currentRole) return;
      try {
        const r = await fetch(apiUrl('/api/auth/users/' + userId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: next.trim().toLowerCase() })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
        alert('Rol cambiado: ' + data.oldRole + ' → ' + data.newRole);
      } catch (err) {
        alert('Error cambiando rol: ' + err.message);
      }
      loadCommandCenter();
    };

    // Borra un user directo (huerfanos sin setter o con setter inexistente).
    // El backend tiene guards: no permite borrarse a uno mismo ni al ultimo admin.
    window._deleteUser = async (userId, email) => {
      if (!userId) return;
      const msg = '¿Borrar el usuario "' + (email || userId) + '"?\n\n' +
                  'Este usuario es huérfano (sin setter activo asociado). Esto va a:\n' +
                  '• Borrarlo del sistema\n' +
                  '• Cerrar sus sesiones\n' +
                  '• Invalidar sus invites pendientes\n\n' +
                  'NO se puede deshacer.';
      if (!confirm(msg)) return;
      try {
        const r = await fetch(apiUrl('/api/auth/users/' + userId), { method: 'DELETE' });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
        const partes = ['Usuario "' + (data.email || email) + '" borrado.'];
        if (data.sessionsRevoked) partes.push('• ' + data.sessionsRevoked + ' sesion(es) revocada(s)');
        if (data.invitesRevoked) partes.push('• ' + data.invitesRevoked + ' invite(s) revocada(s)');
        alert(partes.join('\n'));
      } catch (err) {
        alert('Error borrando usuario: ' + err.message);
      }
      loadCommandCenter();
    };

    const inviteUserBtn = document.getElementById('invite-user-btn');
    const inviteResultDiv = document.getElementById('invite-result');
    const inviteResultText = document.getElementById('invite-result-text');
    const inviteResultUrl = document.getElementById('invite-result-url');
    const inviteResultIcon = document.getElementById('invite-result-icon');
    const inviteCopyBtn = document.getElementById('invite-copy-btn');
    const inviteWaBtn = document.getElementById('invite-wa-btn');

    if (inviteCopyBtn) {
      inviteCopyBtn.addEventListener('click', async () => {
        const url = inviteResultUrl?.value || '';
        if (!url) return;
        await navigator.clipboard.writeText(url);
        inviteCopyBtn.textContent = 'Copiado!';
        setTimeout(() => { inviteCopyBtn.textContent = 'Copiar link'; }, 2000);
      });
    }

    if (inviteWaBtn) {
      inviteWaBtn.addEventListener('click', () => {
        const url = inviteResultUrl?.value || '';
        const name = inviteResultDiv?.dataset.inviteName || '';
        if (!url) return;
        const msg = `Hola ${name}! Te invité a SCM — Sales Closing Machine. Creá tu contraseña acá: ${url}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
      });
    }

    if (inviteUserBtn) {
      inviteUserBtn.addEventListener('click', async () => {
        const name = document.getElementById('invite-name').value.trim();
        const email = document.getElementById('invite-email').value.trim();
        const role = document.getElementById('invite-role').value;
        if (!name || !email || !role) { alert('Completá nombre, email y rol.'); return; }

        inviteUserBtn.disabled = true;
        inviteUserBtn.textContent = 'Enviando...';
        if (inviteResultDiv) inviteResultDiv.classList.add('hidden');

        try {
          const resp = await fetch(apiUrl('/api/auth/invites'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, role, sendEmail: true })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'No se pudo crear la invitación.');

          // Mostrar resultado con link copiable
          const fullUrl = data.fullInviteUrl || (window.location.origin + data.inviteUrl);
          if (inviteResultDiv) {
            inviteResultDiv.classList.remove('hidden');
            inviteResultDiv.dataset.inviteName = name;
            inviteResultUrl.value = fullUrl;

            if (data.emailSent) {
              inviteResultIcon.textContent = '✅';
              inviteResultText.innerHTML = `Invitación enviada por email a <strong>${escHtml(email)}</strong>. También podés compartir el link:`;
              inviteResultDiv.style.borderColor = 'rgba(91,185,116,0.2)';
              inviteResultDiv.style.background = 'rgba(91,185,116,0.08)';
            } else {
              inviteResultIcon.textContent = '🔗';
              inviteResultText.innerHTML = `Invitación creada para <strong>${escHtml(name)}</strong>. ${data.emailError ? '(Email no enviado: ' + escHtml(data.emailError) + ')' : ''} Compartí este link:`;
              inviteResultDiv.style.borderColor = 'rgba(227,179,65,0.2)';
              inviteResultDiv.style.background = 'rgba(227,179,65,0.08)';
            }
          }

          document.getElementById('invite-name').value = '';
          document.getElementById('invite-email').value = '';
          await loadUsersPanel();
        } catch (err) {
          alert(err.message || 'Error al crear la invitación.');
        } finally {
          inviteUserBtn.disabled = false;
          inviteUserBtn.textContent = '+ Invitar y enviar email';
        }
      });
    }

    const cmdMenuItem = document.querySelector('[data-target="view-command"]');
    if (cmdMenuItem) cmdMenuItem.addEventListener('click', () => { loadCommandCenter(); loadHistoryPanel(); });

    const faqMenuItem = document.querySelector('[data-target="view-faqs"]');
    if (faqMenuItem) faqMenuItem.addEventListener('click', () => { loadFaqsModule(); });

    // Botón dedup de leads de setters
    const setterDedupBtn = document.getElementById('setter-dedup-btn');
    if (setterDedupBtn) {
      setterDedupBtn.addEventListener('click', async () => {
        if (!confirm('¿Buscar y eliminar leads duplicados de los setters?\n\nSe conserva el más antiguo o el que tenga más trabajo (interacciones, notas, etc). Los más recientes se eliminan.')) return;
        setterDedupBtn.disabled = true;
        setterDedupBtn.textContent = 'Limpiando...';
        try {
          const resp = await fetch(apiUrl('/api/setters/dedup'), { method: 'POST' });
          const data = await resp.json();
          const resultEl = document.getElementById('setter-dedup-result');
          if (resultEl) {
            resultEl.classList.remove('hidden');
            resultEl.textContent = data.removed > 0
              ? '✅ Se eliminaron ' + data.removed + ' duplicados. Quedan ' + data.remaining + ' leads únicos.'
              : '✅ No hay duplicados. Los ' + data.remaining + ' leads son todos únicos.';
            setTimeout(() => resultEl.classList.add('hidden'), 10000);
          }
          loadCommandCenter();
        } catch (e) { console.error(e); alert('Error limpiando duplicados de setters'); }
        setterDedupBtn.disabled = false;
        setterDedupBtn.textContent = 'Limpiar Duplicados de Setters';
      });
    }

    // ── Borrar leads de un setter ──
    const setterClearBtn = document.getElementById('setter-clear-btn');
    if (setterClearBtn) {
      setterClearBtn.addEventListener('click', async () => {
        const setterId = await window.pickSetter({
          title: 'Borrar leads de un setter',
          subtitle: '⚠️ Vas a borrar leads. Elegí de qué setter.',
          allowEmpty: false,
        });
        if (!setterId) return;

        const sResp = await fetch(apiUrl('/api/setters'));
        const sData = await sResp.json();
        const settersList = sData.setters || [];
        const found = settersList.find(s => s.id === setterId);
        if (!found) { alert('Setter no encontrado: ' + setterId); return; }

        const countryFilter = prompt('¿Filtrar por país? (ej: Uruguay, Bolivia)\n\nDejá vacío para borrar TODOS los leads de ' + found.name + ':');

        const confirmMsg = countryFilter
          ? '⚠️ ATENCIÓN: Esto borrará los leads de ' + found.name + ' que sean de "' + countryFilter + '".\n\nEsta acción no se puede deshacer. ¿Estás seguro?'
          : '⚠️ ATENCIÓN: Esto borrará TODOS los leads de ' + found.name + '.\n\nEsta acción no se puede deshacer. ¿Estás seguro?';
        if (!confirm(confirmMsg)) return;

        try {
          const bodyObj = { setter: found.id };
          if (countryFilter) bodyObj.country = countryFilter.trim();
          const resp = await fetch(apiUrl('/api/setters/leads-bulk'), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj)
          });
          const data = await resp.json();
          const msg = countryFilter
            ? 'Se borraron ' + data.removed + ' leads de "' + countryFilter + '" de ' + found.name + '.\nQuedan ' + data.remaining + ' leads en total.'
            : 'Se borraron ' + data.removed + ' leads de ' + found.name + '.\nQuedan ' + data.remaining + ' leads en total.';
          alert(msg);
          loadCommandCenter();
        } catch (e) { console.error(e); alert('Error borrando leads'); }
      });
    }

    // ── Importar CSV a Setter ──
    const setterImportCsv = document.getElementById('setter-import-csv');
    if (setterImportCsv) {
      setterImportCsv.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const assignTo = await window.pickSetter({
          title: 'Importar CSV a setter',
          subtitle: 'A qué setter querés asignar los leads del CSV?',
          allowEmpty: true,
        });
        if (assignTo === null) { setterImportCsv.value = ''; return; }

        // Parsear CSV
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) { alert('CSV vacío o sin datos.'); setterImportCsv.value = ''; return; }

        function parseCSVLine(line) {
          const cols = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue; }
            current += ch;
          }
          cols.push(current.trim());
          return cols;
        }

        const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\uFEFF/g, '').trim());
        // Mapear columnas flexiblemente — busca por keywords parciales
        const findCol = (...keywords) => header.findIndex(h => keywords.some(k => h.includes(k)));
        const nameIdx = findCol('nombre', 'name', 'clínica', 'clinica', 'empresa', 'negocio');
        const phoneIdx = findCol('tel', 'phone', 'celular');
        const waIdx = findCol('whatsapp', 'wa.me', 'wsp');
        const addrIdx = findCol('direc', 'address');
        const websiteIdx = findCol('página web', 'pagina web', 'website', 'sitio');
        const ratingIdx = findCol('rating', 'calificaci', 'puntuaci');
        const reviewsIdx = findCol('review', 'reseñ', 'opinion');
        const typeIdx = findCol('tipo', 'type', 'rubro', 'categor');
        const locationIdx = findCol('ciudad', 'city', 'ubic', 'location');
        const countryIdx = findCol('país', 'pais', 'country');
        const emailIdx = findCol('email', 'correo', 'mail');
        const igIdx = findCol('instagram', 'ig');
        const fbIdx = findCol('facebook', 'fb');
        const linkedinIdx = findCol('linkedin');
        const ownerIdx = findCol('doctor', 'owner', 'dueño', 'responsable', 'decisor');

        if (nameIdx === -1) { alert('El CSV debe tener una columna "Nombre", "Name" o "Clínica".'); setterImportCsv.value = ''; return; }

        // Extraer teléfono y mensaje de una URL de wa.me
        function parseWaUrl(val) {
          if (!val) return { phone: '', message: '', fullUrl: '' };
          const waMatch = val.match(/wa\.me\/(\d+)/);
          if (waMatch) {
            const phone = waMatch[1];
            // Extraer el texto del mensaje si existe
            let message = '';
            const textMatch = val.match(/[?&]text=([^&]*)/);
            if (textMatch) {
              try { message = decodeURIComponent(textMatch[1]); } catch(e) { message = textMatch[1]; }
            }
            return { phone, message, fullUrl: val.startsWith('http') ? val : 'https://' + val };
          }
          // Si no es URL de wa.me, tratar como número
          const digits = val.replace(/\D/g, '');
          return { phone: digits.length >= 7 ? digits : val, message: '', fullUrl: '' };
        }

        const leads = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (!cols[nameIdx]) continue;

          // Obtener teléfono y mensaje: de columna phone o whatsapp
          let phone = '', openMessage = '', whatsappUrl = '';
          if (waIdx >= 0 && cols[waIdx]) {
            const parsed = parseWaUrl(cols[waIdx]);
            phone = parsed.phone;
            openMessage = parsed.message;
            whatsappUrl = parsed.fullUrl;
          }
          if (!phone && phoneIdx >= 0 && cols[phoneIdx]) {
            const parsed = parseWaUrl(cols[phoneIdx]);
            phone = parsed.phone;
            if (!openMessage && parsed.message) openMessage = parsed.message;
            if (!whatsappUrl && parsed.fullUrl) whatsappUrl = parsed.fullUrl;
          }

          leads.push({
            name: cols[nameIdx] || '',
            phone: phone,
            openMessage: openMessage,
            whatsappUrl: whatsappUrl,
            address: addrIdx >= 0 ? (cols[addrIdx] || '') : '',
            website: websiteIdx >= 0 ? (cols[websiteIdx] || '') : '',
            rating: ratingIdx >= 0 ? (cols[ratingIdx] || '') : '',
            reviews: reviewsIdx >= 0 ? parseInt(cols[reviewsIdx]) || 0 : 0,
            type: typeIdx >= 0 ? (cols[typeIdx] || '') : '',
            locationSearched: locationIdx >= 0 ? (cols[locationIdx] || '') : '',
            country: countryIdx >= 0 ? (cols[countryIdx] || '') : '',
            email: emailIdx >= 0 ? (cols[emailIdx] || '') : '',
            instagram: igIdx >= 0 ? (cols[igIdx] || '') : '',
            facebook: fbIdx >= 0 ? (cols[fbIdx] || '') : '',
            linkedin: linkedinIdx >= 0 ? (cols[linkedinIdx] || '') : '',
            owner: ownerIdx >= 0 ? (cols[ownerIdx] || '') : ''
          });
        }

        if (leads.length === 0) { alert('No se encontraron leads en el CSV.'); setterImportCsv.value = ''; return; }
        if (!confirm('Se importarán ' + leads.length + ' leads' + (assignTo ? ' al setter seleccionado' : '') + '.\nLos duplicados serán ignorados automáticamente.\n\n¿Continuar?')) {
          setterImportCsv.value = ''; return;
        }

        try {
          const resp = await fetch(apiUrl('/api/setters/import'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leads, assignTo })
          });
          if (!resp.ok) {
            const errText = await resp.text();
            alert('Error al importar (' + resp.status + '): ' + errText);
            setterImportCsv.value = '';
            return;
          }
          const result = await resp.json();
          alert('Importación completada:\n• Importados: ' + (result.imported || 0) + ' leads nuevos\n• Duplicados omitidos: ' + (result.skipped || 0) + '\n• Total en pipeline: ' + (result.total || 0));
          loadCommandCenter();
        } catch (err) { console.error(err); alert('Error importando: ' + err.message); }
        setterImportCsv.value = '';
      });
    }

    // ── Centro de Comando: botones duplicados (cmd-*) ──
    const cmdDedupBtn = document.getElementById('cmd-dedup-btn');
    if (cmdDedupBtn) {
      cmdDedupBtn.addEventListener('click', async () => {
        if (!confirm('¿Buscar y eliminar leads duplicados de los setters?')) return;
        cmdDedupBtn.disabled = true; cmdDedupBtn.textContent = 'Limpiando...';
        try {
          const resp = await fetch(apiUrl('/api/setters/dedup'), { method: 'POST' });
          const data = await resp.json();
          const r = document.getElementById('cmd-dedup-result');
          if (r) { r.classList.remove('hidden'); r.textContent = data.removed > 0 ? '✅ ' + data.removed + ' duplicados eliminados.' : '✅ Sin duplicados.'; setTimeout(() => r.classList.add('hidden'), 10000); }
          loadCommandCenter();
        } catch (e) { console.error(e); alert('Error'); }
        cmdDedupBtn.disabled = false; cmdDedupBtn.textContent = 'Limpiar Duplicados de Setters';
      });
    }
    const cmdClearBtn = document.getElementById('cmd-clear-btn');
    if (cmdClearBtn) {
      cmdClearBtn.addEventListener('click', () => {
        document.getElementById('setter-clear-btn')?.click();
      });
    }
    const cmdImportCsv = document.getElementById('cmd-import-csv');
    if (cmdImportCsv) {
      cmdImportCsv.addEventListener('change', (e) => {
        const mainInput = document.getElementById('setter-import-csv');
        if (mainInput) { mainInput.files = e.target.files; mainInput.dispatchEvent(new Event('change')); }
        cmdImportCsv.value = '';
      });
    }

    // ══════════════════════════════════════════════════════════════
    // BASE DE DATOS DE HISTORIAL (Centro de Comando)
    // ══════════════════════════════════════════════════════════════
    let historyPage = 1;
    const historyLimit = 50;
    let historySearchText = '';

    async function loadHistoryPanel(page = 1) {
      if (currentUser?.role !== 'admin') return;
      historyPage = page;
      const params = new URLSearchParams({ page, limit: historyLimit });
      if (historySearchText) params.set('search', historySearchText);

      try {
        const resp = await fetch(apiUrl('/api/admin/history?' + params));
        const data = await resp.json();

        const badge = document.getElementById('history-total-badge');
        if (badge) badge.textContent = `${data.total.toLocaleString()} leads en base`;

        const tbody = document.getElementById('history-table-body');
        if (!tbody) return;

        if (!data.entries || data.entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No se encontraron leads.</td></tr>';
        } else {
          tbody.innerHTML = data.entries.map(e => {
            const date = e.scrapedAt ? new Date(e.scrapedAt).toLocaleDateString('es-AR', { day:'2-digit', month:'short', year:'2-digit' }) : '-';
            return '<tr>' +
              '<td style="font-weight:500;">' + escHtml(e.name || '') + '</td>' +
              '<td style="font-size:12px; max-width:200px;">' + escHtml(e.address || '') + '</td>' +
              '<td style="font-size:12px;">' + escHtml(e.query || '') + '</td>' +
              '<td style="font-size:12px;">' + escHtml(e.location || '') + '</td>' +
              '<td style="font-size:12px; white-space:nowrap;">' + date + '</td>' +
              '<td><button class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteHistoryEntry(\'' + escHtml(e.key).replace(/'/g, "\\'") + '\')">Eliminar</button></td>' +
            '</tr>';
          }).join('');
        }

        // Paginación
        const pagDiv = document.getElementById('history-pagination');
        if (pagDiv) {
          let html = '';
          if (data.page > 1) html += '<button class="btn-table-action" onclick="window._loadHistoryPage(' + (data.page - 1) + ')">← Anterior</button>';
          html += '<span style="font-size:12px; color:var(--text-secondary);">Página ' + data.page + ' de ' + data.totalPages + '</span>';
          if (data.page < data.totalPages) html += '<button class="btn-table-action" onclick="window._loadHistoryPage(' + (data.page + 1) + ')">Siguiente →</button>';
          pagDiv.innerHTML = html;
        }
      } catch (e) {
        console.error('Error cargando historial:', e);
      }
    }

    window._loadHistoryPage = (p) => loadHistoryPanel(p);

    window._deleteHistoryEntry = async (key) => {
      if (!confirm('¿Eliminar este lead del historial? Se podrá volver a scrapear.')) return;
      try {
        await fetch(apiUrl('/api/admin/history/entry'), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
        loadHistoryPanel(historyPage);
      } catch (e) { console.error(e); }
    };

    // Buscar en historial
    const histSearchInput = document.getElementById('history-search');
    const histSearchBtn = document.getElementById('history-search-btn');
    if (histSearchBtn) {
      histSearchBtn.addEventListener('click', () => {
        historySearchText = histSearchInput?.value?.trim() || '';
        loadHistoryPanel(1);
      });
    }
    if (histSearchInput) {
      histSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { historySearchText = histSearchInput.value.trim(); loadHistoryPanel(1); }
      });
    }

    // Limpiar duplicados
    const dedupBtn = document.getElementById('history-dedup-btn');
    if (dedupBtn) {
      dedupBtn.addEventListener('click', async () => {
        if (!confirm('¿Buscar y eliminar leads duplicados del historial?')) return;
        dedupBtn.disabled = true;
        dedupBtn.textContent = 'Limpiando...';
        try {
          const resp = await fetch(apiUrl('/api/admin/history/dedup'), { method: 'POST' });
          const data = await resp.json();
          const resultDiv = document.getElementById('history-dedup-result');
          if (resultDiv) {
            resultDiv.classList.remove('hidden');
            resultDiv.innerHTML = data.removed > 0
              ? '✅ Se eliminaron <strong>' + data.removed + '</strong> duplicados. Quedan <strong>' + data.remaining + '</strong> leads únicos.'
              : '✅ No se encontraron duplicados. Todos los <strong>' + data.remaining + '</strong> leads son únicos.';
            setTimeout(() => resultDiv.classList.add('hidden'), 8000);
          }
          loadHistoryPanel(historyPage);
        } catch (e) { console.error(e); alert('Error limpiando duplicados'); }
        dedupBtn.disabled = false;
        dedupBtn.textContent = 'Limpiar Duplicados';
      });
    }

    // Exportar historial como CSV
    const histExportBtn = document.getElementById('history-export-btn');
    if (histExportBtn) {
      histExportBtn.addEventListener('click', async () => {
        try {
          const resp = await fetch(apiUrl('/api/admin/history?page=1&limit=999999'));
          const data = await resp.json();
          if (!data.entries || data.entries.length === 0) return alert('No hay datos para exportar.');
          const headers = ['Nombre', 'Dirección', 'Query', 'Ubicación', 'Fecha Scraping'];
          const rows = data.entries.map(e => [
            '"' + (e.name || '').replace(/"/g, '""') + '"',
            '"' + (e.address || '').replace(/"/g, '""') + '"',
            '"' + (e.query || '').replace(/"/g, '""') + '"',
            '"' + (e.location || '').replace(/"/g, '""') + '"',
            '"' + (e.scrapedAt || '').replace(/"/g, '""') + '"'
          ]);
          const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'historial_scraping_' + new Date().toISOString().slice(0, 10) + '.csv';
          a.click();
        } catch (e) { console.error(e); alert('Error exportando'); }
      });
    }

    // Importar CSV al historial
    const histImportInput = document.getElementById('history-import-csv');
    if (histImportInput) {
      histImportInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) return alert('CSV vacío o sin datos.');

        // Parsear CSV (simple, asume comillas dobles)
        function parseCSVLine(line) {
          const cols = [];
          let current = '';
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue; }
            current += ch;
          }
          cols.push(current.trim());
          return cols;
        }

        const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\uFEFF/g, ''));
        const nameIdx = header.findIndex(h => h.includes('nombre') || h.includes('name'));
        const addrIdx = header.findIndex(h => h.includes('direc') || h.includes('address'));
        const phoneIdx = header.findIndex(h => h.includes('tel') || h.includes('phone') || h.includes('celular'));

        if (nameIdx === -1) return alert('El CSV debe tener una columna "Nombre" o "Name".');

        const leads = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (!cols[nameIdx]) continue;
          leads.push({
            name: cols[nameIdx] || '',
            address: addrIdx >= 0 ? (cols[addrIdx] || '') : '',
            phone: phoneIdx >= 0 ? (cols[phoneIdx] || '') : ''
          });
        }

        if (leads.length === 0) return alert('No se encontraron leads en el CSV.');
        if (!confirm('Se importarán ' + leads.length + ' leads. Los duplicados serán ignorados automáticamente. ¿Continuar?')) return;

        try {
          const resp = await fetch(apiUrl('/api/admin/history/import'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leads })
          });
          const data = await resp.json();
          alert('Importación completada:\n• Importados: ' + data.imported + '\n• Duplicados omitidos: ' + data.skipped + '\n• Total en base: ' + data.total);
          loadHistoryPanel(1);
        } catch (err) { console.error(err); alert('Error importando: ' + err.message); }
        histImportInput.value = '';
      });
    }

    // Cargar módulo cuando se cambia a la vista
    const crmMenuItem = document.querySelector('[data-target="view-crm"]');
    if (crmMenuItem) {
      crmMenuItem.addEventListener('click', () => {
        loadSetterModule();
        setTimeout(() => { renderHoyWidget(); checkWelcomeBanner(); }, 200);
      });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE setter-ux-redesign — Widget "Hoy" + Welcome banner
    // ═══════════════════════════════════════════════════════════

    // Calcula y renderiza el widget "Hoy" arriba del view-crm.
    // Lee setterLeads del cache local (no requiere endpoint nuevo).
    function renderHoyWidget() {
      const widget = document.getElementById('hoy-widget');
      if (!widget) return;
      // Solo setters ven el widget "Hoy" — admin/supervisor no trabajan leads
      // dia a dia, el widget no aporta valor (mostraba "0 leads tocados" siempre).
      // Si admin entra en "Ver como setter", el effectiveRole pasaria a 'setter'
      // y entonces si lo ven. Para ahora: solo role real = setter.
      if (currentUser?.role !== 'setter') { widget.style.display = 'none'; return; }
      const leads = Array.isArray(setterLeads) ? setterLeads : [];
      if (leads.length === 0) { widget.style.display = 'none'; return; }

      // 2026-05-24: si admin esta en modo "Ver como setter", mostrar el nombre
      // del setter impersonado, no el nombre real del admin. Antes decia
      // "Hola Ignacio" para todos los setters porque el admin queda con su nombre.
      let name = currentUser?.name || 'Setter';
      const isImpersonating = currentUser?.realRole === 'admin' && currentUser?.role === 'setter';
      if (isImpersonating && currentUser?.setterId) {
        const impersonatedSetter = (settersList || []).find(s => s.id === currentUser.setterId);
        if (impersonatedSetter?.name) name = impersonatedSetter.name;
      }
      const greetEl = document.getElementById('hoy-greet-text');
      if (greetEl) greetEl.textContent = `Hola ${name} 👋`;

      const dateEl = document.getElementById('hoy-date');
      if (dateEl) {
        const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
        const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const now = new Date();
        dateEl.textContent = `${days[now.getDay()]} ${now.getDate()} de ${months[now.getMonth()]}`;
      }

      const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
      const startOfTodayMs = startOfToday.getTime();
      // Métricas accionables
      const sinContactar = leads.filter(l => !l.conexion && !l.lastContactAt).length;
      const respondieronPendientes = leads.filter(l => l.respondio === true && l.interes !== 'si' && l.interes !== 'no' && l.estado !== 'agendado' && l.estado !== 'cerrado').length;
      // Follow-ups vencidos: lead con followUpsPlanned activo y followUpStartedAt > 24h
      // (simple proxy: leads con followUps tildados y lastContactAt antiguo)
      const followUpsVencidos = leads.filter(l => {
        const fu = l.followUps || {};
        const anyActive = fu['24hs'] || fu['48hs'] || fu['72hs'] || fu['7d'] || fu['15d'];
        if (!anyActive) return false;
        const lc = l.lastContactAt ? new Date(l.lastContactAt).getTime() : 0;
        return lc > 0 && (Date.now() - lc) > 24 * 60 * 60 * 1000;
      }).length;

      // Métricas del día (acumuladas hoy)
      const tocadosHoy = leads.filter(l => l.lastContactAt && new Date(l.lastContactAt).getTime() >= startOfTodayMs).length;
      const conexionesHoy = leads.filter(l => l.conexion === 'enviada' && l.lastContactAt && new Date(l.lastContactAt).getTime() >= startOfTodayMs).length;
      const agendadosHoy = leads.filter(l => l.estado === 'agendado' && l.lastContactAt && new Date(l.lastContactAt).getTime() >= startOfTodayMs).length;

      const actionsEl = document.getElementById('hoy-actions');
      if (actionsEl) {
        const chips = [];
        if (followUpsVencidos > 0) {
          chips.push(`<button class="hoy-action-chip urgent" onclick="window._hoyClickFilter('seguimiento')">⏳ <span class="num">${followUpsVencidos}</span> follow-ups vencidos</button>`);
        }
        if (sinContactar > 0) {
          chips.push(`<button class="hoy-action-chip" onclick="window._hoyClickFilter('sin_contactar')">📋 <span class="num">${sinContactar}</span> sin contactar</button>`);
        }
        if (respondieronPendientes > 0) {
          chips.push(`<button class="hoy-action-chip attention" onclick="window._hoyClickFilter('respondio')">💬 <span class="num">${respondieronPendientes}</span> respondieron — atender</button>`);
        }
        actionsEl.innerHTML = chips.join('') || '<span style="color:var(--text-secondary); font-size:13px;">🎉 No hay urgencias. Buen momento para nuevos contactos.</span>';
      }

      const todayEl = document.getElementById('hoy-today');
      if (todayEl) {
        todayEl.innerHTML = `
          📊 Tu día: <span><strong>${tocadosHoy}</strong> leads tocados</span>
          <span>· <strong>${conexionesHoy}</strong> conexiones</span>
          <span>· <strong>${agendadosHoy}</strong> agendados</span>
        `;
      }
      widget.style.display = 'flex';
    }
    window.renderHoyWidget = renderHoyWidget;

    // Click en chip del Hoy → setea filtro del pipeline y scrolea a la tabla
    window._hoyClickFilter = function hoyClickFilter(status) {
      const btn = document.querySelector('.pipe-filter[data-status="' + status + '"]');
      if (btn) {
        btn.click();
        setTimeout(() => {
          document.querySelector('#view-crm .table-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    };

    // Welcome banner: solo primera vez por usuario
    function checkWelcomeBanner() {
      const banner = document.getElementById('welcome-banner');
      if (!banner) return;
      const key = 'scm_welcome_seen_' + (currentUser?.id || 'anon');
      if (localStorage.getItem(key)) { banner.style.display = 'none'; return; }
      // Solo setters lo ven (admin/supervisor saltean — son power users)
      if (currentUser?.role !== 'setter') { banner.style.display = 'none'; return; }
      banner.style.display = 'flex';
      const dismiss = document.getElementById('welcome-dismiss');
      if (dismiss && !dismiss.dataset._wired) {
        dismiss.dataset._wired = '1';
        dismiss.addEventListener('click', () => {
          localStorage.setItem(key, '1');
          banner.style.display = 'none';
        });
      }
    }
    window.checkWelcomeBanner = checkWelcomeBanner;

    if (currentUser?.role === 'setter') {
      const setterMenuItem = document.querySelector('[data-target="view-crm"]');
      setterMenuItem?.click();
      loadSetterModule().then(() => {
        setTimeout(() => { renderHoyWidget(); checkWelcomeBanner(); }, 200);
      });
    } else {
      const mapsMenuItem = document.querySelector('[data-target="view-maps"]');
      mapsMenuItem?.click();
    }

  // ══════════════════════════════════════════════════════════════
  // ── MÓDULO FAQ / BANCO DE RESPUESTAS ──
  // ══════════════════════════════════════════════════════════════
  const CAT_LABELS = { precio:'💰 Precio', objecion:'🚫 Objeción', seguimiento:'🔄 Seguimiento', calificacion:'📝 Calificación', general:'💬 General' };

  window.loadFaqsModule = async function() {
    const q = document.getElementById('faq-search')?.value || '';
    const cat = document.getElementById('faq-cat-filter')?.value || '';
    const sort = document.getElementById('faq-sort')?.value || 'usos';
    const list = document.getElementById('faq-list');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--text-secondary)">Cargando...</p>';
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cat) params.set('categoria', cat);
      if (sort) params.set('sort', sort);
      const resp = await fetch(apiUrl('/api/faqs?' + params.toString()));
      const data = await resp.json();
      const entries = data.entries || [];
      if (entries.length === 0) {
        list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-secondary);">' +
          '<div style="font-size:40px;margin-bottom:12px;">📚</div>' +
          '<p style="font-size:15px;">No hay entradas aún.</p>' +
          '<p style="font-size:13px;">Hacé click en <strong>+ Nueva entrada</strong> para agregar la primera respuesta.</p>' +
          '</div>';
        return;
      }
      list.innerHTML = entries.map(e => _renderFaqCard(e)).join('');
      // Botón nuevo visible para todos
      const newBtn = document.getElementById('faq-new-btn');
      if (newBtn) newBtn.style.display = '';
    } catch(err) {
      list.innerHTML = '<p style="color:var(--danger);">Error cargando respuestas: ' + escHtml(err.message) + '</p>';
    }
  };

  function _renderFaqCard(e) {
    const isAdmin = currentUser?.role === 'admin';
    const isSupervisor = currentUser?.role === 'supervisor';
    // Cambio 2026-04-29: edit/delete solo para admin y supervisor. Setters NO
    // pueden editar ni borrar entradas del banco aunque las hayan creado.
    const canEdit = isAdmin || isSupervisor;
    const catLabel = CAT_LABELS[e.categoria] || e.categoria || '💬 General';
    const pctFuncionaron = e.usos > 0 ? Math.round((e.funcionaron / e.usos) * 100) : 0;
    const tags = (e.tags || []).map(t => `<span style="background:rgba(88,166,255,0.12);color:var(--info);padding:3px 8px;border-radius:10px;font-size:10px;border:1px solid rgba(88,166,255,0.25);">#${escHtml(t)}</span>`).join(' ');
    const authorBadge = e.createdBy ? `<span style="font-size:10px;color:var(--text-secondary);">· ${escHtml(e.createdBy)}</span>` : '';
    return `<div class="faq-card" style="background:linear-gradient(180deg, var(--surface-color) 0%, rgba(255,255,255,0.01) 100%);border:1px solid var(--border-color);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 2px rgba(0,0,0,0.2);transition:border-color 0.2s, transform 0.15s;" onmouseover="this.style.borderColor='var(--primary-color)'" onmouseout="this.style.borderColor='var(--border-color)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span style="font-size:11px;color:var(--primary-color);font-weight:700;letter-spacing:0.3px;text-transform:uppercase;">${escHtml(catLabel)}</span>
            ${authorBadge}
          </div>
          <p style="font-size:15px;font-weight:600;margin:6px 0 0;color:var(--text-primary);line-height:1.4;">${escHtml(e.pregunta)}</p>
        </div>
        ${canEdit ? `<div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn-table-action" style="font-size:12px;padding:4px 8px;" title="Editar" onclick="window._faqOpenModal('${escHtml(e.id)}')">✏️</button>
          <button class="btn-table-action" style="font-size:12px;padding:4px 8px;color:var(--danger);" title="Eliminar" onclick="window._faqDelete('${escHtml(e.id)}')">🗑️</button>
        </div>` : ''}
      </div>
      <div style="background:var(--bg-color);border-left:3px solid var(--primary-color);padding:10px 12px;border-radius:6px;">
        <p style="font-size:13px;color:var(--text-primary);line-height:1.55;white-space:pre-wrap;margin:0;">${escHtml(e.respuesta)}</p>
      </div>
      ${tags ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${tags}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid rgba(255,255,255,0.04);">
        <div style="font-size:11px;color:var(--text-secondary);">
          ${e.usos > 0 ? `<strong style="color:var(--text-primary);">${e.usos}</strong> usos · <strong style="color:var(--success);">${pctFuncionaron}%</strong> funcionó` : '<em>Sin usos aún</em>'}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-table-action" style="font-size:11px;padding:5px 12px;color:var(--success);font-weight:600;" onclick="window._faqCopy('${escHtml(e.id)}', this)">📋 Copiar</button>
          <button class="btn-table-action" style="font-size:11px;padding:5px 12px;color:var(--accent);font-weight:600;" title="Copiar para Pegar como humano (extensión Chrome)" onclick="window._faqCopyAsHuman('${escHtml(e.id)}', this)">👤 Copiar humano</button>
          <button class="btn-table-action" style="font-size:11px;padding:5px 12px;" onclick="window._faqFeedback('${escHtml(e.id)}', true)">✅ Funcionó</button>
        </div>
      </div>
    </div>`;
  }

  window._faqCopy = async (id, btn) => {
    const card = btn.closest('.faq-card');
    const texto = card?.querySelector('p:nth-of-type(2)')?.textContent || '';
    if (texto && navigator.clipboard) {
      await navigator.clipboard.writeText(texto).catch(() => {});
      const orig = btn.textContent;
      btn.textContent = '✓ Copiado';
      btn.style.color = 'var(--success)';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1800);
    }
    // Registrar uso
    try { await fetch(apiUrl('/api/faqs/' + id + '/uso'), { method:'PATCH', headers:{'Content-Type':'application/json'}, body:'{}' }); } catch {}
  };

  // Copy with SCM marker prefix so the "Pegar como humano" Chrome extension
  // detects it on Ctrl+V in WhatsApp Web and types it character by character
  // instead of pasting instantly. Without the extension installed, this just
  // copies the text with the marker visible (setter would notice).
  window._faqCopyAsHuman = async (id, btn) => {
    const card = btn.closest('.faq-card');
    const texto = card?.querySelector('p:nth-of-type(2)')?.textContent || '';
    if (texto && navigator.clipboard) {
      const ext = document.documentElement.getAttribute('data-scm-paste-installed') === '1';
      await navigator.clipboard.writeText(ext ? ('__SCM_TYPE__:' + texto) : texto).catch(() => {});
      const orig = btn.textContent;
      btn.textContent = ext ? '✓ Listo, Ctrl+V en WA' : '⚠ Sin extensión — copié normal';
      btn.style.color = ext ? 'var(--accent)' : 'var(--warning, #d97706)';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2400);
    }
    try { await fetch(apiUrl('/api/faqs/' + id + '/uso'), { method:'PATCH', headers:{'Content-Type':'application/json'}, body:'{}' }); } catch {}
  };

  window._faqFeedback = async (id, funcionó) => {
    try {
      await fetch(apiUrl('/api/faqs/' + id + '/uso'), {
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ 'funcionó': funcionó })
      });
      loadFaqsModule();
    } catch {}
  };

  window._faqOpenModal = async (id = null) => {
    document.getElementById('faq-edit-id').value = id || '';
    document.getElementById('faq-modal-title').textContent = id ? 'Editar entrada' : 'Nueva entrada';
    document.getElementById('faq-pregunta').value = '';
    document.getElementById('faq-respuesta').value = '';
    document.getElementById('faq-tags').value = '';
    document.getElementById('faq-categoria').value = 'general';
    const variantesEl = document.getElementById('faq-variantes');
    if (variantesEl) variantesEl.value = '';
    document.getElementById('faq-suggest-status').textContent = '';
    const dup = document.getElementById('faq-dup-warning');
    if (dup) { dup.classList.add('hidden'); dup.innerHTML = ''; }
    if (id) {
      try {
        const resp = await fetch(apiUrl('/api/faqs'));
        const data = await resp.json();
        const entry = (data.entries || []).find(e => e.id === id);
        if (entry) {
          document.getElementById('faq-pregunta').value = entry.pregunta || '';
          document.getElementById('faq-respuesta').value = entry.respuesta || '';
          document.getElementById('faq-tags').value = (entry.tags || []).join(', ');
          document.getElementById('faq-categoria').value = entry.categoria || 'general';
          if (variantesEl) variantesEl.value = (entry.variantes || []).join('\n');
        }
      } catch {}
    }
    document.getElementById('faq-modal').classList.remove('hidden');
    document.getElementById('faq-pregunta').focus();
  };

  window._faqSave = async (forceSave = false) => {
    const id = document.getElementById('faq-edit-id').value;
    const pregunta = document.getElementById('faq-pregunta').value.trim();
    const respuesta = document.getElementById('faq-respuesta').value.trim();
    const categoria = document.getElementById('faq-categoria').value;
    const tagsRaw = document.getElementById('faq-tags').value;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (!pregunta || !respuesta) { alert('Completá la pregunta y la respuesta.'); return; }
    // Check de duplicados antes de guardar (skip si el usuario ya confirmó)
    if (!forceSave) {
      try {
        const dRes = await fetch(apiUrl('/api/faqs/check-duplicate'), {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ pregunta, respuesta, categoria, excludeId: id || '' })
        });
        const dData = await dRes.json();
        if ((dData.duplicates || []).length > 0) {
          const warn = document.getElementById('faq-dup-warning');
          if (warn) {
            const items = dData.duplicates.map(d =>
              `<li style="margin:4px 0;"><strong>${escHtml(d.pregunta)}</strong> <span style="color:var(--text-secondary);">· ${escHtml(d.categoria || 'general')} · score ${d.score}</span></li>`
            ).join('');
            warn.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">⚠ Posibles duplicados en el banco:</div>
              <ul style="margin:0 0 8px 16px;padding:0;">${items}</ul>
              <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-ghost btn-sm" onclick="document.getElementById('faq-dup-warning').classList.add('hidden')">Revisar</button>
                <button class="btn btn-primary btn-sm" onclick="window._faqSave(true)">Guardar igual</button>
              </div>`;
            warn.classList.remove('hidden');
          }
          return;
        }
      } catch {}
    }
    const variantesRaw = document.getElementById('faq-variantes')?.value || '';
    const variantes = variantesRaw.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? apiUrl('/api/faqs/' + id) : apiUrl('/api/faqs');
      await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pregunta, respuesta, categoria, tags, variantes }) });
      document.getElementById('faq-modal').classList.add('hidden');
      loadFaqsModule();
    } catch(err) { alert('Error guardando: ' + err.message); }
  };

  // ── Importador en bulk ─────────────────────────────────────
  const FAQ_IMPORT_PLACEHOLDERS = {
    text: 'P: ¿Cuánto sale?\nR: Depende de cómo trabajen hoy. Lo vemos en la llamada.\nC: precio\nT: precio, costo\nV: ¿Cuánto cobran? | ¿Tienen precios?\n\nP: Ya tengo agencia\nR: Buenísimo, esto no es marketing...\nC: objecion',
    csv: 'pregunta,respuesta,categoria,tags,variantes\n"¿Cuánto sale?","Depende del plan","precio","precio;costo","¿Cuánto cobran?;¿Tienen precios?"\n"Ya tengo agencia","Esto no es marketing","objecion","competencia",""',
    json: '[\n  {\n    "pregunta": "¿Cuánto sale?",\n    "respuesta": "Depende del plan",\n    "categoria": "precio",\n    "tags": ["precio","costo"],\n    "variantes": ["¿Cuánto cobran?", "¿Tienen precios?"]\n  }\n]'
  };
  const FAQ_IMPORT_HELP = {
    text: 'Bloques separados por línea en blanco. Prefijos: P: pregunta, R: respuesta (multilínea OK), C: categoría, T: tags (coma), V: variantes (separadas por |).',
    csv: 'Headers obligatorios: pregunta, respuesta. Opcionales: categoria, tags (separados por ;), variantes (separados por ;). Usá comillas dobles si el valor tiene comas.',
    json: 'Array de objetos con pregunta, respuesta y opcionales categoria, tags, variantes.'
  };
  window._faqImportPlaceholder = () => {
    const fmt = document.getElementById('faq-import-format').value;
    document.getElementById('faq-import-input').placeholder = FAQ_IMPORT_PLACEHOLDERS[fmt] || '';
    document.getElementById('faq-import-help').textContent = FAQ_IMPORT_HELP[fmt] || '';
  };
  window._faqOpenImportModal = () => {
    document.getElementById('faq-import-input').value = '';
    document.getElementById('faq-import-format').value = 'text';
    const r = document.getElementById('faq-import-result');
    r.classList.add('hidden'); r.innerHTML = '';
    window._faqImportPlaceholder();
    document.getElementById('faq-import-modal').classList.remove('hidden');
  };
  window._faqImportSubmit = async () => {
    const fmt = document.getElementById('faq-import-format').value;
    const raw = document.getElementById('faq-import-input').value.trim();
    if (!raw) { alert('Pegá algo en el textarea.'); return; }
    let body = {};
    if (fmt === 'json') {
      try { body = { entries: JSON.parse(raw) }; }
      catch (e) { alert('JSON inválido: ' + e.message); return; }
    } else if (fmt === 'csv') body = { csv: raw };
    else body = { text: raw };

    const btn = document.getElementById('faq-import-submit-btn');
    btn.disabled = true; btn.textContent = '⏳ Importando...';
    try {
      const resp = await fetch(apiUrl('/api/faqs/import'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
      const r = document.getElementById('faq-import-result');
      r.innerHTML = `✅ <strong>${data.creadas}</strong> creadas · <strong>${data.omitidas}</strong> omitidas (ya existían) · <strong>${data.errores}</strong> con error.`;
      r.classList.remove('hidden');
      loadFaqsModule();
    } catch (err) {
      alert('Error importando: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Importar';
    }
  };

  window._faqSuggestTags = async () => {
    const pregunta = document.getElementById('faq-pregunta').value.trim();
    const respuesta = document.getElementById('faq-respuesta').value.trim();
    if (!pregunta) { alert('Primero escribí la pregunta/objeción.'); return; }
    const btn = document.getElementById('faq-suggest-tags-btn');
    const orig = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;
    try {
      const resp = await fetch(apiUrl('/api/faqs/suggest-tags'), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pregunta, respuesta })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      if (data.categoria) document.getElementById('faq-categoria').value = data.categoria;
      if (Array.isArray(data.tags) && data.tags.length) {
        const existing = document.getElementById('faq-tags').value.split(',').map(t => t.trim()).filter(Boolean);
        const merged = Array.from(new Set([...existing, ...data.tags]));
        document.getElementById('faq-tags').value = merged.join(', ');
      }
    } catch(err) {
      alert('Error sugiriendo tags: ' + err.message);
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  };

  window._faqDelete = async (id) => {
    if (!confirm('¿Eliminar esta entrada del banco de respuestas?')) return;
    try {
      await fetch(apiUrl('/api/faqs/' + id), { method:'DELETE' });
      loadFaqsModule();
    } catch(err) { alert('Error: ' + err.message); }
  };

  window._faqSuggest = async () => {
    const pregunta = document.getElementById('faq-pregunta').value.trim();
    const statusEl = document.getElementById('faq-suggest-status');
    if (!pregunta) { alert('Primero escribí la pregunta/objeción.'); return; }
    const btn = document.getElementById('faq-suggest-btn');
    btn.textContent = '⏳ Generando...';
    btn.disabled = true;
    statusEl.textContent = 'Consultando IA...';
    try {
      const resp = await fetch(apiUrl('/api/faqs/suggest'), {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pregunta })
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      document.getElementById('faq-respuesta').value = data.sugerencia || '';
      statusEl.textContent = data.ejemplosUsados > 0
        ? `✓ Generado basado en ${data.ejemplosUsados} respuesta(s) similar(es) del banco.`
        : '✓ Generado sin ejemplos previos (el banco está vacío).';
      statusEl.style.color = 'var(--success)';
    } catch(err) {
      statusEl.textContent = '❌ ' + err.message;
      statusEl.style.color = 'var(--danger)';
    } finally {
      btn.textContent = '✨ Generar con IA';
      btn.disabled = false;
    }
  };

  // ══════════════════════════════════════════════════════════════
  // ── CENTRO DE ENTRENAMIENTO ──
  // ══════════════════════════════════════════════════════════════
  window.loadTrainingModule = async function() {
    const list = document.getElementById('training-list');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--text-secondary)">Cargando...</p>';
    try {
      const resp = await fetch(apiUrl('/api/training'));
      const data = await resp.json();
      const q = (document.getElementById('training-search')?.value || '').trim().toLowerCase();
      const isAdmin = currentUser?.role === 'admin';
      let materials = data.materials || [];
      if (q) materials = materials.filter(m => (m.title + ' ' + (m.description||'') + ' ' + (m.extractedText||'')).toLowerCase().includes(q));
      if (materials.length === 0) {
        list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-secondary);">' +
          '<div style="font-size:40px;margin-bottom:12px;">🎓</div>' +
          '<p style="font-size:15px;">No hay materiales cargados aún.</p>' +
          (isAdmin ? '<p style="font-size:13px;">Subí PDFs, docs o guiones para que los setters aprendan y la IA los use como base de verdad.</p>' : '') +
          '</div>';
        return;
      }
      list.innerHTML = materials.map(m => {
        const sizeKb = m.sizeBytes ? (m.sizeBytes / 1024).toFixed(1) + ' KB' : '';
        const icon = m.mimeType?.includes('pdf') ? '📄' :
                     m.mimeType?.includes('word') || m.mimeType?.includes('doc') ? '📝' :
                     m.mimeType?.includes('image') ? '🖼️' :
                     m.mimeType?.includes('video') ? '🎬' :
                     m.mimeType?.includes('audio') ? '🎧' : '📄';
        const hasText = !!(m.extractedText || m.description);
        return '<div style="background:linear-gradient(180deg, var(--surface-color) 0%, rgba(255,255,255,0.01) 100%);border:1px solid var(--border-color);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:10px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:28px;">' + icon + '</div>' +
              '<p style="font-size:15px;font-weight:600;margin:6px 0 0;color:var(--text-primary);">' + escHtml(m.title) + '</p>' +
              (m.description ? '<p style="font-size:12px;color:var(--text-secondary);margin:4px 0 0;">' + escHtml(m.description) + '</p>' : '') +
            '</div>' +
            (isAdmin ? '<div style="display:flex;gap:4px;flex-shrink:0;">' +
              '<button class="btn-table-action" style="font-size:12px;padding:4px 8px;" title="Editar" onclick="window._trainingOpenModal(\'' + escHtml(m.id) + '\')">✏️</button>' +
              '<button class="btn-table-action" style="font-size:12px;padding:4px 8px;color:var(--danger);" title="Eliminar" onclick="window._trainingDelete(\'' + escHtml(m.id) + '\')">🗑️</button>' +
            '</div>' : '') +
          '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;">' +
            (hasText ? '<span style="background:rgba(91,185,116,0.15);color:var(--success);padding:2px 8px;border-radius:10px;">🤖 IA lo usa</span>' : '<span style="background:rgba(248,81,73,0.12);color:var(--danger);padding:2px 8px;border-radius:10px;">⚠️ Sin texto IA</span>') +
            (sizeKb ? '<span style="color:var(--text-secondary);">' + sizeKb + '</span>' : '') +
            (m.createdBy ? '<span style="color:var(--text-secondary);">· ' + escHtml(m.createdBy) + '</span>' : '') +
          '</div>' +
          (m.hasFile ? '<button type="button" class="btn-table-action" style="text-align:center;color:var(--primary-color);padding:8px;" onclick="window._trainingDownload(\'' + escHtml(m.id) + '\', \'' + escHtml(m.fileName || 'archivo') + '\')">⬇ Descargar archivo</button>' : '') +
        '</div>';
      }).join('');
    } catch(err) {
      list.innerHTML = '<p style="color:var(--danger);">Error cargando materiales: ' + escHtml(err.message) + '</p>';
    }
  };

  window._trainingOpenModal = async (id = null) => {
    document.getElementById('training-edit-id').value = id || '';
    document.getElementById('training-modal-title').textContent = id ? 'Editar material' : 'Nuevo material';
    document.getElementById('training-title').value = '';
    document.getElementById('training-description').value = '';
    document.getElementById('training-extracted').value = '';
    document.getElementById('training-file').value = '';
    document.getElementById('training-file-info').textContent = '';
    if (id) {
      try {
        const resp = await fetch(apiUrl('/api/training'));
        const data = await resp.json();
        const m = (data.materials || []).find(x => x.id === id);
        if (m) {
          document.getElementById('training-title').value = m.title || '';
          document.getElementById('training-description').value = m.description || '';
          document.getElementById('training-extracted').value = m.extractedText || '';
          if (m.fileName) document.getElementById('training-file-info').textContent = 'Archivo actual: ' + (m.originalFileName || m.fileName) + ' (no se puede reemplazar, sólo editar texto)';
        }
      } catch {}
    }
    document.getElementById('training-modal').classList.remove('hidden');
    document.getElementById('training-title').focus();
  };

  window._trainingSave = async () => {
    const id = document.getElementById('training-edit-id').value;
    const title = document.getElementById('training-title').value.trim();
    const description = document.getElementById('training-description').value.trim();
    const extractedText = document.getElementById('training-extracted').value.trim();
    const fileInput = document.getElementById('training-file');
    if (!title) { alert('Completá el título.'); return; }
    try {
      if (id) {
        // Edit — sólo metadata
        await fetch(apiUrl('/api/training/' + id), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, extractedText })
        });
      } else {
        const payload = { title, description, extractedText };
        const file = fileInput.files?.[0];
        if (file) {
          if (file.size > 10 * 1024 * 1024) { alert('Archivo supera 10MB.'); return; }
          const buf = await file.arrayBuffer();
          // Convertir a base64 eficientemente
          let binary = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          payload.fileBase64 = btoa(binary);
          payload.fileName = file.name;
          payload.mimeType = file.type;
        }
        const resp = await fetch(apiUrl('/api/training'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) { const err = await resp.json().catch(()=>({})); alert('Error: ' + (err.error || 'no se pudo subir')); return; }
      }
      document.getElementById('training-modal').classList.add('hidden');
      loadTrainingModule();
    } catch(err) { alert('Error: ' + err.message); }
  };

  window._trainingDownload = async (id, fileName) => {
    try {
      const resp = await fetch(apiUrl('/api/training/' + id + '/download'), { credentials: 'include' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'archivo';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch(err) {
      alert('Error descargando archivo: ' + err.message);
    }
  };

  window._trainingDelete = async (id) => {
    if (!confirm('¿Eliminar este material?')) return;
    try {
      await fetch(apiUrl('/api/training/' + id), { method: 'DELETE' });
      loadTrainingModule();
    } catch(err) { alert('Error: ' + err.message); }
  };

  // File info preview
  document.getElementById('training-file')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    const info = document.getElementById('training-file-info');
    if (f) info.textContent = `${f.name} · ${(f.size/1024).toFixed(1)} KB`;
    else info.textContent = '';
  });

  // ── Onboarding oficial (8 módulos hardcoded) ──
  const ONBOARDING_PROGRESS_KEY = 'scm_onboarding_progress';
  function getOnboardingProgress() {
    try { return JSON.parse(localStorage.getItem(ONBOARDING_PROGRESS_KEY) || '{}'); } catch { return {}; }
  }
  // Trae el progreso del server (respeta "Ver como" en backend) y lo devuelve
  // como objeto { N: true, ... } para usar en el render.
  // En modo "Ver como", NO toca el localStorage del admin (no le pisamos su progreso).
  // En modo normal, sincroniza el localStorage para que el setter no pierda
  // su progreso si cambia de browser.
  async function fetchOnboardingProgressForView() {
    const impersonating = !!getViewAs && getViewAs();
    try {
      const r = await fetch(apiUrl('/api/onboarding/progress'), { credentials: 'include' });
      if (!r.ok) return { progress: getOnboardingProgress(), source: 'local' };
      const data = await r.json();
      const serverMap = {};
      Object.entries(data.progreso || {}).forEach(([k, v]) => { if (v && v.aprobado) serverMap[k] = true; });
      if (!impersonating) {
        // Sincroniza localStorage solo en mi propia vista (no piso nada del admin
        // mientras esta impersonando). Mergeo: server gana sobre local.
        const merged = { ...getOnboardingProgress(), ...serverMap };
        try { localStorage.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(merged)); } catch (e) {}
        return { progress: merged, source: 'server' };
      }
      // Impersonando: render puro desde server, sin tocar localStorage
      return { progress: serverMap, source: 'server-impersonated' };
    } catch (e) {
      return { progress: getOnboardingProgress(), source: 'local-fallback' };
    }
  }
  window.renderOnboardingCards = async () => {
    const cardsEl = document.getElementById('onboarding-cards');
    const subEl = document.getElementById('onboarding-subheader');
    const fillEl = document.getElementById('onboarding-progress-fill');
    if (!cardsEl) return;
    // Trae el progreso real (server o, si impersonando, del setter target)
    const progressView = await fetchOnboardingProgressForView();
    let modules = [];
    try {
      const r = await fetch(apiUrl('/api/onboarding/modules'));
      const data = await r.json();
      modules = data.modules || [];
    } catch {
      cardsEl.innerHTML = '<p style="color:var(--danger);">No pude cargar los módulos.</p>';
      return;
    }
    const progress = progressView.progress;
    const completados = modules.filter(m => progress[m.num]).length;
    const totalMin = modules.reduce((sum, m) => sum + (m.minutes || 0), 0);
    if (subEl) subEl.textContent = `${modules.length} módulos · ~${totalMin} min total · ${completados} de ${modules.length} completados`;
    if (fillEl) fillEl.style.width = (completados / modules.length * 100).toFixed(0) + '%';

    const esAdmin = currentUser?.role === 'admin';
    cardsEl.innerHTML = modules.map(m => {
      const leido = !!progress[m.num];
      // Bloqueado si el módulo anterior no está aprobado (módulo 1 siempre desbloqueado)
      // Admin: nada está bloqueado (acceso libre a todo el onboarding)
      const bloqueado = !esAdmin && m.num > 1 && !progress[m.num - 1];
      const numStr = String(m.num).padStart(2, '0');

      let borderColor = 'var(--border-color)';
      let estadoChip;
      if (bloqueado) {
        borderColor = 'var(--border-color)';
        estadoChip = `<span style="font-size:11px; color:var(--text-tertiary, #7E8494); background:rgba(126,132,148,0.12); padding:3px 10px; border-radius:10px; font-weight:600;">🔒 Bloqueado</span>`;
      } else if (leido) {
        borderColor = 'rgba(91,185,116,0.4)';
        estadoChip = `<span style="font-size:11px; color:var(--success); background:rgba(91,185,116,0.15); padding:3px 10px; border-radius:10px; font-weight:600;">✅ Leído</span>`;
      } else {
        estadoChip = `<span style="font-size:11px; color:var(--info); background:rgba(121,184,255,0.12); padding:3px 10px; border-radius:10px; font-weight:600;">🔵 Sin leer</span>`;
      }

      // Bloqueado: no es <a>, sin click, opacity reducido
      if (bloqueado) {
        return `<div class="onboarding-card locked" title="Aprobá el quiz del módulo ${m.num - 1} para desbloquear este" style="
          display:block; background:var(--surface-color); border:1px dashed var(--border-color);
          border-radius:14px; padding:18px 18px 16px; position:relative; overflow:hidden;
          opacity:0.55; cursor:not-allowed;
        ">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:8px;">
            <div style="font-size:28px; font-weight:700; color:var(--text-tertiary, #7E8494); line-height:1; letter-spacing:-0.5px;">${numStr}</div>
            ${estadoChip}
          </div>
          <div style="height:2px; width:36px; background:linear-gradient(90deg, var(--text-tertiary, #7E8494), transparent); margin-bottom:12px;"></div>
          <div style="color:#B8C2CC; font-size:16px; font-weight:600; margin-bottom:4px;">${escHtml(m.title)}</div>
          <div style="color:#7E8494; font-size:13px; line-height:1.4; margin-bottom:14px; min-height:36px;">Aprobá primero el quiz del módulo ${m.num - 1}</div>
          <div style="display:flex; align-items:center; justify-content:space-between; padding-top:10px; border-top:1px solid var(--border-color);">
            <span style="font-size:11px; color:var(--text-tertiary, #7E8494);">⏱ ~${m.minutes} min</span>
            <span style="color:var(--text-tertiary, #7E8494); font-size:14px;">🔒</span>
          </div>
        </div>`;
      }

      return `<a href="/onboarding/${m.num}" class="onboarding-card" style="
        text-decoration:none; display:block;
        background:var(--surface-color); border:1px solid ${borderColor};
        border-radius:14px; padding:18px 18px 16px; position:relative; overflow:hidden;
        transition:all 0.2s; cursor:pointer;
      "
      onmouseover="this.style.borderColor='var(--accent)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px rgba(167,139,250,0.15)';"
      onmouseout="this.style.borderColor='${borderColor}'; this.style.transform='translateY(0)'; this.style.boxShadow='none';">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:8px;">
          <div style="font-size:28px; font-weight:700; color:var(--accent); line-height:1; letter-spacing:-0.5px;">${numStr}</div>
          ${estadoChip}
        </div>
        <div style="height:2px; width:36px; background:linear-gradient(90deg, var(--accent), transparent); margin-bottom:12px;"></div>
        <div style="color:#E6EDF3; font-size:16px; font-weight:600; margin-bottom:4px;">${escHtml(m.title)}</div>
        <div style="color:#B8C2CC; font-size:13px; line-height:1.4; margin-bottom:14px; min-height:36px;">${escHtml(m.subtitle)}</div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding-top:10px; border-top:1px solid var(--border-color);">
          <span style="font-size:11px; color:var(--text-secondary);">⏱ ~${m.minutes} min</span>
          <span style="font-size:11px; color:var(--success); background:rgba(91,185,116,0.12); padding:3px 8px; border-radius:8px;">🤖 IA lo usa</span>
          <span style="color:var(--accent); font-size:14px;">→</span>
        </div>
      </a>`;
    }).join('');
  };

  // Auto-cargar cuando se abre la vista
  document.querySelector('[data-target="view-training"]')?.addEventListener('click', () => {
    setTimeout(() => { loadTrainingModule(); renderOnboardingCards(); }, 50);
  });

  // ?view=training — viene desde la pantalla de un módulo al hacer "Volver"
  if (new URLSearchParams(window.location.search).get('view') === 'training') {
    setTimeout(() => {
      const link = document.querySelector('[data-target="view-training"]');
      if (link) link.click();
      // Limpiar el query param
      window.history.replaceState({}, '', window.location.pathname);
    }, 100);
  }

  // ── Quién está conectado (admin) ──
  let onlineRefreshTimer = null;
  window.loadOnlineUsers = async () => {
    const list = document.getElementById('online-users-list');
    if (!list) return;
    // Feedback visual del boton Refrescar
    const refreshBtns = document.querySelectorAll('button[onclick*="loadOnlineUsers"]');
    refreshBtns.forEach(b => { b.disabled = true; b.dataset._origText = b.textContent; b.textContent = '⏳ Actualizando...'; });
    try {
      const resp = await fetch(apiUrl('/api/auth/online'), { credentials: 'include' });
      if (!resp.ok) {
        if (resp.status === 401) {
          list.innerHTML = '<p style="color:var(--warning);">⚠ Tu sesión expiró. Recargá la página (F5) o volvé a entrar.</p>';
          // Cortar el auto-refresh para no spamear 401s
          if (onlineRefreshTimer) { clearInterval(onlineRefreshTimer); onlineRefreshTimer = null; }
        } else {
          list.innerHTML = '<p style="color:var(--danger);">Error: ' + resp.status + '</p>';
        }
        return;
      }
      const data = await resp.json();
      if (!data.users || data.users.length === 0) {
        list.innerHTML = '<p style="color:var(--text-secondary);">No hay usuarios.</p>';
        return;
      }
      const fmtAge = (ts) => {
        if (!ts) return 'Sin actividad registrada';
        const sec = Math.floor((Date.now() - ts) / 1000);
        if (sec < 60) return `Hace ${sec}s`;
        if (sec < 3600) return `Hace ${Math.floor(sec/60)} min`;
        if (sec < 86400) return `Hace ${Math.floor(sec/3600)}h`;
        return `Hace ${Math.floor(sec/86400)}d`;
      };
      const dot = (st) => st === 'online' ? '🟢' : st === 'recent' ? '🟡' : '⚪';
      const stColor = (st) => st === 'online' ? 'var(--success)' : st === 'recent' ? 'var(--warning)' : '#666';
      const stLabel = (st) => st === 'online' ? 'Online' : st === 'recent' ? 'Reciente' : 'Offline';
      const onlineCount = data.users.filter(u => u.status === 'online').length;
      // Vista "Quién está conectado": separar por actividad de HOY vs inactivos.
      // Hoy = lastSeen dentro de las últimas 24h. Antes mezclaba todo con
      // gente de hace 3 días y confundía.
      const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
      const todayStartTs = startOfToday.getTime();
      const todayUsers = data.users.filter(u => u.lastSeen && u.lastSeen >= todayStartTs);
      const inactiveUsers = data.users.filter(u => !u.lastSeen || u.lastSeen < todayStartTs);
      const renderCard = (u) => {
        const browser = (u.userAgent || '').match(/(Chrome|Firefox|Safari|Edge|Opera)/)?.[1] || '?';
        const os = (u.userAgent || '').match(/(Windows|Mac OS X|Linux|Android|iPhone)/)?.[1] || '?';
        return `<div style="background:var(--surface-color); border:1px solid var(--border-color); border-radius:10px; padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="color:var(--text-primary); font-size:14px;">${dot(u.status)} ${escHtml(u.name)}</strong>
            <span style="background:${stColor(u.status)}22; color:${stColor(u.status)}; padding:3px 10px; border-radius:10px; font-size:11px; font-weight:600;">${stLabel(u.status)}</span>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); margin-bottom:4px;">${escHtml(u.email)} · <span style="color:var(--info);">${u.role}</span></div>
          <div style="font-size:11px; color:var(--text-secondary); margin-bottom:4px;">Última actividad: <strong style="color:var(--text-primary);">${fmtAge(u.lastSeen)}</strong></div>
          ${u.ip ? `<div style="font-size:11px; color:var(--text-secondary);">IP: <code style="background:var(--bg-color); padding:1px 6px; border-radius:4px;">${escHtml(u.ip)}</code> · ${browser}/${os}</div>` : ''}
        </div>`;
      };
      list.innerHTML =
        `<div style="margin-bottom:14px; padding:12px 16px; background:var(--surface-color); border:1px solid var(--border-color); border-radius:10px; font-size:13px;">
          <strong style="color:var(--success);">🟢 ${onlineCount}</strong> ${onlineCount === 1 ? 'online ahora' : 'online ahora'} · <strong>${todayUsers.length}</strong> conectaron hoy · ${data.users.length} usuarios totales
          <span style="float:right; color:var(--text-secondary); font-size:11px;">Actualizado: ${new Date().toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</span>
        </div>` +
        (todayUsers.length === 0
          ? '<p style="color:var(--text-secondary); padding:18px; text-align:center; background:var(--surface-color); border:1px solid var(--border-color); border-radius:10px;">Nadie se conectó hoy todavía.</p>'
          : `<div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px;">${todayUsers.map(renderCard).join('')}</div>`
        ) +
        (inactiveUsers.length > 0
          ? `<details style="margin-top:18px;">
              <summary style="cursor:pointer; padding:10px 14px; background:var(--surface-color); border:1px solid var(--border-color); border-radius:10px; font-size:13px; color:var(--text-secondary);">Ver inactivos (${inactiveUsers.length} — sin actividad hoy)</summary>
              <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; margin-top:12px;">${inactiveUsers.map(renderCard).join('')}</div>
            </details>`
          : '');
    } catch(err) {
      list.innerHTML = '<p style="color:var(--danger);">Error: ' + escHtml(err.message) + '</p>';
    } finally {
      // Restaurar boton
      refreshBtns.forEach(b => { b.disabled = false; b.textContent = b.dataset._origText || '↻ Refrescar'; });
    }
  };
  document.querySelector('[data-target="view-online"]')?.addEventListener('click', () => {
    setTimeout(() => loadOnlineUsers(), 50);
    if (onlineRefreshTimer) clearInterval(onlineRefreshTimer);
    onlineRefreshTimer = setInterval(() => {
      const v = document.getElementById('view-online');
      if (v && !v.classList.contains('hidden')) loadOnlineUsers();
      else { clearInterval(onlineRefreshTimer); onlineRefreshTimer = null; }
    }, 15000);
  });

  // ─── Llamadas agendadas (admin) ───
  let scheduledCallsCache = [];
  let knownOverdueIds = new Set();
  const ORIGINAL_TITLE = document.title || 'SCM';

  window.loadScheduledCalls = async (silent = false) => {
    const list = document.getElementById('scheduled-calls-list');
    if (list && !silent) list.innerHTML = '<p style="color:var(--text-tertiary); padding:40px 0; text-align:center;">Cargando...</p>';
    try {
      const r = await fetch(apiUrl('/api/setters/calendar/enriched'));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      scheduledCallsCache = data.calendar || [];
      if (list && !silent) renderScheduledCalls();
      detectAndNotifyOverdue();
      updateScheduledBadge();
    } catch (e) {
      if (list && !silent) list.innerHTML = '<p style="color:var(--danger); padding:40px 0; text-align:center;">Error: ' + escHtml(e.message) + '</p>';
    }
  };

  function detectAndNotifyOverdue() {
    const now = Date.now();
    const overdue = scheduledCallsCache.filter(e =>
      e.calendarioEstado === 'pendiente' &&
      e.fecha &&
      new Date(e.fecha).getTime() < now
    );
    // Detectar nuevas atrasadas (no vistas antes en esta sesión)
    const newlyOverdue = overdue.filter(e => !knownOverdueIds.has(e.id));
    if (newlyOverdue.length > 0 && knownOverdueIds.size > 0) {
      // No notificar en el primer load (knownOverdueIds.size > 0 evita el ruido inicial)
      try {
        if ('Notification' in window) {
          if (Notification.permission === 'granted') {
            const e = newlyOverdue[0];
            new Notification('📅 Llamada agendada atrasada', {
              body: `${e.nombre || e.lead?.name || 'Lead'} · agendó: ${e.setterName || '?'}`,
              icon: '/favicon.ico',
              tag: 'scm-overdue-' + e.id
            });
          } else if (Notification.permission === 'default') {
            Notification.requestPermission();
          }
        }
        playOverdueChime();
      } catch {}
    }
    // Actualizar set
    knownOverdueIds = new Set(overdue.map(e => e.id));
  }

  function playOverdueChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 660;
      o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + 0.4);
      o.start(t0); o.stop(t0 + 0.4);
      setTimeout(() => ctx.close(), 600);
    } catch {}
  }

  function updateScheduledBadge() {
    const now = Date.now();
    const overdue = scheduledCallsCache.filter(e => e.calendarioEstado === 'pendiente' && e.fecha && new Date(e.fecha).getTime() < now);
    const upcomingSoon = scheduledCallsCache.filter(e => {
      if (e.calendarioEstado !== 'pendiente' || !e.fecha) return false;
      const diff = new Date(e.fecha).getTime() - now;
      return diff > 0 && diff < 30 * 60 * 1000; // próxima media hora
    });
    const totalPending = scheduledCallsCache.filter(e => e.calendarioEstado === 'pendiente').length;

    const badge = document.getElementById('scheduled-badge');
    if (!badge) return;

    if (overdue.length > 0) {
      badge.textContent = overdue.length;
      badge.style.display = 'inline-block';
      badge.style.background = 'var(--danger-soft)';
      badge.style.color = 'var(--danger)';
      badge.title = `${overdue.length} agendamientos atrasados`;
      document.title = `🔴 (${overdue.length}) ${ORIGINAL_TITLE}`;
    } else if (upcomingSoon.length > 0) {
      badge.textContent = upcomingSoon.length;
      badge.style.display = 'inline-block';
      badge.style.background = 'var(--warning-soft)';
      badge.style.color = 'var(--warning)';
      badge.title = `${upcomingSoon.length} agendamientos en los próximos 30 min`;
      document.title = `🟡 (${upcomingSoon.length}) ${ORIGINAL_TITLE}`;
    } else if (totalPending > 0) {
      badge.textContent = totalPending;
      badge.style.display = 'inline-block';
      badge.style.background = 'var(--accent-soft)';
      badge.style.color = 'var(--accent)';
      badge.title = `${totalPending} pendientes`;
      document.title = ORIGINAL_TITLE;
    } else {
      badge.style.display = 'none';
      document.title = ORIGINAL_TITLE;
    }
  }

  function renderScheduledCalls() {
    const list = document.getElementById('scheduled-calls-list');
    if (!list) return;
    const filterStatus = document.getElementById('scheduled-filter-status').value;
    const now = Date.now();

    let entries = scheduledCallsCache.slice();
    if (filterStatus === 'upcoming') entries = entries.filter(e => e.calendarioEstado === 'pendiente');
    else if (filterStatus !== 'all') entries = entries.filter(e => e.calendarioEstado === filterStatus);

    if (entries.length === 0) {
      list.innerHTML = '<p class="empty-state" style="padding:60px 0; text-align:center; color:var(--text-tertiary);">No hay llamadas agendadas con esos filtros.</p>';
      return;
    }

    const stateColors = {
      pendiente: { bg: 'var(--warning-soft)', color: 'var(--warning)', label: 'Pendiente' },
      realizada: { bg: 'var(--success-soft)', color: 'var(--success)', label: '✅ Realizada' },
      no_show:   { bg: 'var(--danger-soft)', color: 'var(--danger)', label: '👻 No-show' },
      cancelada: { bg: 'rgba(126,132,148,0.15)', color: 'var(--text-tertiary)', label: '❌ Cancelada' },
      reagendada:{ bg: 'var(--info-soft)', color: 'var(--info)', label: '🔄 Reagendada' },
      ganada:    { bg: 'rgba(255,179,65,0.15)', color: '#FFB341', label: '🏆 Ganada' }
    };

    list.innerHTML = entries.map(e => {
      const fecha = e.fecha ? new Date(e.fecha) : null;
      const fechaStr = fecha ? fecha.toLocaleString('es-AR', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : 'Sin fecha';
      const isPast = fecha && fecha.getTime() < now;
      const lead = e.lead;
      const sc = stateColors[e.calendarioEstado] || stateColors.pendiente;
      const overdueStyle = (isPast && e.calendarioEstado === 'pendiente') ? 'border-left:3px solid var(--danger);' : '';
      let telLink = '';
      if (lead?.phone) {
        let d = String(lead.phone).replace(/\D/g, '');
        const m = { 'colombia':'57','argentina':'54','méxico':'52','mexico':'52','chile':'56','perú':'51','peru':'51','bolivia':'591','uruguay':'598' };
        const k = String(lead.country || '').toLowerCase().trim();
        if (d.length >= 7 && d.length <= 10 && m[k]) d = m[k] + d;
        telLink = '+' + d;
      }
      return `<div style="background:var(--bg-surface); border:1px solid var(--border-subtle); ${overdueStyle} border-radius:12px; padding:16px 20px; display:grid; grid-template-columns: 1fr auto auto; gap:14px; align-items:center;">
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:4px;">
            <strong style="color:var(--text-primary); font-size:15px;">${escHtml(e.nombre || lead?.name || '(sin nombre)')}</strong>
            <span style="background:${sc.bg}; color:${sc.color}; padding:3px 10px; border-radius:8px; font-size:11px; font-weight:600;">${sc.label}</span>
            ${isPast && e.calendarioEstado === 'pendiente' ? '<span style="background:var(--danger-soft); color:var(--danger); padding:2px 8px; border-radius:6px; font-size:10px; font-weight:600;">⚠️ ATRASADA</span>' : ''}
            ${e.sourceCall ? '<span style="background:var(--accent-soft); color:var(--accent); padding:2px 8px; border-radius:6px; font-size:10px;">desde llamada</span>' : ''}
            ${e.calendarioEstado === 'ganada' && e.valorProyecto ? `<span style="background:rgba(255,179,65,0.15); color:#FFB341; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:700;">💵 $${Number(e.valorProyecto).toLocaleString('es-AR')}</span>` : ''}
          </div>
          <div style="font-size:13px; color:var(--text-secondary); margin-bottom:3px;">📆 <strong>${escHtml(fechaStr)}</strong> · agendó: <strong>${escHtml(e.setterName || e.setterId || '?')}</strong></div>
          ${lead ? `<div style="font-size:12px; color:var(--text-tertiary);">📞 ${escHtml(lead.phone || '')} · ${escHtml(lead.city || '')}${lead.city && lead.country ? ' / ' : ''}${escHtml(lead.country || '')}${lead.doctor && !String(lead.doctor).includes('N/A') ? ' · ' + escHtml(lead.doctor) : ''}${lead.callAttempts ? ` · ${lead.callAttempts} intento${lead.callAttempts>1?'s':''}` : ''}</div>` : ''}
          ${e.notas ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:6px; padding:8px 10px; background:var(--bg-input); border-radius:6px;">📝 ${escHtml(e.notas)}</div>` : ''}
        </div>
        ${telLink ? `<a href="tel:${escHtml(telLink)}" class="pill-btn" style="background:var(--success); color:#0F1115; text-decoration:none; padding:9px 16px; font-weight:600; font-size:12px;">📞 Llamar</a>` : ''}
        <select onchange="window._updateScheduledStatus('${escHtml(e.id)}', this.value)" style="padding:8px 12px; border-radius:8px; border:1px solid var(--border-default); background:var(--bg-input); color:var(--text-primary); font-size:12px; min-width:160px; cursor:pointer; font-family:inherit;">
          <option value="">— Cambiar estado —</option>
          <option value="realizada">✅ Marcar realizada</option>
          <option value="ganada">🏆 GANADA (cierre de venta)</option>
          <option value="no_show">👻 No-show</option>
          <option value="cancelada">❌ Cancelar</option>
          <option value="reagendada">🔄 Reagendar (cambiar fecha)</option>
          <option value="pendiente">↩️ Volver a pendiente</option>
        </select>
      </div>`;
    }).join('');
  }

  window._updateScheduledStatus = async (entryId, status) => {
    if (!status) return;
    let body = { calendarioEstado: status };
    if (status === 'ganada') {
      const val = await window.askText({
        title: '🏆 Cerrar venta',
        subtitle: 'Valor del proyecto cerrado (USD). Dejá 0 si no aplica.',
        type: 'input',
        placeholder: 'Ej: 1500',
        confirmLabel: 'Marcar ganada',
      });
      if (val === null || val === undefined) return; // canceló
      const num = Number(String(val).replace(/[^\d.]/g, '')) || 0;
      body.valorProyecto = num;
    }
    if (status === 'reagendada') {
      const newDate = await window.askText({
        title: 'Reagendar llamada',
        subtitle: 'Ingresá la nueva fecha y hora.',
        type: 'input',
        placeholder: '2026-05-01T14:30',
        confirmLabel: 'Reagendar',
      });
      if (!newDate) return;
      const parsed = new Date(newDate);
      if (isNaN(parsed.getTime())) { alert('Fecha inválida'); return; }
      body.fecha = parsed.toISOString();
    }
    try {
      const r = await fetch(apiUrl('/api/setters/calendar/' + entryId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await loadScheduledCalls();
    } catch (e) { alert('Error: ' + e.message); }
  };

  document.querySelector('[data-target="view-scheduled-calls"]')?.addEventListener('click', () => {
    setTimeout(() => loadScheduledCalls(), 50);
  });
  document.getElementById('scheduled-filter-status')?.addEventListener('change', () => renderScheduledCalls());

  // Cargar badge al iniciar (admin) sin abrir la vista + polling cada 60s
  if (currentUser?.role === 'admin') {
    setTimeout(() => loadScheduledCalls(), 1000);
    // Polling: revalida estado cada minuto. Detecta cuando una pendiente pasa a atrasada.
    setInterval(() => loadScheduledCalls(true), 60 * 1000);
    // Pedir permiso de Notification al primer click del usuario (browsers requieren gesture)
    document.addEventListener('click', function reqNotif() {
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
      document.removeEventListener('click', reqNotif);
    }, { once: true });
  }

  // ─── Vista Sistema (admin) ───
  let systemRefreshTimer = null;

  window.loadSystemHealth = async () => {
    try {
      const r = await fetch(apiUrl('/api/admin/health'));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      renderSystemHealth(data);
    } catch (e) {
      const grid = document.getElementById('system-stats-grid');
      if (grid) grid.innerHTML = '<p style="color:var(--danger);">Error: ' + escHtml(e.message) + '</p>';
    }
  };

  function renderSystemHealth(data) {
    const banner = document.getElementById('system-status-banner');
    const grid = document.getElementById('system-stats-grid');
    const sidebarBadge = document.getElementById('system-health-badge');
    const status = data.status || 'unknown';
    const colors = {
      healthy: { bg: 'var(--success-soft)', color: 'var(--success)', text: '✅ Sistema saludable' },
      degraded: { bg: 'var(--warning-soft)', color: 'var(--warning)', text: '⚠️ Sistema con warnings' },
      unhealthy: { bg: 'var(--danger-soft)', color: 'var(--danger)', text: '🔴 Sistema en problemas' }
    };
    const c = colors[status] || colors.degraded;
    if (banner) {
      banner.style.display = 'block';
      banner.style.background = c.bg;
      banner.style.color = c.color;
      banner.style.border = '1px solid ' + c.color;
      banner.innerHTML = '<strong>' + c.text + '</strong> · uptime: ' + Math.floor(data.checks.server.uptimeSeconds / 60) + ' min · generado: ' + new Date(data.generatedAt).toLocaleTimeString('es-AR');
    }
    if (sidebarBadge) {
      sidebarBadge.style.display = 'inline-block';
      sidebarBadge.style.background = c.bg;
      sidebarBadge.style.color = c.color;
      sidebarBadge.textContent = '●';
      sidebarBadge.title = c.text;
    }
    if (!grid) return;
    const ck = data.checks;
    const card = (title, body, color) => '<div style="background:var(--bg-surface); border:1px solid ' + (color || 'var(--border-subtle)') + '; border-radius:12px; padding:16px 18px;"><div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:10px;">' + title + '</div>' + body + '</div>';
    let html = '';
    html += card('📊 Datos en el sistema', '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:13px;">' +
      '<span style="color:var(--text-tertiary);">Leads:</span><span style="color:var(--text-primary); font-weight:600;">' + (ck.counts.leads || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Sin WSP:</span><span>' + (ck.counts.sinWsp || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Interesados:</span><span style="color:var(--success);">' + (ck.counts.interesados || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Agendados:</span><span style="color:var(--success);">' + (ck.counts.agendados || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">History:</span><span>' + (ck.counts.historyEntries || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Setters:</span><span>' + (ck.counts.setters || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Variantes:</span><span>' + (ck.counts.variants || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Usuarios:</span><span>' + (ck.counts.users || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Sesiones:</span><span>' + (ck.counts.activeSessions || 0) + '</span>' +
    '</div>');
    const calOverdueColor = (ck.counts.calendarAtrasados || 0) > 0 ? 'var(--danger)' : 'var(--success)';
    html += card('📅 Calendario', '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:13px;">' +
      '<span style="color:var(--text-tertiary);">Pendientes:</span><span style="color:var(--accent); font-weight:600;">' + (ck.counts.calendarPendientes || 0) + '</span>' +
      '<span style="color:var(--text-tertiary);">Atrasadas:</span><span style="color:' + calOverdueColor + '; font-weight:600;">' + (ck.counts.calendarAtrasados || 0) + '</span>' +
    '</div>', calOverdueColor);
    const aiOk = ck.ai.mercury || ck.ai.qwen;
    html += card('🤖 IA', '<div style="font-size:13px;">' +
      '<div>Mercury: <span style="color:' + (ck.ai.mercury ? 'var(--success)' : 'var(--danger)') + '; font-weight:600;">' + (ck.ai.mercury ? '✅ activa' : '❌ no configurada') + '</span></div>' +
      '<div>Qwen (fallback): <span style="color:' + (ck.ai.qwen ? 'var(--success)' : 'var(--danger)') + '; font-weight:600;">' + (ck.ai.qwen ? '✅ activa' : '❌ no configurada') + '</span></div>' +
    '</div>', aiOk ? null : 'var(--danger)');
    const bkColor = ck.backups.ok ? null : 'var(--warning)';
    let bkBody = '<div style="font-size:13px;"><div>Total snapshots: <strong>' + (ck.backups.count || 0) + '</strong></div>';
    if (ck.backups.latest) {
      bkBody += '<div style="color:var(--text-tertiary); margin-top:4px;">Último: hace ' + ck.backups.latest.ageHours + ' hs</div>';
      bkBody += '<div style="color:var(--text-faint); font-size:11px; margin-top:2px; word-break:break-all;">' + escHtml(ck.backups.latest.name) + '</div>';
    } else {
      bkBody += '<div style="color:var(--warning);">Sin backups todavía</div>';
    }
    bkBody += '</div>';
    html += card('💾 Backups', bkBody, bkColor);
    const errCount = ck.errors.last24hCount || 0;
    const errColor = errCount > 50 ? 'var(--danger)' : (errCount > 10 ? 'var(--warning)' : null);
    let errBody = '<div style="font-size:13px;"><div>Últimas 24h: <strong style="color:' + (errColor || 'var(--success)') + ';">' + errCount + ' errores</strong></div>';
    if (ck.errors.latest) {
      errBody += '<div style="color:var(--text-tertiary); margin-top:8px; font-size:12px; padding:8px; background:var(--bg-input); border-radius:6px; border-left:3px solid var(--danger);"><div style="color:var(--danger); font-weight:600; margin-bottom:2px;">Último error:</div><div style="word-break:break-word;">' + escHtml((ck.errors.latest.message || '').substring(0, 200)) + '</div>' + (ck.errors.latest.path ? '<div style="color:var(--text-faint); font-size:11px; margin-top:2px;">' + escHtml(ck.errors.latest.path) + '</div>' : '') + '</div>';
    }
    errBody += '</div>';
    html += card('🐛 Errores', errBody, errColor);
    let filesBody = '<div style="display:grid; grid-template-columns:1fr auto; gap:4px 12px; font-size:12px;">';
    for (const [name, info] of Object.entries(ck.data.files || {})) {
      if (!info) continue;
      filesBody += '<span style="color:var(--text-secondary); font-family:var(--font-mono);">' + escHtml(name) + '</span>';
      filesBody += '<span style="color:var(--text-primary); font-weight:600;">' + info.sizeMb + ' MB</span>';
    }
    filesBody += '</div>';
    html += card('📁 Archivos del data/', filesBody);
    grid.innerHTML = html;
  }

  document.getElementById('system-refresh-btn')?.addEventListener('click', () => loadSystemHealth());
  document.getElementById('system-backup-now-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('system-backup-now-btn');
    btn.disabled = true; btn.textContent = '💾 Creando...';
    try {
      const r = await fetch(apiUrl('/api/admin/backups/now'), { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        btn.textContent = '✅ Backup creado';
        await loadSystemHealth();
        setTimeout(() => { btn.textContent = '💾 Backup ahora'; btn.disabled = false; }, 2500);
      } else { alert('Error: ' + (d.error || 'desconocido')); btn.textContent = '💾 Backup ahora'; btn.disabled = false; }
    } catch (e) { btn.textContent = '💾 Backup ahora'; alert('Error: ' + e.message); btn.disabled = false; }
  });
  document.getElementById('system-report-preview-btn')?.addEventListener('click', async () => {
    try {
      const r = await fetch(apiUrl('/api/admin/weekly-report/preview'));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const iframe = document.getElementById('report-preview-iframe');
      iframe.srcdoc = d.html;
      document.getElementById('report-preview-modal').classList.remove('hidden');
    } catch (e) { alert('Error: ' + e.message); }
  });
  document.getElementById('system-report-send-btn')?.addEventListener('click', async () => {
    const to = await window.askText({
      title: 'Enviar reporte',
      subtitle: 'Elegí el email que va a recibir el reporte semanal.',
      type: 'input',
      placeholder: 'admin@empresa.com',
      defaultValue: currentUser?.email || '',
      confirmLabel: 'Enviar reporte',
    });
    if (!to) return;
    const btn = document.getElementById('system-report-send-btn');
    btn.disabled = true; btn.textContent = '📨 Enviando...';
    try {
      const r = await fetch(apiUrl('/api/admin/weekly-report/send'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to })
      });
      const d = await r.json();
      if (d.sent || d.ok) {
        btn.textContent = '✅ Enviado';
        setTimeout(() => { btn.textContent = '📨 Enviar reporte ahora'; btn.disabled = false; }, 2500);
      } else { alert('No se pudo enviar: ' + (d.reason || d.error || 'desconocido')); btn.textContent = '📨 Enviar reporte ahora'; btn.disabled = false; }
    } catch (e) { alert('Error: ' + e.message); btn.textContent = '📨 Enviar reporte ahora'; btn.disabled = false; }
  });
  document.querySelector('[data-target="view-system"]')?.addEventListener('click', () => {
    setTimeout(() => loadSystemHealth(), 50);
    if (systemRefreshTimer) clearInterval(systemRefreshTimer);
    systemRefreshTimer = setInterval(() => {
      const v = document.getElementById('view-system');
      if (v && !v.classList.contains('hidden')) loadSystemHealth();
      else { clearInterval(systemRefreshTimer); systemRefreshTimer = null; }
    }, 30000);
  });
  // Auto-load del badge al boot (admin) sin abrir la vista
  if (currentUser?.role === 'admin') {
    setTimeout(() => loadSystemHealth(), 2000);
  }

  // ── Configuración Mercury (admin) ──
  async function loadMercuryConfig() {
    try {
      const r = await fetch('/api/mercury/config', { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const cfg = await r.json();
      const promptEl = document.getElementById('mercury-cfg-prompt');
      const verEl = document.getElementById('mercury-cfg-version');
      const updEl = document.getElementById('mercury-cfg-updated');
      const upbEl = document.getElementById('mercury-cfg-updatedby');
      const ccEl = document.getElementById('mercury-cfg-charcount');
      if (promptEl) promptEl.value = cfg.systemPrompt || '';
      if (verEl) verEl.textContent = cfg.version ?? '—';
      if (updEl) updEl.textContent = cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString() : '—';
      if (upbEl) upbEl.textContent = cfg.updatedBy || '—';
      if (ccEl) ccEl.textContent = (cfg.systemPrompt || '').length;
      _renderMercuryNotes(cfg.feedbackNotes || []);
    } catch (e) {
      alert('Error cargando config Mercury: ' + e.message);
    }
  }

  function _renderMercuryNotes(notes) {
    const ul = document.getElementById('mercury-cfg-notes');
    const empty = document.getElementById('mercury-cfg-notes-empty');
    if (!ul) return;
    ul.innerHTML = '';
    if (!notes.length) { if (empty) empty.style.display = 'block'; return; }
    if (empty) empty.style.display = 'none';
    const ordered = [...notes].reverse();
    for (const n of ordered) {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex; gap:10px; padding:10px 12px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-app); align-items:flex-start;';
      li.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="mn-text" style="font-size:13px; line-height:1.45; color:var(--text-primary); white-space:pre-wrap; word-break:break-word;"></div>
          <div class="muted" style="font-size:11px; margin-top:4px;"><span class="meta-by"></span> · <span class="meta-at"></span></div>
        </div>
        <button class="btn-table-action btn-del" style="font-size:11px; color:#f85149;">Borrar</button>
      `;
      li.querySelector('.mn-text').textContent = n.text || '';
      li.querySelector('.meta-by').textContent = n.addedBy || '—';
      li.querySelector('.meta-at').textContent = n.addedAt ? new Date(n.addedAt).toLocaleString() : '';
      li.querySelector('.btn-del').addEventListener('click', async () => {
        if (!confirm('Borrar esta nota?')) return;
        try {
          const r = await fetch(`/api/mercury/config/notes/${encodeURIComponent(n.id)}`, { method: 'DELETE', credentials: 'include' });
          if (!r.ok) throw new Error('http ' + r.status);
          loadMercuryConfig();
        } catch (e) { alert('Error: ' + e.message); }
      });
      ul.appendChild(li);
    }
  }

  document.querySelector('[data-target="view-mercury-config"]')?.addEventListener('click', () => {
    setTimeout(() => {
      loadMercuryConfig();
      _loadMercuryMetrics();
      _loadMercuryCandidates();
      _loadMercuryAbStats();
    }, 50);
  });

  // ── Métricas Mercury ──
  async function _loadMercuryMetrics() {
    const days = parseInt(document.getElementById('mercury-metrics-days')?.value || '30', 10);
    try {
      const [stats, drift] = await Promise.all([
        fetch(`/api/mercury/stats?days=${days}`, { credentials: 'include' }).then(r => r.json()),
        fetch('/api/mercury/drift', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      const cards = document.getElementById('mercury-metrics-cards');
      if (cards && stats?.totals) {
        const t = stats.totals;
        const card = (label, value, sub, color = 'var(--accent)') => `
          <div style="padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;">
            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${label}</div>
            <div style="font-size:22px; font-weight:700; color:${color}; line-height:1;">${value}</div>
            <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">${sub}</div>
          </div>`;
        cards.innerHTML =
          card('Total', t.total, `${days}d`) +
          card('Buenas', `${(t.goodRate * 100).toFixed(0)}%`, `${t.good} marcadas`, '#5bb974') +
          card('Malas', `${(t.badRate * 100).toFixed(0)}%`, `${t.bad} descartadas`, '#f85149') +
          card('Usadas', `${(t.usedRate * 100).toFixed(0)}%`, `${t.used} enviadas`, 'var(--accent)') +
          card('Violaciones', `${(t.violationsRate * 100).toFixed(0)}%`, `${t.violations} con flags`, '#ffc828');
      }
      // Drift
      const driftBanner = document.getElementById('mercury-drift-banner');
      if (driftBanner && drift) {
        if (drift.drift) {
          const top = (drift.topViolations || []).slice(0, 3).map(x => `${x.violation} (${x.count})`).join(', ') || 'sin detalle';
          driftBanner.innerHTML = `⚠ <strong>Drift detectado</strong> — violations rate subió de ${(drift.previousWeek.violationsRate * 100).toFixed(1)}% (semana pasada) a <strong>${(drift.currentWeek.violationsRate * 100).toFixed(1)}%</strong> (esta semana). Top: ${top}.`;
          driftBanner.style.display = 'block';
        } else {
          driftBanner.style.display = 'none';
        }
      }
      // Por setter
      const setterUl = document.getElementById('mercury-metrics-setters');
      if (setterUl && Array.isArray(stats.bySetter)) {
        setterUl.innerHTML = stats.bySetter.slice(0, 12).map(s => `
          <li style="display:flex; justify-content:space-between; padding:5px 8px; background:var(--bg-app); border-radius:6px;">
            <span style="color:var(--text-primary);">${escHtml(s.setterName || s.setterId)}</span>
            <span class="muted">${s.total} · 👍${s.good} 👎${s.bad} ✓${s.used}</span>
          </li>`).join('') || '<li class="muted" style="text-align:center; padding:8px;">Sin datos.</li>';
      }
      const renderKv = (id, obj) => {
        const ul = document.getElementById(id);
        if (!ul) return;
        const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
        ul.innerHTML = entries.length
          ? entries.map(([k, v]) => `<li style="display:flex; justify-content:space-between; padding:4px 8px; background:var(--bg-app); border-radius:6px;"><span>${escHtml(k)}</span><span class="muted">${v}</span></li>`).join('')
          : '<li class="muted" style="text-align:center; padding:8px;">—</li>';
      };
      renderKv('mercury-metrics-intents', stats.byIntent);
      renderKv('mercury-metrics-tones', stats.byTone);
    } catch (e) {
      console.warn('mercury-metrics:', e.message);
    }
  }

  document.getElementById('mercury-metrics-refresh')?.addEventListener('click', _loadMercuryMetrics);
  document.getElementById('mercury-metrics-days')?.addEventListener('change', _loadMercuryMetrics);

  // ── Candidatos auto-promote ──
  async function _loadMercuryCandidates() {
    const ul = document.getElementById('mercury-cands-list');
    const empty = document.getElementById('mercury-cands-empty');
    if (!ul) return;
    try {
      const r = await fetch('/api/mercury/candidates?days=60', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const list = d.candidates || [];
      ul.innerHTML = '';
      if (!list.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      for (const g of list) {
        const li = document.createElement('li');
        li.style.cssText = 'padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;';
        const when = new Date(g.createdAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        li.innerHTML = `
          <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:6px; align-items:flex-start;">
            <div class="muted" style="font-size:11px;">💬 <span class="cand-msg" style="color:var(--text-secondary);"></span></div>
            <span class="muted" style="font-size:10px; flex-shrink:0;">${when} · ${escHtml(g.setterName || '')}</span>
          </div>
          <div class="cand-out" style="font-size:13px; line-height:1.5; color:var(--text-primary); white-space:pre-wrap; padding:8px 10px; background:rgba(157,133,242,0.04); border-left:3px solid var(--accent); border-radius:6px;"></div>
          <div style="display:flex; gap:6px; margin-top:8px; justify-content:flex-end;">
            <button class="btn-secondary cand-skip" style="font-size:11px; padding:5px 10px;">Saltar</button>
            <button class="btn-primary cand-approve" style="font-size:11px; padding:5px 10px;">⭐ Promover al banco</button>
          </div>
        `;
        li.querySelector('.cand-msg').textContent = (g.prospectMessage || '').slice(0, 140);
        li.querySelector('.cand-out').textContent = g.output?.text || '';
        li.querySelector('.cand-approve').addEventListener('click', async (ev) => {
          ev.target.disabled = true;
          ev.target.textContent = 'Promoviendo…';
          try {
            const ar = await fetch(`/api/mercury/generations/${encodeURIComponent(g.id)}/approve`, { method: 'POST', credentials: 'include' });
            if (!ar.ok) throw new Error('http ' + ar.status);
            window.showToast('Promovida al banco', { type: 'success' });
            _loadMercuryCandidates();
          } catch (e) {
            window.showToast('Error: ' + e.message, { type: 'error' });
            ev.target.disabled = false;
            ev.target.textContent = '⭐ Promover al banco';
          }
        });
        li.querySelector('.cand-skip').addEventListener('click', () => { li.remove(); });
        ul.appendChild(li);
      }
    } catch (e) {
      console.warn('mercury-cands:', e.message);
    }
  }
  document.getElementById('mercury-cands-refresh')?.addEventListener('click', _loadMercuryCandidates);

  // ── A/B prompts ──
  async function _loadMercuryAbStats() {
    try {
      const cfg = await fetch('/api/mercury/config', { credentials: 'include' }).then(r => r.json());
      const expEl = document.getElementById('mercury-cfg-experimental');
      const enEl = document.getElementById('mercury-ab-enabled');
      if (expEl) expEl.value = cfg.experimentalPrompt || '';
      if (enEl) enEl.checked = !!cfg.abEnabled;
      const ab = await fetch('/api/mercury/ab-stats?days=14', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
      if (!ab) return;
      const wrap = document.getElementById('mercury-ab-stats');
      const grid = document.getElementById('mercury-ab-grid');
      if (!wrap || !grid) return;
      if (!ab.promptB_set || (ab.A.total === 0 && ab.B.total === 0)) {
        wrap.style.display = 'none';
        return;
      }
      wrap.style.display = 'block';
      const renderCol = (label, x, accent) => `
        <div style="padding:10px; border:1px solid ${accent}; border-radius:8px; background:rgba(157,133,242,0.02);">
          <div style="font-size:11px; font-weight:700; color:${accent}; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">${label}</div>
          <div style="font-size:11px; color:var(--text-primary); line-height:1.7;">
            Total: <strong>${x.total}</strong><br>
            👍 Buenas: <strong>${(x.goodRate * 100).toFixed(0)}%</strong> (${x.good})<br>
            👎 Malas: <strong>${(x.badRate * 100).toFixed(0)}%</strong> (${x.bad})<br>
            ✓ Usadas: <strong>${(x.usedRate * 100).toFixed(0)}%</strong> (${x.used})<br>
            ⚠ Violations: <strong>${(x.violationsRate * 100).toFixed(0)}%</strong>
          </div>
        </div>`;
      grid.innerHTML = renderCol('Prompt A (actual)', ab.A, '#5bb974') + renderCol('Prompt B (experimental)', ab.B, 'var(--accent)');
    } catch (e) {
      console.warn('mercury-ab:', e.message);
    }
  }

  document.getElementById('mercury-cfg-experimental-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const prompt = document.getElementById('mercury-cfg-experimental')?.value || '';
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await fetch('/api/mercury/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ experimentalPrompt: prompt }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'http ' + r.status); }
      btn.textContent = '✓ Guardado';
      setTimeout(() => { btn.textContent = 'Guardar prompt B'; btn.disabled = false; }, 1500);
      _loadMercuryAbStats();
    } catch (err) {
      window.showToast('Error: ' + err.message, { type: 'error' });
      btn.textContent = 'Guardar prompt B'; btn.disabled = false;
    }
  });
  document.getElementById('mercury-ab-enabled')?.addEventListener('change', async (e) => {
    try {
      const r = await fetch('/api/mercury/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ abEnabled: !!e.target.checked }),
      });
      if (!r.ok) throw new Error('http ' + r.status);
      window.showToast(e.target.checked ? 'A/B activado (50/50)' : 'A/B desactivado', { type: 'info' });
    } catch (err) {
      window.showToast('Error: ' + err.message, { type: 'error' });
      e.target.checked = !e.target.checked;
    }
  });

  document.getElementById('mercury-cfg-prompt')?.addEventListener('input', (e) => {
    const cc = document.getElementById('mercury-cfg-charcount');
    if (cc) cc.textContent = e.target.value.length;
  });

  document.getElementById('mercury-cfg-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const prompt = document.getElementById('mercury-cfg-prompt')?.value || '';
    if (!prompt.trim()) { alert('El prompt no puede estar vacio.'); return; }
    if (prompt.length > 20000) { alert('El prompt excede 20000 caracteres.'); return; }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await fetch('/api/mercury/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ systemPrompt: prompt }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'http ' + r.status);
      btn.textContent = 'Guardado';
      setTimeout(() => { btn.textContent = 'Guardar prompt'; btn.disabled = false; }, 1500);
      loadMercuryConfig();
    } catch (err) {
      alert('Error: ' + err.message);
      btn.textContent = 'Guardar prompt'; btn.disabled = false;
    }
  });

  document.getElementById('mercury-cfg-reset')?.addEventListener('click', async () => {
    if (!confirm('Restaurar el system prompt al original? La version va a bumpear pero no perdes notas.')) return;
    try {
      const r = await fetch('/api/mercury/config/reset-prompt', { method: 'POST', credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      loadMercuryConfig();
    } catch (e) { alert('Error: ' + e.message); }
  });

  document.getElementById('mercury-cfg-addnote')?.addEventListener('click', async () => {
    const inp = document.getElementById('mercury-cfg-newnote');
    const text = (inp?.value || '').trim();
    if (!text) return;
    try {
      const r = await fetch('/api/mercury/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ addNote: text }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'http ' + r.status); }
      if (inp) inp.value = '';
      loadMercuryConfig();
    } catch (e) { alert('Error: ' + e.message); }
  });

  // ── Asistente de respuestas (admin + setter) ──
  let _asstCurrentGen = null;

  function _asstShowError(msg) {
    const el = document.getElementById('asst-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
  function _asstHideError() {
    const el = document.getElementById('asst-error');
    if (el) el.style.display = 'none';
  }
  function _asstSetLoading(on) {
    const el = document.getElementById('asst-loading');
    if (el) el.style.display = on ? 'block' : 'none';
    const btn = document.getElementById('asst-generate-btn');
    if (btn) { btn.disabled = on; btn.textContent = on ? 'Generando…' : 'Generar respuesta'; }
  }
  function _asstResetUI() {
    document.getElementById('asst-output-card').style.display = 'none';
    document.getElementById('asst-edit-box').style.display = 'none';
    document.getElementById('asst-status').style.display = 'none';
    document.getElementById('asst-fallback-pill').style.display = 'none';
    document.getElementById('asst-violations-pill').style.display = 'none';
    const vp = document.getElementById('asst-variant-pill'); if (vp) vp.style.display = 'none';
    document.getElementById('asst-ejemplos-wrap').style.display = 'none';
    _asstHideError();
  }

  function _asstRenderBlocks(blocks) {
    const ul = document.getElementById('asst-blocks');
    ul.innerHTML = '';
    const noResp = document.getElementById('asst-no-response');
    if (noResp) noResp.style.display = 'none';
    if (!blocks || !blocks.length) {
      const ca = document.getElementById('asst-copy-all');
      const cah = document.getElementById('asst-copy-all-human');
      if (ca) ca.style.display = 'none';
      if (cah) cah.style.display = 'none';
      ul.innerHTML = '<li class="muted" style="padding:14px; text-align:center; font-size:13px;">Mercury no devolvió respuesta. Probá de nuevo o reformulá el mensaje.</li>';
      return;
    }
    const ca = document.getElementById('asst-copy-all');
    const cah = document.getElementById('asst-copy-all-human');
    if (ca) ca.style.display = '';
    if (cah) cah.style.display = '';
    blocks.forEach((b, i) => {
      const li = document.createElement('li');
      li.className = 'asst-block';
      li.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div class="asst-block-label">Bloque ${i + 1}</div>
          <div class="asst-block-text"></div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; flex-shrink:0;">
          <button class="btn-table-action asst-block-copy" style="font-size:11px;">Copiar</button>
          <button class="btn-table-action asst-block-copy-human" title="Copiar para Pegar como humano (extensión Chrome)" style="font-size:11px; color:var(--accent);">👤 Humano</button>
        </div>
      `;
      li.querySelector('.asst-block-text').textContent = b;
      li.querySelector('.asst-block-copy').addEventListener('click', async (ev) => {
        try {
          await navigator.clipboard.writeText(b);
          ev.target.textContent = '✓ Copiado';
          setTimeout(() => { ev.target.textContent = 'Copiar'; }, 1500);
        } catch (e) { window.showToast('No pude copiar: ' + e.message, { type: 'error' }); }
      });
      li.querySelector('.asst-block-copy-human').addEventListener('click', async (ev) => {
        try {
          const ext = document.documentElement.getAttribute('data-scm-paste-installed') === '1';
          await navigator.clipboard.writeText(ext ? ('__SCM_TYPE__:' + b) : b);
          ev.target.textContent = ext ? '✓ Ctrl+V en WA' : '⚠ Sin extensión — copié normal';
          setTimeout(() => { ev.target.textContent = '👤 Humano'; }, 2400);
        } catch (e) { window.showToast('No pude copiar: ' + e.message, { type: 'error' }); }
      });
      ul.appendChild(li);
    });
  }

  function _asstRenderCoaching(items) {
    const wrap = document.getElementById('asst-coaching-wrap');
    const ul = document.getElementById('asst-coaching');
    if (!wrap || !ul) return;
    if (!items || !items.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    ul.innerHTML = '';
    items.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'asst-coaching-item';
      li.innerHTML = `
        <span class="asst-coaching-num">${i + 1}</span>
        <span class="asst-coaching-text"></span>
        <button class="btn-table-action asst-coaching-copy" title="Copiar texto" style="font-size:10px; padding:3px 8px; flex-shrink:0;">⧉</button>
      `;
      li.querySelector('.asst-coaching-text').textContent = it;
      li.querySelector('.asst-coaching-copy').addEventListener('click', async (ev) => {
        try {
          await navigator.clipboard.writeText(it);
          ev.target.textContent = '✓';
          setTimeout(() => { ev.target.textContent = '⧉'; }, 1200);
        } catch (e) { window.showToast('No pude copiar: ' + e.message, { type: 'error' }); }
      });
      ul.appendChild(li);
    });
  }

  function _asstRenderEjemplos(ejemplos) {
    const wrap = document.getElementById('asst-ejemplos-wrap');
    const ul = document.getElementById('asst-ejemplos');
    const count = document.getElementById('asst-ejemplos-count');
    if (!ejemplos || !ejemplos.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    count.textContent = ejemplos.length;
    ul.innerHTML = '';
    for (const e of ejemplos) {
      const li = document.createElement('li');
      li.style.cssText = 'padding:10px 12px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px; cursor:pointer; transition:border-color 0.15s;';
      li.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
          <div style="flex:1; min-width:0;">
            <div class="ej-pregunta" style="font-weight:500; color:var(--text-primary); font-size:13px;"></div>
            <div class="muted" style="font-size:10px; margin-top:3px;">
              <span class="ej-cat" style="padding:1px 7px; background:rgba(157,133,242,0.12); color:var(--accent); border-radius:6px; font-weight:500;"></span>
              <span style="margin-left:6px;">score: <span class="ej-score"></span></span>
              <span style="margin-left:6px; opacity:0.7;">click para ver respuesta</span>
            </div>
          </div>
          <span class="ej-toggle muted" style="font-size:14px; flex-shrink:0;">▸</span>
        </div>
        <div class="ej-respuesta-wrap" style="display:none; margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
          <div class="muted" style="font-size:9px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Respuesta del banco</div>
          <div class="ej-respuesta" style="font-size:13px; line-height:1.55; color:var(--text-primary); white-space:pre-wrap;"></div>
          <div style="margin-top:8px; display:flex; gap:6px;">
            <button class="btn-table-action ej-copy" style="font-size:10px; padding:4px 10px;">⧉ Copiar respuesta</button>
            <button class="btn-table-action ej-go" style="font-size:10px; padding:4px 10px;">→ Ver en banco</button>
          </div>
        </div>
      `;
      li.querySelector('.ej-pregunta').textContent = e.pregunta || '—';
      li.querySelector('.ej-cat').textContent = e.categoria || '—';
      li.querySelector('.ej-score').textContent = e.score ?? '—';
      li.querySelector('.ej-respuesta').textContent = e.respuesta || '(sin respuesta cacheada)';
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('.ej-copy') || ev.target.closest('.ej-go')) return;
        const w = li.querySelector('.ej-respuesta-wrap');
        const t = li.querySelector('.ej-toggle');
        const open = w.style.display !== 'none';
        w.style.display = open ? 'none' : 'block';
        t.textContent = open ? '▸' : '▾';
        li.style.borderColor = open ? 'var(--border-color)' : 'rgba(157,133,242,0.4)';
      });
      li.querySelector('.ej-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(e.respuesta || '');
          window.showToast('Respuesta copiada', { type: 'success', duration: 1500 });
        } catch (er) { window.showToast('No pude copiar', { type: 'error' }); }
      });
      li.querySelector('.ej-go').addEventListener('click', () => {
        // Cerrar la vista de asistente y abrir banco con el id resaltado.
        const target = document.querySelector('[data-target="view-faqs"]');
        if (target) target.click();
        setTimeout(() => {
          const card = document.querySelector(`[data-faq-id="${e.id}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.boxShadow = '0 0 0 3px var(--accent)';
            setTimeout(() => { card.style.boxShadow = ''; }, 2500);
          }
        }, 300);
      });
      ul.appendChild(li);
    }
  }

  // Pill informativa de intención detectada
  const INTENT_LABELS = {
    pide_asset: { label: '📎 Pide info / asset', color: '#ffc828', bg: 'rgba(255,200,40,0.10)', border: 'rgba(255,200,40,0.4)' },
    agendamiento: { label: '📅 Quiere agendar', color: '#5bb974', bg: 'rgba(91,185,116,0.10)', border: 'rgba(91,185,116,0.4)' },
    precio: { label: '💲 Pregunta precio', color: '#f85149', bg: 'rgba(248,81,73,0.10)', border: 'rgba(248,81,73,0.4)' },
    objecion: { label: '🛑 Objeción', color: '#f85149', bg: 'rgba(248,81,73,0.10)', border: 'rgba(248,81,73,0.4)' },
    duda_tecnica: { label: '❓ Duda técnica', color: 'var(--accent)', bg: 'rgba(157,133,242,0.10)', border: 'rgba(157,133,242,0.4)' },
    indeciso: { label: '🤔 Indeciso / frío', color: '#ffc828', bg: 'rgba(255,200,40,0.10)', border: 'rgba(255,200,40,0.4)' },
    saludo: { label: '👋 Saludo', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.04)', border: 'var(--border-color)' },
    despedida: { label: '👋 Cierre', color: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.04)', border: 'var(--border-color)' },
    calificacion: { label: '🔍 Da info clínica', color: '#5bb974', bg: 'rgba(91,185,116,0.10)', border: 'rgba(91,185,116,0.4)' },
    otro: null,
  };
  function _asstRenderIntent(intent) {
    const pill = document.getElementById('asst-intent-pill');
    if (!pill) return;
    const meta = INTENT_LABELS[intent];
    if (!meta) { pill.style.display = 'none'; return; }
    pill.textContent = meta.label;
    pill.style.background = meta.bg;
    pill.style.color = meta.color;
    pill.style.borderColor = meta.border;
    pill.style.display = 'inline-flex';
  }

  // Cargar variantes en el selector del Asistente (solo una vez por sesión).
  let _asstVariantsLoaded = false;
  async function _asstLoadVariants() {
    if (_asstVariantsLoaded) return;
    const sel = document.getElementById('asst-variant');
    if (!sel) return;
    try {
      const r = await fetch('/api/setters/variants', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const variants = Array.isArray(d.variants) ? d.variants : (Array.isArray(d) ? d : []);
      for (const v of variants) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.name || v.id;
        sel.appendChild(opt);
      }
      _asstVariantsLoaded = true;
    } catch (e) {
      console.warn('No pude cargar variantes:', e.message);
    }
  }

  async function _asstGenerate(opts = {}) {
    const msg = document.getElementById('asst-prospect-msg').value.trim();
    const ctx = document.getElementById('asst-context').value.trim();
    const history = document.getElementById('asst-history')?.value.trim() || '';
    const variantId = document.getElementById('asst-variant')?.value || '';
    const tone = opts.tone || '';
    if (!msg) { _asstShowError('Pegá el mensaje del prospecto.'); return; }
    _asstResetUI();
    _asstSetLoading(true);
    try {
      const r = await fetch('/api/mercury/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prospectMessage: msg, context: ctx, variantId, conversationHistory: history, tone }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'http ' + r.status);
      _asstCurrentGen = d;
      document.getElementById('asst-output-card').style.display = 'block';
      _asstRenderBlocks(d.blocks || []);
      // Coaching, ejemplos clickeables e intent pill ocultos hasta que la IA
      // esté más estabilizada. Se siguen recibiendo pero no se renderizan.
      // _asstRenderCoaching(d.coaching || []);
      // _asstRenderEjemplos(d.ejemplos || []);
      // _asstRenderIntent(d.intent || '');
      if (d.usedFallback) document.getElementById('asst-fallback-pill').style.display = 'inline-block';
      if (Array.isArray(d.violations) && d.violations.length) {
        const pill = document.getElementById('asst-violations-pill');
        pill.textContent = '⚠ ' + d.violations.join(', ');
        pill.style.display = 'inline-block';
      }
      // Pill de variante usada (informativa: confirma al setter que Mercury la consideró)
      const vPill = document.getElementById('asst-variant-pill');
      if (vPill) {
        if (d.variantUsed && d.variantUsed.name) {
          vPill.textContent = '🎯 ' + d.variantUsed.name;
          vPill.style.display = 'inline-block';
        } else {
          vPill.style.display = 'none';
        }
      }
    } catch (e) {
      _asstShowError('Error: ' + e.message);
    } finally {
      _asstSetLoading(false);
    }
  }

  async function _asstPatch(payload, statusMsg) {
    if (!_asstCurrentGen?.id) return;
    try {
      const r = await fetch(`/api/mercury/generations/${encodeURIComponent(_asstCurrentGen.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'http ' + r.status); }
      const st = document.getElementById('asst-status');
      st.textContent = statusMsg;
      st.style.display = 'block';
    } catch (e) {
      _asstShowError('Error: ' + e.message);
    }
  }

  document.querySelector('[data-target="view-assistant"]')?.addEventListener('click', () => {
    _asstLoadVariants();
    // _asstLoadMine() y otras secciones avanzadas deshabilitadas hasta que la
    // IA esté más entrenada — vuelve a flujo simple para reducir fricción.
    setTimeout(() => {
      document.getElementById('asst-prospect-msg')?.focus();
    }, 100);
  });

  document.getElementById('asst-generate-btn')?.addEventListener('click', () => _asstGenerate());

  // Botones de tono → re-generan con el mismo input + modificador
  document.querySelectorAll('.asst-tone-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tone = btn.getAttribute('data-tone');
      _asstGenerate({ tone });
    });
  });

  // Paste clipboard al mensaje principal (botón explícito porque algunos browsers
  // no permiten clipboard read sin gesture)
  document.getElementById('asst-paste-clipboard')?.addEventListener('click', async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt || !txt.trim()) { window.showToast('Clipboard vacío', { type: 'warn' }); return; }
      const ta = document.getElementById('asst-prospect-msg');
      ta.value = txt.trim();
      ta.focus();
    } catch (e) {
      window.showToast('No pude leer el clipboard. Pegalo con Ctrl+V.', { type: 'warn' });
    }
  });

  // Keyboard shortcuts dentro de la vista del asistente
  document.getElementById('asst-prospect-msg')?.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Enter → generar
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      _asstGenerate();
    }
  });
  // Ctrl+1/2/3 a nivel documento — solo si la vista del asistente está visible
  document.addEventListener('keydown', (e) => {
    const view = document.getElementById('view-assistant');
    if (!view || view.classList.contains('hidden')) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const idx = parseInt(e.key, 10) - 1;
      const blocks = _asstCurrentGen?.blocks || [];
      if (blocks[idx]) {
        e.preventDefault();
        navigator.clipboard.writeText(blocks[idx]);
        window.showToast(`Bloque ${idx + 1} copiado`, { type: 'success', duration: 1500 });
      }
    }
  });

  // Cargar "mis últimas generaciones"
  async function _asstLoadMine() {
    const list = document.getElementById('asst-mine-list');
    const empty = document.getElementById('asst-mine-empty');
    if (!list) return;
    try {
      const r = await fetch('/api/mercury/generations?limit=10', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const items = (d.generations || []).slice(0, 10);
      list.innerHTML = '';
      if (!items.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      for (const g of items) {
        const li = document.createElement('li');
        li.className = 'asst-mine-item';
        const when = new Date(g.createdAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        const prevMsg = (g.prospectMessage || '').slice(0, 90);
        const prevOut = (g.output?.text || '').slice(0, 120);
        li.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <div style="flex:1; min-width:0;">
              <div class="asst-mine-msg" style="font-size:12px; color:var(--text-secondary); margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
              <div class="asst-mine-out" style="font-size:12px; color:var(--text-primary); line-height:1.45; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;"></div>
            </div>
            <div style="font-size:10px; color:var(--text-secondary); flex-shrink:0;">${when}</div>
          </div>`;
        li.querySelector('.asst-mine-msg').textContent = '💬 ' + prevMsg + (g.prospectMessage.length > 90 ? '…' : '');
        li.querySelector('.asst-mine-out').textContent = prevOut + (g.output?.text?.length > 120 ? '…' : '');
        li.addEventListener('click', async () => {
          // Reusar: pegar el mensaje en el campo y popular output con la generación cacheada
          document.getElementById('asst-prospect-msg').value = g.prospectMessage || '';
          if (g.context) document.getElementById('asst-context').value = g.context;
          if (g.conversationHistory) document.getElementById('asst-history').value = g.conversationHistory;
          _asstCurrentGen = { id: g.id, blocks: g.output?.blocks || [], text: g.output?.text || '', coaching: g.output?.coaching || [], ejemplos: g.ejemplos || [] };
          document.getElementById('asst-output-card').style.display = 'block';
          _asstRenderBlocks(_asstCurrentGen.blocks);
          _asstRenderCoaching(_asstCurrentGen.coaching);
          _asstRenderEjemplos(_asstCurrentGen.ejemplos);
          window.showToast('Generación restaurada. Podés copiar o reformular.', { type: 'info' });
          window.scrollTo({ top: document.getElementById('asst-output-card').offsetTop - 80, behavior: 'smooth' });
        });
        list.appendChild(li);
      }
    } catch (e) {
      console.warn('asst-load-mine:', e.message);
    }
  }

  document.getElementById('asst-copy-all')?.addEventListener('click', async (ev) => {
    if (!_asstCurrentGen?.blocks?.length) return;
    try {
      await navigator.clipboard.writeText(_asstCurrentGen.blocks.join('\n\n'));
      ev.target.textContent = '✓ Copiado todo';
      setTimeout(() => { ev.target.textContent = '📋 Copiar todo'; }, 1500);
    } catch (e) { alert('No pude copiar: ' + e.message); }
  });

  document.getElementById('asst-copy-all-human')?.addEventListener('click', async (ev) => {
    if (!_asstCurrentGen?.blocks?.length) return;
    try {
      const txt = _asstCurrentGen.blocks.join('\n\n');
      const ext = document.documentElement.getAttribute('data-scm-paste-installed') === '1';
      await navigator.clipboard.writeText(ext ? ('__SCM_TYPE__:' + txt) : txt);
      ev.target.textContent = ext ? '✓ Ctrl+V en WA' : '⚠ Sin extensión — copié normal';
      setTimeout(() => { ev.target.textContent = '👤 Copiar todo humano'; }, 2400);
    } catch (e) { alert('No pude copiar: ' + e.message); }
  });

  document.querySelector('.asst-act-good')?.addEventListener('click', () => {
    _asstPatch({ setterAction: 'good' }, 'Marcada como buena. Gracias por el feedback.');
  });
  document.querySelector('.asst-act-bad')?.addEventListener('click', () => {
    _asstPatch({ setterAction: 'bad' }, 'Marcada como descartada. Vamos a aprender de eso.');
  });
  document.querySelector('.asst-act-edit')?.addEventListener('click', () => {
    if (!_asstCurrentGen) return;
    const box = document.getElementById('asst-edit-box');
    const ta = document.getElementById('asst-edit-text');
    ta.value = _asstCurrentGen.text || (_asstCurrentGen.blocks || []).join('\n\n');
    box.style.display = 'block';
    ta.focus();
  });
  document.getElementById('asst-edit-cancel')?.addEventListener('click', () => {
    document.getElementById('asst-edit-box').style.display = 'none';
  });
  document.getElementById('asst-edit-save')?.addEventListener('click', async () => {
    const ta = document.getElementById('asst-edit-text');
    const txt = (ta?.value || '').trim();
    if (!txt) { _asstShowError('La versión final no puede estar vacía.'); return; }
    await _asstPatch({ setterAction: 'edited', setterEditedText: txt, finalSent: txt }, 'Guardada la versión final que enviaste.');
    document.getElementById('asst-edit-box').style.display = 'none';
    try { await navigator.clipboard.writeText(txt); } catch {}
  });

  // ── Revisión IA (solo admin) ──
  let _mrSetters = [];

  function _mrEscape(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function _mrStatusPill(g) {
    const map = {
      pendiente: { text: 'Pendiente', bg: 'rgba(180,180,180,0.10)', color: '#9aa0a6', border: 'rgba(180,180,180,0.30)' },
      approved: { text: '✓ Oro', bg: 'rgba(91,185,116,0.12)', color: '#5bb974', border: 'rgba(91,185,116,0.45)' },
      rejected: { text: '✗ Rechazada', bg: 'rgba(248,81,73,0.10)', color: '#f85149', border: 'rgba(248,81,73,0.45)' },
      rewritten: { text: '✎ Reescrita', bg: 'rgba(157,133,242,0.14)', color: '#9D85F2', border: 'rgba(157,133,242,0.50)' },
      reviewed: { text: '💡 Con nota', bg: 'rgba(255,200,40,0.12)', color: '#ffc828', border: 'rgba(255,200,40,0.45)' },
    };
    const m = map[g.status] || map.pendiente;
    return `<span class="chip" style="padding:4px 10px; font-size:11px; font-weight:500; background:${m.bg}; color:${m.color}; border:1px solid ${m.border}; border-radius:999px; white-space:nowrap;">${m.text}</span>`;
  }

  function _mrSetterActionPill(g) {
    if (!g.setterAction) return '';
    const map = {
      good: { text: 'Setter: ✓ buena', color: '#5bb974' },
      bad: { text: 'Setter: ✗ descartó', color: '#f85149' },
      edited: { text: 'Setter: ✎ editó', color: '#9D85F2' },
    };
    const m = map[g.setterAction];
    if (!m) return '';
    return `<span class="chip" style="padding:3px 9px; font-size:10px; background:transparent; color:${m.color}; border:1px solid ${m.color}40; border-radius:999px; white-space:nowrap;">${m.text}</span>`;
  }

  function _mrInitial(name) {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  // Cache de generaciones por id para que el modal de detalle pueda leer.
  const _mrCache = new Map();

  // Tarjeta compacta para el grid. Click → modal de detalle. Hover → preview tooltip.
  function _mrRenderGen(g) {
    _mrCache.set(g.id, g);
    const div = document.createElement('div');
    div.className = 'card mr-card';
    div.dataset.id = g.id;
    div.style.cssText = 'padding:14px 16px; display:flex; flex-direction:column; gap:10px; border-radius:14px; cursor:pointer; transition:border-color 0.18s, transform 0.18s ease-out, box-shadow 0.18s; position:relative; min-height:160px;';
    div.onmouseover = () => {
      div.style.borderColor = 'var(--accent)';
      div.style.transform = 'translateY(-2px)';
      div.style.boxShadow = '0 8px 24px rgba(157,133,242,0.10)';
      _mrShowPreview(div, g);
    };
    div.onmouseout = () => {
      div.style.borderColor = 'var(--border-color)';
      div.style.transform = '';
      div.style.boxShadow = '';
      _mrHidePreview();
    };
    div.onclick = () => _mrOpenDetail(g.id);

    const setterInitial = _mrInitial(g.setterName);
    const variantTag = g.variantUsed?.name
      ? `<span style="padding:2px 7px; font-size:9px; background:rgba(157,133,242,0.10); color:var(--accent); border:1px solid rgba(157,133,242,0.35); border-radius:999px; white-space:nowrap;">🎯 ${_mrEscape(g.variantUsed.name)}</span>`
      : '';
    const violationsTag = (g.violations || []).length
      ? `<span title="${_mrEscape(g.violations.join(', '))}" style="padding:2px 7px; font-size:9px; background:rgba(248,81,73,0.10); color:#f85149; border:1px solid rgba(248,81,73,0.35); border-radius:999px; white-space:nowrap;">⚠</span>`
      : '';

    // Truncar mensaje del prospecto a 90 chars para preview en card.
    const prospectShort = (g.prospectMessage || '').length > 100
      ? g.prospectMessage.substring(0, 100) + '…'
      : g.prospectMessage || '—';
    const blockCount = (g.output?.blocks || []).length;

    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <div style="width:28px; height:28px; flex-shrink:0; background:linear-gradient(135deg, var(--accent) 0%, #7a5ff0 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:12px;">${setterInitial}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_mrEscape(g.setterName || '—')}</div>
          <div class="muted" style="font-size:10px; margin-top:1px;">${new Date(g.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div>
        </div>
        ${_mrStatusPill(g)}
      </div>
      <div style="font-size:12px; color:var(--text-secondary); line-height:1.4; flex:1; overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical;">
        <span style="color:var(--text-primary); font-weight:500;">"</span>${_mrEscape(prospectShort)}<span style="color:var(--text-primary); font-weight:500;">"</span>
      </div>
      <div style="display:flex; gap:5px; flex-wrap:wrap; align-items:center; padding-top:8px; border-top:1px solid var(--border-color);">
        ${variantTag}${violationsTag}
        <span class="muted" style="font-size:10px; margin-left:auto;">💬 ${blockCount} bloque${blockCount === 1 ? '' : 's'}</span>
        ${_mrSetterActionPill(g) || ''}
      </div>
    `;
    return div;
  }

  // Tooltip flotante con la respuesta completa de Mercury (preview en hover).
  let _mrPreviewEl = null;
  function _mrShowPreview(card, g) {
    _mrHidePreview();
    if (!g.output?.blocks?.length) return;
    const tooltip = document.createElement('div');
    tooltip.id = 'mr-hover-preview';
    tooltip.style.cssText = 'position:fixed; z-index:1500; max-width:380px; background:var(--surface-color); border:1px solid var(--accent); border-radius:12px; padding:14px 16px; box-shadow:0 12px 32px rgba(0,0,0,0.55); pointer-events:none;';
    const blocks = g.output.blocks.map((b, i) => `
      <div style="padding:8px 10px; background:rgba(157,133,242,0.06); border-left:2px solid var(--accent); border-radius:6px; margin-bottom:6px;">
        <div style="font-size:9px; text-transform:uppercase; letter-spacing:0.5px; color:var(--accent); opacity:0.6; font-weight:600; margin-bottom:3px;">Bloque ${i + 1}</div>
        <div style="font-size:12px; line-height:1.5; color:var(--text-primary); white-space:pre-wrap; word-break:break-word;">${_mrEscape(b)}</div>
      </div>
    `).join('');
    tooltip.innerHTML = `
      <div style="font-size:10px; color:var(--accent); text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:8px; display:flex; align-items:center; gap:5px;">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        Respuesta Mercury
      </div>
      ${blocks}
      <div class="muted" style="font-size:10px; margin-top:6px; padding-top:6px; border-top:1px dashed var(--border-color);">Click para ver detalles y aprobar/reescribir/etc.</div>
    `;
    document.body.appendChild(tooltip);
    _mrPreviewEl = tooltip;
    // Posicionamiento: derecha de la card si entra, sino izquierda.
    const rect = card.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    let left = rect.right + 12;
    let top = rect.top;
    if (left + tipRect.width > window.innerWidth - 16) left = rect.left - tipRect.width - 12;
    if (top + tipRect.height > window.innerHeight - 16) top = window.innerHeight - tipRect.height - 16;
    if (top < 16) top = 16;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }
  function _mrHidePreview() {
    if (_mrPreviewEl && _mrPreviewEl.parentNode) _mrPreviewEl.parentNode.removeChild(_mrPreviewEl);
    _mrPreviewEl = null;
  }

  // Modal de detalle: abre con todo el contenido + 4 botones de acción.
  let _mrCurrentDetailId = null;
  function _mrOpenDetail(id) {
    const g = _mrCache.get(id);
    if (!g) return;
    _mrCurrentDetailId = id;
    const setterInitial = _mrInitial(g.setterName);
    document.getElementById('mr-detail-avatar').textContent = setterInitial;
    document.getElementById('mr-detail-title').textContent = g.setterName || '—';
    document.getElementById('mr-detail-meta').innerHTML = `${new Date(g.createdAt).toLocaleString()} · prompt v${g.promptVersion ?? '—'}${g.variantUsed?.name ? ' · 🎯 ' + _mrEscape(g.variantUsed.name) : ''}${g.usedFallback ? ' · <span style="color:#ffc828;">fallback</span>' : ''}${(g.violations||[]).length ? ' · <span style="color:#f85149;">⚠ ' + _mrEscape(g.violations.join(', ')) + '</span>' : ''}`;

    const blocksHtml = (g.output?.blocks || []).map((b, i) => `
      <div style="position:relative; padding:14px 16px 14px 18px; background:rgba(157,133,242,0.05); border-left:3px solid var(--accent); border-radius:10px; font-size:14px; line-height:1.55; color:var(--text-primary); white-space:pre-wrap; word-break:break-word;">
        <div style="position:absolute; top:8px; right:10px; font-size:9px; text-transform:uppercase; letter-spacing:0.6px; color:var(--accent); opacity:0.55; font-weight:600;">B${i + 1}</div>
        ${_mrEscape(b)}
      </div>
    `).join('');

    const finalSentHtml = g.finalSent
      ? `<div style="padding:12px 14px; border-left:3px solid #9D85F2; background:rgba(157,133,242,0.06); border-radius:8px;">
          <div style="font-size:10px; color:var(--accent); text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:4px;">Versión final que envió el setter</div>
          <div style="font-size:13px; color:var(--text-primary); line-height:1.55; white-space:pre-wrap;">${_mrEscape(g.finalSent)}</div>
        </div>` : '';

    const adminBlocks = [];
    if (g.adminAction === 'rewritten' && g.adminRewrite) adminBlocks.push(`<div style="padding:12px 14px; border-left:3px solid #5bb974; background:rgba(91,185,116,0.06); border-radius:8px;"><div style="font-size:10px; color:#5bb974; text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:4px;">Reescritura del admin</div><div style="font-size:13px; color:var(--text-primary); line-height:1.55; white-space:pre-wrap;">${_mrEscape(g.adminRewrite)}</div></div>`);
    if (g.adminAction === 'suggested_improvement' && g.adminNote) adminBlocks.push(`<div style="padding:12px 14px; border-left:3px solid #ffc828; background:rgba(255,200,40,0.06); border-radius:8px;"><div style="font-size:10px; color:#ffc828; text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:4px;">💡 Nota de mejora</div><div style="font-size:13px; color:var(--text-primary); line-height:1.55; white-space:pre-wrap;">${_mrEscape(g.adminNote)}</div></div>`);
    if (g.adminAction === 'rejected' && g.adminRejectReason) adminBlocks.push(`<div style="padding:12px 14px; border-left:3px solid #f85149; background:rgba(248,81,73,0.06); border-radius:8px;"><div style="font-size:10px; color:#f85149; text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:4px;">Razón del rechazo</div><div style="font-size:13px; color:var(--text-primary); line-height:1.55; white-space:pre-wrap;">${_mrEscape(g.adminRejectReason)}</div></div>`);

    const ejemplosHtml = (g.ejemplos || []).length
      ? `<details style="font-size:11px;"><summary style="cursor:pointer; color:var(--text-secondary); padding:4px 0; user-select:none;">📚 Ejemplos del banco usados (${g.ejemplos.length})</summary><ul style="list-style:none; padding:8px 0 0 0; margin:0; display:flex; flex-direction:column; gap:5px;">${g.ejemplos.map((e) => `<li style="padding:6px 10px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:8px; display:flex; gap:8px; align-items:center; font-size:11px;"><span style="flex:1; color:var(--text-primary);">${_mrEscape(e.pregunta)}</span><span style="background:var(--accent-soft); color:var(--accent); padding:1px 8px; border-radius:6px; font-size:10px;">${_mrEscape(e.categoria)}</span><span style="color:var(--text-secondary); font-variant-numeric:tabular-nums;">${e.score}</span></li>`).join('')}</ul></details>` : '';

    const adminFooter = g.adminAction
      ? `<div class="muted" style="font-size:11px; padding:8px 0; border-top:1px dashed var(--border-color);">Revisada por <strong style="color:var(--text-primary);">${_mrEscape(g.adminReviewedBy || '—')}</strong> · ${g.adminReviewedAt ? new Date(g.adminReviewedAt).toLocaleString() : ''}</div>` : '';

    document.getElementById('mr-detail-body').innerHTML = `
      <div>
        <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:6px;">Mensaje del prospecto</div>
        <div style="display:flex; gap:8px; align-items:flex-start;">
          <div style="width:24px; height:24px; flex-shrink:0; border-radius:50%; background:rgba(255,255,255,0.04); border:1px solid var(--border-color); display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--text-secondary);">👤</div>
          <div style="flex:1; padding:12px 14px; background:rgba(255,255,255,0.025); border:1px solid var(--border-color); border-radius:14px; border-top-left-radius:4px; font-size:13.5px; line-height:1.55; color:var(--text-primary); white-space:pre-wrap; word-break:break-word;">${_mrEscape(g.prospectMessage)}</div>
        </div>
        ${g.context ? `<div style="margin-top:8px; margin-left:32px; padding:8px 12px; font-size:12px; color:var(--text-secondary); background:rgba(255,255,255,0.02); border:1px dashed var(--border-color); border-radius:10px; line-height:1.5; white-space:pre-wrap;"><strong style="color:var(--text-primary); font-size:10px; text-transform:uppercase; letter-spacing:0.4px;">Contexto:</strong> ${_mrEscape(g.context)}</div>` : ''}
      </div>
      <div>
        <div style="font-size:10px; color:var(--accent); text-transform:uppercase; letter-spacing:0.6px; font-weight:600; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          Respuesta de Mercury
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">${blocksHtml}</div>
      </div>
      ${finalSentHtml}
      ${adminBlocks.length ? `<div style="display:flex; flex-direction:column; gap:8px;">${adminBlocks.join('')}</div>` : ''}
      ${ejemplosHtml}
      ${adminFooter}
    `;
    document.getElementById('mr-detail-modal').style.display = 'flex';
  }

  function _mrCloseDetail() {
    document.getElementById('mr-detail-modal').style.display = 'none';
    _mrCurrentDetailId = null;
  }

  async function _mrLoad() {
    const params = new URLSearchParams();
    const setterId = document.getElementById('mr-filter-setter')?.value || '';
    const status = document.getElementById('mr-filter-status')?.value || '';
    const setterAction = document.getElementById('mr-filter-setteraction')?.value || '';
    if (setterId) params.set('setterId', setterId);
    if (status) params.set('status', status);
    if (setterAction) params.set('setterAction', setterAction);
    params.set('limit', '100');

    try {
      const r = await fetch(`/api/mercury/generations?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      const list = document.getElementById('mr-list');
      const empty = document.getElementById('mr-empty');
      const total = document.getElementById('mr-total');
      list.innerHTML = '';
      if (total) total.textContent = `${d.generations.length} de ${d.total} generaciones`;
      if (!d.generations.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';

      // Popular filtro de setters (solo en primer carga, dedup por id)
      const sel = document.getElementById('mr-filter-setter');
      if (sel && _mrSetters.length === 0) {
        const seen = new Set();
        for (const g of d.generations) {
          const sid = g.setterId || g.userId || '';
          const sname = g.setterName || sid;
          if (sid && !seen.has(sid)) {
            seen.add(sid);
            _mrSetters.push({ id: sid, name: sname });
          }
        }
        for (const s of _mrSetters) {
          const opt = document.createElement('option');
          opt.value = s.id; opt.textContent = s.name;
          sel.appendChild(opt);
        }
      }

      _mrCache.clear();
      for (const g of d.generations) list.appendChild(_mrRenderGen(g));
    } catch (e) {
      alert('Error cargando revisión IA: ' + e.message);
    }
  }

  async function _mrAct(id, action) {
    let body = {};
    let path = `/api/mercury/generations/${encodeURIComponent(id)}`;
    if (action === 'approve') {
      const ok = await window.askConfirm({
        title: '🥇 Aprobar como ejemplo de oro',
        message: 'Esta respuesta se va a promover al Banco de Respuestas con tag "aprobado-admin", para que Mercury la use como ejemplo few-shot en futuras generaciones similares.',
        confirmLabel: 'Promover al banco',
      });
      if (!ok) return;
      path += '/approve';
    } else if (action === 'reject') {
      const reason = await window.askText({
        title: '✗ Rechazar generación',
        subtitle: 'Anotá una razón del rechazo (opcional). Se guarda como referencia para revisar después.',
        type: 'input',
        placeholder: 'Ej: tono demasiado formal, mencionó precio…',
        confirmLabel: 'Rechazar',
        confirmRequired: false,
      });
      if (reason === null) return;
      path += '/reject';
      if (reason) body.reason = reason;
    } else if (action === 'rewrite') {
      const text = await window.askText({
        title: '✎ Reescribir respuesta',
        subtitle: 'Pegá la respuesta correcta. Se va a promover al banco de respuestas con tag "reescrita-admin".',
        type: 'textarea',
        placeholder: 'Te entiendo. Lo vemos en una llamada y revisamos como aplicaria a tu caso.\n\nLe parece mañana o el miércoles?',
        confirmLabel: 'Promover al banco',
        hint: 'Sin signos ¿¡ de apertura. Bloques separados con doble salto de línea.',
      });
      if (!text) return;
      path += '/rewrite';
      body.text = text;
    } else if (action === 'suggest') {
      const note = await window.askText({
        title: '💡 Sugerir mejora a Mercury',
        subtitle: 'Escribí la sugerencia. Se va a inyectar como nota en futuras generaciones para que Mercury aprenda.',
        type: 'textarea',
        placeholder: 'Ej: cuando preguntan por software ya existente, profundizar antes de pitchear.',
        confirmLabel: 'Guardar sugerencia',
        hint: 'Tip: las últimas 10 sugerencias se inyectan automáticamente en cada generación nueva.',
      });
      if (!note) return;
      path += '/suggest-improvement';
      body.note = note;
    }
    try {
      const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'http ' + r.status);
      const msgs = {
        approve: 'Generación promovida al banco como ejemplo de oro.',
        reject: 'Generación marcada como rechazada.',
        rewrite: 'Reescritura promovida al banco con tag "reescrita-admin".',
        suggest: 'Sugerencia guardada. Mercury la va a usar en futuras generaciones.',
      };
      window.showToast(msgs[action] || 'Acción aplicada.', { type: 'success' });
      _mrLoad();
    } catch (e) {
      window.showToast('Error: ' + e.message, { type: 'error', duration: 5000 });
    }
  }

  document.querySelector('[data-target="view-mercury-review"]')?.addEventListener('click', () => {
    setTimeout(() => _mrLoad(), 100);
  });
  document.getElementById('mr-refresh')?.addEventListener('click', () => _mrLoad());
  document.getElementById('mr-filter-setter')?.addEventListener('change', () => _mrLoad());
  document.getElementById('mr-filter-status')?.addEventListener('change', () => _mrLoad());
  document.getElementById('mr-filter-setteraction')?.addEventListener('change', () => _mrLoad());

  // Handlers del modal de detalle
  document.getElementById('mr-detail-close')?.addEventListener('click', _mrCloseDetail);
  document.getElementById('mr-detail-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'mr-detail-modal') _mrCloseDetail();
  });
  document.getElementById('mr-detail-approve')?.addEventListener('click', async () => {
    if (!_mrCurrentDetailId) return;
    await _mrAct(_mrCurrentDetailId, 'approve');
    _mrCloseDetail();
  });
  document.getElementById('mr-detail-rewrite')?.addEventListener('click', async () => {
    if (!_mrCurrentDetailId) return;
    await _mrAct(_mrCurrentDetailId, 'rewrite');
    _mrCloseDetail();
  });
  document.getElementById('mr-detail-suggest')?.addEventListener('click', async () => {
    if (!_mrCurrentDetailId) return;
    await _mrAct(_mrCurrentDetailId, 'suggest');
    _mrCloseDetail();
  });
  document.getElementById('mr-detail-reject')?.addEventListener('click', async () => {
    if (!_mrCurrentDetailId) return;
    await _mrAct(_mrCurrentDetailId, 'reject');
    _mrCloseDetail();
  });

  // ── Mi rendimiento (setter + admin + supervisor) ──
  let _mypChart = null;
  let _mypLastData = null;
  let _mypActiveSeries = ['agendados']; // KPIs visibles en el chart

  const MYP_KPI_DEFS = [
    { key: 'total',        label: 'Total leads',  hint: 'Leads tocados en el período' },
    { key: 'conexiones',   label: 'Conexiones',   hint: 'WhatsApp enviados' },
    { key: 'respondieron', label: 'Respondieron', hint: 'Leads que contestaron' },
    { key: 'calificados',  label: 'Calificados',  hint: 'Leads que pasaron calificación' },
    { key: 'interesados',  label: 'Interesados',  hint: 'Leads que mostraron interés' },
    { key: 'agendados',    label: 'Agendados',    hint: 'Reuniones cerradas' },
    { key: 'shows',        label: 'Show rate',    hint: 'Asistieron a la llamada (de marcados)', isShowRate: true },
  ];

  function _mypFmtDelta(d) {
    if (!d) return '';
    const abs = d.abs || 0;
    const pct = d.pct || 0;
    if (abs === 0 && pct === 0) return '<span class="muted" style="font-size:11px;">sin cambios</span>';
    const arrow = abs > 0 ? '▲' : '▼';
    const color = abs > 0 ? '#5bb974' : '#f85149';
    return `<span style="color:${color}; font-size:12px; font-weight:600;">${arrow} ${Math.abs(abs)} <span style="font-size:10px; opacity:0.85;">(${pct > 0 ? '+' : ''}${pct}%)</span></span>`;
  }

  function _mypRenderKpis(d) {
    const el = document.getElementById('myp-kpis');
    if (!el) return;
    el.innerHTML = '';
    for (const def of MYP_KPI_DEFS) {
      let value, deltaHtml = '';
      if (def.isShowRate) {
        const shows = d.totals.shows || 0;
        const noShows = d.totals.noShows || 0;
        const denom = shows + noShows;
        value = denom > 0 ? `${d.totals.pctShow}%` : '—';
        const prevDenom = (d.previous.shows || 0) + (d.previous.noShows || 0);
        const prevPct = prevDenom > 0 ? Number(((d.previous.shows / prevDenom) * 100).toFixed(1)) : 0;
        const curr = denom > 0 ? d.totals.pctShow : 0;
        const abs = Number((curr - prevPct).toFixed(1));
        const pctRel = prevPct > 0 ? Number((((curr - prevPct) / prevPct) * 100).toFixed(1)) : (curr > 0 ? 100 : 0);
        deltaHtml = denom > 0 ? _mypFmtDelta({ abs, pct: pctRel }) : '<span class="muted" style="font-size:11px;">sin agendados</span>';
      } else {
        value = d.totals[def.key];
        deltaHtml = _mypFmtDelta(d.deltas[def.key]);
      }
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'padding:18px 20px; display:flex; flex-direction:column; gap:10px; min-height:120px; border-radius:14px; transition:border-color 0.18s, transform 0.18s ease-out, box-shadow 0.18s; cursor:default;';
      card.onmouseover = () => { card.style.borderColor = 'var(--accent)'; card.style.transform = 'translateY(-2px)'; card.style.boxShadow = '0 8px 24px rgba(157,133,242,0.10)'; };
      card.onmouseout = () => { card.style.borderColor = 'var(--border-color)'; card.style.transform = ''; card.style.boxShadow = ''; };
      card.innerHTML = `
        <div class="muted" style="font-size:10px; text-transform:uppercase; letter-spacing:0.7px; font-weight:600;">${def.label}</div>
        <div style="font-size:32px; font-weight:700; color:var(--text-primary); line-height:1; letter-spacing:-1px; font-variant-numeric:tabular-nums;">${value}</div>
        <div style="margin-top:auto;">${deltaHtml}</div>
      `;
      card.title = def.hint;
      el.appendChild(card);
    }
  }

  function _mypRenderChartToggle() {
    const wrap = document.getElementById('myp-chart-toggle');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const def of MYP_KPI_DEFS) {
      if (def.isShowRate) continue;
      const active = _mypActiveSeries.includes(def.key);
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.textContent = def.label;
      btn.style.cssText = `font-size:11px; padding:4px 10px; ${active ? 'background:var(--accent-soft); color:var(--accent); border-color:var(--accent);' : ''}`;
      btn.addEventListener('click', () => {
        if (active) {
          _mypActiveSeries = _mypActiveSeries.filter((k) => k !== def.key);
          if (_mypActiveSeries.length === 0) _mypActiveSeries = ['agendados'];
        } else {
          _mypActiveSeries = [..._mypActiveSeries, def.key];
        }
        _mypRenderChartToggle();
        _mypRenderChart(_mypLastData);
      });
      wrap.appendChild(btn);
    }
  }

  function _mypRenderChart(d) {
    if (!d || !window.Chart) return;
    const canvas = document.getElementById('myp-chart');
    if (!canvas) return;
    const labels = d.buckets.map((b) => b.label);
    const palette = { total:'#9D85F2', conexiones:'#5bb974', respondieron:'#4dabf7', calificados:'#ffc828', interesados:'#ff8a3d', agendados:'#9D85F2' };
    const datasets = _mypActiveSeries.map((k) => {
      const def = MYP_KPI_DEFS.find((x) => x.key === k);
      return {
        label: def?.label || k,
        data: d.buckets.map((b) => b[k] || 0),
        borderColor: palette[k] || '#9D85F2',
        backgroundColor: (palette[k] || '#9D85F2') + '22',
        tension: 0.3,
        fill: false,
        borderWidth: 2,
      };
    });
    if (_mypChart) _mypChart.destroy();
    _mypChart = new window.Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#aaa', font: { size: 11 } } },
        },
        scales: {
          x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#222' } },
          y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: '#222' }, beginAtZero: true },
        },
      },
    });
  }

  async function _mypLoad() {
    // 2026-05-25: chain Cold Call Funnel load para que aparezca sin depender de click
    if (typeof window._ccmLoadDeferred === 'function') {
      try { window._ccmLoadDeferred(); } catch {}
    }
    const period = document.getElementById('myp-period')?.value || 'week';
    const setterFilter = document.getElementById('myp-setter')?.value || '';
    const params = new URLSearchParams();
    params.set('period', period);
    // En modo "Ver como" (admin impersonando setter), el backend ve admin via cookie y no
    // fuerza el setter. Tenemos que pasarlo explicito desde el frontend.
    const u = window.__CURRENT_USER__;
    const isViewAsSetter = u?.realRole === 'admin' && u?.role === 'setter' && u?.setterId;
    const effectiveSetter = setterFilter || (isViewAsSetter ? u.setterId : '');
    if (effectiveSetter) params.set('setter', effectiveSetter);
    try {
      const r = await fetch(`/api/setters/performance?${params.toString()}`, { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      _mypLastData = d;
      const range = document.getElementById('myp-range');
      if (range) range.textContent = `${new Date(d.from).toLocaleDateString()} → ${new Date(d.to).toLocaleDateString()}`;
      _mypRenderKpis(d);
      _mypRenderChart(d);

      // Popular selector de setters si admin/supervisor (primer carga)
      const wrap = document.getElementById('myp-setter-wrap');
      const sel = document.getElementById('myp-setter');
      const role = window.__CURRENT_USER__?.role;
      if ((role === 'admin' || role === 'supervisor') && wrap) {
        wrap.style.display = 'block';
        if (sel && sel.children.length <= 1 && Array.isArray(d.setters)) {
          for (const s of d.setters) {
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.name;
            sel.appendChild(opt);
          }
        }
      }
    } catch (e) {
      alert('Error cargando rendimiento: ' + e.message);
    }
  }

  document.querySelector('[data-target="view-myperf"]')?.addEventListener('click', () => {
    setTimeout(() => { _mypRenderChartToggle(); _mypLoad(); }, 80);
  });
  document.getElementById('myp-period')?.addEventListener('change', () => _mypLoad());
  document.getElementById('myp-setter')?.addEventListener('change', () => _mypLoad());

  // ───────────────────────────────────────────────────────────────
  // Phase 6 Sprint 8: Historial de llamadas con transcripciones
  // ───────────────────────────────────────────────────────────────
  let _chistCache = [];
  let _chistSelected = null;

  async function _chistLoad() {
    const search = document.getElementById('chist-search')?.value || '';
    const outcome = document.getElementById('chist-outcome')?.value || '';
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (outcome) params.set('outcome', outcome);
      params.set('limit', '100');
      const r = await fetch(apiUrl('/api/telnyx/calls/recent?' + params.toString()), { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      _chistCache = d.calls || [];
      const badge = document.getElementById('chist-count-badge');
      if (badge) badge.textContent = `${d.total || 0} llamadas`;
      _chistRenderList();
    } catch (e) { console.warn('[chist]', e.message); }
  }

  function _chistRenderList() {
    const list = document.getElementById('chist-list');
    const empty = document.getElementById('chist-empty');
    if (!list) return;
    if (_chistCache.length === 0) {
      list.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';
    const outcomeIcon = {
      answered_interested: '✅', answered_not_interested: '❌',
      no_answer: '📵', voicemail: '📭', callback_later: '🔄',
      wrong_number: '🔢', invalid_number: '🚫',
      scheduled_with_admin: '📅',
    };
    list.innerHTML = _chistCache.map(c => {
      const date = new Date(c.ts);
      const dateTxt = date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) + ' ' + date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const dur = c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}` : '—';
      const transcriptIcon = c.hasTranscript ? '🎤' : '';
      const isSelected = _chistSelected && _chistSelected.leadId === c.leadId && _chistSelected.callIdx === c.callIdx;
      return `<li onclick="window._chistSelect('${escHtml(c.leadId)}', ${c.callIdx})" style="padding:10px 12px; background:${isSelected ? 'rgba(157,133,242,0.12)' : 'var(--bg-app)'}; border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}; border-radius:9px; cursor:pointer; transition:all 0.15s;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div style="flex:1; min-width:0;">
            <div style="font-size:12.5px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              ${outcomeIcon[c.outcome] || '📞'} ${escHtml(c.leadName || c.leadPhone)} ${transcriptIcon}
            </div>
            <div style="font-size:10.5px; color:var(--text-secondary); margin-top:3px;">
              ${escHtml(c.leadCity || '')}${c.leadCity && c.leadCountry ? ' · ' : ''}${escHtml(c.leadCountry || '')} · ${dur}
            </div>
          </div>
          <div style="font-size:10px; color:var(--text-tertiary); flex-shrink:0; text-align:right;">
            ${dateTxt}
            ${c.cost ? `<br><span style="color:#FFB341;">$${c.cost.toFixed(3)}</span>` : ''}
          </div>
        </div>
      </li>`;
    }).join('');
  }

  window._chistSelect = async (leadId, callIdx) => {
    _chistSelected = { leadId, callIdx };
    _chistRenderList();
    const placeholder = document.getElementById('chist-detail-placeholder');
    const detail = document.getElementById('chist-detail');
    if (placeholder) placeholder.style.display = 'none';
    if (detail) detail.style.display = 'block';
    try {
      const r = await fetch(apiUrl(`/api/telnyx/calls/${encodeURIComponent(leadId)}/${callIdx}/transcript`), { credentials: 'include' });
      if (!r.ok) {
        document.getElementById('chist-d-transcript').innerHTML = '<span class="muted">No se pudo cargar.</span>';
        return;
      }
      const d = await r.json();
      const lead = d.lead;
      const c = d.call;
      const outcomeLabel = {
        answered_interested: '✅ Interesado',
        answered_not_interested: '❌ No interesado',
        no_answer: '📵 No atendió', voicemail: '📭 Buzón',
        callback_later: '🔄 Callback', wrong_number: '🔢 Equivocado',
        invalid_number: '🚫 No existe', scheduled_with_admin: '📅 Agendado',
      };
      document.getElementById('chist-d-name').textContent = `${lead.name || lead.phone} ${lead.doctor && !lead.doctor.includes('N/A') ? ' · ' + lead.doctor : ''}`;
      document.getElementById('chist-d-meta').textContent = `${lead.phone}${lead.city ? ' · ' + lead.city : ''}${lead.country ? ' · ' + lead.country : ''} · ${new Date(c.ts).toLocaleString('es-AR')}`;
      document.getElementById('chist-d-outcome').textContent = outcomeLabel[c.outcome] || c.outcome || '—';
      const statCard = (l, v, col = 'var(--text-primary)') => `<div style="padding:8px 10px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:7px;"><div style="font-size:9.5px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px;">${l}</div><div style="font-size:14px; font-weight:600; color:${col}; margin-top:2px;">${v}</div></div>`;
      const dur = c.duration ? `${Math.floor(c.duration / 60)}:${String(c.duration % 60).padStart(2, '0')}` : '—';
      document.getElementById('chist-d-stats').innerHTML =
        statCard('Duración', dur) +
        (c.cost ? statCard('Costo', `$${c.cost.toFixed(3)}`, '#FFB341') : '') +
        (c.fromNumber ? statCard('Caller ID', c.fromNumber, '#7dd3fc') : '');
      const notesEl = document.getElementById('chist-d-notes');
      // Sprint 11: mostrar quickNote (durante/post-call) Y notes (de disposition)
      const parts = [];
      if (c.quickNote) parts.push(`<div style="margin-bottom:6px;"><strong style="color:#FFB341; font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">📓 Nota del setter (during-call)</strong><div style="margin-top:3px;">${escHtml(c.quickNote)}</div></div>`);
      if (c.notes) parts.push(`<div><strong style="color:var(--text-secondary); font-size:10px; text-transform:uppercase; letter-spacing:0.5px;">📝 Nota disposition</strong><div style="margin-top:3px;">${escHtml(c.notes)}</div></div>`);
      if (parts.length > 0) { notesEl.style.display = 'block'; notesEl.innerHTML = parts.join(''); }
      else { notesEl.style.display = 'none'; }
      // Sprint 10: bloque Mercury IA entre notes y transcript
      let analysisBlockEl = document.getElementById('chist-d-mercury');
      if (!analysisBlockEl) {
        analysisBlockEl = document.createElement('div');
        analysisBlockEl.id = 'chist-d-mercury';
        analysisBlockEl.style.marginBottom = '14px';
        const transcriptHeader = document.getElementById('chist-d-transcript').previousElementSibling;
        transcriptHeader.parentNode.insertBefore(analysisBlockEl, transcriptHeader);
      }
      if (c.mercuryAnalysis) {
        _chistRenderMercuryAnalysis(c.mercuryAnalysis, leadId, callIdx);
      } else if (c.transcript?.segments?.length) {
        analysisBlockEl.innerHTML = `
          <div style="padding:14px; background:rgba(157,133,242,0.05); border:1px dashed rgba(157,133,242,0.3); border-radius:10px; text-align:center;">
            <div style="font-size:13px; color:var(--text-primary); margin-bottom:8px; font-weight:600;">🧠 Análisis Mercury IA disponible</div>
            <button onclick="window._chistAnalyzeWithMercury('${escHtml(leadId)}', ${callIdx})" class="btn-primary" style="padding:9px 16px; border-radius:9px; font-size:12.5px;">🧠 Analizar con Mercury IA</button>
            <div style="font-size:10.5px; color:var(--text-secondary); margin-top:6px;">Evalúa según framework PACE, 3-S, opener 27s, reglas SCM v2</div>
          </div>`;
      } else {
        analysisBlockEl.innerHTML = '';
      }
      const transcriptEl = document.getElementById('chist-d-transcript');
      const transcriptMetaEl = document.getElementById('chist-d-transcript-meta');
      if (c.transcript?.segments?.length) {
        transcriptMetaEl.textContent = `${c.transcript.segments.length} fragmentos · ${c.transcript.whisperModel || 'whisper-1'}`;
        // Renderizar segments con speaker tags. Resaltar el keyword si hay búsqueda activa.
        const searchTerm = (document.getElementById('chist-search')?.value || '').toLowerCase().trim();
        transcriptEl.innerHTML = c.transcript.segments.map(s => {
          const speakerColor = s.speaker === 'setter' ? '#5bb974' : '#FFB341';
          const speakerLabel = s.speaker === 'setter' ? '👤 Setter' : '🎯 Lead';
          let text = escHtml(s.text);
          if (searchTerm && text.toLowerCase().includes(searchTerm)) {
            const re = new RegExp('(' + searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
            text = text.replace(re, '<mark style="background:rgba(157,133,242,0.35); color:#fff; padding:0 2px; border-radius:2px;">$1</mark>');
          }
          const ts = `${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')}`;
          return `<div style="display:flex; gap:8px; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.04);">
            <span style="flex-shrink:0; font-size:10px; color:var(--text-tertiary); font-family:ui-monospace,monospace; padding-top:2px;">${ts}</span>
            <span style="flex-shrink:0; font-size:10px; color:${speakerColor}; font-weight:600; padding-top:2px; min-width:65px;">${speakerLabel}</span>
            <span style="flex:1; color:var(--text-primary);">${text}</span>
          </div>`;
        }).join('');
      } else {
        transcriptMetaEl.textContent = '';
        transcriptEl.innerHTML = '<div class="muted" style="text-align:center; padding:24px; font-size:12px;">Sin transcripción disponible.<br><small>Se requiere OPENAI_API_KEY en Railway y llamada >5s.</small></div>';
      }
    } catch (e) { console.warn('[chist] detail load:', e.message); }
  };

  // Sprint 10: análisis Mercury IA del transcript
  window._chistAnalyzeWithMercury = async (leadId, callIdx) => {
    const block = document.getElementById('chist-d-mercury');
    if (!block) return;
    block.innerHTML = `
      <div style="padding:16px; background:rgba(157,133,242,0.08); border:1px solid rgba(157,133,242,0.3); border-radius:10px; text-align:center;">
        <div style="font-size:13px; color:var(--text-primary); margin-bottom:6px;">🧠 Mercury analizando…</div>
        <div style="font-size:11px; color:var(--text-secondary);">Esto puede tardar 5-15 seg según largo del transcript.</div>
      </div>`;
    try {
      const r = await fetch(apiUrl(`/api/telnyx/calls/${encodeURIComponent(leadId)}/${callIdx}/analyze`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const d = await r.json(); if (d?.error) msg = d.error; } catch {}
        block.innerHTML = `<div style="padding:12px; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.3); border-radius:9px; color:#f85149; font-size:12px;">Error: ${escHtml(msg)}</div>`;
        return;
      }
      const d = await r.json();
      _chistRenderMercuryAnalysis(d.analysis, leadId, callIdx);
      if (d.cached) window.showToast?.('Análisis recuperado de cache (ya estaba guardado)', { type: 'info' });
      else window.showToast?.('✓ Análisis Mercury listo', { type: 'success' });
    } catch (e) {
      block.innerHTML = `<div style="padding:12px; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.3); border-radius:9px; color:#f85149; font-size:12px;">Error: ${escHtml(e.message)}</div>`;
    }
  };

  function _chistRenderMercuryAnalysis(a, leadId, callIdx) {
    const block = document.getElementById('chist-d-mercury');
    if (!block || !a) return;
    // Score color: verde >=7, ámbar 5-6, rojo <5
    const score = a.score || 0;
    const scoreColor = score >= 7 ? '#5bb974' : score >= 5 ? '#FFB341' : '#f85149';
    const passedColor = a.passedOpener ? '#5bb974' : '#f85149';
    const paceOk = a.paceCompliance?.objections_handled_correctly || 0;
    const paceFail = a.paceCompliance?.objections_failed || 0;
    const violations = Array.isArray(a.ruleViolations) ? a.ruleViolations : [];
    const opportunities = Array.isArray(a.missedOpportunities) ? a.missedOpportunities : [];
    const suggestions = Array.isArray(a.specificSuggestions) ? a.specificSuggestions : [];
    block.innerHTML = `
      <div style="padding:16px; background:linear-gradient(135deg, rgba(157,133,242,0.08) 0%, rgba(157,133,242,0.02) 100%); border:1px solid rgba(157,133,242,0.3); border-radius:12px;">
        <!-- Header: score + estado opener + PACE -->
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:14px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:54px; height:54px; border-radius:14px; background:${scoreColor}22; border:2px solid ${scoreColor}; display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:700; color:${scoreColor};">${score}</div>
            <div>
              <div style="font-size:12.5px; color:var(--text-primary); font-weight:600;">🧠 Score Mercury IA</div>
              <div style="font-size:11px; color:var(--text-secondary); margin-top:2px; max-width:280px;">${escHtml(a.scoreReason || '')}</div>
            </div>
          </div>
          <div style="flex:1; min-width:120px; display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
            <span style="font-size:10.5px; padding:3px 9px; background:${passedColor}22; color:${passedColor}; border:1px solid ${passedColor}55; border-radius:6px; font-weight:600;">${a.passedOpener ? '✅ Pasó opener' : '❌ No pasó opener'}</span>
            <span style="font-size:10px; color:var(--text-secondary);">PACE: <strong style="color:#5bb974;">${paceOk} ✓</strong> · <strong style="color:#f85149;">${paceFail} ✗</strong></span>
          </div>
        </div>

        <!-- Strength + Mistake -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          ${a.biggestStrength ? `<div style="padding:10px; background:rgba(91,185,116,0.08); border:1px solid rgba(91,185,116,0.25); border-radius:8px;">
            <div style="font-size:10px; color:#5bb974; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:4px;">✅ Tu fortaleza</div>
            <div style="font-size:11.5px; color:var(--text-primary); line-height:1.5;">${escHtml(a.biggestStrength)}</div>
          </div>` : ''}
          ${a.biggestMistake ? `<div style="padding:10px; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.25); border-radius:8px;">
            <div style="font-size:10px; color:#f85149; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:4px;">❌ Tu error principal</div>
            <div style="font-size:11.5px; color:var(--text-primary); line-height:1.5;">${escHtml(a.biggestMistake)}</div>
          </div>` : ''}
        </div>

        <!-- Missed opportunities + Rule violations -->
        ${opportunities.length > 0 ? `<div style="margin-bottom:10px;">
          <div style="font-size:10.5px; color:#FFB341; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:5px;">⚠ Oportunidades perdidas</div>
          <ul style="margin:0; padding:0 0 0 16px; font-size:11.5px; color:var(--text-primary); line-height:1.6;">
            ${opportunities.map(o => `<li>${escHtml(o)}</li>`).join('')}
          </ul>
        </div>` : ''}
        ${violations.length > 0 ? `<div style="margin-bottom:10px;">
          <div style="font-size:10.5px; color:#f85149; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:5px;">🚫 Reglas violadas</div>
          <ul style="margin:0; padding:0 0 0 16px; font-size:11.5px; color:var(--text-primary); line-height:1.6;">
            ${violations.map(v => `<li>${escHtml(v)}</li>`).join('')}
          </ul>
        </div>` : ''}
        ${a.paceCompliance?.notes ? `<div style="padding:8px 11px; background:rgba(255,255,255,0.03); border-radius:7px; margin-bottom:10px; font-size:11px; color:var(--text-secondary); line-height:1.5; border-left:3px solid #7dd3fc;"><strong style="color:#7dd3fc;">PACE:</strong> ${escHtml(a.paceCompliance.notes)}</div>` : ''}

        <!-- Sugerencias accionables -->
        ${suggestions.length > 0 ? `<div style="padding:11px; background:rgba(125,211,252,0.06); border:1px solid rgba(125,211,252,0.2); border-radius:9px; margin-bottom:10px;">
          <div style="font-size:11px; color:#7dd3fc; text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:6px;">💡 Sugerencias específicas</div>
          <ul style="margin:0; padding:0 0 0 18px; font-size:11.5px; color:var(--text-primary); line-height:1.6;">
            ${suggestions.map(s => `<li>${escHtml(s)}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${a.nextCallTip ? `<div style="padding:12px; background:rgba(157,133,242,0.1); border:1px solid rgba(157,133,242,0.35); border-radius:9px; text-align:center;">
          <div style="font-size:10px; color:var(--accent); text-transform:uppercase; letter-spacing:0.5px; font-weight:600; margin-bottom:5px;">🎯 Cambio #1 para la próxima</div>
          <div style="font-size:12.5px; color:#fff; font-weight:600; line-height:1.5;">${escHtml(a.nextCallTip)}</div>
        </div>` : ''}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.05);">
          <span style="font-size:9.5px; color:var(--text-tertiary);">Analizado: ${a.analyzedAt ? new Date(a.analyzedAt).toLocaleString('es-AR') : '—'} · ${a.modelUsed || 'IA'}</span>
          <button onclick="window._chistReAnalyze('${escHtml(leadId)}', ${callIdx})" style="background:none; border:1px solid rgba(255,255,255,0.1); color:var(--text-secondary); cursor:pointer; padding:3px 8px; border-radius:5px; font-size:10px;">↻ Re-analizar</button>
        </div>
      </div>`;
  }

  window._chistReAnalyze = async (leadId, callIdx) => {
    const block = document.getElementById('chist-d-mercury');
    if (!block) return;
    block.innerHTML = `<div style="padding:16px; background:rgba(157,133,242,0.08); border:1px solid rgba(157,133,242,0.3); border-radius:10px; text-align:center; color:var(--text-secondary); font-size:12px;">🧠 Re-analizando con Mercury…</div>`;
    try {
      const r = await fetch(apiUrl(`/api/telnyx/calls/${encodeURIComponent(leadId)}/${callIdx}/analyze`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ force: true }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        block.innerHTML = `<div style="padding:12px; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.3); border-radius:9px; color:#f85149; font-size:12px;">Error: ${escHtml(d.error || ('HTTP ' + r.status))}</div>`;
        return;
      }
      const d = await r.json();
      _chistRenderMercuryAnalysis(d.analysis, leadId, callIdx);
      window.showToast?.('✓ Re-analizado', { type: 'success' });
    } catch (e) {
      block.innerHTML = `<div style="padding:12px; background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.3); border-radius:9px; color:#f85149; font-size:12px;">Error: ${escHtml(e.message)}</div>`;
    }
  };

  document.querySelector('[data-target="view-call-history"]')?.addEventListener('click', () => { setTimeout(_chistLoad, 80); });
  document.getElementById('chist-search')?.addEventListener('input', () => {
    clearTimeout(window.__chistSearchTimer);
    window.__chistSearchTimer = setTimeout(_chistLoad, 350);
  });
  document.getElementById('chist-outcome')?.addEventListener('change', _chistLoad);
  document.getElementById('myp-refresh')?.addEventListener('click', () => _mypLoad());

  // ─── Cold Call Funnel (dentro de view-myperf) ──────────────────
  // 2026-05-25: pedido del user (curso de cold calling).
  // Carga /api/setters/cold-call-metrics y renderiza funnel + ratios.
  let _ccmPeriod = 'week';
  window._ccmLoadDeferred = () => _ccmLoad();
  async function _ccmLoad() {
    const cont = document.getElementById('ccm-content');
    if (!cont) return;
    // Setter scope: si admin/supervisor + dropdown setter elegido, usar ese.
    // Si setter, backend filtra solo. Si admin sin setter → equipo completo.
    const setterSel = document.getElementById('myp-setter')?.value || '';
    const qs = new URLSearchParams({ period: _ccmPeriod });
    if (setterSel) qs.set('setter', setterSel);
    try {
      const r = await fetch(apiUrl('/api/setters/cold-call-metrics?' + qs.toString()), { credentials: 'include' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      _ccmRender(d);
    } catch (err) {
      cont.innerHTML = `<p class="muted" style="text-align:center; padding:20px 0; font-size:13px; color:var(--danger);">Error cargando métricas: ${escHtml(err.message)}</p>`;
    }
  }

  function _ccmRender(d) {
    const cont = document.getElementById('ccm-content');
    if (!cont) return;
    const m = d.metrics || {};
    const r = d.rates || {};
    const fmtPct = (v) => (v == null ? '—' : v + '%');
    const fmtDur = (s) => {
      if (!s) return '—';
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
    };
    // Funnel visual: barras con ancho proporcional al máximo (dials).
    const maxV = Math.max(m.dials || 1, 1);
    const bar = (v, color) => {
      const pct = Math.min(100, (v / maxV) * 100);
      return `<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin-top:6px;"><div style="height:100%; width:${pct}%; background:${color}; transition:width 0.3s;"></div></div>`;
    };
    const stage = (icon, label, value, sublabel, color) => `
      <div style="padding:14px 16px; background:rgba(255,255,255,0.025); border:1px solid var(--border-soft); border-left:3px solid ${color}; border-radius:10px;">
        <div style="display:flex; align-items:baseline; gap:10px;">
          <span style="font-size:16px;">${icon}</span>
          <div style="flex:1; min-width:0;">
            <div style="font-size:10.5px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">${label}</div>
            <div style="font-size:24px; font-weight:700; color:var(--text-primary); line-height:1.1; margin-top:2px; font-variant-numeric:tabular-nums;">${value || 0}</div>
            ${sublabel ? `<div style="font-size:10.5px; color:var(--text-tertiary); margin-top:3px;">${sublabel}</div>` : ''}
          </div>
        </div>
        ${bar(value, color)}
      </div>`;

    const dealsLabel = m.deals > 0 ? `${m.deals}` : `<span style="color:var(--text-tertiary); font-size:14px;">—</span>`;
    const revenueStr = m.revenue > 0 ? `$${Number(m.revenue).toLocaleString('es-AR')} cerrados` : 'Marcá citas como 🏆 ganadas';
    cont.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:18px;">
        ${stage('📞', 'Dials Made', m.dials, 'Llamadas marcadas', '#7E8494')}
        ${stage('📲', 'Connects', m.connects, fmtPct(r.connectRate) + ' rate', '#79B8FF')}
        ${stage('💬', 'Conversations', m.conversations, fmtPct(r.conversationRate) + ' de connects', '#9D85F2')}
        ${stage('📅', 'Appointments', m.appointments, fmtPct(r.bookingRate) + ' de convs', '#5BB974')}
        ${stage('💰', 'Deals Closed', dealsLabel, m.deals > 0 ? fmtPct(r.closeRate) + ' rate · ' + revenueStr : revenueStr, '#FFB341')}
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px; padding-top:14px; border-top:1px solid var(--border-soft);">
        <div style="text-align:center; padding:8px;">
          <div style="font-size:18px; font-weight:700; color:var(--text-primary); font-variant-numeric:tabular-nums;">${fmtPct(r.connectRate)}</div>
          <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px;">Connect Rate</div>
        </div>
        <div style="text-align:center; padding:8px;">
          <div style="font-size:18px; font-weight:700; color:var(--text-primary); font-variant-numeric:tabular-nums;">${fmtPct(r.conversationRate)}</div>
          <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px;">Conversation Rate</div>
        </div>
        <div style="text-align:center; padding:8px;">
          <div style="font-size:18px; font-weight:700; color:var(--text-primary); font-variant-numeric:tabular-nums;">${fmtPct(r.bookingRate)}</div>
          <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px;">Booking Rate</div>
        </div>
        <div style="text-align:center; padding:8px;">
          <div style="font-size:18px; font-weight:700; color:var(--accent); font-variant-numeric:tabular-nums;">${fmtPct(r.dialToAppointment)}</div>
          <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px;">Dial → Appointment</div>
        </div>
        <div style="text-align:center; padding:8px;">
          <div style="font-size:18px; font-weight:700; color:var(--text-primary); font-variant-numeric:tabular-nums;">${fmtDur(d.avgConvDurationS)}</div>
          <div style="font-size:10px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px;">Avg Duration</div>
        </div>
      </div>

      <div style="margin-top:14px; padding:10px 14px; background:rgba(157,133,242,0.06); border:1px solid rgba(157,133,242,0.18); border-radius:8px; font-size:11.5px; color:var(--text-secondary); line-height:1.5;">
        <strong style="color:var(--accent);">💡 Benchmarks:</strong> Connect 15-30% · Conversation 40-60% de connects · Booking 15-25% de convs · Dial→Appt 1-3% (60-150 dials/día = 1-4 appts).
      </div>
    `;
  }

  // Wire period buttons
  document.querySelectorAll('.ccm-period-btn').forEach((b) => {
    b.addEventListener('click', () => {
      _ccmPeriod = b.getAttribute('data-period') || 'week';
      document.querySelectorAll('.ccm-period-btn').forEach((x) => {
        x.classList.remove('active');
        x.style.background = 'var(--bg-app)';
        x.style.borderColor = 'var(--border-color)';
        x.style.color = 'var(--text-primary)';
        x.style.fontWeight = '';
      });
      b.classList.add('active');
      b.style.background = 'rgba(157,133,242,0.18)';
      b.style.borderColor = 'var(--accent)';
      b.style.color = 'var(--accent)';
      b.style.fontWeight = '600';
      _ccmLoad();
    });
  });

  // Auto-load cuando entran a la view o cambia setter
  document.querySelector('[data-target="view-myperf"]')?.addEventListener('click', () => {
    setTimeout(_ccmLoad, 200);
  });
  document.getElementById('myp-setter')?.addEventListener('change', () => _ccmLoad());
  document.getElementById('myp-refresh')?.addEventListener('click', () => _ccmLoad());

  // ─── Vista 📅 Mis programados ──────────────────────────────────
  let _scheduledTab = 'pending';
  let _scheduledCache = [];
  async function _loadScheduled() {
    const cont = document.getElementById('scheduled-list');
    if (!cont) return;
    cont.innerHTML = '<div class="muted" style="padding:20px; text-align:center;">Cargando...</div>';
    try {
      // Pedimos sin filtro para poder contar por tab
      const r = await fetch(apiUrl('/api/scheduled-messages?limit=500'));
      const data = await r.json();
      _scheduledCache = data.scheduledMessages || [];
      _renderScheduled();
    } catch (e) {
      cont.innerHTML = '<div class="muted" style="padding:20px; color:var(--danger);">Error: ' + escHtml(e.message) + '</div>';
    }
  }
  function _renderScheduled() {
    const cont = document.getElementById('scheduled-list');
    if (!cont) return;
    // Counts por tab
    const counts = { pending: 0, sent: 0, failed: 0, cancelled: 0, expired: 0, all: _scheduledCache.length };
    _scheduledCache.forEach(m => { if (counts[m.status] !== undefined) counts[m.status]++; });
    ['pending','sent','failed','cancelled','expired'].forEach(s => {
      const el = document.getElementById('sched-tab-count-' + s);
      if (el) el.textContent = '(' + counts[s] + ')';
    });
    const filtered = _scheduledTab === 'all' ? _scheduledCache : _scheduledCache.filter(m => m.status === _scheduledTab);
    if (filtered.length === 0) {
      cont.innerHTML = '<div class="empty-state" style="padding:40px; text-align:center; color:var(--text-secondary);">Sin mensajes en esta categoría.</div>';
      return;
    }
    const statusChip = (s) => {
      const map = {
        pending: ['rgba(157,133,242,0.15)', 'var(--accent)', '⏳ Pendiente'],
        sent: ['rgba(91,185,116,0.15)', 'var(--success)', '✓ Enviado'],
        failed: ['rgba(248,81,73,0.15)', 'var(--danger)', '✗ Fallido'],
        cancelled: ['rgba(126,132,148,0.15)', 'var(--text-tertiary)', '⊘ Cancelado'],
        expired: ['rgba(248,81,73,0.10)', 'var(--danger)', '⌛ Expirado'],
      };
      const [bg, col, label] = map[s] || ['rgba(0,0,0,0.1)', 'var(--text)', s];
      return '<span style="font-size:10px; padding:2px 8px; background:' + bg + '; color:' + col + '; border-radius:6px;">' + label + '</span>';
    };
    // Necesitamos los nombres de leads — los cacheamos del setterLeads global si está
    const leadName = (id) => {
      const l = (window.__setterLeads || []).find(x => x.id === id);
      return l ? l.name : id;
    };
    cont.innerHTML = '<table style="width:100%; border-collapse:collapse;"><thead><tr style="text-align:left; font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">' +
      '<th style="padding:8px 10px;">Cuándo</th><th style="padding:8px 10px;">Lead</th><th style="padding:8px 10px;">Mensaje</th><th style="padding:8px 10px;">Estado</th><th style="padding:8px 10px;">Acciones</th>' +
      '</tr></thead><tbody>' +
      filtered.map(m => {
        const when = new Date(m.scheduledFor);
        const whenStr = when.toLocaleString();
        const canCancel = m.status === 'pending';
        return '<tr style="border-top:1px solid var(--border-color);">' +
          '<td style="padding:10px; font-size:12px; color:var(--text-primary); white-space:nowrap;">' + escHtml(whenStr) + '</td>' +
          '<td style="padding:10px; font-size:12px;"><a href="#" onclick="event.preventDefault(); window._openLeadModal(\'' + escHtml(m.leadId) + '\');" style="color:var(--accent); text-decoration:none;">' + escHtml(leadName(m.leadId).substring(0, 40)) + '</a></td>' +
          '<td style="padding:10px; font-size:12px; max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + escHtml(m.message) + '">' + escHtml(m.message.slice(0, 80)) + (m.message.length > 80 ? '…' : '') + '</td>' +
          '<td style="padding:10px;">' + statusChip(m.status) + (m.lastFailureReason ? '<div style="font-size:10px; color:var(--danger); margin-top:3px;">' + escHtml(m.lastFailureReason) + '</div>' : '') + '</td>' +
          '<td style="padding:10px;">' + (canCancel ? '<button onclick="window._cancelScheduled(\'' + escHtml(m.id) + '\').then(() => window._loadScheduled())" style="padding:4px 10px; background:none; border:1px solid var(--danger); color:var(--danger); border-radius:6px; font-size:11px; cursor:pointer;">Cancelar</button>' : '—') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>';
  }
  window._loadScheduled = _loadScheduled;
  document.querySelectorAll('[data-scheduled-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-scheduled-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _scheduledTab = btn.dataset.scheduledTab;
      _renderScheduled();
    });
  });
  document.querySelector('[data-target="view-scheduled"]')?.addEventListener('click', () => {
    setTimeout(_loadScheduled, 80);
  });
  document.getElementById('scheduled-refresh-btn')?.addEventListener('click', _loadScheduled);

  // Badge del sidebar: cada 60s consulta cuántos pendientes en las próximas 24h
  async function _updateScheduledBadge() {
    try {
      const r = await fetch(apiUrl('/api/scheduled-messages/upcoming'));
      const d = await r.json();
      const badge = document.getElementById('sidebar-scheduled-badge');
      if (badge) {
        if (d.count > 0) { badge.textContent = d.count; badge.style.display = 'inline-block'; }
        else { badge.style.display = 'none'; }
      }
    } catch {}
  }
  _updateScheduledBadge();
  setInterval(_updateScheduledBadge, 60_000);

  // ── Equipo (admin + supervisor) ──
  let _teamData = null;
  let _teamSort = { key: 'total', dir: 'desc' };

  function _teamFmtDelta(d) {
    if (!d) return '';
    const abs = d.abs || 0;
    if (abs === 0) return '';
    const arrow = abs > 0 ? '▲' : '▼';
    const color = abs > 0 ? '#5bb974' : '#f85149';
    return ` <span style="color:${color}; font-size:10px; opacity:0.85;">${arrow}${Math.abs(abs)}</span>`;
  }

  function _teamCell(value, deltaHtml, vsAvg) {
    let bg = 'transparent';
    if (vsAvg === 'above') bg = 'rgba(91,185,116,0.07)';
    else if (vsAvg === 'below') bg = 'rgba(248,81,73,0.07)';
    return `<td style="padding:14px 10px; text-align:right; background:${bg}; font-variant-numeric:tabular-nums; color:var(--text-primary);">${value}${deltaHtml}</td>`;
  }

  // Cell de "Follow-ups hoy" en panel Equipo. Pinta rojo si supera el umbral
  // (alertConfig.followupsTodayThreshold). Si tiene atrasados, los muestra
  // en chip naranja chico.
  function _teamFollowupsCell(s) {
    const today = s.followupsToday || 0;
    const overdue = s.followupsOverdue || 0;
    const threshold = (_teamData?.alertConfig?.followupsTodayThreshold) ?? 15;
    let bg = 'transparent';
    let color = 'var(--text-primary)';
    if (today > threshold) { bg = 'rgba(248,81,73,0.10)'; color = '#f85149'; }
    else if (today > 0) { bg = 'rgba(91,185,116,0.07)'; color = '#5bb974'; }
    const overdueChip = overdue > 0 ? ` <span title="Atrasados (>1 día)" style="font-size:10px; padding:1px 6px; background:rgba(255,138,61,0.15); color:#ff8a3d; border-radius:6px; margin-left:4px;">+${overdue}</span>` : '';
    return `<td style="padding:14px 10px; text-align:right; background:${bg}; font-variant-numeric:tabular-nums; color:${color}; font-weight:${today > 0 ? '600' : '400'};">${today}${overdueChip}</td>`;
  }

  function _teamRenderAlerts(alerts) {
    const wrap = document.getElementById('team-alerts');
    const list = document.getElementById('team-alerts-list');
    const count = document.getElementById('team-alerts-count');
    if (!alerts.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    count.textContent = alerts.length;
    list.innerHTML = '';
    for (const a of alerts) {
      const li = document.createElement('li');
      const sevColor = { high: '#f85149', medium: '#ffc828', low: '#aaa' }[a.severity] || '#aaa';
      li.innerHTML = `<span style="color:${sevColor}; font-weight:600;">●</span> <strong style="color:var(--text-primary);"></strong> <span class="muted"></span>`;
      li.querySelector('strong').textContent = a.setterName || '—';
      li.querySelector('.muted').textContent = a.message;
      list.appendChild(li);
    }
  }

  function _teamSorted(rows) {
    const { key, dir } = _teamSort;
    const get = (r) => {
      if (key === 'name') return r.name;
      if (key === 'followupsToday') return r.followupsToday ?? 0;
      return r.current?.[key] ?? 0;
    };
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === 'asc' ? va - vb : vb - va;
    });
  }

  function _teamRenderTable(d) {
    const tbody = document.getElementById('team-tbody');
    const tfoot = document.getElementById('team-tfoot');
    const empty = document.getElementById('team-empty');
    tbody.innerHTML = '';
    tfoot.innerHTML = '';
    if (!d.perSetter.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const avg = d.teamAverages;
    const vsAvg = (key, val) => {
      const a = avg[key] || 0;
      if (a === 0) return null;
      if (val > a * 1.1) return 'above';
      if (val < a * 0.9) return 'below';
      return null;
    };

    const sorted = _teamSorted(d.perSetter);
    sorted.forEach((s, idx) => {
      const c = s.current;
      const lastAct = s.lastActivity ? new Date(s.lastActivity).toLocaleDateString() : '—';
      const alertCount = (s.alerts || []).length;
      // Severidad mas alta del setter para colorear el badge
      const sevs = (s.alerts || []).map(a => a.severity);
      const topSev = sevs.includes('high') ? 'high' : sevs.includes('medium') ? 'medium' : 'low';
      const sevBg = { high: 'rgba(248,81,73,0.20)', medium: 'rgba(255,200,40,0.18)', low: 'rgba(170,170,170,0.18)' }[topSev];
      const sevColor = { high: '#f85149', medium: '#ffc828', low: '#aaa' }[topSev];
      const alertBadge = alertCount > 0 ? ` <span title="${escHtml((s.alerts||[]).map(a=>a.message).join(' • '))}" style="display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 6px; font-size:10px; font-weight:700; background:${sevBg}; color:${sevColor}; border-radius:999px; vertical-align:middle;">${alertCount}</span>` : '';
      // Badge "sin tocar" con detalle de asignados/sin trabajar (visible siempre)
      const totalAssigned = s.totalAssigned || 0;
      const untouched = s.untouchedAssigned || 0;
      let assignedBadge = '';
      if (totalAssigned > 0) {
        const ratio = untouched / totalAssigned;
        const bgColor = ratio >= 0.5 ? 'rgba(248,81,73,0.12)' : ratio > 0.2 ? 'rgba(255,200,40,0.12)' : 'rgba(91,185,116,0.12)';
        const txtColor = ratio >= 0.5 ? '#f85149' : ratio > 0.2 ? '#ffc828' : '#5bb974';
        assignedBadge = ` <span title="Total asignados al setter (no del periodo). ${untouched} sin tocar." style="font-size:10px; padding:2px 6px; background:${bgColor}; color:${txtColor}; border-radius:6px; vertical-align:middle;">📥 ${totalAssigned}${untouched > 0 ? ` · ${untouched} sin tocar` : ''}</span>`;
      }
      const initial = String(s.name || '?').trim().charAt(0).toUpperCase() || '?';
      const tr = document.createElement('tr');
      const zebra = idx % 2 === 1 ? 'background:rgba(255,255,255,0.012);' : '';
      tr.style.cssText = `border-bottom:1px solid var(--border-color); cursor:pointer; transition:background-color 0.15s; ${zebra}`;
      tr.dataset.setterId = s.id;
      tr.onmouseover = () => { tr.style.backgroundColor = 'rgba(157,133,242,0.06)'; };
      tr.onmouseout = () => { tr.style.backgroundColor = ''; };
      tr.innerHTML = `
        <td style="padding:14px 10px; font-weight:500; color:var(--text-primary);">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:28px; height:28px; flex-shrink:0; background:linear-gradient(135deg, var(--accent) 0%, #7a5ff0 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:12px;">${initial}</div>
            <span class="t-name"></span>${alertBadge}${assignedBadge}
          </div>
        </td>
        ${_teamCell(c.total, _teamFmtDelta(s.deltas.total), vsAvg('total', c.total))}
        ${_teamCell(c.conexiones, _teamFmtDelta(s.deltas.conexiones), vsAvg('conexiones', c.conexiones))}
        ${_teamCell(c.respondieron, _teamFmtDelta(s.deltas.respondieron), vsAvg('respondieron', c.respondieron))}
        ${_teamCell(c.calificados, _teamFmtDelta(s.deltas.calificados), vsAvg('calificados', c.calificados))}
        ${_teamCell(c.interesados, _teamFmtDelta(s.deltas.interesados), vsAvg('interesados', c.interesados))}
        ${_teamCell(c.agendados, _teamFmtDelta(s.deltas.agendados), vsAvg('agendados', c.agendados))}
        ${_teamCell(c.pctShow + '%', '', vsAvg('pctShow', c.pctShow))}
        ${_teamFollowupsCell(s)}
        <td style="padding:14px 10px; text-align:right; color:var(--text-secondary); font-size:12px; white-space:nowrap;">${lastAct}</td>
      `;
      tr.querySelector('.t-name').textContent = s.name;
      tr.addEventListener('click', () => _teamDrilldown(s.id));
      tbody.appendChild(tr);
    });

    // Total follow-ups hoy del equipo (suma directa, no promedio)
    const totalFuToday = d.perSetter.reduce((sum, s) => sum + (s.followupsToday || 0), 0);
    const totalFuOverdue = d.perSetter.reduce((sum, s) => sum + (s.followupsOverdue || 0), 0);
    // Footer con promedios del equipo
    tfoot.innerHTML = `
      <tr style="border-top:2px solid var(--border-color); font-weight:600; color:var(--text-secondary);">
        <td style="padding:10px 8px;">Promedio equipo</td>
        <td style="padding:10px 8px; text-align:right;">${avg.total}</td>
        <td style="padding:10px 8px; text-align:right;">${avg.conexiones}</td>
        <td style="padding:10px 8px; text-align:right;">${avg.respondieron}</td>
        <td style="padding:10px 8px; text-align:right;">${avg.calificados}</td>
        <td style="padding:10px 8px; text-align:right;">${avg.interesados}</td>
        <td style="padding:10px 8px; text-align:right;">${avg.agendados}</td>
        <td style="padding:10px 8px; text-align:right;">${avg.pctShow}%</td>
        <td style="padding:10px 8px; text-align:right; color:var(--text-primary); font-weight:700;" title="Total del equipo">${totalFuToday}${totalFuOverdue > 0 ? ` <span style="font-size:10px; padding:1px 6px; background:rgba(255,138,61,0.15); color:#ff8a3d; border-radius:6px; margin-left:4px; font-weight:600;">+${totalFuOverdue}</span>` : ''}</td>
        <td></td>
      </tr>
    `;
  }

  function _teamDrilldown(setterId) {
    // Navegar a Mi rendimiento con setter pre-seleccionado.
    const item = document.querySelector('[data-target="view-myperf"]');
    if (!item) return;
    item.click();
    setTimeout(() => {
      const sel = document.getElementById('myp-setter');
      if (sel) {
        sel.value = setterId;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 200);
  }

  async function _teamLoad() {
    const period = document.getElementById('team-period')?.value || 'week';
    try {
      const r = await fetch(`/api/setters/team-performance?period=${period}`, { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      _teamData = d;
      const range = document.getElementById('team-range');
      if (range) range.textContent = `${new Date(d.from).toLocaleDateString()} → ${new Date(d.to).toLocaleDateString()}`;
      _teamRenderAlerts(d.alerts || []);
      _teamRenderTable(d);
    } catch (e) {
      alert('Error cargando equipo: ' + e.message);
    }
  }

  document.querySelector('[data-target="view-team"]')?.addEventListener('click', () => {
    setTimeout(() => _teamLoad(), 80);
  });

  // Sprint 32: Dashboard de objeciones
  async function _objLoad() {
    try {
      const range = document.getElementById('obj-range')?.value || 'month';
      const r = await fetch(apiUrl('/api/setters/objection-analytics?range=' + encodeURIComponent(range)));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      _objRender(d);
    } catch (e) {
      window.showToast?.('Error cargando objeciones: ' + e.message, { type: 'error' });
    }
  }
  function _objRender(d) {
    const tagLabelMap = { precio: '💸 Precio', ya_tiene_sistema: '⚙️ Ya tiene sistema', tiempo: '⏳ Tiempo', no_es_decisor: '🪑 No es decisor', no_entiende_valor: '🤷 No entiende valor', desconfia: '🛑 Desconfía', mal_momento: '📆 Mal momento', otra: '➕ Otra' };
    // Summary cards
    const summary = document.getElementById('obj-summary');
    if (summary) {
      summary.innerHTML = `
        <div class="stat-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:10px; padding:14px 16px;">
          <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Total rechazos</div>
          <div style="font-size:24px; font-weight:700; color:var(--text-primary); margin-top:4px;">${d.totalRejected}</div>
        </div>
        <div class="stat-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:10px; padding:14px 16px;">
          <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Con tags</div>
          <div style="font-size:24px; font-weight:700; color:var(--accent); margin-top:4px;">${d.totalWithTags}</div>
        </div>
        <div class="stat-card" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:10px; padding:14px 16px;">
          <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Cobertura</div>
          <div style="font-size:24px; font-weight:700; color:var(--success); margin-top:4px;">${d.coverage}%</div>
          <div style="font-size:10px; color:var(--text-tertiary); margin-top:3px;">% de rechazos con tags</div>
        </div>`;
    }
    const renderList = (containerId, items, labelMap = null) => {
      const el = document.getElementById(containerId);
      if (!el) return;
      if (!items || items.length === 0) {
        el.innerHTML = '<p class="empty-state" style="color:var(--text-tertiary); font-size:12px;">Sin data en este rango.</p>';
        return;
      }
      const max = items[0].count || 1;
      el.innerHTML = items.map(it => {
        const label = labelMap ? (labelMap[it.key] || it.key) : it.key;
        const pct = Math.round((it.count / max) * 100);
        return `<div style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--border-subtle);">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; margin-bottom:3px;">
              <span style="font-size:12.5px; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(label)}</span>
              <strong style="font-size:12.5px; color:var(--accent); font-variant-numeric:tabular-nums;">${it.count}</strong>
            </div>
            <div style="height:4px; background:var(--bg-app); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--accent) 0%, #7C5DDB 100%); border-radius:3px; transition:width 0.4s;"></div>
            </div>
          </div>
        </div>`;
      }).join('');
    };
    renderList('obj-by-tag', d.byTag, tagLabelMap);
    renderList('obj-by-country', d.byCountry);
    renderList('obj-by-setter', d.bySetter);
    // Matriz
    const matrix = document.getElementById('obj-matrix');
    if (matrix) {
      const countries = Object.keys(d.tagByCountry || {}).sort();
      const allTags = Object.keys(tagLabelMap);
      if (countries.length === 0) {
        matrix.innerHTML = '<p class="empty-state" style="color:var(--text-tertiary); font-size:12px;">Sin data.</p>';
      } else {
        matrix.innerHTML = `<table style="width:100%; border-collapse:collapse; font-size:11.5px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <th style="text-align:left; padding:7px 8px; color:var(--text-tertiary); font-weight:600; text-transform:uppercase; letter-spacing:0.4px; font-size:10px;">País</th>
              ${allTags.map(t => `<th style="text-align:center; padding:7px 4px; color:var(--text-tertiary); font-weight:600; font-size:10px;" title="${escHtml(tagLabelMap[t])}">${tagLabelMap[t].split(' ')[0]}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${countries.map(c => `<tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:7px 8px; color:var(--text-primary);">${escHtml(c)}</td>
              ${allTags.map(t => {
                const n = (d.tagByCountry[c] || {})[t] || 0;
                const bg = n > 0 ? `background:rgba(157,133,242,${Math.min(0.06 + n * 0.025, 0.35)});` : '';
                return `<td style="text-align:center; padding:7px 4px; color:${n > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)'}; font-variant-numeric:tabular-nums; ${bg}">${n || '—'}</td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table>`;
      }
    }
  }
  document.querySelector('[data-target="view-objections"]')?.addEventListener('click', () => {
    setTimeout(() => _objLoad(), 80);
  });
  document.getElementById('obj-range')?.addEventListener('change', () => _objLoad());
  document.getElementById('obj-refresh')?.addEventListener('click', () => _objLoad());
  document.getElementById('team-period')?.addEventListener('change', () => _teamLoad());
  document.getElementById('team-refresh')?.addEventListener('click', () => _teamLoad());

  // Sort handlers en headers
  document.querySelectorAll('#team-table th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (_teamSort.key === k) _teamSort.dir = _teamSort.dir === 'asc' ? 'desc' : 'asc';
      else { _teamSort.key = k; _teamSort.dir = 'desc'; }
      if (_teamData) _teamRenderTable(_teamData);
    });
  });

  // Modal config umbrales
  document.getElementById('team-config-btn')?.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/setters/alert-config', { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const cfg = await r.json();
      document.getElementById('team-cfg-drop').value = cfg.dropPctThreshold;
      document.getElementById('team-cfg-inact').value = cfg.inactivityDays;
      document.getElementById('team-cfg-apertura').value = cfg.aperturaPctMin;
      document.getElementById('team-cfg-mintotal').value = cfg.minTotalForAlert;
      const modal = document.getElementById('team-config-modal');
      modal.style.display = 'flex';
    } catch (e) { alert('Error: ' + e.message); }
  });
  document.getElementById('team-cfg-cancel')?.addEventListener('click', () => {
    document.getElementById('team-config-modal').style.display = 'none';
  });
  document.getElementById('team-cfg-save')?.addEventListener('click', async () => {
    const body = {
      dropPctThreshold: Number(document.getElementById('team-cfg-drop').value),
      inactivityDays: Number(document.getElementById('team-cfg-inact').value),
      aperturaPctMin: Number(document.getElementById('team-cfg-apertura').value),
      minTotalForAlert: Number(document.getElementById('team-cfg-mintotal').value),
    };
    try {
      const r = await fetch('/api/setters/alert-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'http ' + r.status);
      document.getElementById('team-config-modal').style.display = 'none';
      _teamLoad();
    } catch (e) { alert('Error: ' + e.message); }
  });

  // ── Historial de scrapes (admin only) ──
  let _shCurrentBatch = null;

  function _shEsc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

  function _shStateChip(b) {
    if (b.sentToSetter) {
      return `<span class="chip" style="padding:2px 8px; font-size:10px; background:rgba(91,185,116,0.12); color:#5bb974; border-radius:999px;">Enviado a ${_shEsc(b.sentToSetter.setterId)}</span>`;
    }
    return `<span class="chip" style="padding:2px 8px; font-size:10px; background:rgba(255,200,40,0.12); color:#ffc828; border-radius:999px;">Pendiente</span>`;
  }

  async function _shLoad() {
    try {
      const r = await fetch('/api/admin/scrape-batches', { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      const total = document.getElementById('sh-total');
      const tbody = document.getElementById('sh-tbody');
      const empty = document.getElementById('sh-empty');
      tbody.innerHTML = '';
      if (total) total.textContent = `${d.total} batch${d.total === 1 ? '' : 'es'} guardados`;
      if (!d.batches.length) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      for (const b of d.batches) {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--border-color);';
        const fecha = new Date(b.createdAt).toLocaleString();
        const queriesShort = (b.queries || []).join(' | ').substring(0, 50) || '—';
        const locsShort = (b.locations || []).filter(Boolean).join(' | ').substring(0, 40) || '—';
        tr.innerHTML = `
          <td style="padding:10px 8px; color:var(--text-secondary); font-size:12px;">${_shEsc(fecha)}</td>
          <td style="padding:10px 8px; color:var(--text-primary);">${_shEsc(queriesShort)}</td>
          <td style="padding:10px 8px; color:var(--text-secondary);">${_shEsc(locsShort)}</td>
          <td style="padding:10px 8px; text-align:right; font-weight:600;">${b.resultsCount}</td>
          <td style="padding:10px 8px; text-align:right; color:#5bb974;">${b.stats?.newCount ?? 0}</td>
          <td style="padding:10px 8px;">${_shStateChip(b)}</td>
          <td style="padding:10px 8px; text-align:right;"><button class="btn-secondary sh-open" data-id="${b.id}" style="font-size:11px;">Ver / Reasignar</button></td>
        `;
        tr.querySelector('.sh-open').addEventListener('click', () => _shOpen(b.id));
        tbody.appendChild(tr);
      }
    } catch (e) {
      alert('Error cargando historial: ' + e.message);
    }
  }

  async function _shOpen(id) {
    try {
      const r = await fetch(`/api/admin/scrape-batches/${encodeURIComponent(id)}`, { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      _shCurrentBatch = d.batch;
      const modal = document.getElementById('sh-detail-modal');
      const title = document.getElementById('sh-modal-title');
      const meta = document.getElementById('sh-modal-meta');
      const already = document.getElementById('sh-modal-already-sent');
      const setterSel = document.getElementById('sh-modal-setter');
      const tbody = document.getElementById('sh-modal-tbody');

      title.textContent = `Batch ${new Date(d.batch.createdAt).toLocaleString()}`;
      meta.textContent = `Query: ${(d.batch.queries || []).join(' | ')} · Ubicación: ${(d.batch.locations || []).join(' | ')} · ${d.batch.results?.length || 0} leads totales`;

      if (d.batch.sentToSetter) {
        const s = d.batch.sentToSetter;
        already.style.display = 'block';
        already.textContent = `Ya enviado a ${s.setterId} el ${new Date(s.sentAt).toLocaleString()} (${s.imported} importados, ${s.skipped} duplicados). Reenviar lo va a deduplicar contra los leads existentes.`;
      } else {
        already.style.display = 'none';
      }

      // Popular selector con setters reales (vía /api/setters)
      if (setterSel.children.length <= 1) {
        try {
          const sr = await fetch('/api/setters', { credentials: 'include' });
          const sd = await sr.json();
          for (const s of (sd.setters || sd || [])) {
            const opt = document.createElement('option');
            opt.value = s.id; opt.textContent = s.name;
            setterSel.appendChild(opt);
          }
        } catch {}
      }

      // Render tabla con leads
      tbody.innerHTML = '';
      const results = Array.isArray(d.batch.results) ? d.batch.results : [];
      for (const lead of results) {
        const tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--border-color);';
        const stateChip = lead.alreadyScraped
          ? `<span class="chip" style="padding:1px 6px; font-size:10px; background:rgba(180,180,180,0.12); color:#aaa; border-radius:999px;">ya scrapeado</span>`
          : `<span class="chip" style="padding:1px 6px; font-size:10px; background:rgba(91,185,116,0.12); color:#5bb974; border-radius:999px;">nuevo</span>`;
        tr.innerHTML = `
          <td style="padding:6px 8px; color:var(--text-primary);">${_shEsc(lead.name || '—')}</td>
          <td style="padding:6px 8px; color:var(--text-secondary);">${_shEsc(lead.phone || '—')}</td>
          <td style="padding:6px 8px; color:var(--text-secondary); max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_shEsc(lead.website || '—')}</td>
          <td style="padding:6px 8px; color:var(--text-secondary);">${_shEsc(lead.city || lead.locationSearched || '—')}</td>
          <td style="padding:6px 8px;">${stateChip}</td>
        `;
        tbody.appendChild(tr);
      }

      modal.style.display = 'flex';
    } catch (e) { alert('Error abriendo batch: ' + e.message); }
  }

  document.querySelector('[data-target="view-scrape-history"]')?.addEventListener('click', () => {
    setTimeout(() => _shLoad(), 80);
  });
  document.getElementById('sh-refresh')?.addEventListener('click', () => _shLoad());
  document.getElementById('sh-modal-close')?.addEventListener('click', () => {
    document.getElementById('sh-detail-modal').style.display = 'none';
  });

  document.getElementById('sh-modal-send')?.addEventListener('click', async () => {
    if (!_shCurrentBatch) return;
    const setterId = document.getElementById('sh-modal-setter').value;
    if (!setterId) { alert('Elegí un setter primero.'); return; }
    const onlyNew = document.getElementById('sh-modal-onlynew').checked;
    if (!confirm(`Enviar ${onlyNew ? 'los nuevos' : 'TODOS'} los leads de este batch al setter seleccionado? Los ya importados se van a saltar por dedup.`)) return;
    const btn = document.getElementById('sh-modal-send');
    btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      const r = await fetch(`/api/admin/scrape-batches/${encodeURIComponent(_shCurrentBatch.id)}/send-to-setter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ setterId, onlyNew }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'http ' + r.status);
      alert(`Enviados: ${d.imported} · Saltados (dedup): ${d.skipped}`);
      document.getElementById('sh-detail-modal').style.display = 'none';
      _shLoad();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Enviar a setter';
    }
  });

  document.getElementById('sh-modal-delete')?.addEventListener('click', async () => {
    if (!_shCurrentBatch) return;
    if (!confirm('Borrar este batch del historial? No se puede deshacer y los leads del batch dejan de ser recuperables.')) return;
    try {
      const r = await fetch(`/api/admin/scrape-batches/${encodeURIComponent(_shCurrentBatch.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error('http ' + r.status);
      document.getElementById('sh-detail-modal').style.display = 'none';
      _shLoad();
    } catch (e) { alert('Error: ' + e.message); }
  });

  // ── Modal reusable: elegir setter (reemplaza prompt() nativo) ──
  // Uso: const setterId = await window.pickSetter({ title?, subtitle?, allowEmpty? });
  // Devuelve el setter.id elegido, '' si "sin asignar" (allowEmpty=true), o null si cancela.
  let _pickSetterCurrent = null;
  let _pickSetterResolve = null;

  async function _pickSetterFetch() {
    try {
      const r = await fetch(apiUrl('/api/setters'));
      const d = await r.json();
      return d.setters || d || [];
    } catch (e) { console.warn('pickSetter fetch err:', e.message); return []; }
  }

  function _pickSetterRender(setters, query, allowEmpty) {
    const list = document.getElementById('setter-picker-list');
    list.innerHTML = '';
    const q = String(query || '').toLowerCase().trim();
    const filtered = setters.filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.id || '').toLowerCase().includes(q));
    if (allowEmpty && !q) {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.setterId = '';
      item.style.cssText = 'display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:10px; border:1px solid var(--border-color); background:var(--bg-app); color:var(--text-secondary); cursor:pointer; text-align:left; font-size:13px; transition:all 0.15s;';
      item.innerHTML = `
        <div style="width:32px; height:32px; flex-shrink:0; border-radius:50%; background:rgba(255,255,255,0.04); border:1px dashed var(--border-color); display:flex; align-items:center; justify-content:center; font-size:14px;">∅</div>
        <div style="flex:1;"><strong>Sin asignar</strong><div style="font-size:11px; opacity:0.7;">Importar sin setter (queda sin dueño)</div></div>
      `;
      item.onmouseover = () => { item.style.borderColor = 'var(--accent)'; item.style.background = 'rgba(157,133,242,0.06)'; };
      item.onmouseout = () => { _pickSetterUpdateActive(); };
      item.onclick = () => _pickSetterSelect(item, '');
      list.appendChild(item);
    }
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:20px; text-align:center; color:var(--text-secondary); font-size:12px;';
      empty.textContent = 'Sin coincidencias.';
      list.appendChild(empty);
      return;
    }
    for (const s of filtered) {
      const initial = String(s.name || '?').trim().charAt(0).toUpperCase();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.setterId = s.id;
      btn.style.cssText = 'display:flex; align-items:center; gap:12px; padding:12px 14px; border-radius:10px; border:1px solid var(--border-color); background:var(--bg-app); color:var(--text-primary); cursor:pointer; text-align:left; font-size:13px; transition:all 0.15s;';
      btn.innerHTML = `
        <div style="width:32px; height:32px; flex-shrink:0; background:linear-gradient(135deg, var(--accent) 0%, #7a5ff0 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:13px;">${initial}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; color:var(--text-primary);">${(s.name || '—').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:1px;">${(s.id || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}</div>
        </div>
      `;
      btn.onmouseover = () => { if (_pickSetterCurrent !== s.id) { btn.style.borderColor = 'var(--accent)'; btn.style.background = 'rgba(157,133,242,0.06)'; } };
      btn.onmouseout = () => { _pickSetterUpdateActive(); };
      btn.onclick = () => _pickSetterSelect(btn, s.id);
      list.appendChild(btn);
    }
    _pickSetterUpdateActive();
  }

  function _pickSetterUpdateActive() {
    const list = document.getElementById('setter-picker-list');
    if (!list) return;
    Array.from(list.children).forEach(btn => {
      if (!btn.dataset || btn.dataset.setterId === undefined) return;
      const isActive = btn.dataset.setterId === _pickSetterCurrent;
      if (isActive) {
        btn.style.borderColor = 'var(--accent)';
        btn.style.background = 'rgba(157,133,242,0.10)';
      } else {
        btn.style.borderColor = 'var(--border-color)';
        btn.style.background = 'var(--bg-app)';
      }
    });
    document.getElementById('setter-picker-confirm').disabled = (_pickSetterCurrent === null);
  }

  function _pickSetterSelect(btn, id) {
    _pickSetterCurrent = id;
    _pickSetterUpdateActive();
  }

  function _pickSetterClose(result) {
    document.getElementById('setter-picker-modal').style.display = 'none';
    if (_pickSetterResolve) { _pickSetterResolve(result); _pickSetterResolve = null; }
    _pickSetterCurrent = null;
  }

  window.pickSetter = async function pickSetter(opts = {}) {
    const { title = 'Elegir setter', subtitle = 'A qué setter querés asignar estos leads?', allowEmpty = false } = opts;
    document.getElementById('setter-picker-title').textContent = title;
    document.getElementById('setter-picker-subtitle').textContent = subtitle;
    const search = document.getElementById('setter-picker-search');
    search.value = '';
    _pickSetterCurrent = null;
    const setters = await _pickSetterFetch();
    _pickSetterRender(setters, '', allowEmpty);
    const modal = document.getElementById('setter-picker-modal');
    modal.style.display = 'flex';
    setTimeout(() => search.focus(), 60);
    search.oninput = () => _pickSetterRender(setters, search.value, allowEmpty);
    return new Promise(resolve => { _pickSetterResolve = resolve; });
  };

  document.getElementById('setter-picker-cancel')?.addEventListener('click', () => _pickSetterClose(null));
  document.getElementById('setter-picker-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'setter-picker-modal') _pickSetterClose(null);
  });
  document.getElementById('setter-picker-confirm')?.addEventListener('click', () => _pickSetterClose(_pickSetterCurrent));

  // ── Modal nuevo: distribuir leads entre MULTIPLES setters ──
  // Uso: const dist = await window.pickSettersDistribution({ totalLeads: 100 });
  // Devuelve [{setterId, count}, ...] cuya suma de counts = totalLeads (o null si cancela).
  let _distSettersCache = [];
  let _distTotalLeads = 0;
  let _distResolve = null;

  function _distRender() {
    const list = document.getElementById('setter-distribute-list');
    if (!list) return;
    list.innerHTML = '';
    for (const s of _distSettersCache) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:10px; border:1px solid var(--border-color); background:var(--bg-app); transition:all 0.15s;';
      const initial = String(s.name || '?').trim().charAt(0).toUpperCase();
      const safeName = String(s.name || '—').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
      row.innerHTML = `
        <input type="checkbox" data-dist-check="${s.id}" style="width:16px; height:16px; cursor:pointer;">
        <div style="width:28px; height:28px; flex-shrink:0; background:linear-gradient(135deg, var(--accent) 0%, #7a5ff0 100%); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:12px;">${initial}</div>
        <div style="flex:1; min-width:0;"><div style="font-weight:600; color:var(--text-primary); font-size:13px;">${safeName}</div></div>
        <input type="number" min="0" step="1" data-dist-count="${s.id}" placeholder="0" style="width:90px; padding:7px 10px; font-size:13px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-elevated); color:var(--text-primary); text-align:right;">
        <span style="font-size:11px; color:var(--text-secondary); width:48px; text-align:right;">leads</span>
      `;
      list.appendChild(row);
    }
    // Wire events
    list.querySelectorAll('[data-dist-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.distCheck;
        const inp = list.querySelector('[data-dist-count="' + id + '"]');
        if (cb.checked && (!inp.value || Number(inp.value) <= 0)) {
          inp.value = 0; // arranca en 0; el user pone el numero o usa "Repartir parejo"
        } else if (!cb.checked) {
          inp.value = '';
        }
        _distRecalc();
      });
    });
    list.querySelectorAll('[data-dist-count]').forEach(inp => {
      inp.addEventListener('input', () => {
        const id = inp.dataset.distCount;
        const cb = list.querySelector('[data-dist-check="' + id + '"]');
        const n = Number(inp.value);
        if (Number.isFinite(n) && n > 0) cb.checked = true;
        else if (!inp.value) cb.checked = false;
        _distRecalc();
      });
    });
    _distRecalc();
  }

  function _distRecalc() {
    const list = document.getElementById('setter-distribute-list');
    if (!list) return;
    let sum = 0;
    list.querySelectorAll('[data-dist-count]').forEach(inp => {
      const n = Number(inp.value);
      if (Number.isFinite(n) && n > 0) sum += Math.floor(n);
    });
    document.getElementById('setter-distribute-assigned').textContent = sum;
    document.getElementById('setter-distribute-total').textContent = _distTotalLeads;
    const remaining = _distTotalLeads - sum;
    const badge = document.getElementById('setter-distribute-remaining-badge');
    if (remaining === 0 && sum > 0) {
      badge.innerHTML = '<span style="color:var(--success); font-weight:600;">✓ Completo</span>';
    } else if (remaining > 0) {
      badge.innerHTML = '<span style="color:var(--warning);">' + remaining + ' sin asignar</span>';
    } else if (remaining < 0) {
      badge.innerHTML = '<span style="color:var(--danger);">' + Math.abs(remaining) + ' de más</span>';
    } else {
      badge.innerHTML = '';
    }
    // Confirm valid: sum > 0 AND sum <= total
    document.getElementById('setter-distribute-confirm').disabled = !(sum > 0 && sum <= _distTotalLeads);
  }

  function _distEvenSplit() {
    const list = document.getElementById('setter-distribute-list');
    if (!list) return;
    const checked = Array.from(list.querySelectorAll('[data-dist-check]:checked'));
    if (checked.length === 0) {
      alert('Tildá al menos un setter para repartir parejo.');
      return;
    }
    const each = Math.floor(_distTotalLeads / checked.length);
    const remainder = _distTotalLeads - (each * checked.length);
    checked.forEach((cb, i) => {
      const id = cb.dataset.distCheck;
      const inp = list.querySelector('[data-dist-count="' + id + '"]');
      inp.value = each + (i < remainder ? 1 : 0); // primeros N reciben +1 para cubrir el resto
    });
    _distRecalc();
  }

  function _distClear() {
    const list = document.getElementById('setter-distribute-list');
    if (!list) return;
    list.querySelectorAll('[data-dist-check]').forEach(cb => cb.checked = false);
    list.querySelectorAll('[data-dist-count]').forEach(inp => inp.value = '');
    _distRecalc();
  }

  function _distClose(result) {
    document.getElementById('setter-distribute-modal').style.display = 'none';
    if (_distResolve) { _distResolve(result); _distResolve = null; }
  }

  window.pickSettersDistribution = async function pickSettersDistribution(opts = {}) {
    const { totalLeads = 0, subtitle } = opts;
    _distTotalLeads = totalLeads;
    document.getElementById('setter-distribute-subtitle').textContent = subtitle || `${totalLeads} leads para repartir entre setters. Tildá los que vas a usar y poné cuántos a cada uno.`;
    _distSettersCache = await _pickSetterFetch();
    _distRender();
    document.getElementById('setter-distribute-modal').style.display = 'flex';
    return new Promise(resolve => { _distResolve = resolve; });
  };

  document.getElementById('setter-distribute-cancel')?.addEventListener('click', () => _distClose(null));
  document.getElementById('setter-distribute-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'setter-distribute-modal') _distClose(null);
  });
  document.getElementById('setter-distribute-even')?.addEventListener('click', _distEvenSplit);
  document.getElementById('setter-distribute-clear')?.addEventListener('click', _distClear);
  document.getElementById('setter-distribute-confirm')?.addEventListener('click', () => {
    const list = document.getElementById('setter-distribute-list');
    const out = [];
    list.querySelectorAll('[data-dist-count]').forEach(inp => {
      const n = Number(inp.value);
      if (Number.isFinite(n) && n > 0) out.push({ setterId: inp.dataset.distCount, count: Math.floor(n) });
    });
    _distClose(out.length ? out : null);
  });

  // ── Modal genérico askText: reemplaza prompt() nativo ──
  // Uso: const text = await window.askText({ title, subtitle, type:'input'|'textarea', placeholder?, defaultValue?, confirmLabel?, confirmRequired?, hint? });
  // Devuelve el texto (string trimmed) si confirmó, null si canceló.
  // Si confirmRequired (default true): no permite confirmar con texto vacío.
  let _askTextResolve = null;
  let _askTextRequired = true;

  function _askTextClose(value) {
    document.getElementById('ask-text-modal').style.display = 'none';
    if (_askTextResolve) { _askTextResolve(value); _askTextResolve = null; }
  }

  window.askText = async function askText(opts = {}) {
    const {
      title = 'Escribí algo',
      subtitle = '',
      type = 'input', // 'input' | 'textarea'
      placeholder = '',
      defaultValue = '',
      confirmLabel = 'Confirmar',
      confirmRequired = true,
      hint = '',
    } = opts;
    document.getElementById('ask-text-title').textContent = title;
    document.getElementById('ask-text-subtitle').textContent = subtitle;
    const input = document.getElementById('ask-text-input');
    const textarea = document.getElementById('ask-text-textarea');
    const hintEl = document.getElementById('ask-text-hint');
    const useTextarea = type === 'textarea';
    input.style.display = useTextarea ? 'none' : 'block';
    textarea.style.display = useTextarea ? 'block' : 'none';
    const target = useTextarea ? textarea : input;
    target.value = defaultValue || '';
    target.placeholder = placeholder || '';
    if (hint) { hintEl.textContent = hint; hintEl.style.display = 'block'; }
    else hintEl.style.display = 'none';
    document.getElementById('ask-text-confirm').textContent = confirmLabel;
    _askTextRequired = !!confirmRequired;
    document.getElementById('ask-text-modal').style.display = 'flex';
    setTimeout(() => target.focus(), 80);
    return new Promise((resolve) => { _askTextResolve = resolve; });
  };

  function _askTextDoConfirm() {
    const useTextarea = document.getElementById('ask-text-textarea').style.display !== 'none';
    const target = document.getElementById(useTextarea ? 'ask-text-textarea' : 'ask-text-input');
    const value = (target.value || '').trim();
    if (_askTextRequired && !value) {
      target.focus();
      target.style.borderColor = '#f85149';
      setTimeout(() => { target.style.borderColor = 'var(--border-color)'; }, 1000);
      return;
    }
    _askTextClose(value);
  }

  document.getElementById('ask-text-cancel')?.addEventListener('click', () => _askTextClose(null));
  document.getElementById('ask-text-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'ask-text-modal') _askTextClose(null);
  });
  document.getElementById('ask-text-confirm')?.addEventListener('click', _askTextDoConfirm);
  // Enter en input → confirmar (no en textarea, ahí es nueva línea).
  document.getElementById('ask-text-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _askTextDoConfirm(); }
  });
  // Cmd/Ctrl+Enter en textarea → confirmar
  document.getElementById('ask-text-textarea')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); _askTextDoConfirm(); }
    if (e.key === 'Escape') { e.preventDefault(); _askTextClose(null); }
  });

  // ── Modal askConfirm (reemplaza confirm() nativo) ──
  let _askConfirmResolve = null;
  function _askConfirmClose(value) {
    document.getElementById('ask-confirm-modal').style.display = 'none';
    if (_askConfirmResolve) { _askConfirmResolve(value); _askConfirmResolve = null; }
  }
  window.askConfirm = function askConfirm(opts = {}) {
    const {
      title = '¿Estás seguro?',
      message = '',
      confirmLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false,
    } = opts;
    document.getElementById('ask-confirm-title').textContent = title;
    document.getElementById('ask-confirm-message').textContent = message;
    const okBtn = document.getElementById('ask-confirm-ok');
    okBtn.textContent = confirmLabel;
    okBtn.style.background = danger ? '#f85149' : '';
    okBtn.style.borderColor = danger ? '#f85149' : '';
    document.getElementById('ask-confirm-cancel').textContent = cancelLabel;
    document.getElementById('ask-confirm-modal').style.display = 'flex';
    setTimeout(() => okBtn.focus(), 80);
    return new Promise((resolve) => { _askConfirmResolve = resolve; });
  };
  document.getElementById('ask-confirm-cancel')?.addEventListener('click', () => _askConfirmClose(false));
  document.getElementById('ask-confirm-ok')?.addEventListener('click', () => _askConfirmClose(true));
  document.getElementById('ask-confirm-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'ask-confirm-modal') _askConfirmClose(false);
  });
  document.addEventListener('keydown', (e) => {
    const m = document.getElementById('ask-confirm-modal');
    if (m && m.style.display === 'flex') {
      if (e.key === 'Escape') { e.preventDefault(); _askConfirmClose(false); }
      if (e.key === 'Enter') { e.preventDefault(); _askConfirmClose(true); }
    }
  });

  // ── Toast notifications (reemplaza alert() para errores y status) ──
  window.showToast = function showToast(message, opts = {}) {
    const { type = 'info', duration = 3500 } = opts;
    const container = document.getElementById('toast-container');
    if (!container) { console.log('[toast]', message); return; }
    const colors = {
      success: { bg: 'rgba(91,185,116,0.12)', border: 'rgba(91,185,116,0.5)', text: '#5bb974', icon: '✓' },
      error:   { bg: 'rgba(248,81,73,0.12)',  border: 'rgba(248,81,73,0.5)',  text: '#f85149', icon: '✗' },
      info:    { bg: 'rgba(157,133,242,0.12)', border: 'rgba(157,133,242,0.5)', text: 'var(--accent)', icon: 'ℹ' },
      warn:    { bg: 'rgba(255,200,40,0.12)', border: 'rgba(255,200,40,0.5)', text: '#ffc828', icon: '⚠' },
    };
    const c = colors[type] || colors.info;
    const el = document.createElement('div');
    el.style.cssText = `pointer-events:auto; padding:12px 16px; background:${c.bg}; border:1px solid ${c.border}; border-radius:12px; color:${c.text}; font-size:13px; line-height:1.5; box-shadow:0 8px 24px rgba(0,0,0,0.4); backdrop-filter:blur(8px); display:flex; gap:10px; align-items:flex-start; transform:translateX(20px); opacity:0; transition:transform 0.25s, opacity 0.25s; max-width:100%; word-break:break-word;`;
    el.innerHTML = `<span style="flex-shrink:0; font-weight:700;">${c.icon}</span><span style="flex:1;"></span>`;
    el.querySelector('span:last-child').textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.transform = 'translateX(20px)';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, duration);
  };

  // ── Modal Reasignar leads bulk (admin) ──
  let _reassignSetters = [];
  let _reassignCountsBySetter = {};
  let _reassignPreviewTimer = null;
  let _reassignPreviewSeq = 0;

  async function _reassignLoadSetters() {
    try {
      const r = await fetch(apiUrl('/api/setters'));
      const d = await r.json();
      _reassignSetters = d.setters || [];
      // Contar leads por setter via /api/setters/command
      try {
        const c = await fetch(apiUrl('/api/setters/command'));
        const cd = await c.json();
        _reassignCountsBySetter = {};
        for (const s of (cd.perSetter || [])) _reassignCountsBySetter[s.id] = s.total || 0;
      } catch {}
      const fromSel = document.getElementById('reassign-from');
      const toSel = document.getElementById('reassign-to');
      [fromSel, toSel].forEach(sel => {
        if (!sel) return;
        sel.innerHTML = '<option value="">— Elegir —</option>' + _reassignSetters
          .map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name || s.id)} (${_reassignCountsBySetter[s.id] || 0} leads)</option>`).join('');
      });
    } catch (e) { console.warn('[reassign] load:', e.message); }
  }

  function _reassignFilterBody(fromId) {
    const country = document.getElementById('reassign-country').value.trim();
    const city = document.getElementById('reassign-city').value.trim();
    const estado = document.getElementById('reassign-estado').value;
    const untouchedOnly = document.getElementById('reassign-untouched')?.checked || false;
    const body = { fromSetterId: fromId };
    if (country) body.country = country;
    if (city) body.city = city;
    if (estado) body.estado = estado;
    if (untouchedOnly) body.untouchedOnly = true;
    return body;
  }

  async function _reassignUpdatePreview() {
    const fromId = document.getElementById('reassign-from').value;
    const toId = document.getElementById('reassign-to').value;
    const mode = document.getElementById('reassign-count-mode').value;
    const customCount = parseInt(document.getElementById('reassign-custom-count').value, 10);
    const fromCount = _reassignCountsBySetter[fromId] || 0;
    const fromInfo = document.getElementById('reassign-from-info');
    const preview = document.getElementById('reassign-preview');
    const previewText = document.getElementById('reassign-preview-text');
    const confirmBtn = document.getElementById('reassign-confirm');
    const customWrap = document.getElementById('reassign-custom-count-wrap');

    customWrap.style.display = mode === 'custom' ? 'flex' : 'none';
    fromInfo.textContent = fromId ? `Tiene ${fromCount} leads asignados.` : '';
    confirmBtn.disabled = true;
    delete confirmBtn.dataset.count;

    if (!fromId || !toId || fromId === toId) {
      preview.style.display = 'none';
      return;
    }

    const seq = ++_reassignPreviewSeq;
    preview.style.display = 'block';
    previewText.textContent = 'Calculando leads que cumplen los filtros...';

    let eligibleCount = fromCount;
    try {
      const r = await fetch(apiUrl('/api/setters/reassign-bulk/preview'), {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(_reassignFilterBody(fromId)),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('http ' + r.status));
      if (seq !== _reassignPreviewSeq) return;
      eligibleCount = d.count || 0;
      fromInfo.textContent = `Tiene ${fromCount} leads asignados · ${eligibleCount} cumplen los filtros.`;
    } catch (e) {
      if (seq !== _reassignPreviewSeq) return;
      previewText.textContent = `No se pudo calcular el preview: ${e.message}`;
      return;
    }

    let toMove = 0;
    if (mode === 'all') toMove = eligibleCount;
    else if (mode === 'half') toMove = Math.floor(eligibleCount / 2);
    else if (mode === 'quarter') toMove = Math.floor(eligibleCount / 4);
    else if (mode === 'custom') toMove = Math.min(customCount || 0, eligibleCount);

    const toName = _reassignSetters.find(s => s.id === toId)?.name || '—';
    const fromName = _reassignSetters.find(s => s.id === fromId)?.name || '—';
    if (toMove > 0) {
      previewText.textContent = `Vas a mover ${toMove} de ${eligibleCount} leads filtrados de ${fromName} a ${toName}.`;
      confirmBtn.disabled = false;
      confirmBtn.dataset.count = toMove;
    } else {
      previewText.textContent = eligibleCount === 0
        ? 'No hay leads que cumplan estos filtros.'
        : 'La cantidad elegida da 0 leads. Ajustá el modo o usá una cantidad específica.';
      confirmBtn.disabled = true;
      delete confirmBtn.dataset.count;
    }
  }

  function _reassignSchedulePreview() {
    clearTimeout(_reassignPreviewTimer);
    const confirmBtn = document.getElementById('reassign-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      delete confirmBtn.dataset.count;
    }
    _reassignPreviewTimer = setTimeout(() => _reassignUpdatePreview(), 180);
  }

  document.getElementById('setter-reassign-btn')?.addEventListener('click', async () => {
    await _reassignLoadSetters();
    document.getElementById('reassign-from').value = '';
    document.getElementById('reassign-to').value = '';
    document.getElementById('reassign-count-mode').value = 'all';
    document.getElementById('reassign-custom-count').value = '';
    document.getElementById('reassign-country').value = '';
    document.getElementById('reassign-city').value = '';
    document.getElementById('reassign-estado').value = '';
    // Default ON: el caso 99% de las veces es mover leads sin trabajar.
    // Si el admin quiere mover trabajados, lo destilda explícitamente.
    document.getElementById('reassign-untouched').checked = true;
    _reassignUpdatePreview();
    document.getElementById('reassign-modal').style.display = 'flex';
  });

  ['reassign-from', 'reassign-to', 'reassign-count-mode', 'reassign-custom-count', 'reassign-country', 'reassign-city', 'reassign-estado', 'reassign-untouched'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _reassignSchedulePreview);
    document.getElementById(id)?.addEventListener('input', _reassignSchedulePreview);
  });

  document.getElementById('reassign-cancel')?.addEventListener('click', () => {
    document.getElementById('reassign-modal').style.display = 'none';
  });
  document.getElementById('reassign-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reassign-modal') document.getElementById('reassign-modal').style.display = 'none';
  });

  document.getElementById('reassign-confirm')?.addEventListener('click', async () => {
    const btn = document.getElementById('reassign-confirm');
    const fromId = document.getElementById('reassign-from').value;
    const toId = document.getElementById('reassign-to').value;
    const count = parseInt(btn.dataset.count, 10);
    if (!fromId || !toId || !count) return;
    if (!confirm(`Confirmar: mover ${count} leads de ${_reassignSetters.find(s=>s.id===fromId)?.name} a ${_reassignSetters.find(s=>s.id===toId)?.name}? Esta acción no se puede deshacer fácil.`)) return;
    btn.disabled = true; btn.textContent = 'Moviendo…';
    try {
      const body = { ..._reassignFilterBody(fromId), toSetterId: toId, count };
      const r = await fetch(apiUrl('/api/setters/reassign-bulk'), {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('http ' + r.status));
      alert(`✓ Movidos ${d.moved} leads.\n${d.fromSetter.name} ahora tiene ${d.fromSetter.remaining} leads.\n${d.toSetter.name} ahora tiene ${d.toSetter.total} leads.`);
      document.getElementById('reassign-modal').style.display = 'none';
      // Refrescar contadores
      await _reassignLoadSetters();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '↔ Mover leads';
    }
  });

  // ── Modal Agendar reunión (Google Calendar embed) ──
  let _agendarLead = null;
  let _agendarGcalUrl = '';
  let _agendarGcalLoaded = false;

  async function _agendarLoadGcalConfig() {
    if (_agendarGcalLoaded) return _agendarGcalUrl;
    try {
      const r = await fetch('/api/gcal/config', { credentials: 'include' });
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();
      _agendarGcalUrl = d.enabled !== false ? (d.embedUrl || '') : '';
    } catch (e) {
      console.warn('[agendar] No pude cargar config gcal:', e.message);
      _agendarGcalUrl = '';
    }
    _agendarGcalLoaded = true;
    return _agendarGcalUrl;
  }

  window.openAgendarModal = async function openAgendarModal(lead) {
    if (!lead) return;
    _agendarLead = lead;
    document.getElementById('agendar-lead-name').textContent = lead.name || '—';
    // Default: en 1 hora (formato datetime-local)
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const defaultIso = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    document.getElementById('agendar-fecha').value = defaultIso;
    document.getElementById('agendar-notas').value = '';
    document.getElementById('agendar-confirm').disabled = false;

    const url = await _agendarLoadGcalConfig();
    const iframe = document.getElementById('agendar-iframe');
    const wrap = document.getElementById('agendar-iframe-wrap');
    const noConfig = document.getElementById('agendar-no-config');
    if (url) {
      iframe.src = url;
      wrap.style.display = 'block';
      noConfig.style.display = 'none';
    } else {
      iframe.src = 'about:blank';
      wrap.style.display = 'none';
      noConfig.style.display = 'block';
    }
    document.getElementById('agendar-modal').style.display = 'flex';
  };

  function _agendarClose() {
    document.getElementById('agendar-modal').style.display = 'none';
    document.getElementById('agendar-iframe').src = 'about:blank';
    _agendarLead = null;
  }

  document.getElementById('agendar-close')?.addEventListener('click', _agendarClose);
  document.getElementById('agendar-cancel')?.addEventListener('click', _agendarClose);
  document.getElementById('agendar-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'agendar-modal') _agendarClose();
  });

  document.getElementById('agendar-confirm')?.addEventListener('click', async () => {
    if (!_agendarLead) return;
    const fecha = document.getElementById('agendar-fecha').value;
    const notas = document.getElementById('agendar-notas').value.trim();
    if (!fecha) { alert('Pegá la fecha y hora del agendamiento.'); return; }
    const btn = document.getElementById('agendar-confirm');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      // 1. Crear entry en calendar (alimenta vista "Llamadas agendadas")
      const calRes = await fetch(apiUrl('/api/setters/calendar'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: _agendarLead.id,
          fecha,
          nombre: _agendarLead.name || '',
          calendarioEstado: 'pendiente',
          setterId: _agendarLead.assignedTo || '',
        }),
      });
      if (!calRes.ok) { const err = await calRes.text(); throw new Error('calendar: ' + err); }
      const calData = await calRes.json();
      // 2. Si vinieron notas, agregarlas a la entry via PATCH
      if (notas && calData.entry?.id) {
        await fetch(apiUrl('/api/setters/calendar/' + calData.entry.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ notas }),
        });
      }
      // 3. Marcar lead como agendado
      await fetch(apiUrl('/api/setters/leads/' + encodeURIComponent(_agendarLead.id)), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ estado: 'agendado' }),
      });
      btn.textContent = '✓ Agendado';
      setTimeout(() => {
        const reopenId = _agendarLead?.id;
        _agendarClose();
        // Si el modal del lead seguía abierto para este lead, refrescar
        if (reopenId && window.__currentLead?.id === reopenId && window._openLeadModal) {
          window._openLeadModal(reopenId);
        }
      }, 600);
    } catch (e) {
      alert('Error agendando: ' + e.message);
      btn.disabled = false; btn.textContent = '✓ Marcar como agendado';
    }
  });

  // Botón "Agendar" en el modal del lead → abre el modal de agendar
  document.getElementById('modal-agendar-btn')?.addEventListener('click', () => {
    const lead = window.__currentLead;
    if (!lead) {
      alert('Abrí primero la ficha del lead.');
      return;
    }
    window.openAgendarModal(lead);
  });

  // ── Follow-ups: badge sidebar + título de pestaña + banner al login ──
  let _fuBaseTitle = document.title || 'SCM';
  let _fuLastBadgeCount = 0;

  function _setTabTitle(count) {
    if (count > 0) document.title = `(${count}) ${_fuBaseTitle}`;
    else document.title = _fuBaseTitle;
  }

  // Hook que llama loadFollowups() del closure CRM. Setea badge del sidebar +
  // título de pestaña. Si es la primera vez con > 0, dispara el banner al login
  // (una sola vez por sesión).
  window._setSidebarFollowupsBadge = (count) => {
    _fuLastBadgeCount = count;
    const badge = document.getElementById('sidebar-followups-badge');
    if (badge) {
      if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
      else badge.style.display = 'none';
    }
    _setTabTitle(count);
    // Mostrar banner solo una vez por sesión y si no fue dismisseado
    const dismissed = sessionStorage.getItem('fu_banner_dismissed') === '1';
    const shown = sessionStorage.getItem('fu_banner_shown') === '1';
    if (count > 0 && !shown && !dismissed) _showFollowupsBanner();
  };

  function _showFollowupsBanner() {
    const banner = document.getElementById('followups-welcome-banner');
    if (!banner || !_followupsCacheGlobal) return;
    const today = (_followupsCacheGlobal.counts?.dueToday || 0) + (_followupsCacheGlobal.counts?.dueYesterday || 0);
    const overdue = _followupsCacheGlobal.counts?.overdue || 0;
    if (today === 0) return;
    document.getElementById('fb-count').textContent = today;
    const overdueLine = document.getElementById('fb-overdue-line');
    if (overdue > 0) {
      document.getElementById('fb-overdue-count').textContent = overdue;
      overdueLine.style.display = 'block';
    } else {
      overdueLine.style.display = 'none';
    }
    banner.style.display = 'flex';
    sessionStorage.setItem('fu_banner_shown', '1');
  }

  // Cache global para que el banner pueda leer counts.dueToday/dueYesterday/overdue
  let _followupsCacheGlobal = null;
  window._setFollowupsCacheGlobal = (cache) => { _followupsCacheGlobal = cache; };

  document.getElementById('fb-cta-btn')?.addEventListener('click', () => {
    document.getElementById('followups-welcome-banner').style.display = 'none';
    sessionStorage.setItem('fu_banner_dismissed', '1');
    // Llevar al filtro Hacer hoy del CRM
    document.querySelector('[data-target="view-crm"]')?.click();
    setTimeout(() => {
      document.querySelector('.pipe-filter[data-status="hacer_hoy"]')?.click();
    }, 200);
  });
  document.getElementById('fb-dismiss-btn')?.addEventListener('click', () => {
    document.getElementById('followups-welcome-banner').style.display = 'none';
    sessionStorage.setItem('fu_banner_dismissed', '1');
  });

  // Helper para construir el URL con ?setter= si admin impersona setter.
  function _fuUrlWithViewAs(path) {
    const u = window.__CURRENT_USER__;
    const isViewAsSetter = u?.realRole === 'admin' && u?.role === 'setter' && u?.setterId;
    return path + (isViewAsSetter ? (path.includes('?') ? '&' : '?') + 'setter=' + encodeURIComponent(u.setterId) : '');
  }

  // Polling liviano: refrescar el badge cada 5 min mientras la app está abierta.
  // Solo si el usuario tiene rol setter o admin (no para roles sin acceso al CRM).
  setInterval(() => {
    const role = window.__CURRENT_USER__?.role;
    if (!role || (role !== 'setter' && role !== 'admin' && role !== 'supervisor')) return;
    fetch(_fuUrlWithViewAs('/api/setters/followups/badge'), { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) window._setSidebarFollowupsBadge(d.count); })
      .catch(() => {});
  }, 5 * 60 * 1000);

  // Cargar el badge al inicio (apenas el user esté logueado), aunque no haya
  // entrado todavía a la vista CRM. Eso permite ver el badge desde otras vistas.
  setTimeout(() => {
    if (window.__CURRENT_USER__) {
      fetch(_fuUrlWithViewAs('/api/setters/followups/badge'), { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) window._setSidebarFollowupsBadge(d.count); })
        .catch(() => {});
      // Cargar también el cache completo para el banner
      fetch(_fuUrlWithViewAs('/api/setters/followups/today'), { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { window._setFollowupsCacheGlobal(d); _showFollowupsBanner(); } })
        .catch(() => {});
    }
  }, 1500);

  // ── Command palette (Ctrl+K / Cmd+K) ─────────────────────────────────
  // Quick switcher: busca leads, setters, comandos. Modal flotante con
  // teclado-first nav (↑↓ flechas, Enter para abrir, Esc para cerrar).
  // Index se construye on-demand desde caches en memoria.
  let _cmdkSelectedIdx = 0;
  let _cmdkResults = [];

  function _cmdkBuildIndex() {
    const items = [];
    // Acciones rápidas / navegación
    const role = window.__CURRENT_USER__?.role;
    const isAdmin = role === 'admin';
    const isSupervisor = role === 'supervisor';
    const views = [
      { id: 'v-crm', target: 'view-crm', label: 'Ir a Setteo (WhatsApp)', icon: '💬', roles: ['admin','setter','supervisor'] },
      // Audit Sprint 37: alinear con sidebar — `view-calls` es admin+supervisor only
      // desde 2026-05-22 (setters siguen con WA). Antes era setter-accesible vía
      // cmdk, ahora se oculta para coincidir con sidebar.
      { id: 'v-calls', target: 'view-calls', label: 'Ir a Llamadas', icon: '📞', roles: ['admin','supervisor'] },
      { id: 'v-myperf', target: 'view-myperf', label: 'Ir a Mi rendimiento', icon: '📊', roles: ['admin','setter','supervisor'] },
      { id: 'v-assistant', target: 'view-assistant', label: 'Ir a Asistente IA', icon: '🤖', roles: ['admin','setter'] },
      { id: 'v-faqs', target: 'view-faqs', label: 'Ir a Banco de Respuestas', icon: '📚', roles: ['admin','setter','supervisor'] },
      { id: 'v-training', target: 'view-training', label: 'Ir a Centro de Entrenamiento', icon: '🎓', roles: ['admin','setter','supervisor'] },
      { id: 'v-team', target: 'view-team', label: 'Ir a Equipo', icon: '👥', roles: ['admin','supervisor'] },
      { id: 'v-command', target: 'view-command', label: 'Ir a Centro de Comando', icon: '🎛️', roles: ['admin'] },
      { id: 'v-mercury-review', target: 'view-mercury-review', label: 'Ir a Revisión IA', icon: '⭐', roles: ['admin'] },
      { id: 'v-mercury-config', target: 'view-mercury-config', label: 'Ir a Configuración Mercury', icon: '⚙️', roles: ['admin'] },
      { id: 'v-online', target: 'view-online', label: 'Ir a Quién está conectado', icon: '🟢', roles: ['admin','supervisor'] },
      { id: 'v-maps', target: 'view-maps', label: 'Ir a Google Maps scraper', icon: '🗺️', roles: ['admin'] },
      { id: 'v-social', target: 'view-social', label: 'Ir a Redes (Instagram)', icon: '📷', roles: ['admin'] },
    ];
    for (const v of views) {
      if (!v.roles.includes(role)) continue;
      items.push({ type: 'view', label: v.label, sublabel: 'Vista', icon: v.icon, action: () => document.querySelector('[data-target="' + v.target + '"]')?.click() });
    }
    // Leads del setter actual (vía window — el closure interno los expone)
    for (const l of (window.__setterLeads || []).slice(0, 500)) {
      items.push({
        type: 'lead',
        label: l.name || '(sin nombre)',
        sublabel: (l.phone || '—') + ' · ' + (l.estado || 'sin estado'),
        icon: '👤',
        action: () => {
          // Asegurar que estamos en CRM
          const crmMenu = document.querySelector('[data-target="view-crm"]');
          if (crmMenu && !document.getElementById('view-crm')?.classList.contains('hidden')) {
            window._openLeadModal?.(l.id);
          } else {
            crmMenu?.click();
            setTimeout(() => window._openLeadModal?.(l.id), 250);
          }
        },
      });
    }
    // Setters (admin/supervisor)
    if (isAdmin || isSupervisor) {
      for (const s of (window.__settersList || [])) {
        items.push({
          type: 'setter',
          label: s.name,
          sublabel: 'Setter',
          icon: '🧑‍💼',
          action: () => {
            const sel = document.getElementById('setter-select');
            if (sel) { sel.value = s.id; sel.dispatchEvent(new Event('change')); }
            document.querySelector('[data-target="view-crm"]')?.click();
          },
        });
      }
    }
    return items;
  }

  function _cmdkScore(query, item) {
    if (!query) return 1; // sin query: orden natural
    const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const text = (item.label + ' ' + (item.sublabel || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (text.includes(q)) {
      // Exacto al principio del label: máxima prioridad
      if (item.label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').startsWith(q)) return 10;
      return 5;
    }
    // Fuzzy: todos los chars de q en orden
    let pos = 0;
    for (const c of q) {
      const found = text.indexOf(c, pos);
      if (found < 0) return 0;
      pos = found + 1;
    }
    return 1;
  }

  function _cmdkRender() {
    const ul = document.getElementById('cmdk-results');
    if (!ul) return;
    ul.innerHTML = '';
    if (_cmdkResults.length === 0) {
      ul.innerHTML = '<li style="padding:18px; text-align:center; color:var(--text-secondary); font-size:13px;">Sin resultados.</li>';
      return;
    }
    _cmdkResults.forEach((item, idx) => {
      const li = document.createElement('li');
      const selected = idx === _cmdkSelectedIdx;
      li.style.cssText = 'padding:9px 14px; cursor:pointer; display:flex; gap:10px; align-items:center; border-radius:8px; margin:1px 0; transition:background 0.1s; background:' + (selected ? 'rgba(157,133,242,0.18)' : 'transparent') + ';';
      li.innerHTML = '<span style="font-size:16px; flex-shrink:0;">' + item.icon + '</span>' +
        '<div style="flex:1; min-width:0; overflow:hidden;">' +
          '<div style="font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>' +
          '<div style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>' +
        '</div>' +
        (selected ? '<span style="font-size:10px; color:var(--accent); flex-shrink:0;">↵</span>' : '');
      li.children[1].children[0].textContent = item.label;
      li.children[1].children[1].textContent = item.sublabel || '';
      li.addEventListener('click', () => { _cmdkExecute(idx); });
      li.addEventListener('mouseenter', () => { _cmdkSelectedIdx = idx; _cmdkRender(); });
      ul.appendChild(li);
    });
    // Scroll selected into view
    const sel = ul.children[_cmdkSelectedIdx];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function _cmdkExecute(idx) {
    const item = _cmdkResults[idx];
    if (!item) return;
    _cmdkClose();
    try { item.action(); } catch (e) { console.error('[cmdk]', e); }
  }

  function _cmdkSearch(query) {
    const items = _cmdkBuildIndex();
    const scored = items
      .map(it => ({ it, score: _cmdkScore(query, it) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map(x => x.it);
    _cmdkResults = scored;
    _cmdkSelectedIdx = 0;
    _cmdkRender();
  }

  function _cmdkOpen() {
    const m = document.getElementById('cmdk-modal');
    if (!m) return;
    m.style.display = 'flex';
    const inp = document.getElementById('cmdk-input');
    if (inp) {
      inp.value = '';
      setTimeout(() => inp.focus(), 30);
    }
    _cmdkSearch('');
  }
  function _cmdkClose() {
    const m = document.getElementById('cmdk-modal');
    if (m) m.style.display = 'none';
  }
  window._cmdkOpen = _cmdkOpen;

  // Wire keyboard
  document.addEventListener('keydown', (e) => {
    // Ctrl+K / Cmd+K → abrir
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      _cmdkOpen();
      return;
    }
    // Solo si el modal está abierto
    const m = document.getElementById('cmdk-modal');
    if (!m || m.style.display === 'none') return;
    if (e.key === 'Escape') { e.preventDefault(); _cmdkClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); _cmdkSelectedIdx = Math.min(_cmdkSelectedIdx + 1, _cmdkResults.length - 1); _cmdkRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _cmdkSelectedIdx = Math.max(_cmdkSelectedIdx - 1, 0); _cmdkRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); _cmdkExecute(_cmdkSelectedIdx); }
  });
  document.getElementById('cmdk-input')?.addEventListener('input', (e) => _cmdkSearch(e.target.value));
  document.getElementById('cmdk-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'cmdk-modal') _cmdkClose();
  });

  // ── Notificaciones nativas del browser ───────────────────────────────
  // Pide permiso si nunca se decidió. Hace polling de eventos relevantes
  // (follow-ups que pasan a overdue, badge que sube) y dispara una
  // Notification para que el setter se entere aunque tenga otra pestaña.
  const NOTIF_DISMISSED_KEY = 'notif_perm_dismissed_until';
  function _showNotifBannerIfNeeded() {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return; // ya decidió
    const dismissedUntil = parseInt(localStorage.getItem(NOTIF_DISMISSED_KEY) || '0', 10);
    if (dismissedUntil > Date.now()) return; // dismissed reciente
    // Mostrar banner después de 5s para no molestar al instante
    setTimeout(() => {
      if (Notification.permission === 'default') {
        const b = document.getElementById('notif-perm-banner');
        if (b) b.style.display = 'block';
      }
    }, 5000);
  }
  document.getElementById('notif-perm-yes')?.addEventListener('click', async () => {
    document.getElementById('notif-perm-banner').style.display = 'none';
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        window.showToast?.('Notificaciones activadas ✓', { type: 'success' });
        // Notification de bienvenida
        try { new Notification('SCM', { body: 'Te vamos a avisar cuando algo importante pase.', icon: '/favicon.svg' }); } catch {}
      } else {
        window.showToast?.('Permiso denegado. Podés activar más tarde desde la config del browser.', { type: 'warn' });
      }
    } catch (e) { console.warn('[notif]', e); }
  });
  document.getElementById('notif-perm-no')?.addEventListener('click', () => {
    document.getElementById('notif-perm-banner').style.display = 'none';
    // Dismiss por 7 días
    localStorage.setItem(NOTIF_DISMISSED_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
  });

  // Polling de eventos para notificaciones (cada 60s)
  let _lastSeenOverdue = -1;
  let _lastSeenDueToday = -1;
  function _notifyIfNew(currentOverdue, currentDueToday) {
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState !== 'hidden') return; // solo si la pestaña no está activa
    if (_lastSeenOverdue < 0) { _lastSeenOverdue = currentOverdue; _lastSeenDueToday = currentDueToday; return; }
    // Nuevos overdue desde la última vez
    if (currentOverdue > _lastSeenOverdue) {
      const diff = currentOverdue - _lastSeenOverdue;
      try {
        const n = new Notification('Follow-ups atrasados', {
          body: 'Tenés ' + diff + ' follow-up' + (diff > 1 ? 's' : '') + ' nuevo' + (diff > 1 ? 's' : '') + ' atrasado' + (diff > 1 ? 's' : '') + '. Total: ' + currentOverdue + '.',
          icon: '/favicon.svg',
          tag: 'overdue',
          requireInteraction: false,
        });
        n.onclick = () => { window.focus(); document.querySelector('[data-target="view-crm"]')?.click(); setTimeout(() => document.querySelector('.pipe-filter[data-status="atrasados"]')?.click(), 200); n.close(); };
      } catch {}
    } else if (currentDueToday > _lastSeenDueToday) {
      const diff = currentDueToday - _lastSeenDueToday;
      try {
        const n = new Notification('Follow-ups para hoy', {
          body: 'Tenés ' + diff + ' follow-up' + (diff > 1 ? 's' : '') + ' nuevo' + (diff > 1 ? 's' : '') + ' que hacer hoy.',
          icon: '/favicon.svg',
          tag: 'duetoday',
        });
        n.onclick = () => { window.focus(); document.querySelector('[data-target="view-crm"]')?.click(); setTimeout(() => document.querySelector('.pipe-filter[data-status="hacer_hoy"]')?.click(), 200); n.close(); };
      } catch {}
    }
    _lastSeenOverdue = currentOverdue;
    _lastSeenDueToday = currentDueToday;
  }
  setInterval(() => {
    const role = window.__CURRENT_USER__?.role;
    if (!role || (role !== 'setter' && role !== 'admin' && role !== 'supervisor')) return;
    if (Notification.permission !== 'granted') return;
    fetch(_fuUrlWithViewAs('/api/setters/followups/today'), { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.counts) _notifyIfNew(d.counts.overdue || 0, d.counts.dueToday || 0); })
      .catch(() => {});
  }, 60 * 1000);

  // Mostrar banner de permiso después del primer load del user
  setTimeout(() => { if (window.__CURRENT_USER__) _showNotifBannerIfNeeded(); }, 2000);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 6: Centralita Telnyx — vista admin (config + numbers + routing + metrics)
  // ═══════════════════════════════════════════════════════════════════════
  let _tlxAdminCache = { numbers: [], countryRouting: {}, hasApiKey: false, hasSipCredentials: false, hasSignatureKey: false, sipConnectionId: '', envSourced: {}, lowBalanceThreshold: 10 };
  let _tlxMetricsRefreshTimer = null;

  async function _tlxLoadConfig() {
    try {
      const r = await fetch(apiUrl('/api/telnyx/config'), { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      _tlxAdminCache = {
        hasApiKey: !!d.hasApiKey,
        hasSipCredentials: !!d.hasSipCredentials,
        hasSignatureKey: !!d.hasSignatureKey,
        sipConnectionId: d.sipConnectionId || '',
        envSourced: d.envSourced || {},
        numbers: d.numbers || [],
        countryRouting: d.countryRouting || { default: '' },
        lowBalanceThreshold: Number.isFinite(Number(d.lowBalanceThreshold)) ? Number(d.lowBalanceThreshold) : 10,
      };
      const thrInput = document.getElementById('tlx-balance-threshold');
      if (thrInput && document.activeElement !== thrInput) thrInput.value = _tlxAdminCache.lowBalanceThreshold;
      _tlxRenderAll();
    } catch (e) { console.warn('[tlx-admin] load:', e.message); }
  }

  function _tlxRenderAll() {
    // Status pill
    const statusEl = document.getElementById('tlx-cfg-status');
    if (statusEl) {
      if (_tlxAdminCache.hasApiKey && (_tlxAdminCache.hasSipCredentials || _tlxAdminCache.sipConnectionId)) {
        statusEl.textContent = '✓ Configurado';
        statusEl.style.background = 'rgba(91,185,116,0.15)'; statusEl.style.color = '#5bb974';
      } else if (_tlxAdminCache.hasApiKey) {
        statusEl.textContent = '⚠ Falta SIP';
        statusEl.style.background = 'rgba(255,200,40,0.15)'; statusEl.style.color = '#ffc828';
      } else {
        statusEl.textContent = '○ Sin configurar';
        statusEl.style.background = 'rgba(255,255,255,0.06)'; statusEl.style.color = 'var(--text-secondary)';
      }
    }
    // Banner global: si HAY env vars activas, mostrar info al admin
    const banner = document.getElementById('tlx-cfg-env-banner');
    if (banner) {
      const env = _tlxAdminCache.envSourced || {};
      const activeEnvs = Object.entries(env).filter(([, v]) => v).map(([k]) => k);
      if (activeEnvs.length) {
        banner.style.display = 'block';
        banner.innerHTML = `🔒 <strong>Secrets via env vars en Railway:</strong> ${activeEnvs.length} campo(s) gestionado(s) fuera del panel. Para cambiarlos, editá las env vars en Railway y redeployá.`;
      } else {
        banner.style.display = 'none';
      }
    }
    // Helper: aplicar lock visual + placeholder a un input cuando viene de env var
    const applyEnvLock = (id, isEnv, fallbackPlaceholder, configuredFlag) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isEnv) {
        el.disabled = true;
        el.value = '';
        el.placeholder = '🔒 Gestionado por env var';
        el.style.opacity = '0.55';
        el.style.cursor = 'not-allowed';
      } else {
        el.disabled = false;
        el.style.opacity = '';
        el.style.cursor = '';
        el.placeholder = configuredFlag ? '✓ Configurada (dejar vacío para no cambiar)' : fallbackPlaceholder;
      }
    };
    const env = _tlxAdminCache.envSourced || {};
    applyEnvLock('tlx-cfg-apikey', env.apiKey, 'KEY_...', _tlxAdminCache.hasApiKey);
    applyEnvLock('tlx-cfg-sipuser', env.sipUsername, 'username del SIP Connection', _tlxAdminCache.hasSipCredentials);
    applyEnvLock('tlx-cfg-sippass', env.sipPassword, '•••••', _tlxAdminCache.hasSipCredentials);
    applyEnvLock('tlx-cfg-sigkey', env.signaturePublicKey, 'MCowBQYDK2VwAyEA...', _tlxAdminCache.hasSignatureKey);
    // Connection ID es semi-secreto: si viene de env, mostrar locked. Si no, valor editable.
    const connIdInput = document.getElementById('tlx-cfg-connid');
    if (connIdInput) {
      if (env.sipConnectionId) {
        connIdInput.disabled = true;
        connIdInput.value = '🔒 Gestionado por env var';
        connIdInput.style.opacity = '0.55';
        connIdInput.style.cursor = 'not-allowed';
      } else {
        connIdInput.disabled = false;
        connIdInput.style.opacity = '';
        connIdInput.style.cursor = '';
        connIdInput.value = _tlxAdminCache.sipConnectionId || '';
      }
    }
    _tlxRenderNumbers();
    _tlxRenderRouting();
  }

  function _tlxRenderNumbers() {
    const list = document.getElementById('tlx-numbers-list');
    const empty = document.getElementById('tlx-numbers-empty');
    if (!list || !empty) return;
    const nums = _tlxAdminCache.numbers || [];
    if (nums.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = nums.map(n => {
      const active = n.active !== false;
      const country = n.country || '?';
      return `<li style="display:flex; align-items:center; gap:12px; padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px; ${active ? '' : 'opacity:0.5;'}">
        <span style="font-size:18px;">${country === 'ES' ? '🇪🇸' : country === 'MX' ? '🇲🇽' : country === 'CO' ? '🇨🇴' : country === 'AR' ? '🇦🇷' : country === 'CL' ? '🇨🇱' : country === 'PE' ? '🇵🇪' : country === 'US' ? '🇺🇸' : country === 'EC' ? '🇪🇨' : country === 'UY' ? '🇺🇾' : country === 'BO' ? '🇧🇴' : '🌐'}</span>
        <div style="flex:1; min-width:0;">
          <div style="font-size:13px; font-weight:500; color:var(--text-primary); font-family:ui-monospace,monospace;">${escHtml(n.phone)}</div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${escHtml(n.label || '(sin label)')} · ${escHtml(country)}</div>
        </div>
        <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--text-secondary); cursor:pointer;">
          <input type="checkbox" ${active ? 'checked' : ''} onchange="window._tlxToggleNumber('${escHtml(n.id)}', this.checked)" style="cursor:pointer;">
          Activo
        </label>
        <button onclick="window._tlxDeleteNumber('${escHtml(n.id)}', '${escHtml(n.phone)}')" class="btn-table-action" style="color:#f85149; font-size:11px;">Eliminar</button>
      </li>`;
    }).join('');
  }

  function _tlxRenderRouting() {
    const grid = document.getElementById('tlx-routing-grid');
    if (!grid) return;
    const nums = (_tlxAdminCache.numbers || []).filter(n => n.active !== false);
    if (nums.length === 0) {
      grid.innerHTML = '<div class="muted" style="font-size:12px; text-align:center; padding:18px;">Agregá al menos un número antes de configurar routing.</div>';
      return;
    }
    // Países comunes + el de "default"
    const commonCountries = ['default', 'ES', 'MX', 'CO', 'AR', 'CL', 'PE', 'EC', 'UY', 'BO', 'US'];
    // Sumar países que ya están en el routing pero no en common
    const allCountries = [...new Set([...commonCountries, ...Object.keys(_tlxAdminCache.countryRouting || {})])];
    const flagOf = (c) => ({ ES:'🇪🇸', MX:'🇲🇽', CO:'🇨🇴', AR:'🇦🇷', CL:'🇨🇱', PE:'🇵🇪', EC:'🇪🇨', UY:'🇺🇾', BO:'🇧🇴', US:'🇺🇸', default:'🌐' })[c] || '🌐';
    const labelOf = (c) => ({ ES:'España', MX:'México', CO:'Colombia', AR:'Argentina', CL:'Chile', PE:'Perú', EC:'Ecuador', UY:'Uruguay', BO:'Bolivia', US:'EEUU', default:'Default (fallback)' })[c] || c;
    grid.innerHTML = allCountries.map(c => {
      const selected = _tlxAdminCache.countryRouting[c] || '';
      return `<label style="display:grid; grid-template-columns:140px 1fr; gap:10px; align-items:center;">
        <span style="font-size:12px; color:var(--text-secondary);">${flagOf(c)} ${labelOf(c)}</span>
        <select data-country="${escHtml(c)}" class="tlx-routing-select" style="padding:8px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-app); color:var(--text-primary); font-size:12px;">
          <option value="">— Sin número —</option>
          ${nums.map(n => `<option value="${escHtml(n.id)}" ${n.id === selected ? 'selected' : ''}>${escHtml(n.phone)} (${escHtml(n.label || n.country || '')})</option>`).join('')}
        </select>
      </label>`;
    }).join('');
    document.getElementById('tlx-routing-countries-list').textContent = allCountries.filter(c => c !== 'default').join(', ');
  }

  async function _tlxLoadBalance(opts = {}) {
    const cards = document.getElementById('tlx-balance-cards');
    const alertEl = document.getElementById('tlx-balance-alert');
    try {
      const r = await fetch(apiUrl('/api/telnyx/balance' + (opts.fresh ? '?fresh=1' : '')), { credentials: 'include' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (cards) cards.innerHTML = `<div class="muted" style="font-size:12px; padding:8px; color:#f85149;">${escHtml(err.error || ('No pude traer el saldo (HTTP ' + r.status + ')'))}</div>`;
        if (alertEl) alertEl.style.display = 'none';
        return;
      }
      const d = await r.json();
      const cur = d.currency || 'USD';
      const fmt = (n) => `${cur === 'USD' ? '$' : ''}${Number(n).toFixed(2)}${cur !== 'USD' ? ' ' + cur : ''}`;
      const card = (label, value, sub, color) => `
        <div style="padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;">
          <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${label}</div>
          <div style="font-size:22px; font-weight:700; color:${color}; line-height:1;">${value}</div>
          <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">${sub}</div>
        </div>`;
      const fetched = d.fetchedAt ? new Date(d.fetchedAt).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
      if (cards) {
        cards.innerHTML =
          card('Crédito disponible', fmt(d.availableCredit), d.cached ? 'cacheado · ' + fetched : 'al ' + fetched, d.low ? '#f85149' : '#5bb974') +
          card('Saldo', fmt(d.balance), 'balance', 'var(--text-primary)') +
          card('Límite de crédito', fmt(d.creditLimit), 'credit limit', 'var(--text-secondary)');
      }
      if (alertEl) {
        if (d.low) {
          alertEl.style.display = 'block';
          alertEl.innerHTML = `⚠️ <strong>Saldo bajo:</strong> te quedan ${fmt(d.availableCredit)} (umbral: ${fmt(d.lowBalanceThreshold)}). Recargá en Telnyx para no quedarte sin llamadas.`;
        } else {
          alertEl.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('[tlx-balance]', e.message);
      if (cards) cards.innerHTML = `<div class="muted" style="font-size:12px; padding:8px; color:#f85149;">Error de red al pedir saldo.</div>`;
    }
  }

  async function _tlxLoadRealCosts(opts = {}) {
    const range = document.getElementById('tlx-realcost-range')?.value || 'last_7_days';
    const cards = document.getElementById('tlx-realcost-cards');
    try {
      const r = await fetch(apiUrl('/api/telnyx/real-costs?range=' + range + (opts.fresh ? '&fresh=1' : '')), { credentials: 'include' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        if (cards) cards.innerHTML = `<div class="muted" style="font-size:12px; padding:8px; color:#f85149;">${escHtml(err.error || ('No pude traer el costo real (HTTP ' + r.status + ')'))}</div>`;
        return;
      }
      const d = await r.json();
      const t = d.totals || {};
      const cur = d.currency || 'USD';
      const money = (n) => `$${Number(n).toFixed(n < 1 ? 4 : 2)}`;
      const card = (label, value, sub, color) => `
        <div style="padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;">
          <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${label}</div>
          <div style="font-size:22px; font-weight:700; color:${color}; line-height:1;">${value}</div>
          <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">${sub}</div>
        </div>`;
      if (cards) {
        cards.innerHTML =
          card('Gasto real', money(t.costUSD || 0), `${cur} · ${d.cached ? 'cacheado' : 'al día'}`, '#ffc828') +
          card('Llamadas conectadas', t.connectedCalls || 0, `de ${t.calls || 0} intentos`, '#5bb974') +
          card('Costo prom./conectada', money(t.avgCostPerConnected || 0), `${(t.minutes || 0).toFixed(1)} min total`, 'var(--accent)');
      }
      const countryUl = document.getElementById('tlx-realcost-countries');
      if (countryUl) {
        const rows = (d.byCountry || []).slice(0, 12);
        countryUl.innerHTML = rows.length ? rows.map(c => `
          <li style="display:flex; justify-content:space-between; gap:8px; padding:5px 8px; background:var(--bg-app); border-radius:6px;">
            <span style="color:var(--text-primary);">${escHtml(c.country)}</span>
            <span class="muted">${c.calls} · ${c.minutes.toFixed(1)}m · $${c.costUSD.toFixed(2)}</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">Sin datos.</li>';
      }
      const daysUl = document.getElementById('tlx-realcost-days');
      if (daysUl) {
        const rows = (d.byDay || []).slice(-14);
        daysUl.innerHTML = rows.length ? rows.map(x => `
          <li style="display:flex; justify-content:space-between; gap:8px; padding:5px 8px; background:var(--bg-app); border-radius:6px;">
            <span style="color:var(--text-primary); font-variant-numeric:tabular-nums;">${escHtml(x.day)}</span>
            <span class="muted">${x.calls} · $${x.costUSD.toFixed(2)}</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">—</li>';
      }
    } catch (e) {
      console.warn('[tlx-realcost]', e.message);
      if (cards) cards.innerHTML = `<div class="muted" style="font-size:12px; padding:8px; color:#f85149;">Error de red al pedir costo real.</div>`;
    }
  }

  async function _tlxLoadMetrics() {
    const range = document.getElementById('tlx-metrics-range')?.value || 'month';
    try {
      const r = await fetch(apiUrl('/api/telnyx/metrics?range=' + range), { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      // Cards
      const cards = document.getElementById('tlx-metrics-cards');
      if (cards) {
        const t = d.totals || {};
        const card = (label, value, sub, color = 'var(--accent)') => `
          <div style="padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;">
            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px;">${label}</div>
            <div style="font-size:22px; font-weight:700; color:${color}; line-height:1;">${value}</div>
            <div style="font-size:10px; color:var(--text-secondary); margin-top:4px;">${sub}</div>
          </div>`;
        cards.innerHTML =
          card('Llamadas', t.calls || 0, range, 'var(--accent)') +
          card('Minutos', t.minutes?.toFixed(1) || '0', `prom ${t.avgMinutesPerCall || 0}/llamada`, '#5bb974') +
          card('Costo USD (estimado)', '$' + (t.costUSD || 0).toFixed(2), `tabla local · real arriba ↑`, '#ffc828');
      }
      // Por setter
      const setterUl = document.getElementById('tlx-metrics-setters');
      if (setterUl) {
        const rows = (d.bySetter || []).slice(0, 10);
        setterUl.innerHTML = rows.length ? rows.map(s => `
          <li style="display:flex; justify-content:space-between; gap:8px; padding:5px 8px; background:var(--bg-app); border-radius:6px;">
            <span style="color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escHtml(s.name)}</span>
            <span class="muted" style="flex-shrink:0;">${s.calls} · ${s.minutes.toFixed(1)}m · $${s.costUSD.toFixed(2)}</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">Sin datos.</li>';
      }
      // Por país
      const countryUl = document.getElementById('tlx-metrics-countries');
      if (countryUl) {
        const rows = (d.byCountry || []).slice(0, 10);
        countryUl.innerHTML = rows.length ? rows.map(c => `
          <li style="display:flex; justify-content:space-between; gap:8px; padding:5px 8px; background:var(--bg-app); border-radius:6px;">
            <span style="color:var(--text-primary);">${escHtml(c.country)}</span>
            <span class="muted">${c.calls} · ${c.minutes.toFixed(1)}m · $${c.costUSD.toFixed(2)}</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">—</li>';
      }
      // Por tarifa
      const tariffUl = document.getElementById('tlx-metrics-tariffs');
      if (tariffUl) {
        const rows = (d.byTariff || []).slice(0, 10);
        tariffUl.innerHTML = rows.length ? rows.map(t => `
          <li style="display:flex; justify-content:space-between; gap:8px; padding:5px 8px; background:var(--bg-app); border-radius:6px;">
            <span style="color:var(--text-primary); font-family:ui-monospace,monospace; font-size:10px;">${escHtml(t.tariffKey)}</span>
            <span class="muted">${t.calls} · $${t.costUSD.toFixed(2)}</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">—</li>';
      }
    } catch (e) { console.warn('[tlx-metrics]', e.message); }
  }

  // Sprint 9: KPIs de efectividad cold calling. Calcula los ratios reales
  // del flow v2 (opener pasado, atendidas, agendadas) + breakdown por país,
  // hora del día, día de la semana. Identifica patterns útiles para optimizar.
  async function _tlxLoadEffectiveness() {
    const range = document.getElementById('tlx-eff-range')?.value || 'month';
    try {
      const r = await fetch(apiUrl('/api/telnyx/cold-call-effectiveness?range=' + range), { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const ratios = d.ratios || {};
      const totals = d.totals || {};
      // KPI cards principales
      const kpiCards = document.getElementById('tlx-eff-kpis');
      if (kpiCards) {
        // Color del ratio opener: verde si >=70%, ámbar si >=50%, rojo si <50%
        const openerColor = ratios.openerPassedPct >= 70 ? '#5bb974' : ratios.openerPassedPct >= 50 ? '#FFB341' : '#f85149';
        const card = (icon, label, value, sub, color = 'var(--text-primary)', tooltip = '') => `
          <div title="${tooltip}" style="padding:14px 16px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;">
            <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.4px; margin-bottom:6px;">${icon} ${label}</div>
            <div style="font-size:22px; font-weight:700; color:${color}; line-height:1;">${value}</div>
            <div style="font-size:10px; color:var(--text-secondary); margin-top:5px;">${sub}</div>
          </div>`;
        kpiCards.innerHTML =
          card('📞', 'Total llamadas', totals.calls || 0, `${totals.minutes || 0} min · $${(totals.costUSD || 0).toFixed(2)}`, 'var(--accent)') +
          card('🎯', 'Ratio opener (>30s)', `${ratios.openerPassedPct || 0}%`, `Target: 70%+ — ${d.breakdown?.openerPassedCount || 0} pasaron`, openerColor, 'Si está debajo de 70%, hay algo roto en la apertura. Cambiá script.') +
          card('👋', 'Hablaste con humano', `${ratios.reachedHumanPct || 0}%`, `${d.breakdown?.reachedCount || 0} contactados`, '#7dd3fc', 'Llamadas donde realmente hablaste con el decisor o respondieron (excluye buzón, no atendió).') +
          card('📅', 'Agendadas / contactados', `${ratios.scheduledFromReachedPct || 0}%`, `${d.breakdown?.scheduledCount || 0} reuniones`, '#5bb974', 'De los que hablaron con vos, cuántos terminaron agendando.') +
          card('✅', 'Interesados / contactados', `${ratios.interestedFromReachedPct || 0}%`, `${d.breakdown?.interestedCount || 0} interesados`, '#FFB341');
      }
      // Por país
      const ulCountries = document.getElementById('tlx-eff-countries');
      if (ulCountries) {
        const rows = (d.byCountry || []).slice(0, 8);
        ulCountries.innerHTML = rows.length ? rows.map(c => `
          <li style="display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:6px; padding:5px 8px; background:var(--bg-app); border-radius:6px; align-items:center;">
            <span style="color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px;">${escHtml(c.country)}</span>
            <span class="muted" style="font-size:10px; text-align:right;">${c.calls} calls</span>
            <span style="color:${c.scheduledPct >= 5 ? '#5bb974' : 'var(--text-secondary)'}; font-size:10px; text-align:right;">${c.scheduledPct}% 📅</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">Sin datos.</li>';
      }
      // Por hora
      const ulHours = document.getElementById('tlx-eff-hours');
      if (ulHours) {
        const rows = (d.byHour || []);
        ulHours.innerHTML = rows.length ? rows.map(h => `
          <li style="display:grid; grid-template-columns:0.6fr 1fr 1fr; gap:6px; padding:5px 8px; background:var(--bg-app); border-radius:6px; align-items:center;">
            <span style="color:var(--text-primary); font-family:ui-monospace,monospace; font-size:11px;">${String(h.hour).padStart(2, '0')}h</span>
            <span class="muted" style="font-size:10px; text-align:right;">${h.calls}</span>
            <span style="color:${h.reachedPct >= 25 ? '#5bb974' : 'var(--text-secondary)'}; font-size:10px; text-align:right;">${h.reachedPct}% 👋</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">—</li>';
      }
      // Por día de la semana
      const ulDays = document.getElementById('tlx-eff-days');
      if (ulDays) {
        const rows = (d.byDayOfWeek || []);
        ulDays.innerHTML = rows.length ? rows.map(day => `
          <li style="display:grid; grid-template-columns:1fr 0.7fr 0.7fr; gap:6px; padding:5px 8px; background:var(--bg-app); border-radius:6px; align-items:center;">
            <span style="color:var(--text-primary); font-size:11px;">${escHtml(day.dayLabel)}</span>
            <span class="muted" style="font-size:10px; text-align:right;">${day.calls}</span>
            <span style="color:${day.reachedPct >= 25 ? '#5bb974' : 'var(--text-secondary)'}; font-size:10px; text-align:right;">${day.reachedPct}%</span>
          </li>`).join('') : '<li class="muted" style="text-align:center; padding:8px;">—</li>';
      }
    } catch (e) { console.warn('[tlx-effectiveness]', e.message); }
  }

  // ── Scripts editor (admin) ──
  let _tlxScriptsCache = [];
  async function _tlxLoadScriptsAdmin() {
    try {
      const r = await fetch(apiUrl('/api/telnyx/scripts'), { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      _tlxScriptsCache = d.scripts || [];
      _tlxRenderScriptsList();
    } catch (e) { console.warn('[tlx-scripts-admin]', e.message); }
  }
  function _tlxRenderScriptsList() {
    const list = document.getElementById('tlx-scripts-list');
    const empty = document.getElementById('tlx-scripts-empty');
    if (!list || !empty) return;
    if (_tlxScriptsCache.length === 0) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const triggerColors = {
      // v2 SCM
      rules: '#9D85F2', before_call: '#7dd3fc',
      gatekeeper: '#5bb974', opener: '#5bb974', pitch: '#5bb974',
      ask_meeting: '#ffc828', confirm: '#ffc828',
      objection_brushoff: '#ffc828', objection_real: '#f85149',
      callback: '#9D85F2', whatsapp_msg: '#5bb974', email_template: '#7dd3fc',
      // legacy
      first_call: '#5bb974', objection: '#f85149', scheduling: 'var(--accent)',
      voicemail: '#7dd3fc', general: 'var(--text-secondary)',
    };
    list.innerHTML = _tlxScriptsCache.map(s => `
      <li style="padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-color); border-radius:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:6px;">
          <div style="flex:1; min-width:0;">
            <strong style="font-size:13px; color:var(--text-primary);">${escHtml(s.label)}</strong>
            <span class="chip" style="margin-left:6px; padding:1px 7px; font-size:9px; background:${triggerColors[s.trigger] || 'var(--bg-card)'}22; color:${triggerColors[s.trigger] || 'var(--text-secondary)'}; border:1px solid ${triggerColors[s.trigger] || 'var(--border-color)'}; border-radius:5px; font-weight:600;">${escHtml(s.trigger || 'general')}</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button onclick="window._tlxEditScript('${escHtml(s.id)}')" class="btn-table-action" style="color:var(--info); font-size:10px;">Editar</button>
            <button onclick="window._tlxDeleteScript('${escHtml(s.id)}', '${escHtml(s.label).replace(/'/g, "\\'")}')" class="btn-table-action" style="color:#f85149; font-size:10px;">Borrar</button>
          </div>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.55; max-height:80px; overflow:hidden; text-overflow:ellipsis; white-space:pre-wrap;">${escHtml(s.text)}</div>
      </li>
    `).join('');
  }
  // Botón "Recargar oficial v2": reemplaza todos los scripts con el seed actual
  document.getElementById('tlx-script-reset-seed-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const confirmed = await (window.askText
      ? window.askText({ title: '♻️ Recargar guiones oficiales v2', subtitle: 'Esto REEMPLAZA todos los guiones actuales con la versión oficial (SCM_Cold_Call_v2). Se guarda un backup automático. Escribí REEMPLAZAR para confirmar.', type: 'input', placeholder: 'REEMPLAZAR', confirmLabel: 'Recargar' })
      : Promise.resolve(prompt('Escribí REEMPLAZAR para confirmar:')));
    if (confirmed !== 'REEMPLAZAR') {
      if (confirmed !== null && confirmed !== undefined && confirmed !== '') {
        window.showToast?.('Cancelado (texto no coincide)', { type: 'warn' });
      }
      return;
    }
    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Recargando…';
    try {
      const r = await fetch(apiUrl('/api/telnyx/scripts/reset-to-seed'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const d = await r.json(); if (d?.error) msg = d.error; } catch {}
        throw new Error(msg);
      }
      const d = await r.json();
      window.showToast?.(`✓ ${d.replaced} guiones oficiales recargados. Backup: ${d.backupPath || 'n/a'}`, { type: 'success', duration: 5000 });
      _tlxLoadScriptsAdmin();
    } catch (err) {
      window.showToast?.('Error: ' + err.message, { type: 'error', duration: 6000 });
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  });

  document.getElementById('tlx-script-add-btn')?.addEventListener('click', async () => {
    const label = await window.askText({ title: '📝 Nuevo guion', subtitle: 'Label corto descriptivo. Ej: "Objeción: ya tengo sistema".', type: 'input', placeholder: 'Apertura inicial', confirmLabel: 'Siguiente' });
    if (!label) return;
    const trigger = await window.askText({
      title: 'Trigger', subtitle: 'Cuándo aplica este guion. Valores: before_call, gatekeeper, opener, pitch, ask_meeting, confirm, objection_brushoff, objection_real, callback, whatsapp_msg, email_template, rules, general.',
      type: 'input', placeholder: 'opener', confirmLabel: 'Siguiente',
    });
    if (!trigger) return;
    const text = await window.askText({
      title: 'Texto del guion',
      subtitle: 'Lo que el setter va a leer. Podés usar variables: {name}, {city}, {setterName}, {date}, {time}.',
      type: 'textarea', placeholder: 'Hola Dr/a {name}, soy {setterName}…', confirmLabel: 'Crear',
    });
    if (!text) return;
    try {
      const r = await fetch(apiUrl('/api/telnyx/scripts'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ label, trigger: trigger.trim(), text }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      window.showToast?.('Guion agregado ✓', { type: 'success' });
      _tlxLoadScriptsAdmin();
    } catch (e) { window.showToast?.('Error: ' + e.message, { type: 'error' }); }
  });
  window._tlxEditScript = async (id) => {
    const s = _tlxScriptsCache.find(x => x.id === id);
    if (!s) return;
    const newText = await window.askText({
      title: '✎ Editar: ' + s.label,
      subtitle: 'Variables: {name}, {city}, {setterName}, {date}, {time}',
      type: 'textarea', defaultValue: s.text, confirmLabel: 'Guardar',
    });
    if (!newText) return;
    try {
      const r = await fetch(apiUrl('/api/telnyx/scripts/' + encodeURIComponent(id)), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ text: newText }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      window.showToast?.('Actualizado ✓', { type: 'success' });
      _tlxLoadScriptsAdmin();
    } catch (e) { window.showToast?.('Error: ' + e.message, { type: 'error' }); }
  };
  window._tlxDeleteScript = async (id, label) => {
    const ok = await window.askConfirm({
      title: '¿Borrar guion?', message: `Vas a borrar "${label}". Los setters dejarán de verlo.`,
      confirmLabel: 'Borrar', danger: true,
    });
    if (!ok) return;
    try {
      const r = await fetch(apiUrl('/api/telnyx/scripts/' + encodeURIComponent(id)), {
        method: 'DELETE', credentials: 'include',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      window.showToast?.('Borrado ✓', { type: 'success' });
      _tlxLoadScriptsAdmin();
    } catch (e) { window.showToast?.('Error: ' + e.message, { type: 'error' }); }
  };

  // Wire eventos de la vista
  document.querySelector('[data-target="view-telnyx-config"]')?.addEventListener('click', () => {
    setTimeout(() => {
      _tlxLoadConfig();
      _tlxLoadBalance();
      _tlxLoadRealCosts();
      _tlxLoadMetrics();
      _tlxLoadEffectiveness();      // Sprint 9: KPIs cold calling
      _tlxLoadScriptsAdmin();
      // Auto-refresh metrics + efectividad cada 30s mientras la vista esté visible
      if (_tlxMetricsRefreshTimer) clearInterval(_tlxMetricsRefreshTimer);
      _tlxMetricsRefreshTimer = setInterval(() => {
        const view = document.getElementById('view-telnyx-config');
        if (view && !view.classList.contains('hidden')) {
          _tlxLoadMetrics();
          _tlxLoadEffectiveness();
        } else {
          clearInterval(_tlxMetricsRefreshTimer);
          _tlxMetricsRefreshTimer = null;
        }
      }, 30000);
    }, 50);
  });

  document.getElementById('tlx-metrics-range')?.addEventListener('change', _tlxLoadMetrics);
  document.getElementById('tlx-eff-range')?.addEventListener('change', _tlxLoadEffectiveness);
  document.getElementById('tlx-realcost-range')?.addEventListener('change', () => _tlxLoadRealCosts());
  // Reconciliar: pega el costo real a cada llamada del historial de cada lead
  document.getElementById('tlx-realcost-reconcile')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const range = document.getElementById('tlx-realcost-range')?.value || 'last_30_days';
    const msg = document.getElementById('tlx-realcost-reconcile-msg');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Reconciliando…';
    try {
      const r = await fetch(apiUrl('/api/telnyx/reconcile-costs?range=' + range), { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      if (msg) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(91,185,116,0.12)'; msg.style.color = '#5bb974';
        msg.textContent = `✓ ${j.matched} llamada(s) actualizada(s) con costo real (de ${j.sessionsFound} sesiones, ${j.leadsTouched} leads). Ya aparece en el historial de cada lead.`;
      }
    } catch (err) {
      if (msg) { msg.style.display = 'block'; msg.style.background = 'rgba(248,81,73,0.12)'; msg.style.color = '#f85149'; msg.textContent = 'Error: ' + err.message; }
    } finally { btn.disabled = false; btn.textContent = old; }
  });

  // Saldo: refresh manual (fuerza fresh, salta el cache de 60s)
  document.getElementById('tlx-balance-refresh')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
    _tlxLoadBalance({ fresh: true }).finally(() => { btn.disabled = false; btn.textContent = old; });
  });
  // Guardar umbral de alerta de saldo bajo
  document.getElementById('tlx-balance-threshold-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const v = Number(document.getElementById('tlx-balance-threshold')?.value);
    if (!Number.isFinite(v) || v < 0) { alert('Ingresá un número válido (0 o más).'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Guardando…';
    try {
      const r = await fetch(apiUrl('/api/telnyx/config'), {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lowBalanceThreshold: v }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _tlxAdminCache.lowBalanceThreshold = v;
      await _tlxLoadBalance({ fresh: true });   // re-evaluar alerta con el umbral nuevo
      btn.textContent = '✓ Guardado';
      setTimeout(() => { btn.textContent = old; }, 1500);
    } catch (err) {
      alert('Error guardando umbral: ' + err.message);
      btn.textContent = old;
    } finally { btn.disabled = false; }
  });

  // Guardar credenciales
  document.getElementById('tlx-cfg-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const env = _tlxAdminCache.envSourced || {};
    // Construir body solo con campos editables (no env-managed) y no vacíos.
    // Si un campo viene de env var, NI siquiera lo enviamos (el backend lo
    // rechazaría con 409). Esto evita mensajes de error confusos.
    const body = {};
    if (!env.apiKey) {
      const v = document.getElementById('tlx-cfg-apikey').value.trim();
      if (v) body.apiKey = v;
    }
    if (!env.sipConnectionId) {
      const v = document.getElementById('tlx-cfg-connid').value.trim();
      // sipConnectionId admite "" para limpiar
      if (v || v === '') body.sipConnectionId = v;
    }
    if (!env.sipUsername) {
      const v = document.getElementById('tlx-cfg-sipuser').value.trim();
      if (v) body.sipUsername = v;
    }
    if (!env.sipPassword) {
      const v = document.getElementById('tlx-cfg-sippass').value.trim();
      if (v) body.sipPassword = v;
    }
    if (!env.signaturePublicKey) {
      const v = document.getElementById('tlx-cfg-sigkey').value.trim();
      if (v) body.signaturePublicKey = v;
    }
    if (Object.keys(body).length === 0) {
      const allEnvManaged = env.apiKey && env.sipUsername && env.sipPassword && env.sipConnectionId && env.signaturePublicKey;
      window.showToast?.(allEnvManaged ? 'Todos los campos están en env vars (editá en Railway)' : 'Nada que guardar', { type: 'warn' });
      return;
    }
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await fetch(apiUrl('/api/telnyx/config'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        // Error 409 = campos env-managed bloqueados (no debería pasar porque ya filtramos arriba,
        // pero por las dudas mostramos el mensaje del backend)
        let msg = 'HTTP ' + r.status;
        try {
          const d = await r.json();
          if (d?.error) msg = d.error + (d.blocked ? ' [' + d.blocked.join(', ') + ']' : '');
        } catch {}
        throw new Error(msg);
      }
      // Limpiar inputs sensibles del browser
      const apiI = document.getElementById('tlx-cfg-apikey'); if (apiI && !apiI.disabled) apiI.value = '';
      const passI = document.getElementById('tlx-cfg-sippass'); if (passI && !passI.disabled) passI.value = '';
      const sigI = document.getElementById('tlx-cfg-sigkey'); if (sigI && !sigI.disabled) sigI.value = '';
      window.showToast?.('Credenciales guardadas ✓', { type: 'success' });
      btn.textContent = '✓ Guardado';
      setTimeout(() => { btn.textContent = 'Guardar credenciales'; btn.disabled = false; }, 1800);
      _tlxLoadConfig();
    } catch (err) {
      window.showToast?.('Error: ' + err.message, { type: 'error' });
      btn.textContent = 'Guardar credenciales'; btn.disabled = false;
    }
  });

  // Agregar número
  document.getElementById('tlx-num-add-btn')?.addEventListener('click', async () => {
    const phone = await window.askText({
      title: '📱 Nuevo número Telnyx',
      subtitle: 'Pegá el número en formato E.164 (con + y código de país).',
      type: 'input',
      placeholder: '+34911234567',
      confirmLabel: 'Siguiente',
    });
    if (!phone) return;
    const cleanPhone = phone.trim();
    if (!/^\+\d{6,}$/.test(cleanPhone)) {
      window.showToast?.('Formato inválido. Debe ser +<código país><número>, ej +34911234567', { type: 'error', duration: 5000 });
      return;
    }
    const label = await window.askText({
      title: 'Label del número',
      subtitle: 'Cómo lo querés identificar en el sistema. Ej: "España principal".',
      type: 'input',
      placeholder: 'España principal',
      confirmLabel: 'Siguiente',
      confirmRequired: false,
    });
    if (label === null) return;
    const country = await window.askText({
      title: 'Código de país (ISO)',
      subtitle: '2 letras del país de este número. Ej: ES, MX, CO, AR.',
      type: 'input',
      placeholder: 'ES',
      confirmLabel: 'Agregar',
    });
    if (!country) return;
    try {
      const r = await fetch(apiUrl('/api/telnyx/numbers'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ phone: cleanPhone, label: label || '', country: country.trim().toUpperCase() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      window.showToast?.('Número agregado ✓', { type: 'success' });
      _tlxLoadConfig();
    } catch (err) { window.showToast?.('Error: ' + err.message, { type: 'error' }); }
  });

  window._tlxToggleNumber = async (id, active) => {
    try {
      const r = await fetch(apiUrl('/api/telnyx/numbers/' + encodeURIComponent(id)), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ active: !!active }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      _tlxLoadConfig();
    } catch (e) { window.showToast?.('Error: ' + e.message, { type: 'error' }); }
  };

  window._tlxDeleteNumber = async (id, phone) => {
    const ok = await window.askConfirm({
      title: '¿Eliminar número?',
      message: 'Vas a borrar ' + phone + '. Esto también limpia el routing que apuntaba a este número.',
      confirmLabel: 'Sí, eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await fetch(apiUrl('/api/telnyx/numbers/' + encodeURIComponent(id)), {
        method: 'DELETE', credentials: 'include',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      window.showToast?.('Eliminado ✓', { type: 'success' });
      _tlxLoadConfig();
    } catch (e) { window.showToast?.('Error: ' + e.message, { type: 'error' }); }
  };

  // Guardar routing
  document.getElementById('tlx-routing-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const selects = document.querySelectorAll('.tlx-routing-select');
    const routing = {};
    selects.forEach(s => {
      const c = s.dataset.country;
      const v = s.value;
      if (c) routing[c] = v;
    });
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await fetch(apiUrl('/api/telnyx/config'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ countryRouting: routing }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      window.showToast?.('Routing guardado ✓', { type: 'success' });
      btn.textContent = '✓ Guardado';
      setTimeout(() => { btn.textContent = 'Guardar routing'; btn.disabled = false; }, 1800);
      _tlxLoadConfig();
    } catch (err) {
      window.showToast?.('Error: ' + err.message, { type: 'error' });
      btn.textContent = 'Guardar routing'; btn.disabled = false;
    }
  });

  // ══════════════════════════════════════════════════════════════
  // ── GUÍA DE USO (view-guide)
  // ══════════════════════════════════════════════════════════════
  // Contenido hardcoded. Para editar: tocar el array _guideContent abajo.
  // El default tab depende del rol del usuario (setter → "setter", admin/supervisor → "admin").
  const _guideContent = {
    setter: [
      {
        id: 'primer-dia',
        title: 'Tu primer día',
        body: `<ol>
          <li>Logueate con el email y password que te mandó el admin por invitación.</li>
          <li>El sidebar de la izquierda tiene todo lo que necesitás. Si te confunde, usá el menú hamburguesa arriba para esconderlo.</li>
          <li>Lo primero: andá a <strong>Centro de Entrenamiento</strong> y hacé los 8 módulos cortos (~46 min total). Cada uno tiene un quiz al final que tenés que aprobar (≥4/5).</li>
          <li>Después volvé a <strong>Setteo</strong> — esa es tu vista principal.</li>
        </ol>
        <div class="guide-callout">Cuando aprobás un módulo del onboarding el pill cambia a "Quiz aprobado" y tu progreso queda guardado.</div>`,
        goto: { target: 'view-training', label: 'Ir a Entrenamiento' }
      },
      {
        id: 'setteo',
        title: 'Trabajar leads en Setteo',
        body: `<p>La vista <strong>Setteo</strong> tiene todos los leads que te asignaron. El flow de un lead es:</p>
        <ol>
          <li><strong>Sin contactar</strong> → abrís WSP con el botón verde.</li>
          <li><strong>Conexión enviada</strong> → se marca solo al abrir el chat.</li>
          <li><strong>Respondió</strong> → tildá la casilla cuando el lead te conteste.</li>
          <li><strong>Calificado</strong> → tildá cuando confirmaste que es perfil real (clínica, dueño, etc).</li>
          <li><strong>Interesado</strong> → tildá si dice sí a la propuesta.</li>
          <li><strong>Agendado</strong> → se marca cuando agendás reunión en el calendario.</li>
        </ol>
        <div class="guide-callout"><strong>Cascada bidireccional:</strong> si marcás "Interesado SI", se autocompletan calificado/respondió/conexión. Si destildás conexión, se borra todo lo posterior.</div>
        <p>Si el lead <strong>no tiene WhatsApp</strong>, marcá "Sin WSP" — sale de tu vista y va a "Llamadas".</p>
        <p>Tenés filtros arriba (Sin contactar, En proceso, Respondieron, Calificados, Interesados, Agendados, etc.) y un buscador universal que filtra por nombre, teléfono, ciudad, doctor, etc.</p>`,
        goto: { target: 'view-crm', label: 'Ir a Setteo' }
      },
      {
        id: 'whatsapp',
        title: 'Mandar WhatsApps',
        body: `<p>Cuando le das al botón verde de WSP en un lead:</p>
        <ol>
          <li>Se abre WhatsApp Web/Desktop con el mensaje de apertura precargado (según la variante asignada al lead).</li>
          <li>Mandalo. Volvé al CRM y la conexión se marca sola.</li>
          <li>Cuando el lead responde, tildá <strong>"Respondió"</strong>.</li>
          <li>Usá las pestañas dentro del modal del lead para ver historial, notas, follow-ups, etc.</li>
        </ol>
        <div class="guide-callout warn">El mensaje de apertura se define por <strong>variante</strong>. Si ves que tu lead no tiene mensaje precargado o sale roto, avisale al admin para revisar la variante.</div>`
      },
      {
        id: 'llamadas',
        title: 'Llamar con Telnyx (centralita en el browser)',
        body: `<p>Para leads sin WSP o para hacer follow-up por voz, usás la <strong>centralita Telnyx</strong> integrada. No abre ningún programa externo — todo desde el browser.</p>
        <ol>
          <li>La primera vez el browser te pide permiso de micrófono. Dale "Permitir".</li>
          <li>Click en <strong>📞 Llamar</strong> en cualquier lead.</li>
          <li>Aparece un panel flotante con timer, mute y colgar. El sistema elige automáticamente el número saliente del país del lead (mejora tasa de atención).</li>
          <li>Tenés un panel lateral de <strong>Guion</strong> con los scripts oficiales SCM v2: opener, pitch, manejo de objeciones, cierre.</li>
          <li>Al colgar, aparece el modal de disposición. Marcá cómo fue (interesado, no interesado, no atendió, agendar más tarde, etc.).</li>
        </ol>
        <div class="guide-callout"><strong>Tono "3-S":</strong> Slow (hablá lento), Smile (sonreí — se nota), Strong (confiado). Está siempre arriba del panel.</div>
        <div class="guide-callout warn">Si el botón aparece como <code>tel:</code> tradicional en vez del panel, significa que el admin no configuró Telnyx todavía. Avisale.</div>`
      },
      {
        id: 'asistente',
        title: 'Asistente IA (Mercury)',
        body: `<p>Cuando un lead te tira algo difícil ("¿cuánto sale?", "ya tengo agencia", "no me interesa"), no improvises — usá el Asistente.</p>
        <ol>
          <li>Andá a <strong>Asistente IA</strong> en el sidebar.</li>
          <li>Pegá el mensaje del lead.</li>
          <li>Mercury te genera una respuesta sanitizada (sin <code>¿¡</code>, sin precios, sin tecnicismos) en 1-2 bloques.</li>
          <li>Copialo. Marcalo como <strong>buena/mala/edité</strong> para que el sistema aprenda.</li>
        </ol>
        <div class="guide-callout">El admin revisa las respuestas malas y mejora el prompt o las promociona al banco. Tu feedback alimenta esto.</div>`,
        goto: { target: 'view-assistant', label: 'Ir a Asistente' }
      },
      {
        id: 'faqs',
        title: 'Banco de Respuestas',
        body: `<p>El <strong>Banco de Respuestas</strong> son respuestas pre-aprobadas a las preguntas/objeciones más comunes. Es más rápido que el Asistente porque ya están escritas.</p>
        <ol>
          <li>Buscás por keyword o categoría (precio, objeción, seguimiento, calificación).</li>
          <li>Click en <strong>Copiar</strong> — se incrementa el contador de uso.</li>
          <li>Si esa respuesta cerró bien con el lead, marcala como <strong>"Funcionó"</strong> — sube en el ranking.</li>
        </ol>
        <p>Cuando agregás una entrada nueva, la IA sugiere automáticamente categoría + tags. Aceptá o editá.</p>`,
        goto: { target: 'view-faqs', label: 'Ir al Banco' }
      },
      {
        id: 'programar',
        title: 'Programar mensajes (follow-up automático)',
        body: `<p>Si un lead te dice "hablame mañana 10am", no lo dejes en tu memoria — programalo:</p>
        <ol>
          <li>Abrí el lead → pestaña <strong>"Programar mensaje"</strong>.</li>
          <li>Elegí preset (en 2h, mañana 10am, en 3 días) o fecha/hora custom.</li>
          <li>Escribí el mensaje (o usá el del banco).</li>
          <li>Guardalo. Aparece en <strong>"Follow-ups"</strong> en el sidebar.</li>
        </ol>
        <div class="guide-callout danger"><strong>Requiere wa-multi prendido:</strong> el mensaje se envía solo desde la app de escritorio cuando la cuenta WA está online. Si tu PC está apagada a esa hora, el sistema reintenta cada 5 min hasta 24h.</div>`
      },
      {
        id: 'followups',
        title: 'Follow-ups y "Mis programados"',
        body: `<p>En el sidebar tenés <strong>Follow-ups</strong> con todo lo que tenés pendiente: tildados manuales + mensajes programados que aún no salieron.</p>
        <ul>
          <li><strong>Pendientes:</strong> esperando hora de envío.</li>
          <li><strong>Enviados:</strong> ya despachados por wa-multi (con timestamp).</li>
          <li><strong>Fallidos:</strong> wa-multi offline durante 24h o cuenta caída. Reagendá o mandalos manualmente.</li>
          <li><strong>Cancelados:</strong> los que vos cancelaste.</li>
        </ul>`,
        goto: { target: 'view-scheduled', label: 'Ir a Follow-ups' }
      },
      {
        id: 'rendimiento',
        title: 'Mi rendimiento',
        body: `<p>En <strong>Mi rendimiento</strong> ves tus 7 KPIs con delta vs período anterior:</p>
        <ul>
          <li><strong>% Conexión:</strong> mensajes enviados / leads totales.</li>
          <li><strong>% Apertura:</strong> respondieron / conexiones.</li>
          <li><strong>% Calificación:</strong> interesados / calificados.</li>
          <li>+ evolución temporal con selector día / semana / mes.</li>
        </ul>
        <div class="guide-callout">Si una variante te convierte mucho menos que otra, avisale al admin — capaz hay que cambiar el copy.</div>`,
        goto: { target: 'view-myperf', label: 'Ir a Mi rendimiento' }
      },
      {
        id: 'tips',
        title: 'Tips operativos que suelen ahorrar tiempo',
        body: `<ul>
          <li>El <strong>modo tabla completa</strong> es el default — ahí ves doctor, notas, follow-ups, etc. No lo cambies a "simple" salvo que sepas qué hacés.</li>
          <li>Atajos: <code>Esc</code> cierra modales. <code>Ctrl+F</code> (browser) busca en la tabla actual.</li>
          <li>Si el sidebar te molesta, el menú hamburguesa lo esconde dejando solo iconos.</li>
          <li>Si tu cuenta WA se cae o desconecta, andá a <strong>Mis WhatsApps</strong> para ver estado y reconectar.</li>
          <li>El widget <strong>Hoy</strong> arriba muestra tus mensajes/llamadas/agendados del día — útil para auto-checkearte.</li>
        </ul>`
      },
    ],
    admin: [
      {
        id: 'setup-railway',
        title: 'Setup inicial (Railway env vars)',
        body: `<p>Antes que nada, configurá estas env vars en Railway (Settings → Variables):</p>
        <ul>
          <li><code>ADMIN_PASSWORD</code> — tu password admin (<strong>NO</strong> "ADMIN_INITIAL_PASSWORD")</li>
          <li><code>ADMIN_EMAIL</code> — email admin (default <code>ignacioana91@gmail.com</code>)</li>
          <li><code>ADMIN_NAME</code> — tu nombre</li>
          <li><code>API_KEY</code> — SerpAPI (Google Maps scraping)</li>
          <li><code>MERCURY_API_KEY</code> — Inception Labs (IA primaria)</li>
          <li><code>QWEN_API_KEY</code> — OpenRouter Qwen (IA fallback)</li>
          <li><code>APIFY_TOKEN</code> — Apify (Instagram scraper)</li>
          <li><code>RESEND_API_KEY</code> — Resend (envío de invitaciones)</li>
          <li><code>JWT_SECRET</code> — secret para JWT del módulo WA</li>
          <li><code>TELNYX_API_KEY</code> + <code>TELNYX_SIP_USERNAME</code> + <code>TELNYX_SIP_PASSWORD</code> + <code>TELNYX_SIP_CONNECTION_ID</code> + <code>TELNYX_SIGNATURE_PUBLIC_KEY</code> — centralita</li>
          <li><code>OPENAI_API_KEY</code> — opcional, habilita transcripción Whisper de llamadas (~$0.006/min)</li>
        </ul>
        <div class="guide-callout warn">Cuando hay env var seteada de Telnyx, <strong>sobrescribe el JSON y bloquea edición desde el panel admin</strong>. El JSON solo queda para datos no-sensibles (numbers, routing).</div>`
      },
      {
        id: 'pre-deploy',
        title: 'Antes de cada deploy: pre-deploy obligatorio',
        body: `<div class="guide-callout danger"><strong>Crítico:</strong> antes de <code>git push</code>, SIEMPRE <code>npm run pre-deploy</code>. Si no, perdés todos los leads scrapeados desde el último deploy.</div>
        <p>El comando te pide URL de Railway + email + password admin, baja toda la data y la guarda en <code>data/</code>. Ahora baja también: faqs, training, mercury_config, mercury_generations, alert_config, telnyx_config, telnyx_events, call_scripts, scheduled_messages.</p>
        <p><strong>Flow correcto:</strong></p>
        <ol>
          <li>Hacer cambios al código.</li>
          <li><code>npm run pre-deploy</code>.</li>
          <li>Commitear TODO (código + <code>data/</code>).</li>
          <li><code>git push origin main</code> (Railway escucha <strong>main</strong>, NO master).</li>
          <li>(Opcional sync) <code>git push origin main:master</code>.</li>
          <li>Railway redeploya solo.</li>
        </ol>`
      },
      {
        id: 'usuarios',
        title: 'Invitar usuarios (setters / supervisores)',
        body: `<ol>
          <li>Andá a <strong>Configuración → Usuarios</strong> (o equivalente según tu menú).</li>
          <li>Generá invitación con email + rol (setter / supervisor / admin).</li>
          <li>El sistema manda email vía Resend con link de activación.</li>
          <li>El user setea password al hacer click y queda activo.</li>
        </ol>
        <p>Las invitaciones tienen TTL. Si vence, regenerala.</p>`
      },
      {
        id: 'telnyx',
        title: 'Configurar Telnyx (centralita)',
        body: `<ol>
          <li>Andá a <strong>Centralita Telnyx</strong> en el sidebar.</li>
          <li>Cargá: API Key, SIP Connection ID, SIP Username/Password, Signature Public Key. (Mejor: como env vars en Railway.)</li>
          <li>Agregá los números virtuales que compraste con <strong>+ Agregar número</strong> (formato E.164, ej <code>+34911234567</code>).</li>
          <li>En <strong>Routing por país</strong> elegí qué número usar como caller ID por país destino. Mejora atención dramáticamente.</li>
          <li>En el dashboard Telnyx, configurá webhook URL apuntando a <code>https://tu-app.railway.app/api/telnyx/webhook</code>.</li>
        </ol>
        <p>Tenés tab <strong>Guiones</strong> donde editás los scripts del cold call. Botón <strong>"♻ Recargar oficial v2"</strong> reemplaza todos con el seed oficial.</p>
        <div class="guide-callout">Tabla de tarifas hardcoded en <code>TELNYX_RATES_USD_PER_MIN</code> (index.js). España móvil $0.034, México $0.094, Argentina $0.080, US $0.007. Actualizar manualmente si Telnyx cambia.</div>`,
        goto: { target: 'view-telnyx-config', label: 'Ir a Telnyx' }
      },
      {
        id: 'wa-accounts',
        title: 'Cuentas WhatsApp + warmeo',
        body: `<ol>
          <li>Andá a <strong>Cuentas WA</strong>.</li>
          <li>Agregá cuenta con nombre + número + setter asignado.</li>
          <li>El estado arranca como <strong>"nueva"</strong> → setter conecta desde wa-multi.</li>
          <li>Asignale una <strong>rutina de warmeo</strong> desde <strong>Rutinas Warming</strong> — define cuántos mensajes/día va escalando.</li>
          <li>Si querés warmeo automático entre tus propias cuentas (cross-setter), inscribilas en <strong>Red de Warming</strong>.</li>
          <li>Si una cuenta cae como baneada, marcala desde el panel para sacarla del pool.</li>
        </ol>
        <p>Boost mode: durante los primeros 3 días una cuenta nueva usa <code>replySpeed=rápido</code> para que la red arranque rápido.</p>`,
        goto: { target: 'view-wa-accounts', label: 'Ir a Cuentas WA' }
      },
      {
        id: 'mercury',
        title: 'Mercury (asistente IA) — config y revisión',
        body: `<p>Hay 2 views admin para Mercury:</p>
        <ul>
          <li><strong>Config Mercury:</strong> editás el system prompt y administrás las notas de feedback. Las últimas 10 notas se inyectan automáticamente en cada generación nueva.</li>
          <li><strong>Revisión IA:</strong> ves cada generación con el setter que la pidió, el prospect message, el output y los ejemplos del banco usados. Acciones:
            <ul>
              <li><strong>Aprobar oro</strong> → promueve al banco con tag <code>aprobado-admin</code>.</li>
              <li><strong>Rechazar.</strong></li>
              <li><strong>Reescribir</strong> → promueve al banco con tag <code>reescrita-admin</code>.</li>
              <li><strong>Sugerir mejora</strong> → agrega nota a <code>feedbackNotes</code> y aparece en próximas generaciones.</li>
            </ul>
          </li>
        </ul>
        <p>El banco Mercury seed inicial tiene 32 entradas: <code>node scripts/seed-mercury-bank.mjs --remote</code></p>`
      },
      {
        id: 'banco',
        title: 'Banco de Respuestas (FAQs)',
        body: `<p>El banco es la base de verdad de respuestas pre-aprobadas. Setters lo usan + alimenta el retrieval del Asistente IA.</p>
        <ul>
          <li><strong>Seed inicial:</strong> <code>node scripts/seed-faqs.mjs</code> (18 FAQs del Módulo 7 onboarding).</li>
          <li><strong>Import bulk:</strong> botón "+ Importar" acepta JSON, CSV o texto plano (formato <code>P:</code> / <code>R:</code> / <code>C:</code> / <code>T:</code>).</li>
          <li><strong>Variantes:</strong> cada FAQ puede tener hasta 10 formas alternas de la misma pregunta (max 200 chars c/u). Mejora el retrieval.</li>
          <li><strong>Edición/borrado:</strong> solo admin/supervisor (setters NO editan banco oficial).</li>
        </ul>`,
        goto: { target: 'view-faqs', label: 'Ir al Banco' }
      },
      {
        id: 'equipo',
        title: 'Equipo, alertas y umbrales',
        body: `<p>La view <strong>Equipo</strong> es tabla comparativa de todos los setters, sortable por cualquier KPI, con alertas automáticas:</p>
        <ul>
          <li><strong>Drop %</strong> vs período anterior.</li>
          <li><strong>Días sin actividad.</strong></li>
          <li><strong>% apertura mínimo.</strong></li>
          <li><strong>Total leads mínimo</strong> trabajados.</li>
        </ul>
        <p>Modal <strong>"Umbrales de alerta"</strong> (admin only) edita los valores. Highlight ±10% del promedio del equipo. Click en row → drilldown al view-myperf con setter pre-seleccionado.</p>`,
        goto: { target: 'view-team', label: 'Ir a Equipo' }
      },
      {
        id: 'entrenamiento',
        title: 'Centro de Entrenamiento (onboarding + material)',
        body: `<p>Dos secciones:</p>
        <ol>
          <li><strong>Onboarding oficial:</strong> 8 módulos HTML autocontenidos (en <code>public/onboarding/files/</code>). Cada uno tiene quiz autocargado de <code>quiz-data.json</code> (5 preguntas, ≥4/5 aprueba). Para <strong>actualizar contenido</strong>: reemplazar el archivo HTML entero (no edits programáticos).</li>
          <li><strong>Material adicional:</strong> subís PDFs, docs, videos. Persiste en <code>training.json</code>. El texto descriptivo alimenta el contexto IA del Banco.</li>
        </ol>
        <p>Para agregar preguntas extras al quiz de un módulo, editá <code>bancoExtra</code> en <code>quiz-data.json</code>. El sistema mezcla preguntas+bancoExtra y muestra 5 al azar cada intento.</p>`,
        goto: { target: 'view-training', label: 'Ir a Entrenamiento' }
      },
      {
        id: 'scraping',
        title: 'Scraping (Google Maps + Instagram)',
        body: `<ol>
          <li>Andá a <strong>Google Maps</strong>.</li>
          <li>Elegí país + ciudades + keyword (default "dental clinic").</li>
          <li>Backend usa SerpAPI con dedup estricta contra <code>history.json</code> — leads ya scrapeados NO se vuelven a scrapear.</li>
          <li>Resultados con indicador <span style="color:#5bb974">verde</span> (nuevo) o gris (ya scrapeado).</li>
          <li><strong>Enviar a Setters</strong> permite asignar a varios setters a la vez con cantidad por cada uno.</li>
        </ol>
        <p><strong>Import CSV directo a setter:</strong> dedup solo contra leads existentes en setters (NO contra history) — permite importar leads ya scrapeados pero sin asignar.</p>`,
        goto: { target: 'view-maps', label: 'Ir a Google Maps' }
      },
      {
        id: 'backup',
        title: 'Backup, restore y migraciones',
        body: `<p>Endpoints admin:</p>
        <ul>
          <li><code>GET /api/admin/export-data</code> — devuelve TODO (history, auth, setters, faqs, training, mercury, alerts, telnyx, scripts, scheduled).</li>
          <li><code>POST /api/admin/import-data</code> — restore desde un export previo. Valida shape ANTES de tocar archivos.</li>
        </ul>
        <p><code>npm run pre-deploy</code> usa el endpoint de export. Backups locales en <code>data/backups/</code> (rotados, gitignored).</p>
        <div class="guide-callout warn">El Volume de Railway está montado en <code>/data</code>. Si seedeás un container nuevo, <code>seedVolumeFromRepo()</code> copia los JSON del repo al volume <strong>solo si el volume está vacío</strong> (no pisa data viva).</div>`
      },
      {
        id: 'troubleshoot',
        title: 'Troubleshooting común',
        body: `<ul>
          <li><strong>"El fix no aparece después de deploy"</strong> → bumpeaste el cache-buster en <code>index.html</code>? Sin eso, browsers cachean app.js/style.css viejo.</li>
          <li><strong>"Setter no puede entrar"</strong> → ¿la invitación venció? Regenerala desde Usuarios.</li>
          <li><strong>"Llamadas Telnyx fallan"</strong> → verificá env vars Telnyx + signature public key + webhook URL apuntando a tu Railway domain.</li>
          <li><strong>"WA accounts caídas"</strong> → setter abre wa-multi y reconecta. Si persiste, marcar como banned y reemplazar.</li>
          <li><strong>"Mercury no responde"</strong> → ¿MERCURY_API_KEY válida? Hay fallback a Qwen. Si ambos fallan, fallback a top match del banco.</li>
          <li><strong>"Tests fallan en npm test"</strong> → desde el último audit, <code>seedVolumeFromRepo()</code> hace skip en NODE_ENV=test. Si todavía falla, revisar que <code>tests/onboarding.test.js</code> pre-cree <code>setters.json</code>.</li>
        </ul>`
      },
    ],
  };

  let _guideCurrentTab = null;

  window._guideSwitchTab = function (tab) {
    if (tab !== 'setter' && tab !== 'admin') tab = 'setter';
    // 2026-05-23: setter no puede ver el tab admin ni por error ni por consola.
    const role = window.currentUser?.role || 'setter';
    if (tab === 'admin' && role !== 'admin' && role !== 'supervisor') {
      tab = 'setter';
    }
    _guideCurrentTab = tab;
    document.querySelectorAll('.guide-tab').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    _guideRender();
  };

  function _guideEscape(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function _guideHighlight(html, query) {
    if (!query) return html;
    // Highlight texto dentro del body sin romper tags. Regex sobre texto plano.
    const safeQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('(' + safeQuery + ')', 'gi');
    // Split por tags HTML para no matchear dentro de atributos.
    return html.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag, text) => {
      if (tag) return tag;
      return text.replace(rx, '<mark class="guide-search-hit">$1</mark>');
    });
  }

  function _guideRender() {
    const container = document.getElementById('guide-content');
    if (!container) return;
    const sections = _guideContent[_guideCurrentTab] || [];
    const queryRaw = (document.getElementById('guide-search')?.value || '').trim();
    const query = queryRaw.toLowerCase();
    const filtered = !query
      ? sections
      : sections.filter((s) => {
          const blob = (s.title + ' ' + s.body).toLowerCase();
          return blob.indexOf(query) >= 0;
        });
    if (!filtered.length) {
      container.innerHTML = `<div class="guide-empty">No encontré nada con "${_guideEscape(queryRaw)}". Probá otra palabra.</div>`;
      return;
    }
    container.innerHTML = filtered
      .map((s, i) => {
        const bodyHtml = _guideHighlight(s.body, query);
        const titleHtml = _guideHighlight(_guideEscape(s.title), query);
        const gotoBtn = s.goto
          ? `<button class="guide-goto" data-target="${_guideEscape(s.goto.target)}">${_guideEscape(s.goto.label)} →</button>`
          : '';
        // Si hay query, expandido por default para que se vean los matches.
        const openClass = query ? 'open' : '';
        return `<div class="guide-section ${openClass}" data-id="${_guideEscape(s.id)}">
          <div class="guide-section-header" onclick="this.parentElement.classList.toggle('open')">
            <div class="guide-section-title">
              <span class="guide-section-num">${i + 1}</span>
              <span>${titleHtml}</span>
            </div>
            <span class="guide-chevron">›</span>
          </div>
          <div class="guide-section-body">
            ${bodyHtml}
            ${gotoBtn}
          </div>
        </div>`;
      })
      .join('');
    // Wire goto buttons
    container.querySelectorAll('.guide-goto').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = btn.getAttribute('data-target');
        const link = document.querySelector(`[data-target="${target}"]`);
        if (link) link.click();
      });
    });
  }

  function _guideInit() {
    // Default tab según rol
    try {
      const role = window.currentUser?.role || 'setter';
      const defaultTab = (role === 'admin' || role === 'supervisor') ? 'admin' : 'setter';
      window._guideSwitchTab(defaultTab);
    } catch (e) {
      window._guideSwitchTab('setter');
    }
    // Buscador con debounce
    const input = document.getElementById('guide-search');
    if (input && !input._guideWired) {
      let t = null;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(_guideRender, 120);
      });
      input._guideWired = true;
    }
  }

  document.querySelector('[data-target="view-guide"]')?.addEventListener('click', () => {
    setTimeout(_guideInit, 50);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Audit Sprint 37: Esc cierra cualquier modal estático abierto + click en
  // overlay cierra. Cubre `.modal-overlay` y `.lead-modal` declarados en HTML
  // que no traían su propio handler de Esc (FAQ, training, callback, schedule,
  // calls-manual, report-preview, faq-import, lead-modal, variants-modal).
  // Los modales con su propio handler (call-objection-modal, agendar-modal,
  // ask-text-modal, ask-confirm-modal, cmdk, etc.) se respetan: si están
  // hidden ya no se tocan; si están abiertos, el handler local se ejecuta
  // antes y este global ya no encuentra el modal abierto. No re-cierra.
  if (!window.__scmModalGlobalsWired) {
    window.__scmModalGlobalsWired = true;
    const _scmModalSelectors = '.modal-overlay:not(.hidden), .lead-modal:not(.hidden)';
    // Helper que cierra y dispara los click handlers locales que limpian
    // estado interno (lead-modal limpia currentModalLeadId).
    const _scmCloseModal = (modal) => {
      // Simular click en el botón close si existe (preserva limpieza local)
      const closeBtn = modal.querySelector('.modal-close-btn, [data-close], [aria-label="Cerrar"]');
      if (closeBtn) {
        try { closeBtn.click(); return; } catch {}
      }
      modal.classList.add('hidden');
    };
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const openModals = document.querySelectorAll(_scmModalSelectors);
      if (openModals.length === 0) return;
      // Cerrar solo el último abierto (z-index más alto, último en el DOM)
      const last = openModals[openModals.length - 1];
      _scmCloseModal(last);
    });
    // Click en overlay (fondo) cierra el modal. Solo cuando el target es el
    // overlay mismo (no hijos).
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.classList) return;
      if ((t.classList.contains('modal-overlay') || t.classList.contains('lead-modal')) && !t.classList.contains('hidden')) {
        _scmCloseModal(t);
      }
    });
  }

  });
