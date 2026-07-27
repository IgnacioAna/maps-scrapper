// Phase 21 (REP-06/07/08) — Regresión de la cola de envío al grupo de WhatsApp.
//
// Lo que esta suite protege, en una línea: que un reporte NUNCA se marque como
// entregado sin que el desktop lo haya confirmado. El analog que se copió
// (scheduledMessagesTick) marca `status='sent'` en el mismo instante en que emite
// el evento, sin esperar nada: si alguien "simplifica" el tick hacia ese patrón,
// el test "el item queda en sending, NUNCA en sent" falla.
//
// También cubre: guard de alcanzabilidad antes de emitir (REP-07), un solo envío
// en vuelo (espaciado de REP-08), consolidación de diarios (D-26), expiración a 3
// días con el semanal exento (D-26), guard por período cubierto (D-28), nota de
// baches en TODO envío (D-05), fallback por DM (D-02), authz de los dos eventos de
// socket (T-21-06 / T-21-07), cap del historial (D-27) y round-trip de persistencia.
//
// Sin fake timers y sin sockets reales: `nowTs` se inyecta en reportQueueTick y el
// gateway es un doble que captura lo emitido.

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `report-queue-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rq@local.test";
process.env.ADMIN_PASSWORD = "rqpass1234";
process.env.JWT_SECRET = "test-secret-rq";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST
process.env.RESEND_API_KEY = ""; // regla #121: definida-VACÍA, jamás delete
process.env.REPORT_EMAILS = "";
process.env.REPORT_DM_FALLBACK = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-rq@local.test", name: "AdminRQ", role: "admin", status: "active", setterId: "", password: pwd("rqpass1234") },
    { id: "u_v", email: "v-rq@local.test", name: "Vendedora", role: "setter", status: "active", setterId: "s_v", password: pwd("vpass123456") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_v", name: "Vendedora" }], variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const Q = globalThis.__reportQueue;
const DR = globalThis.__dailyReport;   // _reportPanelStatus (CR-01: mismo guard que el tick)
const MAX = Q.consts.REPORT_MAX_ATTEMPTS;
const TIMEOUT_MS = Q.consts.REPORT_SEND_TIMEOUT_MS;

// dom 26/07/2026 23:00 AR (la hora del envío diario, D-10).
const NOW = Date.UTC(2026, 6, 27, 2, 0, 0);
const TODAY = "2026-07-26";
const YESTERDAY = "2026-07-25";
const OLD4 = "2026-07-22";        // 4 días atrás → expira (D-26)
const REPORTS = path.join(tmpData, "reports.json");

const ADMIN = { id: "u_admin", role: "admin", name: "AdminRQ" };
const SETTER = { id: "u_v", role: "setter", name: "Vendedora" };
const TRANSPORT = { userId: "u_admin", accountId: "acc_reportes", groupName: "Socios SCM", groupJid: null };

function seed(extra = {}) {
  const state = {
    lastWeeklyReportAt: "2026-07-20T11:00:00.000Z", // clave de Phase 19: no se pisa
    config: { paused: false, backupEmails: [], transport: { ...TRANSPORT } },
    queue: [], history: [],
    ...extra,
  };
  if (extra.config) state.config = { paused: false, backupEmails: [], transport: { ...TRANSPORT }, ...extra.config };
  fs.writeFileSync(REPORTS, JSON.stringify(state, null, 2));
  return state;
}
const read = () => JSON.parse(fs.readFileSync(REPORTS, "utf8"));
const findItem = (id) => {
  const s = read();
  return [...(s.queue || []), ...(s.history || [])].find((i) => i.id === id) || null;
};

let seq = 0;
function mkItem(o = {}) {
  seq++;
  return {
    id: o.id || `rpt_test_${seq}`,
    kind: "daily", periodKey: o.dayStr || TODAY, dayStr: o.dayStr || TODAY,
    text: `*Todas trabajaron hoy*\nReporte diario · día ${seq}`,
    line: `*día ${seq}* 10 llam · 4 at`,
    phone: "", parentId: null,
    status: "pending", attempts: 0, sendAttempts: 0,
    confessedAt: null, confessedIds: [], consolidatedInto: null, lastText: "",
    createdAt: new Date(NOW - (100 - seq) * 1000).toISOString(),
    sendingAt: null, sentAt: null, failedAt: null, expiredAt: null, lastAttemptAt: null,
    lastFailureReason: null, method: null, matchedName: null, matchedJid: null,
    ...o,
  };
}

// Gateway doble: nunca se toca un socket real. `isDesktopConnected` es lo que el
// tick consulta antes de emitir (CR-01: `isUserConnected` incluye las pestañas del
// navegador y el user del transporte es el mismo admin que tiene el panel abierto),
// y `sendToUser` captura el evento.
// `browserOnly:true` modela el escenario del blocker: navegador abierto, wa-multi
// CERRADO.
function mkGateway(online = true, browserOnly = false) {
  const emitted = [];
  const gw = {
    isUserConnected: () => online || browserOnly,
    isDesktopConnected: () => online,
    sendToUser: (userId, event, payload) => { emitted.push({ userId, event, payload }); return true; },
    getPresenceList: () => [],
  };
  gw.emitted = emitted;
  return gw;
}
let gw;

let adminCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-rq@local.test", password: "rqpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => {
  delete globalThis.__waGateway; // sobre globalThis, NO sobre process.env (regla #121)
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});
beforeEach(() => {
  seq = 0;
  process.env.REPORT_DM_FALLBACK = "";
  gw = mkGateway(true);
  globalThis.__waGateway = gw;
});

describe("encolado — guard por período cubierto (D-28)", () => {
  it("el mismo kind+periodKey no se encola dos veces", async () => {
    seed();
    const r1 = await Q.mutateReportsState((s) => Q.enqueueReportMessage(s, { kind: "daily", periodKey: TODAY, dayStr: TODAY, text: "reporte de hoy", line: "linea" }));
    expect(r1.queued).toBe(true);
    const r2 = await Q.mutateReportsState((s) => Q.enqueueReportMessage(s, { kind: "daily", periodKey: TODAY, dayStr: TODAY, text: "reporte de hoy otra vez", line: "linea" }));
    expect(r2).toMatchObject({ queued: false, reason: "periodo_ya_cubierto", id: r1.id });
    expect(read().queue.length).toBe(1);
  });

  it("un período ya ENTREGADO tampoco se re-manda (el guard mira el historial)", async () => {
    seed({ history: [mkItem({ status: "sent", periodKey: TODAY, dayStr: TODAY, sentAt: new Date(NOW).toISOString() })] });
    const r = await Q.mutateReportsState((s) => Q.enqueueReportMessage(s, { kind: "daily", periodKey: TODAY, dayStr: TODAY, text: "de nuevo", line: "l" }));
    expect(r).toMatchObject({ queued: false, reason: "periodo_ya_cubierto" });
    expect(read().queue.length).toBe(0);
  });

  it("el normalizador NO pisa el estado de Phase 19 y crea la estructura si falta", async () => {
    fs.writeFileSync(REPORTS, JSON.stringify({ lastWeeklyReportAt: "2026-07-20T11:00:00.000Z" }, null, 2));
    await Q.mutateReportsState((s) => Q.enqueueReportMessage(s, { kind: "custom", periodKey: "alerta_1", text: "alerta generica (D-06)" }));
    const s = read();
    expect(s.lastWeeklyReportAt).toBe("2026-07-20T11:00:00.000Z");
    expect(s.config.paused).toBe(false);
    expect(s.queue.length).toBe(1);
    expect(s.queue[0].kind).toBe("custom");
  });
});

describe("guard de alcanzabilidad — nada se marca sent sin confirmación (REP-07)", () => {
  it("sin gateway: el item queda pending y NO sent", async () => {
    seed({ queue: [mkItem({ id: "it_offline" })] });
    delete globalThis.__waGateway;
    const r = await Q.reportQueueTick(NOW);
    expect(r.emitted).toBe(false);
    expect(r.reason).toBe("desktop offline");
    const it = findItem("it_offline");
    expect(it.status).toBe("pending");
    expect(it.sentAt).toBe(null);
  });

  it("desktop offline: pending, attempts sube y sendAttempts NO (no quema el presupuesto)", async () => {
    seed({ queue: [mkItem({ id: "it_off2" })] });
    globalThis.__waGateway = mkGateway(false);
    await Q.reportQueueTick(NOW);
    let it = findItem("it_off2");
    expect(it.status).toBe("pending");
    expect(it.attempts).toBe(1);
    expect(it.sendAttempts).toBe(0);
    expect(it.lastFailureReason).toBe("desktop offline");
    await Q.reportQueueTick(NOW + 60000);
    it = findItem("it_off2");
    expect(it.attempts).toBe(2);
    expect(it.status).toBe("pending");
  });

  it("sin grupo configurado el item espera (no falla)", async () => {
    seed({ config: { transport: { userId: "", accountId: "", groupName: "", groupJid: null } }, queue: [mkItem({ id: "it_sg" })] });
    const r = await Q.reportQueueTick(NOW);
    expect(r).toMatchObject({ emitted: false, reason: "sin_grupo" });
    expect(findItem("it_sg").status).toBe("pending");
    expect(gw.emitted.length).toBe(0);
  });

  // CR-01 (21-REVIEW): el navegador del propio admin abre un socket por cookie
  // (wa.js, para cualquier user logueado) y `config.transport.userId` ES ese admin.
  // Con `isUserConnected` el guard pasaba con wa-multi CERRADO: se emitía a una room
  // sin handler, el item quedaba `sending` y el timeout de 150s quemaba una emisión
  // real del presupuesto. 20 vueltas → `failed` con la computadora solo apagada.
  it("browser abierto + desktop CERRADO: no emite y NO quema sendAttempts", async () => {
    seed({ queue: [mkItem({ id: "it_browser" })] });
    globalThis.__waGateway = mkGateway(false, true);   // isUserConnected true, isDesktopConnected false
    const r = await Q.reportQueueTick(NOW);
    expect(r).toMatchObject({ emitted: false, reason: "desktop offline" });
    const it = findItem("it_browser");
    expect(it.status).toBe("pending");
    expect(it.sendAttempts).toBe(0);   // ← el presupuesto intacto (decisión 2 de 21-02)
    expect(it.attempts).toBe(1);
    expect(globalThis.__waGateway.emitted.length).toBe(0);
  });

  it("gateway sin isDesktopConnected: NO emite (fallback conservador)", async () => {
    seed({ queue: [mkItem({ id: "it_legacy_gw" })] });
    const legacy = mkGateway(true);
    delete legacy.isDesktopConnected;                  // gateway viejo / parcialmente cargado
    globalThis.__waGateway = legacy;
    const r = await Q.reportQueueTick(NOW);
    expect(r).toMatchObject({ emitted: false, reason: "desktop offline" });
    expect(findItem("it_legacy_gw").sendAttempts).toBe(0);
    expect(legacy.emitted.length).toBe(0);
  });

  it("el panel reporta desktopOnline por el MISMO guard que el tick", async () => {
    seed({ queue: [] });
    globalThis.__waGateway = mkGateway(false, true);   // solo browser
    const st1 = DR._reportPanelStatus(Q._reportStateDefaults(read()));
    expect(st1.desktopOnline).toBe(false);
    globalThis.__waGateway = mkGateway(true);          // desktop de verdad
    const st2 = DR._reportPanelStatus(Q._reportStateDefaults(read()));
    expect(st2.desktopOnline).toBe(true);
  });
});

describe("emisión y correlación — el item queda en sending, jamás en sent", () => {
  it("emite UN report:send-message al grupo y deja el item en 'sending'", async () => {
    seed({ queue: [mkItem({ id: "it_emit" })] });
    const r = await Q.reportQueueTick(NOW);
    expect(r.emitted).toBe(true);
    expect(gw.emitted.length).toBe(1);
    const ev = gw.emitted[0];
    expect(ev.event).toBe("report:send-message");
    expect(ev.userId).toBe("u_admin");
    expect(ev.payload.queueId).toBe("it_emit#1");   // CR-03: correlación POR INTENTO
    expect(ev.payload.accountId).toBe("acc_reportes");
    expect(ev.payload.text).toContain("Reporte diario");
    expect(ev.payload.target).toEqual({ kind: "group", groupName: "Socios SCM", groupJid: null });
    const it = findItem("it_emit");
    expect(it.status).toBe("sending");   // ← el `sent` optimista del analog NO se replicó
    expect(it.status).not.toBe("sent");
    expect(it.sentAt).toBe(null);
    expect(it.sendAttempts).toBe(1);
  });

  it("un segundo tick con algo en vuelo no emite nada (espaciado >=60s, REP-08)", async () => {
    seed({ queue: [mkItem({ id: "it_a" }), mkItem({ id: "it_b", kind: "custom", periodKey: "c1", dayStr: "" })] });
    await Q.reportQueueTick(NOW);
    expect(gw.emitted.length).toBe(1);
    const r2 = await Q.reportQueueTick(NOW + 1000);
    expect(r2).toMatchObject({ emitted: false, reason: "envio_en_vuelo" });
    expect(gw.emitted.length).toBe(1);
  });

  it("resultado ok de un user autorizado → sent + groupJid backfilleado (D-03)", async () => {
    seed({ queue: [mkItem({ id: "it_ok" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_ok", ok: true, method: "pinned-row0", matchedName: "Socios SCM", matchedJid: "120363111@g.us" }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: "sent" });
    const it = findItem("it_ok");
    expect(it.status).toBe("sent");
    expect(it.method).toBe("pinned-row0");
    expect(read().config.transport.groupJid).toBe("120363111@g.us");
    expect(read().config.transport.jidCapturedAt).toBeTruthy();
  });

  it("resultado de un user NO autorizado se ignora: el item sigue en sending (T-21-06)", async () => {
    seed({ queue: [mkItem({ id: "it_spoof" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_spoof", ok: true, method: "pinned-row0" }, SETTER);
    expect(r).toMatchObject({ ok: false, reason: "no_autorizado" });
    expect(findItem("it_spoof").status).toBe("sending");
  });

  // WR-09: el guard corre FUERA del mutex. Adentro, mutateReportsState escribe
  // SIEMPRE — un emisor en loop forzaba una reescritura completa de reports.json
  // (más un warn) por evento rechazado, serializando el mutex con el tick.
  it("un resultado rechazado NO reescribe reports.json (write amplification)", async () => {
    // Se escribe a mano un JSON que el normalizador SÍ cambiaría si entrara al
    // mutex (sin config/queue/history): si el archivo queda igual, no hubo save.
    fs.writeFileSync(REPORTS, JSON.stringify({ lastWeeklyReportAt: "2026-07-19T11:00:00.000Z" }, null, 2));
    const before = fs.readFileSync(REPORTS, "utf8");
    for (let i = 0; i < 5; i++) {
      const r = await Q.handleReportSendResult({ queueId: `spam_${i}`, ok: true }, SETTER);
      expect(r).toMatchObject({ ok: false, reason: "no_autorizado" });
    }
    expect(fs.readFileSync(REPORTS, "utf8")).toBe(before);
  });

  it("queueId inexistente no lanza y no cambia nada", async () => {
    seed({ queue: [mkItem({ id: "it_x" })] });
    await Q.reportQueueTick(NOW);
    const before = JSON.stringify(read().queue);
    const r = await Q.handleReportSendResult({ queueId: "no_existe", ok: true }, ADMIN);
    expect(r).toMatchObject({ ok: false, reason: "item_no_en_vuelo" });
    expect(JSON.stringify(read().queue)).toBe(before);
    const r2 = await Q.handleReportSendResult({ ok: true }, ADMIN);
    expect(r2).toMatchObject({ ok: false, reason: "sin_queueId" });
  });
});

describe("fallos del envío", () => {
  it("group-not-found con REPORT_DM_FALLBACK → 3 items dm con parentId (D-02)", async () => {
    process.env.REPORT_DM_FALLBACK = "+5491111111111, +5491122222222,+5491133333333";
    seed({ queue: [mkItem({ id: "it_gnf" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_gnf", ok: false, reason: "group-not-found" }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: "failed", dmQueued: 3 });
    expect(findItem("it_gnf").status).toBe("failed");
    const dms = read().queue.filter((i) => i.kind === "dm");
    expect(dms.length).toBe(3);
    expect(dms.every((d) => d.parentId === "it_gnf" && d.status === "pending")).toBe(true);
    expect(dms.map((d) => d.phone)).toEqual(["+5491111111111", "+5491122222222", "+5491133333333"]);
    // El próximo tick manda el primer DM al MISMO user, con target dm.
    const r2 = await Q.reportQueueTick(NOW + 60000);
    expect(r2.emitted).toBe(true);
    expect(gw.emitted[1].payload.target).toEqual({ kind: "dm", phone: "+5491111111111" });
  });

  it("account-not-connected → failed definitivo, sin reintento", async () => {
    seed({ queue: [mkItem({ id: "it_anc" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_anc", ok: false, reason: "account-not-connected" }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: "failed" });
    const it = findItem("it_anc");
    expect(it.status).toBe("failed");
    expect(it.sendAttempts).toBe(MAX);
    expect(gw.emitted.length).toBe(1); // no se reintentó
    await Q.reportQueueTick(NOW + 60000);
    expect(gw.emitted.length).toBe(1);
  });

  it("un reason recuperable vuelve a pending y se reintenta", async () => {
    seed({ queue: [mkItem({ id: "it_retry" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_retry", ok: false, reason: "composer-not-found" }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: "pending" });
    expect(findItem("it_retry").status).toBe("pending");
    await Q.reportQueueTick(NOW + 60000);
    expect(gw.emitted.length).toBe(2);
    expect(findItem("it_retry").sendAttempts).toBe(2);
  });

  // ── CR-03 (21-REVIEW): el queueId se reusaba entre intentos ──
  it("cada reintento emite un attemptId distinto (#1, #2)", async () => {
    seed({ queue: [mkItem({ id: "it_att" })] });
    await Q.reportQueueTick(NOW);
    expect(gw.emitted[0].payload.queueId).toBe("it_att#1");
    await Q.handleReportSendResult({ queueId: "it_att#1", ok: false, reason: "composer-not-found" }, ADMIN);
    await Q.reportQueueTick(NOW + 60000);
    expect(gw.emitted[1].payload.queueId).toBe("it_att#2");
  });

  it("un ok TARDÍO (el item ya volvió a pending por timeout) cierra el item en vez de descartarse", async () => {
    // El desktop tardó más que REPORT_SEND_TIMEOUT_MS pero el mensaje SÍ salió.
    // Antes: `item_no_en_vuelo` → reporte entregado registrado como no entregado,
    // confesado como bache en el próximo mensaje, y el mismo texto tipeado de nuevo.
    seed({ queue: [mkItem({ id: "it_late" })] });
    await Q.reportQueueTick(NOW);
    const attempt = gw.emitted[0].payload.queueId;
    await Q.reportQueueTick(NOW + TIMEOUT_MS + 1000);          // timeout → pending
    expect(findItem("it_late").status).not.toBe("sent");
    const r = await Q.handleReportSendResult({ queueId: attempt, ok: true, method: "pinned-row0" }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: "sent" });
    expect(findItem("it_late").status).toBe("sent");
    // Y no vuelve a salir en las vueltas siguientes.
    const before = gw.emitted.length;
    await Q.reportQueueTick(NOW + TIMEOUT_MS + 120000);
    expect(gw.emitted.length).toBe(before);
  });

  it("un ok tardío del consolidado cierra a los 3 hermanos (lastGroupIds)", async () => {
    seed({ queue: [
      mkItem({ id: "g1", dayStr: "2026-07-24", periodKey: "2026-07-24" }),
      mkItem({ id: "g2", dayStr: "2026-07-25", periodKey: "2026-07-25" }),
      mkItem({ id: "g3", dayStr: "2026-07-26", periodKey: "2026-07-26" }),
    ] });
    const r0 = await Q.reportQueueTick(NOW);
    expect(r0.consolidated).toBe(3);
    await Q.reportQueueTick(NOW + TIMEOUT_MS + 1000);          // timeout: consolidatedInto se limpia
    await Q.handleReportSendResult({ queueId: "g1#1", ok: true, method: "pinned-row0" }, ADMIN);
    const sent = read().history.filter((i) => i.status === "sent").map((i) => i.id).sort();
    expect(sent).toEqual(["g1", "g2", "g3"]);
    expect(read().queue.length).toBe(0);
  });

  it("un fallo de un intento VIEJO no toca el intento en vuelo", async () => {
    seed({ queue: [mkItem({ id: "it_stale" })] });
    await Q.reportQueueTick(NOW);
    await Q.reportQueueTick(NOW + TIMEOUT_MS + 1000);          // timeout → pending
    await Q.reportQueueTick(NOW + TIMEOUT_MS + 61000);         // re-emite (#2)
    expect(gw.emitted[1].payload.queueId).toBe("it_stale#2");
    expect(findItem("it_stale").status).toBe("sending");
    const r = await Q.handleReportSendResult({ queueId: "it_stale#1", ok: false, reason: "composer-not-found" }, ADMIN);
    expect(r).toMatchObject({ ok: false, reason: "item_no_en_vuelo" });
    expect(findItem("it_stale").status).toBe("sending");       // el #2 sigue en vuelo
  });

  it("reason 'duplicate' no requeuea ni quema presupuesto (WR-03)", async () => {
    seed({ queue: [mkItem({ id: "it_dup" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_dup#1", ok: false, reason: "duplicate" }, ADMIN);
    expect(r).toMatchObject({ ok: false, reason: "duplicado_ignorado" });
    const it = findItem("it_dup");
    expect(it.status).toBe("sending");
    expect(it.sendAttempts).toBe(1);
  });

  it("invalid-payload es terminal: no gasta 20 intentos en los mismos bytes", async () => {
    seed({ queue: [mkItem({ id: "it_bad" })] });
    await Q.reportQueueTick(NOW);
    const r = await Q.handleReportSendResult({ queueId: "it_bad#1", ok: false, reason: "invalid-payload" }, ADMIN);
    expect(r).toMatchObject({ ok: true, status: "failed" });
    const it = findItem("it_bad");
    expect(it.status).toBe("failed");
    expect(it.sendAttempts).toBe(MAX);
    await Q.reportQueueTick(NOW + 60000);
    expect(gw.emitted.length).toBe(1);
  });

  it("timeout: lo que quedó en vuelo vuelve a pending, y agotado el presupuesto queda failed", async () => {
    // config.paused aísla el paso de timeout del re-emitido dentro del mismo tick.
    seed({ config: { paused: true }, queue: [mkItem({ id: "it_to", status: "sending", sendAttempts: 1, sendingAt: new Date(NOW - TIMEOUT_MS - 1000).toISOString() })] });
    const r = await Q.reportQueueTick(NOW);
    expect(r).toMatchObject({ emitted: false, reason: "pausado" });
    let it = findItem("it_to");
    expect(it.status).toBe("pending");
    expect(it.lastFailureReason).toBe("timeout");

    seed({ config: { paused: true }, queue: [mkItem({ id: "it_to2", status: "sending", sendAttempts: MAX, sendingAt: new Date(NOW - TIMEOUT_MS - 1000).toISOString() })] });
    await Q.reportQueueTick(NOW);
    it = findItem("it_to2");
    expect(it.status).toBe("failed");
    expect(it.lastFailureReason).toBe("timeout");
  });
});

describe("consolidación y expiración (D-26)", () => {
  it("3 diarios pendientes salen en UN solo mensaje con las 3 líneas", async () => {
    seed({ queue: [
      mkItem({ id: "d1", dayStr: "2026-07-24", periodKey: "2026-07-24" }),
      mkItem({ id: "d2", dayStr: "2026-07-25", periodKey: "2026-07-25" }),
      mkItem({ id: "d3", dayStr: "2026-07-26", periodKey: "2026-07-26" }),
    ] });
    const r = await Q.reportQueueTick(NOW);
    expect(r.emitted).toBe(true);
    expect(r.consolidated).toBe(3);
    expect(gw.emitted.length).toBe(1);            // UN mensaje, no 3
    const text = gw.emitted[0].payload.text;
    expect(text).toContain("*Reporte acumulado · 3 días*");
    expect(text).toContain("*día 1*");
    expect(text).toContain("*día 2*");
    expect(text).toContain("*día 3*");
    const s = read();
    expect(s.queue.filter((i) => i.status === "sending").length).toBe(3);
    expect(s.queue.filter((i) => i.consolidatedInto === "d1").length).toBe(2);
    // El ok del consolidado marca a los 3 hermanos.
    await Q.handleReportSendResult({ queueId: "d1", ok: true, method: "pinned-row0" }, ADMIN);
    expect(read().queue.length).toBe(0);
    expect(read().history.filter((i) => i.status === "sent").length).toBe(3);
  });

  it("el diario de hace 4 días expira; el semanal de hace un mes NO", async () => {
    seed({ queue: [
      mkItem({ id: "d_old", dayStr: OLD4, periodKey: OLD4 }),
      mkItem({ id: "w_old", kind: "weekly", dayStr: "2026-06-26", periodKey: "2026-06-28" }),
    ] });
    globalThis.__waGateway = mkGateway(false); // que nadie se vaya a 'sending'
    await Q.reportQueueTick(NOW);
    expect(findItem("d_old").status).toBe("expired");
    expect(findItem("w_old").status).toBe("pending");
  });
});

describe("nota de baches — D-05 aplica a TODO envío", () => {
  it("tras una expiración, el siguiente envío exitoso la lleva arriba y sella confessedAt", async () => {
    seed({
      queue: [mkItem({ id: "d_hoy", dayStr: TODAY, periodKey: TODAY })],
      history: [mkItem({ id: "d_exp", dayStr: OLD4, periodKey: OLD4, status: "expired", expiredAt: new Date(NOW).toISOString() })],
    });
    const r = await Q.reportQueueTick(NOW);
    expect(r.emitted).toBe(true);
    const text = gw.emitted[0].payload.text;
    expect(text.startsWith("_No pude enviar el reporte de mié 22/07._")).toBe(true);
    expect(findItem("d_exp").confessedAt).toBe(null);        // todavía no salió
    await Q.handleReportSendResult({ queueId: "d_hoy", ok: true, method: "pinned-row0" }, ADMIN);
    expect(findItem("d_exp").confessedAt).toBeTruthy();      // recién ahora
    expect(Q._reportGapNote(Q._reportStateDefaults(read()), NOW)).toBe("");
  });

  it("si el envío que lleva la nota falla, el próximo la vuelve a llevar", async () => {
    seed({
      queue: [mkItem({ id: "d_hoy2", dayStr: TODAY, periodKey: TODAY })],
      history: [mkItem({ id: "d_exp2", dayStr: OLD4, periodKey: OLD4, status: "expired" })],
    });
    await Q.reportQueueTick(NOW);
    await Q.handleReportSendResult({ queueId: "d_hoy2", ok: false, reason: "composer-not-found" }, ADMIN);
    expect(findItem("d_exp2").confessedAt).toBe(null);
    await Q.reportQueueTick(NOW + 60000);
    expect(gw.emitted[1].payload.text).toContain("No pude enviar el reporte de mié 22/07");
  });

  it("con UN solo diario pendiente (sin consolidar) la nota igual sale", async () => {
    seed({
      queue: [mkItem({ id: "d_solo", dayStr: TODAY, periodKey: TODAY })],
      history: [mkItem({ id: "d_fail", dayStr: YESTERDAY, periodKey: YESTERDAY, status: "failed", lastFailureReason: "group-not-found" })],
    });
    const r = await Q.reportQueueTick(NOW);
    expect(r.consolidated).toBe(1);
    expect(gw.emitted[0].payload.text.startsWith("_No pude enviar el reporte de sáb 25/07._")).toBe(true);
  });

  it("un item weekly también lleva la nota, y el motivo del QR se explicita", async () => {
    seed({
      queue: [mkItem({ id: "w1", kind: "weekly", dayStr: "2026-07-26", periodKey: "2026-07-26", text: "*Semana 20–26/07*\nEquipo 312 llam" })],
      history: [mkItem({ id: "d_qr", dayStr: YESTERDAY, periodKey: YESTERDAY, status: "failed", lastFailureReason: "account-not-connected" })],
    });
    await Q.reportQueueTick(NOW);
    const text = gw.emitted[0].payload.text;
    expect(text.startsWith("_No pude enviar el reporte de sáb 25/07._")).toBe(true);
    expect(text).toContain("volver a escanear el QR");
    expect(text).toContain("*Semana 20–26/07*");
  });

  it("en el camino consolidado la nota sale UNA sola vez", async () => {
    seed({
      queue: [
        mkItem({ id: "c1", dayStr: "2026-07-25", periodKey: "2026-07-25" }),
        mkItem({ id: "c2", dayStr: "2026-07-26", periodKey: "2026-07-26" }),
      ],
      history: [mkItem({ id: "c_exp", dayStr: OLD4, periodKey: OLD4, status: "expired" })],
    });
    await Q.reportQueueTick(NOW);
    const text = gw.emitted[0].payload.text;
    expect(text.split("No pude enviar el reporte").length - 1).toBe(1);
    expect(text).toContain("*Reporte acumulado · 2 días*");
  });
});

describe("setup del canal — report:group-configured (T-21-07)", () => {
  it("solo el admin puede cambiar el destino", async () => {
    seed({ config: { transport: { userId: "", accountId: "", groupName: "", groupJid: null } } });
    const bad = await Q.handleReportGroupConfigured({ accountId: "acc_x", groupName: "Grupo ajeno" }, SETTER);
    expect(bad).toMatchObject({ ok: false, reason: "no_autorizado" });
    expect(read().config.transport.groupName).toBe("");
    const ok = await Q.handleReportGroupConfigured({ accountId: "acc_x", groupName: "Socios SCM", groupJid: "120363999@g.us" }, ADMIN);
    expect(ok.ok).toBe(true);
    const t = read().config.transport;
    expect(t).toMatchObject({ userId: "u_admin", accountId: "acc_x", groupName: "Socios SCM", groupJid: "120363999@g.us", configuredBy: "u_admin" });
  });

  it("rechaza payloads inválidos (jid con formato raro, nombre vacío o gigante)", async () => {
    seed();
    expect(await Q.handleReportGroupConfigured({ accountId: "acc_x", groupName: "G", groupJid: "no-es-un-jid" }, ADMIN)).toMatchObject({ reason: "groupJid_invalido" });
    expect(await Q.handleReportGroupConfigured({ accountId: "acc_x", groupName: "   " }, ADMIN)).toMatchObject({ reason: "groupName_invalido" });
    expect(await Q.handleReportGroupConfigured({ accountId: "", groupName: "G" }, ADMIN)).toMatchObject({ reason: "accountId_invalido" });
    expect(await Q.handleReportGroupConfigured({ accountId: "acc_x", groupName: "x".repeat(101) }, ADMIN)).toMatchObject({ reason: "groupName_invalido" });
    // El nombre no puede romper la estructura del mensaje con saltos de línea.
    const ok = await Q.handleReportGroupConfigured({ accountId: "acc_x", groupName: "Socios\nSCM" }, ADMIN);
    expect(ok.ok).toBe(true);
    expect(read().config.transport.groupName).toBe("Socios SCM");
  });

  // CR-02: sin esto, un groupJid equivocado (el picker lo leía del chat ABIERTO,
  // que puede no ser el elegido) dejaba el canal muerto para siempre: la
  // verificación por JID rechaza el grupo correcto y no había forma de limpiarlo.
  it("2 jid-mismatch seguidos des-fijan el groupJid y vuelven a verificar por nombre", async () => {
    seed({
      config: { transport: { ...TRANSPORT, groupJid: "120363OTRO@g.us", jidCapturedAt: new Date(NOW).toISOString() } },
      queue: [mkItem({ id: "it_jm" })],
    });
    await Q.reportQueueTick(NOW);
    await Q.handleReportSendResult({ queueId: "it_jm#1", ok: false, reason: "jid-mismatch" }, ADMIN);
    expect(read().config.transport.groupJid).toBe("120363OTRO@g.us");   // 1ra: se aguanta
    expect(read().config.transport.jidMismatchCount).toBe(1);
    await Q.reportQueueTick(NOW + 60000);
    await Q.handleReportSendResult({ queueId: "it_jm#2", ok: false, reason: "jid-mismatch" }, ADMIN);
    const t = read().config.transport;
    expect(t.groupJid).toBe(null);                                      // 2da: se des-fija
    expect(t.jidCapturedAt).toBe(null);
    expect(t.groupName).toBe("Socios SCM");                             // el nombre NO se toca
    // El siguiente intento sale sin JID → el desktop verifica por nombre.
    await Q.reportQueueTick(NOW + 120000);
    const last = gw.emitted[gw.emitted.length - 1];
    expect(last.payload.target).toEqual({ kind: "group", groupName: "Socios SCM", groupJid: null });
  });

  it("un reason distinto corta la racha de jid-mismatch", async () => {
    seed({
      config: { transport: { ...TRANSPORT, groupJid: "120363X@g.us" } },
      queue: [mkItem({ id: "it_jm2" })],
    });
    await Q.reportQueueTick(NOW);
    await Q.handleReportSendResult({ queueId: "it_jm2#1", ok: false, reason: "jid-mismatch" }, ADMIN);
    await Q.reportQueueTick(NOW + 60000);
    await Q.handleReportSendResult({ queueId: "it_jm2#2", ok: false, reason: "composer-not-found" }, ADMIN);
    expect(read().config.transport.jidMismatchCount).toBe(0);
    expect(read().config.transport.groupJid).toBe("120363X@g.us");
  });

  it("PUT /config con groupJid:null limpia el JID (y solo acepta null)", async () => {
    seed({ config: { transport: { ...TRANSPORT, groupJid: "120363Y@g.us", jidCapturedAt: new Date(NOW).toISOString() } } });
    const bad = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie).send({ groupJid: "120363Z@g.us" });
    expect(bad.status).toBe(400);
    expect(read().config.transport.groupJid).toBe("120363Y@g.us");
    const ok = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie).send({ groupJid: null });
    expect(ok.status).toBe(200);
    expect(ok.body.jidCaptured).toBe(false);
    const t = read().config.transport;
    expect(t.groupJid).toBe(null);
    expect(t.groupName).toBe("Socios SCM");   // el grupo configurado sigue ahí
  });
});

describe("caps y persistencia (D-27, regla #21)", () => {
  it("history conserva 30 terminales y los pending NUNCA se recortan", async () => {
    const terminals = Array.from({ length: 40 }, (_, i) => mkItem({ id: `t_${i}`, status: "sent", periodKey: `k_${i}`, dayStr: "" }));
    const pendings = Array.from({ length: 5 }, (_, i) => mkItem({ id: `p_${i}`, kind: "custom", periodKey: `pk_${i}`, dayStr: "" }));
    seed({ queue: [...terminals, ...pendings] });
    await Q.mutateReportsState(() => {});
    const s = read();
    expect(s.history.length).toBe(30);
    expect(s.history[s.history.length - 1].id).toBe("t_39"); // se conservan los más nuevos
    expect(s.queue.length).toBe(5);
    expect(s.queue.every((i) => i.status === "pending")).toBe(true);
  });

  it("round-trip: export-data trae config/queue/history y import-data los restaura", async () => {
    seed({ queue: [mkItem({ id: "rt_1" })], history: [mkItem({ id: "rt_0", status: "sent", periodKey: "old" })] });
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.reports.config.transport.groupName).toBe("Socios SCM");
    expect(r.body.reports.queue.map((i) => i.id)).toEqual(["rt_1"]);
    expect(r.body.reports.history.map((i) => i.id)).toEqual(["rt_0"]);
    const snapshot = r.body.reports;

    fs.rmSync(REPORTS, { force: true });
    const imp = await request(app).post("/api/admin/import-data").set("Cookie", adminCookie).send({ reports: snapshot });
    expect(imp.status).toBe(200);
    expect(imp.body.restored).toContain("reports");
    const back = read();
    expect(back.queue.map((i) => i.id)).toEqual(["rt_1"]);
    expect(back.history.map((i) => i.id)).toEqual(["rt_0"]);
    expect(back.config.transport.accountId).toBe("acc_reportes");
    expect(back.lastWeeklyReportAt).toBe("2026-07-20T11:00:00.000Z");
  });
});
