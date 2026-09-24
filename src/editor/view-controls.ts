import { onLocaleChange, t } from '../i18n';

/**
 * Tela cheia e giro da tela (celular). Os botões só aparecem onde o
 * navegador suporta: o iPhone, por exemplo, não permite tela cheia nem
 * travar a orientação em páginas, então lá ficam escondidos.
 */

type OrientationLock = (orientation: 'portrait' | 'landscape') => Promise<void>;

interface FullscreenDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

const doc = document as FullscreenDocument;

const fullscreenSupported = () => Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
const isFullscreen = () => Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);

function orientationLock(): OrientationLock | null {
  const orientation = screen.orientation as ScreenOrientation & { lock?: OrientationLock };
  // Travar a orientação só faz sentido (e só funciona) em aparelhos de toque.
  if (typeof orientation?.lock !== 'function') return null;
  if (!window.matchMedia('(pointer: coarse)').matches) return null;
  return orientation.lock.bind(orientation);
}

async function enterFullscreen(): Promise<void> {
  const root = document.documentElement as FullscreenElement;
  if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
  else await root.webkitRequestFullscreen?.();
}

async function exitFullscreen(): Promise<void> {
  if (document.exitFullscreen) await document.exitFullscreen();
  else await doc.webkitExitFullscreen?.();
}

/** Liga os botões #fullscreen e #rotate. `onViewChange` roda quando a tela muda de tamanho/orientação. */
export function mountViewControls(onViewChange: () => void): void {
  const fullscreen = document.querySelector<HTMLButtonElement>('#fullscreen')!;
  const rotate = document.querySelector<HTMLButtonElement>('#rotate')!;
  const lock = orientationLock();

  fullscreen.hidden = !fullscreenSupported();
  rotate.hidden = !lock || !fullscreenSupported();

  function render(): void {
    const active = isFullscreen();
    fullscreen.setAttribute('aria-pressed', String(active));
    fullscreen.title = t(active ? 'editor.view.exitFullscreen' : 'editor.view.fullscreen');
    fullscreen.setAttribute('aria-label', fullscreen.title);
    rotate.title = t('editor.view.rotate');
    rotate.setAttribute('aria-label', rotate.title);
  }

  fullscreen.addEventListener('click', () => {
    (isFullscreen() ? exitFullscreen() : enterFullscreen()).catch((error) => console.warn(error));
  });

  // Girar: a trava de orientação exige tela cheia, então entra nela antes.
  rotate.addEventListener('click', async () => {
    if (!lock) return;
    try {
      if (!isFullscreen()) await enterFullscreen();
      const portrait = screen.orientation.type.startsWith('portrait');
      await lock(portrait ? 'landscape' : 'portrait');
    } catch (error) {
      console.warn(error);
    }
  });

  // Depois que a tela assenta no novo tamanho, reenquadra o design.
  const settle = () => requestAnimationFrame(() => requestAnimationFrame(onViewChange));
  document.addEventListener('fullscreenchange', () => {
    render();
    settle();
  });
  document.addEventListener('webkitfullscreenchange', () => {
    render();
    settle();
  });
  // A mídia "orientation" muda em todo navegador ao girar (o evento de
  // screen.orientation nem sempre dispara), então reage aos dois.
  screen.orientation?.addEventListener('change', settle);
  window.matchMedia('(orientation: landscape)').addEventListener('change', settle);

  onLocaleChange(render);
  render();
}
