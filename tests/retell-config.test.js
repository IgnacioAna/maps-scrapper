// Tests de la config del agente de voz Retell (Phase 24, plan 24-02).
//
// Cobertura:
//  - RBAC (401/403/200) + no-leak de secrets en el GET
//  - Env-sourced (D-24-01): 409 en el PUT, envSourced en el GET, self-healing
//    del JSON, overlay efectivo
//  - webhookSecret con fallback a apiKey (research §2.1 — Retell NO tiene un
//    signing secret separado)
//  - Validaciones del PUT (dailyCap, enabled, campos omitidos, rotationIdx)
//  - Persistencia: export-data incluye los 2 bloques nuevos sin filtrar el
//    valor de un secret env-sourced; round-trip de import-data
//  - Pseudo-SDR setter_agente_ia: visible, no admin-only, fila comparable en
//    team-performance con su llamada atribuida por assignedTo
//
// Regla #121: env vars se setean a "" (nunca `delete`) para que dotenv no las
// repueble desde .env al re-cargar el módulo en otro test file del mismo run.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `retell-config-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-retell@local.test";
process.env.ADMIN_PASSWORD = "retellpass1234";
process.env.ADMIN_NAME = "AdminRetell";
process.env.JWT_SECRET = "test-secret-retell";
// Regla #121: nunca `delete process.env.X` — se setea a "" para que dotenv no
// las repueble desde .env al re-cargar el módulo.
process.env.RETELL_API_KEY = "";
process.env.RETELL_WEBHOOK_SECRET = "";
process.env.RETELL_TOOL_SECRET = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const RETELL_CONFIG_PATH = path.join(tmpData, "retell_config.json");

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_retell", email: "admin-retell@local.test", name: "AdminRetell", role: "admin", status: "active", setterId: "", password: pwd("retellpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_super_retell", email: "super-retell@local.test", name: "SuperRetell", role: "supervisor", status: "active", setterId: "", password: pwd("superpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_retell", email: "setter-retell@local.test", name: "SetterRetell", role: "setter", status: "active", setterId: "setter_retell_human", password: pwd("setterpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

// El seed de boot del pseudo-SDR está apagado en test (NODE_ENV==='test') —
// setter_agente_ia se pre-puebla acá para que el test pruebe la coexistencia,
// no el seed. Un lead con callLog `by:''` + `channel:'retell'` — la
// atribución cae sola por `assignedTo` (_callSetterId), sin código nuevo.
fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [
      { id: "setter_agente_ia", name: "Agente IA", activeVariantId: "", createdAt: new Date().toISOString() },
      { id: "setter_retell_human", name: "SetterRetell", activeVariantId: "", createdAt: new Date().toISOString() },
    ],
    variants: [],
    leads: {
      lead_agent_1: {
        id: "lead_agent_1", num: 1, name: "ClinicaAgente", phone: "+525550000123",
        country: "México", city: "CDMX", assignedTo: "setter_agente_ia", estado: "sin_contactar",
        callLog: [
          { ts: new Date().toISOString(), outcome: "answered_interested", duration: 45, by: "", channel: "retell" },
        ],
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, lastPages: {} }, null, 2));

const { app } = await import("../index.js");

let adminCookie = "";
let supervisorCookie = "";
let setterCookie = "";

async function loginCookie(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  return (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session="))?.split(";")[0] || "";
}

beforeAll(async () => {
  adminCookie = await loginCookie("admin-retell@local.test", "retellpass1234");
  supervisorCookie = await loginCookie("super-retell@local.test", "superpass1234");
  setterCookie = await loginCookie("setter-retell@local.test", "setterpass1234");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("GET /api/retell/config — RBAC y no-leak", () => {
  it("sin sesión → 401", async () => {
    const r = await request(app).get("/api/retell/config");
    expect(r.status).toBe(401);
  });

  it("setter → 403", async () => {
    const r = await request(app).get("/api/retell/config").set("Cookie", setterCookie);
    expect(r.status).toBe(403);
  });

  it("supervisor → 403 (a diferencia de Telnyx, sin vista reducida)", async () => {
    const r = await request(app).get("/api/retell/config").set("Cookie", supervisorCookie);
    expect(r.status).toBe(403);
  });

  it("admin → 200 con el shape esperado", async () => {
    const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("hasApiKey");
    expect(r.body).toHaveProperty("hasWebhookSecret");
    expect(r.body).toHaveProperty("hasToolSecret");
    expect(r.body).toHaveProperty("envSourced");
    expect(r.body).toHaveProperty("agentId");
    expect(r.body).toHaveProperty("dailyCap");
    expect(r.body).toHaveProperty("enabled");
    expect(r.body).toHaveProperty("rotationIdx");
    expect(r.body).toHaveProperty("whatsappReturn");
    expect(r.body).toHaveProperty("webhook");
    expect(r.body.webhook).toEqual({ rejects: 0, lastReject: null, lastEventAt: null, eventCount: 0 });
  });

  it("PUT de apiKey + GET → la respuesta no incluye el valor literal del secret", async () => {
    const secretValue = "sk-retell-literal-secret-do-not-leak-98765";
    const put = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ apiKey: secretValue });
    expect(put.status).toBe(200);
    const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.hasApiKey).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(secretValue);
  });
});

