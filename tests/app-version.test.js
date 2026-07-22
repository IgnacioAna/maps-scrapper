// Test de GET /api/version (2026-07-22): el frontend compara su cache-buster
// contra este endpoint para detectar tabs corriendo código viejo post-deploy
// (banner "Actualizar"). Debe devolver el v= de app.js en public/index.html.

import { describe, it, expect } from "vitest";
import request from "supertest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const tmpData = path.join(os.tmpdir(), `appver-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-av@local.test";
process.env.ADMIN_PASSWORD = "avpass1234";
process.env.JWT_SECRET = "test-secret-av";

fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));
fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, lastPages: {} }, null, 2));

const { app } = await import("../index.js");

describe("GET /api/version", () => {
  it("devuelve la versión del build (cache-buster de app.js) sin auth", async () => {
    const res = await request(app).get("/api/version");
    expect(res.status).toBe(200);
    expect(typeof res.body.version).toBe("string");
    expect(res.body.version.length).toBeGreaterThan(0);
    // Debe matchear exactamente el buster del index.html servido
    const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
    const expected = (html.match(/app\.js\?v=([0-9a-z]+)/i) || [])[1];
    expect(res.body.version).toBe(expected);
  });
});
