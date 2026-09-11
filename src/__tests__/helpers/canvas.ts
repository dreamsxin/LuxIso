/**
 * A recording Canvas 2D context, for testing `draw()` paths.
 *
 * Every element in `src/elements/**` paints through the same narrow slice of the
 * 2D API, and each test that wanted to look at that painting used to hand-roll
 * its own stub — five near-identical proxies with slightly different gaps. This is
 * that stub, once: it records calls in order and property writes as they happen,
 * so a test can assert *what* was drawn rather than merely that nothing threw.
 */
import { DEFAULT_ISO_VIEW } from '../../math/IsoProjection';
import type { DrawContext } from '../../elements/IsoObject';
import type { OmniLight } from '../../lighting/OmniLight';
import type { DirectionalLight } from '../../lighting/DirectionalLight';

export interface CtxCall {
  fn: string;
  args: number[];
}

export interface CtxRecorder {
  ctx: CanvasRenderingContext2D;
  /** Every method call, in order. */
  calls: CtxCall[];
  /** Every property write, in order — `fillStyle`, `globalAlpha`, … */
  sets: Array<{ prop: string; value: unknown }>;
  /** Method names in call order, for coarse sequence assertions. */
  names(): string[];
  /** Argument lists of every call to `fn`. */
  argsOf(fn: string): number[][];
  /** Values written to `prop`, in order. */
  valuesOf(prop: string): unknown[];
  reset(): void;
}

/** Methods that return something the drawing code then uses. */
const RETURNS: Record<string, () => unknown> = {
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createRadialGradient: () => ({ addColorStop: () => {} }),
  createPattern: () => null,
  measureText: () => ({ width: 0 }),
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
};

export function createCtxRecorder(): CtxRecorder {
  const calls: CtxCall[] = [];
  const sets: Array<{ prop: string; value: unknown }> = [];

  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ fn: prop, args: args.map((a) => (typeof a === 'number' ? a : NaN)) });
        return RETURNS[prop]?.();
      };
    },
    set: (target, prop: string, value: unknown) => {
      target[prop] = value;
      sets.push({ prop, value });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    calls,
    sets,
    names: () => calls.map((c) => c.fn),
    argsOf: (fn) => calls.filter((c) => c.fn === fn).map((c) => c.args),
    valuesOf: (prop) => sets.filter((s) => s.prop === prop).map((s) => s.value),
    reset: () => { calls.length = 0; sets.length = 0; },
  };
}

export interface TestDrawContext extends DrawContext {
  recorder: CtxRecorder;
}

/**
 * A `DrawContext` with a recording canvas. Defaults are the engine's own: a
 * 64x32 tile, an origin at (0, 0) so screen coordinates are the projection
 * itself, no lights, and the default view.
 */
export function createDrawContext(overrides: Partial<DrawContext> = {}): TestDrawContext {
  const recorder = createCtxRecorder();
  return {
    ctx: recorder.ctx,
    tileW: 64,
    tileH: 32,
    originX: 0,
    originY: 0,
    omniLights: [] as OmniLight[],
    dirLights: [] as DirectionalLight[],
    ambientRgb: [0.2, 0.2, 0.2],
    view: { ...DEFAULT_ISO_VIEW },
    ...overrides,
    recorder,
  };
}
