// Test del backfill de país desde el prefijo del teléfono.
// - ensureLeadDefaults deriva país en memoria cuando falta.
// - POST /api/admin/backfill-country lo persiste (solo si está vacío, idempotente).

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `country-bf-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-cb@local.test";
process.env.ADMIN_PASSWORD = "cbpass1234";
process.env.ADMIN_NAME = "AdminCB";
process.env.JWT_SECRET = "test-secret-cb";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [{ id: "user_admin_cb", email: "admin-cb@local.test", name: "AdminCB", role: "admin", status: "active", setterId: "", password: pwd("cbpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "s_cb", name: "S" }],
    variants: [],
    leads: {
      l_mx: { num: 1, name: "MX", phone: "+52 55 1234 5678", assignedTo: "s_cb", estado: "sin_contactar", country: "" },
      l_co: { num: 2, name: "CO", phone: "+573001112233", assignedTo: "s_cb", estado: "sin_contactar", country: "" },
      l_bo: { num: 3, name: "BO", phone: "+59171234567", assignedTo: "s_cb", estado: "sin_contactar", country: "" }, // 591 antes que 5/59
      l_keep: { num: 4, name: "YA TIENE", phone: "+5491111", assignedTo: "s_cb", estado: "sin_contactar", country: "Argentina" }, // no se pisa
      l_nophone: { num: 5, name: "SIN TEL", phone: "", assignedTo: "s_cb", estado: "sin_contactar", country: "" },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-cb@local.test", password: "cbpass1234" });
  expect(r.status).toBe(200);
  adminCookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("Backfill país desde prefijo", () => {
  it("dryRun no persiste pero reporta", async () => {
    const r = await request(app).post("/api/admin/backfill-country").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.filled).toBe(3); // mx, co, bo (no l_keep, no l_nophone)
    expect(r.body.byCountry).toEqual({ "México": 1, "Colombia": 1, "Bolivia": 1 });
  });

  it("persiste y es idempotente, sin pisar país existente", async () => {
    const r1 = await request(app).post("/api/admin/backfill-country").set("Cookie", adminCookie).send({});
    expect(r1.body.filled).toBe(3);
    // segunda corrida: nada nuevo (ya están llenos)
    const r2 = await request(app).post("/api/admin/backfill-country").set("Cookie", adminCookie).send({});
    expect(r2.body.filled).toBe(0);
  });

  it("191 Bolivia se prioriza sobre prefijos cortos (matching más largo primero)", async () => {
    const r = await request(app).post("/api/admin/backfill-country").set("Cookie", adminCookie).send({ dryRun: true });
    // ya está persistido, así que dryRun reporta 0 — pero verificamos que el país quedó bien vía el endpoint de leads
    const leads = await request(app).get("/api/setters/leads?setter=s_cb").set("Cookie", adminCookie);
    const bo = (leads.body.leads || []).find((l) => l.id === "l_bo");
    expect(bo.country).toBe("Bolivia");
    const keep = (leads.body.leads || []).find((l) => l.id === "l_keep");
    expect(keep.country).toBe("Argentina"); // no se pisó
  });
});
