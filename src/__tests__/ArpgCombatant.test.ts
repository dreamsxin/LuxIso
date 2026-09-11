import { describe, it, expect, afterEach, vi } from 'vitest';
import { Combatant } from '../../examples/10-arpg/Combatant';
import { registerCombatantExtractor } from '../../examples/10-arpg/CombatantExtractor';
import { SceneExtractor } from '../../webgl-next/src/extraction/SceneExtractor';
import { Scene } from '../core/Scene';
import { TileCollider } from '../physics/TileCollider';
import { PathCache, Pathfinder } from '../physics/Pathfinder';

/**
 * The ARPG demo's fighting entity, and its opt-in to the WebGL2 path.
 *
 * `think()` is the only thing the demo adds on top of the framework's own
 * components, so it is the only thing that needs pinning: chase, reach, cooldown,
 * and the dt guards that stop a long frame or a paused tab from handing out a
 * free hit.
 */

function hero(x = 0, y = 0): Combatant {
  return new Combatant('hero', x, y, { faction: 'hero', hp: 100, damage: 10, attackInterval: 0.5 });
}

function grunt(x = 0, y = 0): Combatant {
  return new Combatant('grunt', x, y, { hp: 30, damage: 6, attackInterval: 1 });
}

describe('Combatant — construction', () => {
  it('wires health and movement components', () => {
    const unit = grunt();
    expect(unit.health.maxHp).toBe(30);
    expect(unit.health.hp).toBe(30);
    expect(unit.movement.speed).toBeCloseTo(2.4);
    expect(unit.isDead).toBe(false);
  });

  it('clamps hostile options', () => {
    const unit = new Combatant('x', 0, 0, {
      hp: 0, damage: -5, attackRange: -1, attackInterval: 0, speed: -2, radius: -10,
    });
    expect(unit.health.maxHp).toBe(1);
    expect(unit.damage).toBe(0);
    expect(unit.attackRange).toBeGreaterThan(0);
    expect(unit.attackInterval).toBeGreaterThan(0);
    expect(unit.movement.speed).toBe(0);
    expect(unit.radius).toBeGreaterThan(0);
  });

  it('defaults to the enemy faction and casts a shadow', () => {
    const unit = new Combatant('x', 1, 1);
    expect(unit.faction).toBe('enemy');
    expect(unit.castsShadow).toBe(true);
    expect(unit.shadowRadius).toBeGreaterThan(0);
  });
});

describe('Combatant — think', () => {
  it('chases a target that is out of reach', () => {
    const a = grunt(0, 0);
    a.think(0.016, hero(5, 5));
    expect(a.movement.isMoving).toBe(true);
  });

  it('stops and hits a target in reach', () => {
    const a = grunt(0, 0);
    const b = hero(0.5, 0);
    a.think(0.016, b);
    expect(a.movement.isMoving).toBe(false);
    expect(b.health.hp).toBe(94);
  });

  it('respects the attack interval', () => {
    const a = grunt(0, 0);
    const b = hero(0.5, 0);
    a.think(0.016, b);
    expect(b.health.hp).toBe(94);
    a.think(0.5, b);            // still cooling down
    expect(b.health.hp).toBe(94);
    a.think(0.5, b);            // interval elapsed
    expect(b.health.hp).toBe(88);
  });

  it('reports the remaining cooldown', () => {
    const a = grunt(0, 0);
    const b = hero(0.5, 0);
    a.think(0.016, b);
    expect(a.cooldown).toBeCloseTo(1);
    a.think(0.25, b);
    expect(a.cooldown).toBeCloseTo(0.75);
  });

  it('does not let a non-positive or non-finite dt cool the attack down', () => {
    const a = grunt(0, 0);
    const b = hero(0.5, 0);
    a.think(0.016, b);
    const armed = a.cooldown;
    a.think(0, b);
    a.think(-10, b);
    a.think(NaN, b);
    a.think(Infinity, b);
    expect(a.cooldown).toBeCloseTo(armed);
    expect(b.health.hp).toBe(94);
  });

  it('fires onAttack with the damage it dealt', () => {
    const onAttack = vi.fn();
    const a = grunt(0, 0);
    a.onAttack = onAttack;
    a.think(0.016, hero(0.5, 0));
    expect(onAttack).toHaveBeenCalledWith(a, 6);
  });

  it('does nothing once dead', () => {
    const a = grunt(0, 0);
    const b = hero(0.5, 0);
    a.health.takeDamage(999);
    a.think(0.016, b);
    expect(a.isDead).toBe(true);
    expect(b.health.hp).toBe(100);
  });

  it('stops moving when the target dies or is absent', () => {
    const a = grunt(0, 0);
    const b = hero(5, 5);
    a.think(0.016, b);
    expect(a.movement.isMoving).toBe(true);
    b.health.takeDamage(999);
    a.think(0.016, b);
    expect(a.movement.isMoving).toBe(false);

    a.think(0.016, hero(5, 5));
    expect(a.movement.isMoving).toBe(true);
    a.think(0.016, null);
    expect(a.movement.isMoving).toBe(false);
  });

  it('measures reach as a circle, not per axis', () => {
    const range = 1;
    const a = new Combatant('a', 0, 0, { attackRange: range, damage: 3 });
    // Inside both axes but outside the radius: hypot(0.8, 0.8) = 1.13.
    const far = hero(0.8, 0.8);
    a.think(0.016, far);
    expect(far.health.hp).toBe(100);
    expect(a.movement.isMoving).toBe(true);
  });
});

