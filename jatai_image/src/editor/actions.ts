import type { ArrangeAction } from './document';
import { selectedElements, type Editor } from './editor';
import { cloneElement, newId, withGroup, type DesignElement } from './elements';

/** Deslocamento de cópias duplicadas/coladas, em px do documento. */
export const COPY_OFFSET = 20;

export function deleteSelection(editor: Editor): void {
  if (!editor.selection.size) return;
  editor.doc.removeElements(editor.selection.ids);
  editor.selection.clear();
  editor.commit();
}

/**
 * Adiciona cópias dos elementos e seleciona as cópias. Grupos copiados viram
 * grupos novos (as cópias não entram no grupo original).
 */
export function insertCopies(editor: Editor, elements: readonly DesignElement[], offset: number): void {
  if (!elements.length) return;
  const newGroups = new Map<string, string>();
  const copies = elements.map((el) => {
    const copy = cloneElement(el, offset, offset);
    if (!el.groupId) return copy;
    if (!newGroups.has(el.groupId)) newGroups.set(el.groupId, newId());
    return withGroup(copy, newGroups.get(el.groupId)!);
  });
  editor.doc.addElements(copies);
  // Cópias de grupos levam nome e cadeado junto.
  for (const [original, copy] of newGroups) editor.doc.setGroupMeta(copy, editor.doc.groupMeta(original));
  editor.selection.set(copies.map((el) => el.id));
  editor.commit();
}

export function duplicateSelection(editor: Editor): void {
  insertCopies(editor, orderedSelection(editor), COPY_OFFSET);
}

export function arrangeSelection(editor: Editor, action: ArrangeAction): void {
  editor.doc.arrange(editor.selection.ids, action);
  editor.commit();
}

export function nudgeSelection(editor: Editor, dx: number, dy: number): void {
  const selected = selectedElements(editor);
  if (!selected.length) return;
  editor.doc.updateElements(selected.map((el) => [el.id, { x: el.x + dx, y: el.y + dy }] as const));
  editor.commit();
}

export function selectAll(editor: Editor): void {
  editor.selection.set(editor.doc.elements.map((el) => el.id));
}

/** Selecionados na ordem de empilhamento (para cópias manterem a ordem). */
export function orderedSelection(editor: Editor): DesignElement[] {
  return editor.doc.elements.filter((el) => editor.selection.has(el.id));
}
