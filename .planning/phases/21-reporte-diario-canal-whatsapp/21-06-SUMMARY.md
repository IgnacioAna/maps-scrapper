---
phase: 21-reporte-diario-canal-whatsapp
plan: 06
subsystem: infra
tags: [wa-multi, electron, whatsapp-web, dom-scraping, preload-overlay, asar, repack]

# Dependency graph
requires:
  - phase: 21-reporte-diario-canal-whatsapp
    provides: "21-05: relay ipcMain 'wa:event' type='report-group-selected' → socket 'report:group-configured' + sendReportToGroup en out/main/index.js · 21-02: handleReportGroupConfigured server-side que persiste el grupo en reports.json"
  - phase: 08-anti-deteccion-proxy-fingerprint
    provides: "out/ como source editable del desktop (NUNCA npm run build) + procedimiento de repack del app.asar con @electron/asar"
provides:
  - "detectors.allChats() — todas las filas visibles de la lista de chats (unreadChats() sin el filtro de badge), cap 40"
  - "overlay #scm-report-group-picker dentro de WhatsApp Web: elegir el grupo de reportes una sola vez (D-03) sin copiar ningún identificador a mano"
  - "send('report-group-selected', {groupName, groupJid}) — cierra el camino picker → main → server por el canal IPC/socket que ya existían"
  - "wa-multi-portable-v0.5.11: binario portable con el código de 21-05 + 21-06 dentro del app.asar"
  - "backups/app.asar-v0510-pre0511-20260726.bak — rollback del asar de v0.5.10"
  - "README.txt con la versión actual y la sección 'Cambios v0.5.11 vs v0.5.10'"
