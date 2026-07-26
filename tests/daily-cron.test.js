// Phase 21 (REP-05/REP-08, D-10..D-13, D-28/D-29) — Regresión del automatismo del
// reporte: cron diario de las 23:00, mudanza del semanal al domingo 23:00 y los
// tres endpoints admin del panel.
//
// Lo que esta suite protege, en una línea: que el reporte salga SOLO, todos los días
// hábiles, exactamente UNA vez por período, y que una prueba manual nunca suprima el
// envío automático.
//
// Cubre: ventana de hora (D-10) con el caso TZ (23:00 AR = otro día en UTC), lunes a
// viernes aun con el equipo en cero (D-11), sábado solo con actividad (D-12), domingo
// cediendo el lugar al semanal (D-13), guard por período cubierto en disco y en
// memoria (D-28 + WR-03), interruptor de pausa (D-29), RBAC de los 3 endpoints
// (T-21-13), validación de `backupEmails` (T-21-16), lock de un envío en vuelo
// (T-21-14) y la carrera de "Mandar ahora" con la cola no vacía.
//
// Sin fake timers y sin sockets reales: `nowTs` se inyecta en los crons y el gateway
// es un doble que captura lo emitido (mismo patrón que tests/report-queue.test.js).

import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `daily-cron-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dc@local.test";
process.env.ADMIN_PASSWORD = "dcpass1234";
process.env.JWT_SECRET = "test-secret-dc";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST
process.env.RESEND_API_KEY = ""; // regla #121: definida-VACÍA, jamás delete
process.env.REPORT_EMAILS = "";
process.env.REPORT_DM_FALLBACK = "";
// El techo de espera del request de "Mandar ahora" (25s en producción) se acorta acá:
// los casos "quedó en camino" esperan ese techo completo a propósito.
process.env.REPORT_SEND_NOW_WAIT_MS = "2000";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
const iso = (t) => new Date(t).toISOString();

// ── Fechas fijas determinísticas ──
// 2026-07-26 es DOMINGO; 27 lunes, 28 martes; 25 sábado. Las 23:00 AR de un día son
// las 02:00 UTC del día siguiente (-03): por eso todos los Date.UTC caen "un día
// después". Ese ES el caso TZ que el cron tiene que resolver bien.
const SUN23 = Date.UTC(2026, 6, 27, 2, 0, 0);   // dom 26/07 23:00 AR
const MON23 = Date.UTC(2026, 6, 28, 2, 0, 0);   // lun 27/07 23:00 AR
const MON22 = Date.UTC(2026, 6, 28, 1, 0, 0);   // lun 27/07 22:00 AR (fuera de ventana)
const TUE23 = Date.UTC(2026, 6, 29, 2, 0, 0);   // mar 28/07 23:00 AR (día SIN llamadas)
const SAT23 = Date.UTC(2026, 6, 26, 2, 0, 0);   // sáb 25/07 23:00 AR
const HALFHOUR = 30 * 60 * 1000;
// Llamadas del fixture, en hora de negocio: lunes 27 15:00 AR y sábado 25 15:00 AR.
const MON_CALL = Date.UTC(2026, 6, 27, 18, 0, 0);
const SAT_CALL = Date.UTC(2026, 6, 25, 18, 0, 0);

fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-dc@local.test", name: "AdminDC", role: "admin", status: "active", setterId: "", password: pwd("dcpass1234") },
    { id: "u_v", email: "v-dc@local.test", name: "Vendedora", role: "setter", status: "active", setterId: "s_v", password: pwd("vpass123456") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_v", name: "Vendedora" }, { id: "s_nueva", name: "Nueva" }],
  variants: [],
  leads: {
    l1: {
      num: 1, name: "L1", phone: "+5215550000001", assignedTo: "s_v",
      conexion: "sin_wsp", estado: "sin_contactar",
      callLog: [
        { ts: iso(MON_CALL), outcome: "answered_interested", by: "u_v", channel: "telnyx_webrtc", duration: 90 },
        { ts: iso(MON_CALL + 3600000), outcome: "no_answer", by: "u_v", channel: "telnyx_webrtc" },
        { ts: iso(SAT_CALL), outcome: "hung_up", by: "u_v", channel: "telnyx_webrtc", duration: 8 },
      ],
    },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const D = globalThis.__dailyReport;
const W = globalThis.__weeklyReport;
const Q = globalThis.__reportQueue;
const REPORTS = path.join(tmpData, "reports.json");
const TRANSPORT = { userId: "u_admin", accountId: "acc_reportes", groupName: "Socios SCM", groupJid: null };

const read = () => JSON.parse(fs.readFileSync(REPORTS, "utf8"));
const live = (kind = null) => (read().queue || []).filter((i) => !kind || i.kind === kind);

// Estado limpio + guards en memoria reseteados: el de WR-03 sobrevive a borrar el
// archivo, así que sin esto dos tests con la misma fecha se contaminarían.
function reset(extra = {}) {
  fs.rmSync(REPORTS, { force: true });
  W._resetPeriodMem();
  if (Object.keys(extra).length) {
    W.saveReportsState({ config: { paused: false, backupEmails: [], transport: { ...TRANSPORT } }, queue: [], history: [], ...extra });
  }
}
// Gateway doble: nunca se toca un socket real. `isDesktopConnected` (no
// `isUserConnected`) es lo que el tick consulta antes de emitir — CR-01: una
// pestaña del navegador NO es el desktop wa-multi.
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
// Fake sender del mail semanal (patrón campaignEngineTick, regla #72).
const mkSend = (result = { sent: true }) => {
  const calls = [];
  const fn = async (to) => { calls.push(to); return result; };
  fn.calls = calls;
  return fn;
};

let adminCookie = "";
let setterCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-dc@local.test", password: "dcpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
  const s = await request(app).post("/api/auth/login").send({ email: "v-dc@local.test", password: "vpass123456" });
  setterCookie = (s.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => {
  delete globalThis.__waGateway;
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("cron diario — ventana 23:00 hora de negocio (D-10)", () => {
  beforeEach(() => { reset({}); });

  it("lunes 22:00 AR → fuera_de_ventana, no encola", async () => {
    const r = await D.maybeRunDailyReportCron(MON22);
    expect(r).toEqual({ ran: false, reason: "fuera_de_ventana" });
    expect(fs.existsSync(REPORTS)).toBe(false);
  });

  it("TZ: martes 02:00 UTC = lunes 23:00 AR → corre y el período es el día AR", async () => {
    const r = await D.maybeRunDailyReportCron(MON23);
    expect(r.ran).toBe(true);
    expect(r.queued).toBe(true);
    expect(r.periodKey).toBe("2026-07-27");                      // lunes AR, no martes UTC
    expect(read().dailyState.lastDailyPeriodKey).toBe("2026-07-27");
    const items = live("daily");
    expect(items.length).toBe(1);
    expect(items[0].dayStr).toBe("2026-07-27");
    expect(items[0].text).toContain("Reporte diario · lun 27/07");
    expect(items[0].text).toContain("*Vendedora* 2 llam · 1 at");
    expect(items[0].line).toContain("*lun 27/07*");              // D-26: la usa el consolidado
  });
});

describe("cron diario — reglas de día (D-11/D-12/D-13)", () => {
  beforeEach(() => { reset({}); });

  it("D-11: día hábil con el equipo entero en cero SÍ encola, en una línea", async () => {
    const r = await D.maybeRunDailyReportCron(TUE23);
    expect(r.ran).toBe(true);
    const items = live("daily");
    expect(items.length).toBe(1);
    expect(items[0].text).toContain("Hoy no llamó nadie");
    expect(items[0].text).not.toContain("0 llam");               // nada de métricas en cero
  });

  it("D-12: sábado sin actividad no encola y marca el período (no reintenta toda la noche)", async () => {
    // El sábado del fixture SÍ tiene una llamada, así que se prueba con un sábado
    // vacío: el 01/08/2026 (sábado) 23:00 AR.
    const emptySat = Date.UTC(2026, 7, 2, 2, 0, 0);
    const r = await D.maybeRunDailyReportCron(emptySat);
    expect(r).toEqual({ ran: false, reason: "finde_sin_actividad" });
    expect(live("daily").length).toBe(0);
    expect(read().dailyState.lastDailyPeriodKey).toBe("2026-08-01");
    // Segundo tick de la misma noche: ya está marcado, no recomputa ni encola.
    const r2 = await D.maybeRunDailyReportCron(emptySat + HALFHOUR);
    expect(r2).toEqual({ ran: false, reason: "ya_enviado" });
    expect(live("daily").length).toBe(0);
  });

  it("D-12: sábado CON actividad sí encola", async () => {
    const r = await D.maybeRunDailyReportCron(SAT23);
    expect(r.ran).toBe(true);
    const items = live("daily");
    expect(items.length).toBe(1);
    expect(items[0].dayStr).toBe("2026-07-25");
    expect(items[0].text).toContain("*Vendedora* 1 llam · 1 at");
  });

  it("D-13: el domingo el diario cede el lugar, y el semanal de ese domingo sí corre", async () => {
    const rd = await D.maybeRunDailyReportCron(SUN23);
    expect(rd).toEqual({ ran: false, reason: "domingo_semanal" });
    const send = mkSend();
    const rw = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(rw.ran).toBe(true);
    expect(send.calls.length).toBe(1);
    expect(live("weekly").length).toBe(1);
  });
});

describe("cron diario — guard por período y pausa (D-28/D-29 + WR-03)", () => {
  beforeEach(() => { reset({}); });

  it("segundo tick del mismo día → ya_enviado, la cola sigue con UN solo item", async () => {
    const r1 = await D.maybeRunDailyReportCron(MON23);
    expect(r1.ran).toBe(true);
    const r2 = await D.maybeRunDailyReportCron(MON23 + HALFHOUR);
    expect(r2).toEqual({ ran: false, reason: "ya_enviado" });
    expect(live("daily").length).toBe(1);
  });

  it("WR-03: el guard en memoria corta aunque el archivo se pierda", async () => {
    const r1 = await D.maybeRunDailyReportCron(MON23);
    expect(r1.ran).toBe(true);
    // Simula el fallo de escritura del Railway Volume: el estado en disco desaparece.
    fs.rmSync(REPORTS, { force: true });
    const r2 = await D.maybeRunDailyReportCron(MON23 + HALFHOUR);
    expect(r2).toEqual({ ran: false, reason: "ya_enviado" });
  });

  it("con config.paused el cron devuelve pausado y no encola", async () => {
    reset({ config: { paused: true, backupEmails: [], transport: { ...TRANSPORT } } });
    const r = await D.maybeRunDailyReportCron(MON23);
    expect(r).toEqual({ ran: false, reason: "pausado" });
    expect(live("daily").length).toBe(0);
    expect(read().dailyState.lastDailyPeriodKey).toBe("");
  });
});

describe("semanal por el mismo canal (D-13/D-20)", () => {
  beforeEach(() => { reset({}); });

  it("el cron del domingo encola un weekly con el molde corto y manda el mail una vez", async () => {
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(r.sent).toBe(true);
    expect(send.calls.length).toBe(1);
    const items = live("weekly");
    expect(items.length).toBe(1);
    expect(items[0].periodKey).toBe("2026-07-26");
    expect(items[0].text).toContain("Semana ");
    expect(items[0].text).toContain("reuniones agendadas");
    expect(items[0].text).toContain("_Detalle completo en el mail._");
  });

  it("si el mail falla, el corto SÍ va al grupo y no promete un mail que no salió (D-04)", async () => {
    const send = mkSend({ sent: false, reason: "resend caído" });
    const r = await W.maybeRunWeeklyReportCron(SUN23, send);
    expect(r.sent).toBe(false);
    const items = live("weekly");
    expect(items.length).toBe(1);
    expect(items[0].text).toContain("Semana ");
    expect(items[0].text).not.toContain("Detalle completo en el mail");
  });
});

describe("endpoints del panel — RBAC y config (T-21-13/T-21-16)", () => {
  beforeEach(() => { reset({ config: { paused: false, backupEmails: [], transport: { ...TRANSPORT } } }); });

  it("los 3 endpoints son admin-only: 403 para un SDR, 401 sin sesión", async () => {
    const paths = [
      ["get", "/api/admin/daily-report/status"],
      ["put", "/api/admin/daily-report/config"],
      ["post", "/api/admin/daily-report/send-now"],
    ];
    for (const [method, p] of paths) {
      const forbidden = await request(app)[method](p).set("Cookie", setterCookie).send({});
      expect(forbidden.status, `${method} ${p} con SDR`).toBe(403);
      const unauth = await request(app)[method](p).send({});
      expect(unauth.status, `${method} ${p} sin sesión`).toBe(401);
    }
  });

  it("GET status devuelve el shape que consume el panel, sin el JID entero", async () => {
    globalThis.__waGateway = mkGateway(true);
    const r = await request(app).get("/api/admin/daily-report/status").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.groupConfigured).toBe(true);
    expect(r.body.groupName).toBe("Socios SCM");
    expect(r.body.jidCaptured).toBe(false);                 // T-21-17: booleano, no el JID
    expect("groupJid" in r.body).toBe(false);
    expect(r.body.desktopOnline).toBe(true);
    expect(r.body.paused).toBe(false);
    expect(r.body.queueCount).toBe(0);
    expect(r.body.lastSent).toBe(null);
    expect(r.body.backupEmails).toEqual([]);
  });

  it("PUT config: paused persiste y se ve en el GET status", async () => {
    const put = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie).send({ paused: true });
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);
    expect(put.body.paused).toBe(true);                     // la UI refresca con esta respuesta
    const get = await request(app).get("/api/admin/daily-report/status").set("Cookie", adminCookie);
    expect(get.body.paused).toBe(true);
    expect(read().config.paused).toBe(true);
  });

  it("PUT config: backupEmails inválido → 400; válidos se deduplican", async () => {
    const bad = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie)
      .send({ backupEmails: ["mal", "a@b.com"] });
    expect(bad.status).toBe(400);
    expect(read().config.backupEmails).toEqual([]);         // no persistió nada
    const notArray = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie)
      .send({ backupEmails: "a@b.com" });
    expect(notArray.status).toBe(400);
    const badPause = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie)
      .send({ paused: "si" });
    expect(badPause.status).toBe(400);
    const ok = await request(app).put("/api/admin/daily-report/config").set("Cookie", adminCookie)
      .send({ backupEmails: [" a@b.com ", "a@b.com", "c@d.com"] });
    expect(ok.status).toBe(200);
    expect(ok.body.backupEmails).toEqual(["a@b.com", "c@d.com"]);
    expect(read().config.backupEmails).toEqual(["a@b.com", "c@d.com"]);
  });
});

describe('endpoints del panel — "Mandar ahora" (D-29 + T-21-14/T-21-18)', () => {
  beforeEach(() => { reset({ config: { paused: false, backupEmails: [], transport: { ...TRANSPORT } } }); });

  it("sin grupo configurado → queued/sin_grupo y NO consume el período del cron", async () => {
    reset({ config: { paused: false, backupEmails: [], transport: { userId: "", accountId: "", groupName: "", groupJid: null } } });
    globalThis.__waGateway = mkGateway(true);
    const r = await request(app).post("/api/admin/daily-report/send-now").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "queued", reason: "sin_grupo" });
    expect(r.body.queueCount).toBe(1);
    // WR-01 generalizado (T-21-18): la prueba manual no toca el período del diario.
    expect(read().dailyState.lastDailyPeriodKey).toBe("");
    const items = live("custom");
    expect(items.length).toBe(1);
    expect(items[0].kind).toBe("custom");                   // ni consolida ni cubre período
    expect(items[0].periodKey.startsWith("manual_")).toBe(true);
  });

  it("desktop apagado → queued/offline, el reporte queda en cola", async () => {
    globalThis.__waGateway = mkGateway(false);
    const r = await request(app).post("/api/admin/daily-report/send-now").set("Cookie", adminCookie).send({});
    expect(r.body).toMatchObject({ ok: true, status: "queued", reason: "offline" });
    expect(live("custom").length).toBe(1);
  });

  it("con el desktop online emite el reporte de HOY al grupo", async () => {
    const gw = mkGateway(true);
    globalThis.__waGateway = gw;
    const r = await request(app).post("/api/admin/daily-report/send-now").set("Cookie", adminCookie).send({});
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.status).toBe("string");            // nunca undefined
    const sent = gw.emitted.filter((e) => e.event === "report:send-message");
    expect(sent.length).toBe(1);
    expect(sent[0].payload.target).toMatchObject({ kind: "group", groupName: "Socios SCM" });
    expect(sent[0].payload.text).toContain("Reporte diario ·");
    // El item propio quedó en vuelo esperando el resultado del desktop.
    const mine = (read().queue || []).find((i) => i.id === sent[0].payload.queueId);
    expect(mine.kind).toBe("custom");
    expect(mine.status).toBe("sending");
  });

  it("ignora la pausa: pausado el automático, el botón sigue funcionando", async () => {
    reset({ config: { paused: true, backupEmails: [], transport: { ...TRANSPORT } } });
    const gw = mkGateway(true);
    globalThis.__waGateway = gw;
    const r = await request(app).post("/api/admin/daily-report/send-now").set("Cookie", adminCookie).send({});
    expect(r.body.ok).toBe(true);
    expect(gw.emitted.filter((e) => e.event === "report:send-message").length).toBe(1);
    // ...pero el diario automático de ese día sigue frenado por la pausa.
    const rd = await D.maybeRunDailyReportCron(MON23);
    expect(rd).toEqual({ ran: false, reason: "pausado" });
  });

  it("T-21-14: con un envío ya en vuelo responde busy y NO encola otro", async () => {
    const nowIso = new Date().toISOString();
    reset({
      config: { paused: false, backupEmails: [], transport: { ...TRANSPORT } },
      queue: [{
        id: "rpt_inflight", kind: "daily", periodKey: "2026-07-27", dayStr: "2026-07-27",
        text: "en vuelo", line: "", phone: "", parentId: null,
        status: "sending", attempts: 1, sendAttempts: 1, confessedAt: null, confessedIds: [],
        consolidatedInto: null, lastText: "en vuelo", createdAt: nowIso, sendingAt: nowIso,
        sentAt: null, failedAt: null, expiredAt: null, lastAttemptAt: nowIso,
        lastFailureReason: null, method: null, matchedName: null, matchedJid: null,
      }],
    });
    globalThis.__waGateway = mkGateway(true);
    const r = await request(app).post("/api/admin/daily-report/send-now").set("Cookie", adminCookie).send({});
    expect(r.body).toMatchObject({ ok: true, status: "queued", reason: "busy" });
    expect(live("custom").length).toBe(0);                  // no se encoló un segundo mensaje
  });

  it("cola NO vacía: el tick procesa el viejo primero y la respuesta igual tiene status", async () => {
    // La carrera real: reportQueueTick elige FIFO sobre TODA la cola, así que la
    // primera vuelta procesa el pendiente viejo y el item propio sigue pending.
    const oldIso = new Date(Date.now() - 3600000).toISOString();
    reset({
      config: { paused: false, backupEmails: [], transport: { ...TRANSPORT } },
      queue: [{
        id: "rpt_viejo", kind: "daily", periodKey: "2026-07-24", dayStr: "2026-07-24",
        text: "*Reporte viejo*", line: "*vie 24/07* 5 llam", phone: "", parentId: null,
        status: "pending", attempts: 0, sendAttempts: 0, confessedAt: null, confessedIds: [],
        consolidatedInto: null, lastText: "", createdAt: oldIso, sendingAt: null,
        sentAt: null, failedAt: null, expiredAt: null, lastAttemptAt: null,
        lastFailureReason: null, method: null, matchedName: null, matchedJid: null,
      }],
    });
    const gw = mkGateway(true);
    globalThis.__waGateway = gw;
    const r = await request(app).post("/api/admin/daily-report/send-now").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.status).toBe("queued");                   // definido, NUNCA undefined
    expect(r.body.reason).toBe("sending");
    const sent = gw.emitted.filter((e) => e.event === "report:send-message");
    expect(sent.length).toBe(1);
    expect(sent[0].payload.queueId).toBe("rpt_viejo");      // salió el más viejo
    // El item de la prueba manual NO se perdió: sigue en cola, esperando su turno.
    const mine = (read().queue || []).find((i) => i.kind === "custom");
    expect(mine).toBeTruthy();
    expect(mine.status).toBe("pending");
    expect(r.body.queueCount).toBe(2);
  });
});
