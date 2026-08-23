---
phase: 37-ses-sesion-discado
plan: 01
subsystem: api
tags: [express, call-metrics-core, dial-session, ses-01, ses-05]

# Dependency graph
requires:
  - phase: 33-dial-motor-unico
    provides: "atribucion por quien llamo, `_leadStoreApply`, ficha del lead (no consumido directo por este plan, pero es el contexto del Power Dialer que va a usar esta sesion en 37-03)"
  - phase: (CALL METRICS CORE, 2026-07-24, dentro de esta misma base de codigo)
    provides: "_ccCollectCalls / _ccFunnelAggregate / _ccResolveRange / _ccFunnelSeries expuestos en globalThis.__callCore"
provides:
  - "data.dialSessions dentro de setters.json: objeto persistido de sesion de discado (startedAt, endedAt, by, setterId, mode, hoyFilter, filtro, queueSize, processed, mood, closedBy, counters)"
  - "POST /api/setters/dial-sessions (abrir) y POST /api/setters/dial-sessions/:id/close (cerrar), ambos 100% sincronos"
  - "_dialSessionActor / _dialSessionSanitize / _dialSessionCounters / _dialSessionPrune / _dialSessionFinalize / _dialSessionPrevious, expuestos via globalThis.__dialSessions"
  - "Auto-cierre de sesiones huerfanas anclado a la ultima llamada real (no a startedAt+horas)"
