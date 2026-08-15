# Phase 30: GATE — Cierra la llamada, define el próximo paso - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 2 (monolito: `index.js`, `public/app.js` — no hay archivos nuevos, esta fase EXTIENDE código existente de las Phases 20/28/29)
**Analogs found:** 8 / 8 regiones (todas exact-match: son extensiones del propio código que la fase toca, no faltan analogs externos)

**Nota de alcance:** GATE-01/02/04 no crean archivos nuevos. Es una fase
quirúrgica sobre `index.js` (`_applyCallOutcome`, `call-disposition`,
`send-placeholder`) y `public/app.js` (`_dispoWhereToast`, `_dispoAfterSaved`,
el banner del Power Dialer, los 3 modales de disposición). Por eso la tabla de
clasificación usa "regiones" dentro de los 2 archivos monolíticos en vez de
paths de archivo distintos — es el mismo patrón que documentan los planes 29-01
a 29-04 (todo backend vive en `index.js` cerca de `_applyCallOutcome`, ~10700).

## File Classification

| Región a modificar | Archivo | Rol | Data Flow | Analog más cercano | Calidad |
|---|---|---|---|---|---|
| Default de `nextAction` por outcome (GATE-01/02, backend permisivo D-01) | `index.js` | service (helper puro compartido) | event-driven (llamado por endpoint humano Y webhook Retell) | `_applyCallOutcome` mismo, bloque de cadencia (~11003-11074) | exact |
| Mapa outcome→propuesta (D-02, whitelist) | `index.js` | config/whitelist | n/a | `NEXT_ACTION_TEMPLATES` / `CALL_OUTCOMES` / `DISQUALIFY_REASONS` (~10756-10784, ~11089-11116) | exact |
| `POST /api/setters/leads/:id/call-disposition` — aceptar override de `nextAction` desde el body (D-02, "editable siempre") | `index.js` | controller/route | request-response | el propio endpoint (~11118-11311) | exact |
| `POST /api/setters/leads/:id/send-placeholder` — setear `nextAction` esperar_respuesta +48h (D-02, fila `placeholder_sent`) | `index.js` | controller/route | request-response (side-effect: envío de mail + mutex) | el propio endpoint (~11496-11574) | exact |
| Gate frontend "no confirmar sin próximo paso" (D-01 capa frontend) | `public/app.js` | component / validation-hook | request-response (bloquea antes del POST) | maquinaria del gate de Phase 20, `_dispoGateSet`/`_dispoGateClear`/`_dispoGateRestore` (~8517-8666) | role-match (mismo idioma "no dejar avanzar sin X", distinto disparador) |
| Universalizar `_dispoWhereToast` (D-05/D-06) | `public/app.js` | utility (toast) | event-driven | `_dispoWhereToast` + `_dispoAfterSaved` mismos (~8532-8576) | exact |
| Integrar destino en el banner "✓ Resultado guardado" del Power Dialer (D-07) | `public/app.js` | component | event-driven | bloque `_holdBanner` en `_pdRender` (~6860-6873) | exact |
| UI de propuesta editable (chips/fecha default + click-para-aceptar-o-editar) en los 3 modales de disposición | `public/app.js` | component | request-response | `_buildCallbackQuickPicks` (~10994-11018) + `window._dtPicker`/`_dtPickerAttach` (~4962-5007) + `openCallbackModal` (~10768-10846) | role-match (mismo idioma de propuesta-editable ya usado para fecha de callback, ahora se generaliza a "próximo paso") |

## Pattern Assignments

### `index.js` — `_applyCallOutcome` (extender para GATE-01/02)

**Analog:** la propia función, `index.js:10888-11077`. Esta fase NO reemplaza
nada de la Phase 29 — agrega el default explícito por outcome que el mapa D-02
pide, apoyándose en `_setNextAction`/`_clearNextAction` que YA existen.

