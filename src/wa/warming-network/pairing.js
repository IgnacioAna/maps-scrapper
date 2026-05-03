/**
 * pairing.js
 *
 * Decide qué cuentas del pool van a chatear entre sí.
 *
 * Reglas (ver PLAN.md A2):
 *   - Cross-setter ONLY: una cuenta nunca chatea con otra del MISMO setter.
 *   - Anti-incest temporal: una cuenta no chatea con la misma cuenta más
 *     de N pares activos (default 1) o más de M veces por semana.
 *   - Fairness: cuentas con menos pares activos tienen prioridad para
 *     ser pareadas (evita que las "viejas" del pool acaparen interlocutores).
 *
 * El pairing engine se ejecuta periódicamente (cada N minutos, o on-demand
 * cuando entra una cuenta nueva al pool).
 */

import * as store from "./store.js";

// Default: cuántos pares activos puede tener una sola cuenta a la vez.
// Más pares = más conversaciones simultáneas = más warming volume.
// Pero también más carga en LLM y mensajes en WhatsApp Web.
const DEFAULT_MAX_PAIRS_PER_ACCOUNT = 3;

// Cuántos pares con la misma contraparte por semana (anti-incest temporal).
const MAX_PAIRS_SAME_OTHER_PER_WEEK = 1;

/**
 * Cuenta cuántos pares activos tiene una cuenta.
 * @param {string} accountId
 * @returns {number}
 */
export function activePairsForAccount(accountId) {
  return store.listPairsForAccount(accountId).length;
}

/**
 * ¿Pueden estos dos accounts ser pareados? Aplica todas las reglas.
 * @param {object} memberA - elemento del pool
 * @param {object} memberB - elemento del pool
 * @param {object} opts
 * @returns {{ok: boolean, reason?: string}}
 */
export function canPair(memberA, memberB, opts = {}) {
  const maxPairsPerAccount = opts.maxPairsPerAccount ?? DEFAULT_MAX_PAIRS_PER_ACCOUNT;

  if (memberA.accountId === memberB.accountId) {
    return { ok: false, reason: "same account" };
  }

  if (!memberA.active || !memberB.active) {
    return { ok: false, reason: "una de las dos cuentas está pausada" };
  }

  // Cross-setter only (regla A2)
  if (memberA.setterId && memberB.setterId && memberA.setterId === memberB.setterId) {
    return { ok: false, reason: "mismo setter (cross-setter only)" };
  }

  // Capacidad por cuenta
  if (activePairsForAccount(memberA.accountId) >= maxPairsPerAccount) {
    return { ok: false, reason: `${memberA.accountId} ya tiene max pares activos` };
  }
  if (activePairsForAccount(memberB.accountId) >= maxPairsPerAccount) {
    return { ok: false, reason: `${memberB.accountId} ya tiene max pares activos` };
  }

  // ¿Ya están pareadas (sin importar dirección)?
  const allPairs = store.listPairs();
  const existing = allPairs.find(
    (p) =>
      ((p.accountA === memberA.accountId && p.accountB === memberB.accountId) ||
        (p.accountA === memberB.accountId && p.accountB === memberA.accountId)) &&
      p.state !== "CLOSED",
  );
  if (existing) {
    return { ok: false, reason: "ya están pareadas activamente" };
  }

  // Anti-incest semanal: chequear pares creados en últimos 7 días que TUVIERON
  // actividad real (al menos 1 mensaje). Pares cerrados sin actividad NO
  // cuentan — esto permite re-parear cuentas que se desinscribieron y
  // reinscribieron antes de que se mandara ningún mensaje.
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recentBetween = allPairs.filter(
    (p) =>
      ((p.accountA === memberA.accountId && p.accountB === memberB.accountId) ||
        (p.accountA === memberB.accountId && p.accountB === memberA.accountId)) &&
      new Date(p.createdAt).getTime() > weekAgo &&
      (p.messageCount || 0) > 0, // ← fix: solo cuentan pares con actividad real
  );
  if (recentBetween.length >= MAX_PAIRS_SAME_OTHER_PER_WEEK) {
    return { ok: false, reason: "ya pareadas con actividad esta semana" };
  }

  return { ok: true };
}

/**
 * Sugiere el próximo par a crear, eligiendo dos cuentas con prioridad
 * a las que tienen menos pares activos (fairness).
 *
 * @param {object} opts
 * @returns {{ok: boolean, pair?: object, reason?: string}}
 */
export function pickPair(opts = {}) {
  const pool = store.listPool().filter((m) => m.active);
  if (pool.length < 2) {
    return { ok: false, reason: `pool insuficiente (${pool.length} activas)` };
  }

  // Ordenar por menos pares activos primero (fairness)
  const sortedByLoad = pool
    .map((m) => ({ member: m, load: activePairsForAccount(m.accountId) }))
    .sort((a, b) => a.load - b.load);

  // Buscar la primera combinación válida en orden de fairness
  for (let i = 0; i < sortedByLoad.length - 1; i++) {
    for (let j = i + 1; j < sortedByLoad.length; j++) {
      const A = sortedByLoad[i].member;
      const B = sortedByLoad[j].member;
      const check = canPair(A, B, opts);
      if (check.ok) {
        return { ok: true, candidates: [A.accountId, B.accountId] };
      }
    }
  }

  return { ok: false, reason: "ninguna combinación válida" };
}

/**
 * Llena el pool de pares hasta el máximo posible. Idempotente.
 * Devuelve los pares creados.
 * @param {object} opts
 */
export function fillPairs(opts = {}) {
  const created = [];
  const maxIterations = opts.maxIterations ?? 50; // safety
  for (let i = 0; i < maxIterations; i++) {
    const result = pickPair(opts);
    if (!result.ok) break;
    const [a, b] = result.candidates;
    const r = store.createPair({ accountA: a, accountB: b });
    if (r.ok) {
      created.push(r.pair);
    } else {
      break; // si falla, parar (probably colision)
    }
  }
  return created;
}
