import type { DesignDocument } from './document';
import type { DesignElement } from './elements';
import type { Rect } from './geometry';
import type { UndoHistory } from './history';
import type { EditorPrefs } from './prefs';
import type { SelectionModel } from './selection';
import type { ToolId } from './tools';
import type { Viewport } from './viewport';

/** Estado passageiro da interface, desenhado por cima do design. */
export interface UiState {
  hoverId: string | null;
  /** Retângulo da seleção por área (documento). */
  marquee: Rect | null;
  /** Texto sendo editado (não é desenhado no canvas enquanto isso). */
  editingId: string | null;
}

/** Tudo o que os módulos do editor compartilham. Montado em main.ts. */
export interface Editor {
  readonly doc: DesignDocument;
  readonly viewport: Viewport;
  readonly selection: SelectionModel;
  readonly history: UndoHistory;
  readonly prefs: EditorPrefs;
  readonly ui: UiState;
  readonly stage: HTMLElement;
  readonly tool: ToolId;
  setTool(id: ToolId): void;
  requestRender(): void;
  /** Fecha um passo de desfazer (chame ao terminar cada operação). */
  commit(): void;
  editText(id: string): void;
  fitView(): void;
}

export function selectedElements(editor: Editor): DesignElement[] {
  return editor.selection.ids
    .map((id) => editor.doc.getElement(id))
    .filter((el): el is DesignElement => el !== undefined);
}
