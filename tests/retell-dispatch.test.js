// Tests de POST /api/admin/voice-agent/dispatch (Phase 24, plan 24-03).
//
// El dispatch es la única superficie del sistema que gasta dinero real de
// forma masiva: se prueba en sus tres dimensiones de riesgo — a quién llama
// (filtros de elegibilidad), cuánto gasta (cap diario + dry-run) y qué rompe
// cuando Retell falla (error por lead, nunca rompe el lote).
//
// Regla #121: env vars a "" (nunca `delete`) para que dotenv no las repueble
// desde .env al re-cargar el módulo en otro test file del mismo run.
// Regla #163: todos los teléfonos del fixture tienen >= 7 dígitos.
//
// Patrón de fetch inyectable: el handler es un route Express (no una función
// standalone), así que el punto de inyección es
// globalThis.__voiceAgent._voiceDispatchFetch.impl — se pisa en beforeAll y
// se restaura en afterAll (ver Task 2, mismo espíritu que fetchImpl de
// _telnyxNumberLookup, adaptado al contrato de un route handler).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-dispatch-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rd@local.test";
process.env.ADMIN_PASSWORD = "rdpass1234";
process.env.ADMIN_NAME = "AdminRD";
process.env.JWT_SECRET = "test-secret-rd";
process.env.RETELL_API_KEY = "";
process.env.RETELL_WEBHOOK_SECRET = "";
process.env.RETELL_TOOL_SECRET = "";
process.env.TELNYX_API_KEY = "";
process.env.TELNYX_SIP_USERNAME = "";
process.env.TELNYX_SIP_PASSWORD = "";
process.env.TELNYX_SIP_CONNECTION_ID = "";
process.env.TELNYX_SIGNATURE_PUBLIC_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const RETELL_CONFIG_PATH = path.join(tmpData, "retell_config.json");
const TELNYX_CONFIG_PATH = path.join(tmpData, "telnyx_config.json");
const SETTERS_PATH = path.join(tmpData, "setters.json");
const DISPATCH_URL = "/api/admin/voice-agent/dispatch";

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function patchRetellConfig(patch) {
  const cfg = readJson(RETELL_CONFIG_PATH);
  Object.assign(cfg, patch);
  writeJson(RETELL_CONFIG_PATH, cfg);
  return cfg;
}
function patchTelnyxConfig(patch) {
  const cfg = readJson(TELNYX_CONFIG_PATH);
  Object.assign(cfg, patch);
  writeJson(TELNYX_CONFIG_PATH, cfg);
  return cfg;
}
function callLogLengths(ids) {
  const s = readJson(SETTERS_PATH);
  const out = {};
  for (const id of ids) out[id] = (s.leads[id]?.callLog || []).length;
  return out;
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_rd", email: "admin-rd@local.test", name: "AdminRD", role: "admin", status: "active", setterId: "", password: pwd("rdpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_rd", email: "super-rd@local.test", name: "SuperRD", role: "supervisor", status: "active", setterId: "", password: pwd("superpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_rd", email: "setter-rd@local.test", name: "SetterRD", role: "setter", status: "active", setterId: "setter_human", password: pwd("setterpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// Leads diseñados para ejercitar cada exclusión de _leadIsCallableNow, más
// 3 elegibles del agente (prefijo mexicano +52555…, regla #163). Uno de los
// 3 elegibles sin doctor (withDoctor filter). lead_precalled representa una
// llamada YA hecha hoy por el agente (cuenta para _retellCallsTodayCount)
// pero está en estado terminal ('agendado') para que NUNCA aparezca en la
// selección — así el baseline calledToday=1 es constante durante todo el
// archivo (el dispatch nunca escribe callLog, D-24-05).
const nowIso = new Date().toISOString();
const tomorrowIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

fs.writeFileSync(
  SETTERS_PATH,
  JSON.stringify({
    setters: [
      { id: "setter_agente_ia", name: "Agente IA", activeVariantId: "", createdAt: nowIso },
      { id: "setter_human", name: "SetterRD", activeVariantId: "", createdAt: nowIso },
    ],
    variants: [],
    leads: {
      lead_e1: { num: 1, name: "Clinica Uno", phone: "+525550000001", country: "México", city: "CDMX", assignedTo: "setter_agente_ia", estado: "sin_contactar", doctor: "Dr. Uno", reviews: 120, rating: 4.8, yearsActive: 12 },
      lead_e2: { num: 2, name: "Clinica Dos", phone: "+525550000002", country: "México", city: "CDMX", assignedTo: "setter_agente_ia", estado: "sin_contactar", doctor: "Dr. Dos" },
      lead_e3: { num: 3, name: "Clinica Tres (sin doctor)", phone: "+525550000003", country: "México", city: "CDMX", assignedTo: "setter_agente_ia", estado: "sin_contactar", doctor: "" },
      // DNC → nunca se llama (compliance).
      lead_dnc: { num: 4, name: "Clinica DNC", phone: "+525550000004", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", doNotCall: true },
      // Terminal → fuera de _leadIsCallableNow.
      lead_descartado: { num: 5, name: "Clinica Descartada", phone: "+525550000005", country: "México", assignedTo: "setter_agente_ia", estado: "descartado" },
      // Callback futuro → fuera de la cola hasta que venza.
      lead_callback_futuro: { num: 6, name: "Clinica Callback", phone: "+525550000006", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", callbackAt: tomorrowIso },
      // España fijo → tarifa roja (_tariffBlocked), sin engagement previo.
      lead_es_fijo: { num: 7, name: "Clinica ES Fijo", phone: "+34910858263", country: "España", assignedTo: "setter_agente_ia", estado: "sin_contactar" },
      // Número muerto confirmado por Telnyx (lookupAt seteado, sin tipo NI operadora).
      lead_dead: { num: 8, name: "Clinica Muerta", phone: "+525550000009", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", lookupAt: nowIso, phoneType: "", lookupCarrier: "", lookupError: "" },
      // Elegible en todo sentido, pero asignado a OTRO setter (no del agente).
      lead_other_setter: { num: 9, name: "Clinica de otro SDR", phone: "+525550000010", country: "México", assignedTo: "setter_human", estado: "sin_contactar" },
      // Llamada YA hecha hoy por el agente — cuenta para el cap, nunca aparece
      // en la selección (estado terminal 'agendado').
      lead_precalled: {
        num: 10, name: "Clinica Precalled", phone: "+525550009999", country: "México", assignedTo: "setter_agente_ia", estado: "agendado",
        callLog: [{ ts: nowIso, outcome: "scheduled_with_admin", duration: 60, by: "", channel: "retell" }],
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, lastPages: {} }, null, 2));

fs.writeFileSync(
  TELNYX_CONFIG_PATH,
  JSON.stringify({
    apiKey: "tnx-test-key-not-real",
    sipUsername: "", sipPassword: "", sipConnectionId: "", signaturePublicKey: "",
    numbers: [
      { id: "num_a", phone: "+13051110001", label: "A", country: "US", active: true },
      { id: "num_b", phone: "+13051110002", label: "B", country: "US", active: true },
      { id: "num_c", phone: "+13051110003", label: "C", country: "US", active: true },
      { id: "num_inactive", phone: "+13051110099", label: "Inactive", country: "US", active: false },
    ],
    countryRouting: { default: "" },
    lowBalanceThreshold: 10,
    updatedAt: nowIso, updatedBy: "test_seed",
  }, null, 2)
);

fs.writeFileSync(
  RETELL_CONFIG_PATH,
  JSON.stringify({
    apiKey: "sk-retell-test-key-not-real",
    webhookSecret: "", toolSecret: "",
    agentId: "agent_test_dispatch_123",
    fromNumberId: "",
    dailyCap: 50,
    enabled: true,
    rotationIdx: 0,
    whatsappReturn: "+5491100000000",
    updatedAt: nowIso, updatedBy: "test_seed",
  }, null, 2)
);

const { app } = await import("../index.js");

// ── Mock del fetch a Retell ────────────────────────────────────────────
let sentCalls = [];             // { url, payload }
const mockFailIds = new Set();  // leadIds que reciben un 422 de Retell
const mockThrowIds = new Set(); // leadIds cuyo fetch tira una excepción de red

async function mockRetellFetch(url, opts) {
  const payload = JSON.parse(opts.body);
  const leadId = payload?.metadata?.leadId;
  sentCalls.push({ url, payload });
  if (mockThrowIds.has(leadId)) {
    throw new Error("network unreachable (simulado)");
  }
  if (mockFailIds.has(leadId)) {
    return {
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: "from_number is not registered with Retell for this account." }),
    };
  }
  return {
    ok: true,
    status: 201,
    text: async () => JSON.stringify({
      call_id: `call_${leadId}_${Math.random().toString(36).slice(2, 8)}`,
      agent_id: payload.override_agent_id,
      call_status: "registered",
      from_number: payload.from_number,
      to_number: payload.to_number,
      direction: "outbound",
      metadata: payload.metadata,
    }),
  };
}

let adminCookie = "";
let supervisorCookie = "";
let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session="))?.split(";")[0] || "";
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-rd@local.test", "rdpass1234");
  supervisorCookie = await loginCookie("super-rd@local.test", "superpass1234");
  setterCookie = await loginCookie("setter-rd@local.test", "setterpass1234");
  expect(globalThis.__voiceAgent).toBeTruthy();
  globalThis.__voiceAgent._voiceDispatchFetch.impl = mockRetellFetch;
});

afterAll(() => {
  globalThis.__voiceAgent._voiceDispatchFetch.impl = fetch;
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("RBAC", () => {
  it("sin sesión → 401", async () => {
    const r = await request(app).post(DISPATCH_URL).send({ count: 1, dryRun: true });
    expect(r.status).toBe(401);
  });

  it("como setter → 403", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", setterCookie).send({ count: 1, dryRun: true });
    expect(r.status).toBe(403);
  });

  it("como supervisor → 403", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", supervisorCookie).send({ count: 1, dryRun: true });
    expect(r.status).toBe(403);
  });

  it("como admin → 200", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1, dryRun: true });
    expect(r.status).toBe(200);
  });
});

