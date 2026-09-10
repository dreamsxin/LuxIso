/**
 * Combatant — the one fighting entity the ARPG demo needs, in three flavours.
 *
 * Hero, grunt and boss differ only by numbers and colour, so they share a class
 * rather than growing a hierarchy the demo would never use. Movement and health
 * come from the framework's components; this adds the part the framework does not
 * have an opinion about — chase the target, hit it when in reach, respect a
 * cooldown.
 *
 * `think()` only sets intent (a movement target, an attack callback). Integration
 * stays with `MovementComponent`, which `Scene.update`/`Scene.fixedUpdate` drives
 * through `Entity`, so the demo never steps physics itself.
 */
import { Entity, HealthComponent, MovementComponent, project, blendColorRaw } from '../../src/index';
import type { AABB, DrawContext, TileCollider } from '../../src/index';

export type Faction = 'hero' | 'enemy';

export interface CombatantOptions {
  faction?: Faction;
  hp?: number;
  speed?: number;
  /** Damage per hit. */
  damage?: number;
  /** Reach in world units, measured centre to centre. */
  attackRange?: number;
  /** Seconds between hits. */
  attackInterval?: number;
  /** Drawn body radius in screen pixels. */
  radius?: number;
  color?: string;
  collider?: TileCollider | null;
}

export class Combatant extends Entity {
  readonly faction: Faction;
  readonly damage: number;
  readonly attackRange: number;
  readonly attackInterval: number;
  readonly radius: number;
  readonly color: string;

  /** Fires when this combatant lands a hit. `main.ts` applies the damage. */
  onAttack?: (attacker: Combatant, damage: number) => void;

  private _cooldown = 0;
  private readonly _health: HealthComponent;
  private readonly _movement: MovementComponent;

  constructor(id: string, x: number, y: number, opts: CombatantOptions = {}) {
    super(id, x, y, 0);
    this.faction = opts.faction ?? 'enemy';
    this.damage = Math.max(0, opts.damage ?? 6);
    this.attackRange = Math.max(0.1, opts.attackRange ?? 0.9);
    this.attackInterval = Math.max(0.05, opts.attackInterval ?? 1);
    this.radius = Math.max(2, opts.radius ?? 14);
    this.color = opts.color ?? (this.faction === 'hero' ? '#6fd8ff' : '#e0603c');
    this.shadowRadius = 0.34;
    this.castsShadow = true;

    this._health = this.addComponent(new HealthComponent({ max: Math.max(1, opts.hp ?? 40) }));
    this._movement = this.addComponent(new MovementComponent({
      speed: Math.max(0, opts.speed ?? 2.4),
      radius: 0.34,
      collider: opts.collider ?? null,
    }));
  }

  get health(): HealthComponent { return this._health; }
  get movement(): MovementComponent { return this._movement; }
  get isDead(): boolean { return this._health.isDead; }
  /** Seconds until the next hit lands; 0 when ready. */
  get cooldown(): number { return this._cooldown; }

  /**
   * Advance the attack cooldown only. Player-driven units call this: they want
   * the timer, not the chase.
   *
   * A non-finite or non-positive `dt` advances nothing — the same rule the
   * engine's own time-accumulating modules use, so a paused tab or a first frame
   * cannot hand out a free hit.
   */
  tick(dt: number): void {
    if (this.isDead) return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this._cooldown = Math.max(0, this._cooldown - dt);
  }

  /**
   * Try to hit `target`. Returns true if the blow landed — false when out of
   * reach, still cooling down, or either side is dead.
   */
  swing(target: Combatant | null): boolean {
    if (this.isDead || !target || target.isDead) return false;
    if (this._cooldown > 0) return false;
    const dx = target.position.x - this.position.x;
    const dy = target.position.y - this.position.y;
    if (Math.hypot(dx, dy) > this.attackRange) return false;

    this._cooldown = this.attackInterval;
    target.health.takeDamage(this.damage, this.id);
    this.onAttack?.(this, this.damage);
    return true;
  }

  /**
   * Chase `target` and attack when it is in reach. The AI path: cooldown, then
   * approach or swing.
   */
  think(dt: number, target: Combatant | null): void {
    if (this.isDead) return;
    this.tick(dt);
    if (!target || target.isDead) {
      this._movement.stopMoving();
      return;
    }

    const dx = target.position.x - this.position.x;
    const dy = target.position.y - this.position.y;
    if (Math.hypot(dx, dy) > this.attackRange) {
      this._movement.moveTo(target.position.x, target.position.y);
      return;
    }

    // In reach: stop pushing into the target, then swing when the cooldown is up.
    this._movement.stopMoving();
    this.swing(target);
  }

  get aabb(): AABB {
    const half = 0.34;
    return {
      minX: this.position.x - half,
      minY: this.position.y - half,
      maxX: this.position.x + half,
      maxY: this.position.y + half,
      baseZ: 0,
      maxZ: this.radius * 2.4,
    };
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { sx, sy } = project(this.position.x, this.position.y, this.position.z, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const r = this.radius;

    // Body: a tapered column, bright on top so the flat colour still reads as 3D.
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.8, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${blendColorRaw(this.color, 0.45)})`;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx - r * 0.62, cy);
    ctx.lineTo(cx - r * 0.42, cy - r * 1.9);
    ctx.lineTo(cx + r * 0.42, cy - r * 1.9);
    ctx.lineTo(cx + r * 0.62, cy);
    ctx.closePath();
    ctx.fillStyle = `rgb(${blendColorRaw(this.color, 0.9)})`;
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, cy - r * 1.9, r * 0.42, r * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${blendColorRaw(this.color, 1.25)})`;
    ctx.fill();

    this._drawHealthBar(ctx, cx, cy - r * 2.7);
  }

  private _drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (this._health.isDead) return;
    const w = this.radius * 2.2, h = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - w / 2, y, w, h);
    const frac = this._health.fraction;
    ctx.fillStyle = frac > 0.5 ? '#7ce08a' : frac > 0.25 ? '#f0c040' : '#e04040';
    ctx.fillRect(x - w / 2, y, w * frac, h);
  }
}
