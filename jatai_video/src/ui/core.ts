// core.ts - ponte com o backend, avisos, helpers e o estado da sessao

import { marcaSujo } from "./projeto";
import { refresh } from "./dock-view";
import { removeMedia } from "./panel-media";
import { seekCommit, tick } from "./panel-player";
import { pintaMoldura } from "./panel-imagem";
import { closeHush } from "./panel-timeline";
import { closeKeys } from "./atalhos";
import { strip } from "./prefs";

import { backend, type Ponte } from "../backend";

export function $(id?) { return document.getElementById(id); }

// A ponte. No jat.ai em C++ ela chegava em window com o prefixo "jt"; aqui
// quem responde e o backend do navegador, com as mesmas perguntas e as
// mesmas respostas - a interface nao precisa saber que o C++ saiu.
export const api: Ponte = backend;

// Os paineis que falam do que esta escolhido. A lista mora aqui, e nao na mao
// de cada chamada, porque cada copia dela e um painel que um dia fica para
// tras: foi assim que o de Audio ja mostrou um clipe e mexeu em outro, e foi
// assim que o de Imagem continuou dizendo o nome do clipe anterior depois de
// se escolher outro na linha do tempo.
export const SELECTION_PANELS = ["timeline", "props", "audio", "texto", "imagem",
                          "efeitos"];

// Onde esta camada fica na pilha, como numero para o navegador empilhar.
//
// A previa desenha o video e o texto em duas caixas irmas - uma cheia de <img>,
// outra cheia de <div> - e por muito tempo a segunda ficou depois da primeira
// no HTML, o que punha TODO texto na frente de TODO video. Isso nao era uma
// escolha de desenho: era a ordem em que as duas caixas tinham sido escritas, e
// ela tornava impossivel mandar uma letra para tras de alguem.
//
// Agora as duas caixas nao empilham nada: cada peca leva o proprio numero, e
// quem decide e a pilha das PISTAS, igual a exportacao sempre fez. Para isso as
// duas caixas precisam continuar sem z-index proprio - ganhar um faria delas
// andares fechados, e o texto voltaria a flutuar por cima de tudo.
//
// A pista do topo da lista e a da frente, entao o numero e o INVERSO do indice.
export function stackZ(clip?) {
  const i = state.tracks.findIndex((t) => t.id === clip.track);
  return i < 0 ? 0 : state.tracks.length - i;
}

// Texto de fora indo para dentro de HTML. Quase todo painel daqui usa
// textContent, que ja escapa sozinho; o da voz monta a lista de frases e de
// microfones como HTML, e ai o nome de um dispositivo com "&" ou um texto
// colado com "<" quebrariam a pagina inteira - ou pior, executariam.
export function escapeHtml(s?) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function refreshSelection(extra?) {
  refresh(SELECTION_PANELS.concat(extra || []));
  // A moldura da imagem escolhida segue a escolha. Fica fora do refresh
  // porque o reprodutor nao entra na lista acima: repinta-lo a cada troca de
  // selecao trocaria a imagem debaixo da mao no meio de um arrasto.
  if (typeof pintaMoldura === "function") pintaMoldura();
}

// Todo lugar que muda a selecao passa por aqui. Os paineis que dependem dela
// sao sempre os mesmos, e cada chamada com a sua lista a mao foi exatamente o
// que deixou o painel de audio mostrando um clipe e mexendo em outro.
export function select(what?, extra?) {
  if (what && "clip" in what) {
    // Trocar de clipe larga o ponto que estava selecionado no anterior.
    if (state.pickedClip !== what.clip) state.pickedPoint = 0;
    state.pickedClip = what.clip;
    // Escolher um clipe por aqui desfaz a selecao multipla: quem quer somar
    // segura Ctrl, e quem quer uma caixa a arrasta na linha do tempo.
    state.picked = new Set(what.clip >= 0 ? [what.clip] : []);
  }
  if (what && "media" in what) state.pickedMedia = what.media;
  refreshSelection(["player"].concat(extra || []));
}

