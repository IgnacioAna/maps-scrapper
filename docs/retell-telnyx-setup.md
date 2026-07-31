# Trunk Telnyx ↔ Retell — guía de setup

## 1. Qué es esto y cuándo se usa

El agente de voz habla a través de **los números de Telnyx propios**, no de
números de Retell. Para eso hace falta un **SIP trunk**: una conexión entre la
cuenta de Telnyx y la infraestructura de Retell. Sin trunk no hay llamada.

Esta guía sirve para tres momentos:

1. **Armarlo** — se hace una sola vez.
2. **Diagnosticar** — cuando una llamada del agente no sale, la causa casi
   siempre está en la sección 8.
3. **Rehacerlo** — si hay que migrar de cuenta o rotar credenciales.

Lo escrito acá se ejecuta en **dos dashboards de terceros** (Telnyx Mission
Control Portal y Retell) con la persona al teclado: no hay script que lo haga.
Lo único reproducible por comando es el import de números (sección 5).

> **Los nombres de menú están cruzados contra dos fuentes** (la guía oficial de
> Retell para Telnyx y la guía equivalente de otro proveedor BYO-SIP, que usa
> el mismo portal). Aun así, un portal cambia labels: si algo no aparece con
> el nombre exacto, buscarlo por función y **anotar acá el nombre nuevo**.

---

## 2. Antes de empezar

- [ ] Sesión abierta en **Telnyx Mission Control Portal**.
- [ ] Sesión abierta en el **dashboard de Retell**, en **Chrome** (Safari
      crashea el builder).
- [ ] La `RETELL_API_KEY`, leída del dashboard de **Railway**. **No se escribe
      en este documento** ni en ningún archivo del repo.
- [ ] Un gestor de contraseñas a mano: el trunk va a generar un usuario y una
      contraseña SIP que **no van al repo**.
- [ ] La decisión de la sección 3 tomada.

---

## 3. Decisión previa: qué números usa el agente

### Estado actual de la cuenta

Tres números activos, los tres en la conexión que hoy usa el dialer WebRTC de
las SDRs para rotar caller ID:

| id en el SCM | Label en Centralita | País |
|---|---|---|
| `telnyx_num_1779489120861_gg4qsp` | Ignacio USA Cold Calling | US |
| `telnyx_num_1783725925454_x2fu3a` | USA 2 | US |
| `telnyx_num_1783725955014_ctkmvz` | USA 3 | US |

(Los E.164 completos se ven en el panel **Centralita** del SCM. No se copian
acá a propósito.)

`retell_config.fromNumberId` está **vacío** y `countryRouting.MX` también.

> ⚠️ **La nota #116 del proyecto dice 6 números; el backup local dice 3.**
> Manda el dashboard. Confirmarlo es parte de esta decisión.

### Por qué esto no es un detalle

**El pool de números del SCM es compartido.** La misma lista
(`telnyx_config.numbers`) alimenta la rotación del agente y la del dialer
humano. Marcar un número como inactivo lo saca **para los dos** — no sirve
como forma de "reservarlo" para el agente.

Y un número de Telnyx pertenece a **una sola conexión a la vez** (asumido de
la arquitectura estándar de Telnyx, **no verificado contra esta cuenta**):
mover uno a la conexión del agente lo saca de la conexión del dialer humano.

### Opciones

**Opción A — comprar 1-3 números nuevos para el agente** *(recomendada)*

- El dialer humano conserva sus 3 números intactos.
- El agente estrena **reputación propia**: si quema un número por volumen, no
  arrastra a las SDRs.
- Costo marginal conocido: ~$1-2/mes por número, lo mismo que ya se paga por
  los actuales.
- **Contra:** cuesta plata (poca) y suma un paso de compra. El número nuevo
  entra al pool compartido del SCM, así que hay que verificar que la rotación
  del dialer humano no lo elija y falle (paso de verificación, sección 7).

**Opción B — mover 1 de los 3 actuales a la conexión del agente**

