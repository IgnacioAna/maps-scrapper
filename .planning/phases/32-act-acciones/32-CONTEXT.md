# Phase 32: ACT — Acciones desde cualquier vista - Context

**Gathered:** 2026-08-15
**Status:** Ready for planning
**Mode:** Decisiones del orquestador a pedido explícito del user ("terminá
todo lo que planificamos, hacelo"), fundadas en R4/R5 del relevamiento.

<domain>
## Phase Boundary

Los dos botones que el user reclamó explícitamente, disponibles desde
CUALQUIER vista donde aparezca el lead: **mandar WhatsApp** (con soporte de
número alternativo, y dejando registro) y **descartar** (que lo saque de
todas las listas de una).

Requirements: ACT-01, ACT-02, ACT-03, ACT-04, ACT-05.

**Esta fase es la más visible del milestone.** El user ya reclamó una vez
que "faltaban un montón de cosas" y nombró estos dos botones primero.

</domain>

<decisions>
## Implementation Decisions

### El botón de WhatsApp

- **D-01 — Las 4 superficies**: lista de Llamadas, Power Dialer, ficha
  expandida del lead, y Hoy. En todas el mismo componente, no cuatro
  implementaciones.
- **D-02 — Abre `wa.me` con el mensaje precargado**, en pestaña nueva. NO
  se manda automáticamente: manda el user desde su WhatsApp. Decisión ya
  cerrada con él — wa-multi queda fuera de esta fase.
- **D-03 — Un solo acto: mandar Y registrar.** El mismo click abre el chat
  y deja el evento + el próximo paso. Si son dos acciones separadas, la
  segunda no se hace nunca — ese es exactamente el problema que hoy tiene.
- **D-04 — El registro es OPTIMISTA y honesto**: se anota "abrí el chat
  para mandar X", no "el mensaje fue entregado". `wa.me` no devuelve
  confirmación y el registro no puede mentir sobre eso.
- **D-05 — Reusa el compromiso de la Phase 31**: el click crea un
  `commitment` de tipo `enviar_info`, parte `yo`, canal `whatsapp`, que a
  su vez setea el `nextAction` (seguimiento a +48h según el mapa D-06 de
  la fase 31). No se inventa un mecanismo nuevo de registro.

### Plantillas de mensaje

- **D-06 — Un set corto de plantillas**, no un editor libre: presentación
  post-llamada, envío de información, y reconfirmación de reunión. El
  cuerpo se interpola con lo que ya existe (`{name}`, `{city}`,
  `{setterName}` — el mismo vocabulario de los guiones de llamada).
- **D-07 — Se guarda cuál plantilla se usó** (`templateId` en el evento),
  para poder medir cuál funciona sin trabajo extra después.
- **D-08 — Nada de nombre de empresa en el texto** (regla vigente del
  proyecto, nota #119: la IA y los mensajes al prospecto nunca nombran la
  marca).

### Número alternativo (ACT-03)

- **D-09 — Se carga en el momento, desde el mismo botón.** Caso real y
  textual del user: *"hay veces que el número que estoy llamando no tiene
  WhatsApp y por ahí me pasan otro"*. El flujo es: click en WhatsApp → si
  no hay número alternativo, ofrece cargarlo ahí mismo → manda a ese.
- **D-10 — El alternativo NO reemplaza al principal**: se guarda aparte
  (ya existe `lead.altPhone` del modal de contacto secundario) y el lead
  sigue discándose por el número original.
- **D-11 — Va en mono con cifras tabulares** (regla de marca), igual que
  el teléfono principal.

### El botón de descartar (ACT-04)

- **D-12 — Mismas 4 superficies** que el de WhatsApp.
- **D-13 — Reusa el endpoint que YA existe** (`bulk` con acción
  `discard`). No se escribe lógica nueva de descarte.
- **D-14 — Pide razón, pero no bloquea**: se ofrece la lista corta de
  razones que ya existe (`DISQUALIFY_REASONS`), con "otro" siempre
  disponible. Sin razón también descarta — un descarte sin motivo es mejor
  que un lead que sigue en la cola porque el formulario era largo.
- **D-15 — Confirmación en un solo paso** (no un modal de dos), y el aviso
  de destino de la Phase 30 dice a dónde fue.
- **D-16 — Visualmente usa el estado bloqueado de marca**: gris atenuado,
  ícono y etiqueta, nunca rojo (`.scm-chip-blocked` / `.scm-row-blocked`
  ya existen).

### Material por email (ACT-05)

- **D-17 — Mismo modelo de evento que WhatsApp**, para que el timeline sea
  uno solo. Reusa el envío que ya existe (`send-placeholder`, Resend).
- **D-18 — Sin tracking de aperturas**: Apple MPP precarga el pixel en más
  de la mitad de los opens; se mediría ruido. Se registra "material
  enviado", no "lo abrió".

### Claude's Discretion

- Forma exacta del control (botón suelto, menú de acciones, split button).
- Dónde vive el catálogo de plantillas (constante en código vs archivo de
  data editable).
- Si el número alternativo se pide en un popover o en el modal existente.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R4
  (botón de mensaje + número alternativo + registro) y R5 (descartar desde
  todos lados). Fuente de verdad.
- `.planning/phases/31-comm-compromisos/31-*-SUMMARY.md` — **leerlos**: el
  objeto `commitment`, sus helpers (`_setCommitment`, `_closeCommitment`) y
  cómo escribe el `nextAction`. Esta fase los CONSUME.
- `.planning/phases/30-gate-proximo-paso/30-*-SUMMARY.md` —
  `_dispoDestination` / `_dispoAnnounce`: el aviso de destino tiene que
  contemplar los estados nuevos.
- `BRAND-SCM.md` + `marca/README.md` — reglas visuales vigentes.
- `CLAUDE.md` — notas #119 (la IA nunca nombra la marca), #57 (bulk de
  acciones de leads), #156 (modal de contacto secundario con `altPhone`),
  #96 (DNC), regla del cache-buster y del mutex.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets — NO reimplementar
