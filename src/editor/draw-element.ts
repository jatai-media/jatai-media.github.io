import { absolutePoints, type DesignElement } from './elements';
import { getImage } from './images';
import { baselineOffset, fontString } from './text-layout';

/**
 * Desenha um elemento em coordenadas do documento. Usado tanto na tela
 * quanto na exportação, para o resultado ser idêntico.
 */
export function drawElement(ctx: CanvasRenderingContext2D, el: DesignElement): void {
  ctx.save();
  ctx.globalAlpha = el.opacity;

  switch (el.type) {
    case 'rectangle': {
      const radius = Math.max(0, Math.min(el.radius, el.width / 2, el.height / 2));
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, el.height, radius);
      fillAndStroke(ctx, el.fill, el.stroke, el.strokeWidth);
      break;
    }

    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
      fillAndStroke(ctx, el.fill, el.stroke, el.strokeWidth);
      break;

    case 'line':
    case 'path': {
      const points = absolutePoints(el);
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      // Um único ponto vira um pingo.
      if (points.length === 2) ctx.lineTo(points[0] + 0.01, points[1]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = el.strokeWidth;
      ctx.strokeStyle = el.stroke;
      ctx.stroke();
      break;
    }

    case 'text': {
      const lineHeight = el.fontSize * el.lineHeight;
      const baseline = baselineOffset(ctx, el);
      const x = el.align === 'left' ? el.x : el.align === 'center' ? el.x + el.width / 2 : el.x + el.width;
      ctx.font = fontString(el);
      ctx.fillStyle = el.color;
      ctx.textAlign = el.align;
      ctx.textBaseline = 'alphabetic';
      el.text.split('\n').forEach((line, i) => ctx.fillText(line, x, el.y + i * lineHeight + baseline));
      break;
    }

    case 'image': {
      const img = getImage(el.src);
      if (img) {
        ctx.drawImage(img, el.x, el.y, el.width, el.height);
      } else {
        ctx.fillStyle = '#8884';
        ctx.fillRect(el.x, el.y, el.width, el.height);
      }
      break;
    }
  }

  ctx.restore();
}

function fillAndStroke(ctx: CanvasRenderingContext2D, fill: string, stroke: string, strokeWidth: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  if (strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
