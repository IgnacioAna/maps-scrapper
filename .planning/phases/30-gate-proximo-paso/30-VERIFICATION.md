---
phase: 30-gate-proximo-paso
verified: 2026-08-15T14:10:00Z
status: human_needed
score: 18/18 must-haves verified (code + automated tests)
overrides_applied: 0
gaps: []
human_verification:
  - test: "Abrir Llamadas, elegir 'Interesado (sin agendar)' en el select de un lead"
    expected: "Aparece #call-next-modal sin la clase hidden, con #call-next-fecha cargado a +3 días (ISO ahora+72h) y el chip 'En 3 días' resaltado (isDefault)"
    why_human: "Renderizado real del DOM/CSS y del datepicker propio (Phase 28) — no hay jsdom/browser en el repo (patrón establecido del proyecto), solo tests de fuente y de la función pura. El SUMMARY de 30-02 documenta explícitamente que esta verificación en preview NO se pudo correr (worktree sin tool de browser)."
  - test: "Vaciar #call-next-fecha y clickear Guardar"
    expected: "No se dispara ningún POST; sale un toast/aviso ('Elegí cuándo volvés a hablarle…'); el botón Guardar sigue habilitado (no queda en 'Guardando…')"
    why_human: "Requiere interacción real de click + observar que no hay request de red — comportamiento de runtime, no verificable por grep"
  - test: "Guardar con la fecha por defecto (+3 días) sobre un lead real"
    expected: "El modal se cierra, el lead responde con nextAction.dueAt a +3 días y aparece el toast de destino ('«Lead» sale de la cola — vuelve <fecha> en Hoy → Interesados')"
    why_human: "Flujo end-to-end de click real; el backend ya está probado por HTTP vía supertest, falta el tramo del click en el browser"
  - test: "Reabrir el modal #call-next-modal sobre OTRO lead después de haber guardado uno antes"
    expected: "#call-next-confirm está habilitado y dice 'Guardar' (anti-regresión del bug #181b: el botón NO debe quedar muerto en 'Guardando…')"
    why_human: "Es justamente el bug histórico (#181b) que solo se manifiesta reabriendo el modal en una sesión real del browser"
  - test: "Abrir el Power Dialer desde Hoy → Interesados, marcar un interesado y confirmar que la tarjeta no se salta sola al siguiente"
    expected: "La tarjeta se queda con el banner '✓ Resultado guardado' + la línea de destino (D-07); el dialer NO expulsa la tarjeta apenas el lead queda con nextAction futuro"
    why_human: "Comportamiento de _pdRender en vivo con cola real — la lógica está verificada por grep/source-assertion pero no ejercitada en un dialer corriendo"
  - test: "Marcar 'No atendió', 'No interesado' y 'Volver a llamar' desde Llamadas y confirmar los 3 textos de destino correctos (cola de Llamadas / Descartados / Hoy → Callbacks)"
    expected: "Toast visible con el texto y vista correctos para cada rama (los 8-9 textos exactos están documentados en 30-03-SUMMARY.md)"
    why_human: "_dispoDestination está 100% cubierto por tests puros con reloj fijo, pero el disparo real del toast (showToast, timing, que no se solape con otro toast) es comportamiento de runtime"
  - test: "En el Power Dialer, marcar un resultado y confirmar que el destino aparece DENTRO del banner verde (no como toast separado), y que desaparece al avanzar al siguiente lead"
    expected: "La línea de destino con escHtml aplicado se ve bien formateada dentro de '✓ Resultado guardado'; _pd.holdMeta se limpia al cambiar de lead"
    why_human: "Renderizado visual del banner + verificación de que no queda contenido de un lead pegado al siguiente"
---

# Phase 30: GATE — Cierra la llamada, define el próximo paso Verification Report

