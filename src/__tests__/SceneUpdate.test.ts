import { describe, it, expect, vi } from 'vitest';
import { Scene } from '../core/Scene';
import { System } from '../ecs/System';
import { Entity } from '../ecs/Entity';
import { IsoObject, type DrawContext } from '../elements/IsoObject';
import type { AABB } from '../math/depthSort';

/**
 * Scene.update() tests.
 *
 * Scene is the container everything else runs through, yet its update path sat
 * at 66% branches. The dt bookkeeping in particular had the `_lastTs === 0`
 * sentinel collision that FloatingText and Chest had already demonstrated.
 */

class Probe extends IsoObject {
  updates: Array<number | undefined> = [];
  constructor(id: string, x = 1, y = 1) { super(id, x, y, 0); }
  get aabb(): AABB {
    return { minX: this.position.x, maxX: this.position.x, minY: this.position.y, maxY: this.position.y, baseZ: 0 };
  }
  draw(_dc: DrawContext): void {}
  update(ts?: number): void { this.updates.push(ts); }
}

class Recorder extends System {
  readonly query = [];
  readonly dts: number[] = [];
  override readonly priority: number;
  constructor(public readonly tag: string, priority = 0) { super(); this.priority = priority; }
  override matches(_entity: Entity): boolean { return true; }
  update(_entities: Entity[], dt: number): void { this.dts.push(dt); }
}

function scene(): Scene {
  return new Scene({ tileW: 64, tileH: 32, cols: 8, rows: 8 });
}

describe('Scene.update — frame delta', () => {
  it('reports 0 for the first frame, like Engine', () => {
    const s = scene();
    const sys = s.addSystem(new Recorder('a'));
    s.update(1000);
    expect(sys.dts).toEqual([0]);
  });

  it('measures a real delta on the second frame after ts 0', () => {
    const s = scene();
    const sys = s.addSystem(new Recorder('a'));
    s.update(0);
    s.update(100);
    // The old `_lastTs === 0` sentinel stayed armed here and handed out an
    // invented 1/60 instead of the actual 0.1 s.
    expect(sys.dts[1]).toBeCloseTo(0.1, 6);
  });

  it('clamps a long stall', () => {
    const s = scene();
    const sys = s.addSystem(new Recorder('a'));
    s.update(0);
    s.update(10_000);
    expect(sys.dts[1]).toBeCloseTo(0.1, 6);
  });

  it('never reports a negative delta', () => {
    const s = scene();
    const sys = s.addSystem(new Recorder('a'));
    s.update(1000);
    s.update(500);
    expect(sys.dts[1]).toBe(0);
  });
});

describe('Scene.update — systems', () => {
  it('runs systems in priority order', () => {
    const s = scene();
    const order: string[] = [];
    const late = new Recorder('late', 10);
    const early = new Recorder('early', -10);
    vi.spyOn(late, 'update').mockImplementation(() => { order.push('late'); });
    vi.spyOn(early, 'update').mockImplementation(() => { order.push('early'); });

    s.addSystem(late);
    s.addSystem(early);
    s.update(0);
    expect(order).toEqual(['early', 'late']);
  });

  it('removeSystem detaches and stops updates', () => {
    const s = scene();
    const sys = s.addSystem(new Recorder('a'));
    expect(s.removeSystem(sys)).toBe(true);
    expect(s.removeSystem(sys)).toBe(false);
    s.update(0);
    expect(sys.dts).toEqual([]);
  });

  it('adding the same system twice is a no-op', () => {
    const s = scene();
    const sys = new Recorder('a');
    s.addSystem(sys);
    s.addSystem(sys);
    expect(s.systems.length).toBe(1);
  });
});

describe('Scene.update — objects', () => {
  it('forwards the raw timestamp to object updates', () => {
    const s = scene();
    const probe = new Probe('p');
    s.addObject(probe);
    s.update(1234);
    expect(probe.updates).toEqual([1234]);
  });

  it('skips invisible objects', () => {
    const s = scene();
    const probe = new Probe('p');
    probe.visible = false;
    s.addObject(probe);
    s.update(0);
    expect(probe.updates).toEqual([]);
  });

  it('tolerates an object removing itself during its own update', () => {
    const s = scene();
    const first = new Probe('first', 1, 1);
    const second = new Probe('second', 2, 2);
    s.addObject(first);
    s.addObject(second);
    vi.spyOn(first, 'update').mockImplementation(() => { s.removeById('first'); });

    s.update(0);
    // The second object must still be visited — removeById replaces the array
    // rather than splicing it, so the in-flight iteration keeps its snapshot.
    expect(second.updates).toEqual([0]);
    expect(s.getById('first')).toBeUndefined();
  });
});

describe('Scene — view transition', () => {
  it('applies immediately at duration 0', () => {
    const s = scene();
    s.transitionView({ rotation: 0.5, elevation: 0.8 }, 0);
    expect(s.view.rotation).toBeCloseTo(0.5, 6);
    expect(s.view.elevation).toBeCloseTo(0.8, 6);
  });

  it('eases toward the target and lands exactly on it', () => {
    const s = scene();
    const from = s.view.rotation;
    s.transitionView({ rotation: 1 }, 0.2);

    s.update(0);
    s.update(50);
    const mid = s.view.rotation;
    expect(mid).toBeGreaterThan(from);
    expect(mid).toBeLessThan(1);

    for (let t = 100; t <= 400; t += 50) s.update(t);
    expect(s.view.rotation).toBe(1);
  });

  it('keeps unspecified axes at their current value', () => {
    const s = scene();
    const elevation = s.view.elevation;
    s.transitionView({ rotation: 0.3 }, 0);
    expect(s.view.elevation).toBeCloseTo(elevation, 6);
  });
});
