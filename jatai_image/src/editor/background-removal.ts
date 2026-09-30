import { preloadImage } from './images';

/*
 * Remoção de fundo por cor ("varinha mágica"), sem IA: bom para logos,
 * silhuetas, ícones e prints com fundo liso. Roda inteiro no navegador.
 *
 * Três formas de marcar o que sai, combináveis:
 *  - bordas: a cor do fundo, a partir das bordas da imagem;
 *  - áreas internas: a cor do fundo em qualquer lugar;
 *  - pontos da varinha: a região conectada a cada ponto clicado, com cor
 *    parecida à do próprio ponto (não afeta áreas iguais que não se tocam).
 */

/** Ponto da varinha, normalizado (0–1) na imagem original. */
export type WandPoint = readonly [x: number, y: number];

/** Traço de pincel sobre a imagem: apaga ou traz de volta o original. */
export interface BrushStroke {
  mode: 'erase' | 'restore';
  /** Diâmetro da ponta, relativo à largura da imagem. */
  size: number;
  /** [x, y, x, y, ...] normalizados (0–1) na imagem. */
  points: readonly number[];
}

export interface BackgroundRemovalOptions {
  /** 0–100: quão diferente da cor de referência um pixel pode ser e ainda sair. */
  tolerance: number;
  /** Remove a cor do fundo a partir das bordas da imagem. */
  edges: boolean;
  /** Remove também áreas da cor do fundo que não tocam a borda (miolos, vãos). */
  interior: boolean;
  /** Regiões apagadas com a varinha mágica. */
  seeds: readonly WandPoint[];
  /** Traços de borracha/restaurar, aplicados por último, na ordem. */
  strokes: readonly BrushStroke[];
}

export const DEFAULT_BG_REMOVAL: BackgroundRemovalOptions = {
  tolerance: 20,
  edges: false,
  interior: false,
  seeds: [],
  strokes: [],
};

function traceStroke(ctx: CanvasRenderingContext2D, stroke: BrushStroke, width: number, height: number): void {
  const pts = stroke.points;
  ctx.beginPath();
  ctx.moveTo(pts[0] * width, pts[1] * height);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * width, pts[i + 1] * height);
  if (pts.length === 2) ctx.lineTo(pts[0] * width + 0.01, pts[1] * height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, stroke.size * width);
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

/**
 * Aplica traços de pincel sobre `ctx` (já com a imagem processada):
 * borracha tira os pixels; restaurar pinta de volta o `original`.
 * Usado no resultado final e na prévia ao vivo enquanto se arrasta.
 */
export function applyBrushStrokes(
  ctx: CanvasRenderingContext2D,
  original: CanvasImageSource,
  strokes: readonly BrushStroke[],
  width: number,
  height: number,
): void {
  let mask: CanvasRenderingContext2D | null = null;
  for (const stroke of strokes) {
    if (stroke.mode === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      traceStroke(ctx, stroke, width, height);
      ctx.restore();
      continue;
    }
    // Restaurar: recorta o original no formato do traço e pinta por cima.
    if (!mask) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      mask = canvas.getContext('2d')!;
    }
    mask.globalCompositeOperation = 'source-over';
    mask.clearRect(0, 0, width, height);
    traceStroke(mask, stroke, width, height);
    mask.globalCompositeOperation = 'source-in';
    mask.drawImage(original, 0, 0, width, height);
    ctx.drawImage(mask.canvas, 0, 0);
  }
}

/**
 * Faixa (na escala 0–255 de distância) em que o contorno fica semitransparente
 * em vez de cortar seco. Vale para o anel de pixels colado à área removida,
 * que é onde fica o serrilhado (anti-aliasing) da imagem original.
 */
const EDGE_SOFTNESS = 128;
/** Pixels quase transparentes já contam como fundo. */
const TRANSPARENT_ALPHA = 16;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', () => reject(new Error('Falha ao carregar a imagem')));
    img.src = src;
  });
}

/** Cor mais comum na borda da imagem (agrupando tons parecidos). */
function borderColor(data: Uint8ClampedArray, width: number, height: number): Rgb {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number) => {
    const p = (y * width + x) * 4;
    if (data[p + 3] < TRANSPARENT_ALPHA) return;
    const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += data[p];
    bucket.g += data[p + 1];
    bucket.b += data[p + 2];
    buckets.set(key, bucket);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }

  let best: { count: number; r: number; g: number; b: number } | undefined;
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket;
  if (!best) return { r: 255, g: 255, b: 255 };
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

