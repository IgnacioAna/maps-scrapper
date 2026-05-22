# Phase 6 — Telnyx Calls Foundation — PLAN

**Goal:** Módulo de llamadas internacionales VoIP dentro del SCM, usando
Telnyx WebRTC SDK. Setter clickea "Llamar" → llamada por browser con
caller ID local según país destino → al colgar dispara el flow de
disposition que ya existe.

**Inputs:**
- `06-CONTEXT.md` — decisiones arquitectónicas, scope IN/OUT, riesgos
- Módulo Llamadas existente (`index.js:4355-4470` endpoint `/call-disposition`,
  `public/app.js:3188` `loadCallsView`, `view-calls` en `public/index.html:641`)
- Telnyx WebRTC SDK docs: https://developers.telnyx.com/docs/voice/webrtc
- Telnyx API docs: https://developers.telnyx.com/api/v2/credentials

**Constraint duro:** 16 horas reales, 2 días. Deadline = corte del plan
de Claude del usuario.

**Out of scope (NO en este sprint — ver CONTEXT.md):** grabación,
transcripción Whisper, Mercury en vivo, coaching dashboard avanzado,
dialer predictivo, SMS bidireccional.

---

## Estructura objetivo

```
GoogleSrapper/
├── index.js                       ← +endpoints /api/telnyx/* (configs, numbers, webhook, pricing)
├── data/
│   └── telnyx_config.json         ← NUEVO: apiKey + numbers + countryRouting (admin only)
├── public/
│   ├── index.html                 ← +modal config + panel de llamada activa + script panel
│   ├── app.js                     ← +módulo cliente Telnyx WebRTC
│   └── style.css                  ← +estilos call-panel y script-panel
└── .planning/phases/06-telnyx-calls-foundation/
    ├── 06-CONTEXT.md              ← ya existe
    ├── 06-PLAN.md                 ← este archivo
    └── 06-VERIFICATION.md         ← generado en Wave 4
```

**Decisión clave de seguridad**: la API key de Telnyx **NO se manda al
browser**. Toda llamada que necesite la API key (crear ephemeral
credentials para WebRTC, listar numbers, etc.) pasa por endpoints
backend del SCM. El SCM hace proxy. Browser solo recibe ephemeral JWTs
que vencen rápido.

---

## Wave 1 — Backend foundation (4 hs)

> Objetivo: persistencia de config + endpoints REST para que el frontend
> pueda preguntar "¿qué números tenemos? ¿cuál uso para llamar a +34?"
> sin exponer la API key.

### Task 1.1 — Telnyx config storage
**Files:** `index.js` (nuevo helper + endpoints cerca de la línea 6300, junto con `loadMercuryConfig`)

**Read first:**
- `index.js:6300-6450` (formato de loadMercuryConfig y endpoints PUT — copiar patrón)
- `data/wa_accounts.json` (estructura de referencia para numbers — useful como inspiración)

**Action:**
1. Crear archivo `data/telnyx_config.json` con schema:
   ```json
   {
     "apiKey": "",
     "sipUsername": "",
     "sipPassword": "",
     "numbers": [
       {
         "id": "telnyx_num_<uuid>",
         "phone": "+34911234567",
         "label": "España principal",
         "country": "ES",
         "createdAt": "2026-05-21T...",
         "active": true
       }
     ],
     "countryRouting": {
       "ES": "telnyx_num_<id>",
       "MX": "telnyx_num_<id>",
       "default": "telnyx_num_<id>"
     },
     "updatedAt": "2026-05-21T...",
     "updatedBy": "ignacio.scmdental@gmail.com"
   }
   ```
2. Helpers `loadTelnyxConfig()` y `saveTelnyxConfig(cfg)` siguiendo patrón
   de `loadMercuryConfig`. Validar apiKey no vacío al guardar; trimear espacios.
3. `data/telnyx_config.json` agregado a la lista de archivos backupeados
   en `BACKUP_FILES` (cerca de línea 2197).

