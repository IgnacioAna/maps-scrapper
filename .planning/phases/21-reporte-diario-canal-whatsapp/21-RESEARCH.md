# Phase 21: Reporte diario + canal WhatsApp — Research (SCOPED: transporte desktop wa-multi)

**Researched:** 2026-07-26
**Domain:** Electron desktop (wa-multi) — localización y envío a un chat de GRUPO en WhatsApp Web, vía DOM scraping + tipeo OS-level (sin librerías tipo whatsapp-web.js/Baileys)
**Confidence:** MEDIA — el mecanismo recomendado está construido sobre código y comentarios REALES del propio wa-multi (alta confianza), pero ningún selector de WhatsApp Web se pudo probar contra la app corriendo en esta sesión (sin acceso a Electron/WhatsApp Web en vivo). Ver `## Verificación en vivo obligatoria`.

**Alcance:** este documento cubre SOLO el gap marcado en D-03 (cómo localizar y mandar a un GRUPO desde wa-multi). El resto de la Phase 21 (builder del reporte, cola, cron, config del panel) ya está resuelto en `21-CONTEXT.md` con referencias de código verificadas — no se investiga de nuevo acá.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Decisiones cerradas relevantes a este research (copiadas de `21-CONTEXT.md`)

- **D-01:** El canal es el desktop wa-multi, no el servidor. Railway emite un
  comando Socket.io a la máquina del user; wa-multi abre WhatsApp Web con la
  sesión del número dedicado, encuentra el grupo, tipea el mensaje, reporta
  éxito/fallo. La máquina del user queda prendida. NO se reabre la idea de
  Baileys/whatsapp-web.js/Business API — está cerrado.
- **D-02:** Grupo, con DMs individuales como respaldo automático. Si el grupo
  no se encuentra al momento del envío, se mandan los 3 mensajes individuales.
  NO se pierde silenciosamente.
- **D-03:** El identificador del grupo NO se "averigua" vía JID de protocolo —
  se captura eligiendo el grupo de una lista, una sola vez, en el setup. El
  desktop maneja WhatsApp Web como una persona (deeplink `send?phone=` + tipeo
  OS-level, `out/main/index.js:630` y `:736`); no existe `send?group=`.
  ⚠️ A verificar en implementación: que el identificador esté disponible y
  estable en el DOM. **Si no lo está, fallback a búsqueda por nombre del
  grupo** (cláusula de fallback ya pre-aprobada por el user).
- **D-05:** El próximo mensaje que sí sale confiesa los baches (reintentos +
  aviso inline); nunca falla en silencio.
- **D-06:** El servicio de envío se construye GENÉRICO desde esta fase — acepta
  cualquier texto al grupo, no solo reportes (sirve para Phase 23 después).
- **D-07:** Número de WhatsApp NUEVO y dedicado, a crear por el user. Las 3
  cuentas existentes (Delfina/Sofia/Ignacio 2, todas QR_PENDING) NO se usan.
- **D-08:** Encendido directo al grupo apenas existan número y grupo — sin
  período de prueba a un chat propio (riesgo asumido por el user).

### Claude's Discretion (áreas donde este research debe recomendar, no solo listar opciones)

- Guard de alcanzabilidad antes de emitir: `isUserOnline` — `sendToUser`
  devuelve `true` con room vacía, no confiar en él (REP-07).
- Si la app queda abierta en dos computadoras, emitir el comando a UNA sola
  (evitar envío duplicado al grupo).
- **Detalle del repack de wa-multi (búsqueda/selección del grupo, captura del
  identificador, evento de resultado)** — es exactamente el objeto de este
  research.

### Deferred (fuera de este research)

- Reporte individual a cada vendedora, fallback a email, feriados, hardening
  del semanal — todo fuera de scope acá; no se investigó.
</user_constraints>

<phase_requirements>
## Phase Requirements (parte de transporte)

| ID | Descripción | Soporte de este research |
|----|-------------|---------------------------|
| REP-06 | El reporte llega al grupo de WhatsApp | Mecanismo de localización + envío a grupo (Q1, Q2, Q3) + verificación de que se mandó al chat correcto (Q4) |
| REP-07 | Guard de alcanzabilidad ANTES de emitir (`isUserOnline`) | Confirmado: `sendToUser` NO reporta si el room está vacío (`src/wa/gateway.js:344-348`); el guard debe vivir en el llamador (server), no en wa-multi. Además: `isUserOnline` mide sockets del usuario, NO si la cuenta WA dedicada está conectada — ver Landmine L4. |
| REP-08 | Cola persistida, éxito/fallo reportado de forma confiable | Contrato de evento NUEVO (Q5) que corrige el patrón optimista de `scheduledMessagesTick` (marca `'sent'` sin esperar confirmación — ver hallazgo en Q5) |
</phase_requirements>

---

## Summary

wa-multi hoy solo sabe abrir un chat por **teléfono** (`https://web.whatsapp.com/send?phone=<num>`,
`out/main/index.js:736`) y tipear con eventos de input a nivel de OS
(`sendInputEvent`, no DOM). WhatsApp no tiene un deeplink equivalente para
grupos, así que localizar el grupo requiere manejar la UI de WhatsApp Web
"como una persona" — exactamente el mismo nivel de técnica que ya usa el
código existente, no algo cualitativamente distinto.

**Recomendación central:** el mecanismo MÁS robusto y de MENOR riesgo de
implementación es **fijar (pin) el chat del grupo dentro de WhatsApp** durante
el setup, y que wa-multi simplemente abra siempre la **primera fila** de la
lista de chats (`#pane-side`). Los chats fijados en WhatsApp se ordenan
primero de forma nativa e **independiente del nombre** — sobrevive un rename
sin que el código tenga que buscar nada por texto. Esto reutiliza selectores
que YA existen y funcionan en este código (`detectors.unreadChats()` en
`out/preload/whatsapp.js:275-304`), en vez de inventar selectores nuevos para
una caja de búsqueda (que sí harían falta como fallback, y esos SON el punto
de mayor incertidumbre — ver Q2).

