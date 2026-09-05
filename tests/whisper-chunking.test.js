// 2026-09-05 — Transcripción por TROZOS + reintento con temperatura.
//
// Causa raíz medida en prod (llamada de 964 s del 05/09 + 115 transcripts de
// 35 días): whisper-1 entra en loop de decoder sobre audio telefónico con
// silencio y, con el canal entero en una sola pasada, arrastra el loop hasta el
// final del archivo (977 segmentos de "Sí." con cr 7.3 desde el segundo 1 al
// 960; el canal del cliente devolvía 2.531 crudos de los que sobrevivían 292).
// La grabación estaba sana (nivel 0.48, 40% con señal): el problema era el ASR.
//
// Dos defensas, las dos acá:
//   (1) cada trozo se transcribe por separado y sus timestamps se corren por su
//       offset → un loop en un trozo NO contamina a los vecinos;
//   (2) un trozo que vuelve colapsado se reintenta UNA vez con temperatura
//       explícita y se conserva el resultado con más habla.
// `callWhisper` es inyectable: los tests simulan la API sin gastar un centavo.

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import request from "supertest";

const tmpData = path.join(os.tmpdir(), `whisper-chunking-${Date.now()}`);
fs.mkdirSync(tmpData, { recursive: true });
process.env.NODE_ENV = "test";
process.env.DATA_DIR = tmpData;
process.env.ADMIN_EMAIL = "admin-wc@local.test";
process.env.ADMIN_PASSWORD = "wcpass1234";
process.env.JWT_SECRET = "test-secret-wc";
// Key de MENTIRA: el endpoint valida el body ANTES de tocar OpenAI, así que con
// un body inválido responde 400 sin hacer ninguna request. (Con key vacía
// cortaría en 503 antes de llegar a la validación.)
process.env.OPENAI_API_KEY = "sk-test-nunca-se-usa";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

function pwd(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(plain, salt, 64).toString("hex");
  return { salt, hash };
}
fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({
  users: [
    { id: "u_admin", email: "admin-wc@local.test", name: "AdminWC", role: "admin", status: "active", setterId: "", password: pwd("wcpass1234") },
  ], invites: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({
  setters: [{ id: "s_x", name: "X" }], variants: [],
  leads: { l_1: { num: 1, name: "Lead Uno", phone: "+5215550000001", assignedTo: "s_x", conexion: "sin_wsp", estado: "sin_contactar" } },
  calendar: [], sessions: [],
}, null, 2));
fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, searches: [], lastPages: {} }));

let app, W;
beforeAll(async () => {
  const mod = await import("../index.js");
  app = mod.default || mod.app;
  W = globalThis.__whisper;
});
afterAll(() => { try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {} });

// Segmento "real": métricas de voz sana.
const real = (start, end, text) => ({ start, end, text, no_speech_prob: 0.05, avg_logprob: -0.2, compression_ratio: 1.3 });
// Segmento de loop: lo que devolvió Whisper en la llamada del 05/09.
const loop = (start, text = "Sí.") => ({ start, end: start + 1, text, no_speech_prob: 0.27, avg_logprob: -0.22, compression_ratio: 7.3 });
const loopChunk = (n) => Array.from({ length: n }, (_, i) => loop(i));

describe("_normalizeAudioParts — formato nuevo y legacy", () => {
  it("acepta setterParts/leadParts y ordena el offset", () => {
    const p = W.normalizeAudioParts({ setterParts: [{ b64: "AAAA", offsetS: 60 }, { b64: "BBBB", offsetS: "0" }], leadParts: [] });
    expect(p.setter).toEqual([{ b64: "AAAA", offsetS: 60 }, { b64: "BBBB", offsetS: 0 }]);
    expect(p.lead).toEqual([]);
  });
  it("legacy: setterAudioB64 entero = un único trozo con offset 0", () => {
    const p = W.normalizeAudioParts({ setterAudioB64: "AAAA", leadAudioB64: "BBBB" });
    expect(p.setter).toEqual([{ b64: "AAAA", offsetS: 0 }]);
    expect(p.lead).toEqual([{ b64: "BBBB", offsetS: 0 }]);
  });
  it("trozo malformado (sin b64) → null; offset negativo → 0; demasiados trozos → null", () => {
    expect(W.normalizeAudioParts({ setterParts: [{ offsetS: 1 }] })).toBeNull();
    expect(W.normalizeAudioParts({ setterParts: ["x"] })).toBeNull();
    expect(W.normalizeAudioParts({ leadParts: [{ b64: "AA", offsetS: -5 }] }).lead[0].offsetS).toBe(0);
    expect(W.normalizeAudioParts({ setterParts: Array.from({ length: 61 }, () => ({ b64: "AA", offsetS: 0 })) })).toBeNull();
  });
});

describe("_whisperChunkCollapsed", () => {
  it("nada crudo → no colapsó; crudo con habla que sobrevivió → no colapsó", () => {
    expect(W.chunkCollapsed([], [])).toBe(false);
    expect(W.chunkCollapsed([real(0, 2, "hola qué tal")], [real(0, 2, "hola qué tal")])).toBe(false);
  });
  it("3+ crudos y cero sobrevivientes → colapsó", () => {
    expect(W.chunkCollapsed(loopChunk(3), [])).toBe(true);
  });
  it("mayoría de crudos con compression_ratio de loop → colapsó aunque algo sobreviva", () => {
    const raw = [real(0, 2, "buenas tardes, con el doctor por favor"), ...loopChunk(5)];
    expect(W.chunkCollapsed(raw, [raw[0]])).toBe(true);
  });
});

