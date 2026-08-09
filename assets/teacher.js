(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qidInput = $('qidInput');
  const searchBtn = $('searchBtn');
  const searchMessage = $('searchMessage');
  const bankStatus = $('bankStatus');
  const emptyState = $('emptyState');
  const questionConsole = $('questionConsole');
  let bankPromise = null;
  let questionIndex = new Map();
  let questionCount = 0;

  const normaliseQid = (value) => String(value ?? '')
    .trim()
    .replace(/^qid\s*[:#-]?\s*/i, '')
    .replace(/\s+/g, '');

  const optionLetter = (index) => String.fromCharCode(65 + index);

  function setMessage(text, success = false) {
    searchMessage.textContent = text || '';
    searchMessage.classList.toggle('success', Boolean(success));
  }

  function setLoading(isLoading) {
    searchBtn.disabled = isLoading;
    searchBtn.querySelector('span:last-child').textContent = isLoading ? 'LOADING…' : 'SHOW QUESTION';
  }

  function toQuestionList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.questionList)) return data.questionList;
    return [];
  }

  async function buildQuestionBank() {
    if (bankPromise) return bankPromise;
    bankPromise = (async () => {
      setLoading(true);
      bankStatus.textContent = 'Loading question bank…';
      setMessage('Preparing direct Question ID search…', true);
      const catalogResponse = await fetch('data/tests.json', { cache: 'no-store' });
      if (!catalogResponse.ok) throw new Error('Unable to load question catalog.');
      const catalog = await catalogResponse.json();
      const packs = Array.isArray(catalog) ? catalog : [];

      const results = await Promise.allSettled(packs.map(async (pack) => {
        const response = await fetch(pack.file, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load ${pack.title || pack.file}`);
        const data = await response.json();
        return { pack, questions: toQuestionList(data) };
      }));

      questionIndex = new Map();
      questionCount = 0;
      let failedPacks = 0;

      results.forEach((result) => {
        if (result.status !== 'fulfilled') { failedPacks += 1; return; }
        const { pack, questions } = result.value;
        questions.forEach((question) => {
          const key = normaliseQid(question.questionId ?? question.questionIndex);
          if (!key) return;
          questionCount += 1;
          if (!questionIndex.has(key)) questionIndex.set(key, { question, pack });
        });
      });

      bankStatus.textContent = `${questionCount.toLocaleString()} questions indexed`;
      setMessage(failedPacks ? `${questionCount.toLocaleString()} questions ready; ${failedPacks} pack(s) unavailable.` : `${questionCount.toLocaleString()} questions ready for direct QID lookup.`, true);
      return questionIndex;
    })().finally(() => setLoading(false));
    return bankPromise;
  }

  function safeHtml(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  function getCorrectIndexes(question) {
    return String(question.correctAnswer || '')
      .split(',')
      .map((value) => Number(String(value).trim()) - 1)
      .filter((index) => Number.isInteger(index) && index >= 0);
  }

  function renderQuestion(record) {
    const { question: q, pack } = record;
    const choices = Array.isArray(q.answerChoiceList) ? q.answerChoiceList : [];
    const correctIndexes = getCorrectIndexes(q);
    const correctSet = new Set(correctIndexes);

    $('displayQid').textContent = `QID: ${q.questionId ?? q.questionIndex ?? '----'}`;
    $('packTag').textContent = pack?.title || 'Question Bank';
    $('subjectTag').textContent = q.subject || q.system || 'General';
    $('topicTag').textContent = q.topic || q.title || 'General';
    $('questionText').innerHTML = safeHtml(q.questionText, '<p>Question text unavailable.</p>');

    const options = $('answerOptions');
    options.replaceChildren();
    choices.forEach((choice, index) => {
      const row = document.createElement('div');
      const isCorrect = correctSet.has(index);
      row.className = `teacher-option${isCorrect ? ' correct' : ''}`;

      const number = document.createElement('div');
      number.className = 'option-number';
      number.textContent = optionLetter(index);

      const copy = document.createElement('div');
      copy.className = 'option-copy';
      copy.innerHTML = safeHtml(choice?.choice, 'Option text unavailable.');

      row.append(number, copy);
      if (isCorrect) {
        const badge = document.createElement('span');
        badge.className = 'correct-badge';
        badge.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">check_circle</span><span>CORRECT</span>';
        row.appendChild(badge);
      }
      options.appendChild(row);
    });

    const readableAnswers = correctIndexes.length
      ? correctIndexes.map((index) => `${optionLetter(index)} (Option ${index + 1})`).join(', ')
      : 'Not specified';
    $('correctAnswerText').textContent = readableAnswers;

    const summary = $('correctAnswerChoices');
    summary.replaceChildren();
    correctIndexes.forEach((index) => {
      const choice = choices[index];
      if (!choice) return;
      const line = document.createElement('div');
      line.innerHTML = `<strong>${optionLetter(index)}.</strong> ${safeHtml(choice.choice, '')}`;
      summary.appendChild(line);
    });

    $('explanationText').innerHTML = safeHtml(q.explanationText, '<p>Explanation unavailable.</p>');
    const additional = $('additionalText');
    const additionalValue = typeof q.additionalText === 'string' ? q.additionalText.trim() : '';
    if (additionalValue) {
      additional.innerHTML = additionalValue;
      additional.hidden = false;
    } else {
      additional.replaceChildren();
      additional.hidden = true;
    }

    emptyState.hidden = true;
    questionConsole.hidden = false;
    setMessage(`Question ${q.questionId ?? q.questionIndex} loaded from ${pack?.title || 'question bank'}.`, true);
    requestAnimationFrame(() => questionConsole.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function searchQuestion() {
    const key = normaliseQid(qidInput.value);
    if (!key) {
      setMessage('Enter a Question ID first.');
      qidInput.focus();
      return;
    }

    setMessage('Searching question bank…', true);
    try {
      const index = await buildQuestionBank();
      const record = index.get(key);
      if (!record) {
        questionConsole.hidden = true;
        emptyState.hidden = false;
        setMessage(`Question ID ${key} was not found in the current question bank.`);
        qidInput.focus();
        qidInput.select();
        return;
      }
      renderQuestion(record);
    } catch (error) {
      console.error(error);
      bankPromise = null;
      setMessage('Unable to load the question bank. Check the app files and try again.');
      bankStatus.textContent = 'Question bank unavailable';
    }
  }

  searchBtn.addEventListener('click', searchQuestion);
  qidInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchQuestion();
    }
  });

  // Warm the index after initial paint so the first teacher lookup is fast.
  if ('requestIdleCallback' in window) requestIdleCallback(() => buildQuestionBank().catch(() => {}), { timeout: 1200 });
  else setTimeout(() => buildQuestionBank().catch(() => {}), 350);
})();