- `buildWhatsAppUrl(phone, country, message)` (index.js ~1482) — arma el
  `wa.me` normalizando el prefijo internacional. Ya resuelve los casos
  raros (México, US) que costaron bugs históricos.
- `POST /api/setters/leads/bulk` con `action:'discard'` (index.js ~10020) —
  el descarte ya existe y está testeado.
- `PUT /api/setters/leads/:id/alt-contact` (#156) — ya guarda `altPhone` y
  `email`.
- `_setCommitment` / `_closeCommitment` (Phase 31) — el registro.
- `_dispoAnnounce` / `_dispoDestination` (Phase 30) — el aviso de destino.
- `POST /api/setters/leads/:id/send-placeholder` — el envío por email.
- Marca: `.scm-chip-blocked`, `.scm-row-blocked`, `.btn-accent`,
  `--on-accent`, `.scm-phone`.

### Established Patterns
- Whitelists estrictas para todo campo enumerado.
- `mutateSettersData` para escrituras async.
- Escritura optimista de estado del lead vía `_leadStoreApply` (#105) —
  toda mutación nueva debe pasar por ahí para que los cachés no diverjan.
- Tests puros extrayendo bloques por marcadores (fases 28-31).

### Integration Points
- `renderCallsList` (lista), `_pdRender` (Power Dialer),
  `_callsRenderExpandedPanel` (ficha), `_hoyRenderSection` (Hoy) — las 4
  superficies donde van los botones.

</code_context>

<specifics>
## Specific Ideas

Cita textual del user sobre lo que quiere: *"cuando digo le mando mensaje,
mando información ahí al número que ponga, que también los números que yo
anote, como cuando agrego un número nuevo, que también tenga el botón para
poder mandar por mensaje… y saber que a esa persona ya le mandé información
y le puedo hacer el seguimiento"*.

Y sobre descartar: *"un botón en todos lados para descartar el lead, que
desaparezca de las listas de todos lados, que por ahí es un lead que no es
una clínica"*.

</specifics>

<deferred>
## Deferred Ideas

- Envío automático por wa-multi (decisión cerrada: manda él a mano).
- Detección de respuesta entrante por wa-multi — es lo único que `wa.me` no
  puede dar, y queda anotado para cuando se reactive ese módulo.
- WhatsApp Business Cloud API: recién cuando el volumen supere el envío
  manual o se necesite recibir dentro del sistema.

</deferred>

---

*Phase: 32-ACT — Acciones desde cualquier vista*
*Context gathered: 2026-08-15*
