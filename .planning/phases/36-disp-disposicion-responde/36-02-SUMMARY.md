---
phase: 36-disp-disposicion-responde
plan: 02
subsystem: ui
tags: [frontend, power-dialer, disposicion, telnyx, transcripcion, audio]

# Dependency graph
requires:
  - phase: 36-01
    provides: "_dispoBusyOn/_dispoBusyOff (acuse inmediato), data-outcome en el grid, CSS is-busy/is-saving — este plan se apoya en esa red para no romper el acuse al tocar los tiempos"
  - phase: 35-scr-atribucion-guion
    provides: "_scriptIdsFor(leadId)/_scriptIsAuto(leadId) — el _metaObj ya los leía; se preservaron tal cual al moverlo"
provides:
  - "_audioInFlight: Map leadId→ts que señala 'hay audio en camino' para el flush de transcripción diferida"
  - "_metaObj armado SINCRÓNICAMENTE en el cuerpo de _onTelnyxCallEnded (afuera del setTimeout de 500ms)"
  - "_telnyxCallState.dispoInitiated: flag de 'este cuelgue lo inició la disposición manual'"
  - "_finalizeActiveCallBeforeDisposition sin ningún await adentro (antes: 4,75s de espera)"
  - "El agendado (call-sched-confirm) consume _consumeTelnyxMeta — era el único de los 6 caminos que no lo hacía"
  - "tests/dispo-async-meta.test.js: 27 tests de RESP-02, con verificación por mutación de los 2 puntos críticos"
affects: [36-03, cualquier plan futuro que toque _onTelnyxCallEnded/_finalizeActiveCallBeforeDisposition/_flushPendingTranscription]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Metadata sincrónica: armar datos derivados de un estado vivo (_telnyxCallState) ANTES de cualquier reset async (setTimeout/await) que lo vacíe — mismo criterio que _dispoBusyOn de 36-01 (prender el acuse antes del primer await)."
    - "Flag de 'quién inició este cuelgue' (_dispoInitiated) para que un handler idempotente (_onTelnyxCallEnded, guardado contra doble disparo) sepa que el cuelgue fue forzado por otro flujo y no dispare sus propias acciones automáticas detrás."
    - "La espera de un recurso lento se muda al consumidor fire-and-forget más cercano (_flushPendingTranscription), nunca al camino síncrono que el usuario está esperando ver reflejado en pantalla."

key-files:
  created:
    - tests/dispo-async-meta.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "Se descartó la variante que sugería el ROADMAP ('mandar el POST primero y adjuntar la metadata después, en una segunda escritura'): no existe endpoint para adjuntar telnyxCallMeta a un callLog entry ya creado, el matching por ts/startedAt es el mismo problema que ya mordió en el bug #188 del transcript, y la ventana con duration:0 haría mentir al funnel (cuenta conversación con duration>=30). Se optó por adelantar el armado de la metadata al instante síncrono del cuelgue — más barato y no toca el backend."
  - "La espera del audio (_stopCallRecordingAndBuffer) no desapareció: se movió de _finalizeActiveCallBeforeDisposition (bloqueaba el POST) a _flushPendingTranscription (ya fire-and-forget desde los 6 caminos de disposición) con techo de 8s vía _audioInFlight."
  - "_finalizeActiveCallBeforeDisposition llama a _onTelnyxCallEnded('disposition_hangup') EN EL ACTO, sin esperar el evento del SDK ni el setTimeout de safety de 1200ms que existía antes — es seguro porque el handler arranca con el guard idempotente `if (_telnyxCallState.ended) return;`."

requirements-completed: [RESP-02]

# Metrics
duration: ~8h12m (medido por spread de commits git; ver 'Issues Encountered' — el trabajo activo de edición/verificación fue muy inferior a ese número)
completed: 2026-08-23
---

# Phase 36 Plan 02: El POST del resultado deja de esperar al audio (RESP-02) Summary

