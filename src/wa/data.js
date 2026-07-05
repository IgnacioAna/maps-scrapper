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

// WR-06: distinguir "no existe" (fallback OK, primer boot) de "existe pero no
// parsea" (corrupto). El comportamiento viejo devolvía el fallback vacío ante
// CUALQUIER error → el próximo save persistía ese vacío y WIPEABA todo el dataset
// (cuentas con sus proxies/warming, o campañas). Ahora un archivo corrupto se
// pone en cuarentena (.corrupt-<ts>) y se lanza, para que NUNCA se sobrescriba
// en su lugar con datos vacíos. El error corta la operación (request 500 / tick
// abortado por el mutex) en vez de destruir datos en silencio.
function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    let quarantine = `${file}.corrupt-${Date.now()}`;
    try { fs.renameSync(file, quarantine); } catch { quarantine = "(no se pudo mover)"; }
    console.error(`[wa] ${file} CORRUPTO — movido a ${quarantine}, restaurar de backup. NO se sobrescribe con vacío.`);
    throw new Error(`[wa] ${file} corrupto (movido a ${quarantine})`);
  }
}

// WR-06: write atómico (tmp + rename). Sin esto, un crash/OOM/kill de Railway a
// mitad de writeFileSync dejaba el archivo truncado (JSON inválido) → corrupción.
// rename es atómico en el mismo filesystem: o queda el archivo viejo entero o el
// nuevo entero, nunca a medias.
function saveJson(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error(`[wa] error guardando ${file}:`, e);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
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
    // Phase 8 — Anti-detección. Todos opt-in (null = comportamiento actual).
    // proxy: { type:"http"|"socks5", host, port, user?, pass? } | null
    proxy: null,
    // geo: { country, timezone, locale } | null — se aplica SOLO si hay proxy.
    // El navegador reporta estos valores para ser coherente con el país del proxy.
    geo: null,
    // Resultado del último "Probar proxy": { at, ok, ip, country } | null
    proxyLastTest: null,
    createdAt: new Date().toISOString(),
  };
  data.accounts.push(account);
  saveJson(FILES.accounts, data);
  return account;
}

// Phase 8 — Mapa país ISO-2 → {timezone, locale} por defecto. Países donde
// opera SCM. Si el admin no especifica timezone/locale, se derivan del país.
export const GEO_DEFAULTS = {
  MX: { timezone: "America/Mexico_City", locale: "es-MX" },
  AR: { timezone: "America/Argentina/Buenos_Aires", locale: "es-AR" },
  ES: { timezone: "Europe/Madrid", locale: "es-ES" },
  US: { timezone: "America/New_York", locale: "en-US" },
  CO: { timezone: "America/Bogota", locale: "es-CO" },
  CL: { timezone: "America/Santiago", locale: "es-CL" },
  PE: { timezone: "America/Lima", locale: "es-PE" },
  UY: { timezone: "America/Montevideo", locale: "es-UY" },
  EC: { timezone: "America/Guayaquil", locale: "es-EC" },
  BO: { timezone: "America/La_Paz", locale: "es-BO" },
  PY: { timezone: "America/Asuncion", locale: "es-PY" },
};

export function geoForCountry(country) {
  const c = String(country || "").toUpperCase();
  return GEO_DEFAULTS[c] || null;
}

// Phase 8 — set proxy/geo/proxyLastTest de una cuenta. proxy=null limpia
// proxy Y geo (volver a sin-proxy). Devuelve la cuenta actualizada o null.
export function setAccountProxy(accountId, { proxy, geo, proxyLastTest } = {}) {
  const patch = {};
  if (proxy === null) {
    patch.proxy = null;
    patch.geo = null;
  } else if (proxy !== undefined) {
    patch.proxy = proxy;
    if (geo !== undefined) patch.geo = geo;
  } else if (geo !== undefined) {
    patch.geo = geo;
  }
  if (proxyLastTest !== undefined) patch.proxyLastTest = proxyLastTest;
  return updateAccount(accountId, patch);
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

// NOTE (audit 2026-05-23): `incrementCounter` se eliminó por dead code — los
// counters diarios los actualiza la desktop wa-multi vía eventos, no este file.
// Si alguna vez se necesita un helper similar, recuperalo del git history.

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

// ── POLICY (Phase 8) ─────────────────────────────────────────────────────────
// Política global del módulo WA. Vive en el mismo wa_accounts.json (sibling
// de `accounts`) para viajar solo en export-data/pre-deploy. Phase 7 (campañas)
// consume `requireProxyForCampaigns` para negarse a encolar volumen en cuentas
// sin proxy.
const WA_POLICY_DEFAULTS = {
  requireProxyForCampaigns: false,
};

export function getWaPolicy() {
  const data = loadJson(FILES.accounts, { accounts: [] });
  return { ...WA_POLICY_DEFAULTS, ...(data.policy || {}) };
}

export function setWaPolicy(patch) {
  const data = loadJson(FILES.accounts, { accounts: [] });
  data.policy = { ...WA_POLICY_DEFAULTS, ...(data.policy || {}), ...(patch || {}) };
  saveJson(FILES.accounts, data);
  return data.policy;
}

// ── ROUTINES ────────────────────────────────────────────────────────────────
export function listRoutines() {
  return loadJson(FILES.routines, { routines: [] }).routines;
}

export function getRoutine(id) {
  return listRoutines().find((r) => r.id === id);
}

// Curva pragmática SCM (adaptada de goghl.ai).
// Diferencia con goghl.ai original: NO requiere mandar a amigos/conocidos
// los primeros 10-15 días. El setter arranca a mandar a leads desde día 1
// con volumen bajo + delays largos, y va escalando. Más realista para una
// operación comercial donde nadie va a "calentar mandándole a su amigo".
//
// Recomendación complementaria (no forzada por el engine): sumar el número
// a 3-5 grupos de WhatsApp en los primeros días para mejorar la reputación.
export function defaultPhases() {
  return [
    { name: "Fase 1 — Arranque",         untilDay: 2,    dailyMessages: 12,  dripMinMs: 60000, dripMaxMs: 120000, allowAutomation: true },
    { name: "Fase 2 — Aumento gradual",  untilDay: 5,    dailyMessages: 30,  dripMinMs: 30000, dripMaxMs: 60000,  allowAutomation: true },
    { name: "Fase 3 — Construcción",     untilDay: 10,   dailyMessages: 80,  dripMinMs: 15000, dripMaxMs: 30000,  allowAutomation: true },
    { name: "Fase 4 — Escalando",        untilDay: 14,   dailyMessages: 200, dripMinMs: 8000,  dripMaxMs: 15000,  allowAutomation: true },
    { name: "Fase 5 — Operación normal", untilDay: null, dailyMessages: 400, dripMinMs: 5000,  dripMaxMs: 12000,  allowAutomation: true },
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
