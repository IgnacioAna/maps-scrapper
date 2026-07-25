// Phase 19 (REP-01/02/03) — Regresión del reporte semanal.
//
// Cubre el bug histórico de los 16 mails del lunes: el cron corría cada hora y
// un ReferenceError (`now` fantasma) hacía que el anti-duplicado nunca persistiera
// → cada tick horario del lunes re-mandaba el mail. Si alguien reintroduce ese
// bug, o rompe la ventana lunes-8am en TZ de negocio, la exclusión de los setters
// admin-only (Ignacio/Paula) del reporte, el parsing de REPORT_EMAILS o la
// persistencia de reports.json (export/import), esta suite falla.
//
// Los tests del cron usan sendFn FAKE inyectado (patrón campaignEngineTick,
// regla #72) — ningún test pega a Resend (RESEND_API_KEY="" definida-vacía,
// regla #121: NUNCA delete, dotenv repone las borradas).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `weekly-report-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-wr@local.test";
process.env.ADMIN_PASSWORD = "wrpass1234";
process.env.JWT_SECRET = "test-secret-wr";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST
process.env.RESEND_API_KEY = ""; // regla #121: definida-VACÍA, jamás delete
process.env.REPORT_EMAILS = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-wr@local.test", name: "AdminWR", role: "admin", status: "active", setterId: "", password: pwd("wrpass1234") },
    { id: "u_v", email: "v-wr@local.test", name: "Vendedora", role: "setter", status: "active", setterId: "s_v", password: pwd("vpass123456") },
    { id: "u_ign", email: "ign-wr@local.test", name: "Ignacio", role: "setter", status: "active", setterId: "setter_ignacio", password: pwd("ipass123456") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_v", name: "Vendedora" }, { id: "setter_ignacio", name: "Ignacio" }],
  variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const W = globalThis.__weeklyReport;
const M = globalThis.__metricsAudit;
const iso = (t) => new Date(t).toISOString();

// ── Fechas fijas determinísticas (2026-07-27 y 2026-08-03 son lunes reales) ──
const MON9 = Date.UTC(2026, 6, 27, 12, 0, 0);   // lunes 09:00 AR (dentro de ventana)
const MON7 = Date.UTC(2026, 6, 27, 10, 30, 0);  // lunes 07:30 AR (antes de las 8)
const TUE = Date.UTC(2026, 6, 28, 15, 0, 0);    // martes (fuera)
const MONTZ = Date.UTC(2026, 6, 28, 2, 0, 0);   // martes 02:00 UTC = lunes 23:00 AR (caso TZ)
const NEXTMON = Date.UTC(2026, 7, 3, 12, 0, 0); // lunes siguiente 09:00 AR
const HOUR = 3600 * 1000;

function resetReportsState() {
  fs.rmSync(path.join(tmpData, "reports.json"), { force: true });
}
// Fake sender: cuenta invocaciones y captura los destinatarios recibidos.
const mkSend = (result = { sent: true }) => {
  const calls = [];
  const fn = async (to) => { calls.push(to); return result; };
  fn.calls = calls;
  return fn;
};

let adminCookie = "";

beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-wr@local.test", password: "wrpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  // Fixture de llamadas en la SEMANA PASADA (lunes a lunes en TZ de negocio),
  // calculada con los mismos helpers que usa buildWeeklyReportData.
  const now = Date.now();
  const todayStart = M._bizStartOfDay(now);
  const thisMonday = todayStart - ((M._bizDayOfWeek(todayStart) || 7) - 1) * 86400000;
  const lastWeekTs = thisMonday - 3 * 86400000;

  // Reescritura post-import: los loaders leen de disco en cada llamada (patrón
  // establecido en metrics-timezone-attribution.test.js).
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters: [{ id: "s_v", name: "Vendedora" }, { id: "setter_ignacio", name: "Ignacio" }],
    variants: [],
    leads: {
      l1: {
        num: 1, name: "L1", phone: "+5215550000001", assignedTo: "s_v",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(lastWeekTs), outcome: "answered_interested", by: "u_v", channel: "telnyx_webrtc", duration: 60 },
          { ts: iso(lastWeekTs + HOUR), outcome: "hung_up", by: "u_v", channel: "telnyx_webrtc", duration: 5 },
          { ts: iso(lastWeekTs + 2 * HOUR), outcome: "no_answer", by: "u_v", channel: "telnyx_webrtc" },
        ],
      },
      l2: {
        num: 2, name: "L2", phone: "+5215550000002", assignedTo: "setter_ignacio",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          // Llamada de Ignacio (admin-only) — NO debe contar en el reporte.
          { ts: iso(lastWeekTs), outcome: "answered_interested", by: "u_ign", channel: "telnyx_webrtc", duration: 120 },
        ],
      },
    },
    calendar: [], sessions: [],
  }, null, 2));
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("cron semanal — ventana lunes 8am en TZ de negocio (REP-01)", () => {
  it("martes → fuera_de_ventana, sendFn no llamado", async () => {
    resetReportsState();
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(TUE, send);
    expect(r).toEqual({ ran: false, reason: "fuera_de_ventana" });
    expect(send.calls.length).toBe(0);
  });

  it("lunes 07:30 AR (antes de las 8) → fuera_de_ventana", async () => {
    resetReportsState();
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(MON7, send);
    expect(r).toEqual({ ran: false, reason: "fuera_de_ventana" });
    expect(send.calls.length).toBe(0);
  });

  it("el bug de los 16 mails: primer tick del lunes manda, el segundo da ya_enviado", async () => {
    resetReportsState();
    const send = mkSend();
    const r1 = await W.maybeRunWeeklyReportCron(MON9, send);
    expect(r1.ran).toBe(true);
    expect(r1.sent).toBe(true);
    expect(W.loadReportsState().lastWeeklyReportAt).toBe(new Date(MON9).toISOString());
    // Tick horario siguiente del MISMO lunes: anti-duplicado persistido.
    const r2 = await W.maybeRunWeeklyReportCron(MON9 + HOUR, send);
    expect(r2).toEqual({ ran: false, reason: "ya_enviado" });
    expect(send.calls.length).toBe(1); // exactamente UN mail, no 16
  });

  it("TZ: martes 02:00 UTC = lunes 23:00 AR → dentro de ventana", async () => {
    resetReportsState();
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(MONTZ, send);
    expect(r.ran).toBe(true);
    expect(r.sent).toBe(true);
    expect(send.calls.length).toBe(1);
  });

  it("el lunes SIGUIENTE (+7 días) vuelve a mandar", async () => {
    resetReportsState();
    W.saveReportsState({ lastWeeklyReportAt: new Date(MON9).toISOString() });
    const send = mkSend();
    const r = await W.maybeRunWeeklyReportCron(NEXTMON, send);
    expect(r.ran).toBe(true);
    expect(r.sent).toBe(true);
    expect(send.calls.length).toBe(1);
  });

  it("fallo de envío NO persiste lastWeeklyReportAt → el próximo tick reintenta", async () => {
    resetReportsState();
    const failSend = mkSend({ sent: false, reason: "x" });
    const r1 = await W.maybeRunWeeklyReportCron(MON9, failSend);
    expect(r1.ran).toBe(true);
    expect(r1.sent).toBe(false);
    expect(W.loadReportsState().lastWeeklyReportAt).toBeUndefined();
    // Reintento una hora después con el envío sano → sale.
    const okSend = mkSend();
    const r2 = await W.maybeRunWeeklyReportCron(MON9 + HOUR, okSend);
    expect(r2.sent).toBe(true);
    expect(okSend.calls.length).toBe(1);
  });
});

