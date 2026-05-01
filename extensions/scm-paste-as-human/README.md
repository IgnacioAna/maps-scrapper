# SCM — Pegar como humano

Extensión de Chrome que reemplaza el paste instantáneo en
**WhatsApp Web** e **Instagram DMs** por typing humano caracter por
caracter, para evitar que esas plataformas detecten el patrón de paste
como bot.

**Activación:** solo si el texto que pegás viene del panel SCM (con un
marcador interno invisible). Cualquier otro Ctrl+V en WA/IG funciona
normal e instantáneo.

---

## Instalar (3 pasos, 30 segundos)

1. Descomprimir el `.zip` que te pasamos en una carpeta cualquiera
   (donde quieras, ej: Documentos).
2. Abrí Chrome → andá a `chrome://extensions/` (pegalo en la barra del
   navegador y Enter).
3. Arriba a la derecha activá **"Modo de desarrollador"**.
4. Click en **"Cargar descomprimida"** (arriba a la izquierda). Buscá
   la carpeta donde descomprimiste y seleccionala.
5. Listo. Aparece "SCM — Pegar como humano" en la lista. NO necesita
   login ni ninguna config.

> Si Chrome te pide aprobar permisos para `web.whatsapp.com`,
> `instagram.com` y `scm-setting.up.railway.app` — aceptá todos. Son
> los sitios donde la extensión funciona.

---

## Cómo usar (en el día a día)

1. En el panel SCM, en cualquier mensaje/respuesta/variante, vas a ver
   **dos botones:**
   - **"Copiar"** (verde) — copia normal de toda la vida.
   - **"👤 Copiar humano"** (violeta) — copia con un marcador para que
     la extensión active el typing humano al pegar.
2. Click en **"👤 Copiar humano"**. El botón confirma con
   `✓ Ctrl+V en WA`.
3. Andá a `web.whatsapp.com` (o Instagram DMs) → abrí el chat del lead.
4. Click en el campo donde se escribe el mensaje.
5. Apretá **`Ctrl + V`** (paste de toda la vida).
6. La extensión arranca a tipear caracter por caracter. Aparece un
   badge violeta abajo a la derecha mostrando el progreso
   (`Tipeando... 47/120`).
7. Cuando termina, apretás **Enter** (o el botón verde de mandar) como
   siempre.

> ⚠ **No mandes el mensaje hasta que el badge desaparezca** (= terminó
> de tipear).

### Si copiás algo NO del panel SCM

Ctrl+V funciona normal (paste instantáneo). La extensión solo activa
el typing humano si detecta el marcador interno que pone el botón
"👤 Copiar humano" del panel.

### Si te aparece "⚠ Sin extensión — copié normal" en el panel

Significa que el panel detectó que la extensión NO está instalada (o
está desactivada). El botón hizo un copy normal sin marcador (no se va
a romper nada al pegar) — pero no vas a tener typing humano. Instalá
la extensión o avisale a Ignacio.

---

## Cancelar / pausar

- **Esc** mientras está tipeando → cancela. Lo tipeado hasta ahí queda
  en el input.
- **Empezás a teclear vos** mientras tipea → la extensión detecta y se
  detiene automáticamente para no pisar lo que escribís.

---

## Naturalismo del typing

- Delay aleatorio entre caracteres: 50–150ms
- Pausa extra después de `.`, `,`, `;`, `!`, `?`, `:` (150–350ms)
- Cada 25–60 caracteres, una pausa larga "de pensar" (1–2.5s)
- 2% de probabilidad de typo simulado: tipea una tecla vecina del
  QWERTY, pausa, hace backspace, tipea la correcta.

Trade-off: un mensaje de 200 caracteres puede tardar 30–40 segundos.
Es el precio de no parecer bot.

---

## Sitios donde funciona

- `web.whatsapp.com` ✓ validado
- `www.instagram.com` y `instagram.com` (DMs) — validado en código,
  testear en uso real

NO hace nada en otros sitios. La extensión está scoped a los dominios
de arriba más el panel SCM (`scm-setting.up.railway.app`) para detectar
que está instalada.

---

## Permisos que pide la extensión

- `host_permissions`: solo `web.whatsapp.com`, `instagram.com` y
  `scm-setting.up.railway.app`. No accede a otros sitios.
- Sin acceso al clipboard, sin telemetría, sin background, sin tabs.

Código auditable (~600 LOC en total).

---

## Para developers

- `manifest.json` — manifest V3, versión 0.2.0
- `content.js` — orquestador (intercepta `paste` event en WA/IG)
- `lib/clipboard.js` — parsea el marker `__SCM_TYPE__:` del texto
  pegado
- `lib/typing.js` — motor de typing humano
  (`document.execCommand('insertText')` per char, fallback a
  `InputEvent('beforeinput')` para Lexical)
- `lib/badge.js` — UI de progreso
- `lib/toast.js` — toasts
- `lib/cancel.js` — Esc + auto-pausa al teclear
- `lib/panel-signal.js` — content script en el panel SCM que setea
  `data-scm-paste-installed="1"` para que el panel detecte la extensión

Notas técnicas en `../../.planning/phases/03.5-pegar-como-humano/03.5-RESEARCH.md`.

---

*Versión 0.2.0 — abril 2026.*
