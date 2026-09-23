import { preloadImage } from './images';

/*
 * Remoção de fundo por cor ("varinha mágica"), sem IA: bom para logos,
 * silhuetas, ícones e prints com fundo liso. Roda inteiro no navegador.
 */

export interface BackgroundRemovalOptions {
  /** 0–100: quão diferente da cor do fundo um pixel pode ser e ainda sair. */
  tolerance: number;
  /** Remove também áreas da cor do fundo que não tocam a borda (miolos, vãos). */
  interior: boolean;
}

export const DEFAULT_BG_REMOVAL: BackgroundRemovalOptions = { tolerance: 20, interior: false };

/**
 * Faixa (na escala 0–255 de distância) em que o contorno fica semitransparente
 * em vez de cortar seco. Só vale para o anel de pixels colado à área removida,
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

/** Marca como removidos os pixels parecidos com o fundo conectados à borda. */
function floodFromBorders(distance: Uint8Array, removed: Uint8Array, width: number, height: number, threshold: number): void {
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (i: number) => {
    if (removed[i] || distance[i] > threshold) return;
    removed[i] = 1;
    queue[tail++] = i;
  };

  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < width * (height - 1)) visit(i + width);
  }
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

  // Distância de cada pixel ao fundo: maior diferença entre canais (0–255).
  const bg = borderColor(data, width, height);
  const distance = new Uint8Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    distance[i] =
      data[p + 3] < TRANSPARENT_ALPHA
        ? 0
        : Math.max(Math.abs(data[p] - bg.r), Math.abs(data[p + 1] - bg.g), Math.abs(data[p + 2] - bg.b));
  }

  const threshold = (options.tolerance / 100) * 255;
  const removed = new Uint8Array(total);
  if (options.interior) {
    for (let i = 0; i < total; i++) if (distance[i] <= threshold) removed[i] = 1;
  } else {
    floodFromBorders(distance, removed, width, height, threshold);
  }

  const touchesRemoved = (i: number) => {
    const x = i % width;
    return (
      (x > 0 && removed[i - 1] === 1) ||
      (x < width - 1 && removed[i + 1] === 1) ||
      (i >= width && removed[i - width] === 1) ||
      (i < total - width && removed[i + width] === 1)
    );
  };

  for (let i = 0, p = 0; i < total; i++, p += 4) {
    if (removed[i]) {
      data[p + 3] = 0;
      continue;
    }
    // Modo normal: só o contorno colado à área removida fica suave.
    // Modo "áreas internas": a cor sai da imagem toda, então tons próximos dela
    // (o serrilhado de traços finos) também ficam parcialmente transparentes.
    if (!options.interior && !touchesRemoved(i)) continue;

    // Transparência proporcional à diferença do fundo, e tira do pixel
    // a parte que era cor de fundo misturada (evita a auréola clara).
    const alpha = Math.min(1, (distance[i] - threshold) / EDGE_SOFTNESS);
    if (alpha >= 1) continue;
    if (alpha <= 0) {
      data[p + 3] = 0;
      continue;
    }
    data[p] = Math.max(0, Math.min(255, (data[p] - (1 - alpha) * bg.r) / alpha));
    data[p + 1] = Math.max(0, Math.min(255, (data[p + 1] - (1 - alpha) * bg.g) / alpha));
    data[p + 2] = Math.max(0, Math.min(255, (data[p + 2] - (1 - alpha) * bg.b) / alpha));
    data[p + 3] = Math.round(data[p + 3] * alpha);
  }

  ctx.putImageData(image, 0, 0);
  const result = canvas.toDataURL('image/png');
  await preloadImage(result);
  return result;
}
