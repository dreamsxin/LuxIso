import { describe, it, expect, afterEach, vi } from 'vitest';
import { Engine } from '../core/Engine';
import { Scene } from '../core/Scene';

/**
 * Engine viewport / high-DPI tests.
 *
 * The contract being pinned: everything the game touches — `canvasW/H`,
 * `originX/Y`, the extents handed to `Scene.draw` — is in logical (CSS) pixels,
 * and `pixelRatio` only ever affects the backing store plus the context's base
 * transform.
 */

function makeCanvas(w = 800, h = 600, parent?: { clientWidth: number; clientHeight: number }) {
  const calls: unknown[][] = [];
  const ctx = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => { calls.push([prop, ...args]); },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;

  const canvas = {
    width: w,
    height: h,
    style: {} as Record<string, string>,
    parentElement: parent ?? null,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctxCalls: calls };
}

function setDpr(value: number | undefined): void {
  (globalThis as any).window = { devicePixelRatio: value, addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

describe('Engine — logical size and pixel ratio', () => {
  afterEach(() => { delete (globalThis as any).window; });

  it('adopts the pre-set canvas size at ratio 1', () => {
    setDpr(3);
    const { canvas } = makeCanvas(640, 480);
    const engine = new Engine({ canvas });

    // Constructing must not rescale a canvas the page already sized itself.
    expect(engine.canvasW).toBe(640);
    expect(engine.canvasH).toBe(480);
    expect(engine.appliedPixelRatio).toBe(1);
    expect(canvas.width).toBe(640);
    expect(engine.originX).toBe(320);
    expect(engine.originY).toBe(240);
  });

  it('sizes the backing store by the ratio and pins the CSS box', () => {
    setDpr(2);
    const { canvas, ctxCalls } = makeCanvas();
    const engine = new Engine({ canvas });
    engine.resize(400, 300);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('300px');
    expect(ctxCalls).toContainEqual(['setTransform', 2, 0, 0, 2, 0, 0]);

    // Logical space is unchanged by the ratio.
    expect(engine.canvasW).toBe(400);
    expect(engine.canvasH).toBe(300);
    expect(engine.originX).toBe(200);
    expect(engine.originY).toBe(150);
    expect(engine.appliedPixelRatio).toBe(2);
  });

  it('caps the auto-detected ratio at maxPixelRatio', () => {
    setDpr(3);
    const { canvas } = makeCanvas();
    const engine = new Engine({ canvas });
    expect(engine.pixelRatio).toBe(2);

    engine.maxPixelRatio = 3;
    expect(engine.pixelRatio).toBe(3);
    engine.resize(100, 100);
    expect(canvas.width).toBe(300);
  });

  it('never goes below 1 even on a fractional or missing DPR', () => {
    setDpr(0.5);
    const a = new Engine({ canvas: makeCanvas().canvas });
    expect(a.pixelRatio).toBe(1);

    setDpr(undefined);
    const b = new Engine({ canvas: makeCanvas().canvas });
    expect(b.pixelRatio).toBe(1);
  });

  it('honours an explicit override and returns to auto on null', () => {
    setDpr(2);
    const { canvas } = makeCanvas();
    const engine = new Engine({ canvas });

    engine.pixelRatio = 1;
    expect(engine.pixelRatio).toBe(1);
    engine.resize(200, 200);
    expect(canvas.width).toBe(200);

    engine.pixelRatio = null;
    expect(engine.pixelRatio).toBe(2);
  });

  it('fills the parent when called with no arguments', () => {
    setDpr(2);
    const { canvas } = makeCanvas(800, 600, { clientWidth: 500, clientHeight: 250 });
    const engine = new Engine({ canvas });
    engine.resize();

    expect(engine.canvasW).toBe(500);
    expect(engine.canvasH).toBe(250);
    expect(canvas.width).toBe(1000);
  });

  it('keeps the current logical size when there is no parent to measure', () => {
    setDpr(1);
    const { canvas } = makeCanvas(320, 200);
    const engine = new Engine({ canvas });
    engine.resize();
    expect(engine.canvasW).toBe(320);
    expect(engine.canvasH).toBe(200);
  });

  it('clears and draws in logical units, not backing pixels', () => {
    setDpr(2);
    const { canvas, ctxCalls } = makeCanvas();
    const engine = new Engine({ canvas });
    engine.resize(400, 300);
    engine.setScene(new Scene());

    // Scene.draw bakes a lightmap into an OffscreenCanvas, which node lacks.
    (globalThis as any).OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext() {
        return new Proxy({}, {
          get: () => () => undefined,
          set: () => true,
        });
      }
    };

    let frame: ((ts: number) => void) | null = null;
    (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => { frame = cb; return 1; };
    (globalThis as any).cancelAnimationFrame = vi.fn();

    engine.start();
    ctxCalls.length = 0;
    frame!(16);
    engine.stop();
    delete (globalThis as any).OffscreenCanvas;

    expect(ctxCalls).toContainEqual(['clearRect', 0, 0, 400, 300]);
  });
});

describe('Engine — pause while the tab is hidden', () => {
  interface Harness {
    engine: Engine;
    frames: Array<(ts: number) => void>;
    cancelled: number[];
    hide(): void;
    show(): void;
  }

  function harness(): Harness {
    setDpr(1);
    const { canvas } = makeCanvas();
    const listeners = new Set<EventListener>();
    const state = { hidden: false };
    (globalThis as any).document = {
      addEventListener: (t: string, cb: EventListener) => { if (t === 'visibilitychange') listeners.add(cb); },
      removeEventListener: (t: string, cb: EventListener) => { if (t === 'visibilitychange') listeners.delete(cb); },
      get hidden() { return state.hidden; },
    };

    const frames: Array<(ts: number) => void> = [];
    const cancelled: number[] = [];
    (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => {
      frames.push(cb);
      return frames.length;
    };
    (globalThis as any).cancelAnimationFrame = (id: number) => { cancelled.push(id); };

    const engine = new Engine({ canvas });
    engine.setScene(new Scene());
    const fire = (): void => { for (const cb of [...listeners]) cb({ type: 'visibilitychange' } as Event); };
    return {
      engine, frames, cancelled,
      hide: () => { state.hidden = true; fire(); },
      show: () => { state.hidden = false; fire(); },
    };
  }

  afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it('cancels the loop when the page hides and resumes when it returns', () => {
    const h = harness();
    h.engine.start();
    expect(h.engine.paused).toBe(false);
    const scheduled = h.frames.length;

    h.hide();
    expect(h.engine.paused).toBe(true);
    expect(h.cancelled.length).toBe(1);
    expect(h.frames.length).toBe(scheduled);

    h.show();
    expect(h.engine.paused).toBe(false);
    expect(h.frames.length).toBe(scheduled + 1);
  });

  it('ignores repeated hide events', () => {
    const h = harness();
    h.engine.start();
    h.hide();
    h.hide();
    expect(h.cancelled.length).toBe(1);
  });

  it('does nothing when the loop was never started', () => {
    const h = harness();
    h.hide();
    expect(h.engine.paused).toBe(false);
    expect(h.cancelled.length).toBe(0);
  });

  it('keeps running when pauseOnHide is off', () => {
    const h = harness();
    h.engine.pauseOnHide = false;
    h.engine.start();
    h.hide();
    expect(h.engine.paused).toBe(false);
    expect(h.cancelled.length).toBe(0);
  });

  it('stop() detaches the listener so a later hide is inert', () => {
    const h = harness();
    h.engine.start();
    h.engine.stop();
    const cancelledAfterStop = h.cancelled.length;
    h.hide();
    expect(h.engine.paused).toBe(false);
    expect(h.cancelled.length).toBe(cancelledAfterStop);
  });

  it('destroy() stops the loop', () => {
    const h = harness();
    h.engine.start();
    h.engine.destroy();
    h.hide();
    expect(h.engine.paused).toBe(false);
  });
});

describe('Engine — frame delta', () => {
  /** Records what the loop hands to the scene, without drawing anything. */
  class Probe extends Scene {
    readonly fixedDts: number[] = [];
    readonly updates: Array<number | undefined> = [];
    override fixedUpdate(dt: number): void { this.fixedDts.push(dt); }
    override update(ts?: number): void { this.updates.push(ts); }
    override draw(): void {}
  }

  function driver(): { engine: Engine; scene: Probe; frame(ts: number): void } {
    setDpr(1);
    const { canvas } = makeCanvas();
    const engine = new Engine({ canvas });
    const scene = new Probe();
    engine.setScene(scene);

    let next: ((ts: number) => void) | null = null;
    (globalThis as any).requestAnimationFrame = (cb: (ts: number) => void) => { next = cb; return 1; };
    (globalThis as any).cancelAnimationFrame = vi.fn();
    engine.start();

    return {
      engine,
      scene,
      frame: (ts: number) => { const cb = next; next = null; cb?.(ts); },
    };
  }

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).requestAnimationFrame;
    delete (globalThis as any).cancelAnimationFrame;
  });

  it('does not step physics on the very first frame', () => {
    const d = driver();
    d.frame(1000);
    expect(d.scene.fixedDts).toEqual([]);
    expect(d.scene.updates).toEqual([1000]);
    d.engine.stop();
  });

  it('does not drop the frame after timestamp 0', () => {
    const d = driver();
    d.frame(0);
    // 100 ms at a 1/60 fixed step owes six physics steps. The old
    // `_lastTs === 0` sentinel was still armed after a legitimate timestamp of
    // 0, so this frame produced none.
    d.frame(100);
    expect(d.scene.fixedDts.length).toBe(6);
    d.engine.stop();
  });

  it('clamps a long stall to 100 ms', () => {
    const d = driver();
    d.frame(1000);
    d.frame(61_000);
    expect(d.scene.fixedDts.length).toBe(6);
    d.engine.stop();
  });

  it('never steps physics backwards', () => {
    const d = driver();
    d.frame(1000);
    d.frame(600);
    expect(d.scene.fixedDts).toEqual([]);
    d.engine.stop();
  });

  it('a backwards timestamp does not stall physics afterwards', () => {
    const d = driver();
    d.frame(1000);
    d.frame(600);
    // Without the [0, 0.1] clamp the accumulator went to -0.4 s, and the next
    // several frames were spent paying that debt off instead of stepping.
    d.frame(700);
    d.frame(800);
    expect(d.scene.fixedDts.length).toBe(12);
    d.engine.stop();
  });
});


