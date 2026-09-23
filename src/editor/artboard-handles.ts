import { t } from '../i18n';
import { fitWithinLimits } from './document';
import type { Editor } from './editor';

type Edge = 'e' | 's' | 'se';
const EDGES: readonly Edge[] = ['e', 's', 'se'];

/**
 * Moldura HTML sobre a prancheta com alças para redimensionar arrastando.
 * A prancheta cresce a partir do canto superior esquerdo, por isso só há
 * alças na direita, embaixo e no canto inferior direito.
 * Shift (ou a trava de proporção) mantém a proporção. As alças somem
 * enquanto houver elementos selecionados.
 */
export function mountArtboardHandles(editor: Editor): () => void {
  const { stage, doc, viewport, prefs, selection } = editor;

  const frame = document.createElement('div');
  frame.className = 'artboard-frame';

  const badge = document.createElement('div');
  badge.className = 'size-badge';

  for (const edge of EDGES) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.dataset.edge = edge;
    handle.addEventListener('pointerdown', (event) => startResize(event, edge, handle));
    frame.append(handle);
  }
  frame.append(badge);
  stage.append(frame);

  function update(): void {
    const { x, y } = viewport.toScreen(0, 0);
    frame.style.transform = `translate(${x}px, ${y}px)`;
    frame.style.width = `${doc.width * viewport.zoom}px`;
    frame.style.height = `${doc.height * viewport.zoom}px`;
    frame.classList.toggle('has-selection', selection.size > 0);
    badge.textContent = t('editor.status.size', { width: doc.width, height: doc.height });
  }

  function startResize(event: PointerEvent, edge: Edge, handle: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    const start = { x: event.clientX, y: event.clientY, width: doc.width, height: doc.height };
    const ratio = start.width / start.height;
    frame.classList.add('is-resizing');

    const onMove = (move: PointerEvent) => {
      const dx = (move.clientX - start.x) / viewport.zoom;
      const dy = (move.clientY - start.y) / viewport.zoom;
      let width = edge === 's' ? start.width : start.width + dx;
      let height = edge === 'e' ? start.height : start.height + dy;

      if (prefs.lockAspect || move.shiftKey) {
        if (edge === 'e') height = width / ratio;
        else if (edge === 's') width = height * ratio;
        else if (Math.abs(dx / start.width) > Math.abs(dy / start.height)) height = width / ratio;
        else width = height * ratio;
        ({ width, height } = fitWithinLimits(width, height));
      }
      doc.resize(width, height);
    };

    const onEnd = () => {
      frame.classList.remove('is-resizing');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      editor.commit();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  selection.onChange(update);
  update();
  return update;
}
