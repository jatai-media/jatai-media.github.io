import { onLocaleChange, t } from '../i18n';
import { fitWithinLimits, SIZE_LIMITS } from './document';
import { pickColor } from './color-picker';
import type { Editor } from './editor';
import { findPreset, SIZE_PRESETS } from './presets';

const CUSTOM = 'custom';
const HEX_COLOR = /^#?([0-9a-f]{6})$/i;

function $<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

/**
 * Painel "Tela": tamanho pronto, largura/altura, trava de proporção,
 * inverter orientação e cor de fundo. Os textos fixos estão no HTML
 * (data-i18n); aqui só entram os gerados por código.
 */
export function mountCanvasPanel(editor: Editor): void {
  const { doc, prefs } = editor;
  const fitView = () => editor.fitView();
  const preset = $<HTMLSelectElement>('#canvas-preset');
  const width = $<HTMLInputElement>('#canvas-width');
  const height = $<HTMLInputElement>('#canvas-height');
  const lock = $<HTMLButtonElement>('#canvas-lock');
  const swap = $<HTMLButtonElement>('#canvas-swap');
  const color = $<HTMLInputElement>('#canvas-background');
  const hex = $<HTMLInputElement>('#canvas-background-hex');
  const pick = $<HTMLButtonElement>('#canvas-background-pick');

  for (const input of [width, height]) {
    input.min = String(SIZE_LIMITS.min);
    input.max = String(SIZE_LIMITS.max);
  }

  function renderPresetOptions(): void {
    preset.replaceChildren(
      new Option(t('editor.canvas.custom'), CUSTOM),
      ...SIZE_PRESETS.map((item) => new Option(t(item.labelKey), item.id)),
    );
    sync();
  }

  /** Reflete o documento nos campos. */
  function sync(): void {
    preset.value = findPreset(doc.width, doc.height)?.id ?? CUSTOM;
    if (document.activeElement !== width) width.value = String(doc.width);
    if (document.activeElement !== height) height.value = String(doc.height);
    color.value = doc.background;
    if (document.activeElement !== hex) hex.value = doc.background.toUpperCase();
    lock.setAttribute('aria-pressed', String(prefs.lockAspect));
  }

  preset.addEventListener('change', () => {
    const chosen = SIZE_PRESETS.find((item) => item.id === preset.value);
    if (!chosen) return;
    doc.resize(chosen.width, chosen.height);
    editor.commit();
    fitView();
  });

  function commitSize(changed: 'width' | 'height'): void {
    const ratio = doc.width / doc.height;
    let w = Number(width.value) || doc.width;
    let h = Number(height.value) || doc.height;
    if (prefs.lockAspect) {
      if (changed === 'width') h = w / ratio;
      else w = h * ratio;
      ({ width: w, height: h } = fitWithinLimits(w, h));
    }
    doc.resize(w, h);
    editor.commit();
    fitView();
    // Mostra o valor final (limitado/arredondado) mesmo com o campo em foco.
    width.value = String(doc.width);
    height.value = String(doc.height);
  }

  width.addEventListener('change', () => commitSize('width'));
  height.addEventListener('change', () => commitSize('height'));

  lock.addEventListener('click', () => {
    prefs.lockAspect = !prefs.lockAspect;
    sync();
  });

  swap.addEventListener('click', () => {
    doc.resize(doc.height, doc.width);
    editor.commit();
    fitView();
  });

  color.addEventListener('input', () => doc.setBackground(color.value));
  color.addEventListener('change', () => editor.commit());

  hex.addEventListener('change', () => {
    const match = HEX_COLOR.exec(hex.value.trim());
    if (match) {
      doc.setBackground(`#${match[1].toLowerCase()}`);
      editor.commit();
    }
    hex.value = doc.background.toUpperCase();
  });

  pick.addEventListener('click', async () => {
    const picked = await pickColor(editor);
    if (!picked) return;
    doc.setBackground(picked);
    editor.commit();
  });

  doc.onChange(sync);
  onLocaleChange(renderPresetOptions);
  renderPresetOptions();
}
