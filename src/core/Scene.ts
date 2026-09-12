import { IsoObject } from '../elements/IsoObject';
import { BaseLight } from '../lighting/BaseLight';
import { OmniLight } from '../lighting/OmniLight';
import { DirectionalLight } from '../lighting/DirectionalLight';
import { Camera } from './Camera';
import { Entity } from '../ecs/Entity';
import { FrameClock } from '../time/FrameClock';
import { System } from '../ecs/System';
import { FloatingText, FloatingTextOptions } from '../elements/props/FloatingText';
import { DEFAULT_ISO_VIEW } from '../math/IsoProjection';
import type { IsoView } from '../math/IsoProjection';
import { TileCollider } from '../physics/TileCollider';
import { SceneRenderer } from './SceneRenderer';
import { SceneSerializer } from './SceneSerializer';

export interface SceneOptions {
  name?: string;
  tileW?: number;
  tileH?: number;
  cols?: number;
  rows?: number;
}

/** Container and lifecycle coordinator for objects, lights, camera, and Systems. */
export class Scene {
  name: string;
  readonly camera: Camera;
  collider: TileCollider | null = null;
  readonly tileW: number;
  readonly tileH: number;
  readonly cols: number;
  readonly rows: number;
  ambientColor = '#ffffff';
  ambientIntensity = 0.15;
  dynamicLighting = false;
  view: IsoView = { ...DEFAULT_ISO_VIEW };

  private objects: IsoObject[] = [];
  private lights: BaseLight[] = [];
  private _systems: System[] = [];
  private _systemMatches: Entity[][] = [];
  private _renderer = new SceneRenderer();
  private _clock = new FrameClock();

  private _viewFrom: IsoView | null = null;
  private _viewTo: IsoView | null = null;
  private _viewT = 0;
  private _viewDur = 0;

  constructor(opts: SceneOptions = {}) {
    this.name = opts.name ?? 'Untitled Scene';
    this.tileW = opts.tileW ?? 64;
    this.tileH = opts.tileH ?? 32;
    this.cols = opts.cols ?? 10;
    this.rows = opts.rows ?? 10;
    this.camera = new Camera();
  }

  addObject(obj: IsoObject): void {
    this.objects.push(obj);
    this._renderer.invalidateObjects();
  }

  removeById(id: string): void {
    const objectCount = this.objects.length;
    const lightCount = this.lights.length;
    this.objects = this.objects.filter((object) => object.id !== id);
    this.lights = this.lights.filter((light) => light.id !== id);
    if (this.objects.length !== objectCount) this._renderer.invalidateObjects();
    if (this.lights.length !== lightCount) this._renderer.invalidateLightmap();
  }

  getById(id: string): IsoObject | undefined {
    return this.objects.find((object) => object.id === id);
  }

  getAll<T extends IsoObject>(ctor: new (...args: any[]) => T): T[] {
    return this.objects.filter((object): object is T => object instanceof ctor);
  }

  get allObjects(): readonly IsoObject[] {
    return this.objects;
  }

  spawnFloatingText(opts: Omit<FloatingTextOptions, 'id'>): FloatingText {
    const id = `ft-${Math.random().toString(36).substring(2, 11)}`;
    const text = new FloatingText({ id, ...opts });
    this.addObject(text);
    return text;
  }

  addLight(light: BaseLight): void {
    this.lights.push(light);
    this._renderer.invalidateLightmap();
  }

  get omniLights(): OmniLight[] {
    return this.lights.filter(
      (light): light is OmniLight => light instanceof OmniLight && light.enabled,
    );
  }

  get dirLights(): DirectionalLight[] {
    return this.lights.filter(
      (light): light is DirectionalLight => light instanceof DirectionalLight && light.enabled,
    );
  }

  get allLights(): readonly BaseLight[] {
    return this.lights;
  }

  /** Current visible objects in resolved back-to-front draw order. */
  get sortedObjects(): readonly IsoObject[] {
    return this._renderer.sortedObjects;
  }

  getLightById(id: string): BaseLight | undefined {
    return this.lights.find((light) => light.id === id);
  }

  addSystem<T extends System>(system: T): T {
    if (this._systems.includes(system)) return system;
    system.attach(this);
    let index = this._systems.length;
    while (index > 0 && this._systems[index - 1].priority > system.priority) index--;
    this._systems.splice(index, 0, system);
    this._systemMatches.splice(index, 0, []);
    return system;
  }

