import { describe, it, expect } from 'vitest';
import { ClickMover } from '../core/ClickMover';
import { Camera } from '../core/Camera';
import type { InputManager } from '../core/InputManager';
import type { InputMap } from '../core/InputMap';
import type { IsoView } from '../math/IsoProjection';
import { createDrawContext } from './helpers/canvas';

/**
 * Picking under a rotated view.
 *
 * `SceneRenderer` hands `scene.view` to `Camera.applyTransform`, so the pixels on
 * screen carry the rotation matrix and the elevation Y-scale. Every picking call
 * site omitted that argument, and `screenToWorld` skips both when `view` is
 * undefined — so the helpers were exact inverses of each other but not of the
 * transform actually on screen. `CameraViewTransform.test.ts` proved the helpers
 * agree with the CTM; nothing checked that the callers pass the view at all, and
 * `ClickMover.test.ts` cannot: it builds the click position with the same
 * no-view call the production code made, so the two errors cancel.
 *
 * `src/main.ts` wires a rotation slider straight to `scene.transitionView`, so
 * this was reachable by dragging one slider and clicking.
 */

const TILE_W = 64;
const TILE_H = 32;
const ORIGIN_X = 400;
const ORIGIN_Y = 300;
const CANVAS_W = 800;
const CANVAS_H = 600;
const VIEW: IsoView = { rotation: 90, elevation: 0.25 };

function fakes() {
  const pointer = { x: 0, y: 0, pressed: false, down: false };
  const input = { pointer } as unknown as InputManager;
  const map = { axis: () => ({ x: 0, y: 0 }) } as unknown as InputMap;
  return { pointer, input, map };
}

/** Where the renderer actually puts a world point, view included. */
function onScreen(camera: Camera, wx: number, wy: number): { sx: number; sy: number } {
  return camera.worldToScreen(wx, wy, 0, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, VIEW);
}

function move(
  mover: ClickMover,
  input: InputManager,
  map: InputMap,
  camera: Camera,
  view?: IsoView,
): void {
  mover.update(
    1 / 60, input, map, camera,
    TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, CANVAS_W, CANVAS_H,
    1, 1, view,
  );
}

describe('ClickMover — picking under a rotated view', () => {
  it('lands on the tile under the cursor when the view is passed', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 16, rows: 12, speed: 0.08 });
    const { pointer, input, map } = fakes();

    const spot = onScreen(camera, 6, 3);
    pointer.x = spot.sx; pointer.y = spot.sy; pointer.pressed = true;
    move(mover, input, map, camera, VIEW);

    expect(mover.markerX).toBeCloseTo(6, 6);
    expect(mover.markerY).toBeCloseTo(3, 6);
  });


  it('lands somewhere else entirely when the view is omitted', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 16, rows: 12, speed: 0.08 });
    const { pointer, input, map } = fakes();

    const spot = onScreen(camera, 6, 3);
    pointer.x = spot.sx; pointer.y = spot.sy; pointer.pressed = true;
    // The call the production code used to make.
    move(mover, input, map, camera, undefined);

    const off = Math.hypot(mover.markerX - 6, mover.markerY - 3);

    // Not a rounding error: a whole-tile miss, which is what made a click walk
    // the character to a mirrored tile.
    expect(off).toBeGreaterThan(1);
  });

  it('draws the marker on the tile it targeted', () => {
    const camera = new Camera();
    const mover = new ClickMover({ cols: 16, rows: 12, speed: 0.08 });
    const { pointer, input, map } = fakes();

    const spot = onScreen(camera, 6, 3);
    pointer.x = spot.sx; pointer.y = spot.sy; pointer.pressed = true;
    move(mover, input, map, camera, VIEW);

    const dc = createDrawContext({ tileW: TILE_W, tileH: TILE_H, originX: ORIGIN_X, originY: ORIGIN_Y });
    mover.drawMarker(dc.ctx, camera, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, 0, VIEW);

    const arcs = dc.recorder.argsOf('arc');
    expect(arcs.length).toBeGreaterThan(0);
    // The marker rings are centred on the click, so the first arc must sit where
    // the cursor was — the round trip the player judges this feature by.
    expect(arcs[0][0] as number).toBeCloseTo(spot.sx, 6);
    expect(arcs[0][1] as number).toBeCloseTo(spot.sy, 6);
  });
});

describe('Camera — hardening the inverse transform', () => {
  it('treats a partial view the way applyTransform does, instead of returning NaN', () => {
    const camera = new Camera();
    // Legal from `Engine.loadSceneJson`, which merges an untyped object: the
    // strict `view.elevation !== 0.5` test made `sy *= undefined / 0.5` = NaN,
    // so the scene rendered correctly and every pick came back NaN.
    const partial = { rotation: 45 } as unknown as IsoView;

    const screen = camera.worldToScreen(4, 4, 0, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, partial);
    expect(Number.isFinite(screen.sx)).toBe(true);
    expect(Number.isFinite(screen.sy)).toBe(true);

    const world = camera.screenToWorld(
      screen.sx, screen.sy, CANVAS_W, CANVAS_H, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y, partial,
    );
    expect(world.x).toBeCloseTo(4, 6);
    expect(world.y).toBeCloseTo(4, 6);
  });

  it('survives a zoom of 0 written straight to the field', () => {
    const camera = new Camera();
    // `setZoom` clamps to [0.25, 4]; `zoom` is a plain public field and does not.
    // Dividing by it produced Infinity, then NaN, and a NaN target is permanent:
    // `dist` is NaN, so no arrival check ever passes.
    camera.zoom = 0;
    const world = camera.screenToWorld(
      500, 400, CANVAS_W, CANVAS_H, TILE_W, TILE_H, ORIGIN_X, ORIGIN_Y,
    );
    expect(Number.isFinite(world.x)).toBe(true);
    expect(Number.isFinite(world.y)).toBe(true);
  });
});

