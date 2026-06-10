# Proxy por cuenta en wa-multi — guía operativa

> Para qué sirve, cuándo usarlo, y cómo cargarlo. Phase 8 (2026-06-10).

## ¿Para qué?

WhatsApp marca como sospechosas varias cuentas que salen por la **misma IP**.
El fingerprint (que wa-multi ya tiene) hace que cada cuenta parezca un
**dispositivo** distinto, pero la IP sigue siendo una sola: la de tu conexión.
El proxy le da a cada cuenta su **propia IP de salida**.

## ¿Cuándo lo necesito?

- **1 cuenta**: no hace falta. Tu IP normal está bien.
- **3-4+ cuentas en la misma máquina/conexión**: ahí conviene. Cada cuenta
  con su proxy = cada cuenta con su IP = no se ven como "la misma persona".

Es **opcional y por cuenta**: podés tener unas con proxy y otras sin.

## ¿Qué proxy comprar?

- Tipo: **HTTP** o **SOCKS5** (los dos andan). Evitá "proxies datacenter"
  baratos — WhatsApp los detecta. Buscá **residencial** o **móvil (4G)**.
- **País**: idealmente del país de los leads que trabaja esa cuenta. Si
  laburás México, proxy mexicano.
- Con o sin usuario/contraseña: los dos funcionan.

Proveedores típicos: IPRoyal, Soax, Bright Data, Smartproxy (residencial).

## Cómo cargarlo (panel admin → Cuentas WhatsApp)

1. En la fila de la cuenta, clic en el botón **🛡️**.
2. Elegí el tipo (HTTP / SOCKS5).
3. Cargá **host**, **puerto** y, si el proxy tiene, **usuario + contraseña**.
4. Elegí el **país** del proxy → completa solo la zona horaria y el idioma
   (los podés ajustar a mano).
5. Guardar.

## Por qué importa el país (coherencia)

Cuando una cuenta sale por un proxy de México, wa-multi también hace que el
navegador **diga** que está en México: reloj mexicano (`America/Mexico_City`)
e idioma `es-MX`. Si no fueran coherentes —IP mexicana pero reloj argentino—
ese contraste delata MÁS que no tener proxy. Por eso el país define la zona
horaria y el idioma automáticamente.

## Cómo sé que funciona

Al **abrir la cuenta** en wa-multi:
- Si el proxy anda → notificación "Proxy OK · sale por <IP>". Esa IP es la
  del proxy (verificalo, debe ser distinta a la tuya).
- Si el proxy está caído → la cuenta **NO abre** y avisa. Importante: en ese
  caso wa-multi **no** abre la cuenta con tu IP real (para no exponerte). Revisá
  el proxy y reintentá.

## Notas

- Cambiar el proxy de una cuenta ya abierta: cerrá y reabrí la cuenta para que
  tome el proxy nuevo.
- SOCKS5 con usuario/contraseña a veces no autentica bien en escritorio; si te
  pasa, usá HTTP con auth o un proxy SOCKS5 autorizado por IP (sin user/pass).
- El fingerprint (dispositivo falso) funciona con o sin proxy — son
  complementarios.
