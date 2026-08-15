---
phase: 31-comm-compromisos
plan: 03
subsystem: ui
tags: [frontend, vanilla-js, html, commitment-model, gate, next-action]

# Dependency graph
requires:
  - phase: 31-comm-compromisos (plan 01)
    provides: "lead.commitment, COMMITMENT_TIPOS/PARTES/ESTADOS/CIERRES/LABELS/DEFAULT_PARTE/DEFAULT_CANAL/SOCIO_DELTA_MS/ENVIAR_INFO_DELTA_MS, _commitmentEffectiveEstado"
  - phase: 31-comm-compromisos (plan 02)
    provides: "POST call-disposition acepta body.commitment; PATCH /api/setters/leads/:id/commitment (crear/reemplazar/cerrar), respuesta {ok, commitment, nextAction, lead}"
  - phase: 30-gate-proximo-paso
    provides: "#call-next-modal, openNextStepModal, _dtPickerAttach/_dtPickerSync, [30-03] DISPO-DEST (_dispoDestination/_dispoAfterSaved/_dispoAnnounce)"
provides:
  - "Bloque puro [31-03] COMMITMENT-PURE en public/app.js: COMMITMENT_UI_TIPOS, COMMITMENT_DELTAS_MS, _commitmentLabel, _commitmentDefaultParte, _commitmentDefaultCanal, _commitmentDefaultDate, _commitmentEffectiveEstado"
  - "Selector de compromiso + toggle de parte dentro de #call-next-modal (D-08) — openNextStepModal manda body.commitment cuando el user elige un tipo"
  - "Bloque 'Compromiso' en _callsRenderExpandedPanel (ficha del lead, D-09): tarjeta pendiente/vencido con 2 botones de cierre + Cambiar, línea compacta si está cerrado, formulario de carga si no hay compromiso"
  - "window._callsSetCommitment / window._callsCloseCommitment: PATCH .../commitment + _leadStoreApply + _refreshLeadPanels"
  - "Rama nueva en _dispoDestination (bloque [30-03] DISPO-DEST): compromiso pendiente → 'Hoy → Mis compromisos' | 'Hoy → Esperando del prospecto', antes de la rama de interesado"
  - "tests/commitment-ui.test.js: 46 tests (bloque puro, paridad frontend/backend, markup, cableado, escHtml)"
affects: [31-04-consulta]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bloque puro con marcadores [31-03] COMMITMENT-PURE, mismo formato que [30-02] GATE-PURE / [28-01] DTPICKER-PURE — extraíble por tests con new Function, sin DOM/red/localStorage"
    - "Paridad frontend/backend verificada leyendo los 2 archivos como texto (COMMITMENT_UI_TIPOS vs COMMITMENT_DEFAULT_PARTE/CANAL/SOCIO_DELTA_MS de index.js), no solo duplicando los valores a ojo"
    - "Formulario reusado (_commitFormHtml) entre los 3 estados de render del bloque Compromiso: oculto con 'Cambiar' cuando hay uno vigente, siempre visible cuando está cerrado o no existe"

key-files:
  created:
    - tests/commitment-ui.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "Cache-buster: el plan asumía baseline app.js?v=20260815d, pero al arrancar la ejecución el baseline REAL ya era 20260815e (una sesión paralela de branding lo había bumpeado antes de que este plan empezara). Se bumpeó a 20260815f en vez de 20260815e. style.css se dejó intacto (no lo tocó este plan)."
  - "El botón 'Cambiar' del estado pendiente/vencido reusa el MISMO formulario de carga (punto 3 del plan) oculto por defecto, en vez de un formulario propio — evita duplicar el markup de 3 controles + hint."
  - "El <select> de tipo del formulario de la ficha se genera con COMMITMENT_UI_TIPOS.map() (JS, no HTML literal) porque no es un markup testeado por grep de fuente estática como el del modal — reduce duplicación de las 6 opciones."
  - "c.motivo pasa por escHtml también en la condición ternaria (no solo en el contenido interpolado) — ajuste hecho durante Task 3 al escribir la aserción T-31-04, así TODA ocurrencia de '.motivo' en el bloque nuevo queda literalmente precedida por escHtml("

