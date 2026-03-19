const CACHE_NAME = 'defense-vms-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  // Não fazemos cache dos modelos da IA aqui pois são muito grandes, 
  // eles serão cacheados nativamente pelo navegador.
];

// Instalação do Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache aberto com sucesso');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptador de requisições (Estratégia: Network First, caindo para Cache)
self.addEventListener('fetch', (event) => {
  // Ignora requisições de câmeras (MJPEG/Video) e Firestore para não congelar imagens ao vivo
  if (event.request.url.includes('firestore') || 
      event.request.url.includes('video') || 
      event.request.url.includes('cgi-bin')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
