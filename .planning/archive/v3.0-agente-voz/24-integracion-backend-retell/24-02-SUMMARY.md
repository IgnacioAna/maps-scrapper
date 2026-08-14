---
phase: 24-integracion-backend-retell
plan: 02
subsystem: api
tags: [retell, voice-agent, config, env-vars, security, persistence, rbac]

# Dependency graph
requires:
  - phase: 24-01
    provides: "globalThis.__voiceAgent (_applyCallOutcome, _estimateTelnyxCost, _detectCountryAndType) para que los planes siguientes lo consuman"
provides:
  - "`RETELL_CONFIG_FILE`/`RETELL_EVENTS_FILE`, `RETELL_ENV_FIELDS`, `_defaultRetellConfig`, `_retellEnvSourced`, `loadRetellConfig`, `saveRetellConfig`, `_retellWebhookSecret` (fallback a apiKey), `_retellToolSecret` (sin fallback), `_publicRetellConfig` (con salud del webhook), `loadRetellEvents`/`saveRetellEvents`, `_retellWebhookRejects` — todo en scope de módulo de index.js, clonado del patrón Telnyx"
  - "`GET`/`PUT /api/retell/config` admin-only (sin vista reducida para supervisor), con 409 en campos env-sourced + self-healing del JSON"
  - "`retell_config.json` y `retell_events.json` en las 5 superficies de la regla #21: BACKUP_FILES, seedVolumeFromRepo, export-data (lectura CRUDA sin overlay de env), import-data, pre-deploy.js"
  - "`setter_agente_ia` sembrado en boot vía `ensureSetterProfile('Agente IA')`, guardado por NODE_ENV !== 'test'"
  - "`globalThis.__voiceAgent` extendido con `loadRetellConfig`, `_publicRetellConfig`, `_retellWebhookSecret`, `_retellToolSecret`, `VOICE_AGENT_SETTER_ID`"
  - "`tests/retell-config.test.js` (26 tests): RBAC, no-leak, env-sourced, self-healing, fallback de webhookSecret, validaciones del PUT, round-trip export/import, pseudo-SDR visible + fila en team-performance"
