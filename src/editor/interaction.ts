import { selectedElements, type Editor } from './editor';
import {
  absoluteStrokes,
  boxFromPoints,
  createEllipse,
  createLine,
  createPath,
  createRectangle,
  createText,
  pathFromStrokes,
  type ImageElement,
  type PathStroke,
} from './elements';
import {
  elementAt,
  HANDLE_CURSORS,
  handlePoint,
  handlesFor,
  normalizeRect,
  rectsIntersect,
  resizeBounds,
  snapAngle,
  unionBounds,
  type Handle,
  type Point,
} from './geometry';
import { openSelectionMenu } from './context-menus';
import { clickTarget, expandToGroups, selectedGroup } from './groups';
import { sampleCanvas } from './color-picker';
import { applyBrushStrokes } from './background-removal';
import { addBrushStroke, addWandPoint } from './image-edits';
import { getImage } from './images';
import { HANDLE_HIT_RADIUS } from './renderer';
import { collectTargets, resizeGuides, SNAP_THRESHOLD, snapMove, snapResizeEdges } from './snapping';
import { scaleElements } from './transform';

interface PointerPos {
  /** px CSS dentro do stage */
  screen: Point;
  /** px do documento */
  doc: Point;
}

interface Gesture {
  move(pos: PointerPos, event: PointerEvent): void;
  end(): void;
}

/** Tolerância de clique: 4 px na tela (10 px no toque), convertidos para o documento. */
const HIT_TOLERANCE = 4;
const TOUCH_HIT_TOLERANCE = 10;
/** Distância (px de tela) em que uma alça é "pegável" com o dedo. */
const TOUCH_HANDLE_RADIUS = 18;
/** Pressionar e segurar (ms) abre o menu de contexto no toque. */
const LONG_PRESS_MS = 500;
/** Dois toques em até esse tempo (ms) e distância (px) contam como toque duplo. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 24;
/** Arrastos menores que isso (px de tela) contam como clique. */
const CLICK_SLOP = 4;

/**
 * Traduz ponteiro no canvas em operações, conforme a ferramenta ativa:
 * selecionar/mover/redimensionar, criar formas, linhas, textos e desenhos.
 */
