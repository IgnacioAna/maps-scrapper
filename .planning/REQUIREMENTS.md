# SCM — Requirements · Milestone v2.0 "Gestión por excepción"

> Definidos 2026-07-25. Los requirements de v1.x (bloques WAM-*, PNL-*,
> A-*..E-*, F-*) quedaron superseded — lo shippeado está resumido en
> `MILESTONES.md` y detallado en `CLAUDE.md`.

**Regla transversal:** toda métrica nueva DERIVA del CALL METRICS CORE
(`globalThis.__callCore`, index.js ~5620) — jamás re-implementar el funnel
inline. `tests/metrics-consistency.test.js` es la garantía.

---

## v2.0 Requirements

### REP — Reportes automáticos

- [x] **REP-01**: El cron del reporte semanal corre sin crash y sin
  duplicados. Fix del `now` sin declarar (index.js:1861, :1870 →
  `new Date(nowTs)`) + test de regresión del cron (día/hora/TZ de
  negocio/anti-duplicado) — hoy no existe ninguno. *(19-01 fix +
  19-02 tests, 2026-07-25)*
- [x] **REP-02**: El reporte sale a múltiples destinatarios configurables
  (lista, no un solo `ADMIN_EMAIL`). Resend ya acepta array en `to`.
  *(REPORT_EMAILS CSV, 19-01 + tests 19-02, 2026-07-25)*
- [x] **REP-03**: El semanal no muestra acumulados históricos bajo un
  encabezado que dice "semana" (index.js:1821) — corregir la sección
  WhatsApp o quitarla (hoy el embudo WSP está en cero de punta a punta).
  *(sección WSP eliminada, data del CALL METRICS CORE, 19-01 + tests
  19-02, 2026-07-25)*
- [x] **REP-04**: Existe el reporte diario (`buildDailyReportData()` — hoy
  todas las ventanas son de semana ISO) con SOLO métricas con señal:
  **llamadas · atendidas · minutos hablados · última actividad**.
  Excepciones arriba (primera línea = quién no trabajó hoy), comparación
  vs ayer, nombres de pila. Nada de métricas en cero (agendados/shows/
  deals quedan fuera hasta que tengan datos).
  *(21-01, 2026-07-26 — derivado del CALL METRICS CORE; "última actividad"
  vive en la línea de escalada por D-25)*
- [ ] **REP-05**: Builder de **texto plano** para WhatsApp según el molde
  acordado (sin tablas, sin alineación monoespaciada — se rompe en
  celular; lo importante en las primeras 2 líneas por el preview de la
  notificación). El molde se valida con el user leyéndolo en su celular
  con datos reales ANTES de fijarlo.
  *(builder HECHO en 21-01, 2026-07-26 — `buildDailyReportText`, verificado
  contra el snapshot de producción del 22/07; el molde corto del SEMANAL
  (`buildWeeklyReportTextShort`, D-20) se sumó en 21-03 y coincide línea por
  línea con el texto que el user aprobó. Queda abierto SOLO el paso de
  validación del user en su celular → plan 21-07)*
- [ ] **REP-06**: El reporte llega al **grupo de WhatsApp** de los 3
  socios. Primera tarea: prueba en vivo del JID de grupo contra el
  handler existente (verificado en código: usa deeplink
  `web.whatsapp.com/send?phone=` → casi seguro falla). Plan B: repack de
  wa-multi con envío a grupo (búsqueda por nombre + typing OS-level;
  `out/` ES el source, NUNCA `npm run build`). Plan C: 3 DMs
  individuales (funciona hoy). Plan D: solo email.
  *(las dos mitades están CONSTRUIDAS: transporte del desktop en 21-05
  (Plan B, con Plan C como fallback automático) y cola/emisión del server en
  21-02. 21-04 sumó la superficie de panel: el bloque "Reporte diario ·
  WhatsApp" del Centro de Comando muestra el estado del canal y el botón
  **"Mandar ahora"** dispara el envío sin esperar a las 23:00 — es el disparador
  de la prueba. Queda abierto SOLO el primer envío real al grupo → plan 21-07)*
