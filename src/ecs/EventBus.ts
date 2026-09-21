/**
 * EventBus — lightweight typed event system for ECS inter-component communication.
 *
 * Components can emit and subscribe to named events without direct references
 * to each other, keeping game logic decoupled from rendering.
 *
 * Usage:
 *   const bus = new EventBus();
 *
 *   // Subscribe
 *   const unsub = bus.on('damage', ({ amount }) => console.log('hit for', amount));
 *
 *   // Emit
 *   bus.emit('damage', { amount: 25 });
 *
 *   // Unsubscribe
 *   unsub();
 *
 * A global singleton is exported as `globalBus` for scene-wide events.
 * Entities can also carry their own local bus for per-object events.
 */

type Handler<T> = (payload: T) => void;
type EventKey<Events extends object> = Extract<keyof Events, string>;
type OpenEventMap = Record<string, unknown>;

/** Minimal typed event sink accepted by components that only emit events. */
export interface EventEmitter<Events extends object> {
  emit<K extends EventKey<Events>>(event: K, payload: Events[K]): void;
}

/**
 * Event bus whose event names and payloads are coupled by an event map.
 * Omit the generic argument for an open bus that accepts arbitrary strings.
 */
export class EventBus<Events extends object = OpenEventMap> implements EventEmitter<Events> {
  private _handlers = new Map<EventKey<Events>, Set<Handler<unknown>>>();

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   */
  on<K extends EventKey<Events>>(event: K, handler: Handler<Events[K]>): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event once — auto-unsubscribes after first call.
   */
  once<K extends EventKey<Events>>(event: K, handler: Handler<Events[K]>): () => void {
    const wrapper: Handler<Events[K]> = payload => {
      handler(payload);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe a specific handler.
   */
  off<K extends EventKey<Events>>(event: K, handler: Handler<Events[K]>): void {
    this._handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  /**
   * Emit an event, calling all registered handlers synchronously.
   */
  emit<K extends EventKey<Events>>(event: K, payload: Events[K]): void {
    const handlers = this._handlers.get(event);
    if (!handlers) {return;}
    for (const h of handlers) {h(payload);}
  }

  /**
   * Remove all handlers for a specific event, or all events if omitted.
   */
  clear(event?: EventKey<Events>): void {
    if (event) {
      this._handlers.delete(event);
    } else {
      this._handlers.clear();
    }
  }

  /** Number of handlers registered for a given event. */
  listenerCount(event: EventKey<Events>): number {
    return this._handlers.get(event)?.size ?? 0;
  }
}

// ── Common event payload types ────────────────────────────────────────────────

export interface DamageEvent {amount: number; targetId?: string; sourceId?: string}
export interface HealEvent {amount: number}
export interface DeathEvent {id: string}
export interface MoveEvent {x: number; y: number; z: number}
export interface ArrivalEvent {id: string; x: number; y: number}
export interface TriggerEvent {triggerId: string; enterId: string}

/** Built-in event contract used by engine components and globalBus. */
export interface LuxIsoEventMap {
  damage: DamageEvent;
  heal: HealEvent;
  death: DeathEvent;
  move: MoveEvent;
  arrival: ArrivalEvent;
  triggerEnter: TriggerEvent;
  triggerExit: TriggerEvent;
}

/** Scene-wide global event bus. Import and use anywhere. */
export const globalBus = new EventBus<LuxIsoEventMap>();
