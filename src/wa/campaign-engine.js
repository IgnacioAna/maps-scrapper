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

// Gap mínimo entre DOS mensajes consecutivos de la MISMA cuenta (anti-ráfaga).
// Si la cuenta tiene `minSendGapMinutes` configurado, se usa eso. Si no, se
// deriva del día de warming: cuenta nueva = gap grande (más seguro).
export function sendGapMs(account) {
  if (account && account.minSendGapMinutes != null) {
    return Math.max(1, Number(account.minSendGapMinutes)) * 60000;
  }
  // Default por fase de warming (sin config explícita).
  if (!account || !account.routineStartedAt) return 8 * 60000; // sin warming → trato como nueva: 8 min
  const day = Math.max(1, Math.floor((Date.now() - new Date(account.routineStartedAt).getTime()) / 86400000) + 1);
  if (day <= 2) return 8 * 60000;   // días 1-2: 1 cada 8 min
  if (day <= 5) return 5 * 60000;   // días 3-5: 1 cada 5 min
  if (day <= 10) return 3 * 60000;  // días 6-10: 1 cada 3 min
  if (day <= 14) return 2 * 60000;  // días 11-14: 1 cada 2 min
  return 90 * 1000;                 // madura: 1 cada 90s
}

// lastSendAt por cuenta, GLOBAL entre campañas (in-memory; se resetea al
// reiniciar el server, pero el cap diario + drip siguen protegiendo).
const _accountLastSend = /* @__PURE__ */ new Map();

// Solo para tests: limpiar el throttle entre casos (el Map es module-level).
export function __resetThrottleForTests() { _accountLastSend.clear(); }

// Bloques de una variante en orden, como textos. Interpola {{nombre}}/{{name}}.
export function variantBlockTexts(variant, lead = {}) {
  const blocks = Array.isArray(variant?.blocks) ? variant.blocks : [];
  const name = lead.name || "";
  return blocks
    .map((b) => String(b.text || "").trim())
    .filter(Boolean)
    .map((t) => t.replace(/\{\{nombre\}\}/g, name).replace(/\{\{name\}\}/g, name));
}

// Resuelve a QUÉ usuario (wa-multi) se le manda el comando para una cuenta:
// dueño online → admin online → setterId de la campaña. Compartido entre el
// tick y el inbound hook.
function resolveRecipient(deps, account, campSetterId) {
  const ownerSetter = account?.assignment?.refId;
  if (ownerSetter && deps.userIdFromSetterId) {
    const uid = deps.userIdFromSetterId(ownerSetter);
    if (uid && (!deps.isUserOnline || deps.isUserOnline(uid))) return uid;
  }
  if (deps.getPresenceList) {
    const admin = deps.getPresenceList().find((p) => p.online && p.role === "admin");
    if (admin) return admin.userId;
  }
  if (campSetterId && deps.userIdFromSetterId) {
    const uid = deps.userIdFromSetterId(campSetterId);
    // WR-04: exigir online también acá. Antes devolvía el uid aunque estuviera
    // desconectado → sendToUser emitía a una room vacía (mensaje perdido pero
    // send() devolvía true), el lead avanzaba a awaiting_opener_reply esperando
    // una respuesta a un mensaje que nunca recibió, y quedaba perdido para
    // siempre. Si nadie está online → null → send() false → requeue al próximo
    // tick (el diseño explícito de "nadie online → requeue").
    if (uid && (!deps.isUserOnline || deps.isUserOnline(uid))) return uid;
  }
  return null;
}

