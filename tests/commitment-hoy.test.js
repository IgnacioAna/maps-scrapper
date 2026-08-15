// Test de la vista de consulta de compromisos (D-10/D-11) — Fase 31, Plan 04.
// Mismo molde que tests/commitment-ui.test.js (31-03): no hay browser ni
// jsdom en el repo, así que se verifica en los 2 modos ya usados por el
// proyecto:
//
// 1. Bloque puro extraído por marcadores ([31-03] COMMITMENT-PURE, que ahora
//    también contiene _commitmentHoyBucket): se corta con `new Function` y se
//    evalúa aislado. `now`/`nowMs` SIEMPRE son un reloj FIJO, nunca el reloj
//    de la corrida (nota #163 de CLAUDE.md).
// 2. Aserciones de fuente (patrón tests/gate-next-step-ui.test.js /
//    tests/commitment-ui.test.js): cableado real de public/app.js.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

const START_MARKER = "// ─── [31-03] COMMITMENT-PURE: INICIO ───";
const END_MARKER = "// ─── [31-03] COMMITMENT-PURE: FIN ───";

let appJs;
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

// Extrae el cuerpo `{...}` balanceado de una función a partir del literal
// exacto de su declaración — no depende de qué función venga después (más
// robusto que buscar un "próximo marcador" hardcodeado). `startLiteral` DEBE
// terminar en el `{` que abre el cuerpo de la función (no el primer `{` que
// aparezca después, que puede ser el de un default param como `opts = {}`).
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

beforeAll(() => {
  appJs = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  indexJs = fs.readFileSync(path.join(process.cwd(), "index.js"), "utf8");

  const startIdx = appJs.indexOf(START_MARKER);
  const endIdx = appJs.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `No se encontraron los marcadores COMMITMENT-PURE en public/app.js (start=${startIdx}, end=${endIdx}).`
    );
  }
  const block = appJs.slice(startIdx, endIdx);
  const factory = new Function(
    block +
      `
    return { _commitmentHoyBucket, _commitmentEffectiveEstado, _commitmentLabel };
    `
  );
  cu = factory();
});

describe("COMMITMENT-PURE: _commitmentHoyBucket vive dentro del bloque puro", () => {
  it("la definición cae DENTRO del rango de marcadores [31-03] COMMITMENT-PURE", () => {
    const startIdx = appJs.indexOf(START_MARKER);
    const endIdx = appJs.indexOf(END_MARKER);
    const defIdx = appJs.indexOf("function _commitmentHoyBucket");
    expect(defIdx).toBeGreaterThan(startIdx);
    expect(defIdx).toBeLessThan(endIdx);
  });

  it("el bloque sigue sin referenciar document/localStorage/fetch( (autocontenido)", () => {
    const startIdx = appJs.indexOf(START_MARKER);
    const endIdx = appJs.indexOf(END_MARKER);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).not.toMatch(/document\.|localStorage|fetch\(/);
  });
});