- [x] **REP-07**: Fallback a email si la desktop está offline, con guard
  de alcanzabilidad (`isUserOnline`) ANTES de emitir — `sendToUser`
  (src/wa/gateway.js) devuelve `true` con room vacía; no confiar en él.
  *(21-02, 2026-07-26 — el guard corre antes de emitir y `sendToUser` no se usa
  como señal de éxito en ningún punto: el item queda `pending` y reintenta. El
  fallback a email quedó CANCELADO por D-04 (cableado y apagado:
  `config.backupEmails` se persiste sin lector); lo que sí sale ante grupo no
  encontrado son DMs individuales, D-02)*
- [x] **REP-08**: Cola de reportes pendientes persistida en `DATA_DIR`:
  guard por **período cubierto** (no "hace cuánto mandé"), consolidación
  (N diarios pendientes → 1 solo mensaje acumulado con detalle por día en
  una línea), expiración de diarios (propuesta 3 días — confirmar con el
  user), el semanal nunca se consolida ni expira, espaciado 30-60s entre
  mensajes distintos (NO aplicar caps de warming — es un grupo propio, no
  outreach frío). Copiar el patrón de `scheduledMessagesTick`
  (index.js:5126), NO reusar el módulo (atado a leadId/setterId).
  *(21-02, 2026-07-26 — todo en `reports.json` (sin archivo nuevo): guard por
  período cubierto sobre `queue`+`history`, consolidación con una línea por día,
  expiración a 3 días con el semanal exento, espaciado por "un solo envío en
  vuelo" + tick de 60s. Se copió el esqueleto de `scheduledMessagesTick` PERO se
  eliminó su `status='sent'` optimista: el item queda `sending` hasta el
  resultado correlacionado por `queueId`. 26 tests)*
  *(21-03, 2026-07-26 — los dos crons escriben además el período cubierto en
  `dailyState`/`weeklyState` con un guard gemelo en memoria (WR-03): un fallo de
  escritura del Railway Volume ya no puede re-mandar. Una prueba manual
  (`send-now`, `kind:'custom'`) NUNCA consume el período del automático)*
- [x] **REP-09**: El reporte incluye **solo las vendedoras nuevas** —
  `setter_ignacio` y `setter_paula_kroff` fuera. Reusar
  `ADMIN_ONLY_SETTER_IDS` (index.js:5588) + `_filterSettersVisible`
  (index.js:5609); no escribir un filtro nuevo.
  *(21-01, 2026-07-26 — `_SUPERVISOR_EXCLUSION_SET` + `_filterSettersVisible`,
  sin filtro nuevo; los setters `hidden` también quedan fuera)*
- [x] **REP-10**: El sesgo del canal manual (78 llamadas `channel='manual'`
  sin `duration` → nunca cuentan como conversación) y las ~15 llamadas sin
  atribuir (users borrados, intencional) se manejan explícitamente en el
  reporte (separar canales o anotar la limitación) — no se ocultan ni se
  dejan cuadrar mal en silencio.
  *(21-01, 2026-07-26 — línea "N llamadas cargadas a mano — sin minutos"
  (solo con 5+ o >10% del día) + "N llamadas sin atribuir"; se suma la línea
  de discadas sin marcar por nombre, D-23)*

### DISP — Disposición obligatoria

- [ ] **DISP-01**: Marcar la disposición de cada llamada es obligatorio.
  La forma exacta se resuelve en discuss-phase (modal bloqueante que no
  deja discar la siguiente vs cola de pendientes al inicio de sesión vs
  ambas) — la decisión de fondo ya está tomada por el user.
- [ ] **DISP-02**: Las llamadas ya colgadas sin marcar al momento de
  activar la regla tienen un tratamiento definido (no quedan en limbo).
- [ ] **DISP-03**: El enforcement no empuja a marcar cualquier cosa para
  sacárselo de encima (una disposición falsa contamina más que un hueco:
  el hueco se ve, el dato falso no). Respeta la ventana de 10 minutos del
  audio (public/app.js:7530): diferir la disposición pierde el transcript
  de esa llamada — el diseño debe tenerlo en cuenta.

### COACH — Coaching por vendedora *(DIFERIDO a backlog 2026-08-01 — milestone v3.0 lo desplaza; se retoma post-piloto del agente)*

