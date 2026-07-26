---
phase: 21-reporte-diario-canal-whatsapp
plan: 04
subsystem: ui
tags: [panel-admin, whatsapp, reportes, state-machine, rbac, cache-buster]

# Dependency graph
requires:
  - phase: 21-reporte-diario-canal-whatsapp
    provides: "21-03: GET /api/admin/daily-report/status · PUT /config · POST /send-now (los 3 admin-only) · 21-01: setter.leaveUntil + PATCH /api/setters/team/:id · 21-02: config.paused honrado en el tick"
  - phase: 18-supervisor-restringido
    provides: "apiUrl() con viewAs + data-roles + _visibleSetterIds — el bloque nuevo respeta los dos mecanismos"
provides:
  - "#cmd-daily-report-panel en view-command (admin-only): chip de estado del canal, detalle (grupo/último envío/cola/desktop), hint de setup, mails de respaldo, interruptor de pausa y CTA 'Mandar ahora'"
  - "_cmdLoadReportPanel + _cmdReportPaint — chip por precedencia determinística de 6 estados, colgado de loadCommandCenter() fire-and-forget"
  - "máquina de estados de 'Mandar ahora': IDLE → CONFIRMING → SENDING → SUCCESS/QUEUED/FAILED/UNKNOWN → IDLE, con timeout de cliente de 60s y refetch del estado real al terminar"
  - "#team-leave-modal + window._teamOpenLeaveModal + badge 'Licencia hasta DD/MM' en _teamRenderTable (D-18)"
  - "cache-buster app.js v=20260726a"
