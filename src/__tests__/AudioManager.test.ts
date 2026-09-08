import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioManager } from '../audio/AudioManager';

/**
 * AudioManager had zero unit coverage, which is how the two defects fixed in
 * the audit pass survived: a failed fetch permanently poisoned a URL, and there
 * was no way to release the AudioContext or the decoded-buffer cache.
 *
 * These tests drive the manager through a minimal Web Audio stub.
 */

class FakeParam {
  value = 0;
  setValueAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnectCount = 0;
  connect(target: FakeNode): FakeNode { this.outputs.push(target); return target; }
  disconnect(): void { this.disconnectCount++; }
}

class FakeGain extends FakeNode { readonly gain = new FakeParam(); }

class FakePanner extends FakeNode {
  panningModel = '';
  distanceModel = '';
  refDistance = 0;
  maxDistance = 0;
  rolloffFactor = 0;
  readonly positionX = new FakeParam();
  readonly positionY = new FakeParam();
  readonly positionZ = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void { this.started = true; }
  stop(): void { this.stopped = true; }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  closed = false;
  readonly destination = new FakeNode();
  readonly listener = {
    forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(),
    upX: new FakeParam(), upY: new FakeParam(), upZ: new FakeParam(),
    positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(),
  };
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly panners: FakePanner[] = [];
  decodeCalls = 0;

