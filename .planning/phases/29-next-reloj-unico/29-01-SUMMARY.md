---
phase: 29-next-reloj-unico
plan: 01
subsystem: backend
tags: [nextAction, callbackAt, followUps, modelo-de-datos, cascada-de-dispositions]
dependency-graph:
  requires: []
  provides:
    - "lead.nextAction (D-01): reloj único de próxima acción"
    - "_setNextAction / _clearNextAction: escritura con espejo garantizado (D-03)"
    - "_deriveNextActionFromLegacy / _leadNextAction: lectura pura, migrada o sin migrar"
    - "NEXT_ACTION_TIPOS/CANALES/ORIGENES/TEMPLATES: whitelists + plantillas únicas"
  affects:
    - "index.js: ensureLeadDefaults, 5 writers de callbackAt fuera de _applyCallOutcome, corrección de auto-marca"
tech-stack:
  added: []
  patterns:
    - "Whitelist-Set con coerción defensiva (mismo idioma que CALL_OUTCOMES/DISQUALIFY_REASONS)"
    - "Exposure/extension pattern: helpers nuevos sumados a globalThis.__voiceAgent existente"
key-files:
  created:
    - tests/next-action-model.test.js
  modified:
    - index.js
decisions:
  - "_clearNextAction (Task 1) contiene su propia asignación literal `lead.callbackAt = '';` — el grep de verificación del plan para Task 2 esperaba exactamente 2/5 ocurrencias fuera de _applyCallOutcome; el número real es 3/6 porque el helper sancionado también cuenta. El invariante que importa (ningún writer FUERA de _clearNextAction asigna callbackAt='' directo, fuera de _applyCallOutcome) se cumple igual — detalle completo abajo."
metrics:
  duration: "~55 min"
  completed: 2026-08-14
---

# Phase 29 Plan 01: Modelo nextAction — el reloj único de próxima acción Summary

Crea `lead.nextAction`, el objeto único de próxima acción por lead, con un
espejo garantizado hacia `lead.callbackAt` (D-03) para que los dos relojes no
puedan divergir mientras conviven — sin cambiar ningún comportamiento
visible todavía. Las 3 tasks del plan se ejecutaron en orden y cada una
quedó verificada por su propia suite de regresión antes de seguir.

## Lo que se construyó

**Task 1 — Modelo, whitelists y helpers (index.js ~10618-10758, antes de
`_applyCallOutcome`):**
- `NEXT_ACTION_TIPOS` / `NEXT_ACTION_CANALES` / `NEXT_ACTION_ORIGENES`:
  whitelists `Set` con el mismo idioma que `CALL_OUTCOMES`/`DISQUALIFY_REASONS`.
- `NEXT_ACTION_TEMPLATES`: las 5 duraciones de follow-up (24h/48h/72h/7d/15d),
  ahora la ÚNICA fuente. `FOLLOWUP_STEPS` (index.js:11591) quedó como
  `const FOLLOWUP_STEPS = NEXT_ACTION_TEMPLATES;` — un alias, cero
  duplicación de `deltaMs`.
- `_nextActionTemplateForDelta(deltaMs)`: coincidencia EXACTA, sin tolerancia.
- `_setNextAction(lead, spec, nowIso)`: escribe `nextAction` + espeja
  `callbackAt` (asignación literal del string, sin normalizar). Coerción
  defensiva de valores fuera de whitelist — NUNCA lanza.
