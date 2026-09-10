import { Component } from '../Component';

/**
 * TimerComponent — fires a callback after a delay, optionally repeating.
 *
 * @example
 *   entity.addComponent(new TimerComponent({
 *     duration: 3,
 *     repeat: true,
 *     onTick: () => console.log('3 seconds passed'),
 *   }));
 */
export interface TimerOptions {
  /** Duration in seconds before the callback fires. */
  duration: number;
  /** If true, the timer resets and fires repeatedly. Default false. */
  repeat?: boolean;
  /** Called each time the timer completes one cycle. */
  onTick?: () => void;
  /** Called when a non-repeating timer finishes (alias for onTick on one-shot timers). */
  onComplete?: () => void;
  /** If false, the timer starts paused. Default true. */
  autoStart?: boolean;
}

export class TimerComponent implements Component {
  readonly componentType = 'timer' as const;

  duration: number;
  repeat:   boolean;

  private _elapsed  = 0;
  private _running: boolean;
  private _done     = false;
  private _lastTs: number | null = null;
  private _onTick:  (() => void) | undefined;
  private _onComplete: (() => void) | undefined;

  constructor(opts: TimerOptions) {
    this.duration    = opts.duration;
    this.repeat      = opts.repeat    ?? false;
    this._onTick     = opts.onTick;
    this._onComplete = opts.onComplete;
    this._running    = opts.autoStart ?? true;
  }

  get elapsed():  number  { return this._elapsed; }
  get fraction(): number  { return Math.min(1, this._elapsed / this.duration); }
  get isDone():   boolean { return this._done; }
  get isRunning():boolean { return this._running; }

  start():  void { this._running = true; this._done = false; }
  /**
   * Stop advancing. The clock is re-baselined on resume, so time spent paused
   * is not credited to the timer — without that, a stale `_lastTs` turned the
   * pause into a jump of up to the dt clamp (0.5 s) on the first frame back.
   */
  pause():  void { this._running = false; this._lastTs = null; }
  reset():  void { this._elapsed = 0; this._done = false; }
  restart():void { this._elapsed = 0; this._done = false; this._running = true; this._lastTs = null; }

  update(ts?: number): void {
    if (!this._running || this._done) return;
    const now = ts ?? performance.now();
    // `null`, not 0: a timestamp of 0 is legitimate, and the old
    // `_lastTs === 0` sentinel stayed armed through it, dropping the next frame.
    const dt = this._lastTs === null
      ? 0
      : Math.min(Math.max(0, (now - this._lastTs) / 1000), 0.5);
    this._lastTs = now;
    if (dt === 0) return;

    this._elapsed += dt;

    if (this.duration <= 0) {
      // No meaningful period — fire once per update rather than spinning
      // forever trying to drain the accumulator.
      this._complete();
      return;
    }

    // `while`, not `if`: one frame can span several periods (a 50 ms cooldown on
    // a 200 ms frame owes four ticks). Firing once per frame silently capped a
    // repeating timer at the frame rate and let the leftover grow every frame.
    while (this._running && !this._done && this._elapsed >= this.duration) {
      if (this.repeat) {
        this._onTick?.();
        this._elapsed -= this.duration;
      } else {
        this._elapsed = this.duration;
        this._complete();
      }
    }
  }

  private _complete(): void {
    this._onTick?.();
    if (this.repeat) return;
    this._done    = true;
    this._running = false;
    this._onComplete?.();
  }
}
