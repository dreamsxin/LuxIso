/**
 * InputManager — unified keyboard, mouse, and touch input abstraction.
 *
 * Attach to a canvas element and query input state each frame, or subscribe
 * to action callbacks. Handles key repeat, pointer position, and multi-touch.
 *
 * `pointer` is the single *primary* pointer: the mouse, or the first finger
 * that touched down. Additional fingers are tracked in `touches` and do not
 * disturb it — releasing a secondary finger leaves the pointer held, and
 * releasing the primary one promotes the oldest survivor rather than reporting
 * a release. Mouse buttons register as the bindable keys `MouseLeft`,
 * `MouseMiddle` and `MouseRight`.
 *
 * @example
 *   const input = new InputManager(canvas);
 *
 *   // Poll in game loop
 *   engine.start((ts) => {
 *     if (input.isDown('ArrowRight')) player.position.x += 0.1;
 *     if (input.wasPressed('Space'))  player.jump();
 *   });
 *
 *   // Or subscribe to actions
 *   input.onAction('attack', () => player.attack());
 *   input.bindKey('Space', 'attack');
 *   input.bindKey('MouseLeft', 'attack');
 *
 *   // Two-thumb layouts read the raw touch list
 *   for (const t of input.touches) drawThumbRing(t.x, t.y);
 *
 *   // Clean up
 *   input.destroy();
 */

export interface PointerState {
  /** Canvas-space X (accounts for CSS scaling). */
  x: number;
  /** Canvas-space Y (accounts for CSS scaling). */
  y: number;
  /** True while any mouse button / touch is held. */
  down: boolean;
  /** True on the frame the pointer was pressed. */
  pressed: boolean;
  /** True on the frame the pointer was released. */
  released: boolean;
}

/** One active touch point, in canvas space. */
export interface TouchPoint {
  /** `Touch.identifier` — stable for the life of the contact. */
  id: number;
  x: number;
  y: number;
}

export interface InputManagerOptions {
  /**
   * Call `preventDefault()` on canvas touch events. Default true: without it a
   * mobile browser scrolls the page, double-tap-zooms, fires the legacy 300 ms
   * click delay and pops the long-press menu on top of the game. Set false if
   * the canvas is embedded in a scrollable document.
   */
  preventTouchDefault?: boolean;
}

/** `MouseEvent.button` index → bindable key name. */
const MOUSE_BUTTON_KEYS = ['MouseLeft', 'MouseMiddle', 'MouseRight'] as const;

export class InputManager {
  private _canvas: HTMLCanvasElement;
  private _preventTouchDefault: boolean;

  // Keyboard state
  private _held     = new Set<string>();
  private _pressed  = new Set<string>();
  private _released = new Set<string>();

  // Pointer state
  readonly pointer: PointerState = { x: 0, y: 0, down: false, pressed: false, released: false };
  private _pointerPressedThisFrame  = false;
  private _pointerReleasedThisFrame = false;

  // Active touches, in the order they touched down.
  private _touches = new Map<number, TouchPoint>();
  private _primaryTouchId: number | null = null;

  // Action bindings: actionName → set of keys
  private _bindings = new Map<string, Set<string>>();
  // Action callbacks
  private _callbacks = new Map<string, Set<() => void>>();

  // Bound listeners (for cleanup)
  private _listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(canvas: HTMLCanvasElement, opts: InputManagerOptions = {}) {
    this._canvas = canvas;
    this._preventTouchDefault = opts.preventTouchDefault ?? true;
    this._attach();
  }


  // ── Keyboard queries ──────────────────────────────────────────────────────

  /** True while the key is held down. Key = KeyboardEvent.key or .code. */
  isDown(key: string): boolean { return this._held.has(key); }

  /** True on the first frame the key was pressed. Cleared after `flush()`. */
  wasPressed(key: string): boolean { return this._pressed.has(key); }

  /** True on the first frame the key was released. Cleared after `flush()`. */
  wasReleased(key: string): boolean { return this._released.has(key); }

  // ── Action system ─────────────────────────────────────────────────────────

  /**
   * Bind a key to a named action.
   * Multiple keys can map to the same action.
   */
  bindKey(key: string, action: string): void {
    if (!this._bindings.has(action)) this._bindings.set(action, new Set());
    this._bindings.get(action)!.add(key);
  }

