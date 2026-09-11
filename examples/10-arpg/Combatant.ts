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
 *
 * Chasing is line-of-sight first: while the target is visible the pursuer walks
 * straight at it, and A* is paid for only when cover breaks the line. Re-pathing
 * is rate-limited, because a moving target invalidates a path every frame and an
 * A* per mob per frame is the cost this demo would otherwise quietly pay.
 */
import {
  Entity, HealthComponent, MovementComponent, Pathfinder, project, blendColorRaw,
} from '../../src/index';
import type { AABB, DrawContext, PathCache, TileCollider } from '../../src/index';

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
  /** Shared per-arena path cache, so every mob's A* results are pooled. */
  pathCache?: PathCache | null;
}

export class Combatant extends Entity {
  /** Seconds between A* searches while the target is out of sight. */
  static readonly REPATH_INTERVAL = 0.35;

  readonly faction: Faction;
  readonly damage: number;
  readonly attackRange: number;
  readonly attackInterval: number;
  readonly radius: number;
  readonly color: string;

  /** Fires when this combatant lands a hit. `main.ts` applies the damage. */
  onAttack?: (attacker: Combatant, damage: number) => void;

  private _cooldown = 0;
  private _repathIn = 0;
  private readonly _collider: TileCollider | null;
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

    this._collider = opts.collider ?? null;
    this._health = this.addComponent(new HealthComponent({ max: Math.max(1, opts.hp ?? 40) }));
    this._movement = this.addComponent(new MovementComponent({
      speed: Math.max(0, opts.speed ?? 2.4),
      radius: 0.34,
      collider: opts.collider ?? null,
      pathCache: opts.pathCache ?? null,
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
   * Chase `target` and attack when it is in reach.
   *
   * Cover changes how the approach is steered, not whether it happens: with a
   * clear line the pursuer walks straight at the target, and behind a pillar it
   * follows an A* path recomputed at most every `REPATH_INTERVAL`. Without the
   * line-of-sight branch a straight `moveTo` wedges the mob against the pillar
   * face, which is what an arena with cover in it turned up.
   */
  think(dt: number, target: Combatant | null): void {
    if (this.isDead) return;
    this.tick(dt);
    if (Number.isFinite(dt) && dt > 0) this._repathIn = Math.max(0, this._repathIn - dt);
    if (!target || target.isDead) {
      this._movement.stopMoving();
      return;
    }

    const dx = target.position.x - this.position.x;
    const dy = target.position.y - this.position.y;
    if (Math.hypot(dx, dy) > this.attackRange) {
      this._approach(target);
      return;
    }

    // In reach: stop pushing into the target, then swing when the cooldown is up.
    this._movement.stopMoving();
    this.swing(target);
  }

  /** Walk at a visible target; path around cover when it is not visible. */
  private _approach(target: Combatant): void {
    const visible = !this._collider
      || Pathfinder.hasLineOfSight(this._collider, this.position, target.position);

    if (visible) {
      // Straight line, and the next blocked frame re-paths immediately rather
      // than waiting out an interval it spent in the open.
      this._repathIn = 0;
      this._movement.moveTo(target.position.x, target.position.y);
      return;
    }

    if (this._repathIn > 0 && this._movement.isMoving) return;
    this._repathIn = Combatant.REPATH_INTERVAL;
    // A* can fail outright — the target may be standing on a blocked tile after
    // a nudge. Pressing straight on is better than standing still: the sweep
    // stops the mob at the pillar instead of inside it, and the next search runs
    // an interval later.
    if (!this._movement.pathTo(target.position.x, target.position.y)) {
      this._movement.moveTo(target.position.x, target.position.y);
    }
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
