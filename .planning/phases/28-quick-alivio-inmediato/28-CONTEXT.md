# Phase 28: QUICK — Alivio inmediato - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Dos mejoras de pura interfaz que NO dependen del modelo de datos y por eso
se adelantaron al resto del milestone v4.0 (decisión del user): (1) un
calendario propio para elegir fechas sin contar días a mano, y (2) los
paneles de llamada arrastrables. Cero backend: no toca `_applyCallOutcome`,
ni `setters.json`, ni métricas. Se deploya sin migración de datos.

Requirements: **GATE-03** (calendario) y **DIAL-05** (panel arrastrable),
adelantados desde sus fases originales.

</domain>

<decisions>
## Implementation Decisions

### Calendario — dónde y cómo

- **D-01 — Va en los 5 lugares** donde hoy hay `<input type="datetime-local">`,
  como UN solo componente reutilizado:
  - `#call-cb-fecha` (modal "Volver a llamar" — el que motivó el pedido)
  - `#call-sched-fecha` (modal agendar reunión desde llamada)
  - `#agendar-fecha` (modal agendar, index.html ~3528)
  - `#call-ph-fecha` (hold de calendario por mail)
  - `#schedule-datetime` (mensaje programado, index.html ~735)
- **D-02 — Popover, no inline**: el campo de fecha queda compacto y el
  calendario se abre al tocarlo. El modal no crece.
- **D-03 — Hora por franjas + ajuste fino**: botones de horas laborales
  típicas (09:00…19:00) + campo para afinar minutos. El caso común es un
  click; el caso raro sigue siendo posible.
- **D-04 — Etiqueta relativa SOLO al confirmar**: al elegir queda fijo algo
  como "Martes 18/08 · en 4 días · 10:00". El user eligió explícitamente NO
  mostrar "faltan N días" sobre cada día del calendario (hover) — más limpio.
- **D-05 — Los atajos rápidos quedan AFUERA, como están**: los botones
  existentes (`#call-cb-quickpicks`: Mañana 9am, En 2 días…) siguen siendo
  un click directo sin abrir el calendario. El calendario cubre lo que los
  atajos no.

### Calendario — información adicional (pedida por el user)

- **D-06 — Hora local del lead visible, SIN avisos**: al elegir la hora se
  muestra la equivalencia en el huso del lead ("= 07:00 de él"). El user
  eligió explícitamente NO marcar en ámbar horas malas — solo mostrar, él
  decide. Si el lead no tiene país, no se muestra nada. Reusar la lógica de
  hora local que ya usa el Power Dialer (`_leadLocalTime`, CLAUDE.md #84).
  En los puntos de entrada sin lead asociado (p.ej. `#schedule-datetime` si
  aplica), simplemente no se muestra.
- **D-07 — Carga por día en el calendario**: cada día del mes muestra un
  numerito con cuántos compromisos ya tiene: **callbacks manuales +
  reuniones agendadas**. Los reintentos automáticos de la cadencia
  (no_answer/voicemail) NO cuentan — son ruido que se acomoda solo. Sirve
  para repartir promesas en vez de amontonarlas.

### Paneles arrastrables

- **D-08 — Los DOS paneles se arrastran**, cada uno por su lado:
  `#telnyx-call-panel` (principal: timer/mute/colgar) y
  `#telnyx-script-panel` (guiones + ficha + Mercury).
- **D-09 — Agarre desde la barra de arriba** (header del panel). Patrón de
  ventana clásico; no interfiere con botones, textos ni scroll interno.
- **D-10 — La posición se recuerda PARA SIEMPRE** (localStorage, por panel),
  con un botón visible para volver al centro si el panel queda fuera de
  vista (p.ej. cambió la resolución).
- **D-11 — El empuje automático sobrevive SOLO si nunca lo moviste**: la
  regla CSS `body.tlx-script-open #telnyx-call-panel` (index.html:1461) que
  corre el panel principal al abrir guiones sigue activa mientras no haya
  posición guardada. Apenas el user arrastra un panel, su posición manda y
  el empuje deja de aplicarle. Resolver JUNTO con el arrastre — si el CSS
  con `!important` pisa el estilo inline del drag, el panel "salta" solo
  después de acomodado (el bug anticipado en el roadmap).

### Claude's Discretion

- Diseño visual del calendario (grilla del mes, navegación entre meses,
  estilo de las franjas) — dentro del Design System v1.1 de la app (tokens
  `--accent`, `--bg-surface`, etc.).
- Clamping del drag (que el panel no pueda quedar 100% fuera del viewport).
- Cómo obtener la carga por día (D-07): los datos ya están en el cliente o
  a un fetch de distancia — elegir lo que no agregue latencia perceptible
  al abrir el popover.
- Detalles de accesibilidad del popover (Esc para cerrar, click afuera).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos del milestone (fuente de verdad)
- `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` — R7
  (calendario) y R8 (panel movible) dichos por el user; si algo contradice
  este CONTEXT, gana ese archivo
- `.planning/ROADMAP.md` — Phase 28, criterios de éxito 1-5

### Estado del código
- `.planning/research/2026-08-13-estado-seguimiento-para-investigar.md` —
  mapa del flujo de llamadas/seguimiento actual
- `CLAUDE.md` — notas #84 (hora local del lead `_leadLocalTime`), #114
  (gotcha del preview con CSS transitions congeladas), #48/regla de
  cache-buster (obligatorio al tocar app.js/index.html/style.css)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_leadLocalTime()` (app.js) — país→IANA tz, ya calcula hora local del
  lead para el chip 🕐 del Power Dialer. Base de D-06.
- Quickpicks existentes: `#call-cb-quickpicks` (render en app.js ~10177,
  `.cb-quickpick`) y `#call-ph-quickpicks` (~10117, `.ph-quickpick`) — se
  conservan intactos (D-05).