describe('Combatant — chasing around cover', () => {
  /** A barrier down col 6, with a gap at the last two rows. */
  function barrier(): TileCollider {
    const collider = new TileCollider(12, 12);
    for (let row = 0; row < 10; row++) collider.setWalkable(6, row, false);
    return collider;
  }

  function chase(mob: Combatant, target: Combatant, seconds: number, dt = 1 / 60): void {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      mob.think(dt, target);
      mob.fixedUpdate(dt);
    }
  }

  it('walks straight at a target it can see', () => {
    const collider = barrier();
    const mob = new Combatant('m', 1.5, 2.5, { collider, speed: 2.4 });
    // Same side of the barrier: nothing on the line.
    mob.think(1 / 60, new Combatant('h', 4.5, 2.5, { faction: 'hero', collider }));
    expect(mob.movement.isMoving).toBe(true);
    expect(mob.movement.remainingWaypoints.length).toBe(0);
  });

  it('follows a path when the barrier hides the target', () => {
    const collider = barrier();
    const mob = new Combatant('m', 1.5, 2.5, { collider, speed: 2.4 });
    mob.think(1 / 60, new Combatant('h', 9.5, 2.5, { faction: 'hero', collider }));
    expect(mob.movement.isMoving).toBe(true);
    // A straight `moveTo` leaves no waypoints; a route around the barrier does.
    expect(mob.movement.remainingWaypoints.length).toBeGreaterThan(0);
  });

  it('reaches a target on the far side of the barrier', () => {
    const collider = barrier();
    const target = new Combatant('h', 9.5, 2.5, { faction: 'hero', hp: 500, collider });
    const mob = new Combatant('m', 1.5, 2.5, { collider, speed: 2.4, damage: 3 });
    chase(mob, target, 30);

    // Through the gap, up the far side, and into reach — the hero is being hit.
    expect(target.health.hp).toBeLessThan(500);
    expect(Math.hypot(
      target.position.x - mob.position.x, target.position.y - mob.position.y,
    )).toBeLessThanOrEqual(mob.attackRange + 1e-6);
    expect(collider.isWalkable(Math.floor(mob.position.x), Math.floor(mob.position.y))).toBe(true);
  });

  it('re-paths on an interval rather than every frame', () => {
    const collider = barrier();
    const cache = new PathCache(32);
    const target = new Combatant('h', 9.5, 2.5, { faction: 'hero', collider });
    const mob = new Combatant('m', 1.5, 2.5, { collider, speed: 2.4, pathCache: cache });

    const find = vi.spyOn(Pathfinder, 'find');
    for (let i = 0; i < 60; i++) { mob.think(1 / 60, target); mob.fixedUpdate(1 / 60); }
    const searches = find.mock.calls.length;
    find.mockRestore();

    // A second of chasing at REPATH_INTERVAL 0.35 s is a handful of searches,
    // not one per frame. A moving target invalidates a path constantly, so
    // without the interval this is an A* per mob per frame.
    expect(searches).toBeGreaterThan(0);
    expect(searches).toBeLessThan(10);
    // And they went through the arena's own cache, not the shared default.
    expect(cache.size).toBeGreaterThan(0);
  });

  it('presses on when no path exists at all', () => {
    const collider = new TileCollider(12, 12);
    // Seal the target in: A* returns null because the goal tile is blocked.
    collider.setWalkable(9, 2, false);
    const target = new Combatant('h', 9.5, 2.5, { faction: 'hero', collider });
    const mob = new Combatant('m', 1.5, 8.5, { collider, speed: 2.4 });

    mob.think(1 / 60, target);
    expect(mob.movement.isMoving).toBe(true);
  });
});

