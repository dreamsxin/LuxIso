import type { Scene } from './Scene';
import { Floor } from '../elements/Floor';
import { Wall } from '../elements/Wall';
import { Character } from '../elements/Character';
import { Cloud } from '../elements/props/Cloud';
import { Crystal } from '../elements/props/Crystal';
import { Boulder } from '../elements/props/Boulder';
import { Chest } from '../elements/props/Chest';
import { Tree } from '../elements/props/Tree';
import { FlowerPatch } from '../elements/props/FlowerPatch';
import { Lantern } from '../elements/props/Lantern';
import { OmniLight } from '../lighting/OmniLight';
import { DirectionalLight } from '../lighting/DirectionalLight';
import type { BaseLight } from '../lighting/BaseLight';
import { HealthComponent } from '../ecs/components/HealthComponent';
import { FloatingText } from '../elements/props/FloatingText';
import { ParticleSystem } from '../animation/ParticleSystem';
import type { IsoObject } from '../elements/IsoObject';

/** Constructor of a scene object, abstract classes included. */
export type IsoObjectCtor = abstract new (...args: never[]) => IsoObject;

/**
 * Turns a custom scene object into a `props[]` entry.
 *
 * Return at least `{ type }` — the key the matching `Engine.registerProp()`
 * factory is registered under. `id`, `x` and `y` are filled in from the object
 * unless the entry overrides them, so the usual serializer is one line. Return
 * `null` to skip the object deliberately.
 */
export type PropSerializer<T extends IsoObject = IsoObject> =
  (object: T) => Record<string, unknown> | null | undefined;

/** Constructor of a light, abstract classes included. */
export type BaseLightCtor = abstract new (...args: never[]) => BaseLight;

/**
 * Turns a custom light into a `lights[]` entry.
 *
 * `type` defaults to the light's own `type` field — the same string
 * `Engine.registerLight()` is keyed by — and `id` / `enabled` are filled in from
 * the instance, so a serializer usually only lists its extra fields. Return
 * `null` to skip the light deliberately.
 */
export type LightSerializer<T extends BaseLight = BaseLight> =
  (light: T) => Record<string, unknown> | null | undefined;

/** Built-in object types `toJSON` already knows how to write. */
const BUILT_IN_TYPES: readonly IsoObjectCtor[] = [
  Floor, Wall, Character, Cloud, Crystal, Boulder, Chest, Tree, FlowerPatch, Lantern,
];

/** Built-ins that are runtime-only by design and must never be persisted. */
const TRANSIENT_TYPES: readonly IsoObjectCtor[] = [FloatingText, ParticleSystem];

/** Serializes the built-in scene schema consumed by Engine.buildScene(). */
export class SceneSerializer {
  /**
   * Custom prop serializers, in registration order.
   *
   * `Engine.registerProp()` has always let an application *load* its own object
   * types, but `toJSON` was a closed `instanceof` chain, so those objects were
   * **silently dropped on save** — a checkpoint written through `scene.toJSON()`
   * came back missing every custom entity, with no error. This is the save-side
   * half of the same gap `SceneExtractor`'s registry closed for WebGL rendering.
   */
  private static _serializers: Array<{
    ctor: IsoObjectCtor;
    serialize: PropSerializer<never>;
  }> = [];

  /**
   * Custom light serializers, in registration order.
   *
   * Same gap as `_serializers`, other collection: `toJSON` wrote only
   * `OmniLight` and `DirectionalLight`, so a light type loaded through
   * `Engine.registerLight()` disappeared on save.
   */
  private static _lightSerializers: Array<{
    ctor: BaseLightCtor;
    serialize: LightSerializer<never>;
  }> = [];

  /** Constructor names already reported as unserializable, to warn once each. */
  private static _reported = new Set<string>();

  /**
   * Register a serializer for a custom object type.
   *
   * Later registrations win, so a subclass can override its base without
   * unregistering first. Built-in types are matched before this registry, which
   * keeps their round-trip behaviour fixed — a serializer for a class deriving
   * from a built-in prop is therefore not consulted.
   *
   * @example
   *   Engine.registerProp('mob', (p) => new Mob(p.id, p.x, p.y, p.tier as number));
   *   SceneSerializer.register(Mob, (mob) => ({ type: 'mob', tier: mob.tier }));
   */
  static register<T extends IsoObject>(
    ctor: abstract new (...args: never[]) => T,
    serialize: PropSerializer<T>,
  ): void {
    SceneSerializer._serializers.push({
      ctor,
      serialize: serialize as PropSerializer<never>,
    });
  }

