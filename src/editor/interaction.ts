import { selectedElements, type Editor } from './editor';
import {
  createEllipse,
  createLine,
  createPath,
  createRectangle,
  createText,
  boxFromPoints,
  type DesignElement,
  type ElementPatch,
} from './elements';
import {
  elementAt,
  HANDLE_CURSORS,
  handlePoint,
  handlesFor,
  isCorner,
  mapRect,
  normalizeRect,
  rectsIntersect,
  resizeBounds,
  snapAngle,
  unionBounds,
  type Handle,
  type Point,
  type Rect,
} from './geometry';
import { HANDLE_HIT_RADIUS } from './renderer';

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

/** Tolerância de clique: 4 px na tela, convertidos para o documento. */
const HIT_TOLERANCE = 4;
/** Arrastos menores que isso (px de tela) contam como clique. */
const CLICK_SLOP = 4;

/**
 * Traduz ponteiro no canvas em operações, conforme a ferramenta ativa:
 * selecionar/mover/redimensionar, criar formas, linhas, textos e desenhos.
 */
export function bindInteractions(editor: Editor, canvas: HTMLCanvasElement): void {
  const { doc, viewport, selection, ui, stage } = editor;
  let gesture: Gesture | null = null;

  const position = (event: MouseEvent): PointerPos => {
    const rect = stage.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, doc: viewport.toDocument(screen.x, screen.y) };
  };
  const tolerance = () => HIT_TOLERANCE / viewport.zoom;

  /** Alça da seleção atual sob o ponto (px de tela). */
  function handleAt(screen: Point): Handle | null {
    const selected = selectedElements(editor);
    const bounds = unionBounds(selected);
    if (!bounds) return null;
    for (const handle of handlesFor(selected)) {
      const p = handlePoint(bounds, handle);
      const s = viewport.toScreen(p.x, p.y);
      if (Math.abs(s.x - screen.x) <= HANDLE_HIT_RADIUS && Math.abs(s.y - screen.y) <= HANDLE_HIT_RADIUS) {
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
      if (event.shiftKey) {
        selection.toggle(hit.id);
        if (!selection.has(hit.id)) return null;
      } else if (!selection.has(hit.id)) {
        selection.set([hit.id]);
      }
      return startMove(pos);
    }

    if (!event.shiftKey) selection.clear();
    return startMarquee(pos, event.shiftKey);
  }

  function startMove(start: PointerPos): Gesture {
    const origins = selectedElements(editor).map((el) => ({ id: el.id, x: el.x, y: el.y }));
    let active = false;
    return {
      move(pos, event) {
        let dx = pos.doc.x - start.doc.x;
        let dy = pos.doc.y - start.doc.y;
        if (!active && Math.hypot(pos.screen.x - start.screen.x, pos.screen.y - start.screen.y) < CLICK_SLOP) return;
        active = true;
        // Shift trava no eixo dominante.
        if (event.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        doc.updateElements(origins.map((o) => [o.id, { x: o.x + dx, y: o.y + dy }] as const));
      },
      end: () => editor.commit(),
    };
  }

  function startResize(start: PointerPos, handle: Handle): Gesture {
    const originals = selectedElements(editor);
    const bounds = unionBounds(originals)!;
    const onlyText = originals.length === 1 && originals[0].type === 'text';
    const allImages = originals.every((el) => el.type === 'image');
    return {
      move(pos, event) {
        // Texto sempre proporcional; imagens pelos cantos também (Shift inverte).
        const keepRatio = onlyText || event.shiftKey !== (allImages && isCorner(handle));
        const next = resizeBounds(bounds, handle, pos.doc.x - start.doc.x, pos.doc.y - start.doc.y, keepRatio);
        doc.updateElements(originals.map((el) => [el.id, scaledPatch(el, bounds, next)] as const));
      },
      end: () => editor.commit(),
    };
  }

  function scaledPatch(el: DesignElement, from: Rect, to: Rect): ElementPatch {
    const r = mapRect(el, from, to);
    if (el.type === 'text') {
      const scale = from.height ? to.height / from.height : 1;
      return { x: r.x, y: r.y, fontSize: Math.max(1, el.fontSize * scale) };
    }
    return { x: r.x, y: r.y, width: Math.max(0, r.width), height: Math.max(0, r.height) };
  }

  function startMarquee(start: PointerPos, additive: boolean): Gesture {
    const base = additive ? [...selection.ids] : [];
    return {
      move(pos) {
        ui.marquee = normalizeRect(start.doc, pos.doc);
        const hits = doc.elements.filter((el) => rectsIntersect(el, ui.marquee!)).map((el) => el.id);
        selection.set([...base, ...hits]);
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

  function startDraw(start: PointerPos): Gesture {
    const points = [start.doc.x, start.doc.y];
    const el = createPath(points);
    doc.addElements([el]);
    selection.clear();

    return {
      move(pos) {
        const lastX = points[points.length - 2];
        const lastY = points[points.length - 1];
        // Ignora movimentos menores que 2 px na tela (traço mais leve).
        if (Math.hypot(pos.doc.x - lastX, pos.doc.y - lastY) * viewport.zoom < 2) return;
        points.push(pos.doc.x, pos.doc.y);
        doc.updateElement(el.id, boxFromPoints(points));
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

  // ---- Eventos -------------------------------------------------------------

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Tira o foco de campos do painel/editor de texto (isso confirma o valor digitado).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const pos = position(event);
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
    ui.hoverId = null;
    editor.requestRender();
  });

  canvas.addEventListener('pointermove', (event) => {
    const pos = position(event);
    if (gesture) {
      gesture.move(pos, event);
      return;
    }
    if (editor.tool !== 'select') {
      canvas.style.cursor = '';
      return;
    }
    const handle = handleAt(pos.screen);
    canvas.style.cursor = handle ? HANDLE_CURSORS[handle] : '';
    const hoverId = handle ? null : (elementAt(doc.elements, pos.doc, tolerance())?.id ?? null);
    if (hoverId !== ui.hoverId) {
      ui.hoverId = hoverId;
      editor.requestRender();
    }
  });

  const finish = () => {
    gesture?.end();
    gesture = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  canvas.addEventListener('pointerleave', () => {
    if (ui.hoverId) {
      ui.hoverId = null;
      editor.requestRender();
    }
  });

  canvas.addEventListener('dblclick', (event) => {
    if (editor.tool !== 'select') return;
    const hit = elementAt(doc.elements, position(event).doc, tolerance());
    if (hit?.type === 'text') editor.editText(hit.id);
  });
}
