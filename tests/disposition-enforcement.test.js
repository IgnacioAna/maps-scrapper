// Phase 20 — disposición obligatoria (backend, plan 20-01).
// Regresión de los 3 endpoints del enforcement:
//   - POST/GET /api/setters/pending-calls (registro pendiente D-01/D-02: upsert,
//     cancelación acotada <2 min, RBAC por dueño + scoping supervisor Phase 18)
//   - call-disposition extendido (auto-marca no_answer con snapshot preCadence,
//     corrección correctsAutoMarked con ventana de 15 min, resolución de pendientes
//     por pendingCallId → startedAt del meta → más reciente del lead)
//   - GET /api/setters/disposition-audit (auditoría pasiva D-06: sospechosas por
//     duración vs outcome + pctMarked derivado del CALL METRICS CORE)
// Y la persistencia regla #21 (export/import round-trip de pending_calls).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `disp-enf-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-enf@local.test";
process.env.ADMIN_PASSWORD = "enfpass1234";
process.env.JWT_SECRET = "test-secret-enf";
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
    { id: "u_admin", email: "admin-enf@local.test", name: "AdminEnf", role: "admin", status: "active", setterId: "", password: pwd("enfpass1234") },
    { id: "u_a", email: "a-enf@local.test", name: "SdrA", role: "setter", status: "active", setterId: "s_a", password: pwd("apass123456") },
    { id: "u_b", email: "b-enf@local.test", name: "SdrB", role: "setter", status: "active", setterId: "s_b", password: pwd("bpass123456") },
    { id: "u_c", email: "c-enf@local.test", name: "SdrC", role: "setter", status: "active", setterId: "s_c", password: pwd("cpass123456") },
    { id: "u_d", email: "d-enf@local.test", name: "SdrD", role: "setter", status: "active", setterId: "s_d", password: pwd("dpass123456") },
    // Supervisor scoped: solo ve a s_a (Phase 18).
    { id: "u_sup", email: "sup-enf@local.test", name: "SupEnf", role: "supervisor", status: "active", setterId: "", visibleSetterIds: ["s_a"], password: pwd("suppass123456") },
  ],
  invites: [], sessions: [],
}, null, 2));

