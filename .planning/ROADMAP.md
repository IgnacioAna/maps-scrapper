# SCM — Roadmap · Milestone v2.0 "Gestión por excepción"

> Creado 2026-07-25. Las phases 1–18 (v1.x, del prospector WhatsApp al
> call center SDR) están cerradas — resumen en `MILESTONES.md`, detalle
> en `CLAUDE.md`. La numeración continúa: **19–23**.

**Criterio de éxito del milestone:** pasa una semana entera sin que nadie
entre al panel, y aun así los tres socios saben qué vendedora se cayó y
qué llamada hay que escuchar. Si el reporte llega pero igual hay que
entrar a mirar para entender algo, el milestone falló.

**Reglas transversales (aplican a todas las phases):**
- Toda métrica DERIVA del CALL METRICS CORE — jamás re-implementar el
  funnel (`tests/metrics-consistency.test.js` es la garantía).
- Alcance de reportes = solo vendedoras nuevas (`ADMIN_ONLY_SETTER_IDS` +
  `_filterSettersVisible`).
- Nada de métricas en cero en ningún reporte.
- Suite completa verde antes de cerrar cada phase (base: ~836 tests).
- `npm run pre-deploy` antes de cualquier push; Railway escucha `main`.
- Hablarle al user sin jerga; lo que se pueda averiguar solo, averiguarlo.

⚠️ **Advertencia de alcance:** si durante la ejecución aparece la
propuesta de ampliar hacia un orquestador de agentes / Stripe / GHL antes
de que las phases 19–22 corran con datos reales — **decirlo, no
construirlo**.

---

## Resumen

| # | Phase | Reqs | Depende de |
|---|-------|------|-----------|
| 19 | Encender el reporte semanal | REP-01..03 | — |
| 20 | Disposición obligatoria | DISP-01..03 | — (adelantada) |
| 21 | Reporte diario + canal WhatsApp | REP-04..10 | 19 |
| 22 | Coaching por vendedora | COACH-01..06 | 21 + gate Whisper |
| 23 | Notificación por excepción | ALERT-01..03 | 21 |

---

## Phase 19 — Encender el reporte semanal

**Goal:** el reporte semanal que ya existe deja de estar roto: el cron
corre sin crash, sin duplicados, llega a varios destinatarios y no
muestra datos engañosos.

**Requirements:** REP-01, REP-02, REP-03

**Contexto verificado (2026-07-25):** `maybeRunWeeklyReportCron` usa una
variable `now` que no existe (index.js:1861 y :1870; solo hay `nowTs` en
:1857). Con `reports.json` vacío manda el mail y explota al persistir →
hasta 16 mails el lunes; con estado existente → ReferenceError síncrono
en el setInterval → el cron muere. `data/reports.json` nunca existió.
Además la sección WhatsApp del mail mezcla acumulados históricos bajo
encabezado "semana" (index.js:1821) con un embudo WSP hoy en cero.

**Success criteria:**
1. El cron del lunes 8am (TZ negocio) manda exactamente UN mail por
   semana, verificado con test de regresión (día/hora/TZ/anti-duplicado).
2. `data/reports.json` persiste el último envío y sobrevive redeploys.
3. El reporte sale a una lista configurable de destinatarios.
4. Ninguna sección del mail presenta acumulados históricos como datos de
   la semana.
5. Acción del user documentada: cargar `RESEND_API_KEY` en Railway.

**UI hint:** no (backend + tests). Sin cache-buster.

**Plans:** 2 planes (planificado 2026-07-25)

Plans:
- [ ] 19-01-PLAN.md — Fix del cron (ReferenceError `now`) + destinatarios
  configurables (REPORT_EMAILS) + data del reporte al CALL METRICS CORE
  sin sección WSP + exclusión Ignacio/Paula + persistencia reports.json
  en los 4 lugares
- [ ] 19-02-PLAN.md — tests/weekly-report.test.js (regresión del cron:
  día/hora/TZ/anti-dup + shape + export/import) + suite completa verde

---

## Phase 20 — Disposición obligatoria

**Goal:** ninguna llamada queda sin resultado marcado. Cierra la fuga
estructural: el registro de llamada lo crea SOLO el endpoint de
disposición — sin marcar no hay registro, ni transcript (el audio se
descarta a los 10 min y no se persiste), ni métrica.

**Requirements:** DISP-01, DISP-02, DISP-03

**Por qué va segunda (decisión del user 2026-07-25):** cada día sin
enforcement son llamadas sin datos para las phases 21-23. Trade-off
asumido: fricción inmediata para las vendedoras a cambio de calidad del
dato.

**Decisiones a levantar en discuss-phase (la decisión de fondo YA está
tomada; la forma NO — no decidir por cuenta propia):**
1. ¿Qué significa "obligatorio"? ¿Modal bloqueante que no deja discar la
   siguiente? ¿Cola de pendientes al inicio de sesión? ¿Ambas?
2. Interacción con la ventana de 10 min del audio (public/app.js:7530):
   marcar tarde pierde el transcript.
3. Qué pasa con las llamadas ya colgadas sin marcar al activar la regla.
4. Cómo evitar que el enforcement empuje a marcar cualquier cosa (el dato
   falso no se ve; el hueco sí).

**Success criteria:**
1. Una llamada colgada no puede quedar sin disposición según la forma
   acordada con el user.
2. El % de llamadas con disposición marcada sube a ~100% en la semana
   posterior al deploy (medible contra el callLog).
3. Las SDRs no reportan que el flujo del Power Dialer se volvió inusable
   (el autopiloto y los atajos 1-9 siguen funcionando).
4. Tests del enforcement (frontend puede requerir verificación en preview
   + tests backend de cualquier endpoint nuevo).

