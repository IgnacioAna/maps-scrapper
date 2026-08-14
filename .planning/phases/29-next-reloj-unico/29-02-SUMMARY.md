---
phase: 29-next-reloj-unico
plan: 02
subsystem: backend
tags: [nextAction, callbackAt, cadencia, callback-manual, disposition, call-center]

requires:
  - phase: 29-01
    provides: "modelo nextAction (_setNextAction/_clearNextAction/_leadNextAction/_deriveNextActionFromLegacy), whitelists, espejo con callbackAt en los 7 writers existentes"
provides:
  - "_applyCallOutcome escribiendo el reloj único: consume el próximo paso al entrar (NEXT-04/D-08), programa uno nuevo en callback_later (origen manual) y en el reintento de cadencia (origen cadencia)"
  - "manualCallbackByOwner ('En seguimiento') leyendo nextAction.origen en vez de inspeccionar el callLog a mano (D-09)"
  - "paridad humano↔agente de voz extendida a nextAction (tests/apply-call-outcome.test.js)"
  - "tests/next-action-disposition.test.js: 11 tests de comportamiento del reloj único en disposiciones"
affects: [30-gate-proximo-paso, 31-compromisos, agente-de-voz-v3.0-parkeado]

tech-stack:
  added: []
  patterns:
    - "Consumo-al-entrar generalizado de callbackAt a nextAction (_clearNextAction al inicio de _applyCallOutcome, antes del switch)"
    - "Dos únicos puntos de escritura de nextAction dentro de _applyCallOutcome: callback_later (origen manual) y reintento de cadencia (origen cadencia) — el resto de las ramas solo consumen"

key-files:
  created:
    - tests/next-action-disposition.test.js
  modified:
    - index.js
    - tests/apply-call-outcome.test.js

key-decisions:
  - "El delta de 'En seguimiento' contra datos reales de producción fue 0 (no el 3-4 leads estimado por el contexto) — el único candidato con followUps activo y sin callbackAt (l_mybajadental_6192729060) no calificó como manual en NINGUNO de los dos criterios porque su último callLog entry lo hizo un user ya eliminado (nota #149: _callSetterId no cae al assignedTo cuando el `by` no resuelve), así que la atribución por dueño falla igual en el criterio viejo y en el nuevo."
  - "callback_later se envolvió en un bloque { } dentro del switch (antes no lo necesitaba) porque _setNextAction se llama con una const local (_cbDueAt) — sin el bloque, la declaración chocaría con otras ramas del mismo switch en modo estricto."

requirements-completed: [NEXT-02, NEXT-04]

duration: ~15min
completed: 2026-08-14
---

# Phase 29 Plan 02: _applyCallOutcome sobre el reloj único Summary

`_applyCallOutcome` — la función que Ignacio ejecuta decenas de veces por día
y que comparte el webhook del agente de voz — ahora escribe y consume
`nextAction` en vez de tocar `callbackAt` a mano en cada rama. El
comportamiento visible queda byte por byte idéntico: misma fecha de
cadencia, mismo descarte al 2do no-contacto, misma excepción de interesados,
mismo tope de cortes, mismos números de funnel. "En seguimiento" ahora se
lee de `nextAction.origen === 'manual'` en vez de inspeccionar el último
outcome del callLog, y el conjunto de leads que cuenta no perdió ni ganó
ninguno contra una copia de los datos reales de producción.

## Performance

- **Duration:** ~15 min
- **Tasks:** 3 (todas `type="auto"`)
- **Files modified:** 3 (`index.js`, `tests/apply-call-outcome.test.js`, `tests/next-action-disposition.test.js`)

## Accomplishments

- Los 5 sitios de escritura del reloj dentro de `_applyCallOutcome` pasaron a
  `_clearNextAction`/`_setNextAction`: entrada (consumo, NEXT-04), rama
  `callback_later` (origen manual), tope de cortes (descarte), cadencia
  (descarte al 2do no-contacto) y cadencia (reintento a +24h, origen
  cadencia). Cero asignación directa de `callbackAt` dentro de la función.
- `manualCallbackByOwner` (el número detrás de "En seguimiento") migrado a
  `_leadNextAction(l).origen === 'manual'`, preservando la atribución por
  dueño actual sin tocarla.