- [ ] **COACH-01** *(gate de la phase)*: Verificar en producción que la
  ronda 8 de Whisper (boost del canal del cliente, commit `a9e4886`)
  recuperó los turnos perdidos: leer `transcript.asrDebug` +
  `recMeta.leadActivePct` de llamadas posteriores al 25/07 ANTES de
  automatizar el análisis. Si el canal del cliente sigue a medias, el
  analizador puntuaría con confianza sobre diálogos incompletos. ⚠️ NO
  reintroducir `WHISPER_PROMPT` (falló 2 veces; marca en index.js:14378).
- [ ] **COACH-02**: El análisis de coaching (`/analyze`, index.js:13678)
  se dispara automáticamente post-transcripción, en el mismo hook donde
  ya corre `_autoDispositionLLM` (index.js:14525). Respeta el cache
  existente (`call.mercuryAnalysis`) para no re-cobrar.
- [ ] **COACH-03**: Endpoint de agregación de `mercuryAnalysis` por
  `setterId` y período: promedio de `score`, % de `passedOpener`,
  `ruleViolations` más frecuentes, patrón de `biggestMistake`.
- [ ] **COACH-04**: Cola semanal de 3-5 llamadas concretas a escuchar
  (nombre, fecha, motivo devuelto por el análisis) — entra como sección
  del reporte semanal. Es el P0 #6 de la Phase 12
  (`.planning/phases/12-sdr-operating-system/PLAN.md` — leerlo antes de
  planificar, no re-derivar decisiones ya tomadas ahí).
- [ ] **COACH-05**: Tests del subsistema de análisis — hoy es el único
  subsistema grande del repo sin un solo test, y es la capa que juzga el
  trabajo de personas reales.
- [ ] **COACH-06**: Decisión a levantar en discuss-phase: ¿las vendedoras
  ven su propio análisis? (hoy admin/supervisor only — un scorecard que
  la evaluada no puede ver es vigilancia; uno que sí, es coaching).

### ALERT — Notificación por excepción *(DIFERIDO a backlog 2026-08-01 — ídem COACH)*

- [ ] **ALERT-01**: Las alertas `high` que ya calcula team-performance
  (index.js:9772 — drop %, inactividad, apertura baja, never_touched) se
  notifican de verdad (WhatsApp por el canal de REP-06/07, o email
  inmediato/digest) — hoy solo pintan pantalla.
- [ ] **ALERT-02**: Anti-spam/dedupe — la misma alerta no se notifica
  todos los días; estado persistido de qué se notificó y cuándo.
- [ ] **ALERT-03**: Cada tipo de alerta tiene un responsable definido de
  los 3 socios (a decidir con el user en discuss-phase). Un grupo de tres
  que ve la misma alerta y asume que otro va a actuar es peor que una
  sola persona notificada.

---

## v3.0 Requirements — Agente de voz (definidos 2026-08-01)

> Contexto completo en `.planning/research/2026-08-01-agente-voz-retell.md`
> y en los `*-CONTEXT.md` de las phases 24-27.
> **Regla transversal:** el agente alimenta el MISMO circuito que una SDR
> humana (callLog → `_applyCallOutcome` → cadencia → funnel → biblioteca).
> Cero circuito paralelo de métricas; todo deriva del CALL METRICS CORE.

### VOICE — Integración y agente

- [x] **VOICE-01**: Config Retell con patrón env>JSON de Telnyx
  (`RETELL_API_KEY` + `RETELL_WEBHOOK_SECRET` como env vars que bloquean
  edición desde panel; `retell_config.json` para `agentId`, `fromNumberId`,
  `dailyCap`, `enabled`). Sumado a BACKUP_FILES, export-data, import-data,
  seedVolumeFromRepo y pre-deploy (regla #21 — sin esto un redeploy lo
  pierde). Endpoints `GET/PUT /api/retell/config` admin-only.
