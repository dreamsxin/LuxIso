import { describe, it, expect, beforeEach } from 'vitest';
import { MovementComponent } from '../ecs/components/MovementComponent';
import { TimerComponent } from '../ecs/components/TimerComponent';
import { TweenComponent, Easing } from '../ecs/components/TweenComponent';
import { ParticleSystem, type EmitterConfig } from '../animation/ParticleSystem';
import { FloatingText } from '../elements/props/FloatingText';
import { Cloud } from '../elements/props/Cloud';
import { Chest } from '../elements/props/Chest';
import type { IsoObject } from '../elements/IsoObject';

/**
 * The frame-delta contract, asserted once for every module that derives its own
 * `dt` from a timestamp.
 *
 * This is the most-repeated defect in the project's history. `_lastTs = 0` as a
 * first-frame sentinel has been found and fixed eleven times — in `Engine`,
 * `Scene`, `MovementComponent`, `TimerComponent`, `TweenComponent`,
 * `AnimationComponent`, `AnimationController`, `FloatingText`, `Chest`, `Cloud`
 * and `ParticleSystem` — because `Engine`'s first timestamp *is* 0, so the
 * sentinel never disarms and the frame after it is silently wrong. Each fix
 * arrived with its own regression test, and the next module still shipped the
 * same bug: a per-module test cannot fail for a module that does not exist yet.
 *
 * So the contract is enumerated here instead. A new time-accumulating module is
 * expected to be added to `CASES`, and the twelfth occurrence then fails in CI
 * rather than after someone notices that clouds do not drift.
 *
 * The three rules, each of which has been violated in production code:
 *   1. A timestamp of 0 is an ordinary first frame — no advance on it, and a
 *      real delta on the frame after it.
 *   2. Time going backwards never rewinds state.
 *   3. A long gap (a hidden tab, a breakpoint) is clamped, not integrated.
 */

/** A module under test, reduced to "feed it time" and "read its progress". */
interface Clock {
  tick(ts: number): void;
  /** Any quantity that grows while time moves forward. */
  read(): number;
}

interface Case {
  name: string;
  make(): Clock;
}

function owner(): IsoObject {
  return {
    id: 'e',
    position: { x: 0, y: 0, z: 0 },
    aabb: { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 },
    draw: () => {},
  } as unknown as IsoObject;
}

const emitter = (over: Partial<EmitterConfig> = {}): EmitterConfig => ({
  rate: 50,
  life: [1000, 1000],
  speed: [0, 0],
  size: [4, 4],
  maxParticles: 100000,
  ...over,
});

const CASES: Case[] = [
  {
    name: 'MovementComponent',
    make: () => {
      const o = owner();
      const mv = new MovementComponent({ speed: 1 });
      mv.onAttach(o);
      mv.moveTo(1000, 0);
      return { tick: (ts) => mv.update(ts), read: () => o.position.x };
    },
  },
  {
    name: 'TimerComponent',
    make: () => {
      // Long enough that the timer never completes and `_elapsed` keeps growing.
      const timer = new TimerComponent({ duration: 10000 });
      return { tick: (ts) => timer.update(ts), read: () => timer.elapsed };
    },
  },
  {
    name: 'TweenComponent',
    make: () => {
      const o = owner();
      const tw = new TweenComponent({
        targets: [{ prop: 'z', from: 0, to: 100000 }],
        duration: 10000,
        easing: Easing.linear,
      });
      tw.onAttach(o);
      return { tick: (ts) => tw.update(ts), read: () => o.position.z };
    },
  },
  {
    name: 'ParticleSystem',
    make: () => {
      const ps = new ParticleSystem('fx', 0, 0, 0);
      ps.addEmitter(emitter());
      // Particle count grows with integrated time, which is the readout here.
      return { tick: (ts) => ps.update(ts), read: () => ps.particleCount };
    },
  },
  {
    name: 'FloatingText',
    make: () => {
      const ft = new FloatingText({ id: 'ft', x: 2, y: 3, z: 0, text: '-20' });
      return { tick: (ts) => ft.update(ts), read: () => ft.position.z };
    },
  },
  {
    name: 'Cloud',
    make: () => {
      const cloud = new Cloud({ id: 'c', x: 0, y: 0, speed: 2, angle: 0 });
      return { tick: (ts) => cloud.update(ts), read: () => cloud.position.x };
    },
  },
  {
    name: 'Chest',
    make: () => {
      const chest = new Chest('c', 2, 2);
      chest.open();
      return { tick: (ts) => chest.update(ts), read: () => chest.lidAngle };
    },
  },
];

beforeEach(() => {
  ParticleSystem.clearPool();
});

/** Above every clamp in the codebase (0.1 s for most, 0.5 s for timer/tween). */
const LONGEST_CLAMP_MS = 600;

describe.each(CASES)('frame-delta contract — $name', ({ make }) => {
  it('treats a timestamp of 0 as an ordinary first frame', () => {
    const fromZero = make();
    const initial = fromZero.read();
    fromZero.tick(0);
    expect(fromZero.read()).toBe(initial);   // rule 1a: no advance on frame one

    fromZero.tick(100);
    const advanced = fromZero.read();
    // Non-vacuous: if 100 ms moves nothing, the comparison below proves nothing.
    expect(advanced).toBeGreaterThan(initial);

    // rule 1b: the same 100 ms delta, measured from a non-zero start. A
    // `_lastTs === 0` sentinel makes these two disagree, because it stays armed
    // through a legitimate timestamp of 0 and fabricates or drops the frame
    // after it.
    const fromLater = make();
    fromLater.tick(1000);
    fromLater.tick(1100);
    expect(advanced).toBeCloseTo(fromLater.read(), 6);
  });

  it('does not rewind when a timestamp goes backwards', () => {
    const m = make();
    m.tick(1000);
    m.tick(1100);
    const before = m.read();
    m.tick(1050);
    expect(m.read()).toBeGreaterThanOrEqual(before);
  });

  it('clamps a long gap instead of integrating it', () => {
    const jumped = make();
    jumped.tick(1000);
    jumped.tick(11_000);          // ten seconds — a hidden tab or a breakpoint

    const clamped = make();
    clamped.tick(1000);
    clamped.tick(1000 + LONGEST_CLAMP_MS);

    expect(jumped.read()).toBeLessThanOrEqual(clamped.read());
  });
});


