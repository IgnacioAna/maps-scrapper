# Agente de voz v1 — documento cargable en Retell

> **Qué es este archivo.** La fuente de verdad del agente de voz. Todo lo que
> el agente es —settings, prompt global, variables, campos de extracción,
> tool, webhook y el flow completo— está escrito acá. El dashboard de Retell
> es el **deploy**, no el original: si el dashboard y este documento difieren,
> el que está mal es el dashboard.
>
> **Cómo se usa.** Se transcribe a mano en el builder de Retell, siguiendo el
> checklist de carga del final. No hay script que lo suba: el builder visual
> es del user, el contenido es de este documento.
>
> **Cómo se itera** (D-26-05). Primero se edita este archivo, después se crea
> un draft nuevo en Retell, se publica, y se anota el número de versión en el
> registro de abajo. Una versión publicada de Retell **no se edita nunca**.

## Regla dura: acá no se pega ningún secreto

Este archivo está commiteado en el repo y queda en el historial de git para
siempre, aunque después se borre. Los tres secretos del agente viven como
variables de entorno en Railway y se copian **del dashboard de Railway al de
Retell**, sin pasar por el repo ni por ningún chat:

| Secreto | Env var de Railway | Dónde se pega en Retell |
|---|---|---|
| API key de Retell | `RETELL_API_KEY` | ya está en Railway; Retell la genera, no se pega de vuelta |
| Secret de firma del webhook | `RETELL_WEBHOOK_SECRET` | Webhook → signing secret |
| Secret de la tool `book` | `RETELL_TOOL_SECRET` | header `x-scm-tool-secret` de la custom function |

Los tres ya están cargados en Railway y el backend los toma de ahí (env >
JSON, mismo criterio que Telnyx). El panel de admin del SCM **rechaza**
editarlos mientras la env var esté seteada.

---

## Registro de versiones publicadas

**Versión activa hoy:** _(pendiente — la anota el plan 26-04 al publicar)_

Mecánica de Retell: la versión **no se crea al guardar, se crea al publicar**.
Mientras tanto los cambios viven en un draft (`V3 (draft)`). Una versión ya
publicada no se puede modificar; para volver atrás se crea un draft *a partir
de* una versión vieja y se publica de nuevo.

| Versión Retell | Fecha | Qué cambió | Motivo (transcript que lo disparó) |
|---|---|---|---|
| _(V0)_ | _(pendiente)_ | carga inicial del documento | — |

---

## Global Settings del agente

Valores a fijar en Call Settings / Agent Settings del dashboard. Ninguno es
opcional: si un campo no está acá, se deja en su default.

| Setting | Valor | Por qué |
|---|---|---|
| Idioma | **`es-419`** | Español latinoamericano. El piloto es México — `es-ES` mete voseo peninsular y "vale/venga" en boca del agente. |
| Modelo de LLM | **GPT 4.1** (~$0.045/min) | Las tres escaladas de objeción dependen de matices finos (coincidir, partir en opción múltiple, soltar con elegancia). **No arrancar con un modelo nano**: ahorra centavos y arruina el nodo que decide si hay reunión. |
| Voz | _(pendiente — la elige 26-04 entre 3 candidatas escuchadas en vivo)_ | Formato a anotar: `Proveedor · Nombre de voz · costo/min`. La voz en español es el riesgo más alto de la fase y no se elige por nombre encontrado en la web: se escucha en el selector del dashboard. |
| Nombre de la persona (`{{agent_name}}`) | _(pendiente — lo elige 26-04 **después** de escuchar la voz)_ | El nombre tiene que matchear la voz. Una voz grave con nombre de otra edad se nota en el primer segundo. |
| Voice speed (global) | **0.95** | El slider real va de 0.5 a 2. Lento sin sonar arrastrado; el opener baja todavía más en su nodo. |
| Responsiveness (global) | **0.5** | Punto de partida. Es el campo que el diseño llamaba "Response Eagerness". Si el gatekeeper se siente robótico en la llamada de prueba, se sube **solo en esos nodos**, no acá. |
| Interruption sensitivity (global) | **0.5** | Default sano. El opener lo baja a 0 en su propio nodo. |
| **Voicemail Detection** | **ON · acción "Hang up"** | Coincide exacto con la decisión cerrada: detecta buzón → cuelga → el SCM registra `voicemail` y la cadencia reintenta. Determinístico (<30ms) y más confiable que intentar detectarlo por prompt. Corre solo los primeros 3 minutos. |
| **IVR Detection** | **ON** | Cuelga al detectar un menú de opciones. **No** activar "IVR navigation" (navegar el menú con tonos): el diseño cuelga, no navega. |
| Quién habla primero | **El agente** | Es una llamada saliente en frío: si el agente espera, se come el "¿bueno?" y arranca tarde. |
| Max call duration | **5 minutos** | Techo de gasto por llamada. Se factura por minuto; un prospecto discutidor o un audio colgado no puede costar 10 minutos. |
| Terminar por silencio | **Activado** | Evita facturar una línea abierta sin nadie del otro lado. |
| Post call analysis | **Activado** | Es lo que llena los 9 campos de extracción que consume el webhook del SCM. Sin esto el agente llama pero no deja datos. |
| Webhook URL | `https://scm-setting.up.railway.app/api/retell/webhook` | Detalle completo más abajo. |
| Backchanneling | **ON, suave** | Los "ajá / claro" cortos mientras el otro habla sostienen la sensación de conversación. En "fuerte" pisa al prospecto y suena ansioso. |

