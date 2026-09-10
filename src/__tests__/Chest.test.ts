import { describe, it, expect } from 'vitest';
import { Chest } from '../elements/props/Chest';

/**
 * Chest lid tests.
 *
 * At 6% coverage the lid animation carried the same defect Camera and ClickMover
 * already had fixed: `_lidAngle += (target - _lidAngle) * 0.10` applies a fixed
 * fraction per frame, so the lid opened 2.4x faster on a 144 Hz display — even
 * though `ts` was already being passed in and used for the glow pulse.
 */

/** Run `frames` updates spanning `seconds`, starting from ts 0. */
function run(chest: Chest, frames: number, seconds: number): void {
  const step = (seconds * 1000) / frames;
  chest.update(0);
  for (let i = 1; i <= frames; i++) chest.update(i * step);
}

describe('Chest — lid state', () => {
  it('starts closed', () => {
    const chest = new Chest('c', 2, 2);
    expect(chest.isOpen).toBe(false);
    expect(chest.lidAngle).toBe(0);
  });

  it('open / close / toggle drive the flag', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    expect(chest.isOpen).toBe(true);
    chest.close();
    expect(chest.isOpen).toBe(false);
    chest.toggle();
    expect(chest.isOpen).toBe(true);
    chest.toggle();
    expect(chest.isOpen).toBe(false);
  });

  it('animates toward open and back toward closed', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    run(chest, 30, 0.5);
    const opened = chest.lidAngle;
    expect(opened).toBeGreaterThan(0.5);

    chest.close();
    run(chest, 30, 0.5);
    expect(chest.lidAngle).toBeLessThan(opened);
  });

  it('never overshoots the 0–1 range', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    run(chest, 600, 10);
    expect(chest.lidAngle).toBeLessThanOrEqual(1);
    expect(chest.lidAngle).toBeGreaterThan(0.99);
  });
});

describe('Chest — frame-rate independence', () => {
  it('reaches the same lid angle at 30 and 144 FPS', () => {
    const slow = new Chest('slow', 2, 2);
    const fast = new Chest('fast', 2, 2);
    slow.open();
    fast.open();

    run(slow, 15, 0.5);   // 30 FPS
    run(fast, 72, 0.5);   // 144 FPS

    // The old fixed-fraction lerp left these far apart: 72 frames of 10% is
    // essentially fully open while 15 frames is barely half.
    expect(fast.lidAngle).toBeCloseTo(slow.lidAngle, 2);
  });

  it('matches the historical feel at 60 FPS', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(0);
    chest.update(1000 / 60);
    // One 60 FPS frame at factor 0.10 moves a tenth of the way, as before.
    expect(chest.lidAngle).toBeCloseTo(0.1, 6);
  });

  it('does not advance on the first update', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(1000);
    expect(chest.lidAngle).toBe(0);
  });

  it('treats a timestamp of 0 as a real frame, not a reset', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(0);
    chest.update(100);
    // A `0` sentinel would have read "first frame" twice and never moved.
    expect(chest.lidAngle).toBeGreaterThan(0);
  });

  it('clamps a long stall so the lid cannot slam open', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(0);
    chest.update(10_000);
    // dt capped at 100 ms → six 60 FPS frames' worth, not 600.
    const sixFrames = 1 - Math.pow(1 - 0.1, 6);
    expect(chest.lidAngle).toBeCloseTo(sixFrames, 6);
  });

  it('falls back to one 60 FPS step when called without a timestamp', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update();
    expect(chest.lidAngle).toBeCloseTo(0.1, 6);
  });

  it('ignores a timestamp that goes backwards', () => {
    const chest = new Chest('c', 2, 2);
    chest.open();
    chest.update(1000);
    chest.update(500);
    expect(chest.lidAngle).toBe(0);
  });
});

describe('Chest — lidLerpFactor', () => {
  it('opens instantly at 1', () => {
    const chest = new Chest('c', 2, 2);
    chest.lidLerpFactor = 1;
    chest.open();
    chest.update(0);
    chest.update(16);
    expect(chest.lidAngle).toBe(1);
  });

  it('never moves at 0', () => {
    const chest = new Chest('c', 2, 2);
    chest.lidLerpFactor = 0;
    chest.open();
    run(chest, 60, 1);
    expect(chest.lidAngle).toBe(0);
  });

  it('clamps an out-of-range factor instead of producing NaN', () => {
    const chest = new Chest('c', 2, 2);
    chest.lidLerpFactor = -3;
    chest.open();
    run(chest, 10, 0.2);
    expect(Number.isFinite(chest.lidAngle)).toBe(true);
    expect(chest.lidAngle).toBe(0);
  });
});
