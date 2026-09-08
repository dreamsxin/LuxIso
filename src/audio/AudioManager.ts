/**
 * AudioManager — Web Audio API wrapper for LuxIso with spatial support.
 */
export interface SpatialOptions {
  /** World X of the sound source */
  x: number;
  /** World Y of the sound source */
  y: number;
  /** World Z (height) of the sound source. Default 0. */
  z?: number;
  /** World X of the listener (deprecated, used by spatialVolume) */
  listenerX?: number;
  /** World Y of the listener (deprecated, used by spatialVolume) */
  listenerY?: number;
  /**
   * World-unit distance at which volume starts falling off.
   * Default: 1 world unit.
   */
  refDistance?: number;
  /**
   * World-unit distance at which volume reaches 0 (linear) or 
   * becomes very quiet (exponential). Default: 10 world units.
   */
  maxDistance?: number;
  /**
   * Rolloff factor for the distance model. Default: 1.
   */
  rolloffFactor?: number;
}

export interface PlayOptions {
  /** Volume multiplier 0–1 (applied on top of the sfx bus). Default 1. */
  volume?: number;
  /** Playback rate (1 = normal speed). Default 1. */
  rate?: number;
  /** If true, loop the sound. Default false. */
  loop?: boolean;
  /** Spatial options. Omit for non-spatial (UI sounds etc.). */
  spatial?: SpatialOptions;
}

export class AudioManager {
  private _ctx: AudioContext | null = null;
  private _bufferCache = new Map<string, AudioBuffer>();
  private _pending = new Map<string, Promise<AudioBuffer>>();

  private _masterGain!: GainNode;
  private _sfxGain!: GainNode;
  private _bgmGain!: GainNode;

  private _bgmSource: AudioBufferSourceNode | null = null;
  private _bgmUrl = '';

  private _masterVol = 1;
  private _sfxVol    = 1;
  private _bgmVol    = 0.6;

  resume(): void {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') this._ctx.resume();
      return;
    }
    this._ctx = new AudioContext();
    this._masterGain = this._ctx.createGain();
    this._sfxGain    = this._ctx.createGain();
    this._bgmGain    = this._ctx.createGain();

    this._sfxGain.connect(this._masterGain);
    this._bgmGain.connect(this._masterGain);
    this._masterGain.connect(this._ctx.destination);

    this._masterGain.gain.value = this._masterVol;
    this._sfxGain.gain.value    = this._sfxVol;
    this._bgmGain.gain.value    = this._bgmVol;

