// Tests de _retellProcessCallEvent (Phase 24, plan 24-05, Task 3).
//
// Gate del success criterion 1 del ROADMAP: un webhook call_analyzed firmado
// produce en el lead exactamente la misma huella que deja una llamada
// humana — entry de callLog con transcript, outcome canónico con la cascada
// de _applyCallOutcome, nota de seguimiento, atribución al pseudo-SDR
// (setter_agente_ia), y visibilidad en la biblioteca de Entrenamiento IA +
// el Cold Call Funnel, sin tocar una línea de esas vistas.
//
// El resto de la cobertura: idempotencia por retellCallId (research §5.3),
// los 3 caminos de outcome (disconnect / extraction / fallback), la red de
// seguridad de call_ended sin call_analyzed, y el "blocker fix" del plan —
// skipCalendarCreation deriva SOLO de la marca de /book (_pendingBooked),
// NUNCA de `booked` (que solo decide el outcome). Ese es el test que prueba
// que las dos variables no se colapsaron en una: agendo:true sin /book
// previo tiene que crear la cita igual.
//
// Regla #121: env vars a "" (nunca `delete`). Regla #163: teléfonos ≥7 dígitos.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-webhook-process-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-rwp@local.test";
process.env.ADMIN_PASSWORD = "rwppass1234";
process.env.ADMIN_NAME = "AdminRWP";
process.env.JWT_SECRET = "test-secret-rwp";
process.env.RETELL_API_KEY = "";
process.env.RETELL_WEBHOOK_SECRET = "";
process.env.RETELL_TOOL_SECRET = "";
// Regla #121: "" nunca delete — AI_AVAILABLE=false determinístico, así el
// fallback LLM (_autoDispositionLLM) siempre devuelve null y los casos sin
// señal clara de la extracción caen al último recurso (answered_not_interested
// / outcomeSource:'fallback'), sin depender de una IA real.
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const RETELL_CONFIG_PATH = path.join(tmpData, "retell_config.json");
const SETTERS_PATH = path.join(tmpData, "setters.json");
const WEBHOOK_URL = "/api/retell/webhook";
const BOOK_URL = "/api/retell/tool/book";
const WEBHOOK_SECRET = "retell-process-test-apikey-aa11bb22cc";
const TOOL_SECRET = "retell-process-book-secret-xyz-9988";

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function readLead(leadId) { return readJson(SETTERS_PATH).leads[leadId]; }
function callLogLen(leadId) { return (readLead(leadId).callLog || []).length; }
function calendarLen() { return (readJson(SETTERS_PATH).calendar || []).length; }

