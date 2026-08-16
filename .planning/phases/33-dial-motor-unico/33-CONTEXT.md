# Phase 33: DIAL — Power Dialer como motor único - Context

**Gathered:** 2026-08-16
**Status:** Ready for planning
**Mode:** Decisiones del orquestador a pedido explícito del user ("terminá
todo lo que planificamos"), fundadas en R1/R2/R6 del relevamiento.

<domain>
## Phase Boundary

El Power Dialer deja de ser una herramienta aislada. Se lanza sobre un lead
puntual, no expulsa la tarjeta al marcar, comparte estado en vivo con Hoy y
Llamadas, y su ficha muestra el historial de las vendedoras al frente.

Requirements: DIAL-01, DIAL-02, DIAL-03, DIAL-04.
(DIAL-05, el panel arrastrable, ya salió en la Phase 28.)

**Es la herramienta que el user más usa.** Textual: *"el power dialer, me
gusta mucho usarlo, pero no conecta bien con el resto."*

</domain>

<decisions>
## Implementation Decisions

### Entrar al dialer sobre un lead puntual (DIAL-01)

- **D-01 — Botón "Discar acá" en cada lead**, en las mismas 4 superficies
  que la Phase 32 (lista, ficha, Hoy, y la cola del propio dialer). Abre el
  Power Dialer con la cola arrancando en ESE lead, no desde el principio.
- **D-02 — La cola conserva el resto**: el lead elegido pasa a ser el
  actual, y los demás quedan detrás en el orden que ya tenían. No se
  construye una cola de uno solo — el user quiere seguir discando después.
- **D-03 — Reusa el `mode` que ya existe** (`_pd.mode`: `'calls'` |
  `'hoy'` | `'hoy-callbacks'` | `'hoy-interesados'`, nota #179/#180). El
  lead puntual es un punto de entrada, no un modo nuevo.

### No expulsar al marcar (DIAL-02)

- **D-04 — Generalizar el `holdCurrent` que ya existe** (nota #151): hoy
  funciona solo en el dialer de Llamadas y sin autopiloto. Se extiende a
  TODAS las colas (incluidas las de Hoy) y a los outcomes que abren modal
  (callback, no interesado, agendar).
- **D-05 — Con autopiloto encendido se mantiene el avance automático.** Ese
  es su propósito explícito; no se toca.
- **D-06 — El banner de "resultado guardado" incorpora el destino** que la
  Phase 30 calcula (`_dispoDestination`), en vez de un toast aparte.

### Las tres vistas sincronizadas (DIAL-03)

- **D-07 — Una sola escritura, varios lectores.** Ya existe
  `_leadStoreApply` (#105) que mantiene sincronizados los dos cachés
  (`_callsLeadsById` del dialer y `callsLeadsCache` de la lista). Falta que
  **Hoy** también se alimente de ahí — hoy tiene su propio `_hoyState`.
- **D-08 — Refresco sin recargar**: al volver de una vista a otra, la que
  se muestra re-renderiza desde el store en vez de re-fetchear. El fetch
  queda para la carga inicial y para el refresh explícito.
- **D-09 — NO se construye un store reactivo completo.** La nota #105 ya
  advirtió que el rewrite total de los READS es el trabajo riesgoso. Se
  unifica la ESCRITURA y se re-renderiza al mostrar, que es el 90% del
  beneficio con una fracción del riesgo.

### La ficha con el historial al frente (DIAL-04)

- **D-10 — Arriba de todo, antes de que atiendan**: quién trabajó el lead
  antes, qué anotó y en qué quedó. Es el R1 del relevamiento — el historial
  de las vendedoras es un activo, y llamar a un lead trabajado no es una
  llamada en frío.
- **D-11 — Qué se muestra, en este orden**: última disposición y cuándo ·
  quién la marcó · la última nota escrita · el compromiso pendiente si hay
  (Phase 31) · cantidad de intentos previos.
- **D-12 — Si el lead nunca fue trabajado, el bloque no aparece.** Nada de
  un cartel vacío que ocupe lugar en la pantalla más importante.
- **D-13 — El transcript NO se muestra expandido acá.** Ya existe el
  `<details>` expandible de la nota #81; el bloque nuevo es un resumen para
  leer en 3 segundos, no un archivo.

### Claude's Discretion

- Forma exacta del botón "Discar acá" (ícono, texto, posición).
- Cómo se compone el bloque de historial visualmente.
- Si el re-render al mostrar es por evento o por chequeo de versión.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R1
  (historial de las vendedoras), R2 (los 3 problemas del Power Dialer), R6
  (fichas poco prácticas). Fuente de verdad.
- `.planning/phases/32-act-acciones/32-*-SUMMARY.md` — **leerlos**: el
  builder único de botones `_actButtonsHTML` de la Phase 32 es donde se
  suma el botón "Discar acá", y ya resolvió el problema de las 4
  superficies. NO duplicar ese trabajo.
- `.planning/phases/31-comm-compromisos/31-*-SUMMARY.md` — el `commitment`
  que se muestra en el bloque de historial.
- `.planning/phases/30-gate-proximo-paso/30-*-SUMMARY.md` —
  `_dispoDestination` para el banner (D-06).
- `CLAUDE.md` — notas #151 (hold del Power Dialer), #179/#180 (Power Dialer
  en Hoy y por sección), #105 (`_leadStoreApply` y por qué el store
  reactivo total quedó afuera), #81 (transcript expandible), #78
  (autopiloto y atajos).
- `BRAND-SCM.md` — reglas visuales vigentes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets — NO reimplementar
- `_leadStoreApply(id, patch)` (#105) — la escritura unificada ya existe
- `_pd.mode` / `_pd.hoyFilter` / `_pdBuildQueue` / `_pdBuildQueueHoy` — el
  Power Dialer ya soporta varias colas
- `_pd.holdCurrent` / `_pd.holdOutcome` (#151) — el hold ya existe, hay que
  generalizarlo
- `_actButtonsHTML` (Phase 32) — el builder único de botones por lead
- `_dispoDestination` / `_dispoAnnounce` (Phase 30)
- `_callsRenderExpandedPanel` — la ficha que se reusa desde Hoy (#175)

### Established Patterns
- Atajos del dialer: C/S/B/Esc, 1-9, N/A/P (#124). Si se agrega uno, no
  pisar los existentes.
- `mutateSettersData` en backend; `_leadStoreApply` en frontend.
- Cache-buster obligatorio al tocar `public/*`.

### Integration Points
- `renderCallsList`, `_pdRender`, `_callsRenderExpandedPanel`,
  `loadHoyView`/`_hoyRenderSection` — las 4 superficies.
- `_pdStart(mode)` — el punto de entrada del dialer (hoy async, refresca
  antes de armar la cola, nota #172).

</code_context>

<specifics>
## Specific Ideas

Los tres reclamos textuales del user sobre el Power Dialer:
1. *"no puedo ir directamente a usar el power dialer con ese lead"*
2. *"marco por ejemplo volver a llamar y ese después se me desaparece"*
3. *"no conecta bien con el resto"*

Y sobre las fichas: *"están mal, son poco prácticas o poco lindas para
llamar al lead directamente, o capaz que falta información."*

</specifics>

<deferred>
## Deferred Ideas

- Store reactivo multi-vista completo (rewrite de los READS): el trabajo
  grande y riesgoso que la nota #105 dejó explícitamente afuera. D-09 toma
  el 90% del beneficio sin eso.

</deferred>

---

*Phase: 33-DIAL — Power Dialer como motor único*
*Context gathered: 2026-08-16*
