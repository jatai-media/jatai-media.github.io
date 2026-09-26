// O som da linha do tempo, e o relogio que o transporte segue - o audio.h, no
// navegador.
//
// Quem manda no tempo continua sendo a placa: a posicao da reproducao sai do
// relogio do AudioContext, e a pagina pergunta por ela a cada decimo de
// segundo, interpolando no meio. O relogio da pagina e o errado - som nao
// estica nem encolhe para acompanhar o navegador.
//
// Cada trecho e decodificado aos poucos pelo mediabunny e agendado bloco a
// bloco, sempre um pouco a frente do que toca. Nada de decodificar o arquivo
// inteiro antes de tocar: um video de uma hora seria um giga de memoria.
//
// A velocidade e por reamostragem, como no C++: o tom sobe junto. E exatamente
// o `playbackRate` do Web Audio.

import { AudioBufferSink } from 'mediabunny';
import { cesta } from './midia';

interface Trecho {
  id: number;       // o clipe: e por ele que o volume acha o trecho
  media: number;
  start: number;    // instante na linha do tempo
  in: number;       // onde entra no arquivo
  len: number;      // duracao NA LINHA DO TEMPO
  gain: number;
  speed: number;
}

interface Ponto { t: number; gain: number }

// Quanto a frente da placa o agendamento anda. A folga protege de engasgos,
// e aqui nao atrasa mudanca nenhuma: o volume e aplicado no no de ganho, que
// vale na hora, e nao no som ja agendado.
const ADIANTE = 1.5;
// Um trecho que vai entrar comeca a ser decodificado com esta antecedencia:
// abrir o decodificador custa dezenas de milissegundos, e fazer isso na hora
// abriria um buraco no som.
const ABRE_ANTES = 2.5;
// A primeira amostra toca um pouco depois do play, para dar tempo de o
// primeiro bloco ficar pronto.
const ARRANQUE = 0.15;

const dorme = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

class Motor {
  private ctx: AudioContext | null = null;
  private saida: GainNode | null = null;
  private medidor: AnalyserNode | null = null;
  private amostras = new Float32Array(2048);

  private trechos: Trecho[] = [];
  private de = 0;              // de onde a reproducao parte, na linha do tempo
  private t0 = 0;              // quando, no relogio da placa, `de` toca
  private tocando = false;
  private rodada = 0;          // muda a cada play/stop: as bombas velhas param
  private ultimaPos = 0;
  private faltou = 0;          // quadros (a 48 kHz) que chegaram tarde demais

  private ganhos = new Map<number, GainNode>();
  private linhas = new Map<number, Ponto[]>();
  private ganhoFixo = new Map<number, number>();
  private inicioClipe = new Map<number, number>();
  private fontes = new Set<AudioBufferSourceNode>();

  erro = '';

