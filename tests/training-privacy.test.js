// Tests de privacidad de la biblioteca de Entrenamiento IA (2026-07-10):
// - Setter ve SOLO sus llamadas (por c.by → setterId, fallback lead.assignedTo).
// - Admin ve todas.
// - Detalle: setter recibe 403 al pedir una llamada ajena.
// Y del anti-marca (_stripBrandMentions vía sanitizeMercuryStyle):
// - "SCM"/"SCM Dental" se reemplazan en outputs de IA.
// - Las URLs con "scm-" no se rompen.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `training-priv-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tp@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminTP";
process.env.JWT_SECRET = "test-secret-tp";
// Sin IA: el detalle de la biblioteca genera el resumen LLM lazy si hay key —
// acá probamos privacidad, no la IA (y con key real el test se cuelga 20s).
// OJO: string vacío, NO delete — index.js corre dotenv.config() que re-carga
// el .env local, pero dotenv no pisa vars ya definidas (aunque estén vacías).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();
const transcript = { segments: [{ speaker: "setter", text: "Hola, le hablo por la clinica", start: 0 }, { speaker: "lead", text: "Si, digame", start: 2 }], transcribedAt: now };

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_tp", email: "admin-tp@local.test", name: "AdminTP", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_ana", email: "ana@local.test", name: "Ana", role: "setter", status: "active", setterId: "setter_ana", password: pwd("anapass123"), createdAt: now, updatedAt: now },
      { id: "user_beto", email: "beto@local.test", name: "Beto", role: "setter", status: "active", setterId: "setter_beto", password: pwd("betopass123"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_ana", name: "Ana" },
      { id: "setter_beto", name: "Beto" },
    ],
    leads: {
      lead_de_ana: {
        id: "lead_de_ana", num: 1, name: "Clinica Ana", phone: "+5215512345678", country: "México",
        assignedTo: "setter_ana", estado: "sin_contactar",
        callLog: [{ ts: now, outcome: "answered_interested", by: "user_ana", duration: 60, transcript }],
      },
      lead_de_beto: {
        id: "lead_de_beto", num: 2, name: "Clinica Beto", phone: "+5215587654321", country: "México",
        assignedTo: "setter_beto", estado: "sin_contactar",
        callLog: [{ ts: now, outcome: "callback_later", by: "user_beto", duration: 45, transcript }],
      },
    },
    variants: [], calendar: [], sessions: []
  }, null, 2)
);

const { app } = await import("../index.js");

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return r.headers["set-cookie"][0].split(";")[0];
}

let adminCookie = "", anaCookie = "", betoCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-tp@local.test", "adminpass1");
  anaCookie = await login("ana@local.test", "anapass123");
  betoCookie = await login("beto@local.test", "betopass123");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("GET /api/training/calls — privacidad por setter", () => {
  it("admin ve las llamadas de todos", async () => {
    const r = await request(app).get("/api/training/calls").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const leadIds = r.body.calls.map((c) => c.leadId).sort();
    expect(leadIds).toEqual(["lead_de_ana", "lead_de_beto"]);
  });

  it("un setter ve SOLO sus llamadas", async () => {
    const r = await request(app).get("/api/training/calls").set("Cookie", anaCookie);
    expect(r.status).toBe(200);
    expect(r.body.calls.length).toBe(1);
    expect(r.body.calls[0].leadId).toBe("lead_de_ana");
  });

  it("el otro setter ve solo las suyas (no las de Ana)", async () => {
    const r = await request(app).get("/api/training/calls").set("Cookie", betoCookie);
    expect(r.status).toBe(200);
    expect(r.body.calls.length).toBe(1);
    expect(r.body.calls[0].leadId).toBe("lead_de_beto");
  });
});

describe("GET /api/training/calls/:leadId/:callIdx — detalle", () => {
  it("setter accede a su propia llamada", async () => {
    const r = await request(app).get("/api/training/calls/lead_de_ana/0").set("Cookie", anaCookie);
    expect(r.status).toBe(200);
    expect(r.body.segments.length).toBeGreaterThan(0);
  });

  it("setter recibe 403 al pedir la llamada de otro", async () => {
    const r = await request(app).get("/api/training/calls/lead_de_ana/0").set("Cookie", betoCookie);
    expect(r.status).toBe(403);
  });

  it("admin accede a cualquiera", async () => {
    const r = await request(app).get("/api/training/calls/lead_de_beto/0").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
  });
});

describe("anti-marca en outputs de IA (sanitizeMercuryStyle)", () => {
  it("reemplaza 'SCM Dental' y 'SCM' sueltos", () => {
    const { sanitizeMercuryStyle } = globalThis.__mercury;
    const out = sanitizeMercuryStyle("Trabajamos en SCM Dental y el equipo de SCM te contacta.");
    expect(out.text).not.toMatch(/\bSCM\b/);
    expect(out.text).toContain("la empresa");
  });

  it("no rompe URLs con scm- (lowercase con guión)", () => {
    const { sanitizeMercuryStyle } = globalThis.__mercury;
    const out = sanitizeMercuryStyle("Te paso la web: https://scm-dental.vercel.app/");
    expect(out.text).toContain("https://scm-dental.vercel.app/");
  });
});
