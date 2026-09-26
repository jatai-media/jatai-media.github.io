// atalhos.ts - as teclas de atalho, num lugar so.
//
// ESTE ARQUIVO E A FONTE DA VERDADE. Atalho novo entra na lista abaixo, e nao
// no tratador de teclas - ele so consulta. Foi para isso que a lista existe:
// enquanto cada gesto carregava a sua tecla espalhada num `else if`, nao havia
// como mostra-los ao usuario, nem como deixa-lo troca-los, nem como perceber
// que dois estavam pedindo a mesma combinacao.
//
// Uma combinacao se escreve como "Ctrl+Shift+KeyB": os modificadores em ordem
// fixa e, no fim, o CODIGO da tecla - o lugar dela no teclado, e nao a letra
// que sai. Assim o atalho fica onde o dedo aprendeu, mesmo em teclado de outra
// lingua.

import { api, select, closeMenu, undo, redo, toast, state } from "./core";
import { projetoAberto, salvarProjeto } from "./projeto";
import { removeMedia } from "./panel-media";
import { seekCommit, togglePlay } from "./panel-player";
import { deleteAnimPoint } from "./panel-imagem";
import { projectEnd, setTool, tossSelection, closeHush, mergeSelection, unmergeSelection, copyClip, pasteClip, joinAndReview, toggleVoice, toggleFollow, deletePoint, deleteClip, splitAtPlayhead } from "./panel-timeline";

export const SHORTCUTS = [
  { id: "salvar", tecla: "Ctrl+KeyS", nome: "Salvar o trabalho",
    faz: async () => {
      if (!projetoAberto()) return;
      if (await salvarProjeto()) toast("Trabalho salvo.");
    } },
  { id: "play",   tecla: "Space",     nome: "Tocar / pausar",
    faz: () => togglePlay() },
  { id: "split",  tecla: "Ctrl+KeyB", nome: "Dividir no cursor",
    faz: () => splitAtPlayhead() },
  { id: "undo",   tecla: "Ctrl+KeyZ", nome: "Desfazer",
    faz: () => undo() },
  { id: "redo",   tecla: "Ctrl+KeyY", nome: "Refazer",
    faz: () => redo() },
  { id: "select", tecla: "KeyV",      nome: "Ferramenta: selecao",
    faz: () => setTool("select") },
  { id: "razor",  tecla: "KeyC",      nome: "Ferramenta: tesoura",
    faz: () => setTool("razor") },
  { id: "voice",  tecla: "KeyH",      nome: "Desenhar a voz isolada",
    faz: () => toggleVoice() },
  { id: "follow", tecla: "KeyF",      nome: "Seguir a agulha",
    faz: () => toggleFollow() },
  { id: "copy",   tecla: "Ctrl+KeyC", nome: "Copiar o clipe escolhido",
    faz: () => copyClip() },
  { id: "paste",  tecla: "Ctrl+KeyV", nome: "Colar no cursor",
    faz: () => pasteClip() },
  { id: "merge",  tecla: "Ctrl+KeyF", nome: "Fundir a selecao",
    faz: () => mergeSelection() },
  { id: "unmerge", tecla: "Ctrl+Shift+KeyF", nome: "Desfazer o bloco",
    faz: () => unmergeSelection() },
  { id: "review", tecla: "Ctrl+KeyQ", nome: "Juntar e conferir a emenda",
    faz: () => joinAndReview() },
  { id: "erase",  tecla: "Delete",    nome: "Excluir o que estiver escolhido",
    faz: () => eraseSelection() },
  { id: "toss",   tecla: "KeyD",      nome: "Mandar para baixo / trazer de volta",
    faz: () => tossSelection() },
  { id: "home",   tecla: "Home",      nome: "Ir para o inicio",
    faz: () => seekCommit(0) },
  { id: "end",    tecla: "End",       nome: "Ir para o fim",
    faz: () => seekCommit(projectEnd()) },
  { id: "escape", tecla: "Escape",    nome: "Fechar o que estiver aberto",
    faz: () => { closeMenu(); closeHush(); closeKeys(); setTool("select"); } },
];

// Del apaga o que estiver escolhido, do mais fino para o mais grosso: o ponto
// da linha de volume primeiro, depois o ponto de animacao da imagem, depois o
// item de midia, e so entao o clipe.
export function eraseSelection() {
  if (state.pickedPoint) deletePoint(state.pickedPoint);
  else if (state.pickedAnim) deleteAnimPoint(state.pickedAnim);
  else if (state.pickedMedia >= 0) removeMedia(state.pickedMedia);
  else deleteClip();
}

// ------------------------------------------------------------- as teclas

// A combinacao que este evento representa, ou vazio quando so ha modificador
// apertado - Ctrl sozinho nao e atalho de nada.
export function keyOf(e?) {
  if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" ||
      e.key === "Meta") return "";
  let s = "";
  if (e.ctrlKey) s += "Ctrl+";
  if (e.altKey) s += "Alt+";
  if (e.shiftKey) s += "Shift+";
  return s + e.code;
}

// Os nomes que o codigo da tecla nao diz sozinho.
export const KEY_NAMES = {
  Space: "Espaco", Delete: "Del", Escape: "Esc", Enter: "Enter",
  Backspace: "Backspace", Tab: "Tab",
  ArrowLeft: "Esquerda", ArrowRight: "Direita",
  ArrowUp: "Cima", ArrowDown: "Baixo",
  Home: "Inicio", End: "Fim", PageUp: "PageUp", PageDown: "PageDown",
  Comma: "virgula", Period: "ponto", Slash: "barra",
  Minus: "menos", Equal: "igual",
  BracketLeft: "abre colchete", BracketRight: "fecha colchete",
  Semicolon: "ponto e virgula",
};

