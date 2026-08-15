---
phase: 31-comm-compromisos
plan: 02
subsystem: api
tags: [nodejs, express, json-storage, next-action, gate, commitment-model, http]

# Dependency graph
requires:
  - phase: 31-comm-compromisos (plan 01)
    provides: "lead.commitment, COMMITMENT_TIPOS/PARTES/ESTADOS/CIERRES/LABELS/DEFAULT_PARTE/DEFAULT_CANAL, _sanitizeCommitment/_setCommitment/_closeCommitment, expuestos en globalThis.__voiceAgent"
  - phase: 29-next-reloj-unico
    provides: "_setNextAction/_clearNextAction/_leadNextAction, NEXT_ACTION_ORIGENES con 'compromiso' reservado"
  - phase: 30-gate-proximo-paso
    provides: "GATE_TERMINAL_ESTADOS, _gateSanitizeNextActionOverride, patron whitelist-and-coerce nunca-4xx"
provides:
  - "POST /api/setters/leads/:id/call-disposition acepta body.commitment (whitelist-and-coerce, nunca 4xx), aplicado en _applyCallOutcome entre el override del cliente y la red de seguridad GATE-01"
  - "PATCH /api/setters/leads/:id/commitment (requireAuth): crea/reemplaza (tipo/parte/canal/motivo/dueAt) o cierra (estado), con los mismos 4 guards que PATCH .../followup"
  - "24 tests HTTP en tests/commitment-endpoints.test.js cubriendo ambos caminos, la herencia de fecha, el reemplazo, el cierre con seguimiento post-envio (+48h), y seguridad (403 de dueno, truncado de motivo, claves exactas del objeto)"
