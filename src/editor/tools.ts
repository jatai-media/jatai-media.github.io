import type { TranslationKey } from '../i18n';

export type ToolId = 'select' | 'text' | 'rectangle' | 'ellipse' | 'line' | 'image' | 'draw';

export interface ToolDefinition {
  id: ToolId;
  /** Chave de tradução do nome (usada no botão, tooltip e barra de status). */
  labelKey: TranslationKey;
  /** Atalho de teclado (tecla única, minúscula). */
  shortcut: string;
  /** Conteúdo interno de um <svg viewBox="0 0 24 24">. */
  icon: string;
}

export const TOOLS: readonly ToolDefinition[] = [
  { id: 'select', labelKey: 'editor.tools.select', shortcut: 'v', icon: '<path d="M4 3l7 17 2.5-7.5L21 10z"/>' },
  { id: 'text', labelKey: 'editor.tools.text', shortcut: 't', icon: '<path d="M5 5h14M12 5v14M9 19h6"/>' },
  { id: 'rectangle', labelKey: 'editor.tools.rectangle', shortcut: 'r', icon: '<rect x="4" y="5" width="16" height="14" rx="2"/>' },
  { id: 'ellipse', labelKey: 'editor.tools.ellipse', shortcut: 'o', icon: '<ellipse cx="12" cy="12" rx="8" ry="7"/>' },
  { id: 'line', labelKey: 'editor.tools.line', shortcut: 'l', icon: '<path d="M5 19L19 5"/>' },
  { id: 'image', labelKey: 'editor.tools.image', shortcut: 'i', icon: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4-4-9 9"/>' },
  { id: 'draw', labelKey: 'editor.tools.draw', shortcut: 'p', icon: '<path d="M3 21c3-1 5-3 6-6l9-9a2 2 0 0 0-3-3l-9 9c-3 1-5 3-6 6z"/>' },
];
