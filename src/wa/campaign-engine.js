// Phase 7 — Motor de campañas drip. El tick corre cada 60s (en paralelo al
// scheduler de scheduled_messages, que queda intacto). Avanza la máquina de
// estados de cada lead: drip → bloques del opener con delays → espera respuesta
// → bumps → fin. La detección de respuesta vive en el gateway (Wave 4); acá
// está el avance temporal (envíos programados).
//
// Diseño testeable: la lógica de decisión (ventana horaria, próximo bump, cap)
// son helpers puros. El tick hace I/O (load/save/emit) usando esos helpers.
import { mutateCampaigns, randomBlockDelay } from "./campaigns.js";

// ── Helpers puros (testeables) ──────────────────────────────────────────────

// ¿`now` cae dentro de la ventana horaria/días de la campaña, en SU timezone?
// window: { hourStart, hourEnd, days:[0..6], timezone }. days usa 0=Domingo.
export function isWithinWindow(window, now = new Date()) {
  if (!window) return true;
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: window.timezone || "UTC",
      weekday: "short", hour: "2-digit", hour12: false,
    });
    const parts = {};
    for (const p of dtf.formatToParts(now)) if (p.type !== "literal") parts[p.type] = p.value;
    const hour = parseInt(parts.hour, 10) % 24;
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[parts.weekday];
    const days = Array.isArray(window.days) && window.days.length ? window.days : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(day)) return false;
    const { hourStart = 0, hourEnd = 24 } = window;
    if (hourStart <= hourEnd) return hour >= hourStart && hour < hourEnd;
    return hour >= hourStart || hour < hourEnd; // ventana que cruza medianoche
  } catch {
    return true; // si el timezone es inválido, no bloquear
  }
}

// Cap diario efectivo de una cuenta: el override de la campaña, o la fase de
// warming de la cuenta (currentPhaseFor().dailyMessages), o un default alto.
export function effectiveDailyCap(campaign, account, currentPhaseFor) {
  if (campaign.dailyCapPerAccount != null) return campaign.dailyCapPerAccount;
  try {
    if (account && account.routineStartedAt && typeof currentPhaseFor === "function") {
      // Sin la rutina exacta acá, usamos una curva conservadora por día de warming.
      // El caller puede pasar currentPhaseFor ya resuelto; si no, fallback.
    }
  } catch {}
  // Fallback conservador si no hay info de warming: 80/día (igual que DAILY_SEND_CAP del desktop).
  return account && account.routineStartedAt ? warmingCapByDay(account) : 80;
}

// Curva de cap por día de warming (espeja defaultPhases de data.js, sin importar
// la rutina): día 1-2: 12, 3-5: 30, 6-10: 80, 11-14: 200, 15+: 400.
export function warmingCapByDay(account, now = Date.now()) {
  if (!account || !account.routineStartedAt) return 80;
  const start = new Date(account.routineStartedAt).getTime();
  const day = Math.max(1, Math.floor((now - start) / 86400000) + 1);
  if (day <= 2) return 12;
  if (day <= 5) return 30;
  if (day <= 10) return 80;
  if (day <= 14) return 200;
  return 400;
}

const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);

// Bloques de una variante en orden, como textos. Interpola {{nombre}}/{{name}}.
export function variantBlockTexts(variant, lead = {}) {
  const blocks = Array.isArray(variant?.blocks) ? variant.blocks : [];
  const name = lead.name || "";
  return blocks
    .map((b) => String(b.text || "").trim())
    .filter(Boolean)
    .map((t) => t.replace(/\{\{nombre\}\}/g, name).replace(/\{\{name\}\}/g, name));
}

