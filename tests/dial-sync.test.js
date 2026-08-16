// Test de la sincronización de vistas (Power Dialer / Hoy / Llamadas) —
// DIAL-03, Fase 33 Plan 03. Sin browser ni jsdom en el repo: mismo molde que
// tests/dial-hold.test.js / tests/act-ui-discard-material.test.js.
//
// 1. Aserciones de fuente (escritura única instrumentada, el renderer de Hoy
//    sin red, los handlers de vista que repintan desde el store, y el límite
//    D-09 anti-alcance), extrayendo cuerpos de función por conteo de llaves
//    balanceado — mismo helper que las suites anteriores de la Fase 32/33.
// 2. Cache-buster: chequeo de FORMA (regex), nunca un literal pineado (nota
//    de 31-03/32-03/32-04/33-01/33-02: un pin exacto se rompe con cualquier
//    edición legítima y ajena de otra sesión — pasó de nuevo en este plan,
//    ver 33-03-SUMMARY.md).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/dial-hold.test.js — extrae el cuerpo `{...}`
// balanceado de una función/handler a partir del literal exacto de su
// declaración (`startLiteral` DEBE terminar en el `{` que abre el cuerpo, no
// el primer `{` que aparezca después — ej. un default param como `opts = {}`).
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

describe("_leadStoreApply instrumentado: bumpea versión y marca el id sucio", () => {
  it("_leadStoreVersion++ aparece exactamente 1 vez en todo el archivo", () => {
    expect(countOccurrences(appJs, "_leadStoreVersion++")).toBe(1);
  });

  it("esa única ocurrencia y el add a _leadStoreDirty están dentro del cuerpo de _leadStoreApply", () => {
    const body = extractFunctionBody(appJs, "function _leadStoreApply(id, patch) {");
    expect(body).toContain("_leadStoreVersion++; _leadStoreDirty.add(id);");
  });

  it("window.__leadStoreVersion expone la versión actual para diagnóstico en vivo", () => {
    expect(appJs).toContain("window.__leadStoreVersion = () => _leadStoreVersion;");
  });

  it("_leadStoreDirty y _leadStoreVersion se declaran junto a _leadStoreApply", () => {
    const idxDirty = appJs.indexOf("const _leadStoreDirty = new Set();");
    const idxVersion = appJs.indexOf("let _leadStoreVersion = 0;");
    const idxApply = appJs.indexOf("function _leadStoreApply(id, patch) {");
    expect(idxDirty).toBeGreaterThan(-1);
    expect(idxVersion).toBeGreaterThan(-1);
    expect(idxApply).toBeGreaterThan(-1);
    // Las 2 declaraciones caen ANTES de la función (mismo bloque), sin nada
    // grande de por medio.
    expect(idxApply - idxVersion).toBeLessThan(600);
    expect(idxApply - idxDirty).toBeLessThan(600);
  });

  it("sigue siendo la ÚNICA función que muta los dos cachés: contiene el Object.assign del array y el .set del Map", () => {
    const body = extractFunctionBody(appJs, "function _leadStoreApply(id, patch) {");
    expect(body).toContain("Object.assign(callsLeadsCache[idx], patch");
    expect(body).toContain("_callsLeadsById.set(id");
  });
});

describe("Escritura única (D-07): _callsLeadsById.set( solo en los lugares legítimos", () => {
  // `_callsLeadsById.set(` aparece exactamente 2 veces en TODO el archivo:
  // 1) dentro de _leadStoreApply (la escritura única real) y
  // 2) en la creación del "ghost lead" del botón "Discar número" ad-hoc
  //    (2026-07-25 nota #55/#181): un lead sintético que NUNCA vive en
  //    callsLeadsCache (no viene del server, no tiene fila en ninguna lista)
  //    — solo necesita resolver por _callsLeadsById.get() para que
  //    _startTelnyxCall encuentre el nombre/teléfono. No pasar por
  //    _leadStoreApply es correcto acá: ese helper asume que el lead puede
  //    vivir en el array, y este no vive ahí a propósito.
  // _rebuildCallsLeadsIndex reconstruye el Map ENTERO (`_callsLeadsById = new
  // Map(...)`), no hace `.set(` por id — y loadHoyView/loadCallsView delegan
  // en _rebuildCallsLeadsIndex, nunca escriben el Map directo.
  it("_callsLeadsById.set( aparece exactamente 2 veces en todo el archivo", () => {
    expect(countOccurrences(appJs, "_callsLeadsById.set(")).toBe(2);
  });

  it("una ocurrencia vive en _leadStoreApply", () => {
    const body = extractFunctionBody(appJs, "function _leadStoreApply(id, patch) {");
    expect(countOccurrences(body, "_callsLeadsById.set(")).toBe(1);
  });

  it("la otra ocurrencia es el ghost lead del discado manual ad-hoc (ghostId/ghostLead)", () => {
    const idx = appJs.lastIndexOf("_callsLeadsById.set(");
    const context = appJs.slice(Math.max(0, idx - 400), idx);
    expect(context).toContain("ghostLead");
    expect(context).toContain("_isManualDial: true");
  });

  it("_rebuildCallsLeadsIndex reconstruye el Map entero, no hace .set( por id", () => {
    const body = extractFunctionBody(appJs, "function _rebuildCallsLeadsIndex() {");
    expect(body).toContain("_callsLeadsById = new Map(callsLeadsCache.map(l => [l.id, l]));");
    expect(body).not.toContain(".set(");
  });

  it("loadHoyView y loadCallsView delegan en _rebuildCallsLeadsIndex — no escriben el Map directo", () => {
    const hoyBody = extractFunctionBody(appJs, "async function loadHoyView() {");
    const callsBody = extractFunctionBody(appJs, "async function loadCallsView() {");
    expect(hoyBody).toContain("_rebuildCallsLeadsIndex();");
    expect(hoyBody).not.toContain("_callsLeadsById.set(");
    expect(callsBody).toContain("_rebuildCallsLeadsIndex();");
    expect(callsBody).not.toContain("_callsLeadsById.set(");
  });
});

