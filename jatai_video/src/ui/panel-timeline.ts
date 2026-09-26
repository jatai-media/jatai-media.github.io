// panel-timeline.ts - linha do tempo: regua, pistas, clipes e o arrasto da midia

// ============================================= conteudo: linha do tempo

// O fim do projeto e o fim do que toca. Clipe mandado para baixo esta fora da
// montagem: nao estica a duracao nem manda o cursor parar la.
import { api, refreshSelection, select, closeMenu, showMenu, snapshot, rememberSnapshot, remember, clipSpeed, clipPieces, clipSourceAt, setPieces, isPicked, groupOf, togglePickGroup, widenToGroups, pickedClips, toast, clamp, capture, fmtTime, state } from "./core";
import { drag, refresh } from "./dock-view";
import { doSeparate } from "./panel-media";
import { seek, seekCommit, stopPlay, tick } from "./panel-player";
import { VOL_MIN, VOL_MAX, dbToGain, lineToDb, envLineAt, envDbAt, envGainAt, sendVolume } from "./panel-audio";
import { isFrameClip, ANIM_EPS, animPts, hasAnim, animTime, tfAt, animKey, deleteAnimPoint, pousaAnim, afterAnim, spreadTF, animaCamadas } from "./panel-imagem";
import { TEXT_MIN_LEN, freeTextTrack, isText } from "./texto";
import { strip, saveHush } from "./prefs";

export function projectEnd() {
  return state.clips.reduce((a, c) => (c.off ? a : Math.max(a, c.start + c.len)), 0);
}

// A linha, porem, vai ate o ultimo clipe que existe - descartados inclusive.
// Fora do alcance da rolagem eles nao teriam como voltar. E sempre um pouco
// de folga depois, para haver onde soltar o proximo.
export function timelineSpan() {
  const last = state.clips.reduce((a, c) => Math.max(a, c.start + c.len), 0);
  return Math.max(last + 12, 40);
}

// O observador do tamanho da janela que rola. Um so, para o app todo.
export let tlEye = null;

export function renderTimeline(body?) {
  body.style.overflow = "hidden";

  // Os desenhos guardados sao por id de clipe, e clipe cortado, desfeito ou
  // apagado deixa o seu para tras. Sozinhos nao pesam; ao longo de uma sessao
  // de cortes, com milhares de colunas de picos cada, pesam.
  pruneCaches();

  const tl = document.createElement("div");
  tl.className = "tl";

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML =
    '<button class="btn tool" id="tlToolSel" title="Selecao (V)">' + ICON_SELECT + '</button>' +
    '<button class="btn tool" id="tlToolRazor" title="Tesoura (C): clique num clipe para dividir">' + ICON_RAZOR + '</button>' +
    '<button class="btn tool" id="tlVoice" title="Desenhar a voz isolada em vez da mistura. Muda so o desenho, nao o som - e, se a voz ainda nao tiver sido separada, separa primeiro.">' + ICON_VOICE + '</button>' +
    '<button class="btn tool" id="tlFollow" title="Seguir a agulha: a janela acompanha o cursor enquanto toca. Desligado, a vista fica onde voce deixou.">' + ICON_FOLLOW + '</button>' +
    '<div class="sep"></div>' +
    '<button class="btn ghost" id="tlSplit" title="Ctrl+B">Dividir no cursor</button>' +
    '<button class="btn ghost" id="tlMerge" title="Ctrl+F: as pecas escolhidas voltam a ser uma so, quando forem trechos seguidos do mesmo arquivo">Fundir</button>' +
    '<button class="btn ghost" id="tlHush" title="Acha onde ha voz, corta fora o resto e manda o miolo para baixo. O clipe sai inteiro, com o audio junto.">Cortar na voz</button>' +
    '<button class="btn ghost" id="tlJoin" title="Fecha os buracos: o que ficou desliza ate encostar">Juntar</button>' +
    '<button class="btn ghost" id="tlToss" title="Tira da montagem o que estiver escolhido: desce para a pista de baixo, em vermelho, e volta de la quando voce quiser. Nada e apagado.">Mandar para baixo</button>' +
    '<button class="btn ghost" id="tlDel" title="Del">Excluir clipe</button>' +
    '<div class="spacer"></div>' +
    '<span class="hint" style="color:var(--dim)">Ctrl+roda: zoom  -  Ctrl+B: dividir</span>';
  tl.appendChild(bar);
  bar.querySelector("#tlToolSel").classList.toggle("on", state.tool !== "razor");
  bar.querySelector("#tlToolRazor").classList.toggle("on", state.tool === "razor");
  bar.querySelector("#tlVoice").classList.toggle("on", state.voice);
  bar.querySelector("#tlFollow").classList.toggle("on", state.follow);

  // Os dois ficam sempre clicaveis. O do corte porque quem sabe explicar por
  // que ele nao pode agir e ele mesmo, e um botao cinza nao fala. O da voz
  // porque ele deixou de ser so uma vista: nao havendo voz separada, clicar
  // nele e pedir a separacao - que e o unico lugar onde ela ainda faz falta.
  bar.querySelector("#tlVoice").disabled = state.separating;

  const bodyRow = document.createElement("div");
  bodyRow.className = "tl-body";

  const heads = document.createElement("div");
  heads.className = "tl-heads";
  heads.innerHTML = '<div class="ruler-pad"></div>';

  const scroll = document.createElement("div");
  scroll.className = "tl-scroll";
  const inner = document.createElement("div");
  inner.className = "tl-inner" + (state.tool === "razor" ? " razor" : "");
  inner.style.width = (timelineSpan() * state.zoom) + "px";
  inner.appendChild(buildRuler());

  state.tracks.forEach((tr) => {
    const head = document.createElement("div");
    head.className = "lane-head " + tr.kind;
    head.innerHTML = '<span class="nm"></span><span class="kind"></span>';
    head.querySelector(".nm").textContent = tr.name;
    head.querySelector(".kind").textContent =
        tr.kind === "audio" ? "aud" : tr.kind === "texto" ? "txt" : "vid";

    // Havendo descartados nesta pista, a cabeca dela ganha o botao que os
    // varre de uma vez. E o ultimo passo da triagem: cortar, separar, juntar,
    // e entao jogar fora o que sobrou. Vai aqui, e nao na barra de cima,
    // porque e desta pista que ele fala - com varias delas, uma barra so nao
    // saberia de qual.
    const sobras = state.clips.filter((c) => c.track === tr.id && c.off);
    if (sobras.length) {
      const b = document.createElement("button");
      b.className = "lane-x";
      b.title = "Excluir os " + sobras.length + " fragmentos desta pista";
      b.innerHTML = ICON_TRASH + '<span>' + sobras.length + '</span>';
      b.addEventListener("click", () => dropTossed(tr));
      head.appendChild(b);
    }

    heads.appendChild(head);

    const lane = document.createElement("div");
    lane.className = "lane " + tr.kind;
    lane.dataset.track = tr.id;
    state.clips.filter((c) => c.track === tr.id)
               .forEach((c) => lane.appendChild(buildClip(c)));
    inner.appendChild(lane);
  });

  if (!state.tracks.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.style.height = "calc(100% - 22px)";
    e.innerHTML = '<b>Linha do tempo vazia</b>' +
      '<div class="hint">Arraste para ca um item da midia, ou um modelo do painel de texto.</div>';
    inner.appendChild(e);
  } else {
    // A faixa do fim e onde nasce uma pista nova. Ela existe porque a pista
    // deixou de ser uma coisa que se cria antes, num botao, para ser o que ja
    // e nos programas de hoje: o lugar onde se solta o que se esta trazendo.
    // Sem ela, quem quisesse uma segunda pista de video nao teria por onde.
    const nova = document.createElement("div");
    nova.className = "lane-new";
    nova.innerHTML = '<span>solte aqui para uma pista nova</span>';
    inner.appendChild(nova);

    const pad = document.createElement("div");
    pad.className = "head-new";
    heads.appendChild(pad);
  }

  const ph = document.createElement("div");
  ph.className = "playhead";
  ph.id = "playhead";
  ph.style.left = (state.pos * state.zoom) + "px";
  inner.appendChild(ph);

  // O vazio entre os clipes recebe a caixa de selecao. A regua e os proprios
  // clipes param o evento antes de chegar aqui, cada um com o seu gesto.
  inner.addEventListener("pointerdown", (e) => {
    if (state.tool === "razor") return;
    if (e.target.closest(".clip") || e.target.closest(".ruler")) return;
    beginBand(inner, e);
  });

  scroll.appendChild(inner);
  bodyRow.appendChild(heads);
  bodyRow.appendChild(scroll);
  tl.appendChild(bodyRow);
  body.appendChild(tl);

  // A janela volta para onde estava antes do redesenho. Isto tem de vir depois
  // de o painel entrar no documento: fora dele nao ha o que rolar, e a
  // atribuicao se perderia.
  scroll.scrollLeft = state.tlScroll.x;
  scroll.scrollTop = state.tlScroll.y;
  state.tlScroll.w = scroll.clientWidth;
  heads.scrollTop = scroll.scrollTop;

  // As tiras foram desenhadas antes de haver tela: agora que ha, elas saem.
  planStrips();

  // A largura da janela nao muda so quando a janela do programa muda: arrastar
  // um divisor, trocar um painel de lugar ou abrir outra aba mexem nela do
  // mesmo jeito - e uma tela wide tem muito mais area para preencher do que
  // uma full HD. Um observador pega todos esses casos; ouvir "resize" da
  // janela pegaria so um deles.
  // Um observador so, trocado a cada desenho. O anterior TEM de ser desligado:
  // ele guarda o elemento que observava, e com ele a linha do tempo inteira -
  // todos os clipes, todos os canvas. Criando um por desenho, cada redesenho
  // deixava para tras uma arvore inteira que o coletor nao podia recolher, e
  // num video longo isso estourava a memoria da pagina em minutos.
  if (window.ResizeObserver) {
    if (tlEye) tlEye.disconnect();
    tlEye = new ResizeObserver(() => {
      const w = scroll.clientWidth;
      if (w === state.tlScroll.w) return;
      state.tlScroll.w = w;
      planStrips();
    });
    tlEye.observe(scroll);
  }

  // As cabecas das pistas acompanham a rolagem vertical dos clipes - e a
  // posicao fica guardada, para o proximo redesenho comecar daqui.
  scroll.addEventListener("scroll", () => {
    heads.scrollTop = scroll.scrollTop;
    state.tlScroll.x = scroll.scrollLeft;
    state.tlScroll.y = scroll.scrollTop;
    // Rolar muda o que se ve, e a tira cobre o que se ve. Mas so depois que a
    // mao para: pedir a cada pixel rolado seria pedir sem parar.
    planStrips();
  });

  // Ctrl+roda aproxima mantendo sob o cursor o instante que ja estava la.
  scroll.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const left = scroll.getBoundingClientRect().left;
    const at = (e.clientX - left + scroll.scrollLeft) / state.zoom;
    state.zoom = clamp(state.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 4, 400);
    refresh(["timeline"]);
    const el = document.querySelector(".tl-scroll");
    if (!el) return;
    el.scrollLeft = at * state.zoom - (e.clientX - left);
    // O evento de rolagem so chega depois; sem anotar aqui, um redesenho que
    // viesse antes dele restauraria a janela de antes do zoom.
    state.tlScroll.x = el.scrollLeft;
  }, { passive: false });

  // addTrack tambem e chamado por dentro, no meio de um descarte que ja se
  // lembrou sozinho; por isso quem marca o historico e o botao, e nao ela.
  bar.querySelector("#tlToss").addEventListener("click", tossSelection);
  bar.querySelector("#tlDel").addEventListener("click", deleteClip);
  bar.querySelector("#tlSplit").addEventListener("click", () => splitAtPlayhead());
  bar.querySelector("#tlMerge").addEventListener("click", () => mergeSelection());
  bar.querySelector("#tlJoin").addEventListener("click", () => joinTracks());
  bar.querySelector("#tlHush").addEventListener("click", (e) => {
    e.stopPropagation();
    openHush(e.currentTarget);
  });
  bar.querySelector("#tlVoice").addEventListener("click", () => toggleVoice());
  bar.querySelector("#tlFollow").addEventListener("click", () => toggleFollow());
  bar.querySelector("#tlToolSel").addEventListener("click", () => setTool("select"));
  bar.querySelector("#tlToolRazor").addEventListener("click", () => setTool("razor"));
}

// Os dois desenhos da barra. Sao SVG no proprio arquivo, e nao imagens: a
// ponte do webview so serve arquivos por pedido, e um icone que chega depois
// da barra apareceria piscando.
export const ICON_SELECT =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">' +
  '<path d="M4.2 2 L4.2 16.4 L8 12.9 L10.4 17.8 L12.7 16.7 L10.3 11.9 L15.6 11.4 Z"' +
  ' fill="currentColor" stroke="#0a0c10" stroke-width="1" stroke-linejoin="round"/></svg>';

export const ICON_RAZOR =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none"' +
  ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' +
  '<circle cx="5.2" cy="15.4" r="2.3"/><circle cx="14.8" cy="15.4" r="2.3"/>' +
  '<path d="M6.9 13.7 L15.4 2.4"/><path d="M13.1 13.7 L4.6 2.4"/></svg>';

// A propria agulha, com um sinal de movimento: e a forma que ja esta na tela,
// e por isso nao precisa ser aprendida.
export const ICON_FOLLOW =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">' +
  '<path d="M3.5 2.5 h9 l-4.5 4.5 z" fill="currentColor"/>' +
  '<path d="M8 2.5 v15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<path d="M13.5 8 l3 2.5 l-3 2.5" fill="none" stroke="currentColor"' +
  ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Uma onda sonora dentro de um balao de fala: e a voz, e nao o som todo.
export const ICON_VOICE =
  '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none"' +
  ' stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
  '<path d="M10 2.2 v15.6"/><path d="M6.4 5.6 v8.8"/><path d="M13.6 5.6 v8.8"/>' +
  '<path d="M3 8.4 v3.2"/><path d="M17 8.4 v3.2"/></svg>';

export function setTool(tool?) {
  if (state.tool === tool) return;
  state.tool = tool;
  refresh(["timeline"]);
}

export function buildRuler() {
  const ruler = document.createElement("div");
  ruler.className = "ruler";
  const span = timelineSpan();

  // Um passo redondo que caiba: marcas a cada 44px ou mais.
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => s * state.zoom >= 44) || steps[steps.length - 1];
  for (let t = 0; t <= span; t += step) {
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = (t * state.zoom) + "px";
    tick.innerHTML = "<span></span>";
    tick.firstChild.textContent = fmtTime(t);
    ruler.appendChild(tick);
  }

  ruler.addEventListener("pointerdown", (e) => {
    // Pegar a agulha para a reproducao. Sem isto o relogio do som continua
    // mandando: tick() chama seek() a cada quadro de animacao, e a posicao
    // escolhida pela mao era sobrescrita sessenta vezes por segundo - a agulha
    // voltava sozinha e parecia nao obedecer.
    if (state.playing) stopPlay();

    // Enquanto a mao arrasta, a vista fica quieta: os instantes saem de um
    // retangulo medido agora, e rolar por baixo dele trocaria o mapa no meio
    // do gesto.
    state.scrubbing = true;

    capture(ruler, e.pointerId);
    const r = ruler.getBoundingClientRect();
    const to = (ev) => seek(clamp((ev.clientX - r.left) / state.zoom, 0, span));
    to(e);
    const move = (ev) => to(ev);
    const up = () => {
      ruler.removeEventListener("pointermove", move);
      ruler.removeEventListener("pointerup", up);
      state.scrubbing = false;
      seekCommit();
      followPlayhead();
    };
    ruler.addEventListener("pointermove", move);
    ruler.addEventListener("pointerup", up);
  });
  return ruler;
}

// Onde esta peca fica dentro do bloco. Sai da vizinhanca de verdade, e nao de
// um numero guardado: peca que se afastou volta a ser ponta sozinha.
export function blockEdge(c?) {
  if (!c.grupo) return "";
  let antes = false, depois = false;
  state.clips.forEach((x) => {
    if (x.grupo !== c.grupo || x.id === c.id || x.track !== c.track) return;
    if (Math.abs(c.start - (x.start + x.len)) < MERGE_EPS) antes = true;
    if (Math.abs(x.start - (c.start + c.len)) < MERGE_EPS) depois = true;
  });
  if (!antes && !depois) return "";
  return " blk" + (antes ? "" : " blk-a") + (depois ? "" : " blk-z");
}

