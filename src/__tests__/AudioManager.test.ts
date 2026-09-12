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

/** Event-target stub that records listeners so tests can fire them. */
function listenerBag() {
  const map = new Map<string, Set<EventListener>>();
  return {
    target: {
      addEventListener(type: string, cb: EventListener) {
        if (!map.has(type)) map.set(type, new Set());
        map.get(type)!.add(cb);
      },
      removeEventListener(type: string, cb: EventListener) {
        map.get(type)?.delete(cb);
      },
    } as unknown as EventTarget,
    fire(type: string) {
      for (const cb of map.get(type) ?? []) cb({ type } as Event);
    },
    count(type: string) { return map.get(type)?.size ?? 0; },
  };
}

describe('AudioManager — preload without a gesture', () => {
  it('decodes before resume() is ever called', async () => {
    // An AudioContext may be constructed without a gesture; it just starts
    // suspended, and decodeAudioData works there. The old path polled for a
    // context and rejected after 5 s, so every preload issued at boot failed.
    const audio = new AudioManager();
    await audio.preload('/sfx/hit.wav');
    expect(latest().decodeCalls).toBe(1);
    audio.dispose();
  });

  it('reuses the same context for a later resume()', () => {
    const audio = new AudioManager();
    void audio.preload('/sfx/hit.wav');
    audio.resume();
    expect(contexts.length).toBe(1);
    audio.dispose();
  });
});

describe('AudioManager — page lifecycle binding', () => {
  it('unlocks on the first gesture and then detaches', () => {
    const gestures = listenerBag();
    const audio = new AudioManager();
    audio.bindPageLifecycle({ target: gestures.target, suspendWhileHidden: false });

    expect(gestures.count('pointerdown')).toBe(1);
    gestures.fire('pointerdown');
    expect(contexts.length).toBe(1);
    // One shot: a resumed context stays resumed.
    expect(gestures.count('pointerdown')).toBe(0);
    expect(gestures.count('touchend')).toBe(0);
    audio.dispose();
  });

  it('accepts touchend as the unlocking gesture', () => {
    const gestures = listenerBag();
    const audio = new AudioManager();
    audio.bindPageLifecycle({ target: gestures.target, suspendWhileHidden: false });
    gestures.fire('touchend');
    expect(contexts.length).toBe(1);
    audio.dispose();
  });

  it('suspends while the page is hidden and resumes on return', () => {
    const docBag = listenerBag();
    const hidden = { value: false };
    vi.stubGlobal('document', {
      addEventListener: (t: string, cb: EventListener) => docBag.target.addEventListener(t, cb),
      removeEventListener: (t: string, cb: EventListener) => docBag.target.removeEventListener(t, cb),
      get hidden() { return hidden.value; },
    });

    const audio = new AudioManager();
    audio.resume();
    audio.bindPageLifecycle({ unlockOnGesture: false });
    expect(latest().state).toBe('running');

    hidden.value = true;
    docBag.fire('visibilitychange');
    expect(latest().state).toBe('suspended');

    hidden.value = false;
    docBag.fire('visibilitychange');
    expect(latest().state).toBe('running');
    audio.dispose();
  });

  it('does nothing on visibility changes before a context exists', () => {
    const docBag = listenerBag();
    vi.stubGlobal('document', {
      addEventListener: (t: string, cb: EventListener) => docBag.target.addEventListener(t, cb),
      removeEventListener: (t: string, cb: EventListener) => docBag.target.removeEventListener(t, cb),
      hidden: true,
    });
    const audio = new AudioManager();
    audio.bindPageLifecycle({ unlockOnGesture: false });
    docBag.fire('visibilitychange');
    expect(contexts.length).toBe(0);
    audio.dispose();
  });

  it('the returned detach removes the gesture listeners', () => {
    const gestures = listenerBag();
    const audio = new AudioManager();
    const detach = audio.bindPageLifecycle({ target: gestures.target, suspendWhileHidden: false });
    detach();
    gestures.fire('pointerdown');
    expect(contexts.length).toBe(0);
    audio.dispose();
  });

  it('re-binding replaces the previous binding instead of stacking', () => {
    const first = listenerBag();
    const second = listenerBag();
    const audio = new AudioManager();
    audio.bindPageLifecycle({ target: first.target, suspendWhileHidden: false });
    audio.bindPageLifecycle({ target: second.target, suspendWhileHidden: false });

    expect(first.count('pointerdown')).toBe(0);
    expect(second.count('pointerdown')).toBe(1);
    audio.dispose();
  });

  it('dispose() detaches the lifecycle listeners', () => {
    const gestures = listenerBag();
    const audio = new AudioManager();
    audio.bindPageLifecycle({ target: gestures.target, suspendWhileHidden: false });
    audio.dispose();
    expect(gestures.count('pointerdown')).toBe(0);
  });
});