describe('Combatant — player-driven swing', () => {
  it('lands a hit in reach and then refuses until the cooldown expires', () => {
    const a = hero(0, 0);
    const b = grunt(0.5, 0);
    expect(a.swing(b)).toBe(true);
    expect(b.health.hp).toBe(20);
    expect(a.swing(b)).toBe(false);
    a.tick(0.5);
    expect(a.swing(b)).toBe(true);
    expect(b.health.hp).toBe(10);
  });

  it('refuses out of reach without spending the cooldown', () => {
    const a = hero(0, 0);
    const far = grunt(4, 4);
    expect(a.swing(far)).toBe(false);
    expect(a.cooldown).toBe(0);
    expect(far.health.hp).toBe(30);
  });

  it('refuses a null or dead target, and refuses while dead', () => {
    const a = hero(0, 0);
    const b = grunt(0.5, 0);
    expect(a.swing(null)).toBe(false);
    b.health.takeDamage(999);
    expect(a.swing(b)).toBe(false);

    const c = hero(0, 0);
    c.health.takeDamage(999);
    expect(c.swing(grunt(0.5, 0))).toBe(false);
  });

  it('ignores a non-finite or non-positive dt in tick', () => {
    const a = hero(0, 0);
    a.swing(grunt(0.5, 0));
    const armed = a.cooldown;
    a.tick(0);
    a.tick(-3);
    a.tick(NaN);
    a.tick(Infinity);
    expect(a.cooldown).toBeCloseTo(armed);
  });
});

describe('Combatant — WebGL2 extraction', () => {
  afterEach(() => {
    SceneExtractor.clearExtractors();
  });

  const OPTS = { viewportWidth: 400, viewportHeight: 300 };

  function sceneWith(unit: Combatant): Scene {
    const scene = new Scene({ tileW: 64, tileH: 32, cols: 8, rows: 8 });
    scene.addObject(unit);
    return scene;
  }

  it('is a magenta diagnostic until the extractor is registered', () => {
    const snapshot = new SceneExtractor().extract(sceneWith(grunt(2, 2)), OPTS);
    expect(snapshot.unsupported.map(u => u.type)).toContain('Combatant');
  });

  it('emits geometry once registered', () => {
    registerCombatantExtractor();
    const snapshot = new SceneExtractor().extract(sceneWith(grunt(2, 2)), OPTS);
    expect(snapshot.unsupported).toEqual([]);
    expect(snapshot.geometry.vertexCount).toBeGreaterThan(0);
  });

  it('re-registers after the registry is cleared', () => {
    registerCombatantExtractor();
    SceneExtractor.clearExtractors();
    registerCombatantExtractor();
    const snapshot = new SceneExtractor().extract(sceneWith(grunt(2, 2)), OPTS);
    expect(snapshot.unsupported).toEqual([]);
  });

  it('drops the health bar of a dead unit but still draws the body', () => {
    registerCombatantExtractor();
    const alive = grunt(2, 2);
    const withBar = new SceneExtractor().extract(sceneWith(alive), OPTS).geometry.vertexCount;

    const dead = grunt(2, 2);
    dead.health.takeDamage(999);
    const withoutBar = new SceneExtractor().extract(sceneWith(dead), OPTS).geometry.vertexCount;

    expect(withoutBar).toBeGreaterThan(0);
    expect(withoutBar).toBeLessThan(withBar);
  });
});
