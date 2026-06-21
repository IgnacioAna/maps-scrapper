# Auditoría TESTS + OPS/DEPLOY — SCM Dental

> Fecha: 2026-06-20 · Auditor: foco exclusivo en **testing** y **deploy/operaciones** (NO seguridad de código, NO arquitectura).
> Todos los hallazgos verificados leyendo archivos reales. Se cita `archivo:línea`.

## Resumen ejecutivo

El proyecto tiene una base de testing y ops **sorprendentemente sólida para un repo sin DB**: 586 tests en 40 archivos, health checks (`/health`, `/api/health`), graceful shutdown (SIGTERM/SIGINT), captura de `uncaughtException`/`unhandledRejection` con log persistente y rotación, backups automáticos cada 6h al volumen Railway, `pre-deploy.js` que stripea correctamente los secrets de Telnyx Y `proxy.pass` antes de commitear, y scripts de validación/backup/cleanup. El gap real **no es la calidad de los tests sino que NADA los corre automáticamente**: no hay CI (`.github/workflows` no existe), no hay git hooks (solo `.sample`), así que el `npm test` y el `pre-deploy` dependen 100% de que el dev se acuerde. Hoy mismo la suite tiene **1 test rojo determinístico** (`pool-distribute-tiers`) que es un test viejo desincronizado del código — el tipo de rojo que, sin CI, entrena al equipo a ignorar la suite. La cobertura de endpoints nuevos (los `POST /api/admin/enrich-*`, `validate-numbers`, y casi toda la superficie `/api/telnyx/*`) está testeada solo a nivel de helpers puros, no de endpoint (RBAC, mutex, caps, persistencia).

**Conteo por severidad:** ALTO: 4 · MEDIO: 6 · BAJO: 4

**Top 3:**
1. **[ALTO]** No hay CI ni git hooks — los tests y el pre-deploy nunca corren solos; todo es manual y olvidable.
2. **[ALTO]** Test rojo determinístico hoy en `main`: `pool-distribute-tiers.test.js:81` espera `conexion===''` pero el código ya setea `'sin_wsp'` a propósito (test stale, no bug de código).
3. **[ALTO]** Endpoints admin que GASTAN PLATA y mutan `setters.json` (`enrich-brief`, `enrich-leads`, `validate-numbers`) sin tests de endpoint — solo se testean sus helpers puros.

---

## ALTO

### A1. No existe pipeline CI/CD ni git hooks — los tests no corren automáticamente
**Archivos:** `.github/` (no existe — `Glob .github/**/*` → 0 resultados), `.git/hooks/` (solo archivos `.sample`, ninguno activo), no hay `.husky/`.
**Descripción:** El único gate de calidad es que el dev recuerde correr `npm test` y `npm run pre-deploy` a mano antes de `git push origin main`. Railway redeploya en cuanto detecta el push, **sin correr tests**. Cualquier commit con un test roto o sin haber bajado la data viva se deploya igual. Verificado: `package.json:9` define `"test": "vitest run"` pero nada lo invoca en push. CLAUDE.md documenta el flujo manual exhaustivamente (regla crítica de deploy), lo cual es una señal de que el equipo ya sabe que es frágil y compensa con disciplina humana.
**Fix concreto:** Agregar `.github/workflows/ci.yml` que en cada push/PR corra `npm ci && npm test` con `NODE_ENV=test`. No bloquea el deploy de Railway (eso es push-based), pero da señal roja visible. Como mínimo barato: un git hook `pre-push` (vía un `prepare` script o husky) que corra `npm test` y `node scripts/validate-data-integrity.mjs --warn`. Railway no corre tests por sí solo; el gate tiene que vivir antes del push.