    const l = this._ctx.listener;
    if (l.forwardX) {
      l.forwardX.value = 0; l.forwardY.value = -1; l.forwardZ.value = -1;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      (l as any).setOrientation(0, -1, -1, 0, 1, 0);
    }
  }

  suspend(): void { this._ctx?.suspend(); }

  updateListener(x: number, y: number, z = 0): void {
    if (!this._ctx) return;
    const l = this._ctx.listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, this._ctx.currentTime, 0.03);
      l.positionY.setTargetAtTime(z, this._ctx.currentTime, 0.03);
      l.positionZ.setTargetAtTime(y, this._ctx.currentTime, 0.03);
    } else {
      (l as any).setPosition(x, z, y);
    }
  }

  get masterVolume(): number { return this._masterVol; }
  set masterVolume(v: number) {
    this._masterVol = clamp01(v);
    if (this._masterGain) this._masterGain.gain.value = this._masterVol;
  }

  get sfxVolume(): number { return this._sfxVol; }
  set sfxVolume(v: number) {
    this._sfxVol = clamp01(v);
    if (this._sfxGain) this._sfxGain.gain.value = this._sfxVol;
  }

  get bgmVolume(): number { return this._bgmVol; }
  set bgmVolume(v: number) {
    this._bgmVol = clamp01(v);
    if (this._bgmGain) this._bgmGain.gain.value = this._bgmVol;
  }

  async preload(url: string): Promise<void> { await this._loadBuffer(url); }
  async preloadAll(urls: string[]): Promise<void> { await Promise.all(urls.map(u => this.preload(u))); }

  playSfx(url: string, opts: PlayOptions = {}): AudioBufferSourceNode | null {
    const ctx = this._ctx;
    if (!ctx) return null;
    const buffer = this._bufferCache.get(url);
    if (!buffer) {
      // Fire-and-forget: report the failure instead of raising an unhandled
      // rejection on a missing or unreachable sound file.
      this._loadBuffer(url)
        .then(buf => this._playBuffer(buf, this._sfxGain, opts))
        .catch(err => console.warn(`AudioManager: playSfx("${url}") failed`, err));
      return null;
    }
    return this._playBuffer(buffer, this._sfxGain, opts);
  }

  async playBgm(url: string, fadeDuration = 1.0): Promise<void> {
    if (!this._ctx) return;
    if (url === this._bgmUrl && this._bgmSource) return;
    const buffer = await this._loadBuffer(url);
    const ctx = this._ctx;
    if (!ctx) return;
    if (this._bgmSource) {
      const old = this._bgmSource;
      const fadeGain = ctx.createGain();
      fadeGain.gain.setValueAtTime(1, ctx.currentTime);
      fadeGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeDuration);
      old.disconnect();
      old.connect(fadeGain);
      fadeGain.connect(this._bgmGain);
      setTimeout(() => { try { old.stop(); } catch {} }, fadeDuration * 1000 + 100);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    if (fadeDuration > 0 && this._bgmSource) {
      const fadeIn = ctx.createGain();
      fadeIn.gain.setValueAtTime(0, ctx.currentTime);
      fadeIn.gain.linearRampToValueAtTime(1, ctx.currentTime + fadeDuration);
      src.connect(fadeIn);
      fadeIn.connect(this._bgmGain);
    } else {
      src.connect(this._bgmGain);
    }
    src.start();
    this._bgmSource = src; this._bgmUrl = url;
  }

  stopBgm(fadeDuration = 0.5): void {
    const ctx = this._ctx;
    if (!ctx || !this._bgmSource) return;
    const src = this._bgmSource; this._bgmSource = null; this._bgmUrl = '';
    if (fadeDuration > 0) {
      const fadeGain = ctx.createGain();
      fadeGain.gain.setValueAtTime(1, ctx.currentTime);
      fadeGain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeDuration);
      src.disconnect(); src.connect(fadeGain);
      fadeGain.connect(this._bgmGain);
      setTimeout(() => { try { src.stop(); } catch {} }, fadeDuration * 1000 + 100);
    } else {
      try { src.stop(); } catch {}
    }
  }

  /** Backwards compatibility for manual spatial calculations. */
  static spatialVolume(opts: SpatialOptions): number {
    const dx = opts.x - (opts.listenerX ?? 0);
    const dy = opts.y - (opts.listenerY ?? 0);
    const dist = Math.hypot(dx, dy);
    const ref = opts.refDistance ?? 2;
    const max = opts.maxDistance ?? 12;
    if (dist <= ref) return 1;
    if (dist >= max) return 0;
    return 1 - (dist - ref) / (max - ref);
  }

  private async _loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = this._bufferCache.get(url);
    if (cached) return cached;
    const inFlight = this._pending.get(url);
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        if (!this._ctx) await waitForContext(() => this._ctx);
        const ctx = this._ctx!;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`AudioManager: failed to fetch "${url}" (${res.status})`);
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this._bufferCache.set(url, audioBuffer);
        return audioBuffer;
      } finally {
        // Must run on failure too. Leaving a rejected promise in _pending would
        // make every later preload/playSfx for this URL return that same
        // rejection, so a transient network error could never be retried.
        this._pending.delete(url);
      }
    })();
    this._pending.set(url, promise);
    return promise;
  }

  private _playBuffer(buffer: AudioBuffer, bus: GainNode, opts: PlayOptions): AudioBufferSourceNode {
    const ctx = this._ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = opts.loop ?? false; src.playbackRate.value = opts.rate ?? 1;
    let chain: AudioNode = src;
    if (opts.spatial) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = opts.spatial.refDistance ?? 1;
      p.maxDistance = opts.spatial.maxDistance ?? 10;
      p.rolloffFactor = opts.spatial.rolloffFactor ?? 1;
      p.positionX.value = opts.spatial.x; p.positionY.value = opts.spatial.z ?? 0; p.positionZ.value = opts.spatial.y;
      chain.connect(p); chain = p;
    }
    if (opts.volume !== undefined && opts.volume !== 1) {
      const vol = ctx.createGain(); vol.gain.value = clamp01(opts.volume);
      chain.connect(vol); chain = vol;
    }
    chain.connect(bus);
    src.start();
    return src;
  }
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function waitForContext(getter: () => AudioContext | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (getter()) { resolve(); return; }
      if (Date.now() - start > 5000) { reject(new Error('AudioManager: context never initialised')); return; }
      setTimeout(check, 50);
    };
    check();
  });
}
