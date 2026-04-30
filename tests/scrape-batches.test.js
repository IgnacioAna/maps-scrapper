// Tests del Historial de scrapes (Fase 10).
// Persistencia del batch, RBAC, send-to-setter, dedup, delete.
// NO hace scrape real (necesitaria SerpAPI key) — testea los CRUD endpoints
// asumiendo que ya hay batches pre-poblados en disco.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `scrape-batches-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-sb@local.test";
process.env.ADMIN_PASSWORD = "sbpass1234";
process.env.ADMIN_NAME = "AdminSB";
process.env.JWT_SECRET = "test-secret-sb";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_sb", email: "admin-sb@local.test", name: "AdminSB", role: "admin", status: "active", setterId: "", password: pwd("sbpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_sb", email: "setter-sb@local.test", name: "SetterSB", role: "setter", status: "active", setterId: "setter_sb", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Setters base + un batch ya guardado para testear send-to-setter.
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_sb", name: "SetterSB" }],
    variants: [],
    leads: {},
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "scrape_batches.json"),
  JSON.stringify({
    batches: [
      {
        id: "batch_sample_1",
        createdAt: new Date().toISOString(),
        createdBy: "AdminSB",
        createdById: "user_admin_sb",
        params: { query: "clinica dental", location: "Quito, Ecuador" },
        queries: ["clinica dental"],
        locations: ["Quito, Ecuador"],
        stats: { newCount: 3, alreadyScrapedCount: 1, totalBeforeFilter: 4, dedupRemoved: 0, removedNoContact: 0, locationsSearched: 1 },
        results: [
          { name: "Clínica A", phone: "+59311111", website: "https://a.com", address: "Quito 1", city: "Quito", country: "Ecuador", alreadyScraped: false },
          { name: "Clínica B", phone: "+59322222", website: "https://b.com", address: "Quito 2", city: "Quito", country: "Ecuador", alreadyScraped: false },
          { name: "Clínica C", phone: "+59333333", website: "https://c.com", address: "Quito 3", city: "Quito", country: "Ecuador", alreadyScraped: false },
          { name: "Clínica D vieja", phone: "+59344444", website: "https://d.com", address: "Quito 4", city: "Quito", country: "Ecuador", alreadyScraped: true },
        ],
        sentToSetter: null,
        enrichmentStatus: "none",
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

beforeAll(async () => {
  adminCookie = await loginCookie("admin-sb@local.test", "sbpass1234");
  setterCookie = await loginCookie("setter-sb@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("RBAC", () => {
  it("setter no accede al historial (403)", async () => {
    const r = await request(app).get("/api/admin/scrape-batches").set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });
  it("admin lista batches", async () => {
    const r = await request(app).get("/api/admin/scrape-batches").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.batches[0].id).toBe("batch_sample_1");
    expect(r.body.batches[0].resultsCount).toBe(4);
    // No expone results en la lista (solo metadata)
    expect(r.body.batches[0].results).toBeUndefined();
  });
});

describe("GET batch by id", () => {
  it("404 si no existe", async () => {
    const r = await request(app).get("/api/admin/scrape-batches/batch_nope").set("Cookie", adminCookie);
    expect(r.status).toBe(404);
  });
  it("admin recibe batch completo con results", async () => {
    const r = await request(app).get("/api/admin/scrape-batches/batch_sample_1").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.batch.id).toBe("batch_sample_1");
    expect(Array.isArray(r.body.batch.results)).toBe(true);
    expect(r.body.batch.results.length).toBe(4);
    expect(r.body.batch.results[0].phone).toBe("+59311111");
  });
});

describe("send-to-setter", () => {
  it("400 sin setterId", async () => {
    const r = await request(app)
      .post("/api/admin/scrape-batches/batch_sample_1/send-to-setter")
      .set("Cookie", adminCookie)
      .send({});
    expect(r.status).toBe(400);
  });

  it("envia con onlyNew=true → solo los 3 nuevos, marca sentToSetter", async () => {
    const r = await request(app)
      .post("/api/admin/scrape-batches/batch_sample_1/send-to-setter")
      .set("Cookie", adminCookie)
      .send({ setterId: "setter_sb", onlyNew: true });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(3); // las 3 con alreadyScraped=false
    expect(r.body.skipped).toBe(0);
    expect(r.body.batch.sentToSetter.setterId).toBe("setter_sb");
    expect(r.body.batch.sentToSetter.imported).toBe(3);
    expect(r.body.batch.sentToSetter.onlyNew).toBe(true);
  });

  it("re-enviar con onlyNew=false → las 3 ya estan dedup, +1 nueva (D vieja)", async () => {
    const r = await request(app)
      .post("/api/admin/scrape-batches/batch_sample_1/send-to-setter")
      .set("Cookie", adminCookie)
      .send({ setterId: "setter_sb", onlyNew: false });
    expect(r.status).toBe(200);
    expect(r.body.imported).toBe(1); // solo Clínica D (que tenía alreadyScraped=true en el scrape original pero NO está en setters todavía)
    expect(r.body.skipped).toBe(3);
  });

  it("setter no puede enviar (403)", async () => {
    const r = await request(app)
      .post("/api/admin/scrape-batches/batch_sample_1/send-to-setter")
      .set("Cookie", setterCookie)
      .send({ setterId: "setter_sb" });
    expect(r.status).toBe(403);
  });
});

describe("DELETE batch", () => {
  it("setter no puede borrar (403)", async () => {
    const r = await request(app).delete("/api/admin/scrape-batches/batch_sample_1").set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });
  it("admin borra batch", async () => {
    const r = await request(app).delete("/api/admin/scrape-batches/batch_sample_1").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.remaining).toBe(0);
  });
  it("404 si ya no existe", async () => {
    const r = await request(app).delete("/api/admin/scrape-batches/batch_sample_1").set("Cookie", adminCookie);
    expect(r.status).toBe(404);
  });
});
