// Phase 10 C3/C4 — Lead Brief IA: helpers puros (prompt builder + parser del output LLM).
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const tmpData = path.join(os.tmpdir(), `brief-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-br@local.test";
process.env.ADMIN_PASSWORD = "brpass1234";
process.env.JWT_SECRET = "test-secret-br";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-br@local.test", name: "A", role: "admin", status: "active", setterId: "", password: pwd("brpass1234") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

await import("../index.js");
const { _buildBriefMessages, _parseBriefOutput, _classifyBriefArray, _synthBriefText, _fallbackBriefFromReviews, _looksLikePromptNoise, _briefTooThin } = globalThis.__phase16;

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("_buildBriefMessages", () => {
  it("arma un único mensaje user con instrucciones + negocio + reseñas (Mercury devuelve vacío con system)", () => {
    const msgs = _buildBriefMessages({ name: "Clínica Sonrisa", city: "Bogotá", country: "Colombia", rating: "4.8", reviews: 320 }, ["Muy buena atención", { snippet: "Tardaron en atenderme" }]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("Clínica Sonrisa");
    expect(msgs[0].content).toContain("Tardaron en atenderme");
    expect(msgs[0].content).toContain("JSON");
  });
  it("sin reseñas no rompe", () => {
    const msgs = _buildBriefMessages({ name: "X" }, []);
    expect(msgs[0].content).toContain("sin reseñas");
  });
});

describe("_parseBriefOutput", () => {
  it("JSON válido → normalizado", () => {
    const out = _parseBriefOutput('{"treatments":["implantes","ortodoncia"],"painPoints":[{"dolor":"esperas largas","cita":"esperé 1h"}],"fitScore":82,"hookPhrase":"vi que la espera molesta","brief":"buen prospecto"}');
    expect(out.treatments).toEqual(["implantes", "ortodoncia"]);
    expect(out.painPoints[0].dolor).toBe("esperas largas");
    expect(out.fitScore).toBe(82);
    expect(out.hookPhrase).toContain("espera");
  });
  it("tolera fences ```json", () => {
    const out = _parseBriefOutput('```json\n{"fitScore":50,"treatments":[],"painPoints":[],"hookPhrase":"","brief":"x"}\n```');
    expect(out).not.toBeNull();
    expect(out.fitScore).toBe(50);
  });
  it("clampea fitScore 0-100 y filtra painPoints sin dolor", () => {
    const out = _parseBriefOutput('{"fitScore":250,"painPoints":[{"cita":"sin dolor"},{"dolor":"esperas largas"}]}');
    expect(out.fitScore).toBe(100);
    expect(out.painPoints).toHaveLength(1);
    expect(out.painPoints[0].dolor).toBe("esperas largas");
  });
  it("basura → null", () => {
    expect(_parseBriefOutput("no soy json")).toBeNull();
    expect(_parseBriefOutput("")).toBeNull();
    expect(_parseBriefOutput(null)).toBeNull();
  });
  it("Mercury devuelve ARRAY de arrays → rescata tratamientos + dolores (bug Big Dental)", () => {
    const out = _parseBriefOutput('[["ortodoncia","implantes","limpieza dental"],["el gerente movió mi moto y fue trato cero profesional (un paciente)"]]');
    expect(out).not.toBeNull();
    expect(out.treatments).toContain("ortodoncia");
    expect(out.treatments).toContain("limpieza dental");
    expect(out.painPoints).toHaveLength(1);
    expect(out.painPoints[0].dolor).toContain("trato cero profesional");
  });
  it("array vacío [] → null (no hay nada que rescatar)", () => {
    expect(_parseBriefOutput("[]")).toBeNull();
  });
});

describe("_classifyBriefArray", () => {
  it("strings cortos = tratamientos, frases largas = dolores", () => {
    const r = _classifyBriefArray(["implantes", "ortodoncia", "esperé más de una hora en la sala y nadie me atendió"]);
    expect(r.treatments).toEqual(["implantes", "ortodoncia"]);
    expect(r.painPoints).toHaveLength(1);
  });
});

describe("_synthBriefText", () => {
  it("sin brief/hook pero con dolores → sintetiza texto usable (no queda vacía la card)", () => {
    const lead = { reviews: 64, rating: "4.4", openingAngle: "Sin sitio web → ¿cómo te encuentran?" };
    const r = _synthBriefText(lead, { painPoints: [{ dolor: "no atienden el teléfono", cita: "" }], treatments: ["implantes", "ortodoncia"] });
    expect(r.hookPhrase).toContain("no atienden el teléfono");
    expect(r.brief).toContain("64 reseñas");
    expect(r.brief).toContain("implantes");
  });
  it("NO repite el openingAngle en brief ni hook (ya se muestra arriba)", () => {
    const lead = { reviews: 17, rating: "4.5", openingAngle: "Sin sitio web → ¿cómo te encuentran?" };
    const r = _synthBriefText(lead, { painPoints: [], treatments: ["ortodoncia"] });
    expect(r.brief).not.toContain("¿cómo te encuentran");
    expect(r.hookPhrase).toBe(""); // sin dolor real, hook vacío (no echa el ángulo)
  });
  it("respeta brief/hook si la IA los dio", () => {
    const r = _synthBriefText({}, { brief: "brief de la IA", hookPhrase: "hook de la IA", painPoints: [], treatments: [] });
    expect(r.brief).toBe("brief de la IA");
    expect(r.hookPhrase).toBe("hook de la IA");
  });
});