- `tests/apply-call-outcome.test.js` compara `nextAction` entre la vía HTTP
  (handler humano) y el helper directo (vía del webhook del agente de voz),
  con el mismo tratamiento de tolerancia de reloj que ya tenía `callbackAt`.
- `tests/next-action-disposition.test.js` (11 tests) fija el comportamiento:
  callback manual con/sin fecha, cadencia 1er/2do no-contacto, excepción de
  interesados, consumo del compromiso pendiente (fresco y vencido — el caso
  real del 2026-08-12), tope de cortes, terminales sin próximo paso hoy, y
  lectura sin migración de un lead legacy vía `GET /leads/sin-wsp`.

## Task Commits

1. **Task 1: `_applyCallOutcome` escribe y consume el reloj único** - `85e8543` (feat)
2. **Task 2: "En seguimiento" se lee del origen del próximo paso + paridad con el agente de voz** - `1f95ed4` (feat)
3. **Task 3: Tests de comportamiento del reloj único en disposiciones** - `b2fee7a` (test)

_No hubo commit de plan metadata separado — este SUMMARY se commitea junto a los updates de STATE/ROADMAP/REQUIREMENTS en el commit final._

## Files Created/Modified

- `index.js` — `_applyCallOutcome` (5 sitios de escritura migrados a `_setNextAction`/`_clearNextAction`) y `GET /api/setters/leads/sin-wsp` (`manualCallbackByOwner` derivado de `nextAction.origen`)
- `tests/apply-call-outcome.test.js` — `nextAction` sumado a `COMPARE_FIELDS` con comparación campo a campo (tolerancia de reloj en `dueAt`)
- `tests/next-action-disposition.test.js` (nuevo) — 11 tests de comportamiento

## Decisions Made

