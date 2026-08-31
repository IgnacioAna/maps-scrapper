// Milestone v5.0 (Fase 41 / MAIL-06/07/09): el correo de presentación con el
// "puente" de la recepción. Se extrae el bloque puro BRIDGE-EMAIL-PURE de
// public/app.js (sin DOM/red/localStorage) y se evalúa aislado — mismo patrón
// que ACT-PURE. Cubre: armado por bloques condicionales, lint de marca y
// paridad del template id frontend↔backend.

import { describe, it, beforeAll, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START = "// ─── [v5.0] BRIDGE-EMAIL-PURE: INICIO ───";
const END = "// ─── [v5.0] BRIDGE-EMAIL-PURE: FIN ───";

let mod, appJs, indexJs;

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexJs = fs.readFileSync(path.join(process.cwd(), "index.js"), "utf8");
  const s = appJs.indexOf(START);
  const e = appJs.indexOf(END);
  if (s === -1 || e === -1 || e < s) throw new Error("No se encontraron los marcadores BRIDGE-EMAIL-PURE");
  const block = appJs.slice(s, e);
  const factory = new Function(block + "\nreturn { _buildBridgeEmail, _bridgeYear, _bridgeCalcLink, ACT_EMAIL_TEMPLATE_ID };");
  mod = factory();
});

// Lead "completo" para las combinaciones.
const fullLead = { name: "Clínica Dental Sonrisa", doctor: "Pérez", city: "Guadalajara", country: "México", gatekeeperName: "Sandra", foundedYear: "2011" };

// Todas las combinaciones que arma la plantilla — el lint corre sobre todas.
function allVariants() {
  const base = { name: "Clínica Sonrisa", country: "México" };
  return [
    _b({ ...base, doctor: "Pérez", city: "Guadalajara", gatekeeperName: "Sandra", foundedYear: "2011" }),
    _b({ ...base, doctor: "", city: "", gatekeeperName: "", foundedYear: "" }),
    _b({ ...base, doctor: "N/A", city: "Lima", gatekeeperName: "María", yearsActive: 14 }),
    _b({ ...base, doctor: "Gómez", city: "", gatekeeperName: "", foundedYear: "" }),
    _b({ ...base, gatekeeperName: "Guadalupe" }, { horario1: "el jueves 10hs", horario2: "el viernes 16hs" }),
  ];
}
function _b(lead, opts) {
  return mod._buildBridgeEmail(lead, opts || {});
}
function txt(built) { return built.subject + "\n" + built.body; }

