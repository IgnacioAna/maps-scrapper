---
phase: 34-hoy-vista-diaria
plan: 02
subsystem: ui
tags: [frontend, hoy, power-dialer, cascada-tiers, filtro-pais, higiene]

# Dependency graph
requires:
  - phase: 34-hoy-vista-diaria (plan 01)
    provides: "l.nextAction siempre RESUELTO en GET /api/setters/leads/sin-wsp (migrado o derivado vía _leadNextAction) — la cascada de tiers de este plan clasifica sobre ese campo"
  - phase: 33-dial-motor-unico (plan 03)
    provides: "_hoyRenderFromStore (Hoy se pinta desde el store, sin fetch) y el guard anti-repintado que este plan reescribe por dentro sin tocar la firma"
  - phase: 31-comm-compromisos (plan 04)
    provides: "_commitmentHoyBucket(lead, nowMs), _hoyCommitBadge, los títulos 'Mis compromisos'/'Esperando del prospecto' que este plan reutiliza"
provides:
  - "_hoyRenderFromStore reclasificado en 5 tiers EXCLUYENTES (D-01/D-02): compromisos que vencen hoy -> Interesados -> Reintentos de no-contacto que vencen hoy -> Nuevos por score (gateado) -> Red de seguridad (colapsable)"
  - "terminal() dentro de _hoyRenderFromStore excluye también estado:'cerrado' (deals ganados, Fase 9)"
  - "_hoySelectedCountry() / _hoyPopulateCountryFilter(leads) — filtro por país en Hoy, ordenado por horario hábil (D-05), persistido por usuario en localStorage"
  - "allLeadsForHygiene — copia de leads SIN filtrar por país, disponible dentro de _hoyRenderFromStore para que 34-03 mida la higiene del pipeline completo"
  - "_hoyRenderSection gana opts.collapsible (Red de seguridad empieza abierta si tiene algo, colapsable con <details>/<summary>)"
  - "_hoyState gana retryIds (ids de la sección Reintentos de no-contacto)"
