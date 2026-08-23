// Test de RESP-02 (Fase 36, Plan 02) — "la disposición responde": el POST del
// resultado ya no espera al audio ni al handler diferido de cuelgue.
// Sin browser ni jsdom en el repo: mismo molde que tests/dial-hold.test.js /
// tests/dispo-feedback.test.js (36-01) / tests/gate-destination.test.js.
//
// Cobertura (no duplica lo de dispo-feedback.test.js — ese cubre
// _dispoBusyOn/_dispoBusyOff, este cubre el desacople del POST):
// 1. La espera desapareció de _finalizeActiveCallBeforeDisposition.
// 2. La metadata (_metaObj) sigue completa y quedó afuera del setTimeout
//    diferido de _onTelnyxCallEnded — el requisito duro del CONTEXT.
// 3. Nada fantasma (no_answer / gate) detrás de una disposición manual.
// 4. La transcripción diferida sigue llegando vía _audioInFlight.
// 5. Cache-buster.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

let appJs;
let indexHtml;

// Copiado literal de tests/dial-hold.test.js / tests/dispo-feedback.test.js —
// extrae el cuerpo `{...}` balanceado de una función a partir del literal
// exacto de su declaración (`startLiteral` DEBE terminar en el `{` que abre
// el cuerpo, no el primer `{` que aparezca después).
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

// ─── La espera desapareció del camino del POST ─────────────────────────────

describe("_finalizeActiveCallBeforeDisposition: sin esperas", () => {
  function body() {
    return extractFunctionBody(appJs, "async function _finalizeActiveCallBeforeDisposition(leadId) {");
  }

  it("el cuerpo NO contiene el techo de 4500ms del while viejo", () => {
    expect(body()).not.toContain("4500");
  });

  it("el cuerpo NO contiene el respiro extra de 250ms", () => {
    expect(body()).not.toContain("await new Promise((r) => setTimeout(r, 250));");
  });

  it("el cuerpo NO contiene ningún while (", () => {
    expect(body()).not.toContain("while (");
  });

  it("los 3 guards originales siguen ahí (no llamada activa / otro lead / ya capturada)", () => {
    const b = body();
    expect(b).toContain("!_telnyx?.activeCall");
    expect(b).toContain("_telnyxCallState.leadId !== leadId");
    expect(b).toContain("_pendingTelnyxCallMetadata[leadId]");
  });

  it("marca dispoInitiated=true, cuelga, y llama a _onTelnyxCallEnded('disposition_hangup') EN EL ACTO, en ese orden", () => {
    const b = body();
    const idxFlag = b.indexOf("_telnyxCallState.dispoInitiated = true;");
    const idxHangup = b.indexOf("hangup?.()");
    const idxEnded = b.indexOf("_onTelnyxCallEnded('disposition_hangup')");
    expect(idxFlag).toBeGreaterThan(-1);
    expect(idxHangup).toBeGreaterThan(idxFlag);
    expect(idxEnded).toBeGreaterThan(idxHangup);
  });

  it("sigue siendo async (los call sites la esperan con await) pero sin ningún await adentro", () => {
    expect(appJs).toContain("async function _finalizeActiveCallBeforeDisposition(leadId) {");
    expect(body()).not.toContain("await ");
  });
});

// ─── La metadata no se perdió (requisito duro del CONTEXT) ────────────────

