import { project, Z_UNITS_PER_PX } from '../math/IsoProjection';
import { AABB } from '../math/depthSort';
import { IsoObject, DrawContext } from './IsoObject';
import { hexToRgb } from '../math/color';

export interface WallOpening {
  type: 'door' | 'window';
  /** Offset from wall start as a fraction of wall length (0–1). */
  offsetX: number;
  /** Width as a fraction of wall length (0–1). */
  width: number;
  /** Height as a fraction of wall height (0–1). */
  height: number;
  /** Bottom offset as a fraction of wall height (0 = floor level). */
  offsetY?: number;
}

export interface WallOptions {
  id: string;
  x: number;
  y: number;
  endX: number;
  endY: number;
  /** Wall height in screen pixels. */
  height?: number;
  color?: string;
  openings?: WallOpening[];
}

/**
 * Axis-aligned isometric wall segment.
 *
 * Face normals in isometric screen space (2:1 ratio, normalised):
 *   X-wall (along X axis, faces –Y): nx = +0.8944, ny = -0.4472
 *   Y-wall (along Y axis, faces –X): nx = -0.8944, ny = -0.4472
 *
 * Directional light contribution = max(0, dot(faceNormal, lightDir)) × intensity
 */
export class Wall extends IsoObject {
  endX: number;
  endY: number;
  wallHeight: number;
  color: string;
  openings: WallOpening[];

  // Precomputed isometric face normals (screen-space, unit vectors)
  private static readonly NX_WALL = { nx:  0.8944, ny: -0.4472 }; // faces –Y
  private static readonly NY_WALL = { nx: -0.8944, ny: -0.4472 }; // faces –X

  constructor(opts: WallOptions) {
    super(opts.id, opts.x, opts.y, 0);
    this.endX = opts.endX;
    this.endY = opts.endY;
    this.wallHeight = opts.height ?? 80;
    this.color = opts.color ?? '#3a3a50';
    this.openings = opts.openings ?? [];
  }

  get aabb(): AABB {
    // wallHeight is in screen pixels; convert to AABB world-Z units
    // (1 unit = tileH/2 ≈ 16 px). This is the canonical Z-unit convention.
    const worldH = this.wallHeight * Z_UNITS_PER_PX;
    // Give walls a minimum thickness of 0.1 so depth sort has a proper Y extent
    const minX = Math.min(this.position.x, this.endX);
    const minY = Math.min(this.position.y, this.endY);
    const maxX = Math.max(this.position.x, this.endX);
    const maxY = Math.max(this.position.y, this.endY);
    return {
      minX,
      minY: minY === maxY ? minY - 0.1 : minY,
      maxX: minX === maxX ? maxX + 0.1 : maxX,
      maxY: minY === maxY ? maxY + 0.1 : maxY,
      baseZ: 0,
      maxZ: worldH,
    };
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY, omniLights, dirLights, ambientRgb } = dc;
    const { x, y } = this.position;

    const isXWall = y === this.endY;
    const norm = isXWall ? Wall.NX_WALL : Wall.NY_WALL;

    // ── Midpoint for omni sampling ──
    const mx = (x + this.endX) / 2;
    const my = (y + this.endY) / 2;
    const { sx: msx, sy: msy } = project(mx, my, 0, tileW, tileH);
    const wallMidSx = originX + msx;
    const wallMidSy = originY + msy;

    // ── Accumulate RGB from all lights ──
    // Start from scene ambient so walls also respond to day/night
    let rTotal = ambientRgb[0];
    let gTotal = ambientRgb[1];
    let bTotal = ambientRgb[2];

    // OmniLights — distance-based, no face-angle contribution
    for (const l of omniLights) {
      const lp = project(l.position.x, l.position.y, 0, tileW, tileH);
      const lsx = originX + lp.sx;
      const lsy = originY + lp.sy - l.position.z;
      const factor = l.illuminateAt(wallMidSx, wallMidSy, lsx, lsy);
      if (factor <= 0) continue;
      const [lr, lg, lb] = hexToRgb(l.color);
      rTotal += (lr / 255) * factor;
      gTotal += (lg / 255) * factor;
      bTotal += (lb / 255) * factor;
    }