// Elige una variación de opener al azar e interpola {{nombre}}. null si no hay.
export function pickOpener(campaign, lead = {}) {
  const arr = Array.isArray(campaign?.openers) ? campaign.openers.filter(Boolean) : [];
  if (arr.length === 0) return null;
  const t = String(arr[Math.floor(Math.random() * arr.length)] || "");
  return t.replace(/\{\{nombre\}\}/g, lead.name || "").replace(/\{\{name\}\}/g, lead.name || "").trim();
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
      // ANTI-RÁFAGA: gap mínimo entre dos mensajes de la misma cuenta (derivado
      // del warming o configurable por cuenta). Sin esto, un backlog (leads
      // acumulados con wa-multi offline o tras pause/resume) se mandaría TODO
      // junto → ráfaga → ban. Con el gap, el backlog se drena suave (ej. cuenta
      // nueva: 1 cada 8 min). El gap es GLOBAL por cuenta (entre campañas).
      const accountReady = (accId) => {
        const a = accountsById[accId];
        // Si la cuenta existe y NO está conectada, no enviar (requeue). Si no la
        // conocemos (desktop reporta aparte), dejamos pasar.
        if (a && a.status && a.status !== "CONNECTED") return false;
        const last = _accountLastSend.get(accId) || 0;
        if (now - last < sendGapMs(a)) return false; // todavía no pasó el gap
        return sentToday(accId) < capOf(accId);
      };

      const send = (accId, leadId, lead, text, kind, extra = {}) => {
        if (!deps.sendToUser) return false;
        const recipient = resolveRecipient(deps, accountsById[accId], camp.setterId);
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
        _accountLastSend.set(accId, now); // registrar para el gap anti-ráfaga
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

      // 2) Avance por lead TIME-DRIVEN. Solo dos estados disparan envíos por
      // tiempo: opener_sending (manda el opener) y pitch_sending (manda los
      // bloques de la variante con delay). Los estados de ESPERA
      // (awaiting_opener_reply / awaiting_pitch_reply / mercury_active) NO
      // hacen nada acá — los avanza el inbound hook cuando el lead responde.
      // A los que NO responden el opener NO se les manda nada (sin bumps).
      for (const [leadId, ls] of Object.entries(states)) {
        const lead = settersData.leads?.[leadId];
        if (!lead) continue;
        if (ls.state !== "opener_sending" && ls.state !== "pitch_sending") continue;
        if (!ls.nextActionAt || new Date(ls.nextActionAt).getTime() > now) continue;
        const accId = ls.accountId;
        if (!accountReady(accId)) continue; // cuenta no lista / cap / gap → próximo tick

        if (ls.state === "opener_sending") {
          // Mandar UN mensaje de apertura (variación al azar) y esperar respuesta.
          const text = pickOpener(camp, lead);
          if (!text) { ls.state = "no_reply"; ls.nextActionAt = null; continue; } // sin opener configurado
          if (send(accId, leadId, lead, text, "opener")) {
            ls.lastSentAt = new Date(now).toISOString();
            (ls.history ||= []).push({ at: ls.lastSentAt, kind: "opener" });
            ls.state = "awaiting_opener_reply";
            ls.nextActionAt = null; // esperamos la respuesta del lead (sin bumps)
          }
        } else if (ls.state === "pitch_sending") {
          // Mandar los bloques de la variante uno por uno con delay.
          const variant = variantsById[ls.variantId];
          const blocks = variantBlockTexts(variant, lead);
          if (ls.blockIdx < blocks.length) {
            if (send(accId, leadId, lead, blocks[ls.blockIdx], "pitch_block")) {
              ls.lastSentAt = new Date(now).toISOString();
              (ls.history ||= []).push({ at: ls.lastSentAt, kind: "pitch_block", idx: ls.blockIdx });
              ls.blockIdx++;
              if (ls.blockIdx < blocks.length) {
                ls.nextActionAt = new Date(now + randomBlockDelay(camp.blockDelay)).toISOString();
              } else {
                // Terminó el pitch → esperar la respuesta del lead (ahí entra Mercury).
                ls.state = "awaiting_pitch_reply";
                ls.nextActionAt = null;
              }
            }
          } else {
            ls.state = "awaiting_pitch_reply";
            ls.nextActionAt = null;
          }
        }
      }

      // 3) Recalcular stats + cerrar campaña si no queda nada activo.
      const summary = {};
      for (const ls of Object.values(states)) summary[ls.state] = (summary[ls.state] || 0) + 1;
      camp.stats = {
        queued: summary.queued || 0,
        sent: (summary.opener_sending || 0) + (summary.awaiting_opener_reply || 0) + (summary.pitch_sending || 0) + (summary.awaiting_pitch_reply || 0),
        replied: (summary.replied_for_setter || 0) + (summary.mercury_active || 0),
        mercury: summary.mercury_active || 0,
        noReply: summary.no_reply || 0,
        disqualified: summary.disqualified || 0,
      };
      // Activos = todo lo que todavía puede avanzar. awaiting_opener_reply NO
      // cuenta como activo a efectos de "cerrar" (puede quedar esperando para
      // siempre), pero tampoco cerramos la campaña mientras haya esperas o
      // conversaciones Mercury en curso. Cerramos solo si TODO es terminal.
      const terminal = (summary.no_reply || 0) + (summary.disqualified || 0) + (summary.replied_for_setter || 0);
      if (terminal === Object.keys(states).length && Object.keys(states).length > 0) camp.status = "done";
    }
  });
}

// ── Detección de respuesta ───────────────────────────────────────────────────
// Helper puro de match de teléfono: compara los últimos 8 dígitos.
export function phoneMatches(a, b) {
  const da = String(a || "").replace(/\D/g, "");
  const db = String(b || "").replace(/\D/g, "");
  if (!da || !db) return false;
  if (da === db) return true;
  return da.slice(-8) === db.slice(-8);
}