affects: [31-03-carga-ui, 31-04-consulta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Whitelist-and-coerce compartido: cleanCommitment sigue el mismo idioma que cleanNextActionOverride/cleanReason -- nunca 400 en call-disposition (el endpoint lo comparte el webhook del agente de voz, D-01 Phase 30)"
    - "Herencia de fecha entre dos vias del mismo body: si commitment no trae dueAt y nextActionOverride si, el compromiso lo hereda ANTES de llamar a _setCommitment -- evita que el mapa D-06 pise la fecha elegida a mano"
    - "Endpoint nuevo con dos acciones por body distinguidas por presencia de 'estado' (patron ya usado en el proyecto para objetos-transicion-unica)"

key-files:
  created:
    - tests/commitment-endpoints.test.js
  modified:
    - index.js

key-decisions:
  - "Task 1 (D-08) ya estaba implementada en el working tree cuando el executor arranco (uncommitted). Se verifico contra los 6 acceptance criteria del plan (node --check, greps de linea/orden, diff vacio en _gateSanitizeNextActionOverride, 6 suites de verify) y se commiteo tal cual -- no se reescribio codigo."
  - "El comentario de cabecera del endpoint nuevo evita el literal 'mutateSettersData' (dice 'el mutex de escrituras async') para que el grep de conteo del acceptance criteria no se mueva por una mencion en comentario -- el endpoint sigue siendo 100% sincrono, sin cambio de comportamiento."
  - "La rama CIERRE del PATCH nuevo valida el whitelist de `estado` ANTES de mirar si hay un compromiso pendiente -- un `{estado:'basura'}` da 400 sin importar el estado del lead, consistente con el resto de los 400 del proyecto (falla rapido en el shape del body, no en el estado del dominio)."

patterns-established:
  - "Un endpoint de escritura FUERA de una llamada (D-09) copia literal los 4 guards de auth/visibilidad de PATCH .../followup -- mismo shape para cualquier endpoint futuro que edite un campo de lead desde la ficha."
  - "Verificacion por mutacion del guard de dueno como parte del proceso de testing de cualquier endpoint nuevo con ownership check: desactivar temporalmente, contar rojos, restaurar exacto y confirmar con git diff vacio antes de continuar."

requirements-completed: [COMM-01, COMM-02]

# Metrics
duration: ~15min
completed: 2026-08-15
---

# Phase 31 Plan 02: Endpoints del compromiso hablado Summary

**`call-disposition` acepta `body.commitment` (D-08) y `PATCH /api/setters/leads/:id/commitment` (D-09) crea/reemplaza/cierra el compromiso fuera de una llamada -- 24 tests HTTP nuevos, suite completa 1424/1424.**

## Performance

- **Duration:** ~15 min (Task 1 llegó ya implementada sin commitear al arrancar el executor; el tiempo real se fue en Tasks 2 y 3)
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 2 (`index.js`, `tests/commitment-endpoints.test.js` nuevo)

## Accomplishments

- `call-disposition` acepta `commitment` en el body, lo sanitiza con `_sanitizeCommitment` (nunca 4xx) y lo aplica dentro de `_applyCallOutcome` en la precedencia documentada: outcome → DNC → tope de cortes → cadencia → override del cliente → **compromiso** → red de seguridad GATE-01. Si el compromiso no trae `dueAt` pero el `nextActionOverride` sí, hereda esa fecha (no pisa la que el user eligió a mano).
- `PATCH /api/setters/leads/:id/commitment` nuevo: crea/reemplaza (`{tipo, parte?, canal?, motivo?, dueAt?}`) o cierra (`{estado}`), con los mismos 4 guards que `PATCH .../followup` (404 lead, 403 dueño, 403 visibilidad, `ensureLeadDefaults`). Crear sobre un lead terminal → 409; cerrar se permite en cualquier estado del lead.
- 24 tests HTTP nuevos cubriendo los dos caminos completos, la herencia de fecha, el reemplazo de un compromiso pendiente, el cierre con seguimiento post-envío (+48h para un `enviar_info`/`pedir_presupuesto` propio cumplido), y seguridad (403 de dueño en crear/cerrar, motivo truncado a 200, claves exactas del objeto persistido, 401 sin cookie).
- Verificación por mutación del guard de dueño: desactivado temporalmente, **2/24 tests en rojo** (exactamente los dos que prueban ese guard), restaurado exacto (`git diff index.js` vacío).
- Suite completa del repo: **1424/1424** (baseline 31-01: 1400 + 24 nuevos).

## Task Commits

Each task was committed atomically:

1. **Task 1: commitment en call-disposition y su aplicación en _applyCallOutcome (D-08 backend)** - `f87dd54` (feat)
2. **Task 2: PATCH /api/setters/leads/:id/commitment (D-09 backend)** - `c7dfd13` (feat)
3. **Task 3: Suite HTTP de los dos caminos de carga y del cierre** - `5cc9122` (test)

## Files Created/Modified

- `index.js` — `call-disposition` acepta `commitment` en el destructuring del body, `cleanCommitment = _sanitizeCommitment(commitment)`, y se pasa a `_applyCallOutcome` junto a `nextActionOverride`. Dentro de `_applyCallOutcome`, bloque nuevo entre el override del cliente y la red de seguridad GATE-01 que aplica el compromiso (con herencia de `dueAt`). Endpoint nuevo `PATCH /api/setters/leads/:id/commitment` inmediatamente después de `PATCH .../followup` y antes de `POST /api/setters/leads/bulk`.
- `tests/commitment-endpoints.test.js` (nuevo) — 24 tests HTTP sobre `request(app)`, con fixture de 2 setters + 1 admin y leads de teléfono `+521...` (≥7 dígitos, regla #163).

## Decisions Made

- **Task 1 llegó pre-implementada sin commitear**: al arrancar el executor, `git status` mostraba `M index.js` con exactamente el diff que Task 1 pedía (probablemente una sesión anterior interrumpida antes de commitear). Se verificó línea por línea contra los 6 acceptance criteria del plan (orden de las líneas `nextActionOverride` → `_setCommitment` → red de seguridad, diff vacío en `_gateSanitizeNextActionOverride`, las 6 suites de verify) antes de commitear tal cual — no se reescribió ni un carácter.
- **Ajuste al comentario de cabecera del endpoint nuevo**: la primera redacción mencionaba literal `mutateSettersData` en un comentario explicando por qué NO hacía falta — eso inflaba el grep de conteo del acceptance criteria (`grep -c "mutateSettersData" index.js` no debía cambiar respecto del baseline). Se reescribió el comentario para decir "el mutex de escrituras async" sin el identificador literal. Cero cambio de comportamiento, el endpoint sigue 100% síncrono.
- **Orden de validación en la rama CIERRE**: se valida `estado` contra `COMMITMENT_CIERRES` ANTES de mirar si el lead tiene un compromiso pendiente — un `{estado:'basura'}` da 400 sin importar el estado del dominio, consistente con el resto de los 400 del proyecto.

## Deviations from Plan

None (aparte de lo documentado en Decisions Made, que son ajustes cosméticos sin cambio de comportamiento) - los 3 tasks se completaron sin necesidad de Rule 1/2/3/4 de deviation.

## Issues Encountered

- **Sesión paralela commiteando a `main` durante la ejecución**: entre el commit de Task 2 (`c7dfd13`) y el de Task 3 (`5cc9122`) apareció un commit ajeno `bfe228a style(marca): simbolo SCM en header, login y favicon` (branding, `public/index.html` + `public/style.css` + `public/marca/*.svg`) hecho por otra sesión de trabajo en el mismo repo. Verificado con `git show --stat` que ninguno de los 3 commits de este plan tocó ningún archivo bajo `public/` — el criterio de verificación #5 del plan ("`git diff --name-only` devuelve exactamente `index.js` y `tests/commitment-endpoints.test.js`") se cumple para los archivos que ESTE plan tocó; el diff acumulado desde `202e8dd` (fin de 31-01) hasta `HEAD` incluye también los archivos de la sesión de branding paralela, que son ajenos a este plan. Documentado acá en vez de en el criterio porque no es un desvío del plan — es la misma clase de interferencia que documenta CLAUDE.md (nota `[[user-commits-in-parallel]]`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Contrato HTTP exacto para 31-03/31-04** (copiado de `<interfaces>` del plan, confirmado en código):
  - `POST /api/setters/leads/:id/call-disposition` — `body.commitment: {tipo, parte?, canal?, motivo?, dueAt?} | undefined` (opcional, aditivo). Inválido/ausente → se ignora en silencio, nunca 400. Respuesta sigue siendo `{ok, lead, calendarEntry, resolvedPendingId}` — `lead.commitment` y `lead.nextAction` viajan dentro de `lead`.
  - `PATCH /api/setters/leads/:id/commitment` (auth: `requireAuth`) — body A crear/reemplazar `{tipo, parte?, canal?, motivo?, dueAt?}`, body B cerrar `{estado: 'cumplido'|'incumplido'|'vencido'}`. Respuestas: `200 {ok:true, commitment, nextAction, lead:{id, ...lead}}` / `400 {error}` (tipo o estado inválido) / `403 {error}` (no dueño / fuera de visibilidad) / `404 {error}` (lead inexistente) / `409 {error}` (crear sobre lead terminal, o cerrar sin compromiso pendiente).
- **La respuesta de `PATCH .../commitment` trae `lead` completo** — el frontend (31-03) debe pasar `data.lead` a `_leadStoreApply` en vez de armar un patch parcial a mano (regla #105 de CLAUDE.md), igual que ya hace `openNextStepModal` con la respuesta de `call-disposition`.
- **Efecto visible esperado, no una regresión**: los leads con compromiso pendiente SALEN de la cola de Llamadas hasta su fecha (el espejo `callbackAt` de `_setNextAction` los filtra, patrón ya establecido por follow-ups/callbacks). Es el comportamiento buscado por D-05 — el plan 31-04 les da su sección propia ("Compromisos") en Hoy para que no "desaparezcan" (D-10), agrupados por `parte` (los propios primero).
- **31-03** puede extender `#call-next-modal`/`openNextStepModal` sumando `commitment: {...}` al body que ya arma (junto a `nextAction`), y `PATCH .../commitment` para el bloque "Compromiso" de la ficha del lead fuera de una llamada.
- **31-04** puede leer `lead.commitment` directo (ya viene en cada lead vía `GET /leads/sin-wsp`, `ensureLeadDefaults` lo inicializa en cada load) para la sección "Compromisos" de Hoy y el historial en el timeline del lead — no hace falta ningún endpoint agregado nuevo.
- Sin bloqueantes. `public/` no fue tocado por este plan (los cambios de `public/` en el rango `202e8dd..HEAD` son de una sesión paralela de branding, ver Issues Encountered) — cero bump de cache-buster de parte de este plan, tal como pedía el objective.

---
*Phase: 31-comm-compromisos*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/commitment-endpoints.test.js`
- FOUND: `.planning/phases/31-comm-compromisos/31-02-SUMMARY.md`
- FOUND commit `f87dd54` (Task 1)
- FOUND commit `c7dfd13` (Task 2)
- FOUND commit `5cc9122` (Task 3)