describe("COMMITMENT-PURE: _commitmentHoyBucket(lead, nowMs)", () => {
  const nowMs = new Date(2026, 7, 15, 12, 0).getTime(); // sábado 15/08/2026 12:00, fijo
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("pendiente, parte:'yo', fecha futura → 'yo'", () => {
    const lead = { commitment: { estado: "pendiente", parte: "yo", tipo: "enviar_info", dueAt: new Date(nowMs + DAY_MS).toISOString() } };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe("yo");
  });

  it("pendiente, parte:'yo', fecha PASADA (vencido) → sigue devolviendo 'yo' — no desaparece de Hoy", () => {
    const lead = { commitment: { estado: "pendiente", parte: "yo", tipo: "enviar_info", dueAt: new Date(nowMs - DAY_MS).toISOString() } };
    // El estado ALMACENADO sigue 'pendiente' — _commitmentHoyBucket no mira la
    // fecha para decidir el bucket 'yo'/'prospecto', a propósito (D-10).
    expect(cu._commitmentEffectiveEstado(lead.commitment, nowMs)).toBe("vencido");
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe("yo");
  });

  it("pendiente, parte:'prospecto' → 'prospecto'", () => {
    const lead = { commitment: { estado: "pendiente", parte: "prospecto", tipo: "hablar_con_socio", dueAt: new Date(nowMs + DAY_MS).toISOString() } };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe("prospecto");
  });

  it("pendiente, parte:'prospecto', vencido → sigue 'prospecto'", () => {
    const lead = { commitment: { estado: "pendiente", parte: "prospecto", tipo: "pensarlo", dueAt: new Date(nowMs - DAY_MS).toISOString() } };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe("prospecto");
  });

  it("cumplido + parte:'yo' + nextAction {origen:'compromiso', tipo:'esperar_respuesta'} → 'prospecto' (COMM-04)", () => {
    const lead = {
      commitment: { estado: "cumplido", parte: "yo", tipo: "enviar_info", dueAt: new Date(nowMs - DAY_MS).toISOString(), closedAt: new Date(nowMs).toISOString() },
      nextAction: { origen: "compromiso", tipo: "esperar_respuesta", dueAt: new Date(nowMs + 2 * DAY_MS).toISOString() },
    };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe("prospecto");
  });

  it("cumplido + parte:'yo' + pedir_presupuesto + nextAction esperar_respuesta → 'prospecto' también", () => {
    const lead = {
      commitment: { estado: "cumplido", parte: "yo", tipo: "pedir_presupuesto", dueAt: new Date(nowMs - DAY_MS).toISOString(), closedAt: new Date(nowMs).toISOString() },
      nextAction: { origen: "compromiso", tipo: "esperar_respuesta", dueAt: new Date(nowMs + 2 * DAY_MS).toISOString() },
    };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe("prospecto");
  });

  it("cumplido + parte:'yo' SIN ese nextAction → null", () => {
    const lead = { commitment: { estado: "cumplido", parte: "yo", tipo: "enviar_info", closedAt: new Date(nowMs).toISOString() }, nextAction: null };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe(null);
  });

  it("cumplido + parte:'yo' + nextAction de otro origen (no 'compromiso') → null", () => {
    const lead = {
      commitment: { estado: "cumplido", parte: "yo", tipo: "enviar_info", closedAt: new Date(nowMs).toISOString() },
      nextAction: { origen: "manual", tipo: "esperar_respuesta", dueAt: new Date(nowMs + DAY_MS).toISOString() },
    };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe(null);
  });

  it("cumplido + parte:'prospecto' → null (el 3er bucket es exclusivo de compromisos PROPIOS)", () => {
    const lead = {
      commitment: { estado: "cumplido", parte: "prospecto", tipo: "hablar_con_socio", closedAt: new Date(nowMs).toISOString() },
      nextAction: { origen: "compromiso", tipo: "esperar_respuesta", dueAt: new Date(nowMs + DAY_MS).toISOString() },
    };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe(null);
  });

  it("incumplido → null", () => {
    const lead = { commitment: { estado: "incumplido", parte: "prospecto", tipo: "hablar_con_socio", closedAt: new Date(nowMs).toISOString() } };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe(null);
  });

  it("vencido (cierre explícito 'Ya no aplica') → null", () => {
    const lead = { commitment: { estado: "vencido", parte: "yo", tipo: "enviar_info", closedAt: new Date(nowMs).toISOString() } };
    expect(cu._commitmentHoyBucket(lead, nowMs)).toBe(null);
  });

  it("lead sin commitment → null", () => {
    expect(cu._commitmentHoyBucket({ commitment: null }, nowMs)).toBe(null);
    expect(cu._commitmentHoyBucket({}, nowMs)).toBe(null);
  });

  it("lead nulo/undefined → null", () => {
    expect(cu._commitmentHoyBucket(null, nowMs)).toBe(null);
    expect(cu._commitmentHoyBucket(undefined, nowMs)).toBe(null);
  });

  it("no muta el lead que recibe", () => {
    const lead = { commitment: { estado: "pendiente", parte: "yo", tipo: "enviar_info", dueAt: new Date(nowMs + DAY_MS).toISOString() } };
    const before = JSON.stringify(lead);
    cu._commitmentHoyBucket(lead, nowMs);
    expect(JSON.stringify(lead)).toBe(before);
  });
});

