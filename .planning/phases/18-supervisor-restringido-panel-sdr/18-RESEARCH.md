# Phase 18: Supervisor restringido + panel de rendimiento SDR - Research

**Researched:** 2026-07-12
**Domain:** RBAC scoping en Express monolito (index.js ~13700 líneas) + frontend vanilla JS (app.js ~14800 líneas)
**Confidence:** HIGH (auditoría directa del código, no hay librerías externas involucradas)

## Summary

Esta fase es 100% auditoría + refactor de RBAC sobre un patrón ya maduro en el
código: `role === 'setter'` se usa hoy en ~15 endpoints como "filtrar a lo
mío". El trabajo es replicar ese mismo patrón para `role === 'supervisor' &&
visibleSetterIds.length > 0` ("filtrar a mi subconjunto"), en un helper
central, y aplicarlo en cada uno de los ~20 endpoints que hoy devuelven data
agregada o per-setter sin ningún filtro cuando el caller es supervisor
(`requireRole('admin','supervisor')` = acceso total, sin distinción interna).

`req.auth.user` en TODOS los handlers es el objeto RAW de `auth.json` (no
pasa por `publicUser()`), así que `req.auth.user.visibleSetterIds` está
disponible directamente sin tocar `attachAuth`/`getSessionFromRequest`. El
campo nuevo se agrega al user record y se refleja en `publicUser()` para que
el frontend lo reciba en `/api/auth/me`.

**Primary recommendation:** Un solo helper `_visibleSetterIds(authUser)` que
devuelve `null` (sin restricción — admin, o supervisor sin
`visibleSetterIds`, o setter) o un `Set<string>` (supervisor scoped). Un
segundo helper `_setterVisible(setterId, visibleSet)` para chequeos
puntuales. Se inyectan en cada endpoint tocado siguiendo el patrón existente
`if (role === 'setter') { filtrar por authSetterId }` → agregar rama `else if
(visibleSet) { filtrar por visibleSet.has(...) }`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Modelo de datos:**
- Campo `visibleSetterIds[]` en el user record de `auth.json`.
- Vacío o ausente = supervisor ve TODO (comportamiento actual intacto — cero
  regresión para supervisores existentes).
- Con valores = el backend filtra TODA respuesta por esa lista.

**Scoping server-side:**
- RBAC real en backend, no solo filtro de UI. Un supervisor scoped que pegue
  a la API a mano tampoco puede ver data de setters fuera de su lista.
- Auditar TODOS los endpoints que el rol supervisor puede tocar hoy
  (team-performance, cold-call-metrics, performance, calls-today,
  telnyx/metrics, cold-call-effectiveness, objection-analytics,
  pool-summary, training/calls, auth/online, call-history, leads, etc.) y
  aplicar el filtro en cada uno.
- Los setters fuera de la lista NO deben aparecer ni siquiera como
  nombres/ids en dropdowns o agregados de equipo.

**Gestión:**
- Admin gestiona `visibleSetterIds` desde el Centro de Comando al
  crear/editar usuarios (UI de tildar setters visibles).
- El usuario supervisor real se crea vía el flujo de invitación existente.

**Frontend:**
- Home del supervisor scoped = panel de rendimiento pro. Reutilizar/extender
  view-team + Cold Call Funnel (patrón visual de view-myperf rediseñada,
  nota #114 de CLAUDE.md: `.myp-tile`, `.seg-control`, `.ccm-*`).
- Métricas: llamadas por día, connects, conversaciones, agendas, deals,
  tendencias (evolución temporal), alertas, comparativa entre sus SDRs.
- Dropdowns de setter en cualquier vista accesible muestran SOLO los setters
  visibles.

### Claude's Discretion
- Nombre exacto del campo y helpers (`visibleSetterIds` sugerido).
- Si conviene un helper central tipo `getVisibleSetterIds(req)` /
  `filterByVisibleSetters()` reutilizado por todos los endpoints (preferible
  a parches ad-hoc por endpoint). **→ Ver sección "Recommended implementation
  shape" abajo, es la recomendación de este research.**
- Qué vistas del sidebar ve el supervisor scoped (mínimo: panel de
  rendimiento; criterio: nada que exponga leads/llamadas de setters
  ocultos).
- Detalles visuales del panel dentro del Design System v1.1.

### Deferred Ideas (OUT OF SCOPE)
- Biblioteca general de llamadas del equipo para supervisor (nota #118 la
  deja explícitamente para después).
- Permisos granulares por vista (más allá de setter-scoping).

<phase_requirements>
## Phase Requirements

No hay REQUIREMENTS.md con IDs formales para esta fase — el CONTEXT.md es la
fuente de decisiones. Mapeo de entregables declarados en `<domain>` del
CONTEXT a este research:

| Entregable (CONTEXT.md) | Research Support |
|---|---|
| (a) mecanismo de scoping server-side | Sección "Endpoint surface" + "Recommended implementation shape" |
| (b) gestión desde el panel admin | Sección "Auth plumbing" (invitación/PATCH users) + "Frontend surface" |
| (c) panel de rendimiento pro como home del supervisor scoped | Sección "Frontend surface" (view-team, `_teamLoad`, `_mypLoad`/`_mypLoadColdCall`, init default view) |
| (d) tests | Sección "Test patterns to reuse" |
| (e) instrucciones para crear el usuario real vía invitación | Sección "Auth plumbing" → flujo `/api/auth/invites` + `/api/auth/accept-invite` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Scoping RBAC (quién ve qué setter) | API/Backend (index.js) | — | Debe ser inviolable vía API directa, no solo UI |
| Gestión de `visibleSetterIds` | API/Backend (PATCH /api/auth/users/:id) | Frontend (Centro de Comando) | El dato vive en `auth.json`, la UI solo lo edita |
| Filtrado de dropdowns/listas | Frontend (app.js) | API/Backend (fuente ya filtrada) | El backend YA debe devolver solo lo visible; el frontend no filtra de más, solo renderiza lo que llega |
| Home del supervisor scoped | Frontend (app.js init + view-team/view-myperf) | API/Backend (team-performance ya filtrado) | Decisión de qué vista clickear por default es puramente frontend |
| Persistencia del user record | Database/Storage (`data/auth.json`) | — | JSON file-based, sin DB — ya cubierto por `loadAuthData`/`saveAuthData` |

## Auth Plumbing

### `attachAuth` (index.js:405)
Middleware montado globalmente (no solo en `/api` — revisar dónde se
`app.use`, pero por convención del proyecto es global salvo rutas de
onboarding público). Llama a `getSessionFromRequest(req)` y setea
`req.auth = { session, user }` con el **objeto RAW de `auth.json`** (no
`publicUser()`). También actualiza el Map en memoria `onlinePresence` con
`{userId, name, email, role, lastSeen, ip, userAgent}` — **este Map NO
incluye `visibleSetterIds`**, así que si `/api/auth/online` se filtra por
setter visible, hay que resolverlo desde `auth.json` completo (`u.setterId`)
en cada request del endpoint, no desde el Map.

### `getSessionFromRequest` (index.js:367)
```js
function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionId = cookies.gs_session;
  if (!sessionId) return null;
  const data = loadAuthData();
  const session = data.sessions.find(...);
  const user = data.users.find((u) => u.id === session.userId && u.status === "active");
  return { session, user };
}
```
`user` es el registro completo tal cual está en `auth.json` → cualquier
campo nuevo agregado al user record (`visibleSetterIds`) está disponible en
`req.auth.user.visibleSetterIds` sin tocar este helper.

### `requireAuth` / `requireRole` (index.js:496-507)
`requireRole(...roles)` solo chequea `roles.includes(req.auth.user.role)` —
es un gate binario por rol, NO hace scoping. El scoping (esta fase) debe
implementarse DENTRO de cada handler, después de pasar `requireRole`.

### `getEffectiveAuth(req)` (index.js:519-535)
Resuelve `{ role, setterId, isImpersonating }` considerando el parámetro
`?viewAs=` (solo disponible si el user REAL es admin, para "ver como"). Para
supervisor real (no admin impersonando) devuelve
`{ role: 'supervisor', setterId: user.setterId, isImpersonating: false }` —
**NO devuelve `visibleSetterIds`**. Si se decide extender este helper para
incluir el scoping (recomendado, ver abajo), hay que agregar el campo acá
también, y decidir qué pasa si un admin hace `?viewAs=supervisor` — hoy no
hay forma de simular "viendo como supervisor scoped X", así que
`isImpersonating` con `viewAs=supervisor` seguiría sin restricción salvo que
se agregue lógica nueva (fuera de alcance de esta fase, no lo pide el
CONTEXT).

### Shape del user record en `auth.json`
```js
// auth.json → { users: [...], invites: [...], sessions: [...] }
{
  id: "user_supervisor_xxx",
  email: "...",
  name: "...",
  role: "admin" | "supervisor" | "setter",
  status: "active" | ...,
  setterId: "",          // solo si role === 'setter' (o ex-setter promovido)
  password: { salt, hash },
  createdAt, updatedAt,
  lastSeen, lastIp, lastUserAgent   // presencia persistida (nota #35 CLAUDE.md)
  // CAMPO NUEVO PROPUESTO: visibleSetterIds: string[]  (default ausente = sin restricción)
}
```

`publicUser(user)` (index.js:218) es la proyección que se devuelve en
`/api/auth/me`, `/api/auth/login`, `/api/auth/users` (vía `.map(publicUser)`)
y `/api/auth/accept-invite`. **HAY QUE agregar `visibleSetterIds:
user.visibleSetterIds || []` acá**, si no el frontend nunca puede saber si
el supervisor logueado está scoped (necesario para decidir el home view y
para que el admin vea el estado actual en la tabla de usuarios).

### Dónde se crean/editan users
| Acción | Endpoint | Línea | Rol requerido |
|---|---|---|---|
| Crear invitación | `POST /api/auth/invites` | 1838 | admin |
| Aceptar invitación (crea el user) | `POST /api/auth/accept-invite` | 1893 | público (token) |
| Listar users | `GET /api/auth/users` | 1645 | admin, supervisor |
| Editar rol/nombre | `PATCH /api/auth/users/:id` | 5700 | admin |
| Reset password | `POST /api/auth/users/:id/reset-password` | 5755 | admin |
| Borrar user | `DELETE /api/auth/users/:id` | 5781 | admin |

**Punto de inserción natural para `visibleSetterIds`:**
- `POST /api/auth/invites` (1838): agregar `visibleSetterIds` opcional al
  body, validar que `role === 'supervisor'` (o al menos que sea array de
  strings), guardarlo en el objeto `invite`. En `POST /api/auth/accept-invite`
  (1893), copiar `invite.visibleSetterIds || []` al `user` creado (mismo
  patrón que `setterId: invite.setterId || ''`).
- `PATCH /api/auth/users/:id` (5700): agregar soporte para
  `visibleSetterIds` en el body (array de setter ids existentes, validar
  contra `data.setters` — opcional pero recomendado), guardar en `user`.
  Este es el punto MÁS importante porque el CONTEXT dice "gestiona desde
  crear/editar usuarios" y el user Judith/Roxana/Nadine puede necesitar
  ajustar la lista después de creado sin tener que reinvitar.

**Nota operativa (del CONTEXT):** Nadine (`setter_nadine_tortonese`) todavía
no tiene user en `auth.json`, solo el setter profile en `setters.json`. El
supervisor scoped puede crearse ANTES de que Nadine tenga login — el
`visibleSetterIds` solo necesita el `setterId`, no el user de Nadine.

## Frontend Surface — Centro de Comando (creación/edición de usuarios)

- `public/index.html:1843-1886` — sección `.admin-users-panel`
  (`data-roles="admin,supervisor"`), formulario de invitación
  (`data-roles="admin"` únicamente en el form + resultado) con inputs
  `#invite-name`, `#invite-email`, `#invite-role` (select con
  `setter|supervisor|admin`), botón `#invite-user-btn`. Tabla
  `#users-table` con columnas Nombre/Email/Rol/Estado/Vars/Onboarding/
  Invitación/Acciones.
