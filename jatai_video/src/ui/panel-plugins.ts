// panel-plugins.ts - o painel Plugins: a pasta, a lista, e os parametros do
// plugin escolhido na linha do tempo.
//
// O painel nao conhece plugin nenhum: os campos saem do manifest.json de cada
// um (ver src/plugins/plugins.ts). Quem escreve um plugin novo nao precisa
// mexer aqui.

import { state, snapshot, rememberSnapshot, remember, toast, clamp, escapeHtml } from "./core";
import { refresh } from "./dock-view";
import { addToTimeline, afterClipChange, beginDropDrag, trackBusy } from "./panel-timeline";
import { telaComoAlvo } from "./texto";
import { seekCommit } from "./panel-player";
import { abreContagotas } from "../plugins/filtros";
import {
  plugins, abrePastaPlugins, reabrePastas, recarregaPlugins, removePasta,
  isPlugin, pluginDe, paramsDe, paintPluginLayer, type Plugin, type Param,
} from "../plugins/plugins";

// Um plugin entra como a foto: numa pista de video, no cursor, subindo para uma
// pista livre (ou nova, por cima) se o lugar estiver ocupado.
export function addPlugin(p: Plugin, trackId?, at?, nova?, onde?) {
  if (p.erro) { toast("Este plugin tem erro: " + p.erro); return; }
  const inicio = at != null ? at : state.pos;
  // Dois cliques nao dizem pista nenhuma: vale a primeira pista de video livre
  // naquele trecho, de cima para baixo, e nao havendo, uma nova no alto - um
  // plugin quase sempre vai por cima do que ja esta la.
  if (trackId == null && !nova) {
    const livre = state.tracks.find((t) => t.kind === "video" &&
                                           !trackBusy(t.id, inicio, p.duracao));
    if (livre) trackId = livre.id;
    else { nova = true; onde = 0; }
  }
  addToTimeline({ kind: "plugin", name: p.nome, id: 0, duration: p.duracao },
                trackId, inicio, nova, onde,
                { plugin: { id: p.id, params: {}, filtro: p.tipo === "filtro",
                            camada: p.tipo === "filtro" && p.alcance === "camada" } });
}

function beginPluginDrag(e, p: Plugin) {
  beginDropDrag(e, p.nome, (drop, at) => {
    if (drop.tela) { addPlugin(p); return; }
    addPlugin(p, drop.track, at, drop.nova, drop.onde);
  }, telaComoAlvo);
}

export function pickedPlugin() {
  const c = state.clips.find((x) => x.id === state.pickedClip);
  return isPlugin(c) ? c : null;
}

export function renderPlugins(body?) {
  body.appendChild(cabecalho());

  // Desenhos e filtros em grupos separados: um desenha por cima, o outro muda
  // o que esta abaixo - e quem procura um nao quer atravessar o outro.
  const grupos = [["Desenhos", plugins.lista.filter((p) => p.tipo !== "filtro")],
                  ["Filtros - mudam o que esta abaixo deles", plugins.lista.filter((p) => p.tipo === "filtro")]]
                 .filter(([, l]) => (l as Plugin[]).length);
  grupos.forEach(([titulo, lista]) => {
    if (grupos.length > 1 || titulo !== "Desenhos") {
      const sec = document.createElement("div");
      sec.className = "section";
      sec.textContent = titulo as string;
      body.appendChild(sec);
    }
    const grid = document.createElement("div");
    grid.className = "tile-grid";
    (lista as Plugin[]).forEach((p) => {
      const t = document.createElement("div");
      t.className = "tile acao" + (p.erro ? " pl-erro" : "");
      t.textContent = p.nome;
      t.title = (p.erro ? "Erro: " + p.erro
                        : (p.descricao ? p.descricao + "\n\n" : "") +
                          "Arraste ate a linha do tempo, ou dois cliques para por no cursor") +
                "\n(pasta " + p.pasta + ")";
      t.addEventListener("dblclick", () => addPlugin(p));
      t.addEventListener("pointerdown", (e) => { if (!p.erro) beginPluginDrag(e, p); });
      grid.appendChild(t);
    });
    body.appendChild(grid);
  });

  const c = pickedPlugin();
  if (c) { body.appendChild(formulario(c)); return; }

  const dica = document.createElement("div");
  dica.className = "pl-dica";
  dica.textContent = plugins.lista.length
    ? "Escolha um plugin na linha do tempo para mudar o que ele mostra. Posicao, " +
      "giro, tamanho e animacao ficam no painel Imagem, e da para arrastar o " +
      "plugin na tela."
    : "Cada plugin e uma pasta com manifest.json e plugin.js. Adicione a pasta de " +
      "um plugin, ou uma que contenha varios (um por subpasta); as pastas se " +
      "somam. O formato esta no README.";
  body.appendChild(dica);
}

