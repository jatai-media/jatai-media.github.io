import { onLocaleChange, t } from '../i18n';
import type { Editor } from './editor';
import { ELEMENT_LABELS, elementIcon } from './element-meta';
import { openSelectionMenu } from './context-menus';
import type { DesignElement } from './elements';
import { groupDisplayName } from './groups';

/** Distância (px) que o ponteiro precisa andar para um clique virar arraste. */
const DRAG_THRESHOLD = 4;
/** Faixa (px) nas bordas do painel que faz a lista rolar durante o arraste. */
const AUTOSCROLL_EDGE = 32;
/** Recuo (px) das camadas dentro de um grupo. */
const CHILD_INDENT = 36;

const GROUP_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>';
const CHEVRON_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

/** Linha da lista: um grupo (com membros da frente para o fundo) ou um elemento. */
type Row =
  | { kind: 'group'; groupId: string; members: DesignElement[] }
  | { kind: 'element'; el: DesignElement; depth: 0 | 1 };

/** Resultado de soltar: inserir acima/abaixo de uma âncora, ou juntar num grupo novo. */
type Drop =
  | { kind: 'insert'; anchorId: string; position: 'above' | 'below'; groupId: string | null | undefined }
  | { kind: 'combine'; targetId: string };

function textName(el: DesignElement): string | null {
  if (el.type !== 'text' || !el.text.trim()) return null;
  const firstLine = el.text.trim().split('\n')[0];
  return firstLine.length > 28 ? `${firstLine.slice(0, 28)}…` : firstLine;
}

const layerName = (el: DesignElement) => textName(el) ?? t(ELEMENT_LABELS[el.type]);

/**
 * Lista de camadas em árvore (topo = frente). Grupos aparecem fechados e
 * abrem pela seta. Clique seleciona (no grupo, todos os membros; num filho,
 * só ele), Shift+clique soma, duplo clique edita texto ou renomeia o grupo,
 * clique direito abre o menu.
 *
 * Arrastar reordena. Soltar no meio de outra camada junta as duas num grupo;
 * no meio de um grupo, entra nele; entre filhos, entra naquela posição.
 */
