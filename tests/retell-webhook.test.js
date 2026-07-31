// Tests de POST /api/retell/webhook (Phase 24, plan 24-04, Task 2/3).
//
// Cobertura: SOLO la superficie de autenticación y persistencia de eventos
// (el procesamiento de la llamada — mapear outcome, aplicar la cascada de
// disposición — lo testea el plan 24-05). Firma válida/inválida/expirada/
// malformada, body alterado, fail-closed en producción sin secret, health
// en GET /api/retell/config, FIFO 1000, y no-leak del transcript/grabación.
//
// Regla #121: env vars a "" (nunca `delete`) para que dotenv no las
// repueble desde .env al re-cargar el módulo en otro test file del mismo
// run.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-webhook-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rw@local.test";
process.env.ADMIN_PASSWORD = "rwpass1234";
process.env.ADMIN_NAME = "AdminRW";
process.env.JWT_SECRET = "test-secret-rw";
process.env.RETELL_API_KEY = "";
process.env.RETELL_WEBHOOK_SECRET = "";
process.env.RETELL_TOOL_SECRET = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const RETELL_CONFIG_PATH = path.join(tmpData, "retell_config.json");
const RETELL_EVENTS_PATH = path.join(tmpData, "retell_events.json");
const WEBHOOK_URL = "/api/retell/webhook";
// Usado como apiKey en el fixture — sin webhookSecret explícito, el fallback
// de 24-02 hace que este mismo valor sea el secret efectivo del webhook
// (research §2.1: Retell firma con el API key, no con un signing secret
// aparte).
const WEBHOOK_SECRET = "retell-webhook-test-apikey-000111222";

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function readEvents() { return readJson(RETELL_EVENTS_PATH); }

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_rw", email: "admin-rw@local.test", name: "AdminRW", role: "admin", status: "active", setterId: "", password: pwd("rwpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_agente_ia", name: "Agente IA", activeVariantId: "", createdAt: new Date().toISOString() }],
    variants: [],
    leads: {},
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  RETELL_CONFIG_PATH,
  JSON.stringify({
    apiKey: WEBHOOK_SECRET, webhookSecret: "", toolSecret: "book-secret-unused-here",
    agentId: "", fromNumberId: "", dailyCap: 50, enabled: true, rotationIdx: 0, whatsappReturn: "",
    updatedAt: new Date().toISOString(), updatedBy: "test_seed",
  }, null, 2)
);

const { app } = await import("../index.js");

let adminCookie = "";
async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session="))?.split(";")[0] || "";
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-rw@local.test", "rwpass1234");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

// Helper de firma — misma fórmula que retell-sdk@5.53.0 (research §2.1 /
// §4), sin depender del paquete: HMAC-SHA256(rawBody + timestamp) con el
// secret, formato v=<ms>,d=<hex>.
function signRetellBody(rawBody, secret, timestamp = Date.now()) {
  const digest = crypto.createHmac("sha256", secret).update(rawBody + String(timestamp)).digest("hex");
  return `v=${timestamp},d=${digest}`;
}

let _callSeq = 0;
function sampleCallBody(overrides = {}) {
  _callSeq++;
  const call = {
    call_id: `call_${Date.now()}_${_callSeq}`,
    agent_id: "agent_test_1",
    call_status: "ended",
    from_number: "+15551234567",
    to_number: "+525550009001",
    direction: "outbound",
    disconnection_reason: "user_hangup",
    metadata: { leadId: "lead_test_1" },
    ...(overrides.call || {}),
  };
  return JSON.stringify({ event: overrides.event || "call_ended", call });
}

async function postSigned(rawBody, secret = WEBHOOK_SECRET, timestamp) {
  const sig = signRetellBody(rawBody, secret, timestamp);
  return request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").set("x-retell-signature", sig).send(rawBody);
}