affects: [24-03, 24-04, 24-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config env>JSON clonado 1:1 del patrón Telnyx (loadX/saveX/_publicX con overlay de env vars que gana siempre, self-healing en el PUT, 409 cuando el panel intenta pisar un campo env-sourced)"
    - "Export-data lee la config sensible CRUDA de disco (sin el overlay de env vars) en vez de reusar el loader con overlay — desviación deliberada del precedente Telnyx (que sí exporta el valor overlayeado) para que el snapshot de backup nunca contenga el secret efectivo cuando viene de Railway"
    - "Pseudo-SDR: `ensureSetterProfile(name)` reusado tal cual para darle un `assignedTo` a un actor no-humano; la atribución de sus llamadas cae sola por `_callSetterId` (fallback a `lead.assignedTo` cuando `callLog.by` es falsy) sin tocar código de métricas"

key-files:
  created:
    - tests/retell-config.test.js
  modified:
    - index.js
    - scripts/pre-deploy.js
    - tests/export-data-full.test.js

key-decisions:
  - "Las constantes VOICE_AGENT_SETTER_NAME/VOICE_AGENT_SETTER_ID se declararon junto al seed de boot (index.js ~6716, inmediatamente después de mutateSettersData), NO dentro del bloque de config de Retell (mucho más abajo, ~14190) donde las agrupaba conceptualmente el plan. `const` no hace hoisting (a diferencia de las `function` declarations que sí se usan en el resto del archivo) — declararlas solo en el bloque de Retell habría hecho que el seed de boot, que corre antes en el orden de ejecución del módulo, lanzara 'Cannot access before initialization'. El bloque de Retell las referencia sin redeclararlas."
  - "export-data para retellConfig lee el archivo CRUDO de disco (fs.readFileSync directo, llamando antes a loadRetellConfig() solo por su side-effect de lazy-init) en vez de reusar loadRetellConfig() como hace Telnyx con telnyxConfig. Necesario porque loadRetellConfig() aplica el overlay de env vars: si se hubiera reusado tal cual, el GET /api/admin/export-data habría devuelto el valor EFECTIVO del secret (el de Railway) en el JSON de respuesta cuando la env var está seteada, violando el requisito explícito del plan ('el export NO incluye el valor del apiKey cuando viene de env'). Es una desviación deliberada del precedente Telnyx, no un fix retroactivo de Telnyx (fuera de alcance de este plan)."
  - "El hueco de seedVolumeFromRepo para los archivos de Telnyx (telnyx_config.json/telnyx_events.json, documentado en research §5.2) se dejó intacto a propósito — solo se agregaron los 2 archivos nuevos de Retell al array. Arreglarlo habría sido un cambio de comportamiento fuera del scope de este plan y hubiera contaminado el gate de paridad de la fase."

requirements-completed: [VOICE-01, VOICE-06]

# Metrics
duration: ~12min
completed: 2026-07-31
---

# Phase 24 Plan 02: Config Retell env>JSON + pseudo-SDR Summary

**`retell_config.json`/`retell_events.json` con overlay env>JSON (patrón Telnyx clonado), endpoints admin-only `GET`/`PUT /api/retell/config` con 409 en campos env-sourced y self-healing, los 2 archivos nuevos en las 5 superficies de persistencia de la regla #21, y el pseudo-SDR `setter_agente_ia` sembrado en boot con métricas comparables lado a lado en Equipo — 26 tests nuevos, suite completa 1046/1046.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-31T12:58:00-03:00 (aprox, primer read)
- **Completed:** 2026-07-31T13:07:20-03:00 (última corrida de suite completa: 1046/1046)
- **Tasks:** 3/3 completadas
- **Files modified:** 3 (`index.js`, `scripts/pre-deploy.js`, `tests/export-data-full.test.js`) + 1 nuevo (`tests/retell-config.test.js`)

## Accomplishments

- Módulo de config Retell clonado del bloque Telnyx (Task 1): `RETELL_CONFIG_FILE`/`RETELL_EVENTS_FILE`, `RETELL_ENV_FIELDS` con 3 campos (`apiKey`, `webhookSecret`, `toolSecret`), `_defaultRetellConfig()`, `_retellEnvSourced()`, `loadRetellConfig()`/`saveRetellConfig()` con overlay env>JSON, `_publicRetellConfig(cfg)` que nunca expone secrets (solo `hasX`+`envSourced`+la salud del webhook), `loadRetellEvents()`/`saveRetellEvents()`, y el contador en memoria `_retellWebhookRejects` (espejo de `_telnyxWebhookRejects`, listo para que el plan 24-04 lo incremente).
- `_retellWebhookSecret(cfg)` implementa la corrección de research §2.1: Retell firma sus webhooks con el MISMO API key (verificado contra `retell-sdk@5.53.0`), así que cae a `apiKey` cuando `webhookSecret` está vacío — nunca exige el campo. `_retellToolSecret(cfg)` es lo opuesto a propósito: SIN fallback, porque un tool secret ausente para `/book` (VOICE-04) debe ser detectable, no confundirse silenciosamente con el API key.
- `setter_agente_ia` se siembra en el boot vía `ensureSetterProfile('Agente IA')`, guardado por `NODE_ENV !== 'test'` para que los fixtures de test no ganen un setter extra (verificado: `team-performance`/`pool-distribution`/`command-metrics` — 32 tests — sin cambios de conteo).
- `GET`/`PUT /api/retell/config` (Task 2), ambos `requireRole('admin')` — a diferencia de Telnyx, NINGÚN rol recibe una vista reducida (el panel de VOICE-07 es admin-only). El PUT clona el flujo completo de Telnyx: detección de campos env-sourced → 409 con el detalle, lectura del JSON crudo (sin overlay) antes de guardar, validación de `dailyCap` (entero 0..500), `enabled` (boolean), strings recortadas a 200 chars, `rotationIdx` explícitamente NO editable (lo administra el dispatch de 24-03), self-healing de los 3 campos sensibles cuando la env var manda.
- Regla #21 completa para los 2 archivos nuevos: `BACKUP_FILES`, `seedVolumeFromRepo` (a diferencia del precedente Telnyx, que el research §5.2 documenta como INCOMPLETO ahí — deliberadamente NO clonado), `/api/admin/export-data`, `/api/admin/import-data` (validación de shape + restore), y `scripts/pre-deploy.js` (stripper de los 3 secrets + 2 tuplas en `extras`).
- `tests/retell-config.test.js` (26 tests, Task 3): RBAC de los 4 roles (401/403×2/200) + no-leak literal del secret en el GET; ciclo completo env-sourced (409, campo no bloqueado en paralelo, `envSourced.apiKey`, self-healing verificado leyendo el archivo de disco, overlay efectivo); fallback de `webhookSecret`→`apiKey` en ambos sentidos; 6 validaciones del PUT; 3 tests de persistencia (export incluye los 2 bloques, export NO filtra el secret env-sourced, round-trip de import-data); 4 tests del pseudo-SDR (constante expuesta, visible para admin, visible para supervisor sin restricción, fila en `team-performance.callsByDay.perSetter` con `setterId === 'setter_agente_ia'` y su llamada contada tanto en la serie diaria como en `perSetter[].current.dials`).
- Suite completa: **1046/1046 tests verdes** (70 archivos) — 1020 previos + 26 nuevos, sin editar ningún assert existente (solo se sumaron 2 claves al `EXPECTED_KEYS` de `tests/export-data-full.test.js`, cambio pactado explícitamente por el plan).

## Task Commits

Cada tarea se commiteó atómicamente:

1. **Task 1: Módulo de config Retell + log de eventos + pseudo-SDR** - `72f175f` (feat)
2. **Task 2: Endpoints GET/PUT config + regla #21 en los 5 lugares** - `b280d18` (feat)
3. **Task 3: tests/retell-config.test.js** - `649e76e` (test)

## Files Created/Modified

- `index.js` - Bloque de config Retell (adyacente a `_setterTelnyxConfig`): `RETELL_CONFIG_FILE`/`RETELL_EVENTS_FILE`, `RETELL_ENV_FIELDS`, `_defaultRetellConfig`, `_retellEnvSourced`, `loadRetellConfig`, `saveRetellConfig`, `_retellWebhookSecret`, `_retellToolSecret`, `loadRetellEvents`/`saveRetellEvents`, `_retellWebhookRejects`, `_publicRetellConfig`; extensión de `globalThis.__voiceAgent`. Constantes `VOICE_AGENT_SETTER_NAME`/`VOICE_AGENT_SETTER_ID` + seed de boot inmediatamente después de `mutateSettersData`. Endpoints `GET`/`PUT /api/retell/config` junto al bloque de rutas Telnyx. Regla #21: `BACKUP_FILES`, `seedVolumeFromRepo`, `/api/admin/export-data` (lectura cruda de disco para `retellConfig`), `/api/admin/import-data` (validación + restore).
- `scripts/pre-deploy.js` - Stripper de `apiKey`/`webhookSecret`/`toolSecret` de `data.retellConfig` + 2 tuplas nuevas en `extras` (`retellConfig`→`retell_config.json`, `retellEvents`→`retell_events.json`).
- `tests/export-data-full.test.js` (modificado, pactado por el plan) - título y `EXPECTED_KEYS` actualizados de 12 a 14 bloques (suma `retellConfig`/`retellEvents`).
- `tests/retell-config.test.js` (nuevo) - 26 tests de RBAC, no-leak, env-sourced, self-healing, fallback de webhookSecret, validaciones del PUT, persistencia y pseudo-SDR.

## Decisions Made

- **Ubicación física de `VOICE_AGENT_SETTER_NAME`/`VOICE_AGENT_SETTER_ID`**: ver key-decisions del frontmatter. Declaradas junto al seed de boot (index.js ~6716) en vez de dentro del bloque de config de Retell (~14190) por una restricción técnica real (`const` no hace hoisting) que el plan no había resuelto explícitamente al agrupar ambos conceptos bajo el mismo párrafo de "Contenido". El bloque de Retell las referencia sin redeclararlas.
- **export-data lee `retellConfig` crudo del disco, no vía `loadRetellConfig()`**: ver key-decisions del frontmatter. Es la única desviación de "clonar 1:1 el patrón Telnyx" del plan, y es intencional — Telnyx SÍ exporta el valor overlayeado (potencial fuga del secret efectivo en el JSON de `/api/admin/export-data` cuando viene de env var), pero el plan exige explícitamente para Retell que "el export NO incluye el valor del apiKey cuando viene de env". Arreglar el comportamiento de Telnyx queda fuera de alcance (no se tocó `telnyxConfig` en el export).
- **Hueco de `seedVolumeFromRepo` para Telnyx dejado intacto**: confirmado por lectura directa del código (línea 5679 antes de este plan no incluía `telnyx_config.json`/`telnyx_events.json`) — documentado por el research §5.2. Solo se agregaron los 2 archivos nuevos de Retell al array; el hueco de Telnyx sigue abierto a propósito, como pide el plan.

## Deviations from Plan

None relevantes al comportamiento funcional — las 2 decisiones de arriba son ajustes de implementación dentro del contrato del plan (ubicación de constantes por restricción técnica de `const`/hoisting; lectura cruda para satisfacer el requisito explícito de no-leak en export-data), no cambios de alcance ni Rule 1-4 auto-fixes de bugs preexistentes.

## Issues Encountered

None. Las 3 tasks se ejecutaron en el orden del plan sin bloqueos ni checkpoints.

## User Setup Required

**Pendiente para cuando se ejecute el plan 24-05 (webhook) y se conecte el agente real en Retell (Phase 26):**

- `RETELL_API_KEY` — Dashboard de Retell → API Keys. La misma key firma los webhooks (research §2.1).
- `RETELL_TOOL_SECRET` — valor inventado por el user; se carga IGUAL en Railway y en el Custom Header `x-scm-tool-secret` del function node de Retell (Phase 26).
- `RETELL_WEBHOOK_SECRET` — **OPCIONAL**. Solo si el dashboard de Retell muestra un valor distinto del API key para el "webhook badge". Vacío = se usa `RETELL_API_KEY` (comportamiento por defecto, `_retellWebhookSecret`).
- Dashboard de Retell → Agent → Webhook settings: apuntar la Webhook URL a `https://<railway-domain>/api/retell/webhook` (ese endpoint lo construye el plan 24-04, todavía no existe).

Ninguna de estas env vars es necesaria para que este plan (24-02) funcione — sin ellas, `loadRetellConfig()` simplemente devuelve la config con los 3 campos secretos en `""` y `envSourced` en `false` para los tres, comportamiento verificado por los tests.

## Next Phase Readiness

- `globalThis.__voiceAgent.loadRetellConfig`, `_publicRetellConfig`, `_retellWebhookSecret`, `_retellToolSecret`, `VOICE_AGENT_SETTER_ID` listos para que 24-03 (dispatch por lote) lea `dailyCap`/`agentId`/`fromNumberId`/`rotationIdx`, y para que 24-04/24-05 (webhook + tool `/book`) usen `_retellWebhookSecret`/`_retellToolSecret` para verificar firmas y headers.
- `setter_agente_ia` existe como setter normal — cualquier plan que necesite asignarle leads (`assignedTo: 'setter_agente_ia'`) ya lo encuentra en `data.setters`, visible en Equipo/Comando/Distribución sin excepciones, y sus llamadas se atribuyen solas vía `_callSetterId` con `callLog[].by === ''` (fallback a `assignedTo`).
- `_retellWebhookRejects` (contador en memoria, `{total:0, last:null, since:<boot ISO>}`) y `loadRetellEvents()` están declarados y ya alimentan el objeto `webhook` de `_publicRetellConfig` — el plan 24-04 solo necesita poblarlos (incrementar el contador en rechazos de firma, escribir a `retell_events.json` en eventos válidos), sin redeclarar el shape.
- Sin bloqueantes conocidos para el siguiente plan del wave (24-03, wave 3, no serializado con este por ser el siguiente en `depends_on`).

---
*Phase: 24-integracion-backend-retell*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: `index.js`
- FOUND: `scripts/pre-deploy.js`
- FOUND: `tests/retell-config.test.js`
- FOUND: `tests/export-data-full.test.js`
- FOUND: `.planning/phases/24-integracion-backend-retell/24-02-SUMMARY.md`
- FOUND commit: `72f175f` (Task 1)
- FOUND commit: `b280d18` (Task 2)
- FOUND commit: `649e76e` (Task 3)
