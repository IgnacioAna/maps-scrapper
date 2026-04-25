// Smoke tests para buildWhatsAppUrl: cubren los casos que generaron el bug
// `wa.me/134604881378` (ES `34` glued con un `1` US falso).
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

// Setup mínimo idéntico a tests/wa.test.js para poder importar index.js sin
// que arranque con el data/ del repo o pida secretos reales.
const tmpData = path.join(os.tmpdir(), `phone-norm-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admintest@local.test";
process.env.ADMIN_PASSWORD = "testpass1234";
process.env.ADMIN_NAME = "AdminTest";
process.env.JWT_SECRET = "test-secret-please-change";

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
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

let buildWhatsAppUrl;
beforeAll(async () => {
  ({ buildWhatsAppUrl } = await import("../index.js"));
});

const digitsOf = (url) => {
  const m = String(url || "").match(/wa\.me\/(\d+)/);
  return m ? m[1] : "";
};

describe("buildWhatsAppUrl: prefijo internacional", () => {
  it("phone con + (E.164) lo respeta", () => {
    expect(buildWhatsAppUrl("+5491134567890", "", "")).toBe("https://wa.me/5491134567890");
    expect(buildWhatsAppUrl("+34604881378", "", "")).toBe("https://wa.me/34604881378");
  });

  it("digitos AR `54` con país Argentina no duplica", () => {
    expect(digitsOf(buildWhatsAppUrl("5491134567890", "Argentina"))).toBe("5491134567890");
  });

  it("digitos AR `54` sin `9` mobile con país Argentina inserta el 9", () => {
    expect(digitsOf(buildWhatsAppUrl("541134567890", "Argentina"))).toBe("541134567890");
  });

  it("local AR `1134567890` con país Argentina arma 549...", () => {
    expect(digitsOf(buildWhatsAppUrl("1134567890", "Argentina"))).toBe("5491134567890");
  });

  it("local AR `01134567890` con leading 0 y país Argentina", () => {
    expect(digitsOf(buildWhatsAppUrl("01134567890", "Argentina"))).toBe("5491134567890");
  });

  it("digitos ES `34` con country vacío NO se prefijan con 1", () => {
    expect(digitsOf(buildWhatsAppUrl("34604881378", ""))).toBe("34604881378");
    expect(buildWhatsAppUrl("34604881378", "")).toBe("https://wa.me/34604881378");
  });

  it("digitos ES con country=Spain (inglés) no duplica", () => {
    expect(digitsOf(buildWhatsAppUrl("34604881378", "Spain"))).toBe("34604881378");
  });

  it("digitos ES con country=España (acento) no duplica", () => {
    expect(digitsOf(buildWhatsAppUrl("34604881378", "España"))).toBe("34604881378");
  });

  it("digitos MX `52` con country vacío", () => {
    expect(digitsOf(buildWhatsAppUrl("525512345678", ""))).toBe("525512345678");
  });

  it("digitos CO `57` con country vacío", () => {
    expect(digitsOf(buildWhatsAppUrl("573001234567", ""))).toBe("573001234567");
  });

  it("digitos US `1` con country=USA respeta", () => {
    expect(digitsOf(buildWhatsAppUrl("14155551212", "USA"))).toBe("14155551212");
  });

  it("digitos BR `55`", () => {
    expect(digitsOf(buildWhatsAppUrl("5511987654321", "Brasil"))).toBe("5511987654321");
  });

  it("digitos UY `598`", () => {
    expect(digitsOf(buildWhatsAppUrl("59899123456", "Uruguay"))).toBe("59899123456");
  });

  it("country vacío + número corto local devuelve string vacío", () => {
    expect(buildWhatsAppUrl("12345", "")).toBe("");
    expect(buildWhatsAppUrl("123", "")).toBe("");
  });

  it("phone vacío", () => {
    expect(buildWhatsAppUrl("", "Argentina")).toBe("");
    expect(buildWhatsAppUrl(null, "")).toBe("");
    expect(buildWhatsAppUrl(undefined, "")).toBe("");
  });

  it("phone con ruido y caracteres no-dígito", () => {
    expect(digitsOf(buildWhatsAppUrl("+34 (604) 88-13-78", ""))).toBe("34604881378");
  });

  it("incluye text query param cuando se pasa message", () => {
    const url = buildWhatsAppUrl("34604881378", "España", "hola");
    expect(url).toContain("wa.me/34604881378");
    expect(url).toContain("text=hola");
  });

  it("regresion: ES local sin prefijo + country vacío NO arma wa.me/1<digits>", () => {
    // El bug original: `34604881378` en country='' devolvía wa.me/134604881378.
    // Con el fix, debe usar los dígitos tal cual.
    const url = buildWhatsAppUrl("34604881378", "", "");
    expect(url).not.toMatch(/wa\.me\/1\d{11,12}$/);
    expect(url).toBe("https://wa.me/34604881378");
  });
});
