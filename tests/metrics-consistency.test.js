// CALL METRICS CORE (2026-07-24) — suite de CONSISTENCIA CRUZADA.
// La garantía de "no aparece un error nuevo cada vez que miro las métricas":
// el mismo fixture debe dar los MISMOS números en todos los endpoints que
// muestran el funnel de llamadas (cold-call-metrics, team-performance,
// command, weekly, effectiveness), y la serie temporal debe respetar TZ de
// negocio, atribución por quién llamó y RBAC.
//
// Grupos: A = consistencia cruzada entre endpoints · B = serie temporal ·
// C = _ccResolveRange puro.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `metrics-consistency-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-mc@local.test";
process.env.ADMIN_PASSWORD = "mcpass1234";
process.env.JWT_SECRET = "test-secret-mc";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires"; // -03, sin DST
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-mc@local.test", name: "AdminMC", role: "admin", status: "active", setterId: "", password: pwd("mcpass1234") },
    { id: "u_a", email: "a-mc@local.test", name: "SdrA", role: "setter", status: "active", setterId: "s_a", password: pwd("apass123456") },
    { id: "u_b", email: "b-mc@local.test", name: "SdrB", role: "setter", status: "active", setterId: "s_b", password: pwd("bpass123456") },
    // Supervisor scoped: solo ve a s_a.
    { id: "u_sup", email: "sup-mc@local.test", name: "SupMC", role: "supervisor", status: "active", setterId: "", visibleSetterIds: ["s_a"], password: pwd("suppass123456") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
  variants: [], leads: {}, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const CC = globalThis.__callCore;
const M = globalThis.__metricsAudit;
const iso = (t) => new Date(t).toISOString();
const oneDay = 86400000;

let adminCookie = "";
let setterACookie = "";
let supCookie = "";
let dayStart = 0;
let tsToday = 0;        // hoy, hace un rato
let tsLateNight = 0;    // ayer 23:30 TZ negocio (= hoy 02:30 UTC) — trampa de TZ
let ts3d = 0;           // hace 3 días
let ts10d = 0;          // hace 10 días (fuera de 7d, dentro de 30d)
let tsLastWeekA = 0;    // miércoles de la semana pasada (para el reporte semanal)
let tsLastWeekB = 0;
// Fuente de verdad del fixture para los cross-checks que dependen del día de
// la semana en que corre el test (weekly): TODAS las llamadas {ts, outcome}.
const FIXTURE_CALLS = [];

beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-mc@local.test", password: "mcpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
  const sa = await request(app).post("/api/auth/login").send({ email: "a-mc@local.test", password: "apass123456" });
  setterACookie = (sa.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
  const su = await request(app).post("/api/auth/login").send({ email: "sup-mc@local.test", password: "suppass123456" });
  supCookie = (su.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];

  const now = Date.now();
  dayStart = M._bizStartOfDay(now);
  tsToday = now - 60000;
  tsLateNight = dayStart - 30 * 60000; // ayer 23:30 AR
  ts3d = dayStart - 3 * oneDay + 10 * 3600000; // hace 3 días a las 10:00
  ts10d = dayStart - 10 * oneDay + 10 * 3600000;
  // Semana PASADA completa (ventana del reporte semanal: [lunes pasado, este lunes)).
  const dow = M._bizDayOfWeek(dayStart) || 7;
  const thisMonday = dayStart - (dow - 1) * oneDay;
  tsLastWeekA = thisMonday - 5 * oneDay + 15 * 3600000; // miércoles pasado 15:00
  tsLastWeekB = tsLastWeekA + 3600000;

  // Fixture: TODOS los outcomes, duraciones a ambos lados de 30s, borde de día
  // TZ, lead reasignado con llamadas ajenas, user borrado en `by`, calendar
  // ganada dentro/fuera de rango.
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
    setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
    variants: [],
    leads: {
      // Lead de A con el abanico completo de outcomes (hoy).
      l1: {
        num: 1, name: "L1", phone: "+521555000001", assignedTo: "s_a",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(tsToday), outcome: "answered_interested", by: "u_a", channel: "telnyx_webrtc", duration: 65 },
          { ts: iso(tsToday), outcome: "answered_not_interested", by: "u_a", channel: "telnyx_webrtc", duration: 20, disqualifyReason: "no_es_icp" },
          { ts: iso(tsToday), outcome: "hung_up", by: "u_a", channel: "telnyx_webrtc", duration: 5 },
          { ts: iso(tsToday), outcome: "callback_later", by: "u_a", channel: "telnyx_webrtc", duration: 45 },
          { ts: iso(tsToday), outcome: "no_answer", by: "u_a", channel: "telnyx_webrtc", duration: 0 },
          { ts: iso(tsToday), outcome: "voicemail", by: "u_a", channel: "telnyx_webrtc", duration: 0 },
        ],
      },
      // Agendamiento manual (sin duration) de A, ayer 23:30 AR — trampa TZ.
      l2: {
        num: 2, name: "L2", phone: "+521555000002", assignedTo: "s_a",
        conexion: "sin_wsp", estado: "agendado",
        callLog: [
          { ts: iso(tsLateNight), outcome: "scheduled_with_admin", by: "u_a", channel: "manual" },
        ],
      },
      // Lead REASIGNADO a B, pero las llamadas las hizo A (hace 3 días) — se
      // atribuyen a A, no al dueño actual.
      l3: {
        num: 3, name: "L3", phone: "+521555000003", assignedTo: "s_b",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(ts3d), outcome: "wrong_number", by: "u_a", channel: "telnyx_webrtc", duration: 0 },
          { ts: iso(ts3d), outcome: "answered_interested", by: "u_a", channel: "telnyx_webrtc", duration: 31 },
        ],
      },
      // Llamadas de un user BORRADO (u_ghost no existe en auth) → sin atribuir.
      // Las dos de la semana pasada alimentan el cross-check del reporte semanal
      // sin ensuciar la atribución de A/B (ghost no cuenta para nadie).
      l4: {
        num: 4, name: "L4", phone: "+521555000004", assignedTo: "s_b",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(tsToday), outcome: "answered_interested", by: "u_ghost", channel: "telnyx_webrtc", duration: 90 },
          { ts: iso(tsLastWeekA), outcome: "hung_up", by: "u_ghost", channel: "telnyx_webrtc", duration: 12 },
          { ts: iso(tsLastWeekB), outcome: "no_answer", by: "u_ghost", channel: "telnyx_webrtc", duration: 0 },
        ],
      },
      // Llamada vieja de B (hace 10 días — fuera de 7d, dentro de 30d).
      l5: {
        num: 5, name: "L5", phone: "+521555000005", assignedTo: "s_b",
        conexion: "sin_wsp", estado: "sin_contactar",
        callLog: [
          { ts: iso(ts10d), outcome: "hung_up", by: "u_b", channel: "telnyx_webrtc", duration: 8 },
        ],
      },
      // Lead de A jamás llamado (para assigned.sinContactar).
      l6: {
        num: 6, name: "L6", phone: "+521555000006", assignedTo: "s_a",
        conexion: "sin_wsp", estado: "sin_contactar", callLog: [],
      },
    },
    calendar: [
      // Deal ganada de A, cerrada hoy → cuenta.
      { id: "c1", leadId: "l2", fecha: iso(tsToday), nombre: "L2", calendarioEstado: "ganada", valorProyecto: 500, setterId: "s_a", closedAt: iso(tsToday) },
      // Ganada hace 60 días → fuera de cualquier rango corto.
      { id: "c2", leadId: "l5", fecha: iso(dayStart - 60 * oneDay), nombre: "L5", calendarioEstado: "ganada", valorProyecto: 900, setterId: "s_a", closedAt: iso(dayStart - 60 * oneDay) },
      // Realizada (no ganada) → NO es deal.
      { id: "c3", leadId: "l1", fecha: iso(tsToday), nombre: "L1", calendarioEstado: "realizada", valorProyecto: 0, setterId: "s_a" },
    ],
    sessions: [],
  }, null, 2));

  // Aplanar el fixture recién escrito → fuente de verdad para los cross-checks
  // cuya ventana depende del día en que corre el test (weekly, all-time).
  const written = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
  for (const l of Object.values(written.leads)) {
    for (const c of (l.callLog || [])) {
      FIXTURE_CALLS.push({ ts: new Date(c.ts).getTime(), outcome: c.outcome, channel: c.channel || "" });
    }
  }
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