affects: [21-07 prueba en vivo del grupo, 22 coaching, 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "acción saliente irreversible en el panel = askConfirm obligatorio + disabled durante el vuelo + timeout de CLIENTE siempre mayor al del server + refetch del estado real al terminar (nunca actualización optimista)"
    - "chip de estado con precedencia declarada y determinística (el primero que matchea gana) en vez de condiciones combinadas"
    - "verificación de UI sin browser: se extrae el bloque REAL de public/app.js por marcadores de texto y se corre contra un DOM stub (mismo método que el picker de 21-06)"

key-files:
  created: []
  modified:
    - public/index.html
    - public/app.js

key-decisions:
  - "El handler del botón de licencia se cablea con addEventListener sobre el nodo, no con onclick inline: escHtml('O\\'Brien') se decodifica a apóstrofo dentro del atributo y rompería el string JS — el mismo motivo por el que la fila ya pinta el nombre con textContent"
  - "La vigencia de la licencia se compara como STRING de día (igual que _reportOnLeave del backend): new Date('YYYY-MM-DD') es medianoche UTC y contra la medianoche local daba el último día de licencia como vencido en AR"
  - "El estado de error del panel es recuperable: como el copy del UI-SPEC se pinta con textContent sobre el recuadro (lo que destruye los 4 ids internos), el pintado repone un esqueleto estático antes de escribir — si no, un 500 transitorio dejaba el panel muerto hasta un F5"
  - "Los 4 reason de 'queued' que agregó 21-03 (sin_grupo/busy/sending/fallback_dm) tienen toast propio: el genérico de 'la computadora está apagada' habría mentido en los 4 casos"
  - "Guardar la licencia con el input vacío no manda nada: el backend trata '' como null (quitar), así que decir 'Licencia guardada.' sería mentira — se pide la fecha o se usa 'Quitar licencia'"

patterns-established:
  - "Todo loader nuevo del panel cuelga fire-and-forget y FUERA del try del loader padre: ni el hijo tumba al padre ni el padre esconde al hijo"
  - "Interruptor booleano = auto-guardado en onchange y se REVIERTE si el server no confirmó (un checkbox no puede mentir sobre el estado del server)"
  - "Un cambio en public/ sin bump del cache-buster no se considera terminado (regla del 'bug invisible' de CLAUDE.md)"

requirements-completed: []   # REP-06 se comparte con 21-02/03/05/06/07: se marca cuando el mensaje llegue al grupo real (21-07)

# Metrics
duration: 23min
completed: 2026-07-26
---

# Phase 21 Plan 04: Panel de configuración del canal + licencia por SDR Summary

**El admin ya puede ver si el canal está sano (grupo, último envío, cola, desktop) con un chip de precedencia determinística, pausar el envío automático sin reiniciar el server, disparar el reporte al grupo en el acto con confirmación previa y feedback honesto por cada estado del backend, y marcar a una vendedora de licencia con fecha que vence sola.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-07-26T22:45:20Z
- **Completed:** 2026-07-26T23:07:44Z
- **Tasks:** 3/3
- **Files modified:** 2 (`public/index.html`, `public/app.js`) + `deferred-items.md`

## Accomplishments

- **La prueba en vivo del plan 21-07 ya tiene su botón.** "Mandar ahora" es una acción saliente irreversible sobre un grupo con personas reales, así que se implementó como máquina de estados explícita: `askConfirm` obligatorio (cancelar/Esc no dispara ningún request), `disabled` + spinner durante el vuelo, **timeout de cliente de 60s** (el server corta a los 25s: el cliente nunca se rinde antes) y un `UNKNOWN` distinto de `FAILED` cuyo copy disuade el reintento reflejo. Al terminar CUALQUIER estado se refetchea el estado real del server.
- **Los 9 estados que puede devolver el backend tienen su propio mensaje.** `sent`, `sent_via_dm`, `queued` × 5 (`offline`, `sin_grupo`, `busy`, `sending`, `fallback_dm`), `failed` genérico y `failed/account-not-connected`. Verificado uno por uno contra el handler real.
- **Chip de estado con precedencia declarada** (sin grupo → desktop caído → pausado → N en cola → último falló → al día). Los 6 casos verificados con datos que matchean varias condiciones a la vez, para probar que el orden manda y no la suerte del `if`.
- **Licencia por SDR en Equipo (D-18):** badge `Licencia hasta DD/MM` que ven admin y supervisor, botón de editar solo para admin, modal con fecha, "Quitar licencia" que solo aparece si hay algo que quitar, y vigencia comparada con el MISMO criterio que el backend (string de día, inclusive) — el último día de licencia cuenta.
- **Verificación real sin browser: 111 checks, 0 fail.** 33 contra el preview levantado con `DATA_DIR` aislado (HTML servido + los 3 endpoints + RBAC de supervisor + 401 anónimo + `send-now` end-to-end) y 78 corriendo el **código REAL extraído de `public/app.js`** contra un DOM stub (patrón de 21-06). Ver `## Verificación`.
- **`style.css` no se tocó** (cero clases nuevas: todo salió del inventario del UI-SPEC) y su cache-buster quedó intacto, como pedía el plan.

## Task Commits

1. **Task 1: HTML del bloque + modal de licencia + cache-buster** — `e808f4d` (feat)
2. **Task 2: `_cmdLoadReportPanel` + máquina de estados + licencia en Equipo** — `f53c845` (feat)
3. **Task 3: verificación en preview** — `c1041e1` (docs — la task no cambia código; el artefacto es la evidencia + `deferred-items.md`)

## Files Created/Modified

- `public/index.html`:
  - `<section id="cmd-daily-report-panel" class="admin-variable-panel" data-roles="admin">` insertado entre el `.content-header` de `view-command` y la sección Equipo. 13 ids de contrato, copy literal del UI-SPEC, clases reusadas (`.chip/.chip-neutral`, `.btn.btn-primary`, `.btn-table-action`, `.setter-input`).
  - `<div id="team-leave-modal">` junto a `#team-config-modal`, mismo chrome (overlay fixed + `.card`), 6 ids de contrato.
  - `app.js?v=20260725c` → **`v=20260726a`**. `style.css?v=20260725a` sin tocar.
- `public/app.js`:
  - Bloque `// ─── Phase 21 (D-29) ───` junto al wiring del Centro de Comando: `_cmdReportSending`, `_CMD_REPORT_DETAIL_HTML`, `_cmdReportPaint`, `_cmdLoadReportPanel`, listener del checkbox de pausa, listener de "Guardar mails", `_CMD_REPORT_QUEUED_MSG`, `CMD_REPORT_SEND_TIMEOUT_MS` y el listener de "Mandar ahora".
  - `loadCommandCenter()` cuelga `_cmdLoadReportPanel().catch(() => {})` fuera de su `try`.
  - `_teamRenderTable`: `leaveUntilStr`/`onLeave`/`leaveBadge`/`leaveEditBtn` + interpolación `${alertBadge}${assignedBadge}${leaveBadge}${leaveEditBtn}` + cableado del handler por nodo.
  - Bloque del modal de licencia junto a los handlers de `#team-config-modal`: `_teamLeaveClose`, `window._teamOpenLeaveModal`, `_teamLeaveSave` y los 4 caminos de cierre (botón, overlay, Esc, guardado exitoso).
- `.planning/phases/21-reporte-diario-canal-whatsapp/deferred-items.md` — el flaky de campañas, con la prueba de que no lo tocó este plan.

## Decisiones Tomadas

1. **Handler del botón de licencia cableado por JS, no por `onclick` inline.** El UI-SPEC escribía `onclick="... window._teamOpenLeaveModal('${s.id}', '${escHtml(s.name)}', ...)"`. Un valor de atributo se **decodifica como HTML antes de evaluarse como JS**: un nombre como `O'Brien` pasa por `escHtml` a `O&#39;Brien` y llega al parser JS como `'O'Brien'` → `SyntaxError`, y el botón queda muerto para esa fila. Es el mismo motivo por el que la fila ya pintaba el nombre con `tr.querySelector('.t-name').textContent`. Copy, clases, estilos e ids quedaron idénticos al contrato; solo cambió cómo se conecta el click (`data-leave-btn` + `addEventListener` con closure sobre `s`).
2. **Vigencia por string de día, no por `Date`.** El snippet del UI-SPEC comparaba `new Date(s.leaveUntil) >= new Date(new Date().toDateString())`: el primero es medianoche **UTC**, el segundo medianoche **local**. En AR (UTC-3) una licencia que vence HOY se leía como vencida (el badge desaparecía el último día, cuando el backend `_reportOnLeave` sí la cuenta). Se replicó el criterio del backend: comparación de `'YYYY-MM-DD'` inclusive, y el `DD/MM` del badge se arma con `slice` del string (cero `Date`, cero huso).
3. **El estado de error del panel es recuperable.** El copy del UI-SPEC se pinta con `textContent` sobre `#cmd-report-status-detail`, lo que borra los 4 ids internos. Sin nada más, un 500 transitorio dejaba el panel sin poder repintar nunca (los `getElementById` devolvían `null` para siempre). `_cmdReportPaint` repone un esqueleto **estático** (sin interpolación → sin superficie de XSS) si detecta que las filas ya no están.
4. **Toast propio para los 4 `reason` nuevos de `queued`.** El UI-SPEC solo contemplaba "desktop apagado". 21-03 devuelve además `sin_grupo`, `busy`, `sending` y `fallback_dm`; con el texto genérico, el admin habría leído "la computadora está apagada" cuando en realidad no eligió el grupo, o cuando el mensaje **se está tipeando en ese momento**. Agregado aditivo: ningún estado del UI-SPEC se eliminó (era lo que el plan pedía anotar acá).
5. **`Guardar licencia` con el input vacío no manda nada.** El backend trata `''` como `null` (= quitar la licencia), así que un guardado en blanco habría mostrado "Licencia guardada." mientras hacía lo contrario. Se pide la fecha con un toast `warn` y el modal queda abierto.
6. **El interruptor de pausa se revierte si el server no confirmó.** Un checkbox que quedó tildado sin que el server lo haya guardado es una mentira sobre el estado del canal — justo el dato que este panel existe para mostrar.
7. **Se omitió del hint de setup la frase `Ver 21-CONTEXT.md § "Acciones del user"`** que arrastraba el HTML del UI-SPEC. Referenciar el nombre de un archivo de planificación dentro del panel no le dice nada a quien lo usa, y ni la lista de copy del plan ni la tabla `## Copy exacto por estado` la incluyen. La primera oración (la que sí es contrato y la que el criterio de aceptación grepea) quedó literal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] El `onclick` inline del UI-SPEC se rompe con un apóstrofo en el nombre del SDR**

