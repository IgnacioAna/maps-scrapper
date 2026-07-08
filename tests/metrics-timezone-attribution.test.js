// Audit 2026-07-08 — barrido de métricas:
// (1) "hoy" y los cortes por día/hora usan la TZ de negocio (BUSINESS_TZ,
//     default America/Argentina/Buenos_Aires) — antes usaban la TZ del server
//     (UTC en Railway) y las llamadas de ayer a la noche aparecían como de hoy.
// (2) Las métricas por setter se atribuyen por quién LLAMÓ (callLog entry.by
//     → setterId del user) con fallback al dueño actual del lead — antes las
//     redistribuciones del pool movían las llamadas históricas de setter.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `metrics-tz-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tz@local.test";
process.env.ADMIN_PASSWORD = "tzpass1234";
process.env.JWT_SECRET = "test-secret-tz";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-tz@local.test", name: "AdminTZ", role: "admin", status: "active", setterId: "", password: pwd("tzpass1234") },
    { id: "u_a", email: "a-tz@local.test", name: "SetterA", role: "setter", status: "active", setterId: "s_a", password: pwd("apass123456") },
    { id: "u_b", email: "b-tz@local.test", name: "SetterB", role: "setter", status: "active", setterId: "s_b", password: pwd("bpass123456") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
  variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const M = globalThis.__metricsAudit;
const iso = (t) => new Date(t).toISOString();

let adminCookie = "";
let dayStart = 0;   // medianoche de HOY en TZ de negocio
let tsToday = 0;    // llamada de hoy
let tsYesterday = 0; // ayer 22:00 (TZ negocio) — bajo UTC caía "hoy"

beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-tz@local.test", password: "tzpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  const now = Date.now();
  dayStart = M._bizStartOfDay(now);
  tsToday = now;
  tsYesterday = dayStart - 2 * 3600 * 1000;

  // Lead asignado a s_a con llamadas de A, de B (sobre lead ajeno) y una sin `by`.
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
    variants: [],
    leads: {
      l1: {
        num: 1, name: "L1", phone: "+5215550000001", assignedTo: "s_a",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(tsYesterday), outcome: "no_answer", by: "u_a", channel: "telnyx_webrtc", duration: 40, cost: 0.1 },
          { ts: iso(tsToday), outcome: "answered_interested", by: "u_a", channel: "telnyx_webrtc", duration: 60, cost: 0.2 },
          { ts: iso(tsToday), outcome: "no_answer", by: "u_b", channel: "manual" },
          { ts: iso(tsToday), outcome: "no_answer", channel: "manual" }, // sin by → fallback assignedTo (s_a)
        ],
      },
    },
    calendar: [], sessions: [],
  }, null, 2));
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("helpers de TZ de negocio", () => {
  it("_bizDayStr / _bizHour usan la TZ de negocio, no UTC", () => {
    // 2026-01-15 01:30 UTC = 2026-01-14 22:30 en AR (-03)
    const ts = Date.UTC(2026, 0, 15, 1, 30, 0);
    expect(M._bizDayStr(ts)).toBe("2026-01-14");
    expect(M._bizHour(ts)).toBe(22);
    expect(M._bizDayOfWeek(ts)).toBe(3); // 2026-01-14 fue miércoles
  });
  it("_bizStartOfDay es la medianoche del día de negocio", () => {
    const start = M._bizStartOfDay(Date.UTC(2026, 0, 15, 1, 30, 0));
    expect(M._bizHour(start)).toBe(0);
    expect(M._bizDayStr(start)).toBe("2026-01-14");
    expect(M._bizDayStr(start - 1)).toBe("2026-01-13");
    expect(M._bizDayStr(start + 24 * 3600 * 1000 - 1)).toBe("2026-01-14");
  });
});

describe("cold-call-metrics — hoy en TZ de negocio + atribución por caller", () => {
  it("period=today NO incluye la llamada de ayer a la noche", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=today").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    // hoy de s_a: answered_interested (u_a) + no_answer sin by (fallback) = 2
    expect(r.body.metrics.dials).toBe(2);
    expect(r.body.metrics.connects).toBe(1);
  });
  it("period=week SÍ incluye la de ayer", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=week").set("Cookie", adminCookie);
    expect(r.body.metrics.dials).toBe(3);
  });
  it("la llamada que hizo B sobre el lead de A se atribuye a B", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_b&period=today").set("Cookie", adminCookie);
    expect(r.body.metrics.dials).toBe(1);
  });
});

describe("calls-today — corte de medianoche + atribución", () => {
  it("cuenta solo las llamadas de HOY atribuidas al setter", async () => {
    const ra = await request(app).get("/api/setters/team/s_a/calls-today").set("Cookie", adminCookie);
    expect(ra.status).toBe(200);
    expect(ra.body.count).toBe(2); // hoy: u_a + sin-by; excluye ayer 22:00
    const rb = await request(app).get("/api/setters/team/s_b/calls-today").set("Cookie", adminCookie);
    expect(rb.body.count).toBe(1);
  });
});

describe("team-performance period=day — desde medianoche, por caller", () => {
  it("day = hoy (no ventana móvil de 24hs) y atribuye a quién llamó", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const rowA = r.body.perSetter.find((s) => s.id === "s_a");
    const rowB = r.body.perSetter.find((s) => s.id === "s_b");
    expect(rowA.current.dials).toBe(2); // sin la de ayer 22:00
    expect(rowB.current.dials).toBe(1); // la que hizo B sobre el lead de A
  });
});

describe("telnyx metrics — byDay en TZ de negocio + bySetter por caller", () => {
  it("agrupa la llamada de ayer 22:00 bajo la fecha de AYER y atribuye por caller", async () => {
    const r = await request(app).get("/api/telnyx/metrics?range=month").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const days = r.body.byDay.map((d) => d.day);
    expect(days).toContain(M._bizDayStr(tsYesterday));
    expect(days).toContain(M._bizDayStr(tsToday));
    const yDay = r.body.byDay.find((d) => d.day === M._bizDayStr(tsYesterday));
    expect(yDay.calls).toBe(1);
    const sA = r.body.bySetter.find((s) => s.setterId === "s_a");
    expect(sA.calls).toBe(2); // las 2 telnyx_webrtc son de u_a
  });
  it("range=today excluye la de ayer", async () => {
    const r = await request(app).get("/api/telnyx/metrics?range=today").set("Cookie", adminCookie);
    expect(r.body.totals.calls).toBe(1);
  });
});