// Réplica local de la definición canónica (si el canon cambia, estos tests
// tienen que fallar hasta que se actualicen A PROPÓSITO).
const CANON_CONNECTS = new Set(["answered_interested", "answered_not_interested", "scheduled_with_admin", "callback_later", "hung_up"]);
const isConnect = (o) => CANON_CONNECTS.has(o);

// Números esperados de s_a en 7d (todo el fixture menos ts10d, que es de u_b):
// dials = 6 (l1) + 1 (l2) + 2 (l3, reasignado pero llamó A) = 9
// connects = interested + not_interested + hung_up + callback (l1) + scheduled (l2) + interested (l3) = 6
// conversations = interested65 + callback45 (l1) + scheduled (appointment, sin duration) + interested31 (l3) = 4
// appointments = 1 (l2) · deals = 1 (c1, $500)
const EXP_A_7D = { dials: 9, connects: 6, conversations: 4, appointments: 1, deals: 1, revenue: 500 };

describe("C · _ccResolveRange — semántica única de rangos", () => {
  it("today = desde medianoche TZ negocio", () => {
    const r = CC._ccResolveRange("today");
    expect(r.fromTs).toBe(M._bizStartOfDay());
    expect(r.period).toBe("today");
  });
  it("7d/30d = N días completos + hoy parcial; aliases week/month", () => {
    const r7 = CC._ccResolveRange("7d");
    expect(r7.fromTs).toBe(M._bizStartOfDay() - 7 * oneDay);
    expect(CC._ccResolveRange("week").fromTs).toBe(r7.fromTs);
    const r30 = CC._ccResolveRange("30d");
    expect(r30.fromTs).toBe(M._bizStartOfDay() - 30 * oneDay);
    expect(CC._ccResolveRange("month").fromTs).toBe(r30.fromTs);
  });
  it("thismonth = día 1 del mes en TZ negocio", () => {
    const r = CC._ccResolveRange("thismonth");
    expect(M._bizDayStr(r.fromTs).slice(8, 10)).toBe("01");
    expect(M._bizDayStr(r.fromTs).slice(0, 7)).toBe(M._bizDayStr(Date.now()).slice(0, 7));
  });
  it("all = desde 0", () => {
    expect(CC._ccResolveRange("all").fromTs).toBe(0);
  });
  it("custom from/to inclusivo en TZ negocio (ignora period)", () => {
    const r = CC._ccResolveRange("week", { from: "2026-07-01", to: "2026-07-03" });
    expect(r.period).toBe("custom");
    expect(M._bizDayStr(r.fromTs)).toBe("2026-07-01");
    // to inclusivo: el fin es la medianoche del día SIGUIENTE al 03
    expect(M._bizDayStr(r.toTs - 1)).toBe("2026-07-03");
  });
  it("custom inválido cae al period", () => {
    const r = CC._ccResolveRange("today", { from: "no-fecha", to: "2026-07-03" });
    expect(r.period).toBe("today");
  });
});

