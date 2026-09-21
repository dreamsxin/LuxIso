import {describe, it, expect} from 'vitest';
import {HeroProgress} from '../../examples/10-arpg/Progression';
import {
  ArenaRun, type ArenaEvent, type HeroIntent, type FloatingTextRequest,
} from '../../examples/10-arpg/ArenaRun';

const DT = 1 / 60;

// ── HeroProgress ─────────────────────────────────────────────────────────────

describe('HeroProgress — the curve', () => {
  it('starts at level 1 with nothing earned', () => {
    const p = new HeroProgress();
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.fraction).toBe(0);
    expect(p.damageBonus).toBe(0);
    expect(p.maxHpBonus).toBe(0);
    expect(p.isMaxLevel).toBe(false);
  });

  it('charges XP_BASE * level for each level', () => {
    const p = new HeroProgress();
    expect(p.xpForNextLevel).toBe(HeroProgress.XP_BASE);
    p.gain(HeroProgress.XP_BASE);
    expect(p.level).toBe(2);
    expect(p.xpForNextLevel).toBe(HeroProgress.XP_BASE * 2);
    p.gain(HeroProgress.XP_BASE * 2);
    expect(p.level).toBe(3);
    expect(p.xpForNextLevel).toBe(HeroProgress.XP_BASE * 3);
  });

  it('keeps the remainder inside the new level', () => {
    const p = new HeroProgress();
    p.gain(HeroProgress.XP_BASE + 7);
    expect(p.level).toBe(2);
    expect(p.xp).toBe(7);
  });

  it('crosses several levels on one award', () => {
    const p = new HeroProgress();
    // 30 for L2, 60 for L3, 90 for L4 = 180 exactly.
    const gained = p.gain(180);
    expect(gained).toBe(3);
    expect(p.level).toBe(4);
    expect(p.xp).toBe(0);
  });

  it('reports how many levels an award bought', () => {
    const p = new HeroProgress();
    expect(p.gain(10)).toBe(0);
    expect(p.gain(20)).toBe(1); // 30 total
    expect(p.level).toBe(2);
  });

  it('scales both bonuses with the level', () => {
    const p = new HeroProgress();
    p.gain(90); // 30 + 60 -> level 3
    expect(p.level).toBe(3);
    expect(p.damageBonus).toBe(2 * HeroProgress.DAMAGE_PER_LEVEL);
    expect(p.maxHpBonus).toBe(2 * HeroProgress.MAX_HP_PER_LEVEL);
  });

  it('ignores a non-positive or non-finite award', () => {
    const p = new HeroProgress();
    expect(p.gain(0)).toBe(0);
    expect(p.gain(-50)).toBe(0);
    expect(p.gain(NaN)).toBe(0);
    expect(p.gain(Infinity)).toBe(0);
    expect(p.xp).toBe(0);
    expect(p.level).toBe(1);
  });

  it('stops at the ceiling and banks nothing there', () => {
    const p = new HeroProgress();
    p.gain(1e9);
    expect(p.level).toBe(HeroProgress.MAX_LEVEL);
    expect(p.isMaxLevel).toBe(true);
    expect(p.xpForNextLevel).toBe(0);
    // A parked remainder would show a HUD bar filling towards a level that can
    // never arrive.
    expect(p.xp).toBe(0);
    expect(p.fraction).toBe(1);
    expect(p.gain(500)).toBe(0);
  });

  it('resets to a fresh level 1', () => {
    const p = new HeroProgress();
    p.gain(200);
    p.reset();
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
    expect(p.damageBonus).toBe(0);
  });
});