// ------------------------------------------------------------- menu solto
//
// O menu do botao direito. Vive preso ao body, e nao ao elemento que o
// pediu: dentro de um clipe ele seria cortado pelo `overflow: hidden` da
// linha do tempo.

export let openMenu = null;
// Os submenus abertos, do mais externo para o mais interno. Ficam a parte
// porque cada um e um elemento solto no body - preso ao pai, o menu de um
// item la embaixo seria cortado pelo tamanho do menu de cima.
export let openSubs = [];

export function closeMenu() {
  fechaSubs(0);
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
}

// Fecha os submenus a partir do nivel `de`. Passar do mouse por outro item do
// mesmo nivel fecha o que aquele item tinha aberto, e so ele.
export function fechaSubs(de?) {
  while (openSubs.length > de) openSubs.pop().remove();
}

// Monta uma folha de menu. `items` e uma lista de:
//     { label, action, disabled }      um item comum
//     { label, tecla }                 com o atalho escrito a direita
//     { label, marcado }               com um tique na frente
//     { label, sub: [...] }            que abre outra folha ao lado
//     { sep: true }                    uma linha divisoria
//     { titulo: "..." }                um cabecalho
export function montaFolha(items?, nivel?) {
  const menu = document.createElement("div");
  menu.className = "menu floating";

  items.forEach((it) => {
    if (it.sep) {
      const hr = document.createElement("div");
      hr.className = "menu-sep";
      menu.appendChild(hr);
      return;
    }
    if (it.titulo) {
      const t = document.createElement("div");
      t.className = "menu-title";
      t.textContent = it.titulo;
      menu.appendChild(t);
      return;
    }

    const b = document.createElement("button");
    b.className = "menu-item" + (it.sub ? " tem-sub" : "");
    b.disabled = !!it.disabled;

    if (it.marcado !== undefined) {
      const tique = document.createElement("span");
      tique.className = "tick" + (it.marcado ? "" : " off");
      tique.innerHTML = it.marcado ? "&check;" : "&nbsp;";
      b.appendChild(tique);
    }

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = it.label;
    b.appendChild(nm);

    // A tecla vai a direita, longe do nome: quem procura o comando le a
    // esquerda, e quem quer decorar o atalho olha a coluna da direita.
    if (it.tecla) {
      const k = document.createElement("span");
      k.className = "menu-tecla";
      k.textContent = it.tecla;
      b.appendChild(k);
    }
    if (it.sub) {
      const seta = document.createElement("span");
      seta.className = "menu-seta";
      seta.innerHTML = "&rsaquo;";
      b.appendChild(seta);
    }

    // Passar o mouse por um item fecha o submenu que o vizinho tinha aberto -
    // senao ficariam duas folhas abertas no mesmo nivel, uma por cima da outra.
    b.addEventListener("mouseenter", () => {
      fechaSubs(nivel);
      if (it.sub && !b.disabled) abreSub(b, it.sub, nivel);
    });

    b.addEventListener("click", (e) => {
      if (it.sub) {
        // Num submenu, o clique e so outro jeito de pedir o que o mouse ja
        // pediu: abre, e nao fecha o menu inteiro.
        e.stopPropagation();
        fechaSubs(nivel);
        abreSub(b, it.sub, nivel);
        return;
      }
      // Fecha o que estava aberto ANTES de agir, e nao deixa o clique subir.
      //
      // Quem fechava era o tratador de clique do document - mas ele roda
      // DEPOIS, e entao desfazia o que a acao tinha acabado de abrir: o item
      // "Atalhos do teclado" criava o painel e o document o fechava no mesmo
      // clique, de modo que apertar o comando nao mostrava nada.
      closeMenu();
      closeHush();
      closeKeys();
      e.stopPropagation();
      if (!it.disabled && it.action) it.action();
    });

    menu.appendChild(b);
  });

  document.body.appendChild(menu);
  return menu;
}