- [x] **VOICE-02**: La cascada de dispositions (index.js:10552-10675:
  switch de outcomes + calendarEntry + DNC + cadencia) extraída a helper
  puro `_applyCallOutcome(data, lead, logEntry, opts)` usado por el handler
  humano Y por el webhook del agente. **Paridad exacta**: la suite completa
  (`metrics-consistency` 19 tests + `call-cadence` + `disposition-dnc` +
  `funnel-close`) verde sin cambios de números. Resuelve la deuda M1 del
  audit 2026-06-20.
- [x] **VOICE-03**: `POST /api/admin/voice-agent/dispatch` (admin):
  `{country, count}` → selecciona SOLO leads de `setter_agente_ia` que pasan
  `_leadIsCallableNow` (DNC/tarifa roja/muertos/callbacks futuros ya
  excluidos), cap por `dailyCap`, orden por prioridad, y por cada uno llama
  `POST /v2/create-phone-call` de Retell con `from_number` (caller ID
  server-side: portar `pickNumberForDestination` de app.js:2270 a index.js,
  índice de rotación en el JSON, no localStorage) + `override_agent_id` +
  `retell_llm_dynamic_variables` (nombre, ciudad, reviews, years,
  doctor_name, openingAngle/hookPhrase, leadId, whatsapp de retorno).
- [x] **VOICE-04**: `POST /api/retell/tool/book` — tool HTTP del agente,
  protegido por header `x-scm-tool-secret`. Crea calendarEntry con el shape
  de index.js:10607 (`calendarioEstado:'pendiente'`,
  `setterId:'setter_agente_ia'`, `sourceCall:true`) dentro de
  `mutateSettersData`, marca booked-pending y devuelve texto confirmable en
  voz alta. El outcome `scheduled_with_admin` lo aplica el webhook (una sola
  escritura de callLog por llamada).
- [x] **VOICE-05**: `POST /api/retell/webhook` — firma `x-retell-signature`
  verificada (patrón del webhook Telnyx: rawBody en el verify de
  express.json index.js:108-118, 401 con contador, **fail-closed 503 en
  producción sin secret**, FIFO `retell_events.json` cap 1000). En
  `call_analyzed`: resuelve leadId, arma logEntry (`channel:'retell'`,
  `by:''` → atribución a `assignedTo` por criterio #149, duration,
  fromNumber, cost estimado `_estimateTelnyxCost`), mapea transcript de
  Retell a `{segments:[{speaker:'setter'|'lead',start,end,text}]}` (la
  biblioteca/resumen/análisis existentes lo consumen sin cambios), decide
  outcome (booked→scheduled_with_admin; no conectó→no_answer/voicemail;
  conectó sin agendar→Post Call Data Extraction de Retell +
  `_autoDispositionLLM` fallback) y aplica `_applyCallOutcome` dentro de
  `mutateSettersData`. La extraction (nota_seguimiento, callback_fecha_hora,
  doctor_name, recepcionista_nombre, objecion) persiste en notes[]/callbackAt/
  lead.doctor.
- [x] **VOICE-06**: Pseudo-SDR `setter_agente_ia` ("Agente IA") sin user
  vinculado, NO hidden: fila comparable en Equipo/Comando/Mi rendimiento/
  Distribución sin tocar ninguna métrica (la atribución cae sola por
  assignedTo). Lote piloto se asigna con `pool-distribute` existente.
- [ ] **VOICE-07**: Sección "Agente de voz" en el panel (admin): estado de
  config (locks 🔒 env-sourced), armado de lote (cantidad, país, filtro
  con/sin `lead.doctor`), botón de disparo con confirmación de gasto
  estimado, llamadas de hoy del agente y últimos resultados. Cache-buster
  bumpeado.
- [ ] **VOICE-08**: Entregable "agente cargable": documento con el
  Conversational Flow Rigid de 9 nodos (global prompt + prompt por nodo +
  transiciones por ecuación + variables + Post Call Data Extraction +
  settings de voz/interrupción por nodo + config de la tool book) derivado
  de los guiones oficiales, listo para que el user lo cargue en el
  dashboard de Retell. Incluye las reglas duras (sin precios, sin stack,
  esquive-IA, DNC) y la secuencia de objeciones 1ª-doblar/2ª-Miyagi/
  3ª-salida-90d.