describe("destinatarios — REPORT_EMAILS CSV con fallback (REP-02)", () => {
  it("_reportRecipients parsea el CSV con espacios y cae a ADMIN_EMAIL si está vacío", () => {
    process.env.REPORT_EMAILS = " a@x.com , b@x.com ";
    expect(W._reportRecipients()).toEqual(["a@x.com", "b@x.com"]);
    process.env.REPORT_EMAILS = "";
    expect(W._reportRecipients()).toEqual(["admin-wr@local.test"]);
  });

  it("el cron entrega el array de REPORT_EMAILS al sender", async () => {
    resetReportsState();
    process.env.REPORT_EMAILS = "a@x.com,b@x.com";
    try {
      const send = mkSend();
      const r = await W.maybeRunWeeklyReportCron(MON9, send);
      expect(r.sent).toBe(true);
      expect(send.calls[0]).toEqual(["a@x.com", "b@x.com"]);
      expect(r.to).toEqual(["a@x.com", "b@x.com"]);
    } finally {
      process.env.REPORT_EMAILS = "";
    }
  });
});

describe("shape del reporte — sin WSP, sin admin-only (REP-03)", () => {
  it("buildWeeklyReportData: sin clave wsp, funnel canónico, Ignacio excluido", () => {
    const d = W.buildWeeklyReportData();
    expect("wsp" in d).toBe(false);
    // 3 llamadas de la Vendedora; la de Ignacio (admin-only) NO cuenta.
    expect(d.calls.totalWeek).toBe(3);
    // Connects canónicos: answered_interested + hung_up (no_answer no es connect).
    expect(d.calls.answeredWeek).toBe(2);
    expect(d.perSetter.length).toBe(1);
    expect(d.perSetter[0].name).toBe("Vendedora");
    expect(d.perSetter[0].llamadas).toBe(3);
    expect(d.perSetter[0].atendidas).toBe(2);
    expect(d.perSetter.some((s) => s.name === "Ignacio")).toBe(false);
  });

  it("buildWeeklyReportHtml: sin sección WhatsApp y sin Ignacio", () => {
    const d = W.buildWeeklyReportData();
    const html = W.buildWeeklyReportHtml(d);
    expect(html).not.toMatch(/WhatsApp/);
    expect(html).not.toMatch(/Conexiones/);
    expect(html).not.toContain("Ignacio");
    expect(html).toContain("Vendedora");
  });
});

describe("persistencia — round-trip export/import de reports.json", () => {
  it("export-data incluye el bloque reports con el estado guardado", async () => {
    W.saveReportsState({ lastWeeklyReportAt: "2026-07-27T12:00:00.000Z" });
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.reports.lastWeeklyReportAt).toBe("2026-07-27T12:00:00.000Z");
  });

  it("import-data restaura reports.json borrado", async () => {
    resetReportsState();
    const r = await request(app)
      .post("/api/admin/import-data")
      .set("Cookie", adminCookie)
      .send({ reports: { lastWeeklyReportAt: "2026-07-27T12:00:00.000Z" } });
    expect(r.status).toBe(200);
    expect(r.body.restored).toContain("reports");
    expect(W.loadReportsState().lastWeeklyReportAt).toBe("2026-07-27T12:00:00.000Z");
  });
});
