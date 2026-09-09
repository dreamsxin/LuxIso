/** 3D axis-aligned bounds. All values are in the same units the scene uses:
 *  X/Y in world tiles, `baseZ`/`maxZ` in SCREEN PIXELS (same unit as
 *  `IsoObject.position.z`). */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  baseZ: number;
  /**
   * Top of the bounding volume, in screen pixels. Omit for flat/ground objects:
   * they are then treated as a thin slab of `MIN_Z_EXTENT_PX` rather than an
   * infinite column, so a floor never claims to overlap everything above it.
   */
  maxZ?: number;
}

/**
 * Vertical extent assumed for an AABB that omits `maxZ`, in screen pixels.
 * 16 px is half a standard 32 px tile — thin enough not to swallow objects
 * standing on top, thick enough that two flat objects still compare.
 */
export const MIN_Z_EXTENT_PX = 16;

export interface Sortable {
  aabb: AABB;
}

function isBehind(a: AABB, b: AABB): boolean {
  const overlapX = a.minX < b.maxX && a.maxX > b.minX;
  const overlapY = a.minY < b.maxY && a.maxY > b.minY;
  const centerA = (a.minX + a.maxX + a.minY + a.maxY) / 2;
  const centerB = (b.minX + b.maxX + b.minY + b.maxY) / 2;

  if (!overlapX || !overlapY) return centerA < centerB;

  const maxZA = a.maxZ ?? a.baseZ + MIN_Z_EXTENT_PX;
  const maxZB = b.maxZ ?? b.baseZ + MIN_Z_EXTENT_PX;
  const overlapZ = a.baseZ < maxZB && maxZA > b.baseZ;
  if (!overlapZ) return a.baseZ < b.baseZ;

  const bContainsA = b.minX <= a.minX && b.maxX >= a.maxX &&
    b.minY <= a.minY && b.maxY >= a.maxY;
  const aContainsB = a.minX <= b.minX && a.maxX >= b.maxX &&
    a.minY <= b.minY && a.maxY >= b.maxY;

  if (bContainsA && aContainsB) return centerA < centerB;
  if (bContainsA || aContainsB) {
    if (maxZA !== maxZB) return maxZA < maxZB;
    return centerA < centerB;
  }

  const aFarX = a.maxX <= b.maxX;
  const aFarY = a.maxY <= b.maxY;
  if (aFarX && aFarY) return true;
  if (!aFarX && !aFarY) return false;
  return a.maxX + a.maxY < b.maxX + b.maxY;
}

class IndexMinHeap {
  private _items: number[] = [];

  constructor(private readonly _depths: Float64Array) {}

  get size(): number {
    return this._items.length;
  }

  push(index: number): void {
    const items = this._items;
    let position = items.length;
    items.push(index);
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (!this._before(index, items[parent])) break;
      items[position] = items[parent];
      position = parent;
    }
    items[position] = index;
  }

  pop(): number {
    const items = this._items;
    const first = items[0];
    const last = items.pop()!;
    if (items.length === 0) return first;

    let position = 0;
    while (true) {
      const left = position * 2 + 1;
      if (left >= items.length) break;
      const right = left + 1;
      const child = right < items.length && this._before(items[right], items[left]) ? right : left;
      if (!this._before(items[child], last)) break;
      items[position] = items[child];
      position = child;
    }
    items[position] = last;
    return first;
  }

  private _before(a: number, b: number): boolean {
    const difference = this._depths[a] - this._depths[b];
    return difference < 0 || (difference === 0 && a < b);
  }
}

const BUCKET_SIZE = 2;
type SpatialGrid = Map<number, Map<number, number[]>>;

function bucket(grid: SpatialGrid, x: number, y: number, create: boolean): number[] | undefined {
  let column = grid.get(x);
  if (!column) {
    if (!create) return undefined;
    column = new Map();
    grid.set(x, column);
  }
  let values = column.get(y);
  if (!values && create) {
    values = [];
    column.set(y, values);
  }
  return values;
}

/**
 * Stable topological depth sort. A spatial grid limits AABB comparisons to
 * nearby objects, while a min-heap keeps Kahn queue operations O(log n).
 */
export function topoSort<T extends Sortable>(objects: T[]): T[] {
  const count = objects.length;
  if (count <= 1) return [...objects];

  const graph: number[][] = Array.from({ length: count }, () => []);
  const inDegree = new Int32Array(count);
  const depths = new Float64Array(count);
  const grid: SpatialGrid = new Map();

  for (let i = 0; i < count; i++) {
    const bounds = objects[i].aabb;
    depths[i] = (bounds.minX + bounds.maxX + bounds.minY + bounds.maxY) / 2;
    const minBucketX = Math.floor(bounds.minX / BUCKET_SIZE);
    const minBucketY = Math.floor(bounds.minY / BUCKET_SIZE);
    const maxBucketX = Math.floor(bounds.maxX / BUCKET_SIZE);
    const maxBucketY = Math.floor(bounds.maxY / BUCKET_SIZE);
    for (let x = minBucketX; x <= maxBucketX; x++) {
      for (let y = minBucketY; y <= maxBucketY; y++) bucket(grid, x, y, true)!.push(i);
    }
  }

  const compared = new Set<number>();
  for (let i = 0; i < count; i++) {
    const bounds = objects[i].aabb;
    const minBucketX = Math.floor(bounds.minX / BUCKET_SIZE);
    const minBucketY = Math.floor(bounds.minY / BUCKET_SIZE);
    const maxBucketX = Math.floor(bounds.maxX / BUCKET_SIZE);
    const maxBucketY = Math.floor(bounds.maxY / BUCKET_SIZE);
    for (let x = minBucketX; x <= maxBucketX; x++) {
      for (let y = minBucketY; y <= maxBucketY; y++) {
        const candidates = bucket(grid, x, y, false);
        if (!candidates) continue;
        for (const candidate of candidates) {
          if (candidate === i) continue;
          const pair = i < candidate ? i * count + candidate : candidate * count + i;
          if (compared.has(pair)) continue;
          compared.add(pair);

          const iBeforeCandidate = isBehind(objects[i].aabb, objects[candidate].aabb);
          const candidateBeforeI = !iBeforeCandidate &&
            isBehind(objects[candidate].aabb, objects[i].aabb);
          if (iBeforeCandidate) {
            graph[i].push(candidate);
            inDegree[candidate]++;
          } else if (candidateBeforeI) {
            graph[candidate].push(i);
            inDegree[i]++;
          }
        }
      }
    }
  }

  const ready = new IndexMinHeap(depths);
  for (let i = 0; i < count; i++) {
    if (inDegree[i] === 0) ready.push(i);
  }

  const result: T[] = [];
  const emitted = new Uint8Array(count);
  while (ready.size > 0) {
    const index = ready.pop();
    emitted[index] = 1;
    result.push(objects[index]);
    for (const next of graph[index]) {
      if (--inDegree[next] === 0) ready.push(next);
    }
  }

  // Cyclic constraints are ambiguous; preserve every remaining object in
  // deterministic center-depth order rather than dropping renderables.
  if (result.length < count) {
    const remaining = new IndexMinHeap(depths);
    for (let i = 0; i < count; i++) {
      if (!emitted[i]) remaining.push(i);
    }
    while (remaining.size > 0) result.push(objects[remaining.pop()]);
  }
  return result;
}
