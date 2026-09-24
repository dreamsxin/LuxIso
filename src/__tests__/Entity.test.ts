import {describe, it, expect} from 'vitest';
import type {Component} from '../ecs/Component';
import type {IsoObject} from '../elements/IsoObject';
import {Crystal} from '../elements/props/Crystal';

class LifecycleComponent implements Component {
  attachedTo: IsoObject | null = null;
  detachCalls = 0;

  onAttach(owner: IsoObject): void {
    this.attachedTo = owner;
  }

  onDetach(): void {
    this.attachedTo = null;
    this.detachCalls++;
  }
}

describe('Entity component lifecycle', () => {
  it('attaches and retrieves components by constructor', () => {
    const entity = new Crystal('gem', 0, 0);
    const component = entity.addComponent(new LifecycleComponent());
    expect(component.attachedTo).toBe(entity);
    expect(entity.getComponent(LifecycleComponent)).toBe(component);
    expect(entity.hasComponent(LifecycleComponent)).toBe(true);
  });

  it('detaches the old component when replacing the same constructor', () => {
    const entity = new Crystal('gem', 0, 0);
    const first = entity.addComponent(new LifecycleComponent());
    const second = entity.addComponent(new LifecycleComponent());
    expect(first.detachCalls).toBe(1);
    expect(first.attachedTo).toBeNull();
    expect(second.attachedTo).toBe(entity);
    expect(entity.getComponent(LifecycleComponent)).toBe(second);
  });

  it('does not reattach the exact same component instance', () => {
    const entity = new Crystal('gem', 0, 0);
    const component = entity.addComponent(new LifecycleComponent());
    entity.addComponent(component);
    expect(component.detachCalls).toBe(0);
    expect(component.attachedTo).toBe(entity);
  });

  it('detaches a removed component', () => {
    const entity = new Crystal('gem', 0, 0);
    const component = entity.addComponent(new LifecycleComponent());
    entity.removeComponent(LifecycleComponent);
    expect(component.detachCalls).toBe(1);
    expect(entity.hasComponent(LifecycleComponent)).toBe(false);
  });
});
