// Auditoría enrichment 2026-07-07:
// 1. enrich-leads: skip 24h por FUENTE (antes correr NPI bloqueaba el enrich web
//    24h vía enrichedAt global) + force:true bypassa los markers *CheckedAt.
// 2. validate-numbers: lookups fallidos marcan lookupAt+lookupError → no se
//    re-seleccionan (ni re-cobran) en la próxima tanda.

import { describe, it, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `enrich-audit-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-ea@local.test";
process.env.ADMIN_PASSWORD = "eapass123456";
process.env.JWT_SECRET = "test-secret-enrich-audit";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
const now = new Date().toISOString();
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-ea@local.test", name: "A", role: "admin", status: "active", setterId: "", password: pwd("eapass123456") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "setter_test", name: "Test", active: true }],
  variants: [],
  leads: {
    // Enriquecido por NPI hace un rato (enrichedAt reciente) pero SIN chequeos web:
    // con el skip 24h global viejo NO era candidato web; ahora sí.
    lead_npi_then_web: { id: "lead_npi_then_web", name: "Smile Dental", phone: "+13055550001", website: "https://smiledental-test.com", country: "Estados Unidos", npiCheckedAt: now, enrichedAt: now, assignedTo: "setter_test", estado: "sin_contactar" },
    // Todos los markers web seteados → solo elegible con force:true.
    lead_fully_checked: { id: "lead_fully_checked", name: "Clinica Lista", phone: "+5215512340002", website: "https://clinicalista-test.com", country: "México", adsCheckedAt: now, ageCheckedAt: now, metaAdsCheckedAt: now, ownerAiCheckedAt: now, domainCheckedAt: now, enrichedAt: now, assignedTo: "setter_test", estado: "sin_contactar" },
    // Para validate-numbers: teléfono válido, sin lookup previo.
    lead_phone_fail: { id: "lead_phone_fail", name: "Tel Fail", phone: "+5215512340003", assignedTo: "setter_test", estado: "sin_contactar" },
  },
  calendar: [],
  sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "telnyx_config.json"), JSON.stringify({ apiKey: "TEST_TELNYX_KEY", sipUsername: "", sipPassword: "", sipConnectionId: "", signaturePublicKey: "", numbers: [], countryRouting: {} }, null, 2));

const { app } = await import("../index.js");

async function login() {
  const res = await request(app).post("/api/auth/login").send({ email: "admin-ea@local.test", password: "eapass123456" });
  const cookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie;
}
const cookie = await login();

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("enrich-leads: skip por fuente + force", () => {
  it("lead con NPI reciente pero sin chequeos web SÍ es candidato web (antes: bloqueado 24h)", async () => {
    const res = await request(app).post("/api/admin/enrich-leads").set("Cookie", cookie).send({ dryRun: true, source: "website", limit: 50 });
    expect(res.status).toBe(200);
    const ids = res.body.sample.map((s) => s.id);
    expect(ids).toContain("lead_npi_then_web");
  });
  it("lead con todos los markers web NO es candidato sin force", async () => {
    const res = await request(app).post("/api/admin/enrich-leads").set("Cookie", cookie).send({ dryRun: true, source: "website", limit: 50 });
    const ids = res.body.sample.map((s) => s.id);
    expect(ids).not.toContain("lead_fully_checked");
  });
  it("force:true bypassa los markers (antes force no podía re-chequear nada)", async () => {
    const res = await request(app).post("/api/admin/enrich-leads").set("Cookie", cookie).send({ dryRun: true, source: "website", limit: 50, force: true });
    const ids = res.body.sample.map((s) => s.id);
    expect(ids).toContain("lead_fully_checked");
  });
});

describe("validate-numbers: fallo marca lookupAt para no re-cobrar", () => {
  it("lookup fallido persiste lookupAt + lookupError y sale de la cola", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => "telnyx down", json: async () => ({}) });
    try {
      const before = await request(app).post("/api/admin/validate-numbers").set("Cookie", cookie).send({ dryRun: true });
      expect(before.status).toBe(200);
      expect(before.body.pending).toBeGreaterThan(0);

      const run = await request(app).post("/api/admin/validate-numbers").set("Cookie", cookie).send({ limit: 10 });
      expect(run.status).toBe(200);
      expect(run.body.looked).toBe(0); // todos fallaron

      const data = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
      const lead = data.leads.lead_phone_fail;
      expect(lead.lookupAt).toBeTruthy();
      expect(lead.lookupError).toBeTruthy();
      expect(lead.phoneType || "").toBe(""); // el fallo no inventa phoneType

      const after = await request(app).post("/api/admin/validate-numbers").set("Cookie", cookie).send({ dryRun: true });
      expect(after.body.pending).toBe(0); // ya no se re-seleccionan (ni re-cobran)
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
