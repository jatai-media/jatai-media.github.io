// panel-player.ts - painel do reprodutor e o transporte do cursor

// ================================================== conteudo: reprodutor

import { $, api, stackZ, select, clipSpeed, clipPieces, clipSourceAt, toast, clamp, fmtTime, state } from "./core";
import { refresh } from "./dock-view";
import { envGainAt, sendVolume } from "./panel-audio";
import { ZOOM_NITIDEZ_MAX, hasAnim, tfNow, applyTransform, pintaMoldura, beginImageDrag, wheelZoom, paintTfWarning, animaCamadas } from "./panel-imagem";
import { txKey, setTxKey, paintTextLayer } from "./texto";
import { fundoSolidez, fundoEncolher } from "./panel-efeitos";
import { projectEnd, followPlayhead } from "./panel-timeline";
import { saveCanvas } from "./prefs";

export function renderPlayer(body?) {
  body.classList.add("fill-col");

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.id = "stage";
  const screen = document.createElement("div");
  screen.className = "screen";
  screen.id = "screen";
  // A camada do texto fica por cima do quadro, dentro da mesma caixa: e a
  // caixa que ja tem a proporcao da area de visao, e e dela que saem todas as
  // contas de onde o texto cai e de que tamanho a letra fica.
  // Tres andares na mesma caixa: as camadas de video, o recado de quando nao
  // ha nenhuma, e as caixas de texto. Sao duas caixas por conveniencia - cada
  // uma tem o seu jeito de ser redesenhada -, e NAO dois andares: quem decide
  // o que fica na frente e o numero que cada peca leva, tirado da pilha das
  // pistas. Por isso nenhuma das duas pode ganhar z-index proprio.
  screen.innerHTML = '<div class="vid-layer"></div>' +
                     '<span class="screen-msg"></span>' +
                     '<div class="tx-layer"></div>';
  // Enquadrar e mexer no que se ve: o gesto e na propria imagem.
  screen.addEventListener("pointerdown", (e) => beginImageDrag(e, screen));
  screen.addEventListener("wheel", (e) => wheelZoom(e, screen), { passive: false });

  stage.appendChild(screen);
  body.appendChild(stage);

  const bar = document.createElement("div");
  bar.className = "transport";
  bar.innerHTML =
    '<button class="iconbtn" id="tpStart" title="Inicio">&#171;</button>' +
    '<button class="iconbtn main" id="tpPlay" title="Reproduzir (espaco)">' +
      (state.playing ? "&#10073;&#10073;" : "&#9654;") + '</button>' +
    '<button class="iconbtn" id="tpEnd" title="Fim">&#187;</button>' +
    '<span class="time mono"><b id="tpPos">' + fmtTime(state.pos, true) + '</b>' +
    ' / ' + fmtTime(projectEnd()) + '</span>' +
    '<div class="spacer"></div>' +
    '<div class="meter" title="Saida de audio"><i id="tpMeter"></i></div>';
  body.appendChild(bar);

  // O tamanho da area de visao mora na propria barra de transporte, no vao
  // entre o relogio e o medidor. Uma faixa so para ele comia altura da tela -
  // que e o que o painel tem de mais escasso - para mostrar um numero que
  // quase nunca muda.
  bar.insertBefore(buildCanvasBar(), bar.querySelector(".meter"));

  bar.querySelector("#tpPlay").addEventListener("click", togglePlay);
  bar.querySelector("#tpStart").addEventListener("click", () => seekCommit(0));
  bar.querySelector("#tpEnd").addEventListener("click", () => seekCommit(projectEnd()));

  watchStage(stage);

  // O painel recem-montado ainda esta fora da pagina - o dock monta a arvore
  // inteira e so depois a encaixa - entao a pintura vai pelo proprio corpo do
  // painel, e nao por `getElementById`, que ali dentro nao acha nada. Era este
  // o motivo da tela preta ao trocar de aba: quem procurava desistia calado, e
  // como a chave da previa continuava valendo, tampouco se pedia outro quadro;
  // a imagem so voltava quando alguem mexia no cursor.
  fitScreen(body);
  paintPreview(body);
  paintTextLayer(body);
  requestPreview(body);

  // A medida de verdade so existe depois de o painel entrar na pagina. Quem
  // avisa e o observador, logo acima; este quadro extra e para o caso de ele
  // demorar, e nao custa nada quando o tamanho ja esta certo.
  requestAnimationFrame(() => {
    if (!stage.isConnected) return;
    fitScreen();
    // A moldura mede em pixels do palco: mudou o palco, mudou ela.
    if (typeof pintaMoldura === "function") pintaMoldura();
  });
}

