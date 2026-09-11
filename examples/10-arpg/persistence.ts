/**
 * Save/load for `Combatant`, registered on both sides of the round trip.
 *
 * The framework keeps the two directions in separate registries —
 * `SceneSerializer.register` writes, `Engine.registerProp` reads — and
 * registering only one is a silent half-round-trip: a checkpoint that loses every
 * fighter, or a scene file the loader skips with a console warning. They are
 * registered together here so neither can be forgotten.
 *
 * `health` is the maximum and `hp` the current, which is the schema the loader
 * already understands; `hp` is written only for a damaged unit so an untouched
 * save keeps its shape.
 */
import { Engine, SceneSerializer } from '../../src/index';
import type { TileCollider } from '../../src/index';
import { Combatant } from './Combatant';

/** The `type` discriminator written into scene JSON. */
export const COMBATANT_TYPE = 'combatant';

export interface CombatantPersistenceOptions {
  /** Collider handed to every restored fighter, since JSON cannot carry one. */
  collider?: TileCollider | null;
}

function number(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function registerCombatantPersistence(opts: CombatantPersistenceOptions = {}): void {
  SceneSerializer.register(Combatant, (unit) => ({
    type: COMBATANT_TYPE,
    faction: unit.faction,
    health: unit.health.maxHp,
    ...(unit.health.hp < unit.health.maxHp ? { hp: unit.health.hp } : {}),
    damage: unit.damage,
    attackRange: unit.attackRange,
    attackInterval: unit.attackInterval,
    speed: unit.movement.speed,
    radius: unit.radius,
    color: unit.color,
  }));

  Engine.registerProp(COMBATANT_TYPE, (json) => new Combatant(
    String(json.id),
    number(json.x, 0),
    number(json.y, 0),
    {
      faction: json.faction === 'hero' ? 'hero' : 'enemy',
      hp: number(json.health, 40),
      damage: number(json.damage, 6),
      attackRange: number(json.attackRange, 0.9),
      attackInterval: number(json.attackInterval, 1),
      speed: number(json.speed, 2.4),
      radius: number(json.radius, 14),
      color: typeof json.color === 'string' ? json.color : undefined,
      collider: opts.collider ?? null,
    },
  ));
}

/** Drop both registrations. Intended for tests. */
export function unregisterCombatantPersistence(): void {
  SceneSerializer.unregister(Combatant);
  Engine.unregisterProp(COMBATANT_TYPE);
}
