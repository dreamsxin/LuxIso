import { describe, it, expect } from 'vitest';
import { ClickMover } from '../core/ClickMover';
import { Camera } from '../core/Camera';
import { TileCollider } from '../physics/TileCollider';
import type { InputManager } from '../core/InputManager';
import type { InputMap } from '../core/InputMap';

/**
 * ClickMover integration tests.
 *
 * The real InputManager needs a canvas and window listeners, so input is faked
 * at the two members ClickMover actually reads: `input.pointer` and
 * `map.axis()`. Camera and TileCollider are the real classes — the click path
 * goes through `camera.screenToWorld`, and pinning that interplay is half the
 * point of testing this class at all.
 */

const TILE_W = 64;
const TILE_H = 32;
const ORIGIN_X = 400;
const ORIGIN_Y = 300;
const CANVAS_W = 800;
const CANVAS_H = 600;

interface Fakes {
  input: InputManager;
  map: InputMap;
  press(worldX: number, worldY: number, camera: Camera): void;
  release(): void;
  hold(dir: 'up' | 'down' | 'left' | 'right' | null): void;
}

function makeFakes(): Fakes {
  const pointer = { x: 0, y: 0, pressed: false, down: false };
  let held: string | null = null;

  const input = { pointer } as unknown as InputManager;
  const map = {
    axis(px: string, nx: string, py: string, ny: string) {
      let x = 0, y = 0;
      if (held === 'right') x = 1;
      if (held === 'left')  x = -1;
      if (held === 'down')  y = 1;
      if (held === 'up')    y = -1;
      void px; void nx; void py; void ny;
      return { x, y };
    },
  } as unknown as InputMap;

  return {
    input,
    map,
    press(worldX, worldY, camera) {
      const s = camera.worldToScreen(worldX, worldY, 0, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y);
      pointer.x = s.sx;
      pointer.y = s.sy;
      pointer.pressed = true;
    },
    release() { pointer.pressed = false; },
    hold(dir) { held = dir; },
  };
}

function step(
  mover: ClickMover,
  f: Fakes,
  camera: Camera,
  dt: number,
  x: number,
  y: number,
): { x: number; y: number } {
  mover.update(
    dt, f.input, f.map, camera,
    TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, CANVAS_W, CANVAS_H,
    x, y,
  );
  return { x: x + mover.velX, y: y + mover.velY };
}

describe('ClickMover — frame-rate independence', () => {
  it('covers the same distance at 30 FPS as at 60 FPS', () => {
    const camera = new Camera();
    const mover60 = new ClickMover({ cols: 40, rows: 40, speed: 0.08 });
    const mover30 = new ClickMover({ cols: 40, rows: 40, speed: 0.08 });
    const f60 = makeFakes();
    const f30 = makeFakes();
    f60.hold('right');
    f30.hold('right');

    let p60 = { x: 5, y: 5 };
    for (let i = 0; i < 20; i++) p60 = step(mover60, f60, camera, 1 / 60, p60.x, p60.y);

    let p30 = { x: 5, y: 5 };
    for (let i = 0; i < 10; i++) p30 = step(mover30, f30, camera, 1 / 30, p30.x, p30.y);

    expect(p30.x).toBeCloseTo(p60.x, 6);
    expect(p30.y).toBeCloseTo(p60.y, 6);
  });

  it('does not move twice as fast on a 120 Hz display', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 40, rows: 40, speed: 0.08 });
    const f = makeFakes();
    f.hold('right');

    let p = { x: 5, y: 5 };
    for (let i = 0; i < 120; i++) p = step(mover, f, camera, 1 / 120, p.x, p.y);

    // One second of input at speed 0.08/frame@60 == 4.8 world units.
    expect(p.x - 5).toBeCloseTo(4.8, 6);
  });

  it('keeps a 60 FPS step numerically equal to `speed`', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 40, rows: 40, speed: 0.08 });
    const f = makeFakes();
    f.hold('right');

    step(mover, f, camera, 1 / 60, 5, 5);
    expect(mover.velX).toBeCloseTo(0.08, 9);
  });

  it('produces no displacement when dt is 0 (Engine reports that on frame 1)', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 40, rows: 40, speed: 0.08 });
    const f = makeFakes();
    f.hold('right');

    step(mover, f, camera, 0, 5, 5);
    expect(mover.velX).toBe(0);
    expect(mover.velY).toBe(0);
  });

  it('ignores a negative dt instead of walking backwards', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 40, rows: 40, speed: 0.08 });
    const f = makeFakes();
    f.hold('right');

    step(mover, f, camera, -0.5, 5, 5);
    expect(mover.velX).toBe(0);
  });
});

