(function (window, document) {
  'use strict';

  let deferredInstallPrompt = null;
  let installToast = null;
  let installButton = null;
  let installHelp = null;
  let toastTimer = null;
  const INSTALLED_KEY = 'pbx_pwa_installed_v1';

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function markInstalled() {
    storageSet(INSTALLED_KEY, '1');
  }

  function isKnownInstalled() {
    return isStandalone() || storageGet(INSTALLED_KEY) === '1';
  }

  function hideInstallToast(immediate) {
    if (!installToast) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    installToast.classList.remove('is-visible');
    installToast.classList.add('is-leaving');
    const finish = () => {
      installToast.hidden = true;
      installToast.classList.remove('is-leaving');
    };
    if (immediate) finish();
    else setTimeout(finish, 650);
  }

  function showInstallToast() {
    if (!installToast || isKnownInstalled()) {
      hideInstallToast(true);
      return;
    }
    installToast.hidden = false;
    installToast.classList.remove('is-leaving');
    requestAnimationFrame(() => requestAnimationFrame(() => installToast.classList.add('is-visible')));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => hideInstallToast(false), 5000);
  }

  function openHelp(message) {
    if (!installHelp || isStandalone()) return;
    const body = installHelp.querySelector('[data-install-help-body]');
    if (body) body.innerHTML = message;
    installHelp.hidden = false;
    installHelp.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => installHelp.classList.add('is-open'));
    const close = installHelp.querySelector('[data-install-help-close]');
    if (close) close.focus({ preventScroll: true });
  }

  function closeHelp() {
    if (!installHelp) return;
    installHelp.classList.remove('is-open');
    installHelp.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!installHelp.classList.contains('is-open')) installHelp.hidden = true;
    }, 180);
  }

  async function requestInstall() {
    if (isStandalone()) {
      markInstalled();
      hideInstallToast(true);
      return { installed: true, reason: 'standalone' };
    }

    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      hideInstallToast(false);
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice && choice.outcome === 'accepted') {
        if (window.PBXHaptics) window.PBXHaptics.confirm();
        return { installed: true, reason: 'accepted' };
      }
      return { installed: false, reason: 'dismissed' };
    }

    if (isIOS()) {
      openHelp('<strong>Install on iPhone/iPad</strong><br>Tap the <b>Share</b> button in Safari, choose <b>Add to Home Screen</b>, then tap <b>Add</b>.');
      return { installed: false, reason: 'ios-help' };
    }

    openHelp('<strong>Install NCLEX-RN</strong><br>Open your browser menu and choose <b>Install app</b>, <b>Install NCLEX-RN</b>, or <b>Add to Home Screen</b>.');
    return { installed: false, reason: 'manual-help' };
  }

  function bindInstallUI() {
    installToast = document.getElementById('pwaInstallToast');
    installButton = document.getElementById('pwaInstallButton');
    installHelp = document.getElementById('pwaInstallHelp');

    // A launched PWA must never display installation UI.
    if (isStandalone()) {
      markInstalled();
      hideInstallToast(true);
    } else if (installToast && !isKnownInstalled()) {
      setTimeout(showInstallToast, 450);
    } else {
      hideInstallToast(true);
    }

    if (installButton) installButton.addEventListener('click', requestInstall);
    if (installHelp) {
      installHelp.addEventListener('click', event => {
        if (
          event.target.matches('[data-install-help-backdrop], [data-install-help-close]') ||
          event.target.closest('[data-install-help-close]')
        ) closeHelp();
      });
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeHelp();
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone() && installToast && !isKnownInstalled() && installToast.hidden) {
      showInstallToast();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    markInstalled();
    hideInstallToast(false);
    closeHelp();
    if (window.PBXHaptics) window.PBXHaptics.confirm();
  });

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol) ||
        (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) return;
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('PWA service worker registration failed.', error);
    }
  }

  window.PBXPWA = Object.freeze({ requestInstall, isStandalone });
  document.addEventListener('DOMContentLoaded', () => {
    bindInstallUI();
    registerServiceWorker();
  });
})(window, document);
