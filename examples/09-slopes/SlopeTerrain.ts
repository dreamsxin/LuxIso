/**
 * SlopeTerrain — isometric terrain with a smooth height map.
 *
 * Coordinate conventions
 * ──────────────────────
 *   cornerH : height stored at every integer grid vertex (col, row).
 *             Values are in WORLD UNITS (e.g. 0 … 5).
 *
 *   project(x, y, zPx, tileW, tileH)
 *             The engine's project() takes zPx in PIXELS.
 *             To convert: zPx = worldH * tileH
 *             (one world unit lifts the sprite by one tileH worth of pixels)
 *
 * Rendering strategy
 * ──────────────────
 *   Top face   : 4 corners at their actual heights → true slope silhouette.
 *   Right face : NE edge of this tile down to east-neighbour surface.
 *   Left  face : SW edge of this tile down to south-neighbour surface.
 *   Only visible where THIS tile is higher than its neighbour (height diff > 0).
 *
 * Lighting
 * ────────
 *   Per-tile surface normal from finite-difference slope → Lambert diffuse
 *   with a warm sun and a cool fill light.  Right/Left faces get fixed shade
 *   offsets so they read clearly as vertical walls.
 */
import { IsoObject, DrawContext } from '../../src/elements/IsoObject';
import { project } from '../../src/math/IsoProjection';
import { AABB } from '../../src/math/depthSort';

// ── Colour helpers ────────────────────────────────────────────────────────────

interface RGB { r: number; g: number; b: number }

/** 5-stop height gradient: deep water → sand → grass → rock → snow */
const HEIGHT_STOPS: Array<{ t: number } & RGB> = [
  { t: 0.00, r:  42, g:  80, b: 120 },
  { t: 0.10, r: 180, g: 165, b: 110 },
  { t: 0.38, r:  72, g: 120, b:  58 },
  { t: 0.68, r:  95, g:  85, b:  75 },
  { t: 1.00, r: 230, g: 232, b: 235 },
];

function heightRgb(h: number, maxH: number): RGB {
  const t = maxH > 0 ? Math.min(1, Math.max(0, h / maxH)) : 0;
  for (let i = 1; i < HEIGHT_STOPS.length; i++) {
    const lo = HEIGHT_STOPS[i - 1], hi = HEIGHT_STOPS[i];
    if (t <= hi.t) {
      const f = (t - lo.t) / (hi.t - lo.t);
      return {
        r: Math.round(lo.r + (hi.r - lo.r) * f),
        g: Math.round(lo.g + (hi.g - lo.g) * f),
        b: Math.round(lo.b + (hi.b - lo.b) * f),
      };
    }
  }
  const last = HEIGHT_STOPS[HEIGHT_STOPS.length - 1];
  return { r: last.r, g: last.g, b: last.b };
}

function applyLight({ r, g, b }: RGB, lit: number): string {
  const l = Math.min(2, Math.max(0, lit));
  return `rgb(${Math.min(255, Math.round(r * l))},${Math.min(255, Math.round(g * l))},${Math.min(255, Math.round(b * l))})`;
}

// ── SlopeTerrain ──────────────────────────────────────────────────────────────

export class SlopeTerrain extends IsoObject {
  readonly cols: number;
  readonly rows: number;

  /**
   * Height at every integer grid CORNER (col, row).
   * Size: (cols+1) × (rows+1).  Unit: world units.
   */
  readonly cornerH: Float32Array;
  maxH = 0;

  gridAlpha = 0.12;

  constructor(id: string, cols: number, rows: number) {
    super(id, 0, 0, 0);
    this.cols = cols;
    this.rows = rows;
    this.castsShadow = false;
    this.cornerH = new Float32Array((cols + 1) * (rows + 1));
    this._generate();
  }

  // ── Height map generation ─────────────────────────────────────────────────