**API real a usar tal cual (NO inventar nombres — ya verificado en código):**
```javascript
// index.js:10756-10791 — whitelists y plantillas, ÚNICA fuente
const NEXT_ACTION_TIPOS = new Set([
  'callback', 'cadencia', 'enviar_info', 'esperar_respuesta', 'otro',
]);
const NEXT_ACTION_CANALES = new Set(['llamada', 'whatsapp', 'email', '']);
const NEXT_ACTION_ORIGENES = new Set(['manual', 'cadencia', 'compromiso']);

const NEXT_ACTION_TEMPLATES = [
  { key: '24hs', label: '24h', deltaMs: 24 * 60 * 60 * 1000 },
  { key: '48hs', label: '48h', deltaMs: 48 * 60 * 60 * 1000 },
  { key: '72hs', label: '72h', deltaMs: 72 * 60 * 60 * 1000 },
  { key: '7d',   label: '7d',  deltaMs: 7 * 24 * 60 * 60 * 1000 },
  { key: '15d',  label: '15d', deltaMs: 15 * 24 * 60 * 60 * 1000 },
];
function _nextActionTemplateForDelta(deltaMs) {
  return NEXT_ACTION_TEMPLATES.find((t) => t.deltaMs === deltaMs) || null;
}
```

```javascript
// index.js:10793-10822 — escritura del reloj único. NUNCA lanza.
function _setNextAction(lead, spec, nowIso) {
  // spec = {tipo, dueAt, canal, motivo, origen, createdBy}
  // Coerciona valores inválidos a defaults seguros (tipo→'otro', canal→'',
  // origen→'manual'). Escribe lead.nextAction Y espeja lead.callbackAt = dueAt.
}
function _clearNextAction(lead) {
  lead.nextAction = null;
  lead.callbackAt = '';
}
```

**Core pattern — el switch de outcomes que GATE-02 debe leer/extender**
(`index.js:10913-10991`, cada `case` es donde entra el default D-02):
```javascript
switch (outcome) {
  case 'answered_interested':
    lead.respondio = true;
    lead.calificado = true;
    lead.interes = 'si';
    lead.estado = 'interesado';
    // GATE-02: acá falta _setNextAction(lead, {tipo:'callback', dueAt:+3d, origen:'manual'}, ...)
    // — hoy el interesado queda SIN próximo paso salvo que el user lo agende
    // (D-04: los interesados nunca se auto-descartan, así que el gate es lo
    // único que evita que quede flotando sin fecha).
    break;

  case 'answered_not_interested':
    lead.estado = 'descartado';         // terminal — D-02: sin próximo paso
    break;
  // ...
  case 'callback_later': {
    // YA llama _setNextAction con la fecha que eligió el user (origen:'manual')
    // — este case es el ÚNICO que hoy programa nextAction explícito. GATE-02
    // pide el mismo patrón para 'answered_interested' y 'placeholder_sent'.
    const _cbDueAt = callbackAt || new Date(Date.now() + 24*60*60*1000).toISOString();
    _setNextAction(lead, { tipo: 'callback', dueAt: _cbDueAt, canal: 'llamada',
      motivo: '', origen: 'manual', createdBy: opts.actorName || '' }, opts.nowIso);
    break;
  }
  case 'scheduled_with_admin':
    lead.estado = 'agendado';           // terminal — D-02: sin próximo paso
    break;
}
```

**Cadencia (no_answer/voicemail/hung_up) — YA implementa exactamente el
idioma D-02** (`index.js:11039-11074`, para hung_up ~11028-11037): programa
`+24h` vía `_setNextAction({tipo:'cadencia', origen:'cadencia', ...})` salvo
que el tope de reintentos/cortes lo descarte primero (`_clearNextAction` +
`estado='descartado'`). **Este bloque NO se toca** — D-02 solo pide que
`answered_interested` y `placeholder_sent` reciban el mismo tratamiento que ya
tienen `callback_later`/`no_answer`/`voicemail`/`hung_up`.

