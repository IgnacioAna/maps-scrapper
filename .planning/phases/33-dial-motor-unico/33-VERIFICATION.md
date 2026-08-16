---
phase: 33-dial-motor-unico
verified: 2026-08-16T06:46:27Z
status: human_needed
score: 4/4 must-haves verified (DIAL-01..04)
overrides_applied: 0
gaps: []
deferred: []
human_verification:
  - test: "Abrir el Power Dialer desde 'Discar acá' en las 3 superficies (lista de Llamadas, ficha expandida, fila de Hoy) y confirmar que el botón se ve bien, no rompe el layout, y el salto entre leads con el dialer ya abierto se siente instantáneo sin parpadeo."
    expected: "El botón es legible, no empuja otros elementos fuera de la tarjeta, y saltar de un lead a otro dentro del dialer abierto no recarga ni parpadea."
    why_human: "No hay browser en el entorno de ejecución; toda la verificación de las 4 sesiones que construyeron la fase fue por lectura de código/tests, nunca visual."
  - test: "Colgar una llamada real dentro del Power Dialer de Hoy (las 3 variantes: completa/callbacks/interesados) y confirmar que la grilla de resultado queda visible con el banner '✓ Resultado guardado' + línea de destino, sin expulsar la tarjeta."
    expected: "Tras marcar cualquier outcome (directo o con modal) el lead se queda en pantalla con el banner correcto hasta que el SDR aprieta Siguiente/S."
    why_human: "Requiere una llamada Telnyx real; no simulable en el entorno de verificación."
  - test: "Con Hoy visible, marcar un resultado desde la lista de Llamadas sobre un lead que EMPIEZA a corresponder a Hoy (ej. un callback_later nuevo) y confirmar que aparece en Hoy sin recargar, y que el scroll de Hoy no salta al repintar."
    expected: "El lead aparece en la sección correcta de Hoy en el acto; el innerHTML completo se reemplaza pero la posición de scroll del usuario no debería saltar de forma perceptible."
    why_human: "El propio 33-03-SUMMARY documenta que `_hoyRenderFromStore` reemplaza el innerHTML completo sin preservar scroll explícitamente — falta confirmar en vivo si esto se nota o no."
  - test: "Ver el bloque de historial ('Ya trabajado · N intentos') en un lead con historial largo de otra vendedora (nota de 140 caracteres, compromiso vencido) en las 3 superficies, y confirmar que no empuja el botón 'Llamar' fuera de la vista en pantallas chicas, y que el color de 'Compromiso vencido' (var(--warning)) tiene buen contraste contra var(--bg-app)."
    expected: "El bloque es legible en 3 segundos, no compite visualmente con el botón Llamar, y el estado vencido se distingue claramente."
    why_human: "Explícitamente marcado como 'sin verificar en vivo' en el 33-04-SUMMARY; es una decisión de diseño visual que solo se puede juzgar mirando el render real."
---

# Phase 33: DIAL — Power Dialer como motor único — Verification Report

**Phase Goal:** El Power Dialer deja de ser una herramienta aislada — se lanza
sobre un lead puntual, no expulsa la tarjeta al marcar, comparte estado en
vivo con Hoy y Llamadas, y su ficha muestra el historial de las vendedoras al
frente.

**Verified:** 2026-08-16T06:46:27Z
**Status:** human_needed (todo lo automáticamente verificable pasa; quedan 4
ítems de verificación visual/en-vivo explícitamente marcados como pendientes
por los propios SUMMARY de las 4 sesiones de ejecución)
**Re-verification:** No — verificación inicial

## Metodología

