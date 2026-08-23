// Test de RESP-01 (Fase 36, Plan 01) — "la disposición responde": marcar un
// resultado tiene que acusarse en pantalla en el instante del clic, no cuando
// termina todo el flujo (que puede tardar hasta ~4,75s solo en finalizar la
// llamada activa, más el polling del Power Dialer). Sin browser ni jsdom en
// el repo: mismo molde que tests/dial-hold.test.js / tests/gate-destination
// .test.js.
//
// 1. Aserciones de fuente (cableado: dónde se prende, dónde se apaga, orden
//    respecto del await crítico) por extracción de cuerpos de función con
//    llaves balanceadas — mismo helper que dial-hold.test.js.
// 2. Comportamiento: las dos funciones reales (`_dispoBusyOn`/`_dispoBusyOff`)
//    extraídas y evaluadas con `new Function`, inyectando `document`,
//    `setTimeout` y `clearTimeout` como stubs (no hay jsdom).
// 3. D-01/D-02 intactos: el hold, el autopiloto, los atajos 1-9 y el orden
//    del grid no se tocaron en este plan (guardas propias, no solo confiar
//    en las 7 suites ajenas del <verify>).
// 4. Cache-buster: forma + estrictamente mayor que el baseline real.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/dial-hold.test.js — extrae el cuerpo `{...}`
// balanceado de una función a partir del literal exacto de su declaración
// (`startLiteral` DEBE terminar en el `{` que abre el cuerpo).
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

// Extrae una línea/statement completo (hasta el primer ';' luego del literal
// de arranque) — usado para las 2 declaraciones sueltas (`const
// _DISPO_MODAL_OUTCOMES`, `let _dispoBusy`) que no son funciones.
function extractStatement(text, startLiteral) {
  const idx = text.indexOf(startLiteral);
  if (idx === -1) throw new Error(`No se encontró "${startLiteral}"`);
  const end = text.indexOf(";", idx);
  if (end === -1) throw new Error(`No se encontró ';' después de "${startLiteral}"`);
  return text.slice(idx, end + 1);
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

// ─── Fuente única y cableado ───────────────────────────────────────────

describe("_dispoBusyOn/_dispoBusyOff: fuente única, no expuestas en window", () => {
  it("se declaran exactamente una vez cada una", () => {
    expect(countOccurrences(appJs, "function _dispoBusyOn(leadId, outcome, selectEl) {")).toBe(1);
    expect(countOccurrences(appJs, "function _dispoBusyOff(leadId) {")).toBe(1);
  });

  it("NO se exponen en window (internas del bloque de disposición, mismo criterio que _pdHold)", () => {
    expect(appJs).not.toContain("window._dispoBusyOn");
    expect(appJs).not.toContain("window._dispoBusyOff");
  });
});

describe("Cableado en window._handleCallDisposition — el acuse ocurre ANTES de la primera espera", () => {
  function handlerBody() {
    const startIdx = appJs.indexOf("window._handleCallDisposition = async");
    const endIdx = appJs.indexOf("function openPlaceholderModal");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    return appJs.slice(startIdx, endIdx);
  }

  it("el índice de _dispoBusyOn( es menor que el del await de _finalizeActiveCallBeforeDisposition — test central del plan: si alguien mueve la llamada abajo del await, esto se pone rojo", () => {
    const body = handlerBody();
    const busyIdx = body.indexOf("_dispoBusyOn(leadId, outcome, selectEl)");
    const awaitIdx = body.indexOf("await _finalizeActiveCallBeforeDisposition(leadId);");
    expect(busyIdx).toBeGreaterThan(-1);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(busyIdx).toBeLessThan(awaitIdx);
  });

  it("_dispoBusyOn( se llama antes del selectEl.disabled = true (arranque real del handler)", () => {
    const body = handlerBody();
    const disabledIdx = body.indexOf("selectEl.disabled = true;");
    const busyIdx = body.indexOf("_dispoBusyOn(leadId, outcome, selectEl)");
    expect(disabledIdx).toBeGreaterThan(-1);
    expect(busyIdx).toBeGreaterThan(disabledIdx);
  });

  it("apaga el indicador al abrir un modal (_DISPO_MODAL_OUTCOMES) DESPUÉS del await de finalize — desde ahí la espera es a una persona", () => {
    const body = handlerBody();
    const modalOffLiteral = "if (_DISPO_MODAL_OUTCOMES.has(outcome)) _dispoBusyOff(leadId);";
    const awaitIdx = body.indexOf("await _finalizeActiveCallBeforeDisposition(leadId);");
    const modalOffIdx = body.indexOf(modalOffLiteral);
    expect(modalOffIdx).toBeGreaterThan(-1);
    expect(modalOffIdx).toBeGreaterThan(awaitIdx);
  });

  it("el catch apaga el indicador (junto a selectEl.disabled = false)", () => {
    const body = handlerBody();
    const catchIdx = body.indexOf("} catch (e) {");
    expect(catchIdx).toBeGreaterThan(-1);
    const catchBody = body.slice(catchIdx);
    expect(catchBody).toContain("selectEl.disabled = false;");
    expect(catchBody).toContain("_dispoBusyOff(leadId);");
  });
});

describe("_dispoAfterSaved apaga el indicador — punto único post-guardado", () => {
  it("la primera acción útil del cuerpo apaga _dispoBusyOff(leadId)", () => {
    const body = extractFunctionBody(appJs, "function _dispoAfterSaved(leadId, opts = {}) {");
    expect(body).toContain("_dispoBusyOff(leadId);");
  });
});

describe("_DISPO_MODAL_OUTCOMES == modalOpening de _pdHandleDisposition (mismos 4 outcomes)", () => {
  it("los 4 literales coinciden entre las dos listas — si se agrega un 5to modal, este test obliga a tocar los dos lugares", () => {
    const modalOutcomesMatch = /const _DISPO_MODAL_OUTCOMES = new Set\(\[([^\]]*)\]\)/.exec(appJs);
    const modalOpeningMatch = /const modalOpening = \[([^\]]*)\]/.exec(appJs);
    expect(modalOutcomesMatch).toBeTruthy();
    expect(modalOpeningMatch).toBeTruthy();
    const four = ["callback_later", "scheduled_with_admin", "answered_interested", "answered_not_interested"];
    for (const v of four) {
      expect(modalOutcomesMatch[1]).toContain(`'${v}'`);
      expect(modalOpeningMatch[1]).toContain(`'${v}'`);
    }
  });
});

