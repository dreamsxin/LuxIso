import {describe, it, expect, afterEach, vi} from 'vitest';
import {Engine} from '../core/Engine';
import {Scene} from '../core/Scene';

/**
 * The explicit fixed-step cap (`Engine.maxFixedStepsPerFrame`).
 *
 * Before this constant existed the bound was only a derivation: the 100 ms dt
 * clamp limits a stalled frame to about 7 owed steps, so the uncapped while
 * loop "could not" spiral — but nothing enforced it, and anyone who raised the
 * clamp or added nested stepping would reopen the death spiral silently. These
 * tests pin the cap as a contract: a frame never runs more than `cap` steps,
 * deferred time carries (nothing is lost), and the deferral is observable.
 */

interface Harness {
  engine: Engine;
  fixedSteps(): number;
  frame(ts: number): void;
}

function harness(): Harness {
  let next: ((ts: number) => void) | null = null;
  (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => { next = cb; return 1; };
  (globalThis as any).cancelAnimationFrame = vi.fn();
  (globalThis as any).window = {devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn()};

  const ctx = new Proxy({}, {
    get: () => () => {},
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 800, height: 600, style: {} as Record<string, string>, parentElement: null,
    getContext: () => ctx,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;

  const engine = new Engine({canvas});
  const scene = new Scene({cols: 2, rows: 2});
  const fixed = vi.spyOn(scene, 'fixedUpdate').mockImplementation(() => {});
  vi.spyOn(scene, 'draw').mockImplementation(() => {});
  engine.setScene(scene);
  engine.start();

  return {
    engine,
    fixedSteps: () => fixed.mock.calls.length,
    frame(ts: number) {
      const cb = next;
      next = null;
      cb?.(ts);
    },
  };
}

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  vi.restoreAllMocks();
});

describe('Engine — fixed step cap', () => {
  it('keeps today\'s behaviour: the default cap never binds a clamped stall', () => {
    const h = harness();
    h.frame(1000);
    h.frame(61_000); // clamped to 100 ms → 6 fixed steps
    expect(h.fixedSteps()).toBe(6);
    expect(h.engine.deferredFixedSteps).toBe(0);
    h.engine.stop();
  });

  it('never runs more steps in one frame than the cap', () => {
    const h = harness();
    h.engine.maxFixedStepsPerFrame = 2;
    h.frame(1000);
    h.frame(61_000);
    expect(h.fixedSteps()).toBe(2);
    expect(h.engine.deferredFixedSteps).toBeGreaterThanOrEqual(4);
    h.engine.stop();
  });

  it('carries deferred time instead of losing it', () => {
    const h = harness();
    h.engine.maxFixedStepsPerFrame = 2;
    h.frame(1000);
    h.frame(61_000); // owes 6 steps, runs 2
    const afterStall = h.fixedSteps();
    // Enough ordinary frames to drain the whole backlog: total steps must
    // reach the 6 the stall owed — slow motion, not lost time.
    for (let i = 1; i <= 12; i++) {h.frame(61_000 + i * 16);}
    expect(h.fixedSteps() - afterStall).toBeGreaterThanOrEqual(4);
    // And the backlog eventually converges: the accumulator holds less than
    // one step's worth after draining.
    for (let i = 13; i <= 20; i++) {h.frame(61_000 + i * 16);}
    const deferredTail = h.engine.deferredFixedSteps;
    for (let i = 21; i <= 25; i++) {h.frame(61_000 + i * 16);}
    expect(h.engine.deferredFixedSteps).toBe(deferredTail);
    h.engine.stop();
  });

  it('treats a non-positive cap as 1 instead of running unbounded', () => {
    const h = harness();
    h.engine.maxFixedStepsPerFrame = 0;
    h.frame(1000);
    h.frame(61_000);
    expect(h.fixedSteps()).toBe(1);
    h.engine.stop();
  });
});
