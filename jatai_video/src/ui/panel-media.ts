// panel-media.ts - painel de midia, galerias e a importacao

// ====================================================== conteudo: midia

import { api, select, showMenu, forgetHistory, toast, fmtTime, fmtSize, state } from "./core";
import { refresh } from "./dock-view";
import { seekCommit } from "./panel-player";
import { afterClipChange, layoutTossed, addToTimeline, beginMediaDrag } from "./panel-timeline";

export function renderMedia(body?) {
  body.classList.add("fill-col");

  const bar = document.createElement("div");
  bar.className = "bar";
  // "Separar voz" saiu daqui. Ela nasceu para achar as pausas, e quem as acha
  // agora e o reconhecedor de fala, no arquivo original e em segundos. O que
  // sobrou dela - desenhar a fala isolada na linha do tempo - e pedido de la,
  // pelo proprio botao que mostra esse desenho.
  bar.innerHTML = '<button class="btn" id="mImport">Importar</button>' +
                  '<div class="spacer"></div>' +
                  '<button class="btn ghost" id="mAdd">Para a linha do tempo</button>';
  body.appendChild(bar);

  const scroll = document.createElement("div");
  scroll.className = "scroll drop-zone" + (state.dragging ? " on" : "");
  body.appendChild(scroll);

  if (!state.media.length) {
    scroll.innerHTML = '<div class="empty"><b>Sua midia aparece aqui</b>' +
      '<div class="hint">Arraste arquivos para ca, ou use Importar. ' +
      'Depois arraste daqui para a linha do tempo.</div></div>';
  } else {
    const grid = document.createElement("div");
    grid.className = "media-grid";
    state.media.forEach((m) => {
      const card = document.createElement("div");
      card.dataset.media = m.id;
      card.className = "card" + (state.pickedMedia === m.id ? " on" : "");
      card.innerHTML = '<div class="thumb"><img alt=""><span></span></div>' +
                       '<button class="card-x" title="Tirar do projeto">&#10005;</button>' +
                       '<div class="name"></div>' +
                       '<div class="meta"><span class="k"></span><span class="s"></span></div>';
      card.querySelector(".thumb span").textContent = m.error ? "erro" : (m.ext || m.kind);
      if (m.hasVoice) card.classList.add("hasvoice");
      card.querySelector(".thumb img").draggable = false;
      card.querySelector(".name").textContent = m.name;
      card.querySelector(".name").title = m.error ? m.name + " - " + m.error : m.path;
      card.querySelector(".k").textContent =
        m.duration > 0 ? fmtTime(m.duration) : m.kind;
      card.querySelector(".s").textContent = fmtSize(m.bytes);
      if (m.error) card.classList.add("bad");
      paintThumb(card, m);
      card.addEventListener("click", () => {
        select({ media: m.id, clip: -1 }, ["media"]);
      });
      card.addEventListener("dblclick", () => addToTimeline(m));
      card.addEventListener("pointerdown", (e) => beginMediaDrag(e, m));

      // O x nao seleciona nem arrasta: ele so tira. Sem parar o apertar aqui,
      // o arrasto do cartao comecaria debaixo do proprio botao.
      const x = card.querySelector(".card-x");
      x.addEventListener("pointerdown", (e) => e.stopPropagation());
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        removeMedia(m.id, e.clientX, e.clientY);
      });
      grid.appendChild(card);
    });
    scroll.appendChild(grid);
  }

  bar.querySelector("#mImport").addEventListener("click", doImport);

  bar.querySelector("#mAdd").addEventListener("click", () => {
    const m = state.media.find((x) => x.id === state.pickedMedia);
    if (!m) { toast("Escolha um item da midia primeiro."); return; }
    addToTimeline(m);
  });
}

// A miniatura e um quadro decodificado logo depois do inicio - muitos videos
// comecam no escuro. Vem uma vez por item e fica guardada: reabrir o painel
// ou trocar a selecao nao manda decodificar de novo.
export function paintThumb(card?, m?) {
  const img = card.querySelector(".thumb img");
  const tag = card.querySelector(".thumb span");
  const known = state.thumbs.get(m.id);

  if (known) {
    img.src = known;
    img.hidden = false;
    tag.hidden = true;
    // O endereco de uma imagem publicada nao e eterno: o C++ guarda so as
    // ultimas e apaga o resto. Sumindo a que esta aqui, pede-se outra - antes
    // isso nem se notava porque o endereco era reaproveitado, e a miniatura
    // passava a mostrar, sem avisar, o quadro de outro arquivo.
    img.onerror = () => {
      img.onerror = null;
      state.thumbs.delete(m.id);
      paintThumb(card, m);
    };
    return;
  }
  if (known === null || known === "" || !m.hasVideo) return;

  state.thumbs.set(m.id, "");  // marca o pedido em andamento
  api.thumb(m.id).then((r) => {
    state.thumbs.set(m.id, r && r.ok ? r.url : null);
    if (r && r.ok) refresh(["media"]);
  });
}

// Paineis que por enquanto so mostram o que vem pela frente.
export function gallery(names?) {
  return (body) => {
    const grid = document.createElement("div");
    grid.className = "tile-grid";
    names.forEach((n) => {
      const t = document.createElement("div");
      t.className = "tile";
      t.textContent = n;
      t.addEventListener("click", () => toast(n + ": ainda nao implementado."));
      grid.appendChild(t);
    });
    body.appendChild(grid);
  };
}

// ============================================================ importacao

