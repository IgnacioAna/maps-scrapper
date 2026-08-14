---
phase: 29-next-reloj-unico
plan: 03
subsystem: backend
tags: [nextAction, followUps, callbackAt, reloj-unico, badge, seguimiento]

requires:
  - phase: 29-01
    provides: "modelo nextAction (_setNextAction/_clearNextAction/_leadNextAction/_deriveNextActionFromLegacy/_nextActionTemplateForDelta), NEXT_ACTION_TEMPLATES (las 5 duraciones), whitelists"
  - phase: 29-02
    provides: "_applyCallOutcome escribiendo/consumiendo nextAction en cada disposición (D-08), manualCallbackByOwner leyendo nextAction.origen"
provides:
  - "PATCH /api/setters/leads/:id/followup escribiendo nextAction (tildar programa, destildar apaga solo si es el suyo)"
  - "_computeFollowupsDue derivando de _leadNextAction — lead.followUps ya NO es fuente de verdad de ninguna vista del backend"
  - "Recorte explícito de origen==='cadencia' en la lista de follow-ups (#150), medido contra datos reales"
  - "Medición documentada del único cambio visible de la fase: el badge de follow-ups sube de 0 a 10 (datos de hoy)"
affects: [30-gate-proximo-paso, "fases 30-34 (migración de lectores de callbackAt)"]

tech-stack:
  added: []
  patterns:
    - "FOLLOWUP_STEPS = NEXT_ACTION_TEMPLATES (alias, una sola fuente de las 5 duraciones)"
    - "_computeFollowupsDue como VISTA de solo lectura sobre _leadNextAction, con recorte de origen por lista (mismo idioma que _leadIsCallableNow excluyendo DNC/tarifa roja)"

key-files:
  created:
    - tests/next-action-followups.test.js
  modified:
    - index.js

key-decisions:
  - "dueAt del nextAction que crea el PATCH se deriva de Date.parse(nowIso)+deltaMs (no de un Date.now() nuevo), para que createdAt y dueAt compartan el mismo instante base y _nextActionTemplateForDelta pueda recuperar el step con coincidencia EXACTA — el plan describía 'Date.now()' en prosa pero la propia acceptance criteria (una sola llamada a new Date().toISOString() en la rama) exige derivar del nowIso ya calculado."
  - "El test de la mutación del recorte de cadencia necesitó un fixture sembrado directo (nextAction de cadencia YA VENCIDO) además del camino HTTP (no_answer): un reintento recién creado por la cadencia siempre vence a +24h, así que nunca está 'due' en el momento en que se crea — sin el fixture sembrado, la mutación no hacía fallar ningún test (el filtro de status='future' de /today ya lo tapaba, enmascarando si el recorte de origen funcionaba o no)."

requirements-completed: [NEXT-03]

duration: ~50min
completed: 2026-08-14
---

# Phase 29 Plan 03: Retiro de `followUps` como reloj paralelo Summary

`PATCH /api/setters/leads/:id/followup` ahora programa el mismo `nextAction`
que cualquier otra vía cuando se tilda un checkbox, y `_computeFollowupsDue`
—la función detrás del badge del sidebar y de `GET /followups/today`— dejó
de leer `lead.followUps`: deriva de `_leadNextAction`, igual que el resto del
backend desde 29-01/29-02. Medido contra una copia de los datos reales de
producción (6.413 leads, hoy 2026-08-14): el badge de follow-ups sube de 0 a
10 porque ahora también cuenta los callbacks manuales de disposición, no solo
los checkboxes tildados a mano — es el único cambio visible de toda la fase
29, y queda redactado como aviso para comunicar antes del deploy.

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 (todas `type="auto"`, la Task 3 con `tdd="true"`)
- **Files modified:** 2 (`index.js`, `tests/next-action-followups.test.js`)

## Accomplishments

- Tildar un follow-up (24h/48h/72h/7d/15d) programa un `nextAction` real
  (`tipo:'callback'`, `origen:'manual'`, `motivo:'follow-up <label>'`) que
  espeja `callbackAt` (D-03) — el lead sale de la cola de Llamadas y aparece
  en Hoy → Callbacks hasta esa fecha. Antes tildar el checkbox no movía nada.
- Destildar solo apaga el `nextAction` si ES el que este endpoint creó
  (`origen:'manual'` + `motivo` con prefijo `'follow-up '`); un compromiso
  pactado por teléfono en una disposición `callback_later` no se pisa.
- `lead.followUps`/`followUpStartedAt` se siguen escribiendo como registro
  muerto (el frontend todavía pinta el chip con ellos, nota #175 de
  CLAUDE.md) — cero cambios en `public/`.
