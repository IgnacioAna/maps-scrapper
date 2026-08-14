# Phase 28: QUICK — Alivio inmediato - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 3 (public/index.html, public/app.js — únicos archivos tocados; public/style.css opcional para componentes nuevos)
**Analogs found:** 8 fuertes / 2 sin analog directo (grid de calendario, drag de paneles — UI genuinamente nueva)

## Contexto de arquitectura (léase antes de lo demás)

Este proyecto es **vanilla JS sin framework ni bundler**. `public/app.js` (19619
líneas) es, en su enorme mayoría, **UN SOLO closure**: todo el código vive
dentro de

```js
document.addEventListener('DOMContentLoaded', async () => {
  // ... 19500 líneas ...
});
```

(app.js:39). Las funciones declaradas con `function nombre(){}` en cualquier
punto de ese closure quedan **hoisted** y son alcanzables desde cualquier otro
punto del mismo closure, sin importar el orden textual. Esto ya generó
duplicación real en el código existente (ver más abajo `_toDatetimeLocal` vs
`_scheduleFormatDatetimeLocal`) — no por necesidad de scope, sino porque nadie
se dio cuenta de que ya existía. **Para esta fase: los dos componentes nuevos
(calendario popover, drag de paneles) deben escribirse UNA sola vez cada uno y
exponerse además en `window._xxx`** (convención ya usada por
`window._leadLocalTime`, `window._callScore`, `window._leadStoreApply`) para
quedar disponibles sin ambigüedad desde los 5 puntos de entrada del
calendario y los 3 puntos de toggle de los paneles Telnyx.

No hay ninguna librería de fechas (no moment/date-fns/luxon) ni ningún
sistema de drag-and-drop existente en el repo — ambas features son container
nuevo sobre `Date` nativo + Web APIs (`getBoundingClientRect`, eventos de
mouse/pointer, `localStorage`).

---

## File Classification

| Área modificada | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| Calendario popover (nuevo, compartido por 5 inputs) | component (UI widget) | transform (estado local) + request-response (D-07 fetch calendar) | `_hoyOpenFicha`/`_hoyRefreshFicha` (app.js:5698-5745) + `openObjectionModal` (app.js:10273-10349) | role-match fuerte (creación dinámica de overlay, Esc/click-afuera, cache-and-reuse) |
| Quick-slots de hora (parte del popover, D-03) | component | transform | `.cb-quickpick`/`.ph-quickpick` (app.js:10117-10195, index.html inline) | exact (mismo propósito: elegir horario con un click) |
| Etiqueta relativa al confirmar (D-04) | component (render) | transform | `_dispoWhereToast` (app.js:8126-8143) + agrupado por día de `_hoyRenderSection`-adjacent (app.js:5901-5917) | exact (ya calcula "hoy/mañana/día DD·MM HH:MM") |
| Hora local del lead en el popover (D-06) | utility | transform | `_leadLocalTime` (app.js:7078-7102) | role-match (misma lógica de país→tz, pero solo calcula "ahora"; hace falta variante parametrizada por fecha) |
| Carga por día — callbacks + reuniones (D-07) | data-fetch / aggregation | request-response | `_mypLoadPipeline` (app.js:15834-15851) + `GET /api/setters/calendar` (index.js:12777-12785) | role-match (mismo par de fuentes: leads en memoria + fetch de calendar) |
| Wiring de los 5 inputs `datetime-local` | integration | request-response (ninguno; solo DOM) | `openCallbackModal` (app.js:10165-10238), `openPlaceholderModal` (10101-10162), `openScheduleModal` (10412-10455), `openAgendarModal` (17866-17894), hydrate de `#schedule-datetime` (4543-4562, 4629-4650) | exact (son los 5 call sites reales a tocar) |
| Drag de `#telnyx-call-panel` / `#telnyx-script-panel` (nuevo) | component (event-driven) | event-driven + persistencia localStorage | **sin analog** — cero código de drag/mousedown en el repo | no analog (UI genuinamente nueva) |
| Persistencia de posición por panel/usuario | utility | transform | `_pdAutopilotKey()` (app.js:6032) + `calls_setter_filter_<userId>` (app.js:5784-5807, 10489) + `scm_hoy_setter_<userId>` (app.js:5511) | exact (mismo patrón de clave con userId) |
| Conflicto CSS `!important` vs posición arrastrada (D-11) | integration | — | `body.tlx-script-open #telnyx-call-panel` (index.html:1461) + toggles `document.body.classList.add/remove('tlx-script-open')` (app.js:8994, 9838, 9845) | exact (es el mecanismo que hay que convivir/pisar) |
| Tokens visuales / componentes recientes | config (design tokens) | — | `style.css:9-38` (tokens), `.seg-control`/`.seg-btn` (1885-1913), `.dialpad-key` (4725-4734), `.hoy-ficha-btn` (2078-2095), `.modal-overlay`/`.modal-card` (2634-2708) | exact |