describe("A · consistencia cruzada — mismos números en todos los endpoints", () => {
  it("A1: cold-call-metrics == team-performance para el mismo SDR/rango (week)", async () => {
    const ccm = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=week").set("Cookie", adminCookie);
    expect(ccm.status).toBe(200);
    expect(ccm.body.metrics).toEqual(EXP_A_7D);
    const tp = await request(app).get("/api/setters/team-performance?period=week").set("Cookie", adminCookie);
    expect(tp.status).toBe(200);
    const rowA = tp.body.perSetter.find((s) => s.id === "s_a");
    for (const k of ["dials", "connects", "conversations", "appointments", "deals"]) {
      expect(rowA.current[k], `team-performance.${k} difiere de cold-call-metrics`).toBe(ccm.body.metrics[k]);
    }
  });
  it("A1b: la llamada del user borrado no se atribuye a nadie", async () => {
    const ccmB = await request(app).get("/api/setters/cold-call-metrics?setter=s_b&period=week").set("Cookie", adminCookie);
    expect(ccmB.body.metrics.dials).toBe(0); // l4 (ghost) no es de B; l5 es de hace 10 días
    const ccmB30 = await request(app).get("/api/setters/cold-call-metrics?setter=s_b&period=month").set("Cookie", adminCookie);
    expect(ccmB30.body.metrics.dials).toBe(1); // solo l5
  });
  it("A2: totals == suma de los buckets de la serie (auto-consistencia)", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=month&series=1").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.buckets)).toBe(true);
    const sum = (k) => r.body.buckets.reduce((a, b) => a + b[k], 0);
    for (const k of ["dials", "connects", "conversations", "appointments", "deals", "revenue"]) {
      expect(sum(k), `suma de buckets.${k} != totals`).toBe(r.body.metrics[k]);
    }
  });
});

