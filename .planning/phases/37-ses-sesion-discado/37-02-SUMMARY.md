---
phase: 37-ses-sesion-discado
plan: 02
subsystem: api
tags: [express, call-metrics-core, dial-session, ses-03, ses-04, rbac]

# Dependency graph
requires:
  - phase: 37-01
    provides: "data.dialSessions persistido, POST abrir/cerrar sesión, _dialSessionActor/_dialSessionCounters/_dialSessionPrune/_dialSessionFinalize/_dialSessionPrevious expuestos en globalThis.__dialSessions"
provides:
  - "GET /api/setters/dial-sessions: historial con el mismo patrón de scope de cold-call-metrics (setter propio, supervisor scoped via visibleSet, admin sin restricción), orden startedAt descendente, limit clampeado a 100, filtro de ruido de presentación (0 marcadas y <120s de duración excluidas por defecto, all=1 las trae), sesiones abiertas siempre visibles, sin total diario paralelo"
  - "PATCH /api/setters/dial-sessions/:id: estado del que marcó (mood), whitelist DIAL_SESSION_MOODS, '' borra y nunca bloquea, IDOR cerrado por id+setterId en el mismo find"
  - "DIAL_SESSION_MOODS y DIAL_SESSION_NOISE_MAX_S como constantes de módulo, DIAL_SESSION_MOODS también expuesta en globalThis.__dialSessions"
