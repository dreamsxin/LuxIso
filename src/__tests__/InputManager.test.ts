import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InputManager, type InputManagerOptions } from '../core/InputManager';

/**
 * InputManager tests.
 *
 * The stub records listeners per target so each event can be dispatched at the
 * target the production code actually listens on — which matters here: `mouseup`
 * is bound to `window`, not the canvas, so that a drag released off-canvas still
 * ends. `document` is stubbed too, for the visibilitychange path.
 */

interface Harness {
  input: InputManager;
  canvas: HTMLCanvasElement;
  fireCanvas(ev: Record<string, unknown>): void;
  fireWindow(ev: Record<string, unknown>): void;
  fireDocument(ev: Record<string, unknown>): void;
  setHidden(hidden: boolean): void;
}

function makeHarness(opts?: InputManagerOptions): Harness {
  const bag = () => {
    const map: Record<string, Function[]> = {};
    return {
      addEventListener(type: string, cb: Function) {
        (map[type] ??= []).push(cb);
      },
      removeEventListener: vi.fn(),
      fire(ev: Record<string, unknown>) {
        for (const cb of map[ev.type as string] ?? []) cb(ev);
      },
    };
  };

  const canvasBag = bag();
  const windowBag = bag();
  const documentBag = bag();

  const canvas = {
    ...canvasBag,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;

  (globalThis as any).window = windowBag;
  (globalThis as any).document = { ...documentBag, hidden: false };

  const input = new InputManager(canvas, opts);
  return {
    input,
    canvas,
    fireCanvas: (ev) => canvasBag.fire(ev),
    fireWindow: (ev) => windowBag.fire(ev),
    fireDocument: (ev) => documentBag.fire(ev),
    setHidden: (hidden) => { (globalThis as any).document.hidden = hidden; },
  };
}

/** One entry for a `TouchEvent.changedTouches` list. */
function touch(id: number, x: number, y: number): unknown {
  return { identifier: id, clientX: x, clientY: y };
}

function touchEvent(type: string, changed: unknown[]): Record<string, unknown> {
  return { type, changedTouches: changed, touches: [], preventDefault: vi.fn() };
}

describe('InputManager — keyboard and actions', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.input.destroy(); });

  it('tracks keyboard state', () => {
    h.fireWindow({ type: 'keydown', key: 'a', code: 'KeyA' });
    expect(h.input.isDown('a')).toBe(true);
    expect(h.input.isDown('KeyA')).toBe(true);
    expect(h.input.wasPressed('a')).toBe(true);

    h.input.flush();
    expect(h.input.isDown('a')).toBe(true);
    expect(h.input.wasPressed('a')).toBe(false);

    h.fireWindow({ type: 'keyup', key: 'a', code: 'KeyA' });
    expect(h.input.isDown('a')).toBe(false);
    expect(h.input.wasReleased('a')).toBe(true);
  });

  it('handles action bindings', () => {
    h.input.bindKey('Space', 'jump');
    const callback = vi.fn();
    h.input.onAction('jump', callback);

    h.fireWindow({ type: 'keydown', key: ' ', code: 'Space' });
    expect(h.input.isAction('jump')).toBe(true);
    expect(h.input.wasAction('jump')).toBe(true);

    h.input.flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(h.input.wasAction('jump')).toBe(false);
  });
});

describe('InputManager — mouse', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.input.destroy(); });

  it('tracks pointer state', () => {
    h.fireCanvas({ type: 'mousemove', clientX: 100, clientY: 100 });
    expect(h.input.pointerX).toBe(100);
    expect(h.input.pointerY).toBe(100);

    h.fireCanvas({ type: 'mousedown', clientX: 50, clientY: 50, button: 0 });
    expect(h.input.pointer.down).toBe(true);
    expect(h.input.pointer.pressed).toBe(true);

    h.input.flush();
    expect(h.input.pointer.down).toBe(true);
    expect(h.input.pointer.pressed).toBe(false);

    h.fireWindow({ type: 'mouseup', button: 0 });
    expect(h.input.pointer.down).toBe(false);
    expect(h.input.pointer.released).toBe(true);
  });

  it('releases a drag that ends outside the canvas', () => {
    h.fireCanvas({ type: 'mousedown', clientX: 10, clientY: 10, button: 0 });
    // The canvas never sees this one; window does.
    h.fireWindow({ type: 'mouseup', button: 0 });
    expect(h.input.pointer.down).toBe(false);
  });

  it('exposes mouse buttons as bindable keys', () => {
    h.input.bindKey('MouseLeft', 'attack');
    const fired = vi.fn();
    h.input.onAction('attack', fired);

    h.fireCanvas({ type: 'mousedown', clientX: 1, clientY: 1, button: 0 });
    expect(h.input.isDown('MouseLeft')).toBe(true);
    expect(h.input.wasAction('attack')).toBe(true);
    h.input.flush();
    expect(fired).toHaveBeenCalledTimes(1);

    h.fireWindow({ type: 'mouseup', button: 0 });
    expect(h.input.isDown('MouseLeft')).toBe(false);
    expect(h.input.wasReleased('MouseLeft')).toBe(true);
  });

  it('distinguishes the right button from the left', () => {
    h.fireCanvas({ type: 'mousedown', clientX: 1, clientY: 1, button: 2 });
    expect(h.input.isDown('MouseRight')).toBe(true);
    expect(h.input.isDown('MouseLeft')).toBe(false);
  });
});

