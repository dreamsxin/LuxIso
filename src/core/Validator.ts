import type { Component, ComponentCtor } from '../ecs/Component';

/**
 * Validator — lightweight runtime validation for scene JSON and ECS lookups.
 *
 * All methods return a `ValidationResult` with `ok`, `errors`, and `warnings`.
 * Errors are structural problems that will cause runtime failures.
 * Warnings are non-fatal issues that may produce unexpected behaviour.
 *
 * Nothing in the engine calls `validateSceneJson` — `Engine.buildScene()` loads
 * whatever it is given and warns about unknown types as it goes. This is a tool
 * for editors, asset pipelines and CI checks on hand-authored level files; run it
 * yourself before shipping one.
 */

export interface ValidationResult {
  ok: boolean;
  errors:   string[];
  warnings: string[];
}

function result(errors: string[], warnings: string[]): ValidationResult {
  return { ok: errors.length === 0, errors, warnings };
}

// ── Scene JSON validation ─────────────────────────────────────────────────────

export interface SceneJsonLike {
  name?: unknown;
  cols?: unknown; rows?: unknown;
  tileW?: unknown; tileH?: unknown;
  floor?: {
    id?: unknown; cols?: unknown; rows?: unknown;
    walkable?: unknown;
  };
  walls?: unknown[];
  lights?: unknown[];
  characters?: unknown[];
  props?: unknown[];
}

export interface SceneValidationOptions {
  /**
   * Light registry keys accepted in addition to the built-ins.
   *
   * Supplying either list switches unknown types from a warning to an error:
   * the caller has declared the full set, so anything outside it is wrong.
   * Without a list the validator cannot know what the application registered
   * through `Engine.registerLight()` / `registerProp()`, and calling a custom
   * type invalid would be a false negative.
   */
  lightTypes?: Iterable<string>;
  /** Prop registry keys accepted in addition to the built-ins. */
  propTypes?: Iterable<string>;
}

