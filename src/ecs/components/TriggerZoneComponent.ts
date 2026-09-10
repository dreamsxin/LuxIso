import { IsoObject } from '../../elements/IsoObject';
import { Component } from '../Component';
import type { EventEmitter, LuxIsoEventMap } from '../EventBus';

type TriggerEventMap = Pick<LuxIsoEventMap, 'triggerEnter' | 'triggerExit'>;

export interface TriggerZoneOptions {
  /**
   * Radius of the trigger zone in world units.
   * The zone is a circle centred on the owner's x/y; z is ignored.
   * Default 0.6.
   */
  radius?: number;
  /** Called when an entity enters the zone. */
  onEnter?: (enterId: string) => void;
  /** Called when an entity exits the zone. */
  onExit?:  (enterId: string) => void;
  /** Optional EventBus — emits 'triggerEnter' / 'triggerExit' events. */
  bus?: EventEmitter<TriggerEventMap>;
  /**
   * List of IsoObjects to test against each frame.
   * Set this after construction, or update it dynamically.
   */
  targets?: IsoObject[];
}

/**
 * TriggerZoneComponent — detects when other objects enter or exit a radius.
 *
 * Attach to any Entity. Each frame it checks `targets` for overlap with the
 * owner's position and fires enter/exit callbacks.
 *
 * @example
 *   const zone = entity.addComponent(new TriggerZoneComponent({
 *     radius: 1.5,
 *     targets: [player],
 *     onEnter: (id) => console.log(id, 'entered zone'),
 *     bus: globalBus,
 *   }));
 *   // Later, update targets:
 *   zone.targets = scene.getAllObjects();
 */
export class TriggerZoneComponent implements Component {
  readonly componentType = 'triggerZone' as const;

  radius:  number;
  targets: IsoObject[];

  private _owner:   IsoObject | null = null;
  // Two pre-allocated Sets swapped each frame to avoid per-frame allocation.
  private _inside = new Set<string>();
  private _next   = new Set<string>();
  private _onEnter: ((id: string) => void) | undefined;
  private _onExit:  ((id: string) => void) | undefined;
  private _bus:     EventEmitter<TriggerEventMap> | null;

  constructor(opts: TriggerZoneOptions = {}) {
    this.radius   = opts.radius  ?? 0.6;
    this.targets  = opts.targets ?? [];
    this._onEnter = opts.onEnter;
    this._onExit  = opts.onExit;
    this._bus     = opts.bus ?? null;
  }

  onAttach(owner: IsoObject): void { this._owner = owner; }
  onDetach(): void                 { this._owner = null; this._inside.clear(); this._next.clear(); }

  /**
   * IDs of objects currently inside the zone.
   *
   * This is the live Set, not a copy — `update()` swaps and clears the two
   * internal Sets to stay allocation-free, so the returned reference is only
   * valid until the next `update()`. Copy it if you need to keep it.
   */
  get insideIds(): ReadonlySet<string> { return this._inside; }

  /** Returns true if the given object is currently inside the zone. */
  contains(id: string): boolean { return this._inside.has(id); }

  /** Update the enter callback after construction. */
  setOnEnter(cb: (id: string) => void): void { this._onEnter = cb; }

  /** Update the exit callback after construction. */
  setOnExit(cb: (id: string) => void): void { this._onExit = cb; }

  update(_ts?: number): void {
    if (!this._owner) return;

    const ox = this._owner.position.x;
    const oy = this._owner.position.y;
    const r  = this.radius;

    // Reuse _next (cleared at end of previous frame) instead of allocating a new Set.
    const nowInside = this._next;

    for (const target of this.targets) {
      if (target === this._owner) continue;
      const dx = target.position.x - ox;
      const dy = target.position.y - oy;
      if (Math.hypot(dx, dy) <= r) {
        nowInside.add(target.id);
      }
    }

    // Enter events
    for (const id of nowInside) {
      if (!this._inside.has(id)) {
        this._onEnter?.(id);
        this._bus?.emit('triggerEnter', { triggerId: this._owner.id, enterId: id });
      }
    }

    // Exit events
    for (const id of this._inside) {
      if (!nowInside.has(id)) {
        this._onExit?.(id);
        this._bus?.emit('triggerExit', { triggerId: this._owner.id, enterId: id });
      }
    }

    // Swap: _inside = current frame; _next is cleared and ready for reuse.
    const prev   = this._inside;
    this._inside = nowInside;
    this._next   = prev;
    this._next.clear();
  }
}
