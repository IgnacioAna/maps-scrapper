---
phase: 29-next-reloj-unico
plan: 04
subsystem: backend
tags: [nextAction, followUps, callbackAt, reloj-unico, migracion, backfill]

requires:
  - phase: 29-01
    provides: "modelo nextAction (_setNextAction/_clearNextAction/_leadNextAction/_deriveNextActionFromLegacy/_nextActionTemplateForDelta), NEXT_ACTION_TEMPLATES (las 5 duraciones), whitelists"
  - phase: 29-02
    provides: "_applyCallOutcome escribiendo/consumiendo nextAction en cada disposición"
  - phase: 29-03
    provides: "_computeFollowupsDue y PATCH .../followup ya derivan/escriben nextAction — lead.followUps deja de ser fuente de verdad de ninguna vista"
provides:
  - "POST /api/admin/backfill-next-action: dryRun + backup + mutex + idempotente, persiste explícito lo que _deriveNextActionFromLegacy ya deriva"
  - "tests/next-action-migration.test.js (16 tests): no escribe en dryRun, no mueve fechas, idempotente, RBAC, la cola responde igual"
  - "scripts/one-shot-migrate-next-action-2026-08-14.mjs: comando único documentado para producción"
  - "medición ensayada contra copia real de data/setters.json (6.413 leads): 166 leads migrables"
  - "fix Rule 1: _callSetterId ya no crashea GET /leads/sin-wsp con callLog vacío"
affects: ["fases 30-34 (retiro de callbackAt/followUps como lectores directos)"]

tech-stack:
  added: []
  patterns:
    - "Migración con scan() pura reusada por dryRun/apply (mismo idioma que backfill-hangup-cap / backfill-consumed-callbacks)"
    - "one-shot de producción: login admin + backup local del export-data + dryRun SIEMPRE + --apply para ejecutar + dryRun final de verificación"

key-files:
  created:
    - tests/next-action-migration.test.js
    - scripts/one-shot-migrate-next-action-2026-08-14.mjs
  modified:
    - index.js
    - CLAUDE.md

key-decisions:
  - "_callSetterId(entry, lead, userMap) ganó un guard `if (!entry) return lead.assignedTo || ''` — Rule 1, bug preexistente de 29-02/29-03 (no de este plan) destapado al testear con fixtures realistas: un lead con nextAction.origen='manual' y callLog vacío (posible desde que tildar un follow-up programa nextAction sin exigir ninguna llamada previa) hacía crashear GET /leads/sin-wsp con 500. Reproducido ANTES de tocar código (probe aislado), y confirmado que es alcanzable con datos reales del tipo que Task 3 necesitaba ensayar. Arreglado porque bloqueaba directamente la verificación que este plan pide (Task 2 behavior: 'la cola responde igual antes/después') y porque el fallback ya existía para el caso análogo 'sin entry.by' — una línea, sin cambiar ningún otro call site (los demás 15 usos de _callSetterId siempre pasan un elemento de array, nunca un 'último o null')."
  - "El test 'la cola no cambia' distingue explícitamente entre leads derivados de callbackAt (manual/cadencia: callbackAt y manualCallbackByOwner byte-idénticos antes/después) y el lead derivado de followUps (callbackAt SÍ cambia, de '' al dueAt derivado — efecto DOCUMENTADO por el propio endpoint como D-03/D-04, no una regresión): la acceptance criteria del plan ('mismo callbackAt') se cumple para los primeros; para el segundo caso, persistir el espejo es justamente el propósito de la migración."

requirements-completed: [NEXT-02, NEXT-03]

duration: ~45min (Tasks 2-3; Task 1 se completó en una sesión previa que agotó su límite)
completed: 2026-08-14
---

# Phase 29 Plan 04: Migración del reloj único a datos persistidos Summary

