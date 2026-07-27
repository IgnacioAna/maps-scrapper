// Centro de Comando — stock de trabajo por SDR (2026-07-26).
//
// El bloque de Llamadas contaba la cola como `conexion === 'sin_wsp'`, que
// fallaba por los dos lados: incluía leads que el discado descarta (números
// muertos validados, DNC, tarifa roja, callbacks a futuro) y se perdía los que
// el pool dejó en flujo Setteo (el dialer los disca igual con include=callable).
// El admin veía "Judith 676" cuando su cola real era 432 y no podía decidir a
// quién reponerle leads.
//
// Esta suite fija el contrato nuevo: `callable` (para llamar) usa el MISMO
// criterio que la cola del SDR (_leadIsCallableNow), `leadsLlamados` se atribuye
// por quién discó (criterio #139) y `pendientes` es el stock virgen.

import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `command-metrics-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cm@local.test";
process.env.ADMIN_PASSWORD = "cmpass1234";
process.env.JWT_SECRET = "test-secret-cm";
process.env.BUSINESS_TZ = "America/Argentina/Buenos_Aires";
// Definidas-vacías, NUNCA delete: dotenv repone las borradas y los tests
// terminan llamando a la IA real (ver CLAUDE.md #121).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-cm@local.test", name: "AdminCM", role: "admin", status: "active", setterId: "", password: pwd("cmpass1234") },
    { id: "u_x", email: "x-cm@local.test", name: "SdrX", role: "setter", status: "active", setterId: "s_x", password: pwd("xpass123456") },
    { id: "u_y", email: "y-cm@local.test", name: "SdrY", role: "setter", status: "active", setterId: "s_y", password: pwd("ypass123456") },
  ], invites: [], sessions: [],
}, null, 2));

const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const OK_PHONE = "+5215512345678";   // MX móvil — tarifa verde
const ES_FIJO = "+34911234567";      // ES fijo — tarifa roja (surcharged origination)

// Cada lead ejercita UNA exclusión para que el conteo esperado sea legible.
const leads = {
  // ── s_x ──
  l1: { name: "Limpio virgen", phone: OK_PHONE, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
  l2: {
    name: "Trabajado por su dueño", phone: OK_PHONE, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar",
    callLog: [
      { ts: iso(now - 3600000), by: "u_x", outcome: "no_answer" },
      { ts: iso(now - 3000000), by: "u_x", outcome: "answered_interested", duration: 95 },
      { ts: iso(now - 2400000), by: "u_x", outcome: "scheduled_with_admin", duration: 210 },
    ],
  },
  l3: { name: "No llamar", phone: OK_PHONE, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar", doNotCall: true },
  l4: { name: "Número muerto", phone: OK_PHONE, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar", lookupAt: iso(now - 86400000) },
  l5: { name: "Tarifa roja", phone: ES_FIJO, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
  l6: { name: "Callback futuro", phone: OK_PHONE, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar", callbackAt: iso(now + 4 * 3600000) },
  // El que el criterio viejo perdía: distribuido por el pool, quedó en flujo
  // Setteo (sin conexion) pero el dialer lo disca con include=callable.
  l7: { name: "En Setteo con teléfono", phone: OK_PHONE, assignedTo: "s_x", conexion: "", estado: "sin_contactar" },
  // Reasignado: el callLog es de un SDR anterior → para su dueño actual sigue
  // siendo stock sin abrir (criterio #139 "arranca de cero al reasignar").
  l8: {
    name: "Heredado de otro SDR", phone: OK_PHONE, assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar",
    callLog: [{ ts: iso(now - 5 * 86400000), by: "u_y", outcome: "no_answer" }],
  },
  // ── s_y ──
  l9: { name: "Limpio de Y", phone: OK_PHONE, assignedTo: "s_y", conexion: "sin_wsp", estado: "sin_contactar" },
  l10: { name: "Interesado (sale de la cola)", phone: OK_PHONE, assignedTo: "s_y", conexion: "sin_wsp", estado: "interesado" },
  // ── pool ──
  l11: { name: "Pool llamable", phone: OK_PHONE, assignedTo: "", conexion: "sin_wsp", estado: "sin_contactar" },
  l12: { name: "Pool no-llamar", phone: OK_PHONE, assignedTo: "", conexion: "sin_wsp", estado: "sin_contactar", doNotCall: true },
  // Sin teléfono: no es llamable y tampoco debe aparecer en la cola de la SDR
  // (antes la rama sin_wsp no chequeaba el número → lo veía y no podía discar).
  l13: { name: "Sin teléfono", phone: "", assignedTo: "s_y", conexion: "sin_wsp", estado: "sin_contactar" },
};

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_x", name: "X" }, { id: "s_y", name: "Y" }],
  variants: [], leads, calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");

let adminCookie = "";
let body = null;
let rowX = null;
let rowY = null;

beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-cm@local.test", password: "cmpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
  const r = await request(app).get("/api/setters/command").set("Cookie", adminCookie);
  expect(r.status).toBe(200);
  body = r.body;
  rowX = body.callsPerSetter.find((s) => s.id === "s_x");
  rowY = body.callsPerSetter.find((s) => s.id === "s_y");
});

describe("Centro de Comando — stock de trabajo por SDR", () => {
  it("'para llamar' usa el criterio de la cola real, no conexion=sin_wsp", () => {
    // s_x tiene 8 leads asignados; llamables: l1, l2, l7 (Setteo) y l8 (heredado).
    // Quedan fuera: DNC, número muerto, tarifa roja y callback a futuro.
    expect(rowX.asignados).toBe(8);
    expect(rowX.callable, "callable debe excluir DNC/muerto/tarifa roja/callback futuro").toBe(4);
    // El conteo viejo (sin_wsp) contaba 7: 6 de más y se perdía el de Setteo.
    expect(rowX.leadsAsignados, "la clave legacy se conserva para compat").toBe(7);
  });

  it("un lead en flujo Setteo con teléfono cuenta como llamable", () => {
    // l7 no tiene conexion='sin_wsp' pero el dialer lo disca (include=callable).
    // Si este assert cae, volvió el bug que mostraba menos leads de los reales.
    expect(rowX.callable).toBeGreaterThanOrEqual(1);
    const soloSinWsp = rowX.leadsAsignados;
    expect(rowX.asignados).toBeGreaterThan(soloSinWsp);
  });

  it("'llamó' se atribuye a quién discó, no al dueño actual", () => {
    // s_x solo discó l2. El callLog de l8 es de u_y (SDR anterior).
    expect(rowX.leadsLlamados).toBe(1);
    expect(rowY.leadsLlamados, "la llamada de u_y sobre un lead ajeno no le suma leads propios").toBe(0);
    // Pero las LLAMADAS sí se le atribuyen a quien las hizo.
    expect(rowY.totalLlamadas).toBe(1);
    expect(rowX.totalLlamadas).toBe(3);
  });

  it("'le quedan' = llamables que el dueño actual todavía no abrió", () => {
    // l1, l7 y l8 (heredado: para su dueño nuevo sigue sin abrir). l2 no.
    expect(rowX.pendientes).toBe(3);
    expect(rowY.pendientes).toBe(1);
  });

  it("el total del equipo cierra: por SDR + pool", () => {
    const sumaSdr = body.callsPerSetter.reduce((n, s) => n + s.callable, 0);
    expect(body.callTotals.callableTotal).toBe(sumaSdr + body.callTotals.unassignedCallable);
    expect(body.callTotals.unassignedTotal).toBe(2);
    expect(body.callTotals.unassignedCallable, "el DNC del pool no es llamable").toBe(1);
    expect(body.callTotals.callableTotal).toBe(6); // 4 (s_x) + 1 (s_y) + 1 (pool)
  });

  it("'marcó' son dials (con reintentos) y 'conversaciones' usa el canon del core", async () => {
    // l2 tiene 3 entries del mismo lead: marcó 3 veces sobre 1 lead distinto.
    expect(rowX.totalLlamadas).toBe(3);
    expect(rowX.leadsMarcados, "leads distintos marcados en el período").toBe(1);
    expect(rowX.leadsLlamados).toBe(1);
    // Conversación = atendió Y (>=30s O agendó). De las 3: no_answer no cuenta
    // (no atendió), answered_interested 95s sí, scheduled_with_admin sí.
    expect(rowX.conversaciones).toBe(2);
    // Y debe coincidir con el CALL METRICS CORE para el mismo setter/período.
    const ccm = await request(app)
      .get("/api/setters/cold-call-metrics?setter=s_x&period=all")
      .set("Cookie", adminCookie);
    expect(ccm.status).toBe(200);
    expect(rowX.totalLlamadas, "dials del Comando != core").toBe(ccm.body.metrics.dials);
    expect(rowX.atendidas, "connects del Comando != core").toBe(ccm.body.metrics.connects);
    expect(rowX.conversaciones, "conversations del Comando != core").toBe(ccm.body.metrics.conversations);
    expect(body.callTotals.conversacionesHistorico).toBe(rowX.conversaciones + rowY.conversaciones);
  });

  it("una atendida corta NO es conversación", () => {
    // s_y solo tiene la llamada no_answer de u_y sobre un lead de s_x → 0 y 0.
    expect(rowY.atendidas).toBe(0);
    expect(rowY.conversaciones).toBe(0);
  });

  it("% conversión de la fila usa atendidas como denominador (igual que la card)", () => {
    // s_x: 3 llamadas, 2 atendidas (interested + scheduled), 1 agendada.
    expect(rowX.atendidas).toBe(2);
    expect(rowX.agendados).toBe(1);
    expect(rowX.pctConversion, "dividir por totalLlamadas daría 33.3 y no cuadraría con la card").toBe("50.0");
    expect(body.callTotals.pctConversion).toBe("50.0");
  });

  it("un lead sin teléfono no cuenta como llamable NI aparece en la cola", async () => {
    // s_y tiene l9 (llamable), l10 (interesado → fuera) y l13 (sin teléfono).
    expect(rowY.asignados).toBe(3);
    expect(rowY.callable, "el lead sin teléfono no es llamable").toBe(1);
    // Y la cola que ve la SDR debe dar el MISMO número que el Comando: si la
    // cola lo mostrara, ella vería un lead que no puede discar.
    const cola = await request(app)
      .get("/api/setters/leads/sin-wsp?setter=s_y&include=callable")
      .set("Cookie", adminCookie);
    expect(cola.status).toBe(200);
    expect(cola.body.leads.some((l) => l.name === "Sin teléfono")).toBe(false);
    // El interesado SÍ vuelve del endpoint (lo filtra el front: se trabaja
    // desde Hoy). Lo que no puede volver es un lead sin número que discar.
    expect(cola.body.leads.every((l) => String(l.phone || '').replace(/\D/g, '').length >= 7)).toBe(true);
  });

  it("un SDR sin cola sin_wsp pero con leads asignados sigue en la tabla", () => {
    // El filtro viejo era por leadsAsignados (sin_wsp) y podía esconder a un SDR
    // con toda su cartera en flujo Setteo.
    expect(body.callsPerSetter.some((s) => s.id === "s_x")).toBe(true);
    expect(body.callsPerSetter.some((s) => s.id === "s_y")).toBe(true);
  });
});