/**
 * A fetch stub whose responses are resolved by hand, so a test can interleave
 * two in-flight `playBgm` calls the way rapid scene switches do.
 */
function deferredFetch() {
  const waiting = new Map<string, () => void>();
  fetchImpl = (url: string) => new Promise((resolve) => {
    waiting.set(url, () => resolve(okResponse()));
  });
  return {
    /** Let `url`'s fetch resolve, then drain the decode microtasks. */
    async settle(url: string): Promise<void> {
      waiting.get(url)?.();
      waiting.delete(url);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe('AudioManager — playBgm', () => {
  it('starts a looping source on the bgm bus, with no fade-in for the first track', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.playBgm('/bgm/plains.ogg');

    const ctx = latest();
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.sources[0].started).toBe(true);
    // Straight onto the bus: fading the first track in from silence would just
    // delay the music with nothing to cross from.
    expect(ctx.sources[0].outputs.length).toBe(1);
    audio.dispose();
  });

  it('ignores a repeat request for the track already playing', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.playBgm('/bgm/plains.ogg');
    await audio.playBgm('/bgm/plains.ogg');
    expect(latest().sources.length).toBe(1);
    audio.dispose();
  });

  it('does nothing before a context exists', async () => {
    const audio = new AudioManager();
    await audio.playBgm('/bgm/plains.ogg');
    expect(contexts.length).toBe(0);
  });
});

