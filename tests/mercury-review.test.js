// Tests del Panel de Revisión IA (Fase 4).
// approve, reject, rewrite, suggest-improvement + RBAC + promoción al banco.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `merc-review-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-mr@local.test";
process.env.ADMIN_PASSWORD = "mrpass1234";
process.env.ADMIN_NAME = "AdminMR";
process.env.JWT_SECRET = "test-secret-mr";
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
      { id: "user_admin_mr", email: "admin-mr@local.test", name: "AdminMR", role: "admin", status: "active", setterId: "", password: pwd("mrpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_mr", email: "setter-mr@local.test", name: "SetterMR", role: "setter", status: "active", setterId: "setter_mr", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "faqs.json"),
  JSON.stringify({
    entries: [
      {
        id: "faq_seed_precio",
        pregunta: "Cuanto cuesta",
        respuesta: "En la reu vemos los valores. Le parece manana?",
        categoria: "precio",
        tags: ["precio"], variantes: [], variantId: null,
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

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  const sess = cookies.find((c) => c.startsWith("gs_session=")) || "";
  return sess.split(";")[0];
}

async function newGen(cookie, message = "Cuanto cuesta esto?") {
  const r = await request(app).post("/api/mercury/generate").set("Cookie", cookie).send({ prospectMessage: message });
  expect(r.status).toBe(200);
  return r.body.id;
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-mr@local.test", "mrpass1234");
  setterCookie = await loginCookie("setter-mr@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("RBAC · setter no puede ejecutar acciones admin", () => {
  it("setter approve = 403", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/approve`).set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });
  it("setter reject = 403", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/reject`).set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });
  it("setter rewrite = 403", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/rewrite`).set("Cookie", setterCookie).send({ text: "x" });
    expect(r.status).toBe(403);
  });
  it("setter suggest-improvement = 403", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/suggest-improvement`).set("Cookie", setterCookie).send({ note: "x" });
    expect(r.status).toBe(403);
  });
});

describe("approve · promueve al banco como oro", () => {
  it("404 si no existe", async () => {
    const r = await request(app).post("/api/mercury/generations/mg_nope/approve").set("Cookie", adminCookie);
    expect(r.status).toBe(404);
  });

  it("approve crea FAQ con tag aprobado-admin y marca status=approved", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/approve`).set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.generation.status).toBe("approved");
    expect(r.body.generation.adminAction).toBe("approved");
    expect(r.body.generation.promotedToFaqId).toBeTruthy();
    expect(r.body.faq.tagsExtra).toContain("aprobado-admin");
    expect(r.body.faq.tagsExtra).toContain("mercury-promoted");
  });

  it("approve idempotente: misma pregunta no duplica FAQ", async () => {
    const id1 = await newGen(setterCookie, "Cuanto cuesta el sistema mensualmente");
    const id2 = await newGen(setterCookie, "Cuanto cuesta el sistema mensualmente");
    const r1 = await request(app).post(`/api/mercury/generations/${id1}/approve`).set("Cookie", adminCookie);
    const r2 = await request(app).post(`/api/mercury/generations/${id2}/approve`).set("Cookie", adminCookie);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.faq.id).toBe(r2.body.faq.id);
  });

  it("approve con text override usa el texto pasado", async () => {
    const id = await newGen(setterCookie, "Cuanto cuesta este servicio?");
    const r = await request(app).post(`/api/mercury/generations/${id}/approve`).set("Cookie", adminCookie).send({ text: "Texto override del admin." });
    expect(r.status).toBe(200);
    expect(r.body.faq.respuesta).toBe("Texto override del admin.");
  });
});

describe("reject · marca como rejected", () => {
  it("reject sin razón funciona", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/reject`).set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.generation.status).toBe("rejected");
    expect(r.body.generation.adminRejectReason).toBeNull();
  });

  it("reject con razón la guarda", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/reject`).set("Cookie", adminCookie).send({ reason: "Tono demasiado formal." });
    expect(r.status).toBe(200);
    expect(r.body.generation.adminRejectReason).toBe("Tono demasiado formal.");
  });
});

describe("rewrite · admin pega versión correcta y la promueve", () => {
  it("rewrite sin text = 400", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/rewrite`).set("Cookie", adminCookie).send({});
    expect(r.status).toBe(400);
  });

  it("rewrite con text crea FAQ reescrita-admin", async () => {
    const id = await newGen(setterCookie, "Cuanto cuesta el sistema reescritura?");
    const r = await request(app).post(`/api/mercury/generations/${id}/rewrite`).set("Cookie", adminCookie).send({ text: "Versión correcta admin." });
    expect(r.status).toBe(200);
    expect(r.body.generation.status).toBe("rewritten");
    expect(r.body.generation.adminRewrite).toBe("Versión correcta admin.");
    expect(r.body.faq.tagsExtra).toContain("reescrita-admin");
    expect(r.body.faq.respuesta).toBe("Versión correcta admin.");
  });
});

describe("suggest-improvement · agrega note a config", () => {
  it("sin note = 400", async () => {
    const id = await newGen(setterCookie);
    const r = await request(app).post(`/api/mercury/generations/${id}/suggest-improvement`).set("Cookie", adminCookie).send({});
    expect(r.status).toBe(400);
  });

  it("note se agrega a feedbackNotes y bumpea version", async () => {
    const id = await newGen(setterCookie);
    const cfgBefore = (await request(app).get("/api/mercury/config").set("Cookie", adminCookie)).body;
    const r = await request(app).post(`/api/mercury/generations/${id}/suggest-improvement`).set("Cookie", adminCookie).send({ note: "Profundizar antes de pitchear cuando preguntan por software." });
    expect(r.status).toBe(200);
    expect(r.body.note.text).toContain("Profundizar");
    expect(r.body.note.sourceGenerationId).toBe(id);
    expect(r.body.configVersion).toBe(cfgBefore.version + 1);
    expect(r.body.generation.status).toBe("reviewed");
    expect(r.body.generation.adminAction).toBe("suggested_improvement");

    const cfgAfter = (await request(app).get("/api/mercury/config").set("Cookie", adminCookie)).body;
    expect(cfgAfter.feedbackNotes.some((n) => n.text.includes("Profundizar"))).toBe(true);
  });
});

describe("Próximas generaciones reciben las notas de feedback", () => {
  it("una nueva generation tiene promptVersion bumpeado tras suggest-improvement", async () => {
    const r = await request(app).post("/api/mercury/generate").set("Cookie", setterCookie).send({ prospectMessage: "Cuanto cuesta el sistema otra vez" });
    expect(r.status).toBe(200);
    expect(r.body.promptVersion).toBeGreaterThan(1);
  });
});