describe("Aserciones de fuente: _hoyRenderSection gana opts.rowBadge (D-10)", () => {
  it("la firma tiene el 6to parámetro con default (opts = {})", () => {
    expect(appJs).toContain("function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {})");
  });

  it("el cuerpo referencia opts.rowBadge", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain("opts.rowBadge");
  });

  it("sin opts.rowBadge el fallback es cadena vacía (no rompe Callbacks/Interesados)", () => {
    const body = extractFunctionBody(appJs, "function _hoyRenderSection(title, leads, accent, hint, dialerMode, opts = {}) {");
    expect(body).toContain("(opts.rowBadge(l) || '')");
  });
});

describe("Aserciones de fuente: secciones 'Mis compromisos' / 'Esperando del prospecto' en loadHoyView (D-10)", () => {
  it("las 2 llamadas nuevas existen con los títulos LITERALES, dialerMode null y rowBadge", () => {
    expect(appJs).toContain(
      "_hoyRenderSection('Mis compromisos', misCompromisos, 'var(--warning)', 'Le prometí algo — falta cumplirlo', null, { rowBadge: _hoyCommitBadge })"
    );
    expect(appJs).toContain(
      "_hoyRenderSection('Esperando del prospecto', compromisosProspecto, 'var(--accent)', 'Se comprometió él — si vence, seguimiento', null, { rowBadge: _hoyCommitBadge })"
    );
  });

  it("las 2 llamadas nuevas aparecen ANTES que la de 'Callbacks' dentro de loadHoyView", () => {
    const body = extractFunctionBody(appJs, "async function loadHoyView() {");
    const iMis = body.indexOf("_hoyRenderSection('Mis compromisos'");
    const iEsp = body.indexOf("_hoyRenderSection('Esperando del prospecto'");
    const iCb = body.indexOf("_hoyRenderSection('Callbacks'");
    expect(iMis).toBeGreaterThan(-1);
    expect(iEsp).toBeGreaterThan(-1);
    expect(iCb).toBeGreaterThan(-1);
    expect(iMis).toBeLessThan(iCb);
    expect(iEsp).toBeLessThan(iCb);
  });

  it("misCompromisos/compromisosProspecto se derivan con _commitmentHoyBucket sobre el mismo array `leads`", () => {
    const body = extractFunctionBody(appJs, "async function loadHoyView() {");
    expect(body).toContain("_commitmentHoyBucket(l, nowMsHoy) === 'yo'");
    expect(body).toContain("_commitmentHoyBucket(l, nowMsHoy) === 'prospecto'");
  });

  it("loadHoyView NO llama claimed.add para los leads de compromiso — el conteo global sigue en 2", () => {
    // Los 2 usos preexistentes son callbacks.forEach(...) e interesados.forEach(...).
    expect(countOccurrences(appJs, "claimed.add")).toBe(2);
    const body = extractFunctionBody(appJs, "async function loadHoyView() {");
    expect(body).not.toContain("misCompromisos.forEach(l => claimed.add");
    expect(body).not.toContain("compromisosProspecto.forEach(l => claimed.add");
  });

  it("_hoyState incluye commitYoIds y commitProspectoIds", () => {
    expect(appJs).toContain("commitYoIds: misCompromisos.map(l => l.id), commitProspectoIds: compromisosProspecto.map(l => l.id)");
  });

  it("totalPend se calcula con un Set de ids ÚNICOS de las 4 secciones", () => {
    const body = extractFunctionBody(appJs, "async function loadHoyView() {");
    const totalPendIdx = body.indexOf("const totalPend = new Set(");
    expect(totalPendIdx).toBeGreaterThan(-1);
    const line = body.slice(totalPendIdx, body.indexOf(";", totalPendIdx) + 1);
    expect(line).toContain("callbacks");
    expect(line).toContain("interesados");
    expect(line).toContain("misCompromisos");
    expect(line).toContain("compromisosProspecto");
  });

  it("virgenesCount sigue derivándose de `claimed` sin tocar (el puntero de leads nuevos no se mueve)", () => {
    expect(appJs).toContain("const virgenesCount = leads.filter(l => !claimed.has(l.id) && notDnc(l) && !terminal(l) && (Number(l.callAttempts || 0) === 0)).length;");
  });
});