**Phase Goal:** No se puede cerrar una disposición sin un `nextAction` o un estado terminal explícito, con una propuesta de próximo paso ya cargada y feedback claro de a dónde se fue el lead.
**Verified:** 2026-08-15
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | Al intentar cerrar cualquier disposición (incluida "interesado") sin `nextAction` y sin estado terminal, el sistema lo impide con aviso claro / garantiza que ningún lead activo queda flotando | ✓ VERIFIED | Backend: red de seguridad al final de `_applyCallOutcome` (index.js:11384-11393) asigna cadencia +24h a cualquier lead no-terminal sin `nextAction`, nunca 4xx (D-01). Frontend: `openNextStepModal` bloquea confirmar sin fecha con toast de aviso y `return` (app.js:11080-11085), específicamente para "interesado" — el único outcome que antes de esta fase podía quedar sin próxima acción (los demás ya reciben cadencia automática o son terminales). Cubierto por `tests/gate-next-action.test.js` (12/12) y `tests/gate-next-step-ui.test.js` (17/17). |
| 2 | Cada resultado de llamada llega con una propuesta de próximo paso ya cargada (fecha + motivo) que el usuario acepta con un click o edita | ✓ VERIFIED | `answered_interested` → modal con +3 días pre-cargado + atajos 1/3/7/15 días (D-03) + calendario Phase 28 (app.js:11033-11128). `callback_later` y `placeholder_sent` (hold) ya tenían su propio formulario de fecha (Phase 28, sin cambios de esta fase). Mapa D-02 completo en `_applyCallOutcome` (index.js:11179-11393). |
| 3 | Al guardar, un mensaje visible dice a dónde se fue el lead y cómo volver a encontrarlo | ✓ VERIFIED | `_dispoDestination` (puro, 8 ramas con precedencia DNC→descartado→agendado→interesado→callback_later→cadencia/otro→sin fecha) + `_dispoAnnounce`/`_dispoAfterSaved` universalizado desde 7 call sites (app.js:8557-8735). `_dispoWhereToast` (el aviso viejo, parcial) fue eliminado por completo — `grep -c "_dispoWhereToast" public/app.js` → 0. Cubierto por `tests/gate-destination.test.js` (27/27). |

**Score:** 3/3 Success Criteria verified in code + automated tests.

### Must-Haves per Plan (frontmatter)

**Plan 30-01 (backend, GATE-01/GATE-02) — 6/6 truths verified:**

| Truth | Status | Evidence |
|---|---|---|
| Ninguna disposición no-terminal deja el lead sin próximo paso | ✓ VERIFIED | Red de seguridad index.js:11384-11393; tests case 11 (no_answer con callbackAt en opts que saltea la cadencia igual sale con nextAction) |
| "Interesado" programa solo un seguimiento +3 días (manual) | ✓ VERIFIED | index.js:11190-11197; test 1 |
| "Me cortó" (1er corte) programa reintento +24h | ✓ VERIFIED | index.js:11314-11327; test 2 |
| Hold de calendario deja esperando respuesta +48h | ✓ VERIFIED | index.js:11900-11911 (dentro de `mutateSettersData`); test 12 (source-assertion, justificado — no se puede ejercitar Resend real) |
| Servidor nunca devuelve 400 por falta de próximo paso | ✓ VERIFIED | Ninguna rama nueva de `call-disposition`/`_applyCallOutcome` agrega un `res.status(4xx)`; test 7 (dueAt inválido → 200, default aplicado) |
| Override del cliente se respeta si vivo, se ignora si terminal | ✓ VERIFIED | index.js:11373-11375 (`!GATE_TERMINAL_ESTADOS.has(lead.estado)`); tests 6, 8, 9, 10 |

**Plan 30-02 (frontend, modal "Próximo paso") — 6/6 truths verified:**