affects: [34-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "opts.collapsible en _hoyRenderSection: misma extensión no invasiva que opts.rowBadge (Fase 31) — sin la opción el markup queda byte-idéntico."
    - "_commitDueAt(l): helper local (closure, no exportado) que resuelve la fecha VIGENTE de un compromiso preferendo lead.nextAction.dueAt sobre lead.commitment.dueAt cuando el reloj es de origen 'compromiso' — evita que 'esperando del prospecto' (cumplido) filtre por una fecha que ya quedó en el pasado."
    - "Filtro visual (país) separado del snapshot de higiene: allLeadsForHygiene se captura ANTES de aplicar cualquier filtro visual, para que paneles de tendencia/higiene no dependan de una preferencia de UI que cambia durante el día."

key-files:
  created:
    - tests/hoy-sections.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/commitment-hoy.test.js
    - tests/dial-sync.test.js
    - tests/act-ui-discard-material.test.js

key-decisions:
  - "Se siguió el código literal del plan (interfaces + Task 1/2 action) sin desviarse del diseño, incluida la reformulación multi-línea de misCompromisos/compromisosProspecto — aunque eso rompiera 2 tests preexistentes NO anticipados por el plan (ver Deviations)."
  - "_hoyPopulateCountryFilter NO usa una variable `key` compartida para el literal de localStorage (a diferencia del snippet inicial que copié del plan) — se cambió a inlinear el literal 'hoy_country_filter_' + userId en la lectura Y en la escritura, igual que el patrón preexistente de calls_country_filter_ en loadCallsView. Esto además satisface el acceptance criteria explícito del plan (grep -c >= 2), que con la variable compartida daba 1."
  - "totalPend NO suma redSeguridad (documentado explícitamente en el plan): Red de seguridad es un backlog aparte con su propio contador en 34-03, no parte de 'para seguir'."

patterns-established:
  - "Cascada de tiers con `claimed` Set compartido: cualquier sección nueva de Hoy que compita por el mismo lead debe filtrar por !claimed.has(l.id) y sumarse al final con .forEach(l => claimed.add(l.id)) — el orden de cálculo determina la prioridad."

requirements-completed: [HOY-01, HOY-02, HOY-04]

# Metrics
duration: "~40 min"
completed: 2026-08-16
---

# Phase 34 Plan 2: Cascada de 5 tiers en Hoy + filtro por país Summary

**`_hoyRenderFromStore` pasó de 4 buckets sueltos sin prioridad explícita a una cascada de 5 tiers exclusivos (compromisos que vencen hoy → interesados → reintentos de no-contacto → nuevos por score gateado → red de seguridad colapsable), con un `claimed` Set único compartido entre las 5 secciones reclamables (D-02) y un filtro por país ordenado por horario hábil (D-05) que persiste por usuario — además de capturar `allLeadsForHygiene` (copia sin filtrar) para que 34-03 mida la higiene del pipeline completo, no el recorte visual del filtro activo.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-16T15:27:15Z
- **Tasks:** 3/3
- **Files modified:** 5 (`public/app.js`, `public/index.html`, `tests/commitment-hoy.test.js`, `tests/dial-sync.test.js`, `tests/act-ui-discard-material.test.js`) + 1 creado (`tests/hoy-sections.test.js`)

## Accomplishments

- `_hoyRenderFromStore` clasifica en el orden D-01: Mis compromisos (vencen hoy) → Esperando del prospecto (plazo vencido) → Callbacks (vencen hoy) → Interesados sin agendar (sin acotar fecha, D-03) → Reintentos de no-contacto (tier nuevo, cadencia automática que vence hoy) → Nuevos por score (gateado — solo si los 5 tiers anteriores están vacíos) → Red de seguridad (colapsable, solo leads tocados con `callLog.length > 0`, D-10).
- `claimed` es ahora un Set único compartido por los 5 tiers reclamables — antes Mis compromisos/Esperando del prospecto quedaban fuera a propósito (Fase 31); Fase 34 invierte esa decisión para dar exclusividad real (D-02): un lead nunca aparece en dos secciones a la vez.
- `terminal()` excluye también `estado === 'cerrado'` (deals ganados, Fase 9) — antes un lead cerrado con callLog podía colarse en Red de seguridad.
- Filtro por país (`select#hoy-country-filter`) en el header de Hoy: ordena primero los países en horario hábil ahora mismo (mismo criterio que "¿A qué país llamar ahora?" de Distribución), persiste por usuario en localStorage, y repinta desde el store sin fetch al cambiar.
- `allLeadsForHygiene` — copia de `leads` capturada ANTES de aplicar el filtro de país, disponible en el scope de `_hoyRenderFromStore` para que 34-03 (panel de higiene, HOY-05) clasifique sobre el pipeline completo sin importar qué país esté filtrado en pantalla.

## Task Commits

Un solo commit atómico para las 3 tasks (cascada + filtro de país + tests están fuertemente acopladas dentro de la misma función; separarlas en 3 commits habría dejado estados intermedios con tests rotos a propósito):

1. **Tasks 1+2+3: cascada de 5 tiers, filtro por país, allLeadsForHygiene, suite nueva + 3 tests preexistentes corregidos** - `304926d` (feat)

## Files Created/Modified

- `public/app.js` - `_hoyRenderFromStore` reescrito (cascada de 5 tiers + captura de `allLeadsForHygiene` + aplicación del filtro de país); `_hoySelectedCountry`/`_hoyPopulateCountryFilter` nuevos; `_hoyRenderSection` gana `opts.collapsible`; `loadHoyView` puebla el filtro de país antes de pintar.
- `public/index.html` - `select#hoy-country-filter` en el header de `view-hoy`; cache-buster de `app.js` bumpeado.
- `tests/hoy-sections.test.js` (nuevo) - 33 tests: orden de la cascada, exclusividad (`claimed`), `terminal()` con 'cerrado', Red de seguridad solo tocados, gate del tier Nuevos, `_commitDueAt`, regresión de `opts.collapsible` ejecutando `_hoyRenderSection` aislada con `new Function`, filtro de país (orden + persistencia + aplicación antes de `claimed`), y el test anti-regresión de `allLeadsForHygiene`.
- `tests/commitment-hoy.test.js` - 2 tests actualizados según lo instruido explícitamente por el plan (hints nuevos "vence hoy"/"el plazo venció"; `claimed.add` ahora en 6, no en 2 — la intención de Fase 31 se invirtió a propósito en Fase 34).
- `tests/dial-sync.test.js` - 1 test corregido (deviation, ver abajo): el conteo literal de `_hoyRenderSection(` sube de 5 a 7.
- `tests/act-ui-discard-material.test.js` - 2 tests corregidos (deviation, ver abajo): el check línea-por-línea de `!terminal(l)`/`notDnc(l)` junto a `_commitmentHoyBucket` se reescribió para operar sobre la expresión `filter(...)` completa balanceada por paréntesis, no por línea.

## Decisions Made

- Se siguió el código literal dado por el plan en Task 1 (incluida la reformulación multi-línea de `misCompromisos`/`compromisosProspecto` con `_commitDueAt`), sin adaptarlo para minimizar el blast radius en tests preexistentes — el plan fue explícito y detallado en ese código, y adaptarlo hubiera sido reinterpretar el diseño.
- `_hoyPopulateCountryFilter` se ajustó (respecto al snippet inicial del plan) para inlinear el literal de localStorage en vez de usar una variable `key` compartida — necesario para satisfacer el acceptance criteria explícito `grep -c "hoy_country_filter_" public/app.js` >= 2, y además consistente con el patrón preexistente de `calls_country_filter_` en `loadCallsView` (que tampoco usa variable compartida).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug expuesto por el diseño del propio plan] `tests/dial-sync.test.js` — conteo literal de `_hoyRenderSection(` roto**
- **Found during:** Task 3 (verificación completa tras Task 1)
- **Issue:** El plan Task 3 acceptance criteria dice explícitamente que `tests/dial-sync.test.js` debe pasar SIN editarlo. Pero ese archivo tiene un test que verifica `countOccurrences(appJs, "_hoyRenderSection(")` === 5 (1 declaración + 4 llamadas, "igual que antes del refactor"). El diseño de Task 1 (código literal dado por el plan) agrega 2 llamadas nuevas a `_hoyRenderSection` ('Reintentos de no-contacto' y 'Red de seguridad'), subiendo el conteo a 7. Es una contradicción directa entre el Task 1 action y el Task 3 acceptance criteria del mismo plan — no detectada por las 2 rondas de plan-checker.
- **Fix:** Se actualizó el número esperado de 5 a 7, documentando la razón en un comentario que referencia este plan.
- **Files modified:** `tests/dial-sync.test.js`
- **Verification:** `npx vitest run tests/dial-sync.test.js` → 34/34 verde.
- **Committed in:** `304926d`

