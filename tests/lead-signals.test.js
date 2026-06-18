// Phase 16 — Lead Signals / Brief: computeLeadSignals + barrida (backfill-signals).
// Verifica las señales derivadas de rating/reviews/web/instagram, el filtro de
// website-basura (wa.me), reputationTier, idempotencia y que los leads las cargan.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `signals-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-sig@local.test";
process.env.ADMIN_PASSWORD = "sigpass1234";
process.env.ADMIN_NAME = "AdminSig";
process.env.JWT_SECRET = "test-secret-sig";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [{ id: "u_sig", email: "admin-sig@local.test", name: "AdminSig", role: "admin", status: "active", setterId: "", password: pwd("sigpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    invites: [], sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "s_x", name: "X" }],
    variants: [],
    leads: {
      // 4.8★ + 600 reseñas + sin web → muchas_reviews_sin_web · fuerte
      l_gap: { num: 1, name: "Gap", phone: "+5215550000001", assignedTo: "s_x", conexion: "sin_wsp", rating: "4.8", reviews: 600, website: "" },
      // 4.2★ + 50 reseñas + web real → rating_bajo · debil
      l_low: { num: 2, name: "Low", phone: "+5215550000002", assignedTo: "s_x", conexion: "sin_wsp", rating: "4.2", reviews: 50, website: "https://low.com" },
      // 4.8★ + 20 reseñas + web → pocas_reviews · fuerte
      l_pocas: { num: 3, name: "Pocas", phone: "+5215550000003", assignedTo: "s_x", conexion: "sin_wsp", rating: "4.8", reviews: 20, website: "https://pocas.com" },
      // sin rating + sin reviews + instagram + sin web → ig_sin_web · desconocido
      l_ig: { num: 4, name: "IG", phone: "+5215550000004", assignedTo: "s_x", conexion: "sin_wsp", rating: "", reviews: 0, website: "", instagram: "@clinica" },
      // 4.6★ + 200 reseñas + website=wa.me (basura) → muchas_reviews_sin_web · medio
      l_wajunk: { num: 5, name: "WaJunk", phone: "+5215550000005", assignedTo: "s_x", conexion: "sin_wsp", rating: "4.6", reviews: 200, website: "https://wa.me/521555" },
    },
    calendar: [], sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");
let adminCookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-sig@local.test", password: "sigpass1234" });
  expect(r.status).toBe(200);
  adminCookie = (r.headers["set-cookie"] || []).find((c) => c.startsWith("gs_session=")).split(";")[0];
});

afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

describe("backfill-signals · barrida", () => {
  it("dryRun reporta tiers y señales sin escribir", async () => {
    const r = await request(app).post("/api/admin/backfill-signals").set("Cookie", adminCookie).send({ dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.scanned).toBe(5);
    expect(r.body.updated).toBe(0); // dryRun no persiste
    expect(r.body.bySignal.muchas_reviews_sin_web).toBe(2); // l_gap + l_wajunk (web=wa.me filtrada)
    expect(r.body.bySignal.rating_bajo).toBe(1);
    expect(r.body.bySignal.pocas_reviews).toBe(1);
    expect(r.body.bySignal.ig_sin_web).toBe(1);
    expect(r.body.byTier.fuerte).toBe(2);
    expect(r.body.byTier.debil).toBe(1);
    expect(r.body.byTier.medio).toBe(1);
    expect(r.body.byTier.desconocido).toBe(1);
  });

  it("ejecuta la barrida: recomputa y persiste para todos", async () => {
    const r = await request(app).post("/api/admin/backfill-signals").set("Cookie", adminCookie).send({});
    expect(r.body.scanned).toBe(5);
    expect(r.body.updated).toBe(5);
    expect(r.body.withAngle).toBe(5); // todos tienen al menos una señal
  });

  it("es idempotente (segunda corrida = mismos conteos)", async () => {
    const r = await request(app).post("/api/admin/backfill-signals").set("Cookie", adminCookie).send({});
    expect(r.body.bySignal.muchas_reviews_sin_web).toBe(2);
    expect(r.body.bySignal.rating_bajo).toBe(1);
    expect(r.body.byTier.fuerte).toBe(2);
  });

  it("los leads cargan signals + openingAngle vía la API que usa el frontend", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp?include=callable").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    const leads = r.body.leads || [];
    const gap = leads.find((l) => l.id === "l_gap" || l._id === "l_gap" || l.num === 1);
    expect(gap).toBeTruthy();
    expect(gap.signals).toContain("muchas_reviews_sin_web");
    expect(gap.reputationTier).toBe("fuerte");
    expect(typeof gap.openingAngle).toBe("string");
    expect(gap.openingAngle.length).toBeGreaterThan(0);
    expect(gap.hasWebsite).toBe(false);
  });
});
