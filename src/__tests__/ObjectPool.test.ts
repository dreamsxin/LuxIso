import { describe, it, expect } from 'vitest';
import { ObjectPool } from '../core/ObjectPool';

interface Item { value: number }

function makePool(initialSize = 0, maxSize = 0): {
  pool: ObjectPool<Item>;
  created: () => number;
  resets: () => number;
} {
  let created = 0;
  let resets = 0;
  const pool = new ObjectPool<Item>(
    () => { created++; return { value: 0 }; },
    (item) => { resets++; item.value = 0; },
    initialSize,
    maxSize,
  );
  return { pool, created: () => created, resets: () => resets };
}

describe('ObjectPool — allocation and recycling', () => {
  it('pre-allocates initialSize objects into the free list', () => {
    const { pool, created } = makePool(4);
    expect(created()).toBe(4);
    expect(pool.freeCount).toBe(4);
    expect(pool.activeCount).toBe(0);
    expect(pool.totalCount).toBe(4);
  });

  it('reuses a released object instead of allocating a new one', () => {
    const { pool, created } = makePool(1);
    const first = pool.acquire();
    expect(created()).toBe(1);

    pool.release(first!);
    const second = pool.acquire();

    expect(second).toBe(first);
    expect(created()).toBe(1);
  });

  it('allocates on demand when the free list is empty', () => {
    const { pool, created } = makePool(0);
    pool.acquire();
    pool.acquire();
    expect(created()).toBe(2);
    expect(pool.activeCount).toBe(2);
  });

  it('resets an object on release, not on acquire', () => {
    const { pool, resets } = makePool(1);
    const item = pool.acquire()!;
    item.value = 42;
    expect(resets()).toBe(0);

    pool.release(item);
    expect(resets()).toBe(1);
    expect(item.value).toBe(0);
  });

  it('ignores release() for an object it does not own', () => {
    const { pool, resets } = makePool(1);
    pool.release({ value: 9 });
    expect(resets()).toBe(0);
    expect(pool.freeCount).toBe(1);
  });

  it('ignores a double release', () => {
    const { pool, resets } = makePool(1);
    const item = pool.acquire()!;
    pool.release(item);
    pool.release(item);
    expect(resets()).toBe(1);
    expect(pool.freeCount).toBe(1);
    expect(pool.totalCount).toBe(1);
  });
});

describe('ObjectPool — maxSize caps concurrent use', () => {
  it('returns null once maxSize objects are active', () => {
    const { pool } = makePool(0, 2);
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
  });

  it('frees capacity again after a release', () => {
    const { pool } = makePool(0, 1);
    const item = pool.acquire()!;
    expect(pool.acquire()).toBeNull();
    pool.release(item);
    expect(pool.acquire()).toBe(item);
  });

  it('treats maxSize 0 as unlimited', () => {
    const { pool } = makePool(0, 0);
    for (let i = 0; i < 50; i++) expect(pool.acquire()).not.toBeNull();
    expect(pool.activeCount).toBe(50);
  });
});

describe('ObjectPool — releaseAll and forEach', () => {
  it('returns every active object and resets each one', () => {
    const { pool, resets } = makePool(0);
    const items = [pool.acquire()!, pool.acquire()!, pool.acquire()!];
    for (const item of items) item.value = 1;

    pool.releaseAll();

    expect(pool.activeCount).toBe(0);
    expect(pool.freeCount).toBe(3);
    expect(resets()).toBe(3);
    expect(items.every((i) => i.value === 0)).toBe(true);
  });

  it('allows release() during forEach iteration', () => {
    const { pool } = makePool(0);
    pool.acquire(); pool.acquire(); pool.acquire();

    let visited = 0;
    expect(() => pool.forEach((item) => { visited++; pool.release(item); })).not.toThrow();

    expect(visited).toBe(3);
    expect(pool.activeCount).toBe(0);
  });
});

describe('ObjectPool — prewarm and trim', () => {
  it('allocates up to the requested total', () => {
    const { pool, created } = makePool(2);
    pool.prewarm(5);
    expect(created()).toBe(5);
    expect(pool.totalCount).toBe(5);
  });

  it('does nothing when already at or above the target', () => {
    const { pool, created } = makePool(5);
    pool.prewarm(3);
    expect(created()).toBe(5);
  });

  it('never pre-warms past maxSize', () => {
    // acquire() refuses to hand out more than maxSize, so allocating beyond it
    // would be memory that can never be used.
    const { pool, created } = makePool(0, 4);
    pool.prewarm(100);
    expect(created()).toBe(4);
    expect(pool.totalCount).toBe(4);
  });

  it('counts active objects toward the prewarm target', () => {
    const { pool, created } = makePool(0);
    pool.acquire();
    pool.prewarm(3);
    expect(created()).toBe(3);
    expect(pool.activeCount).toBe(1);
    expect(pool.freeCount).toBe(2);
  });

  it('shrinks the free list to maxFree and leaves active objects alone', () => {
    const { pool } = makePool(6);
    const held = pool.acquire()!;
    pool.trim(2);
    expect(pool.freeCount).toBe(2);
    expect(pool.activeCount).toBe(1);
    pool.release(held);
    expect(pool.freeCount).toBe(3);
  });
});
