// panel-efeitos.ts - o painel de Efeitos.
//
// Por enquanto ha um efeito de verdade aqui, e ele nao se parece com os outros
// da lista. Desfoque, Brilho e Vinheta sao contas por pixel: ligam e desligam
// na hora. Remover o fundo e uma PASSADA - uns minutos de rede neural pelo
// arquivo inteiro, com barra de progresso - cujo resultado fica guardado em
// disco. Por baixo ele e irmao do "Separar voz", e nao do "Desfoque".
//
// Dai os dois estados do azulejo: da primeira vez e uma espera; dali em diante
// e um interruptor, porque o recorte ja esta pronto e so falta usa-lo. A chave
// e o CAMINHO do arquivo, entao o recorte de ontem ainda vale hoje - e, como
// ele e por arquivo e o interruptor e por clipe, o mesmo video entra duas vezes
// na montagem, recortado em cima e inteiro embaixo, de uma passada so.

import { $, api, escapeHtml, snapshot, rememberSnapshot, clipPieces, toast, fmtTime, state } from "./core";
import { marcaSujo } from "./projeto";
import { refresh } from "./dock-view";
import { requestPreview } from "./panel-player";
import { isText } from "./texto";

export const EFEITOS_PORVIR = ["Desfoque", "Brilho", "Vinheta", "Granulado",
                        "Espelho", "Tremor"];

// O acabamento da borda. Nao esta gravado no recorte - a passada custa minutos,
// e estes dois sao justamente os valores que se mexe olhando a tela -, entao
// eles vivem no clipe e sao aplicados na hora de compor.
//
// FIRMEZA. A rede entrega meio alfa onde ficou em duvida, e ela fica em duvida
// em coisa escura e brilhante: um fone de ouvido preto sai traslucido, com o
// fundo aparecendo atraves dele. Firmeza e a partir de que alfa o pixel passa a
// ser pessoa inteira. Nao adianta trocar de modelo: o grande, quatro vezes mais
// lento, deixa os mesmos buracos.
//
// ENCOLHER. A cor da pessoa sai do proprio video, e o pixel da borda carrega um
// pouco da parede antiga misturado. Sobre um fundo novo isso vira um contorno
// claro em volta. Tirar um pixel da borda leva junto quase toda a mistura.
export const FUNDO_SOLIDEZ = 0.5;
export const FUNDO_ENCOLHER = 1;

export function fundoSolidez(c?) {
  return c && typeof c.fundoSolidez === "number" ? c.fundoSolidez : FUNDO_SOLIDEZ;
}
export function fundoEncolher(c?) {
  return c && typeof c.fundoEncolher === "number" ? c.fundoEncolher : FUNDO_ENCOLHER;
}

// O trecho do ARQUIVO que a montagem usa deste item: do menor ponto de entrada
// ao maior ponto de saida, somando todos os clipes que saem dele.
//
// Quem sabe isto e a pagina, e nao o C++ - ele le e escreve os bytes do projeto
// sem entender a montagem. E saber isto vale minutos: um arquivo de treze
// minutos do qual se usa um custava treze minutos de rede para jogar doze fora.
//
// Os descartados entram: eles ainda estao na linha do tempo, e trazer um de
// volta nao pode pedir a passada de novo.
export function fundoTrecho(mediaId?) {
  let t0 = Infinity, t1 = -Infinity;
  state.clips.filter((c) => c.media === mediaId && !isText(c))
    .forEach((c) => {
      clipPieces(c).forEach((p) => {
        if (p.in < t0) t0 = p.in;
        if (p.in + p.len > t1) t1 = p.in + p.len;
      });
    });
  return t1 > t0 ? { t0: Math.max(0, t0), t1: t1 } : null;
}

