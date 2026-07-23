// Auditoría de tarifas 2026-07-23: destinos que Telnyx cobra caro con caller ID
// de EE.UU. (surcharged origination) quedan fuera de circulación:
// - _expensiveTariffLabel clasifica por prefijo (ES fijo, UY, EC, BO, PE fijo)
// - GET /api/setters/leads/sin-wsp los excluye de la cola (y ?expensive=1 los lista)
// - POST /api/scrape bloquea UY/EC/BO por ubicación (todo el país es tarifa roja)

import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `tariff-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tf@local.test";
process.env.ADMIN_PASSWORD = "tfpass1234";
process.env.ADMIN_NAME = "AdminTF";
process.env.JWT_SECRET = "test-secret-tf";
process.env.API_KEY = ""; // sin SerpAPI: el test de scrape solo valida el guard (400 antes del fetch)

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_tf", email: "admin-tf@local.test", name: "AdminTF", role: "admin", status: "active", setterId: "", password: pwd("tfpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_tf", name: "SetterTF" }],
    variants: [],
    leads: {
      // ES fijo (+349) → tarifa roja, fuera de la cola
      lead_es_fijo: { num: 1, name: "ES fijo", phone: "+34910858263", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      // ES móvil (+346) → barato, sigue en la cola
      lead_es_movil: { num: 2, name: "ES movil", phone: "+34628365285", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      // UY → tarifa roja
      lead_uy: { num: 3, name: "UY", phone: "+59899123456", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      // EC → tarifa roja
      lead_ec: { num: 4, name: "EC", phone: "+593991234567", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      // PE fijo (+511) → tarifa roja / PE móvil (+519) → barato
      lead_pe_fijo: { num: 5, name: "PE fijo", phone: "+5114567890", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      lead_pe_movil: { num: 6, name: "PE movil", phone: "+51987654321", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      // CO / MX → verdes, siguen
      lead_co: { num: 7, name: "CO", phone: "+573001234567", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      lead_mx: { num: 8, name: "MX", phone: "+5215512345678", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp" },
      // ES fijo pero YA TRABAJADO con interés → exento del filtro (2026-07-23)
      lead_es_fijo_interesado: { num: 9, name: "ES fijo interesado", phone: "+34913565584", assignedTo: "setter_tf", estado: "interesado", conexion: "sin_wsp", callLog: [{ ts: new Date().toISOString(), outcome: "answered_interested", by: "user_admin_tf" }] },
      lead_es_fijo_callback: { num: 10, name: "ES fijo callback", phone: "+34914567630", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp", callbackAt: new Date(Date.now() - 3600e3).toISOString(), callLog: [{ ts: new Date().toISOString(), outcome: "callback_later", by: "user_admin_tf" }] },
      // ES fijo con cadencia automática (no_answer) → NO exento, se filtra igual
      lead_es_fijo_cadencia: { num: 11, name: "ES fijo cadencia", phone: "+34954647171", assignedTo: "setter_tf", estado: "sin_wsp", conexion: "sin_wsp", callbackAt: new Date(Date.now() - 3600e3).toISOString(), callLog: [{ ts: new Date().toISOString(), outcome: "no_answer", by: "user_admin_tf" }] },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

let app;
let cookie;

beforeAll(async () => {
  const mod = await import("../index.js");
  app = mod.default || mod.app || globalThis.__app;
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin-tf@local.test", password: "tfpass1234" });
  cookie = login.headers["set-cookie"];
});

describe("_expensiveTariffLabel (clasificador por prefijo)", () => {
  it("clasifica rojos y verdes según la rate sheet real", () => {
    const f = globalThis.__phase16._expensiveTariffLabel;
    // rojos
    expect(f("+34910858263")).toMatch(/ES fijo/);   // Madrid fijo
    expect(f("+34952215747")).toMatch(/ES fijo/);   // Málaga fijo
    expect(f("+59899123456")).toMatch(/UY/);
    expect(f("+593991234567")).toMatch(/EC/);
    expect(f("+59171234567")).toMatch(/BO/);
    expect(f("+5114567890")).toMatch(/PE fijo/);
    // verdes
    expect(f("+34628365285")).toBeNull();  // ES móvil 6
    expect(f("+34751234567")).toBeNull();  // ES móvil 7
    expect(f("+51987654321")).toBeNull();  // PE móvil (519)
    expect(f("+573001234567")).toBeNull(); // CO
    expect(f("+5215512345678")).toBeNull(); // MX
    expect(f("+56912345678")).toBeNull();  // CL
    expect(f("+17864350620")).toBeNull();  // US
    expect(f("+5491122334455")).toBeNull(); // AR móvil: fuera del filtro a propósito
    expect(f("")).toBeNull();
    expect(f(null)).toBeNull();
  });
});

describe("GET /api/setters/leads/sin-wsp — filtro de tarifa roja", () => {
  it("excluye ES fijo / UY / EC / PE fijo y conserva los verdes", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", cookie);
    expect(r.status).toBe(200);
    const ids = r.body.leads.map(l => l.id);
    expect(ids).toContain("lead_es_movil");
    expect(ids).toContain("lead_pe_movil");
    expect(ids).toContain("lead_co");
    expect(ids).toContain("lead_mx");
    expect(ids).not.toContain("lead_es_fijo");
    expect(ids).not.toContain("lead_uy");
    expect(ids).not.toContain("lead_ec");
    expect(ids).not.toContain("lead_pe_fijo");
  });

  it("exime a los rojos YA trabajados con interés (interesado / callback manual), no a la cadencia automática", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", cookie);
    const ids = r.body.leads.map(l => l.id);
    expect(ids).toContain("lead_es_fijo_interesado"); // interesado → sigue llamable
    expect(ids).toContain("lead_es_fijo_callback");   // "vuelvo a llamar" manual → sigue
    expect(ids).not.toContain("lead_es_fijo_cadencia"); // reintento automático → filtrado
  });

  it("?expensive=1 lista SOLO los de tarifa roja bloqueados (sin los exentos)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp?expensive=1").set("Cookie", cookie);
    expect(r.status).toBe(200);
    const ids = r.body.leads.map(l => l.id).sort();
    expect(ids).toEqual(["lead_ec", "lead_es_fijo", "lead_es_fijo_cadencia", "lead_pe_fijo", "lead_uy"]);
  });
});

describe("POST /api/scrape — guard de países incobrables", () => {
  it("bloquea Uruguay/Ecuador/Bolivia por ubicación con mensaje claro", async () => {
    for (const loc of ["Montevideo, Uruguay", "Quito, Ecuador", "La Paz, Bolivia"]) {
      const r = await request(app)
        .post("/api/scrape")
        .set("Cookie", cookie)
        .send({ query: "clinica dental", location: loc, maxPages: 1 });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/tarifa roja/i);
    }
  });

  it("España NO se bloquea a nivel país (los fijos se filtran por resultado)", async () => {
    const r = await request(app)
      .post("/api/scrape")
      .set("Cookie", cookie)
      .send({ query: "clinica dental", location: "Madrid, España", maxPages: 1 });
    // Sin API_KEY el scrape sigue de largo y falla después del guard — lo que
    // importa es que NO es el 400 del bloqueo por país.
    expect(r.body.error || "").not.toMatch(/tarifa roja/i);
  });
});
