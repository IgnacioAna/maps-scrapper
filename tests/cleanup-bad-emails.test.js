// 2026-07-07 — Limpieza de emails basura + variantes del ángulo sugerido.
// El scraper legacy guardaba el PRIMER email del HTML (tracking sentry/wixpress
// incluido). POST /api/admin/cleanup-bad-emails borra los que hoy no pasan el
// filtro de enrichment. Además: _openingAngleFor ahora tiene variantes por señal
// elegidas de forma determinística por lead.id.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `cleanmail-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cm@local.test";
process.env.ADMIN_PASSWORD = "cmpass1234";
process.env.ADMIN_NAME = "AdminCm";
process.env.JWT_SECRET = "test-secret-cm";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [{ id: "u_cm", email: "admin-cm@local.test", name: "AdminCm", role: "admin", status: "active", setterId: "", password: pwd("cmpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "s_cm", name: "CM" }],
    variants: [],
    leads: {
      // Tracking de Wix/Sentry — el caso real que motivó la limpieza
      l_sentry: { num: 1, name: "Sentry", phone: "+5215550000001", assignedTo: "s_cm", conexion: "sin_wsp", email: "605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com" },
      // "Email" que en realidad es un asset (extensión de archivo)
      l_asset: { num: 2, name: "Asset", phone: "+5215550000002", assignedTo: "s_cm", conexion: "sin_wsp", email: "img@2x.png" },
      // Email legítimo — NO se toca
      l_ok: { num: 3, name: "Ok", phone: "+5215550000003", assignedTo: "s_cm", conexion: "sin_wsp", email: "dra.perez@clinicaperez.mx" },
      // Sin email — no cuenta como scanned
      l_empty: { num: 4, name: "Empty", phone: "+5215550000004", assignedTo: "s_cm", conexion: "sin_wsp", email: "" },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-cm@local.test", password: "cmpass1234" });
  expect(r.status).toBe(200);
  adminCookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

function readLeads() {
  return JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8")).leads;
}

describe("cleanup-bad-emails", () => {
  it("requiere auth admin", async () => {
    const r = await request(app).post("/api/admin/cleanup-bad-emails").send({});
    expect([401, 403]).toContain(r.status);
  });

  it("dryRun reporta sin persistir", async () => {
    const r = await request(app).post("/api/admin/cleanup-bad-emails").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.scanned).toBe(3); // solo leads CON email
    expect(r.body.cleaned).toBe(2); // sentry + asset
    expect(r.body.sample.map((s) => s.email)).toContain("605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com");
    // No persistió: el email basura sigue en disco
    expect(readLeads().l_sentry.email).toContain("sentry-next");
  });

  it("run real borra los basura y conserva el legítimo", async () => {
    const r = await request(app).post("/api/admin/cleanup-bad-emails").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.cleaned).toBe(2);
    const leads = readLeads();
    expect(leads.l_sentry.email).toBe("");
    expect(leads.l_asset.email).toBe("");
    expect(leads.l_ok.email).toBe("dra.perez@clinicaperez.mx");
  });

  it("es idempotente (segunda corrida no encuentra nada)", async () => {
    const r = await request(app).post("/api/admin/cleanup-bad-emails").set("Cookie", adminCookie).send({});
    expect(r.status).toBe(200);
    expect(r.body.cleaned).toBe(0);
  });
});

describe("openingAngle · variantes determinísticas por lead", () => {
  const compute = globalThis.__phase16.computeLeadSignals;
  // Misma señal (sin_web: sin website + 50 reseñas), ids distintos
  const mkLead = (id) => ({ id, name: "L" + id, rating: "4.9", reviews: 50, website: "", instagram: "@x" });

  it("el mismo lead siempre da la misma frase", () => {
    const a = compute(mkLead("lead_estable_123"));
    const b = compute(mkLead("lead_estable_123"));
    expect(a.openingAngle).toBe(b.openingAngle);
    expect(a.openingAngle.length).toBeGreaterThan(0);
  });

  it("leads distintos con la misma señal varían la redacción", () => {
    const angles = new Set();
    for (let i = 0; i < 12; i++) angles.add(compute(mkLead("lead_var_" + i)).openingAngle);
    // Con 3 variantes y 12 ids, esperar al menos 2 redacciones distintas
    expect(angles.size).toBeGreaterThanOrEqual(2);
  });
});
