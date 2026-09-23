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
      },
    },
  },
});
