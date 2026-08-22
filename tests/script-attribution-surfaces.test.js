// Captura de la atribución de guion (scriptIdsUsed) en TODAS las superficies.
//
// Contexto (2026-08-21/22): la captura de guion existe hace tiempo pero exige
// TRES condiciones opcionales (llamar por WebRTC, abrir el panel de guiones,
// clickear uno adentro) — medido contra la base real: 0 de 199 llamadas
// completaron la cadena. El plan 35-02 atacó la causa (la llamada nace con
// guion atribuido, siembra automática) y dejó un builder único
// (_scriptSelectHTML) para la segunda oportunidad. Este plan (35-03) cablea
// ese builder a las cuatro superficies donde ya vive el control de etapa —
// exactamente el patrón que hizo pasar callStage de 0 a 62% de cobertura el
// primer día (16/08).
//
// Estos tests son de FUENTE (mismo patrón que call-stage-surfaces.test.js):
// protegen que el control siga siendo un builder único con N call sites, que
// es la regla que el proyecto ya aprendió a la mala cuando la lista y el
// grid del Power Dialer se desincronizaron (nota #156 de CLAUDE.md). No
// duplican los tests de comportamiento del builder ni del estado de
// atribución — esos viven en tests/script-attribution-core.test.js (35-02).
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

describe('_scriptSelectHTML — builder único, N superficies', () => {
  it('se declara UNA sola vez', () => {
    expect(countOccurrences(appJs, 'function _scriptSelectHTML(')).toBe(1);
  });

  it('lo usan las 4 superficies nuevas + el panel de llamada que dejó 35-02', () => {
    // 1 declaración + 4 call sites de este plan (Hoy, Power Dialer, ficha
    // modal, lista de Llamadas) + 1 del panel de llamada en vivo (35-02).
    expect(countOccurrences(appJs, '_scriptSelectHTML(')).toBeGreaterThanOrEqual(6);
    // Los cuatro call sites nuevos pasan SIEMPRE un id de lead explícito —
    // nunca `_scriptSelectHTML(null` ni `_scriptSelectHTML()`: en una lista
    // de 50 filas, `null` (= "el lead en foco") apuntaría todas al mismo.
    expect(countOccurrences(appJs, '_scriptSelectHTML(l.id')).toBeGreaterThanOrEqual(3);   // Hoy, ficha modal, lista
    expect(countOccurrences(appJs, '_scriptSelectHTML(lead.id')).toBeGreaterThanOrEqual(1); // Power Dialer
    expect(appJs).not.toContain('_scriptSelectHTML(null');
    expect(appJs).not.toContain('_scriptSelectHTML()');
  });

  it('en la fila de la lista de Llamadas, el guion se ofrece ANTES del resultado y en el mismo bloque', () => {
    // El selector de resultado de la FILA de Llamadas es `_dispoSelectHTML(l.id)`
    // sin opciones; se busca el control de guion inmediatamente anterior.
    const idxDispo = appJs.indexOf('_dispoSelectHTML(l.id)');
    expect(idxDispo).toBeGreaterThan(0);
    const idxScript = appJs.lastIndexOf('_scriptSelectHTML(l.id', idxDispo);
    expect(idxScript).toBeGreaterThan(0);
    expect(idxDispo).toBeGreaterThan(idxScript);          // el guion se ofrece ANTES
    expect(idxDispo - idxScript).toBeLessThan(400);        // y en el mismo bloque
  });

  it('en la fila de Hoy, el guion se ofrece ANTES del resultado y en el mismo bloque', () => {
    const idxDispo = appJs.indexOf('_dispoSelectHTML(l.id, { minWidth: 150');
    expect(idxDispo).toBeGreaterThan(0);
    const idxScript = appJs.lastIndexOf('_scriptSelectHTML(l.id', idxDispo);
    expect(idxScript).toBeGreaterThan(0);
    expect(idxDispo).toBeGreaterThan(idxScript);
    expect(idxDispo - idxScript).toBeLessThan(400);
  });

  it('la ficha en modal trae el control; la ficha embebida en la lista no', () => {
    // Mismo criterio ya probado con la etapa: en la lista, la fila de arriba
    // ya tiene el control — duplicarlo en el chevron mostraría dos controles
    // del mismo estado en pantalla. El modal de Hoy es la única superficie
    // donde el lead se ve entero sin esa fila.
    expect(appJs).toContain('opts.withDisposition ?');
    expect(appJs).toContain("_callsRenderExpandedPanel(l, { withDisposition: true })");
    expect(appJs).toContain("_callsRenderExpandedPanel(lead, { withDisposition: true })");
    // Y el render embebido de la lista sigue SIN pedirlos (etapa NI guion).
    expect(appJs).toContain("${isExpanded ? _callsRenderExpandedPanel(l) : ''}");
  });

  it('loadHoyView asegura el banco de guiones al abrir la vista', () => {
    const i = appJs.indexOf('async function loadHoyView() {');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 700);
    expect(bloque).toContain('_ensureCallScripts()');
  });

  it('loadCallsView asegura el banco de guiones al abrir la vista', () => {
    const i = appJs.indexOf('async function loadCallsView() {');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 500);
    expect(bloque).toContain('_ensureCallScripts()');
  });

  it('regresión: los 4 call sites de _stageChipsHTML siguen existiendo', () => {
    // Este plan no desplaza ni pisa el control de etapa — se le agrega el de
    // guion al lado, siempre antes del selector de resultado.
    expect(countOccurrences(appJs, '_stageChipsHTML(')).toBeGreaterThanOrEqual(5); // 1 decl + 4 usos
    expect(appJs).toContain("_stageChipsHTML(lead.id)");
    expect(appJs).toContain("_stageChipsHTML(l.id, { variant: 'select', fontSize: 12 })");
    expect(appJs).toContain("_stageChipsHTML(l.id, { variant: 'select', fontSize: 11.5 })");
  });
});

describe('vista "Guiones de llamada" — el banner dice la verdad nueva', () => {
  it('_loadScriptMeasure distingue cobertura manual de automática', () => {
    const i = appJs.indexOf('async function _loadScriptMeasure(');
    expect(i).toBeGreaterThan(0);
    const bloque = appJs.slice(i, i + 4000);
    expect(bloque).toContain('withScriptsManual');
  });

  it('ya no afirma que el guion se registra solo abriendo el panel', () => {
    expect(appJs).not.toContain('se registra cuando se abre desde el panel');
  });

  it('el bloque de guiones no depende de que la cobertura de etapa llegue a 100%', () => {
    // Antes: `(cov.withStagePct == null || cov.withStagePct < 100) ? ... : ''`
    // envolvía TODO el banner (etapa + guion) — con el default automático de
    // 35-02 la cobertura de guion iba a llegar a ~100% enseguida y el banner
    // entero habría desaparecido justo cuando el dato manual importa. Ahora
    // la condición de guion es independiente (se apoya en cov.calls).
    const i = appJs.indexOf('async function _loadScriptMeasure(');
    const bloque = appJs.slice(i, i + 4000);
    expect(bloque).toContain('const scriptLine');
    expect(bloque).toContain('!cov.calls');
  });
});
