import { describe, it, expect, vi } from 'vitest';
import { TweenComponent, Easing, type TweenOptions } from '../ecs/components/TweenComponent';
import { IsoObject } from '../elements/IsoObject';

/**
 * TweenComponent timing.
 *
 * Tweens drive hit reactions, chest lids and UI pops, so a tween that jumps
 * half a second on restart, or loses time across a repeat boundary, shows up as
 * animation that visibly skips.
 */

function owner(x = 0, y = 0, z = 0): IsoObject {
  return {
    id: 'e',
    position: { x, y, z },
    aabb: { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 },
    draw: () => {},
  } as unknown as IsoObject;
}

function tween(opts: Partial<TweenOptions> = {}) {
  const o = owner();
  const tw = new TweenComponent({
    targets: [{ prop: 'z', from: 0, to: 100 }],
    duration: 1,
    easing: Easing.linear,
    ...opts,
  });
  tw.onAttach(o);
  return { tw, o };
}

describe('TweenComponent — frame delta', () => {
  it('does not advance on the first frame', () => {
    const { tw, o } = tween();
    tw.update(1000);
    expect(o.position.z).toBe(0);
    expect(tw.progress).toBe(0);
  });

  it('measures the real delta on the second frame', () => {
    const { tw, o } = tween();
    tw.update(1000);
    tw.update(1250);
    expect(o.position.z).toBeCloseTo(25, 6);
  });

  it('works when the first timestamp is 0', () => {
    const { tw, o } = tween();
    tw.update(0);
    tw.update(250);
    expect(o.position.z).toBeCloseTo(25, 6);
  });

  it('never runs backwards on a backwards timestamp', () => {
    const { tw, o } = tween();
    tw.update(1000);
    tw.update(1250);
    tw.update(500);
    expect(o.position.z).toBeCloseTo(25, 6);
  });

  it('restart does not jump forward', () => {
    const { tw, o } = tween();
    tw.update(1000);
    tw.update(1500);
    expect(o.position.z).toBeCloseTo(50, 6);

    tw.restart();
    // `restart()` used to reset the clock to 0 rather than "unset", so the next
    // frame's delta was measured against timestamp 0 and clamped to the 0.5 s
    // ceiling — the tween leapt straight back to the halfway point.
    tw.update(9000);
    expect(tw.progress).toBe(0);

    tw.update(9100);
    expect(o.position.z).toBeCloseTo(10, 6);
  });

  it('pause does not credit the time spent paused', () => {
    const { tw, o } = tween();
    tw.update(1000);
    tw.update(1100);
    expect(o.position.z).toBeCloseTo(10, 6);

    tw.pause();
    tw.update(20_000); // ignored while paused
    tw.resume();
    tw.update(20_100); // re-baselines the clock
    tw.update(20_200);
    // 19 s of wall clock passed while paused; only the 100 ms after the
    // baseline frame may count. Before the fix the stale timestamp added the
    // full 0.5 s clamp.
    expect(o.position.z).toBeCloseTo(20, 6);
  });
});

describe('TweenComponent — delay', () => {
  it('carries the leftover of the frame that ends the delay', () => {
    const { tw, o } = tween({ delay: 0.1 });
    tw.update(1000);
    // 300 ms frame: 100 ms is the delay, the remaining 200 ms belongs to the
    // tween. Discarding it made every delayed tween start late.
    tw.update(1300);
    expect(o.position.z).toBeCloseTo(20, 6);
  });

  it('does not start before the delay elapses', () => {
    const { tw, o } = tween({ delay: 0.5 });
    tw.update(1000);
    tw.update(1200);
    expect(o.position.z).toBe(0);
  });
});

describe('TweenComponent — repeat and yoyo', () => {
  it('carries the overshoot across a repeat boundary', () => {
    const { tw, o } = tween({ duration: 0.2, repeat: 2 });
    tw.update(1000);
    // 300 ms covers the first 200 ms cycle plus 100 ms of the second, so the
    // second cycle must already be halfway through. Zeroing `_elapsed` at the
    // boundary threw that remainder away and made every repeat run slow.
    tw.update(1300);
    expect(o.position.z).toBe(100); // this frame still lands on the cycle end
    expect(tw.progress).toBeCloseTo(0.5, 6);

    tw.update(1301);
    expect(o.position.z).toBeLessThan(60);
  });

  it('yoyo reverses and lands back at the start', () => {
    const { tw, o } = tween({ duration: 0.2, yoyo: true, repeat: 1 });
    tw.update(1000);
    tw.update(1200); // end of the forward pass
    tw.update(1400); // end of the reverse pass
    expect(o.position.z).toBeCloseTo(0, 6);
    expect(tw.isDone).toBe(true);
  });

  it('snaps to the end value and reports done', () => {
    const onComplete = vi.fn();
    const { tw, o } = tween({ duration: 0.2, onComplete });
    tw.update(1000);
    tw.update(1500);
    expect(o.position.z).toBe(100);
    expect(tw.isDone).toBe(true);
    expect(tw.isRunning).toBe(false);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('stops updating once done', () => {
    const onUpdate = vi.fn();
    const { tw } = tween({ duration: 0.1, onUpdate });
    tw.update(1000);
    tw.update(1200);
    const calls = onUpdate.mock.calls.length;
    tw.update(1400);
    expect(onUpdate.mock.calls.length).toBe(calls);
  });

  it('repeat: -1 never finishes', () => {
    const { tw } = tween({ duration: 0.1, repeat: -1 });
    let ts = 1000;
    for (let i = 0; i < 30; i++) { tw.update(ts); ts += 100; }
    expect(tw.isDone).toBe(false);
  });

  it('does nothing without an owner', () => {
    const tw = new TweenComponent({ targets: [{ prop: 'z', from: 0, to: 1 }], duration: 1 });
    expect(() => { tw.update(1000); tw.update(1100); }).not.toThrow();
    expect(tw.progress).toBe(0);
  });
});