Como red de seguridad (no como mecanismo de localización), el setup también
debe capturar el **JID interno del grupo** (`...@g.us`) leyendo el atributo
`data-id` de una burbuja de mensaje ya enviada — el propio código de wa-multi
ya documenta este formato (`out/preload/whatsapp.js:349-351`,
`"true_<chatId>_<msgId>"`). Este JID sirve para VERIFICAR que la fila
abierta es la correcta antes de tipear (aborta → dispara D-02), no para
"saltar" directamente a un chat (no existe ese mecanismo sin reescribir el
enfoque completo — ver `## ⚠️ Riesgo sobre una decisión cerrada`).

**El resto del pipeline de envío (composer, tipeo OS-level, botón enviar) es
100% reusable sin cambios** — `sendReplyInActiveChat` (línea 839) ya prueba
que ese código no le importa si el chat está abierto por teléfono, por grupo,
o por click manual: una vez que hay un chat abierto, el resto es genérico.

**Repack:** procedimiento ya ejecutado dos veces en este proyecto (v0.5.9,
v0.5.10) y documentado paso a paso en `.planning/phases/08-anti-deteccion-proxy-fingerprint/VERIFICATION.md:8-16`.
No hay sorpresas nuevas — se repite el mismo patrón.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Construir el texto del reporte | API/Backend (Railway) | — | Ya resuelto en CONTEXT.md, fuera de este scope |
| Decidir A QUIÉN mandar y CUÁNDO (cola, guard, reintentos) | API/Backend (Railway) | — | `reports.json` + tick propio, patrón `scheduledMessagesTick` (fuera de este scope salvo el contrato de evento, Q5) |
| Transporte real del mensaje (abrir WhatsApp Web, tipear, enviar) | Desktop/Cliente (wa-multi, Electron) | — | Es la ÚNICA pieza que puede hablar con WhatsApp — el server no tiene sesión de WhatsApp |
| Localizar el chat de grupo dentro de WhatsApp Web | Desktop/Cliente (wa-multi) | — | DOM scraping + click, corre en el proceso principal de Electron vía `webContents.executeJavaScript` |
| Config de qué grupo/qué cuenta (persistencia) | API/Backend (`reports.json`) | Desktop (electron-store, solo credenciales de sesión) | El desktop NO debe ser la fuente de verdad de config — si cambia de PC se perdería; ya hay precedente de que la config de negocio vive en Railway (Centro de Comando, D-29) |

---

## Q1 — Camino de envío actual: paso a paso

`sendMessageInWindow(account, phone, text, emitEvent)` (`out/main/index.js:609`)
es solo un wrapper que serializa el envío por cuenta vía `enqueueSend`
(línea 610, 177-185: cola de promesas por `accountId`, evita que dos sends
concurrentes en la MISMA ventana se pisen). El trabajo real está en
`sendMessageInWindowInner` (línea 707):

1. **Auto-abrir ventana si no existe** (718-722): si `openWindows.get(account.id)`
   es null, llama `openAccountWindow` y espera 5s fijos. `openWindows` es un
   `Map` que solo se llena cuando algo pide abrir la cuenta — **no hay
   auto-apertura al bootear la app** (confirmado: no hay ningún
   `openAccountWindow` en `bootSessionFromStore`, línea 1374-1390, ni en
   `app.whenReady()`). Ver Landmine L2.
2. **`bringToFront(win)`** (726, función en 242-249): `restore()` + `show()` +
   `focus()` + `moveTop()` + sleep 300ms. Esto es NECESARIO para que
   `sendInputEvent` funcione de forma confiable (ventanas en background sufren
   throttling de Chromium) — el código ya lo hace así por algo, aunque no hay
   comentario explícito sobre el motivo. `[ASSUMED]` el motivo exacto (background
   throttling); `[VERIFIED: código]` que la llamada existe y es obligatoria antes
   de tipear.
3. **`loadURL('https://web.whatsapp.com/send?phone=' + cleanPhone)`** (736-743):
   **ESTA es la única parte 100% phone-específica de todo el flujo.** Un
   comentario del propio v0.5.10 (733-735) aclara que YA NO se precarga el
   texto por URL (`&text=`) a propósito — eso pega el mensaje de golpe (tell de
   bot); cargar solo `?phone=` deja el composer vacío y fuerza el camino de
   `osTypeText`.
4. **Esperar el composer** (745-759): polling de hasta 30×700ms (~21s máx)
   buscando `COMPOSER_SELECTORS_JS` (línea 80-86: 5 selectores encadenados,
   con variantes ES/EN/PT vía `aria-label*="..." i`) usando `getElementCoords`
   (218-241, hace un `executeJavaScript` que lee `getBoundingClientRect`). Si
   no aparece, se checkea si la página dice "no está en WhatsApp" (761-776) y
   se corta con reason descriptivo — **esta lógica NO depende del teléfono, es
   genérica de "esperar composer"** y 100% reusable.
5. **Click OS-level en el composer** (778, `osClickAt` en 188-197: 3 eventos
   `sendInputEvent` — mouseMove/mouseDown/mouseUp — con delays random).
6. **Tipear** (780-799): si el composer está vacío (siempre, desde el punto 3),
   `osTypeText` (199-211): un `sendInputEvent({type:'char', keyCode: ch})` por
   carácter, con delays 20-130ms variables por tipo de char + pausas random
   ocasionales — **totalmente genérico, no le importa a qué chat le está
   tipeando.**
7. **Enviar** (800-819): busca `SEND_BTN_SELECTORS_JS` (87-93) y hace
   `osClickAt`; si no lo encuentra, `osPressKey(win, 'Return')` (212-217).
   **Genérico.**
8. **Reporta resultado** (824-837) vía `emitEvent(accountId, 'message-send-attempted', {phone, text, result, dailyCount, dailyCap})`.

**Confirmación de que el pipeline post-apertura es genérico:** `sendReplyInActiveChat`
(línea 839-862) es una función DISTINTA que NO usa `loadURL` en absoluto — asume
que YA hay un chat abierto (abre el primer chat con badge de no-leído) y tipea
directamente con `document.execCommand('insertText', ...)` + click en el botón
enviar. Es la prueba en código de que **"tener un chat abierto" y "tipear+enviar"
son dos pasos independientes** — el segundo no sabe ni le importa cómo se llegó
al primero. Esto es la base de la Recomendación de Q2/Q3: solo hay que
reemplazar el paso 3 (`loadURL(?phone=)`) por una secuencia de apertura de
grupo; los pasos 4-8 se reusan tal cual (con una salvedad: `sendReplyInActiveChat`
usa `execCommand('insertText', ...)` DOM en vez de `osTypeText` OS-level — para
el reporte, usar `osTypeText` como en `sendMessageInWindowInner`, consistente
con la política anti-detección "tipeo humano" de v0.5.10).

