import {describe, it, expect} from 'vitest';
import {Camera} from '../core/Camera';

describe('Camera — construction', () => {
  it('defaults to (0,0) zoom 1', () => {
    const cam = new Camera();
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.zoom).toBe(1);
  });

  it('accepts initial options', () => {
    const cam = new Camera({x: 3, y: 4, zoom: 2});
    expect(cam.x).toBe(3);
    expect(cam.y).toBe(4);
    expect(cam.zoom).toBe(2);
  });
});

describe('Camera — setZoom', () => {
  it('clamps zoom to [0.25, 4]', () => {
    const cam = new Camera();
    cam.setZoom(0);
    expect(cam.zoom).toBe(0.25);
    cam.setZoom(10);
    expect(cam.zoom).toBe(4);
    cam.setZoom(1.5);
    expect(cam.zoom).toBe(1.5);
  });
});

describe('Camera — pan', () => {
  it('moves camera position', () => {
    const cam = new Camera({x: 1, y: 2});
    cam.pan(3, -1);
    expect(cam.x).toBe(4);
    expect(cam.y).toBe(1);
  });

  it('clamps to bounds', () => {
    const cam = new Camera({x: 5, y: 5});
    cam.setBounds({minX: 0, minY: 0, maxX: 6, maxY: 6});
    cam.pan(5, 5);
    expect(cam.x).toBe(6);
    expect(cam.y).toBe(6);
  });
});

describe('Camera — worldToScreen / screenToWorld round-trip', () => {
  const TW = 64, TH = 32;
  const OX = 320, OY = 240;

  it('round-trips world → screen → world', () => {
    const cam = new Camera({x: 0, y: 0, zoom: 1});
    const cases: [number, number][] = [[0, 0], [3, 2], [5, 5]];
    for (const [wx, wy] of cases) {
      const {sx, sy} = cam.worldToScreen(wx, wy, 0, TW, TH, OX, OY);
      const {x, y} = cam.screenToWorld(sx, sy, 640, 480, TW, TH, OX, OY);
      expect(x).toBeCloseTo(wx, 6);
      expect(y).toBeCloseTo(wy, 6);
    }
  });

  it('zoom affects screen position', () => {
    const cam1 = new Camera({zoom: 1});
    const cam2 = new Camera({zoom: 2});
    const p1 = cam1.worldToScreen(3, 0, 0, TW, TH, OX, OY);
    const p2 = cam2.worldToScreen(3, 0, 0, TW, TH, OX, OY);
    // With zoom=2, the offset from origin should be doubled
    expect(p2.sx - OX).toBeCloseTo((p1.sx - OX) * 2, 6);
  });
});

describe('Camera — lerp follow', () => {
  it('lerpFactor=1 snaps immediately', () => {
    const cam = new Camera({lerpFactor: 1});
    const target = {id: 't', position: {x: 7, y: 3, z: 0}, aabb: {} as never, draw: () => {}} as never;
    cam.follow(target);
    cam.update();
    expect(cam.x).toBe(7);
    expect(cam.y).toBe(3);
  });

  it('lerpFactor<1 moves toward target gradually', () => {
    const cam = new Camera({x: 0, y: 0, lerpFactor: 0.5});
    const target = {id: 't', position: {x: 10, y: 0, z: 0}, aabb: {} as never, draw: () => {}} as never;
    cam.follow(target);
    cam.update();
    expect(cam.x).toBeCloseTo(5, 6);
  });

  it('stops tracking after unfollow, and leaves the camera where it was', () => {
    const cam = new Camera({lerpFactor: 1});
    const target = {id: 't', position: {x: 7, y: 3, z: 0}, aabb: {} as never, draw: () => {}} as never;
    cam.follow(target);
    cam.update();

    cam.unfollow();
    target.position.x = 99;
    target.position.y = 99;
    cam.update();

    // Still at the position the last followed frame put it in: unfollow drops
    // the target, it does not recentre or reset.
    expect(cam.x).toBe(7);
    expect(cam.y).toBe(3);
  });
});
