/**
 * InputMap — action-based input abstraction layer over InputManager.
 *
 * Decouples game logic from raw key/button names. Define named actions
 * and bind multiple keys (or gamepad buttons) to each one.
 *
 * @example
 *   const map = new InputMap(input);
 *
 *   map.define('move_up',    ['ArrowUp',    'w', 'KeyW']);
 *   map.define('move_down',  ['ArrowDown',  's', 'KeyS']);
 *   map.define('move_left',  ['ArrowLeft',  'a', 'KeyA']);
 *   map.define('move_right', ['ArrowRight', 'd', 'KeyD']);
 *   map.define('attack',     ['Space', 'Enter']);
 *   map.define('debug',      ['F1']);
 *
 *   // In game loop:
 *   if (map.isDown('move_up'))    player.y -= speed * dt;
 *   if (map.wasPressed('attack')) player.attack();
 *
 *   // Get movement as a normalised vector:
 *   const { x, y } = map.axis('move_right', 'move_left', 'move_down', 'move_up');
 *
 *   // Subscribe to action events:
 *   map.on('debug', () => debugRenderer.enabled = !debugRenderer.enabled);
 *
 *   // Rebind at runtime (e.g. from settings screen):
 *   map.rebind('attack', ['MouseLeft', 'Space']);
 */
import { InputManager } from './InputManager';

type ActionCallback = () => void;

export class InputMap {
  private _input: InputManager;
  /** action → set of key strings */
  private _bindings = new Map<string, Set<string>>();
  /** action → InputManager unsubscribe functions, so remove() can detach them */
  private _unsubscribes = new Map<string, Set<() => void>>();

  constructor(input: InputManager) {
    this._input = input;
  }

  // ── Action definition ──────────────────────────────────────────────────────

  /**
   * Define (or overwrite) an action with a list of key bindings.
   * Keys can be `KeyboardEvent.key` values ('ArrowUp', 'w', ' ')
   * or `KeyboardEvent.code` values ('KeyW', 'Space').
   *
   * Re-defining an action detaches its previous keys from the underlying
   * InputManager. Without that, an overwritten binding stayed live there: the
   * local map reported the new keys while the old ones still triggered the
   * action.
   */
  define(action: string, keys: string[]): this {
    const previous = this._bindings.get(action);
    if (previous) {
      for (const k of previous) this._input.unbindKey(k, action);
    }
    this._bindings.set(action, new Set(keys));
    // Mirror into InputManager's action system for callback support
    for (const k of keys) this._input.bindKey(k, action);
    return this;
  }

  /**
   * Add extra keys to an existing action without replacing current bindings.
   */
  addBinding(action: string, keys: string[]): this {
    if (!this._bindings.has(action)) this._bindings.set(action, new Set());
    const set = this._bindings.get(action)!;
    for (const k of keys) {
      set.add(k);
      this._input.bindKey(k, action);
    }
    return this;
  }

  /**
   * Replace all bindings for an action (useful for settings screens).
   * Alias of `define`, which already performs the detach.
   */
  rebind(action: string, keys: string[]): this {
    return this.define(action, keys);
  }

  /** Remove an action entirely, including any subscribed callbacks. */
  remove(action: string): void {
    const keys = this._bindings.get(action);
    if (keys) for (const k of keys) this._input.unbindKey(k, action);
    this._bindings.delete(action);
    const unsubscribes = this._unsubscribes.get(action);
    if (unsubscribes) {
      for (const off of unsubscribes) off();
      this._unsubscribes.delete(action);
    }
  }

  /** Returns the current key bindings for an action. */
  getBindings(action: string): string[] {
    return [...(this._bindings.get(action) ?? [])];
  }

  // ── Polling API ────────────────────────────────────────────────────────────

  /** True while any key bound to `action` is held. */
  isDown(action: string): boolean {
    return this._input.isAction(action);
  }

  /** True on the first frame any key bound to `action` was pressed. */
  wasPressed(action: string): boolean {
    return this._input.wasAction(action);
  }

  /**
   * Returns a normalised 2D axis vector from four directional actions.
   * Diagonal inputs are normalised to length 1.
   *
   * @example
   *   const { x, y } = map.axis('move_right', 'move_left', 'move_down', 'move_up');
   *   player.x += x * speed * dt;
   *   player.y += y * speed * dt;
   */
  axis(
    positiveX: string,
    negativeX: string,
    positiveY: string,
    negativeY: string,
  ): { x: number; y: number } {
    let x = 0, y = 0;
    if (this.isDown(positiveX)) x += 1;
    if (this.isDown(negativeX)) x -= 1;
    if (this.isDown(positiveY)) y += 1;
    if (this.isDown(negativeY)) y -= 1;

    // Normalise diagonal
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  // ── Event API ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to an action press event.
   * Returns an unsubscribe function, which is idempotent.
   */
  on(action: string, cb: ActionCallback): () => void {
    const off = this._input.onAction(action, cb);
    if (!this._unsubscribes.has(action)) this._unsubscribes.set(action, new Set());
    const set = this._unsubscribes.get(action)!;
    // Track the detach function rather than the callback itself: the previous
    // version kept a set of callbacks that nothing ever read, so `remove()`
    // dropped that bookkeeping while leaving the listener live in InputManager.
    const wrapped = (): void => {
      if (!set.delete(wrapped)) return;
      off();
    };
    set.add(wrapped);
    return wrapped;
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Export current bindings as a plain object (for saving to localStorage).
   */
  toJSON(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [action, keys] of this._bindings) {
      out[action] = [...keys];
    }
    return out;
  }

  /**
   * Import bindings from a plain object (e.g. loaded from localStorage).
   * Existing bindings are replaced.
   */
  fromJSON(data: Record<string, string[]>): void {
    for (const [action, keys] of Object.entries(data)) {
      this.rebind(action, keys);
    }
  }
}
