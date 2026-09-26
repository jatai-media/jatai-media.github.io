// panel-imagem.ts - o enquadramento do clipe: zoom e posicao
//
// A primeira transformacao. Um clipe entra na montagem inteiro e centrado, mas
// quase nunca e assim que ele serve: um video de camera num projeto vertical
// sobra dos dois lados, uma gravacao de tela precisa mostrar um canto, um
// rosto descentralizado pede um empurrao. Enquadrar e dizer que PARTE da
// imagem vai aparecer dentro da area de visao.
//
// As medidas sao do clipe, e nao da tela: `esc` e um fator (1 = como veio) e
// `x`/`y` sao fracoes da area de visao a partir do centro. Assim o
// enquadramento sobrevive a mudar o formato do projeto, a arrastar um divisor
// e a reabrir o programa - nada disso e medido em pixels.

// Ate onde a imagem pode encolher e crescer. O piso e bem baixo de proposito:
// com varias camadas, uma imagem reduzida a um canto da tela e um recurso de
// montagem - a de cima vira um selo sobre a de baixo - e nao um acidente.
import { refreshSelection, snapshot, rememberSnapshot, remember, clipSpeed, groupOf, clamp, capture, fmtTime, state } from "./core";
import { refresh } from "./dock-view";
import { screenIn, screenSize, videoLayers, clipUnderPlayhead, layerImg, requestPreview, paintPreview, seekCommit } from "./panel-player";
import { wheelTextTarget, wheelTextSize } from "./texto";
import { VEL_MIN, VEL_MAX, setClipSpeed } from "./panel-timeline";

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 5;

// Ate onde vale pedir o quadro maior do que a tela. Com zoom, a imagem que se
// ve e um pedaco do quadro; pedi-lo no tamanho da tela e depois estica-lo
// deixaria o enquadramento borrado justamente quando se esta olhando de perto.
// Tres vezes ja cobre o uso comum, e segura o custo da decodificacao.
export const ZOOM_NITIDEZ_MAX = 3;

// A rotacao vai em graus, e nao em voltas ou radianos: e assim que se fala
// dela - "deitado noventa graus" - e e o que o campo pede e mostra.
export const ROT_MIN = -180;
export const ROT_MAX = 180;

export const TF_ZERO = { esc: 1, x: 0, y: 0, rot: 0 };

export function isFrameClip(c?) {
  return !!(c && c.media && (c.kind === "video" || c.kind === "imagem"));
}

export function clipTF(c?) {
  if (!c) return TF_ZERO;
  if (!c.tf) c.tf = { esc: 1, x: 0, y: 0, rot: 0 };
  // Enquadramento salvo antes de existir rotacao nao tem o campo; sem isto ele
  // viraria NaN na primeira conta, e a imagem sumiria da tela.
  if (typeof c.tf.rot !== "number") c.tf.rot = 0;
  return c.tf;
}

// ------------------------------------------------------ pontos de animacao
//
// O enquadramento parado e um so para o clipe inteiro. Com pontos, ele vira
// uma LINHA no tempo - a mesma ideia da linha de volume, so que o que se
// interpola sao quatro numeros em vez de um: tamanho, posicao e giro. Entre
// dois pontos a imagem caminha de um enquadramento ao outro, e e disso que
// sai o movimento - o zoom que fecha devagar, o selo que entra pela borda, a
// foto que gira.
//
// `c.anim` e a lista, ordenada pelo instante DO CLIPE (de 0 a `len`), como os
// pontos de volume. Sem lista nenhuma, vale `c.tf` e nada mais muda: um clipe
// que nunca foi animado continua sendo o de sempre.
//
// Antes do primeiro ponto e depois do ultimo a imagem fica parada no valor
// daquele ponto - nao se inventa movimento fora do que foi desenhado. E o
// mesmo que a linha de volume faz nas pontas.

// Quanto dois instantes podem se aproximar antes de serem o MESMO ponto.
// Mexer no enquadramento com a agulha a dez milesimos de um ponto tem de
// acertar aquele ponto, e nao criar um vizinho colado nele.
export const ANIM_EPS = 0.02;   // segundos

export function animPts(c?) {
  return c && c.anim && c.anim.length ? c.anim : null;
}

export function hasAnim(c?) { return !!animPts(c); }

// Os quatro numeros de um ponto, com os buracos tapados: um ponto salvo por
// uma versao que ainda nao tinha giro nao pode virar NaN na primeira conta.
export function tfNorm(p?) {
  return { esc: typeof p.esc === "number" ? p.esc : 1,
           x: p.x || 0, y: p.y || 0, rot: p.rot || 0 };
}

// O instante do CLIPE em que a agulha esta. Fora do clipe vale a ponta mais
// proxima: e o enquadramento que se ve ali, e e nele que se mexe.
export function animTime(c?) { return clamp(state.pos - c.start, 0, c.len); }

// Entre dois pontos a caminhada e reta - a nao ser que um deles peca curva.
// Reta e o que serve para uma panoramica constante; curva (entra e sai
// devagar) e o que faz um zoom parecer feito a mao, e nao por uma maquina.
export function animCurva(k?, a?, b?) {
  if (!a.s && !b.s) return k;
  return k * k * (3 - 2 * k);
}

// O enquadramento do clipe no instante `t`, contado do comeco dele.
export function tfAt(c?, t?) {
  const pts = animPts(c);
  if (!pts) return clipTF(c);
  if (t <= pts[0].t) return tfNorm(pts[0]);

  for (let i = 0; i + 1 < pts.length; ++i) {
    const a = pts[i], b = pts[i + 1];
    if (t > b.t) continue;
    const k = animCurva(clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1), a, b);
    const A = tfNorm(a), B = tfNorm(b);
    return { esc: A.esc + (B.esc - A.esc) * k,
             x: A.x + (B.x - A.x) * k,
             y: A.y + (B.y - A.y) * k,
             // O giro caminha pelo caminho escrito, e nao pelo mais curto: de
             // -170 a 170 a imagem da a volta inteira. E o que se pediu - quem
             // escreveu os dois numeros quer a volta; quem quer o atalho poe
             // um ponto no meio.
             rot: A.rot + (B.rot - A.rot) * k };
  }
  return tfNorm(pts[pts.length - 1]);
}

// O enquadramento que esta valendo agora, que e o que a tela mostra e o que os
// campos do painel dizem.
export function tfNow(c?) { return tfAt(c, animTime(c)); }

