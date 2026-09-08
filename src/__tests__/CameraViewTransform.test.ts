import { describe, it, expect } from 'vitest';
import { Camera } from '../core/Camera';
import { project } from '../math/IsoProjection';
import type { IsoView } from '../math/IsoProjection';

/**
 * Camera.applyTransform (used for rendering) and Camera.worldToScreen /
 * screenToWorld (used for picking and for overlays drawn outside the
 * transformed canvas) must agree exactly.
 *
 * They compose the same two operations — an elevation Y-scale and an iso-plane
 * rotation — but the elevation scale is non-uniform, so the two do NOT commute.
 * Applying them in different orders silently desynchronises clicks from pixels
 * whenever `rotation !== 0` AND `elevation !== 0.5`.
 *
 * These tests pin the rendering path (the canvas CTM) as the reference and
 * assert the analytic helpers reproduce it.
 */

interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Canvas semantics: every op post-multiplies the current matrix. */
function mul(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function apply(m: Mat, x: number, y: number): { sx: number; sy: number } {
  return { sx: m.a * x + m.c * y + m.e, sy: m.b * x + m.d * y + m.f };
}

/** Minimal ctx stub that accumulates the CTM exactly like a real canvas. */
function ctmRecorder(): { ctx: CanvasRenderingContext2D; matrix: () => Mat } {
  let m = IDENTITY;
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: (x: number, y: number) => {
      m = mul(m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
    },
    scale: (sx: number, sy: number) => {
      m = mul(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = mul(m, { a, b, c, d, e, f });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, matrix: () => m };
}

const TW = 64, TH = 32;
const OX = 320, OY = 240;
const CW = 640, CH = 480;

/** Where the renderer actually puts a world point, per the canvas CTM. */
function renderedPosition(cam: Camera, wx: number, wy: number, wz: number, view: IsoView) {
  const rec = ctmRecorder();
  cam.applyTransform(rec.ctx, CW, CH, TW, TH, OX, OY, view);
  const iso = project(wx, wy, wz, TW, TH);
  return apply(rec.matrix(), iso.sx, iso.sy);
}

describe('Camera — worldToScreen matches applyTransform', () => {
  const views: IsoView[] = [
    { rotation: 0,   elevation: 0.5 },   // default
    { rotation: 45,  elevation: 0.5 },   // rotation only
    { rotation: 0,   elevation: 0.25 },  // elevation only
    { rotation: 90,  elevation: 0.25 },  // both — the regressing combination
    { rotation: 210, elevation: 0.8 },   // both, other quadrant
  ];

  for (const view of views) {
    it(`agrees at rotation=${view.rotation} elevation=${view.elevation}`, () => {
      const cam = new Camera({ x: 2, y: 3, zoom: 1.5 });
      for (const [wx, wy, wz] of [[0, 0, 0], [5, 1, 0], [3, 4, 48]] as const) {
        const expected = renderedPosition(cam, wx, wy, wz, view);
        const actual = cam.worldToScreen(wx, wy, wz, TW, TH, OX, OY, view);
        expect(actual.sx).toBeCloseTo(expected.sx, 6);
        expect(actual.sy).toBeCloseTo(expected.sy, 6);
      }
    });
  }

  it('detects the order swap it was written to catch', () => {
    // Sanity check that the tilted+rotated case is actually order-sensitive:
    // swapping the two operations must produce a different result, otherwise
    // the tests above would pass vacuously.
    const view: IsoView = { rotation: 90, elevation: 0.25 };
    const cam = new Camera();
    const correct = cam.worldToScreen(1, 0, 0, TW, TH, OX, OY, view);

    // Reproduce the old (buggy) order: elevation first, then rotation.
    let sx = (1 - 0) * (TW / 2);
    let sy = (1 + 0) * (TH / 2);
    sy *= view.elevation / 0.5;
    const rad = (view.rotation * Math.PI) / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const aspect = TW / TH;
    const swapped = {
      sx: OX + (c * sx + s * aspect * sy),
      sy: OY + ((-s / aspect) * sx + c * sy),
    };

    expect(swapped.sy).not.toBeCloseTo(correct.sy, 3);
  });
});

describe('Camera — screenToWorld round-trips under a tilted, rotated view', () => {
  const views: IsoView[] = [
    { rotation: 0,   elevation: 0.5 },
    { rotation: 90,  elevation: 0.25 },
    { rotation: 210, elevation: 0.8 },
  ];

  for (const view of views) {
    it(`inverts worldToScreen at rotation=${view.rotation} elevation=${view.elevation}`, () => {
      const cam = new Camera({ x: 2, y: 3, zoom: 1.5 });
      for (const [wx, wy] of [[0, 0], [5, 1], [3.25, 4.75]] as const) {
        const { sx, sy } = cam.worldToScreen(wx, wy, 0, TW, TH, OX, OY, view);
        const back = cam.screenToWorld(sx, sy, CW, CH, TW, TH, OX, OY, view);
        expect(back.x).toBeCloseTo(wx, 6);
        expect(back.y).toBeCloseTo(wy, 6);
      }
    });
  }
});

describe('Camera — lerpFactor is clamped', () => {
  const target = {
    id: 't', position: { x: 10, y: 0, z: 0 }, aabb: {} as never, draw: () => {},
  } as never;

  it('rejects a negative lerpFactor instead of producing NaN', () => {
    // Scene JSON can assign this field directly; Math.pow with a negative base
    // and a fractional exponent used to return NaN and poison camera.x/y.
    const cam = new Camera({ x: 0, y: 0 });
    cam.lerpFactor = -0.5;
    expect(cam.lerpFactor).toBe(0);
    cam.follow(target);
    cam.update(1 / 60);
    expect(Number.isFinite(cam.x)).toBe(true);
    expect(cam.x).toBe(0); // factor 0 = never converge
  });

  it('clamps above 1 and rejects non-finite values', () => {
    const cam = new Camera();
    cam.lerpFactor = 5;
    expect(cam.lerpFactor).toBe(1);
    cam.lerpFactor = Number.NaN;
    expect(cam.lerpFactor).toBe(1);
  });
});
