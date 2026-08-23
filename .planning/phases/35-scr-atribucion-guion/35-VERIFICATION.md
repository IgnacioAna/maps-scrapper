---
phase: 35-scr-atribucion-guion
verified: 2026-08-22T22:16:01Z
status: human_needed
score: 12/12 must-haves verificados a nivel de código; 2 items requieren verificación humana (el 3ro lo cerró el orquestador en el navegador)
overrides_applied: 0
human_verification:
  - test: "Abrir Llamadas/Hoy/Power Dialer/ficha en modal en el navegador con el banco real de guiones (30 en producción) y confirmar que el `<select>` de guion se ve bien: no desborda la fila, agrupa por trigger, y sobre el fondo oscuro del panel de llamada (`variant:'call'`) el texto es legible."
    expected: "El selector entra en las 4 filas sin romper el layout ni empujar los botones de resultado a otra línea; en el panel de llamada se lee sobre el fondo oscuro."
    why_human: "Requiere renderizado real en navegador (CSS, overflow, contraste). El entorno de este verificador no tiene browser; los SUMMARY documentan que esto quedó explícitamente sin verificar en vivo."
  - test: "Hacer una llamada real por Telnyx WebRTC desde el Power Dialer o Llamadas y confirmar en vivo: (a) el lead queda con guion sembrado sin tocar nada, (b) el selector del panel de llamada lo muestra, (c) cambiar de guion en el selector reemplaza y abrir otro guion en el panel de guiones flotante suma, (d) al cerrar la disposición el guion persiste en `callLog` con el flag `scriptIdsAuto` correcto."
    expected: "El entry del callLog de esa llamada trae `scriptIdsUsed` (con o sin `scriptIdsAuto`, según si se tocó algo) sin que el SDR haya abierto el panel de guiones."
    why_human: "WebRTC + micrófono real no se pueden simular en este entorno de ejecución. Verificado en su lugar: el bloque real extraído por marcadores ejecutado contra streams/servidor simulados, y la suite de tests HTTP/comportamiento — pero no el flujo end-to-end con una llamada telefónica real."
  - test: "Con dos o más filas de la lista de Llamadas abiertas a la vez, cambiar el guion en la fila de un lead y confirmar que el `<select>` de otro lead en pantalla NO cambia (aislamiento por `data-lead`)."
    expected: "Cada `<select>` sincroniza solo el lead que declara en `data-lead`; elegir un guion para un lead no afecta a los demás."
    why_human: "Se verificó la lógica con `new Function`/DOM simulado (35-02/35-03 SUMMARY) contra el banco real de 30 guiones, pero no en un DOM de navegador real con eventos `onchange` disparados por el usuario."
---

# Fase 35: SCR — Atribución de guion · Verificación

**Objetivo de la fase:** Toda llamada queda asociada al guion que se usó, sin depender de que el SDR se acuerde de abrir un panel, y corregible después. Sin esto la vista "Guiones de llamada" sigue vacía (0 de 199 llamadas atribuidas al 17/08) y el ciclo de prueba del guion nuevo no puede distinguir un guion de otro.

**Verificado:** 2026-08-22T22:16:01Z
**Estado:** human_needed
**Re-verificación:** No — verificación inicial

## Metodología

Verificación goal-backward: se leyeron los 4 PLAN.md y sus 4 SUMMARY.md, CONTEXT.md, REQUIREMENTS.md y ROADMAP.md, y luego se contrastó cada afirmación contra el código real (`index.js`, `public/app.js`, `public/index.html`, `scripts/coverage-script.mjs`, `package.json`) y contra la ejecución real de comandos: `node --check`, `npm test` completo, `npm run coverage:script -- --days 7`, y lectura directa de los tests nuevos (no solo su nombre). No se confió en ninguna cifra o afirmación de los SUMMARY sin comprobarla contra el archivo fuente o una corrida real.

## Logro del objetivo

### Verdades observables

