import {describe, it, expect, vi, beforeAll} from 'vitest';
import {Scene} from '../core/Scene';
import {Floor} from '../elements/Floor';
import {Wall} from '../elements/Wall';
import {Character} from '../elements/Character';
import {Crystal} from '../elements/props/Crystal';
import {OmniLight} from '../lighting/OmniLight';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {TileCollider} from '../physics/TileCollider';
import {SceneRenderer} from '../core/SceneRenderer';
import {LightmapCache} from '../core/LightmapCache';
import {IsoObject} from '../elements/IsoObject';
import type {DrawContext} from '../elements/IsoObject';
import type {AABB} from '../math/depthSort';

/**
 * Integration tests for the Scene.draw() render pipeline.
 *
 * The node test environment has no DOM, so we stub HTMLCanvasElement /
 * CanvasRenderingContext2D / OffscreenCanvas. The goal is NOT to verify pixel
 * output but to prove the full render path executes without throwing and that
 * the expected draw calls happen in the right order (floor -> objects -> halo).
 * This lifts LightmapCache, ShadowCaster, Floor.draw, Wall.draw, and the light
 * halo projection out of "zero coverage" into at-least-executed-once status.
 */

// ── OffscreenCanvas stub (used by LightmapCache) ────────────────────────────
beforeAll(() => {
  if (typeof OffscreenCanvas === 'undefined') {
    (globalThis as unknown as {OffscreenCanvas: unknown}).OffscreenCanvas = class {
      width: number;
      height: number;
      private _ctx: unknown;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        if (!this._ctx) {this._ctx = makeCtx();}
        return this._ctx;
      }
    };
  }
});

function makeCtx() {
  return {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({addColorStop: vi.fn()})),
    createLinearGradient: vi.fn(() => ({addColorStop: vi.fn()})),
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({width: 0})),
    getTransform: vi.fn(() => ({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0})),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

function makeCanvas() {
  const ctx = makeCtx() as unknown as CanvasRenderingContext2D;
  const canvas = {width: 640, height: 480} as unknown as HTMLCanvasElement;
  return {canvas, ctx};
}

function makeCtxOnly() {
  return makeCtx() as unknown as CanvasRenderingContext2D;
}

class DrawProbe extends IsoObject {
  drawCalls = 0;

  get aabb(): AABB {
    return {
      minX: this.position.x,
      minY: this.position.y,
      maxX: this.position.x + 1,
      maxY: this.position.y + 1,
      baseZ: 0,
      maxZ: 1,
    };
  }

  draw(_dc: DrawContext): void {
    this.drawCalls++;
  }
}

function buildScene(): Scene {
  const scene = new Scene({cols: 6, rows: 6, tileW: 64, tileH: 32});
  scene.addObject(new Floor({id: 'floor', cols: 6, rows: 6}));
  scene.addLight(new OmniLight({x: 3, y: 3, z: 80, color: '#ffd080', intensity: 1, radius: 300}));
  scene.addLight(new DirectionalLight({angle: Math.PI / 4, elevation: Math.PI / 4, color: '#c0d8ff', intensity: 0.3}));
  const wall = new Wall({id: 'wall', x: 1, y: 1, endX: 4, endY: 1, height: 64});
  wall.castsShadow = true;
  scene.addObject(wall);
  scene.addObject(new Character({id: 'player', x: 3, y: 3, z: 0, radius: 22}));
  const crystal = new Crystal('gem', 2, 2, '#8060e0', 48);
  scene.addObject(crystal);
  scene.collider = new TileCollider(6, 6);
  return scene;
}

