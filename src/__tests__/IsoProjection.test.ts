import { describe, it, expect, vi } from 'vitest';
import { project, unproject, depthKey, drawIsoCube } from '../math/IsoProjection';

const TW = 64;
const TH = 32;

describe('project', () => {
  it('origin maps to (0, 0)', () => {
    const { sx, sy } = project(0, 0, 0, TW, TH);
    expect(sx).toBe(0);
    expect(sy).toBe(0);
  });

  it('x+1 moves right and down', () => {
    const { sx, sy } = project(1, 0, 0, TW, TH);
    expect(sx).toBe(TW / 2);
    expect(sy).toBe(TH / 2);
  });

  it('y+1 moves left and down', () => {
    const { sx, sy } = project(0, 1, 0, TW, TH);
    expect(sx).toBe(-TW / 2);
    expect(sy).toBe(TH / 2);
  });

  it('z+1 moves up (sy decreases)', () => {
    const { sx, sy } = project(0, 0, 1, TW, TH);
    expect(sx).toBe(0);
    expect(sy).toBe(-1);
  });

  it('diagonal x=y cancels sx', () => {
    const { sx } = project(3, 3, 0, TW, TH);
    expect(sx).toBe(0);
  });
});

describe('unproject', () => {
  it('is the inverse of project at z=0', () => {
    const cases: [number, number][] = [[0, 0], [3, 2], [5, 5], [1, 9]];
    for (const [wx, wy] of cases) {
      const { sx, sy } = project(wx, wy, 0, TW, TH);
      const { x, y } = unproject(sx, sy, TW, TH);
      expect(x).toBeCloseTo(wx, 8);
      expect(y).toBeCloseTo(wy, 8);
    }
  });
});

describe('depthKey', () => {
  it('larger x+y = larger depth key', () => {
    expect(depthKey(2, 3, 0)).toBeGreaterThan(depthKey(1, 3, 0));
    expect(depthKey(1, 4, 0)).toBeGreaterThan(depthKey(1, 3, 0));
  });

  it('z has minimal influence compared to x+y', () => {
    // z=1000 should not overtake a 1-unit x+y difference
    expect(depthKey(2, 0, 0)).toBeGreaterThan(depthKey(0, 0, 1000));
  });
});

describe('project - view parameter', () => {
  it('ignores the _view argument (rotation/elevation applied by Camera transform)', () => {
    // project() intentionally does NOT apply view rotation/elevation - those
    // are canvas 2D transforms set by Camera.applyTransform(). A caller passing
    // a view must get the same result as one that doesn't.
    const noView = project(3, 5, 10, 64, 32);
    const withView = project(3, 5, 10, 64, 32, { rotation: 90, elevation: 1.0 });
    expect(withView).toEqual(noView);
  });
});

describe('drawIsoCube', () => {
  it('draws three faces without throwing', () => {
    // Smoke test: drawIsoCube should call beginPath/moveTo/lineTo/closePath/fill
    // for the left, right, and top faces. No canvas DOM required - pass a mock.
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    expect(() =>
      drawIsoCube(ctx, 100, 100, 64, 32, 1, 1, 0, 2, 2, 2, '#aaa', '#888', '#666'),
    ).not.toThrow();
    // 3 faces -> 3 fill() calls
    expect(ctx.fill).toHaveBeenCalledTimes(3);
    expect(ctx.beginPath).toHaveBeenCalledTimes(3);
  });
});
