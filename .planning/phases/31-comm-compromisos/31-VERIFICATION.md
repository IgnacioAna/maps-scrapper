---
phase: 31-comm-compromisos
verified: 2026-08-15T00:00:00Z
status: human_needed
score: 18/18 must-haves verified (code-level)
overrides_applied: 0
human_verification:
  - test: "Abrir el modal 'Próximo paso' al marcar Interesado, elegir cada uno de los 6 tipos de compromiso en #call-next-commitment-tipo"
    expected: "La fecha propuesta cambia según el mapa D-06 (hoy fin de día para 'enviar_info'/'pedir_presupuesto', +24h 'llamar_despues', +3d 'pensarlo', +5d 'hablar_con_socio') y el bloque '¿Quién se comprometió?' aparece con el botón correcto preseleccionado"
    why_human: "Comportamiento visual/interactivo del DOM (onchange, _dtPickerSync) — no hay browser en el entorno de ejecución de los planes ni del verificador"
  - test: "Volver el <select> a 'Sin compromiso específico' después de haber elegido un tipo"
    expected: "La fecha vuelve a la propuesta base de la Phase 30 (_gateInteresadoDefaultDate) y el bloque de parte se oculta"
    why_human: "Mismo motivo: interacción DOM en vivo"
  - test: "Guardar un compromiso con motivo desde el modal y verificar en la respuesta/toast que la fecha coincide con la elegida en el calendario, no con el mapa D-06 recalculado"
    expected: "commitment.dueAt === nextAction.dueAt === la fecha que quedó en el input tras el ajuste manual"
    why_human: "Requiere click real + lectura del toast en pantalla"
  - test: "Desde la ficha de un lead SIN compromiso (Hoy → Ficha o panel expandido de Llamadas), cargar uno con el formulario compacto (tipo + parte + motivo) y guardar"
    expected: "Toast de éxito, el chip de compromiso aparece en la cabecera de la ficha sin recargar la página"
    why_human: "Verificación visual de refresco en vivo (_refreshLeadPanels)"
  - test: "Cerrar un compromiso pendiente con 'Cumplido' y, en otro lead, con 'No cumplió'/'Ya no aplica' según la parte"
    expected: "La tarjeta pasa a la línea compacta de cierre (no queda editable) y el formulario para cargar el siguiente compromiso queda visible debajo"
    why_human: "Esta es la rama que atrapó un bug real (Rule 1 de 31-04, branching por estado derivado vs almacenado) — amerita confirmación visual aunque el código ya lo corrige"
  - test: "Marcar Interesado con un compromiso cargado y leer el toast de destino"
    expected: "El texto dice 'Hoy → Mis compromisos' o 'Hoy → Esperando del prospecto' según la parte, no 'Hoy → Interesados'"
    why_human: "Lectura de toast en pantalla"
  - test: "Dejar vencer un compromiso propio (fecha pasada, sin cerrarlo) y abrir Hoy"
    expected: "Sigue apareciendo en 'Mis compromisos' con el badge en color var(--warning) y el texto 'vencido' — no desaparece"
    why_human: "Requiere esperar el paso del tiempo o mockear reloj + inspección visual del badge"
  - test: "Marcar 'Cumplido' sobre un compromiso enviar_info/pedir_presupuesto propio y volver a Hoy"
    expected: "El lead pasa de 'Mis compromisos' a 'Esperando del prospecto' con el badge 'info mandada · <fecha de envío>'"
    why_human: "Flujo completo cierre → recarga de Hoy → verificación visual del badge"
  - test: "Abrir el panel de una llamada activa (o la ficha) sobre un lead con un compromiso ya cerrado"
    expected: "Aparece como evento en el histórico de llamadas (_renderCallHistory), mezclado cronológicamente con llamadas y notas, con el texto 'Compromiso cumplido/no cumplió/vencido: <tipo>'"
    why_human: "Requiere una llamada activa o apertura del panel en vivo"
  - test: "Verificar contraste visual de los badges nuevos (_hoyCommitBadge) contra el fondo de la fila de Hoy en los 3 estados: pendiente, vencido, 'info mandada'"
    expected: "Los tres estados son legibles y distinguibles (texto var(--on-accent) sobre fondo sólido de acento cuando corresponde)"
    why_human: "Juicio visual de contraste/diseño, no verificable por grep"
---

# Phase 31: COMM — Compromisos como objeto Verification Report

