---
phase: 35-scr-atribucion-guion
plan: 01
subsystem: api
tags: [express, call-disposition, script-attribution, telnyx, vitest]

# Dependency graph
requires:
  - phase: 34-hoy-vista-diaria
    provides: "callStage/callStageAuto — mismo idioma de whitelist-and-coerce + gate por outcome que este plan replica para guiones"
provides:
  - "call-disposition acepta scriptIdsUsed/scriptIdsAuto desde el nivel superior del body (no solo dentro de telnyxCallMeta)"
  - "whitelist de scriptIds contra el banco real (data/call_scripts.json) vía _knownScriptIds/_sanitizeScriptIds"
  - "gate por outcome (SCRIPT_RELEVANT_OUTCOMES, Set propio) — solo llamadas donde alguien atendió"
  - "scriptIdsAuto distingue atribución automática de la registrada por una persona, y sobrevive a la corrección de una auto-marca"
  - "GET /api/telnyx/script-effectiveness expone coverage.withScriptsManual/withScriptsManualPct y scripts[].usedManual"
affects: ["35-02 (siembra automática del guion al iniciar la llamada)", "35-03 (selector en las 4 superficies)", "35-04 (script de cobertura npm run coverage:script)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Whitelist-and-coerce contra un banco real de datos (data/call_scripts.json), nunca 400 — mismo patrón que ACT_WA_TEMPLATE_IDS y callStage"
    - "Flag *Auto (scriptIdsAuto) para distinguir lo derivado/automático de lo registrado por una persona, mismo idioma que callStageAuto"
    - "Gate por outcome compartido conceptualmente con callStage pero declarado como Set PROPIO (no alias) porque hoy coinciden y mañana pueden divergir"

key-files:
  created:
    - tests/script-attribution.test.js
  modified:
    - index.js
    - tests/call-stage.test.js

key-decisions:
  - "SCRIPT_RELEVANT_OUTCOMES es un Set independiente de CALL_STAGE_RELEVANT_OUTCOMES, no una referencia — hoy son los mismos 6 outcomes pero son preguntas distintas"
  - "El flag scriptIdsAuto lo decide el body cuando trae scriptIdsUsed en el nivel superior (gana sobre telnyxCallMeta.scriptIdsAuto) — la superficie más nueva es la que manda, pensando en la segunda oportunidad de SCR-03"
  - "_knownScriptIds() se llama SOLO dentro de la rama que ya tiene candidatos y outcome relevante, para no leer call_scripts.json en cada disposición sin atribución"
  - "SCR-01/SCR-03/SCR-04 NO se marcan completos en REQUIREMENTS.md: el propio texto del plan dice que cierran recién con 35-03/35-04 — este plan es solo el contrato backend"

requirements-completed: []

# Metrics
duration: ~35min
completed: 2026-08-22
---

# Phase 35 Plan 1: Contrato de atribución de guion Summary

**`call-disposition` acepta y sanea `scriptIdsUsed`/`scriptIdsAuto` desde cualquier superficie (no solo `telnyxCallMeta`), y `script-effectiveness` distingue cobertura automática de cobertura registrada por una persona.**

## Performance

- **Duration:** ~35 min (commits entre 17:56 y 18:05 -03:00; más verificación por mutación, suite completa x2 y recuperación de un error propio de `git checkout`, documentado abajo)
- **Started:** 2026-08-22T17:50:00-03:00 (aprox)
- **Completed:** 2026-08-22T21:15:00Z
- **Tasks:** 3 (+ 1 deviation fix)
- **Files modified:** 3 (`index.js`, `tests/script-attribution.test.js` nuevo, `tests/call-stage.test.js`)

## Accomplishments

- El contrato de datos de la atribución de guion está abierto: cualquier
  superficie (Power Dialer, lista, ficha, panel de llamada) puede mandar
  `scriptIdsUsed` en el nivel superior del body de `call-disposition` y se
  persiste, saneado contra el banco real de guiones.
- `scriptIdsAuto` distingue lo que atribuyó el sistema por defecto (que va a
  sembrar 35-02) de lo que cargó/corrigió una persona, y ese distingo
  sobrevive a la corrección de una auto-marca (`correctsAutoMarked`).
- `GET /api/telnyx/script-effectiveness` ya puede reportar `coverage.withScriptsManual`
  para cuando 35-02 haga saltar `coverage.withScripts` a casi 100% — sin esto
  el 100% total sería ilegible.

## Task Commits

1. **Task 1: contrato de atribución en call-disposition** - `0680249` (feat)
2. **Task 2: cobertura auto vs manual en script-effectiveness** - `67abff3` (feat)
3. **Task 3: suite HTTP del contrato de atribución** - `b441647` (test)
4. **Deviation: registrar sc_opener_a en el banco fijo de call-stage.test.js** - `d7f1e49` (fix)

**Plan metadata:** (este commit)

## Files Created/Modified

- `index.js` — bloque `SCRIPT_RELEVANT_OUTCOMES`/`MAX_SCRIPT_IDS_PER_CALL`/`MAX_SCRIPT_ID_LEN`/`_knownScriptIds`/`_sanitizeScriptIds` (junto a `CALL_STAGES`, ~línea 12696); atribución unificada en `call-disposition` (~línea 12870, inmediatamente después del bloque `callStage`); vaciado el bloque viejo dentro de `telnyxCallMeta` (Sprint 12); `'scriptIdsAuto'` sumado a la lista de campos heredados en corrección; `script-effectiveness` con `gl.withScriptsManual`, `_blank().usedManual`, `coverage.withScriptsManual`/`withScriptsManualPct`.
- `tests/script-attribution.test.js` (nuevo) — 14 tests HTTP cubriendo los 9 comportamientos del plan.
- `tests/call-stage.test.js` — fixture `call_scripts.json` agregado para registrar `sc_opener_a` (deviation, ver abajo).

## Contrato final (para 35-02/35-03/35-04 — nombres exactos, dados por fijos)

**Body de `POST /api/setters/leads/:id/call-disposition`:**
- `scriptIdsUsed: string[]` — nivel superior del body. Candidatos concatenados
  con `telnyxCallMeta.scriptIdsUsed` (si viene), deduplicados preservando el
  orden de aparición (telnyxCallMeta primero, luego el nivel superior).
- `scriptIdsAuto: boolean` — nivel superior del body. Solo se evalúa si el
  body trae `scriptIdsUsed` en el nivel superior con al menos 1 elemento; si
  no, se usa `telnyxCallMeta.scriptIdsAuto`. Solo el booleano estricto `true`
  persiste algo — `false` o ausente NO agrega el campo al entry.

**`telnyxCallMeta` (sin cambios de forma, mismo shape que ya existía):**
- `telnyxCallMeta.scriptIdsUsed: string[]` — sigue aceptándose, ahora unido
  (no reemplazado) con el del nivel superior.
- `telnyxCallMeta.scriptIdsAuto: boolean` — nuevo campo opcional, se usa
  SOLO si el body no trae `scriptIdsUsed` en el nivel superior.

**Entry del `callLog` (`logEntry`):**
- `scriptIdsUsed?: string[]` — presente SOLO si quedó al menos 1 id
  válido tras sanear (whitelist contra el banco + tope 20). Si no, el campo
  está AUSENTE (nunca `[]`).
- `scriptIdsAuto?: true` — presente SOLO cuando la atribución fue
  automática. Ausencia = una persona lo cargó/corrigió (mismo idioma que
  `callStageAuto`).

**`GET /api/telnyx/script-effectiveness` — campos nuevos, sin tocar los previos:**
- `coverage.withScriptsManual: number` — llamadas con guion atribuido por
  una persona (`scriptIdsAuto !== true`), sobre `coverage.calls`.
- `coverage.withScriptsManualPct: number|null`.
- `scripts[].usedManual: number` — mismo split, por scriptId.

**Constantes/helpers en `index.js`, expuestos en `globalThis.__scriptAttr`:**
`SCRIPT_RELEVANT_OUTCOMES` (Set: `answered_interested`,
`answered_not_interested`, `hung_up`, `callback_later`,
`scheduled_with_admin`, `placeholder_sent`), `MAX_SCRIPT_IDS_PER_CALL` (20),
`_sanitizeScriptIds(candidates, knownIds)`.

## Decisions Made

- `SCRIPT_RELEVANT_OUTCOMES` se declaró como **Set propio**, no como alias
  de `CALL_STAGE_RELEVANT_OUTCOMES`, tal como pedía el plan explícitamente
  — documentado en un comentario largo en `index.js` para que nadie lo
  "simplifique" a una referencia compartida en el futuro.
- Resolución del flag `scriptIdsAuto`: gana el body si trae `scriptIdsUsed`
  en el nivel superior (aunque explícitamente mande `false`, que overridea
  un `telnyxCallMeta.scriptIdsAuto: true`) — verificado con un test
  dedicado (`describe("unión con telnyxCallMeta + resolución del flag")`).
- **SCR-01/SCR-03/SCR-04 NO se marcaron `[x]` en REQUIREMENTS.md**, pese a
  estar en el frontmatter `requirements` del plan: el propio `<objective>`
  del plan dice textualmente "no toca `public/` (por diseño: sin frontend
  no hay nada visible todavía — SCR-01/SCR-03 se cierran recién con
  35-03)" y SCR-04 pide un `npm run coverage:script` que no existe todavía
  (es 35-04). Marcarlos completos habría sido falso. Solo se actualizó el
  checkbox del plan 35-01 en ROADMAP.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/regresión propia] `tests/call-stage.test.js` rompía tras el whitelist nuevo**
