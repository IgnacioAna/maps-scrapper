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
    status: "DISCONNECTED",
    // tag: "pool" | "setter:<id>" | "client:<id>"
    assignment: null,
    routineId: null,
    notes: input.notes || "",
    createdAt: new Date().toISOString(),
  };
  data.accounts.push(account);
  saveJson(FILES.accounts, data);
  return account;
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

const ROUTINE_DEFAULTS = {
  dailyMessages: 20,
  hourStart: 9,
  hourEnd: 21,
  humanDelayMinMs: 30000,
  humanDelayMaxMs: 180000,
  timezone: "America/Argentina/Buenos_Aires",
  messages: [],
  targets: [],
  autoReply: false,
  autoReplies: [],
};

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
