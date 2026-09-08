import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AssetLoader } from '../core/AssetLoader';

/**
 * AssetLoader was at 20% statements / 0% branches. The `unload()` contract in
 * particular was untested and the implementation contradicted its own docstring:
 * a load already in flight re-populated the cache after the caller had released
 * the asset.
 */

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';

  get src(): string { return this._src; }
  set src(value: string) {
    this._src = value;
    FakeImage.pending.push(this);
  }

  static pending: FakeImage[] = [];

  /** Resolve the oldest outstanding load. */
  static settleNext(ok = true): void {
    const img = FakeImage.pending.shift();
    if (!img) throw new Error('FakeImage: nothing pending');
    if (ok) img.onload?.();
    else img.onerror?.();
  }

  static settleFor(url: string, ok = true): void {
    const index = FakeImage.pending.findIndex((i) => i.src === url);
    if (index < 0) throw new Error(`FakeImage: no pending load for ${url}`);
    const [img] = FakeImage.pending.splice(index, 1);
    if (ok) img.onload?.();
    else img.onerror?.();
  }
}

let loader: AssetLoader;

beforeEach(() => {
  FakeImage.pending = [];
  vi.stubGlobal('Image', FakeImage);
  loader = new AssetLoader();
});

afterEach(() => {
  vi.unstubAllGlobals();
  AssetLoader.clear();
});

describe('AssetLoader — loading and caching', () => {
  it('resolves with the loaded image and caches it', async () => {
    const promise = loader.loadImage('/a.png');
    expect(loader.size).toBe(0);
    expect(loader.get('/a.png')).toBeUndefined();

    FakeImage.settleNext();
    const img = await promise;

    expect(loader.size).toBe(1);
    expect(loader.get('/a.png')).toBe(img);
  });

  it('returns the cached image without starting a second load', async () => {
    const promise = loader.loadImage('/a.png');
    FakeImage.settleNext();
    const first = await promise;

    const second = await loader.loadImage('/a.png');
    expect(second).toBe(first);
    expect(FakeImage.pending.length).toBe(0);
  });

  it('shares one in-flight promise between concurrent callers', async () => {
    const a = loader.loadImage('/a.png');
    const b = loader.loadImage('/a.png');
    expect(a).toBe(b);
    expect(FakeImage.pending.length).toBe(1);

    FakeImage.settleNext();
    await expect(a).resolves.toBeDefined();
  });

  it('rejects on error and allows a retry afterwards', async () => {
    const failing = loader.loadImage('/bad.png');
    FakeImage.settleNext(false);
    await expect(failing).rejects.toThrow('/bad.png');
    expect(loader.size).toBe(0);

    const retry = loader.loadImage('/bad.png');
    FakeImage.settleNext();
    await expect(retry).resolves.toBeDefined();
    expect(loader.size).toBe(1);
  });

  it('loadAll resolves once every image is ready', async () => {
    const all = loader.loadAll(['/a.png', '/b.png']);
    expect(FakeImage.pending.length).toBe(2);

    FakeImage.settleFor('/a.png');
    FakeImage.settleFor('/b.png');

    const images = await all;
    expect(images.length).toBe(2);
    expect(loader.size).toBe(2);
  });

  it('loadAll rejects if any image fails', async () => {
    const all = loader.loadAll(['/a.png', '/bad.png']);
    FakeImage.settleFor('/bad.png', false);
    await expect(all).rejects.toThrow('/bad.png');
  });
});

describe('AssetLoader — unload', () => {
  it('drops a cached asset', async () => {
    const promise = loader.loadImage('/a.png');
    FakeImage.settleNext();
    await promise;

    loader.unload('/a.png');
    expect(loader.size).toBe(0);
    expect(loader.get('/a.png')).toBeUndefined();
  });

  it('does not re-cache a load that completes after unload', async () => {
    const promise = loader.loadImage('/a.png');
    loader.unload('/a.png');

    FakeImage.settleNext();
    // The awaiter still gets its image — the promise is honoured …
    await expect(promise).resolves.toBeDefined();
    // … but the released asset must not come back into the cache.
    expect(loader.size).toBe(0);
    expect(loader.get('/a.png')).toBeUndefined();
  });

  it('starts a fresh load after unload rather than reusing the stale promise', async () => {
    loader.loadImage('/a.png');
    loader.unload('/a.png');

    const second = loader.loadImage('/a.png');
    expect(FakeImage.pending.length).toBe(2); // the abandoned one plus a new one

    FakeImage.settleFor('/a.png');
    FakeImage.settleFor('/a.png');
    await expect(second).resolves.toBeDefined();
    expect(loader.size).toBe(1);
  });

  it('is a no-op for an unknown URL', () => {
    expect(() => loader.unload('/never.png')).not.toThrow();
    expect(loader.size).toBe(0);
  });
});

describe('AssetLoader — clear and register', () => {
  it('clear empties the cache', async () => {
    const promise = loader.loadImage('/a.png');
    FakeImage.settleNext();
    await promise;

    loader.clear();
    expect(loader.size).toBe(0);
  });

  it('clear also prevents in-flight loads from repopulating the cache', async () => {
    const promise = loader.loadImage('/a.png');
    loader.clear();

    FakeImage.settleNext();
    await expect(promise).resolves.toBeDefined();
    expect(loader.size).toBe(0);
  });

  it('register injects an image without a network load', () => {
    const img = new FakeImage() as unknown as HTMLImageElement;
    loader.register('data:image/png;base64,AAA', img);
    expect(loader.size).toBe(1);
    expect(loader.get('data:image/png;base64,AAA')).toBe(img);
    expect(FakeImage.pending.length).toBe(0);
  });
});

describe('AssetLoader — per-instance isolation', () => {
  it('clearing one loader leaves another untouched', async () => {
    const other = new AssetLoader();

    const a = loader.loadImage('/a.png');
    const b = other.loadImage('/b.png');
    FakeImage.settleFor('/a.png');
    FakeImage.settleFor('/b.png');
    await Promise.all([a, b]);

    loader.clear();
    expect(loader.size).toBe(0);
    expect(other.size).toBe(1);
  });

  it('the static API delegates to AssetLoader.default', async () => {
    const promise = AssetLoader.loadImage('/static.png');
    FakeImage.settleNext();
    const img = await promise;

    expect(AssetLoader.get('/static.png')).toBe(img);
    expect(AssetLoader.default.size).toBe(1);
    // A separate instance must not see the shared default's cache.
    expect(loader.size).toBe(0);

    AssetLoader.clear();
    expect(AssetLoader.default.size).toBe(0);
  });
});
