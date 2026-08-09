(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'pbxNursingHapticsV1';
  const hasVibration = typeof navigator.vibrate === 'function';
  const coarsePointer = window.matchMedia ? window.matchMedia('(hover: none), (pointer: coarse)') : {matches:true};
  const scrollStates = new WeakMap();
  let enabled = true;
  let touchActive = false;
  let lastGlobalPulseAt = 0;

  try { enabled = localStorage.getItem(STORAGE_KEY) !== '0'; } catch (_) {}

  function canHaptic() {
    return enabled && hasVibration && !document.hidden;
  }

  function vibrate(pattern) {
    if (!canHaptic()) return false;
    try { return navigator.vibrate(pattern); } catch (_) { return false; }
  }

  function tap() { return vibrate(6); }
  function soft() { return vibrate(4); }
  function confirm() { return vibrate([10, 28, 12]); }
  function error() { return vibrate([16, 32, 16]); }

  function interactiveTarget(target) {
    if (!target || !target.closest) return null;
    return target.closest('button, a, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], select, [role="button"], .answer-option, .option, .choice');
  }

  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && !coarsePointer.matches) return;
    if (interactiveTarget(event.target)) tap();
  }, {passive:true});

  document.addEventListener('touchstart', () => { touchActive = true; }, {passive:true});
  document.addEventListener('touchend', () => { setTimeout(() => { touchActive = false; }, 260); }, {passive:true});
  document.addEventListener('touchcancel', () => { touchActive = false; }, {passive:true});

  function getScrollPosition(target) {
    if (target === window || target === document || target === document.documentElement || target === document.body) {
      return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }
    return Number(target.scrollTop || 0);
  }

  function scheduleScrollSample(target) {
    const key = (target === window || target === document) ? document : target;
    if (!key || (typeof key !== 'object' && typeof key !== 'function')) return;
    let state = scrollStates.get(key);
    if (!state) {
      state = {
        lastPos: getScrollPosition(target),
        lastT: performance.now(),
        velocityEMA: 0,
        lastVelocity: 0,
        rafPending: false
      };
      scrollStates.set(key, state);
    }
    if (state.rafPending) return;
    state.rafPending = true;
    requestAnimationFrame(() => sampleScroll(target, key, state));
  }

  function sampleScroll(target, key, state) {
    state.rafPending = false;
    const now = performance.now();
    const position = getScrollPosition(target);
    const dt = Math.max(8, now - state.lastT);
    const distance = Math.abs(position - state.lastPos);
    const instantVelocity = distance / dt; // px/ms
    state.velocityEMA = state.velocityEMA * 0.66 + instantVelocity * 0.34;
    const acceleration = Math.abs(state.velocityEMA - state.lastVelocity) / dt; // px/ms²
    state.lastVelocity = state.velocityEMA;
    state.lastPos = position;
    state.lastT = now;

    if (!coarsePointer.matches || distance < 2) return;
    // Touch scrolling is prioritized; fast programmatic/inertial movement can still produce feedback.
    if (!touchActive && state.velocityEMA < 0.58) return;

    // Vibration API has no amplitude control, so scroll speed/acceleration is mapped
    // to both pulse length and pulse frequency. Higher page speed feels stronger/faster.
    let duration = 0;
    let minInterval = Infinity;
    if (state.velocityEMA >= 2.2 || acceleration >= 0.050) { duration = 12; minInterval = 62; }
    else if (state.velocityEMA >= 1.35 || acceleration >= 0.030) { duration = 9; minInterval = 82; }
    else if (state.velocityEMA >= 0.75 || acceleration >= 0.016) { duration = 6; minInterval = 112; }
    else if (state.velocityEMA >= 0.34 || acceleration >= 0.008) { duration = 3; minInterval = 155; }

    if (duration && now - lastGlobalPulseAt >= minInterval) {
      lastGlobalPulseAt = now;
      vibrate(duration);
    }
  }

  // Capture scroll events from nested panels as well as normal page scrolling.
  document.addEventListener('scroll', event => scheduleScrollSample(event.target || document), {capture:true, passive:true});
  window.addEventListener('scroll', () => scheduleScrollSample(window), {passive:true});

  function setEnabled(value) {
    enabled = Boolean(value);
    try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
    if (!enabled && hasVibration) { try { navigator.vibrate(0); } catch (_) {} }
    return enabled;
  }

  window.PBXHaptics = Object.freeze({
    supported: hasVibration,
    tap, soft, confirm, error,
    setEnabled,
    isEnabled: () => enabled
  });
})(window, document);