- `_clearNextAction(lead)`: apaga los dos campos juntos, siempre.
- `_deriveNextActionFromLegacy(lead)`: PURA. Prioridad `callbackAt` >
  `followUps` activo; `origen='manual'` solo si el ÚLTIMO `callLog` entry es
  `callback_later` (mismo criterio que `manualCallbackByOwner`, index.js:8379,
  y la nota #150 de CLAUDE.md — preserva D-09).
- `_leadNextAction(lead)`: único lector — `nextAction` explícito o derivación.
- `ensureLeadDefaults`: guard por `undefined` (no por falsedad — `null` es un
  valor con significado).
- Todo expuesto en `globalThis.__voiceAgent` (mismo objeto donde ya vivía
  `_applyCallOutcome`, patrón D-10 del webhook de voz).

**Task 2 — Invariante de espejo en los 7 writers fuera de `_applyCallOutcome`:**
Los 7 puntos que hoy escriben `callbackAt` FUERA de `_applyCallOutcome` pasan
a usar `_clearNextAction`/a sumar `nextAction` al lado de `callbackAt`. Línea
final de cada uno:

| # | Writer | Línea final | Qué cambia |
|---|--------|-------------|------------|
| a | `backfill-hangup-cap` | index.js:4046 | `lead.callbackAt = '';` → `_clearNextAction(lead);` |
| b | `backfill-consumed-callbacks` | index.js:4085 | `data.leads[h.id].callbackAt = '';` → `_clearNextAction(data.leads[h.id]);` |
| c | `_resetLeadForRedistribution` | index.js:9231 | `lead.callbackAt = '';` → `_clearNextAction(lead);` |
| d | `POST /api/admin/recycle-pool` | index.js:9634 | `lead.callbackAt = '';` → `_clearNextAction(lead);` |
| e | `POST /api/setters/leads/:id/reactivate` | index.js:10164 (+ `previousState.nextAction` en 10157) | `lead.callbackAt = '';` → `_clearNextAction(lead);`; `previousState` ahora guarda `nextAction` junto a `callbackAt` |
| f | Corrección de auto-marca — construcción de `preCadence` | index.js:11106 | suma `nextAction: lead.nextAction \|\| null` al snapshot |
| g | Corrección de auto-marca — restauración desde `preCadence` | index.js:11044 (junto a `callbackAt` en 11043) | suma `lead.nextAction = _pc.nextAction ?? null;` — los dos campos vuelven JUNTOS |

`_applyCallOutcome` quedó en el rango **10767–10938** (función completa,
`function`→`}`). Las 3 asignaciones internas de `callbackAt = ''`
(10787, 10902, 10926) y las 2 de fecha (10830, 10932) quedaron **intactas a
propósito** — son territorio exclusivo del plan 29-02.

**Task 3 — Tests puros (`tests/next-action-model.test.js`, 17 tests):**
Cubre los 13 casos de `<behavior>` del plan: coerción defensiva sin throw,
`dueAt` inválido limpia el reloj, espejo byte-idéntico, `_clearNextAction`
apaga los dos campos, `_deriveNextActionFromLegacy` no muta el lead de
entrada, los 3 casos de origen manual/cadencia según el último `callLog`
entry, prioridad `callbackAt` > `followUps`, derivación desde `followUps`
activo recuperable con `_nextActionTemplateForDelta`, lead sin nada → `null`,
`_leadNextAction` con y sin `nextAction` explícito, y el caso HTTP
(`GET /api/setters/leads/sin-wsp` expone `nextAction: null` sin migración).

## Verificación por mutación (Task 3, registrada según lo pedido en el plan)

Se hicieron 2 rondas de mutación temporal sobre `index.js`, cada una
restaurada inmediatamente después de confirmar el fallo (sin marcas vivas —
verificado con `grep -n "MUTATION-TEST-TEMP" index.js` → 0 resultados tras
restaurar):

1. **Espejo deshabilitado** (comentar `lead.callbackAt = s.dueAt;` dentro de
   `_setNextAction`): **1 test rojo** — "tras `_setNextAction`, `lead.callbackAt
   === lead.nextAction.dueAt`" (`callbackAt` quedó `''` en vez del `dueAt`
   esperado).
2. **Prioridad invertida** (`if (lead.callbackAt && false)` en
   `_deriveNextActionFromLegacy`, forzando que el `followUps` activo gane):
   **5 tests rojos** — el de "gana callbackAt" directamente, más 4 tests que
   dependían indirectamente de que la rama `callbackAt` corriera primero
   (origen manual/cadencia y `_leadNextAction`).

Ambas mutaciones confirmaron que la red de seguridad detecta la rotura del
contrato central del plan (D-03 y la prioridad de derivación). Código
restaurado exacto al estado post-Task 2 en ambos casos.

## Deviations from Plan

### Nota sobre el grep de "5 líneas" de la acceptance criteria de Task 2

El acceptance criteria original esperaba `grep -n "callbackAt = ''" index.js`
→ **exactamente 5 líneas** (default de `ensureLeadDefaults`, default de
`__wspClassified`, y las 3 internas de `_applyCallOutcome`). El resultado
real tras Task 1+2 es **6 líneas** — aparece una adicional en
`index.js:10700`, que es la implementación LITERAL del propio
`_clearNextAction` (`lead.callbackAt = '';` dentro de su cuerpo, tal como
pide el Task 1 §5: "`_clearNextAction(lead)`: `lead.nextAction = null` +
`lead.callbackAt = ''`"). Esto es inevitable siguiendo el contrato exacto de
`<interfaces>` — el helper sancionado necesita, en algún punto, escribir el
string literal.

El chequeo ACOTADO del plan (excluir el rango de `_applyCallOutcome` y contar
lo que queda) esperaba **2**; el resultado real es **3** por el mismo motivo
(la definición de `_clearNextAction` vive fuera del rango de
`_applyCallOutcome`). Verificado explícitamente que las otras 5 ocurrencias
que existían ANTES de este plan (los 5 writers de la Task 2) ya NO aparecen
como asignación directa — todas pasan por `_clearNextAction(...)` ahora. El
invariante real que la acceptance criteria quería proteger ("ningún writer
fuera de `_clearNextAction`/`_applyCallOutcome` asigna `callbackAt=''`
directo") se cumple; el conteo literal esperado por el plan no anticipaba que
el propio helper apareciera en su propio grep. Documentado como nota, no
como bug — no requirió ningún cambio de código.

### Auto-fixed Issues

Ninguno — el plan no encontró bugs ni brechas de Rule 1/2/3 durante la
ejecución. Todo lo escrito sigue exactamente `<interfaces>` del plan.

## Self-Check: PASSED

- `tests/next-action-model.test.js` existe: **FOUND**.
- Commits existen en `git log`:
  - `9443975` (Task 1): **FOUND**
  - `33159d7` (Task 2): **FOUND**
  - `6ed88e5` (Task 3): **FOUND**
- `node --check index.js`: **OK**.
- Suite completa del repo (`npx vitest run`): **85 test files / 1257 tests,
  0 fallos**.
- `git diff --name-only` contra HEAD anterior al plan: solo `index.js` +
  `tests/next-action-model.test.js` — **cero archivos bajo `public/`**.