`POST /api/admin/backfill-next-action` persiste explícito, sobre los 6.413
leads reales de producción, lo que `_deriveNextActionFromLegacy` ya deriva
en cada lectura desde 29-01/29-03: 166 leads migrables (165 con
`callbackAt`, 1 solo con `followUps` activo), ensayado contra una copia
nunca escrita de vuelta al repo, con `apply === dryRun` e idempotencia
verificada (segunda corrida: `updated: 0`). De paso, un bug preexistente de
29-02/29-03 (`_callSetterId` crasheando `GET /leads/sin-wsp` con un
`callLog` vacío) quedó arreglado porque bloqueaba directamente la
verificación que este plan exige.

## Performance

- **Duration:** ~45 min (Tasks 2 y 3 de esta sesión)
- **Tasks:** 3 (`type="auto"`; Task 1 ya estaba commiteada de una sesión previa)
- **Files modified:** 4 (`index.js`, `tests/next-action-migration.test.js`, `scripts/one-shot-migrate-next-action-2026-08-14.mjs`, `CLAUDE.md`)

## Accomplishments

- `POST /api/admin/backfill-next-action` (Task 1, ya commiteada antes de
  esta sesión) cubierta por 16 tests: dryRun no escribe, apply persiste sin
  mover fechas, idempotencia, RBAC 401/403, y comparación antes/después de
  `GET /leads/sin-wsp` para cada tipo de lead.
- Ensayada la migración contra una **copia real** de `data/setters.json`
  (6.413 leads, snapshot del 2026-08-14, jamás escrita de vuelta al repo):
  166 leads migrables, `apply === dryRun`, segunda corrida idempotente.
- Script de producción `scripts/one-shot-migrate-next-action-2026-08-14.mjs`:
  login admin + backup local + dryRun SIEMPRE + `--apply` para ejecutar +
  dryRun final que demuestra la idempotencia.
- Nota #184 en `CLAUDE.md`: qué es `lead.nextAction`, por qué `callbackAt`
  sigue vivo espejado, que `followUps` dejó de ser fuente de verdad, y el
  comando exacto de migración.
- Bug Rule 1 arreglado: `_callSetterId` ya no crashea con `entry` null.

## Task Commits

1. **Task 1: Endpoint de migración POST /api/admin/backfill-next-action** - `f33afa7` (feat) — completada en sesión previa, verificada intacta al arrancar esta.
2. **Task 2: Tests de la migración** - `72e477a` (test) — incluye el fix Rule 1 sobre `_callSetterId` (mismo commit, index.js).
3. **Task 3: Ensayo contra datos reales, script de producción y documentación** - `1a722be` (feat)

_No hubo commit de plan metadata separado antes de este — este SUMMARY se
commitea junto a los updates de STATE/ROADMAP/REQUIREMENTS en el commit final._

## Files Created/Modified

- `index.js` — `POST /api/admin/backfill-next-action` (Task 1, ya existente);
  guard null en `_callSetterId` (Task 2, Rule 1)
- `tests/next-action-migration.test.js` (nuevo, 16 tests) — dryRun/apply/
  idempotencia/RBAC/cola-sin-cambios
- `scripts/one-shot-migrate-next-action-2026-08-14.mjs` (nuevo) — comando
  de producción
- `CLAUDE.md` — nota #184

## Decisions Made

- **`_callSetterId` ganó un guard defensivo para `entry` null** (Rule 1).
  Ver `key-decisions` del frontmatter para el detalle completo: reproducido
  con un probe aislado ANTES de tocar código, confirmado que es alcanzable
  con datos reales (un lead con `followUps` tildado y sin ninguna llamada
  registrada), y que bloqueaba directamente la acceptance criteria de la
  Task 2 de este mismo plan. Sin este fix, tanto el test de "la cola no
  cambia" como el ensayo del Task 3 contra datos reales habrían podido
  crashear `GET /leads/sin-wsp` en producción apenas un lead con esa
  combinación pasara por esa vista.
