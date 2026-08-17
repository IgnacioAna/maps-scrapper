// Suite de HOY-01/HOY-02/HOY-04 — Fase 34, Plan 02 (34-02-PLAN.md).
// Reescribe _hoyRenderFromStore de 4 buckets sueltos (Fase 33) a la cascada
// de 5 tiers exclusivos (D-01/D-02) + filtro por país (HOY-02, D-04/D-05/D-06)
// + allLeadsForHygiene (blocker del checker, para 34-03/HOY-05).
//
// Mismo molde que tests/dial-sync.test.js / tests/commitment-hoy.test.js: no
// hay browser ni jsdom en el repo (vitest.config.js no declara environment),
// así que las funciones que tocan `document` (_hoyPopulateCountryFilter,
// _hoySelectedCountry) se verifican por ASERCIÓN DE FUENTE, no ejecutándolas.
// _hoyRenderSection SÍ se ejecuta con `new Function` (no toca `document`
// salvo los `onclick="..."` que son strings, nunca los evalúa) — es el test
// de regresión que pide el plan para opts.collapsible.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal del mismo helper usado en tests/dial-sync.test.js /
// tests/commitment-hoy.test.js: extrae el cuerpo `{...}` balanceado de una
// función a partir del literal exacto de su declaración. `startLiteral` DEBE
// terminar en el `{` que abre el cuerpo (no el primer `{` que aparezca
// después, ej. un default param como `opts = {}`).
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

// Ejecuta _hoyRenderSection en aislamiento, con stubs mínimos de las
// funciones externas que referencia por NOMBRE (no por `typeof x ===
// 'function'`, que es seguro sobre variables no declaradas — no hace falta
// stubear _leadLocalTime/_signalChips/countryFlagHTML).
function buildIsolatedHoyRenderSection() {
  const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
  const src = `
    function _callScore(l) { return 0; }
    function _hoyOwnerName(l) { return 'Nadie'; }
    function escHtml(s) { return String(s == null ? '' : s); }
    function _phoneShown(p) { return p; }
    function _briefClean(l) { return null; }
    function _dispoSelectHTML(id, o) { return '<select></select>'; }
    function _actButtonsHTML(id, o) { return '<button></button>'; }
    function _stageChipsHTML(id, o) { return '<select class="stage-select"></select>'; }
    function _leadDueAt(l) { return l && l.callbackAt ? new Date(l.callbackAt).getTime() : null; }
    ${body}
    return _hoyRenderSection;
  `;
  return new Function(src)();
}

function fakeLead(id) {
  return { id, name: 'Lead ' + id, callbackAt: null, phone: '', city: '', country: '', leadBrief: null, openingAngle: '' };
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
});

describe("HOY-01/D-01: orden de la cascada de 5 tiers dentro de _hoyRenderFromStore", () => {
  it("las 6 llamadas (5 tiers + gate de Nuevos) aparecen, en este orden de indexOf", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const iMis = body.indexOf("_hoyRenderSection('Mis compromisos'");
    const iEsp = body.indexOf("_hoyRenderSection('Esperando del prospecto'");
    const iCb = body.indexOf("_hoyRenderSection('Callbacks'");
    const iInt = body.indexOf("_hoyRenderSection('Interesados sin agendar'");
    const iRet = body.indexOf("_hoyRenderSection('Reintentos de no-contacto'");
    const iGate = body.indexOf("tier123Empty ? _hoyNewLeadsPointer(virgenesCount)");
    const iRed = body.indexOf("_hoyRenderSection('Red de seguridad'");
    for (const idx of [iMis, iEsp, iCb, iInt, iRet, iGate, iRed]) expect(idx).toBeGreaterThan(-1);
    expect(iMis).toBeLessThan(iEsp);
    expect(iEsp).toBeLessThan(iCb);
    expect(iCb).toBeLessThan(iInt);
    expect(iInt).toBeLessThan(iRet);
    expect(iRet).toBeLessThan(iGate);
    expect(iGate).toBeLessThan(iRed);
  });

  it("Red de seguridad es la ÚLTIMA sección y es colapsable", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain(
      "_hoyRenderSection('Red de seguridad', redSeguridad, 'var(--text-tertiary)', 'Tocados sin próxima acción — resolvé desde acá', null, { collapsible: true })"
    );
    // No debe haber ningún _hoyRenderSection( después del de Red de seguridad.
    const iRed = body.indexOf("_hoyRenderSection('Red de seguridad'");
    const after = body.slice(iRed + "_hoyRenderSection('Red de seguridad'".length);
    expect(after).not.toContain("_hoyRenderSection('");
  });
});

