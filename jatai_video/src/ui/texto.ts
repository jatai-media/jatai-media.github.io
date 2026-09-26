// texto.ts - o texto sobre o video: o clipe, a camada da previa e o painel
//
// Um texto e um clipe como outro qualquer: tem pista, comeco e duracao, e se
// arrasta na linha do tempo como o resto. O que ele nao tem e arquivo - o que
// aparece na tela nasce aqui, e nao do decodificador. Por isso ele mora numa
// pista propria, "texto", que fica no alto da pilha: la ele nao empurra video
// nem audio de lugar, e a ordem da pilha ja diz o que fica na frente.
//
// As medidas sao todas em fracao da area de visao, e nunca em pixels: o mesmo
// texto tem de cair no mesmo lugar num quadro de 1920 e num de 1080, e a
// previa muda de tamanho toda vez que alguem mexe num divisor.

// A caixa e a letra sao duas coisas, e nao uma. O tamanho da letra sai do
// campo Tamanho, e de lugar nenhum mais: puxar a caixa muda a CAIXA - largura,
// altura - e nunca o corpo da fonte. Misturar os dois era o que fazia o texto
// crescer quando so se queria abrir espaco.
//
// `larg` e `alt` sao opcionais. Sem eles, a caixa se ajusta ao que esta
// escrito; puxada uma vez pela mao, ela passa a ter o tamanho que a mao deu, e
// so volta a se ajustar por "Ajustar ao texto".
import { stackZ, select, snapshot, rememberSnapshot, remember, toast, clamp, capture, state } from "./core";
import { refresh } from "./dock-view";
import { screenIn, screenSize, seekCommit } from "./panel-player";
import { ROT_MIN, ROT_MAX } from "./panel-imagem";
import { afterClipChange, addTrack, trackBusy, beginDropDrag } from "./panel-timeline";

export const TEXT_CAIXA_MIN = 0.02;   // fracao da area de visao

export const TEXT_MIN_LEN = 0.3;      // segundos; abaixo disto nao da tempo de ler
export const TEXT_LEN = 4;            // duracao de um texto recem-posto
export const TEXT_TAM_MIN = 0.02;     // altura da letra, em fracao da altura do quadro
export const TEXT_TAM_MAX = 0.5;

// Os modelos sao pontos de partida, e nao formatos fechados: depois de posto,
// tudo neles se muda na tela ou no painel. Existem porque quase todo texto de
// video e um destes cinco, e comecar de um deles poupa cinco ajustes.
export const TEXT_PRESETS = [
  { nome: "Titulo",   txt: "Titulo",          tam: 0.11,  y: 0.20, peso: 700,
    cor: "#ffffff", fundo: "" },
  { nome: "Legenda",  txt: "Legenda",         tam: 0.055, y: 0.86, peso: 500,
    cor: "#ffffff", fundo: "#000000a6" },
  { nome: "Credito",  txt: "Nome\nCargo",     tam: 0.045, y: 0.80, peso: 500,
    cor: "#ffffff", fundo: "", x: 0.24 },
  { nome: "Destaque", txt: "DESTAQUE",        tam: 0.09,  y: 0.5,  peso: 800,
    cor: "#1a1204", fundo: "#f0b429" },
  { nome: "Citacao",  txt: "“uma frase”", tam: 0.07, y: 0.5, peso: 400,
    cor: "#ffffff", fundo: "" },
];

// ------------------------------------------------------------ o clipe

// A faixa que recebe um texto num dado instante. Dois textos ao mesmo tempo
// sao coisa comum - um titulo em cima e um credito embaixo - e eles nao podem
// disputar a mesma faixa: quem chega e o trecho ja esta ocupado sobe para a
// faixa de cima, e nao havendo nenhuma livre, nasce outra.
//
// Sem pista nenhuma ainda, esta e tambem quem cria a primeira: pedir que se
// prepare a faixa antes seria um passo que ninguem adivinha.
export function freeTextTrack(at?, len?, ignorar?, preferida?) {
  const bate = (t) => trackBusy(t.id, at, len, ignorar);

  const pref = preferida != null
      ? state.tracks.find((t) => t.id === preferida && t.kind === "texto") : null;
  if (pref && !bate(pref)) return pref;

  const livre = state.tracks.filter((t) => t.kind === "texto").find((t) => !bate(t));
  return livre || addTrack("texto");
}

