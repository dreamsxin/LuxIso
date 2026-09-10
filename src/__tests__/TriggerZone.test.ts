import { describe, it, expect, vi } from 'vitest';
import { TriggerZoneComponent } from '../ecs/components/TriggerZoneComponent';
import { EventBus } from '../ecs/EventBus';
import { IsoObject } from '../elements/IsoObject';

/**
 * TriggerZoneComponent — the aggro/proximity primitive.
 *
 * The zone is the piece an ARPG leans on for enemy aggro, so what matters is
 * that enter fires once, exit fires once, and both survive targets being added
 * or removed mid-session.
 */

function obj(id: string, x = 0, y = 0, z = 0): IsoObject {
  return {
    id,
    position: { x, y, z },
    aabb: { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 },
    draw: () => {},
  } as unknown as IsoObject;
}

describe('TriggerZoneComponent — enter and exit', () => {
  it('fires enter once while the target stays inside', () => {
    const onEnter = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onEnter });
    zone.onAttach(owner);

    zone.update();
    zone.update();
    zone.update();

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledWith('player');
    expect(zone.contains('player')).toBe(true);
  });

  it('fires exit once when the target leaves', () => {
    const onExit = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onExit });
    zone.onAttach(owner);

    zone.update();
    player.position.x = 5;
    zone.update();
    zone.update();

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith('player');
    expect(zone.contains('player')).toBe(false);
  });

  it('re-fires enter after a target leaves and comes back', () => {
    const onEnter = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onEnter });
    zone.onAttach(owner);

    zone.update();
    player.position.x = 5;
    zone.update();
    player.position.x = 0.5;
    zone.update();

    expect(onEnter).toHaveBeenCalledTimes(2);
  });

  it('follows the owner rather than the origin', () => {
    const onEnter = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onEnter });
    zone.onAttach(owner);

    zone.update();
    expect(onEnter).not.toHaveBeenCalled();

    owner.position.x = 4.5;
    zone.update();
    expect(onEnter).toHaveBeenCalledWith('player');
  });

  it('is a circle, not a square: the diagonal corner is outside', () => {
    const owner = obj('mob', 0, 0);
    // (0.8, 0.8) is inside a square of half-size 1 but 1.13 away, so outside a
    // circle of radius 1. The option docblock used to describe a square.
    const diagonal = obj('diagonal', 0.8, 0.8);
    const straight = obj('straight', 0.9, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [diagonal, straight] });
    zone.onAttach(owner);
    zone.update();

    expect(zone.contains('diagonal')).toBe(false);
    expect(zone.contains('straight')).toBe(true);
  });

  it('ignores the owner even when it is in the target list', () => {
    const onEnter = vi.fn();
    const owner = obj('mob', 0, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [owner], onEnter });
    zone.onAttach(owner);
    zone.update();
    expect(onEnter).not.toHaveBeenCalled();
    expect(zone.insideIds.size).toBe(0);
  });

  it('ignores z entirely — the zone is a 2D footprint', () => {
    const owner = obj('mob', 0, 0, 0);
    const flyer = obj('flyer', 0.2, 0, 500);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [flyer] });
    zone.onAttach(owner);
    zone.update();
    expect(zone.contains('flyer')).toBe(true);
  });
});

describe('TriggerZoneComponent — bus and callbacks', () => {
  it('emits triggerEnter and triggerExit with both ids', () => {
    const bus = new EventBus();
    const enters: unknown[] = [];
    const exits: unknown[] = [];
    bus.on('triggerEnter', (p) => enters.push(p));
    bus.on('triggerExit', (p) => exits.push(p));

    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], bus });
    zone.onAttach(owner);

    zone.update();
    player.position.x = 9;
    zone.update();

    expect(enters).toEqual([{ triggerId: 'mob', enterId: 'player' }]);
    expect(exits).toEqual([{ triggerId: 'mob', enterId: 'player' }]);
  });

  it('setOnEnter and setOnExit replace the callbacks', () => {
    const first = vi.fn();
    const second = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onEnter: first });
    zone.onAttach(owner);
    zone.setOnEnter(second);
    zone.update();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('player');
  });

  it('does nothing without an owner', () => {
    const onEnter = vi.fn();
    const player = obj('player', 0, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onEnter });
    zone.update();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('onDetach clears membership without firing exit', () => {
    const onExit = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onExit });
    zone.onAttach(owner);
    zone.update();
    zone.onDetach();

    expect(onExit).not.toHaveBeenCalled();
    expect(zone.insideIds.size).toBe(0);
  });
});

describe('TriggerZoneComponent — dynamic targets and radius', () => {
  it('a target removed from the list counts as having left', () => {
    const onExit = vi.fn();
    const owner = obj('mob', 0, 0);
    const player = obj('player', 0.5, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player], onExit });
    zone.onAttach(owner);
    zone.update();

    zone.targets = [];
    zone.update();

    expect(onExit).toHaveBeenCalledWith('player');
  });

  it('a target added mid-session enters normally', () => {
    const onEnter = vi.fn();
    const owner = obj('mob', 0, 0);
    const zone = new TriggerZoneComponent({ radius: 1, onEnter });
    zone.onAttach(owner);
    zone.update();

    zone.targets = [obj('late', 0.2, 0)];
    zone.update();

    expect(onEnter).toHaveBeenCalledWith('late');
  });

  it('tracks several targets independently', () => {
    const owner = obj('mob', 0, 0);
    const a = obj('a', 0.2, 0);
    const b = obj('b', 0.3, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [a, b] });
    zone.onAttach(owner);
    zone.update();
    expect(zone.insideIds.size).toBe(2);

    b.position.x = 9;
    zone.update();
    expect([...zone.insideIds]).toEqual(['a']);
  });

  it('honours a radius change at runtime', () => {
    const owner = obj('mob', 0, 0);
    const player = obj('player', 2, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [player] });
    zone.onAttach(owner);
    zone.update();
    expect(zone.contains('player')).toBe(false);

    zone.radius = 3;
    zone.update();
    expect(zone.contains('player')).toBe(true);
  });

  it('defaults to a 0.6 radius', () => {
    const owner = obj('mob', 0, 0);
    const near = obj('near', 0.5, 0);
    const far = obj('far', 0.7, 0);
    const zone = new TriggerZoneComponent({ targets: [near, far] });
    zone.onAttach(owner);
    zone.update();
    expect(zone.contains('near')).toBe(true);
    expect(zone.contains('far')).toBe(false);
  });

  it('counts a target exactly on the boundary as inside', () => {
    const owner = obj('mob', 0, 0);
    const edge = obj('edge', 1, 0);
    const zone = new TriggerZoneComponent({ radius: 1, targets: [edge] });
    zone.onAttach(owner);
    zone.update();
    expect(zone.contains('edge')).toBe(true);
  });
});
