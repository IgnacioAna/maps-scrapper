---
phase: 35-scr-atribucion-guion
plan: 04
subsystem: tooling
tags: [node, cli, scripts, script-attribution, coverage, vitest]

# Dependency graph
requires:
  - phase: 35-scr-atribucion-guion (plan 01)
    provides: "contrato de datos: callLog[].scriptIdsUsed/scriptIdsAuto, SCRIPT_RELEVANT_OUTCOMES"
  - phase: 35-scr-atribucion-guion (plan 02)
    provides: "el instante desde el que una llamada puede nacer con guion atribuido (siembra automática en _startTelnyxCall)"
  - phase: 35-scr-atribucion-guion (plan 03)
    provides: "segunda oportunidad en las 4 superficies — sin esto medir cobertura sería prematuro"
provides:
  - "scripts/coverage-script.mjs — CLI de cobertura de atribución de guion, molde de coverage-callstage.mjs"
  - "npm run coverage:script -- --days 7 — la forma exacta que pide SCR-04"
  - "tests/coverage-script.test.js — primer test del repo que spawnea un script real como subproceso"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI puro sin dependencias (node:fs/node:path), sin importar index.js — mismo tradeoff que coverage-callstage.mjs: sin servidor, sin env vars, corre en ~200ms"
    - "Test que spawnea el binario real vía execFileSync en vez de exportar la lógica interna — preserva la forma de CLI puro del molde; patrón nuevo, documentado en la cabecera del test"
    - "DEPLOY_ISO extraído de la fuente por regex en el test (no copiado a mano) — el test no puede desincronizarse silenciosamente si la fecha se mueve"

key-files:
  created:
    - scripts/coverage-script.mjs
    - tests/coverage-script.test.js
  modified:
    - package.json

key-decisions:
  - "DEPLOY_ISO = 2026-08-22T18:37:47-03:00 (commit 7f78cb8, 'docs(35-02): completar plan 02 de la fase 35') — el hash de CIERRE de 35-02, no el commit `feat` que agrega la siembra (93261fb, 13 minutos antes). Se siguió la instrucción EXPLÍCITA de 35-02-SUMMARY.md ('el hash a usar como DEPLOY_ISO para 35-04 es el de este plan metadata commit'), en vez de replicar el criterio literal de coverage-callstage.mjs (que usa el commit `feat`). La diferencia entre ambos hashes es de minutos y no tiene impacto práctico: no hubo llamadas reales en esa ventana."
  - "El bucket 'manual' del desglose por canal es TODO lo que no es channel==='telnyx_webrtc' (incluye channel:'manual' real, 'email' del hold de calendario placeholder_sent, y 'retell' del agente de voz parkeado) — no solo el string literal 'manual'. Verificado contra el código real de GET /api/telnyx/script-effectiveness: `if (c.channel !== 'telnyx_webrtc') continue;`. Nombrar el bucket 'manual' sigue la palabra que usa el propio plan ('dialer vs manual'), pero la semántica implementada es la que realmente explica por qué el panel puede divergir de este reporte."
  - "porGuion se computa dedupeando scriptIds DENTRO de cada llamada (Set), igual que /api/telnyx/script-effectiveness — un SDR que clickeó el mismo guion 2 veces no infla el reparto."

requirements-completed: [SCR-04]

# Metrics
duration: ~12min
completed: 2026-08-22
---

# Phase 35 Plan 4: Cobertura de atribución de guion Summary

**`npm run coverage:script -- --days 7` — CLI de solo-lectura que distingue cuántas llamadas nacen con guion "por default" de cuántas lo tiene elegido por una persona, con la ventana recortada al deploy de 35-02 para que el denominador nunca incluya llamadas que no pudieron tener guion.**

## Performance

- **Duration:** ~12 min (commits entre 18:58 y 19:03 -03:00, más verificación por mutación, suite completa x2 y actualización manual de STATE/ROADMAP/REQUIREMENTS)
- **Started:** 2026-08-22T18:56:00-03:00 (aprox)
- **Completed:** 2026-08-22T22:08:00Z
- **Tasks:** 3
- **Files modified:** 3 (`scripts/coverage-script.mjs` nuevo, `package.json`, `tests/coverage-script.test.js` nuevo)

## Accomplishments

