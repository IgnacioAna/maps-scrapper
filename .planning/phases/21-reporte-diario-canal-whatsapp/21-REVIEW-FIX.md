---
phase: 21-reporte-diario-canal-whatsapp
fixed_at: 2026-07-27T00:22:57Z
review_path: .planning/phases/21-reporte-diario-canal-whatsapp/21-REVIEW.md
iteration: 1
findings_in_scope: 19
fixed: 19
skipped: 0
status: all_fixed
---

# Phase 21: Code Review Fix Report

**Fixed at:** 2026-07-27T00:22:57Z
**Source review:** `.planning/phases/21-reporte-diario-canal-whatsapp/21-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 19 (3 critical + 16 warnings; el review no tiene Info)
- Fixed: 19
- Skipped: 0

**Suite:** baseline `945 tests, 4 rojos` (los 4 de `tests/wa-campaign-engine.test.js`,
flaky ambiental ajeno a la fase) → final **972/972 verdes, 0 rojos** (66 files, 15,8s).
27 tests nuevos. En la corrida final incluso los 4 flaky pasaron (dependen de hora/día).

**Cache-buster:** `app.js?v=20260726a` → **`v=20260726b`** (WR-15 tocó `public/app.js`).
`style.css` NO se tocó.

---

## ⚠️ Lo primero que tiene que hacer el user

El `app.asar` del portable **v0.5.11 se re-empaquetó** con los fixes del desktop. Si ya
tenías el .exe abierto, **cerralo y volvé a abrirlo** — si no, corrés la prueba en vivo
con los 2 blockers del desktop todavía adentro.

```
Binario a abrir:
  wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe

app.asar nuevo:  104.161.712 bytes · md5 92e90a70242cc0a345d29dbc8ef31620
Rollback:        wa-multi/backups/app.asar-v0511-pre-reviewfix-20260726.bak
                 104.152.630 bytes · md5 86acfd9d6952797f6cf3da3e5faa7879
                 (y la carpeta wa-multi-portable-v0.5.10 sigue intacta)
