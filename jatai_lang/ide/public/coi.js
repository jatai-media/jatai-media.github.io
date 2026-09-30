// Isolamento de origem (COOP/COEP) onde o servidor nao o manda - o GitHub Pages.
//
// Com a pagina isolada ela ganha SharedArrayBuffer, e o programa rodando no
// worker pode PARAR esperando o que se digita no terminal (io.input). Sem
// isso a entrada tem de vir pronta, do painel Entrada.
//
// Quem acrescenta os cabecalhos e o coi-sw.js, um service worker que vale so
// para esta pasta. Na primeira visita ele ainda nao controla a pagina: ela
// recarrega uma vez, e dai em diante ja abre isolada.
(function () {
  if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;

  var base = document.currentScript.src.replace(/coi\.js(\?.*)?$/, '');
  var chave = 'jatai.ide.coi';
  var tentou = false;
  try { tentou = sessionStorage.getItem(chave) === '1'; } catch (e) {}

  navigator.serviceWorker.register(base + 'coi-sw.js', { scope: base }).then(function (reg) {
    // ja controlada e ainda assim sem isolamento: o navegador nao deixa; segue sem
    if (navigator.serviceWorker.controller || tentou) return;
    try { sessionStorage.setItem(chave, '1'); } catch (e) {}
    var sw = reg.installing || reg.waiting || reg.active;
    if (!sw) return;
    if (sw.state === 'activated') { location.reload(); return; }
    sw.addEventListener('statechange', function () {
      if (sw.state === 'activated') location.reload();
    });
  }).catch(function () { /* sem service worker: a entrada vem do painel */ });
})();
