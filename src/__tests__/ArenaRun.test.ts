import { describe, it, expect } from 'vitest';
import { TileCollider } from '../physics/TileCollider';
import { ArenaRun, type HeroIntent } from '../../examples/10-arpg/ArenaRun';
import type { Combatant } from '../../examples/10-arpg/Combatant';

/**
 * The arena's closed loop, played out at a fixed dt.
 *
 * The demo's central claim is a run that ends: spawn, three waves, a boss, a
 * result. An idle hero only ever reaches defeat, so victory was unprovable
 * without sitting at a keyboard. Driving `ArenaRun.step` covers both endings.
 *
 * The winning policy has to close distance, not just swing: the boss outranges
 * the hero (1.3 vs 1.15 world units), so a hero who never moves is hit from a
 * spot it cannot reach back into. That is the intended pressure, and it is worth
 * pinning — it makes the difference between a demo that can be won and one that
 * only looks winnable.
 */

const DT = 1 / 60;

/** Chase the nearest enemy and swing. What an attentive player does. */
function brawler(run: ArenaRun): HeroIntent {
  const target = run.nearestEnemy();
  if (!target) return {};
  const dx = target.position.x - run.hero.position.x;
  const dy = target.position.y - run.hero.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= run.hero.attackRange * 0.8) return { attack: true };
  return { x: dx / distance, y: dy / distance, attack: true };
}

const idle = (): HeroIntent => ({});

/** Play until the run ends or the budget runs out. Returns seconds elapsed. */
function play(run: ArenaRun, policy: (run: ArenaRun) => HeroIntent, budget = 240): number {
  run.start();
  let t = 0;
  while (!run.isOver && t < budget) {
    run.step(DT, policy(run));
    t += DT;
  }
  return t;
}

describe('ArenaRun — a full run', () => {
  it('reaches victory when the hero closes in and fights', () => {
    const run = new ArenaRun();
    const seconds = play(run, brawler);

    expect(run.phase).toBe('victory');
    expect(seconds).toBeLessThan(240);
    // 2 + 3 + 4 mobs across three waves, then the boss.
    expect(run.director.kills).toBe(10);
    expect(run.enemies.length).toBe(0);
    expect(run.hero.isDead).toBe(false);
  });

  it('walks every phase in order, once each', () => {
    const phases: string[] = [];
    const run = new ArenaRun({ onPhase: (phase) => phases.push(phase) });
    play(run, brawler);

    expect(phases).toEqual([
      'wave', 'intermission', 'wave', 'intermission', 'wave', 'boss', 'victory',
    ]);
  });

  it('reaches defeat when the hero never swings', () => {
    const run = new ArenaRun();
    play(run, idle);

    expect(run.phase).toBe('defeat');
    expect(run.hero.isDead).toBe(true);
    expect(run.director.kills).toBe(0);
  });

  it('stalls out against the boss if the hero stands its ground', () => {
    // Swinging without closing is not enough: the boss's reach is longer.
    const run = new ArenaRun();
    play(run, () => ({ attack: true }));
    expect(run.director.kills).toBe(9); // all three waves cleared
    expect(run.phase).toBe('defeat');
  });

  it('spawns and despawns through the callbacks, leaving nothing behind', () => {
    const live = new Set<Combatant>();
    const run = new ArenaRun({
      onSpawn: (unit) => live.add(unit),
      onDespawn: (unit) => live.delete(unit),
    });
    play(run, brawler);

    // Only the hero survives; every mob was reported exactly once.
    expect([...live]).toEqual([run.hero]);
  });

  it('does nothing before start, or on a non-finite or non-positive dt', () => {
    const run = new ArenaRun();
    expect(run.phase).toBe('ready');
    run.step(DT, { attack: true });
    expect(run.director.elapsed).toBe(0);

    run.start();
    const hp = run.hero.health.hp;
    run.step(0, { attack: true });
    run.step(-1, { attack: true });
    run.step(NaN, { attack: true });
    expect(run.director.elapsed).toBe(0);
    expect(run.hero.health.hp).toBe(hp);
  });

  it('heals the hero on each kill, never past the maximum', () => {
    const run = new ArenaRun();
    run.start();
    const max = run.hero.health.maxHp;
    run.hero.health.takeDamage(max - 1);   // 1 hp left
    const target = run.enemies[0];
    target.health.takeDamage(target.health.maxHp);
    run.step(DT, {});
    expect(run.hero.health.hp).toBe(1 + ArenaRun.LIFE_ON_KILL);

    run.hero.health.heal(max);
    const other = run.enemies[0];
    other.health.takeDamage(other.health.maxHp);
    run.step(DT, {});
    expect(run.hero.health.hp).toBe(max);
  });
});

