const CACHE_NAME = 'studentconnect-v1.1.3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './assets/logo.png',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Supabase/Google APIs: Network Only
  if (url.hostname.includes('supabase') || url.hostname.includes('googleapis')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Core App Files (HTML, JS, CSS): Network First
  const isCoreFile = event.request.destination === 'document' || 
                     url.pathname.endsWith('.js') || 
                     url.pathname.endsWith('.css');

  if (isCoreFile) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Static Assets (Images, Manifest): Cache First
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(netResponse => {
        if (netResponse.status === 200) {
          const clone = netResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return netResponse;
      });
    })
  );
});
