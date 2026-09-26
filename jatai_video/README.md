# jat.ai no navegador — editor de vídeo

Porte do editor de vídeo jat.ai (C++ com WebView2, em `C:\Users\jpp\Desktop\jatai_video`)
para TypeScript, para rodar no navegador. É um projeto à parte dentro do hub: página,
código, configuração e servidor próprios, sem mistura com o `canvas/`.

No hub ele é o card **Editor de vídeo** e fica em `/jatai_video/`. O build de produção
(`npm run build`, que vai para o GitHub Pages) inclui esta página e roda também o
typecheck desta pasta. Para desenvolver, use os scripts abaixo, que usam a configuração e
o servidor próprios da pasta.

O GitHub Pages não manda os cabeçalhos COOP/COEP. Hoje nada depende deles, mas quando os
modelos ONNX entrarem vai ser preciso um service worker que os acrescente (como o
coi-serviceworker), ou o ONNX Runtime vai rodar numa thread só.

## Rodar

Na raiz do repositório:

```sh
npm run video:server:build   # uma vez: compila jatai_video/server.exe
npm run video:live           # compila a página, observa mudanças e serve em http://localhost:8090/
```

Outros scripts:

| script                  | o que faz                                                     |
| ----------------------- | ------------------------------------------------------------- |
| `npm run video:dev`     | servidor de desenvolvimento do Vite (http://localhost:5174/)  |
| `npm run video:build`   | typecheck + build em `jatai_video/dist`                       |
| `npm run video:typecheck` | só o typecheck desta pasta                                  |
| `npm run video:server`  | só o servidor, servindo `jatai_video/dist` na porta 8090      |

O servidor de teste (`server.cpp`) segue o molde do `server.cpp` da raiz (live reload) e
acrescenta os cabeçalhos COOP/COEP, os tipos `.wasm`/`.onnx`/mídia e pedidos por faixa
(Range) — o que os modelos ONNX vão precisar.

Precisa de Chrome ou Edge recentes (WebCodecs). No Firefox e no Safari a importação e a
exportação caem nos caminhos simples (`<input type=file>` e download), e os arquivos
importados são copiados para o armazenamento do navegador em vez de lidos do disco.

## Como está organizado

```
index.html        a página (o esqueleto do ui/index.html original)
src/main.ts       importa o CSS e os módulos da interface, na ordem original
src/ui/           a interface do jat.ai, portada para módulos TypeScript
src/backend/      o que o C++ fazia, agora com APIs do navegador
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
- Como no C++, os textos da linha do tempo ainda não entram no vídeo exportado.