**Acceptance criteria:**
- `data/telnyx_config.json` se crea automáticamente con seed vacío si no existe
- `loadTelnyxConfig()` devuelve `{apiKey:'', sipUsername:'', sipPassword:'', numbers:[], countryRouting:{default:''}}` cuando es seed
- `saveTelnyxConfig()` persiste con `JSON.stringify(cfg, null, 2)`
- El nombre `telnyx_config.json` aparece en `BACKUP_FILES` array

---

### Task 1.2 — Endpoints REST de config
**Files:** `index.js` (después de loadTelnyxConfig)

**Read first:**
- `index.js:3196` (patrón PATCH variants — auth checks, role guard)
- `index.js:2988` (patrón POST team — admin only)

**Action:**
1. `GET /api/telnyx/config` (admin only): devuelve config SIN apiKey, sipPassword.
   Devuelve `{ hasApiKey: boolean, numbers: [...], countryRouting: {...} }`.
2. `PUT /api/telnyx/config` (admin only): acepta `{ apiKey?, sipUsername?, sipPassword?, countryRouting? }`.
3. `POST /api/telnyx/numbers` (admin): agrega un número con `{ phone, label, country }`.
   Genera `id` único, marca `active:true`, agrega a `numbers[]`.
4. `PATCH /api/telnyx/numbers/:id` (admin): edita label, active, country.
5. `DELETE /api/telnyx/numbers/:id` (admin): saca el número de `numbers[]` y limpia
   cualquier entry de `countryRouting` que apunte a este id (poner default si era el default).

**Acceptance criteria:**
- `GET /api/telnyx/config` con cookie admin devuelve 200 + JSON sin apiKey ni sipPassword
- `GET /api/telnyx/config` con cookie setter devuelve 403
- `PUT /api/telnyx/config` con `{apiKey: 'KEY_TEST_xxx'}` persiste a disk (verificar con `cat data/telnyx_config.json`)
- `POST /api/telnyx/numbers` con body válido devuelve el number con id generado
- `DELETE /api/telnyx/numbers/:id` limpia referencias en countryRouting

---

### Task 1.3 — Ephemeral credentials endpoint
**Files:** `index.js`

**Read first:**
- Telnyx docs sobre on-demand credentials: https://developers.telnyx.com/docs/voice/webrtc/registration-authentication
- `index.js` patrón de fetch externo (buscar `fetch(` con servicios externos)

**Action:**
1. `POST /api/telnyx/webrtc-credentials` (auth requerida — admin Y setter):
   - Lee `telnyx_config.json`, valida que `apiKey` esté seteado
   - Hace POST a `https://api.telnyx.com/v2/telephony_credentials` con auth Bearer apiKey
     - Body: `{connection_id: <connection_id_del_sip>, name: "ephemeral_<userId>_<timestamp>", expires_in_seconds: 600}`
   - Recibe `{data: {id, login, password, sip_username, ...}}`
   - Devuelve al cliente: `{ sipUsername, sipPassword, expiresIn: 600 }`
2. Si apiKey no está configurada → 503 con `{error: "Telnyx no configurado. Pedile al admin."}`.

**Acceptance criteria:**
- `POST /api/telnyx/webrtc-credentials` con cookie autenticada y apiKey configurada devuelve 200 + credenciales ephemeral
- Sin cookie → 401
- Sin apiKey configurada → 503
- Las credenciales expiran (Telnyx las invalida después de `expires_in_seconds`)

**NOTE para implementación:** Si en testing Telnyx requiere un SIP Connection
ID que no tenemos aún (porque no hicimos KYC), agregar fallback: usar
sipUsername+sipPassword fijos de `telnyx_config.json` (admin los pega
desde dashboard de Telnyx manualmente). Marcar TODO.

---

### Task 1.4 — Webhook de eventos Telnyx
**Files:** `index.js`

**Read first:**
- Telnyx webhooks docs: https://developers.telnyx.com/docs/voice/programmable-voice/handling-webhooks
- `index.js` (cualquier endpoint que reciba webhooks externos — buscar `webhook`)

