// Test del cableado del calendario propio (Fase 28, Plan 02) a los 5 campos
// de fecha reales de la app + los helpers de hora local del lead (D-06).
//
// Es una prueba de CÓDIGO FUENTE, no de DOM: no hay jsdom en el proyecto, así
// que la Task 1 se verifica leyendo public/app.js como texto (patrón ya usado
// por tests/app-version.test.js y tests/dtpicker-core.test.js). La Task 2
// extrae el bloque LEADTIME-AT por marcadores y lo evalúa aislado, mismo
// patrón que tests/dtpicker-core.test.js con DTPICKER-PURE.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
});

function countOccurrences(str, sub) {
  let count = 0;
  let idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) {
    count++;
    idx += sub.length;
  }
  return count;
}

describe("Task 1 — cableado de _dtPickerAttach a los 5 inputs reales", () => {
  it("hay exactamente 5 llamadas a _dtPickerAttach( (sin contar la declaración)", () => {
    const total = countOccurrences(appJs, "_dtPickerAttach(");
    const decl = countOccurrences(appJs, "function _dtPickerAttach(");
    expect(decl).toBe(1);
    expect(total - decl).toBe(5);
  });

  it("call-cb-fecha (openCallbackModal, variable fechaInput) está attacheado con getLead de _callsLeadsById", () => {
    expect(appJs).toContain("_dtPickerAttach(fechaInput, { getLead: () => _callsLeadsById.get(leadId) });");
  });

  it("call-ph-fecha (openPlaceholderModal, variable fechaIn) está attacheado con getLead: () => lead", () => {
    expect(appJs).toContain("_dtPickerAttach(fechaIn, { getLead: () => lead });");
  });

  it("call-sched-fecha (openScheduleModal) está attacheado con getLead: () => lead", () => {
    expect(appJs).toContain(
      "_dtPickerAttach(document.getElementById('call-sched-fecha'), { getLead: () => lead });"
    );
  });

  it("agendar-fecha (openAgendarModal) está attacheado con getLead: () => _agendarLead", () => {
    expect(appJs).toContain(
      "_dtPickerAttach(document.getElementById('agendar-fecha'), { getLead: () => _agendarLead });"
    );
  });

  it("schedule-datetime (_openLeadModal, variable dtInput) está attacheado con getLead: () => null (D-06: sin lead confiable)", () => {
    expect(appJs).toContain("_dtPickerAttach(dtInput, { getLead: () => null });");
  });

  it("al menos 3 llamadas a _dtPickerSync( además de los usos internos del componente", () => {
    const total = countOccurrences(appJs, "_dtPickerSync(");
    // Baseline de 28-01: 3 usos internos + 1 declaración = 4. Este plan suma
    // 3 llamadas más desde los quickpicks/preset (D-05).
    expect(total).toBeGreaterThanOrEqual(7);
  });

  it("_dtPickerSync repinta el trigger tras los 3 atajos existentes (D-05: siguen siendo un click directo)", () => {
    expect(appJs).toContain("_dtPickerSync(fechaInput);"); // .cb-quickpick
    expect(appJs).toContain("_dtPickerSync(fechaIn);"); // .ph-quickpick
    expect(appJs).toContain("if (dtInput) _dtPickerSync(dtInput);"); // [data-schedule-preset]
  });

  it("_toDatetimeLocal y _scheduleFormatDatetimeLocal siguen existiendo, sin duplicarse", () => {
    expect(countOccurrences(appJs, "function _toDatetimeLocal")).toBe(1);
    expect(countOccurrences(appJs, "function _scheduleFormatDatetimeLocal")).toBe(1);
  });

  it("los 5 inputs siguen siendo type=\"datetime-local\" en index.html", () => {
    expect(countOccurrences(indexHtml, 'type="datetime-local"')).toBe(5);
  });

  it("los quickpicks/preset de D-05 siguen presentes intactos", () => {
    expect(indexHtml).toContain("call-cb-quickpicks");
    expect(indexHtml).toContain("call-ph-quickpicks");
    expect(indexHtml).toContain("data-schedule-preset");
    expect(appJs).toContain("cb-quickpick");
    expect(appJs).toContain("ph-quickpick");
  });

  it("los handlers de guardado (confirm) no fueron tocados — siguen leyendo .value directo", () => {
    // Task 1 restriction: no debe haber ninguna llamada a _dtPicker dentro de
    // los bloques onclick de confirmar (solo dentro de los defaults/quickpicks).
    const confirmBlocks = [
      /confirmBtn\.onclick = async \(\) => \{[\s\S]*?\n\s{6}\};/, // call-cb-confirm
      /phBtn\.onclick = async \(\) => \{[\s\S]*?\n\s{6}\};/, // call-ph-confirm
    ];
    for (const re of confirmBlocks) {
      const m = re.exec(appJs);
      expect(m).toBeTruthy();
      expect(m[0]).not.toContain("_dtPickerAttach");
      expect(m[0]).not.toContain("_dtPickerSync");
    }
  });

  it("cache-buster de app.js fue bumpeado desde el baseline de este plan (28-02)", () => {
    // 28-02 lo dejó en v=20260814b; 28-03 lo bumpeó de nuevo (a v=20260814c) al
    // tocar app.js/index.html — este test solo verifica que NO quedó en un
    // valor anterior a 28-02, no fija el valor exacto (eso lo hace
    // tests/panel-drag.test.js para la versión vigente).
    const m = indexHtml.match(/app\.js\?v=([0-9a-z]+)/i);
    expect(m).toBeTruthy();
    expect(m[1] >= "20260814b").toBe(true);
  });
});

