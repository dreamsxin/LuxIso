import { describe, it, expect, afterEach, vi } from 'vitest';
import { SceneExtractor } from '../../webgl-next/src/extraction/SceneExtractor';
import { Scene } from '../core/Scene';
import { IsoObject, type DrawContext } from '../elements/IsoObject';
import type { AABB } from '../math/depthSort';

/**
 * Extractor registry tests.
 *
 * Dispatch for built-in types is a hardcoded `instanceof` chain, and everything
 * else became a magenta diagnostic diamond with no way to opt in — which made
 * every custom `IsoObject` subclass unrenderable on the WebGL path. These pin
 * the registry that fixes it, including the guards around running application
 * code inside the render path.
 */

class Prop extends IsoObject {
  constructor(id: string, x = 2, y = 2) { super(id, x, y, 0); }
  get aabb(): AABB {
    return {
      minX: this.position.x, maxX: this.position.x + 1,
      minY: this.position.y, maxY: this.position.y + 1,
      baseZ: 0,
    };
  }
  draw(_dc: DrawContext): void { /* canvas path, unused here */ }
}

class SpecialProp extends Prop {}

const OPTS = { viewportWidth: 400, viewportHeight: 300 };

function sceneWith(...objects: IsoObject[]): Scene {
  const scene = new Scene({ tileW: 64, tileH: 32, cols: 8, rows: 8 });
  for (const o of objects) scene.addObject(o);
  return scene;
}

/** Emits a small quad so the extractor sees real geometry. */
function quadExtractor(color: readonly [number, number, number, number] = [1, 1, 1, 1]) {
  return (obj: IsoObject, ctx: { builder: any; pickId: number; project: (x: number, y: number, z?: number) => any }) => {
    const c = ctx.project(obj.position.x, obj.position.y);
    ctx.builder.quad(
      [c[0] - 4, c[1] - 4], [c[0] + 4, c[1] - 4], [c[0] + 4, c[1] + 4], [c[0] - 4, c[1] + 4],
      { color, sample: c, lit: false, pickId: ctx.pickId },
    );
  };
}

afterEach(() => {
  SceneExtractor.clearExtractors();
});

describe('SceneExtractor — custom extractor registry', () => {
  it('reports an unregistered type as unsupported', () => {
    const snapshot = new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(snapshot.unsupported.map(u => u.type)).toContain('Prop');
    expect(snapshot.unsupported[0].reason).toMatch(/SceneExtractor\.register/);
  });

  it('uses a registered extractor instead of the diagnostic marker', () => {
    SceneExtractor.register(Prop, quadExtractor());
    const snapshot = new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(snapshot.unsupported).toEqual([]);
  });

  it('passes the projection and pick id through the context', () => {
    const seen: Array<{ x: number; y: number; pickId: number }> = [];
    SceneExtractor.register(Prop, (obj, ctx) => {
      const p = ctx.project(obj.position.x, obj.position.y);
      seen.push({ x: p[0], y: p[1], pickId: ctx.pickId });
      ctx.builder.quad(
        [p[0], p[1]], [p[0] + 1, p[1]], [p[0] + 1, p[1] + 1], [p[0], p[1] + 1],
        { color: [1, 0, 0, 1], sample: p, lit: false, pickId: ctx.pickId },
      );
    });

    new SceneExtractor().extract(sceneWith(new Prop('p', 3, 1)), OPTS);
    expect(seen.length).toBe(1);
    // 2:1 iso: sx = (x - y) * tileW / 2, sy = (x + y) * tileH / 2.
    expect(seen[0].x).toBeCloseTo((3 - 1) * 32, 6);
    expect(seen[0].y).toBeCloseTo((3 + 1) * 16, 6);
    expect(seen[0].pickId).toBeGreaterThan(0);
  });

  it('exposes tile dimensions', () => {
    let tiles = { w: 0, h: 0 };
    SceneExtractor.register(Prop, (obj, ctx) => {
      tiles = { w: ctx.tileW, h: ctx.tileH };
      return quadExtractor()(obj, ctx as never);
    });
    new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(tiles).toEqual({ w: 64, h: 32 });
  });

  it('honours a returned texture URL', () => {
    SceneExtractor.register(Prop, (obj, ctx) => {
      quadExtractor()(obj, ctx as never);
      return '/atlas/prop.png';
    });
    const snapshot = new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(snapshot.geometry.segments.some(s => s.textureUrl === '/atlas/prop.png')).toBe(true);
  });
});

describe('SceneExtractor — registry resolution order', () => {
  it('matches a subclass through its base registration', () => {
    SceneExtractor.register(Prop, quadExtractor());
    const snapshot = new SceneExtractor().extract(sceneWith(new SpecialProp('s')), OPTS);
    expect(snapshot.unsupported).toEqual([]);
  });

  it('lets a later registration win, so a subclass can override a base', () => {
    const base = vi.fn(quadExtractor());
    const derived = vi.fn(quadExtractor());
    SceneExtractor.register(Prop, base);
    SceneExtractor.register(SpecialProp, derived);

    new SceneExtractor().extract(sceneWith(new SpecialProp('s')), OPTS);
    expect(derived).toHaveBeenCalledTimes(1);
    expect(base).not.toHaveBeenCalled();
  });

  it('re-registering the same class replaces the previous function', () => {
    const first = vi.fn(quadExtractor());
    const second = vi.fn(quadExtractor());
    SceneExtractor.register(Prop, first);
    SceneExtractor.register(Prop, second);

    new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unregister restores the unsupported path', () => {
    SceneExtractor.register(Prop, quadExtractor());
    expect(SceneExtractor.unregister(Prop)).toBe(true);
    expect(SceneExtractor.unregister(Prop)).toBe(false);

    const snapshot = new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(snapshot.unsupported.map(u => u.type)).toContain('Prop');
  });

  it('findExtractor answers without running a frame', () => {
    expect(SceneExtractor.findExtractor(new Prop('p'))).toBeNull();
    SceneExtractor.register(Prop, quadExtractor());
    expect(SceneExtractor.findExtractor(new Prop('p'))).toBeTypeOf('function');
  });
});

describe('SceneExtractor — guards around application code', () => {
  it('survives an extractor that throws and reports why', () => {
    SceneExtractor.register(Prop, () => { throw new Error('bad projection'); });
    const snapshot = new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    // One broken object must not take down the whole frame.
    expect(snapshot.unsupported).toHaveLength(1);
    expect(snapshot.unsupported[0].reason).toMatch(/threw — Error: bad projection/);
  });

  it('flags an extractor that emits nothing', () => {
    SceneExtractor.register(Prop, () => { /* forgot to build geometry */ });
    const snapshot = new SceneExtractor().extract(sceneWith(new Prop('p')), OPTS);
    expect(snapshot.unsupported[0].reason).toMatch(/produced no geometry/);
  });

  it('keeps extracting the rest of the scene after one failure', () => {
    const good = vi.fn(quadExtractor());
    SceneExtractor.register(Prop, () => { throw new Error('nope'); });
    SceneExtractor.register(SpecialProp, good);

    const snapshot = new SceneExtractor().extract(
      sceneWith(new Prop('broken', 1, 1), new SpecialProp('fine', 4, 4)),
      OPTS,
    );
    expect(good).toHaveBeenCalledTimes(1);
    expect(snapshot.unsupported.map(u => u.id)).toEqual(['broken']);
  });
});
