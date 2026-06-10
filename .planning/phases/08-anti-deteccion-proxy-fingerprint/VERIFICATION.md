# Phase 8 — VERIFICATION (manual, desktop)

> El backend (Wave 1) y el panel (Wave 4) tienen tests automáticos + verificación
> en preview (ya hechos, verde). El desktop wa-multi (Waves 2-3) NO se puede
> testear con runtime acá — Electron se verifica a mano contra WhatsApp Web.
> Este checklist se corre DESPUÉS del repack (ver "Repack pendiente" abajo).

## Pre-requisito: Repack pendiente (T5.4)

⚠️ **Las ediciones del desktop están en `wa-multi/src-v058-work/out/` pero
NO empaquetadas en un `.exe` todavía.** No hay fuente `.ts` (solo el compilado
`out/`), así que NO correr `npm run build` / `npm run dist:win` (electron-vite
buildearía desde un `src/` inexistente y borraría las ediciones de `out/`).

Repack correcto (empaquetar el `out/` ya editado):
1. Opción A — packager directo sobre out/:
   `cd wa-multi/src-v058-work && npx @electron/packager . wa-multi --platform=win32 --arch=x64 --out=../versiones/wa-multi-portable-v0.5.9 --overwrite`
2. Opción B — patch del app.asar de un portable existente: copiar
   `out/main/index.js` y `out/preload/whatsapp.js` dentro del asar de
   `versiones/wa-multi-portable-v0.5.8/.../resources/app.asar` y repackear el asar.
3. Subir versión en `package.json` a 0.5.9 + actualizar `wa-multi/README.txt`.

Recomendado hacerlo en sesión dedicada donde se pueda abrir el .exe y correr
este checklist inmediatamente.

---

## Checklist (post-repack, contra WhatsApp Web real)

### Cuenta SIN proxy (no-regresión)
- [ ] Abrir una cuenta sin proxy configurado → abre normal, conecta WhatsApp.
- [ ] DevTools (View → Toggle DevTools) consola muestra `[scm-fp] fingerprint patched accountId=...` (fingerprint base sigue andando).
- [ ] NO aparece log `[scm-fp] geo patched` (no hay geo sin proxy).

### Proxy HTTP sin auth
- [ ] En el panel, asignar a una cuenta un proxy HTTP válido + país (ej. MX).
- [ ] Abrir la cuenta → notif "Proxy OK · sale por <IP>". La IP debe ser la del proxy, NO tu IP real.
- [ ] DevTools consola: `[scm-fp] geo patched tz=America/Mexico_City locale=es-MX ua=…`
- [ ] En DevTools: `Intl.DateTimeFormat().resolvedOptions().timeZone` === `"America/Mexico_City"`.
- [ ] `navigator.language` === `"es-MX"`; `new Date().getTimezoneOffset()` === `360`.
- [ ] `navigator.userAgent` coincide con el UA del proceso (mismo Chrome major).

### Proxy HTTP con auth (user:pass)
- [ ] Asignar proxy con usuario y contraseña.
- [ ] Abrir la cuenta → conecta SIN popup pidiendo credenciales (las resuelve `app.on('login')`).
- [ ] Sale por la IP del proxy.

### Proxy SOCKS5
- [ ] Asignar proxy SOCKS5 válido → abre, sale por esa IP.
- [ ] (Si SOCKS5 con auth falla: documentar — Electron puede no disparar `login` para SOCKS5; usar HTTP con auth o proxy IP-whitelisteado.)

### Fail-safe anti-leak (CRÍTICO)
- [ ] Asignar un proxy con host inválido (ej. `1.2.3.4:9999`).
- [ ] Abrir la cuenta → NO carga WhatsApp; notif "Proxy caído · cuenta no abierta".
- [ ] Verificar (whoer.net / log) que la ventana NUNCA cargó nada con la IP real.

### Consistencia del fingerprint
- [ ] Cerrar y reabrir la misma cuenta → mismo `[scm-fp]` seed/valores (estable).
- [ ] Dos cuentas distintas → fingerprints y UA distintos.
- [ ] (Opcional) abrir 2 cuentas distintas en `https://fingerprint.com/demo` → VisitorID distinto.

### Coherencia geo↔proxy (el punto central)
- [ ] Con proxy MX: IP mexicana + timezone MX + es-MX → todo coherente, sin contradicción.
