import { TileCollider } from './TileCollider';

export interface IsoVec2 { x: number; y: number; }

interface Node {
  col: number;
  row: number;
  g: number;   // cost from start
  h: number;   // heuristic to goal
  f: number;   // g + h
  parent: Node | null;
  /** Heap index — kept in sync by BinaryHeap for O(1) decrease-key. */
  _heapIdx: number;
}
// ── Binary min-heap keyed on Node.f ─────────────────────────────────────────
// Standard array-backed heap. push O(log n), pop O(log n), update O(log n).

class BinaryHeap {
  private _data: Node[] = [];

  get size(): number { return this._data.length; }

  push(node: Node): void {
    node._heapIdx = this._data.length;
    this._data.push(node);
    this._bubbleUp(this._data.length - 1);
  }

  pop(): Node {
    const top  = this._data[0];
    const last = this._data.pop()!;
    if (this._data.length > 0) {
      last._heapIdx = 0;
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  /** Call after decreasing node.f to restore heap invariant. */
  decreased(node: Node): void {
    this._bubbleUp(node._heapIdx);
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._data[parent].f <= this._data[i].f) break;
      this._swap(parent, i);
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const n = this._data.length;
    for (;;) {
      let smallest = i;
      const l = (i << 1) + 1;
      const r = l + 1;
      if (l < n && this._data[l].f < this._data[smallest].f) smallest = l;
      if (r < n && this._data[r].f < this._data[smallest].f) smallest = r;
      if (smallest === i) break;
      this._swap(i, smallest);
      i = smallest;
    }
  }

  private _swap(a: number, b: number): void {
    const da = this._data[a];
    const db = this._data[b];
    da._heapIdx = b;
    db._heapIdx = a;
    this._data[a] = db;
    this._data[b] = da;
  }
}

const nodeKey = (col: number, row: number) => `${col},${row}`;

// ── PathCache ─────────────────────────────────────────────────────────────────
// Instance-level LRU path-result cache.
//
// Each Scene (or any owner that has its own TileCollider) should create its own
// PathCache so that switching scenes never invalidates another scene's cached
// paths. The default module-level cache used by the static Pathfinder.find()
// still exists for backwards-compatible call sites.

interface CacheEntry {
  result: IsoVec2[] | null;
  lruOrder: number;
  version: number;
}

/**
 * LRU cache for A* path results, scoped to a single TileCollider instance.
 *
 * Create one per scene / per agent group and pass it to `Pathfinder.find()`.
 * This prevents multi-scene cache pollution that occurs when a module-level
 * cache is shared across scenes with different TileColliders.
 *
 * @example
 *   const pathCache = new PathCache(64);
 *   const path = Pathfinder.find(collider, start, goal, pathCache);
 *   // later, when the map changes:
 *   pathCache.invalidate();
 */
export class PathCache {
  private _collider: TileCollider | null = null;
  private _version  = 0;
  private _gridVersion = -1;
  private _lruClock = 0;
  private _map      = new Map<string, CacheEntry>();
  readonly capacity: number;

  constructor(capacity = 64) {
    this.capacity = capacity;
  }

  /**
   * Drop everything if the collider identity changed or its grid was mutated
   * since the last access. `TileCollider.setWalkable` mutates in place and
   * notifies nobody, so without the grid-version check a cache would keep
   * serving pre-change paths indefinitely.
   */
  private _syncTo(collider: TileCollider): void {
    if (collider === this._collider && collider.version === this._gridVersion) return;
    this._map.clear();
    this._collider = collider;
    this._gridVersion = collider.version;
    this._version++;
  }

  get(collider: TileCollider, key: string): IsoVec2[] | null | undefined {
    this._syncTo(collider);
    const entry = this._map.get(key);
    if (!entry || entry.version !== this._version) return undefined;
    entry.lruOrder = ++this._lruClock;
    return entry.result;
  }

  set(collider: TileCollider, key: string, result: IsoVec2[] | null): void {
    this._syncTo(collider);
    if (this._map.size >= this.capacity) {
      // Evict LRU entry
      let oldest = Infinity, oldestKey = '';
      for (const [k, v] of this._map) {
        if (v.lruOrder < oldest) { oldest = v.lruOrder; oldestKey = k; }
      }
      if (oldestKey) this._map.delete(oldestKey);
    }
    this._map.set(key, { result, lruOrder: ++this._lruClock, version: this._version });
  }

  /**
   * Invalidate all cached paths. Grid mutations are picked up automatically via
   * `TileCollider.version`; this remains useful when walkability is changed
   * through some other mechanism.
   * Optionally pass the collider to only invalidate if it matches.
   */
  invalidate(collider?: TileCollider): void {
    if (!collider || collider === this._collider) {
      this._version++;
      this._map.clear();
    }
  }

