---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: — estado al switch
status: executing
last_updated: "2026-07-31T16:10:00.000Z"
last_activity: 2026-07-31
progress:
  total_phases: 26
  completed_phases: 4
  total_plans: 22
  completed_plans: 17
  percent: 15
---

# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-08-01.

---

## Current Milestone

**v3.0 — Agente de voz** (iniciado 2026-08-01)

Agente de voz IA (Retell + SIP trunk Telnyx) que llama en frío a clínicas,
pasa recepción e intenta agendar con el decisor; lo no-agendado vuelve como
datos (nota, callback, nombres, objeción) al mismo circuito de las SDRs
humanas. Phases 24-27. Contexto completo:
`.planning/research/2026-08-01-agente-voz-retell.md` + `*-CONTEXT.md` de
cada phase.

## Current Position

Phase: 24 (integracion-backend-retell) — EXECUTING
Plan: 24-02 EXECUTED (2/5) — próximo 24-03

- **Phase:** 24 — Integración backend Retell — **En ejecución (2/5 planes)**
- **Plan:** 24-02 EXECUTED (2026-07-31) — 24-03..24-05 pendientes (waves
  serializadas, todo toca `index.js`).
- **Status:** Executing Phase 24

- **24-01 EXECUTED (2026-07-31)** — refactor `_applyCallOutcome` +
  hoisting de los helpers de costo Telnyx + test de paridad doble-vía.
  Commits `57a3543` (Task 1: `TELNYX_RATES_USD_PER_MIN`/
  `_detectCountryAndType`/`_estimateTelnyxCost` subidos a scope de
  módulo), `be58347` (Task 2: `_applyCallOutcome(data, lead, logEntry,
  opts)` extraído verbatim del handler humano + `opts.skipCalendarCreation`
  + `globalThis.__voiceAgent`), `b208aaf` (Task 3: 12 tests de paridad
  doble-vía en `tests/apply-call-outcome.test.js`). Suite completa
  **1020/1020** verde, sin editar ningún test preexistente
  (`git diff --cached --name-only -- tests/` solo lista el archivo nuevo).
  VOICE-02 completado. Detalle en `24-01-SUMMARY.md`.

- **24-02 EXECUTED (2026-07-31)** — config Retell env>JSON (patrón Telnyx
  clonado) + log de eventos + endpoints admin-only + regla #21 completa +
  pseudo-SDR `setter_agente_ia`. Commits `72f175f` (Task 1: módulo de
  config — `loadRetellConfig`/`saveRetellConfig`/`_publicRetellConfig`
  con overlay env>JSON, `_retellWebhookSecret` con fallback a `apiKey`
  [corrección research §2.1: Retell firma con el mismo API key, sin
  signing secret aparte], `_retellToolSecret` sin fallback, seed de boot
  del pseudo-SDR guardado por `NODE_ENV !== 'test'`), `b280d18` (Task 2:
  `GET`/`PUT /api/retell/config` admin-only con 409 env-sourced +
  self-healing + `retell_config.json`/`retell_events.json` en las 5
  superficies de la regla #21 — `BACKUP_FILES`, `seedVolumeFromRepo`,
  export-data [lectura CRUDA sin overlay de env, para que el export nunca
  filtre el secret efectivo], import-data, `pre-deploy.js`), `649e76e`
  (Task 3: `tests/retell-config.test.js`, 26 tests — RBAC, no-leak,
  env-sourced, self-healing, fallback webhookSecret, validaciones,
  round-trip export/import, pseudo-SDR visible con fila en
  `team-performance`). Suite completa **1046/1046** verde (1020 + 26
  nuevos), solo se sumaron 2 claves al `EXPECTED_KEYS` de
  `export-data-full.test.js` (pactado por el plan). VOICE-01/VOICE-06
  completados. Detalle en `24-02-SUMMARY.md`.