// `at` e `trackId` chegam do arrasto; sem eles, o texto entra no cursor, que e
// o que o duplo clique quer dizer. `novaPista` e o pedido de quem largou na
// faixa do fim. A pista, quando nasce, nasce depois do remember(): assim um
// Ctrl+Z so leva embora o texto e a faixa juntos, e nao deixa uma faixa vazia
// para tras.
// `posicao` e o ponto da TELA onde o texto foi largado, em fracao da area de
// visao. Sem ela, vale o lugar do modelo - que e onde um titulo ou uma legenda
// costumam ficar.
// `onde` e o degrau da pilha em que a pista nova deve nascer, quando o texto
// foi solto na beirada de uma pista. Sem ele a pista nova nascia sempre no
// alto, e uma pista de texto no alto so sabe ficar na frente.
export function addText(modelo?, at?, trackId?, novaPista?, posicao?, onde?) {
  remember();
  const start = Math.max(0, typeof at === "number" ? at : state.pos);
  const tr = novaPista ? addTrack("texto", onde)
                       : freeTextTrack(start, TEXT_LEN, null, trackId);
  const c = {
    id: state.nextId++, track: tr.id, start: start,
    len: TEXT_LEN, name: primeiraLinha(modelo.txt), kind: "texto",
    texto: {
      txt: modelo.txt,
      x: posicao ? clamp(posicao.x, 0, 1)
                 : (typeof modelo.x === "number" ? modelo.x : 0.5),
      y: posicao ? clamp(posicao.y, 0, 1) : modelo.y,
      tam: modelo.tam, rot: 0,
      cor: modelo.cor, fundo: modelo.fundo || "", peso: modelo.peso,
    },
  };
  state.clips.push(c);
  select({ clip: c.id, media: -1 }, ["media", "texto"]);
  // O cursor vai ate o texto recem-posto quando ele caiu longe dali: um texto
  // que se acaba de por e para ser visto, e fora do trecho dele a tela nao
  // mostraria nada.
  seekCommit(clamp(state.pos, start, start + c.len - 1e-3));
}

// O nome que vai na etiqueta do clipe. O texto pode ter varias linhas, e a
// etiqueta tem uma so.
export function primeiraLinha(txt?) {
  const t = String(txt || "").split("\n")[0].trim();
  return t || "texto";
}

export function isText(c?) { return !!(c && c.kind === "texto" && c.texto); }

// O giro do texto, em graus. Texto criado antes de a rotacao existir nao tem o
// campo; le-lo por aqui poupa um NaN no meio de uma conta de transformacao,
// que apagaria a caixa da tela.
export function txRot(t?) {
  return t && typeof t.rot === "number" ? t.rot : 0;
}

// O fundo e guardado como o navegador o entende: "#rrggbbaa", cor e
// transparencia no mesmo texto. O seletor de cor do sistema nao conhece o
// "aa", entao o painel edita as duas partes em separado e junta aqui.
export const FUNDO_PADRAO = "#000000a6";

// Tirado o fundo, a cor dele fica guardada em `fundoOff`: quem escolheu um
// amarelo e depois tirou o fundo nao quer escolher o amarelo de novo ao
// devolve-lo.
export function fundoAtual(t?) {
  return t.fundo || t.fundoOff || FUNDO_PADRAO;
}

export function fundoRGB(t?) {
  return fundoAtual(t).slice(0, 7);
}

// Em porcentagem, que e como se fala de opacidade. Fundo sem "aa" e opaco.
export function fundoOpacidade(t?) {
  const aa = fundoAtual(t).slice(7, 9);
  if (!aa) return 100;
  return Math.round(parseInt(aa, 16) / 255 * 100);
}

export function montaFundo(rgb?, pct?) {
  const a = Math.round(clamp(pct, 0, 100) / 100 * 255);
  return rgb + (a < 16 ? "0" : "") + a.toString(16);
}

// Os textos que aparecem num instante. Em ordem de pilha invertida: o de cima
// e desenhado por ultimo, que e o que o poe na frente.
export function textsAt(at?) {
  const ordem = new Map();
  state.tracks.forEach((t, i) => ordem.set(t.id, i));
  return state.clips
    .filter((c) => isText(c) && !c.off && at >= c.start && at < c.start + c.len)
    .sort((a, b) => (ordem.get(b.track) || 0) - (ordem.get(a.track) || 0));
}

export function pickedText() {
  const c = state.clips.find((x) => x.id === state.pickedClip);
  return isText(c) ? c : null;
}

