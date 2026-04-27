# Phase C.5 — Extensión Chrome "Pegar como humano"

**Fecha:** 2026-04-27
**Fuente:** ROADMAP.md → Bloque C.5 (líneas 155-171)
**Estado:** Contexto capturado, listo para `/gsd-plan-phase`.

---

## <domain>

Extensión de Chrome que reemplaza el paste instantáneo en `web.whatsapp.com`
por typing humano caracter por caracter, para evitar que WhatsApp detecte el
patrón de paste como bot. Sirve a setters de SCM que usan WA Web directo en
Chrome (no requiere wa-multi).

**Boundary:** sólo el flujo de paste→typing en WA Web. NO incluye
captura/clasificación de inbound, NI multicuenta, NI modificaciones al panel
SCM más allá del botón "Copiar" con marker.

---

## <decisions>

### Disparo y activación

1. **Hotkey:** `Ctrl+Espacio` (custom — el usuario lo prefiere sobre
   Ctrl+Shift+V o override de Ctrl+V).
2. **Gate por marker obligatorio:** la extensión sólo activa typing humano si
   el contenido del clipboard empieza con `__SCM_TYPE__:`. El marker se
   strip-ea antes de tipear.
3. **Sin marker → toast + abortar:** si Ctrl+Espacio se dispara con clipboard
   sin marker, mostrar toast `"Falta marker SCM"` y no hacer nada. Mantiene
   la regla estricta y educa al setter.
4. **Ctrl+V nativo se preserva:** la extensión NO intercepta Ctrl+V. Paste
   normal sigue funcionando como siempre.

### Generación del marker

5. **Inyección desde el panel SCM:** el panel agrega un botón "Copiar" por
   mensaje que copia al clipboard con `__SCM_TYPE__:` prefijado. Mini cambio
   server-side / front del panel, fuera del scope de la extensión pero
   coordinado con esta fase.

### Naturalismo del typing (máximo realismo pedido por el usuario)

6. **Delay base:** 50–150ms aleatorio entre caracteres.
7. **Pausas largas en puntuación:** 200–400ms extra después de `.`, `,`, `?`, `!`.
8. **Typos ocasionales con backspace:** 1–3% de chance por caracter, simula
   error → backspace → corrección.
9. **Pausas de "pensar":** cada N caracteres (aleatorio), pausa larga de
   1–3s para simular reflexión.
10. **Trade-off conocido:** un mensaje de 200 chars puede tardar 30–40s.
    Aceptable porque mata el tell de paste instantáneo, que es lo que
    importa. Si en testing molesta, exponer un slider de "intensidad" en
    una fase futura.

### UI durante typing

11. **Mini badge flotante** en esquina inferior-derecha del viewport:
    `Tipeando... 47/120` + barra de progreso. No bloquea, no requiere mouse.
12. **Mensaje implícito al setter:** "no muevas el mouse / no escribas hasta
    que termine".

### Cancelación / abort

13. **Esc → cancela** y deja el input como quedó (con lo tipeado hasta ahí).
14. **Cualquier tecla del usuario → pausa la extensión:** detecta input
    manual y se detiene para no pisar lo que la persona escribe. No hay
    auto-resume — si el setter quiere terminar, vuelve a copiar y dispara
    Ctrl+Espacio de nuevo.

### Scope técnico

15. **Sitios:** sólo `web.whatsapp.com` (matches en manifest). No expandir
    a otros sitios en esta fase.
16. **Permisos minimos:** `clipboardRead`, `activeTab`, content script en
    `web.whatsapp.com/*`. Sin host_permissions amplios.
17. **Input target:** el editable focuseado del chat actual (`div[contenteditable=true]`
    estándar de WA Web). Si el research detecta que WA usa otro target o
    requiere disparar `InputEvent` en lugar de `keydown/keypress`, el planner
    decide.

### Distribución

18. **ZIP unpacked + drag-drop a chrome://extensions/.** El admin servirá el
    `.zip` desde el panel SCM (link de descarga). Setter activa modo
    desarrollador y arrastra. No publicar en Chrome Web Store en esta fase.
19. **Updates manuales:** version bump + nuevo zip. Aceptable porque la base
    de usuarios es chica (4-5 setters) y la extensión es estable por diseño.

---

## <canonical_refs>

- `ROADMAP.md` (líneas 155-171) — definición original del Bloque C.5,
  contexto estratégico, esfuerzo estimado.
- `ROADMAP.md` (líneas 60-72) — wa-multi v2 con send-flow OS-level
  (referencia: la extensión es alternativa para setters que NO usen
  wa-multi).
- `MANUAL-SETTER.md` — flujo operativo del setter, útil para el research si
  hay que entender cómo el setter hoy copia mensajes.
- (Pendiente, otra fase) — modificación del panel SCM para agregar botón
  "Copiar con marker". Out of scope para esta fase pero **bloquea uso
  productivo**: la extensión sin el marker no se activa.

---

## <code_context>

**Proyecto NO está GSD-inicializado** (`.planning/` no existe). Este
CONTEXT.md vive en raíz como `C5-CONTEXT.md`. Si querés llevarlo al
estándar GSD, correr `/gsd-new-project` o mover este archivo a
`.planning/phases/C5-pegar-como-humano/C5-CONTEXT.md` después.

**Sin codebase scout previo:** la extensión es un proyecto nuevo,
independiente del repo `GoogleSrapper`. Sugerencia: crear subdirectorio
`extensions/scm-paste-as-human/` o un repo separado, decisión del planner.

**Stack mínimo esperado:**
- Manifest V3
- `content.js` (lógica de marker detection, typing, badge UI, cancel)
- `background.js` (si hace falta para clipboard read en algunos casos)
- Sin build step si se puede evitar (vanilla JS) — coherente con la
  filosofía "2-3h código" del roadmap.

---

## <deferred>

Ideas que surgieron y NO van en esta fase:

- Slider de "intensidad de naturalismo" (rapido / medio / paranoico).
  Deferir hasta tener feedback de setters reales.
- Auto-update del .crx self-hosted. Solo si la base crece >10 setters.
- Soporte para otros sitios (web.telegram.org, etc). Otra fase si
  aparece la necesidad.
- Métricas: contar cuántos mensajes se mandaron via typing humano vs
  paste normal. Útil para el panel admin pero es Bloque B/D.
- Mode "panic": tecla que aborta y borra el input completo si el setter
  pegó algo equivocado. Evaluable post-MVP.

---

## <next_steps>

1. **Crear botón "Copiar con marker" en el panel SCM** (mini fase
   coordinada — bloquea uso real de la extensión). Puede planearse a la
   par o como dependencia explícita.
2. **`/gsd-plan-phase`** sobre este CONTEXT.md para producir PLAN.md con
   tareas atómicas (manifest, content script, badge UI, hotkey listener,
   marker parser, typing engine con naturalismo máximo, cancelación,
   build/zip script).
3. **Research target para el planner:** confirmar qué evento/sintetizador
   de input usa WA Web hoy (si keydown+keypress+input bastan o si requiere
   `execCommand('insertText')` / `InputEvent` con `inputType: 'insertText'`).
   Esto es el mayor riesgo técnico del proyecto.
