// Test del selector de compromiso dentro del modal "Próximo paso" (D-08) y
// del bloque "Compromiso" de la ficha del lead (D-09) — Fase 31, Plan 03. No
// hay browser ni jsdom en el repo, así que se verifica en los modos ya usados
// por el proyecto:
//
// 1. Bloque puro extraído por marcadores (patrón tests/gate-next-step-ui.test.js
//    con [30-02] GATE-PURE / tests/gate-destination.test.js con [30-03]
//    DISPO-DEST): se corta el bloque [31-03] COMMITMENT-PURE de
//    public/app.js y se evalúa aislado con `new Function`. `now` SIEMPRE es
//    un reloj FIJO, nunca el reloj de la corrida (nota #163 de CLAUDE.md).
// 2. Paridad frontend/backend: se leen public/app.js e index.js como texto y
//    se comparan los valores del mapa D-06 y los defaults de parte.
// 3. Aserciones de fuente (patrón tests/dtpicker-wiring.test.js /
//    tests/gate-destination.test.js): markup real de public/index.html y
//    cableado real de public/app.js.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [31-03] COMMITMENT-PURE: INICIO ───";
const END_MARKER = "// ─── [31-03] COMMITMENT-PURE: FIN ───";

let appJs;
let indexHtml;
let indexJs;
let cu;

function countOccurrences(str, sub) {
  let count = 0;
  let idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) {
    count++;
    idx += sub.length;
  }
  return count;
}

