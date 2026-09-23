import { onLocaleChange, t } from '../i18n';

export type Theme = 'light' | 'dark';

// O tema inicial é aplicado por um script inline no <head> de cada página
// (antes do CSS, para não piscar). Ele usa esta mesma chave.
const STORAGE_KEY = 'jatai.theme';

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

type Listener = (theme: Theme) => void;
const listeners = new Set<Listener>();

function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  listeners.forEach((listener) => listener(theme));
}

/** Aplica e salva a escolha do usuário. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // sem persistência; vale só nesta página
  }
  applyTheme(theme);
}

export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Sem escolha salva, acompanha o tema do sistema em tempo real.
systemDark.addEventListener('change', (event) => {
  if (!savedTheme()) applyTheme(event.matches ? 'dark' : 'light');
});

const SUN_ICON =
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON_ICON = '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>';

/** Monta um botão de alternar tema em cada elemento com [data-theme-toggle]. */
export function mountThemeToggles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((host) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button theme-toggle';
    button.addEventListener('click', toggleTheme);

    const render = () => {
      // Mostra o ícone do tema para o qual o clique vai mudar.
      const dark = getTheme() === 'dark';
      const label = t(dark ? 'common.theme.toLight' : 'common.theme.toDark');
      button.title = label;
      button.setAttribute('aria-label', label);
      button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? SUN_ICON : MOON_ICON}</svg>`;
    };

    render();
    onThemeChange(render);
    onLocaleChange(render);
    host.replaceChildren(button);
  });
}
