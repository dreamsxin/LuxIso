import { describe, it, expect } from 'vitest';
import { renderCue, renderLoop, SFX_RATE, BGM_RATE } from '../../examples/10-arpg/sfx';

/**
 * The ARPG demo's sound generator.
 *
 * Nothing here is about how it sounds — that is not testable and not the risk.
 * The risk is the container: a RIFF header off by one field decodes as silence,
 * or fails to decode at all, and the only symptom in a browser is that no sound
 * plays. `decodeAudioData` is strict about this and jsdom has no way to run it,
 * so the header is checked by hand instead.
 *
 * Determinism is the second reason this file exists. Noise comes from a seeded
 * LCG so that a spec maps to exactly one result; a `Math.random` version would
 * pass every assertion below except the identity one, which is what makes that
 * one worth having.
 */

/** Decode a `data:audio/wav;base64,` URL back into bytes. */
function bytesOf(url: string): Uint8Array {
  const marker = 'data:audio/wav;base64,';
  expect(url.startsWith(marker)).toBe(true);
  const binary = atob(url.slice(marker.length));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The i-th 16-bit sample. */
function sample(bytes: Uint8Array, index: number): number {
  return view(bytes).getInt16(44 + index * 2, true);
}

function samples(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < (bytes.length - 44) / 2; i++) out.push(sample(bytes, i));
  return out;
}

describe('ARPG sfx — the WAV container', () => {
  it('writes a header a decoder will accept', () => {
    const bytes = bytesOf(renderCue({ duration: 0.05, from: 440 }));
    const dv = view(bytes);
    const count = Math.round(0.05 * SFX_RATE);

    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(dv.getUint32(4, true)).toBe(bytes.length - 8);
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(dv.getUint32(16, true)).toBe(16);
    expect(dv.getUint16(20, true)).toBe(1);            // PCM
    expect(dv.getUint16(22, true)).toBe(1);            // mono
    expect(dv.getUint32(24, true)).toBe(SFX_RATE);
    expect(dv.getUint32(28, true)).toBe(SFX_RATE * 2); // byte rate
    expect(dv.getUint16(32, true)).toBe(2);            // block align
    expect(dv.getUint16(34, true)).toBe(16);           // bit depth
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(dv.getUint32(40, true)).toBe(count * 2);
    expect(bytes.length).toBe(44 + count * 2);
  });

  it('renders loops at the music rate, one beat per step', () => {
    const bytes = bytesOf(renderLoop({ beat: 0.1, bars: 4, notes: [] }));
    expect(view(bytes).getUint32(24, true)).toBe(BGM_RATE);
    expect((bytes.length - 44) / 2).toBe(Math.round(0.4 * BGM_RATE));
  });

  it('leaves the steps before a note silent', () => {
    const beat = 0.1;
    const bytes = bytesOf(renderLoop({
      beat, bars: 4,
      notes: [{ step: 2, duration: 0.1, from: 220, gain: 0.8, decay: 4 }],
    }));
    const offset = Math.round(2 * beat * BGM_RATE);
    const all = samples(bytes);

    expect(all.slice(0, offset).every((value) => value === 0)).toBe(true);
    expect(all.slice(offset).some((value) => value !== 0)).toBe(true);
  });
});

describe('ARPG sfx — the waveform', () => {
  it('starts from silence and decays', () => {
    const all = samples(bytesOf(renderCue({ duration: 0.2, from: 300, decay: 12, gain: 0.9 })));
    const window = Math.floor(all.length * 0.1);
    const peak = (values: number[]): number => Math.max(...values.map(Math.abs));

    // The 4 ms attack ramp: without it every cue opens on a click.
    expect(all[0]).toBe(0);
    expect(peak(all.slice(0, window))).toBeGreaterThan(peak(all.slice(-window)) * 4);
  });

  it('actually sweeps, and in the right direction', () => {
    // The obvious assertion here would be "no big jump between samples", and it
    // is the wrong one: the naive `sin(2π·f(t)·t)` form is continuous too. What
    // it gets wrong is the rate, so what is worth pinning is the pitch — counted
    // as zero crossings, which rise with frequency and nothing else.
    const all = samples(bytesOf(renderCue({ duration: 0.2, from: 200, to: 1200, decay: 0, gain: 0.8 })));
    const quarter = Math.floor(all.length / 4);
    const crossings = (values: number[]): number => {
      let count = 0;
      for (let i = 1; i < values.length; i++) {
        if ((values[i - 1] < 0) !== (values[i] < 0)) count++;
      }
      return count;
    };

    const opening = crossings(all.slice(0, quarter));
    const closing = crossings(all.slice(-quarter));
    expect(closing).toBeGreaterThan(opening * 2);
  });


  it('renders the same spec to the same bytes, noise included', () => {
    const spec = { duration: 0.1, from: 1, wave: 'noise' as const, seed: 11 };
    expect(renderCue(spec)).toBe(renderCue(spec));
    expect(renderCue({ ...spec, seed: 12 })).not.toBe(renderCue(spec));
  });

  it('saturates a summed loop instead of wrapping it', () => {
    // Two notes in phase at 0.8 each reach 1.6, and Int16 has no room for that.
    // Written unclamped it wraps to a large negative — silence would be a mercy;
    // it is a burst of static exactly at the loudest moment.
    const note = { step: 0, duration: 0.05, from: 30, decay: 0, gain: 0.8 };
    const bytes = bytesOf(renderLoop({ beat: 0.05, bars: 1, notes: [note, { ...note }] }));
    // A 30 Hz sine peaks a quarter period in, past the 4 ms attack ramp.
    const peakIndex = Math.round(BGM_RATE / 120);

    expect(sample(bytes, peakIndex)).toBe(32767);
    expect(Math.min(...samples(bytes))).toBeGreaterThanOrEqual(-32768);
  });
});


