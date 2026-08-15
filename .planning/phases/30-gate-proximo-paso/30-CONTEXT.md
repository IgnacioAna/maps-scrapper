# Phase 30: GATE — Cierra la llamada, define el próximo paso - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning
**Mode:** Decisiones tomadas por el orquestador a pedido explícito del user
("terminá todo lo que planificamos, hacelo"), fundadas en R1-R8 y en el
research del milestone.

<domain>
## Phase Boundary

No se puede cerrar una disposición de llamada sin que el lead quede con un
próximo paso o con un estado terminal explícito. Cada resultado llega con una
propuesta ya cargada que el user acepta con un click o edita, y al guardar el
sistema le dice **a dónde se fue el lead**.

Requirements: GATE-01, GATE-02, GATE-04.
(GATE-03, el calendario, ya salió en la Phase 28.)

</domain>

<decisions>
## Implementation Decisions

### Dónde vive el gate

- **D-01 — Defensa en dos capas, no un bloqueo frágil.**
  - **Frontend**: no se puede confirmar una disposición sin que haya un
    próximo paso definido o un estado terminal elegido. El user siempre
    decide explícitamente.
  - **Backend**: si llega una disposición sin `nextAction` y el outcome no
    es terminal, el servidor **asigna el default de D-02** en vez de
    rechazar. Nunca devuelve 400 por esto.
  - Motivo del backend permisivo: `_applyCallOutcome` lo comparte el webhook
    del agente de voz (v3.0 parkeado). Un 400 ahí rompería al agente cuando
    se reactive. Y para el objetivo real del user —que ningún lead quede
    flotando— garantizar un default es MÁS fuerte que rechazar.

### Propuesta por defecto por resultado (GATE-02)

- **D-02 — Mapa outcome → próximo paso propuesto** (editable siempre):

  | Outcome | Próximo paso propuesto | Terminal |
  |---|---|---|
  | `answered_interested` | callback en **+3 días** (`origen:'manual'`) | no |
  | `callback_later` | la fecha que eligió el user | no |
  | `no_answer` / `voicemail` | cadencia +24h (la de siempre) | no |
  | `hung_up` | cadencia +24h, salvo que el tope de 2 cortes lo descarte | no |
  | `placeholder_sent` | esperar respuesta **+48h** | no |
  | `answered_not_interested` | — | **sí** (descartado) |
  | `scheduled_with_admin` | — | **sí** (agendado) |
  | `wrong_number` / `invalid_number` | — | **sí** (descartado) |

- **D-03 — El +3 días del interesado sale del research**, no de la intuición:
  la cadencia sugerida para un interesado que no avanza es día 1, 3, 7, 14.
  Es un default, no una regla: el user lo cambia en el momento con el
  calendario de la Phase 28.