// ------------------------------------------- o tamanho da area de visao
//
// Um projeto e feito para um lugar: a tela deitada do computador, a de pe do
// celular, o quadrado do feed. Quem monta precisa ver desde o primeiro corte o
// quadro em que aquilo vai caber, e nao descobrir no fim que o enquadramento
// nao serve para o vertical.
//
// Por isso a area de visao e do projeto, e nao do arquivo: ela nao muda quando
// se escolhe outro clipe, e e dela que sai a proporcao da tela do reprodutor.
//
// As predefinicoes sao os tamanhos que se pedem todo dia; para o resto ha os
// dois campos, que aceitam qualquer coisa entre 16 e 7680 pixels.

export const CANVAS_MIN = 16;
export const CANVAS_MAX = 7680;

export const CANVAS_PRESETS: any[] = [
  ["Horizontal", [
    ["4K UHD", 3840, 2160],
    ["QHD", 2560, 1440],
    ["Full HD", 1920, 1080],
    ["HD", 1280, 720],
    ["Classico", 1440, 1080],
  ]],
  ["Vertical - celular", [
    ["Full HD vertical", 1080, 1920],
    ["HD vertical", 720, 1280],
    ["Retrato de feed", 1080, 1350],
  ]],
  ["Quadrado", [
    ["Quadrado grande", 1080, 1080],
    ["Quadrado", 720, 720],
  ]],
];

// A proporcao vai escrita ao lado dos numeros porque e ela, e nao a contagem
// de pixels, que diz se o quadro e o mesmo: 1280x720 e 1920x1080 sao a mesma
// tela, e quem troca de um para o outro precisa ver isso de imediato.
export function ratioText(w?, h?) {
  const mdc = (a, b) => (b ? mdc(b, a % b) : a);
  const d = mdc(w, h) || 1;
  const a = w / d, b = h / d;
  // Medidas que nao se reduzem dariam algo como 853:480, que nao diz nada a
  // ninguem; ali o numero decimal informa mais.
  if (a > 32 || b > 32) return (w / h).toFixed(2).replace(".", ",") + ":1";
  return a + ":" + b;
}

export function buildCanvasBar() {
  const bar = document.createElement("div");
  bar.className = "canvasbar";
  bar.title = "Area de visao do projeto";

  const sel = document.createElement("select");
  sel.id = "cvPreset";
  sel.title = "Tamanhos prontos";
  CANVAS_PRESETS.forEach(([grupo, itens]) => {
    const g = document.createElement("optgroup");
    g.label = grupo;
    itens.forEach(([nome, w, h]) => {
      const o = document.createElement("option");
      o.value = w + "x" + h;
      o.textContent = nome + " - " + w + " x " + h;
      g.appendChild(o);
    });
    sel.appendChild(g);
  });
  const livre = document.createElement("option");
  livre.value = "livre";
  livre.textContent = "Personalizado";
  sel.appendChild(livre);

  const campos = document.createElement("div");
  campos.className = "cv-size";
  campos.innerHTML =
    '<input type="number" id="cvW" min="' + CANVAS_MIN + '" max="' + CANVAS_MAX +
      '" step="1" title="Largura">' +
    '<span class="x">&times;</span>' +
    '<input type="number" id="cvH" min="' + CANVAS_MIN + '" max="' + CANVAS_MAX +
      '" step="1" title="Altura">' +
    '<span class="unit">px</span>';

  const proporcao = document.createElement("span");
  proporcao.className = "cv-ratio";
  proporcao.id = "cvRatio";

  const girar = document.createElement("button");
  girar.className = "btn ghost cv-flip";
  girar.id = "cvFlip";
  girar.textContent = "Girar";
  girar.title = "Trocar largura e altura";

  bar.append(sel, campos, proporcao, girar);

  sel.addEventListener("change", () => {
    // "Personalizado" nao e um tamanho: e o convite para digitar um. Escolhe-lo
    // nao muda nada na tela, so leva o cursor para o campo da largura.
    if (sel.value === "livre") { $("cvW").focus(); $("cvW").select(); return; }
    const [w, h] = sel.value.split("x").map(Number);
    setCanvas(w, h);
  });

  // Os campos so valem ao sair ou no Enter. A cada tecla, "1920" passaria por
  // 1, 19 e 192 - e a tela daria tres saltos antes de chegar onde se queria.
  const commit = () => setCanvas($("cvW").value, $("cvH").value);
  campos.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });
  });

  girar.addEventListener("click", () => setCanvas(state.canvas.h, state.canvas.w));

  paintCanvasBar(bar);
  return bar;
}

