// Phase 17 Ola 2 — shared vs private callback.
// Un callback compartido vencido aparece en la cola de CUALQUIER setter y puede
// ser tomado (se reasigna). Uno privado solo lo ve/toma su dueño.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `sharedcb-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-scb@local.test";
process.env.ADMIN_PASSWORD = "scbpass1234";
process.env.JWT_SECRET = "test-secret-scb";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
const mkUser = (id, email, setterId) => ({ id, email, name: id, role: "setter", status: "active", setterId, password: pwd("setterpass1") });
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-scb@local.test", name: "Admin", role: "admin", status: "active", setterId: "", password: pwd("scbpass1234") },
    mkUser("u_a", "a@local.test", "s_a"),
    mkUser("u_b", "b@local.test", "s_b"),
  ], invites: [], sessions: [],
}, null, 2));

const past = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // vencido hace 1h
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
  variants: [],
  leads: {
    l_shared: { num: 1, name: "Shared", phone: "+5215550000001", assignedTo: "s_a", conexion: "sin_wsp", estado: "sin_contactar", callbackAt: past, callbackShared: true },
    l_private: { num: 2, name: "Private", phone: "+5215550000002", assignedTo: "s_a", conexion: "sin_wsp", estado: "sin_contactar", callbackAt: past, callbackShared: false },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
async function login(email) {
  const r = await request(app).post("/api/auth/login").send({ email, password: "setterpass1" });
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
}
let bCookie = "";
beforeAll(async () => { bCookie = await login("b@local.test"); });
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("shared callback", () => {
  it("setter B ve el callback COMPARTIDO vencido (no suyo) pero NO el privado", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", bCookie);
    const ids = (r.body.leads || []).map((l) => l.id);
    expect(ids).toContain("l_shared");
    expect(ids).not.toContain("l_private");
  });
  it("setter B puede TOMAR el compartido (se reasigna + deja de ser compartido)", async () => {
    const r = await request(app).post("/api/setters/leads/l_shared/call-disposition").set("Cookie", bCookie).send({ outcome: "answered_interested" });
    expect(r.status).toBe(200);
    expect(r.body.lead.assignedTo).toBe("s_b");
    expect(r.body.lead.callbackShared).toBe(false);
  });
  it("setter B NO puede tocar un lead privado ajeno (403)", async () => {
    const r = await request(app).post("/api/setters/leads/l_private/call-disposition").set("Cookie", bCookie).send({ outcome: "no_answer" });
    expect(r.status).toBe(403);
  });
});