// O ponto em que os controles escrevem. Sem animacao e o enquadramento do
// clipe, como sempre foi. Com animacao, e o ponto que esta sob a agulha - e
// se nao houver um ali, ele nasce agora, com o valor que a linha ja tinha:
// assim mexer na imagem no meio de uma animacao grava um ponto novo em vez de
// desmanchar os que existem.
export function tfEdit(c?) {
  if (!hasAnim(c)) return clipTF(c);
  return animKey(c, animTime(c));
}

// Acha - ou cria - o ponto do instante `t`.
export function animKey(c?, t?) {
  if (!c.anim) c.anim = [];
  const perto = c.anim.find((p) => Math.abs(p.t - t) <= ANIM_EPS);
  if (perto) return perto;

  const v = tfAt(c, t);
  // A curva se herda do ponto anterior: inserir um ponto no meio de um
  // movimento suave nao pode endurecer aquele trecho.
  const antes = c.anim.filter((p) => p.t < t).pop();
  const novo = { id: state.nextId++, t: t, esc: v.esc, x: v.x, y: v.y,
                 rot: v.rot, s: antes ? (antes.s || 0) : 0 };
  c.anim.push(novo);
  c.anim.sort((a, b) => a.t - b.t);
  return novo;
}

// Apaga um ponto por id - pelo mesmo motivo da linha de volume: a lista se
// reordena a cada arrasto, e um indice guardado apontaria para o vizinho.
export function deleteAnimPoint(id?) {
  const c = state.clips.find((x) => (x.anim || []).some((p) => p.id === id));
  if (!c) return;
  remember();
  // Apagando o ULTIMO ponto, o que fica valendo e o enquadramento de agora - e
  // ele tem de ser lido antes, com a lista ainda de pe: depois do filtro nao ha
  // mais linha de onde tira-lo, e a imagem saltaria para o enquadramento de
  // antes de animar.
  const sozinho = c.anim.length === 1 && c.anim[0].id === id;
  if (sozinho) pousaAnim(c);
  else c.anim = c.anim.filter((p) => p.id !== id);
  if (state.pickedAnim === id) state.pickedAnim = 0;
  spreadTF(c);
  afterAnim();
}

// Tira a animacao deixando a imagem ONDE ELA ESTA. Sem isto, apagar o ultimo
// ponto devolveria o enquadramento de antes de animar, e a imagem daria um
// salto no momento em que se limpa a linha.
export function pousaAnim(c?) {
  const v = tfNow(c);
  const t = clipTF(c);
  t.esc = v.esc; t.x = v.x; t.y = v.y; t.rot = v.rot;
  delete c.anim;
}

// O que todo gesto de animacao faz depois: a tela mostra o instante de agora,
// a linha do tempo mostra os pontos, e o painel mostra os numeros.
export function afterAnim() {
  paintPreview();
  requestPreview();
  refresh(["timeline", "imagem", "props"]);
}

// O enquadramento e do bloco, e nao da peca. Fundidas as tomadas de uma mesma
// gravacao, aproximar uma delas e deixar as outras abertas nao e o que ninguem
// quis dizer com "aproximar".
export function spreadTF(c?) {
  const t = clipTF(c);
  groupOf(c).forEach((x) => {
    if (x.id === c.id) return;
    const outro = clipTF(x);
    outro.esc = t.esc;
    outro.x = t.x;
    outro.y = t.y;
    outro.rot = t.rot;

    // A animacao tambem e do bloco - e vai DESLOCADA. Cada peca conta o tempo
    // do proprio comeco, entao copiar os instantes crus faria o movimento
    // recomecar em cada costura. Somado o quanto uma peca comeca depois da
    // outra, a linha atravessa o bloco inteiro de uma vez so, e os pedacos de
    // fora ficam parados na ponta mais proxima - que e o que tfAt ja faz.
    if (hasAnim(c)) {
      const d = c.start - x.start;
      x.anim = c.anim.map((p) => ({ id: state.nextId++, t: p.t + d,
                                    esc: p.esc, x: p.x, y: p.y, rot: p.rot,
                                    s: p.s || 0 }));
    } else if (x.anim) {
      delete x.anim;
    }
  });
}

export function hasTF(c?) {
  if (hasAnim(c)) return true;
  const t = c && c.tf;
  return !!t && (Math.abs(t.esc - 1) > 1e-4 || Math.abs(t.x) > 1e-4 ||
                 Math.abs(t.y) > 1e-4 || Math.abs(t.rot || 0) > 1e-4);
}

// De quem o painel fala. O escolhido, quando e um clipe de imagem - e assim que
// o resto dos paineis trabalha - e, na falta dele, o que estiver na tela: quem
// abre este painel sem ter escolhido nada esta olhando para um quadro, e e
// daquele quadro que ele quer tratar.
export function tfTarget() {
  const pick = state.clips.find((x) => x.id === state.pickedClip);
  if (isFrameClip(pick)) return pick;
  return clipUnderPlayhead();
}

// De quem e o gesto feito NA TELA. Com varias camadas empilhadas, mover a de
// cima nem sempre e o que se quer: escolhido um clipe que esta a vista, o
// arrasto e dele. Sem escolha nenhuma, vale a da frente, que e a que se ve.
export function tfDragTarget() {
  const vis = videoLayers();
  if (!vis.length) return null;
  return vis.find((c) => c.id === state.pickedClip) || vis[vis.length - 1];
}

// O quadro ja chega encaixado na tela (contain). Daqui em diante e a folha de
// estilo que enquadra: mover e ampliar sao a mesma transformacao, e a moldura
// corta o que sobra.
export function applyTransform(img?, c?, box?) {
  if (!img) return;
  // O enquadramento DAQUELE INSTANTE: sem pontos e sempre o mesmo, com pontos
  // e o que a linha diz onde a agulha esta.
  const t = tfNow(c);
  const med = screenSize(box);
  // A ordem e lida da esquerda para a direita como uma sequencia de gestos:
  // leva a imagem para onde ela foi posta, gira em torno do proprio centro e
  // so entao amplia. Girar antes de mover faria a imagem descrever um arco em
  // volta do centro da tela a cada grau.
  img.style.transform =
      "translate(" + (t.x * med.w).toFixed(1) + "px," + (t.y * med.h).toFixed(1) + "px)" +
      " rotate(" + (t.rot || 0).toFixed(2) + "deg)" +
      " scale(" + t.esc.toFixed(4) + ")";
}

