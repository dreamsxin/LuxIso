import { describe, expect, it } from 'vitest';
import type { DrawContext } from '../elements/IsoObject';
import { FlowerPatch } from '../elements/props/FlowerPatch';
import { Lantern } from '../elements/props/Lantern';
import { Tree } from '../elements/props/Tree';

describe('common garden props', () => {
  it('draws the tree and exposes a height-aware sorting volume', () => {
    const tree = new Tree({ id: 'tree', x: 2, y: 3, heightPx: 80, scale: 1.2 });
    const { context, calls } = drawContext();

    expect(() => tree.draw(context)).not.toThrow();
    expect(tree.aabb.maxZ).toBeCloseTo(80 * 1.2 * 1.08);
    expect(calls.filter((call) => call === 'ellipse').length).toBe(6);
  });

  it('builds deterministic flower layouts and draws every blossom', () => {
    const first = new FlowerPatch({ id: 'flowers-a', x: 1, y: 1, count: 8, seed: 4.2 });
    const second = new FlowerPatch({ id: 'flowers-b', x: 1, y: 1, count: 8, seed: 4.2 });
    const { context, calls } = drawContext();

    first.draw(context);
    expect(first.flowerOffsets).toEqual(second.flowerOffsets);
    expect(calls.filter((call) => call === 'arc').length).toBe(8 * 6);
  });

  it('draws a warm lantern with a halo and a selectable footprint', () => {
    const lantern = new Lantern({ id: 'lantern', x: 1, y: 1, heightPx: 54 });
    const { context, calls } = drawContext();

    expect(() => lantern.draw(context)).not.toThrow();
    expect(lantern.aabb.maxZ).toBeGreaterThan(54);
    expect(calls).toEqual(expect.arrayContaining(['ellipse', 'fillRect', 'stroke']));
  });
});

function drawContext(): { context: DrawContext; calls: string[] } {
  const calls: string[] = [];
  const target: Record<PropertyKey, unknown> = {};
  const ctx = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return (..._args: unknown[]) => { calls.push(String(property)); };
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return {
    calls,
    context: {
      ctx,
      tileW: 64,
      tileH: 32,
      originX: 320,
      originY: 120,
      omniLights: [],
      dirLights: [],
      ambientRgb: [0.5, 0.5, 0.5],
      view: { rotation: 0, elevation: 0.5 },
    },
  };
}