- `public/app.js:9208` `loadUsersPanel()` — hace fetch a `/api/auth/users` +
  `/api/setters` + `/api/onboarding/progress/all`, renderiza filas. Las
  acciones (`meIsAdmin` gate) son botones inline con `onclick` a funciones
  `window._changeUserRole`, `window._resetUserPassword`, `window._deleteUser`,
  etc. Patrón de UI: **NO usa modales, usa `prompt()`** para editar rol
  (`window._changeUserRole`, app.js:9423 — pide el rol nuevo por
  `prompt()` con las 3 opciones en texto). Para `visibleSetterIds` (una
  lista de checkboxes) `prompt()` no alcanza — se necesita un modal simple
  nuevo (mismo patrón visual que `_showOnboardingDetail` en app.js:9304,
  que construye un overlay fixed con `document.createElement` +
  `innerHTML`).
- `public/app.js:9530` `inviteUserBtn` click handler — arma el body de
  `POST /api/auth/invites` con `{name, email, role, sendEmail:true}`. Acá
  hay que agregar `visibleSetterIds` cuando `role === 'supervisor'` y el
  admin tildó setters en un selector nuevo (mostrar/ocultar el selector con
  un listener en `#invite-role` `change`).

## Endpoint Surface for role `supervisor` (exhaustive audit)