  /** Remove a key binding. */
  unbindKey(key: string, action: string): void {
    this._bindings.get(action)?.delete(key);
  }

  /** True while any key bound to `action` is held. */
  isAction(action: string): boolean {
    const keys = this._bindings.get(action);
    if (!keys) return false;
    for (const k of keys) if (this._held.has(k)) return true;
    return false;
  }

  /** True on the first frame any key bound to `action` was pressed. */
  wasAction(action: string): boolean {
    const keys = this._bindings.get(action);
    if (!keys) return false;
    for (const k of keys) if (this._pressed.has(k)) return true;
    return false;
  }

  /**
   * Subscribe to an action — callback fires on the frame the action is pressed.
   * Returns an unsubscribe function.
   */
  onAction(action: string, cb: () => void): () => void {
    if (!this._callbacks.has(action)) this._callbacks.set(action, new Set());
    this._callbacks.get(action)!.add(cb);
    return () => this._callbacks.get(action)?.delete(cb);
  }

  // ── Pointer queries ───────────────────────────────────────────────────────

  /** Canvas-space pointer position (corrected for CSS scaling). */
  get pointerX(): number { return this.pointer.x; }
  get pointerY(): number { return this.pointer.y; }

  /**
   * All active touch points, oldest first. Empty on a mouse-driven session.
   * `touches[0]` is the primary contact that drives `pointer`.
   */
  get touches(): readonly TouchPoint[] { return [...this._touches.values()]; }

  /** Number of fingers currently on the screen. */
  get touchCount(): number { return this._touches.size; }

  /** A specific contact by `Touch.identifier`, or null once it lifts. */
  getTouch(id: number): TouchPoint | null { return this._touches.get(id) ?? null; }


  // ── Frame lifecycle ───────────────────────────────────────────────────────

  /**
   * Call once per frame AFTER processing input (typically at the end of
   * your postFrame callback). Clears single-frame pressed/released sets.
   */
  flush(): void {
    // Fire action callbacks for pressed actions
    for (const [action, keys] of this._bindings) {
      for (const k of keys) {
        if (this._pressed.has(k)) {
          const cbs = this._callbacks.get(action);
          if (cbs) for (const cb of cbs) cb();
          break;
        }
      }
    }

    this._pressed.clear();
    this._released.clear();
    this.pointer.pressed  = false;
    this.pointer.released = false;
    this._pointerPressedThisFrame  = false;
    this._pointerReleasedThisFrame = false;
  }

