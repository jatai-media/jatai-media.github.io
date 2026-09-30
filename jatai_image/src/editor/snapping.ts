import type { DesignDocument } from './document';
import type { Rect } from './geometry';

/** Distância (px de tela) em que uma borda/centro "gruda" numa guia. */
export const SNAP_THRESHOLD = 6;

/** Linha de guia em coordenadas do documento: vertical (x) ou horizontal (y). */
export interface Guide {
  axis: 'x' | 'y';
  /** Posição da linha no eixo (x para vertical, y para horizontal). */
  position: number;
  /** Extensão da linha no outro eixo. */
  start: number;
  end: number;
}

interface Target {
  value: number;
  /** Retângulo de onde veio o alvo (para desenhar a guia até ele). */
  source: Rect;
}

export interface SnapTargets {
  x: Target[];
  y: Target[];
}

/** Bordas e centros da prancheta e dos elementos que não estão sendo movidos. */
export function collectTargets(doc: DesignDocument, exclude: ReadonlySet<string>): SnapTargets {
  const rects: Rect[] = [
    { x: 0, y: 0, width: doc.width, height: doc.height },
    ...doc.elements.filter((el) => !exclude.has(el.id)),
  ];
  const targets: SnapTargets = { x: [], y: [] };
  for (const r of rects) {
    for (const value of [r.x, r.x + r.width / 2, r.x + r.width]) targets.x.push({ value, source: r });
    for (const value of [r.y, r.y + r.height / 2, r.y + r.height]) targets.y.push({ value, source: r });
  }
  return targets;
}

/** Menor correção que leva algum dos `candidates` a um alvo, ou 0 se nenhum estiver perto. */
function bestOffset(candidates: readonly number[], targets: readonly Target[], threshold: number): number {
  let best = 0;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    for (const target of targets) {
      const distance = Math.abs(target.value - candidate);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = target.value - candidate;
      }
    }
  }
  return best;
}

const xLines = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
const yLines = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];

/** Guias para todas as linhas de `rect` que coincidem com algum alvo. */
function guidesFor(rect: Rect, targets: SnapTargets, xs: readonly number[], ys: readonly number[]): Guide[] {
  const guides: Guide[] = [];
  const epsilon = 0.01;
  for (const position of xs) {
    const matches = targets.x.filter((t) => Math.abs(t.value - position) < epsilon);
    if (!matches.length) continue;
    const tops = [rect.y, ...matches.map((t) => t.source.y)];
    const bottoms = [rect.y + rect.height, ...matches.map((t) => t.source.y + t.source.height)];
    guides.push({ axis: 'x', position, start: Math.min(...tops), end: Math.max(...bottoms) });
  }
  for (const position of ys) {
    const matches = targets.y.filter((t) => Math.abs(t.value - position) < epsilon);
    if (!matches.length) continue;
    const lefts = [rect.x, ...matches.map((t) => t.source.x)];
    const rights = [rect.x + rect.width, ...matches.map((t) => t.source.x + t.source.width)];
    guides.push({ axis: 'y', position, start: Math.min(...lefts), end: Math.max(...rights) });
  }
  return guides;
}

/** Encaixe ao mover: ajusta a posição de `rect` e devolve as guias. */
export function snapMove(
  rect: Rect,
  targets: SnapTargets,
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const dx = bestOffset(xLines(rect), targets.x, threshold);
  const dy = bestOffset(yLines(rect), targets.y, threshold);
  const snapped = { ...rect, x: rect.x + dx, y: rect.y + dy };
  return { dx, dy, guides: guidesFor(snapped, targets, xLines(snapped), yLines(snapped)) };
}

/**
 * Encaixe ao redimensionar: só as bordas que a alça move podem grudar.
 * Devolve a correção a aplicar ao arraste (dx, dy).
 */
export function snapResizeEdges(
  rect: Rect,
  edges: { left: boolean; right: boolean; top: boolean; bottom: boolean },
  targets: SnapTargets,
  threshold: number,
): { dx: number; dy: number } {
  const xs = [...(edges.left ? [rect.x] : []), ...(edges.right ? [rect.x + rect.width] : [])];
  const ys = [...(edges.top ? [rect.y] : []), ...(edges.bottom ? [rect.y + rect.height] : [])];
  return { dx: bestOffset(xs, targets.x, threshold), dy: bestOffset(ys, targets.y, threshold) };
}

/** Guias das bordas móveis de um redimensionamento já encaixado. */
export function resizeGuides(
  rect: Rect,
  edges: { left: boolean; right: boolean; top: boolean; bottom: boolean },
  targets: SnapTargets,
): Guide[] {
  const xs = [...(edges.left ? [rect.x] : []), ...(edges.right ? [rect.x + rect.width] : [])];
  const ys = [...(edges.top ? [rect.y] : []), ...(edges.bottom ? [rect.y + rect.height] : [])];
  return guidesFor(rect, targets, xs, ys);
}