// Poe a folha na tela sem deixa-la sair pela borda.
export function poeFolha(menu?, x?, y?) {
  const r = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - r.width - 6);
  const top = Math.min(y, window.innerHeight - r.height - 6);
  menu.style.left = Math.max(4, left) + "px";
  menu.style.top = Math.max(4, top) + "px";
}

// O submenu nasce ao lado do item que o chamou, e sobe se nao couber.
export function abreSub(item?, items?, nivel?) {
  const folha = montaFolha(items, nivel + 1);
  const r = item.getBoundingClientRect();
  poeFolha(folha, r.right - 4, r.top - 6);
  openSubs.push(folha);
}

export function showMenu(x?, y?, items?) {
  closeMenu();
  const menu = montaFolha(items, 0);
  poeFolha(menu, x, y);
  openMenu = menu;
}

// O mesmo menu, mas pendurado embaixo de um botao - e nao onde o mouse
// clicou. E o que a barra de cima usa.
export function showMenuSob(botao?, items?) {
  const r = botao.getBoundingClientRect();
  showMenu(r.left, r.bottom + 6, items);
}

// ============================================================== desfazer
//
// A linha do tempo inteira cabe num punhado de numeros - pistas, clipes,
// pontos de volume - entao o historico guarda copias dela por inteiro, e nao
// a descricao de cada gesto. E mais memoria e menos codigo, e sobretudo nao
// existe o gesto que alguem esqueceu de ensinar a voltar: o que entrou no
// estado volta, seja de que botao tiver vindo.
//
// A midia fica de fora. Tirar um arquivo do projeto o tira tambem do C++, e um
// clipe restaurado apontaria para um id que nao existe mais - por isso aquilo
// limpa o historico em vez de fingir que da para voltar.

export const HISTORY_MAX = 60;

export function snapshot() {
  return JSON.stringify({
    tracks: state.tracks, clips: state.clips,
    nextId: state.nextId, picked: state.pickedClip,
    // Um Set nao atravessa o JSON; vai como lista e volta como Set.
    sel: [...state.picked],
  });
}

// Guarda um retrato ja tirado. Serve a quem so descobre que mexeu depois de
// ter mexido - o arrasto que pode nao sair do lugar, o juntar que pode nao ter
// buraco nenhum para fechar.
export function rememberSnapshot(text?) {
  // Quem guarda um retrato e porque vai mexer. Marcar aqui cobre todos os
  // gestos de uma vez, inclusive os que ainda nao existem - pelo mesmo motivo
  // que o desfazer guarda o estado inteiro em vez de descrever cada gesto.
  if (typeof marcaSujo === "function") marcaSujo();
  state.undo.push(text);
  if (state.undo.length > HISTORY_MAX) state.undo.shift();
  // Um caminho novo apaga o futuro que havia: nao ha como refazer por cima do
  // que acabou de ser feito de outro jeito.
  state.redo.length = 0;
}

// Chamado ANTES de mexer: o que se guarda e o mundo como ele estava.
export function remember() { rememberSnapshot(snapshot()); }

export function forgetHistory() {
  state.undo.length = 0;
  state.redo.length = 0;
}

export function restoreState(text?) {
  const s = JSON.parse(text);
  state.tracks = s.tracks;
  state.clips = s.clips;
  state.nextId = s.nextId;
  state.pickedClip = s.picked;
  state.picked = new Set(s.sel || (s.picked >= 0 ? [s.picked] : []));
  // O ponto que estava escolhido pertencia a um clipe que talvez nem exista
  // mais; e um id, nao uma posicao, e ressuscita-lo seria adivinhacao. Vale
  // para as duas linhas, a de volume e a de animacao.
  state.pickedPoint = 0;
  state.pickedAnim = 0;

  // As tiras e as ondas ficam: sao guardadas por id de clipe, e os ids voltam
  // com eles. As que nao servirem mais se refazem sozinhas ao serem
  // desenhadas - e ate la mostram o trecho certo, recortado.
  refreshSelection(["player"]);
  seekCommit();
}

