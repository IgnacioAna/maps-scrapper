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
const { _buildBriefMessages, _parseBriefOutput } = globalThis.__phase16;

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("_buildBriefMessages", () => {
  it("arma system+user con el negocio y las reseñas", () => {
    const msgs = _buildBriefMessages({ name: "Clínica Sonrisa", city: "Bogotá", country: "Colombia", rating: "4.8", reviews: 320 }, ["Muy buena atención", { snippet: "Tardaron en atenderme" }]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toContain("Clínica Sonrisa");
    expect(msgs[1].content).toContain("Tardaron en atenderme");
  });
  it("sin reseñas no rompe", () => {
    const msgs = _buildBriefMessages({ name: "X" }, []);
    expect(msgs[1].content).toContain("sin reseñas");
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
    const out = _parseBriefOutput('{"fitScore":250,"painPoints":[{"cita":"sin dolor"},{"dolor":"ok"}]}');
    expect(out.fitScore).toBe(100);
    expect(out.painPoints).toHaveLength(1);
    expect(out.painPoints[0].dolor).toBe("ok");
  });
  it("basura → null", () => {
    expect(_parseBriefOutput("no soy json")).toBeNull();
    expect(_parseBriefOutput("")).toBeNull();
    expect(_parseBriefOutput(null)).toBeNull();
  });
});