**Action:**
1. `POST /api/telnyx/webhook` (sin auth, validación por signature):
   - Recibe payload con eventos `call.initiated`, `call.answered`, `call.hangup`, `call.machine.detection.ended`
   - Loguea evento + lo persiste en `data/telnyx_events.json` (FIFO, cap 1000)
   - Si es `call.hangup`: extrae `call_control_id`, `duration_secs`, `to`, `from`, `hangup_cause`
   - Notifica al frontend del setter activo (vía Socket.IO o polling — simple: solo log + frontend pollea su última llamada)
2. Validar signature con header `telnyx-signature-ed25519` y `telnyx_signature_public_key` (config). Si no valida → 401.
3. Si signature key no está configurada (dev mode) → loguea warning y acepta de todos modos.

**Acceptance criteria:**
- `POST /api/telnyx/webhook` con payload de prueba se loguea en `data/telnyx_events.json`
- `GET /api/telnyx/events?limit=10` (admin only) lista los últimos eventos
- Webhook con signature inválida → 401 (si key configurada)

---

## Wave 2 — Frontend dialer MVP (5 hs)

> Objetivo: que el setter pueda clickear "Llamar" en un lead y hable
> por su browser con la clínica. Sin métricas, sin script panel todavía.

### Task 2.1 — Cargar SDK Telnyx WebRTC + helpers cliente
**Files:** `public/index.html`, `public/app.js`

**Read first:**
- `public/index.html:2130` (donde se carga app.js — agregar antes)
- Telnyx WebRTC SDK CDN: https://cdn.jsdelivr.net/npm/@telnyx/webrtc@latest/lib/index.iife.js

**Action:**
1. En `public/index.html` ANTES de cargar app.js, agregar:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@telnyx/webrtc@latest/lib/index.iife.js"></script>
   ```
2. En `public/app.js` agregar al inicio del IIFE un módulo `_telnyx`:
   ```js
   const _telnyx = {
     client: null,          // TelnyxRTC instance
     activeCall: null,      // Telnyx call object
     credentials: null,     // {sipUsername, sipPassword, expiresAt}
     numbers: [],           // cache de numbers (público desde GET /api/telnyx/config)
     countryRouting: {},    // cache
     async fetchCredentials() { /* fetch /api/telnyx/webrtc-credentials */ },
     async ensureClient() { /* lazy init TelnyxRTC con credentials */ },
     async fetchConfig() { /* fetch /api/telnyx/config — solo numbers públicos */ },
     pickNumberForDestination(destinationPhone) { /* matchea por país y devuelve un from number */ },
   };
   ```
3. `pickNumberForDestination` parsea el prefijo del destination phone, mapea a country code (ES, MX, CO, US, AR, etc.), busca en countryRouting; si no hay match → default.

**Acceptance criteria:**
- En la consola del browser, después de cargar la página, `window.TelnyxRTC` existe (SDK cargado)
- `_telnyx.fetchConfig()` devuelve `{numbers: [...], countryRouting: {...}}` cuando admin ya cargó números
- `_telnyx.pickNumberForDestination('+34911234567')` devuelve el id del número español si está configurado, sino el default
- Sin Telnyx configurado → `_telnyx.numbers` queda en `[]` y `_telnyx.client` en `null`, sin romper el SCM (degradación silenciosa)

---

### Task 2.2 — Botón "📞 Llamar" en view-calls
**Files:** `public/app.js` (función `renderCallsList`)

**Read first:**
- `public/app.js:3222` (función `renderCallsList` actual — donde renderea cada lead)
- `public/app.js:3300-3400` (botones existentes de disposition en lead row)

**Action:**
1. En cada lead row de `renderCallsList`, agregar botón verde "📞 Llamar"
   al lado del nombre / a la izquierda del de "marcar disposition".
2. El botón está habilitado si: `_telnyx.numbers.length > 0` (hay numbers
   configurados) Y el lead tiene `phone`. Sino: disabled con tooltip
   "Telnyx no configurado" o "Lead sin teléfono".
3. onClick → `_startCall(lead.id)` (nuevo handler, en task 2.3).

**Acceptance criteria:**
- En view-calls, cada lead con phone tiene un botón "📞 Llamar" visible
- Si Telnyx no configurado: botón visible pero disabled, con tooltip explicativo
- Si lead sin phone: botón disabled

---

### Task 2.3 — Función `_startCall(leadId)` + panel de llamada activa
**Files:** `public/app.js`, `public/index.html`, `public/style.css`

**Read first:**
- Telnyx WebRTC SDK call lifecycle: https://developers.telnyx.com/docs/voice/webrtc/quickstarts
- `public/index.html` (donde están los modales existentes — copiar patrón)

**Action:**
1. Agregar a `public/index.html` un modal flotante `#call-active-panel`:
   - Header: nombre del lead + país + teléfono destino
   - Timer (mm:ss)
   - Texto del estado: "Conectando..." / "Sonando..." / "En llamada"
   - Botón mute (toggle ícono)
   - Botón colgar (rojo, grande)
   - Footer: número saliente que se usa (para que el setter sepa qué caller ID se muestra al destino)