- Costo cero, inmediato. El número ya tiene historial de uso: no es virgen
  para las carriers.
- **Contra:** el dialer humano baja de 3 a 2 números para rotar. Si el piloto
  quema ese número, se pierde un caller ID que hoy funciona.

**Opción C — mover los 3** — *descartada por escrito.*

Deja al dialer humano sin caller ID para rotar. Es romper el trabajo de las
SDRs para probar el agente.

### Dos cosas a confirmar mirando el portal

1. **¿Cuántos números activos hay realmente hoy?** (el backup dice 3, la nota
   del proyecto dice 6).
2. **¿El portal deja que un número pertenezca a más de una conexión, o al
   asignarlo a la nueva lo saca de la actual?** Se ve en el momento de
   asignar.

### Uso real de cada número (medido, no estimado)

Del `callLog` del SCM, últimos 90 días — 877 llamadas, de las cuales 130 sin
`fromNumber` registrado (llamadas viejas, antes de que se guardara el campo):

| Número | Label | 90 días | 30 días | Rol |
|---|---|---|---|---|
| `…0849` | Ignacio USA Cold Calling | 351 | 205 | **es el `default` del routing** |
| `…0620` | USA 2 | 199 | 199 | rotación |
| `…5783` | USA 3 | 197 | 197 | rotación |

USA 2 y USA 3 están empatados (los dos entraron hace ~30 días y rotan
parejo). El primero es el más cargado **y** el fallback del routing: moverlo
dejaría al dialer humano con su `default` apuntando a un número que ya vive
en otra conexión.

### Registro de la decisión

> **Decisión: opción B — mover 1 de los 3 actuales.**
> **Fecha:** 2026-07-31
> **Número del agente:** `+17867725783` — "USA 3",
> id `telnyx_num_1783725955014_ctkmvz`.
>
> **Por qué ese:** es el menos usado de los tres (197 llamadas en 90 días) y
> **no es el `default` del `countryRouting`**, así que moverlo no deja al
> dialer humano con su fallback apuntando fuera de su conexión. Entre USA 2 y
> USA 3 la diferencia es de 2 llamadas: si en el portal USA 3 resulta
> incómodo de mover, USA 2 es equivalente.
>
> **Confirmación 1 — números activos reales: son 3** ✅ (confirmado por el
> user, 2026-07-31). La nota #116 del proyecto que decía 6 está desactualizada.
> **Confirmación 2 — ¿un número puede estar en dos conexiones?:** _(pendiente
> — se ve al asignarlo en el paso 8 de la sección 4)_

### ⚠️ El modo de falla de esta opción, y cuál es la salida

Después de mover el número, **el dialer humano lo va a seguir eligiendo**. Su
rotación recorre todos los números activos del pool del SCM, y mover el número
en Telnyx no lo saca de ese pool: aproximadamente **1 de cada 3 llamadas de
las SDRs va a salir con el número del agente**.

Si Telnyx no permite usar como caller ID, desde la conexión del dialer humano,
un número que ahora vive en la conexión FQDN, **esas llamadas fallan**. Es
exactamente la confirmación 2 de arriba, y por eso la verificación de la
sección 7 exige una llamada humana real después del cambio.

**La salida obvia no funciona.** Marcar el número como inactivo en el panel
Centralita lo saca del pool para el dialer humano, sí — pero también para el
agente: su selector filtra por activo antes de buscar el `fromNumberId`, así
que el agente perdería su caller ID y volvería a rotar sobre los otros dos.

Quedan dos salidas reales, en este orden:

1. **Fijar `countryRouting` para los países que llaman las SDRs** a un número
   que no sea el del agente. El routing por país gana sobre la rotación en el
   dialer humano, así que deja de elegirlo. **Costo:** las SDRs pierden la
   rotación anti-quemado en esos países y quedan pegadas a un solo caller ID.
2. **Revertir a la opción A**: devolver USA 3 a la conexión original y comprar
   un número nuevo para el agente (~$1-2/mes). Es la única salida que no le
   saca nada a nadie.

