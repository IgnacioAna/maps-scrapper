/**
 * orchestrator.js
 *
 * Loop principal del warming network. Cada N segundos:
 *   1. Llena pares faltantes (pairing.fillPairs)
 *   2. Recorre todos los pares activos
 *   3. Para cada uno, evalúa el estado y dispara acción si toca:
 *      - PENDING_FIRST → genera primer msg → encola para enviar
 *      - WAITING_REPLY_X → si pasó suficiente tiempo, transiciona a READY_X
 *      - READY_X_TO_Y → genera msg → encola para enviar (queda WAITING_REPLY_Y)
 *
 * El orchestrator NO manda directamente: emite eventos socket
 * "warming:send-message" al wa-multi de la cuenta dueña, que es la que
 * realmente ejecuta el envío. Cuando llega el inbound del otro lado,
 * el server actualiza el par y agenda el próximo turn.
 */

import * as store from "./store.js";
import * as pairing from "./pairing.js";
import * as schedule from "./schedule.js";

let _orchestratorTimer = null;
let _running = false;
let _llmGenerateMessage = null; // inyectado en init() — depende de Wave 3
let _wsEmit = null; // inyectado: función para mandar al wa-multi del setter dueño
let _isUserOnline = null; // inyectado: presence check (userId) => boolean
let _logger = console; // pluggable

// Diagnóstico: último motivo por par. Permite que el panel muestre por qué
// un par no avanza ("setter offline", "esperando reply natural", etc.)
const _diagnostics = new Map(); // pairId → { lastTickAt, lastReason, lastError }

const TICK_INTERVAL_MS = 60 * 1000; // cada 60s
const MAX_PAIRS_GLOBAL = 200; // safety
const ZOMBIE_PAIR_DAYS = 7; // pares sin actividad >7d se cierran

/**
 * Inicializa el orchestrator.
 * @param {object} opts
 * @param {function} opts.llmGenerateMessage - async (pair, sender, receiver) => string
 * @param {function} opts.wsEmit - (userId, eventName, payload) => void
 * @param {function} opts.isUserOnline - (userId) => boolean — presence check
 */
export function initOrchestrator({ llmGenerateMessage, wsEmit, isUserOnline, logger }) {
  _llmGenerateMessage = llmGenerateMessage;
  _wsEmit = wsEmit;
  _isUserOnline = isUserOnline;
  if (logger) _logger = logger;
}

function setDiagnostic(pairId, reason, extra = {}) {
  _diagnostics.set(pairId, {
    lastTickAt: new Date().toISOString(),
    lastReason: reason,
    ...extra,
  });
}

export function getDiagnostic(pairId) {
  return _diagnostics.get(pairId) || null;
}

export function getAllDiagnostics() {
  const out = {};
  for (const [k, v] of _diagnostics.entries()) out[k] = v;
  return out;
}

/**
 * Arranca el loop. Llamar al final del boot del server.
 */
export function startOrchestrator() {
  if (_orchestratorTimer) return;
  _logger.log("[warming-orch] iniciando loop, tick cada", TICK_INTERVAL_MS / 1000, "s");
  _orchestratorTimer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  // Primer tick inmediato (después de un delay corto para no chocar con boot)
  setTimeout(() => void tick(), 5000);
}

export function stopOrchestrator() {
  if (_orchestratorTimer) {
    clearInterval(_orchestratorTimer);
    _orchestratorTimer = null;
  }
}

/**
 * Un tick del orchestrator. Idempotente, seguro de re-entrar.
 */
export async function tick() {
  if (_running) return; // no concurrent ticks
  _running = true;
  try {
    // 1. Llenar pares faltantes
    const created = pairing.fillPairs();
    if (created.length > 0) {
      _logger.log("[warming-orch] tick: pares creados", created.length);
    }

    // 2. Procesar cada par activo
    const pairs = store.listActivePairs();
    if (pairs.length > MAX_PAIRS_GLOBAL) {
      _logger.warn("[warming-orch] hay", pairs.length, "pares activos > MAX_PAIRS_GLOBAL");
    }

    const now = new Date();
    let processed = 0;
    for (const pair of pairs) {
      try {
        const acted = await processPair(pair, now);
        if (acted) processed++;
      } catch (err) {
        _logger.error("[warming-orch] error procesando par", pair.id, err);
      }
    }
    if (processed > 0) {
      _logger.log(`[warming-orch] tick: ${processed}/${pairs.length} pares procesados`);
    }
  } catch (err) {
    _logger.error("[warming-orch] tick error global:", err);
  } finally {
    _running = false;
  }
}

