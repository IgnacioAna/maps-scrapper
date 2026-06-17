// Test de pool-distribute (Phase 14): reparte en orden de prioridad
// (interesado→sin_contactar→medio→no_interesado) y resetea el lead al moverlo.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `pool-tier-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-pt@local.test";
process.env.ADMIN_PASSWORD = "ptpass1234";
process.env.ADMIN_NAME = "AdminPT";
process.env.JWT_SECRET = "test-secret-pt";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [{ id: "u_pt", email: "admin-pt@local.test", name: "AdminPT", role: "admin", status: "active", setterId: "", password: pwd("ptpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "dest", name: "Destino" }],
    variants: [],
    leads: {
      // todos sin asignar, distintos tiers
      l_nointeres: { num: 1, name: "NoInteres", phone: "+521", assignedTo: "", estado: "descartado", interes: "no", callLog: [{ ts: new Date().toISOString(), outcome: "answered_not_interested" }] },
      l_medio: { num: 2, name: "Medio", phone: "+522", assignedTo: "", estado: "respondio", respondio: true, conexion: "enviada" },
      l_sincontactar: { num: 3, name: "SinContactar", phone: "+523", assignedTo: "", estado: "sin_contactar", conexion: "" },
      l_interesado: { num: 4, name: "Interesado", phone: "+524", assignedTo: "", estado: "interesado", interes: "si", conexion: "enviada", respondio: true, calificado: true, followUps: { '24hs': true } },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-pt@local.test", password: "ptpass1234" });
  expect(r.status).toBe(200);
  adminCookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("pool-distribute · prioridad + reseteo", () => {
  it("pool-summary clasifica los tiers", async () => {
    const r = await request(app).get("/api/setters/pool-summary").set("Cookie", adminCookie);
    expect(r.body.byTier).toEqual({ interesado: 1, sin_contactar: 1, medio: 1, no_interesado: 1 });
  });

  it("con count=2 mueve los 2 de MAYOR prioridad (interesado + sin_contactar)", async () => {
    const r = await request(app).post("/api/setters/pool-distribute").set("Cookie", adminCookie)
      .send({ fromSetterId: "__all__", toSetterId: "dest", count: 2 });
    expect(r.status).toBe(200);
    expect(r.body.moved).toBe(2);
    expect(r.body.byTierMoved).toEqual({ interesado: 1, sin_contactar: 1, medio: 0, no_interesado: 0 });
  });

  it("el lead interesado quedó RESETEADO (limpio) pero conserva callLog", async () => {
    const leads = await request(app).get("/api/setters/leads?setter=dest").set("Cookie", adminCookie);
    const inter = (leads.body.leads || []).find((l) => l.id === "l_interesado");
    expect(inter).toBeTruthy();
    expect(inter.estado).toBe("sin_contactar");
    expect(inter.interes).toBe(null);
    expect(inter.conexion).toBe("");
    expect(inter.respondio).toBe(false);
    expect(inter.followUps["24hs"]).toBe(false);
  });

  it("filtro por tier solo mueve ese tier", async () => {
    const r = await request(app).post("/api/setters/pool-distribute").set("Cookie", adminCookie)
      .send({ fromSetterId: "__all__", toSetterId: "dest", tier: "no_interesado" });
    expect(r.body.byTierMoved.no_interesado).toBe(1);
    expect(r.body.byTierMoved.medio).toBe(0);
  });
});