```

La versión **no** cambió (sigue `0.5.11`): solo el contenido del asar.

---

## Fixed Issues

### CR-01 (BLOCKER): el guard de alcanzabilidad contaba la pestaña del navegador como "desktop conectado"

**Files modified:** `src/wa/gateway.js`, `index.js`, `tests/report-queue.test.js`, `tests/daily-cron.test.js`
**Commit:** `d33c1cb`
**Applied fix:** `presence` guarda `desktopSockets` (el `io.use` ya marcaba
`source: 'desktop'|'browser'`, solo no se persistía), se limpia en `disconnect`, y se
exporta `isDesktopConnected` (expuesto en `exposeGlobals`). El guard del tick y el
`desktopOnline` del panel pasaron a ese helper; **sin el helper NO se emite** (fallback
conservador: mejor `pending` que quemar `sendAttempts`).
**Tests:** 3 nuevos — browser abierto + desktop cerrado no emite ni quema presupuesto,
gateway sin el helper no emite, y el panel usa el mismo guard que el tick. Los gateway
dobles de las 2 suites ahora modelan las dos fuentes (`mkGateway(online, browserOnly)`).
**Requiere verificación en vivo (21-07):** que el socket del desktop llegue por JWT
(vía 1 del `io.use` → `source:'desktop'`). No hay `socket.io-client` en el repo, así que
el poblado de `presence` no está cubierto por un test end-to-end.

### CR-02 (BLOCKER): el picker guardaba el JID de un chat que no era el elegido

**Files modified:** `wa-multi/src-v058-work/out/preload/whatsapp.js` (gitignored), `index.js`, `tests/report-queue.test.js`
**Commit:** `c704680`
**Applied fix:** en el preload, `openChatHeaderName()` + `_pickerNorm()` (mismo rango de
diacríticos escapado que `_reportNormalizeName`); `choose` manda el JID **solo si** el
header del chat abierto normaliza igual que el nombre elegido — si no, `null`, y el
server lo backfillea con el `matchedJid` del primer envío real (degradado, no roto).
Red de seguridad server-side, porque un JID equivocado dejaba el canal muerto para
siempre: (a) `transport.jidMismatchCount` cuenta `jid-mismatch` **consecutivos** y a la
segunda des-fija `groupJid`/`jidCapturedAt` volviendo a la verificación por nombre
(cualquier otro reason, o un ok, corta la racha); (b) `PUT /api/admin/daily-report/config`
acepta `groupJid: null` para limpiarlo a mano — **setearlo** por ahí devuelve 400.
**Tests:** 4 nuevos (auto-des-fijado a la 2da, racha cortada por otro reason, el PUT que
solo acepta null) + verificación del preload ejecutando el IIFE REAL cortado del archivo
contra un DOM stub (con otro chat abierto → `groupJid: null` y el `groupName` correcto;
con el chat elegido abierto y acentos/case distintos → manda el JID).

### CR-03 (BLOCKER): el `queueId` se reusaba entre intentos → confirmación descartada y reporte duplicado

**Files modified:** `index.js`, `wa-multi/src-v058-work/out/main/index.js` (gitignored), `tests/report-queue.test.js`, `tests/daily-cron.test.js`
**Commit:** `f643cad` (junto con WR-03 y WR-09 — los tres son el mismo handler)
**Applied fix (server):** se emite `queueId: <itemId>#<n>` (`attemptId` por intento,
guardado en el item); el resultado resuelve el item por prefijo y **busca también en
`history`**, así un `ok:true` tardío CIERRA el item en vez de descartarse con
`item_no_en_vuelo`; `lastGroupIds` conserva el grupo consolidado del intento (el timeout
ya había limpiado `consolidatedInto`) para que un ok tardío cierre a los N hermanos; un
resultado de un intento VIEJO no puede requeuear el intento en vuelo; `confessedIds` ya
no se borra en el timeout (el líder los recalcula en cada emisión) así que el sello de
D-05 se aplica igual con un ok tardío; reason nuevo `invalid-payload` = terminal.
**Applied fix (desktop):** `_reportItemKey` / `_reportSentItems` / `_reportAlreadySent` /
`_reportMarkSent` — memoria **por ITEM** de lo ya tipeado OK (TTL 90 min > el ciclo de
reintentos del server: 20 × 150s ≈ 50 min): un reintento cuyo resultado se perdió
**re-confirma sin volver a escribir en el grupo**. Las 3 validaciones de payload
devuelven `invalid-payload` en vez del `exception` genérico.
**Tests:** 6 nuevos (attemptId #1/#2, ok tardío que cierra, ok tardío del consolidado que
cierra a los 3, fallo de intento viejo que no toca el vuelo, `duplicate`, `invalid-payload`).
**Decisión explícita:** `composer-not-found` **sigue siendo retryable**. El review pedía
hacer terminales los reason "no accionables", pero WR-07 muestra que ese es justamente el
reason que puede ser un **falso negativo de un envío exitoso**: hacerlo terminal
convertiría un reporte entregado en un fallo permanente + fallback a DM.

### WR-01: off-by-one en la escalada de D-16

**Files modified:** `index.js`, `tests/daily-report.test.js`
**Commit:** `e6c04ca`
**Applied fix:** el helper `_reportWeekdaysSince` **no cambia** (su semántica está
documentada y testeada); se suma el día de HOY en el call site, solo si hoy es hábil.
Última llamada lun 20/07 → el lun 27/07 (5to hábil sin llamar) ahora da 5 y escala.
**Tests:** 2 nuevos (mié 15/07 = 5to hábil escala con `days: 7`; jue 16/07 = 4to sigue en
`idleToday`; y el sábado que no adelanta la escalada). El primero es RED antes del fix.

### WR-02: un diario en cola entregado días después seguía diciendo "Hoy"

**Files modified:** `index.js`, `tests/daily-report.test.js`, `tests/report-queue.test.js`
**Commit:** `669265d`
**Applied fix:** `buildDailyReportText(data, { delayed })` reemplaza "hoy" por el
`dayLabel` en los 3 encabezados posibles; `enqueueReportMessage` acepta `textDelayed` y
lo guarda en el item (el cron diario y "mandar ahora" encolan las dos redacciones); el
tick elige `textDelayed` cuando `item.dayStr !== _bizDayStr(nowTs)`. **El molde validado
por el user para el envío del MISMO día queda byte-idéntico** (D-19 intacto).
**Tests:** 4 nuevos, incluido el caso de HOY que protege el molde de D-19.

