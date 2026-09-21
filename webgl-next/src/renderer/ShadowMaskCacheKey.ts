import {
  RENDER_VERTEX_FLOATS,
  type RenderSnapshot,
} from '../contracts/RenderSnapshot';

const floatValue = new Float32Array(1);
const floatBits = new Uint32Array(floatValue.buffer);
const SHADOW_FIELDS = [0, 1, 4, 5, 6, 7] as const;

/** Hash only the inputs consumed by the screen-space shadow-mask pass. */
export function computeShadowMaskCacheKey(
  snapshot: RenderSnapshot,
  targetWidth: number,
  targetHeight: number
): number {
  const geometry = snapshot.geometry;
  const shadows = geometry.shadows;
  let hash = 0x811c9dc5;
  hash = hashNumber(hash, shadows.count);
  hash = hashNumber(hash, targetWidth);
  hash = hashNumber(hash, targetHeight);
  hash = hashNumber(hash, snapshot.tileW);
  hash = hashNumber(hash, snapshot.tileH);

  const camera = snapshot.camera;
  hash = hashFloat(hash, camera.worldX);
  hash = hashFloat(hash, camera.worldY);
  hash = hashFloat(hash, camera.zoom);
  hash = hashFloat(hash, camera.rotation);
  hash = hashFloat(hash, camera.elevation);
  hash = hashFloat(hash, camera.originX);
  hash = hashFloat(hash, camera.originY);
  hash = hashFloat(hash, camera.viewportWidth);
  hash = hashFloat(hash, camera.viewportHeight);

  const end = shadows.first + shadows.count;
  for (let vertex = shadows.first; vertex < end; vertex++) {
    const offset = vertex * RENDER_VERTEX_FLOATS;
    for (const field of SHADOW_FIELDS) {hash = hashFloat(hash, geometry.data[offset + field]);}
  }
  return hash >>> 0;
}

function hashFloat(hash: number, value: number): number {
  floatValue[0] = value;
  return hashNumber(hash, floatBits[0]);
}

function hashNumber(hash: number, value: number): number {
  return Math.imul(hash ^ (value >>> 0), 0x01000193);
}
