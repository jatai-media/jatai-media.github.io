import { drawElement } from './draw-element';
import { selectedElements, type Editor } from './editor';
import { handlePoint, handlesFor, unionBounds, type Rect } from './geometry';

const SELECTION_COLOR = '#ff9800';
/** Guias de alinhamento: cor diferente da seleção para não se confundirem. */
const GUIDE_COLOR = '#ff2d87';
/** Alças maiores quando o dispositivo principal é de toque. */
const COARSE_POINTER = window.matchMedia('(pointer: coarse)').matches;
const HANDLE_SIZE = COARSE_POINTER ? 12 : 8;
/** A partir deste zoom as imagens aparecem sem suavização (pixels visíveis). */
const PIXELATED_ZOOM = 4;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Desenha a área de trabalho no <canvas> que ocupa todo o stage:
 * prancheta, elementos (recortados à prancheta) e, por cima, os controles
 * de seleção em px de tela. Redesenhos são agrupados por quadro com request().
 */
export class StageRenderer {
  private frame = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private editor: Editor,
  ) {
    new ResizeObserver(() => this.request()).observe(canvas);
  }

  request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { doc, viewport, ui } = this.editor;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Coordenadas do documento.
    const { zoom, panX, panY } = viewport;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);

    // Prancheta com sombra (a sombra ignora o transform: valores em px físicos).
    ctx.save();
    ctx.shadowColor = cssVar('--artboard-shadow');
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = doc.background;
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
    // Com bastante zoom, mostra os pixels das imagens nítidos (bom para ajustes finos).
    ctx.imageSmoothingEnabled = zoom < PIXELATED_ZOOM;
    for (const el of doc.elements) {
      if (el.id === ui.editingId) continue;
      if (el.type === 'image' && ui.imagePreview?.id === el.id) {
        // Traço de borracha/restaurar em andamento.
        ctx.save();
        ctx.globalAlpha = el.opacity;
        ctx.drawImage(ui.imagePreview.canvas, el.x, el.y, el.width, el.height);
        ctx.restore();
      } else {
        drawElement(ctx, el);
      }
    }
    ctx.restore();

    // Controles em px de tela.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlays(ctx);
  }

  private drawOverlays(ctx: CanvasRenderingContext2D): void {
    const { doc, viewport, selection, ui } = this.editor;
    const toScreen = (r: Rect): Rect => {
      const p = viewport.toScreen(r.x, r.y);
      return { x: p.x, y: p.y, width: r.width * viewport.zoom, height: r.height * viewport.zoom };
    };
    const outline = (r: Rect, width: number) => {
      ctx.lineWidth = width;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    };

    ctx.strokeStyle = SELECTION_COLOR;

    if (ui.hoverIds.length && !ui.hoverIds.every((id) => selection.has(id))) {
      const hovered = ui.hoverIds.map((id) => doc.getElement(id)).filter((el) => el !== undefined);
      const bounds = unionBounds(hovered);
      if (bounds) outline(toScreen(bounds), 1.5);
    }

    const selected = selectedElements(this.editor);
    if (selected.length && !ui.editingId) {
      if (selected.length > 1) {
        ctx.globalAlpha = 0.5;
        selected.forEach((el) => outline(toScreen(el), 1));
        ctx.globalAlpha = 1;
      }
      const bounds = toScreen(unionBounds(selected)!);
      outline(bounds, 1.5);

      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      for (const handle of handlesFor(selected)) {
        const p = handlePoint(bounds, handle);
        const half = HANDLE_SIZE / 2;
        ctx.fillRect(p.x - half, p.y - half, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(p.x - half, p.y - half, HANDLE_SIZE, HANDLE_SIZE);
      }
    }

    if (ui.guides.length) {
      ctx.save();
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const guide of ui.guides) {
        // Meio pixel para a linha de 1 px ficar nítida.
        if (guide.axis === 'x') {
          const x = Math.round(viewport.toScreen(guide.position, 0).x) + 0.5;
          ctx.moveTo(x, viewport.toScreen(0, guide.start).y);
          ctx.lineTo(x, viewport.toScreen(0, guide.end).y);
        } else {
          const y = Math.round(viewport.toScreen(0, guide.position).y) + 0.5;
          ctx.moveTo(viewport.toScreen(guide.start, 0).x, y);
          ctx.lineTo(viewport.toScreen(guide.end, 0).x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    if (ui.brushCursor) {
      // Círculo da ponta: contorno duplo (claro e escuro) aparece em qualquer fundo.
      const center = viewport.toScreen(ui.brushCursor.x, ui.brushCursor.y);
      const radius = Math.max(1, ui.brushCursor.radius * viewport.zoom);
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000000aa';
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }

    if (ui.marquee) {
      const r = toScreen(ui.marquee);
      ctx.fillStyle = `${SELECTION_COLOR}22`;
      ctx.fillRect(r.x, r.y, r.width, r.height);
      outline(r, 1);
    }
  }
}

/** Distância (px de tela) em que uma alça ainda é "pegável". */
export const HANDLE_HIT_RADIUS = HANDLE_SIZE;
