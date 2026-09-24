import type { DesignDocument } from './document';
import type { DesignElement } from './elements';
import type { Rect } from './geometry';
import type { UndoHistory } from './history';
import type { EditorPrefs } from './prefs';
import type { SelectionModel } from './selection';
import type { Guide } from './snapping';
import type { ToolId } from './tools';
import type { Viewport } from './viewport';

export type ImageToolMode = 'wand' | 'erase' | 'restore';

export interface ImageTool {
  id: string;
  mode: ImageToolMode;
}

/** Estado passageiro da interface, desenhado por cima do design. */
export interface UiState {
  /** Elementos sob o ponteiro (o grupo inteiro, se for o caso). */
  hoverIds: string[];
  /** Retângulo da seleção por área (documento). */
  marquee: Rect | null;
  /** Texto sendo editado (não é desenhado no canvas enquanto isso). */
  editingId: string | null;
  /** Guias de alinhamento visíveis durante um arraste. */
  guides: Guide[];
  /** Ferramenta de imagem ativa (varinha, borracha, restaurar) e a imagem em que atua. */
  imageTool: ImageTool | null;
  /** Prévia ao vivo de um traço de pincel (desenhada no lugar da imagem enquanto se arrasta). */
  imagePreview: { id: string; canvas: HTMLCanvasElement } | null;
  /** Círculo da ponta do pincel, em coordenadas do documento. */
  brushCursor: { x: number; y: number; radius: number } | null;
  /** Camada de desenho que recebe os próximos traços (com "juntar traços" ligado). */
  drawingId: string | null;
  /** Conta-gotas no canvas (navegadores sem EyeDropper): recebe a cor do próximo clique. */
  colorPick: ((color: string) => void) | null;
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
  onToolChange(listener: () => void): () => void;
  requestRender(): void;
  /** Fecha um passo de desfazer (chame ao terminar cada operação). */
  commit(): void;
  editText(id: string): void;
  /** Abre a edição do nome do grupo na lista de camadas. */
  renameGroup(groupId: string): void;
  /** Liga uma ferramenta de imagem (ou desliga, com null). */
  setImageTool(tool: ImageTool | null): void;
  onImageToolChange(listener: () => void): () => void;
  fitView(): void;
}

export function selectedElements(editor: Editor): DesignElement[] {
  return editor.selection.ids
    .map((id) => editor.doc.getElement(id))
    .filter((el): el is DesignElement => el !== undefined);
}