export function buildClip(c?) {
  const el = document.createElement("div");
  el.dataset.clip = c.id;
  el.className = "clip " + c.kind + (isPicked(c.id) ? " on" : "") +
                 (c.off ? " off" : "") + blockEdge(c);
  el.style.left = (c.start * state.zoom) + "px";
  el.style.width = Math.max(14, c.len * state.zoom) + "px";
  // A tira e a onda nascem no desenho, uma para cada pedaco que o clipe toca -
  // um clipe fundido tem varios, e cada um vem de um lugar do arquivo.
  el.innerHTML = '<span class="cl"></span>';
  // O nome so na primeira peca: repetido em cada costura, um bloco de quarenta
  // pedacos viraria uma fileira de etiquetas.
  const meio = el.className.indexOf(" blk") >= 0 && el.className.indexOf("blk-a") < 0;
  el.querySelector(".cl").textContent = meio ? "" : c.name;
  el.title = c.name;
  drawStrip(el, c);
  drawWave(el, c);
  // A faixa dos pontos de animacao fica no alto, fora do caminho da onda: sao
  // duas linhas diferentes no mesmo clipe - uma diz o volume, a outra diz onde
  // a imagem esta - e misturadas nao daria para pegar nem uma nem outra.
  drawAnimLane(el, c);

  const toss = clipBadge(c);
  if (toss) el.appendChild(toss);

  // As pontas sao de todo clipe. Num texto ou numa foto parada elas dizem por
  // quanto tempo aquilo fica na tela - nao ha arquivo nenhum medindo por eles.
  // Num video ou num audio, dizem que PEDACO do arquivo entra na montagem, e
  // ai nao passam do que o arquivo tem nem por cima do vizinho.
  if (c.len * state.zoom >= 18) {
    el.appendChild(trimGrip(c, "a"));
    el.appendChild(trimGrip(c, "z"));
  }

  // As pausas sondadas, acesas sobre o clipe enquanto os controles estao
  // abertos. E vendo onde elas caem que se descobre se o ajuste esta bom -
  // um numero de decibeis, sozinho, nao diz nada a ninguem.
  if (state.hushGaps && state.hushGaps.clip === c.id) {
    // Ja em tempo do clipe: a conversao foi feita quando as pausas chegaram.
    state.hushGaps.list.forEach((g) => {
      const mark = document.createElement("i");
      mark.className = "gap";
      mark.style.left = (g.t0 / Math.max(1e-6, c.len) * 100) + "%";
      mark.style.width = ((g.t1 - g.t0) / Math.max(1e-6, c.len) * 100) + "%";
      el.appendChild(mark);
    });
  }

  // A guia na ponta: a boca do buraco de onde ele saiu, apontando para cima,
  // que e onde fica a montagem.
  if (c.off) {
    const seam = document.createElement("i");
    seam.className = "seam";
    el.appendChild(seam);
  }

  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();

    // Com a tesoura na mao, apertar o clipe e cortar - nao ha arrasto nem
    // selecao para comecar.
    if (state.tool === "razor" && e.button === 0) {
      e.preventDefault();
      splitClips([c], razorTimeAt(e.clientX));
      return;
    }

    // Ctrl (ou Shift) soma e tira da selecao, sem comecar arrasto nenhum: e
    // um gesto de escolher, nao de mover.
    if (e.ctrlKey || e.shiftKey) {
      togglePickGroup(c);
      state.pickedMedia = -1;
      paintPicked();
      refreshSelection();
      return;
    }

    // A selecao vale ja no apertar - mas o redesenho so no soltar: refazer a
    // linha do tempo agora trocaria o elemento debaixo do ponteiro e o
    // arrasto morreria no primeiro pixel.
    //
    // Apertar num clipe que JA esta na selecao nao a desfaz: e assim que se
    // pega um grupo inteiro para arrastar.
    if (!isPicked(c.id)) {
      // Peca de um bloco traz o bloco inteiro: e o que faz dele um bloco.
      state.picked = new Set(groupOf(c).map((x) => x.id));
      state.pickedPoint = 0;
    }
    state.pickedClip = c.id;
    state.pickedMedia = -1;
    paintPicked();
    capture(el, e.pointerId);

    const drag = beginClipDrag(el, c, e);
    const move = (ev) => drag.move(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      drag.drop();
      // Nao passa por select(): ele desfaria a selecao multipla, e arrastar um
      // grupo tem de devolver o grupo escolhido.
      state.pickedMedia = -1;
      afterClipChange(["player"]);
      seekCommit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
  return el;
}

// ------------------------------------------------------- pra baixo e de volta
//
// Cortar e so a metade da triagem; a outra e separar o que presta do que nao
// presta. A setinha do canto manda o clipe para a pista de baixo: ele sai da
// montagem - nao toca, nao aparece na previa, nao conta na duracao - mas
// continua na linha, no mesmo instante, tingido de vermelho. Nada e apagado,
// e por isso a decisao nao precisa ser definitiva.

export const ICON_TOSS =
  '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">' +
  '<path d="M4.6 1 h2.8 v4.2 h2.2 L6 10 L1.4 5.2 h2.2 Z" fill="currentColor"/></svg>';

export const ICON_BACK =
  '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">' +
  '<path d="M4.6 11 h2.8 v-4.2 h2.2 L6 2 L1.4 6.8 h2.2 Z" fill="currentColor"/></svg>';

// A seta de descartar aparece no clipe ESCOLHIDO, no que estiver sob o
// ponteiro (isso quem faz e a folha de estilo) e em qualquer um com a tesoura
// na mao. Antes era so com a tesoura, e quem cortou na voz e depois quis tirar
// mais um pedaco nao tinha por onde: a unica seta a vista era a de voltar, dos
// que ja estavam embaixo.
//
// A de voltar aparece sempre: um clipe vermelho esta justamente perguntando se
// volta, e ter de pegar outra ferramenta para responder seria um passo sem
// motivo.
export function clipBadge(c?) {
  if (!c.off && state.tool !== "razor" && !isPicked(c.id)) return null;
  if (c.len * state.zoom < 30) return null;   // clipe estreito demais: nao cabe

  const b = document.createElement("button");
  b.className = "clip-toss" + (c.off ? " back" : "");
  b.title = c.off ? "Voltar para a pista de cima" : "Mandar para a pista de baixo";
  b.innerHTML = c.off ? ICON_BACK : ICON_TOSS;
  // Sem isto o apertar chega ao clipe: com a tesoura na mao, mirar a seta
  // cortaria o clipe debaixo dela.
  b.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
  b.addEventListener("click", (e) => { e.stopPropagation(); tossClip(c); });
  return b;
}

// Uma lixeira: tampa, corpo e os dois riscos de dentro.
export const ICON_TRASH =
  '<svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true" fill="none"' +
  ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
  '<path d="M2.5 3.5 h9"/><path d="M5.5 3.5 V2.4 h3 V3.5"/>' +
  '<path d="M3.6 3.5 l0.6 8 h5.6 l0.6 -8"/>' +
  '<path d="M6 5.8 v3.6"/><path d="M8 5.8 v3.6"/></svg>';

// Varre os descartados de uma pista. Nao pergunta: o Ctrl+Z traz todos de
// volta, e uma pergunta a cada limpeza cansaria mais do que protegeria.
export function dropTossed(tr?) {
  const sobras = state.clips.filter((c) => c.track === tr.id && c.off);
  if (!sobras.length) return;

  remember();
  const ids = new Set(sobras.map((c) => c.id));
  state.clips = state.clips.filter((c) => !ids.has(c.id));
  if (ids.has(state.pickedClip)) { state.pickedClip = -1; state.pickedPoint = 0; }

  // Um descartado que ficou pode ter perdido o vizinho que marcava o lugar de
  // volta; quem cuida disso e o proprio realinhamento.
  layoutTossed();
  afterClipChange(["player"]);
  seekCommit();
  toast(sobras.length + (sobras.length === 1 ? " fragmento apagado." : " fragmentos apagados.")
        + " Ctrl+Z traz de volta.");
}

// De que tipo de pista este clipe e. O texto tem a dele desde que passou a
// existir; sem esta linha ele se dizia video, e o arrasto de um texto para
// outra faixa de texto era recusado com um aviso que nao fazia sentido.
export function trackKind(c?) {
  if (c.kind === "audio") return "audio";
  if (c.kind === "texto") return "texto";
  return "video";
}

// Uma pista so existe por causa do que ha nela. Esvaziada - o ultimo clipe
// apagado, movido para outra faixa, ou levado junto com a midia que saiu do
// projeto - ela some. Agora que ninguem mais cria pista na mao, uma faixa
// vazia nao e escolha de ninguem: e sobra, e ainda ocupa a altura que falta ao
// video.
//
// Com uma excecao: a pista que e a CASA de um descartado fica de pe. O clipe
// vermelho la embaixo ainda pode voltar, e voltar e voltar para ela.
export function pruneTracks() {
  const usadas = new Set();
  state.clips.forEach((c) => {
    usadas.add(c.track);
    if (c.off && c.home) usadas.add(c.home);
  });
  const antes = state.tracks.length;
  state.tracks = state.tracks.filter((t) => usadas.has(t.id));
  return state.tracks.length !== antes;
}

// Depois de mexer nos clipes: as pistas vazias somem e os paineis da selecao
// se refazem. Num lugar so porque esquecer a poda em UM dos caminhos deixaria
// a linha do tempo com uma faixa fantasma que ninguem sabe como fechar.
export function afterClipChange(extra?) {
  pruneTracks();
  refreshSelection(extra);
}

// A pista logo abaixo, do mesmo tipo. Nao havendo nenhuma, uma e criada: o
// descarte nao pode depender de o usuario ter preparado o lugar antes.
export function trackBelow(c?) {
  const i = state.tracks.findIndex((t) => t.id === c.track);
  const kind = trackKind(c);
  const below = state.tracks.slice(i + 1).find((t) => t.kind === kind);
  return below || addTrack(kind);
}

// A pista de onde o clipe saiu, se ainda existir; senao, a primeira do tipo.
export function homeTrack(c?) {
  return state.tracks.find((t) => t.id === c.home) ||
         state.tracks.find((t) => t.kind === trackKind(c)) || null;
}

// O comeco da montagem numa pista. Nao e zero: uma abertura deliberada no
// comeco nao e um buraco, e juntar as pecas nao pode engoli-la.
export function trackOrigin(trackId?) {
  let at = Infinity;
  state.clips.forEach((c) => {
    if (c.track === trackId && !c.off && c.start < at) at = c.start;
  });
  return at === Infinity ? 0 : at;
}

// De quem `c` vem depois, na pista em que esta. E esse vizinho - e nao um
// instante - que marca o lugar de volta: um instante envelheceria assim que a
// montagem deslizasse, e o clipe voltaria no lugar errado.
export function predOf(c?) {
  let best = null;
  state.clips.forEach((x) => {
    if (x.id === c.id) return;
    // Contam os vizinhos da pista: os que ficaram nela e os que desceram dela.
    // Os que desceram tambem, senao dois descartes seguidos apontariam ambos
    // para a mesma peca, empilhariam no mesmo ponto e voltariam trocados.
    const mine = x.off ? (x.home || x.track) === c.track : x.track === c.track;
    if (!mine || x.start > c.start - 1e-4) return;
    if (!best || x.start > best.start) best = x;
  });
  return best ? best.id : 0;
}

// Onde um descartado volta a entrar, seguindo a corrente de vizinhos. Quando o
// vizinho tambem esta descartado, os dois ficam em fila - e a fila guarda a
// ordem em que estavam, que e o que a volta desfaz, um de cada vez.
export function backPos(c?, seen?) {
  const guard = seen || new Set();
  if (guard.has(c.id)) return c.start;    // corrente torta: fica onde esta
  guard.add(c.id);

  const p = c.back ? state.clips.find((x) => x.id === c.back) : null;
  // Sem vizinho de tras, entra no comeco da pista. Mas se ele existia e foi
  // apagado, ninguem sabe mais de onde este veio: fica onde esta, que e menos
  // errado do que mandar para o comeco um trecho que era do meio.
  if (!p) return c.back ? c.start : trackOrigin(c.home || c.track);
  return (p.off ? backPos(p, guard) : p.start) + p.len;
}

// Onde ele volta a ENTRAR - que nem sempre e onde ele esta. Se o vizinho de
// tras tambem esta fora, o lugar daquele ainda nao existe na montagem, e este
// entra depois do ultimo que ficou. Assim, voltando em qualquer ordem, a
// sequencia sai na ordem certa; seguir a fila dos que estao fora poria este
// no lugar que o outro ainda nem ocupou.
export function entryPos(c?) {
  const seen = new Set([c.id]);
  let p = c.back ? state.clips.find((x) => x.id === c.back) : null;
  let lost = !!c.back && !p;

  while (p && p.off && !seen.has(p.id)) {
    seen.add(p.id);
    const next = p.back ? state.clips.find((x) => x.id === p.back) : null;
    lost = !!p.back && !next;
    p = next;
  }

  if (lost) return c.start;                          // vizinho apagado
  if (!p) return trackOrigin(c.home || c.track);     // era o primeiro da pista
  return p.start + p.len;
}

// Poe cada descartado na boca do buraco de onde saiu. E daqui que sai o
// alinhamento depois de juntar as pecas: a ponta vermelha cai debaixo da
// emenda a que pertence.
export function layoutTossed() {
  state.clips.forEach((c) => { if (c.off) c.start = backPos(c); });

  // Duas correntes diferentes podem desaguar na mesma boca - basta arrastar
  // dois descartados para a mesma emenda. Aqui o segundo cede o lugar em vez
  // de ficar por cima do primeiro.
  state.tracks.forEach((tr) => {
    let at = -Infinity;
    state.clips.filter((c) => c.off && c.track === tr.id)
               .sort((a, b) => a.start - b.start)
               .forEach((c) => {
      if (c.start < at - 1e-4) c.start = at;
      at = c.start + c.len;
    });
  });
}

// Largar um descartado em outro ponto nao o move: diz entre quais pecas ele
// entra. Ele gruda na boca mais perto de onde foi solto - e a guia da ponta
// ja aponta para a nova.
export function seatFor(c?, at?) {
  const home = homeTrack(c);
  if (!home) return c.back || 0;

  // Uma corrente que voltasse a `c` nao teria comeco; estes vizinhos ficam
  // fora da escolha.
  const loops = (id) => {
    let p = state.clips.find((x) => x.id === id);
    for (let n = 0; p && p.off && n < 64; ++n) {
      if (p.id === c.id) return true;
      p = state.clips.find((x) => x.id === p.back);
    }
    return false;
  };

  // As bocas possiveis: o comeco da pista, e o fim de cada peca dela - as que
  // ficaram e as que desceram, porque duas descidas em fila tambem sao um
  // lugar valido de entrada.
  let best = 0, near = Math.abs(at - trackOrigin(home.id));
  state.clips.forEach((x) => {
    if (x.id === c.id) return;
    const onHome = !x.off && x.track === home.id;
    const sibling = x.off && (x.home || x.track) === home.id;
    if (!onHome && !sibling) return;
    if (loops(x.id)) return;
    const d = Math.abs(at - (x.start + x.len));
    if (d < near) { near = d; best = x.id; }
  });
  return best;
}

export function reseat(c?) {
  c.back = seatFor(c, c.start);
  layoutTossed();
}

// Em que instante ele vai se encaixar, se largado em `at`. E a guia que a mao
// ve enquanto arrasta: o descartado gruda numa boca, e sem mostrar qual o
// gesto vira adivinhacao.
export function seatAt(c?, at?) {
  const back = seatFor(c, at);
  const p = back ? state.clips.find((x) => x.id === back) : null;
  if (!p) return trackOrigin(c.home || c.track);
  return (p.off ? backPos(p) : p.start) + p.len;
}

// Abre lugar para `c` na pista dele. Largado por cima de alguem, ele entra
// logo depois - quem ja estava ali antes do gesto nao recua. E dali para a
// frente todo mundo anda o que for preciso, em cascata: sem isto o clipe
// largado no meio da fila ficaria por cima do vizinho.
// Como a pista fica se `moving` entrar em `at`. Nao mexe em nada: devolve o
// desenho, por id. E a mesma conta que o largar aplica, e por isso a previa
// durante o arrasto mostra exatamente o que vai acontecer - o espaco que se
// abre com a mao ainda apertada e o espaco que fica.
// `asOff` e o que o clipe SERA quando cair - e nao o que ele e agora. Um
// descartado arrastado para cima deixa de ser descartado no ato de largar, e
// e com os vizinhos da montagem que ele tem de dividir o espaco; medindo pelo
// que ele ainda e, a previa nao abriria buraco nenhum justo no gesto que mais
// precisa dele.
export function roomFor(trackId?, moving?, at?, asOff?) {
  const off = asOff === undefined ? !!moving.off : !!asOff;
  const others = state.clips
      .filter((x) => x.id !== moving.id && x.track === trackId && !x.off === !off)
      .sort((a, b) => a.start - b.start);

  let start = at;
  others.forEach((x) => {
    if (x.start < start - 1e-4 && x.start + x.len > start + 1e-4) {
      start = x.start + x.len;
    }
  });

  const out = new Map([[moving.id, start]]);
  let after = start + moving.len;
  others.forEach((x) => {
    let s = x.start;
    if (s >= start - 1e-4) {
      if (s < after - 1e-4) s = after;
      after = s + x.len;
    }
    out.set(x.id, s);
  });
  return out;
}

// Abre lugar para um GRUPO de uma vez. As pecas do grupo ficam onde a mao as
// deixou - entre elas a distancia foi escolhida e nao se mexe; quem nao e do
// grupo cede, em cascata.
export function openRoomFor(grupo?) {
  const ids = new Set(grupo.map((c) => c.id));
  const pistas = new Set(grupo.map((c) => c.track));

  pistas.forEach((tid) => {
    const dentro = grupo.filter((c) => c.track === tid)
                        .sort((a, b) => a.start - b.start);
    if (!dentro.length) return;

    const fora = state.clips
        .filter((c) => c.track === tid && !ids.has(c.id) && !c.off === !dentro[0].off)
        .sort((a, b) => a.start - b.start);

    let at = -Infinity;
    fora.forEach((x) => {
      let s = Math.max(x.start, at);
      // Empurrado para depois de cada peca do grupo em que esbarrar. A lista
      // esta em ordem, entao quem for empurrado para dentro da seguinte ainda
      // e visto por ela.
      dentro.forEach((g) => {
        if (s < g.start + g.len - 1e-4 && s + x.len > g.start + 1e-4) {
          s = g.start + g.len;
        }
      });
      x.start = s;
      at = s + x.len;
    });
  });
}

export function openRoom(c?) {
  roomFor(c.track, c, c.start).forEach((start, id) => {
    const x = id === c.id ? c : state.clips.find((y) => y.id === id);
    if (x) x.start = start;
  });
}

// Onde o clipe foi largado. Trocar de pista traz um descartado de volta para a
// montagem: nao e a pista de baixo que o deixa fora dela - e a marca vermelha -
// mas subir de pista pela mao e, sem duvida nenhuma, voltar.
export function dropClip(c?, trackId?) {
  const to = state.tracks.find((t) => t.id === trackId);

  if (to && to.id !== c.track) {
    if (to.kind !== trackKind(c)) {
      toast("Um clipe de " + c.kind + " nao entra numa pista de " + to.kind + ".");
    } else {
      c.track = to.id;
      if (c.off) {
        // O lugar dele passa a ser este, o que a mao acabou de escolher.
        c.off = false;
        c.home = 0;
        c.back = 0;
        sendVolume(c);
      }
    }
  }

  // Continua fora: quem manda no lugar dele e a corrente de vizinhos, e nao
  // o pixel em que foi solto.
  if (c.off) { reseat(c); return; }

  // Dois textos ao mesmo tempo sao dois textos em lugares diferentes da tela,
  // e nao um empurrando o outro para mais tarde - que e o que a abertura de
  // espaco faria. Quando o lugar onde ele caiu ja esta ocupado, ele sobe para
  // uma faixa de texto livre; nao havendo nenhuma, nasce outra.
  // A pista onde a mao o soltou entra como PREFERIDA, e nao como palpite a
  // ignorar. Sem isto, um texto arrastado para uma pista de texto la embaixo
  // era devolvido a primeira faixa livre - que e a de cima - e nao havia como
  // manter um texto atras do video: bastava encostar nele para ele voltar.
  if (isText(c)) {
    c.track = freeTextTrack(c.start, c.len, c.id, c.track).id;
    return;
  }

  openRoom(c);
  layoutTossed();
}

// Manda um clipe para a pista de baixo - so o estado, sem redesenho nem
// aviso. Separado justamente para poder ser chamado em leva: limpar cinquenta
// pausas de uma vez nao pode refazer a linha do tempo cinquenta vezes.
export function sendDown(c?) {
  // A boca do buraco que se abre. Depois de juntar, a emenda cai exatamente
  // aqui: tudo o que vinha depois desliza para a esquerda ate este ponto.
  state.lastCut = c.start;
  const below = trackBelow(c);
  c.back = predOf(c);
  c.home = c.track;
  c.track = below.id;
  c.off = true;
  sendVolume(c);
}

// A volta de um descartado, abrindo lugar: dali para a frente tudo anda o
// tamanho dele. Sem isto ele voltaria por cima do vizinho que ocupou o buraco.
// Devolve false quando nao ha pista para onde voltar.
export function bringBack(c?) {
  const home = homeTrack(c);
  if (!home) return false;

  const at = entryPos(c);

  // O vao que ja existe em `at` - normalmente o proprio buraco que este clipe
  // deixou ao descer. O resto so anda o que FALTAR para ele caber: empurrar o
  // tamanho inteiro abria um vao novo do nada, e descer e voltar deixava a
  // montagem diferente de como estava.
  let proximo = Infinity;
  state.clips.forEach((x) => {
    if (!x.off && x.track === home.id && x.id !== c.id && x.start > at - 1e-4) {
      proximo = Math.min(proximo, x.start);
    }
  });

  const empurra = proximo === Infinity ? 0 : Math.max(0, c.len - (proximo - at));
  if (empurra > 0) {
    state.clips.forEach((x) => {
      if (!x.off && x.track === home.id && x.start > at - 1e-4) x.start += empurra;
    });
  }

  c.track = home.id;
  c.start = at;
  c.off = false;
  c.home = 0;
  c.back = 0;
  return true;
}

// Manda para baixo o que estiver escolhido - ou traz de volta, se ja estiver
// la. E o mesmo gesto da setinha, alcancavel sem mirar nela: depois de cortar
// na voz, o que se quer e ir tirando pedacos, e cada um deles e um alvo
// pequeno na tela.
// ------------------------------------------------------------ velocidade
//
// Mudar a velocidade muda quanto ESPACO o clipe ocupa na linha: o material e o
// mesmo, e o que muda e o tempo que ele leva para passar. O dobro da
// velocidade ocupa metade do espaco.
//
// Por isso quem vem depois anda junto, na mesma pista: um clipe encolhendo
// deixaria um buraco, e um clipe crescendo passaria por cima do vizinho. E o
// mesmo empurrao que qualquer editor da, e o Ctrl+Z desfaz tudo de uma vez.
//
// O som e acelerado reamostrando, como uma fita tocada mais depressa: o tom
// sobe junto. Preservar o tom pede analise de fase, que e outro tamanho de
// problema - e nem sempre e o que se quer, porque a fita acelerada tambem e um
// efeito legitimo.
export const VEL_MIN = 0.1;
export const VEL_MAX = 8;

export function setClipSpeed(c?, vel?) {
  const novo = clamp(vel, VEL_MIN, VEL_MAX);
  const atual = clipSpeed(c);
  if (Math.abs(novo - atual) < 1e-6) return;

  const antes = c.len;

  // Os pedacos sao lidos ANTES de a velocidade mudar. Lidos depois, o clipe
  // sem lista propria teria a peca implicita calculada com a velocidade nova -
  // e o material dobraria em vez de a duracao cair pela metade.
  const pecas = clipPieces(c).map((p) => ({ in: p.in, len: p.len }));
  c.vel = novo;
  // As pecas guardam segundos de ARQUIVO; a duracao na linha sai delas.
  setPieces(c, pecas);

  // A animacao acompanha o MATERIAL, e nao o relogio: um ponto marcado no
  // instante em que a mao entra no quadro tem de continuar naquele instante
  // depois de o clipe correr pela metade da velocidade. Por isso aqui os
  // pontos se esticam junto - ao contrario do que acontece ao arrastar uma
  // ponta, onde o material nao anda e o ponto fica onde estava.
  if (c.anim && antes > 1e-6) {
    const fator = c.len / antes;
    c.anim.forEach((p) => { p.t *= fator; });
    spreadTF(c);
  }

  // Quem vem depois, na mesma pista, anda o tanto que o clipe mudou.
  const delta = c.len - antes;
  if (Math.abs(delta) > 1e-9) {
    state.clips.forEach((x) => {
      if (x.id === c.id || x.track !== c.track || !!x.off !== !!c.off) return;
      if (x.start >= antes + c.start - 1e-6) x.start = Math.max(0, x.start + delta);
    });
  }

  layoutTossed();
}

export function tossSelection() {
  const alvos = pickedClips();
  if (!alvos.length) {
    toast("Escolha primeiro o clipe que voce quer tirar da montagem.");
    return;
  }
  tossClip(alvos[0]);
}

export function tossClip(c?) {
  // Numa selecao multipla o gesto vale para todos: depois de cercar meia duzia
  // de fragmentos com a caixa, o que se quer e mandar os seis para baixo, e
  // nao aquele em cuja setinha o dedo caiu.
  //
  // Da esquerda para a direita: quem desce anota de quem vem depois, e esse
  // vizinho so esta no lugar certo depois que os anteriores ja se mexeram.
  const alvos = (isPicked(c.id) && state.picked.size > 1 ? pickedClips() : [c])
      .slice().sort((a, b) => a.start - b.start);

  remember();

  let feitos = 0;
  alvos.forEach((x) => {
    if (x.off) { if (bringBack(x)) ++feitos; }
    else { sendDown(x); ++feitos; }
  });

  if (!feitos) { toast("Nao ha pista para onde voltar."); return; }

  // Os que ficaram embaixo se realinham: a corrente de um deles pode ter
  // acabado de mudar de mao.
  layoutTossed();

  // Entraram ou sairam da montagem: a lista de trechos da mistura mudou, e com
  // o som tocando e o seekCommit que a refaz, no mesmo ponto.
  alvos.forEach(sendVolume);
  state.pickedMedia = -1;
  afterClipChange(["player"]);
  seekCommit();
}

// ------------------------------------------- os controles do corte
//
// Tres numeros, e uma contagem que se refaz a cada mexida. A contagem e o que
// torna os numeros utilizaveis: ninguem sabe de cabeca o que -38 dB significa
// no seu microfone, mas todo mundo entende "7 pausas, 12 s de 45 s" - e ve as
// pausas acesas sobre o clipe, no lugar exato onde o corte vai cair.

// Os controles do corte. O do meio depende de quem esta respondendo: a rede
// se ajusta pela confianca dela - "a partir de quanto isto conta como fala" -
// e a regua antiga, pelo nivel em decibeis. Mostrar os dois seria oferecer um
// botao que nao liga em nada.
export const HUSH_MIN = {
  lo: 0.10, hi: 3.00, step: 0.05, unit: "s", label: "Pausa minima",
  hint: "Paradas mais curtas que isto ficam - e a respiracao entre frases.",
};
export const HUSH_PAD = {
  lo: 0, hi: 0.40, step: 0.01, unit: "s", label: "Folga nas pontas",
  hint: "Sobra de cada lado da pausa, para o corte nao comer a palavra.",
};

export function hushLimits() {
  const meio = state.falaReconhecida
      ? { sens: { lo: 0.05, hi: 0.95, step: 0.05, unit: "", label: "Exigencia",
                  hint: "Quanto o reconhecedor precisa estar certo de que aquilo e "
                        + "voz. Mais alto corta mais; mais baixo poupa a fala baixinha." } }
      : { db: { lo: -60, hi: -20, step: 1, unit: " dB", label: "Nivel do silencio",
                hint: "Abaixo deste nivel conta como calado. Mais baixo, se o "
                      + "microfone chia." } };
  return Object.assign({ min: HUSH_MIN }, meio, { pad: HUSH_PAD });
}

export let hushBox = null;

export function closeHush() {
  if (hushBox) { hushBox.remove(); hushBox = null; }
  if (state.hushGaps) { state.hushGaps = null; refresh(["timeline"]); }
}

export function openHush(anchor?) {
  closeHush();

  const c = state.clips.find((x) => x.id === state.pickedClip);
  if (!c) { toast("Escolha primeiro o clipe que voce quer limpar."); return; }

  // No C++, sem o reconhecedor, a regua de nivel exigia a voz separada. No
  // navegador ainda nao ha separador, e a regua mede a propria mistura: numa
  // gravacao so de voz ela acerta, com musica por baixo acha pouco.
  const m = state.media.find((x) => x.id === c.media);
  if (!m || !m.hasAudio) {
    toast("Este clipe nao tem audio para achar as pausas.");
    return;
  }

  const LIMITES = hushLimits();

  const box = document.createElement("div");
  box.className = "hush";
  let html = '<div class="hush-title">Cortar na voz</div>' +
             '<div class="hush-modo">' +
             (state.falaReconhecida
                 ? "a fala e reconhecida, e nao medida"
                 : "pelo nivel do som, na propria mistura") + '</div>';
  Object.keys(LIMITES).forEach((k) => {
    const L = LIMITES[k];
    html += '<label class="hush-row" title="' + L.hint + '">' +
            '<span class="hush-k">' + L.label + '</span>' +
            '<input type="range" id="hush-' + k + '" min="' + L.lo + '" max="' + L.hi +
            '" step="' + L.step + '" value="' + state.hush[k] + '">' +
            '<span class="hush-v" id="hushv-' + k + '"></span></label>';
  });
  html += '<div class="hush-count" id="hushCount">sondando...</div>' +
          '<div class="hush-foot">' +
          '<button class="btn ghost" id="hushNo">Cancelar</button>' +
          '<button class="btn primary" id="hushGo">Cortar</button></div>';
  box.innerHTML = html;
  document.body.appendChild(box);
  hushBox = box;

  // Encostado no botao que o abriu - mas NUNCA por cima do clipe que se esta
  // sondando. As marcas das pausas acendem nele, e e vendo onde elas caem que
  // se decide o ajuste; um painel em cima justamente delas esconde a unica
  // coisa que ele serve para mostrar.
  //
  // A ordem de preferencia: abaixo do clipe, acima dele, e - nao cabendo
  // nenhum dos dois - colado no botao, como antes.
  const r = anchor.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const folga = 8;

  const esq = Math.max(6, Math.min(r.left, window.innerWidth - b.width - 6));
  let topo = Math.min(r.bottom + 6, window.innerHeight - b.height - 6);

  const alvo = document.querySelector('.clip[data-clip="' + c.id + '"]');
  if (alvo) {
    const cr = alvo.getBoundingClientRect();
    const abaixo = cr.bottom + folga;
    const acima = cr.top - b.height - folga;
    if (abaixo + b.height <= window.innerHeight - 6) topo = abaixo;
    else if (acima >= 6) topo = acima;
  }

  box.style.left = esq + "px";
  box.style.top = topo + "px";

  const paint = () => {
    Object.keys(LIMITES).forEach((k) => {
      const L = LIMITES[k];
      box.querySelector("#hushv-" + k).textContent =
          (k === "db" ? state.hush[k].toFixed(0) : state.hush[k].toFixed(2)) + L.unit;
    });
  };
  paint();

  Object.keys(LIMITES).forEach((k) => {
    box.querySelector("#hush-" + k).addEventListener("input", (e) => {
      state.hush[k] = Number(e.target.value);
      paint();
      saveHush();
      probeHush(c);
    });
  });

  box.querySelector("#hushNo").addEventListener("click", closeHush);
  box.querySelector("#hushGo").addEventListener("click", () => {
    const found = state.hushGaps && state.hushGaps.clip === c.id
        ? state.hushGaps.list : null;
    closeHush();
    if (found && found.length) cutSilences(c, found);
    else toast("Nao ha pausa nenhuma com estes ajustes.");
  });

  // Mexer nos controles nao pode fechar o painel; um clique fora, sim.
  box.addEventListener("click", (e) => e.stopPropagation());
  box.addEventListener("pointerdown", (e) => e.stopPropagation());

  probeHush(c);
}

// A sondagem, freada: arrastar um controle dispara a cada pixel, e cada
// sondagem atravessa a ponte.
export let hushProbe = null;
// As pausas voltam do C++ em tempo de ARQUIVO - e assim que a rede e a regua
// de nivel enxergam o material. O clipe, porem, pensa em tempo dele: num clipe
// fundido os dois nao se convertem por uma soma, porque o arquivo pula no meio.
//
// Entao cada pausa e recortada pedaco a pedaco, e as partes que sobram voltam a
// se juntar do lado de ca. O que caiu inteiro num trecho descartado some, que e
// o certo: aquele material nao esta mais no clipe.
export function gapsToClip(c?, doArquivo?, minLen?) {
  const soltas = [];
  clipPieces(c).forEach((p) => {
    const pe = p.in, pf = p.in + p.len;
    doArquivo.forEach((g) => {
      const a = Math.max(g.t0, pe), b = Math.min(g.t1, pf);
      if (b - a <= 1e-6) return;
      const v = clipSpeed(c);
      soltas.push({ t0: p.a + (a - pe) / v, t1: p.a + (b - pe) / v });
    });
  });
  soltas.sort((x, y) => x.t0 - y.t0);

  // Uma pausa que atravessa a costura entre dois pedacos e UMA pausa: no tempo
  // do clipe ela e continua, ainda que venha de dois lugares do arquivo.
  const juntas = [];
  soltas.forEach((g) => {
    const ult = juntas[juntas.length - 1];
    if (ult && g.t0 - ult.t1 < 1e-3) ult.t1 = Math.max(ult.t1, g.t1);
    else juntas.push({ t0: g.t0, t1: g.t1 });
  });

  return juntas.filter((g) => g.t1 - g.t0 >= minLen);
}

export function probeHush(c?) {
  clearTimeout(hushProbe);
  hushProbe = setTimeout(async () => {
    // A janela pedida cobre TODOS os pedacos: num clipe fundido eles podem
    // estar espalhados pelo arquivo, e o que interessa e o material que o
    // clipe toca, seja de onde for.
    const ps = clipPieces(c);
    const de = Math.min.apply(null, ps.map((p) => p.in));
    const ate = Math.max.apply(null, ps.map((p) => p.in + p.len));

    const r = await api.silences(c.media, de, ate,
                                 state.hush.db, state.hush.min, state.hush.pad,
                                 state.hush.sens);
    if (!hushBox) return;

    const el = document.getElementById("hushCount");
    if (!r || !r.ok) {
      state.hushGaps = null;
      if (el) el.textContent = (r && r.error) || "nao deu para sondar";
      refresh(["timeline"]);
      return;
    }

    const list = gapsToClip(c, r.gaps.map((g) => ({ t0: g[0], t1: g[1] })),
                            state.hush.min);
    const mudo = list.reduce((a, g) => a + (g.t1 - g.t0), 0);
    state.hushGaps = { clip: c.id, list };
    if (el) {
      el.textContent = list.length
          ? list.length + (list.length === 1 ? " pausa, " : " pausas, ") +
            mudo.toFixed(1) + "s de " + c.len.toFixed(1) + "s"
          : "nenhuma pausa com estes ajustes";
    }
    refresh(["timeline"]);
  }, 120);
}

// ------------------------------------------------------- cortar na voz
//
// A parte que o modelo de voz torna possivel. E preciso dizer o que ele NAO
// faz: a voz separada nao entra no projeto nem substitui nada. Ela e um mapa -
// serve para achar onde a fala para, e para desenhar a onda. O corte acontece
// no clipe de video, inteiro, com o audio original junto, exatamente como se
// tivesse sido dado a mao com a tesoura.
//
// Sem ela nao da. Foi medido nesta mesma gravacao: com o limiar tirado da
// estatistica da propria mistura, o melhor que se consegue e 80% de precisao -
// um em cada cinco segundos cortados seria fala. O ar condicionado, o teclado
// e o ruido do microfone ocupam a faixa toda, e entre o chao e a fala nao ha
// fronteira limpa. Na voz isolada ha.
//
// O que ele faz e o gesto que a gente vinha fazendo a mao: corta nas duas
// pontas de cada pausa e manda o miolo para baixo, em vermelho. Nada some, e
// cada pedaco volta pela setinha se tiver sido levado por engano.

// As pausas ja vem sondadas pelos controles: o que se corta e exatamente o que
// estava aceso sobre o clipe um instante antes de apertar Cortar.
export function cutSilences(c?, gaps?) {
  // Um so passo para a leva inteira: desfazer uma limpeza de cinquenta pausas
  // e desfazer a limpeza, e nao cinquenta cortes um a um.
  remember();

  // De tras para a frente: cada corte encurta o clipe da esquerda, e como nem
  // o inicio dele nem o ponto de entrada mudam, os instantes das pausas
  // anteriores continuam valendo nele.
  const quiet = [];
  for (let i = gaps.length - 1; i >= 0; --i) {
    // As pausas ja vieram em tempo do clipe.
    const a = c.start + gaps[i].t0;
    const b = c.start + gaps[i].t1;
    splitClipAt(c, b);               // separa o que vem depois da pausa
    const q = splitClipAt(c, a);     // e a pausa em si
    if (q) { quiet.push(q); continue; }
    // A pausa comeca no proprio inicio do clipe: nao ha o que separar antes
    // dela - o que sobrou do clipe E a pausa.
    if (a <= c.start + MIN_CLIP) { quiet.push(c); break; }
  }

  // Descer da esquerda para a direita: cada pausa aponta para o vizinho que
  // ficou antes dela, e esse vizinho so esta no lugar certo depois que todos
  // os cortes ja foram dados.
  const fila = quiet.sort((x, y) => x.start - y.start);
  fila.forEach(sendDown);
  // Numa leva, o que interessa conferir e o comeco do trecho limpo, e nao a
  // ultima pausa - e por ali que se comeca a ouvir.
  if (fila.length) state.lastCut = fila[0].start;
  layoutTossed();

  state.pickedPoint = 0;
  select({ clip: c.id, media: -1 });
  seekCommit();
  toast(quiet.length + (quiet.length === 1 ? " pausa foi" : " pausas foram") +
        " para a pista de baixo. Juntar fecha os buracos.");
}

// ---------------------------------------------------------- fundir pecas
//
// A inversa do dividir: duas metades voltam a ser uma peca so. Serve ao corte
// dado no lugar errado, e a limpeza depois de uma triagem que picou demais.
//
// A regra e estrita, e tem de ser. Um clipe e UMA janela sobre UM arquivo: so
// da para representar como peca unica o que for seguido tambem DENTRO do
// arquivo. Duas pecas encostadas na linha do tempo mas com um pulo no meio -
// o caso de todo trecho de onde se tirou uma pausa - nao podem virar uma:
// fundi-las apagaria o pulo em silencio e devolveria a pausa ao video.

export const MERGE_EPS = 1e-3;

// Duas pecas so viram uma quando sao do mesmo arquivo, estao encostadas na
// linha do tempo E seguidas dentro do arquivo.
export function emendam(a?, b?) {
  return a.media === b.media &&
         Math.abs(b.start - (a.start + a.len)) < MERGE_EPS &&
         Math.abs((b.inPoint || 0) - ((a.inPoint || 0) + a.len)) < MERGE_EPS;
}

// Duas pecas se encostam na linha do tempo, na mesma pista. E o bastante para
// formarem um bloco - nao para virarem uma janela so.
export function encostam(a?, b?) {
  return a.track === b.track &&
         Math.abs(b.start - (a.start + a.len)) < MERGE_EPS;
}

export function mergeSelection() {
  // Os descartados ficam de fora: la embaixo o lugar de cada um sai da corrente
  // de vizinhos, e nao do instante - fundir ali seria mexer em outra coisa.
  const alvos = pickedClips().filter((c) => !c.off);
  if (alvos.length < 2) {
    toast("Escolha duas ou mais pecas para fundir.");
    return;
  }

  // Por pista, em ordem: so se funde o que esta lado a lado.
  const porPista = new Map();
  alvos.forEach((c) => {
    if (!porPista.has(c.track)) porPista.set(c.track, []);
    porPista.get(c.track).push(c);
  });

  // Cada trecho e uma fileira de pecas encostadas de ponta a ponta. Dentro de
  // um trecho, o que for seguido tambem DENTRO do arquivo vira uma peca so; o
  // resto vira bloco.
  const trechos = [];
  porPista.forEach((lista) => {
    lista.sort((a, b) => a.start - b.start);
    let atual = [lista[0]];
    for (let i = 1; i < lista.length; ++i) {
      if (encostam(atual[atual.length - 1], lista[i])) atual.push(lista[i]);
      else { if (atual.length > 1) trechos.push(atual); atual = [lista[i]]; }
    }
    if (atual.length > 1) trechos.push(atual);
  });

  if (!trechos.length) {
    toast("Nada a fundir: as pecas escolhidas nao estao encostadas na mesma pista.");
    return;
  }

  remember();

  // Fundir e virar UM clipe. Cada trecho encostado vira uma peca so, que
  // guarda a lista do que ela toca: os pedacos seguem no arquivo onde sempre
  // estiveram, com os pulos que o corte deixou entre eles, mas daqui para fora
  // aquilo e um clipe - um nome, um volume, uma linha de volume, um
  // enquadramento, e nada que se possa arrastar por dentro.
  let absorvidas = 0, fundidos = 0;

  trechos.forEach((trecho) => {
    const primeira = trecho[0];

    const pecas = [];
    const pontos = [];
    const anima = [];
    let desloc = 0;
    trecho.forEach((c) => {
      clipPieces(c).forEach((p) => pecas.push({ in: p.in, len: p.len }));
      // Os pontos de volume de cada peca, deslocados para o tempo da peca
      // nova: o que foi desenhado a mao continua onde foi desenhado.
      (c.points || []).forEach((p) => {
        pontos.push({ id: state.nextId++, t: desloc + p.t, db: p.db });
      });
      // O mesmo com os pontos de animacao. Num bloco eles ja vinham repetidos
      // em cada peca, deslocados - juntar as pecas junta as copias, e os
      // instantes coincidem: o movimento sai do outro lado igual ao que era.
      (c.anim || []).forEach((p) => {
        const t = desloc + p.t;
        if (anima.some((x) => Math.abs(x.t - t) <= ANIM_EPS)) return;
        anima.push({ id: state.nextId++, t: t, esc: p.esc, x: p.x, y: p.y,
                     rot: p.rot, s: p.s || 0 });
      });
      desloc += c.len;
    });
    anima.sort((a, b) => a.t - b.t);

    // O desenho guardado nao serve mais: os pedacos mudaram de dono e de
    // numero. Sai antes de as pecas sumirem, enquanto ainda se sabe quantos
    // pedacos cada uma tinha.
    trecho.forEach((c) => {
      clipPieces(c).forEach((_, i) => {
        state.strips.delete(pieceKey(c, i));
        state.waves.delete(pieceKey(c, i));
      });
    });

    const sumidas = new Set(trecho.slice(1).map((c) => c.id));
    state.clips = state.clips.filter((c) => !sumidas.has(c.id));

    // Um descartado que apontava para uma peca absorvida passa a apontar para
    // a que sobrou - senao perderia o lugar de volta.
    state.clips.forEach((c) => { if (sumidas.has(c.back)) c.back = primeira.id; });

    setPieces(primeira, pecas);
    primeira.points = pontos;
    if (anima.length) primeira.anim = anima;
    else delete primeira.anim;
    primeira.grupo = 0;          // nao ha mais bloco a formar: ha um clipe
    absorvidas += trecho.length;
    ++fundidos;
  });

  state.picked = new Set(trechos.map((t) => t[0].id));
  state.pickedClip = trechos[0][0].id;
  state.pickedPoint = 0;
  state.pickedMedia = -1;

  layoutTossed();
  afterClipChange(["player"]);
  seekCommit();

  toast(absorvidas + " pecas viraram " +
        (fundidos === 1 ? "um clipe so." : fundidos + " clipes."));
}

// Desfaz o bloco, deixando as pecas soltas de novo.
export function unmergeSelection() {
  const alvos = pickedClips().filter((c) => c.grupo);
  if (!alvos.length) { toast("Nenhum bloco escolhido."); return; }

  remember();
  const gs = new Set(alvos.map((c) => c.grupo));
  let n = 0;
  state.clips.forEach((c) => { if (gs.has(c.grupo)) { c.grupo = 0; ++n; } });
  refresh(["timeline", "props"]);
  toast(n + " pecas soltas de novo.");
}

// --------------------------------------------------- copiar, colar, conferir

export function copyClip() {
  const c = state.clips.find((x) => x.id === state.pickedClip);
  if (!c) { toast("Escolha um clipe para copiar."); return; }

  // Copia inteira e solta: o original pode ser cortado, movido ou apagado, e o
  // que esta na area de transferencia continua sendo o que foi copiado.
  state.clipboard = JSON.parse(JSON.stringify(c));
  toast(c.name + " copiado - " + fmtTime(c.len, true) + ".");
}

export function pasteClip() {
  const src = state.clipboard;
  if (!src) { toast("Nada copiado ainda."); return; }

  // Um texto nao vem de arquivo nenhum - o que ele precisa para existir esta
  // todo dentro da copia. So a midia depende de o arquivo continuar no
  // projeto, e era esta pergunta, feita a todos, que recusava colar texto.
  if (!isText(src) && !state.media.some((m) => m.id === src.media)) {
    toast("O arquivo daquele clipe ja saiu do projeto.");
    return;
  }

  remember();

  // A pista de destino, em ordem de preferencia: a do clipe escolhido, a do
  // copiado, a primeira do tipo certo. A cola tem de cair em algum lugar mesmo
  // que a pista original tenha sumido no meio do caminho.
  //
  // Estando o clipe la embaixo, vale a pista de ONDE ELE VEIO, e nao a de
  // descarte: colar uma peca viva na faixa das sobras seria po-la justamente
  // onde nada toca.
  const escolhido = state.clips.find((x) => x.id === state.pickedClip);
  const kind = trackKind(src);
  const start = Math.max(0, state.pos);

  const daSelecao = escolhido
      ? (escolhido.off ? homeTrack(escolhido)
                       : state.tracks.find((t) => t.id === escolhido.track))
      : null;
  const daCopia = state.tracks.find((t) => t.id === (src.off ? src.home : src.track));

  // Pista candidata so vale se for do tipo certo: com um video escolhido,
  // colar um audio na pista dele poria som numa faixa de imagem.
  const cabe = (t) => (t && t.kind === kind ? t : null);

  // O texto nao empurra ninguem: ele procura uma faixa livre naquele instante,
  // como no arrasto, e nasce outra se nao houver.
  const track = isText(src)
      ? freeTextTrack(start, src.len, null, (cabe(daSelecao) || cabe(daCopia) || {}).id)
      : (cabe(daSelecao) || cabe(daCopia) ||
         state.tracks.find((t) => t.kind === kind) || addTrack(kind));

  const c = Object.assign({}, src, {
    id: state.nextId++,
    track: track.id,
    start: start,
    // Cola sempre na montagem, mesmo que o copiado estivesse la embaixo: quem
    // cola quer a peca de volta ao trabalho, e nao outra sobra.
    off: false, home: 0, back: 0,
    points: (src.points || []).map((p) => ({ id: state.nextId++, t: p.t, db: p.db })),
  });

  // A animacao vai junto, com pontos proprios: colada duas vezes, cada copia
  // tem de poder ser mexida sem mexer na outra.
  if (src.anim && src.anim.length) {
    c.anim = src.anim.map((p) => ({ id: state.nextId++, t: p.t, esc: p.esc,
                                    x: p.x, y: p.y, rot: p.rot, s: p.s || 0 }));
  } else {
    delete c.anim;
  }

  // `Object.assign` copia a REFERENCIA destes dois. Sem clona-los, dois clipes
  // colados da mesma copia dividiriam o mesmo texto e o mesmo enquadramento -
  // mexer num mexeria no outro, e ninguem entenderia por que.
  if (src.texto) c.texto = Object.assign({}, src.texto);
  if (src.tf) c.tf = Object.assign({}, src.tf);

  state.clips.push(c);
  // Empurrar quem estiver no lugar e coisa de midia; o texto ja caiu numa
  // faixa onde nao ha ninguem.
  if (!isText(c)) openRoom(c);
  layoutTossed();
  select({ clip: c.id, media: -1 });
  seekCommit();
  toast("Colado em " + fmtTime(c.start, true) + ".");
}

// Fecha os buracos e leva a agulha para um pouco antes do ultimo corte. E o
// gesto de conferir: cortou, mandou para baixo, junta e ouve a emenda - sem
// ter de procurar a mao onde ela estava.
export const REVIEW_LEAD = 1.5;   // segundos de embalo antes da emenda

export function joinAndReview() {
  joinTracks();
  if (state.lastCut == null) { toast("Nenhum corte para conferir ainda."); return; }
  seekCommit(Math.max(0, state.lastCut - REVIEW_LEAD));
  followPlayhead();
}

// ------------------------------------------------------- juntar as pecas
//
// Depois da triagem a montagem fica cheia de buracos, um por peca mandada
// para baixo. Juntar fecha todos de uma vez: em cada pista, o que ficou
// desliza para a esquerda ate encostar no vizinho, na ordem em que ja estava.
// A primeira peca nao se mexe - ela e a referencia.

export function joinTracks() {
  // O retrato sai antes, mas so entra no historico se algo tiver andado: um
  // Juntar sem buraco nenhum nao pode gastar um passo de desfazer.
  const antes = snapshot();
  let moved = 0;
  state.tracks.forEach((tr) => {
    const kept = state.clips.filter((c) => c.track === tr.id && !c.off)
                            .sort((a, b) => a.start - b.start);
    let at = kept.length ? kept[0].start : 0;
    kept.forEach((c) => {
      if (Math.abs(c.start - at) > 1e-4) { c.start = at; ++moved; }
      at += c.len;
    });
  });

  // As pontas vermelhas acompanham: cada uma vai parar debaixo da emenda de
  // onde saiu, que e justamente o buraco que acabou de se fechar.
  layoutTossed();

  if (!moved) { toast("Nao ha buracos para fechar."); return false; }
  rememberSnapshot(antes);
  refreshSelection(["player"]);
  seekCommit();
  return true;
}

// --------------------------------------------------- a caixa de selecao
//
// Arrastar no vazio da linha do tempo desenha uma caixa, e tudo o que ela
// encostar entra na selecao. Ctrl ou Shift somam a selecao que ja havia, em
// vez de troca-la.
//
// Durante o gesto so as CLASSES dos clipes mudam - nada de refazer a linha do
// tempo a cada pixel, que trocaria os elementos debaixo do ponteiro e mataria
// o proprio arrasto.

export function paintPicked() {
  document.querySelectorAll(".clip[data-clip]").forEach((n) => {
    n.classList.toggle("on", state.picked.has(Number(n.dataset.clip)));
  });
}

export function beginBand(inner?, e?) {
  if (e.button !== 0) return;

  const x0 = e.clientX, y0 = e.clientY;
  const antes = new Set(state.picked);
  const soma = e.ctrlKey || e.shiftKey;

  // As pistas, medidas uma vez: o que a caixa cobre em altura sai daqui.
  const lanes = [];
  inner.querySelectorAll(".lane").forEach((n) => {
    lanes.push({ id: Number(n.dataset.track), box: n.getBoundingClientRect() });
  });
  const base = inner.getBoundingClientRect();

  let caixa = null;

  const move = (ev) => {
    // So vira caixa depois de a mao andar: um clique no vazio e um clique, e
    // ele apenas larga a selecao.
    if (!caixa) {
      if (Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
      caixa = document.createElement("div");
      caixa.className = "band";
      inner.appendChild(caixa);
    }

    const a = Math.min(x0, ev.clientX), b = Math.max(x0, ev.clientX);
    const c = Math.min(y0, ev.clientY), d = Math.max(y0, ev.clientY);
    caixa.style.left = (a - base.left) + "px";
    caixa.style.top = (c - base.top) + "px";
    caixa.style.width = (b - a) + "px";
    caixa.style.height = (d - c) + "px";

    const t0 = (a - base.left) / state.zoom;
    const t1 = (b - base.left) / state.zoom;
    const pistas = new Set(lanes.filter((L) => d >= L.box.top && c <= L.box.bottom)
                                .map((L) => L.id));

    // Encostar basta: um clipe nao precisa caber inteiro na caixa para entrar.
    const achados = new Set(soma ? antes : []);
    state.clips.forEach((x) => {
      if (pistas.has(x.track) && x.start < t1 && x.start + x.len > t0) {
        achados.add(x.id);
      }
    });
    // Encostar numa peca do bloco traz o bloco: meia duzia escolhida pela
    // metade desmancharia a ideia no primeiro arrasto.
    state.picked = widenToGroups(achados);
    paintPicked();
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (caixa) caixa.remove();

    // Sem caixa nao houve gesto: foi um clique no vazio, que larga tudo.
    if (!caixa && !soma) state.picked = new Set();

    const primeiro = state.clips.find((x) => state.picked.has(x.id));
    if (!state.picked.has(state.pickedClip)) {
      state.pickedClip = primeiro ? primeiro.id : -1;
      state.pickedPoint = 0;
    }
    if (state.picked.size) state.pickedMedia = -1;
    refreshSelection();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// ------------------------------------------------------- arrastar um clipe
//
// O clipe acompanha a mao nos dois sentidos. Preso a pista - so andando na
// horizontal - o arrasto parecia travado, e nao havia como ver que ele estava
// subindo: dai a impressao de que so cabia no fim. Ele nao troca de pista no
// meio do gesto, porem: reparenta-lo custaria a captura do ponteiro, e o
// arrasto morreria no primeiro pixel. Quem diz para onde ele vai e a pista
// marcada debaixo dele.
//
// E enquanto a mao segura, a pista de destino ja abre o lugar. O espaco que
// se ve e o espaco que fica - a mesma conta dos dois lados.

export function beginClipDrag(el?, c?, down?) {
  const startX = down.clientX, startY = down.clientY, startAt = c.start;
  // O mundo antes de a mao encostar. So entra no historico se o arrasto
  // chegar a acontecer.
  const before = snapshot();

  // Arrastando um clipe que faz parte de uma selecao multipla, vai o grupo
  // inteiro - e cada peca guarda de onde saiu, para todas andarem o mesmo
  // tanto. Grupo nao troca de pista: cinco clipes caindo numa faixa so
  // ficariam empilhados, e ninguem pede isso arrastando.
  const grupo = isPicked(c.id) && state.picked.size > 1
      ? pickedClips().map((x) => ({ c: x, start: x.start }))
      : null;

  // Os elementos de todos os clipes, uma vez so: a previa mexe neles direto,
  // sem refazer o desenho da linha a cada pixel.
  const nodes = new Map();
  document.querySelectorAll(".clip[data-clip]").forEach((n) => {
    nodes.set(Number(n.dataset.clip), n);
  });

  const inner = el.closest(".tl-inner");
  const heads = [];
  if (inner) inner.querySelectorAll(".lane").forEach((n) => {
    heads.push({ el: n, id: Number(n.dataset.track) });
  });
  // A faixa do fim vale como destino tambem para quem ja esta na linha: e o
  // mesmo pedido - uma pista nova - vindo de dentro em vez de vir da cesta.
  const fim = inner ? inner.querySelector(".lane-new") : null;
  if (fim) heads.push({ el: fim, id: null, nova: true });

  // A pista pela geometria, e nao por elementFromPoint: com o clipe seguindo
  // a mao, o que esta sob o ponteiro e sempre ele mesmo, e a busca devolveria
  // sempre a pista de origem.
  //
  // A beirada conta, e e o ponto todo: largar nos poucos pixels junto da divisa
  // de uma pista nao e largar NELA - e pedir uma pista nova naquele degrau da
  // pilha. Quem vinha da cesta de midia ja tinha este gesto; quem ja estava na
  // linha do tempo, nao, e sem ele nao havia como enfiar uma pista de texto
  // ENTRE duas de video: a unica pista nova que se podia pedir de dentro era a
  // do fim, la embaixo de tudo.
  const laneAt = (y) => {
    const achou = heads.find((L) => {
      const b = L.el.getBoundingClientRect();
      return y >= b.top && y < b.bottom;
    });
    if (!achou || achou.id == null) return achou || null;

    const b = achou.el.getBoundingClientRect();
    const i = state.tracks.findIndex((t) => t.id === achou.id);
    if (i >= 0 && y - b.top <= DROP_EDGE)
      return { el: achou.el, id: null, nova: true, onde: i, borda: "cima" };
    if (i >= 0 && b.bottom - y <= DROP_EDGE)
      return { el: achou.el, id: null, nova: true, onde: i + 1, borda: "baixo" };
    return achou;
  };

  // A marca do destino: um risco na divisa quando o pedido e por pista nova, o
  // contorno da pista inteira quando e por largar dentro dela. Sao gestos
  // diferentes e precisam parecer diferentes - com o mesmo contorno nos dois,
  // ninguem descobre que a beirada faz outra coisa.
  const marcaLane = (L, liga) => {
    if (!L) return;
    const classe = L.borda ? "drop-edge-" + L.borda : "drop-lane";
    L.el.classList.toggle(classe, liga);
  };

  // O arrasto so comeca quando a mao anda de fato. Sem esta folga, um clique
  // para escolher o clipe ja abriria espaco e o largaria de volta - e num
  // descartado chegaria a move-lo para a boca mais perto.
  const SLOP = 4;
  let lane = null, mark = null, live = false;

  // Devolve cada peca ao lugar que o estado diz - o ponto de partida de
  // qualquer previa.
  const settle = () => {
    nodes.forEach((n, id) => {
      if (id === c.id) return;
      const x = state.clips.find((y) => y.id === id);
      if (x) n.style.left = (x.start * state.zoom) + "px";
    });
  };

  const showRoom = (trackId) => {
    if (mark) { mark.remove(); mark = null; }
    settle();
    // Aqui ele nunca cai descartado: ou ja estava na montagem, ou esta
    // subindo para ela - e e por isso que o espaco abre.
    roomFor(trackId, c, c.start, false).forEach((at, id) => {
      const n = id === c.id ? null : nodes.get(id);
      if (n) n.style.left = (at * state.zoom) + "px";
    });
  };

  // Um descartado que fica na propria pista nao abre espaco: ele gruda numa
  // boca. A guia mostra em qual.
  const showSeat = () => {
    settle();
    if (!mark && inner) {
      mark = document.createElement("div");
      mark.className = "seat-mark";
      inner.appendChild(mark);
    }
    if (mark) mark.style.left = (seatAt(c, c.start) * state.zoom) + "px";
  };

  return {
    move(ev) {
      if (!live) {
        if (Math.abs(ev.clientX - startX) < SLOP &&
            Math.abs(ev.clientY - startY) < SLOP) return;
        live = true;
        el.classList.add("dragging");
      }

      const dt = (ev.clientX - startX) / state.zoom;
      el.style.transform = "translateY(" + (ev.clientY - startY) + "px)";

      if (grupo) {
        // Todos andam o mesmo tanto, e o que estiver mais a esquerda segura o
        // grupo no zero - senao ele se espremeria contra a borda.
        const menor = Math.min.apply(null, grupo.map((g) => g.start));
        const desloc = Math.max(dt, -menor);
        grupo.forEach((g) => {
          g.c.start = g.start + desloc;
          const n = nodes.get(g.c.id);
          if (n) n.style.left = (g.c.start * state.zoom) + "px";
        });
        return;
      }

      c.start = Math.max(0, startAt + dt);
      el.style.left = (c.start * state.zoom) + "px";

      const over = laneAt(ev.clientY);
      // Pista nova na beirada vale mesmo sobre a propria pista do clipe: quem
      // arrasta ate a divisa esta pedindo um degrau novo, e nao voltar para
      // onde ja estava.
      const to = over && (over.nova || over.id !== c.track) ? over : null;
      if (to !== lane) {
        marcaLane(lane, false);
        lane = to;
        marcaLane(lane, true);
      }

      const target = lane && lane.id != null ? lane.id : c.track;
      if (c.off && target === c.track) showSeat();
      else showRoom(target);
    },

    drop() {
      el.classList.remove("dragging");
      el.style.transform = "";
      if (mark) mark.remove();
      marcaLane(lane, false);
      // Sem arrasto nao houve gesto nenhum: foi so um clique para escolher, e
      // nada tem de sair do lugar.
      if (!live) {
        if (grupo) grupo.forEach((g) => { g.c.start = g.start; });
        else c.start = startAt;
        return;
      }
      // O ponto de partida foi guardado la atras, no comeco do arrasto: o que
      // se desfaz e o clipe de volta a origem, e nao ao lugar onde a mao
      // estava no ultimo pixel.
      rememberSnapshot(before);

      if (grupo) {
        openRoomFor(grupo.map((g) => g.c));
        layoutTossed();
        return;
      }
      // Largado na faixa do fim, ou na divisa entre duas pistas: nasce a pista
      // e o clipe vai para ela no instante onde a mao o deixou - sem empurrar
      // ninguem, porque la nao ha ninguem. `onde` e o degrau; sem ele, o fim.
      if (lane && lane.nova) {
        const degrau = lane.onde != null ? lane.onde : state.tracks.length;
        c.track = addTrack(trackKind(c), degrau).id;
        if (c.off) { c.off = false; c.home = 0; c.back = 0; sendVolume(c); }
        layoutTossed();
        return;
      }
      dropClip(c, lane ? lane.id : c.track);
    },
  };
}

// ------------------------------------------------- as pontas do texto
//
// Arrastar a ponta esquerda muda quando o texto entra sem mexer em quando ele
// sai; a direita faz o contrario. Sao os dois lados da mesma pergunta - por
// quanto tempo ele fica - e e por isso que as duas alcas existem em vez de um
// campo de duracao so.

// O menor pedaco que ainda se ve e se pega.
export function minTrim(c?) { return isText(c) ? TEXT_MIN_LEN : 0.1; }

// Quanto material o arquivo tem. Uma foto parada nao tem fim - ela dura o que
// se quiser - e um texto tampouco; um video dura o que foi gravado.
export function sourceLen(c?) {
  if (isText(c) || c.kind === "imagem") return Infinity;
  const m = state.media.find((x) => x.id === c.media);
  return m && m.duration > 0 ? m.duration : Infinity;
}

// Ate onde a ponta pode ir sem passar por cima de um vizinho da mesma pista.
// Descartado so esbarra em descartado: eles vivem numa faixa a parte.
export function wallRight(c?) {
  let at = Infinity;
  state.clips.forEach((x) => {
    if (x.id === c.id || x.track !== c.track || !!x.off !== !!c.off) return;
    if (x.start >= c.start + c.len - 1e-6 && x.start < at) at = x.start;
  });
  return at;
}

export function wallLeft(c?) {
  let at = 0;
  state.clips.forEach((x) => {
    if (x.id === c.id || x.track !== c.track || !!x.off !== !!c.off) return;
    const fim = x.start + x.len;
    if (fim <= c.start + 1e-6 && fim > at) at = fim;
  });
  return at;
}

export function trimGrip(c?, lado?) {
  const g = document.createElement("i");
  g.className = "trim " + lado;
  g.title = lado === "a" ? "Arraste para mudar onde este clipe comeca"
                         : "Arraste para mudar onde este clipe termina";
  g.addEventListener("pointerdown", (e) => beginTrim(e, c, g, lado));
  return g;
}

export function beginTrim(e?, c?, grip?, lado?) {
  if (e.button !== 0) return;
  // Sem isto o apertar chega ao clipe, e o gesto vira um arrasto do clipe
  // inteiro - que e justamente o contrario do que se esta pedindo.
  e.preventDefault();
  e.stopPropagation();

  const el = grip.parentElement;
  const antes = snapshot();
  const x0 = e.clientX, start0 = c.start, len0 = c.len;
  const fim = start0 + len0;
  // A lista de pedacos como ela estava quando a mao encostou: e dela que cada
  // passo do arrasto parte, e nao do estado ja mexido.
  const pecas0 = clipPieces(c).map((p) => ({ in: p.in, len: p.len }));
  // Os instantes dos pontos de animacao como estavam ao encostar a mao. Eles
  // sao contados do comeco do clipe, e a ponta esquerda MOVE esse comeco: sem
  // guardar os originais, cada pixel do arrasto os empurraria na linha do
  // tempo, e o movimento sairia do lugar onde foi marcado.
  const anim0 = (c.anim || []).map((p) => p.t);
  const fonte = sourceLen(c);
  const MIN = minTrim(c);
  // As paredes sao medidas uma vez, no comeco: durante o arrasto o proprio
  // clipe muda de tamanho, e procura-las a cada pixel as faria fugir dele.
  const parede = { esq: wallLeft(c), dir: wallRight(c) };
  let andou = false;

  capture(grip, e.pointerId);

  const move = (ev) => {
    const dt = (ev.clientX - x0) / state.zoom;
    if (!andou) {
      if (Math.abs(ev.clientX - x0) < 3) return;
      andou = true;
      el.classList.add("trimming");
    }
    // Num clipe fundido a ponta mexe no pedaco daquele lado, e nao no clipe
    // inteiro: o resto da lista fica onde esta, com os pulos que tem.
    const pecas = pecas0.map((p) => ({ in: p.in, len: p.len }));
    const primeira = pecas[0], ultima = pecas[pecas.length - 1];

    if (lado === "a") {
      // A ponta esquerda esbarra em quatro paredes: o zero da linha, o vizinho
      // de tras, a duracao minima - para o clipe nao virar um risco sem nada
      // dentro - e, num video, o comeco do proprio arquivo.
      const antes = fonte === Infinity ? Infinity
                                       : primeira.in / clipSpeed(c);
      const chao = Math.max(0, parede.esq, start0 - antes);
      c.start = clamp(start0 + dt, chao, fim - MIN);

      // O pedaco do arquivo anda junto: o quadro que aparece em cada instante
      // continua sendo o mesmo, e so o comeco e o fim mudam. Numa foto ou num
      // texto nao ha arquivo que ande - so a duracao muda.
      const v = clipSpeed(c);
      const desloc = (c.start - start0) * v;   // em segundos de arquivo
      primeira.len -= desloc;
      if (fonte !== Infinity) primeira.in += desloc;
    } else {
      // O teto do ultimo pedaco: o que o arquivo ainda tem depois dele, mais o
      // que os outros pedacos ja ocupam.
      const v = clipSpeed(c);
      const sobra = fonte === Infinity
          ? Infinity
          : (c.len - ultima.len / v) + (fonte - ultima.in) / v;
      const teto = Math.min(sobra, parede.dir - c.start);
      const novo = clamp(len0 + dt, MIN, Math.max(MIN, teto));
      ultima.len += (novo - len0) * v;
    }
    setPieces(c, pecas);

    // Esticar ou encurtar nao arrasta a animacao: cada ponto continua no mesmo
    // INSTANTE DA LINHA DO TEMPO em que foi posto. Quem quiser levar os pontos
    // junto move o clipe inteiro - ali eles viajam, que e o que se espera de um
    // clipe que muda de lugar.
    if (c.anim) {
      const desloca = c.start - start0;
      c.anim.forEach((p, i) => { p.t = anim0[i] - desloca; });
      spreadTF(c);
    }

    el.style.left = (c.start * state.zoom) + "px";
    el.style.width = Math.max(14, c.len * state.zoom) + "px";
    // Os losangos seguem a ponta: a faixa e filha do clipe, que acabou de
    // mudar de largura, e sem isto eles so acertariam o lugar ao soltar.
    pintaAnimLane(el, c);
  };

  const up = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", up);
    el.classList.remove("trimming");
    if (!andou) return;
    rememberSnapshot(antes);
    refreshSelection(["player"]);
    seekCommit();
  };

  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", up);
}

// -------------------------------------------------- os quadros do clipe
//
// A tira vem do C++ como uma imagem so, com as miniaturas ja lado a lado:
// trinta <img> por clipe seriam trinta idas e voltas pela ponte, e cada
// redesenho da linha do tempo refaria todas.

// Altura util do clipe, a mesma do CSS (.lane 78px menos as margens do
// .clip). A tira e pedida exatamente nesta altura: esticar depois foi o que
// deixou as miniaturas borradas.
export const TILE_H = 66;

// A faixa de som dentro de um clipe de video. Ela nao cobre os quadros: a
// tira fica com o resto da altura, e as duas se dividem sem se sobrepor.
export const WAVE_BAND = 22;

// Altura da tira num clipe que tambem mostra som.
export function stripHeight(c?) { return TILE_H - (wantsWave(c) ? WAVE_BAND : 0); }

export function drawStrip(clipEl?, c?) {
  const m = state.media.find((x) => x.id === c.media);
  const quer = !!(m && m.hasVideo);

  const pecas = quer ? clipPieces(c) : [];
  const imgs = syncPieceNodes(clipEl, "strip", "img", pecas.length);
  if (!pecas.length) return;

  const win = visibleWindow(c);
  const alt = stripHeight(c);

  pecas.forEach((pc, i) => {
    const img = imgs[i];
    img.style.height = alt + "px";

    // O pedaco deste quadrado, cortado pelo que esta a vista.
    const de = win ? Math.max(pc.a, win.from) : pc.a;
    const ate = win ? Math.min(pc.b, win.to) : pc.b;
    if (ate - de < 1e-3) { img.style.display = "none"; return; }
    img.style.display = "";

    const chave = pieceKey(c, i);
    const have = state.strips.get(chave);
    if (have) {
      img.src = have.url;
      placeStrip(img, have, c, pc);
      // Endereco que saiu de circulacao no C++ nao volta: em vez de ficar com
      // a tira quebrada, joga-se fora o que estava guardado e pede-se outra.
      img.onerror = () => {
        img.onerror = null;
        if (state.strips.get(chave) === have) state.strips.delete(chave);
        requestStrip(c, pc, de, ate, alt);
      };
    }
    requestStrip(c, pc, de, ate, alt);
  });
}

// A janela visivel do clipe, em tempo DO CLIPE - de 0 a c.len. Ela nao sai em
// tempo de arquivo porque num clipe fundido essa conta nao existe: o arquivo
// pula no meio. A travessia e feita pedaco a pedaco, por quem desenha.
export function visibleWindow(c?) {
  const view = state.tlScroll.w;
  // Ainda nao se sabe o tamanho da tela - e o primeiro desenho, antes de a
  // linha entrar na pagina. Nao ha o que pedir: pedir a esmo aqui gastava
  // segundos numa tira do clipe inteiro que seria trocada em seguida, e pior,
  // segurava o pedido certo, que so sai um de cada vez por pedaco.
  if (!view) return null;

  // Meia tela de folga de cada lado, para rolar um pouco nao desmanchar a
  // tira que ja esta pronta.
  const pad = view / 2;
  const from = clamp((state.tlScroll.x - pad) / state.zoom - c.start, 0, c.len);
  const to = clamp((state.tlScroll.x + view + pad) / state.zoom - c.start, 0, c.len);
  if (to - from < 1e-3) return null;
  return { from: from, to: to };
}

// O que fica guardado e por clipe E por pedaco: um clipe fundido tem uma tira
// e uma onda para cada pedaco, porque cada um vem de um lugar do arquivo.
export function pieceKey(c?, i?) { return c.id + ":" + i; }

// Os elementos de desenho de um clipe, um por pedaco. Sobrando ou faltando,
// ajusta - e devolve a lista na ordem.
export function syncPieceNodes(clipEl?, classe?, tag?, quantos?) {
  const nodes = [...clipEl.querySelectorAll("." + classe)];
  for (let i = nodes.length; i < quantos; ++i) {
    const el = document.createElement(tag);
    el.className = classe;
    el.dataset.peca = i;
    if (tag === "img") { el.alt = ""; el.draggable = false; }
    clipEl.appendChild(el);
    nodes.push(el);
  }
  while (nodes.length > quantos) nodes.pop().remove();
  return nodes;
}

// A tira guardada pode cobrir mais tempo do que o clipe mostra agora - e o que
// acontece logo depois de um corte, quando as duas metades herdam a tira da
// peca inteira. Em vez de esticar a imagem toda sobre o pedaco, mostramos a
// PARTE dela que corresponde ao trecho: o corte fica certo na tela no mesmo
// quadro, sem decodificar nada, e a tira definitiva entra por cima quando
// chegar.
export function placeStrip(img?, have?, c?, pc?) {
  const span = have.t1 - have.t0;        // em tempo de arquivo
  const len = Math.max(1e-6, c.len);
  if (span <= 1e-6) { img.style.width = "100%"; img.style.left = "0"; return; }

  // O que esta guardado cobre [have.t0, have.t1] DENTRO deste pedaco; no tempo
  // do clipe isso comeca em pc.a + (have.t0 - pc.in) / velocidade.
  const v = clipSpeed(c);
  img.style.width = (span / v / len * 100) + "%";
  img.style.left = ((pc.a + (have.t0 - pc.in) / v) / len * 100) + "%";
}

// Joga fora o que estava guardado para clipes que nao existem mais.
export function pruneCaches() {
  const vivos = new Set(state.clips.map((c) => c.id));
  // As chaves sao "clipe:pedaco"; o dono e o que vem antes dos dois pontos.
  const dono = (k) => Number(String(k).split(":")[0]);
  state.strips.forEach((_, k) => { if (!vivos.has(dono(k))) state.strips.delete(k); });
  state.waves.forEach((_, k) => { if (!vivos.has(dono(k))) state.waves.delete(k); });
}

// Os dois alternadores da barra, fora dos manipuladores: o botao e o atalho
// chamam o mesmo codigo, e nao duas copias que um dia divergem.

// Ver a fala isolada em vez da mistura. Quando o arquivo do clipe escolhido
// ainda nao teve a voz separada, clicar aqui e pedir a separacao: e o unico
// lugar onde ela ainda serve para alguma coisa, e por isso o botao dela saiu
// da cesta de midia - la ele ficava solto, oferecendo um trabalho de minutos
// que quase ninguem precisava.
export async function toggleVoice() {
  // Ja desenhando a voz: desligar nao pede nada a ninguem.
  if (state.voice) { state.voice = false; refresh(["timeline"]); return; }

  const c = state.clips.find((x) => x.id === state.pickedClip);
  const daSelecao = c ? state.media.find((m) => m.id === c.media) : null;

  // Havendo voz separada por perto, e so mostra-la.
  if (state.media.some((m) => m.hasVoice)) {
    state.voice = true;
    refresh(["timeline"]);
    return;
  }

  if (!daSelecao) {
    toast("Escolha um clipe: a voz e separada do arquivo dele.");
    return;
  }
  if (state.separating) { toast("A separacao anterior ainda esta correndo."); return; }

  toast("Separando a voz de " + daSelecao.name + " - sao minutos. O corte nos "
        + "silencios nao precisa disto; isto e so para ver a fala desenhada.");
  await doSeparate(daSelecao.id);
}

export function toggleFollow() {
  state.follow = !state.follow;
  api.setPref("seguir", state.follow ? "1" : "0");
  refresh(["timeline"]);
  // Ligado com o cursor ja fora da vista, o primeiro salto sai na hora - e nao
  // so quando a agulha resolver se mexer.
  if (state.follow) followPlayhead();
}

// A janela acompanha a agulha. Ela PULA uma pagina quando o cursor sai pela
// borda, em vez de deslizar junto: com o zoom fechado a rolagem continua seria
// um borrao, e seria uma escrita no documento a cada quadro de animacao. Assim
// e uma escrita por tela percorrida.
//
// As medidas saem do estado, e nao do documento: isto roda sessenta vezes por
// segundo durante a reproducao, e perguntar a largura ao navegador a cada vez
// o obrigaria a recalcular o layout no meio do quadro.
export const FOLLOW_LEAD = 0.15;   // onde a agulha reaparece, em fracao da largura

export function followPlayhead() {
  if (!state.follow || state.scrubbing) return;

  const view = state.tlScroll.w;
  if (!view) return;

  const x = state.pos * state.zoom;
  const a = state.tlScroll.x;
  // Dentro da vista, com uma folga nas bordas: nao ha o que fazer.
  if (x >= a + 8 && x <= a + view - 8) return;

  // Junto das bordas do projeto o destino e o lugar onde a vista ja esta -
  // escrever ali nao moveria nada, mas dispararia um evento de rolagem, e com
  // ele um pedido de tiras novas, a cada quadro de animacao.
  const want = Math.max(0, x - view * FOLLOW_LEAD);
  if (Math.abs(want - a) < 1) return;

  const el = document.querySelector(".tl-scroll");
  if (!el) return;
  el.scrollLeft = want;
  state.tlScroll.x = el.scrollLeft;
}

// Refazer so as tiras, sem refazer a linha do tempo: um redesenho a cada
// rolagem trocaria os elementos debaixo do ponteiro e mataria qualquer
// arrasto em curso.
export let stripTimer = null;

export function planStrips() {
  clearTimeout(stripTimer);
  stripTimer = setTimeout(() => {
    document.querySelectorAll(".clip[data-clip]").forEach((el) => {
      const c = state.clips.find((x) => x.id === Number(el.dataset.clip));
      if (c) drawStrip(el, c);
    });
  }, 180);
}

// Quantas miniaturas cabem, dada a proporcao do video. Poucas demais e a tira
// vira borrao; muitas e a decodificacao nao acaba nunca.
export function stripCount(m?, width?, tileH?) {
  const aspect = m.width > 0 && m.height > 0 ? m.width / m.height : 16 / 9;
  const tileW = Math.max(8, Math.round(tileH * aspect));
  return clamp(Math.round(width / tileW), 1, 80);
}

export function requestStrip(c?, pc?, de?, ate?, tileH?) {
  const chave = pieceKey(c, pc.i);
  if (state.stripPending.has(chave)) return;

  const m = state.media.find((x) => x.id === c.media);
  if (!m) return;

  // Do tempo do clipe para o do arquivo, dentro deste pedaco - e na
  // velocidade do clipe, que e quanto de arquivo cada segundo consome.
  const v = clipSpeed(c);
  const t0 = pc.in + (de - pc.a) * v;
  const t1 = pc.in + (ate - pc.a) * v;

  // Quantos pixels essa janela ocupa - e dai quantas miniaturas, uma por
  // largura propria, sem esticar nenhuma.
  const px = (ate - de) * state.zoom;
  if (px < 24) return;               // estreito demais para mostrar algo
  const count = stripCount(m, px, tileH);

  const have = state.strips.get(chave);
  if (have && have.count === count && have.tileH === tileH &&
      Math.abs(have.t0 - t0) < 1e-3 && Math.abs(have.t1 - t1) < 1e-3) {
    return;
  }

  state.stripPending.add(chave);
  api.strip(c.media, t0, t1, count, Math.round(tileH * (window.devicePixelRatio || 1)))
     .then((r) => {
    state.stripPending.delete(chave);
    if (!r || !r.ok) return;
    state.strips.set(chave, { t0: t0, t1: t1, count: count, tileH: tileH, url: r.url });

    // Redesenha so este clipe: refazer a linha do tempo trocaria os elementos
    // debaixo do ponteiro e mataria um arrasto em curso.
    const el = document.querySelector('.clip[data-clip="' + c.id + '"]');
    if (el) drawStrip(el, c);
  });
}

// ------------------------------------------------------ o som do clipe
//
// O desenho sai dos picos que o C++ resume uma vez por arquivo. Enquanto os
// da resolucao certa nao chegam, os que ja temos sao esticados: melhor um
// desenho aproximado do que um buraco a cada zoom.
//
// Guardados por clipe, e nao por arquivo: depois de um corte, os dois pedacos
// sao do mesmo arquivo mas pedem trechos diferentes, e um cache por arquivo
// faria um desfazer o pedido do outro, sem parar nunca.

export function wantsWave(c?) {
  const m = state.media.find((x) => x.id === c.media);
  return !!(m && m.hasAudio);
}

export function drawWave(clipEl?, c?) {
  const pecas = wantsWave(c) ? clipPieces(c) : [];
  const telas = syncPieceNodes(clipEl, "wave", "canvas", pecas.length);
  if (!pecas.length) return;

  // Como a tira, a onda cobre so o que esta na tela. Um clipe de treze minutos
  // tem vinte mil pixels de largura: um canvas assim sao uns oito MB de
  // memoria por clipe, acima do que o navegador aceita desenhar - e era isto,
  // somado ao vazamento do observador, que estourava a memoria da pagina.
  const win = visibleWindow(c);
  const span = Math.max(1e-6, c.len);

  // Com a tira de quadros ocupando o clipe, o som fica numa faixa embaixo;
  // num clipe so de audio ele fica com tudo.
  const height = clipEl.querySelector(".strip") ? WAVE_BAND : TILE_H;
  const dpr = window.devicePixelRatio || 1;

  pecas.forEach((pc, i) => {
    const canvas = telas[i];
    if (!win) { canvas.style.display = "none"; return; }

    const de = Math.max(pc.a, win.from);
    const ate = Math.min(pc.b, win.to);
    if (ate - de < 1e-3) { canvas.style.display = "none"; return; }
    canvas.style.display = "";

    // A faixa ocupa, dentro do clipe, exatamente o pedaco que ela desenha.
    canvas.style.left = (de / span * 100) + "%";
    canvas.style.width = ((ate - de) / span * 100) + "%";
    canvas.style.height = height + "px";

    // O canvas desenha em pixels do dispositivo; sem isto fica borrado nas
    // telas com escala. O teto e uma rede de seguranca: nenhuma janela visivel
    // chega perto dele, e nenhum canvas passa dele.
    canvas.width = clamp(Math.round((ate - de) * state.zoom * dpr), 1, 8192);
    canvas.height = Math.max(1, Math.round(height * dpr));

    // A janela desenhada fica gravada no proprio elemento, em tempo do CLIPE:
    // quem mexe nos pontos precisa dela para saber que instante esta debaixo
    // do ponteiro - e os pontos sempre foram contados do comeco do clipe.
    canvas.dataset.a = de;
    canvas.dataset.b = ate;

    // E a mesma janela em tempo de arquivo, que e o que o C++ entende.
    const v = clipSpeed(c);
    const f0 = pc.in + (de - pc.a) * v;
    const f1 = pc.in + (ate - pc.a) * v;

    const wave = state.waves.get(pieceKey(c, i));
    if (wave) paintWave(canvas, wave, c, f0, f1, de, ate);
    requestWave(c, pc, canvas.width, f0, f1);
    wireVolume(canvas, c);
  });
}

// ------------------------------------------------ mexer na linha de volume
//
// Botao direito sobre a linha cria um ponto; sobre um ponto, apaga. Arrastar
// um ponto muda o instante e o nivel. Enquanto se arrasta, so o desenho deste
// clipe e refeito - redesenhar a linha do tempo inteira trocaria o canvas
// debaixo do ponteiro e o arrasto morreria no primeiro pixel.

export const POINT_GRAB = 7;   // raio de pegada, em pixels da pagina

export function wireVolume(canvas?, c?) {
  // A janela que este canvas desenha, em tempo do clipe. Sem ela o ponteiro
  // seria medido contra o clipe inteiro, e o ponto sairia longe do dedo.
  const janela = () => {
    // Ja gravada em tempo do clipe por quem desenhou.
    const a = Number(canvas.dataset.a);
    const b = Number(canvas.dataset.b);
    return isFinite(a) && isFinite(b) && b > a ? { a, b } : { a: 0, b: c.len };
  };

  const local = (ev) => {
    const r = canvas.getBoundingClientRect();
    const j = janela();
    const f = (ev.clientX - r.left) / Math.max(1, r.width);
    return {
      t: clamp(j.a + f * (j.b - j.a), 0, c.len),
      y: ev.clientY - r.top,
      h: r.height,
    };
  };

  // Que ponto esta debaixo do ponteiro, se houver.
  const pointAt = (ev) => {
    const r = canvas.getBoundingClientRect();
    const j = janela();
    const pts = c.points || [];
    for (let i = 0; i < pts.length; ++i) {
      const px = r.width * ((pts[i].t - j.a) / Math.max(1e-6, j.b - j.a));
      const py = volumeY(c, pts[i].t, r.height, 2);
      if (Math.abs(ev.clientX - r.left - px) <= POINT_GRAB &&
          Math.abs(ev.clientY - r.top - py) <= POINT_GRAB + 4) {
        return i;
      }
    }
    return -1;
  };

  // O botao direito abre o menu; quem decide o que fazer e quem escolhe. Um
  // clique que ja apagasse ou criasse seria rapido demais para desfazer.
  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const at = pointAt(ev);
    const p = local(ev);
    const pts = c.points || [];
    const items = [];

    if (at >= 0) {
      state.pickedPoint = pts[at].id;
      refresh(["timeline", "audio"]);
      items.push({ label: "Excluir ponto", action: () => deletePoint(pts[at].id) });
      items.push({ label: "Deixar em 0 dB",
                   action: () => setPointDb(c, pts[at].id, 0) });
      items.push({ label: "Silenciar aqui",
                   action: () => setPointDb(c, pts[at].id, VOL_MIN) });
    } else {
      items.push({ label: "Inserir ponto aqui",
                   action: () => addPoint(c, p.t) });
    }

    items.push({ sep: true });
    items.push({ label: "Apagar todos os pontos", disabled: !pts.length,
                 action: () => { remember(); c.points = []; state.pickedPoint = 0;
                                 refresh(["timeline", "audio"]); sendVolume(c); } });

    showMenu(ev.clientX, ev.clientY, items);
  });

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    // Com a tesoura na mao a faixa de som e clipe como qualquer outro pedaco
    // dele: o corte passa por cima dos pontos, que aqui nao se pegam.
    if (state.tool === "razor") return;
    closeMenu();

    const at = pointAt(ev);
    if (at < 0) {
      // Fora de um ponto o clipe e quem se arrasta - e a selecao do ponto se
      // desfaz, como em qualquer lista.
      if (state.pickedPoint) {
        state.pickedPoint = 0;
        const wave = state.waves.get(c.id);
        if (wave) paintWave(canvas, wave, c, Number(canvas.dataset.t0), Number(canvas.dataset.t1));
      }
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    capture(canvas, ev.pointerId);

    // Um arrasto de ponto e um passo so, guardado antes do primeiro pixel.
    remember();
    state.pickedPoint = c.points[at].id;
    state.pickedClip = c.id;
    const wave = state.waves.get(c.id);
    if (wave) paintWave(canvas, wave, c, Number(canvas.dataset.t0), Number(canvas.dataset.t1));

    const move = (e2) => {
      const p = local(e2);
      // A altura do ponteiro e a altura da linha, sem intermediarios.
      const pos = clamp(1 - (p.y - 1) / Math.max(1, p.h - 4), 0, 1);
      c.points[at].t = p.t;
      c.points[at].db = lineToDb(pos);
      c.points.sort((a, b) => a.t - b.t);
      if (wave) paintWave(canvas, wave, c,
                          Number(canvas.dataset.t0), Number(canvas.dataset.t1));
      sendVolume(c);
    };
    const up = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      refresh(["timeline", "audio"]);
      sendVolume(c);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });
}

