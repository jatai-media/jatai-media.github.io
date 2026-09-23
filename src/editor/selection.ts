type Listener = () => void;

/** Ids dos elementos selecionados, na ordem em que foram selecionados. */
export class SelectionModel {
  private _ids: string[] = [];
  private listeners = new Set<Listener>();

  get ids(): readonly string[] {
    return this._ids;
  }

  get size(): number {
    return this._ids.length;
  }

  has(id: string): boolean {
    return this._ids.includes(id);
  }

  set(ids: Iterable<string>): void {
    const next = [...new Set(ids)];
    if (next.length === this._ids.length && next.every((id, i) => id === this._ids[i])) return;
    this._ids = next;
    this.emit();
  }

  toggle(id: string): void {
    this.set(this.has(id) ? this._ids.filter((item) => item !== id) : [...this._ids, id]);
  }

  clear(): void {
    this.set([]);
  }

  /** Mantém só os ids que ainda passam no teste (ex.: elementos que ainda existem). */
  retain(keep: (id: string) => boolean): void {
    this.set(this._ids.filter(keep));
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
