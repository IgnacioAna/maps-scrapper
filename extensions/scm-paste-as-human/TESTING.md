# Testing manual — Pegar como humano

Checklist a correr antes de distribuir la extensión a setters reales.
Cada ítem en verde antes de dar OK.

## Setup

- [ ] Carpeta `scm-paste-as-human/` cargada en `chrome://extensions/`
- [ ] WhatsApp Web abierto, sesión iniciada
- [ ] Un chat de prueba abierto (con vos mismo o con alguien de confianza)
- [ ] Panel SCM abierto en otra pestaña con al menos una FAQ y una variante
      ya creadas

## Casos a verificar

### 1. Install limpio
- [ ] Drag-drop sin errores
- [ ] Console del service worker (chrome://extensions/ → "Inspeccionar
      vistas: service worker") sin errores rojos
- [ ] DevTools de WA Web → Console muestra `[SCM] Pegar como humano —
      extensión cargada. Hotkey: Ctrl+Espacio.` al cargar la página

### 2. Marker válido → typing arranca
- [ ] Click "Copiar 👤" en el panel SCM
- [ ] Ir a WA Web, abrir chat, click en el input
- [ ] `Ctrl+Espacio`
- [ ] El typing arranca caracter por caracter
- [ ] Badge violeta aparece abajo a la derecha con progreso
- [ ] Al final, el mensaje queda completo en el input

### 3. Send funciona ⚠ CRÍTICO
- [ ] Después del typing, apretar Enter (o click en botón verde de send)
- [ ] El mensaje **se manda**: aparece como bubble con doble check ✓✓
- [ ] **Si esto falla** (el mensaje queda escrito pero al apretar Enter
      no se manda), significa que Lexical no registró el state.
      Reportar inmediatamente — método primario en el código necesita
      ajuste o fallback no funcionó.

### 4. Marker missing → toast
- [ ] Copiar texto cualquiera (ej: seleccionar un texto del navegador y
      Ctrl+C, sin pasar por el botón "Copiar 👤")
- [ ] En WA Web, `Ctrl+Espacio`
- [ ] Aparece toast naranja "Falta marker SCM en el clipboard"
- [ ] No se tipea nada en el chat

### 5. Cancel con Esc
- [ ] Disparar typing largo (mensaje de >200 chars)
- [ ] A mitad de typing, apretar `Esc`
- [ ] Typing se detiene en el caracter actual
- [ ] Badge desaparece
- [ ] Lo tipeado hasta ahí queda en el input

### 6. Cancel manual (auto-pausa)
- [ ] Disparar typing
- [ ] A mitad, empezar a teclear cualquier letra en el input
- [ ] Typing se detiene **sin pisar** lo que el setter escribió
- [ ] Badge desaparece

### 7. Naturalismo visible
- [ ] Mensaje de prueba que incluya `.`, `,`, `?`, `!`
- [ ] Observar que hay pausas más largas en esos signos
- [ ] Mensaje de >50 chars: observar al menos una pausa larga "de pensar"
      (1-2.5s) en algún punto medio
- [ ] Eventualmente verás un typo: aparece una letra equivocada, se
      borra sola, aparece la correcta. (Probabilidad 2% por char alfa,
      en mensajes cortos puede no aparecer — probar con mensajes largos
      o ejecutar varias veces.)

### 8. No interfiere con Ctrl+V
- [ ] Copiar texto cualquiera
- [ ] En WA Web, `Ctrl+V` (NO `Ctrl+Espacio`)
- [ ] El paste instantáneo funciona como siempre (texto aparece de golpe)

### 9. No interfiere fuera de WA Web
- [ ] Abrir cualquier otra pestaña (Google, panel SCM, etc.)
- [ ] Apretar `Ctrl+Espacio`
- [ ] No pasa absolutamente nada (ni toast, ni typing)

### 10. Stress: mensaje largo
- [ ] Copiar mensaje de 500+ caracteres con marker
- [ ] `Ctrl+Espacio`
- [ ] Completar sin crash
- [ ] Badge actualiza progreso correctamente todo el camino
- [ ] Mensaje final completo y mandable

## Validación operativa (para ship a setters)

- [ ] Al menos **2 setters reales** prueban la extensión
- [ ] Cada uno manda **5–10 mensajes reales** con la extensión
- [ ] Período de **24h** sin que ninguna cuenta caiga en `BANNED_TEMP`
      atribuible al uso de la extensión
- [ ] Feedback recolectado (los setters cuentan si hay fricciones)

Si los 10 ítems pasan + validación operativa OK → distribuir a todo el
equipo.

## Troubleshooting común

| Síntoma | Causa probable | Fix |
|---|---|---|
| Toast "No pude leer el clipboard" | Foco en DevTools, no en la página | Click en la página, reintentar |
| Toast "No hay un chat abierto" | No hay editable focuseable | Abrir chat, click en el input, reintentar |
| Mensaje tipea pero Enter no manda | Lexical state vacío | Reportar — método de inyección necesita ajuste |
| Hotkey no responde | Extensión no cargada / WA Web cargado antes que extensión | Recargar la pestaña de WA Web |
| Typing muy lento | Es a propósito (naturalismo) | Aceptado — slider futuro si molesta |