affects: [21-07 prueba en vivo con el user, 21-04 panel de config (muestra el grupo que el picker configuró), 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "overlay inyectado desde el preload con createElement + textContent (nunca innerHTML) para pintar datos que vienen del DOM de terceros"
    - "repack del app.asar verificado por md5 de los archivos re-extraídos + aritmética de bytes del asar (no por 'quedó packeado sin error')"

key-files:
  created:
    - wa-multi/versiones/wa-multi-portable-v0.5.11/ (portable completo, gitignored)
    - wa-multi/backups/app.asar-v0510-pre0511-20260726.bak
  modified:
    - wa-multi/src-v058-work/out/preload/whatsapp.js
    - wa-multi/README.txt
    - .planning/phases/21-reporte-diario-canal-whatsapp/21-CONTEXT.md

key-decisions:
  - "El id del overlay va inline en las dos ocurrencias (no en una const) para calcar injectSpeedSelector y cumplir el criterio de grep del plan"
  - "El picker NO abre el chat elegido ni fuerza nada: el JID se lee best-effort de la burbuja visible y si no hay va null (el server lo backfillea con matchedJid del primer envío real)"
  - "La lista vacía no es un error: si WhatsApp todavía no pintó los chats (o está en QR), el overlay dice qué hacer en vez de fallar"
  - "El commit de la Task 1 es --allow-empty (wa-multi/ gitignored, igual que en 21-05); el de la Task 2 lleva solo la referencia canónica del CONTEXT"

patterns-established:
  - "Verificación de un repack: re-extraer el asar y comparar md5 contra el out/ de trabajo + comparar el listado completo de entradas contra el backup + cuadrar la aritmética de bytes. Un pack corrupto o incompleto se detecta en el acto"
  - "Antes de repackear, diffear el archivo del asar viejo contra el out/ de trabajo para confirmar el linaje (que el out/ derive de la última versión y no de una anterior, que haría REGRESAR features)"

# REP-06 lo comparten 5 planes (21-02 cola, 21-04 panel, 21-05 transporte,
# 21-06 picker+repack, 21-07 prueba en vivo). Este plan entrega el setup del
# grupo y el binario: no se marca completo hasta que el mensaje llegue al grupo
# real (21-07).
requirements-completed: []

# Metrics
duration: 14min
completed: 2026-07-26
---

# Phase 21 Plan 06: Picker del grupo + repack v0.5.11 Summary

**Dentro de la ventana de WhatsApp hay un botón "Grupo de reportes" que lista los chats y, al elegir uno, manda el nombre (y el identificador `@g.us` si se puede leer) al server por el canal que ya existía — y todo eso, más el transporte de 21-05, está empaquetado en un portable `v0.5.11` cuyo asar se verificó por md5, listado de entradas y aritmética de bytes.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-26T21:59:40Z
- **Completed:** 2026-07-26T22:14:00Z
- **Tasks:** 2/2
- **Files modified:** 3 tocados a mano (`out/preload/whatsapp.js`, `README.txt`, `21-CONTEXT.md`) + 1 artefacto binario generado (`app.asar` de v0.5.11) + 1 backup

## Accomplishments

- **El user ya no tiene que copiar ningún identificador a mano (D-03).** Abre WhatsApp en wa-multi, clickea "Grupo de reportes" abajo a la izquierda, elige el grupo de la lista y listo: el nombre viaja `preload → ipcMain('wa:event') → socket('report:group-configured') → reports.json`. Cero endpoints REST nuevos, cero UI nueva en el dashboard Vue (su bundle es un build de Vite minificado sin fuentes `.vue`).
- **El overlay recuerda lo único que el sistema no puede hacer solo:** fijar el chat en WhatsApp. El pin es el mecanismo de localización primario del envío (A1); sin él, el envío depende del fallback de búsqueda por nombre, que nunca se probó.
- **`detectors.allChats()` es `unreadChats()` sin el filtro de badge** — mismos selectores que ya corren en producción desde Phase 7/8. Cero scraping nuevo, cero superficie nueva de selectores frágiles (L7).
- **T-21-29 cerrado por construcción:** cada fila se crea con `createElement` + `textContent`. Verificado con un chat llamado `<img src=x onerror=alert(1)>`: llega como texto, no ejecuta nada. Cero `innerHTML` en todo el IIFE del picker.
- **Existe un binario que corre el código de la fase** (`wa-multi-portable-v0.5.11`), con el asar de v0.5.10 respaldado y la carpeta v0.5.10 intacta: si el v0.5.11 no arranca, el rollback es abrir la carpeta anterior.
- **Se descartó el riesgo de boot del repack:** el fuse `EnableEmbeddedAsarIntegrityValidation` del exe está en **off**, así que Electron no valida el hash del header contra el binario — el asar repackeado carga (era el único modo en que un repack correcto podía igual no arrancar).

## Task Commits

1. **Task 1: `detectors.allChats()` + overlay "Configurar grupo de reportes"** — `261765a` (feat)
2. **Task 2: repack a `wa-multi-portable-v0.5.11` + README + referencias de docs** — `ad5fb79` (chore)

⚠️ El commit de la Task 1 es `--allow-empty` y el de la Task 2 solo trae `21-CONTEXT.md`: `wa-multi/` está **gitignored** (`.gitignore:32`, 0 archivos trackeados desde siempre). Ver "Deviations".

## Files Created/Modified

**En disco (gitignored — el git log NO los tiene):**

| Ruta | Qué es |
|---|---|
| `wa-multi/src-v058-work/out/preload/whatsapp.js` | +130 líneas: `detectors.allChats()` (después de `unreadChats`) y el IIFE `initReportGroupPicker` (después de `initActivityBadge`). 654 → 784 líneas |
| `wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe` | binario a abrir (el portable completo son 443 MB, copiado de v0.5.10) |
| `wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar` | 104.152.630 bytes (v0.5.10: 104.127.806) — contiene `out/main/index.js` de 21-05 y `out/preload/whatsapp.js` de 21-06 |
| `wa-multi/backups/app.asar-v0510-pre0511-20260726.bak` | 104.127.806 bytes, md5 `b1fed13e…` idéntico al asar de v0.5.10 (que quedó sin tocar) |
| `wa-multi/README.txt` | "Versión actual" → v0.5.11 + ruta de "Para abrir" + sección "Cambios v0.5.11 vs v0.5.10" con la nota del repack y del backup |

**Versionado en git:**

- `.planning/phases/21-reporte-diario-canal-whatsapp/21-CONTEXT.md` — referencia canónica del binario → v0.5.11 (+ nota del rollback), y el paso 3 de "Acciones del user" ahora dice cómo elegir el grupo con el botón y **fijar el chat**.

**NO se corrió ningún build.** Verificado por mtimes: de los 8 archivos de `out/`, solo `main/index.js` (21-05, 18:31) y `preload/whatsapp.js` (este plan, 19:03) son de hoy; los otros 6 (renderer de Vue, chunks, `preload/main.js`) siguen en Jun 1.

## Cómo se verificó el asar (la parte que no se puede asumir)

| Chequeo | Resultado |
|---|---|
| Re-extracción del asar packeado → md5 de los 2 archivos vs el `out/` de trabajo | **idénticos** (`a4a85539…` main, `5c612686…` preload) |
| `node --check` sobre los 2 archivos **ya dentro** del asar | exit 0 los dos |
| `report:send-message` (handler literal) en `out/main/index.js` del asar | 1 |
| `report-group-selected` en `out/preload/whatsapp.js` del asar | 1 |
| `sendReportToGroup` / `scm-report-group-picker` / `allChats()` en el asar | 5 / 2 / 2 |
| `"version"` en el `package.json` del asar | `0.5.11` |
| Listado completo de entradas: backup v0.5.10 vs asar v0.5.11 | **13.546 entradas en los dos, mismo set exacto** (solo cambió el orden interno que aplica asar 3.4.1) |
| Aritmética de bytes | `+24.824` total `=` `+4` de header padded `+` `24.820` de los 2 archivos → **ningún otro archivo del asar cambió de tamaño** |
| Fuse `EnableEmbeddedAsarIntegrityValidation` del exe | **off** → el asar repackeado boota |
| `wa-multi/versiones/wa-multi-portable-v0.5.10/` | intacto (md5 del asar == backup) |
| Temporales `_asar-extract-v0511` / `_asar-verify-v0511` | borradas |

Herramienta: `npx --yes @electron/asar@3` → resolvió a **v3.4.1** (major pineado, T-21-30). El registry respondió sin problemas.

## Verificación del picker (sin Electron)

No hay `jsdom` en el repo y no se instaló nada. En vez de eso se ejecutó el **código real extraído del archivo** (`allChats()` + el IIFE completo, cortados del `.js` por línea, no retipeados) contra un DOM stub mínimo: **17/17 PASS**.

- overlay inyectado con el id correcto; los 2 reintentos (3s + 8s) registrados; re-inyectar no duplica
- colapsado = un solo botón `Grupo de reportes`; al abrir aparecen header + lista `max-height:50vh`
- la lista muestra **todos** los chats, incluidos los leídos (o sea: el filtro de badge quedó afuera)
- un chat llamado `<img src=x onerror=alert(1)>` llega como **texto** y sin hijos (T-21-29)
- al clickear una fila: **un solo** evento, `type='report-group-selected'`, `groupName` = el chat elegido, `groupJid` = `120363111222333444@g.us` leído del `data-id`
- después de elegir: `Grupo elegido: <nombre>` + el recordatorio de fijar el chat
- la `×` vuelve al botón colapsado
- sin `data-id` legible → `groupJid: null` (best-effort, como pide el plan)
- lista vacía → mensaje "No se ven chats…" en vez de romper

Suite del server: **918/918 (65 files)** — este plan no toca `index.js`, se corrió para confirmar cero regresión.

## Decisions Made

1. **El id `scm-report-group-picker` va inline en las dos ocurrencias**, no en una const. La primera versión usaba `const BOX_ID` y el criterio de grep del plan (`>= 2`) daba 1. Inline es además exactamente lo que hace `injectSpeedSelector` (`getElementById("scm-speed-selector")` + `box.id = "scm-speed-selector"`), así que el archivo queda más consistente, no menos.
2. **El picker no persiste nada del lado desktop.** Se evaluó guardar el grupo elegido en `localStorage` para que el overlay siguiera mostrando "Grupo elegido: X" tras un reload; se descartó: la fuente de verdad es `reports.json` en el server (el panel de 21-04 lo muestra) y duplicarla en el desktop crearía dos estados que pueden divergir. El overlay es un formulario de una sola vez, no un display de estado.
3. **La lista vacía se trata como caso normal, no como error.** Si el user abre el picker antes de que WhatsApp pinte los chats (o estando en la pantalla del QR), sale un mensaje que dice qué hacer. Un `throw` o una lista muda habría parecido "el botón no funciona".
4. **Se diffeó el `out/` de trabajo contra el asar de v0.5.10 ANTES de copiar** (ver Deviations #1). No estaba en el plan y resultó ser el chequeo más importante de la task.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] El plan no verificaba el linaje del `out/` antes de repackear — un repack ciego podía REGRESAR v0.5.10**

- **Found during:** Task 2 (entre el paso 3 "extraer" y el paso 4 "copiar los 2 archivos")
- **Issue:** el plan manda copiar `src-v058-work/out/{main/index.js,preload/whatsapp.js}` sobre lo extraído, sin comprobar que ese `out/` derive de **v0.5.10**. El dato que lo hacía sospechoso: `out/preload/whatsapp.js` tenía mtime **Jun 10** (era del Phase 8 / v0.5.9) mientras v0.5.10 se armó el **Jun 12**. Si v0.5.10 hubiera tocado el preload, copiar el archivo viejo encima habría **borrado silenciosamente** ese cambio del binario nuevo — y el síntoma no aparecería hasta que algo dejara de funcionar en la máquina del user, sin ninguna pista de por qué.
- **Fix:** se diffeó cada archivo extraído del asar de v0.5.10 contra el de trabajo antes de copiar. Preload: **130 líneas agregadas, 0 quitadas ni modificadas** → el de trabajo es el de v0.5.10 más lo mío. Main: 387 agregadas y solo 2 quitadas, que son exactamente los 2 reemplazos documentados de 21-05 (`await osTypeText(win, text);` → la rama multilínea, y `sendReplyInActiveChat` → `sendReplyInActiveChat,` + `sendReportToGroup` en los exports). También se confirmó que el "tipeo humano" de v0.5.10 está presente en el archivo de trabajo (`osTypeText` 7 ocurrencias vs 3 en v0.5.10) y que el código de Phase 21 **no** estaba en el asar viejo (control negativo: 0 y 0).
- **Files modified:** ninguno (chequeo de verificación; su valor es haber podido copiar sabiendo)
- **Verification:** los 4 diffs/greps de arriba
- **Committed in:** `ad5fb79` (detallado en el mensaje del commit)

**2. [Rule 2 - Missing critical] El plan verificaba el asar por grep, que no detecta un pack incompleto ni un payload corrupto**

- **Found during:** Task 2 (paso 7, verificación)
- **Issue:** el paso 7 del plan grepea 2 strings en la re-extracción. Eso prueba que los 2 archivos nuevos entraron, pero **no** que el resto del asar (13.544 archivos, incluido todo `node_modules` y el bundle de Vue del renderer) siga completo e intacto. Un pack que truncara o perdiera archivos pasaría los greps y dejaría un binario que no arranca — justo lo que el plan 21-07 necesita que no pase, y con el diagnóstico más difícil posible (a ciegas, en la máquina del user).
- **Fix:** se agregaron 4 verificaciones: (a) md5 de los 2 archivos re-extraídos contra el `out/` de trabajo (identidad byte a byte, no "contiene el string"); (b) `node --check` sobre los archivos ya dentro del asar; (c) `asar list` de los dos asars → 13.546 entradas y, ordenados, **cero** diferencias (solo cambió el orden interno de asar 3.4.1); (d) aritmética del contenedor: `+24.824` bytes `=` `+4` de header padded `+` los `+24.820` de los 2 archivos, o sea que ningún otro archivo cambió de tamaño. De paso se leyó el fuse `EnableEmbeddedAsarIntegrityValidation` del exe (**off**), que descarta el otro modo de fallo de boot de un asar repackeado.
- **Files modified:** ninguno (verificación)
- **Verification:** ver la tabla "Cómo se verificó el asar"
- **Committed in:** `ad5fb79`

### Desvíos de proceso (no de código)

**3. [Rule 3 - Blocking] Dos criterios de aceptación se medían con `git status` sobre una carpeta gitignored**

- **Found during:** Task 1 (commit) y Task 2 (criterio final)
- **Issue:** las dos tasks piden verificar con `git status --porcelain wa-multi/src-v058-work/out/` que se listen "SOLO `main/index.js` y `preload/whatsapp.js`" (prueba de que no se corrió un build). `.gitignore:32` excluye **toda** la carpeta `wa-multi/` (`git check-ignore` lo confirma), así que ese comando siempre devuelve vacío — no puede distinguir "cambié 2 archivos" de "un build regeneró los 8". Es el mismo hallazgo del plan 21-05, ahora también en el criterio de "no se corrió build".
- **Fix:** se respetó la política del repo (no se forzó `git add -f`: meter el árbol del desktop con binarios contradice una decisión explícita del `.gitignore`) y se sustituyó la medición por **mtimes de todo `out/`**, que prueba lo mismo de forma más fuerte: solo 2 de los 8 archivos son de hoy, los otros 6 siguen en Jun 1 — imposible si hubiera corrido `npm run build`. Los commits de tarea son `--allow-empty` / solo-docs con el detalle de las rutas en el mensaje.
- **Verification:** `find wa-multi/src-v058-work/out -type f -printf '%T+ %s %p\n' | sort` (2 archivos de hoy, 6 de Jun 1) + `git check-ignore -v`
- **Committed in:** `261765a`, `ad5fb79`

**4. [Info] Un criterio de aceptación estaba mal calibrado**

- `grep -c "report:send-message" out/main/index.js` = 1: el valor real es **4** (1 registro del handler + 3 strings de log). Medido como lo midió 21-05 — con el literal entrecomillado `"report:send-message"` — da exactamente **1**. La intención del criterio (que el handler esté una sola vez) se cumple.

---

**Total deviations:** 2 auto-fixes (Rule 2 × 2, ambos de verificación) + 2 desvíos de proceso documentados
**Impact on plan:** ningún auto-fix cambió el código entregado: los dos agregan verificación que el plan no tenía y sin la cual un repack malo (o un `out/` con linaje equivocado) se habría descubierto recién en la máquina del user, durante el plan 21-07. Cero scope creep: no se tocó nada preexistente del preload, no se agregó ninguna dependencia y no se corrió ningún build.

## Issues Encountered

- **`npx @electron/asar@3` tarda** (descarga la herramienta al vuelo y el asar pesa 104 MB): extraer ~40 s, packear ~50 s. Las dos extracciones ocupan 122 MB cada una en `wa-multi/` mientras corren; se borraron al terminar, como pide el plan.
- **`asar extract-file` no sirve para rutas anidadas** (escribe usando el basename y las anidadas fallan en silencio). Se intentó para spot-checkear archivos no modificados; se resolvió con el `asar list` comparado + la aritmética de bytes, que cubren lo mismo de forma completa en vez de por muestreo.
- **No se lanzó el `.exe`.** Es una app Electron con GUI: abrirla acá conectaría el socket contra el server y abriría ventanas de WhatsApp en la máquina del user, interfiriendo con lo que él tenga corriendo. La verificación equivalente que sí se pudo hacer es la del contenido del asar (md5) y la del fuse de integridad. El arranque real es el plan 21-07.

## Sin verificar en vivo (hereda los Assumptions del research)

El picker se validó a nivel de lógica, no contra WhatsApp Web real. Queda para 21-07:

- **A1** — que fijar el grupo lo deje siempre en la fila 0 de `#pane-side`. El overlay lo pide explícitamente, pero nadie comprobó todavía que WhatsApp lo respete en esta build.
- **A2** — que el `data-id` de un mensaje de grupo traiga el chatId `…@g.us`. Si el formato cambió, `groupJid` sale `null` y el server lo backfillea con `matchedJid` del primer envío: **degradado, no roto**.
- Que los selectores `[data-testid="cell-frame-container"] / div[role="listitem"]` sigan matcheando las filas en la build que corra en la máquina del user (son los mismos que ya usa `unreadChats()` en producción, así que el riesgo es el preexistente, no uno nuevo — L7).
- **A4** — si la sesión del login del panel (`%APPDATA%/wa-multi/config.json`) y la de WhatsApp Web sobreviven al cambio de carpeta v0.5.10 → v0.5.11. Lo más probable es que haya que loguearse de nuevo y re-escanear el QR; para esta fase da igual, porque el número dedicado es nuevo y el QR se escanea igual.

## User Setup Required

Nada nuevo de este plan. Lo que ya bloqueaba el 21-07 sigue igual, con una ruta y un paso actualizados:

1. Conseguir un número nuevo y registrar WhatsApp.
2. Crear el grupo cerrado con los 2 socios (**sin las vendedoras**, D-24).
3. Abrir **`wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe`** (ojo: v0.5.11, no la v0.5.10 de las notas viejas), escanear el QR con el número nuevo, clickear **"Grupo de reportes"** abajo a la izquierda de la ventana de WhatsApp, elegir el grupo, **fijarlo en WhatsApp** (clic derecho → Fijar) y dejar la app abierta.
4. Si el v0.5.11 no arrancara: abrir la carpeta `wa-multi-portable-v0.5.10` (intacta) o restaurar `backups/app.asar-v0510-pre0511-20260726.bak`.

Opcional (D-02): `REPORT_DM_FALLBACK` en Railway, CSV de hasta 5 teléfonos E.164.

## Next Phase Readiness

- **Ola 2 cerrada.** Sigue **21-03** (cron diario + endpoints admin) y **21-04** (panel de config): el picker ya deja `config.transport.groupName` escrito por `handleReportGroupConfigured`, así que el panel tiene qué mostrar y el botón "mandar ahora" tiene a dónde mandar.
- **21-07** ya tiene binario: es la primera vez en la fase que existe un artefacto ejecutable con el canal completo (builder → cola → socket → desktop → grupo). Lo primero a mirar cuando el user lo abra: que el botón "Grupo de reportes" aparezca (si no aparece, el preload no cargó) y que el chat elegido quede en la fila 0 tras fijarlo (A1).
- **Riesgo abierto:** el `out/` de trabajo sigue fuera de git. Ahora hay una copia dentro del `app.asar` de v0.5.11 (y el de v0.5.10 respaldado), así que el código de la fase ya no vive en un solo lugar — pero un `npm run build` en `src-v058-work` seguiría clobbereando el source editable, y el `.bak` del asar es la única red.

---
*Phase: 21-reporte-diario-canal-whatsapp*
*Completed: 2026-07-26*

## Self-Check: PASSED

- `wa-multi/src-v058-work/out/preload/whatsapp.js` — FOUND (784 líneas; `allChats()` 2, `report-group-selected` 1, `scm-report-group-picker` 2, `Fijá ese chat en WhatsApp` 1; `node --check` exit 0)
- `wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe` — FOUND
- `.../v0.5.11/wa-multi-win32-x64/resources/app.asar` — FOUND (104.152.630 B; re-extraído: md5 de los 2 archivos == `out/` de trabajo; `node --check` OK dentro del asar)
- `wa-multi/backups/app.asar-v0510-pre0511-20260726.bak` — FOUND (md5 == asar de v0.5.10, intacto)
- `wa-multi/versiones/wa-multi-portable-v0.5.10/wa-multi-win32-x64/wa-multi.exe` — FOUND (rollback disponible)
- `wa-multi/README.txt` — FOUND (`v0.5.11` × 4)
- `wa-multi/_asar-extract-v0511` / `_asar-verify-v0511` — AUSENTES (temporales borradas)
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-06-SUMMARY.md` — FOUND
- commits `261765a`, `ad5fb79` — FOUND en `git log`
- `out/` NO regenerado: 2 de 8 archivos con mtime de hoy, los otros 6 en Jun 1
- suite completa `918/918` (65 files)
