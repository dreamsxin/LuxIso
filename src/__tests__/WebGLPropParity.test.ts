import { describe, expect, it } from 'vitest';
import { Scene } from '../core/Scene';
import { Boulder } from '../elements/props/Boulder';
import { SceneExtractor } from '../../webgl-next/src/extraction/SceneExtractor';
import { RENDER_VERTEX_FLOATS } from '../../webgl-next/src/contracts/RenderSnapshot';


/**
 * Prop-level invariants at the extraction layer.
 *
 * The pixel gate cannot do this job, and that is measured rather than assumed:
 * `mossy-boulder` rebuilt at 34 px radius instead of 19 moves 1,102 pixels of a
 * 690,816-pixel canvas, while a legitimate shadow correction moves 935. No
 * whole-canvas budget can permit one and refuse the other.
 *
 * The `RenderSnapshot` is where that distinction is cheap. It is renderer-neutral
 * data, so a prop's silhouette can be measured exactly, with no browser, no
 * baseline and no threshold — and the extractor is where a size regression would
 * originate anyway.
 */

const TILE_W = 64;
const TILE_H = 32;

function viewport() {
  return {
    viewportWidth: 800,
    viewportHeight: 600,
    originX: 400,
    originY: 300,
    clearColor: '#000000',
  };
}

/** Screen-space bounds of the boulder's own vertices, relative to its anchor. */
function silhouette(radius: number): { above: number; below: number; width: number } {
  const scene = new Scene({ name: 'rock', tileW: TILE_W, tileH: TILE_H, cols: 8, rows: 8 });
  scene.addObject(new Boulder('rock', 4, 4, '#687b70', radius));
  const snapshot = new SceneExtractor().extract(scene, viewport());

  const data = snapshot.geometry.data;
  // Only the opaque range: a Scene brings its own floor, whose quads would
  // otherwise dominate the bounds.
  //
  // The anchor comes from the vertex `sample` attribute rather than from
  // `project()` plus the viewport origin. The extractor applies the camera
  // transform, so a hand-computed anchor is off by whatever the camera is doing
  // — which is a constant, and a constant is exactly what breaks a "scales with
  // radius" assertion. `sample` is the projected object centre in the same space
  // as the positions.
  const { first, count } = snapshot.geometry.opaque;
  const cy = data[first * RENDER_VERTEX_FLOATS + 3];

  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let v = first; v < first + count; v++) {
    const x = data[v * RENDER_VERTEX_FLOATS];
    const y = data[v * RENDER_VERTEX_FLOATS + 1];
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  return { above: cy - minY, below: maxY - cy, width: maxX - minX };
}



describe('Boulder — extracted silhouette', () => {
  /**
   * Positions live in a `Float32Array`, so everything measured here carries
   * float32 rounding: a value near 30 is exact to about 2e-6. Assertions use
   * precision 4 rather than 6 for that reason and no other.
   */
  const PRECISION = 4;

  it('scales with the radius, which is what the pixel gate cannot see', () => {
    const small = silhouette(19);
    const large = silhouette(38);

    expect(large.above / small.above).toBeCloseTo(2, PRECISION);
    expect(large.below / small.below).toBeCloseTo(2, PRECISION);
    expect(large.width / small.width).toBeCloseTo(2, PRECISION);
  });

  it('reaches Boulder.SQUASH above and below its anchor, as the 2D path draws it', () => {
    const R = 20;
    const { above, below } = silhouette(R);

    // Same numbers `Boulder.draw` produces and `aabb.maxZ` declares. Before the
    // parity pass the GL extractor had its own set — an ellipse centred
    // `0.42 * radius` above the anchor with a `0.72 * radius` vertical radius,
    // reaching `1.14 * radius` up and `0.30 * radius` down. The rock was a
    // different shape depending on which backend drew it, and `maxZ` matched
    // neither.
    expect(above).toBeCloseTo(R * Boulder.SQUASH, PRECISION);
    expect(below).toBeCloseTo(R * Boulder.SQUASH, PRECISION);
  });

  it('declares a maxZ that matches what it extracts', () => {
    const R = 26;
    const boulder = new Boulder('rock', 4, 4, '#687b70', R);
    expect(boulder.aabb.maxZ).toBeCloseTo(silhouette(R).above, PRECISION);
  });
});


