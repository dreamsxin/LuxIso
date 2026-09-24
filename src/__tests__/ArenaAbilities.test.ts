import {describe, it, expect} from 'vitest';
import {AbilityBook} from '../../examples/10-arpg/Abilities';
import {ArenaRun, type ArenaEvent, type HeroIntent, type FloatingTextRequest} from '../../examples/10-arpg/ArenaRun';

const DT = 1 / 60;

// ── AbilityBook ──────────────────────────────────────────────────────────────

describe('AbilityBook — timers', () => {
  it('starts with every ability ready', () => {
    const book = new AbilityBook();
    for (const id of book.ids) {
      expect(book.ready(id)).toBe(true);
      expect(book.remaining(id)).toBe(0);
      expect(book.fraction(id)).toBe(0);
    }
  });

  it('puts an ability on cooldown when used', () => {
    const book = new AbilityBook();
    expect(book.use('cleave')).toBe(true);
    expect(book.ready('cleave')).toBe(false);
    expect(book.remaining('cleave')).toBe(AbilityBook.COOLDOWNS.cleave);
    expect(book.fraction('cleave')).toBeCloseTo(1);
  });

  it('refuses a second use before the timer expires', () => {
    const book = new AbilityBook();
    book.use('dash');
    expect(book.use('dash')).toBe(false);
    // The timer must not have changed.
    expect(book.remaining('dash')).toBe(AbilityBook.COOLDOWNS.dash);
  });

  it('counts the timer down to zero', () => {
    const book = new AbilityBook();
    book.use('cleave');
    const cd = AbilityBook.COOLDOWNS.cleave;
    // Tick most of the way.
    book.tick(cd - 0.1);
    expect(book.ready('cleave')).toBe(false);
    expect(book.remaining('cleave')).toBeCloseTo(0.1, 6);
    // Tick past the end — the remaining must clamp to 0, not go negative.
    book.tick(0.2);
    expect(book.ready('cleave')).toBe(true);
    expect(book.remaining('cleave')).toBe(0);
    expect(book.fraction('cleave')).toBe(0);
  });

  it('ignores a non-positive or non-finite dt', () => {
    const book = new AbilityBook();
    book.use('cleave');
    const before = book.remaining('cleave');
    book.tick(0);
    book.tick(-1);
    book.tick(NaN);
    book.tick(Infinity);
    expect(book.remaining('cleave')).toBe(before);
  });

  it('leaves the other ability untouched when one is used', () => {
    const book = new AbilityBook();
    book.use('cleave');
    expect(book.ready('dash')).toBe(true);
    expect(book.remaining('dash')).toBe(0);
  });

  it('resets every timer at once', () => {
    const book = new AbilityBook();
    book.use('cleave');
    book.use('dash');
    book.reset();
    for (const id of book.ids) {expect(book.ready(id)).toBe(true);}
  });
});

describe('AbilityBook — snapshot / restore', () => {
  it('round-trips through a snapshot', () => {
    const book = new AbilityBook();
    book.use('cleave');
    book.tick(1);
    const snap = book.snapshot();

    const other = new AbilityBook();
    other.restore(snap);
    expect(other.remaining('cleave')).toBeCloseTo(book.remaining('cleave'));
    expect(other.remaining('dash')).toBe(0);
  });

  it('clamps over-long values and ignores NaN', () => {
    const book = new AbilityBook();
    book.restore({remaining: {cleave: 999, dash: NaN}});
    expect(book.remaining('cleave')).toBe(AbilityBook.COOLDOWNS.cleave);
    expect(book.remaining('dash')).toBe(0);
  });

  it('treats missing keys as ready', () => {
    const book = new AbilityBook();
    book.use('cleave');
    book.use('dash');
    book.restore({remaining: {}});
    expect(book.ready('cleave')).toBe(true);
    expect(book.ready('dash')).toBe(true);
  });
});

// ── Arena integration: cleave and dash ────────────────────────────────────────

/** Chase the nearest enemy and swing. What an attentive player does. */
function brawler(run: ArenaRun): HeroIntent {
  const target = run.nearestEnemy();
  if (!target) {return {};}
  const dx = target.position.x - run.hero.position.x;
  const dy = target.position.y - run.hero.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= run.hero.attackRange * 0.8) {return {attack: true};}
  return {x: dx / distance, y: dy / distance, attack: true};
}