- **La aserción "la cola no cambia" se dividió por tipo de lead.** Para
  leads derivados de `callbackAt` (manual/cadencia), `callbackAt` y
  `manualCallbackByOwner` son byte-idénticos antes/después de migrar — eso
  es lo que el plan pide literalmente. Para el lead derivado de
  `followUps` sin `callbackAt` previo, el campo SÍ cambia (de `""` al
  `dueAt` derivado): es el efecto D-03/D-04 que el propio endpoint
  documenta como intencional ("es lo que hace que el lead pase a verse en
  las colas de callback"), verificado con un probe antes de escribir el
  test para no asumir de más.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `_callSetterId` crasheaba `GET /leads/sin-wsp` (500) con `callLog` vacío**
- **Found during:** Task 2, al escribir el fixture de "followUps activo, callLog vacío" requerido por el `<behavior>` del plan.
- **Issue:** `_callSetterId(entry, lead, userMap)` asumía `entry` siempre no-null; en `index.js:8462` (`manualCallbackByOwner`), el `&&` de la expresión solo protege contra `_na` falsy, no contra `_last === null` cuando `_na` es truthy con `callLog` vacío — combinación real desde 29-03 (tildar un follow-up programa `nextAction` sin exigir llamada previa).
- **Fix:** guard `if (!entry) return lead.assignedTo || '';` al inicio de la función — mismo fallback que ya existía para "sin `entry.by`".
- **Files modified:** `index.js`
- **Verification:** probe aislado reproduciendo el crash (500) antes del fix, 200 después; los 15 demás call sites de `_callSetterId` no se ven afectados (siempre iteran arrays, nunca pasan un "último o null"); suite completa 1293/1293.
- **Committed in:** `72e477a` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug preexistente).
**Impact on plan:** Necesario para completar la verificación exigida por la propia Task 2 del plan (comparación de `GET /leads/sin-wsp` antes/después). Sin scope creep — una función, un guard, cero cambios de comportamiento en los demás call sites.

## Issues Encountered

