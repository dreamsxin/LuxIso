import {describe, it, expect, vi} from 'vitest';
import {TimerComponent} from '../ecs/components/TimerComponent';
import {TweenComponent, Easing} from '../ecs/components/TweenComponent';
import {TriggerZoneComponent} from '../ecs/components/TriggerZoneComponent';
import {IsoObject} from '../elements/IsoObject';

// ── TimerComponent ────────────────────────────────────────────────────────────

describe('TimerComponent', () => {
  function advanceTimer(timer: TimerComponent, totalSeconds: number, step = 0.1): void {
    let ts = 1000;
    const steps = Math.ceil(totalSeconds / step);
    for (let i = 0; i < steps; i++) { timer.update(ts); ts += step * 1000; }
  }

  it('fires onTick after duration', () => {
    const fn = vi.fn();
    const t = new TimerComponent({duration: 0.5, onTick: fn});
    advanceTimer(t, 0.6);
    expect(fn).toHaveBeenCalledOnce();
    expect(t.isDone).toBe(true);
  });

  it('does not fire before duration', () => {
    const fn = vi.fn();
    const t = new TimerComponent({duration: 1, onTick: fn});
    advanceTimer(t, 0.4);
    expect(fn).not.toHaveBeenCalled();
    expect(t.isDone).toBe(false);
  });

  it('repeats when repeat=true', () => {
    const fn = vi.fn();
    const t = new TimerComponent({duration: 0.3, repeat: true, onTick: fn});
    advanceTimer(t, 1.0);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(t.isDone).toBe(false);
  });

  it('pause stops ticking', () => {
    const fn = vi.fn();
    const t = new TimerComponent({duration: 0.5, onTick: fn});
    t.pause();
    advanceTimer(t, 1.0);
    expect(fn).not.toHaveBeenCalled();
  });

  it('restart resets elapsed', () => {
    const fn = vi.fn();
    const t = new TimerComponent({duration: 0.5, onTick: fn});
    advanceTimer(t, 0.6);
    expect(fn).toHaveBeenCalledOnce();
    t.restart();
    expect(t.isDone).toBe(false);
    advanceTimer(t, 0.6);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── TweenComponent ────────────────────────────────────────────────────────────

describe('TweenComponent', () => {
  function makeOwner(x = 0, y = 0, z = 0): IsoObject {
    return {
      id: 'e',
      position: {x, y, z},
      aabb: {minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0},
      draw: () => {},
    } as unknown as IsoObject;
  }

  function advanceTween(tween: TweenComponent, totalSeconds: number, step = 0.05): void {
    let ts = 1000;
    const steps = Math.ceil(totalSeconds / step);
    for (let i = 0; i < steps; i++) { tween.update(ts); ts += step * 1000; }
  }

  it('animates position.z from 0 to 48', () => {
    const owner = makeOwner(0, 0, 0);
    const tw = new TweenComponent({
      targets: [{prop: 'z', from: 0, to: 48}],
      duration: 0.5,
    });
    tw.onAttach(owner);
    advanceTween(tw, 0.25);
    expect(owner.position.z).toBeGreaterThan(0);
    expect(owner.position.z).toBeLessThan(48);
  });

  it('snaps to final value on completion', () => {
    const owner = makeOwner(0, 0, 0);
    const tw = new TweenComponent({
      targets: [{prop: 'x', from: 0, to: 5}],
      duration: 0.3,
    });
    tw.onAttach(owner);
    advanceTween(tw, 0.5);
    expect(owner.position.x).toBeCloseTo(5, 4);
    expect(tw.isDone).toBe(true);
  });

  it('calls onComplete', () => {
    const fn = vi.fn();
    const owner = makeOwner();
    const tw = new TweenComponent({
      targets: [{prop: 'y', from: 0, to: 1}],
      duration: 0.2,
      onComplete: fn,
    });
    tw.onAttach(owner);
    advanceTween(tw, 0.4);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('easeOut reaches target faster than linear at midpoint', () => {
    const ownerLinear = makeOwner();
    const ownerEaseOut = makeOwner();
    const twL = new TweenComponent({targets: [{prop: 'x', from: 0, to: 10}], duration: 1, easing: Easing.linear});
    const twE = new TweenComponent({targets: [{prop: 'x', from: 0, to: 10}], duration: 1, easing: Easing.easeOut});
    twL.onAttach(ownerLinear);
    twE.onAttach(ownerEaseOut);
    // Advance to 50% of duration
    let ts = 1000;
    for (let i = 0; i < 30; i++) { twL.update(ts); twE.update(ts); ts += 16.67; }
    expect(ownerEaseOut.position.x).toBeGreaterThan(ownerLinear.position.x);
  });

  it('yoyo reverses direction', () => {
    const owner = makeOwner();
    const tw = new TweenComponent({
      targets: [{prop: 'z', from: 0, to: 10}],
      duration: 0.2,
      yoyo: true,
      repeat: 1,
    });
    tw.onAttach(owner);
    // After first pass (0→10), should start going back (10→0)
    let ts = 1000;
    for (let i = 0; i < 15; i++) { tw.update(ts); ts += 16.67; }
    const midZ = owner.position.z;
    for (let i = 0; i < 15; i++) { tw.update(ts); ts += 16.67; }
    // After yoyo, z should be back near 0
    expect(owner.position.z).toBeLessThan(midZ);
  });
});

// ── TriggerZoneComponent ──────────────────────────────────────────────────────

describe('TriggerZoneComponent', () => {
  function makeObj(id: string, x: number, y: number): IsoObject {
    return {
      id,
      position: {x, y, z: 0},
      aabb: {minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0},
      draw: () => {},
    } as unknown as IsoObject;
  }

  it('fires onEnter when target enters zone', () => {
    const owner = makeObj('zone', 5, 5);
    const target = makeObj('player', 10, 10);
    const onEnter = vi.fn();
    const tz = new TriggerZoneComponent({radius: 1, targets: [target], onEnter});
    tz.onAttach(owner);

    tz.update();
    expect(onEnter).not.toHaveBeenCalled();

    target.position.x = 5.5;
    target.position.y = 5.5;
    tz.update();
    expect(onEnter).toHaveBeenCalledWith('player');
  });

  it('fires onExit when target leaves zone', () => {
    const owner = makeObj('zone', 5, 5);
    const target = makeObj('player', 5.3, 5.3);
    const onExit = vi.fn();
    const tz = new TriggerZoneComponent({radius: 1, targets: [target], onExit});
    tz.onAttach(owner);

    tz.update(); // player inside
    target.position.x = 20;
    tz.update(); // player left
    expect(onExit).toHaveBeenCalledWith('player');
  });

  it('contains() reflects current state', () => {
    const owner = makeObj('zone', 0, 0);
    const target = makeObj('t', 0.5, 0);
    const tz = new TriggerZoneComponent({radius: 1, targets: [target]});
    tz.onAttach(owner);
    tz.update();
    expect(tz.contains('t')).toBe(true);
    target.position.x = 5;
    tz.update();
    expect(tz.contains('t')).toBe(false);
  });
});
