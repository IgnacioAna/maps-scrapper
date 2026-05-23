# Phase wa-multi-ux-redesign — SPEC

**Fecha:** 2026-05-23
**Owner:** Ignacio + Claude
**Goal:** Que un setter abra wa-multi y entienda en 5 segundos: qué cuentas
tiene, qué están haciendo, y qué le toca a él hacer (si algo). Verse pro,
estética acorde al panel SCM (violeta, dark theme, Geist font).

## Auditoría visual del wa-multi actual (v0.5.2)

### Stack
- Vue 3 + TypeScript
- Element Plus (componentes UI prearmados)
- Pinia (state management)
- electron-vite (build)
- Solo **3 archivos** de UI: `App.vue` (16 líneas), `LoginView.vue` (51),
  `AccountList.vue` (60). Total: **127 líneas de UI**. Es una app
  minimalista hecha en estilo "MVP funcional".

### Pantallas actuales (qué ve el setter)

**1. Login** (cuando no está logueado)
```
┌───────────────────────────┐
│       wa-multi            │
│                           │
│  Server: [http://...    ] │
│  Email:  [             ]  │
│  Password: [          ]   │
│                           │
│       [  Ingresar  ]      │
└───────────────────────────┘
fondo gris claro #f5f5f5, card blanca, font system-ui
```

**2. Lista de cuentas** (logueado)
```
┌──────────────────────────────────────────────────┐
│ wa-multi                  [Refrescar] [Salir]    │
│ Ignacio · admin · http://scm-setting.up...       │
├──────────────────────────────────────────────────┤
│ Cuenta   │ Teléfono   │ Estado     │ Acciones    │
├──────────────────────────────────────────────────┤
│ Mi cuenta│ +5491111   │ Conectado  │ [Abrir][Cerrar]
│ Trabajo  │ —          │ Esperando QR│ [Abrir][Cerrar]
└──────────────────────────────────────────────────┘
```

### Pain points reales (qué falta)

| # | Pain | Impacto |
|---|---|---|
| 1 | **Sin branding SCM** — dice "wa-multi" plano, no se sabe que es del SCM Dental | Confunde al setter que viene de logearse en scm-setting.up.railway.app |
| 2 | **Login pide Server URL** — siempre es el mismo (Railway), no debería preguntarlo | Setter no sabe qué poner, error común |
| 3 | **Fondo gris claro + card blanca** — no respeta dark mode del panel web | Inconsistencia visual fuerte |
| 4 | **Tabla muy "técnica"** — columnas y botones sin contexto, parece config tool | Setter no entiende qué tiene que hacer |
| 5 | **No muestra actividad en vivo** — si está warming, el setter no ve nada moviéndose | Parece que la app está muerta cuando en realidad está mandando msgs |
| 6 | **No hay stats arriba** — "X conectadas, Y warming, Z fuera" — el setter no tiene overview | Tiene que mirar fila por fila |
| 7 | **Botones Abrir/Cerrar genéricos** — qué pasa cuando aprieto? confuso | UX hostil |
| 8 | **No hay notificación visual** de actividad — sale por toast nativo OS pero la app no refleja | Setter no asocia "wa-multi hizo algo" con "esa cuenta mandó" |
| 9 | **No hay info de warming** (Fase, día, msgs hoy, próximo en) | Setter no sabe si su cuenta está calentando o no |
| 10 | **No hay activity feed** ("hace 30s Paula mandó a +54...") | Cero confianza visual de que está funcionando |
| 11 | **Tipografía system-ui** mientras panel usa Geist | Inconsistente |

## Propuesta de diseño

### 1. Branding completo SCM
- Logo violeta gradient + "SCM" wordmark + tagline "Sales Closing Machine · wa-multi"
- Dark theme acorde al panel: `#0F1115` background, `#1A1D24` cards, `#9D85F2` accent
- Geist font (la app desktop puede cargarla via Google Fonts CDN o local bundle)
- Mismo lenguaje visual que el panel web

### 2. Login simplificado
```
┌────────────────────────────────────┐
│        [S]                          │
│        SCM                          │
│   Sales Closing Machine             │
│                                     │
│  Email:    [                  ]     │
│  Password: [                  ]     │
│                                     │
│      [    Ingresar    ]             │
│                                     │
│  · Server: scm-setting.up.railway.app
└────────────────────────────────────┘
```
- Server URL FIJO (Railway), oculto. Configurable solo via env var avanzada.
- Email/password grandes, focus auto en email
- Mensaje de estado claro: "Conectando…" "Login OK" "Error: contraseña incorrecta"

### 3. Dashboard principal (reemplaza tabla)

**Header:**
```
[S] SCM wa-multi          Paula · setter      [⚙] [↻] [⏏ Salir]
```

**Stats cards (top row):**
```
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│   3     │ │   2     │ │   1     │ │   12    │
│Cuentas  │ │Calentando│ │Pendiente│ │Mensajes │
│activas  │ │          │ │ acción  │ │ hoy     │
└─────────┘ └─────────┘ └─────────┘ └─────────┘
```

**Lista de cuentas como cards (no tabla):**
```
┌──────────────────────────────────────────────────────┐
│ [P] Cuenta Principal                  🟢 Conectada    │
│     +54 911 1234-5678                                 │
│     🔥 Calentando · Fase 2 · día 8 · 6 msgs hoy       │
│     💬 Próximo envío en 12 min                        │
│                                          [Ver] [Pausar]│
└──────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────┐
│ [T] Cuenta Trabajo                    🟡 Esperando QR │
│                                                       │
│     ⚠️ Escaneá el QR para conectar                    │
│                                          [Escanear QR]│
└──────────────────────────────────────────────────────┘
```

