---
phase: 37-ses-sesion-discado
plan: 04
subsystem: ui
tags: [power-dialer, dial-session, mi-rendimiento, ses-03, ses-04, frontend-puro]

# Dependency graph
requires:
  - phase: 37-02
    provides: "GET /api/setters/dial-sessions (historial, scope idéntico a cold-call-metrics) y PATCH /api/setters/dial-sessions/:id (mood), contrato congelado"
  - phase: 37-03
    provides: "bloque [37-03] SESSION-PURE (_sesDurationLabel, _sesClosingModel) expuesto en window.__ses; ciclo de vida de la sesión en el Power Dialer (_pdSession/_pdSessionOpen/_pdSessionClose/_pdShowClosing); chips de estado del operador (window._pdSessionMood)"
provides:
  - "_sesHistoryRows(sessions, nowMs): modelo puro de fila para la tabla de historial — agrupa por día de calendario LOCAL (Hoy/Ayer/fecha), sin sumar ningún total por día, dentro del mismo bloque [37-03] SESSION-PURE"
  - "SES_MOOD_LABELS: un solo mapa de etiquetas del estado del operador (bien/normal/costo/pesimo → Bien/Normal/Me costó/Pésima), declarado 1 vez dentro de SESSION-PURE, consumido por los chips de la pantalla de cierre Y la columna 'Cómo la remó' del historial"
  - "_mypLoadSessions(effectiveSetter): sección 'Sesiones de discado' en view-myperf, colgada de la misma cadena que _mypLoadPipeline (no bloquea el resto de la vista), setter efectivo explícito en modo Ver como SDR"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Un mapa de etiquetas compartido entre dos superficies (chips de cierre + columna de historial) vive DENTRO del bloque puro que ya alimentaba una de las dos — evita que las etiquetas con acentos diverjan entre pantallas sin tener que exponer una superficie nueva en window"
    - "Loader de sección dentro de una vista multi-sección (_mypLoadSessions) sigue el molde exacto de _mypLoadPipeline: guard de elemento inexistente, fetch con apiUrl(, catch que no rompe el resto de _mypLoad, estado vacío con texto guía en vez de tabla pelada"

key-files:
  created:
    - tests/dial-session-myperf-ui.test.js
  modified:
    - public/app.js
    - public/index.html
    - tests/dial-session-close-ui.test.js

key-decisions:
  - "SES_MOOD_LABELS se declaró DENTRO de [37-03] SESSION-PURE (no en un archivo/bloque nuevo): es un objeto de strings, no rompe la pureza del bloque (nada de document/localStorage/fetch(/Date.now(/window.), y así los dos consumidores (chips de cierre, columna de historial) leen la MISMA fuente sin duplicar acentos"
  - "window.__ses NO se extendió para incluir _sesHistoryRows/SES_MOOD_LABELS — se dejó tal cual la dejó 37-03 (`{ _sesDurationLabel, _sesClosingModel }`) porque hay un test PINEADO a ese literal exacto en tests/dial-session-close-ui.test.js; ambas piezas nuevas se referencian directo por identificador desde _mypLoadSessions, que vive en el MISMO closure de nivel superior (document.addEventListener('DOMContentLoaded', ...)) — no hace falta pasarlas por window para que funcionen en producción"
  - "_sesHistoryRows agrupa por día LOCAL (getFullYear/getMonth/getDate, no UTC): mismo criterio con el que el SDR lee su propio reloj; nowMs SIEMPRE por parámetro, nunca Date.now() dentro del bloque puro"
  - "El filtro de ruido de 37-02 (sesiones con 0 marcadas y <120s de duración, excluidas del listado por defecto) se respeta sin ningún cambio — _mypLoadSessions no manda `all=1`: una sesión de prueba abierta y cerrada sin discar no debe aparecer en Mi rendimiento, coherente con la decisión ya tomada en el backend"
  - "Ninguna agregación por día (total de marcadas/atendieron por jornada): decisión de 37-02 reforzada acá con un test dedicado (_sesHistoryRows NO suma nada por día) — un total diario paralelo competiría con el funnel canónico de la misma pantalla"