/** Play until the run ends or the budget runs out. */
function play(
  run: ArenaRun,
  policy: (run: ArenaRun) => HeroIntent,
  budget = 240
): void {
  run.start();
  let t = 0;
  while (!run.isOver && t < budget) { run.step(DT, policy(run)); t += DT; }
}

describe('ArenaRun — cleave', () => {
  /**
   * Wave 1 is two mobs, which is exactly what the radius claim needs: one
   * inside, one outside. A test where every enemy is in range cannot tell a
   * bounded area skill from an unbounded one.
   */
  it('hits an enemy inside the radius and not one outside it', () => {
    const run = new ArenaRun({cols: 20, rows: 20, pillars: false});
    run.start();
    run.hero.position.x = 10;
    run.hero.position.y = 10;

    const inside = run.enemies[0];
    const outside = run.enemies[1];
    inside.position.x = 10 + ArenaRun.CLEAVE_RADIUS * 0.95;
    inside.position.y = 10;
    outside.position.x = 10 + ArenaRun.CLEAVE_RADIUS * 1.05;
    outside.position.y = 10;

    const insideHp = inside.health.hp;
    const outsideHp = outside.health.hp;
    run.step(DT, {cleave: true});

    expect(inside.health.hp).toBe(insideHp - ArenaRun.CLEAVE_DAMAGE);
    expect(outside.health.hp).toBe(outsideHp);
  });

  /**
   * One cue for the swing, not one per body.
   *
   * With a single target this assertion cannot fail, so both mobs have to be in
   * range: emitting `hero-hit` per target would produce two events here, which
   * is the amplitude spike `ArenaAudio`'s voice budget exists to prevent.
   */
  it('reports one cleave event however many it caught', () => {
    const events: ArenaEvent[] = [];
    const run = new ArenaRun({
      cols: 20, rows: 20, pillars: false,
      onEvent: e => events.push(e),
    });
    run.start();
    run.hero.position.x = 10;
    run.hero.position.y = 10;
    for (const enemy of run.enemies) {
      enemy.position.x = 10 + ArenaRun.CLEAVE_RADIUS * 0.4;
      enemy.position.y = 10;
    }

    events.length = 0;
    run.step(DT, {cleave: true});

    const hit = run.enemies.filter(
      e => e.health.hp === e.health.maxHp - ArenaRun.CLEAVE_DAMAGE
    );
    expect(hit.length).toBe(2);
    expect(events.filter(e => e.type === 'cleave').length).toBe(1);
    expect(events.filter(e => e.type === 'hero-hit').length).toBe(0);
  });

  it('does not go on cooldown when nothing is in range', () => {
    const run = new ArenaRun({cols: 40, rows: 40, pillars: false});
    run.start();
    // Hero in the corner; the spawn ring is 5.5 units around the centre.
    run.hero.position.x = 0.8;
    run.hero.position.y = 0.8;
    run.step(DT, {cleave: true});
    expect(run.abilities.ready('cleave')).toBe(true);
  });

  it('is gated by the cooldown', () => {
    const run = new ArenaRun({cols: 20, rows: 20, pillars: false});
    run.start();
    for (const e of run.enemies) {
      e.position.x = run.hero.position.x + 0.5;
      e.position.y = run.hero.position.y;
    }
    run.step(DT, {cleave: true});
    expect(run.abilities.ready('cleave')).toBe(false);

    const hpAfter = run.enemies.map(e => e.health.hp);
    run.step(DT, {cleave: true});
    run.enemies.forEach((e, i) => expect(e.health.hp).toBe(hpAfter[i]));
  });

  it('can still win the run with the old brawler policy', () => {
    const run = new ArenaRun();
    play(run, brawler);
    expect(run.phase).toBe('victory');
    expect(run.director.kills).toBe(10);
  });
});