2. En `public/style.css` agregar `.call-panel-*` con: fondo oscuro,
   centrado, z-index alto, blur backdrop, animación fade-in.
3. En `public/app.js`:
   ```js
   async function _startCall(leadId) {
     const lead = _findLeadInCalls(leadId);
     if (!lead?.phone) return;
     await _telnyx.ensureClient();
     const fromNum = _telnyx.pickNumberForDestination(lead.phone);
     if (!fromNum) { window.showToast('No hay número configurado'); return; }
     // Abrir panel
     _showCallPanel(lead, fromNum);
     // Hacer la llamada
     const call = _telnyx.client.newCall({
       destinationNumber: lead.phone,
       callerNumber: fromNum.phone,
       audio: true,
       video: false,
     });
     _telnyx.activeCall = call;
     // Wire eventos: ringing, answered, hangup → actualizar UI
   }
   ```
4. Mute toggle: `_telnyx.activeCall.muteAudio()` / `unmuteAudio()`.
5. Colgar: `_telnyx.activeCall.hangup()` → cierra panel + dispara modal de disposition.
6. Manejo de errores: si `newCall` falla por permisos de mic → mostrar prompt "Necesitamos permiso del micrófono" con botón retry.

**Acceptance criteria:**
- Click en "📞 Llamar" abre el modal flotante
- Modal muestra "Conectando..." y luego "En llamada" cuando el destino atiende
- Timer corre en mm:ss desde que se conecta
- Botón mute cambia ícono y silencia el mic
- Botón colgar termina la llamada y cierra el modal
- Si el browser no tiene permiso de mic: prompt explícito antes de iniciar
- Sin Telnyx configurado: botón disabled, no se llega a abrir panel

---

### Task 2.4 — Disposition al colgar
**Files:** `public/app.js`

**Read first:**
- `public/app.js` función que abre el modal de disposition al hacer click manual
  (buscar `call-disposition-modal` o similar)
- `index.js:4368` (endpoint `/call-disposition`)

**Action:**
1. Cuando `_telnyx.activeCall` recibe evento `hangup` (sea por el setter
   o por el destino), después de cerrar el panel de llamada activa,
   abrir automáticamente el modal de disposition existente.
2. Pre-poblar el modal con:
   - leadId del lead llamado
   - Duración de la llamada (en `lead.callLog[].duration` cuando se guarde)
3. Si el setter cierra el modal sin elegir disposition → loguear como
   `no_answer` por defecto + suma callAttempts (para no perder el intento).

**Acceptance criteria:**
- Al colgar, el modal de disposition se abre automáticamente con el leadId correcto
- Si el setter elige una disposition, se persiste en callLog
- Si el setter cierra el modal con X, se persiste un `no_answer` automático
- callAttempts se incrementa siempre (haya o no disposition explícita)

---

## Wave 3 — Polish: métricas + script panel (4 hs)

> Objetivo: que el setter tenga el value statement a mano durante la
> llamada, y que el admin pueda ver el costo real del módulo.

### Task 3.1 — Tracking de costos en backend
**Files:** `index.js`

**Read first:**
- Wave 1 task 1.4 (webhook handler)
- Estructura de `lead.callLog` en `ensureLeadDefaults` (`index.js:460`)

**Action:**
1. En el webhook handler de `call.hangup`, extraer `duration_secs` y `to`
   (destino) del payload.