### WR-03: el reintento re-emitía el mismo `queueId` y el desktop lo dedupeaba 15 min en silencio

**Files modified:** `index.js`, `wa-multi/src-v058-work/out/main/index.js` (gitignored), `tests/report-queue.test.js`
**Commit:** `f643cad`
**Applied fix:** resuelto de raíz por el `attemptId` de CR-03 (el desktop ya no dedupea
un reintento deliberado) **más** el mínimo intermedio que pedía el review: el desktop
contesta `reply(false, null, 'duplicate')` al dedupear, y el server trata `duplicate`
como "sigue en vuelo" (`duplicado_ignorado`) sin requeuear ni contar la vuelta. Antes el
server esperaba 150s a ciegas y en los logs solo se veía `timeout`, sin pista del dedupe.

### WR-04: el lock de "un envío en vuelo" de `send-now` era un TOCTOU

**Files modified:** `index.js`, `tests/daily-cron.test.js`
**Commit:** `b51a323`
**Applied fix:** el chequeo se movió DENTRO del mismo `mutateReportsState` que encola, así
que chequeo y encolado son atómicos entre sí. Además cuenta como ocupado el `custom` en
`pending`: el segundo click llega antes de que el tick haya podido poner algo en
`sending`, así que mirar solo `sending` dejaba pasar la carrera igual.
**Tests:** 1 nuevo con dos POST en `Promise.all` → queda UN solo `custom` en la cola y una
de las respuestas trae `reason: 'busy'`.

### WR-05: `_reportVerifyChat` aceptaba coincidencias por substring en las dos direcciones

**Files modified:** `wa-multi/src-v058-work/out/main/index.js` (gitignored)
**Commit:** `11b172f` (marcador)
**Applied fix:** igualdad normalizada, o que el **header** contenga el nombre del grupo con
un mínimo de 6 chars (por sufijos de WhatsApp). Se eliminó `b.includes(a)`, la dirección
peligrosa (grupo "Reportes SCM" + contacto "SCM" verificaba).
**Verificación:** se ejecutó el `_reportVerifyChat` REAL cortado del archivo → 10/10 casos
(incluidos los 2 que antes pasaban mal y el `jid-mismatch`).
**No se cambió el server:** el review menciona como agravante que `groupName` acepta 1
carácter, pero con el camino de igualdad exacta un nombre corto sigue funcionando bien;
subir el mínimo habría rechazado un grupo legítimamente corto.

### WR-06: la caja de búsqueda no se limpiaba y el mecanismo primario `pinned-row0` quedaba inutilizado

**Files modified:** `wa-multi/src-v058-work/out/main/index.js` (gitignored)
**Commit:** `11b172f` (marcador)
**Applied fix:** el reload pasó a ser **incondicional** al empezar (era condicional a que
la URL fuera un deeplink; después de un envío al grupo la URL ya es `web.whatsapp.com`, así
que no recargaba y el envío siguiente leía `items[0]` de una lista todavía filtrada).
Además se manda `Escape` cuando la búsqueda no verifica o no da resultados. Costo: ~4s en
un envío por día, a cambio de eliminar una clase entera de fallos por estado residual.

### WR-07: la confirmación de envío contaba burbujas de todo el documento

**Files modified:** `wa-multi/src-v058-work/out/main/index.js` (gitignored)
**Commit:** `11b172f` (marcador)
**Applied fix:** `_reportReadOpenChat` scopea todo a `#main` y devuelve `lastOutId` (el
`data-id` completo de la última burbuja saliente); el éxito se decide por "cambió
`lastOutId`" **o** por el conteo, y el log incluye las dos señales. Esto ataca el falso
negativo que la virtualización producía (`composer-not-found` sobre un envío exitoso), que
es el disparador más probable del duplicado de CR-03.

### WR-08: los sanitizadores solo quitaban CR-LF; TAB / U+2028 / U+2029 llegaban al tipeo OS-level