describe("_hoyRenderFromStore no toca la red (repintar no hace fetch)", () => {
  it("el cuerpo NO contiene fetch( ni await ", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("await ");
  });

  it("guard anti-repintado redundante: solo aplica sin leadsArg, con la misma versión y algo ya pintado", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain("if (!leadsArg && _hoyRenderedVersion === _leadStoreVersion && secEl.children.length) return;");
  });

  it("con leadsArg SIEMPRE rehace el innerHTML (el guard no lo intercepta)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const guardIdx = body.indexOf("if (!leadsArg && _hoyRenderedVersion");
    expect(guardIdx).toBeGreaterThan(-1);
    // El guard empieza literalmente con `!leadsArg &&` — con leadsArg presente
    // la condición corta en el primer término y nunca hace early-return.
    expect(body.slice(guardIdx, guardIdx + 12)).toBe("if (!leadsAr");
  });

  it("guarda la versión repintada al final del cuerpo", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain("_hoyRenderedVersion = _leadStoreVersion;");
  });

  it("expuesta en window (los handlers de vista y los tests de fuente la buscan por nombre)", () => {
    expect(appJs).toContain("window._hoyRenderFromStore = _hoyRenderFromStore;");
  });
});

describe("Los 4 títulos literales de Hoy siguen en _hoyRenderFromStore (anti-deriva con tests/commitment-hoy.test.js)", () => {
  it("los 4 _hoyRenderSection( con sus títulos literales viven en el cuerpo de _hoyRenderFromStore", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain("_hoyRenderSection('Mis compromisos'");
    expect(body).toContain("_hoyRenderSection('Esperando del prospecto'");
    expect(body).toContain("_hoyRenderSection('Callbacks'");
    expect(body).toContain("_hoyRenderSection('Interesados sin agendar'");
  });

  // 2026-08-16 (Fase 34, plan 02, HOY-01/D-01): la cascada de 5 tiers sumó 2
  // llamadas nuevas a _hoyRenderSection ('Reintentos de no-contacto' y 'Red
  // de seguridad', ver 34-02-PLAN.md) — el conteo sube de 5 a 7 (1
  // declaración + 6 llamadas). Deviation Rule 1 documentada en
  // 34-02-SUMMARY.md: el plan asumía este test sin cambios, pero el diseño
  // explícito del mismo plan lo rompe — se corrige el número, no el diseño.
  it("_hoyRenderSection( aparece exactamente 7 veces en todo el archivo (1 declaración + 6 llamadas, tras la cascada de 5 tiers de Fase 34)", () => {
    expect(countOccurrences(appJs, "_hoyRenderSection(")).toBe(7);
  });
});

describe("_callsShowView / _hoyShowView: repintan si hay datos frescos, si no fetchean", () => {
  it("ambas funciones existen exactamente una vez", () => {
    expect(countOccurrences(appJs, "function _callsShowView() {")).toBe(1);
    expect(countOccurrences(appJs, "function _hoyShowView() {")).toBe(1);
  });

  it("_callsShowView compara contra LEAD_STORE_STALE_MS y cae a loadCallsView() si no hay datos frescos", () => {
    const body = extractFunctionBody(appJs, "function _callsShowView() {");
    expect(body).toContain("LEAD_STORE_STALE_MS");
    expect(body).toContain("renderCallsList();");
    expect(body).toContain("loadCallsView();");
  });

  it("_hoyShowView compara contra LEAD_STORE_STALE_MS y cae a loadHoyView() si no hay datos frescos", () => {
    const body = extractFunctionBody(appJs, "function _hoyShowView() {");
    expect(body).toContain("LEAD_STORE_STALE_MS");
    expect(body).toContain("_hoyRenderFromStore();");
    expect(body).toContain("loadHoyView();");
  });

  it("los listeners de [data-target=\"view-calls\"] y [data-target=\"view-hoy\"] llaman a las 2 funciones nuevas (no al fetch directo)", () => {
    expect(appJs).toContain("if (callsMenuItem) callsMenuItem.addEventListener('click', () => { _callsShowView(); });");
    expect(appJs).toContain(
      "document.querySelector('[data-target=\"view-hoy\"]')?.addEventListener('click', () => { _hoyShowView(); });"
    );
  });

  it("el listener viejo de loadHoyView() directo en el click ya no está", () => {
    expect(countOccurrences(appJs, "click', () => { loadHoyView(); }")).toBe(0);
    expect(countOccurrences(appJs, "click', () => { loadCallsView(); }")).toBe(0);
  });
});