### A2. Test rojo determinístico en `main` (suite NO está 100% verde)
**Archivo:** `tests/pool-distribute-tiers.test.js:81` vs `index.js:5911`.
**Descripción:** `npm test` corrido en esta auditoría: **1 failed | 585 passed (586)**. El que falla NO es el flaky documentado (`wa-campaign-engine`, que pasó). Es:
```
AssertionError: expected 'sin_wsp' to be ''  // pool-distribute-tiers.test.js:81
expect(inter.conexion).toBe("");
```
Falla las 3 veces (retry x2) → es determinístico, no flaky. El código `_resetLeadForRedistribution()` (`index.js:5907-5923`) setea **a propósito** `lead.conexion = 'sin_wsp'` (línea 5911, con comentario que explica el cambio "call-only carril" de CLAUDE.md #85/#86). El test quedó escrito contra la semántica vieja (`conexion=''`) y nunca se actualizó. **Es un test stale, no un bug de producción.** Pero un rojo permanente en la suite es tóxico: entrena al equipo a ignorar `npm test`, y sin CI nadie lo nota.
**Fix concreto:** Actualizar la aserción a `expect(inter.conexion).toBe("sin_wsp");` en `pool-distribute-tiers.test.js:81`. Verificar de paso que `recycle-pool.test.js` y `pool-distribution.test.js` no tengan la misma aserción stale.

### A3. Endpoints admin de enrichment (gastan $ + mutan setters.json) sin tests de endpoint
**Archivos:** `index.js:2031` (`POST /api/admin/enrich-leads`), `index.js:2184` (`POST /api/admin/validate-numbers`), `index.js:2242` (`POST /api/admin/enrich-brief`). Tests existentes: `tests/enrichment.test.js`, `tests/number-lookup.test.js`, `tests/lead-brief.test.js` cubren **solo helpers puros** (`enrichFromWebsite`, `_parseTelnyxLookup`, `_buildBriefMessages`/`_parseBriefOutput`) — verificado: ninguno hace `request(app).post('/api/admin/enrich-...')`.
**Descripción:** Estos endpoints (a) son admin-only, (b) tienen caps de batch (25/100/8 por CLAUDE.md #92/#105), (c) escriben fuera del mutex y aplican adentro vía `mutateSettersData`, (d) hacen backup antes de persistir. Nada de eso está testeado: ni el RBAC (¿un setter recibe 403?), ni que respeten el cap, ni que NO pisen campos ya poblados (CLAUDE.md dice "solo si el campo estaba vacío"), ni el shape de la respuesta. Son justo los endpoints donde un bug cuesta plata real (SerpAPI/LLM/Telnyx lookup) o corrompe data.
**Fix concreto:** Sumar tests de endpoint con `fetchImpl`/IA mockeada (el patrón ya existe en `number-lookup.test.js` que inyecta `fetchImpl`): 403 para setter, cap respetado, no-sobrescritura de campos poblados, persistencia vía mutex. Patrón de setup: `process.env.DATA_DIR=tmp` + pre-poblar `auth.json` antes de `import("../index.js")` (igual que `wa.test.js`).

### A4. Casi toda la superficie `/api/telnyx/*` sin cobertura de tests
**Archivos:** `index.js:10528-12233` define ~30 endpoints Telnyx (config, numbers CRUD, webrtc-credentials, balance, real-costs, reconcile-costs, **webhook**, scripts CRUD, metrics, cold-call-effectiveness, etc.). Tests que tocan Telnyx: solo `tests/transcribe-rbac.test.js` (1 endpoint), `tests/number-lookup.test.js` (helper), `tests/export-data-full.test.js` (export). Verificado: `Grep "/api/telnyx" tests/` → 3 archivos, ninguno cubre webhook/config/numbers/metrics/costs.
**Descripción:** El **webhook** (`index.js:11214`) es público y valida firma ed25519 con anti-replay + fail-closed en prod (CLAUDE.md #109 #4) — lógica crítica de seguridad/billing totalmente sin test. `PUT /api/telnyx/config` (`index.js:10546`) tiene la lógica de env-var-vs-JSON (bloquea edición de campos env-sourced, self-healing, 409) que es justo donde un cambio futuro puede romper silenciosamente la protección de secrets. Las métricas de costo (`real-costs`, `reconcile-costs`, `metrics`) que alimentan decisiones de plata tampoco.
**Fix concreto:** Priorizar tests del **webhook** (firma válida/inválida, replay, fail-closed en `NODE_ENV=production` sin `signaturePublicKey` → 503) y de `PUT /config` (409 al editar campo env-sourced, self-healing limpia el JSON). El helper `_verifyTelnyxSignature` y `_estimateTelnyxCost` se pueden testear puros si se exponen en `globalThis`.

---

## MEDIO

### M1. `npm test` con `| tail` enmascara el exit code → falso "verde"
**Evidencia:** En esta auditoría, `npm test 2>&1 | tail -60` reportó el run pero el exit code del pipe fue 0 pese a 1 test rojo. Verificado aparte: `npx vitest run <archivo-roto>` → **exit 1** (vitest sí falla bien). El riesgo es operativo: cualquier script/alias que corra tests con un pipe (`| tee`, `| tail`, `| grep`) hereda el exit del último comando del pipe, no de vitest, y puede "pasar" un push roto.
**Fix concreto:** En CI y en cualquier hook, correr `npm test` directo (sin pipe) o usar `set -o pipefail`. Documentarlo en la sección de deploy de CLAUDE.md.

### M2. `wa_campaigns.json` no está en `/api/admin/export-data` — depende de un segundo endpoint
**Archivos:** `index.js:1749-1763` (`export-data` devuelve 12 bloques, **sin** campaigns), `src/wa/routes.js:840-852` (`/api/wa/admin/export` sí incluye `campaigns`), `scripts/pre-deploy.js:185` (baja campaigns del endpoint WA).
**Descripción:** No es un bug hoy (el pre-deploy baja campaigns del endpoint WA y el server lo backupea en `BACKUP_FILES` `index.js:3372`), PERO crea un punto de falla silencioso: si el módulo WA responde 404/error, `pre-deploy.js:186-192` solo loguea WARN y **continúa** (no falla el pre-deploy). Las campañas se perderían en el redeploy sin que el dev lo note como error fatal. Además el test `export-data-full.test.js:70` afirma "12 bloques" y NO valida campaigns, reforzando la idea de que campaigns "está cubierto" cuando viaja por otro canal.
**Fix concreto:** O bien sumar `wa_campaigns` al `export-data` principal (consistencia), o hacer que `pre-deploy.js` trate el fallo del export WA como error fatal (exit 1) cuando se esperaban campañas. Como mínimo, documentar el doble canal.

### M3. Tests time-dependent confirmados (flaky en bordes de día)
**Archivos:**
- `tests/followups.test.js:149-154` — "lead 24h tildado hace 49h → vencido ayer" solo busca en `dueToday`+`dueYesterday`; cerca de medianoche un follow-up de hace 49h puede caer en `overdue` y fallar. Coincide con CLAUDE.md #93.
- `tests/wa-campaign-engine.test.js` — el flaky documentado. Los helpers (`isWithinWindow` línea 22 usa fecha fija `2026-06-10T18:00Z`; `warmingCapByDay`/`sendGapMs` usan `Date.now()` con offsets de días, robusto). La fragilidad real está en los tests de tick que dependen de la hora actual del runner si alguno no inyecta `now`/`window` completo.
**Descripción:** Pasaron en este run pero son frágiles por diseño (dependen de la hora del runner). El `retry: 2` de `vitest.config.js:22` los enmascara la mayoría de las veces.
**Fix concreto:** Inyectar reloj fijo. `followups.test.js` debería incluir `overdue` en el `all` de la línea 151 (igual que los otros it del bloque) o congelar la fecha. Para el engine, asegurar que TODO test de tick pase `now` explícito y `window` con días 0-6.

### M4. `retry: 2` global oculta flakiness real
**Archivo:** `vitest.config.js:22`.
**Descripción:** `retry: 2` aplica a TODOS los tests. Está justificado para Mercury/Windows timing (comentario línea 20-21), pero el costo es que un test genuinamente flaky (como M3) pasa "verde" 2 de 3 veces y nunca se arregla. Enmascara deuda. El propio CLAUDE.md asume "real bugs requieren 3 fails consecutivos".
**Fix concreto:** Acotar el retry a los tests que de verdad lo necesitan (Mercury) con `{ retry: 2 }` por-test/por-suite, y poner `retry: 0` global. Así los flaky de tiempo salen a la luz y se arreglan en vez de esconderse.

### M5. No hay `.env.example` — las env vars requeridas no son verificables por máquina
**Archivos:** existen `.env` y `.env.local` (gitignored vía `.gitignore:2,20`), pero no hay `.env.example`. La doc de env vars vive solo en CLAUDE.md (prosa).
**Descripción:** Un dev nuevo (o una IA) no tiene un template para saber qué setear. Peor: el boot solo valida `JWT_SECRET` (`index.js:12789`, fail-fast en prod) y `ADMIN_PASSWORD` (`index.js:289`, solo warning si falta). `API_KEY` (SerpAPI), `MERCURY_API_KEY`, etc. fallan recién en runtime cuando se usa el endpoint. No hay un chequeo "al boot, ¿están las vars críticas?".
**Fix concreto:** Crear `.env.example` con todas las claves de CLAUDE.md (sin valores). Opcional fuerte: una función `assertRequiredEnv()` al boot que loguee WARN por cada var crítica ausente (no fatal salvo JWT_SECRET), para detectar un Railway mal configurado en el primer log en vez de en el primer scrape fallido.

### M6. `validate-data-integrity.mjs` y `backup-data.mjs` existen pero no están en el flujo de deploy
**Archivos:** `scripts/validate-data-integrity.mjs`, `scripts/backup-data.mjs`, `package.json:13-14` (`validate:data`, `backup:data`).
**Descripción:** Son buenos scripts (validate detecta orphans referenciales y exit 1; backup snapshotea con rotación). Pero NO se invocan en ningún hook ni en `pre-deploy.js`. El flujo de deploy documentado en CLAUDE.md no los menciona. Riesgo: se commitea un `setters.json` con orphans (assignedTo a setter borrado, calendar→lead inexistente) y nadie lo valida antes del push.
**Fix concreto:** Encadenar `node scripts/validate-data-integrity.mjs --warn` al final de `pre-deploy.js` (warn-only para no bloquear, pero deja el log visible), o sumarlo al hook pre-push de A1. Documentar `npm run backup:data` como paso recomendado antes de correr cualquier one-shot.

---

## BAJO

### B1. `uncaughtException` solo loguea, no reinicia — el server puede quedar en estado corrupto
**Archivo:** `index.js:3360`.
**Descripción:** `process.on('uncaughtException', (err) => logError(...))` NO hace `process.exit()`. Es el anti-pattern conocido de Node: tras una excepción no atrapada el proceso puede quedar en estado indefinido. Para este caso (server JSON file-based, Railway reinicia el container si muere) podría ser preferible loguear + `process.exit(1)` y dejar que Railway lo levante limpio. Es un trade-off consciente (no tirar el server por un error transitorio), por eso BAJO, pero vale revisarlo.
**Fix concreto:** Evaluar `process.exit(1)` tras loguear en `uncaughtException` (no en `unhandledRejection`), confiando en el restart de Railway. Si se mantiene como está, documentar el porqué.

### B2. `pre-deploy.js` no falla si el export viene con bloques en `null`
**Archivo:** `scripts/pre-deploy.js:89-100,158-160`.
**Descripción:** Si un loader del server tira (archivo corrupto), el endpoint devuelve `null` para ese bloque y `saveFile()` lo skippea con un mensaje informativo (`results.skipped`). El pre-deploy termina OK aunque, por ejemplo, `setters.json` haya venido null. Solo falla (`exit 1`) si `saveFile` no pudo **escribir** (línea 199-204), no si el server devolvió null en un bloque crítico.
**Fix concreto:** Tratar `setters`/`auth`/`history` null como error fatal en pre-deploy (son los irreemplazables). Los demás bloques pueden seguir siendo skip-tolerant.

### B3. Scripts one-shot acumulados sin archivar
**Archivos:** `scripts/one-shot-*.mjs` (9 archivos: redistribute-2026-05-24, reset-beti, reset-max-agus, restore-max, restore-from-backup, create-admin-setter, assign-mex-quito, redo-mex-clean, etc.).
**Descripción:** Son scripts de un solo uso ya ejecutados (CLAUDE.md los marca como "one-shot ya ejecutado"). Mezclados con los scripts vivos (`pre-deploy`, `backup-data`, etc.) generan ruido y riesgo de re-ejecutar uno destructivo por error. Algunos escriben directo a `data/setters.json`.
**Fix concreto:** Mover los `one-shot-*` ejecutados a `scripts/archive/` (o `scripts/one-shot/done/`). Riesgo bajo, higiene operativa.

### B4. Flaky de Mercury depende de red/timing aunque "borra" las API keys
**Archivos:** `tests/mercury-generate.test.js:23-24` (borra `MERCURY_API_KEY`/`QWEN_API_KEY` para forzar fallback), CLAUDE.md #93 lo lista como flaky por "red/timing".
**Descripción:** El test borra las keys para no pegar a la IA real, lo cual es correcto. Pero CLAUDE.md reporta que igual flakea ("pasa en retry/exit 0"). La causa probable es el timing del fallback (timeout/AbortController) en Windows, no la red. Documentado, bajo impacto gracias a `retry: 2`.
**Fix concreto:** Verificar que el test no dependa de un timeout real; si el fallback usa un `setTimeout`/`AbortController`, mockearlo. Si se aplica M4 (retry acotado), este test seguiría con su retry propio.

---

## Lo que YA está bien (reconocimiento)

- **Health checks + observabilidad:** `/health` y `/api/health` (`index.js:98-99`), `/api/admin/health` con uptime (`index.js:12646`), `/api/admin/errors/recent` (`index.js:12742`), log persistente con rotación a 5MB (`index.js:3336-3357`).
- **Graceful shutdown:** SIGTERM/SIGINT con `_gracefulExit` (`index.js:435-436`).
- **Captura de errores globales:** `uncaughtException` + `unhandledRejection` no tiran el server (`index.js:3360-3361`).
- **Backups automáticos:** boot + cron 6h, retención 8, 12 archivos incluyendo `wa_campaigns.json` (`index.js:3363-3411`).
- **pre-deploy.js stripea secrets correctamente:** Telnyx (5 campos, `pre-deploy.js:140-147`) Y `proxy.pass` de wa_accounts (`pre-deploy.js:176-181`) — coincide con ambas memorias de leaks resueltos. Escritura por-archivo aislada con resumen y exit 1 en fallo de escritura.
- **JWT_SECRET fail-fast en prod** (`index.js:12789`), cookie `Secure` solo en prod (`index.js:1290`), webhook Telnyx fail-closed en prod (`index.js:11226`).
- **`vitest.config.js` bien pensado:** excluye worktrees paralelos para no doble-correr, timeouts subidos para Windows+supertest.
- **export-data + import-data con validación de shape** antes de escribir (`index.js:1783-1818`), test dedicado `export-data-full.test.js`.
- **585/586 tests verdes**, suite amplia y bien organizada (RBAC, mutex-concurrency, cascade, pool, enrichment, signals, dnc, cadence).
- **Scripts de mantenimiento existen y son read-only/con-backup:** `validate-data-integrity`, `backup-data` (rotación), `cleanup-stale-sessions` (dry-run por default + backup), `dedupe-leads`.
