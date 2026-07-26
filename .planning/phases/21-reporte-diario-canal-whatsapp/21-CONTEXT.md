# Phase 21: Reporte diario + canal WhatsApp - Context

**Gathered:** 2026-07-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Todos los días llega solo, al grupo de WhatsApp de los 3 socios, un reporte
corto y legible en el preview de la notificación del celular, con las
excepciones arriba. Si la computadora que sostiene el canal está apagada, el
reporte queda en cola y sale consolidado al reconectar. Cubre REP-04..REP-10.

Incluye: builder del reporte diario, builder de texto plano para WhatsApp,
canal de envío al grupo (server → desktop → WhatsApp Web), cola persistida con
consolidación y expiración, config mínima en el panel, y la versión corta del
semanal por el mismo canal.

NO incluye: análisis IA de transcripciones (Phase 22), alertas por excepción
(Phase 23), reporte individual a las vendedoras (diferido, ver `<deferred>`).

</domain>

<decisions>
## Implementation Decisions

### Canal de envío

- **D-01: El canal es el desktop wa-multi, no el servidor.** Railway no puede
  mandar WhatsApp. La cadena es: Railway arma el reporte → emite comando por el
  gateway Socket.io a la máquina del user → wa-multi abre WhatsApp Web con la
  sesión del número dedicado → encuentra el grupo → tipea el mensaje → reporta
  éxito/fallo al server. **El user confirmó que su máquina queda prendida.**
  La app y el flujo WhatsApp de prospección son cosas distintas: el módulo WA
  del panel sigue parkeado; se revive SOLO la app de escritorio como transporte.

- **D-02: Grupo, con DMs individuales como respaldo automático.** Si el grupo
  no se encuentra en el momento del envío, el sistema manda los 3 mensajes
  individuales en vez de perder el reporte. NO se pierde silenciosamente.

- **D-03: El JID no se "averigua" — se captura eligiendo el grupo de una
  lista, una sola vez.** El roadmap planteaba como primera tarea averiguar el
  JID del grupo desde la sesión de wa-multi. **Verificado en código: eso no
  destraba nada.** El desktop maneja WhatsApp Web como una persona (deeplink
  `web.whatsapp.com/send?phone=` + tipeo OS-level en
  [wa-multi/src-v058-work/out/main/index.js:630](wa-multi/src-v058-work/out/main/index.js:630)
  y `:736`); WhatsApp no tiene deeplink equivalente para grupos (`send?group=`
  no existe), así que ningún JID hace funcionar el handler actual.
  **Decisión:** en el setup el desktop muestra la lista de chats, el user elige
  el grupo, y se guarda el identificador interno que WhatsApp Web ya expone en
  el DOM. Ventaja: sobrevive a que renombren el grupo.
  ⚠️ **A verificar en implementación:** que ese identificador esté realmente
  disponible y sea estable en el DOM de WhatsApp Web. **Si no lo está, fallback
  a búsqueda por nombre del grupo** (guardado en la config del panel).

- **D-04: Sin fallback a email.** Si la máquina está apagada, el reporte queda
  en cola y espera — NO sale por email. **Esto acota REP-07 por decisión
  explícita del user.** El envío por email ya existe (`sendWeeklyReport` +
  Resend); dejarlo cableado y apagado detrás de una bandera hace que encenderlo
  después sea configuración, no construcción. Planificar así.

- **D-05: El próximo mensaje que sí sale confiesa los baches.** Si un reporte
  no se pudo enviar, el sistema reintenta solo y el siguiente mensaje exitoso
  arranca con una línea del tipo "no pude enviar el reporte de jueves y
  viernes". Además queda registrado server-side. **NO** avisar solo en el panel
  (el objetivo del milestone es no entrar al panel) ni fallar en silencio.

- **D-06: El servicio de envío se construye GENÉRICO desde esta fase** —
  acepta cualquier mensaje de texto al grupo, no solo reportes. La cola, los
  reintentos y el aviso de fallo sirven igual para las alertas de la Phase 23,
  que así no tiene que reabrir este código.

- **D-07: Número de WhatsApp NUEVO y dedicado**, a crear por el user. Las 3
  cuentas existentes (`Delfina`, `Sofia`, `Ignacio 2`, todas en `QR_PENDING`) NO
  se usan. El WhatsApp personal del user tampoco.

