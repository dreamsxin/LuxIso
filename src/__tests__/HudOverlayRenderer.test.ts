import { describe, it, expect, afterEach, vi } from 'vitest';
import { HudOverlayRenderer } from '../../webgl-next/src/overlays/HudOverlayRenderer';
import { HudLayer } from '../core/HudLayer';

/**
 * The WebGL2 path had no UI layer: `HudLayer` is Canvas2D and the preview page
 * hand-rolled DOM labels, so a game on that backend had to build its own overlay
 * before it could show a health bar. This mounts the existing HudLayer on a 2D
 * canvas above the GL one — which only works if the overlay stays out of the way
 * of input and keeps the DPR contract.
 */

interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  rect: { width: number; height: number };
  calls: unknown[][];
}

function canvas(w = 800, h = 600): { el: HTMLCanvasElement; state: FakeCanvas } {
  const calls: unknown[][] = [];
  const state: FakeCanvas = { width: 0, height: 0, style: {}, rect: { width: w, height: h }, calls };
  const ctx = new Proxy({}, {
    get: (_t, prop) => (...args: unknown[]) => { calls.push([prop, ...args]); },
    set: (_t, prop, value) => { calls.push(['set', prop, value]); return true; },
  }) as unknown as CanvasRenderingContext2D;

  const el = {
    get width() { return state.width; },
    set width(v: number) { state.width = v; },
    get height() { return state.height; },
    set height(v: number) { state.height = v; },
    style: state.style,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: state.rect.width, height: state.rect.height }),
  } as unknown as HTMLCanvasElement;

  return { el, state };
}

function setDpr(value: number | undefined): void {
  (globalThis as any).window = { devicePixelRatio: value };
}

afterEach(() => { delete (globalThis as any).window; });

function hudWithBar(): HudLayer {
  const hud = new HudLayer();
  hud.addBar({ id: 'hp', x: 16, y: 16, w: 160, h: 14, value: 0.5, color: '#e04040' });
  return hud;
}

describe('HudOverlayRenderer', () => {
  it('never intercepts pointer events', () => {
    const { el, state } = canvas();
    new HudOverlayRenderer(el, new HudLayer());
    // A canvas covering the viewport would otherwise swallow every tap before
    // the GL canvas — and HUD input comes from InputManager, not from here.
    expect(state.style.pointerEvents).toBe('none');
  });

  it('sizes the backing store by the device pixel ratio', () => {
    setDpr(2);
    const { el, state } = canvas(400, 300);
    const overlay = new HudOverlayRenderer(el, hudWithBar());
    overlay.render();

    expect(state.width).toBe(800);
    expect(state.height).toBe(600);
    expect(overlay.pixelRatio).toBe(2);
  });

  it('clamps the ratio to maxPixelRatio, default 2', () => {
    setDpr(3);
    const { el } = canvas(100, 100);
    expect(new HudOverlayRenderer(el, new HudLayer()).pixelRatio).toBe(1);

    const capped = new HudOverlayRenderer(canvas(100, 100).el, new HudLayer());
    capped.render();
    expect(capped.pixelRatio).toBe(2);

    const raised = new HudOverlayRenderer(canvas(100, 100).el, new HudLayer(), { maxPixelRatio: 3 });
    raised.render();
    expect(raised.pixelRatio).toBe(3);
  });

  it('falls back to ratio 1 without a window', () => {
    const { el, state } = canvas(200, 100);
    const overlay = new HudOverlayRenderer(el, hudWithBar());
    expect(() => overlay.render()).not.toThrow();
    expect(state.width).toBe(200);
    expect(overlay.pixelRatio).toBe(1);
  });

  it('hands the ratio to the HudLayer so widgets are not drawn at 1/dpr', () => {
    setDpr(2);
    const { el, state } = canvas(400, 300);
    const hud = hudWithBar();
    new HudOverlayRenderer(el, hud).render();

    expect(state.calls).toContainEqual(['setTransform', 2, 0, 0, 2, 0, 0]);
  });

  it('clears in device pixels before drawing', () => {
    setDpr(2);
    const { el, state } = canvas(400, 300);
    new HudOverlayRenderer(el, hudWithBar()).render();

    const clear = state.calls.findIndex(c => c[0] === 'clearRect');
    const draw = state.calls.findIndex(c => c[0] === 'fillRect');
    expect(state.calls[clear]).toEqual(['clearRect', 0, 0, 800, 600]);
    expect(clear).toBeLessThan(draw);
  });

  it('draws the HUD widgets', () => {
    setDpr(1);
    const { el, state } = canvas(400, 300);
    new HudOverlayRenderer(el, hudWithBar()).render();

    const fills = state.calls.filter(c => c[0] === 'fillRect');
    expect(fills).toContainEqual(['fillRect', 16, 16, 160, 14]);
    expect(fills).toContainEqual(['fillRect', 16, 16, 80, 14]);
  });

  it('skips a canvas that has no layout size yet', () => {
    setDpr(1);
    const { el, state } = canvas(0, 0);
    new HudOverlayRenderer(el, hudWithBar()).render();
    expect(state.calls.length).toBe(0);
    expect(state.width).toBe(0);
  });

  it('resizes when the CSS box changes', () => {
    setDpr(1);
    const { el, state } = canvas(400, 300);
    const overlay = new HudOverlayRenderer(el, new HudLayer());
    overlay.render();
    expect(state.width).toBe(400);

    state.rect = { width: 640, height: 480 };
    overlay.render();
    expect(state.width).toBe(640);
    expect(state.height).toBe(480);
  });

  it('dispose clears the canvas and drops HUD press state', () => {
    setDpr(1);
    const { el, state } = canvas(400, 300);
    const hud = hudWithBar();
    const reset = vi.spyOn(hud, 'resetInput');
    const overlay = new HudOverlayRenderer(el, hud);
    overlay.render();
    state.calls.length = 0;

    overlay.dispose();
    expect(reset).toHaveBeenCalled();
    expect(state.calls).toContainEqual(['clearRect', 0, 0, 400, 300]);
  });

  it('throws a clear error when 2D is unavailable', () => {
    const el = { getContext: () => null, style: {} } as unknown as HTMLCanvasElement;
    expect(() => new HudOverlayRenderer(el, new HudLayer())).toThrow(/Canvas 2D/);
  });
});
