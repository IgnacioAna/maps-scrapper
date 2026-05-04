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

describe("parseMercuryOutput — formato 2 secciones", () => {
  const { parseMercuryOutput } = globalThis.__mercury;

  it("parsea respuesta + sugerencias normales", () => {
    const raw = `RESPUESTA AL LEAD:
Te entiendo, eso lo vemos en la llamada.

Le parece mañana o el miércoles?

SUGERENCIAS PARA EL SETTER:
- Mandá el PDF ejecutivo
- Pasale el testimonio del Dr. X`;
    const r = parseMercuryOutput(raw);
    expect(r.responseBlocks.length).toBe(2);
    expect(r.responseBlocks[0]).toMatch(/Te entiendo/);
    expect(r.coaching.length).toBe(2);
    expect(r.coaching[0]).toBe("Mandá el PDF ejecutivo");
  });

  it("respuesta vacía cuando dice (no responder ahora)", () => {
    const raw = `RESPUESTA AL LEAD:
(no responder ahora)

SUGERENCIAS PARA EL SETTER:
- Esperá 24h
- Después mandale el caso de éxito`;
    const r = parseMercuryOutput(raw);
    expect(r.responseBlocks).toEqual([]);
    expect(r.coaching.length).toBe(2);
  });

  it("sugerencias vacías cuando dice (ninguna)", () => {
    const raw = `RESPUESTA AL LEAD:
Le entiendo. Lo vemos en una llamada.

SUGERENCIAS PARA EL SETTER:
(ninguna)`;
    const r = parseMercuryOutput(raw);
    expect(r.responseBlocks.length).toBe(1);
    expect(r.coaching).toEqual([]);
  });

  it("backward compat: sin headers, todo va a respuesta", () => {
    const raw = "Te entiendo. Lo vemos mañana?";
    const r = parseMercuryOutput(raw);
    expect(r.responseBlocks.length).toBe(1);
    expect(r.coaching).toEqual([]);
  });

  it("acepta encabezados con asteriscos markdown", () => {
    const raw = `**RESPUESTA AL LEAD:**
Hola. Le interesa una llamada?

**SUGERENCIAS PARA EL SETTER:**
- Agendá esta semana`;
    const r = parseMercuryOutput(raw);
    expect(r.responseBlocks.length).toBe(1);
    expect(r.coaching.length).toBe(1);
  });

  it("strip de bullets variados (-, *, •, números)", () => {
    const raw = `RESPUESTA AL LEAD:
(no responder ahora)

SUGERENCIAS PARA EL SETTER:
- Acción 1
* Acción 2
• Acción 3
1. Acción 4`;
    const r = parseMercuryOutput(raw);
    expect(r.coaching).toEqual(["Acción 1", "Acción 2", "Acción 3", "Acción 4"]);
  });

  it("cap a 6 sugerencias", () => {
    const lines = Array.from({length: 10}, (_, i) => `- accion ${i+1}`).join("\n");
    const raw = `RESPUESTA AL LEAD:\n(no responder ahora)\n\nSUGERENCIAS PARA EL SETTER:\n${lines}`;
    const r = parseMercuryOutput(raw);
    expect(r.coaching.length).toBe(6);
  });
});

describe("detectMercuryIntent — clasificación heurística", () => {
  const { detectMercuryIntent } = globalThis.__mercury;

  it("detecta pide_asset con email", () => {
    expect(detectMercuryIntent("pasame tu mail por favor")).toBe("pide_asset");
    expect(detectMercuryIntent("cual es tu email?")).toBe("pide_asset");
  });

  it("detecta pide_asset con PDF/info", () => {
    expect(detectMercuryIntent("tenes algun pdf o presentacion?")).toBe("pide_asset");
    expect(detectMercuryIntent("mandame mas info")).toBe("pide_asset");
  });

  it("detecta agendamiento", () => {
    expect(detectMercuryIntent("dale, cuando podemos hablar?")).toBe("agendamiento");
    expect(detectMercuryIntent("agendamos una reunion")).toBe("agendamiento");
  });

  it("detecta precio", () => {
    expect(detectMercuryIntent("cuanto sale?")).toBe("precio");
    expect(detectMercuryIntent("que valor tiene la inversion mensual?")).toBe("precio");
  });

  it("detecta objecion", () => {
    expect(detectMercuryIntent("no me interesa por ahora")).toBe("objecion");
    expect(detectMercuryIntent("ya tenemos un sistema")).toBe("objecion");
  });

  it("detecta indeciso en respuestas cortas", () => {
    expect(detectMercuryIntent("ok")).toBe("indeciso");
    expect(detectMercuryIntent("dale")).toBe("indeciso");
    expect(detectMercuryIntent("Listo.")).toBe("indeciso");
  });

  it("detecta saludo", () => {
    expect(detectMercuryIntent("Hola buenas")).toBe("saludo");
  });

  it("detecta duda tecnica", () => {
    expect(detectMercuryIntent("como funciona exactamente?")).toBe("duda_tecnica");
    expect(detectMercuryIntent("que incluye el sistema?")).toBe("duda_tecnica");
  });

  it("default 'otro' si no matchea nada", () => {
    expect(detectMercuryIntent("xyz qwerty foobar")).toBe("otro");
  });
});
