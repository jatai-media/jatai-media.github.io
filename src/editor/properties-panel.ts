import { onLocaleChange, t, type TranslationKey } from '../i18n';
import { arrangeSelection, deleteSelection, duplicateSelection } from './actions';
import { selectedElements, type Editor } from './editor';
import { ELEMENT_LABELS } from './element-meta';
import { groupDisplayName, groupSelection, groupsInSelection, selectedGroup, ungroupSelection } from './groups';
import { unionBounds } from './geometry';
import type { ElementPatch, ElementType, TextAlign } from './elements';
import { FONTS, type FontId } from './text-layout';
import { scaleElements } from './transform';
import { DEFAULT_BG_REMOVAL, removeBackground } from './background-removal';

/** Um controle do painel: o elemento DOM e como atualizá-lo a partir do documento. */
interface Field {
  root: HTMLElement;
  sync(): void;
}

const HEX_COLOR = /^#?([0-9a-f]{6})$/i;

const svg = (paths: string, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  alignLeft: svg('<path d="M4 6h16M4 12h10M4 18h13"/>'),
  alignCenter: svg('<path d="M4 6h16M7 12h10M5.5 18h13"/>'),
  alignRight: svg('<path d="M4 6h16M10 12h10M7 18h13"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  front: svg('<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>'),
  forward: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
  backward: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  back: svg('<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M20 8v10a2 2 0 0 1-2 2H8"/>'),
  duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  delete: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  group: svg('<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="7" y="7" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>'),
  ungroup: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M15 5h4v4M9 19H5v-4"/>'),
};

/** Cadeado aberto e fechado; o CSS mostra um ou outro conforme aria-pressed. */
const LOCK_ICONS =
  svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>').replace('<svg', '<svg class="icon-locked"') +
  svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-1.9"/>').replace('<svg', '<svg class="icon-unlocked"');

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** "16:9" quando a fração é simples; senão "1,78:1" (no formato do idioma). */
function formatRatio(width: number, height: number): string {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!w || !h) return '—';
  const d = gcd(w, h);
  if (w / d <= 32 && h / d <= 32) return `${w / d}:${h / d}`;
  return `${(w / h).toLocaleString(document.documentElement.lang, { maximumFractionDigits: 2 })}:1`;
}

const TEXT_ALIGNS: readonly { align: TextAlign; icon: string; titleKey: TranslationKey }[] = [
  { align: 'left', icon: ICONS.alignLeft, titleKey: 'editor.props.alignLeft' },
  { align: 'center', icon: ICONS.alignCenter, titleKey: 'editor.props.alignCenter' },
  { align: 'right', icon: ICONS.alignRight, titleKey: 'editor.props.alignRight' },
];

/**
 * Painel de propriedades do que está selecionado. Sem seleção, mostra o
 * painel "Tela"; com seleção, monta os campos conforme o tipo do elemento.
 */
