// Data layer del módulo WhatsApp Multi-Account.
// Sigue el mismo patrón que index.js: archivos JSON en DATA_DIR.
import fs from "node:fs";
import path from "node:path";

let DATA_DIR_REF = null;
const FILES = { accounts: null, routines: null, events: null };
const EVENTS_MAX = 10000;

export function initWaData(dataDir) {
  DATA_DIR_REF = dataDir;
  FILES.accounts = path.join(dataDir, "wa_accounts.json");
  FILES.routines = path.join(dataDir, "wa_routines.json");
  FILES.events = path.join(dataDir, "wa_events.json");
  // Inicializar archivos si no existen (sin pisar nada existente)
  for (const [key, defaultData] of [
    ["accounts", { accounts: [] }],
    ["routines", { routines: [] }],
    ["events", { events: [], rotations: 0 }],
  ]) {
    if (!fs.existsSync(FILES[key])) {
      fs.writeFileSync(FILES[key], JSON.stringify(defaultData, null, 2), "utf8");
    }
  }
}

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[wa] error leyendo ${file}:`, e);
    return fallback;
  }
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(`[wa] error guardando ${file}:`, e);
  }
}

// ── ACCOUNTS ────────────────────────────────────────────────────────────────
export function listAccounts() {
  return loadJson(FILES.accounts, { accounts: [] }).accounts;
}

export function getAccount(id) {
  return listAccounts().find((a) => a.id === id);
}

export function createAccount(input) {
  const data = loadJson(FILES.accounts, { accounts: [] });
  const account = {
    id: `wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: String(input.label || "").trim() || "Cuenta sin nombre",
    phone: null,
    // status: DISCONNECTED | QR_PENDING | CONNECTED | BANNED | BANNED_TEMP
    status: "DISCONNECTED",
    assignment: null,
    routineId: null,
    notes: input.notes || "",
    // Warming state
    routineStartedAt: null, // ISO al disparar start-routine
    pauseUntil: null, // ISO si está en cooldown post-ban
    staggerOffsetMs: 0, // offset random para no patear todos los WS al mismo tiempo
    // Counters diarios para tasa de respuesta y ban detection
    dailyKey: null, // YYYY-MM-DD del último reset
    msgsSentToday: 0,
    responsesToday: 0,
    pendingCount: 0, // cuantos mensajes están en estado pendiente
    deliveryFails: 0, // contador rolling de fallas
    lastBannedAt: null, // ISO del último ban
    createdAt: new Date().toISOString(),
  };
  data.accounts.push(account);
  saveJson(FILES.accounts, data);
  return account;
}

export function warmingDayOf(account, now = Date.now()) {
  if (!account.routineStartedAt) return 0;
  const start = new Date(account.routineStartedAt).getTime();
  const days = Math.floor((now - start) / (24 * 60 * 60 * 1000));
  return Math.max(1, days + 1); // día 1 = primer día
}

export function startWarming(accountId, opts = {}) {
  // Stagger automático: random 0-3h, así múltiples cuentas no arrancan a la vez
  const staggerOffsetMs = Math.floor(Math.random() * 3 * 60 * 60 * 1000);
  return updateAccount(accountId, {
    routineStartedAt: new Date().toISOString(),
    pauseUntil: null,
    staggerOffsetMs,
    msgsSentToday: 0,
    responsesToday: 0,
    pendingCount: 0,
    deliveryFails: 0,
    dailyKey: new Date().toISOString().slice(0, 10),
    ...opts,
  });
}

export function markBannedTemporarily(accountId, cooldownDays = 4) {
  const until = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  return updateAccount(accountId, {
    status: "BANNED_TEMP",
    pauseUntil: until,
    lastBannedAt: new Date().toISOString(),
  });
}

export function resetWarming(accountId) {
  return startWarming(accountId, { status: "DISCONNECTED" });
}

export function incrementCounter(accountId, field, by = 1) {
  const acc = getAccount(accountId);
  if (!acc) return null;
  const today = new Date().toISOString().slice(0, 10);
  const patch = {};
  if (acc.dailyKey !== today) {
    patch.dailyKey = today;
    patch.msgsSentToday = 0;
    patch.responsesToday = 0;
    patch.pendingCount = 0;
    patch.deliveryFails = 0;
  }
  patch[field] = (patch[field] !== undefined ? patch[field] : (acc[field] || 0)) + by;
  return updateAccount(accountId, patch);
}

export function updateAccount(id, patch) {
  const data = loadJson(FILES.accounts, { accounts: [] });
  const idx = data.accounts.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  data.accounts[idx] = { ...data.accounts[idx], ...patch };
  saveJson(FILES.accounts, data);
  return data.accounts[idx];
}

export function deleteAccount(id) {
  const data = loadJson(FILES.accounts, { accounts: [] });
  const before = data.accounts.length;
  data.accounts = data.accounts.filter((a) => a.id !== id);
  saveJson(FILES.accounts, data);
  return before !== data.accounts.length;
}

export function setAccountStatus(id, status, phone) {
  const patch = { status };
  if (phone) patch.phone = phone;
  return updateAccount(id, patch);
}

export function attachRoutine(accountId, routineId) {
  return updateAccount(accountId, { routineId: routineId || null });
}

export function setAssignment(accountId, assignment) {
  // assignment: { kind: "setter"|"client", refId: string } | null
  return updateAccount(accountId, { assignment });
}

// ── ROUTINES ────────────────────────────────────────────────────────────────
export function listRoutines() {
  return loadJson(FILES.routines, { routines: [] }).routines;
}

export function getRoutine(id) {
  return listRoutines().find((r) => r.id === id);
}

