// Tests de /api/setters/team-performance + /api/setters/alert-config.
// RBAC, alertas (drop/inactivity/low_apertura), promedios, edicion umbrales.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `team-perf-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tp@local.test";
process.env.ADMIN_PASSWORD = "tppass1234";
process.env.ADMIN_NAME = "AdminTP";
process.env.JWT_SECRET = "test-secret-tp";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_tp", email: "admin-tp@local.test", name: "AdminTP", role: "admin", status: "active", setterId: "", password: pwd("tppass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_tp", email: "super-tp@local.test", name: "SuperTP", role: "supervisor", status: "active", setterId: "", password: pwd("superpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_tp", email: "setter-tp@local.test", name: "SetterTP", role: "setter", status: "active", setterId: "setter_tp1", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const NOW = Date.now();
const ONE_DAY = 24 * 60 * 60 * 1000;
const t = (offsetDays) => new Date(NOW - offsetDays * ONE_DAY).toISOString();

// 3 setters: uno activo, uno con drop, uno inactivo
const leads = {
  // setter_a: 5 leads en periodo actual + 2 anteriores → activo, sin drop
  l_a1: { num: 1, name: "A1", phone: "+1", assignedTo: "setter_a", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(20), lastContactAt: t(2), interactions: [{ id: "i1", action: "open", createdAt: t(2), setterId: "setter_a" }, { id: "i2", action: "qualified", createdAt: t(2), setterId: "setter_a" }] },
  l_a2: { num: 2, name: "A2", phone: "+2", assignedTo: "setter_a", estado: "agendado", conexion: "enviada", respondio: true, calificado: true, interes: "si", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(20), lastContactAt: t(3), interactions: [{ id: "i3", action: "open", createdAt: t(3), setterId: "setter_a" }, { id: "i4", action: "qualified", createdAt: t(3), setterId: "setter_a" }, { id: "i5", action: "interest", createdAt: t(3), setterId: "setter_a" }] },
  l_a3: { num: 3, name: "A3", phone: "+3", assignedTo: "setter_a", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(20), lastContactAt: t(4), interactions: [{ id: "i6", action: "open", createdAt: t(4), setterId: "setter_a" }] },
  l_a4: { num: 4, name: "A4", phone: "+4", assignedTo: "setter_a", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(20), lastContactAt: t(5), interactions: [{ id: "i7", action: "open", createdAt: t(5), setterId: "setter_a" }] },
  l_a5: { num: 5, name: "A5", phone: "+5", assignedTo: "setter_a", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(20), lastContactAt: t(6), interactions: [{ id: "i8", action: "open", createdAt: t(6), setterId: "setter_a" }] },
  l_a_prev1: { num: 6, name: "Aprev1", phone: "+6", assignedTo: "setter_a", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(15), interactions: [{ id: "ip1", action: "open", createdAt: t(15), setterId: "setter_a" }] },
  l_a_prev2: { num: 7, name: "Aprev2", phone: "+7", assignedTo: "setter_a", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(20), interactions: [{ id: "ip2", action: "open", createdAt: t(20), setterId: "setter_a" }] },

  // setter_b: 1 lead en actual + 5 en anterior → drop pesado
  l_b1: { num: 8, name: "B1", phone: "+8", assignedTo: "setter_b", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(2), interactions: [{ id: "ib1", action: "open", createdAt: t(2), setterId: "setter_b" }] },
  l_b_prev1: { num: 9, name: "Bp1", phone: "+9", assignedTo: "setter_b", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(15), interactions: [{ id: "ipb1", action: "open", createdAt: t(15), setterId: "setter_b" }] },
  l_b_prev2: { num: 10, name: "Bp2", phone: "+10", assignedTo: "setter_b", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(16), interactions: [{ id: "ipb2", action: "open", createdAt: t(16), setterId: "setter_b" }] },
  l_b_prev3: { num: 11, name: "Bp3", phone: "+11", assignedTo: "setter_b", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(17), interactions: [{ id: "ipb3", action: "open", createdAt: t(17), setterId: "setter_b" }] },
  l_b_prev4: { num: 12, name: "Bp4", phone: "+12", assignedTo: "setter_b", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(18), interactions: [{ id: "ipb4", action: "open", createdAt: t(18), setterId: "setter_b" }] },
  l_b_prev5: { num: 13, name: "Bp5", phone: "+13", assignedTo: "setter_b", estado: "calificado", conexion: "enviada", respondio: true, calificado: true, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(30), lastContactAt: t(19), interactions: [{ id: "ipb5", action: "open", createdAt: t(19), setterId: "setter_b" }] },

  // setter_c: ningun lead activo, ultimo lastContactAt hace 30 dias → inactivo
  l_c_old: { num: 14, name: "Cold", phone: "+14", assignedTo: "setter_c", estado: "calificado", conexion: "enviada", respondio: false, calificado: false, interes: "no", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false }, notes: [], importedAt: t(45), lastContactAt: t(30), interactions: [{ id: "ic1", action: "open", createdAt: t(30), setterId: "setter_c" }] },
};

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_a", name: "SetterA" },
      { id: "setter_b", name: "SetterB" },
      { id: "setter_c", name: "SetterC" },
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
let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-tp@local.test", "tppass1234");
  superCookie = await loginCookie("super-tp@local.test", "superpass");
  setterCookie = await loginCookie("setter-tp@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("RBAC", () => {
  it("setter no accede a /team-performance (403)", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });
  it("supervisor accede", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", superCookie);
    expect(r.status).toBe(200);
  });
  it("admin accede", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
  });
});

