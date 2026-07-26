---
phase: 21
slug: reporte-diario-canal-whatsapp
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-26
---

# Phase 21 — UI Design Contract

> Contrato visual e interacción para el reporte diario + canal WhatsApp.
> Generado por gsd-ui-researcher, verificado por gsd-ui-checker.

**Alcance deliberadamente chico.** Esta fase es mayormente backend (builder
del reporte, cola, canal de envío). La superficie de UI son DOS
agregados a vistas que ya existen — **NO hay vista nueva, NO hay entrada de
navegación nueva**:

1. Un bloque de configuración en **Centro de Comando** (`view-command`,
   admin only) — D-29.
2. Un control por-SDR de "licencia" en **Equipo** (`view-team`) — D-18,
   decisión de ubicación tomada en este documento (ver `## Decisión de
   ubicación — D-18`).

Todo lo demás (contenido del mensaje de WhatsApp, molde, textos de
escalada) es contenido de texto plano que arma el backend — no es UI de
panel y no tiene contrato visual (vive en `21-CONTEXT.md` D-19/D-20).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none — SCM Design System v1.1 ya existe en `public/style.css`, no se inicializa shadcn |
| Preset | not applicable |
| Component library | ninguna (vanilla JS + HTML a mano) |
| Icon library | ninguna — texto plano, sin emojis decorativos (preferencia estable del user) |
| Font | Geist (texto), Geist Mono (solo si se muestra algo tabular/monoespaciado — no aplica en esta fase) |

Esta fase **reutiliza exclusivamente clases y tokens ya existentes**. No se
introduce ninguna clase CSS nueva ni ningún token nuevo (ver `## Reuso de
componentes` para el inventario exacto). `style.css` **no necesita cache-
buster nuevo** — solo `app.js` (y el `<script>` tag de `index.html` que lo
referencia) cambian.

---

## Spacing Scale

Declared values (multiples of 4 — son los tokens ya definidos en
`:root`, `public/style.css` líneas 69-79):

| Token | Value | Usage en esta fase |
|-------|-------|-------|
| `--space-1` | 4px | gap entre chip y texto |
| `--space-2` | 8px | gap entre controles inline (checkbox + label) |
| `--space-3` | 12px | gap entre campos del grid de configuración |
| `--space-4` | 16px | padding del panel (`.admin-variable-panel`) |
| `--space-5` | 20px | margin-top/bottom del panel dentro de `view-command` |
| `--space-6` | 24px | separación entre panel y la sección siguiente (Equipo) |

Exceptions: ninguna. Todo el bloque nuevo usa `--space-*` o los valores
inline que ya usan sus vecinos directos (`.admin-variable-panel` en
`index.html:1984` usa `padding:16px; margin-top:20px; margin-bottom:20px`
— inline, no la clase pura — se replica igual por consistencia visual
con el vecino inmediato).

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Heading (título del bloque, `<h3>`) | 15px (`--text-md`) | 600 semibold | 1.3 |
| Body (texto explicativo, filas de estado) | 12.5px (entre `--text-xs` 11px y `--text-sm` 13px, valor que ya usan los vecinos: `cmd-brief-recon-result`, tooltips de Comando) | 400 regular | 1.5 |
| Label (kicker uppercase, labels de campo) | 11px (`--text-xs`) | 600 semibold | 1.2, `letter-spacing: 0.3-0.5px` |
| Chip / badge | 10-11px (`--text-2xs`/`--text-xs`, según `.chip`) | 600 semibold, uppercase | 1 |

No hay rol "Display" en esta fase — no hay headline grande, es un bloque
de configuración chico dentro de una vista existente.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `var(--bg-app)` `#0F1115` | fondo de `view-command` (ya existente, no se toca) |
| Secondary (30%) | `var(--bg-surface)` `#161922` / `var(--bg-app)` para el sub-panel de estado | fondo de `.admin-variable-panel` y del recuadro de estado del canal |
| Accent (10%) | `var(--accent)` `#9D85F2` | **RESERVADO exclusivamente para el botón "Mandar ahora"** (`.btn-primary`) — es la única superficie de acento nueva de esta fase |
| Destructive | `var(--danger)` `#F87171` | chip de estado "Desktop desconectado" / "Último envío falló" (`.chip-danger`) y el botón "Quitar licencia" (texto en `--danger`, estilo `.btn-table-action` con `color:var(--danger)`, igual que `cmd-clear-btn`/`history-bulk-delete-btn`) |

