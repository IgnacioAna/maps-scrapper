# Phase 2.1 — Warming-Lunes (sprint Vie→Lun)

> Sub-fase del Bloque B. Foco: dejar el warmer operativo y distribuible
> ANTES del lunes (reunión presencial con 15 setters).

**Fecha:** 2026-05-01 (viernes)
**Deadline:** 2026-05-04 (lunes AM)
**Status:** In progress

---

## Goal

Que los 15 setters de SCM puedan, el lunes, instalar wa-multi en sus PCs,
conectar 1-2 números nuevos y arrancar warming con un click — **sin que
WhatsApp detecte las múltiples cuentas como la misma máquina (anti-ban)**.

---

## Success criteria (verificable)

1. **Fingerprint randomization**: cada `partition: persist:acc-X` tiene un
   fingerprint distinto y consistente. Verificable en `https://fingerprint.com/demo`
   abriendo dos cuentas distintas → debe dar VisitorID distinto.
2. **wa-multi v3 build distribuible**: zip < 200 MB en `release/`, listo para
   pasar a 15 setters.
3. **Botón "Calentar número"** en panel admin: 1 click → crea routine SCM
   default + attach a la cuenta + start. NO requiere navegar 3 páginas.
4. **Doc 1 página de onboarding setter** en `docs/setter-quickstart.md`:
   pasos numerados desde "tengo el zip" hasta "estoy calentando".
5. **Smoke test passing**: vos (Ignacio) descomprimís el zip nuevo, login,
   conectás 1 cuenta, click "Calentar" → ves drip arrancar en 30 segundos.

---

## Out of scope (post-Lunes)

- Refactor a ventana única + sidebar (Bloque B5 completo)
- Notificaciones visuales fancy
- Banco editable desde panel
- Dashboard métricas pulidas
- Inbox unificado por setter
- Llamadas IA, IA generativa, GHL webhooks

---

## Plan de ejecución (waves)

### Wave 1 — Foundations (1-2h)

**T1.1** Auditar y commitear los cambios sin commitear en `wa-multi`:
- `src/main/window-manager.ts` (modificado)
- `src/preload/whatsapp.ts` (modificado)
- `src/main/ai-replier.ts` (untracked)
- `src/shared/response-bank-template.json` (untracked)
- `release/wa-multi-portable-v2.zip` (untracked — gitignore)

Verificar que los TS compilan limpio. Commit: `chore(wa-multi): commit cambios pendientes de sesion previa`.

### Wave 2 — Fingerprint randomization (2-3h)

**T2.1** Crear módulo `src/preload/fingerprint-patcher.ts`:
- Recibe `accountId` via process arg
- Genera seed determinístico: `hashSeed(accountId)`
- Patcha (todo via Object.defineProperty antes de que WA cargue):
  - `HTMLCanvasElement.prototype.toDataURL` y `getImageData` → noise determinístico
  - `WebGLRenderingContext.prototype.getParameter` → vary GPU vendor/renderer
  - `AudioContext.prototype.createAnalyser` → noise en frequency data
  - `navigator.userAgent`, `platform`, `hardwareConcurrency`, `deviceMemory`
  - `navigator.languages`, `navigator.plugins`
  - `Intl.DateTimeFormat().resolvedOptions().timeZone`
  - `Date.prototype.getTimezoneOffset`

**T2.2** Modificar `whatsapp.ts` preload para importar fingerprint-patcher PRIMERO,
antes de que el observer de detection arranque.

**T2.3** Verificar en dev que dos cuentas distintas dan resultados distintos
en cada propiedad patched.

Commit: `feat(wa-multi): fingerprint randomization por cuenta (anti-ban)`.

### Wave 3 — Onboarding sin fricción (1-2h)

**T3.1** Backend: nuevo endpoint `POST /api/wa/accounts/:id/start-warming-default`:
- Si la cuenta NO tiene routine attached → busca o crea routine SCM default
  con la curva pragmática
- Attach a la cuenta
- Start
- Devuelve `{ ok, warmingDay, currentPhase }`