**2. [Rule 1 - Bug expuesto por el diseño del propio plan] `tests/act-ui-discard-material.test.js` — check línea-por-línea roto**
- **Found during:** `npm test` completo tras Task 3 (no estaba en el read_first de ningún task ni en la lista de tests preexistentes que el plan anticipaba tocar)
- **Issue:** Un describe de Fase 32 ("Hoy — las secciones de compromiso dejan de mostrar terminales, ACT-04") verificaba que la línea de texto conteniendo `_commitmentHoyBucket(l, nowMsHoy)` contuviera también `!terminal(l)` y `notDnc(l)` en la MISMA línea. El código literal del plan (Task 1, paso 3) reformatea `misCompromisos`/`compromisosProspecto` a 3 líneas (guard `!claimed.has(l.id) && notDnc(l) && !terminal(l)` en la primera, `_commitmentHoyBucket(...)` y la nueva condición de `_commitDueAt` en las siguientes) — el check línea-por-línea deja de encontrar el patrón en la misma línea.
- **Fix:** Se reescribieron los 2 `it()` para extraer la expresión `filter(...)` COMPLETA (balanceada por paréntesis, mismo patrón que `extractFunctionBody` pero para paréntesis en vez de llaves) y verificar sobre esa expresión en vez de línea por línea. La invariante original (que ambos filtros sigan excluyendo terminales y DNC) se preserva intacta.
- **Files modified:** `tests/act-ui-discard-material.test.js`
- **Verification:** `npx vitest run tests/act-ui-discard-material.test.js` → 44/44 verde; `npm test` completo → 1850/1850 verde.
- **Committed in:** `304926d`

