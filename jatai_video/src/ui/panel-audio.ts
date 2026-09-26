// panel-audio.ts - o painel de audio: por enquanto, o volume do clipe

// ===================================================== conteudo: audio
//
// O volume vive no clipe, em decibeis, porque e assim que se fala dele. A
// mistura, no C++, quer amplitude - a conversao fica nas duas funcoes abaixo
// e em nenhum outro lugar.

import { api, remember, groupOf, clamp, fmtTime, state } from "./core";
import { refresh } from "./dock-view";
import { speedRowHtml, wireSpeedRow } from "./panel-imagem";
import { deletePoint } from "./panel-timeline";

export const VOL_MIN = -60;   // dB; daqui para baixo e silencio
export const VOL_MAX = 12;

export function dbToGain(db?) {
  if (db <= VOL_MIN) return 0;
  return Math.pow(10, db / 20);
}

export function clipDb(c?) {
  return c && typeof c.db === "number" ? c.db : 0;
}

// Onde a linha passa na faixa, de 0 (pe) a 1 (topo). O 0 dB fica na METADE:
// colado no topo, como era antes, a linha se escondia atras das barras mais
// altas e nao havia onde pegar os pontos. Assim a metade de baixo e atenuacao
// e a de cima e reforco, ate +12 dB.
export function dbToLine(db?) {
  if (db >= 0) return 0.5 + 0.5 * clamp(db / VOL_MAX, 0, 1);
  return 0.5 * clamp(1 - db / VOL_MIN, 0, 1);
}

export function lineToDb(pos?) {
  const p = clamp(pos, 0, 1);
  if (p >= 0.5) return (p - 0.5) * 2 * VOL_MAX;
  return VOL_MIN * (1 - p * 2);
}

// A altura da linha num instante do clipe. E ela que se interpola - e nao os
// decibeis nem o ganho - para que entre dois pontos a linha seja uma reta na
// tela: a forma e de quem arrasta os pontos.
export function envLineAt(c?, t?) {
  const pts = c.points;
  if (!pts || !pts.length) return dbToLine(clipDb(c));
  if (t <= pts[0].t) return dbToLine(pts[0].db);
  for (let i = 0; i + 1 < pts.length; ++i) {
    const a = pts[i], b = pts[i + 1];
    if (t <= b.t) {
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return dbToLine(a.db) + (dbToLine(b.db) - dbToLine(a.db)) * k;
    }
  }
  return dbToLine(pts[pts.length - 1].db);
}

// Os decibeis e o ganho daquele instante, os dois tirados da mesma linha.
export function envDbAt(c?, t?) { return lineToDb(envLineAt(c, t)); }
export function envGainAt(c?, t?) { return dbToGain(envDbAt(c, t)); }

// Manda a linha inteira para a mistura. Sem pontos vai o valor unico, que e o
// caminho barato do motor. Com o som parado nao faz mal nenhum: o motor nao
// tem trecho algum para casar, e a chamada se perde.
export function sendVolume(c?) {
  const pts = c.points || [];
  if (!pts.length) return api.setGain(c.id, dbToGain(clipDb(c)));

  // A mistura interpola ganho em linha reta, que nao e a mesma reta da tela -
  // a faixa tem 0 dB no meio. Em vez de repetir essa conta no C++, onde ela
  // sairia do lugar no primeiro ajuste, mandamos a linha ja picada: um ponto
  // a cada 50 ms de rampa, e entre eles a diferenca nao se ouve.
  const flat = [];
  const push = (t) => flat.push(t, envGainAt(c, t));

  push(pts[0].t);
  for (let i = 0; i + 1 < pts.length; ++i) {
    const a = pts[i].t, b = pts[i + 1].t;
    const steps = clamp(Math.ceil((b - a) / 0.05), 1, 64);
    for (let k = 1; k <= steps; ++k) push(a + (b - a) * (k / steps));
  }
  return api.setEnv(c.id, ...flat);
}