describe("LEAD_STORE_STALE_MS: frescura de 5 minutos, documentada", () => {
  it("la constante vale 5 * 60 * 1000 y se declara junto a callsLeadsCache", () => {
    expect(appJs).toContain("const LEAD_STORE_STALE_MS = 5 * 60 * 1000;");
  });

  it("_callsFetchedAt se setea al final del try exitoso de loadCallsView", () => {
    const body = extractFunctionBody(appJs, "async function loadCallsView() {");
    const idx = body.lastIndexOf("_callsFetchedAt = Date.now();");
    expect(idx).toBeGreaterThan(-1);
    // Tiene que estar DESPUÉS del render de la lista (no antes de que los
    // datos existan de verdad).
    const renderIdx = body.indexOf("renderCallsList();");
    expect(idx).toBeGreaterThan(renderIdx);
  });

  it("aparece al menos 4 veces en todo el archivo (declaración + los 2 usos en _callsShowView/_hoyShowView + el set en loadCallsView)", () => {
    expect(countOccurrences(appJs, "LEAD_STORE_STALE_MS")).toBeGreaterThanOrEqual(4);
  });
});

describe("Repintado tras escribir, con la vista abierta: _dispoAfterSaved / _actDiscard sin fetch, _pdExit con fetch", () => {
  it("_dispoAfterSaved repinta Hoy con _hoyRenderFromStore() y NO llama loadHoyView()", () => {
    const body = extractFunctionBody(appJs, "function _dispoAfterSaved(leadId, opts = {}) {");
    expect(body).toContain("_hoyRenderFromStore()");
    expect(body).not.toContain("loadHoyView()");
  });

  it("window._actDiscard repinta Hoy con _hoyRenderFromStore() y NO llama loadHoyView()", () => {
    const body = extractFunctionBody(appJs, "window._actDiscard = (leadId) => {");
    expect(body).toContain("_hoyRenderFromStore()");
    expect(body).not.toContain("loadHoyView()");
  });

  it("_refreshLeadPanels repinta Hoy desde el store si la vista está visible, además de renderCallsList/_hoyRefreshFicha", () => {
    const body = extractFunctionBody(appJs, "function _refreshLeadPanels(leadId) {");
    expect(body).toContain("renderCallsList();");
    expect(body).toContain("window._hoyRefreshFicha?.(leadId);");
    expect(body).toContain("if (document.querySelector('#view-hoy:not(.hidden)')) _hoyRenderFromStore();");
  });

  it("window._pdExit sigue haciendo fetch completo al salir (refresco explícito de la sesión de discado)", () => {
    const body = extractFunctionBody(appJs, "window._pdExit = function() {");
    expect(body).toContain("loadHoyView()");
    expect(body).toContain("loadCallsView()");
  });
});

describe("Límite D-09 (anti-alcance): NO se construyó ningún store reactivo ni sistema de suscripción", () => {
  // Este es el test que impide que una fase futura convierta la escritura
  // única + repintado explícito de este plan en el rewrite grande que la
  // nota #105 de CLAUDE.md descartó a propósito ("un store reactivo
  // multi-vista es el trabajo invasivo/riesgoso, queda como mejora futura").
  it("no aparecen los literales de un mecanismo de suscripción en todo el archivo", () => {
    expect(appJs).not.toContain("addEventListener('leadstore");
    expect(appJs).not.toContain("dispatchEvent(new CustomEvent('lead");
    expect(appJs).not.toContain("new Proxy(");
  });

  it("_leadStoreApply sigue siendo un mutador directo, no un emisor de eventos", () => {
    const body = extractFunctionBody(appJs, "function _leadStoreApply(id, patch) {");
    expect(body).not.toContain("dispatchEvent");
    expect(body).not.toContain(".emit(");
    expect(body).not.toContain("subscribe");
  });
});

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL con el que arrancó este plan, confirmado en disco antes de
  // cualquier edit (ver <important_note> del prompt de ejecución): 20260816b
  // (línea 3679, dejado por 33-02). No se pinea un valor exacto post-bump:
  // cualquier sesión paralela legítima puede volver a bumpearlo por un
  // motivo ajeno a esta fase (ya pasó varias veces, ver 31-03/32-03/32-04/
  // 33-01/33-02 y la nota de Deviations de este plan) — se verifica FORMA +
  // estrictamente mayor que el baseline real.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260816b)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260816b").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue teniendo forma válida (NO se tocó en este plan)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});
