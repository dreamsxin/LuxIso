import { OmniLight } from './OmniLight';
import { DirectionalLight } from './DirectionalLight';
import { IsoObject } from '../elements/IsoObject';
import { project, Z_UNITS_PER_PX } from '../math/IsoProjection';

interface ShadowCacheEntry {
  hull: [number, number][];
  alpha: number;
  // Validation state
  lx: number; ly: number; lz: number;
  ox: number; oy: number; oz: number;
  // Light-property validation (so intensity/color/radius/falloff/isGlobal
  // changes invalidate the cached shadow)
  intensity: number; color: string; radius: number;
  falloff: 'linear' | 'quadratic'; isGlobal: boolean;
  // For OmniLight
  gradParams?: { cx: number; cy: number; r: number; alpha: number };
}

interface DirShadowCacheEntry {
  hull: [number, number][];
  alpha: number;
  angle: number;
  elev: number;
  ox: number; oy: number; oz: number;
  // Light-property validation (intensity/color changes invalidate the cache)
  intensity: number; color: string;
}

/**
 * Ground-plane shadow casting for OmniLights and DirectionalLights.
 * Optimized with WeakMap caching to avoid per-frame convex hull calculation for static objects.
 */
export class ShadowCaster {
  private static _omniCache = new WeakMap<IsoObject, Map<string, ShadowCacheEntry>>();
  private static _dirCache  = new WeakMap<IsoObject, Map<string, DirShadowCacheEntry>>();

