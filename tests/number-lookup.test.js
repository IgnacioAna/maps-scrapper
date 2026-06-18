// Phase 10 B2 — Telnyx Number Lookup: parser puro + wrapper con fetch mockeado.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const tmpData = path.join(os.tmpdir(), `lookup-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-lk@local.test";
process.env.ADMIN_PASSWORD = "lkpass1234";
process.env.JWT_SECRET = "test-secret-lk";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [{ id: "u", email: "admin-lk@local.test", name: "A", role: "admin", status: "active", setterId: "", password: pwd("lkpass1234") }], invites: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

await import("../index.js");
const { _parseTelnyxLookup, _telnyxNumberLookup } = globalThis.__phase16;

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

const mkResp = (json) => ({ ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) });

describe("_parseTelnyxLookup", () => {
  it("móvil", () => {
    expect(_parseTelnyxLookup({ data: { carrier: { type: "mobile", name: "Telcel" } } })).toEqual({ phoneType: "mobile", carrier: "Telcel", reachable: true });
  });
  it("fixed_line → landline", () => {
    expect(_parseTelnyxLookup({ data: { carrier: { type: "fixed_line", name: "Telmex" } } }).phoneType).toBe("landline");
  });
  it("voip", () => {
    expect(_parseTelnyxLookup({ data: { carrier: { type: "voip" } } }).phoneType).toBe("voip");
  });
  it("sin data → vacío, no reachable", () => {
    expect(_parseTelnyxLookup({})).toEqual({ phoneType: "", carrier: "", reachable: false });
  });
});

describe("_telnyxNumberLookup (fetch mockeado)", () => {
  it("ok → devuelve phoneType del carrier", async () => {
    const fetchImpl = async () => mkResp({ data: { carrier: { type: "mobile", name: "Movistar" } } });
    const r = await _telnyxNumberLookup("KEY", "+5215550000001", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.phoneType).toBe("mobile");
    expect(r.carrier).toBe("Movistar");
  });
  it("sin api key → ok:false", async () => {
    const r = await _telnyxNumberLookup("", "+521", { fetchImpl: async () => mkResp({}) });
    expect(r.ok).toBe(false);
  });
  it("error HTTP → ok:false sin tirar", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "not found" });
    const r = await _telnyxNumberLookup("KEY", "+521", { fetchImpl });
    expect(r.ok).toBe(false);
  });
});
