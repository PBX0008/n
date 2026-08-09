'use strict';
const CACHE_VERSION = 'pbx-nclex-pwa-v13';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
  "./",
  "index.html",
  "main.html",
  "runner.html",
  "test.html",
  "teacher.html",
  "manifest.webmanifest",
  "data/tests.json",
  "assets/auth.js",
  "assets/menu.js",
  "assets/runner.js",
  "assets/teacher.js",
  "assets/pwa.js",
  "assets/haptics.js",
  "assets/menu.css",
  "assets/runner.css",
  "assets/teacher.css",
  "assets/css/main.css",
  "assets/css/noscript.css",
  "assets/css/images/bg.jpg",
  "assets/css/images/overlay.svg",
  "assets/css/images/overlay-pattern.png",
  "assets/blue-background.jpg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
  "questions/cardiology.json",
  "questions/endocrinology.json",
  "questions/final1.json",
  "questions/final10.json",
  "questions/final2.json",
  "questions/final3.json",
  "questions/final4.json",
  "questions/final5.json",
  "questions/final6.json",
  "questions/final7.json",
  "questions/final8.json",
  "questions/final9.json",
  "questions/gastroinstestinal.json",
  "questions/gynaecology.json",
  "questions/mental-health.json",
  "questions/musculoskeletal.json",
  "questions/neurology.json",
  "questions/pediatrics.json",
  "questions/renal-reproductive.json",
  "questions/respiratory.json"
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    // Cache individually so one optional asset cannot abort the entire install.
    await Promise.allSettled(APP_SHELL.map(async url => {
      try { await cache.add(new Request(url, {cache:'reload'})); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('pbx-nclex-pwa-') && ![APP_CACHE,RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (_) {
    return (await cache.match(request)) || (await caches.match(request));
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const response = await networkFirst(request);
      return response || (await caches.match('index.html')) || new Response('Offline', {status:503, headers:{'Content-Type':'text/plain'}});
    })());
    return;
  }

  const path = url.pathname;
  const isData = path.includes('/questions/') || path.endsWith('/data/tests.json');
  const isMedia = /\.(?:png|jpe?g|gif|webp|svg|mp4|webm|woff2?)$/i.test(path);
  if (isData) {
    event.respondWith((async () => (await networkFirst(request)) || new Response('Offline data unavailable', {status:503}))());
    return;
  }
  if (isMedia) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil(fetch(request).then(async response => {
        if (response && response.ok) (await caches.open(RUNTIME_CACHE)).put(request, response.clone()).catch(() => {});
      }).catch(() => {}));
      return cached;
    }
    return (await networkFirst(request)) || new Response('Offline', {status:503});
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