- **Found during:** Task 2 (2d, licencia en Equipo)
- **Issue:** `onclick="... '${escHtml(s.name)}' ..."`. El atributo se decodifica como HTML antes de evaluarse como JS, así que `O&#39;Brien` llega al parser como `'O'Brien'` → `SyntaxError` y el botón de licencia de esa fila deja de funcionar. No es XSS (no se puede inyectar markup), es un botón muerto para cualquier nombre con apóstrofo — `D'Angelo`, `O'Brien` y compañía existen.
- **Fix:** el botón se renderiza con `data-leave-btn` y el click se cablea con `addEventListener` sobre el nodo, con closure sobre `s` (nada del nombre pasa por HTML). Idéntico criterio al `textContent` que la fila ya usaba para el nombre.
- **Files modified:** `public/app.js`
- **Verification:** caso `D'Angelo O'Brien` en el harness del DOM stub (el botón renderizado no contiene el nombre) + el modal recibe el nombre intacto y lo pinta con `textContent`.
- **Committed in:** `f53c845`

**2. [Rule 1 - Bug] La comparación de vigencia de la licencia perdía el último día en AR**

- **Found during:** Task 2 (2d)
- **Issue:** `new Date('YYYY-MM-DD')` es medianoche UTC; `new Date(new Date().toDateString())` es medianoche local. En UTC-3, una licencia con `leaveUntil` = hoy da `onLeave = false` → el badge desaparecía justo el último día, mientras el backend (`_reportOnLeave`, comparación de strings inclusive) seguía excluyéndola del reporte. Panel y reporte diciendo cosas distintas sobre la misma persona.
- **Fix:** comparación de `'YYYY-MM-DD'` contra el día local, inclusive — el mismo criterio del backend. El `DD/MM` del badge sale de `slice` del string.
- **Files modified:** `public/app.js`
- **Verification:** 4 casos en el harness (futura / **hoy** / vencida ayer / basura no-fecha).
- **Committed in:** `f53c845`

