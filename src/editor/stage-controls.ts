import type { Viewport } from './viewport';

/** Inputs que não recebem texto: não devem bloquear atalhos de teclado. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file']);

/** O foco está num campo onde as teclas são digitação (e não atalhos)? */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return !!target.closest('textarea, select, [contenteditable="true"]');
}

/** Zoom por px de rolagem (exponencial, para ser igual em qualquer nível de zoom). */
const ZOOM_SENSITIVITY = 0.0015;
/** Maior rolagem (px) considerada num único evento de zoom. */
const MAX_ZOOM_DELTA = 120;
const LINE_HEIGHT = 16;

/** Converte o delta da roda para px (alguns navegadores informam em linhas ou páginas). */
function wheelPixels(event: WheelEvent, delta: number, pageSize: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_HEIGHT;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageSize;
  return delta;
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
      const dx = wheelPixels(event, event.deltaX, rect.width);
      const dy = wheelPixels(event, event.deltaY, rect.height);

      if (event.ctrlKey || event.metaKey) {
        // Um clique da roda (~100 px) ≈ 15% de zoom; pinça no touchpad manda
        // deltas pequenos e fica fluida. O limite evita saltos em rolagens rápidas.
        const delta = Math.max(-MAX_ZOOM_DELTA, Math.min(MAX_ZOOM_DELTA, dy));
        const factor = Math.exp(-delta * ZOOM_SENSITIVITY);
        viewport.setZoom(viewport.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
      } else if (event.shiftKey && !dx) {
        viewport.panBy(-dy, 0);
      } else {
        viewport.panBy(-dx, -dy);
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