**Accent reservado para:** el botón `#cmd-report-send-now-btn` ("Mandar
ahora") ÚNICAMENTE. Ningún otro elemento nuevo usa `--accent`: el botón
"Guardar" usa `.btn-secondary` (gris), los chips de estado usan los
semánticos (`success`/`warning`/`danger`/`neutral`, nunca `chip-accent`),
el checkbox de pausa no lleva acento, y el badge/botón de "Licencia" en
Equipo usa `chip-neutral` + `.btn-table-action` neutro. Esto respeta la
disciplina cromática documentada en `CLAUDE.md` ("violeta sólo para
acentos, no para textos").

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | **"Mandar ahora"** (texto exacto del botón — literal de D-29, no parafrasear) |
| Empty state heading | "Sin configurar" (nombre del grupo cuando `groupConfigured=false`) |
| Empty state body | "Todavía no se eligió un grupo desde wa-multi. Abrí la app de escritorio, iniciá sesión con el número dedicado y elegí el grupo de socios de la lista." |
| Error state (panel no carga) | "No se pudo cargar el estado del canal. Recargá la página; si sigue, el server puede estar caído." |
| Error state (send-now falla) | "No se pudo enviar. Probá de nuevo en un momento." |
| Destructive confirmation | **"Mandar ahora"**: modal `askConfirm` — título "Mandar reporte ahora", mensaje "Esto arma el reporte con los datos de HOY hasta este momento y lo manda YA al grupo de WhatsApp de los socios (o a los 3 por separado si el grupo no aparece). No se puede deshacer. ¿Confirmás?", confirmLabel "Sí, mandar ahora", cancelLabel "Cancelar" |

Ver `## Copy exacto por estado` más abajo para el resto de strings
(toasts, chips, badges) — todos son literales, no parafrasear.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | ninguno — no aplica, proyecto sin shadcn | not required |
| third-party | ninguno | not required |

---

## Reuso de componentes (inventario exacto — CERO clases nuevas)

Verificado contra `public/style.css` antes de escribir este documento:

| Clase / patrón | Dónde ya se usa | Cómo se reusa acá |
|---|---|---|
| `.admin-variable-panel` | "Base de Datos de Leads Scrapeados" (`index.html:1984`) | Wrapper del bloque nuevo — mismo patrón `padding:16px; border:1px solid var(--border-color); border-radius:16px; margin:20px 32px` |
| `.chip` + `.chip-success/.chip-warning/.chip-danger/.chip-neutral` | definidas en `style.css:1426-1455`, usadas en `#tlx-cfg-status` (Telnyx) | Chip de estado del canal + badge de "licencia" en Equipo |
| `.btn-primary` | botones CTA en todo el panel (`tlx-cfg-save`, `tlx-num-add-btn`) | Botón "Mandar ahora" |
| `.btn-secondary` | `team-refresh`, `myp-refresh` | Botón "Guardar" de mails de respaldo |
| `.btn-table-action` (+ `color:var(--danger)` inline) | `cmd-clear-btn`, `history-bulk-delete-btn` | Botón "Licencia" / "Quitar licencia" en Equipo |
| `.setter-input` | `invite-name`, `invite-email` | Input de mails de respaldo |
| `<input type="checkbox">` + `<label>` inline (sin componente "switch") | Telnyx números, campo "Activo" (`app.js:16824-16827`) | Checkbox de pausa — el proyecto NO tiene un componente toggle-switch, así que no se inventa uno |
| `.loader` | botones en estado "cargando" (`cmd-validate-numbers-btn`, etc.) | Spinner del botón "Mandar ahora" mientras envía |
| `window.askConfirm(...)` | reemplaza `confirm()` nativo, ya usado en flujos de borrado/reset | Guard antes de disparar el envío real |
| `window.showToast(msg, {type})` | feedback de acciones async en toda la app | Feedback de éxito/fallo del envío y del guardado de config |
| `escHtml()` | toda interpolación de datos de usuario en templates | Nombre de grupo, nombre de SDR |
| `apiUrl()` | regla #146 (CLAUDE.md) — obligatorio en fetches de vistas que puede ver un supervisor | Aunque el bloque de Comando es admin-only, Equipo (`view-team`) SÍ la ve un supervisor scoped → el fetch de "licencia" debe pasar por `apiUrl()`, no `fetch()` crudo |
| `data-roles="admin"` / `data-roles="admin,supervisor"` | mecanismo global de visibilidad por rol (`app.js:502-506`) | Wrapper del bloque de Comando (`admin`), botón de editar licencia en Equipo (`admin` únicamente vía JS condicional — ver nota abajo) |

⚠️ **Nota sobre `data-roles` en HTML generado dinámicamente:** el
mecanismo `document.querySelectorAll('[data-roles]')` (app.js:502) corre
UNA vez al boot — solo aplica a HTML que ya está en `index.html` al
cargar. Las filas de la tabla de Equipo se generan en JS
(`_teamRenderTable`), así que el botón "Licencia" (editar) **NO** puede
llevar `data-roles="admin"` y esperar que se oculte solo — debe
condicionarse en el propio template string con
`${currentUser.role === 'admin' ? '...' : ''}`, igual que el resto del
código generado dinámicamente en `app.js` (no hay precedente de
`data-roles` en contenido inyectado por `innerHTML`, se verificó por
grep — cero matches).

---

## Bloque 1 — Centro de Comando: configuración del reporte diario (D-29)

### Ubicación exacta

Dentro de `view-command`, **inmediatamente después** de `.content-header`
(`index.html:1844-1847`) y **antes** de la sección `<!-- EQUIPO -->`
(`index.html:1849`). Es lo primero que ve el admin al entrar a Comando —
justificado porque esta fase es el centro del milestone v2.0
("gestión por excepción": si el reporte no llega, hay que entrar a
mirar, y el primer lugar donde mirar es acá).

### HTML — estructura exacta (para `index.html`)

```html
<section id="cmd-daily-report-panel" class="admin-variable-panel"
  data-roles="admin" style="margin:20px 32px; padding:16px; border-radius:16px;">
  <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
    <div>
      <h3 style="margin:0 0 4px; font-size:15px;">Reporte diario · WhatsApp</h3>
      <p style="margin:0; color:var(--text-secondary); font-size:12px;">
        Todos los días a las 23:00 se manda solo, al grupo de WhatsApp de
        los socios. Esta sección es para configurarlo y para probarlo sin
        esperar a la hora.
      </p>
    </div>
    <span id="cmd-report-status-chip" class="chip chip-neutral">—</span>
  </div>

  <div id="cmd-report-status-detail" style="display:flex; flex-direction:column; gap:6px; margin-bottom:16px; padding:12px 14px; background:var(--bg-app); border:1px solid var(--border-subtle); border-radius:10px; font-size:12.5px; color:var(--text-secondary);">
    <div>Grupo destino: <strong id="cmd-report-group-name" style="color:var(--text-primary);">—</strong></div>
    <div>Último envío: <span id="cmd-report-last-sent">—</span></div>
    <div>En cola: <span id="cmd-report-queue-count">—</span></div>
    <div>Desktop ahora: <span id="cmd-report-desktop-status">—</span></div>
  </div>

  <div id="cmd-report-setup-hint" class="hidden" style="margin-bottom:14px; padding:10px 14px; background:rgba(255,200,40,0.08); border:1px solid rgba(255,200,40,0.25); border-radius:8px; font-size:12px; color:var(--text-secondary);">
    Necesitás elegir el grupo desde la app de escritorio (wa-multi) antes
    de poder mandar. Ver <code>21-CONTEXT.md</code> § "Acciones del user".
  </div>

  <div style="display:grid; gap:12px; grid-template-columns:2fr 1fr; margin-bottom:14px; align-items:end;">
    <label style="display:flex; flex-direction:column; gap:4px;">
      <span style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px;">
        Mails de respaldo <span style="opacity:.6; text-transform:none;">(apagado — D-04, no se usa mientras el diario no tenga fallback a email)</span>
      </span>
      <div style="display:flex; gap:8px;">
        <input type="text" id="cmd-report-backup-emails" class="setter-input" placeholder="mail1@dominio.com, mail2@dominio.com">
        <button id="cmd-report-backup-emails-save" class="btn-table-action" style="white-space:nowrap;">Guardar</button>
      </div>
      <span id="cmd-report-backup-emails-result" style="font-size:11px; color:var(--text-secondary);"></span>
    </label>
    <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-secondary); cursor:pointer; padding-bottom:9px;">
      <input type="checkbox" id="cmd-report-pause-toggle">
      Pausar envío automático (diario y semanal)
    </label>
  </div>

  <div style="display:flex; justify-content:flex-end; align-items:center; gap:10px;">
    <button id="cmd-report-send-now-btn" class="btn-primary" style="font-size:13px;">Mandar ahora</button>
  </div>
</section>
```

### Precedencia del chip de estado (`#cmd-report-status-chip`) — determinística

Evaluar EN ESTE ORDEN, el primero que matchee gana (esto es lo que el
planner debe convertir en criterio de aceptación grep-verificable):

1. `!groupConfigured` → `chip-neutral`, texto **"Sin configurar"**
2. `!desktopOnline` → `chip-danger`, texto **"Desktop desconectado"**
3. `paused === true` → `chip-warning`, texto **"Pausado"**
4. `queueCount > 0` → `chip-warning`, texto **"{N} en cola"**
5. `lastSent.status === 'failed'` → `chip-danger`, texto **"Último envío falló"**
6. else → `chip-success`, texto **"Al día"**

### Interacciones

**Checkbox de pausa** (`#cmd-report-pause-toggle`): auto-guarda en
`onchange` (mismo patrón que el checkbox "Activo" de números Telnyx,
`app.js:16825` — NO requiere botón "Guardar" aparte). Al cambiar:
`PUT /api/admin/daily-report/config` con `{paused: this.checked}` →
toast `showToast('Envío automático pausado.', {type:'warn'})` si quedó
en `true`, `showToast('Envío automático reanudado.', {type:'success'})`
si quedó en `false`. **La pausa NO afecta al botón "Mandar ahora"** —
decisión explícita (ver `## Decisiones de esta fase`).

**Mails de respaldo**: input de texto libre (CSV) + botón "Guardar"
explícito (no auto-save — texto libre se beneficia de un guardado
explícito, distinto del checkbox). Click → `PUT
/api/admin/daily-report/config` con `{backupEmails: [...]}` (split por
coma, trim, filtrar vacíos) → feedback inline en
`#cmd-report-backup-emails-result` ("Guardado." en `--text-secondary`,
o el error del backend).

**Botón "Mandar ahora"** — ver state machine dedicado abajo.

---

## State machine — botón "Mandar ahora" (`#cmd-report-send-now-btn`)

Esto es un envío REAL, saliente, a un grupo de WhatsApp con personas
reales (hard constraint #6). El contrato de estados es obligatorio y
grep-verificable: 5 estados nombrados, transiciones exactas.

```
IDLE ──click──> CONFIRMING ──cancela──> IDLE
                     │
                  confirma
                     ▼
                  SENDING ──resultado ok/con matiz──> SUCCESS ──2.5s──> IDLE
                     │
                     ├──desktop offline──> QUEUED ──toast──> IDLE
                     ├──error genérico──> FAILED ──toast──> IDLE
                     └──timeout 25s sin respuesta──> UNKNOWN ──toast──> IDLE
```

### Estado `IDLE`
- `disabled = !groupConfigured` (si no hay grupo configurado, el botón
  arranca deshabilitado — no llega a `CONFIRMING`)
- texto: **"Mandar ahora"**

### Estado `CONFIRMING`
- Dispara `window.askConfirm({...})` (no un `confirm()` nativo — el
  proyecto ya migró ese patrón). Copy exacto:
  - `title`: **"Mandar reporte ahora"**
  - `message`: **"Esto arma el reporte con los datos de HOY hasta este momento y lo manda YA al grupo de WhatsApp de los socios (o a los 3 por separado si el grupo no aparece). No se puede deshacer. ¿Confirmás?"**
  - `confirmLabel`: **"Sí, mandar ahora"**
  - `cancelLabel`: **"Cancelar"**
  - `danger`: `true` (botón de confirmar en rojo — refuerza el peso de la acción, aunque no borra datos)
- Si el user cancela o cierra (Esc/click afuera) → vuelve a `IDLE` sin
  disparar ningún request.

### Estado `SENDING`
- `btn.disabled = true`
- `btn.innerHTML = '<span class="loader"></span> Enviando…'` (clase
  `.loader` ya existente, spinner del sistema)
- Dispara `POST /api/admin/daily-report/send-now` con timeout cliente de
  25s (`Promise.race` contra un `setTimeout` — si no hay respuesta del
  server en ese lapso, tratar como `UNKNOWN`, NO como `FAILED`: el envío
  puede haber salido igual, no hay que sugerir reintentar a ciegas)

### Estado `SUCCESS` (`status === 'sent'`)
- `showToast('Reporte enviado al grupo.', {type:'success'})`
- botón: texto temporal **"Enviado"** (2.5s) con `color` en `--success`,
  después vuelve a `IDLE` con label "Mandar ahora"
- refresca `#cmd-report-last-sent` con el timestamp devuelto

### Estado `SUCCESS` con matiz (`status === 'sent_via_dm'`, D-02)
- `showToast('Grupo no encontrado — se mandó por WhatsApp a los 3 socios por separado.', {type:'warn'})`
- mismo comportamiento de botón que `SUCCESS`

### Estado `QUEUED` (`status === 'queued'` — desktop no alcanzable ahora)
- `showToast('La computadora con WhatsApp está apagada ahora. El reporte quedó en cola — sale solo apenas reconecte.', {type:'warn'})`
- botón vuelve a `IDLE` inmediatamente (label "Mandar ahora", sin
  espera de 2.5s — no fue un éxito, no amerita el label temporal "Enviado")
- refresca `#cmd-report-queue-count`

### Estado `FAILED` (`status === 'failed'`)
- `showToast('No se pudo enviar. Probá de nuevo en un momento.', {type:'error'})`
- botón vuelve a `IDLE` inmediatamente

### Estado `UNKNOWN` (timeout cliente, sin respuesta del server en 25s)
- `showToast('No llegó confirmación a tiempo. Fijate en el grupo antes de mandar de nuevo — puede que se haya enviado igual.', {type:'warn'})`
- botón vuelve a `IDLE` (habilitado, para no dejarlo trabado, pero el
  copy disuade explícitamente el reintento reflejo — cumple el hard
  constraint de no permitir que un click accidental spamee, incluso en
  el caso ambiguo)

### Después de CUALQUIER estado terminal
Se vuelve a llamar `_cmdLoadReportPanel()` (refetch del GET de estado)
para que `#cmd-report-last-sent`, `#cmd-report-queue-count` y el chip de
arriba reflejen el estado real del servidor — nunca quedarse solo con la
actualización optimista del cliente.

---

## Contrato de endpoints propuesto (para que el planner lo confirme/ajuste)

Esta fase no tiene un endpoint ya construido — el nombre exacto de ruta
es decisión del planner/executor, pero el contrato de **forma** de la
respuesta es lo que la UI necesita para renderizar los 5 estados de
arriba de forma determinística. Propuesta (consistente con la
convención `/api/admin/*` ya usada en 30+ endpoints del Comando):

```
GET  /api/admin/daily-report/status
  → { groupConfigured: bool, groupName: string|null,
      lastSent: { at: ISOString|null, periodLabel: string, status: 'sent'|'failed' }|null,
      queueCount: number, desktopOnline: bool, paused: bool,
      backupEmails: string[] }

PUT  /api/admin/daily-report/config
  body: { backupEmails?: string[], paused?: bool }
  → { ok: true, ...status actualizado }

POST /api/admin/daily-report/send-now
  → { ok: true, status: 'sent'|'sent_via_dm'|'queued'|'failed',
      reason?: string, groupName?: string, sentAt?: ISOString,
      queueCount?: number }
```

Todos admin-only (`requireRole('admin')`, igual que el resto de
`/api/admin/*`). El GET se llama desde `_cmdLoadReportPanel()`, colgado
de `loadCommandCenter()` (`app.js:9709`) igual que
`_teamLoadDispoAudit()` cuelga de `_teamLoad()` — fire-and-forget, no
bloquea el resto del panel si falla.

⚠️ **Regla #146 (CLAUDE.md) no aplica acá en sentido estricto** (el
bloque es `data-roles="admin"`, ningún supervisor lo ve), pero se
recomienda usar igual `apiUrl()` en vez de `fetch()` crudo por
consistencia y porque "Ver como SDR/Supervisor" desde una cuenta admin
sigue siendo el mismo usuario autenticado — más robusto a futuro.

---

## Decisión de ubicación — D-18 (licencia por vendedora)

**Decisión: vive en `view-team` (Equipo), no en Centro de Comando.**

Razón: D-18 es un atributo **por-SDR** (como el nombre, como el flag
`hidden`), no una configuración del canal. `view-team` ya es la vista
que lista SDRs en una tabla con acciones (aunque hoy solo drilldown por
click de fila) y expone alertas de inactividad — exactamente el
contexto donde "esta persona está de licencia, no la marques como
inactiva" tiene sentido leer. Ponerlo en Comando obligaría a cruzar
mentalmente "vendedoras" (Equipo) con "config del canal" (Comando), que
son conceptos distintos.

### Alcance de rol

- **Ver el badge** ("Licencia hasta DD/MM"): admin + supervisor (mismos
  roles que ya ven `view-team`) — un supervisor debería poder ver que
  una de sus SDRs está de licencia sin tener que preguntarle a nadie.
- **Editar (poner/quitar la fecha)**: **admin only** — mismo criterio que
  ya existe en esta vista para "Umbrales de alerta" (admin edita,
  supervisor solo mira). Justificación: es una decisión de gestión de
  personal, no de operación diaria.

### HTML — cambios en `_teamRenderTable` (`app.js:14978-14984`)

Dentro del `<td>` del nombre, después de `assignedBadge`, agregar:

```js
const leaveUntil = s.leaveUntil ? new Date(s.leaveUntil) : null;
const onLeave = leaveUntil && leaveUntil >= new Date(new Date().toDateString());
const leaveBadge = onLeave
  ? ` <span style="font-size:10px; padding:2px 7px; background:var(--bg-elevated); color:var(--text-secondary); border:1px solid var(--border-default); border-radius:6px; vertical-align:middle;">Licencia hasta ${leaveUntil.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})}</span>`
  : '';
const leaveEditBtn = currentUser.role === 'admin'
  ? ` <button class="btn-table-action" style="font-size:10px; padding:1px 7px; height:20px; margin-left:4px;" onclick="event.stopPropagation(); window._teamOpenLeaveModal('${s.id}', '${escHtml(s.name)}', ${s.leaveUntil ? `'${s.leaveUntil}'` : 'null'})">${onLeave ? 'Editar licencia' : '+ Licencia'}</button>`
  : '';
```
...e insertarlos en el template de `tr.innerHTML` después de
`${alertBadge}${assignedBadge}`.