const mkLead = (num, name, phone, setterId) => ({ num, name, phone, assignedTo: setterId, conexion: "sin_wsp", estado: "sin_contactar" });
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [
    { id: "s_a", name: "A" }, { id: "s_b", name: "B" },
    { id: "s_c", name: "C" }, { id: "s_d", name: "D" },
    { id: "s_e", name: "E" }, // sin dials ni pendientes: NO debe aparecer en la auditoría
  ],
  variants: [],
  leads: {
    la1: mkLead(1, "LA1", "+5215550000001", "s_a"),
    la2: mkLead(2, "LA2", "+5215550000002", "s_a"),
    la3: mkLead(3, "LA3", "+5215550000003", "s_a"),
    la4: mkLead(4, "LA4", "+5215550000004", "s_a"),
    lb1: mkLead(5, "LB1", "+5215550000005", "s_b"),
    lb2: mkLead(6, "LB2", "+5215550000006", "s_b"),
    lb3: mkLead(7, "LB3", "+5215550000007", "s_b"),
    lb4: mkLead(8, "LB4", "+5215550000008", "s_b"),
    lb5: mkLead(9, "LB5", "+5215550000009", "s_b"),
    lc1: mkLead(10, "LC1", "+5215550000010", "s_c"),
    lc2: mkLead(11, "LC2", "+5215550000011", "s_c"),
    lc3: mkLead(12, "LC3", "+5215550000012", "s_c"),
    lc4: mkLead(13, "LC4", "+5215550000013", "s_c"),
    ld1: mkLead(14, "LD1", "+5215550000014", "s_d"),
    ld2: mkLead(15, "LD2", "+5215550000015", "s_d"),
    ld3: mkLead(16, "LD3", "+5215550000016", "s_d"),
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");

let admin = "", ckA = "", ckB = "", ckC = "", ckD = "", sup = "";
async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
}
beforeAll(async () => {
  admin = await login("admin-enf@local.test", "enfpass1234");
  ckA = await login("a-enf@local.test", "apass123456");
  ckB = await login("b-enf@local.test", "bpass123456");
  ckC = await login("c-enf@local.test", "cpass123456");
  ckD = await login("d-enf@local.test", "dpass123456");
  sup = await login("sup-enf@local.test", "suppass123456");
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

// Helpers: timestamps SIEMPRE relativos a Date.now() (la suite corre en
// cualquier fecha/TZ — lección de metrics-timezone).
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000;
const postPending = (cookie, body) => request(app).post("/api/setters/pending-calls").set("Cookie", cookie).send(body);
const getPending = (cookie, qs = "") => request(app).get(`/api/setters/pending-calls${qs}`).set("Cookie", cookie);
const disp = (cookie, leadId, body) => request(app).post(`/api/setters/leads/${leadId}/call-disposition`).set("Cookie", cookie).send(body);

// Timestamps fijos para poder derivar los ids pc_<leadId>_<startedAtMs>.
const T1 = isoAgo(8 * MIN);   // la1 — registro base (queda con endedAt)
const T3 = isoAgo(6 * MIN);   // la1 — registro con endedAt para el test de cancelación
const T_A2 = isoAgo(5 * MIN); // la2
const T_A3 = isoAgo(4 * MIN); // la3
const T_OLD = isoAgo(10 * MIN); // la4 — match por startedAt del meta
const T_MID = isoAgo(3 * MIN);  // la4 — queda vivo (NO es el más reciente)
const T_NEW = isoAgo(1 * MIN);  // la4 — el más reciente
const pcId = (leadId, iso) => `pc_${leadId}_${Date.parse(iso)}`;

describe("registro pendiente (D-01/D-02)", () => {
  it("POST crea el registro y el setterId sale del auth, no del body", async () => {
    const r = await postPending(ckA, { leadId: "la1", startedAt: T1, fromNumber: "+17865550001", setterId: "s_b" });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(pcId("la1", T1));
    const g = await getPending(ckA);
    expect(g.status).toBe(200);
    expect(g.body.pending.length).toBe(1);
    const rec = g.body.pending[0];
    expect(rec.leadId).toBe("la1");
    expect(rec.setterId).toBe("s_a"); // del auth — el body con s_b se ignoró
    expect(rec.userId).toBe("u_a");
    expect(rec.endedAt).toBeNull();
    expect(rec.fromNumber).toBe("+17865550001");
  });

  it("SDR ajeno: POST sobre lead de otro → 403 y su GET no ve pendientes ajenos", async () => {
    const r = await postPending(ckB, { leadId: "la1", startedAt: isoAgo(0) });
    expect(r.status).toBe(403);
    const g = await getPending(ckB);
    expect(g.body.pending.length).toBe(0); // los de s_a no se ven
  });

  it("upsert: segundo POST con mismo leadId+startedAt actualiza sin duplicar", async () => {
    const r = await postPending(ckA, { leadId: "la1", startedAt: T1, endedAt: isoAgo(7 * MIN), durationSecs: 33, reachedActive: true });
    expect(r.body.id).toBe(pcId("la1", T1));
    const g = await getPending(ckA);
    const mine = g.body.pending.filter((p) => p.leadId === "la1");
    expect(mine.length).toBe(1); // no duplicó
    expect(mine[0].endedAt).toBeTruthy();
    expect(mine[0].durationSecs).toBe(33);
    expect(mine[0].reachedActive).toBe(true);
  });

  it("canceled:true borra solo registros sin endedAt y con <2 min de vida", async () => {
    // Registro "que nunca existió": sin endedAt, recién creado → se borra.
    const t2 = isoAgo(30 * 1000);
    await postPending(ckA, { leadId: "la1", startedAt: t2 });
    let r = await postPending(ckA, { leadId: "la1", startedAt: t2, canceled: true });
    expect(r.body.removed).toBe(true);
    // Registro con endedAt seteado: la llamada existió → NO se borra.
    await postPending(ckA, { leadId: "la1", startedAt: T3, endedAt: isoAgo(5 * MIN), durationSecs: 12 });
    r = await postPending(ckA, { leadId: "la1", startedAt: T3, canceled: true });
    expect(r.body.removed).toBe(false);
    const g = await getPending(ckA);
    const ids = g.body.pending.map((p) => p.id);
    expect(ids).toContain(pcId("la1", T3));
    expect(ids).not.toContain(pcId("la1", t2));
  });

  it("admin ve todo, ?setter= filtra y el supervisor scoped solo ve su SDR", async () => {
    // Pendiente de s_b (lead propio) para que el filtrado sea observable.
    await postPending(ckB, { leadId: "lb1", startedAt: isoAgo(2 * MIN) });
    const all = await getPending(admin);
    const bySid = new Set(all.body.pending.map((p) => p.setterId));
    expect(bySid.has("s_a")).toBe(true);
    expect(bySid.has("s_b")).toBe(true);
    const onlyA = await getPending(admin, "?setter=s_a");
    expect(onlyA.body.pending.length).toBeGreaterThanOrEqual(1);
    expect(onlyA.body.pending.every((p) => p.setterId === "s_a")).toBe(true);
    const supList = await getPending(sup);
    expect(supList.body.pending.length).toBeGreaterThanOrEqual(1);
    expect(supList.body.pending.every((p) => p.setterId === "s_a")).toBe(true);
  });
});

describe("resolución de pendientes vía call-disposition (D-01)", () => {
  it("pendingCallId correcto resuelve; un id de OTRO lead no toca ese registro", async () => {
    await postPending(ckA, { leadId: "la2", startedAt: T_A2 });
    await postPending(ckA, { leadId: "la3", startedAt: T_A3 });
    // Disposición de la2 mandando el id del pendiente de la3: NO puede resolver
    // el registro ajeno (T-20-06) — cae al fallback (el más reciente de la2).
    let r = await disp(ckA, "la2", { outcome: "hung_up", pendingCallId: pcId("la3", T_A3) });
    expect(r.status).toBe(200);
    expect(r.body.resolvedPendingId).toBe(pcId("la2", T_A2));
    let g = await getPending(ckA);
    expect(g.body.pending.map((p) => p.id)).toContain(pcId("la3", T_A3)); // sigue vivo
    // Con el pendingCallId correcto (mismo lead) sí lo resuelve.
    r = await disp(ckA, "la3", { outcome: "hung_up", pendingCallId: pcId("la3", T_A3) });
    expect(r.body.resolvedPendingId).toBe(pcId("la3", T_A3));
    g = await getPending(ckA);
    const ids = g.body.pending.map((p) => p.id);
    expect(ids).not.toContain(pcId("la2", T_A2));
    expect(ids).not.toContain(pcId("la3", T_A3));
  });

  it("match por startedAt del telnyxCallMeta; sin meta ni id cae al MÁS RECIENTE", async () => {
    await postPending(ckA, { leadId: "la4", startedAt: T_OLD });
    await postPending(ckA, { leadId: "la4", startedAt: T_NEW });
    await postPending(ckA, { leadId: "la4", startedAt: T_MID });
    // El meta trae el startedAt del registro viejo → resuelve ESE (no el más reciente).
    let r = await disp(ckA, "la4", { outcome: "hung_up", telnyxCallMeta: { startedAt: T_OLD, durationSecs: 5, fromNumber: "+17865550001" } });
    expect(r.body.resolvedPendingId).toBe(pcId("la4", T_OLD));
    // Sin meta ni id → el más reciente por startedAt (T_NEW, aunque T_MID se creó después).
    r = await disp(ckA, "la4", { outcome: "hung_up" });
    expect(r.body.resolvedPendingId).toBe(pcId("la4", T_NEW));
    const g = await getPending(ckA);
    const la4ids = g.body.pending.filter((p) => p.leadId === "la4").map((p) => p.id);
    expect(la4ids).toEqual([pcId("la4", T_MID)]); // el del medio queda vivo
  });
});

describe("auto-marca y corrección (D-03)", () => {
  it("autoMarked solo queda en no_answer (con snapshot preCadence); un connect lo ignora", async () => {
    const r = await disp(ckB, "lb1", { outcome: "no_answer", autoMarked: true, telnyxCallMeta: { durationSecs: 20, fromNumber: "+17865550002" } });
    expect(r.status).toBe(200);
    const entry = r.body.lead.callLog[0];
    expect(entry.autoMarked).toBe(true);
    expect(entry.preCadence).toBeTypeOf("object");
    expect(entry.preCadence.estado).toBe("sin_contactar");
    expect(entry.preCadence.cadenceStep).toBe(0);
    expect(entry.preCadence).toHaveProperty("callbackAt");
    // Con un connect el flag se ignora (T-20-04): nadie etiqueta un connect de automático.
    const r2 = await disp(ckB, "lb4", { outcome: "answered_interested", autoMarked: true });
    const e2 = r2.body.lead.callLog[0];
    expect(e2.autoMarked).toBeUndefined();
    expect(e2.preCadence).toBeUndefined();
    expect(r2.body.lead.estado).toBe("interesado");
  });

  it("corrección simple: reemplaza el entry conservando ts/duración, sin duplicar dials", async () => {
    // lb1 quedó con la auto-marca del test anterior (dentro de la ventana de 15 min).
    const before = (await disp(ckB, "lb1", { outcome: "voicemail", correctsAutoMarked: true }));
    expect(before.status).toBe(200);
    const lead = before.body.lead;
    expect(lead.callLog.length).toBe(1); // 1 llamada = 1 entry
    expect(lead.callLog[0].outcome).toBe("voicemail");
    expect(lead.callLog[0].autoMarked).toBeUndefined();
    expect(lead.callLog[0].duration).toBe(20); // heredada del entry auto-marcado
    expect(lead.callLog[0].channel).toBe("telnyx_webrtc");
    expect(lead.callAttempts).toBe(1); // el intento no se duplica
    expect(lead.phoneStatus).toBe("voicemail");
  });

  it("corrección revierte el auto-descarte y restaura la cadencia del snapshot", async () => {
    // 1er no_answer real → cadencia programa callback a +24h.
    const r1 = await disp(ckB, "lb2", { outcome: "no_answer" });
    const cb1 = r1.body.lead.callbackAt;
    expect(cb1).toBeTruthy();
    expect(r1.body.lead.cadenceStep).toBe(1);
    // Auto-marca no_answer → racha 2 → descarte automático.
    const r2 = await disp(ckB, "lb2", { outcome: "no_answer", autoMarked: true });
    expect(r2.body.lead.estado).toBe("descartado");
    expect(r2.body.lead.autoDiscarded).toBe(true);
    expect(r2.body.lead.callbackAt).toBeFalsy();
    // Corrección: en realidad atendió y está interesado → deshace el descarte fantasma.
    const r3 = await disp(ckB, "lb2", { outcome: "answered_interested", correctsAutoMarked: true });
    expect(r3.status).toBe(200);
    expect(r3.body.lead.estado).toBe("interesado");
    expect(r3.body.lead.autoDiscarded).toBe(false);
    // El snapshot restaura cb1 (deshace la cadencia fantasma), pero la
    // disposición corregida lo CONSUME después (regla 2026-08-12: toda
    // disposición consume el callback pendiente) — atendió y está interesado,
    // el reintento de cadencia ya no aplica. Sin esto, corregir a "me cortó"
    // reabriría el bug del callback zombie por la vía de la corrección.
    expect(r3.body.lead.callbackAt).toBeFalsy();
    expect(r3.body.lead.callLog.length).toBe(2); // la corrección reemplazó a la auto-marca
    expect(r3.body.lead.cadenceStep).toBe(0); // el connect resetea la racha
  });

  it("corrección sin auto-marca previa (último entry manual) → 409", async () => {
    await disp(ckB, "lb3", { outcome: "no_answer" }); // manual, sin autoMarked
    const r = await disp(ckB, "lb3", { outcome: "voicemail", correctsAutoMarked: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("No hay auto-marca reciente para corregir.");
  });

  it("corrección con auto-marca de hace más de 15 min → 409 (no se fabrica historia)", async () => {
    await disp(ckB, "lb5", { outcome: "no_answer", autoMarked: true });
    // Envejecer el entry auto-marcado directamente en el archivo (patrón call-cadence).
    const file = path.join(tmpData, "setters.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const log = data.leads.lb5.callLog;
    log[log.length - 1].ts = isoAgo(16 * MIN);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    const r = await disp(ckB, "lb5", { outcome: "voicemail", correctsAutoMarked: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("No hay auto-marca reciente para corregir.");
  });
});

describe("auditoría pasiva (D-06)", () => {
  it("RBAC: SDR → 403; admin → 200; supervisor scoped solo ve su SDR visible", async () => {
    const rSetter = await request(app).get("/api/setters/disposition-audit").set("Cookie", ckA);
    expect(rSetter.status).toBe(403);
    const rAdmin = await request(app).get("/api/setters/disposition-audit?period=7d").set("Cookie", admin);
    expect(rAdmin.status).toBe(200);
    expect(Array.isArray(rAdmin.body.bySetter)).toBe(true);
    const rSup = await request(app).get("/api/setters/disposition-audit?period=7d").set("Cookie", sup);
    expect(rSup.status).toBe(200);
    expect(rSup.body.bySetter.length).toBeGreaterThanOrEqual(1);
    expect(rSup.body.bySetter.every((s) => s.setterId === "s_a")).toBe(true);
  });

  it("sospechosas: no-contacto largo y connect corto se señalan; el resto no", async () => {
    // Fixture de s_c vía el endpoint real (los entries llevan duration del meta).
    await disp(ckC, "lc1", { outcome: "no_answer", telnyxCallMeta: { durationSecs: 45 } });          // longNoContact
    await disp(ckC, "lc2", { outcome: "answered_interested", telnyxCallMeta: { durationSecs: 5 } }); // shortConnect
    await disp(ckC, "lc3", { outcome: "no_answer", telnyxCallMeta: { durationSecs: 20 } });          // bajo el umbral de 31s
    await disp(ckC, "lc4", { outcome: "answered_interested" });                                      // manual sin duration → sin dato
    const r = await request(app).get("/api/setters/disposition-audit?period=7d&setter=s_c").set("Cookie", admin);
    expect(r.status).toBe(200);
    expect(r.body.bySetter.length).toBe(1);
    const row = r.body.bySetter[0];
    expect(row.setterId).toBe("s_c");
    expect(row.dials).toBe(4);
    expect(row.byOutcome.no_answer).toBe(2);
    expect(row.byOutcome.answered_interested).toBe(2);
    expect(row.suspicious.longNoContact).toBe(1);
    expect(row.suspicious.shortConnect).toBe(1);
    expect(row.suspicious.total).toBe(2);
    const rules = row.suspicious.samples.map((s) => s.rule).sort();
    expect(rules).toEqual(["longNoContact", "shortConnect"]);
  });

  it("pctMarked = dials Telnyx / (dials + pendientes); SDR sin actividad no aparece", async () => {
    // s_d: 2 llamadas telnyx marcadas + 1 pendiente sin resolver → 2/3 = 67%.
    await disp(ckD, "ld1", { outcome: "hung_up", telnyxCallMeta: { durationSecs: 15 } });
    await disp(ckD, "ld2", { outcome: "hung_up", telnyxCallMeta: { durationSecs: 15 } });
    await postPending(ckD, { leadId: "ld3", startedAt: isoAgo(1 * MIN) });
    const r = await request(app).get("/api/setters/disposition-audit?period=7d&setter=s_d").set("Cookie", admin);
    expect(r.body.bySetter.length).toBe(1);
    const row = r.body.bySetter[0];
    expect(row.dials).toBe(2);
    expect(row.pendingCount).toBe(1);
    expect(row.pctMarked).toBe(67);
    // s_e no tiene ni dials ni pendientes → sin fila en la vista global.
    const all = await request(app).get("/api/setters/disposition-audit?period=7d").set("Cookie", admin);
    expect(all.body.bySetter.some((s) => s.setterId === "s_e")).toBe(false);
    expect(all.body.totals.pctMarked).not.toBeNull();
  });
});

describe("persistencia (regla #21)", () => {
  it("export-data incluye pending_calls y el import lo restaura (round-trip)", async () => {
    const exp = await request(app).get("/api/admin/export-data").set("Cookie", admin);
    expect(exp.status).toBe(200);
    expect(exp.body.pending_calls).toBeTruthy();
    expect(Array.isArray(exp.body.pending_calls.pending)).toBe(true);
    const ids = exp.body.pending_calls.pending.map((p) => p.id).sort();
    expect(ids.length).toBeGreaterThanOrEqual(1); // quedaron pendientes vivos de los tests previos
    // Simular container nuevo de Railway: el archivo desaparece.
    fs.rmSync(path.join(tmpData, "pending_calls.json"), { force: true });
    let g = await getPending(admin);
    expect(g.body.pending.length).toBe(0);
    // Restore vía import-data con el bloque exportado.
    const imp = await request(app).post("/api/admin/import-data").set("Cookie", admin).send({ pending_calls: exp.body.pending_calls });
    expect(imp.status).toBe(200);
    expect(imp.body.restored).toContain("pending_calls");
    g = await getPending(admin);
    expect(g.body.pending.map((p) => p.id).sort()).toEqual(ids);
  });
});