// As pastas abertas, uma por linha, e os botoes de todas.
function cabecalho() {
  const wrap = document.createElement("div");
  wrap.className = "pl-topo";

  const botao = (onde, rotulo, faz, primario = false, dica = "") => {
    const b = document.createElement("button");
    b.className = "btn" + (primario ? " primary" : " ghost");
    b.textContent = rotulo;
    if (dica) b.title = dica;
    b.addEventListener("click", faz);
    onde.appendChild(b);
  };

  plugins.pastas.forEach((pa) => {
    const row = document.createElement("div");
    row.className = "tx-row pl-linha";
    const nome = document.createElement("span");
    nome.className = "pl-pasta" + (pa.situacao === "ok" ? "" : " pl-msg-erro");
    nome.textContent = pa.nome + "  -  " +
        (pa.situacao === "reconectar" ? "precisa de um clique para reabrir" :
         pa.situacao === "erro" ? "erro: " + pa.erro :
         pa.quantos + (pa.quantos === 1 ? " plugin" : " plugins"));
    nome.title = nome.textContent;
    row.appendChild(nome);
    // O navegador esquece a permissao entre sessoes, e so a devolve dentro de
    // um clique: dai o botao, em vez de reabrir sozinho na partida.
    if (pa.situacao === "reconectar") botao(row, "Reabrir", () => reabrePastas(pa.key), true);
    botao(row, "Tirar", () => removePasta(pa.key), false,
          "Tira a pasta da lista. Os arquivos nao sao apagados.");
    wrap.appendChild(row);
  });

  const row = document.createElement("div");
  row.className = "tx-row pl-linha";
  const aviso = plugins.carregando ? "Carregando plugins..." :
                !plugins.pastas.length ? "Nenhuma pasta de plugins" : "";
  if (aviso) {
    const s = document.createElement("span");
    s.className = "pl-pasta";
    s.textContent = aviso;
    row.appendChild(s);
  }
  if (plugins.pastas.filter((p) => p.situacao === "reconectar").length > 1)
    botao(row, "Reabrir todas", () => reabrePastas(), true);
  botao(row, "Adicionar pasta...", abrePastaPlugins, !plugins.pastas.length);
  if (plugins.pastas.length) botao(row, "Recarregar", recarregaPlugins, false,
                                   "Le as pastas de novo - depois de mexer num plugin.js");
  wrap.appendChild(row);
  return wrap;
}

// ------------------------------------------------------------ os campos

function formulario(c) {
  const p = pluginDe(c);
  const wrap = document.createElement("div");
  wrap.className = "tx-panel";

  const tit = document.createElement("div");
  tit.className = "section";
  tit.textContent = "Plugin escolhido: " + (p ? p.nome : c.name);
  wrap.appendChild(tit);

  if (!p) {
    const e = document.createElement("div");
    e.className = "pl-dica";
    e.textContent = "O plugin \"" + c.plugin.id + "\" nao esta na pasta aberta. " +
                    "Abra a pasta que o contem para ver e mudar os parametros.";
    wrap.appendChild(e);
  } else if (p.erro) {
    const e = document.createElement("div");
    e.className = "pl-dica pl-msg-erro";
    e.textContent = "Erro: " + p.erro;
    wrap.appendChild(e);
  } else {
    const valores = paramsDe(c, p);
    p.params.forEach((par) => wrap.appendChild(campo(c, par, valores[par.id])));
    if (!p.params.length) {
      const e = document.createElement("div");
      e.className = "pl-dica";
      e.textContent = "Este plugin nao tem parametros.";
      wrap.appendChild(e);
    }
  }

  const tempo = document.createElement("div");
  tempo.className = "tx-row";
  tempo.innerHTML =
    '<label>Aparece</label>' +
    '<div class="a-num"><input type="number" id="plIni" min="0" step="0.1" value="' +
      c.start.toFixed(1) + '"><span class="unit">s</span></div>' +
    '<label>por</label>' +
    '<div class="a-num"><input type="number" id="plDur" min="0.1" step="0.1" value="' +
      c.len.toFixed(1) + '"><span class="unit">s</span></div>';
  wrap.appendChild(tempo);
  tempo.querySelector("#plIni").addEventListener("change", (e: any) => {
    remember();
    c.start = Math.max(0, Number(e.target.value) || 0);
    afterClipChange(["plugins", "player"]);
  });
  tempo.querySelector("#plDur").addEventListener("change", (e: any) => {
    remember();
    c.len = Math.max(0.1, Number(e.target.value) || (p ? p.duracao : 5));
    afterClipChange(["plugins", "player"]);
  });

  const pe = document.createElement("div");
  pe.className = "a-foot";
  pe.innerHTML = '<button class="btn ghost" id="plAqui">Comecar no cursor</button>' +
                 '<button class="btn ghost" id="plPadrao">Valores do plugin</button>' +
                 '<button class="btn ghost" id="plDel">Excluir</button>';
  wrap.appendChild(pe);
  pe.querySelector("#plAqui").addEventListener("click", () => {
    remember();
    c.start = Math.max(0, state.pos);
    afterClipChange(["plugins", "player"]);
    seekCommit();
  });
  pe.querySelector("#plPadrao").addEventListener("click", () => {
    remember();
    c.plugin.params = {};
    refresh(["plugins"]);
    paintPluginLayer();
  });
  pe.querySelector("#plDel").addEventListener("click", () => {
    remember();
    state.clips = state.clips.filter((x) => x.id !== c.id);
    state.picked.delete(c.id);
    if (state.pickedClip === c.id) state.pickedClip = -1;
    afterClipChange(["plugins", "player"]);
    toast("Plugin excluido. Ctrl+Z traz de volta.");
  });
  return wrap;
}