describe("count inválido", () => {
  it("count fuera de rango (0) → 400", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 0, dryRun: true });
    expect(r.status).toBe(400);
  });
  it("count fuera de rango (51) → 400", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 51, dryRun: true });
    expect(r.status).toBe(400);
  });
});

describe("Selección de leads (D-24-03)", () => {
  it("dryRun count:10 devuelve exactamente los 3 elegibles del agente", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10, dryRun: true });
    expect(r.status).toBe(200);
    const ids = r.body.dispatched.map((d) => d.leadId).sort();
    expect(ids).toEqual(["lead_e1", "lead_e2", "lead_e3"]);
    expect(ids).not.toContain("lead_dnc");
    expect(ids).not.toContain("lead_descartado");
    expect(ids).not.toContain("lead_callback_futuro");
    expect(ids).not.toContain("lead_es_fijo");
    expect(ids).not.toContain("lead_dead");
    expect(ids).not.toContain("lead_other_setter");
    expect(ids).not.toContain("lead_precalled");
  });

  it("withDoctor:true devuelve 2 (excluye el que no tiene doctor)", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10, withDoctor: true, dryRun: true });
    expect(r.status).toBe(200);
    const ids = r.body.dispatched.map((d) => d.leadId).sort();
    expect(ids).toEqual(["lead_e1", "lead_e2"]);
  });

  it("country: 'MX' matchea los 3 (prefijo +52)", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10, country: "MX", dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dispatched.length).toBe(3);
  });

  it("country que no matchea ningún prefijo → selección vacía", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10, country: "AR", dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dispatched).toEqual([]);
    expect(r.body.reason).toBeTruthy();
  });

  it("count:2 devuelve 2", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 2, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dispatched.length).toBe(2);
  });
});

