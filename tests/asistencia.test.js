// Tests del show rate: campo lead.asistio + endpoints de asistencia + backfill.
// Tambien valida que el rol supervisor puede marcar asistencia.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `asistencia-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-as@local.test";
process.env.ADMIN_PASSWORD = "aspass1234";
process.env.ADMIN_NAME = "AdminAS";
process.env.JWT_SECRET = "test-secret-as";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_as", email: "admin-as@local.test", name: "AdminAS", role: "admin", status: "active", setterId: "", password: pwd("aspass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_as", email: "super-as@local.test", name: "SuperAS", role: "supervisor", status: "active", setterId: "", password: pwd("superpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_as", email: "setter-as@local.test", name: "SetterAS", role: "setter", status: "active", setterId: "setter_as", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Pre-poblar setters.json con un lead agendado y otro no agendado, mas calendar entries.
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_as", name: "SetterAS" }],
    variants: [],
    leads: {
      lead_agendado: {
        num: 1, name: "Clinica A", phone: "+5491111", assignedTo: "setter_as",
        estado: "agendado", conexion: "enviada", respondio: true, calificado: true,
        interes: "si", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        notes: [], interactions: [], importedAt: new Date().toISOString(),
      },
      lead_pendiente: {
        num: 2, name: "Clinica B", phone: "+5492222", assignedTo: "setter_as",
        estado: "calificado", conexion: "enviada", respondio: true, calificado: true,
        interes: "si", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        notes: [], interactions: [], importedAt: new Date().toISOString(),
      },
      lead_show_calendar: {
        num: 3, name: "Clinica C", phone: "+5493333", assignedTo: "setter_as",
        estado: "agendado", conexion: "enviada", respondio: true, calificado: true,
        interes: "si", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        notes: [], interactions: [], importedAt: new Date().toISOString(),
      },
      lead_noshow_calendar: {
        num: 4, name: "Clinica D", phone: "+5494444", assignedTo: "setter_as",
        estado: "agendado", conexion: "enviada", respondio: true, calificado: true,
        interes: "si", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        notes: [], interactions: [], importedAt: new Date().toISOString(),
      },
    },
    calendar: [
      { id: "cal_1", leadId: "lead_show_calendar", calendarioEstado: "realizada", updatedAt: new Date().toISOString() },
      { id: "cal_2", leadId: "lead_noshow_calendar", calendarioEstado: "no_show", updatedAt: new Date().toISOString() },
    ],
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
  adminCookie = await loginCookie("admin-as@local.test", "aspass1234");
  superCookie = await loginCookie("super-as@local.test", "superpass");
  setterCookie = await loginCookie("setter-as@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("PATCH /api/setters/leads/:id/asistencia · RBAC + validacion", () => {
  it("setter no puede marcar asistencia (403)", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_agendado/asistencia")
      .set("Cookie", setterCookie)
      .send({ asistio: true });
    expect(r.status).toBe(403);
  });

  it("supervisor puede marcar asistencia", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_agendado/asistencia")
      .set("Cookie", superCookie)
      .send({ asistio: true });
    expect(r.status).toBe(200);
    expect(r.body.asistio).toBe(true);
    expect(r.body.asistioBy).toBe("SuperAS");
    expect(r.body.asistioAt).toBeTruthy();
  });

  it("admin puede marcar como no-show con nota", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_agendado/asistencia")
      .set("Cookie", adminCookie)
      .send({ asistio: false, note: "No contestó el WhatsApp en la hora pactada." });
    expect(r.status).toBe(200);
    expect(r.body.asistio).toBe(false);
  });

  it("400 si lead no esta en estado agendado", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_pendiente/asistencia")
      .set("Cookie", adminCookie)
      .send({ asistio: true });
    expect(r.status).toBe(400);
  });

  it("400 si asistio no es bool/null", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_agendado/asistencia")
      .set("Cookie", adminCookie)
      .send({ asistio: "yes" });
    expect(r.status).toBe(400);
  });

  it("404 si lead no existe", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_nope/asistencia")
      .set("Cookie", adminCookie)
      .send({ asistio: true });
    expect(r.status).toBe(404);
  });

  it("asistio=null resetea fields", async () => {
    const r = await request(app)
      .patch("/api/setters/leads/lead_agendado/asistencia")
      .set("Cookie", adminCookie)
      .send({ asistio: null });
    expect(r.status).toBe(200);
    expect(r.body.asistio).toBeNull();
    expect(r.body.asistioBy).toBe("");
  });
});

describe("POST /api/setters/asistencia/backfill", () => {
  it("setter/supervisor no pueden hacer backfill", async () => {
    const r1 = await request(app).post("/api/setters/asistencia/backfill").set("Cookie", setterCookie);
    expect(r1.status).toBe(403);
    const r2 = await request(app).post("/api/setters/asistencia/backfill").set("Cookie", superCookie);
    expect(r2.status).toBe(403);
  });

  it("admin backfill aplica calendarioEstado a leads con asistio=null", async () => {
    const r = await request(app).post("/api/setters/asistencia/backfill").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(2);
  });

  it("backfill es idempotente: segunda corrida no actualiza", async () => {
    const r = await request(app).post("/api/setters/asistencia/backfill").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(0);
    expect(r.body.skipped).toBe(2);
  });
});
