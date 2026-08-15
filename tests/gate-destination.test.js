// Test del aviso universal de destino (Fase 30, Plan 03, GATE-04). Cierra el
// reclamo #1 del user ("lo marco y desaparece"): toda disposición debe decir
// a dónde se fue el lead y cuándo vuelve. No hay browser ni jsdom en el repo,
// así que se verifica en los dos modos ya usados por el proyecto:
//
// 1. Bloque puro extraído por marcadores (patrón tests/dtpicker-core.test.js
//    con [28-01] DTPICKER-PURE / tests/gate-next-step-ui.test.js con
//    [30-02] GATE-PURE): se corta el bloque [30-03] DISPO-DEST de
//    public/app.js y se evalúa aislado con `new Function`. `now` SIEMPRE es
//    un reloj FIJO, nunca el reloj real de la corrida — es la causa raíz de
//    los flaky documentada en la nota #163 de CLAUDE.md.
// 2. Aserciones de fuente (patrón tests/dtpicker-wiring.test.js /
//    tests/gate-next-step-ui.test.js): se lee public/app.js e
//    public/index.html como texto y se comprueba el cableado real —
//    universalidad del aviso, D-08 (el hold de calendario no marca el gate)
//    y el escapado del destino en el banner del Power Dialer.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [30-03] DISPO-DEST: INICIO ───";
const END_MARKER = "// ─── [30-03] DISPO-DEST: FIN ───";

