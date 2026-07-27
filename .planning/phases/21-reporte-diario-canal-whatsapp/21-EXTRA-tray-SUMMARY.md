---
phase: 21-reporte-diario-canal-whatsapp
plan: EXTRA-tray
subsystem: infra
tags: [wa-multi, electron, tray, system-tray, asar, repack, windows]

# Dependency graph
requires:
  - phase: 21-reporte-diario-canal-whatsapp
    provides: "21-05: sendReportToGroup (el envío que tipea dentro de la ventana de WhatsApp) · 21-06: portable v0.5.11 + procedimiento de repack verificado del app.asar"
  - phase: 08-anti-deteccion-proxy-fingerprint
    provides: "out/ como source editable del desktop (NUNCA npm run build)"
provides:
  - "electron.Tray con ícono embebido (data URL, sin assets binarios nuevos): la X oculta y la app sigue viva en la bandeja de Windows"
  - "quitApp() — salida real: destruye bandeja y ventanas ANTES de app.quit() para que el preventDefault de v0.5.8 no cancele el quit"
  - "withRestoredVisibility(accountId, fn) — el envío muestra la ventana para tipear y la vuelve a ocultar al terminar (éxito, fallo o excepción)"
  - "_scmForceClose — separa la X del user (oculta) del cierre programático (destruye), preservando el force-destroy de v0.5.8"
  - "app.asar de v0.5.11 repackeado con la bandeja + backups/app.asar-v0511-pre-tray-20260726.bak"
affects: [21-07 prueba en vivo con el user, 23 alertas por excepción]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ícono de bandeja como PNG base64 embebido en el source (nativeImage.createFromDataURL): dentro del asar no hay assets de imagen y una ruta empaquetada mal resuelta = tray invisible = app irrecuperable"
    - "toda feature que intercepte 'close' tiene que verificar explícitamente que la app SIGUE pudiéndose cerrar (el peor resultado es un proceso que solo mata el Administrador de tareas)"
    - "degradación segura: si la bandeja no se puede crear, el comportamiento vuelve al viejo (la X cierra) en vez de dejar un proceso sin ventanas ni ícono"

key-files:
  created:
    - wa-multi/backups/app.asar-v0511-pre-tray-20260726.bak
  modified:
    - wa-multi/src-v058-work/out/main/index.js
    - wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar
    - wa-multi/README.txt

key-decisions:
  - "NO se creó una carpeta v0.5.12: se repackeó el asar de v0.5.11 (tercer repack del día, mismo patrón que el fix del code review). Una carpeta nueva son 443 MB duplicados para cambiar un archivo, y 21-CONTEXT.md / README ya apuntan a v0.5.11"
  - "Las etiquetas de comentario dicen 'bandeja:' y no 'v0.5.12:' — no inventar una versión que no existe en disco"
  - "El aviso de 'se ocultó' usa Notification nativa (el camino que esta app ya usa en producción para proxy OK/caído) y deja displayBalloon como fallback"
  - "El aviso sale UNA vez por ejecución del proceso, no una vez para siempre: repetirlo en cada X es ruido, y no volver a verlo nunca tras un reinicio haría que un user nuevo creyera que cerró la app"
  - "withRestoredVisibility se aplicó también a sendMessageInWindow (followups + fallback por DM), no solo al reporte: es la misma mecánica de tipeo y el mismo riesgo de dejar la ventana plantada"

requirements-completed: []

# Metrics
duration: 20min
completed: 2026-07-26
---

# Phase 21 EXTRA: cerrar a la bandeja del sistema Summary

**La X ya no mata wa-multi: oculta la ventana y la app queda viva en la bandeja de Windows con un menú para volver a abrirla o salir de verdad — y el reporte de las 23:00 sigue saliendo con la ventana oculta, porque el envío la muestra para tipear y la vuelve a ocultar al terminar.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-27T01:23Z
- **Completed:** 2026-07-27T01:43Z
- **Tasks:** 2 (código + repack)
- **Files modified:** 3 en disco (`out/main/index.js`, `app.asar`, `README.txt`) + 1 backup creado

## El problema que resuelve (no es cosmético)

El reporte diario de la Phase 21 se manda **tipeando dentro de la ventana de WhatsApp de este proceso**. Hasta ahora `window-all-closed` hacía `app.quit()`: cerrar con la X mataba el proceso y esa noche no salía el reporte. La única defensa era que el user se acordara de no cerrar la app. Con la bandeja, eso pasa a aguantar solo.

## Qué se hizo

Todo en `wa-multi/src-v058-work/out/main/index.js` (2.198 líneas; 86.689 → 96.109 bytes).

