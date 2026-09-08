import { describe, it, expect } from 'vitest';
import { TileCollider } from '../physics/TileCollider';
import { Pathfinder, PathCache } from '../physics/Pathfinder';

describe('TileCollider — version counter', () => {
  it('starts at 0 and bumps on a real change', () => {
    const c = new TileCollider(5, 5);
    expect(c.version).toBe(0);
    c.setWalkable(2, 2, false);
    expect(c.version).toBe(1);
  });

  it('does not bump when the value is unchanged', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(2, 2, true); // already walkable
    expect(c.version).toBe(0);
    c.setWalkable(2, 2, false);
    c.setWalkable(2, 2, false); // same value again
    expect(c.version).toBe(1);
  });

  it('does not bump for out-of-bounds writes', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(99, 99, false);
    expect(c.version).toBe(0);
  });
});

describe('PathCache — grid mutation invalidates cached paths', () => {
  /** Corridor grid: only row 2 is open, so a wall at (col,2) fully blocks it. */
  function corridor(): TileCollider {
    const c = new TileCollider(7, 5);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 7; col++) {
        if (row !== 2) c.setWalkable(col, row, false);
      }
    }
    return c;
  }

  it('stops serving a stale path after a tile is blocked', () => {
    const collider = corridor();
    const cache = new PathCache(64);
    const start = { x: 0.5, y: 2.5 };
    const goal  = { x: 6.5, y: 2.5 };

    const first = Pathfinder.find(collider, start, goal, cache);
    expect(first).not.toBeNull();
    expect(cache.size).toBeGreaterThan(0);

    // Close the corridor. setWalkable mutates in place, so identity-based
    // invalidation alone would keep returning the pre-change path forever.
    collider.setWalkable(3, 2, false);

    const second = Pathfinder.find(collider, start, goal, cache);
    expect(second).toBeNull();
  });

  it('stops serving a stale failure after a tile is opened', () => {
    const collider = corridor();
    collider.setWalkable(3, 2, false);
    const cache = new PathCache(64);
    const start = { x: 0.5, y: 2.5 };
    const goal  = { x: 6.5, y: 2.5 };

    expect(Pathfinder.find(collider, start, goal, cache)).toBeNull();

    collider.setWalkable(3, 2, true); // open the door
    expect(Pathfinder.find(collider, start, goal, cache)).not.toBeNull();
  });

  it('serves a cache hit when the grid has not changed', () => {
    const collider = corridor();
    const cache = new PathCache(64);
    const start = { x: 0.5, y: 2.5 };
    const goal  = { x: 6.5, y: 2.5 };

    const first = Pathfinder.find(collider, start, goal, cache);
    const second = Pathfinder.find(collider, start, goal, cache);
    // Identical cached array instance = a genuine hit, not a recompute.
    expect(second).toBe(first);
  });
});

describe('Pathfinder — string-pulling respects corner-cutting rules', () => {
  it('never returns a path that clips a diagonal gap between two blocked tiles', () => {
    // Two blocked tiles meeting at a corner. A legal route must go around;
    // Bresenham LoS used to straighten the path diagonally through the seam.
    const c = new TileCollider(6, 6);
    c.setWalkable(2, 3, false);
    c.setWalkable(3, 2, false);

    const path = Pathfinder.find(c, { x: 2.5, y: 2.5 }, { x: 3.5, y: 3.5 });
    expect(path).not.toBeNull();

    // Walk consecutive waypoints; no segment may make a diagonal tile step
    // whose two shared cardinal tiles are both blocked.
    const pts = path!;
    for (let i = 1; i < pts.length; i++) {
      const c0 = Math.floor(pts[i - 1].x), r0 = Math.floor(pts[i - 1].y);
      const c1 = Math.floor(pts[i].x),     r1 = Math.floor(pts[i].y);
      if (Math.abs(c1 - c0) === 1 && Math.abs(r1 - r0) === 1) {
        const cardinalsOpen = c.isWalkable(c1, r0) && c.isWalkable(c0, r1);
        expect(cardinalsOpen).toBe(true);
      }
    }
  });

  it('still straightens a zigzag across open terrain', () => {
    const c = new TileCollider(10, 10);
    const path = Pathfinder.find(c, { x: 0.5, y: 0.5 }, { x: 8.5, y: 8.5 });
    expect(path).not.toBeNull();
    // A fully open diagonal should collapse to very few waypoints.
    expect(path!.length).toBeLessThanOrEqual(3);
  });
});