describe('AudioManager — bgm crossfade teardown', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('unwires the outgoing track and its fade nodes once the fade ends', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.playBgm('/bgm/a.ogg', 1);
    await audio.playBgm('/bgm/b.ogg', 1);

    const ctx = latest();
    const [first, second] = ctx.sources;
    expect(ctx.sources.length).toBe(2);
    expect(second.started).toBe(true);
    // Outgoing source is still audible during the fade.
    expect(first.stopped).toBe(false);

    vi.advanceTimersByTime(1200);
    expect(first.stopped).toBe(true);
    // The leak this fixes: the fade gains used to stay wired to the bus for the
    // lifetime of the context, two per track change, with a looping source that
    // never fires `onended` to hang cleanup on.
    expect(first.disconnectCount).toBeGreaterThan(0);
    // gains[0..2] are master/sfx/bgm; [3] is a's fade-out, [4] is b's fade-in.
    const [fadeOutA, fadeInB] = ctx.gains.slice(3);
    expect(fadeOutA.disconnectCount).toBeGreaterThan(0);
    // b is still playing, so its fade-in stays wired. Only retired nodes go.
    expect(fadeInB.disconnectCount).toBe(0);
    expect(second.stopped).toBe(false);
    audio.dispose();
  });

  it('retires the previous track fade-in as well as the fade-out', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.playBgm('/bgm/a.ogg', 1);
    await audio.playBgm('/bgm/b.ogg', 1);   // b gets a fade-in gain
    await audio.playBgm('/bgm/c.ogg', 1);   // b retires: fade-in must go too
    vi.advanceTimersByTime(1200);

    const ctx = latest();
    const [fadeOutA, fadeInB, fadeOutB, fadeInC] = ctx.gains.slice(3);
    expect(fadeOutA.disconnectCount).toBeGreaterThan(0);
    // The one that used to be stranded: b's fade-in outlived b itself, still
    // connected to the bus with nothing feeding it.
    expect(fadeInB.disconnectCount).toBeGreaterThan(0);
    expect(fadeOutB.disconnectCount).toBeGreaterThan(0);
    expect(fadeInC.disconnectCount).toBe(0);   // c is playing
    audio.dispose();
  });

  it('stops and unwires immediately when asked not to fade', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.playBgm('/bgm/a.ogg', 0);
    audio.stopBgm(0);

    const ctx = latest();
    expect(ctx.sources[0].stopped).toBe(true);
    expect(ctx.sources[0].disconnectCount).toBeGreaterThan(0);
    // No fade gain is created at all on this path.
    expect(ctx.gains.length).toBe(3);
    audio.dispose();
  });

  it('fades out on stopBgm, then stops and unwires', async () => {
    const audio = new AudioManager();
    audio.resume();
    await audio.playBgm('/bgm/a.ogg', 1);
    audio.stopBgm(0.5);

    const ctx = latest();
    expect(ctx.sources[0].stopped).toBe(false);
    vi.advanceTimersByTime(700);
    expect(ctx.sources[0].stopped).toBe(true);
    for (const gain of ctx.gains.slice(3)) {
      expect(gain.disconnectCount).toBeGreaterThan(0);
    }
    audio.dispose();
  });

  it('stopBgm is a no-op with nothing playing', async () => {
    const audio = new AudioManager();
    audio.resume();
    audio.stopBgm();
    expect(latest().gains.length).toBe(3);
    audio.dispose();
  });
});

describe('AudioManager — concurrent playBgm', () => {
  it('lets the newest request win, leaving no orphan source playing', async () => {
    const audio = new AudioManager();
    audio.resume();
    const fetches = deferredFetch();

    // Two scene switches in the same frame, each starting its own track.
    const first = audio.playBgm('/bgm/a.ogg', 0);
    const second = audio.playBgm('/bgm/b.ogg', 0);

    // The older decode finishes last — the order that used to break this.
    await fetches.settle('/bgm/b.ogg');
    await fetches.settle('/bgm/a.ogg');
    await Promise.all([first, second]);

    const ctx = latest();
    // Exactly one source: the loser must not start. It would keep looping with
    // nothing referencing it, so neither stopBgm() nor dispose() could stop it.
    expect(ctx.sources.length).toBe(1);
    expect(ctx.sources[0].started).toBe(true);

    // And the survivor is still stoppable.
    audio.stopBgm(0);
    expect(ctx.sources[0].stopped).toBe(true);
    audio.dispose();
  });

  it('abandons a decode that resolves after dispose', async () => {
    const audio = new AudioManager();
    audio.resume();
    const fetches = deferredFetch();
    const pending = audio.playBgm('/bgm/a.ogg', 0);

    audio.dispose();
    await fetches.settle('/bgm/a.ogg');
    await pending;

    // The context is gone; starting a source on it would throw or leak.
    expect(contexts[0].sources.length).toBe(0);
    expect(contexts[0].closed).toBe(true);
  });
});

describe('AudioManager.spatialVolume — defaults', () => {
  it('uses the refDistance and maxDistance the interface documents', () => {
    // 1 and 10, matching `playSfx({ spatial })`. They were 2 and 12 here, so the
    // same options object produced two different falloff curves depending on
    // which path played the sound.
    expect(AudioManager.spatialVolume({ x: 1, y: 0, listenerX: 0, listenerY: 0 })).toBe(1);
    expect(AudioManager.spatialVolume({ x: 10, y: 0, listenerX: 0, listenerY: 0 })).toBe(0);

    const half = AudioManager.spatialVolume({ x: 5.5, y: 0, listenerX: 0, listenerY: 0 });
    expect(half).toBeCloseTo(0.5, 6);
  });
});





