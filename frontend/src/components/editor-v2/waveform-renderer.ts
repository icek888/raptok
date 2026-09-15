/**
 * WaveformRenderer — plain JS canvas waveform renderer.
 * No React dependency. React just mounts the canvas and calls init/update.
 * Handles its own sizing, zoom, and animation loop.
 */

export class WaveformRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bars: number[] = [];
  private container: HTMLElement | null = null;
  private rafId: number | null = null;
  private ro: ResizeObserver | null = null;
  private dpr = 1;
  private lastWidth = 0;

  /** Initialize: attach to canvas element, observe container for resize */
  init(canvas: HTMLCanvasElement, container: HTMLElement): void {
    this.canvas = canvas;
    this.container = container;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // ResizeObserver on container — redraw when size changes (zoom, window resize)
    this.ro = new ResizeObserver(() => this.render());
    this.ro.observe(container);

    // Initial render
    this.render();
  }

  /** Update waveform data (bars array 0..1) */
  setData(bars: number[]): void {
    this.bars = bars;
    this.render();
  }

  /** Force redraw (e.g. after zoom change) — deferred to next frame so DOM has updated */
  redraw(): void {
    requestAnimationFrame(() => this.render());
  }

  /** Main render — reads container width, sets canvas buffer, draws bars */
  private render(): void {
    if (!this.canvas || !this.ctx || !this.container) return;

    // Get actual rendered width of container (follows zoom via widthPct)
    const w = this.container.offsetWidth;
    const h = 60;

    // Skip if width hasn't changed and we have no new data
    if (w === this.lastWidth && this.bars.length === 0) return;
    this.lastWidth = w;

    // Set canvas drawing buffer to match container width (× DPR for crispness)
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);

    // Scale context for DPR
    this.ctx.save();
    this.ctx.scale(this.dpr, this.dpr);

    // Clear
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, w, h);

    // Draw waveform bars
    if (this.bars.length === 0) {
      this.ctx.restore();
      return;
    }

    const barWidth = w / this.bars.length;
    this.ctx.fillStyle = '#3b82f6'; // blue-500

    for (let i = 0; i < this.bars.length; i++) {
      const x = i * barWidth;
      const barH = this.bars[i] * h * 0.8;
      const y = (h - barH) / 2;
      this.ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barH);
    }

    this.ctx.restore();
  }

  /** Cleanup — disconnect observers, cancel animation */
  destroy(): void {
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.bars = [];
  }
}