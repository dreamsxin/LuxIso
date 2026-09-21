/**
 * ArenaAudio — the run's events turned into sound, and nothing else.
 *
 * Split from `main.ts` for the usual reason in this demo: a policy that lives in
 * the page is a policy only a human at a keyboard can check. Everything that can
 * be wrong here is arithmetic — which cue answers which event, how many can play
 * at once, where the listener is standing — so it takes a sink interface rather
 * than an `AudioManager` and a test can hand it a recorder.
 *
 * Two rules exist because a wave makes them necessary:
 *
 *   • **A per-frame voice budget.** Four mobs dying in the same frame is normal
 *     and four identical death cues starting at the same sample is not a chord,
 *     it is a 4x amplitude spike.
 *   • **A per-cue minimum gap.** The hero's swing cadence is faster than the ear
 *     separates, so consecutive hits are dropped rather than stacked.
 *
 * BGM follows the phase, which is also the point: `playBgm` awaits a decode, so
 * a run that changes phase twice in quick succession puts two decodes in flight
 * at once — exactly the race `AudioManager._bgmRequest` exists to lose safely.
 */
import {renderCue, renderLoop} from './sfx';
import type {ArenaEvent, ArenaEventType} from './ArenaRun';
import type {ArpgPhase} from './WaveDirector';

/**
 * What `ArenaAudio` needs from an audio backend.
 *
 * `AudioManager` satisfies this structurally; declaring it here keeps the demo
 * honest about how little of that class this actually uses, and lets a test
 * assert on calls without a real `AudioContext` — jsdom has none.
 */
export interface ArenaAudioSink {
  playSfx(url: string, opts?: {
    volume?: number;
    spatial?: {x: number; y: number; z?: number; refDistance?: number; maxDistance?: number};
  }): unknown;
  updateListener(x: number, y: number, z?: number): void;
  playBgm(url: string, fadeDuration?: number): unknown;
  stopBgm(fadeDuration?: number): void;
}

/** How a cue is played, once the budget has allowed it. */
interface CuePlan {
  url: string;
  volume: number;
  /** Panned at the event's position. Phase fanfares are not. */
  spatial: boolean;
}

/**
 * One cue per event type, rendered once at module load.
 *
 * Roughly four seconds of audio in total, so the whole table costs a few
 * milliseconds and a few hundred kilobytes of base64 — cheaper than the four
 * round trips the equivalent .wav files would need.
 */
export const ARENA_CUES: Record<ArenaEventType, CuePlan> = {
  'hero-hit': {
    url: renderCue({duration: 0.14, wave: 'square', from: 320, to: 170, decay: 26, gain: 0.45}),
    volume: 0.7,
    spatial: true,
  },
  'hero-hurt': {
    url: renderCue({duration: 0.28, wave: 'saw', from: 160, to: 70, decay: 11, gain: 0.5}),
    volume: 0.9,
    spatial: true,
  },
  // Longer and lower than a basic hit: the cleave is one sound for a blow that
  // may have landed on four bodies, so it has to read as heavier rather than as
  // four of the same thing.
  cleave: {
    url: renderCue({duration: 0.36, wave: 'saw', from: 260, to: 90, decay: 9, gain: 0.5}),
    volume: 0.85,
    spatial: true,
  },
  dash: {
    url: renderCue({duration: 0.2, wave: 'noise', from: 1, decay: 18, gain: 0.32, seed: 19}),
    volume: 0.6,
    spatial: true,
  },
  kill: {
    url: renderCue({duration: 0.34, wave: 'noise', from: 1, decay: 13, gain: 0.4, seed: 7}),
    volume: 0.65,
    spatial: true,
  },
  // Rising, and not panned: a level belongs to the player, not to a spot on the
  // floor, so panning it would push a reward cue off to one ear.
  'level-up': {
    url: renderCue({duration: 0.7, wave: 'sine', from: 392, to: 784, decay: 4, gain: 0.42}),
    volume: 0.85,
    spatial: false,
  },
  'wave-start': {
    url: renderCue({duration: 0.5, wave: 'sine', from: 440, to: 660, decay: 5, gain: 0.4}),
    volume: 0.8,
    spatial: false,
  },
  boss: {
    url: renderCue({duration: 0.9, wave: 'saw', from: 110, to: 52, decay: 3, gain: 0.5}),
    volume: 0.9,
    spatial: false,
  },
  victory: {
    url: renderCue({duration: 0.9, wave: 'sine', from: 523, to: 784, decay: 3.5, gain: 0.4}),
    volume: 0.9,
    spatial: false,
  },
  defeat: {
    url: renderCue({duration: 1.0, wave: 'sine', from: 330, to: 110, decay: 3, gain: 0.4}),
    volume: 0.9,
    spatial: false,
  },
};