describe("_onTelnyxCallEnded: la metadata se arma SINCRÓNICA, afuera del setTimeout diferido", () => {
  function body() {
    return extractFunctionBody(appJs, "function _onTelnyxCallEnded(reason) {");
  }

  it("el índice de _pendingTelnyxCallMetadata[leadId] = _metaObj; es MENOR que el del setTimeout(() => {", () => {
    const b = body();
    const idxMeta = b.indexOf("_pendingTelnyxCallMetadata[leadId] = _metaObj;");
    const idxTimeout = b.indexOf("setTimeout(() => {");
    expect(idxMeta).toBeGreaterThan(-1);
    expect(idxTimeout).toBeGreaterThan(-1);
    expect(idxMeta).toBeLessThan(idxTimeout);
  });

  it("_metaObj sigue llevando los 6 campos que consume el backend", () => {
    const b = body();
    for (const f of ["durationSecs,", "fromNumber:", "startedAt:", "endedAt:", "quickNote:", "scriptIdsUsed:"]) {
      expect(b).toContain(f);
    }
  });

  it("la clave compuesta leadId:startedAt se sigue publicando (bug #188 — el backend matchea por callStartedAt)", () => {
    const b = body();
    expect(b).toContain("_pendingTelnyxCallMetadata[`${leadId}:${_dispoStartedAtIso}`] = _metaObj;");
  });

  it("_telnyxMetaPersist() se sigue llamando después de publicar (F5 entre colgar y marcar)", () => {
    const b = body();
    const idxPublish = b.indexOf("_pendingTelnyxCallMetadata[leadId] = _metaObj;");
    const idxPersist = b.indexOf("_telnyxMetaPersist();");
    expect(idxPersist).toBeGreaterThan(idxPublish);
  });

  it("la metadata (const _metaObj) se arma ANTES del bloque de grabación (_stopCallRecordingAndBuffer)", () => {
    const b = body();
    const idxMeta = b.indexOf("let _metaObj = null;");
    const idxRecording = b.indexOf("_stopCallRecordingAndBuffer(leadId, callStartedAtIso)");
    expect(idxMeta).toBeGreaterThan(-1);
    expect(idxRecording).toBeGreaterThan(idxMeta);
  });
});

describe("_consumeTelnyxMeta(leadId): 7 ocurrencias (6 call sites + declaración) — el agendado ahora consume", () => {
  it("hay exactamente 7 ocurrencias del literal en todo el archivo", () => {
    expect(countOccurrences(appJs, "_consumeTelnyxMeta(leadId)")).toBe(7);
  });

  it("la declaración de la función matchea el mismo literal (por eso 6 call sites + 1 = 7)", () => {
    expect(countOccurrences(appJs, "function _consumeTelnyxMeta(leadId) {")).toBe(1);
  });

  it("uno de los 7 está dentro del handler de call-sched-confirm (el agendado)", () => {
    const startIdx = appJs.indexOf("document.getElementById('call-sched-confirm').onclick");
    const endIdx = appJs.indexOf(
      "_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'scheduled_with_admin' });",
      startIdx
    );
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const tramo = appJs.slice(startIdx, endIdx);
    expect(tramo).toContain("_consumeTelnyxMeta(leadId)");
    expect(tramo).toContain("if (telnyxMeta) body.telnyxCallMeta = telnyxMeta;");
  });

  it("la línea pineada de _dispoAfterSaved del agendado NO se tocó (comparada literal con gate-destination.test.js)", () => {
    expect(appJs).toContain("_dispoAfterSaved(leadId, { lead: data.lead, outcome: 'scheduled_with_admin' });");
  });
});

// ─── Nada fantasma detrás de una disposición manual ────────────────────────

