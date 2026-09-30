import { newId, withGroup, type DesignElement, type ElementPatch } from './elements';
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
  readonly groups: ReadonlyMap<string, GroupMeta>;
}

/** Dados do grupo que não pertencem a nenhum membro (sobrevivem à troca dos elementos). */
export interface GroupMeta {
  readonly name?: string;
  /** Mantém a proporção ao redimensionar o grupo inteiro. */
  readonly lockRatio?: boolean;
}

export type ArrangeAction = 'front' | 'forward' | 'backward' | 'back';

const TEXT_LAYOUT_KEYS = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight'] as const;

/** Textos têm largura/altura derivadas do conteúdo. */
function withLayout(el: DesignElement): DesignElement {
  return el.type === 'text' ? { ...el, ...measureText(el) } : el;
}

/**
 * Garante a regra dos grupos: seus membros ficam juntos na ordem das camadas,
 * reunidos na posição do membro mais à frente. Um grupo existe enquanto tiver
 * ao menos um membro (assim o nome sobrevive à troca dos elementos).
 */
function normalizeGroups(list: readonly DesignElement[]): DesignElement[] {
  const frontmost = new Map<string, number>();
  const members = new Map<string, DesignElement[]>();
  list.forEach((el, i) => {
    if (!el.groupId) return;
    frontmost.set(el.groupId, i);
    members.set(el.groupId, [...(members.get(el.groupId) ?? []), el]);
  });

  const out: DesignElement[] = [];
  list.forEach((el, i) => {
    if (!el.groupId) out.push(el);
    else if (frontmost.get(el.groupId) === i) out.push(...members.get(el.groupId)!);
  });
  return out;
}