- **Próximo paso:** `/gsd:execute-phase 24` continúa con 24-03-PLAN.md
  (dispatch por lote + caller ID server-side + dry-run + cap diario,
  VOICE-03, wave 3).

- **Last activity:** 2026-07-31 — 24-02 ejecutado (executor secuencial,
  working tree principal, sin worktree).

## Pending todos (heredados de v2.0 — NO bloquean v3.0)

- **21-07**: prueba en vivo del reporte diario por WhatsApp con el user
  (`autonomous: false`). Ver detalle operativo en el archivo de posición
  v2.0 más abajo (asar vigente, botón "Mandar ahora", recarga de tabs).

- **UAT humano de Phase 20** (`20-HUMAN-UAT.md`): al aprobar →
  `/gsd-verify-work 20` → COMPLETE.

- **Phases 22 (Coaching) y 23 (Alertas): DIFERIDAS a backlog** — detalle en
  `ROADMAP-v2.0-archived.md`; sus requirements COACH-01..06 / ALERT-01..03
  siguen en REQUIREMENTS.md marcados como diferidos. Retomar post-piloto.

- **Pendiente del user (v2.0)**: cargar `RESEND_API_KEY` en Railway si
  quiere el mail semanal detallado (decisión previa: no urgente).

---

## Archivo — posición v2.0 al momento del switch (2026-08-01)