/**
 * Three beds: one for the lull, one for a wave, one for the boss.
 *
 * Kept to two seconds each. The loop point is audible if you listen for it; a
 * demo bed earns exactly this much effort.
 */
export const ARENA_TRACKS = {
  calm: renderLoop({
    beat: 0.5, bars: 4,
    notes: [
      {step: 0, duration: 1.2, from: 110, decay: 3, gain: 0.34},
      {step: 2, duration: 1.2, from: 147, decay: 3, gain: 0.3},
    ],
  }),
  wave: renderLoop({
    beat: 0.25, bars: 8,
    notes: [
      {step: 0, duration: 0.4, from: 82, wave: 'square', decay: 9, gain: 0.3},
      {step: 2, duration: 0.3, from: 165, decay: 11, gain: 0.22},
      {step: 4, duration: 0.4, from: 98, wave: 'square', decay: 9, gain: 0.3},
      {step: 6, duration: 0.3, from: 196, decay: 11, gain: 0.22},
    ],
  }),
  boss: renderLoop({
    beat: 0.25, bars: 8,
    notes: [
      {step: 0, duration: 0.5, from: 62, wave: 'saw', decay: 6, gain: 0.34},
      {step: 3, duration: 0.4, from: 93, wave: 'saw', decay: 8, gain: 0.26},
      {step: 4, duration: 0.5, from: 58, wave: 'saw', decay: 6, gain: 0.34},
      {step: 7, duration: 0.3, from: 117, wave: 'square', decay: 12, gain: 0.2},
    ],
  }),
};

/** Which bed a phase plays. `null` means silence, not "keep the last one". */
const PHASE_TRACK: Record<ArpgPhase, string | null> = {
  ready: ARENA_TRACKS.calm,
  intermission: ARENA_TRACKS.calm,
  wave: ARENA_TRACKS.wave,
  boss: ARENA_TRACKS.boss,
  victory: null,
  defeat: null,
};

/** Where an optional local sound pack declares itself. */
export const CUE_MANIFEST_URL = '/sfx/arpg-cues.json';
/** Bare filenames in the manifest resolve against this. */
export const CUE_BASE_URL = '/sfx/arpg/';

/** What `resolveCues` needs from the outside world. */
export interface CueOverrideSource {
  /** Parsed manifest, or null if there is none — a missing pack is not an error. */
  fetchJson(url: string): Promise<Record<string, unknown> | null>;
  /** Resolves if the file exists and decodes. `AudioManager.preload` fits. */
  preload(url: string): Promise<void>;
}

/**
 * Swap synthesized cues for real audio files, where a local pack provides them.
 *
 * The repo ships no sound pack — the synthesized cues are the product, not a
 * placeholder, because a clone has to be audible without anyone downloading
 * anything. But a synthesized square wave is a synthesized square wave, so the
 * demo reads `/sfx/arpg-cues.json` and substitutes any file it can actually
 * load. The committed manifest declares no cues, which is why the default path
 * costs zero requests instead of ten 404s.
 *
 * A cue whose file fails to load keeps its synthesized version. That is the
 * whole point of doing this per cue: a half-installed pack must not leave the
 * arena silent in the places it forgot.
 */
export async function resolveCues(
  source: CueOverrideSource,
  manifestUrl = CUE_MANIFEST_URL,
  base = CUE_BASE_URL
): Promise<Record<ArenaEventType, CuePlan>> {
  const manifest = await source.fetchJson(manifestUrl);
  if (!manifest) {return ARENA_CUES;}

  const resolved = {...ARENA_CUES};
  for (const type of Object.keys(ARENA_CUES) as ArenaEventType[]) {
    const entry = manifest[type];
    if (typeof entry !== 'string' || entry === '') {continue;}
    const url = /^([a-z]+:)?\//i.test(entry) ? entry : base + entry;
    try {
      await source.preload(url);
      resolved[type] = {...ARENA_CUES[type], url};
    } catch (err) {
      console.warn(`ArenaAudio: cue "${type}" falling back to the synthesized one`, err);
    }
  }
  return resolved;
}