Si la llamada de verificación falla, no hay que investigar mucho: es esto.

---

## 4. Lado Telnyx — paso a paso

Todo en Mission Control Portal. No hay atajo por API.

1. **`Voice → SIP Trunking → Create SIP Connection`**, tipo **FQDN**.
   ⚠️ **No es el tipo Credential**: ese es el que ya usa la conexión del
   dialer humano. Son tipos distintos y esta tiene que ser FQDN porque **Retell
   no tiene IP fija** para hacer allowlist.
2. **Nombrarla** de forma que se distinga de la existente. Sugerido:
   `Retell Agente IA`.
3. **`Authentication & Routing Configuration → Outbound Calls
   Authentication`** → método **Credentials** → definir usuario y contraseña.
   - **Contraseña fuerte y única**: no reusar la de la conexión del dialer
     humano. Si estas credenciales se filtran, el fraude telefónico se factura
     a esta cuenta.
   - Guardarlas en el gestor de contraseñas. Se necesitan en el paso 5.
   - 🔎 **Depende de lo que veas:** no está confirmado si Telnyx las
     autogenera o hay que tipearlas. Anotar acá cuál fue: _(pendiente)_
4. **`Add FQDN`** → `sip.retellai.com`, tipo de registro DNS **SRV**.
5. **Header obligatorio.** Agregar como custom SIP header:
   **`X-Telnyx-Username: <el usuario del paso 3>`**.
   Telnyx lo exige en las llamadas salientes cuando la autenticación es por
   credenciales. Sin él, el outbound falla — y es de los errores más difíciles
   de adivinar, porque no dice "falta un header".
6. **Inbound settings:** formato de número **`+E.164`**, codecs
   **G722 / G711U / G711A**, transporte **TCP** (preferido sobre UDP), y
   **elegir región SIP**.
   - 🔎 **La región SIP define el FQDN de terminación** que hace falta en el
     paso 5 de la sección siguiente. Anotarla acá: _(pendiente)_
   - El inbound queda restringido a `sip.retellai.com` y autenticado: no dejar
     la conexión aceptando tráfico sin autenticar.
7. **Outbound settings:** crear un **Outbound Voice Profile NUEVO**. No reusar
   el del dialer humano.
   - Es la única forma de tener **límite de gasto diario y CPS propios** para
     el agente. Si el agente se desboca o las credenciales se filtran, el tope
     de ese perfil es el único techo real de la cuenta.
   - Restringir destinos a lo que el piloto necesita (México).
8. **Asignar los números** de la decisión de la sección 3 a esta conexión.
   ⚠️ **Es el paso con más riesgo operativo de toda la secuencia**: acá es
   donde un número puede dejar de estar disponible para las SDRs.

---

## 5. Lado Retell — importar los números

Un número que no está importado en Retell **no se puede usar**: la llamada
falla con un error de `from_number` desconocido.

**Camino 1 — dashboard:** `Phone Numbers → Import`.

**Camino 2 — API (reproducible):**

```bash
curl -X POST https://api.retellai.com/import-phone-number \
  -H "Authorization: Bearer $RETELL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "<E164_DEL_AGENTE>",
    "termination_uri": "<TERMINATION_URI>",
    "sip_trunk_auth_username": "<SIP_USER>",
    "sip_trunk_auth_password": "<SIP_PASS>",
    "transport": "TCP",
    "nickname": "Agente IA - linea 1"
  }'
```

> 🔑 **Todo entre `<…>` son placeholders.** Ni la API key, ni el usuario, ni la
> contraseña del trunk se escriben en este archivo. `$RETELL_API_KEY` se
> exporta en la terminal desde Railway y se borra al cerrarla.

> ⚠️ **`termination_uri` no es un valor fijo.** Depende de la región SIP
> elegida en el paso 6 de la sección anterior. Se copia del dashboard de
> Telnyx, no se asume el genérico.

