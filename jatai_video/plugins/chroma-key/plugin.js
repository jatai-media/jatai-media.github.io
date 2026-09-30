// Chroma key: tira o fundo do clipe logo abaixo - de UMA OU VARIAS cores.
//
// E um filtro de CAMADA ("alcance": "camada" no manifest): a entrada e so o
// clipe de baixo - o video com o fundo a tirar -, e o que este filtro deixar
// transparente mostra o que esta mais abaixo na linha do tempo.
//
// Varias cores: a luz faz a mesma parede virar varios tons - branca perto da
// janela, cinza na sombra, quase preta no canto. Uma cor so nao cobre isso sem
// uma tolerancia que come a pessoa junto; com o conta-gotas a pessoa vai
// somando as partes que sobraram, cada uma com a tolerancia pequena. Cada pixel
// e comparado com todas, e vale a mais proxima.
//
// A comparacao pesa o TOM e o BRILHO conforme cada cor:
//   - cor forte (verde, azul): quase so o TOM (os canais Cb e Cr do YCbCr). A
//     sombra do pano verde e um verde mais escuro, com o mesmo tom, e sai junto;
//   - cor neutra (preto, cinza, branco): o BRILHO. Todo cinza tem o mesmo tom
//     ("nenhum") - comparando so o tom, um fundo escuro levava junto o pelo
//     branco de um gato.
// E a decisao sai da MEDIA de uns poucos vizinhos ("Limpar ruido"), e nao de
// um pixel so: o ruido e os blocos da compressao nao viram buracos.

const MAX = 8;   // o mesmo "max" do parametro no manifest

const SHADER = `
uniform vec3 chaves[${MAX}]; // as cores do fundo (0..1)
uniform float nChaves;      // quantas valem
uniform float tolerancia;   // ate onde e fundo
uniform float suavidade;    // largura da borda entre fundo e o que fica
uniform float despill;      // 0..1: quanto do reflexo do fundo tirar
uniform float raio;         // "limpar ruido": distancia dos vizinhos, em pixels
uniform float verMascara;   // 1: mostra a mascara em preto e branco

vec2 tom(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b,
               0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
float luz(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec4 px = texture(entrada, uv);
  vec3 c = px.rgb;

  // A cor que decide: a media de 3x3 vizinhos (so dos que existem - fora da
  // camada a entrada e transparente).
  vec3 m = vec3(0.0);
  float n = 0.0;
  vec2 passo = raio / tamanho;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 v = texture(entrada, uv + vec2(float(i), float(j)) * passo);
    m += v.rgb * v.a;
    n += v.a;
  }
  m = n > 0.0 ? m / n : c;

  // A cor da lista mais proxima deste pixel.
  float d = 10.0;
  vec2 kPerto = vec2(0.0);
  float fortePerto = 0.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (float(i) >= nChaves) break;
    vec3 kc = chaves[i];
    vec2 k = tom(kc);
    // o quanto a cor tem tom: ~0 num cinza, ~0.45 num verde puro
    float forte = smoothstep(0.04, 0.2, length(k));
    // cor forte: o brilho quase nao conta (a sombra do pano sai junto);
    // cor neutra: o brilho e o que separa
    float pesoLuz = mix(1.0, 0.15, forte);
    float di = length(vec3(tom(m) - k, (luz(m) - luz(kc)) * pesoLuz));
    if (di < d) { d = di; kPerto = k; fortePerto = forte; }
  }

  // 0 = fundo (sai), 1 = fica. Sem cor nenhuma, nada sai.
  float a = nChaves < 0.5 ? 1.0 : smoothstep(tolerancia, tolerancia + suavidade + 0.0001, d);

  // Reflexo: a luz colorida do fundo que bate no cabelo e nos ombros. Tira-se
  // do tom do pixel a parte que aponta para o tom da cor mais proxima, mantendo
  // o brilho. Numa cor neutra nao ha tom para tirar.
  vec2 p = tom(c);
  float y = luz(c);
  float sat = length(kPerto);
  vec2 dir = sat > 0.0001 ? kPerto / sat : vec2(0.0);
  vec2 p2 = p - dir * max(dot(p, dir), 0.0) * despill * fortePerto;
  vec3 limpo = vec3(y + 1.402 * p2.y, y - 0.344136 * p2.x - 0.714136 * p2.y, y + 1.772 * p2.x);

  float alfa = px.a * a;
  if (verMascara > 0.5) cor = vec4(vec3(alfa), 1.0);
  else cor = vec4(clamp(limpo, 0.0, 1.0), alfa);
}`;

// Clipes feitos antes da lista guardavam uma cor so, em `cor`: o manifest
// novo nao tem mais esse campo, entao ele so existe nesses clipes - e ali a
// lista ainda e a de fabrica. Vale a cor que a pessoa tinha escolhido.
function coresDe(p) {
  const fabrica = Array.isArray(p.cores) && p.cores.length === 1 && p.cores[0] === "#00b140";
  if (p.cor && (!Array.isArray(p.cores) || fabrica)) return [p.cor];
  return Array.isArray(p.cores) ? p.cores.slice(0, MAX) : [];
}

export default {
  init(api) {
    return { sh: api.shader(SHADER) };
  },

  render(ctx, { entrada, h, params: p, dados }) {
    const cores = coresDe(p);
    ctx.drawImage(dados.sh.aplica(entrada, {
      chaves: cores,
      nChaves: cores.length,
      tolerancia: p.tolerancia / 100 * 0.4,
      suavidade: p.suavidade / 100 * 0.3,
      despill: p.despill / 100,
      // proporcional a altura: o mesmo alcance na previa e na exportacao
      raio: (p.ruido ?? 30) / 100 * h * 0.006,
      verMascara: p.mascara,
    }), 0, 0);
  },
};
