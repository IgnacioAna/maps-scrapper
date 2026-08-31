// Test del descarte (D-12..D-16, ACT-04) y del material por email (D-17/
// D-18, ACT-05) — Fase 32, Plan 04. Mismo molde que tests/act-ui-whatsapp.js
// (32-03): sin browser ni jsdom en el repo, se verifica en los modos ya
// usados por el proyecto:
//
// 1. Aserciones de fuente (cableado real del botón nuevo en el builder
//    único + las 4 superficies), extrayendo cuerpos de función por conteo
//    de llaves balanceado — mismo helper que act-ui-whatsapp.test.js /
//    commitment-hoy.test.js.
// 2. Cache-buster: chequeo de FORMA (regex), nunca un literal pineado (nota
//    de 31-03/32-03: un pin exacto se rompe con cualquier edición legítima
//    y ajena de otra sesión).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/act-ui-whatsapp.test.js — extrae el cuerpo
// `{...}` balanceado de una función/handler a partir del literal exacto de
// su declaración (`startLiteral` DEBE terminar en el `{` que abre el
// cuerpo, no el primer `{` que aparezca después — ej. un default param
// como `opts = {}`).
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
});

describe("Descarte en las 4 superficies (ACT-04/D-12)", () => {
  it("_actButtonsHTML se declara exactamente una vez", () => {
    expect(countOccurrences(appJs, "function _actButtonsHTML(leadId, opts = {}) {")).toBe(1);
  });

  it("_actButtonsHTML( aparece exactamente 5 veces en total (declaración + 4 call sites — el botón nuevo NO multiplicó los call sites)", () => {
    expect(countOccurrences(appJs, "_actButtonsHTML(")).toBe(5);
  });

  it("el cuerpo de _actButtonsHTML contiene window._actDiscard( y window._actWhatsApp( — los dos botones salen del mismo builder", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    expect(body).toContain("window._actDiscard(");
    expect(body).toContain("window._actWhatsApp(");
  });

  it("renderCallsList sigue llamando a _actButtonsHTML(", () => {
    const body = extractFunctionBody(appJs, "function renderCallsList() {");
    expect(body).toContain("_actButtonsHTML(");
  });

  it("_pdRender sigue llamando a _actButtonsHTML(", () => {
    const body = extractFunctionBody(appJs, "function _pdRender() {");
    expect(body).toContain("_actButtonsHTML(");
  });

  it("_callsRenderExpandedPanel sigue llamando a _actButtonsHTML(", () => {
    const body = extractFunctionBody(appJs, "function _callsRenderExpandedPanel(l, opts = {}) {");
    expect(body).toContain("_actButtonsHTML(");
  });

  it("_hoyRenderSection sigue llamando a _actButtonsHTML(", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain("_actButtonsHTML(");
  });
});

describe("Razón y confirmación (D-14/D-15)", () => {
  function discardBody() {
    return extractFunctionBody(appJs, "window._actDiscard = (leadId) => {");
  }

  it("_actDiscard existe y referencia DISQUALIFY_REASONS_UI", () => {
    expect(appJs).toContain("window._actDiscard = (leadId) => {");
    expect(discardBody()).toContain("DISQUALIFY_REASONS_UI");
  });

  it("no_es_icp aparece 1 sola vez en todo public/app.js (no se duplicó la lista)", () => {
    expect(countOccurrences(appJs, "no_es_icp")).toBe(1);
  });

  it("el overlay no tiene un segundo paso: el cuerpo no contiene confirm( ni una segunda pantalla (step)", () => {
    const body = discardBody();
    expect(body).not.toContain("confirm(");
    expect(/\bstep\b/.test(body)).toBe(false);
  });

  it("el POST sale del mismo handler del CTA (confirmBtn.onclick es async y contiene el fetch)", () => {
    const body = discardBody();
    const onclickIdx = body.indexOf("confirmBtn.onclick = async () => {");
    expect(onclickIdx).toBeGreaterThan(-1);
    const fetchIdx = body.indexOf("fetch(apiUrl(", onclickIdx);
    expect(fetchIdx).toBeGreaterThan(onclickIdx);
  });

  it("el POST manda reason y doNotCall en el body", () => {
    const body = discardBody();
    expect(body).toContain("body: JSON.stringify({ reason, doNotCall })");
  });

  it("pega a /discard vía apiUrl con method POST", () => {
    const body = discardBody();
    expect(body).toContain("/discard");
    expect(body).toContain("apiUrl(");
    expect(body).toContain("method: 'POST'");
  });
});