describe('HeroProgress — snapshot / restore', () => {
  it('round-trips', () => {
    const p = new HeroProgress();
    p.gain(95);
    const snap = p.snapshot();

    const other = new HeroProgress();
    other.restore(snap);
    expect(other.level).toBe(p.level);
    expect(other.xp).toBe(p.xp);
  });

  it('clamps a nonsense level into range', () => {
    const low = new HeroProgress();
    low.restore({level: 0, xp: 0});
    expect(low.level).toBe(1);

    const high = new HeroProgress();
    high.restore({level: 999, xp: 0});
    expect(high.level).toBe(HeroProgress.MAX_LEVEL);
  });

  it('never restores enough xp to level up on load', () => {
    const p = new HeroProgress();
    p.restore({level: 2, xp: 99999});
    expect(p.level).toBe(2);
    expect(p.xp).toBe(p.xpForNextLevel - 1);
  });

  it('treats a missing or non-finite field as a fresh start', () => {
    const p = new HeroProgress();
    p.restore({});
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);

    p.restore({level: NaN, xp: NaN});
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
  });

  it('treats a null progress field as a fresh start', () => {
    const p = new HeroProgress();
    p.gain(95);
    // What `JSON.parse` hands over for `"progress": null` — reading through it
    // would throw, and the checkpoint would be rejected whole.
    p.restore(null);
    expect(p.level).toBe(1);
    expect(p.xp).toBe(0);
  });
});

// ── Arena integration ────────────────────────────────────────────────────────

/** Chase the nearest enemy and swing. What an attentive player does. */
function brawler(run: ArenaRun): HeroIntent {
  const target = run.nearestEnemy();
  if (!target) {
    return {};
  }
  const dx = target.position.x - run.hero.position.x;
  const dy = target.position.y - run.hero.position.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= run.hero.attackRange * 0.8) {
    return {attack: true};
  }
  return {x: dx / distance, y: dy / distance, attack: true};
}

function play(run: ArenaRun, policy: (run: ArenaRun) => HeroIntent, budget = 240): void {
  run.start();
  let t = 0;
  while (!run.isOver && t < budget) {
    run.step(DT, policy(run));
    t += DT;
  }
}

