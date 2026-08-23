---
phase: 37-ses-sesion-discado
plan: 03
subsystem: ui
tags: [power-dialer, dial-session, ses-02, ses-04, frontend-puro]

# Dependency graph
requires:
  - phase: 37-01
    provides: "data.dialSessions persistido, POST abrir/cerrar sesión, _dialSessionActor/_dialSessionCounters expuestos en globalThis.__dialSessions"
  - phase: 37-02
    provides: "GET /dial-sessions (historial) y PATCH /dial-sessions/:id (mood), scope idéntico a cold-call-metrics"
provides:
  - "_pdSession (id/startedAt/opening/closing/payload/error): ciclo de vida de la sesión de discado en el cliente, separado de _pd"
  - "_pdSessionOpen()/_pdSessionClose({reason}): abrir/cerrar la sesión contra el backend de 37-01, fire-and-forget en la apertura, con 250ms de gracia antes del cierre"
  - "_pdShowClosing(reason): único renderizador de la pantalla de cierre, consumido por window._pdExit (salida manual) y por _pdAdvance (fin de cola) — SES-02"
  - "window._pdSessionMood(mood): PATCH del estado del operador desde 4 chips, opcional, nunca bloquea la salida — SES-04"
  - "bloque puro [37-03] SESSION-PURE (_sesDurationLabel, _sesClosingModel) expuesto en window.__ses — D-01 (la victoria es marcar) escrito en código"
