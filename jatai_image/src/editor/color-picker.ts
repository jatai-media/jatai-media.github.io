import type { Editor } from './editor';

/** API nativa de conta-gotas (Chrome/Edge); ainda não está nos tipos do TypeScript. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
type EyeDropperConstructor = new () => EyeDropperApi;

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/** Aceita "#rrggbb" ou "rgb(r, g, b)" (alguns navegadores devolvem assim). */
function normalizeColor(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = value.match(/\d+/g);
  return rgb && rgb.length >= 3 ? toHex(Number(rgb[0]), Number(rgb[1]), Number(rgb[2])) : null;
}

/**
 * Conta-gotas. Com a API nativa, pega cor de qualquer lugar da tela; sem
 * ela, espera um clique no canvas (Esc cancela). Devolve null se cancelado.
 */
export function pickColor(editor: Editor): Promise<string | null> {
  const Native = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  if (Native) {
    return new Native()
      .open()
      .then((result) => normalizeColor(result.sRGBHex))
      .catch(() => null);
  }

  return new Promise((resolve) => {
    const finish = (color: string | null) => {
      editor.ui.colorPick = null;
      editor.stage.classList.remove('is-picking');
      window.removeEventListener('keydown', onKey, true);
      resolve(color);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    editor.ui.colorPick?.('');
    window.addEventListener('keydown', onKey, true);
    editor.ui.colorPick = (color) => finish(color || null);
    editor.stage.classList.add('is-picking');
  });
}

/** Cor do pixel do canvas da área de trabalho sob o ponto (px CSS do stage). */
export function sampleCanvas(canvas: HTMLCanvasElement, x: number, y: number): string {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data;
  return toHex(r, g, b);
}