patterns-established:
  - "Mapa de etiquetas compartido dentro de un bloque puro ya existente, en vez de una superficie global nueva"

requirements-completed: [SES-03, SES-04]

# Metrics
duration: ~35min
completed: 2026-08-23
---

# Phase 37 Plan 04: Historial de sesiones de discado en Mi rendimiento (cierra la Fase 37) Summary

**Tabla "Sesiones de discado" en Mi rendimiento — hoy contra ayer, con marcadas/atendieron/conversaciones y la respuesta de estado del que marcó a la vista — verificada extremo a extremo contra un preview server real con datos reales, no solo con tests de fuente.**

## Performance

- **Duration:** ~35 min (14:18 → 14:53 hora local aprox, commits `bb2de71` y `2a5fd9e`)
- **Started:** inmediatamente después de cerrar 37-03
- **Completed:** tras verificación en preview + actualización manual de STATE/ROADMAP/REQUIREMENTS
- **Tasks:** 2 (ambas completas)
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/dial-session-close-ui.test.js`) + 1 creado (`tests/dial-session-myperf-ui.test.js`)

## Accomplishments

- El SDR entra a Mi rendimiento y ve sus últimas sesiones de discado agrupadas por día (Hoy / Ayer / fecha), con cuándo, cuánto duró, marcadas (en negrita, D-01), atendieron, conversaciones y cómo la remó — cerrando SES-03.
- SES-04 deja de ser write-only de punta a punta: el estado del operador que se guarda desde 37-02/37-03 ahora se LEE en la columna "Cómo la remó", con guion discreto (no rojo) cuando el SDR saltea la pregunta (D-03).
- Un mapa único de etiquetas (`SES_MOOD_LABELS`) reemplaza el array escrito a mano que tenían los chips de la pantalla de cierre — un solo lugar para las 4 etiquetas con acentos, dos consumidores.
- Una sesión que se cerró sola (`closedBy:'auto'`) queda marcada de forma discreta con una explicación en el `title`, para que nunca se lea como una jornada que terminó normalmente.
- Sin sesiones todavía, la sección dice explícitamente qué hacer — nunca una tabla con encabezados y nada abajo.
- **Verificado extremo a extremo contra un preview server real** (login, apertura/cierre de 2 sesiones reales con llamadas inyectadas, PATCH de mood, GET de historial, y la función `_mypLoadSessions` REAL —extraída literal del archivo, no reescrita— ejecutada contra el servidor real): el HTML producido coincide exacto con lo esperado.

## Task Commits

Each task was committed atomically:

1. **Task 1: Sección "Sesiones de discado" en Mi rendimiento** - `bb2de71` (feat)
2. **Task 2: Suite de SES-03 en el frontend + cache-buster** - `2a5fd9e` (test)

**Plan metadata:** (este commit, docs)

_Nota: Task 2 tenía `tdd="true"` en el plan, pero su `<action>` es una sola tarea de creación de test contra código ya existente de Task 1 (mismo caso que 37-01/37-02/37-03: no hay forma sensata de producir un RED real sin reescribir el modelo dos veces). Se verificó por MUTACIÓN (2 rondas) en vez de un ciclo RED/GREEN/REFACTOR de commits separados — ver "Verificación por mutación" abajo._

## Files Created/Modified

- `public/app.js`:
  - Bloque `[37-03] SESSION-PURE` extendido: `SES_MOOD_LABELS` (mapa de 4 etiquetas, declarado 1 sola vez) + `_sesDayKey`/`_sesHistoryRows` (agrupación por día LOCAL, reloj siempre por parámetro), insertados antes del marcador `FIN` — todo entre `_sesClosingModel` y `window.__ses`.
  - `_pdRenderClosingScreen`: `moodOptions` pasa de un array literal escrito a mano a `Object.entries(SES_MOOD_LABELS)` — un solo mapa, dos consumidores.
  - `_mypLoad`: llama `_mypLoadSessions(effectiveSetter).catch(...)` junto a `_mypLoadPipeline`, mismo patrón de setter efectivo (reglas #135/#146 de CLAUDE.md).
  - `_mypLoadSessions(effectiveSetter)` (nueva, ~90 líneas, junto a `_mypLoadPipeline`): fetch a `GET /api/setters/dial-sessions?limit=20` vía `apiUrl(`, `?setter=` solo si `effectiveSetter` y rol admin/supervisor; estado vacío con texto guía; render de tabla con `_sesHistoryRows` + `escHtml` en todo campo del servidor; Marcadas en negrita, resto en tono secundario (D-01); marca "cerrada sola" con `title` explicativo (T-37-18); sesión abierta como "en curso…" sin números.
- `public/index.html`: sección `<div class="myp-section-label">Sesiones de discado</div>` + `<section id="myp-sessions">` insertada después de "Evolución" y antes de `#myp-empty`, dentro de `view-myperf`. Cache-buster `app.js?v=` `20260823b` → `20260823c`. `style.css?v=` sin tocar (`20260822a`).
- `tests/dial-session-myperf-ui.test.js` (nuevo, 42 tests — el plan pedía mínimo 12): puro `_sesHistoryRows` (agrupación Hoy/Ayer/fecha, orden descendente, mood '' nunca undefined, `closedBy` mapeado a `auto`, sesión abierta sin números, counters ausente en sesión cerrada → 0, ningún row de tipo 'dia' con contadores, cola con mode/hoyFilter/queueSize tal cual), cableado (`_mypLoadSessions` única y llamada con `effectiveSetter`, `apiUrl(`, `escHtml`, `SES_MOOD_LABELS` compartido, texto del estado vacío), estructura del HTML de `view-myperf`, cache-buster, y anti-regresión de lo que dejó 37-03.
- `tests/dial-session-close-ui.test.js` (1 assertion editada, ver Deviations).

## Decisions Made

Ver `key-decisions` en el frontmatter — resumen: `SES_MOOD_LABELS` vive dentro del bloque puro existente (no una superficie nueva); `window.__ses` se dejó intacto a propósito (hay un test pineado a su literal exacto, y no hace falta extenderlo porque `_mypLoadSessions` comparte closure con el bloque puro); agrupación por día LOCAL; el filtro de ruido de 37-02 se respeta sin pedir `all=1`; ninguna agregación por día.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/dial-session-close-ui.test.js` pineaba el array literal de `moodOptions` que la propia Task 1 de este plan reemplaza a propósito**

- **Found during:** Task 1 (al mover las etiquetas a `SES_MOOD_LABELS` y correr la suite vecina antes de dar la Task por cerrada, tal como pide el plan).
- **Issue:** `tests/dial-session-close-ui.test.js` (37-03, pre-existente, fuera de `files_modified` de este plan) tenía `expect(appJs).toContain("[['bien', 'Bien'], ['normal', 'Normal'], ['costo', 'Me costó'], ['pesimo', 'Pésima']]")` — el literal exacto del array que `_pdRenderClosingScreen` tenía escrito a mano. El propio texto del plan (Task 1, punto 2) pide reemplazar ese array por el consumo de `SES_MOOD_LABELS`, invalidando a propósito ese literal.
- **Fix:** Se actualizó la ÚNICA assertion afectada para verificar el invariante real que protege (los 4 moods siguen apareciendo como `data-mood` en el HTML de cierre) contra la forma nueva: `const SES_MOOD_LABELS = { bien: 'Bien', normal: 'Normal', costo: 'Me costó', pesimo: 'Pésima' };` + `const moodOptions = Object.entries(SES_MOOD_LABELS);`. El comportamiento funcional no cambió — los 4 chips siguen mostrando exactamente el mismo texto.
- **Files modified:** `tests/dial-session-close-ui.test.js` (1 test, sin agregar ni quitar tests — sigue en 56).
- **Verification:** `npx vitest run tests/dial-session-close-ui.test.js` → 56/56 verde.
- **Committed in:** `2a5fd9e` (Task 2 commit, junto a la suite nueva — mismo patrón que la deviation de `dial-sync.test.js` en 37-03).

**2. [Rule 1 - Bug] `document` como substring de la palabra "documenta" tumbaba el propio check de pureza del bloque**

- **Found during:** verificación de acceptance criteria de Task 1, ANTES de correr ningún test (auto-detectado corriendo el regex de aceptación del propio plan como paso intermedio).
- **Issue:** Un comentario propio dentro de `[37-03] SESSION-PURE` decía "37-02 **documenta** por qué" — la palabra española "documenta" contiene el substring literal `document`, que el regex de pureza (`/document|localStorage|fetch\(|Date\.now\(|window\./`) matchea sin distinguir código de prosa (mismo tipo de gotcha que 37-03 documentó con `"Procesaste "` dentro de un comentario).
- **Fix:** Reescrito a "37-02 **explica** el motivo" — mismo significado, sin el substring prohibido.
- **Files modified:** `public/app.js` (1 comentario, mismo commit `bb2de71`, no un commit aparte porque se corrigió antes de cualquier commit).
- **Verification:** script `node -e` que evalúa el mismo regex del test sobre el bloque extraído → `false` (sin match) antes de commitear.

---

**Total deviations:** 2 auto-fixed (Rule 1 — 1 assertion desactualizada por un cambio de forma que el propio plan pidió; 1 auto-corrección de prosa antes de cualquier commit).
**Impact on plan:** El único ajuste fuera de `files_modified` fue de 1 línea, en un archivo de pruebas, para reflejar el cambio de forma que el plan pidió literalmente (mismo patrón que 37-03 con `dial-sync.test.js`). Cero cambio de comportamiento, cero scope creep.

## Verificación por mutación

Mismo patrón de rigor que 37-01/37-02/37-03 (Task 2 sin RED real posible porque implementa contra código ya existente de Task 1):

1. Se rompió el guard de agrupación por día (`if (dayKey !== lastDayKey)` → `if (true)`) → cayeron exactamente los 2 tests que verifican que sesiones del mismo día comparten un único encabezado ("2 sesiones abiertas + cerradas mezcladas el mismo día siguen bajo 1 solo encabezado" y el de la lista mixta). Ningún otro test se vio afectado. Restaurado con `git checkout -- public/app.js`, diff vacío confirmado.
2. Se desnudó el `escHtml(` de `row.cola.hoyFilter` en el render → cayó exactamente 1 test ("el mode/hoyFilter... se pinta con escHtml, no interpolado crudo"). Restaurado, diff vacío confirmado.

Ambas mutaciones confirmaron que la suite atrapa regresiones reales en los 2 puntos del threat model del plan que más importaban (agrupación sin duplicar encabezados, y T-37-16 escHtml sobre campos persistidos).

## Verificación en preview (datos reales, no solo tests de fuente)

A diferencia de 37-03 (que documentó explícitamente no tener herramienta de navegador disponible), esta sesión sí tuvo acceso a Bash con un preview server corriendo en `:3000` (`.claude/launch.json`, `DATA_DIR=tmp/preview-data`). Se aprovechó al máximo:

1. **El proceso preview encontrado al arrancar estaba corriendo código de las 04:00 del mismo día** — anterior a TODOS los commits de la Fase 37 (probado con `Cannot POST /api/setters/dial-sessions` al primer intento). Se reemplazó por un proceso fresco (`node index.js` con el mismo `DATA_DIR`), sin tocar nada del repo — `tmp/preview-data/` está gitignoreado (`git check-ignore` confirmado).
2. **Password de admin reseteada localmente** en `tmp/preview-data/auth.json` (nota #15 de CLAUDE.md: nunca tocar `./data/auth.json`; acá es exclusivamente el volumen de preview) para poder loguear con cookie real.
3. **Ciclo de vida real, 2 sesiones**, simulando exactamente el punto 4 de `<verification>` del plan:
   - Sesión A abierta con `mode:'calls'` (equivalente a "desde Llamadas"), con una llamada real inyectada en el `callLog` de un lead de `setter_ignacio` (`outcome:'answered_interested', duration:45`) para que los contadores no dieran cero, cerrada, y con `PATCH mood:'bien'` (responder el estado).
   - Sesión B abierta con `mode:'hoy', hoyFilter:'callbacks'` (equivalente a "desde una sección de Hoy"), con otra llamada real inyectada (`outcome:'callback_later', duration:38`), cerrada, **sin** PATCH de mood (saltear el estado, D-03).
   - Una tercera sesión de control (0 marcadas, 6s) se dejó sin llamadas — confirmó en vivo que el filtro de ruido de 37-02 la esconde del listado por defecto (no aparece en el `GET`, `total:2` en vez de `3`).
4. **La función `_mypLoadSessions` REAL** —extraída literal del `public/app.js` commiteado, no una reimplementación— se ejecutó en Node contra el servidor real (con `document.getElementById`, `fetch` y `apiUrl` stubbeados al mínimo indispensable: `fetch` real hacia `localhost:3000` con la cookie de sesión real adjuntada). El `innerHTML` resultante:
   - Un solo encabezado "Hoy" agrupando las 2 sesiones.
   - La más reciente (Sesión B) primero — orden descendente confirmado con datos reales, no simulados.
   - Sesión B: Marcadas=1 (negrita), Atendieron=1, Conversaciones=1, "Cómo la remó" = **"—"** (guion discreto, mood salteado), Cola = "Hoy · callbacks · 8".
   - Sesión A: Marcadas=1 (negrita), Atendieron=1, Conversaciones=1, "Cómo la remó" = **"Bien"**, Cola = "Llamadas · 40".
5. **Modo "Ver como SDR"**: se ejecutó `_mypLoadSessions('setter_paula_kroff')` (Paula, sin sesiones) con `role:'admin'` — la URL pedida incluyó `?setter=setter_paula_kroff` y el render mostró el estado vacío completo (texto guía), confirmando el must-have "En modo Ver como SDR... la tabla muestra las sesiones de ESE vendedor, no las del que está logueado".
6. Se confirmó además que con `role:'setter'` simulado en `window.__CURRENT_USER__`, la URL pedida NUNCA incluye `?setter=` (mismo criterio que `_mypLoadPipeline`).

Los 3 scripts de verificación quedaron en el directorio de scratchpad de esta sesión (fuera del repo, no versionados): `render-check-37-04.mjs`, `render-check-viewas-37-04.mjs`, `render-check-setterrole-37-04.mjs`.

**El preview server quedó corriendo** (proceso fresco sobre `tmp/preview-data`, sirviendo el `app.js?v=20260823c` actual) por si el user o una sesión siguiente quiere seguir verificando visualmente.

## Verificación final

- `node --check public/app.js` → exit 0 (corrido después de cada edit).
- `npx vitest run tests/dial-session-myperf-ui.test.js` → **42/42 verdes** (aislado; el plan pedía mínimo 12).
- `npx vitest run tests/dial-session-myperf-ui.test.js tests/dial-session-close-ui.test.js` → **98/98 verdes**.
- `npx vitest run tests/dial-session-myperf-ui.test.js tests/dial-session-close-ui.test.js tests/dial-session-history.test.js tests/dial-session-model.test.js tests/metrics-consistency.test.js` → **160/160 verdes** (los 5 archivos relacionados a `dialSessions`/CALL METRICS CORE, ninguno editado salvo el ya documentado).
- `npm test` completo (`npx vitest run`), 2 corridas independientes: **124/124 archivos, 2274/2274 tests, 0 fallos** ambas veces (baseline pre-plan real de 37-03: 123/2232, también 0 fallos).
- `git diff --stat package.json package-lock.json` → vacío (no se instaló nada).
- `git diff --stat public/style.css` → vacío (no se tocó).
- Greps de aceptación de la Task 1 (todos verificados, valor esperado):
  - `grep -c "myp-sessions" public/index.html` → 1.
  - `grep -c "_mypLoadSessions" public/app.js` → 4 (definición + llamada + 2 comentarios, `>=2` pedido).
  - La llamada dentro de `_mypLoad` pasa `effectiveSetter` y tiene `.catch(` — confirmado.
  - El fetch de `_mypLoadSessions` usa `apiUrl(` — confirmado, sin `fetch('/api/...')` crudo.
  - `SES_MOOD_LABELS` se declara exactamente 1 vez (`grep -c "const SES_MOOD_LABELS = {"` → 1), dentro del rango de marcadores `[37-03] SESSION-PURE`; las 4 etiquetas con acentos ("Me costó", "Pésima") NO aparecen escritas a mano en ningún otro lado del archivo.
  - `git diff public/style.css` vacío.
  - `app.js?v=` en `index.html` → forma válida, `20260823c` > `20260823b` (baseline real), aparece 1 sola vez.
  - `git diff --stat package.json package-lock.json` vacío.

## Estado final de los 5 criterios SES-01..SES-05 de la Fase 37

| Requirement | Estado | Respaldo |
|---|---|---|
| **SES-01** — Entidad `dialSession` persistida (inicio, fin, quién, modo, filtro, cola, contadores) | ✅ Cerrado | `.planning/phases/37-ses-sesion-discado/37-01-SUMMARY.md` — `data.dialSessions` dentro de `setters.json`, `tests/dial-session-model.test.js` |
| **SES-02** — Siempre hay pantalla de cierre, no solo al vaciar la cola | ✅ Cerrado | `37-03-SUMMARY.md` — `_pdShowClosing` único renderizador, 3 caminos de salida convergen ahí, `tests/dial-session-close-ui.test.js` |
| **SES-03** — Existe historial de sesiones (hoy contra ayer) | ✅ Cerrado de punta a punta | Backend en `37-02-SUMMARY.md` (`GET /api/setters/dial-sessions`); **UI en este plan** (`_mypLoadSessions`/`_sesHistoryRows`, `tests/dial-session-myperf-ui.test.js`, verificado en preview real) |
| **SES-04** — Una sola pregunta sobre el estado del que marcó, opcional, nunca por llamada | ✅ Cerrado de punta a punta | Backend + chips en `37-02-SUMMARY.md`/`37-03-SUMMARY.md`; **lectura en este plan** (columna "Cómo la remó", `SES_MOOD_LABELS` compartido) — deja de ser write-only |
| **SES-05** — Contadores derivan del CALL METRICS CORE, no se re-implementan inline | ✅ Cerrado | `37-01-SUMMARY.md` — `_dialSessionCounters` es el único lugar que calcula números de sesión; `tests/metrics-consistency.test.js` sin editar en NINGÚN plan de la fase (18/18 verde en todas las corridas) |

**Fase 37 (SES) COMPLETA — 4/4 planes.** REQUIREMENTS.md tiene los 5 checkboxes en `[x]`, con referencia cruzada a los 4 SUMMARYs donde corresponde.

## Qué queda (fuera de alcance de este plan)

- El cierre formal del milestone v4.0 en `STATE.md` (campo `status`) sigue siendo tarea del orquestador — este executor solo actualizó las métricas de progreso (`completed_phases`/`completed_plans`/`percent`) y el texto narrativo de la posición actual, sin declarar el milestone "complete" a nivel de frontmatter.
- El preview server quedó corriendo (proceso fresco, `tmp/preview-data`) para que una sesión siguiente pueda seguir verificando sin tener que reiniciarlo.

## Self-Check

- `public/app.js`: FOUND (modificado, `node --check` OK)
- `public/index.html`: FOUND (modificado, cache-buster bumpeado a `20260823c`)
- `tests/dial-session-myperf-ui.test.js`: FOUND (creado, 42 tests, todos verdes)
- `tests/dial-session-close-ui.test.js`: FOUND (modificado, 56/56 verdes)
- Commit `bb2de71`: FOUND en `git log`
- Commit `2a5fd9e`: FOUND en `git log`

## Self-Check: PASSED

---
*Phase: 37-ses-sesion-discado*
*Completed: 2026-08-23*
