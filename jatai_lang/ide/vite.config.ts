import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// A plataforma da linguagem Jatai: um editor no molde do VS Code que roda os
// programas no proprio navegador (a VM do Jatai compilada para WebAssembly).
//
// E um projeto a parte, como o jatai_video: localmente sai em ide/dist, na raiz
// do servidor de teste (npm run live, porta 8091); para o GitHub Pages, o build
// da raiz do hub chama `npm run build:hub`, que troca a base para /jatai_lang/.
//
// Os cabecalhos de isolamento dao SharedArrayBuffer a pagina: e com ele que o
// programa rodando espera o que se digita no terminal. No GitHub Pages, que nao
// os manda, quem os poe e o public/coi-sw.js.
const isolamento = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  publicDir: resolve(import.meta.dirname, 'public'),
  server: {
    port: 5175,
    headers: isolamento,
    // a biblioteca padrao e os exemplos vem de ../library e ../exemplos
    fs: { allow: [resolve(import.meta.dirname, '..')] },
  },
  preview: { headers: isolamento },
  worker: { format: 'es' },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    // o Monaco sozinho passa de 2 MB; ele e a pagina, entao o aviso nao ajuda
    chunkSizeWarningLimit: 4096,
  },
});
