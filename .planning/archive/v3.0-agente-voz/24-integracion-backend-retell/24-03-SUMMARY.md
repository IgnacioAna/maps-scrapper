---
phase: 24-integracion-backend-retell
plan: 03
subsystem: api
tags: [retell, voice-agent, dispatch, caller-id, dry-run, rate-limiting, testing]

# Dependency graph
requires:
  - phase: 24-02
    provides: "loadRetellConfig/saveRetellConfig, VOICE_AGENT_SETTER_ID, dailyCap/rotationIdx/agentId/fromNumberId en retell_config.json"
  - phase: 24-01
    provides: "globalThis.__voiceAgent, _estimateTelnyxCost en scope de módulo"
provides:
  - "`_retellPrefixToIso`, `_retellPickNumberForDestination`, `_retellCallsTodayCount`, `_retellSelectDispatchLeads`, `_retellDynamicVariables` en scope de módulo de index.js — helpers de selección/caller ID/costo/variables, todos reusando _leadIsCallableNow y el CALL METRICS CORE (_ccCollectCalls/_ccResolveRange) sin lógica de elegibilidad ni conteo nuevos"
  - "`POST /api/admin/voice-agent/dispatch` admin-only: dispara el lote real de llamadas con cap diario, dry-run, rotación de caller ID persistida y manejo de error por lead"
  - "`_voiceDispatchedToday` (contador en memoria del cap, con `_voiceDispatchRollover` obligatorio por `_bizDayStr`), `_pendingRetellCalls` (Map callId→{leadId,at}, contrato para el webhook de 24-05), `_voiceDispatchFetch` (fetch inyectable para tests), `RETELL_ASSUMED_CALL_SECS=90` — todo expuesto en `globalThis.__voiceAgent`"
  - "`tests/retell-dispatch.test.js` (30 tests): RBAC, selección con las 6 exclusiones de `_leadIsCallableNow`, cap diario + rollover de día, caller ID (round-robin persistido vs routing explícito vs `active:false`), variables dinámicas, robustez ante fallos de Retell por lead, correlación `_pendingRetellCalls`, y verificación de que ningún dispatch (dry-run ni real) escribe en `callLog`"