- **Phase:** 21 — Reporte diario + canal WhatsApp — **EN EJECUCIÓN: 6/7
  planes ejecutados (olas 1, 2, 3 y 4 completas). Falta solo 21-07 (prueba en
  vivo con el user, `autonomous: false`).**

  - **21-04 EXECUTED (2026-07-26)** — el panel del canal. Commits `e808f4d`
    (`#cmd-daily-report-panel` en `view-command`, admin-only, arriba de todo:
    chip de estado, detalle grupo/último envío/cola/desktop, hint de setup,
    mails de respaldo, interruptor de pausa y CTA "Mandar ahora" +
    `#team-leave-modal` + **cache-buster `app.js v=20260726a`**;
    `style.css` NO se tocó: cero clases CSS nuevas, todo del inventario del
    UI-SPEC), `f53c845` (`_cmdLoadReportPanel`/`_cmdReportPaint` con el chip por
    **precedencia determinística** de 6 estados; pausa con auto-guardado que se
    REVIERTE si el server no confirmó; mails con feedback inline; máquina de
    estados de "Mandar ahora" IDLE→CONFIRMING→SENDING→SUCCESS/QUEUED/FAILED/
    UNKNOWN→IDLE con `askConfirm` obligatorio, timeout de **cliente 60s** (el
    server corta a los 25s) y refetch del estado real al terminar; badge
    `Licencia hasta DD/MM` + `window._teamOpenLeaveModal` en Equipo, D-18) y
    `c1041e1` (evidencia de verificación + `deferred-items.md`).
    **Checklist a-f del plan 6/6 PASS · 111 checks / 0 fail**: 33 contra el
    preview con `DATA_DIR` aislado (HTML servido, los 3 endpoints, 403 de
    supervisor en los 4, 401 anónimo, `send-now` end-to-end →
    `{queued, sin_grupo}`) + 78 corriendo **el código REAL extraído de
    `public/app.js` contra un DOM stub** (no hay browser ni jsdom en el entorno;
    mismo método que el picker de 21-06). Detalle en `21-04-SUMMARY.md`.
    ⚠️ `status:'sent'` sigue sin ejercitarse contra WhatsApp real (necesita el
    `report:send-result` del desktop) y nada se vio en un browser de verdad.

  - **21-03 EXECUTED (2026-07-26)** — el automatismo encendido. Commits
    `560c295` (semanal mudado a **domingo 23:00** con ventana corrida a "la
    semana que TERMINA hoy" (D-13), `buildWeeklyReportTextShort` con el molde
    D-20 literal, extensión ADITIVA de `buildWeeklyReportData`
    (`calls.minutes/interested`, `perSetter.minutos/interesados`, `previous`,
    `neverStarted`), y los 3 hardening del `19-REVIEW`: **WR-01** el envío
    manual ya no suprime el automático — guard por PERÍODO en vez de ventana
    de 6 días, `lastManualWeeklySendAt` aparte; **WR-02** warn + dedup de
    `REPORT_EMAILS`; **WR-03** guard gemelo en memoria contra fallos de
    escritura del Volume), `bf56577` (`maybeRunDailyReportCron`: 23:00 hora de
    negocio, lun-vie SIEMPRE aunque el equipo esté en cero, sábado solo con
    actividad, domingo cede al semanal; UN solo registro de timers
    `_reportCrons`; los 3 endpoints admin `/api/admin/daily-report/{status,
    config,send-now}`) y `8174fab` (21 tests nuevos + `weekly-report`
    reescrito a la ventana nueva). Suite **945/945**.
    **Verificado por mutación** (el gate RED no era alcanzable con este orden
    de tasks): 6 mutaciones en 2 rondas → 7/21 y 14/39 tests rojos.
    Detalle en `21-03-SUMMARY.md`.
    ⚠️ Ningún cron corrió con el reloj real (todo con `nowTs` inyectado) y el
    `status:'sent'` de "Mandar ahora" no se ejercitó end-to-end (necesita el
    `report:send-result` del desktop) — eso es 21-07.

  - **21-06 EXECUTED (2026-07-26)** — picker del grupo + repack v0.5.11.
    Commits `261765a` (`detectors.allChats()` = `unreadChats()` sin el filtro
    de badge, cap 40; overlay `#scm-report-group-picker` dentro de WhatsApp
    Web: botón "Grupo de reportes" → lista de chats → click →
    `send('report-group-selected', {groupName, groupJid})` por el canal IPC
    que el main ya escuchaba desde 21-05; JID best-effort del `data-id`, si
    no se puede va `null` y el server lo backfillea; recordatorio de FIJAR el
    chat; filas con `createElement`+`textContent`, cero `innerHTML` → T-21-29)
    y `ad5fb79` (repack: copia del portable, backup del asar, extract con
    `@electron/asar@3` v3.4.1, copia de los 2 archivos, bump a 0.5.11, pack;
    README + referencia canónica del CONTEXT).
    **Artefacto (gitignored, NO está en git):**
    `wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe`
    · asar 104.152.630 B · backup
    `wa-multi/backups/app.asar-v0510-pre0511-20260726.bak` (md5 == asar de
    v0.5.10, que quedó intacto como rollback).
    Verificación del asar: re-extraído con **md5 idéntico** al `out/` de
    trabajo, `node --check` OK adentro, **13.546 entradas en ambos asars
    (mismo set exacto)**, aritmética de bytes exacta (+24.824 = +4 header
    padded + 24.820 de los 2 archivos → ningún otro archivo cambió) y fuse
    `EnableEmbeddedAsarIntegrityValidation` = **off** (el asar repackeado
    boota). **NO se corrió build** (2 de 8 archivos de `out/` con mtime de
    hoy, los otros 6 en Jun 1). Picker verificado con el código REAL extraído
    del archivo contra un DOM stub: **17/17 PASS** (no hay jsdom; no se
    instaló nada). Suite **918/918**. Detalle en `21-06-SUMMARY.md`.
    ⚠️ Sin verificar en vivo (queda para 21-07): pin en fila 0 (A1), `@g.us`
    en el `data-id` (A2) y si la sesión del login/WhatsApp sobrevive al
    cambio de carpeta de versión (A4).

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
    vendedoras, D-24), (c) abrir **`wa-multi-portable-v0.5.11`** (¡ya no la
    v0.5.10!), escanear el QR, clickear el botón **"Grupo de reportes"** abajo
    a la izquierda de la ventana de WhatsApp, elegir el grupo y **fijarlo
    (pin)** — el pin es lo que hace que el envío sobreviva a un rename.

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
  (7) **21-06 ejecutado**: el user ya puede elegir el grupo desde la ventana
  de WhatsApp sin copiar ningún identificador, y existe el binario
  `wa-multi-portable-v0.5.11` con todo el canal adentro (commits `261765a`,
  `ad5fb79`) — ola 2 cerrada.
  (8) **21-03 ejecutado**: el reporte ya sale SOLO — diario a las 23:00 con las
  reglas de día, semanal el domingo 23:00 por las dos vías, sin duplicados por
  período, y los 3 endpoints del panel listos (commits `560c295`, `bf56577`,
  `8174fab`; suite 945/945) — ola 3 cerrada.
  (9) **21-04 ejecutado**: el admin ya tiene el bloque del canal en Centro de
  Comando (estado + pausa + mails + **"Mandar ahora"**) y la licencia por SDR en
  Equipo (commits `e808f4d`, `f53c845`, `c1041e1`; 111 checks verdes,
  cache-buster `v=20260726a`) — ola 4 cerrada.