- **D-08: Encendido directo al grupo** apenas el número y el grupo existan —
  sin período de prueba a un chat propio. (Se le advirtió al user el riesgo de
  una línea recién creada que arranca automatizada; decisión asumida.)

- **D-09: Construir sin esperar el número.** Builder + cola + modificación del
  desktop se hacen en paralelo; la prueba en vivo del grupo se hace con el user
  cuando tenga el número. La validación final del molde (REP-05) ocurre ahí.

### Horarios y días

- **D-10: El diario sale a las 23:00 hora de negocio (`BUSINESS_TZ`, AR/UY).**
  Es 20:00 en México. **Reemplaza el 21:00 que se había fijado antes en la
  discusión.** Razón: hay vendedoras en México o similar (confirmado por el
  user), y cortar a las 21:00 AR (18:00 MX) les partiría la tarde y las haría
  aparecer con menos trabajo del real. Corte ÚNICO para todo el equipo — no se
  calcula el día por huso de cada vendedora (el sistema no guarda el país de
  cada una y esperar a la más occidental empujaría el mensaje a la madrugada).
  Dato de referencia: el histórico no tiene NINGUNA llamada después de las 21:00
  AR, y el 9% cae entre 20:00 y 21:00 AR.

- **D-11: Lunes a viernes SIEMPRE, aun con el equipo entero en cero.** Un día
  hábil sin una sola llamada del equipo es LA noticia; se dice en una línea
  ("hoy no llamó nadie"), no listando seis nombres con ceros. No se implementa
  calendario de feriados (tres países, mantenimiento anual, poco valor).

- **D-12: Sábado y domingo, solo si hubo actividad.** El histórico tiene cero
  llamadas todos los fines de semana; un mensaje vacío dos veces por semana
  entrena al grupo a no leer. (Contra asumido: el silencio del finde no
  distingue "nadie trabajó" de "el envío falló" — mitigado por D-05.)

- **D-13: El semanal también va al grupo, domingo 23:00**, misma hora que el
  diario. El mail HTML detallado se mueve TAMBIÉN al domingo 23:00 — un solo
  momento y un solo reporte por las dos vías. **Implica correr la ventana del
  semanal**: de "la semana anterior completa (lunes a lunes)" a "la semana que
  termina hoy (lunes a domingo)". Hoy el cron es lunes 8am
  ([index.js:1894](index.js:1894) `maybeRunWeeklyReportCron`).

### Quién sale como "sin actividad"

- **D-14: Solo entran a la línea de alerta las que ya hicieron su primera
  llamada.** Dato real: Dalia, Adela y Melissa nunca discaron (0 llamadas
  histórico); Judith 143, Teresa 165, Brenda 74. Si el criterio fuera "cero
  llamadas hoy", esa línea diría los mismos tres nombres todos los días para
  siempre y dejaría de leerse.

- **D-15: Las que nunca arrancaron van en una línea propia al final**
  ("Sin arrancar: Dalia, Adela, Melissa"), fuera de la alerta. Salen solas de
  esa línea cuando hacen su primera llamada. Sin intervención manual.

- **D-16: A los 5 días hábiles seguidos sin llamar, la vendedora ESCALA** —
  sale de la lista de "sin actividad hoy" y pasa a una línea propia con el
  conteo ("Teresa: 8 días sin llamar"). Es una escalada, no un ocultamiento:
  una línea con nombre y días pesa más que estar en una enumeración. Resuelve
  el caso de quien renuncia o se va sin que nadie tenga que desmarcarla.

- **D-17: "Sin actividad" = cero llamadas exactas.** Sin umbrales de "actividad
  baja" ni comparación contra el promedio propio (con 3 vendedoras y pocas
  semanas de historia el promedio no significa nada). Quien hizo pocas llamadas
  aparece en su fila con su número real y se lee solo.

- **D-18: Marca de ausencia con fecha de vencimiento.** Botón en el panel por
  vendedora: "de licencia hasta tal fecha". Mientras dure, sale de la línea de
  alerta y aparece al pie ("Teresa: de licencia"). **Al vencer la fecha vuelve
  sola** — nadie tiene que acordarse de desmarcarla. NO reusar el flag `hidden`
  del setter (no tiene vencimiento; olvidarse de revertirlo borra a una persona
  del reporte para siempre).

