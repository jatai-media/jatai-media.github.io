// editor-lib.ts - as bibliotecas do Jatai no editor: `editor` e `time`
// (jatai/library/editor/editor.jat e jatai/library/time/time.jat), implementadas
// sobre o estado do editor, sem DLL nenhuma: quem responde e a propria pagina.
//
// O relogio do script e o tempo do VIDEO. `time.sleep` nao espera: avanca o
// relogio, e o que o script muda depois vale naquele instante. Zoom, posicao e
// giro viram pontos de animacao (os mesmos do painel Imagem) e o volume vira
// ponto da linha de volume: o editor caminha de um ponto ao outro, e os pontos
// podem ser ajustados a mao depois.
//
// O script nao coloca nem tira nada da linha do tempo: quem monta e a pessoa.
// Ele anima o que ja esta la, chamando cada clipe pelo id que a pessoa deu (ver
// ids.ts). O script inteiro vale um passo so no desfazer.

import editorJat from "../../jatai/library/editor/editor.jat?raw";
import timeJat from "../../jatai/library/time/time.jat?raw";
import { state, snapshot, rememberSnapshot, toast, clamp } from "../ui/core";
import { afterClipChange, projectEnd } from "../ui/panel-timeline";
import { seekCommit } from "../ui/panel-player";
import { TEXT_TAM_MIN, TEXT_TAM_MAX } from "../ui/texto";
import { ZOOM_MIN, ZOOM_MAX, ANIM_EPS, isFrameClip, animKey, tfAt } from "../ui/panel-imagem";
import { VOL_MIN, VOL_MAX, envDbAt, sendVolume } from "../ui/panel-audio";
import { rodaJatai, type Resultado } from "./jatai";
import { FONTES, achaFonte } from "../ui/fontes";
import { idDoClipe } from "./ids";

const ARQUIVOS = {
  "library/editor/editor.jat": editorJat,
  "library/time/time.jat": timeJat,
};

// os clipes que estao na montagem, na ordem em que comecam
function ordenados() {
  return state.clips.filter((c) => !c.off).sort((a, b) => a.start - b.start || a.id - b.id);
}

function clipe(i: number) {
  const c = ordenados()[i];
  if (!c) throw new Error(`editor: nao ha clipe ${i} (sao ${ordenados().length})`);
  return c;
}

function midia(i: number) {
  const m = state.media[i];
  if (!m) throw new Error(`editor: nao ha midia ${i} (sao ${state.media.length})`);
  return m;
}

// ------------------------------------------------ o que cada script fez
//
// Rodar um script de novo tem de SUBSTITUIR o que ele fez da outra vez, e nao
// somar: senao os pontos da versao antiga ficam no clipe junto com os da nova.
// Por isso tudo o que um script cria ou muda leva o id dele (o "dono"), e fica
// gravado no proprio clipe (vai junto no projeto salvo e no desfazer):
//
//   ponto criado pelo script           p.jdono = dono
//   ponto que ja existia e ele mudou   p.jantes[dono] = valores de antes
//   texto que ele mudou                c.jtexto[dono] = cor, tamanho, posicao... de antes
//
// Antes de rodar, limpaScript(dono) apaga os pontos do dono e devolve os valores
// de antes. Pontos feitos a mao ou por outro script ficam como estavam.

const CAMPOS_ANIM = ["esc", "x", "y", "rot", "s"];

function guardaAntes(obj: any, dono: string, campos: string[]) {
  if (!obj.jantes) obj.jantes = {};
  if (obj.jantes[dono]) return; // so o valor de antes da PRIMEIRA mudanca desta execucao
  const v: any = {};
  for (const k of campos) v[k] = obj[k];
  obj.jantes[dono] = v;
}

function devolveAntes(obj: any, dono: string): boolean {
  const v = obj.jantes?.[dono];
  if (!v) return false;
  for (const k of Object.keys(v)) {
    if (v[k] === undefined) delete obj[k];
    else obj[k] = v[k];
  }
  delete obj.jantes[dono];
  if (!Object.keys(obj.jantes).length) delete obj.jantes;
  return true;
}

/** Desfaz, nos clipes, o que o script `dono` fez da ultima vez que rodou.
    Devolve os clipes que mudaram (e quais deles mudaram o som). */
function limpaDono(dono: string) {
  const mudaram = new Set<any>(), som = new Set<any>();
  for (const c of state.clips) {
    if (c.anim?.length) {
      const n = c.anim.length;
      c.anim = c.anim.filter((p) => p.jdono !== dono);
      let m = c.anim.length !== n;
      for (const p of c.anim) m = devolveAntes(p, dono) || m;
      if (m) mudaram.add(c);
    }
    if (c.points?.length) {
      const n = c.points.length;
      c.points = c.points.filter((p) => p.jdono !== dono);
      let m = c.points.length !== n;
      for (const p of c.points) m = devolveAntes(p, dono) || m;
      if (m) { mudaram.add(c); som.add(c); }
    }
    const t = c.jtexto?.[dono];
    if (t && c.texto) {
      for (const k of ["cor", "tam", "x", "y", "rot", "fonte"]) {
        if (t[k] === undefined) delete c.texto[k];
        else c.texto[k] = t[k];
      }
      if (t.jtam === undefined) delete c.jtam;
      else c.jtam = t.jtam;
      delete c.jtexto[dono];
      if (!Object.keys(c.jtexto).length) delete c.jtexto;
      mudaram.add(c);
    }
  }
  return { mudaram, som };
}

