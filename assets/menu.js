(() => {
  'use strict';
  const RESULTS_KEY = 'nclex-clean-results-v1';
  const STATE_KEY = 'nclex-clean-run-state-v1';
  const $ = (id) => document.getElementById(id);
  const pct = (value, total) => total > 0 ? Math.round((Number(value || 0) / Number(total || 0)) * 100) : 0;
  const getJSON = (key, fallback = {}) => {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
  };
  const saveJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  // Smootherstep gives zero velocity at both ends, avoiding abrupt starts/stops.
  const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  let catalog = [];
  let results = getJSON(RESULTS_KEY, {});
  let runStates = getJSON(STATE_KEY, {});
  let viewportObserver = null;
  const animationTokens = new WeakMap();
  const ZERO_DASHBOARD = {total:0,used:0,unused:0,correct:0,incorrect:0,partial:0,usageP:0,unusedP:0,correctP:0,incorrectP:0,partialP:0};

  function summarizeState(test, state) {
    const total = Number(test.questions || state?.questions?.length || 0);
    const questions = Array.isArray(state?.questions) ? state.questions : [];
    let attempted = 0, correct = 0, incorrect = 0, partial = 0;
    questions.forEach((q) => {
      const answered = Array.isArray(q?.userAnswer) && q.userAnswer.length > 0 && (state?.practiceMode === 'untutored' || Boolean(q?.submitted));
      if (!answered) return;
      attempted += 1;
      if (state?.practiceMode === 'untutored' && !state?.finished) return;
      const qMax = Math.max(1, Number(q?.qMax || 1));
      const qScore = Math.max(0, Number(q?.qScore || 0));
      if (qScore >= qMax) correct += 1;
      else if (qScore <= 0) incorrect += 1;
      else partial += 1;
    });
    return { total, attempted, correct, incorrect, partial, finished:Boolean(state?.finished) };
  }

  function statsFor(test) {
    const state = runStates[test.id];
    const result = results[test.id];
    if (state && !state.finished) {
      const live = summarizeState(test, state);
      return { ...live, status:(live.attempted > 0 || Number(state.currentIndex || 0) > 0) ? 'progress' : 'new' };
    }
    if (result) {
      return {
        total:Number(test.questions || result.total || 0),
        attempted:Number(result.attempted || 0),
        correct:Number(result.correct || 0),
        incorrect:Number(result.incorrect || 0),
        partial:Number(result.partial || 0),
        finished:true,
        status:'completed'
      };
    }
    if (state && state.finished) {
      const done = summarizeState(test, state);
      return { ...done, status:'completed' };
    }
    return { total:Number(test.questions || 0), attempted:0, correct:0, incorrect:0, partial:0, finished:false, status:'new' };
  }

  function statusInfo(status) {
    if (status === 'completed') return { icon:'verified', label:'Completed' };
    if (status === 'progress') return { icon:'play_circle', label:'In progress' };
    return { icon:'fiber_new', label:'New' };
  }

  function goToTest(test, options = {}) {
    const params = new URLSearchParams({ id:test.id, file:test.file, title:test.title || 'NCLEX RN Test' });
    if (options.review) params.set('review', '1');
    location.href = `runner.html?${params.toString()}`;
  }

  function clearTest(test) {
    delete results[test.id];
    delete runStates[test.id];
    saveJSON(RESULTS_KEY, results);
    saveJSON(STATE_KEY, runStates);
  }

  function setDashboardFrame(v) {
    const set = (id, value) => { const node = $(id); if (node) node.textContent = String(value); };
    set('totalQuestions', v.total);
    set('usedQuestions', v.used);
    set('unusedQuestions', v.unused);
    set('usagePercent', `${v.usageP}%`);
    set('usedPercent', `${v.usageP}%`);
    set('unusedPercent', `${v.unusedP}%`);
    set('totalCorrect', v.correct);
    set('totalIncorrect', v.incorrect);
    set('totalPartial', v.partial);
    set('correctPercent', `${v.correctP}%`);
    set('incorrectPercent', `${v.incorrectP}%`);
    set('partialPercent', `${v.partialP}%`);
    set('resultPercent', `${v.correctP}%`);
    $('usageRing')?.style.setProperty('--used-angle', `${v.usageP * 3.6}deg`);
    $('resultRing')?.style.setProperty('--correct-end', `${v.correctP * 3.6}deg`);
    $('resultRing')?.style.setProperty('--incorrect-end', `${(v.correctP + v.incorrectP) * 3.6}deg`);
    $('resultRing')?.style.setProperty('--partial-end', `${(v.correctP + v.incorrectP + v.partialP) * 3.6}deg`);
  }

  function dashboardTargets() {
    const all = catalog.map(statsFor);
    const total = all.reduce((sum, x) => sum + x.total, 0);
    const used = Math.min(total, all.reduce((sum, x) => sum + x.attempted, 0));
    const unused = Math.max(0, total - used);
    const correct = all.reduce((sum, x) => sum + x.correct, 0);
    const incorrect = all.reduce((sum, x) => sum + x.incorrect, 0);
    const partial = all.reduce((sum, x) => sum + x.partial, 0);
    const classified = correct + incorrect + partial;
    return {
      total, used, unused, correct, incorrect, partial,
      usageP:pct(used,total), unusedP:pct(unused,total),
      correctP:pct(correct,classified), incorrectP:pct(incorrect,classified), partialP:pct(partial,classified)
    };
  }

  function cardFrame(card, s, progress) {
    const n = (value) => Math.round(Number(value || 0) * progress);
    const usageP = pct(s.attempted, s.total);
    const classified = s.correct + s.incorrect + s.partial;
    const correctP = pct(s.correct, classified);
    const incorrectP = pct(s.incorrect, classified);
    const partialP = pct(s.partial, classified);
    const useP = n(usageP), cP = n(correctP), iP = n(incorrectP), pP = n(partialP);
    card.querySelector('[data-stat="used"]')?.replaceChildren(document.createTextNode(`${n(s.attempted)} / ${n(s.total)}`));
    card.querySelector('[data-stat="correct"]')?.replaceChildren(document.createTextNode(n(s.correct)));
    card.querySelector('[data-stat="incorrect"]')?.replaceChildren(document.createTextNode(n(s.incorrect)));
    card.querySelector('[data-stat="partial"]')?.replaceChildren(document.createTextNode(n(s.partial)));
    card.querySelector('[data-pct="used"]')?.replaceChildren(document.createTextNode(`${useP}%`));
    card.querySelector('[data-pct="correct"]')?.replaceChildren(document.createTextNode(`${cP}%`));
    card.querySelector('[data-pct="incorrect"]')?.replaceChildren(document.createTextNode(`${iP}%`));
    card.querySelector('[data-pct="partial"]')?.replaceChildren(document.createTextNode(`${pP}%`));
    card.querySelector('[data-meter-label]')?.replaceChildren(document.createTextNode(`${cP}%`));

    const meter = card.querySelector('.card-meter');
    if (meter) {
      if (classified <= 0) {
        meter.style.background = '#9eb1c5';
      } else {
        const correctTarget = (s.correct / classified) * 360;
        const incorrectTarget = ((s.correct + s.incorrect) / classified) * 360;
        const cEnd = correctTarget * progress;
        const iEnd = incorrectTarget * progress;
        const pEnd = 360 * progress;
        meter.style.background = `conic-gradient(var(--green) 0 ${cEnd}deg,var(--red) ${cEnd}deg ${iEnd}deg,var(--yellow) ${iEnd}deg ${pEnd}deg,#9eb1c5 ${pEnd}deg 360deg)`;
      }
    }
  }

  function cancelAnimation(element) {
    if (!element) return;
    animationTokens.set(element, (animationTokens.get(element) || 0) + 1);
  }

  function animateProgress(element, duration, renderFrame, delay = 0) {
    const token = (animationTokens.get(element) || 0) + 1;
    animationTokens.set(element, token);
    renderFrame(0);

    const begin = performance.now() + Math.max(0, delay);
    const tick = (now) => {
      if (animationTokens.get(element) !== token) return;
      if (now < begin) {
        requestAnimationFrame(tick);
        return;
      }
      const raw = Math.min(1, (now - begin) / duration);
      const progress = smootherstep(raw);
      renderFrame(progress);
      if (raw < 1) requestAnimationFrame(tick);
      else renderFrame(1);
    };
    requestAnimationFrame(tick);
  }

  function resetOverviewAnimation() {
    const panel = document.querySelector('.overview-panel');
    if (panel) cancelAnimation(panel);
    setDashboardFrame(ZERO_DASHBOARD);
  }

  function animateOverviewIn() {
    const panel = document.querySelector('.overview-panel');
    if (!panel) return;
    const target = dashboardTargets();
    animateProgress(panel, 1350, (progress) => {
      const frame = {};
      Object.keys(target).forEach((key) => {
        frame[key] = Math.round(target[key] * progress);
      });
      setDashboardFrame(frame);
    }, 45);
  }

  function resetCardAnimation(card) {
    if (!card?.__stats) return;
    cancelAnimation(card);
    cardFrame(card, card.__stats, 0);
  }

  function animateCardIn(card) {
    if (!card?.__stats) return;
    animateProgress(card, 1220, (progress) => cardFrame(card, card.__stats, progress), 35);
  }

  function setVisualEntryState(element, visible) {
    if (!element) return;
    if (visible) {
      // Two frames ensure the browser paints the reset state before replaying the transition.
      requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add('is-in-viewport')));
    } else {
      element.classList.remove('is-in-viewport');
    }
  }

  function setupViewportAnimations() {
    if (viewportObserver) viewportObserver.disconnect();

    const overview = document.querySelector('.overview-panel');
    const cards = [...document.querySelectorAll('.test-card')];
    const visualOnly = [document.querySelector('.selector-header'), document.querySelector('.selector-footer')].filter(Boolean);
    const observed = [overview, ...cards, ...visualOnly].filter(Boolean);

    observed.forEach((element) => {
      element.classList.add('viewport-transition');
      element.classList.remove('is-in-viewport');
      element.dataset.viewportInside = '0';
    });
    resetOverviewAnimation();
    cards.forEach(resetCardAnimation);

    if (!('IntersectionObserver' in window)) {
      observed.forEach((element) => element.classList.add('is-in-viewport'));
      setDashboardFrame(dashboardTargets());
      cards.forEach((card) => cardFrame(card, card.__stats, 1));
      return;
    }

    viewportObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const element = entry.target;
        if (entry.isIntersecting) {
          if (element.dataset.viewportInside === '1') return;
          element.dataset.viewportInside = '1';
          setVisualEntryState(element, true);
          if (element.classList.contains('overview-panel')) animateOverviewIn();
          else if (element.classList.contains('test-card')) animateCardIn(element);
        } else {
          if (element.dataset.viewportInside === '0') return;
          element.dataset.viewportInside = '0';
          setVisualEntryState(element, false);
          if (element.classList.contains('overview-panel')) resetOverviewAnimation();
          else if (element.classList.contains('test-card')) resetCardAnimation(element);
          else cancelAnimation(element);
        }
      });
    }, {
      root:null,
      rootMargin:'0px',
      threshold:[0, 0.01, 0.12, 0.35, 0.7]
    });

    observed.forEach((element) => viewportObserver.observe(element));
  }

  function renderCatalog() {
    const grid = $('testGrid');
    grid.innerHTML = '';
    catalog.forEach((test) => {
      const s = statsFor(test);
      const status = statusInfo(s.status);
      const card = document.createElement('article');
      card.className = 'test-card';
      card.__stats = s;
      card.innerHTML = `
        <div class="test-card-head">
          <h2>${escapeHTML(test.title || 'Untitled Test')}</h2>
          <span class="status-pill"><span class="material-symbols-outlined" aria-hidden="true">${status.icon}</span>${status.label}</span>
        </div>
        <div class="card-body">
          <div class="card-stats">
            <div class="card-row"><span class="label">USED QUE'S:</span><span class="value" data-stat="used">0 / 0</span><em class="mini-pill pill-blue" data-pct="used">0%</em></div>
            <div class="card-row"><span class="label">CORRECT QUE'S:</span><span class="value" data-stat="correct">0</span><em class="mini-pill pill-green" data-pct="correct">0%</em></div>
            <div class="card-row"><span class="label">INCORRECT QUE'S:</span><span class="value" data-stat="incorrect">0</span><em class="mini-pill pill-red" data-pct="incorrect">0%</em></div>
            <div class="card-row"><span class="label">PARTIALLY INCORR:</span><span class="value" data-stat="partial">0</span><em class="mini-pill pill-yellow" data-pct="partial">0%</em></div>
          </div>
          <div class="meter card-meter">
            <div class="meter-core"><strong data-meter-label>0%</strong><span>Correct</span></div>
          </div>
        </div>
        <div class="card-actions"></div>`;

      const actions = card.querySelector('.card-actions');
      if (s.status === 'progress') {
        const resume = document.createElement('button');
        resume.className = 'card-action';
        resume.innerHTML = '<span class="material-symbols-outlined">play_arrow</span>Resume';
        resume.addEventListener('click', () => goToTest(test));
        const restart = document.createElement('button');
        restart.className = 'card-action light';
        restart.innerHTML = '<span class="material-symbols-outlined">refresh</span>Restart';
        restart.addEventListener('click', () => { clearTest(test); goToTest(test); });
        actions.append(resume, restart);
      } else if (s.status === 'completed') {
        const review = document.createElement('button');
        review.className = 'card-action review-action';
        review.innerHTML = '<span class="material-symbols-outlined">rate_review</span>Review';
        review.addEventListener('click', () => goToTest(test, { review:true }));

        const retake = document.createElement('button');
        retake.className = 'card-action light';
        retake.innerHTML = '<span class="material-symbols-outlined">refresh</span>Retake';
        retake.addEventListener('click', () => { clearTest(test); goToTest(test); });
        actions.append(review, retake);
      } else {
        const start = document.createElement('button');
        start.className = 'card-action single';
        start.innerHTML = '<span class="material-symbols-outlined">rocket_launch</span>Start';
        start.addEventListener('click', () => goToTest(test));
        actions.append(start);
      }
      grid.appendChild(card);
    });
  }

  function refreshAnimated() {
    if (!catalog.length) return;
    results = getJSON(RESULTS_KEY, {});
    runStates = getJSON(STATE_KEY, {});
    renderCatalog();
    setupViewportAnimations();
  }

  function setupPurposeModal() {
    const modal = $('purposeVisionModal');
    const openBtn = $('purposeInfoBtn');
    const closeBtn = $('purposeModalClose');
    if (!modal || !openBtn || !closeBtn) return;

    let lastFocused = null;
    const modalCard = modal.querySelector('.purpose-modal-card');

    const openModal = () => {
      lastFocused = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('purpose-modal-open');
      requestAnimationFrame(() => modalCard?.focus({ preventScroll:true }));
    };

    const closeModal = () => {
      if (!modal.classList.contains('is-open')) return;
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('purpose-modal-open');
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus({ preventScroll:true });
    };

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    modal.querySelectorAll('[data-purpose-close]').forEach((node) => node.addEventListener('click', closeModal));

    document.addEventListener('keydown', (event) => {
      if (!modal.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button, [href], [tabindex]:not([tabindex=\"-1\"])')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  async function init() {
    setupPurposeModal();
    $('clearProgressBtn')?.addEventListener('click', () => {
      if (!confirm('Reset all saved test progress and results?')) return;
      localStorage.removeItem(RESULTS_KEY);
      localStorage.removeItem(STATE_KEY);
      results = {};
      runStates = {};
      refreshAnimated();
    });
    try {
      const response = await fetch('data/tests.json', { cache:'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error('Catalog must be an array.');
      refreshAnimated();
    } catch (error) {
      const notice = $('notice');
      notice.classList.remove('hidden');
      notice.textContent = 'The question catalog could not be loaded. Open this repository through a local or hosted web server.';
      console.error(error);
    }
  }

  // Restart every dashboard/stat animation whenever this screen becomes visible again,
  // including normal navigation, browser back/forward cache, and returning to the tab/app.
  window.addEventListener('pageshow', () => {
    if (catalog.length) refreshAnimated();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && catalog.length) refreshAnimated();
  });
  init();
})();