// Arrastar um modelo ate a linha do tempo. O gesto e o mesmo da cesta de
// midia - fantasma seguindo a mao, faixa acesa embaixo - porque para quem
// arrasta as duas coisas sao a mesma: trazer algo para dentro da montagem.
// A tela da previa como alvo de arrasto. Largar um modelo ali e dizer duas
// coisas de uma vez: QUE texto, e ONDE na imagem - o quando vem da agulha, que
// e o instante que se esta vendo.
export function telaComoAlvo(x?, y?) {
  const box = screenIn();
  if (!box) return null;
  const r = box.getBoundingClientRect();
  if (!r.width || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  return {
    el: box, classe: "drop-tela", tela: true,
    ponto: { x: (x - r.left) / r.width, y: (y - r.top) / r.height },
  };
}

export function beginModelDrag(e?, modelo?) {
  beginDropDrag(e, modelo.nome, (drop, at) => {
    // Largado na tela: entra no instante da agulha, no ponto em que a mao o
    // soltou. A faixa fica por conta de freeTextTrack, como em todo texto.
    if (drop.tela) {
      addText(modelo, state.pos, null, false, drop.ponto);
      return;
    }
    // Largado numa pista que nao e de texto, o instante ainda vale: o texto
    // entra numa faixa de texto no mesmo ponto, em vez de o gesto se perder.
    const pista = state.tracks.find((t) => t.id === drop.track);
    const alvo = pista && pista.kind === "texto" ? pista.id : null;
    // `drop.onde` ja vinha da beirada da pista e era jogado fora aqui - era so
    // a midia que o aproveitava. E ele que deixa soltar um texto na beirada de
    // BAIXO do video e ver a pista nascer ali embaixo.
    addText(modelo, at, alvo, drop.nova, null, drop.onde);
  }, telaComoAlvo);
}

// ------------------------------------------------------ a camada da previa
//
// O texto e desenhado por cima do quadro, em HTML, e nao gravado nele. A tela
// da previa ja tem exatamente a proporcao da area de visao, entao uma letra
// com 11% da altura da caixa e uma letra com 11% da altura do quadro - as
// contas todas saem disso.

// A cara da camada, resumida num texto. Redesenhar a cada quadro da
// reproducao seria refazer o DOM sessenta vezes por segundo para nada; assim
// so se refaz quando algo de fato mudou.
export let txKey = "";
export function setTxKey(v?) { txKey = v; }

export function textLayerKey(lista?, alt?) {
  // A PISTA entra na chave. Mudar um texto de pista nao muda nada no que esta
  // escrito nem em onde ele cai na tela - muda so o que fica na frente -, e sem
  // isto a camada se dava por igual e nao se repintava: o texto iria para tras
  // do video no papel e continuaria na frente na tela.
  return alt + "|" + state.pickedClip + "|" +
         state.tracks.map((t) => t.id).join(",") + "|" +
         lista.map((c) => {
    const t = c.texto;
    return [c.id, c.track, t.txt, t.x.toFixed(4), t.y.toFixed(4), t.tam.toFixed(4),
            t.larg || "", t.alt || "", txRot(t), t.cor, t.fundo, t.peso].join("~");
  }).join(";");
}

export function paintTextLayer(raiz?) {
  const box = screenIn(raiz);
  if (!box) return;
  const layer = box.querySelector(".tx-layer");
  if (!layer) return;

  const tam = screenSize(box);
  if (!tam.h) return;   // ainda sem medida: a proxima passada desenha

  const lista = textsAt(state.pos);
  const chave = textLayerKey(lista, tam.h);
  if (chave === txKey) return;
  txKey = chave;

  layer.innerHTML = "";
  lista.forEach((c) => layer.appendChild(buildTextBox(c, box)));
}

// Uma caixa de texto na tela. As alcas - o contorno e o punho do canto - so
// aparecem na escolhida: com tres textos ao mesmo tempo, seis alcas na tela
// esconderiam justamente o que se esta tentando enquadrar.
export function buildTextBox(c?, box?) {
  const t = c.texto;
  const alt = screenSize(box).h;

  const el = document.createElement("div");
  el.className = "tx" + (c.id === state.pickedClip ? " on" : "");
  el.dataset.clip = c.id;
  // O mesmo numero que as camadas de video levam. Um texto numa pista abaixo
  // da do video fica ATRAS dele - e e so por isto que ele pode sumir atras de
  // alguem recortado.
  el.style.zIndex = String(stackZ(c));
  el.style.left = (t.x * 100) + "%";
  el.style.top = (t.y * 100) + "%";
  // Sem medida propria, a caixa e do tamanho do que esta escrito. Com medida,
  // ela e do tamanho pedido - e a letra nao muda nem num caso nem no outro.
  el.style.width = t.larg ? (t.larg * 100) + "%" : "auto";
  el.style.height = t.alt ? (t.alt * 100) + "%" : "auto";
  el.style.fontSize = (t.tam * alt).toFixed(2) + "px";
  el.style.fontWeight = String(t.peso);
  // O -50% e o que ancora a caixa pelo centro; o giro vem depois dele, para a
  // caixa rodar em torno de si mesma e nao descrever um arco pela tela.
  el.style.transform = "translate(-50%, -50%) rotate(" + txRot(t).toFixed(2) + "deg)";
  el.style.color = t.cor;
  if (t.fundo) {
    el.style.background = t.fundo;
    el.style.padding = ".18em .5em";
  } else {
    // Sem fundo, a letra clara sobre um quadro claro some. A sombra nao e
    // enfeite: e o que garante que o texto se leia sobre qualquer imagem.
    el.style.textShadow = "0 1px 3px rgba(0,0,0,.75)";
  }

  const span = document.createElement("span");
  span.className = "tx-txt";
  span.textContent = t.txt;
  el.appendChild(span);

  // As alcas sao da CAIXA: a da direita abre largura, a de baixo abre altura,
  // e a do canto abre as duas. Nenhuma delas mexe na letra.
  if (c.id === state.pickedClip) {
    [["e", "Arraste para mudar a largura da caixa"],
     ["s", "Arraste para mudar a altura da caixa"],
     ["se", "Arraste para mudar largura e altura"]].forEach(([lado, dica]) => {
      const grip = document.createElement("i");
      grip.className = "tx-grip " + lado;
      grip.title = dica;
      grip.addEventListener("pointerdown", (e) => beginTextResize(e, c, el, box, lado));
      el.appendChild(grip);
    });
  }

  el.addEventListener("pointerdown", (e) => beginTextDrag(e, c, el, box));
  el.addEventListener("dblclick", (e) => { e.preventDefault(); editTextInline(c, el); });
  return el;
}

// Arrastar o texto pela tela. As contas sao em fracao da caixa, e nao em
// pixels: assim o texto fica onde foi posto mesmo que a previa mude de
// tamanho depois.
export function beginTextDrag(e?, c?, el?, box?) {
  if (e.button !== 0) return;
  if (el.isContentEditable) return;     // em edicao, o arrasto e do cursor
  e.preventDefault();
  e.stopPropagation();

  // Escolher o texto na tela e escolher o clipe dele na linha do tempo: sao a
  // mesma coisa vista de dois lugares. So que aqui nao se passa por select():
  // ele refaz o reprodutor, e refazer o reprodutor agora trocaria o elemento
  // que esta debaixo da mao - o arrasto morreria no primeiro pixel.
  if (state.pickedClip !== c.id) {
    state.pickedClip = c.id;
    state.picked = new Set([c.id]);
    state.pickedMedia = -1;
    state.pickedPoint = 0;
    el.classList.add("on");
    refresh(["timeline", "props", "texto"]);
  }

  const antes = snapshot();
  const r = box.getBoundingClientRect();
  const x0 = e.clientX, y0 = e.clientY;
  const px = c.texto.x, py = c.texto.y;
  let andou = false;

  capture(el, e.pointerId);

  const move = (ev) => {
    if (!andou) {
      if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      andou = true;
      el.classList.add("moving");
    }
    c.texto.x = clamp(px + (ev.clientX - x0) / r.width, 0, 1);
    c.texto.y = clamp(py + (ev.clientY - y0) / r.height, 0, 1);
    el.style.left = (c.texto.x * 100) + "%";
    el.style.top = (c.texto.y * 100) + "%";
  };

  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.classList.remove("moving");
    // A camada e refeita de todo jeito: mesmo num clique que so escolheu, e
    // ela que traz o contorno e o punho do texto recem-escolhido.
    txKey = "";
    paintTextLayer();
    if (!andou) return;          // foi so um clique para escolher
    rememberSnapshot(antes);
    refresh(["texto", "props"]);
  };

  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

// ------------------------------------------------------- a roda na tela
//
// Com um texto escolhido, a roda e DELE. Antes ela era sempre da imagem, porque
// quem respondia por "de quem e o gesto na tela" so sabia olhar as camadas de
// video - e um texto nunca esta entre elas. O resultado era escolher a legenda,
// girar a roda e ver o video atras dela crescer: o programa dizia, pelo
// contorno, que o texto estava escolhido, e obedecia a outro.
//
// Na imagem a roda amplia o quadro; no texto ela aumenta a LETRA, que e a
// mesma ideia dita na medida de cada um. O passo e o mesmo dos dois lados, para
// o gesto ter o mesmo peso na mao.

// O texto de quem e a roda: o escolhido, e so enquanto ele estiver na tela.
// Fora do trecho dele nao ha o que ver mudar, e ai a roda volta a ser da
// imagem, que e o que se esta olhando.
export function wheelTextTarget() {
  const c = pickedText();
  if (!c) return null;
  return textsAt(state.pos).some((x) => x.id === c.id) ? c : null;
}

// Um gesto de roda pode ser vinte entalhes. O desfazer guarda o tamanho de
// ANTES do primeiro deles e so se fecha quando a mao para - senao um Ctrl+Z
// devolveria um entalhe de cada vez, e seriam vinte para voltar ao que era.
// O gesto de roda em curso: o retrato de antes e o relogio que o fecha.
let wheelTextTimer = null;
let wheelTextDesfazer = null;
export function wheelTextSize(e?, c?) {
  e.preventDefault();

  const antes = c.texto.tam;
  const agora = clamp(antes * (e.deltaY < 0 ? 1.1 : 1 / 1.1),
                      TEXT_TAM_MIN, TEXT_TAM_MAX);
  if (Math.abs(agora - antes) < 1e-6) return;

  if (!wheelTextDesfazer) wheelTextDesfazer = snapshot();
  c.texto.tam = agora;

  // A camada se redesenha na hora: a chave dela inclui o tamanho, entao sem
  // zera-la a tela se daria por igual.
  txKey = "";
  paintTextLayer();

  clearTimeout(wheelTextTimer);
  wheelTextTimer = setTimeout(() => {
    if (wheelTextDesfazer) {
      rememberSnapshot(wheelTextDesfazer);
      wheelTextDesfazer = null;
    }
    // O campo do painel segue a roda.
    refresh(["texto", "props"]);
  }, 180);
}

// As alcas mudam a CAIXA. A caixa e ancorada pelo proprio centro, entao ela
// cresce para os dois lados ao mesmo tempo: para a alca acompanhar a mao, a
// medida anda o dobro do que o ponteiro andou.
//
// Uma caixa que ainda se ajustava ao texto vira caixa de tamanho fixo no
// instante em que a mao a puxa - e o tamanho que ela tinha naquele momento e o
// ponto de partida, para nada saltar no primeiro pixel.
export function beginTextResize(e?, c?, el?, box?, lado?) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const t = c.texto;
  const antes = snapshot();
  const r = box.getBoundingClientRect();
  // offsetWidth e a medida da propria caixa; getBoundingClientRect devolveria
  // o retangulo que ENVOLVE a caixa girada, que e maior.
  const larg0 = typeof t.larg === "number" ? t.larg : el.offsetWidth / Math.max(1, r.width);
  const alt0 = typeof t.alt === "number" ? t.alt : el.offsetHeight / Math.max(1, r.height);
  const x0 = e.clientX, y0 = e.clientY;
  let andou = false;

  capture(el, e.pointerId);

  const move = (ev) => {
    if (!andou) {
      if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      andou = true;
      el.classList.add("moving");
    }
    // Numa caixa girada, puxar "para a direita" na tela nao e puxar a largura:
    // o que abre largura e a parte do gesto que corre no eixo da caixa. Sem
    // girar o deslocamento de volta, a alca fugia da mao em qualquer angulo
    // que nao fosse zero.
    const rad = txRot(t) * Math.PI / 180;
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    const dLarg = dx * Math.cos(rad) + dy * Math.sin(rad);
    const dAlt = -dx * Math.sin(rad) + dy * Math.cos(rad);

    if (lado !== "s") {
      t.larg = Math.max(TEXT_CAIXA_MIN, larg0 + 2 * dLarg / Math.max(1, r.width));
      el.style.width = (t.larg * 100) + "%";
    }
    if (lado !== "e") {
      t.alt = Math.max(TEXT_CAIXA_MIN, alt0 + 2 * dAlt / Math.max(1, r.height));
      el.style.height = (t.alt * 100) + "%";
    }
  };

  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.classList.remove("moving");
    if (!andou) return;
    rememberSnapshot(antes);
    txKey = "";
    refresh(["texto", "props"]);
  };

  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