**3. [Rule 2 - Missing critical] El panel quedaba muerto tras un error transitorio del status**

- **Found during:** Task 2 (2a)
- **Issue:** el estado de error escribe el copy con `textContent` sobre `#cmd-report-status-detail`, lo que destruye los 4 ids internos. Un 500 pasajero (o un deploy a mitad de sesión) dejaba el panel sin poder repintar nunca más, aunque el server volviera: todos los `getElementById` de las filas devolvían `null`.
- **Fix:** `_cmdReportPaint` repone un esqueleto estático de las 4 filas si detecta que ya no existen (markup constante, sin interpolación).
- **Files modified:** `public/app.js`
- **Verification:** en el harness: error 500 → chip `Sin datos` + copy del UI-SPEC → se borra `cmd-report-group-name` del DOM → el siguiente pintado repone el esqueleto → el fetch siguiente pinta `Al día` y el nombre del grupo.
- **Committed in:** `f53c845`

**4. [Rule 2 - Missing critical] Toast honesto para los 4 `reason` nuevos de `queued` + reversión del checkbox de pausa**

- **Found during:** Task 2 (2b, 2c)
- **Issue:** (a) el UI-SPEC solo tenía copy para `queued` = "computadora apagada"; 21-03 devuelve además `sin_grupo`, `busy`, `sending`, `fallback_dm`, y el texto genérico habría mandado al admin a prender una computadora que ya estaba prendida. (b) el checkbox de pausa quedaba tildado incluso si el `PUT` fallaba, mostrando "pausado" sobre un canal que sigue mandando.
- **Fix:** mapa `_CMD_REPORT_QUEUED_MSG` con los 5 motivos (el plan ya pedía anotar este agregado) + reversión de `cb.checked` y toast de error si el server no confirmó.
- **Files modified:** `public/app.js`
- **Verification:** los 5 `reason` verificados uno por uno contra el handler real; caso de 500 en la pausa (checkbox vuelve a su valor anterior). El `reason:'sin_grupo'` además se confirmó **contra el server real** (`send-now` en el preview devolvió `{status:'queued', reason:'sin_grupo'}`).
- **Committed in:** `f53c845`

**5. [Rule 1 - Bug] `Guardar licencia` en blanco decía "guardada" mientras la quitaba**

- **Found during:** Task 2 (2d)
- **Issue:** el backend normaliza `''` a `null`; guardar con el input vacío quitaba la licencia y el toast anunciaba "Licencia guardada.".
- **Fix:** guard que pide la fecha (toast `warn`, modal abierto, cero requests) y deja el borrado para "Quitar licencia".
- **Files modified:** `public/app.js`
- **Verification:** caso "guardado sin fecha" en el harness del modal (no dispara request, toast `warn`, modal sigue abierto).
- **Committed in:** `f53c845`

### Ajustes de copy (1, sin cambio de comportamiento)