- **Found during:** verificación `npm test` completo (paso 4 de `<verification>`)
- **Issue:** `tests/call-stage.test.js` (Phase 34, 2026-08-16) mandaba
  `scriptIdsUsed: ['sc_opener_a']` dentro de `telnyxCallMeta` confiando en
  el comportamiento VIEJO (cualquier string se persistía sin whitelist). Con
  el whitelist nuevo de esta plan (T-35-01, comportamiento intencional), un
  id que no existe en ningún banco ya no se persiste — y este test no
  escribía ningún `call_scripts.json` fixture, así que caía al lazy-init
  del seed real (`scripts/seed/call-scripts.json`, que no tiene
  `sc_opener_a`).
- **Fix:** se agregó un `call_scripts.json` fijo en el `tmpData` de ese test
  con `sc_opener_a` registrado, ANTES del `await import("../index.js")` —
  mismo patrón que el resto de la suite. El test sigue probando lo mismo
  que probaba (atribuir `callStage` al guion usado), no la whitelist.
- **Files modified:** `tests/call-stage.test.js`
- **Verification:** `npx vitest run tests/call-stage.test.js` → 11/11 verde.
- **Committed in:** `d7f1e49`

---

**Total deviations:** 1 auto-fixed (Rule 1 — regresión causada por este mismo plan en un test vecino, no anticipada por el plan)
**Impact on plan:** Necesario para que el whitelist (comportamiento intencional del plan, T-35-01) no rompa la suite. Sin scope creep — el fix es 8 líneas, un fixture, cero cambios de comportamiento en `index.js`.

