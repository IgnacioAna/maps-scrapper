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

  it("cache-buster de app.js bumpeado a v=20260814b", () => {
    expect(indexHtml).toMatch(/app\.js\?v=20260814b/);
  });
});
