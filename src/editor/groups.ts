import { t } from '../i18n';
import type { DesignDocument } from './document';
import { selectedElements, type Editor } from './editor';
import type { DesignElement } from './elements';

/*
 * Regras de seleção com grupos (como no Figma):
 *  - clicar num membro seleciona o grupo inteiro;
 *  - duplo clique "entra" no grupo e seleciona só o membro;
 *  - estando dentro (parte do grupo selecionada), cliques em outros membros
 *    do mesmo grupo selecionam só o membro clicado;
 *  - Esc volta do membro para o grupo.
 */

/**
 * Nome exibido do grupo: o dado pelo usuário ou, sem ele, "Grupo · <texto>"
 * com o primeiro texto do grupo (ajuda a distinguir botões).
 */
export function groupDisplayName(doc: DesignDocument, groupId: string): string {
  const custom = doc.groupName(groupId);
  if (custom) return custom;
  const text = [...doc.groupMembers(groupId)].reverse().find((el) => el.type === 'text' && el.text.trim());
  if (text?.type !== 'text') return t('editor.elements.group');
  const firstLine = text.text.trim().split('\n')[0];
  const short = firstLine.length > 28 ? `${firstLine.slice(0, 28)}…` : firstLine;
  return `${t('editor.elements.group')} · ${short}`;
}

/** Se a seleção é parte (não o todo) de um único grupo, devolve esse grupo. */
export function enteredGroup(editor: Editor): string | null {
  const selected = selectedElements(editor);
  const groupId = selected[0]?.groupId;
  if (!groupId || !selected.every((el) => el.groupId === groupId)) return null;
  return selected.length < editor.doc.groupMembers(groupId).length ? groupId : null;
}

/** Se a seleção é exatamente um grupo inteiro, devolve esse grupo. */
export function selectedGroup(editor: Editor): string | null {
  const selected = selectedElements(editor);
  const groupId = selected[0]?.groupId;
  if (!groupId || !selected.every((el) => el.groupId === groupId)) return null;
  return selected.length === editor.doc.groupMembers(groupId).length ? groupId : null;
}

/** Ids que um clique em `el` deve selecionar. */
export function clickTarget(editor: Editor, el: DesignElement): string[] {
  if (!el.groupId || enteredGroup(editor) === el.groupId) return [el.id];
  return editor.doc.groupMembers(el.groupId).map((member) => member.id);
}

/** Completa os ids com todos os membros dos grupos tocados (seleção por área). */
export function expandToGroups(editor: Editor, ids: Iterable<string>): string[] {
  const result = new Set<string>();
  for (const id of ids) {
    const el = editor.doc.getElement(id);
    if (!el) continue;
    if (el.groupId) editor.doc.groupMembers(el.groupId).forEach((member) => result.add(member.id));
    else result.add(id);
  }
  return [...result];
}

/** Grupos que têm algum membro selecionado. */
export function groupsInSelection(editor: Editor): string[] {
  return [...new Set(selectedElements(editor).flatMap((el) => (el.groupId ? [el.groupId] : [])))];
}

export function groupSelection(editor: Editor): void {
  const groupId = editor.doc.groupElements(editor.selection.ids);
  if (!groupId) return;
  editor.selection.set(editor.doc.groupMembers(groupId).map((el) => el.id));
  editor.commit();
}

export function ungroupSelection(editor: Editor): void {
  const groups = groupsInSelection(editor);
  if (!groups.length) return;
  editor.doc.ungroup(groups);
  editor.commit();
}
