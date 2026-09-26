// exportar.ts - a montagem virando arquivo.
//
// Quem exporta nao quer escolher codificador nem perfil: quer um arquivo que
// o YouTube aceite. Entao as escolhas aqui sao tres - onde salvar, em que
// tamanho, e com quanta qualidade - e o resto e decidido pelo programa, que
// sabe o que essas plataformas pedem.
//
// O formato e sempre o mesmo: MP4 com H.264 e AAC. Nao e falta de opcao, e
// escolha: e a unica combinacao que toca em tudo, do YouTube ao celular de
// quem recebe por mensagem.

// Os tamanhos que resolvem quase tudo. "Como esta" respeita a area de visao
// que voce escolheu no projeto - e e o padrao, porque exportar num formato
// diferente do que se editou corta ou deixa tarja.
import { $, api, escapeHtml, select, clipSpeed, clipPieces, toast, fmtTime, state } from "./core";
import { pergunta } from "./dialogo";
import { projetoAberto, projetoDuracao } from "./projeto";
import { audioSegments } from "./panel-player";
import { clipTF, animPts } from "./panel-imagem";
import { fundoSolidez, fundoEncolher } from "./panel-efeitos";

export const EXPORT_TAMANHOS = [
  { id: "projeto", nome: "Como esta o projeto" },
  { id: "1080", nome: "1920 x 1080 - YouTube", w: 1920, h: 1080 },
  { id: "vertical", nome: "1080 x 1920 - TikTok, Reels, Shorts", w: 1080, h: 1920 },
  { id: "720", nome: "1280 x 720 - menor e mais leve", w: 1280, h: 720 },
];

// O CRF do x264 ao contrario, em palavras. Menor numero e melhor imagem.
export const EXPORT_QUALIDADES = [
  { id: "alta", nome: "Alta - arquivo maior", crf: 18 },
  { id: "boa", nome: "Boa - o equilibrio", crf: 20 },
  { id: "leve", nome: "Leve - arquivo menor", crf: 24 },
];

export function exportAtual() {
  if (!state.export)
    state.export = { tamanho: "projeto", qualidade: "boa", fps: 30,
                     rodando: false, feito: 0, total: 0 };
  return state.export;
}

// As camadas visuais, de baixo para cima - a mesma ordem em que a tela as
// empilha. O exportador desenha nesta ordem, entao o que cobre na previa
// cobre no arquivo.
export function exportCamadas() {
  const pistas = state.tracks.filter((t) => t.kind === "video");
  const ordem = new Map();
  // A pista do FIM da lista e a de baixo na tela; a ordem de desenho e a
  // inversa da ordem da lista.
  pistas.forEach((t, i) => ordem.set(t.id, pistas.length - i));

  const saida = [];
  state.clips
    .filter((c) => !c.off && c.media > 0 && c.kind !== "audio" && ordem.has(c.track))
    .sort((a, b) => ordem.get(a.track) - ordem.get(b.track))
    .forEach((c) => {
      const t = clipTF(c);
      const pts = animPts(c) || [];
      // Um clipe fundido tem pedacos: cada um e um trecho do arquivo, e
      // exportar so o primeiro deixaria o resto de fora.
      clipPieces(c).forEach((p) => {
        const camada = [c.media, c.start + p.a, p.dur, p.in, clipSpeed(c),
                        t.esc, t.x, t.y, t.rot || 0, c.fundo ? 1 : 0,
                        fundoSolidez(c), fundoEncolher(c), pts.length];
        // Os pontos vao em tempo DA CAMADA, e nao do clipe: para o exportador
        // cada pedaco e uma camada que comeca no proprio zero. Sem descontar
        // `p.a`, a animacao de um clipe fundido recomecaria em cada pedaco.
        //
        // Os que caem fora do pedaco vao junto de proposito: e deles que sai o
        // valor nas pontas, e cortados a imagem daria um salto na costura.
        pts.forEach((k) => camada.push(k.t - p.a, k.esc, k.x, k.y, k.rot || 0,
                                       k.s ? 1 : 0));
        saida.push(camada);
      });
    });
  return saida;
}