describe("Aserciones de fuente: _hoyCommitBadge (D-10, escHtml)", () => {
  it("existe, cadena vacía sin compromiso", () => {
    const body = extractFunctionBody(appJs, "function _hoyCommitBadge(lead) {");
    expect(body).toContain("if (!c || typeof c !== 'object') return '';");
  });

  it("toda interpolación de un campo del compromiso pasa por escHtml", () => {
    const body = extractFunctionBody(appJs, "function _hoyCommitBadge(lead) {");
    expect(body).toContain("escHtml(_commitmentLabel(c.tipo))");
    expect(body).toContain("escHtml(fecha)");
    expect(body).toContain("escHtml('info mandada')");
    expect(body).toContain("escHtml('vencido')");
  });

  it("distingue 'vencido' (warning) de 'pendiente'/'info mandada' (acento) — mismo lenguaje de marca que el resto de Hoy", () => {
    const body = extractFunctionBody(appJs, "function _hoyCommitBadge(lead) {");
    expect(body).toContain("var(--warning)");
    expect(body).toContain("var(--accent-soft)");
    expect(body).toContain("var(--on-accent)");
    expect(body).toContain("font-family:var(--font-mono)");
    expect(body).toContain("font-variant-numeric:tabular-nums");
  });
});

describe("Aserciones de fuente: los títulos de Hoy coinciden con _dispoDestination (anti-deriva, T-31-13)", () => {
  it("'Mis compromisos' y 'Esperando del prospecto' aparecen también dentro de [30-03] DISPO-DEST", () => {
    const startIdx = appJs.indexOf("// ─── [30-03] DISPO-DEST: INICIO ───");
    const endIdx = appJs.indexOf("// ─── [30-03] DISPO-DEST: FIN ───");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const block = appJs.slice(startIdx, endIdx);
    expect(block).toContain("Hoy → Mis compromisos");
    expect(block).toContain("Hoy → Esperando del prospecto");
  });

  // Verificado por mutación durante la ejecución de este plan (registrado en
  // el SUMMARY): cambiar el título de una de las 2 llamadas en loadHoyView
  // rompe la coincidencia exacta de abajo. Este test es la garantía viva.
  it("los títulos de loadHoyView son un match EXACTO de substring con los de DISPO-DEST (garantía anti-deriva)", () => {
    const dispoStart = appJs.indexOf("// ─── [30-03] DISPO-DEST: INICIO ───");
    const dispoEnd = appJs.indexOf("// ─── [30-03] DISPO-DEST: FIN ───");
    const dispoBlock = appJs.slice(dispoStart, dispoEnd);
    expect(appJs).toContain("_hoyRenderSection('Mis compromisos'");
    expect(appJs).toContain("_hoyRenderSection('Esperando del prospecto'");
    expect(dispoBlock).toContain("'en Hoy → Mis compromisos'");
    expect(dispoBlock).toContain("'en Hoy → Esperando del prospecto'");
  });
});

