import '../shared/base.css';
import './editor.css';
import { applyTranslations, onLocaleChange, t } from '../i18n';
import { mountLangSwitchers } from '../shared/lang-switcher';
import { mountThemeToggles, onThemeChange } from '../shared/theme';
import { arrangeSelection, deleteSelection, duplicateSelection, nudgeSelection, selectAll } from './actions';
import { mountArtboardHandles } from './artboard-handles';
import { mountCanvasPanel } from './canvas-panel';
import { bindClipboard } from './clipboard';
import { DesignDocument } from './document';
import type { Editor, UiState } from './editor';
import { enteredGroup, groupSelection, selectedGroup, ungroupSelection } from './groups';
import { exportPng } from './export';
import { UndoHistory } from './history';
import { bindImageDrop, insertImageFiles } from './image-import';
import { setImageLoadListener } from './images';
import { bindInteractions } from './interaction';
import { mountLayersPanel } from './layers-panel';
import type { EditorPrefs } from './prefs';
import { mountPropertiesPanel } from './properties-panel';
import { StageRenderer } from './renderer';
import { SelectionModel } from './selection';
import { bindStageControls, isTyping } from './stage-controls';
import { createTextEditor } from './text-editor';
import { TOOLS, type ToolId } from './tools';
import { Viewport } from './viewport';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const toolbar = $('#toolbar');
const stage = $('#stage');
const canvas = $<HTMLCanvasElement>('#stage-canvas');
const statusTool = $('#status-tool');
const statusZoom = $('#status-zoom');
const statusSize = $('#status-size');
const undoButton = $<HTMLButtonElement>('#undo');
const redoButton = $<HTMLButtonElement>('#redo');
const exportButton = $<HTMLButtonElement>('#export');
const titleInput = $<HTMLInputElement>('#doc-title');

const doc = new DesignDocument(1080, 1080);
const viewport = new Viewport();
const selection = new SelectionModel();
const history = new UndoHistory(doc);
const prefs: EditorPrefs = { lockAspect: false };
const ui: UiState = { hoverIds: [], marquee: null, editingId: null, guides: [] };
let tool: ToolId = 'select';

const editor: Editor = {
  doc,
  viewport,
  selection,
  history,
  prefs,
  ui,
  stage,
  get tool() {
    return tool;
  },
  setTool: (id) => selectTool(id),
  requestRender: () => renderer.request(),
  commit: () => history.commit(),
  editText: (id) => textEditor.open(id),
  renameGroup: (groupId) => layers.rename(groupId),
  fitView,
};

const renderer = new StageRenderer(canvas, editor);
const textEditor = createTextEditor(editor);

// Seletor de arquivos da ferramenta Imagem.
const imageInput = document.createElement('input');
imageInput.type = 'file';
imageInput.accept = 'image/*';
imageInput.multiple = true;
imageInput.addEventListener('change', () => {
  if (imageInput.files?.length) void insertImageFiles(editor, [...imageInput.files]);
  imageInput.value = '';
});

function fitView(): void {
  viewport.fit(doc.width, doc.height, stage.clientWidth, stage.clientHeight);
}

function zoomAtCenter(direction: 1 | -1): void {
  viewport.stepZoom(direction, stage.clientWidth / 2, stage.clientHeight / 2);
}