- **Se omitió `Ver 21-CONTEXT.md § "Acciones del user"`** del hint de setup (ver Decisión 7). La oración que el plan lista como copy exacto — y que el criterio de aceptación grepea — quedó literal.

### Criterios de aceptación medidos de otra forma (1)

- **`grep -c "Reporte enviado al grupo.\|Envío automático pausado.\|..." public/app.js >= 5` da 4**: `grep -c` cuenta **líneas**, y los pares pausado/reanudado y guardada/quitada viven cada uno en un ternario de una sola línea. Con `grep -o` los **5 strings literales están presentes** (6 ocurrencias, una en un comentario). La intención del criterio se cumple.

---

**Total deviations:** 5 auto-fixes de código (3 Rule 1, 2 Rule 2) + 1 ajuste de copy + 1 criterio medido de otra forma
**Impact on plan:** los 5 auto-fixes son de correctitud sobre lo que este plan entrega (sin ellos: el botón de licencia muere con un apóstrofo en el nombre, el badge desaparece el último día contradiciendo al reporte, un 500 pasajero mata el panel hasta un F5, el admin recibe un diagnóstico falso en 4 de los 5 casos de "quedó en cola", y guardar en blanco borra la licencia diciendo que la guardó). Cero scope creep: ninguna vista nueva, ninguna entrada de navegación nueva, cero clases CSS nuevas, cero cambios de backend.

## Issues Encountered

- **No hay browser ni jsdom en este entorno** (`preview_start`/screenshot no están disponibles como herramientas acá y el proyecto no tiene `jsdom`/`puppeteer`). Se resolvió con el método que esta misma fase ya usó en 21-06: levantar el server con `DATA_DIR` aislado para todo lo que es HTTP/HTML servido, y **extraer los bloques reales de `public/app.js` por marcadores de texto** para correrlos contra un DOM stub. Es verificación del código que se commiteó, no de una copia.
- **La suite completa termina 941/945 con 4 rojos en `tests/wa-campaign-engine.test.js`** (describe `anti-ráfaga + routing`). Es el flaky ambiental documentado en `CLAUDE.md` #93/#110/#113 y **no puede tener relación con este plan**: ese archivo importa solo `src/wa/campaigns.js` y `src/wa/campaign-engine.js`, y los 2 commits de código de 21-04 tocan exclusivamente `public/app.js` y `public/index.html` (`git diff HEAD~2 HEAD --name-only`). Anotado en `deferred-items.md` con la sospecha (el describe comparte cuenta y `DATA_DIR` sin reset entre tests, y el cap diario por cuenta se cuenta por día) para quien reactive el módulo WA, que está parkeado.

## Verificación

### Checklist a-f del plan — 6/6 PASS

| # | Punto | Resultado |
|---|---|---|
| **a** | `#cmd-daily-report-panel` arriba de todo en `view-command`, chip `Sin configurar` con `class="chip chip-neutral"` | **PASS** — el bloque aparece antes de la sección Equipo en el HTML servido; el chip arranca `chip chip-neutral` en el markup y el pintado con `groupConfigured:false` da exactamente `chip chip-neutral` · `"Sin configurar"` (el `GET status` del preview devuelve `groupConfigured:false`, como corresponde: nadie eligió grupo todavía) |
| **b** | `#cmd-report-setup-hint` visible y botón `disabled` con `groupConfigured=false` | **PASS** — el hint arranca con `class="hidden"` y el pintado le SACA `hidden` cuando no hay grupo; el botón queda `disabled=true`. Con grupo configurado: hint oculto y botón habilitado |
| **c** | Tildar la pausa dispara el `PUT`, sale el toast `Envío automático pausado.` y persiste | **PASS** — el handler real hace `PUT /api/admin/daily-report/config {paused:true}` y emite el toast `warn` literal; contra el server: `PUT` 200 y un `GET status` posterior sigue devolviendo `paused:true` (persistió en `reports.json` del `DATA_DIR` aislado). Destildar → `Envío automático reanudado.` (`success`) |
| **d** | Guardar `a@b.com, c@d.com` deja `Guardado.` y el `GET status` devuelve los 2 | **PASS** — el handler manda `["a@b.com","c@d.com"]` (split/trim/vacíos filtrados, probado con `" a@b.com ,, c@d.com "`) y pinta `Guardado.`; el server responde 200 y el `GET status` devuelve los 2 mails. Un mail inválido devuelve 400 y el panel pinta el error del backend inline en `--danger` |
| **e** | Botón `+ Licencia` en la fila, modal `Licencia — {nombre}`, guardar repinta con `Licencia hasta DD/MM`, `Quitar licencia` lo saca | **PASS** — sin licencia el botón dice `+ Licencia` y con licencia `Editar licencia`; el modal pone el título por `textContent`, prepobla la fecha y solo muestra `Quitar licencia` si hay algo que quitar; guardar hace `PATCH /api/setters/team/:id {leaveUntil}` → toast `Licencia guardada.` → cierra → `_teamLoad()`; contra el server, `team-performance` devuelve el `leaveUntil` en la fila (badge pintable) y `{leaveUntil:null}` lo saca |
| **f** | Como supervisor, el bloque NO aparece y en Equipo NO aparece el botón de licencia, pero SÍ el badge | **PASS** — el `<section>` lleva `data-roles="admin"`; el botón se condiciona por `currentUser.role` (con `role:'supervisor'` el harness devuelve `leaveEditBtn === ''` y el badge presente); y **el backend lo respalda**: los 3 endpoints del canal y el `PATCH` de licencia devuelven **403** con sesión de supervisor (401 sin sesión), y el supervisor scoped solo ve sus 2 SDRs |

