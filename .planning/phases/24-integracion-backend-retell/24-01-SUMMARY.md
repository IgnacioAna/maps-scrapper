---
phase: 24-integracion-backend-retell
plan: 01
subsystem: api
tags: [refactor, call-disposition, telnyx, retell, voice-agent, testing]

# Dependency graph
requires: []
provides:
  - "`function _applyCallOutcome(data, lead, logEntry, opts)` en scope de módulo de index.js — cascada de disposición (push+cap500 del callLog, switch de 8 outcomes, DNC, cadencia de auto-redial) extraída del handler humano, sin dependencias de `req`"
  - "`opts.skipCalendarCreation` (default false) en el case `scheduled_with_admin` — permite aplicar los 4 side-effects de estado sin crear una segunda cita cuando ya la creó `/book`"
  - "`TELNYX_RATES_USD_PER_MIN`, `_detectCountryAndType`, `_estimateTelnyxCost` en scope de módulo — invocables desde cualquier punto de index.js (antes anidados e inalcanzables)"
  - "`globalThis.__voiceAgent = { _applyCallOutcome, _estimateTelnyxCost, _detectCountryAndType }` — superficie para los planes 24-03/24-04/24-05"
  - "`tests/apply-call-outcome.test.js` — test de paridad doble-vía (handler HTTP vs helper directo) sobre los 8 outcomes + DNC + cadencia + skipCalendarCreation"