export function undo() {
  if (!state.undo.length) { toast("Nada para desfazer."); return; }
  state.redo.push(snapshot());
  restoreState(state.undo.pop());
}

export function redo() {
  if (!state.redo.length) { toast("Nada para refazer."); return; }
  state.undo.push(snapshot());
  restoreState(state.redo.pop());
}

// ---------------------------------------------------- os pedacos de um clipe
//
// Um clipe sempre foi uma JANELA sobre o arquivo: entra em `inPoint`, dura
// `len`. Isso basta enquanto o que se ve e um trecho continuo do que foi
// gravado - e nao bastava para fundir.
//
// Depois de cortar nas pausas, as pecas ficam encostadas na linha do tempo mas
// PULAM dentro do arquivo: a pausa que saiu esta entre elas. Uma janela so nao
// representa um pulo, e era por isso que fundir apenas as amarrava num bloco.
//
// Agora o clipe guarda a lista do que toca: `pecas`, cada uma com o seu ponto
// de entrada e a sua duracao. Quem tem uma peca so nao guarda lista nenhuma -
// e a janela de sempre, e todo o resto do programa continua valendo.
//
// O tempo DO CLIPE corre sem pulos, de zero a `len`. Os pulos existem so na
// travessia para o arquivo, que e o que `clipSourceAt` faz.

export function isFused(c?) { return !!(c && c.pecas && c.pecas.length > 1); }

// Quantas vezes mais rapido o clipe corre. Dois quer dizer que um segundo da
// linha do tempo consome dois segundos de arquivo - e por isso o clipe ocupa
// metade do espaco que ocuparia.
//
// As `pecas` guardam SEMPRE segundos de arquivo: sao a descricao do material.
// A duracao na linha e que sai delas, dividida pela velocidade.
export function clipSpeed(c?) {
  const v = c && typeof c.vel === "number" ? c.vel : 1;
  return v > 0.01 ? v : 1;
}

// Os pedacos, com o lugar de cada um no tempo do clipe: `a` e `b`.
export function clipPieces(c?) {
  const v = clipSpeed(c);
  const crus = c.pecas && c.pecas.length
      ? c.pecas : [{ in: c.inPoint || 0, len: c.len * v }];
  const out = [];
  let at = 0;
  crus.forEach((p, i) => {
    // `len` e do arquivo; `dur` e o que ele ocupa na linha do tempo.
    const dur = p.len / v;
    out.push({ i: i, in: p.in, len: p.len, dur: dur, a: at, b: at + dur });
    at += dur;
  });
  return out;
}

// Onde, dentro do arquivo, cai o instante `t` contado do comeco do clipe.
// Passado o fim, devolve o ultimo instante que existe - e o que faz a agulha
// parada na borda mostrar o ultimo quadro, e nao um vazio.
export function clipSourceAt(c?, t?) {
  const v = clipSpeed(c);
  const ps = clipPieces(c);
  let resto = Math.max(0, t);
  for (let i = 0; i < ps.length; ++i) {
    // O resto anda no tempo do clipe; dentro do arquivo ele anda `v` vezes
    // mais - e por isso a multiplicacao.
    if (resto < ps[i].dur || i === ps.length - 1) return ps[i].in + resto * v;
    resto -= ps[i].dur;
  }
  return c.inPoint || 0;
}

