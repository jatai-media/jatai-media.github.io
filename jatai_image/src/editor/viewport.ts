export const ZOOM_LIMITS = { min: 0.02, max: 32 } as const;
const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

type Listener = () => void;

/**
 * Câmera da área de trabalho. Converte coordenadas do documento (px do design)
 * para a tela (px CSS dentro do stage):  tela = documento × zoom + pan
 */
export class Viewport {
  zoom = 1;
  panX = 0;
  panY = 0;
  private listeners = new Set<Listener>();

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY };
  }

  toDocument(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.panX) / this.zoom, y: (y - this.panY) / this.zoom };
  }

  /** Muda o zoom mantendo fixo o ponto da tela (anchorX, anchorY). */
  setZoom(zoom: number, anchorX: number, anchorY: number): void {
    const next = Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom));
    if (next === this.zoom) return;
    const anchor = this.toDocument(anchorX, anchorY);
    this.zoom = next;
    this.panX = anchorX - anchor.x * next;
    this.panY = anchorY - anchor.y * next;
    this.emit();
  }

  /** Vai para o próximo nível de zoom "redondo" (25%, 50%, 100%...). */
  stepZoom(direction: 1 | -1, anchorX: number, anchorY: number): void {
    const epsilon = 0.001;
    const next =
      direction > 0
        ? ZOOM_STEPS.find((step) => step > this.zoom + epsilon)
        : [...ZOOM_STEPS].reverse().find((step) => step < this.zoom - epsilon);
    if (next) this.setZoom(next, anchorX, anchorY);
  }

  panBy(dx: number, dy: number): void {
    if (!dx && !dy) return;
    this.panX += dx;
    this.panY += dy;
    this.emit();
  }

  /** Enquadra um retângulo de w×h (documento) centralizado numa área de viewW×viewH (tela). */
  fit(width: number, height: number, viewWidth: number, viewHeight: number, padding = 48): void {
    this.fitRect({ x: 0, y: 0, width, height }, viewWidth, viewHeight, padding);
  }

  /** Enquadra um retângulo qualquer do documento (ex.: a seleção). */
  fitRect(
    rect: { x: number; y: number; width: number; height: number },
    viewWidth: number,
    viewHeight: number,
    padding = 48,
  ): void {
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const zoom = Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height);
    this.zoom = Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom));
    this.panX = (viewWidth - width * this.zoom) / 2 - rect.x * this.zoom;
    this.panY = (viewHeight - height * this.zoom) / 2 - rect.y * this.zoom;
    this.emit();
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
