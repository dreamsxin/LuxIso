/**
 * ArenaRun — the arena's rules, with no renderer, canvas or input attached.
 *
 * `main.ts` used to own the loop body as well as the page, which left the demo's
 * central claim — spawn, three waves, a boss, a result — provable only by playing
 * it in a browser. Everything here is driven by `step(dt, intent)`, so a full run
 * (including victory, which an idle hero never reaches) is a unit test.
 *
 * Spawning crosses the boundary through `onSpawn` / `onDespawn`; the caller adds
 * to and removes from its own `Scene`. Movement is integrated through
 * `Entity.fixedUpdate(dt)` rather than the timestamp path: it is deterministic
 * under a fixed dt, and `MovementComponent` latches onto fixed stepping once it
 * is used, so a `Scene.update(ts)` in the same frame cannot integrate twice.
 */
import type { TileCollider } from '../../src/index';
import { Combatant } from './Combatant';
import { WaveDirector, type ArpgPhase } from './WaveDirector';

/** What the player (or a test) asks of the hero this frame. */
export interface HeroIntent {
  /** Movement axis, components in [-1, 1]. */
  x?: number;
  y?: number;
  /** Swing at the nearest enemy in reach. */
  attack?: boolean;
}

export interface ArenaRunOptions {
  cols?: number;
  rows?: number;
  waves?: number;
  intermission?: number;
  heroSpeed?: number;
  collider?: TileCollider | null;
  onSpawn?: (unit: Combatant) => void;
  onDespawn?: (unit: Combatant) => void;
  onPhase?: (phase: ArpgPhase, previous: ArpgPhase) => void;
}

export class ArenaRun {
  /**
   * Health returned for each kill.
   *
   * Not decoration: without it the tuning below is unwinnable. A hero who does
   * nothing but swing takes roughly 330 damage across the three waves and the
   * boss, so any fixed pool either makes the run impossible or has to be so large
   * that nothing is ever threatening. Life on kill is the ARPG answer — the run
   * is survivable exactly as long as the hero keeps killing.
   */
  static readonly LIFE_ON_KILL = 12;

  private readonly _opts: ArenaRunOptions;
  private readonly _cols: number;
  private readonly _rows: number;
  private readonly _heroSpeed: number;
  private readonly _min: number;
  private readonly _max: number;

  private _hero!: Combatant;
  private _enemies: Combatant[] = [];
  private _director!: WaveDirector;

  constructor(opts: ArenaRunOptions = {}) {
    this._opts = opts;
    this._cols = Math.max(4, Math.floor(opts.cols ?? 14));
    this._rows = Math.max(4, Math.floor(opts.rows ?? 14));
    this._heroSpeed = Math.max(0, opts.heroSpeed ?? 3.2);
    this._min = 0.6;
    this._max = Math.min(this._cols, this._rows) - 1.6;
    this._hero = this._spawnHero();
    this._director = this._newDirector();
  }

  get hero(): Combatant { return this._hero; }
  get enemies(): readonly Combatant[] { return this._enemies; }
  get director(): WaveDirector { return this._director; }
  get phase(): ArpgPhase { return this._director.phase; }
  get isOver(): boolean { return this._director.isOver; }

  /**
   * Begin the run — wave 1 spawns here, not in the constructor.
   *
   * Starting during construction would fire `onSpawn` / `onPhase` before the
   * caller's own `const run = new ArenaRun(...)` binding exists, so any callback
   * that reads the instance would throw on a temporal-dead-zone error. `step()`
   * before this does nothing.
   */
  start(): void {
    this._director.start();
  }

  /** Tear the run down and start a fresh one. */
  restart(): void {
    for (const unit of [this._hero, ...this._enemies]) this._opts.onDespawn?.(unit);
    this._enemies = [];
    this._hero = this._spawnHero();
    this._director = this._newDirector();
    this._director.start();
  }