  /** Remove every serializer registered for `ctor`. Returns true if any went. */
  static unregister(ctor: IsoObjectCtor): boolean {
    const before = SceneSerializer._serializers.length;
    SceneSerializer._serializers = SceneSerializer._serializers.filter((e) => e.ctor !== ctor);
    return SceneSerializer._serializers.length !== before;
  }

  /** Drop all custom serializers, props and lights alike. Useful between tests. */
  static clearSerializers(): void {
    SceneSerializer._serializers = [];
    SceneSerializer._lightSerializers = [];
    SceneSerializer._reported.clear();
  }

  /**
   * Register a serializer for a custom light type.
   *
   * Mirrors `register()`: later registrations win, and the two built-ins
   * (`OmniLight`, `DirectionalLight`) are matched first.
   *
   * @example
   *   Engine.registerLight('aura', (j) => new AuraLight({ ...j }));
   *   SceneSerializer.registerLight(AuraLight, (l) => ({ radius: l.radius }));
   */
  static registerLight<T extends BaseLight>(
    ctor: abstract new (...args: never[]) => T,
    serialize: LightSerializer<T>,
  ): void {
    SceneSerializer._lightSerializers.push({
      ctor,
      serialize: serialize as LightSerializer<never>,
    });
  }

  /** Remove every light serializer registered for `ctor`. */
  static unregisterLight(ctor: BaseLightCtor): boolean {
    const before = SceneSerializer._lightSerializers.length;
    SceneSerializer._lightSerializers =
      SceneSerializer._lightSerializers.filter((e) => e.ctor !== ctor);
    return SceneSerializer._lightSerializers.length !== before;
  }

  /** The light serializer that would run for `light`, or null. */
  static findLightSerializer(light: BaseLight): LightSerializer<never> | null {
    for (let i = SceneSerializer._lightSerializers.length - 1; i >= 0; i--) {
      const entry = SceneSerializer._lightSerializers[i];
      if (light instanceof (entry.ctor as unknown as new () => BaseLight)) return entry.serialize;
    }
    return null;
  }

  /** The serializer that would run for `object`, or null. */
  static findSerializer(object: IsoObject): PropSerializer<never> | null {
    for (let i = SceneSerializer._serializers.length - 1; i >= 0; i--) {
      const entry = SceneSerializer._serializers[i];
      if (object instanceof (entry.ctor as unknown as new () => IsoObject)) return entry.serialize;
    }
    return null;
  }

