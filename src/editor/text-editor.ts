import type { Editor } from './editor';
import { fontCss } from './text-layout';

/** Menor fonte de campo que o iOS aceita sem dar zoom na página ao focar. */
const MIN_INPUT_FONT = 16;

/**
 * Edição de texto no lugar: um <textarea> transparente posicionado
 * exatamente sobre o elemento. Enquanto edita, o canvas não desenha esse
 * texto. Ao sair (clique fora, Esc ou Ctrl+Enter) vira um passo de desfazer;
 * texto vazio é removido.
 */
export function createTextEditor(editor: Editor): { open(id: string): void } {
  const { doc, viewport, selection, ui, stage } = editor;

  const textarea = document.createElement('textarea');
  textarea.className = 'text-editor';
  textarea.wrap = 'off';
  textarea.spellcheck = false;
  textarea.hidden = true;
  stage.append(textarea);

  function position(): void {
    const el = ui.editingId ? doc.getElement(ui.editingId) : undefined;
    if (!el || el.type !== 'text') return;
    const p = viewport.toScreen(el.x, el.y);
    const zoom = viewport.zoom;
    // Fonte mínima de 16px (o iOS dá zoom na página em campos menores) e
    // escala visual para compensar: o texto aparece no tamanho certo.
    const fontPx = el.fontSize * zoom;
    const scale = fontPx < MIN_INPUT_FONT ? fontPx / MIN_INPUT_FONT : 1;
    Object.assign(textarea.style, {
      transform: `translate(${p.x}px, ${p.y}px) scale(${scale})`,
      width: `${(el.width * zoom + 2) / scale}px`,
      height: `${(el.height * zoom) / scale}px`,
      font: `${el.fontWeight} ${fontPx / scale}px ${fontCss(el.fontFamily)}`,
      lineHeight: String(el.lineHeight),
      color: el.color,
      opacity: String(el.opacity),
      textAlign: el.align,
    });
  }

  function open(id: string): void {
    const el = doc.getElement(id);
    if (!el || el.type !== 'text') return;
    ui.editingId = id;
    textarea.value = el.text;
    textarea.hidden = false;
    position();
    textarea.focus();
    textarea.select();
    editor.requestRender();
  }

  function close(): void {
    const id = ui.editingId;
    if (!id) return;
    ui.editingId = null;
    textarea.hidden = true;
    const el = doc.getElement(id);
    if (el?.type === 'text' && !el.text.trim()) {
      doc.removeElements([id]);
      selection.clear();
    }
    editor.commit();
    editor.requestRender();
  }

  textarea.addEventListener('input', () => {
    if (ui.editingId) doc.updateElement(ui.editingId, { text: textarea.value });
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      textarea.blur();
    }
  });

  textarea.addEventListener('blur', close);
  doc.onChange(position);
  viewport.onChange(position);

  return { open };
}
