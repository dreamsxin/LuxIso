import { describe, it, expect, afterEach } from 'vitest';
import { DomOverlayRenderer } from '../../webgl-next/src/overlays/DomOverlayRenderer';
import { MinimapRenderer } from '../../webgl-next/src/overlays/MinimapRenderer';
import type { RenderSnapshot } from '../../webgl-next/src/contracts/RenderSnapshot';

/**
 * The two `webgl-next` overlays were both at 0%. They are the WebGL2 path's only
 * way to show text and a minimap, so an ARPG on that renderer draws its damage
 * numbers through `DomOverlayRenderer` — where a span that accepts pointer
 * events would swallow taps meant for the game.
 */

interface FakeSpan {
  className: string;
  textContent: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  removed: boolean;
  remove(): void;
}

interface FakeRoot {
  children: FakeSpan[];
  append(el: FakeSpan): void;
}

function stubDom(): { root: FakeRoot } {
  const root: FakeRoot = {
    children: [],
    append(el) { this.children.push(el); },
  };
  (globalThis as any).document = {
    createElement: (): FakeSpan => {
      const span: FakeSpan = {
        className: '',
        textContent: '',
        dataset: {},
        style: {},
        removed: false,
        remove() { this.removed = true; root.children = root.children.filter(c => c !== this); },
      };
      return span;
    },
  };
  return { root };
}

function snapshot(
  overlays: Array<{ id: string; text: string; x: number; y: number; color: string; alpha: number; fontSize: number }>,
): RenderSnapshot {
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { width: 800, height: 600, originX: 400, originY: 300 },
    textOverlays: overlays,
  } as unknown as RenderSnapshot;
}

afterEach(() => {
  delete (globalThis as any).document;
  delete (globalThis as any).window;
});

describe('DomOverlayRenderer', () => {
  it('creates one span per label and reuses it across frames', () => {
    const { root } = stubDom();
    const overlay = new DomOverlayRenderer(root as unknown as HTMLElement);
    const label = { id: 'dmg-1', text: '-12', x: 1, y: 1, color: '#f66', alpha: 1, fontSize: 14 };

    overlay.render(snapshot([label]));
    expect(root.children.length).toBe(1);
    const first = root.children[0];

    overlay.render(snapshot([{ ...label, text: '-34' }]));
    expect(root.children.length).toBe(1);
    expect(root.children[0]).toBe(first);
    expect(first.textContent).toBe('-34');
  });

  it('never lets a label intercept pointer events', () => {
    const { root } = stubDom();
    const overlay = new DomOverlayRenderer(root as unknown as HTMLElement);
    overlay.render(snapshot([{ id: 'dmg-1', text: '-12', x: 0, y: 0, color: '#fff', alpha: 1, fontSize: 12 }]));

    // The preview page happens to set `pointer-events: none` on its container in
    // CSS, but the renderer accepts any root: a consumer mounting it on their own
    // div got damage numbers that swallowed taps.
    expect(root.children[0].style.pointerEvents).toBe('none');
  });

  it('applies colour, opacity and zoom-scaled font size', () => {
    const { root } = stubDom();
    const overlay = new DomOverlayRenderer(root as unknown as HTMLElement);
    const snap = snapshot([{ id: 'l', text: 'hit', x: 0, y: 0, color: '#0f0', alpha: 0.5, fontSize: 20 }]);
    (snap.camera as { zoom: number }).zoom = 2;

    overlay.render(snap);
    const span = root.children[0];
    expect(span.style.color).toBe('#0f0');
    expect(span.style.opacity).toBe('0.5');
    expect(span.style.fontSize).toBe('40px');
    expect(span.style.transform).toContain('translate(-50%, -50%)');
  });

  it('removes labels that stop appearing', () => {
    const { root } = stubDom();
    const overlay = new DomOverlayRenderer(root as unknown as HTMLElement);
    const a = { id: 'a', text: 'a', x: 0, y: 0, color: '#fff', alpha: 1, fontSize: 12 };
    const b = { id: 'b', text: 'b', x: 1, y: 1, color: '#fff', alpha: 1, fontSize: 12 };

    overlay.render(snapshot([a, b]));
    expect(root.children.length).toBe(2);

    overlay.render(snapshot([a]));
    expect(root.children.length).toBe(1);
    expect(root.children[0].dataset.overlayId).toBe('a');
  });

  it('clear() drops everything', () => {
    const { root } = stubDom();
    const overlay = new DomOverlayRenderer(root as unknown as HTMLElement);
    overlay.render(snapshot([{ id: 'a', text: 'a', x: 0, y: 0, color: '#fff', alpha: 1, fontSize: 12 }]));
    overlay.clear();
    expect(root.children.length).toBe(0);

    // And a later frame starts clean rather than resurrecting a detached span.
    overlay.render(snapshot([{ id: 'a', text: 'a', x: 0, y: 0, color: '#fff', alpha: 1, fontSize: 12 }]));
    expect(root.children.length).toBe(1);
    expect(root.children[0].removed).toBe(false);
  });
});

