// Regresión de los 2 hallazgos Critical del code review de Phase 24
// (`.planning/phases/24-integracion-backend-retell/24-REVIEW.md`).
//
// CR-01 — Atribución al reasignar. Las llamadas del agente llevan `by: ''`, que
//   es justo el camino por el que `_callSetterId` caía a `lead.assignedTo`. Como
//   `pool-distribute`/`reassign-bulk` conservan el callLog a propósito, mover un
//   lead ya trabajado por el agente a una SDR humana le acreditaba llamadas que
//   nunca marcó — el bug de atribución de CLAUDE.md #134/#139/#149, esta vez
//   agente→humano. Ningún test de la fase lo cazaba porque todos los fixtures
//   dejaban el lead en `setter_agente_ia` de principio a fin.
//
// CR-02 — Doble marcado. `_voiceDispatchInFlight` solo cubre dos requests
//   solapados (segundos), pero la llamada dura minutos y hasta que el webhook no
//   la resuelve el lead sigue con `callLog` vacío → ordena PRIMERO en la próxima
//   selección. Dos despachos seguidos discaban los mismos leads: doble gasto y
//   la clínica atendiendo dos llamadas casi simultáneas del agente.
//
// Regla #121: env vars a "" (nunca `delete`) — dotenv las repuebla desde .env
// al re-cargar el módulo en otro test file del mismo run.
// Regla #163: todos los teléfonos del fixture tienen >= 7 dígitos, o los leads
// no pasan `_leadIsCallableNow` y el test mentiría creyendo que filtró bien.