**`_finalizeActiveCallBeforeDisposition` pasó de esperar hasta 4,75s (while de 4500ms + respiro de 250ms) a tener CERO awaits: la metadata de la llamada (`_metaObj`) se arma sincrónicamente en `_onTelnyxCallEnded`, afuera del `setTimeout` de 500ms de siempre, y la única espera legítima que queda (que el audio termine de buffereerse) se mudó a `_flushPendingTranscription` vía `_audioInFlight` — sin perder un solo campo de `telnyxCallMeta` en ninguno de los 6 caminos de disposición, cerrando de paso el bug de la ventana de 500ms (`channel:'manual'`, `duration:0`) y el único call site (el agendado) que nunca consumía la metadata.**

## Performance

- **Duration:** ~8h12m medido por el spread real de timestamps de los 3 commits de tareas (`c90c3f8` 07:28:53Z → `05d2172` 15:41:07Z). Ver "Issues Encountered": el trabajo de edición y verificación activa fue considerablemente menor a ese número — no hay una explicación verificable del hueco entre el commit de la Task 2 y el de la Task 3 más allá de lo que muestra `git log`, así que se reporta el dato crudo en vez de inventar un número más prolijo.
- **Started:** 2026-08-23T07:22:07Z (justo después del commit de cierre de 36-01)
- **Completed:** 2026-08-23T15:43:00Z (aprox., commit de este SUMMARY)
- **Tasks:** 3 completadas
- **Files modified:** 3 (2 de código + 1 test nuevo)

## Accomplishments

- Marcar cualquiera de los 9 resultados del Power Dialer, o elegir un resultado en el `<select>` de Llamadas/Hoy, ya no queda esperando hasta 4,75s a que se cuelgue la llamada y se arme el audio antes de mandar el POST — `_finalizeActiveCallBeforeDisposition` no tiene ningún `await` adentro.
- **Cero pérdida de `telnyxCallMeta`**: la metadata (`durationSecs`, `fromNumber`, `startedAt`, `endedAt`, `quickNote`, `scriptIdsUsed`, `scriptIdsAuto`) se arma en el instante del cuelgue y queda disponible aunque la disposición se marque dentro de los primeros 500ms — la ventana que hoy la perdía y guardaba la llamada como `channel:'manual'`/`duration:0`.
- El agendado desde el modal (`call-sched-confirm`) ahora consume `_consumeTelnyxMeta` — era el único de los 6 caminos de disposición que no lo hacía, y toda reunión agendada se guardaba con `duration:0`.
- La transcripción diferida sigue llegando aunque el resultado se marque antes de que el audio termine de armarse: `_audioInFlight` + espera acotada de 8s dentro de `_flushPendingTranscription` (que ya era fire-and-forget, así que no le cuesta nada al SDR).
- Ningún camino puede meter un `no_answer` fantasma ni una traba de gate huérfana detrás de una disposición manual sobre una llamada activa: `_dispoInitiated` corta esa rama.

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: Red de seguridad del audio — la espera se muda al flush (prerequisito)** - `c90c3f8` (feat)
2. **Task 2: Metadata sincrónica + finalize sin esperas + supresión de auto-marca/traba + meta en el agendado** - `507cbc4` (feat)
3. **Task 3: Suite RESP-02 (`tests/dispo-async-meta.test.js`)** - `05d2172` (test)

## Files Created/Modified

- `public/app.js` — bloque `[36-02] RESP-02`, en 3 zonas:
  - Junto a `_pendingTranscribes`: `const _audioInFlight = new Map();` + marca/borra alrededor de `_stopCallRecordingAndBuffer` (`.finally`) + espera acotada (200ms/8000ms techo) al inicio de `_flushPendingTranscription`.
  - `_onTelnyxCallEnded`: nueva const `_dispoInitiated` (capturada en el cuerpo sincrónico); el armado completo de `_metaObj` se movió del `setTimeout(…, 500)` al cuerpo sincrónico (antes de `_setTelnyxCallStatus`); dentro del `setTimeout`, nueva rama `if (_dispoInitiated) { /* no-op */ } else if (!reachedContact) { _autoMarkNoAnswer(leadId); } else { _dispoGateSet(...); }`.
  - `_startTelnyxCall`: reset `_telnyxCallState.dispoInitiated = false;` junto a `pendingRegistered = false;`.
  - `_finalizeActiveCallBeforeDisposition`: reescrita sin `while`/esperas — marca `dispoInitiated = true`, cuelga, llama `_onTelnyxCallEnded('disposition_hangup')` en el acto.
  - `call-sched-confirm` (modal de agenda): `const telnyxMeta = _consumeTelnyxMeta(leadId);` + `body.telnyxCallMeta` antes del `fetch` (idioma igual a los otros 4 call sites).
