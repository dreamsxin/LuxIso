import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ParticleBlend,
  ParticleSystem,
  type EmitterConfig,
} from '../animation/ParticleSystem';

/**
 * ParticleSystem was the last big coverage gap (47% statements / 19% branches).
 * Writing these tests surfaced two defects: `onExhausted` had no latch, so it
 * fired on every update — including before a burst-only system had spawned
 * anything — and the shared recycle pool was unbounded.
 */

const burstConfig = (over: Partial<EmitterConfig> = {}): EmitterConfig => ({
  rate: 0,
  life: [1, 1],
  speed: [1, 1],
  size: [4, 4],
  ...over,
});

beforeEach(() => {
  ParticleSystem.clearPool();
  ParticleSystem.poolLimit = 512;
});

describe('ParticleSystem — construction', () => {
  it('starts empty and never casts a shadow', () => {
    const ps = new ParticleSystem('fx', 2, 3, 0);
    expect(ps.particleCount).toBe(0);
    expect(ps.castsShadow).toBe(false);
    expect(ps.position).toEqual({ x: 2, y: 3, z: 0 });
  });
});

describe('ParticleSystem — burst', () => {
  it('is a no-op without an emitter', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    expect(() => ps.burst(10)).not.toThrow();
    expect(ps.particleCount).toBe(0);
  });

  it('spawns the requested number of particles from the first emitter', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig());
    ps.burst(7);
    expect(ps.particleCount).toBe(7);
  });

  it('honours maxParticles as a live-particle cap', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ maxParticles: 3 }));
    ps.burst(20);
    expect(ps.particleCount).toBe(3);
  });

  it('accepts the legacy `max` spelling too', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ max: 2 }));
    ps.burst(20);
    expect(ps.particleCount).toBe(2);
  });
});

describe('ParticleSystem — rate-based emission and ageing', () => {
  it('spawns from a rate emitter as time advances', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ rate: 10, life: [10, 10] }));

    ps.update(1_000);       // first update: dt is assumed 1/60
    const afterFirst = ps.particleCount;
    ps.update(1_100);       // dt = 0.1s at 10/s -> one more particle
    expect(ps.particleCount).toBeGreaterThan(afterFirst);
  });

  it('removes particles once their life expires', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ life: [0.05, 0.05] }));
    ps.burst(5);
    expect(ps.particleCount).toBe(5);

    ps.update(1_000);
    ps.update(1_100);       // dt = 0.1s > life
    expect(ps.particleCount).toBe(0);
  });

  it('interpolates alpha and size across a particle lifetime', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({
      life: [1, 1], size: [10, 10], sizeFinal: 0, alphaStart: 1, alphaEnd: 0,
    }));
    ps.burst(1);

    const read = (): { size: number; alpha: number } => {
      let out = { size: -1, alpha: -1 };
      ps.forEachParticle((p) => { out = { size: p.size, alpha: p.alpha }; });
      return out;
    };

    expect(read()).toEqual({ size: 10, alpha: 1 });
    ps.update(1_000);
    ps.update(1_100);       // 0.1s into a 1s life
    const mid = read();
    expect(mid.size).toBeLessThan(10);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.alpha).toBeGreaterThan(0);
  });
});

describe('ParticleSystem — onExhausted', () => {
  it('does not fire before anything has been spawned', () => {
    // Previously this fired on the very first update of a fresh burst-only
    // system, because the condition was just "no particles and no active rate".
    const seen = vi.fn();
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig());
    ps.onExhausted = seen;

    ps.update(1_000);
    ps.update(1_100);
    expect(seen).not.toHaveBeenCalled();
  });

  it('fires exactly once after the last particle dies', () => {
    const seen = vi.fn();
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ life: [0.05, 0.05] }));
    ps.onExhausted = seen;
    ps.burst(3);

    ps.update(1_000);
    expect(seen).not.toHaveBeenCalled();   // still alive

    ps.update(1_100);                       // all expire
    expect(seen).toHaveBeenCalledTimes(1);

    ps.update(1_200);                       // must not fire again
    ps.update(1_300);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('does not fire while a rate emitter is still active', () => {
    const seen = vi.fn();
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ rate: 5, life: [0.05, 0.05] }));
    ps.onExhausted = seen;

    for (let t = 1_000; t <= 1_500; t += 100) ps.update(t);
    expect(seen).not.toHaveBeenCalled();
  });

  it('can fire again after the system is re-burst', () => {
    const seen = vi.fn();
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ life: [0.05, 0.05] }));
    ps.onExhausted = seen;

    ps.burst(2);
    ps.update(1_000);
    ps.update(1_100);
    expect(seen).toHaveBeenCalledTimes(1);

    ps.burst(2);
    ps.update(1_200);
    ps.update(1_300);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('ParticleSystem — recycle pool', () => {
  it('returns dead particles to the pool and reuses them', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ life: [0.05, 0.05] }));
    ps.burst(4);
    expect(ParticleSystem.poolSize).toBe(0);

    ps.update(1_000);
    ps.update(1_100);
    expect(ps.particleCount).toBe(0);
    expect(ParticleSystem.poolSize).toBe(4);

    ps.burst(4);                             // served from the pool
    expect(ps.particleCount).toBe(4);
    expect(ParticleSystem.poolSize).toBe(0);
  });

  it('caps pool growth at poolLimit', () => {
    // The pool used to be unbounded: one large burst left every particle
    // resident for the lifetime of the page.
    ParticleSystem.poolLimit = 5;
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ life: [0.05, 0.05] }));
    ps.burst(40);

    ps.update(1_000);
    ps.update(1_100);
    expect(ps.particleCount).toBe(0);
    expect(ParticleSystem.poolSize).toBe(5);
  });

  it('clearPool drops everything', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ life: [0.05, 0.05] }));
    ps.burst(3);
    ps.update(1_000);
    ps.update(1_100);
    expect(ParticleSystem.poolSize).toBe(3);

    ParticleSystem.clearPool();
    expect(ParticleSystem.poolSize).toBe(0);
  });
});

