# Phase 29: NEXT — El reloj único - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Mode:** Decisiones tomadas por el orquestador a pedido explícito del user
("terminá todo lo que planificamos, hacelo"). Fundadas en los requisitos
R1-R8 y en el research del milestone, no inventadas.

<domain>
## Phase Boundary

Cada lead tiene UN SOLO objeto de próxima acción (`nextAction`) que reemplaza
a `callbackAt` y al sistema viejo de `followUps`, sin perder ningún
comportamiento vigente hoy: la cadencia automática de no-contacto, el callback
manual, y el consumo del compromiso pendiente al re-discar.

Requirements: NEXT-01, NEXT-02, NEXT-03, NEXT-04.

**Esta fase es infraestructura.** Casi no cambia lo que el user ve. Su valor
es que las fases 30-34 puedan apoyarse en un solo reloj en vez de dos.

</domain>

<decisions>
## Implementation Decisions

### Forma del objeto

- **D-01 — `lead.nextAction`** es un objeto único (no un array):
  `{ tipo, dueAt, canal, motivo, origen, createdAt, createdBy }`.
  - `tipo`: `callback` | `cadencia` | `enviar_info` | `esperar_respuesta` |
    `otro` (whitelist estricta, patrón `CALL_OUTCOMES`).
  - `dueAt`: ISO. `canal`: `llamada` | `whatsapp` | `email` | `''`.
  - `origen`: `manual` | `cadencia` | `compromiso` (la fase 31 usa el tercero).
  - `null` = el lead no tiene próximo paso.
- **D-02 — A lo sumo UNO pendiente por lead.** Programar uno nuevo reemplaza
  el anterior. No hay cola de acciones futuras: eso fue exactamente el
  problema de los dos relojes.

### Migración y compatibilidad (lo más riesgoso de la fase)

- **D-03 — Escritura dual, `nextAction` como fuente de verdad.**
  `callbackAt` NO se elimina en esta fase: se mantiene **espejado** desde
  `nextAction.dueAt` en cada escritura. Motivo: hay decenas de lecturas de
  `callbackAt` repartidas en backend y frontend (colas, filtros, chips, Hoy,
  Power Dialer, reportes). Migrar lectores y modelo en la misma fase es
  exactamente la reescritura grande que el roadmap prohíbe. Los lectores se
  migran en las fases siguientes, y `callbackAt` se retira recién cuando no
  quede ninguno.
- **D-04 — `followUps` SÍ muere en esta fase** (NEXT-03): son 3 leads. Se
  migra el step activo a un `nextAction` equivalente, `lead.followUps` deja
  de ser leído como fuente de verdad por cualquier vista, y sus 5 duraciones
  (24h/48h/72h/7d/15d) sobreviven como **plantillas de `dueAt`**. La historia
  no se borra: el campo queda en el JSON como registro muerto.
- **D-05 — Migración con el patrón establecido del proyecto**: endpoint admin
  con `dryRun` + backup + idempotencia, verificable antes/después contra los
  números medidos (16 callbacks, 3 followUps). Nada de scripts sueltos.

### Comportamiento que NO puede cambiar

- **D-06 — La cadencia automática de no-contacto sigue idéntica**: reintento
  a +24h, descarte al 2° no-contacto seguido, **excepto interesados** (que
  nunca se auto-descartan, nota #183). Ahora escribe `nextAction` con
  `origen:'cadencia'` en vez de tocar `callbackAt` directo.
- **D-07 — El tope de cortes (`hung_up` ×2) se mantiene** tal cual (#171).
- **D-08 — Toda disposición consume el `nextAction` pendiente** (NEXT-04):
  generaliza la regla que hoy existe solo para `callbackAt` (#182, el bug del
  lead clavado primero en la cola). Se limpia al entrar a `_applyCallOutcome`
  y las ramas que corresponden programan el suyo después.
- **D-09 — La distinción manual vs cadencia se preserva**: hoy "En
  seguimiento" cuenta SOLO callbacks manuales (#150) y Hoy muestra solo esos.
  Con el modelo nuevo eso se lee de `nextAction.origen === 'manual'` en vez
  de inspeccionar el último outcome del callLog. El número visible al user no
  puede cambiar.

### Contrato con el agente de voz (v3.0 parkeado)

- **D-10 — `_applyCallOutcome` sigue siendo el helper puro compartido** con
  el webhook de Retell. La paridad con `tests/metrics-consistency.test.js` es
  intocable: ninguna métrica del funnel puede moverse un número por esta
  fase.

### Claude's Discretion

- Nombres internos de helpers, forma exacta de los tests, si el espejado de
  `callbackAt` vive en un helper `_setNextAction()` central o en cada rama.
- Si conviene exponer los helpers puros en `globalThis` para tests (el
  proyecto ya lo hace con `__callCore`, `__phase16`, `__voiceAgent`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y contexto del milestone
- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R1-R8,
  fuente de verdad por encima de este archivo
- `.planning/research/2026-08-13-estado-seguimiento-para-investigar.md` —
  cómo funciona hoy el seguimiento (callbackAt, followUps, las 3 vistas)
- `.planning/ROADMAP.md` — Phase 29 + reglas transversales del milestone

### Código y reglas del proyecto
- `CLAUDE.md` — notas #150 (En seguimiento = solo callbacks manuales), #171
  (tope de cortes), #182 (callback zombie, toda disposición lo consume),
  #183 (interesados no se auto-descartan), #19 (mutex `mutateSettersData`),
  regla del cache-buster
- `index.js` `_applyCallOutcome` (~10700) — el corazón a modificar
- `index.js` `FOLLOWUP_STEPS` / `_computeFollowupsDue` (~11435) — lo que muere

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mutateSettersData` — mutex obligatorio para escrituras async (regla #19)
- `ensureLeadDefaults` — donde se inicializan los campos nuevos del lead
- Patrón de endpoint de migración con `dryRun`+backup: `backfill-signals`,
  `backfill-hangup-cap`, `backfill-consumed-callbacks` (todos en index.js)
- `globalThis.__callCore` — el CALL METRICS CORE del que deriva toda métrica

### Established Patterns
- Whitelists estrictas de strings (`CALL_OUTCOMES`, `DISQUALIFY_REASONS`)
- Tests puros extrayendo bloques por marcadores (fases 28-01/28-02)
- Los defaults de lead se agregan en `ensureLeadDefaults`, y `loadSettersData`
  los aplica a cada lead en cada load

### Integration Points
- `_applyCallOutcome` (dispositions humanas + webhook del agente de voz)
- `GET /api/setters/leads/sin-wsp` — la cola de discado, lee `callbackAt`
- `_leadIsCallableNow` / `_leadPendingForOwner` — filtros de cola
- Frontend: `renderCallsList`, `_pdBuildQueue`, `loadHoyView` leen `callbackAt`

</code_context>

<specifics>
## Specific Ideas

El dolor original del user, textual: "es un caos poder hacer los seguimientos,
saber a quién llamé, no tengo control de nada". Esta fase no lo resuelve sola
— es el cimiento para que las fases 30-34 lo resuelvan sin construir sobre
dos relojes contradictorios.

</specifics>

<deferred>
## Deferred Ideas

- Retirar `callbackAt` del todo: recién cuando no quede ningún lector (post
  fase 34).
- Historial de acciones pasadas (`actions[]` con las cumplidas): el modelo
  guarda solo la pendiente; el histórico ya vive en `callLog` + `notes`.

</deferred>

---

*Phase: 29-NEXT — El reloj único*
*Context gathered: 2026-08-14*
