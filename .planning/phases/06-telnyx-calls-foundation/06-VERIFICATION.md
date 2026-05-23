# Phase 6 — VERIFICATION

> Checklist E2E validado contra producción real. Última validación: 2026-05-22.

---

## Goal verification

**Phase goal**: tener un módulo de llamadas VoIP internacional dentro del SCM que reemplace el botón `tel:` con audio bidireccional WebRTC, caller ID por país destino, y métricas de uso.

**Result**: ✅ **Cumplido y validado contra celular real.**

---

## E2E Tests realizados

### Test 1 — Llamada saliente con ringback + audio bidireccional
- **Setup**: lead manual creado con teléfono argentino propio del admin
- **Acción**: click "📞 Llamar" en view-calls
- **Validación**:
  - ✅ Browser pide permiso de micrófono
  - ✅ Panel modal centrado aparece con backdrop oscuro detrás
  - ✅ Estado: "Conectando…" → "Sonando…" → "En llamada"
  - ✅ Tono ringback (sintetizado local, 440Hz+480Hz) suena en parlantes
  - ✅ Celular argentino suena con caller ID `+1 786 687 0849`
  - ✅ Al atender, ringback fake se detiene automáticamente
  - ✅ **Audio bidireccional confirmado**: setter escucha al lead Y lead escucha al setter
  - ✅ Timer cuenta correctamente

**Bug resuelto durante este test**: `remoteElement` debía ir en `client.newCall(options)`, no solo en el constructor del client. Sin esto el audio entrante no se montaba al `<audio>` element.

### Test 2 — Hangup remoto (lead cuelga)
- **Acción**: el lead cuelga desde su celular
- **Validación**:
  - ✅ SDK Telnyx emite `notification.call.state === 'hangup'`
  - ✅ Panel modal se cierra automáticamente
  - ✅ Backdrop se desvanece
  - ✅ Scroll automático al dropdown de disposition
  - ✅ Fila del lead se resalta con borde violeta pulsante (3 pulsos)

**Bug resuelto durante este test**: estados terminales reales del SDK son `hangup`/`destroy`/`purge` (NO `done`/`ended` como había asumido en un commit anterior). Verificado contra source del SDK vía agent Explore.

### Test 3 — Hangup local (setter cuelga)
- **Acción**: click "📵 Colgar" durante llamada activa
- **Validación**:
  - ✅ `call.hangup()` se ejecuta correctamente
  - ✅ Panel cierra + disposition modal se dispara con duración correcta
  - ✅ `_pendingTelnyxCallMetadata[leadId]` se popula con `duration` + `fromNumber`
  - ✅ Próximo PATCH a `/call-disposition` incluye la metadata Telnyx
  - ✅ Backend calcula costo con `_estimateTelnyxCost` y persiste en `callLog`

### Test 4 — Mute toggle
- **Acción**: durante llamada activa, click "🎤 Mute" → click otra vez
- **Validación**:
  - ✅ `call.muteAudio()` se llama correctamente
  - ✅ Botón cambia visualmente (clase `.tlx-mute-active` con styling violeta)
  - ✅ Texto cambia a "🔇 Muteado"
  - ✅ Click otra vez restaura estado normal sin que quede blanco roto
  - ✅ Lead efectivamente no escucha al setter durante mute

**Bug resuelto durante este test**: el toggle visual del botón mute necesita usar clase CSS (`.tlx-mute-active`), no `style.background = ''` directo que dejaba el botón blanco roto.

### Test 5 — Script panel durante llamada
- **Acción**: durante llamada activa, click "📝 Guion"
- **Validación**:
  - ✅ Panel principal se desliza a la izquierda con transición suave
  - ✅ Panel de scripts aparece a la derecha (animation `slideIn`)
  - ✅ Header muestra chip "🐢 Slow · 😊 Smile · 💪 Strong"
  - ✅ PACE card sticky muestra framework con colores por letra
  - ✅ Buscador filtra scripts por keyword en tiempo real
  - ✅ Botones ordenados por flow del script v2 (before_call → gatekeeper → opener → pitch → ...)
  - ✅ Click en botón selecciona el script y lo muestra interpolado con `{name}`, `{years}`, `{reviews}` del lead
  - ✅ Botón "Copiar texto" funciona

