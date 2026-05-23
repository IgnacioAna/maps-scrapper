# Phase setter-ux-redesign — PLAN

**Fecha:** 2026-05-22 (continuación del SPEC, decisiones tomadas en defaults
del autor según recomendación)

## Scope decidido (8 respuestas)

1. **Widget "Hoy"** arriba del Setteo (opción B). Una card con resumen
   accionable al inicio de la vista CRM.
2. **Tabla simple para todos los setters** (opción C). Las columnas extras
   no se eliminan, se mueven al modal del lead. Admin mantiene su Centro
   de Comando para la vista power-user.
3. **Modal del lead con 3 tabs** (opción B): 💬 Conversación · 🎯 Estado · 📅 Programar.
4. **Sidebar achicado para setter** (opción A): los items admin desaparecen
   de su vista (ya estaba con `data-roles`, lo refuerzo + agrego separadores).
5. **Banner de bienvenida** primera vez (opción B), no tour completo.
6. **Atajos limitados**: Esc para cerrar modal + Ctrl+K command palette
   (que ya existe). Resto fuera de scope.
7. **Más aire en filas** de tabla (opción A): padding mayor + zebra sutil.
8. **Prioridad**: tabla simple → modal con tabs → sidebar achicado → widget Hoy → banner → polish.

## Detalles concretos

### A) Widget "Hoy" en la vista Setteo
Antes del toolbar de filtros, agregar card:
```
┌────────────────────────────────────────────────────┐
│ Hola Paula 👋 · Lunes 22 mayo                       │
├────────────────────────────────────────────────────┤
│ [Para hoy]                                          │
│  ⏳ 3 follow-ups vencidos · 7 sin contactar         │
│  💬 2 respondieron — necesitan respuesta            │
│                                                     │
│ [Tu día]                                            │
│  12 conexiones · 5 respuestas · 1 agendada hoy      │
└────────────────────────────────────────────────────┘
```
Datos: leer del cache `setterLeads` ya cargado (no requiere endpoint nuevo).
Click en cada métrica → setea el filtro del pipeline (ej: click en
"3 follow-ups vencidos" → filtro `seguimiento`).

### B) Tabla simple — 7 columnas en lugar de 19
Mostradas:
1. # (num lead)
2. Nombre + ciudad (con badge si es nuevo de hoy)
3. Teléfono (link WSP, una línea)
4. Estado (chip semántico — sin_contactar/respondió/agendado/etc.)
5. Última acción (fecha/hace cuánto)
6. Próximo paso (texto inferido + chip — ej: "Mandar saludo", "Esperar respuesta", "Cargar seguimiento")
7. Acciones (3 botones: 💬 WSP · 📋 Abrir · 📅 Programar)

Ocultas (van al modal): web, conexión select, respondió select, calificado
select, interés select, variante, notas inline, doctor, social, 5 follow-ups,
estado chip.

Toggle "🔧 Ver tabla completa" solo visible para admin.

### C) Modal del lead con 3 tabs
- **💬 Conversación** (default): notas + add nota + WSP link + openMessage editable
- **🎯 Estado**: conexión, respondió, calificado, interés, estado, asistió. Cada uno con label clarito.
- **📅 Programar**: la sección que ya armamos en Phase setter-automations-followups.

Tabs como pills arriba del body del modal. Cambio sin recargar.
"Avanzado" (decisor, variante, doctor, asignar setter) en un accordion
expansible al final de la tab Estado (no es una tab propia para no inflar).

### D) Sidebar achicado para setter
Items setter (`data-roles="setter"` o sin roles): solo estos visibles
1. Setteo (WhatsApp)
2. Llamadas (Sin WSP) — si tiene leads sin WSP
3. Mis programados
4. Mi rendimiento
5. Asistente de respuestas
6. Banco de Respuestas
7. Centro de Entrenamiento
8. Mis WhatsApps (si tiene cuentas)

Items admin (`data-roles="admin,supervisor"`): TODOS los anteriores + sus
de admin (Centro de Comando, Equipo, Red de Warming, etc.)

Se agrega un divider visual entre secciones (Setters / Admin).
NO cambio el contenido de cada vista, solo la visibilidad del item en el
menu lateral.

### E) Banner de bienvenida
Una sola vez (localStorage flag `scm_welcome_seen`):
```
┌────────────────────────────────────────────┐
│ 👋 Bienvenida Paula al SCM                  │
│                                              │
│ Este es tu pipeline. Cada fila es un lead   │
│ que tenés que contactar.                     │
│ → Click en cualquiera para abrir su info.    │
│                                              │
│ ¿Sos nueva? El Centro de Entrenamiento       │
│ tiene 8 módulos cortos que te explican todo. │
│                                              │
│           [Entendido — ir a trabajar]        │
└────────────────────────────────────────────┘
```

### F) Densidad mejorada
- `#setter-table td { padding: 14px 12px; }` (vs 10px actual)
- Zebra striping `tr:nth-child(even) { background: rgba(255,255,255,0.012); }`
- Hover row: background `rgba(157,133,242,0.06)` (ya está, mejorar)
- Font-size cells: 13px (igual)
- Min-row-height: 56px (para que se vea respirar)

### G) Polish
- Toast confirmation cuando se marca algo ("✓ Marcado como enviada" verde, autohide 2s)
- Loading spinner inline en botones que hacen request (>300ms)
- Mejora contraste: subir `--text-secondary` de #B8C2CC a algo más claro
- Animación sutil 150ms ease en transitions de hover/focus

## Plan de ejecución (orden)

1. **CSS**: densidad tabla + chips + zebra + contraste — `public/style.css`
2. **HTML**: estructura modal con 3 tabs + widget Hoy + banner welcome — `public/index.html`
3. **JS**:
   - Render tabla simple por default + toggle admin
   - Modal con tabs (logic JS para cambiar tab activo)
   - Widget Hoy (calcular métricas del setterLeads cache)
   - Banner welcome (one-time)
   - Toast helper unificado
4. **Cache-buster** + tests + push

## Verificación

- [ ] Setter logueado ve tabla con 7 columnas (no 19)
- [ ] Admin logueado ve tabla simple por default + toggle "ver completa"
- [ ] Modal del lead se abre en tab "💬 Conversación"
- [ ] Cambiar tab sin recargar
- [ ] Widget "Hoy" muestra números reales del setter actual
- [ ] Banner aparece solo la primera vez
- [ ] Sidebar setter no muestra items admin (Centro de Comando, Equipo, etc.)
- [ ] Toasts aparecen al marcar acciones
- [ ] Tests existentes siguen verde

## Out of scope (queda para fases futuras)

- Modo claro (light theme)
- Tour interactivo de 4+ pasos
- Atajos de teclado avanzados (J/K, números)
- Animaciones lottie / framer
- Customización de columnas drag&drop
- Versión mobile dedicada
