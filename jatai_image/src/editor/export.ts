import type { DesignDocument } from './document';
import { drawElement } from './draw-element';

function safeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  return cleaned || 'design';
}

/** Renderiza o design no tamanho real e baixa como PNG. */
export async function exportPng(doc: DesignDocument, name: string): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = doc.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const el of doc.elements) drawElement(ctx, el);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Falha ao gerar o PNG');

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(name)}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