function renderToolbar(): void {
  toolbar.replaceChildren(
    ...TOOLS.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tool-button';
      button.dataset.tool = item.id;
      // Tooltip e rótulo acessível traduzidos pelo applyTranslations().
      button.dataset.i18nAttr = `title:${item.labelKey};aria-label:${item.labelKey}`;
      button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg><kbd>${item.shortcut.toUpperCase()}</kbd>`;
      button.addEventListener('click', () => selectTool(item.id));
      return button;
    }),
  );
}

function selectTool(id: ToolId): void {
  // "Imagem" não é um modo: abre o seletor de arquivos e continua na ferramenta atual.
  if (id === 'image') {
    imageInput.click();
    return;
  }
  tool = id;
  stage.dataset.tool = id;
  if (id !== 'select') selection.clear();
  toolbar.querySelectorAll<HTMLButtonElement>('.tool-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === id));
  });
  renderStatus();
}

/** Textos gerados por código: sempre via t(), e re-renderizados ao trocar o idioma. */
function renderStatus(): void {
  const current = TOOLS.find((item) => item.id === tool)!;
  statusTool.textContent = t('editor.status.activeTool', { tool: t(current.labelKey) });
  statusZoom.textContent = t('editor.status.zoom', { value: Math.round(viewport.zoom * 100) });
  statusSize.textContent = t('editor.status.size', { width: doc.width, height: doc.height });
}

function renderHistoryButtons(): void {
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
}

function bindShortcuts(): void {
  window.addEventListener('keydown', (event) => {
    if (isTyping(event.target) || event.altKey) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    // Com Ctrl/⌘
    if (mod) {
      const actions: Record<string, () => void> = {
        z: () => (event.shiftKey ? history.redo() : history.undo()),
        y: () => history.redo(),
        d: () => duplicateSelection(editor),
        a: () => selectAll(editor),
        g: () => (event.shiftKey ? ungroupSelection(editor) : groupSelection(editor)),
      };
      const byCode: Record<string, () => void> = {
        BracketRight: () => arrangeSelection(editor, event.shiftKey ? 'front' : 'forward'),
        BracketLeft: () => arrangeSelection(editor, event.shiftKey ? 'back' : 'backward'),
      };
      const action = actions[key] ?? byCode[event.code];
      if (action) {
        event.preventDefault();
        action();
      }
      return;
    }

    // Zoom: Shift+1 enquadra, Shift+0 vai para 100% (como no Figma).
    if (event.shiftKey && event.code === 'Digit1') return fitView();
    if (event.shiftKey && event.code === 'Digit0') {
      return viewport.setZoom(1, stage.clientWidth / 2, stage.clientHeight / 2);
    }
    if (event.key === '+' || event.key === '=') return zoomAtCenter(1);
    if (event.key === '-') return zoomAtCenter(-1);

    // Seleção
    if (event.key === 'F2') {
      const group = selectedGroup(editor);
      if (group) {
        event.preventDefault();
        return editor.renameGroup(group);
      }
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      return deleteSelection(editor);
    }
    if (event.key === 'Escape') {
      // Dentro de um grupo, Esc volta a selecionar o grupo inteiro.
      const group = enteredGroup(editor);
      if (group) return selection.set(doc.groupMembers(group).map((el) => el.id));
      selection.clear();
      return selectTool('select');
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (arrows[event.key] && selection.size) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      return nudgeSelection(editor, arrows[event.key][0] * step, arrows[event.key][1] * step);
    }

    const shortcut = TOOLS.find((item) => item.shortcut === key);
    if (shortcut) selectTool(shortcut.id);
  });
}

$('#zoom-in').addEventListener('click', () => zoomAtCenter(1));
$('#zoom-out').addEventListener('click', () => zoomAtCenter(-1));
$('#zoom-fit').addEventListener('click', fitView);
undoButton.addEventListener('click', () => history.undo());
redoButton.addEventListener('click', () => history.redo());
exportButton.addEventListener('click', () => {
  void exportPng(doc, titleInput.value || titleInput.placeholder);
});

renderToolbar();
mountLangSwitchers();
mountThemeToggles();
applyTranslations();

const updateArtboardHandles = mountArtboardHandles(editor);
mountCanvasPanel(editor);
mountPropertiesPanel(editor);
const layers = mountLayersPanel(editor);
bindStageControls(stage, viewport);
bindInteractions(editor, canvas);
bindClipboard(editor);
bindImageDrop(editor);
bindShortcuts();

const refresh = () => {
  renderer.request();
  updateArtboardHandles();
  renderStatus();
};
doc.onChange(() => {
  // Elementos removidos (excluir, desfazer...) saem da seleção.
  selection.retain((id) => doc.getElement(id) !== undefined);
  refresh();
  renderHistoryButtons();
});
viewport.onChange(refresh);
selection.onChange(() => renderer.request());
history.onChange(renderHistoryButtons);
onLocaleChange(refresh);
onThemeChange(() => renderer.request());
setImageLoadListener(() => renderer.request());

// Quando as fontes terminam de carregar, as medidas dos textos mudam.
document.fonts.addEventListener('loadingdone', () => doc.relayoutText());

selectTool(tool);
renderHistoryButtons();
fitView();
