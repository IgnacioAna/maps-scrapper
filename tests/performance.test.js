// Tests de GET /api/setters/performance: agregaciones temporales, RBAC,
// comparativa con periodo anterior, buckets dia/semana/mes.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `perf-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-perf@local.test";
process.env.ADMIN_PASSWORD = "perfpass1234";
process.env.ADMIN_NAME = "AdminPerf";
process.env.JWT_SECRET = "test-secret-perf";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_perf", email: "admin-perf@local.test", name: "AdminPerf", role: "admin", status: "active", setterId: "", password: pwd("perfpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_perf", email: "super-perf@local.test", name: "SuperPerf", role: "supervisor", status: "active", setterId: "", password: pwd("superpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setterA", email: "setterA-perf@local.test", name: "SetterA", role: "setter", status: "active", setterId: "setter_a", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setterB", email: "setterB-perf@local.test", name: "SetterB", role: "setter", status: "active", setterId: "setter_b", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Construir leads con timestamps controlados.
const NOW = Date.now();
const ONE_DAY = 24 * 60 * 60 * 1000;
const t = (offsetDays) => new Date(NOW - offsetDays * ONE_DAY).toISOString();

const leads = {
  // setter_a · 3 leads en últimos 7 días
  l_a1: {
    num: 1, name: "A1", phone: "+5491111", assignedTo: "setter_a",
    estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no",
    followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    notes: [], importedAt: t(10), lastContactAt: t(2),
    interactions: [
      { id: "i1", action: "open", createdAt: t(2), setterId: "setter_a" },
      { id: "i2", action: "qualified", createdAt: t(2), setterId: "setter_a" },
    ],
  },
  l_a2: {
    num: 2, name: "A2", phone: "+5491112", assignedTo: "setter_a",
    estado: "agendado", conexion: "enviada", respondio: true, calificado: true, interes: "si",
    followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    notes: [], importedAt: t(15), lastContactAt: t(3),
    interactions: [
      { id: "i3", action: "open", createdAt: t(5), setterId: "setter_a" },
      { id: "i4", action: "qualified", createdAt: t(4), setterId: "setter_a" },
      { id: "i5", action: "interest", createdAt: t(3), setterId: "setter_a" },
    ],
    asistio: true, asistioAt: t(1), asistioBy: "AdminPerf",
  },
  l_a3: {
    num: 3, name: "A3", phone: "+5491113", assignedTo: "setter_a",
    estado: "agendado", conexion: "enviada", respondio: true, calificado: true, interes: "si",
    followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    notes: [], importedAt: t(20), lastContactAt: t(6),
    interactions: [
      { id: "i6", action: "open", createdAt: t(7), setterId: "setter_a" },
      { id: "i7", action: "interest", createdAt: t(6), setterId: "setter_a" },
    ],
    asistio: false, asistioAt: t(2), asistioBy: "AdminPerf",
  },
  // setter_a · 2 leads en periodo ANTERIOR (entre día 14 y 21)
  l_a_prev1: {
    num: 4, name: "AP1", phone: "+5491114", assignedTo: "setter_a",
    estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no",
    followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    notes: [], importedAt: t(25), lastContactAt: t(15),
    interactions: [{ id: "ip1", action: "open", createdAt: t(15), setterId: "setter_a" }],
  },
  l_a_prev2: {
    num: 5, name: "AP2", phone: "+5491115", assignedTo: "setter_a",
    estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no",
    followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    notes: [], importedAt: t(30), lastContactAt: t(18),
    interactions: [
      { id: "ip2", action: "open", createdAt: t(18), setterId: "setter_a" },
      { id: "ip3", action: "qualified", createdAt: t(17), setterId: "setter_a" },
    ],
  },
  // setter_b · 1 lead reciente
  l_b1: {
    num: 6, name: "B1", phone: "+5492221", assignedTo: "setter_b",
    estado: "calificado", conexion: "enviada", respondio: false, calificado: true, interes: "no",
    followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
    notes: [], importedAt: t(8), lastContactAt: t(2),
    interactions: [{ id: "ib1", action: "open", createdAt: t(2), setterId: "setter_b" }],
  },
};

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_a", name: "SetterA" },
      { id: "setter_b", name: "SetterB" },
    ],
    variants: [],
    leads,
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
let superCookie = "";
let setterACookie = "";
let setterBCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-perf@local.test", "perfpass1234");
  superCookie = await loginCookie("super-perf@local.test", "superpass");
  setterACookie = await loginCookie("setterA-perf@local.test", "setterpass");
  setterBCookie = await loginCookie("setterB-perf@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("GET /api/setters/performance · RBAC + scope", () => {
  it("sin auth = 401", async () => {
    const r = await request(app).get("/api/setters/performance");
    expect(r.status).toBe(401);
  });

  it("setter recibe solo su data (forzado a su id)", async () => {
    const r = await request(app).get("/api/setters/performance?period=day").set("Cookie", setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.setter).toBe("setter_a");
    expect(r.body.setterScope).toBe("self");
    // En period=day (14 días default), solo los 3 leads recientes de A (días 2, 3, 6)
    expect(r.body.totals.total).toBe(3);
  });

  it("setter no puede ver otro setter (su id se fuerza)", async () => {
    const r = await request(app).get("/api/setters/performance?setter=setter_b").set("Cookie", setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.setter).toBe("setter_a"); // forzado, no honra el query
  });

  it("admin ve scope=team sin setter param", async () => {
    const r = await request(app).get("/api/setters/performance?period=day").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setterScope).toBe("team");
    expect(r.body.totals.total).toBe(4); // 3 de A + 1 de B (en últimos 14 días)
    expect(Array.isArray(r.body.setters)).toBe(true);
    expect(r.body.setters.length).toBe(2);
  });

  it("supervisor ve scope=team", async () => {
    const r = await request(app).get("/api/setters/performance").set("Cookie", superCookie);
    expect(r.status).toBe(200);
    expect(r.body.setterScope).toBe("team");
  });

  it("admin filtra por setter especifico", async () => {
    const r = await request(app).get("/api/setters/performance?setter=setter_b").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.setter).toBe("setter_b");
    expect(r.body.totals.total).toBe(1);
  });
});

