import { describe, it, expect } from 'vitest';
import { MIN_Z_EXTENT_PX } from '../math/depthSort';
import { AssetLoader } from '../core/AssetLoader';
import { SpriteSheet } from '../animation/SpriteSheet';
import { Wall } from '../elements/Wall';
import { Character } from '../elements/Character';
import { Floor } from '../elements/Floor';
import { Crystal } from '../elements/props/Crystal';
import { Boulder } from '../elements/props/Boulder';
import { Chest } from '../elements/props/Chest';
import { Cloud } from '../elements/props/Cloud';
import { Lantern } from '../elements/props/Lantern';
import { FloatingText } from '../elements/props/FloatingText';


/**
 * Z convention: there is exactly one unit — screen pixels. `position.z` and every
 * AABB's `baseZ` / `maxZ` share it, and `project()` subtracts z from `sy`
 * directly.
 *
 * This replaced a two-unit scheme where AABB Z was "world units" obtained by
 * multiplying pixels by a hardcoded 1/16. These tests lock the single unit so
 * depth-sort `overlapZ` comparisons stay meaningful across classes.
 */

describe('Wall — aabb Z', () => {
  it('maxZ is the wall height in pixels', () => {
    const wall = new Wall({ id: 'w', x: 0, y: 0, endX: 4, endY: 0, height: 80 });
    expect(wall.aabb.maxZ).toBeCloseTo(80, 10);
    expect(wall.aabb.baseZ).toBe(0);
  });

  it('scales linearly with wall height', () => {
    const w1 = new Wall({ id: 'w1', x: 0, y: 0, endX: 1, endY: 0, height: 32 });
    const w2 = new Wall({ id: 'w2', x: 0, y: 0, endX: 1, endY: 0, height: 64 });
    expect(w2.aabb.maxZ!).toBeCloseTo(w1.aabb.maxZ! * 2, 10);
  });
});

describe('Character — aabb Z', () => {
  it('maxZ = position.z + radius for the sphere fallback', () => {
    const ch = new Character({ id: 'p', x: 0, y: 0, z: 0, radius: 22 });
    expect(ch.aabb.maxZ).toBeCloseTo(22, 10);
    expect(ch.drawnHeightPx).toBeCloseTo(22, 10);
  });

  it('baseZ is position.z unchanged', () => {
    const ch = new Character({ id: 'p', x: 0, y: 0, z: 32, radius: 22 });
    expect(ch.aabb.baseZ).toBe(32);
    expect(ch.aabb.maxZ!).toBeCloseTo(32 + 22, 10);
  });

  it('clamps a tiny radius to a minimum slab', () => {
    const ch = new Character({ id: 'p', x: 0, y: 0, z: 0, radius: 1 });
    expect(ch.aabb.maxZ!).toBeCloseTo(MIN_Z_EXTENT_PX, 10);
  });

  /**
   * The sprite path used to report `radius` as well, which is the one number the
   * sprite does not use: `drawSprite` places the image at `by - h * anchorY`.
   * A 64 px frame reached 64 px above the anchor while the box claimed 22, so a
   * sprite character was depth-sorted and shadowed at a third of its height.
   */
  it('measures a sprite by its frame, not by the sphere radius', () => {
    const sheet = new SpriteSheet({
      url: '/aabb-hero.png',
      clips: [{ name: 'idle', frames: [{ x: 0, y: 0, w: 32, h: 64 }], fps: 1 }],
    });
    const ch = new Character({ id: 'p', x: 0, y: 0, z: 0, radius: 22, spriteSheet: sheet });
    // No decoded image yet: nothing is drawn from the sheet, so the box stays on
    // the branch `draw` would actually take.
    expect(ch.drawnHeightPx).toBeCloseTo(22, 10);

    AssetLoader.register('/aabb-hero.png', { width: 32, height: 64 } as HTMLImageElement);
    try {
      expect(ch.drawnHeightPx).toBeCloseTo(64, 10);
      expect(ch.aabb.maxZ!).toBeCloseTo(64, 10);
    } finally {
      AssetLoader.clear();
    }
  });
});


