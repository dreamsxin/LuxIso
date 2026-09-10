import { describe, it, expect, vi } from 'vitest';
import { HudLayer, type HudInputSource } from '../core/HudLayer';

/**
 * HudLayer input tests.
 *
 * The layer was draw-mostly: only `type: 'button'` was ever hit-tested, nothing
 * wired `handleClick` to an event, and the documented `click` listener is the
 * wrong event on touch. `update()` is the frame-driven replacement, so these
 * tests drive it with a structural `HudInputSource` stub.
 */

interface Contact { id: number; x: number; y: number }

function source(): HudInputSource & {
  set(x: number, y: number, down: boolean): void;
  touch(...points: Contact[]): void;
} {
  const state = {
    pointer: { x: 0, y: 0, down: false },
    touches: [] as Contact[],
  };
  return {
    get pointer() { return state.pointer; },
    get touches() { return state.touches; },
    set(x, y, down) { state.pointer.x = x; state.pointer.y = y; state.pointer.down = down; },
    touch(...points) { state.touches = points; },
  };
}

function hudWithButton(onClick = vi.fn()) {
  const hud = new HudLayer();
  const btn = hud.addButton({ id: 'skill', x: 100, y: 100, w: 40, h: 40, onClick });
  return { hud, btn, onClick };
}

describe('HudLayer — hitTest', () => {
  it('finds a button by point', () => {
    const { hud, btn } = hudWithButton();
    expect(hud.hitTest(120, 120)).toBe(btn);
    expect(hud.hitTest(90, 120)).toBeNull();
  });

  it('hits panels and bars too, not just buttons', () => {
    const hud = new HudLayer();
    const panel = hud.addPanel({ id: 'bag', x: 0, y: 0, w: 50, h: 50 });
    const bar = hud.addBar({ id: 'hp', x: 200, y: 0, w: 60, h: 12 });
    expect(hud.hitTest(10, 10)).toBe(panel);
    expect(hud.hitTest(210, 5)).toBe(bar);
  });

  it('never hits a label, which has no extent', () => {
    const hud = new HudLayer();
    hud.addLabel({ id: 'score', x: 0, y: 0, text: 'x' });
    expect(hud.hitTest(0, 0)).toBeNull();
  });

  it('returns the topmost element on overlap', () => {
    const hud = new HudLayer();
    hud.addPanel({ id: 'under', x: 0, y: 0, w: 100, h: 100 });
    const over = hud.addButton({ id: 'over', x: 10, y: 10, w: 30, h: 30, onClick: () => {} });
    expect(hud.hitTest(20, 20)).toBe(over);
  });

  it('skips hidden elements', () => {
    const { hud, btn } = hudWithButton();
    btn.visible = false;
    expect(hud.hitTest(120, 120)).toBeNull();
  });

  it('expands undersized targets to minHitSize', () => {
    const hud = new HudLayer();
    hud.addButton({ id: 'tiny', x: 100, y: 100, w: 20, h: 20, onClick: () => {} });
    expect(hud.hitTest(94, 110)).toBeNull();
    hud.minHitSize = 44;
    // 44 wide around a 20-wide box adds 12px each side.
    expect(hud.hitTest(94, 110)).not.toBeNull();
    expect(hud.hitTest(86, 110)).toBeNull();
  });
});