export function validateSceneJson(
  json: unknown,
  options: SceneValidationOptions = {},
): ValidationResult {
  const errors: string[]   = [];
  const warnings: string[] = [];
  const lightTypes = new Set(['omni', 'directional']);
  // Must mirror the built-in keys seeded into Engine._propRegistry at the bottom
  // of Engine.ts. `tree`, `flowers` and `lantern` were missing here, so scenes
  // using those perfectly valid props were reported as invalid.
  const propTypes = new Set(['crystal', 'boulder', 'chest', 'tree', 'flowers', 'lantern']);
  const declaredTypes = options.lightTypes !== undefined || options.propTypes !== undefined;
  for (const type of options.lightTypes ?? []) lightTypes.add(type);
  for (const type of options.propTypes ?? []) propTypes.add(type);
  /** Every id seen, to catch the duplicates that break removeById/getById. */
  const seenIds = new Map<string, string>();

  const noteId = (id: unknown, where: string): void => {
    if (typeof id !== 'string' || id === '') return;
    const first = seenIds.get(id);
    if (first !== undefined) {
      // `Scene.removeById` filters *every* match and `getById` returns the
      // first, so a duplicate id means one object cannot be addressed and the
      // other disappears with it.
      errors.push(`Duplicate id "${id}" used by ${first} and ${where}`);
      return;
    }
    seenIds.set(id, where);
  };

  /** Unknown type: fatal only when the caller declared the accepted set. */
  const noteUnknownType = (message: string): void => {
    if (declaredTypes) errors.push(message);
    else warnings.push(message);
  };

  if (typeof json !== 'object' || json === null) {
    return result(['Scene JSON must be a non-null object'], []);
  }

  const s = json as SceneJsonLike;

  // Dimensions
  const cols = Number(s.cols ?? 10);
  const rows = Number(s.rows ?? 10);
  if (!Number.isInteger(cols) || cols < 1 || cols > 128) errors.push(`cols must be an integer 1–128, got ${s.cols}`);
  if (!Number.isInteger(rows) || rows < 1 || rows > 128) errors.push(`rows must be an integer 1–128, got ${s.rows}`);

  const tileW = Number(s.tileW ?? 64);
  const tileH = Number(s.tileH ?? 32);
  if (tileW <= 0) errors.push(`tileW must be > 0, got ${s.tileW}`);
  if (tileH <= 0) errors.push(`tileH must be > 0, got ${s.tileH}`);
  if (tileW !== tileH * 2) warnings.push(`Standard iso ratio is tileW = 2 × tileH (got ${tileW} × ${tileH})`);

  // Floor
  if (s.floor !== undefined) {
    if (typeof s.floor !== 'object' || s.floor === null) {
      errors.push('floor must be an object');
    } else {
      if (!s.floor.id) errors.push('floor.id is required');
      else noteId(s.floor.id, 'floor');
      if (s.floor.walkable !== undefined) {
        if (!Array.isArray(s.floor.walkable)) {
          errors.push('floor.walkable must be an array');
        } else if (Array.isArray(s.floor.walkable[0])) {
          // 2D array
          const grid = s.floor.walkable as unknown[][];
          if (grid.length !== rows) warnings.push(`floor.walkable has ${grid.length} rows, expected ${rows}`);
          for (let r = 0; r < grid.length; r++) {
            if (!Array.isArray(grid[r])) { errors.push(`floor.walkable[${r}] must be an array`); break; }
            if ((grid[r] as unknown[]).length !== cols) warnings.push(`floor.walkable[${r}] has ${(grid[r] as unknown[]).length} cols, expected ${cols}`);
          }
        } else {
          // Flat array
          const flat = s.floor.walkable as unknown[];
          if (flat.length !== cols * rows) warnings.push(`floor.walkable flat array length ${flat.length} ≠ cols×rows (${cols * rows})`);
        }
      }
    }
  }

  // Walls
  if (s.walls !== undefined) {
    if (!Array.isArray(s.walls)) {
      errors.push('walls must be an array');
    } else {
      s.walls.forEach((w, i) => {
        const wall = w as Record<string, unknown>;
        if (!wall.id) errors.push(`walls[${i}].id is required`);
        else noteId(wall.id, `walls[${i}]`);
        let numeric = true;
        for (const k of ['x', 'y', 'endX', 'endY']) {
          if (typeof wall[k] !== 'number') { errors.push(`walls[${i}].${k} must be a number`); numeric = false; }
        }
        // Only meaningful once the coordinates are numbers: with all four
        // missing, `undefined === undefined` reported every such wall as
        // zero-length on top of the four errors it already had.
        if (numeric && wall.x === wall.endX && wall.y === wall.endY) {
          warnings.push(`walls[${i}] has zero length`);
        }
      });
    }
  }

  // Lights
  if (s.lights !== undefined) {
    if (!Array.isArray(s.lights)) {
      errors.push('lights must be an array');
    } else {
      s.lights.forEach((l, i) => {
        const light = l as Record<string, unknown>;
        if (typeof light.type !== 'string') {
          errors.push(`lights[${i}].type must be a string, got '${light.type}'`);
        } else if (!lightTypes.has(light.type)) {
          noteUnknownType(
            `lights[${i}].type '${light.type}' is not one of ${[...lightTypes].join(', ')}; ` +
            'register it with Engine.registerLight() or pass it in options.lightTypes',
          );
        }
        if (light.id !== undefined) noteId(light.id, `lights[${i}]`);
        if (light.type === 'omni') {
          for (const k of ['x', 'y', 'z']) {
            if (typeof light[k] !== 'number') errors.push(`lights[${i}].${k} must be a number`);
          }
          if (typeof light.intensity === 'number' && (light.intensity < 0 || light.intensity > 10)) {
            warnings.push(`lights[${i}].intensity ${light.intensity} is outside typical range 0–10`);
          }
        }
        if (light.type === 'directional') {
          // Only omni was checked, so a directional light with a string angle
          // validated clean and then produced NaN transforms at runtime.
          for (const k of ['angle', 'elevation']) {
            if (light[k] !== undefined && typeof light[k] !== 'number') {
              errors.push(`lights[${i}].${k} must be a number when present`);
            }
          }
        }
      });
    }
  }

  // Characters
  if (s.characters !== undefined) {
    if (!Array.isArray(s.characters)) {
      errors.push('characters must be an array');
    } else {
      s.characters.forEach((c, i) => {
        const ch = c as Record<string, unknown>;
        if (!ch.id) errors.push(`characters[${i}].id is required`);
        else noteId(ch.id, `characters[${i}]`);
        for (const k of ['x', 'y']) {
          if (typeof ch[k] !== 'number') errors.push(`characters[${i}].${k} must be a number`);
        }
        const x = Number(ch.x), y = Number(ch.y);
        if (x < 0 || x > cols || y < 0 || y > rows) {
          warnings.push(`characters[${i}] position (${x}, ${y}) is outside scene bounds (${cols}×${rows})`);
        }
      });
    }
  }

  // Props
  if (s.props !== undefined) {
    if (!Array.isArray(s.props)) {
      errors.push('props must be an array');
    } else {
      s.props.forEach((p, i) => {
        const prop = p as Record<string, unknown>;
        if (!prop.id) errors.push(`props[${i}].id is required`);
        else noteId(prop.id, `props[${i}]`);
        if (typeof prop.x !== 'number') errors.push(`props[${i}].x must be a number`);
        if (typeof prop.y !== 'number') errors.push(`props[${i}].y must be a number`);
        if (typeof prop.type !== 'string') {
          errors.push(`props[${i}].type must be a string`);
        } else if (!propTypes.has(prop.type)) {
          noteUnknownType(
            `props[${i}].type '${prop.type}' is not one of ${[...propTypes].join(', ')}; ` +
            'register it with Engine.registerProp() or pass it in options.propTypes',
          );
        }
        // `Engine.buildScene` feeds this straight into `new HealthComponent({ max })`,
        // where a string or a zero produces an entity that is dead on arrival.
        if (prop.health !== undefined && (typeof prop.health !== 'number' || !(prop.health > 0))) {
          errors.push(`props[${i}].health must be a number > 0 when present, got ${prop.health}`);
        }
      });
    }
  }

  return result(errors, warnings);
}

