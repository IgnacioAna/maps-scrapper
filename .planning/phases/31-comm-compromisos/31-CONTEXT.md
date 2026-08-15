# Phase 31: COMM — Compromisos como objeto - Context

**Gathered:** 2026-08-15
**Status:** Ready for planning
**Mode:** Decisiones tomadas por el orquestador a pedido explícito del user
("terminá todo lo que planificamos, hacelo"), fundadas en R1-R8 y en el
research del milestone.

<domain>
## Phase Boundary

Los compromisos hablados durante una llamada —"mandame info", "llamame en dos
semanas", "lo hablo con mi socio"— dejan de ser texto libre dentro de una nota
y pasan a ser objetos del sistema con tipo, dueño, canal y fecha, que setean
el próximo paso del lead.

Requirements: COMM-01, COMM-02, COMM-03, COMM-04.

**Esta fase NO manda mensajes.** El botón de WhatsApp y el envío real son la
Phase 32. Acá se construye el registro que ese botón va a alimentar.

</domain>

<decisions>
## Implementation Decisions

### El objeto

- **D-01 — `lead.commitment`**: UN compromiso pendiente por lead (no un
  array), simétrico con `nextAction` y por la misma razón — dos compromisos
  vivos a la vez es el problema de los dos relojes otra vez.
  `{ tipo, parte, canal, dueAt, estado, motivo, callId, createdAt, createdBy }`
- **D-02 — Tipos** (whitelist estricta, patrón `NEXT_ACTION_TIPOS`):
  `enviar_info` · `hablar_con_socio` · `llamar_despues` · `pensarlo` ·
  `pedir_presupuesto` · `otro`.
- **D-03 — `parte`**: `yo` | `prospecto`. **Es la distinción que da valor**:
  - `yo` = tarea propia ("le mando el material"). Si no la cumplo, es mi
    deuda.
  - `prospecto` = expectativa ("me llama el lunes", "lo habla con el socio").
    Si vence sin novedad, dispara MI seguimiento, con el vencimiento como
    motivo visible.
- **D-04 — Estados**: `pendiente` → `cumplido` | `incumplido` | `vencido`.
  `incumplido` se reserva para compromisos del prospecto que no se
  cumplieron: es dato útil para el scoring futuro, no un reproche.

### Cómo se conecta con el reloj único

- **D-05 — Un compromiso pendiente SETEA el `nextAction`** con
  `origen: 'compromiso'` — el valor que la Phase 29 ya dejó reservado en
  `NEXT_ACTION_ORIGENES`. No se inventa un mecanismo paralelo: el compromiso
  es el POR QUÉ, el `nextAction` es el CUÁNDO.
- **D-06 — Mapa tipo → próximo paso** (defaults editables, alineados al
  research):

  | Compromiso | Próximo paso | Canal |
  |---|---|---|
  | `enviar_info` (parte yo) | mandar hoy, y seguimiento a **+48h** si no responde | whatsapp/email |
  | `hablar_con_socio` | seguimiento a **+5 días** | llamada |
  | `llamar_despues` | la fecha pactada | llamada |
  | `pensarlo` | seguimiento a **+3 días** | llamada |
  | `pedir_presupuesto` | seguimiento a **+3 días** | llamada |

- **D-07 — Al cerrar un compromiso se limpia el `nextAction` si venía de él**
  (`origen === 'compromiso'`), y el gate de la Phase 30 pide el siguiente.

### Dónde se carga

- **D-08 — En el modal "Próximo paso" de la Phase 30**, como una opción más:
  el user elige el tipo de compromiso y el sistema propone la fecha del mapa
  D-06. No se agrega un modal nuevo — sumar un segundo paso al cierre de una
  llamada es exactamente la fricción que hace que la gente no lo use.
- **D-09 — También editable desde la ficha del lead**, para cargar o cerrar
  un compromiso fuera de una llamada.

### La vista de consulta (COMM-04)

- **D-10 — Sección "Compromisos" dentro de Hoy**, no una vista nueva. Muestra
  los pendientes agrupados por parte (los míos primero: son deuda propia) con
  su fecha y el lead. Responde la pregunta textual del user: "a quién le mandé
  información y qué falta responder".
- **D-11 — El historial de compromisos cerrados vive en el timeline del
  lead**, no en una lista aparte. Un compromiso cumplido es contexto, no una
  tarea.

### Fuera de alcance (explícito)

- **D-12 — Nada de extracción automática desde la transcripción.** El research
  es claro: la IA falla justo en los condicionales ("cuando vuelva de
  vacaciones", "lo hablo con mi socio"), que es la casuística del user.
  Diferido, no descartado.

### Claude's Discretion

- Nombres internos de helpers y la forma exacta del control en el modal.
- Si `commitment` se guarda plano en el lead o dentro de `nextAction`
  (preferencia: plano, para que el historial sobreviva al consumo del reloj).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R1-R8
- `.planning/phases/29-next-reloj-unico/29-CONTEXT.md` + sus SUMMARY — la API
  real de `nextAction` (`_setNextAction`, `_clearNextAction`,
  `NEXT_ACTION_ORIGENES` con `'compromiso'` ya reservado)
- `.planning/phases/30-gate-proximo-paso/30-*-SUMMARY.md` — **leerlos**: el
  modal "Próximo paso" (`#call-next-modal`), `_dispoDestination` y
  `_dispoAnnounce` son de la fase 30 y esta fase los extiende, no los
  reemplaza
- `.planning/ROADMAP.md` — Phase 31 + reglas transversales
- `CLAUDE.md` — reglas del proyecto (mutex, cache-buster, rutas Express)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_setNextAction(lead, spec, nowIso)` — el compromiso escribe acá con
  `origen:'compromiso'`. Ya espeja `callbackAt` solo.
- `#call-next-modal` + `_dispoAnnounce` + `_dispoDestination` (Phase 30) — el
  punto donde se suma la carga del compromiso y donde el aviso de destino
  debe mencionarlo
- `window._dtPicker` (Phase 28) — calendario para editar la fecha propuesta
- `ensureLeadDefaults` — donde se inicializa `commitment`
- `mutateSettersData` — mutex obligatorio

### Established Patterns
- Whitelists estrictas de strings para todo campo enumerado
- Tests puros extrayendo bloques por marcadores (fases 28-30)
- Defaults del lead en `ensureLeadDefaults`, aplicados por `loadSettersData`

### Integration Points
- `POST /api/setters/leads/:id/call-disposition` — donde se carga el
  compromiso al cerrar una llamada
- `loadHoyView` (public/app.js) — donde va la sección de consulta (D-10)
- El timeline del lead (Phase 17 Ola 4) — donde aparecen los cerrados

</code_context>

<specifics>
## Specific Ideas

Pedido textual del user: *"cuando digo le mando mensaje, mando información
ahí al número que ponga… saber que esa persona ya le mandé información y le
puedo hacer el seguimiento"*. D-10 es la respuesta a la primera mitad; la
segunda (mandar de verdad) es la Phase 32.

</specifics>

<deferred>
## Deferred Ideas

- Extracción automática de compromisos desde el resumen IA de la llamada,
  como borrador que el user confirma (D-12).
- Scoring del lead a partir de compromisos incumplidos.

</deferred>

---

*Phase: 31-COMM — Compromisos como objeto*
*Context gathered: 2026-08-15*
