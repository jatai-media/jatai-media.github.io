// Exportar - o exportar.h e o roda_export do app.h, no navegador.
//
//     para cada quadro do video final:
//        limpa a tela
//        para cada camada visivel, de baixo para cima:
//           pega o quadro daquele instante do arquivo
//           desenha com o enquadramento do clipe
//        entrega a tela ao codificador
//
// O desenho e a mesma conta do compositor.h: a imagem encaixada na tela e,
// por cima, escala, giro e deslocamento em torno do centro. O som e misturado
// de uma vez num OfflineAudioContext - o mesmo grafo que toca na previa, so
// que sem placa - e entregue ao codificador junto com a imagem.
//
// Sai MP4 com H.264 e AAC quando o navegador sabe codificar os dois; senao,
// o que ele souber (HEVC, VP9, AV1; Opus) no mesmo MP4.

import {
  AudioBufferSink, AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output,
  QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_VERY_HIGH, StreamTarget, canEncodeVideo,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type Quality, type Target,
} from 'mediabunny';
import { cesta, mensagem } from './midia';
import { LeitorQuadros } from './quadros';
import { quadroParaExportar, type PluginExport } from '../plugins/plugins';
import type { Caixa } from '../plugins/sandbox';
import { desenhaTexto, type TextoExport } from './texto-canvas';

// O que vai no fim dos argumentos: um plugin, ou um texto da linha do tempo.
type Desenho = PluginExport | { tipo: 'texto'; texto: TextoExport };

interface Chave { t: number; esc: number; x: number; y: number; rot: number; suave: boolean }
interface Transformacao { esc: number; x: number; y: number; rot: number }

interface Camada extends Transformacao {
  media: number; start: number; len: number; in: number; vel: number;
  anim: Chave[];
}

interface Som { media: number; start: number; in: number; len: number; ganho: number; vel: number }

// Os destinos escolhidos, pela ficha que a pagina recebeu no lugar do caminho.
const destinos = new Map<string, { nome: string; alca?: FileSystemFileHandle }>();
let fichas = 0;
let exportando = false;
let cancelar = false;

const TAXA = 48000;

// ------------------------------------------------------------ o destino

export async function exportDestino(sugestao: string) {
  const nome = sugestao || 'video.mp4';
  if (window.showSaveFilePicker) {
    try {
      const alca = await window.showSaveFilePicker({
        suggestedName: nome, id: 'jatai-exportar',
        types: [{ description: 'Video MP4', accept: { 'video/mp4': ['.mp4'] } }],
      });
      const ficha = 'destino:' + ++fichas;
      destinos.set(ficha, { nome: alca.name, alca });
      return { ok: true, destino: ficha };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { ok: false, cancelado: true };
      return { ok: false, error: mensagem(e) };
    }
  }
  // Sem o dialogo de salvar: o arquivo sai como download comum, no fim.
  const ficha = 'destino:' + ++fichas;
  destinos.set(ficha, { nome });
  return { ok: true, destino: ficha };
}

export function exportCancelar() {
  cancelar = true;
  return { ok: true };
}

// ------------------------------------------------------------ a conta

// A imagem inteira dentro da tela, centrada, sem cortar - o `encaixa`.
function encaixa(iw: number, ih: number, tw: number, th: number) {
  if (iw <= 0 || ih <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const pi = iw / ih, pt = tw / th;
  const w = pi > pt ? tw : th * pi;
  const h = pi > pt ? tw / pi : th;
  return { x: (tw - w) / 2, y: (th - h) / 2, w, h };
}

// O enquadramento naquele instante. Entre dois pontos e reta, ou a curva suave
// quando um dos dois pede.
function em(pts: Chave[], parado: Transformacao, t: number): Transformacao {
  if (!pts.length) return parado;
  if (t <= pts[0].t) return pts[0];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (t > b.t) continue;
    let k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, b.t - a.t)));
    if (a.suave || b.suave) k = k * k * (3 - 2 * k);
    return { esc: a.esc + (b.esc - a.esc) * k, x: a.x + (b.x - a.x) * k,
             y: a.y + (b.y - a.y) * k, rot: a.rot + (b.rot - a.rot) * k };
  }
  return pts[pts.length - 1];
}