function futureIso(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

// 20 leads distintos, uno por escenario — evita interferencia entre tests
// que corren contra el MISMO setters.json compartido (patrón secuencial).
const LEAD_IDS = [
  "lead_success", "lead_dup", "lead_ended_then_analyzed", "lead_no_answer_once",
  "lead_no_answer_twice", "lead_voicemail", "lead_connected_wait", "lead_cb_ok",
  "lead_cb_past", "lead_cb_far", "lead_book_dup", "lead_book_backup",
  "lead_doctor_empty", "lead_doctor_set", "lead_email_invalid", "lead_email_valid",
  "lead_objection", "lead_recep", "lead_no_analysis", "lead_unknown_reason",
  "lead_ignore_event",
];

function buildLeads() {
  const leads = {};
  LEAD_IDS.forEach((id, i) => {
    leads[id] = {
      num: i + 1,
      name: `Clinica ${id}`,
      phone: `+52555${String(1000 + i).padStart(6, "0")}`, // ≥7 dígitos, MX
      country: "México",
      assignedTo: "setter_agente_ia",
      estado: "sin_contactar",
      callLog: [],
      notes: [],
      doctor: id === "lead_doctor_set" ? "Dr. Existente" : "",
      email: "",
      disqualifyReason: "",
    };
  });
  return leads;
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_rwp", email: "admin-rwp@local.test", name: "AdminRWP", role: "admin", status: "active", setterId: "", password: pwd("rwppass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  SETTERS_PATH,
  JSON.stringify({
    setters: [{ id: "setter_agente_ia", name: "Agente IA", activeVariantId: "", createdAt: new Date().toISOString() }],
    variants: [],
    leads: buildLeads(),
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  RETELL_CONFIG_PATH,
  JSON.stringify({
    apiKey: WEBHOOK_SECRET, webhookSecret: "", toolSecret: TOOL_SECRET,
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
  adminCookie = await loginCookie("admin-rwp@local.test", "rwppass1234");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

function signRetellBody(rawBody, secret, timestamp = Date.now()) {
  const digest = crypto.createHmac("sha256", secret).update(rawBody + String(timestamp)).digest("hex");
  return `v=${timestamp},d=${digest}`;
}

let _callSeq = 0;
function nextCallId(prefix) {
  _callSeq++;
  return `call_${prefix}_${Date.now()}_${_callSeq}`;
}

// Manda el webhook firmado y espera (vía globalThis.__voiceAgent, patrón
// preferido por el plan sobre polling) a que el procesamiento fire-and-forget
// termine antes de devolver la respuesta HTTP.
async function postWebhookAndWait(body, opts = {}) {
  const rawBody = JSON.stringify(body);
  const sig = signRetellBody(rawBody, opts.secret || WEBHOOK_SECRET, opts.timestamp);
  const r = await request(app).post(WEBHOOK_URL).set("Content-Type", "application/json").set("x-retell-signature", sig).send(rawBody);
  await globalThis.__voiceAgent._retellGetLastProcessPromise();
  return r;
}

function buildTranscript4() {
  return [
    { role: "agent", content: "Hola, buenos días, le hablo de parte del equipo de reactivación de pacientes.", words: [{ word: "Hola", start: 0, end: 0.4 }, { word: "pacientes.", start: 1.6, end: 2.0 }] },
    { role: "user", content: "Hola, sí, dígame.", words: [{ word: "Hola,", start: 2.5, end: 2.8 }, { word: "dígame.", start: 3.1, end: 3.4 }] },
    { role: "agent", content: "Quería saber si les interesaría mejorar el seguimiento de pacientes inactivos.", words: [{ word: "Quería", start: 3.8, end: 4.1 }, { word: "inactivos.", start: 6.2, end: 6.6 }] },
    { role: "user", content: "Sí, me interesa, cuénteme más.", words: [{ word: "Sí,", start: 7.0, end: 7.2 }, { word: "más.", start: 8.5, end: 8.8 }] },
  ];
}

describe("Success criterion 1 — call_analyzed firmado produce la misma huella que una llamada humana", () => {
  it("callLog con transcript+cascada+nota, visible en Entrenamiento IA y en cold-call-metrics", async () => {
    const leadId = "lead_success";
    const before = callLogLen(leadId);
    const call = {
      call_id: nextCallId("success"),
      agent_id: "agent_v1",
      from_number: "+15551230001",
      to_number: readLead(leadId).phone,
      direction: "outbound",
      disconnection_reason: "user_hangup",
      duration_ms: 125000,
      metadata: { leadId },
      transcript_object: buildTranscript4(),
      call_analysis: {
        call_summary: "Cliente mostró interés, pidió más info.",
        in_voicemail: false,
        user_sentiment: "Positive",
        call_successful: true,
        custom_analysis_data: {
          atendio: true,
          interes: "si",
          nota_seguimiento: "Pidió que le mandemos un mail con más detalles.",
        },
      },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);

    const lead = readLead(leadId);
    expect(lead.callLog.length).toBe(before + 1);
    const entry = lead.callLog[lead.callLog.length - 1];
    expect(entry.channel).toBe("retell");
    expect(entry.by).toBe("");
    expect(entry.duration).toBeGreaterThan(0);
    expect(entry.cost).toBeGreaterThan(0);
    expect(entry.retellCallId).toBe(call.call_id);
    expect(entry.outcome).toBe("answered_interested");
    expect(entry.outcomeSource).toBe("extraction");

    expect(entry.transcript.segments.length).toBe(4);
    expect(entry.transcript.segments.every((s) => ["setter", "lead"].includes(s.speaker))).toBe(true);
    expect(entry.transcript.segments[0].speaker).toBe("setter"); // role:'agent' → 'setter'
    expect(entry.transcript.segments[1].speaker).toBe("lead");   // role:'user' → 'lead'

    expect(lead.estado).toBe("interesado"); // cascada de answered_interested

    const note = lead.notes.find((n) => n.text.includes("mandemos un mail"));
    expect(note).toBeTruthy();
    expect(note.by).toBe("Agente IA");

    // Biblioteca de Entrenamiento IA — D-24-08, sin tocar esa vista.
    const listResp = await request(app).get("/api/training/calls").set("Cookie", adminCookie);
    expect(listResp.status).toBe(200);
    const found = listResp.body.calls.find((c) => c.leadId === leadId);
    expect(found).toBeTruthy();
    expect(found.segCount).toBe(4);
    const callIdx = lead.callLog.length - 1;
    const detailResp = await request(app).get(`/api/training/calls/${leadId}/${callIdx}`).set("Cookie", adminCookie);
    expect(detailResp.status).toBe(200);
    expect(detailResp.body.segments.length).toBeGreaterThan(0);

    // Atribución D-24-07 — cae sola a setter_agente_ia, sin código de métricas nuevo.
    const metricsResp = await request(app).get("/api/setters/cold-call-metrics?setter=setter_agente_ia").set("Cookie", adminCookie);
    expect(metricsResp.status).toBe(200);
    expect(metricsResp.body.metrics.dials).toBeGreaterThanOrEqual(1);
    expect(metricsResp.body.metrics.connects).toBeGreaterThanOrEqual(1);
  });
});

describe("Idempotencia (research §5.3 — 3 reintentos, 10s timeout)", () => {
  it("el MISMO call_analyzed mandado dos veces deja UNA sola entry", async () => {
    const leadId = "lead_dup";
    const call = {
      call_id: nextCallId("dup"),
      from_number: "+15551230002",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 30000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { interes: "no" } },
    };
    const body = { event: "call_analyzed", call };
    const r1 = await postWebhookAndWait(body);
    expect(r1.status).toBe(200);
    expect(callLogLen(leadId)).toBe(1);

    const r2 = await postWebhookAndWait(body);
    expect(r2.status).toBe(200);
    expect(callLogLen(leadId)).toBe(1); // sigue en 1, no se duplicó
  });

  it("call_ended (no conectó) + call_analyzed tardío del mismo call_id deja UNA sola entry", async () => {
    const leadId = "lead_ended_then_analyzed";
    const callId = nextCallId("ended-late");
    const endedCall = {
      call_id: callId,
      from_number: "+15551230003",
      to_number: readLead(leadId).phone,
      disconnection_reason: "dial_no_answer",
      duration_ms: 0,
      metadata: { leadId },
    };
    const r1 = await postWebhookAndWait({ event: "call_ended", call: endedCall });
    expect(r1.status).toBe(200);
    expect(callLogLen(leadId)).toBe(1); // call_ended con no-conexión resuelve solo

    // call_analyzed tardío, mismo call_id — llega después con más data.
    const analyzedCall = { ...endedCall, call_analysis: { custom_analysis_data: { interes: "si" } } };
    const r2 = await postWebhookAndWait({ event: "call_analyzed", call: analyzedCall });
    expect(r2.status).toBe(200);
    expect(callLogLen(leadId)).toBe(1); // sigue en 1 — idempotencia por retellCallId
  });
});

describe("Los tres caminos de outcome (D-24-05)", () => {
  it("call_ended dial_no_answer resuelve de inmediato como no_answer + arranca la cadencia", async () => {
    const leadId = "lead_no_answer_once";
    const call = {
      call_id: nextCallId("noans1"),
      from_number: "+15551230004",
      to_number: readLead(leadId).phone,
      disconnection_reason: "dial_no_answer",
      duration_ms: 0,
      metadata: { leadId },
    };
    const r = await postWebhookAndWait({ event: "call_ended", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog.length).toBe(1);
    expect(lead.callLog[0].outcome).toBe("no_answer");
    expect(lead.callLog[0].outcomeSource).toBe("disconnect");
    expect(lead.cadenceStep).toBe(1);
    expect(lead.callbackAt).toBeTruthy();
    const hoursAhead = (new Date(lead.callbackAt).getTime() - Date.now()) / 3600000;
    expect(hoursAhead).toBeGreaterThan(20);
    expect(hoursAhead).toBeLessThan(28);
  });

  it("dos dial_no_answer seguidos → descarte automático sin_contacto_2x", async () => {
    const leadId = "lead_no_answer_twice";
    for (let i = 0; i < 2; i++) {
      const call = {
        call_id: nextCallId(`noans2-${i}`),
        from_number: "+15551230005",
        to_number: readLead(leadId).phone,
        disconnection_reason: "dial_no_answer",
        duration_ms: 0,
        metadata: { leadId },
      };
      const r = await postWebhookAndWait({ event: "call_ended", call });
      expect(r.status).toBe(200);
    }
    const lead = readLead(leadId);
    expect(lead.callLog.length).toBe(2);
    expect(lead.estado).toBe("descartado");
    expect(lead.autoDiscardReason).toBe("sin_contacto_2x");
    expect(lead.cadenceExhausted).toBe(true);
  });

  it("call_ended voicemail_reached → outcome voicemail + phoneStatus", async () => {
    const leadId = "lead_voicemail";
    const call = {
      call_id: nextCallId("vm"),
      from_number: "+15551230006",
      to_number: readLead(leadId).phone,
      disconnection_reason: "voicemail_reached",
      duration_ms: 8000,
      metadata: { leadId },
    };
    const r = await postWebhookAndWait({ event: "call_ended", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog[0].outcome).toBe("voicemail");
    expect(lead.phoneStatus).toBe("voicemail");
  });

  it("call_ended user_hangup (conectó) NO escribe todavía — la red de seguridad resuelve a los 10 min", async () => {
    const leadId = "lead_connected_wait";
    const call = {
      call_id: nextCallId("connwait"),
      from_number: "+15551230007",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 15000,
      metadata: { leadId },
      transcript_object: [{ role: "user", content: "hola", words: [{ word: "hola", start: 0, end: 0.3 }] }],
    };
    const r = await postWebhookAndWait({ event: "call_ended", call });
    expect(r.status).toBe(200);
    expect(callLogLen(leadId)).toBe(0); // todavía esperando call_analyzed
    expect(globalThis.__voiceAgent._retellAwaitingAnalysis.has(call.call_id)).toBe(true);

    // Reloj adelantado 11 minutos — la red de seguridad resuelve con lo que
    // trajo call_ended (sin esperar más).
    await globalThis.__voiceAgent._retellSweepAwaitingAnalysis(Date.now() + 11 * 60 * 1000);
    expect(callLogLen(leadId)).toBe(1);
    expect(globalThis.__voiceAgent._retellAwaitingAnalysis.has(call.call_id)).toBe(false);
  });

  it("callback_fecha_hora a 3 días → callback_later con lead.callbackAt en esa fecha", async () => {
    const leadId = "lead_cb_ok";
    const target = futureIso(3);
    const call = {
      call_id: nextCallId("cbok"),
      from_number: "+15551230008",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { callback_fecha_hora: target } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog[0].outcome).toBe("callback_later");
    expect(lead.callLog[0].outcomeSource).toBe("extraction");
    expect(new Date(lead.callbackAt).getTime()).toBeCloseTo(new Date(target).getTime(), -3);
  });

  it("callback_fecha_hora en el pasado → NO se usa, cae al camino siguiente", async () => {
    const leadId = "lead_cb_past";
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const call = {
      call_id: nextCallId("cbpast"),
      from_number: "+15551230009",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { callback_fecha_hora: pastDate } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog[0].outcome).not.toBe("callback_later");
    expect(lead.callLog[0].outcomeSource).toBe("fallback"); // sin IA disponible
    expect(lead.callbackAt).toBe("");
  });

  it("callback_fecha_hora a 200 días → NO se usa (fuera del rango ≤90 días)", async () => {
    const leadId = "lead_cb_far";
    const farDate = futureIso(200);
    const call = {
      call_id: nextCallId("cbfar"),
      from_number: "+15551230010",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { callback_fecha_hora: farDate } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog[0].outcome).not.toBe("callback_later");
    expect(lead.callbackAt).toBe("");
  });
});

describe("Booking — la prueba de que no se duplica la cita (D-24-05)", () => {
  it("/book crea la cita, call_analyzed del mismo call_id NO la duplica", async () => {
    const leadId = "lead_book_dup";
    const callId = nextCallId("bookdup");
    const beforeCal = calendarLen();

    const bookResp = await request(app).post(BOOK_URL).set("x-scm-tool-secret", TOOL_SECRET).send({
      call: { call_id: callId, retell_llm_dynamic_variables: { leadId } },
      args: { fecha: futureIso(5) },
    });
    expect(bookResp.status).toBe(200);
    expect(bookResp.body.ok).toBe(true);
    expect(calendarLen()).toBe(beforeCal + 1);

    const call = {
      call_id: callId,
      from_number: "+15551230011",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 40000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { agendo: true } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);

    const lead = readLead(leadId);
    expect(lead.estado).toBe("agendado");
    expect(calendarLen()).toBe(beforeCal + 1); // NO se duplicó
    expect(lead.callLog.length).toBe(1);
    expect(lead.callLog[0].outcome).toBe("scheduled_with_admin");
  });

  it("agendo:true SIN /book previo → crea la cita igual (camino de respaldo, el blocker fix)", async () => {
    const leadId = "lead_book_backup";
    const beforeCal = calendarLen();
    const call = {
      call_id: nextCallId("bookbackup"),
      from_number: "+15551230012",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 40000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { agendo: true } },
    };
    // Ojo: NO se llamó a /book para este call_id — _pendingBooked no tiene
    // entrada. Si skipCalendarCreation derivara de `booked` (el bug que este
    // plan corrige) el lead quedaría 'agendado' con calendar sin crecer.
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.estado).toBe("agendado");
    expect(calendarLen()).toBe(beforeCal + 1); // SÍ se creó — el camino de respaldo
  });
});

describe("Extracción persistida (D-24-05)", () => {
  it("doctor_name se escribe si lead.doctor estaba vacío", async () => {
    const leadId = "lead_doctor_empty";
    const call = {
      call_id: nextCallId("doc1"),
      from_number: "+15551230013",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { interes: "si", doctor_name: "Dr. Nuevo Uno" } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    expect(readLead(leadId).doctor).toBe("Dr. Nuevo Uno");
  });

  it("doctor_name NO pisa un lead.doctor ya cargado", async () => {
    const leadId = "lead_doctor_set";
    expect(readLead(leadId).doctor).toBe("Dr. Existente");
    const call = {
      call_id: nextCallId("doc2"),
      from_number: "+15551230014",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { interes: "si", doctor_name: "Dr. Intentando Pisar" } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    expect(readLead(leadId).doctor).toBe("Dr. Existente");
  });

  it("email con formato inválido no se persiste; uno válido sí", async () => {
    const leadIdBad = "lead_email_invalid";
    const callBad = {
      call_id: nextCallId("emailbad"),
      from_number: "+15551230015",
      to_number: readLead(leadIdBad).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId: leadIdBad },
      call_analysis: { custom_analysis_data: { interes: "si", email: "no-es-un-email" } },
    };
    const rBad = await postWebhookAndWait({ event: "call_analyzed", call: callBad });
    expect(rBad.status).toBe(200);
    expect(readLead(leadIdBad).email).toBe("");

    const leadIdOk = "lead_email_valid";
    const callOk = {
      call_id: nextCallId("emailok"),
      from_number: "+15551230016",
      to_number: readLead(leadIdOk).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId: leadIdOk },
      call_analysis: { custom_analysis_data: { interes: "si", email: "clinica.prueba@example.com" } },
    };
    const rOk = await postWebhookAndWait({ event: "call_analyzed", call: callOk });
    expect(rOk.status).toBe(200);
    expect(readLead(leadIdOk).email).toBe("clinica.prueba@example.com");
  });

  it("objecion_principal fuera de DISQUALIFY_REASONS → retellObjection en el logEntry, disqualifyReason NO se ensucia", async () => {
    const leadId = "lead_objection";
    const call = {
      call_id: nextCallId("obj"),
      from_number: "+15551230017",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { interes: "no", objecion_principal: "el dueño está de viaje" } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog[0].retellObjection).toBe("el dueño está de viaje");
    expect(lead.disqualifyReason).toBe(""); // no se forzó un valor de la whitelist
  });

  it("recepcionista_nombre agrega una nota adicional firmada 'Agente IA'", async () => {
    const leadId = "lead_recep";
    const call = {
      call_id: nextCallId("recep"),
      from_number: "+15551230018",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      call_analysis: { custom_analysis_data: { interes: "si", recepcionista_nombre: "Marta" } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    const note = lead.notes.find((n) => n.text.includes("Marta"));
    expect(note).toBeTruthy();
    expect(note.by).toBe("Agente IA");
  });
});

describe("Robustez", () => {
  it("evento sin leadId resoluble → no rompe, no escribe, el webhook igual devolvió 200", async () => {
    const call = {
      call_id: nextCallId("noleadid"),
      from_number: "+15551239999",
      to_number: "+525559999999",
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      // sin metadata.leadId ni retell_llm_dynamic_variables.leadId
      call_analysis: { custom_analysis_data: { interes: "si" } },
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    // Ningún lead del fixture debió tocarse por este evento.
    const all = readJson(SETTERS_PATH).leads;
    for (const id of LEAD_IDS) {
      const log = all[id].callLog || [];
      expect(log.some((e) => e.retellCallId === call.call_id)).toBe(false);
    }
  });

  it("call_analyzed con call_analysis ausente → no rompe, cae al fallback", async () => {
    const leadId = "lead_no_analysis";
    const call = {
      call_id: nextCallId("noanalysis"),
      from_number: "+15551230019",
      to_number: readLead(leadId).phone,
      disconnection_reason: "user_hangup",
      duration_ms: 20000,
      metadata: { leadId },
      // sin call_analysis
    };
    const r = await postWebhookAndWait({ event: "call_analyzed", call });
    expect(r.status).toBe(200);
    const lead = readLead(leadId);
    expect(lead.callLog.length).toBe(1);
    expect(lead.callLog[0].outcomeSource).toBe("fallback");
  });

  it("disconnection_reason desconocido → no rompe, no dispara la cadencia por su cuenta, resuelve por la red de seguridad", async () => {
    const leadId = "lead_unknown_reason";
    const call = {
      call_id: nextCallId("unknownreason"),
      from_number: "+15551230020",
      to_number: readLead(leadId).phone,
      disconnection_reason: "a_totally_new_reason_v2_not_in_catalog",
      duration_ms: 5000,
      metadata: { leadId },
    };
    const r = await postWebhookAndWait({ event: "call_ended", call });
    expect(r.status).toBe(200);
    expect(callLogLen(leadId)).toBe(0); // reason desconocido no es "no conexión" → espera análisis

    await globalThis.__voiceAgent._retellSweepAwaitingAnalysis(Date.now() + 11 * 60 * 1000);
    const lead = readLead(leadId);
    expect(lead.callLog.length).toBe(1);
    expect(lead.callLog[0].disconnectionReason).toBe("a_totally_new_reason_v2_not_in_catalog");
    expect(lead.cadenceStep).toBe(0); // el outcome final no es no_answer/voicemail
  });

  it("call_started / transcript_updated → se ignoran (no escriben callLog) aunque queden en el log de eventos", async () => {
    const leadId = "lead_ignore_event";
    const callId = nextCallId("ignoreevt");
    const call = {
      call_id: callId,
      from_number: "+15551230021",
      to_number: readLead(leadId).phone,
      metadata: { leadId },
    };
    const r1 = await postWebhookAndWait({ event: "call_started", call });
    expect(r1.status).toBe(200);
    const r2 = await postWebhookAndWait({ event: "transcript_updated", call: { ...call, transcript_object: [] } });
    expect(r2.status).toBe(200);
    expect(callLogLen(leadId)).toBe(0);

    const events = readJson(path.join(tmpData, "retell_events.json")).events;
    expect(events.some((e) => e.callId === callId && e.type === "call_started")).toBe(true);
    expect(events.some((e) => e.callId === callId && e.type === "transcript_updated")).toBe(true);
  });
});

describe("Helpers puros — Task 1 (unit, sin HTTP)", () => {
  it("RETELL_DISCONNECT_OUTCOME cubre las 34 claves del catálogo del research, cada una mapeada a voicemail/no_answer/hung_up/null", () => {
    const table = globalThis.__voiceAgent.RETELL_DISCONNECT_OUTCOME;
    const catalog = [
      "user_hangup", "agent_hangup", "call_transfer", "voicemail_reached", "ivr_reached",
      "inactivity", "max_duration_reached", "concurrency_limit_reached", "no_concurrency_fallback",
      "no_valid_payment", "scam_detected", "dial_busy", "dial_failed", "dial_no_answer",
      "invalid_destination", "telephony_provider_permission_denied", "telephony_provider_unavailable",
      "sip_routing_error", "marked_as_spam", "user_declined", "error_llm_websocket_open",
      "error_llm_websocket_lost_connection", "error_llm_websocket_runtime", "error_llm_websocket_corrupt_payload",
      "error_no_audio_received", "error_asr", "error_retell", "error_unknown", "error_user_not_joined",
      "registered_call_timeout", "transfer_bridged", "transfer_cancelled", "manual_stopped", "call_take_over",
    ];
    expect(Object.keys(table).length).toBe(34);
    expect(catalog.length).toBe(34);
    for (const key of catalog) {
      expect(Object.prototype.hasOwnProperty.call(table, key)).toBe(true);
      expect(["voicemail", "no_answer", "hung_up", null]).toContain(table[key]);
    }
  });

  it("_retellTranscriptToSegments mapea agent→setter / user→lead, deriva start/end de words[], descarta turnos sin texto", () => {
    const fn = globalThis.__voiceAgent._retellTranscriptToSegments;
    const segs = fn({
      transcript_object: [
        { role: "agent", content: "Hola", words: [{ word: "Hola", start: 0, end: 0.3 }, { word: "final", start: 1, end: 1.5 }] },
        { role: "user", content: "  ", words: [] }, // sin texto → descartado
        { role: "user", content: "Sí", words: [{ word: "Sí", start: 2, end: 2.2 }] },
      ],
    });
    expect(segs.length).toBe(2);
    expect(segs[0]).toMatchObject({ speaker: "setter", start: 0, end: 1.5, text: "Hola" });
    expect(segs[1]).toMatchObject({ speaker: "lead", start: 2, end: 2.2, text: "Sí" });
  });

  it("_retellTranscriptToSegments devuelve [] cuando no hay transcript_object (aunque haya transcript plano)", () => {
    const fn = globalThis.__voiceAgent._retellTranscriptToSegments;
    expect(fn({ transcript: "Agent: hola. User: hola." })).toEqual([]);
    expect(fn({})).toEqual([]);
  });

  it("_retellParseCallbackAt: '' para pasado/no-parseable/>90 días, ISO para futuro válido", () => {
    const fn = globalThis.__voiceAgent._retellParseCallbackAt;
    const now = Date.now();
    expect(fn("no es una fecha", now)).toBe("");
    expect(fn(new Date(now - 1000).toISOString(), now)).toBe("");
    expect(fn(new Date(now + 200 * 86400000).toISOString(), now)).toBe("");
    const okDate = new Date(now + 3 * 86400000).toISOString();
    expect(fn(okDate, now)).toBe(new Date(okDate).toISOString());
  });

  it("_retellDecideOutcome: booked=true gana siempre, independientemente de disconnection_reason/extracción", () => {
    const fn = globalThis.__voiceAgent._retellDecideOutcome;
    const decision = fn({
      call: { disconnection_reason: "dial_no_answer" }, // debería mapear a no_answer si no fuera por booked
      extraction: { interes: "no" },
      booked: true,
      segments: [],
    });
    expect(decision.outcome).toBe("scheduled_with_admin");
    expect(decision.source).toBe("book");
  });

  it("_retellDecideOutcome: sin booked, un disconnection_reason mapeado gana sobre la extracción", () => {
    const fn = globalThis.__voiceAgent._retellDecideOutcome;
    const decision = fn({
      call: { disconnection_reason: "dial_busy" },
      extraction: { interes: "si" }, // no debería importar, dial_busy nunca conectó
      booked: false,
      segments: [],
    });
    expect(decision.outcome).toBe("no_answer");
    expect(decision.source).toBe("disconnect");
  });
});