// --------------------------------------- os pontos de animacao da imagem
//
// A mesma ideia dos pontos de volume, um andar acima: uma faixa fina no alto
// do clipe, com um losango por ponto. Botao direito insere e apaga, arrastar
// muda o instante, e o que cada ponto GUARDA - tamanho, posicao e giro - se
// mexe na tela ou no painel de imagem, que e onde se ve o que se esta fazendo.
//
// A faixa so aparece quando ha pontos ou quando o clipe esta escolhido: acesa
// sempre, ela roubaria a beirada de cima de todo clipe do projeto.

export function drawAnimLane(clipEl?, c?) {
  if (!isFrameClip(c)) return;
  // O menu vale no clipe inteiro, tenha ele pontos ou nao: e por ele que a
  // animacao comeca, e nao havia como pedir o primeiro ponto de um clipe que
  // ainda nao tem faixa.
  wireAnimMenu(clipEl, c);
  pintaAnimLane(clipEl, c);
}

// A faixa em si. Sai daqui, e nao de `drawAnimLane`, porque o arrasto de uma
// ponta a refaz a cada pixel - e refazer o menu junto penduraria um ouvinte
// novo no clipe a cada vez.
export function pintaAnimLane(clipEl?, c?) {
  const velha = clipEl.querySelector(".kf-lane");
  if (velha) velha.remove();

  const pts = animPts(c) || [];
  if (!pts.length && !isPicked(c.id)) return;

  const lane = document.createElement("div");
  lane.className = "kf-lane";
  const len = Math.max(1e-6, c.len);

  pts.forEach((p) => {
    // Ponto que caiu fora do clipe - o que acontece quando se encurta a ponta
    // depois de animar - continua contando para a linha, mas nao tem onde ser
    // desenhado. Some do desenho e nao da lista: devolvida a ponta, ele volta.
    if (p.t < -1e-4 || p.t > c.len + 1e-4) return;
    const i = document.createElement("i");
    i.className = "kf" + (p.id === state.pickedAnim ? " on" : "") +
                  (p.s ? " suave" : "");
    i.style.left = (p.t / len * 100) + "%";
    i.dataset.pt = p.id;
    i.title = "Ponto em " + fmtTime(p.t, true) + (p.s ? " - suave" : "");
    lane.appendChild(i);
  });

  wireAnimDrag(lane, c);
  clipEl.appendChild(lane);
}

