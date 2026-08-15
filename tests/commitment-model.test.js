// Phase 31 Plan 01 — modelo puro del compromiso hablado (COMM-01/02/03).
//
// Este archivo NO ejercita HTTP (eso es el plan 31-02): son tests puros
// sobre globalThis.__voiceAgent, mismo idioma que tests/retell-lead-timezone.test.js
// y tests/next-action-model.test.js. Todos los casos de fecha usan un
// `nowIso` FIJO inyectado — nunca el reloj de la corrida (nota #163 de
// CLAUDE.md: es la causa raíz de los flaky de "hora del día").
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "scm-commitment-model-"));
process.env.DATA_DIR = tmpData;
process.env.NODE_ENV = "test";
// Regla #121: NUNCA `delete` — dotenv re-carga el .env y repone las borradas.
process.env.OPENAI_API_KEY = "";
process.env.MERCURY_API_KEY = "";
process.env.QWEN_API_KEY = "";

let V;
let M;

beforeAll(async () => {
  fs.writeFileSync(path.join(tmpData, "auth.json"), JSON.stringify({ users: [], sessions: [], invites: [] }));
  fs.writeFileSync(path.join(tmpData, "setters.json"), JSON.stringify({ setters: [], variants: [], leads: {}, calendar: [], sessions: [] }));
  fs.writeFileSync(path.join(tmpData, "history.json"), JSON.stringify({ entries: {}, searches: [], lastPages: {} }));
  await import("../index.js");
  V = globalThis.__voiceAgent;
  M = globalThis.__metricsAudit;
});

// Fixture base de lead en memoria — no toca disco. Suficiente para los tests
// puros de helpers (que operan sobre el objeto JS, no sobre setters.json).
function freshLead(overrides = {}) {
  return {
    id: "lx", name: "Fixture", phone: "+5215550000001", estado: "interesado",
    callLog: [], notes: [],
    followUps: { "24hs": false, "48hs": false, "72hs": false, "7d": false, "15d": false },
    followUpStartedAt: null, callbackAt: "", nextAction: null, commitment: null,
    ...overrides,
  };
}

const NOW_ISO = "2026-08-15T12:00:00.000Z"; // mediodía UTC fijo

describe("_sanitizeCommitment", () => {
  it("null/undefined/string/objeto sin tipo → null", () => {
    expect(V._sanitizeCommitment(null)).toBeNull();
    expect(V._sanitizeCommitment(undefined)).toBeNull();
    expect(V._sanitizeCommitment("enviar_info")).toBeNull();
    expect(V._sanitizeCommitment({})).toBeNull();
    expect(V._sanitizeCommitment({ motivo: "sin tipo" })).toBeNull();
  });

  it("tipo fuera de whitelist devuelve null (NO coerciona a 'otro')", () => {
    expect(V._sanitizeCommitment({ tipo: "no-existe" })).toBeNull();
    expect(V._sanitizeCommitment({ tipo: "callback" })).toBeNull(); // vocabulario de NEXT_ACTION_TIPOS, no de COMMITMENT_TIPOS
  });

  it("tipo válido sin parte toma el default de COMMITMENT_DEFAULT_PARTE", () => {
    expect(V._sanitizeCommitment({ tipo: "enviar_info" }).parte).toBe("yo");
    expect(V._sanitizeCommitment({ tipo: "hablar_con_socio" }).parte).toBe("prospecto");
  });

  it("parte fuera de whitelist cae al default del tipo", () => {
    const r = V._sanitizeCommitment({ tipo: "hablar_con_socio", parte: "cualquiera" });
    expect(r.parte).toBe("prospecto");
  });

  it("canal fuera de NEXT_ACTION_CANALES cae a COMMITMENT_DEFAULT_CANAL", () => {
    const r = V._sanitizeCommitment({ tipo: "enviar_info", canal: "fax" });
    expect(r.canal).toBe("whatsapp");
  });

  it("motivo de 500 chars queda truncado a 200", () => {
    const r = V._sanitizeCommitment({ tipo: "otro", motivo: "x".repeat(500) });
    expect(r.motivo.length).toBe(200);
  });

  it("dueAt basura devuelve dueAt:'' en vez de invalidar el payload", () => {
    const r = V._sanitizeCommitment({ tipo: "otro", dueAt: "mañana" });
    expect(r).not.toBeNull();
    expect(r.dueAt).toBe("");
  });

  it("dueAt válido se re-serializa a ISO", () => {
    const r = V._sanitizeCommitment({ tipo: "otro", dueAt: "2026-09-01T10:00:00.000Z" });
    expect(r.dueAt).toBe("2026-09-01T10:00:00.000Z");
  });
});

