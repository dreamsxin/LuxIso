import { describe, it, expect, vi } from 'vitest';
import { MovementComponent } from '../ecs/components/MovementComponent';
import { TileCollider } from '../physics/TileCollider';
import { EventBus } from '../ecs/EventBus';
import { IsoObject } from '../elements/IsoObject';

/**
 * MovementComponent — timing and blocked-path behaviour.
 *
 * The existing MovementComponent.test.ts covers the happy path with timestamps
 * that start at 1000. Everything here starts where a real Engine starts (the
 * first rAF timestamp can legitimately be 0) or walks into a wall, which is
 * where the component's contract came apart.
 */

function owner(x = 0, y = 0, z = 0): IsoObject {
  return {
    id: 'e',
    position: { x, y, z },
    aabb: { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 },
    draw: () => {},
  } as unknown as IsoObject;
}

/** Wall filling column 2, so an entity at x < 2 moving +x is stopped head-on. */
function wallCollider(): TileCollider {
  const collider = new TileCollider(5, 5);
  for (let r = 0; r < 5; r++) collider.setWalkable(2, r, false);
  return collider;
}

describe('MovementComponent — frame delta', () => {
  it('moves when the first timestamp is 0', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);

    mv.update(0);
    for (let ts = 16; ts <= 500; ts += 16) mv.update(ts);

    expect(o.position.x).toBeGreaterThan(0.5);
  });

  it('does not integrate on the first frame', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    mv.update(1000);
    expect(o.position.x).toBe(0);
  });

  it('does not drop the frame after timestamp 0', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    mv.update(0);
    // The old `_lastTs === 0` sentinel was still armed here, so this frame's
    // real 100 ms was thrown away and the entity did not move at all.
    mv.update(100);
    expect(o.position.x).toBeCloseTo(0.2, 6);
  });

  it('clamps a long stall to 100 ms', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    mv.update(1000);
    mv.update(11_000);
    expect(o.position.x).toBeCloseTo(0.2, 6);
  });

  it('ignores a backwards timestamp instead of moving in reverse', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    mv.update(1000);
    mv.update(1100);
    const advanced = o.position.x;
    mv.update(600);
    expect(o.position.x).toBe(advanced);
  });

  it('ignores update() without a timestamp', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    mv.update();
    expect(o.position.x).toBe(0);
  });
});

describe('MovementComponent — blocked head-on', () => {
  it('gives up instead of pushing into a wall forever', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 5, collider: wallCollider() });
    mv.onAttach(o);
    mv.moveTo(4, 2.5);

    let ts = 1000;
    for (let i = 0; i < 60; i++) { mv.update(ts); ts += 16; }

    // Previously only the pathfinding branch gave up, so a plain moveTo() left
    // `isMoving` true for the rest of the session — an ARPG mob walking into a
    // wall never released its "moving" state and never reported arrival.
    expect(o.position.x).toBeLessThan(2);
    expect(mv.isMoving).toBe(false);
  });

  it('stops emitting move once fully blocked', () => {
    const bus = new EventBus();
    const onMove = vi.fn();
    bus.on('move', onMove);

    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 5, collider: wallCollider(), bus });
    mv.onAttach(o);
    mv.moveTo(4, 2.5);

    let ts = 1000;
    for (let i = 0; i < 40; i++) { mv.update(ts); ts += 16; }
    const emitted = onMove.mock.calls.length;
    for (let i = 0; i < 40; i++) { mv.update(ts); ts += 16; }

    expect(onMove.mock.calls.length).toBe(emitted);
  });

  it('still slides along a wall it hits at an angle', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 2, collider: wallCollider(), radius: 0.4 });
    mv.onAttach(o);
    mv.moveTo(4, 4.5);

    let ts = 1000;
    for (let i = 0; i < 60; i++) { mv.update(ts); ts += 16; }

    // The x component is blocked but y is free, so the entity must keep moving.
    expect(o.position.y).toBeGreaterThan(2.6);
    expect(o.position.x).toBeLessThan(2);
  });

  it('moves freely with no collider attached', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 5 });
    mv.onAttach(o);
    mv.moveTo(4, 2.5);

    let ts = 1000;
    for (let i = 0; i < 60; i++) { mv.update(ts); ts += 16; }

    expect(o.position.x).toBeCloseTo(4, 6);
    expect(mv.isMoving).toBe(false);
  });
});

