import { IsoObject } from '../../elements/IsoObject';
import { Component } from '../Component';
import { FrameClock } from '../../time/FrameClock';

/** Easing functions — all take t in [0,1] and return a value in [0,1]. */
export const Easing = {
  linear:     (t: number) => t,
  easeIn:     (t: number) => t * t,
  easeOut:    (t: number) => 1 - (1 - t) * (1 - t),
  easeInOut:  (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeInCubic:(t: number) => t * t * t,
  easeOutCubic:(t: number) => 1 - Math.pow(1 - t, 3),
  bounce:     (t: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1)       return n1 * t * t;
    if (t < 2 / d1)       return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1)     return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  elastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI) / 3);
  },
} as const;

export type EasingFn = (t: number) => number;

export interface TweenTarget {
  /** Property path on the owner's position, e.g. 'x', 'y', 'z'. */
  prop: 'x' | 'y' | 'z';
  from: number;
  to:   number;
}

export interface TweenOptions {
  /** Properties to animate on owner.position. */
  targets: TweenTarget[];
  /** Duration in seconds. */
  duration: number;
  /** Easing function. Default linear. */
  easing?: EasingFn;
  /**
   * Called every frame with the current eased value (0–1).
   * Use this to animate anything beyond position (colors, opacity, scale, etc.).
   * @example
   *   onUpdate: (v) => { myObj.alpha = v; }
   */
  onUpdate?: (easedValue: number) => void;
  /** Called when the tween completes. */
  onComplete?: () => void;
  /** If true, ping-pong between from and to. Default false. */
  yoyo?: boolean;
  /** Number of times to repeat (0 = once, -1 = infinite). Default 0. */
  repeat?: number;
  /** Delay before starting in seconds. Default 0. */
  delay?: number;
}

/**
 * TweenComponent — smoothly animates numeric properties on the owner's position.
 *
 * @example
 *   entity.addComponent(new TweenComponent({
 *     targets: [{ prop: 'z', from: 0, to: 48 }],
 *     duration: 0.5,
 *     easing: Easing.easeOut,
 *     onComplete: () => console.log('bounce done'),
 *   }));
 */
export class TweenComponent implements Component {
  readonly componentType = 'tween' as const;

  private _opts:     TweenOptions;
  private _elapsed   = 0;
  private _delay     = 0;
  private _done      = false;
  private _running   = true;
  private _iteration = 0;
  private _forward   = true;
  private _owner:    IsoObject | null = null;
  private _clock = new FrameClock(FrameClock.TIMELINE_MAX_DT);

  constructor(opts: TweenOptions) {
    this._opts  = opts;
    this._delay = opts.delay ?? 0;
  }

  onAttach(owner: IsoObject): void { this._owner = owner; }
  onDetach(): void                 { this._owner = null; }

  get isDone():    boolean { return this._done; }
  get isRunning(): boolean { return this._running; }
  get progress():  number  { return Math.min(1, this._elapsed / this._opts.duration); }

  /**
   * Stop advancing. The clock is re-baselined on `resume()`, so time spent
   * paused is not credited — otherwise the first frame back jumped by up to the
   * dt clamp (0.5 s).
   */
  pause():   void { this._running = false; this._clock.reset(); }
  resume():  void { this._running = true; }
  restart(): void {
    this._elapsed = 0;
    this._done = false;
    this._running = true;
    this._iteration = 0;
    this._forward = true;
    this._delay = this._opts.delay ?? 0;
    // `reset()`, not a stamp of 0: with 0 the next frame's delta was measured
    // against timestamp 0 and clamped to 0.5 s, so a restarted tween instantly
    // leapt half a second in.
    this._clock.reset();
  }

  update(ts?: number): void {
    if (!this._owner || !this._running || this._done) return;

    const now = ts ?? performance.now();
    const first = !this._clock.started;
    let dt = this._clock.sample(now);
    if (first) return;

    // Handle delay, carrying whatever is left of this frame into the tween.
    // Discarding the remainder made every delayed tween start a frame late.
    if (this._delay > 0) {
      const consumed = Math.min(this._delay, dt);
      this._delay -= consumed;
      dt -= consumed;
      if (dt <= 0) return;
    }

    this._elapsed += dt;
    const raw = Math.min(1, this._elapsed / this._opts.duration);
    const eased = (this._opts.easing ?? Easing.linear)(this._forward ? raw : 1 - raw);

    // Apply to owner position
    const pos = this._owner.position;
    for (const t of this._opts.targets) {
      pos[t.prop] = t.from + (t.to - t.from) * eased;
    }
    // Fire onUpdate with current eased value
    this._opts.onUpdate?.(eased);

    if (raw >= 1) {
      const repeat = this._opts.repeat ?? 0;
      const yoyo   = this._opts.yoyo   ?? false;

      this._iteration++;
      // Carry the overshoot into the next cycle instead of zeroing it: a frame
      // that spans a cycle boundary owes the remainder to the new cycle, and
      // dropping it made every repeat run slower than its duration.
      this._elapsed = Math.max(0, this._elapsed - this._opts.duration);

      const maxIter = repeat === -1 ? Infinity : repeat + 1;
      if (this._iteration >= maxIter) {
        // Snap to the end of the current (pre-flip) direction
        for (const t of this._opts.targets) {
          pos[t.prop] = this._forward ? t.to : t.from;
        }
        this._elapsed = 0;
        this._done    = true;
        this._running = false;
        this._opts.onComplete?.();
      } else if (yoyo) {
        this._forward = !this._forward;
      }
    }
  }
}
