# Phase setter-ux-redesign — SPEC

**Fecha:** 2026-05-22
**Owner:** Ignacio + Claude (build)
**Goal:** Que un setter nuevo abra el sistema, en 30 segundos entienda qué
tiene que hacer, y trabaje sus 100 leads del día **sin sentir fricción**.

## El usuario real

**Perfil del setter típico (basado en lo que vi en datos):**
- 20-35 años, comercial o estudiante
- Notebook (no PC potente). Pantallas 13-15"
- A veces usa el celu en paralelo (WhatsApp Business)
- NO es power-user de software. Quiere claridad, no opciones
- Trabaja 4-6 horas/día. Mucho click repetitivo
- El éxito = "agendé 3 demos esta semana"

**Lo que hace todos los días:**
1. Abre el sistema, busca dónde quedó ayer
2. Ve su lista de leads, identifica los que "tocan hoy"
3. Por cada uno: abre el modal del lead, lee notas, abre WhatsApp, escribe
4. Marca cómo fue (conectó / respondió / interesado)
5. Si quiere follow-up, lo programa
6. Después de varias horas, va a "Mi rendimiento" a ver cómo le fue

## Pain points identificados (de la auditoría + reportes del user)

### 🔴 Críticos
1. **Tabla CRM con 19 columnas** — sobrecarga visual. Muchos checkboxes y selects pequeños. Hay que scrollear horizontal todo el tiempo (ya pusimos scrollbar flotante pero igual)
2. **No hay "qué tengo que hacer AHORA"** — al abrir el sistema, no es obvio por dónde arrancar
3. **El modal del lead tiene mucha info junta** — datos, status, notas, variantes, follow-ups, programar... todo en una vista vertical larga
4. **Búsqueda requería formato exacto** (ya fixeado pero el resto sigue)

### 🟡 Importantes
5. **Sidebar tiene muchos items** que el setter no usa (admin/supervisor sí). Confunde
6. **Iconos sin labels** o labels en mayúscula tipo terminal — poco amigable
7. **Colores violetas con texto chico** — cuesta leer en pantallas malas
8. **No hay onboarding visual primera vez** que entra al CRM (el onboarding actual es el quiz, no la UI)
9. **No hay feedback inmediato** cuando una acción tarda (ej: marcar enviada → spinner? toast?)

### 🟢 Nice to have
10. **Modo oscuro** — bueno tenemos pero algunos contrastes podrían mejorar
11. **Atajos de teclado** — power setter podría avanzar mucho más rápido con J/K + Enter
12. **Sin animaciones de transición** — todo cambia instantáneo, se siente "duro"

## Propuestas de diseño (alto nivel)

### Idea 1: "Hoy" como pantalla de inicio del setter
Al loguearse, lo primero que ve es un **dashboard personal de hoy**:
```
┌──────────────────────────────────────────┐
│ Hola Paula 👋  Lunes 22 mayo, 14:30      │
├──────────────────────────────────────────┤
│ 🔥 Para hacer ahora                       │
│   • 7 leads sin contactar                  │
│   • 3 follow-ups vencidos                  │
│   • 2 respondieron — necesitan respuesta  │
│                                            │
│ 📊 Tu día                                  │
│   12 conexiones / 5 respuestas / 1 agend. │
│                                            │
│ [Ir al pipeline →]                        │
└──────────────────────────────────────────┘
```

### Idea 2: Tabla CRM con "modo simple" vs "modo experto"
- **Modo simple (default)**: 5-6 columnas (Lead, Phone, Estado, Última acción, Siguiente paso)
- **Modo experto (toggle)**: las 19 columnas actuales
- El setter empieza en simple, si necesita más, expande

### Idea 3: Modal del lead con "tabs"
- Tab 1: 💬 Conversación (mensajes + notas)
- Tab 2: 📋 Datos (nombre, ciudad, doctor, etc.)
- Tab 3: 🎯 Estado (conexión, respondió, calificó, etc.)
- Tab 4: 📅 Programar mensaje
- Tab 5: 🔧 Avanzado (variantes, decisor, etc.)

### Idea 4: Sidebar contextual al rol
- Setter ve solo 5 items: Inicio, Setteo, Llamadas, Mis programados, Centro de entrenamiento
- Admin ve todos
- Los items "técnicos" (Centro de Comando, Equipo, etc.) ya están ocultos para setter en `data-roles="admin"` pero el sidebar se ve cargado igual

### Idea 5: Action feedback visual
- Marcar "enviada" → flash verde sutil + check + toast "✓ Listo"
- Cargar nota → input se vacía con animación, scroll automático al final de la lista
- Programar mensaje → animación de "voló al programador"
- Loading states donde haya espera (>500ms)

