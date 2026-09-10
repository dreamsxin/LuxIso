import type { InputManager } from './InputManager';
import type { AxisSource } from './InputMap';

export interface TouchStickOptions {
  /** Centre of the stick in logical (CSS) pixels. */
  x: number;
  y: number;
  /** Distance from centre that maps to full deflection. Default 60. */
  radius?: number;
  /**
   * Fraction of `radius` ignored around the centre, 0–1. Default 0.15.
   * Below it the stick reports zero; above it the remaining travel is rescaled
   * to 0–1 so there is no jump as the thumb crosses the boundary.
   */
  deadzone?: number;
  /**
   * How far from the centre a touch may land and still claim the stick.
   * Default `radius * 1.6` — a thumb rarely lands exactly on the ring.
   */
  captureRadius?: number;
  /**
   * Re-centre on wherever the finger landed instead of using the fixed centre.
   * Standard for full-screen "move anywhere on the left half" layouts.
   */
  dynamicOrigin?: boolean;
  baseColor?: string;
  knobColor?: string;
}

/**
 * TouchStick — an on-screen analog stick, and the framework's first
 * `AxisSource`.
 *
 * It claims a single contact by `Touch.identifier` and holds it until that
 * finger lifts, so a second thumb on a skill button never steals it. Feed it to
 * `InputMap.addAxisSource()` and `map.axis()` starts reporting analog
 * magnitudes; nothing else in the game has to know the input came from a touch.
 *
 * @example
 *   const stick = new TouchStick({ x: 110, y: engine.canvasH - 110 });
 *   map.addAxisSource(stick);
 *   // each frame, before reading the axis:
 *   stick.update(input);
 *   const { x, y } = map.axis('right', 'left', 'down', 'up');
 *   // and in postFrame:
 *   stick.draw(ctx);
 */
export class TouchStick implements AxisSource {
  readonly value: { x: number; y: number } = { x: 0, y: 0 };

  radius: number;
  deadzone: number;
  captureRadius: number;
  dynamicOrigin: boolean;
  baseColor: string;
  knobColor: string;

  private _homeX: number;
  private _homeY: number;
  private _originX: number;
  private _originY: number;
  private _knobX: number;
  private _knobY: number;
  private _touchId: number | null = null;

  constructor(opts: TouchStickOptions) {
    this.radius = opts.radius ?? 60;
    this.deadzone = Math.max(0, Math.min(0.95, opts.deadzone ?? 0.15));
    this.captureRadius = opts.captureRadius ?? this.radius * 1.6;
    this.dynamicOrigin = opts.dynamicOrigin ?? false;
    this.baseColor = opts.baseColor ?? 'rgba(255,255,255,0.18)';
    this.knobColor = opts.knobColor ?? 'rgba(255,255,255,0.45)';
    this._homeX = opts.x;
    this._homeY = opts.y;
    this._originX = opts.x;
    this._originY = opts.y;
    this._knobX = opts.x;
    this._knobY = opts.y;
  }

  /** True while a finger is on the stick. */
  get active(): boolean { return this._touchId !== null; }

  /** The claimed contact, or null. Check this before letting buttons take a touch. */
  get touchId(): number | null { return this._touchId; }

  get originX(): number { return this._originX; }
  get originY(): number { return this._originY; }
  get knobX(): number { return this._knobX; }
  get knobY(): number { return this._knobY; }

  /** Move the resting centre — call after a resize. */
  setCentre(x: number, y: number): void {
    this._homeX = x;
    this._homeY = y;
    if (!this.active) this.reset();
  }

  /** Drop the contact and return to rest. */
  reset(): void {
    this._touchId = null;
    this._originX = this._homeX;
    this._originY = this._homeY;
    this._knobX = this._homeX;
    this._knobY = this._homeY;
    this.value.x = 0;
    this.value.y = 0;
  }

  /**
   * Poll once per frame, before reading the axis.
   *
   * @param isTaken optional predicate for contacts another widget already owns.
   */
  update(input: InputManager, isTaken?: (id: number) => boolean): void {
    if (this._touchId !== null) {
      const held = input.getTouch(this._touchId);
      if (!held) { this.reset(); return; }
      this._track(held.x, held.y);
      return;
    }

    for (const touch of input.touches) {
      if (isTaken?.(touch.id)) continue;
      const dx = touch.x - this._homeX;
      const dy = touch.y - this._homeY;
      if (Math.hypot(dx, dy) > this.captureRadius) continue;
      this._touchId = touch.id;
      if (this.dynamicOrigin) {
        this._originX = touch.x;
        this._originY = touch.y;
      } else {
        this._originX = this._homeX;
        this._originY = this._homeY;
      }
      this._track(touch.x, touch.y);
      return;
    }
  }

  private _track(px: number, py: number): void {
    const dx = px - this._originX;
    const dy = py - this._originY;
    const dist = Math.hypot(dx, dy);

    if (dist < 1e-6) {
      this._knobX = this._originX;
      this._knobY = this._originY;
      this.value.x = 0;
      this.value.y = 0;
      return;
    }

    const clamped = Math.min(dist, this.radius);
    this._knobX = this._originX + (dx / dist) * clamped;
    this._knobY = this._originY + (dy / dist) * clamped;

    const magnitude = clamped / this.radius;
    if (magnitude <= this.deadzone) {
      this.value.x = 0;
      this.value.y = 0;
      return;
    }
    // Rescale past the deadzone so the first usable magnitude is 0, not the
    // deadzone value — otherwise the character lurches into motion.
    const scaled = (magnitude - this.deadzone) / (1 - this.deadzone);
    this.value.x = (dx / dist) * scaled;
    this.value.y = (dy / dist) * scaled;
  }

  /** Draw the base ring and knob in screen space. */
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.active ? 1 : 0.55;
    ctx.beginPath();
    ctx.arc(this._originX, this._originY, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.baseColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this._knobX, this._knobY, this.radius * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = this.knobColor;
    ctx.fill();
    ctx.restore();
  }
}
