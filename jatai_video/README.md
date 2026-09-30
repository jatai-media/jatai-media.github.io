# jat.ai no navegador — editor de vídeo (com scripts Jatai)

Porte do editor de vídeo jat.ai (C++) para o navegador, com **scripts Jatai rodando na
própria página**. É um projeto independente dentro do ecossistema, lado a lado com os
outros:

```
jatai_image/          o repositório: hub na raiz (index.html, src/)
  jatai_image/        editor de design
  jatai_video/        este editor (package.json, node_modules e public/ próprios)
  jatai_lang/         a linguagem Jatai (e, em ide/, a plataforma para usá-la)
```

A VM do Jatai vem de `../jatai_lang` (`main.c` e `src/`), compilada para
`public/jatai.wasm` a cada build (`npm run jatai:wasm`). O `.wasm` não vai para o git:
sai sempre do código-fonte, aqui e no deploy.

No hub ele fica em `/jatai_video/`: o `npm run build` da raiz chama o `build:hub` daqui,
que compila com `--base /jatai_video/` direto em `../dist/jatai_video`.

O GitHub Pages não manda os cabeçalhos COOP/COEP. Hoje nada depende deles, mas quando os
modelos ONNX entrarem vai ser preciso um service worker que os acrescente (como o
coi-serviceworker), ou o ONNX Runtime vai rodar numa thread só.

## Rodar

Nesta pasta:

```sh
npm install              # uma vez
npm run build            # compila o jatai.wasm, faz o typecheck e gera dist/
npm run server:build     # uma vez: compila server.exe
npm run live             # compila, observa mudanças e serve em http://localhost:8090/
```

| script                 | o que faz                                                           |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run dev`          | servidor de desenvolvimento do Vite (http://localhost:5174/)        |
| `npm run jatai:wasm`   | só recompila `public/jatai.wasm` a partir de `../jatai_lang` |
| `npm run typecheck`    | só o typecheck                                                      |
| `npm run server`       | só o servidor, servindo `dist/` na porta 8090                       |

## Jatai na página

Scripts Jatai rodam dentro do editor, sem DLL nenhuma: as bibliotecas são respondidas pela
própria página. **Menu > Script > Abrir o editor de scripts** abre o editor numa guia
própria do navegador (`script.html`), com a tela toda para escrever:

- **realce de sintaxe** e números de linha; Enter mantém o recuo (e recua mais depois de
  `if`, `for`, `fn`...), Tab / Shift+Tab recuam, Backspace no recuo volta um nível;
- **scripts salvos** no navegador, na lista à esquerda: `+ Novo`, renomear (clique no
  nome, no alto), Excluir, `Abrir .jat` e `Baixar .jat`. Tudo salva sozinho; Ctrl+S também;
- **Rodar** (Ctrl+Enter) manda o script para a guia do editor de vídeo, que roda no trabalho
  aberto e devolve a saída. Um erro vira link para a linha, e a linha fica marcada. Com dois
  trabalhos abertos em guias diferentes, escolhe-se em qual rodar;
- o próprio **Menu > Script** lista os scripts salvos, para rodar um direto, sem abrir a
  outra guia.

As duas guias conversam por um `BroadcastChannel` (`src/jatai/canal.ts`): a do vídeo
(`src/jatai/ponte.ts`) é quem roda, porque é lá que está a linha do tempo.

O script **não coloca nem tira nada da linha do tempo**: quem monta é você, à mão. Ele só
anima o que já está lá, chamando cada elemento por um id que você dá com o **botão
direito**:

no **clipe**, na linha do tempo → **Atribuir id para scripts** (foto, vídeo, música ou texto).

O id é do clipe, e não do arquivo: a mesma foto colocada duas vezes na linha do tempo são
dois elementos, cada um com o seu id (`gato`, `gato2`) e a sua animação. Um clipe dividido
com a tesoura continua com o id nas duas metades (é a mesma cena; o script usa a que está
no instante do relógio), e um clipe colado nasce sem id. O id aparece como etiqueta no
clipe e é salvo com o projeto; projetos antigos, que davam o id ao arquivo, passam esse id
para os clipes do arquivo ao abrir.

```
import editor
import time

