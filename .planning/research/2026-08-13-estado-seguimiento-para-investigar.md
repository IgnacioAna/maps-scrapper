# Estado actual del seguimiento post-llamada (SCM) — brief para investigar

> Escrito 2026-08-13 leyendo el código, no la memoria. Sirve como input para
> una investigación externa sobre cómo debería estructurarse el seguimiento.
> Contexto de negocio: **un solo vendedor** (el dueño) trabajando toda la base.
> Ya no hay equipo de SDRs; toda la lógica multi-vendedor del sistema queda
> vigente pero deja de ser una restricción de diseño.

---

## 1. Qué hace el sistema hoy

### 1.1 El acto de llamar

- Llamada VoIP por browser (Telnyx WebRTC). Caller ID rota entre números
  propios según el país destino.
- Dos formas de discar: **lista de Llamadas** (tarjeta por lead) y
  **Power Dialer** (una tarjeta a la vez, atajos 1-9, autopiloto opcional).
- Al colgar es **obligatorio** marcar un resultado (hay un gate: no se puede
  discar el siguiente con una llamada sin marcar).
- Cada llamada queda en `lead.callLog[]` con: timestamp, quién llamó,
  duración, costo real, resultado, notas, y **transcripción** (Whisper, dos
  canales separados vendedor/cliente) + resumen IA.

### 1.2 Los 10 resultados posibles (`CALL_OUTCOMES`)

| Resultado | Qué le hace al lead |
|---|---|
| `answered_interested` | estado = interesado. **No agenda nada.** Queda esperando cierre manual |
| `scheduled_with_admin` | crea la cita en el calendario, estado = agendado |
| `answered_not_interested` | descarta. Pide razón (10 opciones) + tags de objeción |
| `callback_later` | pide fecha/hora → `lead.callbackAt`. Único callback "manual" |
| `no_answer` / `voicemail` | cadencia automática (ver 1.3) |
| `hung_up` (me cortó) | vuelve a la cola; **al 2º corte descarta solo** |
| `wrong_number` / `invalid_number` | descarta + marca el número muerto |
| `placeholder_sent` | se mandó un hold de calendario por mail (ver 1.5) |

### 1.3 Lo único automático: la cadencia de no-contacto

`no_answer` o `voicemail` sin callback manual → `callbackAt = +24h` y el lead
reaparece solo en la cola de Llamadas. **Al 2º no-contacto seguido se descarta
automáticamente** (se bajó de 6 reintentos a 1 para no inflar la tasa de
abandono de Telnyx). Excepción: un lead **interesado** nunca se auto-descarta
por no-contacto — sigue reintentando indefinidamente.

No hay dialer automático: la llamada siempre la dispara una persona.

### 1.4 Dónde vive cada cosa (las 3 vistas)

- **Llamadas** = leads vírgenes + reintentos automáticos. **Los interesados y
  los callbacks manuales están explícitamente EXCLUIDOS de acá.**
- **Hoy** = el panel de seguimiento. Cuatro secciones:
  1. Callbacks manuales que vencen hoy (aparecen solo el día pactado),
  2. Interesados sin agendar (aparecen **todos los días** hasta cerrar),
  3. Para reintentar (no atendió / buzón / me cortó),
  4. Nuevos, ordenados por score.
  Tiene Power Dialer propio, general o por sección.
- **Reuniones agendadas** = calendario. Estados: pendiente / asistió / no
  asistió / **ganada** (cierra el lead con valor de proyecto).

**Regla dura descubierta a fuerza de bugs**: toda disposición nueva *consume*
el `callbackAt` pendiente. Sin esto quedaban leads con callbacks vencidos
viejos clavados primeros en la cola para siempre.

### 1.5 Qué se puede mandarle a un prospecto HOY

Prácticamente nada, y es el hueco más grande:

- ✅ **Hold de calendario por email** (`send-placeholder`): manda un `.ics`
  tentativo con nota custom vía Resend, y lo loguea como `placeholder_sent`.
  Requiere que el lead tenga email cargado (el enriquecimiento lo saca de la
  web cuando puede; la cobertura es parcial).