describe("Mapa D-06 (_commitmentDueAtForTipo), nowIso fijo de mediodía", () => {
  it("hablar_con_socio cae exactamente a +5 días", () => {
    const r = V._commitmentDueAtForTipo("hablar_con_socio", NOW_ISO);
    const deltaMs = new Date(r).getTime() - new Date(NOW_ISO).getTime();
    expect(deltaMs).toBe(5 * 24 * 60 * 60 * 1000);
  });

  it("pensarlo y pedir_presupuesto caen al mismo delta que GATE_INTERESADO_DELTA_MS", () => {
    const rPensarlo = V._commitmentDueAtForTipo("pensarlo", NOW_ISO);
    const rPresupuesto = V._commitmentDueAtForTipo("pedir_presupuesto", NOW_ISO);
    const deltaPensarlo = new Date(rPensarlo).getTime() - new Date(NOW_ISO).getTime();
    const deltaPresupuesto = new Date(rPresupuesto).getTime() - new Date(NOW_ISO).getTime();
    expect(deltaPensarlo).toBe(V.GATE_INTERESADO_DELTA_MS);
    expect(deltaPresupuesto).toBe(V.GATE_INTERESADO_DELTA_MS);
  });

  it("llamar_despues cae a GATE_CADENCIA_DELTA_MS (+24h)", () => {
    const r = V._commitmentDueAtForTipo("llamar_despues", NOW_ISO);
    const deltaMs = new Date(r).getTime() - new Date(NOW_ISO).getTime();
    expect(deltaMs).toBe(V.GATE_CADENCIA_DELTA_MS);
  });

  it("enviar_info cae dentro del MISMO día de negocio que nowIso, estrictamente en el futuro", () => {
    const r = V._commitmentDueAtForTipo("enviar_info", NOW_ISO);
    const nowMs = new Date(NOW_ISO).getTime();
    const dueMs = new Date(r).getTime();
    expect(M._bizDayStr(dueMs)).toBe(M._bizDayStr(nowMs));
    expect(dueMs).toBeGreaterThan(nowMs);
  });

  it("enviar_info cargado a 30s del cierre del día de negocio respeta el piso de 1h", () => {
    // Fin del día de negocio: medianoche del día siguiente (TZ de negocio) menos 1 min.
    const bizMidnightNext = M._bizStartOfDay(new Date(NOW_ISO).getTime()) + 24 * 60 * 60 * 1000;
    const almostEndOfDay = new Date(bizMidnightNext - 60000 - 30000).toISOString(); // 30s antes del cierre
    const r = V._commitmentDueAtForTipo("enviar_info", almostEndOfDay);
    const deltaMs = new Date(r).getTime() - new Date(almostEndOfDay).getTime();
    expect(deltaMs).toBeGreaterThanOrEqual(60 * 60 * 1000); // COMMITMENT_ENVIAR_INFO_MIN_MS
  });
});

