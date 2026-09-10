import { describe, it, expect, vi, afterEach } from 'vitest';
import { SceneTransition } from '../core/SceneTransition';

/**
 * SceneTransition was at 0% coverage with a fully written docblock — the
 * combination that has meant "the implementation has drifted" every time this
 * audit hit it. A wave-based ARPG uses this for every level and results screen
 * switch, so what matters is that the screen stays covered while the new scene
 * loads and that the promises always settle.
 */

interface Recorder {
  ctx: CanvasRenderingContext2D;
  calls: unknown[][];
  props: Record<string, unknown>;
}

function recorder(): Recorder {
  const calls: unknown[][] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop in props) return props[prop as string];
      return (...args: unknown[]) => { calls.push([prop, ...args]); };
    },
    set: (_t, prop, value) => { props[prop as string] = value; calls.push(['set', prop, value]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, props };
}

/** Freezes performance.now() so `_startTs` is predictable. */
function freezeClock(at = 1000): void {
  vi.spyOn(performance, 'now').mockReturnValue(at);
}

afterEach(() => { vi.restoreAllMocks(); });

function fills(calls: unknown[][]): unknown[][] {
  return calls.filter((c) => c[0] === 'fillRect');
}

describe('SceneTransition — in phase', () => {
  it('ramps progress and resolves once fully covered', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);

    const covered = t.playIn('fade', { duration: 400 });
    expect(t.isPlaying).toBe(true);
    expect(t.progress).toBe(0);

    t.draw(800, 600, 1200);
    expect(t.progress).toBeGreaterThan(0);
    expect(t.progress).toBeLessThan(1);

    t.draw(800, 600, 1400);
    await covered;
    expect(t.progress).toBe(1);
  });

  it('keeps the screen covered after the in phase resolves', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);

    await Promise.all([
      t.playIn('fade', { duration: 100 }),
      Promise.resolve().then(() => t.draw(800, 600, 1200)),
    ]);

    // The `Phase` union declares a 'hold' state that nothing ever entered: the
    // overlay stopped drawing the moment the in phase finished, so the old
    // scene showed through while the next one loaded.
    r.calls.length = 0;
    t.draw(800, 600, 1300);
    t.draw(800, 600, 5000);
    expect(t.isPlaying).toBe(true);
    expect(t.progress).toBe(1);
    expect(fills(r.calls).length).toBe(2);
  });

  it('stays covered across an await inside between()', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);
    let coveredDuringLoad: number[] = [];

    const run = t.between('fade', async () => {
      // Simulate an async scene load: several frames pass while awaiting.
      for (const ts of [1300, 1400, 1500]) {
        r.calls.length = 0;
        t.draw(800, 600, ts);
        coveredDuringLoad.push(fills(r.calls).length);
      }
    }, { duration: 100 });

    // Drive the in phase, then the out phase, until the whole thing settles.
    for (const ts of [1050, 1200, 1600, 1700, 1800, 2000]) {
      t.draw(800, 600, ts);
      await Promise.resolve();
    }
    await run;

    expect(coveredDuringLoad).toEqual([1, 1, 1]);
    expect(t.isPlaying).toBe(false);
  });
});

describe('SceneTransition — out phase', () => {
  it('uncovers and goes idle', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);

    const clear = t.playOut('fade', { duration: 200 });
    expect(t.progress).toBe(1);

    t.draw(800, 600, 1100);
    expect(t.progress).toBeLessThan(1);
    expect(t.progress).toBeGreaterThan(0);

    t.draw(800, 600, 1300);
    await clear;
    expect(t.progress).toBe(0);
    expect(t.isPlaying).toBe(false);
  });

  it('draws nothing once idle', () => {
    const r = recorder();
    const t = new SceneTransition(r.ctx);
    t.draw(800, 600, 1000);
    expect(r.calls.length).toBe(0);
  });
});

