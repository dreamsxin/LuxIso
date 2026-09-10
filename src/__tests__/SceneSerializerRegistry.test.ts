import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scene } from '../core/Scene';
import { Engine } from '../core/Engine';
import { SceneSerializer } from '../core/SceneSerializer';
import { Entity } from '../ecs/Entity';
import { Chest } from '../elements/props/Chest';
import { HealthComponent } from '../ecs/components/HealthComponent';
import type { AABB } from '../math/depthSort';
import type { DrawContext } from '../elements/IsoObject';

/**
 * Custom prop serialization.
 *
 * `Engine.registerProp()` has always let a game *load* its own object types, but
 * `SceneSerializer.toJSON()` was a closed `instanceof` chain, so an ARPG saving
 * a checkpoint lost every mob, spawner and portal without a word. This is the
 * save-side twin of the `SceneExtractor` registry.
 */

class Mob extends Entity {
  constructor(id: string, x: number, y: number, public tier = 1) { super(id, x, y, 0); }
  get aabb(): AABB {
    return { minX: this.position.x, maxX: this.position.x, minY: this.position.y, maxY: this.position.y, baseZ: 0 };
  }
  draw(_dc: DrawContext): void {}
}

class Boss extends Mob {}

/** A plain IsoObject, not an Entity — the registry must not require one. */
class Portal extends Entity {
  constructor(id: string, x: number, y: number, public target = 'level2') { super(id, x, y, 0); }
  get aabb(): AABB {
    return { minX: this.position.x, maxX: this.position.x, minY: this.position.y, maxY: this.position.y, baseZ: 0 };
  }
  draw(_dc: DrawContext): void {}
}

function canvas(): HTMLCanvasElement {
  return { width: 1, height: 1, getContext: () => ({}) } as unknown as HTMLCanvasElement;
}

function props(scene: Scene): Array<Record<string, unknown>> {
  return (scene.toJSON() as { props: Array<Record<string, unknown>> }).props;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  SceneSerializer.clearSerializers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  SceneSerializer.clearSerializers();
  Engine.unregisterProp('mob');
  Engine.unregisterProp('boss');
  Engine.unregisterProp('portal');
  warn.mockRestore();
});

describe('SceneSerializer — custom prop registry', () => {
  it('writes a registered custom object into props[]', () => {
    SceneSerializer.register(Mob, (mob) => ({ type: 'mob', tier: mob.tier }));

    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Mob('mob-1', 3, 4, 2));

    expect(props(scene)).toEqual([
      { type: 'mob', id: 'mob-1', x: 3, y: 4, tier: 2 },
    ]);
  });

  it('fills in id/x/y so a serializer only declares its own fields', () => {
    SceneSerializer.register(Portal, () => ({ type: 'portal' }));
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Portal('gate', 1.5, 2.5));

    expect(props(scene)[0]).toEqual({ type: 'portal', id: 'gate', x: 1.5, y: 2.5 });
  });

  it('lets the serializer override the defaults', () => {
    SceneSerializer.register(Portal, (portal) => ({
      type: 'portal', id: `saved-${portal.id}`, x: 9, y: 9, target: portal.target,
    }));
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Portal('gate', 1, 1));

    expect(props(scene)[0]).toEqual({
      type: 'portal', id: 'saved-gate', x: 9, y: 9, target: 'level2',
    });
  });

  it('drops an object with no serializer, warning once per type', () => {
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Mob('a', 1, 1));
    scene.addObject(new Mob('b', 2, 2));

    expect(props(scene)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Mob');
  });

  it('a later registration wins, and a subclass can override its base', () => {
    SceneSerializer.register(Mob, () => ({ type: 'mob' }));
    SceneSerializer.register(Boss, () => ({ type: 'boss', phase: 1 }));

    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Mob('m', 1, 1));
    scene.addObject(new Boss('b', 2, 2));

    expect(props(scene)).toEqual([
      { type: 'mob', id: 'm', x: 1, y: 1 },
      { type: 'boss', id: 'b', x: 2, y: 2, phase: 1 },
    ]);
  });

  it('a base-class serializer still covers a subclass', () => {
    SceneSerializer.register(Mob, (mob) => ({ type: 'mob', tier: mob.tier }));
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Boss('b', 2, 2, 9));
    expect(props(scene)).toEqual([{ type: 'mob', id: 'b', x: 2, y: 2, tier: 9 }]);
  });

  it('returning null skips the object silently', () => {
    SceneSerializer.register(Mob, (mob) => (mob.tier > 1 ? { type: 'mob' } : null));
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Mob('weak', 1, 1, 1));
    scene.addObject(new Mob('elite', 2, 2, 5));

    expect(props(scene)).toEqual([{ type: 'mob', id: 'elite', x: 2, y: 2 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a throwing serializer costs one object, not the whole save', () => {
    SceneSerializer.register(Mob, (mob) => {
      if (mob.id === 'bad') throw new Error('boom');
      return { type: 'mob' };
    });
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Mob('bad', 1, 1));
    scene.addObject(new Mob('good', 2, 2));

    expect(props(scene)).toEqual([{ type: 'mob', id: 'good', x: 2, y: 2 }]);
    expect(String(warn.mock.calls[0][0])).toContain('threw');
  });

  it('drops an entry with no type, since it could not be loaded back', () => {
    SceneSerializer.register(Mob, () => ({ tier: 3 }));
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Mob('m', 1, 1));

    expect(props(scene)).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain('`type`');
  });

  it('unregister and clearSerializers take effect', () => {
    SceneSerializer.register(Mob, () => ({ type: 'mob' }));
    expect(SceneSerializer.findSerializer(new Mob('m', 0, 0))).not.toBeNull();

    expect(SceneSerializer.unregister(Mob)).toBe(true);
    expect(SceneSerializer.unregister(Mob)).toBe(false);
    expect(SceneSerializer.findSerializer(new Mob('m', 0, 0))).toBeNull();

    SceneSerializer.register(Mob, () => ({ type: 'mob' }));
    SceneSerializer.clearSerializers();
    expect(SceneSerializer.findSerializer(new Mob('m', 0, 0))).toBeNull();
  });
});