## Issues Encountered

**Error propio durante la verificación de baseline (recuperado, sin pérdida de trabajo del plan):** para medir el `npm test` "antes" real (pedido explícito del `<output>` del plan), usé `git checkout 99349bc -- .` para restaurar temporalmente `index.js`/tests al estado pre-plan. Ese comando también sobre-escribió, SIN aviso, dos archivos que tenían modificaciones locales SIN COMMITEAR *previas a esta sesión* — `.planning/STATE.md` (el orquestador ya había movido "Current Position" a Phase 35 EXECUTING antes de spawnearme) y `.planning/config.json` (`use_worktrees: false` faltante). `git checkout <commit> -- <path>` no es como cambiar de rama: sobre-escribe sin chequear conflictos.
Reconstruido a partir del contenido que había leído con el `Read` tool al arrancar (antes de tocar nada): `config.json` quedó byte-a-byte igual al original (diff de 3 líneas, idéntico al que existía al inicio de la sesión). `STATE.md` se reconstruyó fielmente en SUSTANCIA (Phase 35 EXECUTING, progreso 7/10 fases y — ahora — 26/36 planes) pero no byte-a-byte: el original tenía líneas de continuación huérfanas (evidencia de una escritura parcial fallida de `gsd-sdk`, documentada en el propio historial del archivo), así que se reescribió limpio en vez de reproducir el defecto. Aparte, probé una vez `gsd-sdk query state.advance-plan` (con backup previo) para seguir el protocolo — confirmó el bug documentado en el propio STATE.md: hace un reemplazo de solo la primera línea de cada campo (`Phase:`/`Status:`/`Last activity:`) y deja huérfanas las líneas de continuación viejas, y de paso corrompió un bloque de status HISTÓRICO no relacionado (Phase 20, "Executing Phase 30" → "Ready to execute"). Revertido inmediatamente desde el backup; **el resto de esta sesión actualizó STATE.md/ROADMAP.md a mano**, como documentan explícitamente las sesiones anteriores del propio archivo.
**Lección para la próxima ejecución de este tipo de baseline:** usar `git worktree` o clonar a un directorio temporal en vez de `git checkout <commit> -- .` sobre el árbol de trabajo activo — o al menos `git stash push -- <paths exactos que se van a tocar>` antes (nunca `git stash` a secas, por la prohibición de refs/stash compartido en worktrees, pero acá no había worktree real así que un stash acotado a esos 2 paths habría sido seguro y reversible).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- El contrato backend está cerrado y verificado: 35-02 puede sembrar
  `scriptIdsUsed`/`scriptIdsAuto: true` al iniciar la llamada sin tocar
  `index.js` de nuevo.