Los campos opcionales `inbound_agents` / `outbound_agents` (bindear un agente
al número) **probablemente no hacen falta**: el dispatch del SCM manda
`override_agent_id` explícito en cada llamada. Si el primer intento falla con
un error de "no agent bound", probarlos — no genera cargos.

### Registro de lo importado

| E.164 | nickname en Retell | Fecha de import |
|---|---|---|
| _(pendiente)_ | _(pendiente)_ | _(pendiente)_ |

**Región SIP elegida:** _(pendiente)_
**FQDN de terminación:** _(pendiente)_

### Límites de la cuenta Retell (leídos del dashboard, 2026-07-31)

`Workspace SCM → Limits`:

| Límite | Valor | Qué significa acá |
|---|---|---|
| Concurrent Calls Limit | **20** | Llamadas simultáneas. El dispatch corre de a 2: sobra. |
| Concurrency Burst | activado | Permite picos temporales por encima del límite. |
| Reserve Inbound Capacity | Not Set | Correcto: los números del agente no reciben llamadas en v1. |
| LLM Token Limit | 32768 | Muy por encima de los 800-4300 tokens/turno del modo Rigid. |
| **Custom Telephony CPS** | **1** | **El que importa: 1 llamada por segundo para el trunk BYO.** |
| Plan | Free trial | ⚠️ Verificar el crédito disponible antes del piloto. |

> ⚠️ **CPS 1 contra un dispatch que dispara de a 2.** El dispatch del SCM
> lanza los `create-phone-call` con concurrencia **2**, así que en el arranque
> de cada lote puede pedir 2 llamadas dentro del mismo segundo y pasarse del
> CPS de telefonía custom.
>
> **Por qué importa más de lo que parece:** si Retell rechaza la segunda, el
> lead puede terminar con un `disconnection_reason` que el SCM traduce a **"no
> atendió"** — un lead marcado como no-contacto **que nunca sonó**. Eso
> contamina las métricas del piloto y, peor, mete al lead en la cadencia de
> reintentos por una llamada que no existió.
>
> **Qué mirar en el primer lote:** llamadas que vuelven como `no_answer` con
> duración 0 y sin timbrado. Si aparecen, la causa es el CPS, no el número ni
> el agente. Se arregla subiendo el límite desde `Limits → Custom Telephony
> CPS → Adjust Limit`, o bajando la concurrencia del dispatch a 1 (un cambio
> de una línea en `index.js`, fuera del alcance de esta fase).
>
> La calculadora del propio dashboard, con un perfil de 50 llamadas salientes
> por hora y 25% de atención, recomienda **CPS 1 y concurrencia 5** — o sea que
> para el volumen del piloto el CPS 1 alcanza, siempre que las llamadas no
> salgan de a dos en el mismo segundo.

---

## 6. Enganchar con el SCM

`PUT /api/retell/config` (admin) con **`fromNumberId`** = el id del número del
agente en el panel Centralita (formato `telnyx_num_…`).

Según la decisión de la sección 3:

```json
{ "fromNumberId": "telnyx_num_1783725955014_ctkmvz", "enabled": false }
```

Dejar **`enabled: false`**: todavía no se llama a nadie.

> Los 3 secretos (`apiKey`, `webhookSecret`, `toolSecret`) vienen de env vars
> de Railway y el PUT los **rechaza con 409** si se mandan. No incluirlos en el
> body.

### Por qué fijar `fromNumberId` y no confiar en la rotación

El selector de caller ID del agente elige en este orden:

1. **`fromNumberId`**, si está seteado y ese número está activo en el pool →
   **ese, sin rotar**.
2. `countryRouting[país destino]`, si existe.
3. Si el pool tiene más de un número → **rotación round-robin sobre TODOS los
   números activos**.
4. `countryRouting.default`.
5. El primero del pool.

Hoy, con `fromNumberId` vacío y `MX` vacío, el agente caería en el punto 3 y
**rotaría sobre los 3 números**. Si solo algunos están importados en Retell,
las llamadas que salgan con los otros fallan — y **el lote sale a medias sin
que se rompa nada visible**: el dispatch reporta el error por lead y sigue con
el siguiente.