- [ ] **VOICE-09**: Piloto ejecutado: trunk Telnyx↔Retell configurado
  (guía paso a paso en docs/), números importados, llamada de prueba al
  user OK (voz elegida entre 3 candidatas en español), lote real en México
  con transcripts en la biblioteca y fila del agente en Equipo. Métricas de
  cierre del piloto: % atención, % pasa gatekeeper, % conversación ≥30s,
  agendas/callbacks, costo por conversación (CDR + factura Retell) vs
  baseline humano del Comando.
- [ ] **VOICE-10**: Banco de conocimiento unificado: oferta/6 fugas/casos/
  calificación/objeciones consolidados en una fuente que actualiza system
  prompt del asistente, Banco de Respuestas (FAQs de objeciones v2) y
  material del Centro de Entrenamiento (incluye playbook de los 5 cursos
  para SDRs humanas). Verificar y reflejar el estado real de proveedores IA
  (user reporta: solo OpenAI; Mercury/Qwen fuera).

---

## v4.0 Requirements — Seguimiento bajo control (definidos 2026-08-13)

> **Fuente de verdad**: `.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md`
> (R1-R8, dichos por el user). Si algo acá lo contradice, gana ese archivo.
> Estado actual del código: `2026-08-13-estado-seguimiento-para-investigar.md`.
>
> **Contexto**: se disolvió el equipo. Ignacio trabaja solo con 4.133 leads,
> ~52 en seguimiento activo, 12 de 16 callbacks vencidos, interesados con 21
> días de mediana sin avanzar.
>
> **Restricción transversal**: el invariante "todo lead activo tiene próxima
> acción" aplica **solo a leads ya tocados** (137 hoy), nunca al stock virgen
> (3.699). El `_applyCallOutcome` que se toca acá es el mismo que consume el
> webhook del agente de voz (v3.0 parkeado) — mantener el helper puro y su
> paridad con `metrics-consistency`.

### NEXT — Próxima acción única

- [x] **NEXT-01**: Cada lead tiene a lo sumo un objeto `nextAction`
  (`{tipo, dueAt, canal, motivo, origen}`) que representa el único
  compromiso de volver a tocarlo.
- [x] **NEXT-02**: `callbackAt` pasa a ser un caso de `nextAction`
  (tipo=callback) sin perder el comportamiento vigente de la cadencia
  automática de no-contacto ni de los callbacks manuales.
- [x] **NEXT-03**: El sistema viejo de `followUps` (24h/48h/72h/7d/15d) deja
  de existir como reloj paralelo; sus pasos sobreviven como plantillas de
  `dueAt`. Los 3 leads que hoy lo usan migran sin perder historia.
  (29-03: write-path programa `nextAction` al tildar, read-path deriva de
  `_leadNextAction` — `lead.followUps` dejó de ser fuente de verdad de
  cualquier vista. Un lead legacy con `followUps` activo ya responde igual
  que uno migrado vía `_deriveNextActionFromLegacy`, sin esperar al backfill;
  la migración explícita de los 3 leads restantes — para que dejen de
  DEPENDER de la derivación — corre en 29-04.)
- [x] **NEXT-04**: Toda disposición nueva consume el `nextAction` pendiente
  (regla vigente que hay que preservar: evita callbacks viejos clavados
  arriba de la cola).

### GATE — Cerrar la llamada define el próximo paso

- [x] **GATE-01**: No se puede cerrar una disposición sin definir un
  `nextAction` o marcar un estado terminal. Un lead con interés declarado no
  puede quedar sin fecha.
- [x] **GATE-02**: Cada resultado de llamada propone un próximo paso por
  defecto, editable (interesado, "mandame info", "llamame en X").
- [ ] **GATE-03**: Al programar una fecha, se ve un calendario real con el
  mes a la vista y etiquetas relativas ("en 3 días", "el martes"), sin tener
  que contar días a mano. Conserva los atajos rápidos existentes. *(R7)*
- [x] **GATE-04**: Al guardar, el sistema dice **a dónde se fue el lead** y
  cómo volver a encontrarlo — hoy "desaparece" y ese es el reclamo #1. *(R2)*

### COMM — Compromisos como objeto

