import {describe, expect, it} from 'vitest';
import {Scene} from '../core/Scene';
import {Character} from '../elements/Character';
import {Floor} from '../elements/Floor';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {computeShadowMaskCacheKey} from '../../webgl-next/src/renderer/ShadowMaskCacheKey';

describe('WebGL shadow-mask cache key', () => {
  it('is stable for a static snapshot and ignores non-shadow vertex changes', () => {
    const {snapshot} = fixture();
    const first = computeShadowMaskCacheKey(snapshot, 800, 600);
    const opaqueOffset = snapshot.geometry.opaque.first * 17;
    snapshot.geometry.data[opaqueOffset + 4] += 0.1;

    expect(computeShadowMaskCacheKey(snapshot, 800, 600)).toBe(first);
  });

  it('invalidates for shadow geometry, camera, and render-target changes', () => {
    const {scene, extractor, snapshot} = fixture();
    const first = computeShadowMaskCacheKey(snapshot, 800, 600);
    const shadowOffset = snapshot.geometry.shadows.first * 17;
    snapshot.geometry.data[shadowOffset] += 0.25;
    const geometryChanged = computeShadowMaskCacheKey(snapshot, 800, 600);

    const moved = scene.getById('runner') as Character;
    moved.position.x += 0.5;
    const movedSnapshot = extractor.extract(scene, viewport());
    const movedKey = computeShadowMaskCacheKey(movedSnapshot, 800, 600);
    movedSnapshot.camera.rotation = 90;

    expect(geometryChanged).not.toBe(first);
    expect(movedKey).not.toBe(first);
    expect(computeShadowMaskCacheKey(movedSnapshot, 800, 600)).not.toBe(movedKey);
    expect(computeShadowMaskCacheKey(movedSnapshot, 1600, 1200)).not.toBe(
      computeShadowMaskCacheKey(movedSnapshot, 800, 600)
    );
  });
});

function fixture() {
  const scene = new Scene({cols: 4, rows: 4, tileW: 64, tileH: 32});
  scene.addObject(new Floor({id: 'floor', cols: 4, rows: 4}));
  scene.addObject(new Character({id: 'runner', x: 2, y: 2}));
  scene.addLight(new DirectionalLight({angle: 220, elevation: 45, intensity: 0.5}));
  const extractor = new SceneExtractor();
  return {scene, extractor, snapshot: extractor.extract(scene, viewport())};
}

function viewport() {
  return {viewportWidth: 800, viewportHeight: 600, originX: 400, originY: 140};
}