**Tipeo: OS-level, no DOM.** Confirmado en 199-211 y en el comentario de
733-735 — es una decisión explícita de v0.5.10 para no parecer un bot. Esto
importa para Q7 (landmine de foco/foreground).

---

## Q2 — Localizar un chat de grupo: mecanismos rankeados

### 🥇 Recomendado — Chat fijado (pin) + abrir la primera fila de `#pane-side`

**Mecanismo:** durante el setup, el user (o el propio flujo) fija el grupo en
WhatsApp (clic derecho → "Fijar chat" / long-press en el número dedicado —
acción manual de WhatsApp, no requiere código). Los chats fijados en
WhatsApp SIEMPRE se ordenan primero en la lista, con posición independiente
del nombre del chat. wa-multi entonces:

1. Se asegura de estar en la vista de lista de chats (no dentro de un chat
   específico ni en configuración) — leer `document.querySelector('#pane-side')`
   existe (ya usado por `detectors.connected()`, `whatsapp.js:263`).
2. Toma la PRIMERA fila renderizada: mismos selectores que
   `detectors.unreadChats()` (`whatsapp.js:277`: `document.querySelectorAll('[data-testid="cell-frame-container"], div[role="listitem"]')`)
   pero sin el filtro de "tiene badge de no leído" — simplemente `items[0]`.
3. Extrae el nombre visible con la MISMA lógica ya probada
   (`item.querySelector('span[title]') || ...`, línea 285) para logging/verificación.
4. `osClickAt` sobre las coordenadas de esa fila (mismo patrón que el composer:
   `getElementCoords` + `osClickAt`).

**Por qué es lo más robusto disponible:** no inventa selectores nuevos (reusa
`unreadChats()`, que YA está probado en producción para leads inbound — Phase
7/8), y el orden "primero por estar fijado" es un comportamiento NATIVO de
WhatsApp que sobrevive un rename del grupo sin ningún código adicional —
resuelve la intención real de D-03 mejor que buscar por nombre.
`[ASSUMED]` — que "Fijar chat" existe y ordena primero en la versión actual de
WhatsApp Web (es un feature estable de WhatsApp desde hace años, pero no
verificado contra la build específica que va a correr en la máquina del user).
**Debe confirmarse en vivo** (ver checklist) que fijar el grupo lo deja en la
posición 0 de `#pane-side` de forma estable.

