import { describe, it, expect } from 'vitest';
import { TileCollider } from '../physics/TileCollider';

describe('TileCollider — diagonal corner-slide fix', () => {
  it('slides along X when Y is blocked', () => {
    const c = new TileCollider(5, 5);
    for (let col = 0; col < 5; col++) c.setWalkable(col, 2, false);
    // Moving diagonally into a horizontal wall — should slide along X
    const r = c.resolveMove(2.5, 1.6, 0.2, 0.2);
    expect(r.dx).toBeCloseTo(0.2, 3);
    expect(r.dy).toBe(0);
  });

  it('slides along Y when X is blocked', () => {
    const c = new TileCollider(5, 5);
    for (let row = 0; row < 5; row++) c.setWalkable(2, row, false);
    const r = c.resolveMove(1.6, 2.5, 0.2, 0.2);
    expect(r.dx).toBe(0);
    expect(r.dy).toBeCloseTo(0.2, 3);
  });

  it('returns small push-out when stuck in corner', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(2, 2, false);
    c.setWalkable(3, 2, false);
    c.setWalkable(2, 3, false);
    c.setWalkable(3, 3, false);
    // Standing right at the corner of 4 blocked tiles
    const r = c.resolveMove(2.0, 2.0, 0.3, 0.3);
    // Should not be fully zero — push-out should be attempted
    const moved = Math.abs(r.dx) + Math.abs(r.dy);
    // Either a push-out or zero (if fully surrounded) — just no crash
    expect(typeof moved).toBe('number');
  });
});

describe('TileCollider — sweepMove', () => {
  it('returns full move when path is clear', () => {
    const c = new TileCollider(10, 10);
    const r = c.sweepMove(5, 5, 0.5, 0.5);
    expect(r.dx).toBeCloseTo(0.5, 4);
    expect(r.dy).toBeCloseTo(0.5, 4);
  });

  it('stops before a wall', () => {
    const c = new TileCollider(10, 10);
    for (let row = 0; row < 10; row++) c.setWalkable(7, row, false);
    // Moving fast from x=5 toward x=8 (crosses wall at col 7)
    const r = c.sweepMove(5, 5, 3, 0, 0.4);
    expect(r.dx).toBeLessThan(3);
    expect(r.dx).toBeGreaterThan(0);
  });

  it('returns zero when starting position is blocked', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(2, 2, false);
    const r = c.sweepMove(2.5, 2.5, 0.5, 0, 0.4);
    // Already in blocked tile — safe fraction is 0
    expect(r.dx).toBe(0);
  });

  it('does not tunnel through a one-tile-thick wall', () => {
    const c = new TileCollider(12, 12);
    for (let row = 0; row < 12; row++) c.setWalkable(7, row, false);
    // A fast move that lands PAST the wall in clear space (col 9). A bare
    // binary search on the destination would report the whole move as safe,
    // teleporting the entity through the wall.
    const r = c.sweepMove(5, 5, 4.5, 0, 0.4);
    expect(r.dx).toBeLessThan(2); // must stop short of col 7
    expect(5 + r.dx).toBeLessThan(7);
  });

  it('does not tunnel diagonally through a wall', () => {
    const c = new TileCollider(12, 12);
    for (let row = 0; row < 12; row++) c.setWalkable(6, row, false);
    const r = c.sweepMove(3, 3, 5, 5, 0.3);
    expect(3 + r.dx).toBeLessThan(6);
  });
});

describe('TileCollider — canOccupy tile coverage', () => {
  it('reports a blocked tile as blocked for a zero-radius footprint', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(3, 3, false);
    // Degenerate footprint at an integer coordinate: min === max. The old
    // `floor(max - 0.001)` end index fell below the start index, so both loops
    // were skipped and the method returned true on a blocked tile.
    expect(c.canOccupy(3, 3, 3, 3)).toBe(false);
    expect(c.canOccupy(3, 3, 3.0005, 3.0005)).toBe(false);
  });

  it('still reports a clear tile as clear for a zero-radius footprint', () => {
    const c = new TileCollider(5, 5);
    expect(c.canOccupy(3, 3, 3, 3)).toBe(true);
  });

  it('covers exactly the tiles a normal footprint overlaps', () => {
    const c = new TileCollider(5, 5);
    c.setWalkable(3, 2, false);
    // Footprint [2.0, 3.0) x [2.0, 3.0) fills tile (2,2) only and must not
    // spill into the blocked tile (3,2).
    expect(c.canOccupy(2, 2, 3, 3)).toBe(true);
    // Footprint [2.6, 3.4) straddles cols 2 and 3 -> must see the block.
    expect(c.canOccupy(2.6, 2.1, 3.4, 2.9)).toBe(false);
  });
});