// O instante do clipe debaixo do ponteiro. Sai do CLIPE, e nao da faixa: as
// duas tem a mesma largura, e assim o menu funciona igual seja onde for que o
// botao direito caia.
export function animLaneTime(el?, ev?, c?) {
  const clipEl = el.closest(".clip") || el;
  const r = clipEl.getBoundingClientRect();
  const f = (ev.clientX - r.left) / Math.max(1, r.width);
  return clamp(f * c.len, 0, c.len);
}

// O menu do botao direito, pendurado no CLIPE inteiro e nao so na faixa fina
// la em cima: mirar onze pixels para inserir um ponto e pedir demais da mao.
// Na faixa de som o menu do volume chega primeiro e para ali - sao duas linhas
// diferentes, e cada uma responde onde ela e desenhada.
export function wireAnimMenu(clipEl?, c?) {
  clipEl.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const alvo = ev.target.closest(".kf");
    const p = alvo ? (c.anim || []).find((x) => x.id === Number(alvo.dataset.pt))
                   : null;
    const t = animLaneTime(clipEl, ev, c);
    const items = [];

    if (p) {
      state.pickedAnim = p.id;
      items.push({ label: "Ir para este ponto",
                   action: () => seekCommit(c.start + p.t) });
      items.push({ label: p.s ? "Deixar reto" : "Suavizar entrada e saida",
                   action: () => { remember(); p.s = p.s ? 0 : 1;
                                   spreadTF(c); afterAnim(); } });
      items.push({ label: "Excluir ponto", action: () => deleteAnimPoint(p.id) });
    } else {
      items.push({ label: "Inserir ponto aqui",
                   action: () => addAnimPoint(c, t) });
      // O ponto que interessa quase sempre e o do cursor: e ali que se esta
      // vendo a imagem, e e o enquadramento daquele instante que se quer
      // guardar.
      const na = state.pos >= c.start && state.pos <= c.start + c.len;
      items.push({ label: "Inserir ponto no cursor", disabled: !na,
                   action: () => addAnimPoint(c, animTime(c)) });
    }

    items.push({ sep: true });
    items.push({ label: "Apagar a animacao", disabled: !hasAnim(c),
                 action: () => { remember(); pousaAnim(c); state.pickedAnim = 0;
                                 spreadTF(c); afterAnim(); } });

    showMenu(ev.clientX, ev.clientY, items);
  });
}