---

## Pattern Assignments

### 1. Calendario popover — componente compartido

**Analogs primarios:**
- `_hoyOpenFicha` / `_hoyRefreshFicha` (public/app.js:5698-5745) — overlay creado dinámicamente, click-afuera cierra, Esc cierra, se remueve del DOM al cerrar.
- `openObjectionModal` (public/app.js:10273-10349) — variante "crear una sola vez, cachear y reusar" (`if (!modal) { modal = document.createElement... document.body.appendChild(modal); }`), con limpieza de listener Esc vía `MutationObserver` sobre `classList` — útil si se prefiere UN popover reusado en vez de recrearlo en cada apertura.

**Estructura DOM de referencia** (`_hoyOpenFicha`, app.js:5698-5718):
```javascript
window._hoyOpenFicha = function(leadId) {
  const l = _callsLeadsById.get(leadId);
  if (!l) { window.showToast?.('No encontré la ficha de este lead — recargá la vista.', { type: 'error' }); return; }
  document.getElementById('hoy-ficha-modal')?.remove();
  const ov = document.createElement('div');
  ov.id = 'hoy-ficha-modal';
  ov.className = 'modal-overlay';
  ov.dataset.leadId = leadId; // lo usa _hoyRefreshFicha para re-renderizar
  ov.style.cssText = 'display:flex; align-items:center; justify-content:center; z-index:1200;';
  ov.innerHTML = `<div class="modal-card" style="max-width:880px; width:min(94vw,880px); max-height:88vh; display:flex; flex-direction:column;">
    <div class="modal-header">...</div>
    <div class="modal-body" style="overflow-y:auto; padding-top:6px;">${_callsRenderExpandedPanel(l)}</div>
  </div>`;
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  const escClose = (e) => { if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', escClose); } };
  document.addEventListener('keydown', escClose);
  document.body.appendChild(ov);
};
```

**Patrón "crear una vez, cachear, re-render en cada open"** (`openObjectionModal`, app.js:10273-10303, recortado):
```javascript
function openObjectionModal(leadId) {
  let modal = document.getElementById('call-objection-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'call-objection-modal';
    modal.className = 'modal-overlay hidden';
    modal.style.zIndex = '10000';
    modal.innerHTML = `<div class="modal-card" style="max-width:480px; width:95vw;">...</div>`;
    document.body.appendChild(modal);
  }
  // ... re-poblar contenido, resetear selección ...
  modal.classList.remove('hidden');
  const escHandler = (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) modal.classList.add('hidden'); };
  document.addEventListener('keydown', escHandler);
  const cleanup = () => { document.removeEventListener('keydown', escHandler); obs.disconnect(); };
  const obs = new MutationObserver(() => { if (modal.classList.contains('hidden')) cleanup(); });
  obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  ...
}
```

**⚠️ Ninguno de los dos es "anchored popover" (posicionado relativo al input que lo dispara)** — ambos son overlays centrados en viewport con backdrop. D-02 pide "el campo de fecha queda compacto y el calendario se abre al tocarlo" — más cerca de un popover anclado al input que de un modal centrado. **No hay analog de popover anclado en todo el repo** (se buscó `mousedown`/`drag`/`pointerdown`/posicionamiento por `getBoundingClientRect` — cero resultados). Dos caminos razonables, ambos válidos dentro del Design System:
  1. Modal centrado chico (reusa 100% el patrón de arriba, cero código nuevo de posicionamiento) — más simple, menos "popover" en sentido estricto.
  2. Popover ancla al input vía `getBoundingClientRect()` del input + clamp al viewport — más fiel a D-02 pero sin precedente en el código a copiar; hay que escribirlo desde cero (posicionamiento, no la lógica del modal en sí).
  El **z-index debe superar 10000** (el más alto que usan hoy los modales de Llamadas — `call-schedule-modal`, `call-placeholder-modal`, `call-callback-modal`, `call-objection-modal`, todos `z-index:10000` en index.html), porque el popover se abre DESDE ADENTRO de esos modales.

