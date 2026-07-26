# Phase 21: Reporte diario + canal WhatsApp - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-26
**Phase:** 21-reporte-diario-canal-whatsapp
**Areas discussed:** Canal y plan B, Cuándo llega el reporte, Quién sale como "sin actividad", Qué dice exactamente, Llamadas sin marcar, El semanal en texto, Configuración, País de las vendedoras, Licencias, Reuso para la próxima fase

---

## Hallazgos verificados que fundaron la discusión

| Hallazgo | Evidencia |
|---|---|
| El envío a grupo no puede funcionar con el handler actual | `wa-multi/src-v058-work/out/main/index.js:630,736` — deeplink `web.whatsapp.com/send?phone=`; WhatsApp no tiene `send?group=` |
| Ninguna cuenta de WhatsApp conectada | `data/wa_accounts.json`: Delfina, Sofia, Ignacio 2 → todas `QR_PENDING` |
| 3 de 6 vendedoras nunca llamaron | Judith 143 · Teresa 165 · Brenda 74 · Dalia 0 · Adela 0 · Melissa 0 |
| Fines de semana sin actividad | sáb 18, dom 19, sáb 25, dom 26 de julio: cero llamadas |
| 9% de las llamadas cae entre 20:00 y 21:00 AR; ninguna después de las 21:00 | histograma horario sobre 382 llamadas de vendedoras nuevas |
| Franja horaria de Teresa: 12h–16h AR (Judith 06h–20h, Brenda 07h–20h) | pista de que trabaja desde otro huso |
| 78 de 603 llamadas son canal manual sin duración | sesgo de REP-10 |
| 40 interesados, 0 reuniones agendadas en todo el histórico | justifica incluir interesados y excluir agendados |

---

## Canal y plan B

### ¿Hay una máquina que pueda quedar prendida?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sí, la mía queda prendida | wa-multi corriendo con una cuenta logueada | ✓ |
| No, nadie la deja prendida | WhatsApp deja de ser confiable; email + canal detrás de bandera | |
| Que salga sin computadora | WhatsApp Cloud API oficial: sin desktop, pero sin grupos y con verificación de Meta | |

**Notas:** pregunta previa a todo lo demás — Railway no puede mandar WhatsApp por sí solo.

### ¿Grupo o mensajes individuales?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Grupo con DMs de respaldo | Modificar el desktop para buscar el grupo; si no aparece, 3 DMs | ✓ |
| Solo grupo | Sin desdoblar; queda en cola y reintenta | |
| 3 mensajes individuales | Funciona hoy sin tocar el desktop | |

### ¿Desde qué número sale?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Ignacio 2 (cuenta ya cargada) | Solo falta escanear el QR | |
| Mi WhatsApp personal | Cero configuración, pero automatiza su línea diaria | |
| Delfina o Sofía | Cuentas nacidas para prospección | |

**Respuesta del user (texto libre):** "voy a usar una de 0 para eso la tengo que armar todavia" → **número nuevo dedicado, a crear.**
**Notas:** se le advirtió que conviene usar la línea a mano unos días antes de automatizarla.

### ¿Qué pasa si la computadora está apagada?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Guarda y manda por email si tarda | Cola + email al día siguiente, período marcado como cubierto | |
| Solo guarda y espera | Sin email; un solo mensaje consolidado al reconectar | ✓ |
| Siempre por los dos canales | Redundancia total | |

**Notas:** acota REP-07. Se le advirtió que si la máquina queda apagada varios días nadie se entera. El email queda cableado y apagado para poder encenderlo por configuración.

### ¿El semanal también va al grupo?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sí, también al grupo | Texto corto al grupo + email HTML como está | ✓ |
| Solo por email | Menos ruido, menos código | |
| Solo al grupo, sin email | Se pierde el detalle del HTML | |

### ¿Cómo te enterás de que un reporte no salió?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| El próximo mensaje lo confiesa | Línea inicial con los días que no pudo enviar + registro server-side | ✓ |
| Aviso en el panel | Contradice el objetivo de no entrar al panel | |
| Reintenta callado | Un silencio de 3 días se lee igual que "no pasó nada" | |

### ¿Construimos sin esperar el número?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sí, construir ya y probar cuando esté | Builder, cola y repack en paralelo | ✓ |
| Esperar al número primero | La fase queda parada | |

---

## Cuándo llega el reporte

**Mensaje espontáneo del user a mitad de la discusión:** "quiero cambiar el horario, que no sea a la mañana que sea al final del dia tipo 8pm".

### ¿A qué hora exacta?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| 21:00 | Día realmente cerrado; entra el 100% de las llamadas | ✓ (luego revisada) |
| 20:00 en punto | Deja fuera el 9% de las llamadas | |
| 22:00 | Margen de sobra, pero nadie mira el celular por trabajo | |

