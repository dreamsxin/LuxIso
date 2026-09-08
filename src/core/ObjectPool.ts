/**
 * ObjectPool<T> — generic object pool to reduce GC pressure.
 *
 * Pre-allocates a set of objects and recycles them instead of
 * creating/destroying on every use. Ideal for particles, projectiles,
 * floating text, and any other frequently spawned/despawned objects.
 *
 * @example
 *   // Pool of reusable particle objects
 *   const pool = new ObjectPool(
 *     () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, active: false }),
 *     (p) => { p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.life = 0; p.active = false; },
 *     64,   // initial size
 *     256,  // max size (0 = unlimited)
 *   );
 *
 *   // Acquire an object from the pool
 *   const p = pool.acquire();
 *   p.x = 10; p.y = 5; p.life = 1.0; p.active = true;
 *
 *   // Return it when done
 *   pool.release(p);
 *
 *   // Or release all at once
 *   pool.releaseAll();
 */
export class ObjectPool<T> {
  private _free: T[] = [];
  private _active: Set<T> = new Set();
  private _factory: () => T;
  private _reset: (obj: T) => void;
  private _maxSize: number;

  /** Number of objects currently in use. */
  get activeCount(): number { return this._active.size; }

  /** Number of objects available in the free list. */
  get freeCount(): number { return this._free.length; }

  /** Total allocated objects (active + free). */
  get totalCount(): number { return this._active.size + this._free.length; }

  /**
   * @param factory  Creates a new object when the pool is empty.
   * @param reset    Resets an object's state before it's reused.
   * @param initialSize  Pre-allocate this many objects upfront.
   * @param maxSize  Cap on how many objects may be *active at once*
   *                 (0 = unlimited). `acquire()` returns null at the cap.
   *                 Note this bounds concurrent use, not total allocation:
   *                 released objects stay in the free list, so `totalCount`
   *                 can sit at `maxSize` while `activeCount` is 0.
   */
  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    initialSize = 0,
    maxSize = 0,
  ) {
    this._factory  = factory;
    this._reset    = reset;
    this._maxSize  = maxSize;

    for (let i = 0; i < initialSize; i++) {
      this._free.push(factory());
    }
  }

  /**
   * Acquire an object from the pool.
   * Returns null if the pool is at max capacity.
   */
  acquire(): T | null {
    if (this._maxSize > 0 && this._active.size >= this._maxSize) {
      return null;
    }

    const obj = this._free.length > 0
      ? this._free.pop()!
      : this._factory();

    this._active.add(obj);
    return obj;
  }

  /**
   * Return an object to the pool.
   * The reset function is called before the object is made available again.
   */
  release(obj: T): void {
    if (!this._active.has(obj)) return;
    this._active.delete(obj);
    this._reset(obj);
    this._free.push(obj);
  }

  /**
   * Release all active objects back to the pool.
   */
  releaseAll(): void {
    for (const obj of this._active) {
      this._reset(obj);
      this._free.push(obj);
    }
    this._active.clear();
  }

  /**
   * Iterate over all currently active objects.
   * Safe to call release() during iteration.
   */
  forEach(cb: (obj: T) => void): void {
    // Snapshot to allow release() during iteration
    for (const obj of [...this._active]) {
      cb(obj);
    }
  }

  /**
   * Pre-warm the pool by allocating additional objects up to `count` total.
   * Clamped to `maxSize` when one is set, so pre-warming can never push the
   * pool past the cap that `acquire()` enforces.
   */
  prewarm(count: number): void {
    const target = this._maxSize > 0 ? Math.min(count, this._maxSize) : count;
    const needed = target - this.totalCount;
    for (let i = 0; i < needed; i++) {
      this._free.push(this._factory());
    }
  }

  /**
   * Shrink the free list to at most `maxFree` objects.
   * Useful to reclaim memory after a burst.
   */
  trim(maxFree: number): void {
    while (this._free.length > maxFree) {
      this._free.pop();
    }
  }
}