    // DirectionalLights — face-normal dot product
    // dl.direction is the direction FROM which light comes (source direction).
    // Incident ray direction = -direction, so dot(normal, -lightDir) = dot(normal, incidentRay).
    // We want: factor > 0 when normal faces the source, i.e. dot(normal, sourceDir) > 0.
    for (const dl of dirLights) {
      const { dx: ldx, dy: ldy } = dl.direction;
      const ndot = Math.max(0, norm.nx * ldx + norm.ny * ldy);
      // Vertical wall face irradiance scales with cos(elevation) (the sun's
      // horizontal component): at zenith (90 deg) a wall gets grazing/zero
      // light; at low sun it's brightly lit if it faces the source. (Floor,
      // a horizontal surface, correctly uses sin(elevation).)
      const factor = ndot * Math.cos(dl.elevation) * dl.intensity;
      if (factor <= 0) continue;
      const [lr, lg, lb] = hexToRgb(dl.color);
      rTotal += (lr / 255) * factor;
      gTotal += (lg / 255) * factor;
      bTotal += (lb / 255) * factor;
    }

    // Apply face-brightness bias: X-walls slightly darker (ambient occlusion)
    const faceBias = isXWall ? 0.82 : 1.0;
    rTotal = Math.min(1, rTotal * faceBias);
    gTotal = Math.min(1, gTotal * faceBias);
    bTotal = Math.min(1, bTotal * faceBias);

    this.drawFace(ctx, tileW, tileH, originX, originY, rTotal, gTotal, bTotal);
  }

  private drawFace(
    ctx: CanvasRenderingContext2D,
    tileW: number, tileH: number,
    originX: number, originY: number,
    rIllum: number, gIllum: number, bIllum: number,
  ): void {
    const { x, y } = this.position;
    const h = this.wallHeight;

    const p0 = project(x, y, 0, tileW, tileH);
    const p1 = project(this.endX, this.endY, 0, tileW, tileH);
    const x0 = originX + p0.sx;
    const y0 = originY + p0.sy;
    const x1 = originX + p1.sx;
    const y1 = originY + p1.sy;

    // Use the wall's color property as the base, multiplied by accumulated illumination
    const [baseR, baseG, baseB] = hexToRgb(this.color);
    const r = Math.min(255, Math.round(baseR * rIllum));
    const g = Math.min(255, Math.round(baseG * gIllum));
    const b = Math.min(255, Math.round(baseB * bIllum));

    // Fill parallelogram
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 - h);
    ctx.lineTo(x0, y0 - h);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();

    // Openings are painted on top of the filled wall. They must come after the
    // wall fill: drawOpenings starts its own paths, so calling it earlier would
    // discard the wall path and leave the body unpainted.
    if (this.openings.length > 0) {
      this.drawOpenings(ctx, x0, y0, x1, y1, h);
    }

    // Top highlight edge
    ctx.beginPath();
    ctx.moveTo(x0, y0 - h);
    ctx.lineTo(x1, y1 - h);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Vertical edges
    ctx.beginPath();
    ctx.moveTo(x0, y0);   ctx.lineTo(x0, y0 - h);
    ctx.moveTo(x1, y1);   ctx.lineTo(x1, y1 - h);
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.75;
    ctx.stroke();

    ctx.restore();
  }

  private drawOpenings(
    ctx: CanvasRenderingContext2D,
    x0: number, y0: number,
    x1: number, y1: number,
    h: number,
  ): void {
    const wallLen = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / wallLen;
    const dy = (y1 - y0) / wallLen;

    for (const op of this.openings) {
      const opH    = op.height * h;
      const opY    = (op.offsetY ?? 0) * h;
      const ox0    = x0 + dx * op.offsetX * wallLen;
      const oy0    = y0 + dy * op.offsetX * wallLen;
      const ox1    = x0 + dx * (op.offsetX + op.width) * wallLen;
      const oy1    = y0 + dy * (op.offsetX + op.width) * wallLen;

      const holeColor = op.type === 'door'
        ? 'rgba(5,5,8,0.95)'
        : 'rgba(80,120,160,0.45)';

      ctx.beginPath();
      ctx.moveTo(ox0, oy0 - opY);
      ctx.lineTo(ox1, oy1 - opY);
      ctx.lineTo(ox1, oy1 - opY - opH);
      ctx.lineTo(ox0, oy0 - opY - opH);
      ctx.closePath();
      ctx.fillStyle = holeColor;
      ctx.fill();
    }
  }
}