### Idea 6: Onboarding visual (tour primer login)
- Primera vez que un setter entra al CRM, tour de 4 pasos con tooltips:
  1. "Esta es tu lista de leads" (highlight pipeline)
  2. "Click en uno para verlo" (highlight first row)
  3. "Acá tenés tus números de hoy" (highlight stats)
  4. "Listo! Tu Centro de Entrenamiento te explica el resto" (highlight sidebar item)
- Skippable. Se marca en localStorage para no repetir.

### Idea 7: Mejoras visuales chicas con alto impacto
- Tipografía: más peso a labels, menos a chrome
- Contrastes: subir un poco el `--text-secondary` para leer mejor
- Spacing: más aire entre filas de la tabla (densidad reducida)
- Estados con color claro: WSP enviado = chip verde, sin contactar = chip neutro, respondió = chip naranja, agendado = chip celebración

## Decisiones que necesito de tu lado

Antes de armar el PLAN, **8 preguntas concretas** para no construir lo que no querés:

### 1. "Hoy" como pantalla inicio — ¿sí o reemplaza?
- **A)** SÍ, pantalla nueva default al loguearse. El setter primero ve "Hoy" y de ahí va al pipeline.
- **B)** NO, dejar el pipeline (Setteo) como hoy. Solo agregar un widget "Hoy" arriba.
- **C)** No por ahora, lo dejamos para fase 2.

### 2. Modo simple vs experto — ¿quién decide?
- **A)** Default modo simple para todos los setters. Toggle para expandir.
- **B)** Setter elige una vez, queda guardado. Admin siempre ve modo experto.
- **C)** Solo modo simple (achicar la tabla para todos), las columnas extra van al modal del lead.

### 3. Modal del lead con tabs — ¿cuántas tabs?
- **A)** 5 tabs como propuse (Conversación / Datos / Estado / Programar / Avanzado)
- **B)** Solo 3 (Conversación / Estado / Programar) — el resto en accordion
- **C)** Sin tabs, mantener vista actual pero con mejor jerarquía visual

### 4. Sidebar contextual — ¿lo achicamos?
- **A)** Sí, setter solo ve 4-5 items. Resto oculto.
- **B)** Sí, setter ve los mismos items pero con badge "no disponible" en los de admin.
- **C)** Dejarlo como está.

### 5. Tour primer login — ¿lo armamos?
- **A)** Sí, 4 pasos con tooltips. Skippable.
- **B)** Solo un banner inicial tipo "Bienvenido Paula! Acá tenés tu pipeline. [Cerrar]"
- **C)** No, ya tenemos el Centro de Entrenamiento.

### 6. Atajos de teclado — ¿agregar?
- **A)** Sí: J/K = navegar leads, Enter = abrir, Esc = cerrar modal, 1/2/3 = marcar estados
- **B)** Solo Esc para cerrar modal y Ctrl+K para command palette (que ya existe)
- **C)** No, no es para nuestro setter típico.

### 7. Densidad de tabla
- **A)** Más aire entre filas (rows más altas)
- **B)** Misma densidad pero con zebra striping más sutil
- **C)** No tocar, está bien

### 8. ¿Por dónde arranco si elegimos varias?
Si decís que sí a varias, ¿cuál es prioridad?

## Mi recomendación (si me dejás decidir todo)

| Pregunta | Mi voto | Por qué |
|---|---|---|
| 1 Pantalla Hoy | **B** widget arriba del Setteo | Menos disrupción, agrega valor sin cambiar el flow conocido |
| 2 Modo simple | **C** simple para todos, resto en modal | Decisión de diseño firme = menos UI duplicada |
| 3 Tabs modal | **B** 3 tabs | Menos clicks, lo que importa primero |
| 4 Sidebar | **A** achicar para setter | Limpia la vista |
| 5 Tour | **B** banner simple | Tour completo es overkill para nuestro caso |
| 6 Atajos | **B** Esc + Ctrl+K | El resto se aprende solo |
| 7 Densidad | **A** más aire | Lectura más rápida, menos cansancio visual |
| Prioridad | Tabla simple + Modal con tabs + Sidebar achicado | Las 3 + impacto |

## Out of scope (NO ahora)

- Modo claro completo (light theme)
- Versión mobile dedicada (responsive ya funciona OK)
- Animaciones complejas (lottie / framer)
- Customización de colores por usuario
- Drag & drop para reordenar columnas

## Riesgos

1. **Setters acostumbrados a la vista actual** se confunden con cambios — mitigación: si elegimos modo simple+experto, el toggle es visible
2. **Esconder columnas en modal** puede esconder data que admin sí mira a diario — mitigación: admin tiene su vista de power-user en Centro de Comando
3. **Tabs en modal** agregan 1 click vs ver todo de una — mitigación: arrancar en la tab "Conversación" que es donde más se mira

---

**Pasale los 8 quick answers (o "todas mis recomendaciones") y armo el PLAN.md con tareas concretas.**