### Modal nuevo — `#team-leave-modal` (en `index.html`, junto a `#team-config-modal`)

Mismo chrome que `#team-config-modal` (overlay fixed + `.card`):

```html
<div id="team-leave-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:1000; align-items:center; justify-content:center;">
  <div class="card" style="width:min(360px, 90vw); padding:20px;">
    <h3 id="team-leave-title" style="margin:0 0 6px 0; font-size:16px;">Licencia</h3>
    <p class="muted" style="margin:0 0 14px; font-size:12px; line-height:1.5;">
      Mientras esté de licencia, sale de la línea de "sin actividad hoy"
      del reporte y aparece al pie como "de licencia". Vuelve sola al
      vencer la fecha — no hace falta acordarse de sacarla.
    </p>
    <label style="display:flex; flex-direction:column; gap:4px; font-size:12px; margin-bottom:16px;">
      <span class="muted">De licencia hasta</span>
      <input id="team-leave-until" type="date" style="padding:8px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-app); color:var(--text-primary);">
    </label>
    <div style="display:flex; justify-content:space-between; gap:8px;">
      <button id="team-leave-clear" class="btn-table-action" style="color:var(--danger);">Quitar licencia</button>
      <div style="display:flex; gap:8px;">
        <button id="team-leave-cancel" class="btn-secondary" style="font-size:13px;">Cancelar</button>
        <button id="team-leave-save" class="btn-primary" style="font-size:13px;">Guardar</button>
      </div>
    </div>
  </div>
</div>
```

