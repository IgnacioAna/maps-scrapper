---
phase: 34-hoy-vista-diaria
plan: 01
subsystem: api
tags: [backend, express, next-action, hoy, higiene, rbac]

# Dependency graph
requires:
  - phase: 29-next-reloj-unico (plan 04)
    provides: "_leadNextAction(lead) — único lector autorizado del reloj único, cubre leads migrados (nextAction explícito) y legacy (_deriveNextActionFromLegacy)"
  - phase: 33-dial-motor-unico (plan 04)
    provides: "GET /api/setters/leads/sin-wsp devuelve { leads, userNames } — shape que este plan extiende (l.nextAction resuelto)"
provides:
  - "GET /api/setters/leads/sin-wsp: l.nextAction siempre RESUELTO (nunca el crudo null de un lead legacy con próximo paso derivable)"
  - "POST /api/setters/hoy-hygiene-snapshot — persiste {vencidos, redSeguridad} del día de negocio por scope dentro de setters.json, devuelve el de ayer + tendencia (creciendo/bajando/estable), poda a 14 fechas por scope"
  - "function _hoyHygieneScope(req, requestedSetter) — resuelve la clave de persistencia (setter propio / supervisor scoped por userId / __all__ para admin sin restricción)"
  - "globalThis.__hoyHygiene = { _hoyHygieneScope } — expuesto para tests aislados"