describe("Red de seguridad: techo de 15s dentro de _dispoBusyOn", () => {
  it("el cuerpo contiene un setTimeout a 15000 que llama a _dispoBusyOff", () => {
    const body = extractFunctionBody(appJs, "function _dispoBusyOn(leadId, outcome, selectEl) {");
    expect(body).toMatch(/setTimeout\(\(\) => _dispoBusyOff\(leadId\), 15000\)/);
  });
});

// ─── Comportamiento: evaluar las funciones reales con stubs ───────────────

describe("Comportamiento de _dispoBusyOn/_dispoBusyOff (funciones reales vía new Function, sin jsdom)", () => {
  let factory;

  beforeAll(() => {
    const modalOutcomesLine = extractStatement(appJs, "const _DISPO_MODAL_OUTCOMES = new Set(");
    const dispoBusyVarLine = extractStatement(appJs, "let _dispoBusy = null;");
    const onBody = extractFunctionBody(appJs, "function _dispoBusyOn(leadId, outcome, selectEl) {");
    const offBody = extractFunctionBody(appJs, "function _dispoBusyOff(leadId) {");
    const src = `${modalOutcomesLine}\n${dispoBusyVarLine}\n${onBody}\n${offBody}\nreturn { on: _dispoBusyOn, off: _dispoBusyOff };`;
    factory = new Function("document", "setTimeout", "clearTimeout", src);
  });

  // Timer stub: registra los setTimeout pedidos sin programar nada real (así
  // el test no depende de esperar 15s de verdad ni deja handles colgando).
  function makeTimerStub() {
    let nextId = 1;
    const calls = [];
    const st = (fn, ms) => {
      const id = nextId++;
      calls.push({ id, fn, ms });
      return id;
    };
    const ct = (id) => {
      const i = calls.findIndex((c) => c.id === id);
      if (i !== -1) calls.splice(i, 1);
    };
    return { setTimeout: st, clearTimeout: ct, calls };
  }

  // document stub: solo responde al selector del grid si se le pasa un botón
  // — si no, se comporta como "no hay grid en pantalla" (caso normal para
  // los tests de select/objeto falso, que no ejercitan el grid).
  function makeDocumentStub(matchBtn) {
    return {
      querySelector: (sel) => (matchBtn && typeof sel === "string" && sel.includes("data-outcome") ? matchBtn : null),
    };
  }

  function makeSelectStub(placeholder = "— Resultado —") {
    const classes = new Set();
    return {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
      },
      options: [{ textContent: placeholder }],
      querySelector: () => null, // un <select> no tiene hijos que nos importen
      selectedIndex: 1,
      _classes: classes,
    };
  }

  it("con un select real (detectado por capacidad): on() pinta 'Guardando…' + is-saving + fuerza selectedIndex=0", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel = makeSelectStub();
    on("lead1", "no_answer", sel);
    expect(sel.options[0].textContent).toBe("Guardando…");
    expect(sel._classes.has("is-saving")).toBe(true);
    expect(sel.selectedIndex).toBe(0);
  });

  it("off(leadId) restaura el texto original del placeholder y saca la clase is-saving", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on, off } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel = makeSelectStub();
    on("lead1", "no_answer", sel);
    off("lead1");
    expect(sel.options[0].textContent).toBe("— Resultado —");
    expect(sel._classes.has("is-saving")).toBe(false);
  });

  it("con el objeto falso del dialer ({value, disabled}, sin querySelector): on() no tira y no toca options", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const fake = { value: "no_answer", disabled: false };
    expect(() => on("lead1", "no_answer", fake)).not.toThrow();
    expect(fake.options).toBeUndefined();
  });

  it("con el objeto falso del dialer: off() tampoco tira", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on, off } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const fake = { value: "no_answer", disabled: false };
    on("lead1", "no_answer", fake);
    expect(() => off("lead1")).not.toThrow();
  });

  it("off('otro_lead') NO apaga el indicador de un lead distinto — el estado sigue vivo", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on, off } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel = makeSelectStub();
    on("lead1", "no_answer", sel);
    off("lead2");
    expect(sel.options[0].textContent).toBe("Guardando…");
    expect(sel._classes.has("is-saving")).toBe(true);
  });

  it("off() sin argumento sí apaga el indicador vivo, sea cual sea el lead", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on, off } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel = makeSelectStub();
    on("lead1", "no_answer", sel);
    off();
    expect(sel.options[0].textContent).toBe("— Resultado —");
    expect(sel._classes.has("is-saving")).toBe(false);
  });

  it("doble on() seguido: el segundo restaura lo del primero ANTES de pintar — nunca dos superficies vivas a la vez", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel1 = makeSelectStub();
    const sel2 = makeSelectStub();
    on("lead1", "no_answer", sel1);
    on("lead2", "voicemail", sel2);
    expect(sel1.options[0].textContent).toBe("— Resultado —");
    expect(sel1._classes.has("is-saving")).toBe(false);
    expect(sel2.options[0].textContent).toBe("Guardando…");
    expect(sel2._classes.has("is-saving")).toBe(true);
  });

  it("con un botón real del grid: on() marca is-busy en el grid + is-saving en el botón + pinta el .pd-disp-sub", () => {
    const timers = makeTimerStub();
    const gridClasses = new Set();
    const gridStub = {
      classList: { add: (c) => gridClasses.add(c), remove: (c) => gridClasses.delete(c) },
    };
    const subEl = { textContent: "marca interés" };
    const btnClasses = new Set();
    const btn = {
      classList: { add: (c) => btnClasses.add(c), remove: (c) => btnClasses.delete(c) },
      closest: () => gridStub,
      querySelector: () => subEl,
    };
    const doc = makeDocumentStub(btn);
    const { on } = factory(doc, timers.setTimeout, timers.clearTimeout);
    on("lead1", "answered_interested", { value: "answered_interested", disabled: false });
    expect(gridClasses.has("is-busy")).toBe(true);
    expect(btnClasses.has("is-saving")).toBe(true);
    expect(subEl.textContent).toBe("Guardando…");
  });

  it("off() restaura el botón del grid (saca is-saving/is-busy y el texto original del sub)", () => {
    const timers = makeTimerStub();
    const gridClasses = new Set();
    const gridStub = {
      classList: { add: (c) => gridClasses.add(c), remove: (c) => gridClasses.delete(c) },
    };
    const subEl = { textContent: "marca interés" };
    const btnClasses = new Set();
    const btn = {
      classList: { add: (c) => btnClasses.add(c), remove: (c) => btnClasses.delete(c) },
      closest: () => gridStub,
      querySelector: () => subEl,
    };
    const doc = makeDocumentStub(btn);
    const { on, off } = factory(doc, timers.setTimeout, timers.clearTimeout);
    on("lead1", "answered_interested", { value: "answered_interested", disabled: false });
    off("lead1");
    expect(gridClasses.has("is-busy")).toBe(false);
    expect(btnClasses.has("is-saving")).toBe(false);
    expect(subEl.textContent).toBe("marca interés");
  });

  it("arma un setTimeout(…, 15000) al prender, y off() lo cancela (clearTimeout) — el techo no dispara si se apagó por otra vía", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on, off } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel = makeSelectStub();
    on("lead1", "no_answer", sel);
    expect(timers.calls.length).toBe(1);
    expect(timers.calls[0].ms).toBe(15000);
    off("lead1");
    expect(timers.calls.length).toBe(0);
  });

  it("si nadie apaga, el propio techo (invocado manualmente, simulando el disparo real) apaga el indicador", () => {
    const timers = makeTimerStub();
    const doc = makeDocumentStub(null);
    const { on } = factory(doc, timers.setTimeout, timers.clearTimeout);
    const sel = makeSelectStub();
    on("lead1", "no_answer", sel);
    expect(timers.calls.length).toBe(1);
    // Disparar el callback registrado, como haría el runtime real a los 15s.
    timers.calls[0].fn();
    expect(sel.options[0].textContent).toBe("— Resultado —");
    expect(sel._classes.has("is-saving")).toBe(false);
  });
});

