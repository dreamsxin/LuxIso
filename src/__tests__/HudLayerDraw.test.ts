import { describe, it, expect, vi } from 'vitest';
import { HudLayer, type HudLabel } from '../core/HudLayer';

/**
 * HudLayer registry and draw path.
 *
 * `HudLayerInput.test.ts` covers press/release arbitration; this file covers the
 * element registry and what actually reaches the canvas. An ARPG rebuilds its
 * HUD on every scene entry, which is where the registry gave way.
 */

interface Rec {
  ctx: CanvasRenderingContext2D;
  calls: unknown[][];
}

function recorder(): Rec {
  const calls: unknown[][] = [];
  const ctx = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => { calls.push([prop, ...args]); },
    set: (_t, prop, value) => { calls.push(['set', prop, value]); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function input(x: number, y: number, down: boolean) {
  return { pointer: { x, y, down }, touches: [] as { id: number; x: number; y: number }[] };
}

describe('HudLayer — element registry', () => {
  it('re-adding an id replaces the element instead of duplicating it', () => {
    const hud = new HudLayer();
    const first = hud.addBar({ id: 'hp', x: 0, y: 0, w: 100, h: 10, color: '#f00' });
    const second = hud.addBar({ id: 'hp', x: 0, y: 0, w: 100, h: 10, color: '#0f0' });

    // The registry used to `set` the map but `push` the array, so the old
    // element stayed in the draw list forever, unreachable through `get`.
    expect(hud.get('hp')).toBe(second);
    expect(hud.elements.length).toBe(1);
    expect(hud.elements[0]).not.toBe(first);
  });

  it('a replacement keeps its original draw position', () => {
    const hud = new HudLayer();
    hud.addPanel({ id: 'bg', x: 0, y: 0, w: 50, h: 50 });
    hud.addLabel({ id: 'title', x: 4, y: 4, text: 'one' });
    hud.addBar({ id: 'hp', x: 0, y: 20, w: 40, h: 6 });

    hud.addLabel({ id: 'title', x: 4, y: 4, text: 'two' });

    expect(hud.elements.map(e => e.id)).toEqual(['bg', 'title', 'hp']);
    expect(hud.get<HudLabel>('title')!.text).toBe('two');
  });

  it('remove() drops the element from both the list and the lookup', () => {
    const hud = new HudLayer();
    hud.addBar({ id: 'hp', x: 0, y: 0, w: 10, h: 10 });
    hud.remove('hp');
    expect(hud.get('hp')).toBeUndefined();
    expect(hud.elements.length).toBe(0);
  });

  it('removing a button mid-press cannot fire it later', () => {
    const onClick = vi.fn();
    const hud = new HudLayer();
    hud.addButton({ id: 'skill', x: 0, y: 0, w: 40, h: 40, onClick });

    hud.update(input(10, 10, true));
    hud.remove('skill');
    hud.update(input(10, 10, false));

    // The press map still referenced the removed element, so the release fired
    // a button that was no longer part of the HUD.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clear() also drops in-flight presses', () => {
    const onClick = vi.fn();
    const hud = new HudLayer();
    hud.addButton({ id: 'skill', x: 0, y: 0, w: 40, h: 40, onClick });

    hud.update(input(10, 10, true));
    hud.clear();
    hud.update(input(10, 10, false));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('HudLayer — hover state', () => {
  it('clears hover when a button is hidden', () => {
    const hud = new HudLayer();
    const btn = hud.addButton({ id: 'b', x: 0, y: 0, w: 40, h: 20 });

    hud.handleMove(10, 10);
    expect(btn._hovered).toBe(true);

    btn.visible = false;
    hud.handleMove(10, 10);
    // Hover used to stick: an invisible button was skipped entirely, so it came
    // back highlighted when shown again.
    expect(btn._hovered).toBe(false);
  });

  it('clears hover when the pointer leaves', () => {
    const hud = new HudLayer();
    const btn = hud.addButton({ id: 'b', x: 0, y: 0, w: 40, h: 20 });
    hud.handleMove(10, 10);
    hud.handleMove(500, 500);
    expect(btn._hovered).toBe(false);
  });
});

describe('HudLayer — draw', () => {
  function drawn(build: (hud: HudLayer) => void, ratio?: number): unknown[][] {
    const hud = new HudLayer();
    if (ratio !== undefined) hud.pixelRatio = ratio;
    build(hud);
    const r = recorder();
    hud.draw(r.ctx);
    return r.calls;
  }

  it('pins the transform to the backing-store scale', () => {
    const calls = drawn(() => {}, 2);
    expect(calls).toContainEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
  });

  it('falls back to 1 for a non-positive ratio', () => {
    const calls = drawn(() => {}, 0);
    expect(calls).toContainEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });

  it('accepts a ratio getter', () => {
    const hud = new HudLayer();
    let ratio = 1;
    hud.pixelRatio = () => ratio;
    const r = recorder();
    ratio = 3;
    hud.draw(r.ctx);
    expect(r.calls).toContainEqual(['setTransform', 3, 0, 0, 3, 0, 0]);
  });

  it('skips invisible elements', () => {
    const calls = drawn((hud) => {
      hud.addBar({ id: 'hp', x: 0, y: 0, w: 100, h: 10, visible: false });
    });
    expect(calls.filter(c => c[0] === 'fillRect').length).toBe(0);
  });

  it('draws a bar background, fill and border', () => {
    const calls = drawn((hud) => {
      hud.addBar({ id: 'hp', x: 10, y: 20, w: 100, h: 10, value: 0.25, color: '#e04040' });
    });
    const fills = calls.filter(c => c[0] === 'fillRect');
    expect(fills[0]).toEqual(['fillRect', 10, 20, 100, 10]);
    expect(fills[1]).toEqual(['fillRect', 10, 20, 25, 10]);
    expect(calls).toContainEqual(['strokeRect', 10, 20, 100, 10]);
  });

  it('omits the fill at zero and clamps above one', () => {
    const empty = drawn((hud) => {
      hud.addBar({ id: 'hp', x: 0, y: 0, w: 80, h: 8, value: 0 });
    });
    expect(empty.filter(c => c[0] === 'fillRect').length).toBe(1);

    const over = drawn((hud) => {
      hud.addBar({ id: 'hp', x: 0, y: 0, w: 80, h: 8, value: 4 });
    });
    const fills = over.filter(c => c[0] === 'fillRect');
    expect(fills[1]).toEqual(['fillRect', 0, 0, 80, 8]);
  });

  it('draws a bar label when one is set', () => {
    const withLabel = drawn((hud) => {
      hud.addBar({ id: 'hp', x: 0, y: 0, w: 80, h: 10, label: 'HP' });
    });
    expect(withLabel.some(c => c[0] === 'fillText' && c[1] === 'HP')).toBe(true);

    const without = drawn((hud) => {
      hud.addBar({ id: 'hp', x: 0, y: 0, w: 80, h: 10 });
    });
    expect(without.some(c => c[0] === 'fillText')).toBe(false);
  });

  it('draws a label twice when shadowed, once when not', () => {
    const shadowed = drawn((hud) => {
      hud.addLabel({ id: 'l', x: 5, y: 5, text: 'Wave 3' });
    });
    expect(shadowed.filter(c => c[0] === 'fillText').length).toBe(2);

    const plain = drawn((hud) => {
      hud.addLabel({ id: 'l', x: 5, y: 5, text: 'Wave 3', shadow: false });
    });
    expect(plain.filter(c => c[0] === 'fillText').length).toBe(1);
  });

  it('uses the hover colour while a button is held', () => {
    const hud = new HudLayer();
    const btn = hud.addButton({
      id: 'b', x: 0, y: 0, w: 40, h: 20,
      bgColor: '#111', hoverColor: '#999',
    });
    const idle = recorder();
    hud.draw(idle.ctx);
    expect(idle.calls).toContainEqual(['set', 'fillStyle', '#111']);

    btn._hovered = true;
    const held = recorder();
    hud.draw(held.ctx);
    expect(held.calls).toContainEqual(['set', 'fillStyle', '#999']);
  });

  it('draws elements in insertion order', () => {
    const calls = drawn((hud) => {
      hud.addPanel({ id: 'p', x: 0, y: 0, w: 60, h: 60 });
      hud.addBar({ id: 'hp', x: 4, y: 4, w: 50, h: 8 });
    });
    const firstFill = calls.findIndex(c => c[0] === 'fill');
    const firstRect = calls.findIndex(c => c[0] === 'fillRect');
    expect(firstFill).toBeLessThan(firstRect);
  });

  it('balances save/restore', () => {
    const calls = drawn((hud) => {
      hud.addPanel({ id: 'p', x: 0, y: 0, w: 10, h: 10 });
      hud.addLabel({ id: 'l', x: 0, y: 0, text: 'x' });
      hud.addBar({ id: 'b', x: 0, y: 0, w: 10, h: 10 });
      hud.addButton({ id: 'btn', x: 0, y: 0, w: 10, h: 10 });
    });
    expect(calls.filter(c => c[0] === 'save').length)
      .toBe(calls.filter(c => c[0] === 'restore').length);
  });
});
