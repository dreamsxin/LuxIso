export interface ProjectedPoint {
  x: number;
  y: number;
}

/**
 * Isometric projection for the WebGL extraction path.
 *
 * Matches `src/math/IsoProjection.project()` exactly: `zPixels` is in screen
 * pixels, the single Z unit shared with `IsoObject.position.z` and every AABB's
 * `baseZ` / `maxZ`.
 *
 * This replaces the earlier split of `projectWorld` (which took "world Z" and
 * multiplied it by `tileH / 2`) plus `legacyPixelsToWorldZ` (which divided pixels
 * by a hardcoded 16). Those two only cancelled at `tileH = 32`; at any other tile
 * height this backend placed a given z at a different screen height than
 * Canvas2D did.
 */
export function projectIso(
  x: number,
  y: number,
  zPixels: number,
  tileW: number,
  tileH: number,
): ProjectedPoint {
  return {
    x: (x - y) * (tileW / 2),
    y: (x + y) * (tileH / 2) - zPixels,
  };
}
