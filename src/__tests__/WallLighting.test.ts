import {describe, it, expect, vi} from 'vitest';
import {Wall} from '../elements/Wall';
import {OmniLight} from '../lighting/OmniLight';
import {DirectionalLight} from '../lighting/DirectionalLight';

/**
 * Wall directional-light factor tests.
 *
 * Vertical wall-face irradiance from a directional light must scale with
 * cos(elevation) (the sun's horizontal component), NOT sin(elevation):
 *   - At zenith (elevation = 90 deg) a vertical face gets grazing -> ~0 light
 *   - At low sun (elevation -> 0) a face facing the sun is brightly lit
 *
 * We can't read the computed illumination back from Wall.draw directly, so we
 * capture the fillStyle rgb values produced under two elevations and compare.
 * The face-normal dot product is held constant (same angle) so only the
 * elevation factor differs.
 */

function captureWallFillStyle(elevDeg: number): string {
  let fillStyle = '';
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
    stroke: vi.fn(), clip: vi.fn(),
    createRadialGradient: () => ({addColorStop: vi.fn()}),
    createLinearGradient: () => ({addColorStop: vi.fn()}),
    setLineDash: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
    measureText: () => ({width: 0}),
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    strokeStyle: '', lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  // X-wall (faces -Y). Light angle 0 deg -> direction toward +x; the X-wall
  // normal NX_WALL = (0.8944, -0.4472) has positive dot with (cos0,sin0)=(1,0)
  // = 0.8944. DirectionalLight takes angle/elevation in DEGREES (constructor
  // converts to radians internally).
  const wall = new Wall({id: 'w', x: 0, y: 0, endX: 4, endY: 0, height: 64});
  const dc = {
    ctx, tileW: 64, tileH: 32, originX: 100, originY: 100,
    omniLights: [] as OmniLight[],
    dirLights: [new DirectionalLight({angle: 0, elevation: elevDeg, color: '#ffffff', intensity: 1})],
    ambientRgb: [0, 0, 0] as [number, number, number],
    view: {rotation: 0, elevation: 0.5},
  };
  wall.draw(dc);
  return fillStyle;
}

describe('Wall directional light elevation factor', () => {
  it('uses cos(elevation): zenith (90deg) wall is darker than mid-sun (45deg)', () => {
    const midSun = captureWallFillStyle(45);
    const zenith = captureWallFillStyle(90);
    // Both produced a fillStyle
    expect(midSun).toMatch(/^rgb\(/);
    expect(zenith).toMatch(/^rgb\(/);
    // Extract the red channel (0-255). cos(90deg)=0 -> wall should be darker
    // than cos(45deg)=0.707. (Pre-fix used sin: sin(90)=1 would make zenith
    // the BRIGHTEST, which is physically wrong for a vertical face.)
    const red = (s: string) => parseInt(s.match(/rgb\((\d+)/)![1], 10);
    expect(red(zenith)).toBeLessThan(red(midSun));
  });

  it('low sun (10deg) lights a sun-facing wall more than grazing (80deg)', () => {
    const lowSun = captureWallFillStyle(10);
    const highSun = captureWallFillStyle(80);
    const red = (s: string) => parseInt(s.match(/rgb\((\d+)/)![1], 10);
    expect(red(lowSun)).toBeGreaterThan(red(highSun));
  });
});