`#team-leave-clear` solo se muestra (`display:flex` vs `none`) cuando el
setter ya tiene `leaveUntil` seteado — si no, ocultarlo (no hay nada que
quitar).

### Interacción

- `window._teamOpenLeaveModal(setterId, name, currentLeaveUntil)`:
  popula título "Licencia — {name}", input date con `currentLeaveUntil`
  o vacío, muestra/oculta "Quitar licencia" según corresponda, abre
  modal.
- `#team-leave-save` click → `PATCH /api/setters/team/:id` (endpoint YA
  existente, `app.js:4743` — mismo patrón que `_editSetter`) con body
  `{leaveUntil: <valor del input, 'YYYY-MM-DD'>}` → cierra modal,
  `showToast('Licencia guardada.', {type:'success'})`, refresca
  `_teamLoad()`.
- `#team-leave-clear` click → mismo PATCH con `{leaveUntil: null}` → sin
  `askConfirm` (acción reversible y de bajo impacto, no amerita guard) →
  `showToast('Licencia quitada.', {type:'success'})`, refresca.
- `#team-leave-cancel` / click en el overlay / Esc → cierra sin guardar
  (mismo patrón que `#team-config-modal`).

⚠️ **Contrato de backend implícito**: `GET /api/setters/team-performance`
debe devolver `leaveUntil` (ISO date string o `null`) por SDR en
`perSetter[]` para que el badge se pueda pintar. Esto es responsabilidad
del planner/executor de backend, no de este documento — se deja anotado
acá porque la UI no puede pintar el badge sin ese campo.