// Dois cliques abrem o texto para digitar ali mesmo. E onde se espera poder
// escrever - o painel serve para o resto, mas trocar uma palavra nao deveria
// exigir procurar um campo em outro canto da tela.
export function editTextInline(c?, el?) {
  const antes = snapshot();
  const span = el.querySelector(".tx-txt");
  if (!span) return;

  el.classList.add("editando");
  span.contentEditable = "true";
  span.spellcheck = false;
  span.focus();

  const sel = window.getSelection();
  if (sel) {
    const rg = document.createRange();
    rg.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(rg);
  }

  const fim = (salva) => {
    span.contentEditable = "false";
    el.classList.remove("editando");
    span.removeEventListener("blur", aoSair);
    span.removeEventListener("keydown", aoTeclar);
    if (!salva) { span.textContent = c.texto.txt; return; }

    // O contenteditable devolve o texto com as quebras do HTML; o que o clipe
    // guarda e texto puro, que e o que a tela e o painel sabem mostrar.
    const novo = span.innerText.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (novo === c.texto.txt) return;
    rememberSnapshot(antes);
    c.texto.txt = novo || " ";
    c.name = primeiraLinha(c.texto.txt);
    txKey = "";
    refresh(["timeline", "texto", "props", "player"]);
  };

  const aoSair = () => fim(true);
  const aoTeclar = (ev) => {
    ev.stopPropagation();          // as teclas sao do campo, e nao dos atalhos
    if (ev.key === "Escape") { ev.preventDefault(); fim(false); span.blur(); }
    // Enter quebra linha, como em qualquer campo de varias linhas; quem acaba
    // de escrever clica fora ou aperta Ctrl+Enter.
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      span.blur();
    }
  };

  span.addEventListener("blur", aoSair);
  span.addEventListener("keydown", aoTeclar);
}