**Phase Goal:** Los compromisos hablados ("mandame info", "llamame en dos semanas", "lo hablo con mi socio") son objetos del sistema con dueño, canal y fecha — no texto suelto dentro de una nota.
**Verified:** 2026-08-15
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Un compromiso hablado queda guardado como objeto con tipo/parte/canal/fecha/estado (no texto libre) | ✓ VERIFIED | `lead.commitment` con 11 campos, `_sanitizeCommitment`/`_setCommitment` en index.js:11217-11419; `COMMITMENT_TIPOS`/`COMMITMENT_PARTES`/`COMMITMENT_ESTADOS` como `Set` a nivel de módulo |
| 2 | Un compromiso pendiente aparece como el `nextAction` del lead — no son dos cosas separadas (ROADMAP SC2) | ✓ VERIFIED | `_setCommitment` llama `_setNextAction(lead, {..., origen:'compromiso'}, createdAt)` (index.js:11410-11417); nunca escribe `callbackAt` a mano |
| 3 | Compromiso del prospecto: si vence sin novedades, el lead reaparece con el vencimiento como motivo visible (ROADMAP SC3) | ✓ VERIFIED | `_commitmentMotivo` arma `"compromiso del prospecto: <label>"` (index.js:11348-11353); `_commitmentNextActionTipo('prospecto', ...)` → `'esperar_respuesta'` |
| 4 | Cerrar un compromiso apaga el reloj SOLO si vino de ahí (origen==='compromiso') | ✓ VERIFIED | `_closeCommitment`: `if (na && na.origen === 'compromiso') _clearNextAction(lead);` (index.js:11436) — mismo idioma que el destildado de follow-up |
| 5 | Marcar cumplido un "le mando info" propio deja al lead esperando respuesta a +48h | ✓ VERIFIED | `_closeCommitment` programa `_setNextAction({tipo:'esperar_respuesta', dueAt:+COMMITMENT_ENVIAR_INFO_DELTA_MS, origen:'compromiso'})` cuando `estado==='cumplido' && parte==='yo' && tipo en {enviar_info,pedir_presupuesto}` (index.js:11442-11456) |
| 6 | Cerrar llamada con un compromiso lo deja guardado en el lead con el próximo paso apuntando a esa fecha (D-08) | ✓ VERIFIED | `call-disposition` destructura `commitment`, sanitiza (`cleanCommitment`) y lo pasa a `_applyCallOutcome` (index.js:11805-11958); aplicado entre override del cliente y GATE-01 (index.js:11690-11714) |
| 7 | El compromiso se puede cargar y cerrar desde fuera de una llamada, sin disposición (D-09) | ✓ VERIFIED | `PATCH /api/setters/leads/:id/commitment` (index.js:10380-10430), rama crear/reemplazar y rama cierre, con los mismos 4 guards que `PATCH .../followup` |
| 8 | Payload malicioso no fabrica campos fuera de whitelist ni toca leads ajenos | ✓ VERIFIED | `_sanitizeCommitment` whitelist-and-coerce (tipo desconocido invalida TODO); guard 403 dueño + 403 visibilidad (`_visibleSetterIds`/`_setterIsVisible`) idénticos al endpoint de follow-up; `tests/commitment-endpoints.test.js` cubre 403 y claves exactas |
| 9 | Payload de compromiso inválido en disposición se ignora en silencio — nunca 4xx | ✓ VERIFIED | `_sanitizeCommitment(commitment)` nunca lanza, devuelve `null`; `call-disposition` sigue devolviendo 200 con `lead.commitment===null` |
| 10 | Al cerrar como Interesado, el usuario elige tipo de compromiso en el MISMO modal (no 2do paso) | ✓ VERIFIED | `#call-next-commitment-tipo`/`#call-next-commitment-parte` dentro de `#call-next-modal` (public/index.html:1591-1609); mismo botón "Guardar" dispara `call-disposition` con `body.commitment` |
| 11 | Elegir el tipo repropone la fecha según D-06, ajustable con el calendario | ✓ VERIFIED (código) | `commitTipoSelect.onchange` setea `fechaInput.value` con `_commitmentDefaultDate` + `_dtPickerSync` (public/app.js:11407-11423). **Interacción visual no verificada en vivo — ver Human Verification** |
| 12 | El usuario declara explícitamente quién se comprometió (yo/prospecto) | ✓ VERIFIED | Botones `data-parte="yo"`/`data-parte="prospecto"` con preselección por default de tipo y toggle manual (public/app.js:11391-11406) |
| 13 | Desde la ficha del lead se puede cargar y cerrar un compromiso sin marcar ninguna llamada | ✓ VERIFIED | `window._callsSetCommitment`/`window._callsCloseCommitment` llaman `PATCH .../commitment` (no `call-disposition`), sin invocar `_dispoAfterSaved` (public/app.js:7777-7832) |
| 14 | Al guardar, el aviso de destino nombra la sección de compromisos de Hoy, no un lugar genérico | ✓ VERIFIED | Rama nueva en `_dispoDestination` (bloque `[30-03] DISPO-DEST`, public/app.js:8914-8942) antes de la rama `interesado`; textos literales `Hoy → Mis compromisos` / `Hoy → Esperando del prospecto` |
| 15 | Desde Hoy el usuario ve, en cualquier momento, compromisos propios pendientes y qué espera del prospecto (D-10, ROADMAP SC4) | ✓ VERIFIED | `loadHoyView` deriva `misCompromisos`/`compromisosProspecto` vía `_commitmentHoyBucket` y las renderiza con `_hoyRenderSection` (public/app.js:5976-6033) |
| 16 | Los compromisos propios se muestran primero (son deuda propia) | ✓ VERIFIED | `secEl.innerHTML` ordena 'Mis compromisos' antes de 'Esperando del prospecto', antes de Callbacks/Interesados (public/app.js:6031-6036) |
| 17 | Un compromiso vencido sigue visible y marcado como vencido — no desaparece | ✓ VERIFIED | `_commitmentHoyBucket` filtra por estado ALMACENADO (`pendiente`), no por el derivado — un vencido sigue con `estado:'pendiente'` y sigue en el bucket 'yo'; `_hoyCommitBadge` marca "vencido" con `var(--warning)` |
| 18 | El compromiso cerrado queda en el historial del lead con su fecha de cierre (D-11) | ✓ VERIFIED | `_renderCallHistory` agrega evento `kind:'commitment'` cuando `estado!=='pendiente' && closedAt` (public/app.js:10030-10045); detalle enriquecido en `_callsRenderExpandedPanel` con `dueAt`+`closedAt`+`closedBy` |