// ------------------------------------------------------------ os argumentos

// jtExportar(destino, w, h, fps, crf, duracao, nCamadas, nSom, ...): as camadas
// tem tamanho variavel - treze numeros e mais seis por ponto de animacao -, e
// por isso o som so pode ser lido depois da ultima.
function le(args: unknown[]) {
  const n = (i: number) => Number(args[i]) || 0;
  const w = Math.max(16, Math.round(n(1))) & ~1;
  const h = Math.max(16, Math.round(n(2))) & ~1;
  const fps = Math.max(1, Math.min(120, Math.round(n(3))));
  const crf = Math.max(0, Math.min(51, Math.round(n(4))));
  const duracao = n(5);
  const nCam = n(6), nSom = n(7);

  const camadas: Camada[] = [];
  let i = 8;
  for (let k = 0; k < nCam && i + 12 < args.length; k++) {
    const c: Camada = { media: n(i), start: n(i + 1), len: n(i + 2), in: n(i + 3), vel: n(i + 4),
                        esc: n(i + 5), x: n(i + 6), y: n(i + 7), rot: n(i + 8), anim: [] };
    // i+9..i+11: o recorte do fundo e o acabamento da borda. Ainda nao ha
    // recorte no navegador; a camada sai inteira.
    const nPts = n(i + 12);
    i += 13;
    for (let p = 0; p < nPts && i + 5 < args.length; p++, i += 6) {
      c.anim.push({ t: n(i), esc: n(i + 1) > 0.0001 ? n(i + 1) : 1, x: n(i + 2), y: n(i + 3),
                    rot: n(i + 4), suave: n(i + 5) !== 0 });
    }
    if (!(c.vel > 0.01)) c.vel = 1;
    if (!(c.esc > 0.0001)) c.esc = 1;
    if (c.len > 0) camadas.push(c);
  }

  const sons: Som[] = [];
  for (let k = 0; k < nSom && i + 5 < args.length; k++, i += 6) {
    const s: Som = { media: n(i), start: n(i + 1), in: n(i + 2), len: n(i + 3), ganho: n(i + 4), vel: n(i + 5) };
    if (!(s.vel > 0.01)) s.vel = 1;
    if (s.len > 0) sons.push(s);
  }
  // Depois do som, o que os plugins precisam (ver exportCamadas): uma camada
  // com midia -k e o plugin k da lista.
  const extra = args[args.length - 1] as { plugins?: Desenho[] } | undefined;
  const plugins = extra && typeof extra === 'object' && Array.isArray(extra.plugins) ? extra.plugins : [];
  return { w, h, fps, crf, duracao, camadas, sons, plugins };
}

// O CRF do x264 virou qualidade do WebCodecs. Os tres valores que a pagina
// oferece caem cada um numa faixa.
function qualidade(crf: number): Quality {
  if (crf <= 18) return QUALITY_VERY_HIGH;
  if (crf <= 21) return QUALITY_HIGH;
  return QUALITY_MEDIUM;
}

// ------------------------------------------------------------ o som
//
// A mistura sai EM TRECHOS, e nao inteira. Misturar o video todo de uma vez
// era decodificar e guardar na memoria o som inteiro antes do primeiro quadro:
// num video de 13 minutos, centenas de MB e minutos com a barra parada em 0% -
// parecia travado, e as vezes travava mesmo. Agora cada trecho de alguns
// segundos e misturado quando a imagem chega perto dele, e vai direto para o
// codificador; a memoria fica do tamanho de um trecho.

const TRECHO = 10;   // segundos de som por vez

interface Bloco { buffer: AudioBuffer; timestamp: number; duration: number }

// Um trecho de som sendo lido do arquivo, de uma janela para a outra.
//
// O decodificador e UM SO do comeco ao fim do trecho, e nao um por janela: o
// AAC (e o MP3, e o Opus) decodifica cada quadro com a ajuda do anterior, e um
// decodificador aberto no meio do arquivo erra o primeiro quadro. Abrindo um
// por janela, cada emenda de 10 s virava um estalo. O bloco que atravessa a
// emenda fica guardado (`resto`) e a janela seguinte comeca por ele.
class LeitorSom {
  private it: AsyncGenerator<Bloco, void, unknown> | null = null;
  private resto: Bloco | null = null;
  constructor(private s: Som, private e: { audio?: any }) {}

