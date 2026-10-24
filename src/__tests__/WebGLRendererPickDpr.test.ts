import {describe, expect, it} from 'vitest';
import {Scene} from '../core/Scene';
import {Floor} from '../elements/Floor';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {WebGLRenderer} from '../../webgl-next/src/renderer/WebGLRenderer';
import {createFakeGL} from './helpers/gl';

/**
 * Picking speaks CSS pixels; the readback happens in device pixels.
 *
 * `pick(x, y)` has to multiply both coordinates by the renderer's dpr (and flip
 * Y for GL's bottom-left origin). The editor preview fed it CSS coordinates
 * while pinning its renderer to dpr 1, which only happened to line up at DPR 1.
 * This pins the mapping with the same fake GL the resource tests use.
 */

function canvasFor(gl: WebGL2RenderingContext): HTMLCanvasElement {
  return {
    width: 1,
    height: 1,
    style: {},
    getContext: () => gl,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement;
}

describe('WebGLRenderer.pick — DPR scaling', () => {
  it('scales CSS coordinates into device pixels and flips Y', () => {
    const fake = createFakeGL();
    const renderer = new WebGLRenderer(canvasFor(fake.gl));
    try {
      renderer.resize(800, 600, 2); // backing store 1600×1200
      const scene = new Scene({cols: 4, rows: 4});
      scene.addObject(new Floor({id: 'floor', cols: 4, rows: 4}));
      const snapshot = new SceneExtractor().extract(scene, {
        viewportWidth: 800,
        viewportHeight: 600,
        originX: 400,
        originY: 300,
      });
      renderer.render(snapshot);

      renderer.pick(100, 50);
      // readPixels(x, y): 100 CSS px * 2 = 200; GL origin is bottom-left, so
      // 1200 - 1 - 50 * 2 = 1099.
      expect(fake.lastReadPixels).toMatchObject({x: 200, y: 1099, w: 1, h: 1});
    } finally {
      renderer.dispose();
    }
  });

  it('rejects out-of-range CSS points after scaling', () => {
    const fake = createFakeGL();
    const renderer = new WebGLRenderer(canvasFor(fake.gl));
    try {
      renderer.resize(40, 30, 2); // backing 80×60
      const scene = new Scene({cols: 2, rows: 2});
      scene.addObject(new Floor({id: 'floor', cols: 2, rows: 2}));
      const snapshot = new SceneExtractor().extract(scene, {
        viewportWidth: 40,
        viewportHeight: 30,
        originX: 20,
        originY: 15,
      });
      renderer.render(snapshot);

      expect(renderer.pick(39.9, 15)).toBeNull(); // *2 = 79.8 → floor 79, in range; then empty pixel → null
      expect(fake.lastReadPixels).toMatchObject({x: 79, y: 29});
      expect(renderer.pick(45, 0)).toBeNull(); // past the CSS edge, no readback
    } finally {
      renderer.dispose();
    }
  });
});
