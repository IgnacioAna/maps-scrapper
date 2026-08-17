// Captura de la etapa de la llamada (callStage) en TODAS las superficies.
//
// Contexto (2026-08-16): la etapa se guardaba bien pero solo se podía cargar
// desde el panel de llamada en vivo y desde el Power Dialer. Quien marcaba el
// resultado desde la lista de Llamadas, desde Hoy o desde la ficha no tenía
// dónde ponerla → esa llamada nacía sin dato, y no hay recuperación posible:
// nadie vuelve a marcar un resultado ya marcado. Cobertura medida ese día
// contra la base real: 0 de 312 llamadas con outcome relevante.
//
// Estos tests son de FUENTE (mismo patrón que act-ui-whatsapp / act-ui-discard):
// protegen que el control siga siendo un builder único con N call sites, que es
// la regla que el proyecto ya aprendió a la mala cuando la lista y el grid del
// Power Dialer se desincronizaron (nota #156 de CLAUDE.md).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appJsPath = path.join(process.cwd(), 'public', 'app.js');
let appJs = '';
beforeAll(() => { appJs = fs.readFileSync(appJsPath, 'utf8'); });

function countOccurrences(str, sub) {
  let count = 0, idx = 0;
  while ((idx = str.indexOf(sub, idx)) !== -1) { count++; idx += sub.length; }
  return count;
}

describe('_stageChipsHTML — builder único, N superficies', () => {
  it('se declara UNA sola vez', () => {
    expect(countOccurrences(appJs, 'function _stageChipsHTML(')).toBe(1);
  });

  it('lo usan las 4 superficies donde se cierra una llamada', () => {
    // Power Dialer (chips), lista de Llamadas (select), Hoy (select) y la
    // ficha abierta como modal (select). El panel de llamada en vivo tiene los
    // suyos en index.html — ver el test de abajo.
    expect(countOccurrences(appJs, '_stageChipsHTML(')).toBeGreaterThanOrEqual(5); // 1 decl + 4 usos
    expect(appJs).toContain("_stageChipsHTML(lead.id)");                                  // Power Dialer
    expect(appJs).toContain("_stageChipsHTML(l.id, { variant: 'select', fontSize: 12 })"); // lista + ficha
    expect(appJs).toContain("_stageChipsHTML(l.id, { variant: 'select', fontSize: 11.5 })"); // Hoy
  });

  it('el control va junto al selector de resultado, no en otra pantalla', () => {
    // Si se separan, el SDR marca el resultado (que dispara la acción al
    // instante) sin haber pasado por la etapa.
    // El selector de resultado de la FILA de Llamadas es `_dispoSelectHTML(l.id)`
    // sin opciones; se busca el control de etapa inmediatamente anterior a él.
    const idxDispo = appJs.indexOf('_dispoSelectHTML(l.id)');
    expect(idxDispo).toBeGreaterThan(0);
    const idxStage = appJs.lastIndexOf('_stageChipsHTML(l.id', idxDispo);
    expect(idxStage).toBeGreaterThan(0);
    expect(idxDispo).toBeGreaterThan(idxStage);          // la etapa se ofrece ANTES
    expect(idxDispo - idxStage).toBeLessThan(400);        // y en el mismo bloque
  });

  it('la ficha en modal trae los dos controles; la ficha embebida en la lista no', () => {
    // En la lista, la fila de arriba ya tiene ambos: duplicarlos mostraría dos
    // controles del mismo estado. El modal de Hoy es la única superficie donde
    // el lead se ve entero sin esa fila.
    expect(appJs).toContain('opts.withDisposition ?');
    expect(appJs).toContain('_callsRenderExpandedPanel(l, { withDisposition: true })');
    expect(appJs).toContain('_callsRenderExpandedPanel(lead, { withDisposition: true })');
    // Y el render embebido de la lista sigue SIN pedirlos.
    expect(appJs).toContain("${isExpanded ? _callsRenderExpandedPanel(l) : ''}");
  });

  it('la etapa viaja en el body desde cualquier superficie', () => {
    // _dispoEnforcementBody es el helper que comparten los call sites de
    // call-disposition: si la etapa sale de ahí, sale de todos.
    const i = appJs.indexOf('function _dispoEnforcementBody(');
    const bloque = appJs.slice(i, i + 400);
    expect(bloque).toContain('_stageFor(leadId)');
    expect(bloque).toContain('body.callStage = _stage');
  });

  it('la sincronización mira el LEAD de cada control, no solo la etapa', () => {
    // Con los controles en una lista, comparar solo contra _dispoStage.stage
    // prendería el mismo valor en las 50 filas a la vez.
    const i = appJs.indexOf('function _syncStageChips(');
    const bloque = appJs.slice(i, i + 600);
    expect(bloque).toContain('dataset.lead');
    expect(bloque).toContain('_stageFor(id)');
    expect(bloque).toContain('select.stage-select');
  });

  it('guardar la disposición apaga la etapa (es de UNA llamada)', () => {
    const i = appJs.indexOf('function _dispoAfterSaved(');
    const bloque = appJs.slice(i, i + 1800);
    expect(bloque).toContain('_clearCallStage()');
  });
});