export function renderEfeitos(body?) {
  body.classList.add("fill-col");

  const scroll = document.createElement("div");
  scroll.className = "scroll";
  body.appendChild(scroll);

  const clip = state.clips.find((c) => c.id === state.pickedClip);
  const usavel = clip && !isText(clip) && clip.kind !== "audio" && clip.media > 0;
  const m = usavel ? state.media.find((x) => x.id === clip.media) : null;

  // ------------------------------------------------------- remover o fundo
  const caixa = document.createElement("div");
  caixa.className = "ef-caixa";

  let estado, acao, pode = true;
  if (state.fundo.rodando) {
    estado = "Recortando " + escapeHtml(state.fundo.nome) + "...";
    acao = "";
    pode = false;
  } else if (!usavel) {
    estado = "Escolha um clipe de video na linha do tempo.";
    acao = "";
    pode = false;
  } else if (!state.fundo.modelo) {
    estado = "O recorte de fundo ainda nao chegou a versao para navegador.";
    acao = "";
    pode = false;
  } else if (m && m.hasFundo) {
    estado = clip.fundo
        ? "O fundo deste clipe esta fora. Desligue para ve-lo inteiro."
        : "O recorte deste arquivo ja esta pronto - e so ligar.";
    acao = clip.fundo ? "Desligar" : "Ligar";
  } else {
    // O tempo pedido e o do TRECHO, e nao o do arquivo: dizer "treze minutos"
    // de um video do qual se usa um faria desistir de um botao que levaria
    // pouco mais de dois.
    const tr = usavel ? fundoTrecho(clip.media) : null;
    const dura = tr ? tr.t1 - tr.t0 : (m ? m.duration : 0);
    estado = "Este arquivo ainda nao foi recortado. A passada cobre so o " +
             "trecho em uso - " + fmtTime(dura, false) + " dos " +
             fmtTime(m ? m.duration : 0, false) + " do arquivo - e so " +
             "precisa ser feita uma vez.";
    acao = "Remover o fundo";
  }

  caixa.innerHTML =
    '<div class="ef-titulo">Remover o fundo</div>' +
    '<div class="ef-texto">' + estado + '</div>' +
    (acao ? '<button class="btn primary" id="efFundo">' + acao + '</button>' : "") +
    (clip && clip.fundo
      ? '<div class="ef-dica">Para por texto ATRAS de voce: ponha o mesmo ' +
        'clipe numa pista abaixo desta, sem o recorte, e o texto entre as duas.'
        + '</div>'
      : "");
  scroll.appendChild(caixa);

  // Os controles so aparecem com o efeito ligado: desligado eles nao teriam o
  // que mexer, e um controle que nao faz nada ensina a ignorar o painel.
  if (clip && clip.fundo && m && m.hasFundo) {
    const ajustes = document.createElement("div");
    ajustes.className = "ef-ajustes";
    ajustes.innerHTML =
      '<div class="ef-linha"><label>Firmeza</label>' +
        '<input type="range" id="efSol" min="10" max="100" step="5" value="' +
          Math.round(fundoSolidez(clip) * 100) + '">' +
        '<span class="ef-val" id="efSolV">' +
          Math.round(fundoSolidez(clip) * 100) + '%</span></div>' +
      '<div class="ef-linha"><label>Encolher a borda</label>' +
        '<input type="range" id="efEnc" min="0" max="4" step="1" value="' +
          fundoEncolher(clip) + '">' +
        '<span class="ef-val" id="efEncV">' + fundoEncolher(clip) + ' px</span></div>' +
      '<div class="ef-dica">Firmeza tapa buracos em coisa escura - fone de ' +
        'ouvido, oculos de armacao grossa. Encolher tira o contorno claro que ' +
        'sobra da parede antiga. Demais nos dois come fio de cabelo.</div>';
    scroll.appendChild(ajustes);

    // Enquanto arrasta, so a tela e o numero; o desfazer e a gravacao esperam a
    // mao largar. Um arrasto sao dezenas de eventos, e um passo de desfazer em
    // cada um deixaria o Ctrl+Z inutil.
    const liga = (id, campo, fmt, transforma) => {
      const inp = ajustes.querySelector("#" + id);
      const eco = ajustes.querySelector("#" + id + "V");
      let antes = null;
      inp.addEventListener("pointerdown", () => { antes = snapshot(); });
      inp.addEventListener("input", () => {
        const v = transforma(Number(inp.value));
        clip[campo] = v;
        eco.textContent = fmt(v);
        // Nao `refresh(["player"])`: refazer o painel trocaria os <img> por
        // outros no meio do arrasto, e a tela piscaria a cada entalhe. A chave
        // da previa ja inclui estes dois valores, entao basta pedir o quadro.
        requestPreview();
      });
      inp.addEventListener("change", () => {
        if (antes) { rememberSnapshot(antes); antes = null; }
        else marcaSujo();
      });
    };
    liga("efSol", "fundoSolidez", (v) => Math.round(v * 100) + "%", (v) => v / 100);
    liga("efEnc", "fundoEncolher", (v) => v + " px", (v) => v);
  }

  const botao = caixa.querySelector("#efFundo");
  if (botao && pode) {
    botao.addEventListener("click", () => {
      // Desligar e so desligar. LIGAR passa sempre pelo C++, mesmo havendo
      // recorte: e la que se sabe se o que existe cobre o trecho que este clipe
      // usa hoje. Esticar a ponta de um clipe para alem do que foi recortado
      // deixaria a pessoa sumir da tela, e ninguem ligaria uma coisa na outra.
      // Cobrindo, a resposta volta na hora e a barra nem chega a aparecer.
      if (clip.fundo) { alternaFundo(clip); return; }
      doFundo(clip);
    });
  }

  // ------------------------------------------------------------ o que vem
  const titulo = document.createElement("div");
  titulo.className = "ef-titulo ef-porvir";
  titulo.textContent = "Ainda por fazer";
  scroll.appendChild(titulo);

  const grid = document.createElement("div");
  grid.className = "tile-grid";
  EFEITOS_PORVIR.forEach((n) => {
    const t = document.createElement("div");
    t.className = "tile";
    t.textContent = n;
    t.addEventListener("click", () => toast(n + ": ainda nao implementado."));
    grid.appendChild(t);
  });
  scroll.appendChild(grid);
}