describe("Efectos colaterales prohibidos (D-24-05) — antes de cualquier dispatch real", () => {
  it("los dry-run de arriba no tocaron el callLog de ningún lead elegible", () => {
    const lens = callLogLengths(["lead_e1", "lead_e2", "lead_e3"]);
    expect(lens).toEqual({ lead_e1: 0, lead_e2: 0, lead_e3: 0 });
  });
});

// ── Dispatch real #1: sin countryRouting explícito para MX ────────────────
let dispatch1 = null; // { body, calls }

describe("Caller ID (D-24-04) — sin routing explícito", () => {
  it("los 3 leads salen por 3 números distintos (round-robin) y rotationIdx se persiste en el archivo", async () => {
    sentCalls.length = 0;
    const beforeCount = globalThis.__voiceAgent._voiceDispatchedToday.count;
    const dailyCap = globalThis.__voiceAgent.loadRetellConfig().dailyCap;

    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10 });
    expect(r.status).toBe(200);
    expect(r.body.dispatched.length).toBe(3);
    expect(r.body.failed).toEqual([]);
    // calledToday es SIEMPRE 1 (lead_precalled, constante en todo el archivo:
    // el dispatch nunca escribe callLog).
    expect(r.body.capRemaining).toBe(dailyCap - 1 - beforeCount);

    const fromNumbers = r.body.dispatched.map((d) => d.fromNumber);
    expect(new Set(fromNumbers).size).toBe(3);
    expect(fromNumbers.sort()).toEqual(["+13051110001", "+13051110002", "+13051110003"]);

    // rotationIdx: leído del ARCHIVO, no confiar solo en la respuesta.
    const onDisk = readJson(RETELL_CONFIG_PATH);
    expect(onDisk.rotationIdx).toBe(r.body.rotationIdx);

    expect(sentCalls.length).toBe(3);
    dispatch1 = { body: r.body, calls: sentCalls.slice() };
  });

  it("después del dispatch real, el callLog de los 3 leads sigue en 0 (la única escritura la hace el webhook)", () => {
    const lens = callLogLengths(["lead_e1", "lead_e2", "lead_e3"]);
    expect(lens).toEqual({ lead_e1: 0, lead_e2: 0, lead_e3: 0 });
  });
});