describe("PUT /api/retell/config — env-sourced (D-24-01)", () => {
  it("con RETELL_API_KEY seteada, el PUT que manda apiKey responde 409 y nombra el campo", async () => {
    process.env.RETELL_API_KEY = "env-sourced-real-key";
    try {
      const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ apiKey: "sk-should-be-blocked" });
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body.blocked)).toContain("apiKey");
    } finally {
      process.env.RETELL_API_KEY = "";
    }
  });

  it("con RETELL_API_KEY seteada, el PUT que manda solo agentId responde 200 (no bloquea los demás campos)", async () => {
    process.env.RETELL_API_KEY = "env-sourced-real-key";
    try {
      const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ agentId: "agent_xyz_123" });
      expect(r.status).toBe(200);
      expect(r.body.agentId).toBe("agent_xyz_123");
    } finally {
      process.env.RETELL_API_KEY = "";
    }
  });

  it("envSourced.apiKey === true en el GET cuando la env var está seteada", async () => {
    process.env.RETELL_API_KEY = "env-sourced-real-key";
    try {
      const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
      expect(r.body.envSourced.apiKey).toBe(true);
      expect(r.body.hasApiKey).toBe(true);
    } finally {
      process.env.RETELL_API_KEY = "";
    }
  });

  it("self-healing: apiKey viejo en el JSON se limpia a '' cuando la env var manda", async () => {
    // Pre-poblar el JSON crudo con un apiKey (simula panel pre-migración a env vars).
    const raw = JSON.parse(fs.readFileSync(RETELL_CONFIG_PATH, "utf8"));
    raw.apiKey = "old-json-secret-pre-migracion";
    fs.writeFileSync(RETELL_CONFIG_PATH, JSON.stringify(raw, null, 2));

    process.env.RETELL_API_KEY = "env-sourced-real-key";
    try {
      const put = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ agentId: "agent_self_heal" });
      expect(put.status).toBe(200);
      const onDisk = JSON.parse(fs.readFileSync(RETELL_CONFIG_PATH, "utf8"));
      expect(onDisk.apiKey).toBe("");
    } finally {
      process.env.RETELL_API_KEY = "";
    }
  });

  it("overlay: con la env var seteada, el valor efectivo del server es el de env (indirecto vía hasApiKey tras limpiar el JSON)", async () => {
    // Vaciar apiKey del JSON explícitamente (sin env activa en este momento).
    const clear = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ apiKey: "" });
    expect(clear.status).toBe(200);
    expect(clear.body.hasApiKey).toBe(false);

    process.env.RETELL_API_KEY = "env-sourced-real-key";
    try {
      // El JSON en disco tiene apiKey:"" pero el server sigue calculando
      // hasApiKey:true porque el valor EFECTIVO (overlay) viene de env.
      const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
      expect(r.body.hasApiKey).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(RETELL_CONFIG_PATH, "utf8"));
      expect(onDisk.apiKey).toBe("");
    } finally {
      process.env.RETELL_API_KEY = "";
    }
  });
});

describe("webhookSecret con fallback a apiKey (research §2.1)", () => {
  it("preparación: vaciar apiKey/webhookSecret/toolSecret (sin env activa)", async () => {
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ apiKey: "", webhookSecret: "", toolSecret: "" });
    expect(r.status).toBe(200);
    expect(r.body.hasApiKey).toBe(false);
    expect(r.body.hasWebhookSecret).toBe(false);
  });

  it("sin ninguno de los dos → hasWebhookSecret es false", async () => {
    const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(r.body.hasApiKey).toBe(false);
    expect(r.body.hasWebhookSecret).toBe(false);
  });

  it("con apiKey cargado y sin webhookSecret → hasWebhookSecret es true (cae al apiKey)", async () => {
    const put = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ apiKey: "sk-fallback-source-of-truth" });
    expect(put.status).toBe(200);
    const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(r.body.hasApiKey).toBe(true);
    expect(r.body.hasWebhookSecret).toBe(true);
  });
});

