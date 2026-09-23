import { COPY_OFFSET, deleteSelection, insertCopies, orderedSelection } from './actions';
import type { Editor } from './editor';
import type { DesignElement } from './elements';
import { insertImageFiles } from './image-import';
import { isTyping } from './stage-controls';

/** Prefixo do texto copiado, para reconhecer elementos nossos ao colar. */
const MARKER = 'jatai-elements:';

function parseElements(text: string): DesignElement[] | null {
  try {
    const data: unknown = JSON.parse(text.slice(MARKER.length));
    if (!Array.isArray(data)) return null;
    const valid = data.every((el) => el && typeof el.id === 'string' && typeof el.type === 'string');
    return valid ? (data as DesignElement[]) : null;
  } catch {
    return null;
  }
}

/**
 * Ctrl+C / Ctrl+X / Ctrl+V pelos eventos nativos da área de transferência:
 * elementos viajam como texto (funciona entre abas) e imagens coladas de
 * fora viram elementos de imagem.
 */
export function bindClipboard(editor: Editor): void {
  // Cada colagem seguida desloca um pouco mais, para não empilhar no mesmo lugar.
  let pasteCount = 0;

  function copy(event: ClipboardEvent): boolean {
    if (isTyping(event.target) || !editor.selection.size || !event.clipboardData) return false;
    event.preventDefault();
    event.clipboardData.setData('text/plain', MARKER + JSON.stringify(orderedSelection(editor)));
    pasteCount = 0;
    return true;
  }

  document.addEventListener('copy', copy);

  document.addEventListener('cut', (event) => {
    if (copy(event)) {
      deleteSelection(editor);
      pasteCount = -1;
    }
  });

  document.addEventListener('paste', (event) => {
    if (isTyping(event.target) || !event.clipboardData) return;

    const text = event.clipboardData.getData('text/plain');
    if (text.startsWith(MARKER)) {
      const elements = parseElements(text);
      if (!elements) return;
      event.preventDefault();
      pasteCount += 1;
      insertCopies(editor, elements, COPY_OFFSET * pasteCount);
      return;
    }

    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (images.length) {
      event.preventDefault();
      void insertImageFiles(editor, images);
    }
  });
}
