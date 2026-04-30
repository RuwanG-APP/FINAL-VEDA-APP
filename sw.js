const CACHE_NAME = 'veda-shabdakooshaya-v1';
const ASSETS = [
  'index.html',
  'data.js',
  'head.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});