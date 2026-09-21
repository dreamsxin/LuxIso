import {Entity} from './Entity';
import type {ComponentCtor} from './Component';
import type {Scene} from '../core/Scene';

export type {ComponentCtor} from './Component';

/**
 * System — batch-processes all entities that match a component query.
 *
 * While plain Components update themselves one entity at a time, a System
 * receives the full list of matching entities each frame, enabling:
 * - Cross-entity logic (flocking, spatial queries, batch A* dispatch)
 * - Centralised lifecycle handling (e.g. one HealthSystem reaps all dead
 *   entities instead of per-entity callbacks)
 * - A single, explicit place for frame-order-critical logic
 *
 * Register with `scene.addSystem(new MySystem())`. Systems run BEFORE
 * per-entity component updates, ordered by ascending `priority`.
 *
 * @example
 *   class DeathSystem extends System {
 *     readonly query = [HealthComponent];
 *     update(entities: Entity[]): void {
 *       for (const e of entities) {
 *         const hp = e.getComponent(HealthComponent)!;
 *         if (hp.isDead) this.scene?.removeById(e.id);
 *       }
 *     }
 *   }
 *   scene.addSystem(new DeathSystem());
 */
export abstract class System {
  private _scene: Scene | null = null;

  /**
   * Component constructors an entity must have ALL of to be processed.
   * An empty query matches every Entity in the scene.
   */
  abstract readonly query: readonly ComponentCtor[];

  /**
   * Execution order — lower values run first. Default 0.
   * Systems with equal priority run in registration order.
   */
  readonly priority: number = 0;

  /**
   * Called once per frame with all entities matching `query`.
   * @param entities  Snapshot array of matching entities (do not retain).
   * @param dt        Frame delta time in seconds.
   */
  abstract update(entities: Entity[], dt: number): void;

  /**
   * Optional fixed-rate update (default 60 Hz), for physics/AI that must be
   * frame-rate independent. Receives the same matched-entity list.
   */
  fixedUpdate?(entities: Entity[], dt: number): void;

  /** Scene this system is currently registered with. */
  get scene(): Scene | null {
    return this._scene;
  }

  /** Optional lifecycle hook called after registration. */
  onAttach?(scene: Scene): void;

  /** Optional lifecycle hook called after removal. */
  onDetach?(scene: Scene): void;

  /** @internal Scene registration hook. */
  attach(scene: Scene): void {
    if (this._scene && this._scene !== scene) {
      throw new Error('System is already attached to another Scene');
    }
    if (this._scene === scene) {return;}
    this._scene = scene;
    try {
      this.onAttach?.(scene);
    } catch (error) {
      this._scene = null;
      throw error;
    }
  }

  /** @internal Scene removal hook. */
  detach(scene: Scene): void {
    if (this._scene !== scene) {return;}
    this._scene = null;
    this.onDetach?.(scene);
  }

  /** Returns true if the entity has every component in `query`. */
  matches(entity: Entity): boolean {
    return this.query.every(ctor => entity.hasComponent(ctor));
  }
}
