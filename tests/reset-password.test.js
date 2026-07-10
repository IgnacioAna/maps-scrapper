// Tests del reset de contraseña por admin: POST /api/auth/users/:id/reset-password
// - Admin puede resetear la clave de un miembro del equipo.
// - Valida length (min 6, max 200) + tipo.
// - Revoca las sesiones activas del usuario y la clave nueva sirve para loguear.
// - RBAC: un setter NO puede resetear contraseñas.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `reset-pwd-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rp@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminRP";
process.env.JWT_SECRET = "test-secret-rp";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();
fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_rp", email: "admin-rp@local.test", name: "AdminRP", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_paula", email: "paula@local.test", name: "Paula", role: "setter", status: "active", setterId: "setter_paula", password: pwd("claveVieja1"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({ setters: [], leads: {}, variants: [], calendar: [], sessions: [] }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-rp@local.test", password: "adminpass1" });
  expect(r.status).toBe(200);
  adminCookie = r.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("POST /api/auth/users/:id/reset-password", () => {
  it("admin resetea la clave y la nueva sirve para loguear; la vieja ya no", async () => {
    const r = await request(app)
      .post("/api/auth/users/user_paula/reset-password")
      .set("Cookie", adminCookie)
      .send({ password: "claveNueva9" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.email).toBe("paula@local.test");

    const nuevoLogin = await request(app).post("/api/auth/login").send({ email: "paula@local.test", password: "claveNueva9" });
    expect(nuevoLogin.status).toBe(200);

    const viejoLogin = await request(app).post("/api/auth/login").send({ email: "paula@local.test", password: "claveVieja1" });
    expect(viejoLogin.status).toBe(401);
  });

  it("revoca las sesiones activas del usuario", async () => {
    // Paula abre sesión, luego el admin le resetea la clave → la sesión debe morir.
    const login = await request(app).post("/api/auth/login").send({ email: "paula@local.test", password: "claveNueva9" });
    expect(login.status).toBe(200);
    const paulaCookie = login.headers["set-cookie"][0].split(";")[0];

    const antes = await request(app).get("/api/auth/me").set("Cookie", paulaCookie);
    expect(antes.body.authenticated).toBe(true);

    const reset = await request(app)
      .post("/api/auth/users/user_paula/reset-password")
      .set("Cookie", adminCookie)
      .send({ password: "otraClave7" });
    expect(reset.status).toBe(200);
    expect(reset.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

    const despues = await request(app).get("/api/auth/me").set("Cookie", paulaCookie);
    expect(despues.body.authenticated).toBe(false);
  });

  it("rechaza contraseña de menos de 6 caracteres", async () => {
    const r = await request(app)
      .post("/api/auth/users/user_paula/reset-password")
      .set("Cookie", adminCookie)
      .send({ password: "12345" });
    expect(r.status).toBe(400);
  });

  it("404 si el usuario no existe", async () => {
    const r = await request(app)
      .post("/api/auth/users/user_inexistente/reset-password")
      .set("Cookie", adminCookie)
      .send({ password: "claveValida1" });
    expect(r.status).toBe(404);
  });

  it("RBAC: un setter no puede resetear contraseñas", async () => {
    const login = await request(app).post("/api/auth/login").send({ email: "paula@local.test", password: "otraClave7" });
    expect(login.status).toBe(200);
    const paulaCookie = login.headers["set-cookie"][0].split(";")[0];

    const r = await request(app)
      .post("/api/auth/users/user_admin_rp/reset-password")
      .set("Cookie", paulaCookie)
      .send({ password: "hackeado123" });
    expect(r.status).toBe(403);
  });
});
