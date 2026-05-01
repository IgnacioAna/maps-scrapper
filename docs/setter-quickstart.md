# wa-multi — Guía rápida para setters

> **Para qué sirve esta app**: calentar y proteger tu número de WhatsApp para
> que puedas mandar más mensajes sin que te lo baneen. Reemplaza WhatsApp Web
> en Chrome por una app dedicada que tiene tu fingerprint único + warming
> automático en horario laboral.

---

## 1. Requisitos

- **Windows 10 u 11** (64 bits)
- **8 GB RAM** mínimo (16 GB recomendado si vas a usar varias cuentas)
- **PC encendida durante el día** (9-19h aprox.) para que el warming pueda
  mandar mensajes en horario humano
- **Tu número de WhatsApp** ya activado en otro dispositivo (necesitás
  escanear QR — no se puede registrar un número desde acá)

---

## 2. Instalación (3 minutos)

1. **Descargar** `wa-multi-portable-v3.0.0.zip` (te paso el link)
2. **Click derecho** sobre el zip → "Extraer todo..." → elegí carpeta de
   destino. Te recomiendo `C:\wa-multi` (sin espacios, fácil de encontrar)
3. **Abrí** la carpeta `wa-multi` que se creó. Vas a ver `wa-multi.exe` y un
   montón de archivos `.dll`. **No los toques.**
4. **Doble click** en `wa-multi.exe`

> ⚠️ **Avast / Windows Defender va a alertar**. Es esperable porque la app no
> tiene firma comercial todavía. Click en "Más info" → "Ejecutar de todas
> formas" / "Permitir". **No es virus**: es Electron empaquetado.

---

## 3. Login

1. Cuando abre wa-multi, te pide email + contraseña
2. Usá las **mismas credenciales del panel SCM** (las que te creó Ignacio)
3. Si no recordás la contraseña, pedile a Ignacio que te la resetee

---

## 4. Conectar tu número de WhatsApp

1. Click en **"+ Conectar cuenta"** (o "+ Nueva cuenta")
2. La app abre una ventana con WhatsApp Web (igual que en Chrome)
3. En tu celular:
   - WhatsApp → Menú (⋮) → **Dispositivos vinculados** → **Vincular un
     dispositivo**
   - Escaneá el QR que aparece en la pantalla de wa-multi
4. Esperá unos segundos a que cargue todos tus chats (igual que cuando entrás
   por primera vez a WA Web)
5. **Listo. Tu cuenta está conectada y persistida.** No vas a tener que
   escanear QR de nuevo (a menos que cierres sesión manualmente).

---

## 5. Arrancar el warming (lo importante)

1. Andá al **panel SCM** en el navegador (https://scm-setting.up.railway.app)
2. Login con tus credenciales
3. En el sidebar → **"Cuentas WA"** (admin) o **"Mis WhatsApps"** (setter)
4. Encontrás tu cuenta en la lista. Vas a ver un botón llamativo: **🔥 Calentar**
5. Click en **🔥 Calentar**
6. Aparece un toast verde: *"🔥 Warming arrancado · Fase 1 — Arranque · ~12 msgs/día"*
7. **Listo.** Tu cuenta empieza a calentarse automáticamente respetando:
   - Horario 9 a 19 (Argentina)
   - Cap diario según la fase (Fase 1: 12 msgs/día, va creciendo gradual hasta 400)
   - Delays aleatorios entre mensajes (1-2 minutos en Fase 1)
   - Pausas si detecta señales de baneo

---

## 6. Importante mientras esté calentando

| ✅ Hacé | ❌ NO hagas |
|---|---|
| Dejá la PC encendida durante el día | Apagar la PC entre 9-19h |
| Dejá wa-multi abierta (puede estar minimizada) | Cerrar wa-multi mientras calienta |
| Si necesitás usar la PC, podés hacerlo libremente | Mover el mouse o tipear MIENTRAS la app está mandando un mensaje (vas a ver que el cursor se mueve solo unos segundos) |
| Conectar tu número a la red eléctrica | Cerrar la sesión de WA Web manualmente sin avisar |
| Si te cierras la sesión, escaneás QR de vuelta y listo | Mandarle muchos mensajes manuales por fuera mientras la cuenta está en Fase 1-2 |

---

## 7. Curva de warming (qué pasa cada día)

| Día | Fase | Mensajes/día | Delay entre mensajes |
|---|---|---|---|
| 1-2 | Fase 1 — Arranque | 12 | 1-2 min |
| 3-5 | Fase 2 — Aumento | 30 | 30s-1 min |
| 6-10 | Fase 3 — Construcción | 80 | 15-30s |
| 11-14 | Fase 4 — Escalando | 200 | 8-15s |
| 15+ | Fase 5 — Operación normal | 400 | 5-12s |

**Tip**: en Fase 1-2 la cuenta es muy frágil. **No mandes manualmente más
de 5-10 mensajes por fuera del warming**, especialmente a contactos que no
te conocen.

**Recomendación adicional**: en los primeros 3 días, **agregá tu número
nuevo a 3-5 grupos** de WhatsApp donde estés (familia, amigos, laburo).
Eso mejora la reputación inicial del número ante WA.

---

## 8. Si te banean el número

1. Vas a ver en el panel que la cuenta cambia a estado **"BANNED_TEMP"**
2. wa-multi pausa el warming automáticamente por 4 días (cooldown)
3. Pasados los 4 días, podés probar reactivarlo (botón **↺ Reset warming**
   desde día 1)
4. Si vuelve a baneo → ese número ya no sirve, comprá uno nuevo

**Cómo evitar baneos**:
- No mandes el mismo mensaje exacto a más de 5 personas seguidas (rotá variantes)
- No agregues el número a más de 3-5 grupos por día
- No uses el número para spam puro (sin pre-warming)
- Mantené el warming corriendo 9-19h ininterrumpido

---

## 9. Problemas comunes

**"La app no abre / pantalla negra"**
- Reiniciá la PC y volvé a abrir wa-multi.exe
- Verificá que extrajiste el zip correctamente (todos los archivos en una sola
  carpeta, no archivos sueltos)

**"Avast bloqueó wa-multi.exe"**
- Avast → Configuración → Excepciones → agregá la carpeta `C:\wa-multi`
- O el archivo `wa-multi.exe` directamente

**"Mi cuenta dice DISCONNECTED en el panel"**
- Andá a wa-multi, hacé click en la cuenta, verifica si te pide escanear QR
- Si sí: escaneá de vuelta
- Si no: cerrá wa-multi y abrila de nuevo

**"El warming no manda nada"**
- Verificá que estés en horario laboral (9-19 Argentina)
- Verificá que NO estés en pause (panel → estado "BANNED_TEMP" significa pausa)
- Si está bien y no manda → avisale a Ignacio

---

## 10. Contacto

Si algo no funciona, mandale captura de pantalla a **Ignacio** con:
- Qué intentaste hacer
- Qué error apareció (texto exacto)
- Tu cuenta (label en el panel)

**Estamos en grado beta — tu feedback ayuda a mejorar la herramienta para
todo el equipo.**
