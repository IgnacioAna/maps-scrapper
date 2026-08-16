---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: Seguimiento bajo control
status: executing
last_updated: "2026-08-16T06:00:00.000Z"
last_activity: 2026-08-16
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 22
  completed_plans: 22
  percent: 100
---

# SCM — STATE

> Estado vivo del proyecto. Actualización: 2026-08-13.

---

## Current Milestone

**v4.0 — Seguimiento bajo control** (iniciado 2026-08-13)

Ignacio trabaja solo toda la base (se disolvió el equipo de vendedoras).
El objetivo es que no se le caiga un lead: un solo objeto de próxima
acción por lead, compromisos hablados como objetos del sistema, y Power
Dialer + Hoy + Llamadas comportándose como una sola herramienta.
Phases 28-34. Fuente de verdad de los requisitos:
`.planning/research/2026-08-13-requisitos-seguimiento-ignacio.md` (R1-R8,
dichos por el user). Estado del código de partida:
`.planning/research/2026-08-13-estado-seguimiento-para-investigar.md`.

**Baseline medido (12/08)**: 36 interesados (mediana 21 días sin avanzar),
16 callbacks manuales con 12 vencidos, 137 leads tocados sin próxima
acción, 3 leads con `followUps` viejo. La métrica de higiene arranca en
137 y el objetivo es 0.

## Current Position

Phase: 34 (hoy-vista-diaria) -- sin plan generado todavia (0/TBD en
  ROADMAP.md, requiere discuss-phase/plan-phase). Directorio
  `.planning/phases/34-hoy-vista-diaria/` ya existe pero vacio de PLAN.md
  al cierre de Phase 33.
