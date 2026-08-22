// Phase 35 (SCR), plan 35-01 — contrato de atribución de guion.
//
// Hasta este plan, `scriptIdsUsed` SOLO se persistía si venía DENTRO de
// `telnyxCallMeta` (Sprint 12) — exigía WebRTC + abrir el panel + clickear un
// guion, las tres opcionales. Dio 0 de 199 llamadas (ver
// .planning/phases/35-scr-atribucion-guion/CONTEXT.md). Esta suite verifica
// el contrato NUEVO: aceptación desde el nivel superior del body (cualquier
// superficie), whitelist contra el banco real, gate por outcome, flag
// auto/manual, unión con telnyxCallMeta, herencia en corrección de
// auto-marca, y la cobertura auto vs manual del panel de efectividad.
//
// Setup calcado de tests/disposition-enforcement.test.js: NODE_ENV=test,
// DATA_DIR en tmpdir propio, auth.json + setters.json escritos ANTES del
// import, API keys de IA en "" (regla #121, NUNCA delete), login() devuelve
// la cookie gs_session.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `script-attr-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-scr@local.test";
process.env.ADMIN_PASSWORD = "scrpass1234";
process.env.JWT_SECRET = "test-secret-scr";
// Regla #121: las API keys se definen VACÍAS (jamás delete — dotenv repondría
// la del .env local y los tests llamarían a la IA real).
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
    { id: "u_admin", email: "admin-scr@local.test", name: "AdminScr", role: "admin", status: "active", setterId: "", password: pwd("scrpass1234") },
    { id: "u_a", email: "a-scr@local.test", name: "SdrA", role: "setter", status: "active", setterId: "s_a", password: pwd("apass123456") },
    { id: "u_b", email: "b-scr@local.test", name: "SdrB", role: "setter", status: "active", setterId: "s_b", password: pwd("bpass123456") },
  ],
  invites: [], sessions: [],
}, null, 2));

// Banco de guiones FIJO (no el seed real de scripts/seed/call-scripts.json —
// el server haría lazy-init desde ahí, y usar ids reales del seed acoplaría
// la suite al contenido del banco de producción). 3 guiones nombrados +
// 25 "sc_cap_NN" para el test del tope de 20.
const _now = () => new Date().toISOString();
const capScripts = Array.from({ length: 25 }, (_, i) => ({
  id: `sc_cap_${String(i + 1).padStart(2, "0")}`,
  label: `Cap ${i + 1}`, trigger: "opener", text: "texto de prueba",
  tags: [], createdAt: _now(), createdBy: "test",
}));
const CAP_IDS = capScripts.map((s) => s.id);
fs.writeFileSync(path.join(tmpData, "call_scripts.json"), JSON.stringify({
  scripts: [
    { id: "sc_opener", label: "Opener", trigger: "opener", text: "texto opener", tags: [], createdAt: _now(), createdBy: "test" },
    { id: "sc_gk", label: "Gatekeeper", trigger: "gatekeeper", text: "texto gk", tags: [], createdAt: _now(), createdBy: "test" },
    { id: "sc_rules", label: "Rules", trigger: "rules", text: "texto rules", tags: [], createdAt: _now(), createdBy: "test" },
    { id: "sc_cov_auto", label: "Cov Auto", trigger: "opener", text: "texto", tags: [], createdAt: _now(), createdBy: "test" },
    { id: "sc_cov_manual", label: "Cov Manual", trigger: "opener", text: "texto", tags: [], createdAt: _now(), createdBy: "test" },
    ...capScripts,
  ],
}, null, 2));

const mkLead = (num, name, phone, setterId) => ({ num, name, phone, assignedTo: setterId, conexion: "sin_wsp", estado: "sin_contactar" });