// Guarda a lista no clipe. Sobrando um pedaco so, ela some: o clipe volta a
// ser a janela simples de sempre, e nada mais precisa saber que um dia ele foi
// fundido.
export function setPieces(c?, pecas?) {
  const juntos = [];
  pecas.forEach((p) => {
    if (p.len <= 1e-6) return;
    const ult = juntos[juntos.length - 1];
    // Pedacos seguidos DENTRO do arquivo sao um pedaco so: e o caso de fundir
    // um corte que nunca tirou nada.
    if (ult && Math.abs(ult.in + ult.len - p.in) < 1e-3) ult.len += p.len;
    else juntos.push({ in: p.in, len: p.len });
  });

  // A duracao na linha: o material que ele toca, na velocidade em que toca.
  c.len = juntos.reduce((soma, p) => soma + p.len, 0) / clipSpeed(c);
  if (juntos.length <= 1) {
    c.inPoint = juntos.length ? juntos[0].in : (c.inPoint || 0);
    delete c.pecas;
  } else {
    c.inPoint = juntos[0].in;   // quem nao souber de pecas ve a primeira
    c.pecas = juntos;
  }
  return c;
}

// ------------------------------------------------------- a selecao multipla

export function isPicked(id?) { return state.picked.has(id); }

// As pecas que formam o mesmo bloco. Sem bloco, o clipe e o proprio bloco.
//
// Um bloco nao funde a midia - nao teria como: depois de tirar as pausas, as
// pecas seguem coladas na linha mas com pulos dentro do arquivo, e uma janela
// so nao representa um pulo. O que ele funde e o MANUSEIO: escolher, mover,
// apagar e descartar passam a valer para o conjunto, e na tela ele se desenha
// como uma peca unica, sem as costuras internas.
export function groupOf(c?) {
  if (!c) return [];
  if (!c.grupo) return [c];
  return state.clips.filter((x) => x.grupo === c.grupo);
}

// Soma ou tira um bloco inteiro da selecao.
export function togglePickGroup(c?) {
  const bloco = groupOf(c);
  if (isPicked(c.id)) {
    bloco.forEach((x) => state.picked.delete(x.id));
    if (!state.picked.has(state.pickedClip)) {
      const resto = state.clips.find((x) => state.picked.has(x.id));
      state.pickedClip = resto ? resto.id : -1;
      state.pickedPoint = 0;
    }
  } else {
    bloco.forEach((x) => state.picked.add(x.id));
    state.pickedClip = c.id;
    state.pickedPoint = 0;
  }
}

// A caixa de selecao e o clique pegam blocos inteiros: meia duzia de pecas
// escolhida pela metade desmancharia a ideia de bloco no primeiro arrasto.
export function widenToGroups(ids?) {
  const out = new Set(ids);
  state.clips.forEach((c) => {
    if (c.grupo && out.has(c.id)) groupOf(c).forEach((x) => out.add(x.id));
  });
  return out;
}

export function pickedClips() {
  return state.clips.filter((c) => state.picked.has(c.id));
}

// Soma ou tira um clipe da selecao - o Ctrl+clique. O principal passa a ser o
// que acabou de entrar; saindo o principal, sobra o primeiro que restou.
export function togglePick(id?) {
  if (state.picked.has(id)) {
    state.picked.delete(id);
    if (state.pickedClip === id) {
      const resto = state.clips.find((c) => state.picked.has(c.id));
      state.pickedClip = resto ? resto.id : -1;
      state.pickedPoint = 0;
    }
  } else {
    state.picked.add(id);
    state.pickedClip = id;
    state.pickedPoint = 0;
  }
}

export let toastTimer = null;
export function toast(msg?) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3400);
}

// Sem isso um erro de JS falha em silencio e o app parece so nao responder.
window.addEventListener("error", (e) => toast("Erro: " + e.message));
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  toast("Erro: " + (r && r.message ? r.message : r));
});

export function clamp(v?, a?, b?) { return (v < a ? a : v > b ? b : v); }

// setPointerCapture recusa ponteiros que nao estao ativos (e lanca). Falhar
// aqui nao deve interromper o arrasto.
export function capture(el?, id?) {
  try { el.setPointerCapture(id); } catch (e) { /* segue sem captura */ }
}

