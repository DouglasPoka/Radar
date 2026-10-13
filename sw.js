// Service worker do Radar: permite "instalar" o app e abrir mais rápido.
// Arquivos do próprio site: tenta a internet primeiro (pega sempre a versão nova) e usa a cópia guardada se estiver sem sinal.
// Dados de mercado (Binance, Hyperliquid...) nunca passam por aqui.
const CACHE = "radar-v1";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copia = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copia)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request)));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: "window"}).then(l => (l.length ? l[0].focus() : self.clients.openWindow("./"))));
});
