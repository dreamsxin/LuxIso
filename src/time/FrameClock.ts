/**
 * FrameClock — the frame-delta contract, once.
 *
 * Every module that derives its own `dt` from a timestamp used to hand-write the
 * same three lines, and the same defect kept coming back with them: `_lastTs = 0`
 * as a first-frame sentinel, which collides with `Engine`'s genuine first
 * timestamp of 0 and so never disarms. That bug was found and fixed twelve times
 * across eleven modules before this class existed, each time with its own
 * regression test, because a per-module test cannot fail for a module nobody has
 * written yet.
 *
 * The rules, all four of which production code has violated at least once:
 *
 *   1. A timestamp of 0 is an ordinary first frame. The sentinel is `null`.
 *   2. Time going backwards yields 0, never a negative delta.
 *   3. A long gap — a hidden tab, a breakpoint — is clamped, not integrated.
 *   4. A non-finite timestamp yields 0 and does not poison the baseline.
 *
 * `src/__tests__/FrameDeltaContract.test.ts` asserts all four for every consumer.
 *
 * @example
 *   private _clock = new FrameClock();          // 100 ms cap, for motion
 *   update(ts?: number): void {
 *     const dt = this._clock.sample(ts ?? performance.now());
 *     this.position.x += this.speed * dt;
 *   }
 */
export class FrameClock {
  /** Cap for anything that moves. A longer frame teleports things. */
  static readonly MOTION_MAX_DT = 0.1;
  /** Cap for timers and tweens, which tolerate a coarser catch-up. */
  static readonly TIMELINE_MAX_DT = 0.5;

  readonly maxDt: number;
  private _last: number | null = null;

  constructor(maxDt: number = FrameClock.MOTION_MAX_DT) {
    this.maxDt = Number.isFinite(maxDt) && maxDt > 0 ? maxDt : FrameClock.MOTION_MAX_DT;
  }

  /** Whether a timestamp has been sampled since construction or `reset()`. */
  get started(): boolean { return this._last !== null; }

  /** The last sampled timestamp in milliseconds, or null before the first. */
  get last(): number | null { return this._last; }

  /**
   * Seconds elapsed since the previous sample, clamped to `[0, maxDt]`.
   *
   * Returns 0 on the first sample after construction or `reset()`, so a caller
   * that integrates `dt` advances nothing on its first frame.
   */
  sample(ts: number): number {
    // A non-finite stamp is not a measurement: it must not become the baseline,
    // or every later frame would measure against NaN and integrate NaN forever.
    if (!Number.isFinite(ts)) return 0;
    const previous = this._last;
    this._last = ts;
    if (previous === null) return 0;
    return Math.min(Math.max(0, (ts - previous) / 1000), this.maxDt);
  }

  /**
   * Forget the baseline; the next `sample()` is a first frame again.
   *
   * This is what a pause or a restart needs. Leaving a stale baseline in place is
   * how a resumed timer used to be credited with the entire time it spent paused.
   */
  reset(): void { this._last = null; }
}
