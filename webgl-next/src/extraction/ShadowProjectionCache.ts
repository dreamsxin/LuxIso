import type {IsoObject} from '../../../src/elements/IsoObject';
import type {DirectionalLight} from '../../../src/lighting/DirectionalLight';
import type {OmniLight} from '../../../src/lighting/OmniLight';
import type {AABB} from '../../../src/math/depthSort';
import {
  projectDirectionalShadow,
  projectOmniShadow,
  type ProjectedShadow,
} from './ShadowProjector';

export interface ShadowCacheStats {
  readonly hits: number;
  readonly misses: number;
}

interface MutableShadowCacheStats {
  hits: number;
  misses: number;
}

interface ObjectState {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  baseZ: number;
  maxZ: number | undefined;
  positionX: number;
  positionY: number;
  positionZ: number;
  shadowRadius: number | undefined;
  tileW: number;
  tileH: number;
}

interface OmniState {
  x: number;
  y: number;
  z: number;
  radius: number;
  intensity: number;
  enabled: boolean;
  global: boolean;
  quadratic: boolean;
}

interface DirectionalState {
  angle: number;
  elevation: number;
  intensity: number;
  enabled: boolean;
}

interface CacheEntry<TLightState> {
  readonly object: ObjectState;
  readonly light: TLightState;
  readonly shadow: ProjectedShadow | null;
}

/**
 * Reuses analytic shadow projections until their caster or light inputs change.
 * Weak keys let removed scene objects and lights leave the cache without cleanup.
 */
export class ShadowProjectionCache {
  private _omni = new WeakMap<IsoObject, WeakMap<OmniLight, CacheEntry<OmniState>>>();
  private _directional = new WeakMap<IsoObject, WeakMap<DirectionalLight, CacheEntry<DirectionalState>>>();
  private readonly _stats: MutableShadowCacheStats = {hits: 0, misses: 0};

  get stats(): ShadowCacheStats {
    return this._stats;
  }

  /** Reset per-frame counters while retaining cached projection geometry. */
  beginFrame(): void {
    this._stats.hits = 0;
    this._stats.misses = 0;
  }

  clear(): void {
    this._omni = new WeakMap();
    this._directional = new WeakMap();
    this.beginFrame();
  }

  projectOmni(
    object: IsoObject,
    light: OmniLight,
    tileW: number,
    tileH: number
  ): ProjectedShadow | null {
    const bounds = object.aabb;
    let lightEntries = this._omni.get(object);
    const cached = lightEntries?.get(light);
    if (
      cached &&
      sameObject(cached.object, object, bounds, tileW, tileH) &&
      sameOmni(cached.light, light)
    ) {
      this._stats.hits++;
      return cached.shadow;
    }

    const shadow = projectOmniShadow(object, light, tileW, tileH);
    lightEntries ??= new WeakMap();
    lightEntries.set(light, {
      object: captureObject(object, bounds, tileW, tileH),
      light: captureOmni(light),
      shadow,
    });
    this._omni.set(object, lightEntries);
    this._stats.misses++;
    return shadow;
  }

  projectDirectional(
    object: IsoObject,
    light: DirectionalLight,
    tileW: number,
    tileH: number
  ): ProjectedShadow | null {
    const bounds = object.aabb;
    let lightEntries = this._directional.get(object);
    const cached = lightEntries?.get(light);
    if (
      cached &&
      sameObject(cached.object, object, bounds, tileW, tileH) &&
      sameDirectional(cached.light, light)
    ) {
      this._stats.hits++;
      return cached.shadow;
    }

    const shadow = projectDirectionalShadow(object, light, tileW, tileH);
    lightEntries ??= new WeakMap();
    lightEntries.set(light, {
      object: captureObject(object, bounds, tileW, tileH),
      light: captureDirectional(light),
      shadow,
    });
    this._directional.set(object, lightEntries);
    this._stats.misses++;
    return shadow;
  }
}

function captureObject(
  object: IsoObject,
  bounds: AABB,
  tileW: number,
  tileH: number
): ObjectState {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    baseZ: bounds.baseZ,
    maxZ: bounds.maxZ,
    positionX: object.position.x,
    positionY: object.position.y,
    positionZ: object.position.z,
    shadowRadius: object.shadowRadius,
    tileW,
    tileH,
  };
}

function sameObject(
  state: ObjectState,
  object: IsoObject,
  bounds: AABB,
  tileW: number,
  tileH: number
): boolean {
  return state.minX === bounds.minX &&
    state.minY === bounds.minY &&
    state.maxX === bounds.maxX &&
    state.maxY === bounds.maxY &&
    state.baseZ === bounds.baseZ &&
    state.maxZ === bounds.maxZ &&
    state.positionX === object.position.x &&
    state.positionY === object.position.y &&
    state.positionZ === object.position.z &&
    state.shadowRadius === object.shadowRadius &&
    state.tileW === tileW &&
    state.tileH === tileH;
}

function captureOmni(light: OmniLight): OmniState {
  return {
    x: light.position.x,
    y: light.position.y,
    z: light.position.z,
    radius: light.radius,
    intensity: light.intensity,
    enabled: light.enabled,
    global: light.isGlobal,
    quadratic: light.falloff === 'quadratic',
  };
}

function sameOmni(state: OmniState, light: OmniLight): boolean {
  return state.x === light.position.x &&
    state.y === light.position.y &&
    state.z === light.position.z &&
    state.radius === light.radius &&
    state.intensity === light.intensity &&
    state.enabled === light.enabled &&
    state.global === light.isGlobal &&
    state.quadratic === (light.falloff === 'quadratic');
}

function captureDirectional(light: DirectionalLight): DirectionalState {
  return {
    angle: light.angle,
    elevation: light.elevation,
    intensity: light.intensity,
    enabled: light.enabled,
  };
}

function sameDirectional(state: DirectionalState, light: DirectionalLight): boolean {
  return state.angle === light.angle &&
    state.elevation === light.elevation &&
    state.intensity === light.intensity &&
    state.enabled === light.enabled;
}