> ⚠️ **`{{agent_name}}` no es una variable dinámica de Retell.** El dispatch
> del SCM manda 10 variables (tabla más abajo) y `agent_name` **no está entre
> ellas**: si queda escrito como `{{agent_name}}` en el prompt publicado,
> renderiza **vacío** y el agente se presenta sin nombre. En este documento
> funciona como marcador; al cargar el dashboard se reemplaza por el nombre
> literal elegido, en todos los lugares donde aparece.

---

## Global prompt

Se paga en **cada turno** de la conversación: cuanto más largo, más latencia
en toda la llamada. Objetivo: menos de ~500 palabras. El detalle de cada
etapa vive en el prompt de su nodo, no acá.

Texto para pegar tal cual (reemplazando `{{agent_name}}` por el nombre
elegido):

> Sos `{{agent_name}}`, del equipo de Ignacio. Llamás a clínicas dentales para
> coordinar una reunión corta con el director del equipo.
>
> **Trato:** hablás español neutro latinoamericano y tratás de **usted** al
> prospecto y a recepción, siempre. Nunca uses "vos" ni modismos rioplatenses.
>
> **Objetivo:** conseguir una reunión de 20 minutos. Pedila en cada etapa de la
> llamada, no solo al final. Cada etapa es un tiro al arco: no resignes tiros.
>
> **Nunca hacés esto:**
> - No decís precios, ni rangos, ni "arranca desde". Ni aproximados.
> - No nombrás plataformas, herramientas, tecnología, ni la palabra
>   "inteligencia artificial".
> - No admitís que seguís un guion.
> - No dejás mensajes grabados en un contestador.
> - No transferís la llamada a otra persona.
> - No pedís WhatsApp.
> - No le mentís a recepción. Nunca inventás que te esperan, que ya hablaste
>   con alguien, ni que estás devolviendo una llamada.
>
> **Si preguntan si sos un robot o una grabación:** esquivás con humor y
> volvés al tema en la misma frase. Por ejemplo: "¿tan mal sueno? Le decía que
> lo llamaba porque…". No lo negás y no lo confirmás.
>
> **Si preguntan cuánto sale:** lo diferís siempre. "Depende del tamaño de la
> clínica y de la base de pacientes; eso se evalúa en la reunión. Si tiene
> sentido le paso los números, y si no, se lo digo."
>
> **Cómo hablás:**
> - Lento, con inflexión descendente. Redactás con puntos, no con signos de
>   exclamación. La entonación sube solo en las preguntas.
> - Nunca animado ni entusiasta. El tono es el de alguien que llama a un
>   referido, no el de alguien que vende algo.
> - Te adaptás al ritmo del otro: si está apurado, vas directo y corto; si es
>   pausado, bajás todavía más.
> - Vocabulario fino: "responsable", "podrían estar", "suele pasar".
> - En los cierres usás preguntas negativas: "¿estaría en contra de…?",
>   "¿se opondría a…?", "¿sería completamente irreal…?".
> - Después de una pregunta de cierre, **te callás**. El silencio es parte de
>   la pregunta: no lo llenes.
>
> **Frases prohibidas literalmente**, en cualquier contexto:
> "¿cómo va su día?" y "¿lo agarré en mal momento?".
> Delatan la llamada en frío en el primer segundo.
>
> **Objeciones:** máximo 3 intentos por objeción. Al tercero, soltás con
> elegancia y ofrecés retomar más adelante. Nunca discutís ni insistís una
> cuarta vez.

---

## Variables dinámicas (las manda el dispatch del SCM)

Son las 10 que el backend envía en cada llamada dentro de
`retell_llm_dynamic_variables`. En el prompt de cualquier nodo se escriben
con doble llave: `{{nombre}}`, `{{gancho}}`. Todas llegan como texto.

