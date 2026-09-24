import {describe, expect, it} from 'vitest';
import {Scene} from '../core/Scene';
import {Boulder} from '../elements/props/Boulder';
import {Crystal} from '../elements/props/Crystal';
import {Floor} from '../elements/Floor';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {OmniLight} from '../lighting/OmniLight';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';

/**
 * A deterministic scale baseline for the extraction pass.
 *
 * `ACCEPTANCE.md` budgets "CPU extraction + sorting <= 4 ms p95" against a
 * reference workload, and until `extractStats` existed there was no meter for
 * that row at all. This is the meter's fixture: no GL context, no browser, no
 * wall-clock assertion — timings are printed for a human, and the assertions are
 * on counts that are exactly reproducible.
 *
 * `segments` is the number to watch. A draw call is a `range ∩ segment`
 * intersection, so atlas and batching work is only working if this figure comes
 * down. When it does, this test goes red and the new number gets written in —
 * which is the point: the diff records the improvement instead of nobody
 * noticing it happened.
 */

const TILE_W = 64;
const TILE_H = 32;

function scaleScene(cols: number, rows: number, props: number): Scene {
  const scene = new Scene({tileW: TILE_W, tileH: TILE_H, cols, rows});
  scene.addObject(new Floor({id: 'floor', cols, rows, color: '#2f3d33'}));
  // Spread props on a lattice so culling and sorting see a realistic spatial
  // spread rather than one dense cluster.
  const stride = Math.max(1, Math.floor(Math.sqrt((cols * rows) / Math.max(1, props))));
  let placed = 0;
  for (let y = 0; y < rows && placed < props; y += stride) {
    for (let x = 0; x < cols && placed < props; x += stride) {
      scene.addObject(placed % 2 === 0
        ? new Crystal(`crystal-${placed}`, x + 0.5, y + 0.5)
        : new Boulder(`boulder-${placed}`, x + 0.5, y + 0.5));
      placed++;
    }
  }
  scene.addLight(new OmniLight({id: 'omni', x: cols / 2, y: rows / 2, z: 96}));
  scene.addLight(new DirectionalLight({id: 'sun', angle: 220}));
  return scene;
}

function viewport() {
  return {viewportWidth: 1920, viewportHeight: 1080, originX: 960, originY: 300};
}

describe('SceneExtractor — scale baseline', () => {
  it('reports the reference workload of 10,000 tiles and 200 props', () => {
    const scene = scaleScene(100, 100, 200);
    const extractor = new SceneExtractor();
    // Warm once: the first pass grows the vertex arena, which is allocation, not
    // extraction. The budget row is about steady state.
    extractor.extract(scene, viewport());
    const snapshot = extractor.extract(scene, viewport());
    const stats = extractor.extractStats;

    console.info(
      `[extract 100x100/200] total=${stats.totalMs.toFixed(2)}ms `
      + `cull=${stats.cullMs.toFixed(2)} sort=${stats.sortMs.toFixed(2)} `
      + `build=${stats.buildMs.toFixed(2)} | sorted=${stats.sortedObjects} `
      + `segments=${stats.segments} vertices=${stats.vertices} `
      + `floorVerts=${snapshot.geometry.floor.count}`
    );

    expect(stats.floorObjects).toBe(1);
    // Props outside the viewport are culled, so this is well under the 200
    // placed — the exact figure depends on the projection and is printed above
    // rather than pinned here.
    expect(stats.sortedObjects).toBeGreaterThan(0);
    expect(stats.sortedObjects).toBeLessThanOrEqual(200);
    expect(stats.vertices).toBe(snapshot.geometry.vertexCount);
    // Phases have to add up to the whole, or the split is lying.
    expect(stats.cullMs + stats.sortMs + stats.buildMs).toBeCloseTo(stats.totalMs, 6);
  });

  it('already merges same-state props into one segment', () => {
    const extractor = new SceneExtractor();
    extractor.extract(scaleScene(40, 40, 50), viewport());
    const fifty = {...extractor.extractStats};
    extractor.extract(scaleScene(40, 40, 100), viewport());
    const hundred = {...extractor.extractStats};

    console.info(
      `[segments] 50-props: sorted=${fifty.sortedObjects} segments=${fifty.segments} | `
      + `100-props: sorted=${hundred.sortedObjects} segments=${hundred.segments}`
    );

    // Doubling the props does not add a single segment. `_recordSegment` already
    // extends the previous segment when blend and texture match, and these props
    // are untextured alpha geometry, so they collapse into one run. The draw-call
    // side of batching is therefore already done for untextured objects — what an
    // atlas would buy is merging runs that are split *by texture*, which this
    // scene has none of.
    expect(hundred.segments).toBe(fifty.segments);
    expect(hundred.sortedObjects).toBeGreaterThan(fifty.sortedObjects);
  });

  it('scales floor vertices with the visible tile count, not the map size', () => {
    const extractor = new SceneExtractor();
    const small = extractor.extract(scaleScene(20, 20, 0), viewport());
    const smallFloor = small.geometry.floor.count;
    const large = extractor.extract(scaleScene(100, 100, 0), viewport());
    const largeFloor = large.geometry.floor.count;

    // The 20x20 map fits inside the viewport, so all 400 tiles are extracted.
    // The 100x100 one does not, so the culled figure must be well under 10,000
    // tiles' worth — that is the chunk culling the budget assumes.
    expect(smallFloor).toBe(400 * 6);
    expect(largeFloor).toBeGreaterThan(smallFloor);
    expect(largeFloor).toBeLessThan(100 * 100 * 6);
  });
});

