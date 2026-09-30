// Tarja do apresentador: nome e cargo numa faixa com degrade. Entra deslizando
// no comeco do clipe e sai no fim.
//
// Tudo e medido em fracao de w e h: a previa e a exportacao pedem o quadro em
// tamanhos diferentes, e o desenho tem de cair no mesmo lugar nos dois.

const ENTRA = 0.6;   // segundos
const SAI = 0.45;

const suave = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export default {
  render(ctx, { t, dur, w, h, params: p }) {
    const mostra = suave(t / ENTRA) * suave((dur - t) / SAI);
    if (mostra <= 0) return;

    const direita = p.lado === "direita";
    const margem = w * 0.04;
    const larg = w * p.largura / 100;
    const alt = h * 0.12;
    const x = direita ? w - margem - larg : margem;
    const y = h * p.altura / 100 - alt / 2;

    ctx.save();
    // Desliza de fora da tela ate o lugar.
    ctx.translate((1 - mostra) * (larg + margem) * (direita ? 1 : -1), 0);
    ctx.globalAlpha = Math.min(1, mostra * 1.5);

    if (p.sombra) {
      ctx.shadowColor = "rgba(0,0,0,.45)";
      ctx.shadowBlur = alt * 0.25;
      ctx.shadowOffsetY = alt * 0.06;
    }
    const g = ctx.createLinearGradient(x, 0, x + larg, 0);
    g.addColorStop(0, direita ? p.cor2 : p.cor1);
    g.addColorStop(1, direita ? p.cor1 : p.cor2);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, larg, alt);
    ctx.shadowColor = "transparent";

    // A barra de destaque, do lado de dentro da tela.
    const barra = alt * 0.09;
    ctx.fillStyle = p.destaque;
    ctx.fillRect(direita ? x + larg - barra : x, y, barra, alt);

    const pad = alt * 0.32;
    const tx = direita ? x + larg - barra - pad : x + barra + pad;
    const cabe = larg - barra - pad * 2;
    ctx.textAlign = direita ? "right" : "left";
    ctx.fillStyle = p.corTexto;
    ctx.font = "700 " + Math.round(alt * 0.4) + "px system-ui, 'Segoe UI', sans-serif";
    ctx.fillText(p.nome, tx, y + alt * 0.52, cabe);
    ctx.globalAlpha *= 0.85;
    ctx.font = "500 " + Math.round(alt * 0.24) + "px system-ui, 'Segoe UI', sans-serif";
    ctx.fillText(p.cargo, tx, y + alt * 0.84, cabe);

    ctx.restore();
  },
};