/**
 * Evalúa el estado de un par y ejecuta la acción correspondiente si toca.
 * Devuelve true si actuó, false si no.
 */
async function processPair(pair, now, { forceImmediate = false } = {}) {
  // Health check: si el par no tuvo actividad en >7 días, cerrarlo
  if (pair.lastMessageAt) {
    const ageDays = (now.getTime() - new Date(pair.lastMessageAt).getTime()) / (24 * 3600 * 1000);
    if (ageDays > ZOMBIE_PAIR_DAYS) {
      store.updatePair(pair.id, { state: "CLOSED" });
      setDiagnostic(pair.id, "ZOMBIE_CLOSED", { ageDays: Math.floor(ageDays) });
      _logger.log(`[warming-orch] par ${pair.id} cerrado: zombie >${ZOMBIE_PAIR_DAYS}d sin actividad`);
      return true;
    }
  }

  // Si nextActionAt está en el futuro, no toca todavía (excepto en forceImmediate)
  if (!forceImmediate && pair.nextActionAt && new Date(pair.nextActionAt) > now) {
    setDiagnostic(pair.id, "WAITING_SCHEDULED", { nextActionAt: pair.nextActionAt });
    return false;
  }

  // Resolver miembros del pool
  const memberA = store.getPoolMember(pair.accountA);
  const memberB = store.getPoolMember(pair.accountB);
  if (!memberA || !memberB) {
    store.updatePair(pair.id, { state: "CLOSED" });
    setDiagnostic(pair.id, "MEMBER_LEFT_POOL");
    _logger.log("[warming-orch] par", pair.id, "cerrado: miembro fuera del pool");
    return true;
  }

  if (!memberA.active || !memberB.active) {
    const next = new Date(now.getTime() + 60 * 60 * 1000);
    store.updatePair(pair.id, { state: "PAUSED", nextActionAt: next.toISOString() });
    setDiagnostic(pair.id, "MEMBER_PAUSED", { who: !memberA.active ? "A" : "B" });
    return true;
  }

  // Estados que requieren generar y mandar mensaje
  const sendStates = ["PENDING_FIRST", "READY_A_TO_B", "READY_B_TO_A"];
  if (!sendStates.includes(pair.state)) {
    // Estado de espera — chequear si pasó suficiente tiempo para promover
    return promoteIfReady(pair, memberA, memberB, now);
  }

  // Determinar quién manda
  let senderId, receiverId, senderMember, receiverMember, senderTurnLetter, nextWaitingState;
  if (pair.state === "PENDING_FIRST" || pair.state === "READY_A_TO_B") {
    senderId = pair.accountA;
    receiverId = pair.accountB;
    senderMember = memberA;
    receiverMember = memberB;
    senderTurnLetter = "A";
    nextWaitingState = "WAITING_REPLY_B";
  } else {
    senderId = pair.accountB;
    receiverId = pair.accountA;
    senderMember = memberB;
    receiverMember = memberA;
    senderTurnLetter = "B";
    nextWaitingState = "WAITING_REPLY_A";
  }

  // CRÍTICO: chequear que el setter dueño del SENDER esté online ANTES de
  // intentar generar el mensaje. Si no, marcamos PAUSED_OFFLINE y esperamos
  // a que vuelva. Evita el bug de "mensajes que se pierden en silencio".
  if (_isUserOnline && senderMember.setterId) {
    const online = _isUserOnline(senderMember.setterId);
    if (!online) {
      // Re-check en 5 min (cuando el setter se reconecta, onUserOnline()
      // explícitamente llama tickPair para no esperar)
      const retry = new Date(now.getTime() + 5 * 60 * 1000);
      store.updatePair(pair.id, { state: "PAUSED_OFFLINE", nextActionAt: retry.toISOString() });
      setDiagnostic(pair.id, "SETTER_OFFLINE", {
        setterId: senderMember.setterId,
        senderAccountId: senderMember.accountId,
      });
      return true;
    }
  }

  // Generar mensaje via LLM
  if (!_llmGenerateMessage) {
    _logger.warn("[warming-orch] LLM no configurado, salteando par", pair.id);
    setDiagnostic(pair.id, "LLM_NOT_CONFIGURED");
    return false;
  }
  let llmResult;
  try {
    llmResult = await _llmGenerateMessage(pair, senderMember.persona, receiverMember.persona);
  } catch (err) {
    _logger.error("[warming-orch] LLM error en par", pair.id, ":", err.message);
    const retry = new Date(now.getTime() + 5 * 60 * 1000);
    store.updatePair(pair.id, { nextActionAt: retry.toISOString() });
    setDiagnostic(pair.id, "LLM_ERROR", { error: err.message });
    return true;
  }

  // llmResult es { text, llmCost, llmModel, tokensIn, tokensOut } (refactor 2026-05-03)
  // Backward-compat: si por alguna razón llega un string plano, lo wrappeamos
  let messageText, llmCost = 0, llmModel = null;
  if (typeof llmResult === "string") {
    messageText = llmResult.trim();
  } else if (llmResult && typeof llmResult === "object") {
    messageText = String(llmResult.text || "").trim();
    llmCost = llmResult.llmCost || 0;
    llmModel = llmResult.llmModel || null;
  } else {
    messageText = "";
  }

  if (!messageText) {
    _logger.warn("[warming-orch] LLM devolvió vacío en par", pair.id);
    const retry = new Date(now.getTime() + 5 * 60 * 1000);
    store.updatePair(pair.id, { nextActionAt: retry.toISOString() });
    setDiagnostic(pair.id, "LLM_EMPTY_RESPONSE");
    return true;
  }

  // Encolar envío via wa-multi
  if (!_wsEmit) {
    _logger.warn("[warming-orch] wsEmit no configurado, no se puede enviar");
    return false;
  }

  // El targetPhone es el accountId del receiver (wa-multi resuelve a teléfono real)
  // Necesitamos saber el setterId / userId dueño del sender para emitir el comando
  const senderSetterId = senderMember.setterId; // puede ser null si es del admin
  // El emit lo hace el route cuando recibe la petición; acá pasamos los datos.

  // Persistir el mensaje en history
  store.appendToHistory(pair.id, {
    from: senderTurnLetter,
    text: messageText,
    at: now.toISOString(),
  });

  // Audit log
  store.logSentMessage({
    pairId: pair.id,
    fromAccount: senderId,
    toAccount: receiverId,
    text: messageText,
    llmCost,
    llmModel,
  });

  // Emitir socket event con el envío real
  _wsEmit({
    setterId: senderSetterId,
    senderAccountId: senderId,
    receiverAccountId: receiverId,
    text: messageText,
    pairId: pair.id,
  });

  // Schedule próxima acción: la otra cuenta debería responder
  // Modo normal: usa replySpeed humano (30-480 min para "lento")
  // Modo forceImmediate (botón Tick ya): 10-30 SEG para que el test sea
  // fluido y se puedan ver conversaciones completas en minutos, no días.
  let nextAt;
  if (forceImmediate) {
    const secs = 10 + Math.floor(Math.random() * 20);
    nextAt = new Date(now.getTime() + secs * 1000);
  } else {
    nextAt = schedule.computeNextActionAt(receiverMember.persona, pair, now);
  }
  store.updatePair(pair.id, {
    state: nextWaitingState,
    turn: senderTurnLetter === "A" ? "B" : "A",
    nextActionAt: nextAt.toISOString(),
  });

  setDiagnostic(pair.id, "SENT", {
    sender: senderMember.persona.name,
    receiver: receiverMember.persona.name,
    preview: messageText.slice(0, 80),
    nextActionAt: nextAt.toISOString(),
  });
  _logger.log(
    `[warming-orch] sent: ${senderMember.persona.name} → ${receiverMember.persona.name}: "${messageText.slice(0, 60)}${messageText.length > 60 ? "..." : ""}"`,
  );
  return true;
}

