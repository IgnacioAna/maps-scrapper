// Phase 8 — Tests del proxy/geo por cuenta + policy del módulo WA.
// Setup idéntico a wa.test.js: NODE_ENV=test + DATA_DIR tmp + auth pre-poblado.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `wa-proxy-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admintest@local.test";
process.env.ADMIN_PASSWORD = "testpass1234";
process.env.ADMIN_NAME = "AdminTest";
process.env.JWT_SECRET = "test-secret-please-change";

import crypto from "node:crypto";
function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_test", email: "admintest@local.test", name: "AdminTest", role: "admin", status: "active", setterId: "", password: pwd("testpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_a", email: "settera@local.test", name: "Setter A", role: "setter", status: "active", setterId: "setter_a", password: pwd("passa"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: "user_setter_b", email: "setterb@local.test", name: "Setter B", role: "setter", status: "active", setterId: "setter_b", password: pwd("passb"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

let adminTok = "", setterATok = "", setterBTok = "";
let accountId = "";

async function api(method, p, body, tok) {
  const r = request(app)[method.toLowerCase()](p);
  if (tok) r.set("Authorization", `Bearer ${tok}`);
  if (body) r.send(body);
  return r;
}
async function login(email, password) {
  const r = await request(app).post("/api/auth/desktop-login").send({ email, password });
  return r.body;
}

beforeAll(async () => {
  adminTok = (await login("admintest@local.test", "testpass1234")).token;
  setterATok = (await login("settera@local.test", "passa")).token;
  setterBTok = (await login("setterb@local.test", "passb")).token;
  expect(adminTok && setterATok && setterBTok).toBeTruthy();
  // Setter A crea su propia cuenta (auto-asignada a setter_a)
  const r = await api("POST", "/api/wa/accounts", { label: "Cuenta A" }, setterATok);
  expect(r.status).toBe(200);
  accountId = r.body.id;
  expect(accountId).toBeTruthy();
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("proxy CRUD", () => {
  it("cuenta nueva arranca sin proxy (null)", async () => {
    const r = await api("GET", "/api/wa/accounts", null, setterATok);
    const acc = r.body.find((a) => a.id === accountId);
    expect(acc.proxy == null).toBe(true);
    expect(acc.geo == null).toBe(true);
  });

  it("setter dueño asigna proxy http con geo derivada del país", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, {
      proxy: { type: "http", host: "1.2.3.4", port: 8080, user: "u", pass: "secreto" },
      geo: { country: "MX" },
    }, setterATok);
    expect(r.status).toBe(200);
    expect(r.body.proxy.host).toBe("1.2.3.4");
    expect(r.body.proxy.type).toBe("http");
    // geo derivada de MX
    expect(r.body.geo.timezone).toBe("America/Mexico_City");
    expect(r.body.geo.locale).toBe("es-MX");
    expect(r.body.geo.country).toBe("MX");
  });

  it("la respuesta NUNCA expone proxy.pass en claro (solo hasPass)", async () => {
    const r = await api("GET", "/api/wa/accounts", null, setterATok);
    const acc = r.body.find((a) => a.id === accountId);
    expect(acc.proxy.pass).toBeUndefined();
    expect(acc.proxy.hasPass).toBe(true);
    expect(acc.proxy.user).toBe("u");
  });

  it("PATCH sin pass preserva el pass anterior", async () => {
    // cambiar el host sin mandar pass
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, {
      proxy: { type: "http", host: "9.9.9.9", port: 3128 },
    }, setterATok);
    expect(r.status).toBe(200);
    expect(r.body.proxy.host).toBe("9.9.9.9");
    expect(r.body.proxy.hasPass).toBe(true); // pass viejo preservado
  });

  it("type inválido → 400", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, {
      proxy: { type: "vmess", host: "1.1.1.1", port: 80 },
    }, setterATok);
    expect(r.status).toBe(400);
  });

  it("port inválido → 400", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, {
      proxy: { type: "socks5", host: "1.1.1.1", port: 99999 },
    }, setterATok);
    expect(r.status).toBe(400);
  });

  it("setter ajeno NO puede tocar la cuenta → 403", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, {
      proxy: { type: "http", host: "5.5.5.5", port: 8080 },
    }, setterBTok);
    expect(r.status).toBe(403);
  });

  it("admin puede tocar cualquier cuenta", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, {
      proxy: { type: "socks5", host: "7.7.7.7", port: 1080 },
    }, adminTok);
    expect(r.status).toBe(200);
    expect(r.body.proxy.type).toBe("socks5");
  });

  it("proxy:null limpia proxy y geo", async () => {
    const r = await api("PATCH", `/api/wa/accounts/${accountId}/proxy`, { proxy: null }, setterATok);
    expect(r.status).toBe(200);
    expect(r.body.proxy).toBe(null);
    expect(r.body.geo).toBe(null);
  });

  it("404 si la cuenta no existe", async () => {
    const r = await api("PATCH", `/api/wa/accounts/no_existe/proxy`, { proxy: null }, adminTok);
    expect(r.status).toBe(404);
  });
});

describe("policy", () => {
  it("GET policy default requireProxyForCampaigns=false", async () => {
    const r = await api("GET", "/api/wa/policy", null, setterATok);
    expect(r.status).toBe(200);
    expect(r.body.requireProxyForCampaigns).toBe(false);
  });

  it("admin puede activar requireProxyForCampaigns", async () => {
    const r = await api("PUT", "/api/wa/policy", { requireProxyForCampaigns: true }, adminTok);
    expect(r.status).toBe(200);
    expect(r.body.requireProxyForCampaigns).toBe(true);
  });

  it("setter NO puede cambiar policy → 403", async () => {
    const r = await api("PUT", "/api/wa/policy", { requireProxyForCampaigns: false }, setterATok);
    expect(r.status).toBe(403);
  });
});

describe("export incluye proxy + policy (sobrevive redeploy)", () => {
  it("admin export trae accounts con policy", async () => {
    const r = await api("GET", "/api/wa/admin/export", null, adminTok);
    expect(r.status).toBe(200);
    expect(r.body.accounts).toBeTruthy();
    expect(r.body.accounts.policy).toBeTruthy();
    expect(r.body.accounts.policy.requireProxyForCampaigns).toBe(true);
    expect(Array.isArray(r.body.accounts.accounts)).toBe(true);
  });
});
