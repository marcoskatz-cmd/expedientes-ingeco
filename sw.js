// Service worker: guarda los archivos del sistema para que abra al instante y funcione aunque la señal sea mala.
// Estrategia: devuelve lo guardado y, en paralelo, baja la versión nueva para la próxima vez.
// Las llamadas a la API (script.google.com) no se guardan acá: eso lo maneja la app con localStorage.
const CACHE = 'expedientes-v17';
const ARCHIVOS = ['./', 'index.html', 'app.js?v=16', 'estilos.css?v=16', 'ayuda.html', 'manifest.webmanifest', 'icono.svg', 'logo.png'];
// Estilo común de la App INGECO: red primero (siempre la última), caché solo sin señal.
const COMUN = 'https://marcoskatz-cmd.github.io/app-ingeco/ingeco.';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'GET' && e.request.url.startsWith(COMUN)) {
    e.respondWith(fetch(e.request).then(r => { if (r && r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); } return r; }).catch(() => caches.match(e.request)));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const guardado = await c.match(e.request, { ignoreSearch: false });
      const red = fetch(e.request).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
      return guardado || (await red) || new Response('Sin conexión', { status: 503 });
    })
  );
});