**Quick-picks de hora (D-03), patrón exacto a copiar** (`call-cb-quickpicks`, app.js:10174-10195):
```javascript
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
      qpWrap.querySelectorAll('.cb-quickpick').forEach(b => { b.style.borderColor = 'var(--border-subtle)'; b.style.background = 'var(--bg-surface)'; });
      btn.style.borderColor = 'var(--accent)';
      btn.style.background = 'rgba(157,133,242,0.12)';
    });
  });
}
```
Este mismo estilo de botón (fondo `--bg-surface`, borde `--border-subtle` → `--accent` al hover/seleccionado) es la referencia directa para los botones de franjas horarias del calendario (09:00…19:00) que pide D-03. **D-05 exige que estos quickpicks EXISTENTES (`#call-cb-quickpicks`, `#call-ph-quickpicks`) queden intactos, afuera del popover** — el calendario nuevo NO los reemplaza, convive con ellos.

**Generador de quick-picks con nombres de día** (`_buildCallbackQuickPicks`, app.js:10387-10410) — reusar el array `dayNames` (`['domingo','lunes',...]`) y el `fmt()` de ahí para cualquier etiqueta de fecha larga dentro del calendario:
```javascript
function _buildCallbackQuickPicks() {
  const now = new Date();
  const dayNames = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const mkDate = (daysAhead, hour, min = 0) => { const d = new Date(now); d.setDate(d.getDate() + daysAhead); d.setHours(hour, min, 0, 0); return d; };
  const fmt = (d) => `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth()+1} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  ...
}
```

**Formato de salida — CRÍTICO, no romper el contrato** (D-01: "cambio de superficie, no de plomería"). Hay DOS copias de la misma función en el código (evidencia de la falta de componente compartido — exactamente lo que esta fase soluciona):
- `_toDatetimeLocal` (app.js:10241-10244):
  ```javascript
  function _toDatetimeLocal(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  ```
- `_scheduleFormatDatetimeLocal` (app.js:4609-4612), usada por `#schedule-datetime` — MISMA lógica, MISMO output. El componente nuevo del calendario debe producir este string EXACTO (`YYYY-MM-DDTHH:mm`, sin segundos, sin timezone) y asignarlo a `input.value` — así los handlers existentes que leen `.value` directo (todos los `onclick` de confirmar) no necesitan tocarse.

**Todos los handlers que leen el `.value` del input tal cual hoy (no tocar su firma)**:
- `openCallbackModal` confirm (app.js:10207-10237): `const fecha = fechaInput.value; ... new Date(fecha).toISOString()`
- `openPlaceholderModal` confirm (app.js:10137-10161): `const when = fechaIn.value; ...`
- `openScheduleModal` confirm (app.js:10429-10454): `const fecha = document.getElementById('call-sched-fecha').value;`
- `agendar-confirm` listener (app.js:17908-17929): `const fecha = document.getElementById('agendar-fecha').value;`
- `schedule-submit-btn` listener (app.js:10 4629-10 4637 → real: 4629-4637): `const dtVal = document.getElementById('schedule-datetime').value; ... const when = new Date(dtVal);`

**Etiqueta relativa al confirmar (D-04)** — el cálculo YA EXISTE, casi textual a lo pedido ("Martes 18/08 · en 4 días · 10:00"). Copiar de `_dispoWhereToast` (app.js:8126-8143):
```javascript
const ts = /* timestamp elegido */;
const d = new Date(ts);
const hoy0 = new Date(); hoy0.setHours(0, 0, 0, 0);
const dias = Math.floor((ts - hoy0.getTime()) / 86400000);
const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const cuando = dias === 0 ? `hoy ${hora}`
  : dias === 1 ? `mañana ${hora}`
  : d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' }) + ` ${hora}`;
```
Complementar con el conteo "en N días" (no está armado en `_dispoWhereToast`, pero `dias` ya es ese número — solo falta el texto `en ${dias} días`). Ejemplo de agrupación por Hoy/Mañana/díaDD-MM ya usado en otro lugar (app.js:5901-5917, sección de follow-ups próximos):
```javascript
const todayKey = new Date().toISOString().substring(0, 10);
const tomorrowKey = new Date(now + 86400000).toISOString().substring(0, 10);
const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
...
if (key === todayKey) label = 'Hoy';
else if (key === tomorrowKey) label = 'Mañana';
else label = `${dayNames[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
```

**Hora local del lead (D-06)** — `_leadLocalTime` (app.js:7078-7102) es la base, pero **solo calcula "ahora"**, no una fecha/hora arbitraria elegida en el popover:
```javascript
const _LEAD_TZ = {
  'Argentina':'America/Argentina/Buenos_Aires', 'México':'America/Mexico_City', 'Mexico':'America/Mexico_City',
  'Colombia':'America/Bogota', 'Chile':'America/Santiago', 'Perú':'America/Lima', 'Peru':'America/Lima',
  'Uruguay':'America/Montevideo', 'Bolivia':'America/La_Paz', 'Ecuador':'America/Guayaquil',
  'España':'Europe/Madrid', 'Espana':'Europe/Madrid', 'Costa Rica':'America/Costa_Rica',
  'Estados Unidos':'America/New_York', 'USA':'America/New_York', 'Venezuela':'America/Caracas',
  'Brasil':'America/Sao_Paulo', 'Paraguay':'America/Asuncion', 'Panamá':'America/Panama',
  'Guatemala':'America/Guatemala', 'Honduras':'America/Tegucigalpa', 'El Salvador':'America/El_Salvador',
  'Nicaragua':'America/Managua',
};
function _leadLocalTime(lead) {
  const tz = _LEAD_TZ[(lead && lead.country || '').trim()];
  if (!tz) return null;
  try {
    const now = new Date();
    const time = now.toLocaleTimeString('es-AR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const hour = Number(now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).replace(/\D/g, '')) || 0;
    return { time, tz, ok: hour >= 9 && hour < 19 };
  } catch { return null; }
}
window._leadLocalTime = _leadLocalTime;
```
**Necesita una variante parametrizada por fecha** (mismo mapa `_LEAD_TZ`, mismo `toLocaleTimeString`/`toLocaleString` con `timeZone: tz`, pero recibiendo el `Date` elegido en vez de `new Date()`). Recomendado: extraer `_LEAD_TZ` a nivel compartido (ya está en `window._leadLocalTime`'s closure — exponerlo o replicar el mapa) y agregar `_leadLocalTimeAt(lead, date)` que reusa la misma lógica. **D-06 es explícito: sin avisos de color, solo mostrar** — no reusar el semáforo `lt.ok ? verde : ámbar` que sí usa el chip del Power Dialer (app.js:6483, `col = lt.ok ? '#5BB974' : '#FFB341'`); en el calendario NO pintar en ámbar, solo texto plano ("= 07:00 de él").

**Fuente del país del lead en cada punto de entrada** — confirmar que el objeto lead está disponible en closure en los 4 modales con lead asociado:
- `openCallbackModal(leadId)`: `_callsLeadsById.get(leadId)` ya se usa en handlers hermanos (`openScheduleModal` línea 10416); dentro de `openCallbackModal` conviene resolver `const lead = _callsLeadsById.get(leadId);` igual.
- `openPlaceholderModal(leadId)`: `const lead = _callsLeadsById.get(leadId);` (app.js:10102) — ya resuelto ahí mismo.
- `openScheduleModal(leadId, opts)`: `const lead = _callsLeadsById.get(leadId);` (app.js:10416) — ya resuelto.
- `openAgendarModal(lead)`: recibe el **objeto lead completo** como parámetro (app.js:17866), guardado en `_agendarLead` (app.js:17868) — usar `_agendarLead.country`.
- `#schedule-datetime` (WA parked, lead modal "Programar mensaje"): el lead se resuelve vía `currentModalLeadId` en el scope de `_openLeadModal`; hay una variable `lead` local a esa función (app.js:4557 `lead.openMessage`). Sin país asociado consistentemente probado — D-06 ya contempla este caso: "En los puntos de entrada sin lead asociado ... simplemente no se muestra."

**Carga por día (D-07)** — dos fuentes, ambas ya usadas juntas en un loader existente (`_mypLoadPipeline`, app.js:15834-15851):
```javascript
const [leadsR, calR] = await Promise.all([
  fetch(apiUrl('/api/setters/leads/sin-wsp?' + leadsParams.toString()), { credentials: 'include' }),
  fetch(apiUrl('/api/setters/calendar'), { credentials: 'include' }),
]);
const leads = (await leadsR.json()).leads || [];
let calendar = (await calR.json()).calendar || [];
```
Backend de `/api/setters/calendar` (index.js:12777-12785) — sin filtro de rango de fechas, devuelve TODO el calendar del setter (o del equipo si admin/supervisor sin scope), cada entry con campo `fecha` (string ISO) y `setterId`:
```javascript
app.get('/api/setters/calendar', requireAuth, (req, res) => {
  const data = loadSettersData();
  const calendar = data.calendar || [];
  const authSetterId = req.auth?.user?.role === 'setter' ? req.auth.user.setterId : '';
  const visibleSet = _visibleSetterIds(req.auth.user);
  let out = authSetterId ? calendar.filter((entry) => entry.setterId === authSetterId) : calendar;
  if (visibleSet) out = out.filter((entry) => visibleSet.has(entry.setterId));
  res.json({ calendar: out });
});
```
Para callbacks manuales, **NO hace falta ningún fetch nuevo** en los 3 contextos donde el popover se abre desde Llamadas/Power Dialer/Hoy: `callsLeadsCache`/`_callsLeadsById` (app.js:5413-5419) ya están en memoria con `callbackAt` por lead — recorrerlos y contar por día es O(n) local, sin latencia de red. Solo `/api/setters/calendar` necesita 1 fetch (se puede cachear en un `let` de módulo con invalidación simple, tipo TTL corto, ya que el popover puede abrirse varias veces en la sesión). **D-07 excluye explícitamente los reintentos automáticos de cadencia** (`no_answer`/`voicemail`) — filtrar por `callbackAt` presente Y último outcome del callLog === `callback_later` (mismo criterio que ya usa el backend para `manualCallbackByOwner`, documentado en CLAUDE.md nota #148 — no hace falta re-derivarlo del callLog en el cliente si ese campo ya viaja en la respuesta de `sin-wsp`).

---

### 2. Paneles arrastrables (`#telnyx-call-panel`, `#telnyx-script-panel`)

**Sin analog de drag** — confirmado: cero coincidencias de `mousedown`/`pointerdown`/`drag` en `public/app.js`. Hay que escribir el mecanismo desde cero (mousedown en el header → mousemove actualiza `left`/`top` → mouseup guarda). Referencias de estilo/estructura sí existen:

**HTML de los dos paneles** (ambos `position:fixed`, centrados con `top:50%;left:50%;transform:translate(...)`, sin id en su header — hay que agregarle uno para el drag handle):

`#telnyx-call-panel` (index.html:1317):
```html
<div id="telnyx-call-panel" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:420px; max-width:92vw; max-height:94vh; background:#11131A; border:1px solid rgba(157,133,242,0.6); border-radius:18px; box-shadow:0 40px 100px rgba(0,0,0,0.9), 0 0 0 1px rgba(157,133,242,0.3), 0 0 80px rgba(157,133,242,0.25); z-index:9999; overflow:hidden; font-family:inherit; animation:tlxScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1); flex-direction:column;">
  <!-- Header con avatar + status + timer (fijo arriba) -->
  <div style="flex-shrink:0; padding:18px 20px 14px; background:linear-gradient(180deg, rgba(157,133,242,0.16) 0%, rgba(157,133,242,0.04) 100%); border-bottom:1px solid rgba(255,255,255,0.06);">
    ...
```
(el header no tiene `id` — el agarre de D-09 necesita uno, ej. `id="telnyx-call-panel-header"`, o delegar por selector de hijo directo).

`#telnyx-script-panel` (index.html:1190):
```html
<div id="telnyx-script-panel" style="display:none; position:fixed; top:50%; left:50%; transform:translate(calc(-50% + 240px), -50%); width:460px; max-width:46vw; max-height:88vh; background:#11131A; border:1px solid rgba(157,133,242,0.4); border-radius:18px; box-shadow:0 40px 100px rgba(0,0,0,0.85), 0 0 0 1px rgba(157,133,242,0.2); z-index:9999; overflow:hidden; flex-direction:column; animation:tlxSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
  <div style="padding:13px 16px; border-bottom:1px solid rgba(255,255,255,0.06); background:linear-gradient(180deg, rgba(157,133,242,0.1) 0%, transparent 100%); display:flex; align-items:center; justify-content:space-between; gap:10px;">
    <div style="display:flex; align-items:center; gap:10px;">
      <strong style="font-size:13.5px; color:#fff; font-weight:600;">Guion de llamada</strong>
    </div>
    ...
```
Mismo caso: header sin `id`.

**El conflicto de D-11, exacto**. Regla CSS con `!important` (index.html:1461, dentro del `<style>` embebido justo después del script panel, líneas 1450-1466):
```css
/* Cuando el guion está abierto, el panel principal se mueve a la izquierda */
body.tlx-script-open #telnyx-call-panel { transform:translate(calc(-50% - 240px), -50%) !important; transition:transform 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
```
Se activa/desactiva SOLO por la clase en `<body>`, togglada en 3 puntos de `app.js`:
```javascript
// Cierre completo de la llamada — apaga el push (app.js:8992-8994)
const sp = document.getElementById('telnyx-script-panel');
if (sp) sp.style.display = 'none';
document.body.classList.remove('tlx-script-open');

// Abrir guion (app.js:9834-9841)
function _openScriptPanel() {
  const panel = document.getElementById('telnyx-script-panel');
  if (panel) panel.style.display = 'flex';
  document.body.classList.add('tlx-script-open');   // ← dispara el push del call-panel
  ...
}
// Cerrar guion (app.js:9842-9846)
function _closeScriptPanel() {
  const panel = document.getElementById('telnyx-script-panel');
  if (panel) panel.style.display = 'none';
  document.body.classList.remove('tlx-script-open'); // ← apaga el push
}
```
**No hay NINGÚN otro lugar donde se toque `.style.left/top/transform` de estos paneles vía JS** (confirmado por grep) — hoy el posicionamiento es 100% CSS. D-11 exige: mientras no haya posición guardada, este empuje sigue funcionando tal cual; apenas el user arrastra, su posición manda **y el empuje deja de aplicarle a ESE panel**. Dos vías técnicas coherentes con lo que ya hay:
  1. Condicionar la regla CSS a una clase adicional en el panel (ej. `body.tlx-script-open #telnyx-call-panel:not(.tlx-dragged) { ... !important }`) — el drag le agrega `.tlx-dragged` al panel la primera vez que se suelta.
  2. Usar `panel.style.setProperty('transform', valor, 'important')` desde JS al restaurar posición — un `!important` en `style` inline gana siempre sobre un `!important` de hoja de estilos, sin tocar la regla existente.
  Cualquiera de las dos es viable; **la vía 1 es más legible y no depende de setProperty con 'important' (menos común, más fácil de pasar por alto en un review)**.

**Apertura del panel de llamada** (dónde se muestra, para saber cuándo aplicar la posición restaurada) — `_startTelnyxCall` (app.js:9230-9259, extracto):
```javascript
const panel = document.getElementById('telnyx-call-panel');
...
panel.style.display = 'flex'; // flex column: header fijo + medio scrolleable + footer fijo
document.body.classList.add('has-active-call');
```
La posición guardada debe aplicarse en este punto (y en `_openScriptPanel` para el panel de guiones) — ANTES o justo después de `style.display = 'flex'`, para que no haya salto visual (el "bug anticipado" que menciona D-11).

**Persistencia con clave por usuario** — patrón exacto a replicar (3 ejemplos ya en el código):
```javascript
// app.js:6032
function _pdAutopilotKey() { return 'pd_autopilot_' + (currentUser?.id || 'anon'); }

// app.js:5784, 5807, 10489 (selector de setter en Llamadas)
localStorage.getItem('calls_setter_filter_' + (currentUser?.id || 'anon'))
localStorage.setItem('calls_setter_filter_' + (currentUser?.id || 'anon'), e.target.value || '');

// app.js:5511 (selector de setter en Hoy)
localStorage.setItem('scm_hoy_setter_' + (u.id || ''), sel.value);
```
Para los dos paneles: algo como `'tlx_panel_pos_call_' + (currentUser?.id || 'anon')` y `'tlx_panel_pos_script_' + (currentUser?.id || 'anon')`, guardando `{left, top}` en JSON (`JSON.stringify`/`JSON.parse`, ya usado en otros localStorage del proyecto, ej. app.js:848 `scm_cb_notified_<userId>`).

**Clamping al viewport (Claude's Discretion, D-10 pide "botón para volver al centro")** — no hay analog directo; usar `window.innerWidth/innerHeight` + el `getBoundingClientRect()` del panel al soltar el drag, análogo conceptualmente a como `_pdStartAutopilotCountdown` inyecta un botón dinámico con `onclick` inline apuntando a un handler en `window` (app.js:6053-6058, `banner.innerHTML = ...<button ... onclick="window._pdCancelAutopilotNow()">...`) — mismo patrón de "botón inyectado con handler en window" sirve para el botón "volver al centro".

**Animaciones existentes a respetar** (no romper al agregar drag): `tlxScaleIn` (panel de llamada) y `tlxSlideIn` (panel de guion), definidas en el `<style>` embebido (index.html:1451-1454). El drag debe dejar de aplicar `transform:translate(-50%,-50%)` centrado una vez que hay posición propia (o mantenerlo con `left`/`top` reales del punto donde se soltó, según cómo se implemente el cálculo) — cualquiera de las dos formas es válida, pero **debe decidirse antes de tocar la regla `!important`** porque cambia qué lee esa regla.

---

## Shared Patterns

### Diseño / tokens (Design System v1.1)
**Fuente:** `public/style.css:9-38`
```css
--bg-app: #0F1115;
--bg-surface: #161922;
--bg-input: #11141B;
--border-subtle: #1F2433;
--border-default: #262B3B;
--text-primary: #E5E7E2;
--text-secondary: #B4B8C2;
--text-tertiary: #7E8494;
--accent: #9D85F2;
--success: #4ADE80;
```
**Aplica a:** ambos componentes nuevos — el popover de calendario y los paneles arrastrables (que YA usan estos tokens vía CSS embebido/inline).

### Segmented control (para navegación de mes o toggle "Atajos / Calendario")
**Fuente:** `public/style.css:1885-1913`
```css
.seg-control { display:inline-flex; gap:2px; padding:3px; border-radius:10px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); flex-wrap:wrap; }
.seg-btn { padding:5px 12px; font-size:11px; font-weight:500; border-radius:7px; border:1px solid transparent; background:transparent; color:var(--text-secondary); cursor:pointer; font-family:inherit; transition:color 0.15s, background 0.15s; white-space:nowrap; }
.seg-btn:hover { color:var(--text-primary); }
.seg-btn.active { background:rgba(157,133,242,0.16); border-color:rgba(157,133,242,0.35); color:var(--accent); font-weight:600; }
```
**Aplica a:** navegación entre meses del calendario / cualquier toggle chico dentro del popover.

### Grid de botones (referencia visual para celdas de día / franjas horarias)
**Fuente:** `public/style.css:4724-4734` (dialpad 3×4, mismo espíritu: grid de botones cuadrados con hover/active)
```css
.dialpad-key {
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:12px 0; background:var(--bg-app); border:1px solid var(--border-color);
  border-radius:12px; color:var(--text-primary); font-size:20px; font-weight:600;
  cursor:pointer; font-family:inherit; user-select:none;
  transition:background 0.12s, transform 0.05s, border-color 0.12s;
}
.dialpad-key:hover { background:var(--surface-color); border-color:var(--accent); }
.dialpad-key:active { transform:scale(0.95); background:rgba(157,133,242,0.15); }
```
**Aplica a:** celdas del mes del calendario (grid 7 columnas) — mismo lenguaje visual (fondo `--bg-app`, borde sutil, hover con `--accent`).

### Botón secundario chico
**Fuente:** `public/style.css:2078-2095` (`.hoy-ficha-btn`)
```css
.hoy-ficha-btn { background:transparent; color:var(--text-secondary); border:1px solid var(--border-default, rgba(255,255,255,0.14)); padding:6px 13px; border-radius:9px; font-weight:600; font-size:12px; cursor:pointer; white-space:nowrap; font-family:inherit; transition:color 0.15s ease, border-color 0.15s ease, background 0.15s ease; }
.hoy-ficha-btn:hover { color:var(--text-primary); border-color:var(--accent); background:rgba(157,133,242,0.08); }
```
**Aplica a:** botón "Volver al centro" del panel arrastrado (D-10) y cualquier acción secundaria dentro del popover del calendario.

### Modal base (si se opta por popover como mini-modal centrado)
**Fuente:** `public/style.css:2634-2708`
```css
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; padding:var(--space-6); animation:fadeIn 150ms ease-out; }
.modal-card { background:var(--bg-surface); border:1px solid var(--border-default); border-radius:var(--radius-xl); max-width:920px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:var(--shadow-lg); animation:scaleIn 250ms ease-out; }
.modal-header { display:flex; align-items:center; justify-content:space-between; padding:var(--space-5) var(--space-6); border-bottom:1px solid var(--border-subtle); }
.modal-body { padding:var(--space-6); display:flex; flex-direction:column; gap:var(--space-4); }
```

### Cache-buster — OBLIGATORIO en este cambio
**Fuente:** `public/index.html:14, 3611-3612`
```html
<link rel="stylesheet" href="/style.css?v=20260728a">
...
<script type="module" src="/app.js?v=20260812a"></script>
<script type="module" src="/wa.js?v=20260705a"></script>
```
**Aplica a:** cualquier edit a `app.js`, `style.css` o `index.html` en esta fase — bumpear el `?v=` correspondiente en `index.html`, sin excepción (CLAUDE.md regla #48 y gotcha documentado del cache invisible).

---

## No Analog Found

| Componente | Role | Data Flow | Razón |
|---|---|---|---|
| Grid de mes del calendario (7 columnas, navegación entre meses) | component | transform | UI genuinamente nueva — no existe ningún calendario/grid de fechas en el repo (se buscó explícitamente). Usar los tokens y `.dialpad-key`/`.seg-control` como referencia visual, no como copia literal. |
| Mecánica de drag (mousedown→mousemove→mouseup, clamp al viewport) | component (event-driven) | event-driven | Cero código de drag en todo `app.js` (grep confirmado: sin `mousedown`, `pointerdown`, ni `drag`). Implementar desde cero con eventos de mouse/pointer nativos. |
| `_leadLocalTime` parametrizado por fecha arbitraria (variante para D-06) | utility | transform | La función existente solo calcula "ahora" (`new Date()` hardcodeado adentro). Hace falta una variante — mismo mapa `_LEAD_TZ`, mismo mecanismo `toLocaleTimeString`/`toLocaleString` con `timeZone`, pero recibiendo el `Date` del popover en vez de instanciar uno nuevo. |

## Metadata

**Analog search scope:** `public/app.js` (19619 líneas), `public/index.html` (3614 líneas), `public/style.css` (4901 líneas), `index.js` (endpoint `/api/setters/calendar`).
**Archivos leídos con targeted reads (offset/limit) por ser >2000 líneas:** app.js (múltiples rangos no solapados: 2820-2875, 4530-4660, 5395-5460, 5670-5760, 5890-5920, 6025-6070, 6276-6300, 7060-7105, 8120-8200, 8960-9010, 9210-9260, 9815-9870, 9964-9970 [descarte], 10060-10500, 15820-15855, 17845-17945, 18830-18845), style.css (1880-1925, 2630-2710, 4700-4745), index.js (12777-12816).
**Pattern extraction date:** 2026-08-14.
