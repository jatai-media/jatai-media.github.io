// panel-narrador.ts - escrever um texto, OUVIR, e so entao mandar para a
// linha do tempo.
//
// O texto daqui NAO vai para a tela: ele vira som, e so. E a diferenca entre
// este painel e o de Texto - la se escreve o que o espectador le, aqui o que
// ele ouve.
//
// Entre escrever e ter um clipe ha um passo no meio, e ele e o motivo deste
// painel existir em vez de um botao: a narracao nasce como PREVIA, que se
// ouve ali mesmo. Antes disso, cada tentativa de entonacao virava um clipe na
// linha do tempo e um arquivo no disco - experimentar custava faxina. Agora
// so o que agradou e que vira clipe.
//
// A previa vale para o texto, a voz e o ritmo que a geraram. Mudou qualquer um
// dos tres, ela e descartada: mandar para a linha do tempo uma fala diferente
// da que se ouviu seria pior do que nao ter previa nenhuma.
//
// A voz e um modelo neural que mora ao lado do programa, em modelos/vozes.
// Quais existem quem diz e o C++, que le a pasta - a lista nunca e digitada
// aqui, senao um dia ela discordaria do que esta instalado.

import { api, escapeHtml, select, toast, clamp, state } from "./core";
import { refresh } from "./dock-view";
import { addToTimeline } from "./panel-timeline";

export const NAR_VEL_MIN = 0.5;
export const NAR_VEL_MAX = 2;

// O que se escreveu fica no estado, e nao na caixa: o painel se redesenha
// sozinho a cada mudanca de selecao, e um paragrafo perdido por trocar de aba
// seria um jeito rapido de nunca mais confiar nele.
export function narracaoAtual() {
  if (!state.narracao)
    state.narracao = { voz: "", texto: "", vel: 1, fazendo: false, aviso: "",
                       previa: null };
  return state.narracao;
}

// As vozes chegam uma vez por sessao. Enquanto nao chegam, o painel mostra o
// que sabe - e nao uma caixa vazia, que pareceria defeito.
export async function carregaVozes() {
  if (state.vozes) return state.vozes;
  const r = await api.voices();
  state.vozes = (r && r.vozes) || [];
  state.vozesErro = (r && r.erro) || "";
  const n = narracaoAtual();
  // Reler a lista e comecar de novo: o recado da tentativa anterior falava de
  // um estado que acabou de ser conferido outra vez, e deixa-lo no lugar
  // esconderia o motivo novo - por exemplo, que agora nao ha voz nenhuma.
  n.aviso = "";
  if (!n.voz && state.vozes.length) {
    const salva = state.narradorVoz;
    const tem = state.vozes.some((v) => v.id === salva);
    n.voz = tem ? salva : state.vozes[0].id;
  }
  refresh(["narrador"]);
  return state.vozes;
}

// A previa combina com o que esta escrito agora? Quem responde e a comparacao
// com o que foi realmente falado - e nao a ordem em que os eventos chegaram.
export function previaValida(n?) {
  const p = n.previa;
  return !!p && p.texto === (n.texto || "").trim() && p.voz === n.voz &&
         Math.abs(p.vel - n.vel) < 1e-9;
}