**Regla D-01 (backend permisivo, nunca 400):** el switch ya sigue este idioma
— ningún `case` valida "¿vino nextAction?" y rechaza; todos asignan o dejan
`_clearNextAction` (llamado al entrar, línea 10909) como default terminal
implícito. GATE-01 debe seguir la MISMA forma: si el body no trae override,
asignar el default D-02 dentro del `case`, nunca `return res.status(400)`.

---

### `index.js` — `POST /api/setters/leads/:id/call-disposition`

**Analog:** el propio endpoint, `index.js:11118-11311`.

**Body destructuring pattern** (línea 11136) — agregar el override opcional
de próximo paso al mismo nivel que los campos existentes:
```javascript
const { outcome, notes, callbackAt, scheduled, telnyxCallMeta, objectionTags,
        disqualifyReason, doNotCall, callbackShared, autoMarked,
        correctsAutoMarked, pendingCallId } = req.body || {};
if (!CALL_OUTCOMES.has(outcome)) {
  return res.status(400).json({ error: `outcome inválido...` });
}
```

**Whitelist-and-coerce pattern** (línea 11141) — mismo idioma para validar
cualquier campo nuevo que GATE-02 agregue (ej. un `nextActionOverride.tipo`):
```javascript
const cleanReason = (typeof disqualifyReason === 'string' && DISQUALIFY_REASONS.has(disqualifyReason))
  ? disqualifyReason : '';
```

**Delegación a `_applyCallOutcome`** (línea 11268-11279) — el punto único
donde GATE-01/02 conecta el override del body con el helper puro:
```javascript
const { calendarEntry } = _applyCallOutcome(data, lead, logEntry, {
  leadId: req.params.id, nowIso: now, outcome, callbackAt, callbackShared,
  scheduled, cleanReason, doNotCall,
  actorSetterId: req.auth?.user?.role === 'setter' ? req.auth.user.setterId : (lead.assignedTo || ''),
  actorName: req.auth?.user?.name || '',
  // GATE-02: acá se agregaría nextActionOverride si el frontend lo manda
});
```

**Guardado y respuesta** (línea 11309-11310) — patrón estándar del proyecto
(`loadSettersData` → mutar → `saveSettersData`, síncrono, sin mutex porque no
hay `await` en el medio):
```javascript
saveSettersData(data);
res.json({ ok: true, lead, calendarEntry, resolvedPendingId });
```

---

### `index.js` — `POST /api/setters/leads/:id/send-placeholder`

**Analog:** el propio endpoint, `index.js:11496-11574`. Es el ÚNICO camino
que persiste un outcome (`placeholder_sent`) SIN pasar por `_applyCallOutcome`
— GATE-02 necesita cablear `esperar_respuesta +48h` acá aparte.

**Patrón mutateSettersData (mutex async, regla #19)** — usar EXACTO este
idioma porque hay un `await` de red (`_sendPlaceholderEmail`) entre el load y
el save:
```javascript
// index.js:11554-11572
const updated = await mutateSettersData((fresh) => {
  const l = fresh.leads?.[req.params.id];
  if (!l) return null;
  if (!Array.isArray(l.callLog)) l.callLog = [];
  l.callLog.push({
    ts: nowIso, outcome: 'placeholder_sent', by: u.id || '',
    notes: `Hold enviado a ${toEmail} para ${fechaTxt}...`,
    channel: 'email', placeholderWhen: startISO,
  });
  if (l.callLog.length > 500) l.callLog = l.callLog.slice(-500);
  l.placeholderSentAt = nowIso;
  l.lastContactAt = nowIso;
  // GATE-02: acá va _setNextAction(l, {tipo:'esperar_respuesta', dueAt:+48h,
  //   canal:'email', origen:'manual', createdBy:u.name||''}, nowIso);
  return l;
});
res.json({ ok: true, lead: updated || lead, sentTo: toEmail, when: startISO });
```

---

### `public/app.js` — Gate frontend (D-01, capa 1)

**Analog:** la maquinaria de gate de Phase 20 (`_dispoGateSet`/`_dispoGateClear`/
`_dispoGateRestore`, `app.js:8517-8666`). Mismo idioma — "no dejar seguir sin
resolver X" — pero el disparador de GATE-30 es distinto (falta de próximo
paso elegido, no una llamada colgada sin marcar). **D-08 dice que el gate de
Phase 20 NO se toca**: es otro mecanismo, coexisten.