| # | Verdad | Estado | Evidencia |
|---|--------|--------|-----------|
| 1 | SCR-01 — `_scriptSelectHTML` es un builder único (declarado UNA vez) cableado a las 4 superficies donde ya vive la etapa (Hoy, Power Dialer, ficha en modal, lista de Llamadas) + el panel de llamada de 35-02 — mismo patrón que `_stageChipsHTML` | ✓ VERIFICADO | `public/app.js:10591` (única declaración); call sites en `6519` (Hoy), `7791` (Power Dialer), `9310` (ficha modal, dentro de `opts.withDisposition`), `9731` (lista), `11849` (panel de llamada). Ninguno con `leadId` nulo. |
| 2 | SCR-02 — la llamada nace con un guion atribuido SIN que el SDR toque nada (el último usado por ese SDR, o el opener oficial), y tocar otro lo corrige | ✓ VERIFICADO | `_startTelnyxCall` (`app.js:11842-11843`) llama `_clearCallScript()` + `window._setCallScript(leadId, _scriptDefaultId(), { auto: true })` antes de iniciar la llamada. `_scriptDefaultId()` (`app.js:10536`) implementa la precedencia exacta: último elegido a mano (si sigue en el banco y no es meta) → primer `opener` → primer no-meta → `''`. |
| 3 | El SDR ve el guion atribuido durante la llamada y puede corregirlo desde el panel de llamada sin abrir el panel de guiones | ✓ VERIFICADO (código) / pendiente visual | `#telnyx-call-script-wrap` en `index.html:1468`, poblado en `_startTelnyxCall` (`app.js:11847-11851`) con `_scriptSelectHTML(leadId, {variant:'call', ...})`, vaciado en `_closeTelnyxCallPanel` (`app.js:11548-11549`). Ver ítem de verificación humana #1. |
| 4 | Cambiar de guion desde el panel de guiones flotante SUMA (D-03); elegirlo desde un selector REEMPLAZA | ✓ VERIFICADO | `_selectScript` (`app.js:12395-12409`) llama `_setCallScript(..., {append:true, auto:...})`; `_scriptSelectHTML` genera `onchange="window._setCallScript('<id>', this.value)"` (sin `append`) → reemplaza. `window._setCallScript` (`app.js:10494-10524`) implementa ambos modos explícitamente. |
| 5 | SCR-03 — la atribución se puede cargar o corregir DESPUÉS de cerrada la llamada, desde la ficha y desde la lista | ✓ VERIFICADO | 4 call sites confirmados (ver #1); todos inmediatamente antes del selector de resultado (`_dispoSelectHTML`), verificado por índice de string: lista `idxScript < idxDispo`, distancia < 400 chars (test `script-attribution-surfaces.test.js` + inspección manual). La ficha embebida (chevron, sin `withDisposition`) sigue SIN el control — intencional, mismo criterio que `callStage`. |
| 6 | La atribución viaja desde CUALQUIER superficie por `_dispoEnforcementBody`, el helper compartido por los 6 call sites de `call-disposition` | ✓ VERIFICADO | `_dispoEnforcementBody` (`app.js:10642-10665`) inyecta `body.scriptIdsUsed`/`body.scriptIdsAuto` leyendo `_scriptIdsFor`/`_scriptIsAuto` del estado único `_dispoScript`. |
| 7 | Hay un solo estado de atribución en el frontend — `_telnyxCallState.scriptIdsUsed` ya no existe | ✓ VERIFICADO | `grep -c "_telnyxCallState.scriptIdsUsed" public/app.js` → 0. El estado vive solo en `_dispoScript` (bloque `[35-02] SCR-ATTR`, `app.js:10425-10640`). |
| 8 | Backend: una disposición marcada desde CUALQUIER superficie (sin `telnyxCallMeta`) puede atribuir guion | ✓ VERIFICADO | `index.js:12774` destructura `scriptIdsUsed`/`scriptIdsAuto` del nivel superior del body; `index.js:12878-12901` los une con `telnyxCallMeta.scriptIdsUsed` y persiste. Test `script-attribution.test.js` ("aceptación desde el body") pasa. |
| 9 | Backend gate: un id de guion que NO está en el banco (`data/call_scripts.json`) no se persiste | ✓ VERIFICADO | `_sanitizeScriptIds` (`index.js:12738-12751`) filtra contra `_knownScriptIds()`. Test "whitelist contra el banco real" (2 casos: mixto y todos desconocidos) pasa. |
| 10 | Backend gate: una llamada que nadie atendió NO puede quedar atribuida a un guion | ✓ VERIFICADO | `SCRIPT_RELEVANT_OUTCOMES.has(outcome)` (`index.js:12882`), mismo set de 6 outcomes que `CALL_STAGE_RELEVANT_OUTCOMES`, declarado como Set propio (no alias). Tests de gate (`no_answer`, `voicemail`) confirman que NO se persiste `scriptIdsUsed`. |
| 11 | `scriptIdsAuto` distingue lo atribuido por el sistema de lo elegido por una persona, y sobrevive a la corrección de una auto-marca | ✓ VERIFICADO | `index.js:12889-12899` resuelve el flag (gana el body sobre `telnyxCallMeta`); `'scriptIdsAuto'` está en la lista de campos heredados en corrección (`index.js:12956`). Test "herencia en corrección de auto-marca" pasa. |
| 12 | SCR-04 — existe `npm run coverage:script -- --days 7`, con ventana default 7 días (no 30, D-01) y split auto vs manual | ✓ VERIFICADO | `scripts/coverage-script.mjs:45` (`parseInt(argOf('--days') || '7', 10)`); `package.json:18` (`"coverage:script": "node scripts/coverage-script.mjs"`). Ejecutado en vivo: `npm run coverage:script -- --days 7` corre y responde exactamente el formato esperado, recortando al `DEPLOY_ISO` cuando corresponde. |

**Puntaje:** 12/12 verdades verificadas a nivel de código y ejecución de comandos. 3 ítems adicionales (visual/en vivo con WebRTC real) quedan para verificación humana — ver sección dedicada.

### Artefactos requeridos

| Artefacto | Esperado | Estado | Detalle |
|-----------|----------|--------|---------|
| `index.js` | `SCRIPT_RELEVANT_OUTCOMES` + `_sanitizeScriptIds` + `_knownScriptIds` + persistencia unificada + split auto/manual en `script-effectiveness` | ✓ VERIFICADO | Todo presente, línea por línea, en `12696-12754` (contrato) y `19967-20081` (cobertura). `node --check index.js` limpio. |
| `public/app.js` | Bloque `[35-02] SCR-ATTR` + captura automática + 4 call sites del selector | ✓ VERIFICADO | Bloque entre marcadores `10425-10640`; siembra en `_startTelnyxCall`; 5 call sites totales de `_scriptSelectHTML` (4 superficies de 35-03 + panel de llamada de 35-02) + 1 declaración = 6 ocurrencias. `node --check public/app.js` limpio. |
| `public/index.html` | `#telnyx-call-script-wrap` + cache-buster bumpeado | ✓ VERIFICADO | `telnyx-call-script-wrap` en línea 1468; `app.js?v=20260822b` (antes `20260817d`); `style.css?v=20260816f` intacto (no tocado por esta fase, confirmado con `git diff`). |
| `scripts/coverage-script.mjs` | CLI de cobertura con `--days`/`--all`/`--file`/`--json` | ✓ VERIFICADO | 234 líneas, ejecutado en vivo con éxito (JSON válido con `--json`, texto legible sin flag). |
| `package.json` | `coverage:script` en el bloque `scripts` | ✓ VERIFICADO | Línea 18, junto a `coverage:callstage`. `git diff --stat package-lock.json` vacío (nada instalado). |
| `tests/script-attribution.test.js` | Suite HTTP del contrato backend | ✓ VERIFICADO | 14 tests, todos verdes, cubren los 9 comportamientos incluyendo los 2 gates explícitos del pedido de verificación. |
| `tests/script-attribution-core.test.js` | Tests de fuente + comportamiento aislado del bloque SCR-ATTR | ✓ VERIFICADO | 27 tests verdes, extraídos por marcadores del archivo REAL (no una copia). |
| `tests/script-attribution-surfaces.test.js` | Tests de fuente de las 4 superficies + banner | ✓ VERIFICADO | 11 tests verdes, incluida la adyacencia (guion antes del resultado) y la regresión de los 4 call sites de `_stageChipsHTML`. |
| `tests/coverage-script.test.js` | Suite del CLI contra snapshot fixture | ✓ VERIFICADO | 18 tests verdes, primer test del repo que spawnea un script real via `execFileSync` (patrón documentado en la cabecera del archivo). |

### Verificación del link clave (wiring)

| De | A | Vía | Estado | Detalle |
|----|---|-----|--------|---------|
| `_startTelnyxCall` | `window._setCallScript(leadId, _scriptDefaultId(), {auto:true})` | Siembra automática al iniciar la llamada | ✓ WIRED | Confirmado en código (`app.js:11842-11843`) y en re-siembra tardía si el banco no estaba en cache (`app.js:11857-11861`, solo si el lead sigue sin atribución). |
| `_dispoEnforcementBody` | `body.scriptIdsUsed`/`body.scriptIdsAuto` | Contrato de 35-01 inyectado en el helper compartido | ✓ WIRED | `app.js:10649-10653`. Usado por los 6 call sites de `call-disposition` (verificado con `grep -n "_dispoEnforcementBody(leadId)"` → 5 usos + la declaración). |
| `_selectScript` | `window._setCallScript(..., {append:true})` | El panel de guiones deja de escribir su propio array | ✓ WIRED | `app.js:12408`. Test de fuente confirma `.scriptIdsUsed.push(` ya NO existe en `_selectScript`. |
| `renderCallsList`/`_hoyRenderSection`/`_pdRender`/`_callsRenderExpandedPanel` | `_scriptSelectHTML(leadId, ...)` | Un builder, cuatro call sites | ✓ WIRED | Confirmado por línea exacta en las 4 funciones (ver tabla de artefactos). |
| `loadCallsView`/`loadHoyView` | `_ensureCallScripts()` | El banco se carga al abrir la vista, no recién en la primera llamada | ✓ WIRED | `app.js:6220` y `app.js:6680`, ambas fire-and-forget (sin `await`), confirmado dentro del cuerpo de cada función. |
| `coverage.withScriptsManual` (35-01) | Banner de la vista "Guiones de llamada" | El número que distingue "nadie eligió" de "el guion no funciona" | ✓ WIRED | `_loadScriptMeasure` (`app.js:22172-22225`) contiene `withScriptsManual`, ya NO contiene la frase vieja "se registra cuando se abre desde el panel", y la condición de mostrar el bloque de guion es independiente de la de etapa (`!cov.calls`, no `cov.withStagePct`). |
| `callLog[].scriptIdsUsed/scriptIdsAuto` (35-01) | `scripts/coverage-script.mjs` | Mismas listas de outcomes relevantes, copiadas con nota de sincronía | ✓ WIRED | `RELEVANT` (línea 67-68 del script) es idéntico a `SCRIPT_RELEVANT_OUTCOMES` de `index.js`, con comentario explícito de "si allá cambian, cambiar acá". |

### Ejecución de comandos (evidencia directa, no confiada al SUMMARY)

| Comando | Resultado |
|---------|-----------|
| `node --check index.js` | OK |
| `node --check public/app.js` | OK |
| `npx vitest run tests/script-attribution.test.js tests/script-attribution-core.test.js tests/script-attribution-surfaces.test.js tests/coverage-script.test.js` | 4 archivos, 70 tests, 70 pasando |
| `npm test` (suite completa) | **117 archivos, 2054 tests, 2054 pasando** — coincide exactamente con el baseline que reporta `35-04-SUMMARY.md` |
| `node scripts/coverage-script.mjs --days 7 --file data/setters.json` | Corre y responde correctamente: recorta la ventana al `DEPLOY_ISO` (2026-08-22T18:37:47-03:00) porque el snapshot local es anterior al deploy; "Sin llamadas en la ventana: no hay muestra para concluir nada" — comportamiento honesto por diseño (D-01), no un bug |
| `npm run coverage:script -- --days 7` | Passthrough de flags funciona — la forma EXACTA que pide SCR-04 |
| `grep -c "_telnyxCallState.scriptIdsUsed" public/app.js` | 0 |
| `git diff 99349bc..HEAD --stat` (archivos tocados por la fase) | `index.js` +130/−?, `public/app.js` +372, `public/index.html` +14/−2, `scripts/coverage-script.mjs` +234 (nuevo), `package.json` +3/−1 — sin sorpresas, coincide con `files_modified` de los 4 PLAN.md |
| `git log --oneline` | Los 12 commits de tasks + los 4 commits de metadata de plan (`0680249`, `67abff3`, `b441647`, `d7f1e49`, `26d3e2c`, `93261fb`, `80c4e86`, `13cb6aa`, `f4b7dfa`, `dd58102`, `d9d2e30`, `ac8c79a`, `2da5fe8`) todos presentes en `main` |

### Cobertura de requisitos

| Requisito | Plan(es) | Descripción | Estado | Evidencia |
|-----------|----------|-------------|--------|-----------|
| SCR-01 | 35-01 (backend), 35-02 (builder), 35-03 (4 superficies) | El guion se marca en las 4 superficies con un builder único | ✓ SATISFECHO | Ver verdad #1 y #5 |
| SCR-02 | 35-01 (contrato), 35-02 (siembra) | La llamada nace con guion atribuido sin tocar nada, corregible | ✓ SATISFECHO | Ver verdad #2, #3, #4 |
| SCR-03 | 35-01 (contrato), 35-03 (superficies) | Corregible después de cerrada la llamada, desde ficha y lista | ✓ SATISFECHO | Ver verdad #5 |
| SCR-04 | 35-01 (datos), 35-04 (CLI) | `npm run coverage:script -- --days 7` existe y funciona | ✓ SATISFECHO | Ver verdad #12, ejecución de comandos |

REQUIREMENTS.md marca los 4 IDs como `[x]` con nota de qué plan los cerró — consistente con lo verificado. No hay requisitos huérfanos: la tabla de trazabilidad (`REQUIREMENTS.md` línea 452) mapea exactamente `SCR-01, SCR-02, SCR-03, SCR-04` a la fase 35, y los 4 IDs aparecen distribuidos en el frontmatter `requirements:` de los 4 planes sin faltantes.

### Anti-patrones encontrados

Ninguno. No se encontraron marcadores `TBD`/`FIXME`/`XXX` de deuda en el código tocado por esta fase (las únicas ocurrencias de "XXX" en `index.js`/`public/app.js` son placeholders de formato de número telefónico en comentarios preexistentes, no relacionados con esta fase). No hay `return null`/`console.log`-only/handlers vacíos en el código nuevo — cada función revisada tiene implementación completa y consistente con su documentación inline.

### Trazado de flujo de datos (Nivel 4)

- **Siembra → panel de llamada → `callLog`**: `_scriptDefaultId()` lee `_callScriptsCache` (poblado por `_loadCallScripts()` desde `GET /api/telnyx/scripts`, que a su vez lee `data/call_scripts.json`) — no hay datos hardcodeados ni vacíos en la cadena. El id sembrado se refleja en el `<select>` del panel de llamada vía `_scriptSelectHTML` (mismo estado `_dispoScript`), y viaja al backend vía `_dispoEnforcementBody` en cualquiera de los 6 call sites de `call-disposition`. El backend lo vuelve a validar contra `data/call_scripts.json` real (no confía en el cliente) antes de persistir.
- **Banner de cobertura**: `coverage.withScripts`/`withScriptsManual` se calculan sobre `Object.values(settersData.leads)` reales (no un stub), filtrando `channel==='telnyx_webrtc'` — confirmado en `index.js:19982-20031`.
- No se detectaron props ni datos hardcodeados en vacío en el camino crítico.

## Verificación humana requerida

Ver frontmatter `human_verification`. Resumen:

### 1. Renderizado visual del selector en las 4 superficies + panel de llamada

**Test:** Abrir Llamadas/Hoy/Power Dialer/ficha en modal en el navegador con el banco real de guiones (30 en producción).
**Esperado:** El selector entra en cada fila sin romper el layout ni empujar los botones de resultado a otra línea; se lee bien sobre el fondo oscuro del panel de llamada.
**Por qué humano:** Requiere renderizado CSS real en navegador. Este entorno de verificación no tiene browser.

### 2. Flujo end-to-end con una llamada Telnyx real

**Test:** Hacer una llamada real por WebRTC y confirmar que el lead nace con guion sembrado, que el panel lo muestra, que corregirlo desde el selector reemplaza y desde el panel de guiones suma, y que la disposición final persiste `scriptIdsUsed`/`scriptIdsAuto` correctamente.
**Esperado:** El entry del `callLog` de esa llamada trae `scriptIdsUsed` sin que el SDR haya tocado nada, y el flag `scriptIdsAuto` refleja si hubo o no una elección humana.
**Por qué humano:** WebRTC + micrófono real no se pueden simular en este entorno. La cadena fue verificada por partes (código real ejecutado aislado con `new Function`, tests HTTP contra el servidor real, pero no un round-trip con una llamada telefónica real).

### 3. Aislamiento por lead entre selectores en pantalla — ✅ CERRADO por el orquestador (2026-08-22)

**Test:** Con varias filas abiertas, cambiar el guion de una fila y confirmar que otra fila no cambia.
**Resultado:** VERIFICADO en el navegador del preview, con el servidor real corriendo contra `tmp/preview-data`
(50 filas renderizadas, 50 `select.script-select`, cero ids duplicados). Se disparó un
`new Event('change')` real sobre la primera fila: quedó en `opener_decisor` y las filas 2 y 3
siguieron en `''`. Ya no requiere verificación humana.

## Verificación en vivo del orquestador (2026-08-22, posterior al informe)

El verificador no tiene acceso al navegador; el orquestador sí. Se levantó el preview
(`DATA_DIR=tmp/preview-data`) con sesión de admin real y se comprobó contra el **servidor
corriendo**, no contra los tests:

| Comprobación | Resultado |
|---|---|
| `app.js` servido con el cache-buster nuevo | ✓ `?v=20260822b` |
| Selector en la lista de Llamadas | ✓ 50 filas → 50 `select.script-select`, 27 opciones en 10 optgroups por trigger, sin ids duplicados (identifica por `data-lead`) |
| Aislamiento entre leads | ✓ `change` real en la fila 1 no tocó las filas 2 y 3 |
| **Whitelist del banco (backend, en vivo)** | ✓ `POST call-disposition` con `['opener_decisor','guion_que_no_existe']` en una llamada atendida → persistió **solo** `opener_decisor` |
| **Gate de outcome (backend, en vivo)** | ✓ el mismo POST con `outcome:'no_answer'` y un guion válido → `scriptIdsUsed` **ausente** en el `callLog` |

Las dos últimas filas son la prueba end-to-end del contrato de 35-01 contra el servidor real,
más fuerte que la cobertura de tests: el dato se leyó del `setters.json` del preview después
del POST.

**No verificable en este entorno:** el viewport del preview reporta `0×0` (glitch conocido de
este runtime, documentado en CLAUDE.md #114/#124), así que toda medición de layout/CSS da
falsos positivos de desborde. La verificación visual sigue siendo humana.

## Resumen de brechas (gaps)

Ninguna. Todos los must-haves de los 4 planes, todos los Success Criteria de ROADMAP.md (SCR-01 a SCR-04), y el gate de backend explícitamente pedido en esta verificación (llamada sin atender no puede llevar atribución; id fuera del banco no persiste) están implementados, cableados y cubiertos por tests que se ejecutaron y pasaron en este momento (no solo se leyeron). La suite completa (117 archivos, 2054 tests) corre sin fallos ni regresiones. El único motivo por el que el estado no es `passed` es que quedan 3 verificaciones que requieren navegador o una llamada telefónica real — explícitamente fuera del alcance de este entorno y ya documentadas como tales en los propios SUMMARY de 35-02/35-03.

Nota operativa (no es una brecha): la primera medición real de `npm run coverage:script -- --days 7` sobre `data/` da 0 porque el snapshot local es anterior al deploy de la siembra automática (`2026-08-22T18:37:47-03:00`). Esto es el comportamiento diseñado por D-01 (nunca reportar 0% como si fuera una medición real de algo que no pudo pasar) — para tener una medición con datos reales hace falta correr `npm run pre-deploy` después de una tanda de llamadas en producción posteriores al deploy.

---

*Verificado: 2026-08-22T22:16:01Z*
*Verificador: Claude (gsd-verifier)*
