/**
 * sfx.ts — the arena's sounds, synthesized instead of shipped.
 *
 * The demo needs audio to exercise `AudioManager` at all, and no example did:
 * every fix that module has taken was covered by unit tests and by nothing a
 * player could hear. Committing .wav files would have been the obvious route,
 * but binary assets in a source repo age badly and the licence question is real,
 * so the cues are rendered into `data:audio/wav` URLs at startup. `fetch`
 * accepts those, which means `AudioManager` needs no new code path for them.
 *
 * Everything here is deterministic: noise comes from a seeded LCG, not
 * `Math.random`, so the same spec always renders byte-identical audio and a test
 * can assert on the encoded result.
 */

/** One-shots. Low enough to keep the encoded URL small, high enough for a click. */
export const SFX_RATE = 22050;
/** Music beds carry nothing worth 22 kHz. */
export const BGM_RATE = 11025;

export type Waveform = 'sine' | 'square' | 'saw' | 'noise';

/** A single decaying voice. `from`/`to` sweep linearly across the duration. */
export interface CueSpec {
  /** Seconds. */
  duration: number;
  /** Start frequency in Hz. Ignored for `noise`. */
  from: number;
  /** End frequency, for a sweep. Defaults to `from`. */
  to?: number;
  wave?: Waveform;
  /** Exponential decay constant in 1/s. Higher is snappier. */
  decay?: number;
  /** Peak amplitude before the envelope, 0–1. */
  gain?: number;
  rate?: number;
  /** Noise seed. Fixed so a render is reproducible. */
  seed?: number;
}

/** A looping bed: `notes` placed on a `beat` grid, `bars * beat` long in total. */
export interface LoopSpec {
  /** Seconds per step. */
  beat: number;
  /** Steps in the loop. */
  bars: number;
  rate?: number;
  notes: Array<CueSpec & { step: number }>;
}

/** Render one decaying voice as a `data:audio/wav` URL. */
export function renderCue(spec: CueSpec): string {
  const rate = spec.rate ?? SFX_RATE;
  const out = new Float32Array(samples(spec.duration, rate));
  mixVoice(out, rate, 0, spec);
  return encodeWav(out, rate);
}

/**
 * Render a looping bed.
 *
 * Notes are mixed additively, so a tail that outlives its step bleeds into the
 * next one; a tail that outlives the whole loop is simply cut, which is why the
 * beds below decay well inside their own length. A crossfaded loop point would
 * be the next thing to add, and is more than a demo bed needs.
 */
export function renderLoop(spec: LoopSpec): string {
  const rate = spec.rate ?? BGM_RATE;
  const out = new Float32Array(samples(spec.beat * spec.bars, rate));
  for (const note of spec.notes) {
    mixVoice(out, rate, samples(note.step * spec.beat, rate), note);
  }
  return encodeWav(out, rate);
}

function samples(seconds: number, rate: number): number {
  return Math.max(1, Math.round(Math.max(0, seconds) * rate));
}

/**
 * Linear congruential noise.
 *
 * `Math.random` would make every render different, which costs nothing audibly
 * and costs a test the ability to assert that a spec maps to one result.
 */
function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shape(wave: Waveform, phase: number, rng: () => number): number {
  switch (wave) {
    case 'square': return Math.sin(phase) >= 0 ? 1 : -1;
    case 'saw': return (((phase / (Math.PI * 2)) % 1) + 1) % 1 * 2 - 1;
    case 'noise': return rng() * 2 - 1;
    default: return Math.sin(phase);
  }
}

/**
 * Add one voice into `out` at `offset`.
 *
 * Phase is accumulated rather than computed as `sin(2π · f(t) · t)`. That second
 * form is continuous, so it does not click — it sweeps at the wrong rate. Its
 * instantaneous frequency is `f + t · df/dt`, which for a linear ramp is double
 * the intended slope, so a cue written that way ends an octave-ish above where
 * its `to` says it should.
 */

function mixVoice(out: Float32Array, rate: number, offset: number, spec: CueSpec): void {
  const wave = spec.wave ?? 'sine';
  const decay = spec.decay ?? 9;
  const gain = spec.gain ?? 0.6;
  const from = spec.from;
  const to = spec.to ?? from;
  const rng = lcg(spec.seed ?? 0x9e3779b9);
  const total = samples(spec.duration, rate);
  let phase = 0;

  for (let i = 0; i < total; i++) {
    const index = offset + i;
    if (index >= out.length) break;
    const t = i / rate;
    const freq = from + (to - from) * (i / total);
    phase += (Math.PI * 2 * freq) / rate;
    // 4 ms attack: starting at full amplitude is itself a click.
    const attack = Math.min(1, t / 0.004);
    out[index] += shape(wave, phase, rng) * gain * attack * Math.exp(-decay * t);
  }
}

/** 16-bit mono PCM in a RIFF container, base64'd into a data URL. */
function encodeWav(pcm: Float32Array, rate: number): string {
  const bytes = 44 + pcm.length * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  ascii(view, 0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);   // PCM chunk size
  view.setUint16(20, 1, true);    // format: PCM
  view.setUint16(22, 1, true);    // channels
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate: rate * channels * 2
  view.setUint16(32, 2, true);    // block align
  view.setUint16(34, 16, true);   // bits per sample
  ascii(view, 36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  for (let i = 0; i < pcm.length; i++) {
    // Clamp before scaling: a summed loop can exceed 1, and letting it wrap
    // around Int16 turns an overload into a burst of static.

    const clamped = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return `data:audio/wav;base64,${base64(new Uint8Array(view.buffer))}`;
}

function ascii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * `btoa` over a binary string, built in chunks.
 *
 * `String.fromCharCode(...bytes)` on a whole second of audio overflows the
 * argument limit, so it is spread a chunk at a time.
 */
function base64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}