export function bindInteractions(editor: Editor, canvas: HTMLCanvasElement): { cancelGesture(): void } {
  const { doc, viewport, selection, ui, stage } = editor;
  let gesture: Gesture | null = null;
  /** Tipo do último ponteiro (mouse, caneta ou toque): ajusta as tolerâncias. */
  let pointerType = 'mouse';
  let longPress: { timer: number; screen: Point } | null = null;
  let lastTap: { time: number; x: number; y: number } | null = null;

  const position = (event: MouseEvent): PointerPos => {
    const rect = stage.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, doc: viewport.toDocument(screen.x, screen.y) };
  };
  const tolerance = () => (pointerType === 'touch' ? TOUCH_HIT_TOLERANCE : HIT_TOLERANCE) / viewport.zoom;

  /** Alça da seleção atual sob o ponto (px de tela). */
  function handleAt(screen: Point): Handle | null {
    const selected = selectedElements(editor);
    const bounds = unionBounds(selected);
    if (!bounds) return null;
    for (const handle of handlesFor(selected)) {
      const p = handlePoint(bounds, handle);
      const s = viewport.toScreen(p.x, p.y);
      const radius = pointerType === 'touch' ? TOUCH_HANDLE_RADIUS : HANDLE_HIT_RADIUS;
      if (Math.abs(s.x - screen.x) <= radius && Math.abs(s.y - screen.y) <= radius) {
        return handle;
      }
    }
    return null;
  }

  // ---- Selecionar ----------------------------------------------------------

  function startSelect(pos: PointerPos, event: PointerEvent): Gesture | null {
    const handle = handleAt(pos.screen);
    if (handle) return startResize(pos, handle);

    const hit = elementAt(doc.elements, pos.doc, tolerance());
    if (hit) {
      // Membro de grupo seleciona o grupo todo (a menos que já estejamos dentro dele).
      const target = clickTarget(editor, hit);
      const allSelected = target.every((id) => selection.has(id));
      if (event.shiftKey) {
        if (allSelected) {
          selection.set(selection.ids.filter((id) => !target.includes(id)));
          return null;
        }
        selection.set([...selection.ids, ...target]);
      } else if (!allSelected) {
        selection.set(target);
      }
      return startMove(pos);
    }

    if (!event.shiftKey) selection.clear();
    return startMarquee(pos, event.shiftKey);
  }

  /** Ctrl/⌘ durante o arraste desliga o encaixe (movimento livre). */
  const snapDisabled = (event: PointerEvent) => event.ctrlKey || event.metaKey;
  const snapThreshold = () => SNAP_THRESHOLD / viewport.zoom;

  function endWithGuides(): void {
    ui.guides = [];
    editor.requestRender();
    editor.commit();
  }

  function startMove(start: PointerPos): Gesture {
    const moving = selectedElements(editor);
    const origins = moving.map((el) => ({ id: el.id, x: el.x, y: el.y }));
    const bounds = unionBounds(moving)!;
    const targets = collectTargets(doc, new Set(selection.ids));
    let active = false;
    return {
      move(pos, event) {
        let dx = pos.doc.x - start.doc.x;
        let dy = pos.doc.y - start.doc.y;
        if (!active && Math.hypot(pos.screen.x - start.screen.x, pos.screen.y - start.screen.y) < CLICK_SLOP) return;
        active = true;

        // Shift trava no eixo dominante.
        const lock = event.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? 'y' : 'x') : null;
        if (lock === 'y') dy = 0;
        if (lock === 'x') dx = 0;

        ui.guides = [];
        if (!snapDisabled(event)) {
          const snap = snapMove({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, targets, snapThreshold());
          if (lock !== 'x') dx += snap.dx;
          if (lock !== 'y') dy += snap.dy;
          ui.guides = snap.guides;
        }
        doc.updateElements(origins.map((o) => [o.id, { x: o.x + dx, y: o.y + dy }] as const));
        editor.requestRender();
      },
      end: endWithGuides,
    };
  }

  function startResize(start: PointerPos, handle: Handle): Gesture {
    const originals = selectedElements(editor);
    const bounds = unionBounds(originals)!;
    const onlyText = originals.length === 1 && originals[0].type === 'text';
    // Texto sempre escala proporcional. Grupo inteiro segue o cadeado do grupo;
    // outras seleções, o dos elementos (basta um travado). Grupo de um membro
    // só mostra os campos do elemento no painel, então segue o do elemento.
    const group = originals.length > 1 ? selectedGroup(editor) : null;
    const locked = onlyText || (group ? !!doc.groupMeta(group).lockRatio : originals.some((el) => el.lockRatio));
    const targets = collectTargets(doc, new Set(selection.ids));
    const edges = {
      left: handle.includes('w'),
      right: handle.includes('e'),
      top: handle.includes('n'),
      bottom: handle.includes('s'),
    };
    return {
      move(pos, event) {
        // Shift inverte o cadeado durante o arraste (texto nunca distorce).
        const keepRatio = onlyText || locked !== event.shiftKey;
        const dx = pos.doc.x - start.doc.x;
        const dy = pos.doc.y - start.doc.y;
        let next = resizeBounds(bounds, handle, dx, dy, keepRatio);

        ui.guides = [];
        if (!snapDisabled(event)) {
          const snap = snapResizeEdges(next, edges, targets, snapThreshold());
          // Com proporção travada, só um eixo pode mandar (o outro acompanha).
          const sdx = snap.dx;
          const sdy = keepRatio && sdx ? 0 : snap.dy;
          if (sdx || sdy) next = resizeBounds(bounds, handle, dx + sdx, dy + sdy, keepRatio);
          ui.guides = resizeGuides(next, edges, targets);
        }
        scaleElements(doc, originals, bounds, next);
        editor.requestRender();
      },
      end: endWithGuides,
    };
  }

  function startMarquee(start: PointerPos, additive: boolean): Gesture {
    const base = additive ? [...selection.ids] : [];
    return {
      move(pos) {
        ui.marquee = normalizeRect(start.doc, pos.doc);
        const hits = doc.elements.filter((el) => rectsIntersect(el, ui.marquee!)).map((el) => el.id);
        selection.set([...base, ...expandToGroups(editor, hits)]);
        editor.requestRender();
      },
      end() {
        ui.marquee = null;
        editor.requestRender();
      },
    };
  }

  // ---- Criar ---------------------------------------------------------------

  /** Tamanho padrão de uma forma criada com um clique simples. */
  const defaultSize = () => Math.round(Math.min(doc.width, doc.height) / 4);

  function startShape(kind: 'rectangle' | 'ellipse', start: PointerPos): Gesture {
    const create = kind === 'rectangle' ? createRectangle : createEllipse;
    const el = create(start.doc.x, start.doc.y, 0, 0);
    doc.addElements([el]);
    selection.set([el.id]);

    return {
      move(pos, event) {
        let w = pos.doc.x - start.doc.x;
        let h = pos.doc.y - start.doc.y;
        if (event.shiftKey) {
          const size = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * size;
          h = Math.sign(h || 1) * size;
        }
        doc.updateElement(el.id, normalizeRect(start.doc, { x: start.doc.x + w, y: start.doc.y + h }));
      },
      end() {
        const current = doc.getElement(el.id)!;
        if (Math.max(current.width, current.height) * viewport.zoom < CLICK_SLOP) {
          const size = defaultSize();
          doc.updateElement(el.id, { x: start.doc.x - size / 2, y: start.doc.y - size / 2, width: size, height: size });
        }
        editor.setTool('select');
        editor.commit();
      },
    };
  }

  function startLine(start: PointerPos): Gesture {
    const el = createLine([start.doc.x, start.doc.y, start.doc.x, start.doc.y]);
    doc.addElements([el]);
    selection.set([el.id]);

    return {
      move(pos, event) {
        const end = event.shiftKey ? snapAngle(start.doc, pos.doc) : pos.doc;
        doc.updateElement(el.id, boxFromPoints([start.doc.x, start.doc.y, end.x, end.y]));
      },
      end() {
        const current = doc.getElement(el.id)!;
        if (Math.max(current.width, current.height) * viewport.zoom < CLICK_SLOP) {
          const half = defaultSize() / 2;
          doc.updateElement(el.id, boxFromPoints([start.doc.x - half, start.doc.y, start.doc.x + half, start.doc.y]));
        }
        editor.setTool('select');
        editor.commit();
      },
    };
  }

  /**
   * Desenho livre com o pincel atual. Com "juntar traços" ligado, traços
   * seguidos entram na mesma camada até trocar de ferramenta ou apertar Esc.
   */
  function startDraw(start: PointerPos): Gesture {
    const { brush } = editor.prefs;
    const stroke: PathStroke = { points: [start.doc.x, start.doc.y], color: brush.color, width: brush.width };
    const current = ui.drawingId ? doc.getElement(ui.drawingId) : undefined;
    const target = brush.merge && current?.type === 'path' ? current : null;
    // Traços anteriores da camada, em coordenadas absolutas (a caixa muda ao crescer).
    const previous = target ? absoluteStrokes(target) : [];

    let id: string;
    if (target) {
      id = target.id;
      doc.updateElement(id, pathFromStrokes([...previous, stroke]));
    } else {
      const el = createPath(stroke);
      id = el.id;
      doc.addElements([el]);
    }
    ui.drawingId = id;
    selection.clear();

    const points = [...stroke.points];
    return {
      move(pos) {
        const lastX = points[points.length - 2];
        const lastY = points[points.length - 1];
        // Ignora movimentos menores que 2 px na tela (traço mais leve).
        if (Math.hypot(pos.doc.x - lastX, pos.doc.y - lastY) * viewport.zoom < 2) return;
        points.push(pos.doc.x, pos.doc.y);
        doc.updateElement(id, pathFromStrokes([...previous, { ...stroke, points }]));
      },
      end: () => editor.commit(),
    };
  }

  function placeText(pos: PointerPos): void {
    const hit = elementAt(doc.elements, pos.doc, tolerance());
    if (hit?.type === 'text') {
      selection.set([hit.id]);
      editor.setTool('select');
      editor.editText(hit.id);
      return;
    }
    const fontSize = Math.max(12, Math.round(Math.min(doc.width, doc.height) / 15));
    const el = createText(pos.doc.x, pos.doc.y - (fontSize * 1.2) / 2, fontSize);
    doc.addElements([el]);
    selection.set([el.id]);
    editor.setTool('select');
    editor.editText(el.id);
  }

  // ---- Ferramentas de imagem (varinha, borracha, restaurar) ---------------

  /** Imagem da ferramenta ativa, se ainda existir. */
  function toolImage(): Readonly<ImageElement> | undefined {
    const el = ui.imageTool ? doc.getElement(ui.imageTool.id) : undefined;
    return el?.type === 'image' && el.width > 0 && el.height > 0 ? el : undefined;
  }

  /** Ponto do documento → coordenadas normalizadas (0–1) na imagem. */
  const inImage = (el: Readonly<ImageElement>, p: Point): [number, number] => [
    (p.x - el.x) / el.width,
    (p.y - el.y) / el.height,
  ];

  /** Raio da ponta do pincel em px do documento (o tamanho é em px da imagem). */
  function brushRadius(el: Readonly<ImageElement>): number {
    const natural = getImage(el.src)?.naturalWidth ?? el.width;
    return (editor.prefs.imageBrushSize / 2) * (el.width / natural);
  }

  function updateBrushCursor(pos: PointerPos | null): void {
    const el = toolImage();
    const brush = ui.imageTool && ui.imageTool.mode !== 'wand';
    const next = pos && el && brush ? { x: pos.doc.x, y: pos.doc.y, radius: brushRadius(el) } : null;
    if (!next && !ui.brushCursor) return;
    ui.brushCursor = next;
    editor.requestRender();
  }

  /**
   * Clique com uma ferramenta de imagem ativa. Dentro da imagem: varinha
   * apaga a região; borracha/restaurar começam um traço. Fora: desliga a
   * ferramenta e devolve undefined (o clique segue o fluxo normal).
   */
  function startImageTool(pos: PointerPos): Gesture | null | undefined {
    const el = toolImage();
    const inside =
      el && pos.doc.x >= el.x && pos.doc.x <= el.x + el.width && pos.doc.y >= el.y && pos.doc.y <= el.y + el.height;
    if (!el || !inside || !ui.imageTool) {
      editor.setImageTool(null);
      return undefined;
    }
    if (ui.imageTool.mode === 'wand') {
      void addWandPoint(editor, el.id, inImage(el, pos.doc));
      return null;
    }
    return startImageBrush(el, ui.imageTool.mode, pos);
  }

  /** Traço de borracha/restaurar com prévia ao vivo; grava ao soltar. */
  function startImageBrush(el: Readonly<ImageElement>, mode: 'erase' | 'restore', start: PointerPos): Gesture | null {
    const current = getImage(el.src);
    const original = getImage(el.originalSrc ?? el.src);
    if (!current || !original) return null;
    const width = current.naturalWidth;
    const height = current.naturalHeight;
    const stroke = { mode, size: editor.prefs.imageBrushSize / width, points: [...inImage(el, start.doc)] };

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const redraw = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(current, 0, 0);
      applyBrushStrokes(ctx, original, [stroke], width, height);
      editor.requestRender();
    };
    ui.imagePreview = { id: el.id, canvas };
    redraw();

    let last = start.screen;
    return {
      move(pos) {
        updateBrushCursor(pos);
        // Um ponto a cada 1,5 px de tela: traço fiel sem pontos demais.
        if (Math.hypot(pos.screen.x - last.x, pos.screen.y - last.y) < 1.5) return;
        last = pos.screen;
        stroke.points.push(...inImage(el, pos.doc));
        redraw();
      },
      end() {
        // A prévia fica até o resultado final chegar (evita piscar).
        void addBrushStroke(editor, el.id, stroke).finally(() => {
          if (ui.imagePreview?.canvas === canvas) ui.imagePreview = null;
          editor.requestRender();
        });
      },
    };
  }

  // ---- Toque ----------------------------------------------------------------

  function clearLongPress(): void {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  /**
   * Desfaz o gesto em andamento sem deixar rastro (ex.: o segundo dedo de
   * um pinçar encostou no meio de um traço).
   */
  function cancelGesture(): void {
    clearLongPress();
    if (!gesture) return;
    gesture = null;
    ui.guides = [];
    ui.marquee = null;
    ui.imagePreview = null;
    ui.brushCursor = null;
    editor.history.revert();
    editor.requestRender();
  }

  /** Duplo clique/toque: entra no grupo (seleciona só o membro) e edita texto. */
  function openElement(pos: PointerPos): void {
    if (editor.tool !== 'select') return;
    const hit = elementAt(doc.elements, pos.doc, tolerance());
    if (!hit) return;
    if (hit.groupId) selection.set([hit.id]);
    if (hit.type === 'text') editor.editText(hit.id);
    editor.requestRender();
  }

  /** Menu de contexto sobre o elemento no ponto (clique direito ou segurar o dedo). */
  function openMenuAt(pos: PointerPos, clientX: number, clientY: number): void {
    if (editor.tool !== 'select') return;
    const hit = elementAt(doc.elements, pos.doc, tolerance());
    if (!hit) {
      selection.clear();
      return;
    }
    const target = clickTarget(editor, hit);
    if (!target.every((id) => selection.has(id))) selection.set(target);
    openSelectionMenu(editor, clientX, clientY);
  }

  // ---- Eventos -------------------------------------------------------------

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointerType = event.pointerType;
    // Tira o foco de campos do painel/editor de texto (isso confirma o valor digitado).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const pos = position(event);

    if (pointerType === 'touch') {
      // Toque duplo equivale ao duplo clique (nem todo navegador móvel dispara dblclick).
      const now = performance.now();
      const isDouble =
        lastTap &&
        now - lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(pos.screen.x - lastTap.x, pos.screen.y - lastTap.y) < DOUBLE_TAP_SLOP;
      lastTap = isDouble ? null : { time: now, x: pos.screen.x, y: pos.screen.y };
      if (isDouble) {
        cancelGesture();
        openElement(pos);
        return;
      }
      // Segurar o dedo parado abre o menu de contexto.
      if (editor.tool === 'select' && !ui.imageTool) {
        clearLongPress();
        longPress = {
          screen: pos.screen,
          timer: window.setTimeout(() => {
            longPress = null;
            cancelGesture();
            openMenuAt(pos, event.clientX, event.clientY);
          }, LONG_PRESS_MS),
        };
      }
    }
    // Conta-gotas no canvas: o clique só pega a cor.
    if (ui.colorPick) return ui.colorPick(sampleCanvas(canvas, pos.screen.x, pos.screen.y));
    if (editor.tool === 'select' && ui.imageTool) {
      const imageGesture = startImageTool(pos);
      if (imageGesture !== undefined) {
        gesture = imageGesture;
        if (gesture) canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    switch (editor.tool) {
      case 'select':
        gesture = startSelect(pos, event);
        break;
      case 'rectangle':
      case 'ellipse':
        gesture = startShape(editor.tool, pos);
        break;
      case 'line':
        gesture = startLine(pos);
        break;
      case 'draw':
        gesture = startDraw(pos);
        break;
      case 'text':
        placeText(pos);
        break;
    }
    if (gesture) canvas.setPointerCapture(event.pointerId);
    ui.hoverIds = [];
    editor.requestRender();
  });

  canvas.addEventListener('pointermove', (event) => {
    const pos = position(event);
    if (longPress && Math.hypot(pos.screen.x - longPress.screen.x, pos.screen.y - longPress.screen.y) > 10) {
      clearLongPress();
    }
    if (gesture) {
      gesture.move(pos, event);
      return;
    }
    // No toque não existe "passar por cima": sem destaque nem cursor.
    if (event.pointerType === 'touch') return;
    // Fora da seleção (ou com ferramenta de imagem ativa) o cursor vem do CSS e não há destaque.
    if (ui.imageTool) updateBrushCursor(pos);
    if (editor.tool !== 'select' || ui.imageTool) {
      canvas.style.cursor = '';
      return;
    }
    const handle = handleAt(pos.screen);
    canvas.style.cursor = handle ? HANDLE_CURSORS[handle] : '';
    const hovered = handle ? undefined : elementAt(doc.elements, pos.doc, tolerance());
    const hoverIds = hovered ? clickTarget(editor, hovered) : [];
    if (hoverIds.join() !== ui.hoverIds.join()) {
      ui.hoverIds = hoverIds;
      editor.requestRender();
    }
  });

  const finish = () => {
    clearLongPress();
    gesture?.end();
    gesture = null;
    if (pointerType === 'touch' && ui.brushCursor) {
      ui.brushCursor = null;
      editor.requestRender();
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  canvas.addEventListener('pointerleave', () => {
    updateBrushCursor(null);
    if (ui.hoverIds.length) {
      ui.hoverIds = [];
      editor.requestRender();
    }
  });

  // Clique direito: seleciona o que está sob o ponteiro (grupo inteiro, se for o caso) e abre o menu.
  // No toque, o menu vem do "segurar o dedo" (acima).
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (pointerType === 'touch') return;
    openMenuAt(position(event), event.clientX, event.clientY);
  });

  canvas.addEventListener('dblclick', (event) => {
    if (pointerType === 'touch') return;
    openElement(position(event));
  });

  return { cancelGesture };
}