export function mountLayersPanel(editor: Editor): { rename(groupId: string): void } {
  const { doc, selection } = editor;
  const list = document.querySelector<HTMLUListElement>('#layers-list')!;
  const empty = document.querySelector<HTMLElement>('#layers-empty')!;
  const scroller = list.closest<HTMLElement>('.panel')!;

  const indicator = document.createElement('div');
  indicator.className = 'layer-drop-indicator';

  /** Grupos abertos na lista (estado só da interface; começam fechados). */
  const expanded = new Set<string>();
  /** Evita que o clique disparado ao soltar um arraste mude a seleção. */
  let suppressClick = false;
  /** Grupo sendo renomeado e o texto digitado (sobrevive a re-renderizações). */
  let renaming: { groupId: string; draft: string } | null = null;

  function rename(groupId: string): void {
    if (!doc.groupMembers(groupId).length) return;
    renaming = { groupId, draft: doc.groupName(groupId) ?? groupDisplayName(doc, groupId) };
    render();
  }

  function finishRename(save: boolean): void {
    if (!renaming) return;
    const { groupId, draft } = renaming;
    renaming = null;
    if (save) {
      // Nome igual ao automático não é gravado (continua acompanhando o texto).
      const automatic = doc.groupName(groupId) ? null : groupDisplayName(doc, groupId);
      if (draft.trim() !== automatic) {
        doc.renameGroup(groupId, draft);
        editor.commit();
      }
    }
    render();
  }

  function renameInput(groupId: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename';
    input.value = renaming!.draft;
    input.setAttribute('aria-label', t('editor.menu.rename'));
    input.addEventListener('input', () => {
      if (renaming?.groupId === groupId) renaming.draft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finishRename(true);
      else if (event.key === 'Escape') finishRename(false);
      event.stopPropagation();
    });
    // Ignora o blur de quando o campo sai da tela numa re-renderização.
    input.addEventListener('blur', () => {
      if (input.isConnected) finishRename(true);
    });
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  function openMenu(event: MouseEvent, ids: readonly string[]): void {
    event.preventDefault();
    if (!ids.every((id) => selection.has(id))) selection.set(ids);
    openSelectionMenu(editor, event.clientX, event.clientY);
  }

  function buildRows(): Row[] {
    const rows: Row[] = [];
    const elements = [...doc.elements].reverse();
    for (let i = 0; i < elements.length; ) {
      const el = elements[i];
      if (!el.groupId) {
        rows.push({ kind: 'element', el, depth: 0 });
        i += 1;
        continue;
      }
      const members: DesignElement[] = [];
      while (i < elements.length && elements[i].groupId === el.groupId) members.push(elements[i++]);
      rows.push({ kind: 'group', groupId: el.groupId, members });
      if (expanded.has(el.groupId)) members.forEach((member) => rows.push({ kind: 'element', el: member, depth: 1 }));
    }
    return rows;
  }

  function render(): void {
    // Seleção de um filho abre o grupo dele, para aparecer na lista.
    for (const id of selection.ids) {
      const el = doc.getElement(id);
      if (el?.groupId && doc.groupMembers(el.groupId).some((member) => !selection.has(member.id))) {
        expanded.add(el.groupId);
      }
    }

    empty.hidden = doc.elements.length > 0;
    list.replaceChildren(...buildRows().map(renderRow));
  }

  function renderRow(row: Row): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'layer-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer';

    if (row.kind === 'group') {
      const ids = row.members.map((el) => el.id);
      item.dataset.group = row.groupId;
      item.dataset.kind = 'group';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'layer-toggle';
      toggle.innerHTML = CHEVRON_ICON;
      toggle.title = t('editor.layers.toggle');
      toggle.setAttribute('aria-label', toggle.title);
      toggle.setAttribute('aria-expanded', String(expanded.has(row.groupId)));
      toggle.addEventListener('click', () => {
        if (expanded.has(row.groupId)) expanded.delete(row.groupId);
        else expanded.add(row.groupId);
        render();
      });

      if (renaming?.groupId === row.groupId) {
        const field = document.createElement('div');
        field.className = 'layer is-renaming';
        field.innerHTML = GROUP_ICON;
        field.append(renameInput(row.groupId));
        item.append(toggle, field);
        return item;
      }

      button.setAttribute('aria-pressed', String(ids.every((id) => selection.has(id))));
      button.innerHTML = GROUP_ICON;
      const name = document.createElement('span');
      name.textContent = groupDisplayName(doc, row.groupId);
      button.append(name);
      button.addEventListener('dblclick', () => rename(row.groupId));
      button.addEventListener('contextmenu', (event) => openMenu(event, ids));
      button.addEventListener('click', (event) => {
        if (suppressClick) return;
        if (!event.shiftKey) selection.set(ids);
        else if (ids.every((id) => selection.has(id))) selection.set(selection.ids.filter((id) => !ids.includes(id)));
        else selection.set([...selection.ids, ...ids]);
      });
      button.addEventListener('pointerdown', (event) => startDrag(event, row, button));
      item.append(toggle, button);
      return item;
    }

    const { el } = row;
    item.dataset.id = el.id;
    item.dataset.kind = 'element';
    item.dataset.depth = String(row.depth);
    if (el.groupId) item.dataset.group = el.groupId;
    if (row.depth) item.style.paddingLeft = `${CHILD_INDENT}px`;

    button.setAttribute('aria-pressed', String(selection.has(el.id)));
    button.innerHTML = elementIcon(el.type);
    const name = document.createElement('span');
    name.textContent = layerName(el);
    button.append(name);
    button.addEventListener('click', (event) => {
      if (suppressClick) return;
      if (event.shiftKey) selection.toggle(el.id);
      else selection.set([el.id]);
    });
    button.addEventListener('dblclick', () => {
      if (el.type === 'text') editor.editText(el.id);
    });
    button.addEventListener('contextmenu', (event) => openMenu(event, [el.id]));
    button.addEventListener('pointerdown', (event) => startDrag(event, row, button));
    item.append(button);
    return item;
  }

  // ---- Arrastar ---------------------------------------------------------------

  /**
   * O que vai junto ao arrastar a linha de um elemento. Num filho de grupo,
   * só os filhos selecionados daquele grupo (nunca o grupo inteiro, senão não
   * dá para reordenar dentro dele); fora de grupos, a seleção toda.
   */
  function draggedElements(el: DesignElement): string[] {
    if (!selection.has(el.id)) return [el.id];
    const selected = doc.elements.filter((item) => selection.has(item.id));
    if (!el.groupId) return selected.map((item) => item.id);
    const siblings = selected.filter((item) => item.groupId === el.groupId);
    return siblings.length < doc.groupMembers(el.groupId).length ? siblings.map((item) => item.id) : [el.id];
  }

  function startDrag(event: PointerEvent, row: Row, button: HTMLElement): void {
    if (event.button !== 0 || event.shiftKey) return;

    // Grupo arrasta como bloco (mantém seu grupo e não entra em outro).
    const draggedGroup = row.kind === 'group' ? row.groupId : null;
    const isBlock = draggedGroup !== null;
    const moving = row.kind === 'group' ? row.members.map((el) => el.id) : draggedElements(row.el);
    const movingSet = new Set(moving);
    const startY = event.clientY;
    let dragging = false;
    let drop: Drop | null = null;
    let highlighted: HTMLElement | null = null;

    const isDragged = (li: HTMLLIElement) =>
      li.dataset.kind === 'group'
        ? li.dataset.group === draggedGroup
        : movingSet.has(li.dataset.id!);

    const candidates = () => [...list.querySelectorAll<HTMLLIElement>(':scope > li')].filter((li) => !isDragged(li));

    const members = (groupId: string) => doc.groupMembers(groupId);
    const frontmost = (groupId: string) => members(groupId).at(-1)!.id;
    const backmost = (groupId: string) => members(groupId)[0].id;
    /** Última linha visível do grupo (o próprio grupo, se fechado). */
    const groupLastLi = (groupId: string, fallback: HTMLLIElement) =>
      candidates()
        .filter((li) => li.dataset.group === groupId)
        .at(-1) ?? fallback;

    const showLine = (y: number, indent: number) => {
      const listTop = list.getBoundingClientRect().top;
      indicator.style.transform = `translateY(${y - listTop - 1}px)`;
      indicator.style.left = `${indent}px`;
      if (!indicator.isConnected) list.append(indicator);
    };

    const highlight = (li: HTMLElement | null) => {
      highlighted?.classList.remove('is-drop-target');
      highlighted = li;
      li?.classList.add('is-drop-target');
      if (li) indicator.remove();
    };

    /** Decide o destino conforme a linha e a altura do ponteiro nela. */
    const computeDrop = (clientY: number): void => {
      const rows = candidates();
      // Camadas que ficam paradas e podem servir de referência.
      const staying = doc.elements.filter((el) => !movingSet.has(el.id));
      highlight(null);
      if (!rows.length || !staying.length) {
        drop = null;
        indicator.remove();
        return;
      }

      const li = rows.find((r) => {
        const rect = r.getBoundingClientRect();
        return clientY >= rect.top && clientY < rect.bottom;
      });

      // Fora das linhas: acima da primeira ou abaixo da última (sempre fora de grupos).
      if (!li) {
        const first = rows[0].getBoundingClientRect();
        if (clientY < first.top) {
          drop = { kind: 'insert', anchorId: staying.at(-1)!.id, position: 'above', groupId: isBlock ? undefined : null };
          showLine(first.top, 0);
        } else {
          drop = { kind: 'insert', anchorId: staying[0].id, position: 'below', groupId: isBlock ? undefined : null };
          showLine(rows.at(-1)!.getBoundingClientRect().bottom, 0);
        }
        return;
      }

      const rect = li.getBoundingClientRect();
      const frac = (clientY - rect.top) / rect.height;
      const keep = isBlock ? undefined : null;

      if (li.dataset.kind === 'group') {
        const groupId = li.dataset.group!;
        const open = expanded.has(groupId);
        if (frac < 0.3) {
          drop = { kind: 'insert', anchorId: frontmost(groupId), position: 'above', groupId: keep };
          showLine(rect.top, 0);
        } else if (!isBlock && (open || frac < 0.7)) {
          // Entra no grupo, como o filho mais à frente.
          drop = { kind: 'insert', anchorId: frontmost(groupId), position: 'above', groupId };
          highlight(li);
        } else {
          drop = { kind: 'insert', anchorId: backmost(groupId), position: 'below', groupId: keep };
          showLine(groupLastLi(groupId, li).getBoundingClientRect().bottom, 0);
        }
        return;
      }

      const id = li.dataset.id!;
      const groupId = li.dataset.group;
      if (groupId) {
        // Filho de grupo: elementos entram no grupo nessa posição; blocos ficam fora.
        if (isBlock) {
          drop = { kind: 'insert', anchorId: backmost(groupId), position: 'below', groupId: undefined };
          showLine(groupLastLi(groupId, li).getBoundingClientRect().bottom, 0);
        } else if (frac < 0.5) {
          drop = { kind: 'insert', anchorId: id, position: 'above', groupId };
          showLine(rect.top, CHILD_INDENT);
        } else {
          drop = { kind: 'insert', anchorId: id, position: 'below', groupId };
          showLine(rect.bottom, CHILD_INDENT);
        }
        return;
      }

      // Elemento solto: bordas inserem; o meio junta num grupo novo.
      if (frac < 0.25 || (isBlock && frac < 0.5)) {
        drop = { kind: 'insert', anchorId: id, position: 'above', groupId: keep };
        showLine(rect.top, 0);
      } else if (frac > 0.75 || isBlock) {
        drop = { kind: 'insert', anchorId: id, position: 'below', groupId: keep };
        showLine(rect.bottom, 0);
      } else {
        drop = { kind: 'combine', targetId: id };
        highlight(li);
      }
    };

    const autoscroll = (clientY: number) => {
      const box = scroller.getBoundingClientRect();
      if (clientY < box.top + AUTOSCROLL_EDGE) scroller.scrollTop -= 8;
      else if (clientY > box.bottom - AUTOSCROLL_EDGE) scroller.scrollTop += 8;
    };

    const begin = () => {
      dragging = true;
      list.classList.add('is-dragging');
      list.querySelectorAll<HTMLLIElement>(':scope > li').forEach((li) => {
        li.classList.toggle('is-dragged', isDragged(li));
      });
    };

    const onMove = (move: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return;
        begin();
      }
      computeDrop(move.clientY);
      autoscroll(move.clientY);
    };

    const apply = (target: Drop) => {
      if (target.kind === 'combine') {
        // Juntar cria um grupo novo: seleciona o grupo inteiro.
        const groupId = doc.combineWith(moving, target.targetId);
        if (groupId) {
          expanded.add(groupId);
          selection.set(doc.groupMembers(groupId).map((el) => el.id));
        }
      } else {
        doc.moveElements(moving, target.anchorId, target.position, target.groupId);
        if (target.groupId) expanded.add(target.groupId);
        selection.set(moving);
      }
      editor.commit();
    };

    const onEnd = (end: PointerEvent) => {
      button.removeEventListener('pointermove', onMove);
      button.removeEventListener('pointerup', onEnd);
      button.removeEventListener('pointercancel', onEnd);
      if (!dragging) return;

      list.classList.remove('is-dragging');
      indicator.remove();
      highlight(null);
      suppressClick = true;
      setTimeout(() => (suppressClick = false));

      if (end.type === 'pointerup' && drop) apply(drop);
      render();
    };

    button.setPointerCapture(event.pointerId);
    button.addEventListener('pointermove', onMove);
    button.addEventListener('pointerup', onEnd);
    button.addEventListener('pointercancel', onEnd);
  }

  doc.onChange(render);
  selection.onChange(render);
  onLocaleChange(render);
  render();
  return { rename };
}
