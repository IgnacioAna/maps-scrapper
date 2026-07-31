---
phase: 26-agente-retell-piloto
plan: 01
subsystem: docs
tags: [retell, voice-agent, prompt, post-call-analysis, custom-function, webhook]

# Dependency graph
requires:
  - phase: 24-03
    provides: "_retellDynamicVariables — las 10 variables exactas que el dispatch manda en cada create-phone-call"
  - phase: 24-04
    provides: "POST /api/retell/tool/book (auth x-scm-tool-secret, idempotencia por call_id) y POST /api/retell/webhook (firma HMAC) — los dos contratos que el documento instruye a configurar"
  - phase: 24-05
    provides: "_retellDecideOutcome + RETELL_DISCONNECT_OUTCOME + el mutator de extracción — el vocabulario de los 9 campos y la precedencia de decisión del resultado"
provides:
  - "docs/retell-agent-v1.md Parte A — encabezado, registro de versiones, Global Settings, global prompt, 10 variables dinámicas, 9 campos de Post Call Data Extraction, tool `book`, webhook y tabla disconnection_reason → resultado"
  - "Los 5 encabezados reservados (`Mapa del flow`, `Nodos`, `Global Nodes`, `Tabla de transiciones`, `Checklist de carga`) con marcador `<!-- 26-02 -->` para que la Parte B se escriba sin reordenar nada"