describe('ClickMover — click-to-move', () => {
  it('walks toward the clicked tile and stops there', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const f = makeFakes();

    f.press(12, 5, camera);
    let p = step(mover, f, camera, 1 / 60, 5, 5);
    f.release();

    expect(p.x).toBeGreaterThan(5);
    // The marker is stamped at full alpha, then faded by the same frame's dt.
    expect(mover.markerAlpha).toBeCloseTo(1 - 1.8 / 60, 6);

    for (let i = 0; i < 400 && mover.velX !== 0; i++) {
      p = step(mover, f, camera, 1 / 60, p.x, p.y);
    }
    expect(p.x).toBeCloseTo(12, 6);
    expect(p.y).toBeCloseTo(5, 6);
  });

  it('lands exactly on the target at any frame rate, not one step short', () => {
    const camera = new Camera();
    const slow = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const fast = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const fSlow = makeFakes();
    const fFast = makeFakes();

    fSlow.press(12, 5, camera);
    fFast.press(12, 5, camera);

    let pSlow = { x: 5, y: 5 };
    let pFast = { x: 5, y: 5 };
    // 24 FPS: the leftover distance used to scale with frame time, so a slow
    // frame parked the entity visibly short of where the player clicked.
    for (let i = 0; i < 200; i++) pSlow = step(slow, fSlow, camera, 1 / 24, pSlow.x, pSlow.y);
    for (let i = 0; i < 600; i++) pFast = step(fast, fFast, camera, 1 / 144, pFast.x, pFast.y);

    expect(pSlow.x).toBeCloseTo(12, 6);
    expect(pFast.x).toBeCloseTo(12, 6);
  });


  it('clamps the click target inside the grid', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 10, rows: 10, speed: 0.08 });
    const f = makeFakes();

    f.press(99, 99, camera);
    step(mover, f, camera, 1 / 60, 5, 5);
    expect(mover.markerX).toBeCloseTo(9.5, 6);
    expect(mover.markerY).toBeCloseTo(9.5, 6);
  });

  it('keyboard input cancels a pending click target', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const f = makeFakes();

    f.press(12, 5, camera);
    step(mover, f, camera, 1 / 60, 5, 5);
    f.release();
    f.hold('up');
    const p = step(mover, f, camera, 1 / 60, 5, 5);
    expect(p.y).toBeLessThan(5);

    f.hold(null);
    step(mover, f, camera, 1 / 60, p.x, p.y);
    expect(mover.velX).toBe(0);
    expect(mover.velY).toBe(0);
  });

  it('fades the marker with dt and reset() clears it', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const f = makeFakes();

    f.press(12, 5, camera);
    step(mover, f, camera, 1 / 60, 5, 5);
    f.release();
    const stamped = 1 - 1.8 / 60;
    expect(mover.markerAlpha).toBeCloseTo(stamped, 6);

    step(mover, f, camera, 0.25, 5, 5);
    expect(mover.markerAlpha).toBeCloseTo(stamped - 0.25 * 1.8, 6);


    mover.reset();
    expect(mover.markerAlpha).toBe(0);
    expect(mover.velX).toBe(0);
    expect(mover.velY).toBe(0);
  });
});

