import {describe, expect, it} from 'vitest';
import {EditorWebGLPreview} from '../../webgl-next/src/editor/EditorWebGLPreview';

/**
 * The editor preview's frame sizing, without a WebGL context.
 *
 * `resolveFrame` is the decision that used to read the 2-D canvas's *backing*
 * size as CSS pixels and pin dpr to 1 — at DPR 2 the GL backing came out half
 * size and CSS-coordinate picking addressed the wrong texels. Constructing the
 * whole preview needs a GL device; this static decision does not, so it gets
 * tested directly.
 */
describe('EditorWebGLPreview.resolveFrame', () => {
  it('uses the CSS box and the supplied DPR', () => {
    expect(EditorWebGLPreview.resolveFrame(800, 600, 2)).toEqual({
      cssWidth: 800,
      cssHeight: 600,
      dpr: 2,
    });
  });

  it('clamps DPR to [1, 2], matching Engine.maxPixelRatio', () => {
    expect(EditorWebGLPreview.resolveFrame(100, 100, 0.5)?.dpr).toBe(1);
    expect(EditorWebGLPreview.resolveFrame(100, 100, 3)?.dpr).toBe(2);
    expect(EditorWebGLPreview.resolveFrame(100, 100, NaN)?.dpr).toBe(1);
  });

  it('refuses an unlaid-out canvas instead of building a 1×1 frame', () => {
    expect(EditorWebGLPreview.resolveFrame(0, 600, 1)).toBeNull();
    expect(EditorWebGLPreview.resolveFrame(800, 0, 1)).toBeNull();
    expect(EditorWebGLPreview.resolveFrame(NaN, 600, 1)).toBeNull();
  });
});