**UI hint:** yes (Power Dialer + view-calls) → cache-buster obligatorio.

---

## Phase 21 — Reporte diario + canal WhatsApp

**Goal:** todos los días llega al grupo de WhatsApp de los 3 socios un
reporte corto, legible en el preview de la notificación, con las
excepciones arriba. Si la desktop está apagada, sale por email y/o queda
en cola consolidada.

**Requirements:** REP-04, REP-05, REP-06, REP-07, REP-08, REP-09, REP-10

**Primera tarea (minutos, antes de planificar el resto):** prueba en vivo
del envío a grupo. El user crea el grupo con sus 2 socios y avisa; el JID
se averigua desde la sesión de wa-multi/gateway (no pedírselo al user).
Verificado en código: el handler `followup:send-message` manda vía
deeplink `web.whatsapp.com/send?phone=` → casi seguro NO acepta grupos.
Plan B: repack de wa-multi con envío a grupo (búsqueda por nombre +
typing OS-level; el proyecto ya repackeó 2 veces; `out/` ES el source,
NUNCA `npm run build`). Plan C: 3 DMs individuales (funciona hoy).
Plan D: solo email. Reportar el resultado al user en lenguaje simple.

**Molde del mensaje (validar con el user en su celular antes de fijar):**
```
📞 *Reporte diario · vie 25/07*

⚠️ *Sin actividad hoy:* Dalia, Adela

*Judith* — 38 llam · 12 at · 9 min
*Teresa* — 104 llam · 11 at · 5 min
*Brenda* — 23 llam · 6 at · 12 min

_Equipo: 165 llam · 29 at (18%) · 26 min_
_Ayer: 141 llam · 24 at (17%)_
```

**Success criteria:**
1. El diario llega solo, todos los días, al grupo (o fallback email si la
   desktop está offline) — sin intervención de nadie.
2. La primera línea después del título es quién no trabajó hoy.
3. Solo métricas con señal (llamadas · atendidas · minutos · última
   actividad) + comparación vs ayer; cero filas de ceros.
4. Con la desktop apagada N días, al reconectar sale UN mensaje
   consolidado (no N mensajes); diarios de más de ~3 días expiran; el
   semanal nunca expira; sin duplicados por período cubierto.
5. Ignacio y Paula no aparecen en ningún reporte.
6. El sesgo del canal manual y las llamadas sin atribuir están anotados
   en el propio reporte.
7. Tests del builder diario, la cola y la consolidación.

**UI hint:** mínima (quizás config de destinatarios en Comando).

---

## Phase 22 — Coaching por vendedora

**Goal:** las transcripciones dejan de ser archivo muerto: cada llamada
transcripta se analiza sola, el análisis se agrega por vendedora, y el
reporte semanal incluye la cola de 3-5 llamadas a escuchar.

**Requirements:** COACH-01, COACH-02, COACH-03, COACH-04, COACH-05,
COACH-06

**Gate de entrada (COACH-01):** verificar en prod que la ronda 8 de
Whisper recuperó el canal del cliente (leer `asrDebug` +
`recMeta.leadActivePct` de llamadas post-25/07) ANTES de automatizar. Un
analizador que puntúa sobre media conversación emite juicios injustos
sobre personas reales. ⚠️ NO reintroducir `WHISPER_PROMPT`.

**Trabajo previo a reusar:** el P0 #6 de
`.planning/phases/12-sdr-operating-system/PLAN.md` es literalmente esta
phase — leerlo antes de planificar.

**Decisión a levantar en discuss-phase:** ¿las vendedoras ven su propio
análisis? (hoy admin/supervisor only).

**Success criteria:**
1. Toda llamada con transcript nuevo tiene `mercuryAnalysis` sin acción
   manual (hook de index.js:14525, cache respetado).
2. Endpoint de agregación por vendedora/período devuelve score promedio,
   % opener, violaciones frecuentes y patrón de errores.
3. El reporte semanal incluye 3-5 llamadas concretas a escuchar con
   nombre, fecha y motivo.
4. El subsistema de análisis tiene tests (hoy: cero).
5. Costo del análisis automático estimado y aceptado por el user antes de
   encenderlo (corre 1 LLM call por llamada transcripta).

**UI hint:** mínima (la cola puede vivir solo en el reporte).

---

## Phase 23 — Notificación por excepción

**Goal:** las alertas que el sistema ya calcula dejan de vivir en una
pantalla que nadie mira: las `high` llegan solas, sin spam, y cada una
tiene un responsable.

**Requirements:** ALERT-01, ALERT-02, ALERT-03

**Decisión a levantar en discuss-phase:** quién de los 3 socios actúa
ante cada tipo de alerta (drop de rendimiento / inactividad / apertura
baja / never_touched). Tres que ven lo mismo y asumen que otro escribe
es peor que uno solo notificado.

**Success criteria:**
1. Una alerta `high` nueva genera notificación real (canal de Phase 21 o
   email) el mismo día.
2. La misma alerta no se re-notifica día tras día (dedupe persistido).
3. Cada alerta indica quién es el responsable de actuar.
4. Tests del dedupe y del disparo.

**UI hint:** no (reusa canal + motor existentes).

---

## Coverage check

| REQ-IDs | Phase |
|---------|-------|
| REP-01..03 | 19 |
| DISP-01..03 | 20 |
| REP-04..10 | 21 |
| COACH-01..06 | 22 |
| ALERT-01..03 | 23 |

✓ 22/22 — 100% cobertura. Cada requirement mapeado a exactamente una
phase.

---

*Last updated: 2026-07-25 — roadmap v2.0 (5 phases, numeración continúa
de la 18). Phase 19 planificada (2 planes).*