describe("BRIDGE-EMAIL: bloque autocontenido", () => {
  it("no referencia document/localStorage/fetch(", () => {
    const s = appJs.indexOf(START), e = appJs.indexOf(END);
    const block = appJs.slice(s, e);
    expect(block).not.toMatch(/document\.|localStorage|fetch\(/);
  });
});

describe("BRIDGE-EMAIL: armado por bloques condicionales (MAIL-07)", () => {
  it("con doctor → 'Doctor X, buenos días.'", () => {
    expect(_b(fullLead).body).toContain("Doctor Pérez, buenos días.");
  });
  it("sin doctor (vacío o N/A) → 'Buenos días.' sin 'Doctor'", () => {
    const b1 = _b({ ...fullLead, doctor: "" }).body;
    const b2 = _b({ ...fullLead, doctor: "N/A" }).body;
    expect(b1).toContain("Buenos días.");
    expect(b1).not.toContain("Doctor ");
    expect(b2).not.toContain("Doctor ");
  });
  it("con recepción → asunto con el nombre + párrafo del puente", () => {
    const b = _b(fullLead);
    expect(b.subject).toBe("Sandra nos dejó su correo");
    expect(b.body).toContain("hablar con Sandra, de recepción");
  });
  it("sin recepción → asunto del problema + 'esta mañana', sin 'hablar con'", () => {
    const b = _b({ ...fullLead, gatekeeperName: "" });
    expect(b.subject).toBe("Los pacientes que no volvieron");
    expect(b.body).toContain("llamar a la clínica esta mañana");
    expect(b.body).not.toContain("hablar con");
  });
  it("con ciudad → 'clínicas de {ciudad}'; sin ciudad → 'clínicas de la zona'", () => {
    expect(_b(fullLead).body).toContain("clínicas de Guadalajara");
    expect(_b({ ...fullLead, city: "" }).body).toContain("clínicas de la zona");
  });
  it("antigüedad: foundedYear explícito → 'atiende desde 2011'", () => {
    expect(_b(fullLead).body).toContain("Clínica Dental Sonrisa atiende desde 2011");
  });
  it("antigüedad: sin foundedYear pero con yearsActive → año derivado (resta exacta)", () => {
    const anioEsperado = String(new Date().getFullYear() - 14);
    const b = _b({ ...fullLead, foundedYear: "", yearsActive: 14 });
    expect(b.body).toContain(`atiende desde ${anioEsperado}`);
  });
  it("sin antigüedad → el párrafo no existe", () => {
    const b = _b({ ...fullLead, foundedYear: "", yearsActive: null });
    expect(b.body).not.toContain("atiende desde");
  });
  it("horarios sin completar → marcadores {{HORARIO_1}}/{{HORARIO_2}} literales", () => {
    const b = _b(fullLead);
    expect(b.body).toContain("{{HORARIO_1}}");
    expect(b.body).toContain("{{HORARIO_2}}");
  });
  it("horarios completos → sin marcadores, con los valores", () => {
    const b = _b(fullLead, { horario1: "el jueves 10hs", horario2: "el viernes 16hs" });
    expect(b.body).not.toMatch(/[{}\[\]]/);
    expect(b.body).toContain("Le queda mejor el jueves 10hs o el viernes 16hs?");
  });
});

describe("BRIDGE-EMAIL: link a la calculadora (MAIL-07)", () => {
  it("con país → vincca.co?p=<país>, sin utm_", () => {
    const l = mod._bridgeCalcLink({ country: "México" });
    expect(l).toBe("https://vincca.co?p=M%C3%A9xico");
    expect(l).not.toContain("utm_");
  });
  it("sin país → vincca.co pelado", () => {
    expect(mod._bridgeCalcLink({ country: "" })).toBe("https://vincca.co");
  });
  it("el cuerpo lleva el link y nunca un utm_", () => {
    for (const b of allVariants()) {
      expect(b.body).toContain("vincca.co");
      expect(txt(b)).not.toContain("utm_");
    }
  });
});

describe("BRIDGE-EMAIL: lint de marca (MAIL-09) sobre TODAS las variantes", () => {
  it("sin signos de apertura ¿ ¡ (pero las preguntas con ? de cierre sí)", () => {
    for (const b of allVariants()) {
      expect(txt(b)).not.toMatch(/[¿¡]/);
    }
  });
  it("sin guion largo (—)", () => {
    for (const b of allVariants()) expect(txt(b)).not.toContain("—");
  });
  it("sin IA / inteligencia artificial / automatizado / automatización / chatbot / WhatsApp / CRM", () => {
    const forbidden = [/\bIA\b/, /inteligencia artificial/i, /automatizad/i, /automatiz(a|á)ci[oó]n/i, /chatbot/i, /whatsapp/i, /\bCRM\b/i];
    for (const b of allVariants()) {
      const t = txt(b);
      for (const re of forbidden) expect(t).not.toMatch(re);
    }
  });
  it("sin mención de precio (símbolos de moneda, USD/U$S/US$, tarifa, fee, precio)", () => {
    // Nota: el copy oficial usa "atiende desde {año}" — "desde" temporal es
    // legítimo. El lint de precio busca dinero, no la palabra "desde".
    const priceRe = /[\$€]|\b(usd|u\$s|us\$|tarifa|fee|precio)\b|desde\s*(?:us)?\$/i;
    for (const b of allVariants()) expect(txt(b)).not.toMatch(priceRe);
  });
  it("'Vincca' NUNCA aparece en el párrafo de antigüedad (ahí va la clínica)", () => {
    // El error de sustitución más caro de la plantilla.
    const b = _b(fullLead);
    const para = b.body.split(/\n\s*\n/).find((p) => p.includes("atiende desde"));
    expect(para).toBeTruthy();
    expect(para).not.toContain("Vincca");
    expect(para).toContain("Clínica Dental Sonrisa");
  });
  it("sin negritas ni etiquetas de énfasis en el cuerpo", () => {
    for (const b of allVariants()) {
      expect(b.body).not.toMatch(/\*\*|__|<\/?(b|strong|em|i)\b/i);
    }
  });
  it("asunto ≤ 34 caracteres con nombre de recepción típico", () => {
    expect(_b({ ...fullLead, gatekeeperName: "Sandra" }).subject.length).toBeLessThanOrEqual(34);
    expect(_b({ ...fullLead, gatekeeperName: "Guadalupe" }).subject.length).toBeLessThanOrEqual(34);
    expect(_b({ ...fullLead, gatekeeperName: "" }).subject.length).toBeLessThanOrEqual(34);
  });
});

describe("BRIDGE-EMAIL: paridad template id frontend↔backend (MAIL-06)", () => {
  it("ACT_EMAIL_TEMPLATE_ID del frontend existe en ACT_EMAIL_TEMPLATE_IDS del backend", () => {
    expect(mod.ACT_EMAIL_TEMPLATE_ID).toBe("presentacion_puente");
    const start = indexJs.indexOf("const ACT_EMAIL_TEMPLATE_IDS = new Set(");
    expect(start).toBeGreaterThan(-1);
    const block = indexJs.slice(start, indexJs.indexOf(");", start));
    expect(block).toContain(`'${mod.ACT_EMAIL_TEMPLATE_ID}'`);
  });
  it("_actRegisterSendEvent elige el Set por canal (email valida contra el suyo)", () => {
    const start = indexJs.indexOf("function _actRegisterSendEvent(");
    const block = indexJs.slice(start, start + 900);
    expect(block).toContain("ACT_EMAIL_TEMPLATE_IDS");
    expect(block).toMatch(/canal === 'email'/);
  });
});