**Patrón de gate simple (banner + set/clear), reusable para el próximo paso**
(forma exacta de la UI queda a discreción del planner — dropdown/chips/fila,
ver `<decisions>` del CONTEXT):
```javascript
// app.js:8517-8528 — mismo esqueleto: guardar estado + persistir +
// re-renderizar un banner/indicador; limpiar cuando se resuelve.
function _dispoGateSet(leadId, leadName, startedAtIso) {
  _dispoGate = { leadId, leadName: leadName || '', startedAt: startedAtIso || null };
  try { localStorage.setItem(_dispoGateStorageKey(), JSON.stringify(_dispoGate)); } catch {}
  _dispoGateRenderBanner();
}
function _dispoGateClear(leadId) {
  if (leadId && _dispoGate && _dispoGate.leadId !== leadId) return;
  _dispoGate = null;
  try { localStorage.removeItem(_dispoGateStorageKey()); } catch {}
  _dispoGateRenderBanner();
}
```

**Punto de inserción real del gate**: `window._handleCallDisposition`
(`app.js:10617-10694`) y `window._pdHandleDisposition` (`app.js:7211-7260`)
son los DOS ÚNICOS call sites que llegan a `POST .../call-disposition` para
outcomes directos (los que abren modal ya fuerzan la elección de fecha en el
modal mismo — `callback_later`→`openCallbackModal`, `scheduled_with_admin`→
`openScheduleModal`, `answered_not_interested`→`openObjectionModal`, todos en
`app.js:10617-10650`). El gate D-01 solo necesita actuar sobre los outcomes
que hoy van DIRECTO sin modal (`answered_interested`, `no_answer`, `voicemail`,
`hung_up`, `wrong_number`, `invalid_number`) — ahí es donde el user podría
"confirmar sin decidir nada".

---

### `public/app.js` — Universalizar `_dispoWhereToast` (D-05/D-06)

**Analog:** las propias funciones, `app.js:8532-8576`. HOY solo 3 de ~6 call
sites la invocan manualmente (outcomes directos en `_handleCallDisposition`
línea 10685, `openCallbackModal` línea 10838, `_autoMarkNoAnswer` línea 8628)
— faltan `openObjectionModal` (10959-10992) y `openScheduleModal`
(11039-11065) y `openPlaceholderModal` (10740-10764).

```javascript
// app.js:8552-8576 — el aviso ya calcula destino y hora; nombra la vista
// real (D-06) según si el último callLog fue callback_later (manual) o no
// (cadencia). El gate de Power Dialer (_pd.active) lo omite a propósito (D-07).
function _dispoWhereToast(leadId, opts = {}) {
  if (_pd.active) return;
  const l = _callsLeadsById.get(leadId);
  if (!l || ['descartado', 'agendado'].includes(l.estado)) return;
  const ts = l.callbackAt ? new Date(l.callbackAt).getTime() : 0;
  if (!ts || isNaN(ts) || ts <= Date.now()) return;
  // ... calcula "hoy/mañana/día HH:MM" y arma el mensaje ...
  const manual = opts.manual === true
    || (Array.isArray(l.callLog) && l.callLog.length > 0 && l.callLog[l.callLog.length - 1].outcome === 'callback_later');
  const destino = manual ? 'en Hoy → Callbacks' : 'a la cola de Llamadas';
  window.showToast?.(`«${l.name || 'Lead'}» sale de la cola — vuelve ${cuando} ${destino}`, { type: 'info', duration: 4500 });
}
```