### Números

```
node --check public/app.js                                  → 0
preview (DATA_DIR=tmp/preview-2104, puerto 3117)            → 33 PASS / 0 FAIL
lógica del panel (código real + DOM stub)                   → 56 PASS / 0 FAIL
flujo del modal de licencia (código real + DOM stub)        → 22 PASS / 0 FAIL
                                                    total  → 111 PASS / 0 FAIL
POST /api/admin/daily-report/send-now (server real)         → {status:'queued', reason:'sin_grupo'} en 0.0s
npx vitest run                                              → 941/945 (4 rojos: flaky de campañas, ver arriba)
git status --porcelain data/                                → vacío (el preview no tocó la data del repo)
git diff HEAD~2 HEAD --name-only                            → public/app.js, public/index.html
git diff --stat public/style.css                            → vacío
```

Greps de aceptación:

| Criterio | Esperado | Real |
|---|---|---|
| los 19 ids de contrato en `index.html` | 19 | 19 |
| `app.js?v=20260725c` | 0 | 0 |
| `app.js?v=20260726a` | 1 | 1 |
| `style.css?v=20260725a` (sin tocar) | 1 | 1 |
| `class="btn btn-primary"` | >=1 | 4 |
| copy literal del HTML | >=7 | 7 |
| `_cmdLoadReportPanel` | >=3 | 3 |
| endpoints `daily-report/*` en app.js | >=3 | 4 |
| `window._teamOpenLeaveModal` | >=1 | 2 |
| `leaveUntil` | >=3 | 7 |
| copy de los 6 estados del chip | >=6 | 13 |
| `Sí, mandar ahora` | 1 | 1 |
| `Mandar reporte ahora` | 1 | 1 |
| `askConfirm` dentro del handler de `cmd-report-send-now-btn` | >=1 | 1 |
| `cmd-report-group-name').innerHTML` | 0 | 0 |
| `fetch('/api/admin/daily-report...` crudo (sin `apiUrl`) | 0 | 0 |
| toasts literales (medido con `grep -o`, ver nota) | 5 strings | 5 |

### Cobertura de amenazas del plan

| Threat | Estado |
|---|---|
| **T-21-19** (XSS por el nombre del grupo) | mitigado — `groupName` por `textContent` (grep de `innerHTML` sobre ese id = 0); el único `innerHTML` del bloque es un esqueleto constante sin interpolación; el nombre del SDR sigue por `textContent` en la fila y en el título del modal |
| **T-21-20** (spam del grupo por doble click) | mitigado — `askConfirm` + `disabled` durante `SENDING` + guard `_cmdReportSending` + refetch al terminar. La defensa dura es el lock server-side (`queued/busy`), y su toast está cableado |
| **T-21-21** (supervisor accediendo a la config) | mitigado — `data-roles="admin"` en el HTML estático, botón de licencia condicionado por `currentUser.role`, y 403 del backend verificado en los 4 endpoints con sesión de supervisor real |
| **T-21-22** (info del canal) | aceptado por diseño — el panel no muestra el JID (`jidCaptured` es booleano y `groupJid` no viaja: verificado en la respuesta real) ni el contenido del reporte |