- ❌ **No hay botón de WhatsApp** en el flujo de llamadas. Los links `wa.me`
  que existen en el código son de la era "Setteo por WhatsApp", una vista que
  está **parkeada** (todo el trabajo pasó a ser por llamada).
- ❌ **No hay envío de material/info** de ningún tipo, ni registro de que se
  haya mandado. Si el prospecto dice "mandame info por WhatsApp", eso queda
  como texto libre dentro de una nota, sin campo, sin evento, sin vencimiento.
- ⚠️ Existe un motor de mensajes programados (`scheduled_messages`) y de
  campañas drip, pero **depende de una app de escritorio de WhatsApp que está
  parkeada** — hoy no se usa.

### 1.6 Dónde se anota el contexto

Cinco lugares distintos, sin jerarquía clara:

1. `precallNote` — nota de preparación *antes* de discar.
2. Nota rápida durante la llamada (panel flotante).
3. Nota del resultado (al marcar la disposición).
4. `notes[]` — notas libres con fecha y autor.
5. Transcripción + resumen IA de cada llamada.

### 1.7 El sistema de follow-ups viejo (semi-huérfano)

Sobrevive `lead.followUps` con pasos **24h / 48h / 72h / 7d / 15d**, uno solo
activo a la vez, que arranca a contar cuando se tilda. Genera una cola "hacer
hoy / vencidos" con badge. Fue diseñado para el seguimiento por WhatsApp; hoy
convive con `callbackAt` **sin integrarse con él**: son dos mecanismos
paralelos de "volver a este lead", con vistas distintas y semánticas distintas.
Esto es probablemente parte de la sensación de descontrol.

---

## 2. Los agujeros concretos (lo que se rompe en la práctica)

1. **Un interesado no tiene próximo paso obligatorio.** Queda flotando en Hoy
   todos los días hasta que alguien decida algo. No hay "¿cuándo vuelvo?" ni
   cuenta de días desde que mostró interés.
2. **Los compromisos hablados no se registran como tales.** "Mandame info",
   "llamame cuando vuelva de vacaciones", "hablalo con mi socio" viven como
   texto libre. No son objetos con fecha, canal ni estado.
3. **No hay línea de tiempo unificada por lead.** Llamadas, notas, mails y
   transcripciones existen pero se leen en lugares distintos.
4. **Un solo canal real (teléfono).** Todo lo demás (WhatsApp, mail de
   material) está afuera del sistema, así que el registro depende de la memoria.
5. **La cadencia solo cubre el no-contacto.** Después de una conversación real
   no hay ninguna secuencia: el siguiente paso es 100% manual.
6. **Dos relojes en paralelo** (`callbackAt` vs `followUps`) sin regla que los
   una.

---

## 3. Preguntas para la investigación

1. Para un vendedor solo trabajando cientos de leads en frío: ¿cuál es la
   estructura mínima de seguimiento que garantiza que ningún interesado se
   caiga? (secuencias, colas por compromiso, next-step obligatorio, etc.)
2. ¿Conviene un modelo de **"tarea/próximo paso obligatorio"** — todo lead
   activo tiene exactamente una acción con fecha, o queda cerrado — frente al
   modelo actual de estados + fechas sueltas? Cómo lo resuelven los CRMs de
   cold calling serios.
3. Cadencia post-conversación: cuántos toques, con qué espaciado y en qué
   canales tras un "mandame info", un "llamame en dos semanas", un interesado
   que no responde.
4. Multicanal ligero: mandar WhatsApp/mail desde el CRM y que quede registrado
   **sin** infraestructura pesada (la app de WhatsApp está parkeada). Qué
   patrones existen: link con plantilla + registro manual, API oficial de
   WhatsApp Business, mail con tracking.
5. Cómo se mide que el seguimiento funciona (métricas de higiene: leads sin
   próximo paso, compromisos vencidos, tiempo hasta el toque siguiente).
6. Diseño de la vista diaria: qué debería ver primero un vendedor al abrir el
   sistema y en qué orden trabajar la cola.