// ── El tick ─────────────────────────────────────────────────────────────────
// deps: { getSettersData, listAccounts, sendToUser, userIdFromSetterId, now }
export async function campaignEngineTick(deps) {
  const now = deps.now ? deps.now() : Date.now();
  const nowDate = new Date(now);

  await mutateCampaigns(async (data) => {
    const running = (data.campaigns || []).filter((c) => c.status === "running");
    if (running.length === 0) return;

    // Hoist reads una vez por tick.
    let settersData = { leads: {}, variants: [] };
    try { settersData = deps.getSettersData ? deps.getSettersData() : settersData; } catch {}
    const variantsById = Object.fromEntries((settersData.variants || []).map((v) => [v.id, v]));
    const accounts = (deps.listAccounts ? deps.listAccounts() : []) || [];
    const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));

    for (const camp of running) {
      const states = data.leadStates[camp.id] || {};
      if (Object.keys(states).length === 0) continue;
      if (!isWithinWindow(camp.window, nowDate)) continue; // fuera de horario → no enviar

      // Contador diario por cuenta (reset al cambiar de día).
      if (!camp._dailySends || camp._dailySends.key !== todayKey(nowDate)) {
        camp._dailySends = { key: todayKey(nowDate), byAccount: {} };
      }
      const sentToday = (accId) => camp._dailySends.byAccount[accId] || 0;
      const capOf = (accId) => effectiveDailyCap(camp, accountsById[accId], null);
      // ANTI-RÁFAGA: máximo 1 envío por cuenta POR TICK (tick = 60s). Sin esto,
      // un backlog (leads acumulados mientras wa-multi estaba offline, o tras un
      // pause/resume) se mandaría TODO junto en un tick → ráfaga → ban. Con este
      // tope, un backlog se drena de a 1 por minuto por cuenta, suave.
      const sentThisTick = {};
      const accountReady = (accId) => {
        const a = accountsById[accId];
        // Si la cuenta existe y NO está conectada, no enviar (requeue). Si no la
        // conocemos (desktop reporta aparte), dejamos pasar.
        if (a && a.status && a.status !== "CONNECTED") return false;
        if ((sentThisTick[accId] || 0) >= 1) return false; // ya mandó en este tick
        return sentToday(accId) < capOf(accId);
      };

      // Resolver A QUIÉN se le manda el comando para una cuenta. El comando va al
      // wa-multi que tiene esa cuenta conectada. Prioridad (igual que warming):
      //  1) el setter dueño de la cuenta, si está online;
      //  2) un admin online (tiene wa-multi con TODAS las cuentas);
      //  3) fallback al setterId de la campaña.
      // NO usar camp.setterId como clave principal — una campaña creada por admin
      // tiene setterId vacío y el envío fallaba silenciosamente.
      const resolveRecipient = (account) => {
        const ownerSetter = account?.assignment?.refId;
        if (ownerSetter && deps.userIdFromSetterId) {
          const uid = deps.userIdFromSetterId(ownerSetter);
          if (uid && (!deps.isUserOnline || deps.isUserOnline(uid))) return uid;
        }
        if (deps.getPresenceList) {
          const admin = deps.getPresenceList().find((p) => p.online && p.role === "admin");
          if (admin) return admin.userId;
        }
        if (camp.setterId && deps.userIdFromSetterId) {
          const uid = deps.userIdFromSetterId(camp.setterId);
          if (uid) return uid;
        }
        return null;
      };

      const send = (accId, leadId, lead, text, kind, extra = {}) => {
        if (!deps.sendToUser) return false;
        const recipient = resolveRecipient(accountsById[accId]);
        if (!recipient) return false; // nadie online con esa cuenta → requeue
        const phone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || "";
        if (!phone) return false;
        // MVP: reusar followup:send-message (handler que YA existe en wa-multi
        // v0.5.8) → no requiere repack del desktop.
        deps.sendToUser(recipient, "followup:send-message", {
          scheduledMsgId: `camp_${camp.id}_${leadId}_${kind}`,
          accountId: accId, targetPhone: phone, text, leadId,
          campaignId: camp.id, blockKind: kind, ...extra,
        });
        camp._dailySends.byAccount[accId] = sentToday(accId) + 1;
        sentThisTick[accId] = (sentThisTick[accId] || 0) + 1; // tope anti-ráfaga
        return true;
      };

      // 1) DRIP: liberar batchSize queued cada intervalMinutes.
      const dripMs = (camp.drip?.intervalMinutes || 5) * 60000;
      const lastDrip = camp.lastDripAt ? new Date(camp.lastDripAt).getTime() : 0;
      if (now - lastDrip >= dripMs) {
        let released = 0;
        const batch = camp.drip?.batchSize || 1;
        for (const [leadId, ls] of Object.entries(states)) {
          if (released >= batch) break;
          if (ls.state !== "queued") continue;
          ls.state = "opener_sending";
          ls.nextActionAt = new Date(now).toISOString();
          released++;
        }
        if (released > 0) camp.lastDripAt = new Date(now).toISOString();
      }

      // 2) Avance por lead (bloques + bumps) cuando nextActionAt venció.
      for (const [leadId, ls] of Object.entries(states)) {
        const lead = settersData.leads?.[leadId];
        if (!lead) continue;

        // Defensa cancelOnReply: si el lead respondió, sacarlo de la cola de envíos.
        if (camp.cancelOnReply !== false && lead.respondio === true &&
            (ls.state === "opener_sending" || ls.state === "awaiting_reply")) {
          ls.state = "replied_for_setter";
          ls.repliedAt = ls.repliedAt || new Date(now).toISOString();
          continue;
        }

        if (!ls.nextActionAt || new Date(ls.nextActionAt).getTime() > now) continue;
        const accId = ls.accountId;
        if (!accountReady(accId)) continue; // cuenta no lista / cap → reintentar próximo tick

        const variant = variantsById[ls.variantId];

        if (ls.state === "opener_sending") {
          const blocks = variantBlockTexts(variant, lead);
          if (ls.blockIdx < blocks.length) {
            if (send(accId, leadId, lead, blocks[ls.blockIdx], "opener_block")) {
              ls.lastSentAt = new Date(now).toISOString();
              (ls.history ||= []).push({ at: ls.lastSentAt, kind: "block", idx: ls.blockIdx });
              ls.blockIdx++;
              if (ls.blockIdx < blocks.length) {
                ls.nextActionAt = new Date(now + randomBlockDelay(camp.blockDelay)).toISOString();
              } else {
                // Opener completo → esperar respuesta / primer bump.
                if ((camp.bumps || []).length > 0) {
                  ls.state = "awaiting_reply";
                  ls.nextActionAt = new Date(now + camp.bumps[0].afterHours * 3600000).toISOString();
                } else {
                  ls.state = "awaiting_reply";
                  ls.nextActionAt = null; // sin bumps: solo espera respuesta
                }
              }
            }
          } else {
            // variante sin bloques → directo a espera
            ls.state = "awaiting_reply";
            ls.nextActionAt = (camp.bumps || []).length ? new Date(now + camp.bumps[0].afterHours * 3600000).toISOString() : null;
          }
        } else if (ls.state === "awaiting_reply") {
          // Tocó un bump.
          const bumps = camp.bumps || [];
          if (ls.bumpIdx < bumps.length) {
            const text = bumps[ls.bumpIdx].text.replace(/\{\{nombre\}\}/g, lead.name || "").replace(/\{\{name\}\}/g, lead.name || "");
            if (send(accId, leadId, lead, text, "bump")) {
              ls.lastSentAt = new Date(now).toISOString();
              (ls.history ||= []).push({ at: ls.lastSentAt, kind: "bump", idx: ls.bumpIdx });
              ls.bumpIdx++;
              if (ls.bumpIdx < bumps.length) {
                ls.nextActionAt = new Date(now + bumps[ls.bumpIdx].afterHours * 3600000).toISOString();
              } else {
                ls.state = "no_reply";
                ls.nextActionAt = null;
              }
            }
          } else {
            ls.state = "no_reply";
            ls.nextActionAt = null;
          }
        }
      }

      // 3) Recalcular stats + cerrar campaña si no queda nada activo.
      const summary = {};
      for (const ls of Object.values(states)) summary[ls.state] = (summary[ls.state] || 0) + 1;
      camp.stats = {
        queued: summary.queued || 0,
        sent: (summary.opener_sending || 0) + (summary.awaiting_reply || 0),
        replied: summary.replied_for_setter || 0,
        qualified: summary.qualifying || 0,
        noReply: summary.no_reply || 0,
        disqualified: summary.disqualified || 0,
      };
      const active = (summary.queued || 0) + (summary.opener_sending || 0) + (summary.awaiting_reply || 0) + (summary.qualifying || 0);
      if (active === 0) camp.status = "done";
    }
  });
}