2. Calcular costo estimado con tabla hardcoded (no es exacto pero
   aproxima bien):
   ```js
   const TELNYX_RATES_USD_PER_MIN = {
     'ES_mobile': 0.034, 'ES_landline': 0.011,
     'MX_mobile': 0.094, 'MX_landline': 0.015,
     'CO_mobile': 0.060, 'CO_landline': 0.018,
     'AR_mobile': 0.080, 'AR_landline': 0.060,
     'US_any':    0.007,
     'default':   0.05,
   };
   ```
3. Agregar al lead.callLog del lead el campo `cost: <USD>` y `duration: <secs>` y `setterId`.
4. Endpoint `GET /api/telnyx/metrics?range=today|week|month` (admin/supervisor):
   suma duration y cost de todos los callLog en el rango, agrupado por setter y país.

**Acceptance criteria:**
- Al colgar una llamada, el callLog del lead gana `{duration, cost, fromNumber}` además del outcome
- `GET /api/telnyx/metrics?range=today` con admin cookie devuelve `{totalMinutes, totalCostUSD, bySetter: {...}, byCountry: {...}}`
- Si el webhook no logra calcular costo (sin payload de duration), no rompe — graba 0 y un flag `costEstimated: false`

---

### Task 3.2 — Vista admin "Centralita Telnyx"
**Files:** `public/index.html`, `public/app.js`

**Read first:**
- `public/index.html` vista `view-mercury-config` (`<div id="view-mercury-config">`) — copiar patrón de admin section
- Sidebar (`menu-item`) — agregar entry

**Action:**
1. Nueva vista `view-telnyx-config` con tres secciones:
   - **Config**: input API key (write-only, muestra "configurado ✓" si ya hay), inputs SIP credentials.
   - **Números**: tabla con phone, label, país, active toggle, delete. Botón "+ Agregar número".
   - **Routing por país**: tabla `país → número saliente` con dropdowns.
   - **Métricas**: cards `Minutos hoy / Costo hoy USD / Minutos mes / Costo mes USD`. Tabla por setter + país.
2. Agregar entry en sidebar visible solo para admin: "📞 Centralita Telnyx".
3. Auto-refresh de métricas cada 30s mientras la vista está abierta.

**Acceptance criteria:**
- Sidebar muestra "Centralita Telnyx" solo para rol admin
- Click abre la vista con las 4 secciones
- Cargar API key → save → recargar → muestra "configurado ✓"
- Agregar un número → aparece en la tabla
- Configurar routing España → guardado → reload → mantiene la selección
- Métricas se cargan al abrir, refrescan cada 30s

---

### Task 3.3 — Script panel inline durante llamada
**Files:** `public/index.html`, `public/app.js`, `data/call_scripts.json` (nuevo)

**Read first:**
- `06-CONTEXT.md` (value statement framework adaptado a dental)
- Transcripción de Connor Murray (capturada en sesión 2026-05-21)

**Action:**
1. Crear `data/call_scripts.json` con scripts seed adaptados a dental:
   ```json
   {
     "scripts": [
       {
         "id": "opener_default",
         "label": "Opener inicial",
         "trigger": "first_call",
         "text": "Hola Dr/a {name}, soy {setterName} del equipo SCM. Trabajo con clínicas dentales como la suya en temas de reactivación de pacientes y seguimiento de presupuestos no cerrados. Lo llamé puntualmente porque vimos su clínica en {city} y queríamos coordinar una llamada corta esta semana para presentarle cómo otras clínicas en su área están automatizando esto. ¿Cómo le viene el miércoles o jueves?"
       },
       {
         "id": "objection_ya_tengo_sistema",
         "label": "Objeción: ya tengo sistema",
         "trigger": "objection",
         "text": "Justo por eso lo llamé. Trabajamos seguido con clínicas que ya tienen sistema y a veces hay gaps que cubrimos. Si no hay fit perfecto, igual quedamos en contacto. ¿Tiene 20 min el jueves para verlo en profundidad?"
       },
       {
         "id": "callback",
         "label": "Callback (segundo intento)",
         "trigger": "callback",
         "text": "Hola Dr/a {name}, soy {setterName} de SCM, retomamos lo que hablamos el otro día sobre reactivación de pacientes. ¿Tiene unos minutos ahora o le viene mejor que coordinemos un horario fijo?"
       }
     ]
   }
   ```
