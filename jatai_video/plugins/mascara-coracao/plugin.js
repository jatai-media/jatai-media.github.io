function desenharCoracao(ctx, cx, cy, tamanho) {
  const s = tamanho;

  ctx.beginPath();

  ctx.moveTo(cx, cy + s * 0.75);

  ctx.bezierCurveTo(
    cx - s * 0.9,
    cy + s * 0.05,
    cx - s * 0.9,
    cy - s * 0.65,
    cx - s * 0.45,
    cy - s * 0.65
  );

  ctx.bezierCurveTo(
    cx - s * 0.18,
    cy - s * 0.65,
    cx,
    cy - s * 0.40,
    cx,
    cy - s * 0.20
  );

  ctx.bezierCurveTo(
    cx,
    cy - s * 0.40,
    cx + s * 0.18,
    cy - s * 0.65,
    cx + s * 0.45,
    cy - s * 0.65
  );

  ctx.bezierCurveTo(
    cx + s * 0.9,
    cy - s * 0.65,
    cx + s * 0.9,
    cy + s * 0.05,
    cx,
    cy + s * 0.75
  );

  ctx.closePath();
}

export default {
  render(ctx, { t, dur, w, h, params: p }) {

    const cx = w / 2;
    const cy = h / 2;

    // Tamanho proporcional à altura da tela
    const tamanho = h * (p.tamanho / 100);

    // Entrada e saída suaves
    let alpha = 1;

    if (t < 0.4) {
      alpha = t / 0.4;
    }

    if (dur - t < 0.4) {
      alpha = Math.min(alpha, (dur - t) / 0.4);
    }

    alpha = Math.max(0, Math.min(1, alpha));

    // ------------------------------------------------
    // 1. Máscara vermelha
    // ------------------------------------------------

    ctx.save();

    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.cor;

    ctx.fillRect(0, 0, w, h);

    // ------------------------------------------------
    // 2. Abre o coração
    // ------------------------------------------------

    ctx.globalCompositeOperation = "destination-out";

    desenharCoracao(ctx, cx, cy, tamanho);

    ctx.fill();

    ctx.restore();

    // ------------------------------------------------
    // 3. Borda opcional
    // ------------------------------------------------

    if (p.borda) {
      ctx.save();

      ctx.globalAlpha = alpha;

      desenharCoracao(ctx, cx, cy, tamanho);

      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = Math.max(2, h * 0.006);

      ctx.stroke();

      ctx.restore();
    }

    return {
      x: 0,
      y: 0,
      w,
      h
    };
  }
};