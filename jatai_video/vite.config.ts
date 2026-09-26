import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// O editor de video e um projeto a parte dentro do hub: pagina, codigo e
// build proprios, em jatai_video/dist. Por enquanto ele roda so localmente
// (npm run video:live) e nao entra no build que vai para o GitHub Pages.
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
  // O logo e os icones sao os mesmos do hub.
  publicDir: resolve(import.meta.dirname, '../public'),
  server: { port: 5174, headers: isolamento },
  preview: { headers: isolamento },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