describe("PUT /api/retell/config — validaciones", () => {
  it("dailyCap fuera de rango (negativo) no se persiste", async () => {
    const base = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ dailyCap: 75 });
    expect(base.body.dailyCap).toBe(75);
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ dailyCap: -5 });
    expect(r.status).toBe(200);
    expect(r.body.dailyCap).toBe(75);
  });

  it("dailyCap fuera de rango (>500) no se persiste", async () => {
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ dailyCap: 999 });
    expect(r.status).toBe(200);
    expect(r.body.dailyCap).toBe(75);
  });

  it("dailyCap no-numérico no se persiste", async () => {
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ dailyCap: "no-es-un-numero" });
    expect(r.status).toBe(200);
    expect(r.body.dailyCap).toBe(75);
  });

  it("enabled no-boolean se ignora", async () => {
    const base = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ enabled: true });
    expect(base.body.enabled).toBe(true);
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ enabled: "yes" });
    expect(r.status).toBe(200);
    expect(r.body.enabled).toBe(true);
  });

  it("un campo omitido conserva su valor anterior", async () => {
    const before = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ whatsappReturn: "+5491122334455" });
    expect(r.status).toBe(200);
    expect(r.body.dailyCap).toBe(before.body.dailyCap);
    expect(r.body.enabled).toBe(before.body.enabled);
    expect(r.body.whatsappReturn).toBe("+5491122334455");
  });

  it("rotationIdx mandado por el body NO cambia el valor persistido", async () => {
    const before = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    const r = await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ rotationIdx: 7, agentId: "agent_rotation_test" });
    expect(r.status).toBe(200);
    expect(r.body.rotationIdx).toBe(before.body.rotationIdx);
    expect(r.body.agentId).toBe("agent_rotation_test");
  });
});

describe("Persistencia (regla #21)", () => {
  it("GET /api/admin/export-data incluye retellConfig y retellEvents", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("retellConfig");
    expect(r.body).toHaveProperty("retellEvents");
    expect(Array.isArray(r.body.retellEvents.events)).toBe(true);
  });

  it("el export NO incluye el valor del apiKey cuando viene de env", async () => {
    process.env.RETELL_API_KEY = "env-sourced-should-not-leak-in-export";
    try {
      // Cualquier PUT dispara el self-healing (limpia el JSON a "" para el
      // campo env-sourced) antes de exportar.
      await request(app).put("/api/retell/config").set("Cookie", adminCookie).send({ agentId: "agent_pre_export" });
      const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
      expect(r.status).toBe(200);
      expect(r.body.retellConfig.apiKey).toBe("");
      expect(JSON.stringify(r.body.retellConfig)).not.toContain("env-sourced-should-not-leak-in-export");
    } finally {
      process.env.RETELL_API_KEY = "";
    }
  });

  it("round-trip: import-data con retellConfig {agentId, dailyCap} restaura esos valores", async () => {
    const imp = await request(app).post("/api/admin/import-data").set("Cookie", adminCookie).send({
      retellConfig: {
        apiKey: "", webhookSecret: "", toolSecret: "",
        agentId: "agent_roundtrip_restored", fromNumberId: "", dailyCap: 33,
        enabled: false, rotationIdx: 0, whatsappReturn: "",
        updatedAt: new Date().toISOString(), updatedBy: "test_roundtrip",
      },
    });
    expect(imp.status).toBe(200);
    expect(imp.body.restored).toContain("retellConfig");
    const r = await request(app).get("/api/retell/config").set("Cookie", adminCookie);
    expect(r.body.agentId).toBe("agent_roundtrip_restored");
    expect(r.body.dailyCap).toBe(33);
  });
});

describe("Pseudo-SDR setter_agente_ia (D-24-09)", () => {
  it("globalThis.__voiceAgent.VOICE_AGENT_SETTER_ID === 'setter_agente_ia'", () => {
    expect(globalThis.__voiceAgent).toBeTruthy();
    expect(globalThis.__voiceAgent.VOICE_AGENT_SETTER_ID).toBe("setter_agente_ia");
  });

  it("GET /api/setters como admin devuelve al agente, no oculto", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const agent = (r.body.setters || []).find((s) => s.id === "setter_agente_ia");
    expect(agent).toBeTruthy();
    expect(agent.hidden).toBeFalsy();
  });

  it("GET /api/setters como supervisor sin restricción también lo ve (ADMIN_ONLY_SETTER_IDS no lo contiene)", async () => {
    const r = await request(app).get("/api/setters").set("Cookie", supervisorCookie);
    expect(r.status).toBe(200);
    const agent = (r.body.setters || []).find((s) => s.id === "setter_agente_ia");
    expect(agent).toBeTruthy();
  });

  it("GET /api/setters/team-performance como admin devuelve una fila con setterId === 'setter_agente_ia' y su llamada contada", async () => {
    const r = await request(app).get("/api/setters/team-performance").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const row = (r.body.callsByDay?.perSetter || []).find((s) => s.setterId === "setter_agente_ia");
    expect(row).toBeTruthy();
    const totalDials = (row.dials || []).reduce((a, b) => a + b, 0);
    expect(totalDials).toBeGreaterThan(0);
    const perSetterRow = (r.body.perSetter || []).find((s) => s.id === "setter_agente_ia");
    expect(perSetterRow).toBeTruthy();
    expect(perSetterRow.current.dials).toBeGreaterThan(0);
  });
});