- `ensureLeadDefaults` (index.js:657) ya setea `lead.nextAction = null` en
  memoria en CADA `loadSettersData()`, así que cualquier `mutateSettersData`
  (no solo el de esta migración) termina persistiendo `"nextAction":null`
  para leads sin compromiso — el comentario del endpoint ("no infla el JSON
  con `nextAction:null`") describe la intención del scan propio de la
  migración (no asignar nada extra a los no-matcheados), no una garantía de
  que la clave nunca exista en disco. Verificado con un probe antes de
  escribir el test 7 para no aseverar algo falso; el test comprueba que el
  campo queda `null` (no se convierte en objeto), que es lo que realmente
  importa.

## User Setup Required

**Ninguna configuración de entorno nueva.** Un solo paso operativo, con el
aviso del cambio visible pegado ANTES del comando (por decisión explícita
del plan, para que no se descubra un día después mirando el badge):

---

> **El contador de seguimientos del menú (arriba a la izquierda) pasa de 0 a
> 10 con los datos de hoy: ahora también cuenta los "volver a llamar" que
> marcaste durante una llamada (disposición de callback), no solo los
> checkboxes de follow-up que tildás a mano en la ficha de un lead. Los
> reintentos automáticos del sistema (cuando no atienden y vuelve a sonar
> solo) siguen totalmente afuera del contador, como siempre.**

Números reales medidos el 2026-08-14 contra la base completa (6.413 leads,
del plan 29-03):

| | Antes (solo checkboxes) | Después (checkboxes + callbacks manuales) |
|---|---|---|
| Badge del menú (hoy + ayer) | 0 | 10 |
| Vencidos (pestaña "overdue" de la lista) | 3 | 15 |

**Por qué sube y por qué está bien que suba**: los 12 callbacks manuales
nuevos que ahora se ven eran compromisos reales ("te llamo el jueves") que
quedaban invisibles para la lista de follow-ups porque nunca fueron un
checkbox tildado — solo vivían en `callbackAt`. El sistema viejo tenía DOS
relojes que no se hablaban entre sí; la fase 29 los unifica.

_(Este cambio ya está vivo en producción desde que se pusheó el plan 29-03
— `_leadNextAction` deriva en cada lectura sin necesitar la migración. La
migración de este plan 29-04 solo persiste el dato, no cambia lo que ya se
ve.)_

---

Después de mergear y pushear a `main` (**con `npm run pre-deploy` ANTES del
push**, regla crítica de deploy de `CLAUDE.md`), correr:

```bash
node scripts/one-shot-migrate-next-action-2026-08-14.mjs
```

Esto SIEMPRE corre primero una simulación (dryRun) e imprime los
contadores — no toca nada. Si los números cierran contra los medidos en
este SUMMARY (ver más abajo — deberían dar los mismos, salvo que hayan
entrado/salido leads desde el 2026-08-14), correr:

```bash
node scripts/one-shot-migrate-next-action-2026-08-14.mjs --apply
```

Es **idempotente**: correrla dos veces no cambia nada la segunda vez, y
**si no se corre nunca, nada se rompe** — las lecturas siguen derivando el
próximo paso de los campos viejos (`callbackAt`/`followUps`) exactamente
igual que hoy.

## Next Phase Readiness

`lead.nextAction` queda persistido para los leads que ya tenían un
compromiso (callback o follow-up) en el momento de la medición — y el
modelo de lectura ya trata igual a un lead migrado y a uno sin migrar, así
que correr la migración en producción no es bloqueante para ningún plan
siguiente. Las fases 30-34 (retiro de `callbackAt`/`followUps` como
lectores directos en el resto del backend/frontend) pueden arrancar sin
esperar a que el usuario corra el script — aunque conviene que lo corra
pronto para que los nuevos leads sigan acumulando `nextAction` explícito en
vez de derivado.

## Verificación

### `node --check`

```
node --check index.js                                          → OK
node --check scripts/one-shot-migrate-next-action-2026-08-14.mjs → OK
```

### Suite completa

```
npm test
  Test Files  88 passed (88)
       Tests  1293 passed (1293)
```

Baseline post-29-03: 1277 tests. Este plan sumó 16
(`next-action-migration.test.js`) → 1277 + 16 = 1293, exacto.
`tests/metrics-consistency.test.js` no movió ningún número (no tocado por
este plan).

### `tests/next-action-migration.test.js` (16 tests, todos verdes)

- RBAC: anónimo 401, setter 403.
- dryRun: `matched: 4` sobre 6 leads del fixture (manual, cadencia,
  followUps-only, ambos), `yaMigrados: 1` (lead ya migrado), archivo en
  disco intacto.
- apply: `updated: 4`, ninguna fecha se movió para manual/cadencia/ambos,
  el lead followUps-only ganó `callbackAt` espejado (antes `""`),
  `followUps` y `followUpStartedAt` intactos, lead sin compromiso queda con
  `nextAction: null`, lead ya migrado queda byte-idéntico.
- Idempotencia: segunda corrida `dryRun.matched: 0` / `apply.updated: 0`.
- Backup: `data/backups/*pre-backfill-next-action*` existe.
- Cola (`GET /leads/sin-wsp`): mismo `callbackAt`/`manualCallbackByOwner`
  para manual/cadencia/ambos/plain; el lead followUps-only documentado
  aparte (ver Decisions Made).

### Ensayo contra datos reales (Task 3-B)

Copia de `data/setters.json` (25.6 MB, 6.413 leads, snapshot 2026-08-14) +
`data/auth.json` (con un admin de prueba agregado SOLO a la copia de
trabajo) copiadas a un directorio temporal, `DATA_DIR` apuntado ahí, server
levantado sobre la copia — nunca sobre `data/` del repo.

**A) Medición previa (reimplementación pura, solo lectura):**

```json
{
  "total": 6413,
  "conCallbackAt": 165,
  "callbackManual": 33,
  "callbackCadencia": 132,
  "conFollowUpActivo": 4,
  "followUpsConCallback": 3,
  "followUpsSinCallback": 1,
  "yaMigrados": 0
}
```

⚠️ **Aclaración de los dos conjuntos de números que circulan** (pedida por
el plan): los "16 callbacks, 3 followUps" que aparecen en documentos de
planificación anteriores son de una medición del 2026-08-13 con OTRO
criterio (probablemente solo vencidos/"overdue") y sobre OTRO snapshot —
NO son comparables directo contra el `conCallbackAt: 165` de acá, que
cuenta TODOS los leads con `callbackAt` no vacío (pasados y futuros). La
medición del 29-03-SUMMARY (`overdue: 15` tras el cambio, con datos del
mismo día 2026-08-14) sí es consistente: 15 vencidos es un subconjunto
razonable de 165 con `callbackAt` total (la mayoría están fechados a
futuro, no vencidos). Los números de referencia para la decisión de
ejecutar en producción son los de esta sección, medidos hoy sobre el
snapshot actual.