| Truth | Status | Evidence |
|---|---|---|
| "Interesado" abre paso con fecha +3 días ya propuesta, 1 click alcanza | ✓ VERIFIED (código) / pending human click | `openNextStepModal` (app.js:11033-11128); markup `#call-next-modal` en index.html:1574-1595 |
| No se puede confirmar con fecha vacía — avisa | ✓ VERIFIED (código) / pending human click | app.js:11080-11085; test "GATE-01: no deja confirmar sin fecha" |
| Atajos rápidos + calendario Phase 28 conviven | ✓ VERIFIED | `_gateInteresadoPicks` (4 saltos D-03) + `_dtPickerAttach` reusado literal (app.js:11041, 11046-11068) |
| Botón nunca queda muerto en "Guardando…" entre aperturas | ✓ VERIFIED (código) / pending human click | Cinturón (app.js:11073-11076) + tiradores `finally` (app.js:11123-11125); test anti-regresión #181b dedicado |
| Power Dialer sigue mostrando el interesado tras marcarlo | ✓ VERIFIED | Excepción `estado !== 'interesado'` en la expulsión de `_pdRender` (app.js:6749-6758) con comentario razonado |
| Los otros 8 resultados se marcan con 1 click, igual que hoy | ✓ VERIFIED | `git diff` sobre `pd-disposition-grid`/`_dispoSelectHTML`: 9 opciones/9 botones intactos, confirmado por lectura directa |

**Plan 30-03 (frontend, GATE-04 aviso universal) — 5/5 truths verified:**

