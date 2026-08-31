// Suite de scripts/coverage-script.mjs (SCR-04).
//
// Patrón NUEVO en este repo: ningún otro test spawnea un script — la
// alternativa era exportar la lógica del .mjs y romper la forma de CLI puro
// que ya tiene scripts/coverage-callstage.mjs (su molde), y la cobertura de
// guion es exactamente lo que hay que poder confiar cuando se decida si
// SCR-04 funcionó, así que este archivo ejecuta el BINARIO REAL, tal como lo
// va a correr el dueño del repo (`npm run coverage:script -- --days 7`), no
// una copia de su lógica.
//
// Los `ts` del fixture son SIEMPRE relativos a `Date.now()` (nunca fechas
// absolutas — lección de las notas #160/#163 de CLAUDE.md, un fixture
// anclado al calendario se pone rojo solo con el paso del tiempo) y
// posteriores al `DEPLOY_ISO` real del script, extraído de su fuente por
// regex (no copiado a mano: si `coverage-script.mjs` cambia esa fecha, este
// test se entera solo, no queda desincronizado).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'coverage-script.mjs');
const SCRIPT_SRC = fs.readFileSync(SCRIPT_PATH, 'utf8');
const DEPLOY_ISO = SCRIPT_SRC.match(/const DEPLOY_ISO = '([^']+)';/)?.[1];
const DEPLOY_TS = Date.parse(DEPLOY_ISO || '');

let ROOT_TMP;
let seq = 0;

beforeAll(() => {
  ROOT_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-script-test-'));
});

afterAll(() => {
  fs.rmSync(ROOT_TMP, { recursive: true, force: true });
});