| Pieza | Qué hace |
|---|---|
| `TRAY_ICON_DATA_URL` | PNG 32x32 (círculo verde + burbuja) embebido como data URL. Sin assets binarios nuevos ni rutas a resolver dentro del asar |
| `createTray()` | Tooltip + menú **Abrir panel / Abrir WhatsApp / Salir**; click y doble click abren el panel |
| `createMainWindow()` | La X del panel oculta en vez de cerrar; `mainWindow` queda registrada a nivel módulo |
| handler `close` de la ventana de cuenta | La X del **user** oculta (sesión de WhatsApp viva). El force-destroy de v0.5.8 queda intacto para el camino que sí destruye |
| `closeAccountWindow()` | Marca `_scmForceClose` antes de `close()`: el cierre **programático** (comando `close` del módulo WA, borrado de cuenta) destruye de verdad y sigue emitiendo `window-closed` |
| reuso de ventana en `openAccountWindow` | `existing.show()` además de `focus()` — una ventana oculta no volvía con `focus()` solo |
| `window-all-closed` | Con bandeja viva ya no cierra. Sin bandeja o saliendo, cierra como antes |
| `quitApp()` + `before-quit` | Salida real (ver abajo) |
| `notifyHiddenToTray()` | Aviso una sola vez por ejecución: Notification nativa, balloon del tray como fallback |
| `withRestoredVisibility()` | Envuelve `sendReportToGroup` y `sendMessageInWindow`: la ventana se muestra para tipear (lo hace `bringToFront`) y se vuelve a ocultar al terminar |

### Lo más delicado: que la app se pueda cerrar

El handler de `close` de v0.5.8 hace `e.preventDefault()` y después `destroy()`. Un `preventDefault` durante un quit **cancela el quit**, así que un `app.quit()` ingenuo habría dejado la app viva y sin ícono (la bandeja ya destruida): irrecuperable salvo por el Administrador de tareas — exactamente el peor resultado posible de esta feature.

`quitApp()` por eso destruye a mano bandeja + ventanas de cuenta + panel **antes** de `app.quit()`, y `before-quit` marca `app.isQuitting` para cualquier otro camino de salida (Alt+F4, logoff de Windows, `app.quit()` de otro lado). Con cero ventanas vivas nadie puede cancelar el quit, y `window-all-closed` remata. Verificado en 3 tests distintos.

### Degradación segura

Si `nativeImage` devuelve un ícono vacío o `new Tray()` falla, **no se crea la bandeja** y todo vuelve al comportamiento anterior (la X cierra, `window-all-closed` hace quit). Nunca queda un proceso sin ventanas y sin ícono.

## Task Commits

1. **Código de la bandeja** — `90e56a7` (feat)
2. **Repack del app.asar + README** — `2d9ca99` (chore)

⚠️ Los dos son `--allow-empty`: `wa-multi/` está **gitignored** (`.gitignore:32`, 0 archivos trackeados desde siempre), igual que en 21-05 y 21-06. El detalle va en los mensajes de commit y acá.

⚠️ El subject del commit `90e56a7` dice **"(v0.5.12)"** por la etiqueta de trabajo inicial. **No hay v0.5.12**: se decidió repackear sobre v0.5.11 (ver Decisions) y las etiquetas del código se renombraron a `bandeja:` antes del repack. El commit `2d9ca99` lo deja explícito.

## Verificación

### Lógica: 29/29 contra el código real

No hay forma de correr Electron acá, así que se usó el patrón de 21-06: un harness que **ejecuta el código literal extraído del archivo** (cortado por marcadores, no retipeado) contra stubs de Electron. Los bloques extraídos: el bloque entero de la bandeja (149 líneas), `closeAccountWindow`, `withRestoredVisibility`, los dos `win.on(...)` de la ventana de cuenta, el fragmento de reuso de ventana, `window-all-closed` y `before-quit`.

