// dock-tree.ts - a arvore do layout: abrir, fechar e acoplar paineis

// ------------------------------------------------------ arvore: utilidades

import { clamp } from "./core";
import { layout, setLayout } from "./panels";
import { render } from "./dock-view";
import { saveLayout } from "./prefs";

export function walk(node?, fn?, parent?) {
  fn(node, parent);
  if (node.t === "split") node.kids.forEach((k) => walk(k, fn, node));
}

export function parentOf(node?) {
  let found = null;
  walk(layout, (n, p) => { if (n === node) found = p; });
  return found;
}

export function panelWith(id?) {
  let found = null;
  walk(layout, (n) => { if (n.t === "tabs" && n.ids.includes(id)) found = n; });
  return found;
}

export function nodeByKey(key?) {
  let found = null;
  walk(layout, (n) => { if (n.t === "tabs" && n.key === key) found = n; });
  return found;
}

export function openIds() {
  const out = [];
  walk(layout, (n) => { if (n.t === "tabs") out.push(...n.ids); });
  return out;
}

// Tira um no da arvore e reparte a fracao que ele ocupava entre os irmaos,
// para o espaco nao sumir nem sobrar.
export function detach(node?) {
  const parent = parentOf(node);
  if (!parent) return;
  const i = parent.kids.indexOf(node);
  if (i < 0) return;
  parent.kids.splice(i, 1);
  const share = parent.sizes.splice(i, 1)[0] || 0;
  if (parent.sizes.length) {
    const total = parent.sizes.reduce((a, b) => a + b, 0) || 1;
    parent.sizes = parent.sizes.map((s) => s + (share * s) / total);
  }
  collapse(parent);
}

// Uma divisao com um filho so nao divide nada: some e da lugar ao filho.
export function collapse(split?) {
  if (!split || split.t !== "split" || split.kids.length > 1) return;
  const parent = parentOf(split);
  if (split.kids.length === 1) {
    const only = split.kids[0];
    if (!parent) { setLayout(only); return; }
    parent.kids[parent.kids.indexOf(split)] = only;
    collapse(parent);
  } else if (parent) {
    detach(split);
  } else {
    setLayout({ t: "tabs", ids: [], active: "" });
  }
}

// O grupo que ficou sem abas sai do caminho.
export function dropIfEmpty(node?) {
  if (!node || node.ids.length) return;
  if (node === layout) setLayout({ t: "tabs", ids: [], active: "" });
  else detach(node);
}

export function closeTab(id?) {
  const node = panelWith(id);
  if (!node) return;
  node.ids = node.ids.filter((x) => x !== id);
  if (node.active === id) node.active = node.ids[0] || "";
  dropIfEmpty(node);
  render();
  saveLayout();
}

// Abre um painel fechado. Ele vai para o grupo de abas com mais area na tela:
// aparecer num canto de 40px nao ajudaria ninguem.
export function openTab(id?) {
  if (panelWith(id)) { focusTab(id); return; }
  let best = null, bestArea = -1;
  walk(layout, (n) => {
    if (n.t !== "tabs" || !n.ids.length) return;
    const el = document.querySelector('.panel[data-key="' + n.key + '"]');
    const area = el ? el.clientWidth * el.clientHeight : 0;
    if (area > bestArea) { bestArea = area; best = n; }
  });
  if (!best) setLayout({ t: "tabs", ids: [id], active: id });
  else { best.ids.push(id); best.active = id; }
  render();
  saveLayout();
}

export function focusTab(id?) {
  const node = panelWith(id);
  if (!node) return;
  node.active = id;
  render();
  saveLayout();
}

// Acopla `id` no grupo alvo. `zone` diz se ele vira mais uma aba do grupo
// (center/tab) ou se parte o alvo em dois (left/right/top/bottom).
export function dockTab(id?, target?, zone?, tabIndex?) {
  const from = panelWith(id);
  // Painel sozinho largado nele mesmo: nada muda, e sem esta saida ele se
  // dividiria consigo proprio.
  if (from === target && zone !== "tab" && zone !== "center" && from.ids.length === 1) return;

  if (from) {
    from.ids = from.ids.filter((x) => x !== id);
    if (from.active === id) from.active = from.ids[0] || "";
  }

  if (zone === "center" || zone === "tab") {
    const at = tabIndex == null ? target.ids.length
                                : clamp(tabIndex, 0, target.ids.length);
    target.ids.splice(at, 0, id);
    target.active = id;
  } else {
    const dir = (zone === "left" || zone === "right") ? "row" : "col";
    const before = (zone === "left" || zone === "top");
    const fresh = { t: "tabs", ids: [id], active: id };
    const parent = parentOf(target);

    if (parent && parent.dir === dir) {
      // Mesmo sentido do pai: entra como irmao e divide a fatia do alvo, em
      // vez de criar mais um nivel de aninhamento.
      const i = parent.kids.indexOf(target);
      const share = parent.sizes[i];
      parent.kids.splice(before ? i : i + 1, 0, fresh);
      parent.sizes.splice(before ? i : i + 1, 0, share * 0.4);
      parent.sizes[before ? i + 1 : i] = share * 0.6;
    } else {
      const split = { t: "split", dir, sizes: before ? [0.4, 0.6] : [0.6, 0.4],
                      kids: before ? [fresh, target] : [target, fresh] };
      if (!parent) setLayout(split);
      else parent.kids[parent.kids.indexOf(target)] = split;
    }
  }

  if (from && from !== target) dropIfEmpty(from);
  render();
  saveLayout();
}