// Cada caso vive en su propia subcarpeta — así un call_scripts.json escrito
// para un test no contamina al siguiente.
function makeFixture(leads, scripts) {
  const dir = path.join(ROOT_TMP, `case-${seq++}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'setters.json');
  fs.writeFileSync(file, JSON.stringify({ leads }), 'utf8');
  if (scripts) {
    fs.writeFileSync(path.join(dir, 'call_scripts.json'), JSON.stringify({ scripts }), 'utf8');
  }
  return file;
}

function runCliJson(args) {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, ...args, '--json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

const NOW = () => new Date().toISOString();
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

describe('DEPLOY_ISO', () => {
  it('está definido en la fuente y parsea a una fecha válida', () => {
    expect(DEPLOY_ISO).toBeTruthy();
    expect(Number.isFinite(DEPLOY_TS)).toBe(true);
  });
});

describe('gate por outcome', () => {
  it('un no_answer con scriptIdsUsed no entra ni en relevantes ni en conGuion', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'no_answer', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_a'] }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.relevantes).toBe(0);
    expect(out.conGuion).toBe(0);
  });

  it('una llamada relevante sin scriptIdsUsed cuenta en relevantes pero no en conGuion', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'callback_later', channel: 'telnyx_webrtc', scriptIdsUsed: [] }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.relevantes).toBe(1);
    expect(out.conGuion).toBe(0);
  });
});

describe('conGuion / aMano / automaticas', () => {
  it('aMano excluye scriptIdsAuto===true; automaticas + aMano === conGuion', () => {
    const file = makeFixture({
      lead_auto: {
        callLog: [{ ts: NOW(), outcome: 'answered_interested', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_a'], scriptIdsAuto: true }],
      },
      lead_manual: {
        callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_b'] }],
      },
      lead_sin_guion: {
        callLog: [{ ts: NOW(), outcome: 'callback_later', channel: 'telnyx_webrtc', scriptIdsUsed: [] }],
      },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.relevantes).toBe(3);
    expect(out.conGuion).toBe(2);
    expect(out.aMano).toBe(1);
    expect(out.automaticas).toBe(1);
    expect(out.automaticas + out.aMano).toBe(out.conGuion);
  });

  it('scriptIdsAuto ausente (o distinto de true) cuenta como elegido a mano', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_a'], scriptIdsAuto: false }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.aMano).toBe(1);
    expect(out.automaticas).toBe(0);
  });
});

describe('desglose por canal', () => {
  it('separa telnyx_webrtc de todo lo demás y los dos suman el total', () => {
    const file = makeFixture({
      lead_dialer: { callLog: [{ ts: NOW(), outcome: 'answered_interested', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_a'] }] },
      lead_manual: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_b'] }] },
      lead_email: { callLog: [{ ts: NOW(), outcome: 'placeholder_sent', channel: 'email' }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.porCanal.dialer.total).toBe(1);
    expect(out.porCanal.manual.total).toBe(2);
    expect(out.porCanal.dialer.total + out.porCanal.manual.total).toBe(out.relevantes);
    expect(out.porCanal.dialer.conGuion).toBe(1);
    expect(out.porCanal.manual.conGuion).toBe(1); // solo lead_manual trae guion, lead_email no
  });
});

describe('reparto por guion', () => {
  it('deduplica ids repetidos dentro de una misma llamada', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'answered_interested', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_x', 'sc_x', 'sc_x'] }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    const g = out.porGuion.find((x) => x.id === 'sc_x');
    expect(g.manual).toBe(1);
    expect(g.automatico).toBe(0);
  });

  it('pone el label del banco de guiones cuando el archivo existe y el id sigue ahí', () => {
    const file = makeFixture(
      { lead1: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_a'] }] } },
      [{ id: 'sc_a', label: 'Apertura A' }],
    );
    const out = runCliJson(['--all', '--file', file]);
    const g = out.porGuion.find((x) => x.id === 'sc_a');
    expect(g.label).toBe('Apertura A');
  });

  it('marca (eliminado) si el id ya no está en el banco', () => {
    const file = makeFixture(
      { lead1: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_gone'] }] } },
      [],
    );
    const out = runCliJson(['--all', '--file', file]);
    const g = out.porGuion.find((x) => x.id === 'sc_gone');
    expect(g.label).toBe('(eliminado)');
  });
});

describe('ventana', () => {
  it('una llamada anterior a la ventana pedida no se cuenta; con --all sí', () => {
    const file = makeFixture({
      lead_reciente: { callLog: [{ ts: NOW(), outcome: 'answered_interested', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_a'] }] },
      lead_viejo: { callLog: [{ ts: isoAgo(30 * 86400000), outcome: 'answered_interested', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_b'] }] },
    });
    const acotado = runCliJson(['--days', '7', '--file', file]);
    expect(acotado.relevantes).toBe(1);
    const completo = runCliJson(['--all', '--file', file]);
    expect(completo.relevantes).toBe(2);
  });

  it('sin --days, el resultado es igual a --days 7 (default D-01)', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_a'] }] },
    });
    const conDefault = runCliJson(['--file', file]);
    const conSiete = runCliJson(['--days', '7', '--file', file]);
    // 'hasta' es el instante en que corrió cada invocación — puede diferir
    // en milisegundos entre las dos llamadas al CLI. 'desde' se deriva de ese
    // mismo instante (hasta - 7 días), así que difiere por lo mismo. Se
    // excluyen ambos y se compara todo lo demás (fix del flaky de reloj).
    const { hasta: h1, desde: d1, ...restoDefault } = conDefault;
    const { hasta: h2, desde: d2, ...restoSiete } = conSiete;
    expect(restoDefault).toEqual(restoSiete);
  });

  it('D-01: el default de --days es 7 en la fuente, no 30', () => {
    expect(SCRIPT_SRC).toMatch(/argOf\('--days'\) \|\| '7'/);
  });
});

describe('recorte al deploy', () => {
  it('con --days 3650 la salida marca recortado:true y desde no es anterior al DEPLOY_ISO', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'answered_interested', channel: 'telnyx_webrtc', scriptIdsUsed: ['sc_a'] }] },
    });
    const out = runCliJson(['--days', '3650', '--file', file]);
    expect(out.recortado).toBe(true);
    expect(new Date(out.desde).getTime()).toBeGreaterThanOrEqual(DEPLOY_TS);
    // la llamada reciente del fixture sigue contando: el piso recortó al
    // deploy, no descartó la ventana entera.
    expect(out.relevantes).toBe(1);
  });

  it('--all no recorta al deploy (desde es null, ventana histórica completa)', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: isoAgo(365 * 86400000), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_a'] }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.recortado).toBe(false);
    expect(out.desde).toBeNull();
    expect(out.relevantes).toBe(1);
  });
});

describe('robustez — nunca lanzar sobre data sucia', () => {
  it('snapshot inexistente: exit code distinto de 0 y el mensaje menciona pre-deploy', () => {
    const missing = path.join(ROOT_TMP, 'no-existe-' + seq++, 'setters.json');
    let threw = false;
    try {
      execFileSync(process.execPath, [SCRIPT_PATH, '--file', missing, '--all'], { encoding: 'utf8' });
    } catch (err) {
      threw = true;
      expect(err.status).not.toBe(0);
      expect(String(err.stderr)).toMatch(/pre-deploy/);
    }
    expect(threw).toBe(true);
  });

  it('un callLog que no es array se saltea sin romper', () => {
    const file = makeFixture({
      lead_roto: { callLog: 'no-es-un-array' },
      lead_ok: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_a'] }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.relevantes).toBe(1);
  });

  it('un ts inválido se saltea sin romper ni contar', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: 'no-es-una-fecha', outcome: 'hung_up', channel: 'manual', scriptIdsUsed: ['sc_a'] }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.relevantes).toBe(0);
  });

  it('un scriptIdsUsed que no es array se trata como sin guion, no rompe', () => {
    const file = makeFixture({
      lead1: { callLog: [{ ts: NOW(), outcome: 'hung_up', channel: 'manual', scriptIdsUsed: 'sc_a' }] },
    });
    const out = runCliJson(['--all', '--file', file]);
    expect(out.relevantes).toBe(1);
    expect(out.conGuion).toBe(0);
  });
});