/** Tira do video tudo o que o script `dono` fez (um passo no desfazer).
    Devolve quantos clipes mudaram. */
export function limpaScript(dono: string): number {
  const antes = snapshot();
  const { mudaram, som } = limpaDono(dono);
  if (!mudaram.size) return 0;
  rememberSnapshot(antes);
  som.forEach((c) => sendVolume(c));
  afterClipChange(["texto", "media", "player", "imagem", "audio"]);
  seekCommit(clamp(state.pos, 0, Math.max(0, projectEnd())));
  return mudaram.size;
}

/** Roda o script. `dono` identifica o script (o id dele na lista de scripts):
    o que a execucao anterior do mesmo dono fez e desfeito antes. */
export async function rodaNoEditor(fonte: string, dono = "script"): Promise<Resultado> {
  const antes = snapshot();
  const limpos = limpaDono(dono);
  let mudou = limpos.mudaram.size > 0;
  let relogio = 0;      // segundos de video
  let suave = false;    // editor.ease
  const somMudou = new Set<any>();

  // O clipe que responde por um id. O id e do clipe (ver ids.ts); varios clipes
  // so dividem um id quando sao metades de um corte (ou vieram de um projeto
  // antigo): vale o que esta no instante atual do relogio, senao o mais perto.
  function comp(id: string) {
    const cs = state.clips.filter((c) => !c.off && idDoClipe(c) === id);
    if (!cs.length)
      throw new Error(`editor: nada com o id "${id}" na linha do tempo (coloque o ` +
                      `elemento e de o id com o botao direito no clipe, na linha do tempo)`);
    const agora = cs.find((c) => relogio >= c.start - 1e-6 && relogio <= c.start + c.len + 1e-6);
    if (agora) return agora;
    const dist = (c) => Math.min(Math.abs(relogio - c.start), Math.abs(relogio - c.start - c.len));
    return cs.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  }

  // O ponto de animacao do instante atual (criado se preciso), ou null num texto.
  function ponto(id: string) {
    const c = comp(id);
    if (!isFrameClip(c)) return null;
    const t = clamp(relogio - c.start, 0, c.len);
    const existia = (c.anim || []).find((q) => Math.abs(q.t - t) <= ANIM_EPS);
    if (existia && existia.jdono !== dono) guardaAntes(existia, dono, CAMPOS_ANIM);
    const p = animKey(c, t);
    if (!existia) p.jdono = dono;
    p.s = suave ? 1 : 0;
    mudou = true;
    return p;
  }

  // Como o clipe esta no instante atual: {esc, x, y, rot} (x/y a partir do centro).
  function agora(id: string) {
    const c = comp(id);
    if (isFrameClip(c)) return tfAt(c, clamp(relogio - c.start, 0, c.len));
    if (!c.texto) throw new Error(`editor: "${id}" nao tem imagem nem texto`);
    return { esc: c.jtam ? c.texto.tam / c.jtam : 1, x: c.texto.x - 0.5, y: c.texto.y - 0.5,
             rot: c.texto.rot || 0 };
  }

  function texto(id: string) {
    const c = comp(id);
    if (!c.texto) throw new Error(`editor: "${id}" nao e um texto`);
    if (!c.jtexto) c.jtexto = {};
    if (!c.jtexto[dono])
      c.jtexto[dono] = { cor: c.texto.cor, tam: c.texto.tam, x: c.texto.x, y: c.texto.y,
                         fonte: c.texto.fonte,
                         rot: c.texto.rot, jtam: c.jtam };
    mudou = true;
    return c;
  }

  function mudaEscala(id: string, esc: (antes: number) => number) {
    const p = ponto(id);
    if (p) { p.esc = clamp(esc(p.esc), ZOOM_MIN, ZOOM_MAX); return; }
    const c = texto(id); // texto: muda a letra, a partir do tamanho do modelo
    if (c.jtam == null) c.jtam = c.texto.tam;
    c.texto.tam = clamp(c.jtam * esc(c.texto.tam / c.jtam), TEXT_TAM_MIN, TEXT_TAM_MAX);
  }

  function mudaPosicao(id: string, pos: (x: number, y: number) => number[]) {
    const p = ponto(id);
    // o script conta do centro, como o painel Imagem (-0.3 = os -30% X do painel)
    if (p) { [p.x, p.y] = pos(p.x, p.y); return; }
    // o texto guarda de 0 a 1 a partir do canto; o script ve a partir do centro
    const c = texto(id);
    [c.texto.x, c.texto.y] = pos(c.texto.x - 0.5, c.texto.y - 0.5).map((v) => clamp(v + 0.5, 0, 1));
  }

  function mudaGiro(id: string, giro: (antes: number) => number) {
    const p = ponto(id);
    if (p) { p.rot = giro(p.rot); return; }
    const c = texto(id);
    c.texto.rot = giro(c.texto.rot || 0);
  }

  // Volume: um ponto da linha de volume do clipe no instante atual.
  function mudaVolume(id: string, db: (antes: number) => number) {
    const c = comp(id);
    if (c.kind === "texto" || c.kind === "imagem") throw new Error(`editor: "${id}" nao tem som`);
    const t = clamp(relogio - c.start, 0, c.len);
    if (!c.points) c.points = [];
    let p = c.points.find((q) => Math.abs(q.t - t) <= ANIM_EPS);
    if (p && p.jdono !== dono) guardaAntes(p, dono, ["db"]);
    if (!p) {
      p = { id: state.nextId++, t, db: envDbAt(c, t), jdono: dono };
      c.points.push(p);
      c.points.sort((a, b) => a.t - b.t);
    }
    p.db = clamp(db(p.db), VOL_MIN, VOL_MAX);
    somMudou.add(c);
    mudou = true;
  }

  const r = await rodaJatai(fonte, ARQUIVOS, {
    time: {
      now: () => relogio,
      sleep: (s: number) => { relogio = Math.max(0, relogio + s); },
      at: (s: number) => { relogio = Math.max(0, s); },
    },
    editor: {
      exists: (id: string) => state.clips.some((c) => !c.off && idDoClipe(c) === id),

      // Mesmas medidas e unidades do painel Imagem, em inteiros: zoom em % (50 =
      // metade), posicao em % a partir do centro (-30 = os -30% X do painel) e
      // giro em graus. zoom_by e um fator (1.1 = 10% maior), e fica double.
      zoom: (id: string, pct: number) => mudaEscala(id, () => pct / 100),
      zoom_by: (id: string, f: number) => mudaEscala(id, (e) => e * f),
      move: (id: string, x: number, y: number) => mudaPosicao(id, () => [x / 100, y / 100]),
      move_by: (id: string, dx: number, dy: number) =>
        mudaPosicao(id, (x, y) => [x + dx / 100, y + dy / 100]),
      rotate: (id: string, g: number) => mudaGiro(id, () => g),
      rotate_by: (id: string, g: number) => mudaGiro(id, (r) => r + g),
      scale: (id: string) => Math.round(agora(id).esc * 100),
      pos_x: (id: string) => Math.round(agora(id).x * 100),
      pos_y: (id: string) => Math.round(agora(id).y * 100),
      rotation: (id: string) => Math.round(agora(id).rot),
      ease: (s: boolean) => { suave = s; },

      volume: (id: string, db: number) => mudaVolume(id, () => db),
      volume_by: (id: string, db: number) => mudaVolume(id, (v) => v + db),
      volume_now: (id: string) => {
        const c = comp(id);
        return envDbAt(c, clamp(relogio - c.start, 0, c.len));
      },

      color: (id: string, cor: string) => { texto(id).texto.cor = cor; },
      font: (id: string, nome: string) => {
        const f = achaFonte(nome);
        if (!f) throw new Error(`editor: nao ha a fonte "${nome}". As fontes sao: ` +
                                FONTES.map((x) => x.nome).join(", "));
        texto(id).texto.fonte = f.id;
      },
      // em % da altura da tela, como o campo Tamanho do painel Texto
      size: (id: string, pct: number) => {
        const c = texto(id);
        c.texto.tam = c.jtam = clamp(pct / 100, TEXT_TAM_MIN, TEXT_TAM_MAX);
      },

      duration: () => projectEnd(),
      cursor: () => state.pos,
      seek: (s: number) => seekCommit(Math.max(0, s)),
      start_of: (id: string) => comp(id).start,
      length_of: (id: string) => comp(id).len,
      clips: () => ordenados().length,
      clip_name: (i: number) => clipe(i).name || "",
      clip_kind: (i: number) => clipe(i).kind || "",
      clip_start: (i: number) => clipe(i).start,
      clip_length: (i: number) => clipe(i).len,
      clip_id: (i: number) => idDoClipe(clipe(i)),
      medias: () => state.media.length,
      media_name: (i: number) => midia(i).name,
      media_kind: (i: number) => midia(i).kind,
      toast: (msg: string) => toast(msg),
    },
  });

  if (mudou) {
    rememberSnapshot(antes);
    limpos.som.forEach((c) => somMudou.add(c));
    somMudou.forEach((c) => sendVolume(c));
    afterClipChange(["texto", "media", "player", "imagem", "audio"]);
    seekCommit(clamp(state.pos, 0, Math.max(0, projectEnd())));
  }
  return r;
}