2. Endpoints CRUD: `GET/POST/PATCH/DELETE /api/telnyx/scripts` (admin write,
   setter read). Auth + role guard.
3. En el panel de llamada activa (`#call-active-panel`), agregar al
   lateral derecho un **panel de scripts** colapsable. Muestra:
   - Tabs/botones por trigger (Opener, Objeción "ya tengo sistema", Callback…)
   - Texto del script seleccionado con variables ya interpoladas
     (`{name}`, `{city}`, `{setterName}`)
   - Botón "Copiar al portapapeles" por si el setter quiere pegar
4. Editor de scripts (admin only) en la vista Centralita Telnyx.

**Acceptance criteria:**
- Durante una llamada activa, el setter ve el script panel a la derecha
- Click en un script muestra el texto con variables ya completadas usando datos del lead
- Admin puede editar/agregar scripts desde Centralita Telnyx → se reflejan en el panel
- Setter NO puede modificar scripts (solo verlos)

---

## Wave 4 — Testing + docs + deploy (3 hs)

> Objetivo: validar end-to-end con llamadas reales, documentar, deployar.

### Task 4.1 — Testing manual E2E
**Files:** `.planning/phases/06-telnyx-calls-foundation/06-VERIFICATION.md` (nuevo)

**Read first:**
- Wave 1-3 (todo lo construido)

**Action:**
1. Vos (Ignacio) hacés KYC en Telnyx (si todavía no aprobaron). Si tarda,
   probamos con sandbox/SIP credentials manuales del dashboard.
2. Comprás 1 número español ($1.50). Lo cargás en Centralita Telnyx con
   país ES y lo configurás como routing default para ES.
3. Ejecutar checklist:
   - [ ] Llamar a 3 clínicas españolas desde leads de view-calls
   - [ ] Verificar que caller ID muestra el +34 (preguntarle al receptor o usar tu propio celular como destino de prueba primero)
   - [ ] Verificar que mute funciona (el receptor no escucha)
   - [ ] Verificar que colgar abre el modal de disposition
   - [ ] Verificar que el disposition se persiste en callLog
   - [ ] Verificar que el costo aparece en métricas dentro de 30s del webhook
   - [ ] Probar el script panel: copiar opener, ver variables interpoladas
4. Escribir `06-VERIFICATION.md` con el checklist marcado + bugs encontrados.

**Acceptance criteria:**
- Al menos 3 llamadas reales completadas end-to-end
- 0 bugs críticos (que rompan el flow)
- Bugs menores documentados con prioridad

---

### Task 4.2 — Documentación
**Files:** `CLAUDE.md`, `.planning/STATE.md`, `docs/telnyx-quickstart.md` (nuevo)

**Read first:**
- `CLAUDE.md` (sección de módulos del frontend — agregar telnyx)
- `docs/setter-quickstart.md` (formato de quickstart para setters)

**Action:**
1. Agregar sección en `CLAUDE.md` "Módulo Telnyx Calls" con:
   - Arquitectura (browser ↔ SCM backend ↔ Telnyx API)
   - Decisiones clave (proxy de API key, caller ID por país)
   - Archivos relevantes (`data/telnyx_config.json`, endpoints, frontend)
   - Cómo agregar un número nuevo
2. Crear `docs/telnyx-quickstart.md` para setters:
   - Cómo permitir mic en el browser
   - Cómo iniciar una llamada
   - Cómo usar el script panel
   - Qué hacer si no atiende / si hay objeción
3. Actualizar `.planning/STATE.md` con resultado del sprint:
   - Phase 6 → completed
   - Métricas finales (líneas de código, horas reales, llamadas testeadas)
   - Próximos pasos para Phase 5 (Llamadas IA)

**Acceptance criteria:**
- `CLAUDE.md` tiene sección "Módulo Telnyx Calls" con sub-secciones
- `docs/telnyx-quickstart.md` existe con instrucciones step-by-step
- `STATE.md` marca Phase 6 como ✅ completed