describe("POST /api/retell/webhook — firma válida", () => {
  it("firma válida → 200 y el evento queda en retell_events.json con verified:true", async () => {
    const rawBody = sampleCallBody();
    const r = await postSigned(rawBody);
    expect(r.status).toBe(200);
    const events = readEvents().events;
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.verified).toBe(true);
    expect(last.leadId).toBe("lead_test_1");
    expect(last.type).toBe("call_ended");
  });

  it("sin webhookSecret explícito, la firma hecha con el apiKey es aceptada (fallback research §2.1)", async () => {
    const cfg = readJson(RETELL_CONFIG_PATH);
    expect(cfg.webhookSecret).toBe("");
    const rawBody = sampleCallBody();
    const r = await postSigned(rawBody, WEBHOOK_SECRET);
    expect(r.status).toBe(200);
  });
});

describe("POST /api/retell/webhook — rechazos de firma (401)", () => {
  it("sin header x-retell-signature → 401 y ningún evento persistido", async () => {
    const before = readEvents().events.length;
    const rawBody = sampleCallBody();
    const r = await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").send(rawBody);
    expect(r.status).toBe(401);
    expect(readEvents().events.length).toBe(before);
  });

  it("firma con un secret distinto → 401", async () => {
    const rawBody = sampleCallBody();
    const r = await postSigned(rawBody, "un-secret-completamente-distinto");
    expect(r.status).toBe(401);
  });

  it.each(["abc", "v=x,d=y", "v=123"])("formato malformado (%s) → 401 con reason != invalid_signature", async (bad) => {
    const rawBody = sampleCallBody();
    const r = await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").set("x-retell-signature", bad).send(rawBody);
    expect(r.status).toBe(401);
    expect(r.body.reason).not.toBe("invalid_signature");
  });

  it("timestamp de hace 10 minutos, firmado correctamente → 401 por ventana anti-replay", async () => {
    const rawBody = sampleCallBody();
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const r = await postSigned(rawBody, WEBHOOK_SECRET, tenMinAgo);
    expect(r.status).toBe(401);
    expect(r.body.reason).toBe("timestamp_outside_window");
  });

  it("timestamp de hace 1 minuto → 200 (dentro de la ventana)", async () => {
    const rawBody = sampleCallBody();
    const oneMinAgo = Date.now() - 60 * 1000;
    const r = await postSigned(rawBody, WEBHOOK_SECRET, oneMinAgo);
    expect(r.status).toBe(200);
  });

  it("body alterado después de firmar (un byte distinto) → 401", async () => {
    const rawBody = sampleCallBody();
    const sig = signRetellBody(rawBody, WEBHOOK_SECRET);
    const tampered = rawBody.replace('"user_hangup"', '"agent_hangup"');
    expect(tampered).not.toBe(rawBody);
    const r = await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").set("x-retell-signature", sig).send(tampered);
    expect(r.status).toBe(401);
  });
});

describe("POST /api/retell/webhook — fail-closed en producción sin secret", () => {
  it("NODE_ENV=production sin apiKey/webhookSecret → 503; fuera de producción, 200 con warning", async () => {
    const cfg = readJson(RETELL_CONFIG_PATH);
    const original = { apiKey: cfg.apiKey, webhookSecret: cfg.webhookSecret };
    cfg.apiKey = "";
    cfg.webhookSecret = "";
    writeJson(RETELL_CONFIG_PATH, cfg);

    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const rawBody1 = sampleCallBody();
      const r1 = await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").send(rawBody1);
      expect(r1.status).toBe(503);

      process.env.NODE_ENV = "test";
      const rawBody2 = sampleCallBody();
      const r2 = await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").send(rawBody2);
      expect(r2.status).toBe(200);
    } finally {
      process.env.NODE_ENV = prevEnv;
      cfg.apiKey = original.apiKey;
      cfg.webhookSecret = original.webhookSecret;
      writeJson(RETELL_CONFIG_PATH, cfg);
    }
  });
});