Plan: N/A -- ultimo trabajo cerrado es 33-04 (ver bloque "Phase 33
  COMPLETE" mas abajo)
Status: **Phase 33 (DIAL) COMPLETA (4/4 planes, 2026-08-16)**. DIAL-01..04
  marcados [x] en REQUIREMENTS.md. ROADMAP.md actualizado a mano (Phase 33
  Complete 4/4, gsd-sdk no disponible en este entorno -- riesgo de
  corrupcion documentado en 24-04/29-02/29-03/29-04/31-03/31-04, edicion
  manual + git diff antes de commitear).
  33-04 (DIAL-04, ficha con historial de las vendedoras al frente) cerro
  en 3 commits: ad04823 (backend, _buildUserNameMap + userNames en
  GET /leads/sin-wsp), a43e4be (bloque [33-04] HISTORY-PURE +
  _leadHistoryHTML cableado en _pdRender/window._leadFileHtml/
  _callsRenderExpandedPanel), y 41636b3 (49 tests en
  tests/dial-history.test.js + cache-buster app.js 20260816c->20260816e,
  cierre de una sesion posterior a la que corto el proceso tras el
  codigo). Verificado con gsd-verifier (33-VERIFICATION.md): 4/4
  requirements con evidencia de codigo real (no solo SUMMARY), D-09
  respetado (0 literales de suscripcion/Proxy en public/app.js,
  _leadStoreApply sigue siendo mutador directo), npm test 1801/1801 (106
  archivos), veredicto human_needed solo por 4 items visuales/en-vivo sin
  browser en el entorno (ninguno bloqueante).
  33-01 EXECUTED (DIAL-01): _pdDialHere + startAtLeadId + _pd.forced,
  boton "Discar aca" en las 4 superficies.
  33-02 EXECUTED (DIAL-02): _pdHold unico camino al hold + _pd.pendingSave
  senal deterministica, elimina la heuristica stillActionable.
  33-03 EXECUTED (DIAL-03): _hoyRenderFromStore (Hoy se pinta desde el
  estado, no desde fetch) + _leadStoreVersion/_leadStoreDirty +
  _callsShowView/_hoyShowView (repintar al mostrar si hay datos frescos
  <5min, LEAD_STORE_STALE_MS) -- sin el store reactivo completo (limite
  D-09, deliberadamente NO construido).
  33-04 EXECUTED (DIAL-04): detalle completo en el bloque de abajo (el
  que era "Current Position" hasta este cierre).

## Phase 33 (dial-motor-unico): COMPLETE (4/4 planes, 2026-08-16)

Plan: 4 of 4 -- las 4 con SUMMARY (33-01-SUMMARY.md, 33-02-SUMMARY.md,
  33-03-SUMMARY.md, 33-04-SUMMARY.md)
Status: 33-03 ejecutado (commits a4b8435 _hoyRenderFromStore, bf435fe
  incluye tambien el codigo de la Task 2 de este plan -- commiteado por
  una sesion PARALELA que corrio git commit sobre public/app.js al mismo
  tiempo, ver detalle abajo --, ba81ffd commit propio de la Task 2 que
  quedo sin contenido propio pero con 2 hunks ajenos de color sin
  relacion con DIAL-03, 7a8ddbf Task 3 suite+cache-buster). DIAL-03
  completo: Power Dialer, Hoy y Llamadas comparten una sola escritura
  (_leadStoreApply, ya existia desde Phase 13) y ahora tambien un solo
  renderer para Hoy que se repinta sin fetch.
  function _hoyRenderFromStore(leadsArg) (app.js:5959-6049): extraida de
  loadHoyView -- clasificacion de las 4 secciones (Mis compromisos/
  Esperando del prospecto/Callbacks/Interesados sin agendar) + el
  secEl.innerHTML, TAL CUAL, movido fuera del fetch. Cero fetch(/await en
  el cuerpo. Sin leadsArg, la poblacion es la union de _hoyLeadIds
  (ultimo fetch) + _leadStoreDirty (ids escritos despues), resuelta
  contra _callsLeadsById y respetando el filtro de SDR activo (un id
  sucio de otro SDR no entra si hay filtro puesto). Guard anti-repintado
  redundante: sin leadsArg, misma _leadStoreVersion que la ultima
  pintada y seccion ya con contenido -> sale sin rehacer innerHTML.
  loadHoyView (app.js:6051-6118) quedo como fetch+upsert+delegar: setea
  _hoyLeadIds/_hoyFetchedAt, limpia _leadStoreDirty (fetch trae todo
  fresco), llama _hoyRenderFromStore(leads), y recien despues pinta el
  bloque de KPIs (el unico trozo que NO se movio -- depende de un
  endpoint aparte). _leadStoreApply instrumentado: _leadStoreVersion++ +
  _leadStoreDirty.add(id) al final de cada escritura exitosa;
  window.__leadStoreVersion expuesto para diagnostico en vivo.
  _callsShowView()/_hoyShowView(): los listeners de menu de Llamadas/Hoy
  repintan desde el estado si hay datos frescos (< LEAD_STORE_STALE_MS,
  5 min) y solo fetchean si no. _refreshLeadPanels/_dispoAfterSaved/
  window._actDiscard: el guard de "Hoy visible" paso de loadHoyView()
  (fetch) a _hoyRenderFromStore() (repintado desde el store, ya escrito
  por _leadStoreApply unas lineas antes). _pdExit NO cambia a proposito
  (comentario explicito: salir del dialer es el refresco EXPLICITO de la
  sesion completa). Limite D-09 verificado con test dedicado: no aparece
  ningun literal de suscripcion/Proxy en el archivo -- la escritura sigue
  siendo un mutador directo, no un store reactivo multi-vista.
  34 tests nuevos en tests/dial-sync.test.js (>=16 pedidos). Verificacion
  por mutacion: romper un titulo literal en _hoyRenderFromStore puso en
  rojo exactamente 3/42 tests de tests/commitment-hoy.test.js (los 3
  anti-deriva esperados), restaurado, diff vacio confirmado (solo mi
  linea, sin tocar hunks ajenos). Suite completa: 1752/1752 (baseline
  1718 de 33-02 + 34 nuevos), 2 corridas completas.
  Deviations (4 auto-fixed, Rule 1): (1) typo propio
  (compromisosProspecto: undefined colado al mover el bloque _hoyState)
  atrapado y corregido antes de correr ningun test; (2) _leadStoreDirty
  se referenciaba desde la Task 1 pero nunca se declaro -- bug latente no
  detectado por node --check (no es error de sintaxis) ni por los tests
  de fuente de la Task 1/2 (no ejecutan _hoyRenderFromStore); cerrado en
  la Task 3 declarandolo junto a _leadStoreApply, exactamente donde esa
  misma task ya lo pedia; (3) y (4) 2 assertions PRE-EXISTENTES (Fase 31
  y Fase 32, no de este plan) pineaban loadHoyView()/dentro-de-
  loadHoyView literal para codigo que la Task 1/2 de ESTE plan mueve
  explicitamente a _hoyRenderFromStore -- imposible satisfacer a la vez
  "mover el codigo" y "0 diff en esos tests" tal como estaban escritos;
  verificado empiricamente corriendo el <verify> del plan tal cual antes
  de decidir, actualizadas las 4 assertions afectadas (3 en
  commitment-hoy.test.js + 1 en act-ui-discard-material.test.js) al
  minimo necesario, preservando el proposito de cada una.
  Issue de proceso (no bug de codigo): una sesion PARALELA corrio
  git commit sobre public/app.js (+index.html+style.css) entre mis Tasks
  1 y 2 (commit bf435fe, "verde acento a senal") usando git add/commit
  amplio -- arrastro de paso mis cambios sin commitear de la Task 2 al
  mismo archivo compartido (el propio mensaje de bf435fe lo reconoce
  explicitamente). Mi commit de la Task 2 (ba81ffd) quedo vacio de
  contenido propio pero con 2 hunks ajenos de color bajo mi mensaje --
  sin perdida de trabajo ni regresion, solo atribucion de commit
  incorrecta para esos 2 hunks puntuales; no se intento revertir (nunca
  destructivo, sesion concurrente activa). Para la Task 3, antes de cada
  git add revise git diff completo y arme patches parciales
  (git apply --check --cached + git apply --cached) con SOLO mis hunks
  (5 en app.js, 1 en index.html -- el cache-buster), dejando el resto del
  working tree intacto para la otra sesion. DIAL-03 completo
  (REQUIREMENTS.md marcado [x]). ROADMAP.md actualizado a mano (Phase 33
  3/4 planes, Wave 3 con SUMMARY).
Resume file: None
Last activity: 2026-08-16 -- Phase 33 Plan 4 (DIAL-04, ficha con
  historial de las vendedoras al frente) completado. **Fase 33 (DIAL)
  COMPLETA (4/4 planes)**.
  33-04 se corto a mitad de proceso: el codigo (backend
  _buildUserNameMap+userNames, commit ad04823; bloque
  [33-04] HISTORY-PURE + cableado en las 3 superficies, commit a43e4be)
  quedo commiteado sin tests ni cache-buster. Una sesion posterior cerro
  el plan (commit 41636b3, co-autor Claude Opus 5): 49 tests nuevos en
  tests/dial-history.test.js, cache-buster app.js 20260816c->20260816e.
  Ese mismo commit de cierre volvio a arrastrar ~15 hunks de la sesion
  paralela de disciplina de color (var(--accent) -> tokens neutros) que
  estaban sin commitear en el mismo working tree compartido -- mismo
  patron de contaminacion que bf435fe en 33-03, verificado que no toca
  nada del bloque HISTORY-PURE ni su cableado (detalle completo en
  33-04-SUMMARY.md, seccion Deviations).
  _buildUserNameMap(ids) (index.js, junto a _buildUserSetterMap): solo
  los ids pedidos, solo u.name, nunca email (T-33-12).
  GET /api/setters/leads/sin-wsp devuelve {leads, userNames} (shape
  aditivo). Bloque [33-04] HISTORY-PURE: _leadHistoryBrief (pura, reloj
  por parametro, D-12 sin historial no hay bloque, D-13 nunca lee
  transcript, regla dura de 31-04 -- compromiso solo si estado ALMACENADO
  'pendiente') + _leadHistoryHTML (builder de superficie, escHtml en toda
  interpolacion, sin emojis) cableado en _pdRender (debajo del header),
  window._leadFileHtml (primer row) y _callsRenderExpandedPanel (antes
  del brief, reusado por la ficha de Hoy).
  Cerrado con gsd-verifier: 33-VERIFICATION.md, PASSED a nivel de
  codigo/funcionalidad (status human_needed solo por 4 items visuales en
  vivo sin browser, ninguno bloqueante). npm test 1801/1801 (106
  archivos) confirmado en 2 corridas limpias. D-09 verificado
  independientemente por el verificador (grep propio, no confio en la
  afirmacion del SUMMARY): 0 literales de suscripcion/Proxy, la escritura
  sigue siendo un mutador directo sobre _leadStoreApply.
  DIAL-01..04 completos (REQUIREMENTS.md marcado [x] los 4). ROADMAP.md
  actualizado a mano (Phase 33 Complete 4/4, gsd-sdk no disponible en
  este entorno). Siguiente: Phase 34 (hoy-vista-diaria) -- sin plan
  generado todavia (0/TBD en ROADMAP.md, requiere discuss-phase/
  plan-phase).

Phase 32 (act-acciones): **COMPLETE** (4/4 planes, 2026-08-15)
Plan: 4 of 4 -- las 4 con SUMMARY (32-01/32-02/32-03/32-04)
Status: 32-04 ejecutado y commiteado (commits adf3e55 descarte,
  9bf6503 material por email). window._actDiscard(leadId): overlay de
  un solo paso (razon opcional via DISQUALIFY_REASONS_UI + checkbox DNC)
  -- POST .../discard -> _leadStoreApply -> _dispoAnnounce(forceToast:
  true) -> _pdAdvance si es la tarjeta actual del Power Dialer -> refresh
  de Hoy si es la vista visible; NUNCA _dispoAfterSaved (no toca el gate
  de la Phase 20). _actButtonsHTML gana el boton Descartar en las 4
  superficies (mismo builder que WhatsApp, sin multiplicar los call
  sites): un lead ya descartado muestra el chip .scm-chip-blocked (gris,
  icono + etiqueta, nunca rojo -- D-16) en vez del boton. renderCallsList
  marca la fila descartada con .scm-row-blocked; los telefonos de la
  lista y de Hoy llevan class="scm-phone" (tachado automatico via CSS ya
  existente, no tocada). loadHoyView: las 2 secciones de compromiso
  ("Mis compromisos"/"Esperando del prospecto") filtran !terminal(l) --
  un lead descartado por otra via (bulk admin, answered_not_interested)
  ya no queda flotando ahi para siempre; es la red que hace verdadera la
  promesa de ACT-04 ("sale de todas las listas de una"). window.
  _actSendMaterial(leadId): overlay gemelo del de WhatsApp (Para/
  Plantilla/Asunto/Mensaje editables, reusa ACT_WA_TEMPLATES +
  _interpolateScript de 32-03), dos CTAs visibles a la vez (D-15):
  "Mandar por el sistema" (via:'resend') y "Abrir mi cliente de mail"
  (via:'mailto', window.open del mailtoUrl). 409/resendUnavailable y 502
  no registran nada del lado del cliente; 200 hace _leadStoreApply +
  _dispoAnnounce(forceToast) -- sin _pdRender (el envio programa
  nextAction a +48h, mismo criterio que 32-03). El link mailto viejo de
  la ficha (sin registro, cuerpo vacio) se reemplazo por el boton
  "Mandar material", siempre visible con o sin lead.email.
  _renderCallHistory distingue "por WhatsApp"/"por email" en la linea
  del compromiso cerrado (mismo timeline, ACT-05). Cache-buster app.js
  20260815i -> 20260815j (style.css intacto, git diff vacio). Verificacion
  por mutacion: romper el !terminal(l) de una de las 2 lineas de Hoy puso
  en rojo exactamente 1/44 tests nuevos; restaurado con git checkout --
  public/app.js, diff vacio confirmado. 44 tests nuevos en
  tests/act-ui-discard-material.test.js (>=19 pedidos, 0 ocurrencias del
  literal de fecha pineado). Suite completa: 1663/1663 (1583 en la
  corrida en paralelo + 80 de 7 archivos no relacionados que dieron hook-
  timeout por contencion de recursos bajo carga total y pasaron 80/80 al
  re-correrlos aislados -- ninguno toca app.js/index.js de esta fase, ver
  detalle en 32-04-SUMMARY.md). ACT-01..05 completos (REQUIREMENTS.md
  marcado [x]). ROADMAP.md actualizado a mano (Phase 32 Complete 4/4,
  gsd-sdk no disponible en este entorno).
Resume file: None
Last activity: 2026-08-15 -- Phase 32 Plan 4 (frontend descartar +
  material por email) completado, ACT-04/05 cerrados. **Fase 32 (ACT)
  COMPLETA (4/4 planes)**. Siguiente: Phase 33 (dial-power-dialer) --
  sin plan generado todavia (0/TBD en ROADMAP.md, requiere plan-phase).

Phase 31 (comm-compromisos): **COMPLETE** (4/4 planes, 2026-08-15). D-10:
  dos secciones nuevas en Hoy ("Mis compromisos" / "Esperando del
  prospecto") derivadas client-side del mismo array que loadHoyView ya
  trae. D-11: _renderCallHistory suma un 3er kind ('commitment') a la
  timeline unificada del lead. Tests: tests/commitment-hoy.test.js (42).
  Suite completa al cierre de la fase: 1512/1512. Cache-buster app.js
  bumpeado a 20260815g (style.css intacto). COMM-01..04 completos.
Phase 30 (gate-proximo-paso): 3/3 planes ejecutados, VERIFICATION: human_needed (18/18
  must-haves en codigo+tests, 1365/1365 tests verdes en su momento; 30-HUMAN-UAT.md con 7 items
  pendientes de click real en browser -- no bloquea el arranque de Phase 31, que depende de
  Phase 29, no de Phase 30).
Phase 29 (NEXT — El reloj único): **COMPLETE** (4/4 planes, 2026-08-14).
Phase 28 (QUICK — Alivio inmediato): **COMPLETE** (3/3 planes, 2026-08-14).

## Milestone v3.0 — PARKEADO (2026-08-13)

Agente de voz IA (Retell + SIP trunk Telnyx). **No estaba frenado por
código**: el plan 26-03 quedó en un checkpoint que depende de que el user
haga el setup en los dashboards de Telnyx y Retell (mover el número
`+17867725783` al trunk FQDN e importar el agente). Phase 24 ejecutada
5/5; 25, 26 (2/6) y 27 sin terminar.

Todo archivado en `.planning/archive/v3.0-agente-voz/` (phases + ROADMAP +
REQUIREMENTS). **Se retoma después de v4.0**, y hay una razón técnica para
ese orden: el webhook del agente escribe por `_applyCallOutcome`, el mismo
modelo que v4.0 rediseña — integrarlo antes obligaría a rehacerlo.

## Pending todos (heredados de v2.0 — NO bloquean v4.0)

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

- **Status:** Executing Phase 30
  todo lo automatizable verificado (endpoints, guard, bifurcación
  enteredActive||committedRemote, D-04 intacto por diff, suite
  **864/864**); quedan 3 ítems humanos en `20-HUMAN-UAT.md` (llamada
  Telnyx real, % marcada tras 1 semana en prod, feedback SDRs).

- **Last activity:** 2026-08-15
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

- **24-03:** `_retellDynamicVariables(lead, retellCfg)` mantiene la firma de
  2 argumentos exacta del plan leyendo `lead.id` — el caller (el handler del
  dispatch) le pasa `{ id, ...lead }` en vez de que el helper reciba un
  tercer parámetro `leadId`. Verificado por grep que `data.leads[id]` NO
  trae `.id` embebido de forma consistente en el resto del código base
  (solo un puñado de endpoints hacen spread explícito `{id, ...lead}}`), así
  que mergear el id en el punto de llamada evita cambiar el contrato
  documentado en `<interfaces>` del plan.

- **24-03:** el rollover del cap diario (`_voiceDispatchRollover`, compara
  contra `_bizDayStr(Date.now())`) se invoca en 2 puntos exactos, tal como
  pide el plan: al principio del handler (antes de leer `remaining`) y de
  nuevo justo antes de sumar los éxitos a `_voiceDispatchedToday.count` —
  cubre el caso borde de que el dispatch cruce la medianoche de negocio
  mientras el pool de fetches está en vuelo. El contador se muta in-place
  (`.dayKey`/`.count`, nunca reasignado) para que la referencia expuesta en
  `globalThis.__voiceAgent` siga siendo la misma tras cada rollover — los
  tests de `tests/retell-dispatch.test.js` simulan el cambio de día
  escribiendo directamente sobre ese objeto, sin esperar 24 horas.

- **24-03:** el caller ID se resuelve SECUENCIALMENTE (loop síncrono antes
  de correr `_runPool`), no dentro de los thunks paralelos — la rotación
  round-robin necesita determinismo: cada lead recibe su número ya decidido
  antes de que el pool dispare las llamadas en paralelo (conc 2).

- **24-03:** el fixture de test usa un lead adicional en estado terminal
  (`lead_precalled`, `estado:'agendado'`) con una entry de callLog de HOY
  atribuida al agente, para simular "ya se hizo 1 llamada hoy" sin
  contaminar la selección de los 3 leads elegibles (el estado terminal lo
  excluye de `_leadIsCallableNow` mientras su callLog sigue contando para
  `_retellCallsTodayCount`). Esto deja el baseline `calledToday=1`
  CONSTANTE durante todo el archivo de test — ningún dispatch (dry-run ni
  real) escribe callLog (D-24-05) — lo que permite fórmulas de
  `capRemaining` deterministas en cada test sin resets intermedios.

- **24-04:** el comentario de cabecera de `/api/retell/tool/book` evita
  repetir el literal de la ruta (se describe como "la custom function
  book" en prosa) para que el grep de verificación del plan ("devuelve 1
  ruta") no ambigüe entre el comentario y la declaración real de la ruta.

- **24-04:** resolución de `leadId`/`args` del tool `/book` tolerante a las
  2 formas de payload documentadas por Retell (research §2.2.b):
  `hasCallWrapper = typeof body.call === 'object'` decide si `args` es
  `body.args` (modo normal) o el `body` completo (modo "args only", donde
  el payload ES directamente los args). `leadId` se busca en ese orden:
  `call.retell_llm_dynamic_variables.leadId` → `call.metadata.leadId` →
  `args.leadId` — el tercer fallback cubre tanto un eventual parámetro
  `leadId` en `args` como el caso "args only" sin ningún objeto `call`.

- **24-04:** `_retellParseBookingDate` no asume un formato fijo de
  fecha/hora (el schema de la function no está definido hasta Phase 26):
  prueba `fecha+hora` combinadas con `T` y con espacio antes de caer a
  fecha sola, vía `Date.parse`. Tolerancia amplia preferida sobre un
  parser estricto — un rechazo falso-positivo deja al agente sin poder
  agendar una fecha válida a mitad de una llamada real.

- **24-04:** `_pendingBooked` es un Map de módulo separado de
  `_pendingRetellCalls` (24-03) — representan contratos distintos ("esta
  llamada fue dispachada" vs "esta llamada ya tiene una cita creada") que
  el plan 24-05 va a consultar independientemente. Mismo patrón de
  TTL+cleanup-en-cada-invocación que 24-03, sin timer de fondo.

- **24-04:** el shell del webhook NO hace lookup de lead ni valida que
  `leadId` exista — a propósito: el research (§5.3) exige responder rápido
  (Retell corta a los 10s) y el mapeo de outcome/lead es responsabilidad
  exclusiva del plan 24-05, que se engancha en el marcador de inserción
  `// [24-05] punto de inserción del procesamiento de la llamada`, ANTES
  del `res.status(200)`.

- **24-04:** el cap de 4000 chars sobre `raw` (el `call` reducido que se
  persiste en `retell_events.json`) trunca el STRING serializado, no
  re-parsea a objeto — un JSON truncado a mitad de camino puede quedar
  inválido, pero es preferible a perder silenciosamente datos de
  diagnóstico con un `JSON.parse` que falla. `raw` queda como string, no
  como objeto.

- **24-04:** intento de `gsd-sdk query state.advance-plan`/
  `state.update-progress` para esta actualización de STATE.md: ambos
  comandos existen y corren (el binario SÍ está en PATH en esta sesión,
  a diferencia de lo que registraron 24-02/24-03), pero `state.advance-plan`
  devuelve `{"error":"Cannot parse Current Plan or Total Plans in Phase
  from STATE.md"}` y `state.update-progress` escribió sobre el archivo
  igual pese al error reportado, CORROMPIENDO `last_activity` (lo cortó a
  mitad de oración) e insertando saltos de línea sueltos en párrafos ya
  escritos — revertido con `git checkout -- .planning/STATE.md` antes de
  commitear nada. Confirma el `known_tooling_issue` para STATE.md además
  de para `roadmap.update-plan-progress`: el formato custom de este
  milestone no es compatible con ninguno de los 3 comandos de estado.
  Actualización 100% manual, mismo patrón que 24-02/24-03.

- **24-05:** el catálogo de `disconnection_reason` enumerado literal en
  `24-RESEARCH.md §2.3` y en `24-05-PLAN.md` trae 34 strings distintos,
  verificado programáticamente (`node -e` contando el split por `·`) —
  ambos documentos lo describen como "32 valores" en la prosa, un desfase
  de conteo de la planificación, no una instrucción de recortar 2 valores
  reales de la API. Se mapearon los 34 sin dejar ninguno afuera (dejar 2
  fuera de la tabla los habría hecho caer silenciosamente al
  `console.warn` de "desconocido" en producción). Documentado como
  deviation en `24-05-SUMMARY.md`, con test dedicado que assertea el
  conteo contra el catálogo copiado literal del research.

- **24-05:** el acceptance criterion de grep sobre `skipCalendarCreation`
  ("exactamente 2 líneas") no se cumple literalmente porque ya había 3
  comentarios de 24-01/24-04 mencionando la palabra antes de este plan
  (no se tocaron, no son responsabilidad de esta task). El chequeo que sí
  importa — `grep skipCalendarCreation | grep -c booked` → `0`, ninguna
  ocurrencia deriva de `booked` — se verificó y pasa, reforzado por los 2
  tests de booking (con `/book` no duplica, sin `/book` sí crea la cita).

- **24-05:** para mantener el patrón de un commit por Task pese a que
  Task 1 y Task 2 insertan código en el MISMO bloque contiguo de
  `index.js` (el marcador de 24-04 vive justo ahí), se aplicó primero
  solo el contenido de Task 1 vía `Edit`, se commiteó, y recién después se
  insertó el contenido de Task 2 encima con un segundo `Edit` — en vez de
  escribir todo junto y tratar de partir el diff resultante en 2 commits
  (que hubiera requerido reconstruir el patch a mano, con más riesgo de
  error que simplemente aplicar los cambios en 2 pasadas separadas).

- **24-05:** `_retellDecideOutcome` recibe `booked` ya resuelto por el
  caller (`_retellProcessCallEvent`) en vez de leer `_pendingBooked`
  directo — mantiene el helper de Task 1 puro y testeable sin I/O ni
  estado de módulo; la única lectura real de `_pendingBooked` vive en el
  pipeline de Task 2, junto a `pendingEntry` (la variable que sí decide
  `skipCalendarCreation`).

---

## Decisiones de ejecución (Phase 29)

- **29-01:** `_clearNextAction` (Task 1) contiene su propia asignación
  literal `lead.callbackAt = '';` en el cuerpo — es la implementación exacta
  del contrato de `<interfaces>` del plan. El grep de la acceptance criteria
  de Task 2 esperaba "exactamente 5"/"exactamente 2" ocurrencias de
  `callbackAt = ''` (sin contemplar que el propio helper se auto-cuenta);
  el resultado real es 6/3. Verificado que el invariante real que la
  acceptance criteria protegía (ningún writer FUERA de `_clearNextAction`
  asigna `callbackAt=''` directo, fuera de `_applyCallOutcome`) se cumple
  igual — los 5 writers de la Task 2 ya NO tienen asignación directa, todos
  pasan por `_clearNextAction(...)`. Detalle completo en `29-01-SUMMARY.md`.
  **Para 29-02/29-03/29-04**: si agregan otro grep de conteo exacto sobre
  `callbackAt = ''`, recordar que `_clearNextAction` (index.js ~10698) es
  un match legítimo, no un writer sin cubrir.

- **29-01:** `_applyCallOutcome` quedó en el rango **10767–10938** tras los
  edits de este plan (la Task 1 insertó ~150 líneas de modelo ANTES de la
  función, corriendo todo lo posterior hacia abajo). El plan 29-02 no
  necesita recalcularlo a ciegas — este es el rango vigente al cierre de
  29-01.

- **29-01:** `_deriveNextActionFromLegacy` replica el criterio de
  `manualCallbackByOwner` (index.js:8379, nota #150 de CLAUDE.md) para
  decidir `origen:'manual'` vs `'cadencia'`: SOLO mira si el ÚLTIMO
  `callLog` entry es `callback_later`, sin chequear atribución por
  `_callSetterId` (a diferencia de `manualCallbackByOwner`, que sí filtra
  por dueño actual). Es intencional — el plan pide "el mismo criterio de
  manualCallbackByOwner" para la CLASIFICACIÓN manual/cadencia, no para la
  atribución de propiedad; D-09 (preservar "En seguimiento") solo depende
  de esa clasificación.

- **29-02:** el delta de "En seguimiento" contra datos reales de producción
  fue **0**, no el 3-4 estimado por el contexto/PATTERNS. Verificado con un
  script de solo-lectura sobre una copia de `data/setters.json` (25.6 MB) +
  `data/auth.json`, importando `index.js` apuntado a la copia (nunca al
  archivo del repo, `DATA_DIR` a un dir de scratchpad, `NODE_ENV=test`, sin
  listener ni llamadas HTTP mutantes) y reusando `_leadNextAction`/
  `_callSetterId`/`_buildUserSetterMap` REALES. VIEJO=19, NUEVO=19, las dos
  diferencias de conjunto vacías. El único candidato con `followUps` activo
  y sin `callbackAt` (que sí calificaría `origen:'manual'` vía la
  derivación de D-04) no entró a NINGUNO de los dos criterios porque su
  último `callLog` entry lo hizo un user ya eliminado de `auth.json` (nota
  #149) — `_callSetterId` no cae al `assignedTo` en ese caso, así que la
  atribución por dueño falla igual en el criterio viejo y en el nuevo.
  Detalle completo en `29-02-SUMMARY.md`.

- **29-02:** `_applyCallOutcome` sigue en el rango **10767–10956** tras los
  edits de este plan (Task 1 sumó 18 líneas netas dentro de la función —
  bloque `{ }` del `case 'callback_later'` + los dos `_setNextAction`
  inline). El plan 29-03 no necesita recalcularlo a ciegas — este es el
  rango vigente al cierre de 29-02.

- **29-02:** `gsd-sdk query state.advance-plan` sigue con el mismo mismatch
  de formato ya documentado en las decisiones de Phase 24: sobrescribe
  "Current Position" con texto genérico ("Status: Ready to execute") y
  además corrompe una línea NO relacionada más abajo en el archivo (una
  "Status:" de la sección archivada de Phase 20/28 quedó pisada con el mismo
  texto genérico). Revertido con `git checkout -- .planning/STATE.md` antes
  de commitear nada; la actualización de este plan fue 100% manual (mismo
  patrón que 24-02/24-03/24-04).
  `gsd-sdk query roadmap.update-plan-progress 29` reproduce EXACTO el bug ya
  documentado en 24-01: pisa las columnas `Phase`/`Reqs` de la fila 29 del
  `## Resumen` con `plan_count`/`status` (quedó `| 29 | 2/4 | In Progress|  |`,
  perdiendo el nombre de la fase y los IDs de requirements), aunque SÍ marcó
  bien el checkbox de la lista de planes (`29-02-PLAN.md`, que de todas
  formas ya se había marcado a mano antes de correr el comando). Revertida
  la fila manualmente a `| 29 | NEXT — El reloj único (2/4 planes) |

- **29-03:** `gsd-sdk query state.advance-plan` sigue vivo en PATH esta
  sesión (a diferencia del mismatch que documentaba `config.json`) y esta
  vez SÍ actualizó bien el frontmatter (`completed_plans` 5→6) y el texto
  libre lo reescribimos a mano encima — pero reprodujo el MISMO bug de
  corrupción de línea no relacionada que ya documentaron 24-04/29-02:
  pisó `- **Status:** Executing Phase 28` (línea de la sección archivada de
  Phase 20) con el texto genérico `- **Status:** Ready to execute`.
  Detectado con `git diff .planning/STATE.md` ANTES de commitear (no
  confiar en el output del comando solo) y revertido a mano. `state.
  update-progress` devolvió `{"updated": false, "reason": "Progress field
  not found in STATE.md"}` — no-op, sin corromper nada. `state.record-
  metric` y `state.add-decision` devolvieron `{"error": "... required"}`
  con argumentos posicionales que coinciden con el patrón documentado en
  `execute-plan.md` (`"${PHASE}" "${PLAN}" "${DURATION}" ...` /
  `"mensaje"`) — el mensaje de error no aclara el formato esperado y
  `--help` solo devuelve `"Usage: ... [args...]"` sin detalle. Se
  actualizaron las métricas y la decisión a mano en este archivo en vez de
  seguir adivinando el formato. **Regla reforzada para 29-04**: correr
  `git diff .planning/STATE.md` después de CUALQUIER comando `state.*` de
  la SDK, antes de tocar nada más — la corrupción es silenciosa y no sale
  en el output del comando.
  NEXT-01..04 | — |`, preservando el checkbox. `state.record-metric`/
  `state.add-decision`/`requirements.mark-complete` no se probaron esta
  vez — se asume el mismo mismatch de formato para este milestone y se hizo
  todo manual para no arriesgar más corrupción.

- **29-04:** `_callSetterId` ganó un guard `if (!entry) return lead.assignedTo
  || '';` (Rule 1) — bug preexistente de 29-02/29-03 (no de este plan)
  destapado al escribir el fixture "followUps activo, callLog vacío" que el
  `<behavior>` de la Task 2 pedía explícitamente: `GET /leads/sin-wsp`
  crasheaba con 500 (`Cannot read properties of null`) cuando un lead tenía
  `nextAction.origen==='manual'` pero ningún `callLog` entry — posible desde
  29-03 (tildar un follow-up programa `nextAction` sin exigir ninguna
  llamada previa). Reproducido con un probe aislado ANTES de tocar código,
  arreglado con una línea (mismo fallback ya existente para "sin
  `entry.by`"), y confirmado que los otros 15 call sites de la función no se
  ven afectados. Detalle en `29-04-SUMMARY.md`.

- **29-04:** medición previa contra la copia de `data/setters.json` real dio
  `conCallbackAt: 165` (33 manual, 132 cadencia) y `conFollowUpActivo: 4` (3
  con `callbackAt`, 1 sin) — **166 leads migrables**, no los "16
  callbacks/3 followUps" que circulaban en documentos de planificación
  previos (medición del 2026-08-13 con otro criterio, probablemente solo
  vencidos, y sobre otro snapshot). El `overdue: 15` de `29-03-SUMMARY.md`
  SÍ es consistente (subconjunto vencido de los 165 totales). Los números de
  referencia para decidir si correr la migración en producción son los
  medidos en `29-04-SUMMARY.md`, no los de contexto/planificación.

- **29-04:** repetido el mismo patrón de corrupción de `gsd-sdk query
  state.advance-plan` que documentan 24-04/29-02/29-03 — esta vez pisó
  `- **Status:** Executing Phase 28` (línea de la sección archivada de
  Phase 20/28) con `- **Status:** Ready to execute` y su `- **Last
  activity:**` vecino, aunque el frontmatter (`completed_plans` 6→7,
  `percent` 14→29) y el propio texto de "Current Position" quedaron
  correctos. Detectado con `git diff .planning/STATE.md` (regla reforzada
  en 29-03) y revertido con `git checkout -- .planning/STATE.md` ANTES de
  tocar nada — la actualización de este plan es 100% manual otra vez.
  `state.record-metric`/`state.add-decision` devolvieron no-op ("... not
  found in STATE.md") sin corromper nada — confirmado que son inofensivos
  aunque no sirvan para este formato custom. `state.record-session`
  (`--stopped-at`/`--resume-file`) SÍ escribió limpio, tocando solo "Resume
  File" — es el único comando `state.*` verificado seguro para este
  milestone hasta ahora, pero de todas formas se revirtió junto con el resto
  para reescribir todo el bloque a mano de una vez.

---

*Last updated: 2026-08-14 (29-01 ejecutado — el reloj único `nextAction`
existe: whitelists + helpers puros (`_setNextAction`/`_clearNextAction`/
`_deriveNextActionFromLegacy`/`_leadNextAction`) expuestos en
`globalThis.__voiceAgent`, espejo D-03 garantizado en los 7 writers de
`callbackAt` fuera de `_applyCallOutcome` (que queda intacto, territorio del
plan 29-02), y 17 tests puros con verificación por mutación registrada.
Cero cambios de comportamiento visible — `FOLLOWUP_STEPS` deriva de
`NEXT_ACTION_TEMPLATES` sin tocar valores, suites de followups/cadencia/
cortes/disposition-enforcement/recycle-pool/pool-distribution/
apply-call-outcome/metrics-consistency verdes sin editarlas. Suite completa
del repo: 1257/1257. Requirement NEXT-01 marcado completo. Próximo: plan
29-02 [`_applyCallOutcome` sobre el reloj único] — Wave 2, ya desbloqueada).*

---

*Last updated: 2026-08-14 (29-02 ejecutado — `_applyCallOutcome` escribe y
consume el reloj único: 5 sitios de escritura migrados a
`_setNextAction`/`_clearNextAction` [entrada consume NEXT-04, `callback_later`
origen manual, tope de cortes descarta, cadencia descarta, cadencia
reintenta origen cadencia], cero asignación directa de `callbackAt` dentro
de la función. `manualCallbackByOwner` ("En seguimiento") migrado a
`nextAction.origen==='manual'` (D-09) — verificado contra copia de datos
reales de producción: delta 0 (19/19 leads coinciden exacto, sin regresión
ni lead sin explicar). Paridad humano↔agente de voz extendida a `nextAction`
(`tests/apply-call-outcome.test.js`). 11 tests nuevos
(`tests/next-action-disposition.test.js`) fijan cadencia, callback manual,
consumo del compromiso pendiente (NEXT-04, caso real del 2026-08-12), tope
de cortes, excepción de interesados (#183) y lectura sin migración (D-09).
Suite completa del repo: 1268/1268 (86 archivos), `metrics-consistency`
intocado y verde. Requirements NEXT-02/NEXT-04 marcados completos. Próximo:
plan 29-03 [`followUps` retirado — NEXT-03] — Wave 3, ya desbloqueada).*

---

*Last updated: 2026-08-14 (29-03 + 29-04 ejecutados — **Phase 29 (NEXT — El
reloj único) COMPLETE, 4/4 planes**. 29-03: `followUps` retirado como fuente
de verdad [write-path `PATCH .../followup` programa `nextAction` al tildar,
read-path `_computeFollowupsDue` deriva de `_leadNextAction` excluyendo
`origen==='cadencia'`]; medido contra datos reales: badge de follow-ups
0→10 (único cambio visible de toda la fase, aviso redactado en
`29-03-SUMMARY.md`). 29-04: `POST /api/admin/backfill-next-action` [dryRun

+ backup + mutex + idempotente] ensayado contra copia de `data/setters.json`

real [6.413 leads]: 166 migrables [165 con `callbackAt`, 1 solo con
`followUps`], `apply===dryRun`, segunda corrida idempotente
[`updated:0`]; 16 tests nuevos [`tests/next-action-migration.test.js`];
script de producción `scripts/one-shot-migrate-next-action-2026-08-14.mjs`
[simula por default, `--apply` ejecuta]; nota #184 en `CLAUDE.md`; fix
Rule 1 en `_callSetterId` [null-pointer en `GET /leads/sin-wsp`]. Suite
completa del repo: 1293/1293. Requirements NEXT-02/NEXT-03 marcados
completos. Pendiente del usuario: correr el script de migración en
producción después del deploy — no bloquea la Phase 30. Próximo: planificar
Phase 30 [GATE — Cierra la llamada, define el próximo paso], `/gsd:plan-phase 30`).*

---

*Last updated (Phase 24): 2026-07-31 (24-05 ejecutado — el procesamiento del webhook
cierra el circuito completo de la Phase 24: `_retellProcessCallEvent`
convierte un evento `call_ended`/`call_analyzed` en una entry de callLog
indistinguible de una llamada humana [transcript de `words[]`, outcome
canónico vía `_applyCallOutcome`, atribución a `setter_agente_ia`,
idempotencia real por `retellCallId` dentro de UN `mutateSettersData`].
El blocker fix del plan-checker verificado explícito: `skipCalendarCreation`
deriva SOLO de `_pendingBooked`, nunca de `booked` — 2 tests dedicados
prueban el camino de respaldo [`agendo:true` sin `/book` previo SÍ crea la
cita]. 27 tests nuevos, suite completa 1131/1131 verde. VOICE-05 completado
— **Phase 24 (Integración backend Retell) CERRADA, 5/5 planes**. Próximo:
planificar Phase 25 [Panel Agente de voz] o adelantar 26/27 en paralelo).*

## Decisiones de ejecución (Phase 30)

- **30-01:** el mapa D-02 se implementó literal contra el CONTEXT, pero 2
  tests preexistentes (agregados en sesiones de la Phase 20/2026-08-12,
  ANTES del research que fundamentó D-02) codificaban el comportamiento
  viejo: esperaban `callbackAt` vacío tras un `hung_up` 1er corte o tras
  corregir una auto-marca a `answered_interested`, cuando D-02 ahora
  reemplaza esos huecos con un default fresco en vez de dejarlos en blanco.
  Actualizados (`tests/hangup-cap.test.js`, `tests/disposition-enforcement.test.js`)
  — no estaban en `files_modified` del plan pero son consecuencia directa
  de D-02. Detalle completo en `30-01-SUMMARY.md`.

- **30-01:** `_gateSanitizeNextActionOverride` NO se expone en
  `globalThis.__voiceAgent` — el acceptance criterion pedía "exactamente 2
  hits" del nombre de la función en todo `index.js` (declaración + uso en
  el endpoint). Se ejercita solo vía HTTP en los tests.

- **30-01:** *Last updated: 2026-08-15 (30-01 ejecutado — el backend del
  gate: defaults D-02 por outcome dentro de `_applyCallOutcome`
  [`answered_interested` → callback +3d manual, `hung_up` 1er corte →
  cadencia +24h], red de seguridad GATE-01 [cualquier outcome no-terminal
  sin `nextAction` recibe un default, nunca 4xx — protege también el
  webhook del agente de voz], override sanitizado del cliente sobre
  `call-disposition` [`_gateSanitizeNextActionOverride`, `origen` siempre
  forzado a `'manual'`], y `esperar_respuesta` +48h en `send-placeholder`.
  12 tests nuevos en `tests/gate-next-action.test.js`, suite completa
  1320/1320 verde, `metrics-consistency` sin mover un número [D-09].
  Requirements GATE-01/GATE-02 marcados completos. Próximo: 30-02
  [frontend — control de UI que obliga a elegir antes de confirmar] y
  30-03 [GATE-04, aviso universal de destino]).*

## Decisiones de ejecución (Phase 31)

- **31-01:** `lead.commitment` se guarda PLANO en el lead (no anidado dentro
  de `nextAction`), confirmando la preferencia que el CONTEXT.md dejaba a
  discreción del ejecutor. Así el objeto sobrevive al consumo del reloj
  (`_clearNextAction` no lo toca) y sirve de base para el historial de
  compromisos cerrados que va a pedir D-11 en el plan 31-04 — sin necesitar
  un array de historial nuevo.

- **31-01:** `_sanitizeCommitment` invalida TODO el payload si `tipo` no
  está en `COMMITMENT_TIPOS`, a diferencia de `_gateSanitizeNextActionOverride`
  (que coerciona `tipo` a `'callback'`). Decisión deliberada: un compromiso
  es una declaración completa del SDR, coercionar el tipo fabricaría un
  compromiso que nadie dijo.

- **31-01:** `vencido` es un estado DERIVADO (`_commitmentEffectiveEstado`)
  mientras el compromiso sigue `pendiente` en disco y la fecha ya pasó —
  nunca se escribe solo por el paso del tiempo, para que no desaparezca de
  Hoy justo cuando más hay que actuar. `vencido` SÍ es un cierre EXPLÍCITO
  válido (`_closeCommitment`) para el caso "ya no aplica" de un compromiso
  propio; `incumplido` queda reservado para los del prospecto.

- **31-01:** *Last updated: 2026-08-15 (31-01 ejecutado — el modelo del
  compromiso hablado: whitelists `COMMITMENT_TIPOS/PARTES/ESTADOS/CIERRES`
  [D-02/D-03/D-04], mapa D-06 tipo→duración reusando `GATE_INTERESADO_DELTA_MS`/
  `GATE_CADENCIA_DELTA_MS`/`NEXT_ACTION_TEMPLATES` [única duración nueva:
  `COMMITMENT_SOCIO_DELTA_MS`, +5 días], y `_sanitizeCommitment`/
  `_setCommitment`/`_closeCommitment` que atan el compromiso al reloj único
  con `origen:'compromiso'` [D-05/D-07] + seguimiento post-envío a +48h para
  un "mandar info" propio cumplido [D-06 fila 1]. 35 tests puros nuevos en
  `tests/commitment-model.test.js`, verificados por mutación [7/35 en rojo
  al comentar la llamada a `_setNextAction`, restaurado limpio]. Suite
  completa 1400/1400 [baseline 1365 + 35]. Cero cambios en `public/` — el
  plan es backend-only, sin bump de cache-buster. Requirements COMM-01/02/03
  con su cimiento listo [COMM-04 depende del plan 31-04, consulta]. Próximo:
  31-02 [endpoints — `commitment` en `call-disposition` D-08 + `PATCH
  .../commitment` para la ficha D-09]).*

- **31-03:** cache-buster real distinto del asumido por el plan — el plan
  documentaba baseline `app.js?v=20260815d`, pero al arrancar la ejecución
  ya era `20260815e` (una sesión paralela de branding, commits `1e71d0f`/
  `a5a54b2`/`bfe228a`, ya en `main` antes de que este plan empezara).
  Bumpeado a `20260815f` en vez de reusar `20260815e`. `style.css` intacto.

- **31-03:** `escHtml(c.motivo)` también en la condición ternaria del bloque
  "Compromiso" de la ficha (no solo en el contenido interpolado) — ajuste de
  Rule 1 hecho al escribir la aserción T-31-04 de la suite: la condición
  leía el valor crudo sin envolver (sin fuga real, la condición no se
  renderiza, pero violaba la regla defensiva del plan en su forma literal).

- **31-03:** confirmado (otra vez) el patrón de corrupción de `gsd-sdk query
  state.advance-plan` que ya documentan 24-04/29-02/29-03/29-04: pisó
  `- **Status:** Executing Phase 30` (línea de la sección archivada de
  Phase 20/30, no relacionada con este plan) con el texto genérico
  `- **Status:** Ready to execute`, y el "Status" de "Current Position"
  también quedó con el placeholder genérico en vez del texto real. Detectado
  con `git diff .planning/STATE.md` (regla reforzada desde 29-03) y
  corregido a mano, línea por línea, en vez de `git checkout --` completo
  (para no perder el bump correcto del frontmatter — `completed_plans`
  12→13 — que el mismo comando SÍ hizo bien). `gsd-sdk query
  roadmap.update-plan-progress 31` reprodujo el bug ya documentado en 24-01:
  pisó las columnas `Phase`/`Reqs` de la fila 31 del `## Resumen` de
  ROADMAP.md (`| 31 | 3/4 | In Progress|  |`, perdiendo el nombre de la fase
  y los IDs de requirements) aunque SÍ marcó bien el checkbox
  `31-03-PLAN.md`. Revertida la fila a mano a `| 31 | COMM — Compromisos
  como objeto (3/4 planes) | COMM-01..04 | 29 |`. `state.record-metric`/
  `state.add-decision` devolvieron no-op (`"... not found in STATE.md"`)
  sin corromper nada — el formato custom de este STATE.md no tiene las
  secciones `## Performance Metrics`/`### Decisions` que esos handlers
  buscan. `state.record-session` (`--stopped-at`/`--resume-file`) volvió a
  ser el único comando `state.*` seguro (solo tocó "Resume File").
  `requirements.mark-complete` fue no-op limpio (COMM-01/COMM-03 ya estaban
  marcados desde 31-01/31-02).

- **31-04:** dado el patrón de corrupción de `gsd-sdk query state.*`/
  `roadmap.update-plan-progress` ya confirmado por 24-01/29-02/29-03/29-04/
  31-03 (pisa columnas/lineas ajenas del formato custom de este STATE.md y
  de la tabla `## Resumen` de ROADMAP.md), este plan actualizó STATE.md,
  ROADMAP.md y REQUIREMENTS.md **a mano** con Edit, sin invocar ningún
  `gsd-sdk query` — mismo criterio que ya usaban 24-02 y las notas previas
  de esta fase ("`gsd-sdk` no está en PATH en este entorno").

- **31-04:** [Rule 1] al extender el bloque "Compromiso" de la ficha del
  lead para D-11 (detalle del cierre), se encontró que el branching
  abierto/cerrado usaba el estado DERIVADO (`_commitmentEffectiveEstado`,
  que devuelve `'vencido'` tanto para un compromiso todavía pendiente cuya
  fecha ya pasó como para uno YA CERRADO explícitamente con "Ya no aplica")
  en vez del estado ALMACENADO (`l.commitment.estado`) — un compromiso
  cerrado con "Ya no aplica" quedaba mostrando la tarjeta editable para
  siempre, y un segundo click en cualquier botón de cierre volvía con 409
  ("no había compromiso pendiente"). Fix: branchear por el estado
  almacenado, tanto en el bloque de la ficha como en el chip de la
  cabecera (`_expChips`) que tenía el mismo bug. Documentado en el código
  con el tag `[Rule 1 - 31-04]`.

- **31-04:** `_commitmentHoyBucket(lead, nowMs)` NO usa `nowMs` para decidir
  los buckets `'yo'`/`'prospecto'` — mira el estado ALMACENADO
  (`commitment.estado === 'pendiente'`), a propósito: un compromiso vencido
  sigue con estado `pendiente` hasta que un humano lo cierra, así que tiene
  que seguir en la sección de Hoy. El parámetro se conserva por paridad de
  firma con el resto del bloque `[31-03] COMMITMENT-PURE` y por si una
  fase futura necesita filtrar por antigüedad.

- **31-04:** verificación por mutación del test de coincidencia de títulos
  (pedida por el plan): se cambió temporalmente el string `'Mis compromisos'`
  de `loadHoyView` con `sed` → 3 tests en rojo (los 2 de título exacto + la
  garantía anti-deriva). Restaurado con `git checkout -- public/app.js` en
  vez de revertir el `sed` a mano: `core.autocrlf=true` del repo hace que
  `sed -i` en Git Bash dejara esa única línea con terminador LF en vez de
  CRLF — el contenido quedaba byte-idéntico pero `git status` marcaba el
  archivo como modificado igual. `git checkout --` es la única forma de
  garantizar cero rastro (contenido Y terminadores) tras una mutación de
  verificación en este repo.

- **31-04:** *Last updated: 2026-08-15 (31-04 ejecutado — Phase 31 completa,
  4/4 planes. D-10: secciones "Mis compromisos"/"Esperando del prospecto"
  en Hoy, agrupadas por parte, arriba de Callbacks/Interesados, derivadas
  client-side sin pedir ningún endpoint nuevo. D-11: el compromiso cerrado
  aparece en la timeline unificada del lead (`_renderCallHistory`) y con
  detalle completo en la ficha. 42 tests nuevos en
  `tests/commitment-hoy.test.js`. Suite completa 1512/1512 [baseline 31-03:
  1470]. `tests/metrics-consistency.test.js` verde, sin ediciones en toda
  la fase. Requirements COMM-01..04 los 4 completos. Próximo: Phase 32
  [ACT — Acciones desde cualquier vista], depende de Phase 29 y 31, ambas
  cerradas).*

## Decisiones de ejecución (Phase 32)

- **32-01:** `buildWhatsAppUrl` recibe el teléfono RAW del cliente (o
  `lead.phone` si no hubo override en el body), NUNCA el valor ya
  normalizado a E.164. [Rule 1] El `<action>` del plan describía pasarle
  `sentTo` (el normalizado con `+` al frente) — pero eso borra la señal de
  paréntesis literales (`(305) 555-1234`) que `buildWhatsAppUrl` usa para
  su detección histórica de formato US, reintroduciendo exactamente el
  bug que esa función existe para evitar. Encontrado escribiendo el test
  del caso US-con-paréntesis en Task 3, arreglado con un commit `fix`
  aparte (`1f5a7dc`) antes de escribir la suite formal, verificado primero
  con un smoke test manual.

- **32-01:** `_actRegisterSendEvent` (registro compartido de "mandar y
  registrar en un solo acto") NO devuelve `templateId` en su shape
  (`{commitment, nextAction, terminal}`, el contrato congelado por los
  tests puros de Task 1) — el endpoint calcula el `templateId` saneado en
  su propia línea (mismo `ACT_WA_TEMPLATE_IDS.has(...)` de una sola
  línea) en vez de tocar un contrato ya commiteado por un `Set.has`
  trivial.

- **32-01:** los comentarios de la entry de auditoría (`action:
  'material_sent'`) explican las dos razones de diseño (no atribuye por
  vendedor, no cuenta como llamada) SIN usar los literales `setterId`/
  `callLog` en la prosa — el `<action>` del plan pedía explícitamente ese
  comentario, pero el `acceptance_criteria` exigía que un grep de esos dos
  tokens dentro del bloque devolviera cero. Se resolvió la tensión
  describiendo el motivo sin nombrar los campos por su identificador
  exacto — la razón queda igual de clara, el grep pasa limpio.

- **32-01:** confirmado (otra vez, ver 24-01/29-02/29-03/29-04/31-03) que
  `gsd-sdk query state.advance-plan` corrompe prosa NO relacionada con la
  posición actual: en ESTE entorno el binario `gsd-sdk` SÍ resuelve en
  PATH (a diferencia de lo que decía `.planning/config.json`), pero volvió
  a pisar la misma línea histórica `- **Status:** Executing Phase 30`
  (dentro de la sección archivada "Archivo — posición v2.0", sin relación
  con Phase 32) con el texto genérico `- **Status:** Ready to execute`.
  Detectado con `git diff .planning/STATE.md`, revertido a mano esa línea
  puntual, y el resto de "Current Position" reescrito a mano con el
  detalle real de 32-01. El bump del frontmatter (`completed_plans`
  14→15) SÍ lo hizo bien el mismo comando — se conservó. `roadmap.update-
  plan-progress`/`requirements.mark-complete` NO se invocaron esta vez
  (mismo criterio de 31-04): STATE.md, ROADMAP.md y REQUIREMENTS.md se
  actualizaron a mano con `Edit`.

- **32-01:** ACT-01/02/03 se dejan **SIN marcar** `[x]` en
  `REQUIREMENTS.md` a pesar de que el frontmatter de este plan los declara
  `requirements: [ACT-01, ACT-02, ACT-03]` — el plan 32-03 declara EXACTAMENTE
  los mismos 3 IDs (`requirements: [ACT-01, ACT-02, ACT-03]`) porque ACT-01
  pide un botón VISIBLE en la UI, y este plan es backend-only (32-01 NO
  toca `public/`, por diseño). Marcar los checkboxes ahora sería prematuro
  — se completan cuando 32-03 (frontend) cierre el círculo y el botón
  exista de verdad. `ACT-02`/`ACT-03` sí tienen su parte backend ya lista
  (registro atómico + número alternativo), pero como comparten ID con
  ACT-01 en el mismo par de planes, se dejan los 3 juntos para no marcar
  "completo" algo sin botón visible.