**Score:** 18/18 truths verificadas a nivel de código. El comportamiento VISUAL/interactivo de varias de ellas (11, 14, 17, 18 en particular) no fue confirmado en un browser real — ver sección "Human Verification Required".

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `index.js` (bloque COMPROMISOS) | Whitelists, mapa D-06, `_sanitizeCommitment`/`_setCommitment`/`_closeCommitment`, default `lead.commitment` | ✓ VERIFIED | Líneas 11217-11458; guard `undefined` en `ensureLeadDefaults` línea 663, después del guard de `nextAction` (línea 657) |
| `index.js` (`call-disposition` + `PATCH .../commitment`) | `commitment` aceptado en disposición; endpoint nuevo | ✓ VERIFIED | Destructuring línea 11805, `cleanCommitment` línea 11819, aplicación línea 11700-11714; endpoint líneas 10380-10430, posicionado entre `/followup` (10294) y `/bulk` (10435) |
| `public/app.js` (bloque `[31-03] COMMITMENT-PURE`) | Helpers puros + wiring del modal + ficha + destino | ✓ VERIFIED | Marcadores líneas 11684/11803; `openNextStepModal` extendido líneas 11347-11497; bloque "Compromiso" de la ficha líneas 8100-8191; handlers `_callsSetCommitment`/`_callsCloseCommitment` líneas 7777-7832 |
| `public/index.html` | Controles del modal + cache-buster bumpeado | ✓ VERIFIED | `#call-next-commitment-tipo` (7 opciones literales) + `#call-next-commitment-parte` líneas 1591-1609; `app.js?v=20260815g` (línea 3678), `style.css?v=20260815f` sin tocar (línea 14) |
| `public/app.js` (secciones Hoy + timeline) | "Mis compromisos"/"Esperando del prospecto" + evento en timeline | ✓ VERIFIED | `loadHoyView` líneas 5976-6036; `_hoyRenderSection` con `opts.rowBadge` línea 6106; `_renderCallHistory` con `kind:'commitment'` líneas 10030-10077 |
| `tests/commitment-model.test.js` | Cobertura pura del modelo | ✓ VERIFIED | 316 líneas, 35 tests (dentro de la corrida combinada de 147) |
| `tests/commitment-endpoints.test.js` | Cobertura HTTP de los 2 caminos | ✓ VERIFIED | 341 líneas, 24 tests, incluye caso 401 sin cookie |
| `tests/commitment-ui.test.js` | Bloque puro + fuente del cableado | ✓ VERIFIED | 474 líneas, 46 tests |
| `tests/commitment-hoy.test.js` | Bucket de Hoy + evento de timeline | ✓ VERIFIED | 389 líneas, 42 tests |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `_setCommitment` | `_setNextAction` | `origen:'compromiso'` | ✓ WIRED | index.js:11410-11417 |
| `_closeCommitment` | `_clearNextAction` | guard `origen==='compromiso'` | ✓ WIRED | index.js:11436 |
| `ensureLeadDefaults` | `lead.commitment` | guard `undefined` | ✓ WIRED | index.js:663 |
| `POST call-disposition` | `_applyCallOutcome` | `opts.commitment` sanitizado | ✓ WIRED | index.js:11958 (`commitment: cleanCommitment,`) |
| `_applyCallOutcome` | `_setCommitment` | entre override y red de seguridad | ✓ WIRED | index.js:11700-11714, entre línea 11686 (override) y 11723 (GATE-01) |
| `PATCH .../commitment` | `_setCommitment`/`_closeCommitment` | 2 acciones por body | ✓ WIRED | index.js:10400/10412 |
| `openNextStepModal` | `POST call-disposition` | `body.commitment` | ✓ WIRED | public/app.js:11459-11465 (`body.commitment = {...}`, funcionalmente equivalente al patrón documentado) |
| `window._callsSetCommitment`/`_callsCloseCommitment` | `PATCH .../commitment` | fetch + `_leadStoreApply` + `_refreshLeadPanels` | ✓ WIRED | public/app.js:7789/7812, ambos con `finally { _refreshLeadPanels(leadId); }` |
| `_dispoDestination` | `lead.commitment` | rama antes de `interesado` | ✓ WIRED | public/app.js:8921-8942 |
| `loadHoyView` | `_commitmentHoyBucket` | filtro client-side | ✓ WIRED | public/app.js:5983-5986 |
| `_hoyRenderSection` | `opts.rowBadge` | badge opcional por fila | ✓ WIRED | public/app.js:6106-6155, backward-compatible (default `{}`) |
| `_renderCallHistory` | `lead.commitment` | 3er `kind:'commitment'` | ✓ WIRED | public/app.js:10037-10045 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| Sección "Mis compromisos" de Hoy | `misCompromisos` | `GET /api/setters/leads/sin-wsp?include=callable` → `ensureLeadDefaults` inicializa `lead.commitment` en cada load | Sí — el array viene del mismo endpoint real que ya usa Llamadas/Hoy, con scoping de Phase 18 (`_visibleSetterIds`) | ✓ FLOWING |
| Bloque "Compromiso" de la ficha | `l.commitment` | Mismo array de arriba (no hay fetch propio) | Sí | ✓ FLOWING |
| Chip de compromiso en `_expChips` | `l.commitment` | Idem | Sí | ✓ FLOWING |
| Timeline (`_renderCallHistory`) | `lead.commitment` | Objeto lead pasado por el caller (mismo lead cargado) | Sí | ✓ FLOWING |