describe('SceneTransition — promise hygiene', () => {
  it('settles the previous promise when a new transition starts', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);

    // Before the fix `_resolve` was simply overwritten, so this promise never
    // settled and any `await` on it hung for the rest of the session.
    const abandoned = t.playIn('fade', { duration: 400 });
    t.playIn('slide-left', { duration: 100 });

    let settled = false;
    void abandoned.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it('a non-positive duration completes on the first draw', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);

    const covered = t.playIn('fade', { duration: 0 });
    t.draw(800, 600, 1000);
    await covered;
    expect(t.progress).toBe(1);
  });

  it('a negative duration does not stall the transition', async () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);

    const covered = t.playIn('fade', { duration: -100 });
    t.draw(800, 600, 1000);
    await covered;
    expect(t.isPlaying).toBe(true); // holding, fully covered
    expect(t.progress).toBe(1);
  });

  it('never reports a progress outside 0..1', () => {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);
    void t.playIn('fade', { duration: 200 });

    // A timestamp before the start (clock skew) must not drive progress negative.
    t.draw(800, 600, 900);
    expect(t.progress).toBeGreaterThanOrEqual(0);
    t.draw(800, 600, 9000);
    expect(t.progress).toBeLessThanOrEqual(1);
  });
});

describe('SceneTransition — effects', () => {
  function progressAt(effect: Parameters<SceneTransition['playIn']>[0], ts: number): Recorder {
    freezeClock(1000);
    const r = recorder();
    const t = new SceneTransition(r.ctx);
    void t.playIn(effect, { duration: 100, color: '#123456' });
    t.draw(800, 600, ts);
    return r;
  }

  it('fade paints the whole canvas with the configured colour', () => {
    const r = progressAt('fade', 1050);
    expect(r.calls).toContainEqual(['set', 'fillStyle', '#123456']);
    expect(fills(r.calls)).toContainEqual(['fillRect', 0, 0, 800, 600]);
  });

  it('slide-right grows from the left edge', () => {
    const r = progressAt('slide-right', 1050);
    const [call] = fills(r.calls);
    expect(call[1]).toBe(0);
    expect(call[3] as number).toBeGreaterThan(0);
    expect(call[3] as number).toBeLessThan(800);
  });

  it('slide-left grows from the right edge', () => {
    const r = progressAt('slide-left', 1050);
    const [call] = fills(r.calls);
    expect(call[1] as number).toBeGreaterThan(0);
    expect((call[1] as number) + (call[3] as number)).toBeCloseTo(800, 6);
  });

  it('slide-down grows from the top edge', () => {
    const r = progressAt('slide-down', 1050);
    const [call] = fills(r.calls);
    expect(call[2]).toBe(0);
    expect(call[4] as number).toBeGreaterThan(0);
  });

  it('slide-up grows from the bottom edge', () => {
    const r = progressAt('slide-up', 1050);
    const [call] = fills(r.calls);
    expect((call[2] as number) + (call[4] as number)).toBeCloseTo(600, 6);
  });

  it('circle-wipe closes the hole as coverage grows', () => {
    const early = progressAt('circle-wipe', 1010);
    const late  = progressAt('circle-wipe', 1099);
    const radius = (r: Recorder): number =>
      (r.calls.find((c) => c[0] === 'arc')![3] as number);

    // The hole used to *grow* with progress, so at full coverage the whole
    // canvas was erased — the effect ended fully transparent instead of opaque.
    expect(radius(early)).toBeGreaterThan(radius(late));
    expect(radius(late)).toBeLessThan(50);
  });

  it('circle-wipe restores the composite operation it borrowed', () => {
    const r = progressAt('circle-wipe', 1050);
    const ops = r.calls.filter((c) => c[0] === 'set' && c[1] === 'globalCompositeOperation');
    expect(ops.length).toBe(2);
    expect(ops[1][2]).toBe('source-over');
    expect(r.calls.filter((c) => c[0] === 'save').length).toBe(1);
    expect(r.calls.filter((c) => c[0] === 'restore').length).toBe(1);
  });

  it('resets the base transform before painting', () => {
    const r = progressAt('fade', 1050);
    expect(r.calls).toContainEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });
});