**Notas:** esta decisión fue REVISADA más abajo (país de las vendedoras) y quedó en **23:00**.

### ¿Sale reporte los fines de semana?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| No, solo lunes a viernes | Un reporte de sábado sería todo ceros | |
| Todos los días | Dos mensajes vacíos por semana | |
| Solo si hubo actividad | Cubre el caso raro sin generar vacíos | ✓ |

### ¿Y un día de semana en que el equipo entero no llamó?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sale igual, es LA noticia | Una línea "hoy no llamó nadie" | ✓ |
| No sale, como el finde | Un feriado y una caída se ven igual | |
| Solo si es día hábil sin feriado | Calendario de feriados de tres países | |

---

## Quién sale como "sin actividad"

### ¿Qué hacemos con las que nunca llamaron?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Línea aparte, no la de alerta | Entran a la alerta recién tras su primera llamada | ✓ |
| Interruptor manual por vendedora | Control total, pero hay que mantenerlo | |
| Que salgan en la alerta igual | Tres nombres fijos todos los días | |

### ¿Y la que deja de trabajar?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Escala a línea propia tras 5 días hábiles | "Teresa: 8 días sin llamar" | ✓ |
| La sacás vos del panel | Depende de que alguien se acuerde | |
| Aparece siempre en la alerta | Reproduce el problema al revés | |

### ¿Qué cuenta como "trabajó hoy"?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Cero llamadas = sin actividad | Un hecho, no una opinión; sin umbrales | ✓ |
| Menos de 10 llamadas también avisa | Umbral discutible | |
| Comparar contra su propio promedio | Poca historia para que el promedio signifique algo | |

---

## Qué dice exactamente

### Molde del mensaje diario

Los tres moldes se presentaron RENDERIZADOS con datos reales del mié 22/07.

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Excepción en la primera línea, sin emojis | Lo primero que se lee en la notificación es quién no trabajó | ✓ |
| El molde del roadmap tal cual | Con emojis; el título va primero | |
| Solo la excepción, sin el detalle | Lo más corto, pero sin ver cómo le fue a cada una | |

### Sesgo del canal manual (REP-10)

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Solo cuando distorsiona de verdad | Línea al pie si son 5+ o más del 10% del día | ✓ |
| Siempre al pie | Una línea que casi siempre dice 0 | |
| Fuera del diario, solo en el semanal | Minutos falsos sin aviso hasta el lunes | |

### Expiración de la cola

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| 3 días | Lo más viejo lo cubre el semanal, que nunca expira | ✓ |
| 7 días | Siete líneas sobre las que ya no podés hacer nada | |
| Que nunca expiren | Mensaje gigante e ilegible tras dos semanas | |

### ¿Interesados en el diario?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sí, y solo cuando hay | Línea aparte; sin interesados no aparece | ✓ |
| Sí, dentro de la fila de cada una | La mayoría de los días sería 0 | |
| No, solo llamadas/atendidas/minutos | Se reporta esfuerzo pero nunca resultado | |

---

## Llamadas sin marcar (sesgo nuevo de la Phase 20)

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Línea al pie cuando hay varias | Conteo agregado, sin nombres | |
| Sumarlas al total de llamadas | Rompería la regla de un solo motor de métricas | |
| Que salgan por nombre | "Sin marcar hoy: Teresa 7, Judith 2" | ✓ |

**Notas:** se le advirtió que es una métrica de disciplina y puede leerse como reto. La línea solo aparece si hay alguna sin marcar.

---

## El semanal en texto

### ¿Qué dice la versión del grupo?

Presentado renderizado con datos reales de la semana 20–26/07.

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Mismo formato que el diario | Consistente, autocontenido, incluye "32 interesados · 0 reuniones" | ✓ |
| Solo lo que cambió respecto de la semana pasada | El sistema interpreta; riesgo de subrayar ruido | |
| Solo el titular, el detalle al mail | Hay que abrir el mail que nadie abre | |

### ¿A qué hora sale?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Lunes 8am, junto con el mail | No hay que tocar el cron que ya funciona | |
| Lunes 21:00, con el diario | Dos mensajes casi pegados | |
| Domingo a la noche | La semana cerrada antes de que empiece la siguiente | ✓ |

### ¿El mail también se mueve?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Los dos el domingo a la noche | Un solo momento; implica correr la ventana de la semana | ✓ |
| Grupo domingo, mail lunes | Los mismos números por dos vías con 11h de diferencia | |
| Los dos el lunes 8am | Volver atrás | |