**Code review de la fase: `issues_found` — 3 BLOCKER + 16 warnings
→ 19/19 ARREGLADOS** (`21-REVIEW.md` commit `6b54588`; `21-REVIEW-FIX.md`
commit `3b48a20`, 14 commits de fix + repack `fffa455`). Suite **972/972**
(27 tests nuevos; los 4 flaky de `wa-campaign-engine` también pasaron).
Cache-buster → `app.js v=20260726b` (WR-15). Los 3 blockers eran:

- **CR-01** el guard de alcanzabilidad confundía el desktop con una pestaña del
  panel (`isUserConnected` miraba el Map `presence`, que también se puebla con
  sockets de cookie desde `public/wa.js`) → con wa-multi cerrado decía "Desktop
  conectada" y quemaba `sendAttempts` hasta `failed`. **Fix:** `presence` guarda
  `desktopSockets` + `isDesktopConnected` (el `io.use` ya marcaba
  `source:'desktop'|'browser'`, solo no se persistía). Sin el helper NO se emite.

- **CR-02** el picker guardaba el JID del chat ABIERTO, no del elegido → el grupo
  correcto quedaba con `jid-mismatch` permanente. **Fix:** el JID se manda solo si
  el header del chat abierto coincide con el nombre elegido; 2 `jid-mismatch`
  consecutivos des-fijan `groupJid` solos, + `PUT /config {groupJid:null}`.

- **CR-03** el `queueId` se reusaba entre intentos y el desktop no respondía al
  dedupear → el grupo podía recibir el reporte DOS veces. **Fix:** correlación por
  intento (`<itemId>#<n>`), un `ok` tardío CIERRA el item, y el desktop recuerda
  por item lo ya tipeado para re-confirmar sin volver a escribir.
Dos decisiones de criterio del fixer, ambas correctas y documentadas:
`composer-not-found` quedó **retryable** (el review pedía terminal, pero WR-07
prueba que es el reason que puede ser falso negativo de un envío EXITOSO — se
agregó `invalid-payload` como terminal de verdad); y **`data/reports.json` sigue
gitignored** a propósito: `queue`/`history` guardan el TEXTO de los reportes =
nombres y métricas individuales de las vendedoras (D-24), commitearlo dejaría
datos nominales de empleadas en el historial de git para siempre. Se corrigió el
comentario que afirmaba lo contrario. **Consecuencia asumida: si el volumen de
Railway se recrea, se pierde `config.transport` y hay que reelegir el grupo desde
wa-multi (2 min).** ⏳ Pendiente para el cierre de fase: anotar esto en CLAUDE.md.

