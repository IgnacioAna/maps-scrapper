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

document.addEventListener('DOMContentLoaded', async () => {
    const API_BASE_URL = window.location.origin && window.location.origin !== 'null' && window.location.origin.startsWith('http')
      ? window.location.origin
      : 'http://localhost:3000';
    const apiUrl = (path) => path.startsWith('http') ? path : new URL(path, API_BASE_URL).toString();

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
      const saved = parseInt(localStorage.getItem('wspTimerMinutes') || '3', 10);
      minInput.value = saved;
      minInput.addEventListener('change', () => localStorage.setItem('wspTimerMinutes', minInput.value));

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
      if (localStorage.getItem('sidebarCollapsed') === '1') sidebarEl.classList.add('collapsed');
      menuToggleBtn.addEventListener('click', () => {
        sidebarEl.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', sidebarEl.classList.contains('collapsed') ? '1' : '0');
      });
    }

    const authResp = await fetch(apiUrl('/api/auth/me'));
    const authState = await authResp.json();
    if (!authState.authenticated) {
      authScreen.classList.remove('hidden');
      mainLayout.classList.add('hidden');

      const inviteToken = new URLSearchParams(window.location.search).get('invite');
      if (inviteToken) {
        invitePanel.classList.remove('hidden');
        inviteTokenInput.value = inviteToken;
        try {
          const inviteResp = await fetch(apiUrl('/api/auth/invites/' + inviteToken));
          if (inviteResp.ok) {
            const inviteData = await inviteResp.json();
            authMessage.textContent = `Invitación para ${inviteData.invite.name} (${inviteData.invite.role})`;
          }
        } catch (e) {}
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
        if (invitePasswordInput.value !== invitePasswordConfirmInput.value) {
          authMessage.className = 'auth-message error';
          authMessage.textContent = 'Las contraseñas no coinciden.';
          return;
        }
        try {
          const resp = await fetch(apiUrl('/api/auth/accept-invite'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inviteTokenInput.value.trim(), password: invitePasswordInput.value })
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'No se pudo activar la invitación.');
          authMessage.className = 'auth-message success';
          authMessage.textContent = 'Acceso creado. Ahora podés ingresar.';
          inviteForm.reset();
          invitePanel.classList.add('hidden');
        } catch (err) {
          authMessage.className = 'auth-message error';
          authMessage.textContent = err.message || 'Error al activar la invitación.';
        }
      });

      return;
    }

    currentUser = authState.user;
    window.__CURRENT_USER__ = currentUser;
    authScreen.classList.add('hidden');
    mainLayout.classList.remove('hidden');
    document.body.dataset.role = currentUser.role;

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

    // Sanitizador para prevenir XSS al inyectar en innerHTML
    const escHtml = (str) => {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    };

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

    const getVisibleVariables = () => {
      const setterId = setterSelect?.value || (currentUser?.role === 'setter' ? currentUser.setterId : '');
      if (!setterId) return variantsList.filter(v => !v.setterId);
      return variantsList.filter((v) => !v.setterId || v.setterId === setterId);
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
        if (url && navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            // Toast mínimo
            let t = document.getElementById('_wa-toast');
            if (!t) {
              t = document.createElement('div');
              t.id = '_wa-toast';
              t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transition:opacity .2s;';
              document.body.appendChild(t);
            }
            t.textContent = '✓ Link copiado — podés pegarlo en otro navegador';
            t.style.opacity = '1';
            clearTimeout(window._waToastTimer);
            window._waToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
          }).catch(() => {});
        }
      } catch (e) { console.error(e); }
      // NO llamar preventDefault → el link abre WhatsApp normalmente
      return true;
    };

    const buildSetterWaUrl = (lead, stage = 'apertura') => {
      // Si el lead tiene su propia URL de WhatsApp importada (del CSV), usarla directamente en apertura
      if (stage === 'apertura' && lead?.whatsappUrl && lead.whatsappUrl.includes('wa.me/')) {
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
      const prefix = COUNTRY_CODES[country] || '';
      if (phone.trim().startsWith('+')) return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
      if (prefix && digits.startsWith(prefix) && digits.length >= prefix.length + 8) return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
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
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger); padding: 2rem;">Error: ${error.message}</td></tr>`;
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
        if (!item.website) return;

        // Skip si ya fue enriquecido (tiene datos de IA/redes)
        if (item._enriched) return;

        try {
          const resp = await fetch(apiUrl('/api/enrich'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: item.website, currentPhone: item.phone, country: item.country || '', city: item.city || '', location: item.locationSearched || '' })
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
            console.log(`Búsqueda Apify localizada: ${query}`);
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
          apifyResultsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger); padding:40px;">${displayMsg}</td></tr>`;
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
    let settersList = [];
    let variantsList = [];
    let currentPipeFilter = 'all';
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

    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.copy-block-btn');
      if (!btn) return;
      const targetId = btn.getAttribute('data-copy-target');
      const target = document.getElementById(targetId);
      const text = target ? target.textContent.trim() : '';
      if (!text || text === '—') return;
      try {
        await copyToClipboard(text);
        const prev = btn.textContent;
        btn.textContent = 'Copiado';
        setTimeout(() => { btn.textContent = prev; }, 1200);
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

        // Poblar selector de setters (preservar selección)
        const currentVal = setterSelect.value;
        setterSelect.innerHTML = '<option value="">Todos los setters</option>';
        settersList.forEach(s => {
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

    function _showResumeLastLead() {
      try {
        const raw = localStorage.getItem('lastLeadWorked_' + (currentUser?.id || 'guest'));
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
        document.getElementById('resume-last-btn').onclick = () => window._openLeadModal(info.id);
        document.getElementById('resume-last-dismiss').onclick = () => {
          banner.style.display = 'none';
          localStorage.removeItem('lastLeadWorked_' + (currentUser?.id || 'guest'));
        };
      } catch {}
    }

    function renderSetterLeads() {
      let filtered = [...setterLeads];
      if (currentPipeFilter === 'enviada') {
        filtered = filtered.filter(l => l.conexion === 'enviada' && !l.respondio);
      } else if (currentPipeFilter === 'sin_wsp') {
        filtered = filtered.filter(l => l.conexion === 'sin_wsp');
      } else if (currentPipeFilter === 'respondio') {
        filtered = filtered.filter(l => l.respondio && l.calificado !== true);
      } else if (currentPipeFilter === 'calificado') {
        filtered = filtered.filter(l => l.calificado === true && l.interes !== 'si');
      } else if (currentPipeFilter === 'interesado') {
        filtered = filtered.filter(l => l.interes === 'si');
      } else if (currentPipeFilter === 'seguimiento') {
        filtered = filtered.filter(l => {
          const fu = l.followUps || {};
          return fu['24hs'] || fu['48hs'] || fu['72hs'] || fu['7d'] || fu['15d'];
        });
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

      // Buscador general
      const searchQ = (document.getElementById('setter-search')?.value || '').trim().toLowerCase();
      if (searchQ) {
        filtered = filtered.filter(l => {
          const haystack = [l.name, l.phone, l.webWhatsApp, l.aiWhatsApp, l.country, l.city, l.locationSearched, l.address, l.doctor, l.email, l.website, l.instagram].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(searchQ);
        });
      }

      if (filtered.length === 0) {
        setterLeadsBody.innerHTML = '<tr><td colspan="19" class="empty-state"><div class="empty-state-content"><p>No hay leads en esta vista.</p></div></td></tr>';
        // Limpiar paginación
        const pag = document.getElementById('setter-pagination');
        if (pag) pag.innerHTML = '';
        return;
      }

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
          '<option value="enviada"' + (lead.conexion === 'enviada' ? ' selected' : '') + ' style="color:var(--success);">Enviada</option>' +
          '<option value="sin_wsp"' + (lead.conexion === 'sin_wsp' ? ' selected' : '') + ' style="color:var(--danger);">Sin WSP</option>' +
          '</select>';

        // Respondió: select inline
        const respSelect = '<select class="inline-select" data-id="' + lead.id + '" onchange="window._updateResp(this)" onclick="event.stopPropagation()">' +
          '<option value=""' + (lead.respondio === false || lead.respondio === null ? ' selected' : '') + '>—</option>' +
          '<option value="si"' + (lead.respondio === true ? ' selected' : '') + '>SI</option>' +
          '<option value="no"' + (lead.respondio === 'no' ? ' selected' : '') + '>NO</option>' +
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

        const estadoBadge = {
          sin_contactar: '', contactado: '📤', respondio: '💬', calificado: '📝', interesado: '🔥',
          agendado: '📅', cerrado: '✅', descartado: '❌'
        };

        // Fecha: mostrar fecha de contacto si existe, sino fecha de import
        const displayDate = lead.fechaContacto || (lead.fecha || '').substring(5);

        return '<tr data-lead-id="' + escHtml(lead.id) + '" onclick="window._openLeadModal(\'' + escHtml(lead.id) + '\')">' +
          '<td style="color:var(--text-secondary);">' + (lead.num || '') + '</td>' +
          '<td style="font-size:11px; color:var(--text-secondary);">' + escHtml(displayDate) + '</td>' +
          '<td style="font-weight:500;">' + escHtml(lead.name).substring(0, 28) + '<div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">' + escHtml((lead.country || '') + (lead.city ? ' / ' + lead.city : '')) + '</div></td>' +
          '<td style="font-size:11px;">' + (phone ? '<a href="' + escHtml(buildSetterWaUrl(lead, "apertura")) + '" target="_blank" class="text-link" style="color:var(--success);" onclick="window._waClickCopy(this, event);" title="Abrir WhatsApp + copiar link al portapapeles">' + escHtml(phone).substring(0, 18) + '</a>' : '<span class="text-muted">—</span>') + '</td>' +
          '<td style="text-align:center;">' + (lead.website ? '<a href="' + escHtml(lead.website) + '" target="_blank" class="icon-link" onclick="event.stopPropagation()">🌐</a>' : '') + '</td>' +
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
          '<td style="text-align:center;">' +
            (lead.instagram ? '<a href="' + escHtml(lead.instagram) + '" target="_blank" class="icon-link" onclick="event.stopPropagation()" style="color:var(--accent);">IG</a>' : '') +
            (lead.facebook ? '<a href="' + escHtml(lead.facebook) + '" target="_blank" class="icon-link" onclick="event.stopPropagation()" style="color:var(--info); margin-left:4px;">FB</a>' : '') +
            (lead.linkedin ? '<a href="' + escHtml(lead.linkedin) + '" target="_blank" class="icon-link" onclick="event.stopPropagation()" style="color:var(--accent); margin-left:4px;">IN</a>' : '') +
          '</td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="24hs" ' + (fu['24hs'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="48hs" ' + (fu['48hs'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="72hs" ' + (fu['72hs'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="7d" ' + (fu['7d'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;"><input type="checkbox" class="fu-cb" data-id="' + lead.id + '" data-step="15d" ' + (fu['15d'] ? 'checked' : '') + ' onclick="event.stopPropagation(); window._toggleFU(this)"></td>' +
          '<td style="text-align:center;">' + (estadoBadge[lead.estado] || '') + '</td>' +
        '</tr>';
      }).join('');
    }

    // Helper: sync lead from server response and refresh UI
    function _syncLeadAndRefresh(id, serverLead) {
      const idx = setterLeads.findIndex(l => l.id === id);
      if (idx >= 0 && serverLead) {
        Object.assign(setterLeads[idx], serverLead);
        // Si es sin_wsp, sacarlo de la lista del setter (va a llamadas)
        if (serverLead.conexion === 'sin_wsp') {
          // Cerrar modal si estaba abierto para este lead
          if (currentModalLeadId === id) {
            document.getElementById('lead-modal')?.classList.add('hidden');
            currentModalLeadId = null;
          }
          setterLeads.splice(idx, 1);
        }
      }
      _updateStatsLocal();
      renderSetterLeads();
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
    window._updateField = async (el, field) => {
      const id = el.dataset.id;
      const val = el.value;
      const body = {};
      body[field] = val || null;
      try {
        const resp = await fetch(apiUrl('/api/setters/leads/' + id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await resp.json();
        _syncLeadAndRefresh(id, data.lead);
      } catch (e) { console.error(e); }
    };

    // Respondió update
    window._updateResp = async (el) => {
      const id = el.dataset.id;
      const val = el.value;
      const body = { respondio: val === 'si' ? true : false };
      try {
        const resp = await fetch(apiUrl('/api/setters/leads/' + id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await resp.json();
        _syncLeadAndRefresh(id, data.lead);
      } catch (e) { console.error(e); }
    };

    window._updateCalif = async (el) => {
      const id = el.dataset.id;
      const val = el.value;
      // 'si' → true, 'no' → 'no' (string para distinguir de sin evaluar), '' → false
      const body = { calificado: val === 'si' ? true : (val === 'no' ? 'no' : false) };
      try {
        const resp = await fetch(apiUrl('/api/setters/leads/' + id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await resp.json();
        _syncLeadAndRefresh(id, data.lead);
      } catch (e) { console.error(e); }
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
        // Actualizar estado local para evitar desync
        const idx = setterLeads.findIndex(l => l.id === id);
        if (idx >= 0 && data.followUps) {
          setterLeads[idx].followUps = data.followUps;
          setterLeads[idx].lastContactAt = data.lead?.lastContactAt || setterLeads[idx].lastContactAt;
        }
        _updateStatsLocal();
        // Re-renderizar sólo si estamos en filtro "seguimiento" para que respete el filtro
        if (currentPipeFilter === 'seguimiento') renderSetterLeads();
      } catch (e) { console.error(e); }
    };

    // Paginación setters
    window._setterPageNav = (dir) => {
      setterPage += dir;
      renderSetterLeads();
    };

    // Modal de lead
    window._openLeadModal = async (leadId) => {
      const lead = setterLeads.find(l => l.id === leadId);
      if (!lead) return;
      currentModalLeadId = leadId;
      // Guardar último lead trabajado (por usuario)
      try { localStorage.setItem('lastLeadWorked_' + (currentUser?.id || 'guest'), JSON.stringify({ id: leadId, name: lead.name, at: Date.now() })); } catch {}
      const variant = getLeadVariant(lead);

      document.getElementById('modal-lead-name').textContent = lead.name;
      document.getElementById('modal-city').textContent = [lead.country, lead.city].filter(Boolean).join(' / ') || lead.address || '—';
      const bestPhone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || '';
      const openUrl = buildSetterWaUrl(lead, 'apertura');
      document.getElementById('modal-phone').innerHTML = bestPhone ? '<a href="' + escHtml(openUrl) + '" target="_blank" class="text-link" style="color:var(--success);" onclick="window._waClickCopy(this, event);" title="Abrir WhatsApp + copiar link">' + escHtml(bestPhone) + ' 💬</a>' : '—';
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
      try {
        await fetch(apiUrl('/api/setters/sessions/end'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setter: activeSession.setter }) });
      } catch (e) { console.error(e); }
      clearInterval(sessionTimerInterval);
      sessionBanner.classList.add('hidden');
      sessionBtn.disabled = false;
      sessionBtn.querySelector('.btn-text').textContent = 'Iniciar Sesión';
      activeSession = null;
    });

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
      // Setters ven variables propias + las compartidas con ellos
      variantsList = isAdmin ? allVariants : allVariants.filter(v => v.setterId === mySetterId || (Array.isArray(v.sharedWith) && v.sharedWith.includes(mySetterId)));
      const list = document.getElementById('variants-list');
      renderVariantEditor();

      if (variantsList.length === 0) {
        list.innerHTML = '<p class="text-muted">No hay variantes ' + (isAdmin ? 'creadas aún' : 'asignadas a vos aún') + '.</p>';
        return;
      }

      list.innerHTML = variantsList.map(v => {
        const isOwner = isAdmin || v.setterId === mySetterId;
        const assignedSetters = settersList.filter(s => s.id === v.setterId).map(s => s.name).join(', ');
        return '<div class="variant-card">' +
          '<div class="variant-card-header"><span class="variant-card-name">' + escHtml(v.name) + (v.weekLabel ? ' — ' + escHtml(v.weekLabel) : '') + '</span>' +
          (isOwner ? '<button class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteVariant(\'' + v.id + '\')">Eliminar</button>' : '') + '</div>' +
          '<div class="variant-card-msgs">' +
            '<div><strong>1.</strong> ' + escHtml(v.messages.apertura || '—') + '</div>' +
            '<div><strong>2.</strong> ' + escHtml(v.messages.problema || '—') + '</div>' +
            '<div><strong>3.</strong> ' + escHtml(v.messages.pruebaSocial || '—') + '</div>' +
            '<div><strong>4.</strong> ' + escHtml(v.messages.cierrePregunta || '—') + '</div>' +
          '</div>' +
          (isAdmin ? '<div class="variant-card-assign"><span style="color:var(--text-secondary);">Asignada a:</span> ' +
            (assignedSetters || '<span class="text-muted">Nadie</span>') +
            settersList.map(s => ' <button class="btn-table-action" style="font-size:10px; padding:2px 8px; color:var(--primary-color);" onclick="event.stopPropagation(); window._assignVariant(\'' + s.id + '\', \'' + v.id + '\')">' + escHtml(s.name) + '</button>').join('') +
          '</div>' : '') + '</div>';
      }).join('');
    }

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

    window._duplicateSetter = async (setterId) => {
      if (!setterId) return;
      await fetch(apiUrl('/api/setters/team/' + setterId + '/duplicate'), { method: 'POST' });
      loadCommandCenter();
    };

    window._deleteSetter = async (setterId) => {
      if (!setterId) return;
      if (!confirm('Eliminar este setter y dejar sus variables sin asignar?')) return;
      await fetch(apiUrl('/api/setters/team/' + setterId), { method: 'DELETE' });
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

      // Filtrar los que ya fueron scrapeados anteriormente (ya contactados)
      const newLeads = currentData.filter(l => !l.alreadyScraped);
      const skippedOld = currentData.length - newLeads.length;

      if (newLeads.length === 0) {
        alert('Todos los ' + currentData.length + ' leads ya fueron scrapeados anteriormente. No hay leads nuevos para enviar.');
        return;
      }

      // Cargar lista de setters
      const resp = await fetch(apiUrl('/api/setters'));
      const data = await resp.json();
      const names = (data.setters || []).map(s => s.name + ' (' + s.id + ')').join('\n');

      let msg = 'Asignar a qué setter?\n\n' + names + '\n\n(Escribí el nombre exacto o dejá vacío)';
      if (skippedOld > 0) {
        msg = '⚠️ Se detectaron ' + skippedOld + ' leads ya scrapeados anteriormente.\nSolo se enviarán los ' + newLeads.length + ' leads NUEVOS.\n\n' + msg;
      }

      const input = prompt(msg);
      if (input === null) return; // canceló

      let assignTo = '';
      if (input) {
        const found = (data.setters || []).find(s => s.name.toLowerCase() === input.trim().toLowerCase());
        assignTo = found ? found.id : input.trim();
      }
      try {
        const importResp = await fetch(apiUrl('/api/setters/import'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: newLeads, assignTo }) });
        if (!importResp.ok) {
          const errData = await importResp.text();
          console.error('Import error response:', importResp.status, errData);
          alert('Error al importar (' + importResp.status + '): ' + errData);
          return;
        }
        const result = await importResp.json();
        let summary = 'Importados: ' + (result.imported || 0) + ' leads nuevos\nYa existían en setter: ' + (result.skipped || 0);
        if (skippedOld > 0) summary += '\nYa scrapeados antes (no enviados): ' + skippedOld;
        summary += '\nTotal en pipeline: ' + (result.total || 0);
        alert(summary);
      } catch (e) { console.error('Import exception:', e); alert('Error al importar: ' + e.message); }
    });

    // ── Vista Llamadas (Sin WSP) ──
    async function loadCallsView() {
      const setter = document.getElementById('calls-setter-select').value;
      const url = apiUrl('/api/setters/leads/sin-wsp' + (setter ? '?setter=' + encodeURIComponent(setter) : ''));
      try {
        // Poblar select de setters
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

        const resp = await fetch(apiUrl(url));
        const data = await resp.json();
        const tbody = document.getElementById('calls-leads-body');
        if (!data.leads || data.leads.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No hay leads sin WhatsApp.</p></td></tr>';
          return;
        }
        tbody.innerHTML = data.leads.map(l => {
          let doc = l.doctor || '';
          if (doc.includes('N/A') || doc.includes('Sin identificar')) doc = '';
          const lastNote = l.notes && l.notes.length > 0 ? l.notes[l.notes.length - 1] : null;
          return '<tr onclick="window._openLeadModal(\'' + escHtml(l.id) + '\')" style="cursor:pointer;">' +
            '<td>' + (l.num || '') + '</td>' +
            '<td style="font-weight:500;">' + escHtml(l.name) + '</td>' +
            '<td>' + escHtml(l.phone || '') + '</td>' +
            '<td class="text-muted">' + escHtml([l.country, l.city].filter(Boolean).join(' / ') || l.address || '') + '</td>' +
            '<td>' + (l.website ? '<a href="' + escHtml(l.website) + '" target="_blank" class="icon-link" onclick="event.stopPropagation()">🌐</a>' : '') + '</td>' +
            '<td style="font-size:11px;">' + escHtml(doc).substring(0, 15) + '</td>' +
            '<td class="text-muted" style="font-size:11px;">' + escHtml(l.fecha || '') + '</td>' +
            '<td style="font-size:11px; color:var(--text-secondary);">' + (lastNote ? escHtml(lastNote.text).substring(0, 40) : '') + '</td>' +
          '</tr>';
        }).join('');
      } catch (e) { console.error(e); }
    }

    const callsMenuItem = document.querySelector('[data-target="view-calls"]');
    if (callsMenuItem) callsMenuItem.addEventListener('click', () => { loadCallsView(); });
    document.getElementById('calls-setter-select').addEventListener('change', () => { loadCallsView(); });

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

        const settersListEl = document.getElementById('admin-setters-list');
        if (settersListEl) {
          const variantCountBySetter = new Map();
          (data.perVariant || []).forEach(v => {
            if (!v.setterId) return;
            variantCountBySetter.set(v.setterId, (variantCountBySetter.get(v.setterId) || 0) + 1);
          });
          settersListEl.innerHTML = (data.perSetter || []).map(s => {
            const count = variantCountBySetter.get(s.id) || 0;
            return '<div class="variant-card" style="padding:12px;">' +
              '<div style="display:flex; justify-content:space-between; gap:12px; align-items:center; flex-wrap:wrap;">' +
                '<div>' +
                  '<div style="font-weight:600; color:var(--text-main);">' + escHtml(s.name) + '</div>' +
                  '<div style="font-size:12px; color:var(--text-secondary);">' + count + ' variables · ' + (s.interesados || 0) + ' interesados</div>' +
                '</div>' +
                '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                  '<button type="button" class="btn-table-action" style="color:var(--primary-color); font-size:11px;" onclick="document.getElementById(\'cmd-variable-setter-filter\').value=\'' + escHtml(s.id) + '\'; document.getElementById(\'cmd-variable-setter-filter\').dispatchEvent(new Event(\'change\'));">Ver variables</button>' +
                  '<button type="button" class="btn-table-action" style="color:var(--info); font-size:11px;" onclick="window._editSetter(\'' + escHtml(s.id) + '\', decodeURIComponent(\'' + encodeURIComponent(s.name) + '\'))">Editar</button>' +
                  '<button type="button" class="btn-table-action" style="color:var(--warning); font-size:11px;" onclick="window._duplicateSetter(\'' + escHtml(s.id) + '\')">Duplicar</button>' +
                  '<button type="button" class="btn-table-action" style="color:var(--danger); font-size:11px;" onclick="window._deleteSetter(\'' + escHtml(s.id) + '\')">Eliminar</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('');
        }

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
      const [usersResp, settersResp] = await Promise.all([
        fetch(apiUrl('/api/auth/users')),
        fetch(apiUrl('/api/setters'))
      ]);
      const data = await usersResp.json();
      const settersData = await settersResp.json();
      const users = data.users || [];
      const invites = data.invites || [];
      const inviteMap = new Map(invites.map(inv => [(inv.email || '').toLowerCase(), inv]));
      const variableCountBySetter = new Map();
      (settersData.variants || []).forEach(v => {
        if (!v.setterId) return;
        variableCountBySetter.set(v.setterId, (variableCountBySetter.get(v.setterId) || 0) + 1);
      });

      tbody.innerHTML = users.map(user => {
        const inv = inviteMap.get((user.email || '').toLowerCase());
        const varCount = user.role === 'setter' ? (variableCountBySetter.get(user.setterId || '') || 0) : 0;
        return '<tr>' +
          '<td>' + escHtml(user.name || '') + '</td>' +
          '<td>' + escHtml(user.email || '') + '</td>' +
          '<td>' + escHtml(user.role || '') + '</td>' +
          '<td>' + escHtml(user.status || '') + '</td>' +
          '<td>' + escHtml(user.setterId || '') + '</td>' +
          '<td>' + (user.role === 'setter' ? varCount : '—') + '</td>' +
          '<td>' + (inv ? 'Pendiente' : '—') + '</td>' +
          '<td>' + (user.role === 'setter' ? '<button type="button" class="btn-table-action" style="color:var(--warning); font-size:11px;" onclick="window._duplicateSetter(\'' + escHtml(user.setterId || '') + '\')">Duplicar</button>' : '—') + '</td>' +
        '</tr>';
      }).join('');
    }

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
        const msg = `Hola ${name}! Te invité a SCM Dental Setting App. Creá tu contraseña acá: ${url}`;
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
        let settersList = [];
        try {
          const sResp = await fetch(apiUrl('/api/setters'));
          const sData = await sResp.json();
          settersList = sData.setters || [];
        } catch (err) { console.error(err); }

        const names = settersList.map(s => s.name).join('\n');
        const input = prompt('¿De qué setter borrar TODOS los leads?\n\n' + names + '\n\n(Escribí el nombre exacto):');
        if (!input) return;

        const found = settersList.find(s => s.name.toLowerCase() === input.trim().toLowerCase());
        if (!found) { alert('Setter no encontrado: ' + input); return; }

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

        // Cargar setters para el prompt
        let settersList = [];
        try {
          const sResp = await fetch(apiUrl('/api/setters'));
          const sData = await sResp.json();
          settersList = sData.setters || [];
        } catch (err) { console.error(err); }

        const names = settersList.map(s => s.name).join('\n');
        const input = prompt('¿A qué setter asignar estos leads?\n\n' + names + '\n\n(Escribí el nombre exacto o dejá vacío para no asignar):');
        if (input === null) { setterImportCsv.value = ''; return; }

        let assignTo = '';
        if (input) {
          const found = settersList.find(s => s.name.toLowerCase() === input.trim().toLowerCase());
          assignTo = found ? found.id : input.trim();
        }

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
    if (crmMenuItem) { crmMenuItem.addEventListener('click', () => { loadSetterModule(); }); }

    if (currentUser?.role === 'setter') {
      const setterMenuItem = document.querySelector('[data-target="view-crm"]');
      setterMenuItem?.click();
      loadSetterModule();
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
    const list = document.getElementById('faq-list');
    if (!list) return;
    list.innerHTML = '<p style="color:var(--text-secondary)">Cargando...</p>';
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cat) params.set('categoria', cat);
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
      list.innerHTML = '<p style="color:var(--danger);">Error cargando respuestas: ' + err.message + '</p>';
    }
  };

  function _renderFaqCard(e) {
    const isAdmin = currentUser?.role === 'admin';
    const isOwner = e.createdById === currentUser?.id;
    const canEdit = isAdmin || isOwner;
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
    document.getElementById('faq-suggest-status').textContent = '';
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
        }
      } catch {}
    }
    document.getElementById('faq-modal').classList.remove('hidden');
    document.getElementById('faq-pregunta').focus();
  };

  window._faqSave = async () => {
    const id = document.getElementById('faq-edit-id').value;
    const pregunta = document.getElementById('faq-pregunta').value.trim();
    const respuesta = document.getElementById('faq-respuesta').value.trim();
    const categoria = document.getElementById('faq-categoria').value;
    const tagsRaw = document.getElementById('faq-tags').value;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (!pregunta || !respuesta) { alert('Completá la pregunta y la respuesta.'); return; }
    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? apiUrl('/api/faqs/' + id) : apiUrl('/api/faqs');
      await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pregunta, respuesta, categoria, tags }) });
      document.getElementById('faq-modal').classList.add('hidden');
      loadFaqsModule();
    } catch(err) { alert('Error guardando: ' + err.message); }
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
      list.innerHTML = '<p style="color:var(--danger);">Error cargando materiales: ' + err.message + '</p>';
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
  window.renderOnboardingCards = async () => {
    const cardsEl = document.getElementById('onboarding-cards');
    const subEl = document.getElementById('onboarding-subheader');
    const fillEl = document.getElementById('onboarding-progress-fill');
    if (!cardsEl) return;
    let modules = [];
    try {
      const r = await fetch(apiUrl('/api/onboarding/modules'));
      const data = await r.json();
      modules = data.modules || [];
    } catch {
      cardsEl.innerHTML = '<p style="color:var(--danger);">No pude cargar los módulos.</p>';
      return;
    }
    const progress = getOnboardingProgress();
    const completados = modules.filter(m => progress[m.num]).length;
    const totalMin = modules.reduce((sum, m) => sum + (m.minutes || 0), 0);
    if (subEl) subEl.textContent = `${modules.length} módulos · ~${totalMin} min total · ${completados} de ${modules.length} completados`;
    if (fillEl) fillEl.style.width = (completados / modules.length * 100).toFixed(0) + '%';

    cardsEl.innerHTML = modules.map(m => {
      const leido = !!progress[m.num];
      const numStr = String(m.num).padStart(2, '0');
      return `<a href="/onboarding/${m.num}" class="onboarding-card" style="
        text-decoration:none; display:block;
        background:var(--surface-color); border:1px solid ${leido ? 'rgba(91,185,116,0.4)' : 'var(--border-color)'};
        border-radius:14px; padding:18px 18px 16px; position:relative; overflow:hidden;
        transition:all 0.2s; cursor:pointer;
      "
      onmouseover="this.style.borderColor='var(--accent)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 24px rgba(167,139,250,0.15)';"
      onmouseout="this.style.borderColor='${leido ? 'rgba(91,185,116,0.4)' : 'var(--border-color)'}'; this.style.transform='translateY(0)'; this.style.boxShadow='none';">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:8px;">
          <div style="font-size:28px; font-weight:700; color:var(--accent); line-height:1; letter-spacing:-0.5px;">${numStr}</div>
          <span style="font-size:11px; color:${leido ? 'var(--success)' : 'var(--info)'}; background:${leido ? 'rgba(91,185,116,0.15)' : 'rgba(121,184,255,0.12)'}; padding:3px 10px; border-radius:10px; font-weight:600;">
            ${leido ? '✅ Leído' : '🔵 Sin leer'}
          </span>
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
    try {
      const resp = await fetch(apiUrl('/api/auth/online'));
      if (!resp.ok) {
        list.innerHTML = '<p style="color:var(--danger);">Error: ' + resp.status + '</p>';
        return;
      }
      const data = await resp.json();
      if (!data.users || data.users.length === 0) {
        list.innerHTML = '<p style="color:var(--text-secondary);">No hay usuarios.</p>';
        return;
      }
      const fmtAge = (ts) => {
        if (!ts) return 'Nunca conectado';
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
      list.innerHTML =
        `<div style="margin-bottom:14px; padding:12px 16px; background:var(--surface-color); border:1px solid var(--border-color); border-radius:10px; font-size:13px;">
          <strong style="color:var(--success);">🟢 ${onlineCount}</strong> ${onlineCount === 1 ? 'usuario conectado ahora' : 'usuarios conectados ahora'} · ${data.users.length} totales
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px;">` +
        data.users.map(u => {
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
        }).join('') + '</div>';
    } catch(err) {
      list.innerHTML = '<p style="color:var(--danger);">Error: ' + err.message + '</p>';
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

  });
