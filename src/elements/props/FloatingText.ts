import { IsoObject, DrawContext } from '../../elements/IsoObject';
import { AABB } from '../../math/depthSort';
import { project } from '../../math/IsoProjection';

export interface FloatingTextOptions {
  id: string;
  x: number;
  y: number;
  z: number;
  text: string;
  color?: string;
  duration?: number;
  speed?: number;
  fontSize?: number;
}

/**
 * FloatingText — a temporary isometric object that floats upward and fades out.
 * Useful for damage numbers, status effects, or labels.
 */
export class FloatingText extends IsoObject {
  text: string;
  color: string;
  duration: number;
  speed: number;
  fontSize: number;
  
  private _elapsed = 0;
  private _alpha = 1;
  private _lastTs = 0;

  constructor(opts: FloatingTextOptions) {
    super(opts.id, opts.x, opts.y, opts.z);
    this.text = opts.text;
    this.color = opts.color ?? '#ffffff';
    this.duration = opts.duration ?? 1000; // ms
    this.speed = opts.speed ?? 1.5; // units/sec
    this.fontSize = opts.fontSize ?? 16;
  }

  get aabb(): AABB {
    // Floating text doesn't usually need strict depth sorting against walls,
    // but we give it a tiny AABB at its current position. Both position.z and
    // AABB Z are screen pixels; 16 px is the minimum slab depth sort expects.
    const baseZ = this.position.z;
    return {
      minX: this.position.x, minY: this.position.y,
      maxX: this.position.x, maxY: this.position.y,
      baseZ,
      maxZ: baseZ + 16,
    };
  }

  get isExpired(): boolean {
    return this._elapsed >= this.duration;
  }

  get alpha(): number {
    return this._alpha;
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    this._elapsed += dt * 1000;
    this.position.z += this.speed * dt;
    this._alpha = Math.max(0, 1 - this._elapsed / this.duration);
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y, z } = this.position;
    const { sx, sy } = project(x, y, z, tileW, tileH);
    
    ctx.save();
    ctx.globalAlpha = this._alpha;
    ctx.fillStyle = this.color;
    ctx.font = `bold ${this.fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Subtle shadow for readability
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    
    ctx.fillText(this.text, originX + sx, originY + sy);
    ctx.restore();
  }
}
