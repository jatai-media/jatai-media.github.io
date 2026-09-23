import { t } from '../i18n';
import { openContextMenu, SEPARATOR, type MenuEntry } from '../shared/context-menu';
import { deleteSelection, duplicateSelection } from './actions';
import type { Editor } from './editor';
import { groupSelection, groupsInSelection, selectedGroup, ungroupSelection } from './groups';

/** Itens do menu de clique direito para a seleção atual. */
function selectionEntries(editor: Editor): MenuEntry[] {
  const group = selectedGroup(editor);
  const hasGroups = groupsInSelection(editor).length > 0;
  const entries: MenuEntry[] = [];

  if (group) {
    entries.push({ label: t('editor.menu.rename'), shortcut: 'F2', onSelect: () => editor.renameGroup(group) });
  }
  if (editor.selection.size > 1 && !group) {
    entries.push({ label: t('editor.menu.group'), shortcut: 'Ctrl+G', onSelect: () => groupSelection(editor) });
  }
  if (hasGroups) {
    entries.push({ label: t('editor.menu.ungroup'), shortcut: 'Ctrl+Shift+G', onSelect: () => ungroupSelection(editor) });
  }
  if (entries.length) entries.push(SEPARATOR);
  entries.push(
    { label: t('editor.menu.duplicate'), shortcut: 'Ctrl+D', onSelect: () => duplicateSelection(editor) },
    { label: t('editor.menu.delete'), shortcut: 'Del', danger: true, onSelect: () => deleteSelection(editor) },
  );
  return entries;
}

/** Abre o menu para o que está selecionado (chame depois de ajustar a seleção). */
export function openSelectionMenu(editor: Editor, x: number, y: number): void {
  if (!editor.selection.size) return;
  openContextMenu(x, y, selectionEntries(editor));
}