// Curva oficial goghl.ai. untilDay=null = fase final (operación completa).
// allowAutomation=false en fases iniciales fuerza al engine a NO mandar
// mensajes automáticos (sólo el setter manualmente puede operar la cuenta).
export function defaultPhases() {
  return [
    { name: "Fase 1 — Configuración inicial", untilDay: 2, dailyMessages: 12, dripMinMs: 15000, dripMaxMs: 20000, allowAutomation: false },
    { name: "Fase 2 — Aumento gradual",       untilDay: 5, dailyMessages: 28, dripMinMs: 15000, dripMaxMs: 20000, allowAutomation: false },
    { name: "Fase 3 — Construyendo reputación", untilDay: 10, dailyMessages: 75, dripMinMs: 10000, dripMaxMs: 15000, allowAutomation: true },
    { name: "Fase 4 — Escalando",             untilDay: 14, dailyMessages: 250, dripMinMs: 5000, dripMaxMs: 10000, allowAutomation: true },
    { name: "Fase 5 — Operación completa",    untilDay: null, dailyMessages: 750, dripMinMs: 3000, dripMaxMs: 5000, allowAutomation: true },
  ];
}

const ROUTINE_DEFAULTS = {
  // Curva por fases (lo más importante). Si está vacía, se usa defaultPhases().
  phases: [],
  // Horario laboral (recomendado 9-19 por goghl.ai).
  hourStart: 9,
  hourEnd: 19,
  timezone: "America/Argentina/Buenos_Aires",
  messages: [],
  targets: [],
  autoReply: false,
  autoReplies: [],
  // Hard caps inviolables (goghl.ai)
  hardMaxDailyMessages: 2000,
  hardMinDripMs: 3000,
  maxDailyIncreasePct: 20,
  // Post-ban cooldown
  banCooldownDays: 4,
  // Ban detector: tasa de entrega mínima antes de pausar
  minDeliveryRatePct: 90,
  pendingThresholdMs: 5 * 60 * 1000, // 5 min
};

export function effectivePhases(routine) {
  if (Array.isArray(routine.phases) && routine.phases.length > 0) return routine.phases;
  return defaultPhases();
}

export function currentPhaseFor(routine, warmingDay) {
  const phases = effectivePhases(routine);
  for (const p of phases) {
    if (p.untilDay === null || warmingDay <= p.untilDay) return p;
  }
  return phases[phases.length - 1];
}

export function createRoutine(input) {
  const data = loadJson(FILES.routines, { routines: [] });
  const routine = {
    id: `routine_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: String(input.name || "Sin nombre"),
    ...ROUTINE_DEFAULTS,
    ...input,
    createdAt: new Date().toISOString(),
  };
  data.routines.push(routine);
  saveJson(FILES.routines, data);
  return routine;
}

export function updateRoutine(id, patch) {
  const data = loadJson(FILES.routines, { routines: [] });
  const idx = data.routines.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  data.routines[idx] = { ...data.routines[idx], ...patch };
  saveJson(FILES.routines, data);
  return data.routines[idx];
}

export function deleteRoutine(id) {
  const data = loadJson(FILES.routines, { routines: [] });
  data.routines = data.routines.filter((r) => r.id !== id);
  saveJson(FILES.routines, data);
}

// ── EVENTS ──────────────────────────────────────────────────────────────────
export function appendEvent(ev) {
  const data = loadJson(FILES.events, { events: [], rotations: 0 });
  const event = {
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: String(ev.type || "unknown"),
    accountId: ev.accountId || null,
    userId: ev.userId || null,
    payload: ev.payload != null ? ev.payload : null,
    createdAt: new Date().toISOString(),
  };
  data.events.push(event);
  // Rotación: si supera EVENTS_MAX, archivo viejo y reset
  if (data.events.length > EVENTS_MAX) {
    const archive = path.join(DATA_DIR_REF, `wa_events.${Date.now()}.archive.json`);
    try {
      fs.writeFileSync(archive, JSON.stringify({ events: data.events.slice(0, EVENTS_MAX) }, null, 2), "utf8");
    } catch (e) {
      console.error("[wa] no se pudo archivar wa_events:", e);
    }
    data.events = data.events.slice(-Math.floor(EVENTS_MAX / 2));
    data.rotations = (data.rotations || 0) + 1;
  }
  saveJson(FILES.events, data);
  return event;
}

export function listEvents({ limit = 100, accountId, type, since } = {}) {
  const data = loadJson(FILES.events, { events: [] });
  let evs = data.events;
  if (accountId) evs = evs.filter((e) => e.accountId === accountId);
  if (type) evs = evs.filter((e) => e.type === type);
  if (since) {
    const t = new Date(since).getTime();
    evs = evs.filter((e) => new Date(e.createdAt).getTime() >= t);
  }
  return evs.slice(-Math.min(limit, 500)).reverse();
}

export function eventsByHour({ hours = 24, type } = {}) {
  const data = loadJson(FILES.events, { events: [] });
  const since = Date.now() - hours * 60 * 60 * 1000;
  let evs = data.events.filter((e) => new Date(e.createdAt).getTime() >= since);
  if (type) evs = evs.filter((e) => e.type === type);
  const buckets = new Map();
  for (let i = hours - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    buckets.set(d.toISOString(), { hour: d.toISOString(), total: 0, byType: {} });
  }
  for (const e of evs) {
    const d = new Date(e.createdAt);
    d.setMinutes(0, 0, 0);
    const k = d.toISOString();
    const b = buckets.get(k);
    if (!b) continue;
    b.total += 1;
    b.byType[e.type] = (b.byType[e.type] || 0) + 1;
  }
  return Array.from(buckets.values());
}