> ⚠️ **El endpoint no valida el `fromNumberId` contra el pool.** Guarda
> cualquier string. Un id mal tipeado no da error: simplemente no matchea
> ningún número, el selector cae al punto 2 y el agente vuelve a rotar. Por eso
> el paso de verificación de abajo lee la config de vuelta.

---

## 7. Verificación

### Lo que se puede verificar en este punto

- [ ] **`GET /api/retell/config`** (admin) devuelve el `fromNumberId` esperado
      y `enabled: false`.
- [ ] **El dialer humano sigue vivo.** Una SDR (o vos desde el Power Dialer)
      completa una llamada normal después del cambio. Si falla, es la
      consecuencia prevista en la decisión de la sección 3: anotarlo y volver
      ahí.
- [ ] Los números del agente aparecen importados en el dashboard de Retell.

### Lo que NO se puede verificar todavía, y por qué

El dry-run del dispatch —`POST /api/admin/voice-agent/dispatch` con
`{"dryRun": true, "country": "MX", "count": 3}`— es la forma de ver qué caller
ID va a usar el agente **sin gastar un centavo**: esa rama corta antes de
cualquier llamada a Retell y no toca el contador diario.

**Pero no corre en este punto.** El handler chequea, en este orden y *antes* de
llegar a la rama de dry-run:

| Guard | Respuesta | Estado hoy |
|---|---|---|
| `enabled !== true` | 409 «El agente está apagado.» | ⛔ `enabled` queda en `false` a propósito |
| API key vacía | 503 | ✅ está en Railway |
| `agentId` vacío | 409 «Falta configurar el agentId de Retell.» | ⛔ el agente todavía no existe |
| Sin números activos | 409 | ✅ hay 3 |

O sea: **el dry-run necesita el agente ya publicado (`agentId`) y `enabled` en
`true`**, y las dos cosas llegan recién al cargar el agente en el dashboard.
Pedirlo antes devuelve un 409 que **parece** un problema del trunk y no lo es.

> ✅ **Dónde va entonces:** el dry-run es el chequeo **pre-vuelo del plan
> 26-04**, justo antes de la primera llamada de prueba — momento en el que
> `enabled` se enciende igual. Ahí tiene que devolver `dryRun: true` y
> `dispatched[].fromNumber` = el número del agente en **todas** las filas.
> Si devuelve `selected: 0`, es que todavía no hay leads asignados al agente:
> esperable hasta que el plan 26-06 arme el lote.

---

## 8. Troubleshooting

| Síntoma | Dónde mirar |
|---|---|
| **Outbound falla** (la llamada no sale) | El FQDN de terminación, las credenciales, y sobre todo el header **`X-Telnyx-Username`** — es el que más se olvida. |
| **Inbound falla** | El FQDN (`sip.retellai.com`, registro SRV) y los inbound settings de la conexión. |
| **`create-phone-call` responde error de `from_number`** | Ese número **no está importado en Retell**. Sección 5. |
| **Código SIP `608` en los logs de Telnyx** | La llamada fue **rechazada por estar marcada como spam likely**. No es un problema de configuración: es reputación del caller ID. Sección 10. |
| **El lote sale a medias, unas llamadas sí y otras no** | El agente está rotando hacia números no importados. Fijar `fromNumberId`. Sección 6. |
| **Llamadas que vuelven `no_answer` con duración 0 y sin timbrado** | Sospechar el **Custom Telephony CPS = 1** contra la concurrencia 2 del dispatch, no el número. Sección 5. |
| **409 «El agente está apagado» al correr el dry-run** | Esperado antes del plan 26-04. Sección 7. |

---

## 9. Facturación: ¿se cobra el timbrado?

**Es la pregunta más cara de la fase y no se puede responder desde acá.**

La página de precios de Retell dice que solo se cobra lo conectado: *"You are
only charged for connected calls"*. Pero un ingeniero de Retell, en el foro
oficial, describe que la facturación arranca en el `200 OK` de la pata SIP y
que se cobra la duración completa de esa pata.

