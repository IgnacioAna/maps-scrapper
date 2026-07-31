// Plan 24-01 Task 3 — Test de paridad doble-vía: handler humano (HTTP) vs
// helper puro _applyCallOutcome llamado directo. Verifica que la extracción
// (D-24-02) produce EXACTAMENTE los mismos efectos por los dos caminos, sobre
// los 8 outcomes de CALL_OUTCOMES + variantes de DNC/cadencia/calendario.
//
// Diseño: el lead "A" vive en setters.json y se muta vía HTTP (el server
// real, con loadSettersData/saveSettersData). El lead "B" es un objeto JS en
// memoria con el MISMO estado inicial (misma factory baseLeadFields), mutado
// llamando globalThis.__voiceAgent._applyCallOutcome directo — sin pasar por
// disco. Evita depender de la resolución de mtime del filesystem (el
// proyecto corre en Windows: escribir setters.json a mano en paralelo al
// cache mtime-based de loadSettersData es una fuente de flakiness evitable).
// El resultado es equivalente: las dos vías arrancan del mismo estado inicial
// y reciben los mismos `opts`.
//
// Sincronización de nowIso: se toma el lastContactAt que devolvió la vía HTTP
// y se lo pasa como opts.nowIso a la vía directa — así lastContactAt y
// doNotCallAt (ambos derivan del mismo `now` en el handler) coinciden exacto.
//
// Diferencias intencionales EXCLUIDAS de la comparación (documentadas por el
// plan): logEntry.by / logEntry.channel (el handler humano firma con el user
// de sesión y channel:'manual'; el agente firmará by:'' / channel:'retell') —
// no se comparan directamente, solo el LARGO de callLog. callbackAt
// auto-generado por la cadencia usa `new Date(Date.now() + 24h)` (código
// verbatim, sin tocar — D-24-02 prohíbe "mejoras" en el camino) — se compara
// con tolerancia de reloj en vez de igualdad estricta de string para no ser
// flaky por el paso del tiempo real entre las dos llamadas.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `apply-outcome-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-voice@local.test";
process.env.ADMIN_PASSWORD = "voicepass1234";
process.env.JWT_SECRET = "test-secret-voice";
// Regla #121: env vars de IA a "" (nunca delete — dotenv las repone y el test
// termina llamando a la IA real hasta hacer timeout).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

const ADMIN_NAME = "AdminVoice";
const SETTER_ID = "s_x";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

// Estado inicial IDÉNTICO para cada par A/B — regla #163: teléfono ≥7 dígitos
// (si no, _leadIsCallableNow ni siquiera importa acá, pero mantiene el hábito
// correcto), prefijo +521 mexicano (no bloqueado por _expensiveTariffLabel).
function baseLeadFields(idSuffix, phoneSuffix) {
  return {
    num: 1,
    name: `Clinica ${idSuffix}`,
    phone: `+52155500${String(phoneSuffix).padStart(4, "0")}`,
    assignedTo: SETTER_ID,
    conexion: "sin_wsp",
    estado: "sin_contactar",
    respondio: false,
    calificado: false,
    interes: null,
    callbackAt: "",
    callbackShared: false,
    doNotCall: false,
    doNotCallReason: "",
    doNotCallAt: "",
    doNotCallBy: "",
    phoneStatus: "",
    cadenceStep: 0,
    cadenceExhausted: false,
    callAttempts: 0,
    disqualifyReason: "",
    callLog: [],
  };
}

const SCENARIOS = [
  "interested", "not_interested_icp", "not_interested_dnc",
  "no_answer_once", "no_answer_twice", "voicemail",
  "wrong_number", "invalid_number", "callback_later", "scheduled",
];

// Fixture en disco: SOLO los leads "A" (los que toca el handler HTTP). Los
// "B" nunca se persisten — viven en memoria (ver leadsB más abajo).
const leadsA = {};
SCENARIOS.forEach((s, i) => { leadsA[`a_${s}`] = baseLeadFields(`a_${s}`, i + 1); });

fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [{ id: "u", email: "admin-voice@local.test", name: ADMIN_NAME, role: "admin", status: "active", setterId: "", password: pwd("voicepass1234") }],
  invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: SETTER_ID, name: "X" }],
  variants: [],
  leads: leadsA,
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
const { _applyCallOutcome, _estimateTelnyxCost } = globalThis.__voiceAgent;

let cookie = "";
beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-voice@local.test", password: "voicepass1234" });
  cookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

// Leads "B": objetos JS en memoria, mismo estado inicial que su par "A".
const leadsB = {};
SCENARIOS.forEach((s, i) => { leadsB[`b_${s}`] = baseLeadFields(`b_${s}`, i + 1); });
const dataB = { calendar: [] };