**EXTRA fuera de plan (2026-07-26, pedido del user en vivo): wa-multi cierra a la
bandeja del sistema** (`21-EXTRA-tray-SUMMARY.md`, commits `90e56a7`/`2d9ca99`/
`d3466d6`). Antes `window-all-closed` hacía `app.quit()` en Windows: cerrar con la
X mataba el proceso y esa noche no salía el reporte. Ahora la X oculta, hay `Tray`
con menú Abrir panel / Abrir WhatsApp / Salir, y la X de la ventana de WhatsApp
oculta sin destruir (el camino programático `closeAccountWindow` sigue destruyendo,
con el force-destroy de v0.5.8 intacto vía flag `_scmForceClose`). Clave: el envío
tipea dentro de esa ventana, así que `withRestoredVisibility()` la muestra para
escribir y la vuelve a ocultar — envuelve `sendReportToGroup` **y** el camino por
DM. El harness (29/29, código literal extraído del archivo contra stubs de
Electron) atrapó que "Salir" NO habría cerrado la app: el `preventDefault` del
handler de v0.5.8 cancela un quit en curso → quedaba viva, sin ícono y solo matable
por el Administrador de tareas. ⚠️ **Sin probar hasta que el user abra el .exe: si
`sendInputEvent` es confiable inmediatamente después de un `show()` desde oculto.**
Si un reporte llega vacío o cortado con la ventana escondida, ese es el primer
sospechoso (mitigación: sleep extra tras `bringToFront` cuando venía oculta).
⚠️ El subject de `90e56a7` dice "(v0.5.12)" pero **NO existe una v0.5.12**: se
repackeó sobre v0.5.11 (aclarado en `2d9ca99`).