- SCR-04 cerrado: existe `npm run coverage:script -- --days 7`, análogo exacto
  de `npm run coverage:callstage`, que responde las dos preguntas que importan:
  cuántas llamadas del período traen guion atribuido y cuántas de esas lo
  eligió una persona (`scriptIdsAuto !== true`) — el número que dice si se
  puede comparar un guion contra otro o si la tabla de efectividad está
  comparando el guion oficial contra sí mismo.
- La ventana por defecto es de **7 días** (D-01, no 30) y siempre se recorta
  al deploy de la siembra automática de 35-02: una llamada que no pudo nacer
  con guion nunca entra al denominador.
- El reporte separa `dialer` (channel === 'telnyx_webrtc') de todo lo demás,
  documentando por qué puede no coincidir con
  `GET /api/telnyx/script-effectiveness` (que solo mira el dialer) — así el
  desglose explica la divergencia en vez de dejarla como un misterio.
- **Con esto, Phase 35 (SCR — Atribución de guion) queda COMPLETA (4/4
  planes)**: SCR-01..SCR-04 cerrados.

## Task Commits

1. **Task 1: scripts/coverage-script.mjs** - `d9d2e30` (feat)
2. **Task 2: npm run coverage:script** - `ac8c79a` (feat)
3. **Task 3: suite del CLI contra un snapshot fixture** - `2da5fe8` (test)

**Plan metadata:** (este commit)

## Files Created/Modified

- `scripts/coverage-script.mjs` (nuevo) — CLI ESM sin dependencias, molde de
  `coverage-callstage.mjs`: flags `--days` (default **7**)/`--all`/`--file`/`--json`,
  `DEPLOY_ISO` con el criterio explicado abajo, `SCRIPT_RELEVANT_OUTCOMES`
  copiado (mismo Set que `index.js`, con la nota de sincronía), conteos
  `relevantes`/`conGuion`/`aMano`/`automaticas`, desglose por canal
  (`porCanal.dialer`/`porCanal.manual`), reparto por guion con label del
  banco (`data/call_scripts.json`, opcional), `porDia` de lo elegido a mano,
  `ultima` llamada del snapshot completo, `conEtapa` como referencia cruzada
  con `coverage:callstage`. Nunca lanza sobre `callLog` no-array, `ts`
  inválido o `scriptIdsUsed` no-array.
- `package.json` — `"coverage:script": "node scripts/coverage-script.mjs"`
  agregado junto a `coverage:callstage`. `package-lock.json` intacto.
- `tests/coverage-script.test.js` (nuevo) — 18 tests, primer test del repo
  que spawnea un script real vía `execFileSync` (patrón nuevo, documentado
  en la cabecera del archivo).

## Decisions Made

Ver `key-decisions` en el frontmatter. Las tres relevantes: qué hash exacto
se usó como `DEPLOY_ISO` y por qué (siguiendo la instrucción explícita de
`35-02-SUMMARY.md` en vez del criterio literal del molde); que el bucket
"manual" del desglose por canal es semánticamente "todo lo que no es
telnyx_webrtc" (verificado contra el código real de
`/api/telnyx/script-effectiveness`, no asumido); y que el reparto por guion
dedupea dentro de cada llamada con el mismo criterio que ese mismo endpoint.

## Deviations from Plan

None - plan ejecutado tal como estaba escrito.

## Issues Encountered

Ninguno bloqueante. Única fricción: diseñar los casos de test de "ventana"
y "recorte al deploy" sin asumir cuál de los dos pisos (ventana pedida vs.
deploy) domina — el propio plan advierte que eso depende de cuándo se corre
la suite. Se resolvió tal como indica el plan: usar timestamps relativos a
`Date.now()` (una llamada "recién" para lo que debe contar, una de 30 días
atrás para lo que no) y, en el caso específico del recorte, leer `desde` de
la propia salida JSON en vez de asumir un valor absoluto.

## Verificación realizada (detalle)

- `node --check scripts/coverage-script.mjs` — OK.
- `node scripts/coverage-script.mjs --all --file data/setters.json --json`
  (verify de Task 1) — JSON válido.
- `npm run coverage:script -- --all --json` (verify de Task 2) — passthrough
  de flags OK; `git diff --stat package-lock.json` vacío.
