// Tests del sanitizer del openMessage que devuelve la IA en /api/enrich.
// Cubre las basuras tipicas que la IA mete (URLs, markdown, placeholders,
// prompt injection, texto larguisimo) y confirma que se cae a un fallback
// limpio en vez de inyectarse al wa.me/?text=...

import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const tmpData = path.join(os.tmpdir(), `openmsg-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "openmsg@local.test";
process.env.ADMIN_PASSWORD = "openmsg1234";
process.env.ADMIN_NAME = "OpenMsg";
process.env.JWT_SECRET = "test-secret-openmsg";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "u1", email: "openmsg@local.test", name: "OpenMsg", role: "admin", status: "active", setterId: "", password: pwd("openmsg1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ], invites: [], sessions: []
  }, null, 2)
);

let sanitizeOpeningMessage, makeOpeningMessage;
beforeAll(async () => {
  ({ sanitizeOpeningMessage, makeOpeningMessage } = await import("../index.js"));
});

describe("sanitizeOpeningMessage — rechazos por basura", () => {
  it("null/undefined/vacio -> null", () => {
    expect(sanitizeOpeningMessage(null)).toBeNull();
    expect(sanitizeOpeningMessage(undefined)).toBeNull();
    expect(sanitizeOpeningMessage("")).toBeNull();
    expect(sanitizeOpeningMessage("   ")).toBeNull();
  });

  it("URLs y links se rechazan", () => {
    expect(sanitizeOpeningMessage("Hola, mira esto en https://miclinica.com")).toBeNull();
    expect(sanitizeOpeningMessage("Buenas, www.example.com tiene info")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, te paso wa.me/5491134")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, escribime a t.me/algo")).toBeNull();
  });

  it("hashtags y @menciones se rechazan", () => {
    expect(sanitizeOpeningMessage("Hola #odontologia que tal")).toBeNull();
    expect(sanitizeOpeningMessage("Hola @clinica buenas tardes")).toBeNull();
  });

  it("placeholders sin resolver se rechazan", () => {
    expect(sanitizeOpeningMessage("Hola [Nombre del Doctor], como va")).toBeNull();
    expect(sanitizeOpeningMessage("Hola {clinica}, una consulta")).toBeNull();
    expect(sanitizeOpeningMessage("Hola <doctor> buen dia")).toBeNull();
    expect(sanitizeOpeningMessage("Hola ${nombre}, buenas")).toBeNull();
    expect(sanitizeOpeningMessage("Hola %s buenas tardes")).toBeNull();
  });

  it("HTML / JSON crudo / bloques de codigo se rechazan", () => {
    expect(sanitizeOpeningMessage("<p>Hola</p>")).toBeNull();
    expect(sanitizeOpeningMessage('{"openMessage":"Hola"}')).toBeNull();
    expect(sanitizeOpeningMessage("```js\nconsole.log('hola')\n```")).toBeNull();
  });

  it("texto sin letras se rechaza", () => {
    expect(sanitizeOpeningMessage("123 456 789")).toBeNull();
    expect(sanitizeOpeningMessage("!!! ??? ...")).toBeNull();
  });

  it("muy corto se rechaza", () => {
    expect(sanitizeOpeningMessage("Hi")).toBeNull();
    expect(sanitizeOpeningMessage("Hola")).toBeNull(); // 4 letras, queda corto
  });

  it("saludos repetidos se rechazan (Hola Hola Hola)", () => {
    expect(sanitizeOpeningMessage("Hola hola hola buenas tardes")).toBeNull();
  });

  it("rechaza mensajes 'tipo cliente' (rol invertido)", () => {
    // Casos reales que estaba metiendo la IA
    expect(sanitizeOpeningMessage("Hola, me gustaría saber más sobre sus servicios odontológicos")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, estoy interesado en los servicios de odontología que ofrecen")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, me gustaría recibir más información, por favor")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, quisiera agendar una cita")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, podrían brindarme más información")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, necesito información sobre tratamientos")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, me interesarían sus servicios dentales")).toBeNull();
    expect(sanitizeOpeningMessage("Hola, quiero agendar una cita por favor")).toBeNull();
  });
});

describe("sanitizeOpeningMessage — limpieza y aceptacion", () => {
  it("acepta saludos cortos naturales", () => {
    expect(sanitizeOpeningMessage("Hola, buenas tardes")).toBe("Hola, buenas tardes");
    expect(sanitizeOpeningMessage("Buenas, ¿cómo andan?")).toBe("Buenas, ¿cómo andan?");
    expect(sanitizeOpeningMessage("Hola, una consulta corta")).toBe("Hola, una consulta corta");
  });

  it("strip de markdown: ** _ # > -", () => {
    expect(sanitizeOpeningMessage("**Hola**, buenas tardes")).toBe("Hola, buenas tardes");
    expect(sanitizeOpeningMessage("__Hola__ buenas tardes")).toBe("Hola buenas tardes");
  });

  it("strip de comillas externas", () => {
    expect(sanitizeOpeningMessage('"Hola, buenas tardes"')).toBe("Hola, buenas tardes");
    expect(sanitizeOpeningMessage("'Hola, buenas tardes'")).toBe("Hola, buenas tardes");
  });

  it("strip de emojis manteniendo el texto", () => {
    expect(sanitizeOpeningMessage("Hola 👋 buenas tardes 😊")).toBe("Hola buenas tardes");
  });

  it("colapsa whitespace y saltos de linea", () => {
    expect(sanitizeOpeningMessage("Hola,\n   buenas\ttardes")).toBe("Hola, buenas tardes");
  });

  it("texto larguisimo se corta a la primera oracion (max 140)", () => {
    const long = "Hola, buen dia para vos. " + "a".repeat(200);
    const out = sanitizeOpeningMessage(long);
    expect(out.length).toBeLessThanOrEqual(140);
    expect(out.startsWith("Hola, buen dia para vos.")).toBe(true);
  });
});

describe("makeOpeningMessage — fallback siempre devuelve algo usable", () => {
  it("sin contexto: devuelve string del banco", () => {
    const m = makeOpeningMessage({});
    expect(typeof m).toBe("string");
    expect(m.length).toBeGreaterThan(5);
    // El fallback nunca debe contener basura
    expect(sanitizeOpeningMessage(m)).not.toBeNull();
  });

  it("con contexto pais/ciudad: sigue siendo limpio", () => {
    for (let i = 0; i < 10; i++) {
      const m = makeOpeningMessage({ country: "Argentina", city: "Buenos Aires" });
      expect(sanitizeOpeningMessage(m)).not.toBeNull();
    }
  });
});
