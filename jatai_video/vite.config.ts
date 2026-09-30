import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// O editor de video e um projeto a parte dentro do hub: pagina, codigo e
// build proprios. Localmente sai em jatai_video/dist, na raiz do servidor de
// teste (npm run live, porta 8090). Para o GitHub Pages, o build da raiz chama
// `npm run build:hub`, que troca a base para /jatai_video/ e escreve em
// ../dist/jatai_video.
//
// Os cabecalhos de isolamento (COOP/COEP) liberam SharedArrayBuffer, de que o
// ONNX Runtime precisa para rodar em varias threads - o recorte de fundo, a
// deteccao de fala e o narrador vao depender disso. O servidor de teste
// (jatai_video/server.cpp) manda os mesmos cabecalhos.
const isolamento = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  // O logo e os icones (copiados do hub) e o jatai.wasm gerado por jatai/build-wasm.mjs.
  publicDir: resolve(import.meta.dirname, 'public'),
  server: { port: 5174, headers: isolamento },
  preview: { headers: isolamento },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // duas paginas: o editor de video e o editor de scripts, que abre numa guia propria
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        script: resolve(import.meta.dirname, 'script.html'),
      },
    },
  },
});
