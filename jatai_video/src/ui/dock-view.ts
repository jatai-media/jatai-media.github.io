// dock-view.ts - desenha a arvore, arrasta as abas e redesenha um painel so

// ---------------------------------------------------------------- desenho

import { $, clamp, capture, fmtTime, state } from "./core";
import { PANELS, layout } from "./panels";
import { panelWith, nodeByKey, closeTab, dockTab } from "./dock-tree";
import { saveLayout, strip } from "./prefs";

export let keySeq = 0;

export function render() {
  const dock = $("dock");
  dock.innerHTML = "";
  if (layout.t === "tabs" && !layout.ids.length) {
    dock.innerHTML = '<div class="empty" style="flex:1 1 auto">' +
      '<b>Nenhum painel aberto</b>' +
      '<div class="hint">Use o menu Paineis, ali em cima, para trazer um de volta.</div></div>';
  } else {
    dock.appendChild(buildNode(layout));
  }
  renderStatus();
}

export function buildNode(node?) {
  return node.t === "split" ? buildSplit(node) : buildPanel(node);
}

export function buildSplit(node?) {
  const el = document.createElement("div");
  el.className = "split node " + node.dir;
  node.kids.forEach((kid, i) => {
    if (i) el.appendChild(makeSplitter(node, i - 1, el));
    const kidEl = buildNode(kid);
    kidEl.classList.add("node");
    kidEl.style.flex = (node.sizes[i] || 1) + " 1 0";
    el.appendChild(kidEl);
  });
  return el;
}

// Puxar o divisor mexe so nas duas fatias vizinhas, direto no estilo: um
// redesenho por quadro perderia a rolagem e a selecao dentro dos paineis.
export function makeSplitter(node?, i?, parentEl?) {
  const sp = document.createElement("div");
  sp.className = "splitter";
  sp.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    capture(sp, e.pointerId);
    sp.classList.add("dragging");

    const row = node.dir === "row";
    const kids = [...parentEl.children].filter((c) => !c.classList.contains("splitter"));
    const a = kids[i], b = kids[i + 1];
    const startA = row ? a.offsetWidth : a.offsetHeight;
    const span = startA + (row ? b.offsetWidth : b.offsetHeight);
    const origin = row ? e.clientX : e.clientY;
    const sum = node.sizes[i] + node.sizes[i + 1];
    const minPx = 110;

    const move = (ev) => {
      const d = (row ? ev.clientX : ev.clientY) - origin;
      const pxA = clamp(startA + d, Math.min(minPx, span / 2),
                        Math.max(minPx, span - minPx));
      const fa = sum * (pxA / span);
      node.sizes[i] = fa;
      node.sizes[i + 1] = sum - fa;
      a.style.flex = fa + " 1 0";
      b.style.flex = (sum - fa) + " 1 0";
    };
    const up = () => {
      sp.classList.remove("dragging");
      sp.removeEventListener("pointermove", move);
      sp.removeEventListener("pointerup", up);
      saveLayout();
    };
    sp.addEventListener("pointermove", move);
    sp.addEventListener("pointerup", up);
  });
  return sp;
}

export function buildPanel(node?) {
  node.key = node.key || "p" + (++keySeq);

  const el = document.createElement("div");
  el.className = "panel";
  el.dataset.key = node.key;

  const strip = document.createElement("div");
  strip.className = "tabstrip";

  node.ids.forEach((id) => {
    const def = PANELS[id];
    if (!def) return;
    const tab = document.createElement("div");
    tab.className = "tab" + (node.active === id ? " on" : "");
    tab.dataset.id = id;
    tab.innerHTML = '<span class="label"></span>' +
                    '<button class="x" title="Fechar painel">&times;</button>';
    tab.querySelector(".label").textContent = def.title;

    const x = tab.querySelector(".x");
    x.addEventListener("pointerdown", (e) => e.stopPropagation());
    x.addEventListener("click", (e) => { e.stopPropagation(); closeTab(id); });

    tab.addEventListener("pointerdown", (e) => beginTabDrag(e, id, node, tab));
    strip.appendChild(tab);
  });

  const fill = document.createElement("div");
  fill.className = "fill";
  strip.appendChild(fill);
  el.appendChild(strip);

  const body = document.createElement("div");
  body.className = "panel-body";
  el.appendChild(body);

  const def = PANELS[node.active];
  if (def) def.render(body);
  return el;
}

// ------------------------------------------- arrastar abas entre os grupos

export let drag = null;

