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
let _logger = console; // pluggable

const TICK_INTERVAL_MS = 60 * 1000; // cada 60s
const MAX_PAIRS_GLOBAL = 200; // safety

/**
 * Inicializa el orchestrator.
 * @param {object} opts
 * @param {function} opts.llmGenerateMessage - async (pair, sender, receiver) => string
 * @param {function} opts.wsEmit - (userId, eventName, payload) => void
 */
export function initOrchestrator({ llmGenerateMessage, wsEmit, logger }) {
  _llmGenerateMessage = llmGenerateMessage;
  _wsEmit = wsEmit;
  if (logger) _logger = logger;
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
async function processPair(pair, now) {
  // Si nextActionAt está en el futuro, no toca todavía
  if (pair.nextActionAt && new Date(pair.nextActionAt) > now) {
    return false;
  }

  // Resolver miembros del pool
  const memberA = store.getPoolMember(pair.accountA);
  const memberB = store.getPoolMember(pair.accountB);
  if (!memberA || !memberB) {
    // Alguno salió del pool — cerrar par
    store.updatePair(pair.id, { state: "CLOSED" });
    _logger.log("[warming-orch] par", pair.id, "cerrado: miembro fuera del pool");
    return true;
  }

  if (!memberA.active || !memberB.active) {
    // Pausar el par — re-evaluar después
    const next = new Date(now.getTime() + 60 * 60 * 1000); // re-check en 1h
    store.updatePair(pair.id, { state: "PAUSED", nextActionAt: next.toISOString() });
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

  // Generar mensaje via LLM
  if (!_llmGenerateMessage) {
    _logger.warn("[warming-orch] LLM no configurado, salteando par", pair.id);
    return false;
  }
  let message;
  try {
    message = await _llmGenerateMessage(pair, senderMember.persona, receiverMember.persona);
  } catch (err) {
    _logger.error("[warming-orch] LLM error en par", pair.id, ":", err.message);
    // Reintentar en 30 minutos
    const retry = new Date(now.getTime() + 30 * 60 * 1000);
    store.updatePair(pair.id, { nextActionAt: retry.toISOString() });
    return true;
  }

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    _logger.warn("[warming-orch] LLM devolvió vacío en par", pair.id);
    const retry = new Date(now.getTime() + 30 * 60 * 1000);
    store.updatePair(pair.id, { nextActionAt: retry.toISOString() });
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
    text: message.trim(),
    at: now.toISOString(),
  });

  // Audit log
  const llmCost = message._llmCost || 0;
  const llmModel = message._llmModel || null;
  store.logSentMessage({
    pairId: pair.id,
    fromAccount: senderId,
    toAccount: receiverId,
    text: message.trim(),
    llmCost,
    llmModel,
  });

  // Emitir socket event con el envío real
  _wsEmit({
    setterId: senderSetterId,
    senderAccountId: senderId,
    receiverAccountId: receiverId,
    text: message.trim(),
    pairId: pair.id,
  });

  // Schedule próxima acción: la otra cuenta debería responder
  // Usamos la velocidad de respuesta del receiver para estimar cuándo
  const nextAt = schedule.computeNextActionAt(receiverMember.persona, pair, now);
  store.updatePair(pair.id, {
    state: nextWaitingState,
    turn: senderTurnLetter === "A" ? "B" : "A",
    nextActionAt: nextAt.toISOString(),
  });

  _logger.log(
    `[warming-orch] sent: ${senderMember.persona.name} → ${receiverMember.persona.name}: "${message.trim().slice(0, 60)}${message.length > 60 ? "..." : ""}"`,
  );
  return true;
}

/**
 * Si pasó suficiente tiempo desde el último mensaje, transiciona el par a READY.
 */
function promoteIfReady(pair, memberA, memberB, now) {
  if (pair.state === "WAITING_REPLY_A") {
    // A debería responder. ¿Pasó el delay esperado por su persona?
    if (!pair.nextActionAt || new Date(pair.nextActionAt) <= now) {
      const nextAt = schedule.computeNextActionAt(memberA.persona, pair, now);
      store.updatePair(pair.id, { state: "READY_A_TO_B", nextActionAt: nextAt.toISOString() });
      return true;
    }
  } else if (pair.state === "WAITING_REPLY_B") {
    if (!pair.nextActionAt || new Date(pair.nextActionAt) <= now) {
      const nextAt = schedule.computeNextActionAt(memberB.persona, pair, now);
      store.updatePair(pair.id, { state: "READY_B_TO_A", nextActionAt: nextAt.toISOString() });
      return true;
    }
  } else if (pair.state === "PAUSED") {
    // Re-evaluar si ambos están active de nuevo
    if (memberA.active && memberB.active) {
      const nextAt = new Date(now.getTime() + 5 * 60 * 1000); // arranca en 5min
      store.updatePair(pair.id, { state: "WAITING_REPLY_A", nextActionAt: nextAt.toISOString() });
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