fn girar(id, graus, segundos)      # funcao sem tipos: eles vem de quem chama
    inicio = editor.rotation(id)   # giro atual, em graus (int, como no painel)
    passos = int(segundos * 10.0)  # variavel sem tipo: int, deduzido do valor
    for i in range(passos)
        time.sleep(0.1)            # avanca 0.1 s no VIDEO (nao espera de verdade)
        editor.rotate(id, inicio + graus * (i + 1) / passos)

time.at(editor.start_of("gato"))   # o relogio vai para o comeco do clipe do gato
girar("gato", 30, 3.0)             # gira 30 graus em 3 segundos

editor.ease(true)                  # daqui em diante, movimento que comeca e termina devagar
time.sleep(2.0)
editor.rotate("gato", 0)
editor.zoom("gato", 150)           # zoom em %, como no painel

time.at(editor.start_of("trilha")) # a musica entra subindo o volume
editor.volume("trilha", -60.0)
time.sleep(2.0)
editor.volume("trilha", 0.0)

editor.color("titulo", "#f0b429")  # um texto com o id titulo
editor.font("titulo", "Bebas Neue")  # fonte pelo nome do painel Texto
```

- **O tempo do script é o tempo do vídeo.** `time.sleep(s)` avança o relógio do script e
  `time.at(s)` pula para um instante; `time.now()`, `time.elapsed()` seguem valendo. Os
  nomes são os do `time` do Jatai no computador (`jatai/library/time/time.jat`).
- **Tudo vira ponto de animação.** `zoom`, `move`, `rotate` (e `zoom_by`, `move_by`,
  `rotate_by`, que somam ao valor atual) gravam pontos no instante do relógio, os mesmos do
  painel Imagem; `volume`/`volume_by` gravam pontos na linha de volume. O editor caminha de
  um ponto ao outro, dá para ajustá-los à mão depois, e eles entram na exportação.
- **Os números são os do painel Imagem, inteiros como lá.** Zoom em %, posição em % a
  partir do centro da tela e giro em graus: `zoom("gato", 50)`, `move("gato", -30, 0)`,
  `rotate("gato", -180)` dão `Zoom 50, Posição -30 % X, 0 % Y, Rotação -180` no painel;
  `scale`, `pos_x`, `pos_y` e `rotation` devolvem essas mesmas medidas. O tamanho do texto
  (`size`) é em % da altura da tela, como no painel Texto.
- Se o mesmo arquivo está várias vezes na linha do tempo, vale o clipe que está no instante
  atual do relógio. Um Ctrl+Z desfaz o script inteiro.
- **Rodar de novo substitui, não soma.** Tudo o que um script cria ou muda fica marcado
  com o id dele no clipe; antes de rodar outra vez, o que ele fez da vez anterior é tirado
  (pontos criados por ele somem, pontos feitos à mão ou por outro script voltam ao valor
  de antes). **Tirar do vídeo**, na guia de scripts, faz só essa limpeza.
- A lista completa (leituras como `rotation`/`scale`/`pos_x`, cor e tamanho de texto,
  clipes, cesta...) está em `jatai/library/editor/editor.jat`.
- **Tipos são opcionais**, como no Jatai do computador: `giro = editor.rotation("gato")`
  cria uma variável `double`, e `fn nome(a, b)` define uma função sem tipos (cada
  combinação de tipos dos argumentos vira uma versão da função). Continua sendo tipagem
  estática: um erro de tipo aparece antes de o script mexer na linha do tempo.

Como funciona:

- **A VM é a mesma do `jatai.exe`.** `jatai/build-wasm.mjs` compila `../jatai_lang/main.c` e
  `../jatai_lang/src/*.h` para WebAssembly (`public/jatai.wasm`, ~135 KB) com o
  [@yowasp/clang](https://www.npmjs.com/package/@yowasp/clang), um clang que roda dentro
  do Node — não é preciso instalar compilador. No alvo `__wasm__` o `main.c` deixa de fora
  o `-build`, o `-lib` e a libffi, e usa `src/web.h`.
- **As funções `extern` são implementadas pela página.** Onde no Windows o Jatai
  carregaria uma DLL, na web ele chama a função importada `jatai.call`, e
  `src/jatai/jatai.ts` procura a função JavaScript do mesmo módulo e nome. As bibliotecas
  `editor` e `time` são declaradas em `jatai/library/*/` e implementadas em
  `src/jatai/editor-lib.ts`, sobre o `state` do editor.
- **Arquivos:** a VM é um programa WASI comum. `jatai.ts` tem um WASI mínimo (as 13
  funções que ela usa) sobre um sistema de arquivos em memória com o script e as
  bibliotecas.
- **Requisitos:** o parser usa `setjmp`, que no WebAssembly depende do suporte a exceções
  (Chrome/Edge 95+, Firefox 100+, Safari 15.2+).

`node --no-warnings jatai/testa-node.mjs exemplos/9_sieve.jat` roda um exemplo da
linguagem no `jatai.wasm` pelo Node, para comparar com o `jatai.exe` (o caminho é relativo
à pasta `jatai_lang/`). Ele usa o mesmo WASI mínimo da página, porque o WASI do próprio
Node não abre arquivos no Windows. Com `--simula`, roda um script do editor fora do
navegador: cada chamada de `editor.*`/`time.*` é mostrada e devolve um valor neutro
(`node --no-warnings jatai/testa-node.mjs --simula ../jatai_video/zoom_gato.jat`).

Ainda não funciona na web: as outras bibliotecas padrão (`text`, `file`...), que
precisariam de uma versão em JavaScript como a do `time`, e callbacks (`void(int) f`) em
funções extern.

O servidor de teste (`server.cpp`) segue o molde do `server.cpp` da raiz (live reload) e
acrescenta os cabeçalhos COOP/COEP, os tipos `.wasm`/`.onnx`/mídia e pedidos por faixa
(Range) — o que os modelos ONNX vão precisar.

Precisa de Chrome ou Edge recentes (WebCodecs). No Firefox e no Safari a importação e a
exportação caem nos caminhos simples (`<input type=file>` e download), e os arquivos
importados são copiados para o armazenamento do navegador em vez de lidos do disco.

## Fontes dos textos

A fonte de cada texto se escolhe no painel **Texto** (campo Fonte) e fica gravada no
projeto. As fontes **vêm dentro do programa** (pacotes `@fontsource`, licença OFL, listadas
em `src/ui/fontes.ts`), e não do sistema: o mesmo projeto sai igual no Windows, no Linux e
no Mac, na prévia e no vídeo exportado, e funciona sem internet. São 14: Inter (a padrão),
Roboto, Montserrat, Poppins, Oswald, Bebas Neue, Anton, Playfair Display, Lora,
Merriweather, Dancing Script, Pacifico, Permanent Marker e Roboto Mono. Para acrescentar
outra, instale o pacote `@fontsource` dela e ponha uma linha em `FONTES`.

## Plugins

Tarjas, contadores, marcas d'água, vinhetas: qualquer coisa que se desenhe por cima do
vídeo pode ser um plugin, sem mexer no editor. **Menu > Plugins > Adicionar pasta de
plugins** aceita a pasta de um plugin só (com o `manifest.json` nela) ou uma pasta que
contém vários, um por subpasta. **As pastas se somam**: adicionar a segunda não tira os
plugins da primeira, e cada uma pode ser tirada da lista no painel Plugins. No Chrome e no
Edge o navegador guarda o acesso a cada pasta: nas próximas vezes elas abrem sozinhas, ou
com um clique em **Reabrir**. No Firefox e no Safari é preciso escolher as pastas de novo
a cada sessão. A pasta [`plugins/`](plugins/) tem três exemplos: `tarja-apresentador`,
`contagem-regressiva` e `marca-dagua` (esta usa uma imagem da própria pasta).

```
meus-plugins/
  tarja-apresentador/
    manifest.json     nome, duração e os parâmetros que o painel mostra
    plugin.js         o desenho
    logo.png ...      imagens e fontes que o plugin usar (até 64 MB)
