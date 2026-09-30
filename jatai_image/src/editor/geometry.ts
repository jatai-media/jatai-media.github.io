import { absolutePoints, absoluteStrokes, type DesignElement } from './elements';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ALL_HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNER_HANDLES: readonly Handle[] = ['nw', 'ne', 'se', 'sw'];

export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Texto sozinho só escala pelos cantos (o tamanho vem da fonte). */
export function handlesFor(elements: readonly DesignElement[]): readonly Handle[] {
  return elements.length === 1 && elements[0].type === 'text' ? CORNER_HANDLES : ALL_HANDLES;
}

export function handlePoint(rect: Rect, handle: Handle): Point {
  const x = handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2;
  const y = handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2;
  return { x, y };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function unionBounds(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.x);
    top = Math.min(top, r.y);
    right = Math.max(right, r.x + r.width);
    bottom = Math.max(bottom, r.y + r.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function distanceToSegment(p: Point, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

function nearPolyline(p: Point, pts: readonly number[], reach: number): boolean {
  if (pts.length === 2) return Math.hypot(p.x - pts[0], p.y - pts[1]) <= reach;
  for (let i = 2; i < pts.length; i += 2) {
    if (distanceToSegment(p, pts[i - 2], pts[i - 1], pts[i], pts[i + 1]) <= reach) return true;
  }
  return false;
}

/** O ponto (documento) acerta o elemento? `tolerance` em px do documento. */
export function hitTest(el: DesignElement, p: Point, tolerance: number): boolean {
  switch (el.type) {
    case 'line':
      return nearPolyline(p, absolutePoints(el), el.strokeWidth / 2 + tolerance);

    case 'path':
      return absoluteStrokes(el).some((stroke) => nearPolyline(p, stroke.points, stroke.width / 2 + tolerance));

    case 'ellipse': {
      const extra = el.strokeWidth / 2 + tolerance;
      const rx = el.width / 2 + extra;
      const ry = el.height / 2 + extra;
      const dx = (p.x - (el.x + el.width / 2)) / rx;
      const dy = (p.y - (el.y + el.height / 2)) / ry;
      return dx * dx + dy * dy <= 1;
    }

    default: {
      const extra = (el.type === 'rectangle' ? el.strokeWidth / 2 : 0) + tolerance;
      return (
        p.x >= el.x - extra && p.x <= el.x + el.width + extra && p.y >= el.y - extra && p.y <= el.y + el.height + extra
      );
    }
  }
}

/** Elemento mais à frente sob o ponto. */
export function elementAt(elements: readonly DesignElement[], p: Point, tolerance: number): DesignElement | undefined {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTest(elements[i], p, tolerance)) return elements[i];
  }
  return undefined;
}

/**
 * Novo retângulo ao arrastar uma alça de `start` por (dx, dy).
 * Com keepRatio, cantos mantêm a proporção e as alças laterais crescem
 * pelo centro no outro eixo.
 */
export function resizeBounds(start: Rect, handle: Handle, dx: number, dy: number, keepRatio: boolean): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (handle.includes('w')) left = Math.min(left + dx, right - 1);
  if (handle.includes('e')) right = Math.max(right + dx, left + 1);
  if (handle.includes('n')) top = Math.min(top + dy, bottom - 1);
  if (handle.includes('s')) bottom = Math.max(bottom + dy, top + 1);

  if (keepRatio && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    let width = right - left;
    let height = bottom - top;

    if (handle === 'e' || handle === 'w') {
      height = width / ratio;
      top = start.y + (start.height - height) / 2;
      bottom = top + height;
    } else if (handle === 'n' || handle === 's') {
      width = height * ratio;
      left = start.x + (start.width - width) / 2;
      right = left + width;
    } else {
      if (width / start.width > height / start.height) height = width / ratio;
      else width = height * ratio;
      if (handle.includes('n')) top = bottom - height;
      else bottom = top + height;
      if (handle.includes('w')) left = right - width;
      else right = left + width;
    }
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Leva `rect` do espaço de `from` para o de `to` (usado ao redimensionar grupos). */
export function mapRect(rect: Rect, from: Rect, to: Rect): Rect {
  const sx = from.width ? to.width / from.width : 1;
  const sy = from.height ? to.height / from.height : 1;
  return {
    x: to.x + (rect.x - from.x) * sx,
    y: to.y + (rect.y - from.y) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  };
}

/** Fixa o ângulo de a→b em múltiplos de 45°. */
export function snapAngle(a: Point, b: Point): Point {
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
}