// Pegar e arrastar um losango. Vive na faixa, que e onde eles moram.
export function wireAnimDrag(lane?, c?) {
  lane.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const alvo = ev.target.closest(".kf");
    // Fora de um ponto a faixa nao e de ninguem: o gesto segue para o clipe,
    // que e quem se arrasta. Sem isto, pegar um clipe pela beirada de cima
    // deixaria de funcionar assim que ele fosse escolhido.
    if (!alvo) { if (state.pickedAnim) state.pickedAnim = 0; return; }
    if (state.tool === "razor") return;

    const p = (c.anim || []).find((x) => x.id === Number(alvo.dataset.pt));
    if (!p) return;

    ev.preventDefault();
    ev.stopPropagation();
    closeMenu();
    capture(lane, ev.pointerId);

    // Um arrasto e um passo so de desfazer, guardado antes do primeiro pixel.
    remember();
    state.pickedAnim = p.id;
    state.pickedClip = c.id;
    lane.querySelectorAll(".kf.on").forEach((k) => k.classList.remove("on"));
    alvo.classList.add("on");

    // O instante, escrito ao lado do losango enquanto a mao anda. Sem ele o
    // ajuste e no olho: a faixa nao tem regua, e "um pouco antes da fala" e
    // uma medida que o desenho sozinho nao da.
    const tip = document.createElement("b");
    tip.className = "kf-tip";
    lane.appendChild(tip);

    const poe = () => {
      const pct = (p.t / Math.max(1e-6, c.len) * 100) + "%";
      alvo.style.left = pct;
      tip.style.left = pct;
      tip.textContent = fmtTime(p.t, true);
    };
    poe();

    const move = (e2) => {
      p.t = animLaneTime(lane, e2, c);
      c.anim.sort((a, b) => a.t - b.t);
      poe();
      spreadTF(c);
      // A tela acompanha: mover um ponto muda o enquadramento do instante em
      // que a agulha esta, e e isso que se esta tentando ver.
      animaCamadas();
    };
    const up = () => {
      lane.removeEventListener("pointermove", move);
      lane.removeEventListener("pointerup", up);
      tip.remove();
      afterAnim();
    };
    lane.addEventListener("pointermove", move);
    lane.addEventListener("pointerup", up);
  });
}