describe("A · Comando, semanal y effectiveness alineados al canon (Ola 3)", () => {
  it("A3: Comando — atendidas canónicas == cold-call-metrics (global, hoy y por SDR)", async () => {
    const cmd = await request(app).get("/api/setters/command").set("Cookie", adminCookie);
    expect(cmd.status).toBe(200);
    const ccmAll = await request(app).get("/api/setters/cold-call-metrics?period=all").set("Cookie", adminCookie);
    expect(cmd.body.callTotals.totalLlamadas).toBe(ccmAll.body.metrics.dials);
    expect(cmd.body.callTotals.atendidasHistorico, "atendidasHistorico del Comando difiere de connects canónicos").toBe(ccmAll.body.metrics.connects);
    const ccmToday = await request(app).get("/api/setters/cold-call-metrics?period=today").set("Cookie", adminCookie);
    expect(cmd.body.callTotals.llamadasHoy).toBe(ccmToday.body.metrics.dials);
    const expectedPct = ccmToday.body.metrics.dials > 0
      ? ((ccmToday.body.metrics.connects / ccmToday.body.metrics.dials) * 100).toFixed(1) : "0.0";
    expect(cmd.body.callTotals.pctAtendidasHoy, "pctAtendidasHoy no usa la definición canónica").toBe(expectedPct);
    const rowA = cmd.body.callsPerSetter.find((s) => s.id === "s_a");
    const ccmA = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=all").set("Cookie", adminCookie);
    expect(rowA.totalLlamadas).toBe(ccmA.body.metrics.dials);
    // ?period=week en el Comando filtra el bloque de llamadas con el rango canónico
    const cmdW = await request(app).get("/api/setters/command?period=week").set("Cookie", adminCookie);
    const ccmW = await request(app).get("/api/setters/cold-call-metrics?period=week").set("Cookie", adminCookie);
    expect(cmdW.body.callTotals.totalLlamadas).toBe(ccmW.body.metrics.dials);
    expect(cmdW.body.callTotals.atendidasHistorico).toBe(ccmW.body.metrics.connects);
  });
  it("A4: reporte semanal — answeredWeek con la definición canónica (hung_up cuenta)", async () => {
    const r = await request(app).get("/api/admin/weekly-report/preview").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const dow = M._bizDayOfWeek(dayStart) || 7;
    const thisMonday = dayStart - (dow - 1) * oneDay;
    const lastMonday = thisMonday - 7 * oneDay;
    const inWeek = FIXTURE_CALLS.filter((c) => c.ts >= lastMonday && c.ts < thisMonday);
    expect(r.body.data.calls.totalWeek).toBe(inWeek.length);
    expect(r.body.data.calls.answeredWeek).toBe(inWeek.filter((c) => isConnect(c.outcome)).length);
    // El hung_up de la semana pasada está garantizado en ventana → answeredWeek > 0.
    expect(r.body.data.calls.answeredWeek).toBeGreaterThan(0);
  });
  it("A5: effectiveness — reached == attended == answered (una sola definición) + voicemailPct", async () => {
    const r = await request(app).get("/api/telnyx/cold-call-effectiveness?range=all").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const telnyx = FIXTURE_CALLS.filter((c) => c.channel === "telnyx_webrtc");
    expect(r.body.totals.calls).toBe(telnyx.length);
    const expConnects = telnyx.filter((c) => isConnect(c.outcome)).length;
    expect(r.body.breakdown.connectsCount).toBe(expConnects);
    expect(r.body.breakdown.reachedCount, "reached difiere del canon").toBe(expConnects);
    expect(r.body.breakdown.attendedCount, "attended difiere del canon").toBe(expConnects);
    expect(r.body.abandoned.answered).toBe(expConnects);
    expect(r.body.ratios.attendedPct).toBe(r.body.ratios.reachedHumanPct);
    expect(typeof r.body.ratios.voicemailPct).toBe("number");
  });
});

