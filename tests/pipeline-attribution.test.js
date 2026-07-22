// Atribución del pipeline (2026-07-22): GET /api/setters/leads/sin-wsp devuelve
// `calledByOwner` por lead = el DUEÑO ACTUAL hizo alguna llamada (callLog.by →
// setterId, fallback assignedTo). Las redistribuciones conservan el callLog
// como contexto, así que un lead heredado con llamadas de OTRO SDR debe venir
// con calledByOwner=false — es lo que usa "Mi pipeline" (En seguimiento / Sin
// contactar) para no mezclar el trabajo entre vendedores (criterio #139).
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `pipeline-attribution-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-pa@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminPA";
process.env.JWT_SECRET = "test-secret-pa";
// String vacio, NUNCA delete (dotenv re-carga el .env local si se borran).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin", email: "admin-pa@local.test", name: "AdminPA", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_a", email: "a@local.test", name: "SetterA", role: "setter", status: "active", setterId: "setter_a", password: pwd("passa1234"), createdAt: now, updatedAt: now },
      { id: "user_b", email: "b@local.test", name: "SetterB", role: "setter", status: "active", setterId: "setter_b", password: pwd("passb1234"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_a", name: "SetterA" }, { id: "setter_b", name: "SetterB" }],
    variants: [],
    leads: {
      // Heredado: asignado a B, pero las llamadas las hizo A → calledByOwner false.
      lead_heredado: { id: "lead_heredado", num: 1, name: "Heredado", phone: "+5215500000001", country: "México", assignedTo: "setter_b", estado: "sin_contactar", conexion: "sin_wsp", callLog: [{ ts: now, outcome: "no_answer", duration: 0, by: "user_a" }] },
      // Propio: asignado a B y llamado por B → calledByOwner true.
      lead_propio: { id: "lead_propio", num: 2, name: "Propio", phone: "+5215500000002", country: "México", assignedTo: "setter_b", estado: "sin_contactar", conexion: "sin_wsp", callLog: [{ ts: now, outcome: "no_answer", duration: 0, by: "user_b" }] },
      // Virgen: sin callLog → calledByOwner false.
      lead_virgen: { id: "lead_virgen", num: 3, name: "Virgen", phone: "+5215500000003", country: "México", assignedTo: "setter_b", estado: "sin_contactar", conexion: "sin_wsp", callLog: [] },
      // Legacy sin `by`: fallback a assignedTo (dueño actual) → true.
      lead_legacy: { id: "lead_legacy", num: 4, name: "Legacy", phone: "+5215500000004", country: "México", assignedTo: "setter_b", estado: "sin_contactar", conexion: "sin_wsp", callLog: [{ ts: now, outcome: "no_answer", duration: 0 }] },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  return (cookies.find((c) => c.startsWith("gs_session=")) || "").split(";")[0];
}

let adminCookie = "", setterBCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-pa@local.test", "adminpass1");
  setterBCookie = await login("b@local.test", "passb1234");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("sin-wsp — calledByOwner atribuido por quién llamó", () => {
  it("admin con ?setter=setter_b: heredado=false, propio=true, virgen=false, legacy=true", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp?setter=setter_b").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const byId = {};
    r.body.leads.forEach((l) => { byId[l.id] = l.calledByOwner; });
    expect(byId.lead_heredado).toBe(false);
    expect(byId.lead_propio).toBe(true);
    expect(byId.lead_virgen).toBe(false);
    expect(byId.lead_legacy).toBe(true);
  });

  it("el setter logueado recibe el mismo flag sobre sus leads", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", setterBCookie);
    expect(r.status).toBe(200);
    const byId = {};
    r.body.leads.forEach((l) => { byId[l.id] = l.calledByOwner; });
    expect(byId.lead_heredado).toBe(false);
    expect(byId.lead_propio).toBe(true);
  });
});