// Insere um ponto guardando o enquadramento que a linha ja tinha naquele
// instante: inserir nao muda nada do que se ve - so cria onde pegar.
export function addAnimPoint(c?, t?) {
  remember();
  const p = animKey(c, t);
  state.pickedAnim = p.id;
  spreadTF(c);
  afterAnim();
}

// ------------------------------------------------- mexer nos pontos

export function addPoint(c?, t?) {
  remember();
  c.points = (c.points || []).concat([
    { id: state.nextId++, t, db: envDbAt(c, t) },
  ]);
  c.points.sort((a, b) => a.t - b.t);
  state.pickedPoint = c.points.find((p) => p.t === t).id;
  refresh(["timeline", "audio"]);
  sendVolume(c);
}

// Apaga por id: a lista se reordena a cada arrasto, e um indice guardado
// apontaria para o vizinho.
export function deletePoint(id?) {
  const c = state.clips.find((x) => (x.points || []).some((p) => p.id === id));
  if (!c) return;
  remember();
  c.points = c.points.filter((p) => p.id !== id);
  if (state.pickedPoint === id) state.pickedPoint = 0;
  refresh(["timeline", "audio"]);
  sendVolume(c);
}

export function setPointDb(c?, id?, db?) {
  const p = (c.points || []).find((x) => x.id === id);
  if (!p) return;
  remember();
  p.db = clamp(db, VOL_MIN, VOL_MAX);
  refresh(["timeline", "audio"]);
  sendVolume(c);
}

