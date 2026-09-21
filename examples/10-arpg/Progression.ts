/**
 * HeroProgress — experience and levels, with no knowledge of the arena.
 *
 * Kills are the only source of experience and a level only ever raises two
 * numbers, so this is deliberately small: a curve, a counter, and the two
 * derived bonuses. What a level *does* to the hero belongs to `ArenaRun`, which
 * owns the fighter; what a level *costs* belongs here, where it can be checked
 * arithmetically.
 *
 * `xp` is experience **inside the current level**, not a running total. That is
 * the number a HUD bar needs, and it also makes `restore` robust: a save cannot
 * disagree with itself about how far through a level the hero is, the way a
 * `level` + `totalXp` pair can after the curve is retuned.
 */

/** A hero's progression, for a checkpoint. */
export interface HeroProgressSnapshot {
  level: number;
  /** Experience inside `level`, not the lifetime total. */
  xp: number;
}

export class HeroProgress {
  /**
   * Experience for level `n` → `n + 1` is `XP_BASE * n`.
   *
   * Linear rather than exponential because the run is ten kills long: an
   * exponential curve would make the boss level nothing at all. 30 is chosen
   * against the actual payout — wave 1 pays 24, so the first level lands in
   * wave 2 rather than being handed over before the player has done anything.
   */
  static readonly XP_BASE = 30;
  /** Nothing in the arena pays enough to reach this; it is a guard, not a goal. */
  static readonly MAX_LEVEL = 10;
  static readonly DAMAGE_PER_LEVEL = 3;
  static readonly MAX_HP_PER_LEVEL = 14;

  private _level = 1;
  private _xp = 0;

  get level(): number { return this._level; }
  /** Experience inside the current level. */
  get xp(): number { return this._xp; }
  get isMaxLevel(): boolean { return this._level >= HeroProgress.MAX_LEVEL; }

  /** Experience needed to finish this level; 0 once there is nowhere to go. */
  get xpForNextLevel(): number {
    return this.isMaxLevel ? 0 : HeroProgress.XP_BASE * this._level;
  }

  /** Progress through the current level in [0, 1]. Full at max level. */
  get fraction(): number {
    const need = this.xpForNextLevel;
    if (need <= 0) {
      return 1;
    }
    return Math.min(1, this._xp / need);
  }

  /** Damage added on top of the hero's base, from levels earned so far. */
  get damageBonus(): number {
    return (this._level - 1) * HeroProgress.DAMAGE_PER_LEVEL;
  }

  /** Maximum hp added by levels earned so far. */
  get maxHpBonus(): number {
    return (this._level - 1) * HeroProgress.MAX_HP_PER_LEVEL;
  }

  /**
   * Award experience.
   *
   * Loops, so one large award can cross several levels at once — a boss worth
   * two levels must hand over both, not bank the remainder invisibly. A
   * non-finite or non-positive amount is ignored, the same rule the clocks use.
   *
   * @returns how many levels were gained, so the caller can apply the bonuses
   *   and announce them without recomputing the difference itself.
   */
  gain(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }
    if (this.isMaxLevel) {
      return 0;
    }

    this._xp += amount;
    let gained = 0;
    while (!this.isMaxLevel && this._xp >= this.xpForNextLevel) {
      this._xp -= this.xpForNextLevel;
      this._level++;
      gained++;
    }
    // At the ceiling the leftover has nowhere to go; parking it would leave the
    // HUD bar showing progress towards a level that will never arrive.
    if (this.isMaxLevel) {
      this._xp = 0;
    }
    return gained;
  }

  /** Back to level 1 with nothing earned. */
  reset(): void {
    this._level = 1;
    this._xp = 0;
  }

  snapshot(): HeroProgressSnapshot {
    return {level: this._level, xp: this._xp};
  }

  /**
   * Adopt a saved progression.
   *
   * The level is clamped into `[1, MAX_LEVEL]` and the experience into
   * `[0, xpForNextLevel)`, so a truncated or hand-edited save degrades to a
   * legal state instead of producing a level-0 hero with a negative damage
   * bonus, or an xp value that levels the hero up on the next kill it earns.
   *
   * `null` is accepted as well as `undefined`: the input comes from
   * `JSON.parse`, where a `"progress": null` field is what a hand-edited save
   * most often holds, and reading through it would throw where the rest of this
   * method degrades.
   */
  restore(state?: Partial<HeroProgressSnapshot> | null): void {
    const saved = state ?? {};

    const level = Number(saved.level);
    this._level = Number.isFinite(level)
      ? Math.max(1, Math.min(HeroProgress.MAX_LEVEL, Math.floor(level)))
      : 1;

    const xp = Number(saved.xp);
    const need = this.xpForNextLevel;
    this._xp = Number.isFinite(xp) && need > 0
      ? Math.max(0, Math.min(need - 1, Math.floor(xp)))
      : 0;
  }
}
