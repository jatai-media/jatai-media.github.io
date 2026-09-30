// Vinheta: escurece as bordas, em shader. Mostra uma cor do painel ("#rrggbb")
// chegando ao shader como vec3, e o uniform `tamanho` (pixels) que o editor
// preenche sozinho - usado aqui para a vinheta ser redonda em qualquer formato.

const SHADER = `
uniform float forca;
uniform float raio;
uniform vec3 corBorda;

void main() {
  vec4 c = texture(entrada, uv);
  vec2 d = (uv - 0.5) * vec2(tamanho.x / tamanho.y, 1.0);
  float r = length(d) / (0.5 * raio);
  float k = smoothstep(0.55, 1.0, r) * forca;
  cor = vec4(mix(c.rgb, corBorda, k), 1.0);
}`;

export default {
  init(api) {
    return { sh: api.shader(SHADER) };
  },

  render(ctx, { entrada, params: p, dados }) {
    ctx.drawImage(dados.sh.aplica(entrada, {
      forca: p.forca / 100,
      raio: p.raio / 100 * 1.8,
      corBorda: p.cor,
    }), 0, 0);
  },
};