- **D-04 — Los interesados nunca se auto-descartan** (#183). El gate les
  garantiza fecha; el cierre (agendar o descartar) sigue siendo decisión
  humana desde Hoy.

### Feedback al guardar (GATE-04)

- **D-05 — El aviso de destino se vuelve universal.** Hoy `_dispoWhereToast`
  (#181) avisa solo en algunos caminos. Ahora TODA disposición avisa: qué
  lead, a qué vista se fue, y cuándo vuelve. Ej.: «Ambar Dental» sale de la
  cola — vuelve el martes 19/08 en **Hoy → Callbacks**.
- **D-06 — El aviso nombra la vista real**, no una genérica: Hoy →
  Callbacks, Hoy → Interesados, cola de Llamadas, o Descartados. Es la
  respuesta directa al reclamo #1 del user ("lo marco y desaparece").
- **D-07 — En el Power Dialer el aviso NO interrumpe**: ahí ya está el banner
  "✓ Resultado guardado" (#151) y el user elige cuándo avanzar. Se integra
  el destino en ese banner en vez de tirar un toast encima.

### Lo que no cambia

- **D-08 — La disposición obligatoria de la Phase 20 sigue intacta**: el gate
  de "no discar con una llamada sin marcar" y la cola de pendientes son otro
  mecanismo y no se tocan.
- **D-09 — Cero cambios de métricas**: `metrics-consistency` verde sin mover
  un número.

### Claude's Discretion

- Forma exacta del control en la UI (fila de opciones, dropdown, chips) —
  dentro del Design System v1.1.
- Si el aviso de destino es toast, línea inline o ambos según la vista.
- Si el default del interesado se expone como constante configurable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R1-R8
- `.planning/phases/29-next-reloj-unico/29-CONTEXT.md` — el modelo
  `nextAction` (D-01/D-02 de esa fase) sobre el que este gate escribe
- `.planning/phases/29-next-reloj-unico/29-*-SUMMARY.md` — **leer los
  summaries reales de la fase 29**: la API concreta de `nextAction` puede
  haber quedado con nombres distintos a los propuestos
- `.planning/ROADMAP.md` — Phase 30 + reglas transversales
- `CLAUDE.md` — notas #151 (banner del Power Dialer), #181 (toast de
  destino y el fix del botón "Guardando…"), #183 (interesados), #63
  ("Interesado" NO auto-agenda, es intencional)

</canonical_refs>

<code_context>
## Existing Code Insights

### API real del reloj único (verificada en el código tras la Phase 29)

No inventar nombres: esto es lo que EXISTE en `index.js` y está expuesto para
tests. Usarlo tal cual.

- `_setNextAction(lead, spec, nowIso)` — escribe `lead.nextAction` **y espeja
  `lead.callbackAt = nextAction.dueAt`** (D-03). Nunca lanza: coerciona en vez
  de tirar, porque está en el camino de una disposición real y un throw sería
  un 500 en la cara del user mientras llama.
  `spec = {tipo, dueAt, canal, motivo, origen, createdBy}`.
- `_clearNextAction(lead)` · `_leadNextAction(lead)` ·
  `_deriveNextActionFromLegacy(lead)` · `_nextActionTemplateForDelta(deltaMs)`
- Whitelists: `NEXT_ACTION_TIPOS` = `callback` | `cadencia` | `enviar_info` |
  `esperar_respuesta` | `otro`. `NEXT_ACTION_CANALES` = `llamada` | `whatsapp`
  | `email` | `''` (vacío es válido = sin canal). `NEXT_ACTION_ORIGENES` =
  `manual` | `cadencia` | `compromiso`.
  → **`'compromiso'` ya está reservado para la Phase 31**: no agregarlo de
  nuevo ni renombrarlo.
- `NEXT_ACTION_TEMPLATES` — las 5 duraciones (24h/48h/72h/7d/15d). Es la ÚNICA
  fuente: `FOLLOWUP_STEPS` deriva de este array. Los defaults del mapa D-02 que
  coincidan con una duración de la tabla deben usar la plantilla, no un número
  suelto.

### Reusable Assets
- `_dispoWhereToast` (public/app.js) — el aviso de destino ya existe, hay que
  universalizarlo
- `_dispoAfterSaved` — el punto único post-guardado en el frontend
- `window._dtPicker` (Phase 28) — el calendario para editar la fecha propuesta
- `_leadStoreApply` (#105) — centraliza la escritura optimista de estado del
  lead; toda mutación nueva debe pasar por ahí

### Established Patterns
- `_applyCallOutcome` es puro y compartido — extender sin romper la firma
- Los modales de disposición se reusan (reset al abrir, ver fix #181b del
  botón "Guardando…" — NO romperlo)

### Integration Points
- `POST /api/setters/leads/:id/call-disposition` (index.js ~10831)
- `_handleCallDisposition` (public/app.js) — camino de la lista de Llamadas
- `_pdHandleDisposition` (public/app.js) — camino del Power Dialer

</code_context>

<specifics>
## Specific Ideas

El reclamo textual del user: "marco por ejemplo volver a llamar y ese después
se me desaparece, no lo puedo volver a llamar". D-05 y D-06 son la respuesta
directa: el lead sale de la cola (correcto por diseño) pero ahora el sistema
te dice a dónde fue y cuándo vuelve.

</specifics>

<deferred>
## Deferred Ideas

- Que el próximo paso se pre-rellene desde la transcripción con IA: es la
  fase 31 en su versión manual, y la extracción automática quedó fuera del
  milestone a propósito (el research la marca poco confiable en
  condicionales).

</deferred>

---

*Phase: 30-GATE — Cierra la llamada, define el próximo paso*
*Context gathered: 2026-08-14*