describe("Aserciones de fuente: _renderCallHistory suma el kind 'commitment' (D-11)", () => {
  it("empuja exactamente un evento kind: 'commitment' y tiene su rama de render", () => {
    expect(countOccurrences(appJs, "kind: 'commitment'")).toBe(1);
    expect(countOccurrences(appJs, "e.kind === 'commitment'")).toBeGreaterThanOrEqual(1);
  });

  it("el push del evento aparece DESPUÉS del for de notas y ANTES del guard events.length === 0", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    const notesForIdx = body.indexOf("for (const n of notes)");
    const pushIdx = body.indexOf("kind: 'commitment'");
    const guardIdx = body.indexOf("if (events.length === 0)");
    expect(notesForIdx).toBeGreaterThan(-1);
    expect(pushIdx).toBeGreaterThan(notesForIdx);
    expect(guardIdx).toBeGreaterThan(pushIdx);
  });

  it("el evento solo entra si el compromiso está CERRADO (estado !== 'pendiente') y con closedAt", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    expect(body).toContain("lead.commitment.estado !== 'pendiente' && lead.commitment.closedAt");
  });

  it("la rama de render usa _commitmentLabel y escapa el texto del estado con escHtml", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    expect(body).toContain("escHtml(_hEstadoTxt)");
    expect(body).toContain("escHtml(_commitmentLabel(e.tipo))");
  });

  it("estado === 'vencido' dice 'Compromiso vencido' (cierre explícito, no confundir con el derivado)", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    expect(body).toContain("'Compromiso vencido'");
    expect(body).toContain("'Compromiso cumplido'");
    expect(body).toContain("'Compromiso no cumplió'");
  });

  it("un lead cuyo ÚNICO evento sea un compromiso cerrado igual muestra la caja (el guard events.length===0 sigue funcionando tal cual)", () => {
    const body = extractFunctionBody(appJs, "function _renderCallHistory(lead) {");
    const pushIdx = body.indexOf("kind: 'commitment'");
    const guardIdx = body.indexOf("if (events.length === 0) { box.style.display = 'none'; return; }");
    expect(guardIdx).toBeGreaterThan(pushIdx);
  });
});

describe("Cache-buster: app.js bumpeado de nuevo, style.css intacto", () => {
  const indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

  // El plan asumía baseline app.js?v=20260815e, pero el baseline REAL con el
  // que arrancó este plan (documentado en 31-03-SUMMARY.md, "Next Phase
  // Readiness") ya era 20260815f — 31-03 tuvo que correr el mismo ajuste
  // contra una sesión paralela de branding. Se verifica forma + estrictamente
  // mayor que el baseline real, no un valor pineado a ciegas.
  it("app.js?v= es estrictamente mayor que el baseline real de este plan (20260815f)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260815f").toBe(true);
  });

  it("style.css?v= tiene forma válida — esta fase no le agregó CSS propio (git diff de cada task de este plan nunca incluyó public/style.css)", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});

describe("Anti-alcance D-12: sin extracción automática de compromisos desde transcripción/IA", () => {
  it("ningún archivo contiene commitmentFromTranscript ni _extractCommitment", () => {
    expect(appJs).not.toContain("commitmentFromTranscript");
    expect(appJs).not.toContain("_extractCommitment");
    expect(indexJs).not.toContain("commitmentFromTranscript");
    expect(indexJs).not.toContain("_extractCommitment");
  });

  it("_trainingSummaryLLM no menciona 'commitment' en su cuerpo (el resumen de IA no deriva compromisos)", () => {
    const body = extractFunctionBody(indexJs, "async function _trainingSummaryLLM(segments, outcome) {");
    expect(/commitment/i.test(body)).toBe(false);
  });

  it("_autoDispositionLLM no menciona 'commitment' en su cuerpo (la auto-disposición IA no toca el compromiso)", () => {
    const body = extractFunctionBody(indexJs, "async function _autoDispositionLLM(segments) {");
    expect(/commitment/i.test(body)).toBe(false);
  });
});