| Variable | Ejemplo | De dónde sale | ¿Puede venir vacía? |
|---|---|---|---|
| `nombre` | `Clínica Dental Sonrisa` | nombre del negocio scrapeado | prácticamente nunca |
| `ciudad` | `Guadalajara` | ciudad del lead | rara vez |
| `pais` | `México` | país del lead | rara vez |
| `reviews` | `184` | cantidad de reseñas de Google | **sí** |
| `rating` | `4.7` | puntaje de Google | **sí** |
| `years` | `12` | años activo (antigüedad estimada) | **sí** |
| `doctor_name` | `Dr. Ramírez` | `lead.doctor`, si se conoce antes de llamar | **sí** |
| `gancho` | `184 reseñas y 4.7, pero sin agenda online` | frase del brief IA, o el ángulo sugerido por las señales | **sí** |
| `leadId` | `lead_1783…` | id interno; sirve para correlacionar la llamada | nunca |
| `whatsapp` | `+52…` | número de retorno configurado en el panel | sí, si no se configuró |

> ⚠️ **El gancho se llama `{{gancho}}`.** El diseño original lo nombraba
> `openingAngle` / `hookPhrase`; **esos nombres no existen** en el dispatch.
> Escritos en el prompt renderizan vacío y el agente dice una frase mocha sin
> que nadie se entere.

> ⚠️ **`{{doctor_name}}`, `{{reviews}}`, `{{years}}`, `{{rating}}` y
> `{{gancho}}` pueden llegar vacías.** No todo lead tiene esos datos. Todo
> prompt que las use necesita una salida natural cuando están vacías. Esta es
> exactamente la razón por la que el flow tiene **dos** nodos de gatekeeper:
> uno para cuando se sabe el nombre del doctor y otro para cuando no.

> ⚠️ **`recepcionista_nombre` no es una variable del dispatch.** No se sabe
> antes de llamar: se captura **durante** la llamada con un nodo `Extract DV`
> (definido en la Parte B). Es un campo de extracción, no una variable de
> entrada.

---

## Post Call Data Extraction (9 campos)

Se cargan en Post Call Analysis. Retell soporta 4 tipos: `boolean`, `text`,
`number` y `enum`. Regla no obvia del dashboard: **en un enum, la explicación
va en `description` y la lista de `choices` lleva solo el valor**, sin
explicación pegada.

Los nombres tienen que coincidir **carácter por carácter** con los de abajo:
el backend los lee por nombre. Un campo mal escrito no da error — el dato
simplemente nunca llega al lead.

### `atendio` — enum

- **Choices:** `recepcion` · `doctor` · `buzon` · `nadie`
- **Description:** «Quién atendió efectivamente la llamada: la recepción de la
  clínica, el doctor o dueño directamente, un buzón de voz, o nadie.»
- **Qué hace el backend:** nada que decida el resultado. El resultado ya lo
  resuelve el `disconnection_reason` de la telefonía, que es más confiable que
  una lectura del transcript. Este campo existe para **leer los transcripts
  del piloto y saber dónde se cae el flow** (cuánto muere en recepción vs
  cuánto llega al decisor). El único caso que el backend mira es
  `atendio = false`, que con un enum nunca se produce.

### `doctor_name` — text

- **Description:** «Nombre del doctor, dueño o responsable de la clínica que se
  haya mencionado durante la llamada, si apareció alguno. Solo el nombre.»
- **Qué hace el backend:** rellena `lead.doctor` **solo si estaba vacío**.
  Nunca pisa un nombre ya cargado.

### `recepcionista_nombre` — text

- **Description:** «Nombre de la persona de recepción que atendió, si lo dijo.»
- **Qué hace el backend:** lo guarda como nota en el lead ("Recepcionista: X").
  La próxima llamada la puede empezar nombrándola.

### `interes` — enum

- **Choices:** `si` · `tibio` · `no`
- **Description:** «Nivel de interés real que mostró el prospecto en tener la
  reunión: si aceptó o se mostró claramente interesado, si quedó tibio o
  ambiguo, o si rechazó.»
- **Qué hace el backend:** `si` → interesado. `no` → no interesado.
- ⚠️ **`tibio` no lo resuelve el backend, y es a propósito.** No está en
  ninguna de las dos listas, así que cae al análisis del transcript por IA,
  que decide con más contexto. Un tibio no es un interesado ni un rechazo:
  forzarlo a uno de los dos ensucia el funnel del piloto.

### `objecion_principal` — text

