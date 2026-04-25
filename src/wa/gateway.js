// Socket.IO gateway con auth dual:
//  - cookie de sesión (gs_session) → para el frontend admin (browser)
//  - JWT bearer en handshake.auth.token → para la app desktop Electron
import { Server as IOServer } from "socket.io";
import jwt from "jsonwebtoken";
import { appendEvent, setAccountStatus, getAccount, listAccounts } from "./data.js";

let io = null;
const presence = new Map(); // userId → { sockets: Set<id>, lastSeen, role, name }

export function initGateway(httpServer, deps) {
  const { jwtSecret, getSessionFromRequest } = deps;
  io = new IOServer(httpServer, {
    cors: { origin: true, credentials: true },
    path: "/socket.io",
  });

  io.use((socket, next) => {
    // Vía 1: JWT (desktop)
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        socket.data.user = { id: payload.sub, role: payload.role, name: payload.name || "", source: "desktop" };
        return next();
      } catch (e) {
        return next(new Error("bad token"));
      }
    }
    // Vía 2: cookie de sesión (browser)
    const fakeReq = { headers: { cookie: socket.handshake.headers.cookie || "" } };
    const auth = getSessionFromRequest(fakeReq);
    if (auth?.user) {
      socket.data.user = { id: auth.user.id, role: auth.user.role, name: auth.user.name, source: "browser" };
      return next();
    }
    next(new Error("no auth"));
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    if (user.role === "admin") socket.join("admins");

    let p = presence.get(user.id);
    if (!p) {
      p = { sockets: new Set(), lastSeen: Date.now(), role: user.role, name: user.name };
      presence.set(user.id, p);
    }
    p.sockets.add(socket.id);
    p.lastSeen = Date.now();

    if (user.role !== "admin") {
      io.to("admins").emit("admin:presence-update", { userId: user.id, online: true, name: user.name });
    }

    socket.on("heartbeat", () => {
      const cur = presence.get(user.id);
      if (cur) cur.lastSeen = Date.now();
    });

    // Eventos que reporta la desktop ──────────────────────────────────────
    socket.on("account:status", ({ accountId, status, phone } = {}) => {
      if (!accountId) return;
      const updated = setAccountStatus(accountId, status, phone);
      if (updated) {
        io.to("admins").emit("admin:account-update", {
          accountId,
          status: updated.status,
          phone: updated.phone,
        });
      }
    });

    socket.on("account:event", ({ accountId, type, payload } = {}) => {
      if (!type) return;
      const event = appendEvent({ accountId, userId: user.id, type, payload });
      io.to("admins").emit("admin:event", {
        accountId,
        userId: user.id,
        type: event.type,
        at: new Date(event.createdAt).getTime(),
      });
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