describe("Variables dinámicas (research §2.5)", () => {
  it("metadata.leadId === retell_llm_dynamic_variables.leadId en cada llamada disparada", () => {
    expect(dispatch1).toBeTruthy();
    expect(dispatch1.calls.length).toBe(3);
    for (const call of dispatch1.calls) {
      expect(call.payload.metadata.leadId).toBe(call.payload.retell_llm_dynamic_variables.leadId);
    }
  });

  it("todos los valores de retell_llm_dynamic_variables son typeof 'string'", () => {
    for (const call of dispatch1.calls) {
      for (const v of Object.values(call.payload.retell_llm_dynamic_variables)) {
        expect(typeof v).toBe("string");
      }
    }
  });

  it("los valores numéricos (reviews/rating/years) del lead con datos completos llegan como string", () => {
    const call = dispatch1.calls.find((c) => c.payload.metadata.leadId === "lead_e1");
    expect(call).toBeTruthy();
    const vars = call.payload.retell_llm_dynamic_variables;
    expect(vars.reviews).toBe("120");
    expect(vars.rating).toBe("4.8");
    expect(vars.years).toBe("12");
    expect(vars.doctor_name).toBe("Dr. Uno");
    expect(vars.whatsapp).toBe("+5491100000000");
  });
});

describe("Caller ID (D-24-04) — con routing explícito", () => {
  it("con countryRouting.MX seteado, los 3 leads salen por ese número y rotationIdx NO cambia", async () => {
    patchTelnyxConfig({ countryRouting: { default: "", MX: "num_a" } });
    const beforeRotation = readJson(RETELL_CONFIG_PATH).rotationIdx;
    const beforeCount = globalThis.__voiceAgent._voiceDispatchedToday.count;
    const dailyCap = globalThis.__voiceAgent.loadRetellConfig().dailyCap;

    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10 });
    expect(r.status).toBe(200);
    expect(r.body.dispatched.length).toBe(3);
    expect(r.body.dispatched.every((d) => d.fromNumber === "+13051110001")).toBe(true);
    expect(r.body.rotationIdx).toBe(beforeRotation);
    expect(r.body.capRemaining).toBe(dailyCap - 1 - beforeCount);

    const onDisk = readJson(RETELL_CONFIG_PATH);
    expect(onDisk.rotationIdx).toBe(beforeRotation);
  });

  it("un número con active:false nunca se elige, aunque el routing apunte a él (dry run, sin efectos)", async () => {
    const original = readJson(TELNYX_CONFIG_PATH);
    patchTelnyxConfig({ countryRouting: { default: "", MX: "num_inactive" } });
    try {
      const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1, dryRun: true });
      expect(r.status).toBe(200);
      expect(r.body.dispatched.length).toBe(1);
      expect(r.body.dispatched[0].fromNumber).not.toBe("+13051110099");
      expect(["+13051110001", "+13051110002", "+13051110003"]).toContain(r.body.dispatched[0].fromNumber);
    } finally {
      writeJson(TELNYX_CONFIG_PATH, original);
    }
  });
});