// ── Component type-safe lookup ────────────────────────────────────────────────

interface ComponentLookup {
  id: string;
  getComponent<T extends Component>(ctor: ComponentCtor<T>): T | undefined;
  hasComponent(ctor: ComponentCtor): boolean;
}

function componentName(ctor: ComponentCtor): string {
  return (ctor as { name?: string }).name ?? 'UnknownComponent';
}

/**
 * Type-safe component lookup with a helpful error message on miss.
 * Returns the component or throws if not found and `required` is true.
 */
export function requireComponent<T extends Component>(
  entity: ComponentLookup,
  ctor: ComponentCtor<T>,
): T;
export function requireComponent<T extends Component>(
  entity: ComponentLookup,
  ctor: ComponentCtor<T>,
  required: true,
): T;
export function requireComponent<T extends Component>(
  entity: ComponentLookup,
  ctor: ComponentCtor<T>,
  required: false,
): T | undefined;
export function requireComponent<T extends Component>(
  entity: ComponentLookup,
  ctor: ComponentCtor<T>,
  required = true,
): T | undefined {
  const comp = entity.getComponent(ctor);
  if (!comp && required) {
    const name = componentName(ctor);
    throw new Error(
      `Entity "${entity.id}" is missing required component "${name}". ` +
      `Did you forget to call entity.addComponent(new ...Component(...))?`,
    );
  }
  return comp;
}

/**
 * Validate that an entity has all required component types.
 * Returns a ValidationResult listing any missing components.
 */
export function validateComponents(
  entity: ComponentLookup,
  required: readonly ComponentCtor[],
): ValidationResult {
  const errors = required
    .filter(ctor => !entity.hasComponent(ctor))
    .map(ctor => `Entity "${entity.id}" is missing component "${componentName(ctor)}"`);
  return result(errors, []);
}