describe("Agregaciones · KPIs y comparativa", () => {
  it("setter_a en últimos 14 días: total=3, conexiones=3, calificados=2, interesados=2, agendados=2, shows=1, noShows=1", async () => {
    const r = await request(app).get("/api/setters/performance?period=day").set("Cookie", setterACookie);
    expect(r.status).toBe(200);
    expect(r.body.totals.total).toBe(3);
    expect(r.body.totals.conexiones).toBe(3);
    expect(r.body.totals.calificados).toBe(2);
    expect(r.body.totals.interesados).toBe(2);
    expect(r.body.totals.agendados).toBe(2); // l_a2 y l_a3 ambos con estado=agendado
    expect(r.body.totals.shows).toBe(1);
    expect(r.body.totals.noShows).toBe(1);
    expect(r.body.totals.pctShow).toBe(50);
  });

  it("comparativa con periodo anterior tiene deltas (period=day → 14 días vs 14 días previos)", async () => {
    const r = await request(app).get("/api/setters/performance?period=day").set("Cookie", setterACookie);
    // Periodo anterior (días 15-28) contiene l_a_prev1 (día 15) y l_a_prev2 (día 18)
    expect(r.body.previous.total).toBe(2);
    expect(r.body.deltas.total.abs).toBe(1); // 3 - 2
    expect(r.body.deltas.total.pct).toBe(50); // (3-2)/2 * 100
  });

  it("buckets diarios tienen length correcta", async () => {
    const r = await request(app).get("/api/setters/performance?period=day").set("Cookie", setterACookie);
    expect(r.body.period).toBe("day");
    expect(r.body.buckets.length).toBeGreaterThanOrEqual(13);
    expect(r.body.buckets.length).toBeLessThanOrEqual(15);
    // Cada bucket tiene shape esperado
    const b = r.body.buckets[0];
    expect(b).toHaveProperty("label");
    expect(b).toHaveProperty("from");
    expect(b).toHaveProperty("to");
    expect(b).toHaveProperty("total");
    expect(b).toHaveProperty("conexiones");
  });

  it("buckets semanales tienen ~8 elementos", async () => {
    const r = await request(app).get("/api/setters/performance?period=week").set("Cookie", setterACookie);
    expect(r.body.buckets.length).toBeGreaterThanOrEqual(8);
    expect(r.body.buckets.length).toBeLessThanOrEqual(10);
  });

  it("buckets mensuales tienen 6-7 elementos", async () => {
    const r = await request(app).get("/api/setters/performance?period=month").set("Cookie", setterACookie);
    expect(r.body.buckets.length).toBeGreaterThanOrEqual(6);
    expect(r.body.buckets.length).toBeLessThanOrEqual(8);
  });

  it("range custom desde from/to ISO", async () => {
    const fromISO = new Date(NOW - 4 * ONE_DAY).toISOString();
    const toISO = new Date(NOW).toISOString();
    const r = await request(app).get(`/api/setters/performance?period=day&from=${fromISO}&to=${toISO}`).set("Cookie", setterACookie);
    expect(r.status).toBe(200);
    // En los últimos 4 días, setter_a tiene actividad en l_a1 (t=2) y l_a2 (t=3)
    expect(r.body.totals.total).toBe(2);
  });

  it("range invertido = 400", async () => {
    const r = await request(app).get(`/api/setters/performance?from=${new Date(NOW).toISOString()}&to=${new Date(NOW - ONE_DAY).toISOString()}`).set("Cookie", setterACookie);
    expect(r.status).toBe(400);
  });

  it("pctShow=0 cuando no hubo agendados con asistencia marcada", async () => {
    const r = await request(app).get("/api/setters/performance?period=week").set("Cookie", setterBCookie);
    expect(r.body.totals.pctShow).toBe(0);
  });
});
