(() => {
  'use strict';
  const RESULTS_KEY = 'nclex-clean-results-v1';
  const STATE_KEY = 'nclex-clean-run-state-v1';
  const params = new URLSearchParams(location.search);
  const testId = params.get('id') || 'unknown-test';
  const file = params.get('file') || '';
  const title = params.get('title') || 'NCLEX RN Test';
  const reviewRequested = params.get('review') === '1';
  const frame = document.getElementById('testFrame');
  const loading = document.getElementById('loadingScreen');
  const resultScreen = document.getElementById('resultScreen');
  let ready = false;
  let hasFinished = reviewRequested;

  const getStore = (key) => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { return {}; } };
  const saveStore = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const pct = (value, total) => total > 0 ? Math.round((value / total) * 100) : 0;
  const formatTime = (seconds) => {
    const value = Math.max(0, Number(seconds || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return hours > 0
      ? `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
      : `${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  };
  const setText = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = String(value); };

  function evalInFrame(code) {
    return frame.contentWindow.eval(code);
  }

  function readSnapshot() {
    if (!ready) return null;
    try {
      return JSON.parse(evalInFrame(`JSON.stringify({
        currentIndex:qIndex,
        score:score,
        maxPoints:total,
        seconds:sec,
        practiceMode:(typeof practiceMode !== 'undefined' ? practiceMode : 'tutored'),
        questions:DATA.questionList.map(q=>({
          submitted:Boolean(q.submitted),
          userAnswer:Array.isArray(q.userAnswer)?q.userAnswer:[],
          qScore:Number(q.qScore||0),
          qMax:Number(q.qMax||String(q.correctAnswer||'').split(',').filter(Boolean).length||1),
          timeTaken:Number(q.timeTaken||0),
          finalTimeTaken:Number(q.finalTimeTaken||0),
          isMarked:Boolean(q.isMarked)
        }))
      })`));
    } catch (error) {
      console.error('Unable to read test state.', error);
      return null;
    }
  }

  function summarize(snapshot) {
    const questions = snapshot?.questions || [];
    let attempted = 0, correct = 0, incorrect = 0, partial = 0, omitted = 0, marked = 0, points = 0, maxPoints = 0;
    questions.forEach((q) => {
      if (q.isMarked) marked += 1;
      const qMax = Math.max(1, Number(q.qMax || 1));
      const qScore = Math.max(0, Number(q.qScore || 0));
      maxPoints += qMax;
      if (!q.submitted || !Array.isArray(q.userAnswer) || q.userAnswer.length === 0) { omitted += 1; return; }
      attempted += 1;
      points += qScore;
      if (qScore >= qMax) correct += 1;
      else if (qScore <= 0) incorrect += 1;
      else partial += 1;
    });
    const totalQuestions = questions.length;
    const percent = pct(points, maxPoints);
    return {
      testId, title, total: totalQuestions, attempted, correct, incorrect, partial, omitted, marked,
      points, maxPoints, percent, seconds: Number(snapshot?.seconds || 0),
      averageSeconds: attempted ? Math.round(Number(snapshot?.seconds || 0) / attempted) : 0,
      completedAt: new Date().toISOString(), finished: true
    };
  }

  function saveProgress() {
    if (hasFinished) return;
    const snapshot = readSnapshot();
    if (!snapshot) return;
    const attempted = snapshot.questions.filter((q) => Array.isArray(q.userAnswer) && q.userAnswer.length > 0 && (snapshot.practiceMode === 'untutored' || q.submitted)).length;
    const states = getStore(STATE_KEY);
    states[testId] = { ...snapshot, title, file, attempted, finished: false, savedAt: new Date().toISOString() };
    saveStore(STATE_KEY, states);
  }

  function showResult() {
    if (hasFinished) { resultScreen.classList.remove('hidden'); return; }
    try { evalInFrame("if(typeof prepareTestForCompletion==='function') prepareTestForCompletion();"); } catch (_) {}
    const snapshot = readSnapshot();
    if (!snapshot) return;
    try { evalInFrame('stopTimer()'); } catch (_) {}
    hasFinished = true;
    const result = summarize(snapshot);
    const results = getStore(RESULTS_KEY);
    results[testId] = result;
    saveStore(RESULTS_KEY, results);
    const states = getStore(STATE_KEY);
    states[testId] = { ...snapshot, title, file, attempted: result.attempted, finished: true, savedAt: new Date().toISOString() };
    saveStore(STATE_KEY, states);
    renderResult(result);
    resultScreen.classList.remove('hidden');
  }

  function renderResult(result) {
    const attemptedP = pct(result.attempted, result.total);
    const omittedP = pct(result.omitted, result.total);
    const classified = result.correct + result.incorrect + result.partial;
    const correctP = pct(result.correct, classified);
    const incorrectP = pct(result.incorrect, classified);
    const partialP = pct(result.partial, classified);
    setText('resultTestName', result.title);
    setText('completionPercent', `${attemptedP}%`);
    setText('resultTotal', result.total);
    setText('resultAttempted', result.attempted);
    setText('resultAttemptedPercent', `${attemptedP}%`);
    setText('resultOmitted', result.omitted);
    setText('resultOmittedPercent', `${omittedP}%`);
    setText('resultCorrect', result.correct);
    setText('resultCorrectPercent', `${correctP}%`);
    setText('resultIncorrect', result.incorrect);
    setText('resultIncorrectPercent', `${incorrectP}%`);
    setText('resultPartial', result.partial);
    setText('resultPartialPercent', `${partialP}%`);
    setText('resultScore', `${result.percent}%`);
    setText('resultPoints', `${result.points} / ${result.maxPoints}`);
    setText('resultTime', formatTime(result.seconds));
    setText('resultAverage', formatTime(result.averageSeconds));
    document.getElementById('completionRing').style.setProperty('--used-angle', `${attemptedP * 3.6}deg`);
    document.getElementById('scoreRing').style.setProperty('--correct-end', `${correctP * 3.6}deg`);
    document.getElementById('scoreRing').style.setProperty('--incorrect-end', `${(correctP + incorrectP) * 3.6}deg`);
    document.getElementById('scoreRing').style.setProperty('--partial-end', `${(correctP + incorrectP + partialP) * 3.6}deg`);
  }

  function installBridge(data) {
    const states = getStore(STATE_KEY);
    const restored = reviewRequested
      ? (states[testId] || null)
      : (states[testId] && !states[testId].finished ? states[testId] : null);
    const payload = JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const restorePayload = JSON.stringify(restored || null).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const safeTitle = JSON.stringify(title);
    evalInFrame(`
      DATA=${payload};
      const __restore=${restorePayload};
      DATA.questionList.forEach((q,index)=>{
        const saved=__restore && __restore.questions ? __restore.questions[index] : null;
        q.submitted=saved?Boolean(saved.submitted):false;
        q.userAnswer=saved&&Array.isArray(saved.userAnswer)?saved.userAnswer:[];
        q.qScore=saved?Number(saved.qScore||0):0;
        q.qMax=saved?Number(saved.qMax||0):0;
        q.timeTaken=saved?Number(saved.timeTaken||0):0;
        q.finalTimeTaken=saved?Number(saved.finalTimeTaken||0):0;
        q.isMarked=saved?Boolean(saved.isMarked):Boolean(q.isMarked);
        q.questionId=q.questionId||'QID-0000';
        q.renderedQuestionText=null;
        q.renderedExplanationText=null;
      });
      qIndex=__restore?Math.min(Number(__restore.currentIndex||0),DATA.questionList.length-1):0;
      score=__restore?Number(__restore.score||0):0;
      total=__restore?Number(__restore.maxPoints||0):0;
      sec=__restore?Number(__restore.seconds||0):0;
      practiceMode=__restore&&__restore.practiceMode==='untutored'?'untutored':'tutored';
      reviewMode=false;
      questionsLoaded=true;
      currentFileBaseName=${safeTitle};
      const __title=${safeTitle};
      ['testMetaLine','mobileTestMetaLine','fileName'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=__title;});
      if(typeof updatePracticeModeUI==='function') updatePracticeModeUI();
      const __originalCheck=check;
      check=function(){
        __originalCheck();
        if(!reviewMode) window.parent.postMessage({type:'nclex-progress'},'*');
      };
      const __originalNextQ=nextQ;
      nextQ=function(){
        if(reviewMode){ __originalNextQ(); return; }
        if(qIndex>=DATA.questionList.length-1){window.parent.postMessage({type:'nclex-finish'},'*');return;}
        __originalNextQ();window.parent.postMessage({type:'nclex-progress'},'*');
      };
      const __originalPrevQ=prevQ;
      prevQ=function(){
        __originalPrevQ();
        if(!reviewMode) window.parent.postMessage({type:'nclex-progress'},'*');
      };
      endTest=function(){if(!reviewMode) window.parent.postMessage({type:'nclex-finish'},'*');};
      suspendTest=function(){window.parent.postMessage({type:'nclex-suspend'},'*');};
      triggerFileLoad=function(){};
      openNotes=function(){};
      openFeedback=function(){};
      aiSearch=function(){};
      closeAI=function(){const modal=document.getElementById('aiModal');if(modal)modal.classList.remove('active');};
      if(${reviewRequested ? 'true' : 'false'}){
        if(typeof enterReviewMode==='function') enterReviewMode();
        else { reviewMode=true; qIndex=0; if(typeof updatePracticeModeUI==='function') updatePracticeModeUI(); render(); }
      } else {
        render();syncTimerForCurrentQuestion();
      }
    `);
  }

  async function load() {
    if (!file || file.includes('..')) {
      document.getElementById('loadingText').textContent = 'Invalid question file.';
      return;
    }
    try {
      const response = await fetch(file, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.questionList)) throw new Error('Question file has no questionList array.');
      installBridge(data);
      ready = true;
      loading.classList.add('hidden');
    } catch (error) {
      console.error(error);
      document.getElementById('loadingText').textContent = 'Unable to load this question file.';
    }
  }

  frame.addEventListener('load', load, { once: true });
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || !event.data) return;
    if (event.data.type === 'nclex-progress') saveProgress();
    if (event.data.type === 'nclex-finish') showResult();
    if (event.data.type === 'nclex-suspend') { saveProgress(); location.href = 'main.html'; }
  });
  window.addEventListener('beforeunload', saveProgress);
  setInterval(() => { if (ready && resultScreen.classList.contains('hidden')) saveProgress(); }, 15000);

  document.getElementById('reviewBtn').addEventListener('click', () => {
    resultScreen.classList.add('hidden');
    try { evalInFrame("if(typeof enterReviewMode==='function') enterReviewMode(); else { qIndex=0; render(); }"); } catch (_) {}
  });
  document.getElementById('retakeBtn').addEventListener('click', () => {
    ready = false;
    hasFinished = true;
    const states = getStore(STATE_KEY);
    delete states[testId];
    saveStore(STATE_KEY, states);
    location.reload();
  });
})();
