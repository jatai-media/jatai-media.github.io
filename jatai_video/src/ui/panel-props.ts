// panel-props.ts - painel de propriedades

// ================================================ conteudo: propriedades

import { pickedClips, fmtTime, fmtSize, state } from "./core";
import { ratioText } from "./panel-player";
import { isText } from "./texto";
import { projectEnd } from "./panel-timeline";

export function renderProps(body?) {
  const clip = state.clips.find((c) => c.id === state.pickedClip);
  const media = state.media.find((m) => m.id === state.pickedMedia);

  const rows = [
    ["section", "Projeto"],
    ["Duracao", fmtTime(projectEnd())],
    ["Pistas", String(state.tracks.length)],
    ["Itens de midia", String(state.media.length)],
    ["Area de visao", state.canvas.w + " x " + state.canvas.h +
                      "  (" + ratioText(state.canvas.w, state.canvas.h) + ")"],
    ["Posicao", fmtTime(state.pos, true)],
  ];

  if (clip && state.picked.size > 1) {
    // Com varios escolhidos nao ha o que dizer de um so; o que interessa e
    // quanto foi cercado, e quanto tempo isso da.
    const sel = pickedClips();
    const total = sel.reduce((a, c) => a + c.len, 0);
    rows.push(["section", "Selecao"],
              ["Clipes", String(sel.length)],
              ["Duracao somada", fmtTime(total, true)],
              ["Principal", clip.name]);
  } else if (clip) {
    rows.push(["section", "Clipe selecionado"],
              ["Nome", clip.name],
              ["Tipo", clip.kind],
              ["Inicio", fmtTime(clip.start, true)],
              ["Duracao", fmtTime(clip.len, true)],
              ["Na montagem", clip.off ? "nao - descartado" : "sim"]);
    if (isText(clip)) {
      const t = clip.texto;
      rows.push(["Na tela", Math.round(t.x * 100) + "% x " + Math.round(t.y * 100) + "%"],
                ["Altura da letra", Math.round(t.tam * 100) + "% do quadro"]);
    }
  } else if (media) {
    rows.push(["section", "Midia selecionada"],
              ["Nome", media.name],
              ["Tipo", media.kind + (media.ext ? " / " + media.ext : "")],
              ["Tamanho", fmtSize(media.bytes)]);
    if (media.duration > 0) rows.push(["Duracao", fmtTime(media.duration, true)]);
    if (media.width) rows.push(["Imagem", media.width + " x " + media.height]);
    if (media.fps > 0) rows.push(["Cadencia", media.fps.toFixed(2) + " fps"]);
    if (media.vcodec) rows.push(["Video", media.vcodec]);
    if (media.acodec) rows.push(["Audio", media.acodec]);
    if (media.error) rows.push(["Problema", media.error]);
    rows.push(["Caminho", media.path]);
  }

  const frag = document.createDocumentFragment();
  rows.forEach(([k, v]) => {
    const el = document.createElement("div");
    if (k === "section") {
      el.className = "section";
      el.textContent = v;
    } else {
      el.className = "prop";
      el.innerHTML = '<span class="k"></span><span class="v"></span>';
      el.querySelector(".k").textContent = k;
      const val = el.querySelector(".v");
      val.textContent = v;
      val.title = v;
    }
    frag.appendChild(el);
  });

  if (!clip && !media) {
    const e = document.createElement("div");
    e.className = "section";
    e.textContent = "Nada selecionado";
    frag.appendChild(e);
  }
  body.appendChild(frag);
}