- `npm run coverage:script -- --days 7` — la forma EXACTA que pide SCR-04,
  corrida contra `data/setters.json` real del repo (resultado completo más
  abajo). `git status --short data/` y `git diff --stat data/` vacíos
  **después** de correrlo: el script no escribió nada (T-35-12/lectura-only
  confirmado empíricamente, no solo por inspección de código).
- `npx vitest run tests/coverage-script.test.js` — 18/18 verde.
- **Verificación por mutación** (criterio del `<done>` de Task 3): se cambió
  temporalmente `if (isAuto) automaticas++; else aMano++;` para que un
  `isAuto` también sumara a `aMano` (contando las automáticas como si
  fueran manuales). Se puso en rojo exactamente el test esperado
  (`aMano excluye scriptIdsAuto===true; automaticas + aMano === conGuion`,
  `expected 2 to be 1`). Restaurado con `Edit`, `git diff scripts/coverage-script.mjs`
  vacío confirmado antes de continuar.
- `npm test` completo — **117 archivos, 2054 tests, 2054 pasando**, corrido
  **dos veces** sin ningún flake (incluido `wa-campaign-engine`, que pasó en
  ambas corridas).
- `git diff --stat public/` — vacío (este plan no toca frontend, sin bump de
  cache-buster). `git diff --stat package-lock.json` — vacío (T-35-SC, nada
  instalado).

## La primera medición real

`DEPLOY_ISO` elegido: **`2026-08-22T18:37:47-03:00`**, commit `7f78cb8`
(`docs(35-02): completar plan 02 de la fase 35`) — el hash de cierre de
35-02, indicado explícitamente por `35-02-SUMMARY.md`: *"El hash a usar como
`DEPLOY_ISO` para 35-04 es el de este plan metadata commit... antes de ese
instante, ninguna llamada pudo nacer con guion atribuido"*.

Corrida real contra `data/setters.json` del repo, con la forma exacta que
pide SCR-04:

```
$ npm run coverage:script -- --days 7

Cobertura de atribución de guion · desde el deploy de la captura de guion · setters.json
Desde 2026-08-22 21:37 UTC
(--days 7 pedía más atrás; se recortó al deploy de la siembra — antes no había guion que registrar)
────────────────────────────────────────────────────────────────
Llamadas donde alguien atendió            0
  con guion atribuido                      0   —
    elegido por una persona                0   —  ← el número que importa
    default automático                     0   — de las que tienen
  del dialer (WebRTC)                      0   —   con guion: 0 (—)
  fuera del dialer (manual/email/otros)    0   —   con guion: 0 (—)
  con etapa cargada (referencia)           0   —   (mismo criterio que coverage:callstage)

Por qué puede no coincidir con "Guiones de llamada":
  /api/telnyx/script-effectiveness solo mira channel=telnyx_webrtc (el dialer).
  Este reporte suma TODOS los canales — la fila de arriba es la que se compara con el panel.

Ningún guion atribuido todavía en la ventana.

Ningún registro a mano todavía.

Última llamada en el snapshot: 2026-08-17T17:12:16.814Z
Sin llamadas en la ventana: no hay muestra para concluir nada.
```

**Interpretación — todavía no hay muestra, y eso es lo correcto, no un
hallazgo**: la última llamada del snapshot es del `2026-08-17T17:12:16`,
**anterior** al deploy de la siembra (`2026-08-22T18:37:47-03:00`). El
snapshot de `data/` que hay en el repo hoy es previo a que 35-02 empezara a
sembrar guion en cada llamada nueva, así que 0 relevantes/sin muestra es
exactamente lo que el diseño de D-01 promete: nunca reporta un 0% como si
fuera una medición real de algo que no pudo pasar.

Con `--all` (histórico completo, sin recorte, solo para contexto — nunca es
lo que hay que mirar para decidir algo):

```
$ node scripts/coverage-script.mjs --all --file data/setters.json --json
{"relevantes":323,"conGuion":0,"aMano":0,"automaticas":0,
 "porCanal":{"dialer":{"total":218,"conGuion":0},"manual":{"total":105,"conGuion":0}},
 "porGuion":[],"conEtapa":4, ...}
```