  static toJSON(scene: Scene): Record<string, unknown> {
    const objects = scene.allObjects;
    const floors     = objects.filter((o): o is Floor     => o instanceof Floor);
    const walls      = objects.filter((o): o is Wall      => o instanceof Wall);
    const characters = objects.filter((o): o is Character => o instanceof Character);
    const clouds     = objects.filter((o): o is Cloud     => o instanceof Cloud);
    const crystals   = objects.filter((o): o is Crystal   => o instanceof Crystal);
    const boulders   = objects.filter((o): o is Boulder   => o instanceof Boulder);
    const chests     = objects.filter((o): o is Chest     => o instanceof Chest);
    const trees      = objects.filter((o): o is Tree      => o instanceof Tree);
    const flowers    = objects.filter((o): o is FlowerPatch => o instanceof FlowerPatch);
    const lanterns   = objects.filter((o): o is Lantern   => o instanceof Lantern);
    const omniLights = scene.allLights.filter((l): l is OmniLight => l instanceof OmniLight);
    const dirLights = scene.allLights.filter((l): l is DirectionalLight => l instanceof DirectionalLight);

    const floor = floors[0];
    const walkable = scene.collider
      ? Array.from({ length: scene.collider.rows }, (_, row) =>
          Array.from({ length: scene.collider!.cols }, (__, col) => scene.collider!.isWalkable(col, row)),
        )
      : undefined;

    return {
      name: scene.name,
      cols: scene.cols,
      rows: scene.rows,
      tileW: scene.tileW,
      tileH: scene.tileH,
      ambientColor: scene.ambientColor,
      ambientIntensity: scene.ambientIntensity,
      dynamicLighting: scene.dynamicLighting,
      view: { ...scene.view },
      camera: {
        x: scene.camera.x,
        y: scene.camera.y,
        zoom: scene.camera.zoom,
        lerpFactor: scene.camera.lerpFactor,
      },

      ...(floor ? {
        floor: {
          id: floor.id,
          cols: floor.cols,
          rows: floor.rows,
          color: floor.color,
          ...(floor.altColor ? { altColor: floor.altColor } : {}),
          ...(floor.tileImageUrl ? { tileImage: floor.tileImageUrl } : {}),
          ...(floor.altTileImageUrl ? { altTileImage: floor.altTileImageUrl } : {}),
          ...(walkable ? { walkable } : {}),
        },
      } : {}),

      walls: walls.map((wall) => ({
        id: wall.id,
        x: wall.position.x,
        y: wall.position.y,
        endX: wall.endX,
        endY: wall.endY,
        height: wall.wallHeight,
        color: wall.color,
        openings: wall.openings,
      })),

      lights: [
        ...omniLights.map((light) => ({
          type: 'omni' as const,
          ...(light.id ? { id: light.id } : {}),
          enabled: light.enabled,
          x: light.position.x,
          y: light.position.y,
          z: light.position.z,
          color: light.color,
          intensity: light.intensity,
          radius: light.radius,
          isGlobal: light.isGlobal,
          falloff: light.falloff,
        })),
        ...dirLights.map((light) => ({
          type: 'directional' as const,
          ...(light.id ? { id: light.id } : {}),
          enabled: light.enabled,
          angle: SceneSerializer._degrees(light.angle),
          elevation: SceneSerializer._degrees(light.elevation),
          color: light.color,
          intensity: light.intensity,
        })),
        ...SceneSerializer._customLights(scene.allLights),
      ],

      characters: characters.map((character) => ({
        id: character.id,
        x: character.position.x,
        y: character.position.y,
        z: character.position.z,
        radius: character.radius,
        color: character.color,
      })),

      clouds: clouds.map((cloud) => ({
        id: cloud.id,
        x: cloud.position.x,
        y: cloud.position.y,
        altitude: cloud.altitude,
        speed: cloud.speed,
        angle: cloud.angle,
        scale: cloud.scale,
        seed: cloud.seed,
      })),

      props: [
        ...crystals.map((prop) => ({
          type: 'crystal' as const,
          id: prop.id,
          x: prop.position.x,
          y: prop.position.y,
          color: prop.propColor,
          heightPx: prop.propHeightPx,
          ...SceneSerializer._health(prop),
        })),
        ...boulders.map((prop) => ({
          type: 'boulder' as const,
          id: prop.id,
          x: prop.position.x,
          y: prop.position.y,
          color: prop.propColor,
          radius: prop.propRadius,
          ...SceneSerializer._health(prop),
        })),
        ...chests.map((prop) => ({
          type: 'chest' as const,
          id: prop.id,
          x: prop.position.x,
          y: prop.position.y,
          color: prop.propColor,
          ...SceneSerializer._health(prop),
        })),
        ...trees.map((prop) => ({
          type: 'tree' as const,
          id: prop.id,
          x: prop.position.x,
          y: prop.position.y,
          color: prop.propCanopyColor,
          trunkColor: prop.propTrunkColor,
          heightPx: prop.propHeightPx,
          scale: prop.propScale,
        })),
        ...flowers.map((prop) => ({
          type: 'flowers' as const,
          id: prop.id,
          x: prop.position.x,
          y: prop.position.y,
          color: prop.propColor,
          accentColor: prop.propAccentColor,
          count: prop.propCount,
          seed: prop.propSeed,
        })),
        ...lanterns.map((prop) => ({
          type: 'lantern' as const,
          id: prop.id,
          x: prop.position.x,
          y: prop.position.y,
          color: prop.propGlowColor,
          postColor: prop.propPostColor,
          heightPx: prop.propHeightPx,
        })),
        ...SceneSerializer._customProps(objects),
      ],
    };
  }