affects: [24-04, 24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fetch inyectable para un route handler Express (no una función standalone): en vez de un parámetro `fetchImpl` (imposible de pasar en una request HTTP real), el punto de inyección es un objeto de módulo mutable (`_voiceDispatchFetch = { impl: fetch }`) expuesto en `globalThis.__voiceAgent` — los tests lo pisan en `beforeAll` y lo restauran a `fetch` en `afterAll`. Mismo espíritu que el patrón `fetchImpl` de `_telnyxNumberLookup`, adaptado al contrato de un endpoint HTTP en vez de una función pura invocable directamente."
    - "Contador de cap diario mutado in-place (`_voiceDispatchedToday.dayKey`/`.count`), nunca reasignado — así la referencia expuesta en `globalThis.__voiceAgent` sigue siendo la misma tras el rollover, y los tests pueden simular el cambio de día escribiendo directamente sobre el objeto sin perder la conexión con el estado real del módulo."
    - "Caller ID resuelto SECUENCIALMENTE antes de correr el pool de fetches en paralelo: la rotación round-robin necesita determinismo (cada lead recibe su número ya decidido antes de que el pool dispare las llamadas), así que la asignación de números es un loop síncrono previo, no parte de los thunks paralelos."

key-files:
  created:
    - tests/retell-dispatch.test.js
  modified:
    - index.js

key-decisions:
  - "`_retellDynamicVariables(lead, retellCfg)` respeta la firma de 2 argumentos exacta del plan leyendo `lead.id` — el caller (el handler del dispatch) le pasa `{ id, ...lead }` en vez de que el helper reciba un tercer parámetro `leadId`. Los objetos leads en `data.leads` NO traen `.id` embebido de forma consistente en el resto del código base (se verificó por grep: solo un puñado de endpoints hacen spread explícito con `{id, ...lead}}`), así que mergear el id en el punto de llamada evita cambiar el contrato documentado en `<interfaces>` del plan."
  - "El rollover se invoca en 2 puntos, tal como pide el plan: al principio del handler (antes de leer `remaining`) y de nuevo justo antes de sumar los éxitos a `_voiceDispatchedToday.count` — cubre el caso borde de que el dispatch cruce la medianoche de negocio mientras el pool de fetches está en vuelo."
  - "El fixture de test usa un lead adicional en estado terminal (`lead_precalled`, `estado:'agendado'`) con una entry de callLog de HOY atribuida al agente, para simular 'ya se hizo 1 llamada hoy' sin contaminar la selección de los 3 leads elegibles (el estado terminal lo excluye de `_leadIsCallableNow` mientras su callLog sigue contando para `_retellCallsTodayCount`). Esto deja el baseline `calledToday=1` CONSTANTE durante todo el archivo de test — ningún dispatch (dry-run ni real) escribe callLog (D-24-05), así que el número nunca cambia por efecto colateral, lo que permite fórmulas de `capRemaining` deterministas en cada test sin necesidad de resetear el fixture entre bloques."

requirements-completed: [VOICE-03]

# Metrics
duration: ~18min
completed: 2026-07-31
---

# Phase 24 Plan 03: Dispatch por lote del agente de voz Summary

**`POST /api/admin/voice-agent/dispatch` admin-only que selecciona leads de la cartera de `setter_agente_ia` con el MISMO filtro de elegibilidad que la cola humana (`_leadIsCallableNow`), decide caller ID server-side (routing explícito o round-robin persistido en `retell_config.json`), respeta un cap diario con rollover de día a prueba de fugas, soporta `dryRun` sin gastar un centavo, y reporta el fallo de Retell por lead (típicamente `from_number` no importado hasta Phase 26) sin romper el lote — 30 tests nuevos, suite completa 1076/1076.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-31T13:13:00-03:00 (aprox, primer read de los summaries previos)
- **Completed:** 2026-07-31T13:31:25-03:00 (commit de Task 3)
- **Tasks:** 3/3 completadas
- **Files modified:** 1 (`index.js`) + 1 nuevo (`tests/retell-dispatch.test.js`)

## Accomplishments

- **Task 1 — 5 helpers de módulo**, en scope junto al bloque de config Retell de 24-02: `_retellPrefixToIso` (port verbatim del mapeo de prefijos del frontend), `_retellPickNumberForDestination` (port server-side de `pickNumberForDestination` con `rotationIdx` persistido en `retell_config.json` en vez de `localStorage`, filtrando `numbers` por `active !== false` porque `loadTelnyxConfig()` devuelve la lista cruda), `_retellCallsTodayCount` (deriva 100% del CALL METRICS CORE — `_ccCollectCalls` + `_ccResolveRange('today')`, cero loop propio sobre `callLog`), `_retellSelectDispatchLeads` (filtra por `assignedTo===setter_agente_ia` + `_leadIsCallableNow`, el MISMO filtro de la cola humana), `_retellDynamicVariables` (variables del prompt, todos los valores coeridos a string, recortados a 300 chars).
- **Task 2 — el endpoint**, con la secuencia de guards exacta del plan (count 1..50 → agente apagado → sin apiKey → sin agentId → sin número Telnyx activo → dispatch ya en vuelo, `requireRole('admin')`), cap diario (`_voiceDispatchedToday` sumado a `_retellCallsTodayCount`, con `_voiceDispatchRollover` invocado al principio del handler y de nuevo antes de sumar los éxitos), `dryRun:true` que corta antes de cualquier fetch/incremento de `rotationIdx`/contador, caller ID resuelto secuencialmente antes del pool (`_runPool` conc 2) para determinismo, manejo de error por lead (`from_number` no importado hasta Phase 26 cae acá, research §2.6, y el lote sigue), y `_pendingRetellCalls` (correlación `callId→leadId`, contrato para el webhook de 24-05). Cero escritura a `setters.json` (D-24-05: la única escritura de callLog la hace el webhook).
- **Task 3 — 30 tests** en `tests/retell-dispatch.test.js`: RBAC (401/403×2/200), las 6 exclusiones de `_leadIsCallableNow` (DNC, tarifa roja ES fijo, número muerto confirmado, callback futuro, estado terminal, asignado a otro setter) verificadas explícitamente ausentes de la selección, `withDoctor`/`country`/`count` como refinos, caller ID (round-robin con 3 números activos persistido y leído del ARCHIVO — no de la respuesta en memoria —, routing explícito sin rotar, `active:false` nunca elegido), variables dinámicas (correlación `leadId`, coerción string de `reviews`/`rating`/`yearsActive` numéricos), robustez (422 y excepción de red por lead, dry-run sin fetch, `enabled:false`→409, sin apiKey→503, sin número activo→409), cap diario (lote efectivo recortado, cap agotado→409 sin fetch, rollover de día simulado vía `globalThis.__voiceAgent._voiceDispatchedToday`), y verificación explícita de que el `callLog` de los leads elegibles nunca crece (ni dry-run ni real).
- Suite completa: **1076/1076 tests verdes** (71 archivos) — 1046 previos + 30 nuevos, sin editar ningún assert existente.

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: Helpers de caller ID, selección de lote y variables dinámicas** - `dad0be7` (feat)
2. **Task 2: POST /api/admin/voice-agent/dispatch** - `fa1fb1d` (feat)
3. **Task 3: tests/retell-dispatch.test.js** - `0b3a914` (test)

## Files Created/Modified

- `index.js` - Bloque de dispatch de Phase 24 (adyacente al bloque de config Retell y al `GET`/`PUT /api/retell/config` de 24-02): los 5 helpers de Task 1 (`_retellPrefixToIso`, `_retellPickNumberForDestination`, `_retellCallsTodayCount`, `_retellSelectDispatchLeads`, `_retellDynamicVariables`) y el endpoint `POST /api/admin/voice-agent/dispatch` de Task 2 con su estado de módulo (`RETELL_ASSUMED_CALL_SECS`, `_voiceDispatchInFlight`, `_voiceDispatchedToday`, `_voiceDispatchRollover`, `_pendingRetellCalls`/`_voiceCleanPendingRetellCalls`, `_voiceDispatchFetch`, `_retellCreatePhoneCall`). Extensión de `globalThis.__voiceAgent` en 2 puntos (helpers de Task 1 tras su definición; estado de dispatch de Task 2 tras su definición).
- `tests/retell-dispatch.test.js` (nuevo) - 30 tests de RBAC, selección/exclusiones, cap diario + rollover, caller ID, variables dinámicas, robustez ante fallos de Retell, correlación `_pendingRetellCalls` y ausencia de escritura a `callLog`.

## Decisions Made

- **Firma de `_retellDynamicVariables(lead, retellCfg)` con `lead.id` mergeado por el caller**: ver key-decisions del frontmatter.
- **Rollover invocado en 2 puntos exactos** (principio del handler + antes de sumar éxitos): ver key-decisions del frontmatter.
- **Fixture con `lead_precalled` en estado terminal**: ver key-decisions del frontmatter — permite fórmulas deterministas de `capRemaining` en cada test del archivo sin resets intermedios, aprovechando que ningún dispatch (dry-run ni real) escribe `callLog`.
- **Fetch inyectable vía objeto de módulo (`_voiceDispatchFetch`) en vez de parámetro `fetchImpl`**: ver key-decisions del frontmatter — necesario porque el handler es un route Express invocado vía HTTP real en los tests (supertest), no una función standalone que un test pueda llamar con un parámetro extra.

## Deviations from Plan

None relevantes al comportamiento funcional. La única desviación de forma es la ubicación exacta de las líneas de inserción en `index.js` (el plan citaba números de línea de una foto anterior del archivo — `index.js:9175` para `_leadIsCallableNow`, `14740-14815` para el patrón de `PUT /api/telnyx/config` — que ya habían corrido unas líneas tras los cambios de 24-01/24-02; se ubicaron por grep/lectura del código real antes de insertar, sin que esto afecte el contrato del plan).

## Issues Encountered

None. Las 3 tasks se ejecutaron en el orden del plan, cada `<verify>` pasó en el primer intento (`node --check index.js` limpio, subconjuntos de tests dirigidos verdes, suite completa 1076/1076 sin retrabajo).

## User Setup Required

None - ninguna configuración externa nueva. `RETELL_API_KEY`/`RETELL_TOOL_SECRET`/dashboard de Retell siguen pendientes de 24-02 (documentado ahí), y siguen sin ser necesarios para que este plan funcione en test — el fixture carga sus propios valores de `retell_config.json`/`telnyx_config.json` directamente.

## Next Phase Readiness

- El shape exacto de la respuesta del dispatch (lo consume el panel de VOICE-07, plan futuro fuera de esta fase): `{ requested, capRemaining, dispatched: [{leadId, callId, fromNumber}] | [{leadId, name, phone, fromNumber}] en dryRun, failed: [{leadId, error}], selected, rotationIdx, reason? }`. En `dryRun:true` además trae `estimatedTelnyxCostUsd` (suma de `_estimateTelnyxCost(phone, RETELL_ASSUMED_CALL_SECS).cost` — rotulado explícitamente como costo de TELEFONÍA, no incluye el costo por minuto del agente de Retell).
- El mensaje de error real que devuelve Retell cuando el `from_number` no está importado **no se llegó a observar en producción** (research §2.6 lo anticipa pero Phase 26 — importar los números a la cuenta de Retell — todavía no corrió). El código está preparado: cualquier respuesta no-2xx de `https://api.retellai.com/v2/create-phone-call` cae en `failed[]` con `{leadId, error}` donde `error` es `HTTP <status>: <primeros 300 chars del body>`, sin romper el resto del lote. Cuando el user configure el agente real en Retell (Phase 26) y corra el primer dispatch real, ese mensaje va a aparecer ahí — vale la pena revisarlo por si el shape del error de Retell difiere de lo asumido.
- **Contrato de `_pendingRetellCalls` para el plan 24-05** (webhook): `Map<callId, { leadId, at }>` expuesto en `globalThis.__voiceAgent._pendingRetellCalls`. Se puebla SOLO con dispatches reales exitosos (nunca en `dryRun`), inmediatamente después de que Retell confirma el `call_id` (201). Es **redundancia sobre `metadata.leadId`** que Retell ecoa en los webhooks (research §2.5) — el webhook de 24-05 debería preferir `metadata.leadId` como fuente primaria y usar este Map solo como fallback si algún día `metadata` no viajara intacta. Limpieza automática de entradas de más de 6h en cada dispatch (`_voiceCleanPendingRetellCalls`, invocada al final de cada dispatch real, antes de agregar las nuevas entradas) — el Map nunca crece sin límite aunque el webhook nunca llegue para algún `callId`.
- `_voiceDispatchedToday`/`_voiceDispatchRollover`/`_voiceDispatchFetch`/`_pendingRetellCalls`/`_retellCreatePhoneCall`/`RETELL_ASSUMED_CALL_SECS` quedan expuestos en `globalThis.__voiceAgent` para que 24-04 (webhook) y 24-05 (tool `/book`) los reusen sin redeclarar nada — en particular, el webhook de 24-04/24-05 puede reusar `_retellCreatePhoneCall` si en algún punto necesita hacer otro POST a la API de Retell, y `_voiceDispatchFetch.impl` sigue siendo el único punto de inyección de fetch para tests de esa superficie también, si se decide reusar el mismo patrón.
- Sin bloqueantes conocidos para 24-04 (wave 3, siguiente en `depends_on`, sigue serializado por tocar `index.js`).

---
*Phase: 24-integracion-backend-retell*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: `index.js`
- FOUND: `tests/retell-dispatch.test.js`
- FOUND: `.planning/phases/24-integracion-backend-retell/24-03-SUMMARY.md`
- FOUND commit: `dad0be7` (Task 1)
- FOUND commit: `fa1fb1d` (Task 2)
- FOUND commit: `0b3a914` (Task 3)
