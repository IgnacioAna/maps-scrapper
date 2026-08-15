---
phase: 30-gate-proximo-paso
plan: 03
subsystem: ui
tags: [call-disposition, next-action, gate, frontend, power-dialer, toast]

# Dependency graph
requires:
  - phase: 30-gate-proximo-paso (plan 01)
    provides: "defaults D-02 en _applyCallOutcome, override sanitizado de nextAction sobre POST /call-disposition, esperar_respuesta +48h en send-placeholder"
  - phase: 30-gate-proximo-paso (plan 02)
    provides: "modal #call-next-modal (Próximo paso) + openNextStepModal + ruteo de answered_interested, sobre el que este plan cablea el aviso de destino"
provides:
  - "_dispoDestination(lead, now) puro dentro del bloque [30-03] DISPO-DEST: único cálculo de destino, 8 ramas con precedencia DNC → descartado → agendado → interesado → callback_later manual → cadencia/otro con fecha futura → sin fecha"
  - "_dispoAnnounce(leadId, opts) reemplaza a _dispoWhereToast: toast fuera del Power Dialer, _pd.holdMeta dentro (D-07)"
  - "_dispoAfterSaved(leadId, opts) como punto único post-guardado que anuncia el destino desde los 7 caminos de disposición (D-05)"
  - "destino integrado en el banner '✓ Resultado guardado' del Power Dialer, escapado con escHtml (T-30-08)"