// Aplica el outcome a la vez A (HTTP, handler humano) y B (helper directo),
// sincronizando nowIso. Devuelve { r, leadB, result } para asserts puntuales.
async function applyBoth(scenario, body) {
  const idA = `a_${scenario}`;
  const idB = `b_${scenario}`;
  const r = await request(app).post(`/api/setters/leads/${idA}/call-disposition`).set("Cookie", cookie).send(body);
  expect(r.status).toBe(200);

  const nowIso = r.body.lead.lastContactAt;
  // Los escenarios de este test usan solo razones VÁLIDAS de la whitelist
  // (DISQUALIFY_REASONS) — no hace falta replicar el filtrado del handler.
  const cleanReason = body.disqualifyReason || "";
  const leadB = leadsB[idB];
  const logEntryB = { ts: nowIso, outcome: body.outcome, by: "", notes: "" };
  if (cleanReason) logEntryB.disqualifyReason = cleanReason;

  const result = _applyCallOutcome(dataB, leadB, logEntryB, {
    leadId: idB,
    nowIso,
    outcome: body.outcome,
    callbackAt: body.callbackAt,
    callbackShared: body.callbackShared,
    scheduled: body.scheduled,
    cleanReason,
    doNotCall: body.doNotCall,
    actorSetterId: leadB.assignedTo || "",
    actorName: ADMIN_NAME,
  });

  return { r, leadB, result };
}

const COMPARE_FIELDS = [
  "estado", "respondio", "calificado", "interes", "callbackAt", "callbackShared",
  "doNotCall", "doNotCallReason", "doNotCallBy", "phoneStatus", "cadenceStep",
  "cadenceExhausted", "autoDiscarded", "autoDiscardReason", "callAttempts",
  "conexion", "disqualifyReason",
];

// callbackAt auto-generado por la cadencia usa Date.now() real (no
// opts.nowIso) — código verbatim, sin tocar (D-24-02). Tolerancia en vez de
// igualdad estricta para no ser flaky por el reloj real entre las 2 llamadas.
function closeIso(a, b, toleranceMs = 5000) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < toleranceMs;
}

function assertParity(r, leadB, { looseCallbackAt = false } = {}) {
  const leadA = r.body.lead;
  for (const f of COMPARE_FIELDS) {
    if (f === "callbackAt" && looseCallbackAt) {
      expect(closeIso(leadA.callbackAt, leadB.callbackAt), "callbackAt (tolerancia de reloj)").toBe(true);
      continue;
    }
    expect(leadB[f], `campo '${f}'`).toEqual(leadA[f]);
  }
  expect(leadB.callLog.length, "largo de callLog").toBe(leadA.callLog.length);
}