- **Description:** «La objeción principal que puso el prospecto. Si encaja
  exactamente en una de estas etiquetas, devolvé la etiqueta sola, sin
  explicación: `no_es_icp`, `no_es_decisor`, `ya_no_trabaja`,
  `sin_presupuesto`, `ya_tiene_proveedor`, `cliente_actual`,
  `mala_experiencia`, `no_contactar`, `ya_agendado`. Si no encaja en ninguna,
  describila en una frase corta.»
- **Qué hace el backend:** si el valor es **exactamente** una de esas 9
  etiquetas, se guarda como razón estructurada de descarte (la misma que usan
  las SDRs humanas, así entra en el reporte de razones de pérdida). Si es
  texto libre, se guarda como objeción suelta en el historial de la llamada.

> 🚨 **`no_contactar` es la única vía por la que el agente puede marcar un
> lead como no-llamar.** Si el prospecto pide que no lo llamen más y este
> campo sale como texto libre ("dijo que no lo llamemos", "pidió que lo saquen
> de la lista"), **el lead NO queda en la lista de no-llamar y el sistema lo
> va a volver a discar**. Es un problema de compliance, no de prolijidad: en
> cold calling volver a llamar a alguien que pidió no ser llamado es
> exactamente lo que las reglas de DNC prohíben.

### `callback_fecha_hora` — text

- **Description:** «Fecha y hora absolutas en las que pidió que lo vuelvan a
  llamar, en formato ISO 8601 con zona horaria. Ejemplo:
  `2026-08-14T10:00:00-06:00`. Si no dio un momento concreto, dejalo vacío.
  Nunca devuelvas texto como "el martes" ni "la semana que viene".»
- **Qué hace el backend:** parsea la fecha y, si es futura y está dentro de los
  próximos 90 días, agenda el recontacto en esa fecha exacta.
- ⚠️ Si el valor no es una fecha absoluta parseable, **se descarta en
  silencio**: no hay error, no hay aviso, y el compromiso que el agente tomó
  con el prospecto se pierde. De ahí que la `description` prohíba las fechas
  relativas de forma explícita.

### `email` — text

- **Description:** «Dirección de email que dictó el prospecto durante la
  llamada, si dictó alguna.»
- **Qué hace el backend:** valida el formato y solo lo escribe si el lead no
  tenía email cargado.

### `agendo` — boolean

- **Description:** «Verdadero solo si quedó una reunión confirmada con día y
  hora concretos. Falso si quedó en "lo vemos", "mandame algo" o cualquier
  cosa sin fecha.»
- **Qué hace el backend:** `true` → la llamada cuenta como **reunión agendada**.
- **Es la red de seguridad de la tool `book`.** Si la tool falló durante la
  llamada, el sistema igual registra la reunión con este campo. Y si la tool
  ya la creó, no se duplica: hay una marca por llamada que lo evita.

### `nota_seguimiento` — text

- **Description:** «En 2 o 3 frases: qué se habló y qué tiene que hacer la
  persona que haga el seguimiento. Escribilo para que lo entienda alguien que
  no escuchó la llamada.»
- **Qué hace el backend:** entra como nota en el lead, firmada **"Agente IA"**.
  Es lo que va a leer el humano que retome el contacto.

### Un décimo campo que no se carga: `call_summary`

Retell lo genera solo (built-in de Post Call Analysis, no hay que definirlo).
El backend lo usa como el texto del resultado de la llamada en el historial,
recortado a 500 caracteres.

### Orden en que el backend decide el resultado

No es "gana el último": hay una precedencia fija, y conviene conocerla para
leer los transcripts del piloto sin sorpresas.

1. Reunión creada por la tool `book`, o `agendo = true` → **agendada**.
2. `disconnection_reason` con mapeo (buzón, IVR, no atendió, error de
   telefonía) → ese resultado, **por encima de lo que diga la extracción**.
3. `callback_fecha_hora` válido → **recontacto** en esa fecha.
4. `interes` = `si` / `no` → interesado / no interesado.
5. Nada de lo anterior → lo decide el análisis del transcript por IA.

> **Nota final.** Retell **no completa estos campos en llamadas que nunca
> conectaron**: llegan vacíos. No es un error ni un campo mal cargado — para
> esas llamadas el resultado ya lo resuelve el `disconnection_reason`, que
> está mapeado entero (tabla más abajo).

---

<!-- Parte B: la escribe el plan siguiente sobre este mismo archivo. -->

## Mapa del flow
<!-- 26-02 -->

## Nodos
<!-- 26-02 -->

## Global Nodes
<!-- 26-02 -->

## Tabla de transiciones
<!-- 26-02 -->

## Checklist de carga en el dashboard
<!-- 26-02 -->
