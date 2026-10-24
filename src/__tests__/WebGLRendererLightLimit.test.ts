import {describe, expect, it} from 'vitest';
import {Scene} from '../core/Scene';
import {Floor} from '../elements/Floor';
import {OmniLight} from '../lighting/OmniLight';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {WebGLRenderer} from '../../webgl-next/src/renderer/WebGLRenderer';
import {MAX_OMNI_LIGHTS} from '../../webgl-next/src/contracts/RenderSnapshot';
import {createFakeGL} from './helpers/gl';

/**
 * The omni-light uniform clamp, exercised against a real snapshot — no browser.
 *
 * The renderer used to hard-pack 8 lights in both the shader and the JS side,
 * while ACCEPTANCE.md names a 16-light reference workload, and the clamped
 * count was reported back as the number of lights in the scene (so the stats
 * could not tell "16 lit" from "16 of 20 lit"). These assertions hold both
 * ends: the shader uploads exactly MAX_OMNI_LIGHTS and the overflow is counted
 * separately instead of disappearing silently.
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

function litScene(lightCount: number): Scene {
  const scene = new Scene({tileW: 64, tileH: 32, cols: 8, rows: 8});
  scene.addObject(new Floor({id: 'floor', cols: 8, rows: 8, color: '#4a7c59', altColor: '#3d6b4a'}));
  for (let i = 0; i < lightCount; i++) {
    scene.addLight(new OmniLight({
      id: `light-${i}`,
      x: (i % 8) + 0.5,
      y: Math.floor(i / 8) + 0.5,
      z: 120,
      radius: 200,
      intensity: 1,
      color: '#ffffff',
    }));
  }
  return scene;
}

describe('WebGLRenderer — omni light capacity', () => {
  it('matches the 16-light reference workload the acceptance budget names', () => {
    expect(MAX_OMNI_LIGHTS).toBe(16);
  });

  it('uploads exactly the cap and counts the overflow instead of hiding it', () => {
    const fake = createFakeGL();
    const renderer = new WebGLRenderer(canvasFor(fake.gl));
    try {
      renderer.resize(800, 600, 1);
      const snapshot = new SceneExtractor().extract(litScene(20), {
        viewportWidth: 800,
        viewportHeight: 600,
        originX: 400,
        originY: 300,
      });
      expect(snapshot.omniLights).toHaveLength(20);

      renderer.render(snapshot);
      expect(renderer.stats.omniLights).toBe(16);
      expect(renderer.stats.omniLightsDropped).toBe(4);

      const countUpload = fake.uniform1iCalls.find(call => call.name === 'uOmniCount');
      expect(countUpload?.value).toBe(16);
      const positions = fake.uniform2fvCalls.find(call => call.name === 'uOmniPosition[0]');
      expect(positions?.value).toHaveLength(MAX_OMNI_LIGHTS * 2);
    } finally {
      renderer.dispose();
    }
  });

  it('reports zero dropped lights at or below capacity', () => {
    const fake = createFakeGL();
    const renderer = new WebGLRenderer(canvasFor(fake.gl));
    try {
      renderer.resize(800, 600, 1);
      const snapshot = new SceneExtractor().extract(litScene(12), {
        viewportWidth: 800,
        viewportHeight: 600,
        originX: 400,
        originY: 300,
      });
      renderer.render(snapshot);
      expect(renderer.stats.omniLights).toBe(12);
      expect(renderer.stats.omniLightsDropped).toBe(0);
    } finally {
      renderer.dispose();
    }
  });
});
