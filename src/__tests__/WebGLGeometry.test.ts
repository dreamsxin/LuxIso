import { describe, expect, it } from 'vitest';
import { RENDER_VERTEX_FLOATS } from '../../webgl-next/src/contracts/RenderSnapshot';
import {
  decodePickId,
  encodePickId,
  GeometryBuilder,
} from '../../webgl-next/src/extraction/GeometryBuilder';
import { projectIso } from '../../webgl-next/src/extraction/projection';
import { project } from '../math/IsoProjection';

describe('WebGL Next geometry contracts', () => {
  it('projects identically to the Canvas2D path, in pixels', () => {
    // The extraction path used to take "world Z" and multiply it by tileH/2,
    // while a separate helper divided pixels by a hardcoded 16. Those cancelled
    // only at tileH=32; anywhere else the two backends placed z differently.
    for (const [tw, th] of [[64, 32], [64, 64], [128, 48]] as const) {
      for (const z of [0, 32, 48]) {
        const canvas = project(2, 1, z, tw, th);
        const webgl = projectIso(2, 1, z, tw, th);
        expect(webgl.x).toBeCloseTo(canvas.sx, 10);
        expect(webgl.y).toBeCloseTo(canvas.sy, 10);
      }
    }
  });

  it('subtracts z from the screen Y directly', () => {
    expect(projectIso(2, 1, 0, 64, 32)).toEqual({ x: 32, y: 48 });
    expect(projectIso(2, 1, 32, 64, 32)).toEqual({ x: 32, y: 16 });
  });


  it('encodes the complete 24-bit picking ID range', () => {
    for (const id of [0, 1, 255, 256, 65_535, 0xabcdef, 0xffffff]) {
      const encoded = encodePickId(id);
      expect(decodePickId(
        Math.round(encoded[0] * 255),
        Math.round(encoded[1] * 255),
        Math.round(encoded[2] * 255),
      )).toBe(id);
    }
  });

  it('builds contiguous ranges and grows its reusable arena', () => {
    const builder = new GeometryBuilder();
    const floorStart = builder.mark();
    builder.quad([0, 0], [1, 0], [1, 1], [0, 1], {
      color: [1, 0, 0, 1], sample: [0.5, 0.5], pickId: 41,
    });
    const floor = builder.range(floorStart);
    const opaqueStart = builder.mark();
    for (let i = 0; i < 220; i++) {
      builder.ellipse([i, i], 4, 2, {
        color: [0, 1, 0, 1], sample: [i, i], pickId: i + 1,
      }, 8);
    }
    const opaque = builder.range(opaqueStart);
    const geometry = builder.geometry(floor, { first: floor.count, count: 0 }, opaque);

    expect(floor).toEqual({ first: 0, count: 6 });
    expect(opaque.first).toBe(6);
    expect(geometry.vertexCount).toBe(6 + 220 * 8 * 3);
    expect(geometry.data.length).toBeGreaterThanOrEqual(geometry.vertexCount * RENDER_VERTEX_FLOATS);
    expect(geometry.data[11]).toBeCloseTo(41 / 255);
  });
});
