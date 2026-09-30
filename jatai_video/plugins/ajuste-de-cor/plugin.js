// Ajuste de cor: um shader que roda na placa de video.
//
// O shader e compilado uma vez no init; a cada quadro, `aplica` recebe a
// imagem de entrada (tudo o que esta abaixo do filtro) e os valores do painel,
// e devolve um canvas com o resultado.

const SHADER = `
uniform float brilho;       // -1..1
uniform float contraste;    // -1..1
uniform float saturacao;    // 0..2
uniform float temperatura;  // -1..1

void main() {
  vec3 c = texture(entrada, uv).rgb;
  c += brilho;
  c = (c - 0.5) * (1.0 + contraste) + 0.5;
  float luz = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luz), c, saturacao);
  c += vec3(0.08, 0.02, -0.08) * temperatura;   // quente puxa para o laranja, frio para o azul
  cor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export default {
  init(api) {
    return { sh: api.shader(SHADER) };
  },

  render(ctx, { entrada, params: p, dados }) {
    ctx.drawImage(dados.sh.aplica(entrada, {
      brilho: p.brilho / 200,
      contraste: p.contraste / 100,
      saturacao: p.saturacao / 100,
      temperatura: p.temperatura / 100,
    }), 0, 0);
  },
};