describe('MinimapRenderer', () => {
  interface FakeCanvas {
    width: number;
    height: number;
    rect: { width: number; height: number };
    calls: unknown[][];
  }

  function canvas(w = 120, h = 120): { canvas: HTMLCanvasElement; state: FakeCanvas } {
    const calls: unknown[][] = [];
    const state: FakeCanvas = { width: 0, height: 0, rect: { width: w, height: h }, calls };
    const ctx = new Proxy({}, {
      get: () => (...args: unknown[]) => { calls.push(args); },
      set: () => true,
    });
    const el = {
      get width() { return state.width; },
      set width(v: number) { state.width = v; },
      get height() { return state.height; },
      set height(v: number) { state.height = v; },
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: state.rect.width, height: state.rect.height }),
    } as unknown as HTMLCanvasElement;
    return { canvas: el, state };
  }

  function minimapSnapshot(): RenderSnapshot {
    return {
      camera: { x: 0, y: 0, zoom: 1 },
      minimap: {
        cols: 2,
        rows: 2,
        walkable: [true, false, true, true],
        items: [{ x: 0.5, y: 0.5, character: true }, { x: 1.5, y: 1.5, character: false }],
      },
    } as unknown as RenderSnapshot;
  }

  it('sizes the backing store by the device pixel ratio', () => {
    (globalThis as any).window = { devicePixelRatio: 2 };
    const { canvas: el, state } = canvas(100, 80);
    new MinimapRenderer(el).render(minimapSnapshot());
    expect(state.width).toBe(200);
    expect(state.height).toBe(160);
  });

  it('works without a window object', () => {
    const { canvas: el, state } = canvas(100, 80);
    // Rendering must not throw where `window` is absent; the ratio falls back
    // to 1 instead of reading a property off undefined.
    expect(() => new MinimapRenderer(el).render(minimapSnapshot())).not.toThrow();
    expect(state.width).toBe(100);
  });

  it('draws one cell per tile plus one dot per item', () => {
    (globalThis as any).window = { devicePixelRatio: 1 };
    const { canvas: el, state } = canvas(100, 100);
    new MinimapRenderer(el).render(minimapSnapshot());

    // 1 backdrop + 4 cells = 5 fillRect, 2 arcs, 1 strokeRect.
    expect(state.calls.filter(c => c.length === 4).length).toBeGreaterThanOrEqual(5);
    expect(state.calls.filter(c => c.length === 5).length).toBe(2);
  });

  it('skips a canvas that has no layout size yet', () => {
    (globalThis as any).window = { devicePixelRatio: 1 };
    const { canvas: el, state } = canvas(0, 0);
    new MinimapRenderer(el).render(minimapSnapshot());
    // A zero-size rect used to produce a 1x1 backing store and a frame of
    // drawing commands that could never be seen.
    expect(state.calls.length).toBe(0);
    expect(state.width).toBe(0);
  });

  it('throws a clear error when 2D is unavailable', () => {
    const el = { getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => new MinimapRenderer(el)).toThrow(/Canvas 2D/);
  });
});
