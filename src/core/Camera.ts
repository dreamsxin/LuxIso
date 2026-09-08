import { IsoObject } from '../elements/IsoObject';
import { unproject } from '../math/IsoProjection';
import type { IsoView } from '../math/IsoProjection';

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraOptions {
  x?: number;
  y?: number;
  zoom?: number;
  /** Lerp factor per frame (0–1). 1 = instant snap, 0.08 = smooth follow. Default 1. */
  lerpFactor?: number;
  bounds?: CameraBounds;
}

export class Camera {
  x: number;
  y: number;
  zoom: number;

  private _lerpFactor = 1;

  /**
   * Lerp smoothing factor. Set < 1 for smooth follow.
   *
   * Clamped to [0, 1] on assignment: `update()` evaluates
   * `Math.pow(1 - lerpFactor, dt * 60)`, which returns NaN for a negative base
   * with a fractional exponent. Since scene JSON can set this field directly,
   * an out-of-range value would otherwise poison the camera position and every
   * transform derived from it.
   */
  get lerpFactor(): number {
    return this._lerpFactor;
  }

  set lerpFactor(value: number) {
    this._lerpFactor = Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 1;
  }

  private _target: IsoObject | null = null;
  private _bounds: CameraBounds | null = null;

  constructor(opts: CameraOptions = {}) {
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.zoom = opts.zoom ?? 1;
    this.lerpFactor = opts.lerpFactor ?? 1;
    this._bounds = opts.bounds ?? null;
  }

  follow(obj: IsoObject): void {
    this._target = obj;
  }

  unfollow(): void {
    this._target = null;
  }

  setBounds(bounds: CameraBounds): void {
    this._bounds = bounds;
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this._clamp();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0.25, Math.min(4, zoom));
  }

  /**
   * Called each frame before drawing. Lerps toward follow target.
   * `dt` is the frame delta in seconds; pass it for frame-rate-independent
   * smoothing (lerpFactor is treated as the per-60fps factor, so the actual
   * factor is adjusted via `1 - (1-lerpFactor)^(dt*60)`).
   */
  update(dt = 1 / 60): void {
    if (this._target) {
      const tx = this._target.position.x;
      const ty = this._target.position.y;
      // Frame-rate-independent lerp: same convergence speed at any FPS
      const t = this._lerpFactor >= 1 ? 1 : 1 - Math.pow(1 - this._lerpFactor, dt * 60);
      this.x += (tx - this.x) * t;
      this.y += (ty - this.y) * t;
      this._clamp();
    }
  }

  /**
   * Apply camera transform to a canvas context.
   * After this call, draw all scene objects, then call restoreTransform().
   * The transform maps world-space iso coordinates so that the camera's
   * world position appears at the canvas centre.
   *
   * canvasW/canvasH are accepted for API symmetry but the origin is driven
   * by the caller-supplied originX/originY.
   */
  applyTransform(
    ctx: CanvasRenderingContext2D,
    _canvasW: number,
    _canvasH: number,
    tileW: number,
    tileH: number,
    originX: number,
    originY: number,
    view?: IsoView,
  ): void {
    const rot  = view?.rotation  ?? 0;
    const elev = view?.elevation ?? 0.5;
    const offsetX = -(this.x - this.y) * (tileW / 2);
    const offsetY = -(this.x + this.y) * (tileH / 2);

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(this.zoom, this.zoom);

    // elevation: scale Y axis relative to standard 0.5 ratio
    if (elev !== 0.5) {
      ctx.scale(1, elev / 0.5);
    }

    // rotation: apply 2×2 matrix that rotates the iso plane
    // M = [[cos, sin/1], [-sin, cos]] acting on (sx, sy) where sx=(x-y)*tw/2, sy=(x+y)*th/2
    // Derived: rotating world (x,y) by θ and re-projecting gives:
    //   sx' = sx*cos + sy*sin*(tw/th)
    //   sy' = -sx*sin*(th/tw) + sy*cos
    // With standard tw/th = 2: sx' = sx*cos + sy*2*sin, sy' = -sx*sin/2 + sy*cos
    if (rot !== 0) {
      const rad = (rot * Math.PI) / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const aspect = tileW / tileH; // = 2 for standard iso
      ctx.transform(c, -s / aspect, s * aspect, c, 0, 0);
    }

    ctx.translate(offsetX, offsetY);
  }

  restoreTransform(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  /**
   * Convert a world position to canvas pixel coordinates, accounting for
   * the current camera transform (zoom + pan + view).
   *
   * The composition order must match `applyTransform`. There, the canvas CTM
   * ends up as `T(origin) · S(zoom) · S_elev · R · T(offset)`, so a point is
   * rotated FIRST and elevation-scaled SECOND. `S_elev` is non-uniform, so the
   * two do not commute: swapping them desynchronises picking from rendering
   * whenever `rotation !== 0` and `elevation !== 0.5`.
   */
  worldToScreen(
    wx: number, wy: number, wz: number,
    tileW: number, tileH: number,
    originX: number, originY: number,
    view?: IsoView,
  ): { sx: number; sy: number } {
    const isoX = (wx - wy) * (tileW / 2);
    const isoY = (wx + wy) * (tileH / 2) - wz;
    const camOffX = -(this.x - this.y) * (tileW / 2);
    const camOffY = -(this.x + this.y) * (tileH / 2);
    let sx = isoX + camOffX;
    let sy = isoY + camOffY;

    if (view) {
      // Apply rotation matrix first (matches applyTransform)
      if (view.rotation !== 0) {
        const rad = (view.rotation * Math.PI) / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const aspect = tileW / tileH;
        const nx = c * sx + s * aspect * sy;
        const ny = (-s / aspect) * sx + c * sy;
        sx = nx; sy = ny;
      }
      // Then the elevation scale
      if (view.elevation !== 0.5) sy *= view.elevation / 0.5;
    }

    return { sx: originX + sx * this.zoom, sy: originY + sy * this.zoom };
  }

  /**
   * Inverse of `worldToScreen` (at z=0). Undoes the transform in reverse
   * order: zoom, elevation, rotation, then the camera pan offset.
   */
  screenToWorld(
    cx: number, cy: number,
    _canvasW: number, _canvasH: number,
    tileW: number, tileH: number,
    originX: number, originY: number,
    view?: IsoView,
  ): { x: number; y: number } {
    let sx = (cx - originX) / this.zoom;
    let sy = (cy - originY) / this.zoom;

    if (view) {
      // Undo elevation scale first (forward order was rotate -> elevate)
      if (view.elevation !== 0.5) sy /= view.elevation / 0.5;
      // Undo rotation (inverse matrix)
      if (view.rotation !== 0) {
        const rad = (view.rotation * Math.PI) / 180;
        const c = Math.cos(rad), s = Math.sin(rad);
        const aspect = tileW / tileH;
        const nx = c * sx - s * aspect * sy;
        const ny = (s / aspect) * sx + c * sy;
        sx = nx; sy = ny;
      }
    }

    const camOffX = -(this.x - this.y) * (tileW / 2);
    const camOffY = -(this.x + this.y) * (tileH / 2);
    return unproject(sx - camOffX, sy - camOffY, tileW, tileH);
  }

  private _clamp(): void {
    if (!this._bounds) return;
    this.x = Math.max(this._bounds.minX, Math.min(this._bounds.maxX, this.x));
    this.y = Math.max(this._bounds.minY, Math.min(this._bounds.maxY, this.y));
  }
}