No se detectaron props hardcodeadas vacías ni fetches con retorno estático — todo el dato fluye desde `lead.commitment`, que a su vez se persiste real en `setters.json` vía `saveSettersData`.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Suite completa del repo | `npm test` | 96 test files, **1512/1512 passed** en 35.53s | ✓ PASS |
| Suites específicas de la fase | `npx vitest run tests/commitment-{model,endpoints,ui,hoy}.test.js` | **147/147 passed** (35+24+46+42, coincide exacto con lo declarado por cada SUMMARY) | ✓ PASS |
| `node --check index.js` | — | Exit 0 (implícito: el server bootea en los tests) | ✓ PASS |
| `node --check public/app.js` | — | Sin errores de sintaxis (tests que hacen `new Function` sobre el bloque puro pasan) | ✓ PASS |
| No hay extracción automática desde transcripción (D-12) | `grep -n "commitmentFromTranscript\|_extractCommitment" index.js public/app.js` | Sin resultados | ✓ PASS |
| `tests/metrics-consistency.test.js` no fue tocado por la fase | `git log --oneline -- tests/metrics-consistency.test.js` | Últimos commits son de fases previas (5a0c66d, 1345ab7, b5a0074, 8174fab, fa62714), ninguno de Phase 31 | ✓ PASS |

### Probe Execution