  /** Entries for objects no built-in branch covers. */
  private static _customProps(
    objects: readonly IsoObject[],
  ): Array<Record<string, unknown>> {
    const entries: Array<Record<string, unknown>> = [];
    for (const object of objects) {
      if (BUILT_IN_TYPES.some((ctor) => SceneSerializer._isA(object, ctor))) continue;
      if (TRANSIENT_TYPES.some((ctor) => SceneSerializer._isA(object, ctor))) continue;
      const entry = SceneSerializer._runSerializer(object);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  private static _isA(object: IsoObject, ctor: IsoObjectCtor): boolean {
    return object instanceof (ctor as unknown as new () => IsoObject);
  }

  /** Entries for lights neither built-in branch covers. */
  private static _customLights(
    lights: readonly BaseLight[],
  ): Array<Record<string, unknown>> {
    const entries: Array<Record<string, unknown>> = [];
    for (const light of lights) {
      if (light instanceof OmniLight || light instanceof DirectionalLight) continue;
      const name = light.constructor?.name ?? 'anonymous';
      const serialize = SceneSerializer.findLightSerializer(light);
      if (!serialize) {
        SceneSerializer._reportOnce(
          name,
          `SceneSerializer: no serializer for light "${name}"; it will not be saved. ` +
          'Register one with SceneSerializer.registerLight().',
        );
        continue;
      }

      let entry: Record<string, unknown> | null | undefined;
      try {
        entry = (serialize as LightSerializer)(light);
      } catch (error) {
        SceneSerializer._reportOnce(
          name,
          `SceneSerializer: light serializer for "${name}" threw; skipping it. ${String(error)}`,
        );
        continue;
      }
      if (!entry) continue;

      // `type` defaults to the light's own discriminator, which is the key
      // `Engine.registerLight()` uses, and `color` / `intensity` / `enabled`
      // live on `BaseLight`, so they are written for every light exactly as the
      // built-in branches do. A serializer therefore only lists its extra
      // fields — leaving `color` to the author was a trap: the light came back
      // white with no hint why.
      const merged = {
        type: light.type,
        ...(light.id ? { id: light.id } : {}),
        enabled: light.enabled,
        color: light.color,
        intensity: light.intensity,
        ...entry,
      };
      if (typeof merged.type !== 'string' || merged.type === '') {
        SceneSerializer._reportOnce(
          name,
          `SceneSerializer: light "${name}" has no \`type\`; the entry could not be ` +
          'loaded back and was dropped.',
        );
        continue;
      }
      entries.push(merged);
    }
    return entries;
  }

  /**
   * Run a custom serializer, guarding the save against application code.
   *
   * A serializer that throws, or returns an entry without the `type` key its
   * `Engine.registerProp()` factory is keyed by, would otherwise take the whole
   * `toJSON()` down or write an entry that silently cannot be loaded back.
   */
  private static _runSerializer(object: IsoObject): Record<string, unknown> | null {
    const name = object.constructor?.name ?? 'anonymous';
    const serialize = SceneSerializer.findSerializer(object);
    if (!serialize) {
      SceneSerializer._reportOnce(
        name,
        `SceneSerializer: no serializer for "${name}"; it will not be saved. ` +
        'Register one with SceneSerializer.register().',
      );
      return null;
    }

    let entry: Record<string, unknown> | null | undefined;
    try {
      entry = (serialize as PropSerializer)(object);
    } catch (error) {
      SceneSerializer._reportOnce(
        name,
        `SceneSerializer: serializer for "${name}" threw; skipping the object. ${String(error)}`,
      );
      return null;
    }
    if (!entry) return null;

    if (typeof entry.type !== 'string' || entry.type === '') {
      SceneSerializer._reportOnce(
        name,
        `SceneSerializer: serializer for "${name}" returned no \`type\`; the entry ` +
        'could not be loaded back and was dropped.',
      );
      return null;
    }

    // Defaults the factory contract needs, overridable by the serializer.
    return {
      id: object.id,
      x: object.position.x,
      y: object.position.y,
      ...entry,
    };
  }

  private static _reportOnce(key: string, message: string): void {
    if (SceneSerializer._reported.has(key)) return;
    SceneSerializer._reported.add(key);
    console.warn(message);
  }

  private static _health(entity: Crystal | Boulder | Chest): { health?: number } {
    const health = entity.getComponent(HealthComponent);
    return health ? { health: health.maxHp } : {};
  }

  private static _degrees(radians: number): number {
    return Math.round((radians * 180 / Math.PI) * 1_000_000) / 1_000_000;
  }
}