export function mountPropertiesPanel(editor: Editor): void {
  const { doc, selection } = editor;
  const canvasPanel = document.querySelector<HTMLElement>('#canvas-panel')!;
  const panel = document.querySelector<HTMLElement>('#element-panel')!;

  let fields: Field[] = [];
  let builtFor = '';

  // ---- Construtores de campos ---------------------------------------------

  const isFocused = (el: Element) => document.activeElement === el;

  function fieldShell(label: string): { root: HTMLLabelElement; head: HTMLSpanElement } {
    const root = document.createElement('label');
    root.className = 'field';
    const head = document.createElement('span');
    head.className = 'field-label';
    head.textContent = label;
    root.append(head);
    return { root, head };
  }

  function heading(text: string): Field {
    const root = document.createElement('h2');
    root.textContent = text;
    return { root, sync() {} };
  }

  function numberField(
    label: string,
    get: () => number | undefined,
    set: (value: number) => void,
    options: { min?: number; max?: number; unit?: string } = {},
  ): Field {
    const { root } = fieldShell(label);
    const wrap = document.createElement('span');
    wrap.className = 'input-unit';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    wrap.append(input);
    if (options.unit) {
      const unit = document.createElement('span');
      unit.textContent = options.unit;
      unit.setAttribute('aria-hidden', 'true');
      wrap.append(unit);
    }
    root.append(wrap);

    const sync = () => {
      const value = get();
      if (value !== undefined && !isFocused(input)) input.value = String(Math.round(value));
    };
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (input.value !== '' && Number.isFinite(value)) {
        const min = options.min ?? -Infinity;
        const max = options.max ?? Infinity;
        set(Math.min(max, Math.max(min, value)));
        editor.commit();
      }
      input.value = String(Math.round(get() ?? 0));
    });
    return { root, sync };
  }

  function colorField(label: string, get: () => string | undefined, set: (value: string) => void): Field {
    const { root } = fieldShell(label);
    const wrap = document.createElement('span');
    wrap.className = 'color-field';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.setAttribute('aria-label', label);
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.autocomplete = 'off';
    wrap.append(picker, hex);
    root.append(wrap);

    const sync = () => {
      const value = get();
      if (!value) return;
      picker.value = value;
      if (!isFocused(hex)) hex.value = value.toUpperCase();
    };
    picker.addEventListener('input', () => set(picker.value));
    picker.addEventListener('change', () => editor.commit());
    hex.addEventListener('change', () => {
      const match = HEX_COLOR.exec(hex.value.trim());
      if (match) {
        set(`#${match[1].toLowerCase()}`);
        editor.commit();
      }
      hex.value = (get() ?? '').toUpperCase();
    });
    return { root, sync };
  }

  function rangeField(label: string, get: () => number | undefined, set: (value: number) => void): Field {
    const { root, head } = fieldShell(label);
    const value = document.createElement('span');
    value.className = 'field-value';
    head.append(value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    root.append(input);

    const sync = () => {
      const current = get();
      if (current === undefined) return;
      input.value = String(Math.round(current * 100));
      value.textContent = `${input.value}%`;
    };
    input.addEventListener('input', () => set(Number(input.value) / 100));
    input.addEventListener('change', () => editor.commit());
    return { root, sync };
  }

  function selectField<T extends string>(
    label: string,
    options: readonly { value: T; label: string }[],
    get: () => T | undefined,
    set: (value: T) => void,
  ): Field {
    const { root } = fieldShell(label);
    const select = document.createElement('select');
    options.forEach((option) => select.add(new Option(option.label, option.value)));
    root.append(select);
    select.addEventListener('change', () => {
      set(select.value as T);
      editor.commit();
    });
    return {
      root,
      sync() {
        const value = get();
        if (value !== undefined) select.value = value;
      },
    };
  }

  /** Linha de botões de ícone; `pressed` torna-os alternáveis. */
  function buttonsField(
    label: string,
    buttons: readonly { icon: string; titleKey: TranslationKey; onClick(): void; pressed?(): boolean; danger?: boolean }[],
  ): Field {
    const root = document.createElement('div');
    root.className = 'field';
    const head = document.createElement('span');
    head.className = 'field-label';
    head.textContent = label;
    const row = document.createElement('div');
    row.className = 'button-row';
    root.append(head, row);

    const items = buttons.map((spec) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = spec.danger ? 'icon-button danger' : 'icon-button';
      button.innerHTML = spec.icon;
      button.title = t(spec.titleKey);
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', spec.onClick);
      row.append(button);
      return { button, spec };
    });

    return {
      root,
      sync() {
        for (const { button, spec } of items) {
          if (spec.pressed) button.setAttribute('aria-pressed', String(spec.pressed()));
        }
      },
    };
  }

  /**
   * Remoção de fundo da imagem. A primeira aplicação guarda o original; depois
   * disso, mexer na tolerância ou nas áreas internas reprocessa ao vivo a
   * partir do original (o passo de desfazer fecha ao soltar o controle).
   */
  function backgroundField(id: string): Field {
    const image = () => {
      const el = doc.getElement(id);
      return el?.type === 'image' ? el : undefined;
    };
    const settings = { ...DEFAULT_BG_REMOVAL, ...image()?.bgRemoval };
    /** Só o processamento mais recente vale (evita resultados fora de ordem). */
    let run = 0;
    let timer = 0;

    const root = document.createElement('div');
    root.className = 'field bg-removal';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = t('editor.bg.title');

    const toleranceHead = document.createElement('span');
    toleranceHead.className = 'field-label';
    const toleranceValue = document.createElement('span');
    toleranceValue.className = 'field-value';
    toleranceHead.append(t('editor.bg.tolerance'), toleranceValue);
    const tolerance = document.createElement('input');
    tolerance.type = 'range';
    tolerance.min = '0';
    tolerance.max = '100';
    tolerance.setAttribute('aria-label', t('editor.bg.tolerance'));

    const interiorLabel = document.createElement('label');
    interiorLabel.className = 'checkbox-field';
    const interior = document.createElement('input');
    interior.type = 'checkbox';
    interiorLabel.append(interior, t('editor.bg.interior'));

    const buttons = document.createElement('div');
    buttons.className = 'button-pair';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'secondary-button';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'secondary-button';
    restore.textContent = t('editor.bg.restore');
    buttons.append(apply, restore);

    root.append(label, toleranceHead, tolerance, interiorLabel, buttons);

    const setBusy = (busy: boolean) => {
      apply.disabled = busy;
      apply.textContent = busy ? t('editor.bg.working') : t('editor.bg.apply');
    };

    async function process(commit: boolean): Promise<void> {
      const current = image();
      if (!current) return;
      const original = current.originalSrc ?? current.src;
      const mine = ++run;
      setBusy(true);
      try {
        const src = await removeBackground(original, settings);
        if (mine !== run || !image()) return;
        doc.updateElement(id, { src, originalSrc: original, bgRemoval: { ...settings } });
        if (commit) editor.commit();
      } catch (error) {
        console.warn(error);
      } finally {
        if (mine === run) setBusy(false);
      }
    }

    /** Já removido? Então ajustes reprocessam na hora. */
    const applied = () => image()?.originalSrc !== undefined;

    tolerance.addEventListener('input', () => {
      settings.tolerance = Number(tolerance.value);
      toleranceValue.textContent = tolerance.value;
      if (!applied()) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => void process(false), 120);
    });
    tolerance.addEventListener('change', () => {
      clearTimeout(timer);
      if (applied()) void process(true);
    });
    interior.addEventListener('change', () => {
      settings.interior = interior.checked;
      if (applied()) void process(true);
    });
    apply.addEventListener('click', () => void process(true));
    restore.addEventListener('click', () => {
      const current = image();
      if (!current?.originalSrc) return;
      run += 1;
      doc.updateElement(id, { src: current.originalSrc, originalSrc: undefined, bgRemoval: undefined });
      editor.commit();
    });

    setBusy(false);
    return {
      root,
      sync() {
        const saved = image()?.bgRemoval;
        if (saved) Object.assign(settings, saved);
        tolerance.value = String(settings.tolerance);
        toleranceValue.textContent = tolerance.value;
        interior.checked = settings.interior;
        restore.hidden = !applied();
      },
    };
  }

  /** Botão de cadeado da proporção (fechado = travada). */
  function lockField(get: () => boolean, toggle: () => void): Field {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button lock-toggle';
    button.innerHTML = LOCK_ICONS;
    button.title = t('editor.canvas.lockRatio');
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', toggle);
    return { root: button, sync: () => button.setAttribute('aria-pressed', String(get())) };
  }

  /** Largura · cadeado · altura, alinhados como no painel "Tela". */
  function sizeRow(width: Field, lock: Field, height: Field): Field {
    const root = document.createElement('div');
    root.className = 'size-row';
    root.append(width.root, lock.root, height.root);
    return { root, sync: () => [width, lock, height].forEach((field) => field.sync()) };
  }

  /** Proporção atual (ex.: "16:9"), só leitura. */
  function ratioField(width: () => number | undefined, height: () => number | undefined): Field {
    const root = document.createElement('p');
    root.className = 'ratio-hint';
    return {
      root,
      sync() {
        root.textContent = `${t('editor.props.ratio')}: ${formatRatio(width() ?? 0, height() ?? 0)}`;
      },
    };
  }

  function row(...children: Field[]): Field {
    const root = document.createElement('div');
    root.className = 'field-row';
    root.append(...children.map((child) => child.root));
    return { root, sync: () => children.forEach((child) => child.sync()) };
  }

  // ---- Conjuntos de campos --------------------------------------------------

  function arrangeFields(): Field[] {
    return [
      buttonsField(t('editor.arrange.title'), [
        { icon: ICONS.front, titleKey: 'editor.arrange.front', onClick: () => arrangeSelection(editor, 'front') },
        { icon: ICONS.forward, titleKey: 'editor.arrange.forward', onClick: () => arrangeSelection(editor, 'forward') },
        { icon: ICONS.backward, titleKey: 'editor.arrange.backward', onClick: () => arrangeSelection(editor, 'backward') },
        { icon: ICONS.back, titleKey: 'editor.arrange.back', onClick: () => arrangeSelection(editor, 'back') },
        { icon: ICONS.duplicate, titleKey: 'editor.arrange.duplicate', onClick: () => duplicateSelection(editor) },
        { icon: ICONS.delete, titleKey: 'editor.arrange.delete', onClick: () => deleteSelection(editor), danger: true },
      ]),
    ];
  }

  function singleFields(id: string, type: ElementType): Field[] {
    const current = () => doc.getElement(id) as ElementPatch | undefined;
    const get =
      <K extends keyof ElementPatch>(key: K) =>
      () =>
        current()?.[key];
    const set =
      <K extends keyof ElementPatch>(key: K) =>
      (value: NonNullable<ElementPatch[K]>) =>
        doc.updateElement(id, { [key]: value } as ElementPatch);

    const list: Field[] = [
      heading(t(ELEMENT_LABELS[type])),
      row(numberField('X', get('x'), set('x'), { unit: 'px' }), numberField('Y', get('y'), set('y'), { unit: 'px' })),
    ];

    if (type !== 'text') {
      // Com o cadeado fechado, mudar um lado ajusta o outro na mesma proporção.
      const locked = () => !!get('lockRatio')();
      const ratio = () => {
        const el = current();
        return el?.width && el.height ? el.width / el.height : null;
      };
      const setSide = (side: 'width' | 'height') => (value: number) => {
        const r = ratio();
        if (!locked() || !r) return set(side)(value);
        doc.updateElement(id, side === 'width' ? { width: value, height: value / r } : { width: value * r, height: value });
      };
      list.push(
        sizeRow(
          numberField(t('editor.canvas.width'), get('width'), setSide('width'), { min: 0, unit: 'px' }),
          lockField(locked, () => {
            set('lockRatio')(!locked());
            editor.commit();
          }),
          numberField(t('editor.canvas.height'), get('height'), setSide('height'), { min: 0, unit: 'px' }),
        ),
        ratioField(() => current()?.width, () => current()?.height),
      );
    }

    if (type === 'rectangle' || type === 'ellipse') {
      list.push(colorField(t('editor.props.fill'), get('fill'), set('fill')));
    }

    if (type === 'text') {
      const fontOptions = FONTS.map((font) => ({ value: font.id, label: font.id }));
      list.push(
        selectField<FontId>(t('editor.props.font'), fontOptions, get('fontFamily'), set('fontFamily')),
        row(
          numberField(t('editor.props.fontSize'), get('fontSize'), set('fontSize'), { min: 1, max: 2000, unit: 'px' }),
          buttonsField(t('editor.props.style'), [
            {
              icon: ICONS.bold,
              titleKey: 'editor.props.bold',
              pressed: () => (get('fontWeight')() ?? 400) >= 700,
              onClick: () => {
                set('fontWeight')((get('fontWeight')() ?? 400) >= 700 ? 400 : 700);
                editor.commit();
              },
            },
          ]),
        ),
        buttonsField(
          t('editor.props.alignment'),
          TEXT_ALIGNS.map(({ align, icon, titleKey }) => ({
            icon,
            titleKey,
            pressed: () => get('align')() === align,
            onClick: () => {
              set('align')(align);
              editor.commit();
            },
          })),
        ),
        colorField(t('editor.props.textColor'), get('color'), set('color')),
      );
    }

    if (type !== 'text' && type !== 'image') {
      list.push(
        colorField(t('editor.props.stroke'), get('stroke'), set('stroke')),
        row(
          numberField(t('editor.props.strokeWidth'), get('strokeWidth'), set('strokeWidth'), { min: 0, max: 500, unit: 'px' }),
          ...(type === 'rectangle'
            ? [numberField(t('editor.props.radius'), get('radius'), set('radius'), { min: 0, unit: 'px' })]
            : []),
        ),
      );
    }

    if (type === 'image') list.push(backgroundField(id));

    list.push(rangeField(t('editor.props.opacity'), get('opacity'), set('opacity')), ...arrangeFields());
    return list;
  }

  /** X/Y da seleção inteira; mudar move todos juntos. */
  function selectionPositionFields(): Field {
    const bounds = () => unionBounds(selectedElements(editor)) ?? undefined;
    const moveTo = (axis: 'x' | 'y') => (value: number) => {
      const current = bounds();
      if (!current) return;
      const delta = value - current[axis];
      doc.updateElements(selectedElements(editor).map((el) => [el.id, { [axis]: el[axis] + delta }] as const));
    };
    return row(
      numberField('X', () => bounds()?.x, moveTo('x'), { unit: 'px' }),
      numberField('Y', () => bounds()?.y, moveTo('y'), { unit: 'px' }),
    );
  }

  function groupingField(): Field {
    const hasGroups = groupsInSelection(editor).length > 0;
    const whole = selectedGroup(editor) !== null;
    return buttonsField(t('editor.arrange.grouping'), [
      ...(whole
        ? []
        : [{ icon: ICONS.group, titleKey: 'editor.arrange.group' as const, onClick: () => groupSelection(editor) }]),
      ...(hasGroups
        ? [{ icon: ICONS.ungroup, titleKey: 'editor.arrange.ungroup' as const, onClick: () => ungroupSelection(editor) }]
        : []),
    ]);
  }

  /**
   * Largura/altura do grupo inteiro, com o cadeado do próprio grupo.
   * Mudar um lado escala todos os membros a partir do canto superior esquerdo.
   */
  function groupSizeFields(groupId: string): Field[] {
    const bounds = () => unionBounds(selectedElements(editor)) ?? undefined;
    const locked = () => !!doc.groupMeta(groupId).lockRatio;
    const setSide = (side: 'width' | 'height') => (value: number) => {
      const from = bounds();
      if (!from) return;
      const ratio = from.width && from.height ? from.width / from.height : null;
      let width = side === 'width' ? value : from.width;
      let height = side === 'height' ? value : from.height;
      if (locked() && ratio) {
        if (side === 'width') height = value / ratio;
        else width = value * ratio;
      }
      scaleElements(doc, selectedElements(editor), from, { x: from.x, y: from.y, width, height });
    };
    return [
      sizeRow(
        numberField(t('editor.canvas.width'), () => bounds()?.width, setSide('width'), { min: 1, unit: 'px' }),
        lockField(locked, () => {
          doc.setGroupMeta(groupId, { lockRatio: !locked() });
          editor.commit();
        }),
        numberField(t('editor.canvas.height'), () => bounds()?.height, setSide('height'), { min: 1, unit: 'px' }),
      ),
      ratioField(
        () => bounds()?.width,
        () => bounds()?.height,
      ),
    ];
  }

  function multiFields(count: number): Field[] {
    const group = selectedGroup(editor);
    const title = group ? groupDisplayName(doc, group) : t('editor.selection.count', { count });
    return [
      heading(title),
      selectionPositionFields(),
      ...(group ? groupSizeFields(group) : []),
      groupingField(),
      ...arrangeFields(),
    ];
  }

  // ---- Montagem -------------------------------------------------------------

  function render(force = false): void {
    const selected = selectedElements(editor);
    // Inclui o nome do grupo para o título atualizar ao renomear.
    const group = selectedGroup(editor);
    const key = selected.map((el) => `${el.id}:${el.type}:${el.groupId ?? ''}`).join(',') + (group ? groupDisplayName(doc, group) : '');
    if (force || key !== builtFor) {
      builtFor = key;
      canvasPanel.hidden = selected.length > 0;
      panel.hidden = selected.length === 0;
      fields =
        selected.length === 1
          ? singleFields(selected[0].id, selected[0].type)
          : selected.length > 1
            ? multiFields(selected.length)
            : [];
      panel.replaceChildren(...fields.map((field) => field.root));
    }
    fields.forEach((field) => field.sync());
  }

  selection.onChange(() => render());
  doc.onChange(() => render());
  onLocaleChange(() => render(true));
  render(true);
}