describe('ArenaRun — dash', () => {
  it('lunges along the movement axis through nudge', () => {
    const run = new ArenaRun({cols: 20, rows: 20, pillars: false});
    run.start();
    run.hero.position.x = 10;
    run.hero.position.y = 10;
    const before = run.hero.position.x;
    run.step(DT, {x: 1, y: 0, dash: true});
    expect(run.hero.position.x - before).toBeGreaterThan(ArenaRun.DASH_DISTANCE * 0.5);
  });

  it('aims at the nearest enemy when the axis is idle', () => {
    const events: ArenaEvent[] = [];
    const run = new ArenaRun({
      cols: 20, rows: 20, pillars: false,
      onEvent: e => events.push(e),
    });
    run.start();
    run.hero.position.x = 10;
    run.hero.position.y = 10;
    const target = run.enemies[0];
    target.position.x = 13;
    target.position.y = 10;
    events.length = 0;
    run.step(DT, {dash: true});
    expect(events.some(e => e.type === 'dash')).toBe(true);
    expect(run.hero.position.x).toBeGreaterThan(10.5);
    expect(run.abilities.ready('dash')).toBe(false);
  });

  it('does nothing without an axis or a target', () => {
    const run = new ArenaRun({cols: 20, rows: 20, pillars: false});
    run.start();
    // Kill all enemies so there is no fallback target.
    for (const e of run.enemies) {e.health.takeDamage(9999);}
    run.step(DT, {}); // despawn the dead
    const x = run.hero.position.x;
    run.step(DT, {dash: true});
    expect(run.hero.position.x).toBeCloseTo(x);
    expect(run.abilities.ready('dash')).toBe(true);
  });
});

describe('ArenaRun — abilities survive a checkpoint', () => {
  it('round-trips skill cooldowns through snapshot + adopt', () => {
    const source = new ArenaRun();
    source.start();
    // Place an enemy right on the hero so the cleave connects.
    source.enemies[0].position.x = source.hero.position.x + 0.3;
    source.enemies[0].position.y = source.hero.position.y;
    source.step(DT, {cleave: true});
    expect(source.abilities.ready('cleave')).toBe(false);

    const snap = source.snapshot();
    expect(snap.abilities).toBeDefined();

    const target = new ArenaRun();
    target.adopt([source.hero, ...source.enemies], snap);
    expect(target.abilities.remaining('cleave')).toBeCloseTo(
      source.abilities.remaining('cleave')
    );
  });
});

// ── Floating damage numbers ──────────────────────────────────────────────────

describe('ArenaRun — floating text', () => {
  it('shows a white number on the target when the hero hits', () => {
    const texts: FloatingTextRequest[] = [];
    const run = new ArenaRun({
      cols: 20, rows: 20, pillars: false,
      onFloatingText: t => texts.push(t),
    });
    run.start();
    const target = run.enemies[0];
    target.position.x = run.hero.position.x + run.hero.attackRange * 0.8;
    target.position.y = run.hero.position.y;
    run.step(DT, {attack: true});

    const dmg = texts.find(t => t.text === String(run.hero.damage));
    expect(dmg).toBeDefined();
    expect(dmg!.color).toBe('#ffffff');
  });

  it('shows a red number on the hero when an enemy lands', () => {
    const texts: FloatingTextRequest[] = [];
    const run = new ArenaRun({
      cols: 20, rows: 20, pillars: false,
      onFloatingText: t => texts.push(t),
    });
    run.start();
    const mob = run.enemies[0];
    mob.position.x = run.hero.position.x + mob.attackRange * 0.5;
    mob.position.y = run.hero.position.y;
    // Tick until the mob attacks — its think() calls swing().
    for (let i = 0; i < 120; i++) {run.step(DT, {});}
    const red = texts.find(t => t.color === '#ff6060');
    expect(red).toBeDefined();
  });

  it('shows a gold number per cleave target', () => {
    const texts: FloatingTextRequest[] = [];
    const run = new ArenaRun({
      cols: 20, rows: 20, pillars: false,
      onFloatingText: t => texts.push(t),
    });
    run.start();
    for (const e of run.enemies) {
      e.position.x = run.hero.position.x + ArenaRun.CLEAVE_RADIUS * 0.4;
      e.position.y = run.hero.position.y;
    }
    texts.length = 0;
    run.step(DT, {cleave: true});
    const golds = texts.filter(t => t.color === '#ffd070');
    expect(golds.length).toBe(2); // wave 1 = 2 enemies
    expect(golds[0].text).toBe(String(ArenaRun.CLEAVE_DAMAGE));
  });

  it('shows a green heal number on kill', () => {
    const texts: FloatingTextRequest[] = [];
    const run = new ArenaRun({
      cols: 20, rows: 20, pillars: false,
      onFloatingText: t => texts.push(t),
    });
    run.start();
    run.enemies[0].health.takeDamage(9999);
    texts.length = 0;
    run.step(DT, {});
    const heal = texts.find(t => t.color === '#7ce08a');
    expect(heal).toBeDefined();
    expect(heal!.text).toBe(`+${ArenaRun.LIFE_ON_KILL}`);
  });
});
