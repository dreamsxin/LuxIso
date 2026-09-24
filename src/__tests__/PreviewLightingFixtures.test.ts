import {describe, expect, it} from 'vitest';
import {Scene} from '../core/Scene';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {OmniLight} from '../lighting/OmniLight';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {
  applyPreviewLightingFixture,
  DEFAULT_PREVIEW_LIGHTING_FIXTURE_ID,
  getPreviewLightingFixture,
  PREVIEW_LIGHTING_FIXTURES,
  type PreviewDirectionalLightFixture,
  type PreviewOmniLightFixture,
} from '../../webgl-next/src/testing/PreviewLightingFixtures';

describe('WebGL preview lighting fixtures', () => {
  it('defines the complete deterministic camera and light coverage matrix', () => {
    const ids = PREVIEW_LIGHTING_FIXTURES.map(fixture => fixture.id);
    const rotations = PREVIEW_LIGHTING_FIXTURES
      .filter(fixture => fixture.id.startsWith('day-'))
      .map(fixture => fixture.view.rotation);

    expect(new Set(ids).size).toBe(ids.length);
    expect(rotations).toEqual([0, 90, 180, 270]);
    expect(ids).toEqual(expect.arrayContaining([
      'low-angle',
      'top-down',
      'night-lanterns',
      'global-only',
      'lights-off',
    ]));
    expect(getPreviewLightingFixture(DEFAULT_PREVIEW_LIGHTING_FIXTURE_ID)?.view.rotation).toBe(0);
    expect(getPreviewLightingFixture('missing')).toBeUndefined();
  });

  it('applies every fixture exactly without retaining prior light state', () => {
    const scene = fixtureScene();

    for (const fixture of [...PREVIEW_LIGHTING_FIXTURES].reverse()) {
      expect(applyPreviewLightingFixture(scene, fixture.id)).toBe(fixture);
      expect(scene.view).toEqual({
        rotation: fixture.view.rotation,
        elevation: fixture.view.elevation,
      });
      expect(scene.camera.zoom).toBe(fixture.view.zoom);
      expect(scene.ambientColor).toBe(fixture.ambient.color);
      expect(scene.ambientIntensity).toBe(fixture.ambient.intensity);

      for (const expected of fixture.directionalLights) {
        expectDirectionalState(scene, expected);
      }
      for (const expected of fixture.omniLights) {
        expectOmniState(scene, expected);
      }
    }
  });

  it('extracts only the global light and no disabled local or directional lights', () => {
    const scene = fixtureScene();
    const extractor = new SceneExtractor();

    applyPreviewLightingFixture(scene, 'global-only');
    const globalOnly = extractor.extract(scene, viewport());
    expect(globalOnly.omniLights).toHaveLength(1);
    expect(globalOnly.omniLights[0].global).toBe(true);
    expect(globalOnly.directionalLights).toHaveLength(0);

    applyPreviewLightingFixture(scene, 'lights-off');
    const lightsOff = extractor.extract(scene, viewport());
    expect(lightsOff.omniLights).toHaveLength(0);
    expect(lightsOff.directionalLights).toHaveLength(0);
    expect(lightsOff.geometry.shadows.count).toBe(0);
  });

  it('fails clearly when a fixture light is absent or has the wrong type', () => {
    const missing = new Scene();
    expect(() => applyPreviewLightingFixture(missing, 'day-ne')).toThrow(
      'WebGL preview fixture requires DirectionalLight #sun.'
    );

    missing.addLight(new OmniLight({id: 'sun', x: 0, y: 0, z: 0}));
    expect(() => applyPreviewLightingFixture(missing, 'day-ne')).toThrow(
      'WebGL preview fixture requires DirectionalLight #sun.'
    );
    expect(() => applyPreviewLightingFixture(fixtureScene(), 'unknown')).toThrow(
      'Unknown WebGL preview fixture: unknown.'
    );
  });
});

function fixtureScene(): Scene {
  const scene = new Scene({cols: 12, rows: 10, tileW: 64, tileH: 32});
  scene.addLight(new DirectionalLight({id: 'sun'}));
  scene.addLight(new OmniLight({id: 'work-light', x: -1, y: -1, z: -1}));
  scene.addLight(new OmniLight({id: 'lantern-west-light', x: -1, y: -1, z: -1}));
  scene.addLight(new OmniLight({id: 'lantern-east-light', x: -1, y: -1, z: -1}));
  scene.addLight(new OmniLight({id: 'sky-fill', x: -1, y: -1, z: -1}));
  return scene;
}

function expectDirectionalState(scene: Scene, expected: PreviewDirectionalLightFixture): void {
  const light = scene.getLightById(expected.id);
  expect(light).toBeInstanceOf(DirectionalLight);
  const directional = light as DirectionalLight;
  expect(directional.enabled).toBe(expected.enabled);
  expect(radiansToDegrees(directional.angle)).toBeCloseTo(expected.angle);
  expect(radiansToDegrees(directional.elevation)).toBeCloseTo(expected.elevation);
  expect(directional.color).toBe(expected.color);
  expect(directional.intensity).toBe(expected.intensity);
}

function expectOmniState(scene: Scene, expected: PreviewOmniLightFixture): void {
  const light = scene.getLightById(expected.id);
  expect(light).toBeInstanceOf(OmniLight);
  const omni = light as OmniLight;
  expect(omni.enabled).toBe(expected.enabled);
  expect(omni.position).toEqual({x: expected.x, y: expected.y, z: expected.z});
  expect(omni.radius).toBe(expected.radius);
  expect(omni.color).toBe(expected.color);
  expect(omni.intensity).toBe(expected.intensity);
  expect(omni.falloff).toBe(expected.falloff);
  expect(omni.isGlobal).toBe(expected.isGlobal);
}

function radiansToDegrees(value: number): number {
  return value * 180 / Math.PI;
}

function viewport() {
  return {viewportWidth: 800, viewportHeight: 600, originX: 400, originY: 120};
}
