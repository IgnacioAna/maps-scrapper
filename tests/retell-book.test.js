// Tests de POST /api/retell/tool/book (Phase 24, plan 24-04, Task 1).
//
// D-24-05: /book crea la cita Y NADA MÁS — no toca callLog, no toca
// lead.estado. VOICE-04: auth por header estático x-scm-tool-secret,
// comparado en tiempo constante, 401 genérico. Cobertura: auth, shape de
// la cita creada, ausencia de escritura de historial de llamadas,
// idempotencia por call_id, las 2 formas del payload (call wrapper vs
// "args only"), validación de fecha (pasado/lejos/no-parseable), lead
// inexistente, y fail-closed en producción sin toolSecret.
//
// Regla #121: env vars a "" (nunca `delete`) para que dotenv no las
// repueble desde .env al re-cargar el módulo en otro test file del mismo
// run. Regla #163: todos los teléfonos del fixture tienen >= 7 dígitos.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-book-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rb@local.test";
process.env.ADMIN_PASSWORD = "rbpass1234";
process.env.ADMIN_NAME = "AdminRB";
process.env.JWT_SECRET = "test-secret-rb";
process.env.RETELL_API_KEY = "";
process.env.RETELL_WEBHOOK_SECRET = "";
process.env.RETELL_TOOL_SECRET = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const RETELL_CONFIG_PATH = path.join(tmpData, "retell_config.json");
const SETTERS_PATH = path.join(tmpData, "setters.json");
const BOOK_URL = "/api/retell/tool/book";
const TOOL_SECRET = "book-secret-test-xyz-987654";

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_rb", email: "admin-rb@local.test", name: "AdminRB", role: "admin", status: "active", setterId: "", password: pwd("rbpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  SETTERS_PATH,
  JSON.stringify({
    setters: [
      { id: "setter_agente_ia", name: "Agente IA", activeVariantId: "", createdAt: new Date().toISOString() },
    ],
    variants: [],
    leads: {
      lead_book_1: { num: 1, name: "Clinica Book Uno", phone: "+525550001001", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", callLog: [] },
      lead_book_2: { num: 2, name: "Clinica Book Dos", phone: "+525550001002", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", callLog: [] },
      lead_book_3: { num: 3, name: "Clinica Book Tres", phone: "+525550001003", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", callLog: [] },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  RETELL_CONFIG_PATH,
  JSON.stringify({
    apiKey: "", webhookSecret: "", toolSecret: TOOL_SECRET,
    agentId: "", fromNumberId: "", dailyCap: 50, enabled: true, rotationIdx: 0, whatsappReturn: "",
    updatedAt: new Date().toISOString(), updatedBy: "test_seed",
  }, null, 2)
);

const { app } = await import("../index.js");

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

function futureIso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

describe("POST /api/retell/tool/book — auth (VOICE-04)", () => {
  it("sin header → 401 y data.calendar no creció", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app).post(BOOK_URL).send({
      call: { call_id: "call_noauth_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
      args: { fecha: futureIso(5) },
    });
    expect(r.status).toBe(401);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });

  it("con header incorrecto → 401", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", "un-secret-que-no-es")
      .send({
        call: { call_id: "call_wrongauth_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
        args: { fecha: futureIso(5) },
      });
    expect(r.status).toBe(401);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });
});

describe("POST /api/retell/tool/book — creación de la cita (D-24-05)", () => {
  it("con header correcto → 200, data.calendar creció en 1 con el shape correcto", async () => {
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_ok_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
        args: { fecha: futureIso(5) },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message).not.toContain("¿");
    expect(r.body.message).not.toContain("¡");

    const data = readJson(SETTERS_PATH);
    expect(data.calendar.length).toBe(1);
    const entry = data.calendar[0];
    expect(entry.leadId).toBe("lead_book_1");
    expect(entry.setterId).toBe("setter_agente_ia");
    expect(entry.sourceCall).toBe(true);
    expect(entry.calendarioEstado).toBe("pendiente");
    expect(entry.valorProyecto).toBe(0);
    expect(entry.comision).toBe(0);
    expect(entry.id).toBeTruthy();
    expect(entry.fecha).toBeTruthy();
  });

  it("el historial de llamadas del lead NO creció y lead.estado NO cambió", async () => {
    const data = readJson(SETTERS_PATH);
    const lead = data.leads.lead_book_1;
    expect((lead.callLog || []).length).toBe(0);
    expect(lead.estado).toBe("sin_contactar");
  });

  it("segunda invocación con el mismo call_id → 200 sin crear una segunda cita", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_ok_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
        args: { fecha: futureIso(5) },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });

  it("leadId por metadata funciona igual que por retell_llm_dynamic_variables", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_metadata_1", metadata: { leadId: "lead_book_2" } },
        args: { fecha: futureIso(6) },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const data = readJson(SETTERS_PATH);
    expect(data.calendar.length).toBe(before + 1);
    expect(data.calendar[data.calendar.length - 1].leadId).toBe("lead_book_2");
  });

  it('modo "args only" (sin objeto call) con args.leadId funciona', async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({ leadId: "lead_book_3", fecha: futureIso(7), hora: "14:00" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const data = readJson(SETTERS_PATH);
    expect(data.calendar.length).toBe(before + 1);
    expect(data.calendar[data.calendar.length - 1].leadId).toBe("lead_book_3");
  });
});

describe("POST /api/retell/tool/book — validación de fecha (200, ok:false, sin cita)", () => {
  it("fecha en el pasado → 200 con ok:false y sin cita nueva", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_past_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
        args: { fecha: futureIso(-2) },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(typeof r.body.message).toBe("string");
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });

  it("fecha a 200 días → 200 con ok:false y sin cita nueva", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_far_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
        args: { fecha: futureIso(200) },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });

  it("fecha no parseable → 200 con ok:false y sin cita nueva", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_badformat_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
        args: { fecha: "esto no es una fecha" },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });
});

describe("POST /api/retell/tool/book — lead inexistente / sin leadId", () => {
  it("lead inexistente → 200 con mensaje, sin cita, sin 5xx", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({
        call: { call_id: "call_nolead_1", retell_llm_dynamic_variables: { leadId: "lead_no_existe_999" } },
        args: { fecha: futureIso(5) },
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });

  it("sin leadId resoluble en ningún lado → 200 con mensaje, sin cita", async () => {
    const before = readJson(SETTERS_PATH).calendar.length;
    const r = await request(app)
      .post(BOOK_URL)
      .set("x-scm-tool-secret", TOOL_SECRET)
      .send({ call: { call_id: "call_noleadid_1" }, args: { fecha: futureIso(5) } });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(readJson(SETTERS_PATH).calendar.length).toBe(before);
  });
});

describe("POST /api/retell/tool/book — fail-closed en producción sin toolSecret", () => {
  it("NODE_ENV=production sin toolSecret configurado → 503", async () => {
    const cfg = readJson(RETELL_CONFIG_PATH);
    const original = cfg.toolSecret;
    cfg.toolSecret = "";
    writeJson(RETELL_CONFIG_PATH, cfg);
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const r = await request(app)
        .post(BOOK_URL)
        .send({
          call: { call_id: "call_prod_1", retell_llm_dynamic_variables: { leadId: "lead_book_1" } },
          args: { fecha: futureIso(5) },
        });
      expect(r.status).toBe(503);
    } finally {
      process.env.NODE_ENV = prevEnv;
      cfg.toolSecret = original;
      writeJson(RETELL_CONFIG_PATH, cfg);
    }
  });
});
