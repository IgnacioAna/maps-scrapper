# Smoke test (2 min) — antes de codear nada

Esto valida que la técnica que vamos a usar funciona en WhatsApp Web hoy.
Si pasa este test, el plan está validado. Si falla, paramos y repensamos.

## Qué necesitás

- Tu computadora con Chrome
- WhatsApp Web abierto y con sesión iniciada (escaneando el QR si hace falta)
- Un chat tuyo de prueba (con vos mismo, o con alguien de confianza —
  vamos a mandarle un mensaje "hola test")

## Pasos

### 1. Abrí WhatsApp Web y entrá a un chat

Andá a `https://web.whatsapp.com`. Abrí cualquier chat.

### 2. Abrí la consola del navegador

Apretá **F12** (o `Ctrl+Shift+I`). Se abre el panel de DevTools.
Click en la pestaña **Console** (Consola).

### 3. Hacé click en el campo donde escribís el mensaje

Importante: **antes de pegar el código en la consola, click una vez en
el cuadrito blanco abajo donde normalmente escribís el mensaje** (el
input de texto del chat). Eso lo "focusea". Después click en la consola.

### 4. Copiá y pegá esto en la consola, apretá Enter

```js
async function humanType(text) {
  const editable = document.querySelector('div[contenteditable="true"][role="textbox"]');
  if (!editable) { console.error('No encuentro el campo de texto'); return; }
  editable.focus();
  const range = document.createRange();
  range.selectNodeContents(editable);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  for (const ch of text) {
    const ok = document.execCommand('insertText', false, ch);
    if (!ok) {
      editable.dispatchEvent(new InputEvent('beforeinput', {inputType:'insertText', data:ch, bubbles:true, cancelable:true}));
      editable.dispatchEvent(new InputEvent('input', {inputType:'insertText', data:ch, bubbles:true}));
    }
    await new Promise(r => setTimeout(r, 50 + Math.random()*100));
  }
  console.log('Listo, ahora apretá Enter en el chat o el botón de mandar.');
}
```

Cuando aprietes Enter, no debería pasar nada visible (solo se "carga" la
función). Si la consola te dice `undefined` o muestra la firma de la
función, todo bien.

### 5. Volvé a hacer click en el cuadrito de texto del chat (importante) y volvé a la consola

Pegá esto y Enter:

```js
humanType('hola test')
```

### 6. Mirá qué pasa

Caso A — **éxito visual**: ves que en el input del chat aparecen las
letras una por una: `h` → `ho` → `hol` → `hola` → `hola ` → `hola t` ...
hasta `hola test`.

Caso B — **fracaso**: no aparece nada, o aparece algo raro, o sale un
error rojo en la consola.

### 7. Si fue caso A: probá mandarlo

Una vez que aparece `hola test` completo, apretá **Enter** o el botón
verde de mandar. ¿Se mandó el mensaje? ¿Aparece como bubble con el
doble check?

## Qué decirme

Mandame **3 cosas**:

1. **Apareció el texto letra por letra?** sí / no
2. **Si apareció, se mandó al apretar Enter?** sí / no / aparece con
   doble check
3. **Si hubo error en la consola, copiame el texto del error**

Con eso decido si vamos con el plan tal cual, o si tengo que cambiar
el método antes de seguir.

---

**Nota:** este test es contra WhatsApp Web real, con una cuenta tuya.
NO es masivo, NO usa números de los setters. Es UN mensaje "hola test"
a UN chat tuyo de prueba. Cero riesgo de ban — es exactamente lo que
hacés cuando tipeás manualmente.
