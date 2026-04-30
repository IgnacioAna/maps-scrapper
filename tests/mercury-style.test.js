// Tests del helper sanitizeMercuryStyle + detectMercuryViolations.
// Setup minimo: DATA_DIR temporal + auth pre-poblada para que el import de
// index.js no traiga data del repo. Solo testeamos los helpers expuestos en
// globalThis.__mercury.

import { describe, it, beforeAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const tmpData = path.join(os.tmpdir(), `mercury-style-test-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-merc@local.test";
process.env.ADMIN_PASSWORD = "mercpass1234";
process.env.ADMIN_NAME = "AdminMerc";
process.env.JWT_SECRET = "test-secret-merc";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}

fs.writeFileSync(
  path.join(tmpData, "auth.json"),
  JSON.stringify({
    users: [
      { id: "user_admin_merc", email: "admin-merc@local.test", name: "AdminMerc", role: "admin", status: "active", setterId: "", password: pwd("mercpass1234"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    invites: [],
    sessions: [],
  }, null, 2)
);

await import("../index.js");
const { sanitizeMercuryStyle, detectMercuryViolations } = globalThis.__mercury;

describe("sanitizeMercuryStyle", () => {
  it("strip signos de apertura ¿ ¡ pero conserva los de cierre", () => {
    const out = sanitizeMercuryStyle("¿Como estan trabajando esto hoy? ¡Esta buenisimo!");
    expect(out.text).toBe("Como estan trabajando esto hoy? Esta buenisimo!");
    expect(out.text).not.toContain("¿");
    expect(out.text).not.toContain("¡");
    expect(out.text).toContain("?");
    expect(out.text).toContain("!");
  });

  it("normaliza saltos de linea triples a doble salto", () => {
    const out = sanitizeMercuryStyle("Bloque uno.\n\n\n\nBloque dos.\n\n\nBloque tres.");
    expect(out.blocks).toEqual(["Bloque uno.", "Bloque dos.", "Bloque tres."]);
    expect(out.text).toBe("Bloque uno.\n\nBloque dos.\n\nBloque tres.");
  });

  it("partir en bloques por doble salto y trim por bloque", () => {
    const out = sanitizeMercuryStyle("  Validacion breve.  \n\n  Reframe del problema.  \n\n  Cierre con pregunta? ");
    expect(out.blocks).toHaveLength(3);
    expect(out.blocks[0]).toBe("Validacion breve.");
    expect(out.blocks[2]).toBe("Cierre con pregunta?");
  });

  it("cap a 4 bloques maximo", () => {
    const seis = ["uno", "dos", "tres", "cuatro", "cinco", "seis"].join("\n\n");
    const out = sanitizeMercuryStyle(seis);
    expect(out.blocks).toHaveLength(4);
    expect(out.blocks).toEqual(["uno", "dos", "tres", "cuatro"]);
  });

  it("input vacio o null devuelve estructura vacia", () => {
    expect(sanitizeMercuryStyle("").blocks).toEqual([]);
    expect(sanitizeMercuryStyle(null).blocks).toEqual([]);
    expect(sanitizeMercuryStyle(undefined).text).toBe("");
  });

  it("normaliza CRLF a LF", () => {
    const out = sanitizeMercuryStyle("Linea uno.\r\n\r\nLinea dos.");
    expect(out.blocks).toEqual(["Linea uno.", "Linea dos."]);
  });

  it("preserva bullets con guion", () => {
    const out = sanitizeMercuryStyle("Te resumo:\n- Reactivacion\n- Seguimiento\n- Recuperacion");
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toContain("- Reactivacion");
    expect(out.blocks[0]).toContain("- Seguimiento");
  });

  it("respuesta tipica Mercury en 3 bloques (V→R→R)", () => {
    const inp = "¿Cuanto cuesta?";
    const generado = "Te entiendo la pregunta.\n\nLos detalles los profundizamos en una llamada porque depende mucho de como trabajan hoy.\n\nLe parece coordinarla mañana o el miercoles?";
    const out = sanitizeMercuryStyle(generado);
    expect(out.blocks).toHaveLength(3);
    expect(out.blocks[2]).toMatch(/le parece/i);
  });
});

describe("detectMercuryViolations", () => {
  it("detecta precio concreto con $", () => {
    expect(detectMercuryViolations("Sale $500 al mes.")).toContain("precio_concreto");
  });

  it("detecta precio en USD", () => {
    expect(detectMercuryViolations("El sistema cuesta 1500 USD.")).toContain("precio_concreto");
    expect(detectMercuryViolations("Son USD 800 por mes.")).toContain("precio_concreto");
  });

  it("detecta modalidad de pago", () => {
    expect(detectMercuryViolations("Lo pueden pagar en cuotas.")).toContain("modalidad_pago");
    expect(detectMercuryViolations("Es un pago unico.")).toContain("modalidad_pago");
  });

  it("detecta mencion de stack tecnico", () => {
    expect(detectMercuryViolations("Lo armamos sobre GHL y n8n.")).toContain("stack_tecnico");
    expect(detectMercuryViolations("Usamos AI agents.")).toContain("stack_tecnico");
  });

  it("respuesta limpia no genera violaciones", () => {
    const limpia = "Te entiendo. Lo vemos en una llamada y revisamos como aplicaria a tu caso. Le parece mañana?";
    expect(detectMercuryViolations(limpia)).toEqual([]);
  });

  it("multiple violaciones se acumulan", () => {
    const violators = "Sale $500 en cuotas via GHL.";
    const v = detectMercuryViolations(violators);
    expect(v).toContain("precio_concreto");
    expect(v).toContain("modalidad_pago");
    expect(v).toContain("stack_tecnico");
  });
});
