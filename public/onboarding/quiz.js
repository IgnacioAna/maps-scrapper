// Quiz del onboarding SCM — se inyecta al final de cada módulo HTML.
// Lee /onboarding/quiz-data.json, renderiza intro → preguntas → resultado.
// Aprueba ≥4/5 → marca módulo como leído en localStorage + postMessage al wrapper.

(function() {
  'use strict';

  const PROGRESS_KEY = 'scm_onboarding_progress';
  const ATTEMPTS_KEY = 'scm_onboarding_quiz_attempts';
  const PASS_THRESHOLD = 4;

  const match = window.location.pathname.match(/modulo(\d+)\.html/);
  if (!match) return;
  const N = parseInt(match[1], 10);

  function getJSON(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
  function setJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  function markModuleRead() {
    const p = getJSON(PROGRESS_KEY); p[N] = true; setJSON(PROGRESS_KEY, p);
    try { window.parent.postMessage({ type: 'scm_quiz_passed', module: N }, '*'); } catch {}
  }

  function saveAttempt(score, passed) {
    const a = getJSON(ATTEMPTS_KEY);
    const key = 'modulo' + N;
    if (!a[key]) a[key] = { intentos: 0, aprobado: false, ultimo_score: 0 };
    a[key].intentos += 1;
    a[key].ultimo_score = score;
    if (passed) a[key].aprobado = true;
    setJSON(ATTEMPTS_KEY, a);
  }

  // Estilos del bloque (matchea los design tokens de cada módulo)
  const css = `
    .scm-quiz-section { max-width: 720px; margin: 64px auto 80px; padding: 0 24px; font-family: 'Inter', -apple-system, sans-serif; }
    .scm-quiz-card {
      background: var(--bg-card, #161B22);
      border: 1px solid var(--border, #21262D);
      border-radius: 16px;
      padding: 32px;
      position: relative;
    }
    .scm-quiz-card.intro { background: linear-gradient(135deg, rgba(167,139,250,0.08), rgba(167,139,250,0.02)); border-color: rgba(167,139,250,0.3); }
    .scm-quiz-kicker { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--violet, #A78BFA); font-weight: 700; margin-bottom: 12px; }
    .scm-quiz-title { font-size: 24px; font-weight: 700; color: var(--text, #E6EDF3); margin: 0 0 12px; line-height: 1.2; }
    .scm-quiz-desc { color: var(--text-soft, #B8C2CC); font-size: 15px; line-height: 1.6; margin: 0 0 24px; }
    .scm-quiz-btn {
      display: inline-flex; align-items: center; gap: 10px;
      padding: 13px 24px; background: var(--violet, #A78BFA); color: #0E1117;
      border: none; border-radius: 10px; font-weight: 600; font-size: 14px;
      cursor: pointer; font-family: inherit; transition: all 0.2s;
    }
    .scm-quiz-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(167,139,250,0.3); }
    .scm-quiz-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; box-shadow: none; }
    .scm-quiz-btn.secondary { background: transparent; color: var(--violet, #A78BFA); border: 1px solid var(--border, #21262D); }
    .scm-quiz-btn.secondary:hover { background: var(--violet-bg, rgba(167,139,250,0.08)); border-color: var(--violet, #A78BFA); }

    .scm-question { background: var(--bg-card, #161B22); border: 1px solid var(--border, #21262D); border-radius: 14px; padding: 24px; margin-bottom: 16px; }
    .scm-question.failed { border-color: rgba(248,81,73,0.4); background: rgba(248,81,73,0.04); }
    .scm-question-num { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--violet, #A78BFA); font-weight: 700; margin-bottom: 8px; }
    .scm-question-text { font-size: 17px; font-weight: 600; color: var(--text, #E6EDF3); margin: 0 0 18px; line-height: 1.4; }
    .scm-options { display: flex; flex-direction: column; gap: 10px; }
    .scm-option {
      display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px;
      border: 1px solid var(--border, #21262D); border-radius: 10px;
      cursor: pointer; transition: all 0.15s;
      color: var(--text-soft, #B8C2CC); font-size: 14px; line-height: 1.5;
    }
    .scm-option:hover { border-color: var(--violet, #A78BFA); background: var(--violet-bg, rgba(167,139,250,0.05)); color: var(--text, #E6EDF3); }
    .scm-option.selected { border-color: var(--violet, #A78BFA); background: var(--violet-bg-hover, rgba(167,139,250,0.12)); color: var(--text, #E6EDF3); }
    .scm-option.correct { border-color: var(--green, #3FB950); background: rgba(63,185,80,0.08); color: var(--text, #E6EDF3); }
    .scm-option.incorrect { border-color: var(--rose, #F85149); background: rgba(248,81,73,0.08); color: var(--text, #E6EDF3); }
    .scm-option input { display: none; }
    .scm-option .scm-radio {
      flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid var(--border, #21262D); margin-top: 2px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .scm-option.selected .scm-radio { border-color: var(--violet, #A78BFA); }
    .scm-option.selected .scm-radio::after { content: ''; width: 8px; height: 8px; background: var(--violet, #A78BFA); border-radius: 50%; }
    .scm-option.correct .scm-radio { border-color: var(--green, #3FB950); }
    .scm-option.correct .scm-radio::after { content: '✓'; color: var(--green, #3FB950); font-size: 14px; font-weight: 700; }
    .scm-option.incorrect .scm-radio { border-color: var(--rose, #F85149); }
    .scm-option.incorrect .scm-radio::after { content: '✗'; color: var(--rose, #F85149); font-size: 14px; font-weight: 700; }

    .scm-explain { margin-top: 14px; padding: 12px 16px; background: rgba(167,139,250,0.06); border-left: 3px solid var(--violet, #A78BFA); border-radius: 6px; color: var(--text-soft, #B8C2CC); font-size: 13px; line-height: 1.6; }
    .scm-explain strong { color: var(--text, #E6EDF3); }

    .scm-result { padding: 32px; border-radius: 16px; text-align: center; margin-bottom: 24px; }
    .scm-result.passed { background: linear-gradient(135deg, rgba(63,185,80,0.1), rgba(63,185,80,0.02)); border: 1px solid rgba(63,185,80,0.3); }
    .scm-result.failed { background: linear-gradient(135deg, rgba(210,153,34,0.1), rgba(210,153,34,0.02)); border: 1px solid rgba(210,153,34,0.3); }
    .scm-result-icon { font-size: 48px; margin-bottom: 12px; line-height: 1; }
    .scm-result-title { font-size: 22px; font-weight: 700; color: var(--text, #E6EDF3); margin: 0 0 6px; }
    .scm-result-score { font-size: 14px; color: var(--text-soft, #B8C2CC); margin: 0 0 20px; }

    .scm-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 16px; }
    .scm-quiz-empty { color: var(--text-mute, #8B949E); font-style: italic; text-align: center; padding: 24px; }
    .scm-submit-bar { position: sticky; bottom: 16px; padding: 16px; background: var(--bg-card, #161B22); border: 1px solid var(--border, #21262D); border-radius: 12px; margin-top: 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .scm-progress-text { font-size: 13px; color: var(--text-soft, #B8C2CC); }
  `;

  function injectStyles() {
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }

  function escHtml(str) { return String(str || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  let quizData = null;
  let preguntas = [];
  let respuestas = []; // index seleccionado por pregunta, null si no contestada
  let rootEl = null;

  function renderIntro() {
    if (!preguntas.length) {
      rootEl.innerHTML = `
        <div class="scm-quiz-card intro">
          <div class="scm-quiz-kicker">🎯 Quiz del módulo</div>
          <h2 class="scm-quiz-title">Quiz en preparación</h2>
          <p class="scm-quiz-desc">Las preguntas de este módulo todavía no están cargadas. Volvé pronto. Mientras tanto, podés releer el contenido o pasar al siguiente módulo.</p>
        </div>`;
      return;
    }
    const attempts = getJSON(ATTEMPTS_KEY)['modulo' + N];
    const yaAprobado = attempts && attempts.aprobado;
    rootEl.innerHTML = `
      <div class="scm-quiz-card intro">
        <div class="scm-quiz-kicker">🎯 Quiz del módulo</div>
        <h2 class="scm-quiz-title">${yaAprobado ? '¡Ya aprobaste este módulo!' : 'Probá lo que aprendiste'}</h2>
        <p class="scm-quiz-desc">${yaAprobado
          ? 'Última nota: ' + (attempts.ultimo_score || 0) + '/5 · ' + (attempts.intentos || 1) + ' intento' + ((attempts.intentos || 1) > 1 ? 's' : '') + '. Podés volver a hacerlo si querés.'
          : 'Para marcar este módulo como completado, contestá las ' + preguntas.length + ' preguntas. Necesitás <strong>' + PASS_THRESHOLD + ' correctas</strong> para aprobar.'}</p>
        <button class="scm-quiz-btn" id="scm-start-quiz">${yaAprobado ? 'Rehacer el quiz' : 'Empezar el quiz'} →</button>
      </div>`;
    document.getElementById('scm-start-quiz').addEventListener('click', startQuiz);
  }

  function startQuiz() {
    respuestas = new Array(preguntas.length).fill(null);
    renderQuestions();
    setTimeout(() => {
      const first = rootEl.querySelector('.scm-question');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  function renderQuestions() {
    const html = preguntas.map((q, i) => `
      <div class="scm-question" data-q="${i}">
        <div class="scm-question-num">Pregunta ${i + 1} de ${preguntas.length}</div>
        <div class="scm-question-text">${escHtml(q.pregunta)}</div>
        <div class="scm-options">
          ${q.opciones.map((opt, j) => `
            <label class="scm-option ${respuestas[i] === j ? 'selected' : ''}" data-q="${i}" data-opt="${j}">
              <span class="scm-radio"></span>
              <span>${escHtml(opt)}</span>
              <input type="radio" name="q${i}" value="${j}" ${respuestas[i] === j ? 'checked' : ''}>
            </label>
          `).join('')}
        </div>
      </div>
    `).join('');
    rootEl.innerHTML = html + `
      <div class="scm-submit-bar">
        <span class="scm-progress-text" id="scm-progress-text">0 de ${preguntas.length} respondidas</span>
        <button class="scm-quiz-btn" id="scm-submit-quiz" disabled>Enviar respuestas</button>
      </div>`;
    rootEl.querySelectorAll('.scm-option').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const qi = parseInt(el.dataset.q, 10);
        const oi = parseInt(el.dataset.opt, 10);
        respuestas[qi] = oi;
        rootEl.querySelectorAll('.scm-option[data-q="' + qi + '"]').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        updateProgress();
      });
    });
    updateProgress();
  }

  function updateProgress() {
    const answered = respuestas.filter(r => r !== null).length;
    const text = document.getElementById('scm-progress-text');
    const btn = document.getElementById('scm-submit-quiz');
    if (text) text.textContent = answered + ' de ' + preguntas.length + ' respondidas';
    if (btn) {
      btn.disabled = answered < preguntas.length;
      if (!btn.disabled && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', submitQuiz);
      }
    }
  }

  function submitQuiz() {
    let correctas = 0;
    preguntas.forEach((q, i) => { if (respuestas[i] === q.correcta) correctas++; });
    const passed = correctas >= PASS_THRESHOLD;
    saveAttempt(correctas, passed);
    if (passed) markModuleRead();
    renderResult(correctas, passed);
  }

  function renderResult(score, passed) {
    const total = preguntas.length;
    const failedQs = preguntas
      .map((q, i) => ({ q, i, sel: respuestas[i] }))
      .filter(item => item.sel !== item.q.correcta);

    const nextN = N + 1;
    const hasNext = nextN <= 8;

    let html = `
      <div class="scm-result ${passed ? 'passed' : 'failed'}">
        <div class="scm-result-icon">${passed ? '🎉' : '📚'}</div>
        <h2 class="scm-result-title">${passed ? '¡Aprobaste! Módulo marcado como leído' : 'Te faltó. Repasá lo que fallaste'}</h2>
        <p class="scm-result-score">Respondiste <strong>${score} de ${total}</strong> correctas${passed ? '' : ' · Necesitás ' + PASS_THRESHOLD + ' para aprobar'}</p>
        <div class="scm-actions">
          ${passed
            ? `<button class="scm-quiz-btn" id="scm-back">← Volver al Centro de Entrenamiento</button>` +
              (hasNext ? `<a href="/onboarding/${nextN}" class="scm-quiz-btn" style="text-decoration:none;">Siguiente módulo →</a>` : '')
            : `<button class="scm-quiz-btn" id="scm-retry">Reintentar el quiz</button>` +
              `<button class="scm-quiz-btn secondary" id="scm-reread">Volver a leer el módulo</button>`
          }
        </div>
      </div>`;

    if (!passed && failedQs.length > 0) {
      html += `<div style="margin-top:12px; color: var(--text-soft, #B8C2CC); font-size:13px; text-align:center;">Detalle de las que fallaste:</div>`;
      html += failedQs.map(item => {
        const q = item.q;
        return `<div class="scm-question failed" style="margin-top:14px;">
          <div class="scm-question-num">Pregunta ${item.i + 1}</div>
          <div class="scm-question-text">${escHtml(q.pregunta)}</div>
          <div class="scm-options">
            ${q.opciones.map((opt, j) => {
              let cls = '';
              if (j === q.correcta) cls = 'correct';
              else if (j === item.sel) cls = 'incorrect';
              return `<div class="scm-option ${cls}"><span class="scm-radio"></span><span>${escHtml(opt)}</span></div>`;
            }).join('')}
          </div>
          ${q.explicacion ? `<div class="scm-explain"><strong>Por qué:</strong> ${escHtml(q.explicacion)}</div>` : ''}
        </div>`;
      }).join('');
    }

    rootEl.innerHTML = html;

    if (passed) {
      const back = document.getElementById('scm-back');
      if (back) back.addEventListener('click', () => { window.parent.location.href = '/?view=training'; });
    } else {
      const retry = document.getElementById('scm-retry');
      if (retry) retry.addEventListener('click', startQuiz);
      const reread = document.getElementById('scm-reread');
      if (reread) reread.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }
    setTimeout(() => rootEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function init() {
    rootEl = document.getElementById('scm-quiz-root');
    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.id = 'scm-quiz-root';
      document.body.appendChild(rootEl);
    }
    rootEl.className = 'scm-quiz-section';
    injectStyles();

    fetch('/onboarding/quiz-data.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then(data => {
        quizData = data;
        const moduleData = data['modulo' + N];
        preguntas = (moduleData && Array.isArray(moduleData.preguntas)) ? moduleData.preguntas : [];
        renderIntro();
      })
      .catch(err => {
        rootEl.innerHTML = `<div class="scm-quiz-card"><div class="scm-quiz-kicker">⚠️ Error</div><p class="scm-quiz-desc">No pude cargar el quiz: ${escHtml(err.message)}</p></div>`;
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
