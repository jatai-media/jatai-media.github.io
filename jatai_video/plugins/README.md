# Como fazer um plugin para o jat.ai

Este guia serve para você e para uma IA. Para pedir um plugin a uma IA (ChatGPT, Claude,
Gemini...), **cole este arquivo inteiro na conversa** e depois descreva o que você quer.
Há um modelo de pedido [no fim](#pedindo-a-uma-ia).

Há dois tipos de plugin:

- **Desenho:** desenha algo por cima do vídeo: tarja com nome, legenda estilizada,
  contador, marca d'água, moldura, barra de progresso, placar, partículas...
- **Filtro** (`"tipo": "filtro"`): recebe a imagem de tudo o que está **abaixo** dele e a
  devolve alterada: cor, preto e branco, desfoque, vinheta, fade, glitch, transições...
  É uma "camada de ajuste": o que estiver acima do filtro na linha do tempo não é afetado.

Nos dois casos o plugin vira um clipe na linha do tempo, com os campos que você definir,
e sai no vídeo exportado exatamente como aparece na prévia.

---

## 1. O que entregar

Uma pasta com, no mínimo, dois arquivos:

```
nome-do-plugin/          ← o nome da pasta é o id do plugin (letras minúsculas, números e -)
  manifest.json          ← nome, duração e os campos que aparecem no painel
  plugin.js              ← o código que desenha
  (opcional) imagens .png/.jpg/.webp e fontes .ttf/.otf/.woff2 que o plugin usar
```

Para usar, abra o editor em **Menu > Plugins > Adicionar pasta de plugins...** e escolha a
pasta do plugin, ou a pasta que contém vários plugins. Depois de mudar um arquivo, clique
em **Recarregar** no painel Plugins.

> Não troque o nome da pasta depois de usar o plugin num projeto: é por ele que os clipes
> acham o plugin.

---

## 2. manifest.json

```json
{
  "nome": "Tarja do apresentador",
  "descricao": "Nome e cargo numa faixa com degradê.",
  "versao": "1.0",
  "autor": "Seu nome",
  "duracao": 5,
  "parado": false,
  "params": [
    { "id": "nome",    "tipo": "texto",   "rotulo": "Nome",    "padrao": "Maria Silva" },
    { "id": "texto",   "tipo": "texto",   "rotulo": "Texto",   "padrao": "linha 1\nlinha 2", "linhas": 3 },
    { "id": "cor",     "tipo": "cor",     "rotulo": "Cor",     "padrao": "#b3122e" },
    { "id": "largura", "tipo": "numero",  "rotulo": "Largura", "min": 10, "max": 100, "passo": 1, "padrao": 50, "unidade": "%" },
    { "id": "lado",    "tipo": "escolha", "rotulo": "Lado",    "opcoes": ["esquerda", "direita"], "padrao": "esquerda" },
    { "id": "sombra",  "tipo": "sim_nao", "rotulo": "Sombra",  "padrao": true }
  ]
}
```

| Campo | Obrigatório | O que é |
|---|---|---|
| `nome` | sim | O nome que aparece no painel e na linha do tempo |
| `tipo` | não | `"filtro"` para um filtro (ver a [seção 3b](#3b-filtros)). Sem ele, é um desenho |
| `alcance` | não | Só para filtros: `"abaixo"` (o padrão) ou `"camada"`. Ver a [seção 3b](#3b-filtros) |
| `descricao` | não | Aparece ao passar o mouse sobre o plugin |
| `duracao` | não | Segundos que o clipe dura ao entrar na linha do tempo (padrão 5) |
| `parado` | não | `true` se o desenho **não muda com o tempo** (marca d'água, moldura fixa). A prévia desenha uma vez só |
| `arquivo` | não | Nome do código, se não for `plugin.js` |
| `params` | não | Os campos do painel, na ordem em que aparecem |

**Tipos de campo** (`tipo`), e o que o código recebe em `params.<id>`:

| tipo | No painel | Valor recebido | Opções extras |
|---|---|---|---|
| `texto` | caixa de texto | string | `"linhas": 3` vira uma caixa de várias linhas (o texto chega com `\n`) |
| `cor` | seletor de cor | string `"#rrggbb"` (sem transparência) | `"contagotas": true` põe um botão **Conta-gotas**: a pessoa clica na tela e a cor vem da imagem. Num filtro, vem da **entrada** do filtro (a imagem original), e não do que a tela mostra |
| `cores` | lista de amostras de cor, cada uma com × para tirar | array de strings `["#rrggbb", ...]` | `"max": 8` (padrão 8). Com `"contagotas": true`, o botão **+ Conta-gotas** fica aberto e **cada clique soma uma cor**; Esc ou botão direito terminam, e um Ctrl+Z desfaz a sessão inteira. O `padrao` é uma lista (`["#00b140"]` ou `[]`) |
| `numero` | campo numérico | number | `min`, `max` (com os dois, ganha um controle deslizante), `passo`, `unidade` (só o rótulo, ex. `"%"`) |
| `escolha` | lista | string (uma das `opcoes`) | `opcoes`: lista de strings |
| `sim_nao` | caixa de marcar | boolean | — |

Todo campo precisa de um `padrao` que funcione sozinho: é assim que o plugin aparece ao
entrar na linha do tempo.

---

## 3. plugin.js

Um **módulo ES** com `export default` de um objeto que tem `render` e, se precisar, `init`:

```js
export default {
  // Opcional. Roda UMA vez, quando a pasta é carregada. Serve para carregar
  // imagens e fontes da pasta do plugin. O que devolver chega em info.dados.
  async init(api) {
    await api.fonte("Titulo.ttf", "Titulo");          // registra a fonte com o nome "Titulo"
    return { logo: await api.imagem("logo.png") };    // ImageBitmap
  },

  // Obrigatório. Desenha UM quadro. Pode ser async.
  render(ctx, info) {
    const { t, dur, progresso, w, h, params, dados } = info;
    // ...desenhe em ctx...
  },
};
```

**`ctx`** é um `CanvasRenderingContext2D` de um quadro **transparente** de `w × h` pixels
(de um `OffscreenCanvas`). O que não for desenhado fica transparente e mostra o vídeo por
baixo.

**`info`:**

| Campo | O que é |
|---|---|
| `t` | Segundos desde o começo do clipe (de 0 até `dur`) |
| `dur` | Duração do clipe em segundos (a pessoa pode esticar ou encurtar) |
| `progresso` | `t / dur`, de 0 a 1 |
| `w`, `h` | Tamanho do quadro em pixels. **Muda** entre a prévia (~800 px) e a exportação (1920 px ou outro) |
| `params` | Os valores dos campos do `manifest.json`, pelo `id` |
| `dados` | O que `init` devolveu (ou `undefined`) |

**`api`** (só no `init`):

| Função | O que faz |
|---|---|
| `api.imagem("caminho")` | Devolve um `ImageBitmap` de um arquivo da pasta do plugin (`"logo.png"`, `"img/fundo.jpg"`) |
| `api.fonte("caminho", "Familia")` | Registra uma fonte da pasta com o nome dado. Depois use `ctx.font = "700 40px Familia"` |
| `api.shader(glsl)` | Compila um shader GLSL que roda na placa de vídeo. Para filtros: ver a [seção 3b](#3b-filtros) |

**Retorno de `render` (opcional):** `return { x, y, w, h }` em pixels, a área que você
desenhou. É em torno do centro dela que o editor gira e amplia o plugin, e é ela que a
moldura de seleção abraça. Sem retorno, o editor mede sozinho pelos pixels não
transparentes, e isso basta na maioria dos casos. Devolva a área quando ela mudar de
tamanho durante uma animação e você quiser o centro parado (ex.: um texto que aparece
letra por letra).

---

## 3b. Filtros

Um filtro tem `"tipo": "filtro"` no `manifest.json`. O `render` recebe, além do resto,
**`info.entrada`**: um `ImageBitmap` de `w × h`. O que vem nele depende do **alcance**:

| `alcance` | `info.entrada` | O que o filtro desenha |
|---|---|---|
| `"abaixo"` (padrão) | Tudo o que está abaixo do filtro, já montado, opaco | **Substitui** tudo o que estava abaixo. É uma camada de ajuste: cor, P&B, desfoque, vinheta, fade |
| `"camada"` | **Só a camada logo abaixo** do filtro (um vídeo, uma foto, um texto), sobre fundo transparente | Vai **por cima** do resto, com a transparência que o filtro deixar: onde ele apagar, aparece o que está mais abaixo. É o do **chroma key**, e o de efeitos num clipe só |

Num filtro de camada, a saída **pode e deve** ter transparência (alfa menor que 1 no shader,
ou `clearRect`/pixels transparentes no Canvas 2D); a camada original fica escondida enquanto
o filtro está sobre ela.

Há dois jeitos de escrever um filtro.

**1. Canvas 2D:** para o que o canvas já sabe fazer (desfoque, fade, sobreposições):

```js
export default {
  render(ctx, { entrada, w, h, params }) {
    ctx.filter = "blur(" + (h * 0.01) + "px) grayscale(1)";   // proporcional a h
    ctx.drawImage(entrada, 0, 0, w, h);
  },
};
```

**2. Shader na placa de vídeo (`api.shader`):** para qualquer efeito por pixel (cor,
vinheta, distorção, glitch, chroma key). O shader é compilado uma vez no `init`, e a cada
quadro `aplica` roda o shader sobre a entrada e devolve um canvas pronto para desenhar:

```js
const SHADER = `
uniform float forca;       // os seus uniforms
uniform vec3 tom;          // uma cor "#rrggbb" do painel chega como vec3

void main() {
  vec3 c = texture(entrada, uv).rgb;
  cor = vec4(mix(c, c * tom, forca), 1.0);
}`;

export default {
  init(api) { return { sh: api.shader(SHADER) }; },
  render(ctx, { entrada, t, params: p, dados }) {
    ctx.drawImage(dados.sh.aplica(entrada, { forca: p.forca / 100, tom: p.tom }), 0, 0);
  },
};
```

Regras do shader:
- A linguagem é **GLSL ES 3.00** (WebGL2). O editor já põe o cabeçalho: **não escreva
  `#version`, `precision`, `entrada`, `tamanho`, `uv` nem `cor`**. Escreva só os seus
  `uniform` e o `main()`. (Quem quiser controle total pode começar o texto com
  `#version 300 es` e escrever tudo; aí nada é acrescentado.)
- O que já existe dentro do shader:

  | Nome | Tipo | O que é |
  |---|---|---|
  | `entrada` | `sampler2D` | A imagem de baixo. Leia com `texture(entrada, uv)` |
  | `uv` | `vec2` | A posição do pixel, de 0 a 1, com **(0,0) no canto de cima à esquerda** (como no canvas) |
  | `tamanho` | `vec2` | Largura e altura em pixels. Um pixel em `uv` é `1.0 / tamanho` |
  | `cor` | `out vec4` | A saída: escreva a cor final aqui, com alfa 1.0 |

- `aplica(entrada, valores)` põe cada valor no uniform de mesmo nome, pelo tipo declarado no
  shader: número → `float` (ou `int`), `[a, b]` → `vec2`, `[a, b, c]` → `vec3`, uma cor
  `"#rrggbb"` → `vec3` de 0 a 1, `true`/`false` → `1`/`0`. Uniform declarado e não
  preenchido fica 0.
- **Listas:** declare `uniform vec3 cores[8];` e passe uma lista (`cores: params.cores`, com
  cores `"#rrggbb"`, números ou listas de números). O que faltar até o tamanho declarado fica
  0; passe também quantos valem (`uniform float nCores;` → `nCores: params.cores.length`) e
  pare o laço ali (`if (float(i) >= nCores) break;`). É assim que o `chroma-key` recebe
  várias cores do fundo.
- O tempo **não** entra sozinho: se o efeito anima, passe `t` (ou `progresso`) em `valores` e
  declare `uniform float t;`.
- Um erro de compilação aparece na faixa vermelha, com a linha do erro.

Regras próprias de filtro:
- **Sempre desenhe a imagem**, a original ou a alterada. Um filtro "abaixo" que não desenha
  nada deixa a tela preta, porque ele substitui tudo o que está abaixo.
- **Filtro "abaixo": a saída é opaca e cobre o quadro inteiro.** Ao desfocar, desenhe a
  entrada um pouco maior que o quadro para a borda não puxar preto (veja o exemplo
  `desfoque`).
- **Filtro de camada: preserve a transparência da entrada.** Fora da camada, a entrada é
  transparente; multiplique o alfa do resultado pelo alfa da entrada
  (`texture(entrada, uv).a`), senão aparece um retângulo onde não havia nada.
- **Não use `render` para devolver `{ x, y, w, h }`:** filtros não se movem nem se giram (o
  painel Imagem não age sobre eles).

---

## 4. Regras que o plugin precisa seguir

Estas regras vêm de como o editor funciona. Um plugin que as quebra parece funcionar num
teste rápido e falha na exportação ou ao arrastar a agulha.

1. **Tudo proporcional a `w` e `h`, nunca em pixels fixos.** A prévia e a exportação pedem
   tamanhos diferentes. Escreva `h * 0.05`, e não `40`. Fonte: `Math.round(h * 0.06) + "px"`.
2. **O quadro depende só de `t` e `params`.** O mesmo `t` tem de dar sempre o mesmo
   desenho. A prévia pede quadros fora de ordem (a pessoa arrasta a agulha para trás e
   para a frente), e a exportação pede cada quadro de novo. Então:
   - não guarde estado de um quadro para o outro (posição de partícula, contador...);
     **calcule a partir de `t`**;
   - nada de `Math.random()` solto. Para "aleatório", use um gerador com semente fixa
     (há um no exemplo 3 abaixo);
   - nada de `Date.now()`, `performance.now()`, `setTimeout` ou `requestAnimationFrame`.
     O tempo é `t`.
3. **Entrada e saída são animações em função de `t` e `dur`.** Ex.: entra nos primeiros 0,5 s
   (`t < 0.5`) e sai nos últimos 0,4 s (`dur - t < 0.4`). Use `dur`, porque a pessoa muda a
   duração do clipe.
4. **Desenho: não limpe nem pinte o quadro inteiro de preto.** Ele já chega transparente, e
   um fundo opaco esconde o vídeo. Escurecer de propósito (vinheta, "fundo escuro") pode,
   com transparência: `rgba(0,0,0,.5)`. (Filtro é o contrário: ele **tem** de desenhar a
   imagem inteira; veja a seção 3b.)
5. **Posição, giro e tamanho do plugin como um todo não são sua responsabilidade.** O
   editor aplica o que a pessoa ajustar no painel Imagem (arrastar, girar, zoom, pontos de
   animação). Desenhe o plugin na posição "natural" (ex.: tarja no rodapé à esquerda) e
   ofereça campos só para o que é do desenho (cores, textos, lado, estilo).
6. **Seja rápido.** `render` roda a cada quadro (30 ou 60 vezes por segundo de vídeo). Faça
   o trabalho pesado (carregar imagens, pré-calcular) no `init`.
7. **Texto que não cabe:** use o 4º argumento de `fillText(texto, x, y, larguraMaxima)`, ou
   meça com `ctx.measureText` e reduza a fonte.

### O que existe e o que não existe dentro do plugin

O plugin roda isolado (um iframe `sandbox` sem acesso à rede), por segurança.

| Pode usar | Não pode usar |
|---|---|
| Toda a API do Canvas 2D: caminhos, `Path2D`, degradês, `shadowBlur`, `globalAlpha`, `globalCompositeOperation`, `ctx.filter` (ex. `"blur(4px)"`), `drawImage`, `setTransform`, `clip` | `fetch`, `XMLHttpRequest`, WebSocket: a rede está bloqueada |
| `new OffscreenCanvas(w, h)` para desenhar em camadas e depois `ctx.drawImage` | `import` de outros arquivos ou de URLs (CDN): **tudo num arquivo só** |
| Imagens e fontes **da própria pasta**, via `api` no `init` | Imagens ou fontes da internet (Google Fonts etc.) |
| Fontes **da própria pasta**, via `api.fonte`: é o único jeito de o texto sair igual no Windows, no Linux e no Mac. Genéricas (`sans-serif`, `serif`, `monospace`) funcionam, mas cada sistema troca por uma diferente | HTML e CSS: elementos da página não aparecem no vídeo. Tudo tem de ser desenhado no `ctx` |
| Shaders GLSL via `api.shader` (WebGL2, na placa de vídeo) | Fontes pelo nome do sistema (`"Segoe UI"`, `Arial`, `Helvetica`): existem num sistema e não no outro |
| `Math`, arrays, funções, classes: JavaScript comum | `localStorage`, `indexedDB`, `document.cookie` |
| `async`/`await` no `init` e no `render` | Bibliotecas externas (a não ser coladas dentro do `plugin.js`) |

Quer uma fonte específica? Coloque o `.ttf`/`.woff2` na pasta e registre com `api.fonte`.
Fontes do Google Fonts têm licença livre (OFL) e servem. Garanta que a licença da fonte
permite isso.

### Erros

Se o plugin der erro, o editor mostra a mensagem numa faixa vermelha na própria tela e no
painel Plugins (passe o mouse no plugin). Erros comuns:

- `plugin.js nao exporta render(ctx, info)`: faltou `export default { render(...) {...} }`;
- `manifest.json invalido`: JSON com vírgula sobrando no fim de uma lista, ou comentário
  (JSON não aceita `//`);
- `arquivo nao encontrado na pasta do plugin`: o caminho em `api.imagem`/`api.fonte` não
  bate com o nome do arquivo (maiúsculas e minúsculas contam).

---

## 5. Exemplos completos

Nesta pasta há plugins prontos para ler e copiar.

Desenhos:
- [`tarja-apresentador/`](tarja-apresentador/): nome e cargo com degradê, entrando e
  saindo deslizando; mostra campos de todos os tipos;
- [`contagem-regressiva/`](contagem-regressiva/): números e anel animados em função de `t`;
- [`marca-dagua/`](marca-dagua/): usa `init` + `api.imagem` para desenhar o `logo.png` da pasta,
  com `"parado": true`.

Filtros:
- [`ajuste-de-cor/`](ajuste-de-cor/): brilho, contraste, saturação (0 = preto e branco) e
  temperatura, em **shader**;
- [`vinheta/`](vinheta/): bordas escurecidas, em **shader**; mostra uma cor do painel chegando
  ao shader como `vec3` e o uso de `tamanho`;
- [`desfoque/`](desfoque/): em **Canvas 2D** (`ctx.filter`), com entrada e saída graduais;
- [`fade/`](fade/): em **Canvas 2D**; escurece na entrada e na saída do clipe (uma transição,
  se posto sobre um corte);
- [`chroma-key/`](chroma-key/): filtro de **camada** em shader; tira o fundo verde (ou de
  qualquer cor) do clipe de baixo, com **várias cores** somadas pelo conta-gotas (para o
  fundo com a luz batendo diferente em cada parte), tolerância, borda suave, remoção do
  reflexo, limpeza do ruído da compressão e um modo de ver a máscara. Mostra como pesar
  tom e brilho conforme a cor do fundo: com fundo de cor forte conta quase só o tom (a
  sombra do pano sai junto); com fundo neutro (preto, cinza, branco) conta o brilho.

Mais três, curtos, cobrindo casos que aparecem sempre:

**Exemplo 1: barra de progresso no rodapé** (usa `progresso`)

```json
{ "nome": "Barra de progresso", "duracao": 30,
  "params": [
    { "id": "cor",    "tipo": "cor",    "rotulo": "Cor",    "padrao": "#f0b429" },
    { "id": "altura", "tipo": "numero", "rotulo": "Altura", "min": 1, "max": 5, "padrao": 1, "unidade": "% da tela" }
  ] }
```
```js
export default {
  render(ctx, { progresso, w, h, params: p }) {
    const alt = h * p.altura / 100;
    ctx.fillStyle = "rgba(255,255,255,.15)";
    ctx.fillRect(0, h - alt, w, alt);
    ctx.fillStyle = p.cor;
    ctx.fillRect(0, h - alt, w * progresso, alt);
  },
};
```

**Exemplo 2: legenda que surge palavra por palavra** (texto de várias linhas, fade, texto que cabe)

```json
{ "nome": "Legenda palavra a palavra", "duracao": 6,
  "params": [
    { "id": "texto", "tipo": "texto", "rotulo": "Texto", "padrao": "Uma frase que aparece aos poucos", "linhas": 3 },
    { "id": "cor",   "tipo": "cor",   "rotulo": "Letra", "padrao": "#ffffff" },
    { "id": "porSegundo", "tipo": "numero", "rotulo": "Palavras por segundo", "min": 1, "max": 10, "padrao": 3 }
  ] }
```
```js
export default {
  render(ctx, { t, dur, w, h, params: p }) {
    const palavras = String(p.texto).split(/\s+/).filter(Boolean);
    const quantas = Math.min(palavras.length, Math.floor(t * p.porSegundo) + 1);
    const saida = Math.min(1, Math.max(0, (dur - t) / 0.4));      // some nos ultimos 0,4 s
    let tam = Math.round(h * 0.06);
    ctx.font = "700 " + tam + "px system-ui, sans-serif";
    const frase = palavras.slice(0, quantas).join(" ");
    // cabe em 90% da largura: reduz a fonte se precisar
    const larg = ctx.measureText(palavras.join(" ")).width;
    if (larg > w * 0.9) { tam = Math.floor(tam * w * 0.9 / larg); ctx.font = "700 " + tam + "px system-ui, sans-serif"; }
    ctx.globalAlpha = saida;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = tam * 0.15;
    ctx.strokeStyle = "rgba(0,0,0,.8)";
    ctx.strokeText(frase, w / 2, h * 0.9);
    ctx.fillStyle = p.cor;
    ctx.fillText(frase, w / 2, h * 0.9);
  },
};
```

**Exemplo 3: partículas (confete)**: "aleatório" com semente, sem guardar estado

```json
{ "nome": "Confete", "duracao": 4,
  "params": [
    { "id": "quantos", "tipo": "numero", "rotulo": "Quantidade", "min": 10, "max": 400, "padrao": 120 },
    { "id": "semente", "tipo": "numero", "rotulo": "Variação",   "min": 1,  "max": 999, "padrao": 7 }
  ] }
```
```js
// Gerador com semente: os mesmos numeros sempre, em qualquer quadro.
function gerador(semente) {
  let s = semente >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const CORES = ["#f0b429", "#e63946", "#4cc9f0", "#80ed99", "#ffffff"];

export default {
  render(ctx, { t, w, h, params: p }) {
    const rnd = gerador(p.semente);
    for (let i = 0; i < p.quantos; i++) {
      // cada particula: sorteada uma vez (mesma ordem sempre), posicao calculada de t
      const x0 = rnd() * w, atraso = rnd() * 1.5, vel = 0.25 + rnd() * 0.35;
      const giro = (rnd() - 0.5) * 12, balanco = rnd() * Math.PI * 2, cor = CORES[Math.floor(rnd() * CORES.length)];
      const tt = t - atraso;
      if (tt < 0) continue;
      const y = -h * 0.05 + tt * vel * h;
      if (y > h * 1.05) continue;
      const x = x0 + Math.sin(tt * 3 + balanco) * w * 0.02;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tt * giro);
      ctx.fillStyle = cor;
      ctx.fillRect(-h * 0.006, -h * 0.01, h * 0.012, h * 0.02);
      ctx.restore();
    }
    return { x: 0, y: 0, w, h };   // a area e a tela toda: o centro do giro fica no meio
  },
};
```

---

## 6. Antes de entregar: confira

- [ ] A pasta tem `manifest.json` e `plugin.js` (ou o nome em `"arquivo"`).
- [ ] O `manifest.json` é JSON válido: sem comentários e sem vírgula sobrando.
- [ ] Todo `param` tem `id`, `tipo`, `rotulo` e um `padrao` bom.
- [ ] `plugin.js` tem `export default { render(ctx, info) { ... } }`, sem `import`.
- [ ] Nenhum número em pixels fixos: tudo a partir de `w` e `h`.
- [ ] O desenho depende só de `t`, `dur` e `params`: sem estado entre quadros, sem `Math.random()` solto, sem relógio.
- [ ] Nada pinta o quadro inteiro de opaco (o vídeo tem de aparecer por baixo).
- [ ] Nenhum acesso à rede, a fontes ou imagens de fora da pasta.
- [ ] Se usa imagem ou fonte, o arquivo está na pasta com o mesmo nome usado em `api.imagem`/`api.fonte`.

Se for **filtro**, confira também:
- [ ] O `manifest.json` tem `"tipo": "filtro"`.
- [ ] O `render` sempre desenha a imagem inteira (a `entrada`, alterada ou não).
- [ ] Se age sobre um clipe só (chroma key, cor de um vídeo), tem `"alcance": "camada"`, e a
      saída mantém a transparência da entrada.
- [ ] O shader não declara `#version`, `precision`, `entrada`, `tamanho`, `uv` nem `cor`
      (o editor já declara), e escreve em `cor` com alfa 1.0.
- [ ] Todo `uniform` do shader recebe um valor em `aplica(entrada, { ... })`, inclusive `t`
      se o efeito anima.

---

## Pedindo a uma IA

Copie este arquivo inteiro para a conversa e, logo abaixo, escreva algo como:

```
Usando o guia acima, crie um plugin para o jat.ai que [descreva o que quer ver no vídeo].

- Tipo: [desenho, por cima do vídeo | filtro, que muda o que está abaixo, como cor ou desfoque]
- Campos que eu quero poder mudar no painel: [ex.: o texto, a cor do fundo, o lado da tela]
- Como deve entrar e sair: [ex.: surgir com fade em 0,5 s e sair deslizando para a esquerda]
- Duração padrão: [ex.: 5 segundos]
- Estilo: [ex.: moderno, cantos arredondados, cores de telejornal]

Entregue a pasta completa: o nome da pasta, o manifest.json e o plugin.js inteiros, cada
um num bloco de código separado. Siga todas as regras da seção 4 (e da 3b, se for
filtro) e confira a lista da seção 6 antes de responder.
```

Depois é só criar a pasta com o nome que a IA indicou, salvar os dois arquivos dentro dela
e adicioná-la no editor (**Menu > Plugins > Adicionar pasta de plugins...**). Se aparecer
erro na tela, copie a mensagem vermelha de volta para a IA e peça a correção.