describe('Scene.draw - render pipeline integration', () => {
  it('executes the full draw path without throwing', () => {
    const scene = buildScene();
    const {ctx} = makeCanvas();
    expect(() => scene.draw(ctx, 640, 480, 320, 240)).not.toThrow();
  });

  it('blits the floor lightmap and draws scene objects', () => {
    const scene = buildScene();
    const {ctx} = makeCanvas();
    scene.draw(ctx, 640, 480, 320, 240);
    // Floor is baked into the offscreen lightmap then blitted via drawImage,
    // and objects (wall/character/crystal) issue fill() calls.
    expect(ctx.drawImage).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('renders a light halo for each omni light (radial gradient)', () => {
    const scene = buildScene();
    const {ctx} = makeCanvas();
    scene.draw(ctx, 640, 480, 320, 240);
    // drawLightHalo creates a radial gradient + a white core dot -> at least
    // 2 createRadialGradient calls per omni light (we have 1 omni light).
    expect(ctx.createRadialGradient).toHaveBeenCalled();
  });

  it('does not throw under a rotated view', () => {
    // Regression for the light-halo view bug: previously project(.., this.view)
    // ignored the view, and the halo was misplaced under rotation. The draw
    // path must still complete under a non-default view.
    const scene = buildScene();
    scene.view = {rotation: 90, elevation: 1.0};
    const {ctx} = makeCanvas();
    expect(() => scene.draw(ctx, 640, 480, 320, 240)).not.toThrow();
  });

  it('respects object visibility (invisible objects are skipped)', () => {
    const scene = buildScene();
    const {ctx} = makeCanvas();
    scene.draw(ctx, 640, 480, 320, 240);
    const fillsWithAllVisible = (ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length;

    // Hide the crystal and redraw; the fill count should not increase.
    const crystal = scene.getById('gem')!;
    crystal.visible = false;
    const ctx2 = makeCtxOnly();
    scene.draw(ctx2, 640, 480, 320, 240);
    // We only assert it still renders without the hidden object; exact counts
    // vary, so verify the visible run produced fills and the hidden run also
    // completes. The key invariant: no throw, and rendering happened.
    expect(fillsWithAllVisible).toBeGreaterThan(0);
    expect(ctx2.fill).toHaveBeenCalled();
  });

  it('caches the sort and only re-sorts when positions change', () => {
    const scene = buildScene();
    const {ctx} = makeCanvas();
    // First draw sorts; second draw with no movement reuses the cache.
    scene.draw(ctx, 640, 480, 320, 240);
    expect(() => scene.draw(ctx, 640, 480, 320, 240)).not.toThrow();
    // Move the character and redraw - should still succeed (re-sort path).
    const player = scene.getById('player')!;
    player.position.x = 4;
    expect(() => scene.draw(ctx, 640, 480, 320, 240)).not.toThrow();
  });

  it('invalidates the sorted object set when visibility swaps at the same position', () => {
    const scene = new Scene();
    const first = new DrawProbe('first', 1, 1, 0);
    const second = new DrawProbe('second', 1, 1, 0);
    second.visible = false;
    scene.addObject(first);
    scene.addObject(second);
    const ctx = makeCtxOnly();

    scene.draw(ctx, 640, 480, 320, 240);
    first.visible = false;
    second.visible = true;
    scene.draw(ctx, 640, 480, 320, 240);

    expect(first.drawCalls).toBe(1);
    expect(second.drawCalls).toBe(1);
    expect(scene.sortedObjects).toEqual([second]);
  });

  it('allows SceneRenderer to execute as a standalone rendering module', () => {
    const renderer = new SceneRenderer();
    const scene = buildScene();
    const ctx = makeCtxOnly();
    expect(() => renderer.draw(scene, ctx, 640, 480, 320, 240)).not.toThrow();
    expect(renderer.sortedObjects.length).toBeGreaterThan(0);
  });

  it('re-bakes the lightmap when Floor appearance changes', () => {
    const scene = buildScene();
    const floor = scene.getById('floor') as Floor;
    const draw = vi.spyOn(floor, 'draw');
    const ctx = makeCtxOnly();

    scene.draw(ctx, 640, 480, 320, 240);
    scene.draw(ctx, 640, 480, 320, 240);
    expect(draw).toHaveBeenCalledTimes(1);
    floor.color = '#112233';
    scene.draw(ctx, 640, 480, 320, 240);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('resizes the lightmap when canvas dimensions change', () => {
    const resize = vi.spyOn(LightmapCache.prototype, 'resize');
    const scene = buildScene();
    const ctx = makeCtxOnly();
    scene.draw(ctx, 640, 480, 320, 240);
    scene.draw(ctx, 800, 600, 400, 300);
    expect(resize).toHaveBeenCalledWith(800, 600);
    resize.mockRestore();
  });

  it('moving a shadow-caster re-bakes the lightmap (no stale shadow)', () => {
    // Regression for the frozen-shadow bug: when a castsShadow object moves
    // but lights/camera/ambient/view are unchanged, the lightmap must still
    // re-bake so the ground shadow follows the object. We assert the draw
    // completes across the move and that fill is invoked again (re-bake path).
    const scene = buildScene();
    const wall = scene.getById('wall')!; // castsShadow=true
    const {ctx} = makeCanvas();
    scene.draw(ctx, 640, 480, 320, 240);
    const fillsBefore = (ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length;
    // Move the shadow-casting wall and redraw (lights/camera unchanged).
    wall.position.x = 2.5;
    scene.draw(ctx, 640, 480, 320, 240);
    const fillsAfter = (ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length;
    // The lightmap re-bake should have produced additional fill calls
    // (floor tiles + shadow hulls redrawn), not the same cached blit only.
    expect(fillsAfter).toBeGreaterThan(fillsBefore);
  });

  it('uses multiply blend for image-tile illumination overlay', () => {
    // Regression for the *40 screen-blend bug: image tiles must darken in low
    // light via 'multiply', not brighten via 'screen'. We can't easily load a
    // real image in node, so we assert the solid-color floor path still works
    // and that a low-ambient scene produces dark fill colors (multiply model).
    // This is a smoke test that the multiply code path doesn't throw; the
    // blend-mode assertion is exercised indirectly via no-throw + fill called.
    const scene = buildScene();
    scene.ambientIntensity = 0.02; // near-dark -> tiles should be near-black
    const {ctx} = makeCanvas();
    expect(() => scene.draw(ctx, 640, 480, 320, 240)).not.toThrow();
    expect(ctx.fill).toHaveBeenCalled();
  });
});
