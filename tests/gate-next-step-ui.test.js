// Test del paso "Próximo paso" que se abre al marcar "Interesado" (Fase 30,
// Plan 02, GATE-01/GATE-02). No hay browser ni jsdom en el repo, así que se
// verifica en los dos modos ya usados por el proyecto:
//
// 1. Bloque puro extraído por marcadores (patrón tests/dtpicker-core.test.js
//    con [28-01] DTPICKER-PURE): se corta el bloque [30-02] GATE-PURE de
//    public/app.js y se evalúa aislado con `new Function`.
// 2. Aserciones de fuente (patrón tests/dtpicker-wiring.test.js /
//    tests/app-version.test.js): se lee public/app.js e public/index.html
//    como texto y se comprueba el cableado real.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [30-02] GATE-PURE: INICIO ───";
const END_MARKER = "// ─── [30-02] GATE-PURE: FIN ───";

let appJs;
let indexHtml;
let styleCss;
let gate;

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  styleCss = fs.readFileSync(path.join(process.cwd(), "public", "style.css"), "utf8");

  const startIdx = appJs.indexOf(START_MARKER);
  const endIdx = appJs.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores GATE-PURE en public/app.js (start=${startIdx}, end=${endIdx}). ` +
        `Verificar que "${START_MARKER}" y "${END_MARKER}" existen literales en el archivo.`
    );
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return { _gateInteresadoDefaultDate, _gateInteresadoPicks, GATE_INTERESADO_DELTA_MS };
    `
  );
  gate = factory();
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