affects: ["31 (compromisos hablados) — cualquier disposición nueva que agreguen debe pasar por _dispoAfterSaved para heredar el aviso universal"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bloque puro [30-03] DISPO-DEST (mismo formato de marcadores que [28-01] DTPICKER-PURE / [30-02] GATE-PURE) para el cálculo de destino, extraíble por tests con new Function"
    - "opts.manual como escape hatch: cuando el caller SABE el outcome pero el cache optimista aún no tiene el callLog fresco, se sintetiza un callLog local de un solo entry en vez de mutar el lead real"

key-files:
  created:
    - tests/gate-destination.test.js
  modified:
    - public/app.js
    - public/index.html

key-decisions:
  - "El hold de calendario (openPlaceholderModal) llama SOLO _dispoAnnounce, nunca _dispoAfterSaved: mandar un hold no marca el resultado de la llamada (D-08), y _dispoAfterSaved libera el gate de disposición obligatoria de la Phase 20 — hacerlo ahí falsearía que la llamada quedó marcada"
  - "El branch 'cualquier otro con fecha futura' cubre TANTO la cadencia automática COMO el hold de calendario (nextAction.tipo:'esperar_respuesta') con el mismo vista genérico ('a la cola de Llamadas'), pero el texto se adapta ('queda esperando respuesta' vs 'sale de la cola') para no mentir sobre qué está pasando — sin abrir una rama de vista nueva que el plan no pedía"
  - "DNC gana sobre descartado en la precedencia (ya documentado en el plan) — el texto de DNC dice explícitamente 'no vuelve a sonar en ninguna cola', más fuerte que el descarte reversible"
  - "El destino en el banner del Power Dialer NO reusa dest.texto tal cual (evita fragilidad de negrita a mitad de oración): arma su propia línea corta a partir de vista/cuando por separado, cada uno escapado con escHtml"

patterns-established:
  - "Cualquier disposición nueva que se agregue en el futuro DEBE pasar por _dispoAfterSaved(leadId, { lead, outcome }) para heredar el aviso de destino automáticamente — nunca llamar showToast a mano para 'a dónde se fue el lead'"

requirements-completed: [GATE-04]

# Metrics
duration: ~40min
completed: 2026-08-15
---

# Phase 30 Plan 03: GATE-04 — aviso universal de destino Summary

**Toda disposición de llamada ahora dice explícitamente a dónde se fue el lead y cuándo vuelve — vista real (Hoy → Callbacks / Hoy → Interesados / Descartados / Reuniones agendadas / cola de Llamadas / No-llamar), no un mensaje genérico — cerrando el reclamo #1 del user ("lo marco y desaparece").**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-15
- **Tasks:** 3/3
- **Files modified:** 3 (1 creado, 2 modificados)

## Accomplishments

- `_dispoDestination(lead, now)` puro: único cálculo de destino en toda la app, 8 ramas con precedencia fija DNC → descartado → agendado → interesado → callback_later manual → cadencia/otro con fecha futura → sin fecha. Evaluable aislado con `new Function` (sin DOM, red ni localStorage).
- `_dispoAnnounce(leadId, opts)` reemplaza por completo a `_dispoWhereToast` (0 ocurrencias restantes): fuera del Power Dialer tira el toast; dentro, guarda el destino en `_pd.holdMeta` sin interrumpir el flujo (D-07).
- `_dispoAfterSaved(leadId, opts)` es ahora el ÚNICO punto post-guardado que anuncia el destino — los 7 caminos de disposición (lista de Llamadas directa, modal callback, modal objeción, modal agenda + su fallback, auto-marca de no atendió, modal "Próximo paso") pasan `{ lead: data.lead, outcome }` parseando el body de la respuesta ANTES de avisar (el `lead` del server es la fuente autoritativa, no el cache optimista).
- El hold de calendario (`openPlaceholderModal`) avisa con `_dispoAnnounce` SOLO — nunca toca el gate de disposición obligatoria de la Phase 20 (D-08).
- El Power Dialer integra el destino como una tercera línea dentro del banner "✓ Resultado guardado" en vez de un toast que interrumpiría el flujo — `vista`/`cuando` escapados con `escHtml` (dato del lead viaja por `innerHTML`).

## Task Commits

1. **Task 1: `_dispoDestination` puro + aviso universal desde `_dispoAfterSaved`** - `7ed8147` (feat)
2. **Task 2: Destino dentro del banner del Power Dialer (D-07)** - `fb0e08e` (feat)
3. **Task 3: Tests del destino + verificación de universalidad + cache-buster** - `b8c0e00` (test)

_No hubo commit de plan-metadata separado — este SUMMARY se commitea junto con el resto del wave por el orquestador (modo worktree)._

## Files Created/Modified

- `public/app.js` - bloque `[30-03] DISPO-DEST` (`_dispoNextAt`, `_dispoWhenLabel`, `_dispoDestination`) inmediatamente antes de `_dispoAnnounce`; `_dispoAfterSaved(leadId, opts={})` reescrita para llamar `_dispoAnnounce` al final; `_dispoWhereToast` eliminada; 7 call sites actualizados (`_handleCallDisposition`, `openCallbackModal`, `openObjectionModal`, `openScheduleModal` + su observer de fallback, `openNextStepModal`, `_autoMarkNoAnswer`, `openPlaceholderModal`); `_pd.holdMeta` sumado al estado del Power Dialer (init + 3 resets: `_pdStart`/`_pdAdvance`/`_pdBack`) y pintado en `_holdBanner`.
- `public/index.html` - cache-buster de `app.js` bumpeado `v=20260815a` → `v=20260815b` (`style.css` intacto, sigue en `v=20260814a`).
- `tests/gate-destination.test.js` (nuevo) - 27 tests: 11 del bloque puro (8 ramas de destino + determinismo + hold de calendario con nextAction esperar_respuesta), 3 de `_dispoNextAt`, 4 de `_dispoWhenLabel` (hoy/mañana/lejano/borde de día 23:30, cada uno replicando el mismo `Intl` que la implementación para no depender del ICU del entorno), 6 de universalidad del aviso, 2 del banner del Power Dialer, 1 de cache-buster.

## Decisions Made

Ver `key-decisions` en el frontmatter. Adicionalmente:

- Los tests de `_dispoWhenLabel` NO hardcodean el string de hora exacto (ej. "18:30"): el entorno de test (Node small-icu) produce formato 12h con "p. m." mientras un browser real produce 24h para `es-AR`. Como la función es una copia literal (sin cambios) de lo que ya hacía `_dispoWhereToast` inline, los tests replican el MISMO llamado a `toLocaleTimeString`/`toLocaleDateString` para comparar contra lo que el propio entorno produce — determinista sin importar qué ICU tenga la máquina que corre la suite.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comentarios que mencionaban `_dispoWhereToast` literal rompían el acceptance criterion "0 ocurrencias"**
- **Found during:** Task 1 (verify, `grep -c "_dispoWhereToast" public/app.js`)
- **Issue:** Al reemplazar la función, dejé 4 comentarios explicativos que nombraban `_dispoWhereToast` para dar contexto histórico ("reemplaza a _dispoWhereToast..."). El acceptance criterion del plan pide `grep -c` = 0 literal, sin distinguir código de comentarios.
- **Fix:** Reescritos los 4 comentarios para describir la función vieja sin usar el nombre literal ("el toast de destino viejo").
- **Files modified:** `public/app.js`
- **Verification:** `grep -c "_dispoWhereToast" public/app.js` → 0.
- **Committed in:** `7ed8147` (Task 1 commit)

**2. [Rule 1 - Bug] Comentario de la suite mencionaba "Date.now() real" y rompía el acceptance criterion de Task 3**
- **Found during:** Task 3 (verify, `grep -c "Date.now()" tests/gate-destination.test.js`)
- **Issue:** El comentario de cabecera del archivo de test decía "nunca Date.now() real" para explicar por qué todos los casos usan un reloj fijo — pero el acceptance criterion pide 0 ocurrencias literales de esa substring en todo el archivo.
- **Fix:** Reescrito el comentario a "un reloj FIJO, nunca el reloj real de la corrida" sin la substring literal.
- **Files modified:** `tests/gate-destination.test.js`
- **Verification:** `grep -c "Date.now()" tests/gate-destination.test.js` → 0.
- **Committed in:** `b8c0e00` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (Rule 1 — ambos son ajustes de redacción de comentarios para cumplir un grep literal del plan, sin ningún cambio de comportamiento).
**Impact on plan:** Ninguno — ambos son consecuencia mecánica de escribir comentarios explicativos y luego notar que rozaban un acceptance criterion basado en grep literal.

## Issues Encountered

- El entorno de test (Node, ICU por defecto) produce formato de hora/fecha distinto al de un browser real para el locale `es-AR` (12h con "a. m./p. m." en vez de 24h, separador `-` en vez de `/` en algunas fechas). Como `_dispoWhenLabel` es una copia literal del cálculo que ya hacía `_dispoWhereToast` (el plan pedía moverlo "sin cambiarla"), la solución fue hacer que los tests repliquen el mismo llamado a `Intl` en vez de hardcodear el string esperado — ver Decisions Made.
- No se pudo dividir el diff de la Task 1 y la Task 2 en commits separados usando `git add -p` porque ambas tareas modificaban `public/app.js` con ediciones ya aplicadas juntas en el working tree; en vez de arriesgar una operación destructiva de git, se revirtieron temporalmente las 5 ediciones puntuales de la Task 2 (uso del `Edit` tool, reversible y revisable), se commiteó la Task 1 sola, se reaplicaron esas mismas 5 ediciones, y se commiteó la Task 2. Verificado en cada paso con `node --check` y greps de los acceptance criteria.

## User Setup Required

None - no external service configuration required.

## Efectos visibles esperados (pedido explícito del plan, `<output>`)

**Los 8 textos exactos de cada rama de destino** (para que el próximo que las toque no las reinvente — `nombre` es `lead.name || 'Lead'`, `cuando` sale de `_dispoWhenLabel`):

| Rama | `vista` | `tono` | `texto` |
|---|---|---|---|
| DNC (`doNotCall:true`) | `en la vista No-llamar` | `warn` | `«<nombre>» queda en No-llamar — no vuelve a sonar en ninguna cola de Llamadas.` |
| Descartado normal | `en Descartados` | `info` | `«<nombre>» sale de la cola — queda en Descartados. Para volver a encontrarlo, buscalo por nombre en Llamadas.` |
| Descartado auto (`sin_contacto_2x`) | `en Descartados` | `warn` | `«<nombre>» sale de la cola (automático, 2 intentos sin contacto) — queda en Descartados. Para volver a encontrarlo, buscalo por nombre en Llamadas.` |
| Descartado auto (`cortes_2x`) | `en Descartados` | `warn` | `«<nombre>» sale de la cola (automático, 2 cortes) — queda en Descartados. Para volver a encontrarlo, buscalo por nombre en Llamadas.` |
| Agendado | `en Reuniones agendadas` | `success` | `«<nombre>» sale de la cola — queda agendado en Reuniones agendadas.` |
| Interesado (con `cuando`) | `en Hoy → Interesados` | `info` | `«<nombre>» sale de la cola — vuelve <cuando> en Hoy → Interesados.` |
| Último outcome `callback_later` con fecha futura | `en Hoy → Callbacks` | `info` | `«<nombre>» sale de la cola — vuelve <cuando> en Hoy → Callbacks.` |
| Cadencia/otro con fecha futura (`esperar_respuesta`) | `a la cola de Llamadas` | `info` | `«<nombre>» queda esperando respuesta — vuelve <cuando> a la cola de Llamadas.` |
| Cadencia/otro con fecha futura (genérico) | `a la cola de Llamadas` | `info` | `«<nombre>» sale de la cola — vuelve <cuando> a la cola de Llamadas.` |
| Sin fecha, no terminal | `a la cola de Llamadas` | `info` | `«<nombre>» sigue disponible en la cola de Llamadas.` |

- **`_dispoWhereToast` ya NO existe** — el único cálculo de destino es `_dispoDestination` dentro del bloque `[30-03] DISPO-DEST` (`public/app.js`, junto a `_dispoAnnounce`). Cualquier disposición futura debe pasar por `_dispoAfterSaved(leadId, { lead, outcome })` para heredar el aviso; llamar `showToast` a mano para esto sería reintroducir el bug que esta fase cierra (avisos inconsistentes en distintos caminos).
- **Suite completa: 1365/1365** (91 archivos + 1 nuevo = 92; baseline 1338 documentado en `30-02-SUMMARY.md` + 27 tests de este plan). `metrics-consistency` 18/18 verde sin editar el archivo (D-09). `public/style.css` intacto en todo el plan.
- **Nota sugerida para CLAUDE.md** (no aplicada en este plan — el orquestador consolida notas de sesión): `_dispoWhereToast` ya no existe; el único cálculo de destino de una disposición es `_dispoDestination` dentro del bloque `[30-03] DISPO-DEST` de `public/app.js`, llamado desde `_dispoAnnounce`/`_dispoAfterSaved`. Toda disposición nueva debe pasar por `_dispoAfterSaved(leadId, { lead: data.lead, outcome })` para heredar el aviso — nunca tirar un toast de destino a mano.

## Next Phase Readiness

- GATE-04 completo: las 3 fases del gate (backend D-01/D-02 en 30-01, modal frontend en 30-02, aviso universal en 30-03) están cerradas. El milestone v4.0 puede avanzar a Phase 31 (compromisos hablados).
- Sin bloqueos. La Phase 31, si agrega nuevas dispositions u outcomes, debe seguir el patrón establecido: pasar por `_dispoAfterSaved(leadId, { lead, outcome })` para que el aviso de destino se herede automáticamente, y si necesita un mensaje especial (como el de `esperar_respuesta`), extender `_dispoDestination` dentro del bloque `[30-03] DISPO-DEST` en vez de duplicar lógica de toast en otro lado.

---
*Phase: 30-gate-proximo-paso*
*Completed: 2026-08-15*

## Self-Check: PASSED
