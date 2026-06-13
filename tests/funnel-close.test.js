// Tests del cierre del funnel SDR: marcar una cita del calendario como 'ganada'
// cierra la venta (lead.estado='cerrado' + closedAt + dealValue) y el endpoint
// cold-call-metrics cuenta el deal + revenue, atribuyéndolo al setter que agendó.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `funnel-close-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-fc@local.test";
process.env.ADMIN_PASSWORD = "fcpass1234";
process.env.ADMIN_NAME = "AdminFC";
process.env.JWT_SECRET = "test-secret-fc";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_fc", email: "admin-fc@local.test", name: "AdminFC", role: "admin", status: "active", setterId: "", password: pwd("fcpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_fc", email: "setter-fc@local.test", name: "SetterFC", role: "setter", status: "active", setterId: "setter_fc", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_fc", name: "SetterFC" }],
    variants: [],
    leads: {
      lead_won: {
        num: 1, name: "Clinica Won", phone: "+5491111", assignedTo: "setter_fc",
        estado: "agendado", conexion: "sin_wsp", respondio: true, calificado: true,
        interes: "si", followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        notes: [], interactions: [], importedAt: new Date().toISOString(),
      },
    },
    calendar: [
      { id: "cal_won", leadId: "lead_won", calendarioEstado: "realizada", fecha: new Date().toISOString(), nombre: "Clinica Won", valorProyecto: 0, comision: 0, setterId: "setter_fc", sourceCall: true },
    ],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-fc@local.test", "fcpass1234");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("Cierre del funnel · marcar cita 'ganada'", () => {
  it("marca la cita ganada → lead cerrado + closedAt + dealValue", async () => {
    const r = await request(app)
      .patch("/api/setters/calendar/cal_won")
      .set("Cookie", adminCookie)
      .send({ calendarioEstado: "ganada", valorProyecto: 1500 });
    expect(r.status).toBe(200);
    expect(r.body.entry.calendarioEstado).toBe("ganada");
    expect(r.body.entry.closedAt).toBeTruthy();
    expect(r.body.entry.valorProyecto).toBe(1500);
  });

  it("cold-call-metrics cuenta el deal + revenue del setter", async () => {
    const r = await request(app)
      .get("/api/setters/cold-call-metrics?period=all&setter=setter_fc")
      .set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.metrics.deals).toBe(1);
    expect(r.body.metrics.revenue).toBe(1500);
  });

  it("revertir el estado deshace el cierre (lead vuelve a agendado)", async () => {
    const r = await request(app)
      .patch("/api/setters/calendar/cal_won")
      .set("Cookie", adminCookie)
      .send({ calendarioEstado: "realizada" });
    expect(r.status).toBe(200);
    expect(r.body.entry.closedAt).toBe("");

    const m = await request(app)
      .get("/api/setters/cold-call-metrics?period=all&setter=setter_fc")
      .set("Cookie", adminCookie);
    expect(m.body.metrics.deals).toBe(0);
    expect(m.body.metrics.revenue).toBe(0);
  });

  it("rechaza calendarioEstado inválido", async () => {
    const r = await request(app)
      .patch("/api/setters/calendar/cal_won")
      .set("Cookie", adminCookie)
      .send({ calendarioEstado: "inventado" });
    expect(r.status).toBe(400);
  });
});