// lcorr: fixture con un entry YA auto-marcado que carga scriptIdsUsed —
// imposible de producir por la API real (el gate de outcome hace que un
// no_answer NUNCA persista guion), pero es exactamente lo que hace falta
// para probar el mecanismo de HERENCIA en la corrección de forma aislada del
// gate (plan 35-01, Task 3: "elegir el camino más honesto y comentarlo").
const T_CORR = new Date(Date.now() - 5 * 60 * 1000).toISOString();

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_a", name: "A" }, { id: "s_b", name: "B" }],
  variants: [],
  leads: {
    l_surface: mkLead(1, "Surface", "+5215550000001", "s_a"),
    l_unknown_mixed: mkLead(2, "UnkMixed", "+5215550000002", "s_a"),
    l_unknown_all: mkLead(3, "UnkAll", "+5215550000003", "s_a"),
    l_gate_na: mkLead(4, "GateNA", "+5215550000004", "s_a"),
    l_gate_vm: mkLead(5, "GateVM", "+5215550000005", "s_a"),
    l_auto_true: mkLead(6, "AutoTrue", "+5215550000006", "s_a"),
    l_auto_false: mkLead(7, "AutoFalse", "+5215550000007", "s_a"),
    l_auto_absent: mkLead(8, "AutoAbsent", "+5215550000008", "s_a"),
    l_union: mkLead(9, "Union", "+5215550000009", "s_a"),
    l_cap: mkLead(10, "Cap", "+5215550000010", "s_a"),
    l_cov_auto: mkLead(11, "CovAuto", "+5215550000011", "s_a"),
    l_cov_manual: mkLead(12, "CovManual", "+5215550000012", "s_a"),
    l_rbac_a: mkLead(13, "RbacA", "+5215550000013", "s_a"),
    lcorr: {
      ...mkLead(14, "Corr", "+5215550000014", "s_a"),
      callAttempts: 1,
      callLog: [{
        ts: T_CORR,
        outcome: "no_answer",
        by: "u_a",
        notes: "",
        autoMarked: true,
        scriptIdsUsed: ["sc_opener"],
        scriptIdsAuto: true,
      }],
    },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");

let admin = "", ckA = "", ckB = "";
async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
}
beforeAll(async () => {
  admin = await login("admin-scr@local.test", "scrpass1234");
  ckA = await login("a-scr@local.test", "apass123456");
  ckB = await login("b-scr@local.test", "bpass123456");
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

const disp = (cookie, leadId, body) => request(app).post(`/api/setters/leads/${leadId}/call-disposition`).set("Cookie", cookie).send(body);

// Releer setters.json del tmpData es la verificación de persistencia REAL,
// no de lo que devuelve el endpoint (el plan lo pide explícito).
function readLead(leadId) {
  const raw = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
  return raw.leads[leadId];
}
function lastEntry(leadId) {
  const lead = readLead(leadId);
  return lead.callLog[lead.callLog.length - 1];
}

describe("aceptación desde el body (sin telnyxCallMeta)", () => {
  it("una disposición sin llamada WebRTC persiste scriptIdsUsed, y channel sigue 'manual' (sin regresión)", async () => {
    const r = await disp(admin, "l_surface", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener"] });
    expect(r.status).toBe(200);
    const e = lastEntry("l_surface");
    expect(e.scriptIdsUsed).toEqual(["sc_opener"]);
    expect(e.channel).toBe("manual");
  });
});

describe("whitelist contra el banco real", () => {
  it("id desconocido se descarta, sobreviven los conocidos", async () => {
    const r = await disp(admin, "l_unknown_mixed", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener", "sc_no_existe"] });
    expect(r.status).toBe(200);
    expect(lastEntry("l_unknown_mixed").scriptIdsUsed).toEqual(["sc_opener"]);
  });

  it("si TODOS los ids son desconocidos, el entry queda SIN el campo scriptIdsUsed", async () => {
    const r = await disp(admin, "l_unknown_all", { outcome: "answered_interested", scriptIdsUsed: ["sc_no_existe_1", "sc_no_existe_2"] });
    expect(r.status).toBe(200);
    expect(lastEntry("l_unknown_all").scriptIdsUsed).toBeUndefined();
  });
});

describe("gate de outcome (SCRIPT_RELEVANT_OUTCOMES)", () => {
  it("no_answer: los mismos ids NO se persisten", async () => {
    const r = await disp(admin, "l_gate_na", { outcome: "no_answer", scriptIdsUsed: ["sc_opener"] });
    expect(r.status).toBe(200);
    expect(lastEntry("l_gate_na").scriptIdsUsed).toBeUndefined();
  });

  it("voicemail: tampoco (fuera del set, decisión explícita)", async () => {
    const r = await disp(admin, "l_gate_vm", { outcome: "voicemail", scriptIdsUsed: ["sc_opener"] });
    expect(r.status).toBe(200);
    expect(lastEntry("l_gate_vm").scriptIdsUsed).toBeUndefined();
  });
});

describe("scriptIdsAuto: distingue automático de registrado por una persona", () => {
  it("scriptIdsAuto: true persiste scriptIdsAuto === true", async () => {
    const r = await disp(admin, "l_auto_true", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener"], scriptIdsAuto: true });
    expect(r.status).toBe(200);
    expect(lastEntry("l_auto_true").scriptIdsAuto).toBe(true);
  });

  it("scriptIdsAuto: false NO persiste el campo (ausencia = elegido por una persona)", async () => {
    const r = await disp(admin, "l_auto_false", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener"], scriptIdsAuto: false });
    expect(r.status).toBe(200);
    expect(lastEntry("l_auto_false").scriptIdsAuto).toBeUndefined();
  });

  it("sin el flag: tampoco persiste el campo", async () => {
    const r = await disp(admin, "l_auto_absent", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener"] });
    expect(r.status).toBe(200);
    expect(lastEntry("l_auto_absent").scriptIdsAuto).toBeUndefined();
  });
});

describe("unión con telnyxCallMeta + resolución del flag", () => {
  it("dedupe preservando orden; el flag lo decide el body (gana sobre telnyxCallMeta.scriptIdsAuto)", async () => {
    const r = await disp(admin, "l_union", {
      outcome: "answered_interested",
      telnyxCallMeta: { durationSecs: 30, fromNumber: "+17865550000", scriptIdsUsed: ["sc_opener"], scriptIdsAuto: true },
      scriptIdsUsed: ["sc_opener", "sc_gk"],
      scriptIdsAuto: false, // explícito: "lo eligió una persona" — tiene que ganar sobre telnyxCallMeta
    });
    expect(r.status).toBe(200);
    const e = lastEntry("l_union");
    expect(e.scriptIdsUsed).toEqual(["sc_opener", "sc_gk"]); // sin repetir sc_opener
    expect(e.scriptIdsAuto).toBeUndefined(); // el body dijo false → no se persiste
    expect(e.channel).toBe("telnyx_webrtc"); // regresión: telnyxCallMeta sigue armando el resto del entry
  });
});

describe("tope de MAX_SCRIPT_IDS_PER_CALL", () => {
  it("25 ids válidos distintos → se guardan 20", async () => {
    const r = await disp(admin, "l_cap", { outcome: "answered_interested", scriptIdsUsed: CAP_IDS });
    expect(r.status).toBe(200);
    const e = lastEntry("l_cap");
    expect(e.scriptIdsUsed.length).toBe(20);
    expect(e.scriptIdsUsed).toEqual(CAP_IDS.slice(0, 20));
  });
});

describe("herencia en corrección de auto-marca", () => {
  it("corregir un no_answer auto-marcado hereda scriptIdsUsed y scriptIdsAuto del entry original", async () => {
    // lcorr viene con un callLog[0] YA auto-marcado (no_answer) que carga
    // scriptIdsUsed/scriptIdsAuto — inyectado directo en el fixture porque la
    // API real NUNCA puede producir esa combinación (el gate de outcome hace
    // que un no_answer jamás persista guion). Lo que se prueba acá es el
    // mecanismo de herencia en sí, aislado del gate.
    const before = readLead("lcorr");
    expect(before.callLog.length).toBe(1);
    expect(before.callLog[0].autoMarked).toBe(true);

    const r = await disp(admin, "lcorr", { outcome: "answered_interested", correctsAutoMarked: true, notes: "corregido" });
    expect(r.status).toBe(200);

    const after = readLead("lcorr");
    expect(after.callLog.length).toBe(1); // reemplaza, no apila
    const e = after.callLog[0];
    expect(e.outcome).toBe("answered_interested");
    expect(e.scriptIdsUsed).toEqual(["sc_opener"]);
    expect(e.scriptIdsAuto).toBe(true);
    expect(e.ts).toBe(T_CORR); // hereda el ts de la llamada original
  });
});

describe("cobertura auto vs manual en /api/telnyx/script-effectiveness", () => {
  it("withScripts cuenta ambas, withScriptsManual solo las que no son auto (sobre entries del dialer)", async () => {
    // Entry AUTO (channel telnyx_webrtc, scriptIdsAuto:true) con un scriptId
    // exclusivo de este test para no entremezclarse con otras dispositions.
    const rAuto = await disp(admin, "l_cov_auto", {
      outcome: "answered_interested",
      telnyxCallMeta: { durationSecs: 40, fromNumber: "+17865550001", scriptIdsUsed: ["sc_cov_auto"], scriptIdsAuto: true },
    });
    expect(rAuto.status).toBe(200);

    // Entry MANUAL (channel telnyx_webrtc igual — vino por WebRTC — pero
    // scriptIdsAuto ausente: lo eligió una persona).
    const rManual = await disp(admin, "l_cov_manual", {
      outcome: "answered_interested",
      telnyxCallMeta: { durationSecs: 45, fromNumber: "+17865550002" },
      scriptIdsUsed: ["sc_cov_manual"],
    });
    expect(rManual.status).toBe(200);

    const g = await request(app).get("/api/telnyx/script-effectiveness?range=all").set("Cookie", admin);
    expect(g.status).toBe(200);
    // Cobertura global: incluye TODAS las llamadas telnyx_webrtc de la
    // suite, no solo las de este test — por eso se usan desigualdades acá y
    // aserciones EXACTAS sobre las filas por scriptId (que sí son exclusivas).
    expect(g.body.coverage.withScripts).toBeGreaterThanOrEqual(2);
    expect(g.body.coverage.withScriptsManual).toBeGreaterThanOrEqual(1);
    expect(typeof g.body.coverage.withScriptsManualPct).toBe("number");

    const rowAuto = g.body.scripts.find((s) => s.scriptId === "sc_cov_auto");
    const rowManual = g.body.scripts.find((s) => s.scriptId === "sc_cov_manual");
    expect(rowAuto.used).toBe(1);
    expect(rowAuto.usedManual).toBe(0);
    expect(rowManual.used).toBe(1);
    expect(rowManual.usedManual).toBe(1);
  });
});

describe("RBAC sin cambios", () => {
  it("un setter puede atribuir guion en su propio lead", async () => {
    const r = await disp(ckA, "l_rbac_a", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener"] });
    expect(r.status).toBe(200);
    expect(lastEntry("l_rbac_a").scriptIdsUsed).toEqual(["sc_opener"]);
  });

  it("el guard de lead ajeno sigue devolviendo 403 — no se relaja nada", async () => {
    const r = await disp(ckB, "l_rbac_a", { outcome: "answered_interested", scriptIdsUsed: ["sc_opener"] });
    expect(r.status).toBe(403);
  });
});
