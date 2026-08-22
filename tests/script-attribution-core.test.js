// Atribución de guion (SCR-01/SCR-02, Fase 35, plan 02).
//
// Contexto (CONTEXT.md de la fase, verificado 21/08): la única vía de
// captura que existía exigía TRES acciones opcionales (llamada por WebRTC +
// abrir el panel de guiones + clickear uno) y 0 de 199 llamadas completó la
// cadena. Este plan replica la solución que ya funcionó para callStage
// (16/08, 0% -> 62% de cobertura el primer día): la llamada NACE con guion
// atribuido y hay un builder único para la segunda oportunidad de corregirlo.
//
// Dos describe blocks, mismo patrón que tests/call-stage-surfaces.test.js:
// - "fuente": aserciones sobre el texto de public/app.js (cableado real en
//   los call sites — protege que siga siendo un builder único con N usos).
// - "comportamiento": el bloque [35-02] SCR-ATTR REAL, extraído por
//   marcadores y evaluado aislado con new Function (no jsdom en el entorno).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appJsPath = path.join(process.cwd(), 'public', 'app.js');
const indexHtmlPath = path.join(process.cwd(), 'public', 'index.html');
let appJs = '';
let indexHtml = '';
beforeAll(() => {
  appJs = fs.readFileSync(appJsPath, 'utf8');
  indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
});

function countOccurrences(str, sub) {
  let count = 0, idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) { count++; idx += sub.length; }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────