describe("Health en GET /api/retell/config (poblada por este plan, no redeclarada)", () => {
  it("el contador de rechazos sube tras varios 401", async () => {
    const before = (await request(app).get("/api/retell/config").set("Cookie", adminCookie)).body.webhook.rejects;
    const rawBody = sampleCallBody();
    await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").send(rawBody); // sin firma → 401
    const after = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(after.body.webhook.rejects).toBeGreaterThan(before);
    expect(after.body.webhook.lastReject).toBeTruthy();
  });

  it("tras un evento con firma válida, eventCount >= 1 y lastEventAt no nulo", async () => {
    const rawBody = sampleCallBody();
    const r = await postSigned(rawBody);
    expect(r.status).toBe(200);
    const cfgResp = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(cfgResp.body.webhook.eventCount).toBeGreaterThanOrEqual(1);
    expect(cfgResp.body.webhook.lastEventAt).toBeTruthy();
  });
});

describe("No-leak: transcript y grabación NO quedan en disco", () => {
  it("transcript/transcript_object/recording_url/public_log_url/call_summary no aparecen en disco; custom_analysis_data sí", async () => {
    const secretPhrase = "LA CLINICA DENTAL SECRETA DE PRUEBA XYZ987 dijo el prospecto";
    const recordingUrl = "https://storage.retellai.com/recordings/super-secret-file-abc123.wav";
    const logUrl = "https://dashboard.retellai.com/logs/should-not-leak-either";
    const call = {
      call_id: `call_leak_${Date.now()}`,
      agent_id: "agent_test_1",
      from_number: "+15551234567",
      to_number: "+525550009002",
      direction: "outbound",
      disconnection_reason: "user_hangup",
      metadata: { leadId: "lead_test_leak" },
      transcript: `Agent: Hola. User: ${secretPhrase}`,
      transcript_object: [{ role: "user", content: secretPhrase, words: [] }],
      transcript_with_tool_calls: [{ role: "user", content: secretPhrase }],
      recording_url: recordingUrl,
      public_log_url: logUrl,
      call_analysis: {
        call_summary: `Resumen que menciona: ${secretPhrase}`,
        custom_analysis_data: { interes: "si", doctor_name: "Dr. Prueba No Secreto" },
        user_sentiment: "Positive",
        call_successful: true,
      },
    };
    const rawBody = JSON.stringify({ event: "call_analyzed", call });
    const r = await postSigned(rawBody);
    expect(r.status).toBe(200);

    const onDisk = fs.readFileSync(RETELL_EVENTS_PATH, "utf8");
    expect(onDisk).not.toContain(secretPhrase);
    expect(onDisk).not.toContain(recordingUrl);
    expect(onDisk).not.toContain(logUrl);
    expect(onDisk).toContain("custom_analysis_data");
    expect(onDisk).toContain("Dr. Prueba No Secreto");
  });
});

describe("FIFO cap 1000", () => {
  it("con el archivo forzado a 1000 entradas, 5 eventos nuevos lo mantienen en 1000", async () => {
    const events = readEvents();
    const filler = [];
    for (let i = 0; i < 1000; i++) {
      filler.push({
        id: `filler_${i}`, type: "call_ended", receivedAt: new Date().toISOString(), verified: true,
        callId: `filler_call_${i}`, agentId: null, fromNumber: null, toNumber: null, direction: null,
        disconnectionReason: null, durationMs: null, leadId: null, raw: "{}",
      });
    }
    events.events = filler;
    writeJson(RETELL_EVENTS_PATH, events);

    for (let i = 0; i < 5; i++) {
      const rawBody = sampleCallBody();
      const r = await postSigned(rawBody);
      expect(r.status).toBe(200);
    }
    const after = readEvents();
    expect(after.events.length).toBe(1000);
    // Las últimas 5 son las nuevas (FIFO — se descartan las más viejas).
    const lastFive = after.events.slice(-5);
    expect(lastFive.every((e) => !e.id.startsWith("filler_"))).toBe(true);
  });
});