/** Distância (0–255) do pixel à cor: maior diferença entre canais. Transparente conta como igual. */
function distanceTo(data: Uint8ClampedArray, p: number, color: Rgb): number {
  if (data[p + 3] < TRANSPARENT_ALPHA) return 0;
  return Math.max(Math.abs(data[p] - color.r), Math.abs(data[p + 1] - color.g), Math.abs(data[p + 2] - color.b));
}

/** Remove o fundo e devolve um PNG transparente (data URL), já carregado no cache. */
export async function removeBackground(src: string, options: BackgroundRemovalOptions): Promise<string> {
  const img = await loadImage(src);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const total = width * height;
  const threshold = (options.tolerance / 100) * 255;

  // Cores de referência: 0 = fundo; 1..n = cor de cada ponto da varinha.
  const colors: Rgb[] = [borderColor(data, width, height)];
  /** Referência (índice + 1) com que cada pixel foi removido; 0 = mantido. */
  const removedBy = new Uint16Array(total);
  const queue = new Int32Array(total);

  /** Apaga a região conectada a partir das sementes, parecida com a cor `ref`. */
  const flood = (seeds: Iterable<number>, ref: number) => {
    const color = colors[ref];
    let head = 0;
    let tail = 0;
    const visit = (i: number) => {
      if (removedBy[i] || distanceTo(data, i * 4, color) > threshold) return;
      removedBy[i] = ref + 1;
      queue[tail++] = i;
    };
    for (const i of seeds) visit(i);
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i < total - width) visit(i + width);
    }
  };

  if (options.interior) {
    for (let i = 0; i < total; i++) if (distanceTo(data, i * 4, colors[0]) <= threshold) removedBy[i] = 1;
  } else if (options.edges) {
    const border: number[] = [];
    for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) border.push(y * width, y * width + width - 1);
    flood(border, 0);
  }

  for (const [nx, ny] of options.seeds) {
    const x = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
    const i = y * width + x;
    if (removedBy[i]) continue;
    const p = i * 4;
    colors.push({ r: data[p], g: data[p + 1], b: data[p + 2] });
    flood([i], colors.length - 1);
  }

  /** Referência de um vizinho removido (para suavizar o contorno), ou -1. */
  const neighborRef = (i: number) => {
    const x = i % width;
    if (x > 0 && removedBy[i - 1]) return removedBy[i - 1] - 1;
    if (x < width - 1 && removedBy[i + 1]) return removedBy[i + 1] - 1;
    if (i >= width && removedBy[i - width]) return removedBy[i - width] - 1;
    if (i < total - width && removedBy[i + width]) return removedBy[i + width] - 1;
    return -1;
  };

  for (let i = 0, p = 0; i < total; i++, p += 4) {
    if (removedBy[i]) {
      data[p + 3] = 0;
      continue;
    }
    // Contorno colado a uma área removida fica suave. No modo "áreas internas"
    // a cor do fundo sai da imagem toda, então tons próximos dela (o serrilhado
    // de traços finos) também ficam parcialmente transparentes.
    let ref = neighborRef(i);
    if (ref < 0 && options.interior) ref = 0;
    if (ref < 0) continue;

    const color = colors[ref];
    const alpha = Math.min(1, (distanceTo(data, p, color) - threshold) / EDGE_SOFTNESS);
    if (alpha >= 1) continue;
    if (alpha <= 0) {
      data[p + 3] = 0;
      continue;
    }
    // Tira do pixel a parte que era a cor removida misturada (evita auréola).
    data[p] = Math.max(0, Math.min(255, (data[p] - (1 - alpha) * color.r) / alpha));
    data[p + 1] = Math.max(0, Math.min(255, (data[p + 1] - (1 - alpha) * color.g) / alpha));
    data[p + 2] = Math.max(0, Math.min(255, (data[p + 2] - (1 - alpha) * color.b) / alpha));
    data[p + 3] = Math.round(data[p + 3] * alpha);
  }

  ctx.putImageData(image, 0, 0);
  if (options.strokes.length) applyBrushStrokes(ctx, img, options.strokes, width, height);
  const result = canvas.toDataURL('image/png');
  await preloadImage(result);
  return result;
}
