/**
 * WaveformRenderer — plain JS canvas waveform renderer.
 * No React dependency. React just mounts the canvas and calls init/update.
 * Observes the INNER div (which changes width on zoom) for resize.
 */

export class WaveformRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bars: number[] = [];
  private inner: HTMLElement | null = null; // the zoomable inner div (changes width)
  private ro: ResizeObserver | null = null;
  private dpr = 1;
  private rafPending = false;

  /**
   * Initialize: attach to canvas element.
   * @param canvas — the <canvas> to draw on
   * @param inner — the inner div that changes width on zoom (widthPct)
   */
  init(canvas: HTMLCanvasElement, inner: HTMLElement): void {
    this.canvas = canvas;
    this.inner = inner;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // ResizeObserver on INNER div — fires when widthPct changes (zoom)
    this.ro = new ResizeObserver(() => {
      this.scheduleRender();
    });
    this.ro.observe(inner);

    // Initial render
    this.scheduleRender();
  }

  /** Update waveform data (bars array 0..1) */
  setData(bars: number[]): void {
    this.bars = bars;
    this.scheduleRender();
  }

  /** Force redraw (e.g. after zoom change) */
  redraw(): void {
    this.scheduleRender();
  }

  /** Schedule render on next animation frame (dedup) */
  private scheduleRender(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.render();
    });
  }

  /** Main render — reads inner div width, sets canvas buffer AND CSS width, draws bars */
  private render(): void {
    if (!this.canvas || !this.ctx || !this.inner) return;

    // Width = inner div's actual rendered width (follows zoom via widthPct)
    const w = this.inner.offsetWidth;
    const h = 60;

    if (w === 0) return; // not visible yet

    // CSS width = inner width (so canvas fills the track exactly)
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    // Set canvas drawing buffer to match (× DPR for crispness)
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

  /** Cleanup — disconnect observers */
  destroy(): void {
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.inner = null;
    this.bars = [];
    this.rafPending = false;
  }
}