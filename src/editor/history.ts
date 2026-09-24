import type { DesignDocument, DocSnapshot } from './document';

const MAX_STEPS = 100;

type Listener = () => void;

/**
 * Desfazer/refazer por fotos do documento. Como os elementos são imutáveis,
 * cada foto é só uma cópia rasa da lista.
 *
 * Operações contínuas (arrastar, digitar) alteram o documento várias vezes e
 * chamam commit() uma vez no fim, virando um único passo.
 */
export class UndoHistory {
  private undoStack: DocSnapshot[] = [];
  private redoStack: DocSnapshot[] = [];
  private current: DocSnapshot;
  private version: number;
  private listeners = new Set<Listener>();

  constructor(private doc: DesignDocument) {
    this.current = doc.snapshot();
    this.version = doc.version;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 || this.doc.version !== this.version;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Fecha um passo se o documento mudou desde o último. */
  commit(): void {
    if (this.doc.version === this.version) return;
    this.undoStack.push(this.current);
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    this.redoStack = [];
    this.current = this.doc.snapshot();
    this.version = this.doc.version;
    this.emit();
  }

  /** Descarta alterações ainda não fechadas num passo (ex.: gesto cancelado no meio). */
  revert(): void {
    if (this.doc.version === this.version) return;
    this.doc.restore(this.current);
    this.version = this.doc.version;
    this.emit();
  }

  undo(): void {
    this.commit();
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.current);
    this.apply(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.current);
    this.apply(next);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(snapshot: DocSnapshot): void {
    this.current = snapshot;
    this.doc.restore(snapshot);
    this.version = this.doc.version;
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