let appJs;
let indexHtml;
let dd;

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  const startIdx = appJs.indexOf(START_MARKER);
  const endIdx = appJs.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores DISPO-DEST en public/app.js (start=${startIdx}, end=${endIdx}). ` +
        `Verificar que "${START_MARKER}" y "${END_MARKER}" existen literales en el archivo.`
    );
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return { _dispoDestination, _dispoWhenLabel, _dispoNextAt };
    `
  );
  dd = factory();
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe("DISPO-DEST: _dispoDestination — las 8 ramas de destino (now fijo)", () => {
  const now = new Date(2026, 7, 14, 15, 0); // viernes 14/08/2026 15:00 local, fijo

  it("descartado normal → vista 'en Descartados', sin fecha, dice cómo re-encontrarlo", () => {
    const lead = { name: "Clinica Descartada", estado: "descartado", callLog: [] };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Descartados");
    expect(dest.cuando).toBe("");
    expect(dest.texto).toContain("Clinica Descartada");
    expect(dest.texto.toLowerCase()).toContain("buscalo por nombre en llamadas");
  });

  it("descartado con autoDiscarded + autoDiscardReason:'sin_contacto_2x' → texto dice que fue automático (2 intentos sin contacto)", () => {
    const lead = {
      name: "Clinica Auto",
      estado: "descartado",
      autoDiscarded: true,
      autoDiscardReason: "sin_contacto_2x",
      callLog: [],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Descartados");
    expect(dest.tono).toBe("warn");
    expect(dest.texto).toContain("Clinica Auto");
    expect(dest.texto.toLowerCase()).toContain("2 intentos sin contacto");
  });

  it("descartado con autoDiscarded + autoDiscardReason:'cortes_2x' → texto dice que fue automático (2 cortes)", () => {
    const lead = {
      name: "Clinica Cortada",
      estado: "descartado",
      autoDiscarded: true,
      autoDiscardReason: "cortes_2x",
      callLog: [],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Descartados");
    expect(dest.tono).toBe("warn");
    expect(dest.texto.toLowerCase()).toContain("2 cortes");
  });

  it("DNC gana sobre descartado: doNotCall:true → vista de No-llamar aunque estado sea descartado", () => {
    const lead = { name: "Clinica DNC", estado: "descartado", doNotCall: true, callLog: [] };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en la vista No-llamar");
    expect(dest.texto).toContain("Clinica DNC");
  });

  it("agendado → vista 'en Reuniones agendadas', tono success", () => {
    const lead = { name: "Clinica Agendada", estado: "agendado", callLog: [] };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Reuniones agendadas");
    expect(dest.tono).toBe("success");
    expect(dest.texto).toContain("Clinica Agendada");
  });

  it("interesado con nextAction.dueAt a +3 días → vista 'en Hoy → Interesados' + cuando", () => {
    const dueAt = new Date(now.getTime() + 3 * DAY_MS).toISOString();
    const lead = {
      name: "Clinica Interesada",
      estado: "interesado",
      nextAction: { tipo: "callback", dueAt, canal: "llamada", origen: "manual" },
      callLog: [],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Hoy → Interesados");
    expect(dest.cuando).not.toBe("");
    expect(dest.texto).toContain("Clinica Interesada");
    expect(dest.texto).toContain(dest.cuando);
  });

  it("último callLog outcome 'callback_later' con callbackAt futuro → vista 'en Hoy → Callbacks' + cuando", () => {
    const dueAt = new Date(now.getTime() + 2 * DAY_MS).toISOString();
    const lead = {
      name: "Clinica Callback",
      estado: "sin_contactar",
      callbackAt: dueAt,
      callLog: [{ ts: now.toISOString(), outcome: "callback_later" }],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("en Hoy → Callbacks");
    expect(dest.cuando).not.toBe("");
    expect(dest.texto).toContain("Clinica Callback");
  });

  it("nextAction.origen:'cadencia' a +24h (no-contacto) → vista 'a la cola de Llamadas' + cuando", () => {
    const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const lead = {
      name: "Clinica Cadencia",
      estado: "sin_contactar",
      nextAction: { tipo: "cadencia", dueAt, canal: "llamada", origen: "cadencia" },
      callLog: [{ ts: now.toISOString(), outcome: "no_answer" }],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("a la cola de Llamadas");
    expect(dest.cuando).not.toBe("");
    expect(dest.texto).toContain("Clinica Cadencia");
  });

  it("hold de calendario (nextAction.tipo:'esperar_respuesta') → mismo vista genérico, texto dice 'esperando respuesta'", () => {
    const dueAt = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const lead = {
      name: "Clinica Hold",
      estado: "sin_contactar",
      nextAction: { tipo: "esperar_respuesta", dueAt, canal: "email", origen: "manual" },
      callLog: [{ ts: now.toISOString(), outcome: "placeholder_sent" }],
    };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("a la cola de Llamadas");
    expect(dest.texto.toLowerCase()).toContain("esperando respuesta");
  });

  it("sin nextAction ni callbackAt, no terminal → vista 'a la cola de Llamadas' y cuando vacío", () => {
    const lead = { name: "Clinica Virgen", estado: "sin_contactar", callLog: [] };
    const dest = dd._dispoDestination(lead, now);
    expect(dest.vista).toBe("a la cola de Llamadas");
    expect(dest.cuando).toBe("");
    expect(dest.texto).toContain("Clinica Virgen");
  });

  it("determinismo: mismo lead + mismo now → mismo texto en llamadas sucesivas", () => {
    const dueAt = new Date(now.getTime() + 3 * DAY_MS).toISOString();
    const lead = {
      name: "Clinica Determinista",
      estado: "interesado",
      nextAction: { tipo: "callback", dueAt, canal: "llamada", origen: "manual" },
      callLog: [],
    };
    const d1 = dd._dispoDestination(lead, now);
    const d2 = dd._dispoDestination(lead, now);
    expect(d1.texto).toBe(d2.texto);
    expect(d1.vista).toBe(d2.vista);
    expect(d1.cuando).toBe(d2.cuando);
  });
});

describe("DISPO-DEST: _dispoNextAt — lector defensivo del reloj único", () => {
  const now = new Date(2026, 7, 14, 15, 0);

  it("con nextAction.dueAt presente, devuelve ese timestamp", () => {
    const dueAt = new Date(now.getTime() + DAY_MS).toISOString();
    const lead = { nextAction: { dueAt }, callbackAt: "" };
    expect(dd._dispoNextAt(lead)).toBe(new Date(dueAt).getTime());
  });

  it("lead legacy sin migrar (nextAction:null) cae a lead.callbackAt", () => {
    const callbackAt = new Date(now.getTime() + DAY_MS).toISOString();
    const lead = { nextAction: null, callbackAt };
    expect(dd._dispoNextAt(lead)).toBe(new Date(callbackAt).getTime());
  });

  it("sin nextAction ni callbackAt → 0", () => {
    expect(dd._dispoNextAt({ nextAction: null, callbackAt: "" })).toBe(0);
    expect(dd._dispoNextAt({})).toBe(0);
  });
});

// El formato exacto de hora/fecha lo decide el motor Intl del runtime (12h
// con a.m./p.m. en Node small-icu vs 24h en un browser real, separador '-'
// vs '/' según la build de ICU) — _dispoWhenLabel reusa el mismo cálculo
// que ya hacía el toast viejo (movido sin cambiarlo, ver comentario del
// bloque). Reproducir el MISMO llamado a Intl acá hace las aserciones
// deterministas sin importar qué ICU tenga el entorno que corre la suite.
function _horaFmt(d) {
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
function _diaAbrevFmt(d) {
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

describe("DISPO-DEST: _dispoWhenLabel — formato relativo", () => {
  it("mismo día → 'hoy <hora>'", () => {
    const now = new Date(2026, 7, 14, 15, 0);
    const d = new Date(2026, 7, 14, 18, 30);
    expect(dd._dispoWhenLabel(d.getTime(), now)).toBe(`hoy ${_horaFmt(d)}`);
  });

  it("día siguiente → 'mañana <hora>'", () => {
    const now = new Date(2026, 7, 14, 15, 0);
    const d = new Date(2026, 7, 15, 9, 5);
    expect(dd._dispoWhenLabel(d.getTime(), now)).toBe(`mañana ${_horaFmt(d)}`);
  });

  it("día lejano → '<día abrev DD/MM> <hora>', ni 'hoy' ni 'mañana'", () => {
    const now = new Date(2026, 7, 14, 15, 0);
    const d = new Date(2026, 7, 20, 9, 0);
    const label = dd._dispoWhenLabel(d.getTime(), now);
    expect(label).not.toContain("hoy");
    expect(label).not.toContain("mañana");
    expect(label).toBe(`${_diaAbrevFmt(d)} ${_horaFmt(d)}`);
  });

  it("borde de día: now a las 23:30 — un evento a las 00:10 del día siguiente sigue siendo 'mañana'", () => {
    const now = new Date(2026, 7, 14, 23, 30);
    const d = new Date(2026, 7, 15, 0, 10);
    expect(dd._dispoWhenLabel(d.getTime(), now)).toBe(`mañana ${_horaFmt(d)}`);
  });
});

describe("Aserciones de fuente: universalidad del aviso (D-05)", () => {
  it("_dispoWhereToast ya no existe en public/app.js", () => {
    expect(countOccurrences(appJs, "_dispoWhereToast")).toBe(0);
  });

  it("_dispoAnnounce se llama desde el cuerpo de _dispoAfterSaved", () => {
    const startIdx = appJs.indexOf("function _dispoAfterSaved(leadId, opts = {}) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(nextFnIdx).toBeGreaterThan(startIdx);
    const body = appJs.slice(startIdx, nextFnIdx);
    expect(body).toContain("_dispoAnnounce(leadId, opts);");
  });

  it("ningún call site llama _dispoAfterSaved sin opts (grep literal 'leadId);')", () => {
    expect(appJs).not.toContain("_dispoAfterSaved(leadId);");
  });

  it("_dispoAfterSaved se llama con { lead, outcome } desde los 6 caminos de disposición", () => {
    expect(appJs).toContain("_dispoAfterSaved(leadId, { lead: data.lead, outcome });");
    expect(appJs).toContain(
      "_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'callback_later', manual: true });"
    );
    expect(appJs).toContain(
      "_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'answered_not_interested' });"
    );
    expect(appJs).toContain(
      "_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'scheduled_with_admin' });"
    );
    expect(appJs).toContain(
      "_dispoAfterSaved(leadId, { lead: fbData.lead, outcome: fallbackOnCancel });"
    );
    expect(appJs).toContain("_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'no_answer' });");
    expect(appJs).toContain(
      "_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'answered_interested' });"
    );
  });

  it("openPlaceholderModal (hold de calendario) llama _dispoAnnounce y NUNCA _dispoAfterSaved (D-08)", () => {
    const startIdx = appJs.indexOf("function openPlaceholderModal(leadId) {");
    const endIdx = appJs.indexOf("window.openPlaceholderModal = openPlaceholderModal;");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const body = appJs.slice(startIdx, endIdx);
    expect(body).toContain("_dispoAnnounce(leadId, { lead: j.lead });");
    expect(body).not.toContain("_dispoAfterSaved(");
  });
});

describe("Aserciones de fuente: destino en el banner del Power Dialer (D-07)", () => {
  it("_pd.holdMeta se resetea en los mismos 3 lugares donde se resetea _pd.holdOutcome", () => {
    const re = /_pd\.holdOutcome = null;\r?\n\s*_pd\.holdMeta = null;/g;
    const matches = appJs.match(re) || [];
    expect(matches.length).toBe(3);
  });

  it("_dispoAnnounce, con _pd.active, guarda el destino en _pd.holdMeta en vez de tirar un toast", () => {
    const startIdx = appJs.indexOf("function _dispoAnnounce(leadId, opts = {}) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(nextFnIdx).toBeGreaterThan(startIdx);
    const body = appJs.slice(startIdx, nextFnIdx);
    expect(body).toContain("if (_pd.active) {");
    expect(body).toContain(
      "_pd.holdMeta = { texto: dest.texto, vista: dest.vista, cuando: dest.cuando, tono: dest.tono };"
    );
  });

  it("el destino del banner pasa por escHtml al interpolar vista/cuando", () => {
    const idx = appJs.indexOf("const _holdDestLine = hm ?");
    expect(idx).toBeGreaterThan(-1);
    const line = appJs.slice(idx, appJs.indexOf("\n", idx + 400));
    expect(line).toContain("escHtml(hm.cuando)");
    expect(line).toContain("escHtml(hm.vista)");
  });
});

describe("Aserciones de fuente: cache-buster bumpeado (public/index.html)", () => {
  it("app.js?v= tiene un valor distinto (mayor) del que dejó el plan 30-02 (20260815a)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260815a").toBe(true);
  });
});