**Files modified:** `index.js`, `wa-multi/src-v058-work/out/main/index.js` (gitignored), `tests/daily-report.test.js`, `tests/report-queue.test.js`
**Commit:** `41626e2`
**Applied fix:** `_reportSafeText` con **whitelist** (fuera controles C0/C1 y separadores de
línea Unicode, rango escapado) + colapso de espacios; `_reportSafeName` lo usa con cap 40 y
el `groupName` de `handleReportGroupConfigured` con el mismo saneo **sin cap** (un nombre
gigante se RECHAZA, no se trunca en silencio). Defensa en profundidad en el desktop:
`OS_TYPE_SKIP_RE` en `osTypeText` (aplica a TODO lo que tipea la app, no solo al reporte) y
`REPORT_LINE_SPLIT_RE` en los 2 sitios de tipeo multilínea para que U+2028/9 salgan como
Shift+Enter y no como char.
**Tests:** 6 casos de control (TAB, U+2028, U+2029, VT, NEL, CR-LF) + el mensaje completo sin
ningún carácter de control + la whitelist del `groupName`.

### WR-09: la authz de `handleReportSendResult` se evaluaba dentro del mutex

**Files modified:** `index.js`, `tests/report-queue.test.js`
**Commit:** `f643cad`
**Applied fix:** el guard corre **antes** del mutex (`mutateReportsState` hace
`saveReportsState` siempre, sin importar lo que devuelva el mutator). El warn quedó
throttleado a 1 por minuto: sin log, un emisor en loop no deja rastro; con log por evento,
inunda los logs de Railway que son el único rastro de auditoría del canal.
**Tests:** 1 nuevo — 5 eventos rechazados seguidos dejan `reports.json` **byte-idéntico**
(el fixture está escrito de forma que el normalizador lo cambiaría si entrara al mutex).

### WR-10: `accountId` no validaba charset y se interpolaba en un `console.log`

**Files modified:** `index.js`, `tests/report-queue.test.js`
**Commit:** `41626e2`
**Applied fix:** `/^[\w.:-]{1,64}$/` (los ids reales de cuenta entran de sobra).
**Tests:** el caso de log forging con salto de línea, el de espacios, y un id real con
`. : - _` que sigue entrando.

### WR-11: `data/reports.json` está gitignored — la cadena de persistencia que afirmaba el comentario no existe

**Files modified:** `index.js` (comentario), `.planning/phases/21-reporte-diario-canal-whatsapp/21-CONTEXT.md`
**Commit:** `0e137d1`
**Applied fix:** se eligió la **opción 2** del review (corregir el comentario y aceptar la
pérdida explícitamente, por escrito) en vez de sacar el archivo del `.gitignore`.
**Razonamiento (esto es lo que el review pedía decidir):** `queue`/`history` guardan el
**texto** de los reportes, o sea nombres y métricas individuales de las vendedoras (D-24).
Commitear eso dejaría datos nominales de empleadas en el historial de git para siempre —
peor que la pérdida que evitaría. El precedente de Telnyx (stripear secrets en pre-deploy)
no aplica igual: ahí lo sensible son 5 campos, acá es el cuerpo del archivo. Además el
`.gitignore` lo clasifica explícitamente como "Logs y state local, nunca commitear".
Quedó escrito —en el código y en 21-CONTEXT.md— qué se pierde si el volumen se recrea
(`config.transport` + cola + historial → el diario deja de salir y el chip queda en "Sin
configurar") y **cómo se recupera en 2 minutos sin deploy**: abrir wa-multi → "Grupo de
reportes" → elegir el grupo otra vez.
**Verificado:** `.gitignore:12`, `git ls-files data/reports.json` = 0, `git check-ignore -v`
confirma, `pre-deploy.js:186` lo baja pero queda fuera del commit, y `seedVolumeFromRepo`
lo lista sin tener nada que sembrar.
**Pendiente para el cierre de fase (no lo hago yo):** sumar la nota a `CLAUDE.md`. No toco
ese archivo por política.

### WR-12: el cron semanal inyectaba `nowTs` para la ventana pero los datos salían de `Date.now()`

**Files modified:** `index.js`, `tests/weekly-report.test.js`
**Commit:** `fd05e5d`
**Applied fix:** `buildWeeklyReportData(nowTs = Date.now())` y el cron le pasa su propio
`nowTs`. Los 3 call sites sin reloj (mail manual, preview, `sendWeeklyReport`) usan el default.
**Tests:** 1 nuevo — con el reloj del dom 26/07 la ventana es 20-26/07 (3 llamadas, 1 en
`previous`); con el del dom 19/07 pasa a 13-19/07 y la llamada del viernes 17/07 se convierte
en la semana ACTUAL, encabezado del corto incluido.

### WR-13: las filas del picker aceptaban clicks sintéticos

**Files modified:** `wa-multi/src-v058-work/out/preload/whatsapp.js` (gitignored)
**Commit:** `1287103` (marcador)
**Applied fix:** helper `onRealClick(el, fn)` que ignora eventos con `isTrusted === false`,
aplicado al botón colapsado, a cada fila y a la `×`.
**Verificación:** el DOM stub prueba los 3 casos — un `.click()` programático no abre el
picker ni manda `report-group-selected`; el click humano sí.

### WR-14: `allChats()` solo ve las filas renderizadas (el grupo podía ser inseleccionable)

**Files modified:** `wa-multi/src-v058-work/out/preload/whatsapp.js` (gitignored)
**Commit:** `1287103` (marcador)
**Applied fix:** la lista cierra con "No lo ves? Scroleá la lista de chats de WhatsApp (o
buscá el grupo) y volvé a abrir esto."; se documentó la virtualización arriba del método y se
borró el campo muerto `index` (verificado: 0 consumidores en todo `out/`).