```

No painel **Plugins**, dois cliques num plugin o põem no cursor, e também dá para
arrastá-lo até a linha do tempo ou até a tela. Ele vira um clipe numa pista de vídeo:
empilha com fotos e vídeos pela ordem das pistas, corta, cola, desfaz e **sai na
exportação** exatamente como aparece na prévia. Com o clipe escolhido, o painel mostra os
campos do `manifest.json`.

**Filtros** (`"tipo": "filtro"` no manifest) são camadas de ajuste: um clipe numa pista de
vídeo que, durante o tempo dele, altera tudo o que está **abaixo** dele na pilha (cor, preto
e branco, desfoque, vinheta, fade...); o que está acima fica intacto. O filtro recebe a
imagem de baixo já montada e a devolve alterada, em Canvas 2D ou num shader GLSL que roda
na placa de vídeo (`api.shader`, WebGL2). Na prévia, as camadas de baixo são montadas num
canvas com as mesmas contas da exportação (`src/plugins/filtros.ts`); na exportação, o
filtro recebe o quadro como ele está até aquele ponto da pilha. Um filtro com `"alcance": "camada"` age só sobre a camada logo abaixo dele, e a saída, com
transparência, vai por cima do resto: é o **chroma key** (`plugins/chroma-key`), com um
**conta-gotas** para escolher a cor do fundo clicando na tela (parâmetro de cor com
`"contagotas": true`). Os exemplos estão em `plugins/` (`ajuste-de-cor`, `vinheta`,
`desfoque`, `fade`, `chroma-key`), e o guia completo em [`plugins/README.md`](plugins/README.md).

Posição, giro, tamanho e animação são os do painel **Imagem**, como numa foto: arraste o
plugin na tela, use as alças da moldura ou a roda, ou grave pontos de animação. O centro
do giro e do zoom é o centro do que o plugin desenhou, e não o da tela; o clique na tela só
pega o plugin onde ele desenhou, e no resto passa para a camada de baixo. Os scripts Jatai
também o movem (`editor.move`, `editor.rotate`, `editor.zoom`), pelo id do clipe. Depois de editar um `plugin.js`, use **Recarregar**: os clipes
que já estão na linha do tempo passam a usar o código novo.

**manifest.json**

```json
{
  "nome": "Tarja do apresentador",
  "descricao": "aparece ao passar o mouse",
  "duracao": 5,
  "parado": false,
  "params": [
    { "id": "nome",    "tipo": "texto",   "rotulo": "Nome", "padrao": "Maria Silva" },
    { "id": "cor1",    "tipo": "cor",     "rotulo": "Cor",  "padrao": "#b3122e" },
    { "id": "largura", "tipo": "numero",  "rotulo": "Largura", "min": 20, "max": 95, "padrao": 48, "unidade": "%" },
    { "id": "lado",    "tipo": "escolha", "rotulo": "Lado", "opcoes": ["esquerda", "direita"], "padrao": "esquerda" },
    { "id": "sombra",  "tipo": "sim_nao", "rotulo": "Sombra", "padrao": true }
  ]
}
```

- **Tipos de parâmetro:** `texto` (com `"linhas": 3`, vira uma caixa de várias linhas), `cor`,
  `numero` (com `min` e `max`, ganha um controle deslizante), `escolha` e `sim_nao`.
- **`parado: true`:** avisa que o desenho não muda com o tempo; a prévia desenha uma vez só.
- **`arquivo`:** troca o nome do código, que por padrão é `plugin.js`.

**plugin.js** (um módulo ES)

```js
export default {
  async init(api) {                       // opcional, roda uma vez ao abrir a pasta
    return { logo: await api.imagem("logo.png") };   // api.fonte("X.ttf", "X") registra uma fonte
  },
  render(ctx, { t, dur, progresso, w, h, params, dados }) {
    // ctx: CanvasRenderingContext2D de um quadro vazio (transparente), w x h pixels
    // t: segundos desde o começo do clipe; dur: duração; progresso = t / dur
    // params: os valores do painel; dados: o que init devolveu
    // opcional: return { x, y, w, h }  - a área desenhada, em pixels; sem isso ela é
    // medida pelos pixels não transparentes (é o centro do giro e o que a moldura abraça)
  },
};
```

Desenhe sempre em proporção de `w` e `h`. A prévia pede o quadro no tamanho da tela e a
exportação no tamanho do vídeo, e a mesma função atende as duas.

**Segurança.** O plugin roda num `<iframe sandbox>` de origem opaca, com a rede fechada
pela política de conteúdo (`src/plugins/sandbox.ts`). Ele não enxerga o editor, os
projetos, o IndexedDB nem os arquivos importados. Recebe só os próprios parâmetros e os
arquivos da pasta dele, e devolve a imagem pronta. Um plugin com laço infinito ainda pode
travar a página: é código de alguém, então abra só pastas em que você confia.

O projeto guarda só o id e os parâmetros de cada plugin; o código fica na pasta. Abrir o
projeto sem a pasta mostra um aviso no lugar do plugin, e a exportação avisa antes de
deixá-lo de fora.

## Como está organizado

```
index.html        a página (o esqueleto do ui/index.html original)
src/main.ts       importa o CSS e os módulos da interface, na ordem original
src/ui/           a interface do jat.ai, portada para módulos TypeScript
src/backend/      o que o C++ fazia, agora com APIs do navegador
src/plugins/      a pasta de plugins, o sandbox e a camada deles na prévia
plugins/          plugins de exemplo (abra esta pasta pelo Menu > Plugins)
server.cpp        servidor de teste local
```

A interface conversa com o backend pelo mesmo objeto `api` de antes: cada função de
`src/backend/index.ts` é a irmã de um bind `jt*` do `app.h`, com os mesmos argumentos e
as mesmas respostas.

| C++ (app.h e cia.)            | navegador (src/backend)                              |
| ----------------------------- | ---------------------------------------------------- |
| FFmpeg: probe, FrameReader    | mediabunny + WebCodecs (`midia.ts`, `quadros.ts`)    |
| miniaudio + mistura em thread | Web Audio, agendado bloco a bloco (`som.ts`)         |
| picos da onda, pausas         | `onda.ts` (mesmo resumo e mesma régua de nível)      |
| projetos em %APPDATA%         | IndexedDB (`projetos.ts`)                            |
| config.ini                    | localStorage (`prefs.ts`)                            |
| caminhos de arquivo           | chaves + FileSystemFileHandle no IndexedDB (`arquivos.ts`) |
| exportar (x264/NVENC + AAC)   | mediabunny: H.264 + AAC via WebCodecs (`exportar.ts`) |

A interface ainda está com tipagem frouxa (`strict: false` no `tsconfig.json` desta pasta,
e `dom-solto.d.ts`): ela veio de JavaScript e foi convertida sem mudar comportamento. O
backend já é tipado.

## O que ainda não veio do C++

- **Remover o fundo** (RVM), **narrador** (Piper + espeak-ng) e **reconhecedor de fala**
  (Silero VAD): dependem de modelos ONNX; o caminho é o ONNX Runtime Web. Hoje os painéis
  dizem que ainda não estão disponíveis, e o corte na voz usa a régua de nível na própria
  mistura.
- **Separar a voz**: era um programa à parte (nsound-separate).
