import type { HudLayer } from '../../../src/core/HudLayer';

export interface HudOverlayOptions {
  /**
   * Upper bound for the backing-store scale. Default 2, matching
   * `Engine.maxPixelRatio` — a 3x phone would otherwise pay for a HUD texture
   * nobody can tell apart from 2x.
   */
  maxPixelRatio?: number;
  /**
   * Extra painting on the same canvas, after the HUD, with the backing-store
   * transform already installed so the callback works in logical pixels.
   *
   * `HudLayer` has no element type for a `TouchStick` (or any other widget that
   * draws itself), and without a hook here every game had to fetch the 2D context
   * behind this renderer's back and re-derive the device-pixel ratio to draw one.
   *
   * @example
   *   new HudOverlayRenderer(canvas, hud, { paint: (ctx) => stick.draw(ctx) });
   */
  paint?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

/**
 * HudOverlayRenderer — draws a `HudLayer` on a 2D canvas stacked over the GL one.
 *
 * The WebGL2 path had no UI layer at all: `HudLayer` is Canvas2D, and the
 * preview page hand-rolled its labels as DOM. A game on this backend therefore
 * had to build its own overlay before it could show a health bar. Rather than
 * port the HUD to shaders, this mounts the existing (and tested) `HudLayer` on a
 * transparent 2D canvas above the GL canvas: same widgets, same input
 * arbitration, no second implementation to keep in sync.
 *
 * Input is *not* read from this canvas. `pointerEvents` is forced off, because a
 * canvas covering the viewport would otherwise swallow every tap before the game
 * canvas saw it. Feed `HudLayer.update(input, isTaken)` from the same
 * `InputManager` the game already uses.
 *
 * @example
 *   const hud = new HudLayer();
 *   hud.addBar({ id: 'hp', x: 16, y: 16, w: 160, h: 14, color: '#e04040' });
 *   const overlay = new HudOverlayRenderer(hudCanvas, hud);
 *
 *   // Per frame, after renderer.render(snapshot):
 *   hud.update(input, (id) => id === stick.touchId);
 *   overlay.render();
 */
export class HudOverlayRenderer {
  private readonly _context: CanvasRenderingContext2D;
  private readonly _maxPixelRatio: number;
  private readonly _paint?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  private _pixelRatio = 1;

  constructor(
    private readonly _canvas: HTMLCanvasElement,
    private readonly _hud: HudLayer,
    opts: HudOverlayOptions = {},
  ) {
    const context = _canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is required for the HUD overlay.');
    this._context = context;
    this._maxPixelRatio = Math.max(1, opts.maxPixelRatio ?? 2);
    this._paint = opts.paint;

    if (_canvas.style) _canvas.style.pointerEvents = 'none';
    // A getter, not a value: the ratio changes when the window moves between
    // displays, and `HudLayer.draw` reads it on every frame.
    this._hud.pixelRatio = () => this._pixelRatio;
  }

  /** Backing-store scale currently applied. */
  get pixelRatio(): number {
    return this._pixelRatio;
  }

  /**
   * Size the canvas to its CSS box, clear it, and draw the HUD.
   *
   * Call once per frame after the GL render. A canvas that has not been laid out
   * yet (0x0 box) is skipped rather than turned into a 1x1 backing store.
   */
  render(): void {
    const rect = this._canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dpr = typeof window === 'undefined'
      ? 1
      : Math.max(1, Math.min(this._maxPixelRatio, window.devicePixelRatio || 1));
    this._pixelRatio = dpr;

    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width;
      this._canvas.height = height;
    }

    const ctx = this._context;
    // Clear in device pixels: `HudLayer.draw` installs the DPR transform itself,
    // so clearing under its transform would miss the right/bottom edges.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this._hud.draw(ctx, rect.width, rect.height);

    if (!this._paint) return;
    // Same logical-pixel space the HUD just drew in, and isolated with
    // save/restore so a careless painter cannot leak state into the next frame.
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paint(ctx, rect.width, rect.height);
    ctx.restore();
  }

  /** Clear the overlay and drop any in-flight HUD press state. */
  dispose(): void {
    this._hud.resetInput();
    const ctx = this._context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Math.max(1, this._canvas.width), Math.max(1, this._canvas.height));
  }
}
