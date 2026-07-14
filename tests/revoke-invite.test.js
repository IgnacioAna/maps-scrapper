// Tests de DELETE /api/auth/invites/:id — revocar una invitación pendiente.
// Bug 2026-07-13: no había forma de borrar un invite no aceptado. Bloqueaba el
// email (no se podía re-invitar con otro rol) y ni aparecía en el panel. Al invitar
// como SDR, ensureSetterProfile crea un setter huérfano que también hay que limpiar.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `revoke-inv-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-ri@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminRI";
process.env.JWT_SECRET = "test-secret-ri";
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
const now = new Date().toISOString();
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "user_admin_ri", email: "admin-ri@local.test", name: "AdminRI", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
    { id: "user_setter_ri", email: "setter-ri@local.test", name: "SetterRI", role: "setter", status: "active", setterId: "setter_ri", password: pwd("setterpass"), createdAt: now, updatedAt: now },
  ],
  invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [{ id: "setter_ri", name: "SetterRI" }], leads: {}, variants: [], calendar: [], sessions: [] }, null, 2));

const { app } = await import("../index.js");

let adminCookie = "", setterCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-ri@local.test", password: "adminpass1" });
  adminCookie = a.headers["set-cookie"][0].split(";")[0];
  const s = await request(app).post("/api/auth/login").send({ email: "setter-ri@local.test", password: "setterpass" });
  setterCookie = s.headers["set-cookie"][0].split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("DELETE /api/auth/invites/:id", () => {
  it("revoca un invite de SDR, limpia el setter huérfano y libera el email", async () => {
    // Crear invite SDR (crea setter huérfano vía ensureSetterProfile)
    const inv = await request(app).post("/api/auth/invites").set("Cookie", adminCookie)
      .send({ name: "Fulano Test", email: "fulano@x.com", role: "setter", sendEmail: false });
    expect(inv.status).toBe(200);
    const inviteId = inv.body.invite.id;
    const orphanSetterId = inv.body.invite.setterId;
    expect(orphanSetterId).toBeTruthy();

    // El email queda bloqueado para re-invitar
    const dup = await request(app).post("/api/auth/invites").set("Cookie", adminCookie)
      .send({ name: "Fulano Test", email: "fulano@x.com", role: "supervisor", sendEmail: false });
    expect(dup.status).toBe(400);

    // Revocar
    const del = await request(app).delete(`/api/auth/invites/${inviteId}`).set("Cookie", adminCookie);
    expect(del.status).toBe(200);
    expect(del.body.orphanSetterRemoved).toBe(orphanSetterId);

    // El setter huérfano ya no existe
    const setters = await request(app).get("/api/setters").set("Cookie", adminCookie);
    expect((setters.body.setters || []).some((s) => s.id === orphanSetterId)).toBe(false);

    // Ahora SÍ se puede invitar el email como supervisor
    const sup = await request(app).post("/api/auth/invites").set("Cookie", adminCookie)
      .send({ name: "Fulano Test", email: "fulano@x.com", role: "supervisor", sendEmail: false });
    expect(sup.status).toBe(200);
    expect(sup.body.invite.role).toBe("supervisor");
  });

  it("NO borra el setter si tiene un user vinculado (invite de un SDR real)", async () => {
    // Invite ya-aceptado no se puede revocar; simulamos un invite pendiente cuyo
    // setterId coincide con un setter que TIENE user vinculado (setter_ri).
    const auth = JSON.parse(fs.readFileSync(path.join(tmpData, "auth.json"), "utf8"));
    auth.invites.push({ id: "inv_manual_ri", token: "tok_ri", name: "SetterRI", email: "otro-ri@x.com", role: "setter", setterId: "setter_ri", status: "pending", createdAt: now });
    fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify(auth, null, 2));

    const del = await request(app).delete("/api/auth/invites/inv_manual_ri").set("Cookie", adminCookie);
    expect(del.status).toBe(200);
    expect(del.body.orphanSetterRemoved).toBeNull(); // NO se tocó (hay user vinculado)
    const setters = await request(app).get("/api/setters").set("Cookie", adminCookie);
    expect((setters.body.setters || []).some((s) => s.id === "setter_ri")).toBe(true);
  });

  it("404 si el invite no existe", async () => {
    const del = await request(app).delete("/api/auth/invites/inv_inexistente").set("Cookie", adminCookie);
    expect(del.status).toBe(404);
  });

  it("RBAC: un setter no puede revocar invites", async () => {
    const inv = await request(app).post("/api/auth/invites").set("Cookie", adminCookie)
      .send({ name: "Otro", email: "otro2@x.com", role: "supervisor", sendEmail: false });
    const del = await request(app).delete(`/api/auth/invites/${inv.body.invite.id}`).set("Cookie", setterCookie);
    expect(del.status).toBe(403);
  });
});
