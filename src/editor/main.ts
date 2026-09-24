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
import { selectedElements, type Editor, type UiState } from './editor';
import { unionBounds } from './geometry';
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
import { mountViewControls } from './view-controls';
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
const prefs: EditorPrefs = {
  lockAspect: false,
  brush: { color: '#1a1917', width: 6, merge: true },
  imageBrushSize: 20,
};
const ui: UiState = {
  hoverIds: [],
  marquee: null,
  editingId: null,
  guides: [],
  imageTool: null,
  imagePreview: null,
  brushCursor: null,
  drawingId: null,
  colorPick: null,
};
const toolListeners = new Set<() => void>();
const imageToolListeners = new Set<() => void>();
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
  onToolChange(listener) {
    toolListeners.add(listener);
    return () => toolListeners.delete(listener);
  },
  requestRender: () => renderer.request(),
  commit: () => history.commit(),
  editText: (id) => textEditor.open(id),
  renameGroup: (groupId) => layers.rename(groupId),
  setImageTool(next) {
    if (ui.imageTool?.id === next?.id && ui.imageTool?.mode === next?.mode) return;
    ui.imageTool = next;
    ui.brushCursor = null;
    if (next) stage.dataset.imageTool = next.mode;
    else delete stage.dataset.imageTool;
    imageToolListeners.forEach((listener) => listener());
    renderer.request();
  },
  onImageToolChange(listener) {
    imageToolListeners.add(listener);
    return () => imageToolListeners.delete(listener);
  },
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
    panelToggle,
  );
}

// No celular o painel vira uma gaveta que sobe de baixo, aberta por este botão.
const editorRoot = $('.editor');
const panelToggle = document.createElement('button');
panelToggle.type = 'button';
panelToggle.className = 'tool-button panel-toggle';
panelToggle.dataset.i18nAttr = 'title:editor.mobile.panel;aria-label:editor.mobile.panel';
panelToggle.innerHTML =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/></svg>';
const setPanelOpen = (open: boolean) => {
  editorRoot.classList.toggle('panel-open', open);
  panelToggle.setAttribute('aria-pressed', String(open));
};
panelToggle.addEventListener('click', () => setPanelOpen(!editorRoot.classList.contains('panel-open')));
$('#panel-close').addEventListener('click', () => setPanelOpen(false));

function selectTool(id: ToolId): void {
  // "Imagem" não é um modo: abre o seletor de arquivos e continua na ferramenta atual.
  if (id === 'image') {
    imageInput.click();
    return;
  }
  tool = id;
  stage.dataset.tool = id;
  editor.setImageTool(null);
  // Trocar de ferramenta fecha o desenho atual (o próximo traço vira outra camada).
  ui.drawingId = null;
  if (id !== 'select') selection.clear();
  toolbar.querySelectorAll<HTMLButtonElement>('.tool-button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === id));
  });
  renderStatus();
  toolListeners.forEach((listener) => listener());
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
    // Shift+2 enquadra a seleção (bom para ajustes finos numa imagem).
    if (event.shiftKey && event.code === 'Digit2') {
      const bounds = unionBounds(selectedElements(editor));
      if (bounds) viewport.fitRect(bounds, stage.clientWidth, stage.clientHeight);
      return;
    }
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
      // Primeiro Esc só desliga a ferramenta de imagem (varinha/borracha/restaurar).
      if (ui.imageTool) return editor.setImageTool(null);
      // No desenho, Esc fecha a camada atual: o próximo traço começa outra.
      if (tool === 'draw' && ui.drawingId) {
        ui.drawingId = null;
        return;
      }
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
mountViewControls(fitView);
applyTranslations();

const updateArtboardHandles = mountArtboardHandles(editor);
mountCanvasPanel(editor);
mountPropertiesPanel(editor);
const layers = mountLayersPanel(editor);
// O segundo dedo de um pinçar cancela o gesto de um dedo que já tinha começado.
bindStageControls(stage, viewport, () => interactions.cancelGesture());
const interactions = bindInteractions(editor, canvas);
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
selection.onChange(() => {
  // A ferramenta de imagem vale só enquanto a imagem dela estiver selecionada.
  if (ui.imageTool && !selection.has(ui.imageTool.id)) editor.setImageTool(null);
  renderer.request();
});
history.onChange(renderHistoryButtons);
onLocaleChange(refresh);
onThemeChange(() => renderer.request());
setImageLoadListener(() => renderer.request());

// Quando as fontes terminam de carregar, as medidas dos textos mudam.
document.fonts.addEventListener('loadingdone', () => doc.relayoutText());

selectTool(tool);
renderHistoryButtons();
fitView();
