import type { Viewport } from './viewport';

export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
}

/**
 * Navegação na área de trabalho:
 *  - roda do mouse: rola (Shift = horizontal)
 *  - Ctrl/⌘ + roda, ou pinça no touchpad: zoom no cursor
 *  - Espaço + arrastar, ou botão do meio: mover (pan)
 */
export function bindStageControls(stage: HTMLElement, viewport: Viewport): void {
  let spaceHeld = false;

  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.01);
        viewport.setZoom(viewport.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
      } else if (event.shiftKey && !event.deltaX) {
        viewport.panBy(-event.deltaY, 0);
      } else {
        viewport.panBy(-event.deltaX, -event.deltaY);
      }
    },
    { passive: false },
  );

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || isTyping(event.target)) return;
    event.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
      stage.classList.add('is-pan-ready');
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    spaceHeld = false;
    stage.classList.remove('is-pan-ready');
  });

  // Fase de captura: o pan tem prioridade sobre as alças e futuras ferramentas.
  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.button === 1 || (event.button === 0 && spaceHeld))) return;
      event.preventDefault();
      event.stopPropagation();
      stage.setPointerCapture(event.pointerId);
      stage.classList.add('is-panning');

      let lastX = event.clientX;
      let lastY = event.clientY;

      const onMove = (move: PointerEvent) => {
        viewport.panBy(move.clientX - lastX, move.clientY - lastY);
        lastX = move.clientX;
        lastY = move.clientY;
      };
      const onEnd = () => {
        stage.classList.remove('is-panning');
        stage.removeEventListener('pointermove', onMove);
        stage.removeEventListener('pointerup', onEnd);
        stage.removeEventListener('pointercancel', onEnd);
      };

      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerup', onEnd);
      stage.addEventListener('pointercancel', onEnd);
    },
    { capture: true },
  );
}