describe("HOY-04/D-02: exclusividad real entre los 5 tiers reclamables", () => {
  it("los 5 tiers reclamables + Red de seguridad participan de `claimed` (6 usos de claimed.add)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const claims = ["callbacks.forEach(l => claimed.add", "misCompromisos.forEach(l => claimed.add",
      "compromisosProspecto.forEach(l => claimed.add", "interesados.forEach(l => claimed.add",
      "reintentos.forEach(l => claimed.add", "redSeguridad.forEach(l => claimed.add"];
    for (const c of claims) expect(body).toContain(c);
    expect(countOccurrences(body, "claimed.add")).toBe(6);
  });

  it("cada tier excluye lo ya reclamado con !claimed.has(l.id), salvo callbacks (primero en la cascada)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    // misCompromisos/compromisosProspecto/interesados filtran por !claimed.has
    const misIdx = body.indexOf("const misCompromisos = leads.filter(l =>");
    expect(body.slice(misIdx, misIdx + 200)).toContain("!claimed.has(l.id)");
    const espIdx = body.indexOf("const compromisosProspecto = leads.filter(l =>");
    expect(body.slice(espIdx, espIdx + 200)).toContain("!claimed.has(l.id)");
    const intIdx = body.indexOf("const interesados = leads.filter(l =>");
    expect(body.slice(intIdx, intIdx + 150)).toContain("!claimed.has(l.id)");
    const redIdx = body.indexOf("const redSeguridad = leads.filter(l =>");
    expect(body.slice(redIdx, redIdx + 200)).toContain("!claimed.has(l.id)");
  });
});

describe("HOY-01/D-09/D-10/D-11: terminal() incluye 'cerrado' y Red de seguridad solo cuenta tocados", () => {
  it("terminal() excluye descartado, agendado Y cerrado (Fase 9 deals ganados)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain("const terminal = (l) => l.estado === 'descartado' || l.estado === 'agendado' || l.estado === 'cerrado';");
  });

  it("redSeguridad exige callLog.length > 0 (D-10: el stock virgen nunca entra ahí)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const idx = body.indexOf("const redSeguridad = leads.filter(l =>");
    expect(idx).toBeGreaterThan(-1);
    const filterSrc = body.slice(idx, body.indexOf(");", idx) + 2);
    expect(filterSrc).toContain("Array.isArray(l.callLog) && l.callLog.length > 0");
  });

  it("redSeguridad exige que NO tenga próxima acción (nextAction.dueAt ausente)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const idx = body.indexOf("const redSeguridad = leads.filter(l =>");
    const filterSrc = body.slice(idx, body.indexOf(");", idx) + 2);
    expect(filterSrc).toContain("!(l.nextAction && l.nextAction.dueAt)");
  });
});

describe("HOY-01/D-01 #3: Reintentos de no-contacto (tier 3, NUEVO)", () => {
  it("reintentos filtra por nextAction.origen === 'cadencia' y dueAt vencido hoy", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const idx = body.indexOf("const reintentos = leads.filter(l => {");
    expect(idx).toBeGreaterThan(-1);
    const filterSrc = body.slice(idx, idx + 400);
    expect(filterSrc).toContain("na.origen === 'cadencia'");
    expect(filterSrc).toContain("new Date(na.dueAt).getTime() <= endTodayTs");
  });

  it("_hoyState incluye retryIds derivado de reintentos", () => {
    expect(appJs).toContain("retryIds: reintentos.map(l => l.id),");
  });
});

describe("HOY-01/D-01 #4: gate del tier 'Nuevos por score'", () => {
  it("tier123Empty suma los 5 tiers reclamables (no incluye Red de seguridad)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain(
      "const tier123Empty = (callbacks.length + misCompromisos.length + compromisosProspecto.length + interesados.length + reintentos.length) === 0;"
    );
  });

  it("el render de _hoyNewLeadsPointer está condicionado por tier123Empty (ternario)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(body).toContain("(tier123Empty ? _hoyNewLeadsPointer(virgenesCount) : '')");
  });

  it("virgenesCount sigue siendo el literal EXACTO de antes de este plan (protege el test anti-deriva de commitment-hoy.test.js)", () => {
    expect(appJs).toContain(
      "const virgenesCount = leads.filter(l => !claimed.has(l.id) && notDnc(l) && !terminal(l) && (Number(l.callAttempts || 0) === 0)).length;"
    );
  });
});

