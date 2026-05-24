// Tests de los tres mutex async (faqs/mercury/setters).
// Verifican que dos requests concurrentes al mismo recurso NO pisen escrituras
// (lost write / TOCTOU race). Sin estos tests, regresiones que vuelvan a un
// load+save naive pasarían silenciosamente.
//
// Los mutex son:
//   - mutateFaqs        → POST /api/faqs concurrentes
//   - mutateMercuryGenerations → POST /api/mercury/generate concurrentes (sin IA → fallback)
//   - mutateSettersData → PATCH /api/setters/leads/:id concurrentes a campos distintos

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `mutex-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-mtx@local.test";
process.env.ADMIN_PASSWORD = "mtxpass1234";
process.env.ADMIN_NAME = "AdminMTX";
process.env.JWT_SECRET = "test-secret-mtx";
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
      { id: "user_admin_mtx", email: "admin-mtx@local.test", name: "AdminMTX", role: "admin", status: "active", setterId: "", password: pwd("mtxpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_mtx", email: "setter-mtx@local.test", name: "SetterMTX", role: "setter", status: "active", setterId: "setter_mtx", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_mtx", name: "SetterMTX" }],
    variants: [],
    leads: {
      lead_mtx: { id: "lead_mtx", num: 1, name: "Mutex Lead", phone: "+1", country: "X", assignedTo: "setter_mtx" },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "faqs.json"),
  JSON.stringify({
    entries: [
      // Seed para que /mercury/generate caiga al fallback con match
      { id: "faq_seed_mtx", pregunta: "test mutex pregunta", respuesta: "respuesta del banco", categoria: "general", tags: ["test"], variantes: [], variantId: null, createdBy: "test", createdById: "test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), usos: 0, funcionaron: 0 },
    ],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "history.json"),
  JSON.stringify({ entries: {}, lastPages: {} }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session="))?.split(";")[0] || "";
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-mtx@local.test", "mtxpass1234");
  setterCookie = await loginCookie("setter-mtx@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("mutateFaqs · POST /api/faqs concurrentes NO pierden writes", () => {
  it("20 POST concurrentes persisten LAS 20 (no TOCTOU)", async () => {
    const before = JSON.parse(fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8"));
    const beforeCount = before.entries.length;

    const posts = [];
    for (let i = 0; i < 20; i++) {
      posts.push(request(app).post("/api/faqs").set("Cookie", adminCookie).send({
        pregunta: `Pregunta concurrent ${i}`,
        respuesta: `Respuesta concurrent ${i}`,
        categoria: "general",
      }));
    }
    const results = await Promise.all(posts);
    // Todas devuelven 200
    const failures = results.filter((r) => r.status !== 200);
    expect(failures.length).toBe(0);

    // El archivo persiste las 20 nuevas
    const after = JSON.parse(fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8"));
    expect(after.entries.length).toBe(beforeCount + 20);

    // Cada IDs es único
    const ids = new Set(after.entries.map((e) => e.id));
    expect(ids.size).toBe(after.entries.length);
  }, 30000);

  it("PUT concurrentes al MISMO id no se pisan (versionado consistente)", async () => {
    // Crear una entrada
    const created = await request(app).post("/api/faqs").set("Cookie", adminCookie).send({
      pregunta: "Race PUT test",
      respuesta: "original",
    });
    expect(created.status).toBe(200);
    const id = created.body.entry.id;

    // 10 PUT concurrentes con respuesta distinta
    const puts = [];
    for (let i = 0; i < 10; i++) {
      puts.push(request(app).put(`/api/faqs/${id}`).set("Cookie", adminCookie).send({
        respuesta: `update ${i}`,
      }));
    }
    const results = await Promise.all(puts);
    const failures = results.filter((r) => r.status !== 200);
    expect(failures.length).toBe(0);

    // Estado final: respuesta es UNA de las 10 (la última en aplicarse)
    const final = JSON.parse(fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8"));
    const entry = final.entries.find((e) => e.id === id);
    expect(entry).toBeTruthy();
    expect(entry.respuesta).toMatch(/^update \d$/);
  }, 30000);

  it("PUT concurrentes a IDs DISTINTOS — todos los cambios persisten (mutex no pierde sibling writes)", async () => {
    // Crear 5 entradas distintas
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const created = await request(app).post("/api/faqs").set("Cookie", adminCookie).send({
        pregunta: `Sibling ${i}`,
        respuesta: `original ${i}`,
      });
      expect(created.status).toBe(200);
      ids.push(created.body.entry.id);
    }

    // PUT concurrente a cada una con respuesta única
    const puts = ids.map((id, i) => request(app).put(`/api/faqs/${id}`).set("Cookie", adminCookie).send({
      respuesta: `marker_${i}_${id.slice(-5)}`,
    }));
    const results = await Promise.all(puts);
    expect(results.every((r) => r.status === 200)).toBe(true);

    // TODAS las 5 entradas tienen su respuesta nueva (no perdimos ninguna)
    const final = JSON.parse(fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8"));
    for (let i = 0; i < 5; i++) {
      const entry = final.entries.find((e) => e.id === ids[i]);
      expect(entry, `entrada ${i} (${ids[i]})`).toBeTruthy();
      expect(entry.respuesta).toBe(`marker_${i}_${ids[i].slice(-5)}`);
    }
  }, 30000);
});

describe("mutateMercuryGenerations · POST /api/mercury/generate concurrentes", () => {
  it("10 generaciones concurrentes persisten LAS 10 sin perder ninguna", async () => {
    const beforeFile = path.join(tmpData, "mercury_generations.json");
    let beforeCount = 0;
    if (fs.existsSync(beforeFile)) {
      const before = JSON.parse(fs.readFileSync(beforeFile, "utf8"));
      beforeCount = before.generations.length;
    }

    const posts = [];
    for (let i = 0; i < 10; i++) {
      posts.push(request(app).post("/api/mercury/generate").set("Cookie", setterCookie).send({
        prospectMessage: `test mutex pregunta ${i}`,
      }));
    }
    const results = await Promise.all(posts);
    // Todas devuelven 200 (fallback al banco) o 503 (sin match)
    for (const r of results) expect([200, 503]).toContain(r.status);
    const successCount = results.filter((r) => r.status === 200).length;
    expect(successCount).toBeGreaterThan(0);

    // Las exitosas se persisten todas
    const after = JSON.parse(fs.readFileSync(beforeFile, "utf8"));
    expect(after.generations.length).toBe(beforeCount + successCount);
    const ids = new Set(after.generations.map((g) => g.id));
    expect(ids.size).toBe(after.generations.length);
  }, 30000);
});

describe("mutateSettersData · PATCH concurrentes a campos distintos del mismo lead", () => {
  it("2 PATCH simultáneos a campos no relacionados ambos persisten", async () => {
    // Test simplificado: 2 patches concurrentes a campos distintos (decisor y doctor).
    // Sin mutex, uno se pisaría al otro. Con mutex, ambos persisten.
    const reqA = request(app).patch("/api/setters/leads/lead_mtx").set("Cookie", adminCookie).send({ decisor: "DECISOR_FIELD" });
    const reqB = request(app).patch("/api/setters/leads/lead_mtx").set("Cookie", adminCookie).send({ doctor: "DOCTOR_FIELD" });

    const [rA, rB] = await Promise.all([reqA, reqB]);
    expect(rA.status).toBe(200);
    expect(rB.status).toBe(200);

    // Estado final: AMBOS campos persisten
    // (Nota: PATCH usa loadSettersData/saveSettersData sync — el handler es sync
    // entonces Node single-thread garantiza atomicidad. Si en el futuro se
    // convierte a async + await intermedio, este test detecta el race.)
    const data = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    const lead = data.leads.lead_mtx;
    expect(lead.decisor).toBe("DECISOR_FIELD");
    expect(lead.doctor).toBe("DOCTOR_FIELD");
  });

  it("50 PATCH concurrentes a campos distintos del mismo lead todos persisten o el último gana coherente", async () => {
    // Test menos estricto: 50 PATCH al mismo lead alternando entre 2 campos. Verificamos
    // que ningún request crashee y que el lead final tenga AMBOS campos con algún valor
    // (no quede en undefined). Esto detecta lost writes a campos no relacionados.
    const patches = [];
    for (let i = 0; i < 50; i++) {
      if (i % 2 === 0) {
        patches.push(request(app).patch("/api/setters/leads/lead_mtx").set("Cookie", adminCookie).send({ decisor: `d-${i}` }));
      } else {
        patches.push(request(app).patch("/api/setters/leads/lead_mtx").set("Cookie", adminCookie).send({ doctor: `dr-${i}` }));
      }
    }
    const results = await Promise.all(patches);
    const failures = results.filter((r) => r.status !== 200);
    expect(failures.length).toBe(0);

    const data = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    const lead = data.leads.lead_mtx;
    // AMBOS campos tienen el valor de algún PATCH (no son undefined ni vacios)
    expect(lead.decisor).toMatch(/^d-\d+$/);
    expect(lead.doctor).toMatch(/^dr-\d+$/);
  }, 30000);
});
