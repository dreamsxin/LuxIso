import { describe, it, expect } from 'vitest';
import { Chest } from '../elements/props/Chest';
import { createDrawContext } from './helpers/canvas';
import { HealthComponent } from '../ecs/components/HealthComponent';
import { OmniLight } from '../lighting/OmniLight';
import { project } from '../math/IsoProjection';

/**
 * Chest lid tests.
 *
 * At 6% coverage the lid animation carried the same defect Camera and ClickMover
 * already had fixed: `_lidAngle += (target - _lidAngle) * 0.10` applies a fixed
 * fraction per frame, so the lid opened 2.4x faster on a 144 Hz display — even
 * though `ts` was already being passed in and used for the glow pulse.
 */

/** Run `frames` updates spanning `seconds`, starting from ts 0. */
function run(chest: Chest, frames: number, seconds: number): void {
  const step = (seconds * 1000) / frames;
  chest.update(0);
  for (let i = 1; i <= frames; i++) chest.update(i * step);
}

describe('Chest — lid state', () => {
  it('starts closed', () => {
    const chest = new Chest('c', 2, 2);
    expect(chest.isOpen).toBe(false);
    expect(chest.lidAngle).toBe(0);
  });

  it('open / close / toggle drive the flag', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    expect(chest.isOpen).toBe(true);
    chest.close();
    expect(chest.isOpen).toBe(false);
    chest.toggle();
    expect(chest.isOpen).toBe(true);
    chest.toggle();
    expect(chest.isOpen).toBe(false);
  });

  it('animates toward open and back toward closed', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    run(chest, 30, 0.5);
    const opened = chest.lidAngle;
    expect(opened).toBeGreaterThan(0.5);

    chest.close();
    run(chest, 30, 0.5);
    expect(chest.lidAngle).toBeLessThan(opened);
  });

  it('never overshoots the 0–1 range', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    run(chest, 600, 10);
    expect(chest.lidAngle).toBeLessThanOrEqual(1);
    expect(chest.lidAngle).toBeGreaterThan(0.99);
  });
});

describe('Chest — frame-rate independence', () => {
  it('reaches the same lid angle at 30 and 144 FPS', () => {
    const slow = new Chest('slow', 2, 2);
    const fast = new Chest('fast', 2, 2);
    slow.open();
    fast.open();

    run(slow, 15, 0.5);   // 30 FPS
    run(fast, 72, 0.5);   // 144 FPS

    // The old fixed-fraction lerp left these far apart: 72 frames of 10% is
    // essentially fully open while 15 frames is barely half.
    expect(fast.lidAngle).toBeCloseTo(slow.lidAngle, 2);
  });

  it('matches the historical feel at 60 FPS', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(0);
    chest.update(1000 / 60);
    // One 60 FPS frame at factor 0.10 moves a tenth of the way, as before.
    expect(chest.lidAngle).toBeCloseTo(0.1, 6);
  });

  it('does not advance on the first update', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(1000);
    expect(chest.lidAngle).toBe(0);
  });

  it('treats a timestamp of 0 as a real frame, not a reset', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(0);
    chest.update(100);
    // A `0` sentinel would have read "first frame" twice and never moved.
    expect(chest.lidAngle).toBeGreaterThan(0);
  });

  it('clamps a long stall so the lid cannot slam open', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(0);
    chest.update(10_000);
    // dt capped at 100 ms → six 60 FPS frames' worth, not 600.
    const sixFrames = 1 - Math.pow(1 - 0.1, 6);
    expect(chest.lidAngle).toBeCloseTo(sixFrames, 6);
  });

  it('falls back to one 60 FPS step when called without a timestamp', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update();
    expect(chest.lidAngle).toBeCloseTo(0.1, 6);
  });

  it('ignores a timestamp that goes backwards', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(1000);
    chest.update(500);
    expect(chest.lidAngle).toBe(0);
  });
});

