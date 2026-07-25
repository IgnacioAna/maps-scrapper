# Phase 20: Disposición obligatoria - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Ninguna llamada colgada queda sin resultado marcado. Cierra la fuga
estructural: el registro de llamada (callLog) lo crea SOLO el endpoint de
disposición — sin marcar no hay registro, ni transcript, ni métrica. La
decisión de FONDO ya estaba tomada en el roadmap; esta discusión fijó la
FORMA. El autopiloto y los atajos 1-9 del Power Dialer deben seguir
funcionando (success criterion 3 del ROADMAP).

</domain>

<decisions>
## Implementation Decisions

### Forma del enforcement
- **D-01:** Bloqueo de discado EN VIVO: mientras haya una llamada recién
  colgada sin disposición, no se puede iniciar OTRA llamada — se bloquean
  el botón Llamar (lista y Hoy), el autopiloto, el discado ad-hoc y el
  dialpad. Un banner persistente señala QUÉ llamada falta marcar. Sin
  modal intrusivo que tape la pantalla.
- **D-02:** Las llamadas que escapan al bloqueo en vivo (tab cerrado,
  browser crasheado) van a una cola de pendientes que se muestra al abrir
  el panel como RECORDATORIO NO BLOQUEANTE — una franja visible con "tenés
  N llamadas sin marcar" y acceso rápido para resolverlas, pero la SDR
  puede seguir discando y trabajando. Decisión explícita del user: "el
  criterio lo tiene que manejar el SDR... si no se va a ver muy trabado
  por el sistema para poder tomar decisiones". NO convertir esta cola en
  bloqueo.

### Auto-marca de no-contactos
- **D-03:** Si la llamada nunca llegó a estado 'active' del SDK (nadie
  atendió), el sistema marca "No atendió" (no_answer) automáticamente —
  el SDR solo marca a mano cuando hubo contacto real. El SDR puede
  corregir la auto-marca (p.ej. a Buzón). Esto elimina la mayor parte de
  la fricción del enforcement Y la marca perezosa más común.

### Ventana de 10 min del audio
- **D-04:** La ventana de descarte del audio queda COMO ESTÁ (10 min en
  memoria del browser, [public/app.js:7530](public/app.js:7530)). El
  bloqueo en vivo ya hace que marcar-antes-de-la-próxima sea el flujo
  normal, lo que de por sí salva el transcript. Marcar tarde (>10 min)
  guarda el resultado pero pierde la grabación — aceptado. NO tocar la
  cadena de grabación (costó 8 rondas estabilizarla, ver saga Whisper en
  CLAUDE.md #137/#141/#152/#154/#157-159).

### Llamadas históricas sin marcar
- **D-05:** Arrancar de cero: la regla aplica solo a llamadas nuevas
  post-deploy. Las llamadas viejas sin disposición no tienen registro en
  el sistema (invisibles salvo CDRs de Telnyx) y NO se reconstruyen ni se
  pide marcarlas — sería dato inventado de memoria vieja.

### Anti-disposición falsa
- **D-06:** Auditoría PASIVA, cero fricción extra al marcar:
  - Distribución de resultados por SDR visible para admin/supervisor
    (que un patrón anómalo tipo "95% no atendió con llamadas de 2 min"
    salte a la vista en Equipo o reportes).
  - Cruce automático duración-vs-resultado: una llamada con duración
    >30s marcada como "No atendió" (o inconsistencias equivalentes)
    queda señalada como sospechosa.
  - NO se agregan campos obligatorios ni motivos forzados al marcar
    (la opción de fricción dirigida fue descartada).
  - Nota: la Phase 22 (coaching IA sobre transcripts) complementará esto
    cruzando outcome vs contenido real de la conversación.

### Claude's Discretion
- Mecanismo técnico para que el server sepa que existe una llamada sin
  disposición (registro pendiente al iniciar/colgar llamada, derivación
  de webhooks Telnyx, o estado client-side + sync) — elegir lo más simple
  que soporte D-01 y D-02 y sobreviva un refresh del tab.
- Detalle visual del banner de bloqueo y de la franja recordatorio
  (respetar UI minimalista sin emojis decorativos — preferencia estable
  del user).
- Si el bloqueo aplica igual a admin/supervisor cuando discan (criterio
  sugerido: sí, la regla es de la llamada, no del rol — el admin también
  cold-callea con setter_ignacio).
- Qué pasa con los discados ad-hoc sin lead asociado (botón "Discar
  número"): resolver de la forma más simple coherente con D-01.
- Umbrales exactos del cruce duración-vs-resultado de D-06.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap y reglas del milestone
- `.planning/ROADMAP.md` §Phase 20 — goal, las 4 decisiones (ya resueltas
  acá), success criteria (¡el 2 mide % de disposición contra el callLog!)
  y reglas transversales del milestone v2.0.
- `CLAUDE.md` — reglas del proyecto: cache-buster OBLIGATORIO (esta phase
  toca app.js/index.html), saga Whisper (NO tocar la grabación), notas
  #61 (disposition nota rápida), #78 (autopiloto y atajos), #151 (banner
  "Resultado guardado" + holdCurrent del Power Dialer), #156 (shortcuts
  1-9 sincronizados lista/PD).