323 llamadas relevantes históricas, 0 con guion en cualquiera de los dos
canales — consistente con el diagnóstico original de `CONTEXT.md` ("0 de 199
llamadas completaron la cadena de captura"), medido esta vez con el
instrumento definitivo en vez de a mano.

**Recordatorio operativo para el dueño**: la medición que vale es después de
una tanda real de llamadas hechas **después** de este deploy, con
`npm run pre-deploy` corrido antes para bajar la data fresca de Railway —
sin eso se está midiendo lo que había en el repo, no lo que pasó en
producción.

## Contraste con el panel (item 6 de `<verification>`)

Hoy no hay nada que contrastar de forma significativa: tanto este CLI
(`porCanal.dialer.conGuion = 0`) como `GET /api/telnyx/script-effectiveness`
(`coverage.withScripts` calculado sobre el mismo campo, también 0) dan cero
porque no existe ninguna llamada con `scriptIdsUsed` en la data real
todavía — no hay divergencia que explicar porque no hay dato. Se documenta
esto explícitamente en vez de fabricar un contraste falso (tal como pide el
`<output>` del plan). El desglose por canal (`dialer` vs. `manual`) es la
pieza que va a explicar la diferencia el día que haya datos reales: el
panel solo mira `channel==='telnyx_webrtc'`, este reporte suma todos los
canales.

## Cierre de la fase 35

Con este plan, **SCR-01, SCR-02, SCR-03 y SCR-04 quedan completos —
Phase 35 (SCR — Atribución de guion) CERRADA (4/4 planes)**.

Qué falta para poder comparar dos guiones de verdad: que alguien, en
producción, **ELIJA** guiones distintos durante llamadas reales (o los
corrija después desde cualquiera de las 4 superficies que cablearon 35-02 y
35-03). El instrumento —captura automática (35-02) + segunda oportunidad
(35-03) + medición (35-04, este plan)— ya no es el cuello de botella; lo que
falta es la muestra.

## User Setup Required

None - no external service configuration required. El único "requisito
operativo" es correr `npm run pre-deploy` antes de medir producción — ya
documentado en la cabecera del propio script y en `CLAUDE.md` (regla
crítica de deploy).

## Next Phase Readiness

- Phase 36 (RESP — la disposición responde) y Phase 37 (SES — la sesión de
  discado como partida) siguen sin plan generado (0/3 y 0/4 en
  `ROADMAP.md`) — requieren `discuss-phase`/`plan-phase` antes de poder
  ejecutarse.
- Ninguna dependencia de Phase 35 hacia esas fases: SCR quedó como una fase
  de instrumentación autocontenida, sin superficie compartida con RESP/SES
  más allá de vivir en el mismo `public/app.js`/`index.js`.
- **Sin verificar en vivo** (mismo límite que 35-01/35-02/35-03, explícito
  en cada uno de esos planes: no hay browser ni Telnyx real en este entorno
  de ejecución): que una tanda de llamadas reales en producción, después de
  este deploy, produzca `aMano > 0`. Eso solo se puede verificar corriendo
  el CLI otra vez sobre un `pre-deploy` fresco, después de que el dueño
  llame.

## Baseline de `npm test`

- **Antes de este plan** (commit `f060abb`, cierre de 35-03): **116
  archivos, 2036 tests, 2036 pasando** (documentado en `35-03-SUMMARY.md`).
- **Después de este plan**: **117 archivos, 2054 tests, 2054 pasando**
  (+1 archivo nuevo `tests/coverage-script.test.js` con 18 tests). Dos
  corridas completas limpias, sin flakes (incluido `wa-campaign-engine`,
  que pasó en ambas — no hizo falta invocar la excepción documentada de
  intermitencia por hora/día).
- `git diff --stat package-lock.json` — vacío (T-35-SC, nada instalado).
- `git diff --stat public/` — vacío (este plan no toca frontend, sin
  cache-buster que bumpear).

## Self-Check

- `scripts/coverage-script.mjs` contiene `scriptIdsAuto`: **FOUND**
  (`grep -c` → 3).
- `package.json` contiene `coverage:script`: **FOUND** (`grep -c` → 1).
- `tests/coverage-script.test.js` existe en disco: **FOUND**.
- Commits en `git log`: `d9d2e30`, `ac8c79a`, `2da5fe8` — los 3 **FOUND**
  en `git log --oneline`.

## Self-Check: PASSED

---
*Phase: 35-scr-atribucion-guion*
*Completed: 2026-08-22*
