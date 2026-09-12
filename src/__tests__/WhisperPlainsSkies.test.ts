import { describe, it, expect } from 'vitest';
import { createCtxRecorder } from './helpers/canvas';
import { DayNightCycle } from '../../examples/05-whisper-plains/environment/DayNightCycle';
import {
  drawStarField, drawPlainsSky, drawLakeSky, drawDeepSky,
} from '../../examples/05-whisper-plains/environment/skies';

/**
 * example-05's sky painting, testable for the first time.
 *
 * These three functions lived inline in the example's `main.ts`, so reaching them
 * meant booting an engine, an input manager and a scene manager. Pulled into
 * `environment/skies.ts` they take a context and a size, which a recording
 * context can supply.
 *
 * What is worth pinning is not the artwork but the invariants a backdrop has to
 * respect: it covers the canvas, it leaves `globalAlpha` where it found it, every
 * alpha it writes is a legal one, and day and night actually differ.
 */

const W = 800, H = 600;

/** Alphas written during a draw, excluding the trailing reset. */
function alphas(values: unknown[]): number[] {
  return values.map(Number).filter((n) => Number.isFinite(n));
}

/** Last written value, or undefined. `Array.at` is outside this project's lib. */
function last(values: unknown[]): unknown {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

describe('drawStarField', () => {
  it('draws one arc per star and restores globalAlpha', () => {
    const r = createCtxRecorder();
    drawStarField(r.ctx, W, H, 1000, 1, () => '#ffffff');

    expect(r.argsOf('arc').length).toBe(60);
    expect(r.argsOf('fill').length).toBe(60);
    expect(last(r.valuesOf('globalAlpha'))).toBe(1);
  });

  it('keeps every star inside the canvas, in the upper half', () => {
    const r = createCtxRecorder();
    drawStarField(r.ctx, W, H, 1000, 1, () => '#ffffff');

    for (const [x, y, radius] of r.argsOf('arc')) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      // 0.52 * H is the horizon the field is confined to.
      expect(y).toBeLessThanOrEqual(H * 0.52);
      expect(radius).toBeGreaterThan(0);
    }
  });

  it('never writes an alpha outside [0, 1]', () => {
    const r = createCtxRecorder();
    // Sweep timestamps: the twinkle is a sine, so this covers both extremes.
    for (let ts = 0; ts < 4000; ts += 137) drawStarField(r.ctx, W, H, ts, 1, () => '#fff');

    for (const a of alphas(r.valuesOf('globalAlpha'))) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('scales with the alpha it is given', () => {
    const dim = createCtxRecorder();
    drawStarField(dim.ctx, W, H, 1000, 0, () => '#fff');
    // Every star invisible, but still drawn 鈥?the field does not special-case 0.
    expect(dim.argsOf('arc').length).toBe(60);
    expect(alphas(dim.valuesOf('globalAlpha')).filter((a) => a > 0)).toEqual([1]);
  });

  it('is stable across frames at a fixed timestamp', () => {
    const a = createCtxRecorder();
    const b = createCtxRecorder();
    drawStarField(a.ctx, W, H, 2500, 1, () => '#fff');
    drawStarField(b.ctx, W, H, 2500, 1, () => '#fff');
    // Positions come from sin(i * k), not Math.random(), so two draws match.
    expect(a.argsOf('arc')).toEqual(b.argsOf('arc'));
  });
});

/** A cycle parked at a phase. 0 is noon, 0.5 is midnight in this cycle. */
function cycleAt(phase: number): DayNightCycle {
  const dn = new DayNightCycle(60);
  dn.setPhase(phase);
  return dn;
}

/** The phase where `getColors()` reports stars, found by sweeping. */
function nightPhase(): number {
  for (let p = 0; p < 1; p += 0.01) {
    if (cycleAt(p).getColors().showStars) return p;
  }
  throw new Error('no night phase found');
}

function dayPhase(): number {
  for (let p = 0; p < 1; p += 0.01) {
    const c = cycleAt(p).getColors();
    if (!c.showStars && c.nightOverlay < 0.02) return p;
  }
  throw new Error('no day phase found');
}

/** Deep night: `nightOverlay >= 0.85`, past the point where motes stop. */
function deepNightPhase(): number {
  for (let p = 0; p < 1; p += 0.005) {
    if (cycleAt(p).getColors().nightOverlay >= 0.85) return p;
  }
  throw new Error('no deep night phase found');
}

describe('drawPlainsSky', () => {
  it('covers the whole canvas before painting anything on it', () => {
    const r = createCtxRecorder();
    drawPlainsSky(r.ctx, W, H, 1000, cycleAt(dayPhase()));

    const first = r.argsOf('fillRect')[0];
    expect(first).toEqual([0, 0, W, H]);
  });

  it('draws the sun or moon with a glow, inside the canvas', () => {
    const r = createCtxRecorder();
    drawPlainsSky(r.ctx, W, H, 1000, cycleAt(dayPhase()));

    // The celestial disc is the first arc; the star field, if any, comes later.
    const [cx, cy, radius] = r.argsOf('arc')[0];
    expect(cx).toBeGreaterThanOrEqual(0);
    expect(cx).toBeLessThanOrEqual(W);
    expect(cy).toBeGreaterThanOrEqual(0);
    expect(cy).toBeLessThanOrEqual(H);
    expect(radius).toBeGreaterThan(0);
    // A shadow is used for the bloom, and must be turned back off.
    expect(last(r.valuesOf('shadowBlur'))).toBe(0);
  });

  it('crossfades motes into stars rather than switching between them', () => {
    // Noon: the celestial disc plus drifting motes, no stars.
    const day = createCtxRecorder();
    drawPlainsSky(day.ctx, W, H, 1000, cycleAt(dayPhase()));
    expect(day.argsOf('arc').length).toBe(1 + 18);

    // Deep night: the disc plus a full star field, and the motes have stopped.
    const night = createCtxRecorder();
    drawPlainsSky(night.ctx, W, H, 1000, cycleAt(deepNightPhase()));
    expect(night.argsOf('arc').length).toBe(1 + 60);

    // Dusk draws both 鈥?stars fade in from 10% nightness while motes fade out
    // until 85%, which is the crossfade, not a bug. Pinned because the obvious
    // assertion ("never both") is the wrong one and would invite a "fix".
    const dusk = createCtxRecorder();
    drawPlainsSky(dusk.ctx, W, H, 1000, cycleAt(nightPhase()));
    expect(dusk.argsOf('arc').length).toBe(1 + 18 + 60);
  });

  it('leaves globalAlpha at 1 and every written alpha legal', () => {
    for (const phase of [dayPhase(), nightPhase(), 0.25, 0.75]) {
      const r = createCtxRecorder();
      for (let ts = 0; ts < 3000; ts += 311) {
        drawPlainsSky(r.ctx, W, H, ts, cycleAt(phase));
      }
      expect(last(r.valuesOf('globalAlpha'))).toBe(1);
      for (const a of alphas(r.valuesOf('globalAlpha'))) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it('writes a parseable rgba for the celestial glow', () => {
    // The local hex parser this used to carry produced `rgba(NaN,NaN,NaN,鈥?` for
    // anything that was not `#rrggbb`; `hexToRgba` is the framework's one.
    const r = createCtxRecorder();
    drawPlainsSky(r.ctx, W, H, 1000, cycleAt(dayPhase()));

    const colors = r.valuesOf('fillStyle').filter((v) => typeof v === 'string') as string[];
    for (const color of colors) {
      expect(color).not.toContain('NaN');
    }
  });
});

describe('drawLakeSky', () => {
  it('covers the canvas, hangs one moon, and draws a full star field', () => {
    const r = createCtxRecorder();
    drawLakeSky(r.ctx, W, H, 1000);

    expect(r.argsOf('fillRect')[0]).toEqual([0, 0, W, H]);
    // The moon, then 60 stars.
    expect(r.argsOf('arc').length).toBe(1 + 60);
    const [mx, my, radius] = r.argsOf('arc')[0];
    expect(mx).toBeCloseTo(W * 0.76, 6);
    expect(my).toBeCloseTo(H * 0.09, 6);
    expect(radius).toBe(14);
    expect(last(r.valuesOf('shadowBlur'))).toBe(0);
  });

  it('restores globalAlpha and keeps every alpha legal', () => {
    const r = createCtxRecorder();
    for (let ts = 0; ts < 3000; ts += 271) drawLakeSky(r.ctx, W, H, ts);

    expect(last(r.valuesOf('globalAlpha'))).toBe(1);
    for (const a of alphas(r.valuesOf('globalAlpha'))) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});

describe('drawDeepSky', () => {
  it('paints a gradient and a glow, and nothing that twinkles', () => {
    const r = createCtxRecorder();
    drawDeepSky(r.ctx, W, H, 1000);

    expect(r.argsOf('fillRect')).toEqual([[0, 0, W, H], [0, 0, W, H]]);
    // No stars under water.
    expect(r.argsOf('arc').length).toBe(0);
    expect(r.valuesOf('globalAlpha')).toEqual([]);
  });

  it('keeps the breathing glow within a legal alpha at every phase', () => {
    // The glow alpha is `0.06 + sin(t) * 0.02`, so it must never go negative or
    // above 1 however long the scene has been open.
    const r = createCtxRecorder();
    for (let ts = 0; ts < 40_000; ts += 997) drawDeepSky(r.ctx, W, H, ts);

    const stops = r.valuesOf('fillStyle').filter((v) => typeof v === 'string') as string[];
    for (const stop of stops) expect(stop).not.toContain('NaN');
  });

  it('is stable at a fixed timestamp', () => {
    const a = createCtxRecorder();
    const b = createCtxRecorder();
    drawDeepSky(a.ctx, W, H, 7777);
    drawDeepSky(b.ctx, W, H, 7777);
    expect(a.calls).toEqual(b.calls);
    // Only the string writes: a gradient handle is a fresh object per call, so
    // comparing the raw `sets` would compare object identity, not the painting.
    const strings = (r: typeof a): unknown[] =>
      r.sets.filter((s) => typeof s.value === 'string');
    expect(strings(a)).toEqual(strings(b));
  });
});