| Truth | Status | Evidence |
|---|---|---|
| Toda disposición dice a dónde se fue el lead y cuándo vuelve | ✓ VERIFIED | `_dispoAnnounce` llamado desde 7 caminos vía `_dispoAfterSaved`/directo (app.js, confirmado por grep de los 7 call sites) |
| El aviso nombra la vista real (Hoy→Callbacks, Hoy→Interesados, cola de Llamadas, Reuniones agendadas, Descartados, No-llamar) | ✓ VERIFIED | `_dispoDestination` 8 ramas con los 6 nombres de vista literales (app.js:8623-8706); 8 tests de rama con reloj fijo |
| Power Dialer: destino dentro del banner, sin toast encima | ✓ VERIFIED | `_dispoAnnounce`: `if (_pd.active) { _pd.holdMeta = {...}; return; }` (app.js:8730-8733); pintado en `_holdBanner` (app.js:6878-6886) |
| Hold de calendario también avisa | ✓ VERIFIED | `openPlaceholderModal` llama `_dispoAnnounce` (no `_dispoAfterSaved`, D-08 respetado) — app.js:10927-10934 |
| Descartado dice cómo volver a encontrarlo | ✓ VERIFIED | Texto literal "buscalo por nombre en Llamadas" en la rama descartado de `_dispoDestination` (app.js:8646) |

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `index.js` (GATE_INTERESADO_DELTA_MS, GATE_CADENCIA_DELTA_MS, GATE_PLACEHOLDER_DELTA_MS, GATE_TERMINAL_ESTADOS, `_gateSanitizeNextActionOverride`, `nextActionOverride`) | Defaults D-02 + red de seguridad GATE-01 + override + esperar_respuesta | ✓ VERIFIED | Todas las constantes/funciones existen, derivadas de `NEXT_ACTION_TEMPLATES` como pide el plan (no números sueltos hardcodeados) |
| `tests/gate-next-action.test.js` | Cobertura del mapa D-02, red de seguridad, override | ✓ VERIFIED | 12/12 tests verdes, incluye pruebas HTTP reales (supertest) contra `call-disposition` |
| `public/index.html` (`#call-next-modal` + 4 ids) | Markup del modal | ✓ VERIFIED | Bloque completo en líneas 1574-1595, molde de `#call-callback-modal` |
| `public/app.js` (`openNextStepModal`, bloque `[30-02] GATE-PURE`) | Modal + helpers puros + ruteo | ✓ VERIFIED | `window.openNextStepModal` expuesto; marcadores `[30-02] GATE-PURE` presentes (2 líneas exactas) |
| `tests/gate-next-step-ui.test.js` | Cobertura del bloque puro + wiring | ✓ VERIFIED | 17/17 tests verdes |
| `public/app.js` (`_dispoDestination`, `_dispoAnnounce`, bloque `[30-03] DISPO-DEST`) | Destino puro + aviso universal + banner PD | ✓ VERIFIED | Marcadores presentes; `_dispoWhereToast` eliminado (0 ocurrencias) |
| `tests/gate-destination.test.js` | Cobertura de las 8 ramas + wiring universal | ✓ VERIFIED | 27/27 tests verdes |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `index.js _applyCallOutcome` | `_setNextAction`/`_clearNextAction` | defaults por outcome + red de seguridad | ✓ WIRED | Confirmado por lectura línea por línea del switch + bloques posteriores |
| `POST /call-disposition` | `_applyCallOutcome` | `opts.nextActionOverride` | ✓ WIRED | index.js:11469 (`_gateSanitizeNextActionOverride`) → index.js:11607 (`nextActionOverride: cleanNextActionOverride`) → index.js:11373-11375 (aplicación) |
| `POST /send-placeholder` | `_setNextAction` | dentro de `mutateSettersData` | ✓ WIRED | index.js:11904-11911, después del `await` de envío de mail (regla #19 respetada) |
| `public/app.js _handleCallDisposition` | `openNextStepModal` | rama `answered_interested` | ✓ WIRED | app.js:10804-10809 |
| `openNextStepModal` | `POST /call-disposition` | body con `outcome`+`nextAction` | ✓ WIRED | app.js:11091-11107 |
| `_pdHandleDisposition` | `#call-next-modal` | `modalOpening`+`modalIds` | ✓ WIRED | app.js:7234, 7254 |
| `public/app.js _dispoAfterSaved` | `_dispoAnnounce` | punto único post-guardado (D-05) | ✓ WIRED | app.js:8579, llamada como última línea del cuerpo |
| `_dispoAnnounce` | `_pd.holdMeta` | rama del Power Dialer (D-07) | ✓ WIRED | app.js:8730-8733 |
| `_pdRender` | `_pd.holdMeta` | línea de destino en el banner | ✓ WIRED | app.js:6878-6886, escapado con `escHtml` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `answered_interested` sobre la API real deja `nextAction.dueAt` a ~+72h, `origen:'manual'` | `npx vitest run tests/gate-next-action.test.js` (supertest contra `/call-disposition`) | 12/12 verde | ✓ PASS |
| Override de fecha inválida nunca produce 400 | mismo archivo, test 7 | verde, status 200 | ✓ PASS |
| `_dispoDestination` determinístico con reloj fijo (8 ramas) | `npx vitest run tests/gate-destination.test.js` | 27/27 verde | ✓ PASS |
| Sintaxis de ambos archivos modificados | `node --check index.js && node --check public/app.js` | exit 0 en ambos | ✓ PASS |
| Suite completa del proyecto | `npm test` | **1365/1365** (92 archivos) | ✓ PASS |
| `metrics-consistency` sin mover un número (D-09) | `npx vitest run tests/metrics-consistency.test.js` | 18/18 verde, archivo sin editar (`git log` sobre el archivo) | ✓ PASS |
| `public/style.css` intacto (D-02/T-30 no lo tocan) | `git diff --stat 80a0125 HEAD -- public/style.css` | sin salida (sin cambios) | ✓ PASS |
| Cache-buster bumpeado ante cada cambio de `app.js` | `grep "app.js?v=" public/index.html` | `v=20260815b` (mayor que el baseline `20260814c` pre-fase) | ✓ PASS |

### Probe Execution

No hay probes formales (`scripts/*/tests/probe-*.sh`) declarados para esta fase. SKIPPED — no aplica (fase de código de aplicación, no de infraestructura/migración con probes dedicados).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| GATE-01 | 30-01, 30-02 | No se puede cerrar una disposición sin `nextAction` o estado terminal | ✓ SATISFIED (código) | Red de seguridad backend + gate frontend en `openNextStepModal`. **REQUIREMENTS.md lo marca `[x]`** (correcto, actualizado en el commit `3b5b781`). |
| GATE-02 | 30-01, 30-02 | Cada resultado propone un próximo paso por defecto, editable | ✓ SATISFIED (código) | Mapa D-02 completo + modal con atajos/calendario. **REQUIREMENTS.md lo marca `[x]`** (correcto). |
| GATE-04 | 30-03 | Al guardar, el sistema dice a dónde se fue el lead | ✓ SATISFIED (código) | `_dispoDestination`/`_dispoAnnounce` universalizados, 27 tests verdes. **⚠️ REQUIREMENTS.md todavía lo marca `[ ]` (sin checkear)** — inconsistencia de tracking, ver Gaps de documentación abajo. |

**Orphaned requirements:** ninguno — los 3 IDs del frontmatter de los planes (GATE-01, GATE-02, GATE-04) están declarados en el bloque "GATE" de REQUIREMENTS.md y ninguno de los planes reclama GATE-03 (correcto: ya se hizo en Phase 28 por decisión explícita documentada del user).

### Anti-Patterns Found

Ninguno bloqueante. Se buscaron marcadores de deuda (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) en las regiones modificadas de `index.js` (líneas 11000-11420) y `public/app.js` (bloques del gate/destino/modal) — las únicas coincidencias son la palabra "PLACEHOLDER" como parte del concepto de negocio ("hold de calendario" = placeholder), no deuda técnica.

### Documentation Tracking Gap (no bloquea el código, pero corresponde señalarlo)

- **`REQUIREMENTS.md`**: `GATE-04` sigue con checkbox `[ ]` a pesar de que 30-03 lo completó (commit `c283afd`/`b8c0e00` + el tracking commit `534a29f` solo tocó `ROADMAP.md`, no `REQUIREMENTS.md`). `GATE-01`/`GATE-02` sí quedaron `[x]` desde el tracking commit de 30-01 (`3b5b781`).
- **`STATE.md`**: el frontmatter (`completed_plans: 8`, `total_plans: 10`) y la sección "Current Position" (`Phase: 30 — EXECUTING`, `Plan: 1 of 3`) están desactualizados — describen el estado justo después de 30-01, no después de que 30-02 y 30-03 se completaron y mergearon. `ROADMAP.md` en cambio SÍ quedó correcto (Phase 30 marcada `[x]` completa, 3/3, `2026-08-15`).
- Esto es housekeeping de tracking, no afecta el código ni los tests. Se recomienda una pasada rápida de `docs(phase-30)` que actualice `REQUIREMENTS.md` (tildar GATE-04) y `STATE.md` (Current Position → próxima fase) antes de arrancar la Phase 31.

### Human Verification Required

Los 3 planes de esta fase son mayormente frontend (modal nuevo + aviso universal), y el proyecto no tiene jsdom/browser en el harness de tests (patrón establecido, documentado en múltiples SUMMARYs anteriores). La cobertura automatizada es fuerte: pruebas puras con `new Function` sobre los bloques `[30-02] GATE-PURE`/`[30-03] DISPO-DEST` (sin DOM/red/localStorage) + aserciones de fuente exhaustivas (wiring, anti-regresión #181b, `escHtml`) + pruebas HTTP reales vía supertest para el backend. Lo que NO se pudo ejercitar — ni por el executor de 30-02 (documentado explícitamente en su SUMMARY: "No hay tool de preview/browser disponible... queda pendiente para quien corra el checklist en preview real o en producción") ni por esta verificación (mismo motivo: sin browser/preview tool) — es el click real en un navegador. Los 7 checks quedaron listados en el frontmatter `human_verification` de este reporte; son exactamente los que ya proponían las secciones `<verification>` de los planes 30-02 y 30-03.

### Gaps Summary

No hay gaps funcionales — la implementación de las 3 olas coincide con el mapa D-02, la precedencia documentada, y las decisiones D-01 a D-09 del CONTEXT, verificado línea por línea contra el código y respaldado por 1365/1365 tests (incluidos 12+17+27=56 tests nuevos de esta fase, más 2 aserciones preexistentes corregidas a propósito por el cambio de comportamiento D-02). El único hallazgo es de tracking documental (REQUIREMENTS.md/STATE.md desactualizados, ver arriba) — no bloquea el código y se resuelve con una edición de texto. El estado `human_needed` refleja únicamente la verificación visual/interactiva pendiente en navegador real, no una falla de implementación.

---

_Verified: 2026-08-15_
_Verifier: Claude (gsd-verifier)_