// Os trechos com som. Sai do mesmo lugar que alimenta a reproducao, para o
// arquivo soar como o editor soa.
export function exportSons() {
  // audioSegments devolve uma LISTA DE LISTAS - sete numeros por trecho, com
  // o numero do clipe na frente. Quem toca e que achata; aqui so se tira o
  // numero do clipe, que o exportador nao usa: ele nao precisa saber de que
  // clipe veio o som, so de que arquivo, quando e por quanto tempo.
  //
  // Ler isto como se ja viesse achatado - como o jtPlay faz DEPOIS - foi o
  // que exportou o primeiro video sem trilha nenhuma: o laco contava sete em
  // sete sobre uma lista de dois elementos e nunca entrava.
  return audioSegments().map((s) => [s[1], s[2], s[3], s[4], s[5], s[6]]);
}

export function exportTamanho() {
  const e = exportAtual();
  const p = EXPORT_TAMANHOS.find((x) => x.id === e.tamanho);
  if (p && p.w) return { w: p.w, h: p.h };
  return { w: state.canvas.w, h: state.canvas.h };
}

// ------------------------------------------------------------- o dialogo

export async function abreExportar() {
  if (!projetoAberto()) return;

  const dur = projetoDuracao();
  if (dur <= 0) {
    toast("Nao ha nada na linha do tempo para exportar.");
    return;
  }
  if (exportAtual().rodando) { toast("Ja ha uma exportacao em curso."); return; }

  const e = exportAtual();
  const temTexto = state.clips.some((c) => c.kind === "texto");

  const fundo = document.createElement("div");
  fundo.className = "dlg-fundo";
  fundo.innerHTML =
    '<div class="dlg dlg-export" role="dialog" aria-modal="true">' +
      '<div class="dlg-titulo">Exportar video</div>' +
      '<div class="dlg-texto"></div>' +
      '<div class="tx-row"><label>Tamanho</label>' +
        '<select id="exTam" class="nar-voz">' +
          EXPORT_TAMANHOS.map((t) => '<option value="' + t.id + '"' +
              (t.id === e.tamanho ? " selected" : "") + '>' +
              escapeHtml(t.nome) + '</option>').join("") +
        '</select></div>' +
      '<div class="tx-row"><label>Qualidade</label>' +
        '<select id="exQual" class="nar-voz">' +
          EXPORT_QUALIDADES.map((q) => '<option value="' + q.id + '"' +
              (q.id === e.qualidade ? " selected" : "") + '>' +
              escapeHtml(q.nome) + '</option>').join("") +
        '</select></div>' +
      '<div class="tx-row"><label>Quadros por segundo</label>' +
        '<select id="exFps" class="nar-voz">' +
          [24, 30, 60].map((f) => '<option value="' + f + '"' +
              (f === e.fps ? " selected" : "") + '>' + f + '</option>').join("") +
        '</select></div>' +
      (temTexto
        ? '<div class="dlg-aviso">Os textos da linha do tempo ainda NAO ' +
          'entram no arquivo exportado. Imagem, enquadramento e som saem ' +
          'completos.</div>'
        : "") +
      '<div class="dlg-botoes">' +
        '<button class="btn primary" id="exIr">Escolher destino e exportar</button>' +
        '<button class="btn ghost" id="exNao">Cancelar</button>' +
      '</div>' +
    '</div>';

  fundo.querySelector(".dlg-texto").textContent =
      "Sai um MP4 com H.264 e AAC - o formato que YouTube, TikTok, Instagram " +
      "e WhatsApp aceitam sem converter. Duracao: " + fmtTime(dur, false) + ".";

  document.body.appendChild(fundo);
  const fecha = () => fundo.remove();
  fundo.querySelector("#exNao").addEventListener("click", fecha);
  fundo.addEventListener("mousedown", (ev) => { if (ev.target === fundo) fecha(); });

  fundo.querySelector("#exIr").addEventListener("click", async () => {
    e.tamanho = fundo.querySelector("#exTam").value;
    e.qualidade = fundo.querySelector("#exQual").value;
    e.fps = Number(fundo.querySelector("#exFps").value) || 30;
    fecha();
    await fazExportar();
  });
}