describe('MovementComponent — paths', () => {
  it('followPath walks every waypoint in order', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 8 });
    mv.onAttach(o);
    mv.followPath([{ x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(mv.remainingWaypoints.length).toBe(1);

    let ts = 1000;
    for (let i = 0; i < 60; i++) { mv.update(ts); ts += 16; }

    expect(o.position.x).toBeCloseTo(1, 6);
    expect(o.position.y).toBeCloseTo(1, 6);
    expect(mv.isMoving).toBe(false);
  });

  it('followPath with an empty path cancels the current move', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    // `_advanceWaypoint()` used to shift `undefined` off the empty array and
    // leave the previous target armed, so the entity kept walking to (5, 0).
    mv.followPath([]);
    expect(mv.isMoving).toBe(false);
  });

  it('pathTo without a collider degrades to a straight move', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    expect(mv.pathTo(3, 3)).toBe(true);
    expect(mv.isMoving).toBe(true);
    expect(mv.remainingWaypoints.length).toBe(0);
  });

  it('pathTo returns false and stops when the target is unreachable', () => {
    const collider = wallCollider();
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 2, collider });
    mv.onAttach(o);
    mv.moveTo(1.5, 3.5);
    expect(mv.pathTo(4, 2)).toBe(false);
    expect(mv.isMoving).toBe(false);
  });

  it('moveTo clears any remaining waypoints', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.followPath([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    mv.moveTo(9, 9);
    expect(mv.remainingWaypoints.length).toBe(0);
  });
});

describe('MovementComponent — tunnelling', () => {
  it('a knockback nudge cannot jump a one-tile wall', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ collider: wallCollider(), radius: 0.4 });
    mv.onAttach(o);
    // `resolveMove` only tests the destination footprint, so this landed at 3.5
    // — straight through the wall in column 2.
    mv.nudge(2, 0);
    expect(o.position.x).toBeLessThan(2);
  });

  it('a dash-speed step cannot jump a one-tile wall', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 30, collider: wallCollider(), radius: 0.4 });
    mv.onAttach(o);
    mv.moveTo(4.5, 2.5);

    mv.update(1000);
    mv.update(1100); // clamped 100 ms at speed 30 -> a 3-unit step

    expect(o.position.x).toBeLessThan(2);
  });

  it('a short step still slides instead of sweeping', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ speed: 2, collider: wallCollider(), radius: 0.4 });
    mv.onAttach(o);
    mv.moveTo(4, 4.5);

    let ts = 1000;
    for (let i = 0; i < 40; i++) { mv.update(ts); ts += 16; }

    expect(o.position.y).toBeGreaterThan(2.6);
  });
});

describe('MovementComponent — nudge and lifecycle', () => {
  it('nudge stops at the wall face instead of passing through it', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ collider: wallCollider(), radius: 0.4 });
    mv.onAttach(o);
    mv.nudge(2, 0);
    // Slides up flush against column 2: 2 - radius.
    expect(o.position.x).toBeCloseTo(1.6, 2);
  });

  it('nudge applies the raw displacement without a collider', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent();
    mv.onAttach(o);
    mv.nudge(0.25, -0.5);
    expect(o.position.x).toBeCloseTo(1.75, 6);
    expect(o.position.y).toBeCloseTo(2, 6);
  });

  it('does nothing after onDetach', () => {
    const o = owner(0, 0, 0);
    const mv = new MovementComponent({ speed: 2 });
    mv.onAttach(o);
    mv.moveTo(5, 0);
    mv.onDetach();
    mv.update(1000);
    mv.update(1100);
    mv.nudge(1, 1);
    expect(o.position.x).toBe(0);
  });

  it('setCollider swaps collision behaviour at runtime', () => {
    const o = owner(1.5, 2.5, 0);
    const mv = new MovementComponent({ radius: 0.4 });
    mv.onAttach(o);
    mv.setCollider(wallCollider());
    mv.nudge(2, 0);
    expect(o.position.x).toBeLessThan(2);
    mv.setCollider(null);
    mv.nudge(2, 0);
    expect(o.position.x).toBeGreaterThan(3.5);
  });
});
