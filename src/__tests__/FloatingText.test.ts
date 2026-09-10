import { describe, it, expect } from 'vitest';
import { FloatingText } from '../elements/props/FloatingText';
import { Scene } from '../core/Scene';

/**
 * FloatingText tests.
 *
 * The class had 37% coverage and carried the usual consequence: `speed` was
 * documented as "units/sec" with a default of 1.5, but `position.z` is screen
 * pixels, so a damage number rose 1.2 px over an 800 ms life — the "floats
 * upward" in its own docblock never happened.
 */

const START_Z = 32;

function text(opts: Partial<{ duration: number; speed: number }> = {}): FloatingText {
  return new FloatingText({ id: 'ft', x: 2, y: 3, z: START_Z, text: '-20', ...opts });
}

describe('FloatingText — rise', () => {
  it('rises at the documented pixels per second', () => {
    const ft = text({ speed: 60 });
    ft.update(0);
    // 100 ms steps: update() clamps a single frame to 100 ms, so one jump of
    // 500 ms would only advance by one clamped frame (covered separately).
    for (let t = 100; t <= 500; t += 100) ft.update(t);
    expect(ft.position.z).toBeCloseTo(START_Z + 30, 6);
  });


  it('lifts a default damage number visibly over its life', () => {
    const ft = text({ duration: 800 });
    ft.update(0);
    // Advance in <= 100 ms steps, since update() clamps a single frame to that.
    for (let t = 100; t <= 800; t += 100) ft.update(t);
    // The old 1.5 default produced 1.2 px here, which is not a float at all.
    expect(ft.position.z - START_Z).toBeGreaterThan(24);
  });

  it('stays put when speed is 0, for a static label', () => {
    const ft = text({ speed: 0 });
    ft.update(0);
    ft.update(500);
    expect(ft.position.z).toBe(START_Z);
  });

  it('is frame-rate independent', () => {
    const coarse = text({ speed: 50 });
    const fine = text({ speed: 50 });
    coarse.update(0);
    coarse.update(100);

    fine.update(0);
    for (let t = 10; t <= 100; t += 10) fine.update(t);

    expect(fine.position.z).toBeCloseTo(coarse.position.z, 6);
  });

  it('clamps a long frame so a stall cannot fling the text away', () => {
    const ft = text({ speed: 100 });
    ft.update(0);
    ft.update(5000);
    // dt is capped at 100 ms → 10 px, not 500.
    expect(ft.position.z).toBeCloseTo(START_Z + 10, 6);
  });
});

describe('FloatingText — lifetime and fade', () => {
  it('starts fully opaque and unexpired', () => {
    const ft = text();
    expect(ft.alpha).toBe(1);
    expect(ft.isExpired).toBe(false);
  });

  it('does not advance on the first update', () => {
    const ft = text({ duration: 100 });
    ft.update(1000);
    // The old 0.016 fallback invented a frame, fading the text before it had
    // been drawn once.
    expect(ft.alpha).toBe(1);
    expect(ft.position.z).toBe(START_Z);
  });

  it('fades linearly across the duration', () => {
    const ft = text({ duration: 400 });
    ft.update(0);
    ft.update(100);
    expect(ft.alpha).toBeCloseTo(0.75, 6);
    ft.update(200);
    expect(ft.alpha).toBeCloseTo(0.5, 6);
  });

  it('expires at the end of its duration and clamps alpha at 0', () => {
    const ft = text({ duration: 200 });
    ft.update(0);
    ft.update(100);
    expect(ft.isExpired).toBe(false);
    ft.update(200);
    expect(ft.isExpired).toBe(true);
    expect(ft.alpha).toBe(0);

    ft.update(300);
    expect(ft.alpha).toBe(0);
  });

  it('keeps a minimum depth slab at its current height', () => {
    const ft = text({ speed: 100 });
    ft.update(0);
    ft.update(100);
    expect(ft.aabb.baseZ).toBeCloseTo(ft.position.z, 6);
    expect(ft.aabb.maxZ! - ft.aabb.baseZ).toBeCloseTo(16, 6);
  });
});

describe('FloatingText — scene lifecycle', () => {
  it('is dropped from the scene once expired', () => {
    const scene = new Scene({ tileW: 64, tileH: 32, cols: 8, rows: 8 });
    const ft = scene.spawnFloatingText({ x: 1, y: 1, z: 16, text: 'hit', duration: 100 });
    expect(scene.getById(ft.id)).toBe(ft);

    scene.update(0);
    scene.update(100);
    scene.update(200);
    // README calls this auto-expiry; Scene.update is what actually removes it.
    expect(scene.getById(ft.id)).toBeUndefined();
  });

  it('survives while still within its duration', () => {
    const scene = new Scene({ tileW: 64, tileH: 32, cols: 8, rows: 8 });
    const ft = scene.spawnFloatingText({ x: 1, y: 1, z: 16, text: 'hit', duration: 1000 });
    scene.update(0);
    scene.update(100);
    expect(scene.getById(ft.id)).toBe(ft);
  });

  it('gives each spawned text a distinct id', () => {
    const scene = new Scene({ tileW: 64, tileH: 32, cols: 8, rows: 8 });
    const a = scene.spawnFloatingText({ x: 1, y: 1, z: 16, text: '1' });
    const b = scene.spawnFloatingText({ x: 1, y: 1, z: 16, text: '2' });
    expect(a.id).not.toBe(b.id);
  });
});
