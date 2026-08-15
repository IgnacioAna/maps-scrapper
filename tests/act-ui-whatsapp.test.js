// Test del botón de WhatsApp (D-01/D-02/D-03, ACT-01/02/03) — Fase 32, Plan
// 03. No hay browser ni jsdom en el repo, así que se verifica en los modos ya
// usados por el proyecto (mismo molde que tests/commitment-ui.test.js /
// tests/gate-destination.test.js / tests/commitment-hoy.test.js):
//
// 1. Bloque puro extraído por marcadores ([32-03] ACT-PURE): se corta con
//    `new Function` y se evalúa aislado.
// 2. Paridad frontend/backend: se leen public/app.js e index.js como texto y
//    se comparan los 3 `key` de plantilla.
// 3. Aserciones de fuente (cableado real de las 4 superficies + el aviso de
//    destino + el handler del overlay), extrayendo cuerpos de función por
//    conteo de llaves balanceado — mismo helper que commitment-hoy.test.js
//    (necesario acá porque _hoyRenderSection tiene un `opts = {}` de default
//    param antes del `{` que abre el cuerpo real).
// 4. Cache-buster: chequeo de FORMA, nunca un valor pineado (nota de
//    commitment-ui.test.js: un pin exacto se rompe con cualquier edición
//    legítima y ajena de otra sesión — ya pasó una vez, ver 31-03).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [32-03] ACT-PURE: INICIO ───";
const END_MARKER = "// ─── [32-03] ACT-PURE: FIN ───";
const DISPO_START_MARKER = "// ─── [30-03] DISPO-DEST: INICIO ───";
const DISPO_END_MARKER = "// ─── [30-03] DISPO-DEST: FIN ───";

let appJs;
let indexHtml;
let indexJs;
let act;

// Extrae el cuerpo `{...}` balanceado de una función/handler a partir del
// literal exacto de su declaración — `startLiteral` DEBE terminar en el `{`
// que abre el cuerpo (no el primer `{` que aparezca después, que puede ser
// el de un default param como `opts = {}`). Copiado literal de
// tests/commitment-hoy.test.js (mismo criterio, mismo bug que evita).
function extractFunctionBody(text, startLiteral) {
  if (!startLiteral.endsWith("{")) throw new Error("startLiteral debe terminar en '{' (el que abre el cuerpo)");
  const startIdx = text.indexOf(startLiteral);
  if (startIdx === -1) throw new Error(`No se encontró "${startLiteral}"`);
  const braceStart = startIdx + startLiteral.length - 1;
  let depth = 0;
  let i = braceStart;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return text.slice(startIdx, i);
}

function countOccurrences(str, sub) {
  let count = 0;
  let idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) {
    count++;
    idx += sub.length;
  }
  return count;
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  indexJs = fs.readFileSync(path.join(process.cwd(), "index.js"), "utf8");

  const startIdx = appJs.indexOf(START_MARKER);
  const endIdx = appJs.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores ACT-PURE en public/app.js (start=${startIdx}, end=${endIdx}). ` +
        `Verificar que "${START_MARKER}" y "${END_MARKER}" existen literales en el archivo.`
    );
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return { ACT_WA_TEMPLATES, _actTemplateById };
    `
  );
  act = factory();
});

const ALLOWED_VARS = new Set(["{name}", "{city}", "{setterName}"]);

