import type { DesignElement, ElementPatch } from './elements';
import { measureText } from './text-layout';

/** Limites do tamanho do design, em pixels. */
export const SIZE_LIMITS = { min: 16, max: 8000 } as const;

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return SIZE_LIMITS.min;
  return Math.min(SIZE_LIMITS.max, Math.max(SIZE_LIMITS.min, Math.round(value)));
}

/** Escala w×h para caber nos limites mantendo a proporção. */
export function fitWithinLimits(width: number, height: number): { width: number; height: number } {
  const down = Math.min(1, SIZE_LIMITS.max / width, SIZE_LIMITS.max / height);
  const up = Math.max(1, SIZE_LIMITS.min / (width * down), SIZE_LIMITS.min / (height * down));
  return { width: width * down * up, height: height * down * up };
}

export interface DocSnapshot {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly elements: readonly DesignElement[];
}

export type ArrangeAction = 'front' | 'forward' | 'backward' | 'back';

const TEXT_LAYOUT_KEYS = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight'] as const;

/** Textos têm largura/altura derivadas do conteúdo. */
function withLayout(el: DesignElement): DesignElement {
  return el.type === 'text' ? { ...el, ...measureText(el) } : el;
}

type Listener = () => void;

/**
 * O design sendo editado: prancheta (tamanho e fundo) e elementos, do fundo
 * para a frente. Toda alteração passa pelos métodos, que avisam os ouvintes
 * e incrementam `version` (usado pelo histórico para saber se algo mudou).
 */
export class DesignDocument {
  private _width: number;
  private _height: number;
  private _background: string;
  private _elements: DesignElement[] = [];
  private _version = 0;
  private listeners = new Set<Listener>();

  constructor(width = 1080, height = 1080, background = '#ffffff') {
    this._width = clampSize(width);
    this._height = clampSize(height);
    this._background = background;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  get background(): string {
    return this._background;
  }

  get elements(): readonly DesignElement[] {
    return this._elements;
  }

  get version(): number {
    return this._version;
  }

  getElement(id: string): DesignElement | undefined {
    return this._elements.find((el) => el.id === id);
  }

  resize(width: number, height: number): void {
    const w = clampSize(width);
    const h = clampSize(height);
    if (w === this._width && h === this._height) return;
    this._width = w;
    this._height = h;
    this.emit();
  }

  setBackground(color: string): void {
    if (color === this._background) return;
    this._background = color;
    this.emit();
  }

  addElements(elements: readonly DesignElement[]): void {
    if (!elements.length) return;
    this._elements = [...this._elements, ...elements.map(withLayout)];
    this.emit();
  }

  updateElement(id: string, patch: ElementPatch): void {
    this.updateElements([[id, patch]]);
  }

  updateElements(patches: ReadonlyArray<readonly [string, ElementPatch]>): void {
    const byId = new Map(patches);
    let changed = false;
    this._elements = this._elements.map((el) => {
      const patch = byId.get(el.id);
      if (!patch) return el;
      changed = true;
      const next = { ...el, ...patch } as DesignElement;
      return next.type === 'text' && TEXT_LAYOUT_KEYS.some((key) => key in patch) ? withLayout(next) : next;
    });
    if (changed) this.emit();
  }

  removeElements(ids: Iterable<string>): void {
    const remove = new Set(ids);
    const next = this._elements.filter((el) => !remove.has(el.id));
    if (next.length === this._elements.length) return;
    this._elements = next;
    this.emit();
  }

  /** Muda a ordem de empilhamento dos elementos informados. */
  arrange(ids: Iterable<string>, action: ArrangeAction): void {
    const set = new Set(ids);
    const list = [...this._elements];
    const moving = list.filter((el) => set.has(el.id));
    const rest = list.filter((el) => !set.has(el.id));

    let next: DesignElement[];
    if (action === 'front') next = [...rest, ...moving];
    else if (action === 'back') next = [...moving, ...rest];
    else {
      next = list;
      const forward = action === 'forward';
      const order = forward ? [...next.keys()].reverse() : [...next.keys()];
      for (const i of order) {
        const j = forward ? i + 1 : i - 1;
        if (j < 0 || j >= next.length) continue;
        if (set.has(next[i].id) && !set.has(next[j].id)) [next[i], next[j]] = [next[j], next[i]];
      }
    }

    if (next.every((el, i) => el === this._elements[i])) return;
    this._elements = next;
    this.emit();
  }

  /**
   * Move os elementos para a posição `index` da lista formada pelos demais
   * (0 = fundo), mantendo a ordem relativa entre eles.
   */
  moveElements(ids: Iterable<string>, index: number): void {
    const set = new Set(ids);
    const moving = this._elements.filter((el) => set.has(el.id));
    const rest = this._elements.filter((el) => !set.has(el.id));
    const at = Math.max(0, Math.min(rest.length, index));
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    if (next.every((el, i) => el === this._elements[i])) return;
    this._elements = next;
    this.emit();
  }

  /** Recalcula o tamanho dos textos (ex.: quando uma fonte termina de carregar). */
  relayoutText(): void {
    if (!this._elements.some((el) => el.type === 'text')) return;
    this._elements = this._elements.map(withLayout);
    this.emit(false);
  }

  snapshot(): DocSnapshot {
    return {
      width: this._width,
      height: this._height,
      background: this._background,
      elements: this._elements,
    };
  }

  restore(snapshot: DocSnapshot): void {
    this._width = snapshot.width;
    this._height = snapshot.height;
    this._background = snapshot.background;
    this._elements = snapshot.elements.map(withLayout);
    this.emit();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(bumpVersion = true): void {
    if (bumpVersion) this._version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
