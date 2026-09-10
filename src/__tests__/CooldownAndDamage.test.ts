import { describe, it, expect, vi } from 'vitest';
import { TimerComponent } from '../ecs/components/TimerComponent';
import { HealthComponent } from '../ecs/components/HealthComponent';
import { EventBus } from '../ecs/EventBus';
import { IsoObject } from '../elements/IsoObject';

/**
 * Cooldowns and damage — the two ARPG primitives that must not lie.
 *
 * A skill cooldown that credits paused time, or a damage call that heals past
 * max because the caller passed a negative number, both surface as unfixable
 * "balance" bugs at the game layer.
 */

function owner(id = 'mob'): IsoObject {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    aabb: { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 },
    draw: () => {},
  } as unknown as IsoObject;
}

describe('TimerComponent — frame delta', () => {
  it('does not drop the frame after timestamp 0', () => {
    const t = new TimerComponent({ duration: 1 });
    t.update(0);
    // The old `_lastTs === 0` sentinel was still armed here, so this whole
    // 200 ms frame was thrown away.
    t.update(200);
    expect(t.elapsed).toBeCloseTo(0.2, 6);
  });

  it('does not advance on the first frame', () => {
    const t = new TimerComponent({ duration: 1 });
    t.update(1000);
    expect(t.elapsed).toBe(0);
  });

  it('never rewinds on a backwards timestamp', () => {
    const t = new TimerComponent({ duration: 1 });
    t.update(1000);
    t.update(1200);
    t.update(700);
    expect(t.elapsed).toBeCloseTo(0.2, 6);
  });

  it('clamps a long stall', () => {
    const t = new TimerComponent({ duration: 100 });
    t.update(1000);
    t.update(61_000);
    expect(t.elapsed).toBeLessThanOrEqual(0.5);
  });
});

