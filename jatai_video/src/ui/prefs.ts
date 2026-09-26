// prefs.ts - o layout indo e voltando do config.ini

// ========================================================= persistencia

import { api, clamp, state } from "./core";
import { PANELS, defaultLayout, layout, setLayout } from "./panels";
import { walk, panelWith, openIds } from "./dock-tree";
import { render } from "./dock-view";
import { CANVAS_MIN, CANVAS_MAX } from "./panel-player";

export let saveTimer = null;
export function saveLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.setPref("layout", JSON.stringify(strip(layout)));
  }, 400);
}

// A chave usada para achar o painel no DOM nao interessa ao disco.
export function strip(node?) {
  if (node.t === "split")
    return { t: "split", dir: node.dir, sizes: node.sizes.slice(),
             kids: node.kids.map(strip) };
  return { t: "tabs", ids: node.ids.slice(), active: node.active };
}

// Layout salvo por uma versao anterior pode citar paineis que nao existem
// mais: aceitamos o que da e descartamos o resto.
export function sanitize(node?) {
  if (!node || typeof node !== "object") return null;
  if (node.t === "split") {
    const kids = (node.kids || []).map(sanitize).filter(Boolean);
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    const sizes = (Array.isArray(node.sizes) ? node.sizes : []).slice(0, kids.length);
    while (sizes.length < kids.length) sizes.push(1 / kids.length);
    const sum = sizes.reduce((a, b) => a + b, 0) || 1;
    return { t: "split", dir: node.dir === "col" ? "col" : "row",
             sizes: sizes.map((s) => s / sum), kids };
  }
  const ids = (node.ids || []).filter((id) => PANELS[id]);
  if (!ids.length) return null;
  return { t: "tabs", ids, active: ids.includes(node.active) ? node.active : ids[0] };
}

// Os ajustes do corte nos silencios vao e voltam inteiros, numa chave so -
// sao tres numeros, e separa-los em tres chaves so daria trabalho de leitura.
export let hushTimer = null;
export function saveHush() {
  clearTimeout(hushTimer);
  hushTimer = setTimeout(() => api.setPref("hush", JSON.stringify(state.hush)), 400);
}

export function loadHush(text?) {
  if (!text) return;
  try {
    const v = JSON.parse(text);
    if (typeof v.min === "number") state.hush.min = clamp(v.min, 0.05, 5);
    if (typeof v.db === "number") state.hush.db = clamp(v.db, -70, -12);
    if (typeof v.pad === "number") state.hush.pad = clamp(v.pad, 0, 0.5);
    if (typeof v.sens === "number") state.hush.sens = clamp(v.sens, 0.05, 0.95);
  } catch (e) { /* ajuste corrompido: ficam os de fabrica */ }
}

// A area de visao vai numa chave so, no formato "largura x altura". Nao e
// preferencia de quem usa, e sim do trabalho em curso: quem monta para o
// celular a semana inteira nao deve reabrir o programa em 16:9.
export let canvasTimer = null;
export function saveCanvas() {
  clearTimeout(canvasTimer);
  canvasTimer = setTimeout(
      () => api.setPref("canvas", state.canvas.w + "x" + state.canvas.h), 400);
}

export function loadCanvas(text?) {
  if (!text) return;
  const [w, h] = String(text).split("x").map(Number);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return;
  state.canvas.w = clamp(Math.round(w), CANVAS_MIN, CANVAS_MAX);
  state.canvas.h = clamp(Math.round(h), CANVAS_MIN, CANVAS_MAX);
}

// Um painel novo nao existe no layout salvo ontem. Sem isto, so o veria quem
// restaurasse o layout - ou seja, quem perdesse o seu. A lista dos paineis que
// ja apareceram uma vez fica no disco; quem nunca apareceu entra junto dos
// outros ajustes, e o grupo que o recebe passa a seguir a ordem do catalogo,
// para as abas nao ficarem embaralhadas por acidente de historia.
//
// So se adota o que nunca foi visto: painel que o usuario fechou continua
// fechado - reabri-lo a cada arranque seria teimosia, e nao ajuda.
//
// A chave e numerada de proposito. A primeira versao disto errava o alvo:
// tratava "nao ha lista" como instalacao nova, quando e exatamente o estado de
// quem ja usava o programa - e, pior, gravava a lista assim mesmo, de modo que
// o painel novo perdia a unica chance de entrar. Mudar o nome da chave faz a
// passagem valer de novo para quem passou por aquela versao.
export const PANEL_KEY = "paineisVistos2";

export function adoptNewPanels(text?, temLayoutSalvo?) {
  const catalogo = Object.keys(PANELS);

  // Instalacao nova: o layout de fabrica ja traz tudo o que existe, e o que se
  // guarda e so a lista. Quem diz isso e a ausencia de LAYOUT - nao a da
  // lista, que qualquer versao anterior a esta tambem nao tinha.
  if (!temLayoutSalvo) { api.setPref(PANEL_KEY, catalogo.join(",")); return; }

  const vistos = new Set(String(text || "").split(",").filter(Boolean));
  const abertos = new Set(openIds());
  const novos = catalogo.filter((id) => !vistos.has(id) && !abertos.has(id));
  if (!novos.length) { api.setPref(PANEL_KEY, catalogo.join(",")); return; }

  // A casa deles e o grupo dos ajustes - o que tem as Propriedades. Nao
  // havendo, vale o primeiro grupo que existir.
  let alvo = panelWith("props");
  if (!alvo) walk(layout, (n) => { if (!alvo && n.t === "tabs" && n.ids.length) alvo = n; });

  novos.forEach((id) => {
    if (!alvo) { setLayout({ t: "tabs", ids: [id], active: id }); alvo = layout; return; }
    alvo.ids.push(id);
  });

  if (alvo) {
    alvo.ids.sort((x, y) => catalogo.indexOf(x) - catalogo.indexOf(y));
    alvo.active = novos[0];
  }

  saveLayout();
  api.setPref(PANEL_KEY, catalogo.join(","));
}

export function resetLayout() {
  setLayout(defaultLayout());
  render();
  saveLayout();
}
