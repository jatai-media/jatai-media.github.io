// Contagem regressiva: um numero por segundo, de "Comeca em" ate 1, com um
// anel que esvazia enquanto o segundo passa.

export default {
  render(ctx, { t, w, h, params: p }) {
    const de = Math.max(1, Math.round(p.de));
    if (t >= de) return;
    const n = de - Math.floor(t);
    const dentro = t % 1;              // 0..1 dentro do segundo

    if (p.fundo) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(0, 0, w, h);
    }

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.22;
    ctx.lineWidth = r * 0.08;
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = p.cor;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - dentro));
    ctx.stroke();

    // O numero chega um pouco maior e assenta.
    const esc = 1 + 0.25 * Math.pow(1 - Math.min(1, dentro * 4), 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(esc, esc);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 " + Math.round(r * 1.1) + "px system-ui, 'Segoe UI', sans-serif";
    ctx.fillText(String(n), 0, r * 0.04);
    ctx.restore();
  },
};