/**
 * Forzar el procesamiento inmediato de UN par específico, ignorando
 * nextActionAt. Usado por el endpoint /api/wa/warming-network/tick-pair/:id
 * para debugging y por onUserCameOnline() cuando un setter se reconecta.
 *
 * CRÍTICO (fix 2026-05-03): forceImmediate ahora también:
 *   1. Resetea nextActionAt a now ANTES de processPair (sino el check
 *      `nextActionAt > now` rechaza el procesamiento).
 *   2. Si el par está en WAITING_REPLY_*, lo promueve a READY_*_TO_* SIN
 *      esperar al delay humano. Para test, queremos ver el siguiente
 *      mensaje YA, no en 8 horas.
 *   3. Modo "test" (forceImmediate=true): el siguiente nextActionAt de
 *      respuesta del receiver se calcula con 10-30 SEGUNDOS (en vez de
 *      30-480 minutos del replySpeed humano). Permite que el user vea
 *      conversación fluida en seguidos en 1-2 min, no en 1 día.
 */
export async function tickSpecificPair(pairId, { forceImmediate = false } = {}) {
  const pair = store.getPair(pairId);
  if (!pair) return { ok: false, reason: "par no encontrado" };
  if (pair.state === "CLOSED") return { ok: false, reason: "par cerrado" };

  // Fix 1: si force, resetear nextActionAt para que ningun check lo rechace
  if (forceImmediate && pair.nextActionAt && new Date(pair.nextActionAt) > new Date()) {
    store.updatePair(pairId, { nextActionAt: new Date().toISOString() });
  }

  // Fix 2: si force + state WAITING/PAUSED, promover a READY antes de procesar
  if (
    forceImmediate &&
    (pair.state === "WAITING_REPLY_A" ||
      pair.state === "WAITING_REPLY_B" ||
      pair.state === "PAUSED" ||
      pair.state === "PAUSED_OFFLINE")
  ) {
    let newState;
    if (pair.state === "WAITING_REPLY_A" || (pair.history.length > 0 && pair.history[pair.history.length - 1].from === "B")) {
      newState = "READY_A_TO_B";
    } else if (pair.state === "WAITING_REPLY_B" || (pair.history.length > 0 && pair.history[pair.history.length - 1].from === "A")) {
      newState = "READY_B_TO_A";
    } else {
      newState = pair.history.length === 0 ? "PENDING_FIRST" : "READY_A_TO_B";
    }
    store.updatePair(pairId, { state: newState, nextActionAt: new Date().toISOString() });
  }

  try {
    // Iterar hasta 2 veces si forceImmediate, así un par que estaba en
    // PAUSED/WAITING se promueva en el primer pase y mande en el segundo.
    // Sin esto, el botón "Tick ya" solo hacía promote y no llegaba a send.
    let acted = await processPair(store.getPair(pairId), new Date(), { forceImmediate });
    if (forceImmediate) {
      const updated = store.getPair(pairId);
      if (updated && (updated.state.startsWith("READY_") || updated.state === "PENDING_FIRST")) {
        // Quedó listo para mandar, hacer segunda pasada
        acted = (await processPair(updated, new Date(), { forceImmediate })) || acted;
      }
    }
    return { ok: true, acted, diagnostic: getDiagnostic(pairId) };
  } catch (err) {
    return { ok: false, reason: "exception", error: String(err) };
  }
}

