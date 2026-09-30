// filtros.ts - os plugins de filtro na previa.
//
// Um filtro e um clipe numa pista de video, de um de dois alcances:
//
//   "abaixo" (o padrao): CAMADA DE AJUSTE. Durante o tempo dele, altera tudo o
//     que esta ABAIXO dele na pilha - como no Premiere ou no DaVinci. Quem esta
//     acima continua por cima, intacto.
//   "camada": altera SO a camada logo abaixo dele, e a saida - com
//     transparencia - vai por cima do resto. E o que o chroma key precisa: ele
//     recorta o fundo verde do video, e o que esta mais abaixo aparece.
//
// A previa e feita de elementos empilhados (<img> das fotos e videos, <canvas>
// dos plugins, <div> dos textos), e um filtro precisa de PIXELS. Entao, para
// cada filtro na tela, a entrada dele e desenhada num canvas com as mesmas
// contas da exportacao (backend/exportar.ts) - enquadramento, pilha, textos
// (texto-canvas.ts) -, vai para o filtro no sandbox, e o que ele devolve e
// pintado no canvas do filtro. Num filtro de camada, o elemento da camada alvo
// fica escondido (.sob-filtro): senao o fundo verde original apareceria pelas
// partes que o filtro deixou transparentes.
//
// Havendo dois filtros, o de cima parte da SAIDA do de baixo: e o mesmo que a
// exportacao faz, desenhando a pilha em ordem.

import { state, stackZ } from "../ui/core";
import { screenIn, videoLayers, layerImg } from "../ui/panel-player";
import { tfNow } from "../ui/panel-imagem";
import { textsAt, isText } from "../ui/texto";
import { desenhaTexto } from "../backend/texto-canvas";
import { desenhaNoSandbox } from "./sandbox";
import { isFiltro, isFiltroDeCamada, pluginDe, pluginsAt, paramsDe, tempoDe } from "./plugins";