**Extras del reporte pedidos por el user (2026-07-26/27, ver CLAUDE.md #163):**
tiempo **ACTIVA** (bloques de 30 min con al menos una llamada — la presencia del
panel NO existe como dato: `lastSeen` se pisa, sin historial de sesiones) y
**"por llamar"** por vendedora (criterio `_leadPendingForOwner`, el mismo
unificado en #161; excluye a las que nunca arrancaron y a las de licencia), en el
diario, en la línea del consolidado y en el semanal corto. Los números se
cruzaron uno por uno contra `_ccFunnelAggregate` recalculado desde cero por SDR.
⚠️ `141 llam` son MARCADAS, no personas (141 marcadas sobre 136 leads distintos
ese día) — misma semántica que la columna "Marcó" de #162.
De paso, 3 tests dejaron de depender de la hora de la corrida: WR-12 (pedía la
semana anterior con `now - 7d`, pero la ventana se capa en el reloj recibido), el
fixture del semanal (llamadas en `now - 60s` caen en la semana previa durante el
primer minuto del lunes) y el flaky de medianoche de `followups` de la nota #93,
que **no era ambiental sino un fixture mal anclado** ("vencido ayer" es un bucket
de calendario, no un offset de horas). **Suite 990/990 a las 00:20 de un lunes**,
la hora que antes la ponía roja.

**Próximo paso:** **solo 21-07** (prueba en vivo con el user, `autonomous: false`).
⚠️ Si el `.exe` de wa-multi está abierto, CERRARLO y volver a abrirlo: el
`app.asar` se repackeó **3 veces hoy** (plan 21-06 → fixes del code review →
bandeja). El vigente es md5 `62fcec2a…`, 104.171.132 B. Cadena de rollback en
`wa-multi/backups/`: `app.asar-v0510-pre0511`, `-v0511-pre-reviewfix`,
`-v0511-pre-tray` (cada uno es el asar anterior a ese paso). Sin reabrir, la
prueba corre sin los fixes de CR-02/CR-03 y sin la bandeja.
Para la prueba en vivo ya no hace falta esperar a las 23:00: el botón
**"Mandar ahora"** del bloque "Reporte diario · WhatsApp" en Centro de Comando
manda en el acto (y funciona incluso con el interruptor de pausa puesto, por
decisión del UI-SPEC). El bloque arranca con el chip **"Sin configurar"** y el
botón deshabilitado hasta que el desktop elija el grupo — es el diagnóstico de
qué falta, no un error.
⚠️ Al deployar: los tabs abiertos siguen con `app.js?v=20260725c` hasta que
recarguen (el nuevo es `v=20260726b`; el banner de versión avisa solo, #152).
Recargar una vez antes de la prueba en vivo.
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
| 21 | Reporte diario + canal WhatsApp | REP-04..10 | **En ejecución 6/7 planes** (21-01 + 21-05 + 21-02 + 21-06 + 21-03 + 21-04 EXECUTED 2026-07-26, olas 1-4 completas; REP-04/09/10 completos, REP-05 builder + molde corto hechos y pendientes de validación del user, REP-06 con transporte desktop + cola server + setup del grupo + binario v0.5.11 + panel de config/diagnóstico listos, REP-07/08 completos del lado server. Falta solo 21-07: prueba en vivo con el user) |
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
  vendedoras**; (3) abrir `wa-multi-portable-v0.5.11` (repackeado en 21-06;
  la v0.5.10 queda como rollback), escanear el QR con ese número, elegir el
  grupo con el botón "Grupo de reportes", **fijar ese chat** y dejar la app
  abierta.
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
  → **21-03 las usa**: son el guard de entrada de los dos crons (más un gemelo
  en memoria, WR-03). El de `enqueueReportMessage` quedó como segunda línea.

- **21-03:** `config.paused` pausa lo **AUTOMÁTICO**, no los manuales: el tick
  sigue emitiendo items `kind:'custom'`/`'dm'` con la pausa puesta. Si no, el
  botón "Mandar ahora" quedaba inutilizado justo en su caso de uso (probar el
  canal antes de reactivar, decisión 1 del `21-UI-SPEC`). Sin pendientes
  emitibles sigue devolviendo `reason:'pausado'`.

- **21-03:** el período del semanal se consume **solo cuando el mail salió**. El
  corto al grupo se encola siempre (D-04) y su unicidad la garantiza el guard de
  `enqueueReportMessage`; así el mail conserva el reintento de Phase 19 sin que
  el grupo reciba dos mensajes del mismo período.

- **21-03:** el encabezado del semanal corto comprime el mes cuando la semana no
  lo cruza (`*Semana 20–26/07*`), como el molde literal que el user validó, en
  vez del `DD/MM–DD/MM` que describía el texto del plan. Semana entera sin
  llamadas → una línea (`Equipo sin llamadas en la semana`), mismo criterio que
  D-11 en el diario.

- **21-03:** `send-now` corta la espera en el acto si el motivo no se resuelve
  solo (`sin_grupo` / `desktop offline`); los casos ambiguos agotan el techo
  (`REPORT_SEND_NOW_WAIT_MS`, env, default 25s) y devuelven `queued/sending`.
  Ninguna rama puede responder sin `status`.

- **21-03:** la ventana nueva del semanal rompió 8 tests (7 de
  `weekly-report` + A4 de `metrics-consistency`, que afirmaba la ventana vieja).
  Se movieron los **fixtures**, no la feature — y los del semanal pasaron a
  offsets NEGATIVOS desde `now` (`now - 60000`): con la ventana capada a `now`,
  una hora fija del día habría hecho el test flaky según la hora de la corrida.

- **21-06:** antes de repackear se **diffeó** el `out/` de trabajo contra el
  archivo extraído del asar de v0.5.10 para confirmar el linaje. El preload
  tenía mtime del **Jun 10** (era v0.5.9) y v0.5.10 se armó el **Jun 12**: si
  v0.5.10 hubiera tocado el preload, copiar el de trabajo encima habría
  borrado ese cambio en silencio. Resultado: preload = v0.5.10 + 130 líneas
  agregadas y **0 quitadas**; main = v0.5.10 + los 2 reemplazos documentados
  de 21-05. **Regla para repacks futuros: diffear primero, copiar después.**

- **21-06:** un repack NO se verifica por grep de 2 strings. Se verifica por
  md5 de los archivos re-extraídos contra el `out/` de trabajo + `asar list`
  comparado contra el backup (13.546 entradas, mismo set) + aritmética de
  bytes del contenedor. Extra útil: el fuse
  `EnableEmbeddedAsarIntegrityValidation` del exe está en **off**, así que un
  asar repackeado siempre boota en esta build (es lo que hizo funcionar los
  repacks de v0.5.9 y v0.5.10).

- **21-06:** el picker no guarda nada del lado desktop (ni localStorage): la
  fuente de verdad del grupo es `reports.json` en el server y duplicarla
  crearía dos estados que pueden divergir. El overlay es un formulario de una
  sola vez, no un display de estado.

- **21-06:** los criterios de aceptación que se medían con
  `git status --porcelain wa-multi/...` no sirven (carpeta gitignored): la
  prueba de que no se corrió `npm run build` se hace con **mtimes de todo
  `out/`** (2 de 8 archivos de hoy, 6 en Jun 1).

- **21-04:** los botones de una tabla generada por JS NO llevan `onclick` con el
  nombre interpolado. Un valor de atributo se **decodifica como HTML antes de
  evaluarse como JS**: `escHtml("O'Brien")` → `O&#39;Brien` → el parser JS ve
  `'O'Brien'` y tira `SyntaxError` (botón muerto para esa fila, no XSS). El
  handler se cablea con `addEventListener` sobre el nodo — mismo motivo por el
  que `_teamRenderTable` ya pintaba el nombre con `textContent`.

- **21-04:** las fechas tipo `'YYYY-MM-DD'` NO se comparan con `Date` en el
  frontend. `new Date('2026-07-26')` es medianoche **UTC** y contra la medianoche
  **local** el último día de una licencia se lee como vencido en AR (UTC-3) —
  panel y reporte diciendo cosas distintas de la misma persona. Se compara el
  string de día, inclusive, igual que `_reportOnLeave` del backend; el `DD/MM`
  del badge sale de `slice`.

- **21-04:** si un estado de error pinta con `textContent` sobre un contenedor
  que tiene ids adentro, el pintado siguiente tiene que poder **reponer el
  esqueleto** (markup constante, sin interpolación) — si no, un 500 transitorio
  deja el bloque muerto hasta un F5 porque todos los `getElementById` devuelven
  `null` para siempre.

- **21-04:** un interruptor booleano del panel se **revierte** si el server no
  confirmó el guardado. Un checkbox que dice "pausado" sobre un canal que sigue
  mandando es peor que no tener el checkbox.

- **21-04:** cada `reason` que devuelve el backend merece su propio texto. El
  `queued` genérico ("la computadora está apagada") habría mentido en los 4
  casos nuevos de 21-03 (`sin_grupo`, `busy`, `sending`, `fallback_dm`) —
  incluido el peor: mandar a prender una computadora que ya está prendida
  mientras el mensaje se está tipeando.

- **21-04:** sin browser ni jsdom en el entorno, la UI se verifica extrayendo el
  bloque REAL de `public/app.js` por marcadores de texto y corriéndolo contra un
  DOM stub (mismo método que el picker de 21-06). Verifica el código que se
  commitea, no una copia — y atrapó los 5 bugs de esta sesión.

---

## Decisiones de ejecución (Phase 24)

- **24-01:** la extracción verbatim de rangos grandes (107 y 124 líneas,
  sensibles a backticks/regex/espacios) se hizo con scripts Node.js que
  validan el contenido exacto ANTES de mover (`if (block[0] !== '...') throw`)
  y aplican las sustituciones mecánicas por match exacto con conteo esperado
  (`exactReplace` con `expectedCount`), en vez de transcripción manual vía
  Edit — elimina el riesgo de error humano en un refactor cuyo contrato es
  "cero cambios de comportamiento". El repo usa terminadores CRLF; el script
  los preserva.

- **24-01:** el test de paridad doble-vía (`tests/apply-call-outcome.test.js`)
  usa un lead "B" en memoria para el lado del helper directo, en vez de leer/
  escribir `setters.json` a mano en paralelo al server real — evita depender
  de la resolución de mtime del cache de `loadSettersData` en Windows (fuente
  de flakiness evitable). `nowIso` se sincroniza tomando el `lastContactAt`
  real devuelto por la vía HTTP; `callbackAt` auto-generado por la cadencia
  (usa `Date.now()` real, código verbatim sin tocar) se compara con tolerancia
  de reloj (5s) en vez de igualdad estricta.

- **24-01:** `gsd-sdk query roadmap.update-plan-progress` no reconoce el
  formato de tabla custom de `ROADMAP.md` de este milestone (`# | Phase |
  Reqs | Depende de` sin columna de plans/status) — sobrescribe las columnas
  Phase/Reqs con `plan_count`/`status`, perdiendo información. Se revirtió esa
  fila manualmente tras correr el comando (el comando SÍ marcó bien el
  checkbox `- [x] 24-01-PLAN.md` en la lista de Wave 1, que es lo que importa).
  `requirements.mark-complete` y el recálculo de `progress:` en el frontmatter
  de `STATE.md` (vía scan de `SUMMARY.md` en disco) funcionaron correctos. Si
  se vuelve a correr `roadmap.update-plan-progress` sobre este milestone,
  revisar la fila del `## Resumen` después.

- **24-02:** `gsd-sdk` no está en PATH en este entorno (confirmado también en
  el `_notes` de `.planning/config.json`) — todos los commits, el SUMMARY, y
  las actualizaciones de STATE.md/ROADMAP.md/REQUIREMENTS.md de este plan se
  hicieron manualmente con git + Edit, sin invocar `gsd-sdk query`.

- **24-02:** `VOICE_AGENT_SETTER_NAME`/`VOICE_AGENT_SETTER_ID` se declararon
  junto al seed de boot (index.js ~6716, inmediatamente después de
  `mutateSettersData`), NO dentro del bloque de config de Retell (~14190)
  donde el plan las agrupaba conceptualmente. `const` no hace hoisting (a
  diferencia de las `function` declarations que sí se usan en el resto del
  archivo) — declararlas solo en el bloque de Retell habría hecho que el seed
  de boot, que corre antes en el orden de ejecución del módulo, lanzara
  "Cannot access before initialization". El bloque de Retell las referencia
  sin redeclararlas.

- **24-02:** `GET /api/admin/export-data` lee `retellConfig` CRUDO del disco
  (no vía `loadRetellConfig()`, que aplica el overlay de env vars) — a
  diferencia de Telnyx, que sí exporta el valor overlayeado. Necesario para
  cumplir el requisito explícito del plan ("el export NO incluye el valor
  del apiKey cuando viene de env"): reusar `loadRetellConfig()` tal cual
  habría filtrado el secret efectivo de Railway en el JSON de respuesta.
  Verificado por test dedicado en `tests/retell-config.test.js`. No se tocó
  el comportamiento de `telnyxConfig` en el export (fuera de alcance).

- **24-02:** el hueco de `seedVolumeFromRepo` para los archivos de Telnyx
  (`telnyx_config.json`/`telnyx_events.json`, documentado por el research
  §5.2) se dejó intacto a propósito — solo se agregaron `retell_config.json`/
  `retell_events.json` al array. Arreglar el hueco de Telnyx habría sido un
  cambio de comportamiento fuera de alcance de este plan.

---

*Last updated: 2026-07-31 (24-02 ejecutado — config Retell env>JSON clonada
del patrón Telnyx, endpoints admin-only `GET`/`PUT /api/retell/config` con
409 env-sourced + self-healing, `retell_config.json`/`retell_events.json`
en las 5 superficies de la regla #21, pseudo-SDR `setter_agente_ia`
sembrado en boot con fila comparable en Equipo. 26 tests nuevos, suite
completa 1046/1046 verde. VOICE-01/VOICE-06 completados. Próximo: 24-03,
dispatch por lote + caller ID server-side).*