describe('Props — aabb Z', () => {
  it('Crystal maxZ is its drawn tip, not its shoulder height', () => {
    const c = new Crystal('c', 0, 0, '#8060e0', 48);
    // `draw` puts the tip at 1.18 * heightPx; the box used to stop at 48.
    expect(c.aabb.maxZ).toBeCloseTo(48 * Crystal.TIP_FACTOR, 10);
    expect(c.aabb.maxZ).toBeCloseTo(56.64, 10);
  });

  it('Lantern maxZ follows the roof, which scales with the tile', () => {
    const l = new Lantern({ id: 'l', x: 0, y: 0, heightPx: 50 });

    // Was `heightPx + 8`, a constant standing in for `0.418 * tileH`.
    expect(l.aabb.maxZ).toBeCloseTo(50 + 32 * Lantern.ROOF_RISE, 10);
    expect(l.aabb.maxZ).toBeCloseTo(63.376, 10);
  });


  it('Boulder maxZ is the squashed drawn height, not 2 * radius', () => {
    const b = new Boulder('b', 0, 0, '#7a7a8a', 18);
    // Every outline vertex is squashed by `Boulder.SQUASH`, so 18 px of radius
    // draws 9.9 px tall. `Boulder.test.ts` measures that against the painting.
    expect(b.aabb.maxZ).toBeCloseTo(18 * Boulder.SQUASH, 10);
  });


  it('Chest maxZ reflects body + lid pixel height', () => {
    const ch = new Chest('ch', 0, 0);
    // (32 * 1.1) + (32 * 0.5) = 51.2 px
    expect(ch.aabb.maxZ).toBeCloseTo(51.2, 10);
  });

  it('Cloud baseZ is its altitude in pixels', () => {
    const cl = new Cloud({ id: 'cl', x: 0, y: 0, altitude: 6 });
    expect(cl.position.z).toBe(192);          // altitude * tileH
    expect(cl.aabb.baseZ).toBeCloseTo(192, 10);
  });

  it('Cloud has thickness above its base', () => {
    const cl = new Cloud({ id: 'cl', x: 0, y: 0, altitude: 6, scale: 1 });
    expect(cl.aabb.maxZ!).toBeGreaterThan(cl.aabb.baseZ);
  });

  it('FloatingText spans a minimum slab at its position', () => {
    const ft = new FloatingText({ id: 'ft', x: 1, y: 1, z: 48, text: 'hi' });
    expect(ft.aabb.baseZ).toBeCloseTo(48, 10);
    expect(ft.aabb.maxZ).toBeCloseTo(48 + MIN_Z_EXTENT_PX, 10);
  });
});

describe('Floor — aabb', () => {
  it('is a flat slab covering the grid, with no maxZ', () => {
    const f = new Floor({ id: 'f', cols: 10, rows: 8 });
    expect(f.aabb.minX).toBe(0);
    expect(f.aabb.minY).toBe(0);
    expect(f.aabb.maxX).toBe(10);
    expect(f.aabb.maxY).toBe(8);
    expect(f.aabb.baseZ).toBe(0);
    expect(f.aabb.maxZ).toBeUndefined();
    // depthSort then treats it as a MIN_Z_EXTENT_PX slab, not an infinite column.
  });
});

describe('AABB invariants across all object classes', () => {
  const cases = [
    ['Wall',      () => new Wall({ id: 'w', x: 0, y: 0, endX: 3, endY: 0, height: 64 })],
    ['Character', () => new Character({ id: 'p', x: 2, y: 2, z: 16, radius: 22 })],
    ['Crystal',   () => new Crystal('c', 2, 2, '#fff', 48)],
    ['Boulder',   () => new Boulder('b', 2, 2, '#fff', 18)],
    ['Chest',     () => new Chest('ch', 2, 2)],
    ['Cloud',     () => new Cloud({ id: 'cl', x: 2, y: 2, altitude: 6 })],
    ['FloatingText', () => new FloatingText({ id: 'ft', x: 2, y: 2, z: 16, text: 'x' })],
  ] as const;

  for (const [name, factory] of cases) {
    it(`${name}: minX <= maxX, minY <= maxY, maxZ > baseZ`, () => {
      const obj = factory();
      const a = obj.aabb;
      expect(a.minX).toBeLessThanOrEqual(a.maxX);
      expect(a.minY).toBeLessThanOrEqual(a.maxY);
      expect(a.maxZ!).toBeGreaterThan(a.baseZ);
    });
  }
});

describe('Cross-class Z-scale consistency', () => {
  it('a tall wall towers over a character', () => {
    const wall = new Wall({ id: 'w', x: 0, y: 0, endX: 4, endY: 0, height: 80 });
    const char = new Character({ id: 'p', x: 2, y: 0, z: 0, radius: 22 });
    expect(wall.aabb.maxZ!).toBeGreaterThan(char.aabb.maxZ!);
  });

  it('objects of equal pixel height agree in Z, whatever the class', () => {
    const smallWall = new Wall({ id: 'w2', x: 0, y: 0, endX: 1, endY: 0, height: 16 });
    const smallChar = new Character({ id: 'p2', x: 0, y: 0, z: 0, radius: 8 });
    // radius 8 clamps up to the 16 px minimum slab, matching the 16 px wall.
    expect(smallWall.aabb.maxZ).toBeCloseTo(smallChar.aabb.maxZ!, 10);
  });

  it('a character standing on nothing sits below a wall it overlaps', () => {
    const wall = new Wall({ id: 'w', x: 0, y: 0, endX: 4, endY: 0, height: 64 });
    const char = new Character({ id: 'p', x: 1, y: 0, z: 0, radius: 22 });
    // Same pixel space, so overlapZ is true and XY heuristics decide the order —
    // which is the behaviour depthSort relies on.
    expect(char.aabb.baseZ).toBeLessThan(wall.aabb.maxZ!);
  });
});