// ------------------------------------------------------- separar a voz
//
// O trabalho e de outro programa - o plugin do nsound, com o modelo e a janela
// de progresso dele. Daqui so sai o pedido, e o que volta e um arquivo com a
// fala limpa: sem musica, sem ar condicionado, sem clique de teclado. E dele
// que a linha do tempo passa a desenhar a onda, e e nele que as pausas podem
// ser achadas sozinhas - na mistura nao ha pausa nenhuma.

// `id` chega de quem pediu; sem ele, vale o item escolhido na cesta.
export async function doSeparate(id?) {
  const alvo = typeof id === "number" ? id : state.pickedMedia;
  const m = state.media.find((x) => x.id === alvo);
  if (!m) { toast("Escolha um item da midia primeiro."); return; }
  if (!m.hasAudio) { toast("Este item nao tem audio."); return; }

  state.separating = true;
  refresh(["media"]);
  toast("Separando a voz de " + m.name + " - a janela do separador mostra o andamento.");

  const r = await api.separate(m.id);
  state.separating = false;
  state.media = await api.getMedia();

  if (r && r.cancelled) { refresh(["media"]); toast("Separacao cancelada."); return; }
  if (!r || !r.ok) { refresh(["media"]); toast((r && r.error) || "a separacao falhou."); return; }

  // Com a voz na mao, mostrar a mistura seria desperdicar o que se acabou de
  // esperar: a linha do tempo ja passa a desenhar a fala.
  state.voice = true;
  state.waves.clear();
  refresh(["media", "timeline", "props"]);
  toast(r.cached
      ? "A voz deste arquivo ja estava separada."
      : "Voz separada: a linha do tempo passa a desenhar a fala isolada. "
        + "O clipe continua inteiro, com o audio dele.");
}

// -------------------------------------------- tirar um item do projeto
//
// Sair da cesta e sair do projeto: um clipe cujo arquivo nao esta mais na
// lista nao tem o que mostrar nem o que tocar. Por isso, havendo clipes em
// jogo, a lista pergunta antes - apagar minutos de montagem num toque, e sem
// um desfazer para voltar atras, seria pedir arrependimento.

export function removeMedia(id?, x?, y?) {
  const m = state.media.find((v) => v.id === id);
  if (!m) return;

  const used = state.clips.filter((c) => c.media === id);
  if (!used.length) { dropMedia(m, used); return; }

  // Ancorado onde nao ha ponteiro - o Delete do teclado - o menu abre sobre o
  // proprio cartao, que e o que a pergunta e sobre.
  if (x == null) {
    const card = document.querySelector('.card[data-media="' + id + '"]');
    const r = card ? card.getBoundingClientRect() : null;
    x = r ? r.left + r.width / 2 : window.innerWidth / 2;
    y = r ? r.top + r.height / 2 : window.innerHeight / 2;
  }

  const n = used.length;
  showMenu(x, y, [
    { label: n === 1 ? "1 clipe usa este arquivo" : n + " clipes usam este arquivo",
      disabled: true },
    { sep: true },
    { label: "Tirar do projeto e da linha do tempo",
      action: () => dropMedia(m, used) },
    { label: "Deixar como esta" },
  ]);
}

export function dropMedia(m?, used?) {
  // O historico morre aqui: um clipe restaurado apontaria para um arquivo que
  // ja saiu do C++, e voltar a ele seria voltar a um clipe quebrado.
  forgetHistory();

  // Os desenhos sao guardados por clipe; sem apaga-los ficariam na memoria ate
  // o fim da sessao, presos a clipes que nao existem mais.
  const ids = new Set(used.map((c) => c.id));
  used.forEach((c) => { state.strips.delete(c.id); state.waves.delete(c.id); });
  state.clips = state.clips.filter((c) => !ids.has(c.id));
  if (ids.has(state.pickedClip)) { state.pickedClip = -1; state.pickedPoint = 0; }

  state.media = state.media.filter((v) => v.id !== m.id);
  state.thumbs.delete(m.id);
  if (state.pickedMedia === m.id) state.pickedMedia = -1;
  api.removeMedia(m.id);

  // Um descartado pode ter perdido o vizinho que marcava o lugar de volta;
  // quem cuida disso e o proprio realinhamento.
  layoutTossed();

  afterClipChange(["media", "player"]);
  seekCommit();
  toast(used.length
      ? m.name + " saiu, e com ele " + used.length +
        (used.length === 1 ? " clipe." : " clipes.")
      : m.name + " saiu do projeto.");
}

// ------------------------------------------- arquivos largados na janela
//
// Quem recebe o arrasto e a janela, no C++: o Explorer nao entrega o caminho
// do arquivo a pagina, e sem caminho o FFmpeg nao abre nada. Daqui so
// cuidamos do que se ve - a area acendendo enquanto o arrasto passa, e a
// cesta se refazendo quando os arquivos entram.
//
// O alvo e a janela inteira, e nao so a area da midia: recusar o arquivo por
// alguns pixels de pontaria seria mesquinho, e a area acesa ja diz onde ele
// vai parar.

window.jtDrag = function (on?) {
  if (state.dragging === on) return;
  state.dragging = on;
  refresh(["media"]);
};

window.jtImported = async function (added?) {
  state.dragging = false;
  state.media = await api.getMedia();
  refresh(["media", "props"]);
  toast(added ? added + (added === 1 ? " item importado." : " itens importados.")
              : "Nenhum arquivo que a gente saiba abrir.");
};

export async function doImport() {
  const r = await api.import();
  if (r && r.error) { toast(r.error); return; }
  if (!r || !r.ok) return;
  state.media = await api.getMedia();
  toast(r.added + (r.added === 1 ? " item importado." : " itens importados."));
  refresh(["media", "props"]);
}
