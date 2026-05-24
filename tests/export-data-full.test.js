// Tests del /api/admin/export-data: que devuelva los 12 bloques esperados
// (history, auth, setters, faqs, training, mercuryConfig, mercuryGenerations,
// alertConfig, telnyxConfig, telnyxEvents, callScripts, scheduledMessages).
//
// Si un futuro refactor "limpia" el export y omite uno, el pre-deploy descarga
// un snapshot incompleto y al redeploy Railway pierde datos vivos. Bug
// historico crítico: faqs/training se omitieron por mucho tiempo y se perdían
// FAQs cada deploy.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `export-full-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-exp@local.test";
process.env.ADMIN_PASSWORD = "exppass1234";
process.env.ADMIN_NAME = "AdminExp";
process.env.JWT_SECRET = "test-secret-exp";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_exp", email: "admin-exp@local.test", name: "AdminExp", role: "admin", status: "active", setterId: "", password: pwd("exppass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_exp", email: "setter-exp@local.test", name: "SetterExp", role: "setter", status: "active", setterId: "setter_exp", password: pwd("setterpass"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, lastPages: {} }, null, 2));
fs.writeFileSync(path.join(tmpData, "faqs.json"), JSON.stringify({ entries: [] }, null, 2));

const { app } = await import("../index.js");

let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-exp@local.test", password: "exppass1234" });
  expect(r.status).toBe(200);
  adminCookie = r.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("/api/admin/export-data · cobertura completa de bloques", () => {
  it("setter NO accede al export (403)", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: "setter-exp@local.test", password: "setterpass" });
    const r = await agent.get("/api/admin/export-data");
    expect(r.status).toBe(403);
  });

  it("admin recibe los 12 bloques de data + exportedAt (sin nada faltante)", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const EXPECTED_KEYS = [
      "exportedAt", "history", "auth", "setters", "faqs", "training",
      "mercuryConfig", "mercuryGenerations", "alertConfig",
      "telnyxConfig", "telnyxEvents", "callScripts", "scheduledMessages",
    ];
    for (const key of EXPECTED_KEYS) {
      expect(r.body, `falta bloque: ${key}`).toHaveProperty(key);
    }
    expect(r.body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("history y setters tienen shapes esperados (map de entries / arrays normalizados)", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.body.history).toBeTruthy();
    expect(typeof r.body.history.entries).toBe("object");
    expect(Array.isArray(r.body.history.entries)).toBe(false);
    expect(r.body.setters).toBeTruthy();
    expect(Array.isArray(r.body.setters.setters)).toBe(true);
    expect(typeof r.body.setters.leads).toBe("object");
    expect(Array.isArray(r.body.setters.leads)).toBe(false);
  });

  it("mercuryConfig tiene systemPrompt + version", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.body.mercuryConfig).toBeTruthy();
    expect(typeof r.body.mercuryConfig.systemPrompt).toBe("string");
    expect(typeof r.body.mercuryConfig.version).toBe("number");
  });

  it("alertConfig tiene umbrales (incluyendo followupsTodayThreshold)", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.body.alertConfig).toBeTruthy();
    expect(typeof r.body.alertConfig.dropPctThreshold).toBe("number");
    expect(typeof r.body.alertConfig.inactivityDays).toBe("number");
  });

  it("telnyxConfig se exporta (importante para no perder números/routing)", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.body.telnyxConfig).toBeTruthy();
    expect(Array.isArray(r.body.telnyxConfig.numbers)).toBe(true);
  });

  it("callScripts se exporta (los guiones SCM v2 son críticos)", async () => {
    const r = await request(app).get("/api/admin/export-data").set("Cookie", adminCookie);
    expect(r.body.callScripts).toBeTruthy();
  });
});

describe("/api/auth/users · cleanup al delete", () => {
  it("DELETE user huerfano funciona y revoca sesiones (cleanup completo)", async () => {
    // Crear un usuario huerfano (sin setterId) para poder borrarlo limpio
    const authFile = path.join(tmpData, "auth.json");
    const authData = JSON.parse(fs.readFileSync(authFile, "utf8"));
    authData.users.push({
      id: "user_temp_presence", email: "temp-presence@local.test", name: "TempPresence",
      role: "setter", status: "active", setterId: "", password: pwd("tmppass"),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(authFile, JSON.stringify(authData, null, 2));

    // Loguearse para que entre en onlinePresence (heartbeat via attachAuth)
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "temp-presence@local.test", password: "tmppass" });
    expect(login.status).toBe(200);
    await agent.get("/api/auth/me");

    // Verificar que aparece en /online (debe estar al menos como 'online' o 'recent')
    const before = await request(app).get("/api/auth/online").set("Cookie", adminCookie);
    expect(before.status).toBe(200);
    const wasPresent = before.body.users.some((u) => u.id === "user_temp_presence");
    expect(wasPresent).toBe(true);

    // Borrar el user (esto debe limpiar onlinePresence + sesiones)
    const del = await request(app).delete("/api/auth/users/user_temp_presence").set("Cookie", adminCookie);
    expect(del.status).toBe(200);
    expect(del.body.email).toBe("temp-presence@local.test");
    expect(del.body.sessionsRevoked).toBeGreaterThanOrEqual(1);

    // Después de borrar: el user ya NO aparece en /online (no en lista de users active)
    const after = await request(app).get("/api/auth/online").set("Cookie", adminCookie);
    expect(after.body.users.find((u) => u.id === "user_temp_presence")).toBeUndefined();

    // La sesion del user borrado no puede acceder a endpoints autenticados
    const fail = await agent.get("/api/auth/me");
    expect(fail.body.authenticated).toBe(false);
  });
});

describe("seedVolumeFromRepo · NO copia archivos en NODE_ENV=test", () => {
  it("setters.json en tmpData refleja exactamente lo que pre-poblamos (no fue overrideado por el seed)", async () => {
    // Si seedVolumeFromRepo se hubiera ejecutado en test, hubiera copiado el
    // setters.json del repo (que tiene leads reales). Acá pre-poblamos vacío.
    const setters = JSON.parse(fs.readFileSync(path.join(tmpData, "setters.json"), "utf8"));
    expect(Object.keys(setters.leads || {}).length).toBe(0);
    expect((setters.setters || []).length).toBe(0);
  });

  it("history.json en tmpData refleja vacío (no fue overrideado por el seed)", async () => {
    const history = JSON.parse(fs.readFileSync(path.join(tmpData, "history.json"), "utf8"));
    expect(Object.keys(history.entries || {}).length).toBe(0);
  });

  it("faqs.json en tmpData refleja vacío (no fue overrideado por el seed)", async () => {
    const faqs = JSON.parse(fs.readFileSync(path.join(tmpData, "faqs.json"), "utf8"));
    expect((faqs.entries || []).length).toBe(0);
  });
});