describe("D-05 — _setCommitment sobre un lead en memoria", () => {
  it("deja lead.commitment.estado === 'pendiente' con los 11 campos de <interfaces>", () => {
    const l = freshLead();
    const c = V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    expect(c).not.toBeNull();
    expect(l.commitment.estado).toBe("pendiente");
    for (const k of ["tipo", "parte", "canal", "dueAt", "estado", "motivo", "callId", "createdAt", "createdBy", "closedAt", "closedBy"]) {
      expect(Object.prototype.hasOwnProperty.call(l.commitment, k)).toBe(true);
    }
  });

  it("deja lead.nextAction.origen === 'compromiso' y dueAt idéntico al del commitment", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    expect(l.nextAction.origen).toBe("compromiso");
    expect(l.nextAction.dueAt).toBe(l.commitment.dueAt);
  });

  it("espeja lead.callbackAt === lead.commitment.dueAt sin que este plan lo escriba a mano", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "llamar_despues" }, NOW_ISO);
    expect(l.callbackAt).toBe(l.commitment.dueAt);
  });

  it("parte:'prospecto' produce nextAction.tipo === 'esperar_respuesta'", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "hablar_con_socio", parte: "prospecto" }, NOW_ISO);
    expect(l.nextAction.tipo).toBe("esperar_respuesta");
  });

  it("enviar_info con parte:'yo' produce nextAction.tipo === 'enviar_info'", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "enviar_info", parte: "yo" }, NOW_ISO);
    expect(l.nextAction.tipo).toBe("enviar_info");
  });

  it("pensarlo con parte:'yo' produce nextAction.tipo === 'callback'", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo", parte: "yo" }, NOW_ISO);
    expect(l.nextAction.tipo).toBe("callback");
  });

  it("el motivo del nextAction nombra la etiqueta legible y la parte", () => {
    const lYo = freshLead();
    V._setCommitment(lYo, { tipo: "enviar_info", parte: "yo" }, NOW_ISO);
    expect(lYo.nextAction.motivo).toContain("compromiso mío");
    expect(lYo.nextAction.motivo).toContain("mandar info");

    const lProspecto = freshLead();
    V._setCommitment(lProspecto, { tipo: "pensarlo", parte: "prospecto" }, NOW_ISO);
    expect(lProspecto.nextAction.motivo).toContain("compromiso del prospecto");
    expect(lProspecto.nextAction.motivo).toContain("lo iba a pensar");
  });

  it("un dueAt explícito en el spec respeta ESA fecha y no la del mapa D-06", () => {
    const l = freshLead();
    const explicitDueAt = "2026-12-25T15:00:00.000Z";
    V._setCommitment(l, { tipo: "hablar_con_socio", dueAt: explicitDueAt }, NOW_ISO);
    expect(l.commitment.dueAt).toBe(explicitDueAt);
    expect(l.nextAction.dueAt).toBe(explicitDueAt);
  });

  it("un spec inválido devuelve null y deja lead.commitment/nextAction exactamente como estaban", () => {
    const l = freshLead({ commitment: { tipo: "otro", parte: "yo", estado: "pendiente" }, nextAction: { tipo: "callback", dueAt: "2026-01-01T00:00:00.000Z" } });
    const snapshotCommitment = structuredClone(l.commitment);
    const snapshotNextAction = structuredClone(l.nextAction);
    const r = V._setCommitment(l, { tipo: "no-existe" }, NOW_ISO);
    expect(r).toBeNull();
    expect(l.commitment).toEqual(snapshotCommitment);
    expect(l.nextAction).toEqual(snapshotNextAction);
  });
});