- [x] **COMM-01**: Los compromisos hablados se registran como objeto
  (`tipo`, `parte` yo/prospecto, `canal`, `dueAt`, `estado`), no como texto
  libre en una nota. *(R4)*
- [x] **COMM-02**: Un compromiso pendiente setea el `nextAction` del lead.
- [x] **COMM-03**: Se distingue quién se comprometió: si fue él, es una tarea
  propia; si fue el prospecto, es una expectativa cuyo incumplimiento
  dispara su follow-up.
- [x] **COMM-04**: Puede consultar en cualquier momento a quién le mandó
  información, cuándo, y qué falta responder.

### ACT — Acciones desde cualquier vista

- [x] **ACT-01**: Botón de WhatsApp visible desde toda vista donde aparezca
  el lead (lista, Power Dialer, ficha, Hoy), que abre `wa.me` con el mensaje
  precargado. *(R4)*
- [x] **ACT-02**: El mismo click registra el envío como evento y crea el
  próximo paso — mandar y registrar son un solo acto, no dos.
- [x] **ACT-03**: Puede mandar a un **número alternativo** cargado en el
  momento (caso real: el número que llamó no tiene WhatsApp y le pasan otro
  durante la llamada). *(R4)*
- [x] **ACT-04**: Botón de descartar desde cualquier vista, que saca el lead
  de todas las listas de una. *(R5)*
- [x] **ACT-05**: El envío de material por email queda registrado con el
  mismo modelo de evento que WhatsApp. Sin tracking de aperturas (Apple MPP
  las volvió ruido).

### DIAL — Power Dialer como motor único

- [x] **DIAL-01**: Puede lanzar el Power Dialer sobre un lead puntual desde
  cualquier lista, sin que la cola arranque de cero. *(R2)*
- [x] **DIAL-02**: Marcar un resultado no expulsa el lead de la vista antes
  de que él decida avanzar. *(R2)*
- [x] **DIAL-03**: Power Dialer, Hoy y Llamadas se comportan como una sola
  herramienta: lo que marca en una se refleja en las otras sin recargar.
- [x] **DIAL-04**: La ficha del lead muestra al frente lo que necesita ver
  antes de que atiendan, incluido **el historial de las vendedoras** — quién
  lo trabajó, qué anotó, en qué quedó. Llamar a un lead trabajado no es una
  llamada en frío. *(R1, R6)*
- [ ] **DIAL-05**: El panel de llamada se puede arrastrar y recuerda dónde
  quedó. Hoy está fijo al centro y tapa lo que hay detrás. *(R8)*

### HOY — La vista diaria

- [ ] **HOY-01**: Hoy se ordena por prioridad de trabajo: compromisos que
  vencen hoy → interesados con paso vencido → reintentos de no-contacto →
  nuevos por score. *(R3)*
- [ ] **HOY-02**: Puede filtrar Hoy por país, para saber a quién puede
  llamar ahora según huso horario. *(R3)*
- [ ] **HOY-03**: Cada sección se trabaja en modo cola (una tarjeta, marcar
  y siguiente) con contador de cuántas quedan.
- [ ] **HOY-04**: Hay una red de seguridad visible: los leads tocados que
  quedaron sin próxima acción. Objetivo: vacía.
- [ ] **HOY-05**: Un panel de higiene muestra si la cola de vencidos crece o
  se vacía — el indicador de si está por encima de su capacidad.

---

## Future Requirements (deferred)

- Shows/no-shows y deals en los reportes — cuando `lead.asistio` y
  `calendarioEstado='ganada'` empiecen a tener datos reales.
- Biblioteca general de llamadas del equipo (hoy privacidad por SDR).
- Scorecard visible para las vendedoras (si COACH-06 se decide que no
  en esta pasada).
- Reactivación del canal WhatsApp de prospección (Phases 7-8 parkeadas).
- **wa-multi para DETECTAR respuestas** (v4.0): conectar su número solo
  para escuchar, y que una respuesta cancele el follow-up y suba el lead a
  Hoy. Recibir no quema la cuenta; mandar en volumen, sí. Es lo único que
  `wa.me` no puede dar. Requiere reconectar cuentas (hoy `QR_PENDING`).