### Código existente que define el flujo actual
- `public/app.js` — `_handleCallDisposition` (~8589), `_onTelnyxCallEnded`
  (~8105), `_pendingTelnyxCallMetadata` (~8237), buffer de transcripción
  con ventana de 10 min (~7513-7534), autopiloto `_pd*` (#78/#151).
- `index.js` — endpoint `POST /api/setters/leads/:id/call-disposition`
  (crea el callLog entry; único punto de registro), `telnyx_events.json`
  (webhooks — el server ya sabe de llamadas independientemente del
  callLog).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Power Dialer ya semi-bloquea: banner "✓ Resultado guardado · Siguiente
  lead" + flag `holdCurrent` (#151) — el enforcement en vivo extiende ese
  patrón a la lista de Llamadas, no lo reinventa.
- `_leadStoreApply` mantiene sincronizados los cachés de lista y dialer
  en cada disposición — usarlo para cualquier mutación nueva.
- `_telnyxCallState` ya trackea la llamada activa y su lead; la metadata
  post-cuelgue queda en `_pendingTelnyxCallMetadata`.
- Webhooks Telnyx persistidos en `telnyx_events.json` + CDRs
  (`_telnyxFetchDetailRecords`) — fuentes server-side de "la llamada
  existió" para la cola de pendientes y para medir el % de cumplimiento
  (success criterion 2).

### Established Patterns
- El estado 'active' del SDK Telnyx es la señal confiable de "atendió"
  (los estados terminales reales son hangup/destroy/purge — CLAUDE.md
  bugs del SDK #3).
- Auto-disposición IA ya existe como sugerencia (`_autoDispositionLLM`) —
  distinta de la auto-marca determinística de D-03 (no confundir).
- Tests frontend no existen como patrón — el enforcement UI se verifica
  en preview; endpoints nuevos llevan tests backend (patrón DATA_DIR +
  auth.json pre-import).

### Integration Points
- Bloqueo de discado: gate en `_startTelnyxCall` (cubre lista, Hoy, PD,
  Ctrl+K y ad-hoc en un solo punto) + estado visible en el panel.
- Cola de pendientes: al boot del panel (donde ya se hace fetchConfig de
  Telnyx en background).
- Auditoría pasiva D-06: la distribución por SDR puede derivar del CALL
  METRICS CORE (regla del milestone: JAMÁS re-implementar el funnel).

</code_context>

<specifics>
## Specific Ideas

- El user quiere que el sistema NO se sienta trabado: la única traba dura
  es "marcá la que acabás de cortar antes de discar la siguiente" (1 clic
  con memoria fresca). Todo lo demás es recordatorio y auditoría.
- Trade-off asumido en el roadmap: fricción inmediata para las vendedoras
  a cambio de calidad del dato — pero la fricción se minimizó con D-03
  (auto-marca) y D-02 (cola no bloqueante).

</specifics>

<deferred>
## Deferred Ideas

- Hardening del reporte semanal (WR-01/02/03 del code review de Phase 19)
  — anotado en STATE.md como candidato para Phase 21.
- Cruce outcome-vs-transcript con IA — ya es parte de la Phase 22
  (coaching), no duplicar acá.

</deferred>

---

*Phase: 20-disposicion-obligatoria*
*Context gathered: 2026-07-25*
