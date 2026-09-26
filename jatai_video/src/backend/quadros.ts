// Os quadros: a previa do reprodutor, a miniatura da cesta e a tira de cada
// clipe. Faz o papel do FrameReader do decoder.h e das duas filas do app.h.
//
// As regras sao as mesmas do C++, porque os motivos continuam valendo:
//
// - ANDAR PARA A FRENTE E MAIS BARATO QUE BUSCAR. O leitor mantem o
//   decodificador aberto; se o instante pedido esta logo adiante do quadro que
//   ja temos, ele decodifica em frente em vez de voltar ao quadro-chave.
// - O CURSOR ANDA MAIS RAPIDO DO QUE DECODIFICAMOS. Um pedido de previa que
//   ainda espera na fila e atropelado pelo mais novo da MESMA camada, e
//   respondido com `stale` - senao a promessa do lado da pagina ficaria
//   pendurada para sempre.
// - A IMAGEM VAI POR ENDERECO. Cada quadro vira um blob com URL propria, e o
//   que sai de circulacao e revogado. Um endereco velho responde nada, nunca a
//   imagem de outro quadro - e a pagina ja sabe pedir outra quando isso ocorre.

import { VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny';
import { cesta, mensagem, type Entrada } from './midia';

export interface RespostaImagem {
  ok: boolean;
  url?: string;
  count?: number;
  stale?: boolean;
  error?: string;
}

// ------------------------------------------------------------- publicar

// Quantos enderecos ficam vivos por tipo: a previa ("q") publica sem parar e so
// precisa dos que estao na tela; tiras ("t") e miniaturas ("m") ficam a vista
// por muito tempo.
const VIVOS: Record<string, number> = { q: 48, t: 256, m: 256 };
const publicados = new Map<string, string[]>();

function publica(blob: Blob, tipo: 'q' | 't' | 'm'): string {
  const url = URL.createObjectURL(blob);
  let fila = publicados.get(tipo);
  if (!fila) publicados.set(tipo, (fila = []));
  fila.push(url);
  while (fila.length > VIVOS[tipo]) URL.revokeObjectURL(fila.shift()!);
  return url;
}

// Uma tela de desenho reaproveitada: criar uma por quadro custaria mais do que
// desenhar nela.
let tela: OffscreenCanvas | null = null;
function telaDe(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!tela) tela = new OffscreenCanvas(w, h);
  if (tela.width !== w) tela.width = w;
  if (tela.height !== h) tela.height = h;
  const ctx = tela.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

async function jpeg(ctx: OffscreenCanvasRenderingContext2D, qualidade = 0.85): Promise<Blob> {
  return ctx.canvas.convertToBlob({ type: 'image/jpeg', quality: qualidade });
}

// O tamanho que cabe na caixa pedida, mantendo a proporcao. Nao amplia: o
// navegador estica a <img> de graca, e decodificar maior do que o arquivo e
// trabalho que nao aparece.
export function cabendo(sw: number, sh: number, maxW: number, maxH: number): { w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { w: Math.max(2, maxW), h: Math.max(2, maxH) };
  const k = Math.min(1, maxW / sw, maxH / sh);
  return { w: Math.max(2, Math.round(sw * k)), h: Math.max(2, Math.round(sh * k)) };
}

// ------------------------------------------------------------- o leitor

export class LeitorQuadros {
  private sink: VideoSampleSink;
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private atual: VideoSample | null = null;
  private proximo: VideoSample | null = null;

  // Quanto adiante ainda vale decodificar em frente em vez de buscar. Passando
  // disso, voltar ao quadro-chave e mais rapido.
  static readonly FOLGA = 2.5;

  constructor(track: InputVideoTrack) {
    this.sink = new VideoSampleSink(track);
  }

  // O quadro do instante `t`: o ultimo cujo inicio e <= t. Depois do fim do
  // arquivo vale o ultimo quadro - e o que se ve parado no fim de um clipe.
  async quadro(t: number): Promise<VideoSample | null> {
    const perto = this.atual && t >= this.atual.timestamp - 1e-6 &&
                  t - this.atual.timestamp < LeitorQuadros.FOLGA;
    if (!this.iter || !perto) await this.reabre(t);

    while (this.proximo && this.proximo.timestamp <= t + 1e-6) {
      this.atual?.close();
      this.atual = this.proximo;
      this.proximo = await this.puxa();
    }
    return this.atual;
  }

  private async reabre(t: number): Promise<void> {
    await this.fecha();
    this.iter = this.sink.samples(Math.max(0, t));
    this.atual = await this.puxa();
    this.proximo = this.atual ? await this.puxa() : null;
    // Passou do fim: o iterador nao entrega nada, e o ultimo quadro vem da
    // busca direta.
    if (!this.atual) this.atual = await this.sink.getSample(Math.max(0, t));
  }

  private async puxa(): Promise<VideoSample | null> {
    if (!this.iter) return null;
    const r = await this.iter.next();
    return r.done ? null : (r.value as VideoSample);
  }

  async fecha(): Promise<void> {
    const it = this.iter;
    this.iter = null;
    this.atual?.close();
    this.proximo?.close();
    this.atual = this.proximo = null;
    if (it) await it.return(undefined).catch(() => {});
  }
}

// Leitores por midia, poucos, porque cada um segura um decodificador. Oito para
// a previa - uma camada por clipe sob a agulha - e quatro para as tiras, que
// tem os seus: um leitor nao aguenta dois donos andando em lugares diferentes.
class Leitores {
  private mapa = new Map<number, LeitorQuadros>();
  constructor(private max: number) {}

  de(e: Entrada): LeitorQuadros | null {
    if (!e.video) return null;
    let l = this.mapa.get(e.item.id);
    if (l) return l;
    if (this.mapa.size >= this.max) {
      const [id, velho] = this.mapa.entries().next().value!;
      this.mapa.delete(id);
      void velho.fecha();
    }
    l = new LeitorQuadros(e.video);
    this.mapa.set(e.item.id, l);
    return l;
  }

  esquece(id: number): void {
    const l = this.mapa.get(id);
    if (l) { this.mapa.delete(id); void l.fecha(); }
  }
}

const leitoresPrevia = new Leitores(8);
const leitoresTira = new Leitores(4);

export function esqueceLeitores(id: number): void {
  leitoresPrevia.esquece(id);
  leitoresTira.esquece(id);
}

// ------------------------------------------------------------- as filas

interface Tarefa<T> {
  camada: number | null;   // pedidos de previa: a camada que o fez
  roda: () => Promise<T>;
  responde: (r: T) => void;
}

// Uma fila atendida em ordem, um pedido de cada vez - como a thread do C++.
class Fila<T> {
  private tarefas: Tarefa<T>[] = [];
  private rodando = false;

  constructor(private atropelado: () => T, private falhou: (msg: string) => T) {}

  pede(camada: number | null, roda: () => Promise<T>): Promise<T> {
    return new Promise((responde) => {
      if (camada !== null) {
        this.tarefas = this.tarefas.filter((t) => {
          if (t.camada !== camada) return true;
          t.responde(this.atropelado());
          return false;
        });
      }
      this.tarefas.push({ camada, roda, responde });
      if (!this.rodando) void this.atende();
    });
  }

  private async atende(): Promise<void> {
    this.rodando = true;
    while (this.tarefas.length) {
      const t = this.tarefas.shift()!;
      try { t.responde(await t.roda()); }
      catch (e) { t.responde(this.falhou(mensagem(e))); }
    }
    this.rodando = false;
  }
}

const atropelado = (): RespostaImagem => ({ ok: false, stale: true });
const falhou = (error: string): RespostaImagem => ({ ok: false, error });

// A previa e as miniaturas numa fila; as tiras (e as ondas, em onda.ts) em
// outra - senao arrastar o cursor engasgaria toda vez que um clipe entrasse.
const filaPrevia = new Fila<RespostaImagem>(atropelado, falhou);
export const filaLenta = new Fila<unknown>(() => ({ ok: false, stale: true }),
                                           (error) => ({ ok: false, error }));

// ------------------------------------------------------------- desenhar

// Desenha o quadro de `e` no instante `t`, cabendo em maxW x maxH. Devolve a
// tela desenhada, ou um erro.
async function desenha(e: Entrada, leitor: LeitorQuadros | null, t: number,
                       maxW: number, maxH: number): Promise<OffscreenCanvasRenderingContext2D | string> {
  if (e.imagem) {
    const m = cabendo(e.imagem.width, e.imagem.height, maxW, maxH);
    const ctx = telaDe(m.w, m.h);
    ctx.drawImage(e.imagem, 0, 0, m.w, m.h);
    return ctx;
  }
  if (!leitor) return 'sem video neste item';
  const q = await leitor.quadro(t);
  if (!q) return 'nao foi possivel ler este quadro';
  const m = cabendo(q.displayWidth, q.displayHeight, maxW, maxH);
  const ctx = telaDe(m.w, m.h);
  q.drawWithFit(ctx, { fit: 'fill' });
  return ctx;
}

// ------------------------------------------------------------- pedidos

// jtThumb(mediaId): um quadro logo depois do inicio - muitos videos comecam no
// escuro.
export function thumb(id: number): Promise<RespostaImagem> {
  const e = cesta.find(id);
  if (!e || !e.item.hasVideo) return Promise.resolve({ ok: false, error: 'sem video neste item' });
  const t = e.item.duration > 0 ? Math.min(1, e.item.duration * 0.1) : 0;
  return filaPrevia.pede(null, async () => {
    const r = await desenha(e, leitoresPrevia.de(e), t, 320, 180);
    if (typeof r === 'string') return { ok: false, error: r };
    return { ok: true, url: publica(await jpeg(r), 'm') };
  });
}

// jtFrameAt(mediaId, segundos, larguraMax, alturaMax, camada, recorte, ...).
// O recorte do fundo ainda nao existe no navegador: pedido ou nao, o quadro
// sai inteiro - que era tambem o que o C++ fazia quando nao havia recorte.
export function frameAt(id: number, sec: number, maxW: number, maxH: number,
                        camada: number): Promise<RespostaImagem> {
  const e = cesta.find(id);
  if (!e || !e.item.hasVideo) return Promise.resolve({ ok: false, error: 'sem video neste item' });
  return filaPrevia.pede(camada | 0, async () => {
    const r = await desenha(e, leitoresPrevia.de(e), sec, Math.max(16, maxW), Math.max(16, maxH));
    if (typeof r === 'string') return { ok: false, error: r };
    return { ok: true, url: publica(await jpeg(r), 'q') };
  });
}

// jtStrip(mediaId, de, ate, quadros, altura): as miniaturas lado a lado, numa
// imagem so. Cada uma e o quadro do CENTRO do pedaco de tempo que ocupa.
export function strip(id: number, t0: number, t1: number, count: number,
                      tileH: number): Promise<RespostaImagem> {
  const e = cesta.find(id);
  if (!e || !e.item.hasVideo) return Promise.resolve({ ok: false, error: 'sem video neste item' });
  count = Math.max(1, Math.min(96, count | 0));
  tileH = Math.max(8, Math.min(120, tileH | 0));
  t0 = Math.max(0, t0);
  if (!(t1 > t0)) return Promise.resolve({ ok: false, error: 'janela vazia' });

  return filaLenta.pede(null, async () => {
    const prop = e.item.width > 0 && e.item.height > 0 ? e.item.width / e.item.height : 16 / 9;
    const tileW = Math.max(4, Math.round(tileH * prop));
    const quadro = new OffscreenCanvas(tileW * count, tileH);
    const ctx = quadro.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';

    // Cada miniatura passa por uma tela do tamanho dela: `drawWithFit` e o que
    // respeita a rotacao gravada no arquivo, e ele desenha na tela inteira.
    const peca = new OffscreenCanvas(tileW, tileH);
    const pctx = peca.getContext('2d')!;
    const leitor = leitoresTira.de(e);
    for (let i = 0; i < count; i++) {
      const t = t0 + (t1 - t0) * (i + 0.5) / count;
      if (e.imagem) { ctx.drawImage(e.imagem, i * tileW, 0, tileW, tileH); continue; }
      const q = leitor ? await leitor.quadro(t) : null;
      if (!q) continue;
      q.drawWithFit(pctx, { fit: 'cover' });
      ctx.drawImage(peca, i * tileW, 0);
    }
    const blob = await quadro.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return { ok: true, url: publica(blob, 't'), count };
  }) as Promise<RespostaImagem>;
}

// A capa de um projeto: um quadro pequeno, ja como data URL, porque ela vai
// morar no IndexedDB junto do projeto e um blob: nao sobrevive a sessao.
export async function capa(id: number, sec: number): Promise<string> {
  const e = cesta.find(id);
  if (!e || !e.item.hasVideo) return '';
  const r = await filaPrevia.pede(null, async () => {
    const d = await desenha(e, leitoresPrevia.de(e), sec, 480, 270);
    if (typeof d === 'string') return { ok: false, error: d };
    const blob = await jpeg(d, 0.8);
    const url = await new Promise<string>((ok) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => ok('');
      fr.readAsDataURL(blob);
    });
    return { ok: !!url, url };
  });
  return r.ok && r.url ? r.url : '';
}