Verificación goal-backward: para cada requirement (DIAL-01..04) se leyó el
CONTEXT (decisiones D-01 a D-13), el PLAN.md correspondiente, y luego se
confirmó CADA afirmación del SUMMARY.md contra el código real en
`public/app.js` e `index.js` con `grep`/`Read` directos — sin asumir que lo
que dice el SUMMARY es cierto. Se corrió la suite completa (`npx vitest run`)
una vez, sin ediciones de código propias (instrucción explícita: modo
solo-lectura por trabajo en paralelo de otro agente sobre CSS en los mismos
archivos).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | DIAL-01: se puede lanzar el dialer sobre un lead puntual desde 4 superficies, sin perder el resto de la cola, sin auto-discar | ✓ VERIFIED | `window._pdDialHere` (app.js:6932), `_pdStart(mode, opts={})` con `opts.startAtLeadId` (app.js:6820-6915), `_pd.forced` respetado en el guard de `_pdRender` (app.js:7125), botón "Discar acá" cableado en variantes `row`/`ficha`/`hoy` de `_actButtonsHTML` (app.js:6225,6230,6236) + fila de `#pd-queue` (app.js:7489). `_pd.autopilotArmed = false` en `_pdStart` (app.js:6881) — nunca auto-disca sobre la primera tarjeta |
| 2 | DIAL-02: marcar cualquier resultado (directo o con modal) deja la tarjeta en pantalla con el banner hasta que el user avanza; cancelar no holdea; autopiloto sigue avanzando solo | ✓ VERIFIED | `function _pdHold` único camino (app.js:7092), `_pd.holdCurrent = true` aparece EXACTAMENTE 1 vez en todo el archivo (dentro de `_pdHold`), `_pd.pendingSave` escrito por `_dispoAfterSaved` (app.js:9599) y consumido por `_pdHandleDisposition` (app.js:7623-7681) validando `leadId`+`at`; rama de cancelar modal no llama `_pdHold` ni `_pdAdvance` (app.js:7678-7679: `if (ps) _afterSaved(ps);` sin `else`); D-05 (autopiloto) en primera línea del cuerpo de `_pdHold`; `stillActionable` NO existe en ningún archivo (`grep` global = 0 ocurrencias, ni en comentarios) |
| 3 | DIAL-03: lo que se marca en el dialer/Llamadas se ve en Hoy sin recargar y viceversa; volver a una vista repinta desde el store; el fetch queda para carga inicial/refresh explícito/datos viejos (>5min) | ✓ VERIFIED | `_hoyRenderFromStore(leadsArg)` (app.js:5959) sin `fetch(`/`await` en su cuerpo; `_leadStoreVersion`/`_leadStoreDirty` instrumentando `_leadStoreApply` (app.js:5840-5868); `_callsShowView`/`_hoyShowView` (app.js:12908,12917) cableados a los listeners de menú (app.js:12926,12928), gate de frescura `LEAD_STORE_STALE_MS` (5 min, app.js:5825); `_dispoAfterSaved` y `_actDiscard` repintan con `_hoyRenderFromStore()` sin `loadHoyView()`; `_pdExit` conserva el fetch explícito |
| 4 | DIAL-04: la ficha pone al frente última disposición+cuándo, quién la marcó (nombre real, no id crudo), última nota, compromiso pendiente, intentos; nada si nunca fue trabajado; sin transcript expandido | ✓ VERIFIED | Backend: `_buildUserNameMap(ids)` (index.js:7909) solo ids pedidos + solo `u.name` (nunca email, confirmado por lectura — no hay `u.email` en el cuerpo); `GET /leads/sin-wsp` responde `{ leads, userNames }` (index.js:8976). Frontend: bloque `[33-04] HISTORY-PURE` (app.js:12646-12763) con `_leadHistoryBrief` puro (sin DOM/fetch/localStorage/`Date.now()` interno, sin `transcript`, orden D-11 exacto: last→note→commitment→attempts) y `_leadHistoryHTML` (app.js:6247, `escHtml` en toda interpolación, sin emojis, `D-12: return ''` si `!brief.has`); cableado confirmado por posición de literal en las 3 superficies: `_pdRender` (app.js:7310, entre Bloque 1 y 1.5), `window._leadFileHtml` (app.js:10753, primer `rows.push`), `_callsRenderExpandedPanel` (app.js:8891, entre `_expChips` y `_briefBlock`) |

**Score:** 4/4 truths verified por código real (no por confianza en el SUMMARY)

### D-09 — Límite explícito verificado independientemente

**Decisión:** "NO se construye un store reactivo completo... Se unifica la
ESCRITURA y se re-renderiza al mostrar."

**Verificación propia (no la afirmación del SUMMARY):**

```
grep -n "addEventListener('leadstore\|dispatchEvent(new CustomEvent('lead\|new Proxy(" public/app.js
→ sin resultados (0 matches)
```