// ----------------------------------------------------- a moldura na tela
//
// O <img> ocupa a tela inteira e o quadro aparece encaixado dentro dele
// (object-fit: contain), com tarjas onde sobra. A moldura tem de abracar o
// QUADRO, e nao o elemento - senao ela sobraria nas tarjas, longe da imagem.
//
// O centro do quadro e o centro do elemento, que e o centro da tela. E o
// mesmo ponto em torno do qual a imagem gira e cresce, entao a moldura leva a
// transformacao dela sem precisar de ajuste nenhum.
export function quadroDesenhado(img?, box?) {
  const med = screenSize(box);
  const pArq = (img && img.naturalWidth && img.naturalHeight)
      ? img.naturalWidth / img.naturalHeight : med.w / Math.max(1, med.h);
  const pTela = med.w / Math.max(1, med.h);

  let w, h;
  if (pArq > pTela) { w = med.w; h = med.w / pArq; }
  else { h = med.h; w = med.h * pArq; }
  return { x: (med.w - w) / 2, y: (med.h - h) / 2, w: w, h: h };
}

// Desenha - ou tira - a moldura do clipe escolhido. Chamada de toda parte que
// mexe na imagem, e barata: nao recria nada quando a moldura ja e do clipe
// certo, so muda numeros.
export function pintaMoldura(raiz?) {
  const box = screenIn(raiz);
  if (!box) return;

  const c = state.clips.find((x) => x.id === state.pickedClip);
  const img = (isFrameClip(c) && videoLayers().some((v) => v.id === c.id))
      ? layerImg(box, c.id) : null;

  let sel = box.querySelector(".im-sel");
  if (!img) { if (sel) sel.remove(); return; }

  if (!sel) {
    sel = document.createElement("div");
    sel.className = "im-sel";
    // As quatro pontas e a alca de giro. Os cantos sao os mesmos quatro
    // gestos, e por isso tem a mesma classe: o que muda e de onde a conta
    // mede a distancia, e isso sai da posicao, nao do nome.
    sel.innerHTML =
      '<i class="im-grip nw"></i><i class="im-grip ne"></i>' +
      '<i class="im-grip sw"></i><i class="im-grip se"></i>' +
      '<i class="im-haste"></i><i class="im-girar" title="Girar"></i>' +
      '<i class="im-mover" title="Mover"></i>';
    box.appendChild(sel);

    sel.querySelectorAll(".im-grip").forEach((g) => {
      g.addEventListener("pointerdown", (e) => beginEscala(e, box));
    });
    sel.querySelector(".im-girar")
       .addEventListener("pointerdown", (e) => beginGiro(e, box));

    // O pino do meio faz o que arrastar a imagem ja fazia - e chama o MESMO
    // codigo, em vez de repetir a conta do deslocamento. O que ele acrescenta
    // e visibilidade: um gesto sem pino, ao lado de cinco pinos, parece nao
    // existir.
    sel.querySelector(".im-mover").addEventListener("pointerdown", (e) => {
      // Sem isto o gesto comecaria duas vezes: uma aqui e outra quando o
      // clique chegasse a tela, que tem o proprio ouvinte de arrasto.
      e.stopPropagation();
      beginImageDrag(e, box);
    });
  }

  // O tamanho ja sai ampliado, e a transformacao leva so o resto.
  //
  // Levar o scale junto seria mais curto, e foi o que se fez primeiro - mas o
  // scale de um elemento amplia os FILHOS dele tambem: numa imagem a 30% as
  // alcas viravam tres pixels, e a doze centimetros do olho isso deixa de ser
  // um alvo. Ampliando a caixa em vez de escala-la, o desenho e o mesmo e as
  // alcas ficam do tamanho que foram feitas.
  const t = tfNow(c);
  const med = screenSize(box);
  const q = quadroDesenhado(img, box);
  const w = q.w * t.esc, h = q.h * t.esc;

  sel.style.left = ((med.w - w) / 2).toFixed(1) + "px";
  sel.style.top = ((med.h - h) / 2).toFixed(1) + "px";
  sel.style.width = w.toFixed(1) + "px";
  sel.style.height = h.toFixed(1) + "px";
  sel.style.transform =
      "translate(" + (t.x * med.w).toFixed(1) + "px," +
                     (t.y * med.h).toFixed(1) + "px)" +
      " rotate(" + (t.rot || 0).toFixed(2) + "deg)";
  sel.dataset.clip = c.id;

  apontaCursores(sel, t.rot || 0);
}

// O cursor de cada canto, girado junto com a imagem.
//
// Um canto marcado como "sudeste" aponta para sudeste enquanto a imagem esta
// de pe. Virada a imagem em 45 graus, aquele mesmo canto aponta para o sul - e
// a seta diagonal do cursor passa a mentir sobre o gesto que ela oferece.
export function apontaCursores(sel?, rot?) {
  const cantos = { nw: 225, ne: 315, sw: 135, se: 45 };
  Object.keys(cantos).forEach((nome) => {
    const g = sel.querySelector(".im-grip." + nome);
    if (!g) return;
    // O angulo na tela: o do canto mais o quanto a imagem girou.
    let a = (cantos[nome] + rot) % 180;
    if (a < 0) a += 180;
    // O cursor tem oito direcoes; vale a mais proxima.
    g.style.cursor =
        (a < 22.5 || a >= 157.5) ? "ew-resize" :
        (a < 67.5) ? "nwse-resize" :
        (a < 112.5) ? "ns-resize" : "nesw-resize";
  });
}

// O centro da tela em coordenadas da janela: e em torno dele que a imagem
// gira e cresce, entao e dele que saem o angulo e a distancia do gesto.
export function centroDaImagem(box?, c?) {
  const r = box.getBoundingClientRect();
  const med = screenSize(box);
  const t = tfNow(c);
  // O meio da tela mais o deslocamento: e onde a imagem foi parar, e e em
  // torno desse ponto que ela gira e cresce.
  return { x: r.left + r.width / 2 + t.x * med.w,
           y: r.top + r.height / 2 + t.y * med.h };
}

// Em que objeto um gesto da tela vai escrever, resolvido no PRIMEIRO PIXEL.
//
// Num clipe animado, `tfEdit` cria o ponto sob a agulha quando ainda nao ha um
// ali - e um clique que nao anda nao pode deixar um ponto para tras. Por isso
// a pergunta e adiada ate haver movimento, e a resposta e a mesma do comeco ao
// fim do arrasto.
export function gestoTF(c?) {
  let t = null;
  return () => (t || (t = tfEdit(c)));
}