// ------------------------------------------------------------- o painel

export function renderTexto(body?) {
  const grid = document.createElement("div");
  grid.className = "tile-grid";
  TEXT_PRESETS.forEach((p) => {
    const t = document.createElement("div");
    t.className = "tile acao";
    t.textContent = p.nome;
    t.title = "Arraste ate a linha do tempo, ou dois cliques para por no cursor";
    // Um clique so nao poe nada. Escolher um modelo e escolher onde ele entra,
    // e um clique nao diz onde - dizia o cursor por ele, e o texto aparecia
    // sem que ninguem tivesse pedido aquele lugar.
    t.addEventListener("dblclick", () => addText(p));
    t.addEventListener("pointerdown", (e) => beginModelDrag(e, p));
    grid.appendChild(t);
  });
  body.appendChild(grid);

  const c = pickedText();
  if (!c) {
    const e = document.createElement("div");
    e.className = "section";
    e.textContent = state.clips.some(isText)
        ? "Escolha um texto na tela ou na linha do tempo"
        : "Escolha um modelo acima para comecar";
    body.appendChild(e);
    return;
  }

  const t = c.texto;
  const wrap = document.createElement("div");
  wrap.className = "tx-panel";
  wrap.innerHTML =
    '<div class="section">Texto escolhido</div>' +
    '<textarea class="tx-area" id="txArea" rows="3" spellcheck="false"></textarea>' +
    '<div class="tx-row">' +
      '<label>Tamanho</label>' +
      '<input type="range" id="txTam" min="' + Math.round(TEXT_TAM_MIN * 100) +
        '" max="' + Math.round(TEXT_TAM_MAX * 100) + '" step="1" value="' +
        Math.round(t.tam * 100) + '">' +
      // O cursor e para procurar; o campo e para chegar. Uma legenda que se
      // quer igual em vinte clipes pede um numero exato, e nao a mesma posicao
      // aproximada do dedo. A medida e em porcentagem da ALTURA do quadro:
      // assim ela vale igual num projeto Full HD e num vertical.
      '<div class="a-num"><input type="number" id="txTamN" min="' +
        Math.round(TEXT_TAM_MIN * 100) + '" max="' + Math.round(TEXT_TAM_MAX * 100) +
        '" step="1" value="' + Math.round(t.tam * 100) + '">' +
        '<span class="unit">% da altura</span></div>' +
    '</div>' +
    '<div class="tx-row">' +
      '<label>Rotacao</label>' +
      '<input type="range" id="txRot" min="' + ROT_MIN + '" max="' + ROT_MAX +
        '" step="1" value="' + Math.round(txRot(t)) + '">' +
      '<div class="a-num"><input type="number" id="txRotN" min="' + ROT_MIN +
        '" max="' + ROT_MAX + '" step="1" value="' + Math.round(txRot(t)) + '">' +
        '<span class="unit">&deg;</span></div>' +
      '<button class="btn ghost tf-quarto" id="txRot90" title="Girar um quarto de volta">&#8635;</button>' +
    '</div>' +
    // A letra e o fundo sao duas cores, e nao uma so com um interruptor ao
    // lado: num destaque, quem escolhe o amarelo do fundo tambem escolhe o
    // escuro da letra que vai por cima dele.
    '<div class="tx-row">' +
      '<label>Letra</label>' +
      '<input type="color" id="txCor" value="' + t.cor + '">' +
      '<button class="btn ghost" id="txPeso">' +
        (t.peso >= 700 ? "Menos grosso" : "Mais grosso") + '</button>' +
    '</div>' +
    '<div class="tx-row">' +
      '<label>Fundo</label>' +
      '<input type="color" id="txFundoCor" value="' + fundoRGB(t) + '"' +
        (t.fundo ? '' : ' disabled') + '>' +
      '<div class="a-num"><input type="number" id="txFundoOp" min="0" max="100" ' +
        'step="5" value="' + fundoOpacidade(t) + '"' + (t.fundo ? '' : ' disabled') +
        '><span class="unit">%</span></div>' +
      '<button class="btn ghost" id="txFundo">' +
        (t.fundo ? "Sem fundo" : "Por um fundo") + '</button>' +
    '</div>' +
    '<div class="tx-row">' +
      '<label>Aparece</label>' +
      '<div class="a-num"><input type="number" id="txIni" min="0" step="0.1" value="' +
        c.start.toFixed(1) + '"><span class="unit">s</span></div>' +
      '<label>por</label>' +
      '<div class="a-num"><input type="number" id="txDur" min="' + TEXT_MIN_LEN +
        '" step="0.1" value="' + c.len.toFixed(1) + '"><span class="unit">s</span></div>' +
    '</div>' +
    '<div class="a-foot">' +
      '<button class="btn ghost" id="txCentro">Centralizar</button>' +
      '<button class="btn ghost" id="txAjusta" title="A caixa volta a ter o tamanho do que esta escrito">Ajustar ao texto</button>' +
      '<button class="btn ghost" id="txAqui">Comecar no cursor</button>' +
      '<button class="btn ghost" id="txDel">Excluir</button>' +
    '</div>';
  body.appendChild(wrap);

  const area = wrap.querySelector("#txArea");
  area.value = t.txt;

  // Digitar muda a tela na hora, mas o historico so guarda o antes de cada
  // visita ao campo: uma entrada por letra encheria o Ctrl+Z de nada.
  let antesDoCampo = null;
  area.addEventListener("focus", () => { antesDoCampo = snapshot(); });
  area.addEventListener("input", () => {
    t.txt = area.value;
    c.name = primeiraLinha(t.txt);
    txKey = "";
    paintTextLayer();
    refresh(["timeline"]);
  });
  area.addEventListener("change", () => {
    if (antesDoCampo) { rememberSnapshot(antesDoCampo); antesDoCampo = null; }
  });

  const tam = wrap.querySelector("#txTam");
  const tamN = wrap.querySelector("#txTamN");

  // Os dois mexem no mesmo numero, entao cada um escreve no outro. O que esta
  // em uso nao se reescreve: mudar o valor de um campo enquanto se digita nele
  // mandaria o cursor do texto para o fim a cada tecla.
  const mostraTam = (de) => {
    if (de !== tam) tam.value = String(Math.round(t.tam * 100));
    if (de !== tamN) tamN.value = String(Math.round(t.tam * 100));
  };

  let antesDoTam = null;
  tam.addEventListener("pointerdown", () => { antesDoTam = snapshot(); });
  tam.addEventListener("input", () => {
    t.tam = clamp(Number(tam.value) / 100, TEXT_TAM_MIN, TEXT_TAM_MAX);
    mostraTam(tam);
    txKey = "";
    paintTextLayer();
  });
  tam.addEventListener("change", () => {
    if (antesDoTam) { rememberSnapshot(antesDoTam); antesDoTam = null; }
  });

  // O campo so vale ao sair ou no Enter: a cada tecla, "12" passaria por 1, e
  // a letra daria um salto antes de chegar onde se queria.
  tamN.addEventListener("change", () => {
    const pedido = Number(tamN.value);
    if (!isFinite(pedido) || pedido <= 0) { mostraTam(null); return; }
    remember();
    t.tam = clamp(pedido / 100, TEXT_TAM_MIN, TEXT_TAM_MAX);
    mostraTam(tamN);
    // Aparado pelos limites, o campo passa a dizer a verdade: sem isto ele
    // mostraria 80% com a letra em 50%.
    tamN.value = String(Math.round(t.tam * 100));
    txKey = "";
    paintTextLayer();
  });
  tamN.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); tamN.blur(); }
  });

  // O giro anda como o zoom da imagem: um cursor para procurar, um campo para
  // chegar, e os dois escrevendo um no outro.
  const giro = wrap.querySelector("#txRot");
  const giroN = wrap.querySelector("#txRotN");
  const mostraGiro = (de) => {
    if (de !== giro) giro.value = String(Math.round(txRot(t)));
    if (de !== giroN) giroN.value = String(Math.round(txRot(t)));
  };

  let antesDoGiro = null;
  giro.addEventListener("pointerdown", () => { antesDoGiro = snapshot(); });
  giro.addEventListener("input", () => {
    t.rot = clamp(Number(giro.value), ROT_MIN, ROT_MAX);
    mostraGiro(giro);
    txKey = "";
    paintTextLayer();
  });
  giro.addEventListener("change", () => {
    if (antesDoGiro) { rememberSnapshot(antesDoGiro); antesDoGiro = null; }
  });

  giroN.addEventListener("change", () => {
    const pedido = Number(giroN.value);
    if (!isFinite(pedido)) { mostraGiro(null); return; }
    remember();
    t.rot = clamp(pedido, ROT_MIN, ROT_MAX);
    mostraGiro(giroN);
    giroN.value = String(Math.round(t.rot));
    txKey = "";
    paintTextLayer();
  });
  giroN.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); giroN.blur(); }
  });

  wrap.querySelector("#txRot90").addEventListener("click", () => {
    remember();
    let g = Math.round(txRot(t)) + 90;
    if (g > ROT_MAX) g -= 360;
    t.rot = g;
    txKey = "";
    refresh(["texto", "player"]);
  });

  // O seletor de cor do sistema muda o valor enquanto a mao anda dentro dele:
  // a tela acompanha ao vivo, mas o historico guarda um so passo, o de antes
  // de o seletor abrir. Guardar DEPOIS, como estava, empilhava o estado novo -
  // e o primeiro Ctrl+Z nao desfazia nada.
  const ligaCor = (input, aplica) => {
    if (!input) return;
    let antesDaCor = null;
    const guarda = () => { if (!antesDaCor) antesDaCor = snapshot(); };
    input.addEventListener("pointerdown", guarda);
    input.addEventListener("focus", guarda);
    input.addEventListener("input", (e) => {
      guarda();
      aplica(e.target.value);
      txKey = "";
      paintTextLayer();
    });
    input.addEventListener("change", () => {
      if (antesDaCor) { rememberSnapshot(antesDaCor); antesDaCor = null; }
    });
  };

  ligaCor(wrap.querySelector("#txCor"), (v) => { t.cor = v; });
  ligaCor(wrap.querySelector("#txFundoCor"),
          (v) => { t.fundo = montaFundo(v, fundoOpacidade(t)); });

  const opac = wrap.querySelector("#txFundoOp");
  opac.addEventListener("change", () => {
    remember();
    t.fundo = montaFundo(fundoRGB(t), Number(opac.value) || 0);
    opac.value = String(fundoOpacidade(t));
    txKey = "";
    paintTextLayer();
  });
  opac.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); opac.blur(); }
  });

  wrap.querySelector("#txFundo").addEventListener("click", () => {
    remember();
    if (t.fundo) { t.fundoOff = t.fundo; t.fundo = ""; }
    else t.fundo = fundoAtual(t);
    txKey = "";
    refresh(["texto", "player"]);
  });

  wrap.querySelector("#txPeso").addEventListener("click", () => {
    remember();
    t.peso = t.peso >= 700 ? 500 : 700;
    txKey = "";
    refresh(["texto", "player"]);
  });

  wrap.querySelector("#txIni").addEventListener("change", (e) => {
    remember();
    c.start = Math.max(0, Number(e.target.value) || 0);
    refresh(["timeline", "texto", "props", "player"]);
  });

  wrap.querySelector("#txDur").addEventListener("change", (e) => {
    remember();
    c.len = Math.max(TEXT_MIN_LEN, Number(e.target.value) || TEXT_LEN);
    refresh(["timeline", "texto", "props", "player"]);
  });

  wrap.querySelector("#txCentro").addEventListener("click", () => {
    remember();
    t.x = 0.5;
    txKey = "";
    refresh(["texto", "player"]);
  });

  // Desfaz a medida dada pela mao: a caixa volta a nascer do que esta escrito.
  wrap.querySelector("#txAjusta").addEventListener("click", () => {
    remember();
    delete t.larg;
    delete t.alt;
    txKey = "";
    refresh(["texto", "player"]);
  });

  wrap.querySelector("#txAqui").addEventListener("click", () => {
    remember();
    c.start = Math.max(0, state.pos);
    refresh(["timeline", "texto", "props", "player"]);
  });

  wrap.querySelector("#txDel").addEventListener("click", () => {
    remember();
    state.clips = state.clips.filter((x) => x.id !== c.id);
    state.picked.delete(c.id);
    if (state.pickedClip === c.id) state.pickedClip = -1;
    txKey = "";
    afterClipChange(["player"]);
    toast("Texto excluido. Ctrl+Z traz de volta.");
  });
}
