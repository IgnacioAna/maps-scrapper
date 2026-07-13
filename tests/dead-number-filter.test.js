// Fix 2026-07-12: un número validado por Telnyx SIN tipo de línea pero CON operadora
// (patrón típico de México/España/LatAm) es REAL y debe seguir llamable. Solo es
// "muerto" si el lookup fue exitoso y no encontró NI tipo NI operadora. Un error
// transitorio (rate-limit 10011) tampoco entierra el lead → se reintenta.

import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmpData = path.join(os.tmpdir(), `deadnum-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dn@local.test";
process.env.ADMIN_PASSWORD = "dnpass1234";
process.env.JWT_SECRET = "test-secret-dn";
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [], invites: [], sessions: [] }));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }));

await import("../index.js");
const { _leadIsConfirmedDeadNumber, _lookupErrorIsTransient, _leadIsCallableNow } = globalThis.__phase16;

const base = { phone: "+34600111222", estado: "sin_contactar" };

describe("Filtro de número muerto (fix MX/ES sin tipo)", () => {
  it("NO es muerto: validado con operadora pero sin tipo de línea (México/España)", () => {
    const l = { ...base, lookupAt: "2026-07-11T00:00:00Z", phoneType: "", lookupCarrier: "Vodafone España S.A. Unipersonal" };
    expect(_leadIsConfirmedDeadNumber(l)).toBe(false);
    expect(_leadIsCallableNow(l, Date.now())).toBe(true);
  });

  it("NO es muerto: lookup con error de rate-limit (10011)", () => {
    const l = { ...base, lookupAt: "2026-07-11T00:00:00Z", phoneType: "", lookupError: '{"errors":[{"code":"10011","detail":"You have exceeded the maximum number of allowed requests."}]}' };
    expect(_leadIsConfirmedDeadNumber(l)).toBe(false);
    expect(_leadIsCallableNow(l, Date.now())).toBe(true);
  });

  it("SÍ es muerto: lookup exitoso, sin tipo Y sin operadora", () => {
    const l = { ...base, lookupAt: "2026-07-11T00:00:00Z", phoneType: "", lookupCarrier: "" };
    expect(_leadIsConfirmedDeadNumber(l)).toBe(true);
    expect(_leadIsCallableNow(l, Date.now())).toBe(false);
  });

  it("NO es muerto: nunca se le hizo lookup", () => {
    const l = { ...base };
    expect(_leadIsConfirmedDeadNumber(l)).toBe(false);
    expect(_leadIsCallableNow(l, Date.now())).toBe(true);
  });

  it("NO es muerto: validado como móvil", () => {
    const l = { ...base, lookupAt: "2026-07-11T00:00:00Z", phoneType: "mobile", lookupCarrier: "Telmex" };
    expect(_leadIsConfirmedDeadNumber(l)).toBe(false);
    expect(_leadIsCallableNow(l, Date.now())).toBe(true);
  });

  it("error transitorio: reconoce rate-limit / timeout / red; NO reconoce error permanente", () => {
    expect(_lookupErrorIsTransient('{"code":"10011"}')).toBe(true);
    expect(_lookupErrorIsTransient("timeout")).toBe(true);
    expect(_lookupErrorIsTransient("Too Many Requests")).toBe(true);
    expect(_lookupErrorIsTransient("ECONNRESET")).toBe(true);
    expect(_lookupErrorIsTransient("fetch failed")).toBe(true);
    expect(_lookupErrorIsTransient("invalid phone number")).toBe(false);
    expect(_lookupErrorIsTransient("")).toBe(false);
    expect(_lookupErrorIsTransient(null)).toBe(false);
  });
});
