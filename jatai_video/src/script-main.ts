// Ponto de entrada do editor de scripts (script.html), aberto pelo Menu > Script
// do editor de video numa guia propria, para ter espaco para escrever.
//
// Aqui so se escreve: quem roda e a guia do editor de video, onde esta a linha do
// tempo (ver jatai/canal.ts e jatai/ponte.ts). Os scripts ficam salvos no
// navegador (jatai/scripts.ts), a lista a esquerda.

import "./ui/base.css";
import "./jatai/script-page.css";
import { abreCanal, type Mensagem } from "./jatai/canal";
import { codigo } from "./jatai/realce";
import {
  type Script, listaScripts, pegaScript, criaScript, salvaScript, apagaScript,
  scriptAtual, marcaAtual, observaScripts,
} from "./jatai/scripts";
import type { Resultado } from "./jatai/jatai";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const texto = $<HTMLTextAreaElement>("scTexto");
const realce = $<HTMLPreElement>("scRealce");
const linhas = $("scLinhas");
const nome = $<HTMLInputElement>("scNome");
const salvo = $("scSalvo");
const itens = $("scItens");
const saida = $<HTMLPreElement>("scSaida");
const estado = $("scEstado");
const conexao = $("scConexao");
const alvo = $<HTMLSelectElement>("scAlvo");
const rodar = $<HTMLButtonElement>("scRodar");

let atual: Script | undefined;
let linhaComErro = 0;

// ------------------------------------------------------------------ aviso

let avisoTimer = 0;
function aviso(msg: string) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(avisoTimer);
  avisoTimer = window.setTimeout(() => el.classList.remove("show"), 3000);
}

// ------------------------------------------------------ realce e linhas

function redesenha() {
  const t = texto.value;
  // a linha vazia do fim precisa existir no <pre> para as alturas baterem
  realce.innerHTML = codigo(t) + "\n ";
  const n = t.split("\n").length;
  let html = "";
  for (let i = 1; i <= n; i++)
    html += (i === linhaComErro ? `<span class="erro">${i}</span>` : String(i)) + "\n";
  linhas.innerHTML = html + " ";
  rola();
}

function rola() {
  realce.scrollTop = texto.scrollTop;
  realce.scrollLeft = texto.scrollLeft;
  linhas.scrollTop = texto.scrollTop;
}

texto.addEventListener("scroll", rola);

// ------------------------------------------------------------ salvamento

let salvaTimer = 0;
function salvaJa() {
  clearTimeout(salvaTimer);
  if (!atual) return;
  if (atual.texto !== texto.value) atual = salvaScript(atual.id, { texto: texto.value }) ?? atual;
  salvo.textContent = "salvo";
  desenhaLista();
}

function mudou() {
  salvo.textContent = "editando...";
  if (linhaComErro) linhaComErro = 0;
  redesenha();
  clearTimeout(salvaTimer);
  salvaTimer = window.setTimeout(salvaJa, 500);
}

texto.addEventListener("input", mudou);
window.addEventListener("beforeunload", salvaJa);

// ------------------------------------------------------------------ lista

function quando(ms: number): string {
  const d = new Date(ms), hoje = new Date();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === hoje.toDateString() ? "hoje, " + hora : d.toLocaleDateString("pt-BR") + " " + hora;
}

function desenhaLista() {
  itens.innerHTML = "";
  for (const s of listaScripts()) {
    const li = document.createElement("li");
    li.className = s.id === atual?.id ? "atual" : "";
    li.innerHTML = `<span class="n"></span><span class="q"></span>`;
    (li.querySelector(".n") as HTMLElement).textContent = s.nome;
    (li.querySelector(".q") as HTMLElement).textContent = quando(s.modificado);
    li.title = s.nome;
    li.addEventListener("click", () => abre(s.id));
    itens.appendChild(li);
  }
}

function abre(id: string) {
  salvaJa();
  const s = pegaScript(id);
  if (!s) return;
  atual = s;
  marcaAtual(s.id);
  nome.value = s.nome;
  texto.value = s.texto;
  texto.scrollTop = texto.scrollLeft = 0;
  texto.setSelectionRange(0, 0);
  linhaComErro = 0;
  salvo.textContent = "salvo";
  document.title = `${s.nome} - Scripts Jatai`;
  redesenha();
  desenhaLista();
  texto.focus();
}