describe('ArenaRun — experience', () => {
  it('prices wave mobs by their wave, and the boss flat', () => {
    const run = new ArenaRun();
    run.start();
    for (const enemy of run.enemies) {
      expect(enemy.xpValue).toBe(ArenaRun.XP_MOB_BASE + 1 * ArenaRun.XP_MOB_PER_WAVE);
    }
    // The hero is not loot.
    expect(run.hero.xpValue).toBe(0);
  });

  it('awards xp on a kill without levelling on wave 1', () => {
    const run = new ArenaRun();
    run.start();
    const value = run.enemies[0].xpValue;
    run.enemies[0].health.takeDamage(9999);
    run.step(DT, {});

    expect(run.progress.xp).toBe(value);
    // Wave 1 pays 24 across two mobs against the 30 a level costs, so the first
    // level has to land in wave 2 — the run should not hand one over for free.
    expect(run.progress.level).toBe(1);
  });

  it('levels up once the threshold is crossed, and raises both stats', () => {
    const run = new ArenaRun();
    run.start();
    const baseDamage = run.hero.damage;
    const baseMax = run.hero.health.maxHp;

    // Park the hero just under the threshold, then kill for the rest.
    run.progress.gain(HeroProgress.XP_BASE - 1);
    run.enemies[0].health.takeDamage(9999);
    run.step(DT, {});

    expect(run.progress.level).toBe(2);
    expect(run.hero.bonusDamage).toBe(HeroProgress.DAMAGE_PER_LEVEL);
    expect(run.hero.attackDamage).toBe(baseDamage + HeroProgress.DAMAGE_PER_LEVEL);
    expect(run.hero.health.maxHp).toBe(baseMax + HeroProgress.MAX_HP_PER_LEVEL);
  });

  it('keeps the missing-hp gap unchanged across a level-up', () => {
    const run = new ArenaRun();
    run.start();
    const baseMax = run.hero.health.maxHp;
    run.hero.health.takeDamage(60); // 60 missing
    run.progress.gain(HeroProgress.XP_BASE - 1);

    run.enemies[0].health.takeDamage(9999);
    run.step(DT, {});

    expect(run.progress.level).toBe(2);
    // The kill heals LIFE_ON_KILL and the level adds MAX_HP_PER_LEVEL to both
    // the maximum and the current, so the level-up itself is not a free top-up.
    const expectedMissing = 60 - ArenaRun.LIFE_ON_KILL;
    expect(run.hero.health.maxHp - run.hero.health.hp).toBe(expectedMissing);
    expect(run.hero.health.maxHp).toBe(baseMax + HeroProgress.MAX_HP_PER_LEVEL);
  });

  it('reports a level-up event and a floating banner', () => {
    const events: ArenaEvent[] = [];
    const texts: FloatingTextRequest[] = [];
    const run = new ArenaRun({
      onEvent: e => events.push(e),
      onFloatingText: t => texts.push(t),
    });
    run.start();
    run.progress.gain(HeroProgress.XP_BASE - 1);
    events.length = 0;
    texts.length = 0;

    run.enemies[0].health.takeDamage(9999);
    run.step(DT, {});

    expect(events.filter(e => (e.type === 'level-up')).length).toBe(1);
    expect(texts.some(t => (t.text === 'LEVEL 2'))).toBe(true);
  });

  it('awards nothing for a mob that outlives the hero', () => {
    const run = new ArenaRun();
    run.start();
    run.hero.health.takeDamage(9999);
    run.enemies[0].health.takeDamage(9999);
    run.step(DT, {});
    // The hero is dead; the kill still counts for the director but pays no xp.
    expect(run.progress.xp).toBe(0);
    expect(run.progress.level).toBe(1);
  });

  it('levels three times across a won run', () => {
    const run = new ArenaRun();
    play(run, brawler);
    expect(run.phase).toBe('victory');

    // 2x12 + 3x16 + 4x20 + 60 = 212 xp; levels cost 30, 60 and 90 (180 total),
    // so a full clear lands on level 4 with 32 towards the next.
    expect(run.progress.level).toBe(4);
    expect(run.progress.xp).toBe(212 - 180);
    expect(run.hero.bonusDamage).toBe(3 * HeroProgress.DAMAGE_PER_LEVEL);
    expect(run.hero.health.maxHp).toBe(140 + 3 * HeroProgress.MAX_HP_PER_LEVEL);
  });

  it('starts a restarted run back at level 1', () => {
    const run = new ArenaRun();
    play(run, brawler);
    expect(run.progress.level).toBeGreaterThan(1);

    run.restart();
    expect(run.progress.level).toBe(1);
    expect(run.progress.xp).toBe(0);
    expect(run.hero.bonusDamage).toBe(0);
    expect(run.hero.health.maxHp).toBe(140);
  });
});

describe('ArenaRun — progression survives a checkpoint', () => {
  it('round-trips level and xp through snapshot + adopt', () => {
    const source = new ArenaRun();
    source.start();
    source.progress.gain(HeroProgress.XP_BASE + 5);
    const snap = source.snapshot();
    expect(snap.progress).toEqual({level: 2, xp: 5});

    const target = new ArenaRun();
    target.adopt([source.hero, ...source.enemies], snap);
    expect(target.progress.level).toBe(2);
    expect(target.progress.xp).toBe(5);
  });

  it('does not re-apply the level bonuses the fighter already carries', () => {
    const source = new ArenaRun();
    source.start();
    source.progress.gain(HeroProgress.XP_BASE - 1);
    source.enemies[0].health.takeDamage(9999);
    source.step(DT, {});
    expect(source.progress.level).toBe(2);

    const maxHp = source.hero.health.maxHp;
    const bonus = source.hero.bonusDamage;

    const target = new ArenaRun();
    target.adopt([source.hero, ...source.enemies], source.snapshot());
    // The hero object is the same one; adopting must not stack a second
    // level-up's worth of stats onto it.
    expect(target.hero.health.maxHp).toBe(maxHp);
    expect(target.hero.bonusDamage).toBe(bonus);
  });

  it('loads a save written before progression existed as level 1', () => {
    const run = new ArenaRun();
    run.start();
    run.progress.gain(100);
    // No `progress` key, the shape an older checkpoint has.
    run.adopt([run.hero, ...run.enemies], {director: run.director.snapshot()});
    expect(run.progress.level).toBe(1);
    expect(run.progress.xp).toBe(0);
  });
});