  /**
   * Draw OmniLight ground shadows.
   */
  static draw(
    ctx: CanvasRenderingContext2D,
    light: OmniLight,
    casters: IsoObject[],
    tileW: number,
    tileH: number,
  ): void {
    // Global ambient lights (isGlobal) act as uniform sky light - they do NOT
    // cast a hard point-source shadow from their (x,y,z) position.
    if (light.isGlobal) return;

    const lx = light.position.x;
    const ly = light.position.y;
    // lz is in SCREEN PIXELS (light.position.z feeds project()'s sy directly).
    // Object AABB baseZ/maxZ are in WORLD-Z units (1 unit = tileH/2 px, via
    // Z_UNITS_PER_PX). Convert lz to world units so the projection formula
    // `t = lzWorld / (lzWorld - height)` is dimensionally consistent.
    const lzWorld = light.position.z * Z_UNITS_PER_PX;

    if (lzWorld <= 0) return;

    const maxAlpha = Math.min(0.50, light.intensity * 0.42);

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';

    // Stable per-light cache key. Never derive this from the light's position:
    // a moving light would then mint a new key every frame and the per-object
    // cache below would grow without bound. `cacheKey` is the explicit id when
    // present and an instance-scoped uid otherwise.
    const cacheKey = light.cacheKey;

    for (const obj of casters) {
      if (obj.castsShadow === false) continue;

      const pos = obj.position;
      let objCache = this._omniCache.get(obj);
      if (!objCache) {
        objCache = new Map();
        this._omniCache.set(obj, objCache);
      }

      let entry = objCache.get(cacheKey);
      const needsUpdate = !entry ||
        entry.lx !== lx || entry.ly !== ly || entry.lz !== light.position.z ||
        entry.ox !== pos.x || entry.oy !== pos.y || entry.oz !== pos.z ||
        entry.intensity !== light.intensity || entry.color !== light.color ||
        entry.radius !== light.radius || entry.falloff !== light.falloff ||
        entry.isGlobal !== light.isGlobal;

      if (needsUpdate) {
        const { minX, minY, maxX, maxY, baseZ, maxZ } = obj.aabb;
        const objTopZ = maxZ ?? (baseZ + 1);
        const cz = objTopZ - baseZ;

        // Skip if the object has no height, or its TOP reaches the light
        // (guard against t <= 0 / Infinity that would project backwards).
        if (cz <= 0 || objTopZ >= lzWorld) {
          objCache.delete(cacheKey);
          continue;
        }

        let topCorners: [number, number, number][];
        if (obj.shadowRadius && obj.shadowRadius > 0) {
          const sr = obj.shadowRadius;
          const ocx = (minX + maxX) / 2;
          const ocy = (minY + maxY) / 2;
          topCorners = Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return [ocx + Math.cos(a) * sr, ocy + Math.sin(a) * sr, objTopZ] as [number, number, number];
          });
        } else {
          topCorners = [[minX, minY, objTopZ], [maxX, minY, objTopZ], [maxX, maxY, objTopZ], [minX, maxY, objTopZ]];
        }

        // Project each top corner from the light source onto the z=0 ground
        // plane. t = lzWorld / (lzWorld - (cornerZ - baseZ)); with cornerZ =
        // objTopZ this is lzWorld / (lzWorld - cz), giving a ground point
        // extended away from the light by the object's height ratio.
        const groundPts: [number, number][] = topCorners.map(([cx, cy, cornerZ]) => {
          const t = lzWorld / (lzWorld - (cornerZ - baseZ));
          return [lx + t * (cx - lx), ly + t * (cy - ly)];
        });

        const screenPts = groundPts.map(([gx, gy]) => {
          const p = project(gx, gy, 0, tileW, tileH);
          return [p.sx, p.sy] as [number, number];
        });

        let basePts: [number, number][];
        if (obj.shadowRadius && obj.shadowRadius > 0) {
          const sr = obj.shadowRadius;
          const ocx = (minX + maxX) / 2;
          const ocy = (minY + maxY) / 2;
          basePts = Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const p = project(ocx + Math.cos(a) * sr, ocy + Math.sin(a) * sr, 0, tileW, tileH);
            return [p.sx, p.sy] as [number, number];
          });
        } else {
          basePts = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].map(([bx, by]) => {
            const p = project(bx, by, 0, tileW, tileH);
            return [p.sx, p.sy] as [number, number];
          });
        }

        const hull = convexHull([...basePts, ...screenPts]);
        if (hull.length < 3) {
          objCache.delete(cacheKey);
          continue;
        }

        const objCx = (minX + maxX) / 2;
        const objCy = (minY + maxY) / 2;
        const dist = Math.hypot(objCx - lx, objCy - ly);
        const radiusWorld = light.radius / (tileW / 2);
        // Honor the light's falloff curve so a quadratic light gets a
        // quadratic shadow (matching OmniLight.illuminateAt).
        const ft = Math.max(0, 1 - dist / radiusWorld);
        const falloff = light.falloff === 'quadratic' ? ft * ft : ft;
        const alpha = maxAlpha * falloff;

        const baseCx = basePts.reduce((s, p) => s + p[0], 0) / basePts.length;
        const baseCy = basePts.reduce((s, p) => s + p[1], 0) / basePts.length;
        const shadowR = Math.max(...hull.map(([hx, hy]) => Math.hypot(hx - baseCx, hy - baseCy))) * 1.1;

        entry = {
          hull, alpha, lx, ly, lz: light.position.z, ox: pos.x, oy: pos.y, oz: pos.z,
          intensity: light.intensity, color: light.color, radius: light.radius,
          falloff: light.falloff, isGlobal: light.isGlobal,
          gradParams: { cx: baseCx, cy: baseCy, r: shadowR, alpha }
        };
        objCache.set(cacheKey, entry);
      }

      if (entry!.alpha < 0.01) continue;

      const { cx, cy, r, alpha } = entry!.gradParams!;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0,   `rgba(0,0,0,${alpha.toFixed(3)})`);
      grad.addColorStop(0.6, `rgba(0,0,0,${(alpha * 0.6).toFixed(3)})`);
      grad.addColorStop(1,   'rgba(0,0,0,0)');

      const h = entry!.hull;
      ctx.beginPath();
      ctx.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) ctx.lineTo(h[i][0], h[i][1]);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /**
   * Draw DirectionalLight parallel shadows.
   */
  static drawDirectional(
    ctx: CanvasRenderingContext2D,
    light: DirectionalLight,
    casters: IsoObject[],
    tileW: number,
    tileH: number,
  ): void {
    const elev = light.elevation;
    if (elev <= 0.01) return;

    const angle = light.angle;
    const shadowAlphaFactor = 0.15 + 0.55 * (1 - (elev / (Math.PI / 2)) ** 2);
    const alpha = Math.min(0.60, light.intensity * shadowAlphaFactor);
    if (alpha < 0.01) return;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;

    // Stable per-light cache key (see draw() above).
    const cacheKey = light.cacheKey;

    for (const obj of casters) {
      if (obj.castsShadow === false) continue;

      const pos = obj.position;
      let objCache = this._dirCache.get(obj);
      if (!objCache) {
        objCache = new Map();
        this._dirCache.set(obj, objCache);
      }

      let entry = objCache.get(cacheKey);
      const needsUpdate = !entry ||
        entry.angle !== angle || entry.elev !== elev ||
        entry.ox !== pos.x || entry.oy !== pos.y || entry.oz !== pos.z ||
        entry.intensity !== light.intensity || entry.color !== light.color;

      if (needsUpdate) {
        const shadowLen = 1 / Math.tan(elev);
        const screenDx = Math.cos(angle);
        const screenDy = Math.sin(angle);
        // Invert the iso projection to turn the screen-space light direction
        // into a world (x,y) direction. Projection is sx=(x-y)*tileW/2,
        // sy=(x+y)*tileH/2, so the inverse is x=(sx/(tileW/2)+sy/(tileH/2))/2,
        // y=(sy/(tileH/2)-sx/(tileW/2))/2. Then NORMALIZE so the shadow length
        // is purely shadowLen (= H/tan(elev)) times a unit direction; the old
        // code divided by tileW/2 & tileH/2 without the /2 and skipped
        // normalization, yielding shadows ~7px instead of ~95px.
        const a = screenDx / (tileW / 2), b = screenDy / (tileH / 2);
        let worldDx = (a + b) / 2;
        let worldDy = (b - a) / 2;
        const wmag = Math.hypot(worldDx, worldDy) || 1;
        worldDx /= wmag;
        worldDy /= wmag;
        const shadowDx = -worldDx * shadowLen;
        const shadowDy = -worldDy * shadowLen;

        const { minX, minY, maxX, maxY, baseZ, maxZ } = obj.aabb;
        // Align with depthSort's maxZ convention (see draw() above).
        const objTopZ = maxZ ?? (baseZ + 1);
        const objHeightWorld = objTopZ - baseZ;

        let footprint: [number, number][];
        if (obj.shadowRadius && obj.shadowRadius > 0) {
          const sr = obj.shadowRadius;
          const ocx = (minX + maxX) / 2;
          const ocy = (minY + maxY) / 2;
          footprint = Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2;
            return [ocx + Math.cos(a) * sr, ocy + Math.sin(a) * sr] as [number, number];
          });
        } else {
          footprint = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
        }

        const basePts = footprint.map(([fx, fy]) => {
          const p = project(fx, fy, 0, tileW, tileH);
          return [p.sx, p.sy] as [number, number];
        });

        const tipPts = footprint.map(([fx, fy]) => {
          const gx = fx + shadowDx * objHeightWorld;
          const gy = fy + shadowDy * objHeightWorld;
          const p = project(gx, gy, 0, tileW, tileH);
          return [p.sx, p.sy] as [number, number];
        });

        const hull = convexHull([...basePts, ...tipPts]);
        entry = { hull, alpha, angle, elev, ox: pos.x, oy: pos.y, oz: pos.z,
                  intensity: light.intensity, color: light.color };
        objCache.set(cacheKey, entry);
      }

      const h = entry!.hull;
      if (h.length < 3) continue;

      ctx.beginPath();
      ctx.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) ctx.lineTo(h[i][0], h[i][1]);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}

function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length <= 3) return pts;
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] < pts[start][0]) start = i;
  }
  const hull: [number, number][] = [];
  let cur = start;
  do {
    hull.push(pts[cur]);
    let next = (cur + 1) % pts.length;
    for (let i = 0; i < pts.length; i++) {
      if (cross(pts[cur], pts[next], pts[i]) < 0) next = i;
    }
    cur = next;
  } while (cur !== start && hull.length <= pts.length);
  return hull;
}

function cross(O: [number, number], A: [number, number], B: [number, number]): number {
  return (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
}
