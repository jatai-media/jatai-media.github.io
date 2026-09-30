// Desfoque: o filtro mais curto possivel, com o Canvas 2D (ctx.filter).
// A forca e proporcional a altura do quadro - a previa e a exportacao pedem
// tamanhos diferentes, e o desfoque tem de parecer o mesmo nos dois.

export default {
  render(ctx, { entrada, t, dur, w, h, params: p }) {
    let forca = p.forca / 100;
    if (p.gradual) forca *= Math.min(1, t / 0.5, (dur - t) / 0.5);
    const raio = forca * h * 0.03;
    // a borda desfocada puxaria o preto de fora: desenha um pouco maior
    const m = raio * 2;
    ctx.filter = raio > 0.1 ? "blur(" + raio + "px)" : "none";
    ctx.drawImage(entrada, -m, -m, w + 2 * m, h + 2 * m);
  },
};
