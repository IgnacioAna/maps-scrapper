// Phase 29 Plan 03 (NEXT-03): retiro de lead.followUps como reloj paralelo.
// Cubre el write-path (PATCH .../followup programando nextAction), el
// read-path (_computeFollowupsDue derivando de nextAction), la derivación
// legacy (leads sin migrar) y el recorte de cadencia (#150).
//
// Complementa a tests/followups.test.js (contrato de regresión de la
// derivación legacy: buckets/step/badge con fixtures que SOLO tienen
// followUps + followUpStartedAt) — este archivo NO lo reemplaza.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `next-action-followups-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-naf@local.test";
process.env.ADMIN_PASSWORD = "nafpass1234";
process.env.JWT_SECRET = "test-secret-naf-1234567890";
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_naf", email: "admin-naf@local.test", name: "AdminNAF", role: "admin", status: "active", setterId: "", password: pwd("nafpass1234") },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW - ms).toISOString();

// Fixture:
// - lead_virgin: sin nada — para tildar/destildar por HTTP.
// - lead_step_then_disposition: recibe un follow-up tildado y LUEGO un
//   callback manual por disposición — para probar que destildar no pisa el
//   compromiso de la otra vía.
// - lead_legacy_followups: followUps activo + followUpStartedAt, SIN
//   callbackAt ni nextAction — derivación legacy pura, sin migración previa.
// - lead_cadencia: lead limpio que va a recibir no_answer por HTTP.
// - lead_manual_overdue: callbackAt vencido + callLog con callback_later,
//   con un delta que NO coincide con ninguna plantilla (step:'').
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_naf", name: "SetterNAF" }],
    variants: [],
    leads: {
      lead_virgin: {
        num: 1, name: "Virgin", phone: "+521555000001", assignedTo: "setter_naf",
        estado: "sin_contactar", conexion: "sin_wsp", interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null,
        notes: [], callLog: [], interactions: [],
      },
      lead_step_then_disposition: {
        num: 2, name: "StepThenDisp", phone: "+521555000002", assignedTo: "setter_naf",
        estado: "sin_contactar", conexion: "sin_wsp", interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null,
        notes: [], callLog: [], interactions: [],
      },
      lead_legacy_followups: {
        num: 3, name: "LegacyFU", phone: "+521555000003", assignedTo: "setter_naf",
        estado: "contactado", conexion: "enviada", interes: null,
        followUps: { '24hs': false, '48hs': true, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: ago(10 * DAY), // due = base+48h = ~8 días atrás, overdue robusto
        notes: [], callLog: [], interactions: [], lastContactAt: ago(10 * DAY),
      },
      lead_cadencia: {
        num: 4, name: "Cadencia", phone: "+521555000004", assignedTo: "setter_naf",
        estado: "sin_contactar", conexion: "sin_wsp", interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null,
        notes: [], callLog: [], interactions: [],
      },
      // nextAction de cadencia ya VENCIDO (sembrado directo, no vía HTTP): el
      // reintento automático recién creado siempre vence a +24h (nunca está
      // due en el momento de crearse), así que este es el único fixture que
      // ejercita el recorte `origen === 'cadencia'` en el read-path — sin él,
      // este lead SÍ aparecería en overdue.
      lead_cadencia_due: {
        num: 6, name: "CadenciaDue", phone: "+521555000006", assignedTo: "setter_naf",
        estado: "sin_contactar", conexion: "sin_wsp", interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null,
        callbackAt: ago(2 * DAY),
        nextAction: {
          tipo: 'cadencia', dueAt: ago(2 * DAY), canal: 'llamada',
          motivo: 'reintento de no-contacto', origen: 'cadencia',
          createdAt: ago(3 * DAY), createdBy: '',
        },
        notes: [], callLog: [], interactions: [], lastContactAt: ago(3 * DAY),
      },
      lead_manual_overdue: {
        num: 5, name: "ManualOverdue", phone: "+521555000005", assignedTo: "setter_naf",
        estado: "contactado", conexion: "enviada", interes: null,
        followUps: { '24hs': false, '48hs': false, '72hs': false, '7d': false, '15d': false },
        followUpStartedAt: null,
        callbackAt: ago(6 * DAY), // vencido; delta contra el callLog = 4 días (no matchea plantilla)
        callbackShared: false,
        callLog: [
          { ts: ago(10 * DAY), outcome: 'callback_later', by: 'user_admin_naf' },
        ],
        notes: [], interactions: [], lastContactAt: ago(10 * DAY),
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let cookie = "";
const patchFollowup = (leadId, body) =>
  request(app).patch(`/api/setters/leads/${leadId}/followup`).set("Cookie", cookie).send(body);
const disp = (leadId, body) =>
  request(app).post(`/api/setters/leads/${leadId}/call-disposition`).set("Cookie", cookie).send(body);
const followupsToday = () => request(app).get("/api/setters/followups/today").set("Cookie", cookie);
const followupsBadge = () => request(app).get("/api/setters/followups/badge").set("Cookie", cookie);

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-naf@local.test", password: "nafpass1234" });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  cookie = (cookies.find((c) => c.startsWith("gs_session=")) || "").split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("Write-path: PATCH .../followup programa el reloj único", () => {
  it("tildar 24hs programa nextAction real (motivo/origen/dueAt) y espeja callbackAt", async () => {
    const r = await patchFollowup("lead_virgin", { step: "24hs", value: true });
    expect(r.status).toBe(200);
    expect(r.body.followUps["24hs"]).toBe(true);
    const na = r.body.lead.nextAction;
    expect(na).toBeTruthy();
    expect(na.motivo).toBe("follow-up 24h");
    expect(na.origen).toBe("manual");
    expect(na.tipo).toBe("callback");
    const dueMs = new Date(na.dueAt).getTime();
    expect(dueMs - NOW).toBeGreaterThan(23.9 * HOUR);
    expect(dueMs - NOW).toBeLessThan(24.1 * HOUR);
    expect(r.body.lead.callbackAt).toBe(na.dueAt);
  });

  it("tildar 7d después de 24hs deja UN solo nextAction vigente, a ~7 días (D-02)", async () => {
    const r = await patchFollowup("lead_virgin", { step: "7d", value: true });
    expect(r.status).toBe(200);
    expect(r.body.followUps["7d"]).toBe(true);
    expect(r.body.followUps["24hs"]).toBe(false);
    const na = r.body.lead.nextAction;
    expect(na.motivo).toBe("follow-up 7d");
    const dueMs = new Date(na.dueAt).getTime();
    expect(dueMs - NOW).toBeGreaterThan(6.9 * DAY);
    expect(dueMs - NOW).toBeLessThan(7.1 * DAY);
    expect(r.body.lead.callbackAt).toBe(na.dueAt);
  });

  it("destildar el step activo apaga nextAction y callbackAt", async () => {
    const r = await patchFollowup("lead_virgin", { step: "7d", value: false });
    expect(r.status).toBe(200);
    expect(r.body.followUps["7d"]).toBe(false);
    expect(r.body.lead.nextAction).toBeNull();
    expect(r.body.lead.callbackAt).toBe("");
  });

  it("destildar un step NO pisa un nextAction que vino de una disposición callback_later", async () => {
    // 1) Tildar 24hs a mano — crea un nextAction 'follow-up 24h'.
    const tildado = await patchFollowup("lead_step_then_disposition", { step: "24hs", value: true });
    expect(tildado.body.lead.nextAction.motivo).toBe("follow-up 24h");

    // 2) Una disposición callback_later CONSUME ese nextAction y programa el
    //    suyo propio (D-08) — motivo '', pactado por teléfono.
    const manualDate = new Date(Date.now() + 10 * DAY).toISOString();
    const dispRes = await disp("lead_step_then_disposition", { outcome: "callback_later", callbackAt: manualDate });
    expect(dispRes.status).toBe(200);
    expect(new Date(dispRes.body.lead.callbackAt).toISOString()).toBe(manualDate);
    expect(dispRes.body.lead.nextAction.motivo).toBe("");

    // 3) Destildar el checkbox '24hs' (el flag sigue tildado — la disposición
    //    no lo toca) NO puede borrar el compromiso pactado por teléfono: el
    //    nextAction vigente no es el que este endpoint creó (motivo !== 'follow-up ...').
    const destildado = await patchFollowup("lead_step_then_disposition", { step: "24hs", value: false });
    expect(destildado.status).toBe(200);
    expect(destildado.body.followUps["24hs"]).toBe(false);
    expect(destildado.body.lead.nextAction).toBeTruthy();
    expect(new Date(destildado.body.lead.nextAction.dueAt).toISOString()).toBe(manualDate);
    expect(destildado.body.lead.callbackAt).toBe(manualDate);
  });
});

describe("Read-path: _computeFollowupsDue deriva de nextAction (D-04)", () => {
  it("un lead con followUps legacy activo y SIN nextAction aparece con el step correcto (derivación sin migrar)", async () => {
    const r = await followupsToday();
    expect(r.status).toBe(200);
    const item = r.body.overdue.find((f) => f.leadId === "lead_legacy_followups");
    expect(item).toBeTruthy();
    expect(item.step).toBe("48hs");
    expect(item.label).toBe("48h");
  });

  it("un lead cuyo próximo paso es de cadencia (no_answer) NO aparece en /today ni suma al /badge", async () => {
    const before = await followupsBadge();
    const dispRes = await disp("lead_cadencia", { outcome: "no_answer" });
    expect(dispRes.status).toBe(200);
    expect(dispRes.body.lead.nextAction.origen).toBe("cadencia");
    expect(dispRes.body.lead.callbackAt).toBeTruthy(); // el espejo sigue vivo (D-03)

    const r = await followupsToday();
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    expect(all.find((f) => f.leadId === "lead_cadencia")).toBeUndefined();

    const after = await followupsBadge();
    expect(after.body.count).toBe(before.body.count); // no sumó al badge
  });

  it("un nextAction de cadencia YA VENCIDO tampoco aparece en overdue (recorte #150, no solo el filtro de status='future')", async () => {
    // Distinto del test anterior: acá el nextAction ya está VENCIDO (sembrado
    // directo), así que el único motivo por el que queda afuera es el
    // recorte explícito `origen === 'cadencia'` dentro de _computeFollowupsDue
    // — no el filtro de status='future' de /today (que un reintento recién
    // creado sí dispara, pero uno vencido no).
    const r = await followupsToday();
    const all = [...r.body.dueToday, ...r.body.dueYesterday, ...r.body.overdue];
    expect(all.find((f) => f.leadId === "lead_cadencia_due")).toBeUndefined();
  });

  it("un lead con callback MANUAL vencido aparece en overdue con step:'' cuando la fecha no matchea ninguna plantilla", async () => {
    const r = await followupsToday();
    const item = r.body.overdue.find((f) => f.leadId === "lead_manual_overdue");
    expect(item).toBeTruthy();
    expect(item.step).toBe("");
    expect(item.label).toBe("próximo paso");
  });

  it("badge sigue siendo dueToday+dueYesterday del setter (sin overdue, sin cadencia)", async () => {
    const r = await followupsToday();
    expect(r.body.counts.badge).toBe(r.body.counts.dueToday + r.body.counts.dueYesterday);
  });
});
