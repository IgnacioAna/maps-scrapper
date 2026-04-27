# SCM — Pegar como humano

Extensión de Chrome que reemplaza el paste instantáneo en
`web.whatsapp.com` por typing humano caracter por caracter, para evitar
que WhatsApp detecte el patrón de paste como bot.

**Hotkey:** `Ctrl + Espacio` en `web.whatsapp.com`
**Activación:** solo si el clipboard arranca con el marker `__SCM_TYPE__:`
**Solución de marker:** botón "Copiar 👤" en el panel SCM (Banco de
Respuestas y Variantes) lo agrega automáticamente al clipboard.

---

## Instalar (modo dev, drag-drop)

1. Abrí Chrome → andá a `chrome://extensions/`.
2. Arriba a la derecha activá **"Modo de desarrollador"**.
3. Hacé drag-drop de la carpeta `scm-paste-as-human/` (o del `.zip`
   descomprimido) sobre la página.
4. Listo. La extensión aparece en la lista. No necesita login ni nada.

> Si Chrome dice "el manifest tiene errores": abrí DevTools de la página
> de extensiones (F12) y mirá la consola para el detalle.

## Cómo se usa

1. En el panel SCM, hacé click en **"Copiar 👤"** del mensaje/respuesta
   que querés mandar. (El botón "Copiar" normal sigue funcionando para
   paste instantáneo común.)
2. Andá a `web.whatsapp.com`. Click en el chat del lead.
3. Click una vez en el cuadro de texto del chat (focus).
4. Apretá **Ctrl + Espacio**.
5. La extensión empieza a tipear caracter por caracter. Aparece un
   badge violeta abajo a la derecha con el progreso (`Tipeando... 47/120`).
6. Cuando termina, aprietas Enter (o el botón verde de send) como
   siempre. **No mandes el mensaje hasta que el badge desaparezca.**

### Cancelar / pausar

- **Esc** en cualquier momento → cancela el typing. Lo tipeado hasta
  ahí queda en el input.
- **Empezar a teclear vos** → la extensión detecta y se detiene
  automáticamente para no pisar lo que escribís. (Si querés terminar el
  mensaje, copiá de nuevo desde el panel y volvé a apretar Ctrl+Espacio
  para tipear el resto.)

### Si te pone "Falta marker SCM"

Significa que lo que tenés en el clipboard NO viene del botón "Copiar 👤"
del panel. Volvé al panel y copialo desde ahí.

## Permisos que pide la extensión

- `clipboardRead` — para leer el clipboard cuando aprietas Ctrl+Espacio.
  No accede al clipboard fuera de WA Web ni en background.
- `host_permissions: web.whatsapp.com` — el content script solo se
  inyecta en WA Web. No corre en otros sitios.

No tiene ni `background`, ni `tabs`, ni telemetría. El código es chico
y auditable (~500 LOC en total).

## Naturalismo del typing

- Delay aleatorio entre caracteres: 50–150ms
- Pausa extra después de `.`, `,`, `;`, `!`, `?`, `:` (150–350ms)
- Cada 25–60 caracteres, una pausa larga de "pensar" (1–2.5s)
- 2% de probabilidad de typo simulado: tipea una tecla vecina del QWERTY,
  pausa, hace backspace, tipea la correcta.

Trade-off: un mensaje de 200 caracteres puede tardar 30–40 segundos.
Es el precio de no parecer bot. Si en operación se vuelve doloroso,
podemos exponer un slider de "intensidad" en una versión futura.

## Para developers

- `manifest.json` — manifest V3
- `content.js` — orchestrator (hotkey listener, async control flow)
- `lib/clipboard.js` — read + parse marker
- `lib/typing.js` — motor de typing humano (`execCommand('insertText')`
  primario, fallback `InputEvent` para Lexical)
- `lib/badge.js` — UI de progreso
- `lib/toast.js` — toasts
- `lib/cancel.js` — Esc + auto-pausa al teclear

Notas técnicas en `../../.planning/phases/03.5-pegar-como-humano/03.5-RESEARCH.md`.

## Test manual

Ver `TESTING.md` (checklist de 10 ítems para validar antes de distribuir
a setters).

Para el smoke test inicial sin instalar la extensión, ver `SMOKE-TEST.md`.

## Distribución a setters

1. Empaquetar: `bash build.sh` (genera `release/scm-paste-as-human-v0.1.0.zip`).
2. Subir el `.zip` al panel SCM (TBD: endpoint admin) o pasarlo por
   Drive/email.
3. El setter descomprime y arrastra la carpeta a `chrome://extensions/`.
4. Listo.

---

*Versión 0.1.0 — abril 2026.*