  /** Nearest living enemy, or null. */
  nearestEnemy(): Combatant | null {
    let best: Combatant | null = null;
    let bestDistance = Infinity;
    for (const enemy of this._enemies) {
      if (enemy.isDead) continue;
      const distance = Math.hypot(
        enemy.position.x - this._hero.position.x,
        enemy.position.y - this._hero.position.y,
      );
      if (distance >= bestDistance) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best;
  }

  /** Advance one frame. `dt` is seconds; a non-finite or non-positive dt is ignored. */
  step(dt: number, intent: HeroIntent = {}): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const fighting = this.phase === 'wave' || this.phase === 'boss';

    if (fighting && !this._hero.isDead) {
      const x = intent.x ?? 0;
      const y = intent.y ?? 0;
      if (x !== 0 || y !== 0) {
        // Swept against the collider, so a long frame cannot tunnel through a wall.
        this._hero.movement.nudge(x * this._heroSpeed * dt, y * this._heroSpeed * dt);
      }
      this._hero.position.x = Math.min(this._max, Math.max(this._min, this._hero.position.x));
      this._hero.position.y = Math.min(this._max, Math.max(this._min, this._hero.position.y));
    }

    this._hero.tick(dt);
    if (fighting && intent.attack) this._hero.swing(this.nearestEnemy());

    for (const enemy of this._enemies) enemy.think(dt, fighting ? this._hero : null);

    this._hero.fixedUpdate(dt);
    for (const enemy of this._enemies) enemy.fixedUpdate(dt);

    // Report each death once, then drop it.
    const survivors: Combatant[] = [];
    for (const enemy of this._enemies) {
      if (!enemy.isDead) { survivors.push(enemy); continue; }
      this._opts.onDespawn?.(enemy);
      if (!this._hero.isDead) this._hero.health.heal(ArenaRun.LIFE_ON_KILL);
      this._director.reportMobDefeated();
    }
    this._enemies = survivors;

    if (this._hero.isDead) this._director.reportHeroDefeated();
    this._director.update(dt);
  }

  private _newDirector(): WaveDirector {
    return new WaveDirector({
      waves: this._opts.waves ?? 3,
      intermission: this._opts.intermission ?? 2.5,
      mobsPerWave: (wave) => 1 + wave,
      onSpawnWave: (wave, count) => {
        for (let i = 0; i < count; i++) this._spawnEnemy(`w${wave}-${i}`, i, count, wave);
      },
      onSpawnBoss: () => this._spawnBoss(),
      onPhase: this._opts.onPhase,
    });
  }

  private _spawnHero(): Combatant {
    const unit = new Combatant('hero', this._cols / 2, this._rows / 2, {
      faction: 'hero', hp: 140, damage: 16, speed: this._heroSpeed,
      attackRange: 1.15, attackInterval: 0.4, radius: 15, color: '#6fd8ff',
      collider: this._opts.collider ?? null,
    });
    this._opts.onSpawn?.(unit);
    return unit;
  }

  /** Enemies enter on a ring, so they always have to close in. */
  private _spawnEnemy(id: string, index: number, count: number, wave: number): void {
    const angle = (index / count) * Math.PI * 2 + wave;
    const cx = this._cols / 2, cy = this._rows / 2;
    const unit = new Combatant(id, cx + Math.cos(angle) * 5.5, cy + Math.sin(angle) * 5.5, {
      hp: 24 + wave * 8, damage: 4 + wave, speed: 1.5 + wave * 0.18,
      attackInterval: 1.25, radius: 13, color: wave >= 3 ? '#e0743c' : '#c8563c',
      collider: this._opts.collider ?? null,
    });
    this._enemies.push(unit);
    this._opts.onSpawn?.(unit);
  }

  private _spawnBoss(): void {
    const unit = new Combatant('boss', this._cols / 2, 1.4, {
      hp: 220, damage: 14, speed: 1.35, attackRange: 1.3, attackInterval: 1.4,
      radius: 24, color: '#b048d0', collider: this._opts.collider ?? null,
    });
    this._enemies.push(unit);
    this._opts.onSpawn?.(unit);
  }
}