### Contenido del mensaje

- **D-19: Molde elegido — excepción en la primera línea, sin emojis.**
  Validado con datos reales del mié 22/07 (día en que solo Brenda llamó):

  ```
  *Sin actividad hoy: Judith, Teresa*
  Reporte diario · mié 22/07

  *Brenda* 13 llam · 8 at · 23 min

  _Equipo 13 llam · 8 at (62%) · 23 min_
  _Ayer 66 llam · 23 at (35%)_
  _Sin arrancar: Dalia, Adela, Melissa_
  ```

  Razón del orden: el preview de la notificación de WhatsApp muestra las
  primeras líneas, así que lo primero que se lee sin abrir el mensaje es quién
  no trabajó. Sin emojis decorativos (preferencia estable del user, ver memoria
  `ui-minimalista-sin-emojis`). Cuando trabajaron todas, esa primera línea dice
  "Todas trabajaron hoy". **El molde es PRELIMINAR hasta que el user lo lea en
  su celular con el primer mensaje real (REP-05).**

- **D-20: Molde del semanal — mismo lenguaje que el diario.** Validado con
  datos reales de la semana 20–26/07:

  ```
  *Semana 20–26/07*
  Equipo 312 llam · 91 at (29%) · 182 min
  32 interesados · 0 reuniones agendadas

  *Teresa* 165 llam · 38 at · 70 min · 11 int
  *Brenda* 74 llam · 24 at · 70 min · 14 int
  *Judith* 73 llam · 29 at · 42 min · 7 int

  _Semana anterior: 70 llam · 25 at (36%) · 8 int_
  _Sin arrancar: Dalia, Adela, Melissa_
  _Detalle completo en el mail._
  ```

  **Excepción consciente a la regla "nada de métricas en cero":** la línea
  "0 reuniones agendadas" SE MUESTRA en el semanal porque ahí el cero es la
  noticia (32 interesados en la semana y ninguna reunión = el embudo se corta
  justo antes del cierre). Elegido explícitamente por el user.

- **D-21: Interesados en el diario, solo los días que hubo.** Línea aparte
  ("Interesados: Brenda 2, Teresa 1"); si nadie marcó interesados ese día, la
  línea no aparece. Dato: 40 interesados y 0 agendadas en todo el histórico —
  interesados TIENE señal, agendados no (se quedan fuera del diario, coherente
  con REP-04).

- **D-22 (REP-10): Sesgo del canal manual, solo cuando distorsiona.** Las
  llamadas cargadas a mano (`channel` ≠ `telnyx_webrtc`) cuentan como llamada
  pero aportan 0 minutos → el total de minutos queda corto. Son 78 de 603 en el
  histórico (0 a 6 por día). Se agrega una línea al pie **solo si ese día son 5
  o más, o más del 10% del día**: "6 llamadas cargadas a mano — sin minutos".
  Los días normales el mensaje queda limpio.

- **D-23: Las llamadas discadas sin marcar salen POR NOMBRE.** Sesgo nuevo
  introducido por la Phase 20: el callLog lo crea SOLO el endpoint de
  disposición, así que una llamada sin marcar no existe para las métricas
  (`pending_calls.json` sí las conoce). Línea del tipo "Sin marcar hoy: Teresa
  7, Judith 2", y **solo aparece si hay alguna** (cero no se muestra).
  Elegido por el user sobre la alternativa neutra; se le advirtió que es una
  métrica de disciplina y puede leerse como reto.
  ⚠️ **NO sumar las pendientes al conteo de llamadas** — eso crearía una segunda
  forma de contar llamadas fuera del CALL METRICS CORE y el reporte dejaría de
  coincidir con el panel (regla transversal del milestone v2.0).

- **D-24: Las vendedoras y los supervisores NO reciben este reporte.** Es de
  dirección. Todo el contenido con señalamiento individual (D-14, D-16, D-23)
  asume un grupo cerrado de los 3 socios. ⚠️ **Si el grupo termina siendo mixto,
  hay que rehacer el contenido** — el user todavía no creó el grupo.

- **D-25: "Última actividad" (4ª métrica de REP-04) vive en la línea de
  escalado (D-16), no como columna diaria.** Para quien trabajó hoy es
  redundante ("última actividad: hoy"); su valor está justamente en quien no
  trabajó.

