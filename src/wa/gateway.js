// Socket.IO gateway con auth dual:
//  - cookie de sesión (gs_session) → para el frontend admin (browser)
//  - JWT bearer en handshake.auth.token → para la app desktop Electron
import { Server as IOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { appendEvent, setAccountStatus, getAccount, listAccounts } from "./data.js";

let io = null;
const presence = new Map(); // userId → { sockets: Set<id>, lastSeen, role, name }

// Audit 2026-05-23: cleanup periódico de entries de `presence` para users que
// llevan >24h disconnected. Sin esto, el Map crece sin tope a lo largo del
// uptime (cada user que se loggeó alguna vez queda residual incluso si nunca
// más vuelve). El cleanup respeta entries con sockets activos.
const PRESENCE_STALE_MS = 24 * 60 * 60 * 1000;
let _presenceCleanupTimer = null;
function startPresenceCleanup() {
  if (_presenceCleanupTimer) return;
  _presenceCleanupTimer = setInterval(() => {
    try {
      const now = Date.now();
      let removed = 0;
      for (const [userId, p] of presence.entries()) {
        if (p.sockets.size === 0 && now - p.lastSeen > PRESENCE_STALE_MS) {
          presence.delete(userId);
          removed++;
        }
      }
      if (removed > 0 && process.env.NODE_ENV !== "test") {
        console.log(`[wa-gateway] presence cleanup: ${removed} stale entries removidos`);
      }
    } catch (err) {
      console.error("[wa-gateway] presence cleanup error:", err?.message || err);
    }
  }, 60 * 60 * 1000); // cada 1h
  if (typeof _presenceCleanupTimer.unref === "function") _presenceCleanupTimer.unref();
}

export function initGateway(httpServer, deps) {
  const { jwtSecret, getSessionFromRequest } = deps;
  // Security audit 2026-05-23 (C-4): CORS antes era `origin: true` (reflejaba CUALQUIER
  // Origin con credentials habilitadas). Sitios maliciosos podian conectar al socket
  // como un admin loggeado y robar todos los eventos en vivo.
  // Ahora: en prod usamos whitelist explicita via env var WA_CORS_ORIGINS (CSV);
  // si no esta seteada, default a same-origin (origin: false, mismo host).
  // En dev/test mantenemos `origin: true` para no romper smoke tests locales.
  let corsOrigin;
  if (process.env.NODE_ENV === "production") {
    const csv = process.env.WA_CORS_ORIGINS || "";
    // Strip trailing slash — los browsers mandan Origin sin barra final.
    // Si el admin pega "https://app.up.railway.app/" desde el address bar,
    // Socket.IO no matcheaba. Tolerante por defecto.
    const list = csv
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    corsOrigin = list.length > 0 ? list : false; // false = same-origin only
  } else {
    corsOrigin = true; // dev/test: permisivo
  }
  io = new IOServer(httpServer, {
    cors: { origin: corsOrigin, credentials: true },
    path: "/socket.io",
  });
  if (process.env.NODE_ENV !== "test") startPresenceCleanup();

  io.use((socket, next) => {
    // Vía 1: JWT (desktop)
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        socket.data.user = {
          id: payload.sub,
          role: payload.role,
          name: payload.name || "",
          setterId: payload.setterId || "",
          source: "desktop",
        };
        return next();
      } catch (e) {
        return next(new Error("bad token"));
      }
    }
    // Vía 2: cookie de sesión (browser)
    const fakeReq = { headers: { cookie: socket.handshake.headers.cookie || "" } };
    const auth = getSessionFromRequest(fakeReq);
    if (auth?.user) {
      socket.data.user = {
        id: auth.user.id,
        role: auth.user.role,
        name: auth.user.name,
        setterId: auth.user.setterId || "",
        source: "browser",
      };
      return next();
    }
    next(new Error("no auth"));
  });

  // Helper: ¿este user puede actuar sobre esta accountId?
  // Admin: siempre sí (tiene acceso a todas las cuentas, incluso las de setters).
  // Setter: solo si la cuenta está asignada a su setterId.
  // Usado para sanitizar comandos socket que vienen de la desktop wa-multi.
  function userCanActOnAccount(user, accountId) {
    if (!user || !accountId) return false;
    if (user.role === "admin") return true;
    const acc = getAccount(accountId);
    if (!acc) return false;
    return acc.assignment?.kind === "setter" && acc.assignment?.refId === user.setterId;
  }

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (user.role === "admin") socket.join("admins");

    let p = presence.get(user.id);
    const wasOffline = !p || p.sockets.size === 0;
    if (!p) {
      p = { sockets: new Set(), lastSeen: Date.now(), role: user.role, name: user.name };
      presence.set(user.id, p);
    }
    p.sockets.add(socket.id);
    p.lastSeen = Date.now();

    if (user.role !== "admin") {
      io.to("admins").emit("admin:presence-update", { userId: user.id, online: true, name: user.name });
    }

    // Si el user pasó de offline a online, notificar al orchestrator de
    // warming network para que reactive sus pares en PAUSED_OFFLINE.
    if (wasOffline) {
      import("./warming-network/orchestrator.js").then((orch) => {
        return orch.onUserCameOnline(user.id);
      }).catch((err) => {
        // En tests o si warming-network no está cargado, NODE_ENV=test silencia.
        if (process.env.NODE_ENV !== "test") {
          console.warn("[gateway] onUserCameOnline failed:", err?.message || err);
        }
      });
    }

    socket.on("heartbeat", () => {
      const cur = presence.get(user.id);
      if (cur) cur.lastSeen = Date.now();
    });

    // Eventos que reporta la desktop ──────────────────────────────────────
    socket.on("account:status", ({ accountId, status, phone } = {}) => {
      if (!accountId) return;
      // Ownership check: setter solo puede reportar status de sus cuentas;
      // admin tiene acceso global (suele tener TODAS las cuentas, incluso
      // las que escaneó por otros setters). Sin este check, un setter
      // comprometido podría reportar BANNED sobre cuentas de otros setters
      // o pisar el phone de una cuenta ajena. Bug encontrado en audit 2026-05-23.
      if (!userCanActOnAccount(user, accountId)) {
        console.warn(`[wa-gateway] account:status rechazado: user ${user.id} (${user.role}) sin permiso sobre ${accountId}`);
        return;
      }
      try {
        const updated = setAccountStatus(accountId, status, phone);
        if (updated) {
          io.to("admins").emit("admin:account-update", {
            accountId,
            status: updated.status,
            phone: updated.phone,
          });
        }
      } catch (err) {
        console.error("[wa-gateway] account:status error:", err?.message || err);
      }
    });

    socket.on("account:event", async ({ accountId, type, payload } = {}) => {
      if (!type) return;
      // Ownership check: setter no debería poder emitir eventos para cuentas
      // que no son suyas (eso podría inflar stats o ensuciar el log del
      // dashboard). Admin sí puede emitir cualquier evento (típicamente desde
      // la wa-multi que tiene todas las cuentas). Si accountId vino vacío,
      // dejamos pasar (algunos eventos son globales, no por cuenta).
      if (accountId && !userCanActOnAccount(user, accountId)) {
        console.warn(`[wa-gateway] account:event rechazado: user ${user.id} (${user.role}) sin permiso sobre ${accountId} type=${type}`);
        return;
      }

      // Filtro warming network: si llega 'ai-classified-inbound' y el remitente
      // está en el pool de warming, NO lo guardamos como lead inbound — lo
      // ruteamos al orchestrator del warming network y aborto.
      if (type === "ai-classified-inbound" && payload?.contactPhone) {
        try {
          const wnStore = await import("./warming-network/store.js");
          const orch = await import("./warming-network/orchestrator.js");
          // Buscar si el contactPhone matchea con alguna cuenta del pool.
          // Audit 2026-05-23: `listAccounts` ya está importado top-level — no
          // hace falta dynamic import dentro del handler.
          const accountsOfPool = wnStore.listPool().map((m) => m.accountId);
          const senderAccount = listAccounts().find(
            (a) =>
              accountsOfPool.includes(a.id) &&
              a.phone &&
              a.phone.replace(/\D/g, "").endsWith(String(payload.contactPhone).replace(/\D/g, "").slice(-8)),
          );
          if (senderAccount) {
            // Es warming inbound — actualizar par + NO emitir como lead
            const pairs = wnStore.listPairsForAccount(accountId);
            const pair = pairs.find(
              (p) =>
                (p.accountA === senderAccount.id && p.accountB === accountId) ||
                (p.accountB === senderAccount.id && p.accountA === accountId),
            );
            if (pair) {
              orch.onWarmingInboundReceived({
                pairId: pair.id,
                fromAccountId: senderAccount.id,
                text: payload.message || "",
              });
              console.log(`[warming-net] inbound filtrado: ${senderAccount.id} → ${accountId} pair=${pair.id}`);
              // No appendEvent — no queremos llenar el log de leads con warming
              return;
            }
          }
        } catch (err) {
          console.error("[warming-net] error filtrando inbound:", err);
          // Continúa al flow normal
        }

        // Phase 7 — detección de respuesta de campaña. Si el teléfono pertenece
        // a un lead en una campaña running, avanza su estado: opener→pitch,
        // pitch→Mercury, mercury→Mercury responde. No bloquea el flow.
        try {
          const { handleCampaignInbound } = await import("./campaign-engine.js");
          await handleCampaignInbound(
            {
              getSettersData: deps.getSettersData,
              userIdFromSetterId: deps.userIdFromSetterId,
              markLeadReplied: deps.markLeadReplied,
              generateMercuryReply: deps.generateMercuryReply,
              sendToUser,
              listAccounts,
              isUserOnline,
              getPresenceList,
            },
            { contactPhone: payload.contactPhone, intent: payload?.classification?.intent, message: payload?.message },
          );
        } catch (err) {
          console.error("[campaign-engine] inbound hook error:", err?.message || err);
        }
      }

      try {
        const event = appendEvent({ accountId, userId: user.id, type, payload });
        io.to("admins").emit("admin:event", {
          accountId,
          userId: user.id,
          type: event.type,
          at: new Date(event.createdAt).getTime(),
        });
      } catch (err) {
        console.error("[wa-gateway] account:event appendEvent error:", err?.message || err);
      }
    });

    // v0.5.8 SPIKE: diagnóstico del envío de archivos. WAMULTI reporta cada
    // paso acá. Guardamos los últimos 50 en memoria global para que un endpoint
    // admin los lea (sin que el user copie logs de DevTools).
    socket.on("wamulti:file-result", (payload = {}) => {
      try {
        if (!Array.isArray(globalThis.__waFileResults)) globalThis.__waFileResults = [];
        globalThis.__waFileResults.push({ ...payload, userId: user.id, receivedAt: new Date().toISOString() });
        if (globalThis.__waFileResults.length > 50) globalThis.__waFileResults = globalThis.__waFileResults.slice(-50);
        console.log(`[wa-gateway] file-result step=${payload.step} ok=${payload.ok ?? '—'}`);
      } catch (e) { console.warn("[wa-gateway] file-result error:", e?.message); }
    });

    // v0.5.8 WAMULTI: el desktop avisa que el user envió un WhatsApp a un lead
    // (chat abierto vía protocolo wamulti://send). Registramos el contacto en
    // el lead con la cuenta/número desde el que se escribió.
    socket.on("lead:contacted", async ({ leadId, accountId, fromPhone, toPhone, sentAt } = {}) => {
      if (!leadId) return;
      // Ownership: el user debe poder actuar sobre esa cuenta WA.
      if (accountId && !userCanActOnAccount(user, accountId)) {
        console.warn(`[wa-gateway] lead:contacted rechazado: user ${user.id} sin permiso sobre ${accountId}`);
        return;
      }
      try {
        if (typeof deps.markLeadContacted === "function") {
          const r = await deps.markLeadContacted({ leadId, accountId, fromPhone, toPhone, sentAt });
          if (r && r.ok) {
            console.log(`[wa-gateway] lead:contacted OK leadId=${leadId} from=${fromPhone}`);
            io.to("admins").emit("admin:lead-contacted", { leadId, accountId, fromPhone, sentAt });
          } else {
            console.warn(`[wa-gateway] lead:contacted no aplicó: ${r?.reason}`);
          }
        }
      } catch (err) {
        console.error("[wa-gateway] lead:contacted error:", err?.message || err);
      }
    });

    socket.on("disconnect", () => {
      const cur = presence.get(user.id);
      if (!cur) return;
      cur.sockets.delete(socket.id);
      cur.lastSeen = Date.now();
      if (cur.sockets.size === 0 && user.role !== "admin") {
        io.to("admins").emit("admin:presence-update", { userId: user.id, online: false });
      }
    });
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error("WA gateway no inicializado");
  return io;
}

export function isUserOnline(userId) {
  const p = presence.get(userId);
  return !!(p && p.sockets.size > 0);
}

export function getPresenceList() {
  if (!io) return []; // en tests sin WS no hay presence
  return Array.from(presence.entries()).map(([userId, p]) => ({
    userId,
    online: p.sockets.size > 0,
    lastSeen: p.lastSeen,
    role: p.role,
    name: p.name,
  }));
}

export function sendToUser(userId, event, payload) {
  if (!io) return false; // en tests / sin WS, los comandos se aceptan pero no se despachan
  io.to(`user:${userId}`).emit(event, payload);
  return true;
}

// Expose helpers to globalThis para que index.js (modulo grande) los pueda
// usar desde el scheduler de mensajes programados sin import circular.
// Esto se setea en mountWa() al final.
export function exposeGlobals() {
  globalThis.__waGateway = {
    sendToUser,
    isUserConnected: isUserOnline,
    getPresenceList,
  };
}
