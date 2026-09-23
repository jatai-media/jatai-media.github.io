import { DEFAULT_BG_REMOVAL, removeBackground, type BackgroundRemovalOptions, type WandPoint } from './background-removal';
import type { Editor } from './editor';
import type { ImageElement } from './elements';

/** Número do processamento mais recente por imagem (resultados antigos são descartados). */
const runs = new Map<string, number>();
/** Ajustes pedidos e ainda em processamento (cliques rápidos não se perdem). */
const pending = new Map<string, BackgroundRemovalOptions>();

function imageElement(editor: Editor, id: string): Readonly<ImageElement> | undefined {
  const el = editor.doc.getElement(id);
  return el?.type === 'image' ? el : undefined;
}

/** Ajustes atuais da remoção de fundo (incluindo os ainda em processamento). */
export function backgroundSettings(editor: Editor, id: string): BackgroundRemovalOptions {
  return pending.get(id) ?? { ...DEFAULT_BG_REMOVAL, ...imageElement(editor, id)?.bgRemoval };
}

/**
 * Reprocessa a imagem a partir do original com os ajustes alterados.
 * `commit` fecha um passo de desfazer ao terminar.
 */
export async function updateBackgroundRemoval(
  editor: Editor,
  id: string,
  patch: Partial<BackgroundRemovalOptions>,
  commit: boolean,
): Promise<void> {
  const el = imageElement(editor, id);
  if (!el) return;
  const settings = { ...backgroundSettings(editor, id), ...patch };
  const original = el.originalSrc ?? el.src;
  const run = (runs.get(id) ?? 0) + 1;
  runs.set(id, run);
  pending.set(id, settings);

  try {
    const src = await removeBackground(original, settings);
    if (runs.get(id) !== run || !imageElement(editor, id)) return;
    editor.doc.updateElement(id, { src, originalSrc: original, bgRemoval: settings });
    if (commit) editor.commit();
  } finally {
    if (runs.get(id) === run) pending.delete(id);
  }
}

/** Apaga, com a varinha, a região da imagem conectada ao ponto (0–1 na imagem). */
export function addWandPoint(editor: Editor, id: string, point: WandPoint): Promise<void> {
  const seeds = [...backgroundSettings(editor, id).seeds, point];
  return updateBackgroundRemoval(editor, id, { seeds }, true);
}

/** Volta à imagem original, sem nenhuma remoção. */
export function restoreOriginalImage(editor: Editor, id: string): void {
  const el = imageElement(editor, id);
  if (!el?.originalSrc) return;
  runs.set(id, (runs.get(id) ?? 0) + 1);
  pending.delete(id);
  editor.doc.updateElement(id, { src: el.originalSrc, originalSrc: undefined, bgRemoval: undefined });
  editor.commit();
}