// outra guia mexeu na lista (ex.: outro editor de scripts aberto)
observaScripts(() => {
  if (atual && !pegaScript(atual.id)) {
    const primeiro = listaScripts()[0];
    if (primeiro) abre(primeiro.id);
    else abre(criaScript().id);
    return;
  }
  desenhaLista();
});

$("scNovo").addEventListener("click", () => abre(criaScript().id));

nome.addEventListener("change", () => {
  if (!atual) return;
  atual = salvaScript(atual.id, { nome: nome.value }) ?? atual;
  nome.value = atual.nome;
  document.title = `${atual.nome} - Scripts Jatai`;
  desenhaLista();
});
nome.addEventListener("keydown", (e) => { if (e.key === "Enter") texto.focus(); });

$("scApagar").addEventListener("click", () => {
  if (!atual || !confirm(`Excluir o script "${atual.nome}"? Isso nao pode ser desfeito.`)) return;
  apagaScript(atual.id);
  atual = undefined;
  const primeiro = listaScripts()[0];
  abre(primeiro ? primeiro.id : criaScript().id);
});

$("scBaixar").addEventListener("click", () => {
  if (!atual) return;
  salvaJa();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto.value], { type: "text/plain;charset=utf-8" }));
  a.download = atual.nome.replace(/[\\/:*?"<>|]+/g, "_") + ".jat";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

const arquivo = $<HTMLInputElement>("scArquivo");
$("scAbrir").addEventListener("click", () => arquivo.click());
arquivo.addEventListener("change", async () => {
  const f = arquivo.files?.[0];
  arquivo.value = "";
  if (!f) return;
  const t = (await f.text()).replace(/\r\n/g, "\n");
  abre(criaScript(f.name.replace(/\.(jat|txt)$/i, ""), t).id);
  aviso(`"${f.name}" aberto como um script novo`);
});

// ------------------------------------------------------------- teclado

// Troca o trecho [ini, fim) por s, mantendo o desfazer do navegador.
function troca(ini: number, fim: number, s: string, cursorIni?: number, cursorFim?: number) {
  texto.focus();
  texto.setSelectionRange(ini, fim);
  if (!document.execCommand("insertText", false, s)) {
    texto.setRangeText(s, ini, fim, "end");
    mudou();
  }
  if (cursorIni !== undefined) texto.setSelectionRange(cursorIni, cursorFim ?? cursorIni);
}

// linha que abre bloco: if/elif/else/while/for, fn, ou definicao de funcao com tipo
const ABRE_BLOCO = /^\s*((if|elif|while|for)\b.*|else|fn\s+\w+\s*\(.*\)|(extern\s+)?(int|double|string|char|bool|void)(\[\])?\s+\w+\s*\(.*\))\s*$/;
const FECHA_BLOCO = /^\s*(return\b.*|break|continue)\s*$/;

function semComentario(l: string): string {
  // tira o "#..." fora de strings (aproximado: basta para decidir o recuo)
  let dentro = "";
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (dentro) { if (c === "\\") i++; else if (c === dentro) dentro = ""; }
    else if (c === '"' || c === "'") dentro = c;
    else if (c === "#") return l.slice(0, i);
  }
  return l;
}

texto.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    roda();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    salvaJa();
    aviso("script salvo");
    return;
  }

  const v = texto.value, ini = texto.selectionStart, fim = texto.selectionEnd;

  if (e.key === "Tab") {
    e.preventDefault();
    const iniLinha = v.lastIndexOf("\n", ini - 1) + 1;
    if (!e.shiftKey && ini === fim) { troca(ini, fim, "    "); return; }
    // varias linhas (ou Shift+Tab): recua ou avanca todas
    const fimLinha = (() => { const k = v.indexOf("\n", fim > ini && v[fim - 1] === "\n" ? fim - 1 : fim); return k < 0 ? v.length : k; })();
    const bloco = v.slice(iniLinha, fimLinha).split("\n");
    const novo = bloco.map((l) => e.shiftKey ? l.replace(/^( {1,4}|\t)/, "") : "    " + l).join("\n");
    const primeiro = e.shiftKey ? -(bloco[0].length - bloco[0].replace(/^( {1,4}|\t)/, "").length) : 4;
    const cursor = Math.max(iniLinha, ini + primeiro);
    troca(iniLinha, fimLinha, novo, cursor, ini === fim ? cursor : fimLinha + (novo.length - (fimLinha - iniLinha)));
    return;
  }

  if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const iniLinha = v.lastIndexOf("\n", ini - 1) + 1;
    const linha = v.slice(iniLinha, ini);
    let recuo = /^[ \t]*/.exec(linha)![0];
    const util = semComentario(linha);
    if (ABRE_BLOCO.test(util)) recuo += "    ";
    else if (FECHA_BLOCO.test(util)) recuo = recuo.slice(0, Math.max(0, recuo.length - 4));
    troca(ini, fim, "\n" + recuo);
    return;
  }

  if (e.key === "Backspace" && ini === fim && ini > 0) {
    // apagar num recuo so de espacos volta um nivel inteiro (4 espacos)
    const iniLinha = v.lastIndexOf("\n", ini - 1) + 1;
    const antes = v.slice(iniLinha, ini);
    if (antes.length >= 4 && /^ +$/.test(antes)) {
      e.preventDefault();
      const tira = antes.length % 4 || 4;
      troca(ini - tira, ini, "");
    }
  }
});

