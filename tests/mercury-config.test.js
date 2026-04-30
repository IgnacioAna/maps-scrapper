// Tests de /api/mercury/config (GET/PUT/DELETE/reset).
// RBAC: admin lee + edita; setter solo lee metadata; sin auth = 401.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `merc-cfg-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-mc@local.test";
process.env.ADMIN_PASSWORD = "mcpass1234";
process.env.ADMIN_NAME = "AdminMC";
process.env.JWT_SECRET = "test-secret-mc";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_mc", email: "admin-mc@local.test", name: "AdminMC", role: "admin", status: "active", setterId: "", password: pwd("mcpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_mc", email: "setter-mc@local.test", name: "SetterMC", role: "setter", status: "active", setterId: "setter_mc", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-mc@local.test", "mcpass1234");
  setterCookie = await loginCookie("setter-mc@local.test", "setterpass");
  expect(adminCookie).toBeTruthy();
  expect(setterCookie).toBeTruthy();
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("Mercury config · RBAC y lectura", () => {
  it("GET sin auth devuelve 401", async () => {
    const r = await request(app).get("/api/mercury/config");
    expect(r.status).toBe(401);
  });

  it("admin lee config completa con systemPrompt + feedbackNotes + version", async () => {
    const r = await request(app).get("/api/mercury/config").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(typeof r.body.systemPrompt).toBe("string");
    expect(r.body.systemPrompt.length).toBeGreaterThan(50);
    expect(Array.isArray(r.body.feedbackNotes)).toBe(true);
    expect(typeof r.body.version).toBe("number");
  });

  it("setter solo recibe metadata (sin systemPrompt)", async () => {
    const r = await request(app).get("/api/mercury/config").set("Cookie", setterCookie);
    expect(r.status).toBe(200);
    expect(r.body.systemPrompt).toBeUndefined();
    expect(typeof r.body.systemPromptLength).toBe("number");
    expect(typeof r.body.version).toBe("number");
    expect(typeof r.body.feedbackNotesCount).toBe("number");
  });

  it("setter no puede PUT", async () => {
    const r = await request(app).put("/api/mercury/config").set("Cookie", setterCookie).send({ systemPrompt: "hack" });
    expect(r.status).toBe(403);
  });
});

describe("Mercury config · admin edita", () => {
  it("PUT con systemPrompt vacio = 400", async () => {
    const r = await request(app).put("/api/mercury/config").set("Cookie", adminCookie).send({ systemPrompt: "   " });
    expect(r.status).toBe(400);
  });

  it("PUT con systemPrompt > 20k chars = 400", async () => {
    const big = "x".repeat(20001);
    const r = await request(app).put("/api/mercury/config").set("Cookie", adminCookie).send({ systemPrompt: big });
    expect(r.status).toBe(400);
  });

  it("PUT systemPrompt valido bumpea version y guarda updatedBy", async () => {
    const before = (await request(app).get("/api/mercury/config").set("Cookie", adminCookie)).body;
    const r = await request(app).put("/api/mercury/config").set("Cookie", adminCookie).send({ systemPrompt: "Nuevo prompt de prueba para Mercury." });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(before.version + 1);
    expect(r.body.systemPrompt).toBe("Nuevo prompt de prueba para Mercury.");
    expect(r.body.updatedBy).toBe("AdminMC");
  });

  it("PUT addNote agrega una nota a feedbackNotes", async () => {
    const r = await request(app).put("/api/mercury/config").set("Cookie", adminCookie).send({ addNote: "Cuando preguntan por software ya existente, profundizar antes de pitchear." });
    expect(r.status).toBe(200);
    expect(r.body.feedbackNotes.length).toBeGreaterThan(0);
    const last = r.body.feedbackNotes[r.body.feedbackNotes.length - 1];
    expect(last.text).toContain("profundizar");
    expect(last.id).toBeTruthy();
    expect(last.addedBy).toBe("AdminMC");
  });

  it("DELETE de nota inexistente = 404", async () => {
    const r = await request(app).delete("/api/mercury/config/notes/nope").set("Cookie", adminCookie);
    expect(r.status).toBe(404);
  });

  it("DELETE de nota existente la quita", async () => {
    const cfg = (await request(app).get("/api/mercury/config").set("Cookie", adminCookie)).body;
    const id = cfg.feedbackNotes[0]?.id;
    expect(id).toBeTruthy();
    const r = await request(app).delete(`/api/mercury/config/notes/${id}`).set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.feedbackNotes.find((n) => n.id === id)).toBeUndefined();
  });

  it("POST reset-prompt restaura el seed", async () => {
    const r = await request(app).post("/api/mercury/config/reset-prompt").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.systemPrompt).toContain("Mercury");
    // El seed contiene "MERCURY" del .md o el fallback del code
    expect(r.body.systemPrompt.length).toBeGreaterThan(50);
  });

  it("setter no puede borrar notas ni resetear", async () => {
    const r1 = await request(app).delete("/api/mercury/config/notes/whatever").set("Cookie", setterCookie);
    expect(r1.status).toBe(403);
    const r2 = await request(app).post("/api/mercury/config/reset-prompt").set("Cookie", setterCookie);
    expect(r2.status).toBe(403);
  });

  it("PUT sin cambios = 400", async () => {
    const r = await request(app).put("/api/mercury/config").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(400);
  });
});
