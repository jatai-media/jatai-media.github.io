// texto-canvas.ts - o texto da linha do tempo desenhado num canvas, para a
// exportacao.
//
// Na previa o texto e HTML (texto.ts: buildTextBox + a folha .tx), porque ali
// ele e arrastado, redimensionado e editado com o teclado. No arquivo ele tem
// de sair IGUAL, entao esta funcao repete, em contas de canvas, o que o
// navegador faz com aquela folha de estilo:
//
//   - a fonte e a do texto, empacotada no programa (ui/fontes.ts) - e quem
//     chama garante que ela ja carregou (carregaFonte);
//   - a caixa e ancorada pelo centro (x, y) e gira em torno dele;
//   - uma linha por Enter, e nenhuma quebra inventada (white-space: pre);
//   - altura de linha 1,15 do corpo; texto centrado na caixa, nos dois eixos,
//     mesmo quando ele e maior que ela (display: flex + center);
//   - com fundo: espacamento de .18em em cima e embaixo e .5em dos lados,
//     cantos de 3 px; sem fundo: sombra 0 1px 3px rgba(0,0,0,.75);
//   - caixa com medida propria (larg/alt) ja inclui o espacamento
//     (box-sizing: border-box); sem medida, ela e o texto mais o espacamento.
//
// Quem mudar a folha .tx em panels.css tem de mudar aqui tambem.

import { familiaCss } from "../ui/fontes";

export interface TextoExport {
  txt: string;
  x: number; y: number;        // centro da caixa, em fracao da area de visao
  tam: number;                 // corpo da letra, em fracao da ALTURA
  rot?: number;                // graus
  cor: string;
  fundo?: string;              // "#rrggbbaa", ou "" sem fundo
  peso?: number;
  fonte?: string;              // id de ui/fontes.ts; sem ele, a padrao
  larg?: number; alt?: number; // medida propria da caixa, em fracao
}


// A sombra e os cantos sao medidas fixas em pixels DA PREVIA, que costuma ter
// perto de 540 px de altura. No arquivo eles crescem na mesma proporcao.
const ALTURA_PREVIA = 540;

export function desenhaTexto(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
                             t: TextoExport, W: number, H: number) {
  const corpo = t.tam * H;
  if (!(corpo > 0)) return;
  const k = H / ALTURA_PREVIA;

  // Um Enter no fim nao abre linha nova no HTML (pre); aqui tambem nao.
  const linhas = String(t.txt ?? "").replace(/\r/g, "").replace(/\n$/, "").split("\n");
  const altLinha = corpo * 1.15;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = (t.peso || 400) + " " + corpo + "px " + familiaCss(t.fonte);

  const largTexto = Math.max(0, ...linhas.map((l) => ctx.measureText(l).width));
  const padX = t.fundo ? corpo * 0.5 : 0;
  const padY = t.fundo ? corpo * 0.18 : 0;
  const bw = t.larg ? t.larg * W : largTexto + 2 * padX;
  const bh = t.alt ? t.alt * H : linhas.length * altLinha + 2 * padY;

  ctx.translate(t.x * W, t.y * H);
  ctx.rotate(((t.rot || 0) * Math.PI) / 180);

  if (t.fundo) {
    ctx.fillStyle = t.fundo;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 3 * k);
    else ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fill();
  } else {
    // Sem fundo, a letra clara sobre um quadro claro some: a sombra e o que
    // garante a leitura, como na previa.
    ctx.shadowColor = "rgba(0,0,0,.75)";
    ctx.shadowOffsetY = 1 * k;
    ctx.shadowBlur = 3 * k;
  }

  // Onde fica a linha de base dentro de cada linha: o espaco que sobra da
  // altura da linha e dividido igualmente em cima e embaixo, como o CSS faz.
  const m = ctx.measureText("Hg");
  const asc = m.fontBoundingBoxAscent ?? corpo * 0.8;
  const desc = m.fontBoundingBoxDescent ?? corpo * 0.2;
  const base = (altLinha - (asc + desc)) / 2 + asc;

  ctx.fillStyle = t.cor || "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const topo = (-linhas.length * altLinha) / 2;
  linhas.forEach((l, i) => ctx.fillText(l, 0, topo + i * altLinha + base));
  ctx.restore();
}