export function renderNarrador(body?) {
  const n = narracaoAtual();
  if (!state.vozes) carregaVozes();

  const vozes = state.vozes || [];
  const tem = previaValida(n);

  const wrap = document.createElement("div");
  wrap.className = "tf-panel";
  wrap.innerHTML =
    '<div class="section">Narrador</div>' +
    '<div class="tx-row">' +
      '<label>Voz</label>' +
      '<select id="narVoz" class="nar-voz">' +
        (vozes.length
          // O nome de uma voz treinada e o que voce digitou na aba Minha
          // voz, e vai parar dentro de HTML: sem escapar, um "&" ou um "<" no
          // nome quebrariam a lista inteira.
          ? vozes.map((v) => '<option value="' + escapeHtml(v.id) + '"' +
              (v.id === n.voz ? " selected" : "") + '>' + escapeHtml(v.nome) +
              '</option>').join("")
          : '<option value="">' +
            (state.vozes ? "nenhuma voz instalada" : "procurando...") + '</option>') +
      '</select>' +
      // A pasta das vozes muda quando um treino termina, e o programa nao fica
      // de olho nela. Este botao a le de novo.
      '<button class="btn ghost nar-recarrega" id="narRecarrega" ' +
        'title="Procurar vozes novas">&#8635;</button>' +
    '</div>' +
    '<div class="tx-row">' +
      '<label>Ritmo</label>' +
      '<input type="range" id="narVel" min="' + Math.round(NAR_VEL_MIN * 100) +
        '" max="' + Math.round(NAR_VEL_MAX * 100) + '" step="5" value="' +
        Math.round(n.vel * 100) + '">' +
      '<div class="a-num"><input type="number" id="narVelN" min="' + NAR_VEL_MIN +
        '" max="' + NAR_VEL_MAX + '" step="0.05" value="' + n.vel.toFixed(2) +
        '"><span class="unit">&times;</span></div>' +
    '</div>' +
    '<textarea id="narTexto" class="tx-area" rows="7" placeholder="' +
      'Escreva aqui o que o narrador deve ler. Virgulas e pontos mudam o ' +
      'ritmo da leitura."></textarea>' +
    '<div class="hint">Este texto nao aparece no video: vira uma trilha de ' +
      'voz na linha do tempo, a partir da agulha.</div>' +
    '<div class="a-foot">' +
      '<button class="btn' + (tem ? " ghost" : " primary") + '" id="narOuvir">' +
        (tem ? "Ouvir de novo" : "Ouvir") + '</button>' +
      '<span class="nar-aviso" id="narAviso"></span>' +
    '</div>' +
    // O bloco da previa nasce escondido e so aparece com som para tocar. Ele
    // fica DEPOIS do botao de ouvir, que e a ordem em que as coisas acontecem.
    '<div class="nar-previa" id="narPrevia"' + (tem ? "" : " hidden") + '>' +
      '<audio id="narAudio" controls preload="auto"' +
        (tem ? ' src="' + n.previa.url + '"' : "") + '></audio>' +
      '<div class="a-foot">' +
        '<button class="btn primary" id="narEnviar">Enviar para a linha do tempo</button>' +
        '<span class="hint" id="narDados">' +
          (tem ? n.previa.segundos.toFixed(1) + "s  -  " + n.previa.vozNome : "") +
        '</span>' +
      '</div>' +
    '</div>';
  body.appendChild(wrap);

  const bloco = wrap.querySelector("#narPrevia");
  // Descartar a previa na mao, sem refazer o painel: refazer tiraria o foco
  // de quem esta digitando, e e digitando que se descarta.
  const descarta = () => {
    if (!n.previa) return;
    n.previa = null;
    bloco.hidden = true;
    const som = wrap.querySelector("#narAudio");
    som.pause();
    som.removeAttribute("src");
    const b = wrap.querySelector("#narOuvir");
    b.textContent = "Ouvir";
    b.classList.remove("ghost");
    b.classList.add("primary");
  };

  const caixa = wrap.querySelector("#narTexto");
  caixa.value = n.texto;
  caixa.addEventListener("input", () => {
    n.texto = caixa.value;
    if (!previaValida(n)) descarta();
  });

  const recarrega = wrap.querySelector("#narRecarrega");
  if (recarrega) recarrega.addEventListener("click", async () => {
    const antes = (state.vozes || []).length;
    state.vozes = null;
    const lista = await carregaVozes();
    toast(lista.length > antes
        ? "Voz nova encontrada: " + lista[lista.length - 1].nome + "."
        : lista.length + (lista.length === 1 ? " voz instalada." : " vozes instaladas."));
  });

  const escolha = wrap.querySelector("#narVoz");
  escolha.addEventListener("change", () => {
    n.voz = escolha.value;
    api.setPref("narradorVoz", n.voz);
    descarta();
  });

  const cursor = wrap.querySelector("#narVel");
  const campo = wrap.querySelector("#narVelN");
  const mostra = (de) => {
    if (de !== cursor) cursor.value = String(Math.round(n.vel * 100));
    if (de !== campo) campo.value = n.vel.toFixed(2);
  };
  cursor.addEventListener("input", () => {
    n.vel = clamp(Number(cursor.value) / 100, NAR_VEL_MIN, NAR_VEL_MAX);
    mostra(cursor);
    descarta();
  });
  campo.addEventListener("change", () => {
    const pedido = Number(campo.value);
    n.vel = isFinite(pedido) ? clamp(pedido, NAR_VEL_MIN, NAR_VEL_MAX) : 1;
    mostra(campo);
    descarta();
  });

  // O recado vem do estado: escrito so no elemento, ele nao sobreviveria ao
  // proximo refresh - que e justamente o que acontece assim que a narracao
  // termina, bem ou mal.
  const aviso = wrap.querySelector("#narAviso");
  aviso.textContent = n.aviso || state.vozesErro || "";

  const ouvir = wrap.querySelector("#narOuvir");
  if (n.fazendo) { ouvir.disabled = true; ouvir.textContent = "Gerando..."; }
  ouvir.addEventListener("click", () => geraPrevia(wrap));

  wrap.querySelector("#narEnviar").addEventListener("click", () => enviaPrevia(wrap));
}