// Ligar e desligar nao recalcula nada: o recorte esta no disco, e o que muda e
// se este clipe o usa. Por isso e imediato, e por isso a previa so precisa
// pedir o quadro de novo.
export function alternaFundo(clip?) {
  if (!clip) return;
  clip.fundo = !clip.fundo;
  marcaSujo();
  refresh(["efeitos", "player", "props"]);
  toast(clip.fundo ? "Fundo removido neste clipe." : "Fundo de volta.");
}

export async function doFundo(clip?) {
  if (state.fundo.rodando) { toast("Ja ha um recorte em curso."); return; }
  const m = state.media.find((x) => x.id === clip.media);
  if (!m) return;

  const tr = fundoTrecho(clip.media);

  state.fundo.rodando = true;
  state.fundo.nome = m.name;
  state.fundo.feito = 0;
  // A barra mede o TRECHO, que e o que vai correr. Medindo o arquivo, ela
  // pararia em 8% e ficaria parecendo travada.
  state.fundo.total = tr ? tr.t1 - tr.t0 : (m.duration || 0);
  refresh(["efeitos"]);
  pintaFundo();

  const r = await api.fundo(m.id, tr ? tr.t0 : 0, tr ? tr.t1 : 0);

  state.fundo.rodando = false;
  state.media = await api.getMedia();
  pintaFundo();

  if (r && r.cancelado) { refresh(["efeitos"]); toast("Recorte cancelado."); return; }
  if (!r || !r.ok) {
    refresh(["efeitos"]);
    toast((r && r.error) || "nao foi possivel recortar este video.");
    return;
  }

  // Quem pediu quer ver: esperar minutos e depois ter de ligar um interruptor
  // seria pedir duas vezes a mesma coisa.
  clip.fundo = true;
  marcaSujo();
  refresh(["efeitos", "player", "props", "media"]);
  // Quem fez a conta entra no aviso, como na exportacao. A passada na placa e
  // tres vezes mais rapida que na CPU, e sem esta linha nao ha como a pessoa
  // descobrir que a placa dela ficou de fora - nem que valeria atualizar o
  // driver antes de reclamar da espera.
  toast(r.jaTinha
      ? "Este arquivo ja estava recortado - o efeito foi ligado."
      : "Fundo removido" + (r.motor ? ", pela " + r.motor : "") + ". Para por " +
        "texto atras de voce, repita o clipe numa pista abaixo desta, sem o " +
        "efeito.");
}

window.jtFundoProgresso = function (feito?, total?) {
  state.fundo.feito = feito;
  state.fundo.total = total;
  pintaFundo();
};

// A mesma barra da exportacao, no mesmo canto e com o mesmo cancelar: sao duas
// esperas longas do mesmo tipo, e duas barras diferentes para elas so dariam
// duas coisas para aprender.
export function pintaFundo() {
  const f = state.fundo;
  let barra = $("fundoBarra");

  if (!f.rodando) { if (barra) barra.remove(); return; }

  if (!barra) {
    barra = document.createElement("div");
    barra.id = "fundoBarra";
    barra.className = "export-barra";
    barra.innerHTML =
      '<div class="export-txt"></div>' +
      '<div class="export-trilho"><i></i></div>' +
      '<button class="btn ghost" id="fuCancelar">Cancelar</button>';
    document.body.appendChild(barra);
    barra.querySelector("#fuCancelar").addEventListener("click", () => {
      api.fundoCancelar();
      barra.querySelector(".export-txt").textContent = "Cancelando...";
    });
  }

  const pct = f.total > 0 ? Math.min(100, Math.round(100 * f.feito / f.total)) : 0;
  barra.querySelector(".export-txt").textContent =
      "Removendo o fundo " + pct + "%  -  " + fmtTime(f.feito, false) +
      " de " + fmtTime(f.total, false);
  barra.querySelector(".export-trilho i").style.width = pct + "%";
}