Metodología: grep de `supervisor` en index.js (77 hits) + lectura de cada
handler. Se listan TODOS los endpoints que el rol supervisor puede tocar
hoy, con qué data por-setter devuelven y CÓMO filtrarla.

**Leyenda de acción:**
- 🔴 **debe filtrar** — devuelve data cruzando setters, hoy sin ningún
  filtro para supervisor.
- 🟡 **debe validar ownership** — expone/opera sobre UN lead/setter puntual
  por :id o query param; hoy solo valida `role==='setter'`, falta rama para
  supervisor scoped.
- 🟢 **sin cambios** — ya filtra correctamente o no expone data por-setter.
- ⚪ **discrecional / considerar bloquear entero** — endpoints de
  administración de pool/costos que quizás conviene simplemente NO exponer
  al supervisor scoped (más simple y más seguro que filtrar), ver
  "Recommended implementation shape".

### Métricas / dashboards
| Endpoint | Método | Línea | Qué expone | Acción |
|---|---|---|---|---|
| `/api/setters/team-performance` | GET | 8929 | `perSetter[]` (TODOS los setters con KPIs), `teamAverages` (promedio sobre TODOS), `alerts[]` con `setterName` | 🔴 filtrar `data.setters` a `visibleSet` ANTES de construir `perSetter` (línea 8988 `.map`), así `teamAverages` (línea 9059-9072) se calcula ya sobre el subconjunto — **crítico: filtrar ANTES de promediar, no después**, si no el promedio incluye a los ocultos aunque no aparezcan en la lista |
| `/api/setters/cold-call-metrics` | GET | 5319 | Con `?setter=` vacío (admin/supervisor "todos"), agrega TODO `data.leads` sin filtro (línea 5328-5359) | 🔴 si `requestedSetter` vacío y hay `visibleSet`: iterar solo leads con `assignedTo` en `visibleSet` (o, más simple, correr el loop una vez por cada setterId visible y sumar). Si `requestedSetter` viene seteado, validar 🟡 que esté en `visibleSet` (403 si no) |
| `/api/setters/performance` | GET | 8793 | `setterFilter` vacío → agrega TODOS los leads (línea 8827-8829); `setters: (data.setters||[]).map(...)` sin filtrar (línea 8871) — usado por `_mypLoad` para poblar el dropdown | 🔴 filtrar `allLeads` a `visibleSet` cuando no hay `setterFilter`; filtrar el array `setters` devuelto; 🟡 validar `setterFilter` individual contra `visibleSet` |
| `/api/setters/team/:id/calls-today` | GET | 5411 | Cuenta llamadas de UN setter por `:id`; el gate actual es `role==='setter'→match exacto` / `role==='admin'||'supervisor'→pasa libre` (línea 5419) | 🟡 agregar chequeo: si `visibleSet` existe y `!visibleSet.has(setterId)` → 403 |
| `/api/setters/team/:id/quota` | GET | 5221 | Igual patrón que calls-today (línea 5229) | 🟡 mismo chequeo |
| `/api/setters/objection-analytics` | GET | 5971 | `bySetter` agrega TODOS los setterIds encontrados en callLog, sin filtro (línea 5985-6022) | 🔴 en el loop principal (línea 5991-6016), si `visibleSet && !visibleSet.has(setterId)` → `continue` antes de acumular en `bySetter`/`byCountry`/`byTag` (nota: si se quiere filtrar TODO el análisis por SDRs visibles, no solo `bySetter`, hay que aplicar el filtro más arriba, sobre `lead.assignedTo`, no sobre `_callSetterId` del entry — decidir semántica: "solo llamadas hechas por mis SDRs" vs "solo leads asignados a mis SDRs" — recomendado: filtrar por `_callSetterId` para consistencia con team-performance/cold-call-metrics) |
| `/api/setters/pool-summary` | GET | 6853 | `bySetter{}` TODOS los setters con leads, `allSetters` TODOS los setters (línea 6891, ya filtra `!s.hidden` pero NO por visibilidad) | 🔴 o ⚪ — ver discreción abajo (recomendado: 403 para supervisor scoped, es una vista de gestión de pool, no de "mi equipo") |
| `/api/setters/pool-setter-breakdown` | GET | 6903 | Desglose de UN setter por `?setterId=` | 🟡 validar `setterId` contra `visibleSet` |
| `/api/setters/alert-config` | GET | 8907 | Config global de umbrales, NO tiene data por-setter | 🟢 sin cambios |
| `/api/setters/command` | GET | 9094 | Stats globales del Centro de Comando (todos los setters, todas las variantes) — usado por `view-command` | 🔴 si se decide dar acceso a `view-command` al supervisor scoped (NO recomendado, ver Frontend); si se bloquea la vista entera, no hace falta tocar el endpoint |
| `/api/setters` | GET | 5132 | `{setters: data.setters, variants}` — **TODOS los setters, sin ningún filtro de rol** (solo `requireAuth`, cualquier rol autenticado lo puede pegar) | 🔴 este es el endpoint más usado por dropdowns legacy (`loadSetterModule`, `loadUsersPanel`). Filtrar `data.setters` a `visibleSet` cuando el caller es supervisor scoped |
| `/api/setters/stats` | GET | 8368 | Stats agregadas + `setters: data.setters` sin filtrar al final (verificar cola del handler) | 🔴 mismo patrón que `/leads` — cuando `authSetterId` vacío y hay `visibleSet`, filtrar `leads` a `visibleSet` antes de agregar, y filtrar `data.setters` en la respuesta |