describe("Destino y sincronización de vistas (_actDiscard)", () => {
  function discardBody() {
    return extractFunctionBody(appJs, "window._actDiscard = (leadId) => {");
  }

  it("llama _dispoAnnounce( con forceToast y NO llama _dispoAfterSaved( entero", () => {
    const body = discardBody();
    expect(body).toContain("_dispoAnnounce(");
    expect(body).toContain("forceToast");
    // Sigue sin llamarse el helper completo: arrastraría el hold del Power
    // Dialer ("✓ Resultado guardado"), y un descarte no es una disposición de
    // llamada. Decisión de 32-04, vigente.
    expect(body).not.toContain("_dispoAfterSaved(");
    expect(body).not.toContain("_pdHold(");
  });

  // 2026-08-17 — el bug que esto cubre: el gate de disposición (Fase 20) se
  // arma al colgar una llamada y su ÚNICA limpieza vivía en _dispoAfterSaved,
  // que _actDiscard no invoca a propósito. Descartar dejaba el gate armado y
  // el sistema seguía exigiendo "marcá el resultado" de un lead ya muerto,
  // bloqueando todos los puntos de discado. Descartar es más terminal que
  // cualquier disposición: no corresponde pedir el resultado después.
  it("limpia el gate de disposición del lead descartado", () => {
    const body = discardBody();
    expect(body).toContain("_dispoGateClear(leadId)");
  });

  it("limpia el gate DESPUÉS de aplicar el lead al store y ANTES de anunciar", () => {
    const body = discardBody();
    const store = body.indexOf("_leadStoreApply(leadId, d.lead)");
    const gate = body.indexOf("_dispoGateClear(leadId)");
    const announce = body.indexOf("_dispoAnnounce(");
    expect(store).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(store);
    expect(announce).toBeGreaterThan(gate);
  });

  it("el gate se limpia dentro del try, no en el finally (solo si el descarte salió bien)", () => {
    // Si el POST falla, el lead sigue vivo y el gate tiene que seguir armado:
    // esa llamada sin marcar es real.
    const body = discardBody();
    const gate = body.indexOf("_dispoGateClear(leadId)");
    const finallyIdx = body.indexOf("} finally {");
    expect(gate).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(finallyIdx);
  });

  it("llama _pdAdvance( dentro de un guard que compara _pd.queue[_pd.currentIdx] con el leadId", () => {
    const body = discardBody();
    expect(body).toContain("if (_pd.active && _pd.queue[_pd.currentIdx] === leadId) _pdAdvance();");
  });

  // 2026-08-16 (Fase 33, plan 03, DIAL-03): el guard de "Hoy visible" ya NO
  // hace un fetch completo (loadHoyView) — repinta desde el store, sin red
  // (_hoyRenderFromStore). Mismo guard, mismo propósito, función distinta.
  it("llama _hoyRenderFromStore( bajo el guard de #view-hoy:not(.hidden)", () => {
    const body = discardBody();
    const guardIdx = body.indexOf("document.querySelector('#view-hoy:not(.hidden)')");
    expect(guardIdx).toBeGreaterThan(-1);
    const loadIdx = body.indexOf("_hoyRenderFromStore()", guardIdx);
    expect(loadIdx).toBeGreaterThan(guardIdx);
    expect(loadIdx - guardIdx).toBeLessThan(160);
    expect(body).not.toContain("loadHoyView()");
  });

  it("_refreshLeadPanels( está dentro de un finally", () => {
    const body = discardBody();
    const finallyRe = /\}\s*finally\s*\{[\s\S]*?_refreshLeadPanels\(leadId\);[\s\S]*?\}/;
    expect(finallyRe.test(body)).toBe(true);
  });

  it("_leadStoreApply( se llama con el lead de la respuesta antes de anunciar el destino", () => {
    const body = discardBody();
    expect(body).toContain("_leadStoreApply(leadId, d.lead)");
  });
});

