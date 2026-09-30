// Service worker do isolamento: repassa cada pedido desta pasta e acrescenta
// os cabecalhos COOP/COEP na resposta. Nao guarda nada em cache. (ver coi.js)

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  var pedido = e.request;
  if (pedido.cache === 'only-if-cached' && pedido.mode !== 'same-origin') return;

  e.respondWith(fetch(pedido).then(function (resposta) {
    if (resposta.status === 0) return resposta; // opaca: nao ha o que mexer
    var h = new Headers(resposta.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers: h });
  }));
});
