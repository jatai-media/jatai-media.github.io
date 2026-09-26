// projeto.ts - a montagem indo e voltando do disco.
//
// Ate agora o jat.ai abria sempre vazio. O que se montava vivia so na memoria
// desta pagina, e fechar a janela era perder a tarde inteira - e ele ja caiu
// sozinho pelo menos uma vez.
//
// A parte dificil disto ja estava pronta havia semanas, escondida no desfazer:
// ele escreve a montagem inteira em JSON a cada gesto e a traz de volta
// quando se aperta Ctrl+Z. Guardar em arquivo e o mesmo retrato, com tres
// coisas a mais.
//
// A primeira e a MIDIA. O desfazer a exclui de proposito - o comentario dele
// explica: os numeros dos arquivos sao da sessao, e um clipe restaurado
// apontaria para um id que nao existe mais. Um projeto reaberto amanha tem
// exatamente esse problema, entao ele guarda os CAMINHOS e, ao abrir, importa
// tudo outra vez e troca os numeros antigos pelos novos.
//
// A segunda e a area de visao, que ate hoje morava nas preferencias. Ela nao e
// gosto de quem usa: um vertical e um 1920x1080 sao trabalhos diferentes, e o
// numero pertence ao trabalho.
//
// A terceira e um resumo de tres campos no comeco do arquivo - nome, quantos
// clipes, quantos segundos. Sao para a tela inicial poder montar a lista sem
// abrir e interpretar cada projeto. Os nomes sao esquisitos de proposito, para
// nao casarem com nada de dentro da montagem.

import { $, api, forgetHistory, clipSourceAt, toast, state } from "./core";
import { pergunta } from "./dialogo";
import { setCanvas } from "./panel-player";

export const PROJETO_VERSAO = 1;

// De quanto em quanto tempo o trabalho vai para o RASCUNHO. Vinte segundos e
// o maximo que se aceita perder numa queda sem ficar bravo.
//
// Repare no que ele nao faz: nao toca no arquivo do trabalho. O projeto.json
// so muda quando alguem manda salvar - e e isso que permite descartar uma
// tarde de experiencias sem que o programa ja a tenha gravado por cima do que
// estava bom.
export const AUTOSSALVA_MS = 20000;

export function projetoAberto() { return state.projeto && state.projeto.id; }

// Ha trabalho por salvar? A resposta vive em dois lugares - aqui e no C++, que
// e quem recebe o X da janela - e por isso ha uma porta so para muda-la. Um
// state.sujo escrito na mao em qualquer canto era o caminho curto para o
// programa fechar por cima do trabalho de alguem.
export function defineSujo(v?) {
  const novo = !!v;
  if (state.sujo === novo) return;
  state.sujo = novo;
  api.sujo(novo);
  pintaTituloProjeto();
}

// ---------------------------------------------------------------- escrever

// Quanto tempo o trabalho tem, do zero ao fim do ultimo clipe.
export function projetoDuracao() {
  return state.clips.reduce((a, c) => Math.max(a, c.start + c.len), 0);
}

// De que clipe sai a capa. O que esta sob a agulha, quando e imagem; senao o
// primeiro que houver. A capa e para reconhecer o trabalho de relance, e o
// quadro que se estava olhando e o que a memoria guarda dele.
export function projetoCapa() {
  const sob = state.clips.filter((c) => c.media > 0 && c.kind !== "audio" &&
      state.pos >= c.start && state.pos < c.start + c.len);
  const c = sob[sob.length - 1] ||
            state.clips.filter((x) => x.media > 0 && x.kind !== "audio")[0];
  if (!c) return null;
  const dentro = sob.length ? state.pos - c.start : Math.min(1, c.len / 2);
  return { media: c.media, segundos: clipSourceAt(c, dentro) };
}

export function projetoJson() {
  return JSON.stringify({
    versao: PROJETO_VERSAO,
    // O resumo que a tela inicial le sem abrir o resto.
    projetoNome: state.projeto.nome,
    projetoClipes: state.clips.length,
    projetoSegundos: projetoDuracao(),

    canvas: state.canvas,
    zoom: state.zoom,

    // A cesta inteira, e nao so o que esta em uso: quem importou dez arquivos
    // e usou tres ainda quer os outros sete la amanha.
    midias: state.media.map((m) => ({ id: m.id, caminho: m.path, nome: m.name })),

    tracks: state.tracks,
    clips: state.clips,
    nextId: state.nextId,
    nextGroup: state.nextGroup,
  });
}