No aplica — esta fase no declara probes (`scripts/*/tests/probe-*.sh`) ni el PLAN/SUMMARY los menciona. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| COMM-01 | 31-01 | Compromisos hablados como objeto (tipo/parte/canal/dueAt/estado) | ✓ SATISFIED | `lead.commitment` + whitelists (index.js:11217-11268) |
| COMM-02 | 31-01, 31-02 | Compromiso pendiente setea `nextAction` | ✓ SATISFIED | `_setCommitment` → `_setNextAction` (index.js:11410-11417) |
| COMM-03 | 31-01, 31-03 | Distinción yo/prospecto | ✓ SATISFIED | `COMMITMENT_PARTES`, toggle en modal, botones "Cumplido"/"No cumplió"/"Ya no aplica" según parte |
| COMM-04 | 31-04 | Consulta en cualquier momento de a quién le mandó info / qué falta responder | ✓ SATISFIED | Secciones de Hoy + `_commitmentHoyBucket` (caso "ya mandé, espero respuesta") + timeline del lead |

No hay requirements ORPHANED — `REQUIREMENTS.md` mapea exactamente COMM-01..04 a Phase 31, y los 4 están marcados `[x]` con evidencia de código real (no solo el checkbox).

### Anti-Patterns Found

Ninguno bloqueante. Escaneo de `TBD|FIXME|XXX` y patrones de stub (`return null`, props vacías hardcodeadas) sobre las líneas modificadas por la fase: sin resultados relacionados con compromisos. No se encontraron colores hardcodeados (`#hex`) dentro de los bloques nuevos de `public/app.js`/`public/index.html` — todo usa tokens (`var(--accent)`, `var(--warning)`, `var(--accent-soft)`, `var(--on-accent)`, `var(--font-mono)` + `tabular-nums`), consistente con la regla de marca de CLAUDE.md.

**ℹ️ Info:** Los SUMMARY de 31-03 y 31-04 documentan honestamente 2 bugs reales encontrados y arreglados durante la propia ejecución (no dejados sin resolver):
1. `escHtml(c.motivo)` faltante en una condición ternaria (31-03 Task 3, commit `c10dba4`).
2. Branching abierto/cerrado del bloque "Compromiso" usando el estado DERIVADO en vez del ALMACENADO — un compromiso cerrado con "Ya no aplica" quedaba mostrando la tarjeta editable para siempre (31-04 Task 2, commit `e7e7942`). Verificado en el código actual que el fix (`_commitRaw` vs `_commitEstado`) está presente y es correcto (public/app.js:8119-8191, 7996-8013).

### Human Verification Required

Ver la sección `human_verification` del frontmatter — 10 items. Ninguno de estos boquea la conclusión de que el código está correctamente implementado y wireado (todos son verificaciones de comportamiento VISUAL/interactivo en browser real, explícitamente señaladas como pendientes por los propios SUMMARY de 31-03 y 31-04, "no hay browser en el entorno"). El más relevante para re-chequear con prioridad es el ítem 5 (cierre "Ya no aplica" mostrando la línea compacta en vez de la tarjeta editable), porque es la rama que un bug real tocó durante la ejecución — el fix está en el código pero no fue confirmado con un click real.

### Gaps Summary

No se encontraron gaps de código. Los 18 truths derivados de ROADMAP + los 4 PLAN frontmatters están verificados contra el código real (no contra lo que los SUMMARY narran): el modelo del compromiso existe y está bien encapsulado (whitelist-and-coerce, un único punto de escritura del reloj vía `_setNextAction`/`_clearNextAction`), los dos caminos de carga (`call-disposition` y `PATCH .../commitment`) están cableados con los mismos guards de auth/visibilidad que el resto del proyecto, la UI expone el selector dentro del modal existente (sin fricción de un segundo paso) y un bloque editable en la ficha, y Hoy + el timeline del lead responden literalmente a COMM-04. La suite de tests de la fase (147 tests) y la suite completa (1512/1512) pasan sin fallos, el working tree está limpio, y el cache-buster de `app.js`/`style.css`/`wa.js` es consistente entre sí y con lo que dejó `31-04-SUMMARY.md`.

La única razón para no marcar `passed` es que hay una lista concreta de comportamientos visuales/interactivos (apertura de modal, repropuesta de fecha en vivo, badges, refresco de la ficha) que el propio equipo de ejecución documentó como NO verificados en un browser real — el entorno de ejecución no tiene uno. Esto no es evidencia de que algo esté roto; es la brecha honesta entre "el código está bien" y "se vio funcionar en pantalla", y corresponde a un gate humano, no a un gap de implementación.

---

*Verified: 2026-08-15*
*Verifier: Claude (gsd-verifier)*