### 4. Activity feed sidebar (panel derecho)
```
┌──────────────────────────┐
│ 📡 Actividad en vivo      │
├──────────────────────────┤
│ 🟢 14:32 enviado a        │
│    +54 911 8765 desde     │
│    Cuenta Principal       │
│                           │
│ 📅 14:30 follow-up        │
│    programado a Maria     │
│    (en 2 min)             │
│                           │
│ 🔥 14:28 warming msg      │
│    Cuenta1 → Cuenta2      │
└──────────────────────────┘
```

### 5. Indicadores visuales
- Cuando una cuenta está mandando: **pulse animation violeta** en el avatar
- Cuando hay error: borde rojo + chip "⚠️ Error"
- Cuando está calentando: chip "🔥 Calentando" con tooltip de la fase
- Status icon: 🟢 conectada, 🟡 QR, 🔴 banneada, ⚫ desconectada

### 6. System tray mejorado (si setter cierra la ventana, queda en bandeja)
- Icono normal: la S violeta
- Cuando hay actividad: icono con punto verde animado
- Cuando hay error: icono con punto rojo
- Click derecho menu: "Abrir wa-multi" · "Pausar todas" · "Ver actividad" · "Salir"

### 7. Notificaciones nativas más claras
- "✓ Mensaje enviado a María desde Cuenta Principal"
- "⏳ Programado a Juan se envía en 2 min"
- "⚠️ Cuenta Trabajo perdió la conexión"
- Click en notif → abre wa-multi en la cuenta correspondiente

## Decisiones que necesito de tu lado

### 1. Activity feed: ¿lo querés visible siempre o en panel colapsable?
- **A)** Siempre visible al lado derecho (más info de un vistazo)
- **B)** Colapsable, default oculto (más espacio para las cuentas)
- **C)** En modal/drawer que abre con un botón

### 2. Cuando un setter cierra la ventana, ¿qué pasa?
- **A)** Minimiza a system tray, sigue corriendo en background (recomendado)
- **B)** Cierra completo, hay que abrir de nuevo manualmente
- **C)** Pregunta cada vez

### 3. ¿Cuántas cuentas típicas?
- Si son 1-3 → cards grandes verticales OK
- Si son 5+ → cards más compactas, agrupar por estado

### 4. Estilo del dashboard
- **A)** Cards de cuentas + activity feed lateral (mi propuesta)
- **B)** Solo lista de cuentas, sin feed (más simple)
- **C)** Tabs: "Mis cuentas" / "Actividad" / "Configuración"

### 5. ¿Querés tema dark obligatorio o configurable?
- **A)** Solo dark (consistencia con panel)
- **B)** Toggle dark/light

### 6. Tema setter vs admin
- **A)** Misma UI para todos
- **B)** Admin ve más cosas (cuentas de todos los setters, controles globales)
- **C)** Setter UI ultra-simplificada, admin como ahora

### 7. Onboarding primera vez
- **A)** Tour interactivo: "Esta es tu cuenta, esto es el botón QR..."
- **B)** Solo placeholder helpful texts en cada sección
- **C)** Sin onboarding, todo se aprende solo

### 8. Prioridad de orden

Si vamos por etapas, ¿qué armo primero?
- **A)** Branding + login + dark theme (estética base)
- **B)** Dashboard de cuentas + cards con estados (UX principal)
- **C)** Activity feed (visibilidad de qué está pasando)
- **D)** Todo junto en un build grande

## Mi recomendación (si me dejás decidir)

| Pregunta | Mi voto | Por qué |
|---|---|---|
| 1 Activity feed | B colapsable | No siempre la quiere ver, ocupa espacio |
| 2 Cierre ventana | A tray + corriendo | Es lo que esperaría un setter |
| 3 Cuántas cuentas | Diseñar para 1-5, escalar después | Caso real actual |
| 4 Estilo dashboard | A cards + feed colapsable | Mejor visibilidad |
| 5 Tema | A dark obligatorio | Consistencia con panel |
| 6 Setter vs admin | A misma UI | Más simple, menos código duplicado |
| 7 Onboarding | B placeholders | Tour es overkill para una app de 3 pantallas |
| 8 Prioridad | A → B → C en pushes separados | Iterar y validar |

## Out of scope (NO ahora)

- Multi-language (solo español)
- Tema light
- Configuración avanzada de notificaciones
- Drag&drop reorder de cuentas
- Plugin system

## Stack technical decisions

- Mantener Vue 3 + Element Plus + Pinia (lo que ya hay)
- Agregar **Geist font** via Google Fonts en index.html
- CSS variables coherentes con panel web
- Componentes nuevos a crear:
  - `AppShell.vue` (header + main + tray icon menu)
  - `Dashboard.vue` (stats + lista de cuentas)
  - `AccountCard.vue` (reemplaza fila de tabla, una por cuenta)
  - `ActivityFeed.vue` (panel lateral con eventos)
  - `LoginScreenBranded.vue` (reemplaza LoginView)
- Mantener `accounts.ts` store, agregar `activity.ts` para feed

## Riesgos

1. Rebuild de electron requiere el source con node_modules → no tengo node_modules
   en /tmp/wamulti-src. Voy a tener que reinstalar deps o hacer patches al
   binario como con el handler followup.
2. Element Plus es un design system completo — sobreescribir su tema requiere
   custom CSS pesado. Alternativa: usar componentes nativos HTML con CSS propio.
3. Cambios visuales fuertes pueden romper layouts en pantallas chicas
   (notebooks 13"). Validar.

---

**Pasame tus 8 respuestas (o "todas mis recomendaciones") y armo el PLAN.md.**