// Salvar de verdade: escreve o trabalho e apaga o rascunho, que ja cumpriu o
// papel. A capa custa decodificar um quadro, e por isso so e refeita aqui.
export async function salvarProjeto() {
  if (!projetoAberto()) return false;

  const capa = projetoCapa();
  const r = await api.projetoSalvar(state.projeto.id, projetoJson(),
                                    capa ? capa.media : -1,
                                    capa ? capa.segundos : 0);
  if (!r || !r.ok) {
    toast((r && r.error) || "nao foi possivel gravar o projeto");
    return false;
  }
  defineSujo(false);
  return true;
}

// A gravacao automatica. Escreve ao lado, e nao por cima: se a janela cair, o
// rascunho fica mais novo que o trabalho e a proxima abertura o oferece.
export async function gravaRascunho() {
  if (!projetoAberto() || !state.sujo) return;
  await api.projetoRascunho(state.projeto.id, projetoJson());
}

// ------------------------------------------------------------------- abrir

export async function abrirProjeto(id?, nome?) {
  const r = await api.projetoLer(id);
  if (!r || !r.ok) { toast((r && r.error) || "projeto nao encontrado"); return false; }

  // Ha trabalho mais novo do que o ultimo Salvar: quase sempre quer dizer que
  // a janela se fechou sem passar pela pergunta. Perguntar ANTES de abrir e o
  // que evita mostrar o trabalho de anteontem e so depois dizer "a proposito,
  // havia mais".
  let texto = r.json;
  if (r.rascunho) {
    const escolha = await pergunta(
        "Recuperar o trabalho?",
        "Ha alteracoes mais recentes que a ultima vez que este trabalho foi " +
        "salvo - o jat.ai foi fechado sem salvar. Recuperar traz essas " +
        "alteracoes de volta; abrir o salvo as descarta.",
        [{ id: "recuperar", texto: "Recuperar", tipo: "primary" },
         { id: "salvo", texto: "Abrir o salvo" },
         { id: "cancelar", texto: "Cancelar", tipo: "ghost", escape: true }]);
    if (escolha === "cancelar") return false;
    if (escolha === "recuperar") texto = r.rascunho;
  }

  let p;
  try {
    p = JSON.parse(texto);
  } catch (e) {
    toast("Este projeto esta corrompido e nao pode ser aberto.");
    return false;
  }

  // Os arquivos voltam para a cesta na ordem em que foram gravados, e o C++
  // devolve o numero novo de cada um - zero para o que sumiu do disco.
  const midias = Array.isArray(p.midias) ? p.midias : [];
  const volta = midias.length
      ? await api.importar(...midias.map((m) => m.caminho))
      : { ids: [] };

  const mapa = new Map();
  const sumiram = [];
  midias.forEach((m, i) => {
    const novo = (volta.ids || [])[i] || 0;
    mapa.set(m.id, novo);
    if (!novo) sumiram.push(m.nome || m.caminho);
  });

  state.media = await api.getMedia();
  state.tracks = Array.isArray(p.tracks) ? p.tracks : [];
  // O numero da midia muda a cada sessao; o do clipe, nao. Trocar um pelo
  // outro aqui e o que faz o projeto de ontem encontrar os arquivos de hoje.
  state.clips = (Array.isArray(p.clips) ? p.clips : []).map((c) => {
    if (typeof c.media === "number" && c.media > 0 && mapa.has(c.media)) {
      c.media = mapa.get(c.media);
    }
    return c;
  });

  state.nextId = p.nextId || (state.clips.reduce((a, c) => Math.max(a, c.id), 0) + 1);
  state.nextGroup = p.nextGroup || 1;
  if (p.canvas && p.canvas.w > 0 && p.canvas.h > 0) setCanvas(p.canvas.w, p.canvas.h);
  if (p.zoom > 0) state.zoom = p.zoom;

  state.picked = new Set();
  state.pickedClip = -1;
  state.pickedMedia = -1;
  state.pos = 0;
  // O historico e da sessao, e nao do arquivo: o primeiro Ctrl+Z num projeto
  // recem-aberto nao pode desfazer o que a pessoa fez ontem.
  forgetHistory();

  state.projeto = { id: id, nome: nome || p.projetoNome || id };
  // Recuperado e trabalho por salvar: ele veio do rascunho, e o arquivo do
  // trabalho continua no estado antigo ate alguem mandar salvar.
  defineSujo(!!(r.rascunho && texto === r.rascunho));

  if (sumiram.length) {
    toast(sumiram.length + (sumiram.length === 1
        ? " arquivo nao foi encontrado: " : " arquivos nao foram encontrados: ") +
        sumiram.slice(0, 3).join(", ") + (sumiram.length > 3 ? "..." : ""));
  }
  return true;
}

