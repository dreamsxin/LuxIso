import {describe, it, expect} from 'vitest';
import {TileCollider} from '../physics/TileCollider';

describe('TileCollider — construction', () => {
  it('all tiles walkable by default', () => {
    const c = new TileCollider(4, 4);
    for (let r = 0; r < 4; r++)
      {for (let col = 0; col < 4; col++)
        {expect(c.isWalkable(col, r)).toBe(true);}}
  });

  it('out-of-bounds tiles are not walkable', () => {
    const c = new TileCollider(3, 3);
    expect(c.isWalkable(-1, 0)).toBe(false);
    expect(c.isWalkable(3, 0)).toBe(false);
    expect(c.isWalkable(0, 3)).toBe(false);
  });
});

describe('TileCollider — setWalkable / isWalkable', () => {
  it('can block a tile', () => {
    const c = new TileCollider(4, 4);
    c.setWalkable(2, 1, false);
    expect(c.isWalkable(2, 1)).toBe(false);
    expect(c.isWalkable(1, 1)).toBe(true);
  });

  it('ignores out-of-bounds set', () => {
    const c = new TileCollider(3, 3);
    expect(() => c.setWalkable(10, 10, false)).not.toThrow();
  });
});

describe('TileCollider — canOccupy', () => {
  it('returns true when all tiles walkable', () => {
    const c = new TileCollider(5, 5);
    expect(c.canOccupy(0.1, 0.1, 0.9, 0.9)).toBe(true);
  });

  it('returns false when any tile blocked', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(2, 2, false);
    expect(c.canOccupy(1.5, 1.5, 2.5, 2.5)).toBe(false);
  });

  it('footprint touching only walkable tiles passes', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(3, 3, false);
    // AABB stays within tile (1,1)
    expect(c.canOccupy(1.1, 1.1, 1.9, 1.9)).toBe(true);
  });
});

describe('TileCollider — resolveMove', () => {
  it('allows move into open space', () => {
    const c = new TileCollider(10, 10);
    const result = c.resolveMove(5, 5, 0.5, 0.5);
    expect(result.dx).toBe(0.5);
    expect(result.dy).toBe(0.5);
  });

  it('blocks move into wall', () => {
    const c = new TileCollider(10, 10);
    // Block the entire right column
    for (let r = 0; r < 10; r++) {c.setWalkable(7, r, false);}
    // Standing at x=6.5, trying to move right into col 7
    const result = c.resolveMove(6.5, 5, 0.5, 0, 0.4);
    expect(result.dx).toBe(0);
  });

  it('slides along wall (X blocked, Y free)', () => {
    const c = new TileCollider(10, 10);
    for (let r = 0; r < 10; r++) {c.setWalkable(7, r, false);}
    const result = c.resolveMove(6.5, 5, 0.5, 0.3, 0.4);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0.3);
  });
});

describe('TileCollider — fromArray', () => {
  it('builds from 2D boolean array', () => {
    const grid = [
      [true, false],
      [false, true ],
    ];
    const c = TileCollider.fromArray(2, 2, grid);
    expect(c.isWalkable(0, 0)).toBe(true);
    expect(c.isWalkable(1, 0)).toBe(false);
    expect(c.isWalkable(0, 1)).toBe(false);
    expect(c.isWalkable(1, 1)).toBe(true);
  });

  it('builds from flat boolean array', () => {
    const flat = [true, false, false, true];
    const c = TileCollider.fromArray(2, 2, flat);
    expect(c.isWalkable(0, 0)).toBe(true);
    expect(c.isWalkable(1, 0)).toBe(false);
    expect(c.isWalkable(0, 1)).toBe(false);
    expect(c.isWalkable(1, 1)).toBe(true);
  });
});