### Cola y persistencia

- **D-26: Expiración de diarios pendientes = 3 días** (confirma la propuesta
  del roadmap). Lo más viejo lo cubre el semanal, que nunca se consolida ni
  expira. Al reconectar sale UN solo mensaje con una línea por día.

- **D-27: Historial de mensajes enviados = los últimos 30**, para poder
  consultar después qué decía un reporte puntual.

- **D-28: Guard por PERÍODO CUBIERTO, no por "hace cuánto mandé"** (REP-08).
  Un período entregado no se re-manda por ningún canal.

### Configuración

- **D-29: Sección chica en el Centro de Comando** (admin): grupo destino,
  mails de respaldo, interruptor de pausa y **botón "mandar ahora"**. Ese botón
  es lo que se va a usar para la prueba en vivo del grupo sin esperar a las
  23:00. Preferido sobre env var porque un cambio de grupo o una pausa no
  deberían requerir reiniciar el servidor.

### Claude's Discretion

- Mecanismo exacto de la cola (copiar el patrón de `scheduledMessagesTick`
  [index.js:5126](index.js:5126), **NO reusar el módulo** — está atado a
  leadId/setterId, ver REP-08).
- Espaciado entre mensajes distintos (propuesta del roadmap: 30-60s). **NO
  aplicar caps de warming** — es un grupo propio, no outreach frío.
- Guard de alcanzabilidad antes de emitir: `isUserOnline`
  ([src/wa/gateway.js:328](src/wa/gateway.js:328)); **`sendToUser` devuelve
  `true` con room vacía — no confiar en él** (REP-07).
- Si la app queda abierta en dos computadoras, emitir el comando a UNA sola
  (evitar el envío duplicado al grupo).
- El primer día no hay "ayer": esa línea de comparación no aparece.
- Redacción exacta de la línea de baches (D-05) y del texto de escalada (D-16).
- Estructura de `reports.json` para el estado diario + cola + historial (hoy
  solo guarda `lastWeeklyReportAt`/`lastWeeklyReportTo`).
- Detalle del repack de wa-multi (búsqueda/selección del grupo, captura del
  identificador, evento de resultado).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap y reglas del milestone
- `.planning/ROADMAP.md` §Phase 21 — goal, molde original, 7 success criteria y
  las reglas transversales del milestone v2.0 (toda métrica del CALL METRICS
  CORE; solo vendedoras nuevas; nada de métricas en cero — con la excepción
  explícita de D-20; suite verde; `npm run pre-deploy` antes de push).
- `.planning/REQUIREMENTS.md` §REP-04..REP-10 — texto completo de los
  requisitos. **Nota: REP-07 queda acotado por D-04** (sin fallback a email).
- `.planning/STATE.md` — verificaciones de la sesión 2026-07-25 (base del
  roadmap) y estado de Phase 19/20.
- `CLAUDE.md` — reglas del proyecto. Relevantes acá: regla #21/#128
  (persistencia en los 4 lugares o un redeploy la borra), #19 (mutex en writes
  async), #113 (helpers de TZ de negocio `_biz*`), #157 (CALL METRICS CORE y
  `tests/metrics-consistency.test.js`), #144 (`ADMIN_ONLY_SETTER_IDS`),
  bugs del SDK y notas de wa-multi (`out/` ES el source, NUNCA `npm run build`).

### Fase previa (base sobre la que se monta)
- `.planning/phases/19-encender-reporte-semanal/19-01-SUMMARY.md` — cómo quedó
  el cron semanal, `_reportRecipients()`, `reports.json` y la superficie de test
  `globalThis.__weeklyReport`.
- `.planning/phases/19-encender-reporte-semanal/19-REVIEW.md` — warnings WR-01,
  WR-02, WR-03 del code review, anotados como candidatos de hardening para esta
  fase.
- `.planning/phases/20-disposicion-obligatoria/20-CONTEXT.md` — decisiones de la
  disposición obligatoria; el registro `pending_calls.json` que alimenta D-23.

### Código existente
- `index.js:1746-1940` — bloque completo del reporte: `getReportsFile`,
  `loadReportsState`/`saveReportsState`, `buildWeeklyReportData`,
  `buildWeeklyReportHtml`, `_reportRecipients`, `sendWeeklyReport`,
  `maybeRunWeeklyReportCron`, `globalThis.__weeklyReport`.