describe("Robustez — fallo de Retell por lead (research §2.6)", () => {
  it("con el mock devolviendo 422 para UN lead, ese lead cae en failed y los otros dos en dispatched", async () => {
    mockFailIds.add("lead_e2");
    try {
      const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10 });
      expect(r.status).toBe(200);
      expect(r.body.dispatched.map((d) => d.leadId).sort()).toEqual(["lead_e1", "lead_e3"]);
      expect(r.body.failed.length).toBe(1);
      expect(r.body.failed[0].leadId).toBe("lead_e2");
      expect(r.body.failed[0].error).toMatch(/422|from_number/i);
    } finally {
      mockFailIds.delete("lead_e2");
    }
  });

  it("con el mock tirando una excepción de red para UN lead, mismo comportamiento (falla por lead, el lote sigue)", async () => {
    mockThrowIds.add("lead_e1");
    try {
      const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10 });
      expect(r.status).toBe(200);
      expect(r.body.dispatched.map((d) => d.leadId).sort()).toEqual(["lead_e2", "lead_e3"]);
      expect(r.body.failed.length).toBe(1);
      expect(r.body.failed[0].leadId).toBe("lead_e1");
      expect(r.body.failed[0].error).toBeTruthy();
    } finally {
      mockThrowIds.delete("lead_e1");
    }
  });

  it("dryRun:true no dispara ni un fetch y no mueve rotationIdx", async () => {
    sentCalls.length = 0;
    const before = readJson(RETELL_CONFIG_PATH).rotationIdx;
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10, dryRun: true });
    expect(r.status).toBe(200);
    expect(sentCalls.length).toBe(0);
    const after = readJson(RETELL_CONFIG_PATH).rotationIdx;
    expect(after).toBe(before);
  });

  it("con enabled:false → 409", async () => {
    patchRetellConfig({ enabled: false });
    try {
      const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1, dryRun: true });
      expect(r.status).toBe(409);
    } finally {
      patchRetellConfig({ enabled: true });
    }
  });

  it("sin apiKey → 503", async () => {
    const cfg = readJson(RETELL_CONFIG_PATH);
    patchRetellConfig({ apiKey: "" });
    try {
      const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1, dryRun: true });
      expect(r.status).toBe(503);
    } finally {
      patchRetellConfig({ apiKey: cfg.apiKey });
    }
  });

  it("sin ningún número activo en Telnyx → 409", async () => {
    const original = readJson(TELNYX_CONFIG_PATH);
    const noActive = { ...original, numbers: original.numbers.map((n) => ({ ...n, active: false })) };
    writeJson(TELNYX_CONFIG_PATH, noActive);
    try {
      const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1, dryRun: true });
      expect(r.status).toBe(409);
    } finally {
      writeJson(TELNYX_CONFIG_PATH, original);
    }
  });
});

