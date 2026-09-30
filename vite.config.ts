import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// O ecossistema fica lado a lado nesta pasta:
//
//   index.html + src/   o hub (e o i18n, o tema e o seletor de idioma, que as
//                       ferramentas tambem usam)
//   jatai_image/        editor de design - entra neste build
//   jatai_video/        editor de video - projeto independente, com package.json
//                       e build proprios (npm run build chama o dele, que escreve
//                       em dist/jatai_video)
//   jatai_lang/         a linguagem Jatai - so local, fora do git
//
// Uma ferramenta nova que use o i18n do hub entra aqui, como o jatai_image.
export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        hub: resolve(import.meta.dirname, 'index.html'),
        image: resolve(import.meta.dirname, 'jatai_image/index.html'),
      },
    },
  },
});