/**
 * Llamado por gateway.js cuando un setter se conecta al socket. Busca
 * sus pares en PAUSED_OFFLINE y los reactiva con un tick inmediato.
 */
export async function onUserCameOnline(userId) {
  const pool = store.listPool();
  const accountsOfUser = pool.filter((m) => m.setterId === userId).map((m) => m.accountId);
  if (accountsOfUser.length === 0) return;
  const allPairs = store.listActivePairs();
  const myPairs = allPairs.filter(
    (p) =>
      (accountsOfUser.includes(p.accountA) || accountsOfUser.includes(p.accountB)) &&
      p.state === "PAUSED_OFFLINE",
  );
  if (myPairs.length === 0) return;
  _logger.log(`[warming-orch] setter ${userId} volvió online, reactivando ${myPairs.length} pares`);
  for (const pair of myPairs) {
    // Resetear al estado anterior basado en turn (READY_A_TO_B o READY_B_TO_A)
    const newState = pair.turn === "A" ? "READY_A_TO_B" : "READY_B_TO_A";
    if (pair.history.length === 0) {
      store.updatePair(pair.id, { state: "PENDING_FIRST", nextActionAt: new Date().toISOString() });
    } else {
      store.updatePair(pair.id, { state: newState, nextActionAt: new Date().toISOString() });
    }
    // Trigger inmediato (no espera al próximo tick de 60s)
    setTimeout(() => void tickSpecificPair(pair.id, { forceImmediate: true }), 1000);
  }
}