### Leads / calendario (ownership por :id o por assignedTo)
| Endpoint | Método | Línea | Qué expone | Acción |
|---|---|---|---|---|
| `/api/setters/leads` | GET | 5908 | `?setter=` sin chequeo de scope (línea 5914-5918); sin `?setter=`, devuelve TODOS los leads | 🔴 filtrar por `visibleSet` cuando no hay `authSetterId` (setter real) |
| `/api/setters/leads/sin-wsp` | GET | 5925 | Igual patrón (línea 5954-5964) | 🔴 mismo filtro |
| `/api/setters/leads/:id/contact-status` | GET | 7162 | Solo chequea `role==='setter'` (línea 7166) | 🟡 agregar: si `visibleSet && !visibleSet.has(lead.assignedTo)` → 403 |
| `/api/setters/leads/:id` | PATCH | 7177 | Mismo patrón — CUALQUIER supervisor puede editar CUALQUIER lead hoy (línea 7181) | 🟡 **crítico** — agregar el mismo chequeo. Nota: `assignedTo` solo lo puede tocar `role==='admin'` (línea 7198), así que un supervisor scoped no puede "robar" leads reasignando, pero SÍ podría hoy editar campos de un lead ajeno si no se agrega el guard |
| `/api/setters/leads/:id/followup` | PATCH | 7373 | Revisar mismo patrón de ownership (no leído en detalle, mismo criterio aplica) | 🟡 aplicar mismo guard |
| `/api/setters/leads/:id/asistencia` | PATCH | 7676 | `requireRole('admin','supervisor')`, sin chequeo de setter dueño de la cita | 🟡 agregar guard sobre `lead.assignedTo` |
| `/api/setters/calendar` | GET | 9549 | Solo filtra si `role==='setter'` (línea 9552) | 🔴 filtrar `entry.setterId` contra `visibleSet` cuando aplica |
| `/api/setters/calendar/enriched` | GET | 9593 | Mismo patrón (línea 9596-9597) | 🔴 mismo filtro |
| `/api/setters/calendar` | POST | 9556 | Un setter no puede crear entry para lead ajeno (línea 9569-9574); admin/supervisor pueden pasar `setterId` cualquiera sin chequeo | 🟡 validar `setterId`/lead ownership contra `visibleSet` si viene de un supervisor scoped |