export class ArenaAudio {
  /** Cues allowed to start in one frame. */
  static readonly VOICES_PER_FRAME = 4;
  /** Seconds a cue type must wait before it may play again. */
  static readonly CUE_INTERVAL = 0.06;
  /** Falloff, in world units, for the panned cues. */
  static readonly REF_DISTANCE = 1.5;
  static readonly MAX_DISTANCE = 12;

  private readonly _sink: ArenaAudioSink;
  private _cues: Record<ArenaEventType, CuePlan>;

  private _budget = ArenaAudio.VOICES_PER_FRAME;
  private _now = 0;
  private _lastPlayed = new Map<ArenaEventType, number>();
  private _track: string | null = null;
  private _muted = false;

  constructor(sink: ArenaAudioSink, cues: Record<ArenaEventType, CuePlan> = ARENA_CUES) {
    this._sink = sink;
    this._cues = cues;
  }

  get muted(): boolean { return this._muted; }

  /**
   * Replace the cue table, once `resolveCues` has decided what is available.
   *
   * Late rather than in the constructor because the answer needs the network:
   * the run has to be playable while the manifest is still in flight, so it
   * starts on the synthesized cues and swaps whatever arrives.
   */
  setCues(cues: Record<ArenaEventType, CuePlan>): void {
    this._cues = cues;
  }


  /** Seconds of gameplay this instance has seen, the clock the gaps use. */
  get elapsed(): number { return this._now; }


  /**
   * Open a new frame: refill the voice budget, advance the cue clock and move
   * the listener onto the hero.
   *
   * Call this before stepping the run, so the events the step produces are
   * spent against this frame's budget. `dt` is clamped the same way the rest of
   * the engine clamps it — a tab that was hidden for a minute must not retire
   * every cue's cooldown at once, or the first frame back plays everything.
   */
  beginFrame(dt: number, listenerX: number, listenerY: number): void {
    this._budget = ArenaAudio.VOICES_PER_FRAME;
    if (Number.isFinite(dt) && dt > 0) {this._now += Math.min(dt, 0.1);}
    this._sink.updateListener(listenerX, listenerY);
  }

  /**
   * Play the cue for one event, if the budget and the gap allow it.
   *
   * @returns whether a sound was started — the demo ignores it, tests do not.
   */
  handle(event: ArenaEvent): boolean {
    if (this._muted) {return false;}
    const cue = this._cues[event.type];
    if (!cue) {return false;}
    if (this._budget <= 0) {return false;}

    const last = this._lastPlayed.get(event.type);
    if (last !== undefined && this._now - last < ArenaAudio.CUE_INTERVAL) {return false;}

    this._budget--;
    this._lastPlayed.set(event.type, this._now);
    this._sink.playSfx(cue.url, {
      volume: cue.volume,
      spatial: cue.spatial
        ? {
            x: event.x,
            y: event.y,
            refDistance: ArenaAudio.REF_DISTANCE,
            maxDistance: ArenaAudio.MAX_DISTANCE,
          }
        : undefined,
    });
    return true;
  }

  /**
   * Follow the run into a new phase.
   *
   * Re-entering the same track is dropped here rather than in `AudioManager`:
   * that class also short-circuits a repeat, but only after `playBgm` has
   * already been called and a promise created, and `wave → intermission → wave`
   * happens often enough to be worth not asking.
   */
  setPhase(phase: ArpgPhase): void {
    const next = PHASE_TRACK[phase] ?? null;
    if (next === this._track) {return;}
    this._track = next;
    if (!next) {
      this._sink.stopBgm(0.6);
      return;
    }
    void this._sink.playBgm(next, 1.2);
  }

  /**
   * Silence, or restore, everything this instance drives.
   *
   * Muting stops the bed and refuses new cues, but leaves `_track` alone, so
   * unmuting resumes the phase that is still running rather than waiting for the
   * next phase change to make a sound again.
   */
  setMuted(muted: boolean): void {
    if (muted === this._muted) {return;}
    this._muted = muted;
    if (muted) {
      this._sink.stopBgm(0.3);
      return;
    }
    if (this._track) {void this._sink.playBgm(this._track, 0.6);}
  }
}



