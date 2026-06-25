// Test del fix `include=callable` en GET /api/setters/leads/sin-wsp.
// Sin el flag: solo leads con conexion='sin_wsp' (carril llamadas).
// Con el flag: además, leads de Setteo llamables (con teléfono, no terminales).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `callable-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cl@local.test";
process.env.ADMIN_PASSWORD = "clpass1234";
process.env.ADMIN_NAME = "AdminCL";
process.env.JWT_SECRET = "test-secret-cl";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_cl", email: "admin-cl@local.test", name: "AdminCL", role: "admin", status: "active", setterId: "", password: pwd("clpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_cl", name: "SetterCL" }],
    variants: [],
    leads: {
      // carril llamadas (conexion sin_wsp) → siempre aparece
      lead_sinwsp: { num: 1, name: "Sin WSP", phone: "+5491111111", assignedTo: "setter_cl", estado: "sin_wsp", conexion: "sin_wsp" },
      // setteo llamable (tiene tel, no terminal) → solo con include=callable
      lead_setteo_callable: { num: 2, name: "Setteo callable", phone: "+5492222222", assignedTo: "setter_cl", estado: "sin_contactar", conexion: "" },
      // setteo terminal (agendado) → nunca
      lead_agendado: { num: 3, name: "Agendado", phone: "+5493333333", assignedTo: "setter_cl", estado: "agendado", conexion: "" },
      // setteo descartado → nunca
      lead_descartado: { num: 4, name: "Descartado", phone: "+5494444444", assignedTo: "setter_cl", estado: "descartado", conexion: "" },
      // setteo sin teléfono → nunca (no llamable)
      lead_sin_tel: { num: 5, name: "Sin tel", phone: "", assignedTo: "setter_cl", estado: "sin_contactar", conexion: "" },
      // validado MÓVIL → NO se excluye (se sigue llamando)
      lead_mobile_ok: { num: 6, name: "Mobile OK", phone: "+5495555555", assignedTo: "setter_cl", estado: "sin_wsp", conexion: "sin_wsp", lookupAt: new Date().toISOString(), phoneType: "mobile" },
      // validado SIN operadora (muerto) → excluido de TODA cola de discado
      lead_dead_lookup: { num: 7, name: "Dead lookup", phone: "+5496666666", assignedTo: "setter_cl", estado: "sin_wsp", conexion: "sin_wsp", lookupAt: new Date().toISOString(), phoneType: "" },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-cl@local.test", password: "clpass1234" });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  adminCookie = (cookies.find((c) => c.startsWith("gs_session=")) || "").split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("GET /api/setters/leads/sin-wsp · include=callable", () => {
  it("sin flag: conexion=sin_wsp (incluye validado-móvil, excluye validado-muerto)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const ids = r.body.leads.map((l) => l.id);
    expect(ids).toEqual(["lead_sinwsp", "lead_mobile_ok"]); // ordenados por num
    expect(ids).not.toContain("lead_dead_lookup");
  });

  it("con include=callable: agrega los de Setteo llamables, excluye terminales, sin-tel y validado-muerto", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const ids = r.body.leads.map((l) => l.id).sort();
    expect(ids).toEqual(["lead_mobile_ok", "lead_setteo_callable", "lead_sinwsp"]);
    expect(ids).not.toContain("lead_agendado");
    expect(ids).not.toContain("lead_descartado");
    expect(ids).not.toContain("lead_sin_tel");
    expect(ids).not.toContain("lead_dead_lookup");
  });

  it("validado SIN operadora (lookupAt + phoneType vacío) → fuera de la cola de discado", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", adminCookie);
    expect(r.body.leads.find((l) => l.id === "lead_dead_lookup")).toBeUndefined();
    // pero el validado-móvil SÍ está
    expect(r.body.leads.find((l) => l.id === "lead_mobile_ok")).toBeTruthy();
  });
});