### Telnyx / costos / llamadas
| Endpoint | Método | Línea | Qué expone | Acción |
|---|---|---|---|---|
| `/api/telnyx/metrics` | GET | 13589 | `bySetter{}` con nombre+costo+minutos de TODOS los setters (línea 13614-13655) | 🔴 filtrar el loop principal por `visibleSet` (usando `_callSetterId`), o ⚪ bloquear entero (es un dashboard de costos, discrecional si un supervisor de equipo debe verlo) |
| `/api/telnyx/cold-call-effectiveness` | GET | 12609 | Agregados de TODAS las calls (país/hora/día/outcome), **sin desglose por setterId en la response pero el pool de calls SÍ mezcla llamadas de setters ocultos en los agregados** | 🔴 filtrar `calls` (línea 12622-12630) por `_callSetterId(...)` en `visibleSet` antes de agregar — si no, aunque no se vea el nombre, los ratios/totales incluyen actividad de Ignacio/Paula |
| `/api/telnyx/real-costs` | GET | 12212 | Costos reales via CDRs de Telnyx (cuenta completa) — no está claro que tenga desglose por setter, mayormente cuenta-wide | ⚪ revisar si tiene `bySetter`; si no, considerar bloquear para scoped (es info financiera de cuenta, no de equipo) |
| `/api/telnyx/balance` | GET | 12053 | Saldo de la cuenta Telnyx completa, NO por setter | ⚪ recomendado bloquear para supervisor scoped (info financiera de cuenta, fuera del "rendimiento de mi equipo") |
| `/api/telnyx/events` | GET | 13678 | Log de webhooks Telnyx (incluye teléfonos, no necesariamente setter) | ⚪ revisar contenido; probablemente bloquear/no incluir en sidebar del scoped |
| `/api/telnyx/script-effectiveness` | GET | 12747 | Métrica por script, cruza `settersData` — revisar si tiene bySetter | 🔴 si agrega por setterId, mismo patrón que effectiveness |
| `/api/telnyx/calls/recent` | GET | 12977 | Ya usa `getEffectiveAuth` + filtra por `authSetterId` si `role==='setter'` (línea 12980-12988), pero supervisor pasa sin filtro | 🔴 agregar filtro `visibleSet` en el mismo `if` (línea 12988) |
| `/api/telnyx/calls/:leadId/transcribe` | POST | 13391-13396 | Ya tiene RBAC por ownership para setter (nota #109 CLAUDE.md); admin/supervisor "cualquiera" (línea 13396) | 🟡 agregar chequeo `visibleSet` para supervisor scoped |

### Entrenamiento IA / biblioteca
| Endpoint | Método | Línea | Qué expone | Acción |
|---|---|---|---|---|
| `/api/training/calls` | GET | 13172 | Ya tiene un patrón de exclusión (`TRAINING_EXCLUDED_SETTERS`, hardcoded Set con `setter_ignacio`, línea 13167/13191/13198) + filtro `onlyOwn` para setter (línea 13185-13202) — admin/supervisor ven TODO sin restricción | 🔴 **este es el precedente de código MÁS parecido a lo que hay que construir.** Extender: si `visibleSet` existe (supervisor scoped), aplicar la MISMA lógica que `TRAINING_EXCLUDED_SETTERS` pero en modo "solo incluir" en vez de "excluir": `if (visibleSet && !visibleSet.has(lead.assignedTo)) continue;` + mismo chequeo sobre `userSetterId[c.by]` |
| `/api/training/calls/:leadId/:callIdx` | GET | 13219 | Detalle de UNA llamada — revisar si valida ownership para admin/supervisor (no leído en profundidad, aplicar mismo patrón que `#118`) | 🟡 agregar guard |

### Auth / presencia / usuarios
| Endpoint | Método | Línea | Qué expone | Acción |
|---|---|---|---|---|
| `/api/auth/online` | GET | 1567 | TODOS los users activos (nombre/email/rol/presencia), sin distinción de setter | 🔴 filtrar `allUsers` a: el propio user + users cuyo `u.setterId` esté en `visibleSet` (construir un `Map` userId→setterId igual que `_buildUserSetterMap()`, línea 5303) |
| `/api/auth/users` | GET | 1645 | TODOS los users (`.map(publicUser)`) — usado en `loadUsersPanel` y para la tabla de gestión | ⚪ **discrecional pero importante:** el CONTEXT dice "gestiona desde el panel admin" — la gestión de `visibleSetterIds` es exclusiva de admin (`PATCH` ya es admin-only). El acceso de LECTURA de supervisor a este endpoint hoy es para que vea "quién es quién" en Centro de Comando — si el panel de Comando entero se bloquea para el supervisor scoped (recomendado, ver Frontend), este endpoint deja de ser alcanzado por él y no hace falta tocarlo. Si se decide dejarlo accesible, filtrar `data.users` a users con `setterId` en `visibleSet` + el propio user |

### Endpoints NO afectados (verificados, sin acción)
- `/api/admin/export-leads` (9340) — exporta la base COMPLETA de prospectos
  (no filtra por `assignedTo`, no incluye qué setter tiene el lead) — 🟢 no
  es data "de un setter", es el catálogo de prospección crudo.
- `/api/admin/emails-for-websites` (9393) — stateless, no toca setters.
- `/api/onboarding/progress/all`, `/api/onboarding/progress/:userId` (3543,
  3553) — progreso de onboarding, no data operativa de leads/llamadas;
  técnicamente lista todos los users pero es bajo riesgo (progreso de quiz,
  no leads). Discrecional filtrar si se quiere ser estricto, no es
  prioridad del CONTEXT.
- `/api/admin/serpapi-account` (2500) — uso de cuota SerpAPI, cuenta-wide.
- `/api/setters/recent-responses` (6084) — poll de callbacks vencidos,
  revisar si agrega por setter (no leído en detalle — mismo criterio que
  `objection-analytics` si expone `setterId`).
- `/api/mercury/stats` (11660), `/api/faqs/*` PUT/DELETE (10440/10487) —
  bancos de respuesta/generaciones compartidas del equipo, no por-setter
  identificable en el CONTEXT.

## Recommended Implementation Shape

### Helper central (index.js, cerca de `_buildUserSetterMap` línea 5303)

```js
// Devuelve null si el auth NO tiene restricción de setters visibles
// (admin, setter, o supervisor SIN visibleSetterIds configurado).
// Devuelve un Set<string> de setterIds visibles si es supervisor scoped.
function _visibleSetterIds(authUser) {
  if (!authUser || authUser.role !== 'supervisor') return null;
  const ids = Array.isArray(authUser.visibleSetterIds) ? authUser.visibleSetterIds.filter(Boolean) : [];
  if (ids.length === 0) return null; // vacío/ausente = sin restricción (LOCKED en CONTEXT)
  return new Set(ids);
}

// Filtra un array de setters (data.setters) al subconjunto visible.
// visibleSet === null → devuelve el array sin tocar.
function _filterSettersVisible(setters, visibleSet) {
  if (!visibleSet) return setters;
  return (setters || []).filter((s) => visibleSet.has(s.id));
}

// true si el setterId dado es visible para este auth (o no hay restricción).
function _setterIsVisible(setterId, visibleSet) {
  return !visibleSet || visibleSet.has(setterId);
}
```

Exponer en `globalThis.__phase18 = { _visibleSetterIds, _filterSettersVisible, _setterIsVisible }`
para tests puros (mismo patrón que `globalThis.__metricsAudit`,
`globalThis.__phase16`, `globalThis.__mercury`).

### Dónde usar cuál

| Patrón de endpoint | Helper a usar |
|---|---|
| Devuelve lista agregada de TODOS los setters (`team-performance`, `pool-summary`, `/api/setters`, `objection-analytics.bySetter`) | Filtrar el array de setters/entries ANTES de agregar/promediar con `visibleSet.has(id)` inline en el loop, o `_filterSettersVisible` si es un `.map()` directo sobre `data.setters` |
| Devuelve agregado "team-wide" cuando `?setter=` viene vacío (`cold-call-metrics`, `performance`, `cold-call-effectiveness`) | En el loop de leads/calls: `if (visibleSet && !visibleSet.has(setterId)) continue;` |
| Recibe un `:id` o `?setter=X` puntual (`calls-today`, `quota`, `pool-setter-breakdown`) | `if (visibleSet && !visibleSet.has(requestedId)) return res.status(403).json(...)` |
| Devuelve lista de users (`auth/online`, `auth/users`) | Mapear `u.setterId` (via `_buildUserSetterMap`-like) y filtrar users cuyo setterId no esté en `visibleSet` (siempre incluir al propio user aunque no tenga setterId) |
| Lead individual por `:id` (`leads/:id` PATCH, `asistencia`, `contact-status`, `followup`) | `if (visibleSet && !_setterIsVisible(lead.assignedTo, visibleSet)) return res.status(403)...` — mismo bloque que ya existe para `role==='setter'`, agregar como `else if` |

### Edge cases explícitos (del CONTEXT y del audit)

1. **Agregados DEBEN filtrarse ANTES de promediar/sumar, no después de
   construir la lista completa.** Ejemplo concreto: en
   `team-performance` (línea 8988-9072), si se filtra `perSetter` recién al
   final (`res.json`), `teamAverages` seguiría promediando sobre setters
   ocultos aunque no aparezcan en el array — el supervisor podría inferir
   su actividad restando. **Filtrar `data.setters` a `_filterSettersVisible`
   ANTES del `.map()` de la línea 8988.**
2. **`?setter=` vacío = "todos los setters VISIBLES", no "todos los
   setters".** Aplica a `cold-call-metrics`, `performance`,
   `cold-call-effectiveness`. No es que el endpoint deba rechazar el pedido
   vacío — debe interpretar "vacío" como "agregado del subconjunto visible".
3. **Un supervisor scoped que pega `?setter=setter_ignacio` a mano debe
   recibir 403, no un resultado vacío silencioso.** Vacío silencioso permite
   inferencia por comparación de tiempos de respuesta / diffing; 403 es
   honesto y consistente con el patrón ya usado para `role==='setter'`
   (ej. `calls-today` línea 5415-5417 devuelve 403, no `[]`).
4. **Leads: filtrar por `lead.assignedTo`, llamadas: filtrar por
   `_callSetterId(entry, lead, userMap)`.** Son fuentes de verdad
   DIFERENTES (nota #113 CLAUDE.md — atribución por quién llamó vs dueño
   actual). Para métricas de llamadas (`cold-call-metrics`,
   `objection-analytics`, `telnyx/metrics`, `cold-call-effectiveness`) usar
   siempre `_callSetterId`. Para vistas de leads/pool
   (`leads`, `sin-wsp`, `pool-summary`, `calendar`) usar
   `lead.assignedTo`/`entry.setterId` directamente.
5. **`getEffectiveAuth` no resuelve `visibleSetterIds` hoy.** Recomendado
   extenderlo para incluir `visibleSetterIds: authUser.visibleSetterIds ||
   []` en el objeto que devuelve (no rompe nada, es un campo nuevo), así
   los ~6 endpoints que ya usan `getEffectiveAuth` (`leads`, `sin-wsp`,
   `stats`, `telnyx/calls/recent`, `training/calls`, `cold-call-metrics`)
   pueden leer `eff.visibleSetterIds` sin recalcular. Los que NO usan
   `getEffectiveAuth` (usan `req.auth.user.role` directo, la mayoría de la
   tabla de arriba) deben llamar `_visibleSetterIds(req.auth.user)`
   directamente.
6. **Endpoints financieros/pool de gestión (`telnyx/balance`,
   `telnyx/real-costs`, `telnyx/events`, `pool-summary`,
   `pool-setter-breakdown`, `command`) — recomendación: BLOQUEAR
   completamente para supervisor scoped en vez de filtrar.** Razón: son
   vistas de "gestión de la operación completa" (saldo de cuenta,
   distribución de pool, centro de comando con export/enrichment/scraping),
   no "rendimiento de mi equipo". Filtrarlas agrega complejidad sin valor
   claro — el CONTEXT pide "panel de rendimiento", no "gestión de pool
   restringida". Bloquear = un simple `if (visibleSet) return
   res.status(403).json({error:'No disponible para supervisor con
   setters restringidos.'})` al principio del handler, DESPUÉS de
   `requireRole('admin','supervisor')`. Esto también resuelve
   automáticamente el filtrado de esos endpoints sin tocar su lógica
   interna (menos superficie de bugs).
7. **Zero-regression:** todo supervisor SIN `visibleSetterIds` (el default
   hoy, incluido cualquier supervisor futuro creado sin tildar nada) debe
   pasar por el camino `visibleSet === null` en TODOS los helpers — o sea,
   comportamiento 100% idéntico al actual. Los tests existentes
   (`team-performance.test.js` con `user_super_tp` sin `visibleSetterIds`)
   deben seguir pasando sin modificación.

## Frontend Surface

### Sidebar (`public/index.html`)
Vistas con `data-roles` incluyendo `supervisor` hoy (todas visibles a
CUALQUIER supervisor, scoped o no — el filtrado por rol es puramente por el
string `data-roles`, no hay concepto de "supervisor scoped" en el DOM):

- `view-hoy` (línea 95) — home actual, callbacks/interesados/reintentos.
- `view-calls` (103) — Llamadas, incluye toggles admin-only (DNC línea 953).
- `view-call-history` (1114) — historial completo de llamadas+transcripts.
- `view-training` / `view-training-ai` (137, 2114) — Entrenamiento.
- `view-call-scripts` (145, 2700) — guiones (setter también accede).
- `view-pool` (1788, grupo "Equipo") — Distribución de leads.
- `view-command` (1837) — Centro de Comando (panel admin de usuarios + export + enrichment).
- `view-team` (2555) — Equipo (tabla comparativa, alertas) — **este es el candidato a home del supervisor scoped**.
- `view-online` (168) — Quién está conectado.
- `view-scheduled-calls` (172, 1648) — Reuniones agendadas.

**Recomendación (discreción del CONTEXT):** para supervisor scoped, ocultar
en el sidebar: `view-pool`, `view-command`, `view-online` (si no se filtra
`/api/auth/online`, no debe verse), y posiblemente `view-call-history` salvo
que se filtre su fuente de datos (usa `/api/telnyx/calls/recent`, que SÍ
está en la lista de "debe filtrar"). Mantener: `view-hoy` (si se decide que
el supervisor scoped puede ver leads de sus SDRs — el CONTEXT dice
"mínimo: panel de rendimiento", así que esto es opcional), `view-team`,
`view-training`/`view-training-ai` (ya filtra por dueño de la llamada vía
`TRAINING_EXCLUDED_SETTERS`-like), `view-scheduled-calls` (si se filtra su
fuente, calendario ya tiene el gate por `role==='setter'` que hay que
extender).

La forma más simple de implementar el "modo scoped" en el DOM: exponer
`currentUser.visibleSetterIds` (via `/api/auth/me` → `publicUser`) al
frontend, y en el bootstrap de sidebar (buscar dónde se aplica
`data-roles` — probablemente un loop que hace `el.classList.toggle('hidden',
!roles.includes(currentUser.role))`) agregar una condición extra:
`if (currentUser.role === 'supervisor' && currentUser.visibleSetterIds?.length
&& SCOPED_HIDDEN_VIEWS.includes(el.dataset.target)) hide()`.

### Dropdowns / listas de setters
- `public/app.js:2749` `loadSetterModule()` — puebla `setterSelect` desde
  `stats.setters` (de `/api/setters/stats`), ya filtra `hidden:true`
  (línea 2782) — agregar el mismo filtro de visibilidad, pero como el
  backend YA debe devolver solo los visibles (recomendación: el frontend NO
  debería necesitar filtrar de nuevo si el backend hace bien su trabajo —
  doble filtrado no rompe nada pero es redundante).
- `public/app.js:13245` `_mypLoad()` — puebla `#myp-setter` desde
  `d.setters` de `/api/setters/performance` (línea 13310-13316). Backend
  filtrado → frontend automáticamente correcto sin tocar este código.
- `public/app.js:14075` `_teamLoad()` (view-team) — pega a
  `/api/setters/team-performance`, renderiza con `_teamRenderAlerts` +
  `_teamRenderTable`. Backend filtrado → correcto sin tocar.
- `public/app.js:9647` — otro punto con `settersList.filter(s => !s.hidden)`
  usado como fallback de `d.bySetter` (revisar contexto, probablemente
  Centro de Comando).

### Home / vista default (`public/app.js:10752-10759`)
```js
// Vista por defecto para TODOS los roles: Llamadas
const _defaultMenuItem = document.querySelector('[data-target="view-calls"]');
_defaultMenuItem?.click();
```
Punto de inserción: agregar rama ANTES de este bloque —
```js
if (currentUser?.role === 'supervisor' && currentUser?.visibleSetterIds?.length) {
  document.querySelector('[data-target="view-team"]')?.click();
} else {
  document.querySelector('[data-target="view-calls"]')?.click();
}
```
Esto satisface "Home del supervisor scoped = panel de rendimiento pro". Si
se construye una vista nueva dedicada (mezcla de view-team +
`_mypLoadColdCall`) en vez de reusar `view-team` tal cual, cambiar el
selector acá.

### Cold Call Funnel (`_ccmLoadDeferred` / `_mypLoadColdCall`)
Referenciado en `_mypLoad()` (línea 13247-13249) vía
`window._ccmLoadDeferred`. Pega a `/api/setters/cold-call-metrics` — ya
cubierto por el filtro backend de esa ruta. El bloque visual sigue el
patrón `.ccm-*`/`.myp-tile`/`.seg-control` de la nota #114 de CLAUDE.md
(rediseño premium 2026-07-08) — reusar esas clases CSS para cualquier panel
nuevo, no inventar estilos nuevos.

## Test Patterns to Reuse

### `tests/training-privacy.test.js`
Patrón de test de privacidad por rol más cercano al de esta fase:
- `tmpData` en `os.tmpdir()`, `process.env.NODE_ENV='test'`,
  `process.env.DATA_DIR=tmpData`.
- **API keys seteadas a `""` (string vacío), NUNCA `delete`** — comentario
  explícito en el archivo (línea 25-26): `index.js` corre `dotenv.config()`
  que re-carga el `.env` local; dotenv NO pisa vars ya definidas (aunque
  vacías) pero SÍ repone las borradas con `delete`. Aplica a
  `OPENAI_API_KEY`, `MERCURY_API_KEY`, `QWEN_API_KEY` como mínimo.
- Pre-popular `auth.json` y `setters.json` a mano (escribir el JSON
  directo con `fs.writeFileSync`) ANTES de `await import("../index.js")`
  — el import dispara `ensureAuthSeeds()` que solo crea el admin si no hay
  ninguno, así que popular usuarios completos de antemano es seguro.
- Login real vía `POST /api/auth/login` + extraer cookie de
  `set-cookie[0].split(';')[0]`.
- Test típico: usuario A pide data de usuario B → 403; usuario A pide la
  suya → 200 con contenido esperado; admin pide todo → 200 sin filtrar.

### `tests/team-performance.test.js`
- Mismo patrón de setup. Tiene ya un user `role: 'supervisor'`
  (`user_super_tp`, línea 33) SIN `visibleSetterIds` — sirve como caso
  "zero regression" (debe seguir viendo todo).
- Usa rangos explícitos `from`/`to` en vez de `period=day` puro, porque el
  audit de TZ de negocio (nota #113) hace que "day" dependa de la hora
  real — **para tests nuevos de esta fase, replicar ese patrón**
  (`DAY_RANGE` helper, línea 46-49) si se testean rangos de tiempo.
- 3 setters con distintos patrones de actividad (`setter_a` activo,
  `setter_b` con drop, `setter_c` inactivo) — buen fixture base para clonar
  y agregar un 4to setter que debe quedar OCULTO para un supervisor scoped
  con `visibleSetterIds: ['setter_a', 'setter_b']`.

### Test nuevo sugerido: `tests/supervisor-scoping.test.js`
Cubrir como mínimo:
1. Supervisor SIN `visibleSetterIds` → ve todo (zero regression, comparar
   contra snapshot de un supervisor idéntico pero con `visibleSetterIds: []`).
2. Supervisor CON `visibleSetterIds: ['setter_a']` → `team-performance`
   devuelve `perSetter` con solo `setter_a`, `teamAverages` calculado solo
   sobre `setter_a` (aserción numérica exacta, no solo "no incluye setter_b").
3. `cold-call-metrics` sin `?setter=` → agrega solo llamadas de setters
   visibles (aserción de `metrics.dials` exacto contando solo lo esperado).
4. `cold-call-metrics?setter=<oculto>` → 403.
5. `/api/setters` y `/api/setters/stats` → `setters[]` no incluye setters
   ocultos.
6. `PATCH /api/setters/leads/:id` sobre un lead de setter oculto → 403 para
   el supervisor scoped.
7. `/api/auth/online` → no incluye el user del setter oculto.
8. Admin sigue viendo todo sin cambios (regression contra endpoints
   tocados).
9. `PATCH /api/auth/users/:id` con `visibleSetterIds` — admin puede
   setearlo; supervisor NO puede editarlo a sí mismo (ya cubierto por
   `requireRole('admin')` en ese endpoint, pero vale un test explícito).

## Common Pitfalls

### Pitfall 1: Filtrar después de agregar en vez de antes
**Qué sale mal:** el endpoint construye el array completo por-setter y
recién al final hace `.filter(s => visibleSet.has(s.id))` sobre el
resultado, pero algún cálculo intermedio (promedio de equipo, total
compartido) ya usó la data completa.
**Por qué pasa:** los endpoints de agregación (`team-performance`,
`performance`) calculan promedios/deltas DESPUÉS de construir `perSetter`
completo — es fácil filtrar el array de salida y olvidarse que
`teamAverages` ya se computó sobre todo.
**Cómo evitarlo:** filtrar `data.setters` (la fuente) ANTES del primer
`.map()`/`.reduce()` que construye agregados, no el resultado final.
**Señales de alerta:** un test que compara `teamAverages` de un supervisor
scoped contra el mismo cálculo hecho a mano SOLO con los setters visibles
— si no matchea exacto, hay data fugada en el promedio.

### Pitfall 2: Confundir `lead.assignedTo` con `_callSetterId`
**Qué sale mal:** filtrar métricas de llamadas por `lead.assignedTo`
cuando el lead fue reasignado después de que otro setter lo llamó (o
viceversa) — el resultado no coincide con lo que ve `team-performance`
(que sí usa `_callSetterId`).
**Por qué pasa:** hay DOS fuentes de verdad en el código (nota #113
CLAUDE.md) y no todos los endpoints usan la misma.
**Cómo evitarlo:** para filtrar CALL LOGS, siempre usar
`_callSetterId(entry, lead, userMap)`. Para filtrar LEADS/CALENDAR, usar
`lead.assignedTo`/`entry.setterId` directo.

### Pitfall 3: Doble-cuenta admin real usando `?viewAs=`
**Qué sale mal:** un admin usando `?viewAs=supervisor` (para "ver como
supervisor") no tiene forma de simular un `visibleSetterIds` — seguiría
viendo todo, porque `getEffectiveAuth` solo cambia `role`/`setterId`, no
lee ningún `visibleSetterIds` de un supervisor real. Si se agrega
`asSupervisorId=X` al patrón `viewAs`, hay que resolver el
`visibleSetterIds` de ESE supervisor real y aplicarlo — fuera de alcance
salvo que el CONTEXT lo pida explícitamente (no lo pide).
**Cómo evitarlo:** no implementar esto en esta fase; documentar que "Ver
como supervisor" simula el rol pero no el scoping, si se usa para QA hay
que loguearse con el user supervisor real.

### Pitfall 4: Romper tests existentes por firma de función
**Qué sale mal:** varios endpoints ya reciben `role`/`eff` como variables
locales — si se agrega el chequeo de scoping como un `if` extra sin
respetar el `else if` existente (ej. en el bloque `if (role ===
'setter') {...} else if (role === 'admin' || role === 'supervisor')
{...}`), se puede romper la rama de `setter` por accidente.
**Cómo evitarlo:** siempre agregar el chequeo de `visibleSet` DENTRO de la
rama `admin/supervisor` existente, nunca reemplazarla.

## State of the Art

No aplica — no hay librerías externas, todo el research es interno al
código del repo (JSON file-based RBAC, sin frameworks de autorización tipo
CASL/Oso). El patrón "filtrar por rol dentro del handler" ya es el estándar
del proyecto (17 endpoints ya lo hacen para `role==='setter'`) — esta fase
extiende el mismo patrón, no introduce uno nuevo.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `attachAuth` está montado globalmente (no solo en `/api`), por lo que `req.auth` está disponible en todos los endpoints listados | Auth Plumbing | Si algún endpoint no pasa por `attachAuth`, `req.auth` sería `undefined` y el guard de scoping fallaría silenciosamente (ya se comprobó `requireAuth`/`requireRole` funcionan en TODOS los endpoints listados, así que esto es de riesgo bajo — el gate ya depende de `req.auth` hoy) |
| A2 | `pool-summary`/`pool-setter-breakdown`/`telnyx/balance`/`telnyx/real-costs`/`telnyx/events`/`command` deben BLOQUEARSE enteros para supervisor scoped en vez de filtrarse | Recommended Implementation Shape (edge case 6) | Es una recomendación de diseño (Claude's Discretion explícita en CONTEXT), no un hecho verificado — el user podría preferir que el supervisor scoped SÍ vea pool-summary filtrado. Bajo riesgo: es más fácil ampliar de "bloqueado" a "filtrado" después que al revés |
| A3 | El punto donde se aplica `data-roles` en el DOM es un loop genérico que se puede extender con una condición extra sin reescribir la lógica de sidebar | Frontend Surface | No se localizó el código exacto que aplica `data-roles` (búsqueda quedó en discreción del planner/implementador) — verificar en la fase de implementación buscando `data-roles` en app.js (probablemente cerca del bootstrap de sidebar/login) |
| A4 | `/api/setters/leads/:id/followup`, `/api/setters/objection-analytics` (bySetter vs por lead), `/api/telnyx/script-effectiveness`, `/api/setters/recent-responses`, `/api/training/calls/:leadId/:callIdx` tienen el mismo patrón de riesgo que sus pares ya leídos en detalle | Endpoint Surface tables | No se leyó el cuerpo completo de estos 5 endpoints línea por línea (se infirió por el patrón consistente del resto del archivo) — verificar en implementación, bajo riesgo porque el patrón del proyecto es muy consistente |

**Si esta tabla estuviera vacía:** no lo está — hay 4 asunciones,
todas de bajo riesgo y verificables en 1-2 minutos cada una durante la
implementación (grep + lectura puntual), no bloquean el planning.

## Open Questions (RESOLVED)

> Ambas preguntas quedaron resueltas por decisiones LOCKED en 18-CONTEXT.md
> (sección "Resolución de preguntas abiertas del research"):
> 1. → RESUELTO: el supervisor scoped SÍ ve leads, llamadas y transcripciones
>    de sus SDRs visibles ("todos los rendimientos, todo lo que sea"). Los
>    endpoints de leads/calendar se FILTRAN por ownership (plan 18-01 Task 3),
>    no se bloquean.
> 2. → RESUELTO: telnyx/balance, telnyx/real-costs, telnyx/events,
>    pool-summary (+pool-setter-breakdown) y command se BLOQUEAN enteros
>    (403) para supervisor scoped. telnyx/metrics y cold-call-effectiveness
>    se filtran por _callSetterId (sí son "rendimiento de mi equipo").
>    script-effectiveness también se filtra (agregado post-checker).

1. **¿El supervisor scoped debe poder ver leads/llamar (view-hoy,
   view-calls) de sus SDRs, o SOLO ver métricas agregadas (view-team)?**
   - Qué sabemos: el CONTEXT dice "mínimo: panel de rendimiento" y "nada
     que exponga leads/llamadas de setters OCULTOS" — no dice
     explícitamente si puede ver leads/llamadas de los VISIBLES.
   - Qué es incierto: si `view-hoy`/`view-calls` quedan disponibles, hay
     que filtrar TODOS los endpoints de leads (`leads`, `sin-wsp`,
     `calendar`) que ya están en la tabla como 🔴, agregando bastante
     superficie. Si NO quedan disponibles, el trabajo se reduce
     significativamente (solo métricas agregadas + auth/online +
     training).
   - Recomendación: preguntar al user explícitamente en el discuss/plan;
     el research ya cubre AMBOS casos con la tabla completa, así que no
     bloquea el planning — es una decisión de alcance que el plan debe
     fijar antes de escribir tasks.

2. **¿Bloquear entero o filtrar los endpoints financieros de Telnyx
   (`balance`, `real-costs`, `events`) y de gestión de pool
   (`pool-summary`, `command`)?**
   - Qué sabemos: son "admin/supervisor only" hoy, sin distinción de
     scoping en el CONTEXT explícitamente (el CONTEXT los nombra en la
     lista de endpoints a auditar: "team-performance, cold-call-metrics,
     performance, calls-today, telnyx/metrics, cold-call-effectiveness,
     objection-analytics, pool-summary, training/calls, auth/online,
     call-history, leads, etc." — pool-summary SÍ está nombrado
     explícitamente, balance/real-costs/events NO).
   - Recomendación: este research propone bloquear enteros
     `pool-summary`/`pool-setter-breakdown`/`command` (gestión operativa,
     no rendimiento) y `telnyx/balance`/`real-costs`/`events` (info
     financiera de cuenta) para simplificar, dejando `telnyx/metrics` y
     `telnyx/cold-call-effectiveness` filtrados (sí calzan con "rendimiento
     de mi equipo"). El plan debe confirmar esto con el user si hay duda.
