// Phase 7 — Data layer del Motor de Campañas Drip.
// Espeja el patrón de data.js (JSON file-based en DATA_DIR). Estado por lead
// separado de la campaña (leadStates) para no inflar el listado.
import fs from "node:fs";
import path from "node:path";

let CAMPAIGNS_FILE = null;

export function initCampaignsData(dataDir) {
  CAMPAIGNS_FILE = path.join(dataDir, "wa_campaigns.json");
  if (!fs.existsSync(CAMPAIGNS_FILE)) {
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify({ campaigns: [], leadStates: {} }, null, 2), "utf8");
  }
}

function load() {
  try {
    if (!fs.existsSync(CAMPAIGNS_FILE)) return { campaigns: [], leadStates: {} };
    const raw = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, "utf8"));
    if (!Array.isArray(raw.campaigns)) raw.campaigns = [];
    if (!raw.leadStates || typeof raw.leadStates !== "object") raw.leadStates = {};
    return raw;
  } catch (e) {
    console.error("[campaigns] load error:", e.message);
    return { campaigns: [], leadStates: {} };
  }
}

function save(data) {
  try {
    fs.writeFileSync(CAMPAIGNS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[campaigns] save error:", e.message);
  }
}

// Mutex async: handlers/tick con await antes de load+save deben usar esto, o
// dos writes concurrentes se pisan (mismo patrón que mutateSettersData/index.js).
let _campaignsMutex = Promise.resolve();
export async function mutateCampaigns(mutator) {
  const next = _campaignsMutex.then(async () => {
    const data = load();
    const result = await Promise.resolve(mutator(data));
    save(data);
    return result;
  });
  _campaignsMutex = next.catch(() => {});
  return next;
}

// ── Defaults + validación ─────────────────────────────────────────────────
const HARD_MIN_BLOCK_DELAY_MS = 3000;

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// Valida+normaliza el input de una campaña. Devuelve [error, campaign|patch].
// `forUpdate=true` permite campos parciales (PATCH).
export function sanitizeCampaign(input, { forUpdate = false } = {}) {
  if (!input || typeof input !== "object") return ["payload inválido"];
  const out = {};

  if (input.name !== undefined || !forUpdate) {
    const name = String(input.name || "").trim();
    if (!name) return ["name es requerido"];
    out.name = name.slice(0, 120);
  }

  if (input.accountIds !== undefined || !forUpdate) {
    const ids = Array.isArray(input.accountIds) ? input.accountIds.filter(Boolean).map(String) : [];
    if (ids.length === 0) return ["accountIds: al menos una cuenta de salida"];
    out.accountIds = ids;
  }

  if (input.variantSplit !== undefined || !forUpdate) {
    const split = Array.isArray(input.variantSplit) ? input.variantSplit : [];
    const clean = split
      .map((s) => ({ variantId: String(s.variantId || "").trim(), weight: clampInt(s.weight, 1, 100, 1) }))
      .filter((s) => s.variantId);
    if (clean.length === 0) return ["variantSplit: al menos una variante"];
    out.variantSplit = clean;
  }

  if (input.drip !== undefined || !forUpdate) {
    const d = input.drip || {};
    out.drip = {
      batchSize: clampInt(d.batchSize, 1, 50, 1),
      intervalMinutes: clampInt(d.intervalMinutes, 1, 1440, 5),
    };
  }

  if (input.window !== undefined || !forUpdate) {
    const w = input.window || {};
    const days = Array.isArray(w.days) ? w.days.map((x) => clampInt(x, 0, 6, 0)).filter((x, i, a) => a.indexOf(x) === i) : [1, 2, 3, 4, 5];
    out.window = {
      hourStart: clampInt(w.hourStart, 0, 23, 10),
      hourEnd: clampInt(w.hourEnd, 0, 23, 19),
      days: days.length ? days : [1, 2, 3, 4, 5],
      timezone: typeof w.timezone === "string" && w.timezone ? w.timezone : "America/Argentina/Buenos_Aires",
    };
  }

  if (input.blockDelay !== undefined || !forUpdate) {
    const b = input.blockDelay || {};
    const minMs = Math.max(parseInt(b.minMs, 10) || 60000, HARD_MIN_BLOCK_DELAY_MS);
    const maxMs = Math.max(parseInt(b.maxMs, 10) || 180000, minMs);
    out.blockDelay = { minMs, maxMs };
  }

  if (input.bumps !== undefined || !forUpdate) {
    const bumps = Array.isArray(input.bumps) ? input.bumps : [];
    const clean = [];
    for (const bp of bumps) {
      const text = String(bp.text || "").trim();
      const afterHours = clampInt(bp.afterHours, 1, 720, 24);
      if (!text) return ["cada bump necesita texto"];
      clean.push({ afterHours, text: text.slice(0, 2000) });
    }
    out.bumps = clean;
  }

  if (input.qualifyMessage !== undefined || !forUpdate) {
    out.qualifyMessage = String(input.qualifyMessage || "").trim().slice(0, 2000);
  }

  // Filtro de leads: se resuelve al LANZAR (selectLeadsFromMap), no al crear,
  // para tomar los leads frescos. Se guarda en la campaña.
  if (input.leadFilter !== undefined || !forUpdate) {
    const f = input.leadFilter || {};
    out.leadFilter = {
      country: f.country ? String(f.country).trim() : "",
      setterId: f.setterId ? String(f.setterId).trim() : "",
      estado: f.estado ? String(f.estado).trim() : "",
      limit: clampInt(f.limit, 1, 5000, 100),
    };
  }

  if (input.dailyCapPerAccount !== undefined) {
    out.dailyCapPerAccount = input.dailyCapPerAccount == null ? null : clampInt(input.dailyCapPerAccount, 1, 2000, null);
  } else if (!forUpdate) {
    out.dailyCapPerAccount = null;
  }

  if (input.cancelOnReply !== undefined) out.cancelOnReply = input.cancelOnReply !== false;
  else if (!forUpdate) out.cancelOnReply = true;

  return [null, out];
}

// ── CRUD campañas ───────────────────────────────────────────────────────────
export function listCampaigns() {
  return load().campaigns;
}

export function getCampaign(id) {
  return load().campaigns.find((c) => c.id === id) || null;
}

export function createCampaign(input, setterId = "") {
  const [err, clean] = sanitizeCampaign(input);
  if (err) return [err];
  const data = load();
  const campaign = {
    id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: "draft",
    setterId: String(setterId || ""),
    ...clean,
    startedAt: null,
    lastDripAt: null,
    stats: { queued: 0, sent: 0, replied: 0, qualified: 0, noReply: 0, disqualified: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.campaigns.push(campaign);
  if (!data.leadStates[campaign.id]) data.leadStates[campaign.id] = {};
  save(data);
  return [null, campaign];
}

export function updateCampaign(id, patch) {
  const data = load();
  const idx = data.campaigns.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  data.campaigns[idx] = { ...data.campaigns[idx], ...patch, updatedAt: new Date().toISOString() };
  save(data);
  return data.campaigns[idx];
}

export function deleteCampaign(id) {
  const data = load();
  const before = data.campaigns.length;
  data.campaigns = data.campaigns.filter((c) => c.id !== id);
  delete data.leadStates[id];
  save(data);
  return before !== data.campaigns.length;
}

// ── Estado por lead ───────────────────────────────────────────────────────
export function listLeadStates(campaignId) {
  return load().leadStates[campaignId] || {};
}

export function getLeadState(campaignId, leadId) {
  return load().leadStates[campaignId]?.[leadId] || null;
}

export function setLeadState(campaignId, leadId, patch) {
  const data = load();
  if (!data.leadStates[campaignId]) data.leadStates[campaignId] = {};
  const prev = data.leadStates[campaignId][leadId] || {};
  data.leadStates[campaignId][leadId] = { ...prev, ...patch };
  save(data);
  return data.leadStates[campaignId][leadId];
}

// Inicializa N leadStates de una vez (al lanzar). entries: [{leadId, variantId, accountId}]
export function bulkInitLeadStates(campaignId, entries) {
  const data = load();
  if (!data.leadStates[campaignId]) data.leadStates[campaignId] = {};
  const now = new Date().toISOString();
  for (const e of entries) {
    data.leadStates[campaignId][e.leadId] = {
      state: "queued",
      variantId: e.variantId,
      accountId: e.accountId,
      blockIdx: 0,
      bumpIdx: 0,
      nextActionAt: null,
      lastSentAt: null,
      repliedAt: null,
      history: [],
      queuedAt: now,
    };
  }
  save(data);
  return Object.keys(data.leadStates[campaignId]).length;
}

// Resumen de conteos por estado (para la UI).
export function leadStateSummary(campaignId) {
  const states = load().leadStates[campaignId] || {};
  const summary = {};
  for (const ls of Object.values(states)) {
    summary[ls.state] = (summary[ls.state] || 0) + 1;
  }
  return summary;
}

// ── Helpers de negocio ──────────────────────────────────────────────────────
// Reparte leads entre variantes del split por round-robin ponderado.
// Devuelve un array de variantIds del mismo largo que `count`.
export function buildVariantAssignments(variantSplit, count) {
  const expanded = [];
  for (const s of variantSplit) {
    for (let i = 0; i < (s.weight || 1); i++) expanded.push(s.variantId);
  }
  if (expanded.length === 0) return [];
  const out = [];
  for (let i = 0; i < count; i++) out.push(expanded[i % expanded.length]);
  return out;
}

// Selección de leads para una campaña. PURA: recibe el map de leads
// (settersData.leads es un MAP keyed por id, NO array) y un filtro, devuelve
// array de leadIds. Excluye sin-teléfono, descartados y agendados.
// filter: { country, setterId, estado, limit }
export function selectLeadsFromMap(leadsMap, filter = {}) {
  const { country, setterId, estado, limit } = filter;
  const out = [];
  const wantCountry = country ? String(country).toLowerCase() : null;
  for (const [id, lead] of Object.entries(leadsMap || {})) {
    if (!lead) continue;
    const phone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp;
    if (!phone) continue; // sin teléfono no sirve
    if (lead.estado === "descartado" || lead.estado === "agendado") continue;
    if (lead.descartado === true) continue;
    if (wantCountry && String(lead.country || lead.pais || "").toLowerCase() !== wantCountry) continue;
    if (setterId && lead.assignedTo !== setterId) continue;
    if (estado && lead.estado !== estado) continue;
    out.push(id);
    if (limit && out.length >= limit) break;
  }
  return out;
}

// Delay random entre min y max (para los bloques del opener).
export function randomBlockDelay(blockDelay) {
  const { minMs, maxMs } = blockDelay || { minMs: 60000, maxMs: 180000 };
  return Math.floor(minMs + Math.random() * Math.max(0, maxMs - minMs));
}

// Para el export/pre-deploy: dump completo del archivo.
export function exportCampaignsData() {
  return load();
}
