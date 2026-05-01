/**
 * store.js
 *
 * Persistencia del warming network. Usa el mismo patrón JSON-file que el
 * resto de GoogleSrapper (compatible con Railway Volume en /data).
 *
 * Estructura de data/warming-network.json:
 * {
 *   pool: [
 *     {
 *       accountId: string,
 *       setterId: string | null,        // dueño (para enforcing cross-setter)
 *       enrolledAt: ISO date string,
 *       persona: { ...personaFor(accountId) },  // snapshot al inscribir
 *       active: boolean,                // false = pausado temporal
 *       pausedReason: string | null,    // 'banned' | 'manual' | 'low-delivery'
 *       lastActivityAt: ISO | null,
 *     }
 *   ],
 *   pairs: [
 *     {
 *       id: string,                     // 'pair_<uuidish>'
 *       accountA: string,               // accountId
 *       accountB: string,               // accountId (cross-setter)
 *       createdAt: ISO,
 *       lastMessageAt: ISO | null,
 *       messageCount: number,
 *       state: 'PENDING_FIRST' | 'WAITING_REPLY_A' | 'WAITING_REPLY_B' |
 *              'READY_A_TO_B' | 'READY_B_TO_A' | 'PAUSED' | 'CLOSED',
 *       turn: 'A' | 'B',                // de quién es el turno de mandar
 *       nextActionAt: ISO | null,       // cuándo el orchestrator debe procesar este par
 *       history: [                       // últimos N mensajes (cap 50)
 *         { from: 'A'|'B', text: string, at: ISO }
 *       ],
 *     }
 *   ],
 *   sentMessages: [                      // log auditable, FIFO cap 5000
 *     { id, pairId, fromAccount, toAccount, text, sentAt, llmCost, llmModel }
 *   ],
 *   stats: {
 *     totalMessagesSent: number,
 *     totalLLMCostUsd: number,
 *     lastResetMonth: 'YYYY-MM',
 *   }
 * }
 */

import fs from "node:fs";
import path from "node:path";

let DATA_DIR_REF = null;

const HISTORY_CAP_PER_PAIR = 50;
const SENT_MESSAGES_CAP = 5000;

function getFilePath() {
  if (!DATA_DIR_REF) throw new Error("warming-network store: DATA_DIR no configurado todavía. Llamá initWarmingStore(dataDir) en el boot.");
  return path.join(DATA_DIR_REF, "warming-network.json");
}

function defaultData() {
  return {
    pool: [],
    pairs: [],
    sentMessages: [],
    stats: {
      totalMessagesSent: 0,
      totalLLMCostUsd: 0,
      lastResetMonth: new Date().toISOString().slice(0, 7),
    },
  };
}