describe('Chest — lidLerpFactor', () => {
  it('opens instantly at 1', () => {
    const chest = new Chest('c', 2, 2);
    chest.lidLerpFactor = 1;
    chest.open();
    chest.update(0);
    chest.update(16);
    expect(chest.lidAngle).toBe(1);
  });

  it('never moves at 0', () => {
    const chest = new Chest('c', 2, 2);
    chest.lidLerpFactor = 0;
    chest.open();
    run(chest, 60, 1);
    expect(chest.lidAngle).toBe(0);
  });

  it('clamps an out-of-range factor instead of producing NaN', () => {
    const chest = new Chest('c', 2, 2);
    chest.lidLerpFactor = -3;
    chest.open();
    run(chest, 10, 0.2);
    expect(Number.isFinite(chest.lidAngle)).toBe(true);
    expect(chest.lidAngle).toBe(0);
  });
});

/**
 * The draw path, which was 14% covered — the last large uncovered draw body.
 *
 * `garden-chest` sits in the WebGL fixture and the demo hands chests to players,
 * so what matters is the geometry contract: the body diamond is centred on the
 * chest's own tile, the lid hinges at the back, the glow only exists while open,
 * and nothing paints an illegal colour or alpha at any lid angle.
 */
const TILE_W = 64, TILE_H = 32;
const ORIGIN_X = 200, ORIGIN_Y = 150;

function drawAt(chest: Chest, lights: OmniLight[] = []) {
  const dc = createDrawContext({
    omniLights: lights, originX: ORIGIN_X, originY: ORIGIN_Y, tileW: TILE_W, tileH: TILE_H,
  });
  chest.draw(dc);
  return dc.recorder;
}

/** Screen position of a world point under the test draw context. */
function screen(wx: number, wy: number): { x: number; y: number } {
  const p = project(wx, wy, 0, TILE_W, TILE_H);
  return { x: ORIGIN_X + p.sx, y: ORIGIN_Y + p.sy };
}

/** Every y the painting touches, across path building and rectangles. */
function paintedYs(recorder: ReturnType<typeof drawAt>): number[] {
  const ys: number[] = [];
  for (const call of recorder.calls) {
    if (call.fn === 'moveTo' || call.fn === 'lineTo') ys.push(call.args[1]);
    if (call.fn === 'arc' || call.fn === 'ellipse') ys.push(call.args[1]);
  }
  return ys;
}

/** Open the lid fully without waiting out the lerp. */
function opened(chest: Chest): Chest {
  chest.open();
  for (let i = 0; i < 200; i++) chest.update(i * 16);
  return chest;
}