export async function novoProjeto(nome?) {
  // Nasce vazio, mas nasce EM DISCO: um projeto que so existe na memoria ate a
  // primeira gravacao e a mesma armadilha de antes, com outro nome.
  const limpo = (nome || "").trim() || "Sem titulo";
  state.projeto = { id: "", nome: limpo };
  state.tracks = [];
  state.clips = [];
  state.media = [];
  state.nextId = 1;
  state.nextGroup = 1;
  state.picked = new Set();
  state.pickedClip = -1;
  state.pos = 0;
  forgetHistory();

  const r = await api.projetoNovo(limpo, projetoJson());
  if (!r || !r.ok) {
    toast((r && r.error) || "nao foi possivel criar o projeto");
    state.projeto = null;
    return false;
  }
  state.projeto.id = r.id;
  defineSujo(false);
  return true;
}

// -------------------------------------------------------------- o de sempre

// O titulo da janela diz em que trabalho se esta, e se ha algo por gravar. E o
// unico lugar onde isso cabe sem ocupar espaco de edicao.
export function pintaTituloProjeto() {
  const alvo = $("tituloProjeto");
  if (!alvo) return;
  alvo.textContent = projetoAberto() ? state.projeto.nome : "";
  alvo.classList.toggle("sujo", !!state.sujo);
}

// Chamado de dentro do desfazer: todo gesto que se pode desfazer e um gesto
// que mudou o trabalho. Amarrar a sujeira ali e o que garante que nenhum
// caminho novo esqueca de avisar - foi o mesmo raciocinio que fez o desfazer
// guardar o estado inteiro em vez de descrever cada gesto.
export function marcaSujo() {
  if (!projetoAberto()) return;
  defineSujo(true);
}

export let autossalvaTimer = null;
export function ligaAutossalva() {
  clearInterval(autossalvaTimer);
  autossalvaTimer = setInterval(gravaRascunho, AUTOSSALVA_MS);
}

// Sair de um trabalho com coisa por gravar. As tres saidas estao nos botoes,
// com os nomes do que fazem - e "Cancelar" e o que responde ao Esc, porque
// desistir nunca pode ser a resposta perigosa.
//
// Devolve false quando a pessoa decidiu ficar.
export async function despedeDoProjeto() {
  if (!projetoAberto()) return true;
  if (!state.sujo) return true;

  const escolha = await pergunta(
      "Salvar \"" + state.projeto.nome + "\"?",
      "Ha alteracoes que ainda nao foram salvas neste trabalho.",
      [{ id: "salvar", texto: "Salvar", tipo: "primary" },
       { id: "descartar", texto: "Descartar" },
       { id: "cancelar", texto: "Cancelar", tipo: "ghost", escape: true }]);

  if (escolha === "cancelar") return false;
  if (escolha === "salvar") return await salvarProjeto();

  // Descartou: o rascunho tem de ir junto, ou a proxima abertura ofereceria
  // recuperar exatamente o que se acabou de jogar fora.
  await api.projetoRascunho(state.projeto.id, "");
  defineSujo(false);
  return true;
}

// ------------------------------------------------------- fechar a janela
//
// Chamado pelo C++ quando alguem clica no X havendo trabalho por salvar. A
// janela ficou esperando: ou ela fecha por jtFecharAgora, ou a pessoa desiste.
window.jtFechar = async function () {
  // Na tela inicial nao ha trabalho nenhum: fechar e fechar.
  if (!projetoAberto()) { api.fecharAgora(); return; }

  // O rascunho ANTES da pergunta: se a pessoa insistir no X enquanto ela esta
  // na tela, o Windows fecha e o que estava por salvar ja esta no disco.
  await gravaRascunho();

  const escolha = await pergunta(
      "Salvar antes de sair?",
      "Ha alteracoes que ainda nao foram salvas em \"" +
      (state.projeto ? state.projeto.nome : "") + "\".",
      [{ id: "salvar", texto: "Salvar e sair", tipo: "primary" },
       { id: "descartar", texto: "Sair sem salvar" },
       { id: "cancelar", texto: "Cancelar", tipo: "ghost", escape: true }]);

  if (escolha === "cancelar") { api.desistiuDeFechar(); return; }
  if (escolha === "salvar") await salvarProjeto();
  else await api.projetoRascunho(state.projeto.id, "");

  api.fecharAgora();
};