| Grupo | Qué prueba |
|---|---|
| A. Ícono | el data URL **del archivo** decodifica a un PNG 32x32 con IDAT que descomprime a scanlines completas (o sea: el literal no quedó truncado al copiarlo al source) |
| B. createTray | tooltip + menú exacto `[Abrir panel, Abrir WhatsApp, separator, Salir]`; **ícono vacío → no crea bandeja y la app se sigue cerrando**; click abre el panel |
| C. X del panel | cancela el close, oculta, no destruye, avisa **una** vez (segunda X no repite); sin Notification cae al balloon; **sin bandeja cierra de verdad** |
| D. X de WhatsApp | oculta, **no** destruye, sigue en `openWindows`, **no** emite `window-closed`, no toca el debugger, y el aviso nombra la cuenta |
| E. closeAccountWindow | destruye de verdad, detachea el debugger (fix v0.5.8), sale de `openWindows`, emite `window-closed` — **también sobre una ventana ya oculta** |
| F. Salir | destruye ventanas ocultas y visibles + panel, mata la bandeja, `app.quit()`, y `window-all-closed` remata; **ninguna ventana cancela el quit**; Alt+F4/logoff también cierra |
| G. sin ventanas | con bandeja viva la app **no** se cierra |
| H. reabrir | la ventana oculta se muestra sin abrir una segunda; sin ventanas abre la primera cuenta cacheada; sin cuentas cae al panel; minimizada → restore+show; ventana destruida no se reusa |
| I. **envío con ventana oculta** | visible mientras tipea y oculta al terminar; visible-antes queda visible; **fallo** y **excepción** también restauran; si el envío abrió la ventana queda visible (como antes de la bandeja); si la ventana muere en el medio no explota; y los **dos** wrappers de envío pasan por `withRestoredVisibility` conservando `enqueueSend` |
| J. no-regresión | el force-destroy de v0.5.8 sigue completo (`_scmDestroying` en 2 sitios + detach del debugger) |

`node --check` sobre el archivo: exit 0. `out/` **no** regenerado (mtimes: solo `main/index.js` es de esta sesión; los otros 6 archivos siguen en Jun 1 y el preload en el 21-06 de las 21:01).

Suite del server: **972/972 (66 files)** — igual al baseline. Este cambio es desktop puro, se corrió para confirmar cero regresión.

### Repack: verificado, no asumido