### Test 6 — Disposition + métricas
- **Acción**: después de colgar, elegir disposition desde dropdown
- **Validación**:
  - ✅ POST a `/api/setters/leads/:id/call-disposition` con `telnyxCallMeta`
  - ✅ Backend persiste `lead.callLog[].{duration, fromNumber, cost, channel: 'telnyx_webrtc'}`
  - ✅ Tabla `TELNYX_RATES_USD_PER_MIN` calcula costo correcto (ej. AR móvil ~$0.08/min)
  - ✅ GET `/api/telnyx/metrics?range=today` devuelve totals + bySetter + byCountry + byTariff
  - ✅ View "Centralita Telnyx → Uso y costos" muestra las cards con datos reales
  - ✅ Auto-refresh cada 30s mientras la vista está visible

### Test 7 — Webhook signature validation
- **Acción**: Telnyx envía webhook event al callback URL configurado
- **Validación**:
  - ✅ Endpoint `/api/telnyx/webhook` recibe el POST con `Telnyx-Signature-Ed25519` header
  - ✅ `_verifyTelnyxSignature` valida con ed25519 public key correctamente
  - ✅ Anti-replay check (5min window) funciona
  - ✅ Event persiste en `data/telnyx_events.json` con flag `signatureValid: true`
  - ✅ GET `/api/telnyx/events` (admin only) muestra los eventos

### Test 8 — Env vars > JSON priority
- **Setup**: env vars `TELNYX_API_KEY`, `TELNYX_SIP_USERNAME`, etc. configuradas en Railway
- **Validación**:
  - ✅ `loadTelnyxConfig()` hace overlay env > JSON correctamente
  - ✅ `_publicTelnyxConfig` devuelve `envSourced: { apiKey: true, ... }` al frontend
  - ✅ Panel admin muestra banner "🔒 Secrets via env vars en Railway: 5 campo(s)..."
  - ✅ Inputs sensibles deshabilitados con placeholder "🔒 Gestionado por env var"
  - ✅ PUT `/api/telnyx/config` rechaza updates a campos env-managed con 409
  - ✅ Self-healing: si JSON tenía secrets viejos, se limpian en próximo save

### Test 9 — Caller ID local fallback
- **Setup**: lead con teléfono boliviano (+591) pero countryRouting solo tiene default (USA)
- **Validación**:
  - ✅ `_telnyx.pickNumberForDestination('+591...')` cae a `routing.default`
  - ✅ Llamada se inicia con caller ID +1 786 (USA Miami) — no falla
  - ✅ Toast warning si NO hay ningún número configurado

### Test 10 — Lead manual creation
- **Acción**: admin crea lead manual desde modal "+ Lead manual" en view-calls
- **Validación**:
  - ✅ POST `/api/setters/leads/manual-add` crea lead con `conexion: 'sin_wsp'`
  - ✅ Lead aparece en view-calls inmediatamente sin refresh
  - ✅ Validación E.164 client+server side (rechaza `+5491...` corto, acepta `+5491156789012`)
  - ✅ Flag `importedManually: true` permite distinguir de scrapeados

### Test 11 — Paginación + sort
- **Setup**: setter con >100 leads en sin_wsp
- **Validación**:
  - ✅ Lista renderiza solo 50 por página
  - ✅ Footer de paginación visible con ⟪ ← X/Y → ⟫
  - ✅ Click "Siguiente" avanza página + scroll top suave
  - ✅ Dropdown sort cambia orden + reset a página 1
  - ✅ Persistencia del sort preference en localStorage

### Test 12 — Scripts v2 cargados
- **Acción**: admin click "♻️ Recargar oficial v2" en Centralita Telnyx
- **Validación**:
  - ✅ Confirmación por texto "REEMPLAZAR" obligatoria
  - ✅ POST `/api/telnyx/scripts/reset-to-seed` backupea call_scripts.json viejo
  - ✅ 30 scripts cargados desde seed
  - ✅ 12 triggers nuevos visibles en panel (before_call, gatekeeper, opener, pitch, ask_meeting, confirm, objection_brushoff, objection_real, callback, whatsapp_msg, email_template, rules)
  - ✅ Toast success con count + backup path