export async function fazExportar() {
  const e = exportAtual();
  const dur = projetoDuracao();
  const tam = exportTamanho();
  const qual = EXPORT_QUALIDADES.find((q) => q.id === e.qualidade) ||
               EXPORT_QUALIDADES[1];

  // O destino primeiro: sem ele nao ha o que comecar, e o dialogo do Windows
  // e onde a pessoa ja sabe navegar.
  const alvo = await api.exportDestino((state.projeto.nome || "video") + ".mp4");
  if (!alvo || !alvo.ok) {
    if (alvo && alvo.error) toast(alvo.error);
    return;
  }

  const camadas = exportCamadas();
  const sons = exportSons();

  e.rodando = true;
  e.feito = 0;
  e.total = dur;
  pintaExportando();

  // Tudo num array so de numeros, com os contadores na frente: e o mesmo
  // estilo do jtPlay, e evita um analisador de JSON do lado do C++.
  const args = [alvo.destino, tam.w, tam.h, e.fps, qual.crf, dur,
                camadas.length, sons.length];
  camadas.forEach((c) => args.push.apply(args, c));
  sons.forEach((s) => args.push.apply(args, s));

  const r = await api.exportar.apply(null, args);
  e.rodando = false;
  pintaExportando();

  if (r && r.ok) {
    toast("Exportado: " + r.arquivo);
    // Quem codificou entra no aviso. Uma exportacao feita na CPU demora
    // varias vezes mais do que a mesma feita na placa, e sem esta linha nao
    // ha como a pessoa descobrir que a placa dela ficou de fora - nem que
    // valeria atualizar o driver.
    await pergunta("Video exportado",
        // Era "\\n" no jat.ai em C++, e a caixa mostrava a barra e o n ao pe
        // da letra. Agora e quebra de verdade, e .dlg-texto a respeita.
        "O arquivo esta em:\n" + r.arquivo +
        (r.motor ? "\n\nCodificado pela " + r.motor + "." : ""),
        [{ id: "ok", texto: "Fechar", tipo: "primary", escape: true }]);
  } else if (r && r.cancelado) {
    toast("Exportacao cancelada.");
  } else {
    toast((r && r.error) || "a exportacao falhou");
  }
}

// ------------------------------------------------------------ o progresso

// O C++ chama isto de tempos em tempos, da thread da exportacao.
window.jtExportProgresso = function (feito?, total?) {
  const e = exportAtual();
  e.feito = feito;
  e.total = total;
  pintaExportando();
};

export function pintaExportando() {
  const e = exportAtual();
  let barra = $("exportBarra");

  if (!e.rodando) { if (barra) barra.remove(); return; }

  if (!barra) {
    barra = document.createElement("div");
    barra.id = "exportBarra";
    barra.className = "export-barra";
    barra.innerHTML =
      '<div class="export-txt"></div>' +
      '<div class="export-trilho"><i></i></div>' +
      '<button class="btn ghost" id="exCancelar">Cancelar</button>';
    document.body.appendChild(barra);
    barra.querySelector("#exCancelar").addEventListener("click", () => {
      api.exportCancelar();
      barra.querySelector(".export-txt").textContent = "Cancelando...";
    });
  }

  const pct = e.total > 0 ? Math.min(100, Math.round(100 * e.feito / e.total)) : 0;
  barra.querySelector(".export-txt").textContent =
      "Exportando " + pct + "%  -  " + fmtTime(e.feito, false) +
      " de " + fmtTime(e.total, false);
  barra.querySelector(".export-trilho i").style.width = pct + "%";
}