describe("ACT-PURE: bloque autocontenido (sin DOM/red/localStorage)", () => {
  it("el bloque no referencia document/localStorage/fetch(", () => {
    const startIdx = appJs.indexOf(START_MARKER);
    const endIdx = appJs.indexOf(END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toMatch(/document\.|localStorage|fetch\(/);
  });
});

describe("ACT-PURE: ACT_WA_TEMPLATES — forma y contenido (D-06/D-08)", () => {
  it("tiene exactamente 3 entradas, cada una con key/label/body no vacíos", () => {
    expect(act.ACT_WA_TEMPLATES.length).toBe(3);
    for (const t of act.ACT_WA_TEMPLATES) {
      expect(typeof t.key).toBe("string");
      expect(t.key.length).toBeGreaterThan(0);
      expect(typeof t.label).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
      expect(typeof t.body).toBe("string");
      expect(t.body.length).toBeGreaterThan(0);
    }
  });

  it("los 3 key son exactamente post_llamada, envio_info, reconfirmar_reunion", () => {
    expect(act.ACT_WA_TEMPLATES.map((t) => t.key)).toEqual([
      "post_llamada",
      "envio_info",
      "reconfirmar_reunion",
    ]);
  });

  it("ningún body contiene la marca de la empresa (mismo criterio que _stripBrandMentions)", () => {
    for (const t of act.ACT_WA_TEMPLATES) {
      expect(/\bSCM\b/.test(t.body)).toBe(false);
    }
  });

  it("ningún body contiene ¿ ni ¡", () => {
    for (const t of act.ACT_WA_TEMPLATES) {
      expect(t.body).not.toContain("¿");
      expect(t.body).not.toContain("¡");
    }
  });

  it("cada body usa solo variables del vocabulario permitido ({name}, {city}, {setterName})", () => {
    for (const t of act.ACT_WA_TEMPLATES) {
      const found = t.body.match(/\{[a-zA-Z]+\}/g) || [];
      for (const v of found) {
        expect(ALLOWED_VARS.has(v)).toBe(true);
      }
    }
  });

  it("cada body tiene como máximo 2 párrafos (un solo \\n\\n)", () => {
    for (const t of act.ACT_WA_TEMPLATES) {
      expect(countOccurrences(t.body, "\n\n")).toBeLessThanOrEqual(1);
    }
  });

  it("_actTemplateById('envio_info') devuelve esa plantilla; _actTemplateById('no-existe') devuelve la primera (nunca undefined)", () => {
    expect(act._actTemplateById("envio_info").key).toBe("envio_info");
    expect(act._actTemplateById("no-existe")).toBe(act.ACT_WA_TEMPLATES[0]);
    expect(act._actTemplateById("no-existe")).not.toBe(undefined);
  });
});

describe("Paridad frontend ↔ backend (index.js)", () => {
  it("los 3 key de ACT_WA_TEMPLATES aparecen literales dentro de la declaración de ACT_WA_TEMPLATE_IDS en index.js", () => {
    const startIdx = indexJs.indexOf("const ACT_WA_TEMPLATE_IDS = new Set(");
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = indexJs.indexOf(");", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = indexJs.slice(startIdx, endIdx);
    for (const t of act.ACT_WA_TEMPLATES) {
      expect(block).toContain(`'${t.key}'`);
    }
  });
});

describe("Aserciones de fuente: _actButtonsHTML — declaración única, 4 call sites (D-01)", () => {
  it("_actButtonsHTML se declara exactamente una vez", () => {
    expect(countOccurrences(appJs, "function _actButtonsHTML(leadId, opts = {}) {")).toBe(1);
  });

  it("_actButtonsHTML( aparece exactamente 5 veces en total (declaración + 4 call sites)", () => {
    expect(countOccurrences(appJs, "_actButtonsHTML(")).toBe(5);
  });

  it("renderCallsList llama a _actButtonsHTML con variant:'row'", () => {
    const body = extractFunctionBody(appJs, "function renderCallsList() {");
    expect(body).toContain("_actButtonsHTML(l.id, { variant: 'row' })");
  });

  it("_pdRender llama a _actButtonsHTML con variant:'pd'", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(body).toContain("_actButtonsHTML(lead.id, { variant: 'pd' })");
  });

  it("_callsRenderExpandedPanel llama a _actButtonsHTML con variant:'ficha'", () => {
    const body = extractFunctionBody(appJs, "function _callsRenderExpandedPanel(l) {");
    expect(body).toContain("_actButtonsHTML(l.id, { variant: 'ficha' })");
  });

  it("_hoyRenderSection llama a _actButtonsHTML con variant:'hoy'", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain("_actButtonsHTML(l.id, { variant: 'hoy' })");
  });

  it("la variante 'row' incluye event.stopPropagation() (la fila tiene su propio manejo de click)", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(body).toContain("event.stopPropagation(); window._actWhatsApp(");
  });

  it("_pdRender ya no menciona lead.whatsappUrl (el quick-link legacy se fue)", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(body).not.toContain("lead.whatsappUrl");
  });

  it("_waBtnClick sigue existiendo en el archivo — no se borró la feature, solo su uso en el dialer", () => {
    expect(appJs).toContain("window._waBtnClick = (el, ev, leadId) => {");
  });
});