---

## Estado del canal — qué SÍ y qué NO muestra el panel (D-05)

D-05 dice: el próximo mensaje exitoso confiesa los baches, Y queda
registrado server-side; el panel NO es el canal de alerta primario (esa
es la idea del milestone — no entrar a mirar). Decisión de esta fase:

**El panel SÍ muestra** (pasivo, se ve solo si el admin ya abrió
Comando por otra razón):
- Último envío: fecha + qué período cubrió + si salió bien o mal
- Cuántos reportes hay en cola ahora mismo
- Si el desktop está alcanzable en este momento

**El panel NO muestra** (evitar inflar el alcance):
- Listado histórico de los últimos 30 mensajes (D-27) — eso es
  "Historial de mensajes enviados", una tabla nueva, fuera de alcance de
  "sección chica". Si se necesita en el futuro, es una vista nueva,
  fuera de esta fase.
- Contenido completo del reporte (preview del texto) — el "mandar ahora"
  ya es la forma de verlo (en el celular, en vivo). Un preview en panel
  duplicaría esfuerzo sin necesidad.

---

## Decisiones de esta fase (registradas para no reabrir)

1. **"Mandar ahora" ignora la pausa.** Si el admin pausó el envío
   automático pero quiere probar el canal, el botón debe seguir
   funcionando — si no, quedaría inutilizado justo cuando más se lo
   necesita (probar antes de reactivar). Pausa = solo afecta los crons
   de las 23:00.