Se leyó además el cuerpo completo de `_leadStoreApply` (app.js:5849-5869): es
un mutador directo síncrono (`Object.assign` sobre el array + `Map.set`),
sin ningún mecanismo de publish/subscribe, sin `EventTarget`, sin getters/
setters de `Proxy`. La sincronización entre vistas se logra con: (a) una
única función de escritura que mantiene dos cachés con la MISMA referencia
de objeto, (b) un contador de versión (`_leadStoreVersion`) y un `Set` de
ids sucios (`_leadStoreDirty`) que los renderers consultan bajo demanda al
mostrarse (`_callsShowView`/`_hoyShowView`), NO por notificación push. Esto
es exactamente lo que D-09 pide: escritura unificada + repintado al
mostrar, sin store reactivo multi-vista. **D-09 respetado, confirmado por
grep e inspección directa propios, no por la afirmación del SUMMARY.**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `public/app.js` — `window._pdDialHere` | DIAL-01 | ✓ VERIFIED | Existe, cableado en 4 superficies + fila de cola |
| `public/app.js` — `function _pdHold` | DIAL-02 | ✓ VERIFIED | Único camino al hold, `_pd.holdCurrent=true` 1 sola vez en el archivo |
| `public/app.js` — `function _hoyRenderFromStore` | DIAL-03 | ✓ VERIFIED | Sin red, guard anti-repintado por versión |
| `index.js` — `function _buildUserNameMap` | DIAL-04 | ✓ VERIFIED | Solo ids pedidos, solo `name`, nunca `email` |
| `public/app.js` — `[33-04] HISTORY-PURE` | DIAL-04 | ✓ VERIFIED | Marcadores de inicio/fin presentes, bloque puro evaluable con `new Function` |
| `tests/dial-start-at.test.js` | DIAL-01 | ✓ VERIFIED | 25 tests, verdes |
| `tests/dial-hold.test.js` | DIAL-02 | ✓ VERIFIED | 30 tests, verdes |
| `tests/dial-sync.test.js` | DIAL-03 | ✓ VERIFIED | 34 tests, verdes (incluye test anti-D-09) |
| `tests/dial-history.test.js` | DIAL-04 | ✓ VERIFIED | 49 tests, verdes |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `_actButtonsHTML` (row/ficha/hoy) | `window._pdDialHere` | `onclick` | ✓ WIRED | Confirmado en las 3 variantes + fila de `#pd-queue`; ausente a propósito en variante `pd` |
| `_pdHandleDisposition` | `_pdHold` | `_afterSaved(ps)` | ✓ WIRED | Rama directa (polling con deadline) y rama con modal (`_consumeSaved`), ambas confirmadas |
| `_dispoAfterSaved` | `_pd.pendingSave` | escritura de señal | ✓ WIRED | `_pd.active` gate, sin llamar `_pdHold` directamente (evita modal huérfano) |
| `_leadStoreApply` | `_leadStoreVersion`/`_leadStoreDirty` | instrumentación | ✓ WIRED | Bump al final de cada aplicación exitosa |
| `loadHoyView`/`loadCallsView` | `_hoyRenderFromStore` | fetch + delegar | ✓ WIRED | `loadHoyView` limpia `_leadStoreDirty` tras el fetch, delega el render |
| `GET /leads/sin-wsp` | `window.__userNames` | merge en `loadCallsView`/`loadHoyView` | ✓ WIRED | 4 ocurrencias de `window.__userNames`, patrón merge (nunca reemplazo) |
| `_pdRender`/`_leadFileHtml`/`_callsRenderExpandedPanel` | `_leadHistoryHTML` | anclas exactas del plan | ✓ WIRED | Posición confirmada por lectura directa en las 3, respeta el orden pedido |

### Anti-Patterns Found

Ninguno en el código de la fase (TBD/FIXME/XXX no encontrados en los bloques
DIAL-01..04; ningún `return null`/stub detectado en las funciones nuevas).

**Nota de proceso (no anti-patrón de código):** las 4 SUMMARY documentan
extensamente contaminación de commits por una sesión paralela editando
`public/style.css`/`public/app.js`/`public/index.html` (disciplina de
color, commits `bf435fe` y hunks arrastrados dentro de `41636b3`). Verificado
que ninguno de esos hunks ajenos toca el bloque `HISTORY-PURE`, `_pdHold`,
`_leadStoreApply` ni sus call sites — es ruido de atribución de commit, no
un problema funcional. La suite completa (1801/1801) confirma que el
resultado final del working tree es correcto independientemente de qué
commit contiene qué hunk.

## Gap real encontrado — documentación de cierre de fase no aplicada

El propio `33-04-PLAN.md` (`<output>`) exige explícitamente como parte del
cierre de la fase: *"marcar DIAL-01..04 en `.planning/REQUIREMENTS.md`, la
Phase 33 como Complete (4/4) en `.planning/ROADMAP.md` (las 3 tablas que la
mencionan) y actualizar `.planning/STATE.md`"*. Verificado que esto **NO se
hizo**:

- `.planning/REQUIREMENTS.md:332` — `DIAL-04` sigue con `[ ]` (no `[x]`),
  mientras DIAL-01/02/03 sí están `[x]`.
- `.planning/ROADMAP.md:89` — el índice de fases sigue listando
  `- [ ] **Phase 33: DIAL...**` sin marcar.
- `.planning/ROADMAP.md:349` — Wave 4 (`33-04-PLAN.md`) sigue con `- [ ]`
  en vez de `- [x]` con referencia al SUMMARY.