describe('InputManager — multi-touch', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.input.destroy(); });

  it('drives the pointer from a single finger', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(1, 40, 60)]));
    expect(h.input.pointer.down).toBe(true);
    expect(h.input.pointer.pressed).toBe(true);
    expect(h.input.pointerX).toBe(40);
    expect(h.input.pointerY).toBe(60);
    expect(h.input.touchCount).toBe(1);

    h.input.flush();
    h.fireCanvas(touchEvent('touchmove', [touch(1, 90, 20)]));
    expect(h.input.pointerX).toBe(90);
    expect(h.input.pointerY).toBe(20);

    h.fireCanvas(touchEvent('touchend', [touch(1, 90, 20)]));
    expect(h.input.pointer.down).toBe(false);
    expect(h.input.pointer.released).toBe(true);
    expect(h.input.touchCount).toBe(0);
  });

  it('does not forge a second press when another finger lands', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(1, 10, 10)]));
    h.input.flush();

    h.fireCanvas(touchEvent('touchstart', [touch(2, 700, 500)]));
    expect(h.input.pointer.pressed).toBe(false);
    // The pointer stays on the primary contact, not the newcomer.
    expect(h.input.pointerX).toBe(10);
    expect(h.input.touchCount).toBe(2);
  });

  it('keeps the pointer held when a secondary finger lifts', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(1, 10, 10)]));
    h.fireCanvas(touchEvent('touchstart', [touch(2, 700, 500)]));
    h.input.flush();

    h.fireCanvas(touchEvent('touchend', [touch(2, 700, 500)]));
    expect(h.input.pointer.down).toBe(true);
    expect(h.input.pointer.released).toBe(false);
    expect(h.input.touchCount).toBe(1);
    expect(h.input.pointerX).toBe(10);
  });

  it('promotes the oldest survivor when the primary finger lifts', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(1, 10, 10)]));
    h.fireCanvas(touchEvent('touchstart', [touch(2, 200, 300)]));
    h.fireCanvas(touchEvent('touchstart', [touch(3, 400, 100)]));
    h.input.flush();

    h.fireCanvas(touchEvent('touchend', [touch(1, 10, 10)]));
    expect(h.input.pointer.down).toBe(true);
    expect(h.input.pointer.released).toBe(false);
    expect(h.input.pointerX).toBe(200);
    expect(h.input.pointerY).toBe(300);
    expect(h.input.touches.map(t => t.id)).toEqual([2, 3]);
  });

  it('tracks each contact independently', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(7, 10, 10), touch(9, 20, 20)]));
    h.fireCanvas(touchEvent('touchmove', [touch(9, 300, 400)]));

    expect(h.input.getTouch(7)).toEqual({ id: 7, x: 10, y: 10 });
    expect(h.input.getTouch(9)).toEqual({ id: 9, x: 300, y: 400 });
    expect(h.input.getTouch(42)).toBeNull();
  });

  it('touchcancel ends contacts like touchend', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(1, 10, 10)]));
    h.input.flush();
    h.fireCanvas(touchEvent('touchcancel', [touch(1, 10, 10)]));
    expect(h.input.pointer.down).toBe(false);
    expect(h.input.touchCount).toBe(0);
  });

  it('ignores a move for a contact it never saw start', () => {
    h.fireCanvas(touchEvent('touchmove', [touch(5, 100, 100)]));
    expect(h.input.touchCount).toBe(0);
    expect(h.input.pointer.down).toBe(false);
  });
});

