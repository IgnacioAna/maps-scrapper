import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `training-security-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-tr@local.test";
process.env.ADMIN_PASSWORD = "trpass1234";
process.env.ADMIN_NAME = "AdminTR";
process.env.JWT_SECRET = "test-secret-tr";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_tr", email: "admin-tr@local.test", name: "AdminTR", role: "admin", status: "active", setterId: "", password: pwd("trpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {} }, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }, null, 2));

const { app } = await import("../index.js");

let cookie = "";

beforeAll(async () => {
  const r = await request(app).post("/api/auth/login").send({ email: "admin-tr@local.test", password: "trpass1234" });
  expect(r.status).toBe(200);
  cookie = r.headers["set-cookie"][0].split(";")[0];
});

afterAll(() => {
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
});

describe("training files hardening", () => {
  it("no permite descargar paths importados fuera de training/", async () => {
    const importRes = await request(app)
      .post("/api/admin/import-data")
      .set("Cookie", cookie)
      .send({
        training: {
          materials: [
            { id: "mat_bad", title: "Bad", fileName: "../auth.json", originalFileName: "evil\r\nx.txt", mimeType: "text/plain" },
          ],
        },
      });
    expect(importRes.status).toBe(200);

    const download = await request(app)
      .get("/api/training/mat_bad/download")
      .set("Cookie", cookie);
    expect(download.status).toBe(404);
  });

  it("sanitiza Content-Disposition en descargas validas", async () => {
    const create = await request(app)
      .post("/api/training")
      .set("Cookie", cookie)
      .send({
        title: "Material",
        fileName: "nota\r\nmal.txt",
        mimeType: "text/plain",
        fileBase64: Buffer.from("hola").toString("base64"),
      });
    expect(create.status).toBe(200);

    const download = await request(app)
      .get(`/api/training/${create.body.material.id}/download`)
      .set("Cookie", cookie);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).not.toMatch(/\r|\n/);
  });
});
