import {describe, expect, it} from 'vitest';
import {EventBus} from '../ecs/EventBus';

/**
 * The subscription bag — a scope whose subscriptions release together.
 *
 * The failure mode this exists for: a scene subscribes on enter and must `off`
 * every handler by hand on exit, and the one that is forgotten keeps firing
 * with a closure over the dead scene. The bag makes "release everything" one
 * idempotent call.
 */

interface Events {
  ping: {n: number};
  pong: {n: number};
}

describe('EventBus — subscription bag', () => {
  it('releases every subscription it collected', () => {
    const bus = new EventBus<Events>();
    const seen: string[] = [];
    const bag = bus.bag();
    bag.on('ping', () => seen.push('a'));
    bag.on('pong', () => seen.push('b'));

    bus.emit('ping', {n: 1});
    bag.release();
    bus.emit('ping', {n: 2});
    bus.emit('pong', {n: 2});

    expect(seen).toEqual(['a']);
    expect(bus.listenerCount('ping')).toBe(0);
    expect(bus.listenerCount('pong')).toBe(0);
    expect(bag.size).toBe(0);
  });

  it('release is idempotent', () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    const bag = bus.bag();
    bag.on('ping', () => {calls++;});
    bag.release();
    bag.release();
    bus.emit('ping', {n: 1});
    expect(calls).toBe(0);
    expect(bag.size).toBe(0);
  });

  it('supports early removal of a single subscription before release', () => {
    const bus = new EventBus<Events>();
    const seen: number[] = [];
    const bag = bus.bag();
    const unA = bag.on('ping', ({n}) => seen.push(n));
    bag.on('ping', ({n}) => seen.push(n * 10));
    unA();
    bus.emit('ping', {n: 2});
    bag.release();
    bus.emit('ping', {n: 3});
    expect(seen).toEqual([20]);
  });

  it('once inside a bag fires exactly once and releases cleanly', () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    const bag = bus.bag();
    bag.once('ping', () => {calls++;});
    bus.emit('ping', {n: 1});
    bus.emit('ping', {n: 2});
    bag.release();
    bus.emit('ping', {n: 3});
    expect(calls).toBe(1);
  });

  it('a released bag stays closed: later subscriptions never fire', () => {
    const bus = new EventBus<Events>();
    let calls = 0;
    const bag = bus.bag();
    bag.release();
    const unsub = bag.on('ping', () => {calls++;});
    bus.emit('ping', {n: 1});
    unsub();
    expect(calls).toBe(0);
    expect(bus.listenerCount('ping')).toBe(0);
  });

  it('tracks size while open', () => {
    const bus = new EventBus<Events>();
    const bag = bus.bag();
    bag.on('ping', () => {});
    bag.on('pong', () => {});
    expect(bag.size).toBe(2);
    bag.release();
    expect(bag.size).toBe(0);
  });
});