describe("Marca del estado bloqueado (D-16/D-11)", () => {
  it("el chip de estado descartado usa scm-chip-blocked", () => {
    expect(appJs).toContain('class="scm-chip-blocked"');
  });

  it("el bloque de _actButtonsHTML no introduce ningún color rojo hardcodeado", () => {
    const body = extractFunctionBody(appJs, "function _actButtonsHTML(leadId, opts = {}) {");
    for (const tok of ["#f85149", "F47272", "rgba(248,81,73"]) {
      expect(body).not.toContain(tok);
    }
  });

  it("el bloque de _actDiscard no introduce ningún color rojo hardcodeado", () => {
    const body = extractFunctionBody(appJs, "window._actDiscard = (leadId) => {");
    for (const tok of ["#f85149", "F47272", "rgba(248,81,73"]) {
      expect(body).not.toContain(tok);
    }
  });

  it("renderCallsList agrega scm-row-blocked cuando el lead está descartado", () => {
    const body = extractFunctionBody(appJs, "function renderCallsList() {");
    expect(body).toContain("isDiscarded ? ' scm-row-blocked' : ''");
  });

  it("no se activó el guard [data-action=\"call\"] dentro de renderCallsList (D-16 nota: ya existía sin relación en otras 4 apariciones del archivo — no se agregó ninguna nueva acá)", () => {
    const body = extractFunctionBody(appJs, "function renderCallsList() {");
    expect(body).not.toContain('data-action="call"');
  });

  it("el <span> de teléfono de renderCallsList lleva class=\"scm-phone\"", () => {
    const body = extractFunctionBody(appJs, "function renderCallsList() {");
    expect(body).toContain('<span class="scm-phone" style="font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); letter-spacing:0.02em;">');
  });

  it("el <span> de teléfono de _hoyRenderSection lleva class=\"scm-phone\"", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain('<span class="scm-phone" style="font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary);">');
  });
});