patterns-established:
  - "Todo helper puro de fecha/mapeo nuevo va en un bloque marcado [NN-NN] NOMBRE-PURE, autocontenido, insertado junto al bloque puro más reciente del mismo archivo — patrón ya usado por 4 fases consecutivas (28/29/30/31)."
  - "Los tests que comparan el cache-buster de un archivo NO tocado por el plan usan una comparación de forma (regex), no un valor exacto pineado — un valor exacto se rompe con cualquier edición legítima y ajena futura de ese archivo (lección de esta misma sesión, ver Issues Encountered)."

requirements-completed: [COMM-01, COMM-03]

# Metrics
duration: ~40min
completed: 2026-08-15
---

# Phase 31 Plan 03: Carga UI del compromiso hablado Summary

**Selector de compromiso dentro del modal "Próximo paso" (repropone la fecha del mapa D-06 al elegir tipo) + bloque "Compromiso" editable en la ficha del lead, con el aviso de destino nombrando `Hoy → Mis compromisos` / `Hoy → Esperando del prospecto` — 46 tests nuevos, suite completa 1470/1470.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 3 (`public/app.js`, `public/index.html`, `tests/commitment-ui.test.js` nuevo)

## Accomplishments

- Bloque puro `[31-03] COMMITMENT-PURE` en `public/app.js`: `COMMITMENT_UI_TIPOS` (6 tipos con label/parte/canal, orden fijo), `COMMITMENT_DELTAS_MS` (espejo del mapa D-06 del backend), `_commitmentLabel`, `_commitmentDefaultParte`, `_commitmentDefaultCanal`, `_commitmentDefaultDate` (fin del día local para `enviar_info`, delta para el resto), `_commitmentEffectiveEstado` (misma regla que el backend, no muta).
- `#call-next-modal` gana el selector `<select id="call-next-commitment-tipo">` (7 opciones: vacía + los 6 tipos, literales en el HTML) + `<div id="call-next-commitment-parte">` con los 2 botones de parte. Elegir un tipo repropone `fechaInput.value` con `_commitmentDefaultDate` + `_dtPickerSync`, muestra el bloque de parte y preselecciona el default; volver a "Sin compromiso" restaura la propuesta base de la Phase 30. El body de `openNextStepModal` manda `commitment: {tipo, parte, canal, motivo, dueAt}` (mismo `dueAtIso` que `nextAction`) solo si se eligió un tipo.
- Bloque "Compromiso" en `_callsRenderExpandedPanel` (ficha del lead, ANTES de "Follow-up programado"): tarjeta con tipo/parte/canal/fecha cuando está pendiente/vencido (borde y fecha en `var(--warning)` si venció) + botones "Cumplido" / "No cumplió" (parte prospecto) o "Ya no aplica" (parte propia) / "Cambiar"; línea compacta cuando está cerrado; formulario de carga (select tipo + select parte + input motivo + hint de fecha propuesta) cuando no hay compromiso. Chip en la cabecera de la ficha (`_expChips`) con fondo sólido `var(--warning)` + `var(--on-accent)` si venció, o `var(--accent-soft)`/`var(--accent-strong)` si está pendiente.
- `window._callsSetCommitment` / `window._callsCloseCommitment`: `PATCH /api/setters/leads/:id/commitment`, `_leadStoreApply(leadId, d.lead)` con el lead completo (regla #105), `_refreshLeadPanels(leadId)` SIEMPRE vía `finally` (nota #175) — incluso en el camino de error de negocio (409 de lead terminal o "no había compromiso pendiente"). Ninguno de los dos llama al aviso universal de destino de una disposición (no tocan el gate de la Phase 20).
- `_dispoDestination` (bloque `[30-03] DISPO-DEST`) gana una rama nueva entre "agendado" e "interesado": un `lead.commitment` pendiente manda sobre el estado interesado y anuncia `Hoy → Mis compromisos` (parte `yo`) o `Hoy → Esperando del prospecto` (parte `prospecto`), con la fecha relativa vía `_dispoNextAt`/`_dispoWhenLabel` ya existentes. La rama solo usa literales y campos del `lead` (restricción dura del plan: el `new Function` de `tests/gate-destination.test.js` no tiene en scope nada fuera de los marcadores DISPO-DEST).
- `tests/commitment-ui.test.js` (46 tests): bloque puro con reloj fijo, paridad frontend/backend (los 6 `key` de `COMMITMENT_UI_TIPOS` dentro del bloque COMPROMISOS de `index.js`; defaults de parte/canal comparados por extracción de objeto literal vía regex de `COMMITMENT_DEFAULT_PARTE`/`COMMITMENT_DEFAULT_CANAL`; el valor de 5 días idéntico a `COMMITMENT_SOCIO_DELTA_MS`), markup del modal, cableado de `openNextStepModal` y de los 2 handlers de la ficha, precedencia de la rama de compromiso en DISPO-DEST, y escHtml de todo lo interpolado en el bloque nuevo.
- Verificación por mutación (Task 3, pedida explícitamente por el plan): se rompió temporalmente el `onchange` del selector para que no llamara `_commitmentDefaultDate` → **1/46 tests en rojo** (exactamente el que prueba esa referencia), restaurado exacto (`git diff` limpio, `grep -n "MUTATION" public/app.js` → 0).
- Suite completa del repo: **1470/1470** (baseline 31-02: 1424 + 46 nuevos).

## Task Commits

Each task was committed atomically:

1. **Task 1: Bloque puro, selector de compromiso en el modal "Próximo paso" y rama de destino** - `db68f48` (feat)
2. **Task 2: Bloque "Compromiso" en la ficha del lead (D-09 frontend)** - `d184f93` (feat)
3. **Task 3: Tests del bloque puro y del cableado del frontend** - `c10dba4` (test) + `613256f` (fix, hardening del test de cache-buster contra interferencia ajena — ver Issues Encountered)

## Files Created/Modified

- `public/app.js` — bloque `[31-03] COMMITMENT-PURE` (después de `[30-02] GATE-PURE`), wiring en `openNextStepModal` (reset del select + parte al abrir, `onchange`, click de parte, `commitment` en el body del POST), rama nueva en `_dispoDestination`, chip de compromiso en `_expChips`, bloque "Compromiso" completo en `_callsRenderExpandedPanel` (tarjeta/línea/formulario + `_commitFormHtml`), `window._callsSetCommitment`, `window._callsCloseCommitment`, `window._callCommitToggleForm`, `window._callCommitHintUpdate`.
- `public/index.html` — markup de `#call-next-commitment-tipo` (7 `<option>` literales) y `#call-next-commitment-parte` (2 botones `data-parte`) dentro de `#call-next-modal`; `<p>` explicativo actualizado; cache-buster de `app.js` bumpeado a `v=20260815f`.
- `tests/commitment-ui.test.js` (nuevo) — 46 tests sobre el bloque puro, paridad frontend/backend, markup y cableado.

## Decisions Made

- **Cache-buster real distinto del asumido por el plan**: el plan documentaba `app.js?v=20260815d` como baseline y pedía bumpear a `20260815e`. Al arrancar la ejecución, `public/index.html` ya tenía `app.js?v=20260815e` y `style.css?v=20260815e` (una sesión paralela de branding — commits `1e71d0f`/`a5a54b2`/`bfe228a`, ya en `main` antes de que este plan empezara — los había bumpeado). Se bumpeó `app.js` a `20260815f` en vez de `20260815e` para no reusar un valor ya consumido. `style.css` se dejó exactamente como estaba (esta fase no lo toca).
- **`_commitFormHtml` reusado entre los 3 estados de render**: en vez de escribir el formulario de carga 2 veces (uno para "sin compromiso"/"cerrado" siempre visible, otro para "Cambiar" oculto), es una única función que recibe `visible` y arma el mismo markup con `display:none` o sin él.
- **El `<select>` de tipo de la ficha se genera con `.map()` sobre `COMMITMENT_UI_TIPOS`**, a diferencia del `<select>` del modal (`public/index.html`), que el plan pedía literal en HTML para que el test lo verificara como fuente estática. El de la ficha es JS puro (parte del template de `_callsRenderExpandedPanel`), así que generarlo dinámicamente evita duplicar las 6 opciones sin perder testabilidad (el test verifica el markup RENDERIZADO indirectamente vía las aserciones de `COMMITMENT_UI_TIPOS`, no un grep de HTML estático).
- **`escHtml(c.motivo)` también en la condición ternaria**: al escribir la aserción T-31-04 ("toda ocurrencia de `.motivo` está precedida por `escHtml(`"), la condición `c.motivo ? ... : ''` no calificaba (compara el valor crudo, no interpola nada, pero rompía la regla literal del plan). Se cambió a `escHtml(c.motivo) ? ... : ''` — `escHtml` no cambia la truthiness de un string no vacío, así que el comportamiento es idéntico y ahora las 2 ocurrencias de `.motivo` en el bloque están uniformemente envueltas.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `c.motivo` sin escHtml en la condición ternaria del bloque Compromiso**
- **Found during:** Task 3 (al escribir la aserción T-31-04 de la suite)
- **Issue:** El código de Task 2 interpolaba `c.motivo` escapado con `escHtml` dentro del `<div>`, pero la CONDICIÓN del ternario (`c.motivo ? ... : ''`) leía el valor crudo sin envolver — no era una fuga de XSS real (la condición no se renderiza), pero violaba la regla defensiva del plan ("todo dato del lead que se interpola... pasa por escHtml") en su forma literal y dejaba una inconsistencia de estilo respecto del resto del bloque.
- **Fix:** `${c.motivo ? ... : ''}` → `${escHtml(c.motivo) ? ... : ''}`.
- **Files modified:** `public/app.js`
- **Commit:** `c10dba4` (incluido en el commit de Task 3, junto con la suite que lo destapó)

**2. [Rule 3 - Blocking] Test de cache-buster de `style.css` roto por una sesión paralela editando el mismo working tree**
- **Found during:** Task 3, después de correr `npm test` por primera vez con la suite completa verde
- **Issue:** El test original pineaba `style.css?v=` a un valor exacto (`20260815e`, el baseline con el que arrancó este plan). Mientras la ejecución seguía en curso, una sesión paralela del user (Ignacio, mismo repo, mismo directorio) editó y luego commiteó `public/style.css`/`public/index.html` por un motivo ajeno a esta fase (fix de z-index del calendario propio, commit `948ae34`, bump a `v=20260815f`) — el test empezó a fallar contra el disco real, no por una regresión de este plan.
- **Fix:** se reemplazó el pin exacto por un chequeo de forma (regex de 9 caracteres), documentando en el propio test por qué un valor exacto es frágil ante cualquier edición legítima y ajena futura de `style.css`. La garantía real de "esta fase no tocó `style.css`" ya la habían verificado los `git diff --name-only` explícitos de las Tasks 1 y 2.
- **Files modified:** `tests/commitment-ui.test.js`
- **Commit:** `613256f`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking — ambas sin impacto en el comportamiento del feature).
**Impact on plan:** Ninguna es scope creep; las dos fueron destapadas por el propio proceso de escribir/correr la suite del plan.