// Redimensionar pelo canto. A conta e a razao entre as distancias ao centro -
// antes e agora -, e nao a diferenca em x ou y: assim o gesto funciona igual
// com a imagem girada, onde "para a direita" ja nao quer dizer "mais largo".
export function beginEscala(e?, box?) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const c = state.clips.find((x) => x.id === state.pickedClip);
  if (!c) return;
  const img = layerImg(box, c.id);
  const antes = snapshot();
  // Num clipe animado o gesto escreve no ponto que esta sob a agulha; num
  // clipe parado, no enquadramento do clipe. So no primeiro pixel, e nao
  // aqui: um clique que nao anda nao pode deixar um ponto para tras.
  const alvo = gestoTF(c);
  // O centro da IMAGEM, e nao o da tela: movida a imagem, os dois deixam de
  // ser o mesmo ponto, e medir pelo da tela faz um canto crescer enquanto o
  // do lado oposto encolhe.
  const o = centroDaImagem(box, c);

  // A direcao DESTE canto, em coordenadas da tela e ja girada: e ao longo
  // dela que o gesto conta.
  //
  // Medir a distancia crua ate o centro parece equivalente e nao e: deslizar
  // de lado, sem chegar nem afastar, tambem aumenta a distancia. Com a imagem
  // de pe isso quase nao incomoda; girada, o canto que se esta puxando aponta
  // para outro lugar e o gesto vira adivinhacao.
  const dx = e.clientX - o.x, dy = e.clientY - o.y;
  const raio = Math.max(6, Math.hypot(dx, dy));
  const ux = dx / raio, uy = dy / raio;

  // Quanto o ponteiro avancou NAQUELA direcao, e nao em linha reta ate ele.
  const avanco = (ev) => (ev.clientX - o.x) * ux + (ev.clientY - o.y) * uy;
  const d0 = Math.max(6, avanco(e));
  const esc0 = tfNow(c).esc;
  let andou = false;

  capture(box, e.pointerId);

  const move = (ev) => {
    andou = true;
    const t = alvo();
    // Puxar para tras do centro nao inverte a imagem: o minimo do zoom e o
    // fim do gesto, e nao o comeco de um espelhamento que ninguem pediu.
    t.esc = clamp(esc0 * Math.max(0.01, avanco(ev) / d0), ZOOM_MIN, ZOOM_MAX);
    spreadTF(c);
    applyTransform(img, c, box);
    pintaMoldura();
  };

  const up = () => {
    box.removeEventListener("pointermove", move);
    box.removeEventListener("pointerup", up);
    if (!andou) return;
    rememberSnapshot(antes);
    refresh(["timeline", "imagem", "props"]);
  };

  box.addEventListener("pointermove", move);
  box.addEventListener("pointerup", up);
}

// Girar pela alca. O angulo vai do centro ao ponteiro; o que se soma e a
// DIFERENCA desde o comeco do gesto, para a imagem nao dar um salto quando a
// alca e pega fora do lugar exato.
export function beginGiro(e?, box?) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const c = state.clips.find((x) => x.id === state.pickedClip);
  if (!c) return;
  const img = layerImg(box, c.id);
  const antes = snapshot();
  const alvo = gestoTF(c);
  // Em torno do centro da imagem, pelo mesmo motivo do redimensionamento: e
  // ali que o giro acontece de verdade.
  const o = centroDaImagem(box, c);

  const ang = (ev) => Math.atan2(ev.clientY - o.y, ev.clientX - o.x) * 180 / Math.PI;
  const a0 = ang(e);
  const rot0 = tfNow(c).rot || 0;
  let andou = false;

  capture(box, e.pointerId);

  const move = (ev) => {
    andou = true;
    const t = alvo();
    let r = rot0 + (ang(ev) - a0);
    // Com Shift, de quinze em quinze graus: e o gesto de quem quer endireitar
    // a imagem, e nao de quem esta procurando um angulo.
    if (ev.shiftKey) r = Math.round(r / 15) * 15;
    // Volta para a faixa de -180 a 180, que e a do campo no painel.
    while (r > 180) r -= 360;
    while (r < -180) r += 360;
    t.rot = clamp(r, ROT_MIN, ROT_MAX);
    spreadTF(c);
    applyTransform(img, c, box);
    pintaMoldura();
  };

  const up = () => {
    box.removeEventListener("pointermove", move);
    box.removeEventListener("pointerup", up);
    if (!andou) return;
    rememberSnapshot(antes);
    refresh(["timeline", "imagem", "props"]);
  };

  box.addEventListener("pointermove", move);
  box.addEventListener("pointerup", up);
}

// Quanto a imagem precisa crescer para nao sobrar borda nenhuma. Sai da
// diferenca entre a proporcao do arquivo e a da area de visao - um video
// deitado num projeto de pe cresce muito; um do mesmo formato nao cresce nada.
export function coverScale(c?) {
  const m = state.media.find((x) => x.id === c.media);
  if (!m || !m.width || !m.height) return 1;
  const pArq = m.width / m.height;
  const pTela = state.canvas.w / state.canvas.h;
  return Math.max(pArq / pTela, pTela / pArq);
}

// ------------------------------------------------- arrastar dentro da tela