describe("Task 2 — D-06: hora local del lead para una fecha arbitraria (bloque LEADTIME-AT)", () => {
  const START = "// ─── [28-02] LEADTIME-AT: INICIO ───";
  const END = "// ─── [28-02] LEADTIME-AT: FIN ───";
  let leadtime;

  beforeAll(() => {
    const startIdx = appJs.indexOf(START);
    const endIdx = appJs.indexOf(END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      throw new Error(
        `No se encontraron los marcadores LEADTIME-AT en public/app.js (start=${startIdx}, end=${endIdx}). ` +
          `Verificar que "${START}" y "${END}" existen literales en el archivo.`
      );
    }
    const block = appJs.slice(startIdx, endIdx);
    // El bloque real lee `_LEAD_TZ` del closure de app.js (declarado más
    // arriba en el archivo) — el wrapper lo inyecta ANTES del código
    // extraído, con un mapa mínimo suficiente para los casos de test. También
    // stubea `window` (el bloque hace `window._leadLocalTimeAt = ...`, y
    // Node no tiene `window`) — mismo espíritu que el stub de fetch/document
    // que usan otros tests puros del repo (p.ej. mercury-style).
    const factory = new Function(
      `const window = {};
      const _LEAD_TZ = { 'México': 'America/Mexico_City', 'Argentina': 'America/Argentina/Buenos_Aires' };
      ${block}
      return { _leadTimeAtTz, _leadLocalTimeAt };`
    );
    leadtime = factory();
  });

  it("marcadores presentes exactamente una vez", () => {
    expect(countOccurrences(appJs, "LEADTIME-AT: INICIO")).toBe(1);
    expect(countOccurrences(appJs, "LEADTIME-AT: FIN")).toBe(1);
  });

  it("window._leadLocalTimeAt expuesto", () => {
    expect(appJs).toContain("window._leadLocalTimeAt = _leadLocalTimeAt;");
  });

  it("_leadLocalTime original (con semáforo, usado por el chip del Power Dialer) sigue intacto", () => {
    expect(countOccurrences(appJs, "function _leadLocalTime(")).toBe(1);
  });

  it("el bloque LEADTIME-AT no contiene el flag `ok:` (D-06: sin semáforo)", () => {
    const block = appJs.slice(appJs.indexOf(START), appJs.indexOf(END));
    expect(countOccurrences(block, "ok:")).toBe(0);
  });

  it("_leadTimeAtTz calcula la hora en la zona dada para una fecha UTC arbitraria (CDMX = UTC-6 fijo)", () => {
    const d = new Date(Date.UTC(2026, 7, 18, 15, 0));
    expect(leadtime._leadTimeAtTz("America/Mexico_City", d)).toBe("09:00");
  });

  it("_leadTimeAtTz para Buenos Aires (UTC-3)", () => {
    const d = new Date(Date.UTC(2026, 7, 18, 15, 0));
    expect(leadtime._leadTimeAtTz("America/Argentina/Buenos_Aires", d)).toBe("12:00");
  });

  it("_leadTimeAtTz devuelve null ante zona inválida, en vez de lanzar", () => {
    expect(leadtime._leadTimeAtTz("Zona/Inexistente", new Date())).toBeNull();
  });

  it("_leadTimeAtTz devuelve null ante argumentos faltantes", () => {
    expect(leadtime._leadTimeAtTz("", new Date())).toBeNull();
    expect(leadtime._leadTimeAtTz("America/Mexico_City", null)).toBeNull();
    expect(leadtime._leadTimeAtTz("America/Mexico_City", new Date("no-es-fecha"))).toBeNull();
  });

  it("_leadLocalTimeAt(null, d) devuelve null", () => {
    expect(leadtime._leadLocalTimeAt(null, new Date())).toBeNull();
  });

  it("_leadLocalTimeAt con país no mapeado devuelve null (D-06: sin país no se muestra nada)", () => {
    expect(leadtime._leadLocalTimeAt({ country: "Marte" }, new Date())).toBeNull();
  });

  it("_leadLocalTimeAt con país mapeado devuelve {time, tz} SIN el flag ok", () => {
    const d = new Date(Date.UTC(2026, 7, 18, 15, 0));
    const out = leadtime._leadLocalTimeAt({ country: "México" }, d);
    expect(out).toBeTruthy();
    expect(out.time).toBe("09:00");
    expect(out.tz).toBe("America/Mexico_City");
    expect(Object.prototype.hasOwnProperty.call(out, "ok")).toBe(false);
  });
});

