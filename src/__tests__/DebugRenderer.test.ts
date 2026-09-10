import { describe, it, expect } from 'vitest';
import { DebugRenderer } from '../core/DebugRenderer';
import { Scene } from '../core/Scene';
import { TileCollider } from '../physics/TileCollider';
import { OmniLight } from '../lighting/OmniLight';
import { Entity } from '../ecs/Entity';
import { TriggerZoneComponent } from '../ecs/components/TriggerZoneComponent';
import { project } from '../math/IsoProjection';
import type { AABB } from '../math/depthSort';
import type { DrawContext } from '../elements/IsoObject';

/**
 * DebugRenderer was the largest 0%-coverage file in `src/core` (181 statements).
 * It is the tool you reach for while tuning an ARPG — aggro radii, light reach,
 * blocked tiles — so an overlay that draws the wrong size is worse than none.
 */

class Mob extends Entity {
  get aabb(): AABB {
    return {
      minX: this.position.x - 0.4, maxX: this.position.x + 0.4,
      minY: this.position.y - 0.4, maxY: this.position.y + 0.4,
      baseZ: 0,
    };
  }
  draw(_dc: DrawContext): void {}
}

interface Rec { ctx: CanvasRenderingContext2D; calls: unknown[][] }

function recorder(): Rec {
  const calls: unknown[][] = [];
  const ctx = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => { calls.push([prop, ...args]); },
    set: (_t, prop, value) => { calls.push(['set', prop, value]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function scene(): Scene {
  return new Scene({ tileW: 64, tileH: 32, cols: 4, rows: 4 });
}

function only(calls: unknown[][], name: string): unknown[][] {
  return calls.filter(c => c[0] === name);
}

describe('DebugRenderer — gating', () => {
  it('draws nothing while disabled', () => {
    const debug = new DebugRenderer(scene(), 400, 300);
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(r.calls.length).toBe(0);
  });

  it('drawPath does nothing while disabled or with an empty path', () => {
    const debug = new DebugRenderer(scene(), 400, 300);
    const r = recorder();
    debug.drawPath(r.ctx, [{ x: 1, y: 1 }], 0, 0, 0, 800, 600);
    expect(r.calls.length).toBe(0);

    debug.enabled = true;
    debug.drawPath(r.ctx, [], 0, 0, 0, 800, 600);
    expect(r.calls.length).toBe(0);
  });
});

describe('DebugRenderer — collision overlay', () => {
  it('fills every tile and strokes only the blocked ones', () => {
    const s = scene();
    const collider = new TileCollider(2, 2);
    collider.setWalkable(1, 0, false);
    s.collider = collider;

    const debug = new DebugRenderer(s, 400, 300, { showLights: false, showTriggers: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);

    expect(only(r.calls, 'fill').length).toBe(4);
    expect(only(r.calls, 'stroke').length).toBe(1);
  });

  it('is inert without a collider', () => {
    const debug = new DebugRenderer(scene(), 400, 300, { showLights: false, showTriggers: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(only(r.calls, 'fill').length).toBe(0);
  });
});

describe('DebugRenderer — AABB overlay', () => {
  it('reads the scene through its public object list', () => {
    const s = scene();
    s.addObject(new Mob('mob', 1, 1, 0));

    const debug = new DebugRenderer(s, 400, 300, {
      showAABB: true, showCollision: false, showLights: false, showTriggers: false,
    });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);

    // The overlay used to reach into Scene's private `objects` field through a
    // cast; `allObjects` is the supported way in.
    expect(only(r.calls, 'stroke').length).toBe(1);
    const line = only(r.calls, 'lineTo');
    expect(line.length).toBe(3);
  });

  it('stays off by default', () => {
    const s = scene();
    s.addObject(new Mob('mob', 1, 1, 0));
    const debug = new DebugRenderer(s, 400, 300, { showLights: false, showTriggers: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(only(r.calls, 'stroke').length).toBe(0);
  });
});

describe('DebugRenderer — light overlay', () => {
  it('draws the circle at the light\'s actual pixel radius', () => {
    const s = scene();
    s.addLight(new OmniLight({ id: 'torch', x: 2, y: 2, z: 0, radius: 320 }));

    const debug = new DebugRenderer(s, 400, 300, { showCollision: false, showTriggers: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);

    // `radius` is documented as screen pixels. The old expression divided and
    // multiplied by the same `tileW / 2` (a no-op) and then scaled by 0.18, so
    // a 320 px light was drawn as a 58 px ring.
    const arc = only(r.calls, 'arc')[0];
    expect(arc[3]).toBeCloseTo(320, 6);
  });

  it('places the ring at the projected light position, lifted by z', () => {
    const s = scene();
    s.addLight(new OmniLight({ id: 'torch', x: 3, y: 1, z: 48, radius: 100 }));

    const debug = new DebugRenderer(s, 400, 300, { showCollision: false, showTriggers: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);

    const { sx, sy } = project(3, 1, 0, 64, 32);
    const arc = only(r.calls, 'arc')[0];
    expect(arc[1]).toBeCloseTo(sx, 6);
    expect(arc[2]).toBeCloseTo(sy - 48, 6);
  });

  it('skips disabled lights', () => {
    const s = scene();
    const light = new OmniLight({ id: 'torch', x: 1, y: 1, z: 0 });
    light.enabled = false;
    s.addLight(light);

    const debug = new DebugRenderer(s, 400, 300, { showCollision: false, showTriggers: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(only(r.calls, 'arc').length).toBe(0);
  });
});

describe('DebugRenderer — trigger overlay', () => {
  it('maps a world-unit radius onto the isometric ellipse', () => {
    const s = scene();
    const mob = new Mob('mob', 2, 2, 0);
    mob.addComponent(new TriggerZoneComponent({ radius: 2 }));
    s.addObject(mob);

    const debug = new DebugRenderer(s, 400, 300, { showCollision: false, showLights: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);

    // The projection's singular values are tileW/√2 and tileH/√2, so a world
    // circle of radius r becomes an ellipse with those semi-axes times r. The
    // old code used r * tileW/2 and halved it, which assumed 2:1 tiles and was
    // still off by √2.
    const ellipse = only(r.calls, 'ellipse')[0];
    expect(ellipse[3]).toBeCloseTo(2 * 64 / Math.SQRT2, 6);
    expect(ellipse[4]).toBeCloseTo(2 * 32 / Math.SQRT2, 6);
  });

  it('ignores entities without a trigger zone', () => {
    const s = scene();
    s.addObject(new Mob('plain', 1, 1, 0));
    const debug = new DebugRenderer(s, 400, 300, { showCollision: false, showLights: false });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(only(r.calls, 'ellipse').length).toBe(0);
  });
});

describe('DebugRenderer — HUD panel', () => {
  function lines(calls: unknown[][]): string[] {
    return only(calls, 'fillText').map(c => String(c[1]));
  }

  it('reports a finite FPS from the second frame on', () => {
    const debug = new DebugRenderer(scene(), 400, 300, {
      showCollision: false, showLights: false, showTriggers: false,
    });
    debug.enabled = true;

    const first = recorder();
    debug.draw(first.ctx, 800, 600, 0);
    expect(lines(first.calls)).toContain('FPS: 0');

    const second = recorder();
    debug.draw(second.ctx, 800, 600, 1000 / 60);
    expect(lines(second.calls)).toContain('FPS: 60');
  });

  it('does not report an infinite FPS for a repeated timestamp', () => {
    const debug = new DebugRenderer(scene(), 400, 300, {
      showCollision: false, showLights: false, showTriggers: false,
    });
    debug.enabled = true;
    debug.draw(recorder().ctx, 800, 600, 1000);

    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    // `1000 / 0` is Infinity, which poisoned the running average forever.
    expect(lines(r.calls).some(l => l.includes('Infinity') || l.includes('NaN'))).toBe(false);
  });

  it('ignores a backwards timestamp instead of averaging a negative FPS', () => {
    const debug = new DebugRenderer(scene(), 400, 300, {
      showCollision: false, showLights: false, showTriggers: false,
    });
    debug.enabled = true;
    debug.draw(recorder().ctx, 800, 600, 1000);
    debug.draw(recorder().ctx, 800, 600, 1016);

    const r = recorder();
    debug.draw(r.ctx, 800, 600, 500);
    const fps = lines(r.calls).find(l => l.startsWith('FPS:'))!;
    expect(Number(fps.slice(5))).toBeGreaterThan(0);
  });

  it('counts the objects in the scene', () => {
    const s = scene();
    s.addObject(new Mob('a', 1, 1, 0));
    s.addObject(new Mob('b', 2, 2, 0));
    const debug = new DebugRenderer(s, 400, 300, {
      showCollision: false, showLights: false, showTriggers: false,
    });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(lines(r.calls)).toContain('Objects: 2');
  });

  it('lists only the enabled overlays', () => {
    const s = scene();
    const debug = new DebugRenderer(s, 400, 300, {
      showCollision: true, showAABB: false, showLights: false, showTriggers: true,
      showFps: false, showObjectCount: false,
    });
    debug.enabled = true;
    const r = recorder();
    debug.draw(r.ctx, 800, 600, 1000);
    expect(lines(r.calls)).toEqual(['[DEBUG]', 'Collision: ON', 'Triggers: ON']);
  });
});

describe('DebugRenderer — path overlay', () => {
  it('draws a dashed polyline plus one dot per waypoint', () => {
    const debug = new DebugRenderer(scene(), 400, 300);
    debug.enabled = true;
    const r = recorder();
    debug.drawPath(r.ctx, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], 0, 0, 0, 800, 600);

    expect(only(r.calls, 'lineTo').length).toBe(3);
    expect(only(r.calls, 'arc').length).toBe(3);
    expect(only(r.calls, 'setLineDash').some(c => Array.isArray(c[1]) && (c[1] as number[]).length === 2)).toBe(true);
  });

  it('setOrigin moves the overlay', () => {
    const s = scene();
    const debug = new DebugRenderer(s, 0, 0);
    debug.enabled = true;
    debug.setOrigin(100, 50);

    const r = recorder();
    debug.drawPath(r.ctx, [{ x: 1, y: 1 }], 0, 0, 0, 800, 600);
    // The camera transform carries the origin, so it must reach the context.
    expect(r.calls.some(c => c[0] === 'translate' || c[0] === 'setTransform')).toBe(true);
  });
});