// O gesto principal deste painel nao esta no painel: esta na propria imagem.
// Enquadrar e olhar, e quem olha quer mexer no que esta vendo - nao em dois
// campos de numeros ao lado.
export function beginImageDrag(e?, box?) {
  if (e.button !== 0) return;
  // O texto tem o arrasto dele; o que chega aqui e o que caiu no vazio.
  if (e.target.closest(".tx")) return;

  const c = tfDragTarget();
  if (!c) return;
  e.preventDefault();

  // Arrastar a imagem e escolher o clipe dela: sem isto o painel continuaria
  // falando de outro clipe enquanto a mao mexe neste.
  if (state.pickedClip !== c.id) {
    state.pickedClip = c.id;
    state.picked = new Set([c.id]);
    state.pickedMedia = -1;
    state.pickedPoint = 0;
    // O reprodutor NAO entra na lista: refaze-lo agora trocaria a imagem que
    // esta debaixo da mao, e o arrasto morreria no primeiro pixel.
    refresh(["timeline", "props", "imagem"]);
    pintaMoldura();
  }

  const img = layerImg(box, c.id);
  const antes = snapshot();
  const alvo = gestoTF(c);
  const med = screenSize(box);
  const agora = tfNow(c);
  const x0 = e.clientX, y0 = e.clientY, px = agora.x, py = agora.y;
  let andou = false;

  capture(box, e.pointerId);
  box.classList.add("grabbing");

  const move = (ev) => {
    if (!andou) {
      if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      andou = true;
    }
    const t = alvo();
    t.x = px + (ev.clientX - x0) / Math.max(1, med.w);
    t.y = py + (ev.clientY - y0) / Math.max(1, med.h);
    spreadTF(c);
    applyTransform(img, c, box);
    pintaMoldura();
  };

  const up = () => {
    box.removeEventListener("pointermove", move);
    box.removeEventListener("pointerup", up);
    box.classList.remove("grabbing");
    if (!andou) return;
    rememberSnapshot(antes);
    refresh(["timeline", "imagem", "props"]);
  };

  box.addEventListener("pointermove", move);
  box.addEventListener("pointerup", up);
}

// A roda sobre a imagem aproxima e afasta, em torno do centro. E o gesto que
// todo mundo ja tenta antes de procurar um controle.
let wheelZoomTimer = null;
export function wheelZoom(e?, box?) {
  // Texto escolhido e a vista: a roda e dele, e nao da imagem atras dele.
  // `tfDragTarget` nunca o devolveria - ele so conhece as camadas de video -,
  // e por isso a pergunta tem de ser feita aqui, antes.
  const tx = typeof wheelTextTarget === "function" ? wheelTextTarget() : null;
  if (tx) { wheelTextSize(e, tx); return; }

  const c = tfDragTarget();
  if (!c) return;
  e.preventDefault();

  // O valor novo primeiro, o alvo depois: no limite do zoom a roda nao muda
  // nada, e num clipe animado isso teria criado um ponto a toa.
  const antes = tfNow(c).esc;
  const agora = clamp(antes * (e.deltaY < 0 ? 1.1 : 1 / 1.1), ZOOM_MIN, ZOOM_MAX);
  if (Math.abs(agora - antes) < 1e-6) return;
  tfEdit(c).esc = agora;
  spreadTF(c);

  applyTransform(layerImg(box, c.id), c, box);
  // O quadro mais nitido so depois que a roda para: um pedido por entalhe
  // mandaria decodificar dez vezes no mesmo gesto.
  clearTimeout(wheelZoomTimer);
  wheelZoomTimer = setTimeout(() => {
    requestPreview();
    // o cursor e o campo do painel seguem a roda - e o ponto que ela criou
    // aparece na linha do tempo
    refresh(["timeline", "imagem"]);
  }, 180);
}

// O aviso de que a tela esta mostrando outro clipe. Vive fora do desenho do
// painel porque a resposta muda a cada movimento da agulha, e refazer o painel
// a cada quadro da reproducao tiraria o foco do campo que estivesse em uso.
export function paintTfWarning() {
  const wrap = document.querySelector(".tf-panel");
  if (!wrap) return;
  const aviso = wrap.querySelector(".tf-aviso");
  if (!aviso) return;
  const id = Number(wrap.dataset.clip);
  aviso.hidden = videoLayers().some((x) => x.id === id);
}

// ------------------------------------------------- a animacao andando
//
// Com pontos, o enquadramento muda a cada instante - e a agulha anda sessenta
// vezes por segundo. Refazer o painel ou o reprodutor nesse ritmo esta fora de
// questao: o que se faz aqui e so trocar a transformacao de cada camada, que
// e uma linha de estilo, e acertar os numeros do painel.
export function animaCamadas() {
  const box = screenIn();
  if (!box) return;

  let animou = false;
  videoLayers().forEach((c) => {
    if (!hasAnim(c)) return;
    animou = true;
    applyTransform(layerImg(box, c.id), c, box);
  });
  if (!animou) return;

  // A moldura anda junto com a imagem que ela abraca, e os campos do painel
  // dizem onde a imagem esta agora - senao eles mostrariam o enquadramento de
  // quando o painel foi desenhado.
  pintaMoldura();
  paintTfCampos();
}

// Os numeros do painel seguindo a agulha. O campo que esta em uso nao se
// reescreve: trocar o valor debaixo do teclado mandaria o cursor do texto para
// o fim no meio de uma digitacao.
export function paintTfCampos() {
  const wrap = document.querySelector(".tf-panel");
  if (!wrap) return;
  const c = state.clips.find((x) => x.id === Number(wrap.dataset.clip));
  if (!hasAnim(c)) return;

  const t = tfNow(c);
  const poe = (id, valor) => {
    const el = wrap.querySelector(id);
    if (el && el !== document.activeElement) el.value = String(valor);
  };
  poe("#tfZoom", Math.round(t.esc * 100));
  poe("#tfZoomN", Math.round(t.esc * 100));
  poe("#tfRot", Math.round(t.rot));
  poe("#tfRotN", Math.round(t.rot));
  poe("#tfX", Math.round(t.x * 100));
  poe("#tfY", Math.round(t.y * 100));

  const linha = wrap.querySelector(".tf-anim");
  if (linha) linha.textContent = animResumo(c);

  // Os botoes que falam do ponto sob a agulha acendem e apagam com ela: o
  // painel nao se refaz enquanto a reproducao corre, e sem isto "Excluir
  // ponto" continuaria apagado em cima de um ponto.
  const aqui = (c.anim || []).find((p) => Math.abs(p.t - animTime(c)) <= ANIM_EPS);
  const suave = wrap.querySelector("#tfKeySuave");
  const apaga = wrap.querySelector("#tfKeyDel");
  if (suave) {
    suave.disabled = !aqui;
    suave.textContent = aqui && aqui.s ? "Deixar reto" : "Suavizar";
  }
  if (apaga) apaga.disabled = !aqui;
}

// ---------------------------------------------------------- a velocidade
//
// A mesma linha serve aos dois paineis - o da imagem e o do audio -, porque a
// velocidade e do CLIPE, e nao da imagem nem do som: mudar um sem o outro os
// separaria, e nao ha clipe com a imagem correndo mais depressa que a fala.

export const VEL_PRONTAS = [0.25, 0.5, 1, 1.5, 2, 4];