### WR-15: la vigencia del badge de licencia se comparaba en la zona del navegador

**Files modified:** `index.js`, `public/app.js`, `public/index.html`, `tests/team-performance.test.js`
**Commit:** `57a256e`
**Applied fix:** `team-performance` manda `onLeave: _reportOnLeave(s, Date.now())` (resuelto en
`BUSINESS_TZ`, mismo helper que el reporte) junto al `leaveUntil` que ya viajaba; el frontend
solo pinta (`const onLeave = !!s.onLeave`), conservando `leaveUntilStr` para la etiqueta y el
modal. Cache-buster bumpeado a `v=20260726b`.
**Tests:** 2 nuevos vía el PATCH real del setter — licencia futura / último día INCLUSIVE /
vencida / sin licencia, todo con `_bizDayStr`.
**No observado en el navegador:** este agente no tiene herramientas de preview. Es un swap de
fuente de dato en un badge de tabla, cubierto por el test de la API.

### WR-16: `neverStarted` nunca se pasaba, y el DM confesaba el bache que él mismo entregaba

**Files modified:** `index.js`, `tests/report-queue.test.js`
**Commit:** `23ebc6b`
**Applied fix:** (1) el item guarda `neverStarted` al encolar (cap 20) y el tick usa el del día
más reciente del grupo, así el consolidado recupera la línea de D-15 — el parámetro estaba
muerto. (2) `_reportGapItems` / `_reportGapNote` aceptan `skipIds` y el tick excluye
`first.id` + `first.parentId`: el DM de respaldo ya no dice "_No pude enviar el reporte de jue
24/07._" arriba del reporte de jue 24/07 que está entregando. Un bache de OTRO día sí se sigue
confesando.
**Tests:** 3 nuevos.

---

## Repack del `app.asar` (paso final obligatorio)

**Commit:** `fffa455` (marcador — `wa-multi/` gitignored)

Método (el que documentó 21-06; **NUNCA** un build, `out/` ES el source):

| Paso | Resultado |
|---|---|
| Backup del asar actual + md5 | `backups/app.asar-v0511-pre-reviewfix-20260726.bak` · 104.152.630 B · `86acfd9d…` (== el asar que se reemplazó) |
| `asar extract` + **diff de linaje** de los 2 archivos empaquetados vs el `out/` de trabajo | main `+121/-33`, preload `+46/-6`; las 33+6 líneas quitadas son EXACTAMENTE los reemplazos documentados de los fixes |
| Control: los otros 5 archivos de `out/` | **byte-idénticos** (`cmp`) → el `out/` deriva de v0.5.11, ningún build lo regeneró |
| mtimes de `out/` | solo `main/index.js` (21:05) y `preload/whatsapp.js` (21:01) son de hoy; los otros 6, de Jun 1 |
| `asar pack` | exit 0 · 104.161.712 B |
| md5 de los 2 re-extraídos vs `out/` de trabajo | **idénticos** (`ab0cf0d3…` main, `581a42ac…` preload) |
| `node --check` sobre los archivos **ya dentro** del asar | exit 0 los dos |
| `asar list` viejo vs nuevo | **13.546 entradas en los dos, set idéntico (0 diferencias)** |
| Aritmética de bytes | `+9.082` total `=` `+6.151` main `+` `+2.931` preload · header sin cambio → **ningún otro archivo cambió de tamaño** |
| `package.json` del asar | `0.5.11` (la versión no cambia; solo el contenido) |
| Greps de contenido dentro del asar | `_reportSentItems` 7 · `"duplicate"` 1 · `invalid-payload` 4 · `lastOutId` 8 · `b.length >= 6` 1 · `OS_TYPE_SKIP_RE` 2 · `openChatHeaderName` 2 · `onRealClick` 3 · nota de scroll 1 |
| Control negativo | `out.push({ index` = 0; la única aparición de `b.includes(a)` es dentro de un comentario (el código real es `a.includes(b)` con el mínimo de 6) |
| Temporales | `_asar-extract-rf`, `_asar-verify-rf`, `_app-rf.asar`, listados → **borradas** |

