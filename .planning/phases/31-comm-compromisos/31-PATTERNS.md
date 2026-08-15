# Phase 31: COMM — Compromisos como objeto - Pattern Map

**Mapped:** 2026-08-15
**Files analyzed:** 2 (monolito: `index.js`, `public/app.js`) + `public/index.html`
(markup de modal — no hay archivos nuevos: esta fase EXTIENDE código que las
Phases 29/30 ya construyeron, mismo patrón que documenta `30-PATTERNS.md`)
**Analogs found:** 10 / 10 regiones (todas exact-match o role-match dentro de
los mismos 3 archivos — no falta ningún analog externo)

**Nota de alcance:** COMM-01..04 no crea archivos nuevos. Es quirúrgico sobre
`index.js` (whitelists junto a `NEXT_ACTION_*`, `ensureLeadDefaults`,
`_applyCallOutcome`, `call-disposition`, un endpoint nuevo tipo `PATCH
.../followup`) y `public/app.js` (`#call-next-modal`/`openNextStepModal`,
`_callsRenderExpandedPanel`, `loadHoyView`, la timeline del lead). La tabla de
clasificación usa "regiones" dentro de los 3 archivos, igual que Phase 30.

**Léase junto con `.planning/phases/30-gate-proximo-paso/30-PATTERNS.md`**:
el patrón de "propuesta editable con calendario + quickpicks" y el mecanismo
de gate no-bloqueante que documenta ese archivo se REUSAN acá tal cual — no
se repiten en detalle, solo se referencian donde aplica.

## File Classification

| Región a modificar/crear | Archivo | Rol | Data Flow | Analog más cercano | Calidad |
|---|---|---|---|---|---|
| Whitelists `COMMITMENT_TIPOS`/`COMMITMENT_PARTES`/`COMMITMENT_ESTADOS` (D-02/D-03/D-04) | `index.js` | config/whitelist | n/a | `NEXT_ACTION_TIPOS`/`NEXT_ACTION_CANALES`/`NEXT_ACTION_ORIGENES` (~10974-10991) | exact |
| `ensureLeadDefaults`: inicializar `lead.commitment = null` | `index.js` | model (defaults) | n/a | guard de `lead.nextAction` en la misma función (línea 657) | exact |
| Mapa D-06 (tipo de compromiso → delta/canal del próximo paso) | `index.js` | config/whitelist | n/a | `GATE_INTERESADO_DELTA_MS`/`GATE_CADENCIA_DELTA_MS`/`GATE_PLACEHOLDER_DELTA_MS` (~11017-11026) + `NEXT_ACTION_TEMPLATES` (~10996-11002) | exact |
| Helpers `_setCommitment`/`_closeCommitment` (D-05: setea `nextAction` con `origen:'compromiso'`; D-07: al cerrar, limpia el `nextAction` SOLO si vino de ese compromiso) | `index.js` | service (helper puro) | event-driven | `_setNextAction`/`_clearNextAction` (~11063-11088) + rama de destildado de `PATCH .../followup` (~10332-10343, mismo idioma "solo apagar si es el mío") | exact |
| `POST /api/setters/leads/:id/call-disposition` — aceptar `commitment` en el body (D-08) | `index.js` | controller/route | request-response | `nextAction`/`_gateSanitizeNextActionOverride` en el mismo endpoint (~11036-11050, ~11460-11469, ~11596-11608) | exact |
| Endpoint nuevo `PATCH /api/setters/leads/:id/commitment` (D-09: cargar/cerrar un compromiso fuera de una llamada) | `index.js` | controller/route | request-response | `PATCH /api/setters/leads/:id/followup` (~10288-10363) — mismo shape: auth de dueño/visibilidad, `ensureLeadDefaults`, whitelist de `step`/`tipo`, `saveSettersData` síncrono | exact |
| Extender `#call-next-modal`/`openNextStepModal` con selector de tipo de compromiso (D-08) | `public/app.js` + `public/index.html` | component | request-response | el propio modal (~11033-11128 en `app.js`, ~1573-1598 en `index.html`) + bloque `[30-02] GATE-PURE` (~11279-11312) | exact |
| Bloque "Compromiso" editable en la ficha del lead (D-09) | `public/app.js` | component | request-response | bloque "Follow-up programado" dentro de `_callsRenderExpandedPanel` (~7977-7980) + `_callsToggleFollowup` (~7687-7710) | exact |
| Sección "Compromisos" dentro de Hoy (D-10) | `public/app.js` | component | request-response (deriva client-side de una fetch ya existente) | secciones "Callbacks"/"Interesados sin agendar" de `loadHoyView`/`_hoyRenderSection` (~5966-6016, ~6056-6100) | exact |
| Historial de compromisos cerrados en el timeline del lead (D-11) | `public/app.js` | component (read-only) | request-response | `_renderCallHistory` (timeline unificada llamadas+notas, ~9735-9768) y/o `historyHtml`/`notesHtml` dentro de `_callsRenderExpandedPanel` (~7878-7937) | role-match (dos timelines existentes distintas, ver nota en Pattern Assignments) |

