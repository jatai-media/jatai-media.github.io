// main.ts - liga os controles fixos e da a partida

// ============================================================== arranque

import { $, api, closeMenu, toast, state } from "./core";
import { abreMenuPrincipal } from "./menu";
import { ligaAutossalva } from "./projeto";
import { layout, setLayout } from "./panels";
import { mostraInicio, criaProjeto } from "./tela-inicial";
import { closeHush } from "./panel-timeline";
import { keyOf, shortcutFor, loadShortcuts, closeKeys, captureKey } from "./atalhos";
import { sanitize, loadHush, loadCanvas, adoptNewPanels } from "./prefs";

$("btnMenu").addEventListener("click", abreMenuPrincipal);
$("inicioCriar").addEventListener("click", criaProjeto);
document.addEventListener("click", () => {
  closeMenu();
  closeHush();
  closeKeys();
});

// Isto e um aplicativo, e nao uma pagina: o menu de "Voltar / Atualizar /
// Salvar como" do WebView2 nao tem o que fazer aqui, e atrapalha justamente
// onde o botao direito e nosso, como na linha de volume. Quem quiser o menu
// para si mesmo chama preventDefault antes; este e o ultimo a falar.
document.addEventListener("contextmenu", (e) => e.preventDefault());

// O tratador nao conhece atalho nenhum: ele pergunta a lista. Cada gesto novo
// entra em atalhos.js, e nao aqui - foi por isso que a lista existe.
document.addEventListener("keydown", (e) => {
  // O painel de atalhos, quando esta esperando uma tecla, tem preferencia
  // sobre tudo: a tecla que se esta escolhendo nao pode disparar o que ela
  // ainda faz.
  if (captureKey(e)) return;

  // Digitando num campo, as teclas sao do campo - e o texto que se edita na
  // propria tela e um campo como outro qualquer, embora nao seja um <input>.
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if (document.activeElement && document.activeElement.isContentEditable) return;

  const atalho = shortcutFor(keyOf(e));
  if (!atalho) return;
  e.preventDefault();
  atalho.faz();
});

(async function boot() {
  const prefs = await api.getPrefs();

  // Sem a pasta servida, cada quadro da previa volta a atravessar a ponte como
  // codigo - oitenta KB de JavaScript compilados por quadro - e a reproducao
  // engasga. Melhor dizer do que deixar parecer lentidao sem causa.
  if (prefs && prefs.quadrosServidos === false) {
    toast("Sem a pasta de quadros do WebView2: a previa vai pelo caminho lento.");
  }

  if (prefs) loadHush(prefs.hush);
  if (prefs) loadCanvas(prefs.canvas);
  if (prefs) loadShortcuts(prefs.atalhos);
  if (prefs && prefs.seguir === "1") state.follow = true;
  if (prefs) state.falaReconhecida = prefs.falaReconhecida === true;
  if (prefs) state.narradorVoz = prefs.narradorVoz || "";

  if (prefs && prefs.layout) {
    try {
      const saved = sanitize(JSON.parse(prefs.layout));
      if (saved) setLayout(saved);
    } catch (err) { /* layout corrompido: fica o padrao */ }
  }
  adoptNewPanels(prefs && prefs.paineisVistos2, !!(prefs && prefs.layout));

  // O editor nao arranca em nada: arranca num TRABALHO. A tela inicial e a
  // primeira coisa que aparece, e o dock so e montado quando houver projeto.
  await mostraInicio();
  ligaAutossalva();

  // O modelo que recorta o fundo esta instalado? Perguntado uma vez, aqui: o
  // painel de Efeitos precisa saber disso para dizer o que falta, e nao para
  // descobrir quando alguem ja tiver clicado e esperado.
  const fu = await api.fundoTem();
  state.fundo.modelo = !!(fu && fu.modelo);

  // Com a pagina de pe, o C++ firma o alvo do arrasto. So agora: antes disto a
  // navegacao ainda refazia as janelas internas do WebView2 por baixo dele.
  const drop = await api.ready();
  if (drop && drop.arrastarArquivos === false) {
    toast("Arrastar arquivos para a janela nao funcionou - use Importar.");
  }
})();