// As cores vem daqui, e nao do CSS: no momento do desenho o clipe ainda nao
// entrou no documento, e getComputedStyle de um elemento solto devolve o
// padrao - preto sobre fundo escuro, ou seja, nada.
//
// Cada barra e um tubo, com tres tons de baixo para cima: a base fica na
// sombra, o corpo abre e o topo acende. Sao os tres tons que fazem a barra
// ter volume - em cor chapada a fileira volta a parecer um borrao recortado.
export const WAVE_COLORS = {
  video:  { low: "#17475e", mid: "#2f8fb4", top: "#7fe6ff" },
  audio:  { low: "#15503b", mid: "#2b9a72", top: "#7fe0b8" },
  imagem: { low: "#5a431a", mid: "#a8823c", top: "#eed49a" },
  voz:    { low: "#4a2a5e", mid: "#8b57b0", top: "#d9a9f0" },
};

// A barra e a divisa entre uma e a proxima, em pixels de tela. A divisa e o
// que separa: sem ela as barras se encostam e viram de novo uma mancha so.
export const BAR_W = 3;
export const BAR_GAP = 2;

// As barras crescem do pe da faixa, e nao espelhadas no meio: assim sobra o
// alto da faixa para a linha do volume, que e uma altura - e altura, num
// desenho espelhado, nao teria onde ficar.

// Altura de desenho a partir da amplitude. A raiz abre a parte de baixo da
// escala: em amplitude pura, -36 dB e 1,6% da faixa, e tanto as barras quanto
// a linha do volume ficariam grudadas no chao, sem dizer nada. A mesma curva
// serve aos dois - e por isso a barra mais alta continua batendo na linha.
export function waveShape(v?) { return Math.sqrt(clamp(v, 0, 1)); }

// Teto do quanto o desenho levanta o sinal antes de virar altura. E teto, e
// nao valor fixo: musica masterizada ja chega perto de 0 dB, e 16 dB em cima
// dela viram um retangulo cheio, sem forma nenhuma. O levante vai ate onde o
// pico do arquivo alcanca o topo da faixa, e para ai.
export const WAVE_BOOST_DB = 16;
// `t0` e `t1` sao a janela desenhada, em tempo da midia - um pedaco do clipe,
// e nao ele todo.
// `t0` e `t1` sao a janela em tempo de ARQUIVO - e por eles que se acham os
// picos. `a` e `b` sao a MESMA janela em tempo do clipe, que e onde moram os
// pontos da linha de volume. Num clipe fundido os dois pares nao se convertem
// um no outro por uma soma, e e por isso que ambos chegam aqui.
export function paintWave(canvas?, wave?, c?, t0?, t1?, ca?, cb?) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // O ganho do desenho existe porque gravacao de microfone mora vinte e
  // tantos dB abaixo de zero e o desenho precisa de altura; o teto de 16 dB
  // impede que material alto sature e vire um bloco macico.
  const room = wave.peak > 0.001 ? 1 / wave.peak : 1;
  const boost = Math.min(dbToGain(WAVE_BOOST_DB), room);

  // Tudo em pixels do dispositivo e em numeros inteiros: uma barra que caia em
  // meio pixel sai com a borda cinzenta, e ai a divisa some.
  const dpr = window.devicePixelRatio || 1;
  const gap = Math.max(1, Math.round(BAR_GAP * dpr));
  const pitch = Math.max(gap + 2, Math.round((BAR_W + BAR_GAP) * dpr));

  // Quantas barras cabem - e dai um passo fracionario, para a ultima encostar
  // na borda do clipe. Com passo inteiro sobraria uma faixa vazia a direita,
  // sempre de largura diferente conforme o zoom.
  const bars = Math.max(1, Math.round(w / pitch));
  const step = w / bars;

  // Mesmo no silencio fica um toco: e o chao em que os tubos se plantam. Sem
  // ele a fileira se interrompe e o trecho mudo parece um buraco no desenho,
  // e nao um trecho mudo.
  const floor = Math.max(2, Math.round(2 * dpr));
  // A voz isolada tem cor propria: olhando de longe para a linha do tempo, e
  // a cor que diz se o que esta ali e a fala limpa ou a mistura inteira.
  const col = waveSource(c) ? WAVE_COLORS.voz
                            : (WAVE_COLORS[c.kind] || WAVE_COLORS.video);

  // Os picos ja vieram um por pixel; cada barra leva o MAIOR do trecho que
  // cobre. A media achataria justamente os estalos que se quer enxergar.
  const ampAt = (px) => {
    const t = t0 + (t1 - t0) * (px / w);
    const f = (t - wave.t0) / (wave.t1 - wave.t0);
    if (f < 0 || f >= 1) return 0;
    const i = Math.min(wave.lo.length - 1, Math.floor(f * wave.lo.length));
    return Math.max(wave.hi[i] || 0, -(wave.lo[i] || 0));
  };

  for (let b = 0; b < bars; ++b) {
    const x = Math.round(b * step);
    const bw = Math.max(2, Math.round((b + 1) * step) - gap - x);

    let amp = 0;
    for (let px = x; px < x + bw + gap && px < w; ++px) amp = Math.max(amp, ampAt(px));

    // As barras seguem a linha de volume: a altura dela multiplica a altura
    // delas, e por isso a barra mais alta encosta na linha, esteja ela onde
    // estiver. O ganho vai do meio da barra - um valor por barra, e nao por
    // pixel, senao a barra sairia torta no meio de um fade.
    const tc = t0 + (t1 - t0) * ((x + bw / 2) / w);
    // O instante em tempo do CLIPE, que e onde moram os pontos da linha: a
    // janela chega nos dois tempos, e a conversao e por regra de tres dentro
    // deste pedaco - num clipe fundido nao ha soma que leve de um ao outro.
    const tcClipe = ca + (cb - ca) * ((x + bw / 2) / w);
    const amount = waveShape(amp * boost * envGainAt(c, tcClipe));
    const bh = Math.max(floor, Math.round(amount * h));
    const y = h - bh;

    // O degrade vai do pe da barra ate o topo dela, e nao ate o alto da
    // faixa: assim toda barra tem os tres tons, a alta e a baixa, e e o tom
    // que diz onde e o pe e onde e a ponta.
    const g = ctx.createLinearGradient(0, h, 0, y);
    g.addColorStop(0, col.low);
    g.addColorStop(0.5, col.mid);
    g.addColorStop(1, col.top);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, bw, bh);
  }

  paintVolumeLine(ctx, c, w, h, ca, cb);
}

// Onde a linha de volume passa, em pixels, no instante `t` do clipe.
export function volumeY(c?, t?, h?, thick?) {
  const pos = envLineAt(c, t);
  return clamp(Math.round((h - thick - 2) * (1 - pos)) + 1, 1, h - thick - 1);
}

// A linha do volume: o teto ate onde as barras sobem. Sem pontos e uma reta;
// com pontos, a poligonal que faz os fades.
// `a` e `b` sao a janela desenhada, em tempo do CLIPE: a linha atravessa so o
// pedaco que o canvas cobre, e os pontos que caem fora dele nao se desenham.
export function paintVolumeLine(ctx?, c?, w?, h?, a?, b?) {
  const dpr = window.devicePixelRatio || 1;
  const thick = Math.max(2, Math.round(2 * dpr));
  const span = Math.max(1e-6, b - a);

  // Fio escuro por baixo: sobre as barras claras, a linha sozinha se
  // dissolveria.
  for (let x = 0; x < w; ++x) {
    const y = volumeY(c, a + span * (x / w), h, thick);
    ctx.fillStyle = "#00000099";
    ctx.fillRect(x, y + thick, 1, 1);
    // Branca, e nao amarela: o amarelo e a cor da borda do clipe selecionado.
    ctx.fillStyle = "#ffffffdd";
    ctx.fillRect(x, y, 1, thick);
  }

  (c.points || []).forEach((p) => {
    if (p.t < a - 1e-6 || p.t > b + 1e-6) return;   // fora da janela desenhada
    const x = clamp(Math.round(w * ((p.t - a) / span)), 0, w - 1);
    const y = volumeY(c, p.t, h, thick) + thick / 2;
    const on = state.pickedPoint === p.id;
    const rad = Math.max(3, Math.round((on ? 5 : 3.5) * dpr));
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = on ? "#f0b429" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.strokeStyle = on ? "#1a1204" : "#00000099";
    ctx.stroke();
  });
}

// `cols` ja vem em pixels do dispositivo: e uma coluna de picos por coluna
// de pixel, que e o que deixa o desenho nitido.
// Qual fonte este clipe desenha: 1 e a voz isolada, 0 e a mistura. Um arquivo
// sem voz separada nao tem o que trocar, entao o botao nao vale para ele.
export function waveSource(c?) {
  const m = state.media.find((x) => x.id === c.media);
  return state.voice && m && m.hasVoice ? 1 : 0;
}

export function requestWave(c?, pc?, cols?, t0?, t1?) {
  const chave = pieceKey(c, pc.i);
  if (state.wavePending.has(chave)) return;

  const src = waveSource(c);
  const want = Math.max(8, Math.min(4000, Math.round(cols)));
  const have = state.waves.get(chave);
  // A fonte entra na comparacao: trocar mistura por voz tem de pedir de novo,
  // senao o botao mudaria o rotulo e nao o desenho.
  if (have && have.src === src &&
      Math.abs(have.t0 - t0) < 1e-3 && Math.abs(have.t1 - t1) < 1e-3 &&
      have.lo.length >= want * 0.8 && have.lo.length <= want * 2.5) {
    return;
  }

  state.wavePending.add(chave);
  api.waveform(c.media, t0, t1, want, src).then((r) => {
    state.wavePending.delete(chave);
    if (!r || !r.ok) return;
    state.waves.set(chave, { t0: r.t0, t1: r.t1, lo: r.lo, hi: r.hi,
                            peak: r.peak || 1, src });
    refresh(["timeline"]);
  });
}

// -------------------------------------------------- pistas, clipes, tempo

// `onde` e a posicao na pilha, quando quem chama sabe: e o caso de quem
// largou entre duas pistas, ou em cima de uma ocupada. Sem ela, video e audio
// entram no fim e o texto no alto, que e onde cada um costuma ficar.
export function addTrack(kind?, onde?) {
  // O numero vem do MAIOR ja usado, e nao da contagem. Contando, apagar a
  // "Video 1" fazia a proxima nascer "Video 2" de novo, e a linha do tempo
  // ficava com duas pistas de mesmo nome - justo o nome pelo qual a pessoa
  // diz qual esta na frente.
  const usados = state.tracks.filter((t) => t.kind === kind)
      .map((t) => parseInt(String(t.name).replace(/\D+/g, ""), 10) || 0);
  const n = (usados.length ? Math.max.apply(null, usados) : 0) + 1;
  const nomes = { audio: "Audio ", texto: "Texto ", video: "Video " };
  const tr = { id: state.nextId++, kind, name: (nomes[kind] || "Video ") + n };
  if (typeof onde === "number") state.tracks.splice(clamp(onde, 0, state.tracks.length), 0, tr);
  // Sem degrau pedido, a pista de texto nasce no alto - e onde quase todo
  // texto vai, e e um PADRAO, nao uma regra: com `onde` ela nasce onde a mao
  // pediu, inclusive debaixo do video, que e o que poe a letra atras de alguem.
  else if (kind === "texto") state.tracks.unshift(tr);
  else state.tracks.push(tr);
  refresh(["timeline", "props"]);
  return tr;
}

