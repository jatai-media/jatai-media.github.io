import type { TextElement } from './elements';

/** Fontes oferecidas no editor. Nunito é carregada pelo Google Fonts; as demais são do sistema. */
export const FONTS = [
  { id: 'Nunito', css: '"Nunito", system-ui, sans-serif' },
  { id: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { id: 'Georgia', css: 'Georgia, serif' },
  { id: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'Courier New', css: '"Courier New", Courier, monospace' },
  { id: 'Impact', css: 'Impact, "Arial Black", sans-serif' },
] as const;

export type FontId = (typeof FONTS)[number]['id'];

type TextStyle = Pick<TextElement, 'fontFamily' | 'fontSize' | 'fontWeight'>;
type TextLayoutInput = Pick<TextElement, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight'>;

export function fontCss(id: FontId): string {
  return FONTS.find((font) => font.id === id)?.css ?? FONTS[0].css;
}

export function fontString(style: TextStyle): string {
  return `${style.fontWeight} ${style.fontSize}px ${fontCss(style.fontFamily)}`;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

/** Tamanho da caixa do texto (sem quebra automática: uma linha por \n). */
export function measureText(el: TextLayoutInput): { width: number; height: number } {
  measureCtx.font = fontString(el);
  const lines = el.text.split('\n');
  const widest = Math.max(...lines.map((line) => measureCtx.measureText(line).width));
  return {
    width: Math.ceil(Math.max(widest, el.fontSize * 0.3)),
    height: lines.length * el.fontSize * el.lineHeight,
  };
}

/**
 * Distância do topo de cada linha até a linha de base, reproduzindo o
 * "half-leading" do CSS. Assim o texto no canvas cai exatamente onde
 * estava no campo de edição.
 */
export function baselineOffset(ctx: CanvasRenderingContext2D, el: TextLayoutInput): number {
  ctx.font = fontString(el);
  const metrics = ctx.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent;
  return (el.fontSize * el.lineHeight - (ascent + descent)) / 2 + ascent;
}