describe('_stageChipsHTML — salida', () => {
  // Se ejecuta aislado, con los mismos stubs mínimos que usa hoy-sections.
  function build() {
    const marker = 'function _stageChipsHTML(';
    const start = appJs.indexOf(marker);
    // Arrancar en la llave del CUERPO, no en la de la destructuración de la
    // firma (`{ variant = 'chips', fontSize = 12 } = {}`), que viene antes.
    let depth = 0, i = appJs.indexOf(') {', start) + 2, end = -1;
    for (; i < appJs.length; i++) {
      if (appJs[i] === '{') depth++;
      else if (appJs[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const body = appJs.slice(start, end);
    const src = `
      function escHtml(s) { return String(s == null ? '' : s); }
      let _dispoStage = null;
      function _stageCurrentLeadId() { return ''; }
      function _stageFor(id) { return (_dispoStage && _dispoStage.leadId === id) ? _dispoStage.stage : ''; }
      ${body}
      return { _stageChipsHTML, marcar: (leadId, stage) => { _dispoStage = { leadId, stage }; } };
    `;
    return new Function(src)();
  }

  it('variant select: las 3 etapas + la opción vacía, atada al lead', () => {
    const { _stageChipsHTML } = build();
    const html = _stageChipsHTML('lead_1', { variant: 'select' });
    expect(html).toContain('class="stage-select"');
    expect(html).toContain('data-lead="lead_1"');
    expect(html).toContain('value="contestador"');
    expect(html).toContain('value="recepcion"');
    expect(html).toContain('value="decisor"');
    // Asignación directa, sin toggle: un <select> no se "apaga" al re-elegir.
    expect(html).toContain('{toggle:false}');
  });

  it('variant chips: un botón por etapa, cada uno con su lead', () => {
    const { _stageChipsHTML } = build();
    const html = _stageChipsHTML('lead_2');
    expect(countOccurrences(html, 'class="stage-chip')).toBe(3);
    expect(countOccurrences(html, 'data-lead="lead_2"')).toBe(3);
  });

  it('el chip de la etapa ya elegida nace encendido, y solo ese', () => {
    const { _stageChipsHTML, marcar } = build();
    marcar('lead_3', 'decisor');
    const html = _stageChipsHTML('lead_3');
    expect(countOccurrences(html, 'is-on')).toBe(1);
    expect(html).toMatch(/is-on[^>]*data-stage="decisor"|data-stage="decisor"[^>]*is-on/);
  });

  it('un lead distinto no hereda la etapa marcada en otro', () => {
    const { _stageChipsHTML, marcar } = build();
    marcar('lead_3', 'decisor');
    expect(_stageChipsHTML('lead_4')).not.toContain('is-on');
  });

  it('escapa el id del lead en los atributos', () => {
    const { _stageChipsHTML } = build();
    // escHtml es un stub identidad acá, pero la llamada tiene que estar hecha:
    // el id se interpola dentro de atributos y de un onclick inline.
    const decl = appJs.slice(appJs.indexOf('function _stageChipsHTML('), appJs.indexOf('function _stageChipsHTML(') + 1400);
    expect(decl).toContain('escHtml(leadId');
  });
});

describe('panel de llamada en vivo (index.html)', () => {
  it('mantiene sus 3 chips de etapa', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
    expect(countOccurrences(html, 'class="stage-chip"')).toBe(3);
    expect(html).toContain("window._setCallStage(null,'decisor')"); // null = lead de la llamada activa
  });
});
