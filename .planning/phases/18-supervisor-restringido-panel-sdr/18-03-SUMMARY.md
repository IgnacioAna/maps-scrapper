---
phase: 18-supervisor-restringido-panel-sdr
plan: 03
subsystem: frontend-supervisor-scoped
tags: [rbac, supervisor-scoping, app.js, index.html, ui]
requires: [visibleSetterIds-plumbing]
provides: [editor-visibleSetterIds, home-scoped-view-team, sidebar-hide-scoped]
affects: [public/app.js, public/index.html]
completed: 2026-07-12
---

# Phase 18 Plan 03: Frontend del supervisor scoped — Summary

Cierra el loop de gestión y experiencia del supervisor restringido: el admin edita/crea la lista de setters visibles desde el Centro de Comando, y un supervisor scoped aterriza en su panel de rendimiento (Equipo) con el sidebar depurado de las vistas que el backend (plan 18-01) 403ea. Cero regresión para admin, setter y supervisor sin lista (todo gateado por `role==='supervisor' && visibleSetterIds?.length > 0`).

## Qué se construyó

### Task 1 — Editor de setters visibles (admin)
- **Modal en la tabla de usuarios** (`loadUsersPanel`, `public/app.js`): botón "Setters visibles" (con contador `(N)` si ya hay lista) que aparece SOLO en filas `user.role === 'supervisor'`, dentro del gate `meIsAdmin`. Abre `window._editVisibleSetters(userId, userName, currentIdsJson)`: overlay fixed (patrón de `_showOnboardingDetail`) que lista todos los setters no-`hidden` (fetch `/api/setters`) como checkboxes, pre-tildando `user.visibleSetterIds`. Guardar → `PATCH /api/auth/users/<id>` con `{ visibleSetterIds: [ids] }` → `loadUsersPanel()`. Texto de ayuda: "Vacío = ve todos los setters."
- **Selector en el invite** (`public/index.html` + `public/app.js`): contenedor `#invite-visible-setters` (oculto por default) tras el form de invitación. Listener `change` sobre `#invite-role`: al elegir `supervisor` se muestra y se puebla `#invite-visible-setters-list` con checkboxes (lazy, una sola vez). El handler de `inviteUserBtn` arma `inviteBody` y, si `role === 'supervisor'`, agrega `visibleSetterIds: [ids tildados]` al POST `/api/auth/invites`. Tras invitar exitoso se destildan los checkboxes.

### Task 2 — Home scoped + sidebar + cache-buster
- **Ocultamiento de sidebar** (tras el loop `data-roles`, `public/app.js`): `const _isScopedSupervisor = role==='supervisor' && visibleSetterIds?.length > 0`. Si scoped, oculta (`classList.add('hidden')`) `SCOPED_HIDDEN_VIEWS = ['view-pool','view-command','view-online']`. (`view-telnyx-config` es `data-roles="admin"` → el supervisor ya no lo ve; no hizo falta sumarlo.)
- **Home scoped** (bloque de ruteo default, `public/app.js`): si scoped, dispara `[data-target="view-team"]`.click() **diferido con `setTimeout(0)`** porque el loader `_teamLoad` se bindea más abajo en el mismo init (~línea 14210); el defer garantiza que el listener esté montado cuando disparamos el click. Los demás roles y el supervisor sin lista siguen yendo a `view-calls` (inmediato, su loader ya está bindeado).
- **Cache-buster**: `app.js?v=20260711e` → **`v=20260712a`** en `index.html`. `style.css` NO se tocó (sigue en `v=20260710a`).

### Task 2d — Verificación de dropdowns (solo lectura, sin cambios)
- `view-team`: `_teamLoad` renderiza alertas + tabla desde la respuesta `d` de `/api/setters/team-performance` (backend ya filtra `perSetter` al subconjunto). Correcto sin tocar.
- `view-myperf`: el `#setter-select` se puebla desde `settersList` = `stats.setters` de `/api/setters/stats` (backend ya filtra la lista de setters para supervisor scoped). Correcto sin tocar.

## Deviations from Plan
Ninguna funcional. Ajuste de implementación dentro del espíritu del plan (Rule 3 — desbloqueo):
- **Home scoped diferido con `setTimeout(0)`**: el plan sugería el `.click()` inline antes del `_defaultMenuItem.click()`. El loader `_teamLoad` se registra recién ~línea 14210 (después del punto de ruteo ~10760), así que un click inmediato mostraría la vista pero NO cargaría los datos. El defer resuelve el ordering sin mover código. (`view-calls` no necesita defer: su loader ya está bindeado en ~7242.)