export function speedRowHtml(c?) {
  const v = clipSpeed(c);
  return '<div class="tx-row">' +
    '<label>Velocidade</label>' +
    '<input type="range" id="clVel" min="' + Math.round(VEL_MIN * 100) +
      '" max="' + Math.round(VEL_MAX * 100) + '" step="5" value="' +
      Math.round(v * 100) + '">' +
    '<div class="a-num"><input type="number" id="clVelN" min="' + VEL_MIN +
      '" max="' + VEL_MAX + '" step="0.05" value="' + v.toFixed(2) +
      '"><span class="unit">&times;</span></div>' +
  '</div>' +
  '<div class="a-foot" id="clVelPresets">' +
    VEL_PRONTAS.map((x) => '<button class="btn ghost" data-vel="' + x + '">' +
        (x === 1 ? "normal" : x + "\u00d7") + '</button>').join("") +
  '</div>';
}

// Liga a linha acima. `depois` e o que cada painel faz para se refazer: os
// dois mostram coisas diferentes do mesmo clipe.
export function wireSpeedRow(wrap?, c?, depois?) {
  const cursor = wrap.querySelector("#clVel");
  const campo = wrap.querySelector("#clVelN");
  if (!cursor || !campo) return;

  const mostra = (de) => {
    const v = clipSpeed(c);
    if (de !== cursor) cursor.value = String(Math.round(v * 100));
    if (de !== campo) campo.value = v.toFixed(2);
  };

  // Enquanto o cursor corre, a linha do tempo se refaz a cada passo - e e isso
  // que se quer ver: o clipe encolhendo ou crescendo debaixo da mao.
  let antesDoGesto = null;
  cursor.addEventListener("pointerdown", () => { antesDoGesto = snapshot(); });
  cursor.addEventListener("input", () => {
    setClipSpeed(c, Number(cursor.value) / 100);
    mostra(cursor);
    refresh(["timeline"]);
    seekCommit();
  });
  cursor.addEventListener("change", () => {
    if (antesDoGesto) { rememberSnapshot(antesDoGesto); antesDoGesto = null; }
    depois();
  });

  campo.addEventListener("change", () => {
    const pedido = Number(campo.value);
    if (!isFinite(pedido) || pedido <= 0) { mostra(null); return; }
    remember();
    setClipSpeed(c, pedido);
    mostra(campo);
    campo.value = clipSpeed(c).toFixed(2);
    refresh(["timeline"]);
    seekCommit();
    depois();
  });
  campo.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); campo.blur(); }
  });

  const prontas = wrap.querySelector("#clVelPresets");
  if (prontas) {
    prontas.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        remember();
        setClipSpeed(c, Number(b.dataset.vel));
        refresh(["timeline"]);
        seekCommit();
        depois();
      });
    });
  }
}

// ------------------------------------------------------------- o painel