describe("_transcribeChannelParts — offsets, reintento y aislamiento del loop", () => {
  it("corre los timestamps de cada trozo por su offset y ordena", async () => {
    const calls = [];
    const callWhisper = async (part, temperature) => {
      calls.push({ b64: part.b64, temperature });
      if (part.b64 === "P0") return { segments: [real(1, 3, "Buenas tardes, con el doctor")], duration: 60 };
      return { segments: [real(0.5, 2.5, "Sí, con él habla")], duration: 30 };
    };
    const { segments, debug } = await W.transcribeChannelParts(
      [{ b64: "P1", offsetS: 60 }, { b64: "P0", offsetS: 0 }], "lead", { callWhisper, activePct: 40 });
    expect(segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [1, 3, "Buenas tardes, con el doctor"],
      [60.5, 62.5, "Sí, con él habla"],
    ]);
    expect(segments.every((s) => s.speaker === "lead")).toBe(true);
    expect(debug).toMatchObject({ raw: 2, kept: 2, chunks: 2, audioS: 90 });
    expect(debug.retried).toBeUndefined();
    expect(calls.every((c) => c.temperature === 0)).toBe(true);
  });

  it("un trozo en loop se reintenta con temperatura y se queda con el reintento si trae habla", async () => {
    const calls = [];
    const callWhisper = async (part, temperature) => {
      calls.push(temperature);
      if (temperature === 0) return { segments: loopChunk(30), duration: 30 };
      return { segments: [real(2, 5, "nunca pagamos nada, trabajamos bajo comisión")], duration: 30 };
    };
    const { segments, debug } = await W.transcribeChannelParts([{ b64: "P", offsetS: 120 }], "lead", { callWhisper, activePct: 40 });
    expect(calls).toEqual([0, W.RETRY_TEMPERATURE]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 122, end: 125, text: "nunca pagamos nada, trabajamos bajo comisión" });
    expect(debug).toMatchObject({ kept: 1, chunks: 1, retried: 1, rescued: 1 });
    expect(debug.rawSample).toBeUndefined(); // el trozo terminó con habla: no hace falta muestra
  });

  it("si el reintento también loopea, el trozo queda vacío pero NO contamina al vecino", async () => {
    const callWhisper = async (part) => {
      if (part.b64 === "LOOP") return { segments: loopChunk(50), duration: 60 };
      return { segments: [real(3, 6, "le paso con la doctora, un momento")], duration: 60 };
    };
    const { segments, debug } = await W.transcribeChannelParts(
      [{ b64: "LOOP", offsetS: 0 }, { b64: "OK", offsetS: 60 }], "lead", { callWhisper, activePct: 40 });
    expect(segments.map((s) => [s.start, s.text])).toEqual([[63, "le paso con la doctora, un momento"]]);
    expect(debug).toMatchObject({ raw: 51, kept: 1, chunks: 2, retried: 1, rescued: 0, audioS: 120 });
    // Diagnóstico: la muestra es del trozo que quedó vacío, con sus métricas.
    expect(debug.rawSample).toHaveLength(4);
    expect(debug.rawSample[0]).toMatchObject({ t: "Sí.", cr: 7.3 });
  });

  it("un trozo sano NO gasta reintento (una sola llamada por trozo)", async () => {
    let n = 0;
    const callWhisper = async () => { n++; return { segments: [real(0, 2, "hola, buenas tardes"), real(3, 5, "con quién tengo el gusto")], duration: 20 }; };
    const { debug } = await W.transcribeChannelParts([{ b64: "A", offsetS: 0 }, { b64: "B", offsetS: 60 }], "setter", { callWhisper, activePct: 50 });
    expect(n).toBe(2);
    expect(debug.retried).toBeUndefined();
    expect(debug.kept).toBe(4);
  });

  it("si el reintento tira excepción, se conserva el resultado del primer intento", async () => {
    const callWhisper = async (part, temperature) => {
      if (temperature > 0) throw new Error("429 rate limit");
      return { segments: [real(0, 2, "buenas"), ...loopChunk(5)], duration: 10 };
    };
    const { segments, debug } = await W.transcribeChannelParts([{ b64: "A", offsetS: 0 }], "lead", { callWhisper, activePct: 20 });
    expect(segments.map((s) => s.text)).toEqual(["buenas"]);
    expect(debug).toMatchObject({ retried: 1, rescued: 0 });
  });
});

describe("POST /api/telnyx/calls/:leadId/transcribe — validación del body", () => {
  let adminCookie;
  beforeAll(async () => {
    const r = await request(app).post("/api/auth/login").send({ email: "admin-wc@local.test", password: "wcpass1234" });
    adminCookie = r.headers["set-cookie"].map((c) => c.split(";")[0]).join("; ");
  });
  it("sin ningún trozo → 400", async () => {
    const r = await request(app).post("/api/telnyx/calls/l_1/transcribe").set("Cookie", adminCookie).send({ setterParts: [], leadParts: [] });
    expect(r.status).toBe(400);
  });
  it("trozo malformado → 400 (antes de tocar OpenAI)", async () => {
    const r = await request(app).post("/api/telnyx/calls/l_1/transcribe").set("Cookie", adminCookie).send({ leadParts: [{ offsetS: 3 }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/malformados/);
  });
});