**Riesgo si algo más queda fijado por encima:** con un número 100% dedicado
(D-07) y un solo grupo, no debería haber otros chats fijados — pero si alguien
un día le escribe al número y esa conversación se fija por error, rompería el
supuesto. Mitigación: la verificación de nombre/JID (mecanismo #2 abajo) atrapa
esto ANTES de tipear.

### 🥈 Red de seguridad — Verificación por JID vía `data-id` de un mensaje

Una vez abierta la fila (por pin o por búsqueda), leer
`document.querySelector('[data-id]')` dentro de la lista de mensajes del chat
abierto. El propio código de wa-multi documenta el formato
(`whatsapp.js:349-351`): `data-id` empieza con `true_<chatId>_<msgId>` (saliente)
o el equivalente para entrante. Para un grupo, `chatId` tiene la forma
`<algo>@g.us` (confirmado por convención pública de WhatsApp para JIDs de
grupo — `[CITED: soporte externo/whatsapp-web.js docs]`, no verificado contra
esta build específica).

**Uso:** NO como mecanismo de navegación (no existe forma de "saltar" a un chat
por JID sin reimplementar el hooking interno de WhatsApp Web — ver el bloque de
riesgo más abajo), sino como **checksum post-apertura**: extraer el JID de la
fila recién abierta y compararlo contra el JID persistido en el setup. Si no
matchea (o no hay ningún mensaje en el chat para leer un `data-id`) → tratar
como "grupo no encontrado" → dispara D-02.

**Captura del JID en el setup:** el momento natural es el PRIMER envío de
prueba real (el botón "mandar ahora" de D-29, que de todas formas hace falta
para validar el molde per D-09/REP-05) — recién ahí hay al menos un mensaje
saliente en el chat del cual leer `data-id`. Antes de ese primer envío, el
JID persistido queda `null` y la verificación se salta (solo hay nombre).

### 🥉 Fallback explícito (D-03) — Buscar por nombre en la caja de búsqueda

Si el pin se rompe (alguien lo desfija, o aparece otro chat fijado por
encima), fallback a escribir el nombre del grupo (persistido en `reports.json`,
config del panel D-29) en la caja de búsqueda de WhatsApp Web y clickear el
primer resultado.

**Esto es lo MENOS grounded del research** — el código actual de wa-multi
**no tiene ninguna interacción con la caja de búsqueda** (nunca la usó, todo
pasa por el deeplink `?phone=`). Los selectores candidatos (contenteditable
con `aria-label` tipo "Buscar o empezar un chat nuevo" / "Search or start new
chat") son `[ASSUMED]` por conocimiento general de WhatsApp Web, siguiendo el
MISMO patrón multi-idioma que `COMPOSER_SELECTORS_JS` — pero ninguno fue
probado. **Debe verificarse en vivo con DevTools antes de confiar en este
fallback.** Además: buscar por nombre **NO sobrevive un rename** (por
definición, busca por el nombre viejo) — es un fallback de emergencia que
requiere reconfigurar el setup si el grupo cambió de nombre Y se desfijó, un
escenario doblemente improbable pero posible.

### Descartado — Navegar directamente por JID/Store interno

Ver `## ⚠️ Riesgo sobre una decisión cerrada` — técnicamente posible en teoría
(lo que hace whatsapp-web.js con `Store.Chat.get(jid)`) pero requiere hookear
los módulos internos de WhatsApp Web (patrón `moduleRaid`), que es un salto de
complejidad y fragilidad enorme respecto al estilo actual del código (DOM +
OS-click), y además **el propio ecosistema de automatización de WhatsApp está
abandonando ese enfoque**: la búsqueda confirma que WhatsApp Web migró a una
build sin Webpack en versiones recientes (2.3000x), rompiendo `moduleRaid` en
whatsapp-web.js y forzando una reescritura completa de su capa de acceso
interno. Esto refuerza — con evidencia externa, no solo la decisión del user —
que el enfoque DOM+click de wa-multi es el más resistente a cambios de
WhatsApp Web, no el más frágil.

---

## Q3 — Flujo de captura en el setup (D-03)

**Qué puede enumerar el preload hoy:** `detectors.unreadChats()`
(`whatsapp.js:275-304`) ya prueba que se puede iterar TODAS las filas visibles
de `#pane-side`/lista de chats y extraer: nombre (`span[title]` o
`span[dir="auto"]`), si es un número de teléfono (regex), y el último mensaje
visible. **Generalizar esta función para NO filtrar por "no leído"** (leer
TODAS las filas renderizadas, no solo las con badge) es el cambio mínimo
necesario para un picker de setup — no hace falta escribir scraping nuevo,
extender el existente.

**Recomendación concreta — qué persistir:**
```
reports.json (server, Railway):
{
  whatsappTransport: {
    accountId: "<id de la cuenta wa-multi dedicada>",
    groupName: "<nombre visible al momento del setup>",   // fallback de búsqueda
    groupJid: null | "<...@g.us>",                          // capturado en el primer envío real, checksum
    jidCapturedAt: null | "<ISO>",
    pinned: true                                            // recordatorio operativo: el user debe fijar el chat
  }
}
```

**Cómo se llega a esa config — dos caminos posibles, con recomendación:**

- **Opción A (recomendada): overlay inyectado dentro de la MISMA ventana de
  WhatsApp Web**, igual patrón que `injectSpeedSelector()` (`whatsapp.js:549-569`)
  o el badge de actividad (`initActivityBadge`, línea 603-647) — ambos ya
  inyectan HTML/CSS/JS con `document.body.appendChild` desde el preload sin
  tocar el bundle de WhatsApp. Un botón flotante "Configurar grupo de
  reportes" abre una lista simple (las filas de `#pane-side` generalizadas,
  arriba) renderizada con `document.createElement`, el user clickea una, y el
  preload manda el resultado por `electron.ipcRenderer.send('wa:event', ...)`
  al main (mismo canal que ya existe, línea 254-257) con un `type` nuevo
  (p.ej. `'report-group-selected'`). El main lo recibe en el listener
  `ipcMain.on('wa:event', ...)` (línea 268) y lo reenvía al server por el
  socket YA conectado (`socket?.emit('report:group-configured', {...})`).
  **Es la opción de MENOR esfuerzo y MÁS consistente con el código existente**
  — cero UI nueva en Vue, cero endpoints REST nuevos en el desktop.

- **Opción B (NO recomendada): UI nueva en el dashboard Vue del admin de
  wa-multi** (`out/renderer/`). Descartada: ese bundle es JS compilado/minificado
  de Vue+Element-Plus (`out/renderer/assets/index--KdEirdQ.js`) sin fuente
  `.vue` disponible en el repo (confirmado: `wa-multi/README.txt:105-108`,
  "el source TypeScript/Electron se extrae del app.asar cuando hace falta" —
  y ni siquiera ESO aplica al renderer Vue, que es un build de Vite, no hay
  forma práctica de re-compilarlo sin las fuentes .vue originales, que no
  existen en este repo). Construir acá sería mucho más caro y arriesgado que
  la Opción A.

**Por qué NO hace falta un endpoint REST nuevo en el desktop:** el único
patrón REST que existe hoy es `ApiClient.listAccounts()` (GET) + login — el
desktop nunca hace POST de config al server. El socket YA conectado
(`socket_ioClient.io(...)`, línea 1220) es el canal natural y ya usado para
mandar eventos desktop→server (`lead:contacted`, `account:event`,
`wamulti:file-result`) — seguir ese patrón evita construir infraestructura
nueva de auth/REST en el cliente Electron.

---

## Q4 — Verificar que el envío realmente pasó

**Señales disponibles, de más a menos confiables:**

1. **Conteo de burbujas salientes antes/después** — mismo mecanismo que
   `_countOutBubbles()` (`whatsapp.js:359-364`): `document.querySelectorAll('[data-id^="true_"]').length`
   (con fallback a `div.message-out`). Si el conteo sube en 1 tras el
   Enter/click de enviar, el mensaje SALIÓ del composer hacia el chat — señal
   fuerte y ya usada en producción para detectar envíos manuales del user.
2. **El `data-id` de la burbuja nueva contiene el JID esperado** — cierra el
   loop de Q2: confirma no solo "se mandó algo" sino "se mandó AL CHAT
   CORRECTO". Esta es la verificación que realmente sirve para D-05 ("nunca
   fallar en silencio") — sin esto, un mensaje que se tipeó en el chat
   EQUIVOCADO (por foco robado, doble-click, etc.) se reportaría como éxito.
3. **Doble tilde / entrega (`span[data-icon="msg-dblcheck"]`)** — descartado
   como criterio de éxito/fallo: depende de que el destinatario tenga
   conexión, puede tardar minutos, y generaría falsos negativos (el mensaje
   SÍ se mandó, solo que nadie lo vio todavía). Puede loguearse best-effort
   para diagnóstico, pero NO debe bloquear el resultado `ok:true`.

**Recomendación:** el criterio de "éxito" para el evento de resultado (Q5) es
`(1) AND (2)` — burbuja nueva + JID coincide (si había JID persistido) o
nombre de header coincide (si todavía no hay JID capturado). El criterio de
"delivery" (ítem 3) es informativo, no gating.

**No se puede verificar en el código** si el `data-id` realmente tiene el
formato `@g.us` para grupos en la build ACTUAL de WhatsApp Web que correrá en
la máquina del user — el propio comentario de wa-multi documenta el formato
general (`true_<chatId>_<msgId>`) pero no un ejemplo de grupo real. **Debe
verificarse en vivo** (DevTools → abrir el grupo real → inspeccionar
`data-id` de un mensaje).

---

## Q5 — Contrato de evento nuevo (genérico, D-06)

### Hallazgo importante sobre el patrón existente (`scheduledMessagesTick`)

`scheduledMessagesTick` (`index.js:5187-5300`) marca `msg.status = 'sent'`
**inmediatamente al emitir** el evento (línea 5279-5282), SIN esperar ninguna
confirmación del desktop. El único feedback que existe hoy
(`followup-failed`, emitido por wa-multi en `out/main/index.js:1316-1320`)
llega a `account:event` en el server (`src/wa/gateway.js:177`) y termina solo
en `appendEvent(...)` (un log de auditoría) — **nunca se correlaciona de
vuelta contra `scheduledMessages.json` para corregir el `status`.** Es decir:
el patrón actual NO tiene un canal de éxito/fallo confiable — es
fire-and-forget optimista. **Este patrón es explícitamente insuficiente para
REP-08** y confirma por qué CONTEXT.md dice "NO reusar el módulo".

### Por qué no usar acks nativos de Socket.IO

`sendToUser` (`src/wa/gateway.js:344-348`) emite con `io.to(room).emit(...)` —
un broadcast a room. Los acks de Socket.IO (`emit(event, payload, cb)`) solo
funcionan en emits directos socket-a-socket, no en broadcasts a room. Por eso
el patrón correcto (y el que ya usa este código para todo lo demás:
`lead:contacted`, `wamulti:file-result`) es un **evento de vuelta separado,
correlacionado por un id explícito** — no es una preferencia estética, es la
única opción compatible con `sendToUser`.

### Evento server → desktop: `report:send-message`

```js
{
  queueId: "rpt_2026-07-26_001",   // id del item en la cola nueva (reports.json) — clave de correlación
  accountId: "<wa-multi accountId de la cuenta dedicada>",
  text: "<mensaje ya armado, texto plano>",
  target: {
    kind: "group",                  // "group" | "dm" (D-02 fallback reusa el mismo evento con kind:"dm")
    groupName: "<nombre persistido, fallback de búsqueda>",
    groupJid: "<...@g.us o null>"   // checksum; null hasta que el primer envío lo capture
  },
  dmFallback: ["<tel1>", "<tel2>", "<tel3>"]  // D-02: si kind:"group" falla, el SERVER decide si reintenta
                                                // con kind:"dm" por cada uno (más simple) o el desktop lo hace en cadena.
                                                // Recomendado: el SERVER orquesta el fallback (manda 3 eventos
                                                // kind:"dm" separados si el primero falla) — más fácil de debuggear
                                                // que meter la lógica de fallback dentro del desktop.
}
```

### Evento desktop → server: `report:send-result`

```js
{
  queueId: "rpt_2026-07-26_001",   // ecoa el mismo id — correlación
  accountId: "...",
  ok: true | false,
  method: "pinned-row0" | "search-by-name" | "dm",
  reason: null | "account-not-connected" | "group-not-found" | "jid-mismatch"
        | "composer-not-found" | "not-on-whatsapp" | "exception",
  matchedName: "<texto del header leído>" | null,   // diagnóstico
  matchedJid: "<...@g.us>" | null,                   // diagnóstico + permite BACKFILLEAR groupJid si todavía era null
  sentAt: "<ISO>"
}
```

Emitido con `socket.emit('report:send-result', {...})` desde wa-multi —
agregar un handler NUEVO en `connectSocket()` (junto a `followup:send-message`,
`out/main/index.js:1292-1323`), no reusar `followup:send-message` (ese está
atado a `targetPhone`, per canonical_refs).

### Cómo debe correlacionar el server (nueva cola, NO `scheduledMessagesTick`)

Al emitir, marcar el item como `'sending'` (no `'sent'`) + un timeout (recomendado
45-60s, generoso porque el flujo real puede tardar ~20s solo en el polling del
composer si la ventana estaba fría). Dos caminos de resolución:
1. Llega `report:send-result` con el mismo `queueId` → transicionar a
   `'sent'`/`'failed'` según `ok`, guardar `reason`/diagnóstico.
2. Vence el timeout sin resultado (desktop se colgó, perdió el socket a mitad
   de envío) → tratar como `'failed'`, reintentar según la política de
   reintentos de D-05.

Esto es exactamente el patrón "copiar `scheduledMessagesTick`, NO reusar el
módulo" de CONTEXT.md — mismo esqueleto (tick, FIFO, stagger), pero con el
`status='sending'`+timeout en vez del `status='sent'` optimista.

### Evento adicional de setup: `report:group-configured` (desktop → server)

Separado del flujo de envío (Q3): `{accountId, groupName, groupJid: null}` la
primera vez (antes del primer envío real), y el propio `report:send-result`
del primer envío exitoso backfillea `groupJid` si vino `matchedJid` y todavía
estaba `null` en `reports.json`.

---

## Q6 — Mecánica exacta del repack

**Procedimiento ya ejecutado 2 veces en este proyecto** (v0.5.8→v0.5.9,
v0.5.9→v0.5.10) y documentado en
`.planning/phases/08-anti-deteccion-proxy-fingerprint/VERIFICATION.md:8-16`:

> "se copió el portable v0.5.8 → v0.5.9, se extrajo el `app.asar` con
> `@electron/asar`, se reemplazaron `out/main/index.js` (62KB, 7 matches
> proxy) y `out/preload/whatsapp.js` (28KB, geo), se bumpeó `package.json` a
> 0.5.9, y se repackeó el asar. Verificado: el asar nuevo contiene el código
> de Phase 8. NO se corrió `npm run build`."

**Para esta fase (v0.5.10 → v0.5.11), pasos concretos:**

1. **Editar el código fuente de trabajo directamente** en
   `wa-multi/src-v058-work/out/main/index.js` (agregar la función de envío a
   grupo + el nuevo handler de socket `report:send-message` +
   `report:group-configured`) y
   `wa-multi/src-v058-work/out/preload/whatsapp.js` (generalizar
   `unreadChats()` para el picker + overlay de setup). Esta carpeta `out/` YA
   ES la fuente editable (regla del proyecto, CLAUDE.md nota #68 y #132).
2. **Copiar el build actual completo** para no perder los binarios de Electron
   (DLLs, `.pak`, `wa-multi.exe`, etc. — no forman parte del asar):
   ```bash
   cp -r "wa-multi/versiones/wa-multi-portable-v0.5.10" \
         "wa-multi/versiones/wa-multi-portable-v0.5.11"
   ```
3. **Backup del asar viejo** (mismo patrón que `wa-multi/backups/app.asar-v057-pre058-20260601.bak`):
   ```bash
   cp "wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar" \
      "wa-multi/backups/app.asar-v0510-pre0511-$(date +%Y%m%d).bak"
   ```
4. **Extraer el asar** de la copia nueva a una carpeta temporal:
   ```bash
   npx @electron/asar extract \
     "wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar" \
     "wa-multi/_asar-extract-v0511"
   ```
5. **Sobrescribir SOLO los 2 archivos modificados** (más cualquier archivo
   nuevo, si se agrega alguno) dentro de la carpeta extraída, copiando desde
   `wa-multi/src-v058-work/out/`:
   ```bash
   cp "wa-multi/src-v058-work/out/main/index.js" \
      "wa-multi/_asar-extract-v0511/out/main/index.js"
   cp "wa-multi/src-v058-work/out/preload/whatsapp.js" \
      "wa-multi/_asar-extract-v0511/out/preload/whatsapp.js"
   ```
6. **Bumpear la versión** en `wa-multi/_asar-extract-v0511/package.json`
   (`"version": "0.5.11"`) — solo bookkeeping, no afecta el funcionamiento.
7. **Re-empaquetar** sobre el mismo path (reemplaza el asar extraído/temporal):
   ```bash
   npx @electron/asar pack \
     "wa-multi/_asar-extract-v0511" \
     "wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/resources/app.asar"
   ```
8. **Borrar la carpeta temporal de extracción** (`_asar-extract-v0511`) — no
   es parte del artefacto final, solo un paso intermedio.
9. **Actualizar `wa-multi/README.txt`** con una sección "Cambios v0.5.11 vs
   v0.5.10" (mismo formato que las entradas existentes) y actualizar el
   apunte de "Versión actual" al tope del archivo.
10. **Actualizar la referencia canónica** en cualquier doc que apunte al
    v0.5.10 (`21-CONTEXT.md` línea 321, futuros PLAN.md) al nuevo path
    `wa-multi-portable-v0.5.11`.
11. **Qué debe hacer el user:** cerrar `wa-multi.exe` si estaba corriendo
    (matar el proceso — el propio proyecto tiene `taskkill /F /IM wa-multi.exe`
    en `package.json` de wa-multi como referencia de cómo se mata), abrir el
    nuevo `wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe`, loguearse
    de nuevo (la sesión de `electron-store` — `serverUrl`/`token`/`user` — vive
    en `%APPDATA%/wa-multi/config.json`, **por proceso/instalación, no por
    versión de carpeta** — hay que confirmar en vivo si sobrevive el cambio de
    carpeta o si pide login de nuevo), volver a escanear el QR de WhatsApp con
    el número dedicado (la sesión de WhatsApp Web vive en el perfil de Electron
    de esa ventana — casi seguro que si es una carpeta NUEVA, sesión de
    WhatsApp NUEVA, hay que re-escanear QR).

**Cosas que históricamente salieron mal (README.txt) y cómo evitarlas:**
- **NUNCA correr `npm run build` / `dist:win`** — clobberea `out/` entero
  (regenera desde las fuentes .ts que en este repo NO reflejan los parches
  acumulados de v0.5.9/v0.5.10/Phase 21). Confirmado como regla dura en
  CLAUDE.md y en `wa-multi/README.txt:110` ("Para cambios mayores: extraer
  asar → modificar src/ → npm run build → repack" — esa frase es la
  documentación del flujo VIEJO/genérico, pero las notas de Phase 8 y CLAUDE.md
  la contradicen explícitamente para este repo puntual: NO correr build).
- **`@electron/asar` no es una dependencia instalada** en
  `wa-multi/src-v058-work/package.json` (confirmado: no aparece en
  `devDependencies`) — se corre vía `npx @electron/asar ...` (lo descarga al
  vuelo). Confirmar que la máquina donde se ejecuta el repack tiene acceso a
  npm registry.

---

## Q7 — Landmines

**L1 — Doble máquina / envío duplicado.** `sendToUser` (`gateway.js:344-348`)
hace `io.to(room).emit(...)` — si el MISMO user de servidor tiene wa-multi
logueado en dos computadoras a la vez, ambas reciben el comando y ambas
intentarían mandar al grupo → mensaje duplicado. La mitigación de room-target-único
es responsabilidad del server (fuera de este scope), pero el desktop puede
agregar una defensa barata y 100% dentro de este scope: **dedup en memoria por
`queueId`** — un `Set` (o `Map` con TTL de limpieza, ej. 15 min) de
`queueId`s ya procesados; si `report:send-message` llega con un `queueId` ya
visto, ignorar. Cubre el caso de reconexión/replay del socket Y el caso de dos
instancias de wa-multi corriendo con la misma sesión.

**L2 — Ventana/cuenta no abierta al momento del envío.** Confirmado
(`bootSessionFromStore`, líneas 1374-1390): NO hay auto-apertura de cuentas al
bootear la app. `sendMessageInWindowInner` compensa auto-abriendo + esperando
5s fijos (718-722), pero un "cold start" completo de WhatsApp Web (sesión
restaurada desde cero) puede tardar bastante más que eso antes de que el
composer aparezca — el polling de 30×700ms (~21s) en el paso 4 de Q1 lo
cubre, pero el PRIMER envío del día después de un reinicio de la PC puede ser
sensiblemente más lento/riesgoso que los siguientes. **Recomendación:**
agregar auto-apertura de la cuenta dedicada de reportes específicamente al
bootear la app (en `bootSessionFromStore`, después de `setCachedAccounts`,
si existe una cuenta marcada como transporte de reportes) — evita depender de
que el user recuerde abrir esa ventana manualmente además de dejar la app
corriendo.

**L3 — Foco/foreground para tipeo OS-level.** `sendInputEvent` requiere
`bringToFront` (Q1 paso 2), que hace `win.show()` + `moveTop()` — esto **trae
la ventana de WhatsApp al frente de TODAS las ventanas de la PC**, visible para
quien esté usando la máquina en ese momento (23:00 hora de negocio: bajo
riesgo de interferencia, pero no es una operación silenciosa en background).
Esto ya es el comportamiento actual para followups — no es nuevo, pero vale
que el planner lo tenga presente como expectativa (no un bug si el user ve la
ventana "robarle" el foco a las 23:00).

**L4 — `isUserOnline` mide conexión de socket, no estado de sesión de
WhatsApp.** REP-07 dice "guard con `isUserOnline` antes de emitir" — eso
cubre "la PC está prendida y wa-multi corriendo con socket conectado", pero
NO cubre "la cuenta WA dedicada se deslogueó / fue baneada / perdió el QR".
Si eso pasa, `isUserOnline` sigue devolviendo `true` (el socket del user está
conectado), el server emite igual, y el desktop reporta `ok:false,
reason:'account-not-connected'` (chequeable vía `account.status !== 'CONNECTED'`
en `cachedAccounts`, ya trackeado por `emitAccountStatus`/`account:status`,
líneas 271-273 y 1359-1364) — el reason code explícito importa acá para que
D-05 pueda confesar algo específico ("el número dedicado no está conectado a
WhatsApp — hay que reescanear el QR") en vez de un genérico "no se pudo
enviar". **Recomendación:** chequear `account.status` ANTES de intentar abrir
ventana/tipear (fail-fast, evita quemar ~21s de polling del composer sabiendo
de antemano que va a fallar por QR pendiente).

**L5 — Grupo vacío en el momento de capturar el JID.** Si el setup intenta
leer un `data-id` antes de que exista NINGÚN mensaje en el chat (grupo recién
creado, cero mensajes), no hay nada que leer. Cubierto por diseño: el JID se
captura recién en el primer envío real (Q3), momento en el que por definición
ya se mandó al menos un mensaje.

**L6 — `enqueueSend` es por-cuenta, no por-tipo-de-mensaje.** Si en el futuro
(Phase 23) el mismo número dedicado también manda alertas (D-06 lo habilita a
propósito), los envíos se serializan correctamente por la cola existente
(`sendQueues` Map en `out/main/index.js:176-185`) — no hay riesgo de dos
sends pisándose la misma ventana. Ya resuelto por el código existente, sin
cambios necesarios.

**L7 — Selectores de WhatsApp Web cambian con actualizaciones.** Tanto
`COMPOSER_SELECTORS_JS`/`SEND_BTN_SELECTORS_JS` (ya en producción, riesgo
preexistente) como los selectores nuevos de fila/pin que se agreguen están
sujetos a que WhatsApp cambie su HTML. No es nuevo de esta fase, pero la fila
de pin (mecanismo recomendado) tiene MENOS superficie nueva que un selector de
caja de búsqueda inventado desde cero — por eso se lo prioriza.

---

## ⚠️ Riesgo sobre una decisión cerrada

D-03 dice: "se guarda el identificador interno que WhatsApp Web ya expone en
el DOM... Ventaja: sobrevive a que renombren el grupo", y deja como pregunta
abierta si ese identificador es suficiente. La respuesta concreta de este
research: **el identificador (`data-id` → JID `@g.us`) existe y está
documentado por el propio código de wa-multi, pero NO hay ninguna forma
conocida — sin reescribir el enfoque completo — de usar ese identificador
para NAVEGAR directamente a un chat.** WhatsApp Web no expone un deeplink por
JID (confirmado, es la premisa de D-03), y la única vía alternativa conocida
(hookear los módulos internos de WhatsApp Web al estilo `moduleRaid`, que es
como whatsapp-web.js resolvía "abrir chat por id" en versiones viejas) dejó de
ser viable incluso para esa librería: la búsqueda confirma que WhatsApp Web
migró a una build sin Webpack, rompiendo ese mecanismo y forzando una
reescritura completa en whatsapp-web.js. Construir algo equivalente acá sería
más frágil que el propio código que lo inspiraría, y además se acerca
peligrosamente al tipo de reescritura que D-01 cierra explícitamente
("no proponer... rewrites").

**Por eso el JID, en este research, se usa como VERIFICACIÓN (checksum
post-apertura), no como LOCALIZACIÓN.** La localización real que sí sobrevive
un rename es el pin (mecanismo nativo de WhatsApp, sin código), que además es
gratis en términos de selectores nuevos porque reusa `unreadChats()`. Esto
cumple el ESPÍRITU de D-03 (sobrevivir un rename) sin necesitar que el JID
navegue nada — pero es importante que el planner entienda que la frase textual
de D-03 ("el identificador... sobrevive a que renombren el grupo") se cumple
por la combinación pin+checksum, no por el JID solo. Si el user esperaba que
el JID por sí solo resolviera la navegación, esta expectativa no es técnicamente
alcanzable sin el salto de complejidad de arriba — vale confirmarlo con él antes
de planificar, aunque no cambia la decisión cerrada (D-01 sigue siendo el
camino), solo aclara qué hace el JID realmente.

---

## Verificación en vivo obligatoria

Ninguno de estos puntos se pudo confirmar sin una sesión de WhatsApp Web real
(no hay acceso a Electron/WhatsApp Web corriendo en este entorno de research).
**Antes de dar por buena la implementación:**

1. Fijar (pin) un chat de grupo real en WhatsApp Web y confirmar que queda en
   la posición 0 de `#pane-side` / `[data-testid="cell-frame-container"]`,
   de forma estable tras recargar la página.
2. Abrir DevTools sobre una ventana de cuenta de wa-multi con WhatsApp Web
   cargado, inspeccionar el `data-id` de un mensaje saliente en un chat de
   GRUPO real y confirmar el formato exacto (`true_<algo>@g.us_<msgId>` o
   variante) — el código solo documenta el formato general, no un ejemplo de
   grupo.
3. Confirmar los selectores reales de la caja de búsqueda (aria-label
   ES/EN, `data-tab` si existe) — necesarios para el fallback #3 de Q2. Nunca
   probados en este código.
4. Confirmar si `%APPDATA%/wa-multi/config.json` (sesión del login del panel
   SCM) y la sesión de WhatsApp Web (perfil de Electron) sobreviven al cambio
   de carpeta de versión (v0.5.10 → v0.5.11) o si hace falta login + QR de
   nuevo — afecta las instrucciones operativas para el user tras el repack.
5. Confirmar que renombrar el grupo efectivamente NO afecta su posición si
   está fijado (para validar la tesis central de la Recomendación de Q2).
6. Verificar tiempos reales de "cold start" (PC recién prendida → WhatsApp Web
   restaurando sesión → composer disponible) para calibrar el timeout de 45-60s
   propuesto en Q5 (podría necesitar ser mayor para el primer envío del día).
7. Confirmar en vivo el comportamiento de `npx @electron/asar` (extract/pack)
   contra el asar real de v0.5.10 antes de asumir que el flujo del Paso Q6
   corre sin fricciones (versión de asar, compatibilidad).

---

## Assumptions Log

| # | Claim | Sección | Riesgo si está mal |
|---|-------|---------|---------------------|
| A1 | Fijar (pin) un chat en WhatsApp Web lo deja siempre en la posición 0 de la lista de chats, independiente del nombre | Q2 (mecanismo recomendado) | Si no es así, hay que caer directo al fallback de búsqueda por nombre (Q2 #3) como mecanismo PRIMARIO en vez de red de seguridad — más selectores nuevos sin probar |
| A2 | El `data-id` de un mensaje de GRUPO tiene el sufijo `@g.us` en la build actual de WhatsApp Web | Q2/Q3/Q4 (checksum JID) | Si el formato cambió, el checksum de verificación no sirve — hay que ajustar el regex de extracción, pero el mecanismo de localización (pin) no se ve afectado |
| A3 | La caja de búsqueda de WhatsApp Web es un `div[contenteditable="true"]` con `aria-label` tipo "Buscar..." / "Search..." | Q2 (fallback #3) | Si cambió, el fallback de búsqueda por nombre no funciona — hay que inspeccionar selectores reales antes de codear ese camino |
| A4 | La sesión de login del panel SCM (`electron-store`) y la sesión de WhatsApp Web sobreviven al copiar la carpeta de versión a `v0.5.11` | Q6 (repack) | Si no sobreviven, agregar el paso "re-loguearse + re-escanear QR" como instrucción explícita post-repack (ya está mencionado como posible en Q6, pero no confirmado) |
| A5 | El motivo por el que `bringToFront` es obligatorio antes de `sendInputEvent` es evitar throttling de Chromium en ventanas en background | Q1 | Es una inferencia razonable pero no confirmada por comentario en el código; no cambia la recomendación (la llamada ya existe y se debe mantener) |

**Si esta tabla se vacía en una futura revisión:** todo quedó verificado en
vivo — no haría falta la sección de arriba.

---

## Sources

### Primary (HIGH confidence — código del propio repo)
- `wa-multi/src-v058-work/out/main/index.js` (líneas 1-270, 452-882, 993-1010,
  1164-1370, 1391-1500) — pipeline de envío, apertura de ventana, socket,
  contrato de eventos existente.
- `wa-multi/src-v058-work/out/preload/whatsapp.js` (completo) — detectores DOM,
  formato de `data-id`, overlays inyectados existentes (patrón para el picker
  de setup).
- `src/wa/gateway.js` (líneas 170-360) — `isUserOnline`, `sendToUser`,
  `account:event`, límites de acks con room-broadcast.
- `index.js:5126-5306` (`scheduledMessagesTick`) — patrón de cola existente y
  su falla de correlación (fire-and-forget optimista).
- `.planning/phases/21-reporte-diario-canal-whatsapp/21-CONTEXT.md` — decisiones
  cerradas y canonical refs.
- `.planning/phases/08-anti-deteccion-proxy-fingerprint/VERIFICATION.md` —
  procedimiento de repack ya ejecutado dos veces.
- `wa-multi/README.txt` — historial de versiones, advertencia sobre `npm run build`.
- `wa-multi/src-v058-work/package.json` — confirma ausencia de `@electron/asar`
  como dependencia instalada.

### Secondary (MEDIUM confidence — verificado cruzando con fuente externa)
- Formato de JID de WhatsApp (`@g.us` para grupos, `@c.us` para individuales) —
  confirmado por múltiples fuentes externas (soporte de proveedores de API
  WhatsApp, documentación de whatsapp-web.js) consistente con el comentario
  del propio código de wa-multi sobre `data-id`.
- WhatsApp Web migró a una build sin Webpack en versiones recientes,
  rompiendo el mecanismo `moduleRaid` de whatsapp-web.js — confirma que
  hookear internals es una apuesta cada vez más frágil, reforzando la
  decisión D-01/el enfoque DOM+click.

### Tertiary (LOW confidence — no verificado, marcado explícitamente arriba)
- Selectores exactos de la caja de búsqueda de WhatsApp Web (fallback #3 de Q2).
- Comportamiento exacto de "pin" en la build actual (posición 0 garantizada).
- Persistencia de sesión de login/WhatsApp tras mover la carpeta de versión.

---

## Metadata

**Confidence breakdown:**
- Pipeline de envío actual (Q1): ALTA — leído directamente del código, línea por línea.
- Mecanismo de localización de grupo (Q2/Q3): MEDIA — diseño grounded en código existente + comentarios propios del repo, pero CERO selectores de WhatsApp Web probados en vivo.
- Contrato de evento (Q5): ALTA para el diagnóstico del patrón existente (leído del código); MEDIA para la propuesta nueva (diseño, no implementado/probado).
- Repack (Q6): ALTA — procedimiento ya ejecutado 2 veces y documentado en este mismo proyecto.
- Landmines (Q7): ALTA para las que citan código; MEDIA para las inferencias de comportamiento (L1, L3).

**Research date:** 2026-07-26
**Valid until:** hasta el próximo cambio de versión de WhatsApp Web que altere su DOM (impredecible — recomendable re-verificar selectores en cada repack futuro, no solo en este) o ~30 días si no hay cambios visibles.