describe('ParticleSystem — aabb', () => {
  it('is a small box at the emitter while empty', () => {
    const ps = new ParticleSystem('fx', 4, 6, 48);
    const a = ps.aabb;
    expect(a.minX).toBeCloseTo(3.5);
    expect(a.maxX).toBeCloseTo(4.5);
    expect(a.baseZ).toBe(48);          // pixels, same unit as position.z
    expect(a.maxZ).toBeUndefined();
  });

  it('spans the live particles once they exist', () => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ spawnRadius: 4 }));
    ps.burst(30);
    const a = ps.aabb;
    expect(a.minX).toBeLessThanOrEqual(a.maxX);
    expect(a.minY).toBeLessThanOrEqual(a.maxY);
  });
});

describe('ParticleSystem — blend normalisation', () => {
  const blendOf = (blend: EmitterConfig['blend']): ParticleBlend => {
    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(burstConfig({ blend }));
    ps.burst(1);
    let out = ParticleBlend.ALPHA;
    ps.forEachParticle((p) => { out = p.blend; });
    return out;
  };

  it('maps additive aliases onto ADD', () => {
    for (const alias of ['add', 'additive', 'lighter', 'screen', 'SCREEN']) {
      expect(blendOf(alias)).toBe(ParticleBlend.ADD);
    }
  });

  it('maps multiply and falls back to ALPHA', () => {
    expect(blendOf('multiply')).toBe(ParticleBlend.MULTIPLY);
    expect(blendOf('nonsense')).toBe(ParticleBlend.ALPHA);
    expect(blendOf(undefined)).toBe(ParticleBlend.ALPHA);
  });

  it('passes an enum value through unchanged', () => {
    expect(blendOf(ParticleBlend.MULTIPLY)).toBe(ParticleBlend.MULTIPLY);
  });
});

describe('ParticleSystem.presets', () => {
  it('exposes five factories plus the FIRE/SMOKE configs', () => {
    const p = ParticleSystem.presets;
    for (const name of ['crystalShatter', 'dustPuff', 'coinSpill', 'sparkBurst', 'ambientDrift'] as const) {
      expect(typeof p[name]).toBe('function');
    }
    expect(typeof p.FIRE).toBe('object');
    expect(typeof p.SMOKE).toBe('object');
  });

  it('burst presets are one-shot (rate 0) and produce usable configs', () => {
    for (const factory of [
      ParticleSystem.presets.crystalShatter,
      ParticleSystem.presets.dustPuff,
      ParticleSystem.presets.coinSpill,
      ParticleSystem.presets.sparkBurst,
    ]) {
      const config = factory();
      expect(config.rate).toBe(0);
      expect(config.size.length).toBe(2);
    }
  });

  it('burst presets honour the color option', () => {
    // These factories used to be typed `(_o?: any)` and drop the argument, so
    // `sparkBurst({ color: 'red' })` silently produced the default palette.
    expect(ParticleSystem.presets.sparkBurst().color).toEqual(['#ffffff', '#ffffcc']);
    expect(ParticleSystem.presets.sparkBurst({ color: '#ff0000' }).color).toBe('#ff0000');
    expect(ParticleSystem.presets.dustPuff({ color: ['#111', '#222'] }).color).toEqual(['#111', '#222']);
  });

  it('burst presets honour the count option as a particle cap', () => {
    expect(ParticleSystem.presets.coinSpill().maxParticles).toBeUndefined();

    const ps = new ParticleSystem('fx', 0, 0, 0);
    ps.addEmitter(ParticleSystem.presets.coinSpill({ count: 4 }));
    ps.burst(50);
    expect(ps.particleCount).toBe(4);
  });

  it('ambientDrift reads count, speed, size, alpha, blend and shape', () => {
    const config = ParticleSystem.presets.ambientDrift({
      count: 12,
      speed: [1, 2],
      size: [3, 4],
      alpha: 0.5,
      blend: 'multiply',
      shape: 'square',
    });
    expect(config.rate).toBe(12);
    expect(config.speed).toEqual([1, 2]);
    expect(config.size).toEqual([3, 4]);
    expect(config.alphaStart).toBe(0.5);
    expect(config.blend).toBe('multiply');
    expect(config.particleShape).toBe('square');
  });

  it('ambientDrift keeps its defaults when called bare', () => {
    const config = ParticleSystem.presets.ambientDrift();
    expect(config.rate).toBe(40);
    expect(config.alphaStart).toBeCloseTo(0.35);
    expect(config.blend).toBe('screen');
  });

  it('a preset config drives a real system end to end', () => {
    const ps = new ParticleSystem('fx', 1, 1, 0);
    ps.addEmitter(ParticleSystem.presets.sparkBurst({ color: '#abcdef' }));
    ps.burst(6);
    expect(ps.particleCount).toBe(6);

    const colors = new Set<string>();
    ps.forEachParticle((p) => colors.add(p.color));
    expect([...colors]).toEqual(['#abcdef']);
  });
});
