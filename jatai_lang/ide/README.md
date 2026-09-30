# Plataforma Jatai (ide/)

Editor da linguagem Jatai no navegador, no molde do VS Code: explorador de arquivos,
abas, o editor Monaco (o mesmo do VS Code), terminal, painel de problemas. No hub fica em
`/jatai_lang/`.

Os programas rodam **no próprio navegador**: a VM do Jatai (`../main.c` e `../src`) é
compilada para WebAssembly (`public/jatai.wasm`) e roda num Web Worker.

## Rodar

```sh
npm install            # uma vez
npm run server:build   # uma vez: compila server.exe
npm run live           # compila, observa mudanças e serve em http://localhost:8091/
```

| script              | o que faz                                                    |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | servidor de desenvolvimento do Vite (http://localhost:5175/) |
| `npm run wasm`      | só recompila o `public/jatai.wasm`                           |
| `npm run build`     | wasm + typecheck + build em `dist/`                          |
| `npm run build:hub` | o mesmo, com base `/jatai_lang/`, em `../../dist/jatai_lang` |

## Como funciona

- `src/executor.worker.ts` — um WASI mínimo (as 13 funções que a VM importa) sobre os
  arquivos do projeto; cada chamada `extern` chega em `jatai.call`.
- `src/bibliotecas.ts` — `text`, `io`, `file`, `time` e `voz` em JavaScript, com as mesmas
  regras das versões C++. `iliv` e `http` só existem no Jatai instalado.
- **Entrada interativa:** com a página isolada (COOP/COEP), o worker espera o que se digita
  no terminal com `Atomics.wait`. No GitHub Pages, que não manda esses cabeçalhos, quem os
  acrescenta é `public/coi-sw.js`. Sem isolamento, a entrada vem do painel Entrada.
- **Erros enquanto se digita:** um segundo worker roda `jatai -check` a cada pausa, e as
  mensagens `arquivo:linha:coluna` viram marcas no editor.
- O projeto fica no `localStorage`; o botão *Baixar o projeto* gera um `.zip`.