---

### Task 4.3 — Deploy a Railway
**Files:** N/A (es operación)

**Read first:**
- `CLAUDE.md` sección "REGLA CRITICA DE DEPLOY" (línea 7)

**Action:**
1. `npm run pre-deploy` → descarga data de Railway → snapshot local
2. `git add -A && git commit -m "feat(phase-6): telnyx calls foundation"`
3. `git push origin main && git push origin main:master`
4. Esperar redeploy de Railway (1-2 min)
5. Smoke test desde producción: 1 llamada real

**Acceptance criteria:**
- Railway responde HTTP 200 después del deploy
- `GET /api/telnyx/config` con admin cookie en producción devuelve 200
- 1 llamada real desde producción completa OK

---

## must_haves (goal-backward verification)

Para que la phase se considere completada (Wave 4 verification debe poder marcar TODO esto):

1. ✅ Admin puede configurar API key Telnyx + cargar al menos 1 número
2. ✅ Botón "📞 Llamar" aparece en cada lead de view-calls
3. ✅ Al hacer click → llamada por WebRTC inicia (no requiere instalar nada)
4. ✅ Panel de llamada activa con timer + mute + colgar funciona
5. ✅ Caller ID saliente se elige automáticamente según país destino
6. ✅ Al colgar → modal de disposition se abre y persiste en callLog
7. ✅ Vista Centralita Telnyx muestra métricas reales (minutos + costo USD)
8. ✅ Script panel inline durante llamada con value statement framework
9. ✅ Al menos 3 llamadas reales completadas end-to-end sin bugs críticos
10. ✅ Documentación en CLAUDE.md + docs/telnyx-quickstart.md

---

## Distribución temporal real

| Wave | Tasks | Horas estimadas | Día |
|---|---|---:|---|
| 1 | Backend foundation (1.1-1.4) | 4h | Día 1 |
| 2 | Frontend dialer MVP (2.1-2.4) | 5h | Día 1-2 |
| 3 | Polish: métricas + script (3.1-3.3) | 4h | Día 2 |
| 4 | Testing + docs + deploy (4.1-4.3) | 3h | Día 2 |
| **Total** | **11 tasks** | **16h** | **2 días** |

**Buffer:** 0 hs. Si algo se atrasa, la Wave 3 (Task 3.3 script panel)
es la más recortable — se puede entregar sin él y agregar después.

---

## Riesgos críticos y planes B

| Riesgo | Probabilidad | Mitigación / Plan B |
|---|---|---|
| KYC Telnyx no aprobado a tiempo | Media | Usar SIP credentials manuales del dashboard sandbox; testing con destino propio celular |
| WebRTC tiene problemas de calidad de audio en LATAM | Baja | Telnyx tiene PoPs en US/Brasil; si falla, fallback a STUN/TURN públicos |
| Mic permissions del browser fallan | Baja | Banner explícito + retry button; testear en Chrome y Firefox |
| Webhook URL no recibe (Railway issues) | Baja | Polling cliente del estado de la llamada como fallback (cada 2s mientras call activa) |
| API key se expone en logs accidentalmente | Media | Audit step en Task 1.2: nunca devolver apiKey en GET, nunca log el plain text |

---

## Convenciones de commits para esta phase

```
feat(phase-6): wave 1 - telnyx config storage + endpoints
feat(phase-6): wave 1 - ephemeral credentials + webhook
feat(phase-6): wave 2 - sdk integration + dialer button
feat(phase-6): wave 2 - call panel + disposition wire
feat(phase-6): wave 3 - metrics tracking + admin view
feat(phase-6): wave 3 - script panel + crud scripts
docs(phase-6): verification + setter quickstart
feat(phase-6): deploy to railway
```

Cada commit debe ser atómico (un task = un commit), con mensaje en
imperativo y trailing co-authored-by Claude.

---

*Plan generado: 2026-05-21*
*Status: Ready for execution*
*Next: `/gsd-execute-phase 6` — empezar por Wave 1 Task 1.1*
