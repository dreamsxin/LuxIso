import { describe, it, expect } from 'vitest';
import { createDrawContext } from './helpers/canvas';
import { Boulder } from '../elements/props/Boulder';
import { HealthComponent } from '../ecs/components/HealthComponent';
import { OmniLight } from '../lighting/OmniLight';
import { project } from '../math/IsoProjection';

/**
 * `Boulder`'s draw path — at 11% statements the least-covered file in the repo,
 * and now load-bearing in two places: the ARPG arena's pillars and the WebGL
 * fixture's `mossy-boulder`.
 *
 * The interesting result is at the bottom: the AABB claims a height of `2 *
 * radius` and the rock is drawn about `0.55 * radius` tall. That is pinned as a
 * measurement rather than fixed, because `maxZ` feeds depth sorting and shadow
 * projection, and `mossy-boulder` sits in a pixel-gated fixture.
 */

const R = 20;

function ctxFor(boulder: Boulder, lights: OmniLight[] = []) {
  const dc = createDrawContext({ omniLights: lights, originX: 200, originY: 150 });
  boulder.draw(dc);
  return dc.recorder;
}

/** Every y coordinate the body outline touches. */
function outlineYs(recorder: ReturnType<typeof ctxFor>): number[] {
  const ys: number[] = [];
  for (const call of recorder.calls) {
    if (call.fn !== 'moveTo' && call.fn !== 'lineTo') continue;
    ys.push(call.args[1]);
  }
  return ys;
}

describe('Boulder — construction', () => {
  it('exposes colour and radius for the extractor, and casts a round shadow', () => {
    const boulder = new Boulder('rock', 3, 4, '#123456', R);
    expect(boulder.propColor).toBe('#123456');
    expect(boulder.propRadius).toBe(R);
    expect(boulder.castsShadow).toBe(true);
    expect(boulder.shadowRadius).toBeCloseTo(0.38, 6);
  });

  it('defaults to a grey rock of radius 18', () => {
    const boulder = new Boulder('rock', 0, 0);
    expect(boulder.propColor).toBe('#7a7a8a');
    expect(boulder.propRadius).toBe(18);
  });
});

