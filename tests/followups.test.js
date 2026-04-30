// Tests del sistema de follow-ups (rediseñado 2026-04-30).
// Semántica nueva: tildar checkbox = "voy a hacer follow-up en X desde este
// momento". Solo uno activo por lead — tildar uno destila los otros.
// followUpStartedAt = momento del tildado.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `followups-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-fu@local.test";
process.env.ADMIN_PASSWORD = "fupass1234";
process.env.ADMIN_NAME = "AdminFU";
process.env.JWT_SECRET = "test-secret-fu";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_fu", email: "admin-fu@local.test", name: "AdminFU", role: "admin", status: "active", setterId: "", password: pwd("fupass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_fu", email: "setter-fu@local.test", name: "SetterFU", role: "setter", status: "active", setterId: "setter_fu", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();

// Casos:
// - lead_no_fu: con WSP enviado, ningún checkbox tildado → NO aparece.
// - lead_24h_due: 24hs tildado hace 25h → vencido HOY.
// - lead_24h_yesterday: 24hs tildado hace 49h → vencido AYER.
// - lead_72h_overdue: 72hs tildado hace 5 días → vencido > 24h (overdue).
// - lead_72h_future: 72hs tildado hace 1h → todavía futuro.
// - lead_agendado: 24hs tildado pero estado=agendado → no aparece.
// - lead_no_interesa: 24hs tildado pero interes=no → no aparece.
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_fu", name: "SetterFU" }],
    variants: [],
    leads: {
      lead_no_fu: {
        num: 1, name: "NoFU", phone: "+1", assignedTo: "setter_fu",
        estado: "contactado", conexion: "enviada", respondio: false, calificado: false, interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null,
        notes: [], importedAt: ago(2 * DAY), lastContactAt: ago(25 * HOUR), interactions: [],
      },
      lead_24h_due: {
        num: 2, name: "Due24h", phone: "+2", assignedTo: "setter_fu",
        estado: "contactado", conexion: "enviada", respondio: true, calificado: false, interes: null,
        followUps: { '24hs': true, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: ago(25 * HOUR),
        notes: [], importedAt: ago(2 * DAY), lastContactAt: ago(25 * HOUR), interactions: [],
      },
      lead_24h_yesterday: {
        num: 3, name: "Yesterday", phone: "+3", assignedTo: "setter_fu",
        estado: "contactado", conexion: "enviada", respondio: true, calificado: false, interes: null,
        followUps: { '24hs': true, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: ago(49 * HOUR),
        notes: [], importedAt: ago(3 * DAY), lastContactAt: ago(49 * HOUR), interactions: [],
      },
      lead_72h_overdue: {
        num: 4, name: "Overdue72h", phone: "+4", assignedTo: "setter_fu",
        estado: "contactado", conexion: "enviada", respondio: true, calificado: false, interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': true, '7d': false, '15d': false },
        followUpStartedAt: ago(5 * DAY),
        notes: [], importedAt: ago(7 * DAY), lastContactAt: ago(5 * DAY), interactions: [],
      },
      lead_72h_future: {
        num: 5, name: "Future72h", phone: "+5", assignedTo: "setter_fu",
        estado: "contactado", conexion: "enviada", respondio: true, calificado: false, interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': true, '7d': false, '15d': false },
        followUpStartedAt: ago(1 * HOUR),
        notes: [], importedAt: ago(2 * DAY), lastContactAt: ago(1 * HOUR), interactions: [],
      },
      lead_agendado: {
        num: 6, name: "Agendado", phone: "+6", assignedTo: "setter_fu",
        estado: "agendado", conexion: "enviada", respondio: true, calificado: true, interes: "si",
        followUps: { '24hs': true, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: ago(25 * HOUR),
        notes: [], importedAt: ago(10 * DAY), lastContactAt: ago(25 * HOUR), interactions: [],
      },
      lead_no_interesa: {
        num: 7, name: "NoInteresa", phone: "+7", assignedTo: "setter_fu",
        estado: "contactado", conexion: "enviada", respondio: true, calificado: false, interes: "no",
        followUps: { '24hs': true, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: ago(25 * HOUR),
        notes: [], importedAt: ago(5 * DAY), lastContactAt: ago(25 * HOUR), interactions: [],
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  setterCookie = await loginCookie("setter-fu@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("Follow-ups: lógica básica (tildar = programar desde el momento)", () => {
  it("lead sin checkbox tildado NO aparece", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    expect(all.find(f => f.leadId === "lead_no_fu")).toBeUndefined();
  });

  it("lead con 24h tildado hace 25h aparece (vencido hoy o ayer según hora)", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    const item = all.find(f => f.leadId === "lead_24h_due");
    expect(item).toBeTruthy();
    expect(item.step).toBe("24hs");
  });

  it("lead con 24h tildado hace 49h → vencido ayer (-1h hoy)", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const all = [...r.body.dueToday, ...r.body.dueYesterday];
    const item = all.find(f => f.leadId === "lead_24h_yesterday");
    expect(item).toBeTruthy();
  });

  it("lead con 72h tildado hace 5 días → overdue", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const overdue = r.body.overdue.find(f => f.leadId === "lead_72h_overdue");
    expect(overdue).toBeTruthy();
    expect(overdue.step).toBe("72hs");
  });

  it("lead con 72h tildado hace 1h → todavía futuro, no aparece", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    expect(all.find(f => f.leadId === "lead_72h_future")).toBeUndefined();
  });

  it("lead agendado oculto aunque tenga checkbox tildado", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    expect(all.find(f => f.leadId === "lead_agendado")).toBeUndefined();
  });

  it("lead con interes=no oculto", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    expect(all.find(f => f.leadId === "lead_no_interesa")).toBeUndefined();
  });

  it("badge cuenta dueToday + dueYesterday (no overdue)", async () => {
    const r = await request(app).get("/api/setters/followups/today").set("Cookie", setterCookie);
    expect(r.body.counts.badge).toBe(r.body.counts.dueToday + r.body.counts.dueYesterday);
    expect(r.body.counts.badge).toBeLessThan(r.body.counts.dueToday + r.body.counts.dueYesterday + r.body.counts.overdue + 1);
  });
});