  // Agenda em `ctx` a parte do arquivo [ini, fim), comecando no instante
  // `quando` da janela.
  async agenda(ctx: OfflineAudioContext, destino: AudioNode, ini: number, fim: number, quando: number) {
    if (!this.it) this.it = new AudioBufferSink(this.e.audio).buffers(ini, this.s.in + this.s.len * this.s.vel);
    for (;;) {
      let wb = this.resto;
      this.resto = null;
      if (!wb) {
        const r = await this.it.next();
        if (r.done) return;
        wb = r.value as Bloco;
      }
      const fimB = wb.timestamp + wb.duration;
      const x = Math.max(wb.timestamp, ini), y = Math.min(fimB, fim);
      if (y > x) {
        const f = ctx.createBufferSource();
        f.buffer = wb.buffer;
        f.playbackRate.value = this.s.vel;
        f.connect(destino);
        f.start(quando + (x - ini) / this.s.vel, x - wb.timestamp, y - x);
      }
      if (fimB > fim) { this.resto = wb; return; }
    }
  }

  async fecha() {
    const it = this.it;
    this.it = null;
    this.resto = null;
    if (it) await it.return(undefined).catch(() => {});
  }
}

// O trecho [de, ate) da mistura, ja cortado em -1..1. Os trechos de som sao os
// mesmos da reproducao, com o mesmo ganho e a mesma velocidade.
async function misturaTrecho(sons: Som[], leitores: Map<Som, LeitorSom>,
                             de: number, ate: number): Promise<AudioBuffer | null> {
  const n = Math.floor(ate * TAXA) - Math.floor(de * TAXA);
  if (n <= 0) return null;
  const ctx = new OfflineAudioContext(2, n, TAXA);
  for (const s of sons) {
    if (cancelar) break;
    const a = Math.max(de, s.start), b = Math.min(ate, s.start + s.len);
    if (b <= a) continue;
    const e = cesta.find(s.media);
    if (!e || !e.audio) continue;
    const ganho = ctx.createGain();
    ganho.gain.value = Math.max(0, s.ganho);
    ganho.connect(ctx.destination);

    let l = leitores.get(s);
    if (!l) { l = new LeitorSom(s, e); leitores.set(s, l); }
    // A parte do ARQUIVO que toca nesta janela.
    await l.agenda(ctx, ganho, s.in + (a - s.start) * s.vel, s.in + (b - s.start) * s.vel, a - de);
    // Trecho que acaba nesta janela: o decodificador dele ja pode sair.
    if (s.start + s.len <= ate) { await l.fecha(); leitores.delete(s); }
  }
  const buf = await ctx.startRendering();
  // Somar trilhas estoura; o corte e o mesmo que a placa faz ao tocar.
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let k = 0; k < d.length; k++) d[k] = d[k] > 1 ? 1 : d[k] < -1 ? -1 : d[k];
  }
  return buf;
}

// ------------------------------------------------------------ o tempo gasto
//
// Quanto cada etapa custou, somado. Vai no aviso do fim e no console: e o que
// diz onde vale a pena acelerar (decodificar, desenhar, plugins, som ou
// codificar), em vez de adivinhar.
type Etapa = 'decodificar' | 'desenhar' | 'plugins' | 'som' | 'codificar';
function cronometro() {
  const soma: Record<Etapa, number> = { decodificar: 0, desenhar: 0, plugins: 0, som: 0, codificar: 0 };
  const inicio = performance.now();
  return {
    async mede<T>(etapa: Etapa, faz: () => Promise<T> | T): Promise<T> {
      const t0 = performance.now();
      try { return await faz(); } finally { soma[etapa] += performance.now() - t0; }
    },
    soma(etapa: Etapa, ms: number) { soma[etapa] += ms; },
    resumo(quadros: number) {
      const total = (performance.now() - inicio) / 1000;
      const partes = (Object.keys(soma) as Etapa[]).filter((k) => soma[k] > 1)
        .map((k) => k + " " + (soma[k] / 1000).toFixed(1) + " s");
      return { total, texto: total.toFixed(1) + " s para " + quadros + " quadros (" +
                             (quadros / Math.max(0.001, total)).toFixed(0) + " por segundo): " + partes.join(", ") };
    },
  };
}