affects: [37-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pantalla de cierre en dos fases dentro de la MISMA función pública (window._pdExit): primera llamada muestra el resultado sin esconder el panel, segunda llamada cierra de verdad — evita duplicar el punto de entrada que ya usan los 3 caminos existentes (botón, Esc, sidebar)"
    - "Botón de salida pintado ANTES de cualquier await de red (T-37-13): un cierre que falla nunca puede encerrar al SDR en el dialer"
    - "Gracia de 250ms entre la última acción del SDR y el POST de cierre, para que una disposición todavía en vuelo llegue a persistirse antes de que el servidor calcule los contadores con su propio reloj"
    - "Bloque puro de modelo de pantalla (SESSION-PURE) separado del render con DOM — mismo patrón que [33-04] HISTORY-PURE / [31-03] COMMITMENT-PURE / [30-02] GATE-PURE / [32-03] ACT-PURE"

key-files:
  created:
    - tests/dial-session-close-ui.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/dial-sync.test.js

key-decisions:
  - "_pdSession vive SEPARADO de _pd (no como un campo más del objeto grande): _pd se resetea entero en _pdStart y varias suites cuentan literales exactos sobre su forma (D-02/D-07 de fases anteriores) — mezclar el ciclo de vida de la sesión ahí hubiera roto esas cuentas sin necesidad"
  - "_pdSessionOpen() es fire-and-forget: si el POST de apertura falla, el dialer se abre igual y solo queda _pdSession.error=true — un dialer que no abre es un día perdido, una sesión sin registrar es 'solo' un dato perdido"
  - "_pdSessionClose nunca tira: cualquier falla (sin id, red caída, respuesta no-ok) devuelve {error:true}, que _sesClosingModel convierte en el modelo degradado (big.value cae al processed local, nunca un 0 de marcadas que sería mentira)"
  - "_pdShowClosing pinta el botón Salir en el PRIMER frame, antes de esperar el POST de cierre — el SDR nunca queda esperando a la red para poder irse (T-37-13)"
  - "window._pdExit queda con 2 fases en el MISMO handler en vez de un handler nuevo: los 3 caminos que ya lo llaman (botón, Esc, delegación del sidebar) siguen funcionando sin tocarlos"
  - "_pdExitFinal() es la extracción literal del cuerpo viejo de _pdExit — incluye el refresh explícito (loadHoyView()/loadCallsView()) documentado por DIAL-03, que se conserva tal cual"
  - "Deviation mínima justificada: 1 assertion de tests/dial-sync.test.js (pre-existente, fuera de files_modified de este plan) protegía que el refresh viviera literalmente DENTRO del cuerpo de window._pdExit — invariante que la propia Task 2 del plan invalida a propósito. Se actualizó esa única assertion para apuntar a _pdExitFinal(), preservando el comportamiento real que protege"

patterns-established:
  - "SESSION-PURE: modelo puro de una pantalla de resumen — pura entrada/salida, sin document/localStorage/fetch/Date.now/window, con el reloj y los datos variables SIEMPRE por parámetro, evaluable con new Function sin browser"

requirements-completed: [SES-02]

# Metrics
duration: ~21min
completed: 2026-08-23
---

# Phase 37 Plan 03: Ciclo de vida de la sesión de discado + pantalla de cierre única Summary

**El Power Dialer abre y cierra una sesión de discado de verdad: salir SIEMPRE muestra un marcador propio (marcadas arriba por D-01, desglose comercial abajo), la misma pantalla se usa tanto en la salida manual como al agotar la cola, y el estado del operador se pregunta una sola vez sin poder bloquear el cierre.**

## Performance

- **Duration:** ~21 min (13:41 → 14:02 hora local, commits `a4dbfee`, `2fff3d2`, `6d23171`)
- **Started:** 2026-08-23T13:41:00-03:00 (aprox, inmediatamente después de cerrar 37-02)
- **Completed:** 2026-08-23T14:02:05-03:00 (último commit de tareas; SUMMARY + verificación final después)
- **Tasks:** 3 (las 3 completas)
- **Files modified:** 4 (`public/app.js`, `public/index.html`, `tests/dial-session-close-ui.test.js` nuevo, `tests/dial-sync.test.js`)

## Accomplishments
- El resumen de la partida (D-02 de la Fase 37) deja de vivir escondido detrás de "agotar la cola entera" — con colas de decenas de leads eso no pasaba nunca, y cuando pasaba decía solo "Procesaste N leads". Ahora TODO camino de salida (botón, Esc, sidebar, fin de cola) termina en la misma pantalla con marcadas/atendieron/conversaciones/agendadas/desglose por resultado.
- D-01 (la victoria definida es marcar) quedó escrito en código, no solo en la decisión: `_sesClosingModel` nunca puede devolver `connects` ni `processed` como el número grande — es siempre `counters.dials`, aunque el resultado comercial haya sido cero.
- Un cierre que falla (backend caído, red cortada) nunca encierra al SDR: el botón Salir se pinta ANTES de esperar cualquier respuesta, y si la respuesta nunca llega, la pantalla muestra un modelo degradado honesto (los leads pasados localmente, con nota explicando que el resumen no se guardó) en vez de trabar el panel o mentir con un 0.
- El estado del operador (SES-04, la pieza que faltaba para explicar por qué el volumen de discado varía 8× entre semanas con el mismo guion) tiene 4 chips en la pantalla de cierre, se pregunta una sola vez y nunca bloquea la salida si el SDR no responde.

## Task Commits

Each task was committed atomically:

1. **Task 1: Bloque puro SESSION-PURE** - `a4dbfee` (feat)
2. **Task 2: Ciclo de vida de la sesión + pantalla de cierre única + chips de estado** - `2fff3d2` (feat)
3. **Task 3: Suite de SES-02/SES-04** - `6d23171` (test)

_Nota: Task 1 y Task 3 tenían `tdd="true"` en el plan, pero — mismo caso que 37-01/37-02 — la `<action>` de Task 1 es implementación pura (sin test propio) y la de Task 3 es una sola tarea de creación de test contra código ya existente de las Tasks 1-2. No hay ciclo RED/GREEN/REFACTOR de commits separados. La suite se verificó corriendo los 56 tests contra el código real (todos verdes al primer intento tras dos ajustes menores de redacción — ver "Issues Encountered")._

**Plan metadata:** (este commit, docs)

## Files Created/Modified
- `public/app.js` — bloque `[37-03] SESSION-PURE` (`_sesDurationLabel`, `_sesClosingModel`, expuestos en `window.__ses`) insertado antes de `_pdAdvance`; `_pdSession` (nuevo objeto de estado) declarado junto a `_pd`; `_pd` gana el flag `closing: false`; `_pdCurrentFilters()`, `_pdSessionOpen()`, `_pdSessionClose()`, `_pdRenderClosingScreen()`, `_pdShowClosing()`, `window._pdSessionMood()` nuevos; `window._pdExit` reescrito en 2 fases con `_pdExitFinal()` extraída; `_pdAdvance` reemplaza su HTML de fin de cola por `_pdShowClosing('cola_completa')` y gana el guard `if (_pd.closing) return;` (igual que `_pdRender`); el handler de teclado del dialer gana el guard `if (_pd.closing && e.key !== 'Escape') return;`; `window._pdStart` llama a `_pdSessionOpen()` y resetea `_pdSession`/`_pd.closing` junto a `_pd.active = true`.
- `public/index.html` — cache-buster `app.js?v=20260823a` → `20260823b`. `style.css?v=` sin tocar.
- `tests/dial-session-close-ui.test.js` — suite nueva, 56 tests (el plan pedía mínimo 20).
- `tests/dial-sync.test.js` — 1 assertion actualizada (ver "Deviations from Plan").

## Decisions Made

Ver `key-decisions` en el frontmatter — resumen: `_pdSession` separado de `_pd`, apertura fire-and-forget, cierre que nunca tira, botón Salir pintado antes de cualquier red, `_pdExit` en 2 fases sin duplicar el punto de entrada, `_pdExitFinal()` como extracción literal del cuerpo viejo (refresh de DIAL-03 conservado tal cual).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/dial-sync.test.js` protegía un invariante que la propia Task 2 del plan invalida a propósito**
- **Found during:** Task 3 (verificación de los suites vecinos que el plan pide correr sin editar)
- **Issue:** `tests/dial-sync.test.js` (pre-existente, de la Fase 33, fuera de `files_modified` de este plan) tenía una assertion que verificaba que `loadHoyView()`/`loadCallsView()` vivieran literalmente DENTRO del cuerpo de `window._pdExit = function() {...}`. La propia Task 2 del plan (punto 7 de `<action>`) pide explícitamente "extraer el cuerpo actual a `_pdExitFinal()` ... y refrescar la vista de origen — ese refresh explícito se conserva tal cual" — es decir, el plan mismo requiere mover ese refresh a una función nueva, invalidando la ubicación exacta que la assertion vieja verificaba.
- **Fix:** Se actualizó la única assertion afectada para verificar el invariante REAL que protege (salir del dialer sigue haciendo un refresh explícito con fetch completo, no un repintado sin red) en su nueva ubicación: `window._pdExit` llama a `_pdExitFinal()`, y `_pdExitFinal()` contiene `loadHoyView()`/`loadCallsView()`. El comportamiento funcional no cambió en absoluto — solo la línea exacta del archivo donde vive el literal.
- **Files modified:** `tests/dial-sync.test.js` (1 test, sin agregar ni quitar tests — sigue en 34).
- **Verification:** `npx vitest run tests/dial-sync.test.js` → 34/34 verde.
- **Committed in:** `6d23171` (Task 3 commit, junto a la suite nueva)

---

**Total deviations:** 1 auto-fixed (Rule 1 — assertion desactualizada por un refactor explícitamente pedido por el propio plan)
**Impact on plan:** El único ajuste fuera de `files_modified` fue de una línea, en un archivo de pruebas, para reflejar un cambio de forma que el plan pidió literalmente. Cero cambio de comportamiento, cero scope creep.

## Issues Encountered

Dos ajustes menores de redacción en comentarios del bloque `SESSION-PURE`, encontrados por la propia suite de Task 3 antes de terminar Task 1/2:
1. El comentario introductorio del bloque mencionaba literalmente `document`/`localStorage`/`fetch(`/`Date.now(`/`window.`/`_pdTodayStats`/`callsLeadsCache` (para EXPLICAR qué el bloque NO usa) — eso hacía que el propio grep de aceptación de la Task 1 ("el texto entre los marcadores no contiene...") fallara contra su propio comentario. Reescrito para describir lo mismo sin esos tokens literales.
2. Mismo problema con el literal `"Procesaste "` dentro de un comentario de `_pdAdvance` que explicaba qué HTML se reemplazó — reescrito sin el literal exacto, ya que el grep de aceptación ("`Procesaste ` no aparece en NINGÚN lado del archivo") es literal, no distingue código de comentario.

Ninguno de los dos fue un bug de comportamiento — ambos se detectaron y corrigieron ANTES de cualquier commit, corriendo los greps de aceptación del propio plan como verificación intermedia.

## Verificación

- `node --check public/app.js` → exit 0 (corrido después de cada task).
- `npx vitest run tests/dial-session-close-ui.test.js` → **56/56 verdes** (aislado; el plan pedía mínimo 20).
- `npx vitest run tests/dial-session-close-ui.test.js tests/dial-hold.test.js tests/dial-start-at.test.js tests/gate-destination.test.js tests/dial-session-model.test.js tests/dial-session-history.test.js tests/dispo-feedback.test.js tests/dispo-async-meta.test.js tests/hoy-dialer-hygiene.test.js tests/dial-sync.test.js` → **306/306 verdes** (10 archivos, incluye los 4 "vecinos" que el plan pide correr sin editar — `dial-sync.test.js` requirió el ajuste de 1 línea documentado arriba).
- `npm test` completo (`npx vitest run`), corrida en background por su duración: **123/123 archivos, 2232/2232 tests, 0 fallos** (baseline pre-plan real de 37-02: 122/2176 → delta exacto: +1 archivo, +56 tests, 0 regresiones).
- `git diff --stat package.json package-lock.json` → vacío (no se instaló nada).
- Greps de aceptación de la Task 1 y Task 2 (todos verificados con `node -e` programático, valor esperado):
  - Marcadores `[37-03] SESSION-PURE: INICIO`/`: FIN` → 1 cada uno; `_sesDurationLabel`/`_sesClosingModel` declaradas DENTRO del rango.
  - El bloque entre marcadores NO contiene `document`, `localStorage`, `fetch(`, `Date.now(`, `window.`, `_pdTodayStats`, `callsLeadsCache`, `answered_interested:` (verificado programáticamente, no solo por lectura).
  - `grep -c "_pdShowClosing"` → 7 (≥3 pedido); `grep -c "Procesaste "` → 0; `grep -c "_pd\.closing"` → 8 (≥5 pedido).
  - `window._pdSessionMood`/`_pdSessionOpen` existen; `window._pdSessionOpen`/`window._pdSessionClose` → 0 ocurrencias (no expuestas, mismo criterio que `_pdHold`).
  - `app.js?v=` en `index.html` → forma válida, `20260823b` > `20260823a` (baseline real), aparece 1 sola vez; `style.css?v=` sin tocar.
  - `git diff` de `public/app.js` (Task 2, contra el estado post-Task-1) NO toca: `_pdHold`, `_pdKeyOutcomes`, `_pdToggleAutopilot`, `_pdStartAutopilotCountdown`, `_pdTodayStats`, `_pdGetGoal`, `_pdRenderToday`, `_pdBuildQueue`, `_pdBuildQueueHoy` (verificado con grep sobre el diff, 0 coincidencias).
  - `_pdSessionOpen()` se llama dentro de `window._pdStart`, en índice de posición POSTERIOR al último `return;` de los early-return de cola vacía (verificado programáticamente).
  - Los 3 `fetch(` nuevos (abrir/cerrar/PATCH mood) usan `apiUrl(` — 0 fetch crudo.

### Qué se verificó en preview y qué no

**No se pudo hacer verificación en preview con browser real en esta sesión** — el executor no tuvo ninguna herramienta de navegador/preview expuesta (solo Read/Write/Edit/Bash/Grep/Glob). El punto 5 de `<verification>` del plan (login real, abrir el dialer desde Llamadas, salir con Esc, repetir desde Hoy, confirmar en `setters.json` que la sesión quedó con `endedAt`/`counters`/`mood`, consola sin errores) queda **pendiente de una verificación manual del user o de una sesión futura con herramienta de browser disponible**.

Como compensación, se verificó exhaustivamente por otras vías:
- Los 56 tests de la suite nueva cubren CADA criterio de aceptación del plan de forma aislada (el modelo puro evaluado con `new Function` contra payloads que imitan exactamente el contrato que devuelve el backend real de 37-01/37-02, y aserciones de fuente sobre cada punto del cableado).
- Los IDs de DOM que `_pdShowClosing`/`_pdRenderClosingScreen` usan (`pd-current-content`, `pd-queue`, `pd-progress`, `#power-dialer`) se confirmaron contra `public/index.html` — existen y son los mismos que ya usaba el código viejo.
- Los 3 endpoints que el frontend consume (`POST /dial-sessions`, `POST /dial-sessions/:id/close`, `PATCH /dial-sessions/:id`) están probados end-to-end en `tests/dial-session-model.test.js` y `tests/dial-session-history.test.js` (37-01/37-02), sin editar en este plan.

### Límite conocido: la gracia de 250ms

Si una disposición tarda MÁS de 250ms en persistir en el servidor desde que el SDR pide salir, esa marca queda AFUERA del resumen de esa sesión puntual (el POST de cierre ya se disparó). No es un bug — es un límite documentado explícitamente en el código y en el threat model del plan (T-37-14, disposición aceptada): el número canónico del día para cualquier decisión real sigue siendo el de Mi rendimiento / Cold Call Funnel (CALL METRICS CORE), no el de esta pantalla puntual. La pantalla de cierre es un marcador de la PARTIDA, no la fuente de verdad de las métricas — eso lo sigue siendo el CORE, sin excepción (SES-05).

## Qué queda para 37-04

- **37-04** (Mi rendimiento) consume `GET /api/setters/dial-sessions` (37-02, contrato congelado desde entonces) para mostrar la tabla "Sesiones de discado" — hoy contra ayer, con la respuesta de estado del operador a la vista. No necesita ningún endpoint nuevo: los 4 de `dialSessions` (abrir/cerrar/historial/mood) ya están completos y consumidos end-to-end por el Power Dialer desde este plan.
- Sin bloqueos conocidos para continuar con 37-04, salvo la verificación en preview con browser real que quedó pendiente (ver arriba).

## Self-Check

- `public/app.js`: FOUND (modificado, `node --check` OK)
- `public/index.html`: FOUND (modificado, cache-buster bumpeado)
- `tests/dial-session-close-ui.test.js`: FOUND (creado, 56 tests, todos verdes)
- `tests/dial-sync.test.js`: FOUND (modificado, 34/34 verdes)
- Commit `a4dbfee`: FOUND en `git log`
- Commit `2fff3d2`: FOUND en `git log`
- Commit `6d23171`: FOUND en `git log`

## Self-Check: PASSED

---
*Phase: 37-ses-sesion-discado*
*Completed: 2026-08-23*