## Pattern Assignments

### `index.js` — Whitelists del compromiso (D-02/D-03/D-04)

**Analog:** `NEXT_ACTION_TIPOS`/`NEXT_ACTION_CANALES`/`NEXT_ACTION_ORIGENES`,
`index.js:10974-10991` (mismo bloque donde vive el comentario "Whitelists,
mismo idioma que CALL_OUTCOMES/DISQUALIFY_REASONS").

```javascript
// index.js:10973-10991 — patrón exacto a copiar
const NEXT_ACTION_TIPOS = new Set([
  'callback', 'cadencia', 'enviar_info', 'esperar_respuesta', 'otro',
]);
const NEXT_ACTION_CANALES = new Set(['llamada', 'whatsapp', 'email', '']);
const NEXT_ACTION_ORIGENES = new Set([
  'manual', 'cadencia',
  'compromiso',  // Phase 31: compromiso hablado durante la llamada — YA reservado, no tocar el nombre.
]);
```

**Whitelists nuevas que este plan agrega** (mismo idioma, `Set` con
comentario por valor — ver `DISQUALIFY_REASONS`, `index.js:11428-11439`,
como segundo ejemplo del mismo patrón):
```javascript
// D-02: tipos de compromiso — whitelist estricta
const COMMITMENT_TIPOS = new Set([
  'enviar_info', 'hablar_con_socio', 'llamar_despues',
  'pensarlo', 'pedir_presupuesto', 'otro',
]);
// D-03: de quién es la tarea
const COMMITMENT_PARTES = new Set(['yo', 'prospecto']);
// D-04: pendiente → cumplido | incumplido | vencido
const COMMITMENT_ESTADOS = new Set(['pendiente', 'cumplido', 'incumplido', 'vencido']);
```
⚠️ `COMMITMENT_TIPOS` reusa 4 de sus 5 nombres de negocio, pero NO es lo
mismo que `NEXT_ACTION_TIPOS` (ese es `callback|cadencia|enviar_info|
esperar_respuesta|otro` — el "qué hacer con el reloj"). Son dos vocabularios
distintos que conviven: uno describe el compromiso (D-02), el otro el
reloj que ese compromiso setea (D-05).

---

### `index.js` — `ensureLeadDefaults` (dónde se inicializa `commitment`)

**Analog:** el guard de `nextAction` en la misma función, `index.js:653-657`
— MISMO criterio (`undefined`, no falsedad, porque `null` es un valor con
significado propio: "sin compromiso pendiente").

```javascript
// index.js:653-657 — patrón EXACTO a replicar para lead.commitment
// Phase 29 (D-01): el reloj único de próxima acción. Guard por `undefined`,
// NO por falsedad — `null` es un valor CON significado ("el lead no tiene
// próximo paso"). Un guard estilo `if (!lead.x)` lo estaría re-escribiendo
// a `null` en cada load aunque ya tuviera un objeto escrito.
if (lead.nextAction === undefined) lead.nextAction = null;
```

Commitment queda un `if (lead.commitment === undefined) lead.commitment =
null;` inmediatamente al lado (la ubicación exacta dentro de la función
queda a discreción del planner, pero debe ir cerca de `nextAction` por
cohesión — CLAUDE.md documenta esta zona como "Phase 29 (D-01)").

---

### `index.js` — Mapa D-06 (tipo de compromiso → próximo paso)

**Analog:** las constantes `GATE_*_DELTA_MS` de la Phase 30,
`index.js:11011-11026` — mismo idioma: derivar SIEMPRE de
`NEXT_ACTION_TEMPLATES` cuando la duración coincide con una plantilla
existente, y declarar una constante nueva solo cuando no hay match.

```javascript
// index.js:11017-11026 — patrón a replicar
// D-03: la cadencia sugerida por el research para un interesado que no
// avanza es día 1/3/7/14 — este +3 días es el primer paso de esa cadencia...
const GATE_INTERESADO_DELTA_MS = 3 * 24 * 60 * 60 * 1000;

// Reintento tras un 1er corte ("Me cortó"): misma duración que la cadencia
// de no-contacto. DERIVADA de NEXT_ACTION_TEMPLATES (única fuente) — nunca
// escribir 24*3600000 a mano acá.
const GATE_CADENCIA_DELTA_MS = NEXT_ACTION_TEMPLATES.find((t) => t.key === '24hs').deltaMs;

// Hold de calendario (send-placeholder): espera de respuesta +48h.
const GATE_PLACEHOLDER_DELTA_MS = NEXT_ACTION_TEMPLATES.find((t) => t.key === '48hs').deltaMs;
```

**Aplicado al mapa D-06 del CONTEXT** — 3 de las 5 duraciones YA EXISTEN
como plantilla o constante reusable, solo falta una:
```javascript
// enviar_info (parte yo) → seguimiento +48h si no responde: reusa la
// plantilla que YA existe (misma que GATE_PLACEHOLDER_DELTA_MS).
const COMMITMENT_ENVIAR_INFO_DELTA_MS = NEXT_ACTION_TEMPLATES.find((t) => t.key === '48hs').deltaMs;
// pensarlo / pedir_presupuesto → +3 días: reusa GATE_INTERESADO_DELTA_MS
// literal (mismo valor semántico "el próximo paso de un interesado que no cerró").
// hablar_con_socio → +5 días: NO hay plantilla ni constante existente con
// este valor — es la ÚNICA duración nueva que este plan necesita declarar.
const COMMITMENT_SOCIO_DELTA_MS = 5 * 24 * 60 * 60 * 1000;
// llamar_despues → "la fecha pactada": NO es un delta fijo, es una fecha que
// el user elige — mismo patrón que el case 'callback_later' de
// _applyCallOutcome (index.js:11228-11242, variable local `_cbDueAt` con
// fallback a +24h si no vino nada).
```

---

### `index.js` — `_setNextAction`/`_clearNextAction` (API real, NO inventar nombres)

**Analog:** las funciones mismas, `index.js:11055-11088`. `_setCommitment`/
`_closeCommitment` (o los nombres que el planner elija) DEBEN llamar a estas,
nunca reimplementar el espejo `callbackAt`.

```javascript
// index.js:11059-11081 — escribe lead.nextAction y espeja lead.callbackAt.
// NUNCA lanza. spec = {tipo, dueAt, canal, motivo, origen, createdBy}.
function _setNextAction(lead, spec, nowIso) {
  const s = spec && typeof spec === 'object' ? spec : {};
  if (typeof s.dueAt !== 'string' || !s.dueAt) { _clearNextAction(lead); return null; }
  const tipo = NEXT_ACTION_TIPOS.has(s.tipo) ? s.tipo : 'otro';
  const canal = NEXT_ACTION_CANALES.has(s.canal) ? s.canal : '';
  const origen = NEXT_ACTION_ORIGENES.has(s.origen) ? s.origen : 'manual';
  const motivo = typeof s.motivo === 'string' ? s.motivo.slice(0, 200) : '';
  const createdBy = typeof s.createdBy === 'string' ? s.createdBy.slice(0, 80) : '';
  const createdAt = typeof nowIso === 'string' && nowIso ? nowIso : new Date().toISOString();
  lead.nextAction = { tipo, dueAt: s.dueAt, canal, motivo, origen, createdAt, createdBy };
  lead.callbackAt = s.dueAt; // espejo D-03, asignación LITERAL
  return lead.nextAction;
}
function _clearNextAction(lead) { lead.nextAction = null; lead.callbackAt = ''; }
```

**D-05 aplicado** — al crear un compromiso pendiente:
```javascript
// dentro de _setCommitment(lead, spec, nowIso), DESPUÉS de escribir lead.commitment:
_setNextAction(lead, {
  tipo: 'callback',              // el reloj sigue siendo 'callback' (NEXT_ACTION_TIPOS) —
                                   // el compromiso (COMMITMENT_TIPOS) es el "por qué", no el "qué hacer".
  dueAt: /* del mapa D-06 según spec.tipo */,
  canal: /* del mapa D-06 según spec.tipo */,
  motivo: `compromiso: ${spec.tipo}`,
  origen: 'compromiso',           // YA reservado en NEXT_ACTION_ORIGENES — no inventar otro valor.
  createdBy: spec.createdBy || '',
}, nowIso);
```

**D-07 aplicado** — al cerrar un compromiso (cumplido/incumplido), limpiar el
`nextAction` SOLO si vino de él. Mismo idioma exacto que la rama de
destildado de `PATCH .../followup`:
```javascript
// index.js:10337-10343 — patrón EXACTO a replicar para _closeCommitment
// Destildar un checkbox no puede borrar un compromiso pactado por OTRA
// vía (p.ej. un callback manual pactado por teléfono en una disposición).
// Solo se apaga el nextAction vigente si ES el que este endpoint creó.
const na = lead.nextAction;
if (na && na.origen === 'manual' && typeof na.motivo === 'string' && na.motivo.startsWith('follow-up ')) {
  _clearNextAction(lead);
}
// → para commitment: if (na && na.origen === 'compromiso') _clearNextAction(lead);
// (más simple: origen:'compromiso' es un valor exclusivo del compromiso, no
// hace falta chequear un prefijo de motivo como con followUps.)
```

---

### `index.js` — `POST /api/setters/leads/:id/call-disposition` (D-08: cargar el compromiso al cerrar una llamada)

**Analog:** el propio endpoint, `index.js:11442-11640`. Mismo lugar exacto
donde 30-01 sumó el override de `nextAction` — `commitment` se agrega AL
LADO, mismo tratamiento.

```javascript
// index.js:11460 — destructuring del body, agregar `commitment` a la lista:
const { outcome, notes, callbackAt, scheduled, telnyxCallMeta, objectionTags,
        disqualifyReason, doNotCall, callbackShared, autoMarked,
        correctsAutoMarked, pendingCallId, nextAction } = req.body || {};
// → sumar `, commitment` acá.
```

```javascript
// index.js:11466-11469 — sanitización whitelist-and-coerce, MISMO patrón
// (nunca 400, nunca lanza) para el commitment nuevo:
const cleanNextActionOverride = _gateSanitizeNextActionOverride(nextAction);
// → const cleanCommitment = _sanitizeCommitment(commitment); (función nueva,
//   mismo idioma que _gateSanitizeNextActionOverride: index.js:11036-11050 —
//   valida `tipo` contra COMMITMENT_TIPOS, `parte` contra COMMITMENT_PARTES,
//   trunca `motivo`, devuelve null si no es un objeto válido.)
```

```javascript
// index.js:11596-11608 — el punto único de wiring hacia _applyCallOutcome:
const { calendarEntry } = _applyCallOutcome(data, lead, logEntry, {
  leadId: req.params.id, nowIso: now, outcome, callbackAt, callbackShared,
  scheduled, cleanReason, doNotCall,
  actorSetterId: req.auth?.user?.role === 'setter' ? req.auth.user.setterId : (lead.assignedTo || ''),
  actorName: req.auth?.user?.name || '',
  nextActionOverride: cleanNextActionOverride,
  // → sumar: commitment: cleanCommitment,
});
```
Dentro de `_applyCallOutcome` (`index.js:11154-11396`), el punto de
aplicación del `commitment` debe ir en la MISMA precedencia que documenta el
comentario de la Phase 30 (`index.js:11367-11376`): **después** de los
defaults por outcome/cadencia, **antes** de la red de seguridad — un
compromiso explícito del user siempre gana sobre un default automático.

---

### `index.js` — Endpoint nuevo `PATCH /api/setters/leads/:id/commitment` (D-09: editar/cerrar desde la ficha)

**Analog:** `PATCH /api/setters/leads/:id/followup`, `index.js:10288-10363`
completo — mismo shape de punta a punta: auth de dueño + visibilidad,
`ensureLeadDefaults`, whitelist del campo variable, mutación síncrona,
`saveSettersData` sin mutex (no hay `await` en el medio).

```javascript
// index.js:10288-10297 — cabecera del endpoint: auth + visibilidad
app.patch('/api/setters/leads/:id/followup', requireAuth, (req, res) => {
  const { step, value } = req.body || {};
  const data = loadSettersData();
  const lead = data.leads[req.params.id];
  if (!lead) return res.status(404).json({ error: "Lead no encontrado." });
  if (req.auth?.user?.role === 'setter' && lead.assignedTo !== req.auth.user.setterId) {
    return res.status(403).json({ error: "No autorizado para este lead." });
  }
  { const visibleSet = _visibleSetterIds(req.auth.user); if (visibleSet && !_setterIsVisible(lead.assignedTo, visibleSet)) return res.status(403).json({ error: 'Lead fuera de tu visibilidad.' }); }
  ensureLeadDefaults(lead);
  const valid = ['24hs', '48hs', '72hs', '7d', '15d'];
  if (step === undefined || !valid.includes(step)) {
    return res.status(400).json({ error: "Step inválido." });
  }
```
`PATCH .../commitment` copia este bloque literal (mismo 404/403/403-visibilidad),
cambia el whitelist-check final por `COMMITMENT_TIPOS`/`COMMITMENT_PARTES` y
soporta dos acciones por body: crear/reemplazar (`{tipo, parte, canal?,
motivo?, dueAt?}` — si `dueAt` no viene, se calcula del mapa D-06) o cerrar
(`{estado:'cumplido'|'incumplido'}`).

```javascript
// index.js:10354-10363 — guardado y respuesta, patrón estándar del proyecto
saveSettersData(data);
res.json({
  ok: true,
  followUps: lead.followUps,
  // → equivalente: commitment: lead.commitment, nextAction: lead.nextAction
});
```

---

### `public/app.js` + `public/index.html` — Extender `#call-next-modal`/`openNextStepModal` (D-08)

**Analog:** el modal y su función completos — `index.html:1573-1598`,
`app.js:11033-11128`. Este modal HOY solo se abre para `answered_interested`
(ruteado desde `_handleCallDisposition`, `app.js:10797-10809`); D-08 pide
sumar un selector de tipo de compromiso DENTRO de él, no un modal nuevo
("sumar un segundo paso al cierre de una llamada es exactamente la fricción
que hace que la gente no lo use" — CONTEXT.md D-08).

```html
<!-- index.html:1573-1598 — estructura exacta a extender -->
<div id="call-next-modal" class="modal-overlay hidden" style="z-index:10000;">
  <div class="modal-card" style="max-width:420px; width:95vw;">
    <div class="modal-header">
      <h3>Próximo paso</h3>
      <button ... onclick="document.getElementById('call-next-modal').classList.add('hidden')">✕</button>
    </div>
    <div style="padding:20px 24px;">
      <p>El lead queda en <strong>Hoy → Interesados</strong>. ...</p>
      <label>Atajos</label>
      <div id="call-next-quickpicks" ...></div>
      <label>O fecha exacta</label>
      <input type="datetime-local" id="call-next-fecha" ...>
      <label>Motivo (opcional)</label>
      <input type="text" id="call-next-motivo" maxlength="200" ...>
      <div style="display:flex; gap:10px; ...">
        <button ...>Cancelar</button>
        <button class="btn-primary pill-btn" id="call-next-confirm">Guardar</button>
      </div>
    </div>
  </div>
</div>
```
Un `<select id="call-next-commitment-tipo">` (opciones = `COMMITMENT_TIPOS` +
una opción "Sin compromiso específico") entre el párrafo y los atajos es el
punto de inserción natural — al cambiar de tipo, la fecha propuesta se
recalcula con el mapa D-06 (mismo mecanismo que ya usan los atajos: repintar
`fechaInput.value` + `_dtPickerSync(fechaInput)`).

```javascript
// app.js:11033-11128 — openNextStepModal completo. Puntos de extensión:
function openNextStepModal(leadId) {
  const lead = _callsLeadsById.get(leadId);
  // ...
  fechaInput.value = _toDatetimeLocal(_gateInteresadoDefaultDate(new Date()));
  // [28-02] Calendario propio (D-01): reemplaza el datetime-local nativo.
  _dtPickerAttach(fechaInput, { getLead: () => _callsLeadsById.get(leadId) });
  // D-03: atajos con la cadencia sugerida (1/3/7/15 días)...
  const picks = _gateInteresadoPicks(new Date());
  // ...
  confirmBtn.onclick = async () => {
    // ...
    const body = {
      outcome: 'answered_interested',
      nextAction: { dueAt: dueAtIso, tipo: 'callback', canal: 'llamada', motivo },
      ..._dispoEnforcementBody(leadId),
      // → sumar: commitment: { tipo: commitmentTipoSelect.value, parte: 'yo'|'prospecto', ... }
      //   (solo si el user eligió un tipo específico — "sin compromiso" no manda nada)
    };
    // ...
  };
}
```

**Bloque puro `[30-02] GATE-PURE`** (`app.js:11279-11312`) — mismo patrón de
marcadores a replicar para las funciones de fecha del compromiso (delta por
tipo, picks por tipo). Extraíble por tests con `new Function`, sin DOM ni red:
```javascript
// app.js:11287-11291 — patrón exacto para _commitmentDefaultDate(tipo, now)
const GATE_INTERESADO_DELTA_MS = 3 * 24 * 60 * 60 * 1000;
function _gateInteresadoDefaultDate(now) {
  return new Date(now.getTime() + GATE_INTERESADO_DELTA_MS);
}
```

⚠️ **D-08 dice "el modal se abre al marcar Interesado"** — pero el mapa D-06
incluye compromisos que también tienen sentido en un `callback_later` (ej.
"llamar_despues" es literalmente lo mismo que `callback_later` con un motivo
tipado) o incluso sin cambiar el outcome de la llamada. Es decisión del
planner si el selector de compromiso vive SOLO en `#call-next-modal` (atado a
`answered_interested`) o si también se ofrece en `openCallbackModal`
(`app.js:10768-10846` según 30-PATTERNS, mismo modal "Volver a llamar
después") — el CONTEXT no lo resuelve explícito, y ambos modales comparten
estructura (`cb-quickpick`, `_dtPickerAttach`).

---

### `public/app.js` — Bloque "Compromiso" en la ficha del lead (D-09)

**Analog:** el bloque "Follow-up programado" completo dentro de
`_callsRenderExpandedPanel`, `app.js:7977-7980` (markup) +
`window._callsToggleFollowup`, `app.js:7687-7710` (handler).

```javascript
// app.js:7977-7980 — markup a replicar (columna derecha de la ficha,
// entre "Nota pre-call" y "Notas")
<h4 class="call-detail-section-title">Follow-up programado</h4>
<div class="call-followups">
  ${fupSteps.map(s => `<button class="call-fup-chip${fups[s.key] ? ' is-on' : ''}" onclick="window._callsToggleFollowup('${escHtml(l.id)}', '${s.key}')">${s.label}</button>`).join('')}
</div>
${dueText ? `<div class="call-fup-due">${dueText}</div>` : ''}
```

```javascript
// app.js:7687-7710 — handler completo a replicar para _callsSetCommitment/_callsCloseCommitment
window._callsToggleFollowup = async function(leadId, step) {
  try {
    const r = await fetch(apiUrl('/api/setters/leads/' + leadId + '/followup'), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const lead = _callsLeadsById.get(leadId);
    if (lead) { lead.followUps = d.followUps; lead.followUpStartedAt = d.followUpStartedAt; }
    _refreshLeadPanels(leadId);
    // Feedback explícito: es un toggle y sin aviso el SDR no sabe si quedó
    // puesto o quitado (y vuelve a clickear, apagándolo).
    window.showToast?.(/* ... */, { type: /* success|info */, duration: 2000 });
  } catch (e) {
    window.showToast?.('Error guardando follow-up: ' + e.message, { type: 'error' });
  }
};
```
⚠️ Nota #175 de CLAUDE.md (bug real ya arreglado): un toggle sin feedback
visible + sin refresco del modal de Hoy hace que el SDR reintente y
DESHAGA lo que acababa de poner. Cualquier control nuevo de compromiso en
la ficha DEBE terminar en `_refreshLeadPanels(leadId)` (`app.js:6156-6159`,
que hace `renderCallsList()` + `window._hoyRefreshFicha?.(leadId)`) — nunca
solo mutar el cache y listo.

**Estados del compromiso (D-04, cumplido/incumplido) piden botones de
cierre** — mismo patrón visual que el botón "Reactivar lead"
(`app.js:7952-7954`, dentro de `call-action-row`) o los chips `call-fup-chip`
de arriba, a discreción del planner.

---

### `public/app.js` — Sección "Compromisos" en Hoy (D-10)

**Analog:** las secciones "Callbacks" e "Interesados sin agendar" completas
dentro de `loadHoyView`, `app.js:5966-6016`, y su función de render
`_hoyRenderSection`, `app.js:6056-6100`.

```javascript
// app.js:5966-5983 — patrón de derivación client-side sobre el MISMO array
// de leads que loadHoyView ya trae de GET /leads/sin-wsp?include=callable
// (D-10: "no una vista nueva" — Hoy ya tiene el fetch que necesita).
const callbacks = leads.filter(l => notDnc(l) && l.callbackAt && new Date(l.callbackAt).getTime() <= endTodayTs && lastOutcome(l) === 'callback_later')
  .sort((a, b) => new Date(a.callbackAt) - new Date(b.callbackAt));
callbacks.forEach(l => claimed.add(l.id));
const interesados = leads.filter(l => !claimed.has(l.id) && notDnc(l) && l.estado === 'interesado');
interesados.forEach(l => claimed.add(l.id));
// → sumar: const misCompromisos = leads.filter(l => l.commitment && l.commitment.parte === 'yo' && l.commitment.estado === 'pendiente');
//          const suyos = leads.filter(l => l.commitment && l.commitment.parte === 'prospecto' && l.commitment.estado === 'pendiente');
//          (D-10: agrupados por parte, los míos primero — "son deuda propia")
```

```javascript
// app.js:6013-6016 — dónde se pintan las secciones (orden = prioridad visual)
secEl.innerHTML =
  _hoyRenderSection('Callbacks', callbacks, '#5BA3F2', 'Quedaron en volver a contactar', 'hoy-callbacks') +
  _hoyRenderSection('Interesados sin agendar', interesados, '#5BB974', 'Marcaron interés — agendar', 'hoy-interesados') +
  _hoyNewLeadsPointer(virgenesCount);
// → agregar 1-2 llamadas más a _hoyRenderSection (o una función hermana si el
//   layout "agrupado por parte" no encaja en el mismo componente de fila) ANTES
//   del puntero de leads nuevos.
```

`_hoyRenderSection(title, leads, accent, hint, dialerMode)` (`app.js:6056-6100`)
ya soporta: contador, hint descriptivo, Power Dialer por sección (D-10 no
pide dialer para compromisos explícitamente, pero el componente lo trae
gratis si se reusa tal cual — pasar `dialerMode: null` si no se quiere).

⚠️ **Un lead puede tener simultáneamente un callback/interesado Y un
commitment pendiente** (son campos independientes desde D-01 de esta fase:
"preferencia: plano" en vez de anidado en `nextAction`). El `claimed` Set de
`loadHoyView` evita que el MISMO lead aparezca duplicado en Callbacks +
Interesados — si "Compromisos" es una sección más, hay que decidir si un
lead ya reclamado por Callbacks/Interesados también aparece en Compromisos
(probable que sí, dado que responde una pregunta distinta: "quién me debe
algo", no "cuándo vuelvo a llamar").

---

### `public/app.js` — Timeline de compromisos cerrados (D-11)

**Dos candidatos reales en el código — el planner debe elegir uno (o ambos)**:

**Candidato A — `_renderCallHistory`** (`app.js:9735-9768`), la timeline
UNIFICADA (llamadas + notas, ordenada por fecha) que se muestra en el panel
flotante DURANTE una llamada activa (`#telnyx-call-history`). Es el único
lugar del código con el comentario literal "Phase 17 Ola 4: timeline
unificada del lead" que el CONTEXT.md cita como referencia de D-11.
```javascript
// app.js:9739-9745 — patrón de mezcla de eventos por tipo, ordenados por ts
const log = (lead && Array.isArray(lead.callLog)) ? lead.callLog : [];
const notes = (lead && Array.isArray(lead.notes)) ? lead.notes : [];
const events = [];
for (const c of log) events.push({ kind: 'call', ts: ..., outcome: c.outcome, notes: c.notes, duration: c.duration });
for (const n of notes) events.push({ kind: 'note', ts: ..., text: n.text, by: n.by });
if (events.length === 0) { box.style.display = 'none'; return; }
events.sort((a, b) => b.ts - a.ts);
// → sumar un tercer `kind: 'commitment'` cuando el compromiso se cierre
//   (cumplido/incumplido) — necesita que _closeCommitment (D-07) deje un
//   RASTRO persistido en algún lado (ver Shared Patterns: "el histórico
//   no se borra").
```

**Candidato B — `historyHtml`/`notesHtml` dentro de `_callsRenderExpandedPanel`**
(`app.js:7878-7937`), la ficha completa del lead (modal de Hoy y panel
expandido de Llamadas) — hoy son DOS listas separadas (no mezcladas como el
candidato A), pero es donde el user realmente mira "qué pasó con este lead"
fuera de una llamada activa.

⚠️ **D-04/CONTEXT: "commitment se guarda plano en el lead... para que el
historial sobreviva al consumo del reloj"** — esto implica que
`lead.commitment` NO se borra al cerrarse (a diferencia de `nextAction`, que
SÍ se limpia). El estado pasa a `cumplido`/`incumplido`/`vencido` pero el
objeto persiste. Eso es lo que hace posible mostrarlo en cualquiera de los
dos candidatos sin necesitar un array de historial nuevo — un solo
`lead.commitment` con `estado !== 'pendiente'` ES el registro cerrado. Si en
el futuro se necesitara más de un compromiso cerrado en el historial (hoy
D-01 dice "uno pendiente por lead", no "uno por lead para siempre"), ahí sí
haría falta un array — pero eso está fuera del alcance actual según D-01.

---

## Shared Patterns

### Whitelists estrictas con `Set` (patrón transversal del proyecto)
**Fuente:** `index.js:10974-10991` (`NEXT_ACTION_*`), `index.js:11428-11439`
(`DISQUALIFY_REASONS`), `index.js:11473-11476` (`VALID_OBJECTION_TAGS`,
inline dentro del endpoint — tercer ejemplo del mismo idioma).
**Aplicar a:** `COMMITMENT_TIPOS`/`COMMITMENT_PARTES`/`COMMITMENT_ESTADOS` —
declarar como `const X = new Set([...])` a nivel de módulo, cerca de
`NEXT_ACTION_*` (mismo bloque `NEXT ACTION` de `index.js:10963-11002`), NUNCA
un array plano con `.includes()` disperso en cada validación.

### `_leadNextAction(lead)` — único lector autorizado del reloj
**Fuente:** `index.js:11142-11145`.
**Aplicar a:** nada de esta fase debe leer `lead.nextAction`/`lead.callbackAt`
directo para saber "cuándo vuelve este lead" — el compromiso ESCRIBE a través
de `_setNextAction` (que ya alimenta este lector), pero cualquier código que
necesite LEER el próximo paso sigue pasando por `_leadNextAction`.

### `_leadStoreApply(id, patch)` — escritura optimista única (regla #105)
**Fuente:** `public/app.js:5833-5851`.
**Aplicar a:** cualquier mutación de `lead.commitment`/`lead.nextAction` tras
un POST/PATCH exitoso en el frontend — `openNextStepModal` YA lo usa
(`app.js:11113`: `if (data.lead) _leadStoreApply(leadId, data.lead);`).
Copiar exacto: pasar el `lead` completo que devuelve el server, no armar un
patch parcial a mano.

### `_refreshLeadPanels(leadId)` — punto único de refresco visual
**Fuente:** `public/app.js:6156-6159`.
**Aplicar a:** todo handler nuevo de compromiso desde la ficha (D-09) — sin
esto, el modal de Hoy (`#hoy-ficha-modal`, DOM aparte de la lista de
Llamadas) queda mostrando el estado viejo tras guardar (nota #175 de
CLAUDE.md, bug real ya arreglado una vez con este mismo componente).

### `_dispoAfterSaved(leadId, opts)` — aviso universal de destino (Phase 30, D-05/D-06/D-07)
**Fuente:** `public/app.js:8561-8580` (punto único) + bloque `[30-03]
DISPO-DEST` completo, `app.js:8582-8707` (`_dispoDestination`, 8 ramas de
precedencia) + `_dispoAnnounce`, `app.js:8720-8735`.
**Aplicar a:** si D-08 hace que `openNextStepModal` mande también un
`commitment` en el body de `call-disposition`, el call site YA pasa por
`_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'answered_interested' })`
(`app.js:11116`) — no hay que agregar nada ahí. Pero si D-09 crea un endpoint
NUEVO (`PATCH .../commitment`) que se usa FUERA de una disposición de
llamada, ese camino NO pasa por `_dispoAfterSaved` (no es una disposición) —
usar `_refreshLeadPanels` + un toast simple ahí, no reinventar el cálculo de
destino de `_dispoDestination` (ese es específico de outcomes de llamada).

### `mutateSettersData` — mutex para escrituras async (regla #19)
**Fuente:** `index.js:7103-7113`, documentado en CLAUDE.md nota #19.
**Aplicar a:** NO hace falta en ninguno de los endpoints de esta fase —
`call-disposition` y `PATCH .../followup` (el analog directo de la nueva
ruta `PATCH .../commitment`) son ambos síncronos (`loadSettersData` →
mutar → `saveSettersData`, sin `await` en el medio). Si el planner decide
sumar algo async (ej. una notificación), ENTONCES sí hay que envolver en
`mutateSettersData` — hasta ahí, sync está bien y es el patrón real del
código que se está extendiendo.

### Testing — bloque puro con marcadores + tests de fuente
**Fuente:** `tests/gate-next-step-ui.test.js:1-40` (bloque `[30-02]
GATE-PURE` extraído con `new Function`), `tests/next-action-model.test.js`,
`tests/gate-destination.test.js` (verificación por mutación temporal,
restaurada de inmediato).
**Aplicar a:** cualquier helper puro nuevo de fechas/mapeo D-06 (ej.
`_commitmentDefaultDate(tipo, now)`) debe envolverse en un bloque
`// ─── [31-XX] NOMBRE-PURE: INICIO ───` / `FIN` (mismo formato exacto de
marcadores) para que los tests lo extraigan aislado, sin DOM/red/localStorage.

### Testing — setup con `tmpData` + API keys vacías (nota #121)
**Fuente:** patrón repetido en `tests/next-action-migration.test.js`,
`tests/gate-next-action.test.js`, `tests/gate-destination.test.js`.
```javascript
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.OPENAI_API_KEY = "";  // NUNCA delete
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";
```
**Aplicar a:** cualquier test nuevo de esta fase. Nota #121 de CLAUDE.md:
`delete` reintroduce el bug histórico de tests colgados por llamar a la IA
real (dotenv repone vars borradas, no las vacías).

### Cache-buster (regla transversal, CLAUDE.md sección "Cache-busting")
**Estado actual:** `public/index.html:14` → `style.css?v=20260814a`;
`public/index.html:3650` → `app.js?v=20260815b`.
**Aplicar a:** cualquier cambio a `public/app.js`/`public/index.html`/
`public/style.css` en esta fase DEBE bumpear el cache-buster correspondiente
— sin excepción, aunque sea un cambio de 1 línea (advertencia explícita del
CLAUDE.md tras un bug real ya vivido).

## No Analog Found

| Región | Razón |
|---|---|
| Endpoint de CONSULTA agregada de compromisos pendientes cross-lead (si D-10 necesitara algo más que derivar client-side del array que `loadHoyView` ya trae) | No existe hoy ningún endpoint que devuelva "todos los leads con X campo pendiente" fuera de `GET /leads/sin-wsp` (que ya trae los leads completos, incluido `commitment` una vez que `ensureLeadDefaults` lo inicializa) — la vía derivada client-side (mismo patrón que Callbacks/Interesados) cubre D-10 sin necesitar un endpoint nuevo. Si el planner decide que SÍ hace falta (ej. paginación, o compromisos de leads que hoy `GET /leads/sin-wsp` excluye — terminal `descartado`/`agendado`), no hay analog directo y habría que diseñarlo desde cero. |

## Metadata

**Analog search scope:** `index.js` (región `NEXT ACTION`/`GATE`
~10963-11440, `ensureLeadDefaults` ~626-755, endpoints `call-disposition`
~11442-11640 y `PATCH .../followup` ~10288-10363), `public/app.js` (región
disposición/Hoy/ficha ~4962-5010, ~5833-5851, ~5926-6160, ~7647-7991,
~8561-8760, ~9735-9768, ~11033-11312), `public/index.html` (~1548-1598,
~14, ~3650). Documentos leídos: `31-CONTEXT.md`,
`.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md`,
`29-CONTEXT.md` + los 4 `29-0X-SUMMARY.md`, `30-CONTEXT.md` + los 3
`30-0X-SUMMARY.md`, `30-PATTERNS.md`.
**Files scanned:** 3 fuente (monolito `index.js` + `public/app.js` +
`public/index.html`) + 9 documentos de planificación de fases previas.
**Pattern extraction date:** 2026-08-15.