// -------------------------------------------------- conexao com o video

const guias = new Map<string, string>(); // guia do editor de video -> nome do trabalho
const pedidos = new Map<string, (r: any) => void>();

const canal = abreCanal((m: Mensagem) => {
  if (m.t === "aqui") { guias.set(m.guia, m.projeto); desenhaConexao(); }
  else if (m.t === "saiu") { guias.delete(m.guia); desenhaConexao(); }
  else if (m.t === "fim") { pedidos.get(m.pedido)?.(m.resultado); pedidos.delete(m.pedido); }
  else if (m.t === "limpo") { pedidos.get(m.pedido)?.(m.clipes); pedidos.delete(m.pedido); }
});

function desenhaConexao() {
  const lista = [...guias.entries()];
  conexao.classList.toggle("ok", lista.length > 0);
  $("scAbreVideo").hidden = lista.length > 0;
  if (!lista.length) {
    conexao.textContent = "nenhum trabalho aberto no editor de video";
    alvo.hidden = true;
  } else if (lista.length === 1) {
    conexao.textContent = `roda em "${lista[0][1]}"`;
    alvo.hidden = true;
  } else {
    conexao.textContent = "roda em";
    const antes = alvo.value;
    alvo.innerHTML = "";
    for (const [g, p] of lista) {
      const o = document.createElement("option");
      o.value = g;
      o.textContent = p;
      alvo.appendChild(o);
    }
    if (guias.has(antes)) alvo.value = antes;
    alvo.hidden = false;
  }
  rodar.disabled = !lista.length;
  ($("scTirar") as HTMLButtonElement).disabled = !lista.length;
}

function pergunta() {
  guias.clear();
  canal.postMessage({ t: "quem" });
  // quem responder aparece; sem resposta em pouco tempo, nao ha editor aberto
  setTimeout(desenhaConexao, 400);
}

window.addEventListener("focus", pergunta);
$("scAbreVideo").addEventListener("click", () => window.open(import.meta.env.BASE_URL, "_blank"));

// --------------------------------------------------------------- rodar

let rodando = false;

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Saida com as linhas de erro do script clicaveis (levam a linha no editor).
function mostraSaida(r: Resultado) {
  let html = escHtml(r.saida);
  linhaComErro = 0;
  for (const l of r.erros.split("\n")) {
    if (!l) continue;
    const m = /^\/?script\.jat:(\d+):(\d+): (erro|nota)/.exec(l);
    const cls = / erro: /.test(l) || /^jatai: /.test(l) ? "erro" : / nota: /.test(l) ? "nota" : "aviso";
    let linha = escHtml(l);
    if (m) {
      if (m[3] === "erro" && !linhaComErro) linhaComErro = Number(m[1]);
      linha = linha.replace(/^\/?script\.jat:(\d+):(\d+)/,
        (_t, a, b) => `<a data-l="${a}" data-c="${b}">linha ${a}, coluna ${b}</a>`);
    }
    html += `<span class="${cls}">${linha}</span>\n`;
  }
  saida.innerHTML = html;
  redesenha();
}

