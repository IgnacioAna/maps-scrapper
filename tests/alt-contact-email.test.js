// 2026-07-23 — el modal "Contacto secundario" también carga el email del lead.
// PUT /api/setters/leads/:id/alt-contact acepta {email}: se guarda en lead.email,
// omitido = no tocar, inválido = 400. RBAC: setter solo en sus leads.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `altcontact-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-alt@local.test";
process.env.ADMIN_PASSWORD = "altpass1234";
process.env.JWT_SECRET = "test-secret-alt";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-alt@local.test", name: "Admin", role: "admin", status: "active", setterId: "", password: pwd("altpass1234") },
    { id: "u_a", email: "a@local.test", name: "A", role: "setter", status: "active", setterId: "s_a", password: pwd("setterpass1") },
  ], invites: [], sessions: [],
}, null, 2));

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
  variants: [],
  leads: {
    l_mine: { num: 1, name: "Mío", phone: "+5215550000001", assignedTo: "s_a", conexion: "sin_wsp", estado: "sin_contactar", email: "viejo@x.com" },
    l_ajeno: { num: 2, name: "Ajeno", phone: "+5215550000002", assignedTo: "s_b", conexion: "sin_wsp", estado: "sin_contactar" },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
}
let aCookie = "";
beforeAll(async () => { aCookie = await login("a@local.test", "setterpass1"); });
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("alt-contact con email", () => {
  it("guarda teléfono + email juntos", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", label: "Encargada", email: "encargada@clinica.com" });
    expect(r.status).toBe(200);
    expect(r.body.altPhone).toBe("+5491133334444");
    expect(r.body.email).toBe("encargada@clinica.com");
  });
  it("email omitido en el body NO pisa el existente", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", label: "Encargada" });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("encargada@clinica.com");
  });
  it("email vacío explícito lo borra", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", label: "Encargada", email: "" });
    expect(r.status).toBe(200);
    expect(r.body.email).toBe("");
  });
  it("email inválido → 400 y no persiste", async () => {
    const r = await request(app).put("/api/setters/leads/l_mine/alt-contact").set("Cookie", aCookie)
      .send({ phone: "+5491133334444", email: "no-es-un-email" });
    expect(r.status).toBe(400);
    const saved = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(saved.leads.l_mine.email || "").toBe("");
  });
  it("setter NO puede tocar un lead ajeno (403)", async () => {
    const r = await request(app).put("/api/setters/leads/l_ajeno/alt-contact").set("Cookie", aCookie)
      .send({ email: "x@y.com" });
    expect(r.status).toBe(403);
  });
});