- `index.js:1756-1793` — `pending_calls.json` (helpers de la Phase 20), fuente
  de D-23.
- `index.js:5126-5300` — `scheduledMessagesTick`: patrón de cola a COPIAR
  (load/save con cap FIFO, stagger, `_isSetterReachable`, emisión por
  `globalThis.__waGateway.sendToUser` con evento `followup:send-message`).
- `index.js:5790-5833` — `_ccResolveRange` / `globalThis.__callCore`
  (`_ccCollectCalls`, `_ccFunnelAggregate`, `_ccFunnelSeries`). El diario deriva
  de acá; `period: 'today'` ya existe.
- `index.js:5588` `ADMIN_ONLY_SETTER_IDS` y `index.js:5609`
  `_filterSettersVisible` + `_SUPERVISOR_EXCLUSION_SET` — REP-09, no escribir un
  filtro nuevo.
- `index.js:4080` (seedVolumeFromRepo) y `index.js:4133` (`BACKUP_FILES`) +
  `scripts/pre-deploy.js` — los 4 lugares donde registrar cualquier JSON nuevo.
- `src/wa/gateway.js:328` `isUserOnline`, `:344` `sendToUser`, `:352`
  `exposeGlobals` — transporte y su limitación conocida.
- `wa-multi/src-v058-work/out/main/index.js:609,630,707,736` —
  `sendMessageInWindow` / `sendMessageInWindowInner` y el deeplink
  `send?phone=`; `:1293` handler `followup:send-message`. **Es el código a
  modificar para D-02/D-03.**
- `wa-multi/README.txt` — historial de repacks (v0.5.9, v0.5.10) y el
  procedimiento correcto (patch del `app.asar`, NUNCA `npm run build`).
  Binario actual:
  `wa-multi/versiones/wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe`
  (repackeado en el plan 21-06 con el código de Phase 21; el v0.5.10 queda como
  rollback junto a `backups/app.asar-v0510-pre0511-20260726.bak`).

### Tests
- `tests/metrics-consistency.test.js` — la garantía anti-regresión del CALL
  METRICS CORE. Si el diario diverge del resto, esta suite falla.
- `tests/onboarding.test.js` — contiene las assertions del reporte semanal
  (A4, el 500 sin `RESEND_API_KEY`, export-data).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **CALL METRICS CORE** (`globalThis.__callCore`): `_ccCollectCalls` ya atribuye
  cada llamada a quién la hizo y `_ccResolveRange('today')` ya devuelve el día
  en TZ de negocio. El diario es una ventana distinta sobre el mismo motor, no
  código nuevo de métricas.
- **Helpers de TZ de negocio** (`_bizStartOfDay`, `_bizDayStr`, `_bizHour`,
  `_bizDayOfWeek`): resuelven D-10/D-11/D-12/D-13 sin lógica de fechas nueva.
- **Cron inyectable**: `maybeRunWeeklyReportCron(nowTs, sendFn)` ya es testeable
  sin reloj real (patrón `campaignEngineTick`). El cron diario debe copiarlo.
- **`reports.json`** ya está en export-data, import-data, seedVolumeFromRepo,
  `BACKUP_FILES` y `pre-deploy` — el estado del diario y la cola pueden vivir
  ahí sin repetir el trabajo de persistencia.
- **`pending_calls.json`** (Phase 20) ya registra las llamadas discadas sin
  marcar: es la fuente directa de D-23, no hay que instrumentar nada nuevo.
- **`sendWeeklyReport` + Resend** ya funciona multi-destinatario: el email queda
  cableado y apagado (D-04).

### Established Patterns
- **Toda métrica de llamadas deriva del core.** Es regla transversal del
  milestone y está protegida por `tests/metrics-consistency.test.js`.