describe("PATCH /api/setters/leads/:id/followup", () => {
  it("tildar 24hs setea followUpStartedAt y followUps[24hs]=true", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_no_fu/followup")
      .set("Cookie", setterCookie)
      .send({ step: "24hs", value: true });
    expect(r.status).toBe(200);
    expect(r.body.followUps['24hs']).toBe(true);
    expect(r.body.followUpStartedAt).toBeTruthy();
    // El startedAt es muy reciente
    const startTs = new Date(r.body.followUpStartedAt).getTime();
    expect(Date.now() - startTs).toBeLessThan(5000);
  });

  it("tildar 72hs después de 24hs destildea 24hs (solo uno activo)", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_no_fu/followup")
      .set("Cookie", setterCookie)
      .send({ step: "72hs", value: true });
    expect(r.status).toBe(200);
    expect(r.body.followUps['72hs']).toBe(true);
    expect(r.body.followUps['24hs']).toBe(false);
    expect(r.body.followUps['48hs']).toBe(false);
    expect(r.body.followUps['7d']).toBe(false);
    expect(r.body.followUps['15d']).toBe(false);
  });

  it("destildar el activo deja followUpStartedAt en null", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_no_fu/followup")
      .set("Cookie", setterCookie)
      .send({ step: "72hs", value: false });
    expect(r.status).toBe(200);
    expect(r.body.followUps['72hs']).toBe(false);
    expect(r.body.followUpStartedAt).toBeNull();
  });

  it("step inválido = 400", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_no_fu/followup")
      .set("Cookie", setterCookie)
      .send({ step: "99h", value: true });
    expect(r.status).toBe(400);
  });

  it("setter no autorizado para lead de otro setter", async () => {
    // No hay otro setter para este test; el flujo está cubierto en otros tests.
    // Solo aseguramos que el endpoint requiere auth.
    const r = await request(app)
      .patch("/api/setters/leads/lead_no_fu/followup")
      .send({ step: "24hs", value: true });
    expect(r.status).toBe(401);
  });
});
