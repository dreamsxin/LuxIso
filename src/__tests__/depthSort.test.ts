import {describe, it, expect} from 'vitest';
import {topoSort, Sortable} from '../math/depthSort';

function makeObj(minX: number, minY: number, maxX: number, maxY: number, baseZ = 0, maxZ?: number): Sortable {
  return {aabb: {minX, minY, maxX, maxY, baseZ, maxZ}};
}

describe('topoSort', () => {
  it('returns empty array for empty input', () => {
    expect(topoSort([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const obj = makeObj(0, 0, 1, 1);
    expect(topoSort([obj])).toEqual([obj]);
  });

  it('non-overlapping objects: smaller x+y drawn first', () => {
    const back = makeObj(0, 0, 1, 1); // centre (0.5, 0.5) → depth 1
    const front = makeObj(3, 3, 4, 4); // centre (3.5, 3.5) → depth 7
    const result = topoSort([front, back]);
    expect(result[0]).toBe(back);
    expect(result[1]).toBe(front);
  });

  it('overlapping objects: the one with smaller maxX is drawn first', () => {
    // Two objects that share floor space — the one ending earlier on X is behind
    const behind = makeObj(0, 0, 2, 2);
    const inFront = makeObj(1, 1, 3, 3);
    const result = topoSort([inFront, behind]);
    expect(result[0]).toBe(behind);
    expect(result[1]).toBe(inFront);
  });

  it('preserves all items', () => {
    const objs = [
      makeObj(0, 0, 1, 1),
      makeObj(2, 0, 3, 1),
      makeObj(0, 2, 1, 3),
      makeObj(2, 2, 3, 3),
    ];
    const result = topoSort(objs);
    expect(result).toHaveLength(4);
    for (const o of objs) {expect(result).toContain(o);}
  });

  it('handles cycle gracefully (no infinite loop)', () => {
    // Pathological case: two objects with identical AABBs
    const a = makeObj(1, 1, 2, 2);
    const b = makeObj(1, 1, 2, 2);
    const result = topoSort([a, b]);
    expect(result).toHaveLength(2);
  });
});

// ── Regression tests for occlusion bug fixes ────────────────────────────────

describe('topoSort - Z-aware containment', () => {
  it('taller object inside a shorter object footprint is drawn in front', () => {
    // Regression for the containment-ignores-Z bug: a tall thin wall whose XY
    // footprint is fully contained by a shorter character's footprint must be
    // drawn AFTER (in front of) the character, not behind it.
    // Both share Z range [0,?] and overlap; char maxZ=2.75, wall maxZ=5.
    const char = makeObj(1.5, 1.5, 2.5, 2.5, 0, 2.75); // contains wall footprint
    const wall = makeObj(1.8, 1.9, 2.2, 2.1, 0, 5); // taller, contained
    const result = topoSort([char, wall]);
    expect(result[0]).toBe(char); // shorter first (behind)
    expect(result[1]).toBe(wall); // taller last (in front)
  });

  it('shorter object inside a taller object footprint: taller in front', () => {
    // Flip: wall short (maxZ=1), char tall (maxZ=10), char contains wall XY.
    const wall = makeObj(1.8, 1.9, 2.2, 2.1, 0, 1);
    const char = makeObj(1.5, 1.5, 2.5, 2.5, 0, 10);
    const result = topoSort([wall, char]);
    expect(result[0]).toBe(wall); // shorter first
    expect(result[1]).toBe(char); // taller last
  });

  it('equal-height contained objects fall back to center-depth', () => {
    // Same maxZ -> Z cannot decide -> center-depth. Back-center drawn first.
    const back = makeObj(1.6, 1.6, 2.0, 2.0, 0, 3); // center 3.6
    const front = makeObj(1.5, 1.5, 2.5, 2.5, 0, 3); // center 4.0, contains back
    const result = topoSort([front, back]);
    expect(result[0]).toBe(back); // smaller center first
    expect(result[1]).toBe(front);
  });
});

describe('topoSort - Z-separated stacks', () => {
  it('lower baseZ drawn first when Z ranges do not overlap', () => {
    // Two stacked objects, identical XY footprint, no Z overlap.
    const ground = makeObj(0, 0, 2, 2, 0, 1); // [0,1]
    const floating = makeObj(0, 0, 2, 2, 5, 6); // [5,6]
    const result = topoSort([floating, ground]);
    expect(result[0]).toBe(ground); // lower first
    expect(result[1]).toBe(floating);
  });
});

describe('topoSort - mixed-axis equal far-sum (no cycle)', () => {
  it('equal maxX+maxY does not create a degenerate cycle', () => {
    // A: maxX=2,maxY=5 (sum 7); B: maxX=5,maxY=2 (sum 7). Partial XY overlap,
    // neither contains, mixed axis, equal far-sum. Previously both isBehind
    // directions returned true (<=) -> cycle -> order collapsed to input order.
    // Now no edge in either direction; Kahn resolves by center-depth.
    const a = makeObj(0, 0, 2, 5, 0, 1); // center 3.5
    const b = makeObj(1, 1, 5, 2, 0, 1); // center 4.5
    const r1 = topoSort([a, b]);
    const r2 = topoSort([b, a]);
    // Both input orders must yield the SAME geometric order (stable, not
    // input-dependent). Smaller center (a) first.
    expect(r1.map(o => (o === a ? 'a' : 'b')).join('')).toBe('ab');
    expect(r2.map(o => (o === a ? 'a' : 'b')).join('')).toBe('ab');
    expect(r1).toHaveLength(2);
  });
});

describe('topoSort - orphan vs cluster', () => {
  it('isolated object sorts by center-depth against a clustered group', () => {
    // Orphan in a separate spatial bucket (BUCKET_SIZE=2) must still be ordered
    // relative to a clustered group via the shared center-depth priority queue.
    const orphan = makeObj(0, 0, 1, 1); // center 1
    const c1 = makeObj(9, 9, 10, 10); // center 19
    const c2 = makeObj(9.5, 9.5, 10.5, 10.5); // center 20, overlaps c1
    const result = topoSort([c2, c1, orphan]);
    expect(result[0]).toBe(orphan); // smallest center first
    expect(result[1]).toBe(c1);
    expect(result[2]).toBe(c2);
  });
});

describe('topoSort - production behavior', () => {
  it('does not write debug state to globalThis', () => {
    const globals = globalThis as typeof globalThis & {
      __lastTopoSort?: string;
      __lastAabbs?: string;
    };
    delete globals.__lastTopoSort;
    delete globals.__lastAabbs;
    const player = Object.assign(makeObj(0, 0, 1, 1), {id: 'player'});
    const wall = Object.assign(makeObj(1, 1, 2, 2), {id: 'w1'});

    topoSort([wall, player]);

    expect(globals.__lastTopoSort).toBeUndefined();
    expect(globals.__lastAabbs).toBeUndefined();
  });

  it('orders a large sparse scene without losing objects', () => {
    const objects = Array.from({length: 2000}, (_, index) =>
      makeObj(index * 3, index * 3, index * 3 + 1, index * 3 + 1)
    ).reverse();
    const result = topoSort(objects);
    expect(result).toHaveLength(objects.length);
    expect(result[0].aabb.minX).toBe(0);
    expect(result[result.length - 1].aabb.minX).toBe(5997);
  });
});

describe('topoSort - 3+ object partial overlap chain', () => {
  it('orders a back-to-front chain of partially overlapping objects', () => {
    const back = makeObj(0, 0, 2, 2); // center 2
    const mid = makeObj(1, 1, 3, 3); // center 4, overlaps back
    const front = makeObj(2, 2, 4, 4); // center 6, overlaps mid
    const result = topoSort([front, back, mid]);
    expect(result).toEqual([back, mid, front]);
  });
});