**Linaje ANTES de copiar** (deviation #1 de 21-06, ahora parte del procedimiento): el `out/` de trabajo deriva del asar que estaba — 218 líneas agregadas y **9 quitadas, y las 9 son exactamente las mías** (el comentario del fix v0.5.8 reescrito —el código del fix sigue—, la línea de `closeAccountWindow`, los 2 wrappers de envío y `window-all-closed`). El preload y los otros 6 archivos de `out/`: md5 **idéntico** al asar. Control negativo: el asar viejo tenía **0** ocurrencias de `createTray`.

| Chequeo | Resultado |
|---|---|
| md5 de `main/index.js` + `preload/whatsapp.js` re-extraídos vs `out/` de trabajo | **idénticos** (`dca61ad5…`, `581a42ac…`) |
| `node --check` sobre los 2 archivos **ya dentro** del asar | exit 0 los dos |
| `asar list` nuevo vs backup | **13.546 entradas en los dos, 0 diferencias en el set** |
| Aritmética de bytes | `+9.420` total `=` `+9.420` de payload `=` el crecimiento de `out/main/index.js` (86.689 → 96.109); header **sin cambio de tamaño** → ningún otro archivo se tocó |
| Phase 21 sigue adentro | `sendReportToGroup` ×5, `report:send-message`, `report:send-result`, `osShiftEnter` ×4, picker del preload ×3 |
| Bandeja adentro | `createTray` ×2, `TRAY_ICON_DATA_URL` ×2, `withRestoredVisibility` ×4, `_scmForceClose` ×3, `electron.Tray` ×1 |
| Fuse `EnableEmbeddedAsarIntegrityValidation` del exe | **OFF** (`'0'`) → el asar repackeado bootea |
| `package.json` del asar | `0.5.11` (sin bumpear, a propósito) |
| Temporales `_asar-extract-tray` / `_asar-verify-tray` | borradas |

Herramienta: `npx --yes @electron/asar@3` (major pineado, T-21-30).

## Artefactos

**Para abrir (el user):**

```
C:\Users\Usuario\OneDrive\Desktop\GoogleSrapper\wa-multi\versiones\wa-multi-portable-v0.5.11\wa-multi-win32-x64\wa-multi.exe
```

| Artefacto | Datos |
|---|---|
| `app.asar` nuevo | `104.171.132` bytes · md5 **`62fcec2aa4d42b1e0f527dcbdc8bb3b3`** |
| **Backup para rollback** | `wa-multi/backups/app.asar-v0511-pre-tray-20260726.bak` · `104.161.712` bytes · md5 `92e90a70242cc0a345d29dbc8ef31620` |
| Rollback | copiar ese `.bak` sobre `versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar`. Alternativa más vieja: abrir `wa-multi-portable-v0.5.10/` (intacta) |
| `wa-multi.exe` | sin tocar (222.973.952 bytes, mtime Jun/19:05) |

Los 4 backups anteriores quedaron intactos: el nombre nuevo (`-pre-tray-`) no pisa ninguno.

## Deviations

### Auto-fixed

**1. [Rule 2 - Missing critical] El menú "Salir" no habría cerrado la app**

- **Encontrado en:** Task 1, al escribir el test F del harness.
- **Problema:** `app.quit()` a secas dispara `close` en cada ventana; el handler de v0.5.8 hace `preventDefault()` (y después `destroy()`). Electron **cancela el quit** ante cualquier `preventDefault`, así que "Salir" habría destruido la bandeja y dejado el proceso vivo, sin ícono y sin ventanas: solo matable desde el Administrador de tareas. Es el peor resultado posible de esta feature y no se ve por lectura.
- **Fix:** `quitApp()` destruye a mano bandeja + ventanas de cuenta + panel antes de `app.quit()`, y `before-quit` marca `isQuitting` para los caminos que no pasan por el menú.
- **Verificación:** 3 tests (menú Salir, "ninguna ventana cancela el quit", Alt+F4/logoff).
- **Commit:** `90e56a7`

**2. [Rule 2 - Missing critical] Un ícono roto habría dejado la app irrecuperable**

- **Encontrado en:** Task 1, escribiendo `createTray`.
- **Problema:** si `nativeImage` devolvía vacío o `new Tray()` fallaba, los handlers igual iban a ocultar las ventanas y `window-all-closed` ya no cerraba → proceso zombie sin ícono.
- **Fix:** `createTray()` devuelve `null` ante ícono vacío o excepción, y **los 3 puntos de decisión** (X del panel, X de la cuenta, `window-all-closed`) chequean `tray && !tray.isDestroyed()`. Sin bandeja, comportamiento viejo exacto.
- **Verificación:** tests "ícono vacío → no crea bandeja" y "sin bandeja la X cierra de verdad".
- **Commit:** `90e56a7`

**3. [Rule 2 - Missing critical] El wrapper de visibilidad faltaba en el camino por DM**

- **Encontrado en:** Task 1.
- **Problema:** el alcance pedía cubrir `sendReportToGroup`, pero el fallback por DM (D-02) y los followups salen por `sendMessageInWindowInner`, que usa la **misma** mecánica (`bringToFront` + tipeo OS-level). Sin el wrapper, el fallback del reporte —justo el camino que corre cuando el grupo falla— dejaba la ventana plantada en pantalla a las 23:00.
- **Fix:** `withRestoredVisibility` también en `sendMessageInWindow`, conservando `enqueueSend`.
- **Verificación:** test "los dos envíos que tipean pasan por withRestoredVisibility".
- **Commit:** `90e56a7`

**4. [Rule 1 - Bug, en docs] El README aconsejaba el comando que borra el source**

- **Encontrado en:** Task 2, actualizando el README.
- **Problema:** la nota final decía *"Para cambios mayores: extraer asar → modificar src/ → **npm run build** → repack"*. Ese comando regenera `out/` desde fuentes `.ts` sin los parches de v0.5.9/v0.5.10/Phase 21 — el invariante que todos los planes de esta fase repiten en mayúsculas. El README es lo primero que lee alguien que entra a la carpeta.
- **Fix:** nota reescrita: `out/` **es** el source, `npm run build`/`dist:win` prohibidos, y el flujo correcto (editar `out/` → extraer → copiar → packear → verificar → backup).
- **Commit:** `2d9ca99`

### Desvío de proceso

**5. [Rule 3 - Blocking] Los commits no pueden llevar contenido: `wa-multi/` está gitignored**

Mismo hallazgo que 21-05 y 21-06 (`.gitignore:32`). Se respetó la política del repo (**no** se forzó `git add -f`) y los commits son `--allow-empty` con el detalle en el mensaje. La prueba de que no se corrió un build son los mtimes de `out/` (2 de 8 archivos tocados en toda la fase, 6 en Jun 1), no `git status`.

---

**Total:** 4 auto-fixes (3 de código, 1 de docs) + 1 desvío de proceso. Ninguno agrega scope: los 3 de código cierran modos de fallo de la feature pedida, dos de ellos catastróficos.

## Sin verificar hasta que el user abra el .exe

Lo de abajo **no se pudo probar acá** (es una app Electron con GUI: abrirla conectaría el socket contra el server y abriría ventanas de WhatsApp en la máquina del user):

- **El ícono real en la bandeja de Windows.** El PNG se validó byte a byte (32x32, IDAT íntegro) y se miró renderizado, pero no se vio en la bandeja real. Windows 11 además esconde los íconos nuevos bajo la flechita "^" hasta que el user los ancla — si "no aparece", casi seguro está ahí abajo.
- **El aviso de "se ocultó".** Depende de que las notificaciones de Windows estén habilitadas para la app. Si el sistema las tiene apagadas, el aviso no se ve (la feature funciona igual, el user solo no recibe el cartel la primera vez).
- **⚠️ Lo más importante: el tipeo con la ventana oculta-y-mostrada.** La lógica de mostrar/re-ocultar está probada, y `bringToFront` (que ya corre hoy en cada envío) muestra la ventana **antes** del reload y del tipeo. Lo que nadie verificó es si Chromium necesita algún tiempo extra de "asentado" tras un `show()` desde estado oculto para que `sendInputEvent` sea confiable. **Si el reporte de las 23:00 llegara vacío o cortado con la ventana escondida, ese es el primer sospechoso** (mitigación: un `sleep` extra después de `bringToFront` cuando venía oculta).
- **Que la sesión de WhatsApp sobreviva horas oculta.** Es lo esperable (la ventana existe, solo no se muestra; WhatsApp Web mantiene su websocket), pero con la ventana oculta Chromium aplica throttling de timers al renderer. El envío la muestra antes de operar, así que el impacto esperado es nulo.
- **Doble click en el ícono** (en Windows algunos entornos solo emiten `click`): están cableados los dos, así que uno de los dos responde.

## User Setup Required

Nada nuevo. Al abrir el `.exe` (misma ruta de siempre, ver arriba):

1. La X de cualquier ventana ahora **esconde**. La app sigue en la bandeja (círculo verde con burbuja; puede estar bajo la flechita "^" — conviene anclarlo arrastrándolo a la barra).
2. Para volver: click en el ícono (panel) o click derecho → **Abrir WhatsApp**.
3. Para cerrar de verdad: click derecho → **Salir**.
4. Si algo saliera mal con este asar: restaurar `backups/app.asar-v0511-pre-tray-20260726.bak` o abrir la carpeta `wa-multi-portable-v0.5.10`.

## Next Phase Readiness

- **21-07 (prueba en vivo)** gana una condición previa que antes era un pedido de buena fe ("dejá la app abierta"): ahora la X no la cierra. Al abrir el `.exe`, mirar primero que **aparezca el ícono en la bandeja** — si no aparece, no se creó (el log dice `[tray] ícono vacío…` o el error de `new Tray`) y la app se comporta como v0.5.11 vieja, sin riesgo.
- **Riesgo abierto (heredado):** el `out/` de trabajo sigue fuera de git; ahora hay copia dentro del asar de v0.5.11 y el `.bak` previo. Un `npm run build` en `src-v058-work` seguiría clobbereando el source — el README ya no lo sugiere.

---
*Phase: 21-reporte-diario-canal-whatsapp (extra, sin plan GSD — pedido en vivo)*
*Completed: 2026-07-26*

## Self-Check: PASSED

- `wa-multi/src-v058-work/out/main/index.js` — FOUND (2.198 líneas, 96.109 B; `node --check` exit 0; `createTray` 2, `withRestoredVisibility` 4, `_scmForceClose` 3, `electron.Tray` 1, 0 etiquetas `v0.5.12`)
- `.../v0.5.11/wa-multi-win32-x64/resources/app.asar` — FOUND (104.171.132 B · md5 `62fcec2aa4d42b1e0f527dcbdc8bb3b3`, coincide con lo documentado; re-extraído: md5 de los 2 archivos == `out/` de trabajo)
- `.../v0.5.11/wa-multi-win32-x64/wa-multi.exe` — FOUND (sin tocar)
- `wa-multi/backups/app.asar-v0511-pre-tray-20260726.bak` — FOUND (104.161.712 B · md5 `92e90a70…`, == el asar previo; los 4 backups anteriores intactos)
- `wa-multi/versiones/wa-multi-portable-v0.5.10/wa-multi-win32-x64/wa-multi.exe` — FOUND (rollback alternativo disponible)
- `wa-multi/README.txt` — FOUND (sección del re-repack + nota de `npm run build` corregida)
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-EXTRA-tray-SUMMARY.md` — FOUND
- commits `90e56a7`, `2d9ca99` — FOUND en `git log`
- temporales `_asar-extract-tray` / `_asar-verify-tray` — AUSENTES
- `out/` NO regenerado: solo `main/index.js` con mtime de esta sesión
- harness de lógica **29/29** · suite del server **972/972 (66 files)**