describe("_looksLikePromptNoise (filtro de ruido del prompt loreado por Mercury)", () => {
  it("detecta fragmentos de instrucciones/sintaxis JSON", () => {
    expect(_looksLikePromptNoise("y termina con }. NUNCA un array [")).toBe(true); // bug Andrés Niño
    expect(_looksLikePromptNoise("un único objeto JSON")).toBe(true);
    expect(_looksLikePromptNoise('{"treatments":[]}')).toBe(true);
    expect(_looksLikePromptNoise("")).toBe(true);
  });
  it("deja pasar lenguaje natural real", () => {
    expect(_looksLikePromptNoise("no atienden el teléfono")).toBe(false);
    expect(_looksLikePromptNoise("esperé más de una hora en la sala")).toBe(false);
    expect(_looksLikePromptNoise("ortodoncia")).toBe(false);
  });
  it("_parseBriefOutput filtra el ruido del prompt de painPoints/treatments", () => {
    const out = _parseBriefOutput('{"treatments":["ortodoncia","un array []"],"painPoints":["no contestan el teléfono","y termina con }. NUNCA un array ["],"brief":"clínica buena"}');
    expect(out.treatments).toEqual(["ortodoncia"]);
    expect(out.painPoints).toHaveLength(1);
    expect(out.painPoints[0].dolor).toContain("no contestan");
  });
});

describe("_briefTooThin (placeholders degenerados tipo '...')", () => {
  it("detecta strings casi sin letras", () => {
    expect(_briefTooThin("...", 8)).toBe(true);
    expect(_briefTooThin("…", 8)).toBe(true);
    expect(_briefTooThin("—", 8)).toBe(true);
    expect(_briefTooThin("N/A", 8)).toBe(true);
  });
  it("deja pasar texto real", () => {
    expect(_briefTooThin("clínica consolidada con buen volumen", 8)).toBe(false);
    expect(_briefTooThin("ortodoncia", 3)).toBe(false);
  });
  it("Mercury devuelve brief='...' (placeholder) → se blanquea, no se muestra basura", () => {
    const out = _parseBriefOutput('{"treatments":[],"painPoints":[],"brief":"...","hookPhrase":"..."}');
    // todo degenerado/vacío → null (nada usable, dispara fallback de reseñas en el endpoint)
    expect(out === null || (!out.brief && !out.hookPhrase && !out.painPoints.length && !out.treatments.length)).toBe(true);
  });
});

describe("_fallbackBriefFromReviews", () => {
  it("IA devolvió [] pero hay reseñas → arma brief de las reseñas (quejas reales + tratamientos)", () => {
    const lead = { reviews: 11, rating: "4.8", openingAngle: "Buen rating, pocas reseñas" };
    const r = _fallbackBriefFromReviews(lead, ["Excelente atención, muy recomendable", "Me hicieron implantes y quedé feliz", "Tardaron mucho y fue una mala experiencia"]);
    expect(r).not.toBeNull();
    expect(r.fromReviews).toBe(true);
    expect(r.treatments).toContain("implantes");
    // solo la queja negativa entra como dolor (no las reseñas positivas)
    expect(r.painPoints).toHaveLength(1);
    expect(r.painPoints[0].dolor).toContain("mala experiencia");
  });
  it("rating alto sin quejas ni tratamientos inferibles → null (no card redundante con el ángulo)", () => {
    const r = _fallbackBriefFromReviews({ reviews: 5, rating: "5.0" }, ["Excelente", "Muy buena atención", "Los mejores"]);
    expect(r).toBeNull();
  });
  it("reseñas positivas pero con tratamiento inferible → brief de tratamientos (sin dolores)", () => {
    const r = _fallbackBriefFromReviews({ reviews: 5, rating: "5.0" }, ["Excelente, me hicieron ortodoncia", "Muy buena atención"]);
    expect(r).not.toBeNull();
    expect(r.painPoints).toHaveLength(0);
    expect(r.treatments).toContain("ortodoncia");
  });
  it("0 reseñas → null (no hay con qué armar nada)", () => {
    expect(_fallbackBriefFromReviews({}, [])).toBeNull();
  });
  it("con RATING: solo reseñas 1-2★ son dolores (no por palabras → cero falsos positivos)", () => {
    const r = _fallbackBriefFromReviews({ reviews: 10, rating: "4.5" }, [
      { snippet: "espero volver pronto, atención de cara excelente", rating: 5 }, // positiva con "espero"/"cara" → NO debe ser dolor
      { snippet: "me hicieron ortodoncia y quedó perfecto", rating: 5 },
      { snippet: "no me atendieron a horario y fue un desastre", rating: 1 },    // 1★ → dolor real
    ]);
    expect(r).not.toBeNull();
    expect(r.painPoints).toHaveLength(1);
    expect(r.painPoints[0].dolor).toContain("desastre");
    expect(r.treatments).toContain("ortodoncia");
  });
});