// ------------------------------------------------------------ exportar

function progresso(feito: number, total: number) {
  window.jtExportProgresso?.(feito, total);
}

export async function exportar(...args: unknown[]) {
  if (exportando) return { ok: false, error: 'ja ha uma exportacao em curso' };
  const destino = destinos.get(String(args[0] || ''));
  if (!destino) return { ok: false, cancelado: true };

  const aj = le(args);
  if (aj.duracao <= 0 || (!aj.camadas.length && !aj.sons.length))
    return { ok: false, error: 'nao ha nada na linha do tempo para exportar' };

  exportando = true;
  cancelar = false;
  const leitores = new Map<number, LeitorQuadros>();
  let output: Output | null = null;
  let escrita: FileSystemWritableFileStream | null = null;

  try {
    const vcodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'],
                                                     { width: aj.w, height: aj.h });
    if (!vcodec) return { ok: false, error: 'este navegador nao sabe codificar video' };
    const acodec = aj.sons.length
      ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: TAXA })
      : null;

    let target: Target;
    let buffer: BufferTarget | null = null;
    if (destino.alca) {
      escrita = await destino.alca.createWritable();
      target = new StreamTarget(escrita);
    } else {
      buffer = new BufferTarget();
      target = buffer;
    }
    output = new Output({ format: new Mp4OutputFormat({ fastStart: destino.alca ? false : 'in-memory' }), target });

    const tela = new OffscreenCanvas(aj.w, aj.h);
    const ctx = tela.getContext('2d', { alpha: false })!;
    ctx.imageSmoothingQuality = 'high';
    // O codificador da placa de video (VCN nas Radeon, Quick Sync nas Intel,
    // NVENC nas NVIDIA), quando existe. E so uma preferencia, e por isso vai
    // perguntada antes: pedida numa maquina sem ela, a codificacao falharia em
    // vez de cair no processador.
    const naPlaca = await canEncodeVideo(vcodec, { width: aj.w, height: aj.h, bitrate: qualidade(aj.crf),
                                                   hardwareAcceleration: 'prefer-hardware' }).catch(() => false);
    const video = new CanvasSource(tela, { codec: vcodec, bitrate: qualidade(aj.crf),
                                           hardwareAcceleration: naPlaca ? 'prefer-hardware' : 'no-preference' });
    output.addVideoTrack(video, { frameRate: aj.fps });

    let audio: AudioBufferSource | null = null;
    if (acodec) {
      audio = new AudioBufferSource({ codec: acodec, bitrate: qualidade(aj.crf) });
      output.addAudioTrack(audio);
    }
    await output.start();
    const relogio = cronometro();

    for (const c of aj.camadas) {
      const e = cesta.find(c.media);
      if (e?.video && !leitores.has(c.media)) leitores.set(c.media, new LeitorQuadros(e.video));
    }

    let giro: OffscreenCanvas | null = null;
    const total = Math.ceil(aj.duracao * aj.fps);
    const aCada = Math.max(1, Math.floor(aj.fps / 4));
    let somAte = 0;
    const leitoresSom = new Map<Som, LeitorSom>();

    // O proximo trecho de som, quando a imagem chega perto de onde o som parou:
    // os dois andam juntos, e o MP4 sai intercalado.
    const empurraSom = async (ate: number) => {
      while (audio && somAte < ate && somAte < aj.duracao && !cancelar) {
        const de = somAte, fim = Math.min(aj.duracao, de + TRECHO);
        const pedaco = await relogio.mede('som', () => misturaTrecho(aj.sons, leitoresSom, de, fim));
        if (pedaco) await relogio.mede('som', () => audio!.add(pedaco));
        somAte = fim;
      }
    };

    // A tela separada: onde vai sozinha a camada que um filtro de camada vai
    // receber (o chroma key recebe so o video de fundo verde, e nao a montagem).
    let sepTela: OffscreenCanvas | null = null;
    const separada = () => {
      if (!sepTela) sepTela = new OffscreenCanvas(aj.w, aj.h);
      const g = sepTela.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      return g;
    };
    const limpaSeparada = () => {
      const g = separada();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, aj.w, aj.h);
    };
    const ehFiltroDeCamada = (c: Camada) => {
      if (c.media >= 0) return false;
      const d = aj.plugins[-c.media - 1] as PluginExport | undefined;
      return !!d && !('tipo' in d) && !!d.filtro && !!d.camada;
    };

    // Um plugin "parado" (marca d'agua, moldura) desenha a mesma coisa em todo
    // quadro: o desenho e feito uma vez e reaproveitado.
    const parados = new Map<number, { bmp: ImageBitmap; caixa: Caixa | null }>();

    for (let n = 0; n < total; n++) {
      if (cancelar) break;
      const t = n / aj.fps;
      await empurraSom(t + 1);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, aj.w, aj.h);

      // As camadas deste instante, de baixo para cima. Uma camada logo abaixo
      // de um FILTRO DE CAMADA nao vai para a tela: vai sozinha para a
      // separada, que e a entrada daquele filtro (ver ehFiltroDeCamada).
      const ativas = aj.camadas.filter((c) => t >= c.start && t < c.start + c.len);
      for (let ci = 0; ci < ativas.length; ci++) {
        const c = ativas[ci];
        const desvia = ci + 1 < ativas.length && ehFiltroDeCamada(ativas[ci + 1]);
        const g = desvia ? separada() : ctx;
        // a separada comeca vazia para cada camada desviada (o filtro de
        // camada limpa a dele depois de ler)
        if (desvia && !ehFiltroDeCamada(c)) limpaSeparada();

        // Plugin: ele desenha o quadro inteiro, ja na medida do video. O
        // enquadramento vai por cima com a conta da previa: deslocamento, e
        // giro e zoom em torno do centro da area que ele desenhou.
        if (c.media < 0) {
          const k = -c.media - 1;
          const dd = aj.plugins[k];
          if (!dd) continue;
          // Texto: desenhado aqui mesmo, com as contas da folha de estilo da previa.
          if ('tipo' in dd && dd.tipo === 'texto') {
            const t0 = performance.now();
            desenhaTexto(g, dd.texto, aj.w, aj.h);
            relogio.soma('desenhar', performance.now() - t0);
            continue;
          }
          const d = dd as PluginExport;
          // Filtro: recebe o quadro como esta ate aqui (tudo o que ficou
          // abaixo dele) e o devolve alterado, no lugar.
          // Filtro de CAMADA (chroma key...): a entrada e so a camada logo
          // abaixo, que foi desenhada sozinha na separada; a saida, com
          // transparencia, vai POR CIMA do que ja esta na tela.
          if (d.filtro && d.camada) {
            const r = await relogio.mede('plugins', async () => {
              const entrada = await createImageBitmap(separada().canvas);
              limpaSeparada();
              return quadroParaExportar(d, t - c.start, aj.w, aj.h, false, entrada);
            });
            if (r) {
              g.save();
              g.setTransform(1, 0, 0, 1, 0, 0);
              g.drawImage(r.bmp, 0, 0);
              g.restore();
              r.bmp.close();
            }
            continue;
          }
          if (d.filtro) {
            const r = await relogio.mede('plugins', async () => {
              const entrada = await createImageBitmap(tela);
              return quadroParaExportar(d, t - c.start, aj.w, aj.h, false, entrada);
            });
            if (r) {
              g.save();
              g.setTransform(1, 0, 0, 1, 0, 0);
              g.globalCompositeOperation = 'copy';
              g.drawImage(r.bmp, 0, 0);
              g.restore();
              r.bmp.close();
            }
            continue;
          }
          let q = d.parado ? parados.get(k) : null;
          if (!q) {
            // A area desenhada so importa se o plugin gira ou muda de tamanho:
            // e o centro disso. Medi-la e ler o quadro inteiro de volta da
            // placa, entao so se mede quando serve para alguma coisa.
            const medir = [c as Transformacao, ...c.anim].some((p) => Math.abs(p.esc - 1) > 1e-4 || Math.abs(p.rot) > 1e-4);
            q = await relogio.mede('plugins', () => quadroParaExportar(d, t - c.start, aj.w, aj.h, medir));
            if (!q) continue;
            if (d.parado) parados.set(k, q);
          }
          const tr = em(c.anim, c, t - c.start);
          const esc = tr.esc > 1e-6 ? tr.esc : 1e-6;
          const cx = q.caixa ? (q.caixa.x + q.caixa.w / 2) * aj.w : aj.w / 2;
          const cy = q.caixa ? (q.caixa.y + q.caixa.h / 2) * aj.h : aj.h / 2;
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.translate(cx + tr.x * aj.w, cy + tr.y * aj.h);
          g.rotate(tr.rot * Math.PI / 180);
          g.scale(esc, esc);
          g.drawImage(q.bmp, -cx, -cy);
          if (!d.parado) q.bmp.close();
          continue;
        }

        const e = cesta.find(c.media);
        if (!e) continue;

        // O instante DENTRO do arquivo: o que passou desde o inicio do clipe,
        // corrido pela velocidade dele, a partir do ponto de entrada.
        const dentro = c.in + (t - c.start) * c.vel;
        let fonte: CanvasImageSource | null = null;
        let sw = 0, sh = 0;
        let amostra = null;
        if (e.imagem) {
          fonte = e.imagem; sw = e.imagem.width; sh = e.imagem.height;
        } else {
          amostra = await relogio.mede('decodificar', () => leitores.get(c.media)?.quadro(dentro)) ?? null;
          if (!amostra) continue;
          sw = amostra.displayWidth; sh = amostra.displayHeight;
        }

        const enc = encaixa(sw, sh, aj.w, aj.h);
        const tr = em(c.anim, c, t - c.start);
        const esc = tr.esc > 1e-6 ? tr.esc : 1e-6;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.translate(aj.w / 2 + tr.x * aj.w, aj.h / 2 + tr.y * aj.h);
        g.rotate(tr.rot * Math.PI / 180);
        g.scale(esc, esc);
        const dx = enc.x - aj.w / 2, dy = enc.y - aj.h / 2;
        if (!fonte && amostra!.rotation) {
          // Video de celular gravado de lado: so `drawWithFit` respeita a
          // rotacao do arquivo, e ele desenha na tela inteira - dai a
          // intermediaria, do tamanho do quadro ja de pe.
          const w = Math.max(2, Math.round(enc.w)), h = Math.max(2, Math.round(enc.h));
          if (!giro || giro.width !== w || giro.height !== h) giro = new OffscreenCanvas(w, h);
          amostra!.drawWithFit(giro.getContext('2d')!, { fit: 'fill' });
          fonte = giro;
        }
        const t0 = performance.now();
        if (fonte) g.drawImage(fonte, dx, dy, enc.w, enc.h);
        else amostra!.draw(g, dx, dy, enc.w, enc.h);
        relogio.soma('desenhar', performance.now() - t0);
      }

      await relogio.mede('codificar', () => video.add(t, 1 / aj.fps));

      if (n % aCada === 0) progresso(t, aj.duracao);
    }
    // O fim do som que ainda faltava.
    await empurraSom(aj.duracao);
    for (const l of leitoresSom.values()) await l.fecha();
    for (const q of parados.values()) q.bmp.close();

    if (cancelar) {
      await output.cancel();
      if (escrita) await escrita.abort().catch(() => {});
      if (destino.alca?.remove) await destino.alca.remove().catch(() => {});
      return { ok: false, cancelado: true };
    }

    await relogio.mede('codificar', () => output!.finalize());
    const tempo = relogio.resumo(total);
    console.info('[exportar] ' + tempo.texto);

    if (buffer?.buffer) {
      const url = URL.createObjectURL(new Blob([buffer.buffer], { type: 'video/mp4' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = destino.nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    const nomes: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' };
    return { ok: true, arquivo: destino.alca ? destino.nome : destino.nome + ' (pasta de downloads)',
             motor: (naPlaca ? 'placa de video' : 'processador') + ', ' + (nomes[vcodec] || vcodec) +
                    (acodec ? ' e ' + acodec.toUpperCase() : ''),
             tempo: tempo.texto };
  } catch (e) {
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {});
    return { ok: false, error: 'a exportacao falhou: ' + mensagem(e) };
  } finally {
    for (const l of leitores.values()) await l.fecha();
    exportando = false;
    cancelar = false;
    progresso(0, 0);
  }
}
