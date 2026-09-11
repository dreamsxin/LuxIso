import { IsoObject } from '../../elements/IsoObject';
import { Component } from '../Component';
import type { EventEmitter, LuxIsoEventMap } from '../EventBus';

type HealthEventMap = Pick<LuxIsoEventMap, 'damage' | 'death'>;

export interface HealthOptions {
  max: number;
  current?: number;
  /** Called when hp drops to 0. */
  onDeath?: (owner: IsoObject) => void;
  /** Called on any hp change. */
  onChange?: (current: number, max: number, owner: IsoObject) => void;
  /**
   * Optional EventBus — when provided, takeDamage() emits a 'damage' event
   * and death emits a 'death' event so external systems can react without
   * coupling directly to the component instance.
   */
  bus?: EventEmitter<HealthEventMap>;
}

/**
 * Built-in health component.
 * Attach to any Entity to give it HP, damage, and healing logic.
 *
 * @example
 * entity.addComponent(new HealthComponent({ max: 100, onDeath: (e) => scene.removeById(e.id) }));
 * entity.getComponent(HealthComponent)?.takeDamage(25);
 */
export class HealthComponent implements Component {
  readonly componentType = 'health' as const;

  private _max: number;
  private _current: number;
  private _owner: IsoObject | null = null;
  private _bus: EventEmitter<HealthEventMap> | null;

  /**
   * Called when hp drops to 0.
   * Set via constructor options or assigned directly after construction.
   * Only one path exists — no private duplicate — so death fires exactly once.
   */
  onDeath?: (owner: IsoObject) => void;

  /**
   * Called on any hp change (damage or heal).
   * Set via constructor options or assigned directly after construction.
   */
  onChange?: (current: number, max: number, owner: IsoObject) => void;

  constructor(opts: HealthOptions) {
    this._max = opts.max;
    this._current = opts.current ?? opts.max;
    // Assign constructor callbacks directly to the public fields.
    // This eliminates the private _onDeathCb / _onChangeCb duplicates that
    // previously caused double-firing when both paths were set.
    this.onDeath  = opts.onDeath;
    this.onChange = opts.onChange;
    this._bus     = opts.bus ?? null;
  }

  onAttach(owner: IsoObject): void {
    this._owner = owner;
  }

  onDetach(): void {
    this._owner = null;
  }

  // No per-frame logic needed; update is a no-op
  update(_ts?: number): void {}

  // ── Stats ─────────────────────────────────────────────────────────────────

  get hp(): number { return this._current; }
  get maxHp(): number { return this._max; }
  get fraction(): number { return this._current / this._max; }
  get isDead(): boolean { return this._current <= 0; }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Apply damage. Negative amounts are treated as 0 rather than as healing —
   * a sign error in a damage formula used to push hp above `max` through this
   * path, bypassing the clamp `heal()` applies.
   */
  takeDamage(amount: number, sourceId?: string): void {
    if (this.isDead) return;
    const damage = Math.max(0, amount);
    this._current = Math.max(0, this._current - damage);
    // Emit damage event before callbacks so bus listeners see the correct hp.
    this._bus?.emit('damage', {
      amount: damage,
      targetId: this._owner?.id,
      sourceId,
    });
    this._notify();
    if (this._current === 0 && this._owner) {
      this._bus?.emit('death', { id: this._owner.id });
      this.onDeath?.(this._owner);
    }
  }

  /**
   * Restore hp, clamped to `max`. Negative amounts are treated as 0: this path
   * has no death handling, so a negative heal used to drive hp below zero with
   * no `death` event and no `onDeath` callback. Use `takeDamage()` to hurt.
   */
  heal(amount: number): void {
    if (this.isDead) return;
    this._current = Math.min(this._max, this._current + Math.max(0, amount));
    this._notify();
  }

  /**
   * Change the maximum hp. A non-positive `max` is ignored: `fraction` would
   * become Infinity or NaN, and current hp would be forced to 0, leaving the
   * entity reading as dead without any death event ever firing.
   */
  setMax(max: number, scaleCurrentHp = false): void {
    if (!(max > 0)) return;
    const ratio = scaleCurrentHp ? this._current / this._max : 1;
    this._max = max;
    this._current = scaleCurrentHp ? Math.round(max * ratio) : Math.min(this._current, max);
    this._notify();
  }

  /**
   * Set current hp directly, without firing damage, heal or death notifications.
   *
   * For loaders and editors restoring saved state. `takeDamage()` would announce
   * a hit that never happened and could trip `onDeath` in the middle of a scene
   * load, while `heal()` refuses to touch an entity that is already dead — so
   * neither can express "this unit was at 12 of 40 when the game was saved".
   *
   * Restoring 0 leaves the entity reading as dead with no death event, which is
   * the point: the death already happened before the save.
   */
  restore(hp: number): void {
    if (!Number.isFinite(hp)) return;
    this._current = Math.max(0, Math.min(this._max, hp));
  }

  private _notify(): void {
    if (this._owner) {
      this.onChange?.(this._current, this._max, this._owner);
    }
  }
}