affects: [37-02, 37-03, 37-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Persistencia como key adicional dentro de setters.json (mismo patron que hoyHygieneSnapshots de la Fase 34) — cero archivo nuevo, cero wiring de export/pre-deploy/seed/backup"
    - "Contadores de negocio SIEMPRE derivados del CALL METRICS CORE, nunca reimplementados inline (regla del proyecto desde 2026-07-24)"
    - "Actor de un objeto que se persiste = usuario REAL logueado (req.auth.user.setterId), nunca el setterId de una impersonacion (getEffectiveAuth().setterId)"

key-files:
  created:
    - tests/dial-session-model.test.js
  modified:
    - index.js

key-decisions:
  - "dialSession vive como key dentro de setters.json, no como archivo nuevo — evita el wiring de los 4 lugares de la regla #21 (export-data/import-data/pre-deploy/seedVolumeFromRepo) porque loadSettersData/saveSettersData ya redondean el objeto completo"
  - "data.sessions (legacy, era WhatsApp, endpoints /api/setters/sessions/start|end) NO se toco ni se reuso: forma y semantica completamente distintas, colgada de view-crm parkeada, con 1 registro huerfano de abril"
  - "setterId de la sesion sale SIEMPRE de req.auth.user.setterId (usuario real), nunca de getEffectiveAuth().setterId (impersonado) — evita que una sesion abierta en modo 'Ver como SDR' quede vacia porque las llamadas se atribuyen al usuario que realmente marco"
  - "auto-cierre de huerfanas ancla endedAt a la ultima llamada real del setter dentro de [startedAt, ahora], o a startedAt si no hubo ninguna — nunca al momento de la re-apertura, para no inflar sesiones con horas muertas de pestaña abierta"

patterns-established:
  - "byOutcome se calcula AFUERA del CORE (tally crudo sobre las mismas entries que _ccFunnelAggregate ya conto como dials) — el CORE no gana un campo nuevo, la sesion reusa su salida"

requirements-completed: [SES-01, SES-05]

# Metrics
duration: 12min
completed: 2026-08-23
---

# Phase 37 Plan 01: Modelo dialSessions + abrir/cerrar sesion Summary

**`data.dialSessions` persistido dentro de setters.json con 2 endpoints (abrir/cerrar), contadores derivados 100% del CALL METRICS CORE sobre la ventana exacta de la sesion, auto-cierre de huerfanas anclado a la ultima llamada real, e IDOR cerrado por busqueda id+setterId en el mismo find.**

## Performance

- **Duration:** 12 min (13:14 → 13:26 hora local, commits `debde4e` y `7c607e6`)
- **Started:** 2026-08-23T13:14:17-03:00
- **Completed:** 2026-08-23T13:26:00-03:00 (aprox, tras SUMMARY + verificacion final)
- **Tasks:** 2 (ambas completas)
- **Files modified:** 2 (`index.js`, `tests/dial-session-model.test.js` nuevo)

## Accomplishments
- La sesion de discado existe como objeto persistido por primera vez en el proyecto: se abre al abrir el Power Dialer (endpoint listo, sin consumidor todavia) y se cierra explicitamente o sola si quedo huerfana.
- Los 4 numeros de la sesion (dials/connects/conversations/appointments/deals) salen EXACTAMENTE del mismo calculo que usan Mi rendimiento, Equipo, Comando y el reporte diario — verificado con un test que recalcula independientemente contra `globalThis.__callCore` y compara campo por campo.
- IDOR cerrado por diseño: la busqueda de la sesion a cerrar siempre incluye `setterId` del actor en el mismo `.find()`, nunca solo el `id`.
- Guard de "usuario sin SDR vinculado" verificado tanto para `setter` como para `supervisor` scoped sin `setterId` propio.

## Task Commits

Each task was committed atomically:

1. **Task 1: Modelo dialSessions + abrir y cerrar sesion** - `debde4e` (feat)
2. **Task 2: Suite de SES-01/SES-05** - `7c607e6` (test)

_Nota: Task 2 tenia `tdd="true"` en el plan, pero su `<action>` es una sola tarea de creacion de test (sin `<implementation>` propia — la implementacion ya existe en Task 1). No hay ciclo RED/GREEN/REFACTOR de commits separados porque no hay forma sensata de "romper" Task 1 para producir un RED real sin reescribir el modelo dos veces. En su lugar se verifico la suite por MUTACION (2 rondas, ver "Issues Encountered" mas abajo), que es la garantia equivalente para tests escritos contra codigo ya existente: si alguien rompe el guard IDOR o el filtro de ventana de `_dialSessionCounters`, exactamente el test correspondiente se pone rojo._

**Plan metadata:** (este commit, docs)

## Files Created/Modified
- `index.js` — bloque nuevo "SESIÓN DE DISCADO (Fase 37, SES-01/SES-05)" insertado entre `POST /api/setters/hoy-hygiene-snapshot` y `GET /api/setters/team/:id/calls-today` (~222 lineas): constantes de modulo, `_dialSessionActor`, `_dialSessionSanitize`, `_dialSessionCounters`, `_dialSessionPrune`, `_dialSessionFinalize`, `_dialSessionPrevious`, los 2 endpoints, y `globalThis.__dialSessions`.
- `tests/dial-session-model.test.js` — suite nueva, 22 tests (el plan pedia minimo 20).

## Decisions Made
- **Persistencia:** key adicional (`dialSessions: []`) dentro de `setters.json`, siguiendo el precedente de `hoyHygieneSnapshots` (Fase 34). No se creo ningun archivo nuevo, asi que la regla #21 de CLAUDE.md queda satisfecha por construccion — no hace falta tocar `/api/admin/export-data`, `import-data`, `scripts/pre-deploy.js` ni `seedVolumeFromRepo()`. Verificado explicitamente (ver seccion dedicada abajo).
- **`data.sessions` legacy no se toco ni se reuso.** Es la entidad de "sesiones de setteo" de la era WhatsApp (`{id, setter, startedAt, endedAt, summary, aiSummary}`), con sus propios 3 endpoints `/api/setters/sessions/start|end`, colgada de `view-crm` (parkeada) y con 1 solo registro huerfano de abril. `dialSession` es una entidad completamente distinta con su propio namespace de rutas (`/api/setters/dial-sessions`).
- **`setterId` de la sesion = usuario REAL, nunca el impersonado.** Documentado en un comentario largo en `_dialSessionActor`: si un admin abriera la sesion en modo "Ver como SDR" con el setterId impersonado, los contadores derivados del CORE (que atribuye llamadas por `callLog[].by` → usuario real) darian sistematicamente 0.
- **Auto-cierre anclado a la ultima llamada real, no al momento de la re-apertura.** Evita que una pestaña del Power Dialer olvidada abierta el viernes se convierta en una sesion de 60 horas cuando el SDR vuelve el lunes.

## Deviations from Plan

None a nivel de codigo — el plan se ejecuto tal como esta escrito, incluyendo los nombres de funciones, el orden de los 2 endpoints, y el formato exacto del contrato de `<interfaces>`. La unica nota de proceso es la de TDD explicada arriba (Task Commits), que no es una desviacion del contenido sino de la mecanica de commits sugerida por `tdd="true"` cuando la implementacion ya existe en una task previa del mismo plan.

## Issues Encountered

**Verificacion por mutacion (no un problema, un paso de verificacion adicional no explicitamente pedido por el plan pero consistente con el patron de fases anteriores del roadmap, ver notas #157+ de STATE.md "verificado por mutacion"):**

1. Se rompio temporalmente el guard IDOR del cierre (`data.dialSessions.find((s) => s.id === req.params.id)`, sin el `&& s.setterId === actor.setterId`) → cayo exactamente 1 test: *"u_b no puede cerrar la sesión de u_a"*. Ningun otro test se vio afectado. Restaurado con `Edit`, `git diff --stat -- index.js` confirmado vacio antes de continuar.
2. Se rompio temporalmente el filtro de ventana de `_dialSessionCounters` (`inWindow = calls` en vez de `calls.filter(...)`) → cayo exactamente 1 test: *"sesión 1: counters EXACTOS y == CALL METRICS CORE..."* (la aserción `sum(byOutcome) === dials` detecto la inflacion). Restaurado, diff vacio confirmado.

Ambas mutaciones confirmaron que la suite atrapa regresiones reales en los 2 puntos mas criticos del plan (T-37-01 y SES-05).

## Persistencia — ¿sobrevive `dialSessions` un redeploy de Railway?

**Si, sin ningun cambio adicional.** Verificado leyendo el codigo de los 4 lugares de la regla #21:

- `GET /api/admin/export-data` (index.js:3689) hace `const setters = loadSettersData();` y exporta ese objeto **completo** — no selecciona campos especificos de `setters.json`, asi que `dialSessions` viaja con el resto.
- `POST /api/admin/import-data` (index.js:3769) valida el shape de `setters` (requiere `setters.setters` array y, si viene, `setters.leads` como map) pero **no rechaza ni descarta claves extra** como `dialSessions`; el guardado es `saveSettersData(setters)` — escritura wholesale del objeto recibido.
- `BACKUP_FILES` (index.js:6514) incluye `'setters.json'` como archivo completo — no hay una lista de "campos permitidos dentro de setters.json" que filtrar.
- `seedVolumeFromRepo()` copia archivos completos del repo al volumen en el primer boot — mismo argumento, opera a nivel de archivo, no de campo.

Conclusion: como `dialSessions` es una key mas del mismo objeto que `loadSettersData()`/`saveSettersData()` ya manejan como unidad atomica, **no hace falta tocar ninguno de los 4 lugares**. Esto era la decision de diseño explicita del plan (evitar el bug historico de `scrape_batches.json` que quedo fuera de estos 4 lugares y se perdia en cada deploy) y quedo confirmada por lectura de codigo, no solo por intencion.

## Que queda para los planes siguientes

- **37-02** agrega lectura + estado del operador (no cubierto por este plan: los endpoints de apertura/cierre existen pero nadie los lee todavia para mostrar historial ni el "mood" que quedo con default `''`).
- **37-03** es el primer consumidor del frontend: hoy el Power Dialer (`public/app.js`, `_pd`/`_pdExit()`) sigue sin llamar a ninguno de los 2 endpoints nuevos. Este plan es 100% backend, verificado que no toca `public/*` (sin bump de cache-buster, consistente con la regla del proyecto).
- El campo `mood` (pregunta de estado del operador, D-03 del CONTEXT: opcional, nunca bloquea el cierre) quedo en el modelo con default `''` pero **sin mecanismo para setearlo** — el body de `close` solo acepta `processed`. Es intencional: la UI de la pregunta de estado y su wiring al backend es contenido de 37-02/37-03, no de este plan.

## Self-Check

- `index.js`: FOUND (modificado, `node --check` OK)
- `tests/dial-session-model.test.js`: FOUND (creado, 22 tests, todos verdes)
- Commit `debde4e`: FOUND en `git log`
- Commit `7c607e6`: FOUND en `git log`

## Verificacion final

- `node --check index.js` → exit 0
- `npx vitest run tests/dial-session-model.test.js` → 22/22 verdes (aislado)
- `npx vitest run tests/dial-session-model.test.js tests/metrics-consistency.test.js` → 40/40 verdes; `git diff --stat tests/metrics-consistency.test.js` vacio (no se edito)
- `npx vitest run tests/command-metrics.test.js tests/hangup-cap.test.js tests/hoy-hygiene-snapshot.test.js` → 37/37 verdes
- `npm test` completo, 2 corridas independientes: **121/121 archivos, 2154/2154 tests, 0 fallos** ambas veces (baseline real medido en disco ANTES de escribir el test file: 120 archivos / 2132 tests, tambien 0 fallos — ver mas abajo)
- `git diff --stat package.json package-lock.json` → vacio (no se instalo nada)
- Greps de aceptacion de la Task 1 (todos verificados exit 0 / valor esperado):
  - `grep -c "app.post('/api/setters/dial-sessions'" index.js` → 1
  - `grep -c "/api/setters/dial-sessions/:id/close" index.js` → 1
  - `grep -c "globalThis.__dialSessions" index.js` → 1
  - Cuerpo de `_dialSessionCounters` contiene `_ccCollectCalls` y `_ccFunnelAggregate`, NO contiene `COLD_CALL_CONNECT_OUTCOMES`/`COLD_CALL_CONV_MIN_S`/`COLD_CALL_APPOINTMENT_OUTCOMES`
  - `git diff` de `index.js` no toca las definiciones de `_ccCollectCalls`/`_ccFunnelAggregate`/`_ccResolveRange`/`_ccFunnelSeries` ni los endpoints `/api/setters/sessions/start|end`
  - 0 ocurrencias de `await` dentro de los cuerpos de los 2 handlers nuevos (extraidos y contados programaticamente)

### Baseline real (medido en disco, antes de crear el test file, con Task 1 ya commiteada)

```
Test Files  120 passed (120)
     Tests  2132 passed (2132)
```

### Con Task 2 aplicada

```
Test Files  121 passed (121)
     Tests  2154 passed (2154)
```

Delta: **+1 archivo, +22 tests, 0 regresiones.**

## Next Phase Readiness

- El contrato de `data.dialSessions` y los 2 endpoints estan congelados segun `<interfaces>` del plan — 37-02/37-03 pueden consumirlos sin sorpresas de shape.
- `globalThis.__dialSessions` expone los puros para que 37-02/37-04 los reutilicen en sus propios tests sin reimplementar logica.
- Sin bloqueos conocidos para continuar con 37-02.

---
*Phase: 37-ses-sesion-discado*
*Completed: 2026-08-23*