affects: [37-03, 37-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Historial de una entidad persistida como key dentro de setters.json: scope EXACTO al de cold-call-metrics (getEffectiveAuth + _visibleSetterIds), nunca el patrón viejo de /api/setters/sessions (que ignora visibleSet)"
    - "Filtro de PRESENTACIÓN documentado explícitamente como tal en el código (comentario) para que una sesión futura no lo confunda con un borrado"
    - "Ausencia deliberada de una agregación (total por día) documentada con un comentario largo arriba del handler, para que 'completar' esa ausencia en un plan futuro requiera leer por qué no está"

key-files:
  created:
    - tests/dial-session-history.test.js
  modified:
    - index.js

key-decisions:
  - "GET /dial-sessions usa getEffectiveAuth + _visibleSetterIds igual que cold-call-metrics, NO el patrón legacy de /api/setters/sessions (isSetter ? filter : all, que ignora scope de supervisor) — evita repetir el bug de fuga que ese endpoint viejo tiene"
  - "El filtro de ruido excluye SOLO sesiones cerradas con 0 marcadas Y menos de 120s de duración; una sesión con 0 marcadas pero más de 120s de duración SÍ se lista (no es 'me arrepentí', es una partida real que no conectó nada) — verificado con un test dedicado a ese borde"
  - "Las sesiones ABIERTAS nunca se consideran ruido, tengan o no counters — se listan siempre para que se vea que hay una en curso"
  - "PATCH busca la sesión por id Y setterId del actor en el MISMO .find() (mismo patrón que el cierre de 37-01), nunca un find por id suelto seguido de un chequeo de propiedad aparte"
  - "GET no agrega ningún total por día: decisión documentada con un comentario extenso arriba del handler + un test dedicado (expect(body.totals).toBeUndefined()) para que quede clavada en el código, no solo en la cabeza de quien ejecutó el plan"

patterns-established:
  - "mood/moodAt: par de campos (valor + timestamp del cambio), whitelist cerrada + '' como borrado explícito — mismo idioma que otros campos opcionales del proyecto (ver disqualifyReason)"

requirements-completed: [SES-03, SES-04]

# Metrics
duration: 11min
completed: 2026-08-23
---

# Phase 37 Plan 02: Historial de sesiones de discado + estado del operador Summary

**`GET /api/setters/dial-sessions` (historial con scope idéntico a cold-call-metrics, sin total diario paralelo) y `PATCH /api/setters/dial-sessions/:id` (estado opcional del que marcó, whitelist cerrada, IDOR cerrado) sobre el modelo `dialSessions` que dejó 37-01.**

## Performance

- **Duration:** 11 min (13:28 → 13:39 hora local, commits `ae38f65` y `f5fc177`)
- **Started:** 2026-08-23T13:28:00-03:00 (aprox, inmediatamente después de cerrar 37-01)
- **Completed:** 2026-08-23T13:39:00-03:00 (aprox, tras SUMMARY + verificación final)
- **Tasks:** 2 (ambas completas)
- **Files modified:** 2 (`index.js`, `tests/dial-session-history.test.js` nuevo)

## Accomplishments
- Una sesión de discado ya se puede LEER: el SDR puede pedir sus últimas partidas y contrastar hoy contra ayer (fecha, duración, marcadas, atendieron, conversaciones — todo derivado del CALL METRICS CORE en 37-01), con el mismo scope por rol que el resto de las métricas de llamadas.
- Las sesiones basura (abrir el dialer y arrepentirse: 0 marcadas, menos de 2 minutos) no ensucian el historial por defecto, pero el registro nunca se borra — `all=1` las trae.
- La pregunta de estado del que marcó tiene dónde guardarse con una sola llamada, acepta vacío (nunca bloquea nada) y viaja de vuelta en el GET.
- La decisión de NO publicar un total diario paralelo al de Mi rendimiento quedó clavada en un comentario largo en el código Y en un test (`expect(body.totals).toBeUndefined()`), para que no se "complete" en un plan futuro sin volver a leer por qué se decidió así.

## Task Commits

Each task was committed atomically:

1. **Task 1: Historial de sesiones + estado del que marcó** - `ae38f65` (feat)
2. **Task 2: Suite de SES-03/SES-04 (historial y estado)** - `f5fc177` (test)

**Plan metadata:** (este commit, docs)

_Nota: Task 2 tenía `tdd="true"` en el plan, pero su `<action>` es una sola tarea de creación de test contra código ya existente de Task 1 (mismo caso que 37-01: no hay forma sensata de producir un RED real sin reescribir el modelo dos veces). Se verificó por MUTACIÓN (2 rondas) en vez de un ciclo RED/GREEN/REFACTOR de commits separados — ver "Issues Encountered" abajo._

## Files Created/Modified
- `index.js` — bloque de 37-01 extendido (~97 líneas): 2 constantes nuevas (`DIAL_SESSION_MOODS`, `DIAL_SESSION_NOISE_MAX_S`) junto a las de 37-01; `GET /api/setters/dial-sessions` insertado inmediatamente después de `POST .../close`; `PATCH /api/setters/dial-sessions/:id` insertado después del GET; `globalThis.__dialSessions` actualizado para exponer también `DIAL_SESSION_MOODS`.
- `tests/dial-session-history.test.js` — suite nueva, 22 tests (el plan pedía mínimo 15).

## Decisions Made

- **Scope del GET copiado literal del patrón de `cold-call-metrics`** (`getEffectiveAuth` + `_visibleSetterIds`), explícitamente distinto del patrón legacy de `GET /api/setters/sessions` (que solo mira `req.auth.user.role` crudo y nunca consulta `visibleSet` — un supervisor scoped ahí ve TODO). El `<read_first>` del plan pedía leer ese endpoint viejo justamente para no copiarlo.
- **Filtro de ruido con el borde exacto que pide el criterio**: `dials === 0 && durationS < 120`. Una sesión con 0 marcadas pero 500s de duración (se quedó discando sin conectar nada) NO es ruido — se agregó un test dedicado a ese caso porque es fácil escribir el filtro solo con `dials===0` y perder el matiz de duración.
- **Sesiones abiertas nunca son ruido**: se filtran ANTES de evaluar el criterio de ruido (`if (!s.endedAt) return true`), así que una sesión recién abierta con `counters: null` (que no tiene `dials` para evaluar) siempre aparece.
- **`total` se calcula después del filtro de ruido pero antes del `limit`** — igual que pide el contrato: `limit=1` devuelve 1 sesión pero `total` sigue reflejando cuántas había en total (verificado con un test que compara contra la respuesta sin `limit`).
- **PATCH reusa `_dialSessionActor(req)` de 37-01 tal cual** (no una variante propia): la escritura del `mood` es siempre sobre el setter REAL del usuario logueado, nunca el impersonado — mismo argumento que 37-01 documentó para el cierre de sesión (si un admin en modo "Ver como SDR" patcheara con el setterId impersonado, terminaría escribiendo sobre las sesiones incorrectas si algún día se agrega un guard más laxo).
- **`mood`/`moodAt` como par explícito** en vez de derivar `moodAt` de `Date.now()` en el frontend: el timestamp del cambio de estado lo pone el servidor, mismo criterio que `startedAt` en la apertura de sesión (37-01, T-37-03).

## Deviations from Plan

None a nivel de código — el plan se ejecutó tal como está escrito: los 2 endpoints en el orden pedido (GET antes del PATCH, ambos inmediatamente después del cierre de 37-01), los nombres de constantes exactos (`DIAL_SESSION_MOODS`, `DIAL_SESSION_NOISE_MAX_S`), el contrato de `<interfaces>` respetado literal (shape de la respuesta del GET, semántica de `all=1`, whitelist del PATCH). La única nota de proceso es la de TDD explicada arriba (Task Commits), que no es una desviación del contenido sino de la mecánica de commits sugerida por `tdd="true"` cuando la implementación ya existe en la Task previa del mismo plan.

## Issues Encountered

**Bug propio detectado al escribir el test, no del código de producción:** el primer borrador de la suite reusaba la sesión pre-sembrada `dsess_a_open` (con `endedAt: null`) para el test "PATCH sobre una sesión ABIERTA → 200". Falló porque abrir una sesión NUEVA para `s_a` (necesaria en el `beforeAll` del describe de PATCH, vía `POST /api/setters/dial-sessions`) dispara el auto-cierre de huérfanas que ya construyó 37-01 — `dsess_a_open` quedó cerrada (`closedBy: 'auto'`) antes de que el test de PATCH corriera. Es el comportamiento CORRECTO del sistema (T-37-01: nunca puede haber 2 sesiones abiertas del mismo setter), no un bug de este plan. Corregido reusando la sesión `target` recién abierta en ese mismo `beforeAll` (que el test nunca cierra), documentado con un comentario en el test para que no se repita el mismo error de lectura.

**Verificación por mutación (2 rondas, mismo patrón que 37-01, ver nota #157+ de STATE.md):**

1. Se rompió el guard IDOR del PATCH (`data.dialSessions.find((s) => s.id === req.params.id && s.setterId === actor.setterId)` → sin el `&& s.setterId === actor.setterId`) → cayó exactamente 1 test: *"PATCH sobre la sesión de otro SDR → 404, la sesión ajena intacta"*. Ningún otro test se vio afectado. Restaurado desde backup, `git diff --stat -- index.js` confirmado vacío.
2. Se rompió el filtro `visibleSet` del GET sin `?setter=` (la línea `if (!setterId && visibleSet) scoped = scoped.filter(...)` comentada) → cayó exactamente 1 test: *"supervisor scoped sin ?setter= → solo sesiones de s_a, ninguna de s_b"*. Restaurado, diff vacío confirmado.

Ambas mutaciones confirmaron que la suite atrapa regresiones reales en los 2 puntos críticos del threat model del plan (T-37-08 y T-37-09).

## Persistencia

Sin cambios respecto de 37-01: `GET`/`PATCH` leen y escriben la misma key `dialSessions` dentro de `setters.json` que ya está cubierta por `loadSettersData`/`saveSettersData` (regla #21 satisfecha por construcción, verificado en 37-01-SUMMARY.md, no vuelto a re-verificar acá porque no cambió nada de esa superficie).

## El criterio del filtro de ruido, en una frase

Una sesión de discado se esconde del historial por defecto (aunque **nunca se borra**, `all=1` la trae) solo si **las dos** condiciones se cumplen a la vez: `counters.dials === 0` **y** `durationS < 120`. Alguien que discó y no conectó nada durante 10 minutos no es ruido — es una partida real con mala suerte. Alguien que abrió el dialer y lo cerró a los 20 segundos sin marcar nada, sí. Las sesiones ABIERTAS (todavía en curso, `!endedAt`) quedan excluidas de este criterio por completo: siempre se listan.

## Qué queda para 37-03/37-04

- **37-03** (frontend, Power Dialer) sigue sin consumir NADA de este plan ni del anterior: `_pd`/`_pdExit()` en `public/app.js` no llama a ninguno de los 4 endpoints de `dialSessions` (abrir/cerrar de 37-01, historial/mood de 37-02). Este plan es 100% backend — verificado que no toca `public/*`, sin bump de cache-buster.
- **37-04** (tabla en Mi rendimiento) puede consumir `GET /api/setters/dial-sessions` sin sorpresas de shape: el contrato de `<interfaces>` quedó congelado (`{ setterId, sessions, total }`, cada sesión con `mood`/`moodAt`).
- Sin bloqueos conocidos para continuar con 37-03.

## Self-Check

- `index.js`: FOUND (modificado, `node --check` OK)
- `tests/dial-session-history.test.js`: FOUND (creado, 22 tests, todos verdes)
- Commit `ae38f65`: FOUND en `git log`
- Commit `f5fc177`: FOUND en `git log`

## Verificación final

- `node --check index.js` → exit 0
- `npx vitest run tests/dial-session-history.test.js` → 22/22 verdes (aislado)
- `npx vitest run tests/dial-session-history.test.js tests/dial-session-model.test.js tests/metrics-consistency.test.js tests/command-metrics.test.js` → 72/72 verdes; `git diff --stat -- tests/dial-session-model.test.js tests/metrics-consistency.test.js` vacío (no se editaron)
- `npm test` completo (`npx vitest run`), 2 corridas independientes: **122/122 archivos, 2176/2176 tests, 0 fallos** ambas veces (baseline real de 37-01: 121/2154, también 0 fallos)
- `git diff --stat package.json package-lock.json` → vacío (no se instaló nada)
- Greps de aceptación de la Task 1 (todos verificados, valor esperado):
  - `grep -c "app.get('/api/setters/dial-sessions'" index.js` → 1
  - `grep -c "app.patch('/api/setters/dial-sessions/:id'" index.js` → 1
  - `grep -c "DIAL_SESSION_MOODS" index.js` → 4 (declaración, uso en el PATCH x2, export en `__dialSessions`) — `>= 3` pedido
  - El cuerpo del GET contiene `_visibleSetterIds` (verificado leyendo el handler completo)
  - El cuerpo del GET NO contiene `_bizDayStr` ni ninguna agregación por día (`grep -c "_bizDayStr"` sobre el rango de líneas del handler → 0)
  - 0 ocurrencias de `await` dentro de los cuerpos de los 2 handlers nuevos (extraídos por rango de línea y contados)

### Baseline real (medido en disco, heredado de 37-01, con Task 1 de este plan ya commiteada antes de escribir el test file)

```
Test Files  121 passed (121)
     Tests  2154 passed (2154)
```

### Con Task 2 aplicada

```
Test Files  122 passed (122)
     Tests  2176 passed (2176)
```

Delta: **+1 archivo, +22 tests, 0 regresiones.**

## Next Phase Readiness

- El contrato de `GET /api/setters/dial-sessions` y `PATCH /api/setters/dial-sessions/:id` está congelado según `<interfaces>` del plan — 37-03/37-04 pueden consumirlos sin sorpresas de shape.
- SES-03 y SES-04 cerrados a nivel de backend (SES-01/SES-05 ya habían cerrado en 37-01). Fase 37 backend-only completa (2/2 planes con requirements de backend); 37-03/37-04 son los planes de frontend que faltan.
- Sin bloqueos conocidos para continuar con 37-03.

## Self-Check: PASSED

---
*Phase: 37-ses-sesion-discado*
*Completed: 2026-08-23*
