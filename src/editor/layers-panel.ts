import { onLocaleChange, t } from '../i18n';
import type { Editor } from './editor';
import { ELEMENT_LABELS, elementIcon } from './element-meta';
import type { DesignElement } from './elements';

/** Distância (px) que o ponteiro precisa andar para um clique virar arraste. */
const DRAG_THRESHOLD = 4;
/** Faixa (px) nas bordas do painel que faz a lista rolar durante o arraste. */
const AUTOSCROLL_EDGE = 32;

function layerName(el: DesignElement): string {
  if (el.type === 'text' && el.text.trim()) {
    const firstLine = el.text.trim().split('\n')[0];
    return firstLine.length > 28 ? `${firstLine.slice(0, 28)}…` : firstLine;
  }
  return t(ELEMENT_LABELS[el.type]);
}

/**
 * Lista de camadas (a de cima é a da frente).
 * Clique seleciona, Shift+clique soma, duplo clique edita texto e arrastar
 * reordena. Arrastar um item selecionado leva junto toda a seleção.
 */
export function mountLayersPanel(editor: Editor): void {
  const { doc, selection } = editor;
  const list = document.querySelector<HTMLUListElement>('#layers-list')!;
  const empty = document.querySelector<HTMLElement>('#layers-empty')!;
  const scroller = list.closest<HTMLElement>('.panel')!;

  const indicator = document.createElement('div');
  indicator.className = 'layer-drop-indicator';

  /** Evita que o clique disparado ao soltar um arraste mude a seleção. */
  let suppressClick = false;

  function render(): void {
    empty.hidden = doc.elements.length > 0;
    list.replaceChildren(
      ...[...doc.elements].reverse().map((el) => {
        const item = document.createElement('li');
        item.dataset.id = el.id;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer';
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
        button.addEventListener('pointerdown', (event) => startDrag(event, el.id, button));

        item.append(button);
        return item;
      }),
    );
  }

  function startDrag(event: PointerEvent, id: string, button: HTMLElement): void {
    if (event.button !== 0 || event.shiftKey) return;
    const startY = event.clientY;
    const moving = selection.has(id) ? doc.elements.filter((el) => selection.has(el.id)).map((el) => el.id) : [id];
    const movingSet = new Set(moving);
    let dragging = false;
    let insertAt = 0;

    /** Itens que não estão sendo arrastados, de cima para baixo. */
    const others = () =>
      [...list.querySelectorAll<HTMLLIElement>('li')].filter((li) => !movingSet.has(li.dataset.id!));

    const begin = () => {
      dragging = true;
      list.classList.add('is-dragging');
      list.querySelectorAll<HTMLLIElement>('li').forEach((li) => {
        li.classList.toggle('is-dragged', movingSet.has(li.dataset.id!));
      });
      list.append(indicator);
    };

    const update = (clientY: number) => {
      const rest = others();
      // Quantos itens restantes ficam acima do ponteiro = posição de inserção na tela.
      const above = rest.filter((li) => {
        const r = li.getBoundingClientRect();
        return r.top + r.height / 2 < clientY;
      }).length;
      // Na tela a ordem é invertida (topo = frente); no documento, 0 = fundo.
      insertAt = rest.length - above;

      const listTop = list.getBoundingClientRect().top;
      const y =
        above < rest.length
          ? rest[above].getBoundingClientRect().top
          : (rest.at(-1)?.getBoundingClientRect().bottom ?? listTop);
      indicator.style.transform = `translateY(${y - listTop - 1}px)`;

      const box = scroller.getBoundingClientRect();
      if (clientY < box.top + AUTOSCROLL_EDGE) scroller.scrollTop -= 8;
      else if (clientY > box.bottom - AUTOSCROLL_EDGE) scroller.scrollTop += 8;
    };

    const onMove = (move: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return;
        begin();
      }
      update(move.clientY);
    };

    const onEnd = (end: PointerEvent) => {
      button.removeEventListener('pointermove', onMove);
      button.removeEventListener('pointerup', onEnd);
      button.removeEventListener('pointercancel', onEnd);
      if (!dragging) return;

      list.classList.remove('is-dragging');
      indicator.remove();
      suppressClick = true;
      setTimeout(() => (suppressClick = false));

      if (end.type === 'pointerup') {
        doc.moveElements(moving, insertAt);
        selection.set(moving);
        editor.commit();
      }
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
}