export function renderImagem(body?) {
  const c = tfTarget();

  if (!c) {
    const e = document.createElement("div");
    e.className = "empty";
    e.innerHTML = '<b>Nada para enquadrar</b><div class="hint">Escolha um clipe de ' +
      'video ou imagem na linha do tempo, ou leve o cursor ate um.</div>';
    body.appendChild(e);
    return;
  }

  // Os campos mostram o enquadramento DO INSTANTE em que a agulha esta: num
  // clipe parado e o de sempre; num animado e o que a linha diz ali.
  const t = tfNow(c);

  const wrap = document.createElement("div");
  wrap.className = "tf-panel";
  // De quem este painel esta falando. Fica no proprio elemento porque quem
  // acerta o aviso, depois, e a agulha - e ela nao redesenha o painel.
  wrap.dataset.clip = c.id;
  wrap.innerHTML =
    '<div class="section">Enquadramento</div>' +
    '<div class="tf-nome"></div>' +
    // O aviso nasce escondido e quem o acende e paintTfWarning, logo abaixo.
    // Calculado so aqui, ele envelhecia: escolhido um clipe com a agulha
    // longe, ela chegava em cima dele e o aviso continuava dizendo que nao.
    '<div class="tf-aviso" hidden>O cursor nao esta sobre este clipe - ' +
    'os ajustes valem, mas a tela mostra outro.</div>' +
    '<div class="tx-row">' +
      '<label>Zoom</label>' +
      '<input type="range" id="tfZoom" min="' + Math.round(ZOOM_MIN * 100) +
        '" max="' + Math.round(ZOOM_MAX * 100) + '" step="1" value="' +
        Math.round(t.esc * 100) + '">' +
      // O cursor e para procurar; o campo e para chegar. Um enquadramento que
      // se quer repetir em varios clipes - ou desfazer no dia seguinte - pede
      // um numero exato, e nao a mesma posicao aproximada do dedo.
      '<div class="a-num"><input type="number" id="tfZoomN" min="' +
        Math.round(ZOOM_MIN * 100) + '" max="' + Math.round(ZOOM_MAX * 100) +
        '" step="1" value="' + Math.round(t.esc * 100) + '">' +
        '<span class="unit">%</span></div>' +
    '</div>' +
    speedRowHtml(c) +
    '<div class="tx-row">' +
      '<label>Rotacao</label>' +
      '<input type="range" id="tfRot" min="' + ROT_MIN + '" max="' + ROT_MAX +
        '" step="1" value="' + Math.round(t.rot) + '">' +
      '<div class="a-num"><input type="number" id="tfRotN" min="' + ROT_MIN +
        '" max="' + ROT_MAX + '" step="1" value="' + Math.round(t.rot) + '">' +
        '<span class="unit">&deg;</span></div>' +
      '<button class="btn ghost tf-quarto" id="tfRot90" title="Girar um quarto de volta - o caso do video gravado com o celular deitado">&#8635;</button>' +
    '</div>' +
    '<div class="tx-row">' +
      '<label>Posicao</label>' +
      '<div class="a-num"><input type="number" id="tfX" step="1" value="' +
        Math.round(t.x * 100) + '"><span class="unit">% X</span></div>' +
      '<div class="a-num"><input type="number" id="tfY" step="1" value="' +
        Math.round(t.y * 100) + '"><span class="unit">% Y</span></div>' +
    '</div>' +
    // Uma foto parada nao tem duracao propria: ela fica o tempo que se disser.
    // O campo existe porque a linha do tempo, vista de longe, mostra os cinco
    // segundos de fabrica como um fiapo de poucos pixels - e nao ha o que
    // pegar ali com a mao.
    (c.kind === "imagem"
      ? '<div class="tx-row">' +
          '<label>Duracao</label>' +
          '<div class="a-num"><input type="number" id="tfDur" min="0.1" step="0.5" ' +
            'value="' + c.len.toFixed(1) + '"><span class="unit">s</span></div>' +
          '<span class="hint" style="color:var(--dim)">na linha do tempo</span>' +
        '</div>'
      : '') +
    '<div class="a-foot">' +
      '<button class="btn ghost" id="tfCover" title="Cresce ate a imagem cobrir a area de visao, sem borda">Preencher</button>' +
      '<button class="btn ghost" id="tfFit" title="A imagem inteira dentro da area de visao">Caber</button>' +
      '<button class="btn ghost" id="tfCenter">Centralizar</button>' +
      '<button class="btn ghost" id="tfReset">Desfazer tudo</button>' +
    '</div>' +
    // A animacao e a mesma ideia da linha de volume, e por isso mora logo
    // abaixo dos controles que ela grava: pontos no tempo, e entre eles o
    // programa caminha.
    '<div class="section">Animacao</div>' +
    '<div class="tf-anim"></div>' +
    '<div class="a-foot">' +
      '<button class="btn ghost" id="tfKey" title="Grava o enquadramento de agora como um ponto no instante do cursor">Ponto no cursor</button>' +
      '<button class="btn ghost" id="tfKeySuave">Suavizar</button>' +
      '<button class="btn ghost" id="tfKeyDel">Excluir ponto</button>' +
      '<button class="btn ghost" id="tfKeyClear">Apagar animacao</button>' +
    '</div>' +
    '<div class="hint tf-dica">Arraste a imagem na tela para enquadrar. ' +
    'A roda do mouse sobre ela aproxima e afasta. Com dois ou mais pontos, ' +
    'mexer no enquadramento grava no ponto do cursor - e e disso que sai o ' +
    'movimento. Os pontos tambem aparecem na faixa de cima do clipe, na linha ' +
    'do tempo: botao direito ali insere e apaga, e arrastar muda o instante.</div>';
  body.appendChild(wrap);
  wrap.querySelector(".tf-nome").textContent = c.name;
  wrap.querySelector(".tf-anim").textContent = animResumo(c);
  paintTfWarning();

  // Mexer aqui tem de aparecer na tela na hora, sem refazer o reprodutor: o
  // que muda e uma transformacao da imagem, e refazer o painel inteiro
  // devolveria o foco do controle para o nada no meio do ajuste.
  const pinta = () => {
    spreadTF(c);
    const box = screenIn();
    if (box) applyTransform(layerImg(box, c.id), c, box);
  };

  // Onde os controles ESCREVEM. Num clipe parado e o enquadramento do clipe;
  // num animado e o ponto sob a agulha, que nasce no primeiro ajuste. A
  // pergunta e feita a cada gesto, e nao uma vez no desenho do painel: entre
  // um ajuste e outro a agulha pode ter andado para outro ponto.
  const alvo = () => tfEdit(c);

  const zoom = wrap.querySelector("#tfZoom");
  const zoomN = wrap.querySelector("#tfZoomN");

  // Os dois controlam o mesmo numero, entao cada um escreve no outro. O que
  // esta sendo usado nao se reescreve: mudar o valor de um campo enquanto se
  // digita nele mandaria o cursor do texto para o fim a cada tecla.
  const mostra = (de, v?) => {
    const n = String(Math.round((v == null ? tfNow(c).esc : v) * 100));
    if (de !== zoom) zoom.value = n;
    if (de !== zoomN) zoomN.value = n;
  };

  let antesZoom = null;
  zoom.addEventListener("pointerdown", () => { antesZoom = snapshot(); });
  zoom.addEventListener("input", () => {
    const v = clamp(Number(zoom.value) / 100, ZOOM_MIN, ZOOM_MAX);
    alvo().esc = v;
    mostra(zoom, v);
    pinta();
  });
  zoom.addEventListener("change", () => {
    if (antesZoom) { rememberSnapshot(antesZoom); antesZoom = null; }
    requestPreview();     // agora sim, o quadro no tamanho de quem esta perto
    // O ponto que o ajuste acabou de gravar tem de aparecer no clipe.
    if (hasAnim(c)) refresh(["timeline", "imagem"]);
  });

  // O campo so vale ao sair ou no Enter: a cada tecla, "150" passaria por 1 e
  // por 15, e a imagem daria dois saltos antes de chegar onde se queria.
  zoomN.addEventListener("change", () => {
    const pedido = Number(zoomN.value);
    if (!isFinite(pedido) || pedido <= 0) { mostra(null); return; }
    remember();
    const v = clamp(pedido / 100, ZOOM_MIN, ZOOM_MAX);
    alvo().esc = v;
    mostra(zoomN, v);
    // O campo tambem volta a escrever em si mesmo quando o pedido foi aparado
    // pelos limites: sem isto ele mostraria 900% com a imagem em 500%.
    zoomN.value = String(Math.round(v * 100));
    pinta();
    requestPreview();
    if (hasAnim(c)) refresh(["timeline", "imagem"]);
  });
  zoomN.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); zoomN.blur(); }
  });

  // A rotacao anda junto com o zoom: dois controles para o mesmo numero, um
  // para procurar e outro para chegar.
  const giro = wrap.querySelector("#tfRot");
  const giroN = wrap.querySelector("#tfRotN");

  const mostraGiro = (de, v?) => {
    const n = String(Math.round(v == null ? tfNow(c).rot : v));
    if (de !== giro) giro.value = n;
    if (de !== giroN) giroN.value = n;
  };

  let antesGiro = null;
  giro.addEventListener("pointerdown", () => { antesGiro = snapshot(); });
  giro.addEventListener("input", () => {
    const v = clamp(Number(giro.value), ROT_MIN, ROT_MAX);
    alvo().rot = v;
    mostraGiro(giro, v);
    pinta();
  });
  giro.addEventListener("change", () => {
    if (antesGiro) { rememberSnapshot(antesGiro); antesGiro = null; }
    if (hasAnim(c)) refresh(["timeline", "imagem"]);
  });

  giroN.addEventListener("change", () => {
    const pedido = Number(giroN.value);
    if (!isFinite(pedido)) { mostraGiro(null); return; }
    remember();
    const v = clamp(pedido, ROT_MIN, ROT_MAX);
    alvo().rot = v;
    mostraGiro(giroN, v);
    giroN.value = String(Math.round(v));
    pinta();
    if (hasAnim(c)) refresh(["timeline", "imagem"]);
  });
  giroN.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); giroN.blur(); }
  });

  // Um quarto de volta por clique. Passando de 180 graus ele volta pelo outro
  // lado: a mesma imagem, e o numero que o campo mostra continua sendo um que
  // se pode ler.
  // Pelo mesmo motivo dos outros botoes, este passa por `muda`: girar nao muda
  // o quadro pedido, entao sem repintar a tela o clique nao mostrava nada - e
  // parecia que imagem e video nao tinham rotacao nenhuma.
  wrap.querySelector("#tfRot90").addEventListener("click", () => muda(() => {
    let g = Math.round(tfNow(c).rot) + 90;
    if (g > ROT_MAX) g -= 360;
    alvo().rot = g;
  }));

  wireSpeedRow(wrap, c, () => refresh(["imagem", "props"]));

  const dur = wrap.querySelector("#tfDur");
  if (dur) {
    dur.addEventListener("change", () => {
      remember();
      c.len = Math.max(0.1, Number(dur.value) || c.len);
      dur.value = c.len.toFixed(1);
      refreshSelection(["player"]);
      seekCommit();
    });
    dur.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); dur.blur(); }
    });
  }

  const campoX = wrap.querySelector("#tfX"), campoY = wrap.querySelector("#tfY");
  const comN = () => {
    remember();
    const p = alvo();
    p.x = (Number(campoX.value) || 0) / 100;
    p.y = (Number(campoY.value) || 0) / 100;
    pinta();
    if (hasAnim(c)) refresh(["timeline", "imagem"]);
  };
  campoX.addEventListener("change", comN);
  campoY.addEventListener("change", comN);

  const muda = (faz) => {
    remember();
    faz();
    spreadTF(c);
    // A tela tem de ser repintada AQUI. `requestPreview` so pede quadro novo
    // quando o pedido muda, e mover a imagem nao muda pedido nenhum: o quadro
    // e o mesmo, o que muda e a transformacao por cima dele. Sem esta linha,
    // Centralizar zerava os numeros do painel e a imagem ficava onde estava.
    paintPreview();
    requestPreview();
    refresh(["timeline", "imagem", "props"]);
  };

  wrap.querySelector("#tfCover").addEventListener("click", () =>
      muda(() => { alvo().esc = clamp(coverScale(c), ZOOM_MIN, ZOOM_MAX); }));
  wrap.querySelector("#tfFit").addEventListener("click", () =>
      muda(() => { alvo().esc = 1; }));
  wrap.querySelector("#tfCenter").addEventListener("click", () =>
      muda(() => { const p = alvo(); p.x = 0; p.y = 0; }));
  // "Desfazer tudo" desfaz TUDO: o enquadramento e a animacao junto. Zerar os
  // numeros e deixar os pontos de pe devolveria a imagem ao lugar por um
  // instante, e no quadro seguinte a linha a levaria de volta - e pareceria
  // que o botao nao funciona.
  wrap.querySelector("#tfReset").addEventListener("click", () =>
      muda(() => {
        delete c.anim;
        const p = clipTF(c);
        p.esc = 1; p.x = 0; p.y = 0; p.rot = 0;
        state.pickedAnim = 0;
      }));

  wireAnimBotoes(wrap, c);
}