describe("Correlación _pendingRetellCalls (contrato para 24-05)", () => {
  it("cada llamada exitosa queda correlacionada callId → leadId", async () => {
    sentCalls.length = 0;
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10 });
    expect(r.status).toBe(200);
    expect(r.body.dispatched.length).toBeGreaterThan(0);
    for (const d of r.body.dispatched) {
      const entry = globalThis.__voiceAgent._pendingRetellCalls.get(d.callId);
      expect(entry).toBeTruthy();
      expect(entry.leadId).toBe(d.leadId);
      expect(typeof entry.at).toBe("number");
    }
  });
});

describe("Cap diario", () => {
  it("con dailyCap:2 y una llamada del agente ya en el callLog de hoy, el lote efectivo es 1", async () => {
    patchRetellConfig({ dailyCap: 2 });
    globalThis.__voiceAgent._voiceDispatchRollover();
    globalThis.__voiceAgent._voiceDispatchedToday.count = 0;

    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10 });
    expect(r.status).toBe(200);
    // remaining = dailyCap(2) - calledToday(1, lead_precalled) - dispatchedToday(0) = 1
    expect(r.body.capRemaining).toBe(1);
    expect(r.body.dispatched.length).toBe(1);
  });

  it("con el cap ya consumido → 409 y ni un fetch a Retell", async () => {
    patchRetellConfig({ dailyCap: 2 });
    globalThis.__voiceAgent._voiceDispatchRollover();
    globalThis.__voiceAgent._voiceDispatchedToday.count = 2; // 2 - 1 - 2 = -1 <= 0

    sentCalls.length = 0;
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1 });
    expect(r.status).toBe(409);
    expect(sentCalls.length).toBe(0);
  });

  it("rollover de día: dayKey de AYER con el cap consumido → el dispatch de HOY no devuelve 409", async () => {
    patchRetellConfig({ dailyCap: 2 });
    const yesterday = globalThis.__metricsAudit._bizDayStr(Date.now() - 24 * 60 * 60 * 1000);
    globalThis.__voiceAgent._voiceDispatchedToday.dayKey = yesterday;
    globalThis.__voiceAgent._voiceDispatchedToday.count = 2; // agotado, pero de AYER

    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 1, dryRun: true });
    expect(r.status).not.toBe(409);
    expect(r.status).toBe(200);

    const today = globalThis.__metricsAudit._bizDayStr(Date.now());
    expect(globalThis.__voiceAgent._voiceDispatchedToday.dayKey).toBe(today);

    // Restaurar dailyCap alto para no interferir si se agregan tests después.
    patchRetellConfig({ dailyCap: 50 });
    globalThis.__voiceAgent._voiceDispatchedToday.count = 0;
  });
});

describe("Sin leads elegibles", () => {
  it("filtro que no matchea ningún lead → 200 con dispatched:[] y reason explícito (no es un error)", async () => {
    const r = await request(app).post(DISPATCH_URL).set("Cookie", adminCookie).send({ count: 10, country: "ZZ", dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dispatched).toEqual([]);
    expect(r.body.failed).toEqual([]);
    expect(typeof r.body.reason).toBe("string");
    expect(r.body.reason.length).toBeGreaterThan(0);
  });
});
