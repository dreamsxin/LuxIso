import { describe, it, expect } from 'vitest';
import { Pathfinder } from '../physics/Pathfinder';
import { TileCollider } from '../physics/TileCollider';

function makeGrid(cols: number, rows: number, blocked: [number, number][] = []): TileCollider {
  const c = new TileCollider(cols, rows);
  for (const [col, row] of blocked) c.setWalkable(col, row, false);
  return c;
}

describe('Pathfinder.find — basic', () => {
  it('returns single waypoint when start === goal tile', () => {
    const c = makeGrid(5, 5);
    const path = Pathfinder.find(c, { x: 2.3, y: 1.7 }, { x: 2.8, y: 1.1 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
  });

  it('finds straight path in open grid', () => {
    const c = makeGrid(10, 10);
    const path = Pathfinder.find(c, { x: 0.5, y: 0.5 }, { x: 5.5, y: 0.5 });
    expect(path).not.toBeNull();
    for (const wp of path!) {
      expect(wp.y).toBeCloseTo(0.5, 0);
    }
  });

  it('returns null when goal is blocked', () => {
    const c = makeGrid(5, 5, [[2, 2]]);
    const path = Pathfinder.find(c, { x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 });
    expect(path).toBeNull();
  });

  it('navigates around a wall', () => {
    const c = makeGrid(7, 5);
    for (let r = 0; r < 4; r++) c.setWalkable(2, r, false);
    const path = Pathfinder.find(c, { x: 0.5, y: 2.5 }, { x: 5.5, y: 2.5 });
    expect(path).not.toBeNull();
    for (const wp of path!) {
      if (wp.y < 4) {
        expect(wp.x).not.toBeCloseTo(2.5, 0);
      }
    }
  });

  it('finds diagonal path', () => {
    const c = makeGrid(6, 6);
    const path = Pathfinder.find(c, { x: 0.5, y: 0.5 }, { x: 5.5, y: 5.5 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThan(10);
  });

  it('prevents diagonal corner-cutting through walls', () => {
    const c = makeGrid(7, 4, [[3, 0], [3, 1]]);
    const path = Pathfinder.find(c, { x: 0.5, y: 1.5 }, { x: 6.5, y: 1.5 });
    expect(path).not.toBeNull();
    const passesRow2 = path!.some(wp => wp.y >= 2.0 && wp.y < 3.0);
    expect(passesRow2).toBe(true);
  });

  it('handles isolated goal with no route', () => {
    const c = makeGrid(5, 5, [
      [2, 1], [1, 2], [3, 2], [2, 3],
      [1, 1], [3, 1], [1, 3], [3, 3],
    ]);
    const path = Pathfinder.find(c, { x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 });
    expect(path).toBeNull();
  });
});

describe('Pathfinder.find — MovementComponent integration', () => {
  it('produces waypoints within grid bounds', () => {
    const cols = 8, rows = 8;
    const c = makeGrid(cols, rows, [[3, 0],[3,1],[3,2],[3,3],[3,4]]);
    const path = Pathfinder.find(c, { x: 1, y: 2 }, { x: 6, y: 2 });
    expect(path).not.toBeNull();
    for (const wp of path!) {
      expect(wp.x).toBeGreaterThanOrEqual(0);
      expect(wp.x).toBeLessThanOrEqual(cols);
      expect(wp.y).toBeGreaterThanOrEqual(0);
      expect(wp.y).toBeLessThanOrEqual(rows);
    }
  });
});

describe('Pathfinder — string-pull / LoS simplification', () => {
  it('straight open path is collapsed to just start+goal', () => {
    // 10-wide, 1-row open grid: path from col 0 to col 9 in a straight line
    // should be simplified to [start, goal] by LoS
    const c = makeGrid(10, 3);
    const path = Pathfinder.find(c, { x: 0.5, y: 1.5 }, { x: 9.5, y: 1.5 });
    expect(path).not.toBeNull();
    // With LoS string-pull, a completely clear straight row collapses to 2 pts
    expect(path!.length).toBeLessThanOrEqual(3);
  });

  it('path around obstacle has more waypoints than open path', () => {
    const open = makeGrid(10, 10);
    const obstacle = makeGrid(10, 10, [[3, 3],[3, 4],[3, 5],[4, 3],[4, 4],[4, 5]]);
    const openPath = Pathfinder.find(open, { x: 0.5, y: 4.5 }, { x: 9.5, y: 4.5 });
    const obstaclePath = Pathfinder.find(obstacle, { x: 0.5, y: 4.5 }, { x: 9.5, y: 4.5 });
    expect(openPath).not.toBeNull();
    expect(obstaclePath).not.toBeNull();
    expect(obstaclePath!.length).toBeGreaterThan(openPath!.length);
  });
});

describe('Pathfinder — min-heap correctness', () => {
  it('finds optimal path on large open grid', () => {
    // On a 20x20 open grid, shortest path from corner to corner should be
    // diagonal (length ≈ 19 after string-pull: just 2 waypoints)
    const c = makeGrid(20, 20);
    const path = Pathfinder.find(c, { x: 0.5, y: 0.5 }, { x: 19.5, y: 19.5 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeLessThanOrEqual(4);
  });

  it('finds correct path when multiple routes exist', () => {
    // Two corridors: top (row 0) and bottom (row 4); wall at col 2-3 rows 1-3
    const c = makeGrid(6, 5, [
      [2,1],[2,2],[2,3],[3,1],[3,2],[3,3],
    ]);
    const path = Pathfinder.find(c, { x: 0.5, y: 2.5 }, { x: 5.5, y: 2.5 });
    expect(path).not.toBeNull();
    // Must arrive at goal
    const last = path![path!.length - 1];
    expect(last.x).toBeCloseTo(5.5, 1);
    expect(last.y).toBeCloseTo(2.5, 1);
  });
});

describe('Pathfinder.hasLineOfSight', () => {
  it('sees across open ground, in both directions', () => {
    const c = makeGrid(10, 10);
    expect(Pathfinder.hasLineOfSight(c, { x: 0.5, y: 0.5 }, { x: 9.5, y: 6.5 })).toBe(true);
    expect(Pathfinder.hasLineOfSight(c, { x: 9.5, y: 6.5 }, { x: 0.5, y: 0.5 })).toBe(true);
  });

  it('is blocked by a single tile on the line', () => {
    const c = makeGrid(10, 10, [[5, 5]]);
    expect(Pathfinder.hasLineOfSight(c, { x: 2.5, y: 2.5 }, { x: 8.5, y: 8.5 })).toBe(false);
    // A line that misses the pillar still gets through.
    expect(Pathfinder.hasLineOfSight(c, { x: 2.5, y: 8.5 }, { x: 8.5, y: 8.5 })).toBe(true);
  });

  it('refuses to look through a corner between two blocked tiles', () => {
    // The diagonal step from (1,1) to (2,2) is pinched by (2,1) and (1,2).
    const c = makeGrid(5, 5, [[2, 1], [1, 2]]);
    expect(Pathfinder.hasLineOfSight(c, { x: 1.5, y: 1.5 }, { x: 2.5, y: 2.5 })).toBe(false);
  });

  it('treats out-of-bounds as blocked', () => {
    const c = makeGrid(5, 5);
    expect(Pathfinder.hasLineOfSight(c, { x: 2.5, y: 2.5 }, { x: 9.5, y: 2.5 })).toBe(false);
  });

  it('sees a point from itself', () => {
    const c = makeGrid(5, 5);
    expect(Pathfinder.hasLineOfSight(c, { x: 2.5, y: 2.5 }, { x: 2.7, y: 2.2 })).toBe(true);
  });
});