/** Aplica uma ação de ordem a uma lista de unidades (elementos ou blocos de grupo). */
function arrangeUnits<T>(units: readonly T[], isSelected: (unit: T) => boolean, action: ArrangeAction): T[] {
  const moving = units.filter(isSelected);
  const rest = units.filter((unit) => !isSelected(unit));
  if (action === 'front') return [...rest, ...moving];
  if (action === 'back') return [...moving, ...rest];

  const next = [...units];
  const forward = action === 'forward';
  const order = forward ? [...next.keys()].reverse() : [...next.keys()];
  for (const i of order) {
    const j = forward ? i + 1 : i - 1;
    if (j < 0 || j >= next.length) continue;
    if (isSelected(next[i]) && !isSelected(next[j])) [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
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
  /** Dados dos grupos (por id do grupo). */
  private _groups: ReadonlyMap<string, GroupMeta> = new Map();
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

  groupMeta(groupId: string): GroupMeta {
    return this._groups.get(groupId) ?? {};
  }

  /** Nome dado ao grupo pelo usuário, se houver. */
  groupName(groupId: string): string | undefined {
    return this.groupMeta(groupId).name;
  }

  /** Renomeia o grupo; nome vazio ou null volta ao nome automático. */
  renameGroup(groupId: string, name: string | null): void {
    this.setGroupMeta(groupId, { name: name?.trim() || undefined });
  }

  /** Altera dados do grupo (campos undefined são removidos). */
  setGroupMeta(groupId: string, patch: GroupMeta): void {
    const current = this.groupMeta(groupId);
    const merged: Record<string, unknown> = { ...current, ...patch };
    for (const key of Object.keys(merged)) if (merged[key] === undefined || merged[key] === false) delete merged[key];
    const next = merged as GroupMeta;
    if (next.name === current.name && next.lockRatio === current.lockRatio) return;
    const groups = new Map(this._groups);
    if (Object.keys(next).length) groups.set(groupId, next);
    else groups.delete(groupId);
    this._groups = groups;
    this.emit();
  }

  /** Membros do grupo, do fundo para a frente. */
  groupMembers(groupId: string): DesignElement[] {
    return this._elements.filter((el) => el.groupId === groupId);
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
    this.setElements([...this._elements, ...elements.map(withLayout)]);
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
    this.setElements(this._elements.filter((el) => !remove.has(el.id)));
  }

  /**
   * Muda a ordem de empilhamento. Se a seleção é parte de um único grupo,
   * reordena dentro dele; senão grupos se movem como um bloco.
   */
  arrange(ids: Iterable<string>, action: ArrangeAction): void {
    const set = new Set(ids);
    const list = this._elements;
    const selected = list.filter((el) => set.has(el.id));
    if (!selected.length) return;

    const groupId = selected[0].groupId;
    const insideGroup =
      groupId !== undefined &&
      selected.every((el) => el.groupId === groupId) &&
      selected.length < this.groupMembers(groupId).length;

    if (insideGroup) {
      const start = list.findIndex((el) => el.groupId === groupId);
      const end = start + this.groupMembers(groupId).length;
      const inner = arrangeUnits(list.slice(start, end), (el) => set.has(el.id), action);
      this.setElements([...list.slice(0, start), ...inner, ...list.slice(end)]);
      return;
    }

    // Unidades: cada grupo (contíguo) vira um bloco; demais elementos, sozinhos.
    const units: DesignElement[][] = [];
    for (const el of list) {
      const last = units.at(-1);
      if (el.groupId && last?.[0].groupId === el.groupId) last.push(el);
      else units.push([el]);
    }
    const arranged = arrangeUnits(units, (unit) => unit.some((el) => set.has(el.id)), action);
    this.setElements(arranged.flat());
  }

  /** Agrupa os elementos (na posição do mais à frente). Devolve o id do grupo. */
  groupElements(ids: Iterable<string>): string | null {
    const set = new Set(ids);
    if (set.size < 2) return null;
    const groupId = newId();
    this.setElements(this._elements.map((el) => (set.has(el.id) ? withGroup(el, groupId) : el)));
    return groupId;
  }

  /** Desfaz os grupos informados (os elementos continuam onde estão). */
  ungroup(groupIds: Iterable<string>): void {
    const set = new Set(groupIds);
    this.setElements(this._elements.map((el) => (el.groupId && set.has(el.groupId) ? withGroup(el, null) : el)));
  }

  /** Junta os elementos com `targetId` num grupo novo, logo acima do alvo. Devolve o grupo. */
  combineWith(ids: Iterable<string>, targetId: string): string | null {
    const set = new Set(ids);
    if (!set.size || set.has(targetId)) return null;
    const groupId = newId();
    const moving = this._elements.filter((el) => set.has(el.id)).map((el) => withGroup(el, groupId));
    const rest = this._elements
      .filter((el) => !set.has(el.id))
      .map((el) => (el.id === targetId ? withGroup(el, groupId) : el));
    const anchor = rest.findIndex((el) => el.id === targetId);
    if (anchor < 0) return null;
    this.setElements([...rest.slice(0, anchor + 1), ...moving, ...rest.slice(anchor + 1)]);
    return groupId;
  }

  /**
   * Move os elementos para logo acima (à frente) ou abaixo de `anchorId`,
   * mantendo a ordem entre eles. `groupId`: grupo de destino, null para
   * tirar de grupos, undefined para manter o grupo atual.
   */
  moveElements(
    ids: Iterable<string>,
    anchorId: string,
    position: 'above' | 'below',
    groupId?: string | null,
  ): void {
    const set = new Set(ids);
    if (set.has(anchorId)) return;
    const moving = this._elements
      .filter((el) => set.has(el.id))
      .map((el) => (groupId === undefined ? el : withGroup(el, groupId)));
    const rest = this._elements.filter((el) => !set.has(el.id));
    const anchor = rest.findIndex((el) => el.id === anchorId);
    if (anchor < 0) return;
    const at = position === 'above' ? anchor + 1 : anchor;
    this.setElements([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
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
      groups: this._groups,
    };
  }

  restore(snapshot: DocSnapshot): void {
    this._width = snapshot.width;
    this._height = snapshot.height;
    this._background = snapshot.background;
    this._elements = snapshot.elements.map(withLayout);
    this._groups = snapshot.groups;
    this.emit();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Troca a lista (já aplicando as regras de grupo) e avisa, se algo mudou. */
  private setElements(list: readonly DesignElement[]): void {
    const next = normalizeGroups(list);
    if (next.length === this._elements.length && next.every((el, i) => el === this._elements[i])) return;
    this._elements = next;
    // Grupos que ficaram vazios levam seus dados junto.
    const alive = new Set(next.flatMap((el) => (el.groupId ? [el.groupId] : [])));
    if ([...this._groups.keys()].some((id) => !alive.has(id))) {
      this._groups = new Map([...this._groups].filter(([id]) => alive.has(id)));
    }
    this.emit();
  }

  private emit(bumpVersion = true): void {
    if (bumpVersion) this._version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
