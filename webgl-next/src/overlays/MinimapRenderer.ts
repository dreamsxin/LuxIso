import type { RenderSnapshot } from '../contracts/RenderSnapshot';

export class MinimapRenderer {
  private readonly _context: CanvasRenderingContext2D;

  constructor(private readonly _canvas: HTMLCanvasElement) {
    const context = _canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for the minimap overlay.');
    this._context = context;
  }

  render(snapshot: RenderSnapshot): void {
    const source = snapshot.minimap;
    const rect = this._canvas.getBoundingClientRect();
    // Nothing has laid the canvas out yet: a zero-size rect used to produce a
    // 1x1 backing store and a full frame of drawing commands nobody could see.
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = typeof window === 'undefined'
      ? 1
      : Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
    const ctx = this._context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = 'rgba(10, 14, 18, 0.88)';
    ctx.fillRect(0, 0, rect.width, rect.height);

    const cellW = rect.width / Math.max(1, source.cols);
    const cellH = rect.height / Math.max(1, source.rows);
    for (let row = 0; row < source.rows; row++) {
      for (let col = 0; col < source.cols; col++) {
        ctx.fillStyle = source.walkable[row * source.cols + col] ? '#30483e' : '#481f27';
        ctx.fillRect(col * cellW, row * cellH, cellW - 0.5, cellH - 0.5);
      }
    }

    for (const item of source.items) {
      const x = item.x * cellW;
      const y = item.y * cellH;
      ctx.beginPath();
      ctx.arc(x, y, item.character ? 3.5 : 2.25, 0, Math.PI * 2);
      ctx.fillStyle = item.character ? '#64d39a' : '#e3aa62';
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(0.5, 0.5, rect.width - 1, rect.height - 1);
  }
}
