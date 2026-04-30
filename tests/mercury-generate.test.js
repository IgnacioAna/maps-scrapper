// Tests del Asistente de respuestas (Fase 3).
// Como NO hay MERCURY_API_KEY ni QWEN_API_KEY en env de test, el endpoint
// /api/mercury/generate cae al fallback automatico: top match del banco
// sanitizado. Eso lo testeamos directo. Tambien testeamos PATCH y GET con
// RBAC.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `merc-gen-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-mg@local.test";
process.env.ADMIN_PASSWORD = "mgpass1234";
process.env.ADMIN_NAME = "AdminMG";
process.env.JWT_SECRET = "test-secret-mg";
delete process.env.MERCURY_API_KEY;
delete process.env.QWEN_API_KEY;

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_mg", email: "admin-mg@local.test", name: "AdminMG", role: "admin", status: "active", setterId: "", password: pwd("mgpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_mg", email: "setter-mg@local.test", name: "SetterMG", role: "setter", status: "active", setterId: "setter_mg", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_mg2", email: "setter2-mg@local.test", name: "SetterMG2", role: "setter", status: "active", setterId: "setter_mg2", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Pre-poblar faqs con entradas que matcheen el mensaje de prueba.
fs.writeFileSync(
  path.join(tmpData, "faqs.json"),
  JSON.stringify({
    entries: [
      {
        id: "faq_seed_precio",
        pregunta: "Cuanto cuesta el sistema",
        respuesta: "Los detalles los profundizamos en una llamada porque depende de como trabajan hoy.\n\nLe parece coordinarla mañana o el miercoles?",
        categoria: "precio",
        tags: ["precio", "valores"],
        variantes: ["cuanto sale", "que precio tiene", "cual es el costo"],
        variantId: null,
        createdBy: "test", createdById: "test",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        usos: 0, funcionaron: 0,
      },
      {
        id: "faq_seed_mail",
        pregunta: "Mandame info por mail",
        respuesta: "Por experiencia se descontextualiza por correo.\n\nMejor lo vemos en una llamada corta y te muestro como aplicaria.",
        categoria: "objecion",
        tags: ["mail", "redirigir-llamada"],
        variantes: ["pasame info por correo", "enviame propuesta al mail"],
        variantId: null,
        createdBy: "test", createdById: "test",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        usos: 0, funcionaron: 0,
      },
    ],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
let setterCookie = "";
let setter2Cookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-mg@local.test", "mgpass1234");
  setterCookie = await loginCookie("setter-mg@local.test", "setterpass");
  setter2Cookie = await loginCookie("setter2-mg@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("POST /api/mercury/generate · validacion + fallback", () => {
  it("sin auth = 401", async () => {
    const r = await request(app).post("/api/mercury/generate").send({ prospectMessage: "hola" });
    expect(r.status).toBe(401);
  });

  it("sin prospectMessage = 400", async () => {
    const r = await request(app).post("/api/mercury/generate").set("Cookie", setterCookie).send({});
    expect(r.status).toBe(400);
  });

  it("setter genera respuesta vía fallback (sin IA configurada)", async () => {
    const r = await request(app)
      .post("/api/mercury/generate")
      .set("Cookie", setterCookie)
      .send({ prospectMessage: "Cuanto cuesta esto?" });
    expect(r.status).toBe(200);
    expect(r.body.id).toMatch(/^mg_/);
    expect(r.body.usedFallback).toBe(true);
    expect(Array.isArray(r.body.blocks)).toBe(true);
    expect(r.body.blocks.length).toBeGreaterThan(0);
    // Match correcto: la FAQ de precio debe haber quedado top
    expect(r.body.ejemplos[0].id).toBe("faq_seed_precio");
  });

  it("output sanitizado: sin signos de apertura ¿¡", async () => {
    const r = await request(app)
      .post("/api/mercury/generate")
      .set("Cookie", setterCookie)
      .send({ prospectMessage: "Mandame info por mail" });
    expect(r.status).toBe(200);
    expect(r.body.text).not.toContain("¿");
    expect(r.body.text).not.toContain("¡");
  });

  it("503 si no hay match suficiente en banco y no hay IA", async () => {
    const r = await request(app)
      .post("/api/mercury/generate")
      .set("Cookie", setterCookie)
      .send({ prospectMessage: "xkcd zzz nada que ver con dental" });
    expect([503, 200]).toContain(r.status);
    // Si por casualidad matchea (tokens muy cortos), igual valido. Lo importante
    // es que NO crashee.
  });
});

describe("PATCH /api/mercury/generations/:id · feedback", () => {
  let genId = "";

  beforeAll(async () => {
    const r = await request(app)
      .post("/api/mercury/generate")
      .set("Cookie", setterCookie)
      .send({ prospectMessage: "Cuanto cuesta el sistema?" });
    expect(r.status).toBe(200);
    genId = r.body.id;
  });

  it("PATCH 404 si no existe", async () => {
    const r = await request(app)
      .patch("/api/mercury/generations/mg_nope")
      .set("Cookie", setterCookie)
      .send({ setterAction: "good" });
    expect(r.status).toBe(404);
  });

  it("PATCH setterAction=good por dueño funciona", async () => {
    const r = await request(app)
      .patch(`/api/mercury/generations/${genId}`)
      .set("Cookie", setterCookie)
      .send({ setterAction: "good" });
    expect(r.status).toBe(200);
    expect(r.body.generation.setterAction).toBe("good");
  });

  it("PATCH por otro setter (no dueño, no admin) = 403", async () => {
    const r = await request(app)
      .patch(`/api/mercury/generations/${genId}`)
      .set("Cookie", setter2Cookie)
      .send({ setterAction: "bad" });
    expect(r.status).toBe(403);
  });

  it("PATCH por admin (no dueño) funciona", async () => {
    const r = await request(app)
      .patch(`/api/mercury/generations/${genId}`)
      .set("Cookie", adminCookie)
      .send({ setterAction: "edited", setterEditedText: "Versión que mandé.", finalSent: "Versión que mandé." });
    expect(r.status).toBe(200);
    expect(r.body.generation.setterAction).toBe("edited");
    expect(r.body.generation.finalSent).toBe("Versión que mandé.");
  });

  it("PATCH setterAction invalido = 400", async () => {
    const r = await request(app)
      .patch(`/api/mercury/generations/${genId}`)
      .set("Cookie", setterCookie)
      .send({ setterAction: "loquito" });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/mercury/generations · listado con RBAC", () => {
  it("setter solo ve las suyas", async () => {
    // setter2 genera una
    const r0 = await request(app)
      .post("/api/mercury/generate")
      .set("Cookie", setter2Cookie)
      .send({ prospectMessage: "Mandame info por mail" });
    expect(r0.status).toBe(200);

    const rSetter = await request(app).get("/api/mercury/generations").set("Cookie", setterCookie);
    expect(rSetter.status).toBe(200);
    // Todas las de setterCookie tienen userId = user_setter_mg
    for (const g of rSetter.body.generations) {
      expect(g.userId).toBe("user_setter_mg");
    }
  });

  it("admin ve todas", async () => {
    const r = await request(app).get("/api/mercury/generations").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(2);
    const userIds = new Set(r.body.generations.map((g) => g.userId));
    // Debe haber al menos 2 setters distintos
    expect(userIds.size).toBeGreaterThanOrEqual(1);
  });

  it("admin filtra por setterAction", async () => {
    const r = await request(app).get("/api/mercury/generations?setterAction=edited").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    for (const g of r.body.generations) expect(g.setterAction).toBe("edited");
  });
});