describe('Boulder — draw', () => {
  it('centres the rock on its projected position plus the origin', () => {
    const boulder = new Boulder('rock', 3, 4, '#7a7a8a', R);
    const recorder = ctxFor(boulder);
    const { sx, sy } = project(3, 4, 0, 64, 32);

    // The bright top facet starts at (cx - 0.15r, cy - 0.42r); the outline as a
    // whole must sit around the projected centre.
    const xs = recorder.calls
      .filter((c) => c.fn === 'moveTo' || c.fn === 'lineTo')
      .map((c) => c.args[0]);
    const cx = 200 + sx;
    expect(Math.min(...xs)).toBeGreaterThan(cx - R * 1.1);
    expect(Math.max(...xs)).toBeLessThan(cx + R * 1.1);

    const ys = outlineYs(recorder);
    const cy = 150 + sy;
    expect(Math.min(...ys)).toBeGreaterThan(cy - R);
    expect(Math.max(...ys)).toBeLessThan(cy + R);
  });

  it('draws the three faces and the two cracks', () => {
    const boulder = new Boulder('rock', 1, 1, '#7a7a8a', R);
    const recorder = ctxFor(boulder);

    // Bottom half, top-left face, bright facet.
    expect(recorder.argsOf('fill').length).toBe(3);
    // Two crack lines.
    expect(recorder.argsOf('stroke').length).toBe(2);
    expect(recorder.valuesOf('lineWidth')).toEqual([0.75]);
  });

  it('brightens with an omni light overhead and never exceeds full', () => {
    const dark = ctxFor(new Boulder('rock', 1, 1, '#808080', R));
    const lit = ctxFor(new Boulder('rock', 1, 1, '#808080', R), [
      new OmniLight({ id: 'sun', x: 1, y: 1, z: 40, color: '#ffffff', intensity: 1, radius: 400 }),
    ]);

    const brightness = (recorder: ReturnType<typeof ctxFor>): number => {
      const fills = recorder.valuesOf('fillStyle').filter((v) => typeof v === 'string') as string[];
      const channels = fills[0].match(/\d+/g);
      return channels ? Number(channels[0]) : 0;
    };
    expect(brightness(lit)).toBeGreaterThan(brightness(dark));

    // Piling lights on cannot push a channel past 255 — `illum` is clamped to 1.
    const flooded = ctxFor(new Boulder('rock', 1, 1, '#ffffff', R), Array.from(
      { length: 8 },
      (_, i) => new OmniLight({
        id: `l${i}`, x: 1, y: 1, z: 40, color: '#ffffff', intensity: 1, radius: 400,
      }),
    ));
    const fills = flooded.valuesOf('fillStyle').filter((v) => typeof v === 'string') as string[];
    for (const fill of fills) {
      for (const channel of fill.match(/\d+/g) ?? []) {
        expect(Number(channel)).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('Boulder — health bar', () => {
  it('draws nothing extra for a plain rock', () => {
    const recorder = ctxFor(new Boulder('rock', 1, 1, '#7a7a8a', R));
    // A rock without a HealthComponent is scenery, not a target.
    expect(recorder.argsOf('fillRect').length).toBe(0);
  });

  it('draws a bar whose fill tracks the fraction, and colours by band', () => {
    const bands: Array<[number, string]> = [
      [1.0, '#50e080'],   // > 50%
      [0.4, '#f0c040'],   // > 25%
      [0.1, '#e04040'],   // the rest
    ];
    for (const [fraction, color] of bands) {
      const boulder = new Boulder('rock', 1, 1, '#7a7a8a', R);
      const health = boulder.addComponent(new HealthComponent({ max: 100 }));
      health.takeDamage(100 * (1 - fraction));

      const recorder = ctxFor(boulder);
      const rects = recorder.argsOf('fillRect');
      expect(rects.length).toBe(2);            // track, then fill
      expect(rects[1][2]).toBeCloseTo(32 * fraction, 6);
      expect(recorder.valuesOf('fillStyle')).toContain(color);
    }
  });

  it('drops the bar once the rock is destroyed, but still draws the rock', () => {
    const boulder = new Boulder('rock', 1, 1, '#7a7a8a', R);
    const health = boulder.addComponent(new HealthComponent({ max: 30 }));
    health.takeDamage(30);

    const recorder = ctxFor(boulder);
    expect(recorder.argsOf('fillRect').length).toBe(0);
    expect(recorder.argsOf('fill').length).toBe(3);
  });
});

describe('Boulder — footprint versus drawing', () => {
  it('claims a footprint of ±0.45 tiles around its position', () => {
    const boulder = new Boulder('rock', 3, 4, '#7a7a8a', R);
    const aabb = boulder.aabb;
    expect(aabb.minX).toBeCloseTo(2.55, 6);
    expect(aabb.maxX).toBeCloseTo(3.45, 6);
    expect(aabb.minY).toBeCloseTo(3.55, 6);
    expect(aabb.maxY).toBeCloseTo(4.45, 6);
    expect(aabb.baseZ).toBe(0);
  });

  /**
   * The measurement this file exists for.
   *
   * `aabb.maxZ` is `radius * 2` and its comment says "the full vertical extent is
   * ~2*radius". The drawing says otherwise: the outline reaches about
   * `0.55 * radius` above the anchor, because every vertex is squashed by the
   * `* 0.55` isometric factor. So the declared height is roughly 3.6x the drawn
   * one, which makes the rock occlude — and cast a shadow as tall as — a column
   * it does not visibly fill.
   *
   * Pinned, not fixed: `maxZ` feeds `depthSort` and `ShadowCaster`, and
   * `mossy-boulder` sits in a pixel-gated WebGL fixture, so correcting it belongs
   * with a baseline regeneration rather than in a test-only change.
   */
  it('declares a maxZ far taller than it draws', () => {
    const boulder = new Boulder('rock', 3, 4, '#7a7a8a', R);
    const recorder = ctxFor(boulder);
    const { sy } = project(3, 4, 0, 64, 32);
    const cy = 150 + sy;

    const ys = outlineYs(recorder);
    const drawnAbove = cy - Math.min(...ys);
    const drawnBelow = Math.max(...ys) - cy;

    // Both halves land near 0.55 * radius — the isometric squash factor applied
    // to every vertex. Not exactly, because the seven vertex radii are irregular
    // on purpose, so this is a band rather than a point.
    expect(drawnAbove).toBeGreaterThan(R * 0.45);
    expect(drawnAbove).toBeLessThan(R * 0.6);
    expect(drawnBelow).toBeGreaterThan(R * 0.45);
    expect(drawnBelow).toBeLessThan(R * 0.6);

    // The declared height, for comparison. Change these two together, with a
    // regenerated baseline, never one alone.
    expect(boulder.aabb.maxZ).toBe(R * 2);
    expect(boulder.aabb.maxZ).toBeGreaterThan(drawnAbove * 3);
  });
});