---

## Bugs encontrados durante validación E2E (todos resueltos)

| # | Bug | Síntoma | Causa raíz | Fix |
|---|-----|---------|------------|-----|
| 1 | CDN URL inválido | TelnyxRTC SDK no carga | `lib/index.iife.js` no existe en npm package | `lib/bundle.js` |
| 2 | `_telnyx.fetchConfig()` no llamado | Botón Llamar muestra fallback `tel:` | loadCallsView nunca lo invocaba | `await _telnyx.fetchConfig()` antes de renderCallsList |
| 3 | Audio entrante roto | Lead no se escucha | `remoteElement` solo en constructor del client | Pasarlo también en `newCall(options)` |
| 4 | Hangup remoto no detectado | Panel queda en "Sonando..." infinito | Yo había puesto `done`/`ended` como estados (no existen) | Volver a `hangup`/`destroy`/`purge` (reales) |
| 5 | Performance lenta web | UI laggea | `backdrop-filter: blur(6px)` + audio `controls` + console.log spam | Quitar blur, quitar controls, reducir logs |
| 6 | Panel transparente | Botones de la lista visibles a través | Gradient con CSS vars con alpha | Color sólido `#11131A` |
| 7 | Botón mute blanco roto | Visual roto al toggle off | `style.background = ''` no restaura | Usar `.tlx-mute-active` class |
| 8 | Caller ID solo toll-free al buscar números | Confusión inicial del admin | Filtros del search bar de Telnyx por default | Educational: usar Type=Local |

---

## Setup validado en producción (Railway)

### Env vars activas
- `TELNYX_API_KEY` ✅
- `TELNYX_SIP_USERNAME` ✅
- `TELNYX_SIP_PASSWORD` ✅
- `TELNYX_SIP_CONNECTION_ID` ✅
- `TELNYX_SIGNATURE_PUBLIC_KEY` ✅

### Telnyx config
- Cuenta: VERIFIED (KYC aprobado)
- Account Type: registrada bajo ALLAWANNA LLC (Delaware)
- SIP Connection: "SCM Cold Calling" (Credentials type)
- Outbound Voice Profile: "SCM Outbound" (Channel limit 10, Daily spend $5, recording OFF)
- Número activo: `+1 786 687 0849` (USA Miami Local, $1/mes)
- Allowed Destinations: All destinations
- Encrypted Media: Disabled (WebRTC siempre cifra browser↔Telnyx con DTLS-SRTP)
- Codecs: G722, G711U, G711A, G729, OPUS
- Webhook: `https://<railway-url>/api/telnyx/webhook` API v2

### SCM config
- countryRouting: `{ default: 'telnyx_num_<id-+17866870849>' }`
- 30 scripts v2 cargados (12 triggers basados en SCM_Cold_Call_v2.docx + Julio Sagantini)

---

## Lo que NO se validó (deferred a producción real)

- Volumen real de llamadas/día con métricas reales
- Costos reales acumulados vs estimación de la tabla
- Tasa de respuesta del opener (target >70% según script v2)
- Tasa de conversión a reunión agendada (target ?)
- Quality del audio en distintos países LATAM (Bolivia, México, Colombia)
- Comportamiento con múltiples llamadas concurrentes (channel limit 10)

→ Estas métricas se levantan en operación real. Ignacio empieza a usarlo
y vamos midiendo.

---

## Documentación adicional

- `docs/telnyx-quickstart.md` — guía para setters (cuando se les habilite)
- `CLAUDE.md` sección "Módulo Telnyx Calls (Phase 6)" — arquitectura completa
- `.planning/phases/06-telnyx-calls-foundation/06-CONTEXT.md` — decisiones arquitectónicas
- `.planning/phases/06-telnyx-calls-foundation/06-PLAN.md` — wave breakdown original

---

*Phase 6 marcada como ✅ DONE el 2026-05-22.*
