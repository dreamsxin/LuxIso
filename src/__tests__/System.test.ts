import {describe, it, expect} from 'vitest';
import {Scene} from '../core/Scene';
import {System} from '../ecs/System';
import type {Component} from '../ecs/Component';
import type {Entity} from '../ecs/Entity';
import {HealthComponent} from '../ecs/components/HealthComponent';
import {Crystal} from '../elements/props/Crystal';
import {Boulder} from '../elements/props/Boulder';
import {Floor} from '../elements/Floor';

class HealthSystem extends System {
  readonly query = [HealthComponent] as const;
  updates: string[][] = [];
  fixedUpdates: string[][] = [];
  attached = 0;
  detached = 0;

  constructor(override readonly priority = 0) {
    super();
  }

  update(entities: Entity[]): void {
    this.updates.push(entities.map(entity => entity.id));
  }

  fixedUpdate(entities: Entity[]): void {
    this.fixedUpdates.push(entities.map(entity => entity.id));
  }

  override onAttach(): void {
    this.attached++;
  }

  override onDetach(): void {
    this.detached++;
  }
}

class ProbeComponent implements Component {
  updateCalls = 0;
  fixedDeltas: number[] = [];

  update(): void {
    this.updateCalls++;
  }

  fixedUpdate(dt: number): void {
    this.fixedDeltas.push(dt);
  }
}

class ProbeSystem extends System {
  readonly query = [ProbeComponent] as const;
  updateCalls = 0;
  fixedDeltas: number[] = [];

  update(): void {
    this.updateCalls++;
  }

  fixedUpdate(_entities: Entity[], dt: number): void {
    this.fixedDeltas.push(dt);
  }
}

describe('Scene ECS Systems', () => {
  it('matches visible entities with every queried component', () => {
    const scene = new Scene();
    const healthy = new Crystal('healthy', 1, 1);
    healthy.addComponent(new HealthComponent({max: 10}));
    const plain = new Boulder('plain', 2, 2);
    const hidden = new Crystal('hidden', 3, 3);
    hidden.addComponent(new HealthComponent({max: 10}));
    hidden.visible = false;
    scene.addObject(healthy);
    scene.addObject(plain);
    scene.addObject(hidden);
    scene.addObject(new Floor({id: 'floor', cols: 2, rows: 2}));

    const system = scene.addSystem(new HealthSystem());
    scene.update(1000);

    expect(system.updates).toEqual([['healthy']]);
  });

  it('refreshes matches after runtime component changes', () => {
    const scene = new Scene();
    const entity = new Crystal('gem', 1, 1);
    scene.addObject(entity);
    const system = scene.addSystem(new HealthSystem());

    scene.update(1000);
    entity.addComponent(new HealthComponent({max: 10}));
    scene.update(1016);
    entity.removeComponent(HealthComponent);
    scene.update(1032);

    expect(system.updates).toEqual([[], ['gem'], []]);
  });

  it('orders systems by priority and preserves registration order for ties', () => {
    const scene = new Scene();
    const calls: string[] = [];

    class OrderedSystem extends System {
      readonly query = [];
      constructor(private label: string, override readonly priority: number) { super(); }
      update(): void { calls.push(this.label); }
    }

    scene.addSystem(new OrderedSystem('late', 10));
    scene.addSystem(new OrderedSystem('first-a', -5));
    scene.addSystem(new OrderedSystem('first-b', -5));
    scene.update(1000);

    expect(calls).toEqual(['first-a', 'first-b', 'late']);
  });

  it('runs system and component fixed updates', () => {
    const scene = new Scene();
    const entity = new Crystal('gem', 1, 1);
    const component = entity.addComponent(new ProbeComponent());
    const system = scene.addSystem(new ProbeSystem());
    scene.addObject(entity);

    scene.fixedUpdate(1 / 30);

    expect(system.fixedDeltas).toEqual([1 / 30]);
    expect(component.fixedDeltas).toEqual([1 / 30]);
  });

  it('attaches once, supports lookup, and detaches on removal', () => {
    const scene = new Scene();
    const system = new HealthSystem();

    expect(scene.addSystem(system)).toBe(system);
    expect(scene.addSystem(system)).toBe(system);
    expect(scene.getSystem(HealthSystem)).toBe(system);
    expect(system.scene).toBe(scene);
    expect(system.attached).toBe(1);
    expect(scene.removeSystem(system)).toBe(true);
    expect(scene.removeSystem(system)).toBe(false);
    expect(system.scene).toBeNull();
    expect(system.detached).toBe(1);
  });

  it('prevents one System instance from attaching to two scenes', () => {
    const system = new HealthSystem();
    new Scene().addSystem(system);
    expect(() => new Scene().addSystem(system)).toThrow(/another Scene/);
  });

  it('rolls back attachment state when onAttach throws', () => {
    class FailingSystem extends HealthSystem {
      override onAttach(): void {
        throw new Error('attach failed');
      }
    }
    const system = new FailingSystem();
    expect(() => new Scene().addSystem(system)).toThrow('attach failed');
    expect(system.scene).toBeNull();
  });

  it('keeps per-entity component updates working alongside Systems', () => {
    const scene = new Scene();
    const entity = new Crystal('gem', 1, 1);
    const component = entity.addComponent(new ProbeComponent());
    const system = scene.addSystem(new ProbeSystem());
    scene.addObject(entity);

    scene.update(1000);

    expect(system.updateCalls).toBe(1);
    expect(component.updateCalls).toBe(1);
  });
});