describe("Guard _dispoInitiated: sin no_answer fantasma ni gate huérfano", () => {
  function body() {
    return extractFunctionBody(appJs, "function _onTelnyxCallEnded(reason) {");
  }

  it("existe la rama if (_dispoInitiated) y está ANTES del if (!reachedContact)", () => {
    const b = body();
    const idxIf = b.indexOf("if (_dispoInitiated) {");
    const idxReached = b.indexOf("if (!reachedContact) {");
    expect(idxIf).toBeGreaterThan(-1);
    expect(idxReached).toBeGreaterThan(-1);
    expect(idxIf).toBeLessThan(idxReached);
  });

  it("_autoMarkNoAnswer(leadId); aparece una sola vez en todo el archivo y cae dentro de un else if", () => {
    expect(countOccurrences(appJs, "_autoMarkNoAnswer(leadId);")).toBe(1);
    const idx = appJs.indexOf("_autoMarkNoAnswer(leadId);");
    const before = appJs.slice(Math.max(0, idx - 120), idx);
    expect(before).toContain("} else if (!reachedContact) {");
  });

  it("const _dispoInitiated se captura en el cuerpo sincrónico (índice MENOR al del setTimeout)", () => {
    const b = body();
    const idxConst = b.indexOf("const _dispoInitiated = !!_telnyxCallState.dispoInitiated;");
    const idxTimeout = b.indexOf("setTimeout(() => {");
    expect(idxConst).toBeGreaterThan(-1);
    expect(idxConst).toBeLessThan(idxTimeout);
  });

  it("_startTelnyxCall resetea dispoInitiated = false por llamada", () => {
    const b = extractFunctionBody(appJs, "window._startTelnyxCall = async (leadId, phoneOverride) => {");
    expect(b).toContain("_telnyxCallState.dispoInitiated = false;");
  });

  it("el upsert de /api/setters/pending-calls con endedAt sigue existiendo (no se eliminó junto con la supresión)", () => {
    const b = body();
    expect(b).toContain("apiUrl('/api/setters/pending-calls')");
    expect(b).toContain("endedAt: _metaObj.endedAt");
  });
});

// ─── La transcripción diferida sigue llegando ──────────────────────────────

describe("_audioInFlight: la espera del audio se mudó al flush", () => {
  it("_flushPendingTranscription contiene _audioInFlight.has(leadId), techo 8000, y conserva el filtro de siempre", () => {
    const b = extractFunctionBody(appJs, "async function _flushPendingTranscription(leadId, outcome) {");
    expect(b).toContain("_audioInFlight.has(leadId)");
    expect(b).toContain("8000");
    expect(b).toContain("_dropPendingTranscription(pending);");
    expect(b).toContain("if (!_TRANSCRIBE_OUTCOMES.has(outcome))");
  });

  it("_audioInFlight se marca antes de _stopCallRecordingAndBuffer y se borra en un .finally, dentro de _onTelnyxCallEnded", () => {
    const b = extractFunctionBody(appJs, "function _onTelnyxCallEnded(reason) {");
    const idxSet = b.indexOf("_audioInFlight.set(leadId, Date.now());");
    const idxCall = b.indexOf("_stopCallRecordingAndBuffer(leadId, callStartedAtIso)");
    const idxFinally = b.indexOf(".finally(() => _audioInFlight.delete(leadId));");
    expect(idxSet).toBeGreaterThan(-1);
    expect(idxCall).toBeGreaterThan(idxSet);
    expect(idxFinally).toBeGreaterThan(idxCall);
  });

  it("_audioInFlight se declara una sola vez, como Map", () => {
    expect(countOccurrences(appJs, "const _audioInFlight = new Map();")).toBe(1);
  });

  it("los 6 caminos de disposición siguen llamando _flushPendingTranscription (7 = 6 call sites + declaración)", () => {
    expect(countOccurrences(appJs, "_flushPendingTranscription(leadId,")).toBe(7);
  });
});

// ─── Cache-buster ───────────────────────────────────────────────────────

describe("Cache-buster bumpeado (public/index.html)", () => {
  // Baseline REAL que dejó 36-01, confirmado en disco antes de este plan:
  // app.js 20260822c (línea 3750), style.css 20260822a (línea 15). Este plan
  // NO toca style.css (solo public/app.js + public/index.html) — se verifica
  // que su forma siga válida, no que haya cambiado.
  it("app.js?v= tiene forma válida y es estrictamente mayor que el baseline real de este plan (20260822c)", () => {
    const m = /app\.js\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
    expect(m[1] > "20260822c").toBe(true);
  });

  it("app.js?v= aparece una sola vez (no se duplicó la etiqueta)", () => {
    expect(countOccurrences(indexHtml, "app.js?v=")).toBe(1);
  });

  it("style.css?v= sigue con forma válida — este plan NO tocó style.css", () => {
    const m = /style\.css\?v=(\d{8}[a-z])/.exec(indexHtml);
    expect(m).toBeTruthy();
  });
});