- `_computeFollowupsDue` es ahora una vista pura sobre `_leadNextAction`:
  responde igual para un lead migrado (`nextAction` explícito) y uno sin
  migrar (derivado de `callbackAt`/`followUps` legacy).
- Recorte explícito de `origen==='cadencia'`: los reintentos automáticos de
  no-contacto (#150 de CLAUDE.md) nunca estuvieron en esta lista y siguen sin
  estarlo. Medido: 131 leads con `nextAction` de cadencia en la base real.
- Medición antes/después con el endpoint HTTP real (no solo una
  reimplementación) — ver sección de medición abajo.

## Task Commits

1. **Task 1: Tildar un follow-up programa el próximo paso (write-path)** - `0614401` (feat)
2. **Task 2: La vista de follow-ups deja de leer lead.followUps (read-path)** - `fe9387f` (feat)
3. **Task 3: Tests del retiro de followUps** - `1b4d5b4` (test)

_No hubo commit de plan metadata separado — este SUMMARY se commitea junto a
los updates de STATE/ROADMAP/REQUIREMENTS en el commit final._

## Files Created/Modified

- `index.js` — `PATCH /api/setters/leads/:id/followup` (write-path: tildar
  programa `nextAction`, destildar lo apaga si es el suyo); `_computeFollowupsDue`
  (read-path: deriva de `_leadNextAction`, excluye `origen==='cadencia'`);
  comentario de cabecera de la sección FOLLOW-UPS reescrito (D-04)
- `tests/next-action-followups.test.js` (nuevo) — 9 tests: write-path (4),
  read-path (5)

## Decisions Made

- **`dueAt` derivado de `Date.parse(nowIso)`, no de un `Date.now()` nuevo.**
  El plan describía la fórmula en prosa como `new Date(Date.now() +
  template.deltaMs)`, pero su propia acceptance criteria exige que
  `followUpStartedAt` y `nextAction.createdAt` compartan el MISMO instante Y
  que haya una sola llamada a `new Date().toISOString()` en la rama de
  tildado — con eso, `dueAt` tiene que derivarse del `nowIso` ya calculado
  (`new Date(Date.parse(nowIso) + template.deltaMs).toISOString()`), no de un
  segundo `Date.now()` que podría diferir en milisegundos y romper la
  coincidencia exacta que `_nextActionTemplateForDelta` necesita para
  recuperar el `step`. Verificado con la prueba manual: `dueAt - NOW` dio
  11ms de diferencia con el `nowIso` capturado en el test (no con el server),
  bien dentro de cualquier tolerancia razonable.
- **El test de mutación del recorte de cadencia necesitó un fixture sembrado
  directo.** El camino HTTP (`no_answer` real) confirma que `_applyCallOutcome`
  escribe `origen:'cadencia'`, pero un reintento recién creado por la
  cadencia SIEMPRE vence a +24h — nunca está "due" en el instante en que se
  crea, así que el filtro `status==='future'` de `/followups/today` ya lo
  descarta sin que el recorte de `origen` entre en juego. Se agregó
  `lead_cadencia_due` (un `nextAction` de cadencia sembrado directo con
  `dueAt` YA VENCIDO) para que la mutación tuviera algo que romper de verdad.
  Sin este fixture, "quitar el recorte" no hacía fallar ningún test — lo cual
  habría sido una falsa sensación de cobertura.

## Deviations from Plan

None — Rule 1/2/3/4 no aplicaron. El único ajuste (la derivación de `dueAt`
desde `nowIso` en vez de un `Date.now()` nuevo, y el fixture extra del test
de mutación) son decisiones de implementación dentro de lo que el plan dejó
a criterio de Claude (`Claude's Discretion` de `29-CONTEXT.md`: "forma exacta
de los tests"), no desvíos de comportamiento.

## Issues Encountered

None.

## Verificación

### `node --check index.js`

OK en las 3 tasks.

### Regresión sin editar archivos de contrato

```
npx vitest run tests/followups.test.js
  Test Files  1 passed (1)
       Tests  13 passed (13)

npx vitest run tests/followups.test.js tests/team-performance.test.js
  Test Files  2 passed (2)
       Tests  32 passed (32)
```

### Grep de acceptance criteria

```
$ grep -n "_setNextAction(lead" index.js          # dentro de la handler PATCH (Task 1)
10027:      _setNextAction(lead, {                # única en la rama de tildado

$ grep -n "_clearNextAction(lead)" index.js
10046:      _clearNextAction(lead);               # única en la rama de destildado (dentro del PATCH)

$ grep -n "origen === 'cadencia'" index.js
11689:  if (!na || !na.dueAt || na.origen === 'cadencia') return out;

$ grep -n "lead.followUps\[" index.js
10007:  const previous = !!lead.followUps[step];        # write-path
10017:    for (const k of valid) lead.followUps[k] = (k === step);   # write-path
10038:    lead.followUps[step] = false;                  # write-path
10039:    const stillActive = valid.some((k) => lead.followUps[k] === true);  # write-path
# — las 4 ocurrencias son del endpoint PATCH (write-path); cero lectores.

$ node -e "extrae el cuerpo de _computeFollowupsDue y cuenta..."
lead.followUps occurrences: 0
_leadNextAction occurrences: 1

$ git diff --name-only <inicio del plan>..HEAD
index.js
tests/next-action-followups.test.js
# cero archivos bajo public/
```

### Prueba manual del PATCH (registrada, vía supertest contra el código real — no el preview HTTP, ídem estilo 29-01/29-02)

Tildar `72hs` sobre un lead limpio:

```json
{
  "ok": true,
  "followUps": { "24hs": false, "48hs": false, "72hs": true, "7d": false, "15d": false },
  "followUpStartedAt": "2026-08-14T21:47:28.848Z",
  "lead": {
    "id": "l1",
    "callbackAt": "2026-08-17T21:47:28.848Z",
    "followUps": { "24hs": false, "48hs": false, "72hs": true, "7d": false, "15d": false },
    "followUpStartedAt": "2026-08-14T21:47:28.848Z",
    "nextAction": {
      "tipo": "callback",
      "dueAt": "2026-08-17T21:47:28.848Z",
      "canal": "llamada",
      "motivo": "follow-up 72h",
      "origen": "manual",
      "createdAt": "2026-08-14T21:47:28.848Z",
      "createdBy": "AdminMF"
    }
  }
}
```

Checks:
- `followUps['72hs'] === true`: **true**
- `nextAction.motivo === 'follow-up 72h'`: **true**
- `callbackAt === nextAction.dueAt`: **true**
- `dueAt` a ~72h del `nowIso` capturado en el test: delta **11ms** (bien
  dentro de cualquier tolerancia)

Destildar el mismo step sobre el mismo lead:

```json
{
  "ok": true,
  "followUps": { "24hs": false, "48hs": false, "72hs": false, "7d": false, "15d": false },
  "followUpStartedAt": null,
  "lead": { "callbackAt": "", "nextAction": null, ... }
}
```

- `nextAction === null` tras destildar: **true**
- `callbackAt === ''` tras destildar: **true**

### Verificación por mutación (Task 3)

1. Se comentó `|| na.origen === 'cadencia'` dentro de `_computeFollowupsDue`
   (marca `MUTATION-TEST-TEMP`).
2. `npx vitest run tests/next-action-followups.test.js` → **1/9 rojo**:
   `"un nextAction de cadencia YA VENCIDO tampoco aparece en overdue..."`
   (el lead `lead_cadencia_due`, sembrado con `nextAction.origen:'cadencia'`
   y `dueAt` vencido, apareció en `overdue` con `step:'24hs'` cuando el
   recorte estaba deshabilitado).
3. Código restaurado exacto: `grep -c MUTATION-TEST-TEMP index.js` → **0**;
   `git diff index.js` tras restaurar → **vacío** (idéntico al commit de
   Task 2).

### Suite completa

```
npx vitest run tests/next-action-followups.test.js
  Test Files  1 passed (1)
       Tests  9 passed (9)

npm test
  Test Files  87 passed (87)
       Tests  1277 passed (1277)
```

Baseline post-29-02: 1268 tests. Este plan sumó 9 (`next-action-followups.test.js`)
→ 1268 + 9 = 1277, exacto. Ningún otro archivo cambió su conteo.

## Medición obligatoria: conteos antes/después sobre datos reales

Ejecutada sobre una **copia** de `data/setters.json` (25.6 MB, 6.413 leads) +
`data/auth.json` reales, copiados a scratchpad y NUNCA tocados/escritos de
vuelta al repo (`DATA_DIR` apuntado a la copia). Dos scripts de solo lectura:

1. Uno que reimplementa el algoritmo VIEJO (`lead.followUps` + `_bizStartOfDay`
   real, importado del `index.js` commiteado vía `globalThis.__metricsAudit`)
   y el algoritmo NUEVO (`_leadNextAction` real, vía `globalThis.__voiceAgent`),
   iterando los 6.413 leads en memoria.
2. Uno que pega directo al endpoint HTTP real (`GET /api/setters/followups/today`
   y `/badge`, con un admin de test agregado a una SEGUNDA copia del
   `auth.json`) para cross-validar que la reimplementación coincide con el
   comportamiento del servidor de punta a punta.

Los dos métodos dieron **exactamente el mismo resultado**:

```
=== ANTES (lead.followUps, código viejo) ===
{ "dueToday": 0, "dueYesterday": 0, "overdue": 3, "future": 0 }
badge (dueToday+dueYesterday): 0

=== DESPUÉS (nextAction, código nuevo) ===
{ "dueToday": 8, "dueYesterday": 2, "overdue": 15, "future": 8 }
badge (dueToday+dueYesterday): 10

=== Delta ===
dueToday delta: +8
dueYesterday delta: +2
overdue delta: +12
badge delta: +10

=== Leads con nextAction origen=cadencia excluidos (no ocultos) ===
131

=== Cross-check contra el endpoint HTTP real ===
GET /api/setters/followups/badge  → { "count": 10 }
GET /api/setters/followups/today  → { "dueToday": 8, "dueYesterday": 2, "overdue": 15, "badge": 10 }
```

**Umbral de parada (overdue > 60): NO se alcanzó.** `overdue` después del
cambio es 15, muy por debajo de 60 — no fue necesario parar a consultar.

**El delta de `overdue` (3→15, +12) es consistente con el objetivo de la
fase**: esos leads son callbacks manuales pactados (`origen:'manual'`) que
ANTES no aparecían en ningún lado porque no tenían un `followUps` activo —
compromisos que se estaban perdiendo, exactamente el problema que
`PROJECT.md` describe ("12 de 16 callbacks vencidos es el KPI de saturación
en rojo"). Ahora se ven.

## Aviso al usuario (cambio visible)

**Esto es lo único de toda la fase 29 que cambia lo que Ignacio ve en el
panel** (el resto es infraestructura interna). Contradice, de forma chica y
esperada, la expectativa de `29-CONTEXT.md` ("casi no cambia lo que el user
ve") — documentado ahí mismo como la única excepción.

> **El contador de seguimientos del menú (arriba a la izquierda) pasa de 0 a
> 10 con los datos de hoy: ahora también cuenta los "volver a llamar" que
> marcaste durante una llamada (disposición de callback), no solo los
> checkboxes de follow-up que tildás a mano en la ficha de un lead. Los
> reintentos automáticos del sistema (cuando no atienden y vuelve a sonar
> solo) siguen totalmente afuera del contador, como siempre.**

Números reales medidos hoy (2026-08-14) contra tu base completa (6.413
leads):

| | Antes (solo checkboxes) | Después (checkboxes + callbacks manuales) |
|---|---|---|
| Badge del menú (hoy + ayer) | 0 | 10 |
| Vencidos (pestaña "overdue" de la lista) | 3 | 15 |

**Por qué sube y por qué está bien que suba**: los 12 callbacks manuales
nuevos que ahora se ven eran compromisos reales ("te llamo el jueves") que
quedaban invisibles para la lista de follow-ups porque nunca fueron un
checkbox tildado — solo vivían en `callbackAt`. El sistema viejo tenía DOS
relojes que no se hablaban entre sí; este plan los unifica, y unificarlos
significa que la lista ahora muestra TODO lo que hay que hacer, no solo una
parte.

**Pendiente de comunicar antes del deploy de la Wave 4** (el push a
producción viene después de que corra la migración del plan 29-04, que va a
levantar este párrafo tal cual para el paso final del usuario) — no
descubrirlo solo mirando un número más alto en el panel un día cualquiera.

## User Setup Required

None — no requiere configuración externa. El deploy a producción (`git push
origin main`) es responsabilidad del plan 29-04 (migración) / de la Wave 4,
no de este plan.

## Next Phase Readiness

`lead.followUps` dejó de ser leído por cualquier vista del backend — las 5
duraciones sobreviven solo como plantillas de `nextAction.dueAt`. El campo
sigue en el JSON (registro muerto, cero migración destructiva) para que el
frontend siga pintando su chip sin cambios hasta que las fases 30-34 migren
esos lectores. El plan 29-04 (migración de los ~16 `callbackAt` y ~3
`followUps` restantes a `nextAction` explícito) puede correr sin bloqueos:
el modelo de lectura/escritura ya trata igual a un lead migrado y a uno sin
migrar.

## Self-Check: PASSED

- `tests/next-action-followups.test.js` existe: **FOUND**.
- Commits existen en `git log`:
  - `0614401` (Task 1): **FOUND**
  - `fe9387f` (Task 2): **FOUND**
  - `1b4d5b4` (Task 3): **FOUND**
- `node --check index.js`: **OK**.
- Suite completa del repo (`npm test`): **87 test files / 1277 tests, 0 fallos**.
- `git diff --name-only` de los 3 commits de este plan: `index.js`,
  `tests/next-action-followups.test.js` — **cero archivos bajo `public/`**
  (regla del plan: backend-only).

---
*Phase: 29-next-reloj-unico*
*Completed: 2026-08-14*
