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
 * A scoped group of subscriptions released together.
 *
 * The typical lifecycle is a scene that subscribes in `onEnter` and releases in
 * `onExit` — without a bag, every subscription has to be kept around to `off`
 * by hand, and the one that is forgotten keeps firing with a closure over the
 * dead scene. Also usable for any "listen while X holds" span.
 */
export interface EventSubscriptionBag<Events extends object> {
  /** Subscribe through the parent bus; the subscription joins the bag. */
  on<K extends EventKey<Events>>(event: K, handler: Handler<Events[K]>): () => void;
  /** `once` through the parent bus; the subscription joins the bag. */
  once<K extends EventKey<Events>>(event: K, handler: Handler<Events[K]>): () => void;
  /** Unsubscribe everything the bag has collected. Idempotent. */
  release(): void;
  /** Subscriptions still held. A `once` that has fired counts until release. */
  readonly size: number;
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

  /**
   * Create a subscription bag: a scope whose subscriptions release together.
   *
   *   const bag = bus.bag();
   *   bag.on('damage', handler);
   *   bag.release();               // everything unsubscribes, idempotent
   *
   * Subscribing on a released bag is not an error, but the handler unsubscribes
   * immediately and never fires — a closed bag stays closed. The individual
   * handle returned by `bag.on` still works for early removal.
   */
  bag(): EventSubscriptionBag<Events> {
    const subs: Array<() => void> = [];
    let released = false;
    const track = (unsub: () => void): () => void => {
      if (released) {
        unsub();
        return unsub;
      }
      subs.push(unsub);
      return unsub;
    };
    return {
      on: (event, handler) => track(this.on(event, handler)),
      once: (event, handler) => track(this.once(event, handler)),
      release: () => {
        released = true;
        for (const unsub of subs.splice(0)) {unsub();}
      },
      get size() {return subs.length;},
    };
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
