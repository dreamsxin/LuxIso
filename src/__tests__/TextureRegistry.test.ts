import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeGL } from './helpers/gl';
import { GLResourceRegistry } from '../../webgl-next/src/device/GLResourceRegistry';
import { TextureRegistry } from '../../webgl-next/src/resources/TextureRegistry';

/**
 * The WebGL2 texture cache, and the leak it used to be.
 *
 * Records were kept for the renderer's whole lifetime: a URL that stopped being
 * referenced — a scene changed, a sprite sheet swapped — stayed resident on the
 * GPU until the renderer was destroyed. `beginFrame()` / `evictIdle()` bracket a
 * frame so an unreferenced texture is reclaimed, and the reclaim goes through
 * `GLResourceRegistry.releaseTexture` so the resource count stays honest.
 *
 * The image loads are driven by hand through a fake `Image`, which also makes the
 * failure path reachable — it had no coverage at all.
 */

interface PendingImage {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  crossOrigin: string | null;
}

let pending: PendingImage[] = [];
const originalImage = globalThis.Image;

beforeEach(() => {
  pending = [];
  class FakeImage implements PendingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin: string | null = null;
    private _src = '';
    get src(): string { return this._src; }
    set src(value: string) {
      this._src = value;
      pending.push(this);
    }
  }
  (globalThis as { Image: unknown }).Image = FakeImage;
});

afterEach(() => {
  (globalThis as { Image: unknown }).Image = originalImage;
  vi.restoreAllMocks();
});

/**
 * Take the most recent pending load for `url`, and consume it.
 *
 * The most recent, not the first: a previously completed image keeps its `onload`
 * closure over the record it was loading for, so firing an old one would write a
 * texture into a record that has since been evicted.
 */
function takePending(url: string): PendingImage {
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].src === url) return pending.splice(i, 1)[0];
  }
  throw new Error(`no pending load for ${url}`);
}

/** Complete the load for `url`, as the browser would. */
function finishLoad(url: string): void {
  takePending(url).onload?.();
}

/** Fail the load for `url`. */
function failLoad(url: string): void {
  takePending(url).onerror?.();
}

function setup(): {
  fake: ReturnType<typeof createFakeGL>;
  resources: GLResourceRegistry;
  textures: TextureRegistry;
} {
  const fake = createFakeGL();
  const resources = new GLResourceRegistry(fake.gl);
  const textures = new TextureRegistry(fake.gl, resources);
  return { fake, resources, textures };
}

describe('TextureRegistry — resolve', () => {
  it('creates the 1x1 white fallback up front', () => {
    const { fake, textures } = setup();
    expect(fake.created.length).toBe(1);
    expect(textures.white).toBe(fake.created[0]);
    expect(textures.size).toBe(0);
  });

  it('returns null while an image is still loading, then the texture', () => {
    const { fake, textures } = setup();
    expect(textures.resolve('atlas.png')).toBeNull();
    expect(fake.created.length).toBe(1);   // nothing on the GPU yet

    finishLoad('atlas.png');
    const resolved = textures.resolve('atlas.png');
    expect(resolved).toBe(fake.created[1]);
    expect(textures.size).toBe(1);
  });

  it('loads a URL once however often it is resolved', () => {
    const { fake, textures } = setup();
    for (let i = 0; i < 10; i++) textures.resolve('atlas.png');
    expect(pending.length).toBe(1);
    finishLoad('atlas.png');
    for (let i = 0; i < 10; i++) textures.resolve('atlas.png');
    expect(fake.created.length).toBe(2);   // white + the atlas
  });

  it('sets crossOrigin for remote URLs but not for inline data', () => {
    const { textures } = setup();
    textures.resolve('https://cdn.example/atlas.png');
    textures.resolve('data:image/png;base64,AAAA');
    textures.resolve('blob:whatever');
    expect(pending[0].crossOrigin).toBe('anonymous');
    expect(pending[1].crossOrigin).toBeNull();
    expect(pending[2].crossOrigin).toBeNull();
  });
});

describe('TextureRegistry — failure', () => {
  it('falls back to white and warns once, not once per frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { textures } = setup();
    textures.resolve('missing.png');
    failLoad('missing.png');

    for (let i = 0; i < 5; i++) {
      // Drawing untextured beats dropping the geometry: a 404 used to make every
      // object using this URL permanently invisible with no diagnostic.
      expect(textures.resolve('missing.png')).toBe(textures.white);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(textures.failedUrls).toEqual(['missing.png']);
  });
});

