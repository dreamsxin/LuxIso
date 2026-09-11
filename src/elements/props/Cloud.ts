import { project } from '../../math/IsoProjection';
import { AABB } from '../../math/depthSort';
import { IsoObject, DrawContext } from '../IsoObject';

export interface CloudOptions {
  id: string;
  x: number;
  y: number;
  /** Height above ground in world units (converted to screen z). Default 6. */
  altitude?: number;
  /** Drift speed in world units per second. Default 0.4. */
  speed?: number;
  /** Drift direction angle in radians. Default 0 (along +x). */
  angle?: number;
  /** Visual scale multiplier. Default 1. */
  scale?: number;
  /** Base color (hex). Default '#d8e8f8'. */
  color?: string;
  /** Random seed for shape variation (0-1). Default 0.5. */
  seed?: number;
}

/**
 * Low-poly cloud that drifts across the isometric scene at altitude.
 *
 * Rendered as a cluster of irregular convex polygons with flat shading,
 * giving a faceted "low poly" look. The cloud casts a soft shadow on the
 * ground plane (drawn separately as a faint ellipse).
 *
 * The cloud wraps around the scene bounds so it never disappears.
 */
export class Cloud extends IsoObject {
  private _speed: number;      // world units / second
  private _angle: number;      // drift direction (radians)
  private _scale: number;
  private _seed: number;

  /**
   * Timestamp of the previous `update`, or null before the first one.
   *
   * `null` rather than 0: `Engine` starts its clock at 0, so a 0 sentinel stayed
   * armed after the first frame and every frame afterwards was treated as the
   * first — the cloud never drifted in a scene that began at timestamp 0.
   */
  private _lastTs: number | null = null;

  // Scene bounds for wrapping (set after construction)
  boundsX = 12;
  boundsY = 12;

  constructor(opts: CloudOptions) {
    const alt = opts.altitude ?? 6;
    // z in screen pixels: altitude * tileH (approximately 32 px per unit)
    super(opts.id, opts.x, opts.y, alt * 32);
    this._speed    = opts.speed ?? 0.4;
    this._angle    = opts.angle ?? 0;
    this._scale    = opts.scale ?? 1;
    this._seed     = opts.seed  ?? 0.5;
  }

  // Serialization helpers
  get speed(): number  { return this._speed; }
  get angle(): number  { return this._angle; }
  get scale(): number  { return this._scale; }
  get seed():  number  { return this._seed;  }
  get altitude(): number { return this.position.z / 32; }

  get aabb(): AABB {
    // Clouds are high in the air - their AABB baseZ reflects their altitude
    // so they sort correctly above ground objects.
    // position.z is in SCREEN PIXELS (altitude * tileH), and so is AABB Z.
    // A cloud's visual thickness is ~32 px per scale unit of body above its base.
    const r = 1.2 * this._scale;
    const baseZ = this.position.z;
    return {
      minX: this.position.x - r,
      minY: this.position.y - r,
      maxX: this.position.x + r,
      maxY: this.position.y + r,
      baseZ,
      maxZ: baseZ + 32 * this._scale,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    if (this._lastTs === null) { this._lastTs = now; return; }
    // Clamped to [0, 100 ms]: a hidden tab must not teleport the cloud across the
    // scene on the frame it comes back, and a rewound clock must not drift it
    // backwards. The rewound stamp still becomes the new baseline.
    const dt = Math.min(Math.max(0, (now - this._lastTs) / 1000), 0.1);
    this._lastTs = now;

    const dist = this._speed * dt;
    this.position.x += Math.cos(this._angle) * dist;
    this.position.y += Math.sin(this._angle) * dist;

    // Wrap around scene bounds
    const pad = 2;
    if (this.position.x > this.boundsX + pad) this.position.x = -pad;
    if (this.position.x < -pad)               this.position.x = this.boundsX + pad;
    if (this.position.y > this.boundsY + pad) this.position.y = -pad;
    if (this.position.y < -pad)               this.position.y = this.boundsY + pad;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y, z } = this.position;

    // Screen position of the cloud centre
    const { sx, sy } = project(x, y, z, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;

    const s = this._scale * (tileW / 64); // normalise to tile size

    // Ground shadow
    // Soft ellipse projected onto the ground plane
    const { sx: gsx, sy: gsy } = project(x, y, 0, tileW, tileH);
    const gx = originX + gsx;
    const gy = originY + gsy;
    const shadowAlpha = 0.10 + 0.05 * Math.sin(this._seed * Math.PI);

    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.beginPath();
    ctx.ellipse(gx, gy, 28 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2a';
    ctx.fill();
    ctx.restore();

    // Low-poly cloud body
    // Build a deterministic set of "puffs" from the seed value.
    // Each puff is an irregular convex polygon (5-8 vertices).
    const puffs = buildPuffs(this._seed, s);

    ctx.save();
    ctx.translate(cx, cy);

    for (const puff of puffs) {
      // Base fill
      ctx.beginPath();
      ctx.moveTo(puff.verts[0][0], puff.verts[0][1]);
      for (let i = 1; i < puff.verts.length; i++) {
        ctx.lineTo(puff.verts[i][0], puff.verts[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = puff.color;
      ctx.globalAlpha = puff.alpha;
      ctx.fill();
    }

    // Top highlight facet
    ctx.globalAlpha = 0.55;
    const hw = 14 * s, hh = 7 * s;
    ctx.beginPath();
    ctx.moveTo(-hw * 0.3, -hh * 1.6);
    ctx.lineTo( hw * 0.4, -hh * 1.8);
    ctx.lineTo( hw * 0.2, -hh * 1.2);
    ctx.lineTo(-hw * 0.5, -hh * 1.0);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// Puff geometry builder

interface Puff {
  verts: [number, number][];
  color: string;
  alpha: number;
}

/**
 * Generate a deterministic cluster of low-poly puffs from a seed value.
 * Uses a simple LCG so the shape is stable across frames.
 */
function buildPuffs(seed: number, s: number): Puff[] {
  const rng = lcg(Math.floor(seed * 0xffff));

  // Cloud palette: light blues/whites with slight variation
  const palette = [
    '#e8f2fc', '#d4e8f8', '#c8dff5',
    '#ddeeff', '#f0f6ff', '#b8d4ee',
  ];

  const puffs: Puff[] = [];

  // 4-6 overlapping puffs arranged in a loose cluster
  const count = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const offX = (rng() - 0.5) * 38 * s;
    const offY = (rng() - 0.5) * 14 * s - 4 * s;
    const rx   = (18 + rng() * 14) * s;
    const ry   = (9  + rng() * 7)  * s;
    const vCount = 5 + Math.floor(rng() * 3);
    const verts: [number, number][] = [];

    for (let v = 0; v < vCount; v++) {
      const baseAngle = (v / vCount) * Math.PI * 2;
      const jitter    = (rng() - 0.5) * 0.55;
      const a         = baseAngle + jitter;
      const rJitter   = 0.75 + rng() * 0.5;
      verts.push([
        offX + Math.cos(a) * rx * rJitter,
        offY + Math.sin(a) * ry * rJitter,
      ]);
    }

    puffs.push({
      verts,
      color: palette[Math.floor(rng() * palette.length)],
      alpha: 0.72 + rng() * 0.22,
    });
  }

  return puffs;
}

/** Simple LCG returning a function that yields values in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