describe("D-07 — _closeCommitment", () => {
  it("cerrar 'cumplido' un pensarlo deja estado cumplido, closedAt seteado, y apaga el reloj", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    const closedIso = "2026-08-16T09:00:00.000Z";
    const c = V._closeCommitment(l, "cumplido", closedIso, "Ignacio");
    expect(c.estado).toBe("cumplido");
    expect(c.closedAt).toBe(closedIso);
    expect(c.closedBy).toBe("Ignacio");
    expect(l.nextAction).toBeNull();
    expect(l.callbackAt).toBe("");
  });

  it("cerrar NO borra el objeto: lead.commitment sigue existiendo con sus datos (D-11)", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    V._closeCommitment(l, "cumplido", "2026-08-16T09:00:00.000Z", "Ignacio");
    expect(l.commitment).not.toBeNull();
    expect(l.commitment.tipo).toBe("pensarlo");
  });

  it("si el nextAction vigente tiene origen:'manual' (pactado por otra vía), cerrar el compromiso NO lo apaga", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    // Un callback pactado por teléfono DESPUÉS del compromiso, por otra vía.
    V._setNextAction(l, { tipo: "callback", dueAt: "2026-09-01T10:00:00.000Z", origen: "manual" }, "2026-08-15T13:00:00.000Z");
    V._closeCommitment(l, "cumplido", "2026-08-16T09:00:00.000Z", "Ignacio");
    expect(l.nextAction).not.toBeNull();
    expect(l.nextAction.origen).toBe("manual");
    expect(l.nextAction.dueAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("cerrar dos veces devuelve null la segunda vez y no cambia closedAt", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    V._closeCommitment(l, "cumplido", "2026-08-16T09:00:00.000Z", "Ignacio");
    const closedAtFirst = l.commitment.closedAt;
    const second = V._closeCommitment(l, "incumplido", "2026-08-17T09:00:00.000Z", "Otro");
    expect(second).toBeNull();
    expect(l.commitment.closedAt).toBe(closedAtFirst);
    expect(l.commitment.estado).toBe("cumplido");
  });

  it("un estado fuera de COMMITMENT_CIERRES devuelve null sin mutar nada", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "pensarlo" }, NOW_ISO);
    const snapshot = structuredClone(l.commitment);
    expect(V._closeCommitment(l, "pendiente", NOW_ISO, "X")).toBeNull();
    expect(V._closeCommitment(l, "basura", NOW_ISO, "X")).toBeNull();
    expect(l.commitment).toEqual(snapshot);
  });

  it("D-06 seguimiento: cerrar 'cumplido' un enviar_info de parte 'yo' deja esperar_respuesta a +48h exactas", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "enviar_info", parte: "yo" }, NOW_ISO);
    const closedIso = "2026-08-16T09:00:00.000Z";
    V._closeCommitment(l, "cumplido", closedIso, "Ignacio");
    expect(l.nextAction).not.toBeNull();
    expect(l.nextAction.tipo).toBe("esperar_respuesta");
    expect(l.nextAction.origen).toBe("compromiso");
    const deltaMs = new Date(l.nextAction.dueAt).getTime() - new Date(closedIso).getTime();
    expect(deltaMs).toBe(48 * 60 * 60 * 1000);
    expect(l.nextAction.motivo).toContain("esperando respuesta");
  });

  it("el seguimiento post-envío NO se programa si el cierre es 'incumplido'", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "enviar_info", parte: "yo" }, NOW_ISO);
    V._closeCommitment(l, "incumplido", "2026-08-16T09:00:00.000Z", "Ignacio");
    expect(l.nextAction).toBeNull();
  });

  it("el seguimiento post-envío NO se programa si la parte es 'prospecto'", () => {
    const l = freshLead();
    V._setCommitment(l, { tipo: "enviar_info", parte: "prospecto" }, NOW_ISO);
    V._closeCommitment(l, "cumplido", "2026-08-16T09:00:00.000Z", "Ignacio");
    expect(l.nextAction).toBeNull();
  });

  it("el seguimiento post-envío NO se programa si lead.estado es 'descartado'", () => {
    const l = freshLead({ estado: "descartado" });
    V._setCommitment(l, { tipo: "enviar_info", parte: "yo" }, NOW_ISO);
    V._closeCommitment(l, "cumplido", "2026-08-16T09:00:00.000Z", "Ignacio");
    expect(l.nextAction).toBeNull();
  });
});

describe("Estado derivado — _commitmentEffectiveEstado (PURA, no muta)", () => {
  it("pendiente con dueAt futuro → 'pendiente'", () => {
    const c = { estado: "pendiente", dueAt: "2099-01-01T00:00:00.000Z" };
    expect(V._commitmentEffectiveEstado(c, new Date(NOW_ISO).getTime())).toBe("pendiente");
  });

  it("pendiente con dueAt pasado → 'vencido' (el estado ALMACENADO sigue en 'pendiente')", () => {
    const c = { estado: "pendiente", dueAt: "2020-01-01T00:00:00.000Z" };
    const nowMs = new Date(NOW_ISO).getTime();
    expect(V._commitmentEffectiveEstado(c, nowMs)).toBe("vencido");
    expect(c.estado).toBe("pendiente"); // no mutado
  });

  it("cumplido con dueAt pasado → 'cumplido' (un cierre explícito nunca se reporta como vencido)", () => {
    const c = { estado: "cumplido", dueAt: "2020-01-01T00:00:00.000Z" };
    expect(V._commitmentEffectiveEstado(c, new Date(NOW_ISO).getTime())).toBe("cumplido");
  });

  it("sin compromiso → ''", () => {
    const nowMs = new Date(NOW_ISO).getTime();
    expect(V._commitmentEffectiveEstado(null, nowMs)).toBe("");
    expect(V._commitmentEffectiveEstado(undefined, nowMs)).toBe("");
  });
});