- 35-03 puede cablear el selector en las 4 superficies y mandar
  `scriptIdsUsed` (con o sin `scriptIdsAuto`) desde cualquiera de ellas —
  el backend ya lo acepta.
- 35-04 puede leer `coverage.withScriptsManual`/`withScriptsManualPct` y
  `scripts[].usedManual` para el script `npm run coverage:script`.
- **Sin verificar en vivo** (explícitamente fuera de este plan, por diseño):
  que una disposición real de producción llegue con `scriptIdsUsed` — nada
  en `public/` lo manda todavía. Eso es 35-02.

## Baseline de `npm test`

- **Antes del plan** (`index.js`/tests en el estado del commit `99349bc`,
  medido restaurando temporalmente el árbol de trabajo): **113 archivos,
  1984 tests, 1984 pasando.**
- **Después del plan** (con los 4 commits de esta sesión aplicados):
  **114 archivos, 1998 tests, 1998 pasando** (+1 archivo nuevo
  `tests/script-attribution.test.js` con 14 tests; los 0 tests netos
  restantes son el fixture-fix de `call-stage.test.js`, que no agrega
  tests, solo corrige uno existente).
- Verificación por mutación (Task 3, pedida por el plan): se quitó
  temporalmente el gate `SCRIPT_RELEVANT_OUTCOMES.has(outcome)` y los 2
  tests de gate (`no_answer`/`voicemail`) se pusieron en rojo exactamente
  como se esperaba; restaurado con `git checkout -- index.js`, diff vacío
  confirmado antes de continuar.
- `git diff --stat public/` — vacío, confirmado. Sin cambio de
  cache-buster (este plan no toca frontend).

## Self-Check

- `index.js` contiene `SCRIPT_RELEVANT_OUTCOMES`: **FOUND**
  (`grep -c` > 0).
- `tests/script-attribution.test.js` existe en disco: **FOUND**.
- Commits en `git log`: `0680249`, `67abff3`, `b441647`, `d7f1e49` — los
  4 **FOUND** en `git log --oneline`.

## Self-Check: PASSED

---
*Phase: 35-scr-atribucion-guion*
*Completed: 2026-08-22*
