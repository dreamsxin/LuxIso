import { project } from '../math/IsoProjection';
import { AABB } from '../math/depthSort';
import { DrawContext } from './IsoObject';
import { SpriteSheet } from '../animation/SpriteSheet';
import { AnimationController } from '../animation/AnimationController';
import { shiftColor } from '../math/color';
import { Entity } from '../ecs/Entity';
import { AnimationComponent } from '../ecs/components/AnimationComponent';
import { MovementComponent } from '../ecs/components/MovementComponent';

export interface CharacterOptions {
  id: string;
  x: number;
  y: number;
  z?: number;
  /** Visual radius in pixels (used for sphere fallback rendering). */
  radius?: number;
  color?: string;
  /** Optional sprite sheet for animated rendering. */
  spriteSheet?: SpriteSheet;
  /** Movement speed in world units per second (default 2.4). */
  speed?: number;
}

/**
 * Character — a specialized Entity for controllable or NPC characters.
 * 
 * Unlike v1, movement logic is now delegated to MovementComponent.
 * Character focus is on:
 * - Visuals (Sprite animation or sphere fallback)
 * - State management (walk/idle animation transitions)
 * - Identity (radius, color, name)
 */
export class Character extends Entity {
  radius: number;
  color: string;
  speed: number;

  private _prevX: number;
  private _prevY: number;
  private _moved = false;
  private _anim: AnimationComponent | null = null;


  constructor(opts: CharacterOptions) {
    super(opts.id, opts.x, opts.y, opts.z ?? 0);
    this.radius = opts.radius ?? 22;
    this.color = opts.color ?? '#5590cc';
    this.speed = opts.speed ?? 2.4;
    this._prevX = opts.x;
    this._prevY = opts.y;

    // Character draws its own blob shadow in draw(); skip ShadowCaster system
    this.castsShadow = false;

    if (opts.spriteSheet) {
      this.setSpriteSheet(opts.spriteSheet);
    }
  }

  /** Current animation controller (read-only). */
  get anim(): AnimationController | null {
    return this._anim?.controller ?? null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Attach a sprite sheet and start animation. */
  setSpriteSheet(sheet: SpriteSheet, initialClip = 'idle'): void {
    this.removeComponent(AnimationComponent);
    this._anim = this.addComponent(new AnimationComponent({
      spriteSheet: sheet,
      initialClip,
      autoUpdateDirection: true,
    }));
  }

  /**
   * Switch to named animation clip.
   */
  playAnimation(name: string): void {
    if (!this._anim) return;
    if (!this._anim.controller.spriteSheet.hasClip(name)) return;
    this._anim.play(name);
  }

  /**
   * True if the character is moving this frame.
   *
   * Either signal counts: a `MovementComponent` that reports movement, or a
   * position delta measured across frames. Preferring the component outright
   * would report "still" for a character driven by `ClickMover` — which mutates
   * `position` directly, as its documented usage prescribes — whenever an unused
   * `MovementComponent` happened to be attached.
   */
  get isMoving(): boolean {
    const mv = this.getComponent(MovementComponent);
    if (mv?.isMoving) return true;
    return this._moved;
  }


  // ── AABB ──────────────────────────────────────────────────────────────────

  get aabb(): AABB {
    const r = 0.5;
    // maxZ reflects the character's visual height in screen pixels, the same
    // unit as position.z. A sphere of radius 22 px spans ~44 px, but only the
    // upper half rises above the position anchor, so use radius (not 2*radius).
    // Clamped to >= 16 px so flat characters still get a valid slab.
    const zHeight = Math.max(16, this.radius);
    return {
      minX: this.position.x - r,
      minY: this.position.y - r,
      maxX: this.position.x + r,
      maxY: this.position.y + r,
      baseZ: this.position.z,
      maxZ: this.position.z + zHeight,
    };
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  update(ts?: number): void {
    super.update(ts); // drive components (including MovementComponent)

    // Measure against the position at the end of the *previous* frame.
    //
    // This used to snapshot `_prevX/_prevY` before `super.update()`, which made
    // any movement applied from outside `update()` invisible: the documented
    // ClickMover flow is `hero.position.x += mover.velX` between frames, so the
    // snapshot already equalled the new position and the delta was always zero.
    // A sprite-animated character driven that way never played its walk clip.
    this._moved = Math.hypot(
      this.position.x - this._prevX,
      this.position.y - this._prevY,
    ) > 0.001;
    this._prevX = this.position.x;
    this._prevY = this.position.y;

    // Drive animation state (walk/idle) based on movement
    if (this._anim) {
      const moving = this.isMoving;
      const ctrl = this._anim.controller;
      
      if (moving) {
        if (ctrl.currentClip.name !== 'walk' && ctrl.spriteSheet.hasClip('walk')) {
          ctrl.play('walk');
        }
      } else if (ctrl.currentClip.name === 'walk') {
        if (ctrl.spriteSheet.hasClip('idle')) ctrl.play('idle');
      }
    }
  }


  // ── Draw ──────────────────────────────────────────────────────────────────

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY, omniLights } = dc;
    const { x, y, z } = this.position;

    const { sx, sy } = project(x, y, z, tileW, tileH);
    const bx = originX + sx;
    const by = originY + sy;

    const groundProj = project(x, y, 0, tileW, tileH);
    const gx = originX + groundProj.sx;
    const gy = originY + groundProj.sy;

    // Resolve primary light for shading
    const light = omniLights[0] ?? null;
    let lx = bx - 60;
    let ly = by - 80;
    if (light) {
      const lp = project(light.position.x, light.position.y, 0, tileW, tileH);
      lx = originX + lp.sx;
      ly = originY + lp.sy - light.position.z;
    }

    this.drawShadow(ctx, gx, gy, bx, by, lx, ly, z);

    if (this.anim?.spriteSheet.image) {
      this.drawSprite(ctx, bx, by);
    } else {
      this.drawSphere(ctx, bx, by, lx, ly);
    }
  }