// ----------------------------------------------------- os botoes da animacao

// O que a linha de animacao esta dizendo, em uma frase. Vive fora do desenho
// do painel porque a agulha a reescreve enquanto anda.
export function animResumo(c?) {
  const pts = animPts(c);
  if (!pts) {
    return "Sem pontos: o enquadramento vale para o clipe inteiro. " +
           "\"Ponto no cursor\" comeca uma animacao.";
  }
  const t = animTime(c);
  const aqui = pts.find((p) => Math.abs(p.t - t) <= ANIM_EPS);
  const quantos = pts.length + (pts.length === 1 ? " ponto" : " pontos");
  if (pts.length === 1) {
    return quantos + " em " + fmtTime(pts[0].t, true) +
           " - com um so, a imagem fica parada nele. Leve o cursor a outro " +
           "instante e mexa na imagem para o movimento comecar.";
  }
  return quantos + ", de " + fmtTime(pts[0].t, true) + " a " +
         fmtTime(pts[pts.length - 1].t, true) + "  -  " +
         (aqui ? "o cursor esta sobre um ponto" + (aqui.s ? " (suave)" : "")
               : "o cursor esta entre pontos");
}

export function wireAnimBotoes(wrap?, c?) {
  // O ponto de que os botoes falam: o que esta sob a agulha. Nao o escolhido
  // na linha do tempo - se fossem dois donos, apertar "Excluir ponto" com a
  // agulha num lugar e a selecao em outro apagaria o ponto errado.
  const sob = () => (c.anim || []).find(
      (p) => Math.abs(p.t - animTime(c)) <= ANIM_EPS);

  const suave = wrap.querySelector("#tfKeySuave");
  const apaga = wrap.querySelector("#tfKeyDel");
  const aqui = sob();
  suave.disabled = !aqui;
  suave.textContent = aqui && aqui.s ? "Deixar reto" : "Suavizar";
  suave.title = "Entre e saia deste ponto devagar, em vez de a velocidade " +
                "mudar de uma vez";
  apaga.disabled = !aqui;
  wrap.querySelector("#tfKeyClear").disabled = !hasAnim(c);

  wrap.querySelector("#tfKey").addEventListener("click", () => {
    remember();
    // Sem animacao nenhuma, o primeiro ponto nasce com o enquadramento que o
    // clipe ja tinha - o que esta na tela nao muda, e e a partir dali que o
    // movimento se desenha.
    animKey(c, animTime(c));
    state.pickedAnim = (sob() || {}).id || 0;
    spreadTF(c);
    afterAnim();
  });

  suave.addEventListener("click", () => {
    const p = sob();
    if (!p) return;
    remember();
    p.s = p.s ? 0 : 1;
    spreadTF(c);
    afterAnim();
  });

  apaga.addEventListener("click", () => {
    const p = sob();
    if (p) deleteAnimPoint(p.id);
  });

  wrap.querySelector("#tfKeyClear").addEventListener("click", () => {
    if (!hasAnim(c)) return;
    remember();
    pousaAnim(c);
    state.pickedAnim = 0;
    spreadTF(c);
    afterAnim();
  });
}
