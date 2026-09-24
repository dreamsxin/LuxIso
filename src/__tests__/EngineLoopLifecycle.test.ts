import {describe, it, expect, afterEach, vi} from 'vitest';
import {Engine} from '../core/Engine';
import {Scene} from '../core/Scene';

/**
 * The render loop's lifecycle, driven by a rAF the test controls.
 *
 * `_rafId` was doing double duty as "the id to cancel" and "is the loop
 * running", and the loop body clears it before running the tick — so for the
 * whole duration of a frame callback the engine looked stopped. Every assertion
 * here counts how many callbacks one flush runs: that number is the number of
 * live rAF chains, which is the thing the old guard could not see.
 */

interface Harness {
  engine: Engine;
  scene: Scene;
  /** Run every pending rAF callback. Returns how many chains were alive. */
  flush(ts: number): number;
  fixedSteps(): number;
}

function harness(): Harness {
  const pending = new Map<number, (ts: number) => void>();
  let nextId = 1;
  (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void): number => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  };
  (globalThis as any).cancelAnimationFrame = (id: number): void => { pending.delete(id); };
  (globalThis as any).window = {devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn()};

  const ctx = new Proxy({}, {
    get: () => () => {},
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 800, height: 600, style: {} as Record<string, string>, parentElement: null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600}),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;

  const engine = new Engine({canvas});
  const scene = new Scene({name: 's', tileW: 64, tileH: 32, cols: 4, rows: 4});
  vi.spyOn(scene, 'draw').mockImplementation(() => {});
  const fixed = vi.spyOn(scene, 'fixedUpdate');
  engine.setScene(scene);

  return {
    engine,
    scene,
    flush(ts: number): number {
      const batch = [...pending.values()];
      pending.clear();
      for (const cb of batch) {cb(ts);}
      return batch.length;
    },
    fixedSteps: () => fixed.mock.calls.length,
  };
}

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  vi.restoreAllMocks();
});

describe('Engine — one rAF chain, always', () => {
  it('does not start a second chain when a frame callback restarts it', () => {
    const h = harness();
    let restarted = false;
    h.engine.start(() => {
      if (restarted) {return;}
      restarted = true;
      // What a restart button does. `HudLayer`'s own docstring shows
      // `onClick: () => engine.stop()`, so engine control from a callback is the
      // sanctioned pattern.
      h.engine.stop();
      h.engine.start(() => {});
    });

    expect(h.flush(0)).toBe(1);
    expect(restarted).toBe(true);
    // Two chains here means every later frame ticks the scene twice: the game
    // runs at 2x and `stop()` can only cancel the one it holds an id for.
    expect(h.flush(16)).toBe(1);
    expect(h.flush(32)).toBe(1);
  });

  it('ignores start() called from inside a frame while already running', () => {
    const h = harness();
    h.engine.start(() => { h.engine.start(() => {}); });

    expect(h.flush(0)).toBe(1);
    expect(h.flush(16)).toBe(1);
  });

  it('stops for good when a frame callback stops it', () => {
    const h = harness();
    h.engine.start(() => { h.engine.stop(); });

    expect(h.flush(0)).toBe(1);
    expect(h.flush(16)).toBe(0);
  });
});

describe('Engine — stop() is a pause, so it disarms the clock', () => {
  it('does not credit the paused interval to the first frame back', () => {
    const h = harness();
    h.engine.start();

    h.flush(0);
    h.flush(16);
    const before = h.fixedSteps();

    h.engine.stop();
    // 30 seconds of pause menu.
    h.engine.start();
    h.flush(30_016);

    // The clamp is 100 ms, which is six 1/60 s fixed steps plus whatever the
    // accumulator still held — all of it applied in one frame, which is why
    // everything used to teleport when the menu closed.
    expect(h.fixedSteps()).toBe(before);
  });
});

describe('Engine — auto-pause', () => {
  function fakeDocument(): {doc: any; fire(): void} {
    let handler: (() => void) | null = null;
    const doc = {
      hidden: false,
      addEventListener: (_type: string, cb: () => void) => { handler = cb; },
      removeEventListener: () => { handler = null; },
    };
    return {doc, fire: () => handler?.()};
  }

  afterEach(() => { delete (globalThis as any).document; });

  it('resumes when pauseOnHide is switched off while already hidden', () => {
    const {doc, fire} = fakeDocument();
    (globalThis as any).document = doc;
    const h = harness();
    h.engine.start();
    h.flush(0);

    doc.hidden = true;
    fire();
    expect(h.engine.paused).toBe(true);
    expect(h.flush(16)).toBe(0);

    // A "keep simulating in the background" setting, toggled while hidden. The
    // `pauseOnHide` check used to guard both directions, so the resume branch
    // returned early and left `_autoPaused` true forever — `paused` reporting
    // true on a visible tab, recoverable only through `stop()`.
    h.engine.pauseOnHide = false;
    doc.hidden = false;
    fire();

    expect(h.engine.paused).toBe(false);
    expect(h.flush(32)).toBe(1);
  });
});

