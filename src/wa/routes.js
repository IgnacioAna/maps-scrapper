// HTTP routes del módulo WA. Se montan con prefix /api/wa.
// Reusa el sistema de auth de GoogleSrapper (requireAuth, requireRole).
import jwt from "jsonwebtoken";
import {
  listAccounts, getAccount, createAccount, updateAccount, deleteAccount,
  attachRoutine, setAssignment, setAccountStatus,
  listRoutines, getRoutine, createRoutine, updateRoutine, deleteRoutine,
  listEvents, eventsByHour,
  appendEvent,
  effectivePhases, currentPhaseFor, warmingDayOf,
  startWarming, markBannedTemporarily, resetWarming,
} from "./data.js";
import { sendToUser, getPresenceList } from "./gateway.js";

function readPositiveInt(value, def, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

const HARD_MAX_DAILY = 2000;
const HARD_MIN_DRIP_MS = 3000;

// Valida y clampa una fase. Devuelve [error, sanitizedPhase].
function sanitizePhase(p) {
  if (!p || typeof p !== "object") return ["fase inválida"];
  const dailyMessages = parseInt(p.dailyMessages, 10);
  const dripMinMs = parseInt(p.dripMinMs, 10);
  const dripMaxMs = parseInt(p.dripMaxMs, 10);
  if (!Number.isFinite(dailyMessages) || dailyMessages < 1 || dailyMessages > HARD_MAX_DAILY) {
    return [`dailyMessages debe estar entre 1 y ${HARD_MAX_DAILY}`];
  }
  if (!Number.isFinite(dripMinMs) || dripMinMs < HARD_MIN_DRIP_MS) {
    return [`dripMinMs debe ser >= ${HARD_MIN_DRIP_MS}`];
  }
  if (!Number.isFinite(dripMaxMs) || dripMaxMs < dripMinMs) {
    return ["dripMaxMs debe ser >= dripMinMs"];
  }
  return [null, {
    name: p.name ? String(p.name) : "",
    untilDay: p.untilDay === null || p.untilDay === undefined ? null : parseInt(p.untilDay, 10),
    dailyMessages,
    dripMinMs,
    dripMaxMs,
    allowAutomation: !!p.allowAutomation,
  }];
}

function sanitizeRoutine(input) {
  if (!input || typeof input.name !== "string" || !input.name.trim()) {
    return ["name es requerido"];
  }
  const out = {
    name: input.name.trim(),
    hourStart: clampInt(input.hourStart, 0, 23, 9),
    hourEnd: clampInt(input.hourEnd, 0, 23, 19),
    timezone: typeof input.timezone === "string" && input.timezone ? input.timezone : "America/Argentina/Buenos_Aires",
    messages: Array.isArray(input.messages) ? input.messages.map(String).filter(Boolean) : [],
    targets: Array.isArray(input.targets) ? input.targets.map((t) => String(t).replace(/[^\d]/g, "")).filter(Boolean) : [],
    autoReply: !!input.autoReply,
    autoReplies: Array.isArray(input.autoReplies) ? input.autoReplies.map(String).filter(Boolean) : [],
    hardMaxDailyMessages: clampInt(input.hardMaxDailyMessages, 1, HARD_MAX_DAILY, HARD_MAX_DAILY),
    hardMinDripMs: Math.max(parseInt(input.hardMinDripMs, 10) || HARD_MIN_DRIP_MS, HARD_MIN_DRIP_MS),
    banCooldownDays: clampInt(input.banCooldownDays, 1, 30, 4),
    minDeliveryRatePct: clampInt(input.minDeliveryRatePct, 50, 100, 90),
  };
  if (Array.isArray(input.phases) && input.phases.length > 0) {
    const sanitized = [];
    for (const p of input.phases) {
      const [err, ok] = sanitizePhase(p);
      if (err) return [err];
      sanitized.push(ok);
    }
    out.phases = sanitized;
  } else {
    out.phases = [];
  }
  return [null, out];
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
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
    const [err, payload] = sanitizeRoutine(req.body || {});
    if (err) return res.status(400).json({ error: err });
    res.json(createRoutine(payload));
  });

  app.put("/api/wa/routines/:id", requireAuth, requireRole("admin"), (req, res) => {
    const [err, payload] = sanitizeRoutine(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const updated = updateRoutine(req.params.id, payload);
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

  // Construye config completo para el desktop. Calcula fase actual de la cuenta
  // basado en el día de warming (tiempo desde routineStartedAt). Aplica caps.
  function buildRoutineConfig(routine, account) {
    const day = warmingDayOf(account);
    const phase = currentPhaseFor(routine, day);
    const hardMaxDaily = routine.hardMaxDailyMessages ?? 2000;
    const hardMinDrip = routine.hardMinDripMs ?? 3000;
    return {
      id: routine.id,
      name: routine.name,
      hourStart: routine.hourStart ?? 9,
      hourEnd: routine.hourEnd ?? 19,
      timezone: routine.timezone || "America/Argentina/Buenos_Aires",
      messages: routine.messages || [],
      targets: (routine.targets || []).map((p) => ({ phone: String(p) })),
      autoReply: !!routine.autoReply,
      autoReplies: routine.autoReplies || [],
      // Fase y caps
      warmingDay: day,
      currentPhase: {
        ...phase,
        // clamps:
        dailyMessages: Math.min(phase.dailyMessages, hardMaxDaily),
        dripMinMs: Math.max(phase.dripMinMs, hardMinDrip),
        dripMaxMs: Math.max(phase.dripMaxMs, hardMinDrip),
      },
      phases: effectivePhases(routine),
      hardMaxDailyMessages: hardMaxDaily,
      hardMinDripMs: hardMinDrip,
      banCooldownDays: routine.banCooldownDays ?? 4,
      minDeliveryRatePct: routine.minDeliveryRatePct ?? 90,
      pendingThresholdMs: routine.pendingThresholdMs ?? 5 * 60 * 1000,
      // estado de la cuenta
      account: {
        id: account.id,
        routineStartedAt: account.routineStartedAt,
        staggerOffsetMs: account.staggerOffsetMs || 0,
        msgsSentToday: account.msgsSentToday || 0,
        pauseUntil: account.pauseUntil,
      },
    };
  }

  // ── ONE-CLICK CALENTAR ─────────────────────────────────────────────────
  // Endpoint pensado para el botón "🔥 Calentar este número" del panel admin.
  // Si la cuenta no tiene routine, busca o crea la "SCM Default" con la
  // curva pragmática SCM (defaultPhases) y se la attachea. Después arranca.
  // Idempotente: si ya está calentando, devuelve el estado actual sin re-arrancar.
  app.post("/api/wa/accounts/:id/start-warming-default", requireAuth, requireRole("admin"), async (req, res) => {
    let account = getAccount(req.params.id);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });

    // 1) Buscar o crear routine SCM Default
    let routine = listRoutines().find((r) => r.name === "SCM Default" && (!r.targets || r.targets.length === 0));
    if (!routine) {
      routine = createRoutine({
        name: "SCM Default",
        // phases vacío → effectivePhases() cae a defaultPhases() (curva SCM)
        phases: [],
        hourStart: 9,
        hourEnd: 19,
        timezone: "America/Argentina/Buenos_Aires",
        // messages vacío inicialmente — el setter puede agregar después si quiere
        // que el warming engine mande mensajes auto. Para fase inicial, mejor manual.
        messages: [
          "Hola, ¿cómo estás?",
          "Buenas, ¿cómo va?",
          "Hola! Una consulta breve",
        ],
        // targets vacío → no auto-envía hasta que el admin configure targets
        targets: [],
        autoReply: false,
      });
    }

    // 2) Attach routine a la cuenta (si no la tiene ya)
    if (account.routineId !== routine.id) {
      account = attachRoutine(account.id, routine.id);
    }

    // 3) Si la cuenta NO tenía routineStartedAt, arranca día 1 ahora
    if (!account.routineStartedAt) {
      account = startWarming(account.id);
    }

    // 4) Emitir routine:start al setter dueño
    sendToUser(userId, "routine:start", {
      accountId: account.id,
      routineId: routine.id,
      config: buildRoutineConfig(routine, account),
    });

    appendEvent({
      accountId: account.id,
      userId: req.auth.user.id,
      type: "warming-default-started",
      payload: {
        warmingDay: warmingDayOf(account),
        phaseName: currentPhaseFor(routine, warmingDayOf(account)).name,
      },
    });

    // P4 (2026-05-22): si admin pide enrollInAi=true (default true), enrolar
    // la cuenta tambien en la red de warming AI-to-AI. Asi un solo click
    // arranca el warming clasico Y la red de chats entre cuentas propias.
    // Si ya esta enrolada, no rompe nada (devuelve "ya inscripta").
    const enrollInAi = req.body?.enrollInAi !== false; // default true
    let aiEnrollResult = null;
    if (enrollInAi) {
      try {
        const wnStore = await import("./warming-network/store.js");
        const { personaFor } = await import("./warming-network/persona-generator.js");
        const persona = personaFor(account.id);
        aiEnrollResult = wnStore.enrollAccount({
          accountId: account.id,
          setterId: userId,
          persona,
          boostDays: 3, // arranca con boost 3d para volumen rapido
        });
      } catch (e) {
        aiEnrollResult = { ok: false, reason: "AI net enroll failed: " + e.message };
      }
    }

    res.json({
      ok: true,
      routineId: routine.id,
      routineName: routine.name,
      warmingDay: warmingDayOf(account),
      currentPhase: currentPhaseFor(routine, warmingDayOf(account)),
      account: {
        id: account.id,
        routineStartedAt: account.routineStartedAt,
        staggerOffsetMs: account.staggerOffsetMs,
      },
      aiNetwork: aiEnrollResult,
    });
  });

  app.post("/api/wa/commands/start-routine", requireAuth, requireRole("admin"), (req, res) => {
    let account = getAccount(req.body?.accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    if (!account.routineId) return res.status(400).json({ error: "cuenta sin routine" });
    const routine = getRoutine(account.routineId);
    if (!routine) return res.status(404).json({ error: "routine no encontrada" });
    const userId = ownerUserIdOfAccount(account);
    if (!userId) return res.status(400).json({ error: "cuenta sin asignar a setter" });
    // Si la cuenta NO tenía routineStartedAt, lo seteamos (día 1 arranca acá)
    if (!account.routineStartedAt || req.body?.resume === false) {
      account = startWarming(account.id);
    }
    sendToUser(userId, "routine:start", {
      accountId: account.id,
      routineId: routine.id,
      config: buildRoutineConfig(routine, account),
    });
    res.json({ ok: true, warmingDay: warmingDayOf(account), staggerOffsetMs: account.staggerOffsetMs });
  });

  app.post("/api/wa/accounts/:id/reset-warming", requireAuth, requireRole("admin"), (req, res) => {
    const acc = resetWarming(req.params.id);
    if (!acc) return res.status(404).json({ error: "cuenta no encontrada" });
    appendEvent({ accountId: acc.id, userId: req.auth.user.id, type: "warming-reset" });
    res.json(acc);
  });

  app.post("/api/wa/accounts/:id/mark-banned", requireAuth, requireRole("admin"), (req, res) => {
    const acc = getAccount(req.params.id);
    if (!acc) return res.status(404).json({ error: "cuenta no encontrada" });
    const cooldown = req.body?.cooldownDays || 4;
    const updated = markBannedTemporarily(acc.id, cooldown);
    appendEvent({ accountId: acc.id, userId: req.auth.user.id, type: "ban-marked", payload: { cooldownDays: cooldown } });
    // notif al setter dueño
    const userId = ownerUserIdOfAccount(acc);
    if (userId) sendToUser(userId, "routine:stop", { accountId: acc.id });
    res.json(updated);
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
          let acc = account;
          if (!acc.routineStartedAt) acc = startWarming(acc.id);
          sendToUser(userId, "routine:start", { accountId: id, routineId: routine.id, config: buildRoutineConfig(routine, acc) });
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
    // Audit 2026-05-23: ownership check antes de permitir update de status.
    // Sin esto un setter podía pisar el status/phone de cualquier cuenta
    // ajena vía este endpoint HTTP (espejo del fix en gateway.js socket).
    if (accountId && status) {
      const { user } = req.auth;
      if (user.role !== "admin") {
        const acc = getAccount(accountId);
        const isOwner = acc?.assignment?.kind === "setter" && acc?.assignment?.refId === user.setterId;
        if (!isOwner) {
          return res.status(403).json({ error: "no autorizado a actualizar estado de esta cuenta" });
        }
      }
    }
    try {
      const ev = appendEvent({ accountId, userId: req.auth.user.id, type, payload });
      if (status) setAccountStatus(accountId, status, phone);
      res.json({ ok: true, eventId: ev.id });
    } catch (err) {
      console.error("[wa-routes] POST /api/wa/events error:", err?.message || err);
      res.status(500).json({ error: "error guardando evento" });
    }
  });

  // ── WARMING NETWORK (AI-to-AI) ──────────────────────────────────────────
  // Endpoints de gestión del pool y observabilidad. El orchestrator corre
  // en background (boot del server lo arranca).

  app.get("/api/wa/warming-network/pool", requireAuth, requireRole("admin"), async (_req, res) => {
    const wnStore = await import("./warming-network/store.js");
    res.json(wnStore.listPool());
  });

  app.post("/api/wa/warming-network/enroll/:accountId", requireAuth, requireRole("admin"), async (req, res) => {
    const account = getAccount(req.params.accountId);
    if (!account) return res.status(404).json({ error: "cuenta no encontrada" });
    const setterId = ownerUserIdOfAccount(account);
    if (!setterId) return res.status(400).json({ error: "cuenta sin asignar a setter" });

    const { personaFor } = await import("./warming-network/persona-generator.js");
    const wnStore = await import("./warming-network/store.js");
    const persona = personaFor(account.id);
    const result = wnStore.enrollAccount({ accountId: account.id, setterId, persona });
    if (!result.ok) return res.status(400).json({ error: result.reason });

    appendEvent({
      accountId: account.id,
      userId: req.auth.user.id,
      type: "warming-network-enrolled",
      payload: { persona: { name: persona.name, age: persona.age, city: persona.city } },
    });
    res.json({ ok: true, persona });
  });

  app.post("/api/wa/warming-network/unenroll/:accountId", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const result = wnStore.unenrollAccount(req.params.accountId);
    appendEvent({
      accountId: req.params.accountId,
      userId: req.auth.user.id,
      type: "warming-network-unenrolled",
    });
    res.json(result);
  });

  app.post("/api/wa/warming-network/pause/:accountId", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const result = wnStore.pauseAccount(req.params.accountId, req.body?.reason || "manual");
    res.json(result);
  });

  app.post("/api/wa/warming-network/resume/:accountId", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const result = wnStore.resumeAccount(req.params.accountId);
    res.json(result);
  });

  app.get("/api/wa/warming-network/pairs", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const accountId = req.query.accountId;
    if (accountId) {
      res.json(wnStore.listPairsForAccount(accountId));
    } else {
      res.json(wnStore.listActivePairs());
    }
  });

  app.get("/api/wa/warming-network/messages", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const limit = parseInt(req.query.limit, 10) || 50;
    const accountId = req.query.accountId;
    const pairId = req.query.pairId;
    res.json(wnStore.listRecentSentMessages({ limit, accountId, pairId }));
  });

  app.get("/api/wa/warming-network/stats", requireAuth, requireRole("admin"), async (_req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const llm = await import("./warming-network/llm-client.js");
    const stats = wnStore.getStats();
    const llmStats = llm.getLLMStats();
    const pool = wnStore.listPool();
    const pairs = wnStore.listActivePairs();
    res.json({
      pool: { total: pool.length, active: pool.filter((p) => p.active).length },
      pairs: { active: pairs.length },
      messages: stats,
      llm: llmStats,
    });
  });

  // Forzar tick manual del orchestrator (debug / testing).
  // Timeout 25s para no colgar la HTTP request si el LLM tarda mucho.
  // El tick sigue corriendo en background — solo cortamos la respuesta.
  app.post("/api/wa/warming-network/tick", requireAuth, requireRole("admin"), async (_req, res) => {
    const orch = await import("./warming-network/orchestrator.js");
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 25000));
    const result = await Promise.race([orch.tick().then(() => ({ ok: true })), timeout]);
    res.json(result);
  });

  // Forzar procesamiento INMEDIATO de UN par específico, ignorando nextActionAt.
  // Útil para test: aprietas el botón y el sistema arranca a generar el primer
  // mensaje YA (en vez de esperar 30-90s).
  app.post("/api/wa/warming-network/tick-pair/:pairId", requireAuth, requireRole("admin"), async (req, res) => {
    const orch = await import("./warming-network/orchestrator.js");
    const result = await orch.tickSpecificPair(req.params.pairId, { forceImmediate: true });
    res.json(result);
  });

  // Admin nuke option: borra TODOS los pares (incluyendo zombies/closed) del
  // JSON. Útil cuando hay pares colgados que bloquean el re-pareo de cuentas.
  // Después llama fillPairs() para crear pares nuevos desde cero.
  app.post("/api/wa/warming-network/reset-pairs", requireAuth, requireRole("admin"), async (req, res) => {
    const fs = (await import("node:fs")).default;
    const path = (await import("node:path")).default;
    const filePath = path.join(deps.dataDir || "data", "warming-network.json");
    let payload;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      payload = JSON.parse(raw);
    } catch {
      return res.json({ ok: false, reason: "warming-network.json no existe" });
    }
    const oldPairs = (payload.pairs || []).length;
    payload.pairs = []; // borrar todos los pares
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

    // Disparar tick para que fillPairs cree pares nuevos
    const orch = await import("./warming-network/orchestrator.js");
    await orch.tick();

    res.json({ ok: true, deletedPairs: oldPairs, message: "pares zombi borrados, fillPairs disparado" });
  });

  // Diagnóstico por par: por qué este par no avanzó / qué hizo el último tick
  app.get("/api/wa/warming-network/diagnostic", requireAuth, requireRole("admin"), async (req, res) => {
    const orch = await import("./warming-network/orchestrator.js");
    const pairId = req.query.pairId;
    if (pairId) {
      res.json(orch.getDiagnostic(pairId) || { reason: "no diagnostic yet" });
    } else {
      res.json(orch.getAllDiagnostics());
    }
  });

  // P7: simular conversacion sin enviar realmente al wa-multi.
  // body: { pairId, count: 3, alternate: true }
  // - Si no se pasa pairId, intenta el primer par activo.
  // - Genera N mensajes alternando A→B→A→B... usando el LLM real,
  //   pero NO emite socket al wa-multi (no se envia nada por WhatsApp).
  // - Devuelve los mensajes generados para preview en panel.
  // - Cuenta tokens/costo en stats LLM (porque el call real al modelo si pasa).
  app.post("/api/wa/warming-network/simulate", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const conv = await import("./warming-network/conversation.js");
    const count = Math.max(1, Math.min(10, Number(req.body?.count) || 3));
    let pairId = req.body?.pairId;
    let pair = pairId ? wnStore.getPair(pairId) : null;
    if (!pair) {
      const active = wnStore.listActivePairs();
      if (active.length === 0) return res.status(400).json({ error: "no hay pares activos para simular" });
      pair = active[0];
      pairId = pair.id;
    }
    const memberA = wnStore.getPoolMember(pair.accountA);
    const memberB = wnStore.getPoolMember(pair.accountB);
    if (!memberA || !memberB) return res.status(400).json({ error: "alguno de los miembros no esta en el pool" });

    // Trabajamos sobre una COPIA del par para no contaminar el historial real
    const simPair = {
      ...pair,
      history: [...(pair.history || [])],
    };
    const generated = [];
    let nextSender = "A"; // siempre arranca A para simplicidad
    if (simPair.history.length > 0) {
      const last = simPair.history[simPair.history.length - 1];
      nextSender = last.from === "A" ? "B" : "A";
    }

    for (let i = 0; i < count; i++) {
      const sender = nextSender === "A" ? memberA : memberB;
      const receiver = nextSender === "A" ? memberB : memberA;
      try {
        const result = await conv.generateMessage(simPair, sender.persona, receiver.persona);
        const text = (result && result.text) || "";
        if (!text) {
          generated.push({ from: nextSender, by: sender.persona.name, error: "LLM devolvio vacio" });
          break;
        }
        simPair.history.push({ from: nextSender, text, at: new Date().toISOString() });
        generated.push({
          from: nextSender,
          by: sender.persona.name,
          to: receiver.persona.name,
          text,
          llmCost: result.llmCost,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
      } catch (err) {
        generated.push({ from: nextSender, by: sender.persona.name, error: err.message });
        break;
      }
      nextSender = nextSender === "A" ? "B" : "A";
    }
    res.json({
      pairId,
      pair: {
        accountA: pair.accountA,
        accountB: pair.accountB,
        state: pair.state,
        nameA: memberA.persona.name,
        nameB: memberB.persona.name,
      },
      generated,
      note: "SIMULACION — NO se envio ningun mensaje real por WhatsApp. Costo IA si fue real.",
    });
  });

  // P3: extender/cancelar modo boost de una cuenta.
  // body: { days: number } - 0 cancela, >0 setea (cap interno 7d en store)
  app.post("/api/wa/warming-network/boost/:accountId", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const days = Number(req.body?.days);
    if (!Number.isFinite(days)) return res.status(400).json({ error: "days numerico requerido" });
    const result = wnStore.setBoost(req.params.accountId, days);
    if (!result.ok) return res.status(404).json({ error: result.reason });
    // Tick inmediato para que el cambio se note rapido
    try {
      const orch = await import("./warming-network/orchestrator.js");
      void orch.tick();
    } catch {}
    res.json(result);
  });

  // P6: salud por cuenta. Devuelve datos operativos para decidir si una
  // cuenta esta viva, activa, productiva.
  app.get("/api/wa/warming-network/account-health/:accountId", requireAuth, requireRole("admin"), async (req, res) => {
    const wnStore = await import("./warming-network/store.js");
    const accountId = req.params.accountId;
    const member = wnStore.getPoolMember(accountId);
    if (!member) return res.status(404).json({ error: "cuenta no esta en pool" });

    const pairs = wnStore.listPairsForAccount(accountId);
    const allSent = wnStore.listRecentSentMessages({ limit: 200, accountId });
    const lastSent = allSent.find((m) => m.fromAccount === accountId) || null;
    const lastReceived = allSent.find((m) => m.toAccount === accountId) || null;
    // Sumar mensajes enviados ultimas 24h por esta cuenta (para detectar inactivas)
    const oneDayAgo = Date.now() - 24 * 3600 * 1000;
    const sent24h = allSent.filter((m) => m.fromAccount === accountId && new Date(m.sentAt).getTime() > oneDayAgo).length;

    res.json({
      accountId,
      setterId: member.setterId,
      enrolledAt: member.enrolledAt,
      active: member.active,
      pausedReason: member.pausedReason,
      boostUntil: member.boostUntil || null,
      persona: {
        name: member.persona.name,
        age: member.persona.age,
        city: member.persona.city,
        replySpeed: member.persona.replySpeed,
        activeWindow: member.persona.activeWindow,
      },
      pairs: {
        active: pairs.length,
        ids: pairs.map((p) => p.id),
      },
      activity: {
        sentLast24h: sent24h,
        lastSentAt: lastSent?.sentAt || null,
        lastSentPreview: lastSent?.text?.slice(0, 60) || null,
        lastReceivedAt: lastReceived?.sentAt || null,
        lastReceivedPreview: lastReceived?.text?.slice(0, 60) || null,
      },
    });
  });

  // Endpoint que recibe del wa-multi cuando una cuenta del pool RECIBE un
  // mensaje de otra cuenta del pool (warming inbound). Marca el historial
  // del par y NO emite evento de "ai-classified-inbound" (filtra del IA Inbox).
  app.post("/api/wa/warming-network/inbound", requireAuth, async (req, res) => {
    const { receiverAccountId, fromPhone, text } = req.body || {};
    if (!receiverAccountId || !fromPhone || !text) {
      return res.status(400).json({ error: "receiverAccountId, fromPhone, text requeridos" });
    }

    // Audit 2026-05-23: ownership check del receiverAccountId. Sin esto un
    // setter podía ensuciar el historial del warming network de cuentas
    // ajenas (ej: forzar mensajes "inbound" falsos de un par que no es suyo).
    const { user } = req.auth;
    if (user.role !== "admin") {
      const receiverAccount = getAccount(receiverAccountId);
      const isOwner = receiverAccount?.assignment?.kind === "setter" && receiverAccount?.assignment?.refId === user.setterId;
      if (!isOwner) {
        return res.status(403).json({ error: "no autorizado a reportar inbound sobre esta cuenta" });
      }
    }

    const wnStore = await import("./warming-network/store.js");
    const orch = await import("./warming-network/orchestrator.js");

    // Buscar el par activo del receiver donde el otro tenga el teléfono fromPhone
    // Como en wa-multi solo conocemos el teléfono que vino, necesitamos resolver
    // a accountId. Simplificación: si fromPhone matchea con el phone de alguna
    // cuenta del pool, esa es la sender.
    const senderAccount = listAccounts().find((a) => a.phone && a.phone.replace(/\D/g, "").endsWith(String(fromPhone).replace(/\D/g, "").slice(-8)));
    if (!senderAccount) {
      return res.json({ ok: false, reason: "sender no encontrado en accounts" });
    }
    const senderInPool = wnStore.getPoolMember(senderAccount.id);
    if (!senderInPool) {
      return res.json({ ok: false, reason: "sender no esta en pool" });
    }

    // Encontrar el par activo entre receiver y sender
    const pairs = wnStore.listPairsForAccount(receiverAccountId);
    const pair = pairs.find(
      (p) =>
        (p.accountA === senderAccount.id && p.accountB === receiverAccountId) ||
        (p.accountB === senderAccount.id && p.accountA === receiverAccountId),
    );
    if (!pair) {
      return res.json({ ok: false, reason: "no hay par activo" });
    }

    orch.onWarmingInboundReceived({
      pairId: pair.id,
      fromAccountId: senderAccount.id,
      text: String(text).slice(0, 500),
    });
    res.json({ ok: true, pairId: pair.id });
  });
}

// helper para tener acceso a un body parser local si hace falta
function express_json(_app) {
  // GoogleSrapper ya tiene express.json() global con limit 50mb, así que no hace falta.
  return (_req, _res, next) => next();
}