## Issues Encountered

- **Interferencia de una sesión paralela en el MISMO working tree (no un worktree separado)**: durante la ejecución de Task 3, el user (Ignacio) estuvo editando y commiteando en vivo sobre el mismo checkout (`public/style.css`, `public/index.html` — fix de z-index del calendario propio, commit `948ae34`, ajeno a esta fase). Esto ya está documentado como patrón recurrente en `CLAUDE.md` (`[[user-commits-in-parallel]]`) y en `31-02-SUMMARY.md`. Se verificó en cada paso que el `git diff`/`git status` de MIS archivos (`public/app.js`, `tests/commitment-ui.test.js`) nunca se mezcló con los suyos antes de cada `git add`/`git commit` — nunca se hizo `git add -A` ni se tocó ningún archivo ajeno.
- **`tests/repair-phones.test.js` falló una vez por timeout de hook (20s) durante la corrida completa de `npm test`** — no relacionado con este plan (no toca ese archivo ni sus dependencias). Re-corrido en aislado: **15/15 verde**. Ambiental (probablemente contención de recursos por la corrida simultánea de la suite completa + la sesión paralela del user en el mismo disco/CPU), consistente con la nota #130/#160 de CLAUDE.md sobre flakiness de Windows + I/O.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Para **31-04** (D-10/D-11, sección "Compromisos" dentro de Hoy + historial en el timeline):

