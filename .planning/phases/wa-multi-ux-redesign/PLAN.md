# Phase wa-multi-ux-redesign — PLAN

**Fecha:** 2026-05-23
**Decisiones tomadas (default todas mis recomendaciones del SPEC):**
1. Activity feed: colapsable, default oculto
2. Cierre ventana: minimiza a system tray, sigue corriendo
3. Diseño para 1-5 cuentas
4. Estilo: cards + feed lateral colapsable
5. Tema: dark obligatorio
6. UI: misma para setter y admin
7. Onboarding: placeholders helpful, sin tour
8. Build: TODO en un solo deploy v0.5.3 (binarios de 1.4GB c/u, no tiene sentido 3 separados)

## Stages dentro de v0.5.3

### Stage A — Branding + Login + Dark theme global
- Cargar Geist font desde Google Fonts en index.html del renderer
- Reescribir `LoginView.vue`:
  - Quitar input "Server URL" (queda fijo a `https://scm-setting.up.railway.app` via const)
  - Logo S violeta gradient (mismo del panel web)
  - Wordmark "SCM" + tagline "Sales Closing Machine"
  - Dark theme: bg `#0F1115`, card `#1A1D24`, accent `#9D85F2`
  - Placeholder en email "ej: paula@scm.com" para guiar
  - Mensaje de status visible ("Conectando…", "Login OK")
- `App.vue`: globals dark theme + Geist font familia base
- Element Plus: override de variables CSS para dark theme

### Stage B — Dashboard con cards de cuentas
- Reemplazar `AccountList.vue` por dashboard nuevo:
  - **Header**: logo S + "SCM wa-multi" + info de user + controles (refresh, logout, settings)
  - **Stats cards arriba**: cuentas activas | calentando | pendientes acción | mensajes hoy
  - **Lista de cuentas como cards** (no tabla):
    - Avatar circular con inicial + color por estado
    - Label de cuenta + teléfono
    - Chip estado (🟢 Conectado / 🟡 QR pendiente / 🔴 Banneado / ⚫ Desconectado)
    - Chip warming (🔥 Calentando · Fase X · día N · M msgs hoy) — si aplica
    - Próximo envío programado (si hay)
    - Acciones: Ver / Pausar / Más opciones
- Cuando una cuenta está mandando: **pulse animation violeta** en avatar
- Empty state amigable si no hay cuentas: "Aún no tenés cuentas conectadas — pedile a admin que te asigne una"

### Stage C — Activity feed colapsable
- Botón flotante o icono en header "📡 Actividad" con badge de count
- Click → abre drawer/sidebar lateral con feed cronológico:
  - "14:32 ✓ enviado a +54 911 8765 desde Cuenta Principal"
  - "14:30 📅 follow-up programado a María (próximo en 2 min)"
  - "14:28 🔥 warming msg Cuenta1 → Cuenta2"
  - "14:25 ⚠️ Cuenta Trabajo perdió conexión"
- Eventos vienen de los `account:event` que ya emite el wa-multi via socket
  (warming-started, warming-msg, qr-shown, connected, etc.)
- Cap visual: últimos 50 eventos en memoria. Más viejos se descartan.
- Default oculto (sidebar collapsed). Setter lo abre cuando quiere ver.

### Stage D — System tray + notificaciones mejoradas
- Cuando cerrás la X → minimiza a system tray, NO cierra
- Icono normal: la S violeta
- Cuando hay actividad reciente (últimos 30s): icono con punto verde animado
- Cuando hay error: icono con punto rojo
- Click derecho menú: "Abrir wa-multi" · "Pausar todo" · "Salir realmente"
- Notificaciones nativas: mejor contenido (incluir nombre de cuenta + destino)

### Stage E — Polish + onboarding placeholders
- Placeholders helpful en empty states
- Skeleton loaders mientras carga la lista de cuentas
- Toasts unificados (no usar el de Element Plus que es feo)
- Smooth transitions 150ms en hover/state changes

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/renderer/index.html` | Agregar Geist font CDN |
| `src/renderer/App.vue` | Globals dark theme + Geist |
| `src/renderer/components/LoginView.vue` | Rediseño completo (Stage A) |
| `src/renderer/components/AccountList.vue` | RENOMBRAR a `Dashboard.vue` + rediseño (Stage B) |
| `src/renderer/components/AccountCard.vue` | NUEVO componente (Stage B) |
| `src/renderer/components/ActivityFeed.vue` | NUEVO componente (Stage C) |
| `src/renderer/components/AppHeader.vue` | NUEVO componente (extraer header) |
| `src/renderer/stores/accounts.ts` | Sin cambios estructurales, solo agregar campos |
| `src/renderer/stores/activity.ts` | NUEVO store para el feed (Stage C) |
| `src/main/tray.ts` | NUEVO (Stage D) o mejorar existente |
| `src/main/window-manager.ts` | Hook al close-event para minimize-to-tray |

## Build & deploy

Como NO tengo node_modules del wa-multi source, voy a aplicar la misma técnica
que usé con el handler `followup:send-message`:

1. Extraer `app.asar` actual a `/tmp/wamulti-src/`
2. Aplicar cambios a `src/renderer/*.vue` (TypeScript source)
3. Aplicar mismos cambios al `out/renderer/*.js` (bundled, ya transpilado)
4. Repackear `app.asar`
5. Copiar a `wa-multi-portable-v0.5.3/`
6. Verificar que el binario abre OK
7. Borrar v0.5.2, mover backup a v0.5.2 backups

**Limitación importante:** el bundled output (`out/`) usa Vite que minifica
nombres de variables y agrupa imports. Modificar el bundle a mano es muy
frágil. Para componentes Vue, lo más seguro es:

a) Editar source `.vue` files (queda doc para futuros builds desde source)
b) Reemplazar el `out/renderer/index.html` con uno que cargue el componente
   nuevo via import dinámico O insertar template HTML inline

**Opción B más realista para hot-patch sin reconstrucción:** modificar el
HTML del renderer + CSS directo + JS vanilla minimal. Bypass Vue runtime
para los cambios visuales rápidos. No es ideal pero funciona.

**Mejor opción honesta:** intentar instalar npm install en /tmp/wamulti-src
y correr `npm run build` para rebuild oficial. Es 5-10 min de install pero
deja todo limpio.

Voy a intentar la **opción B** (npm install + rebuild) primero. Si falla por
permisos o deps, caigo a la **opción A** (patches al bundle).

## Verificación

- [ ] Login muestra branding SCM
- [ ] No pide Server URL
- [ ] Tema dark consistente con panel web
- [ ] Geist font cargada
- [ ] Dashboard muestra cards en lugar de tabla
- [ ] Stats arriba con métricas reales
- [ ] Estado visual de cada cuenta claro
- [ ] Activity feed se abre/cierra con botón
- [ ] Cerrar ventana → minimiza a tray
- [ ] Notificaciones nativas mejoradas
- [ ] Tamaño binario similar al v0.5.2 (1.4 GB)
- [ ] wa-multi.exe abre sin errores

## Riesgos

1. **npm install puede fallar** por permisos OneDrive o deps deprecadas → fallback a patches
2. **Cambios al wa-multi pueden romper compat con server** si toco shape de socket events
3. **Tray icon necesita asset PNG** — si no tengo, uso el favicon SVG inline
4. **Build de 1.4 GB tarda** — esperar paciencia

## Out of scope (queda para fase futura)

- Multi-language
- Light theme
- Configuración avanzada de notificaciones
- Drag&drop para reordenar cuentas
- Estadísticas históricas dentro del wa-multi (eso vive en el panel)
