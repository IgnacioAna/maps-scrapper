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

### COACH — Coaching por vendedora

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

### ALERT — Notificación por excepción

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

## Future Requirements (deferred)

- Shows/no-shows y deals en los reportes — cuando `lead.asistio` y
  `calendarioEstado='ganada'` empiecen a tener datos reales.
- Biblioteca general de llamadas del equipo (hoy privacidad por SDR).
- Scorecard visible para las vendedoras (si COACH-06 se decide que no
  en esta pasada).
- Reactivación del canal WhatsApp de prospección (Phases 7-8 parkeadas).

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
| COACH-01, COACH-02, COACH-03, COACH-04, COACH-05, COACH-06 | 22 |
| ALERT-01, ALERT-02, ALERT-03 | 23 |

✓ 22/22 requirements mapeados — 100% cobertura.

---

*Last updated: 2026-07-26 — milestone v2.0 (REP-07 y REP-08 completos en 21-02;
21-03 encendió los crons y sumó el molde corto del semanal; 21-04 agregó el panel
del canal con el botón "Mandar ahora" — REP-05 y REP-06 siguen abiertos solo por
el primer envío real y la validación del user en su celular, plan 21-07).*