- **Nombres LITERALES de las 2 secciones de Hoy, fijados por este plan** — 31-04 los tiene que usar IDÉNTICOS o el aviso de destino va a mentir:
  - `parte 'yo'` → **"Mis compromisos"**
  - `parte 'prospecto'` → **"Esperando del prospecto"**
- **Superficie exportable del bloque `[31-03] COMMITMENT-PURE`** (`public/app.js`, marcadores en las líneas `// ─── [31-03] COMMITMENT-PURE: INICIO ───` / `// ─── [31-03] COMMITMENT-PURE: FIN ───`, inmediatamente después del cierre de `[30-02] GATE-PURE`):
  `COMMITMENT_UI_TIPOS` (array `{key,label,parte,canal}`), `COMMITMENT_DELTAS_MS`, `_commitmentLabel(tipo)`, `_commitmentDefaultParte(tipo)`, `_commitmentDefaultCanal(tipo)`, `_commitmentDefaultDate(tipo, now)`, `_commitmentEffectiveEstado(c, nowMs)`. 31-04 puede extraer este mismo bloque para su propia suite (mismo patrón `new Function`) o simplemente reusar `_commitmentLabel`/`_commitmentEffectiveEstado` en tiempo de ejecución (ya están en el scope global de `app.js`, no hace falta re-declararlos).
