// Audit 2026-06-20 (#1) — RBAC del endpoint de transcripción Whisper.
// Antes era admin/supervisor only, pero el front graba+sube para cualquiera que
// llama → el setter recibía 403 tras subir el audio. Ahora el setter puede
// transcribir SUS leads; sigue bloqueado para leads ajenos. El ownership se
// chequea ANTES de gastar Whisper.
//
// No seteamos OPENAI_API_KEY: el caller autorizado llega al 503 (sin key), lo
// que PRUEBA que pasó el RBAC. El no-autorizado corta antes con 403.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `transcribe-rbac-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tr@local.test";
process.env.ADMIN_PASSWORD = "trpass1234";
process.env.JWT_SECRET = "test-secret-tr";
delete process.env.OPENAI_API_KEY; // forzar el 503 para el caller autorizado

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-tr@local.test", name: "AdminTR", role: "admin", status: "active", setterId: "", password: pwd("trpass1234") },
    { id: "u_setter", email: "setter-tr@local.test", name: "SetterTR", role: "setter", status: "active", setterId: "s_x", password: pwd("setterpass123") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_x", name: "X" }, { id: "s_other", name: "Other" }],
  variants: [],
  leads: {
    l_own: { num: 1, name: "Propio", phone: "+5215550000001", assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" },
    l_other: { num: 2, name: "Ajeno", phone: "+5215550000002", assignedTo: "s_other", conexion: "sin_wsp", estado: "sin_contactar" },
  },
  calendar: [], sessions: [],
}, null, 2));

const { app } = await import("../index.js");
let adminCookie = "";
let setterCookie = "";
beforeAll(async () => {
  const a = await request(app).post("/api/auth/login").send({ email: "admin-tr@local.test", password: "trpass1234" });
  adminCookie = (a.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
  const s = await request(app).post("/api/auth/login").send({ email: "setter-tr@local.test", password: "setterpass123" });
  setterCookie = (s.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("transcribe RBAC", () => {
  it("setter NO puede transcribir un lead ajeno → 403", async () => {
    const r = await request(app).post("/api/telnyx/calls/l_other/transcribe").set("Cookie", setterCookie).send({ setterAudioB64: "x" });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/este lead/i);
  });
  it("setter SÍ pasa el RBAC para su propio lead (corta en 503 por falta de OPENAI_API_KEY)", async () => {
    const r = await request(app).post("/api/telnyx/calls/l_own/transcribe").set("Cookie", setterCookie).send({ setterAudioB64: "x" });
    expect(r.status).toBe(503); // pasó ownership; falla solo por la key
  });
  it("admin pasa el RBAC para cualquier lead (503 por falta de key, no 403)", async () => {
    const r = await request(app).post("/api/telnyx/calls/l_other/transcribe").set("Cookie", adminCookie).send({ setterAudioB64: "x" });
    expect(r.status).toBe(503);
  });
});