describe('Chest — draw geometry', () => {
  it('centres the body diamond on its own tile', () => {
    const chest = new Chest('c', 3, 4);
    const recorder = drawAt(chest);

    // hs = 0.38, so the ground corners are ±0.38 tiles from the centre. The
    // painting must stay inside that footprint horizontally.
    const west = screen(3 - 0.38, 4 + 0.38);
    const east = screen(3 + 0.38, 4 - 0.38);
    const xs = recorder.calls
      .filter((c) => c.fn === 'moveTo' || c.fn === 'lineTo')
      .map((c) => c.args[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(west.x - 1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(east.x + 1);
  });

  it('draws two body faces, four metal bands, four rivets and a latch', () => {
    const recorder = drawAt(new Chest('c', 2, 2));
    // Two wood faces + 2 bands x 2 faces = 6 quads, plus the lid quad and its
    // front band. Rivets and the latch are arcs and ellipses.
    expect(recorder.argsOf('fill').length).toBeGreaterThanOrEqual(8);
    // Four rivets, each a highlight arc plus a white speck.
    expect(recorder.argsOf('arc').length).toBeGreaterThanOrEqual(8);
    expect(recorder.argsOf('ellipse').length).toBe(1);   // the latch plate
  });

  it('lays the lid flat on the body top while closed', () => {
    const chest = new Chest('c', 2, 2);
    const recorder = drawAt(chest);
    const ground = screen(2 - 0.38, 2 - 0.38);
    // Body height is tileH * 1.1; a closed lid adds no height of its own, so the
    // highest painted point is the body top, not something above it.
    const highest = Math.min(...paintedYs(recorder));
    expect(highest).toBeGreaterThan(ground.y - TILE_H * 1.1 - 20);
  });
});

describe('Chest — draw when open', () => {
  it('adds the lid underside and the inner glow only once open', () => {
    const closed = drawAt(new Chest('c', 2, 2));
    const open = drawAt(opened(new Chest('c', 2, 2)));

    // The glow is a radial gradient; a closed chest creates none.
    expect(closed.argsOf('createRadialGradient').length).toBe(0);
    expect(open.argsOf('createRadialGradient').length).toBe(1);
    // Screen blending is scoped to the glow.
    expect(closed.valuesOf('globalCompositeOperation')).toEqual([]);
    expect(open.valuesOf('globalCompositeOperation')).toEqual(['screen']);
    // And the open chest paints strictly more.
    expect(open.argsOf('fill').length).toBeGreaterThan(closed.argsOf('fill').length);
  });

  it('keeps every alpha and colour legal at every lid angle', () => {
    for (let step = 0; step <= 10; step++) {
      const chest = new Chest('c', 2, 2);
      chest.open();
      for (let i = 0; i < step; i++) chest.update(i * 16);
      const recorder = drawAt(chest);

      for (const alpha of recorder.valuesOf('globalAlpha').map(Number)) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      for (const value of recorder.valuesOf('fillStyle')) {
        if (typeof value === 'string') expect(value).not.toContain('NaN');
      }
    }
  });

  it('brightens with a light and never overflows a channel', () => {
    const lit = drawAt(new Chest('c', 2, 2, '#ffffff'), Array.from(
      { length: 8 },
      (_, i) => new OmniLight({
        id: `l${i}`, x: 2, y: 2, z: 40, color: '#ffffff', intensity: 1, radius: 400,
      }),
    ));
    for (const value of lit.valuesOf('fillStyle')) {
      if (typeof value !== 'string') continue;
      for (const channel of value.match(/\d+/g) ?? []) {
        expect(Number(channel)).toBeLessThanOrEqual(255);
      }
    }
  });

  /**
   * A measurement, like `Boulder`'s.
   *
   * `aabb.maxZ` is a constant 51.2 px — body plus lid thickness at the standard
   * `tileH = 32`, which the comment on `aabb` is explicit about. It does not
   * account for the lid swinging up: a fully open lid lifts its front corners by
   * roughly the diamond's own screen width, so the silhouette rises well past
   * the declared height and depth sorting under-states an open chest.
   *
   * Pinned rather than changed: `maxZ` feeds `depthSort` and `ShadowCaster`, and
   * `garden-chest` sits in a pixel-gated fixture.
   */
  it('draws above its declared maxZ once the lid is open', () => {
    const chest = new Chest('c', 3, 4);
    const closedTop = Math.min(...paintedYs(drawAt(new Chest('c', 3, 4))));
    const openTop = Math.min(...paintedYs(drawAt(opened(chest))));
    const centre = screen(3, 4);
    // `AABB.maxZ` is optional on the type; a chest always declares one.
    const maxZ = chest.aabb.maxZ ?? 0;

    // Closed, the painting stays within the declared height.
    expect(closedTop).toBeGreaterThan(centre.y - maxZ);
    // Open, it does not.
    expect(openTop).toBeLessThan(centre.y - maxZ);
    expect(maxZ).toBeCloseTo(51.2, 6);
  });
});

describe('Chest — health bar', () => {
  it('draws nothing extra without a HealthComponent', () => {
    const recorder = drawAt(new Chest('c', 2, 2));
    expect(recorder.argsOf('fillRect').length).toBe(0);
  });

  it('draws a track and a fill above the lid, and drops both when destroyed', () => {
    const chest = new Chest('c', 2, 2);
    const health = chest.addComponent(new HealthComponent({ max: 40 }));
    health.takeDamage(10);   // 75%

    const rects = drawAt(chest).argsOf('fillRect');
    expect(rects.length).toBe(2);
    expect(rects[1][2]).toBeCloseTo(34 * 0.75, 6);

    health.takeDamage(30);
    expect(drawAt(chest).argsOf('fillRect').length).toBe(0);
  });
});