- **Cache-buster que dejó este plan**: `app.js?v=20260815f`. **31-04 tiene que bumpearlo de nuevo** (siguiente letra disponible — verificar el valor real en `public/index.html` antes de asumir cuál es, dado el patrón de interferencia de esta sesión). `style.css?v=` sigue sin tocar por esta fase (su valor en disco puede haber cambiado por trabajo ajeno — no es responsabilidad de 31-04 a menos que agregue CSS propio).
- **`lead.commitment` ya viaja completo en cada lead** vía `GET /leads/sin-wsp` (lo confirma `31-02-SUMMARY.md`) — 31-04 puede derivar la sección "Compromisos" de Hoy client-side sobre el mismo array que `loadHoyView` ya trae, sin necesitar ningún endpoint nuevo.
- **Qué quedó SIN verificar en vivo** (no hay browser en el entorno — checklist de preview/producción):
  1. Abrir el modal "Próximo paso" (marcar Interesado en una llamada), elegir cada uno de los 6 tipos de compromiso en el selector y confirmar visualmente que la fecha propuesta cambia y que el bloque "¿Quién se comprometió?" aparece con el botón correcto preseleccionado.
  2. Confirmar que volver a "Sin compromiso específico" restaura la fecha/atajos originales de la Phase 30.
  3. Guardar un compromiso con un motivo y confirmar en la respuesta/toast que la fecha coincide con la elegida en el calendario (no con el mapa D-06 recalculado).
  4. Desde la ficha de un lead SIN compromiso (Hoy → ficha o panel expandido de Llamadas), cargar uno con el formulario compacto y confirmar el toast + que el chip aparece en la cabecera sin recargar.
  5. Cerrar un compromiso pendiente con "Cumplido" y con "No cumplió"/"Ya no aplica" (según la parte) y confirmar que la tarjeta pasa a la línea compacta y que el formulario para cargar el siguiente queda visible.
  6. Verificar que el toast de destino (al marcar Interesado con un compromiso cargado) dice "Hoy → Mis compromisos" o "Hoy → Esperando del prospecto" según corresponda, en vez de "Hoy → Interesados".
  7. Confirmar que un compromiso vencido (fecha pasada) muestra el chip/borde en color de advertencia y el texto "vencido" en la ficha.
- Sin bloqueantes de código para 31-04.

---
*Phase: 31-comm-compromisos*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: `tests/commitment-ui.test.js`
- FOUND: `.planning/phases/31-comm-compromisos/31-03-SUMMARY.md`
- FOUND commit `db68f48` (Task 1)
- FOUND commit `d184f93` (Task 2)
- FOUND commit `c10dba4` (Task 3)
- FOUND commit `613256f` (Task 3 hardening fix)
