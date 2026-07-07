// Enrichment 2026-07-07 — brief desde web (sin SerpApi) + antigüedad de dominio (RDAP)
// + re-framing del prompt del brief a reactivación/retención sin nombrar la marca.

import { describe, it, expect } from "vitest";
import { registrableDomain, parseRdapRegistration, enrichDomainAge } from "../src/enrichment.js";

describe("registrableDomain (PURA)", () => {
  it("dominio simple", () => {
    expect(registrableDomain("https://www.clinicasonrisa.com/contacto")).toBe("clinicasonrisa.com");
  });
  it("TLD de 2 niveles (com.mx / com.ar / co.uk)", () => {
    expect(registrableDomain("http://dental.com.mx")).toBe("dental.com.mx");
    expect(registrableDomain("https://www.clinica.com.ar/x")).toBe("clinica.com.ar");
    expect(registrableDomain("https://foo.bar.co.uk")).toBe("bar.co.uk");
  });
  it("basura → ''", () => {
    expect(registrableDomain("")).toBe("");
    expect(registrableDomain("localhost")).toBe("");
  });
});

describe("parseRdapRegistration (PURA)", () => {
  it("extrae la fecha de registro y calcula años", () => {
    const r = parseRdapRegistration({ events: [{ eventAction: "last changed", eventDate: "2023-01-01T00:00:00Z" }, { eventAction: "registration", eventDate: "2010-06-15T00:00:00Z" }] });
    expect(r.registeredAt).toContain("2010-06-15");
    expect(r.years).toBeGreaterThanOrEqual(15);
  });
  it("sin evento de registro → null", () => {
    expect(parseRdapRegistration({ events: [{ eventAction: "expiration", eventDate: "2030-01-01" }] })).toBe(null);
    expect(parseRdapRegistration({})).toBe(null);
  });
});

describe("enrichDomainAge (fetch mockeado)", () => {
  const mkResp = (json) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(json) });
  it("ok → registeredAt + years", async () => {
    const fetchImpl = async () => mkResp({ events: [{ eventAction: "registration", eventDate: "2015-03-01T00:00:00Z" }] });
    const r = await enrichDomainAge("https://clinica.com", { fetchImpl });
    expect(r.registeredAt).toContain("2015-03-01");
    expect(r.years).toBeGreaterThanOrEqual(10);
  });
  it("dominio inválido → error sin tirar", async () => {
    const r = await enrichDomainAge("", { fetchImpl: async () => mkResp({}) });
    expect(r.error).toBe("bad_domain");
  });
});

// El prompt vive en index.js (globalThis.__phase16). Setup mínimo para importarlo.
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
const tmpData = path.join(os.tmpdir(), `webbrief-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-wb@local.test";
process.env.ADMIN_PASSWORD = "wbpass123456";
process.env.JWT_SECRET = "test-secret-webbrief";
function pwd(plain) { const salt = crypto.randomBytes(16).toString("hex"); return { salt, hash: crypto.scryptSync(plain, salt, 64).toString("hex") }; }
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-wb@local.test", name: "A", role: "admin", status: "active", setterId: "", password: pwd("wbpass123456") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));
await import("../index.js");
const { _briefSystemPrompt, _buildWebsiteBriefMessages, _buildBriefMessages } = globalThis.__phase16;

describe("prompt del brief re-frameado a reactivación (sin marca)", () => {
  it("el system prompt habla de reactivación/retención y NO de 'sistema de reservas' ni marca", () => {
    const p = _briefSystemPrompt().toLowerCase();
    expect(p).toContain("reactiva");
    expect(p).toMatch(/retenci[oó]n|fideliza/);
    expect(p).not.toContain("sistema de reservas");
    expect(p).not.toContain("scm");
    // Instrucción explícita de no nombrar empresa/marca.
    expect(p).toMatch(/nunca nombres/);
  });
  it("_buildWebsiteBriefMessages arma un solo mensaje user con el texto del sitio", () => {
    const msgs = _buildWebsiteBriefMessages({ name: "Clínica X", reviews: 3, website: "https://x.com" }, "Ofrecemos ortodoncia e implantes. Agendá tu cita.", "");
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("ortodoncia");
    expect(msgs[0].content).toContain("SITIO WEB");
  });
  it("_buildBriefMessages (reseñas) usa el mismo system re-frameado", () => {
    const msgs = _buildBriefMessages({ name: "Y", reviews: 200 }, [{ snippet: "nunca me llamaron", rating: 1 }], "");
    expect(msgs[0].content.toLowerCase()).toContain("reactiva");
  });
});
