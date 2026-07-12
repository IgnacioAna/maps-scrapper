// Auditoría scraper 2026-07-07:
// 1. Los campos SAFE-3 (placeId/coordinates/openingHours/businessStatus/category)
//    deben sobrevivir el import scrape→setters (antes _importLeadsCore los tiraba).
// 2. Dedup contra history con normalización (_buildHistoryDedupIndex/_isAlreadyScraped):
//    mismo negocio con dirección reformateada o mismo teléfono → alreadyScraped.
// 3. _runPool conserva orden y respeta la concurrencia.

import { describe, it, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `scrape-fields-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-sf@local.test";
process.env.ADMIN_PASSWORD = "sfpass123456";
process.env.JWT_SECRET = "test-secret-scrape-fields";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-sf@local.test", name: "A", role: "admin", status: "active", setterId: "", password: pwd("sfpass123456") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [{ id: "setter_test", name: "Test", active: true }], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

const { app } = await import("../index.js");
const { _buildHistoryDedupIndex, _isAlreadyScraped, _buildSettersDedupIndex, _isInSettersIndex, _runPool } = globalThis.__phase16;

async function login() {
  const res = await request(app).post("/api/auth/login").send({ email: "admin-sf@local.test", password: "sfpass123456" });
  const cookie = res.headers["set-cookie"]?.[0]?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie;
}

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("import scrape→setters conserva los campos SAFE-3", () => {
  it("placeId/coordinates/openingHours/businessStatus/category persisten en el lead", async () => {
    const cookie = await login();
    const lead = {
      name: "Clínica Dental Cerrada",
      phone: "+52 555 123 4567",
      address: "Av. Reforma 123, CDMX",
      country: "México",
      city: "Ciudad de México",
      rating: "4.5",
      reviews: 88,
      placeId: "ChIJtest123",
      coordinates: { lat: 19.43, lng: -99.13 },
      openingHours: { monday: "9AM-6PM" },
      businessStatus: "CLOSED_PERMANENTLY",
      category: "Dental clinic",
    };
    const res = await request(app)
      .post("/api/setters/import")
      .set("Cookie", cookie)
      .send({ leads: [lead], assignTo: "setter_test" });
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);

    const data = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    const saved = Object.values(data.leads).find((l) => l.name === "Clínica Dental Cerrada");
    expect(saved).toBeTruthy();
    expect(saved.placeId).toBe("ChIJtest123");
    expect(saved.coordinates).toEqual({ lat: 19.43, lng: -99.13 });
    expect(saved.openingHours).toEqual({ monday: "9AM-6PM" });
    expect(saved.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(saved.category).toBe("Dental clinic");
  });
});

describe("dedup contra history con normalización", () => {
  const history = {
    entries: {
      "clínica sonrisa_av. corrientes 1234": {
        name: "Clínica Sonrisa",
        address: "Av. Corrientes 1234",
        phone: "+54 11 4321 8765",
        scrapedAt: "2026-01-01T00:00:00Z",
      },
    },
  };
  const idx = _buildHistoryDedupIndex(history);

  it("match exacto por makeKey sigue funcionando", () => {
    expect(_isAlreadyScraped(history, idx, { name: "Clínica Sonrisa", address: "Av. Corrientes 1234" })).toBe(true);
  });
  it("dirección reformateada → igual detecta como ya scrapeado (antes: falso negativo)", () => {
    expect(_isAlreadyScraped(history, idx, { name: "Sonrisa - Clínica", address: "Av Corrientes 1234!" })).toBe(true);
  });
  it("mismo teléfono con otro nombre → ya scrapeado", () => {
    expect(_isAlreadyScraped(history, idx, { name: "Otro Nombre SRL", address: "Otra calle 99", phone: "011-4321-8765" })).toBe(true);
  });
  it("negocio realmente nuevo → no scrapeado", () => {
    expect(_isAlreadyScraped(history, idx, { name: "Dental Norte", address: "Calle Falsa 123", phone: "+54 11 9999 0000" })).toBe(false);
  });
});

// 2026-07-11: el scrape ahora también dedupea contra los leads YA ASIGNADOS a
// un SDR (setters.json), no solo el historial. Cierra el hueco de las entries
// viejas del historial sin teléfono → clínicas ya en el sistema aparecían
// "nuevas" y la dedup del envío las frenaba (cartel confuso de "duplicados").
describe("_buildSettersDedupIndex / _isInSettersIndex", () => {
  const settersData = {
    leads: {
      lead_1: { name: "Clínica Ya Asignada", address: "Gran Vía 100", phone: "+34 911 22 33 44" },
      lead_2: { name: "Odontología Centro", address: "Calle Sol 5", phone: "" },
    },
  };
  const sidx = _buildSettersDedupIndex(settersData);

  it("detecta un lead ya asignado por teléfono (últimos 8 dígitos, aunque el nombre varíe)", () => {
    expect(_isInSettersIndex(sidx, { name: "Clinica Ya Asignada - Dental", address: "Otra dir", phone: "911223344" })).toBe(true);
  });
  it("detecta por nombre+dirección normalizado cuando no hay teléfono", () => {
    expect(_isInSettersIndex(sidx, { name: "Odontología  Centro", address: "Calle Sol 5!", phone: "" })).toBe(true);
  });
  it("un lead genuinamente nuevo NO está en el índice de setters", () => {
    expect(_isInSettersIndex(sidx, { name: "Clínica Nueva", address: "Av Nueva 999", phone: "+34 600 00 00 00" })).toBe(false);
  });
  it("índice vacío / null no rompe", () => {
    expect(_isInSettersIndex(null, { name: "X", phone: "123" })).toBe(false);
    expect(_isInSettersIndex(_buildSettersDedupIndex({}), { name: "X", phone: "123" })).toBe(false);
  });
});

describe("_runPool", () => {
  it("conserva el orden de resultados y limita la concurrencia", async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = [50, 10, 30, 5, 20].map((ms, i) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
      return i;
    });
    const out = await _runPool(tasks, 3);
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
