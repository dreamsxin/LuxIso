import { describe, expect, it } from 'vitest';
import { Scene } from '../core/Scene';
import { Character } from '../elements/Character';
import { Floor } from '../elements/Floor';
import { type DrawContext, IsoObject } from '../elements/IsoObject';
import { Wall } from '../elements/Wall';
import { Boulder } from '../elements/props/Boulder';
import { Chest } from '../elements/props/Chest';
import { Cloud } from '../elements/props/Cloud';
import { Crystal } from '../elements/props/Crystal';
import { Tree } from '../elements/props/Tree';
import { FlowerPatch } from '../elements/props/FlowerPatch';
import { Lantern } from '../elements/props/Lantern';
import { DirectionalLight } from '../lighting/DirectionalLight';
import { OmniLight } from '../lighting/OmniLight';
import type { AABB } from '../math/depthSort';
import { SceneExtractor } from '../../webgl-next/src/extraction/SceneExtractor';

describe('WebGL Next SceneExtractor', () => {
  it('extracts every migrated built-in into ordered render ranges', () => {
    const scene = builtInScene();
    const extractor = new SceneExtractor();
    const snapshot = extractor.extract(scene, viewport());
    const ranges = snapshot.geometry;

    expect(ranges.floor.count).toBeGreaterThan(0);
    expect(ranges.shadows.count).toBeGreaterThan(0);
    expect(ranges.opaque.count).toBeGreaterThan(0);
    expect(ranges.transparent.count).toBeGreaterThan(0);
    expect(ranges.floor.first).toBe(0);
    expect(ranges.shadows.first).toBe(ranges.floor.count);
    expect(ranges.opaque.first).toBe(ranges.shadows.first + ranges.shadows.count);
    expect(ranges.transparent.first).toBe(ranges.opaque.first + ranges.opaque.count);
    expect(ranges.transparent.first + ranges.transparent.count).toBe(ranges.vertexCount);
    expect(snapshot.pickLookup.size).toBe(scene.allObjects.length + 1);
    expect([...snapshot.pickLookup.values()]).toContain('omni');
    expect(snapshot.unsupported).toEqual([]);
    expect(snapshot.omniLights).toHaveLength(1);
    expect(snapshot.directionalLights).toHaveLength(1);
    expect([...snapshot.pickLookup.values()]).toEqual(expect.arrayContaining([
      'tree', 'flowers', 'lantern',
    ]));
  });

  it('keeps object picking IDs and the geometry arena stable across frames', () => {
    const scene = builtInScene();
    const extractor = new SceneExtractor();
    const first = extractor.extract(scene, viewport());
    const characterPickId = findPickId(first.pickLookup, 'character');
    const arena = first.geometry.data;
    scene.camera.x = 2;
    const second = extractor.extract(scene, viewport());

    expect(findPickId(second.pickLookup, 'character')).toBe(characterPickId);
    expect(second.geometry.data).toBe(arena);
    expect(second.frame).toBe(first.frame + 1);
    expect(second.camera.worldX).toBe(2);
  });

  it('reuses static projected shadows and invalidates a moving caster only', () => {
    const scene = builtInScene();
    const extractor = new SceneExtractor();
    extractor.extract(scene, viewport());
    const firstFrameMisses = extractor.shadowCacheStats.misses;

    extractor.extract(scene, viewport());
    expect(firstFrameMisses).toBeGreaterThan(0);
    expect(extractor.shadowCacheStats.hits).toBe(firstFrameMisses);
    expect(extractor.shadowCacheStats.misses).toBe(0);

    const character = scene.getById('character') as Character;
    character.position.x += 0.25;
    extractor.extract(scene, viewport());
    expect(extractor.shadowCacheStats.misses).toBe(2);
    expect(extractor.shadowCacheStats.hits).toBe(firstFrameMisses - 2);
  });

  it('reports custom objects and emits visible diagnostic geometry', () => {
    const scene = new Scene({ cols: 2, rows: 2 });
    scene.addObject(new DiagnosticObject('custom', 1, 1));
    const snapshot = new SceneExtractor().extract(scene, viewport());

    expect(snapshot.unsupported).toEqual([{
      id: 'custom',
      type: 'DiagnosticObject',
      reason: 'No WebGL geometry extractor is registered for this object type. '
        + 'Register one with SceneExtractor.register(Ctor, fn).',
    }]);
    expect(snapshot.geometry.opaque.count).toBe(6);
    expect([...snapshot.pickLookup.values()]).toContain('custom');
  });

  it('emits sealed, non-degenerate crystal faces around the center ridge', () => {
    const scene = new Scene({ cols: 2, rows: 2, tileW: 64, tileH: 32 });
    scene.addObject(new Crystal('crystal', 1, 1, '#8060e0', 48));
    const geometry = new SceneExtractor().extract(scene, viewport()).geometry;
    const { first, count } = geometry.opaque;

    expect(count).toBe(33);
    for (let vertex = first; vertex < first + count; vertex += 3) {
      const a = vertexPoint(geometry.data, vertex);
      const b = vertexPoint(geometry.data, vertex + 1);
      const c = vertexPoint(geometry.data, vertex + 2);
      const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      expect(twiceArea).toBeGreaterThan(0.1);
    }
  });
});

function builtInScene(): Scene {
  const scene = new Scene({ tileW: 64, tileH: 32, cols: 4, rows: 4 });
  scene.addObject(new Floor({ id: 'floor', cols: 4, rows: 4, color: '#345645' }));
  scene.addObject(new Wall({ id: 'wall', x: 0, y: 0, endX: 3, endY: 0 }));
  scene.addObject(new Character({ id: 'character', x: 1, y: 1 }));
  scene.addObject(new Crystal('crystal', 2, 1));
  scene.addObject(new Boulder('boulder', 2, 2));
  scene.addObject(new Chest('chest', 1, 2));
  scene.addObject(new Tree({ id: 'tree', x: 0.8, y: 2.8 }));
  scene.addObject(new FlowerPatch({ id: 'flowers', x: 2.8, y: 0.8, seed: 2 }));
  scene.addObject(new Lantern({ id: 'lantern', x: 2.8, y: 2.8 }));
  scene.addObject(new Cloud({ id: 'cloud', x: 3, y: 2 }));
  scene.addLight(new OmniLight({ id: 'omni', x: 2, y: 2, z: 64 }));
  scene.addLight(new DirectionalLight({ id: 'sun', angle: 220 }));
  return scene;
}

function vertexPoint(data: Float32Array, vertex: number): readonly [number, number] {
  const offset = vertex * 17;
  return [data[offset], data[offset + 1]];
}

function viewport() {
  return { viewportWidth: 800, viewportHeight: 600, originX: 400, originY: 120 };
}

function findPickId(lookup: ReadonlyMap<number, string>, objectId: string): number {
  const match = [...lookup].find(([, id]) => id === objectId);
  if (!match) throw new Error(`Missing pick ID for ${objectId}.`);
  return match[0];
}

class DiagnosticObject extends IsoObject {
  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.5,
      minY: this.position.y - 0.5,
      maxX: this.position.x + 0.5,
      maxY: this.position.y + 0.5,
      baseZ: 0,
      maxZ: 1,
    };
  }

  draw(_context: DrawContext): void {}
}
