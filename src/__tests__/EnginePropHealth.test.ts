import { describe, it, expect, vi, afterEach } from 'vitest';
import { Engine } from '../core/Engine';
import { Entity } from '../ecs/Entity';
import { IsoObject, type DrawContext } from '../elements/IsoObject';
import { HealthComponent } from '../ecs/components/HealthComponent';
import type { AABB } from '../math/depthSort';

/**
 * `health` on a JSON prop entry.
 *
 * The loader used to inject a `HealthComponent` unconditionally. That is wrong in
 * two ways for the custom props the registry exists to support: a class that
 * creates and caches its own component ends up reading a detached instance while
 * Systems see the injected one, and a prop that is not an `Entity` threw on the
 * unguarded `addComponent`, aborting the whole scene load over one entry.
 */

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 480,
    getContext: () => ({
      clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
      scale: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
    }),
  } as unknown as HTMLCanvasElement;
}

class BareProp extends IsoObject {
  constructor(id: string) { super(id, 1, 1, 0); }
  get aabb(): AABB {
    return { minX: 1, minY: 1, maxX: 2, maxY: 2, baseZ: 0 };
  }
  draw(_dc: DrawContext): void { /* not exercised */ }
}

/** The shape a real custom entity has: it owns its health and caches it. */
class SelfHealingProp extends Entity {
  readonly own: HealthComponent;
  deaths = 0;

  constructor(id: string, max: number, current?: number) {
    super(id, 2, 2, 0);
    this.own = this.addComponent(new HealthComponent({
      max, current, onDeath: () => { this.deaths++; },
    }));
  }

  get aabb(): AABB {
    return { minX: 2, minY: 2, maxX: 3, maxY: 3, baseZ: 0 };
  }
  draw(_dc: DrawContext): void { /* not exercised */ }
}

function build(props: Array<Record<string, unknown>>) {
  const engine = new Engine({ canvas: makeCanvas() });
  return engine.buildScene({ cols: 8, rows: 8, props });
}

afterEach(() => {
  Engine.unregisterProp('bare');
  Engine.unregisterProp('healer');
  vi.restoreAllMocks();
});

describe('Engine — prop health', () => {
  it('adds a HealthComponent to an Entity that has none', () => {
    Engine.registerProp('healer', (json) => new (class extends SelfHealingProp {})(json.id, 1));
    Engine.registerProp('bare', (json) => {
      // An Entity without any component of its own.
      class Plain extends SelfHealingProp {}
      const prop = new Plain(json.id, 1);
      prop.removeComponent(HealthComponent);
      return prop;
    });

    const scene = build([{ id: 'p', type: 'bare', x: 1, y: 1, health: 45 }]);
    const prop = scene.getById('p') as SelfHealingProp;
    const health = prop.getComponent(HealthComponent);
    expect(health).toBeDefined();
    expect(health!.maxHp).toBe(45);
    expect(health!.hp).toBe(45);
  });

  it('keeps a component the prop created itself, and its callbacks', () => {
    Engine.registerProp('healer', (json) => new SelfHealingProp(json.id, 30, 12));

    const scene = build([{ id: 'h', type: 'healer', x: 2, y: 2, health: 40 }]);
    const prop = scene.getById('h') as SelfHealingProp;

    // Same instance the class cached — not a replacement.
    expect(prop.getComponent(HealthComponent)).toBe(prop.own);
    // JSON supplies the maximum; the saved current hp survives.
    expect(prop.own.maxHp).toBe(40);
    expect(prop.own.hp).toBe(12);
    // The prop's own onDeath is still wired.
    prop.own.takeDamage(999);
    expect(prop.deaths).toBe(1);
  });

  it('clamps current hp when the JSON maximum is lower', () => {
    Engine.registerProp('healer', (json) => new SelfHealingProp(json.id, 100, 80));
    const scene = build([{ id: 'h', type: 'healer', x: 2, y: 2, health: 25 }]);
    const prop = scene.getById('h') as SelfHealingProp;
    expect(prop.own.maxHp).toBe(25);
    expect(prop.own.hp).toBe(25);
  });

  it('warns instead of throwing when the prop is not an Entity', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Engine.registerProp('bare', (json) => new BareProp(json.id));

    const scene = build([
      { id: 'b', type: 'bare', x: 1, y: 1, health: 20 },
      { id: 'b2', type: 'bare', x: 3, y: 3 },
    ]);
    // The bad entry no longer aborts the load: both props are present.
    expect(scene.getById('b')).toBeDefined();
    expect(scene.getById('b2')).toBeDefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not an Entity'));
  });

  it('rejects a non-positive or non-numeric health', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Engine.registerProp('healer', (json) => new SelfHealingProp(json.id, 30, 30));

    const scene = build([
      { id: 'zero', type: 'healer', x: 2, y: 2, health: 0 },
      { id: 'neg', type: 'healer', x: 2, y: 2, health: -5 },
      { id: 'text', type: 'healer', x: 2, y: 2, health: 'lots' },
    ]);
    for (const id of ['zero', 'neg', 'text']) {
      const prop = scene.getById(id) as SelfHealingProp;
      expect(prop.own.maxHp).toBe(30);
      expect(prop.own.hp).toBe(30);
    }
    // All three are mistakes: `Validator` already requires health > 0 when the
    // field is present, so 0 gets the same warning instead of passing silently.
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('leaves a prop without a health field alone', () => {
    Engine.registerProp('bare', (json) => new BareProp(json.id));
    const scene = build([{ id: 'b', type: 'bare', x: 1, y: 1 }]);
    expect(scene.getById('b')).toBeInstanceOf(BareProp);
  });
});