describe('HudLayer — touch press and release', () => {
  it('fires on release inside the button, not on press', () => {
    const { hud, onClick } = hudWithButton();
    const src = source();

    src.touch({ id: 1, x: 120, y: 120 });
    hud.update(src);
    expect(onClick).not.toHaveBeenCalled();

    src.touch();
    hud.update(src);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('highlights while held and clears on release', () => {
    const { hud, btn } = hudWithButton();
    const src = source();

    src.touch({ id: 1, x: 120, y: 120 });
    hud.update(src);
    expect(btn._hovered).toBe(true);

    src.touch();
    hud.update(src);
    // The old code left the highlight on forever after a tap: touch delivers no
    // "moved out" event to clear it.
    expect(btn._hovered).toBe(false);
  });

  it('does not fire when the finger slides off before lifting', () => {
    const { hud, onClick } = hudWithButton();
    const src = source();

    src.touch({ id: 1, x: 120, y: 120 });
    hud.update(src);
    src.touch({ id: 1, x: 300, y: 300 });
    hud.update(src);
    src.touch();
    hud.update(src);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ignores a contact another widget owns', () => {
    const { hud, onClick } = hudWithButton();
    const src = source();

    src.touch({ id: 9, x: 120, y: 120 });
    hud.update(src, id => id === 9);
    src.touch();
    hud.update(src);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('tracks two contacts independently', () => {
    const first = vi.fn();
    const second = vi.fn();
    const hud = new HudLayer();
    hud.addButton({ id: 'a', x: 0, y: 0, w: 40, h: 40, onClick: first });
    hud.addButton({ id: 'b', x: 200, y: 0, w: 40, h: 40, onClick: second });
    const src = source();

    src.touch({ id: 1, x: 20, y: 20 }, { id: 2, x: 220, y: 20 });
    hud.update(src);
    expect(hud.update(src).length).toBe(2);

    // Lift only the second thumb.
    src.touch({ id: 1, x: 20, y: 20 });
    hud.update(src);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('reports the contacts it is holding', () => {
    const { hud } = hudWithButton();
    const src = source();
    src.touch({ id: 3, x: 120, y: 120 });
    expect(hud.update(src)).toEqual([3]);
  });

  it('resetInput drops in-flight presses without firing', () => {
    const { hud, btn, onClick } = hudWithButton();
    const src = source();

    src.touch({ id: 1, x: 120, y: 120 });
    hud.update(src);
    hud.resetInput();
    expect(btn._hovered).toBe(false);

    src.touch();
    hud.update(src);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('HudLayer — mouse through update()', () => {
  it('fires on button release inside', () => {
    const { hud, onClick } = hudWithButton();
    const src = source();

    src.set(120, 120, true);
    hud.update(src);
    expect(onClick).not.toHaveBeenCalled();

    src.set(120, 120, false);
    hud.update(src);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire when released off the button', () => {
    const { hud, onClick } = hudWithButton();
    const src = source();
    src.set(120, 120, true);
    hud.update(src);
    src.set(400, 400, false);
    hud.update(src);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('yields to touch when both are present', () => {
    const { hud, onClick } = hudWithButton();
    const src = source();
    // InputManager sets pointer.down for touch as well; handling both would
    // double-count the same physical press.
    src.set(120, 120, true);
    src.touch({ id: 1, x: 120, y: 120 });
    expect(hud.update(src)).toEqual([1]);
    src.touch();
    src.set(120, 120, false);
    hud.update(src);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('HudLayer — high-DPI draw transform', () => {
  function recorder() {
    const calls: unknown[][] = [];
    const ctx = new Proxy({}, {
      get: (_t, prop) => (...args: unknown[]) => { calls.push([prop, ...args]); },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  }

  it('resets to identity by default', () => {
    const hud = new HudLayer();
    const { ctx, calls } = recorder();
    hud.draw(ctx);
    expect(calls).toContainEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });

  it('resets to the backing-store scale when told the ratio', () => {
    const hud = new HudLayer();
    hud.pixelRatio = 2;
    const { ctx, calls } = recorder();
    hud.draw(ctx);
    // Resetting to identity here would draw the HUD at half size in the corner.
    expect(calls).toContainEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
  });

  it('accepts a ratio provider and a zero guard', () => {
    const hud = new HudLayer();
    let ratio = 3;
    hud.pixelRatio = () => ratio;
    const a = recorder();
    hud.draw(a.ctx);
    expect(a.calls).toContainEqual(['setTransform', 3, 0, 0, 3, 0, 0]);

    ratio = 0;
    const b = recorder();
    hud.draw(b.ctx);
    expect(b.calls).toContainEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });
});
