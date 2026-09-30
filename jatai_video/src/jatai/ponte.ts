// ponte.ts - o lado do editor de video na conversa com o editor de scripts
//
// O editor de scripts abre numa guia propria (Menu > Script), com espaco para
// escrever. Esta guia, a do video, e quem roda: recebe o texto pelo canal (ver
// canal.ts), roda com a biblioteca `editor` sobre a linha do tempo e devolve a
// saida. Pelo menu, tambem roda direto um script salvo, sem abrir a outra guia.

import { state, toast } from "../ui/core";
import { abreCanal, type Mensagem } from "./canal";
import { rodaNoEditor, limpaScript } from "./editor-lib";
import { listaScripts, pegaScript } from "./scripts";

const guia = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let rodando = false;
let anunciado = "";

function trabalhoAberto(): string {
  return state.projeto && !document.body.classList.contains("no-inicio") ? state.projeto.nome || "sem nome" : "";
}

// dono: id do script; rodar de novo substitui o que ele fez da outra vez
async function roda(fonte: string, dono: string) {
  if (rodando) return { codigo: 1, saida: "", erros: "jatai: ja ha um script rodando nesta guia\n" };
  if (!trabalhoAberto()) return { codigo: 1, saida: "", erros: "jatai: abra um trabalho no editor de video\n" };
  rodando = true;
  try {
    return await rodaNoEditor(fonte, dono);
  } catch (e) {
    return { codigo: 1, saida: "", erros: "nao foi possivel rodar: " + (e?.message || e) + "\n" };
  } finally {
    rodando = false;
  }
}

const canal = abreCanal(async (m: Mensagem) => {
  if (m.t === "quem") {
    const p = trabalhoAberto();
    if (p) canal.postMessage({ t: "aqui", guia, projeto: p });
  } else if (m.t === "rodar" && m.guia === guia) {
    const resultado = await roda(m.fonte, m.script);
    canal.postMessage({ t: "fim", guia, pedido: m.pedido, resultado });
    toast(resultado.codigo === 0 ? `script "${m.nome}" rodou` : `script "${m.nome}" parou com erro`);
  } else if (m.t === "limpar" && m.guia === guia) {
    const clipes = rodando ? 0 : limpaScript(m.script);
    canal.postMessage({ t: "limpo", guia, pedido: m.pedido, clipes });
    if (clipes) toast(`o que o script "${m.nome}" fez foi tirado do video`);
  }
});

// Abrir ou fechar um trabalho muda quem pode rodar: a guia de scripts fica
// sabendo sem precisar perguntar de novo.
function anuncia() {
  const p = trabalhoAberto();
  if (p === anunciado) return;
  anunciado = p;
  canal.postMessage(p ? { t: "aqui", guia, projeto: p } : { t: "saiu", guia });
}
setInterval(anuncia, 1000);
window.addEventListener("pagehide", () => canal.postMessage({ t: "saiu", guia }));

/** Abre (ou traz para a frente) a guia do editor de scripts. */
export function abreEditorDeScripts() {
  const w = window.open(import.meta.env.BASE_URL + "script.html", "jatai-scripts");
  if (!w) toast("O navegador bloqueou a nova guia: permita pop-ups para esta pagina.");
  else w.focus();
}

async function rodaSalvo(id: string) {
  const s = pegaScript(id);
  if (!s) return;
  const r = await roda(s.texto, s.id);
  if (r.codigo === 0) toast(`script "${s.nome}" rodou` + (r.saida.trim() ? ": " + r.saida.trim().split("\n").pop() : ""));
  else toast(`script "${s.nome}": ${(r.erros.trim().split("\n")[0] || "erro").replace(/^\/?script\.jat:/, "linha ")}`);
}

/** Itens do menu Script. */
export function menuScript() {
  const salvos = listaScripts().slice(0, 12);
  const aberto = !!trabalhoAberto();
  return [
    { label: "Abrir o editor de scripts (nova guia)", action: abreEditorDeScripts },
    { sep: true },
    { titulo: salvos.length ? "Rodar neste trabalho" : "Nenhum script salvo" },
    ...salvos.map((s) => ({ label: s.nome, disabled: !aberto || rodando, action: () => rodaSalvo(s.id) })),
  ];
}
