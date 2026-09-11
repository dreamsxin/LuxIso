import { describe, it, expect, afterEach } from 'vitest';
import { Engine } from '../core/Engine';
import { Scene } from '../core/Scene';
import { SceneSerializer } from '../core/SceneSerializer';
import { HealthComponent } from '../ecs/components/HealthComponent';
import { TileCollider } from '../physics/TileCollider';
import { Combatant } from '../../examples/10-arpg/Combatant';
import {
  registerCombatantPersistence, unregisterCombatantPersistence, COMBATANT_TYPE,
} from '../../examples/10-arpg/persistence';

/**
 * A custom entity through both halves of the save/load round trip.
 *
 * The two directions live in separate registries — `SceneSerializer.register`
 * writes, `Engine.registerProp` reads — and registering only one is a silent
 * half-round-trip. This is the first test to drive a real custom entity through
 * both, which is also what proves the loader no longer replaces the
 * `HealthComponent` a class built for itself.
 */

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 640, height: 480,
    getContext: () => ({ clearRect: () => {}, save: () => {}, restore: () => {}, setTransform: () => {} }),
  } as unknown as HTMLCanvasElement;
}

function arena(): Scene {
  const scene = new Scene({ name: 'Arena', tileW: 64, tileH: 32, cols: 12, rows: 12 });
  scene.collider = new TileCollider(12, 12);
  return scene;
}

afterEach(() => {
  unregisterCombatantPersistence();
  SceneSerializer.clearSerializers();
});

describe('ARPG persistence', () => {
  it('round-trips a fighter through JSON', () => {
    registerCombatantPersistence();
    const scene = arena();
    scene.addObject(new Combatant('hero', 5.25, 6.5, {
      faction: 'hero', hp: 140, damage: 16, attackRange: 1.15, attackInterval: 0.4,
      speed: 3.2, radius: 15, color: '#6fd8ff',
    }));

    const saved = SceneSerializer.toJSON(scene);
    const entry = (saved.props as Array<Record<string, unknown>>)[0];
    expect(entry).toMatchObject({
      type: COMBATANT_TYPE, id: 'hero', x: 5.25, y: 6.5,
      faction: 'hero', health: 140, damage: 16, radius: 15, color: '#6fd8ff',
    });
    expect('hp' in entry).toBe(false); // undamaged

    const restored = new Engine({ canvas: makeCanvas() }).buildScene(saved)
      .getById('hero') as Combatant;
    expect(restored).toBeInstanceOf(Combatant);
    expect(restored.faction).toBe('hero');
    expect(restored.position.x).toBeCloseTo(5.25);
    expect(restored.position.y).toBeCloseTo(6.5);
    expect(restored.health.maxHp).toBe(140);
    expect(restored.health.hp).toBe(140);
    expect(restored.damage).toBe(16);
    expect(restored.attackRange).toBeCloseTo(1.15);
    expect(restored.attackInterval).toBeCloseTo(0.4);
    expect(restored.movement.speed).toBeCloseTo(3.2);
    expect(restored.radius).toBe(15);
    expect(restored.color).toBe('#6fd8ff');
  });

  it('carries a wounded fighter back at the hp it was saved with', () => {
    registerCombatantPersistence();
    const scene = arena();
    const mob = new Combatant('w1-0', 3, 4, { hp: 40, damage: 6 });
    mob.health.takeDamage(28);
    scene.addObject(mob);

    const saved = SceneSerializer.toJSON(scene);
    expect((saved.props as Array<Record<string, unknown>>)[0]).toMatchObject({ health: 40, hp: 12 });

    const restored = new Engine({ canvas: makeCanvas() }).buildScene(saved)
      .getById('w1-0') as Combatant;
    expect(restored.health.hp).toBe(12);
    expect(restored.health.maxHp).toBe(40);
    // The class's own component survived the load, so `unit.health` and the ECS
    // map are the same object — the loader no longer injects a replacement.
    expect(restored.getComponent(HealthComponent)).toBe(restored.health);
  });

  it('hands the restored fighter the collider JSON cannot carry', () => {
    const collider = new TileCollider(12, 12);
    collider.setWalkable(4, 3, false);
    registerCombatantPersistence({ collider });

    const scene = arena();
    scene.addObject(new Combatant('mob', 3, 3, { hp: 20, speed: 2 }));
    const restored = new Engine({ canvas: makeCanvas() })
      .buildScene(SceneSerializer.toJSON(scene)).getById('mob') as Combatant;

    // Walking east into the blocked tile is stopped by the injected collider.
    restored.movement.nudge(2, 0);
    expect(restored.position.x).toBeLessThan(4);
  });

  it('keeps a whole wave, and only the fighters it should', () => {
    registerCombatantPersistence();
    const scene = arena();
    scene.addObject(new Combatant('hero', 6, 6, { faction: 'hero', hp: 140 }));
    for (let i = 0; i < 3; i++) {
      scene.addObject(new Combatant(`w2-${i}`, 2 + i, 9, { hp: 32 }));
    }

    const saved = SceneSerializer.toJSON(scene);
    expect((saved.props as unknown[]).length).toBe(4);

    const reloaded = new Engine({ canvas: makeCanvas() }).buildScene(saved);
    const fighters = reloaded.getAll(Combatant);
    expect(fighters.length).toBe(4);
    expect(fighters.filter(f => f.faction === 'hero').length).toBe(1);
    expect(fighters.map(f => f.id).sort()).toEqual(['hero', 'w2-0', 'w2-1', 'w2-2']);
  });

  it('is a silent half-round-trip with only the save side registered', () => {
    // What the framework's two registries make easy to get wrong, pinned so the
    // demo notices if one call goes missing.
    SceneSerializer.register(Combatant, () => ({ type: COMBATANT_TYPE }));
    const scene = arena();
    scene.addObject(new Combatant('mob', 3, 3, { hp: 20 }));

    const saved = SceneSerializer.toJSON(scene);
    expect((saved.props as unknown[]).length).toBe(1);

    // No loader for the type: the entry is skipped with a warning, not restored.
    const reloaded = new Engine({ canvas: makeCanvas() }).buildScene(saved);
    expect(reloaded.getAll(Combatant).length).toBe(0);
  });
});