describe('SceneSerializer — built-ins keep priority', () => {
  it('a built-in prop is written by its own branch, not the registry', () => {
    const serialize = vi.fn(() => ({ type: 'loot-chest' }));
    SceneSerializer.register(Chest, serialize);

    const scene = new Scene({ cols: 8, rows: 8 });
    scene.addObject(new Chest('c1', 2, 2, '#8b5a2b'));

    expect(props(scene)).toEqual([{ type: 'chest', id: 'c1', x: 2, y: 2, color: '#8b5a2b' }]);
    expect(serialize).not.toHaveBeenCalled();
  });

  it('transient built-ins are skipped without a warning', () => {
    const scene = new Scene({ cols: 8, rows: 8 });
    scene.spawnFloatingText({ text: '-12', x: 1, y: 1, z: 0 });

    expect(props(scene)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('SceneSerializer — round trip through Engine', () => {
  it('a custom prop survives toJSON -> buildScene', () => {
    Engine.registerProp('mob', (p) => new Mob(p.id, p.x, p.y, p.tier as number));
    SceneSerializer.register(Mob, (mob) => ({ type: 'mob', tier: mob.tier }));

    const original = new Scene({ name: 'Wave 1', cols: 8, rows: 8 });
    original.addObject(new Mob('mob-1', 3, 4, 7));

    const restored = new Engine({ canvas: canvas() }).buildScene(original.toJSON());
    const mobs = restored.getAll(Mob);

    expect(mobs.length).toBe(1);
    expect(mobs[0].id).toBe('mob-1');
    expect(mobs[0].position.x).toBe(3);
    expect(mobs[0].position.y).toBe(4);
    expect(mobs[0].tier).toBe(7);
  });

  it('health round-trips through the engine hook', () => {
    Engine.registerProp('mob', (p) => new Mob(p.id, p.x, p.y));
    SceneSerializer.register(Mob, () => ({ type: 'mob', health: 250 }));

    const original = new Scene({ cols: 8, rows: 8 });
    original.addObject(new Mob('mob-1', 1, 1));

    const restored = new Engine({ canvas: canvas() }).buildScene(original.toJSON());
    const hp = restored.getAll(Mob)[0].getComponent(HealthComponent);

    expect(hp?.maxHp).toBe(250);
  });
});