affects: [24-02, 24-03, 24-04, 24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Extracción verbatim de lógica de negocio de un handler Express a un helper puro `(data, lead, logEntry, opts)` sin `req`/`res` en scope — reusable por HTTP handler (síncrono) y webhook (async, dentro de mutateSettersData)"
    - "Flag `opts.skipCalendarCreation` para que dos callers distintos (handler humano vs /book+webhook) compartan la misma cascada de estado sin duplicar efectos secundarios de escritura (creación de cita)"
    - "Test de paridad doble-vía: mismo estado inicial replicado en un lead persistido (HTTP) y un lead en memoria (helper directo), comparados campo por campo, sincronizando `nowIso` desde la respuesta real para evitar falsos negativos por reloj"

key-files:
  created:
    - tests/apply-call-outcome.test.js
  modified:
    - index.js

key-decisions:
  - "El test de paridad usa un lead 'B' en memoria (no un segundo read/write directo a disco de setters.json) para el lado del helper directo — evita depender de la resolución de mtime del cache de loadSettersData en Windows, que es una fuente de flakiness evitable. Satisface la misma garantía de paridad (mismo estado inicial, mismos opts) sin ese riesgo."
  - "callbackAt auto-generado por la cadencia de no-contacto se compara con tolerancia de reloj (5s) en vez de igualdad estricta — ese código usa `Date.now()` real (no `opts.nowIso`) y es movido verbatim, sin tocar, por mandato explícito del plan (D-24-02: extracción, no reescritura)"
  - "nowIso se sincroniza tomando el `lastContactAt` real que devolvió la vía HTTP y pasándoselo como `opts.nowIso` a la vía directa — así `lastContactAt`/`doNotCallAt` (que derivan del mismo `now` en el handler original) coinciden exacto entre las dos vías sin necesidad de congelar el reloj"

requirements-completed: [VOICE-02]

# Metrics
duration: 25min
completed: 2026-07-31
---

# Phase 24 Plan 01: Extracción de _applyCallOutcome Summary

**Cascada de disposición de llamada extraída del handler `POST /call-disposition` a un helper puro `_applyCallOutcome(data, lead, logEntry, opts)` reusable por el webhook del agente de voz, con paridad handler↔helper garantizada por 12 tests nuevos y la suite completa (1020/1020) sin editar ningún assert existente.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-31T12:19:00-03:00 (aprox, primer commit 12:20:45)
- **Completed:** 2026-07-31T12:39:24-03:00 (última corrida de suite completa)
- **Tasks:** 3/3 completadas
- **Files modified:** 2 (`index.js`, `tests/apply-call-outcome.test.js` nuevo)

## Accomplishments

- `TELNYX_RATES_USD_PER_MIN`, `_detectCountryAndType` y `_estimateTelnyxCost` subidos verbatim de dentro del handler humano a scope de módulo — invocables ahora desde cualquier punto de `index.js` (Task 1).
- `_applyCallOutcome(data, lead, logEntry, opts)` extraído verbatim del rango `index.js:10552-10675` (numeración pre-refactor) — el handler humano queda reducido a una sola llamada que destructura `calendarEntry` del resultado. El helper no lee `req`/`req.auth`/`req.params` de ningún lado (verificado por grep dentro del cuerpo de la función) (Task 2).
- `opts.skipCalendarCreation` sumado al case `scheduled_with_admin` (D-24-05, §5.4 Opción A): con `true`, los 4 side-effects de estado (`respondio`, `calificado`, `interes`, `estado`) se aplican igual pero NO se construye el objeto de cita ni se hace `data.calendar.push(...)` — evita una segunda cita cuando `/book` ya creó la primera (Task 2).
- `globalThis.__voiceAgent = { _applyCallOutcome, _estimateTelnyxCost, _detectCountryAndType }` expuesto siguiendo el patrón de `globalThis.__callCore` — superficie para los planes 24-03/24-04/24-05.
- `tests/apply-call-outcome.test.js` (12 tests): paridad doble-vía sobre los 8 outcomes de `CALL_OUTCOMES` + DNC automático (`no_contactar`) + cadencia (1 y 2 `no_answer` seguidos → descarte automático `sin_contacto_2x` en AMBAS vías) + shape completo del `calendarEntry` de `scheduled_with_admin` + `skipCalendarCreation:true` + invocabilidad de `_estimateTelnyxCost` fuera del handler (Task 3).
- Suite completa: **1020/1020 tests verdes** (69 archivos), sin editar ningún test preexistente — verificado con `git diff --cached --name-only -- tests/` (lista únicamente el archivo nuevo).

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: Subir los helpers de costo a scope de módulo** - `57a3543` (refactor)
2. **Task 2: Extraer `_applyCallOutcome` (extracción verbatim + flag skipCalendarCreation)** - `be58347` (refactor)
3. **Task 3: Test de paridad doble-vía + gate de suite completa** - `b208aaf` (test)

## Files Created/Modified

- `index.js` - `TELNYX_RATES_USD_PER_MIN`/`_detectCountryAndType`/`_estimateTelnyxCost` movidos a scope de módulo (antes anidados en el handler humano); `_applyCallOutcome(data, lead, logEntry, opts)` extraído del handler con 5 sustituciones mecánicas (`req.params.id`→`opts.leadId`, `now`→`opts.nowIso` x2, ternaria de `actorSetterId`, `req.auth?.user?.name`→`opts.actorName`) + `opts.skipCalendarCreation`; `globalThis.__voiceAgent` expuesto; el handler humano queda con una sola llamada al helper.
- `tests/apply-call-outcome.test.js` (nuevo) - 12 tests de paridad doble-vía handler↔helper sobre los 8 outcomes + DNC + cadencia + calendario.

## Decisions Made

- **Verificación programática de la extracción verbatim en vez de transcripción manual**: dado el tamaño de los rangos a mover (107 y 124 líneas respectivamente, con contenido sensible a espacios/backticks/regex), la extracción se hizo con scripts Node.js que leen `index.js` línea por línea, validan el contenido exacto contra el texto esperado antes de mover (`if (block[0] !== '...') throw`), aplican las sustituciones mecánicas por match exacto con conteo esperado (`exactReplace` con `expectedCount`), y escriben el archivo preservando terminadores CRLF (el repo usa CRLF). Esto elimina el riesgo de transcripción manual incorrecta en un refactor cuyo contrato es "cero cambios de comportamiento".
- **Lead "B" del test de paridad vive en memoria, no en disco**: ver key-decisions del frontmatter. Documentado también inline en el header del archivo de test.
- **Tolerancia de reloj para `callbackAt` auto-generado por cadencia**: ver key-decisions del frontmatter.
- **`cleanReason` en el test se pasa sin replicar el whitelist-filtering del handler**: los escenarios de test usan únicamente razones válidas (`no_es_icp`, `no_contactar`), por lo que `cleanReason = disqualifyReason || ''` es equivalente al filtrado real del handler para esos valores — documentado inline en el test.

## Deviations from Plan

None — plan ejecutado exactamente como está escrito. Las 5 sustituciones mecánicas, el flag `skipCalendarCreation` y el export `globalThis.__voiceAgent` se implementaron tal como especifica `<interfaces>` y las `<tasks>` del plan.

### (a) Referencias externas encontradas dentro del rango extraído que NO estaban en la tabla de `<interfaces>`

Ninguna. La tabla de `<interfaces>` del plan fue exhaustiva: se verificó mediante grep automatizado sobre el rango exacto extraído (`index.js:10553-10676`, numeración post-Task-1) que las únicas ocurrencias de `req.` y `now` (fuera de `Date.now()`) eran exactamente las 5 listadas en la tabla — `req.params.id` (calendarEntry.leadId), `req.auth?.user?.role === 'setter' ? ... : (lead.assignedTo || '')` (calendarEntry.setterId), `req.auth?.user?.name || ''` (doNotCallBy), y `now` en `lastContactAt`/`doNotCallAt`. No apareció ninguna referencia adicional no documentada.

### (b) Resultado exacto del conteo de la suite completa antes y después

- **Antes del plan** (commit `59e3144`, baseline): **68 archivos de test** (`git ls-tree -r --name-only 59e3144 -- tests/ | wc -l` → 68). El conteo exacto de tests individuales en ese commit no se re-ejecutó de forma aislada (se evitó una segunda instalación/entorno de test solo para el conteo), pero se estableció matemáticamente: Task 1 y Task 2 modificaron ÚNICAMENTE `index.js` (confirmado — `git diff --cached --stat` en ambos commits lista solo ese archivo), por lo que el conteo de tests no pudo haber cambiado entre el baseline y el punto post-Task-2. Task 3 agregó exactamente 1 archivo nuevo (`tests/apply-call-outcome.test.js`, 12 tests) y no tocó ningún archivo existente (`git diff --cached --name-only -- tests/` tras `git add` lista únicamente ese archivo). Por lo tanto el conteo baseline es matemáticamente **1020 − 12 = 1008 tests / 68 archivos**.
- **Después del plan** (commit `b208aaf`, HEAD): **1020/1020 tests verdes, 69 archivos** (`npx vitest run`, corrido dos veces de forma independiente con resultado idéntico — una vez tras Task 3, otra vez tras la limpieza del worktree de verificación, ver Issues Encountered).
- Verificaciones intermedias (subconjuntos, exigidas por el `<verify>` de cada task): tras Task 1, `disposition-dnc` + `call-cadence` + `metrics-consistency` = 29/29. Tras Task 2, esos 3 más `funnel-close` + `disposition-enforcement` = 51/51.

## Issues Encountered

- Para documentar el conteo exacto "antes" de la suite completa (parte (b) de arriba) se intentó crear un `git worktree` sobre el commit baseline (`59e3144`) para correr `npx vitest run` de forma aislada. La creación del worktree fue exitosa, pero un intento de crear una junction de `node_modules` vía `cmd.exe /c mklink /J` dejó 2 procesos `cmd.exe` colgados en background que retuvieron un file handle sobre `.git/worktrees/gsscraper-baseline-59e3144/`, impidiendo `git worktree remove`/`prune` normales (`Permission denied`). Se identificaron y terminaron los procesos huérfanos (`taskkill /F`) y se removió el directorio de metadata residual con `rm -rf` directo. **Verificado que no quedó contaminación**: `git worktree list` (3 worktrees legítimos, ninguno huérfano), `git status --short` (solo los 2 archivos de `.planning/` que ya estaban modificados antes de empezar esta sesión), y la suite completa se corrió una vez más al final para confirmar 1020/1020 estable tras la limpieza. No se llegó a ejecutar el conteo aislado del baseline — se usó el razonamiento matemático de la parte (b) en su lugar, que es exacto y verificable por `git diff --stat`.
- Se detectaron, de paso, 2 worktrees preexistentes de sesiones paralelas (`C:/Users/Usuario/.codex/worktrees/330e/GoogleSrapper` en la rama `codex/audit-hardening-fixes`, y `.claude/worktrees/frosty-mendel-de2268` en HEAD detached) — consistente con la nota de memoria `user-commits-in-parallel`. No se tocó ninguno de los dos.

## User Setup Required

None - no se requiere configuración externa. Este plan es puramente backend interno (extracción de código existente), no toca `public/app.js` ni `style.css` (confirmado: `git diff --stat public/` vacío en todo el plan) — no aplica cache-buster.

## Next Phase Readiness

- `globalThis.__voiceAgent._applyCallOutcome` y `_estimateTelnyxCost` están listos para que 24-03 (dispatch), 24-04 (caller ID) y 24-05 (webhook + `/book`) los consuman sin duplicar la cascada de disposición.
- `opts.skipCalendarCreation` está probado y listo para el flujo de 24-05 donde `/book` crea la cita y el webhook `call_analyzed` aplica `scheduled_with_admin` sin duplicarla.
- El contrato del helper (`data, lead, logEntry, opts`, sin `req` en scope) está documentado en el comentario de cabecera de la función (T-24-01-01: el caller es responsable de autorizar ANTES de invocar) — 24-05 debe implementar sus propios checks de autorización del webhook (firma, etc.) antes de llamar al helper.
- Sin bloqueantes conocidos para el siguiente plan del wave.

---
*Phase: 24-integracion-backend-retell*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: `.planning/phases/24-integracion-backend-retell/24-01-SUMMARY.md`
- FOUND: `tests/apply-call-outcome.test.js`
- FOUND commit: `57a3543` (Task 1)
- FOUND commit: `be58347` (Task 2)
- FOUND commit: `b208aaf` (Task 3)