export function beginTabDrag(e?, id?, node?, tabEl?) {
  if (e.button !== 0) return;
  e.preventDefault();

  // So vira arrasto depois de sair do lugar: um clique curto apenas troca de
  // aba, e e assim que a maioria dos cliques termina.
  const startX = e.clientX, startY = e.clientY;
  let armed = false;

  const move = (ev) => {
    if (!armed) {
      if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
      armed = true;
      tabEl.classList.add("dragging");
      document.body.classList.add("dragging-tab");

      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = PANELS[id].title;
      document.body.appendChild(ghost);

      const zone = document.createElement("div");
      zone.className = "dropzone";
      zone.style.display = "none";
      document.body.appendChild(zone);

      drag = { id, ghost, zone, target: null, zoneName: "", index: null };
    }
    drag.ghost.style.left = (ev.clientX + 12) + "px";
    drag.ghost.style.top = (ev.clientY + 14) + "px";
    updateDropTarget(ev.clientX, ev.clientY);
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!armed) {
      if (node.active !== id) { node.active = id; render(); saveLayout(); }
      return;
    }
    tabEl.classList.remove("dragging");
    document.body.classList.remove("dragging-tab");
    const d = drag;
    drag = null;
    d.ghost.remove();
    d.zone.remove();
    if (d.target && d.zoneName) dockTab(d.id, d.target, d.zoneName, d.index);
    else render();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// Que painel esta sob o ponteiro, e em que parte dele: e esta resposta que
// decide se a aba vira vizinha das outras ou parte o painel em dois.
export function updateDropTarget(x?, y?) {
  const dockRect = $("dock").getBoundingClientRect();
  const inside = x >= dockRect.left && x <= dockRect.right &&
                 y >= dockRect.top && y <= dockRect.bottom;
  const under = inside ? document.elementFromPoint(x, y) : null;
  const panelEl = under ? under.closest(".panel") : null;

  const nothing = () => {
    drag.target = null; drag.zoneName = ""; drag.zone.style.display = "none";
  };

  if (!panelEl) {
    // Dock vazio: a aba larga volta a ser o layout inteiro.
    if (inside && layout.t === "tabs" && !layout.ids.length) {
      drag.target = layout; drag.zoneName = "center"; drag.index = null;
      place(drag.zone, dockRect);
    } else {
      nothing();
    }
    return;
  }

  const node = nodeByKey(panelEl.dataset.key);
  if (!node) { nothing(); return; }

  const r = panelEl.getBoundingClientRect();
  const strip = panelEl.querySelector(".tabstrip").getBoundingClientRect();
  drag.target = node;
  drag.index = null;

  if (y <= strip.bottom) {
    // Sobre a regua de abas: entra na posicao apontada, para poder reordenar.
    drag.zoneName = "tab";
    let idx = node.ids.length;
    [...panelEl.querySelectorAll(".tab")].forEach((t, i) => {
      const tr = t.getBoundingClientRect();
      if (idx === node.ids.length && x < tr.left + tr.width / 2) idx = i;
    });
    drag.index = idx;
    place(drag.zone, { left: strip.left, top: strip.top,
                       width: strip.width, height: strip.height });
    return;
  }

  const fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
  const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
  const near = Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));

  if (d[near] > 0.25) {
    drag.zoneName = "center";
    place(drag.zone, r);
    return;
  }

  drag.zoneName = near;
  const half = {
    left:   { left: r.left, top: r.top, width: r.width * 0.4, height: r.height },
    right:  { left: r.left + r.width * 0.6, top: r.top, width: r.width * 0.4, height: r.height },
    top:    { left: r.left, top: r.top, width: r.width, height: r.height * 0.4 },
    bottom: { left: r.left, top: r.top + r.height * 0.6, width: r.width, height: r.height * 0.4 },
  };
  place(drag.zone, half[near]);
}

export function place(el?, r?) {
  el.style.display = "block";
  el.style.left = r.left + "px";
  el.style.top = r.top + "px";
  el.style.width = r.width + "px";
  el.style.height = r.height + "px";
}

// -------------------------------------------------------- menu e rodape

export function renderStatus() {
  $("stMedia").textContent = state.media.length +
    (state.media.length === 1 ? " item" : " itens");
  $("stTracks").textContent = state.tracks.length +
    (state.tracks.length === 1 ? " pista" : " pistas");
  $("topTime").textContent = fmtTime(state.pos, true);
}

// Redesenha so os paineis citados, e so quando a aba deles esta a vista.
export function refresh(ids?) {
  ids.forEach((id) => {
    const node = panelWith(id);
    if (!node || node.active !== id) return;
    const el = document.querySelector('.panel[data-key="' + node.key + '"] .panel-body');
    if (!el) return;
    el.className = "panel-body";
    el.removeAttribute("style");
    el.innerHTML = "";
    PANELS[id].render(el);
  });
  renderStatus();
}
