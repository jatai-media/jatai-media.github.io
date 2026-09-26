import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Cada ferramenta do hub é uma página própria. Ao adicionar uma nova,
// registre o HTML dela aqui.
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        hub: resolve(import.meta.dirname, 'index.html'),
        canvas: resolve(import.meta.dirname, 'canvas/index.html'),
        // O editor de video e um projeto a parte, com config propria para
        // testes locais (jatai_video/vite.config.ts); aqui ele so entra no build.
        video: resolve(import.meta.dirname, 'jatai_video/index.html'),
      },
    },
  },
});