describe("paridad handler humano vs _applyCallOutcome (Task 3, plan 24-01)", () => {
  it("answered_interested — misma cascada por las dos vías", async () => {
    const { r, leadB } = await applyBoth("interested", { outcome: "answered_interested" });
    assertParity(r, leadB);
    expect(leadB.estado).toBe("interesado");
  });

  it("answered_not_interested + no_es_icp — misma cascada por las dos vías", async () => {
    const { r, leadB } = await applyBoth("not_interested_icp", { outcome: "answered_not_interested", disqualifyReason: "no_es_icp" });
    assertParity(r, leadB);
    expect(leadB.disqualifyReason).toBe("no_es_icp");
    expect(leadB.estado).toBe("descartado");
  });

  it("answered_not_interested + no_contactar — dispara DNC en las dos vías", async () => {
    const { r, leadB } = await applyBoth("not_interested_dnc", { outcome: "answered_not_interested", disqualifyReason: "no_contactar" });
    assertParity(r, leadB);
    expect(leadB.doNotCall).toBe(true);
    expect(leadB.doNotCallReason).toBe("no_contactar");
    expect(leadB.doNotCallBy).toBe(ADMIN_NAME);
    expect(leadB.doNotCallAt).toBe(r.body.lead.doNotCallAt);
  });

  it("no_answer una vez — cadencia paso 1 (+24h) en las dos vías", async () => {
    const { r, leadB } = await applyBoth("no_answer_once", { outcome: "no_answer" });
    assertParity(r, leadB, { looseCallbackAt: true });
    expect(leadB.cadenceStep).toBe(1);
    expect(leadB.estado).not.toBe("descartado");
  });

  it("no_answer dos veces seguidas — descarte automático en las dos vías (sin_contacto_2x)", async () => {
    await applyBoth("no_answer_twice", { outcome: "no_answer" });
    const { r, leadB } = await applyBoth("no_answer_twice", { outcome: "no_answer" });
    assertParity(r, leadB);
    expect(leadB.estado).toBe("descartado");
    expect(leadB.cadenceExhausted).toBe(true);
    expect(leadB.autoDiscarded).toBe(true);
    expect(leadB.autoDiscardReason).toBe("sin_contacto_2x");
    expect(r.body.lead.autoDiscardReason).toBe("sin_contacto_2x"); // AMBAS vías
  });

  it("voicemail — phoneStatus + cadencia (voicemail también es no-contacto) en las dos vías", async () => {
    const { r, leadB } = await applyBoth("voicemail", { outcome: "voicemail" });
    assertParity(r, leadB, { looseCallbackAt: true });
    expect(leadB.phoneStatus).toBe("voicemail");
    expect(leadB.cadenceStep).toBe(1);
  });

  it("wrong_number — descarta + flag en las dos vías", async () => {
    const { r, leadB } = await applyBoth("wrong_number", { outcome: "wrong_number" });
    assertParity(r, leadB);
    expect(leadB.phoneStatus).toBe("wrong");
    expect(leadB.estado).toBe("descartado");
  });

  it("invalid_number — descarta + flag en las dos vías", async () => {
    const { r, leadB } = await applyBoth("invalid_number", { outcome: "invalid_number" });
    assertParity(r, leadB);
    expect(leadB.phoneStatus).toBe("invalid");
    expect(leadB.estado).toBe("descartado");
  });

  it("callback_later con fecha explícita + compartido — en las dos vías", async () => {
    const manual = new Date(Date.now() + 5 * 24 * 3600000).toISOString();
    const { r, leadB } = await applyBoth("callback_later", { outcome: "callback_later", callbackAt: manual, callbackShared: true });
    assertParity(r, leadB);
    expect(leadB.callbackAt).toBe(manual);
    expect(leadB.callbackShared).toBe(true);
  });

  it("scheduled_with_admin — shape completo del calendarEntry en las dos vías", async () => {
    const fecha = new Date(Date.now() + 2 * 24 * 3600000).toISOString();
    const { r, leadB, result } = await applyBoth("scheduled", { outcome: "scheduled_with_admin", scheduled: { fecha, nombre: "Dra. Test" } });
    assertParity(r, leadB);
    expect(leadB.estado).toBe("agendado");

    // Shape completo — vía A (HTTP, handler humano)
    expect(r.body.calendarEntry).toMatchObject({
      leadId: "a_scheduled", fecha, nombre: "Dra. Test",
      calendarioEstado: "pendiente", valorProyecto: 0, comision: 0,
      setterId: SETTER_ID, sourceCall: true,
    });
    // Shape completo — vía B (helper directo)
    expect(result.calendarEntry).toMatchObject({
      leadId: "b_scheduled", fecha, nombre: "Dra. Test",
      calendarioEstado: "pendiente", valorProyecto: 0, comision: 0,
      setterId: SETTER_ID, sourceCall: true,
    });
    expect(dataB.calendar).toHaveLength(1);
  });

  it("scheduled_with_admin + skipCalendarCreation:true — side-effects de estado SIN crear cita (D-24-05, §5.4 Opción A, T-24-01-04)", () => {
    const lead = baseLeadFields("skip", 98);
    const data = { calendar: [] };
    const fecha = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
    const logEntry = { ts: new Date().toISOString(), outcome: "scheduled_with_admin", by: "", notes: "" };
    const result = _applyCallOutcome(data, lead, logEntry, {
      leadId: "skip_lead",
      nowIso: new Date().toISOString(),
      outcome: "scheduled_with_admin",
      scheduled: { fecha },
      actorSetterId: SETTER_ID,
      actorName: ADMIN_NAME,
      skipCalendarCreation: true,
    });
    expect(result.calendarEntry).toBeNull();
    expect(data.calendar).toHaveLength(0); // NO se crea una segunda cita (ya la creó /book)
    expect(lead.respondio).toBe(true);
    expect(lead.calificado).toBe(true);
    expect(lead.interes).toBe("si");
    expect(lead.estado).toBe("agendado");
    expect(lead.callLog).toHaveLength(1); // el push del logEntry SÍ ocurre igual
  });

  it("_estimateTelnyxCost es invocable desde fuera del handler (Task 1) y devuelve costo > 0", () => {
    const info = _estimateTelnyxCost("+525550000001", 90);
    expect(info.cost).toBeGreaterThan(0);
    expect(typeof info.country).toBe("string");
    expect(typeof info.tariffKey).toBe("string");
  });
});