2. **Fallo de desktop en un "mandar ahora" manual encola, no descarta.**
   Mismo mecanismo de cola que el automático (D-05/D-08, guard por
   período cubierto) — evita una segunda vía de pérdida de reportes.
3. **Timeout del cliente (25s) es un estado `UNKNOWN` distinto de
   `FAILED`** — evita que el copy empuje a un reintento reflejo cuando
   en realidad no se sabe si salió o no (honra el hard constraint
   anti-spam incluso en el caso ambiguo).
4. **El campo "mails de respaldo" de este panel es DISTINTO de
   `REPORT_EMAILS`** (env var ya usada por el semanal desde Phase 19).
   Es el fallback del DIARIO, hoy apagado por D-04. No unificar los dos
   sin decisión explícita del user — son conceptualmente el mismo tipo
   de dato pero gobiernan reportes distintos con reglas distintas
   (el semanal YA manda email; el diario no, todavía).
5. **Grupo destino es de solo lectura en el panel web.** Se elige una
   vez desde la app de escritorio (D-03) — el panel web no tiene forma
   de listar los chats de WhatsApp (esa lista solo la tiene el
   desktop). Si en el futuro se quiere permitir re-elegir el grupo
   desde el panel, es un flujo nuevo (trigger al desktop para que
   vuelva a mostrar la lista) — no construido acá, no pedido por D-29.