import { describe, it, beforeAll, afterEach, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-critfix-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cf@local.test";
process.env.ADMIN_PASSWORD = "cfpass1234";
process.env.ADMIN_NAME = "AdminCF";
process.env.JWT_SECRET = "test-secret-cf";
process.env.RETELL_API_KEY = "";
process.env.RETELL_WEBHOOK_SECRET = "";
process.env.RETELL_TOOL_SECRET = "";
process.env.TELNYX_API_KEY = "";
process.env.TELNYX_SIP_USERNAME = "";
process.env.TELNYX_SIP_PASSWORD = "";
process.env.TELNYX_SIP_CONNECTION_ID = "";
process.env.TELNYX_SIGNATURE_PUBLIC_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const SETTERS_PATH = path.join(tmpData, "setters.json");
const nowIso = new Date().toISOString();

function readSetters() { return JSON.parse(fs.readFileSync(SETTERS_PATH, "utf8")); }
function writeSetters(obj) { fs.writeFileSync(SETTERS_PATH, JSON.stringify(obj, null, 2)); }

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_cf", email: "admin-cf@local.test", name: "AdminCF", role: "admin", status: "active", setterId: "", password: pwd("cfpass1234"), createdAt: nowIso, updatedAt: nowIso },
      { id: "user_judith_cf", email: "judith-cf@local.test", name: "JudithCF", role: "setter", status: "active", setterId: "setter_judith_cf", password: pwd("judithpass1234"), createdAt: nowIso, updatedAt: nowIso },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// `lead_agent_worked` es el corazón de CR-01: 2 llamadas hechas POR EL AGENTE,
// con el shape exacto que escribe el webhook (`by:''` + `channel:'retell'` +
// `setterId` estampado). Arranca en la cartera del agente y el test lo reasigna.
// `lead_human_worked` es el control: una llamada humana normal, para probar que
// el fix no cambió la atribución de siempre.
fs.writeFileSync(
  SETTERS_PATH,
  JSON.stringify({
    setters: [
      { id: "setter_agente_ia", name: "Agente IA", activeVariantId: "", createdAt: nowIso },
      { id: "setter_judith_cf", name: "JudithCF", activeVariantId: "", createdAt: nowIso },
    ],
    variants: [],
    leads: {
      lead_agent_worked: {
        num: 1, name: "Clinica Trabajada por el Agente", phone: "+525551110001",
        country: "México", city: "CDMX", assignedTo: "setter_agente_ia",
        estado: "interesado", doctor: "Dr. Uno",
        callLog: [
          { ts: nowIso, outcome: "no_answer", duration: 0, by: "", setterId: "setter_agente_ia", channel: "retell" },
          { ts: nowIso, outcome: "answered_interested", duration: 95, by: "", setterId: "setter_agente_ia", channel: "retell" },
        ],
      },
      lead_human_worked: {
        num: 2, name: "Clinica Trabajada por Judith", phone: "+525551110002",
        country: "México", city: "CDMX", assignedTo: "setter_judith_cf",
        estado: "interesado", doctor: "Dr. Dos",
        callLog: [
          { ts: nowIso, outcome: "answered_interested", duration: 88, by: "user_judith_cf", channel: "telnyx_webrtc" },
        ],
      },
      // Tres leads vírgenes de la cartera del agente, para CR-02.
      lead_v1: { num: 3, name: "Virgen Uno", phone: "+525552220001", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", doctor: "Dr. V1" },
      lead_v2: { num: 4, name: "Virgen Dos", phone: "+525552220002", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", doctor: "Dr. V2" },
      lead_v3: { num: 5, name: "Virgen Tres", phone: "+525552220003", country: "México", assignedTo: "setter_agente_ia", estado: "sin_contactar", doctor: "Dr. V3" },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, lastPages: {} }, null, 2));

const { app } = await import("../index.js");

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session="))?.split(";")[0] || "";
}

async function dialsFor(setterId, cookie) {
  const r = await request(app)
    .get(`/api/setters/cold-call-metrics?setter=${setterId}`)
    .set("Cookie", cookie);
  expect(r.status).toBe(200);
  return r.body.metrics;
}

let adminCookie = "";
let VA = null;

beforeAll(async () => {
  adminCookie = await loginCookie("admin-cf@local.test", "cfpass1234");
  VA = globalThis.__voiceAgent;
  expect(VA).toBeTruthy();
  expect(VA._retellSelectDispatchLeads).toBeTypeOf("function");
  expect(VA._pendingRetellCalls).toBeInstanceOf(Map);
});

afterEach(() => {
  // El Map de llamadas en vuelo es estado de módulo — dejarlo sucio
  // contaminaría los tests siguientes.
  VA._pendingRetellCalls.clear();
});

describe("CR-01 — las llamadas del agente NO se heredan al reasignar el lead", () => {
  it("mientras el lead es del agente, sus llamadas se le atribuyen al agente", async () => {
    const agente = await dialsFor("setter_agente_ia", adminCookie);
    expect(agente.dials).toBe(2);
    expect(agente.connects).toBe(1); // answered_interested cuenta; no_answer no
  });

  it("tras reasignar el lead a una SDR humana, las llamadas SIGUEN siendo del agente", async () => {
    // Reasignación con el mismo efecto que pool-distribute/reassign-bulk:
    // cambia el dueño y CONSERVA el callLog (comportamiento intencional).
    const data = readSetters();
    data.leads.lead_agent_worked.assignedTo = "setter_judith_cf";
    writeSetters(data);

    const judith = await dialsFor("setter_judith_cf", adminCookie);
    const agente = await dialsFor("setter_agente_ia", adminCookie);

    // Judith conserva SOLO su propia llamada, sobre su propio lead.
    expect(judith.dials).toBe(1);
    // Las 2 del agente no se movieron con el lead.
    expect(agente.dials).toBe(2);
    expect(agente.connects).toBe(1);
  });

  it("la atribución humana de siempre no cambió (no hay regresión del criterio #149)", async () => {
    const judith = await dialsFor("setter_judith_cf", adminCookie);
    // La llamada de Judith se atribuye por `by`→userMap, como antes del fix.
    expect(judith.dials).toBe(1);
    expect(judith.connects).toBe(1);
  });

  it("una entry vieja sin `setterId` pero con channel 'retell' también queda con el agente", async () => {
    // Cubre las entries escritas entre el deploy de la fase y este fix.
    const data = readSetters();
    data.leads.lead_agent_worked.callLog.push({
      ts: nowIso, outcome: "no_answer", duration: 0, by: "", channel: "retell", // sin setterId
    });
    writeSetters(data);

    const judith = await dialsFor("setter_judith_cf", adminCookie);
    const agente = await dialsFor("setter_agente_ia", adminCookie);

    expect(agente.dials).toBe(3); // la vieja también cuenta para el agente
    expect(judith.dials).toBe(1); // Judith sigue con la suya sola

    // Restaurar el fixture para no filtrar estado a otros tests del archivo.
    const restore = readSetters();
    restore.leads.lead_agent_worked.callLog.pop();
    restore.leads.lead_agent_worked.assignedTo = "setter_agente_ia";
    writeSetters(restore);
  });
});

describe("CR-02 — el dispatch no vuelve a discar un lead con llamada en vuelo", () => {
  function selectIds(count = 10) {
    const data = readSetters();
    return VA._retellSelectDispatchLeads(data, { count }).map((x) => x.id);
  }

  it("sin llamadas en vuelo, los 3 leads vírgenes son elegibles", () => {
    const ids = selectIds();
    expect(ids).toEqual(expect.arrayContaining(["lead_v1", "lead_v2", "lead_v3"]));
  });

  it("un lead con llamada disparada y sin resolver queda FUERA de la selección", () => {
    VA._pendingRetellCalls.set("call_abc123", { leadId: "lead_v1", at: Date.now() });

    const ids = selectIds();
    expect(ids).not.toContain("lead_v1");
    // Los otros dos siguen disponibles — el guard excluye, no bloquea el lote.
    expect(ids).toEqual(expect.arrayContaining(["lead_v2", "lead_v3"]));
  });

  it("dos despachos consecutivos no eligen el mismo lead (el escenario del hallazgo)", () => {
    // Primer despacho: toma 2 leads y registra sus llamadas como en vuelo.
    const primera = selectIds(2);
    expect(primera).toHaveLength(2);
    for (const id of primera) {
      VA._pendingRetellCalls.set(`call_${id}`, { leadId: id, at: Date.now() });
    }

    // Segundo despacho ANTES de que llegue ningún webhook: el callLog de los
    // 2 primeros sigue vacío, así que sin el guard volverían a salir primeros.
    const segunda = selectIds(2);
    for (const id of primera) expect(segunda).not.toContain(id);
  });

  it("cuando el webhook resuelve la llamada, el lead vuelve a ser elegible", () => {
    VA._pendingRetellCalls.set("call_xyz", { leadId: "lead_v2", at: Date.now() });
    expect(selectIds()).not.toContain("lead_v2");

    VA._pendingRetellCalls.delete("call_xyz"); // lo que hace el webhook al cerrar
    expect(selectIds()).toContain("lead_v2");
  });

  it("una entrada vencida por TTL no bloquea al lead para siempre", () => {
    // 7 horas atrás — más viejo que el TTL de 6h de _voiceCleanPendingRetellCalls.
    VA._pendingRetellCalls.set("call_stale", {
      leadId: "lead_v3",
      at: Date.now() - 7 * 60 * 60 * 1000,
    });

    // La selección limpia el Map antes de filtrar, así que la entrada vencida
    // no debe dejar al lead fuera de circulación.
    expect(selectIds()).toContain("lead_v3");
    expect(VA._pendingRetellCalls.has("call_stale")).toBe(false);
  });
});
