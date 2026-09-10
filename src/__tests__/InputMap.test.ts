import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager } from '../core/InputManager';
import { InputMap } from '../core/InputMap';

/**
 * InputMap mirrors its bindings into InputManager, so these tests drive the real
 * InputManager (with a stubbed canvas/window) rather than a fake. The defects
 * fixed here were precisely in that mirroring: an overwritten action left its old
 * keys live, and `remove()` never detached subscribed callbacks.
 */

let input: InputManager;
let map: InputMap;
let keydown: (ev: { type: string; key: string; code: string; preventDefault?: () => void }) => void;

beforeEach(() => {
  const winListeners: Record<string, ((ev: unknown) => void)[]> = {};

  const canvas = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;

  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      (winListeners[type] ??= []).push(cb);
    },
    removeEventListener: () => {},
  };

  input = new InputManager(canvas);
  map = new InputMap(input);
  keydown = (ev) => {
    for (const cb of winListeners['keydown'] ?? []) cb({ preventDefault: () => {}, ...ev });
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('InputMap — binding lifecycle', () => {
  it('reports the keys it was defined with', () => {
    map.define('attack', ['Space', 'Enter']);
    expect(map.getBindings('attack').sort()).toEqual(['Enter', 'Space']);
  });

  it('deduplicates repeated keys', () => {
    map.define('attack', ['Space', 'Space']);
    expect(map.getBindings('attack')).toEqual(['Space']);
  });

  it('returns an empty list for an unknown action', () => {
    expect(map.getBindings('nope')).toEqual([]);
  });

  it('detaches the previous keys when an action is re-defined', () => {
    map.define('attack', ['Space']);
    map.define('attack', ['Enter']);

    expect(map.getBindings('attack')).toEqual(['Enter']);
    // The old key must no longer trigger the action. It used to stay bound
    // inside InputManager, so `Space` still fired an action the map no longer
    // listed.
    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    expect(map.isDown('attack')).toBe(false);

    keydown({ type: 'keydown', key: 'Enter', code: 'Enter' });
    expect(map.isDown('attack')).toBe(true);
  });

  it('addBinding keeps existing keys', () => {
    map.define('attack', ['Space']);
    map.addBinding('attack', ['Enter']);
    expect(map.getBindings('attack').sort()).toEqual(['Enter', 'Space']);

    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    expect(map.isDown('attack')).toBe(true);
  });

  it('addBinding creates the action when it does not exist yet', () => {
    map.addBinding('jump', ['KeyJ']);
    expect(map.getBindings('jump')).toEqual(['KeyJ']);
  });

  it('rebind replaces the binding set', () => {
    map.define('attack', ['Space']);
    map.rebind('attack', ['KeyF', 'KeyG']);
    expect(map.getBindings('attack').sort()).toEqual(['KeyF', 'KeyG']);

    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    expect(map.isDown('attack')).toBe(false);
  });

  it('remove detaches the action entirely', () => {
    map.define('attack', ['Space']);
    map.remove('attack');

    expect(map.getBindings('attack')).toEqual([]);
    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    expect(map.isDown('attack')).toBe(false);
  });
});

describe('InputMap — polling', () => {
  it('isDown and wasPressed follow the underlying key state', () => {
    map.define('attack', ['Space']);
    expect(map.isDown('attack')).toBe(false);
    expect(map.wasPressed('attack')).toBe(false);

    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    expect(map.isDown('attack')).toBe(true);
    expect(map.wasPressed('attack')).toBe(true);

    input.flush();
    expect(map.isDown('attack')).toBe(true);      // still held
    expect(map.wasPressed('attack')).toBe(false); // edge consumed
  });

  it('returns false for actions that were never defined', () => {
    expect(map.isDown('ghost')).toBe(false);
    expect(map.wasPressed('ghost')).toBe(false);
  });
});

describe('InputMap — axis', () => {
  beforeEach(() => {
    map.define('right', ['KeyD']);
    map.define('left',  ['KeyA']);
    map.define('down',  ['KeyS']);
    map.define('up',    ['KeyW']);
  });

  const axis = (): { x: number; y: number } => map.axis('right', 'left', 'down', 'up');

  it('is zero with nothing held', () => {
    expect(axis()).toEqual({ x: 0, y: 0 });
  });

  it('is unit length on a cardinal direction', () => {
    keydown({ type: 'keydown', key: 'd', code: 'KeyD' });
    expect(axis()).toEqual({ x: 1, y: 0 });
  });

  it('normalises a diagonal to length 1', () => {
    keydown({ type: 'keydown', key: 'd', code: 'KeyD' });
    keydown({ type: 'keydown', key: 's', code: 'KeyS' });
    const { x, y } = axis();
    expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
    expect(x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('cancels opposing directions out', () => {
    keydown({ type: 'keydown', key: 'd', code: 'KeyD' });
    keydown({ type: 'keydown', key: 'a', code: 'KeyA' });
    expect(axis()).toEqual({ x: 0, y: 0 });
  });

  // ── Analog sources ───────────────────────────────────────────────────────
  // Before these existed the action layer could only express ±1, so an
  // on-screen stick's partial deflection had nowhere to go.

  const source = (x: number, y: number, active = true) => ({ value: { x, y }, active });

  it('passes an analog source through unchanged', () => {
    map.addAxisSource(source(0.37, -0.12));
    const { x, y } = axis();
    expect(x).toBeCloseTo(0.37, 6);
    expect(y).toBeCloseTo(-0.12, 6);
  });

  it('skips inactive sources', () => {
    map.addAxisSource(source(1, 1, false));
    expect(axis()).toEqual({ x: 0, y: 0 });
  });

  it('sums multiple sources', () => {
    map.addAxisSource(source(0.2, 0));
    map.addAxisSource(source(0.3, 0));
    expect(axis().x).toBeCloseTo(0.5, 6);
  });

  it('clamps the combined vector to length 1', () => {
    map.addAxisSource(source(0.9, 0.9));
    map.addAxisSource(source(0.9, 0.9));
    const { x, y } = axis();
    expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
  });

  it('gives no extra speed for holding a key and pushing a stick', () => {
    keydown({ type: 'keydown', key: 'd', code: 'KeyD' });
    map.addAxisSource(source(1, 0));
    expect(axis().x).toBeCloseTo(1, 6);
  });

  it('leaves the keyboard-only result untouched', () => {
    map.addAxisSource(source(0, 0, false));
    keydown({ type: 'keydown', key: 'd', code: 'KeyD' });
    keydown({ type: 'keydown', key: 's', code: 'KeyS' });
    const { x, y } = axis();
    expect(x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('the returned detach removes the source', () => {
    const off = map.addAxisSource(source(0.5, 0));
    expect(axis().x).toBeCloseTo(0.5, 6);
    off();
    expect(axis()).toEqual({ x: 0, y: 0 });
    expect(map.axisSources.length).toBe(0);
  });

  it('registering the same source twice counts once', () => {
    const s = source(0.4, 0);
    map.addAxisSource(s);
    map.addAxisSource(s);
    expect(map.axisSources.length).toBe(1);
    expect(axis().x).toBeCloseTo(0.4, 6);
  });

  it('clearAxisSources drops everything', () => {
    map.addAxisSource(source(1, 0));
    map.clearAxisSources();
    expect(axis()).toEqual({ x: 0, y: 0 });
  });
});


describe('InputMap — callbacks', () => {
  it('fires a subscribed callback on press', () => {
    const seen = vi.fn();
    map.define('attack', ['Space']);
    map.on('attack', seen);

    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    input.flush();

    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('stops firing after the returned unsubscribe, which is idempotent', () => {
    const seen = vi.fn();
    map.define('attack', ['Space']);
    const off = map.on('attack', seen);

    off();
    off(); // must not throw or double-detach anything

    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    input.flush();
    expect(seen).not.toHaveBeenCalled();
  });

  it('remove() detaches callbacks, not just bindings', () => {
    const seen = vi.fn();
    map.define('attack', ['Space']);
    map.on('attack', seen);

    map.remove('attack');
    // Re-bind the same key through InputManager directly: the callback must be
    // gone. Previously remove() only cleared a bookkeeping map that nothing
    // read, leaving the listener live.
    input.bindKey('Space', 'attack');
    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    input.flush();

    expect(seen).not.toHaveBeenCalled();
  });
});

describe('InputMap — serialization', () => {
  it('round-trips bindings through toJSON/fromJSON', () => {
    map.define('attack', ['Space', 'Enter']);
    map.define('jump', ['KeyJ']);
    const saved = map.toJSON();

    expect(saved).toEqual({ attack: ['Space', 'Enter'], jump: ['KeyJ'] });

    const restored = new InputMap(new InputManager({
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
    } as unknown as HTMLCanvasElement));
    restored.fromJSON(saved);

    expect(restored.toJSON()).toEqual(saved);
  });

  it('fromJSON replaces existing bindings for the same action', () => {
    map.define('attack', ['Space']);
    map.fromJSON({ attack: ['KeyF'] });
    expect(map.getBindings('attack')).toEqual(['KeyF']);

    keydown({ type: 'keydown', key: ' ', code: 'Space' });
    expect(map.isDown('attack')).toBe(false);
  });
});