describe("B · serie temporal — TZ, custom, previous, RBAC", () => {
  it("B1: la llamada de ayer 23:30 AR cae en el bucket de AYER (no en hoy)", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=week&series=1&granularity=day").set("Cookie", adminCookie);
    const yesterday = M._bizDayStr(tsLateNight);
    const bYesterday = r.body.buckets.find((b) => b.label === yesterday);
    expect(bYesterday, "falta el bucket de ayer").toBeTruthy();
    expect(bYesterday.dials).toBe(1); // scheduled_with_admin de l2
    expect(bYesterday.appointments).toBe(1);
    const bToday = r.body.buckets.find((b) => b.label === M._bizDayStr(tsToday));
    expect(bToday.dials).toBe(6); // las 6 de l1
  });
  it("B2: from/to custom inclusivo filtra la serie y los totales", async () => {
    const d3 = M._bizDayStr(ts3d);
    const r = await request(app).get(`/api/setters/cold-call-metrics?setter=s_a&from=${d3}&to=${d3}&series=1`).set("Cookie", adminCookie);
    expect(r.body.metrics.dials).toBe(2); // solo las 2 de l3
    expect(r.body.buckets.length).toBe(1);
    expect(r.body.buckets[0].dials).toBe(2);
  });
  it("B3: compare=1 devuelve ventana espejo con deltas", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=week&compare=1").set("Cookie", adminCookie);
    expect(r.body.previous).toBeTruthy();
    expect(r.body.previous.metrics.dials).toBe(0); // no hay llamadas de A entre -14d y -7d
    expect(r.body.deltas.dials.abs).toBe(EXP_A_7D.dials);
    // ventana espejo: mismo largo, pegada a fromTs
    const prevFrom = new Date(r.body.previous.from).getTime();
    const prevTo = new Date(r.body.previous.to).getTime();
    expect(prevTo).toBe(r.body.fromTs);
    expect(prevTo - prevFrom).toBe(new Date(r.body.to).getTime() - r.body.fromTs);
  });
  it("B4: assigned = cartera actual con 'sin llamar' por dueño (criterio #139)", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_a&period=week").set("Cookie", adminCookie);
    expect(r.body.assigned).toEqual({ total: 3, sinContactar: 1 }); // l1, l2, l6 — l6 sin llamar
    const rb = await request(app).get("/api/setters/cold-call-metrics?setter=s_b&period=week").set("Cookie", adminCookie);
    // B tiene l3 (llamado por A → para B cuenta sin llamar), l4 (ghost → sin
    // atribuir → sin llamar para B) y l5 (llamado por B).
    expect(rb.body.assigned).toEqual({ total: 3, sinContactar: 2 });
  });
  it("B5: RBAC — setter solo ve lo suyo aunque pida otro setter", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?setter=s_b&period=week&series=1").set("Cookie", setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.setterId).toBe("s_a");
    expect(r.body.metrics.dials).toBe(EXP_A_7D.dials);
  });
  it("B6: RBAC — supervisor scoped: agregado = solo sus setters; oculto → 403", async () => {
    const r = await request(app).get("/api/setters/cold-call-metrics?period=week&series=1").set("Cookie", supCookie);
    expect(r.status).toBe(200);
    // Solo ve a s_a → el agregado es exactamente lo de A (la llamada ghost y las de B quedan afuera).
    expect(r.body.metrics.dials).toBe(EXP_A_7D.dials);
    const sum = r.body.buckets.reduce((a, b) => a + b.dials, 0);
    expect(sum).toBe(EXP_A_7D.dials);
    const forbidden = await request(app).get("/api/setters/cold-call-metrics?setter=s_b&period=week").set("Cookie", supCookie);
    expect(forbidden.status).toBe(403);
  });
});