describe('SCR-ATTR — fuente (cableado en public/app.js)', () => {
  it('_scriptSelectHTML se declara UNA sola vez', () => {
    expect(countOccurrences(appJs, 'function _scriptSelectHTML(')).toBe(1);
  });

  it('_telnyxCallState.scriptIdsUsed NO existe más en el archivo (regresión del estado duplicado)', () => {
    expect(countOccurrences(appJs, '_telnyxCallState.scriptIdsUsed')).toBe(0);
  });

  it('_dispoEnforcementBody inyecta scriptIdsUsed — mismo helper que comparten los 6 call sites', () => {
    const i = appJs.indexOf('function _dispoEnforcementBody(');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 700);
    expect(bloque).toContain('_scriptIdsFor(leadId)');
    expect(bloque).toContain('body.scriptIdsUsed');
    expect(bloque).toContain('body.scriptIdsAuto = true');
  });

  it('_dispoAfterSaved apaga la atribución al guardar (es de UNA llamada)', () => {
    const i = appJs.indexOf('function _dispoAfterSaved(');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 2000);
    expect(bloque).toContain('_clearCallScript()');
  });

  it('_startTelnyxCall siembra el default con auto:true al iniciar la llamada', () => {
    const i = appJs.indexOf("window._startTelnyxCall = async");
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 6200);
    expect(bloque).toContain('_clearCallScript();');
    expect(bloque).toContain('_scriptDefaultId(), { auto: true }');
    // Re-siembra tardía dentro del .then de _ensureCallScripts (banco no
    // estaba en cache todavía) — SOLO si el lead sigue sin atribución.
    expect(bloque).toContain('_ensureCallScripts().then(');
    expect(bloque).toContain('!_scriptIdsFor(leadId).length');
  });

  it('_selectScript ya no hace push a un array propio y escribe en el estado único con append:true', () => {
    const i = appJs.indexOf('function _selectScript(');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 1100);
    expect(bloque).not.toContain('.scriptIdsUsed.push(');
    expect(bloque).toContain('window._setCallScript(');
    expect(bloque).toContain('append: true');
  });

  it('_renderScriptButtons ya no declara triggerOrder/triggerLabels locales (usa las constantes del bloque)', () => {
    const i = appJs.indexOf('function _renderScriptButtons(');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 3200);
    expect(bloque).not.toContain("const triggerOrder = [");
    expect(bloque).not.toContain("const triggerLabels = {");
    expect(bloque).toContain('_SCRIPT_TRIGGER_ORDER.indexOf(');
    expect(bloque).toContain('_SCRIPT_TRIGGER_LABELS[trigger]');
  });

  it('_scriptOptionsHTML y _scriptSelectHTML escapan label/id con escHtml (T-35-05)', () => {
    const i1 = appJs.indexOf('function _scriptOptionsHTML(');
    expect(i1).toBeGreaterThan(0);
    const b1 = appJs.slice(i1, i1 + 1400);
    expect(b1).toContain('escHtml(s.label)');
    expect(b1).toContain('escHtml(s.id)');

    const i2 = appJs.indexOf('function _scriptSelectHTML(');
    expect(i2).toBeGreaterThan(0);
    const b2 = appJs.slice(i2, i2 + 900);
    expect(b2).toContain('escHtml(leadId');
  });

  it('public/index.html tiene el selector del panel de llamada y el cache-buster de app.js cambió', () => {
    expect(indexHtml).toContain('telnyx-call-script-wrap');
    expect(indexHtml).toMatch(/app\.js\?v=\d{8}[a-z]?/);
    // Valor previo al plan (35-01 lo dejó en 20260817d) — no puede seguir ahí.
    expect(indexHtml).not.toContain('app.js?v=20260817d');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('SCR-ATTR — comportamiento (bloque real, extraído y aislado)', () => {
  // Mismo banco para todos los tests: rules y before_call PRIMERO a
  // propósito (para probar que la precedencia los saltea aunque estén
  // primeros en el array), 2 opener, 1 gatekeeper. Un label con comillas y
  // '<' para el caso de escape (verificado a nivel de fuente arriba, acá
  // solo se chequea que no rompe la salida).
  const BANK = [
    { id: 'sc_rules', trigger: 'rules', label: 'Reglas PACE' },
    { id: 'sc_before', trigger: 'before_call', label: 'Antes de llamar' },
    { id: 'sc_opener_a', trigger: 'opener', label: 'Apertura A' },
    { id: 'sc_opener_b', trigger: 'opener', label: 'Apertura B' },
    { id: 'sc_gate', trigger: 'gatekeeper', label: 'Recepción "difícil" & <compleja>' },
  ];

  // Extrae el bloque REAL por marcadores (más robusto que balancear llaves,
  // mismo criterio que [28-01] DTPICKER-PURE) y lo evalúa con new Function,
  // con los stubs mínimos que el propio plan permite: escHtml identidad,
  // _callScriptsCache mutable, _stageCurrentLeadId controlado, document con
  // querySelectorAll -> [], localStorage sobre un Map, window vacío,
  // _loadCallScripts async no-op.
  function build() {
    const startMarker = '// ─── [35-02] SCR-ATTR: INICIO ───';
    const endMarker = '// ─── [35-02] SCR-ATTR: FIN ───';
    const start = appJs.indexOf(startMarker);
    const end = appJs.indexOf(endMarker);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = appJs.slice(start, end);
    const src = `
      function escHtml(s) { return String(s == null ? '' : s); }
      let _callScriptsCache = [];
      let _fixedLeadId = '';
      function _stageCurrentLeadId() { return _fixedLeadId; }
      const document = { querySelectorAll: () => [] };
      const _storeMap = new Map();
      const localStorage = {
        getItem(k) { return _storeMap.has(k) ? _storeMap.get(k) : null; },
        setItem(k, v) { _storeMap.set(k, String(v)); },
        removeItem(k) { _storeMap.delete(k); },
      };
      const window = {};
      async function _loadCallScripts() {}
      ${block}
      return {
        _scriptDefaultId, _scriptSelectHTML, _scriptOptionsHTML,
        _scriptIdsFor, _scriptPrimaryFor, _scriptIsAuto,
        setCall: window._setCallScript,
        setBanco: (arr) => { _callScriptsCache = arr; },
        setLead: (id) => { _fixedLeadId = id; },
        storage: localStorage,
      };
    `;
    return new Function(src)();
  }

  describe('_scriptDefaultId — precedencia', () => {
    it('devuelve el último guion elegido a mano si sigue en el banco y no es meta', () => {
      const h = build();
      h.setBanco(BANK);
      h.storage.setItem('scm_last_script_', 'sc_opener_b');
      expect(h._scriptDefaultId()).toBe('sc_opener_b');
    });

    it('si ese último ya no existe (guion borrado), cae al primer opener', () => {
      const h = build();
      h.setBanco(BANK);
      h.storage.setItem('scm_last_script_', 'sc_ya_no_existe');
      expect(h._scriptDefaultId()).toBe('sc_opener_a');
    });

    it('sin último guardado, devuelve el primer opener — nunca rules ni before_call, aunque estén primeros en el banco', () => {
      const h = build();
      h.setBanco(BANK); // rules y before_call están en los índices 0 y 1
      expect(h._scriptDefaultId()).toBe('sc_opener_a');
    });

    it('si el último guardado es meta (rules/before_call), lo ignora igual que si no existiera', () => {
      const h = build();
      h.setBanco(BANK);
      h.storage.setItem('scm_last_script_', 'sc_before');
      expect(h._scriptDefaultId()).toBe('sc_opener_a');
    });

    it('con el banco vacío devuelve "" y sembrar con eso no crea estado', () => {
      const h = build();
      h.setBanco([]);
      expect(h._scriptDefaultId()).toBe('');
      h.setCall('lead_empty', h._scriptDefaultId(), { auto: true });
      expect(h._scriptIdsFor('lead_empty')).toEqual([]);
    });
  });

  describe('_setCallScript — reemplazo vs append, y el flag auto', () => {
    it('sin append REEMPLAZA (queda un solo id)', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { auto: true });
      h.setCall('lead_a', 'sc_gate');
      expect(h._scriptIdsFor('lead_a')).toEqual(['sc_gate']);
    });

    it('con append:true SUMA sin duplicar', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { append: true });
      h.setCall('lead_a', 'sc_gate', { append: true });
      expect(h._scriptIdsFor('lead_a')).toEqual(['sc_opener_a', 'sc_gate']);
      h.setCall('lead_a', 'sc_gate', { append: true }); // duplicado, no debe repetirse
      expect(h._scriptIdsFor('lead_a')).toEqual(['sc_opener_a', 'sc_gate']);
    });

    it('auto nace true con {auto:true} y queda en false para siempre apenas hay una elección humana, incluso con otro append auto:true después', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { auto: true });
      expect(h._scriptIsAuto('lead_a')).toBe(true);
      h.setCall('lead_a', 'sc_gate', { append: true }); // elección humana
      expect(h._scriptIsAuto('lead_a')).toBe(false);
      h.setCall('lead_a', 'sc_opener_b', { append: true, auto: true }); // re-siembra tardía
      expect(h._scriptIsAuto('lead_a')).toBe(false); // sigue apagado para siempre
    });

    it('la atribución es por lead: marcar en lead_a no afecta a lead_b, y atribuir en lead_b descarta el estado de lead_a', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { auto: true });
      expect(h._scriptIdsFor('lead_b')).toEqual([]);
      h.setCall('lead_b', 'sc_gate', { auto: true });
      expect(h._scriptIdsFor('lead_a')).toEqual([]); // descartado al atribuir en otro lead
      expect(h._scriptIdsFor('lead_b')).toEqual(['sc_gate']);
    });

    it('_setCallScript(id, "") limpia solo ese lead', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { auto: true });
      h.setCall('lead_a', 'sc_gate', { append: true });
      h.setCall('lead_a', '');
      expect(h._scriptIdsFor('lead_a')).toEqual([]);
    });

    it('limpiar un lead distinto al del estado actual no lo toca', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { auto: true });
      h.setCall('lead_b', ''); // lead_b no tiene estado; no debe descartar el de lead_a
      expect(h._scriptIdsFor('lead_a')).toEqual(['sc_opener_a']);
    });

    it('una elección humana persiste el id en localStorage; una automática NO', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_a', 'sc_opener_a', { auto: true });
      expect(h.storage.getItem('scm_last_script_')).toBeNull();
      h.setCall('lead_a', 'sc_gate', { append: true });
      expect(h.storage.getItem('scm_last_script_')).toBe('sc_gate');
    });

    it('leadId falsy resuelve al lead en foco vía _stageCurrentLeadId', () => {
      const h = build();
      h.setBanco(BANK);
      h.setLead('lead_activo');
      h.setCall(null, 'sc_opener_a', { auto: true });
      expect(h._scriptIdsFor('lead_activo')).toEqual(['sc_opener_a']);
    });
  });

  describe('_scriptOptionsHTML — salida', () => {
    it('emite la option vacía, agrupa por optgroup en el orden de _SCRIPT_TRIGGER_ORDER, y excluye los triggers meta', () => {
      const h = build();
      h.setBanco(BANK);
      const html = h._scriptOptionsHTML('');
      expect(html).toContain('<option value="">— Guion —</option>');
      // meta (rules/before_call) nunca aparece como opción seleccionable
      expect(html).not.toContain('sc_rules');
      expect(html).not.toContain('sc_before');
      // gatekeeper (índice 1 en _SCRIPT_TRIGGER_ORDER) va ANTES que opener (índice 2)
      const idxGate = html.indexOf('Recepción');
      const idxOpener = html.indexOf('Apertura');
      expect(idxGate).toBeGreaterThan(0);
      expect(idxOpener).toBeGreaterThan(0);
      expect(idxGate).toBeLessThan(idxOpener);
      // no rompe con comillas/< en el label (identidad en este harness — el
      // escapado real se verifica a nivel de fuente, arriba)
      expect(html).toContain('<optgroup label="Recepción">');
    });

    it('marca "selected" en el id pasado', () => {
      const h = build();
      h.setBanco(BANK);
      const html = h._scriptOptionsHTML('sc_opener_b');
      expect(html).toContain('value="sc_opener_b" selected');
    });
  });

  describe('_scriptSelectHTML — salida', () => {
    it('emite class="script-select", data-lead con el lead y un onchange que llama window._setCallScript', () => {
      const h = build();
      h.setBanco(BANK);
      const html = h._scriptSelectHTML('lead_9');
      expect(html).toContain('class="script-select"');
      expect(html).toContain('data-lead="lead_9"');
      expect(html).toContain("onchange=\"window._setCallScript('lead_9', this.value)\"");
    });

    it('variant "call" usa la paleta oscura del panel de llamada', () => {
      const h = build();
      h.setBanco(BANK);
      const html = h._scriptSelectHTML('lead_9', { variant: 'call' });
      expect(html).toContain('rgba(255,255,255,0.05)');
    });

    it('refleja el guion ya atribuido a ese lead como seleccionado', () => {
      const h = build();
      h.setBanco(BANK);
      h.setCall('lead_9', 'sc_opener_a', { auto: true });
      const html = h._scriptSelectHTML('lead_9');
      expect(html).toContain('value="sc_opener_a" selected');
    });
  });
});