// A imagem inteira dentro da tela, centrada, sem cortar - o mesmo `encaixa`
// da exportacao.
function encaixa(iw: number, ih: number, tw: number, th: number) {
  if (iw <= 0 || ih <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const pi = iw / ih, pt = tw / th;
  const w = pi > pt ? tw : th * pi;
  const h = pi > pt ? tw / pi : th;
  return { x: (tw - w) / 2, y: (th - h) / 2, w, h };
}

// Tudo o que se ve agora, de baixo para cima.
function pilhaAgora() {
  return [...videoLayers(), ...pluginsAt(state.pos), ...textsAt(state.pos)]
    .sort((a, b) => stackZ(a) - stackZ(b));
}

/** A camada logo abaixo de um filtro de camada: o alvo dele. */
export function alvoDoFiltro(filtro, pilha = pilhaAgora()) {
  const z = stackZ(filtro);
  const abaixo = pilha.filter((c) => c.id !== filtro.id && stackZ(c) < z);
  return abaixo.length ? abaixo[abaixo.length - 1] : null;
}

// O elemento de um item na tela: <img>, <canvas> ou a caixa do texto.
function elementoDe(c, box: Element): any {
  if (isText(c)) return box.querySelector('.tx-layer .tx[data-clip="' + c.id + '"]');
  return layerImg(box, c.id);
}

// Um item pode ser lido agora? "Nao" e sobretudo o quadro de video EM TROCA: na
// reproducao o <img> recebe um endereco novo trinta vezes por segundo, e entre
// o endereco e a imagem decodificada ele nao tem o que mostrar. Montar ali
// deixava o video de fora - a entrada saia preta, e o filtro cobria a tela de
// preto por um quadro: o pisca-pisca. Nao pronto, o filtro fica com o ultimo
// resultado bom, e e refeito quando o quadro chega (trocaQuadro chama refazFiltros).
function pronto(c, box: Element) {
  if (isText(c)) return true;
  const el: any = layerImg(box, c.id);
  if (!el) return true;
  // Um filtro abaixo que ainda nao desenhou - a nao ser que tenha erro: ai ele
  // nunca vai desenhar, e esperar por ele travaria este para sempre.
  const pb = isFiltro(c) ? pluginDe(c) : null;
  if (isFiltro(c) && !el.dataset.pronto && !el.dataset.erro && pb && !pb.erro) return false;
  if (el.tagName === "IMG" && !el.hidden && (el.dataset.cru || !el.complete)) return false;
  return true;
}

// Desenha um item da pilha em `ctx`, com o enquadramento dele.
function desenhaItem(ctx: OffscreenCanvasRenderingContext2D, c, box: Element, W: number, H: number) {
  if (isText(c)) { desenhaTexto(ctx, c.texto, W, H); return; }
  const el: any = layerImg(box, c.id);
  if (!el) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (isFiltro(c)) { ctx.drawImage(el, 0, 0, W, H); return; }
  const tr = tfNow(c);
  const esc = tr.esc > 1e-6 ? tr.esc : 1e-6;
  if (el.tagName === "IMG") {
    if (el.hidden || !el.naturalWidth) return;
    const enc = encaixa(el.naturalWidth, el.naturalHeight, W, H);
    ctx.translate(W / 2 + tr.x * W, H / 2 + tr.y * H);
    ctx.rotate(tr.rot * Math.PI / 180);
    ctx.scale(esc, esc);
    ctx.drawImage(el, enc.x - W / 2, enc.y - H / 2, enc.w, enc.h);
  } else {
    // Plugin de desenho: o canvas dele e o quadro inteiro; o enquadramento
    // gira e amplia em torno do centro do que ele desenhou.
    const d = el.dataset;
    const cx = d.bw ? (+d.bx + +d.bw / 2) * W : W / 2;
    const cy = d.bh ? (+d.by + +d.bh / 2) * H : H / 2;
    ctx.translate(cx + tr.x * W, cy + tr.y * H);
    ctx.rotate(tr.rot * Math.PI / 180);
    ctx.scale(esc, esc);
    ctx.drawImage(el, -cx, -cy, W, H);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** A entrada de um filtro, agora, num canvas W x H - ou null se algo que ela
    precisa ainda nao esta pronto. Filtro "abaixo": tudo o que esta abaixo dele,
    montado sobre preto. Filtro de camada: so o alvo, sobre transparente. */
export function entradaDoFiltro(filtro, W: number, H: number, box: Element): OffscreenCanvas | null {
  const pilha = pilhaAgora();

  if (isFiltroDeCamada(filtro)) {
    const alvo = alvoDoFiltro(filtro, pilha);
    if (alvo && !pronto(alvo, box)) return null;
    const tela = new OffscreenCanvas(W, H);
    const ctx = tela.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (alvo) desenhaItem(ctx, alvo, box, W, H);
    return tela;
  }

  const zF = stackZ(filtro);
  const itens = pilha.filter((c) => c.id !== filtro.id && stackZ(c) < zF);

  // O filtro "abaixo" mais alto dos de baixo ja traz, na saida dele, tudo o que
  // estava abaixo dele: comeca-se dali. (Um filtro de camada nao: a saida dele
  // e so a camada dele, recortada.)
  let ini = 0;
  itens.forEach((c, i) => { if (isFiltro(c) && !isFiltroDeCamada(c)) ini = i; });
  // O alvo de um filtro de camada nao entra cru: entra a saida do filtro.
  const alvos = new Set(itens.filter(isFiltroDeCamada).map((c) => alvoDoFiltro(c, pilha)?.id));

  for (let i = ini; i < itens.length; i++) if (!pronto(itens[i], box)) return null;

  const tela = new OffscreenCanvas(W, H);
  const ctx = tela.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  for (let i = ini; i < itens.length; i++) {
    if (alvos.has(itens[i].id)) continue;
    desenhaItem(ctx, itens[i], box, W, H);
  }
  return tela;
}

// Esconde, na tela, a camada que cada filtro de camada substitui - e so depois
// de o filtro ter o que mostrar no lugar dela. As outras voltam a aparecer.
export function marcaAlvos() {
  const box = screenIn();
  if (!box) return;
  const pilha = pilhaAgora();
  const esconder = new Set<Element>();
  pilha.filter(isFiltroDeCamada).forEach((f) => {
    const cv = layerImg(box, f.id);
    if (!cv || !cv.dataset.pronto) return;
    const alvo = alvoDoFiltro(f, pilha);
    const el = alvo ? elementoDe(alvo, box) : null;
    if (el) esconder.add(el);
  });
  box.querySelectorAll(".sob-filtro").forEach((el) => { if (!esconder.has(el)) el.classList.remove("sob-filtro"); });
  esconder.forEach((el) => el.classList.add("sob-filtro"));
}

// Uma fila de um lugar por canvas: com a reproducao correndo, o pedido novo
// espera o que esta em curso, e so o mais recente e feito.
interface Fila { inflight: boolean; pending: boolean }
const filas = new WeakMap<HTMLCanvasElement, Fila>();

function canvasDe(c): HTMLCanvasElement | null {
  const box = screenIn();
  const cv = box ? box.querySelector('.pl-layer canvas[data-clip="' + c.id + '"]') as HTMLCanvasElement : null;
  return cv && cv.dataset.w ? cv : null;
}

// Os filtros na tela, de baixo para cima.
function filtrosNaTela() {
  return pluginsAt(state.pos).filter(isFiltro).sort((a, b) => stackZ(a) - stackZ(b));
}

/** Pede ao sandbox o quadro do filtro `c` sobre a entrada dele.

    Os filtros sao refeitos EM CADEIA, de baixo para cima: cada um, ao
    terminar, passa a vez ao de cima (que parte da saida dele), e a cadeia
    acaba no do topo. Antes cada um, ao terminar, mandava refazer TODOS - e com
    dois empilhados um reacendia o outro sem fim: centenas de quadros por
    segundo com a previa parada. */
export function pedeFiltro(c) {
  const cv = canvasDe(c);
  const p = pluginDe(c);
  if (!cv || !p || p.erro) return;
  const w = +cv.dataset.w!, h = +cv.dataset.h!;
  let f = filas.get(cv);
  if (!f) { f = { inflight: false, pending: false }; filas.set(cv, f); }
  if (f.inflight) { f.pending = true; return; }
  const box = screenIn();
  if (!box) return;

  const tela = entradaDoFiltro(c, w, h, box);
  if (!tela) return;       // algo em troca: fica o ultimo quadro bom
  f.inflight = true;
  f.pending = false;

  const entrada = tela.transferToImageBitmap();
  const { t, dur } = tempoDe(c, state.pos);
  desenhaNoSandbox(p.id, { t, dur, w, h, params: paramsDe(c, p), medir: false, entrada }).then((r) => {
    f!.inflight = false;
    if (r.bmp) {
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(r.bmp, 0, 0);
      r.bmp.close();
      cv.dataset.pronto = "1";
      delete cv.dataset.erro;
    } else {
      cv.dataset.erro = r.erro || "erro";
    }
    if (!cv.isConnected) return;
    marcaAlvos();
    // Pediram de novo enquanto este rodava: refaz este, e a cadeia sobe depois.
    if (f!.pending) { pedeFiltro(c); return; }
    // Senao, a vez e do filtro logo acima, que parte da saida deste.
    const lista = filtrosNaTela();
    const i = lista.findIndex((x) => x.id === c.id);
    if (i >= 0 && i + 1 < lista.length) pedeFiltro(lista[i + 1]);
  });
}

// Algo abaixo de um filtro mudou (chegou um quadro, mexeu-se um texto, andou a
// imagem): a cadeia comeca pelo filtro mais baixo, uma vez por quadro de tela
// no maximo.
//
// Na reproducao, no maximo ~30 vezes por segundo - o mesmo teto dos quadros da
// previa (PREVIEW_MS). A tela pode ter 144 Hz, mas o video embaixo nao muda
// mais depressa que isso, e refazer os filtros a cada quadro de tela seria
// trabalho que ninguem ve.
const RITMO_MS = 33;
let agendado = false;
let ultimaCadeia = 0;
export function refazFiltros() {
  // Os elementos da tela podem ter sido refeitos (os textos sao, a cada
  // mudanca): o que estava escondido sob um filtro de camada volta a esconder.
  marcaAlvos();
  if (agendado) return;
  if (!pluginsAt(state.pos).some(isFiltro)) return;
  agendado = true;
  const espera = state.playing ? Math.max(0, RITMO_MS - (performance.now() - ultimaCadeia)) : 0;
  setTimeout(() => requestAnimationFrame(() => {
    agendado = false;
    ultimaCadeia = performance.now();
    const lista = filtrosNaTela();
    if (lista.length) pedeFiltro(lista[0]);
  }), espera);
}

// ------------------------------------------------------------ o conta-gotas
//
// Um parametro de cor com "contagotas": true ganha, no painel, um botao que
// deixa escolher a cor clicando na tela. A cor sai da ENTRADA do filtro, e nao
// do que se ve: num chroma key a tela ja mostra o fundo recortado, e o que se
// quer e a cor do verde ORIGINAL - inclusive para clicar de novo e refinar.

/** Abre o conta-gotas sobre a tela. `escolheu` recebe "#rrggbb"; nada, se a
    pessoa desistir (Esc ou botao direito). Com `continuo`, ele fica aberto e
    cada clique entrega uma cor - e o que a lista de cores de um chroma key
    usa para ir somando as partes do fundo que sobraram. `fechou` e chamado
    quando ele fecha, de um jeito ou de outro. */
export function abreContagotas(filtro, escolheu: (cor: string) => void,
                               op: { continuo?: boolean; fechou?: () => void } = {}): string {
  const box = screenIn() as HTMLElement | null;
  if (!box) return "Abra o reprodutor para usar o conta-gotas.";
  const r = box.getBoundingClientRect();
  const W = Math.max(16, Math.round(r.width)), H = Math.max(16, Math.round(r.height));
  const tela = entradaDoFiltro(filtro, W, H, box);
  if (!tela) return "O quadro ainda esta carregando - tente de novo em um instante.";
  const px = tela.getContext("2d")!.getImageData(0, 0, W, H).data;

  // A media de um quadradinho de 5x5, so dos pixels que existem (alfa): um
  // pixel so pega o ruido da compressao, e nao a cor do fundo.
  const amostra = (x: number, y: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
      const i = (yy * W + xx) * 4;
      if (px[i + 3] < 128) continue;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
    }
    if (!n) return null;
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
    return "#" + hex(r) + hex(g) + hex(b);
  };

  const capa = document.createElement("div");
  capa.className = "contagotas";
  capa.innerHTML = '<div class="contagotas-dica">' +
                   (op.continuo ? "Clique nas cores do fundo - cada clique soma uma. Esc ou botao direito termina"
                                : "Clique na cor do fundo - Esc cancela") + '</div>' +
                   '<div class="contagotas-cor"><i></i><span></span></div>';
  box.appendChild(capa);
  const etiqueta = capa.querySelector(".contagotas-cor") as HTMLElement;

  const ponto = (e: PointerEvent) => {
    const rr = box.getBoundingClientRect();
    return { x: Math.round((e.clientX - rr.left) * W / rr.width),
             y: Math.round((e.clientY - rr.top) * H / rr.height),
             lx: e.clientX - rr.left, ly: e.clientY - rr.top };
  };
  const fecha = () => {
    capa.remove();
    window.removeEventListener("keydown", tecla, true);
    op.fechou?.();
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecha(); }
  };
  capa.addEventListener("pointermove", (e) => {
    const p = ponto(e);
    const cor = amostra(p.x, p.y);
    etiqueta.style.left = (p.lx + 14) + "px";
    etiqueta.style.top = (p.ly + 14) + "px";
    etiqueta.hidden = !cor;
    if (cor) {
      (etiqueta.querySelector("i") as HTMLElement).style.background = cor;
      etiqueta.querySelector("span")!.textContent = cor;
    }
  });
  capa.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) { fecha(); return; }
    const p = ponto(e);
    const cor = amostra(p.x, p.y);
    if (!op.continuo) fecha();
    if (cor) escolheu(cor);
  });
  capa.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", tecla, true);
  return "";
}
