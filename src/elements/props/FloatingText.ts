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
  /** Lifetime in milliseconds. Default 1000. */
  duration?: number;
  /**
   * Rise rate in **screen pixels per second** — `position.z` is screen pixels,
   * like every other Z in the engine. Default 40, which lifts a damage number
   * about 32 px over a typical 800 ms life. Set 0 for a static label.
   */
  speed?: number;
  fontSize?: number;
}

/**
 * FloatingText — a temporary isometric object that floats upward and fades out.
 * Useful for damage numbers, status effects, or labels.
 *
 * `Scene.update()` drops instances once `isExpired` turns true, so spawning one
 * per hit does not accumulate.
 */
export class FloatingText extends IsoObject {
  text: string;
  color: string;
  duration: number;
  speed: number;
  fontSize: number;
  
  private _elapsed = 0;
  private _alpha = 1;
  /**
   * Null until the first update. A `0` sentinel would collide with a legitimate
   * timestamp of 0 — the text then read "first frame" forever, never rising,
   * fading or expiring, so `Scene` never removed it either.
   */
  private _lastTs: number | null = null;


  constructor(opts: FloatingTextOptions) {
    super(opts.id, opts.x, opts.y, opts.z);
    this.text = opts.text;
    this.color = opts.color ?? '#ffffff';
    this.duration = opts.duration ?? 1000; // ms
    // Screen pixels per second. The old default of 1.5 predates the single-Z
    // convention and read as "world units"; against pixel Z it lifted a damage
    // number 1.2 px over its whole life, so the documented float never happened.
    this.speed = opts.speed ?? 40;
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
    // dt 0 on the first call, matching Engine / ClickMover / DirectionalAnimator.
    // The old 0.016 fallback invented a frame of elapsed time, so a text was
    // already slightly faded before it had been drawn once.
    //
    // `Math.max(0, …)` is the other half of the contract, and this module was
    // missing it: a timestamp that moves backwards produced a negative dt, which
    // pushed the text back *down* and un-faded it — found by the shared contract
    // test in `FrameDeltaContract.test.ts`, not by this module's own suite.
    const dt = this._lastTs === null
      ? 0
      : Math.min(Math.max(0, (now - this._lastTs) / 1000), 0.1);
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