describe("Aserciones de fuente: _dispoDestination gana la rama de envío (D-05/D-06)", () => {
  let dd;
  beforeAll(() => {
    const startIdx = appJs.indexOf(DISPO_START_MARKER);
    const endIdx = appJs.indexOf(DISPO_END_MARKER);
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = appJs.slice(startIdx, endIdx);
    const factory = new Function(block + `\n    return { _dispoDestination };\n    `);
    dd = factory();
  });

  const now = new Date(2026, 7, 14, 15, 0); // viernes 14/08/2026 15:00 local, fijo
  const dueAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  it("commitment cumplido/yo/whatsapp + nextAction {origen:'compromiso', tipo:'esperar_respuesta'} → vista 'en Hoy → Esperando del prospecto'", () => {
    const lead = {
      name: "Clinica WA",
      estado: "sin_contactar",
      commitment: { estado: "cumplido", parte: "yo", canal: "whatsapp" },
      nextAction: { origen: "compromiso", tipo: "esperar_respuesta", dueAt },
      callLog: [],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Hoy → Esperando del prospecto");
    expect(dest.cuando).not.toBe("");
    expect(dest.texto).toContain("Clinica WA");
    expect(dest.texto.toLowerCase()).toContain("abriste el chat");
  });

  it("el mismo lead con canal:'email' devuelve la variante de texto de material", () => {
    const lead = {
      name: "Clinica Mail",
      estado: "sin_contactar",
      commitment: { estado: "cumplido", parte: "yo", canal: "email" },
      nextAction: { origen: "compromiso", tipo: "esperar_respuesta", dueAt },
      callLog: [],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Hoy → Esperando del prospecto");
    expect(dest.texto.toLowerCase()).toContain("mandaste el material");
  });

  it("sin cuando (dueAt vacío) la frase no dice 'Vuelve' — dice 'Queda'", () => {
    const lead = {
      name: "Clinica Sin Fecha",
      estado: "sin_contactar",
      commitment: { estado: "cumplido", parte: "yo", canal: "whatsapp" },
      nextAction: { origen: "compromiso", tipo: "esperar_respuesta", dueAt: "" },
      callLog: [],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.cuando).toBe("");
    expect(dest.texto).not.toContain("Vuelve");
    expect(dest.texto).toContain("Queda en Hoy → Esperando del prospecto.");
  });

  it("la rama nueva vive ANTES de la rama de 'interesado' (mismo bloque, no reordena precedencia previa)", () => {
    const startIdx = appJs.indexOf(DISPO_START_MARKER);
    const commitPendienteIdx = appJs.indexOf("lead.commitment && lead.commitment.estado === 'pendiente'", startIdx);
    const newBranchIdx = appJs.indexOf("lead.commitment.estado === 'cumplido' &&", startIdx);
    const interesadoIdx = appJs.indexOf("lead.estado === 'interesado'", startIdx);
    expect(commitPendienteIdx).toBeGreaterThan(-1);
    expect(newBranchIdx).toBeGreaterThan(-1);
    expect(interesadoIdx).toBeGreaterThan(-1);
    expect(commitPendienteIdx).toBeLessThan(newBranchIdx);
    expect(newBranchIdx).toBeLessThan(interesadoIdx);
  });
});

describe("Anti-deriva: el título de Hoy usado por la rama nueva coincide con loadHoyView (mismo estilo que T-31-13)", () => {
  it("'Esperando del prospecto' (título de la sección en loadHoyView) aparece también dentro de [30-03] DISPO-DEST", () => {
    expect(appJs).toContain("_hoyRenderSection('Esperando del prospecto'");
    const startIdx = appJs.indexOf(DISPO_START_MARKER);
    const endIdx = appJs.indexOf(DISPO_END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).toContain("Hoy → Esperando del prospecto");
  });
});

describe("Aserciones de fuente: forceToast en _dispoAnnounce (D-07)", () => {
  it("_dispoAnnounce lee opts.forceToast y tira el toast igual, salteando el hold del Power Dialer", () => {
    const body = extractFunctionBody(appJs, "function _dispoAnnounce(leadId, opts = {}) {");
    expect(body).toContain("if (opts.forceToast) {");
    // La rama vieja del hold del Power Dialer sigue intacta, literal (no se
    // tocó su condición ni el shape del objeto que arma).
    expect(body).toContain("if (_pd.active) {");
    expect(body).toContain(
      "_pd.holdMeta = { texto: dest.texto, vista: dest.vista, cuando: dest.cuando, tono: dest.tono };"
    );
  });
});

describe("Aserciones de fuente: window._actWhatsApp (el handler del overlay)", () => {
  function handlerBody() {
    return extractFunctionBody(appJs, "window._actWhatsApp = (leadId) => {");
  }

  it("existe y resuelve el lead con fallback a callsLeadsCache", () => {
    expect(appJs).toContain("window._actWhatsApp = (leadId) => {");
    const body = handlerBody();
    expect(body).toContain("_callsLeadsById.get(leadId)");
    expect(body).toContain("callsLeadsCache");
  });

  it("hace POST a whatsapp-send vía apiUrl", () => {
    const body = handlerBody();
    expect(body).toContain("whatsapp-send");
    expect(body).toContain("apiUrl(");
    expect(body).toContain("method: 'POST'");
  });

  it("contiene window.open(, _leadStoreApply(, _dispoAnnounce( y forceToast", () => {
    const body = handlerBody();
    expect(body).toContain("window.open(");
    expect(body).toContain("_leadStoreApply(");
    expect(body).toContain("_dispoAnnounce(");
    expect(body).toContain("forceToast");
  });

  it("NO contiene _pdRender( ni _pd.holdCurrent (D-07, ni siquiera en comentarios)", () => {
    const body = handlerBody();
    expect(body).not.toContain("_pdRender(");
    expect(body).not.toContain("_pd.holdCurrent");
  });

  it("_refreshLeadPanels(leadId) se llama dentro de un finally", () => {
    const body = handlerBody();
    const finallyRe = /\}\s*finally\s*\{[\s\S]*?_refreshLeadPanels\(leadId\);[\s\S]*?\}/;
    expect(finallyRe.test(body)).toBe(true);
  });

  it("si window.open devuelve null (bloqueador de pop-ups), avisa con el link para abrirlo a mano", () => {
    const body = handlerBody();
    const openIdx = body.indexOf("const opened = window.open(");
    expect(openIdx).toBeGreaterThan(-1);
    const ifNotOpenedIdx = body.indexOf("if (!opened) {", openIdx);
    expect(ifNotOpenedIdx).toBeGreaterThan(openIdx);
  });

  it("el body del POST manda phone solo cuando el destino elegido no es el principal", () => {
    const body = handlerBody();
    expect(body).toContain("let phone = '';");
    expect(body).toContain("if (destSel === 'alt') phone = lead.altPhone || '';");
    expect(body).toContain("else if (destSel === 'otro') phone = (otherPhoneInput.value || '').trim();");
  });

  it("todo dato del lead interpolado en el markup del overlay (ov.innerHTML) pasa por escHtml", () => {
    const body = handlerBody();
    const markupStart = body.indexOf("ov.innerHTML = ");
    const markupEnd = body.indexOf("document.body.appendChild(ov);", markupStart);
    expect(markupStart).toBeGreaterThan(-1);
    expect(markupEnd).toBeGreaterThan(markupStart);
    const markup = body.slice(markupStart, markupEnd);
    for (const tok of ["lead.name", "lead.phone", "lead.altPhone", "lead.altPhoneLabel"]) {
      const re = new RegExp(tok.split(".").join("\\.") + "\\b", "g");
      let m;
      let found = 0;
      while ((m = re.exec(markup))) {
        found++;
        const before = markup.slice(Math.max(0, m.index - 12), m.index);
        expect(before.endsWith("escHtml(")).toBe(true);
      }
      expect(found).toBeGreaterThanOrEqual(1);
    }
  });

  it("el link 'editar contacto secundario' reusa window._callsAltContact (no una UI paralela)", () => {
    const body = handlerBody();
    expect(body).toContain("window._callsAltContact(leadId)");
  });

  it("cambiar de plantilla reescribe el textarea con _interpolateScript", () => {
    const body = handlerBody();
    const onchangeIdx = body.indexOf("templateSel.onchange = () => {");
    expect(onchangeIdx).toBeGreaterThan(-1);
    const onchangeEnd = body.indexOf("};", onchangeIdx);
    const onchangeBody = body.slice(onchangeIdx, onchangeEnd);
    expect(onchangeBody).toContain("_interpolateScript(_actTemplateById(templateSel.value).body, lead)");
  });

  it("el overlay declara z-index:10060 (encima de los .modal-overlay que abren la ficha de Hoy)", () => {
    const body = handlerBody();
    expect(body).toContain("z-index:10060");
  });
});

describe("Aserciones de fuente: cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL con el que arrancó este plan, confirmado en disco antes de
  // cualquier edit (ver <important_note> del prompt de ejecución): 20260815g,
  // línea 3678. No se pinea un valor exacto post-bump: cualquier sesión
  // paralela legítima puede volver a bumpearlo por un motivo ajeno a esta
  // fase (ya pasó una vez en 31-03, commit 613256f) — se verifica FORMA +
  // estrictamente mayor que el baseline real.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260815g)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260815g").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css NO se tocó en este plan: git diff vacío verificado antes de commitear (ver SUMMARY); acá solo se confirma forma válida", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});