// Um campo, do tipo que o manifest pediu. Como no painel Texto: a tela muda ao
// vivo, e o desfazer guarda um passo por gesto (o valor de antes de o campo ser
// usado), e nao um por tecla.
function campo(c, par: Param, valor: unknown) {
  const row = document.createElement("div");
  row.className = "tx-row";
  const rot = document.createElement("label");
  rot.textContent = par.rotulo;
  row.appendChild(rot);

  let antes: string | null = null;
  const guarda = () => { if (antes == null) antes = snapshot(); };
  const fecha = () => { if (antes != null) { rememberSnapshot(antes); antes = null; } };
  const poe = (v: unknown) => {
    guarda();
    if (!c.plugin.params) c.plugin.params = {};
    c.plugin.params[par.id] = v;
    paintPluginLayer();
  };

  if (par.tipo === "texto") {
    const multi = (par.linhas || 1) > 1;
    const el: any = document.createElement(multi ? "textarea" : "input");
    el.className = multi ? "tx-area pl-texto" : "nar-voz";
    if (multi) el.rows = par.linhas;
    el.spellcheck = false;
    el.value = String(valor ?? "");
    el.addEventListener("focus", guarda);
    el.addEventListener("input", () => poe(el.value));
    el.addEventListener("change", fecha);
    el.addEventListener("keydown", (e) => e.stopPropagation());
    if (multi) { row.classList.add("pl-coluna"); }
    row.appendChild(el);
  } else if (par.tipo === "cor") {
    const el = document.createElement("input");
    el.type = "color";
    el.value = /^#[0-9a-f]{6}$/i.test(String(valor)) ? String(valor) : "#ffffff";
    el.addEventListener("pointerdown", guarda);
    el.addEventListener("input", () => poe(el.value));
    el.addEventListener("change", fecha);
    row.appendChild(el);
    if (par.contagotas) {
      // Escolher a cor clicando na tela - o fundo verde de um chroma key. A cor
      // sai da imagem ORIGINAL (a entrada do filtro), e nao do que se ve.
      const b = document.createElement("button");
      b.className = "btn ghost";
      b.textContent = "Conta-gotas";
      b.title = "Clique aqui e depois na cor, na tela do reprodutor";
      b.addEventListener("click", () => {
        const erro = abreContagotas(c, (cor) => {
          guarda();
          el.value = cor;
          poe(cor);
          fecha();
        });
        if (erro) toast(erro);
      });
      row.appendChild(b);
    }
  } else if (par.tipo === "cores") {
    // Uma lista de cores, que o conta-gotas vai SOMANDO: a parede do fundo e
    // branca perto da luz, cinza na sombra e quase preta no canto - uma cor so
    // nao cobre isso sem uma tolerancia que come a pessoa junto.
    const max = par.max || 8;
    let cores: string[] = (Array.isArray(valor) ? valor : []).map(String);
    const lista = document.createElement("div");
    lista.className = "pl-cores";
    const conta = document.createElement("span");
    conta.className = "pl-cores-conta";
    const perto = (a: string, b: string) => {
      const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const [x, y] = [n(a), n(b)];
      return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 12;
    };
    const desenha = () => {
      lista.innerHTML = "";
      cores.forEach((cor, i) => {
        const chip = document.createElement("span");
        chip.className = "pl-cor";
        chip.title = cor + " - clique no x para tirar";
        chip.innerHTML = "<i></i><b>&times;</b>";
        (chip.querySelector("i") as HTMLElement).style.background = cor;
        chip.querySelector("b")!.addEventListener("click", () => {
          guarda();
          cores.splice(i, 1);
          poe(cores.slice());
          fecha();
          desenha();
        });
        lista.appendChild(chip);
      });
      if (!cores.length) {
        const v = document.createElement("span");
        v.className = "pl-cores-vazio";
        v.textContent = "nenhuma cor - use o conta-gotas";
        lista.appendChild(v);
      }
      conta.textContent = cores.length + " de " + max;
    };
    row.classList.add("pl-coluna");
    row.appendChild(lista);
    const botoes = document.createElement("div");
    botoes.className = "pl-cores-botoes";
    const add = document.createElement("button");
    add.className = "btn ghost";
    add.textContent = "+ Conta-gotas";
    add.title = "Cada clique na tela soma uma cor. Esc ou botao direito termina.";
    add.addEventListener("click", () => {
      // Um passo so no desfazer para a sessao inteira do conta-gotas.
      guarda();
      const erro = abreContagotas(c, (cor) => {
        if (cores.some((x) => perto(x, cor))) return;
        if (cores.length >= max) { toast("No maximo " + max + " cores - tire uma para somar outra."); return; }
        cores.push(cor);
        poe(cores.slice());
        desenha();
      }, { continuo: true, fechou: fecha });
      if (erro) { toast(erro); fecha(); }
    });
    const limpa = document.createElement("button");
    limpa.className = "btn ghost";
    limpa.textContent = "Limpar";
    limpa.addEventListener("click", () => {
      if (!cores.length) return;
      guarda();
      cores = [];
      poe([]);
      fecha();
      desenha();
    });
    botoes.append(add, limpa, conta);
    row.appendChild(botoes);
    desenha();
  } else if (par.tipo === "numero") {
    const min = par.min ?? -1e9, max = par.max ?? 1e9, passo = par.passo ?? 1;
    const n = Number(valor) || 0;
    let range: HTMLInputElement | null = null;
    if (par.min != null && par.max != null) {
      range = document.createElement("input");
      range.type = "range";
      range.min = String(min); range.max = String(max); range.step = String(passo);
      range.value = String(n);
      row.appendChild(range);
    }
    const caixa = document.createElement("div");
    caixa.className = "a-num";
    caixa.innerHTML = '<input type="number" step="' + passo + '">' +
                      (par.unidade ? '<span class="unit">' + escapeHtml(par.unidade) + '</span>' : "");
    const num = caixa.querySelector("input") as HTMLInputElement;
    num.value = String(n);
    if (par.min != null) num.min = String(min);
    if (par.max != null) num.max = String(max);
    row.appendChild(caixa);

    if (range) {
      range.addEventListener("pointerdown", guarda);
      range.addEventListener("input", () => { num.value = range!.value; poe(Number(range!.value)); });
      range.addEventListener("change", fecha);
    }
    num.addEventListener("change", () => {
      const v = Number(num.value);
      if (!isFinite(v)) { num.value = String(n); return; }
      const certo = clamp(v, min, max);
      num.value = String(certo);
      if (range) range.value = String(certo);
      poe(certo);
      fecha();
    });
    num.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); num.blur(); } });
  } else if (par.tipo === "escolha") {
    const el = document.createElement("select");
    el.className = "nar-voz";
    (par.opcoes || []).forEach((o) => {
      const op = document.createElement("option");
      op.value = o;
      op.textContent = o;
      el.appendChild(op);
    });
    el.value = String(valor ?? "");
    el.addEventListener("change", () => { poe(el.value); fecha(); });
    row.appendChild(el);
  } else if (par.tipo === "sim_nao") {
    const el = document.createElement("input");
    el.type = "checkbox";
    el.checked = valor === true;
    el.addEventListener("change", () => { poe(el.checked); fecha(); });
    row.appendChild(el);
  }
  return row;
}