  createGain(): FakeGain { const g = new FakeGain(); this.gains.push(g); return g; }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
  createPanner(): FakePanner { const p = new FakePanner(); this.panners.push(p); return p; }
  decodeAudioData(): Promise<unknown> { this.decodeCalls++; return Promise.resolve({ duration: 1 }); }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
  close(): Promise<void> { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
}

let contexts: FakeAudioContext[] = [];
let fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

function okResponse(): { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> } {
  return { ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
}

beforeEach(() => {
  contexts = [];
  fetchImpl = () => Promise.resolve(okResponse());
  vi.stubGlobal('AudioContext', class { constructor() { const c = new FakeAudioContext(); contexts.push(c); return c as never; } });
  vi.stubGlobal('fetch', (url: string) => fetchImpl(url));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const latest = (): FakeAudioContext => contexts[contexts.length - 1];

describe('AudioManager — buffer loading retry', () => {
  it('allows a retry after a failed fetch', async () => {
    const audio = new AudioManager();
    audio.resume();

    let attempts = 0;
    fetchImpl = () => {
      attempts++;
      return attempts === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(okResponse());
    };

    // The rejected promise used to stay in the in-flight map forever, so every
    // later call returned that same rejection and the URL was dead for good.
    await expect(audio.preload('/sfx/hit.ogg')).rejects.toThrow('offline');
    await expect(audio.preload('/sfx/hit.ogg')).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('allows a retry after a non-ok HTTP status', async () => {
    const audio = new AudioManager();
    audio.resume();

    let attempts = 0;
    fetchImpl = () => {
      attempts++;
      return attempts === 1
        ? Promise.resolve({ ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
        : Promise.resolve(okResponse());
    };

    await expect(audio.preload('/sfx/miss.ogg')).rejects.toThrow('404');
    await expect(audio.preload('/sfx/miss.ogg')).resolves.toBeUndefined();
  });

  it('decodes a given URL only once when it succeeds', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.preload('/sfx/hit.ogg');
    await audio.preload('/sfx/hit.ogg');
    expect(latest().decodeCalls).toBe(1);
  });
});

describe('AudioManager — playSfx', () => {
  it('returns null and does not reject when the buffer is not cached yet', async () => {
    const audio = new AudioManager();
    audio.resume();
    fetchImpl = () => Promise.reject(new Error('offline'));

    // A missing sound file must not surface as an unhandled rejection.
    expect(audio.playSfx('/sfx/absent.ogg')).toBeNull();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(console.warn).toHaveBeenCalled();
  });

  it('plays a cached buffer and tears the node chain down when it ends', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.preload('/sfx/hit.ogg');

    const source = audio.playSfx('/sfx/hit.ogg', {
      volume: 0.5,
      spatial: { x: 3, y: 4 },
    }) as unknown as FakeSource;

    expect(source).not.toBeNull();
    expect(source.started).toBe(true);
    expect(latest().panners.length).toBe(1);

    const panner = latest().panners[0];
    const volumeGain = latest().gains[latest().gains.length - 1];
    expect(source.disconnectCount).toBe(0);

    // Intermediate nodes used to stay wired to the bus for the context's life.
    source.onended?.();
    expect(source.disconnectCount).toBe(1);
    expect(panner.disconnectCount).toBe(1);
    expect(volumeGain.disconnectCount).toBe(1);
  });

  it('returns null when the context has never been resumed', () => {
    const audio = new AudioManager();
    expect(audio.playSfx('/sfx/hit.ogg')).toBeNull();
  });
});

describe('AudioManager — dispose', () => {
  it('closes the context, stops BGM and drops the buffer cache', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.preload('/bgm/theme.ogg');
    await audio.playBgm('/bgm/theme.ogg', 0);

    const ctx = latest();
    const bgm = ctx.sources[ctx.sources.length - 1];
    expect(bgm.started).toBe(true);

    audio.dispose();

    expect(bgm.stopped).toBe(true);
    expect(bgm.disconnectCount).toBeGreaterThan(0);
    expect(ctx.closed).toBe(true);
  });

  it('re-decodes after dispose, proving the cache was cleared', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.preload('/sfx/hit.ogg');
    const first = latest();
    expect(first.decodeCalls).toBe(1);

    audio.dispose();
    audio.resume();               // revive with a fresh context
    await audio.preload('/sfx/hit.ogg');

    expect(contexts.length).toBe(2);
    expect(latest()).not.toBe(first);
    expect(latest().decodeCalls).toBe(1);
  });

  it('is idempotent and safe before resume()', () => {
    const audio = new AudioManager();
    expect(() => { audio.dispose(); audio.dispose(); }).not.toThrow();
  });
});

describe('AudioManager — volume buses', () => {
  it('clamps each bus to 0–1 and mirrors it onto the gain node', () => {
    const audio = new AudioManager();
    audio.resume();

    audio.masterVolume = 2;
    audio.sfxVolume = -1;
    audio.bgmVolume = 0.25;

    expect(audio.masterVolume).toBe(1);
    expect(audio.sfxVolume).toBe(0);
    expect(audio.bgmVolume).toBe(0.25);

    // resume() creates master, sfx, bgm in that order.
    const [master, sfx, bgmGain] = latest().gains;
    expect(master.gain.value).toBe(1);
    expect(sfx.gain.value).toBe(0);
    expect(bgmGain.gain.value).toBe(0.25);
  });

  it('remembers volumes set before the context exists', () => {
    const audio = new AudioManager();
    audio.bgmVolume = 0.4;
    audio.resume();
    expect(latest().gains[2].gain.value).toBe(0.4);
  });
});

describe('AudioManager.spatialVolume', () => {
  it('is full volume inside refDistance and silent past maxDistance', () => {
    const near = AudioManager.spatialVolume({ x: 0, y: 0, listenerX: 0, listenerY: 0 });
    const far = AudioManager.spatialVolume({
      x: 100, y: 0, listenerX: 0, listenerY: 0, refDistance: 1, maxDistance: 10,
    });
    expect(near).toBe(1);
    expect(far).toBe(0);
  });

  it('decreases monotonically with distance', () => {
    const at = (d: number): number => AudioManager.spatialVolume({
      x: d, y: 0, listenerX: 0, listenerY: 0, refDistance: 1, maxDistance: 10,
    });
    expect(at(2)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(9));
    expect(at(2)).toBeLessThanOrEqual(1);
  });
});