export function fmtTime(sec?, tenths?) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const base = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  return tenths ? base + "." + Math.floor((sec % 1) * 10) : base;
}

export function fmtSize(bytes?) {
  if (!bytes) return "";
  const u = ["B", "KB", "MB", "GB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; ++i; }
  return (i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)) + " " + u[i];
}

export const state = {
  // Campos que os paineis criavam na hora, no JavaScript. Declarados aqui para
  // o TypeScript saber que existem; quem os preenche continua sendo o painel.
  narradorVoz: "",            // a voz escolhida da ultima vez (preferencia)
  narracao: null,             // panel-narrador: o que se escreveu e a previa
  vozes: null,                // panel-narrador: a lista, quando ja chegou
  vozesErro: "",
  export: null,               // exportar: tamanho, qualidade, andamento

  media: [], pickedMedia: -1,

  // Verdadeiro enquanto um arrasto de arquivos do Explorador passa pela
  // janela. Quem avisa e o C++, que e quem recebe o gesto.
  dragging: false,

  // Em que trabalho se esta, e se ha algo por gravar. Sem projeto aberto, o
  // editor nem aparece - quem manda na tela e a inicial.
  projeto: null,
  sujo: false,

  tracks: [],          // pistas da linha do tempo
  clips: [],           // {id, track, start, len, name, kind, media}

  // A selecao da linha do tempo. `picked` e o conjunto inteiro; `pickedClip` e
  // o principal - o ultimo escolhido - e e dele que os paineis de propriedades
  // e de audio falam, porque nao ha o que mostrar de cinco clipes ao mesmo
  // tempo. Com um so escolhido, os dois dizem a mesma coisa.
  picked: new Set(),
  pickedClip: -1,

  // O proximo numero de bloco. Zero nunca e usado: e o "sem bloco".
  nextGroup: 1,
  pos: 0, playing: false,
  // Relogio do som: a ultima posicao recebida e quando ela chegou.
  clockPos: 0, clockAt: 0,
  // Falso quando nao ha placa: o cursor corre pelo relogio da pagina.
  audioClock: true, audioWarned: false,
  // A janela acompanha a agulha durante a reproducao. E uma escolha, e nao um
  // padrao: quem esta ajustando um corte quer a vista parada onde ela esta,
  // mesmo com o cursor correndo longe.
  follow: false,

  // Verdadeiro enquanto a mao arrasta a agulha. Seguir a agulha nesse momento
  // rolaria a regua debaixo do proprio dedo.
  scrubbing: false,

  // Os ajustes do corte automatico. Ficam a mao porque material nenhum e
  // igual a outro: uma gravacao com ar condicionado pede um nivel mais baixo,
  // uma fala pausada pede uma pausa minima maior, e nao ha um numero que sirva
  // aos dois. Vao para o disco - quem achou o ponto certo do seu microfone nao
  // deve ter de achar de novo amanha.
  // `sens` e a confianca minima da rede para contar como fala; `db` e o nivel
  // da regua antiga. So um dos dois aparece no painel, conforme haja ou nao o
  // reconhecedor - mas os dois ficam guardados, para quem trocar de maquina
  // nao perder o ajuste que tinha.
  hush: { min: 0.35, db: -38, pad: 0.08, sens: 0.5 },

  // Verdadeiro quando o reconhecedor de fala esta a mao. Quem responde e o
  // C++, no arranque: e ele que sabe se o modelo e a biblioteca estao ali.
  falaReconhecida: false,

  // As pausas da ultima sondagem, para a linha do tempo pinta-las por cima do
  // clipe enquanto os controles estao abertos: e vendo onde elas caem que se
  // descobre se o ajuste esta bom, e nao lendo decibeis.
  hushGaps: null,

  // Verdadeiro quando a linha do tempo desenha a VOZ isolada em vez da
  // mistura. Vale para os arquivos que ja tiveram a voz separada; nos outros
  // nao ha o que trocar.
  voice: false,

  // Verdadeiro enquanto o separador de voz roda: sao minutos, e dois pedidos
  // ao mesmo tempo disputariam o mesmo modelo e a mesma placa.
  separating: false,
  // O recorte do fundo: se o modelo esta instalado - perguntado uma vez, na
  // partida, para o painel poder dizer o que falta em vez de falhar no meio -
  // e o andamento da passada, quando ha uma.
  fundo: { modelo: false, rodando: false, nome: "", feito: 0, total: 0 },

  // O historico: cada entrada e a linha do tempo inteira, em texto.
  undo: [], redo: [],

  // O ultimo clipe copiado, guardado inteiro. Vive so nesta sessao: colar num
  // projeto aberto amanha apontaria para um arquivo que pode nao estar mais
  // na cesta.
  clipboard: null,

  // Onde foi o ultimo corte. E para ca que a agulha volta quando se pede para
  // juntar e conferir - sem isto, depois de fechar os buracos nao haveria como
  // saber onde estava a emenda que se quer ouvir.
  lastCut: null,

  // A area de visao do projeto - o quadro em que a montagem e enquadrada. Nao
  // e a resolucao deste ou daquele arquivo: um video de celular e um de camera
  // podem entrar no mesmo projeto, e e este tamanho que diz qual dos dois vai
  // sobrar nas bordas. Fica em 1920x1080 ate alguem dizer o contrario, que e o
  // que a maioria do material de camera ja e.
  canvas: { w: 1920, h: 1080 },

  zoom: 26,            // pixels por segundo
  nextId: 1,

  // Onde a linha do tempo estava rolada. Cada redesenho do painel refaz o
  // elemento que rola, e com ele a rolagem voltaria a zero - ou seja, para
  // perto da agulha, a cada corte dado la na frente. E o olhar de quem edita
  // que manda na janela, e nao o cursor.
  tlScroll: { x: 0, y: 0, w: 0 },   // w: a largura da janela que rola

  // A ferramenta da linha do tempo: "select" arrasta e escolhe, "razor"
  // corta. E um modo, e nao um botao de acao, porque cortar vem em series -
  // quem tira os silencios de uma fala corta vinte vezes seguidas.
  tool: "select",

  // Miniaturas ja recebidas, por id de midia; "" enquanto o pedido corre, e
  // null quando o item nao tem imagem para mostrar.
  thumbs: new Map(),

  // Picos por clipe, como vieram do C++: {t0, t1, lo, hi, peak}. Por clipe, e
  // nao por arquivo: depois de um corte, os dois pedacos sao do mesmo arquivo
  // e pedem trechos diferentes. O C++ resume o arquivo uma vez so e reamostra,
  // entao pedir duas janelas do mesmo arquivo nao decodifica nada de novo.
  waves: new Map(),
  wavePending: new Set(),

  // O ponto da linha de volume que esta selecionado, por id. Zero e nenhum.
  pickedPoint: 0,

  // O mesmo para a linha de animacao do enquadramento: o ponto escolhido na
  // faixa de cima do clipe. Sao duas linhas diferentes no mesmo clipe, e por
  // isso duas escolhas - apagar um ponto de volume nao pode levar junto o
  // ponto de movimento que estivesse por perto.
  pickedAnim: 0,

  // Tiras de quadros, por clipe: {t0, t1, count, url}. Sao por clipe, e nao
  // por midia, porque dois clipes do mesmo arquivo mostram trechos diferentes.
  strips: new Map(),
  stripPending: new Set(),

  // A previa do reprodutor, uma camada por clipe de video sob a agulha:
  // {url, key, inflight, pending, error, at} por id de clipe. `w` e `h` sao a
  // medida da tela, sem o zoom - e dela que sai o tamanho de cada pedido.
  preview: { camadas: new Map(), w: 640, h: 360 },
};