describe('InputManager — focus loss', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });
  afterEach(() => { h.input.destroy(); });

  it('releases held keys on blur', () => {
    h.fireWindow({ type: 'keydown', key: 'w', code: 'KeyW' });
    h.input.flush();
    expect(h.input.isDown('w')).toBe(true);

    // Alt-tabbing never delivers keyup, so without this the character would
    // keep walking after the player came back.
    h.fireWindow({ type: 'blur' });
    expect(h.input.isDown('w')).toBe(false);
    expect(h.input.isDown('KeyW')).toBe(false);
    expect(h.input.wasReleased('w')).toBe(true);
  });

  it('drops contacts and releases the pointer on blur', () => {
    h.fireCanvas(touchEvent('touchstart', [touch(1, 10, 10)]));
    h.fireCanvas(touchEvent('touchstart', [touch(2, 20, 20)]));
    h.input.flush();

    h.fireWindow({ type: 'blur' });
    expect(h.input.touchCount).toBe(0);
    expect(h.input.pointer.down).toBe(false);
    expect(h.input.pointer.released).toBe(true);
  });

  it('releases everything when the tab is hidden', () => {
    h.fireWindow({ type: 'keydown', key: 'a', code: 'KeyA' });
    h.input.flush();

    h.setHidden(true);
    h.fireDocument({ type: 'visibilitychange' });
    expect(h.input.isDown('a')).toBe(false);
  });

  it('does nothing when visibilitychange reports the tab as visible', () => {
    h.fireWindow({ type: 'keydown', key: 'a', code: 'KeyA' });
    h.input.flush();

    h.setHidden(false);
    h.fireDocument({ type: 'visibilitychange' });
    expect(h.input.isDown('a')).toBe(true);
  });
});

describe('InputManager — high-DPI coordinates', () => {
  it('reports logical pixels when a ratio is supplied', () => {
    // Engine.resize() at ratio 2 leaves an 800-wide backing store in a 400-wide
    // CSS box. Without dividing the ratio out, a tap at CSS (100, 50) would be
    // reported as (200, 100) and every HUD hit box would miss.
    const h = makeHarness({ pixelRatio: 2 });
    (h.canvas as any).width = 1600;
    (h.canvas as any).height = 1200;

    h.fireCanvas({ type: 'mousemove', clientX: 100, clientY: 50 });
    expect(h.input.pointerX).toBe(100);
    expect(h.input.pointerY).toBe(50);
    h.input.destroy();
  });

  it('re-reads a ratio supplied as a function', () => {
    let ratio = 1;
    const h = makeHarness({ pixelRatio: () => ratio });
    (h.canvas as any).width = 1600;
    (h.canvas as any).height = 1200;

    h.fireCanvas({ type: 'mousemove', clientX: 100, clientY: 100 });
    expect(h.input.pointerX).toBe(200);

    // Dragging the window onto a retina display changes the ratio mid-session.
    ratio = 2;
    h.fireCanvas({ type: 'mousemove', clientX: 100, clientY: 100 });
    expect(h.input.pointerX).toBe(100);
    h.input.destroy();
  });

  it('still corrects for a CSS-stretched canvas at ratio 1', () => {
    const h = makeHarness();
    (h.canvas as any).width = 1600;
    h.fireCanvas({ type: 'mousemove', clientX: 100, clientY: 0 });
    expect(h.input.pointerX).toBe(200);
    h.input.destroy();
  });

  it('treats a zero ratio as 1 rather than dividing by zero', () => {
    const h = makeHarness({ pixelRatio: 0 });
    h.fireCanvas({ type: 'mousemove', clientX: 100, clientY: 50 });
    expect(h.input.pointerX).toBe(100);
    h.input.destroy();
  });
});

describe('InputManager — touch default prevention', () => {

  it('suppresses browser gestures by default', () => {
    const h = makeHarness();
    const ev = touchEvent('touchstart', [touch(1, 10, 10)]);
    h.fireCanvas(ev);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    h.input.destroy();
  });

  it('leaves them alone when opted out', () => {
    const h = makeHarness({ preventTouchDefault: false });
    const ev = touchEvent('touchmove', [touch(1, 10, 10)]);
    h.fireCanvas(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    h.input.destroy();
  });
});