  private garanteCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.saida = ctx.createGain();
      this.medidor = ctx.createAnalyser();
      this.medidor.fftSize = 2048;
      this.saida.connect(this.medidor);
      this.medidor.connect(ctx.destination);
      this.ctx = ctx;
    } catch (e) {
      this.erro = 'sem saida de audio neste navegador';
      return null;
    }
    return this.ctx;
  }

  // jtPlay: prepara, sem tocar nada. Entre isto e `start` vao as linhas de
  // volume - senao o comeco sairia no volume errado ate elas chegarem.
  prepare(trechos: Trecho[], de: number): boolean {
    this.stop();
    const ctx = this.garanteCtx();
    if (!ctx) return false;
    // O navegador so libera o som depois de um gesto; o play e um.
    void ctx.resume();

    this.trechos = trechos;
    this.de = de;
    this.faltou = 0;
    this.linhas.clear();
    this.ganhoFixo.clear();
    this.inicioClipe.clear();
    for (const g of this.ganhos.values()) g.disconnect();
    this.ganhos.clear();

    for (const t of trechos) {
      if (!this.ganhos.has(t.id)) {
        const g = ctx.createGain();
        g.gain.value = t.gain;
        g.connect(this.saida!);
        this.ganhos.set(t.id, g);
        this.ganhoFixo.set(t.id, t.gain);
      }
      // O clipe comeca onde comeca o primeiro pedaco dele.
      const ini = this.inicioClipe.get(t.id);
      if (ini === undefined || t.start < ini) this.inicioClipe.set(t.id, t.start);
    }
    return true;
  }

  // jtStart: agora sim.
  async start(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) { this.erro = 'o som nao foi preparado'; return false; }
    await ctx.resume();
    if (ctx.state !== 'running') {
      this.erro = 'o navegador nao liberou o som';
      return false;
    }
    this.t0 = ctx.currentTime + ARRANQUE;
    this.tocando = true;
    const rodada = ++this.rodada;
    for (const id of this.ganhos.keys()) this.aplicaLinha(id);
    for (const t of this.trechos) void this.bomba(t, rodada);
    return true;
  }

  stop(): void {
    if (this.tocando) this.ultimaPos = this.position();
    this.tocando = false;
    this.rodada++;
    for (const f of this.fontes) { try { f.stop(); } catch { /* ja parou */ } }
    this.fontes.clear();
  }

  playing(): boolean { return this.tocando; }

  // O que a placa ja tocou. A latencia de saida entra na conta: o relogio diz o
  // que foi entregue, e o ouvido escuta um pouco depois.
  position(): number {
    if (!this.tocando || !this.ctx) return this.ultimaPos;
    const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.de + Math.max(0, this.ctx.currentTime - this.t0 - lat);
  }

  takePeak(): number {
    if (!this.medidor) return 0;
    this.medidor.getFloatTimeDomainData(this.amostras);
    let p = 0;
    for (const v of this.amostras) { const a = Math.abs(v); if (a > p) p = a; }
    return p;
  }

  starved(): number { return this.faltou; }

  // jtSetGain: volume novo para um clipe que ja esta tocando. Um alvo com
  // constante curta, e nao um salto, para nao estalar.
  setGain(id: number, gain: number): void {
    this.ganhoFixo.set(id, gain);
    this.linhas.delete(id);
    const g = this.ganhos.get(id);
    if (!g || !this.ctx) return;
    const agora = this.ctx.currentTime;
    g.gain.cancelScheduledValues(agora);
    g.gain.setTargetAtTime(Math.max(0, gain), agora, 0.015);
  }

  // jtSetEnv: a linha inteira, ja picada, em instantes relativos ao clipe.
  setEnvelope(id: number, pts: Ponto[]): void {
    this.linhas.set(id, pts);
    this.aplicaLinha(id);
  }

  // Traduz a linha do clipe para o relogio da placa e a agenda no no de ganho.
  // Antes de tocar, fica guardada: `start` a aplica.
  private aplicaLinha(id: number): void {
    const g = this.ganhos.get(id);
    const pts = this.linhas.get(id);
    if (!g || !pts || !pts.length || !this.ctx || !this.tocando) return;

    const ini = this.inicioClipe.get(id) ?? 0;
    const naPlaca = (t: number) => this.t0 + (ini + t - this.de);
    const agora = this.ctx.currentTime;

    // O valor da linha agora, para a rampa partir do lugar certo.
    const tAgora = this.de + (agora - this.t0) - ini;
    let v = pts[0].gain;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].t <= tAgora) v = pts[i].gain;
      else {
        if (i > 0) {
          const a = pts[i - 1], b = pts[i];
          v = a.gain + (b.gain - a.gain) * (tAgora - a.t) / Math.max(1e-6, b.t - a.t);
        }
        break;
      }
    }

    g.gain.cancelScheduledValues(0);
    g.gain.setValueAtTime(Math.max(0, v), agora);
    for (const p of pts) {
      const quando = naPlaca(p.t);
      if (quando > agora) g.gain.linearRampToValueAtTime(Math.max(0, p.gain), quando);
    }
  }

  // Decodifica um trecho e o agenda bloco a bloco, sempre um pouco a frente
  // da placa. Para sozinha quando a rodada muda (stop ou outro play).
  private async bomba(t: Trecho, rodada: number): Promise<void> {
    const ctx = this.ctx!;
    const viva = () => this.rodada === rodada;

    const fimLinha = t.start + t.len;
    if (fimLinha <= this.de) return;                // ja passou
    const e = cesta.find(t.media);
    if (!e || !e.audio) return;

    // Onde o trecho entra no relogio da placa.
    const entra = this.t0 + Math.max(0, t.start - this.de);
    while (viva() && ctx.currentTime < entra - ABRE_ANTES) await dorme(150);
    if (!viva()) return;

    // Onde, dentro do arquivo, comeca e acaba o que ainda falta tocar.
    const pulado = Math.max(0, this.de - t.start);   // segundos de linha ja passados
    const srcIni = t.in + pulado * t.speed;
    const srcFim = t.in + t.len * t.speed;
    if (srcFim <= srcIni) return;

    const saida = this.ganhos.get(t.id)!;
    const sink = new AudioBufferSink(e.audio);
    try {
      for await (const wb of sink.buffers(srcIni, srcFim)) {
        if (!viva()) break;
        const a = Math.max(wb.timestamp, srcIni);
        const b = Math.min(wb.timestamp + wb.duration, srcFim);
        if (b <= a) continue;

        let quando = entra + (a - srcIni) / t.speed;
        let offset = a - wb.timestamp;
        let dur = b - a;

        // Chegou tarde: toca o que ainda da, e conta o que faltou - e sinal
        // de que a maquina nao esta dando conta, e isso nao fica escondido.
        const agora = ctx.currentTime;
        if (quando < agora) {
          const atraso = (agora - quando) * t.speed + 0.002;
          const perdido = Math.min(dur, atraso);
          this.faltou += Math.round((perdido / t.speed) * 48000);
          if (atraso >= dur) continue;
          offset += atraso;
          dur -= atraso;
          quando = agora + 0.002;
        }

        const f = ctx.createBufferSource();
        f.buffer = wb.buffer;
        f.playbackRate.value = t.speed;
        f.connect(saida);
        f.onended = () => { this.fontes.delete(f); f.disconnect(); };
        this.fontes.add(f);
        f.start(quando, offset, dur);

        // Nao corre demais na frente: o que ja esta agendado nao ouve o stop
        // antes de tocar, e a memoria agradece.
        while (viva() && quando - ctx.currentTime > ADIANTE) await dorme(100);
      }
    } catch (err) {
      console.warn('som: trecho', t.id, err);
    }
  }
}