affects: [34-02, 34-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reuso del patrón de scope/RBAC de cold-call-metrics (eff.role branching + _visibleSetterIds + guard 403 explícito para setter sin setterId vinculado) en un endpoint nuevo, en vez de reinventar la lógica de visibilidad."
    - "Persistencia de un panel nuevo como key adicional dentro de setters.json (loadSettersData/saveSettersData ya la redondean completo) en vez de un archivo de datos nuevo — evita wiring de export/pre-deploy/backup (regla #21 de CLAUDE.md)."
    - "Escritura sync sin mutateSettersData cuando el handler no tiene ningún await entre load y save (mismo criterio que PATCH .../followup)."

key-files:
  created:
    - tests/hoy-hygiene-snapshot.test.js
  modified:
    - index.js

key-decisions:
  - "Se siguió la interfaz del plan literal (código ya escrito en el bloque <interfaces>) sin desviaciones — incluida la corrección del checker 2026-08-16 (guard 403 explícito para setter sin setterId, agregado ANTES de calcular requestedSetter/scope)."
  - "Para exponer _hoyHygieneScope en globalThis.__hoyHygiene se aprovechó el hoisting de function declarations: la línea de exposición vive junto a globalThis.__metricsAudit (~línea 7959), antes en el archivo que la propia declaración de _hoyHygieneScope (~línea 8306) — funciona porque `function` (no arrow/const) se hoistea a nivel de módulo. Confirmado con node --check y con la suite corriendo verde."
  - "Los tests de tendencia (creciendo/bajando/estable) siembran el bucket de 'ayer' escribiendo directo a tmpData/setters.json vía fs (read→mutate→write), el mismo patrón ya establecido en hardening.test.js/cascade-leads.test.js para mid-test fixture seeding — no hay otra forma de tener un 'ayer' determinístico, porque el endpoint solo puede escribir 'hoy'."

patterns-established:
  - "Panel de higiene / snapshot con tendencia día-a-día: persistencia mínima (bucket por fecha YYYY-MM-DD en TZ de negocio, poda a N días) sin archivo de datos dedicado — reusable para cualquier otro contador que necesite comparar 'hoy vs ayer' sin levantar infraestructura nueva."

requirements-completed: [HOY-04, HOY-05]

# Metrics
duration: "~15 min"
completed: 2026-08-16
---

# Phase 34 Plan 1: Backend de HOY-04/HOY-05 — reloj resuelto + snapshot de higiene Summary

**`GET /api/setters/leads/sin-wsp` ahora devuelve `l.nextAction` siempre RESUELTO vía `_leadNextAction` (no el crudo `null` de un lead legacy), y `POST /api/setters/hoy-hygiene-snapshot` persiste el snapshot diario del panel de higiene de Hoy dentro de `setters.json`, devolviendo el valor de ayer y la tendencia creciendo/bajando/estable — ambos, condición necesaria backend para que 34-02/34-03 reordenen Hoy en 5 secciones.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-16
- **Tasks:** 2/2
- **Files modified:** 2 (`index.js` modificado, `tests/hoy-hygiene-snapshot.test.js` creado)

## Accomplishments

- **`l.nextAction` resuelto en `/leads/sin-wsp`**: dentro del loop existente de campos derivados (`l.calledByOwner`, `l.manualCallbackByOwner`), se agregó `l.nextAction = _na;` reusando la variable `_na = _leadNextAction(l)` que el endpoint ya calculaba — cero costo extra de cómputo, un solo punto de verdad. Un lead legacy sin migrar (nextAction:null en disco, pero derivable de `callbackAt`/`followUps`) ahora responde con el mismo contenido resuelto que un lead ya migrado.
- **`_hoyHygieneScope(req, requestedSetter)`**: helper puro que decide en qué "cajón" de `hoyHygieneSnapshots` escribe/lee cada request — setter propio (`eff.setterId`), setter puntual pedido por admin/supervisor, supervisor scoped sin setter puntual (`'supervisor_' + userId`, nunca pisa el agregado global del admin), o `'__all__'` para admin/supervisor sin restricción.
- **`POST /api/setters/hoy-hygiene-snapshot`**: recibe `{vencidos, redSeguridad}` (coerción `toCount` — cualquier valor negativo/no-numérico cae a `0`, nunca 400), persiste el bucket del día de negocio (`_bizDayStr`) dentro de `setters.json` (sin archivo nuevo), poda a 14 fechas por scope, y responde `{scope, date, today, yesterday, trend}` — `trend` en `creciendo`/`bajando`/`estable`/`sin_dato_previo`. RBAC: mismo patrón de `cold-call-metrics` (setter solo su scope, `visibleSet.has()` para supervisor scoped, 403 explícito para setter sin `setterId` vinculado — evita que caiga silenciosamente al scope compartido `''`).
- **16 tests HTTP nuevos** (`tests/hoy-hygiene-snapshot.test.js`): 3 sobre `l.nextAction` resuelto (legacy/migrado/nulo) + 13 sobre el endpoint de snapshot (grabar propio, guard 403 sin pisar `''`, sin auth, upsert same-day, 3 casos de tendencia con "ayer" sembrado directo en disco, coerción de input raro (negativo y no-numérico), un setter no puede escribir en el scope de otro, poda a 14 días, RBAC de supervisor scoped fuera de visibilidad).

## Task Commits

1. **Task 1: nextAction resuelto en /leads/sin-wsp + endpoint de snapshot de higiene** - `76555d4` (feat)
2. **Task 2: Suite HTTP de HOY-04/HOY-05 (backend)** - `a785a1c` (test)

## Files Created/Modified

- `index.js` — `l.nextAction = _na;` dentro del loop de `GET /api/setters/leads/sin-wsp` (~línea 8972-8979); `_hoyHygieneScope(req, requestedSetter)` (~línea 8306-8312) + `POST /api/setters/hoy-hygiene-snapshot` (~línea 8320-8374), insertados entre el cierre de `cold-call-metrics` y `GET /team/:id/calls-today`; `globalThis.__hoyHygiene = { _hoyHygieneScope }` agregado junto a `globalThis.__metricsAudit` (~línea 7959-7962).
- `tests/hoy-hygiene-snapshot.test.js` (nuevo) — 16 tests, fixture inline con 10 users (admin, setter con setterId, setter sin setterId, supervisor scoped, y 6 setters dedicados para aislar los distintos escenarios de tendencia/coerción/poda sin interferencia entre tests).

## Decisions Made

Ver `key-decisions` en el frontmatter. El plan traía el código de ambas piezas (endpoint + helper) ya escrito literal en `<interfaces>`/`<action>`, incluida la corrección del checker del 2026-08-16 (guard 403 explícito) — se implementó tal cual, sin necesidad de resolver ambigüedades de diseño.

## Deviations from Plan

None - plan ejecutado exactamente como estaba escrito. La única decisión de implementación no explícita en el plan (dónde y cómo exponer `_hoyHygieneScope` en `globalThis.__hoyHygiene`, dado que la función se declara físicamente DESPUÉS de `globalThis.__metricsAudit` en el archivo) se resolvió apoyándose en hoisting de `function` declarations — documentado en `key-decisions`, verificado con `node --check` y la suite completa.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Baseline REAL de `npm test` leído en disco antes de empezar** (con `index.js` stasheado a su estado pre-plan, para medir el punto de partida real, no un número asumido): **1801 tests / 106 archivos, 0 fallos** (`Duration 18.45s`, corrida completa vía `npm test`).
- **Con este plan aplicado**: `npm test` completo → **1817 tests / 107 archivos, 0 fallos** (1801 + 16 nuevos, sin regresiones). Confirmado con una corrida completa post-commit.
- **`tests/next-action-model.test.js` y `tests/next-action-disposition.test.js` NO necesitaron edición** — `git diff --stat` de ambos vacío, y ambos pasan verdes junto con la suite nueva (`npx vitest run tests/hoy-hygiene-snapshot.test.js tests/next-action-model.test.js tests/next-action-disposition.test.js` → 44/44). Confirma que resolver `l.nextAction` en la respuesta no rompió los 2 casos que ya lo chequeaban (uno de ellos, el caso `l_legacy` de `next-action-disposition.test.js`, solo verificaba `manualCallbackByOwner` — no fue necesario tocarlo).
- **Qué queda para 34-02/34-03**: el frontend (`public/app.js`) todavía NO consume ninguno de estos 2 cambios — ni `l.nextAction` resuelto (Hoy sigue clasificando con su lógica actual) ni `POST /hoy-hygiene-snapshot` (no hay ningún fetch a ese endpoint todavía). Esta plan (34-01, Wave 1, sin dependencias) es la única pieza de la Phase 34 que corre sola, backend-only — 34-02/34-03 son los que van a cablear el frontend contra esta superficie nueva. Cero bump de cache-buster en esta plan (no se tocó `public/`).
- `git diff --stat package.json package-lock.json` vacío — no se instaló nada.

---
*Phase: 34-hoy-vista-diaria*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: `tests/hoy-hygiene-snapshot.test.js` (16 `it(` confirmados por corrida de vitest)
- FOUND: `index.js` con `app.post('/api/setters/hoy-hygiene-snapshot'` (1 ocurrencia), `l.nextAction = _na;` (1 ocurrencia), `hoyHygieneSnapshots` (4 ocurrencias)
- FOUND commit: `76555d4` (Task 1)
- FOUND commit: `a785a1c` (Task 2)
- `node --check index.js` → código 0.
- `npx vitest run tests/hoy-hygiene-snapshot.test.js tests/next-action-model.test.js tests/next-action-disposition.test.js` → 44/44 verde.
- `npm test` completo → 1817/1817 verde (baseline pre-plan: 1801/1801; delta: +16, 0 regresiones).
- `git diff --stat package.json package-lock.json` → vacío.
