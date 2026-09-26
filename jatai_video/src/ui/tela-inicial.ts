// tela-inicial.ts - por onde o jat.ai comeca.
//
// Antes, abrir o programa punha a pessoa dentro de um editor vazio, sem
// trabalho nenhum - e sem como voltar ao de ontem, porque nao havia ontem. A
// primeira pergunta de um editor nao e "o que voce quer fazer com este video",
// e sim "em que trabalho voce esta".
//
// Por isso esta tela e obrigatoria: o editor nao aparece antes de haver um
// projeto. Nao e um obstaculo - e a resposta a pergunta que vem primeiro.
//
// Cada trabalho aparece com um quadro dele proprio. Uma lista de nomes obriga
// a lembrar o que era "teste 3"; um quadro se reconhece de relance.

import { $, api, escapeHtml, toast, state } from "./core";
import { perguntaTexto, pergunta } from "./dialogo";
import { defineSujo, abrirProjeto, novoProjeto, pintaTituloProjeto, despedeDoProjeto } from "./projeto";
import { render, refresh } from "./dock-view";
import { seek, stopPlay } from "./panel-player";

export function mmssProjeto(seg?) {
  const s = Math.max(0, Math.round(seg || 0));
  if (s < 60) return s + "s";
  return Math.floor(s / 60) + "m " + String(s % 60).padStart(2, "0") + "s";
}

// "hoje", "ontem", ou a data. Quem procura um trabalho procura pelo quando, e
// "hoje" responde mais rapido do que uma data que se tem de comparar.
export function quandoProjeto(seg?) {
  if (!seg) return "";
  const d = new Date(seg * 1000);
  const hoje = new Date();
  const dia = (x) => x.getFullYear() * 400 + x.getMonth() * 31 + x.getDate();
  const delta = dia(hoje) - dia(d);
  const hora = String(d.getHours()).padStart(2, "0") + ":" +
               String(d.getMinutes()).padStart(2, "0");
  if (delta === 0) return "hoje, " + hora;
  if (delta === 1) return "ontem, " + hora;
  return String(d.getDate()).padStart(2, "0") + "/" +
         String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

export async function mostraInicio() {
  const tela = $("inicio");
  tela.hidden = false;
  document.body.classList.add("no-inicio");
  await pintaInicio();
}

export function escondeInicio() {
  $("inicio").hidden = true;
  document.body.classList.remove("no-inicio");
}

export async function pintaInicio() {
  const r = await api.projetos();
  const lista = (r && r.projetos) || [];
  const grade = $("inicioGrade");

  if (!lista.length) {
    grade.innerHTML =
      '<div class="ini-vazio">' +
        '<b>Nenhum trabalho ainda</b>' +
        '<div class="hint">Crie o primeiro: ele fica guardado sozinho, e ' +
        'estara aqui na proxima vez que voce abrir o jat.ai.</div>' +
      '</div>';
    return;
  }

  grade.innerHTML = lista.map((p) =>
    '<div class="ini-card" data-id="' + escapeHtml(p.id) + '" ' +
         'data-nome="' + escapeHtml(p.nome) + '">' +
      '<div class="ini-capa">' +
        (p.capa ? '<img alt="" src="' + p.capa + '">'
                : '<span class="ini-semcapa">sem previa</span>') +
      '</div>' +
      '<div class="ini-nome">' + escapeHtml(p.nome) + '</div>' +
      '<div class="ini-dados">' +
        p.clipes + (p.clipes === 1 ? " clipe" : " clipes") +
        (p.segundos > 0 ? ' &middot; ' + mmssProjeto(p.segundos) : "") +
      '</div>' +
      '<div class="ini-quando">' + quandoProjeto(p.mudado) +
        (p.recuperar ? ' <span class="ini-recuperar">por salvar</span>' : "") +
      '</div>' +
      '<button class="ini-apagar" title="Apagar este trabalho">&times;</button>' +
    '</div>').join("");

  grade.querySelectorAll(".ini-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".ini-apagar")) return;
      entraNoProjeto(card.dataset.id, card.dataset.nome);
    });
    card.querySelector(".ini-apagar").addEventListener("click", (e) => {
      e.stopPropagation();
      apagaProjeto(card.dataset.id, card.dataset.nome);
    });
  });
}

// Apagar o trabalho de alguem pede confirmacao, e a confirmacao precisa dizer
// O QUE some - por isso o nome aparece na pergunta, e nao um "tem certeza?".
export async function apagaProjeto(id?, nome?) {
  const escolha = await pergunta(
      "Apagar \"" + nome + "\"?",
      "O trabalho e apagado deste navegador. Os videos e audios que voce " +
      "importou nao sao tocados.",
      [{ id: "apagar", texto: "Apagar", tipo: "primary" },
       { id: "nao", texto: "Cancelar", tipo: "ghost", escape: true }]);
  if (escolha !== "apagar") return;
  const r = await api.projetoApagar(id);
  if (!r || !r.ok) { toast((r && r.error) || "nao foi possivel apagar"); return; }
  toast("\"" + nome + "\" foi apagado.");
  await pintaInicio();
}

export async function entraNoProjeto(id?, nome?) {
  if (!(await abrirProjeto(id, nome))) return;
  escondeInicio();
  render();
  refresh(["media", "timeline", "player", "props"]);
  seek(0);
  pintaTituloProjeto();
}

export async function criaProjeto() {
  const nome = await perguntaTexto(
      "Novo trabalho", "Que nome dar a este trabalho?",
      { valor: "Sem titulo", placeholder: "nome do trabalho", botao: "Criar" });
  // null e desistir; texto vazio e aceitar o nome de fabrica.
  if (nome === null) return;

  if (!(await novoProjeto(nome))) return;
  escondeInicio();
  render();
  refresh(["media", "timeline", "player", "props"]);
  pintaTituloProjeto();
}

// Voltar para a tela inicial e sair do trabalho: o que estiver por gravar vai
// para o disco antes, sem perguntar. Perguntar "deseja salvar?" e transferir
// para quem usa uma decisao que o programa sabe tomar melhor - guardar sempre.
export async function voltaAoInicio() {
  if (!(await despedeDoProjeto())) return;

  if (state.playing) await stopPlay();
  defineSujo(false);
  state.projeto = null;
  pintaTituloProjeto();
  await mostraInicio();
}