// Se llama desde el gateway cuando llega un inbound clasificado. Avanza la
// máquina de estados del lead según DÓNDE está en el flujo:
//  - intent descalificado (en cualquier punto) → disqualified, frena todo.
//  - awaiting_opener_reply (respondió el opener) → pitch_sending: el engine
//    empieza a mandar la variante en bloques con delays.
//  - awaiting_pitch_reply (respondió tras recibir todo el pitch) →
//    si useMercury → mercury_active y Mercury responde ahora; si no →
//    replied_for_setter (lo toma un humano).
//  - mercury_active (sigue conversando) → Mercury genera y manda otra respuesta;
//    si Mercury marca handoff (caliente/agendar) → replied_for_setter.
export async function handleCampaignInbound(deps, { contactPhone, intent, message } = {}) {
  if (!contactPhone) return null;
  // Honrar el reloj inyectado (deps.now) igual que campaignEngineTick, para que
  // los timestamps que escribimos (repliedAt/nextActionAt) usen UNA sola fuente
  // de tiempo. En prod deps.now no viene → Date.now() (comportamiento idéntico).
  // Sin esto, el tick corre con reloj simulado y el inbound con reloj real, lo
  // que dejaba nextActionAt en el "futuro" respecto del now del tick y el test
  // de flujo se volvía dependiente de la fecha real (flaky).
  const now = deps.now ? deps.now() : Date.now();
  const nowIso = () => new Date(now).toISOString();
  let settersData = { leads: {} };
  try { settersData = deps.getSettersData ? deps.getSettersData() : settersData; } catch {}
  let leadId = null, lead = null;
  for (const [id, l] of Object.entries(settersData.leads || {})) {
    const ph = l?.phone || l?.webWhatsApp || l?.aiWhatsApp;
    if (ph && phoneMatches(ph, contactPhone)) { leadId = id; lead = l; break; }
  }
  if (!leadId) return null;

  const accounts = (deps.listAccounts ? deps.listAccounts() : []) || [];
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const disq = intent === "descalificado" || intent === "descartado";

  // Acciones a ejecutar FUERA del mutex (envíos / Mercury) para no bloquear.
  let pending = null; // { kind:'mercury'|'none', campId, ls(ref no — usamos result) }
  let result = null;

  await mutateCampaigns(async (data) => {
    for (const camp of (data.campaigns || [])) {
      if (camp.status !== "running") continue;
      const ls = data.leadStates[camp.id]?.[leadId];
      if (!ls) continue;

      if (disq) {
        ls.state = "disqualified"; ls.nextActionAt = null;
        result = { campaignId: camp.id, leadId, state: "disqualified" };
      } else if (ls.state === "opener_sending" || ls.state === "awaiting_opener_reply") {
        // Respondió el opener → arrancar el pitch (la variante en bloques).
        ls.state = "pitch_sending";
        ls.blockIdx = 0;
        ls.repliedAt = nowIso();
        ls.nextActionAt = nowIso(); // el engine manda el 1er bloque ya
        result = { campaignId: camp.id, leadId, state: "pitch_sending" };
      } else if (ls.state === "awaiting_pitch_reply") {
        // Respondió tras todo el pitch → Mercury o humano.
        ls.repliedAt = nowIso();
        if (camp.useMercury !== false) {
          ls.state = "mercury_active";
          pending = { kind: "mercury", campId: camp.id, accountId: ls.accountId };
        } else {
          ls.state = "replied_for_setter"; ls.nextActionAt = null;
        }
        result = { campaignId: camp.id, leadId, state: ls.state };
      } else if (ls.state === "mercury_active") {
        // Sigue la conversación con Mercury.
        pending = { kind: "mercury", campId: camp.id, accountId: ls.accountId };
        result = { campaignId: camp.id, leadId, state: "mercury_active" };
      }
      if (result) { result._setterId = camp.setterId; break; }
    }
  });

  // Marcar el lead como respondió en el pipeline del setter (salvo descalificado).
  if (result && result.state !== "disqualified" && typeof deps.markLeadReplied === "function") {
    try { await deps.markLeadReplied(leadId); } catch {}
  }

  // Mercury responde (fuera del mutex). Genera y manda; si marca handoff, cierra.
  if (pending && pending.kind === "mercury" && typeof deps.generateMercuryReply === "function") {
    try {
      const gen = await deps.generateMercuryReply({ leadId, lead, message: message || "", campaignId: pending.campId });
      if (gen && gen.text) {
        const recipient = resolveRecipient(deps, accountsById[pending.accountId], result._setterId);
        const phone = lead.phone || lead.webWhatsApp || lead.aiWhatsApp || "";
        if (recipient && phone && deps.sendToUser) {
          deps.sendToUser(recipient, "followup:send-message", {
            scheduledMsgId: `camp_${pending.campId}_${leadId}_mercury_${Date.now()}`,
            accountId: pending.accountId, targetPhone: phone, text: gen.text, leadId,
            campaignId: pending.campId, blockKind: "mercury",
          });
        }
      }
      // Handoff: Mercury detectó interés de agendar / caliente → al humano.
      if (gen && gen.handoff) {
        await mutateCampaigns((data) => {
          const ls = data.leadStates[pending.campId]?.[leadId];
          if (ls) { ls.state = "replied_for_setter"; ls.nextActionAt = null; }
        });
        result.state = "replied_for_setter";
      }
    } catch (e) {
      // Si Mercury falla, el lead queda en mercury_active (reintenta al próximo inbound).
      if (process.env.NODE_ENV !== "test") console.warn("[campaign] Mercury reply falló:", e?.message || e);
    }
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
