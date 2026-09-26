// A forma de onda e as pausas - o waveform.h, no navegador.
//
// O resumo e calculado uma vez por arquivo: a trilha inteira e decodificada e
// guarda-se um par (min, max) a cada bloco de ~10,7 ms. Com isso na memoria,
// qualquer zoom e atendido reamostrando, e achar as pausas nao decodifica nada
// de novo. Cada coluna leva o MAIOR pico do trecho que representa, nunca a
// media, que achataria os transientes.

import { AudioBufferSink } from 'mediabunny';
import { cesta, type Entrada } from './midia';
import { filaLenta } from './quadros';

interface Onda {
  ok: boolean;
  error?: string;
  lo: Float32Array;   // pico negativo por bloco, -1..0
  hi: Float32Array;   // pico positivo por bloco, 0..1
  hop: number;        // quadros por bloco, na taxa do arquivo
  rate: number;
  peak: number;       // maior pico do arquivo inteiro
}

// No C++ o bloco era de 512 quadros a 48 kHz. Aqui a trilha e lida na taxa
// dela, e o bloco acompanha - o numero de blocos por segundo fica o mesmo.
const HOP_48K = 512;

const resumos = new Map<number, Promise<Onda>>();

export function esqueceOnda(id: number): void {
  resumos.delete(id);
}

function resumoDe(e: Entrada): Promise<Onda> {
  let p = resumos.get(e.item.id);
  if (!p) {
    p = calcula(e);
    resumos.set(e.item.id, p);
  }
  return p;
}

async function calcula(e: Entrada): Promise<Onda> {
  const vazio = (error: string): Onda =>
    ({ ok: false, error, lo: new Float32Array(), hi: new Float32Array(), hop: 1, rate: 1, peak: 0 });
  if (!e.audio) return vazio('sem trilha de audio neste arquivo');

  const rate = await e.audio.getSampleRate();
  const hop = Math.max(1, Math.round(HOP_48K * rate / 48000));

  let lo = new Float32Array(4096), hi = new Float32Array(4096);
  let n = 0, peak = 0;
  let mn = 0, mx = 0, noBloco = 0;

  const fecha = () => {
    if (n === lo.length) {
      const nlo = new Float32Array(lo.length * 2); nlo.set(lo); lo = nlo;
      const nhi = new Float32Array(hi.length * 2); nhi.set(hi); hi = nhi;
    }
    lo[n] = Math.max(-1, mn);
    hi[n] = Math.min(1, mx);
    peak = Math.max(peak, -lo[n], hi[n]);
    n++;
    mn = mx = 0;
    noBloco = 0;
  };

  const sink = new AudioBufferSink(e.audio);
  for await (const { buffer } of sink.buffers()) {
    const a = buffer.getChannelData(0);
    const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
    for (let i = 0; i < a.length; i++) {
      const v = 0.5 * (a[i] + b[i]);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (++noBloco === hop) fecha();
    }
  }
  if (noBloco > 0) fecha();

  if (!n) return vazio('a trilha de audio nao rendeu nenhum pico');
  return { ok: true, lo: lo.subarray(0, n), hi: hi.subarray(0, n), hop, rate, peak };
}

// jtWaveform(mediaId, de, ate, colunas, fonte). A fonte 1 pedia a voz
// separada; no navegador ainda nao ha separacao, e vale a mistura - melhor um
// desenho do que um buraco, como o C++ ja fazia sem voz.
export function waveform(id: number, t0: number, t1: number, colunas: number) {
  const e = cesta.find(id);
  if (!e || !e.item.hasAudio) return Promise.resolve({ ok: false, error: 'sem audio neste item' });
  t0 = Math.max(0, t0);
  colunas = Math.max(1, Math.min(4000, colunas | 0));
  if (!(t1 > t0)) return Promise.resolve({ ok: false, error: 'janela vazia' });

  return filaLenta.pede(null, async () => {
    const w = await resumoDe(e);
    if (!w.ok) return { ok: false, error: w.error };

    const bps = w.rate / w.hop;
    const total = w.lo.length;
    const lo = new Array<number>(colunas).fill(0);
    const hi = new Array<number>(colunas).fill(0);
    const larg = t1 - t0;
    for (let c = 0; c < colunas; c++) {
      let fa = Math.floor((t0 + larg * c / colunas) * bps);
      let fb = Math.ceil((t0 + larg * (c + 1) / colunas) * bps);
      if (fa < 0) fa = 0;
      if (fb > total) fb = total;
      if (fb <= fa) fb = fa + 1;
      if (fa >= total) break;
      let mn = 0, mx = 0;
      for (let i = fa; i < fb && i < total; i++) {
        if (w.lo[i] < mn) mn = w.lo[i];
        if (w.hi[i] > mx) mx = w.hi[i];
      }
      lo[c] = Math.round(mn * 1000) / 1000;
      hi[c] = Math.round(mx * 1000) / 1000;
    }
    return { ok: true, t0, t1, peak: Math.round(w.peak * 1000) / 1000, lo, hi };
  });
}

// jtSilences(mediaId, de, ate, quedaDb, minimo, folga, sensibilidade) - onde
// a voz para, pela regua de nivel: o que fica `quedaDb` abaixo do pico do
// arquivo por pelo menos `minimo` segundos, com `folga` de cada lado.
//
// No C++, sem o reconhecedor de fala, esta regua exigia a voz separada - na
// mistura, musica de fundo tapa as pausas. Aqui ela roda na propria mistura:
// em gravacao so de voz funciona bem, e com trilha por baixo acha pouco.
export function silences(id: number, de: number, ate: number, quedaDb: number,
                         minimo: number, folga: number) {
  const e = cesta.find(id);
  if (!e) return Promise.resolve({ ok: false, error: 'item nao encontrado' });
  if (!e.item.hasAudio) return Promise.resolve({ ok: false, error: 'este item nao tem audio' });

  return filaLenta.pede(null, async () => {
    const w = await resumoDe(e);
    if (!w.ok) return { ok: false, error: w.error };

    const bps = w.rate / w.hop;
    const piso = w.peak * Math.pow(10, quedaDb / 20);
    const n = w.lo.length;
    const a = Math.max(0, Math.floor(Math.max(0, de) * bps));
    const b = Math.min(n, Math.ceil(ate * bps));

    const gaps: number[][] = [];
    let run = -1;
    const fecha = (fim: number) => {
      if (run < 0) return;
      let g0 = run / bps, g1 = fim / bps;
      if (g1 - g0 >= minimo) {
        g0 += folga;
        g1 -= folga;
        if (g1 > g0) gaps.push([g0, g1]);
      }
      run = -1;
    };
    for (let i = a; i < b; i++) {
      const amp = Math.max(w.hi[i], -w.lo[i]);
      if (amp <= piso) { if (run < 0) run = i; }
      else fecha(i);
    }
    fecha(b);
    return { ok: true, modo: 'nivel', gaps };
  });
}
