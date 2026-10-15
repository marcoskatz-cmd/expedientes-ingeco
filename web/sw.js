// Service worker mínimo: sin caché HTTP (igual que app-ingeco). Solo para que la PWA sea instalable.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
