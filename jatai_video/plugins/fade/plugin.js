// Fade: a imagem de baixo, coberta por uma cor que vai de 0 a 100% na
// entrada e volta na saida. Com entrada e saida de 1 s num clipe de 2 s,
// posto sobre um corte, vira a transicao classica "escurece e volta".

export default {
  render(ctx, { entrada, t, dur, w, h, params: p }) {
    ctx.drawImage(entrada, 0, 0, w, h);
    const ida = p.entrada > 0 ? Math.min(1, t / p.entrada) : 1;       // 0 -> 1
    const volta = p.saida > 0 ? Math.min(1, (dur - t) / p.saida) : 1; // 1 -> 0 no fim
    // cobertura: sobe ate o meio e desce depois
    const cobre = p.entrada > 0 && t < p.entrada ? ida
                : p.saida > 0 && dur - t < p.saida ? volta
                : 1;
    ctx.globalAlpha = Math.max(0, Math.min(1, cobre));
    ctx.fillStyle = p.cor;
    ctx.fillRect(0, 0, w, h);
  },
};