  private _generate(): void {
    const W = this.cols + 1, H = this.rows + 1;

    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const nx = c / (W - 1);   // 0 … 1
        const ny = r / (H - 1);

        // Central hill
        const hill   = Math.exp(-((nx - 0.50) ** 2 + (ny - 0.48) ** 2) / 0.045) * 4.2;
        // NE secondary ridge
        const ridge  = Math.exp(-((nx - 0.78) ** 2 + (ny - 0.22) ** 2) / 0.030) * 2.6;
        // SW gentle bump
        const bump   = Math.exp(-((nx - 0.22) ** 2 + (ny - 0.72) ** 2) / 0.040) * 1.6;
        // Diagonal valley
        const valley = Math.exp(-((nx - ny - 0.15) ** 2) / 0.025) * 1.1;

        this.cornerH[r * W + c] = Math.max(0, hill + ridge + bump - valley);
      }
    }

    // Force border to zero so the terrain tapers to flat at edges
    for (let c = 0; c < W; c++) {
      this.cornerH[0 * W + c] = 0;
      this.cornerH[(H - 1) * W + c] = 0;
    }
    for (let r = 0; r < H; r++) {
      this.cornerH[r * W] = 0;
      this.cornerH[r * W + (W - 1)] = 0;
    }

    this.maxH = 0;
    for (let i = 0; i < this.cornerH.length; i++) {
      if (this.cornerH[i] > this.maxH) this.maxH = this.cornerH[i];
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Height (world units) at integer corner, clamped to map bounds. */
  cornerAt(col: number, row: number): number {
    const c = Math.max(0, Math.min(this.cols, col));
    const r = Math.max(0, Math.min(this.rows, row));
    return this.cornerH[r * (this.cols + 1) + c];
  }

  /**
   * Bilinear-interpolated height (world units) at continuous world coord.
   * Uses corner heights, so result is C0-smooth across tile boundaries.
   */
  sampleHeight(wx: number, wy: number): number {
    const cx = Math.max(0, Math.min(this.cols - 0.0001, wx));
    const cy = Math.max(0, Math.min(this.rows - 0.0001, wy));
    const c0 = Math.floor(cx), r0 = Math.floor(cy);
    const tc = cx - c0, tr = cy - r0;
    const h00 = this.cornerAt(c0,     r0    );
    const h10 = this.cornerAt(c0 + 1, r0    );
    const h01 = this.cornerAt(c0,     r0 + 1);
    const h11 = this.cornerAt(c0 + 1, r0 + 1);
    return h00*(1-tc)*(1-tr) + h10*tc*(1-tr) + h01*(1-tc)*tr + h11*tc*tr;
  }

  get aabb(): AABB {
    return {
      minX: 0, minY: 0,
      maxX: this.cols, maxY: this.rows,
      baseZ: 0, maxZ: this.maxH,
    };
  }

  update(_ts?: number): void { /* static terrain */ }

  // ── Rendering ─────────────────────────────────────────────────────────────

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this._drawTile(ctx, dc, col, row, tileW, tileH, originX, originY);
      }
    }
  }

  private _drawTile(
    ctx: CanvasRenderingContext2D,
    dc: DrawContext,
    col: number, row: number,
    tileW: number, tileH: number,
    ox: number, oy: number,
  ): void {
    // Corner heights in world units
    const hTL = this.cornerAt(col,     row    );
    const hTR = this.cornerAt(col + 1, row    );
    const hBR = this.cornerAt(col + 1, row + 1);
    const hBL = this.cornerAt(col,     row + 1);

    // Convert to screen points.
    // project(x, y, zPx, tileW, tileH) — zPx must be in PIXELS.
    // zPx = worldH * tileH  (one world unit = tileH px of vertical lift)
    const s = (col: number, row: number, wh: number) => {
      const { sx, sy } = project(col, row, wh * tileH, tileW, tileH);
      return { x: ox + sx, y: oy + sy };
    };

    const sTL = s(col,     row,     hTL);
    const sTR = s(col + 1, row,     hTR);
    const sBR = s(col + 1, row + 1, hBR);
    const sBL = s(col,     row + 1, hBL);

    // ── Surface normal from height gradient (finite differences) ──────────
    // dzdx: slope in x (east) direction
    // dzdy: slope in y (south) direction
    const dzdx = (hTR + hBR - hTL - hBL) * 0.5;
    const dzdy = (hBL + hBR - hTL - hTR) * 0.5;
    const nLen = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
    const nx = -dzdx / nLen, ny = -dzdy / nLen, nz = 1 / nLen;

    // ── Lighting from the scene's DirectionalLights + OmniLights ──────────
    // Build a 3D light vector per directional light: the 2D `direction` points
    // toward the source in iso screen space; the vertical component is
    // sin(elevation). Lambert diffuse = max(0, dot(normal, towardLight)).
    // OmniLights contribute based on 3D distance from the tile centre to the
    // light (x,y,z), attenuated by the light's radius. Falls back to a
    // hardcoded sun+fill only when the scene provides no lights.
    let rLit = dc.ambientRgb[0];
    let gLit = dc.ambientRgb[1];
    let bLit = dc.ambientRgb[2];
    if (dc.dirLights.length === 0 && dc.omniLights.length === 0) {
      // Legacy fallback: warm sun + cool fill (original hardcoded look).
      const SUN  = { x: -0.50, y: -0.65, z: 1.00 };
      const FILL = { x:  0.35, y:  0.50, z: 0.55 };
      const sunLen  = Math.sqrt(SUN.x**2  + SUN.y**2  + SUN.z**2);
      const fillLen = Math.sqrt(FILL.x**2 + FILL.y**2 + FILL.z**2);
      const diffSun  = Math.max(0, (nx*SUN.x  + ny*SUN.y  + nz*SUN.z)  / sunLen);
      const diffFill = Math.max(0, (nx*FILL.x + ny*FILL.y + nz*FILL.z) / fillLen);
      rLit += 0.65 * diffSun + 0.18 * diffFill;
      gLit += 0.65 * diffSun + 0.18 * diffFill;
      bLit += 0.65 * diffSun + 0.18 * diffFill;
    } else {
      const tileCx = col + 0.5, tileCy = row + 0.5;
      const avgHLocal = (hTL + hTR + hBR + hBL) * 0.25;
      for (const dl of dc.dirLights) {
        const { dx, dy } = dl.direction;
        const z = Math.sin(dl.elevation);
        const len = Math.sqrt(dx*dx + dy*dy + z*z) || 1;
        const diff = Math.max(0, (nx*dx + ny*dy + nz*z) / len);
        const factor = diff * dl.intensity;
        const lr = parseInt(dl.color.slice(1, 3), 16);
        const lg = parseInt(dl.color.slice(3, 5), 16);
        const lb = parseInt(dl.color.slice(5, 7), 16);
        rLit += (lr / 255) * factor;
        gLit += (lg / 255) * factor;
        bLit += (lb / 255) * factor;
      }
      for (const ol of dc.omniLights) {
        // 3D distance: tile centre (world x,y, height in world units) to light
        // (x,y, z in pixels -> convert to world height units via /tileH).
        const lightHWorld = ol.position.z / tileH;
        const dx = ol.position.x - tileCx;
        const dy = ol.position.y - tileCy;
        const dz = lightHWorld - avgHLocal;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const radiusWorld = ol.radius / tileH;  // radius is in screen px
        const t = Math.max(0, 1 - dist / radiusWorld);
        const atten = (ol.falloff === 'quadratic' ? t * t : t) * ol.intensity;
        if (atten <= 0) continue;
        const lr = parseInt(ol.color.slice(1, 3), 16);
        const lg = parseInt(ol.color.slice(3, 5), 16);
        const lb = parseInt(ol.color.slice(5, 7), 16);
        rLit += (lr / 255) * atten;
        gLit += (lg / 255) * atten;
        bLit += (lb / 255) * atten;
      }
    }
    // Average intensity for applyLight (keeps the existing rgb*rLit model).
    const topLit = (rLit + gLit + bLit) / 3;

    const avgH  = (hTL + hTR + hBR + hBL) * 0.25;
    const rgb   = heightRgb(avgH, this.maxH);

    // ── Top face ──────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(sTL.x, sTL.y);
    ctx.lineTo(sTR.x, sTR.y);
    ctx.lineTo(sBR.x, sBR.y);
    ctx.lineTo(sBL.x, sBL.y);
    ctx.closePath();
    ctx.fillStyle = applyLight(rgb, topLit);
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${this.gridAlpha})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // ── Right / East face ─────────────────────────────────────────────────
    // Our right edge = (sTR, sBR).  Bottom of face = east neighbour's left
    // edge at their corner heights.  East neighbour corners:
    //   NW = cornerAt(col+1, row)   = hTR  (shared)
    //   SW = cornerAt(col+1, row+1) = hBR  (shared)
    // So the "bottom" of the right face IS the top of the east tile's left
    // edge.  We only show where our tile is higher than east neighbour's
    // right-most visible edge — i.e. where our TL/TR > east's TL/TR.
    // Simple rule: show face if avg(hTR,hBR) > avg of east-neighbour's
    // "opposite" edge avg(hE_TR, hE_BR).
    {
      const hE_TL = hTR;                            // shared grid point
      const hE_BL = hBR;                            // shared grid point
      const hE_TR = this.cornerAt(col + 2, row    );
      const hE_BR = this.cornerAt(col + 2, row + 1);
      // East face top and bottom average heights
      const faceTopH = (hTR + hBR) * 0.5;
      // The face "bottom" is not (hE_TL + hE_BL) * 0.5 — that equals faceTopH
      // because those corners are shared. It goes to the east-neighbour's
      // own surface — meaning: project TR/BR at the east-tile's surface
      // height.  Since the east tile's top edge = our right edge (shared),
      // the face collapses to zero.  What we actually want: for each
      // shared right-edge corner, draw down to the z-floor = 0 (if at
      // map border) or to the east-tile's OPPOSITE (far) edge height.
      // But that creates the blocky Minecraft look. For smooth terrain
      // the correct thing is: show the face only where our tile is
      // strictly higher than its east neighbour BY using the diagonal
      // "inner" corners of the east tile.
      // Best visual: draw right face from our top edge down to east-tile's
      // AVERAGE height on that shared edge, using straight drop.
      const dropTR = hE_TL;   // east-neighbour NW corner = our TR corner (shared)
      const dropBR = hE_BL;   // east-neighbour SW corner = our BR corner (shared)
      // Visible only if east neighbour is lower (by checking the east tile's
      // own far corners vs ours). Use far east corners to judge depth.
      if (col + 1 < this.cols) {
        // Face is visible when east tile average < this tile's right-edge average
        const eastAvg = (hE_TL + hE_BL + hE_TR + hE_BR) * 0.25;
        if (eastAvg < faceTopH - 0.02) {
          const bTR = s(col + 1, row,     dropTR - (faceTopH - eastAvg) * 0.8);
          const bBR = s(col + 1, row + 1, dropBR - (faceTopH - eastAvg) * 0.8);
          ctx.beginPath();
          ctx.moveTo(sTR.x, sTR.y);
          ctx.lineTo(sBR.x, sBR.y);
          ctx.lineTo(bBR.x, bBR.y);
          ctx.lineTo(bTR.x, bTR.y);
          ctx.closePath();
          ctx.fillStyle = applyLight(heightRgb(faceTopH, this.maxH), 0.42);
          ctx.fill();
          ctx.strokeStyle = `rgba(0,0,0,${this.gridAlpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      } else {
        // Map border — draw down to z = 0
        const bTR = s(col + 1, row,     0);
        const bBR = s(col + 1, row + 1, 0);
        ctx.beginPath();
        ctx.moveTo(sTR.x, sTR.y);
        ctx.lineTo(sBR.x, sBR.y);
        ctx.lineTo(bBR.x, bBR.y);
        ctx.lineTo(bTR.x, bTR.y);
        ctx.closePath();
        ctx.fillStyle = applyLight(heightRgb(faceTopH, this.maxH), 0.42);
        ctx.fill();
        ctx.strokeStyle = `rgba(0,0,0,${this.gridAlpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // ── Left / South face ─────────────────────────────────────────────────
    {
      const hS_TL = hBL;
      const hS_TR = hBR;
      const hS_BL = this.cornerAt(col,     row + 2);
      const hS_BR = this.cornerAt(col + 1, row + 2);
      const faceTopH = (hBL + hBR) * 0.5;

      if (row + 1 < this.rows) {
        const southAvg = (hS_TL + hS_TR + hS_BL + hS_BR) * 0.25;
        if (southAvg < faceTopH - 0.02) {
          const bBL = s(col,     row + 1, hS_TL - (faceTopH - southAvg) * 0.8);
          const bBR = s(col + 1, row + 1, hS_TR - (faceTopH - southAvg) * 0.8);
          ctx.beginPath();
          ctx.moveTo(sBL.x, sBL.y);
          ctx.lineTo(sBR.x, sBR.y);
          ctx.lineTo(bBR.x, bBR.y);
          ctx.lineTo(bBL.x, bBL.y);
          ctx.closePath();
          ctx.fillStyle = applyLight(heightRgb(faceTopH, this.maxH), 0.28);
          ctx.fill();
          ctx.strokeStyle = `rgba(0,0,0,${this.gridAlpha})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      } else {
        const bBL = s(col,     row + 1, 0);
        const bBR = s(col + 1, row + 1, 0);
        ctx.beginPath();
        ctx.moveTo(sBL.x, sBL.y);
        ctx.lineTo(sBR.x, sBR.y);
        ctx.lineTo(bBR.x, bBR.y);
        ctx.lineTo(bBL.x, bBL.y);
        ctx.closePath();
        ctx.fillStyle = applyLight(heightRgb(faceTopH, this.maxH), 0.28);
        ctx.fill();
        ctx.strokeStyle = `rgba(0,0,0,${this.gridAlpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
}
