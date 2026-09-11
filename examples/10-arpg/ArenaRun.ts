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
 *
 * Given a `collider`, the arena raises four pillars for cover and reports them
 * through `pillars` for the caller to draw. Cover is what turned the mobs'
 * straight-line chase into a pathfinding one.
 */
import { PathCache } from '../../src/index';
import type { TileCollider } from '../../src/index';
import { Combatant } from './Combatant';
import { WaveDirector, type ArpgPhase, type WaveDirectorSnapshot } from './WaveDirector';

/** A blocked arena tile. */
export interface PillarTile { col: number; row: number; }

/** A run's bookkeeping, saved next to the serialized scene. */
export interface ArenaRunSnapshot {
  director: WaveDirectorSnapshot;
}

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
  /**
   * Block four pillar tiles for cover. Default true, and only ever visible with
   * a `collider` — without one there is nothing to block. Set false for a run
   * that should play out on an empty floor.
   */
  pillars?: boolean;
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
  private readonly _pillars: readonly PillarTile[];
  /**
   * One cache for every fighter in the arena.
   *
   * `MovementComponent` used to have no way to accept one, so `pathTo()` always
   * searched the module-level default that every other scene shares. Pooling the
   * mobs here is the point: a wave chasing one hero asks for the same handful of
   * start→goal tile pairs, so the second mob onward gets a cache hit.
   */
  private readonly _pathCache = new PathCache(96);

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
    this._pillars = this._raiseCover();
    this._hero = this._spawnHero();
    this._director = this._newDirector();
  }

  get hero(): Combatant { return this._hero; }
  get enemies(): readonly Combatant[] { return this._enemies; }
  get director(): WaveDirector { return this._director; }
  get phase(): ArpgPhase { return this._director.phase; }
  get isOver(): boolean { return this._director.isOver; }
  /** Blocked cover tiles, for the caller to draw something on. */
  get pillars(): readonly PillarTile[] { return this._pillars; }

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

  /**
   * The run's bookkeeping, to be stored next to a serialized scene.
   *
   * The fighters are not in here: they are scene objects, and the scene has its
   * own serializer (`examples/10-arpg/persistence.ts` registers both directions).
   * A checkpoint is the pair.
   */
  snapshot(): ArenaRunSnapshot {
    return { director: this._director.snapshot() };
  }

  /**
   * Take over fighters restored from a saved scene, plus that save's bookkeeping.
   *
   * The current fighters are reported through `onDespawn` and the adopted ones
   * through `onSpawn`, so the caller's scene follows without a second code path.
   * Wave spawning stays quiet: the units already exist, so re-running the
   * director's `start()` would double the wave.
   *
   * @returns false if the save has no hero, in which case nothing changes.
   */
  adopt(fighters: readonly Combatant[], snapshot: Partial<ArenaRunSnapshot> = {}): boolean {
    const hero = fighters.find((unit) => unit.faction === 'hero');
    if (!hero) return false;

    for (const unit of [this._hero, ...this._enemies]) this._opts.onDespawn?.(unit);
    this._hero = hero;
    this._enemies = fighters.filter((unit) => unit !== hero);
    this._director = this._newDirector();
    if (snapshot.director) this._director.restore(snapshot.director);
    for (const unit of fighters) this._opts.onSpawn?.(unit);
    return true;
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
    this._separate();


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

  /**
   * Keep living fighters from standing inside each other.
   *
   * `MovementComponent` collides with tiles, not with other units, so a wave used
   * to converge into a single stack on the hero: four mobs on one tile, three of
   * them invisible behind the fourth. Each overlapping pair is pushed apart by
   * half the overlap, through `nudge` so a push is still swept against the
   * collider and cannot shove anyone into a wall.
   *
   * O(n²) is deliberate at this scale — a wave is single digits. A framework-level
   * version would need spatial bucketing, and that decision is not this demo's to
   * make; this is the smallest thing that proves the behaviour is worth having.
   */
  private _separate(): void {
    const units: Combatant[] = [];
    if (!this._hero.isDead) units.push(this._hero);
    for (const enemy of this._enemies) if (!enemy.isDead) units.push(enemy);

    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        const minDistance = a.movement.radius + b.movement.radius;
        let dx = b.position.x - a.position.x;
        let dy = b.position.y - a.position.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;

        if (distance < 1e-6) {
          // Exactly stacked — a wave can seat two mobs on the same ring point.
          // Pick a deterministic axis rather than leaving them welded together.
          dx = i % 2 === 0 ? 1 : 0;
          dy = i % 2 === 0 ? 0 : 1;
          distance = 1;
        }

        const push = (minDistance - distance) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        a.movement.nudge(-nx * push, -ny * push);
        b.movement.nudge(nx * push, ny * push);
      }
    }
  }

  /**
   * Block four pillar tiles, and report them so the caller can draw something
   * there.
   *
   * Cover is what makes the chase interesting and is also the reason the mobs
   * needed pathfinding at all: a straight `moveTo` walks into the pillar face
   * and stays there, sliding along it at best. Four tiles is enough to break the
   * line from the spawn ring to the centre without ever sealing a region off —
   * single tiles cannot enclose anything, so no wave can spawn unreachable.
   */
  private _raiseCover(): readonly PillarTile[] {
    const collider = this._opts.collider;
    if (!collider || this._opts.pillars === false) return [];

    const cx = Math.floor(this._cols / 2);
    const cy = Math.floor(this._rows / 2);
    const dx = Math.max(2, Math.round(this._cols * 0.22));
    const dy = Math.max(2, Math.round(this._rows * 0.22));

    const tiles: PillarTile[] = [];
    for (const [col, row] of [
      [cx - dx, cy - dy], [cx + dx, cy - dy], [cx - dx, cy + dy], [cx + dx, cy + dy],
    ]) {
      // Skip anything the arena is too small to hold, and never block the centre
      // the hero starts on.
      if (col < 1 || row < 1 || col >= this._cols - 1 || row >= this._rows - 1) continue;
      if (col === cx && row === cy) continue;
      if (!collider.isWalkable(col, row)) continue;
      collider.setWalkable(col, row, false);
      tiles.push({ col, row });
    }
    return tiles;
  }

  /**
   * A free spot on the spawn ring at or after `angle`.
   *
   * A pillar sits on the ring's path for some angles, and spawning a mob inside
   * one leaves it wedged: `sweepMove` correctly refuses to move a body that is
   * already overlapping blocked ground, so it never joins the fight and the wave
   * never ends. Rotating to the next free angle is the cheap fix.
   */
  private _ringSpot(angle: number, radius: number): { x: number; y: number } {
    const cx = this._cols / 2, cy = this._rows / 2;
    const collider = this._opts.collider;
    for (let i = 0; i < 24; i++) {
      const a = angle + (i * Math.PI) / 12;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      if (!collider) return { x, y };
      if (collider.isWalkable(Math.floor(x), Math.floor(y))) return { x, y };
    }
    return { x: cx, y: cy };
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
    const spot = this._ringSpot(angle, 5.5);
    const unit = new Combatant(id, spot.x, spot.y, {
      hp: 24 + wave * 8, damage: 4 + wave, speed: 1.5 + wave * 0.18,
      attackInterval: 1.25, radius: 13, color: wave >= 3 ? '#e0743c' : '#c8563c',
      collider: this._opts.collider ?? null,
      pathCache: this._pathCache,
    });
    this._enemies.push(unit);
    this._opts.onSpawn?.(unit);
  }

  private _spawnBoss(): void {
    const unit = new Combatant('boss', this._cols / 2, 1.4, {
      hp: 220, damage: 14, speed: 1.35, attackRange: 1.3, attackInterval: 1.4,
      radius: 24, color: '#b048d0', collider: this._opts.collider ?? null,
      pathCache: this._pathCache,
    });
    this._enemies.push(unit);
    this._opts.onSpawn?.(unit);
  }
}