affects: [26-02, 26-04, 26-05, 26-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Documento-como-fuente-de-verdad de una config que vive en un dashboard de terceros: el repo versiona el contenido, el dashboard es el deploy (D-26-05). Mismo espíritu que scripts/seed/call-scripts.json + el botón 'Recargar oficial v2', pero sin endpoint de carga: acá el transporte es manual."
    - "Secretos referenciados por NOMBRE DE ENV VAR de Railway, nunca por valor — extensión a docs/ de la política que index.js ya aplica con TELNYX_ENV_FIELDS / RETELL_ENV_FIELDS."

key-files:
  created:
    - docs/retell-agent-v1.md
  modified: []

key-decisions:
  - "El documento se escribe con ortografía española correcta (tildes incluidas), lo que hace que dos greps literales de las acceptance criteria del plan no matcheen tal cual: 'Que cambio' (columna del registro de versiones) y 'como va su dia' (frase prohibida del global prompt). Se verificó con la forma acentuada ('Qué cambió', 'cómo va su día'): el contenido que el criterio quería garantizar está presente. Quien re-verifique esta fase tiene que usar el grep acentuado."
  - "`{{agent_name}}` se documenta explícitamente como marcador DEL DOCUMENTO, no como variable dinámica de Retell: el dispatch manda 10 variables y `agent_name` no está entre ellas, así que publicado tal cual renderiza vacío. El checklist de carga (Parte B) tiene que exigir el reemplazo por el nombre literal antes de publicar."
  - "El global prompt fija trato de USTED y prohíbe modismos rioplatenses. El documento lo escribe un rioplatense y el piloto es México: sin la instrucción explícita, el LLM tiende a copiar el registro del prompt en el habla."
  - "No se nombra la empresa en el prompt ni en las líneas del gatekeeper (el research del milestone §3/§4 sí la nombraba). Se siguió el plan, que la había removido — coherente con la política anti-marca del proyecto (nota #119) y con los mensajes que /book ya devuelve sin marca."
  - "La sección de resultados incluye `user_declined` → 'me cortó', que el bloque <interfaces> del plan no listaba: se leyó RETELL_DISCONNECT_OUTCOME completo en index.js:16733 en vez de confiar en el resumen."
  - "Se documentó la PRECEDENCIA real con que el backend decide el resultado (book/agendo → disconnection_reason → callback → interes → fallback IA), leída de _retellDecideOutcome. El plan describía los campos uno por uno pero no el orden, y el orden importa: un `disconnection_reason` mapeado gana sobre la extracción."
  - "El motivo del toggle 'args only' se escribió como `call_id` (idempotencia + coordinación con el webhook), NO como parseo del `leadId`. Verificado contra el endpoint real: lee leadId de args como tercer fallback, así que en modo args-only el lead SÍ se resolvería — lo que se rompe es la deduplicación. El research §4 lo tenía al revés."

patterns-established:
  - "Avisos de contrato en blockquote con ⚠️/🚨 para los tres errores que fallan en SILENCIO (nombre de variable inexistente, DNC no estructurado, fecha relativa): son los que no dan error y solo se descubren semanas después con leads mal tratados."

requirements-completed: [VOICE-08]

# Metrics
duration: 35min
completed: 2026-07-31
---

# Phase 26-01: Parte A del agente cargable — Summary

**El contrato entre el agente de Retell y el backend del SCM quedó escrito campo por campo, con los nombres leídos del código deployado y no del diseño: `{{gancho}}` (no `openingAngle`), `no_contactar` como única vía a DNC, ISO 8601 obligatorio en el callback y `call_id` como la razón real por la que el toggle "args only" va desactivado.**

## Performance

- **Duración:** ~35 min
- **Tareas:** 3 de 3
- **Archivos modificados:** 1 creado (`docs/retell-agent-v1.md`, 438 líneas)
- **Commits:** `b1022c6`, `20b3915`, `5a83aba`

## Accomplishments

### Task 1 — Esqueleto, registro de versiones, Global Settings y global prompt
- Encabezado con la regla dura de secretos: los 3 (`RETELL_API_KEY`,
  `RETELL_WEBHOOK_SECRET`, `RETELL_TOOL_SECRET`) se nombran por su env var de
  Railway y se copian de dashboard a dashboard, nunca al repo.
- Registro de versiones con la mecánica de Retell escrita (la versión se crea
  al **publicar**, no al guardar; una versión publicada no se edita; rollback
  = draft desde una versión vieja).
- 15 Global Settings con valor concreto y una línea de justificación cada uno.
  Los que más importan: `es-419`, GPT 4.1 (con el aviso de no arrancar con un
  modelo nano), Voicemail Detection en "Hang up", IVR Detection ON, max call
  duration 5 min.
- Global prompt completo en español, bajo las ~500 palabras, con las 7
  prohibiciones duras, el esquive del "¿sos un robot?", el diferimiento de
  precio y las 2 frases prohibidas literalmente.

### Task 2 — Variables dinámicas y Post Call Data Extraction
- Tabla de las 10 variables del dispatch con ejemplo, origen y si puede venir
  vacía.
- Los 9 campos de extracción, cada uno con nombre exacto, tipo de Retell,
  `description` lista para pegar, `choices` cuando es enum, y qué hace el
  backend con él.
- El décimo campo (`call_summary`) documentado como built-in que **no** hay
  que definir.
- Los 3 avisos de contrato + la precedencia de decisión del resultado.

### Task 3 — Tool `book`, webhook y tabla de resultados
- Config de la custom function fila por fila, con el toggle "args only"
  desactivado y el bloque que explica por qué (con la señal de alerta:
  reunión ausente o duplicada).
- Los 5 mensajes de `ok:false` transcritos del endpoint real, listos para que
  el nodo posterior los lea en voz alta.
- Webhook con los 2 eventos y el síntoma de firma inválida (401 → la llamada
  no aparece en la biblioteca de Entrenamiento IA).
- Tabla `disconnection_reason` → resultado, con las 2 lecturas operativas
  (cadencia heredada; `marked_as_spam` = número quemado, no agente malo).

## Verification

| Criterio | Resultado |
|---|---|
| Archivo existe, ≥5 encabezados `## ` | 14 encabezados |
| `es-419`, `Voicemail Detection`, `Hang up`, URL del webhook | presentes |
| Registro de versiones con sus 4 columnas | presente (`Qué cambió`, acentuado) |
| Las 2 prohibiciones literales del prompt | presentes (`cómo va su día`, `lo agarré en mal momento`) |
| Exactamente 5 marcadores `<!-- 26-02 -->` | 5 |
| 9 campos + 10 variables + aviso `openingAngle` | ningún `FALTA:` en el loop |
| `x-scm-tool-secret`, `/api/retell/tool/book`, `call_id`, `5000`, `call_ended`, `call_analyzed`, `marked_as_spam` | presentes |
| Cero secretos (`key_…` / `sk-…`) | `NO_SECRETS_OK` |
| min_lines 200 | 438 |

## Deviations

1. **Dos greps de acceptance criteria adaptados por tildes.** `Que cambio` y
   `como va su dia` no matchean porque el documento está escrito con
   ortografía correcta. Se verificó con `Qué cambió` y `cómo va su día`. El
   contenido exigido está presente; solo cambia la forma del grep.
2. **`user_declined` agregado a la tabla de resultados.** No estaba en el
   bloque `<interfaces>` del plan; se leyó el mapeo completo del código.
3. **Precedencia de decisión documentada** (no pedida explícitamente por el
   plan, pero necesaria para leer los transcripts del piloto sin sorpresas).
4. **`{{agent_name}}` marcado como no-variable**, con aviso de reemplazo por
   el literal antes de publicar. El plan lo trataba como token normal del
   prompt; el dispatch no lo manda.

## Notes for the next plan

- Los 5 encabezados reservados están vacíos y en orden, cada uno con su
  marcador. Escribir **debajo** de cada uno sin reordenar.
- El checklist de carga (Parte B) tiene que incluir el paso de **reemplazar
  `{{agent_name}}` por el nombre literal**, o el agente se presenta sin nombre.
- El nodo posterior al Function node de `book` ya tiene los 5 mensajes de
  error transcritos en la sección de la tool: no hay que redactarlos de nuevo.