describe("Task 2 — D-07: carga por día del calendario (fetch cacheado + pintado de badges)", () => {
  it("cache de módulo con TTL 120s declarada", () => {
    expect(appJs).toContain("let _dtpCalCache = { at: 0, entries: [] };");
    expect(appJs).toContain("Date.now() - _dtpCalCache.at < 120000");
  });

  it("_dtpFetchCalendar pega a /api/setters/calendar y nunca lanza (degrada a [])", () => {
    expect(appJs).toContain("async function _dtpFetchCalendar()");
    expect(appJs).toContain("fetch(apiUrl('/api/setters/calendar'), { credentials: 'include' })");
    expect(appJs).toMatch(/async function _dtpFetchCalendar\(\)[\s\S]*?catch \(e\) \{[\s\S]*?return \[\];/);
  });

  it("_dtpLocalCallbackLeads lee _callsLeadsById en memoria (sin fetch nuevo)", () => {
    expect(appJs).toContain("function _dtpLocalCallbackLeads()");
    expect(appJs).toContain("Array.from(_callsLeadsById.values())");
  });

  it("_dtpPaintLoad pinta/limpia badges .dtp-load usando textContent (T-28-04: nunca innerHTML con datos del server)", () => {
    expect(appJs).toContain("function _dtpPaintLoad(counts)");
    expect(appJs).toContain("badge.className = 'dtp-load';");
    expect(appJs).toContain("badge.textContent = String(n);");
  });

  it("_dtpRefreshLoad respeta opts.load === false y solo pinta si el mes sigue siendo el mismo al resolver", () => {
    expect(appJs).toContain("async function _dtpRefreshLoad()");
    expect(appJs).toContain("if (!_dtpState || _dtpState.opts.load === false) return;");
    expect(appJs).toContain("if (!_dtpState || _dtpState.view.year !== view.year || _dtpState.view.month !== view.month) return;");
  });

  it("_dtpRefreshLoad se dispara al abrir el popover y al navegar de mes (sin bloquear el render de la grilla)", () => {
    expect(appJs).toContain("_dtpRefreshLoad(); // D-07: sin await — la grilla ya se pintó, esto pinta encima cuando resuelve");
    // .dtp-nav (mes anterior/siguiente) y .dtp-today
    const navHandler = /pop\.querySelectorAll\('\.dtp-nav'\)\.forEach\(\(btn\) => \{[\s\S]*?\n {6}\}\);/.exec(appJs);
    expect(navHandler).toBeTruthy();
    expect(navHandler[0]).toContain("_dtpRefreshLoad();");
    const todayHandler = /pop\.querySelector\('\.dtp-today'\)\.addEventListener\('click', \(\) => \{[\s\S]*?\n {6}\}\);/.exec(appJs);
    expect(todayHandler).toBeTruthy();
    expect(todayHandler[0]).toContain("_dtpRefreshLoad();");
  });
});
