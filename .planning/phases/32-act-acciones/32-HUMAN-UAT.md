---
status: partial
phase: 32-act-acciones
source: [32-VERIFICATION.md]
started: 2026-08-16T02:13:23Z
updated: 2026-08-16T02:13:23Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Overlay sobre la ficha de Hoy (z-index)
expected: Abrir el botón WhatsApp desde la ficha del lead abierta DESDE Hoy (modal sobre modal) — el overlay (#act-wa-overlay, z-index 10060) se ve completo por encima, sin quedar tapado.
result: [pending]

### 2. Abrir WhatsApp real
expected: Click en "Abrir WhatsApp" con un lead real abre wa.me en pestaña nueva con el mensaje precargado; si el navegador bloquea el popup, aparece el toast con el link para abrir a mano.
result: [pending]

### 3. Cambio de plantilla y "otro número" en el overlay
expected: Cambiar la plantilla en el <select> reescribe el <textarea> con el cuerpo interpolado de la nueva plantilla; togglear el radio "Otro número" habilita/deshabilita los campos dependientes (input tel, checkbox guardar, input label).
result: [pending]

### 4. Descartar desde las 4 superficies
expected: Descartar un lead desde cada una de las 4 superficies (lista de Llamadas, Power Dialer, ficha, Hoy) — el lead desaparece de las 3 colas de una sola vez, con el toast de destino diciendo a dónde quedó.
result: [pending]

### 5. Descarte con razón DNC
expected: Descartar con razón "Pidió NO ser contactado (DNC)" — el chip de No-llamar aparece en la fila/ficha del lead después.
result: [pending]

### 6. Marca visual del descartado (nunca rojo)
expected: Ver un lead descartado con el toggle "ver descartados" activo: fila atenuada (scm-row-blocked), chip gris "Descartado" (scm-chip-blocked), teléfono tachado (scm-phone) — en ningún punto aparece rojo de alarma (D-16).
result: [pending]

### 7. Material por email — las dos vías
expected: Mandar material por email por "Mandar por el sistema" y por "Abrir mi cliente de mail" contra un lead con y sin RESEND_API_KEY configurada — vía resend manda de verdad si hay key; sin key, 409 con aviso claro y el botón mailto sigue funcionando.
result: [pending]

### 8. Canal en el historial del lead
expected: Cerrar una llamada real cuyo compromiso terminó cumplido por WhatsApp o por email — el histórico del lead (timeline) muestra "por WhatsApp" / "por email" en la línea del compromiso cerrado.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
