import { describe, it, expect, vi } from 'vitest';
import { Wall } from '../elements/Wall';
import type { OmniLight } from '../lighting/OmniLight';
import type { DirectionalLight } from '../lighting/DirectionalLight';

/**
 * Wall openings (doors / windows) are painted on top of the wall body.
 *
 * Regression: `drawFace` used to build the wall parallelogram path and then call
 * a helper that started its own paths and filled each opening. By the time the
 * wall's own `fill()` ran, the current path was the LAST opening — so the wall
 * body was never painted and the last opening got the wall's colour instead.
 * Any wall with `openings` was effectively invisible.
 */

interface Fill { points: { x: number; y: number }[]; style: string }

function drawWall(openings: Wall['openings']): Fill[] {
  const fills: Fill[] = [];
  let current: { x: number; y: number }[] = [];
  let fillStyle = '';

  const ctx = {
    save: vi.fn(), restore: vi.fn(),
    beginPath: () => { current = []; },
    moveTo: (x: number, y: number) => { current.push({ x, y }); },
    lineTo: (x: number, y: number) => { current.push({ x, y }); },
    closePath: vi.fn(),
    fill: () => { fills.push({ points: [...current], style: fillStyle }); },
    stroke: vi.fn(), clip: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    setLineDash: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    measureText: () => ({ width: 0 }),
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    strokeStyle: '', lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;

  const wall = new Wall({ id: 'w', x: 0, y: 0, endX: 4, endY: 0, height: 64, openings });
  wall.draw({
    ctx, tileW: 64, tileH: 32, originX: 100, originY: 100,
    omniLights: [] as OmniLight[],
    dirLights: [] as DirectionalLight[],
    ambientRgb: [255, 255, 255] as [number, number, number],
    view: { rotation: 0, elevation: 0.5 },
  });
  return fills;
}

const span = (f: Fill): number =>
  Math.max(...f.points.map(p => p.x)) - Math.min(...f.points.map(p => p.x));

describe('Wall — openings', () => {
  it('fills the wall body when there are no openings', () => {
    const fills = drawWall([]);
    expect(fills.length).toBe(1);
    expect(fills[0].points.length).toBe(4);
    expect(fills[0].style).toMatch(/^rgb\(/);
    // Wall runs x=0..4 -> screen x 100..228
    expect(span(fills[0])).toBeCloseTo(128, 0);
  });

  it('still fills the wall body when openings are present', () => {
    const fills = drawWall([
      { type: 'window', offsetX: 0.3, width: 0.2, height: 0.45, offsetY: 0.3 },
      { type: 'door', offsetX: 0.7, width: 0.2, height: 0.85 },
    ]);

    // One wall body + two openings.
    expect(fills.length).toBe(3);

    // The FIRST fill must be the full-width wall body in the lit wall colour.
    const body = fills[0];
    expect(body.style).toMatch(/^rgb\(/);
    expect(span(body)).toBeCloseTo(128, 0);

    // The openings come afterwards, are narrower, and use their own colours.
    for (const opening of fills.slice(1)) {
      expect(opening.style).toMatch(/^rgba\(/);
      expect(span(opening)).toBeLessThan(span(body));
    }
  });

  it('does not paint an opening in the wall colour', () => {
    const fills = drawWall([
      { type: 'door', offsetX: 0.7, width: 0.2, height: 0.85 },
    ]);
    // Pre-fix, the single opening was filled twice: once with its hole colour
    // and once (as the leftover current path) with the wall's rgb colour.
    const wallColoured = fills.filter(f => /^rgb\(/.test(f.style));
    expect(wallColoured.length).toBe(1);
    expect(span(wallColoured[0])).toBeCloseTo(128, 0);
  });
});
