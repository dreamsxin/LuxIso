import {IsoObject, DrawContext} from '../elements/IsoObject';
import {AABB} from '../math/depthSort';
import {Component, ComponentCtor} from './Component';

/**
 * Entity extends IsoObject with a component map.
 * Subclass Entity instead of IsoObject when you need composable behaviours.
 *
 * Usage:
 *   class Crate extends Entity {
 *     get aabb() { ... }
 *     draw(dc) { ... }
 *   }
 *   const crate = new Crate('crate-1', 3, 4, 0);
 *   crate.addComponent(new HealthComponent(50));
 *   crate.addComponent(new AIComponent(patrolBehavior));
 */
/**
 * Entity — an IsoObject extended with a component map for composable behaviors.
 * Use this as a base for interactive objects like characters, props, and triggers.
 */
export abstract class Entity extends IsoObject {
  private _components = new Map<ComponentCtor, Component>();

  constructor(id: string, x: number, y: number, z: number) {
    super(id, x, y, z);
  }

  // ── Component API ─────────────────────────────────────────────────────────

  addComponent<T extends Component>(component: T): T {
    const ctor = component.constructor as ComponentCtor<T>;
    const previous = this._components.get(ctor);
    if (previous === component) {return component;}
    previous?.onDetach?.();
    this._components.set(ctor, component);
    component.onAttach?.(this);
    return component;
  }

  getComponent<T extends Component>(ctor: ComponentCtor<T>): T | undefined {
    return this._components.get(ctor) as T | undefined;
  }

  hasComponent(ctor: ComponentCtor): boolean {
    return this._components.has(ctor);
  }

  removeComponent(ctor: ComponentCtor): void {
    const comp = this._components.get(ctor);
    if (comp) {
      comp.onDetach?.();
      this._components.delete(ctor);
    }
  }

  get components(): IterableIterator<Component> {
    return this._components.values();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Drive all attached components each frame. Call super.update() from subclasses. */
  update(ts?: number): void {
    for (const comp of this._components.values()) {
      comp.update?.(ts);
    }
  }

  /** Drive fixed-rate component work without exposing the component map to Scene. */
  fixedUpdate(dt: number): void {
    for (const comp of this._components.values()) {
      comp.fixedUpdate?.(dt);
    }
  }

  // Subclasses must still implement aabb and draw
  abstract get aabb(): AABB;
  abstract draw(dc: DrawContext): void;
}
