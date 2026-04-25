// HTTP routes del módulo WA. Se montan con prefix /api/wa.
// Reusa el sistema de auth de GoogleSrapper (requireAuth, requireRole).
import jwt from "jsonwebtoken";
import {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  attachRoutine, setAssignment, setAccountStatus,
  listRoutines, getRoutine, createRoutine, updateRoutine, deleteRoutine,
  listEvents, eventsByHour,
  appendEvent,
} from "./data.js";
import { sendToUser, getPresenceList, isUserOnline } from "./gateway.js";

function readPositiveInt(value, def, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

export function registerWaRoutes(app, deps) {
  const { requireAuth: cookieRequireAuth, requireRole: cookieRequireRole, jwtSecret } = deps;

  // Middleware que acepta Bearer JWT (desktop) O cookie (browser).
  // Si hay Bearer válido, popula req.auth como lo hace attachAuth.
  function requireAuth(req, res, next) {
    if (req.auth?.user) return cookieRequireAuth(req, res, next);
    const authHeader = req.headers.authorization || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) {
      try {
        const payload = jwt.verify(m[1], jwtSecret);
        req.auth = {
          user: { id: payload.sub, role: payload.role, name: payload.name || "", setterId: payload.setterId || "" },
          session: null,
        };
        return next();
      } catch {
        return res.status(401).json({ error: "Token inválido" });
      }
    }
    return cookieRequireAuth(req, res, next);
  }

  function requireRole(...roles) {
    const inner = cookieRequireRole(...roles);
    return (req, res, next) => {
      // si vino por Bearer, req.auth ya está seteado por requireAuth
      if (!req.auth?.user) return res.status(401).json({ error: "No autenticado." });
      if (!roles.includes(req.auth.user.role)) return res.status(403).json({ error: "No autorizado." });
      next();
    };
  }

  // Endpoint para que la desktop obtenga un JWT corto (Bearer) y se conecte al WS.
  // El frontend admin sigue usando cookie; la desktop usa esto.
  app.post("/api/auth/desktop-login", express_json(app), async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "email y password requeridos" });
    // Reusamos las helpers de GoogleSrapper vía deps
    const auth = deps.verifyCredentials(email, password);
    if (!auth) return res.status(401).json({ error: "credenciales inválidas" });
    const token = jwt.sign(
      { sub: auth.user.id, role: auth.user.role, name: auth.user.name, setterId: auth.user.setterId || "" },
      jwtSecret,
      { expiresIn: "30d" },
    );
    return res.json({
      token,
      user: { id: auth.user.id, email: auth.user.email, name: auth.user.name, role: auth.user.role },
    });
  });

  // ── ACCOUNTS ─────────────────────────────────────────────────────────────
  app.get("/api/wa/accounts", requireAuth, (req, res) => {
    const { user } = req.auth;
    const all = listAccounts();
    if (user.role === "admin") return res.json(all);
    // setter: solo cuentas asignadas a él
    return res.json(all.filter((a) => a.assignment?.kind === "setter" && a.assignment?.refId === user.setterId));
  });

  app.post("/api/wa/accounts", requireAuth, requireRole("admin"), (req, res) => {
    const account = createAccount(req.body || {});
    res.json(account);
  });

  app.patch("/api/wa/accounts/:id", requireAuth, requireRole("admin"), (req, res) => {
    const updated = updateAccount(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "no encontrado" });
    res.json(updated);
  });

  app.delete("/api/wa/accounts/:id", requireAuth, requireRole("admin"), (req, res) => {
    const ok = deleteAccount(req.params.id);
    if (!ok) return res.status(404).json({ error: "no encontrado" });
    res.json({ ok: true });
  });

  app.post("/api/wa/accounts/:id/assign", requireAuth, requireRole("admin"), (req, res) => {
    const { kind, refId } = req.body || {};
    if (kind && !["setter", "client"].includes(kind)) {
      return res.status(400).json({ error: "kind inválido" });
    }
    const updated = setAssignment(req.params.id, kind ? { kind, refId } : null);
    if (!updated) return res.status(404).json({ error: "no encontrado" });
    res.json(updated);
  });

  // ── ROUTINES ─────────────────────────────────────────────────────────────
  app.get("/api/wa/routines", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(listRoutines());
  });

  app.post("/api/wa/routines", requireAuth, requireRole("admin"), (req, res) => {
    res.json(createRoutine(req.body || {}));
  });

  app.put("/api/wa/routines/:id", requireAuth, requireRole("admin"), (req, res) => {
    const updated = updateRoutine(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: "no encontrado" });
    res.json(updated);
  });

  app.delete("/api/wa/routines/:id", requireAuth, requireRole("admin"), (req, res) => {
    deleteRoutine(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/wa/routines/attach", requireAuth, requireRole("admin"), (req, res) => {
    const { accountId, routineId } = req.body || {};
    if (!accountId) return res.status(400).json({ error: "accountId requerido" });
    const updated = attachRoutine(accountId, routineId);
    if (!updated) return res.status(404).json({ error: "cuenta no encontrada" });
    res.json(updated);
  });

  // ── COMMANDS (admin → setter desktop vía WS) ─────────────────────────────
  function ownerUserIdOfAccount(account) {
    if (!account?.assignment) return null;
    if (account.assignment.kind === "setter") {
      // Buscamos el user.id del setter via setterId. deps lo resuelve.
      return deps.userIdFromSetterId(account.assignment.refId);
    }
    return null;
  }

  app.post("/api/wa/commands/open", requireAuth, requireRole("admin"), (req, res) => {
    const account = getAccount(req.body?.accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });
    sendToUser(userId, "account:open", { accountId: account.id });
    res.json({ ok: true });
  });

  app.post("/api/wa/commands/close", requireAuth, requireRole("admin"), (req, res) => {
    const account = getAccount(req.body?.accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });
    sendToUser(userId, "account:close", { accountId: account.id });
    res.json({ ok: true });
  });

  app.post("/api/wa/commands/send-message", requireAuth, requireRole("admin"), (req, res) => {
    const { accountId, phone, text } = req.body || {};
    if (!accountId || !phone || !text) return res.status(400).json({ error: "accountId, phone, text requeridos" });
    const account = getAccount(accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });
    sendToUser(userId, "account:send-message", { accountId, phone: String(phone), text: String(text) });
    res.json({ ok: true });
  });

  function buildRoutineConfig(routine) {
    return {
      id: routine.id,
      name: routine.name,
      dailyMessages: routine.dailyMessages,
      hourStart: routine.hourStart,
      hourEnd: routine.hourEnd,
      humanDelayMinMs: routine.humanDelayMinMs,
      humanDelayMaxMs: routine.humanDelayMaxMs,
      timezone: routine.timezone,
      messages: routine.messages || [],
      targets: (routine.targets || []).map((p) => ({ phone: String(p) })),
      autoReply: !!routine.autoReply,
      autoReplies: routine.autoReplies || [],
    };
  }

  app.post("/api/wa/commands/start-routine", requireAuth, requireRole("admin"), (req, res) => {
    const account = getAccount(req.body?.accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    if (!account.routineId) return res.status(400).json({ error: "cuenta sin routine" });
    const routine = getRoutine(account.routineId);
    if (!routine) return res.status(404).json({ error: "routine no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });
    sendToUser(userId, "routine:start", {
      accountId: account.id,
      routineId: routine.id,
      config: buildRoutineConfig(routine),
    });
    res.json({ ok: true });
  });

  app.post("/api/wa/commands/stop-routine", requireAuth, requireRole("admin"), (req, res) => {
    const account = getAccount(req.body?.accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });
    sendToUser(userId, "routine:stop", { accountId: account.id });
    res.json({ ok: true });
  });

  app.post("/api/wa/commands/bulk", requireAuth, requireRole("admin"), (req, res) => {
    const { accountIds, action } = req.body || {};
    if (!Array.isArray(accountIds) || accountIds.length === 0) return res.status(400).json({ error: "accountIds requerido" });
    const valid = ["open", "close", "start-routine", "stop-routine"];
    if (!valid.includes(action)) return res.status(400).json({ error: "action inválida" });
    const errors = [];
    let dispatched = 0;
    for (const id of accountIds) {
      const account = getAccount(id);
      if (!account) { errors.push({ accountId: id, error: "no encontrada" }); continue; }
      const userId = ownerUserIdOfAccount(account);
      if (!userId) { errors.push({ accountId: id, error: "sin setter" }); continue; }
      try {
        if (action === "open") sendToUser(userId, "account:open", { accountId: id });
        else if (action === "close") sendToUser(userId, "account:close", { accountId: id });
        else if (action === "stop-routine") sendToUser(userId, "routine:stop", { accountId: id });
        else if (action === "start-routine") {
          if (!account.routineId) { errors.push({ accountId: id, error: "sin routine" }); continue; }
          const routine = getRoutine(account.routineId);
          if (!routine) { errors.push({ accountId: id, error: "routine no existe" }); continue; }
          sendToUser(userId, "routine:start", { accountId: id, routineId: routine.id, config: buildRoutineConfig(routine) });
        }
        dispatched += 1;
      } catch (e) {
        errors.push({ accountId: id, error: String(e) });
      }
    }
    res.json({ dispatched, errors });
  });

  // ── EVENTS / STATS ───────────────────────────────────────────────────────
  app.get("/api/wa/events", requireAuth, (req, res) => {
    const { user } = req.auth;
    const opts = {
      limit: readPositiveInt(req.query.limit, 100, 500),
      accountId: req.query.accountId || undefined,
      type: req.query.type || undefined,
      since: req.query.since || undefined,
    };
    let events = listEvents(opts);
    // setter: filtramos por userId
    if (user.role !== "admin") events = events.filter((e) => e.userId === user.id);
    res.json(events);
  });

  app.get("/api/wa/stats/summary", requireAuth, requireRole("admin"), (_req, res) => {
    const accounts = listAccounts();
    const byStatus = {};
    for (const a of accounts) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const presence = getPresenceList();
    const onlineSetters = presence.filter((p) => p.role !== "admin" && p.online).length;
    const totalSetters = presence.filter((p) => p.role !== "admin").length;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const events = listEvents({ limit: 500 }).filter((e) => new Date(e.createdAt).getTime() >= since);
    const msgs = events.filter((e) => e.type === "message-send-attempted").length;
    res.json({
      totalAccounts: accounts.length,
      totalSetters,
      onlineSetters,
      byStatus,
      eventsLast24h: events.length,
      msgsLast24h: msgs,
    });
  });

  app.get("/api/wa/stats/events-by-hour", requireAuth, requireRole("admin"), (req, res) => {
    const hours = readPositiveInt(req.query.hours, 24, 168);
    const type = req.query.type || undefined;
    res.json(eventsByHour({ hours, type }));
  });

  app.get("/api/wa/stats/presence", requireAuth, requireRole("admin"), (_req, res) => {
    res.json(getPresenceList());
  });

  // Backup: devuelve los 3 archivos JSON del módulo WA para pre-deploy
  app.get("/api/wa/admin/export", requireAuth, requireRole("admin"), (_req, res) => {
    res.json({
      accounts: { accounts: listAccounts() },
      routines: { routines: listRoutines() },
      events: { events: listEvents({ limit: 500 }) },
      exportedAt: new Date().toISOString(),
    });
  });

  // Reporte HTTP de la desktop como fallback al WS (para ambientes con WS bloqueado)
  app.post("/api/wa/events", requireAuth, (req, res) => {
    const { accountId, type, payload, status, phone } = req.body || {};
    if (!type) return res.status(400).json({ error: "type requerido" });
    const ev = appendEvent({ accountId, userId: req.auth.user.id, type, payload });
    if (status) setAccountStatus(accountId, status, phone);
    res.json({ ok: true, eventId: ev.id });
  });
}

// helper para tener acceso a un body parser local si hace falta
function express_json(_app) {
  // GoogleSrapper ya tiene express.json() global con limit 50mb, así que no hace falta.
  return (_req, _res, next) => next();
}