export const motor = new Motor();

// As funcoes da ponte, com os argumentos achatados como a pagina os manda.

export function play(de: number, ...plano: number[]) {
  const trechos: Trecho[] = [];
  for (let i = 0; i + 6 < plano.length; i += 7) {
    const e = cesta.find(plano[i + 1]);
    if (!e || !e.item.hasAudio) continue;
    const t: Trecho = {
      id: plano[i], media: plano[i + 1], start: plano[i + 2], in: plano[i + 3],
      len: plano[i + 4], gain: Math.max(0, plano[i + 5]), speed: plano[i + 6],
    };
    if (!(t.speed > 0.01)) t.speed = 1;
    if (t.len > 0) trechos.push(t);
  }
  if (!motor.prepare(trechos, de)) return { ok: false, error: motor.erro };
  return { ok: true, tracks: trechos.length };
}

export async function start() {
  return (await motor.start()) ? { ok: true } : { ok: false, error: motor.erro };
}

export function setEnv(id: number, ...plano: number[]) {
  const pts: Ponto[] = [];
  for (let i = 0; i + 1 < plano.length; i += 2) pts.push({ t: plano[i], gain: Math.max(0, plano[i + 1]) });
  motor.setEnvelope(id, pts);
  return { ok: true };
}

export function transport() {
  return { playing: motor.playing(), pos: motor.position(), peak: motor.takePeak(), starved: motor.starved() };
}
