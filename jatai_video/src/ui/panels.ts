// panels.ts - catalogo de paineis e o layout de fabrica

// ====================================================== catalogo de paineis
//
// Cada painel so sabe se desenhar dentro do corpo que recebe. Quem os move e
// fecha e o dock, logo abaixo; daqui eles nao sabem onde estao.

// A ordem daqui e a ordem das abas: e ela que o menu de paineis segue, e e
// por ela que um painel novo sabe onde entrar num layout que ja existia.
import { render } from "./dock-view";
import { renderMedia } from "./panel-media";
import { renderPlayer } from "./panel-player";
import { renderAudio } from "./panel-audio";
import { renderProps } from "./panel-props";
import { renderImagem } from "./panel-imagem";
import { renderTexto } from "./texto";
import { renderNarrador } from "./panel-narrador";
import { renderEfeitos } from "./panel-efeitos";
import { renderTimeline } from "./panel-timeline";

export const PANELS = {
  media:    { title: "Midia",          render: renderMedia },
  imagem:   { title: "Imagem",         render: renderImagem },
  audio:    { title: "Audio",          render: renderAudio },
  texto:    { title: "Texto",          render: renderTexto },
  narrador: { title: "Narrador",       render: renderNarrador },
  efeitos:  { title: "Efeitos",        render: renderEfeitos },
  props:    { title: "Propriedades",   render: renderProps },
  player:   { title: "Reprodutor",     render: renderPlayer },
  timeline: { title: "Linha do tempo", render: renderTimeline },
};

// Layout inicial: a cesta de midia a esquerda, o reprodutor no meio, os
// ajustes do que esta escolhido a direita, e a linha do tempo na faixa de
// baixo. Os ajustes ficam todos no mesmo grupo porque sao a mesma pergunta
// feita de cinco maneiras: o que fazer com esta peca.
export function defaultLayout() {
  return {
    t: "split", dir: "col", sizes: [0.62, 0.38],
    kids: [
      { t: "split", dir: "row", sizes: [0.20, 0.52, 0.28],
        kids: [
          { t: "tabs", ids: ["media"], active: "media" },
          { t: "tabs", ids: ["player"], active: "player" },
          { t: "tabs", ids: ["imagem", "audio", "texto", "efeitos", "props"],
            active: "imagem" },
        ] },
      { t: "tabs", ids: ["timeline"], active: "timeline" },
    ],
  };
}

// `any`: a arvore mistura dois tipos de no, e quem a percorre ja pergunta `t`.
export let layout: any = defaultLayout();
export function setLayout(v?) { layout = v; }