// ── Detección de respuesta (Wave 4) ─────────────────────────────────────────
// Se llama desde el gateway cuando llega un inbound clasificado. Matchea el
// teléfono con un lead en alguna campaña running y avanza su estado:
//  - intent descalificado → disqualified (frena todo)
//  - en opener/awaiting → si hay qualifyMessage, lo manda y pasa a `qualifying`;
//    sino directo a replied_for_setter
//  - en qualifying (ya respondió la calificación) → replied_for_setter
// Cancela bumps implícitamente (sale de awaiting_reply). Marca el lead respondió.
// Helper puro de match de teléfono: compara los últimos 8 dígitos.
export function phoneMatches(a, b) {
  const da = String(a || "").replace(/\D/g, "");
  const db = String(b || "").replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  return da.slice(-8) === db.slice(-8);
}

export async function handleCampaignInbound(deps, { contactPhone, intent } = {}) {
  if (!contactPhone) return null;
  let settersData = { leads: {} };
  try { settersData = deps.getSettersData ? deps.getSettersData() : settersData; } catch {}
  // teléfono → leadId
  let leadId = null, lead = null;
  for (const [id, l] of Object.entries(settersData.leads || {})) {
    const ph = l?.phone || l?.webWhatsApp || l?.aiWhatsApp;
    if (ph && phoneMatches(ph, contactPhone)) { leadId = id; lead = l; break; }
  }
  if (!leadId) return null;

  let result = null;
  await mutateCampaigns(async (data) => {
    for (const camp of (data.campaigns || [])) {
      if (camp.status !== "running") continue;
      const ls = data.leadStates[camp.id]?.[leadId];
      if (!ls) continue;
      const disq = intent === "descalificado" || intent === "descartado";
      if (disq) {
        ls.state = "disqualified";
        ls.nextActionAt = null;
        result = { campaignId: camp.id, leadId, state: "disqualified" };
      } else if (ls.state === "opener_sending" || ls.state === "awaiting_reply") {
        ls.repliedAt = new Date().toISOString();
        if (camp.qualifyMessage && deps.sendToUser) {
          const userId = deps.userIdFromSetterId ? deps.userIdFromSetterId(camp.setterId) : camp.setterId;
          const phone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || "";
          if (userId && phone) {
            const text = camp.qualifyMessage.replace(/\{\{nombre\}\}/g, lead.name || "").replace(/\{\{name\}\}/g, lead.name || "");
            deps.sendToUser(userId, "followup:send-message", {
              scheduledMsgId: `camp_${camp.id}_${leadId}_qualify`,
              accountId: ls.accountId, targetPhone: phone, text, leadId, campaignId: camp.id, blockKind: "qualify",
            });
          }
          ls.state = "qualifying";
          ls.nextActionAt = null;
        } else {
          ls.state = "replied_for_setter";
          ls.nextActionAt = null;
        }
        result = { campaignId: camp.id, leadId, state: ls.state };
      } else if (ls.state === "qualifying") {
        ls.state = "replied_for_setter";
        ls.nextActionAt = null;
        result = { campaignId: camp.id, leadId, state: "replied_for_setter" };
      }
      if (result) break; // un lead está en una sola campaña activa a la vez
    }
  });

  // Marcar el lead en el pipeline del setter (aparece como "respondió").
  if (result && result.state !== "disqualified" && typeof deps.markLeadReplied === "function") {
    try { await deps.markLeadReplied(leadId); } catch {}
  }
  return result;
}

let _timer = null;
export function startCampaignEngine(deps) {
  if (_timer) return;
  // Primer tick a los ~7s del boot (escalonado del scheduler de followups).
  setTimeout(() => { campaignEngineTick(deps).catch((e) => console.error("[campaign-engine] tick error:", e?.message || e)); }, 7000);
  _timer = setInterval(() => {
    campaignEngineTick(deps).catch((e) => console.error("[campaign-engine] tick error:", e?.message || e));
  }, 60000);
  if (typeof _timer.unref === "function") _timer.unref();
}