  /** Number of currently cached entries. */
  get size(): number { return this._map.size; }
}

// Module-level default cache — used by the static Pathfinder.find() for
// backwards-compatible call sites that do not pass an explicit PathCache.
const _defaultCache = new PathCache(64);

/**
 * A* pathfinder over a TileCollider grid.
 *
 * Returns a list of world-space waypoints (tile centres) from the tile
 * containing `start` to the tile containing `goal`, or null if no path exists.
 *
 * - Supports 8-directional movement (diagonal cost = √2).
 * - Diagonal moves are blocked when either adjacent cardinal tile is blocked
 *   (corner-cutting prevention). String-pulling applies the same rule.
 * - Open list uses a binary min-heap for O(log n) push/pop.
 * - Path is post-processed with Bresenham LoS string-pulling to straighten
 *   zigzag routes across open areas.
 * - Results are cached per (collider, start-tile, goal-tile) and are dropped
 *   automatically when `TileCollider.version` changes. Pass an explicit
 *   `PathCache` instance per scene to avoid cross-scene cache pollution.
 *
 * @example
 *   // Simple (backwards-compatible) — uses module-level cache:
 *   const path = Pathfinder.find(collider, { x: 1, y: 1 }, { x: 7, y: 5 });
 *
 *   // Recommended — per-scene cache:
 *   const pathCache = new PathCache();
 *   const path = Pathfinder.find(collider, start, goal, pathCache);
 *   if (path) mv.followPath(path);
 */
export class Pathfinder {
  /**
   * Find a path from `start` to `goal` on the given collider grid.
   * Returns tile-centre world coordinates, or `null` if unreachable.
   *
   * @param cache  Optional per-scene PathCache. When omitted, a module-level
   *               default cache is used (backwards-compatible but shared across
   *               all scenes — may cause cross-scene cache flushes).
   */
  static find(
    collider: TileCollider,
    start: IsoVec2,
    goal: IsoVec2,
    cache: PathCache = _defaultCache,
  ): IsoVec2[] | null {
    const sc = Math.floor(start.x);
    const sr = Math.floor(start.y);
    const gc = Math.floor(goal.x);
    const gr = Math.floor(goal.y);

    const cacheKey = `${sc},${sr}→${gc},${gr}`;
    const cached = cache.get(collider, cacheKey);
    if (cached !== undefined) return cached;

    const result = Pathfinder._search(collider, sc, sr, gc, gr);
    cache.set(collider, cacheKey, result);
    return result;
  }

  /**
   * Invalidate the module-level default path result cache.
   * For per-scene caches, call `pathCache.invalidate()` directly.
   * If `collider` is omitted, all cached results are cleared.
   *
   * @deprecated Prefer passing an explicit PathCache and calling
   *             `pathCache.invalidate()` instead.
   */
  static invalidateCache(collider?: TileCollider): void {
    _defaultCache.invalidate(collider);
  }

  // ── Internal A* search ───────────────────────────────────────────────────