**T3.2** Frontend: en panel admin "Cuentas WA", botón obvio "🔥 Calentar este número"
junto a cada cuenta. Click → llama el endpoint anterior. Toast con confirmación.

**T3.3** Si la cuenta ya está calentando, el botón muestra "Día X · Fase Y"
en vez del CTA, con tooltip de cuántos mensajes se mandaron hoy.

Commit: `feat(panel): boton one-click "Calentar este numero" en gestion de cuentas`.

### Wave 4 — Build + distribución (30 min)

**T4.1** Bumpear version a `0.3.0` en `wa-multi/package.json`.
**T4.2** `npm run build` (con auto-kill de zombies activo).
**T4.3** Empaquetar zip portable: `release/wa-multi-portable-v3.0.0.zip`.
**T4.4** Verificar zip se abre, exe arranca, login funciona.

Commit (en wa-multi): `release: v0.3.0 con fingerprint randomization`.

### Wave 5 — Doc setter (30 min)

**T5.1** Crear `docs/setter-quickstart.md`:
1. Bajar `wa-multi-portable-v3.0.0.zip` (link)
2. Descomprimir (recomendado: `C:\wa-multi`)
3. Doble click `wa-multi.exe`
4. Login con tu mail + contraseña del panel SCM
5. Click "+ Conectar cuenta WhatsApp" → escaneás QR
6. Volvé al panel SCM (web) → "Cuentas WA" → click 🔥 al lado de tu cuenta
7. Listo. La app va a abrir y cerrar tu WA solo durante el día con mensajes.

**T5.2** Sección "Importante" con:
- No cerrar la PC durante calentamiento (mantener encendida 9-19h)
- No tocar el WhatsApp Web mientras el bot trabaja (mover mouse rompe envío)
- Si te alerta Avast → "Permitir" (no es virus)

Commit: `docs: setter quickstart 1-pagina para warming v0.3.0`.

### Wave 6 — Verify (30 min)

**T6.1** Smoke test end-to-end manual:
- Levantar zip nuevo
- Login
- Conectar 1 cuenta (mock o tuya de test)
- Click "Calentar" desde panel
- Ver: drip arranca, fingerprint distinto a otra cuenta, no rompe el send

**T6.2** Escribir VERIFICATION.md con:
- Qué se probó
- Qué pasó (capturas si aplica)
- Issues encontrados → triage (fix ahora vs post-Lunes)

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fingerprint patches rompen WA Web (WA detecta tampering) | Solo patchar lo que sumamos noise/random; no eliminar APIs. Probar contra WA antes del build final |
| Build v3 introduce regresión en send | Smoke test del send ANTES de empaquetar. Si rompe, revertimos T2 y mandamos sin fingerprint (mejor v2 estable que v3 roto) |
| Algún setter tiene Windows muy viejo (Win 7) | Documentar en quickstart que requiere Win 10+ |
| Cambios sin commitear de sesión previa están rotos | Compilar primero (T1.1) — si TS falla, los reescribo o reverteo |
| Avast / Defender bloquea el .exe sin firma | Doc del setter dice "Permitir / agregar excepción" — esperable |

---

## Flow del lunes (qué pasa con los 15 setters)

1. Mandás el link del zip a los 15 (Drive / Telegram)
2. Cada uno descarga + descomprime + ejecuta (3-5 min)
3. Login con creds que ya creaste para cada uno
4. Conectan WA escaneando QR (3-5 min cada uno)
5. Vos en el panel admin → cada cuenta → click 🔥 "Calentar"
6. Listo. Las cuentas warmean automáticamente respetando horarios y caps.

Tiempo estimado por setter: 10 min. 15 setters = 2.5h máx la reunión, en
paralelo podés hacer 5 simultáneos = 30 min.

---

## After Lunes (Phase 2.2 Bloque B continuación)

- Sidebar único + webviews (UX setter)
- Banco editable desde panel
- Notificaciones visuales
- Dashboard métricas pulidas