describe('ArenaRun — movement', () => {
  it('keeps the hero inside the arena however hard the axis pushes', () => {
    const run = new ArenaRun({ cols: 10, rows: 10 });
    run.start();
    for (let i = 0; i < 600; i++) run.step(DT, { x: 1, y: 1 });
    expect(run.hero.position.x).toBeLessThanOrEqual(8.4);
    expect(run.hero.position.y).toBeLessThanOrEqual(8.4);

    for (let i = 0; i < 1200; i++) run.step(DT, { x: -1, y: -1 });
    expect(run.hero.position.x).toBeGreaterThanOrEqual(0.6);
    expect(run.hero.position.y).toBeGreaterThanOrEqual(0.6);
  });

  it('ignores the axis once the run is over', () => {
    const run = new ArenaRun();
    play(run, idle);
    const x = run.hero.position.x, y = run.hero.position.y;
    for (let i = 0; i < 60; i++) run.step(DT, { x: 1, y: 1 });
    expect(run.hero.position.x).toBeCloseTo(x);
    expect(run.hero.position.y).toBeCloseTo(y);
  });
});

describe('ArenaRun — restart', () => {
  it('rebuilds a finished run from scratch', () => {
    const live = new Set<Combatant>();
    const run = new ArenaRun({
      onSpawn: (unit) => live.add(unit),
      onDespawn: (unit) => live.delete(unit),
    });
    play(run, idle);
    expect(run.phase).toBe('defeat');
    const deadHero = run.hero;

    run.restart();
    expect(run.phase).toBe('wave');
    expect(run.director.wave).toBe(1);
    expect(run.director.kills).toBe(0);
    expect(run.hero).not.toBe(deadHero);
    expect(run.hero.health.hp).toBe(run.hero.health.maxHp);
    expect(live.has(deadHero)).toBe(false);
    // Fresh hero plus wave 1.
    expect(live.size).toBe(1 + run.enemies.length);
  });

  it('can be won after a restart', () => {
    const run = new ArenaRun();
    play(run, idle);
    run.restart();
    let t = 0;
    while (!run.isOver && t < 240) {
      run.step(DT, brawler(run));
      t += DT;
    }
    expect(run.phase).toBe('victory');
  });
});

describe('ArenaRun — crowd separation', () => {
  /** Smallest gap any two living fighters should end a frame with. */
  function closestPair(run: ArenaRun): number {
    const units = [run.hero, ...run.enemies].filter((unit) => !unit.isDead);
    let closest = Infinity;
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        closest = Math.min(closest, Math.hypot(
          units[i].position.x - units[j].position.x,
          units[i].position.y - units[j].position.y,
        ));
      }
    }
    return closest;
  }

  it('pushes a stack apart', () => {
    const run = new ArenaRun();
    run.start();
    // Weld the whole wave onto the hero, the state a converging wave used to reach.
    for (const enemy of run.enemies) {
      enemy.position.x = run.hero.position.x;
      enemy.position.y = run.hero.position.y;
    }
    expect(closestPair(run)).toBe(0);

    for (let i = 0; i < 120; i++) run.step(DT, {});
    const radii = run.hero.movement.radius + run.enemies[0].movement.radius;
    expect(closestPair(run)).toBeGreaterThan(radii * 0.95);
  });

  it('keeps a converging wave from stacking', () => {
    const run = new ArenaRun();
    run.start();
    // Let the mobs close in on an idle hero for a few seconds.
    for (let i = 0; i < 300; i++) run.step(DT, {});
    const radii = run.hero.movement.radius + run.enemies[0].movement.radius;
    expect(closestPair(run)).toBeGreaterThan(radii * 0.9);
  });

  it('leaves the dead where they fell', () => {
    const run = new ArenaRun();
    run.start();
    const victim = run.enemies[0];
    victim.position.x = run.hero.position.x;
    victim.position.y = run.hero.position.y;
    victim.health.takeDamage(999);
    const { x, y } = { x: victim.position.x, y: victim.position.y };

    run.step(DT, {});
    expect(victim.position.x).toBeCloseTo(x);
    expect(victim.position.y).toBeCloseTo(y);
  });

  it('cannot push anyone into a wall', () => {
    const collider = new TileCollider(14, 14);
    for (let row = 0; row < 14; row++) collider.setWalkable(9, row, false);
    const run = new ArenaRun({ collider });
    run.start();

    // Crowd everyone against the wall column.
    run.hero.position.x = 8.4;
    run.hero.position.y = 7;
    for (const enemy of run.enemies) {
      enemy.position.x = 8.4;
      enemy.position.y = 7;
    }
    for (let i = 0; i < 120; i++) run.step(DT, {});

    for (const unit of [run.hero, ...run.enemies]) {
      // Blocked column starts at x = 9; a body of radius r stops short of it.
      expect(unit.position.x).toBeLessThan(9 - unit.movement.radius + 0.01);
    }
  });
});