---

**Total deviations:** 2 auto-fixed (ambos Rule 1, tests preexistentes rotos por el diseño explícito del propio plan, no anticipados por el checker).
**Impact on plan:** El plan anticipó correctamente 2 tests rotos en `commitment-hoy.test.js` (corregidos tal cual instruyó). Se encontraron 2 casos adicionales de la MISMA clase de problema en otros archivos, corregidos con el mismo criterio (actualizar la aserción, no revertir el diseño). Ningún cambio de alcance — todas las correcciones son ajustes de tests anti-deriva a la intención nueva, documentados con referencia a este plan.

## Issues Encountered

- El acceptance criteria de Task 2 (`grep -c "hoy_country_filter_" public/app.js` >= 2) no se cumplía con el código literal del snippet del plan (que usa una variable `key` compartida, dando 1 sola ocurrencia del literal). Se resolvió inlineando el literal en la lectura y la escritura, consistente con el patrón preexistente de `calls_country_filter_` — no fue necesario tocar ningún test para esto, se ajustó el código antes de que hubiera divergencia.
- La verificación por mutación pedida en `<verification>` (romper la condición de fecha de `misCompromisos` y confirmar que un test específico se pone en rojo) se ejecutó y restauró correctamente — `tests/hoy-sections.test.js` detectó el corte en el test "misCompromisos filtra y ordena con _commitDueAt (vence hoy)".

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Para 34-03 (panel de higiene, HOY-05):** `allLeadsForHygiene` está disponible como `const` dentro del scope de `_hoyRenderFromStore`, capturado ANTES de cualquier filtro de país — 34-03 debe clasificar sobre esa copia, NO sobre los arrays `callbacks`/`misCompromisos`/`interesados`/`reintentos`/`redSeguridad` (que están filtrados por país si el usuario tiene uno elegido).
- **Para 34-03 (botones de Power Dialer):** Los botones de "Mis compromisos", "Esperando del prospecto" y "Reintentos de no-contacto" quedaron con `dialerMode: null` A PROPÓSITO — 34-03 los activa junto con el rewrite de `_pdBuildQueueHoy` (que hoy solo conoce `_hoyState.callbackIds`/`interesadoIds`, no `commitYoIds`/`commitProspectoIds`/`retryIds`, aunque `_hoyState` ya los expone).
- **Qué queda SIN verificar en vivo** (no hay browser/jsdom en el repo, todo se verificó por aserción de fuente + ejecución aislada de `_hoyRenderSection` con `new Function`):
  - Cómo se ve la Red de seguridad colapsada vs. abierta en un browser real — el `<details>`/`<summary>` no se probó visualmente contra el resto del lenguaje visual de Hoy (`.hoy-section`, `.hoy-section-head` con `cursor:pointer`).
  - El desplegable de país (`select#hoy-country-filter`) con datos reales de producción — el orden por horario hábil (🟢/🟡) y el conteo por país se verificaron por lectura de código (sort + `_leadLocalTime`), no ejecutados contra un DOM real.
  - Que las 2 nuevas secciones (Reintentos de no-contacto, Red de seguridad) se integren visualmente bien con el resto de las cards de Hoy — mismo estilo inline que las secciones existentes, sin CSS nuevo (esta fase no tocó `style.css`, confirmado por `git diff --stat`).

---
*Phase: 34-hoy-vista-diaria*
*Completed: 2026-08-16*

## Self-Check: PASSED

Todos los archivos declarados como creados/modificados existen en disco, y el commit `304926d` está presente en `git log`.
