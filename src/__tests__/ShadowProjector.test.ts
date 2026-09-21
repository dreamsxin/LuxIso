import {describe, expect, it} from 'vitest';
import {Tree} from '../elements/props/Tree';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {OmniLight} from '../lighting/OmniLight';
import {
  clipShadowHullToScene,
  projectDirectionalShadow,
  projectOmniShadow,
} from '../../webgl-next/src/extraction/ShadowProjector';

describe('WebGL projected shadow geometry', () => {
  it('projects an omni-light shadow away from the moving light source', () => {
    const tree = new Tree({id: 'tree', x: 2.5, y: 2.5, heightPx: 72});
    const leftLight = new OmniLight({id: 'left', x: 0.5, y: 2.5, z: 160, radius: 320, intensity: 1});
    const rightLight = new OmniLight({id: 'right', x: 5.5, y: 2.5, z: 160, radius: 320, intensity: 1});
    const left = projectOmniShadow(tree, leftLight, 64, 32);
    const right = projectOmniShadow(tree, rightLight, 64, 32);

    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.hull.length).toBeGreaterThanOrEqual(4);
    expect(right!.hull.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...left!.hull.map(point => point[0]))).toBeGreaterThan(
      Math.max(...right!.hull.map(point => point[0]))
    );
  });

  it('projects directional shadows and skips a light below the caster', () => {
    const tree = new Tree({id: 'tree', x: 2, y: 2, heightPx: 64});
    const directional = new DirectionalLight({angle: 220, elevation: 48, intensity: 0.5});
    const projected = projectDirectionalShadow(tree, directional, 64, 32);
    const lowLight = new OmniLight({x: 2, y: 2, z: 4, radius: 320, intensity: 1});

    expect(projected).not.toBeNull();
    expect(projected!.alpha).toBeGreaterThan(0);
    expect(projectOmniShadow(tree, lowLight, 64, 32)).toBeNull();
  });

  it('clips long projections to the scene floor diamond', () => {
    const clipped = clipShadowHullToScene([
      [-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000],
    ], 4, 4, 64, 32);

    expect(clipped).toHaveLength(4);
    expect(Math.min(...clipped.map(point => point[0]))).toBe(-128);
    expect(Math.max(...clipped.map(point => point[0]))).toBe(128);
    expect(Math.min(...clipped.map(point => point[1]))).toBeCloseTo(0);
    expect(Math.max(...clipped.map(point => point[1]))).toBeCloseTo(128);
  });
});
