# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-07-26.

---

## Current Milestone

**v2.0 — Gestión por excepción** (iniciado 2026-07-25)

Reportes diario/semanal automáticos al grupo de WhatsApp de los 3 socios
(fallback email), disposición obligatoria, coaching por vendedora desde
transcripciones, alertas que llegan solas. Solo vendedoras nuevas.

## Current Position

- **Phase:** 21 — Reporte diario + canal WhatsApp — **EN EJECUCIÓN: 3/7
  planes ejecutados (ola 1 completa + 21-02 de la ola 2).**
  - **21-02 EXECUTED (2026-07-26)** — cola de envío al grupo. Commits
    `a0acab2` (esquema en `reports.json` + `mutateReportsState` + prune con
    cap que nunca descarta pendientes + expiración D-26 + `enqueueReportMessage`
    genérico con guard D-28 + `_reportGapNote` + `_reportDmFallback`),
    `aadc9a1` (`reportQueueTick`: guard `isUserConnected` ANTES de emitir,
    estado `sending` hasta el resultado correlacionado por `queueId`, un solo
    envío en vuelo = espaciado ≥60s, consolidación de diarios, nota de baches
    en TODO envío; `handleReportSendResult`/`handleReportGroupConfigured` con
    authz T-21-06/T-21-07 + backfill del `groupJid`; listeners
    `report:send-result`/`report:group-configured` en el gateway vía
    `deps.onReportEvent`), `10f2a4f` (26 tests). Suite **918/918**.
    **CERO archivos JSON nuevos**: todo vive en `reports.json` (regla
    #21/#128), round-trip export/import testeado.
    Superficie para los planes siguientes: `globalThis.__reportQueue`
    (incluye `consts`). Detalle y contrato de uso en `21-02-SUMMARY.md`.
    ⚠️ El evento nunca viajó por un socket real (gateway doble en los tests);
    lo verificado es que el payload cumple el contrato congelado de 21-05.
  - **21-01 EXECUTED (2026-07-26)** — builder del reporte diario + textos.
    Commits `a303114` (datos + helpers + `now` inyectable en
    `_ccResolveRange` + `leaveUntil`), `81142ab` (molde D-19 / línea de día /
    consolidado), `199bf40` (28 tests). Suite **892/892**.
    Verificado contra el snapshot real de producción: el mensaje del mié
    22/07 sale con la estructura exacta de D-19 (13 llam · 8 at · 21 min,
    Judith/Teresa en la alerta, Dalia/Adela/Melissa en "Sin arrancar").
    Superficie para los planes siguientes: `globalThis.__dailyReport`.
    Detalle en `21-01-SUMMARY.md`.
  - **21-05 EXECUTED (2026-07-26)** — transporte a grupo en el desktop
    wa-multi. Commits `6614be4` (sendReportToGroup: fila fijada o búsqueda,
    verificación de header/JID ANTES de tipear, confirmación por burbujas
    salientes, Shift+Enter para los saltos de línea) y `b3a1f2e` (handler
    `report:send-message` con dedupe por queueId + validación de payload,
    rama DM del fallback D-02, relay `report:group-configured`,
    auto-apertura al bootear). `node --check` OK, suite 892/892.
    **El contrato de eventos para la ola 2 está congelado en
    `21-05-SUMMARY.md`** (`report:send-message` / `report:send-result` /
    `report:group-configured`).
    ⚠️ Los 2 commits son `--allow-empty`: `wa-multi/` está **gitignored**
    (`.gitignore:32`, 0 archivos trackeados desde siempre). El cambio vive
    en `wa-multi/src-v058-work/out/main/index.js` y NO está versionado
    hasta que 21-06 lo empaquete en el `app.asar`.
    Sin verificar en vivo (queda para 21-07): pin en fila 0 (A1), `@g.us`
    en `data-id` (A2), selectores de la caja de búsqueda (A3, nunca
    probados) y Shift+Enter en el composer.
  - Artefactos de planificación:
  `21-CONTEXT.md` (29 decisiones), `21-RESEARCH.md` (transporte wa-multi),
  `21-PATTERNS.md` (analogía por superficie), `21-UI-SPEC.md` (aprobado 6/6
  por gsd-ui-checker), `21-01..21-07-PLAN.md`.
  - **Verificación de planes: PASSED** (gsd-plan-checker, sin bloqueantes).
    Las 2 advertencias se corrigieron en los propios planes antes de cerrar:
    la nota de baches de D-05 ahora aplica a TODO envío y no solo al
    consolidado (21-02), y `send-now` avanza la cola en cada vuelta del
    polling buscando su propio item, con rama definida para "sigue pending"
    (21-03).
  - Cobertura: REP-04..REP-10 7/7 · decisiones D-01..D-29 29/29.
  - **Bloquea la prueba en vivo (plan 21-07, `autonomous: false`), NO la
    construcción:** el user tiene que (a) conseguir un número nuevo y
    registrar WhatsApp, (b) crear el grupo cerrado con los 2 socios (sin
    vendedoras, D-24), (c) abrir wa-multi, escanear el QR y **fijar (pin) el
    grupo** — el pin es lo que hace que el envío sobreviva a un rename.
  - Los planes 21-01..21-06 se ejecutan y verifican HOY, sin número ni grupo.
- **Phase 20:** Disposición obligatoria — 3/3 planes EXECUTED +
  verificados. **Preview checklist a-f: 6/6 PASS** (documentado en
  20-03-SUMMARY). Code review: 1 critical **CR-01 FIXED** (`84ebf4a` —
  re-discar el mismo lead ya invalida la ventana de correctsAutoMarked;
  cache-buster app.js → `v=20260725c`), 4 warnings advisory + 4 info en
  `20-REVIEW.md` (candidatos de hardening: stash de franja sin expiración
  WR-01, meta consumida ante red caída WR-02, ghost ad-hoc y gate sin row
  WR-03, cancel race WR-04).
- **Status:** VERIFICATION **human_needed 14/15** (`20-VERIFICATION.md`):
  todo lo automatizable verificado (endpoints, guard, bifurcación
  enteredActive||committedRemote, D-04 intacto por diff, suite
  **864/864**); quedan 3 ítems humanos en `20-HUMAN-UAT.md` (llamada
  Telnyx real, % marcada tras 1 semana en prod, feedback SDRs).
- **Last activity:** 2026-07-26 — (1) Phase 20 ejecutada completa (waves 1-2,
  preview checklist, review + fix CR-01, verificación) y **DEPLOYADA**:
  push de 30 commits a `main` (`060013c`), `/api/version` en prod devuelve
  `20260725c`, los 3 endpoints nuevos responden 401 (vivos). ⚠️ El push
  incluyó también la **Phase 19 completa**, que nunca había llegado a
  producción — el cron del reporte semanal recién ahora corre en prod.
  (2) **Phase 21 discutida** — `21-CONTEXT.md` + `21-DISCUSSION-LOG.md`
  escritos (29 decisiones D-01..D-29). (3) **Phase 21 planificada** —
  research del transporte + mapa de patrones + UI-SPEC verificado + 7 planes
  verificados (commits `a451157`, `8298c24`). (4) **21-01 ejecutado**: el
  builder del reporte diario ya arma el mensaje del molde D-19 con datos
  reales (commits `a303114`, `81142ab`, `199bf40`; suite 892/892).
  (5) **21-05 ejecutado**: el desktop wa-multi ya sabe mandar a un chat de
  GRUPO con verificación previa y resultado correlacionado (commits
  `6614be4`, `b3a1f2e`) — ola 1 cerrada.
  (6) **21-02 ejecutado**: la cola de envío al grupo ya transporta cualquier
  texto con reintentos, consolidación y confesión de baches (commits
  `a0acab2`, `aadc9a1`, `10f2a4f`; suite 918/918).

**Próximo paso:** seguir `/gsd-execute-phase 21` — falta 21-06 (picker del
grupo en el preload + repack v0.5.11) para cerrar la ola 2, después 21-03
(cron diario + endpoints admin), 21-04 (panel) y 21-07 con el user.
Para D-02 (fallback por DM) el user puede cargar `REPORT_DM_FALLBACK` en
Railway (CSV de hasta 5 teléfonos E.164); sin esa var el fallback no sale por
DM pero el bache se confiesa igual.
Pendiente aparte: UAT humano de `20-HUMAN-UAT.md` (las SDRs recargan el tab
una vez — el banner de versión avisa; la regla arranca de cero, D-05). Al
aprobar el UAT: `/gsd-verify-work 20` → marcar COMPLETE.
**Decisión del user (2026-07-26):** `RESEND_API_KEY` NO es prioridad — el
reporte diario va al grupo de WhatsApp y **NO tiene fallback a email**
(Phase 21 D-04, acota REP-07); el email queda cableado y apagado. Las
invitaciones se mandan copiando el link a mano.
**Hallazgo de la Phase 21 (verificado en código, corrige el roadmap):** el
JID del grupo NO destraba nada — el desktop maneja WhatsApp Web como una
persona vía deeplink `send?phone=` y WhatsApp no tiene equivalente para
grupos. La solución es elegir el grupo de una lista una vez y guardar su
identificador (Phase 21 D-03).
**Pendiente del user:** cargar `RESEND_API_KEY` (y opcional `REPORT_EMAILS`)
en Railway → Variables — sin la key el cron no manda nada.

---

## Phase Status (v2.0)

| # | Phase | Reqs | Status |
|---|-------|------|--------|
| 19 | Encender el reporte semanal | REP-01..03 | **COMPLETE** (2/2 planes, 2026-07-25) |
| 20 | Disposición obligatoria | DISP-01..03 | Ejecutada 3/3 + verificada (human_needed — UAT en prod pendiente, 2026-07-26) |
| 21 | Reporte diario + canal WhatsApp | REP-04..10 | **En ejecución 3/7 planes** (21-01 + 21-05 + 21-02 EXECUTED 2026-07-26; REP-04/09/10 completos, REP-05 builder hecho y pendiente de validación del user, REP-06 con transporte desktop + cola server listos, REP-07/08 completos del lado server) |
| 22 | Coaching por vendedora | COACH-01..06 | Pending (gate: verificación Whisper ronda 8) |
| 23 | Notificación por excepción | ALERT-01..03 | Pending |

Milestone anterior (v1.x, Phases 1–18): ver `MILESTONES.md`.

---

## Verificaciones de la sesión 2026-07-25 (base del roadmap)

Contra HEAD `a9e4886`:

- **Bug `now`** en `maybeRunWeeklyReportCron` confirmado (index.js:1861 y
  :1870 usan `now`; solo existe `nowTs` en :1857). `data/reports.json` no
  existe → nunca persistió un envío.
- Sección WhatsApp del mail semanal mezcla acumulados históricos bajo
  encabezado "semana" (index.js:1821).
- `/analyze` (index.js:13678) admin/supervisor-only, cachea en
  `call.mercuryAnalysis`, **cero tests**.
- Hook post-transcripción para el auto-analyze: donde ya corre
  `_autoDispositionLLM` (index.js:14525).
- Alertas de equipo se calculan (index.js:9772) pero solo pintan pantalla.
- Patrón de cola a copiar: `scheduledMessagesTick` (index.js:5126) — el
  módulo NO se reusa (atado a leadId).
- **Handler `followup:send-message` de wa-multi NO soporta grupos**: manda
  vía deeplink `web.whatsapp.com/send?phone=` (out/main/index.js:630,736
  del desktop). Plan B: repack con group-send (búsqueda por nombre +
  typing; `out/` ES el source, NUNCA `npm run build`). Plan C: 3 DMs
  individuales. Plan D: solo email.
- `gsd-sdk` no está en PATH → commits/estado manuales con git.

---

## Open Questions (a resolver en discuss-phase, NO antes)

- **Phase 20**: forma exacta del enforcement (modal bloqueante vs cola de
  pendientes vs ambas); tratamiento de llamadas viejas sin marcar; cómo
  evitar disposiciones falsas; interacción con la ventana de 10 min del
  audio.
- ~~**Phase 21**~~: RESUELTA en `21-CONTEXT.md` (2026-07-26, 29 decisiones).
  Expiración de diarios = 3 días. El molde quedó elegido con datos reales y
  se valida definitivamente en el celular con el primer envío real.
- **Phase 22**: ¿las vendedoras ven su propio scorecard? (hoy
  admin/supervisor only — sin verlo es vigilancia, viéndolo es coaching).
- **Phase 23**: quién de los 3 socios actúa ante cada tipo de alerta.
- **Acciones del user pendientes (bloquean la prueba en vivo de la Phase 21,
  NO la construcción)**: (1) conseguir un número de WhatsApp NUEVO dedicado y
  registrarlo; (2) crear el grupo con los 2 socios — **cerrado, sin las
  vendedoras**; (3) abrir `wa-multi-portable-v0.5.10`, escanear el QR con ese
  número, elegir el grupo de la lista y dejar la app abierta.
  `RESEND_API_KEY` dejó de ser necesaria para el diario (decisión D-04: sin
  fallback a email); sigue haciendo falta para el mail semanal.

---

## Accumulated Context

### Roadmap Evolution

- 2026-07-25 — **Milestone v2.0 iniciado**. Roadmap v1 (phases 1–18)
  archivado en MILESTONES.md. Numeración continúa: 19–23. Decisiones del
  user: canal = grupo WhatsApp (email fallback), disposición obligatoria
  (adelantada a Phase 20), alcance = solo vendedoras nuevas, reportes por
  excepción sin métricas en cero. Advertencia de alcance: NO ampliar a
  orquestador de agentes/Stripe/GHL antes de que 19–22 corran con datos
  reales.
- 2026-07-12 — Phase 18 EXECUTED y verificada (commits 6b00175 backend,
  a196b76 tests 21/21, 53b7db7 frontend; suite completa 751/751;
  verificación en vivo: supervisor scoped ve solo sus 3 SDRs, 403 en
  financieros/pool/command, home = view-team).
- 2026-07-12 — Phase 18 added: Supervisor restringido + panel de
  rendimiento SDR. `visibleSetterIds[]` en el user record.
- 2026-06-10 — Phase 8 added: Anti-detección wa-multi (Proxy +
  Fingerprint por cuenta). DONE 2026-06-11, luego parkeada con el pivot.
- 2026-06-10 — Phase 7 added: Motor de Campañas Drip WhatsApp. v2
  2026-06-12, luego parkeada con el pivot a llamadas.
- 2026-05-21/22 — Phase 6 Telnyx Calls Foundation ejecutada y cerrada
  (~22h, 5 bugs del SDK resueltos). Base del call center actual.

### Decisiones arquitectónicas Phase 6 (siguen vigentes)

1. **API key NUNCA en browser** — siempre vía endpoints backend
2. **Env vars > JSON** — secrets en Railway env vars; self-healing del JSON
3. **WebRTC vía CDN** (`@telnyx/webrtc@2/lib/bundle.js`)
4. **Caller ID por país destino** + rotación round-robin
5. **Estados terminales reales del SDK** — `hangup`/`destroy`/`purge`
6. **`remoteElement` en `newCall(options)`**
7. **Ringback fake con Web Audio API**
8. **Manual attach del remoteStream con retry**

---

## Decisiones de ejecución (Phase 21)

- **21-01:** el % del reporte se imprime ENTERO (62%, no 61.5%) para igualar
  el molde validado; el dato conserva la precisión del CALL METRICS CORE. Los
  minutos son los del CORE (`totalDurationS`, solo llamadas atendidas) — el
  borrador de D-19 mostraba 23 min donde el CORE da 21 para el mismo día, y
  manda el CORE (regla #157).
- **21-01:** `setter.leaveUntil` es campo propio (no se reusa `hidden`, que no
  vence); los setters `hidden` quedan fuera de TODAS las listas del reporte,
  incluida "Sin arrancar".
- **21-01:** las discadas sin marcar (`pending_calls.json`) se muestran por
  nombre pero NUNCA suman a `dials` — una sola forma de contar llamadas.
- **21-05:** los saltos de línea del reporte se tipean con **Shift+Enter**
  (`osShiftEnter`): un `\n` mandado como evento `char` en WhatsApp Web
  dispara el ENVÍO y habría partido el reporte en 6-8 mensajes sueltos. El
  mismo tratamiento se aplicó al tipeo de `sendMessageInWindowInner` (por
  ahí sale el fallback por DM); el camino de una sola línea quedó idéntico,
  así que los followups no cambian.
- **21-05:** ante `jid-mismatch` en la fila fijada se prueba igual el
  fallback de búsqueda por nombre (el research §Q2 lo describe justo para
  "si el pin se rompe"). Nunca se tipea en un chat sin verificar.
- **21-05:** el envío al grupo NO consume `DAILY_SEND_CAP` (80/día) — es un
  grupo propio, no outreach frío. `enqueueSend` sí se respeta.
- **21-05:** `wa-multi/` está gitignored, así que los commits de tarea del
  desktop van `--allow-empty` con el detalle en el mensaje. No se forzó
  `git add -f`: meter el árbol del desktop (con binarios) contradice una
  decisión explícita del `.gitignore`.
- **21-02:** los items terminales **MIGRAN** de `queue` a `history` (una sola
  copia por id) en vez de vivir en las dos listas como decía el plan: con el
  item duplicado, sellar `confessedAt` en una copia y no en la otra haría que
  la nota de baches (D-05) se repitiera en cada mensaje para siempre.
  `REPORT_QUEUE_CAP` quedó como guard contra crecimiento patológico (>200
  vivos), no como recorte normal — los pendientes nunca se descartan.
- **21-02:** dos contadores por item: `attempts` (todas las vueltas, sube
  también con el desktop apagado) y `sendAttempts` (emisiones reales). El
  presupuesto `REPORT_MAX_ATTEMPTS` mira `sendAttempts`; si mirara `attempts`,
  20 minutos offline lo agotarían y el primer fallo real tras reconectar sería
  definitivo — justo el escenario principal de la fase.
- **21-02:** los 2 writers de `reports.json` de Phase 19
  (`maybeRunWeeklyReportCron` y `POST /api/admin/weekly-report/send`) pasaron
  al mutex: tenían `await` entre load y save, y con el estado nuevo del archivo
  eso significaba pisar la cola entera mientras Resend respondía (regla #19).
- **21-02:** `config.paused` ya se honra en el tick (el esquema lo declaraba y
  nadie lo leía). 21-04 solo cablea el interruptor de D-29.
- **21-02:** `dailyState.lastDailyPeriodKey` / `weeklyState.lastWeeklyPeriodKey`
  existen en el esquema pero NADIE las escribe: el guard de D-28 se implementó
  escaneando `queue`+`history` por `kind`+`periodKey` (más fuerte, no depende de
  que el cron acierte el orden). Quedan para el bookkeeping de 21-03 si le sirven.

---

*Last updated: 2026-07-26 (21-02 ejecutado).*