describe('TimerComponent — pause and resume', () => {
  it('does not credit time spent paused', () => {
    const fn = vi.fn();
    const t = new TimerComponent({ duration: 0.4, onTick: fn });
    t.update(1000);
    t.update(1100);
    expect(t.elapsed).toBeCloseTo(0.1, 6);

    t.pause();
    t.start();
    // 10 s of wall clock passed while paused. Before the fix the stale
    // `_lastTs` turned that into a clamped 0.5 s jump, firing the cooldown.
    t.update(11_100);
    expect(t.elapsed).toBeCloseTo(0.1, 6);
    expect(fn).not.toHaveBeenCalled();

    t.update(11_200);
    expect(t.elapsed).toBeCloseTo(0.2, 6);
  });

  it('does not advance while paused', () => {
    const t = new TimerComponent({ duration: 0.5 });
    t.update(1000);
    t.pause();
    t.update(1200);
    t.update(1400);
    expect(t.elapsed).toBe(0);
    expect(t.isRunning).toBe(false);
  });

  it('restart re-baselines the clock', () => {
    const fn = vi.fn();
    const t = new TimerComponent({ duration: 0.3, onTick: fn });
    t.update(1000);
    t.update(1100);
    t.restart();
    t.update(9000);
    expect(t.elapsed).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('autoStart: false stays put until start()', () => {
    const t = new TimerComponent({ duration: 0.2, autoStart: false });
    t.update(1000);
    t.update(1300);
    expect(t.elapsed).toBe(0);

    t.start();
    t.update(1400);
    t.update(1500);
    expect(t.elapsed).toBeCloseTo(0.1, 6);
  });
});

describe('TimerComponent — repeating cooldowns', () => {
  it('catches up when one frame spans several periods', () => {
    const fn = vi.fn();
    const t = new TimerComponent({ duration: 0.05, repeat: true, onTick: fn });
    t.update(1000);
    // 200 ms covers four 50 ms periods. Only one tick used to fire per frame,
    // so a period shorter than the frame time silently ran at frame rate.
    t.update(1200);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not accumulate an unbounded backlog', () => {
    const t = new TimerComponent({ duration: 0.01, repeat: true });
    let ts = 1000;
    for (let i = 0; i < 30; i++) { t.update(ts); ts += 100; }
    // The leftover must stay below one period instead of growing every frame.
    expect(t.elapsed).toBeLessThan(0.01);
  });

  it('keeps running forever', () => {
    const fn = vi.fn();
    const t = new TimerComponent({ duration: 0.1, repeat: true, onTick: fn });
    let ts = 1000;
    for (let i = 0; i < 10; i++) { t.update(ts); ts += 100; }
    expect(t.isDone).toBe(false);
    expect(t.isRunning).toBe(true);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it('a zero duration does not hang the frame', () => {
    const fn = vi.fn();
    const t = new TimerComponent({ duration: 0, repeat: true, onTick: fn });
    t.update(1000);
    t.update(1100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(t.fraction).toBe(1);
  });
});

describe('TimerComponent — one-shot', () => {
  it('fires onTick and onComplete once, then stops', () => {
    const onTick = vi.fn();
    const onComplete = vi.fn();
    const t = new TimerComponent({ duration: 0.2, onTick, onComplete });
    let ts = 1000;
    for (let i = 0; i < 10; i++) { t.update(ts); ts += 100; }

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(t.isDone).toBe(true);
    expect(t.isRunning).toBe(false);
    expect(t.elapsed).toBe(0.2);
    expect(t.fraction).toBe(1);
  });
});

describe('HealthComponent — damage direction', () => {
  it('negative damage cannot heal past max', () => {
    const hp = new HealthComponent({ max: 100, current: 50 });
    hp.onAttach(owner());
    hp.takeDamage(-500);
    expect(hp.hp).toBe(50);
  });

  it('negative healing cannot kill', () => {
    const onDeath = vi.fn();
    const hp = new HealthComponent({ max: 100, current: 50, onDeath });
    hp.onAttach(owner());
    hp.heal(-500);
    // Before the fix hp went to -450: `isDead` reported true, but no death
    // callback or event ever fired because heal() has no death path.
    expect(hp.hp).toBe(50);
    expect(hp.isDead).toBe(false);
    expect(onDeath).not.toHaveBeenCalled();
  });

  it('fires death exactly once and ignores later damage', () => {
    const bus = new EventBus();
    const deaths: unknown[] = [];
    bus.on('death', (p) => deaths.push(p));
    const onDeath = vi.fn();

    const hp = new HealthComponent({ max: 30, onDeath, bus });
    hp.onAttach(owner('boss'));
    hp.takeDamage(50);
    hp.takeDamage(50);

    expect(hp.hp).toBe(0);
    expect(hp.isDead).toBe(true);
    expect(onDeath).toHaveBeenCalledTimes(1);
    expect(deaths).toEqual([{ id: 'boss' }]);
  });

  it('emits damage with the source id and the post-hit hp', () => {
    const bus = new EventBus();
    const events: unknown[] = [];
    bus.on('damage', (p) => events.push(p));

    const hp = new HealthComponent({ max: 100, bus });
    hp.onAttach(owner('mob'));
    hp.takeDamage(25, 'hero');

    expect(events).toEqual([{ amount: 25, targetId: 'mob', sourceId: 'hero' }]);
    expect(hp.hp).toBe(75);
  });

  it('cannot be healed after death', () => {
    const hp = new HealthComponent({ max: 10 });
    hp.onAttach(owner());
    hp.takeDamage(10);
    hp.heal(10);
    expect(hp.hp).toBe(0);
  });

  it('heal clamps to max', () => {
    const onChange = vi.fn();
    const hp = new HealthComponent({ max: 100, current: 90, onChange });
    hp.onAttach(owner());
    hp.heal(50);
    expect(hp.hp).toBe(100);
    expect(onChange).toHaveBeenCalledWith(100, 100, expect.anything());
  });

  it('zero damage still reports, but does not kill a full-hp target', () => {
    const onDeath = vi.fn();
    const hp = new HealthComponent({ max: 10, onDeath });
    hp.onAttach(owner());
    hp.takeDamage(0);
    expect(hp.hp).toBe(10);
    expect(onDeath).not.toHaveBeenCalled();
  });
});

describe('HealthComponent — setMax', () => {
  it('scales current hp proportionally when asked', () => {
    const hp = new HealthComponent({ max: 100, current: 50 });
    hp.onAttach(owner());
    hp.setMax(200, true);
    expect(hp.maxHp).toBe(200);
    expect(hp.hp).toBe(100);
    expect(hp.fraction).toBeCloseTo(0.5, 6);
  });

  it('clamps current hp when not scaling', () => {
    const hp = new HealthComponent({ max: 100 });
    hp.onAttach(owner());
    hp.setMax(40);
    expect(hp.hp).toBe(40);
  });

  it('refuses a non-positive max', () => {
    const hp = new HealthComponent({ max: 100, current: 60 });
    hp.onAttach(owner());
    hp.setMax(0);
    // fraction would be Infinity or NaN with a max of 0, and the entity would
    // silently read as dead without any death event.
    expect(hp.maxHp).toBe(100);
    expect(hp.hp).toBe(60);
  });
});
