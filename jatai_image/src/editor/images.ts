const cache = new Map<string, HTMLImageElement>();
let onLoad: () => void = () => {};

/** Chamado quando alguma imagem termina de carregar (para redesenhar). */
export function setImageLoadListener(listener: () => void): void {
  onLoad = listener;
}

/** Imagem pronta para desenhar, ou null enquanto carrega. */
export function getImage(src: string): HTMLImageElement | null {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.addEventListener('load', () => onLoad());
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Carrega a imagem no cache antes de usá-la (evita piscar ao trocar o src de um elemento). */
export function preloadImage(src: string): Promise<void> {
  const cached = cache.get(src);
  if (cached?.complete && cached.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => {
      cache.set(src, img);
      resolve();
    });
    img.addEventListener('error', () => reject(new Error('Falha ao carregar a imagem')));
    img.src = src;
  });
}

/** Lê um arquivo de imagem como data URL e descobre o tamanho original. */
export function readImageFile(file: File): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(reader.error));
    reader.addEventListener('load', () => {
      const src = reader.result as string;
      const img = new Image();
      img.addEventListener('error', () => reject(new Error(`Imagem inválida: ${file.name}`)));
      img.addEventListener('load', () => {
        cache.set(src, img);
        resolve({ src, width: img.naturalWidth, height: img.naturalHeight });
      });
      img.src = src;
    });
    reader.readAsDataURL(file);
  });
}