// Escreve na barra o que o estado diz. Separado do desenho porque trocar de
// tamanho nao pode refazer a barra: refazer tiraria o foco do campo que a
// pessoa acabou de usar, no meio do ajuste.
export function paintCanvasBar(bar?) {
  const raiz = bar || document.querySelector(".canvasbar");
  if (!raiz) return;
  const sel = raiz.querySelector("#cvPreset");
  const w = raiz.querySelector("#cvW"), h = raiz.querySelector("#cvH");
  const prop = raiz.querySelector("#cvRatio");
  if (!sel || !w || !h) return;

  const chave = state.canvas.w + "x" + state.canvas.h;
  const pronto = CANVAS_PRESETS.some(([, itens]) =>
      itens.some(([, pw, ph]) => pw + "x" + ph === chave));
  sel.value = pronto ? chave : "livre";
  w.value = state.canvas.w;
  h.value = state.canvas.h;
  if (prop) prop.textContent = ratioText(state.canvas.w, state.canvas.h);
}

// Ponto unico por onde o tamanho muda: valida, guarda, redesenha a tela e
// manda para o disco. Numero que nao serve - campo vazio, letra, zero - deixa
// o que estava, em vez de encolher a tela para nada.
export function setCanvas(w?, h?) {
  w = Math.round(Number(w));
  h = Math.round(Number(h));
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) { paintCanvasBar(); return; }

  state.canvas.w = clamp(w, CANVAS_MIN, CANVAS_MAX);
  state.canvas.h = clamp(h, CANVAS_MIN, CANVAS_MAX);

  paintCanvasBar();
  fitScreen();
  refresh(["props"]);
  saveCanvas();
}

// A tela do reprodutor ocupa o maior retangulo da proporcao pedida que caiba
// no painel. Fica aqui, e nao no `aspect-ratio` da folha de estilo, porque o
// mesmo painel tanto e largo e baixo quanto estreito e alto conforme onde a
// pessoa encaixou o reprodutor - e ai o CSS teria de decidir de antemao qual
// dos dois lados manda, que e justamente o que nao se sabe.
// A ultima medida boa do palco. Um painel recem-montado ainda esta fora da
// pagina e nao se deixa medir - e ali a caixa cairia no 16:9 de emergencia da
// folha de estilo, que num projeto vertical e o formato errado. Com a medida
// anterior a mao, ela ja nasce no formato certo, e o observador so confirma.
export let lastStage = null;

export function fitScreen(raiz?) {
  const box = screenIn(raiz);
  const stage = box ? box.parentElement : null;
  if (!stage || !box) return;

  // Fora da pagina, `getComputedStyle` vem vazio e a conta da NaN: dai a
  // medida ter de ser conferida, e nao so comparada com zero.
  const s = getComputedStyle(stage);
  const larg = stage.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
  const alt = stage.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
  if (!(larg > 0) || !(alt > 0)) { sizeScreen(box, lastStage); return; }

  lastStage = { larg, alt };
  sizeScreen(box, lastStage);
  // A letra e uma fracao da altura da tela: mudou a tela, muda a letra.
  setTxKey("");
  paintTextLayer(raiz);
  requestPreview();
}

// O maior retangulo da area de visao que cabe na medida dada.
export function sizeScreen(box?, medida?) {
  if (!box || !medida) return;
  const prop = state.canvas.w / state.canvas.h;
  let w = medida.larg, h = medida.larg / prop;
  if (h > medida.alt) { h = medida.alt; w = medida.alt * prop; }
  box.style.width = Math.max(32, Math.floor(w)) + "px";
  box.style.height = Math.max(24, Math.floor(h)) + "px";
}

// O painel muda de tamanho sozinho - arrastando um divisor, abrindo outra aba,
// maximizando a janela - e a tela tem de acompanhar. Um observador de cada
// vez: o painel se refaz a cada atualizacao, e o antigo ficaria olhando um
// elemento que nao esta mais na pagina.
export let stageWatch = null;
export function watchStage(stage?) {
  if (stageWatch) stageWatch.disconnect();
  stageWatch = new ResizeObserver(() => fitScreen());
  stageWatch.observe(stage);
}

