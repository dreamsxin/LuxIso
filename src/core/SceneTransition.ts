/**
 * SceneTransition — canvas-level transition effects between scenes.
 *
 * Works alongside SceneManager: call `playIn()` before switching scenes, keep
 * calling `draw()` in your postFrame callback, then `playOut()` afterwards.
 *
 * The overlay stays fully opaque between the two phases (the `hold` phase), so
 * an async scene load cannot flash the old scene through.
 *
 * Built-in effects: 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'circle-wipe'
 *
 * @example
 *   const transition = new SceneTransition(engine.ctx);
 *
 *   // In postFrame, every frame:
 *   transition.draw(engine.canvasW, engine.canvasH, ts);
 *
 *   // Trigger a fade when switching scenes:
 *   await transition.playIn('fade', { duration: 400 });
 *   await sceneManager.replace('level2');
 *   await transition.playOut('fade', { duration: 400 });
 *
 *   // Or in one call:
 *   await transition.between('fade', () => sceneManager.replace('level2'));
 */

export type TransitionEffect = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'circle-wipe';

export interface TransitionOptions {
  /** Transition color (for fade/wipe). Default '#000000'. */
  color?: string;
  /** Duration in milliseconds. Default 400. */
  duration?: number;
  /** Easing function. Default ease-in-out. */
  easing?: (t: number) => number;
}

const easeInOut = (t: number): number => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

type Phase = 'idle' | 'in' | 'hold' | 'out';

export class SceneTransition {
  private _ctx: CanvasRenderingContext2D;
  private _phase: Phase = 'idle';
  private _effect: TransitionEffect = 'fade';
  private _color = '#000000';
  private _duration = 400;
  private _easing: (t: number) => number = easeInOut;
  private _startTs = 0;
  private _progress = 0; // 0 = transparent, 1 = fully covered
  private _resolve: (() => void) | null = null;

  /** True while a transition is in progress, including the covered hold. */
  get isPlaying(): boolean { return this._phase !== 'idle'; }

  /** Current coverage (0–1). Useful for syncing audio fades. */
  get progress(): number { return this._progress; }

  constructor(ctx: CanvasRenderingContext2D) {
    this._ctx = ctx;
  }

  /**
   * Play the "in" phase (covers the screen).
   *
   * Resolves when the screen is fully covered, and stays covered afterwards
   * until `playOut()` is called — switch your scene content while awaiting,
   * however long the load takes.
   */
  playIn(effect: TransitionEffect = 'fade', opts: TransitionOptions = {}): Promise<void> {
    this._begin('in', effect, opts);
    this._progress = 0;
    return new Promise(resolve => { this._resolve = resolve; });
  }

  /**
   * Play the "out" phase (uncovers the screen).
   * Returns a Promise that resolves when the screen is fully clear.
   */
  playOut(effect: TransitionEffect = 'fade', opts: TransitionOptions = {}): Promise<void> {
    this._begin('out', effect, opts);
    this._progress = 1;
    return new Promise(resolve => { this._resolve = resolve; });
  }

  /**
   * Common setup for both phases.
   *
   * Settling any pending promise matters: `_resolve` used to be overwritten, so
   * starting a second transition while the first was still running left that
   * first promise unsettled forever and any `await` on it hung for good.
   */
  private _begin(phase: Phase, effect: TransitionEffect, opts: TransitionOptions): void {
    const pending = this._resolve;
    this._resolve = null;
    pending?.();

    this._effect   = effect;
    this._color    = opts.color    ?? '#000000';
    this._duration = opts.duration ?? 400;
    this._easing   = opts.easing   ?? easeInOut;
    this._phase    = phase;
    this._startTs  = performance.now();
  }

  /**
   * Convenience: play in → resolve (switch scene here) → play out.
   *
   * @example
   *   await transition.between('fade', async () => {
   *     await sceneManager.replace('level2');
   *   }, { duration: 350 });
   */
  async between(
    effect: TransitionEffect,
    onCovered: () => void | Promise<void>,
    opts: TransitionOptions = {},
  ): Promise<void> {
    await this.playIn(effect, opts);
    await onCovered();
    await this.playOut(effect, opts);
  }

  /**
   * Draw the transition overlay.
   * Call in your postFrame callback every frame.
   */
  draw(canvasW: number, canvasH: number, ts = performance.now()): void {
    if (this._phase === 'idle') return;

    // Fully covered between the two phases: keep painting so an async scene
    // load cannot flash the outgoing scene through.
    if (this._phase === 'hold') {
      this._progress = 1;
      this._drawEffect(canvasW, canvasH, 1);
      return;
    }

    // A non-positive duration is instant, not a division by zero: `0 / 0` is
    // NaN, and `NaN >= 1` is false, so the transition hung forever and
    // `progress` reported NaN.
    const raw = this._duration > 0
      ? Math.min(Math.max(0, (ts - this._startTs) / this._duration), 1)
      : 1;
    const t = this._easing(raw);

    if (this._phase === 'in') {
      this._progress = t;
    } else {
      this._progress = 1 - t;
    }

    this._drawEffect(canvasW, canvasH, this._progress);

    if (raw >= 1) {
      // 'in' hands over to 'hold'; only 'out' returns to idle.
      this._phase = this._phase === 'in' ? 'hold' : 'idle';
      this._progress = this._phase === 'hold' ? 1 : 0;
      const resolve = this._resolve;
      this._resolve = null;
      resolve?.();
    }
  }

  // ── Effect renderers ───────────────────────────────────────────────────────

  private _drawEffect(w: number, h: number, p: number): void {
    if (p <= 0) return;
    const ctx = this._ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    switch (this._effect) {
      case 'fade':
        ctx.globalAlpha = p;
        ctx.fillStyle = this._color;
        ctx.fillRect(0, 0, w, h);
        break;

      case 'slide-left': {
        const x = w * (1 - p);
        ctx.fillStyle = this._color;
        ctx.fillRect(x, 0, w - x, h);
        break;
      }

      case 'slide-right': {
        const x = w * p;
        ctx.fillStyle = this._color;
        ctx.fillRect(0, 0, x, h);
        break;
      }

      case 'slide-up': {
        const y = h * (1 - p);
        ctx.fillStyle = this._color;
        ctx.fillRect(0, y, w, h - y);
        break;
      }

      case 'slide-down': {
        const y = h * p;
        ctx.fillStyle = this._color;
        ctx.fillRect(0, 0, w, y);
        break;
      }

      case 'circle-wipe': {
        const cx = w / 2, cy = h / 2;
        const maxR = Math.hypot(cx, cy);
        // The hole closes as coverage grows. It used to be `maxR * p`, which
        // erased the entire canvas at full coverage — the effect ended fully
        // transparent when it was supposed to be fully opaque.
        const r = maxR * (1 - p);
        ctx.fillStyle = this._color;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
