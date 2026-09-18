/**
 * AbilityBook — cooldown timers for the hero's skills, and nothing else.
 *
 * The arena's basic attack has always had a cooldown, but it lives on
 * `Combatant` because every fighter shares it. Skills are the hero's alone and
 * they are what an ARPG is actually about: a short window of much larger effect,
 * bought with a wait. That wait is the only mechanic here — what a skill *does*
 * is `ArenaRun`'s business, because it needs the world to do it to.
 *
 * The split matters for one rule in particular. `use()` starts a cooldown and
 * asks no questions; it does not know whether the skill hit anything. `ArenaRun`
 * checks the world **first** and only then calls `use()`, so a cleave swung at
 * empty air or a dash with nowhere to go costs nothing. Burning a five-second
 * cooldown on a keypress that visibly did nothing is the kind of thing a player
 * reads as a bug, and putting the check in the caller is what lets this class
 * stay pure arithmetic and fully testable.
 */

export type AbilityId = 'cleave' | 'dash';

/** Cooldowns in seconds, keyed by ability. */
export type AbilityCooldowns = Record<AbilityId, number>;

/** A book's live timers, for a checkpoint. */
export interface AbilityBookSnapshot {
  /** Seconds left per ability. Missing keys are treated as ready. */
  remaining: Partial<Record<AbilityId, number>>;
}

export class AbilityBook {
  /**
   * The tuning.
   *
   * `cleave` is deliberately the shorter one: it is the damage skill, and a
   * hero who cannot use it more than once per wave would never feel it. `dash`
   * costs more because it answers the arena's real threat — the boss outreaches
   * the hero, so closing distance on demand is worth more than the damage is.
   */
  static readonly COOLDOWNS: AbilityCooldowns = { cleave: 3.5, dash: 5 };

  private readonly _cooldowns: AbilityCooldowns;
  private readonly _remaining: Record<AbilityId, number>;

  constructor(cooldowns: Partial<AbilityCooldowns> = {}) {
    this._cooldowns = {
      cleave: Math.max(0, cooldowns.cleave ?? AbilityBook.COOLDOWNS.cleave),
      dash: Math.max(0, cooldowns.dash ?? AbilityBook.COOLDOWNS.dash),
    };
    this._remaining = { cleave: 0, dash: 0 };
  }

  /** Every ability this book knows, in a stable order for a HUD to lay out. */
  get ids(): readonly AbilityId[] { return ['cleave', 'dash']; }

  /** The configured cooldown length. */
  cooldown(id: AbilityId): number { return this._cooldowns[id]; }

  /** Seconds until `id` is usable again; 0 when ready. */
  remaining(id: AbilityId): number { return this._remaining[id]; }

  ready(id: AbilityId): boolean { return this._remaining[id] <= 0; }

  /**
   * How much of the cooldown is still to run, in [0, 1] — 1 immediately after
   * use, 0 when ready. A HUD sweep wants this; a zero-length cooldown reports 0
   * rather than dividing by it.
   */
  fraction(id: AbilityId): number {
    const total = this._cooldowns[id];
    if (total <= 0) return 0;
    return Math.min(1, this._remaining[id] / total);
  }

  /**
   * Advance every timer. A non-finite or non-positive `dt` advances nothing —
   * the same rule `Combatant.tick` and the engine's time-accumulating modules
   * follow, so a first frame or a resumed tab cannot hand out a free cast.
   */
  tick(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const id of this.ids) {
      this._remaining[id] = Math.max(0, this._remaining[id] - dt);
    }
  }

  /**
   * Put `id` on cooldown.
   *
   * @returns false if it was not ready, in which case nothing changed.
   */
  use(id: AbilityId): boolean {
    if (!this.ready(id)) return false;
    this._remaining[id] = this._cooldowns[id];
    return true;
  }

  /** Clear every timer — a fresh run starts with everything available. */
  reset(): void {
    for (const id of this.ids) this._remaining[id] = 0;
  }

  snapshot(): AbilityBookSnapshot {
    return { remaining: { cleave: this._remaining.cleave, dash: this._remaining.dash } };
  }

  /**
   * Adopt saved timers.
   *
   * Values are clamped into `[0, cooldown]` and anything missing or non-finite
   * resets to ready, so a save written before this class existed — or a
   * hand-edited one — loads as "everything available" instead of poisoning a
   * timer with NaN, which would never count down.
   */
  restore(state: Partial<AbilityBookSnapshot> = {}): void {
    const saved = state.remaining ?? {};
    for (const id of this.ids) {
      const value = saved[id];
      this._remaining[id] = Number.isFinite(value)
        ? Math.max(0, Math.min(this._cooldowns[id], value as number))
        : 0;
    }
  }
}