// ------------------------------------------------------------ a previa
//
// A tela mostra TUDO o que esta sob a agulha, e nao so o clipe de cima. Um
// editor de video e isso: camadas empilhadas, cada uma tapando o que sobrou
// da de baixo. A ordem e a da pilha de pistas - a de cima na frente - e quem
// reduz o zoom da camada de cima passa a ver a de baixo aparecendo em volta.
//
// Cada camada tem o seu <img>, o seu enquadramento e a sua fila de pedidos de
// um lugar so. Os mandados para baixo nao entram: estao fora da montagem, e
// mostra-los seria dizer que ainda fazem parte dela.

// `raiz` e o corpo do painel, quando quem chama o tem a mao: enquanto o painel
// nao entrou na pagina, e por ele que se chega a tela. Sem ela, vale a pagina
// inteira, que e o caso de todas as outras chamadas.
export function screenIn(raiz?) { return (raiz || document).querySelector("#screen"); }

// O tamanho da tela em pixels. Fora da pagina nada se mede, e ai vale o que
// `sizeScreen` acabou de escrever no estilo - que e a medida pretendida, e a
// melhor resposta que existe antes de o painel entrar no lugar.
export function screenSize(box?) {
  let w = box.clientWidth, h = box.clientHeight;
  if (w < 2 || h < 2) {
    w = parseFloat(box.style.width) || 0;
    h = parseFloat(box.style.height) || 0;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

export function isFrameKind(c?) {
  return !!(c && c.media && !c.off && (c.kind === "video" || c.kind === "imagem"));
}

// As camadas sob a agulha, DE BAIXO PARA CIMA: a ultima da lista e a que fica
// na frente, que e tambem a ordem em que os <img> entram na pagina.
export function videoLayers() {
  const ordem = new Map();
  state.tracks.forEach((t, i) => ordem.set(t.id, i));
  const daPilha = (c) => ordem.has(c.track) ? ordem.get(c.track) : 99;

  const vivos = state.clips.filter((c) => isFrameKind(c) &&
      state.pos >= c.start && state.pos < c.start + c.len);
  if (vivos.length) return vivos.sort((a, b) => daPilha(b) - daPilha(a));

  // Cursor parado exatamente no fim de um clipe - onde a reproducao para. Ali
  // ele ja esta fora do clipe, mas o que se espera ver e o ultimo quadro, e
  // nao uma tela vazia.
  const naBorda = state.clips.filter((c) => isFrameKind(c) &&
      Math.abs(state.pos - (c.start + c.len)) < 1e-3);
  return naBorda.sort((a, b) => daPilha(b) - daPilha(a));
}

// A camada da frente. E dela que falam os paineis quando nao ha clipe
// escolhido, e e ela que o arrasto na tela move por padrao.
export function clipUnderPlayhead() {
  const l = videoLayers();
  return l.length ? l[l.length - 1] : null;
}

// O <img> de uma camada, dentro da tela.
export function layerImg(box?, id?) {
  return box ? box.querySelector('.vid-layer img[data-clip="' + id + '"]') : null;
}

// Instantes proximos demais pedem o mesmo quadro: arredondar evita mandar
// dez pedidos onde um resolve. O tamanho entra junto - trocada a area de
// visao ou o zoom, o quadro e o mesmo mas a caixa nao e.
//
// Numa foto parada o instante nao entra: e sempre o mesmo quadro. Sem isto,
// uma foto na montagem era decodificada trinta vezes por segundo, e cada
// resposta trocava o endereco da imagem na tela - o que obrigava o navegador a
// redesenhar a pilha inteira a cada quadro. Com a camada girada, que tem
// desenho proprio e caro, isso aparecia como o video de baixo piscando.
export function previewKey(clip?, at?, w?, h?) {
  if (!clip) return "";
  const quando = clip.kind === "imagem" ? "parada" : at.toFixed(2);
  // O recorte entra na chave: ligar e desligar o efeito e a mesma midia no
  // mesmo instante e no mesmo tamanho, e sem isto a tela ficaria mostrando o
  // quadro anterior, achando que nada mudou.
  return clip.media + "@" + quando + "#" + w + "x" + h +
         (clip.fundo ? "+r" + fundoSolidez(clip) + "," + fundoEncolher(clip) : "");
}

// Um teto para a previa durante a reproducao. Nao e para aliviar a ponte - a
// imagem nao passa mais por ela, vai por endereco - e sim porque acima disto
// se decodifica quadro que ninguem chega a ver. Trinta por segundo e o que o
// olho aproveita.
//
// Ja foi cem, tentando desafogar a interface, e foi um erro: o custo estava em
// CADA quadro, e nao no numero deles, entao o teto so deixou a imagem aos
// solavancos sem tirar os engasgos.
export const PREVIEW_MS = 33;

// O estado de uma camada: o quadro que ela esta mostrando e o pedido em curso.
export function layerState(id?) {
  let st = state.preview.camadas.get(id);
  if (!st) {
    st = { url: "", key: "", inflight: false, pending: false, error: "", at: 0 };
    state.preview.camadas.set(id, st);
  }
  return st;
}

export function requestPreview(raiz?) {
  // Painel fechado: nem vale decodificar.
  const box = screenIn(raiz);
  if (!box) return;

  const p = state.preview;

  // Fora da pagina nao ha o que medir: vale a medida do pedido anterior, que e
  // o mais perto que se tem do certo. Assim que a real chegar, `fitScreen`
  // pede de novo se tiver mudado.
  const med = screenSize(box);
  p.w = Math.max(160, med.w || p.w || 640);
  p.h = Math.max(90, med.h || p.h || 360);

  const lista = videoLayers();
  const vivos = new Set(lista.map((c) => c.id));

  // O clipe que esta PARA ENTRAR conta como vivo para a limpeza logo abaixo.
  // O quadro dele e pedido adiantado, e quem pede e um clipe que ainda nao
  // esta na pilha: sem esta linha, a limpeza apagava o estado dele a cada
  // passada - o pedido em curso ficava orfao, a resposta caia no vazio e o
  // adiantamento pedia tudo de novo, sessenta vezes por segundo, sem nunca
  // guardar nada. Na emenda o quadro seguinte chegava sempre atrasado.
  state.clips.forEach((c) => {
    if (!isFrameKind(c)) return;
    const falta = c.start - state.pos;
    if (falta > 0 && falta <= PREVIEW_LOOKAHEAD) vivos.add(c.id);
  });

  // Camada que saiu da pilha nao guarda quadro: ele so voltaria a aparecer
  // errado, e ate la ocupa memoria.
  let mudou = false;
  p.camadas.forEach((st, id) => { if (!vivos.has(id)) { p.camadas.delete(id); mudou = true; } });
  if (mudou) paintPreview(raiz);

  lista.forEach((c) => requestLayer(c, box));
  prefetchNext(box);
}

// O primeiro quadro do proximo clipe, pedido um pouco antes de ele entrar.
//
// A camada de um clipe nasce sem imagem: ela so aparece quando o quadro chega,
// e ate la nao ha o que mostrar. Numa emenda isso da o piscar escuro. Pedindo
// meio segundo antes, o quadro ja esta em maos quando a agulha chega - e a
// troca acontece sem buraco nenhum.
export const PREVIEW_LOOKAHEAD = 0.6;   // segundos

export function prefetchNext(box?) {
  state.clips.forEach((c) => {
    if (!isFrameKind(c)) return;
    const falta = c.start - state.pos;
    if (falta <= 0 || falta > PREVIEW_LOOKAHEAD) return;

    const st = layerState(c.id);
    if (st.url || st.inflight) return;     // ja tem, ou ja esta a caminho
    requestLayer(c, box, clipSourceAt(c, 0));
  });
}

// `at` chega de fora quando se esta pedindo ADIANTADO o quadro de um clipe que
// ainda nao comecou - ali o instante nao sai da agulha, que esta antes dele.
export function requestLayer(c?, box?, atFora?) {
  const p = state.preview;
  const st = layerState(c.id);

  const at = typeof atFora === "number" ? atFora
                                        : clipSourceAt(c, state.pos - c.start);

  // Com a imagem ampliada, o que se ve e um pedaco do quadro: pedi-lo no
  // tamanho da tela e depois estica-lo borraria justamente o enquadramento que
  // se esta olhando de perto.
  // Num clipe animado o zoom muda a cada quadro, e o tamanho do pedido entra
  // na chave da previa: seguindo o valor exato, cada instante pediria uma
  // decodificacao nova de tamanho diferente. Por isso ele vai em degraus de
  // meio - a nitidez acompanha o movimento, e os pedidos se repetem.
  const cru = clamp(tfNow(c).esc, 1, ZOOM_NITIDEZ_MAX);
  const zoom = hasAnim(c) ? Math.round(cru * 2) / 2 : cru;
  const w = Math.max(160, Math.round(p.w * zoom));
  const h = Math.max(90, Math.round(p.h * zoom));

  const key = previewKey(c, at, w, h);
  if (key === st.key) return;

  // Uma fila de um lugar so POR CAMADA: o pedido novo desta camada espera o
  // que esta correndo, e nao atrapalha o das outras.
  if (st.inflight) { st.pending = true; return; }

  // Parado nao ha pressa nenhuma: o pedido sai na hora, que e o que faz o
  // arrastar do cursor parecer imediato. O limite e so para a reproducao.
  const now = performance.now();
  if (state.playing && now - st.at < PREVIEW_MS) { st.pending = true; return; }

  st.inflight = true;
  st.pending = false;
  st.at = now;

  // O numero do clipe vai junto: e por ele que o C++ sabe qual fila atropelar.
  api.frameAt(c.media, at, w, h, c.id, c.fundo ? 1 : 0,
              fundoSolidez(c), fundoEncolher(c)).then((r) => {
    st.inflight = false;
    // Pedido atropelado por outro mais novo da mesma camada: a resposta que
    // interessa vem a seguir, e esta so seria um piscar para tras.
    if (r && r.stale) { if (st.pending) requestPreview(); return; }

    if (r && r.ok) {
      st.url = r.url;
      st.key = key;
      st.error = "";
    } else {
      st.url = "";
      st.key = key;
      st.error = (r && r.error) || "nao foi possivel ler este quadro";
    }
    paintPreview();
    if (st.pending) requestPreview();
  });
}

// ------------------------------------------------- a troca de camada
//
// Dentro de um clipe, trocar o endereco do MESMO <img> nao pisca: o navegador
// segura o quadro que esta la ate o novo estar decodificado. Na emenda entre
// dois clipes nao e o mesmo <img> - cada clipe tem o seu -, e ai o quadro
// velho saia no instante em que o novo recebia o endereco, ANTES de ele ter o
// que mostrar. Sobrava um ou dois quadros de nada, que na tela e um piscar
// preto - bem visivel num corte na voz, onde as emendas vem de meio em meio
// segundo.
//
// A saida e esperar: a camada nova so conta como pintada depois de a imagem
// estar pronta, e ate la a de baixo fica. Nao ha transicao nenhuma nisso - o
// corte continua seco, e o que se ve e sempre um quadro de verdade.

export function quadroPronto(im?) {
  return !im.dataset.cru && im.complete && im.naturalWidth > 0;
}

export function trocaQuadro(im?, url?) {
  im.dataset.cru = url;
  im.src = url;

  const feito = (deu) => {
    // Outro endereco chegou no meio do caminho: quem manda e o mais novo, e
    // este aqui ja nao tem o que dizer.
    if (im.dataset.cru !== url) return;
    delete im.dataset.cru;

    if (!deu) {
      // O endereco morreu. O C++ guarda so os ultimos quadros publicados, e o
      // que sai de circulacao e apagado - entao um endereco velho responde
      // nada, e nunca a imagem de outro clipe. Quem ficou sem imagem pede
      // outra, e a camada se conserta sozinha.
      const st = state.preview.camadas.get(Number(im.dataset.clip));
      if (st && st.url === url) { st.url = ""; st.key = ""; }
      im.removeAttribute("src");
      requestPreview();
      return;
    }

    // Agora a camada de baixo pode sair. Repintar nao pede quadro nenhum: so
    // refaz a pilha, que e barato.
    paintPreview();
  };

  // `decode` avisa quando a imagem esta pronta para ser pintada, que e mais
  // tarde do que `load` - e e justamente esse pedaco de tempo que piscava.
  if (im.decode) im.decode().then(() => feito(true), () => feito(false));
  else {
    im.addEventListener("load", () => feito(true), { once: true });
    im.addEventListener("error", () => feito(false), { once: true });
  }
}

export function paintPreview(raiz?) {
  const box = screenIn(raiz);
  if (!box) return;
  const pilha = box.querySelector(".vid-layer");
  const msg = box.querySelector(".screen-msg");
  if (!pilha || !msg) return;

  const lista = videoLayers();
  const p = state.preview;

  // Os <img> sao reaproveitados por clipe: recriar a cada passada faria a
  // imagem piscar a cada quadro da reproducao. E `appendChild` num elemento
  // que ja esta na pagina o MOVE para o fim - e assim a ordem do DOM vira a
  // ordem da pilha sem apagar nada.
  const tinha = new Map();
  pilha.querySelectorAll("img").forEach((im) => tinha.set(Number(im.dataset.clip), im));

  let pintou = 0, erro = "", postos = 0;
  lista.forEach((c) => {
    let im = tinha.get(c.id);
    if (!im) {
      im = document.createElement("img");
      im.dataset.clip = c.id;
      im.alt = "";
      im.draggable = false;
    }
    tinha.delete(c.id);
    // So mexe no DOM quando a ordem esta mesmo errada: mover um <img> de lugar
    // faz o navegador refazer a camada dele, e fazer isso a cada quadro da
    // reproducao e pedir cintilacao.
    if (pilha.children[postos] !== im) pilha.appendChild(im);
    postos++;
    // A ordem no HTML ja poe as camadas de video em ordem entre si; o numero e
    // o que as poe em ordem em relacao AO TEXTO, que mora na caixa vizinha.
    im.style.zIndex = String(stackZ(c));

    const st = p.camadas.get(c.id);
    if (st && st.url) {
      if (im.getAttribute("src") !== st.url) trocaQuadro(im, st.url);
      im.hidden = false;
      // So conta como pintada a camada que ja tem imagem NA TELA. Um <img> que
      // acabou de receber o endereco ainda nao pinta nada, e conta-lo aqui era
      // o que mandava embora a camada de baixo cedo demais - o piscar escuro
      // de cada emenda.
      if (quadroPronto(im)) pintou++;
    } else {
      im.hidden = true;
      if (st && st.error) erro = st.error;
    }
    // O quadro vem sempre encaixado na tela; o enquadramento do clipe - zoom,
    // giro e posicao - e aplicado por cima, aqui, e a moldura corta o que sobra.
    applyTransform(im, c, box);
  });

  // O que sobrou nao esta mais na pilha - mas so sai depois de haver alguma
  // imagem nova no lugar. Tirar na hora deixava a tela PRETA pelo tempo de uma
  // decodificacao, e era exatamente isso que se via na emenda entre dois
  // clipes: um piscar escuro a cada corte. Segurar o ultimo quadro por um
  // instante nao engana ninguem - ele e mesmo o quadro que estava ali.
  //
  // Com a pilha vazia, porem, sai tudo: ali nao ha nada a segurar, e o que
  // deve aparecer e o recado de que nao ha clipe sob a agulha.
  if (pintou || !lista.length) tinha.forEach((im) => im.remove());

  if (pintou || lista.length) { msg.textContent = pintou ? "" : (erro || ""); return; }
  if (erro) msg.textContent = erro;
  else if (!state.clips.length) msg.textContent = "Nada na linha do tempo ainda.";
  else msg.textContent = "Sem clipe de video sob o cursor.";

  // A moldura vive fora das camadas e depende do tamanho do quadro
  // desenhado: os <img> podem ter acabado de nascer aqui.
  if (typeof pintaMoldura === "function") pintaMoldura(raiz);
}

// ------------------------------------------------------------ transporte

export function seek(sec?) {
  state.pos = Math.max(0, sec);
  const ph = $("playhead");
  if (ph) ph.style.left = (state.pos * state.zoom) + "px";
  const pos = $("tpPos");
  if (pos) pos.textContent = fmtTime(state.pos, true);
  $("topTime").textContent = fmtTime(state.pos, true);
  followPlayhead();
  paintTextLayer();
  paintTfWarning();
  // O enquadramento animado muda a cada instante, e a agulha e quem anda: sem
  // isto o movimento so apareceria quando um quadro novo chegasse, aos
  // solavancos e parado com a reproducao em pausa.
  animaCamadas();
  requestPreview();
}

// Mexer o cursor com o som tocando: a placa continuaria de onde estava, entao
// a reproducao recomeca no ponto novo. Durante um arrasto isso so acontece ao
// soltar - reiniciar a placa a cada movimento picotaria tudo.
export function seekCommit(sec?) {
  if (sec != null) seek(sec);
  if (!state.playing) return;
  if (state.audioClock) startAudio(state.pos);
  else { state.clockPos = state.pos; state.clockAt = performance.now(); }
}

// Quem manda no tempo e a placa de som: o C++ diz onde a reproducao esta, e
// entre uma pergunta e outra interpolamos com o relogio da pagina, para o
// cursor nao andar aos saltos. Sem isto - com o relogio da pagina no comando -
// imagem e som saem um do outro em poucos segundos.

export function audioSegments() {
  const out = [];
  state.clips.forEach((c) => {
    if (c.off) return;           // fora da montagem: nao se ouve
    const m = state.media.find((x) => x.id === c.media);
    if (!m || !m.hasAudio) return;

    // Um clipe fundido toca varios pedacos do arquivo, um atras do outro. Vao
    // todos com o MESMO numero de clipe: e por ele que o motor acha o que
    // mudar quando o volume muda, e o volume e do clipe inteiro.
    clipPieces(c).forEach((p) => {
      // O ganho que vai aqui e o do instante em que a reproducao comeca, e
      // nao o do clipe: num clipe que comeca em silencio por causa da linha,
      // mandar o valor do clipe seria um estouro ate a linha chegar.
      //
      // O instante e o DO CLIPE, que e onde moram os pontos da linha. Somar o
      // ponto de entrada aqui - como se fazia - lia a linha no lugar errado em
      // todo clipe que nao comecasse no zero do arquivo.
      const gain = envGainAt(c, Math.max(0, state.pos - c.start));
      // A duracao que vai e a DA LINHA (p.dur); a velocidade vai junto, e e
      // com ela que o motor sabe quanto de arquivo consumir por segundo.
      out.push([c.id, c.media, c.start + p.a, p.in, p.dur, gain, clipSpeed(c)]);
    });
  });
  return out;
}

// Manda tocar a partir de `from` e acerta o relogio local pelo mesmo ponto.
// Devolve false quando nao ha placa de som - numa maquina sem saida de audio,
// ou por acesso remoto - e ai o transporte cai no relogio da pagina, que nao
// sincroniza nada mas ao menos deixa o cursor correr.
export async function startAudio(from?) {
  // Os trechos vao achatados: a ponte do webview so passa valores simples.
  const flat = [];
  audioSegments().forEach((s) => flat.push(...s));

  state.clockPos = from;
  state.clockAt = performance.now();

  const r = await api.play(from, ...flat);
  if (!r || !r.ok) {
    if (!state.audioWarned) {
      state.audioWarned = true;
      toast(((r && r.error) || "sem saida de audio") + " - o cursor corre sem som.");
    }
    return false;
  }

  // Entre preparar e tocar vao as linhas de volume. Esta ordem e o que evita
  // o estouro no comeco: nenhum som e misturado antes de o motor saber em que
  // volume cada trecho esta.
  await Promise.all(state.clips
      .filter((c) => c.points && c.points.length)
      .map((c) => sendVolume(c)));

  const go = await api.start();
  if (!go || !go.ok) {
    if (!state.audioWarned) {
      state.audioWarned = true;
      toast(((go && go.error) || "sem saida de audio") + " - o cursor corre sem som.");
    }
    return false;
  }
  return true;
}

export async function togglePlay() {
  if (state.playing) { await stopPlay(); return; }

  const end = projectEnd();
  if (end && state.pos >= end - 1e-3) seek(0);

  state.audioClock = await startAudio(state.pos);
  state.playing = true;
  paintPlayButton();
  requestAnimationFrame(tick);
  if (state.audioClock) pollTransport();
}

export async function stopPlay() {
  state.playing = false;
  paintPlayButton();
  paintMeter(0);
  await api.stopAudio();
}

export function paintPlayButton() {
  const b = $("tpPlay");
  if (b) b.innerHTML = state.playing ? "&#10073;&#10073;" : "&#9654;";
}

// Dez vezes por segundo perguntamos onde o som esta. E barato - nao
// decodifica nada, so le um contador - e e o que mantem o medidor e o cursor
// colados no que se ouve.
export async function pollTransport() {
  while (state.playing && state.audioClock) {
    const r = await api.transport();
    if (!state.playing) break;
    if (r && typeof r.pos === "number") {
      state.clockPos = r.pos;
      state.clockAt = performance.now();
      paintMeter(r.peak || 0);
      // A barra so fala do audio quando ha o que dizer: falha aqui significa
      // que a maquina nao esta dando conta, e isso o usuario precisa saber.
      // A barra so fala do audio quando ha o que dizer: falha aqui significa
      // que a maquina nao esta dando conta, e isso o usuario precisa saber.
      const st = document.getElementById("stHint");
      if (st && r.starved > 0) {
        st.textContent = "audio falhou " + Math.round(r.starved / 48) + " ms";
        st.classList.add("warn");
      }
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

// Medidor de saida. O pico chega em amplitude (0 a 1) e vira dB, porque em
// amplitude quase tudo se amontoa na ponta de baixo da barra.
export function paintMeter(peak?) {
  const el = $("tpMeter");
  if (!el) return;
  const db = peak > 0 ? 20 * Math.log10(peak) : -60;
  const pct = clamp((db + 60) / 60, 0, 1) * 100;
  el.style.width = pct.toFixed(1) + "%";
  el.classList.toggle("hot", peak > 0.98);
}

export function tick() {
  if (!state.playing) return;
  const at = state.clockPos + (performance.now() - state.clockAt) / 1000;
  const end = projectEnd();
  if (end && at >= end) { seek(end); stopPlay(); return; }
  seek(at);
  requestAnimationFrame(tick);
}