`README.txt` de `wa-multi/` documenta el re-repack, los md5, el rollback y que hay que cerrar
y volver a abrir el `.exe`.

---

## Desvíos de proceso (leer antes de auditar los commits)

1. **No se pudo usar un worktree aislado.** El protocolo pedía
   `git worktree add <tmp> main`, pero (a) `main` ya está checkouteado en el árbol
   principal y git rechaza el add; (b) un worktree nuevo **no tiene `node_modules`**
   (gitignored) → `npx vitest run` sería imposible; (c) tampoco tiene `wa-multi/`
   (gitignored) → 8 de los 19 hallazgos y el repack del asar serían imposibles. Se
   trabajó en el árbol principal (`main`, HEAD de partida `a5758ac`), stageando
   **siempre por ruta explícita**, nunca `git add .` ni `-A`. El único archivo ajeno con
   cambios (`.claude/worktrees/frosty-mendel-de2268`, un gitlink modificado que ya estaba
   así al empezar) **no se tocó ni se stageó**.
2. **`gsd-sdk` no está instalado** en este entorno (`command not found`). Los commits se
   hicieron con `git commit` directo, respetando el formato `fix(21): {ID} {descripción}`.
3. **6 commits son `--allow-empty` o solo-docs**: `wa-multi/` está gitignored
   (`.gitignore:32`, 0 archivos trackeados desde siempre), igual que en 21-05 y 21-06. **No se
   forzó `git add -f`.** Los mensajes de commit y este reporte son el registro del cambio.
   Rutas reales tocadas ahí:
   - `wa-multi/src-v058-work/out/main/index.js` (CR-03, WR-05, WR-06, WR-07, WR-08)
   - `wa-multi/src-v058-work/out/preload/whatsapp.js` (CR-02, WR-13, WR-14)
   - `wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar`
   - `wa-multi/backups/app.asar-v0511-pre-reviewfix-20260726.bak`
   - `wa-multi/README.txt`
4. **3 commits agrupan más de un hallazgo** porque son el mismo bloque de código y
   separarlos habría dejado estados intermedios incoherentes: `f643cad` (CR-03 + WR-03 +
   WR-09, todo `handleReportSendResult`), `11b172f` (WR-05 + WR-06 + WR-07,
   `sendReportToGroupInner`), `41626e2` (WR-08 + WR-10, el saneo de entradas).

## Qué queda sin verificar en vivo (para 21-07, con el user)

Todo el código del desktop se validó **ejecutando el código real cortado del archivo**
contra stubs (11 asserts del picker, 10 de `_reportVerifyChat`) + `node --check`, pero
nada de eso tocó una sesión real de WhatsApp Web:

- que el socket del desktop entre por JWT y quede como `source:'desktop'` en `presence`
  (CR-01) — el código lo dice, no hay test end-to-end de socket en el repo;
- que `Escape` limpie la búsqueda en la build de WhatsApp Web del user (WR-06); el reload
  incondicional lo cubre igual, `Escape` es el extra;
- que el `data-id` de la burbuja saliente cambie como se espera (WR-07);
- que el `isTrusted` de los clicks del overlay se comporte como en Chromium estándar
  dentro del preload aislado (WR-13);
- los ~4s extra del reload incondicional contra el `REPORT_SEND_TIMEOUT_MS` de 150s: el
  primer envío real es el que dice si ese techo sigue alcanzando (ya era un "sin verificar"
  de 21-02).

---

_Fixed: 2026-07-27T00:22:57Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