// Extrae un object literal `const NOMBRE = { ... };` de un texto fuente y lo
// evalúa — usado para la paridad frontend/backend (D-06, COMMITMENT_DEFAULT_PARTE).
function extractObjectLiteral(text, varName) {
  const re = new RegExp("const " + varName + " = \\{([\\s\\S]*?)\\r?\\n\\};");
  const m = re.exec(text);
  if (!m) throw new Error(`No se encontró "const ${varName} = {...};" en el texto`);
  return new Function(`return {${m[1]}};`)();
}

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  indexJs = fs.readFileSync(path.join(process.cwd(), "index.js"), "utf8");

  const startIdx = appJs.indexOf(START_MARKER);
  const endIdx = appJs.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores COMMITMENT-PURE en public/app.js (start=${startIdx}, end=${endIdx}). ` +
        `Verificar que "${START_MARKER}" y "${END_MARKER}" existen literales en el archivo.`
    );
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return {
      COMMITMENT_UI_TIPOS, COMMITMENT_DELTAS_MS,
      _commitmentLabel, _commitmentDefaultParte, _commitmentDefaultCanal,
      _commitmentDefaultDate, _commitmentEffectiveEstado,
    };
    `
  );
  cu = factory();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("COMMITMENT-PURE: bloque autocontenido (sin DOM/red/localStorage)", () => {
  it("el bloque no referencia document/localStorage/fetch(", () => {
    const startIdx = appJs.indexOf(START_MARKER);
    const endIdx = appJs.indexOf(END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toMatch(/document\.|localStorage|fetch\(/);
  });
});

describe("COMMITMENT-PURE: COMMITMENT_UI_TIPOS — orden y forma", () => {
  it("tiene exactamente 6 entradas, en el orden documentado", () => {
    expect(cu.COMMITMENT_UI_TIPOS.length).toBe(6);
    expect(cu.COMMITMENT_UI_TIPOS.map((t) => t.key)).toEqual([
      "enviar_info",
      "pedir_presupuesto",
      "llamar_despues",
      "hablar_con_socio",
      "pensarlo",
      "otro",
    ]);
  });

  it("cada entrada tiene label no vacío, parte en {yo,prospecto} y canal en {whatsapp,llamada}", () => {
    for (const t of cu.COMMITMENT_UI_TIPOS) {
      expect(typeof t.label).toBe("string");
      expect(t.label.length).toBeGreaterThan(0);
      expect(["yo", "prospecto"]).toContain(t.parte);
      expect(["whatsapp", "llamada"]).toContain(t.canal);
    }
  });
});

describe("COMMITMENT-PURE: _commitmentDefaultDate — mapa D-06", () => {
  const now = new Date(2026, 7, 14, 12, 0); // viernes 14/08/2026 12:00 local, fijo

  it("hablar_con_socio → exactamente +5 días", () => {
    const d = cu._commitmentDefaultDate("hablar_con_socio", now);
    expect(d.getTime() - now.getTime()).toBe(5 * DAY_MS);
  });

  it("pensarlo → exactamente +3 días", () => {
    const d = cu._commitmentDefaultDate("pensarlo", now);
    expect(d.getTime() - now.getTime()).toBe(3 * DAY_MS);
  });

  it("pedir_presupuesto → exactamente +3 días", () => {
    const d = cu._commitmentDefaultDate("pedir_presupuesto", now);
    expect(d.getTime() - now.getTime()).toBe(3 * DAY_MS);
  });

  it("llamar_despues → exactamente +24h", () => {
    const d = cu._commitmentDefaultDate("llamar_despues", now);
    expect(d.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("otro → exactamente +3 días (mismo default que pensarlo/pedir_presupuesto)", () => {
    const d = cu._commitmentDefaultDate("otro", now);
    expect(d.getTime() - now.getTime()).toBe(3 * DAY_MS);
  });

  it("enviar_info con reloj de mediodía → cae el MISMO día local, después del reloj", () => {
    const d = cu._commitmentDefaultDate("enviar_info", now);
    expect(d.getFullYear()).toBe(now.getFullYear());
    expect(d.getMonth()).toBe(now.getMonth());
    expect(d.getDate()).toBe(now.getDate());
    expect(d.getTime()).toBeGreaterThan(now.getTime());
  });

  it("enviar_info con reloj de 23:59:30 → devuelve una fecha al menos 1 hora en el futuro", () => {
    const lateNow = new Date(2026, 7, 14, 23, 59, 30);
    const d = cu._commitmentDefaultDate("enviar_info", lateNow);
    expect(d.getTime() - lateNow.getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it("tipo desconocido cae al fallback de 3 días (mismo criterio que el backend)", () => {
    const d = cu._commitmentDefaultDate("no_existe", now);
    expect(d.getTime() - now.getTime()).toBe(3 * DAY_MS);
  });
});

describe("COMMITMENT-PURE: _commitmentDefaultParte / _commitmentDefaultCanal", () => {
  it("devuelven el default del tipo para los 6 tipos", () => {
    for (const t of cu.COMMITMENT_UI_TIPOS) {
      expect(cu._commitmentDefaultParte(t.key)).toBe(t.parte);
      expect(cu._commitmentDefaultCanal(t.key)).toBe(t.canal);
    }
  });

  it("fallback 'yo' / 'llamada' para un tipo desconocido", () => {
    expect(cu._commitmentDefaultParte("no_existe")).toBe("yo");
    expect(cu._commitmentDefaultCanal("no_existe")).toBe("llamada");
  });
});

describe("COMMITMENT-PURE: _commitmentLabel", () => {
  it("devuelve una etiqueta corta en minúscula para cada tipo conocido", () => {
    expect(cu._commitmentLabel("enviar_info")).toBe("mandar info");
    expect(cu._commitmentLabel("hablar_con_socio")).toBe("hablar con su socio");
    expect(cu._commitmentLabel("pensarlo")).toBe("lo iba a pensar");
    expect(cu._commitmentLabel("pedir_presupuesto")).toBe("mandar presupuesto");
    expect(cu._commitmentLabel("llamar_despues")).toBe("volver a llamar");
    expect(cu._commitmentLabel("otro")).toBe("compromiso");
  });

  it("tipo desconocido devuelve el tipo tal cual (fallback)", () => {
    expect(cu._commitmentLabel("cosa_rara")).toBe("cosa_rara");
  });
});

describe("COMMITMENT-PURE: _commitmentEffectiveEstado — misma regla que el backend, sin mutar", () => {
  const nowMs = new Date(2026, 7, 14, 12, 0).getTime();

  it("pendiente con dueAt futuro → 'pendiente'", () => {
    const c = { estado: "pendiente", dueAt: new Date(nowMs + DAY_MS).toISOString() };
    expect(cu._commitmentEffectiveEstado(c, nowMs)).toBe("pendiente");
  });

  it("pendiente con dueAt pasado → 'vencido', SIN mutar el objeto (c.estado sigue 'pendiente')", () => {
    const c = { estado: "pendiente", dueAt: new Date(nowMs - DAY_MS).toISOString() };
    const r = cu._commitmentEffectiveEstado(c, nowMs);
    expect(r).toBe("vencido");
    expect(c.estado).toBe("pendiente");
  });

  it("cumplido con dueAt pasado → 'cumplido' (el estado almacenado gana, no se deriva)", () => {
    const c = { estado: "cumplido", dueAt: new Date(nowMs - DAY_MS).toISOString() };
    expect(cu._commitmentEffectiveEstado(c, nowMs)).toBe("cumplido");
  });

  it("null → ''", () => {
    expect(cu._commitmentEffectiveEstado(null, nowMs)).toBe("");
    expect(cu._commitmentEffectiveEstado(undefined, nowMs)).toBe("");
  });
});

describe("Paridad frontend ↔ backend (index.js)", () => {
  it("los 6 key de COMMITMENT_UI_TIPOS aparecen literales dentro del bloque COMPROMISOS de index.js", () => {
    const startIdx = indexJs.indexOf("── COMPROMISOS: el compromiso hablado como objeto (Phase 31) ──");
    const endIdx = indexJs.indexOf("D-24-02: la cascada de dispositions extraída a helper puro reusable");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = indexJs.slice(startIdx, endIdx);
    for (const t of cu.COMMITMENT_UI_TIPOS) {
      expect(block).toContain(`'${t.key}'`);
    }
  });

  it("el valor de 5 días del frontend y COMMITMENT_SOCIO_DELTA_MS del backend son la misma expresión", () => {
    expect(appJs).toContain("hablar_con_socio: 5 * 24 * 60 * 60 * 1000,");
    expect(indexJs).toContain("const COMMITMENT_SOCIO_DELTA_MS = 5 * 24 * 60 * 60 * 1000;");
  });

  it("los defaults de parte del frontend (COMMITMENT_UI_TIPOS) coinciden con COMMITMENT_DEFAULT_PARTE del backend para los 6 tipos", () => {
    const backendParte = extractObjectLiteral(indexJs, "COMMITMENT_DEFAULT_PARTE");
    for (const t of cu.COMMITMENT_UI_TIPOS) {
      expect(backendParte[t.key]).toBe(t.parte);
    }
  });

  it("los defaults de canal del frontend (COMMITMENT_UI_TIPOS) coinciden con COMMITMENT_DEFAULT_CANAL del backend para los 6 tipos", () => {
    const backendCanal = extractObjectLiteral(indexJs, "COMMITMENT_DEFAULT_CANAL");
    for (const t of cu.COMMITMENT_UI_TIPOS) {
      expect(backendCanal[t.key]).toBe(t.canal);
    }
  });
});

describe("Aserciones de fuente: markup del selector de compromiso (public/index.html)", () => {
  it("#call-next-commitment-tipo y #call-next-commitment-parte existen, uno cada uno", () => {
    expect(countOccurrences(indexHtml, "call-next-commitment-tipo")).toBe(1);
    expect(countOccurrences(indexHtml, "call-next-commitment-parte")).toBe(1);
  });

  it("#call-next-commitment-tipo y #call-next-commitment-parte viven dentro de #call-next-modal", () => {
    const modalStart = indexHtml.indexOf('<div id="call-next-modal"');
    // El próximo modal-overlay tras call-next-modal cierra su rango de búsqueda.
    const nextModalStart = indexHtml.indexOf('<div id="call-objection-modal"', modalStart);
    const modalEnd = nextModalStart > -1 ? nextModalStart : indexHtml.indexOf("</body>");
    expect(modalStart).toBeGreaterThan(-1);
    expect(modalEnd).toBeGreaterThan(modalStart);
    const tipoIdx = indexHtml.indexOf("call-next-commitment-tipo");
    const parteIdx = indexHtml.indexOf("call-next-commitment-parte");
    expect(tipoIdx).toBeGreaterThan(modalStart);
    expect(tipoIdx).toBeLessThan(modalEnd);
    expect(parteIdx).toBeGreaterThan(modalStart);
    expect(parteIdx).toBeLessThan(modalEnd);
  });

  it("el <select> tiene 7 <option> (la vacía + las 6) con los value exactos", () => {
    const selStart = indexHtml.indexOf('<select id="call-next-commitment-tipo"');
    const selEnd = indexHtml.indexOf("</select>", selStart);
    expect(selStart).toBeGreaterThan(-1);
    expect(selEnd).toBeGreaterThan(selStart);
    const block = indexHtml.slice(selStart, selEnd);
    const options = block.match(/<option/g) || [];
    expect(options.length).toBe(7);
    expect(block).toContain('value=""');
    for (const t of cu.COMMITMENT_UI_TIPOS) {
      expect(block).toContain(`value="${t.key}"`);
    }
  });

  it("#call-next-commitment-parte contiene los dos data-parte", () => {
    const wrapStart = indexHtml.indexOf('<div id="call-next-commitment-parte"');
    const wrapEnd = indexHtml.indexOf("</div>", indexHtml.indexOf("</div>", wrapStart) + 1);
    expect(wrapStart).toBeGreaterThan(-1);
    const block = indexHtml.slice(wrapStart, wrapEnd + 6);
    expect(block).toContain('data-parte="yo"');
    expect(block).toContain('data-parte="prospecto"');
  });

  it("style.css NO se tocó en esta fase: sin ninguna clase con prefijo call-commit- ni call-next-commitment-", () => {
    const styleCss = fs.readFileSync(path.join(process.cwd(), "public", "style.css"), "utf8");
    expect(countOccurrences(styleCss, "call-commit-")).toBe(0);
    expect(countOccurrences(styleCss, "call-next-commitment-")).toBe(0);
  });
});

describe("Aserciones de fuente: cache-buster bumpeado (public/index.html)", () => {
  // El plan asumía un baseline app.js?v=20260815d, pero al arrancar la
  // ejecución el baseline REAL ya era 20260815e (una sesión paralela de
  // branding bumpeó ambos cache-busters antes de que este plan empezara —
  // ver 31-03-SUMMARY.md, sección Deviations). style.css NO lo tocó este
  // plan, así que se queda en el valor que dejó esa sesión.
  it("app.js?v= es estrictamente mayor que el baseline real con el que arrancó este plan (20260815e)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260815e").toBe(true);
  });

  it("style.css?v= sigue en 20260815e (sin cambios de este plan)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1]).toBe("20260815e");
  });
});

describe("Aserciones de fuente: cableado en openNextStepModal (public/app.js)", () => {
  function openNextStepModalBody() {
    const startIdx = appJs.indexOf("function openNextStepModal(leadId) {");
    const nextFnIdx = appJs.indexOf("\n    function ", startIdx + 1);
    expect(startIdx).toBeGreaterThan(-1);
    expect(nextFnIdx).toBeGreaterThan(startIdx);
    return appJs.slice(startIdx, nextFnIdx);
  }

  it("referencia call-next-commitment-tipo y _commitmentDefaultDate", () => {
    const body = openNextStepModalBody();
    expect(body).toContain("call-next-commitment-tipo");
    expect(body).toContain("_commitmentDefaultDate");
  });

  it("llama _dtPickerSync al recalcular la fecha del compromiso (dentro del onchange)", () => {
    const body = openNextStepModalBody();
    const onchangeIdx = body.indexOf("commitTipoSelect.onchange = () => {");
    expect(onchangeIdx).toBeGreaterThan(-1);
    const onchangeEndIdx = body.indexOf("};", onchangeIdx);
    const onchangeBody = body.slice(onchangeIdx, onchangeEndIdx);
    expect(onchangeBody).toContain("_dtPickerSync(fechaInput);");
  });

  it("el body del POST incluye una clave commitment (solo si el user eligió un tipo)", () => {
    const body = openNextStepModalBody();
    expect(body).toContain("body.commitment = {");
  });

  it("el reset del <select> de compromiso ocurre ANTES de mostrar el modal (cinturón, patrón #181b)", () => {
    const body = openNextStepModalBody();
    const resetIdx = body.indexOf("commitTipoSelect.value = '';");
    const showIdx = body.indexOf("modal.classList.remove('hidden');");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(showIdx).toBeGreaterThan(resetIdx);
  });

  it("el literal exacto de nextAction no se tocó (paridad con Phase 30)", () => {
    const body = openNextStepModalBody();
    expect(body).toContain("nextAction: { dueAt: dueAtIso, tipo: 'callback', canal: 'llamada', motivo },");
  });
});

describe("Aserciones de fuente: handlers de la ficha del lead (D-09)", () => {
  it("window._callsSetCommitment y window._callsCloseCommitment existen", () => {
    expect(appJs).toContain("window._callsSetCommitment = async function(leadId)");
    expect(appJs).toContain("window._callsCloseCommitment = async function(leadId, estado)");
  });

  function handlerBody(startLiteral) {
    const startIdx = appJs.indexOf(startLiteral);
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = appJs.indexOf("\n    };", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    return appJs.slice(startIdx, endIdx);
  }

  it("_callsSetCommitment: usa apiUrl, _leadStoreApply y _refreshLeadPanels", () => {
    const body = handlerBody("window._callsSetCommitment = async function(leadId)");
    expect(body).toContain("apiUrl('/api/setters/leads/'");
    expect(body).toContain("_leadStoreApply(leadId, d.lead)");
    expect(body).toContain("_refreshLeadPanels(leadId)");
  });

  it("_callsCloseCommitment: usa apiUrl, _leadStoreApply y _refreshLeadPanels", () => {
    const body = handlerBody("window._callsCloseCommitment = async function(leadId, estado)");
    expect(body).toContain("apiUrl('/api/setters/leads/'");
    expect(body).toContain("_leadStoreApply(leadId, d.lead)");
    expect(body).toContain("_refreshLeadPanels(leadId)");
  });

  it("ninguno de los dos handlers llama al aviso de destino de una disposición (no tocan el gate de la Phase 20)", () => {
    const setBody = handlerBody("window._callsSetCommitment = async function(leadId)");
    const closeBody = handlerBody("window._callsCloseCommitment = async function(leadId, estado)");
    expect(setBody).not.toContain("_dispoAfterSaved(");
    expect(setBody).not.toContain("_dispoAnnounce(");
    expect(closeBody).not.toContain("_dispoAfterSaved(");
    expect(closeBody).not.toContain("_dispoAnnounce(");
  });

  it("_refreshLeadPanels se llama SIEMPRE (vía finally) en los dos handlers, incluso en el camino de error", () => {
    const setBody = handlerBody("window._callsSetCommitment = async function(leadId)");
    const closeBody = handlerBody("window._callsCloseCommitment = async function(leadId, estado)");
    // El repo usa CRLF (nota #666 de CLAUDE.md / regla de scripts 24-01) — la
    // regex tolera \r? entre líneas en vez de comparar contra un literal LF.
    const finallyRe = /\}\s*finally\s*\{\s*_refreshLeadPanels\(leadId\);\s*\}/;
    expect(finallyRe.test(setBody)).toBe(true);
    expect(finallyRe.test(closeBody)).toBe(true);
  });

  it("los 2 botones de cierre llaman a _callsCloseCommitment con 'cumplido' y con 'incumplido'/'vencido' según la parte", () => {
    expect(appJs).toContain("window._callsCloseCommitment('${escHtml(l.id)}', 'cumplido')");
    expect(appJs).toContain("window._callsCloseCommitment('${escHtml(l.id)}', 'incumplido')");
    expect(appJs).toContain("window._callsCloseCommitment('${escHtml(l.id)}', 'vencido')");
  });

  it("el botón 'Guardar compromiso' del formulario llama a _callsSetCommitment", () => {
    expect(appJs).toContain("window._callsSetCommitment('${escHtml(l.id)}')");
  });
});

describe("Aserciones de fuente: _dispoDestination gana la rama de compromiso (D-05/D-10)", () => {
  it("'Hoy → Mis compromisos' y 'Hoy → Esperando del prospecto' aparecen dentro de [30-03] DISPO-DEST", () => {
    const startIdx = appJs.indexOf("// ─── [30-03] DISPO-DEST: INICIO ───");
    const endIdx = appJs.indexOf("// ─── [30-03] DISPO-DEST: FIN ───");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).toContain("Hoy → Mis compromisos");
    expect(block).toContain("Hoy → Esperando del prospecto");
  });

  it("la rama de compromiso está ANTES de la rama de 'interesado' (precedencia D-10)", () => {
    const startIdx = appJs.indexOf("// ─── [30-03] DISPO-DEST: INICIO ───");
    const commitBranchIdx = appJs.indexOf("lead.commitment && lead.commitment.estado === 'pendiente'", startIdx);
    const interesadoBranchIdx = appJs.indexOf("lead.estado === 'interesado'", startIdx);
    expect(commitBranchIdx).toBeGreaterThan(-1);
    expect(interesadoBranchIdx).toBeGreaterThan(-1);
    expect(commitBranchIdx).toBeLessThan(interesadoBranchIdx);
  });
});

describe("Aserciones de fuente: escHtml en el bloque nuevo de la ficha (T-31-04)", () => {
  it("toda ocurrencia de '.motivo' dentro del bloque Compromiso está precedida por 'escHtml('", () => {
    const startMarker = 'Fase 31 (D-09): bloque "Compromiso"';
    const endMarker = 'return `<div class="call-detail-panel">';
    const s = appJs.indexOf(startMarker);
    const e = appJs.indexOf(endMarker);
    expect(s).toBeGreaterThan(-1);
    expect(e).toBeGreaterThan(s);
    const block = appJs.slice(s, e);
    const re = /\.motivo/g;
    let m;
    let found = 0;
    while ((m = re.exec(block))) {
      found++;
      const before = block.slice(Math.max(0, m.index - 20), m.index);
      expect(before.endsWith("escHtml(c")).toBe(true);
    }
    // Al menos las 2 ocurrencias esperadas (la condición y el contenido).
    expect(found).toBeGreaterThanOrEqual(2);
  });

  it("el tipo/parte/canal/fecha de cierre interpolados en el bloque nuevo también pasan por escHtml", () => {
    const startMarker = 'Fase 31 (D-09): bloque "Compromiso"';
    const endMarker = 'return `<div class="call-detail-panel">';
    const s = appJs.indexOf(startMarker);
    const e = appJs.indexOf(endMarker);
    const block = appJs.slice(s, e);
    expect(block).toContain("escHtml(_commitmentLabel(c.tipo))");
    expect(block).toContain("escHtml(_cParteTxt)");
    expect(block).toContain("escHtml(c.canal)");
    expect(block).toContain("escHtml(_cFecha)");
    expect(block).toContain("escHtml(_cClosedAt)");
  });
});
