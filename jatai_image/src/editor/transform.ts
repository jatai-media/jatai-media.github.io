import type { DesignDocument } from './document';
import type { DesignElement, ElementPatch } from './elements';
import { mapRect, type Rect } from './geometry';

/** Como um elemento muda quando o retângulo `from` que o contém vira `to`. */
export function scaledPatch(el: DesignElement, from: Rect, to: Rect): ElementPatch {
  const r = mapRect(el, from, to);
  if (el.type === 'text') {
    // Texto escala pelo tamanho da fonte (a caixa é recalculada pelo documento).
    const scale = from.height ? to.height / from.height : 1;
    return { x: r.x, y: r.y, fontSize: Math.max(1, el.fontSize * scale) };
  }
  return { x: r.x, y: r.y, width: Math.max(0, r.width), height: Math.max(0, r.height) };
}

/** Escala os elementos (a partir dos estados originais) do retângulo `from` para `to`. */
export function scaleElements(
  doc: DesignDocument,
  originals: readonly DesignElement[],
  from: Rect,
  to: Rect,
): void {
  doc.updateElements(originals.map((el) => [el.id, scaledPatch(el, from, to)] as const));
}
