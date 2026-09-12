import { describe, it, expect } from 'vitest';
import { FrameClock } from '../time/FrameClock';

/**
 * The clock that now owns the frame-delta contract for every consumer.
 *
 * `FrameDeltaContract.test.ts` asserts the contract through the modules; this
 * asserts it on the clock itself, including the edges no consumer exercises.
 */

describe('FrameClock — first sample', () => {
  it('returns 0 and reports itself unstarted beforehand', () => {
    const clock = new FrameClock();
    expect(clock.started).toBe(false);
    expect(clock.last).toBeNull();
    expect(clock.sample(1000)).toBe(0);
    expect(clock.started).toBe(true);
    expect(clock.last).toBe(1000);
  });

  it('treats a timestamp of 0 as an ordinary first sample', () => {
    // The whole reason this class exists: `Engine`'s first rAF stamp is 0, and a
    // `_lastTs === 0` sentinel stays armed through it, so the *second* frame was
    // measured against "unset" and silently dropped or fabricated.
    const clock = new FrameClock();
    expect(clock.sample(0)).toBe(0);
    expect(clock.started).toBe(true);
    expect(clock.sample(100)).toBeCloseTo(0.1, 12);
  });
});

describe('FrameClock — measurement', () => {
  it('reports seconds between samples', () => {
    const clock = new FrameClock();
    clock.sample(1000);
    expect(clock.sample(1016)).toBeCloseTo(0.016, 12);
    expect(clock.sample(1032)).toBeCloseTo(0.016, 12);
  });

  it('clamps a long gap to maxDt and keeps the stamp as the new baseline', () => {
    const clock = new FrameClock();
    clock.sample(1000);
    expect(clock.sample(61_000)).toBe(FrameClock.MOTION_MAX_DT);
    expect(clock.last).toBe(61_000);
    expect(clock.sample(61_016)).toBeCloseTo(0.016, 12);
  });

  it('yields 0 for a backwards stamp, which still becomes the baseline', () => {
    const clock = new FrameClock();
    clock.sample(1000);
    expect(clock.sample(400)).toBe(0);
    expect(clock.last).toBe(400);
    expect(clock.sample(500)).toBeCloseTo(0.1, 12);
  });

  it('yields 0 for a repeated stamp', () => {
    const clock = new FrameClock();
    clock.sample(1000);
    expect(clock.sample(1000)).toBe(0);
  });
});

describe('FrameClock — non-finite stamps', () => {
  it('yields 0 and refuses to become the baseline', () => {
    // A NaN baseline is unrecoverable: every later delta is NaN, and integrating
    // NaN turns a position into NaN for good. Every hand-written version of this
    // derivation propagated it.
    const clock = new FrameClock();
    clock.sample(1000);
    expect(clock.sample(NaN)).toBe(0);
    expect(clock.sample(Infinity)).toBe(0);
    expect(clock.last).toBe(1000);
    // The next real stamp measures from the last good one.
    expect(clock.sample(1100)).toBeCloseTo(0.1, 12);
  });

  it('stays unstarted if the very first stamp is non-finite', () => {
    const clock = new FrameClock();
    expect(clock.sample(NaN)).toBe(0);
    expect(clock.started).toBe(false);
  });
});

describe('FrameClock — reset', () => {
  it('makes the next sample a first frame again', () => {
    const clock = new FrameClock();
    clock.sample(1000);
    clock.sample(1100);
    clock.reset();
    expect(clock.started).toBe(false);
    // A pause must not credit the time spent paused on the frame back.
    expect(clock.sample(99_000)).toBe(0);
    expect(clock.sample(99_016)).toBeCloseTo(0.016, 12);
  });
});

describe('FrameClock — maxDt', () => {
  it('defaults to the motion cap and accepts the timeline cap', () => {
    expect(new FrameClock().maxDt).toBe(FrameClock.MOTION_MAX_DT);
    expect(new FrameClock(FrameClock.TIMELINE_MAX_DT).maxDt)
      .toBe(FrameClock.TIMELINE_MAX_DT);

    const timeline = new FrameClock(FrameClock.TIMELINE_MAX_DT);
    timeline.sample(0);
    expect(timeline.sample(10_000)).toBe(0.5);
  });

  it('falls back to the motion cap for a nonsensical one', () => {
    // A 0 or negative cap would freeze every consumer; NaN would poison it.
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(new FrameClock(bad).maxDt).toBe(FrameClock.MOTION_MAX_DT);
    }
  });
});