describe('ArenaRun — cover', () => {
  const arena = (): TileCollider => new TileCollider(14, 14);

  it('blocks four pillar tiles and reports them, leaving the centre free', () => {
    const collider = arena();
    const run = new ArenaRun({ collider });

    expect(run.pillars.length).toBe(4);
    for (const { col, row } of run.pillars) {
      expect(collider.isWalkable(col, row)).toBe(false);
    }
    // The hero spawns in the middle, so that tile must stay open.
    expect(collider.isWalkable(7, 7)).toBe(true);
  });

  it('raises nothing without a collider, or when asked not to', () => {
    expect(new ArenaRun().pillars).toEqual([]);

    const collider = arena();
    const run = new ArenaRun({ collider, pillars: false });
    expect(run.pillars).toEqual([]);
    expect(collider.version).toBe(0);
  });

  it('never spawns a fighter inside a pillar', () => {
    const collider = arena();
    const seen: Combatant[] = [];
    const run = new ArenaRun({ collider, onSpawn: (unit) => seen.push(unit) });
    play(run, brawler);

    expect(seen.length).toBeGreaterThan(4);
    for (const unit of seen) {
      // Spawn positions are recorded on the way in; a wedged mob would have been
      // placed on blocked ground and could never have moved off it.
      expect(collider.isWalkable(
        Math.floor(unit.position.x), Math.floor(unit.position.y),
      )).toBe(true);
    }
  });

  it('lets mobs reach a hero standing behind cover', () => {
    const collider = arena();
    const run = new ArenaRun({ collider });
    run.start();
    // Tuck the hero directly behind a pillar, on the line from the spawn ring.
    const pillar = run.pillars[0];
    run.hero.position.x = pillar.col - 0.9;
    run.hero.position.y = pillar.row - 0.9;

    const start = run.hero.health.hp;
    for (let i = 0; i < 60 * 12; i++) run.step(DT, {});
    // Cover delays the wave; it does not make the hero unreachable.
    expect(run.hero.health.hp).toBeLessThan(start);
  });

  it('is still winnable with cover in the arena', () => {
    const run = new ArenaRun({ collider: arena() });
    play(run, brawler);
    expect(run.phase).toBe('victory');
    expect(run.director.kills).toBe(10);
  });
});

describe('ArenaRun — checkpoint', () => {
  it('resumes a mid-run save and still reaches victory', () => {
    const source = new ArenaRun();
    source.start();
    // Play into wave 2, then save: the fighters plus the bookkeeping.
    let t = 0;
    while (source.director.wave < 2 && t < 120) {
      source.step(DT, brawler(source));
      t += DT;
    }
    const snapshot = source.snapshot();
    const fighters = [source.hero, ...source.enemies];
    expect(snapshot.director.kills).toBeGreaterThan(0);

    const resumed = new ArenaRun();
    expect(resumed.adopt(fighters, snapshot)).toBe(true);
    expect(resumed.hero).toBe(source.hero);
    expect(resumed.director.wave).toBe(snapshot.director.wave);
    expect(resumed.director.kills).toBe(snapshot.director.kills);
    expect(resumed.phase).toBe(snapshot.director.phase);

    play(resumed, brawler);
    expect(resumed.phase).toBe('victory');
    // The kills carried over, so the total counts the whole run, not just the tail.
    expect(resumed.director.kills).toBe(10);
  });

  it('swaps scene membership through the callbacks', () => {
    const live = new Set<Combatant>();
    const source = new ArenaRun();
    source.start();
    const fighters = [source.hero, ...source.enemies];

    const target = new ArenaRun({
      onSpawn: (unit) => live.add(unit),
      onDespawn: (unit) => live.delete(unit),
    });
    target.start();
    const replaced = [target.hero, ...target.enemies];
    expect(live.size).toBe(replaced.length);

    target.adopt(fighters, source.snapshot());
    expect([...live].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...fighters].sort((a, b) => a.id.localeCompare(b.id)));
    for (const unit of replaced) expect(live.has(unit)).toBe(false);
  });

  it('refuses a save with no hero and changes nothing', () => {
    const run = new ArenaRun();
    run.start();
    const hero = run.hero;
    const enemies = [...run.enemies];

    expect(run.adopt(enemies, run.snapshot())).toBe(false);
    expect(run.hero).toBe(hero);
    expect(run.enemies).toEqual(enemies);
  });

  it('does not re-spawn the wave it adopted', () => {
    const source = new ArenaRun();
    source.start();
    const fighters = [source.hero, ...source.enemies];

    const live = new Set<Combatant>();
    const target = new ArenaRun({
      onSpawn: (unit) => live.add(unit),
      onDespawn: (unit) => live.delete(unit),
    });
    // The constructor already spawned a placeholder hero; adopting replaces it.
    expect(live.size).toBe(1);

    target.adopt(fighters, source.snapshot());
    expect([...live]).toEqual(fighters);
    expect(target.enemies.length).toBe(fighters.length - 1);
  });
});