describe('ClickMover — marker rendering', () => {
  function recorder(): { ctx: CanvasRenderingContext2D; calls: string[] } {
    const calls: string[] = [];
    const ctx = {
      save()      { calls.push('save'); },
      restore()   { calls.push('restore'); },
      beginPath() { calls.push('beginPath'); },
      arc()       { calls.push('arc'); },
      moveTo()    { calls.push('moveTo'); },
      lineTo()    { calls.push('lineTo'); },
      stroke()    { calls.push('stroke'); },
      fill()      { calls.push('fill'); },
      set strokeStyle(_v: string) {},
      set fillStyle(_v: string) {},
      set lineWidth(_v: number) {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it('skips drawing entirely once the marker has faded out', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const { ctx, calls } = recorder();

    mover.drawMarker(ctx, camera, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, 1000);
    expect(calls).toEqual([]);
  });

  it('draws a balanced save/restore pair while the marker is visible', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 20, rows: 20, speed: 0.08 });
    const f = makeFakes();
    f.press(12, 5, camera);
    step(mover, f, camera, 1 / 60, 5, 5);
    f.release();

    const { ctx, calls } = recorder();
    mover.drawMarker(ctx, camera, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, 1000);

    expect(calls[0]).toBe('save');
    expect(calls[calls.length - 1]).toBe('restore');
    expect(calls.filter(c => c === 'arc').length).toBe(2);
    expect(calls).toContain('fill');
  });
});

describe('ClickMover — bounds and collision', () => {
  it('clamps to the grid when there is no collider', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 10, rows: 10, speed: 0.5 });
    const f = makeFakes();
    f.hold('right');

    let p = { x: 9.0, y: 5 };
    for (let i = 0; i < 20; i++) p = step(mover, f, camera, 1 / 60, p.x, p.y);
    expect(p.x).toBeCloseTo(9.5, 6);
  });

  it('a collider blocks movement into a wall', () => {
    const camera = new Camera();
    const collider = new TileCollider(10, 10);
    for (let r = 0; r < 10; r++) collider.setWalkable(7, r, false);
    const mover = new ClickMover({ cols: 10, rows: 10, speed: 0.5, radius: 0.3, collider });
    const f = makeFakes();
    f.hold('right');

    let p = { x: 5.5, y: 5.5 };
    for (let i = 0; i < 40; i++) p = step(mover, f, camera, 1 / 60, p.x, p.y);
    expect(p.x).toBeLessThan(7);
  });

  it('a deflected click target is abandoned rather than retried forever', () => {
    const camera = new Camera();
    const collider = new TileCollider(10, 10);
    for (let r = 0; r < 10; r++) collider.setWalkable(7, r, false);
    const mover = new ClickMover({ cols: 10, rows: 10, speed: 0.5, radius: 0.3, collider });
    const f = makeFakes();

    // Target sits on the far side of the wall.
    f.press(9.5, 5.5, camera);
    let p = { x: 5.5, y: 5.5 };
    for (let i = 0; i < 40; i++) p = step(mover, f, camera, 1 / 60, p.x, p.y);
    f.release();

    expect(p.x).toBeLessThan(7);
    expect(mover.velX).toBe(0);
  });

  it('the collider keeps the entity inside the grid (out of bounds is blocked)', () => {
    const camera = new Camera();
    const collider = new TileCollider(10, 10);
    const mover = new ClickMover({ cols: 10, rows: 10, speed: 0.5, radius: 0.3, collider });
    const f = makeFakes();
    f.hold('right');

    let p = { x: 8.5, y: 5.5 };
    for (let i = 0; i < 40; i++) p = step(mover, f, camera, 1 / 60, p.x, p.y);
    expect(p.x).toBeLessThanOrEqual(10);
    expect(p.x).toBeGreaterThan(9);
  });
});