  private static _search(
    collider: TileCollider,
    sc: number, sr: number,
    gc: number, gr: number,
  ): IsoVec2[] | null {
    if (!collider.isWalkable(gc, gr)) return null;
    if (sc === gc && sr === gr) return [{ x: gc + 0.5, y: gr + 0.5 }];

    const open   = new BinaryHeap();
    const closed = new Set<string>();
    const best   = new Map<string, number>(); // key → best g seen
    const nodeMap = new Map<string, Node>();  // key → open-list node (for decrease-key)

    const startNode: Node = {
      col: sc, row: sr,
      g: 0, h: Pathfinder._h(sc, sr, gc, gr), f: 0,
      parent: null, _heapIdx: 0,
    };
    startNode.f = startNode.h;
    open.push(startNode);
    best.set(nodeKey(sc, sr), 0);
    nodeMap.set(nodeKey(sc, sr), startNode);

    while (open.size > 0) {
      const cur = open.pop();
      const ck  = nodeKey(cur.col, cur.row);

      if (closed.has(ck)) continue;
      closed.add(ck);
      nodeMap.delete(ck);

      if (cur.col === gc && cur.row === gr) {
        return Pathfinder._reconstruct(cur, collider);
      }

      for (const [dc, dr, cost] of Pathfinder._neighbors(collider, cur.col, cur.row)) {
        const nc = cur.col + dc;
        const nr = cur.row + dr;
        const nk = nodeKey(nc, nr);
        if (closed.has(nk)) continue;

        const g = cur.g + cost;
        if ((best.get(nk) ?? Infinity) <= g) continue;
        best.set(nk, g);

        const h = Pathfinder._h(nc, nr, gc, gr);
        const existing = nodeMap.get(nk);
        if (existing) {
          // Decrease-key: update in place and restore heap invariant
          existing.g      = g;
          existing.h      = h;
          existing.f      = g + h;
          existing.parent = cur;
          open.decreased(existing);
        } else {
          const node: Node = { col: nc, row: nr, g, h, f: g + h, parent: cur, _heapIdx: 0 };
          open.push(node);
          nodeMap.set(nk, node);
        }
      }
    }

    return null; // unreachable
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /** Octile heuristic for 8-directional grids. */
  private static _h(c: number, r: number, gc: number, gr: number): number {
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  /**
   * Returns valid neighbor offsets [dc, dr, moveCost].
   * Diagonal moves blocked when either shared cardinal tile is blocked.
   */
  private static _neighbors(
    collider: TileCollider,
    col: number,
    row: number,
  ): [number, number, number][] {
    const dirs: [number, number, number][] = [
      [ 0, -1, 1],           // N
      [ 1,  0, 1],           // E
      [ 0,  1, 1],           // S
      [-1,  0, 1],           // W
      [ 1, -1, Math.SQRT2],  // NE
      [ 1,  1, Math.SQRT2],  // SE
      [-1,  1, Math.SQRT2],  // SW
      [-1, -1, Math.SQRT2],  // NW
    ];
    const result: [number, number, number][] = [];
    for (const [dc, dr, cost] of dirs) {
      const nc = col + dc;
      const nr = row + dr;
      if (!collider.isWalkable(nc, nr)) continue;
      if (dc !== 0 && dr !== 0) {
        if (!collider.isWalkable(col + dc, row) || !collider.isWalkable(col, row + dr)) continue;
      }
      result.push([dc, dr, cost]);
    }
    return result;
  }

  /** Reconstruct path from goal node back to start; apply string-pulling. */
  private static _reconstruct(goal: Node, collider: TileCollider): IsoVec2[] {
    const raw: IsoVec2[] = [];
    let n: Node | null = goal;
    while (n) {
      raw.push({ x: n.col + 0.5, y: n.row + 0.5 });
      n = n.parent;
    }
    raw.reverse();
    return Pathfinder._stringPull(raw, collider);
  }

  /**
   * String-pulling via Bresenham grid line-of-sight.
   *
   * Walks the path from an anchor point and advances the anchor whenever
   * there is a clear LoS to a further waypoint, skipping everything in
   * between. This converts staircased A* paths into straight-line segments
   * wherever the terrain is open.
   */
  private static _stringPull(path: IsoVec2[], collider: TileCollider): IsoVec2[] {
    if (path.length <= 2) return path;

    const out: IsoVec2[] = [path[0]];
    let anchor = 0;

    for (let i = 2; i < path.length; i++) {
      // Check LoS from current anchor to path[i]
      if (!Pathfinder._hasLoS(path[anchor], path[i], collider)) {
        // Lost LoS: keep path[i-1] as the last valid intermediate point
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }

    out.push(path[path.length - 1]);
    return out;
  }

  /**
   * Bresenham line walk to check grid LoS between two tile-centre points.
   * Returns true if every tile along the line is walkable.
   *
   * When the Bresenham step is diagonal it must apply the same corner-cutting
   * rule as `_neighbors`, i.e. both shared cardinal tiles have to be walkable.
   * Without that check string-pulling could straighten a legal staircase path
   * into one that clips the corner between two blocked tiles, and the agent
   * then wedges itself against the wall in `resolveMove`.
   */
  private static _hasLoS(a: IsoVec2, b: IsoVec2, collider: TileCollider): boolean {
    let c0 = Math.floor(a.x);
    let r0 = Math.floor(a.y);
    const c1 = Math.floor(b.x);
    const r1 = Math.floor(b.y);

    const dc = Math.abs(c1 - c0);
    const dr = Math.abs(r1 - r0);
    const sc = c0 < c1 ? 1 : -1;
    const sr = r0 < r1 ? 1 : -1;
    let err = dc - dr;

    for (;;) {
      if (!collider.isWalkable(c0, r0)) return false;
      if (c0 === c1 && r0 === r1) break;
      const e2 = err << 1;
      const stepC = e2 > -dr;
      const stepR = e2 <  dc;
      if (stepC && stepR) {
        // Diagonal step — reject if either shared cardinal is blocked.
        if (!collider.isWalkable(c0 + sc, r0) || !collider.isWalkable(c0, r0 + sr)) return false;
      }
      if (stepC) { err -= dr; c0 += sc; }
      if (stepR) { err += dc; r0 += sr; }
    }
    return true;
  }
}
