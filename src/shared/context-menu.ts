export interface MenuItem {
  label: string;
  /** Atalho mostrado à direita (só informativo). */
  shortcut?: string;
  danger?: boolean;
  onSelect(): void;
}

/** Separador entre grupos de itens. */
export const SEPARATOR = 'separator';

export type MenuEntry = MenuItem | typeof SEPARATOR;

let close: (() => void) | null = null;

/**
 * Abre um menu de contexto em (x, y) da janela. Fecha ao escolher um item,
 * clicar fora, apertar Esc, rolar ou redimensionar. Setas navegam.
 */
export function openContextMenu(x: number, y: number, entries: readonly MenuEntry[]): void {
  close?.();
  if (!entries.some((entry) => entry !== SEPARATOR)) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');

  const buttons: HTMLButtonElement[] = [];
  for (const entry of entries) {
    if (entry === SEPARATOR) {
      const line = document.createElement('div');
      line.className = 'context-menu-separator';
      line.setAttribute('role', 'separator');
      menu.append(line);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = entry.danger ? 'context-menu-item danger' : 'context-menu-item';
    button.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = entry.label;
    button.append(label);
    if (entry.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.textContent = entry.shortcut;
      button.append(kbd);
    }
    button.addEventListener('click', () => {
      dismiss();
      entry.onSelect();
    });
    menu.append(button);
    buttons.push(button);
  }

  document.body.append(menu);

  // Mantém o menu dentro da janela.
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  buttons[0]?.focus();

  const onPointerDown = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) dismiss();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length].focus();
    }
  };

  function dismiss(): void {
    menu.remove();
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', dismiss);
    window.removeEventListener('wheel', dismiss, true);
    window.removeEventListener('blur', dismiss);
    close = null;
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', dismiss);
  window.addEventListener('wheel', dismiss, true);
  window.addEventListener('blur', dismiss);
  close = dismiss;
}