describe('TextureRegistry — eviction', () => {
  /** Advance `frames` frames, resolving `keep` on each so it stays referenced. */
  function advance(textures: TextureRegistry, frames: number, keep: string[] = []): void {
    for (let i = 0; i < frames; i++) {
      textures.beginFrame();
      for (const url of keep) textures.resolve(url);
      textures.evictIdle();
    }
  }

  it('keeps a texture that is resolved every frame', () => {
    const { fake, textures } = setup();
    textures.beginFrame();
    textures.resolve('atlas.png');
    finishLoad('atlas.png');
    textures.resolve('atlas.png');

    advance(textures, TextureRegistry.DEFAULT_IDLE_FRAMES * 2, ['atlas.png']);

    expect(textures.size).toBe(1);
    expect(fake.deleted).toEqual([]);
  });

  it('deletes a texture that goes unreferenced, through the resource registry', () => {
    const { fake, resources, textures } = setup();
    textures.beginFrame();
    textures.resolve('atlas.png');
    finishLoad('atlas.png');
    textures.resolve('atlas.png');
    const atlas = fake.created[1];
    expect(resources.counts.textures).toBe(2);   // white + atlas

    advance(textures, TextureRegistry.DEFAULT_IDLE_FRAMES + 2);

    expect(textures.size).toBe(0);
    expect(fake.deleted).toEqual([atlas]);
    // The count has to drop too: the lifecycle harness asserts it reaches zero.
    expect(resources.counts.textures).toBe(1);
    expect(textures.white).toBe(fake.created[0]);
  });

  it('does not evict before the idle window elapses', () => {
    const { fake, textures } = setup();
    textures.beginFrame();
    textures.resolve('atlas.png');
    finishLoad('atlas.png');
    textures.resolve('atlas.png');

    advance(textures, TextureRegistry.DEFAULT_IDLE_FRAMES);
    expect(fake.deleted).toEqual([]);
    expect(textures.size).toBe(1);
  });

  it('never evicts a record that is still loading', () => {
    const { fake, textures } = setup();
    textures.beginFrame();
    textures.resolve('slow.png');

    // A long stall — the image has not called back yet.
    advance(textures, TextureRegistry.DEFAULT_IDLE_FRAMES * 3);
    // Evicting mid-flight would let the callback write a texture into a record
    // nobody tracks any more, which is the leak this method exists to prevent.
    finishLoad('slow.png');
    expect(textures.resolve('slow.png')).toBe(fake.created[1]);
    expect(fake.deleted).toEqual([]);
  });

  it('reloads a URL that comes back after being evicted', () => {
    const { fake, textures } = setup();
    textures.beginFrame();
    textures.resolve('atlas.png');
    finishLoad('atlas.png');
    textures.resolve('atlas.png');
    advance(textures, TextureRegistry.DEFAULT_IDLE_FRAMES + 2);
    expect(textures.size).toBe(0);

    textures.beginFrame();
    expect(textures.resolve('atlas.png')).toBeNull();   // loading again
    finishLoad('atlas.png');
    expect(textures.resolve('atlas.png')).toBe(fake.created[2]);
    expect(textures.size).toBe(1);
  });

  it('gives a failed URL another chance once its record is evicted', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { textures } = setup();
    textures.beginFrame();
    textures.resolve('flaky.png');
    failLoad('flaky.png');
    expect(textures.failedUrls).toEqual(['flaky.png']);

    advance(textures, TextureRegistry.DEFAULT_IDLE_FRAMES + 2);
    expect(textures.failedUrls).toEqual([]);

    textures.beginFrame();
    textures.resolve('flaky.png');
    finishLoad('flaky.png');
    expect(textures.resolve('flaky.png')).not.toBe(textures.white);
  });

  it('does nothing once disposed', () => {
    const { fake, textures } = setup();
    textures.beginFrame();
    textures.resolve('atlas.png');
    finishLoad('atlas.png');
    textures.resolve('atlas.png');

    textures.dispose();
    textures.beginFrame();
    expect(textures.evictIdle(0)).toBe(0);
    expect(textures.resolve('atlas.png')).toBeNull();
    // Teardown is `GLResourceRegistry.dispose`'s job, not eviction's.
    expect(fake.deleted).toEqual([]);
  });
});



