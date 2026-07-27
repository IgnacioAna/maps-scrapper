// Test del reciclaje del pool (Phase 14): desasigna todo, resetea, estampa la
// prioridad (sobrevive al reset), conserva callLog siempre y notas solo de interesados.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `recycle-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rc@local.test";
process.env.ADMIN_PASSWORD = "rcpass1234";
process.env.ADMIN_NAME = "AdminRC";
process.env.JWT_SECRET = "test-secret-rc";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [{ id: "u_rc", email: "admin-rc@local.test", name: "AdminRC", role: "admin", status: "active", setterId: "", password: pwd("rcpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "s_x", name: "X" }],
    variants: [],
    leads: {
      l_int: { num: 1, name: "Int", phone: "+5215550000001", assignedTo: "s_x", estado: "interesado", interes: "si", conexion: "enviada", respondio: true, calificado: true, followUps: { '24hs': true }, notes: [{ text: "habló re piola", by: "X", date: new Date().toISOString() }], interactions: [{ action: "open" }], callLog: [{ ts: new Date().toISOString(), outcome: "answered_interested" }] },
      l_no: { num: 2, name: "No", phone: "+5215550000002", assignedTo: "s_x", estado: "descartado", interes: "no", notes: [{ text: "no le interesa", by: "X" }] },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-rc@local.test", password: "rcpass1234" });
  expect(r.status).toBe(200);
  adminCookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("recycle-pool", () => {
  it("dryRun reporta tiers sin mutar", async () => {
    const r = await request(app).post("/api/admin/recycle-pool").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.byTier.interesado).toBe(1);
    expect(r.body.byTier.no_interesado).toBe(1);
    // no mutó: el interesado sigue asignado
    const pool = await request(app).get("/api/setters/pool-summary").set("Cookie", adminCookie);
    expect(pool.body.unassigned.total).toBe(0);
  });

  it("sin confirm token rechaza (operación destructiva, audit 2026-06-20)", async () => {
    const r = await request(app).post("/api/admin/recycle-pool").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(400);
    // no mutó: el interesado sigue asignado
    const pool = await request(app).get("/api/setters/pool-summary").set("Cookie", adminCookie);
    expect(pool.body.unassigned.total).toBe(0);
  });

  it("recicla: desasigna todo, resetea, estampa prioridad", async () => {
    const r = await request(app).post("/api/admin/recycle-pool").set("Cookie", adminCookie).send({ confirm: "RECICLAR_TODO" });
    expect(r.body.total).toBe(2);
    expect(r.body.notesKept).toBe(1); // solo el interesado
    const pool = await request(app).get("/api/setters/pool-summary").set("Cookie", adminCookie);
    expect(pool.body.unassigned.total).toBe(2); // todos al pool
    // la prioridad estampada sobrevive: el byTier sigue mostrando 1 interesado + 1 no-interesado
    expect(pool.body.byTier.interesado).toBe(1);
    expect(pool.body.byTier.no_interesado).toBe(1);
  });

  it("el interesado quedó reseteado pero conserva notas + callLog; el no-interesado sin notas", async () => {
    // sin-wsp con include=callable trae todo (ya están en conexion sin_wsp)
    const leads = await (await request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", adminCookie)).body.leads;
    const intLead = leads.find(l => l.id === "l_int");
    const noLead = leads.find(l => l.id === "l_no");
    expect(intLead.estado).toBe("sin_contactar");
    expect(intLead.interes).toBe(null);
    expect(intLead.assignedTo).toBe("");
    expect(intLead.recontactPriority).toBe(1);
    expect(intLead.notes.length).toBe(1);   // conservadas (interesado)
    expect(intLead.callLog.length).toBe(1); // historial conservado
    expect(noLead.notes.length).toBe(0);    // borradas (no interesado)
    expect(noLead.recontactPriority).toBe(4);
  });
});