  /** Remove all event listeners. Call when the game is destroyed. */
  destroy(): void {
    for (const [target, type, listener] of this._listeners) {
      target.removeEventListener(type, listener);
    }
    this._listeners = [];
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _attach(): void {
    const add = (
      target: EventTarget,
      type: string,
      fn: EventListener,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push([target, type, fn]);
    };

    // Keyboard
    add(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (!this._held.has(ev.key))  this._pressed.add(ev.key);
      if (!this._held.has(ev.code)) this._pressed.add(ev.code);
      this._held.add(ev.key);
      this._held.add(ev.code);
    });

    add(window, 'keyup', (e) => {
      const ev = e as KeyboardEvent;
      this._released.add(ev.key);
      this._released.add(ev.code);
      this._held.delete(ev.key);
      this._held.delete(ev.code);
    });

    // Losing focus never delivers keyup, so held keys would stay held: alt-tab
    // while walking and the character keeps walking on return. Same for a
    // backgrounded tab, which also swallows touchend.
    add(window, 'blur', () => this._releaseAll());
    if (typeof document !== 'undefined') {
      add(document, 'visibilitychange', () => {
        if (document.hidden) this._releaseAll();
      });
    }

    // Mouse
    add(this._canvas, 'mousemove', (e) => {
      const { x, y } = this._canvasPos(e as MouseEvent);
      this.pointer.x = x; this.pointer.y = y;
    });

    add(this._canvas, 'mousedown', (e) => {
      const ev = e as MouseEvent;
      const { x, y } = this._canvasPos(ev);
      this.pointer.x = x; this.pointer.y = y;
      this.pointer.down = true;
      if (!this._pointerPressedThisFrame) {
        this.pointer.pressed = true;
        this._pointerPressedThisFrame = true;
      }
      this._pressKey(MOUSE_BUTTON_KEYS[ev.button]);
    });

    // On window, not the canvas: releasing outside the canvas after a drag that
    // started inside would otherwise never arrive and the pointer would stay
    // stuck down for the rest of the session.
    add(window, 'mouseup', (e) => {
      this._releaseKey(MOUSE_BUTTON_KEYS[(e as MouseEvent).button]);
      if (!this.pointer.down) return;
      this.pointer.down = false;
      if (!this._pointerReleasedThisFrame) {
        this.pointer.released = true;
        this._pointerReleasedThisFrame = true;
      }
    });

    // Touch. Every handler walks `changedTouches` — the fingers this event is
    // actually about — and keeps `_touches` as the full picture.
    const touchOpts: AddEventListenerOptions | undefined =
      this._preventTouchDefault ? { passive: false } : undefined;

    add(this._canvas, 'touchstart', (e) => {
      const ev = e as TouchEvent;
      if (this._preventTouchDefault) ev.preventDefault();
      for (const t of Array.from(ev.changedTouches)) {
        const { x, y } = this._canvasPosTouch(t);
        this._touches.set(t.identifier, { id: t.identifier, x, y });
        // Only the first contact moves the pointer. Without this guard a second
        // finger anywhere on screen forged a fresh press every time it landed.
        if (this._primaryTouchId === null) {
          this._primaryTouchId = t.identifier;
          this.pointer.x = x; this.pointer.y = y;
          this.pointer.down = true;
          if (!this._pointerPressedThisFrame) {
            this.pointer.pressed = true;
            this._pointerPressedThisFrame = true;
          }
        }
      }
    }, touchOpts);

    add(this._canvas, 'touchmove', (e) => {
      const ev = e as TouchEvent;
      if (this._preventTouchDefault) ev.preventDefault();
      for (const t of Array.from(ev.changedTouches)) {
        const { x, y } = this._canvasPosTouch(t);
        const known = this._touches.get(t.identifier);
        if (known) { known.x = x; known.y = y; }
        if (this._primaryTouchId === t.identifier) {
          this.pointer.x = x; this.pointer.y = y;
        }
      }
    }, touchOpts);

    const endTouches = (e: Event) => {
      const ev = e as TouchEvent;
      for (const t of Array.from(ev.changedTouches)) {
        this._touches.delete(t.identifier);
        if (this._primaryTouchId === t.identifier) this._primaryTouchId = null;
      }
      if (this._primaryTouchId !== null) return;

      // Promote the oldest survivor. Reporting a release here — which is what
      // the old unconditional `down = false` did — told the game the player had
      // let go while a finger was still on the screen.
      const next = this._touches.values().next();
      if (!next.done) {
        this._primaryTouchId = next.value.id;
        this.pointer.x = next.value.x;
        this.pointer.y = next.value.y;
        return;
      }
      this.pointer.down = false;
      if (!this._pointerReleasedThisFrame) {
        this.pointer.released = true;
        this._pointerReleasedThisFrame = true;
      }
    };

    add(this._canvas, 'touchend', endTouches, touchOpts);
    add(this._canvas, 'touchcancel', endTouches, touchOpts);
  }

  /** Register a synthetic key (mouse button) as pressed this frame. */
  private _pressKey(key: string | undefined): void {
    if (!key) return;
    if (!this._held.has(key)) this._pressed.add(key);
    this._held.add(key);
  }

  private _releaseKey(key: string | undefined): void {
    if (!key || !this._held.has(key)) return;
    this._held.delete(key);
    this._released.add(key);
  }

  /** Drop every held key and contact, as if the player let go of everything. */
  private _releaseAll(): void {
    for (const key of this._held) this._released.add(key);
    this._held.clear();
    this._touches.clear();
    this._primaryTouchId = null;
    if (!this.pointer.down) return;
    this.pointer.down = false;
    if (!this._pointerReleasedThisFrame) {
      this.pointer.released = true;
      this._pointerReleasedThisFrame = true;
    }
  }


  private _canvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this._canvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (this._canvas.height / rect.height),
    };
  }

  private _canvasPosTouch(t: Touch): { x: number; y: number } {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (t.clientX - rect.left) * (this._canvas.width  / rect.width),
      y: (t.clientY - rect.top)  * (this._canvas.height / rect.height),
    };
  }
}
