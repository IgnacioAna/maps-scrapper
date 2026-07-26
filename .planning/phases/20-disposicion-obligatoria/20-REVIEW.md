---
phase: 20-disposicion-obligatoria
reviewed: 2026-07-26T00:00:00Z
depth: standard
diff_base: 6bad444
files_reviewed: 6
files_reviewed_list:
  - index.js
  - scripts/pre-deploy.js
  - tests/disposition-enforcement.test.js
  - public/app.js
  - public/index.html
  - public/style.css
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues
resolved:
  - "CR-01 FIXED en commit 84ebf4a (fix aplicado por el orquestador tras el review; tests 34/34 verdes; cache-buster app.js v=20260725c)"
---

# Phase 20: Code Review Report — Disposición obligatoria

**Reviewed:** 2026-07-26
**Depth:** standard (diff `6bad444..HEAD`)
**Files Reviewed:** 6
**Status:** issues_found (1 critical — RESUELTO en 84ebf4a, 4 warnings advisory, 4 info)

## Summary

Se revisó el diff completo de Phase 20 (backend `pending_calls` + `call-disposition`
extendido + `disposition-audit`; frontend gate D-01, auto-marca D-03, franja D-02,
auditoría D-06; tests; persistencia). Lo estructural está bien hecho: handlers sync
sin mutex (regla #19), atribución desde `req.auth` (T-20-01), `autoMarked` gateado a
`no_answer` (T-20-04), corrección con ventana 15 min doble (client+server 409),
resolución de pendientes validando lead (T-20-06), auditoría derivada de `__callCore`
sin re-implementar el funnel, scoping Phase 18 espejo de team-performance, `apiUrl()`
en los fetch de vistas por-rol (regla #146), persistencia en los 5 lugares (regla #21),
cache-busters bumpeados (regla #48), rutas estáticas antes de `:id`, `escHtml` en todo
el HTML interpolado, y cero líneas tocadas en la cadena de grabación (D-04). Los 16
tests cubren los contratos correctos.

El hallazgo grave es de estado del frontend: `_lastAutoMark` no se limpia al iniciar
una NUEVA llamada al mismo lead, y eso hace que una disposición legítima de la
segunda llamada viaje con `correctsAutoMarked:true` y **borre el entry de la primera
llamada del callLog** — exactamente el tipo de corrupción de dato que esta phase
existe para impedir.

## Critical Issues

### CR-01: `_lastAutoMark` obsoleto — re-discar el mismo lead dentro de los 15 min hace que la próxima disposición BORRE la llamada anterior

**File:** `public/app.js:7413` (`_dispoEnforcementBody`) + `public/app.js:7446` (`_autoMarkNoAnswer`) — cross-ref `index.js:8710-8732`
**Issue:** `_lastAutoMark` se setea tras cada auto-marca y solo se limpia en
`_dispoAfterSaved` (cuando se marca ESE lead) o si expiran los 15 min. **Ningún
punto limpia el flag cuando arranca una llamada nueva al mismo lead.** Secuencia
real (Power Dialer con `holdCurrent` tras la auto-marca, tecla C, o redial manual):

1. Llamada 1 a lead X → no contesta → auto-marca `no_answer` OK → `_lastAutoMark = {X, now}`. El gate queda libre.
2. El SDR re-disca X de inmediato ("pruebo una vez más") — nada lo bloquea.
3. Llamada 2 → CONTACTO → el SDR marca p.ej. "Interesado" por el dropdown/modal.
4. `_dispoEnforcementBody(X)` ve `_lastAutoMark` vigente (<15 min) → adjunta `correctsAutoMarked:true`.
5. El backend valida: último entry del callLog ES auto-marcado y está dentro de la ventana → **hace `pop()` del entry de la llamada 1**, restaura `preCadence`, y pushea la disposición de la llamada 2 con `ts` de la llamada 1 (`logEntry.ts = _correctedEntry.ts`, index.js:8905).

Resultado: 2 llamadas reales → 1 solo entry, un dial desaparece de todas las
métricas (dials/connects del funnel, disposition-audit, reporte), el entry
sobreviviente lleva timestamp de la llamada equivocada, y la cadencia se
restaura a un estado que ya no corresponde. El backend no puede distinguirlo:
su estado coincide exactamente con una corrección legítima. Silencioso — nadie
ve un error.
**Fix:** limpiar el flag al iniciar una llamada nueva a ese lead. En
`_startTelnyxCall`, junto al reset de `pendingRegistered` (app.js ~8243):

```js
// Phase 20: una llamada NUEVA a este lead invalida la ventana de corrección
// de la auto-marca anterior — la corrección es solo para "la que acabo de cortar".
if (_lastAutoMark && _lastAutoMark.leadId === leadId) _lastAutoMark = null;
```

Opcional (defensa backend): en la rama `correctsAutoMarked`, si el body trae
`telnyxCallMeta.startedAt` y NO coincide (±ventana razonable) con el `ts` del
entry a corregir, responder 409 — evita que una meta de otra llamada corrija
un entry que no le pertenece.

## Warnings

### WR-01: `_dispoStripPending` (stash de la franja) nunca expira — puede inyectar `pendingCallId` + metadata VIEJA en una disposición futura del mismo lead

**File:** `public/app.js:7494`, `7547` (`_dispoStripGoResolve`), `7416-7420` (`_dispoEnforcementBody`)
**Issue:** El stash se setea al clickear "Marcar" en la franja y solo se limpia en
`_dispoAfterSaved` si la disposición es de ESE lead. Si el SDR clickea "Marcar"
sobre el pendiente A y después NO lo marca (se distrae, marca otro lead, navega),
el stash queda vivo indefinidamente. Cuando más tarde llama de nuevo al lead A y
marca: (a) `pendingCallId` viejo resuelve el pendiente EQUIVOCADO (el de la llamada
vieja en vez del de la nueva — la nueva queda como "sin marcar" en la franja aunque
se marcó); (b) en los flujos de MODAL (callback/objeción/agenda), que no adjuntan
meta fresca que la pise, el `telnyxCallMeta` del stash mete `durationSecs`/
`fromNumber` de la llamada vieja en el entry de la nueva → duración y costo falsos,
y la auditoría D-06 cruza duración contra un dato que no es de esa llamada.
**Fix:** invalidar el stash cuando arranca una llamada nueva a ese lead (en
`_startTelnyxCall`: `if (_dispoStripPending?.leadId === leadId) _dispoStripPending = null;`)
y/o agregarle un timestamp con expiración corta (p.ej. 10 min) chequeada en
`_dispoEnforcementBody`.

### WR-02: si la auto-marca falla (red), la metadata Telnyx se pierde — la marca manual de rescate queda como `channel: 'manual'` sin duración ni costo

**File:** `public/app.js:7433` (`_autoMarkNoAnswer` — `_consumeTelnyxMeta` antes del fetch)
**Issue:** `_autoMarkNoAnswer` consume la meta (`_consumeTelnyxMeta` borra TODAS las
claves del lead, app.js:8562-8568) ANTES del fetch. En el catch (fallback al gate
manual, decisión correcta) la meta no se restaura. Cuando el SDR marca a mano desde
el gate, `_consumeTelnyxMeta` devuelve null → el entry se persiste como canal
`manual`, sin `duration`/`fromNumber`/`cost`, y sin identidad de llamada para el
match del transcript (`callStartedAt`). El pendiente server-side sí conserva
`durationSecs`, pero el flujo del gate no lo stashea (solo la franja lo hace).
**Fix:** en el catch, re-stashear antes de armar el gate:

```js
} catch (e) {
  console.warn('[dispo] auto-marca falló, cae al gate manual:', e?.message);
  if (telnyxMeta) {
    _pendingTelnyxCallMetadata[leadId] = telnyxMeta;
    if (telnyxMeta.startedAt) _pendingTelnyxCallMetadata[`${leadId}:${telnyxMeta.startedAt}`] = telnyxMeta;
  }
  const lead = _callsLeadsById.get(leadId);
  _dispoGateSet(leadId, lead?.name || '', telnyxMeta?.startedAt || null);
}
```

(Nota: `telnyxMeta` ya está en scope — se consumió en la primera línea del try.)

### WR-03: `_dispoReal` se re-deriva al colgar desde `_callsLeadsById` — si el mapa se reconstruyó durante la llamada, un discado ad-hoc se clasifica como real y arma un gate SIN salida

**File:** `public/app.js:8430` (`_onTelnyxCallEnded`) vs `public/app.js:4925` (rebuild del mapa) y `6276` (ghost lead)
**Issue:** El lead fantasma del discado ad-hoc vive solo en `_callsLeadsById`
(`.set(ghostId, ghostLead)`), y `loadCallsView` REEMPLAZA el mapa entero
(`_callsLeadsById = new Map(...)`, línea 4925) — el ghost desaparece si la lista se
recarga durante la llamada (navegar a Hoy y volver, cambiar filtro, etc.). Al
colgar, `_callsLeadsById.get(ghostId)?._isManualDial` → `undefined` → `_dispoReal
= true` → con contacto se arma el gate para un lead sin row ("Ir a marcar" no
encuentra nada) y el SDR queda bloqueado hasta refrescar el tab (el restore valida
contra el server, no encuentra pendiente y limpia — pero eso exige un F5 que nadie
le avisa que haga). También dispara un upsert de pendiente que el backend rechaza
con 404 (inofensivo, pero ruido).
**Fix:** capturar la clasificación al INICIO con el objeto que ya está en mano —
en `_startTelnyxCall`: `_telnyxCallState.isManualDial = !!lead._isManualDial;` y en
`_onTelnyxCallEnded`: `const _dispoReal = !!(leadId && !_telnyxCallState.isManualDial);`
(mismo patrón que ya usan `startedAt`/`pendingRegistered`: snapshotear el estado de
la llamada, no re-consultarlo).

### WR-04: la cancelación del pendiente puede llegar al server ANTES que su creación → registro huérfano de 14 días

**File:** `public/app.js:8314-8320` (creación fire-and-forget), `8330-8338` (cancel en catch de startCall), `8431-8438` (cancel <1s)
**Issue:** Creación y cancelación son dos `fetch` independientes sin encadenar. Si
`newCall` tira sync o la llamada muere en <1s, el cancel puede procesarse antes de
que la creación aterrice (HTTP no garantiza orden entre requests distintas, menos
con red inestable): el cancel no encuentra el registro (`removed:false`), la
creación llega después y el pendiente huérfano queda vivo 14 días — aparece en la
franja del SDR como "llamada sin marcar" con duración "—" (una llamada que nunca
sonó), cuenta contra su `pctMarked` en la auditoría, y si el SDR la "resuelve"
desde la franja fabrica un dial fantasma en el callLog.
**Fix:** guardar la promesa de creación y encadenar la cancelación:

```js
// al crear:
_telnyxCallState.pendingCreate = fetch(...).catch(() => {});
// al cancelar (ambos call sites):
Promise.resolve(_telnyxCallState.pendingCreate).then(() =>
  fetch(apiUrl('/api/setters/pending-calls'), { ...canceled body... })
).catch(() => {});
```

## Info

### IN-01: prune de 14 días vs rangos de auditoría de 30d/all — `pctMarked` sobreestimado en rangos largos

**File:** `index.js:1786-1789` (`savePendingCalls` prune) vs `index.js:9094` (audit acepta `30d`/`all`)
**Issue:** Los pendientes se podan a 14 días pero los dials del callLog persisten —
en `period=30d`/`all` el denominador pierde los pendientes viejos y el % marcado se
infla. Con `7d` (default) es correcto.
**Fix:** documentarlo en el tooltip de "% marcada" o limitar el cálculo de
`pctMarked` a los últimos 14 días del rango.

### IN-02: la disposición resuelta desde la franja estampa `ts = ahora`, no el momento real de la llamada

**File:** `index.js:8842-8843` + `index.js:8900-8911`
**Issue:** El flujo de corrección hereda `ts` del entry original con el argumento
explícito "las métricas bucketean por ts" — pero la resolución desde la franja
(llamada de ayer, tab crasheado) crea el entry con `ts = now` aunque
`telnyxCallMeta.startedAt` (que el backend ya recibe del stash) tiene la hora real.
El dial se bucketea en el día que se marcó, no en el que se llamó. Es consistente
con el comportamiento legacy de marcar tarde, pero inconsistente con la lógica que
la misma phase introdujo para la corrección. Considerar usar
`telnyxCallMeta.startedAt` como `ts` cuando viene (con clamp de sanidad).

### IN-03: multi-tab — el gate se limpia solo en el tab que postea la disposición

**File:** `public/app.js:7386-7391` (`_dispoGateClear`) + `7460-7482` (`_dispoGateRestore` one-shot)
**Issue:** El gate vive en memoria + localStorage, pero la limpieza vía
`_dispoAfterSaved` solo ocurre en el tab que marcó. Un segundo tab del mismo user
queda con el gate armado (el restore es one-shot al primer `loadCallsView`); si el
SDR marca de nuevo desde ahí, duplica el entry en el callLog (el backend no tiene
idempotencia de disposición). Riesgo bajo (uso multi-tab poco común, y el
double-mark ya era posible pre-Phase 20). Mitigación barata si algún día molesta:
listener de `storage` event para sincronizar el clear entre tabs.

### IN-04: detalles menores del endpoint pending-calls

**File:** `index.js:8547-8612`, `8578-8590` (merge), `8614-8631` (GET)
**Issue:** (a) El merge de un registro existente no verifica que el registro
pertenezca al caller — un admin/supervisor puede pisar `durationSecs`/`reachedActive`
de un pendiente ajeno (el setter queda acotado por ownership del lead); (b) el GET
con `?setter=` no-visible para supervisor devuelve lista vacía en silencio, mientras
disposition-audit responde 403 para el mismo caso — inconsistencia cosmética;
(c) el cap FIFO 300 es global: una ráfaga (o spam deliberado de un setter con
devtools) desaloja pendientes de OTROS SDRs, "limpiándoles" el pctMarked. Todo
dentro del threat model aceptado (el enforcement client-side ya es evadible por
diseño, T-20-12), se deja anotado.

---

## Verificado sin hallazgos

- **Orden del handler de call-disposition:** snapshot `preCadence` capturado ANTES
  del switch de outcome y de la cadencia (el comentario del código es fiel);
  restore de la corrección antes del switch; `callAttempts` no se duplica.
- **`_ccCollectCalls`:** soporta `{visibleSet, channel}` y expone
  `duration/outcome/leadId/ts/setterId` — la auditoría deriva del CORE como exige
  la regla del milestone.
- **Rutas:** `/api/setters/pending-calls` y `/disposition-audit` no colisionan con
  ninguna ruta `:param` previa.
- **D-04:** cero cambios en el rango del buffer de transcripción/grabación
  (`_syncCallRecording`/`_recBindChannel` intactos); `_autoMarkNoAnswer` no llama
  `_flushPendingTranscription`.
- **Atajos:** `_pdKeyOutcomes` 1 sola definición; `shortcutMap` 1-9 intacto;
  autopilot gateado en `_pdStartAutopilotCountdown` sin tocar su lógica.
- **XSS:** todo dato de user/lead interpolado en HTML nuevo pasa por `escHtml`
  (banner, franja, tabla de auditoría, samples).
- **Persistencia:** `pending_calls` presente en export-data (validación de shape
  incluida), import-data, `seedVolumeFromRepo`, `BACKUP_FILES` y pre-deploy.js.
- **Cache-busters:** `app.js?v=20260725b` + `style.css?v=20260725a`, 1 ocurrencia
  exacta cada uno; `wa.js` sin cambios (correcto, no se tocó).
- **UI:** sin emojis decorativos, sin `backdrop-filter` nuevo, posicionamiento
  crítico del banner inline (resiliente a CSS cacheado).
- **Tests:** los 16 cubren atribución por auth, RBAC/scoping, cancelación acotada,
  las 3 vías de resolución, auto-marca + corrección (incl. reversión del
  auto-descarte y ventana 15 min), sospechosas, pctMarked y round-trip de
  persistencia. Timestamps relativos a `Date.now()` (lección TZ aplicada).

---

_Reviewed: 2026-07-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
