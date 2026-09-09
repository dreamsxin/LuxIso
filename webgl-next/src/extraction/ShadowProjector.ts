import type { IsoObject } from '../../../src/elements/IsoObject';
import type { DirectionalLight } from '../../../src/lighting/DirectionalLight';
import type { OmniLight } from '../../../src/lighting/OmniLight';
import { MIN_Z_EXTENT_PX } from '../../../src/math/depthSort';
import { projectIso } from './projection';

export type ShadowPoint = readonly [number, number];

export interface ProjectedShadow {
  readonly hull: readonly ShadowPoint[];
  readonly alpha: number;
}

/** Clip screen-space shadow geometry to the isometric scene floor diamond. */
export function clipShadowHullToScene(
  hull: readonly ShadowPoint[],
  cols: number,
  rows: number,
  tileW: number,
  tileH: number,
): ShadowPoint[] {
  const bounds = [
    screenPoint(0, 0, tileW, tileH),
    screenPoint(cols, 0, tileW, tileH),
    screenPoint(cols, rows, tileW, tileH),
    screenPoint(0, rows, tileW, tileH),
  ];
  let output = [...hull];
  for (let edge = 0; edge < bounds.length && output.length > 0; edge++) {
    const clipA = bounds[edge];
    const clipB = bounds[(edge + 1) % bounds.length];
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index++) {
      const start = input[index];
      const end = input[(index + 1) % input.length];
      const startSide = cross(clipA, clipB, start);
      const endSide = cross(clipA, clipB, end);
      const startInside = startSide >= -0.001;
      const endInside = endSide >= -0.001;
      if (startInside && endInside) {
        output.push(end);
      } else if (startInside !== endInside) {
        const t = startSide / (startSide - endSide);
        output.push([
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
        ]);
        if (endInside) output.push(end);
      }
    }
  }
  return output;
}

/** Project an object's top silhouette through a point light onto the ground. */
export function projectOmniShadow(
  object: IsoObject,
  light: OmniLight,
  tileW: number,
  tileH: number,
): ProjectedShadow | null {
  if (!light.enabled || light.isGlobal || light.position.z <= 0) return null;

  const { baseZ, maxZ } = object.aabb;
  const topZ = maxZ ?? baseZ + MIN_Z_EXTENT_PX;
  const height = topZ - baseZ;
  // Light z and AABB Z are both screen pixels — no conversion.
  const lightZ = light.position.z;
  if (height <= 0 || topZ >= lightZ) return null;

  const footprint = objectFootprint(object);
  const projectionScale = Math.min(2.75, lightZ / (lightZ - height));
  const projected = footprint.map(([x, y]) => [
    light.position.x + projectionScale * (x - light.position.x),
    light.position.y + projectionScale * (y - light.position.y),
  ] as ShadowPoint);
  const hull = convexHull([
    ...footprint.map(([x, y]) => screenPoint(x, y, tileW, tileH)),
    ...projected.map(([x, y]) => screenPoint(x, y, tileW, tileH)),
  ]);
  if (hull.length < 3) return null;

  const centerX = (object.aabb.minX + object.aabb.maxX) / 2;
  const centerY = (object.aabb.minY + object.aabb.maxY) / 2;
  const distance = Math.hypot(centerX - light.position.x, centerY - light.position.y);
  const radiusWorld = light.radius / (tileW / 2);
  const linear = Math.max(0, 1 - distance / radiusWorld);
  const falloff = light.falloff === 'quadratic' ? linear * linear : linear;
  const alpha = Math.min(0.5, light.intensity * 0.42) * falloff;
  return alpha >= 0.01 ? { hull, alpha } : null;
}

/** Project parallel rays from a directional light through an object's height. */
export function projectDirectionalShadow(
  object: IsoObject,
  light: DirectionalLight,
  tileW: number,
  tileH: number,
): ProjectedShadow | null {
  if (!light.enabled || light.elevation <= 0.01) return null;

  const { baseZ, maxZ } = object.aabb;
  const height = (maxZ ?? baseZ + 1) - baseZ;
  if (height <= 0) return null;

  const screenDx = Math.cos(light.angle);
  const screenDy = Math.sin(light.angle);
  const isoX = screenDx / (tileW / 2);
  const isoY = screenDy / (tileH / 2);
  let worldDx = (isoX + isoY) / 2;
  let worldDy = (isoY - isoX) / 2;
  const magnitude = Math.hypot(worldDx, worldDy) || 1;
  worldDx /= magnitude;
  worldDy /= magnitude;

  const lengthPerHeight = 1 / Math.tan(light.elevation);
  const shadowDx = -worldDx * lengthPerHeight * height;
  const shadowDy = -worldDy * lengthPerHeight * height;
  const footprint = objectFootprint(object);
  const tips = footprint.map(([x, y]) => [x + shadowDx, y + shadowDy] as ShadowPoint);
  const hull = convexHull([
    ...footprint.map(([x, y]) => screenPoint(x, y, tileW, tileH)),
    ...tips.map(([x, y]) => screenPoint(x, y, tileW, tileH)),
  ]);
  if (hull.length < 3) return null;

  const elevationFactor = 0.15 + 0.55 * (1 - (light.elevation / (Math.PI / 2)) ** 2);
  const alpha = Math.min(0.6, light.intensity * elevationFactor);
  return alpha >= 0.01 ? { hull, alpha } : null;
}

function objectFootprint(object: IsoObject): ShadowPoint[] {
  const { minX, minY, maxX, maxY } = object.aabb;
  if (object.shadowRadius && object.shadowRadius > 0) {
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return Array.from({ length: 8 }, (_, index) => {
      const angle = index / 8 * Math.PI * 2;
      return [
        centerX + Math.cos(angle) * object.shadowRadius!,
        centerY + Math.sin(angle) * object.shadowRadius!,
      ] as ShadowPoint;
    });
  }
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
}

function screenPoint(x: number, y: number, tileW: number, tileH: number): ShadowPoint {
  const point = projectIso(x, y, 0, tileW, tileH);
  return [point.x, point.y];
}

function convexHull(points: readonly ShadowPoint[]): ShadowPoint[] {
  if (points.length <= 3) return [...points];
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: ShadowPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: ShadowPoint[] = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(origin: ShadowPoint, a: ShadowPoint, b: ShadowPoint): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}
