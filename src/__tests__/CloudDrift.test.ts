import { describe, it, expect } from 'vitest';
import { Cloud } from '../elements/props/Cloud';
import { project } from '../math/IsoProjection';
import { createDrawContext } from './helpers/canvas';

/**
 * `Cloud` was the least-covered element after `Boulder` and `Chest` — 18% of its
 * lines — and the untested half held the tenth instance of this project's most
 * repeated defect: `_lastTs = 0` as a first-frame sentinel, which collides with
 * the legitimate timestamp 0 that `Engine` hands out on its first frame. A cloud
 * in a scene started that way never drifted at all.
 */

describe('Cloud — drift', () => {
  it('reports nothing on the first frame', () => {
    const cloud = new Cloud({ id: 'c', x: 2, y: 3, speed: 1 });
    cloud.update(1000);
    expect(cloud.position.x).toBe(2);
    expect(cloud.position.y).toBe(3);
  });

  it('drifts along its angle', () => {
    const cloud = new Cloud({ id: 'c', x: 0, y: 0, speed: 2, angle: 0 });
    cloud.update(1000);
    cloud.update(1050);   // 50 ms
    expect(cloud.position.x).toBeCloseTo(0.1);
    expect(cloud.position.y).toBeCloseTo(0);

    const diagonal = new Cloud({ id: 'd', x: 0, y: 0, speed: 2, angle: Math.PI / 2 });
    diagonal.update(0);
    diagonal.update(50);
    expect(diagonal.position.x).toBeCloseTo(0);
    expect(diagonal.position.y).toBeCloseTo(0.1);
  });

  it('drifts after a first frame at timestamp 0', () => {
    // `Engine` starts its clock at 0, and 0 used to double as "not started",
    // leaving the sentinel armed forever: the cloud stood still for the whole run.
    const cloud = new Cloud({ id: 'c', x: 0, y: 0, speed: 2 });
    cloud.update(0);
    cloud.update(50);
    cloud.update(100);
    expect(cloud.position.x).toBeCloseTo(0.2);
  });

  it('clamps a long gap instead of teleporting', () => {
    const cloud = new Cloud({ id: 'c', x: 0, y: 0, speed: 2 });
    cloud.update(0);
    cloud.update(5000);            // 5 s while the tab was hidden
    expect(cloud.position.x).toBeCloseTo(0.2);   // clamped to 100 ms
  });

  it('never drifts backwards when the clock does', () => {
    const cloud = new Cloud({ id: 'c', x: 5, y: 5, speed: 2 });
    cloud.update(1000);
    cloud.update(500);
    expect(cloud.position.x).toBe(5);
    expect(cloud.position.y).toBe(5);
    // …and the rewound timestamp becomes the new baseline, so the next frame is
    // measured from it rather than producing one giant catch-up step.
    cloud.update(550);
    expect(cloud.position.x).toBeCloseTo(5.1);
  });

  it('wraps around every edge of the scene', () => {
    const east = new Cloud({ id: 'e', x: 14.1, y: 5, speed: 0 });
    east.boundsX = 12;
    east.update(0);
    east.update(16);
    expect(east.position.x).toBe(-2);

    const west = new Cloud({ id: 'w', x: -2.1, y: 5, speed: 0 });
    west.boundsX = 12;
    west.update(0);
    west.update(16);
    expect(west.position.x).toBe(14);

    const south = new Cloud({ id: 's', x: 5, y: 14.1, speed: 0 });
    south.boundsY = 12;
    south.update(0);
    south.update(16);
    expect(south.position.y).toBe(-2);

    const north = new Cloud({ id: 'n', x: 5, y: -2.1, speed: 0 });
    north.boundsY = 12;
    north.update(0);
    north.update(16);
    expect(north.position.y).toBe(14);
  });
});

describe('Cloud — geometry', () => {
  it('keeps altitude in screen pixels, and reports it back in world units', () => {
    const cloud = new Cloud({ id: 'c', x: 1, y: 1, altitude: 6 });
    expect(cloud.position.z).toBe(192);
    expect(cloud.altitude).toBe(6);
  });

  it('sizes its AABB from the scale, above its own altitude', () => {
    const cloud = new Cloud({ id: 'c', x: 4, y: 4, altitude: 5, scale: 2 });
    const box = cloud.aabb;
    expect(box.minX).toBeCloseTo(4 - 2.4);
    expect(box.maxX).toBeCloseTo(4 + 2.4);
    expect(box.baseZ).toBe(160);
    expect(box.maxZ).toBe(160 + 64);
  });
});

describe('Cloud — draw', () => {
  it('drops its shadow on the ground, not under the body', () => {
    const cloud = new Cloud({ id: 'c', x: 3, y: 2, altitude: 6 });
    const dc = createDrawContext({ originX: 100, originY: 50 });
    cloud.draw(dc);

    const ground = project(3, 2, 0, 64, 32);
    const [shadow] = dc.recorder.argsOf('ellipse');
    expect(shadow[0]).toBeCloseTo(100 + ground.sx);
    expect(shadow[1]).toBeCloseTo(50 + ground.sy);

    // The body is translated to the elevated projection, 192 px higher up.
    const [translate] = dc.recorder.argsOf('translate');
    expect(translate[1]).toBeCloseTo(50 + ground.sy - 192);
  });

  it('scales the shadow with the cloud', () => {
    const small = createDrawContext();
    new Cloud({ id: 'a', x: 1, y: 1, scale: 1 }).draw(small);
    const big = createDrawContext();
    new Cloud({ id: 'b', x: 1, y: 1, scale: 2 }).draw(big);

    const [[, , rxSmall, rySmall]] = small.recorder.argsOf('ellipse');
    const [[, , rxBig, ryBig]] = big.recorder.argsOf('ellipse');
    expect(rxBig).toBeCloseTo(rxSmall * 2);
    expect(ryBig).toBeCloseTo(rySmall * 2);
  });

  it('is deterministic for a given seed, and differs between seeds', () => {
    const first = createDrawContext();
    new Cloud({ id: 'a', x: 1, y: 1, seed: 0.42 }).draw(first);
    const again = createDrawContext();
    new Cloud({ id: 'b', x: 1, y: 1, seed: 0.42 }).draw(again);
    const other = createDrawContext();
    new Cloud({ id: 'c', x: 1, y: 1, seed: 0.91 }).draw(other);

    expect(again.recorder.argsOf('lineTo')).toEqual(first.recorder.argsOf('lineTo'));
    expect(other.recorder.argsOf('lineTo')).not.toEqual(first.recorder.argsOf('lineTo'));
  });

  it('hands the canvas back at full opacity', () => {
    const dc = createDrawContext();
    new Cloud({ id: 'c', x: 1, y: 1 }).draw(dc);
    const alphas = dc.recorder.valuesOf('globalAlpha');
    expect(alphas.length).toBeGreaterThan(1);
    expect(alphas[alphas.length - 1]).toBe(1);
    // Every save is matched by a restore.
    const names = dc.recorder.names();
    expect(names.filter(n => n === 'save').length).toBe(names.filter(n => n === 'restore').length);
  });
});
