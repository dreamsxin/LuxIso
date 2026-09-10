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

