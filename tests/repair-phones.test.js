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

let _repairMexicanPhone, _repairGenericPhone, _repairLeadPhone;

beforeAll(async () => {
  fs.writeFileSync(path.join(tmpData, 'auth.json'), JSON.stringify({ users: [], sessions: [], invites: [] }));
  fs.writeFileSync(path.join(tmpData, 'setters.json'), JSON.stringify({ setters: [], leads: {}, calendar: [] }));
  fs.writeFileSync(path.join(tmpData, 'history.json'), JSON.stringify({ entries: {} }));
  await import('../index.js');
  ({ _repairMexicanPhone, _repairGenericPhone, _repairLeadPhone } = globalThis.__phoneRepair);
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

describe('_repairGenericPhone — resto de los países', () => {
  it('nacional sin código de país: España (9 dígitos) y Costa Rica (8)', () => {
    expect(_repairGenericPhone('605 14 00 77', 'España')).toBe('+34605140077');   // móvil
    expect(_repairGenericPhone('963 32 00 07', 'España')).toBe('+34963320007');   // fijo
    expect(_repairGenericPhone('640689468', 'España')).toBe('+34640689468');
    expect(_repairGenericPhone('55059966', 'Costa Rica')).toBe('+50655059966');
  });

  it('cae el 0 de troncal: Ecuador y Uruguay', () => {
    expect(_repairGenericPhone('099 583 9310', 'Ecuador')).toBe('+593995839310');
    expect(_repairGenericPhone('+598097444555', 'Uruguay')).toBe('+59897444555');
  });

  it('Colombia con basura concatenada: se recorta al celular real', () => {
    expect(_repairGenericPhone('5731750311112202033202020200', 'Colombia')).toBe('+573175031111');
    expect(_repairGenericPhone('57320286003220202020202020312033', 'Colombia')).toBe('+573202860032');
    expect(_repairGenericPhone('+57313203656082', 'Colombia')).toBe('+573132036560');
    // Si lo que queda al recortar NO es un celular válido, no se recorta.
    expect(_repairGenericPhone('+5713434530255', 'Colombia')).toBeNull();
  });

  it('línea de EE.UU. en una clínica latinoamericana (turismo dental)', () => {
    expect(_repairGenericPhone('+7866860703', 'Costa Rica')).toBe('+17866860703'); // Miami
    expect(_repairGenericPhone('+8662181036', 'Costa Rica')).toBe('+18662181036'); // toll-free
    expect(_repairGenericPhone('+8569869465', 'Colombia')).toBe('+18569869465');   // New Jersey
  });

  it('la regla del país corre ANTES que la de EE.UU.: un celular colombiano suelto también mide 10 dígitos', () => {
    // 3186944802 es celular colombiano, no un área NANP. Va por _repairColombianPhone.
    expect(_repairLeadPhone({ phone: '+3186944802', country: 'Colombia' })).toBe('+573186944802');
  });

  it('NO repara lo que no tiene arreglo honesto', () => {
    // Chile 600: número de servicio nacional, inalcanzable desde el exterior.
    expect(_repairGenericPhone('+566006560240', 'Chile')).toBeNull();
    // Perú 51 + 7 dígitos: falta UN dígito, suponerlo sería inventarlo.
    expect(_repairGenericPhone('514856001', 'Perú')).toBeNull();
    // Uruguay con un número brasileño pegado detrás del 598.
    expect(_repairGenericPhone('5985511989395459', 'Uruguay')).toBeNull();
    // País mal cargado: el número está bien, la etiqueta no. No es este arreglo.
    expect(_repairGenericPhone('+33628270118', 'España')).toBeNull();
    expect(_repairGenericPhone('+584144713978', 'España')).toBeNull();
  });

  it('no toca lo que ya está en E.164 correcto', () => {
    expect(_repairGenericPhone('+34951818818', 'España')).toBeNull();
    expect(_repairGenericPhone('+50661443030', 'Costa Rica')).toBeNull();
    expect(_repairGenericPhone('+573222561204', 'Colombia')).toBeNull();
    expect(_repairGenericPhone('+59898500850', 'Uruguay')).toBeNull();
  });

  it('es idempotente en todos los países', () => {
    for (const [phone, country] of [['605 14 00 77', 'España'], ['55059966', 'Costa Rica'],
      ['099 583 9310', 'Ecuador'], ['5731750311112202033202020200', 'Colombia'],
      ['+7866860703', 'Costa Rica']]) {
      const fix = _repairGenericPhone(phone, country);
      expect(fix).toBeTruthy();
      expect(_repairGenericPhone(fix, country)).toBeNull();
    }
  });
});