- **Delta de "En seguimiento" = 0, no 3-4 como estimaba el contexto.** Verificado con un script de solo-lectura sobre una copia de `data/setters.json` + `data/auth.json` (nunca el archivo del repo), reusando `_leadNextAction`/`_callSetterId`/`_buildUserSetterMap` reales importados de `index.js` apuntando a la copia vía `DATA_DIR`. Resultado: VIEJO = 19 leads, NUEVO = 19 leads, `VIEJO \ NUEVO` = `[]`, `NUEVO \ VIEJO` = `[]`. El único candidato con `followUps` activo y sin `callbackAt` (`l_mybajadental_6192729060`, que sí califica para `origen:'manual'` vía la derivación de `followUps` per D-04) NO entró a ninguno de los dos conjuntos porque el chequeo de atribución (`_callSetterId(last, lead, userMap) === lead.assignedTo`) falla en los dos criterios por igual: el último `callLog` entry de ese lead fue hecho por un user que ya no existe en `auth.json` (SDR eliminada, criterio #149), así que `_callSetterId` devuelve `''` en vez de caer al `assignedTo`. Ver detalle completo del script y el resultado más abajo.
- `case 'callback_later'` se envolvió en llaves `{ }` dentro del `switch` — necesario porque ahora declara una `const` local (`_cbDueAt`) antes de llamar a `_setNextAction`; sin el bloque, la declaración de `const` a nivel de `case` sería visible (y potencialmente colisionaría) en el resto de los `case` del mismo `switch` en modo estricto. El resto de las ramas del switch no se tocaron.

## Verificación: conteo comparativo de "En seguimiento" (criterio viejo vs nuevo)

Script de solo-lectura ejecutado sobre una copia temporal (`scratchpad/29-02-check/`)
de `data/setters.json` (25.6 MB) + `data/auth.json` reales, importando `index.js`
apuntado a esa copia vía `DATA_DIR` (`NODE_ENV=test`, sin listener, sin ninguna
llamada HTTP mutante — solo lectura de `globalThis.__voiceAgent`/`globalThis.__metricsAudit`
y `fs.readFileSync` directo del JSON).

```
VIEJO size: 19
NUEVO size: 19
VIEJO \ NUEVO (debe ser VACÍO): []
NUEVO \ VIEJO: []
```

- **VIEJO** = leads con `callbackAt` no vacío cuyo último entry de `callLog` tiene
  `outcome === 'callback_later'` Y `_callSetterId(last, lead, userMap) === lead.assignedTo`
  (el criterio literal pre-Task-2, `index.js:8384` antes del edit).
- **NUEVO** = leads donde `_leadNextAction(l).origen === 'manual'` con `dueAt`
  no vacío Y la misma atribución por dueño actual.
- **Delta: 0.** `VIEJO \ NUEVO` vacío (ninguna regresión — ningún callback
  manual dejó de contarse) y `NUEVO \ VIEJO` también vacío (no hay que
  justificar ningún lead nuevo — ver Decisions Made arriba para el análisis
  del único candidato que se investigó por las dudas).

## Resultado de `npm test`

```
Test Files  86 passed (86)
     Tests  1268 passed (1268)
```

Baseline de referencia (29-01): 1257/1257. Este plan sumó 11 tests nuevos
(`tests/next-action-disposition.test.js`) — 1257 + 11 = 1268, exacto. Ningún
otro archivo cambió su conteo de tests (la extensión de
`tests/apply-call-outcome.test.js` amplió aserciones dentro de tests
existentes, no agregó `it()` nuevos).

`tests/metrics-consistency.test.js` corrido explícitamente y en aislamiento:
**18/18 verde, sin editar el archivo.** Las 6 suites de regresión del área
(`call-cadence`, `hangup-cap`, `disposition-dnc`, `funnel-close`,
`disposition-enforcement`, `metrics-consistency`) más las 4 de Task 2
(`apply-call-outcome`, `pipeline-attribution`, `callable-leads`,
`shared-callback`) confirmadas sin diffs (`git log` sobre esos 8 archivos
muestra el último commit que los tocó es anterior a este plan — ver debajo).

## Deviations from Plan

None — el plan se ejecutó exactamente como estaba escrito. Los 5 sitios de
escritura, la migración de `manualCallbackByOwner`, y los 11 tests siguen
`<action>`/`<behavior>` del plan sin desvíos de Rule 1/2/3/4.

## Issues Encountered

None.

## Acceptance Criteria — verificación explícita

- `node --check index.js` → 0 (verificado 3 veces, una por task).
- Dentro de `_applyCallOutcome` (rango 10767–10956 tras los edits): 0
  asignaciones directas `lead.callbackAt =`, 3 llamadas `_clearNextAction(lead)`
  (entrada, tope de cortes, cadencia-descarte), 2 llamadas `_setNextAction(lead`
  (`callback_later`, cadencia-reintento) — coincide exacto con lo pedido.
- `grep -n "opts\." index.js` en el rango de la función: solo
  `opts.actorName`, `opts.actorSetterId`, `opts.leadId`, `opts.nowIso`,
  `opts.skipCalendarCreation` — ninguna clave nueva fuera de `<interfaces>`.
- `manualCallbackByOwner` deriva de `_leadNextAction` + `origen`, sin
  referencia a `outcome === 'callback_later'` en la expresión de código (el
  criterio queda documentado en el comentario, no en la condición).
- `_leadIsCallableNow` (~9337) y el filtro de callbacks compartidos (~8361)
  siguen leyendo `l.callbackAt` sin cambios — este plan no los migró (D-03).
- `tests/pipeline-attribution.test.js` pasa SIN editarlo.

## Next Phase Readiness

`nextAction` es ahora la fuente de verdad viva en cada disposición humana y
en el webhook del agente de voz (paridad garantizada por
`tests/apply-call-outcome.test.js`), con `callbackAt` espejado sin
divergencia posible. La Phase 30 (gate de próximo paso) puede apoyarse en
`nextAction` para exigir que toda disposición defina uno o marque un estado
terminal, sin tener que lidiar con dos relojes contradictorios. Sin
bloqueos.

## Self-Check: PASSED

- `tests/next-action-disposition.test.js` existe: **FOUND**.
- Commits existen en `git log`:
  - `85e8543` (Task 1): **FOUND**
  - `1f95ed4` (Task 2): **FOUND**
  - `b2fee7a` (Task 3): **FOUND**
- `node --check index.js`: **OK**.
- Suite completa del repo (`npx vitest run` / `npm test`): **86 test files /
  1268 tests, 0 fallos**.
- `git diff --name-only` de los 3 commits de este plan: `index.js`,
  `tests/apply-call-outcome.test.js`, `tests/next-action-disposition.test.js`
  — **cero archivos bajo `public/`** (regla del plan: backend-only).

---
*Phase: 29-next-reloj-unico*
*Completed: 2026-08-14*
