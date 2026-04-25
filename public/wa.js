// Módulo frontend WhatsApp Multi-Account.
// Vanilla JS, ES module. Usa socket.io del CDN (window.io).
// Cookie de sesión gs_session se manda automáticamente con credentials:'include'.

const API = (path) => path; // mismo origen
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let _user = null;
let _socket = null;
let _accounts = [];
let _routines = [];
let _setters = []; // del endpoint existente /api/setters
let _selectedAccountIds = new Set();

async function api(path, opts = {}) {
  const res = await fetch(API(path), {
    credentials: "include",
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

// ── INIT ──────────────────────────────────────────────────────────────────
async function bootWaModule(user) {
  _user = user;
  if (!user) return;
  await loadInitialData();
  if (user.role === "admin") {
    renderDashboard();
    renderAccountsAdmin();
    renderRoutines();
  } else {
    renderMyWhatsapps();
  }
  connectSocket();
}

async function loadInitialData() {
  try {
    const [accs, rts, setters] = await Promise.all([
      api("/api/wa/accounts").catch(() => []),
      _user.role === "admin" ? api("/api/wa/routines").catch(() => []) : [],
      _user.role === "admin" ? api("/api/setters").then((d) => d.setters || []).catch(() => []) : [],
    ]);
    _accounts = accs;
    _routines = rts;
    _setters = setters;
  } catch (err) {
    console.error("[wa] error cargando data inicial:", err);
  }
}

// ── SOCKET.IO ─────────────────────────────────────────────────────────────
function connectSocket() {
  if (!window.io) {
    console.warn("[wa] socket.io no cargado");
    return;
  }
  if (_socket) return;
  _socket = window.io({ transports: ["websocket"], withCredentials: true });
  _socket.on("connect", () => {
    setLiveIndicator(true);
    setInterval(() => _socket?.emit("heartbeat"), 30000);
  });
  _socket.on("disconnect", () => setLiveIndicator(false));
  _socket.on("admin:account-update", ({ accountId, status, phone }) => {
    const acc = _accounts.find((a) => a.id === accountId);
    if (acc) {
      acc.status = status;
      if (phone) acc.phone = phone;
      if (_user.role === "admin") renderAccountsAdmin();
      else renderMyWhatsapps();
    }
  });
  _socket.on("admin:event", () => {
    // refrescar dashboard si está visible
    if ($("#view-wa-dashboard")?.classList.contains("active")) renderDashboard();
  });
  _socket.on("admin:presence-update", () => {
    if ($("#view-wa-dashboard")?.classList.contains("active")) renderDashboard();
  });
}

function setLiveIndicator(on) {
  let dot = $("#wa-live-dot");
  if (!dot) {
    const footer = $(".sidebar-footer");
    if (!footer) return;
    dot = document.createElement("div");
    dot.id = "wa-live-dot";
    dot.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary,#888);margin-top:8px;";
    dot.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#666;"></span><span class="wa-live-label">offline</span>';
    footer.appendChild(dot);
  }
  const circle = dot.querySelector("span");
  const label = dot.querySelector(".wa-live-label");
  if (on) {
    circle.style.background = "#10b981";
    circle.style.boxShadow = "0 0 6px #10b981";
    label.textContent = "live";
  } else {
    circle.style.background = "#666";
    circle.style.boxShadow = "none";
    label.textContent = "offline";
  }
}

// ── HELPERS ───────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  CONNECTED: "Conectado",
  DISCONNECTED: "Desconectado",
  QR_PENDING: "Esperando QR",
  BANNED: "Baneado",
  BANNED_TEMP: "Cooldown",
};
const STATUS_COLOR = {
  CONNECTED: "#10b981",
  DISCONNECTED: "#6b7280",
  QR_PENDING: "#f59e0b",
  BANNED: "#ef4444",
  BANNED_TEMP: "#fb923c",
};

// Curva oficial goghl.ai. Usada como default si la rutina no tiene phases.
function defaultPhasesUI() {
  return [
    { name: "Fase 1 — Configuración inicial",  untilDay: 2,    dailyMessages: 12,  dripMinMs: 15000, dripMaxMs: 20000, allowAutomation: false },
    { name: "Fase 2 — Aumento gradual",        untilDay: 5,    dailyMessages: 28,  dripMinMs: 15000, dripMaxMs: 20000, allowAutomation: false },
    { name: "Fase 3 — Construyendo reputación", untilDay: 10,  dailyMessages: 75,  dripMinMs: 10000, dripMaxMs: 15000, allowAutomation: true  },
    { name: "Fase 4 — Escalando",              untilDay: 14,   dailyMessages: 250, dripMinMs: 5000,  dripMaxMs: 10000, allowAutomation: true  },
    { name: "Fase 5 — Operación completa",     untilDay: null, dailyMessages: 750, dripMinMs: 3000,  dripMaxMs: 5000,  allowAutomation: true  },
  ];
}

function warmingDayOfAccount(account) {
  if (!account.routineStartedAt) return 0;
  const days = Math.floor((Date.now() - new Date(account.routineStartedAt).getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(1, days + 1);
}

function currentPhaseFor(routine, day) {
  const phases = (routine?.phases?.length ? routine.phases : defaultPhasesUI());
  for (const p of phases) {
    if (p.untilDay === null || p.untilDay === undefined || day <= p.untilDay) return p;
  }
  return phases[phases.length - 1];
}

function escHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }

function statusBadge(status) {
  const color = STATUS_COLOR[status] || "#666";
  const label = STATUS_LABEL[status] || status;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${color}22;color:${color};font-size:11px;font-weight:500;">${escHtml(label)}</span>`;
}

function findSetterName(refId) {
  return _setters.find((s) => s.id === refId)?.name || refId || "—";
}

function findRoutineName(id) {
  return _routines.find((r) => r.id === id)?.name || "—";
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
async function renderDashboard() {
  const view = $("#view-wa-dashboard");
  if (!view) return;
  let summary, hourly;
  try {
    [summary, hourly] = await Promise.all([
      api("/api/wa/stats/summary"),
      api("/api/wa/stats/events-by-hour?hours=24"),
    ]);
  } catch (err) {
    view.innerHTML = `<div style="padding:24px;color:#ef4444;">Error: ${escHtml(err.message)}</div>`;
    return;
  }
  const cards = [
    { num: summary.totalAccounts, lbl: "Cuentas totales" },
    { num: summary.byStatus.CONNECTED || 0, lbl: "Conectadas" },
    { num: `${summary.onlineSetters} / ${summary.totalSetters}`, lbl: "Setters online" },
    { num: summary.msgsLast24h, lbl: "Mensajes 24h" },
    { num: summary.eventsLast24h, lbl: "Eventos 24h" },
  ];
  const max = Math.max(1, ...hourly.map((h) => h.total));
  const chart = hourly.map((h, i) => {
    const ph = (h.total / max) * 100;
    return `<div title="${new Date(h.hour).toLocaleString()}: ${h.total}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;"><div style="width:80%;background:#6366f1;opacity:${h.total ? 0.85 : 0.15};height:${ph}%;border-radius:2px 2px 0 0;"></div></div>`;
  }).join("");
  view.innerHTML = `
    <div class="content-header"><h2>Dashboard WhatsApp</h2><button class="btn-table-action" id="wa-dash-refresh">Refrescar</button></div>
    <div style="padding:0 32px 32px;">
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
        ${cards.map((c) => `<div style="background:var(--bg-secondary,#1a1f29);border:1px solid var(--border-color,#2a3441);border-radius:8px;padding:18px 22px;min-width:160px;"><div style="font-size:28px;font-weight:bold;">${escHtml(c.num)}</div><div style="font-size:12px;color:var(--text-secondary,#888);margin-top:4px;">${escHtml(c.lbl)}</div></div>`).join("")}
      </div>
      <div style="background:var(--bg-secondary,#1a1f29);border:1px solid var(--border-color,#2a3441);border-radius:8px;padding:20px;">
        <div style="font-size:13px;color:var(--text-secondary,#888);margin-bottom:12px;">Eventos por hora — últimas 24h</div>
        <div style="display:flex;height:120px;gap:2px;">${chart}</div>
      </div>
    </div>
  `;
  $("#wa-dash-refresh")?.addEventListener("click", renderDashboard);
}

// ── ACCOUNTS (ADMIN) ──────────────────────────────────────────────────────
function renderAccountsAdmin() {
  const view = $("#view-wa-accounts");
  if (!view) return;
  const rows = _accounts.map((a) => {
    const routine = _routines.find((r) => r.id === a.routineId);
    const day = warmingDayOfAccount(a);
    const phase = routine ? currentPhaseFor(routine, day) : null;
    const phaseCell = !a.routineStartedAt
      ? '<span style="color:#888;">— sin iniciar</span>'
      : (a.status === "BANNED_TEMP" && a.pauseUntil
          ? `<span style="color:#fb923c;">Cooldown hasta ${new Date(a.pauseUntil).toLocaleString()}</span>`
          : `<span title="${escHtml(phase?.name || '')}">Día ${day} · ${phase ? `${phase.dailyMessages}msg/d` : '—'}</span>`);
    const routineOpts = ['<option value="">—</option>']
      .concat(_routines.map((r) => `<option value="${r.id}" ${a.routineId === r.id ? "selected" : ""}>${escHtml(r.name)}</option>`))
      .join("");
    const setterOpts = ['<option value="">—</option>']
      .concat(_setters.map((s) => `<option value="${s.id}" ${a.assignment?.refId === s.id ? "selected" : ""}>${escHtml(s.name)}</option>`))
      .join("");
    const checked = _selectedAccountIds.has(a.id) ? "checked" : "";
    return `<tr data-id="${a.id}">
      <td><input type="checkbox" class="wa-acc-check" data-id="${a.id}" ${checked}></td>
      <td>${escHtml(a.label)}</td>
      <td>${escHtml(a.phone || "—")}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px;">${phaseCell}</td>
      <td><select class="wa-assign-setter" data-id="${a.id}" style="width:130px;">${setterOpts}</select></td>
      <td><select class="wa-attach-routine" data-id="${a.id}" style="width:130px;">${routineOpts}</select></td>
      <td style="white-space:nowrap;">
        <button class="btn-table-action" data-act="open" data-id="${a.id}">Abrir</button>
        <button class="btn-table-action" data-act="msg" data-id="${a.id}">Mensaje</button>
        <button class="btn-table-action" data-act="start" data-id="${a.id}" style="color:#10b981;">▶ Warm</button>
        <button class="btn-table-action" data-act="stop" data-id="${a.id}" style="color:#f59e0b;">⏸</button>
        <button class="btn-table-action" data-act="reset" data-id="${a.id}" title="Reiniciar warming desde día 1" style="color:#a8c7fa;">↺</button>
        <button class="btn-table-action" data-act="del" data-id="${a.id}" style="color:#ef4444;">🗑</button>
      </td>
    </tr>`;
  }).join("");

  const selCount = _selectedAccountIds.size;
  view.innerHTML = `
    <div class="content-header">
      <h2>Cuentas WhatsApp</h2>
      <button class="btn-primary pill-btn" id="wa-acc-new">+ Nueva cuenta</button>
    </div>
    <div style="padding:0 32px 32px;">
      ${selCount > 0 ? `
        <div style="display:flex;align-items:center;gap:8px;background:#312e81;border:1px solid #4338ca;border-radius:6px;padding:10px 14px;margin-bottom:12px;">
          <span><strong>${selCount}</strong> seleccionadas</span>
          <select id="wa-bulk-action" style="margin-left:auto;">
            <option value="open">Abrir</option><option value="close">Cerrar</option>
            <option value="start-routine">Iniciar warming</option><option value="stop-routine">Detener warming</option>
          </select>
          <button class="btn-table-action" id="wa-bulk-run" style="color:#10b981;">Ejecutar</button>
          <button class="btn-table-action" id="wa-bulk-clear">Limpiar</button>
        </div>` : ""}
      <table class="leads-table" style="width:100%;">
        <thead><tr><th width="32"></th><th>Cuenta</th><th>Tel</th><th>Estado</th><th>Día / Fase</th><th>Setter</th><th>Rutina</th><th>Acciones</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-secondary,#888);">Sin cuentas todavía. Creá una con "+ Nueva cuenta"</td></tr>`}</tbody>
      </table>
    </div>
  `;

  // listeners
  $("#wa-acc-new")?.addEventListener("click", openCreateAccountDialog);
  $$("#view-wa-accounts .wa-acc-check").forEach((cb) => cb.addEventListener("change", (e) => {
    const id = e.target.dataset.id;
    if (e.target.checked) _selectedAccountIds.add(id); else _selectedAccountIds.delete(id);
    renderAccountsAdmin();
  }));
  $("#wa-bulk-clear")?.addEventListener("click", () => { _selectedAccountIds.clear(); renderAccountsAdmin(); });
  $("#wa-bulk-run")?.addEventListener("click", async () => {
    const action = $("#wa-bulk-action").value;
    try {
      const res = await api("/api/wa/commands/bulk", { method: "POST", body: JSON.stringify({ accountIds: Array.from(_selectedAccountIds), action }) });
      alert(`Despachado: ${res.dispatched}, errores: ${res.errors.length}`);
      _selectedAccountIds.clear();
      await loadInitialData();
      renderAccountsAdmin();
    } catch (err) { alert("Error: " + err.message); }
  });
  $$("#view-wa-accounts .wa-attach-routine").forEach((s) => s.addEventListener("change", async (e) => {
    try {
      await api("/api/wa/routines/attach", { method: "POST", body: JSON.stringify({ accountId: e.target.dataset.id, routineId: e.target.value || null }) });
      await loadInitialData();
      renderAccountsAdmin();
    } catch (err) { alert("Error: " + err.message); }
  }));
  $$("#view-wa-accounts .wa-assign-setter").forEach((s) => s.addEventListener("change", async (e) => {
    const refId = e.target.value;
    try {
      await api(`/api/wa/accounts/${e.target.dataset.id}/assign`, { method: "POST", body: JSON.stringify(refId ? { kind: "setter", refId } : {}) });
      await loadInitialData();
      renderAccountsAdmin();
    } catch (err) { alert("Error: " + err.message); }
  }));
  $$("#view-wa-accounts button[data-act]").forEach((b) => b.addEventListener("click", async (e) => {
    const id = e.target.dataset.id;
    const act = e.target.dataset.act;
    try {
      if (act === "open") await api("/api/wa/commands/open", { method: "POST", body: JSON.stringify({ accountId: id }) });
      else if (act === "start") await api("/api/wa/commands/start-routine", { method: "POST", body: JSON.stringify({ accountId: id }) });
      else if (act === "stop") await api("/api/wa/commands/stop-routine", { method: "POST", body: JSON.stringify({ accountId: id }) });
      else if (act === "reset") {
        if (!confirm("¿Reiniciar warming desde día 1? Esto resetea el progreso de la fase.")) return;
        await api(`/api/wa/accounts/${id}/reset-warming`, { method: "POST" });
        await loadInitialData();
        renderAccountsAdmin();
        return;
      } else if (act === "del") {
        if (!confirm("¿Borrar cuenta?")) return;
        await api(`/api/wa/accounts/${id}`, { method: "DELETE" });
        await loadInitialData();
        renderAccountsAdmin();
        return;
      } else if (act === "msg") {
        const phone = prompt("Teléfono destino (con código país, solo dígitos):");
        if (!phone) return;
        const text = prompt("Mensaje:");
        if (!text) return;
        await api("/api/wa/commands/send-message", { method: "POST", body: JSON.stringify({ accountId: id, phone, text }) });
      }
      // refresh suave
      const a = _accounts.find((x) => x.id === id);
      if (a) renderAccountsAdmin();
    } catch (err) { alert("Error: " + err.message); }
  }));
}

async function openCreateAccountDialog() {
  const label = prompt("Label para la cuenta (ej: 'Ventas 01'):");
  if (!label) return;
  try {
    await api("/api/wa/accounts", { method: "POST", body: JSON.stringify({ label }) });
    await loadInitialData();
    renderAccountsAdmin();
  } catch (err) { alert("Error: " + err.message); }
}

// ── ROUTINES ──────────────────────────────────────────────────────────────
function renderRoutines() {
  const view = $("#view-wa-routines");
  if (!view) return;
  const rows = _routines.map((r) => {
    const phases = (r.phases?.length ? r.phases : defaultPhasesUI());
    const summary = phases.map((p) => `${p.untilDay ?? '∞'}d:${p.dailyMessages}`).join(' → ');
    return `
    <tr>
      <td>${escHtml(r.name)}</td>
      <td style="font-size:11px;color:var(--text-secondary,#888);">${escHtml(summary)}</td>
      <td>${r.hourStart ?? 9}h–${r.hourEnd ?? 19}h</td>
      <td>${(r.messages || []).length} / ${(r.targets || []).length}</td>
      <td>${r.autoReply ? "✓" : "—"}</td>
      <td>
        <button class="btn-table-action" data-rt-act="edit" data-id="${r.id}">Editar</button>
        <button class="btn-table-action" data-rt-act="del" data-id="${r.id}" style="color:#ef4444;">🗑</button>
      </td>
    </tr>`;}).join("");
  view.innerHTML = `
    <div class="content-header">
      <h2>Rutinas de Warming</h2>
      <button class="btn-primary pill-btn" id="wa-rt-new">+ Nueva rutina</button>
    </div>
    <div style="padding:0 32px 32px;">
      <table class="leads-table" style="width:100%;">
        <thead><tr><th>Nombre</th><th>Curva (días → msg/día)</th><th>Horario</th><th>Msg / Targets</th><th>Auto-reply</th><th>Acciones</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-secondary,#888);">Sin rutinas. Creá una con "+ Nueva rutina"</td></tr>`}</tbody>
      </table>
    </div>
  `;
  $("#wa-rt-new")?.addEventListener("click", () => openRoutineDialog(null));
  $$("#view-wa-routines button[data-rt-act]").forEach((b) => b.addEventListener("click", async (e) => {
    const id = e.target.dataset.id;
    const act = e.target.dataset.rtAct;
    if (act === "edit") openRoutineDialog(_routines.find((r) => r.id === id));
    else if (act === "del") {
      if (!confirm("¿Borrar rutina?")) return;
      await api(`/api/wa/routines/${id}`, { method: "DELETE" });
      await loadInitialData();
      renderRoutines();
      renderAccountsAdmin();
    }
  }));
}

function openRoutineDialog(routine) {
  const isEdit = !!routine;
  const r = routine || {
    name: "", hourStart: 9, hourEnd: 19,
    timezone: "America/Argentina/Buenos_Aires",
    phases: [],
    messages: [], targets: [], autoReply: false, autoReplies: [],
  };
  // estado mutable de fases dentro del dialog
  let phases = (Array.isArray(r.phases) && r.phases.length > 0) ? structuredClone(r.phases) : defaultPhasesUI();

  function renderPhases() {
    const tbody = overlay.querySelector("#rt-phases-tbody");
    tbody.innerHTML = phases.map((p, i) => `
      <tr data-i="${i}">
        <td><input data-f="name" value="${escHtml(p.name || '')}" style="width:100%;"></td>
        <td><input data-f="untilDay" type="number" value="${p.untilDay ?? ''}" placeholder="∞" style="width:60px;"></td>
        <td><input data-f="dailyMessages" type="number" value="${p.dailyMessages}" min="1" max="2000" style="width:80px;"></td>
        <td><input data-f="dripMinMs" type="number" value="${p.dripMinMs}" min="3000" step="1000" style="width:90px;"></td>
        <td><input data-f="dripMaxMs" type="number" value="${p.dripMaxMs}" min="3000" step="1000" style="width:90px;"></td>
        <td style="text-align:center;"><input data-f="allowAutomation" type="checkbox" ${p.allowAutomation ? "checked" : ""}></td>
        <td><button class="btn-table-action" data-rmphase="${i}" style="color:#ef4444;">×</button></td>
      </tr>
    `).join("");
    tbody.querySelectorAll("input[data-f]").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const tr = e.target.closest("tr");
        const i = +tr.dataset.i;
        const f = e.target.dataset.f;
        if (f === "allowAutomation") phases[i][f] = e.target.checked;
        else if (f === "untilDay") phases[i][f] = e.target.value === "" ? null : parseInt(e.target.value, 10);
        else if (f === "name") phases[i][f] = e.target.value;
        else phases[i][f] = parseInt(e.target.value, 10);
      });
    });
    tbody.querySelectorAll("button[data-rmphase]").forEach((b) => {
      b.addEventListener("click", () => { phases.splice(+b.dataset.rmphase, 1); renderPhases(); });
    });
  }

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;";
  overlay.innerHTML = `
    <div style="background:var(--bg-secondary,#1a1f29);border:1px solid var(--border-color,#2a3441);border-radius:8px;padding:24px;max-width:860px;width:95%;max-height:92vh;overflow:auto;">
      <h3 style="margin-top:0;">${isEdit ? "Editar rutina" : "Nueva rutina"}</h3>
      <div style="display:grid;gap:14px;">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.5fr;gap:8px;">
          <label>Nombre<input id="rt-name" value="${escHtml(r.name)}" style="width:100%;"></label>
          <label>Hora inicio<input id="rt-hs" type="number" value="${r.hourStart ?? 9}" min="0" max="23"></label>
          <label>Hora fin<input id="rt-he" type="number" value="${r.hourEnd ?? 19}" min="0" max="23"></label>
          <label>Timezone<input id="rt-tz" value="${escHtml(r.timezone || 'America/Argentina/Buenos_Aires')}" style="width:100%;"></label>
        </div>

        <div style="border:1px solid var(--border-color,#2a3441);border-radius:6px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong>Curva de calentamiento por fases (goghl.ai)</strong>
            <div>
              <button class="btn-table-action" id="rt-default-curve">Aplicar curva default</button>
              <button class="btn-table-action" id="rt-add-phase" style="color:#10b981;">+ fase</button>
            </div>
          </div>
          <small style="color:var(--text-secondary,#888);">
            Cada fase aplica HASTA su <em>untilDay</em> (vacío = sin límite, fase final).
            <em>allowAutomation</em>=off significa que el setter debe operar manualmente, sin envíos automáticos.
            Drip mín/máx en milisegundos. Hard cap: 2000 msg/día, drip ≥ 3000ms.
          </small>
          <table style="width:100%;margin-top:10px;font-size:12px;">
            <thead><tr><th align="left">Nombre</th><th>Hasta día</th><th>Msg/día</th><th>Drip min</th><th>Drip max</th><th>Auto</th><th></th></tr></thead>
            <tbody id="rt-phases-tbody"></tbody>
          </table>
        </div>

        <label>Mensajes (uno por línea)<textarea id="rt-msgs" rows="5" style="width:100%;font-family:inherit;">${escHtml((r.messages || []).join("\n"))}</textarea></label>
        <label>Targets (teléfonos, uno por línea, solo dígitos con país)<textarea id="rt-tgts" rows="4" style="width:100%;font-family:inherit;">${escHtml((r.targets || []).join("\n"))}</textarea></label>
        <label><input type="checkbox" id="rt-ar" ${r.autoReply ? "checked" : ""}> Auto-responder mensajes entrantes</label>
        <label>Respuestas automáticas (una por línea)<textarea id="rt-ars" rows="3" style="width:100%;font-family:inherit;">${escHtml((r.autoReplies || []).join("\n"))}</textarea></label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">
        <button class="btn-table-action" id="rt-cancel">Cancelar</button>
        <button class="btn-primary pill-btn" id="rt-save">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  renderPhases();
  const close = () => overlay.remove();
  overlay.querySelector("#rt-cancel").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector("#rt-default-curve").addEventListener("click", () => { phases = defaultPhasesUI(); renderPhases(); });
  overlay.querySelector("#rt-add-phase").addEventListener("click", () => {
    phases.push({ name: "Nueva fase", untilDay: null, dailyMessages: 100, dripMinMs: 5000, dripMaxMs: 10000, allowAutomation: true });
    renderPhases();
  });
  overlay.querySelector("#rt-save").addEventListener("click", async () => {
    const payload = {
      name: overlay.querySelector("#rt-name").value.trim() || "Sin nombre",
      hourStart: +overlay.querySelector("#rt-hs").value,
      hourEnd: +overlay.querySelector("#rt-he").value,
      timezone: overlay.querySelector("#rt-tz").value.trim(),
      phases,
      messages: overlay.querySelector("#rt-msgs").value.split("\n").map((s) => s.trim()).filter(Boolean),
      targets: overlay.querySelector("#rt-tgts").value.split("\n").map((s) => s.trim().replace(/[^\d]/g, "")).filter(Boolean),
      autoReply: overlay.querySelector("#rt-ar").checked,
      autoReplies: overlay.querySelector("#rt-ars").value.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    try {
      if (isEdit) await api(`/api/wa/routines/${r.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/api/wa/routines", { method: "POST", body: JSON.stringify(payload) });
      close();
      await loadInitialData();
      renderRoutines();
      renderAccountsAdmin();
    } catch (err) { alert("Error: " + err.message); }
  });
}

// ── MIS WHATSAPPS (SETTER) ────────────────────────────────────────────────
function renderMyWhatsapps() {
  const view = $("#view-wa-mywhats");
  if (!view) return;
  const rows = _accounts.map((a) => `
    <tr>
      <td>${escHtml(a.label)}</td>
      <td>${escHtml(a.phone || "—")}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${a.routineId ? findRoutineName(a.routineId) : "—"}</td>
    </tr>`).join("");
  view.innerHTML = `
    <div class="content-header"><h2>Mis WhatsApps</h2></div>
    <div style="padding:0 32px 32px;">
      <p style="color:var(--text-secondary,#888);margin-bottom:16px;">
        Para operar tus cuentas, abrí la app desktop wa-multi en tu PC.
        Los comandos del admin van a llegar automáticamente.
      </p>
      <table class="leads-table" style="width:100%;">
        <thead><tr><th>Cuenta</th><th>Teléfono</th><th>Estado</th><th>Rutina</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-secondary,#888);">No tenés cuentas asignadas todavía</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

// ── BOOT ──────────────────────────────────────────────────────────────────
// app.js asigna window.__CURRENT_USER__ después del login.
// Polleamos hasta que aparezca, sin tocar app.js.
window.__waBoot = bootWaModule;
let _bootDone = false;
const _bootCheck = setInterval(() => {
  if (_bootDone) return clearInterval(_bootCheck);
  const u = window.__CURRENT_USER__;
  if (u) {
    _bootDone = true;
    clearInterval(_bootCheck);
    bootWaModule(u);
  }
}, 200);

// Re-renderiza vistas cuando se navega a ellas (en caso de cambios externos)
document.addEventListener("click", (e) => {
  const item = e.target.closest(".menu-item[data-target]");
  if (!item) return;
  const target = item.getAttribute("data-target");
  setTimeout(() => {
    if (target === "view-wa-dashboard") renderDashboard();
    else if (target === "view-wa-accounts") renderAccountsAdmin();
    else if (target === "view-wa-routines") renderRoutines();
    else if (target === "view-wa-mywhats") renderMyWhatsapps();
  }, 50);
});

console.log("[wa] modulo cargado");