describe("D-06: _commitDueAt — fecha vigente del compromiso (nextAction o commitment)", () => {
  it("vive en scope compartido, con la misma precedencia y fallback a commitment.dueAt", () => {
    // 2026-08-17: era un closure dentro de _hoyRenderFromStore. Se subió a
    // scope de módulo (bloque DUEAT-PURE) para que la cola del Power Dialer
    // lea el MISMO reloj que esta vista — el bug que originó el cambio fue
    // justamente que miraban relojes distintos. La lógica no cambió.
    const body = extractFunctionBody(appJs, "function _commitDueAt(l) {");
    expect(body).toContain("l.nextAction && l.nextAction.origen === 'compromiso' && l.nextAction.dueAt");
    expect(body).toContain("? l.nextAction.dueAt");
    expect(body).toContain(": (l.commitment ? l.commitment.dueAt : null);");
    // Y _hoyRenderFromStore lo sigue usando (no se quedó con una copia).
    const render = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    expect(render).toContain("_commitDueAt(l)");
  });

  it("misCompromisos filtra y ordena con _commitDueAt (vence hoy)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const idx = body.indexOf("const misCompromisos = leads.filter(l =>");
    const chunk = body.slice(idx, idx + 500);
    expect(chunk).toContain("_commitmentHoyBucket(l, nowMsHoy) === 'yo'");
    expect(chunk).toContain("new Date(_commitDueAt(l)).getTime() <= endTodayTs");
    expect(chunk).toContain(".sort((a, b) => new Date(_commitDueAt(a)) - new Date(_commitDueAt(b)))");
  });

  it("compromisosProspecto filtra por _commitDueAt VENCIDO (<= now, no endTodayTs)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const idx = body.indexOf("const compromisosProspecto = leads.filter(l =>");
    const chunk = body.slice(idx, idx + 500);
    expect(chunk).toContain("_commitmentHoyBucket(l, nowMsHoy) === 'prospecto'");
    expect(chunk).toContain("new Date(_commitDueAt(l)).getTime() <= now");
  });
});

describe("_hoyRenderSection: opts.collapsible — regresión ejecutando la función aislada", () => {
  it("sin opts.collapsible (0 leads), el markup sigue siendo <div class=\"hoy-section\" (nunca <details>)", () => {
    const fn = buildIsolatedHoyRenderSection();
    const html = fn('Título', [], '#fff', 'hint', null);
    expect(html.trim().startsWith('<div class="hoy-section"')).toBe(true);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<summary');
    expect(html.trim().endsWith('</div>')).toBe(true);
  });

  it("sin opts.collapsible (2 leads), sigue siendo <div>, sin atributo open", () => {
    const fn = buildIsolatedHoyRenderSection();
    const html = fn('Título', [fakeLead('a'), fakeLead('b')], '#fff', 'hint', null, {});
    expect(html.trim().startsWith('<div class="hoy-section"')).toBe(true);
    expect(html).not.toContain(' open>');
  });

  it("con opts.collapsible:true y 0 leads, usa <details> SIN el atributo open", () => {
    const fn = buildIsolatedHoyRenderSection();
    const html = fn('Red de seguridad', [], '#fff', 'hint', null, { collapsible: true });
    expect(html.trim().startsWith('<details class="hoy-section"')).toBe(true);
    expect(html).toContain('<summary class="hoy-section-head"');
    expect(html.trim().endsWith('</details>')).toBe(true);
    // Sin leads no debe llevar el atributo open.
    const headerTag = html.slice(0, html.indexOf('>') + 1);
    expect(headerTag).not.toContain(' open');
  });

  it("con opts.collapsible:true y 2 leads, usa <details open> (empieza abierta si hay algo que resolver, D-09)", () => {
    const fn = buildIsolatedHoyRenderSection();
    const html = fn('Red de seguridad', [fakeLead('a'), fakeLead('b')], '#fff', 'hint', null, { collapsible: true });
    const headerTag = html.slice(0, html.indexOf('>') + 1);
    expect(headerTag).toContain(' open');
    expect(html).toContain('<summary');
  });
});

