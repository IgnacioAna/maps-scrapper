# Manual del Setter — SCM

Bienvenido. Esta guía te explica cómo usar el sistema día a día.

---

## Primera vez: activar tu cuenta

1. Te llega un email con un link de invitación (asunto: "Invitación al equipo SCM").
2. Click en el link → te abre la pantalla de **Activar invitación**.
3. Creás tu contraseña (mínimo 8 caracteres). Repetís.
4. Click "Crear acceso".
5. Quedás logueado. Bienvenido.

Para entrar otras veces: **https://scm-setting.up.railway.app/** → tu mail + contraseña.

---

## Tu día de trabajo

### 1. Abrís el panel
- Login con tu mail + contraseña.
- Click en **Setteo (WhatsApp)** del menú izquierdo.

### 2. Ves tus leads
La tabla del medio muestra todos los leads que el admin te asignó. Cada fila tiene:
- **Nombre** de la clínica
- **Teléfono** (con código de país)
- **Ciudad / País**
- **Estado** (Sin contactar, Conexión enviada, Respondió, etc.)
- **Variante** que tenés que usar (Var I / II / III / IV)
- **Notas** que pusiste antes
- **Acciones** (los botones de la derecha)

### 3. Filtrás por estado
Arriba de la tabla hay botones: **Todos**, **Sin contactar**, **WSP enviado**, **Respondieron**, **Calificados**, **Interesados**, **Agendados**, **En seguimiento**, **Sin WSP**, **Descartados**.

Apretá el filtro que necesites (ej: "Sin contactar" para ver los que faltan abrir).

### 4. Abrís WhatsApp con un lead
1. Click en el botón de WhatsApp en la fila del lead.
2. Se abre wa.me con el mensaje pre-armado (de la variante asignada).
3. Mandás el mensaje desde tu WhatsApp (tu celu o WhatsApp Web).
4. Volvés al panel y marcás **Conexión = "Enviada"**.

### 5. Cuando el lead responde
1. Si responde, marcás **Respondió = SI** en la fila.
2. Si calificó (se interesó en el servicio), marcás **Calificado = SI**.
3. Si quiere reunión, marcás **Interés = SI**.
4. Si agendaste reunión, cambiás el **Estado = Agendado**.

El sistema tiene **cascada inteligente**: si marcás "Interés = SI", automáticamente se marca Calificado, Respondió y Conexión Enviada. No tenés que hacerlo paso a paso.

### 6. Si no tiene WhatsApp
Marcás **Conexión = "Sin WSP"**. El lead desaparece de tu tabla principal y va a **Llamadas (Sin WSP)**, donde el equipo lo trabaja por teléfono.

### 7. Si te objeta algo
1. Vas a **Banco de Respuestas** en el menú.
2. Buscás la objeción ("muy caro", "no tengo tiempo", "ya tengo un sistema", etc.).
3. Copiás la respuesta sugerida y la usás como base.
4. Si funcionó, click en "Funcionó" — eso ayuda a mejorar las respuestas para todos.

### 8. Notas y follow-ups
- En cada lead podés clickear "Ver detalles" para abrir el modal completo.
- Podés agregar notas (qué dijo, cuándo lo llamaste, etc.).
- Activás follow-ups (24hs, 48hs, 72hs, 7d, 15d) — el sistema te recuerda volver a contactar.

---

## Centro de Entrenamiento

Click en **Centro de Entrenamiento**. Hay 8 módulos de onboarding:

1. **El Proyecto** — qué hace SCM, contexto del negocio.
2. **Tu Rol** — qué se espera de un setter.
3. **Sistema Operativo** — cómo usar el panel (este manual + más detalle).
4. **Conversación** — cómo iniciar y mantener conversaciones.
5. **Canales & Warmeo** — manejo de WhatsApp.
6. **Tracking** — cómo registrar todo.
7. **Objeciones** — cómo manejar las más comunes.
8. **Glosario** — términos del negocio.

Cada módulo tiene un **quiz** al final. Tenés que pasar todos para considerarte onboarded.

---

## Métricas tuyas

Arriba de Setteo ves cards con:
- **TOTAL** — tus leads totales
- **CONEXIONES** — qué porcentaje contactaste
- **APERTURA** — qué porcentaje te respondió
- **CALIFICACIÓN** — qué porcentaje calificaste
- **INTERESADOS** — número absoluto
- **AGENDADOS** — el más importante (es tu output final)

El admin ve estas métricas por setter en Centro de Comando. Tu objetivo es tener **buena tasa de Apertura y Agendados**.

---

## App desktop wa-multi (opcional, para multi-cuenta)

Si el admin te asignó una o más cuentas de WhatsApp para warming/multi-cuenta:

1. Te pasa un instalador `.exe`.
2. Instalás la app en tu PC.
3. La primera vez Windows puede preguntar "¿Estás seguro?" — click "Más info" → "Ejecutar de todas formas".
4. Login con tu mail + contraseña SCM (los mismos del panel web).
5. Ves la lista de cuentas que el admin te asignó.

Para cada cuenta:
1. Click "Abrir".
2. Se abre una ventana con WhatsApp Web.
3. Escaneás el QR con el celular del número (es el mismo flow que WA Web normal).
4. La cuenta queda conectada y aparece como "Conectado".

A partir de ahí:
- El admin puede mandar comandos remotos (abrir, mandar mensaje, iniciar warming).
- Vos solo tenés que tener la app abierta y la cuenta conectada.
- Si el admin inicia "warming", la app va mandando mensajes solita en horario laboral, con delays randomizados.

**Importante**: si la cuenta queda como **BANNED_TEMP**, no la toques durante el cooldown (4 días por defecto). El admin lo va a saber y va a coordinar el reinicio.

---

## Atajos prácticos

- **Sidebar**: click en la "S" arriba a la izquierda para colapsar / expandir.
- **Buscador de leads**: en Setteo, escribí cualquier dato (nombre, teléfono, ciudad, doctor) y filtra al instante.
- **Timer anti-baneo**: el botón ⏱️ flotante abajo a la derecha te recuerda hacer pausas entre envíos.
- **Cierre de sesión**: botón "Cerrar sesión" abajo a la izquierda en el sidebar.

---

## Si algo no funciona

- **No puedo loguear**: pedile al admin que te re-genere la invitación.
- **Mi panel está vacío**: pedile al admin que te asigne leads.
- **El botón de WhatsApp no abre nada**: chequeá que tengas WhatsApp Web abierto en otra pestaña, o que tu celu esté online.
- **La app desktop dice "no autorizado"**: cerrá sesión y volvé a logear.
- **Una cuenta WA dice "BANNED_TEMP"**: avisale al admin. NO intentes mandar mensajes manualmente desde esa cuenta durante el cooldown.

---

## Reglas de oro

1. **Siempre** marcá el estado del lead después de cada interacción (te lleva 2 segundos).
2. **Nunca** mandes mensajes idénticos a 10+ contactos seguidos. Variá.
3. **Nunca** mandes links en el primer mensaje a un contacto nuevo.
4. **Nunca** mandes a las 3 AM. Trabajá en horario laboral del cliente (9-19 hora local).
5. **Usá las variantes** del admin como base, pero personalizá con el nombre y la ciudad del lead.
6. **Pedí ayuda** si una objeción te cuesta. Para eso está el Banco de Respuestas y el equipo.

Cualquier duda, escribile a Ignacio. Suerte.