---

## Copy exacto por estado (referencia rápida, todo literal)

| Contexto | Copy exacto |
|---|---|
| Chip — sin configurar | "Sin configurar" |
| Chip — desktop caído | "Desktop desconectado" |
| Chip — pausado | "Pausado" |
| Chip — en cola | "{N} en cola" |
| Chip — último falló | "Último envío falló" |
| Chip — todo bien | "Al día" |
| Hint de setup | "Necesitás elegir el grupo desde la app de escritorio (wa-multi) antes de poder mandar." |
| Toast — pausa ON | "Envío automático pausado." |
| Toast — pausa OFF | "Envío automático reanudado." |
| Toast — envío ok | "Reporte enviado al grupo." |
| Toast — envío por DM | "Grupo no encontrado — se mandó por WhatsApp a los 3 socios por separado." |
| Toast — encolado | "La computadora con WhatsApp está apagada ahora. El reporte quedó en cola — sale solo apenas reconecte." |
| Toast — error | "No se pudo enviar. Probá de nuevo en un momento." |
| Toast — timeout | "No llegó confirmación a tiempo. Fijate en el grupo antes de mandar de nuevo — puede que se haya enviado igual." |
| Confirm — título | "Mandar reporte ahora" |
| Confirm — mensaje | "Esto arma el reporte con los datos de HOY hasta este momento y lo manda YA al grupo de WhatsApp de los socios (o a los 3 por separado si el grupo no aparece). No se puede deshacer. ¿Confirmás?" |
| Confirm — botón confirmar | "Sí, mandar ahora" |
| Confirm — botón cancelar | "Cancelar" |
| Equipo — badge activo | "Licencia hasta DD/MM" |
| Equipo — botón (sin licencia) | "+ Licencia" |
| Equipo — botón (con licencia) | "Editar licencia" |
| Equipo — modal, subtítulo | "Mientras esté de licencia, sale de la línea de \"sin actividad hoy\" del reporte y aparece al pie como \"de licencia\". Vuelve sola al vencer la fecha — no hace falta acordarse de sacarla." |
| Equipo — botón guardar | "Guardar" |
| Equipo — botón quitar | "Quitar licencia" |
| Equipo — toast guardado | "Licencia guardada." |
| Equipo — toast quitado | "Licencia quitada." |

