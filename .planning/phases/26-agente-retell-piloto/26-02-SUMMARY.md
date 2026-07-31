---
phase: 26-agente-retell-piloto
plan: 02
subsystem: docs
tags: [retell, voice-agent, conversation-flow, global-node, objection-handling, cold-calling]

# Dependency graph
requires:
  - phase: 26-01
    provides: "docs/retell-agent-v1.md Parte A — Global Settings, global prompt, las 10 variables dinámicas, los 9 campos de extracción y la config de la tool `book` (incluidos los 5 mensajes de ok:false que lee el nodo agendar_confirmar)"
provides:
  - "docs/retell-agent-v1.md Parte B — mapa del flow con diagrama, los 9 nodos con prompt textual/transiciones/settings, los 2 Global Nodes, la tabla consolidada de 29 transiciones y el checklist de carga de 10 pasos"
  - "El documento queda cargable de punta a punta: quien se siente frente al dashboard no toma ninguna decisión de contenido"
affects: [26-03, 26-04, 26-05, 26-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Estructura fija por nodo (Tipo · Prompt textual · Transiciones tipadas · Settings que se desvían · Variables que captura): hace que la carga en el dashboard sea mecánica y que un diff del documento entre versiones muestre exactamente qué cambió del agente."
    - "Cada transición declara si es ecuación o prompt-based. El tipo no es cosmético: una ecuación sobre una variable aún inexistente no da error, deja el flow clavado."

key-files:
  created: []
  modified:
    - docs/retell-agent-v1.md

key-decisions:
  - "La transición `detect → gk_con_nombre` se documenta como mixta (ecuación `{{doctor_name}} exists` + prompt-based para 'quién atendió') CON una salida alternativa escrita: si el builder no permite combinar los dos tipos en una transición, se resuelve con un Logic Split node justo después de `detect`. El research no confirma que se puedan combinar, y descubrirlo frente al dashboard sin plan B cuesta tiempo."
  - "El agendamiento se documentó como TRES nodos (`agendar` → `agendar_book` → `agendar_confirmar`), no como uno. El plan ya lo pedía; se le agregó la rama de error explícita del Function node para que un timeout de `book` salga igual al nodo conversacional en vez de dejar al agente mudo."
  - "Las 4 ramas fijas de `objeciones` (precio, mandame info, quién son, no me interesa temprano) se documentaron como NO incrementando `{{objection_count}}`. El research las llamaba 'ramas fijas' sin decir qué pasa con el contador; si incrementaran, un prospecto que pregunta el precio y después objeta una vez ya estaría en la salida de 3 meses."
  - "`global_robot` maneja la insistencia con TRES respuestas distintas por entrada (chiste → reconocimiento → cierre elegante) en vez de un anti-loop que simplemente no re-dispara: un agente que repite el mismo chiste dos veces produce exactamente la sospecha que el nodo intenta disolver."
  - "En `pitch`, la salida para variables vacías incluye una prohibición explícita de inventar cifras o de mencionar que se miraron datos cuando no llegó ninguno. Sin esa línea, un LLM con `{{reviews}}` vacío tiende a decir 'vi que tienen muy buenas reseñas' — una afirmación falsa sobre el negocio de la persona que atiende, en la primera frase."
  - "El checklist pone la tool y los 9 campos de extracción ANTES de crear los nodos, porque los nodos los referencian. El orden del plan ya era ese; se explicitó el porqué."
  - "Se agregó al checklist un bloque 'qué escuchar en la primera llamada de prueba' con 5 síntomas mapeados a su causa (usted/voseo, nombre sin reemplazar, pausa del opener, cita duplicada→toggle args only, transcript ausente→secret del webhook). No estaba pedido, pero es lo que convierte la llamada de 26-04 en un diagnóstico en vez de una impresión."

patterns-established:
  - "Prompts de nodo escritos en segunda persona rioplatense (instrucción al LLM) con TODAS las líneas habladas entrecomilladas en usted neutro. El global prompt refuerza la regla y el checklist la pone como primer punto a verificar de oído."

requirements-completed: [VOICE-08]

# Metrics
duration: 40min
completed: 2026-07-31
---

# Phase 26-02: Parte B — el flow completo — Summary

**`docs/retell-agent-v1.md` quedó cargable de punta a punta: 1.134 líneas con los 9 nodos escritos palabra por palabra, el contador de objeciones resuelto con la mecánica real del builder (Extract DV + Logic Split + ecuaciones), los 2 Global Nodes y un checklist de 10 pasos que no deja ninguna decisión de contenido para el momento de la carga.**

## Performance

- **Duración:** ~40 min
- **Tareas:** 3 de 3
- **Archivos modificados:** 1 (`docs/retell-agent-v1.md`: 438 → 1.134 líneas)
- **Commits:** `43338ac`, `0498140`, `96fdafc`

## Accomplishments

### Task 1 — Mapa del flow y nodos 1-4
- Mapa con tabla de los 9 nodos (id, tipo de nodo de Retell, qué hace) más un
  diagrama en texto plano de quién va a quién, y la declaración del modo
  **Rigid**.
- Buzón e IVR quedan **fuera del mapa a propósito**: los resuelve la detección
  nativa de los Global Settings.
- `detect`, `gk_con_nombre`, `gk_sin_nombre` y `opener_doctor` con prompt
  textual, transiciones tipadas, settings y variables capturadas.
- `opener_doctor` fija **`interruption sensitivity` en 0** con la aclaración de
  que el control es un slider continuo y **no existe un botón OFF**, más
  `voice speed` 0.9 y `responsiveness` 0.4 (la pausa es parte del opener).
- Nota de mecánica en `gk_sin_nombre`: si `doctor_name` se aprende ahí, un nodo
  posterior solo puede usarlo en una ecuación si pasó por el `Extract DV node`.

### Task 2 — Nodos 5-9
- `pitch` con la secuencia completa (validación → problema con especificidad
  dental → gancho con dato real → una oración de solución → reunión de 20 min
  → cierre a 48 h) y **salida natural para las 3 variables que pueden venir
  vacías**, con prohibición de inventar cifras.
- `agendar` documentado como **tres nodos encadenados** con la razón escrita
  (un Function node no conversa) y el tie-down de 5 pasos.
- `objeciones` con la mecánica concreta del contador (`Extract DV` incrementa
  → `Logic Split` bifurca → ecuaciones `== 1`, `== 2`, `>= 3`), las tres
  escaladas (doblar la apuesta / Miyagi / salida a 3 meses en ISO 8601
  absoluto), las 4 ramas fijas y el branch "no hay dolor".
- `interes_sin_agenda` y `ending` (End node, 4 despedidas por rama).

### Task 3 — Global Nodes, transiciones y checklist
- `global_dnc` con la instrucción crítica de `objecion_principal =
  no_contactar` exacto y la explicación de por qué es Global Node y no una
  rama por nodo.
- `global_robot` con escalada de tres respuestas y anti-loop.
- **Tabla consolidada de 29 transiciones**, cada una tipada, más el aviso de
  la restricción de ecuaciones sobre variables inexistentes.
- **Checklist de 10 pasos** con la tool y la extracción antes de los nodos,
  los avisos de Chrome y del ciclo de versionado, y el bloque de 5 cosas a
  escuchar en la llamada de prueba.

## Verification

| Criterio | Resultado |
|---|---|
| Mapa lista los 9 ids y declara `Rigid` | sí |
| Nodos 1-4 con Tipo/Prompt/Transiciones/Settings | sin `FALTA NODO:` |
| `opener_doctor` con `interruption sensitivity` en 0 + "no existe OFF" | sí |
| `detect` delega buzón/IVR a la detección nativa | sí |
| Captura con `Extract DV` declarada en los dos gatekeepers | sí |
| `grep -c 'prompt-based'` ≥ 2 | 14 antes de la tabla, 30 al final |
| `grep -c '^### '` ≥ 9 | 24 |
| `agendar` como cadena Conversation → Function → Conversation | sí, con manejo de `ok:false` |
| `objeciones` con `{{objection_count}}` y ecuaciones `==1/==2/>=3` | sí |
| Salida a 3 meses exige ISO 8601 absoluto | sí |
| `ending` es `End node` | sí |
| `pitch` con salida para variables vacías | sí |
| 2 Global Nodes con condición, prompt y anti-loop | sí |
| `global_dnc` nombra `no_contactar` y su consecuencia | sí |
| `global_robot` no niega ni confirma | sí |
| Tabla consolidada con tipo por fila | 29 filas |
| Checklist de 10 pasos, "args only" desactivado, publicar+anotar versión | sí |
| Chrome y ciclo documento → draft → publicar → anotar | sí |
| Los 5 marcadores `<!-- 26-02 -->` tienen contenido debajo | sí (verificado con `grep -A3`) |
| Cero secretos | `NO_SECRETS_OK` |
| min_lines 450 | 1.134 |

## Deviations

1. **Salida alternativa para la transición mixta de `detect`.** El plan la
   describe como ecuación + prompt-based en una sola transición; el research
   no confirma que el builder permita combinarlas. Se documentó la combinación
   como está pedida **y** el plan B (Logic Split después de `detect`).
2. **Las ramas fijas de `objeciones` no incrementan el contador.** Decisión
   tomada acá: el plan las lista como "no cuentan como escalada" y esa frase
   se convirtió en una regla explícita del contador.
3. **Rama de error explícita en el Function node** `agendar_book`, no pedida
   por el plan pero coherente con la práctica del research ("toda function con
   rama de error explícita").
4. **Bloque "qué escuchar en la llamada de prueba"** agregado al final del
   checklist (5 síntomas → causa). No estaba pedido.

## Decisión abierta que hay que cerrar antes de publicar

**La línea «Él ya sabe» del guion oficial** (respuesta al "¿de parte?" en
`gk_con_nombre`) quedó marcada en el documento como decisión pendiente del
user. Choca con dos cosas ya escritas: la regla dura del global prompt ("nunca
inventes que ya hablaste con alguien") y la *familiaridad fingida* que el
diseño del milestone descartó a conciencia. En el documento quedó escrita la
**variante neutra** —«Es por la reactivación de pacientes de la clínica»— que
es la que el global prompt permite hoy. Si el user prefiere la original, hay
que cambiar **las dos cosas juntas**: el prompt del nodo y la regla del global
prompt. Cambiar solo una deja al agente con instrucciones contradictorias.

## Notes for the next plan

- El documento está completo. **No hay más contenido que escribir**: 26-03 va
  al trunk de Telnyx y 26-04 carga esto en el dashboard.
- Al cargar (26-04), los tres huecos que quedan pendientes en la Parte A son
  **voz**, **nombre de la persona** y **número de versión publicada**. Los
  tres tienen su lugar marcado.
- El paso 3 del checklist (reemplazar `{{agent_name}}` por el literal) es el
  error más fácil de cometer y el más fácil de detectar: si el agente se
  presenta sin nombre en la llamada de prueba, es eso.