/**
 * Si pasó suficiente tiempo desde el último mensaje, transiciona el par a READY.
 */
function promoteIfReady(pair, memberA, memberB, now) {
  if (pair.state === "WAITING_REPLY_A") {
    if (!pair.nextActionAt || new Date(pair.nextActionAt) <= now) {
      // Promover a READY y agendar para AHORA (que el próximo tick lo procese)
      store.updatePair(pair.id, { state: "READY_A_TO_B", nextActionAt: now.toISOString() });
      setDiagnostic(pair.id, "PROMOTED_TO_READY", { who: "A" });
      return true;
    }
    setDiagnostic(pair.id, "WAITING_REPLY_A", { nextActionAt: pair.nextActionAt });
  } else if (pair.state === "WAITING_REPLY_B") {
    if (!pair.nextActionAt || new Date(pair.nextActionAt) <= now) {
      store.updatePair(pair.id, { state: "READY_B_TO_A", nextActionAt: now.toISOString() });
      setDiagnostic(pair.id, "PROMOTED_TO_READY", { who: "B" });
      return true;
    }
    setDiagnostic(pair.id, "WAITING_REPLY_B", { nextActionAt: pair.nextActionAt });
  } else if (pair.state === "PAUSED" || pair.state === "PAUSED_OFFLINE") {
    if (memberA.active && memberB.active) {
      const nextAt = new Date(now.getTime() + 30 * 1000);
      // Si tiene historial, decidir turn por último mensaje. Si no, A arranca.
      const lastFrom = pair.history.length > 0 ? pair.history[pair.history.length - 1].from : null;
      const newState = lastFrom === "A" ? "READY_B_TO_A" : (pair.history.length === 0 ? "PENDING_FIRST" : "READY_A_TO_B");
      store.updatePair(pair.id, { state: newState, nextActionAt: nextAt.toISOString() });
      setDiagnostic(pair.id, "RESUMED_FROM_PAUSE");
      return true;
    }
  }
  return false;
}

/**
 * Llamado cuando llega un mensaje real del lado receptor (vía wa-multi inbound).
 * Actualiza el estado del par para que el orchestrator no genere otro mensaje
 * mientras la otra cuenta procesa.
 */
export function onWarmingInboundReceived({ pairId, fromAccountId, text }) {
  const pair = store.getPair(pairId);
  if (!pair) return null;

  // Identificar si es A o B
  const fromLetter = fromAccountId === pair.accountA ? "A" : "B";
  store.appendToHistory(pairId, {
    from: fromLetter,
    text: String(text || "").slice(0, 500),
    at: new Date().toISOString(),
    inbound: true,
  });
  // El estado debería estar en WAITING_REPLY_<otro> — promover a READY_<otro>_TO_<from>
  // … pero solo si viene en orden correcto. Si llegó "double" (dos seguidos de A),
  // mantenemos el flujo: el otro lado responde cuando le toca.

  return store.getPair(pairId);
}
