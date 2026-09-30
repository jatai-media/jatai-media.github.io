import type { Editor } from './editor';
import { createImage, type DesignElement } from './elements';
import type { Point } from './geometry';
import { readImageFile } from './images';

/**
 * Insere arquivos de imagem centralizados em `at` (documento) ou no meio da
 * prancheta, reduzidos para caber em 80% dela.
 */
export async function insertImageFiles(editor: Editor, files: Iterable<File>, at?: Point): Promise<void> {
  const { doc } = editor;
  const center = at ?? { x: doc.width / 2, y: doc.height / 2 };
  const inserted: DesignElement[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const image = await readImageFile(file);
      const scale = Math.min(1, (doc.width * 0.8) / image.width, (doc.height * 0.8) / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const offset = inserted.length * 20;
      inserted.push(createImage(image.src, center.x - width / 2 + offset, center.y - height / 2 + offset, width, height));
    } catch (error) {
      console.warn(error);
    }
  }

  if (!inserted.length) return;
  doc.addElements(inserted);
  editor.selection.set(inserted.map((el) => el.id));
  editor.setTool('select');
  editor.commit();
}

/** Aceita imagens arrastadas do computador para a área de trabalho. */
export function bindImageDrop(editor: Editor): void {
  const { stage, viewport } = editor;

  stage.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });

  stage.addEventListener('drop', (event) => {
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    const at = viewport.toDocument(event.clientX - rect.left, event.clientY - rect.top);
    void insertImageFiles(editor, files, at);
  });
}