## Sin verificar en vivo

- **`status:'sent'` nunca se ejercitó contra WhatsApp de verdad.** Llegar ahí necesita el `report:send-result` del desktop con el grupo elegido — es exactamente el plan 21-07. Lo que sí está verificado es que el handler pinta el camino de éxito (toast + label temporal `Enviado` + vuelta a IDLE) cuando el backend devuelve ese status.
- **El timeout de cliente de 60s no se esperó de verdad** (sería un test de un minuto): se verificó el valor de la constante y que el `UNKNOWN` es una rama distinta de `FAILED`. El copy del `UNKNOWN` es el del UI-SPEC.
- **Nada se vio en un browser real.** Todo el pintado se verificó con el código real contra un DOM stub. Riesgo residual: algo que solo se note visualmente (un salto de layout del grid `2fr 1fr` en una pantalla angosta, contraste del chip). Se acotó reusando exclusivamente clases y valores que ya están en uso en el panel, sin una sola regla CSS nueva.
- **El badge de licencia no se vio renderizado dentro de la tabla real**, solo el HTML que produce el snippet. La fila se pinta con el mismo `innerHTML` que ya usaba `assignedBadge`.

## User Setup Required

Nada nuevo. Lo que ya estaba pendiente para la prueba en vivo sigue igual (número dedicado con WhatsApp, grupo cerrado con los 2 socios, `wa-multi-portable-v0.5.11` abierta con el QR escaneado, botón **"Grupo de reportes"** y **fijar** el chat). Recién con eso el panel pasa de `Sin configurar` a mostrar el grupo y el botón "Mandar ahora" se habilita.

Opcionales, sin cambios: `REPORT_DM_FALLBACK` (D-02), `REPORT_SEND_NOW_WAIT_MS`, `RESEND_API_KEY` (solo el mail del semanal).

## Next Phase Readiness

- **21-07 (prueba en vivo) desbloqueado del lado del panel.** El flujo es: abrir wa-multi → elegir el grupo → entrar a Centro de Comando → el chip debería pasar a `Al día` (o `Pausado`/`N en cola` según el caso) y el botón habilitarse → "Mandar ahora" → confirmar → mirar el celular. Si algo no sale, el bloque dice exactamente qué falta (grupo / desktop / cola / último envío).
- **Ojo con el cache-buster al deployar:** el tab de cualquiera que tenga el panel abierto sigue con `v=20260725c` hasta que recargue; el banner de versión (#152) avisa solo. Para la prueba en vivo, recargar una vez antes de empezar.
- **Phase 23 (alertas) no necesita tocar esta UI:** el transporte quedó genérico desde 21-02 y este panel solo lee estado.
- **Deuda anotada, no bloqueante:** el flaky de `wa-campaign-engine` (módulo parkeado) en `deferred-items.md`.

---
*Phase: 21-reporte-diario-canal-whatsapp*
*Completed: 2026-07-26*

## Self-Check: PASSED

- `public/index.html` — FOUND (los 19 ids de contrato, copy literal, `app.js?v=20260726a`, `style.css?v=20260725a` intacto)
- `public/app.js` — FOUND (`_cmdLoadReportPanel`, `_cmdReportPaint`, `_CMD_REPORT_QUEUED_MSG`, `window._teamOpenLeaveModal`; `node --check` → 0)
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-04-SUMMARY.md` — FOUND
- `.planning/phases/21-reporte-diario-canal-whatsapp/deferred-items.md` — FOUND
- Commits `e808f4d`, `f53c845`, `c1041e1` — FOUND en `git log`
- Key links verificados: `loadCommandCenter()` → `_cmdLoadReportPanel().catch(() => {})` ✓ (2 llamadas al loader + 1 definición) · `#cmd-report-send-now-btn` → `askConfirm` → `POST /api/admin/daily-report/send-now` ✓ · `_teamRenderTable` → `PATCH /api/setters/team/:id` con `{leaveUntil}` ✓ (7 ocurrencias)
- Verificación funcional: **111 PASS / 0 FAIL** (33 contra el preview + 78 con el código real contra DOM stub) · checklist a-f **6/6 PASS**