// A duracao vem do arquivo, medida na importacao. Imagem parada nao tem
// duracao propria, entao entra com um valor de trabalho; um video que o
// FFmpeg nao soube medir (alguns fluxos sem cabecalho) cai no mesmo caso.
export function clipLen(m?) {
  if (m.kind === "imagem") return 5;
  return m.duration > 0 ? m.duration : 10;
}

export function addToTimeline(m?, trackId?, at?, nova?, onde?) {
  remember();
  const want = m.kind === "audio" ? "audio" : "video";
  const dura = clipLen(m);

  let track = trackId != null ? state.tracks.find((t) => t.id === trackId) : null;

  // Largado na beirada de uma pista, ou na faixa do fim: o pedido e por uma
  // pista nova naquele lugar da pilha - mesmo ja havendo uma do tipo. E assim
  // que se monta uma sobreposicao, sem botao nenhum.
  if (!track && nova) track = addTrack(want, onde);
  if (!track) track = state.tracks.find((t) => t.kind === want) || addTrack(want);
  if (track.kind !== want) {
    toast("Um item de " + m.kind + " nao entra numa pista de " + track.kind + ".");
    return;
  }

  let start = at;
  if (start == null) {
    // Sem destino escolhido, o clipe entra depois do ultimo da pista.
    start = state.clips.filter((c) => c.track === track.id)
                       .reduce((a, c) => Math.max(a, c.start + c.len), 0);
  }
  start = Math.max(0, start);

  // O lugar ja esta ocupado: dois clipes na mesma faixa e no mesmo instante
  // seriam um escondendo o outro, e quem larga um video em cima de outro esta
  // pedindo justamente o contrario - os dois ao mesmo tempo. Entao ele sobe
  // para uma pista livre, e nao havendo nenhuma, nasce uma logo acima desta.
  if (trackBusy(track.id, start, dura)) {
    const i = state.tracks.findIndex((t) => t.id === track.id);
    const livre = state.tracks.find((t) => t.kind === want && t.id !== track.id &&
                                           !trackBusy(t.id, start, dura));
    track = livre || addTrack(want, i);
    toast(m.name + " foi para " + track.name + ": o lugar onde voce soltou ja " +
          "estava ocupado.");
  }
  const clip = { id: state.nextId++, track: track.id, start: start,
                 len: dura, name: m.name, kind: m.kind, media: m.id,
                 inPoint: 0, db: 0 };
  state.clips.push(clip);
  select({ clip: clip.id, media: -1 }, ["media"]);
}

export function deleteClip() {
  const alvos = pickedClips();
  if (!alvos.length) { toast("Nenhum clipe selecionado."); return; }

  remember();
  const ids = new Set(alvos.map((c) => c.id));
  state.clips = state.clips.filter((c) => !ids.has(c.id));

  // Um descartado que sobrou pode ter perdido o vizinho que marcava o lugar de
  // volta; quem cuida disso e o proprio realinhamento.
  layoutTossed();
  // Apagado o ultimo clipe de uma pista, ela some junto: a poda vem antes do
  // redesenho, que e quem a mostraria vazia.
  pruneTracks();
  select({ clip: -1 });
  seekCommit();
  if (alvos.length > 1) toast(alvos.length + " clipes apagados.");
}

// ------------------------------------------------------------ dividir
//
// Cortar um clipe e ficar com dois que, colados, dao exatamente o de antes: o
// da direita continua de onde o da esquerda parou, e por isso o ponto de
// entrada dele anda junto. Nada e decodificado de novo - o arquivo nunca foi
// tocado, e o clipe sempre foi so uma janela sobre ele.

// Um corte rente a borda nao cria um clipe, cria um cisco: sem largura para
// mostrar nada e sem como ser pego de volta. Abaixo disto o corte nao sai.
export const MIN_CLIP = 0.05;

// A linha de volume tambem se parte. Os pontos de cada lado vao inteiros, e
// na emenda entra um ponto novo com o valor que a linha tinha ali: sem ele a
// linha, que segue reta ate a borda com o valor do ponto vizinho, mudaria de
// forma justo no lugar do corte.
export function splitPoints(c?, at?) {
  const pts = c.points || [];
  if (!pts.length) return [[], []];

  const seam = envDbAt(c, at);
  const left = pts.filter((p) => p.t < at - 1e-4)
                  .map((p) => ({ id: state.nextId++, t: p.t, db: p.db }));
  const right = pts.filter((p) => p.t > at + 1e-4)
                   .map((p) => ({ id: state.nextId++, t: p.t - at, db: p.db }));
  left.push({ id: state.nextId++, t: at, db: seam });
  right.unshift({ id: state.nextId++, t: 0, db: seam });
  return [left, right];
}

// A linha de animacao se parte pela mesma regra, e pelo mesmo motivo: na
// emenda entra um ponto com o enquadramento que a linha tinha ali, ou o
// movimento mudaria de forma justo onde se cortou. Sem animacao, os dois lados
// saem sem lista nenhuma - e cada metade fica com o `tf` que ja tinham.
export function splitAnim(c?, at?) {
  const pts = animPts(c);
  if (!pts) return [null, null];

  const v = tfAt(c, at);
  const copia = (p, dt) => ({ id: state.nextId++, t: p.t - dt, esc: p.esc,
                              x: p.x, y: p.y, rot: p.rot, s: p.s || 0 });
  // A curva da emenda e a do trecho que ela corta: cortar no meio de um
  // movimento suave nao pode endurecer nenhuma das duas metades.
  const antes = pts.filter((p) => p.t <= at).pop();
  const costura = (t) => ({ id: state.nextId++, t: t, esc: v.esc, x: v.x,
                            y: v.y, rot: v.rot, s: antes ? (antes.s || 0) : 0 });

  const left = pts.filter((p) => p.t < at - 1e-4).map((p) => copia(p, 0));
  const right = pts.filter((p) => p.t > at + 1e-4).map((p) => copia(p, at));
  left.push(costura(at));
  right.unshift(costura(0));
  return [left, right];
}

// Corta `c` no instante `at` da linha do tempo e devolve a metade da direita,
// ou null quando o corte cairia fora dele.
// Os pedacos de um clipe, partidos no instante `cut` (tempo do clipe). O que
// cai em cima de um pedaco parte esse pedaco em dois.
export function splitPieces(c?, cut?) {
  const v = clipSpeed(c);
  const esq = [], dir = [];
  let resto = cut;                    // no tempo do clipe
  clipPieces(c).forEach((p) => {
    if (resto >= p.dur - 1e-9) {
      esq.push({ in: p.in, len: p.len });
      resto -= p.dur;
    } else if (resto > 1e-9) {
      const fatia = resto * v;        // em segundos de arquivo
      esq.push({ in: p.in, len: fatia });
      dir.push({ in: p.in + fatia, len: p.len - fatia });
      resto = 0;
    } else {
      dir.push({ in: p.in, len: p.len });
    }
  });
  return [esq, dir];
}

export function splitClipAt(c?, at?) {
  const cut = at - c.start;
  if (!(cut > MIN_CLIP) || !(cut < c.len - MIN_CLIP)) return null;

  const [lp, rp] = splitPoints(c, cut);
  const [la, ra] = splitAnim(c, cut);
  const [pEsq, pDir] = splitPieces(c, cut);
  const right: any = {
    id: state.nextId++, track: c.track, start: c.start + cut,
    len: c.len - cut, name: c.name, kind: c.kind, media: c.media,
    // A metade da direita comeca onde a esquerda parou, dentro do arquivo -
    // e, num clipe fundido, leva os pedacos que sobraram dali em diante.
    inPoint: clipSourceAt(c, cut), db: c.db, points: rp,
    // A velocidade e do material, e o material e o mesmo dos dois lados: sem
    // isto a metade da direita voltava a correr na velocidade de origem, e o
    // corte mudava o que se ouve.
    vel: clipSpeed(c),
    // Cortar um clipe descartado da dois descartados: o corte separa, quem
    // decide o que presta e a setinha. A metade da direita passa a vir depois
    // da esquerda - as duas voltam na ordem em que foram cortadas.
    off: !!c.off, home: c.home || 0, back: c.off ? c.id : 0,
    // Cortar dentro de um bloco nao o desmancha: as duas metades continuam
    // dele, e o bloco so ganhou uma costura a mais por dentro.
    grupo: c.grupo || 0,
  };
  // O texto e o enquadramento vao copiados, e nao compartilhados: sao dois
  // clipes daqui em diante, e mexer no de um nao pode mexer no do outro.
  if (isText(c)) right.texto = Object.assign({}, c.texto);
  if (c.tf) right.tf = Object.assign({}, c.tf);
  if (ra) right.anim = ra;

  setPieces(right, pDir);
  setPieces(c, pEsq);
  c.points = lp;
  if (la) c.anim = la;
  state.clips.push(right);

  // As duas metades herdam o desenho da peca inteira. Nao e o desenho certo -
  // cobre mais tempo do que cada uma mostra - mas e recortavel, e recortado
  // esta certo. Sem isto o corte deixaria os dois pedacos em branco pelos
  // segundos que a decodificacao leva, que e o que fazia o corte parecer lento
  // mesmo quando nao era.
  // As duas metades herdam o desenho dos pedacos correspondentes. Nao e o
  // desenho certo - cobre mais tempo do que cada uma mostra - mas e
  // recortavel, e recortado esta certo.
  clipPieces(right).forEach((p, i) => {
    // O pedaco `i` da direita era o pedaco `k` do clipe inteiro.
    const k = clipPieces(c).length - 1 + i;
    const strip = state.strips.get(pieceKey(c, k));
    if (strip) state.strips.set(pieceKey(right, i), strip);
    const wave = state.waves.get(pieceKey(c, k));
    if (wave) state.waves.set(pieceKey(right, i), wave);
  });

  // A tira de quadros do lado esquerdo agora cobre mais tempo do que o clipe
  // tem; requestStrip percebe a mudanca de trecho e pede outra. Ate ela
  // chegar, a antiga fica esticada - o mesmo que ja acontece no zoom.
  return right;
}

// Corta uma leva de clipes no mesmo instante. E daqui que saem tanto a
// tesoura quanto o Ctrl+B: o que muda entre os dois e so quem escolhe os
// clipes.
export function splitClips(clips?, at?) {
  remember();
  state.lastCut = at;
  const made = [];
  clips.forEach((c) => {
    const right = splitClipAt(c, at);
    if (right) made.push([c, right]);
  });

  if (!made.length) { toast("Nada para dividir aqui."); return false; }

  // A mistura conhece os trechos por id do clipe: o da esquerda encurtou e o
  // da direita ainda nao existe la. Os volumes vao na hora, e com o som
  // tocando o seekCommit refaz a lista de trechos no mesmo ponto.
  made.forEach(([l, r]) => { sendVolume(l); sendVolume(r); });

  // O ponto que estava selecionado morreu no corte: os dois lados tem pontos
  // novos, com ids novos.
  state.pickedPoint = 0;
  // Fica escolhida a metade da direita - e a que se costuma apagar ou
  // arrastar logo depois do corte, e o cursor ja esta no comeco dela.
  select({ clip: made[made.length - 1][1].id, media: -1 });
  seekCommit();
  return true;
}

// Ctrl+B: corta no cursor. Havendo um clipe escolhido, o corte e nele - e o
// que se espera de uma escolha; sem escolha nenhuma, corta tudo o que o
// cursor atravessa, que e o corte na coluna inteira.
export function splitAtPlayhead() {
  const at = state.pos;
  const sel = state.clips.find((c) => c.id === state.pickedClip);
  const under = (c) => !c.off && at > c.start && at < c.start + c.len;
  return splitClips(sel && under(sel) ? [sel] : state.clips.filter(under), at);
}

// Onde a tesoura corta. Perto do cursor o corte gruda nele: e no cursor que
// se olha para escolher o lugar, e acertar o pixel com o mouse nao daria.
export const RAZOR_SNAP = 6;

export function razorTimeAt(clientX?) {
  const inner = document.querySelector(".tl-inner");
  if (!inner) return 0;
  const at = (clientX - inner.getBoundingClientRect().left) / state.zoom;
  return Math.abs(at - state.pos) * state.zoom <= RAZOR_SNAP ? state.pos : at;
}

// O alvo de um arrasto que vem de fora da linha do tempo - um item da cesta
// de midia, um modelo do painel de texto. Ou uma pista, ou a faixa do fim, que
// cria uma. A regua fica de fora: largar sobre ela seria pedir um clipe no
// lugar onde se mexe o cursor.
// Ha clipe nesta pista, neste trecho? Os descartados contam: eles estao ali,
// desenhados, e largar por cima deles esconderia os dois.
export function trackBusy(trackId?, at?, len?, ignorar?) {
  return state.clips.some((c) => c.track === trackId && c.id !== ignorar &&
      at < c.start + c.len - 1e-3 && c.start < at + len - 1e-3);
}

// A faixa de alguns pixels junto da borda de uma pista. Largar ali nao e
// largar NA pista: e pedir uma pista nova naquele lugar da pilha - o gesto de
// quem quer duas imagens ao mesmo tempo, uma sobre a outra.
export const DROP_EDGE = 9;

export function dropTargetAt(x?, y?) {
  const under = document.elementFromPoint(x, y);
  if (!under || under.closest(".ruler")) return null;

  const lane = under.closest(".lane");
  if (lane) {
    const r = lane.getBoundingClientRect();
    const id = Number(lane.dataset.track);
    const i = state.tracks.findIndex((t) => t.id === id);
    if (y - r.top <= DROP_EDGE)
      return { el: lane, track: null, nova: true, onde: i, borda: "cima" };
    if (r.bottom - y <= DROP_EDGE)
      return { el: lane, track: null, nova: true, onde: i + 1, borda: "baixo" };
    return { el: lane, track: id, nova: false };
  }

  const nova = under.closest(".lane-new");
  if (nova) return { el: nova, track: null, nova: true };

  // Sem pista nenhuma ainda: a area inteira serve de faixa, e o que cair nela
  // cria a primeira.
  const area = under.closest(".tl-inner");
  return area ? { el: area, track: null, nova: false } : null;
}

// O instante onde o arrasto foi solto. A conta e sempre pela area, e nao pelo
// alvo: as faixas comecam todas na mesma borda, mas o alvo pode ser a faixa do
// fim, que nao e uma pista.
export function dropTimeAt(el?, clientX?) {
  const inner = el.closest(".tl-inner") || el;
  return Math.max(0, (clientX - inner.getBoundingClientRect().left) / state.zoom);
}

// O fantasma que segue a mao durante um arrasto vindo de fora, e o destaque da
// faixa sob o ponteiro. Serve tanto a midia quanto aos modelos de texto: o
// gesto e o mesmo, so muda o que se larga no fim.
export function pintaAlvo(d?) {
  d.el.classList.add(d.classe || (d.borda ? "drop-edge-" + d.borda : "drop-lane"));
}

export function apagaAlvo(d?) {
  d.el.classList.remove("drop-lane", "drop-edge-cima", "drop-edge-baixo", "drop-tela");
}

// `alvoExtra` e um alvo que nao fica na linha do tempo - hoje, a tela da
// previa, onde um modelo de texto pode ser largado direto no ponto em que vai
// aparecer. Consultado primeiro: estando o ponteiro sobre a tela, e dela o
// gesto, e nao da faixa que estiver por baixo em outra parte da janela.
export function beginDropDrag(e?, rotulo?, solta?, alvoExtra?) {
  if (e.button !== 0) return;

  // Sem isto o navegador comeca o arrasto nativo da miniatura (<img> e
  // arrastavel por padrao), engole os eventos seguintes e o pointerup nunca
  // chega - o fantasma fica preso na tela e o clipe nao entra na pista.
  e.preventDefault();

  const startX = e.clientX, startY = e.clientY;
  let ghost = null, drop = null, rolando = null;

  // Perto da borda de baixo, a janela rola sozinha. Sem isto, a faixa que cria
  // pista fica fora do alcance justamente nos projetos que mais precisam dela:
  // os que ja tem pistas demais para caber na tela. E um relogio, e nao um
  // empurrao por evento, para tambem rolar com a mao parada na beirada.
  const BANDA = 26;
  const vigia = (ev) => {
    const sc = document.querySelector(".tl-scroll");
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    let passo = 0;
    if (ev.clientY > r.bottom - BANDA && ev.clientY < r.bottom + 60) passo = 14;
    else if (ev.clientY < r.top + BANDA && ev.clientY > r.top - 60) passo = -14;

    clearInterval(rolando);
    rolando = null;
    if (!passo) return;
    rolando = setInterval(() => { sc.scrollTop += passo; }, 40);
  };

  const move = (ev) => {
    if (!ghost) {
      if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
      ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = rotulo;
      document.body.appendChild(ghost);
    }
    ghost.style.left = (ev.clientX + 12) + "px";
    ghost.style.top = (ev.clientY + 14) + "px";
    vigia(ev);

    // A assinatura inclui a borda: passar do meio da pista para a beirada dela
    // e trocar de alvo, mesmo sendo o mesmo elemento.
    const next = (alvoExtra && alvoExtra(ev.clientX, ev.clientY)) ||
                 dropTargetAt(ev.clientX, ev.clientY);
    const assina = (d) => (d ? d.el.className + "|" + (d.borda || "") : "");
    if (assina(next) !== assina(drop)) {
      if (drop) apagaAlvo(drop);
      drop = next;
      if (drop) pintaAlvo(drop);
    }
  };

  const up = (ev) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    clearInterval(rolando);
    if (!ghost) return;          // foi um clique, e nao um arrasto
    ghost.remove();
    if (!drop) return;
    apagaAlvo(drop);
    solta(drop, dropTimeAt(drop.el, ev.clientX));
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// Arrastar da cesta de midia ate uma pista.
export function beginMediaDrag(e?, m?) {
  beginDropDrag(e, m.name,
                (drop, at) => addToTimeline(m, drop.track, at, drop.nova, drop.onde));
}