  private drawSprite(ctx: CanvasRenderingContext2D, bx: number, by: number): void {
    const anim = this.anim!;
    const sheet = anim.spriteSheet;
    const img = sheet.image!;
    const frame = anim.currentClip.frames[anim.frameIndex];
    const w = frame.w * sheet.scale;
    const h = frame.h * sheet.scale;
    const dx = bx - w / 2;
    const dy = by - h * sheet.anchorY;

    ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, dx, dy, w, h);
  }

  private drawShadow(
    ctx: CanvasRenderingContext2D,
    gx: number, gy: number,
    bx: number, by: number,
    lx: number, ly: number,
    elevation: number,
  ): void {
    const dx = bx - lx;
    const dy = by - ly;
    const len = Math.hypot(dx, dy) || 1;
    const scale = elevation / 60;
    const offX = (dx / len) * this.radius * scale * 1.5;
    const offY = (dy / len) * this.radius * scale * 0.7;

    const m = ctx.getTransform();
    const wx = gx + offX;
    const wy = gy + offY;
    const screenX = m.a * wx + m.c * wy + m.e;
    const screenY = m.b * wx + m.d * wy + m.f;
    const zoomR = this.radius * 1.3 * Math.hypot(m.a, m.b);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(screenX, screenY);
    ctx.scale(1, 0.45);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, zoomR);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, zoomR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  private drawSphere(
    ctx: CanvasRenderingContext2D,
    bx: number, by: number,
    lx: number, ly: number,
  ): void {
    const dx = lx - bx;
    const dy = ly - by;
    const len = Math.hypot(dx, dy) || 1;
    const hx = bx + (dx / len) * this.radius * 0.38;
    const hy = by + (dy / len) * this.radius * 0.38;

    const dark   = shiftColor(this.color, -80);
    const mid    = this.color;
    const bright = shiftColor(this.color, 100);

    const base = ctx.createRadialGradient(hx, hy, this.radius * 0.05, bx, by, this.radius);
    base.addColorStop(0,    bright);
    base.addColorStop(0.35, mid);
    base.addColorStop(0.8,  dark);
    base.addColorStop(1,    '#050505');

    ctx.beginPath();
    ctx.arc(bx, by, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = base;
    ctx.fill();

    const glint = ctx.createRadialGradient(hx, hy, 0, hx, hy, this.radius * 0.25);
    glint.addColorStop(0, 'rgba(255,255,255,0.8)');
    glint.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(bx, by, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = glint;
    ctx.fill();
  }
}