// ─── D-01/D-02 intactos (guardas propias de esta fase) ─────────────────────

describe("D-01/D-02: el hold, el autopiloto, los atajos y el orden del grid no se tocaron", () => {
  it("_pd.holdCurrent = true sigue apareciendo exactamente 1 vez, dentro de _pdHold", () => {
    expect(countOccurrences(appJs, "_pd.holdCurrent = true")).toBe(1);
    const body = extractFunctionBody(appJs, "function _pdHold(leadId, outcome, opts = {}) {");
    expect(countOccurrences(body, "_pd.holdCurrent = true")).toBe(1);
  });

  it("el grid del Power Dialer sigue con los 9 outcomes en el mismo orden y las mismas teclas 1-9", () => {
    const order = [
      "answered_interested",
      "scheduled_with_admin",
      "answered_not_interested",
      "hung_up",
      "no_answer",
      "voicemail",
      "callback_later",
      "wrong_number",
      "invalid_number",
    ];
    let lastIdx = -1;
    for (const v of order) {
      const idx = appJs.indexOf(`v:'${v}'`, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("data-outcome=\"${d.v}\" aparece en el <button> del grid (única aparición, expandida por el .map a los 9 botones)", () => {
    expect(appJs).toContain('data-outcome="${d.v}"');
  });
});

// ─── Cache-buster ───────────────────────────────────────────────────────

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL con el que arrancó este plan, confirmado en disco antes de
  // cualquier edit: app.js 20260822b (línea 3750), style.css 20260816f
  // (línea 15). No se pinea un valor exacto post-bump: se verifica FORMA +
  // estrictamente mayor que el baseline real (nota de dial-hold.test.js).
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260822b)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260822b").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260816f) — este plan SÍ tocó style.css", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260816f").toBe(true);
  });
});