describe("GATE-PURE: helpers puros del paso Próximo paso (D-02/D-03)", () => {
  it("GATE_INTERESADO_DELTA_MS son exactamente 3 días", () => {
    expect(gate.GATE_INTERESADO_DELTA_MS).toBe(259200000);
  });

  it("_gateInteresadoDefaultDate conserva la hora del día, +3 días exactos (fecha local, nunca toISOString)", () => {
    const now = new Date(2026, 7, 14, 15, 30); // 14/08/2026 15:30 local
    const d = gate._gateInteresadoDefaultDate(now);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // agosto, 0-based
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(15);
    expect(d.getMinutes()).toBe(30);
  });

  it("_gateInteresadoPicks devuelve 4 picks con label/subtitle/date", () => {
    const now = new Date(2026, 7, 14, 10, 0);
    const picks = gate._gateInteresadoPicks(now);
    expect(picks.length).toBe(4);
    for (const p of picks) {
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.subtitle).toBe("string");
      expect(p.subtitle.length).toBeGreaterThan(0);
      expect(p.date instanceof Date).toBe(true);
    }
  });

  it("los 4 picks quedan en orden ascendente y todos son futuros respecto de now", () => {
    const now = new Date(2026, 7, 14, 10, 0);
    const picks = gate._gateInteresadoPicks(now);
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].date.getTime()).toBeGreaterThan(picks[i - 1].date.getTime());
    }
    for (const p of picks) {
      expect(p.date.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("exactamente un pick tiene isDefault === true, y su fecha coincide al milisegundo con _gateInteresadoDefaultDate(now)", () => {
    const now = new Date(2026, 7, 14, 10, 0);
    const picks = gate._gateInteresadoPicks(now);
    const defaults = picks.filter((p) => p.isDefault === true);
    expect(defaults.length).toBe(1);
    expect(defaults[0].date.getTime()).toBe(gate._gateInteresadoDefaultDate(now).getTime());
  });

  it("los picks cubren los 4 saltos de D-03: 1, 3, 7 y 15 días", () => {
    const now = new Date(2026, 7, 14, 10, 0);
    const picks = gate._gateInteresadoPicks(now);
    const deltasDays = picks
      .map((p) => Math.round((p.date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      .sort((a, b) => a - b);
    expect(deltasDays).toEqual([1, 3, 7, 15]);
  });
});

describe("Aserciones de fuente: markup del modal (public/index.html)", () => {
  it("el modal #call-next-modal y sus 4 ids existen", () => {
    expect(indexHtml).toContain('id="call-next-modal"');
    expect(indexHtml).toContain('id="call-next-quickpicks"');
    expect(indexHtml).toContain('id="call-next-fecha"');
    expect(indexHtml).toContain('id="call-next-motivo"');
    expect(indexHtml).toContain('id="call-next-confirm"');
  });

  it("el input de fecha sigue siendo type=\"datetime-local\" (mismo molde que #call-cb-fecha)", () => {
    const m = /<input type="datetime-local" id="call-next-fecha"/.exec(indexHtml);
    expect(m).toBeTruthy();
  });

  it("style.css NO se tocó en esta fase: sin ninguna clase con prefijo call-next-", () => {
    expect(countOccurrences(styleCss, "call-next-")).toBe(0);
  });
});

describe("Aserciones de fuente: cableado en public/app.js", () => {
  it("window.openNextStepModal está expuesto", () => {
    expect(appJs).toContain("window.openNextStepModal = openNextStepModal;");
  });

  it("_handleCallDisposition rutea answered_interested a openNextStepModal(leadId)", () => {
    const startIdx = appJs.indexOf("window._handleCallDisposition = async");
    const endIdx = appJs.indexOf("function openPlaceholderModal");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const body = appJs.slice(startIdx, endIdx);
    expect(body).toContain("openNextStepModal(leadId);");
  });

  it("_pdHandleDisposition suma answered_interested a modalOpening y call-next-modal a modalIds", () => {
    const modalOpeningMatch = /const modalOpening = \[([^\]]*)\]/.exec(appJs);
    expect(modalOpeningMatch).toBeTruthy();
    expect(modalOpeningMatch[1]).toContain("'answered_interested'");
    const modalIdsMatch = /const modalIds = \[([^\]]*)\]/.exec(appJs);
    expect(modalIdsMatch).toBeTruthy();
    expect(modalIdsMatch[1]).toContain("'call-next-modal'");
  });

  it("Power Dialer: la expulsión por callback futuro excluye a los interesados (D-04)", () => {
    expect(appJs).toContain(
      "if (lead.estado !== 'interesado' && lead.callbackAt && new Date(lead.callbackAt).getTime() > Date.now()) { _pdAdvance(); return; }"
    );
  });

  it("openNextStepModal envía outcome:'answered_interested' + nextAction {dueAt,tipo,canal,motivo}", () => {
    const startIdx = appJs.indexOf("function openNextStepModal(leadId) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(nextFnIdx).toBeGreaterThan(startIdx);
    const body = appJs.slice(startIdx, nextFnIdx);
    expect(body).toContain("outcome: 'answered_interested'");
    expect(body).toContain("nextAction: { dueAt: dueAtIso, tipo: 'callback', canal: 'llamada', motivo }");
  });
});

describe("Anti-regresión #181b: el botón nunca queda muerto en 'Guardando…' entre aperturas", () => {
  it("dentro de openNextStepModal, textContent='Guardar' aparece 2+ veces (cinturón + tiradores) y hay un finally", () => {
    const startIdx = appJs.indexOf("function openNextStepModal(leadId) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(nextFnIdx).toBeGreaterThan(startIdx);
    const body = appJs.slice(startIdx, nextFnIdx);
    const guardarCount = (body.match(/textContent = 'Guardar'/g) || []).length;
    expect(guardarCount).toBeGreaterThanOrEqual(2);
    expect(body).toContain("finally");
  });

  it("el reset del botón (cinturón) ocurre ANTES de mostrar el modal", () => {
    const startIdx = appJs.indexOf("function openNextStepModal(leadId) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    const body = appJs.slice(startIdx, nextFnIdx);
    const beltIdx = body.indexOf("confirmBtn.textContent = 'Guardar';");
    const showIdx = body.indexOf("modal.classList.remove('hidden');");
    expect(beltIdx).toBeGreaterThan(-1);
    expect(showIdx).toBeGreaterThan(beltIdx);
  });
});

describe("GATE-01: no deja confirmar sin fecha", () => {
  it("openNextStepModal avisa con showToast y no confirma si #call-next-fecha está vacío", () => {
    const startIdx = appJs.indexOf("function openNextStepModal(leadId) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    const body = appJs.slice(startIdx, nextFnIdx);
    expect(body).toContain("if (!fecha) {");
    expect(body).toContain("un interesado no puede quedar sin fecha");
  });
});