### Hora final del semanal (revisada al cierre)

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Domingo 21:00 | Hora más cómoda de leer | |
| Domingo 23:00, igual que el diario | Un solo horario para todo | ✓ |
| Otro momento | | |

---

## Configuración

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sección chica en el Centro de Comando | Grupo, mails, pausa y botón "mandar ahora" para la prueba en vivo | ✓ |
| Variable en Railway | Cada cambio reinicia el servidor | |
| Fijo en el código | Cualquier cambio exige deploy | |

---

## Composición del grupo

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Solo los 3 socios | Lo que asume todo el contenido decidido | |
| También están las vendedoras | Obligaría a rehacer el contenido sin señalamientos | |
| Todavía no lo creé | Se construye asumiendo grupo cerrado de dirección | ✓ |

---

## Arranque del número nuevo

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Prueba a un chat tuyo primero | Ajustar el molde antes de que lo vean los socios | |
| Directo al grupo apenas esté | Más rápido; el primer molde que ven es el borrador | ✓ |
| Mandar solo cuando yo aprieto el botón | Depende de acordarse | |

---

## El JID del grupo

Pregunta del user: *"que paso con el jiidd? algo asi"* y luego *"como era la primera pregunta de todas que me hiciste del control ty plan b algo asi, hanlaba de esto del jidd? alfinal como mando los mensaes?"*

Se explicó que el desktop no habla el protocolo de WhatsApp — maneja WhatsApp Web como una persona — así que el JID no destraba el envío a grupos, y que la primera pregunta era sobre otra cosa (que exista una computadora prendida).

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Elegís el grupo de una lista una vez | Guarda el identificador interno del DOM; sobrevive a renombres | ✓ |
| Buscar por nombre | Más simple; se rompe si renombran el grupo | (fallback) |
| Que hable el protocolo directo | Librería no oficial, riesgo de bloqueo, tira el desktop existente | |

**Notas:** se avisó explícitamente que hay que confirmar en la implementación que el identificador esté disponible en el DOM; si no, cae a búsqueda por nombre.

---

## País de las vendedoras

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Todas en Argentina o Uruguay | El corte de 21:00 cubre a todas | |
| Hay gente en otros países | Hay que decidir el corte | ✓ |
| No estoy seguro | | |

### ¿Hay alguien al oeste?

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Sí, hay en México o similar | El corte se mueve a 23:00 AR (= 20:00 MX) | ✓ |
| No, todas en AR/UY/España | El corte de 21:00 queda como estaba | |
| Contar cada una en su propia hora | El mensaje llegaría pasada la medianoche | |

**Notas:** esta respuesta REVISÓ la decisión de horario tomada antes (21:00 → 23:00).

---

## Licencias y ausencias

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Botón para marcar ausencia con fecha | Vuelve sola al vencer; nadie tiene que desmarcarla | ✓ |
| No, convivo con eso | La alerta se ensucia durante las vacaciones | |
| Usar el interruptor `hidden` que ya existe | Sin vencimiento: la persona podría desaparecer para siempre | |

---

## Reuso para la próxima fase

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Genérico desde ahora | El envío acepta cualquier mensaje; Phase 23 no reabre este código | ✓ |
| Atado a los reportes, ampliar después | Reabrir código probado sale más caro | |

---

## Detalles menores confirmados

Presentados como "esto lo resuelvo yo así" con opción de objetar:

- El primer día no hay "ayer" → la línea de comparación no aparece.
- Si la app queda abierta en dos computadoras, la orden se manda a una sola.
- **Historial de mensajes enviados:** los últimos **30** (el user eligió 30 sobre 90 y sobre no guardar nada).
- **Las vendedoras no reciben el reporte** — el user eligió esta opción "por ahora", y pidió dejar anotada la variante de reporte al equipo "para desp que esto funcione mejor".

---

## Claude's Discretion

- Mecanismo exacto de la cola (copiar `scheduledMessagesTick`, no reusar el módulo).
- Espaciado entre mensajes (30-60s), sin caps de warming.
- Guard de alcanzabilidad con `isUserOnline` (`sendToUser` devuelve `true` con room vacía).
- Emisión a un solo socket para evitar duplicados.
- Redacción exacta de la línea de baches y del texto de escalada.
- Estructura de `reports.json` para estado diario + cola + historial.
- Detalle del repack de wa-multi.

## Deferred Ideas

- Reporte individual a cada vendedora (pedido del user "para después").
- Fallback a email del diario (REP-07 completo) — cableado y apagado.
- Corte del día por huso de cada vendedora.
- Calendario de feriados por país.
- Hardening del semanal (WR-01/02/03 del `19-REVIEW.md`).
- Cola de llamadas a escuchar en el semanal → Phase 22.
- Alertas por excepción por este canal → Phase 23.