Los dos escenarios **no son el mismo** —el del foro tiene el `INVITE` en la
dirección contraria a la nuestra— y no hay documentación pública que hable del
caso exacto: `create-phone-call` saliente + trunk BYO + destino que no atiende.

### El texto a mandar, tal cual

> "Uso `create-phone-call` con un número importado vía SIP trunk BYO (Telnyx,
> elastic trunking). Para llamadas donde el destino NO atiende
> (`disconnection_reason` = `dial_no_answer` / `dial_busy` /
> `registered_call_timeout`), ¿Retell factura el tiempo de timbrado igual, o
> solo se factura si el destino efectivamente atiende?"

Canal: chat del dashboard de Retell o `support@retellai.com`.

| Fecha de envio | Canal | Fecha de respuesta | Respuesta |
|---|---|---|---|
| _(pendiente — borrador listo 2026-07-31)_ | email a `support@retellai.com` | _(pendiente)_ | _(pendiente)_ |

**Estado:** el borrador está escrito en el Gmail de la cuenta, listo para
enviar con un click (asunto: *"Billing question: is ring time billed on
create-phone-call with a BYO SIP trunk?"*). Va **en inglés** —el soporte de
Retell lo es—, con el mismo contenido que el texto de arriba más las dos
fuentes contradictorias citadas, para que no puedan responder con un link a
la página de precios.

Si el chat del dashboard responde más rápido, sirve igual: es el mismo
contenido y no hace falta mandar las dos cosas.

### Por qué bloquea el tamaño del piloto

Con una tasa de atención típica de cold calling (15-25%), si el timbrado se
cobra igual, **el costo por conversación se multiplica 4-6x**:

| Escenario | Presupuesto ~$50 rinde |
|---|---|
| Solo se cobra lo conectado | ~145-210 llamadas conectadas de 2 min |
| Se cobra también el timbrado | **~25-40** llamadas conectadas |

**Verificación de respaldo, por si soporte tarda:** correr el primer lote de 10
y comparar el total facturado en el dashboard de billing de Retell contra la
suma de duración real de los transcripts (visible en la biblioteca de
Entrenamiento IA del SCM). Si lo facturado es bastante mayor, aplica el
escenario caro.

---

## 10. Reputación de los números (spam)

Retell ofrece **"Verified Phone Number"** (registra el número con carriers para
que no se marque como spam) y **"Branded Call"** (el destinatario ve el nombre
del negocio). Los dos requieren un Business Profile verificado, y el primero
tarda **1-2 semanas**.

**Los dos son solo para números de EEUU** — confirmado explícitamente en la
documentación. Los números de la cuenta son de EEUU (área 786), así que son
elegibles.

> ⚠️ **Pero eso no significa que sirvan para México.** Estos servicios operan
> sobre la infraestructura anti-robocall estadounidense. Cómo puntúa de spam
> una carrier **mexicana** es un sistema distinto y territorial, y la
> documentación de Retell no aclara si el registro tiene algún efecto en
> destinos internacionales. **Es un unknown**, no un hecho en contra.

**El chequeo que sí vale** es el empírico: llamar desde cada número a un
teléfono propio en México y ver si el celular muestra aviso de spam. Lo
ejecuta el plan **26-05** como parte de la compuerta antes de gastar.

Dos notas más:

- **No hay recomendación oficial de volumen máximo por número por día.** La
  rotación de caller ID que ya usa el dialer humano es la mitigación general
  disponible; aplicarla también al agente es coherente. Ojo con la tensión:
  fijar `fromNumberId` (sección 6) **desactiva la rotación** a propósito. Es el
  trade-off correcto para el piloto —garantiza que solo se use un número
  importado— pero si el volumen sube, hay que importar los demás y soltar el
  `fromNumberId`.
- **iOS 26** puede aplicar screening a números desconocidos. La recomendación
  de Retell es que el agente se presente y explique por qué llama, cosa que el
  opener del diseño ya hace.