- Helper de formato datetime-local sin timezone (app.js ~10240, Sprint 23)
  — el calendario nuevo debe producir el mismo formato hacia el resto del
  código para no tocar los handlers de guardado.
- Design System v1.1 (style.css): tokens, `.seg-control`, `.dialpad-key`
  como referencia de componentes propios ya construidos.

### Established Patterns
- Los 5 inputs `datetime-local` viven en modales ya cableados — el
  calendario REEMPLAZA el widget de elección pero el value final que leen
  los handlers (`#call-cb-confirm`, etc.) debe seguir siendo el mismo
  formato. Cambio de superficie, no de plomería.
- Posicionamiento de paneles: `position:fixed` + `transform:translate` con
  animaciones de entrada (`tlxScaleIn`/`tlxSlideIn`, index.html ~1190 y
  ~1317). El drag va a convivir con esas animaciones de apertura.
- `body.tlx-script-open` se togglea en app.js ~8994/~9838/~9845 — los 3
  puntos a revisar para D-11.
- localStorage con clave por usuario (`patrón `pd_autopilot_<userId>`,
  `calls_setter_filter_<userId>`) — usar el mismo patrón para la posición
  de paneles.
- Cache-buster: bump obligatorio en index.html al tocar app.js/style.css.

### Integration Points
- Modal callback: `#call-cb-fecha` + botón `#call-cb-confirm` (reset del
  botón arreglado en #181b — no romper ese fix).
- Carga por día (D-07): callbacks manuales viven en los leads ya cargados
  en cliente (`callbackAt` + último outcome `callback_later`); reuniones en
  `/api/setters/calendar`. Evaluar qué hay ya en memoria en cada punto de
  entrada.

</code_context>

<specifics>
## Specific Ideas

- El mal momento exacto que motivó el calendario: "me tengo que estar
  contando los días, a ver cuánto falta para tal día". La etiqueta al
  confirmar (D-04) es la respuesta directa a eso.
- El mal momento exacto del panel: "quiero ver algo que hay detrás de eso
  que me tapa, está fijo, no lo puedo mover".
- El user usa MUCHO el Power Dialer — el panel de llamada es su ambiente de
  trabajo principal. La posición recordada (D-10) vale más ahí que en
  ningún otro lado.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Las dos ideas que surgieron
en la exploración extra —hora local del lead y carga por día— se
incorporaron como D-06 y D-07 por decisión del user, no se difirieron.)

</deferred>

---

*Phase: 28-QUICK — Alivio inmediato*
*Context gathered: 2026-08-14*