export function renderAudio(body?) {
  const clip = state.clips.find((c) => c.id === state.pickedClip);
  const m = clip ? state.media.find((x) => x.id === clip.media) : null;

  if (!clip || !m || !m.hasAudio) {
    body.innerHTML = '<div class="empty"><b>Nenhum clipe com som selecionado</b>' +
      '<div class="hint">Escolha um clipe na linha do tempo para ajustar o volume dele.</div></div>';
    return;
  }

  const db = clipDb(clip);
  const wrap = document.createElement("div");
  wrap.className = "audio-panel";
  wrap.innerHTML =
    '<div class="section">Clipe</div>' +
    '<div class="a-name"></div>' +
    '<div class="a-sub"></div>' +
    '<div class="section">Volume</div>' +
    '<div class="a-vol">' +
      '<input type="range" id="volSlider" min="' + VOL_MIN + '" max="' + VOL_MAX +
        '" step="0.5" value="' + db + '">' +
      '<div class="a-num">' +
        '<input type="number" id="volNum" min="' + VOL_MIN + '" max="' + VOL_MAX +
          '" step="0.5" value="' + db + '">' +
        '<span class="unit">dB</span>' +
      '</div>' +
    '</div>' +
    // Num clipe sem imagem, este e o painel que fala dele - e a velocidade
    // tem de estar aqui tambem, ou um audio solto nao teria por onde acelerar.
    speedRowHtml(clip) +
    '<div class="a-foot">' +
      '<button class="btn ghost" id="volReset">0 dB</button>' +
      '<button class="btn ghost" id="volMute">Silenciar</button>' +
      '<div class="spacer"></div>' +
    '</div>' +
    '<div class="section">Linha de volume</div>' +
    '<div class="a-env"></div>' +
    '<div class="a-point"></div>' +
    '<div class="a-foot">' +
      '<button class="btn ghost" id="envDel">Excluir ponto</button>' +
      '<button class="btn ghost" id="envClear">Apagar pontos</button>' +
    '</div>';
  body.appendChild(wrap);

  wrap.querySelector(".a-name").textContent = clip.name;
  // Dois clipes do mesmo arquivo tem o mesmo nome; o instante os separa.
  wrap.querySelector(".a-sub").textContent =
    "comeca em " + fmtTime(clip.start, true) + "  -  " + fmtTime(clip.len, true) + " de duracao";

  const pts = clip.points || [];
  wrap.querySelector(".a-env").textContent = pts.length
      ? pts.length + (pts.length === 1 ? " ponto" : " pontos")
      : "Sem pontos: botao direito sobre a linha, no clipe, abre o menu para "
        + "inserir um.";

  // O ponto selecionado: clicar nele no clipe, ou escolher no menu. Del
  // tambem o apaga, desde que esteja selecionado.
  const sel = pts.find((p) => p.id === state.pickedPoint);
  wrap.querySelector(".a-point").textContent = sel
      ? "Ponto em " + fmtTime(sel.t, true) + "  -  " +
        (sel.db <= VOL_MIN ? "silencio" : sel.db.toFixed(1) + " dB")
      : (pts.length ? "Nenhum ponto selecionado." : "");

  wrap.querySelector("#envDel").disabled = !sel;
  wrap.querySelector("#envDel").addEventListener("click", () => {
    if (sel) deletePoint(sel.id);
  });
  wrap.querySelector("#envClear").disabled = !pts.length;
  wrap.querySelector("#envClear").addEventListener("click", () => {
    remember();
    clip.points = [];
    state.pickedPoint = 0;
    refresh(["timeline", "audio"]);
    sendVolume(clip);
  });

  const slider = wrap.querySelector("#volSlider");
  const num = wrap.querySelector("#volNum");

  // O historico guarda o gesto, e nao cada pixel dele: arrastar o controle
  // dispara sessenta vezes, e sessenta passos de desfazer para um arrasto so
  // enterrariam tudo o que veio antes.
  slider.addEventListener("pointerdown", () => remember());
  // Os dois campos mexem no mesmo valor; cada um acerta o outro sem disparar
  // um ao outro de volta.
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    num.value = v;
    setClipDb(clip, v);
  });
  num.addEventListener("change", () => {
    remember();
    const v = clamp(Number(num.value) || 0, VOL_MIN, VOL_MAX);
    num.value = v;
    slider.value = v;
    setClipDb(clip, v);
  });

  wireSpeedRow(wrap, clip, () => refresh(["audio", "props"]));

  wrap.querySelector("#volReset").addEventListener("click", () => {
    remember();
    slider.value = 0; num.value = 0; setClipDb(clip, 0);
  });
  wrap.querySelector("#volMute").addEventListener("click", () => {
    remember();
    slider.value = VOL_MIN; num.value = VOL_MIN; setClipDb(clip, VOL_MIN);
  });
}

// Mexer no volume redesenha o clipe (as barras e a linha acompanham) e manda
// o valor para a mistura na hora. Nada de esperar nem de reiniciar o som: o
// motor troca o ganho no bloco seguinte, e o atraso que sobra e so a folga do
// anel - uma fracao de segundo.
//
// Vale para o BLOCO inteiro. Depois de fundir, as pecas continuam sendo pecas
// por dentro - uma janela so nao representa os pulos que o corte deixou -, mas
// para quem edita aquilo e um clipe: mexer no volume da primeira peca e nao
// nas outras era o bloco vazando por onde ninguem esperava.
export function setClipDb(clip?, db?) {
  const delta = db - clipDb(clip);
  groupOf(clip).forEach((c) => {
    c.db = db;
    // Com pontos na linha, o controle do painel move a linha toda sem
    // desmanchar o desenho: o que foi feito a mao continua valendo, mais alto
    // ou mais baixo.
    if (c.points && c.points.length) {
      c.points.forEach((p) => { p.db = clamp(p.db + delta, VOL_MIN, VOL_MAX); });
    }
    sendVolume(c);
  });
  refresh(["timeline"]);
}