describe("HOY-02/D-04/D-05/D-06: filtro por país", () => {
  it("select#hoy-country-filter existe en el header de view-hoy", () => {
    expect(indexHtml).toContain('id="hoy-country-filter"');
    expect(indexHtml).toContain('<option value="">Todos los países</option>');
  });

  it("_hoySelectedCountry lee el value del select por id", () => {
    const body = extractFunctionBody(appJs, "function _hoySelectedCountry() {");
    expect(body).toContain("document.getElementById('hoy-country-filter')?.value || ''");
  });

  it("_hoyPopulateCountryFilter usa _leadLocalTime para derivar ok/hasTz por país", () => {
    const body = extractFunctionBody(appJs, "function _hoyPopulateCountryFilter(leads) {");
    expect(body).toContain("_leadLocalTime({ country: c })");
  });

  it("_hoyPopulateCountryFilter ordena por ok DESCENDENTE, count DESCENDENTE como segundo criterio (D-05, mismo patrón que Distribución)", () => {
    const body = extractFunctionBody(appJs, "function _hoyPopulateCountryFilter(leads) {");
    expect(body).toContain(".sort((a, b) => (Number(b.ok) - Number(a.ok)) || (b.count - a.count));");
  });

  it("persiste la elección en localStorage por usuario (hoy_country_filter_) — lectura y escritura, mismo patrón que calls_country_filter_", () => {
    const body = extractFunctionBody(appJs, "function _hoyPopulateCountryFilter(leads) {");
    expect(body).toContain("localStorage.getItem('hoy_country_filter_' + (currentUser?.id || 'anon'))");
    expect(body).toContain("localStorage.setItem('hoy_country_filter_' + (currentUser?.id || 'anon'), sel.value)");
    // El literal se repite en la lectura y en la escritura (sin variable
    // compartida) — mismo patrón que calls_country_filter_ en loadCallsView.
    expect(countOccurrences(appJs, "hoy_country_filter_")).toBeGreaterThanOrEqual(2);
  });

  it("las opciones interpolan el país con escHtml (T-34-05, XSS)", () => {
    const body = extractFunctionBody(appJs, "function _hoyPopulateCountryFilter(leads) {");
    expect(body).toContain("escHtml(r.country)");
  });

  it("al cambiar, repinta desde el store sin fetch (fuerza _hoyRenderedVersion = -1 y llama _hoyRenderFromStore())", () => {
    const body = extractFunctionBody(appJs, "function _hoyPopulateCountryFilter(leads) {");
    expect(body).toContain("_hoyRenderedVersion = -1");
    expect(body).toContain("_hoyRenderFromStore();");
    expect(body).not.toContain("fetch(");
  });

  it("loadHoyView puebla el filtro de país ANTES de pintar (con los leads recién traídos)", () => {
    const body = extractFunctionBody(appJs, "async function loadHoyView() {");
    const popIdx = body.indexOf("_hoyPopulateCountryFilter(leads)");
    const renderIdx = body.indexOf("_hoyRenderFromStore(leads)");
    expect(popIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeGreaterThan(-1);
    expect(popIdx).toBeLessThan(renderIdx);
  });

  it("_hoyRenderFromStore aplica el filtro de país ANTES de calcular `now`/`claimed`", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const filterIdx = body.indexOf("if (countryFilter) leads = leads.filter(l => (l.country || '').trim() === countryFilter);");
    const nowIdx = body.indexOf("const now = Date.now();");
    const claimedIdx = body.indexOf("const claimed = new Set();");
    expect(filterIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeLessThan(nowIdx);
    expect(filterIdx).toBeLessThan(claimedIdx);
  });
});

describe("HOY-05 (blocker del checker, 2026-08-16): allLeadsForHygiene capturado ANTES del filtro de país", () => {
  it("existe el literal `const allLeadsForHygiene = leads;` exactamente una vez en el archivo", () => {
    expect(countOccurrences(appJs, "const allLeadsForHygiene = leads;")).toBe(1);
  });

  it("aparece DENTRO del cuerpo de _hoyRenderFromStore, en una posición ANTERIOR al filtro de país", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    const hygieneIdx = body.indexOf("const allLeadsForHygiene = leads;");
    const filterIdx = body.indexOf("leads = leads.filter(l => (l.country || '').trim() === countryFilter);");
    expect(hygieneIdx).toBeGreaterThan(-1);
    expect(filterIdx).toBeGreaterThan(-1);
    expect(hygieneIdx).toBeLessThan(filterIdx);
  });

  it("es una referencia al array COMPLETO (no un .slice/.filter aplicado)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderFromStore(leadsArg) {");
    // No debe haber ningún .filter/.slice ENTRE la resolución de `leads` (el
    // bloque de población, que no toca este plan) y la línea de captura.
    const hygieneIdx = body.indexOf("const allLeadsForHygiene = leads;");
    const beforeHygiene = body.slice(0, hygieneIdx);
    // El único filtro legítimo antes de este punto es el guard de leadsArg /
    // la reconstrucción desde _hoyLeadIds — ninguno reasigna `leads =
    // leads.filter(`.
    expect(beforeHygiene).not.toContain("leads = leads.filter(");
  });
});

describe("Cache-buster: app.js bumpeado de nuevo, style.css intacto", () => {
  it("app.js?v= tiene forma válida de fecha+letra", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });

  it("style.css?v= tiene forma válida — esta fase no le agregó CSS propio", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});
