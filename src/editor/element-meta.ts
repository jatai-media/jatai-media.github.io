import type { TranslationKey } from '../i18n';
import type { ElementType } from './elements';
import { TOOLS, type ToolId } from './tools';

/** Nome traduzível de cada tipo de elemento (painel e camadas). */
export const ELEMENT_LABELS: Record<ElementType, TranslationKey> = {
  rectangle: 'editor.elements.rectangle',
  ellipse: 'editor.elements.ellipse',
  line: 'editor.elements.line',
  path: 'editor.elements.path',
  text: 'editor.elements.text',
  image: 'editor.elements.image',
};

const TOOL_FOR_TYPE: Record<ElementType, ToolId> = {
  rectangle: 'rectangle',
  ellipse: 'ellipse',
  line: 'line',
  path: 'draw',
  text: 'text',
  image: 'image',
};

/** Ícone de cada tipo (o mesmo da ferramenta que o cria), como <svg>. */
export function elementIcon(type: ElementType, size = 16): string {
  const icon = TOOLS.find((tool) => tool.id === TOOL_FOR_TYPE[type])!.icon;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
}