  removeSystem(systemOrCtor: System | (abstract new (...args: any[]) => System)): boolean {
    const index = typeof systemOrCtor === 'function'
      ? this._systems.findIndex((system) => system instanceof systemOrCtor)
      : this._systems.indexOf(systemOrCtor);
    if (index < 0) return false;
    const system = this._systems[index];
    this._systems.splice(index, 1);
    this._systemMatches.splice(index, 1);
    system.detach(this);
    return true;
  }

  getSystem<T extends System>(ctor: abstract new (...args: any[]) => T): T | undefined {
    return this._systems.find((system): system is T => system instanceof ctor);
  }

  get systems(): readonly System[] {
    return this._systems;
  }

  transitionView(to: Partial<IsoView>, duration = 0.6): void {
    const target: IsoView = {
      rotation: to.rotation ?? this.view.rotation,
      elevation: to.elevation ?? this.view.elevation,
    };
    if (duration <= 0) {
      this.view = target;
      this._viewFrom = null;
      this._viewTo = null;
      this._renderer.invalidateLightmap();
      return;
    }
    this._viewFrom = { ...this.view };
    this._viewTo = target;
    this._viewT = 0;
    this._viewDur = duration;
    this._renderer.invalidateLightmap();
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    // dt 0 on the first call, matching Engine. The clock's `null` baseline is why
    // that works: the previous `_lastTs === 0` sentinel collided with a legitimate
    // timestamp of 0 — `update(0)` left it armed, so the *second* frame also got
    // the invented 1/60 instead of its real delta, shifting every view transition
    // and system by a frame.
    const dt = this._clock.sample(now);

    if (this._viewFrom && this._viewTo) {
      this._viewT = Math.min(1, this._viewT + dt / this._viewDur);
      const t = this._viewT < 0.5
        ? 2 * this._viewT * this._viewT
        : 1 - Math.pow(-2 * this._viewT + 2, 2) / 2;
      this.view = {
        rotation: this._viewFrom.rotation + (this._viewTo.rotation - this._viewFrom.rotation) * t,
        elevation: this._viewFrom.elevation + (this._viewTo.elevation - this._viewFrom.elevation) * t,
      };
      if (this._viewT >= 1) {
        this.view = { ...this._viewTo };
        this._viewFrom = null;
        this._viewTo = null;
      }
      this._renderer.invalidateLightmap();
    }

    this.camera.update(dt);
    if (this._systems.length > 0) {
      this._refreshSystemMatches();
      for (let i = 0; i < this._systems.length; i++) {
        this._systems[i].update(this._systemMatches[i], dt);
      }
    }
    for (const object of this.objects) {
      if (!object.visible) continue;
      const updatable = object as unknown as {
        update?: (timestamp?: number, collider?: TileCollider | null) => void;
      };
      updatable.update?.(ts, this.collider);
    }
    this._removeExpiredFloatingText();
  }

  fixedUpdate(dt: number): void {
    if (this._systems.length > 0) {
      this._refreshSystemMatches();
      for (let i = 0; i < this._systems.length; i++) {
        this._systems[i].fixedUpdate?.(this._systemMatches[i], dt);
      }
    }
    for (const object of this.objects) {
      if (object.visible && object instanceof Entity) object.fixedUpdate(dt);
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    originX: number,
    originY: number,
  ): void {
    this._renderer.draw(this, ctx, canvasW, canvasH, originX, originY);
  }

  toJSON(): Record<string, unknown> {
    return SceneSerializer.toJSON(this);
  }

  private _refreshSystemMatches(): void {
    for (const matches of this._systemMatches) matches.length = 0;
    for (const object of this.objects) {
      if (!(object instanceof Entity) || !object.visible) continue;
      for (let i = 0; i < this._systems.length; i++) {
        if (this._systems[i].matches(object)) this._systemMatches[i].push(object);
      }
    }
  }

  private _removeExpiredFloatingText(): void {
    let write = 0;
    let removed = false;
    for (let i = 0; i < this.objects.length; i++) {
      const object = this.objects[i];
      if (object instanceof FloatingText && object.isExpired) {
        removed = true;
      } else {
        this.objects[write++] = object;
      }
    }
    if (removed) {
      this.objects.length = write;
      this._renderer.invalidateObjects();
    }
  }
}