// Do texto a previa: gera e toca ali mesmo, sem tocar na linha do tempo.
export async function geraPrevia(wrap?) {
  const n = narracaoAtual();
  const ouvir = wrap.querySelector("#narOuvir");

  const texto = (n.texto || "").trim();
  if (!texto) { toast("Escreva o que o narrador deve ler."); return; }
  if (!n.voz) { toast(state.vozesErro || "Nenhuma voz instalada."); return; }

  n.fazendo = true;
  n.aviso = "";
  ouvir.disabled = true;
  ouvir.textContent = "Gerando...";

  try {
    const r = await api.narrate(n.voz, texto, n.vel);
    if (!r || !r.ok) {
      n.aviso = (r && r.error) || "a narracao falhou";
      n.previa = null;
      return;
    }

    n.previa = { url: r.url || "", arquivo: r.arquivo, segundos: r.segundos,
                 vozNome: r.voz, voz: n.voz, texto: texto, vel: n.vel };
    // Sem endereco servido nao ha como tocar aqui dentro. O clipe continua
    // possivel, e dizer isso e melhor do que um tocador mudo.
    if (!r.url) n.aviso = "nao da para ouvir nesta janela - da para enviar";
  } finally {
    n.fazendo = false;
    refresh(["narrador"]);
    // Tocar so depois do refresh: o <audio> de agora e outro elemento.
    const som = document.getElementById("narAudio");
    if (som && som.getAttribute("src")) som.play().catch(() => {});
  }
}

// A previa agradou: vira arquivo guardado, entra na cesta e cai na agulha.
export async function enviaPrevia(wrap?) {
  const n = narracaoAtual();
  if (!previaValida(n)) {
    n.aviso = "o texto mudou depois da previa - ouca de novo";
    refresh(["narrador"]);
    return;
  }

  const botao = wrap.querySelector("#narEnviar");
  botao.disabled = true;
  n.aviso = "";

  try {
    const posto = await api.keepNarration(n.previa.arquivo);
    if (!posto || !posto.ok) {
      n.aviso = (posto && posto.error) || "a narracao nao pode ser guardada";
      return;
    }

    state.media = await api.getMedia();
    const item = state.media.find((m) => m.id === posto.id);
    if (!item) { n.aviso = "o arquivo nao entrou na cesta"; return; }

    // Entra onde esta a agulha, que e onde quem escreveu estava olhando.
    addToTimeline(item, null, state.pos);
    refresh(["timeline", "media", "props"]);
    toast("Narracao de " + n.previa.segundos.toFixed(1) + "s com a voz " +
          n.previa.vozNome + ".");
  } finally {
    botao.disabled = false;
    refresh(["narrador"]);
  }
}