describe("Hoy — las secciones de compromiso dejan de mostrar terminales (ACT-04)", () => {
  // 2026-08-16 (Fase 34, plan 02, HOY-01/D-01/D-06): la cascada de 5 tiers
  // reformateó misCompromisos/compromisosProspecto a MULTI-línea (acotan
  // "vence hoy"/"vencido" con _commitDueAt, ver 34-02-PLAN.md Task 1, paso
  // 3) — !terminal(l)/notDnc(l) siguen ahí, pero ya no comparten línea con
  // _commitmentHoyBucket(l, nowMsHoy) (antes todo el filtro cabía en 1
  // línea). Se verifica sobre la expresión `filter(...)` completa, balanceada
  // por paréntesis, no línea por línea.
  function filterExprFor(varName) {
    const startLiteral = `const ${varName} = leads.filter(l =>`;
    const startIdx = appJs.indexOf(startLiteral);
    expect(startIdx).toBeGreaterThan(-1);
    const openIdx = startIdx + startLiteral.indexOf("filter(") + "filter(".length - 1;
    let depth = 0;
    let i = openIdx;
    for (; i < appJs.length; i++) {
      if (appJs[i] === "(") depth++;
      else if (appJs[i] === ")") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return appJs.slice(startIdx, i);
  }

  it("misCompromisos y compromisosProspecto filtran por !terminal(l)", () => {
    expect(filterExprFor("misCompromisos")).toContain("!terminal(l)");
    expect(filterExprFor("compromisosProspecto")).toContain("!terminal(l)");
  });

  it("misCompromisos y compromisosProspecto siguen filtrando notDnc(l) (no se pisó el filtro existente)", () => {
    expect(filterExprFor("misCompromisos")).toContain("notDnc(l)");
    expect(filterExprFor("compromisosProspecto")).toContain("notDnc(l)");
  });
});

describe("Material por email (ACT-05/D-17/D-18)", () => {
  function materialBody() {
    return extractFunctionBody(appJs, "window._actSendMaterial = (leadId) => {");
  }

  it("window._actSendMaterial existe y pega a send-material", () => {
    expect(appJs).toContain("window._actSendMaterial = (leadId) => {");
    expect(materialBody()).toContain("send-material");
  });

  it("contempla las dos vías ('resend' y 'mailto')", () => {
    const body = materialBody();
    expect(body).toContain("doSend('resend')");
    expect(body).toContain("doSend('mailto')");
  });

  it("maneja resendUnavailable (409) sin registrar nada del lado del cliente", () => {
    const body = materialBody();
    const idx = body.indexOf("r.status === 409 && d.resendUnavailable");
    expect(idx).toBeGreaterThan(-1);
    const blockEnd = body.indexOf("return;", idx);
    expect(blockEnd).toBeGreaterThan(idx);
    const block = body.slice(idx, blockEnd);
    expect(block).not.toContain("_leadStoreApply(");
    expect(block).not.toContain("_dispoAnnounce(");
  });

  it("maneja 502 con un toast de error propio", () => {
    const body = materialBody();
    expect(body).toContain("r.status === 502");
  });

  it("en éxito (200) hace _leadStoreApply( + _dispoAnnounce( con forceToast", () => {
    const body = materialBody();
    expect(body).toContain("_leadStoreApply(leadId, d.lead)");
    expect(body).toContain("_dispoAnnounce(leadId, { lead: d.lead, forceToast: true })");
  });

  it("NO llama _pdRender( (mismo criterio que 32-03: el envío programa nextAction a +72h)", () => {
    const body = materialBody();
    expect(body).not.toContain("_pdRender(");
  });

  it("_refreshLeadPanels( está dentro de un finally", () => {
    const body = materialBody();
    const finallyRe = /\}\s*finally\s*\{[\s\S]*?_refreshLeadPanels\(leadId\);[\s\S]*?\}/;
    expect(finallyRe.test(body)).toBe(true);
  });

  // Milestone v5.0 (Fase 41): el overlay de email dejó de reusar el catálogo de
  // WhatsApp — ahora arma el correo de presentación con el puente (una sola
  // plantilla de email, de única vez) vía _buildBridgeEmail + los dos campos de
  // horario que completa el operador.
  it("arma el correo del puente con _buildBridgeEmail y templateId ACT_EMAIL_TEMPLATE_ID (no el catálogo de WhatsApp)", () => {
    const body = materialBody();
    expect(body).toContain("_buildBridgeEmail(");
    expect(body).toContain("ACT_EMAIL_TEMPLATE_ID");
    expect(body).not.toContain("ACT_WA_TEMPLATES.map(");
    expect(body).not.toContain("_interpolateScript(");
  });

  it("tiene los dos campos de horario obligatorios (act-mat-h1 / act-mat-h2) y valida que estén completos", () => {
    const body = materialBody();
    expect(body).toContain("act-mat-h1");
    expect(body).toContain("act-mat-h2");
    // No manda si falta alguno de los dos horarios.
    expect(body).toMatch(/if \(!h1 \|\| !h2\)/);
  });

  it("red de seguridad frontend: no manda si quedó una variable sin resolver ({ } o [ ])", () => {
    const body = materialBody();
    expect(body).toContain("/[\\[\\]{}]/"); // el regex /[\[\]{}]/ literal en el fuente
  });

  it("el overlay usa z-index:10060 (o mayor)", () => {
    const body = materialBody();
    const m = /z-index:\s*(\d+)/.exec(body);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(10060);
  });
});

describe("Ficha: el link mailto viejo se reemplaza por el botón Mandar material", () => {
  it("la .call-action-row ya no tiene el <a href=\"mailto: como acción", () => {
    expect(countOccurrences(appJs, 'class="call-action-btn">Mandar mail</a>')).toBe(0);
  });

  it("existe el botón Mandar material apuntando a window._actSendMaterial", () => {
    expect(appJs).toContain("window._actSendMaterial('${escHtml(l.id)}')");
    expect(appJs).toContain(">Mandar material</button>");
  });

  it("el botón vive dentro de _callsRenderExpandedPanel", () => {
    const body = extractFunctionBody(appJs, "function _callsRenderExpandedPanel(l, opts = {}) {");
    expect(body).toContain("window._actSendMaterial(");
  });
});

describe("_renderCallHistory distingue el canal del compromiso cerrado (ACT-05)", () => {
  it("el push del evento de compromiso captura el canal", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    expect(body).toContain("canal: lead.commitment.canal");
  });

  it("la rama commitment del render menciona 'por WhatsApp' y 'por email'", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    expect(body).toContain("por WhatsApp");
    expect(body).toContain("por email");
  });
});

describe("Cache-buster (public/index.html) — chequeo de forma, nunca un literal pineado", () => {
  it("app.js?v= tiene forma válida (8 dígitos + letra)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida (este plan no lo tocó)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});