export function keyLabel(combo?) {
  if (!combo) return "sem tecla";
  const partes = combo.split("+");
  const code = partes.pop();
  const nome = KEY_NAMES[code] ||
      code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
  return partes.concat(nome).join("+");
}

export function shortcutFor(combo?) {
  if (!combo) return null;
  return SHORTCUTS.find((s) => s.tecla === combo) || null;
}

// ------------------------------------------------------- disco e padroes

// Guardados antes de o disco ter chance de mexer: e para ca que o botao de
// restaurar volta.
export const SHORTCUT_DEFAULTS = SHORTCUTS.map((s) => ({ id: s.id, tecla: s.tecla }));

export function saveShortcuts() {
  const mapa = {};
  SHORTCUTS.forEach((s) => { mapa[s.id] = s.tecla; });
  api.setPref("atalhos", JSON.stringify(mapa));
}

export function loadShortcuts(text?) {
  if (!text) return;
  try {
    const mapa = JSON.parse(text);
    SHORTCUTS.forEach((s) => {
      // So o que for texto: uma chave estranha no arquivo nao pode apagar um
      // atalho que ainda funciona.
      if (typeof mapa[s.id] === "string") s.tecla = mapa[s.id];
    });
  } catch (e) { /* arquivo corrompido: ficam os de fabrica */ }
}

export function resetShortcuts() {
  SHORTCUT_DEFAULTS.forEach((d) => {
    const s = SHORTCUTS.find((x) => x.id === d.id);
    if (s) s.tecla = d.tecla;
  });
  saveShortcuts();
}

// ------------------------------------------------------------- o painel

// O id do atalho que esta esperando uma tecla nova, se algum estiver.
export let keyWaiting = null;
export let keysBox = null;

export function closeKeys() {
  if (keysBox) { keysBox.remove(); keysBox = null; }
  keyWaiting = null;
}

export function openKeys(anchor?) {
  if (keysBox) { closeKeys(); return; }

  const box = document.createElement("div");
  box.className = "keys";
  box.innerHTML =
    '<div class="keys-title">Atalhos do teclado</div>' +
    '<div class="keys-list"></div>' +
    '<div class="keys-foot">' +
    '<span class="keys-hint">Clique numa tecla para troca-la.</span>' +
    '<button class="btn ghost" id="keysReset">Restaurar padroes</button></div>';
  document.body.appendChild(box);
  keysBox = box;

  // Encostado no botao que o abriu, e trazido para dentro quando nao couber.
  const r = anchor.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  box.style.left = Math.max(6, Math.min(r.left, window.innerWidth - b.width - 6)) + "px";
  box.style.top = Math.min(r.bottom + 6, window.innerHeight - b.height - 6) + "px";

  // Mexer dentro do painel nao pode fecha-lo; um clique fora, sim.
  box.addEventListener("click", (e) => e.stopPropagation());
  box.querySelector("#keysReset").addEventListener("click", () => {
    resetShortcuts();
    paintKeys();
    toast("Atalhos de volta ao padrao.");
  });

  paintKeys();
}

export function paintKeys() {
  if (!keysBox) return;
  const lista = keysBox.querySelector(".keys-list");
  lista.innerHTML = "";

  SHORTCUTS.forEach((s) => {
    const linha = document.createElement("div");
    linha.className = "keys-row";
    linha.innerHTML = '<span class="keys-nome"></span>' +
                      '<button class="keys-tecla"></button>';
    linha.querySelector(".keys-nome").textContent = s.nome;

    const b = linha.querySelector(".keys-tecla");
    if (keyWaiting === s.id) {
      b.classList.add("waiting");
      b.textContent = "aperte a tecla...";
    } else {
      b.textContent = keyLabel(s.tecla);
      if (!s.tecla) b.classList.add("empty");
    }

    b.addEventListener("click", () => {
      keyWaiting = keyWaiting === s.id ? null : s.id;
      paintKeys();
    });
    lista.appendChild(linha);
  });
}

// Intercepta a tecla enquanto o painel espera por uma. Devolve true quando
// engoliu o evento - e ai o tratador de atalhos nem chega a ve-lo, para a
// tecla que se esta escolhendo nao disparar o que ela ainda faz.
export function captureKey(e?) {
  if (!keyWaiting) return false;

  const combo = keyOf(e);
  if (!combo) return true;          // so um modificador: continua esperando

  e.preventDefault();

  if (combo === "Escape") { keyWaiting = null; paintKeys(); return true; }

  const alvo = SHORTCUTS.find((s) => s.id === keyWaiting);
  keyWaiting = null;
  if (!alvo) { paintKeys(); return true; }

  // Duas acoes na mesma combinacao seriam uma delas em silencio. A que tinha
  // antes fica sem tecla, e o aviso diz qual foi - assim ninguem descobre a
  // perda tres dias depois.
  const dono = SHORTCUTS.find((s) => s.tecla === combo && s.id !== alvo.id);
  if (dono) dono.tecla = "";

  alvo.tecla = combo;
  saveShortcuts();
  paintKeys();

  if (dono) {
    toast(keyLabel(combo) + " passou para " + alvo.nome +
          "; " + dono.nome + " ficou sem tecla.");
  }
  return true;
}
