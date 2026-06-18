// Phase 16 — Scraper multi-país: localización por país + filtro de relevancia
// multiidioma. Funciones puras expuestas en globalThis.__phase16.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const tmpData = path.join(os.tmpdir(), `i18n-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-i18n@local.test";
process.env.ADMIN_PASSWORD = "i18npass1234";
process.env.JWT_SECRET = "test-secret-i18n";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-i18n@local.test", name: "A", role: "admin", status: "active", setterId: "", password: pwd("i18npass1234") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

await import("../index.js");
const { localeForCountry, _isSectorRelevant, computeLeadSignals, _leadHasRealWebsite } = globalThis.__phase16;

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("localeForCountry", () => {
  it("mercados no-hispanos devuelven params de localización", () => {
    expect(localeForCountry("Estados Unidos")).toMatchObject({ hl: "en", gl: "us", google_domain: "google.com" });
    expect(localeForCountry("Brasil")).toMatchObject({ hl: "pt", gl: "br" });
    expect(localeForCountry("Alemania")).toMatchObject({ hl: "de" });
    expect(localeForCountry("Canadá")).toMatchObject({ hl: "en", gl: "ca" });
  });
  it("LatAm y España devuelven null (comportamiento histórico, cero regresión)", () => {
    expect(localeForCountry("Argentina")).toBe(null);
    expect(localeForCountry("México")).toBe(null);
    expect(localeForCountry("España")).toBe(null);
    expect(localeForCountry("")).toBe(null);
  });
});

describe("_isSectorRelevant (multiidioma)", () => {
  it("matchea términos del sector en varios idiomas aunque la query no aporte raíz", () => {
    expect(_isSectorRelevant("dental clinic miami", [])).toBe(true);   // dent
    expect(_isSectorRelevant("zahnarztpraxis berlin", [])).toBe(true); // zahn
    expect(_isSectorRelevant("studio dentistico roma", [])).toBe(true);// dent
    expect(_isSectorRelevant("med spa beverly hills", [])).toBe(true); // spa
    expect(_isSectorRelevant("harmonizacao facial sp", [])).toBe(true);// harmon
  });
  it("descarta lo irrelevante cuando ni el sector ni la query matchean", () => {
    expect(_isSectorRelevant("ferreteria don jose", [])).toBe(false);
    expect(_isSectorRelevant("panaderia la espiga", [])).toBe(false);
  });
  it("sigue respetando las raíces de la query (OR)", () => {
    expect(_isSectorRelevant("restaurante la plata", ["rest"])).toBe(true);
  });
});

describe("computeLeadSignals + _leadHasRealWebsite", () => {
  it("wa.me / redes NO cuentan como website real", () => {
    expect(_leadHasRealWebsite({ website: "https://wa.me/521555" })).toBe(false);
    expect(_leadHasRealWebsite({ website: "https://instagram.com/clinica" })).toBe(false);
    expect(_leadHasRealWebsite({ website: "https://miclinica.com" })).toBe(true);
    expect(_leadHasRealWebsite({ website: "" })).toBe(false);
  });
  it("4.8★ + 600 reseñas + sin web → muchas_reviews_sin_web · fuerte", () => {
    const s = computeLeadSignals({ rating: "4.8", reviews: 600, website: "" });
    expect(s.signals).toContain("muchas_reviews_sin_web");
    expect(s.reputationTier).toBe("fuerte");
    expect(s.hasWebsite).toBe(false);
    expect(s.openingAngle.length).toBeGreaterThan(0);
  });
  it("4.2★ con reseñas → rating_bajo · debil", () => {
    const s = computeLeadSignals({ rating: "4,2", reviews: 40, website: "https://x.com" });
    expect(s.signals).toContain("rating_bajo");
    expect(s.reputationTier).toBe("debil");
  });
});
