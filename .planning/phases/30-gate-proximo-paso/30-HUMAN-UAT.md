---
status: partial
phase: 30-gate-proximo-paso
source: [30-VERIFICATION.md]
started: 2026-08-15T14:15:00Z
updated: 2026-08-15T14:15:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Abrir Llamadas, elegir 'Interesado (sin agendar)' en el select de un lead
expected: Aparece #call-next-modal sin la clase hidden, con #call-next-fecha cargado a +3 días (ISO ahora+72h) y el chip 'En 3 días' resaltado (isDefault)
result: [pending]

### 2. Vaciar #call-next-fecha y clickear Guardar
expected: No se dispara ningún POST; sale un toast/aviso ('Elegí cuándo volvés a hablarle…'); el botón Guardar sigue habilitado (no queda en 'Guardando…')
result: [pending]

### 3. Guardar con la fecha por defecto (+3 días) sobre un lead real
expected: El modal se cierra, el lead responde con nextAction.dueAt a +3 días y aparece el toast de destino ('«Lead» sale de la cola — vuelve <fecha> en Hoy → Interesados')
result: [pending]

### 4. Reabrir el modal #call-next-modal sobre OTRO lead después de haber guardado uno antes
expected: #call-next-confirm está habilitado y dice 'Guardar' (anti-regresión del bug #181b: el botón NO debe quedar muerto en 'Guardando…')
result: [pending]

### 5. Abrir el Power Dialer desde Hoy → Interesados, marcar un interesado y confirmar que la tarjeta no se salta sola al siguiente
expected: La tarjeta se queda con el banner '✓ Resultado guardado' + la línea de destino (D-07); el dialer NO expulsa la tarjeta apenas el lead queda con nextAction futuro
result: [pending]

### 6. Marcar 'No atendió', 'No interesado' y 'Volver a llamar' desde Llamadas y confirmar los 3 textos de destino correctos (cola de Llamadas / Descartados / Hoy → Callbacks)
expected: Toast visible con el texto y vista correctos para cada rama (los 8-9 textos exactos están documentados en 30-03-SUMMARY.md)
result: [pending]

### 7. En el Power Dialer, marcar un resultado y confirmar que el destino aparece DENTRO del banner verde (no como toast separado), y que desaparece al avanzar al siguiente lead
expected: La línea de destino con escHtml aplicado se ve bien formateada dentro de '✓ Resultado guardado'; _pd.holdMeta se limpia al cambiar de lead
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
