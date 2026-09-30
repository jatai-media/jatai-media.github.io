// Marca d'agua: o logo.png desta pasta num canto do video.
//
// Mostra o init: ele roda uma vez, quando a pasta e aberta, e o que ele devolve
// chega em info.dados a cada quadro. E ali que se carregam imagens e fontes.
// "parado": true no manifest avisa que o desenho nao muda com o tempo - a
// previa nao pede um quadro novo a cada instante.

export default {
  async init(api) {
    return { logo: await api.imagem("logo.png") };
  },

  render(ctx, { w, h, params: p, dados }) {
    const logo = dados.logo;
    const larg = w * p.tamanho / 100;
    const alt = larg * logo.height / logo.width;
    const m = Math.min(w, h) * 0.04;
    const x = p.canto.includes("esquerda") ? m : w - m - larg;
    const y = p.canto.includes("cima") ? m : h - m - alt;
    ctx.globalAlpha = p.opacidade / 100;
    ctx.drawImage(logo, x, y, larg, alt);
  },
};