**Punto único recomendado para universalizar (D-05 "TODA disposición
avisa")**: mover el `_dispoWhereToast(leadId)` DENTRO de `_dispoAfterSaved`
(`app.js:8532-8550`, el "punto único post-guardado" que el CONTEXT ya señala
como Reusable Asset) en vez de repetirlo en cada call site — así los 3 modales
que hoy no lo llaman lo heredan automáticamente sin tocar cada uno:
```javascript
// app.js:8530-8550 — YA es el punto único que TODOS los caminos llaman tras
// un POST exitoso (los 5 POST + la auto-marca). Es el lugar natural para D-05.
function _dispoAfterSaved(leadId) {
  _dispoGateClear(leadId);
  try { _callsForceShow.delete(leadId); } catch {}
  if (_lastAutoMark && _lastAutoMark.leadId === leadId) _lastAutoMark = null;
  if (_dispoStripPending && _dispoStripPending.leadId === leadId) _dispoStripPending = null;
  if (typeof _dispoLoadPendingStrip === 'function') { try { _dispoLoadPendingStrip(); } catch {} }
  try {
    if (document.querySelector('#view-hoy:not(.hidden)') && typeof loadHoyView === 'function') loadHoyView();
  } catch {}
  // D-05: acá agregar _dispoWhereToast(leadId) para que sea universal —
  // ¡OJO! los call sites que hoy ya lo llaman DESPUÉS de _dispoAfterSaved
  // (línea 10685, 10838) quedarían duplicados: hay que sacarlos de ahí si se
  // centraliza acá, no simplemente sumar.
}
```

---

### `public/app.js` — Banner del Power Dialer (D-07)

**Analog:** el bloque `_holdBanner`, `app.js:6860-6873`. `_dispoWhereToast`
YA hace `if (_pd.active) return;` — el trabajo de D-07 es agregar la
info de destino ACÁ en vez de (no del toast, que ya está bloqueado):
```javascript
// app.js:6863-6873
const _holdBanner = _pd.holdCurrent ? `
<div style="display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:16px; padding:12px 16px; background:rgba(91,185,116,0.12); border:1px solid rgba(91,185,116,0.45); border-radius:10px;">
  <div style="min-width:0;">
    <div style="font-size:13px; font-weight:700; color:var(--success);">✓ Resultado guardado${_pd.holdOutcome && typeof callOutcomeLabel === 'function' ? ' · ' + escHtml(callOutcomeLabel(_pd.holdOutcome)) : ''}</div>
    <div style="font-size:11.5px; color:var(--text-secondary); margin-top:2px;">Podés seguir agregando notas en esta tarjeta. Avanzá cuando termines.</div>
    <!-- D-07: acá agregar una línea con destino/cuándo vuelve, mismo cálculo
         que _dispoWhereToast pero renderizado inline en vez de toast -->
  </div>
  <button type="button" onclick="window._pdAdvance()" ...>Siguiente lead → <kbd>S</kbd></button>
</div>` : '';
```
`_pd.holdCurrent`/`_pd.holdOutcome` se setean en `_pdHandleDisposition`
(`app.js:7223-7230`) y en `_autoMarkNoAnswer` (`app.js:8631-8634`) — esos son
los 2 lugares donde, si se quiere pasar más contexto al banner (ej. el
`dueAt`/destino ya calculado), habría que sumar un tercer campo `_pd.holdMeta`
junto a `holdOutcome`.

---

### `public/app.js` — Modal "Volver a llamar después" (NO ROMPER — fix #181b)

**Analog:** `openCallbackModal`, `app.js:10768-10846`. Este es el ejemplo
canónico del bug ya arreglado que GATE-30 puede reintroducir si toca el modal
sin cuidado: el modal se REUSA entre aperturas, así que el reset tiene que
pasar en DOS lugares (cinturón al abrir + `finally` al cerrar cada intento):
```javascript
// app.js:10805-10814 — CINTURÓN: reset SIEMPRE al abrir, no solo la 1ra vez.
const confirmBtn = document.getElementById('call-cb-confirm');
confirmBtn.disabled = false;
confirmBtn.textContent = 'Programar';
modal.classList.remove('hidden');
confirmBtn.onclick = async () => {
  const fecha = fechaInput.value;
  if (!fecha) { alert('Elegí una fecha'); return; }
  confirmBtn.disabled = true; confirmBtn.textContent = 'Guardando…';
  try {
    // ... POST ...
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    // TIRADORES: restaurar el botón pase lo que pase (éxito o error).
    confirmBtn.disabled = false; confirmBtn.textContent = 'Programar';
  }
};
```
El mismo patrón cinturón+tiradores está replicado en `openPlaceholderModal`
(`app.js:10735-10737` + `10761-10763`). **Si GATE-30 agrega un nuevo modal o
un nuevo paso dentro de uno existente para elegir/editar el próximo paso,
tiene que copiar este patrón exacto** (reset-on-open + finally-on-close) —
es la causa raíz documentada de la nota #181b de CLAUDE.md.

---

### `public/app.js` — "Propuesta editable" (patrón de UI para GATE-02)

**Analog:** `_buildCallbackQuickPicks` (`app.js:10994-11018`) +
`window._dtPicker`/`_dtPickerAttach` (`app.js:4962-5007`). Es el patrón MÁS
cercano que ya existe en el proyecto a "propuesta ya cargada que el user
acepta con un click o edita" (texto literal de D-02 en el CONTEXT):

```javascript
// app.js:10994-11018 — genera picks con label+subtitle+Date; un click en
// cualquiera setea la fecha (vía _dtPickerSet) sin abrir el calendario.
function _buildCallbackQuickPicks() {
  const picks = [
    { label: 'En 2 horas', subtitle: fmt(...), date: new Date(...) },
    { label: 'Mañana 10am', subtitle: fmt(mkDate(1, 10)), date: mkDate(1, 10) },
    // ...
  ];
  return picks;
}
```
```javascript
// app.js:10779-10803 (dentro de openCallbackModal) — wiring: click en un
// chip actualiza el input + sincroniza el trigger del datepicker + resalta
// visualmente el elegido. Este es el patrón a reusar para "click acepta el
// default D-02, o abrí el calendario/select y editá".
const picks = _buildCallbackQuickPicks();
qpWrap.innerHTML = picks.map((p, i) => `<button type="button" class="cb-quickpick" data-iso="${p.date.toISOString()}">...</button>`).join('');
qpWrap.querySelectorAll('.cb-quickpick').forEach(btn => {
  btn.addEventListener('click', () => {
    fechaInput.value = _toDatetimeLocal(new Date(btn.getAttribute('data-iso')));
    _dtPickerSync(fechaInput); // repinta el trigger del calendario propio (Phase 28)
  });
});
```
```javascript
// app.js:4962-5007 — componente de calendario propio (Phase 28), attach
// idempotente sobre cualquier <input> oculto. window._dtPicker expone
// {attach, sync, set, close} — API estable para "editar la fecha propuesta".
function _dtPickerAttach(input, opts) { /* ... */ }
window._dtPicker = { attach: _dtPickerAttach, sync: _dtPickerSync, set: _dtPickerSet, close: _dtPickerClose };
```

**Selector de resultado — fuente única a extender** (`_dispoSelectHTML`,
`app.js:6035-6054`): es el `<select>` compartido por la lista de Llamadas Y
las cards de Hoy (comentario explícito en el código: "duplicarlo ya mordió
una vez"). Si GATE-01 agrega un paso de confirmación tras elegir el outcome
en este `<select>`, tiene que vivir en esta única función — NO copiarlo a
otro lado.

**Grid del Power Dialer** (`app.js:7044-7055`) — 9 botones directos
(`pd-disp-btn`) con key/label/sub/color; análogo de `_dispoSelectHTML` para
el flujo de discado rápido. Cualquier outcome que empiece a requerir un paso
extra de "elegí/confirmá el próximo paso" tiene que decidir si sigue siendo
un botón directo (`window._pdHandleDispositionDirect`) o pasa a abrir un
mini-paso inline (mismo patrón que `callback_later`/`scheduled_with_admin`/
`answered_not_interested` YA hacen al abrir modal en vez de disparar directo).

---

## Shared Patterns

### Whitelists estrictas con `Set` (patrón transversal del proyecto)
**Fuente:** `index.js:10756-10784` (`NEXT_ACTION_TIPOS/CANALES/ORIGENES`,
`NEXT_ACTION_TEMPLATES`), `index.js:11089-11116` (`CALL_OUTCOMES`,
`DISQUALIFY_REASONS`).
**Aplicar a:** cualquier campo nuevo que GATE-30 agregue al body de
`call-disposition` (ej. si se permite mandar `nextActionOverride`, sus
sub-campos deben validarse contra estas MISMAS whitelists, no unas nuevas).

### `_leadNextAction(lead)` — único lector autorizado
**Fuente:** `index.js:10874-10879`.
**Aplicar a:** cualquier lugar del frontend o backend que necesite leer "cuál
es el próximo paso de este lead" — NUNCA leer `lead.nextAction` directo (puede
ser `null` con un legado derivable) ni `lead.callbackAt` directo (es el
espejo, no la fuente).
```javascript
function _leadNextAction(lead) {
  if (lead && typeof lead.nextAction === 'object' && lead.nextAction !== null) return lead.nextAction;
  return _deriveNextActionFromLegacy(lead);
}
```

### `_leadStoreApply(id, patch)` — escritura optimista única (regla #105)
**Fuente:** `public/app.js:5833-5851`.
**Aplicar a:** toda mutación optimista de un lead tras un POST exitoso de
disposición — ya lo usan `_handleCallDisposition` (línea 10682), el modal de
callback (línea 10834), el de objeción (línea 10983) y el de agenda (línea
11061). Si GATE-02 agrega un campo `nextAction` al patch optimista, seguir
exactamente esta forma: `_leadStoreApply(leadId, { nextAction: {...} })`.

### `mutateSettersData` — mutex para escrituras async (regla #19)
**Fuente:** patrón usado en `send-placeholder` (`index.js:11556-11572`) y
documentado en CLAUDE.md nota #19.
**Aplicar a:** cualquier handler que tenga un `await` (I/O, LLM, mail) ANTES
de mutar el lead — `send-placeholder` ya lo hace bien; si se toca ese
endpoint para el default de `placeholder_sent`, la escritura de `nextAction`
va DENTRO del callback de `mutateSettersData`, no antes.

### Testing — setup con `tmpData` + API keys vacías (no `delete`)
**Fuente:** `tests/next-action-migration.test.js:1-27`,
`tests/disposition-enforcement.test.js` (setup análogo).
**Aplicar a:** cualquier test nuevo de GATE-30. Patrón exacto:
```javascript
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData; // tmpdir + timestamp, mkdirSync recursive
process.env.OPENAI_API_KEY = "";  // NUNCA delete — dotenv repone las borradas
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";
// auth.json sembrado a mano con pwd() (scrypt) ANTES de importar index.js
```
Nota #121 de CLAUDE.md: usar `= ""` en vez de `delete process.env.X_API_KEY`
— es la causa raíz documentada de los tests flaky históricos (`dotenv.config()`
repone las vars borradas pero no las vacías).

## No Analog Found

Ninguno — las 8 regiones de la tabla de clasificación tienen analog directo
dentro de los mismos dos archivos (`index.js`/`public/app.js`), porque esta
fase extiende mecanismos que las Phases 20/28/29 ya construyeron con el mismo
propósito (gate no-bloqueante, propuesta editable con calendario, reloj único,
toast de destino).

## Metadata

**Analog search scope:** `index.js` (región `_applyCallOutcome` ~10700-11600,
whitelists ~10756-11116, endpoints `call-disposition`/`send-placeholder`),
`public/app.js` (región disposición/Power Dialer ~4700-5010, ~6035-7350,
~8517-8850, ~10617-11090), `tests/next-action-migration.test.js`,
`tests/disposition-enforcement.test.js`.
**Files scanned:** 2 fuente (monolito) + 2 test de referencia.
**Pattern extraction date:** 2026-08-14.
