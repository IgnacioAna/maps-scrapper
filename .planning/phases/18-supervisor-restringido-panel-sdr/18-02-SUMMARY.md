---
phase: 18-supervisor-restringido-panel-sdr
plan: 02
subsystem: tests
tags: [rbac, supervisor-scoping, tests, security]
requires: [_visibleSetterIds, _filterSettersVisible, _setterIsVisible, visibleSetterIds-plumbing]
provides: [tests/supervisor-scope.test.js]
affects: [tests/supervisor-scope.test.js]
completed: 2026-07-12
---

# Phase 18 Plan 02: Suite de tests supervisor-scope — Summary

Suite `tests/supervisor-scope.test.js` (21 casos, todos verdes) que verifica en CI el scoping server-side del rol `supervisor` implementado en el plan 18-01. Confirma que un supervisor con `visibleSetterIds` configurado ("scoped") NO puede ver data de setters fuera de su lista en ningún endpoint auditado, que un supervisor sin lista y un admin mantienen comportamiento idéntico (cero regresión), y que la gestión de `visibleSetterIds` es admin-only y valida ids contra setters existentes.

## Fixture

- **Users:** `user_admin` (admin), `user_sup_scoped` (supervisor, `visibleSetterIds:['setter_a','setter_b']`), `user_sup_all` (supervisor sin lista — regresión), `user_link_a` (setter, `setterId:'setter_a'`, para probar filtrado en `/api/auth/online` y `/api/auth/users`), `user_link_c` (setter, `setterId:'setter_c'`, oculto).
- **Setters:** `setter_a`, `setter_b` (visibles para el scoped), `setter_c` (oculto).
- **Leads/callLog:** `lead_a1`+`lead_a2` (setter_a, 2 dials, 1 connect), `lead_b1` (setter_b, 4 dials, 1 connect), `lead_c1` (setter_c, 10 dials, 1 connect) — todos `channel:'telnyx_webrtc'`, algunos con `scriptIdsUsed:['script_1']` para el caso de script-effectiveness. `lead_resp_a`/`lead_resp_c` sin callLog, usados solo para el caso de speed-to-lead (`recent-responses`).

## Casos cubiertos (21 `it`)

1. **team-performance**: `perSetter` solo trae setter_a/setter_b; `teamAverages.total` = avg(2,4) = 3 (aserción numérica exacta, no solo `.not.toContain`).
2. **cold-call-metrics**: sin `?setter` agrega 6 dials (2+4) para el scoped vs 16 (2+4+10) para admin; `?setter=setter_c` → 403.
3. **`/api/setters` y `/api/setters/stats`**: `setters[]` sin setter_c para el scoped; admin ve los 3.
4. **PATCH lead de setter oculto** → 403.
5. **`/api/telnyx/balance`** → 403 para el scoped.
6. **`/api/auth/online`** y **`/api/auth/users`**: filtran al user linkeado a setter_c; admin ve todos.
7. **`/api/telnyx/script-effectiveness`**: `used` del script solo cuenta setter_a+setter_b (2) para el scoped vs 3 (incluye setter_c) para admin.
8. **`/api/setters/recent-responses`** (speed-to-lead): admin dispara 2 respuestas (setter_a y setter_c vía PATCH `respondio:true`); el scoped solo recibe la de setter_a, admin recibe ambas.
9. **Regresión**: supervisor sin `visibleSetterIds` y admin ven los 3 setters en team-performance.
10. **Gestión admin-only**: PATCH `visibleSetterIds` válido persiste; id inexistente (`setter_zzz`) se filtra (persiste `[]`); el propio supervisor scoped intentando PATCH su registro → 403 (endpoint `requireRole('admin')`).

Los casos de gestión (mutan `visibleSetterIds` del fixture) van al final del archivo para no interferir con las aserciones de scoping anteriores.

## Resultado

`npx vitest run tests/supervisor-scope.test.js` → **21/21 passed** en el primer intento, sin necesidad de tocar `index.js` (el trabajo de 18-01 pasó la auditoría sin bugs reales expuestos).

`npx vitest run tests/training-privacy.test.js tests/team-performance.test.js` → **25/25 passed**, cero regresión.

`node --check index.js` → limpio (sin cambios al archivo).

## Deviations from Plan

Ninguna. No se encontraron bugs reales en el scoping de 18-01 que requirieran fix — todos los 21 casos pasaron sin modificar `index.js`.

## Self-Check: PASSED

- `tests/supervisor-scope.test.js` existe y contiene "supervisor-scope" en el nombre del archivo.
- `grep -c "delete process.env" tests/supervisor-scope.test.js` == 0.
- Fixture incluye `setter_a`, `setter_b`, `setter_c` y `visibleSetterIds: ['setter_a','setter_b']` (verificado por lectura del archivo escrito).
- 21 casos `it(` (supera el mínimo de 12 pedido por el plan).
- `npx vitest run tests/supervisor-scope.test.js` → exit 0, 21/21 PASS.
