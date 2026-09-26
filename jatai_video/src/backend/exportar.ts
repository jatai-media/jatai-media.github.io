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
  QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_VERY_HIGH, StreamTarget,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, type Quality, type Target,
} from 'mediabunny';
import { cesta, mensagem } from './midia';
import { LeitorQuadros } from './quadros';

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
  return { w, h, fps, crf, duracao, camadas, sons };
}

// O CRF do x264 virou qualidade do WebCodecs. Os tres valores que a pagina
// oferece caem cada um numa faixa.
function qualidade(crf: number): Quality {
  if (crf <= 18) return QUALITY_VERY_HIGH;
  if (crf <= 21) return QUALITY_HIGH;
  return QUALITY_MEDIUM;
}

// ------------------------------------------------------------ o som

// A mistura inteira, pronta, numa AudioBuffer. Os trechos sao os mesmos da
// reproducao, com o mesmo ganho e a mesma velocidade.
async function mistura(sons: Som[], duracao: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duracao * TAXA)), TAXA);
  for (const s of sons) {
    if (cancelar) break;
    const e = cesta.find(s.media);
    if (!e || !e.audio) continue;
    const ganho = ctx.createGain();
    ganho.gain.value = Math.max(0, s.ganho);
    ganho.connect(ctx.destination);

    const ini = s.in, fim = s.in + s.len * s.vel;
    for await (const wb of new AudioBufferSink(e.audio).buffers(ini, fim)) {
      const a = Math.max(wb.timestamp, ini), b = Math.min(wb.timestamp + wb.duration, fim);
      if (b <= a) continue;
      const f = ctx.createBufferSource();
      f.buffer = wb.buffer;
      f.playbackRate.value = s.vel;
      f.connect(ganho);
      f.start(s.start + (a - ini) / s.vel, a - wb.timestamp, b - a);
    }
  }
  return ctx.startRendering();
}

// Um pedaco da mistura, como AudioBuffer proprio - o codificador recebe o som
// aos poucos, junto com a imagem.
function fatia(buf: AudioBuffer, de: number, ate: number): AudioBuffer | null {
  const a = Math.max(0, Math.floor(de * TAXA)), b = Math.min(buf.length, Math.floor(ate * TAXA));
  if (b <= a) return null;
  const out = new AudioBuffer({ numberOfChannels: 2, length: b - a, sampleRate: TAXA });
  for (let c = 0; c < 2; c++) {
    const src = buf.getChannelData(c).subarray(a, b);
    // Somar trilhas estoura; o corte e o mesmo que a placa faz ao tocar.
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] > 1 ? 1 : src[i] < -1 ? -1 : src[i];
  }
  return out;
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
    const video = new CanvasSource(tela, { codec: vcodec, bitrate: qualidade(aj.crf) });
    output.addVideoTrack(video, { frameRate: aj.fps });

    let audio: AudioBufferSource | null = null;
    if (acodec) {
      audio = new AudioBufferSource({ codec: acodec, bitrate: qualidade(aj.crf) });
      output.addAudioTrack(audio);
    }
    await output.start();

    // O som primeiro, inteiro: sao segundos de trabalho para minutos de video.
    const som = audio ? await mistura(aj.sons, aj.duracao) : null;

    for (const c of aj.camadas) {
      const e = cesta.find(c.media);
      if (e?.video && !leitores.has(c.media)) leitores.set(c.media, new LeitorQuadros(e.video));
    }

    let giro: OffscreenCanvas | null = null;
    const total = Math.ceil(aj.duracao * aj.fps);
    const aCada = Math.max(1, Math.floor(aj.fps / 4));
    let somAte = 0;

    for (let n = 0; n < total; n++) {
      if (cancelar) break;
      const t = n / aj.fps;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, aj.w, aj.h);

      for (const c of aj.camadas) {
        if (t < c.start || t >= c.start + c.len) continue;
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
          amostra = await leitores.get(c.media)?.quadro(dentro);
          if (!amostra) continue;
          sw = amostra.displayWidth; sh = amostra.displayHeight;
        }

        const enc = encaixa(sw, sh, aj.w, aj.h);
        const tr = em(c.anim, c, t - c.start);
        const esc = tr.esc > 1e-6 ? tr.esc : 1e-6;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(aj.w / 2 + tr.x * aj.w, aj.h / 2 + tr.y * aj.h);
        ctx.rotate(tr.rot * Math.PI / 180);
        ctx.scale(esc, esc);
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
        if (fonte) ctx.drawImage(fonte, dx, dy, enc.w, enc.h);
        else amostra!.draw(ctx, dx, dy, enc.w, enc.h);
      }

      await video.add(t, 1 / aj.fps);

      // O som vai junto, um segundo de cada vez, para o MP4 sair intercalado.
      if (audio && som && (t + 1 / aj.fps >= somAte || n === total - 1)) {
        const ate = n === total - 1 ? aj.duracao : somAte + 1;
        const pedaco = fatia(som, somAte, ate);
        if (pedaco) await audio.add(pedaco);
        somAte = ate;
      }

      if (n % aCada === 0) progresso(t, aj.duracao);
    }

    if (cancelar) {
      await output.cancel();
      if (escrita) await escrita.abort().catch(() => {});
      if (destino.alca?.remove) await destino.alca.remove().catch(() => {});
      return { ok: false, cancelado: true };
    }

    await output.finalize();

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
             motor: 'API de video do navegador, ' + (nomes[vcodec] || vcodec) +
                    (acodec ? ' e ' + acodec.toUpperCase() : '') };
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