- **Extracción IA de compromisos** desde el resumen de la llamada, como
  borrador que él confirma. Se retoma cuando `commitment` esté rodado y
  haya ejemplos reales para calibrar.

## Out of Scope (v4.0)

| Feature | Razón |
|---|---|
| Envío automático de WhatsApp | Riesgo de ban del número; a su volumen (5-10 mensajes/día) automatizar el envío no ahorra nada. Manda él, el sistema registra |
| Extracción IA de compromisos | El research es claro: falla justo en los condicionales ("cuando vuelva de vacaciones", "lo hablo con mi socio"), que es su casuística. Diferido, no descartado |
| Invariante sobre el stock virgen | Aplicarlo a los 3.699 leads sin tocar haría nacer la métrica con 3.699 defectos, inservible |
| Cuotas de actividad diaria | Trabaja solo; medir outcomes (reuniones), no actividad. El research lo marca como la trampa clásica del modelo de tareas |
| Tracking de aperturas de email | Apple MPP precarga el pixel en >50% de los opens; se mide ruido de proxies |

## Out of Scope (v2.0)

- **Orquestador de agentes / Stripe / GoHighLevel** — no justificado por
  los datos (1 agendado en 603 llamadas). Si reaparece antes de que
  19–22 corran con datos reales: decirlo, no construirlo.
- **Persistir audio de llamadas** — decisión de diseño existente; solo
  transcript.
- **Medir "horas trabajadas"** — no hay fuente honesta; a lo sumo proxy
  de span primera→última llamada etiquetado como proxy.
- **Dashboards nuevos** — el principio del milestone es lo contrario:
  el sistema habla, nadie entra a mirar.

---

## Traceability

| REQ | Phase |
|-----|-------|
| REP-01, REP-02, REP-03 | 19 |
| DISP-01, DISP-02, DISP-03 | 20 |
| REP-04, REP-05, REP-06, REP-07, REP-08, REP-09, REP-10 | 21 |
| COACH-01, COACH-02, COACH-03, COACH-04, COACH-05, COACH-06 | 22 (DIFERIDA) |
| ALERT-01, ALERT-02, ALERT-03 | 23 (DIFERIDA) |
| VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06 | 24 |
| VOICE-07 | 25 |
| VOICE-08, VOICE-09 | 26 |
| VOICE-10 | 27 |
| GATE-03, DIAL-05 | 28 (QUICK — adelantados por decisión del user) |
| NEXT-01, NEXT-02, NEXT-03, NEXT-04 | 29 |
| GATE-01, GATE-02, GATE-04 | 30 |
| COMM-01, COMM-02, COMM-03, COMM-04 | 31 |
| ACT-01, ACT-02, ACT-03, ACT-04, ACT-05 | 32 |
| DIAL-01, DIAL-02, DIAL-03, DIAL-04 | 33 |
| HOY-01, HOY-02, HOY-03, HOY-04, HOY-05 | 34 |

✓ v2.0: 13/13 activos mapeados (COACH/ALERT diferidos) · v3.0: 10/10 mapeados
(phases archivadas, milestone parkeado) · **v4.0: 27/27 requirements mapeados
(Phases 28-34)** — nota: el conteo enunciado en la introducción del bloque
v4.0 y en el research decía "23"; el conteo real de la sección es 27
(NEXT 4 + GATE 4 + COMM 4 + ACT 5 + DIAL 5 + HOY 5), y son esos 27 los que
están mapeados 1:1 a fase, sin huérfanos ni duplicados. **Phases 28-34**:
GATE-03 (calendario) y DIAL-05 (panel arrastrable) se adelantaron a una
Phase 28 de puro frontend porque no dependen del modelo de datos.

---

*Last updated: 2026-08-13 — Roadmap de v4.0 creado (Phases 28-33: NEXT →
GATE → COMM → ACT → DIAL → HOY). Los 27 requirements reales de la sección
v4.0 quedaron mapeados 1:1, uno por categoría/fase. v3.0 "Agente de voz"
sigue PARKEADO: fases 24-27 archivadas en
`.planning/archive/v3.0-agente-voz/`, se retoma después de v4.0.*
