import type { FontId } from './text-layout';

/*
 * Todo elemento é uma caixa (x, y, largura, altura) em px do documento.
 * Linhas e desenhos guardam seus pontos normalizados (0–1) dentro da caixa,
 * então mover e redimensionar funcionam igual para todos os tipos.
 *
 * Elementos são imutáveis: toda alteração cria um objeto novo (ver
 * DesignDocument.updateElements). Isso deixa o histórico de desfazer barato.
 */

interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0–1 */
  opacity: number;
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface LineElement extends BaseElement {
  type: 'line';
  /** [x1, y1, x2, y2] normalizados na caixa. */
  points: readonly number[];
  stroke: string;
  strokeWidth: number;
}

export interface PathElement extends BaseElement {
  type: 'path';
  /** [x, y, x, y, ...] normalizados na caixa. */
  points: readonly number[];
  stroke: string;
  strokeWidth: number;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontFamily: FontId;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  color: string;
  align: TextAlign;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** Data URL da imagem. */
  src: string;
}

export type DesignElement =
  | Readonly<RectangleElement>
  | Readonly<EllipseElement>
  | Readonly<LineElement>
  | Readonly<PathElement>
  | Readonly<TextElement>
  | Readonly<ImageElement>;

export type ElementType = DesignElement['type'];

type Fields<T> = Omit<T, 'id' | 'type'>;

/** Qualquer combinação de campos editáveis (o chamador garante que fazem sentido para o tipo). */
export type ElementPatch = Partial<
  Fields<RectangleElement> &
    Fields<EllipseElement> &
    Fields<LineElement> &
    Fields<PathElement> &
    Fields<TextElement> &
    Fields<ImageElement>
>;

let counter = 0;

export function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Pontos absolutos [x, y, ...] → caixa + pontos normalizados. */
export function boxFromPoints(absolute: readonly number[]): {
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < absolute.length; i += 2) {
    minX = Math.min(minX, absolute[i]);
    maxX = Math.max(maxX, absolute[i]);
    minY = Math.min(minY, absolute[i + 1]);
    maxY = Math.max(maxY, absolute[i + 1]);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const points = absolute.map((value, i) =>
    i % 2 === 0 ? (width ? (value - minX) / width : 0) : height ? (value - minY) / height : 0,
  );
  return { x: minX, y: minY, width, height, points };
}

/** Pontos normalizados → coordenadas absolutas do documento. */
export function absolutePoints(el: Readonly<LineElement> | Readonly<PathElement>): number[] {
  return el.points.map((value, i) => (i % 2 === 0 ? el.x + value * el.width : el.y + value * el.height));
}

const INK = '#1a1917';

export function createRectangle(x: number, y: number, width: number, height: number): RectangleElement {
  return { id: newId(), type: 'rectangle', x, y, width, height, opacity: 1, fill: '#ffc107', stroke: INK, strokeWidth: 0, radius: 0 };
}

export function createEllipse(x: number, y: number, width: number, height: number): EllipseElement {
  return { id: newId(), type: 'ellipse', x, y, width, height, opacity: 1, fill: '#ff9800', stroke: INK, strokeWidth: 0 };
}

export function createLine(absolute: readonly number[]): LineElement {
  return { id: newId(), type: 'line', ...boxFromPoints(absolute), opacity: 1, stroke: INK, strokeWidth: 8 };
}

export function createPath(absolute: readonly number[]): PathElement {
  return { id: newId(), type: 'path', ...boxFromPoints(absolute), opacity: 1, stroke: INK, strokeWidth: 6 };
}

/** Largura/altura do texto são calculadas pelo documento a partir do conteúdo. */
export function createText(x: number, y: number, fontSize: number): TextElement {
  return {
    id: newId(),
    type: 'text',
    x,
    y,
    width: 0,
    height: 0,
    opacity: 1,
    text: '',
    fontFamily: 'Nunito',
    fontSize,
    fontWeight: 700,
    lineHeight: 1.2,
    color: INK,
    align: 'left',
  };
}

export function createImage(src: string, x: number, y: number, width: number, height: number): ImageElement {
  return { id: newId(), type: 'image', x, y, width, height, opacity: 1, src };
}

export function cloneElement(el: DesignElement, dx: number, dy: number): DesignElement {
  return { ...el, id: newId(), x: el.x + dx, y: el.y + dy };
}
