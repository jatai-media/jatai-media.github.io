import { selectedElements, type Editor } from './editor';
import {
  createEllipse,
  createLine,
  createPath,
  createRectangle,
  createText,
  boxFromPoints,
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
import { addWandPoint } from './image-edits';
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

  // ---- Varinha mágica -------------------------------------------------------

  /** Com a varinha ativa, clique na imagem apaga a região; fora dela, desliga a varinha. */
  function wandClick(pos: PointerPos): boolean {
    const el = doc.getElement(ui.wandTarget!);
    const inside =
      el?.type === 'image' &&
      el.width > 0 &&
      el.height > 0 &&
      pos.doc.x >= el.x &&
      pos.doc.x <= el.x + el.width &&
      pos.doc.y >= el.y &&
      pos.doc.y <= el.y + el.height;
    if (!inside) {
      editor.setWand(null);
      return false;
    }
    void addWandPoint(editor, el.id, [(pos.doc.x - el.x) / el.width, (pos.doc.y - el.y) / el.height]);
    return true;
  }

  // ---- Eventos -------------------------------------------------------------

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Tira o foco de campos do painel/editor de texto (isso confirma o valor digitado).
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const pos = position(event);
    if (editor.tool === 'select' && ui.wandTarget && wandClick(pos)) return;
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
    if (gesture) {
      gesture.move(pos, event);
      return;
    }
    // Fora da seleção (ou com a varinha ativa) o cursor vem do CSS e não há destaque.
    if (editor.tool !== 'select' || ui.wandTarget) {
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
    gesture?.end();
    gesture = null;
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  canvas.addEventListener('pointerleave', () => {
    if (ui.hoverIds.length) {
      ui.hoverIds = [];
      editor.requestRender();
    }
  });

  // Clique direito: seleciona o que está sob o ponteiro (grupo inteiro, se for o caso) e abre o menu.
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (editor.tool !== 'select') return;
    const hit = elementAt(doc.elements, position(event).doc, tolerance());
    if (!hit) {
      selection.clear();
      return;
    }
    const target = clickTarget(editor, hit);
    if (!target.every((id) => selection.has(id))) selection.set(target);
    openSelectionMenu(editor, event.clientX, event.clientY);
  });

  canvas.addEventListener('dblclick', (event) => {
    if (editor.tool !== 'select') return;
    const hit = elementAt(doc.elements, position(event).doc, tolerance());
    if (!hit) return;
    // Duplo clique "entra" no grupo: seleciona só o membro.
    if (hit.groupId) selection.set([hit.id]);
    if (hit.type === 'text') editor.editText(hit.id);
    editor.requestRender();
  });
}