saida.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest("a[data-l]") as HTMLElement | null;
  if (!a) return;
  vaiPara(Number(a.dataset.l), Number(a.dataset.c));
});

function vaiPara(l: number, c: number) {
  const ls = texto.value.split("\n");
  let pos = 0;
  for (let i = 0; i < l - 1 && i < ls.length; i++) pos += ls[i].length + 1;
  pos += Math.max(0, Math.min(c - 1, (ls[l - 1] ?? "").length));
  texto.focus();
  texto.setSelectionRange(pos, pos);
  // traz a linha para o meio da area
  const alturaLinha = 21;
  texto.scrollTop = Math.max(0, (l - 1) * alturaLinha - texto.clientHeight / 2);
  rola();
}

async function roda() {
  if (rodando) return;
  salvaJa();
  const destino = guias.size > 1 ? alvo.value : [...guias.keys()][0];
  if (!destino) {
    estado.textContent = "abra um trabalho no editor de video";
    estado.className = "sc-estado erro";
    aviso("Abra o editor de video com um trabalho, em outra guia, para rodar o script.");
    return;
  }
  rodando = true;
  rodar.disabled = true;
  estado.textContent = "rodando...";
  estado.className = "sc-estado";
  const pedido = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const t0 = performance.now();
  const demorou = setTimeout(() => { estado.textContent = "rodando... (a guia do editor de video esta respondendo?)"; }, 8000);
  try {
    const r = await new Promise<Resultado>((ok) => {
      pedidos.set(pedido, ok);
      canal.postMessage({ t: "rodar", guia: destino, pedido, fonte: texto.value,
                          nome: atual?.nome ?? "script", script: atual?.id ?? "script" });
    });
    const ms = (performance.now() - t0).toFixed(0);
    mostraSaida(r);
    estado.textContent = r.codigo === 0 ? `terminou em ${ms} ms` : "parou com erro";
    estado.className = "sc-estado " + (r.codigo === 0 ? "ok" : "erro");
  } finally {
    clearTimeout(demorou);
    rodando = false;
    rodar.disabled = !guias.size;
  }
}

rodar.addEventListener("click", roda);

// Tira do video o que este script fez (sem rodar de novo)
$("scTirar").addEventListener("click", async () => {
  const destino = guias.size > 1 ? alvo.value : [...guias.keys()][0];
  if (!destino || !atual || rodando) return;
  const pedido = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clipes = await new Promise<number>((ok) => {
    pedidos.set(pedido, ok);
    canal.postMessage({ t: "limpar", guia: destino, pedido, nome: atual!.nome, script: atual!.id });
  });
  estado.className = "sc-estado";
  estado.textContent = clipes ? `tirado do video (${clipes} clipe${clipes > 1 ? "s" : ""})` : "este script nao tinha mudado nada no video";
});
$("scLimpar").addEventListener("click", () => {
  saida.innerHTML = "";
  estado.textContent = "";
  linhaComErro = 0;
  redesenha();
});

// --------------------------------------------- divisor da saida

const divisor = $("scDivisor");
divisor.addEventListener("pointerdown", (e) => {
  divisor.setPointerCapture(e.pointerId);
  divisor.classList.add("arrastando");
  const y0 = e.clientY, h0 = saida.getBoundingClientRect().height;
  const move = (ev: PointerEvent) => {
    const h = Math.max(60, Math.min(window.innerHeight - 220, h0 - (ev.clientY - y0)));
    document.body.style.setProperty("--saida-h", h + "px");
  };
  const solta = () => {
    divisor.classList.remove("arrastando");
    divisor.removeEventListener("pointermove", move);
    try { localStorage.setItem("jatai.scripts.saida", document.body.style.getPropertyValue("--saida-h")); } catch { /* nada */ }
  };
  divisor.addEventListener("pointermove", move);
  divisor.addEventListener("pointerup", solta, { once: true });
});
try {
  const h = localStorage.getItem("jatai.scripts.saida");
  if (h) document.body.style.setProperty("--saida-h", h);
} catch { /* nada */ }

// ------------------------------------------------------------- partida

{
  const lista = listaScripts();
  const ultimo = scriptAtual();
  abre((ultimo && pegaScript(ultimo) ? ultimo : lista[0]?.id) ?? criaScript().id);
  pergunta();
}