describe("Shape y agregaciones", () => {
  it("perSetter tiene los 3 setters con current/previous/deltas/alerts", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.perSetter.length).toBe(3);
    for (const s of r.body.perSetter) {
      expect(s).toHaveProperty("current");
      expect(s).toHaveProperty("previous");
      expect(s).toHaveProperty("deltas");
      expect(Array.isArray(s.alerts)).toBe(true);
    }
  });

  it("teamAverages calcula promedios solo de setters activos (total > 0)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    expect(r.body.teamAverages).toHaveProperty("total");
    // setter_a (5) + setter_b (1) = 6 / 2 setters activos = 3
    expect(r.body.teamAverages.total).toBe(3);
  });
});

describe("Alertas automáticas", () => {
  it("setter_b genera alerta drop (1 vs 5 = -80%, umbral default 30%)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const alerts = r.body.alerts.filter((a) => a.setterId === "setter_b");
    const drop = alerts.find((a) => a.type === "drop");
    expect(drop).toBeTruthy();
    expect(drop.severity).toBe("high");
  });

  it("setter_c genera alerta inactivity (sin contacto > 7 días)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const alerts = r.body.alerts.filter((a) => a.setterId === "setter_c");
    const inact = alerts.find((a) => a.type === "inactivity");
    expect(inact).toBeTruthy();
  });

  it("setter_a sin alertas (total estable, actividad reciente)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const alerts = r.body.alerts.filter((a) => a.setterId === "setter_a");
    expect(alerts.length).toBe(0);
  });

  it("alertas ordenadas por severity (high → medium → low)", async () => {
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const sevOrder = { high: 0, medium: 1, low: 2 };
    for (let i = 1; i < r.body.alerts.length; i++) {
      expect(sevOrder[r.body.alerts[i - 1].severity]).toBeLessThanOrEqual(sevOrder[r.body.alerts[i].severity]);
    }
  });
});

describe("Alert config", () => {
  it("GET admin/supervisor lee config", async () => {
    const r1 = await request(app).get("/api/setters/alert-config").set("Cookie", adminCookie);
    expect(r1.status).toBe(200);
    expect(r1.body.dropPctThreshold).toBe(30);
    const r2 = await request(app).get("/api/setters/alert-config").set("Cookie", superCookie);
    expect(r2.status).toBe(200);
  });

  it("PUT solo admin puede editar (supervisor 403)", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", superCookie).send({ dropPctThreshold: 50 });
    expect(r.status).toBe(403);
  });

  it("PUT admin actualiza umbrales válidos", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ dropPctThreshold: 50, inactivityDays: 14 });
    expect(r.status).toBe(200);
    expect(r.body.dropPctThreshold).toBe(50);
    expect(r.body.inactivityDays).toBe(14);
  });

  it("PUT con valores fuera de rango ignora pero acepta los válidos", async () => {
    const r = await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ dropPctThreshold: 999, aperturaPctMin: 25 });
    // 999 fuera de rango -> no aplica, pero aperturaPctMin sí
    expect(r.status).toBe(200);
    expect(r.body.aperturaPctMin).toBe(25);
  });

  it("subir umbral drop a 90% → setter_b ya no genera alerta drop", async () => {
    await request(app).put("/api/setters/alert-config").set("Cookie", adminCookie).send({ dropPctThreshold: 90 });
    const r = await request(app).get("/api/setters/team-performance?period=day").set("Cookie", adminCookie);
    const dropB = r.body.alerts.find((a) => a.setterId === "setter_b" && a.type === "drop");
    // 1 vs 5 = -80%, ahora umbral 90% → ya NO alerta
    expect(dropB).toBeUndefined();
  });
});