function loadData() {
  try {
    const raw = fs.readFileSync(getFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    // Backfill structures faltantes (si el archivo es de una versión vieja)
    return {
      pool: Array.isArray(parsed.pool) ? parsed.pool : [],
      pairs: Array.isArray(parsed.pairs) ? parsed.pairs : [],
      sentMessages: Array.isArray(parsed.sentMessages) ? parsed.sentMessages : [],
      stats: parsed.stats || defaultData().stats,
    };
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(getFilePath(), JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[warming-network] saveData error:", err);
  }
}

// ===== INIT =====

/**
 * Configura el directorio de data. Llamar una vez al boot del server.
 * @param {string} dataDir
 */
export function initWarmingStore(dataDir) {
  DATA_DIR_REF = dataDir;
  // Crear archivo si no existe
  const filePath = getFilePath();
  if (!fs.existsSync(filePath)) {
    saveData(defaultData());
    console.log("[warming-network] archivo creado en", filePath);
  }
}

// ===== POOL =====

export function listPool() {
  return loadData().pool;
}

export function getPoolMember(accountId) {
  return loadData().pool.find((p) => p.accountId === accountId);
}

export function enrollAccount({ accountId, setterId, persona }) {
  const data = loadData();
  if (data.pool.find((p) => p.accountId === accountId)) {
    return { ok: false, reason: "ya inscripta" };
  }
  data.pool.push({
    accountId,
    setterId: setterId || null,
    enrolledAt: new Date().toISOString(),
    persona,
    active: true,
    pausedReason: null,
    lastActivityAt: null,
  });
  saveData(data);
  return { ok: true };
}

export function unenrollAccount(accountId) {
  const data = loadData();
  data.pool = data.pool.filter((p) => p.accountId !== accountId);
  // También cerramos pares activos donde participe
  data.pairs = data.pairs.map((pair) => {
    if (pair.accountA === accountId || pair.accountB === accountId) {
      return { ...pair, state: "CLOSED" };
    }
    return pair;
  });
  saveData(data);
  return { ok: true };
}

export function pauseAccount(accountId, reason) {
  const data = loadData();
  const member = data.pool.find((p) => p.accountId === accountId);
  if (!member) return { ok: false, reason: "no en pool" };
  member.active = false;
  member.pausedReason = reason || "manual";
  saveData(data);
  return { ok: true };
}

export function resumeAccount(accountId) {
  const data = loadData();
  const member = data.pool.find((p) => p.accountId === accountId);
  if (!member) return { ok: false, reason: "no en pool" };
  member.active = true;
  member.pausedReason = null;
  saveData(data);
  return { ok: true };
}

// ===== PAIRS =====

export function listPairs() {
  return loadData().pairs;
}

export function listActivePairs() {
  return loadData().pairs.filter((p) => p.state !== "CLOSED");
}

export function listPairsForAccount(accountId) {
  return loadData().pairs.filter(
    (p) => (p.accountA === accountId || p.accountB === accountId) && p.state !== "CLOSED",
  );
}

export function getPair(pairId) {
  return loadData().pairs.find((p) => p.id === pairId);
}

export function createPair({ accountA, accountB }) {
  const data = loadData();
  // Anti-incest: chequear si ya existe (en cualquier orden)
  const existing = data.pairs.find(
    (p) =>
      p.state !== "CLOSED" &&
      ((p.accountA === accountA && p.accountB === accountB) ||
        (p.accountA === accountB && p.accountB === accountA)),
  );
  if (existing) return { ok: false, reason: "par ya existe", pair: existing };

  const pair = {
    id: `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    accountA,
    accountB,
    createdAt: new Date().toISOString(),
    lastMessageAt: null,
    messageCount: 0,
    state: "PENDING_FIRST",
    turn: "A",
    nextActionAt: new Date().toISOString(), // listo para procesarse
    history: [],
  };
  data.pairs.push(pair);
  saveData(data);
  return { ok: true, pair };
}

export function updatePair(pairId, patch) {
  const data = loadData();
  const idx = data.pairs.findIndex((p) => p.id === pairId);
  if (idx === -1) return null;
  data.pairs[idx] = { ...data.pairs[idx], ...patch };
  saveData(data);
  return data.pairs[idx];
}

export function appendToHistory(pairId, entry) {
  const data = loadData();
  const pair = data.pairs.find((p) => p.id === pairId);
  if (!pair) return null;
  pair.history.push({ ...entry, at: entry.at || new Date().toISOString() });
  // Cap
  if (pair.history.length > HISTORY_CAP_PER_PAIR) {
    pair.history = pair.history.slice(-HISTORY_CAP_PER_PAIR);
  }
  pair.lastMessageAt = entry.at || new Date().toISOString();
  pair.messageCount = (pair.messageCount || 0) + 1;
  saveData(data);
  return pair;
}

// ===== SENT MESSAGES (audit log) =====

export function logSentMessage({ pairId, fromAccount, toAccount, text, llmCost, llmModel }) {
  const data = loadData();
  const entry = {
    id: `wmsg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    pairId,
    fromAccount,
    toAccount,
    text,
    sentAt: new Date().toISOString(),
    llmCost: llmCost || 0,
    llmModel: llmModel || null,
  };
  data.sentMessages.push(entry);
  // Cap FIFO
  if (data.sentMessages.length > SENT_MESSAGES_CAP) {
    data.sentMessages = data.sentMessages.slice(-SENT_MESSAGES_CAP);
  }
  // Stats
  data.stats.totalMessagesSent = (data.stats.totalMessagesSent || 0) + 1;
  data.stats.totalLLMCostUsd = (data.stats.totalLLMCostUsd || 0) + (llmCost || 0);
  saveData(data);
  return entry;
}

export function getStats() {
  return loadData().stats;
}

export function listRecentSentMessages({ limit = 50, accountId, pairId } = {}) {
  let msgs = loadData().sentMessages;
  if (accountId) msgs = msgs.filter((m) => m.fromAccount === accountId || m.toAccount === accountId);
  if (pairId) msgs = msgs.filter((m) => m.pairId === pairId);
  return msgs.slice(-limit).reverse(); // último primero
}

// Reset mensual de stats de costo (no toca los messages, solo el contador)
export function maybeResetMonthlyStats() {
  const data = loadData();
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (data.stats.lastResetMonth !== currentMonth) {
    data.stats.totalLLMCostUsd = 0;
    data.stats.lastResetMonth = currentMonth;
    saveData(data);
    return true;
  }
  return false;
}