- `public/index.html` — cache-buster `app.js` `20260822c` → `20260822d`. `style.css` **sin tocar** (`git diff --stat public/style.css` vacío, verificado).
- `tests/dispo-async-meta.test.js` (nuevo) — 27 tests: la espera desaparecida, la metadata sincrónica (índice + los 6 campos + clave compuesta + `_telnyxMetaPersist`), 7 ocurrencias de `_consumeTelnyxMeta(leadId)` (incluido el agendado), el guard `_dispoInitiated` (orden + único disparo de `_autoMarkNoAnswer`), `_audioInFlight` (marca/borra/espera/conteo de call sites) y cache-buster.

## Decisions Made

- **Veredicto de RESP-02: SÍ se desacopló, pero NO por el camino que sugería el criterio del ROADMAP.** El ROADMAP proponía "mandar el POST primero y adjuntar la metadata de Telnyx cuando esté lista (o en una segunda escritura)". Esa variante se evaluó contra el código y se descartó: `POST /api/setters/leads/:id/call-disposition` arma el `logEntry` y lo empuja al `callLog` en UNA escritura; no existe ningún endpoint para adjuntar `telnyxCallMeta` a un entry ya creado, y el entry no tiene identidad propia devuelta al cliente (se identifica por posición y `ts`). Una segunda escritura exigiría endpoint nuevo, matching por `ts`/`startedAt` (el mismo problema que ya mordió el bug #188 de CLAUDE.md — el transcript pegado a la llamada equivocada) y dejaría una ventana donde el `callLog` tiene un entry sin duración, mintiendo en el funnel (cuenta conversación con `duration >= 30`). El camino real y más barato: la espera de hoy no era "el audio tarda", era que la metadata se armaba tarde (dentro de un `setTimeout(…, 500)`). Todo lo que `_metaObj` necesita ya está vivo en el instante del cuelgue — se armó ahí y la espera desapareció por completo.
- La única espera legítima que quedaba (que el audio termine de buffereerse) se movió a `_flushPendingTranscription`, ya fire-and-forget desde los 6 caminos de disposición — esperar ahí no le cuesta un segundo al SDR.
- `_finalizeActiveCallBeforeDisposition` sigue siendo `async` (los 6 call sites la esperan con `await`) pero sin ningún `await` adentro — se dejó documentado en el comentario para que nadie lo "arregle" sacándole el `async`.

## Deviations from Plan

None — plan ejecutado tal como estaba escrito.

Aclaración (no es una desviación, es una nota de fidelidad): el bloque `<interfaces>` del plan citaba el `_metaObj` con el campo `scriptIdsUsed: _telnyxCallState.scriptIdsUsed.slice()` (snapshot de la Fase 35 leído el 21/08). En disco al arrancar este plan (2026-08-23) ese campo ya venía como `scriptIdsUsed: _scriptIdsFor(leadId)` + un campo adicional `scriptIdsAuto: _scriptIsAuto(leadId)` (cambio de 35-02/SCR-ATTR, posterior a esa lectura). El plan advierte "anclar por literal, no por número de línea" para exactamente este tipo de drift — se preservaron los campos tal como estaban en disco al mover el bloque, sin agregar ni quitar ninguno.

## Issues Encountered

- **Hueco de tiempo entre el commit de la Task 2 (`507cbc4`, 07:34:06Z) y el de la Task 3 (`05d2172`, 15:41:07Z): ~8h07m.** El trabajo real registrado entre esos dos puntos (lectura de 3 archivos de test existentes, ~8 invocaciones de `node -e` de verificación puntual, escritura de `tests/dispo-async-meta.test.js`, 2 corridas de la suite nueva, 2 ciclos de verificación por mutación con `git checkout --` de por medio, y 2 corridas completas de `npm test`) no explica por sí solo un hueco de 8 horas. No hay evidencia adicional en el entorno de ejecución para explicar la causa (no es atribuible a ningún cambio de código ni a un error) — se reporta el dato crudo del `git log` en vez de inventar una duración más prolija. No afectó al resultado: todo se verificó igual antes de cada commit.
- Mismo gotcha de CRLF que documentó 36-01 (`public/app.js`/`public/index.html` usan `\r\n` en disco): los dos scripts de mutación de Node necesitaron el literal con `\r\n` explícito para matchear — resuelto ajustando el literal, sin tocar código de producción.

## Verificación por mutación (paso 5 y 6 de `<verification>`)

Ambas mutaciones se aplicaron con un script de Node (no con edits manuales), se corrió `tests/dispo-async-meta.test.js`, y se restauró con `git checkout -- public/app.js` verificando `git status --short public/app.js` vacío antes de continuar.

1. **Insertar un `setTimeout(() => {}, 1)` falso justo después de la captura de `_dispoInitiated` (simula que la publicación de `_metaObj` quedó detrás de un `setTimeout`):**
   Falla exactamente el test *"el índice de `_pendingTelnyxCallMetadata[leadId] = _metaObj;` es MENOR que el del `setTimeout(() => {`"* — `AssertionError: expected 4143 to be less than 2091` — 26/27 tests siguieron verdes. Restaurado, diff vacío confirmado.
2. **Borrar el guard `if (_dispoInitiated) { … } else if (!reachedContact) {` → dejar solo `if (!reachedContact) {`:**
   Fallan exactamente los 2 tests que lo cubren: *"existe la rama `if (_dispoInitiated)` y está ANTES del `if (!reachedContact)`"* y *"`_autoMarkNoAnswer(leadId);` aparece una sola vez... y cae dentro de un `else if`"* — 25/27 siguieron verdes. Restaurado, diff vacío confirmado.

## Verificación de suites (paso 3 y 4 de `<verification>`)

- **Baseline REAL leído en disco antes de empezar (sin ningún edit):** `npx vitest run` → **118 archivos / 2080 tests, todos verdes** (coincide exacto con el cierre de 36-01).
- **Los 7 suites del `<verify>` de la Task 2, corridos SIN editarlos:** `tests/gate-destination.test.js tests/gate-next-step-ui.test.js tests/dial-hold.test.js tests/dispo-feedback.test.js tests/call-stage-surfaces.test.js` (5 del `<verify>` de la Task 2) + `tests/dial-sync.test.js tests/commitment-ui.test.js tests/act-ui-discard-material.test.js` (el resto del `<verification>` global) → **7 archivos / 214 tests, todos verdes**, `git diff --stat tests/` sin tocar ninguno de esos 7 archivos.
- **Suite nueva sola:** `npx vitest run tests/dispo-async-meta.test.js tests/dispo-feedback.test.js` → **53/53 verdes** (27 nuevos + 26 de 36-01, mínimo pedido: 16).
- **`npm test` completo, corrido 2 veces tras cerrar la Task 3:** **119 archivos / 2107 tests, todos verdes** las dos veces (delta vs baseline: +1 archivo, +27 tests, 0 fallos nuevos, 0 regresiones). Un warning benigno de teardown de worker de vitest (`Timeout terminating forks worker for test files tests/audio-health.test.js`) apareció en la segunda corrida sin afectar el resultado (119 passed igual) — no relacionado con este plan.
- `git diff --stat package.json package-lock.json` → vacío (no se instaló nada).
- `git diff --stat public/style.css` → vacío (este plan no lo tocó, a diferencia de 36-01).

## Requisito duro del CONTEXT: `telnyxCallMeta` provablemente no se perdió

Cómo se probó, sin depender de una llamada real (no hay browser ni línea Telnyx en el entorno de ejecución):

1. **Por fuente**: el índice de `_pendingTelnyxCallMetadata[leadId] = _metaObj;` es estrictamente menor al de `setTimeout(() => {` dentro de `_onTelnyxCallEnded` — confirmado con Node (`idxMeta 4072 < idxTimeout 6134`) y con el test dedicado.
2. **Por campos**: los 6 campos que el backend consume (`durationSecs` → `logEntry.duration`/`_estimateTelnyxCost`/el umbral `>=30` del funnel; `fromNumber`; `quickNote`; `scriptIdsUsed`) siguen presentes en el `_metaObj` movido — verificado con Node y con el test de campos.
3. **Por los 6 caminos**: `_consumeTelnyxMeta(leadId)` pasó de 5 call sites a 6 (declaración incluida: de 6 a 7 ocurrencias del literal) — el único que faltaba (el agendado) ahora consume, confirmado extrayendo el tramo del handler `call-sched-confirm` y verificando que contiene `if (telnyxMeta) body.telnyxCallMeta = telnyxMeta;`.
4. **Por mutación** (ver arriba): mover la publicación detrás de un `setTimeout` pone rojo exactamente el test que vigila esto — la red no es cosmética, atrapa la regresión real que rompería el requisito.

## Qué queda SIN verificar en vivo

No hay browser ni línea Telnyx en el entorno de ejecución de este plan (solo Node + vitest). Queda pendiente de la primera tanda real de llamadas post-deploy:

- **(a)** que el `callLog` de las llamadas nuevas siga trayendo `duration`, `fromNumber`, `cost` y `channel: 'telnyx_webrtc'` — en particular las llamadas marcadas dentro de los primeros ~500ms post-cuelgue, que es exactamente la ventana que este plan corrige.
- **(b)** que la biblioteca de Entrenamiento IA siga recibiendo transcripciones, sobre todo cuando el resultado se marca apenas se cuelga (antes de que `_stopCallRecordingAndBuffer` termine) — es el escenario nuevo que ejercita `_audioInFlight`.
- **(c)** que no aparezcan entries `no_answer` pegados detrás de un resultado manual al marcar SIN colgar primero (camino de `_finalizeActiveCallBeforeDisposition`).
- **(d)** que no vuelva la franja/traba de "llamada sin marcar" sobre una llamada ya marcada a mano (la franja visual está desactivada desde el 31/07 — `DISPO_STRIP_ENABLED = false` — pero el gate de Phase 20 sigue vivo y es lo que hay que observar).

El diagnóstico de (a)/(b) se hace con `transcript.recMeta` y el `callLog`, como en las rondas #141/#154/#157/#186-193 de CLAUDE.md.

## User Setup Required

None — no requiere configuración externa. Los cambios son 100% frontend estático, servidos por el mismo Express existente.

## Next Phase Readiness

- RESP-02 completo: el POST del resultado no espera ni al audio ni al handler diferido de cuelgue.
- `_audioInFlight`/`_dispoInitiated`/la metadata sincrónica quedan protegidos por `tests/dispo-async-meta.test.js` — cualquier plan futuro que toque `_onTelnyxCallEnded`/`_finalizeActiveCallBeforeDisposition`/`_flushPendingTranscription` tiene esta red antes de romper algo en silencio.
- 36-03 (RESP-03, pad DTMF visible/persistente) queda como el único plan pendiente de la fase — no depende de nada de este plan.
- Pendiente (no bloqueante): la pasada en vivo de los 4 ítems listados arriba, en cuanto haya una tanda real de llamadas post-deploy.

---
*Phase: 36-disp-disposicion-responde*
*Completed: 2026-08-23*

## Self-Check: PASSED

- FOUND: `tests/dispo-async-meta.test.js`
- FOUND: `public/app.js`
- FOUND: `public/index.html`
- FOUND commit `c90c3f8` (Task 1: feat)
- FOUND commit `507cbc4` (Task 2: feat)
- FOUND commit `05d2172` (Task 3: test)
- FOUND commit `656dc24` (docs: SUMMARY)
