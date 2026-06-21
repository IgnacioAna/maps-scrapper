// Matriz RBAC + tests defensivos de seguridad para evitar regresiones.
//
// Cubre:
//  - Endpoints admin-only que NO acepten cookie de setter/supervisor (403)
//  - Endpoints admin-or-supervisor que NO acepten cookie de setter (403)
//  - PATCH /api/setters/leads/:id con lead de OTRO setter → 403 (no silencioso)
//  - /api/admin/import-data con shape inválido (cubierto en hardening, pero
//    duplicamos un caso defensivo aquí — no toca archivos)
//  - JWT malformado / expirado en WA → 401 (no 500)
//  - Cookie de sesión vencida → 401
//  - Sin auth → 401 en todas las rutas /api/*

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

const tmpData = path.join(os.tmpdir(), `sec-rbac-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-sec@local.test";
process.env.ADMIN_PASSWORD = "secpass1234";
process.env.ADMIN_NAME = "AdminSec";
process.env.JWT_SECRET = "test-secret-sec";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_sec", email: "admin-sec@local.test", name: "AdminSec", role: "admin", status: "active", setterId: "", password: pwd("secpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_sec", email: "super-sec@local.test", name: "SuperSec", role: "supervisor", status: "active", setterId: "", password: pwd("superpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setterA_sec", email: "setterA-sec@local.test", name: "SetterASec", role: "setter", status: "active", setterId: "setter_a_sec", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setterB_sec", email: "setterB-sec@local.test", name: "SetterBSec", role: "setter", status: "active", setterId: "setter_b_sec", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_a_sec", name: "SetterASec" },
      { id: "setter_b_sec", name: "SetterBSec" },
    ],
    variants: [],
    leads: {
      lead_belongs_to_a: { id: "lead_belongs_to_a", num: 1, name: "OwnedByA", phone: "+1", country: "X", assignedTo: "setter_a_sec", estado: "sin_contactar" },
      lead_belongs_to_b: { id: "lead_belongs_to_b", num: 2, name: "OwnedByB", phone: "+2", country: "X", assignedTo: "setter_b_sec", estado: "sin_contactar" },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "history.json"),
  JSON.stringify({ entries: {}, lastPages: {} }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
let superCookie = "";
let setterACookie = "";
let setterBCookie = "";
let setterAToken = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session="))?.split(";")[0] || "";
}

async function loginToken(email, password) {
  const r = await request(app).post("/api/auth/desktop-login").send({ email, password });
  expect(r.status).toBe(200);
  return r.body.token;
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-sec@local.test", "secpass1234");
  superCookie = await loginCookie("super-sec@local.test", "superpass");
  setterACookie = await loginCookie("setterA-sec@local.test", "setterpass");
  setterBCookie = await loginCookie("setterB-sec@local.test", "setterpass");
  setterAToken = await loginToken("setterA-sec@local.test", "setterpass");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

// ────────────────────────────────────────────────────────────────────────
// MATRIZ RBAC ADMIN-ONLY: setter Y supervisor deben recibir 403
// ────────────────────────────────────────────────────────────────────────
describe("RBAC admin-only · 403 para setter y supervisor", () => {
  const ADMIN_ONLY = [
    { method: "post", url: "/api/auth/invites", body: { name: "x", email: "x@x.com", role: "setter" } },
    { method: "post", url: "/api/admin/import-data", body: {} },
    { method: "get", url: "/api/admin/export-data" },
    { method: "get", url: "/api/admin/health" },
    { method: "get", url: "/api/admin/backups" },
    { method: "get", url: "/api/admin/scrape-batches" },
    { method: "delete", url: "/api/admin/scrape-batches/batch_xxx" },
    { method: "post", url: "/api/admin/backups/now", body: {} },
    { method: "post", url: "/api/admin/regen-openings", body: {} },
    { method: "put", url: "/api/mercury/config", body: { systemPrompt: "x" } },
    { method: "post", url: "/api/mercury/config/reset-prompt", body: {} },
    { method: "post", url: "/api/setters/asistencia/backfill" },
    { method: "post", url: "/api/scrape", body: { query: "x", location: "y" } },
    // Audit 2026-06-20: enrich-* / telnyx CRUD / recycle / backfills — admin-only.
    { method: "post", url: "/api/admin/enrich-leads", body: { dryRun: true } },
    { method: "post", url: "/api/admin/enrich-brief", body: { dryRun: true } },
    { method: "post", url: "/api/admin/validate-numbers", body: { dryRun: true } },
    { method: "post", url: "/api/admin/recycle-pool", body: { dryRun: true } },
    { method: "post", url: "/api/admin/backfill-country", body: { dryRun: true } },
    { method: "post", url: "/api/admin/backfill-signals", body: { dryRun: true } },
    { method: "post", url: "/api/admin/backfill-websites", body: { dryRun: true } },
    { method: "put", url: "/api/telnyx/config", body: { countryRouting: {} } },
    { method: "post", url: "/api/telnyx/scripts", body: { label: "x", trigger: "opener", text: "y" } },
    { method: "post", url: "/api/telnyx/scripts/reset-to-seed", body: {} },
  ];

  for (const route of ADMIN_ONLY) {
    it(`${route.method.toUpperCase()} ${route.url} — setter 403`, async () => {
      const r = request(app)[route.method](route.url).set("Cookie", setterACookie);
      if (route.body) r.send(route.body);
      const res = await r;
      expect(res.status).toBe(403);
    });

    it(`${route.method.toUpperCase()} ${route.url} — supervisor 403`, async () => {
      const r = request(app)[route.method](route.url).set("Cookie", superCookie);
      if (route.body) r.send(route.body);
      const res = await r;
      expect(res.status).toBe(403);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// ADMIN+SUPERVISOR: setter 403, supervisor 200/otro
// ────────────────────────────────────────────────────────────────────────
describe("RBAC admin+supervisor · setter 403, supervisor OK", () => {
  const ADMIN_OR_SUPER = [
    { method: "get", url: "/api/auth/users" },
    { method: "get", url: "/api/auth/online" },
    { method: "get", url: "/api/setters/command" },
    { method: "get", url: "/api/setters/team-performance" },
    { method: "get", url: "/api/setters/alert-config" },
  ];

  for (const route of ADMIN_OR_SUPER) {
    it(`${route.url} — setter 403`, async () => {
      const r = await request(app)[route.method](route.url).set("Cookie", setterACookie);
      expect(r.status).toBe(403);
    });
    it(`${route.url} — supervisor OK`, async () => {
      const r = await request(app)[route.method](route.url).set("Cookie", superCookie);
      expect([200, 304]).toContain(r.status);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// enrich-* / telnyx · funcional SIN RED (audit 2026-06-20). No setea API_KEY
// ni keys de IA/telnyx → los paths externos cortan en 503; dryRun no llama afuera.
// ────────────────────────────────────────────────────────────────────────
describe("enrich-* / telnyx · funcional (admin, sin red)", () => {
  it("enrich-leads dryRun (admin) → 200 sin llamar afuera", async () => {
    const r = await request(app).post("/api/admin/enrich-leads").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
  });

  // dryRun (recon) NO llama afuera. Con API_KEY/keys en .env (dev) → 200; sin ellas
  // (CI) → 503. Lo importante: pasa RBAC y no tira 500. Ambos estados son válidos.
  it("enrich-brief dryRun (admin) → 200|503, nunca 500", async () => {
    const r = await request(app).post("/api/admin/enrich-brief").set("Cookie", adminCookie).send({ dryRun: true });
    expect([200, 503]).toContain(r.status);
  });

  it("validate-numbers dryRun (admin) → 200|503, nunca 500", async () => {
    const r = await request(app).post("/api/admin/validate-numbers").set("Cookie", adminCookie).send({ dryRun: true });
    expect([200, 503]).toContain(r.status);
  });

  it("serpapi-account: setter 403 (RBAC; no probamos admin para no pegarle a la red)", async () => {
    const rs = await request(app).get("/api/admin/serpapi-account").set("Cookie", setterACookie);
    expect(rs.status).toBe(403);
  });

  it("GET /api/telnyx/config: sin auth 401, setter 200 (config acotada)", async () => {
    const r401 = await request(app).get("/api/telnyx/config");
    expect(r401.status).toBe(401);
    const rs = await request(app).get("/api/telnyx/config").set("Cookie", setterACookie);
    expect(rs.status).toBe(200);
  });

  it("GET /api/telnyx/scripts: setter 200 (auth, todos los roles)", async () => {
    const r = await request(app).get("/api/telnyx/scripts").set("Cookie", setterACookie);
    expect(r.status).toBe(200);
  });

  it("GET /api/telnyx/metrics: setter 403 (admin+supervisor)", async () => {
    const r = await request(app).get("/api/telnyx/metrics").set("Cookie", setterACookie);
    expect(r.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// PATCH lead de otro setter: setter A NO puede tocar lead de setter B
// ────────────────────────────────────────────────────────────────────────
describe("Cross-setter access · setter A no puede tocar lead de setter B", () => {
  it("PATCH /api/setters/leads/lead_belongs_to_b con cookie setter A → 403", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_belongs_to_b").set("Cookie", setterACookie).send({ decisor: "intentodecambio" });
    expect(r.status).toBe(403);
  });

  it("PATCH lead propio con cookie setter A → 200", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_belongs_to_a").set("Cookie", setterACookie).send({ decisor: "lo_puedo" });
    expect(r.status).toBe(200);
    expect(r.body.lead.decisor).toBe("lo_puedo");
  });

  it("POST /api/setters/leads/:id/interaction con lead de OTRO setter → 403", async () => {
    const r = await request(app).post("/api/setters/leads/lead_belongs_to_b/interaction").set("Cookie", setterACookie).send({ stage: "open", action: "open" });
    expect(r.status).toBe(403);
  });

  it("admin SÍ puede tocar lead de cualquier setter", async () => {
    const r = await request(app).patch("/api/setters/leads/lead_belongs_to_b").set("Cookie", adminCookie).send({ decisor: "admin_puede" });
    expect(r.status).toBe(200);
    expect(r.body.lead.decisor).toBe("admin_puede");
  });
});

// ────────────────────────────────────────────────────────────────────────
// WA module: JWT validation
// ────────────────────────────────────────────────────────────────────────
describe("WA module · JWT auth defensivo", () => {
  it("sin Authorization header → 401", async () => {
    const r = await request(app).get("/api/wa/accounts");
    expect(r.status).toBe(401);
  });

  it("Bearer token malformado → 401 (no 500)", async () => {
    const r = await request(app).get("/api/wa/accounts").set("Authorization", "Bearer not.a.real.jwt");
    expect(r.status).toBe(401);
  });

  it("Bearer token con secret incorrecto → 401", async () => {
    const fake = jwt.sign({ sub: "user_setterA_sec", role: "setter" }, "OTRO_SECRET_DISTINTO", { expiresIn: "1h" });
    const r = await request(app).get("/api/wa/accounts").set("Authorization", `Bearer ${fake}`);
    expect(r.status).toBe(401);
  });

  it("Bearer token expirado → 401", async () => {
    const expired = jwt.sign(
      { sub: "user_setterA_sec", role: "setter" },
      process.env.JWT_SECRET,
      { expiresIn: "-1h" } // ya expirado
    );
    const r = await request(app).get("/api/wa/accounts").set("Authorization", `Bearer ${expired}`);
    expect(r.status).toBe(401);
  });

  it("Bearer token válido → 200", async () => {
    const r = await request(app).get("/api/wa/accounts").set("Authorization", `Bearer ${setterAToken}`);
    expect(r.status).toBe(200);
  });

  // Desde 217372f (2026-06-03) un setter puede crear su PROPIA cuenta vía Bearer
  // (queda auto-asignada a su setterId — no puede asignarla a otro). El test viejo
  // asertaba 403 (conducta anterior) y quedó obsoleto.
  it("Bearer token con setter crea SU propia cuenta → 200 auto-asignada", async () => {
    const r = await request(app).post("/api/wa/accounts").set("Authorization", `Bearer ${setterAToken}`).send({ label: "x" });
    expect(r.status).toBe(200);
    expect(r.body.assignment?.kind).toBe("setter");
  });
});

// ────────────────────────────────────────────────────────────────────────
// Import-data defensivo: shape inválido NO toca archivos
// ────────────────────────────────────────────────────────────────────────
describe("/api/admin/import-data defensivo · shape inválido no toca archivos", () => {
  it("shape inválido devuelve 400 y NO mutó setters.json", async () => {
    const before = fs.readFileSync(path.join(tmpData, "setters.json"), "utf8");
    const r = await request(app).post("/api/admin/import-data").set("Cookie", adminCookie).send({
      setters: { setters: "not_an_array", leads: {} },
    });
    expect(r.status).toBe(400);
    const after = fs.readFileSync(path.join(tmpData, "setters.json"), "utf8");
    expect(after).toBe(before);
  });

  it("shape inválido en faqs NO mutó faqs.json", async () => {
    // Crear faqs.json para tener baseline
    fs.writeFileSync(path.join(tmpData, "faqs.json"), JSON.stringify({ entries: [] }, null, 2));
    const before = fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8");
    const r = await request(app).post("/api/admin/import-data").set("Cookie", adminCookie).send({
      faqs: { entries: { bad: "object_not_array" } },
    });
    expect(r.status).toBe(400);
    const after = fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8");
    expect(after).toBe(before);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Auth básico: sin cookie/token → 401 en endpoints protegidos
// ────────────────────────────────────────────────────────────────────────
describe("Auth · sin credenciales → 401", () => {
  const PROTECTED = [
    "/api/setters/leads",
    "/api/setters/variants",
    "/api/setters/command",
    "/api/setters/performance",
    "/api/faqs",
    "/api/mercury/config",
    "/api/mercury/generations",
    "/api/admin/health",
    "/api/admin/backups",
  ];

  for (const url of PROTECTED) {
    it(`GET ${url} sin auth → 401`, async () => {
      const r = await request(app).get(url);
      expect(r.status).toBe(401);
    });
  }
});
