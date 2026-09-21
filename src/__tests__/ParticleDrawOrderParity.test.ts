import {describe, expect, it} from 'vitest';
import {ParticleSystem} from '../animation/ParticleSystem';
import {Scene} from '../core/Scene';
import {Floor} from '../elements/Floor';
import {Wall} from '../elements/Wall';
import type {EmitterConfig} from '../animation/ParticleSystem';
import {topoSort} from '../math/depthSort';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {decodePickId} from '../../webgl-next/src/extraction/GeometryBuilder';
import {RENDER_VERTEX_FLOATS, type RenderSnapshot} from '../../webgl-next/src/contracts/RenderSnapshot';

/**
 * Both backends must order an emitter by where it stands.
 *
 * Canvas2D always did: a `ParticleSystem` is an `IsoObject` and goes through
 * `topoSort` like anything else. The WebGL2 extractor used to skip particles and
 * clouds in the pass that walks the sorted list and re-visit them afterwards, so
 * their vertices always landed in the `transparent` range — and since the
 * renderer runs with `DEPTH_TEST` disabled and relies purely on submission
 * order, an emitter standing behind a wall was painted over it. Picking
 * inherited the same order, so a particle behind a character stole its clicks.
 *
 * Nothing pinned either behaviour before this file, which is why the two were
 * free to drift apart. The extractor now makes one pass over the sorted list;
 * the tests below hold both backends to the same answer, from opposite sides:
 * `topoSort` order on the Canvas2D side, vertex submission order on the GL side.
 *
 * Note for whoever regenerates the pixel baselines: this change moves every
 * particle and cloud in the preview scene, so all nine fixtures shift and the
 * three committed PNGs have to be re-minted through the `webgl-baselines`
 * workflow. See `webgl-next/ROADMAP.md`, Phase 5.
 */

/** An emitter that spawns only on `burst` and whose particles outlive a test. */
function stillEmitter(): EmitterConfig {
  return {
    rate: 0,
    life: [10, 10],
    speed: [1, 1],
    size: [8, 8],
    color: ['#ffffff'],
    gravity: 0,
  };
}

function emitterAt(id: string, x: number, y: number): ParticleSystem {
  const system = new ParticleSystem(id, x, y, 0);
  system.addEmitter(stillEmitter());
  return system;
}

/** A wall along y = 1, so an emitter at y < 1 is behind it and y > 1 in front. */
function wall(): Wall {
  return new Wall({id: 'wall', x: 0, y: 1, endX: 3, endY: 1});
}

function viewport() {
  return {viewportWidth: 800, viewportHeight: 600, originX: 400, originY: 120};
}

/** Extract a floor + wall + emitter scene and locate each one's first vertex. */
function extractWith(x: number, y: number) {
  const emitter = emitterAt('fx', x, y);
  emitter.burst(6);
  const scene = new Scene({tileW: 64, tileH: 32, cols: 4, rows: 4});
  scene.addObject(new Floor({id: 'floor', cols: 4, rows: 4, color: '#345645'}));
  scene.addObject(wall());
  scene.addObject(emitter);

  const snapshot = new SceneExtractor().extract(scene, viewport());
  return {
    snapshot,
    particleVertex: firstVertexOf(snapshot, 'fx'),
    wallVertex: firstVertexOf(snapshot, 'wall'),
  };
}

/**
 * Index of the first vertex carrying an object's pick ID.
 *
 * The pick ID is encoded into three colour channels as bytes over 255, so it can
 * be read back out of the arena — which makes submission order observable
 * without a GL context.
 */
function firstVertexOf(snapshot: RenderSnapshot, objectId: string): number {
  const entry = [...snapshot.pickLookup].find(([, id]) => id === objectId);
  if (!entry) {throw new Error(`Missing pick ID for ${objectId}.`);}
  const wanted = entry[0];
  const {data, vertexCount} = snapshot.geometry;

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * RENDER_VERTEX_FLOATS;
    const id = decodePickId(
      Math.round(data[offset + 11] * 255),
      Math.round(data[offset + 12] * 255),
      Math.round(data[offset + 13] * 255)
    );
    if (id === wanted) {return vertex;}
  }
  throw new Error(`No vertex carries the pick ID of ${objectId}.`);
}

describe('Canvas2D — an emitter is sorted by where it stands', () => {
  it('draws an emitter behind a wall before the wall', () => {
    const behind = emitterAt('fx-behind', 1.5, 0.2);
    const sorted = topoSort([wall(), behind]);
    const ids = sorted.map(object => object.id);

    expect(ids.indexOf('fx-behind')).toBeLessThan(ids.indexOf('wall'));
  });

  it('draws an emitter in front of a wall after the wall', () => {
    const front = emitterAt('fx-front', 1.5, 2.5);
    const sorted = topoSort([wall(), front]);
    const ids = sorted.map(object => object.id);

    expect(ids.indexOf('fx-front')).toBeGreaterThan(ids.indexOf('wall'));
  });
});

describe('WebGL2 — an emitter is submitted where it stands', () => {
  it('submits an emitter behind a wall before the wall', () => {
    const {snapshot, particleVertex, wallVertex} = extractWith(1.5, 0.2);
    const {opaque} = snapshot.geometry;

    expect(particleVertex).toBeGreaterThanOrEqual(opaque.first);
    expect(particleVertex).toBeLessThan(opaque.first + opaque.count);
    expect(particleVertex).toBeLessThan(wallVertex);
  });

  it('submits an emitter in front of a wall after the wall', () => {
    const {particleVertex, wallVertex} = extractWith(1.5, 2.5);

    expect(particleVertex).toBeGreaterThan(wallVertex);
  });

  it('leaves only order-independent halos in the transparent range', () => {
    const {snapshot} = extractWith(1.5, 0.2);

    // No lights in this scene, so there is nothing left to defer.
    expect(snapshot.geometry.transparent.count).toBe(0);
  });

  it('gives particles a pick ID, now resolved in the same order as the geometry', () => {
    const {snapshot} = extractWith(1.5, 0.2);

    expect([...snapshot.pickLookup.values()]).toContain('fx');
  });
});

describe('Canvas2D — a live emitter defeats the sort cache', () => {
  it('reports a different AABB once its particles have moved', () => {
    const system = emitterAt('fx', 2, 2);
    system.burst(8);
    const before = system.aabb;

    system.update(1_000);
    system.update(1_100);
    const after = system.aabb;

    // `SceneRenderer._computeObjectHash` folds min/max/baseZ into the sort hash,
    // so an emitter whose footprint grows every frame forces `topoSort` to run
    // every frame for the whole scene. That is the cost side of taking part in
    // the ordering, and it is why "move particles out of the sort" is a real
    // option rather than obviously wrong.
    const moved = before.minX !== after.minX || before.maxX !== after.maxX
      || before.minY !== after.minY || before.maxY !== after.maxY;
    expect(moved).toBe(true);
  });
});