---

## Cache-buster (hard constraint #4 — obligatorio)

Esta fase toca `public/app.js` (funciones + listeners nuevos) y
`public/index.html` (el bloque nuevo + el modal de licencia). **No
toca** `public/style.css` (cero clases nuevas, ver `## Reuso de
componentes`).

- Actual: `<script type="module" src="/app.js?v=20260725c"></script>`
  (`index.html:3388`)
- Acción obligatoria: bumpear a `v=20260726a` (o el siguiente sufijo
  disponible del día en que se implemente) en ESE MISMO `<script>` tag.
  `style.css` (`index.html:14`) queda intacto en `v=20260725a` — no
  bumpear si efectivamente no se tocó ninguna regla CSS.
- Verificar `GET /api/version` (endpoint ya existente, nota #152 de
  CLAUDE.md) refleja el nuevo valor tras el deploy.

---

## Fuera de alcance (flaggeado, no construido)

- **Selector de grupo desde el panel web** (dropdown de chats) — no
  existe esa fuente de datos en el server, vive en el desktop (D-03).
- **Historial de los últimos 30 mensajes enviados** (D-27) como tabla en
  el panel — es una vista/tabla nueva, no "sección chica". Si se pide
  después, es plan aparte.
- **Preview del contenido del reporte** en el panel — el botón "Mandar
  ahora" ya cumple ese rol (se lee en el celular real).
- **Reporte individual por vendedora** — deferred explícitamente en
  `21-CONTEXT.md`, fase aparte.
- **Notificaciones de alerta (Phase 23)** — este documento no las
  cubre; D-06 deja el servicio de envío genérico para que Phase 23 lo
  reuse sin tocar esta UI.

---

## Abiertos / a confirmar

Ninguno bloqueante — todo lo listado abajo tiene una resolución tomada
en este documento (marcada "resuelto acá") que el planner puede aceptar
tal cual o ajustar con criterio, sin volver a preguntarle al user:

1. **Nombre exacto de las rutas `/api/admin/daily-report/*`** — resuelto
   acá como propuesta consistente con la convención existente; el
   planner puede renombrar si el patrón de endpoints ya construidos en
   Phase 19/20 sugiere algo distinto (p.ej. reusar el prefijo de
   `reports.json` / `__weeklyReport`).
2. **Rol que puede editar "licencia"** — resuelto acá como admin-only
   (mismo criterio que "Umbrales de alerta"). Si el user pide que
   supervisor también edite, es un cambio de una palabra en el template
   (`currentUser.role === 'admin'` → `['admin','supervisor'].includes(...)`).
3. **Si "mandar ahora" debe deshabilitarse mientras otro admin ya está
   mandando** (lock global, dos tabs) — no especificado como
   requirement; queda como nota de hardening para el backend, no bloquea
   la UI (el disable client-side durante el propio request ya cubre el
   caso de un solo tab).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
