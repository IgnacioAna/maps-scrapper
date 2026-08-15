import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-mxphones-'));
process.env.DATA_DIR = tmpData;
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.MERCURY_API_KEY = '';
process.env.QWEN_API_KEY = '';

let _repairMexicanPhone;

beforeAll(async () => {
  fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({ users: [], sessions: [], invites: [] }));
  fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({ setters: [], leads: {}, calendar: [] }));
  fs.writeFileSync(path.join(tmpData, 'history.json'), JSON.stringify({ entries: {} }));
  await import('../index.js');
  _repairMexicanPhone = globalThis.__phoneRepair._repairMexicanPhone;
});

describe('_repairMexicanPhone', () => {
  it('un número de San Diego publicado por una clínica de Tijuana se arregla con +1, NO con +52', () => {
    // Caso real de la base: 67 leads de Tijuana con área 619 (San Diego).
    expect(_repairMexicanPhone('+6195029242', 'Tijuana')).toBe('+16195029242');
    expect(_repairMexicanPhone('+8583334532', 'Tijuana')).toBe('+18583334532');
    expect(_repairMexicanPhone('+7605044588', 'Tijuana')).toBe('+17605044588');
    expect(_repairMexicanPhone('+9282646204', 'Tijuana')).toBe('+19282646204');
  });

  it('un número local mexicano recupera el +52 cuando la LADA coincide con la ciudad', () => {
    expect(_repairMexicanPhone('+6647480639', 'Tijuana')).toBe('+526647480639');      // LADA 664
    expect(_repairMexicanPhone('+3327835078', 'Guadalajara')).toBe('+523327835078');  // LADA 33 + 8
    expect(_repairMexicanPhone('+8183123383', 'Monterrey')).toBe('+528183123383');    // LADA 81 + 8
    expect(_repairMexicanPhone('+2229668323', 'Puebla')).toBe('+522229668323');       // LADA 222 + 7
  });

  it('la ciudad viene con acentos o mayúsculas y se resuelve igual', () => {
    expect(_repairMexicanPhone('+9982345678', 'Cancún')).toBe('+529982345678');
    expect(_repairMexicanPhone('+5512345678', 'Ciudad de México')).toBe('+525512345678');
  });

  it('NO adivina: prefijo ambiguo, ciudad desconocida o largo que no cierra quedan sin tocar', () => {
    // 832 es LADA de Tamaulipas Y área de Houston: sin respaldo de la ciudad, no se decide.
    expect(_repairMexicanPhone('+8323140360', 'Monterrey')).toBeNull();
    // Toll-free: 800/888 existen en los dos países.
    expect(_repairMexicanPhone('+8006813340', 'Tijuana')).toBeNull();
    expect(_repairMexicanPhone('+8883100227', 'Tijuana')).toBeNull();
    // Ciudad que no está en la tabla.
    expect(_repairMexicanPhone('+3327835078', 'Pueblo Nuevo')).toBeNull();
    // LADA de la ciudad correcta pero el largo no cierra (33 pide 8 dígitos detrás).
    expect(_repairMexicanPhone('+333123456', 'Guadalajara')).toBeNull();
  });

  it('saca el "1" del formato viejo de móvil mexicano (52 + 1 + 10)', () => {
    expect(_repairMexicanPhone('+5213311306088', 'Guadalajara')).toBe('+523311306088');
    expect(_repairMexicanPhone('+5215510160260', 'Puebla')).toBe('+525510160260');   // móvil de CDMX en un lead de Puebla: el 52 ya desambigua, no se exige la ciudad
    expect(_repairMexicanPhone('+5211011306088', 'Guadalajara')).toBeNull();         // el nacional arranca en 1: no es un número real
  });

  it('no toca lo que ya está bien ni lo que está truncado', () => {
    expect(_repairMexicanPhone('+528449734318', 'Saltillo')).toBeNull(); // 52+10, correcto
    expect(_repairMexicanPhone('+19282481492', 'Tijuana')).toBeNull();   // +1 válido
    expect(_repairMexicanPhone('+526347035', 'Tijuana')).toBeNull();     // 9 dígitos: roto sin arreglo
    expect(_repairMexicanPhone('', 'Tijuana')).toBeNull();
  });

  it('es idempotente: el resultado ya reparado no vuelve a cambiar', () => {
    const fix = _repairMexicanPhone('+6195029242', 'Tijuana');
    expect(_repairMexicanPhone(fix, 'Tijuana')).toBeNull();
    const fix2 = _repairMexicanPhone('+6647480639', 'Tijuana');
    expect(_repairMexicanPhone(fix2, 'Tijuana')).toBeNull();
  });
});