## Cómo el frontend sabe que está scoped
`/api/auth/me` → `publicUser` (plan 18-01) devuelve `visibleSetterIds: []` → `currentUser.visibleSetterIds`. Condición canónica usada en los 2 puntos (sidebar + home): `currentUser.role === 'supervisor' && currentUser.visibleSetterIds?.length > 0`.

## Verificación
- `node --check public/app.js` → SYNTAX OK.
- `visibleSetterIds` en app.js: 10 ocurrencias (>= 3 requerido).
- `SCOPED_HIDDEN_VIEWS` presente; rama de home `data-target="view-team"` presente.
- `index.html` contiene `app.js?v=20260712a`.

## Checklist de verificación manual en vivo (para el user)
Requiere levantar preview/prod, login como admin, y un supervisor con `visibleSetterIds`.

1. **Editar (admin)**: Centro de Comando → tabla de usuarios → en una fila de rol `supervisor`, botón **"Setters visibles"** → tildar 2-3 setters → Guardar. Reabrir el modal y confirmar que persistió (checkboxes tildados + contador en el botón).
2. **Invitar (admin)**: form de invitación → elegir rol **Supervisor** → confirmar que aparece el bloque de checkboxes de setters → tildar algunos → Invitar. (Backend 18-01 persiste `visibleSetterIds` en el invite → accept-invite lo copia al user.)
3. **Home scoped**: loguearse como ese supervisor scoped → confirmar que aterriza en **Equipo (view-team)**, NO en Llamadas, y que la comparativa/alertas cargan (no vacío).
4. **Dropdowns filtrados**: en Equipo y en Mi rendimiento, el selector de SDR muestra SOLO los setters tildados (los ocultos ni aparecen).
5. **Sidebar depurado**: el supervisor scoped NO ve **Distribución de leads**, **Centro de Comando** ni **Equipo online** en el sidebar.
6. **No-regresión**: un supervisor SIN setters tildados (o admin) aterriza en **Llamadas** y ve TODAS las vistas.

## Self-Check: PASSED
- `public/app.js` y `public/index.html` modificados y en disco (diff: +142/-4).
- `node --check public/app.js` limpio.
- Cache-buster `v=20260712a` presente en `index.html`.

## Upgrade panel pro (2026-07-12)

El user reportó que el panel del supervisor (view-team) estaba "medio choto". Se convirtió la tabla comparativa en un dashboard de rendimiento PRO (aplica a admin y supervisor, scoped o no — el scoping lo resuelve 18-01 en backend).

### Backend (`index.js`, `GET /api/setters/team-performance`)
Dos bloques nuevos calculados DESPUÉS del filtro `visibleSet`, reusando `callsBySetter`/`_callSetterId` y `_bizDayStr` (TZ de negocio #113):
- **`teamTotals`**: sumas del período de los setters visibles (`dials/connects/conversations/appointments/deals`) + rates recalculadas de las sumas (no promedio de promedios). `teamAverages` intacto.
- **`callsByDay`**: `{days:[14 días de negocio], perSetter:[{setterId, name, dials[14], connects[14]}]}` — SIEMPRE 14 días hasta hoy (independiente del `period`), solo setters visibles, connects por `COLD_CALL_CONNECT_OUTCOMES`.

### Frontend (`public/app.js` + `public/index.html`)
En view-team, entre alertas y la tabla:
- **Fila de KPI tiles** (`.myp-tile`): Llamadas, Atendidas (% connect), Conversaciones (%), Agendadas (% booking), Deals — de `teamTotals`.
- **Chart.js "Llamadas por día"**: línea multi-serie (una por SDR, 14 días), toggle `.seg-control` Llamadas/Atendidas (redibuja sin refetch), instancia `_teamChart` con destroy en re-render (patrón de `_mypRenderChart`), tooltip themed, paleta `_TEAM_SERIES_COLORS` del design system.
- **Mini-funnels por SDR**: grid responsive, card por setter con dials→connects→conversations→appointments→deals + chips `.ccm-bench ok/mid/low` (benchmarks connect 15-25 / conv 50-60 / booking 15-25). Click → `_teamDrilldown` (view-myperf preseleccionado, mismo handler que la fila de tabla).
- Tabla comparativa + alertas QUEDAN debajo, sin cambios. UI minimalista sin emojis. Cache-buster `v=20260712b` (app.js). `style.css` NO se tocó.

### Tests
`tests/supervisor-scope.test.js` +2 casos (teamTotals/callsByDay scoped solo visibles; admin recibe los 3). `npx vitest run supervisor-scope team-performance` → 40/40 verde.