**B) Ensayo contra el endpoint real — 3 respuestas:**

dryRun #1:
```json
{
  "dryRun": true, "matched": 166, "scanned": 6413,
  "conCallbackAt": 165, "conFollowUpActivo": 4, "yaMigrados": 0,
  "byOrigen": { "manual": 34, "cadencia": 132 },
  "byFuente": { "callbackAt": 165, "followUps": 1 }
}
```

apply:
```json
{
  "dryRun": false, "updated": 166, "scanned": 6413,
  "conCallbackAt": 165, "conFollowUpActivo": 4, "yaMigrados": 0,
  "byOrigen": { "manual": 34, "cadencia": 132 },
  "byFuente": { "callbackAt": 165, "followUps": 1 }
}
```

dryRun #2 (verificación de idempotencia):
```json
{
  "dryRun": true, "matched": 0, "scanned": 6413,
  "conCallbackAt": 166, "conFollowUpActivo": 4, "yaMigrados": 166,
  "byOrigen": { "manual": 0, "cadencia": 0 },
  "byFuente": { "callbackAt": 0, "followUps": 0 }
}
```

- `matched` del dryRun (166) == medición previa (165 con callbackAt + 1
  solo-followUps).
- `updated` (166) == `matched` (166).
- Segunda corrida → `matched: 0` / `yaMigrados: 166` (los 166 recién
  migrados). Idempotencia confirmada.
- `conCallbackAt` sube de 165 a 166 en la segunda medición: el único lead
  followUps-only ahora también tiene `callbackAt` (espejado) — coherente
  con `byFuente.followUps: 1` de la primera corrida.

**Spot-check manual** (un lead de cada tipo, revisado a mano en el JSON
resultante):

```
manual   (l_odontoamiga_573115634949):
  nextAction.dueAt = 2026-08-06T13:00:00.000Z
  callbackAt       = 2026-08-06T13:00:00.000Z   → igual: true

cadencia (l_consultorioodontolgicoimplante_59899105879):
  nextAction.dueAt = 2026-07-11T20:28:43.495Z
  callbackAt       = 2026-07-11T20:28:43.495Z   → igual: true

followUps (l_mybajadental_6192729060):
  nextAction.dueAt = 2026-07-23T18:21:48.730Z
  callbackAt       = 2026-07-23T18:21:48.730Z   → igual: true (espejado,
    antes de migrar era "")
  followUps        = { "24hs": true, resto false }  → intactos
  followUpStartedAt = 2026-07-22T18:21:48.730Z       → intacto
```

**Confirmación final:** `git status --porcelain data/` → 0 líneas. El
archivo `data/setters.json` del repo no fue tocado en ningún momento del
ensayo.

## Self-Check: PASSED

- `tests/next-action-migration.test.js` existe: **FOUND**.
- `scripts/one-shot-migrate-next-action-2026-08-14.mjs` existe: **FOUND**.
- Commits existen en `git log`:
  - `f33afa7` (Task 1, sesión previa): **FOUND**
  - `72e477a` (Task 2): **FOUND**
  - `1a722be` (Task 3): **FOUND**
- `node --check index.js` y `node --check scripts/one-shot-migrate-next-action-2026-08-14.mjs`: **OK**.
- Suite completa (`npm test`): **88 test files / 1293 tests, 0 fallos**.
- `git diff --name-only` de los 3 commits de este plan: `index.js`,
  `tests/next-action-migration.test.js`,
  `scripts/one-shot-migrate-next-action-2026-08-14.mjs`, `CLAUDE.md` —
  **cero archivos bajo `public/`, cero `data/*.json` versionados**.
- La migración **NO se ejecutó contra producción** en esta sesión — solo
  contra una copia local, nunca escrita de vuelta al repo.

---
*Phase: 29-next-reloj-unico*
*Completed: 2026-08-14*
