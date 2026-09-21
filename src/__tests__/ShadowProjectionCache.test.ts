import {describe, expect, it} from 'vitest';
import {Tree} from '../elements/props/Tree';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {OmniLight} from '../lighting/OmniLight';
import {ShadowProjectionCache} from '../../webgl-next/src/extraction/ShadowProjectionCache';

describe('WebGL shadow projection cache', () => {
  it('reuses static omni projections across frames, including cached misses', () => {
    const cache = new ShadowProjectionCache();
    const tree = new Tree({id: 'tree', x: 2.5, y: 2.5, heightPx: 72});
    const light = new OmniLight({x: 0.5, y: 2.5, z: 160, radius: 320, intensity: 1});
    const belowCaster = new OmniLight({x: 2.5, y: 2.5, z: 2, radius: 320, intensity: 1});

    const first = cache.projectOmni(tree, light, 64, 32);
    expect(cache.projectOmni(tree, light, 64, 32)).toBe(first);
    expect(cache.projectOmni(tree, belowCaster, 64, 32)).toBeNull();
    expect(cache.projectOmni(tree, belowCaster, 64, 32)).toBeNull();
    expect(cache.stats).toEqual({hits: 2, misses: 2});

    cache.beginFrame();
    expect(cache.projectOmni(tree, light, 64, 32)).toBe(first);
    expect(cache.stats).toEqual({hits: 1, misses: 0});
  });

  it('invalidates omni geometry when the caster, light, or projection scale changes', () => {
    const cache = new ShadowProjectionCache();
    const tree = new Tree({id: 'tree', x: 2.5, y: 2.5, heightPx: 72});
    const light = new OmniLight({x: 0.5, y: 2.5, z: 160, radius: 320, intensity: 1});
    const first = cache.projectOmni(tree, light, 64, 32);

    light.position.x = 1;
    const movedLight = cache.projectOmni(tree, light, 64, 32);
    tree.position.y += 0.5;
    const movedCaster = cache.projectOmni(tree, light, 64, 32);
    light.intensity = 0.5;
    const dimmed = cache.projectOmni(tree, light, 64, 32);
    const resized = cache.projectOmni(tree, light, 80, 40);

    expect(movedLight).not.toBe(first);
    expect(movedCaster).not.toBe(movedLight);
    expect(dimmed?.alpha).toBeLessThan(movedCaster!.alpha);
    expect(resized).not.toBe(dimmed);
    expect(cache.stats).toEqual({hits: 0, misses: 5});
  });

  it('reuses directional projections and invalidates angle, elevation, and caster changes', () => {
    const cache = new ShadowProjectionCache();
    const tree = new Tree({id: 'tree', x: 2, y: 2, heightPx: 64});
    const light = new DirectionalLight({angle: 220, elevation: 48, intensity: 0.5});
    const first = cache.projectDirectional(tree, light, 64, 32);

    expect(cache.projectDirectional(tree, light, 64, 32)).toBe(first);
    light.angle += 0.2;
    const rotated = cache.projectDirectional(tree, light, 64, 32);
    light.elevation -= 0.1;
    const lowered = cache.projectDirectional(tree, light, 64, 32);
    tree.position.x += 0.25;
    const movedCaster = cache.projectDirectional(tree, light, 64, 32);

    expect(rotated).not.toBe(first);
    expect(lowered).not.toBe(rotated);
    expect(movedCaster).not.toBe(lowered);
    expect(cache.stats).toEqual({hits: 1, misses: 4});
  });

  it('clears retained entries and counters explicitly', () => {
    const cache = new ShadowProjectionCache();
    const tree = new Tree({id: 'tree', x: 2, y: 2});
    const light = new DirectionalLight({angle: 220});

    cache.projectDirectional(tree, light, 64, 32);
    cache.clear();
    cache.projectDirectional(tree, light, 64, 32);

    expect(cache.stats).toEqual({hits: 0, misses: 1});
  });
});