- **Persistencia en 4 lugares o se pierde en el redeploy** (regla #21/#128).
- **Mutex en writes async** (regla #19): si el handler tiene `await` entre load
  y save, envolver. Los handlers síncronos de `pending_calls` son atómicos por
  event loop y no lo necesitan.
- **wa-multi: `out/` ES el source.** El repack se hace por patch del `app.asar`
  con `@electron/asar`. Correr `npm run build`/`dist:win` clobberea el código.
- **Tests backend con `DATA_DIR` + `auth.json` pre-import.** Para las API keys:
  `process.env.X_API_KEY = ""`, NUNCA `delete` (regla #121).

### Integration Points
- **Cron diario:** junto a `maybeRunWeeklyReportCron` (index.js:1914) — mismo
  `setInterval` horario, o tick propio; ambos escriben en `reports.json`.
- **Emisión al desktop:** `globalThis.__waGateway.sendToUser(userId, evento,
  payload)`. Evento NUEVO para grupo (el `followup:send-message` existente está
  atado a `targetPhone`). El desktop necesita el handler correspondiente.
- **Config del panel:** Centro de Comando, junto a los otros bloques de admin
  (`data-roles="admin"`). ⚠️ Toca `public/app.js` / `public/index.html` →
  **cache-buster obligatorio** (actual: `app.js v=20260725c`).
- **Alcance de vendedoras:** `_filterSettersVisible(setters,
  _SUPERVISOR_EXCLUSION_SET)`, igual que `buildWeeklyReportData`.

</code_context>

<specifics>
## Specific Ideas

- El user piensa este reporte como el reemplazo de entrar al panel: si el
  mensaje llega pero igual hay que abrir el sistema para entender algo, falló.
- Prefiere ver la excepción antes que el resumen: por eso el nombre de quien no
  trabajó va en la primera línea, antes del título.
- Aceptó explícitamente señalar por nombre a quien deja llamadas sin marcar
  (D-23) aun sabiendo que se lee como reto — es un grupo de dirección cerrado.
- Los moldes de D-19 y D-20 fueron elegidos leyendo mensajes construidos con
  datos reales de producción, no descripciones. La validación final es en su
  celular con el primer envío real.
- Sobre el JID: el user preguntó específicamente por él porque el roadmap lo
  ponía como primera tarea. La explicación correcta para futuras conversaciones
  es que el desktop no habla el protocolo de WhatsApp — maneja WhatsApp Web como
  una persona — así que el JID solo sirve para localizar el chat (D-03), no para
  enviar.

## Acciones del user (bloquean la prueba en vivo, NO la construcción)

1. Conseguir un número nuevo y registrar WhatsApp con él.
2. Crear el grupo con los 2 socios (**cerrado, sin las vendedoras** — D-24) y
   agregar el número nuevo.
3. Abrir `wa-multi-portable-v0.5.11/wa-multi-win32-x64/wa-multi.exe`, escanear
   el QR con el número nuevo, elegir el grupo con el botón "Grupo de reportes"
   (abajo a la izquierda de la ventana de WhatsApp), **fijar ese chat en
   WhatsApp** (clic derecho → Fijar) y dejar la app abierta.

</specifics>

<deferred>
## Deferred Ideas

- **Reporte individual a cada vendedora** (sus propios números, sin comparar con
  las demás). El user lo quiere "para después, cuando esto funcione mejor". Es
  una capacidad nueva: otro tipo de reporte, otro destinatario, hacen falta los
  WhatsApp de cada una y un contenido sin señalamientos comparativos. Fase
  aparte.
- **Fallback a email del diario** (REP-07 completo): el código queda cableado y
  apagado por D-04; encenderlo es configuración. Reabrir si la máquina del user
  demuestra no ser confiable.
- **Corte del día por huso horario de cada vendedora**: descartado en D-10 por
  complejidad (el sistema no guarda el país de cada una) y porque empujaría el
  mensaje a la madrugada. Reabrir si el equipo se extiende más al oeste que
  México.
- **Calendario de feriados** por país: descartado en D-11.
- **Hardening del reporte semanal** (WR-01, WR-02, WR-03 del
  `19-REVIEW.md`): anotados en STATE.md como candidatos para esta fase; el
  planner decide si entran o si esperan.
- **Cola de llamadas a escuchar en el semanal**: es Phase 22 (coaching), no
  duplicar acá.
- **Alertas por excepción** por este mismo canal: es Phase 23. D-06 deja el
  envío genérico para que no haya que rehacer nada.

</deferred>

---

*Phase: 21-reporte-diario-canal-whatsapp*
*Context gathered: 2026-07-26*
