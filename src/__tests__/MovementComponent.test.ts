import { describe, it, expect, vi } from 'vitest';
import { MovementComponent } from '../ecs/components/MovementComponent';
import { TileCollider } from '../physics/TileCollider';
import { PathCache, Pathfinder } from '../physics/Pathfinder';
import { EventBus } from '../ecs/EventBus';
import { IsoObject } from '../elements/IsoObject';
import { Scene } from '../core/Scene';
import { Character } from '../elements/Character';

function makeOwner(x = 0, y = 0, z = 0): IsoObject {
  return { id: 'e', position: { x, y, z }, aabb: { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 }, draw: () => {} } as unknown as IsoObject;
}

describe('MovementComponent — basic movement', () => {
  it('moves toward target over time', () => {
    const owner = makeOwner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(owner);
    mv.moveTo(2, 0);

    // Simulate 0.5 s at 60 fps (ts increments)
    let ts = 1000;
    for (let i = 0; i < 30; i++) { mv.update(ts); ts += 16.67; }

    expect(owner.position.x).toBeGreaterThan(0);
    expect(mv.isMoving).toBe(true);
  });

  it('arrives and stops', () => {
    const owner = makeOwner(0, 0, 0);
    const mv = new MovementComponent({ speed: 10 });
    mv.onAttach(owner);
    mv.moveTo(0.5, 0);

    let ts = 1000;
    for (let i = 0; i < 60; i++) { mv.update(ts); ts += 16.67; }

    expect(owner.position.x).toBeCloseTo(0.5, 1);
    expect(mv.isMoving).toBe(false);
  });

  it('emits arrival event', () => {
    const bus = new EventBus();
    const onArrival = vi.fn();
    bus.on('arrival', onArrival);

    const owner = makeOwner(0, 0, 0);
    const mv = new MovementComponent({ speed: 10, bus });
    mv.onAttach(owner);
    mv.moveTo(0.1, 0);

    let ts = 1000;
    for (let i = 0; i < 30; i++) { mv.update(ts); ts += 16.67; }

    expect(onArrival).toHaveBeenCalled();
  });

  it('stopMoving cancels target', () => {
    const owner = makeOwner(0, 0, 0);
    const mv = new MovementComponent({ speed: 1 });
    mv.onAttach(owner);
    mv.moveTo(5, 0);
    mv.stopMoving();
    expect(mv.isMoving).toBe(false);
  });
});

describe('MovementComponent — collision', () => {
  it('stops when blocked', () => {
    const collider = new TileCollider(5, 5);
    for (let r = 0; r < 5; r++) collider.setWalkable(2, r, false);

    const owner = makeOwner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 5, collider });
    mv.onAttach(owner);
    mv.moveTo(3, 2.5);

    let ts = 1000;
    for (let i = 0; i < 60; i++) { mv.update(ts); ts += 16.67; }

    // Should not have crossed into col 2
    expect(owner.position.x).toBeLessThan(2);
  });
});

describe('MovementComponent — path cache', () => {
  /**
   * `PathCache` asks each scene to own one, but until `pathTo()` accepted a cache
   * no component could: every search went to the module-level default, so two
   * scenes with different colliders flushed each other's results and one crowd
   * could evict another's out of a 64-entry cache.
   */
  it('searches the cache it was given', () => {
    const collider = new TileCollider(8, 8);
    const cache = new PathCache(16);
    const mv = new MovementComponent({ speed: 2, collider, pathCache: cache });
    mv.onAttach(makeOwner(0.5, 0.5));

    expect(cache.size).toBe(0);
    expect(mv.pathTo(6.5, 6.5)).toBe(true);
    expect(cache.size).toBe(1);
    expect(mv.pathCache).toBe(cache);
  });

  it('leaves its own cache alone when another collider is searched', () => {
    const arena = new TileCollider(8, 8);
    const cache = new PathCache(16);
    const mv = new MovementComponent({ speed: 2, collider: arena, pathCache: cache });
    mv.onAttach(makeOwner(0.5, 0.5));
    mv.pathTo(6.5, 6.5);
    expect(cache.size).toBe(1);

    // A second scene searching the shared default cache cannot disturb this one.
    Pathfinder.find(new TileCollider(4, 4), { x: 0.5, y: 0.5 }, { x: 3.5, y: 3.5 });
    expect(cache.size).toBe(1);
  });

  it('falls back to the shared default, and can be swapped later', () => {
    const collider = new TileCollider(8, 8);
    const mv = new MovementComponent({ speed: 2, collider });
    mv.onAttach(makeOwner(0.5, 0.5));
    expect(mv.pathCache).toBeNull();
    expect(mv.pathTo(6.5, 6.5)).toBe(true);

    const cache = new PathCache(16);
    mv.setPathCache(cache);
    mv.pathTo(0.5, 6.5);
    expect(cache.size).toBe(1);
  });
});

describe('MovementComponent — fixed timestep integration', () => {
  it('does not integrate twice when Scene drives fixed and variable updates', () => {
    const scene = new Scene({ cols: 8, rows: 8 });
    const character = new Character({ id: 'runner', x: 1.5, y: 1.5 });
    const movement = character.addComponent(new MovementComponent({ speed: 2 }));
    scene.addObject(character);
    movement.moveTo(5.5, 1.5);

    scene.fixedUpdate(1 / 60);
    const afterFixed = character.position.x;
    scene.update(1000);

    expect(character.position.x).toBe(afterFixed);
    scene.update(1008.33);
    expect(character.position.x).toBe(afterFixed);
    scene.fixedUpdate(1 / 60);
    scene.update(1016.67);
    expect(character.position.x).toBeGreaterThan(afterFixed);
  });
});