- `.planning/STATE.md` — sigue diciendo *"Siguiente: 33-04 (DIAL-04...)
  Wave 4 del plan de la fase — último plan de Phase 33"*, como si 33-04
  todavía no se hubiera ejecutado.

Esto es **puramente documental** — el código, los tests y la funcionalidad
de DIAL-04 están completos y verificados independientemente (ver arriba). No
es un BLOCKER funcional. Se reporta porque el propio plan lo pedía como parte
explícita del "done" de la fase, y quedó sin hacer en ninguna de las 2
sesiones que cerraron 33-04 (la que hizo el código, ni la que cerró
documentalmente el SUMMARY). Recomendación: actualizar esos 3 archivos a
mano (el propio plan advierte explícitamente NO usar `gsd-sdk query` sobre
ellos, por el patrón de corrupción de formato ya confirmado 6 veces en el
milestone).

## npm test — resultado real

```
npx vitest run
 Test Files  106 passed (106)
      Tests  1801 passed (1801)
   Duration  85.01s
```

**Coincide exactamente** con el baseline documentado en el 33-04-SUMMARY
(1801/1801, 106 archivos). Corrida única, sin fallos, sin necesidad de
re-correr nada aislado — no hubo flakiness ambiental esta vez (a diferencia
de lo documentado en sesiones anteriores del milestone, notas #30/#93/#110/
#113/#161 de CLAUDE.md).

Las 4 suites nuevas de la fase, corridas también de forma aislada:

```
npx vitest run tests/dial-start-at.test.js tests/dial-hold.test.js tests/dial-sync.test.js tests/dial-history.test.js
 Test Files  4 passed (4)
      Tests  138 passed (138)   (25 + 30 + 34 + 49 = 138, coincide con la suma documentada en los 4 SUMMARY)
```

## Human Verification Required

Los 4 ítems están explícitamente documentados como "sin verificar en vivo"
en los propios SUMMARY de las 4 sesiones de ejecución (no hay browser en el
entorno de ejecución de ninguna). Ver la sección `human_verification` del
frontmatter para el detalle completo. Resumen:

### 1. Botón "Discar acá" — apariencia y salto instantáneo
**Test:** Abrir el dialer desde las 3 superficies y saltar entre leads con el dialer ya abierto.
**Expected:** Botón legible, sin romper layout; salto sin parpadeo.
**Why human:** Sin browser en el entorno de las 4 sesiones que construyeron la fase.

### 2. Hold real en una llamada Telnyx dentro del dialer de Hoy
**Test:** Colgar una llamada real en cualquiera de las 3 variantes de Hoy y confirmar que la grilla de resultado se queda.
**Why human:** Requiere una llamada Telnyx real.

### 3. Repintado de Hoy sin salto de scroll
**Test:** Marcar desde Llamadas con Hoy visible un lead que empieza a corresponder a Hoy.
**Why human:** `_hoyRenderFromStore` reemplaza el innerHTML completo sin preservación explícita de scroll (documentado en 33-03-SUMMARY como no verificado).

### 4. Contraste y layout del bloque de historial
**Test:** Ver el bloque en un lead con historial largo en las 3 superficies.
**Why human:** Decisión visual, explícitamente marcada como pendiente en 33-04-SUMMARY.

## Gaps Summary

**Ningún gap funcional/de código.** Los 4 requirements (DIAL-01..04) están
implementados, cableados en las superficies correctas, cubiertos por 138
tests permanentes nuevos, y verificados por lectura directa de código —no
por confianza en las afirmaciones de los SUMMARY. D-09 (límite anti-store-
reactivo) se respetó, confirmado independientemente.

Un solo gap **no funcional** encontrado: la actualización de
REQUIREMENTS.md/ROADMAP.md/STATE.md que el propio plan 33-04 pedía como
parte de su cierre no se ejecutó (DIAL-04 sigue `[ ]`, Phase 33 sigue sin
marcar Complete). Recomendado corregir a mano antes de considerar el
milestone "prolijo", pero no bloquea el avance a la Phase 34 — el código que
esa fase necesita como dependencia (`_hoyRenderFromStore`,
`window.__userNames`, `_pdHold`, `_leadHistoryHTML`) existe y funciona.

El status queda en `human_needed` (no `passed`) porque hay 4 ítems de
verificación visual/en-vivo pendientes, ninguno de los cuales pudo
verificarse por código — son inherentemente ítems que requieren un browser
real o una llamada Telnyx real.

---

_Verified: 2026-08-16T06:46:27Z_
_Verifier: Claude (gsd-verifier)_
