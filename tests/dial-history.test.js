// Plan 33-04 (DIAL-04): la ficha del lead pone al frente el historial de las
// vendedoras — última disposición, quién la marcó, la última nota y el
// compromiso pendiente — antes de discar. Este archivo cubre:
//   (a) Task 1 — backend: `userNames` en GET /api/setters/leads/sin-wsp
//       resuelve callLog[].by a un nombre, sin exponer emails ni el padrón
//       completo (T-33-12).
//   (b) Task 3 — el bloque puro `[33-04] HISTORY-PURE` (_leadHistoryBrief +
//       _leadHistoryHTML), extraído con `new Function` y evaluado con un
//       reloj FIJO (nunca Date.now() real), más el cableado en las 3
//       superficies y el cache-buster.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `dial-history-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-dh@local.test";
process.env.ADMIN_PASSWORD = "adminpass1";
process.env.ADMIN_NAME = "AdminDH";
process.env.JWT_SECRET = "test-secret-dh";
// String vacio, NUNCA delete (dotenv re-carga el .env local si se borran).
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

const now = new Date().toISOString();

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin", email: "admin-dh@local.test", name: "AdminDH", role: "admin", status: "active", setterId: "", password: pwd("adminpass1"), createdAt: now, updatedAt: now },
      { id: "user_judith", email: "judith@local.test", name: "Judith Mendez", role: "setter", status: "active", setterId: "setter_judith", password: pwd("judithpass1"), createdAt: now, updatedAt: now },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(
  path.join(tmpData, "setters.json"),
  JSON.stringify({
    setters: [{ id: "setter_judith", name: "Judith Mendez" }],
    variants: [],
    leads: {
      // by de un usuario EXISTENTE + by de un usuario BORRADO en el mismo callLog.
      lead_mixto: {
        id: "lead_mixto", num: 1, name: "Mixto", phone: "+5215500000001", country: "México",
        assignedTo: "setter_judith", estado: "sin_contactar", conexion: "sin_wsp",
        callLog: [
          { ts: now, outcome: "no_answer", duration: 0, by: "user_borrado_inexistente" },
          { ts: now, outcome: "answered_interested", duration: 40, by: "user_judith" },
        ],
      },
    },
    calendar: [],
    sessions: [],
  }, null, 2)
);

const { app } = await import("../index.js");

async function login(email, password) {
  const r = await request(app).post("/api/auth/login").send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers["set-cookie"] || [];
  return (cookies.find((c) => c.startsWith("gs_session=")) || "").split(";")[0];
}

let adminCookie = "";

beforeAll(async () => {
  adminCookie = await login("admin-dh@local.test", "adminpass1");
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("GET /leads/sin-wsp — userNames (Task 1, DIAL-04)", () => {
  it("responde con la clave userNames además de leads (shape aditivo)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.leads)).toBe(true);
    expect(typeof r.body.userNames).toBe("object");
  });

  it("incluye el nombre del usuario existente referenciado en callLog[].by", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.userNames.user_judith).toBe("Judith Mendez");
  });

  it("NO incluye el id de un usuario borrado (no está en auth.json)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.userNames.user_borrado_inexistente).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(r.body.userNames, "user_borrado_inexistente")).toBe(false);
  });

  it("no viaja ningún email dentro de userNames (T-33-12)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body.userNames)).not.toContain("@");
  });

  it("solo trae los ids referenciados por ESTA cola, no el padrón entero (admin no está en callLog)", async () => {
    const r = await request(app).get("/api/setters/leads/sin-wsp").set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    expect(r.body.userNames.user_admin).toBeUndefined();
    expect(Object.keys(r.body.userNames)).toEqual(["user_judith"]);
  });
});
