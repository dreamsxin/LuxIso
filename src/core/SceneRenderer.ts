import type {Scene} from './Scene';
import {LightmapCache} from './LightmapCache';
import {Floor} from '../elements/Floor';
import type {IsoObject, DrawContext} from '../elements/IsoObject';
import {OmniLight} from '../lighting/OmniLight';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {ShadowCaster} from '../lighting/ShadowCaster';
import {project} from '../math/IsoProjection';
import {topoSort} from '../math/depthSort';
import {hexToRgb, hexToRgba} from '../math/color';

/** Owns Scene's culling, sorting, shadow, and lightmap rendering state. */
export class SceneRenderer {
  private _lightmapCache: LightmapCache | null = null;
  private _cacheWidth = 0;
  private _cacheHeight = 0;
  private _sortedCache: IsoObject[] = [];
  private _sortDirty = true;
  private _sortHash = 0;
  private _shadowHash = 0;
  private _floorSnapshot = '';
  private _floorBuf: Floor[] = [];
  private _groundBuf: IsoObject[] = [];
  private _cullBuf: IsoObject[] = [];
  private _shadowBuf: IsoObject[] = [];
  private _omniBuf: OmniLight[] = [];
  private _dirBuf: DirectionalLight[] = [];
  private _objectIds = new WeakMap<IsoObject, number>();
  private _nextObjectId = 1;

  invalidateObjects(): void {
    this._sortDirty = true;
    this._lightmapCache?.invalidate();
  }

  invalidateLightmap(): void {
    this._lightmapCache?.invalidate();
  }

  get sortedObjects(): readonly IsoObject[] {
    return this._sortedCache;
  }

  draw(
    scene: Scene,
    ctx: CanvasRenderingContext2D,
    canvasW: number,
    canvasH: number,
    originX: number,
    originY: number
  ): void {
    const cache = this._ensureLightmap(canvasW, canvasH);
    cache.alwaysDirty = scene.dynamicLighting;
    this._partition(scene);

    const floorSnapshot = this._computeFloorSnapshot(scene.allObjects);
    if (floorSnapshot !== this._floorSnapshot) {
      this._floorSnapshot = floorSnapshot;
      cache.invalidate();
    }

    const [ar, ag, ab] = hexToRgb(scene.ambientColor);
    const intensity = Math.max(0, Math.min(1, scene.ambientIntensity));
    const ambientRgb: [number, number, number] = [
      (ar / 255) * intensity,
      (ag / 255) * intensity,
      (ab / 255) * intensity,
    ];

    const shadowHash = this._computeObjectHash(this._shadowBuf);
    if (shadowHash !== this._shadowHash) {
      this._shadowHash = shadowHash;
      cache.invalidate();
    }

    if (cache.isDirty(
      this._omniBuf,
      this._dirBuf,
      scene.camera.x,
      scene.camera.y,
      scene.camera.zoom,
      ambientRgb,
      scene.view
    )) {
      this._bakeLightmap(scene, cache, originX, originY, ambientRgb);
    }
    cache.blit(ctx);

    scene.camera.applyTransform(
      ctx, canvasW, canvasH, scene.tileW, scene.tileH, originX, originY, scene.view
    );
    const drawContext: DrawContext = {
      ctx,
      tileW: scene.tileW,
      tileH: scene.tileH,
      originX: 0,
      originY: 0,
      omniLights: this._omniBuf,
      dirLights: this._dirBuf,
      ambientRgb,
      view: scene.view,
    };

    for (const object of this._groundBuf) {object.draw(drawContext);}

    this._frustumCull(scene, this._cullBuf, canvasW, canvasH);
    const hash = (this._computeObjectHash(this._cullBuf) * 31 + this._cullBuf.length) | 0;
    if (this._sortDirty || hash !== this._sortHash) {
      this._sortedCache = topoSort(this._cullBuf);
      this._sortHash = hash;
      this._sortDirty = false;
    }
    for (const object of this._sortedCache) {object.draw(drawContext);}

    this._drawLightHalos(scene, ctx);
    scene.camera.restoreTransform(ctx);
  }

  private _ensureLightmap(width: number, height: number): LightmapCache {
    if (!this._lightmapCache) {
      this._lightmapCache = new LightmapCache(width, height);
      this._cacheWidth = width;
      this._cacheHeight = height;
    } else if (width !== this._cacheWidth || height !== this._cacheHeight) {
      this._lightmapCache.resize(width, height);
      this._cacheWidth = width;
      this._cacheHeight = height;
    }
    return this._lightmapCache;
  }

  private _partition(scene: Scene): void {
    this._floorBuf.length = 0;
    this._groundBuf.length = 0;
    this._cullBuf.length = 0;
    this._shadowBuf.length = 0;
    this._omniBuf.length = 0;
    this._dirBuf.length = 0;

    for (const object of scene.allObjects) {
      if (object instanceof Floor) {
        if (object.visible) {this._floorBuf.push(object);}
      }
      else if (object.isGroundLayer && object.visible) {this._groundBuf.push(object);}
      else if (object.visible) {
        this._cullBuf.push(object);
        if (object.castsShadow !== false) {this._shadowBuf.push(object);}
      }
    }
    for (const light of scene.allLights) {
      if (!light.enabled) {continue;}
      if (light instanceof OmniLight) {this._omniBuf.push(light);}
      else if (light instanceof DirectionalLight) {this._dirBuf.push(light);}
    }
  }

  private _bakeLightmap(
    scene: Scene,
    cache: LightmapCache,
    originX: number,
    originY: number,
    ambientRgb: [number, number, number]
  ): void {
    cache.begin();
    const ctx = cache.ctx as unknown as CanvasRenderingContext2D;
    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scene.camera.zoom, scene.camera.zoom);

    const {rotation, elevation} = scene.view;
    if (elevation !== 0.5) {ctx.scale(1, elevation / 0.5);}
    if (rotation !== 0) {
      const radians = rotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const aspect = scene.tileW / scene.tileH;
      ctx.transform(cos, -sin / aspect, sin * aspect, cos, 0, 0);
    }
    ctx.translate(
      -(scene.camera.x - scene.camera.y) * (scene.tileW / 2),
      -(scene.camera.x + scene.camera.y) * (scene.tileH / 2)
    );

    const drawContext: DrawContext = {
      ctx,
      tileW: scene.tileW,
      tileH: scene.tileH,
      originX: 0,
      originY: 0,
      omniLights: this._omniBuf,
      dirLights: this._dirBuf,
      ambientRgb,
      view: scene.view,
    };
    for (const floor of this._floorBuf) {floor.draw(drawContext);}
    for (const light of this._omniBuf) {
      ShadowCaster.draw(ctx, light, this._shadowBuf, scene.tileW, scene.tileH);
    }
    for (const light of this._dirBuf) {
      ShadowCaster.drawDirectional(ctx, light, this._shadowBuf, scene.tileW, scene.tileH);
    }
    ctx.restore();
    cache.end();
  }

  private _frustumCull(
    scene: Scene,
    objects: IsoObject[],
    canvasW: number,
    canvasH: number
  ): void {
    const padding = 0.5;
    const halfSum = (canvasH / 2) / scene.camera.zoom / (scene.tileH / 2) + padding;
    const halfDiff = (canvasW / 2) / scene.camera.zoom / (scene.tileW / 2) + padding;
    const cameraSum = scene.camera.x + scene.camera.y;
    const cameraDiff = scene.camera.x - scene.camera.y;
    const sumMin = cameraSum - halfSum * 2;
    const sumMax = cameraSum + halfSum * 2;
    const diffMin = cameraDiff - halfDiff * 2;
    const diffMax = cameraDiff + halfDiff * 2;

    let write = 0;
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      const {minX, minY, maxX, maxY} = object.aabb;
      if (
        maxX + maxY >= sumMin && minX + minY <= sumMax &&
        maxX - minY >= diffMin && minX - maxY <= diffMax
      ) {
        objects[write++] = object;
      }
    }
    objects.length = write;
  }

  private _computeObjectHash(objects: IsoObject[]): number {
    let hash = 0;
    for (const object of objects) {
      let objectId = this._objectIds.get(object);
      if (objectId === undefined) {
        objectId = this._nextObjectId++;
        this._objectIds.set(object, objectId);
      }
      const box = object.aabb;
      hash = this._mix(hash, objectId);
      hash = this._mix(hash, box.minX);
      hash = this._mix(hash, box.minY);
      hash = this._mix(hash, box.maxX);
      hash = this._mix(hash, box.maxY);
      hash = this._mix(hash, box.baseZ);
      hash = this._mix(hash, box.maxZ ?? box.baseZ + 1);
    }
    return hash;
  }

  private _computeFloorSnapshot(objects: readonly IsoObject[]): string {
    let snapshot = '';
    for (const object of objects) {
      if (!(object instanceof Floor)) {continue;}
      snapshot += `${object.id}:${object.visible ? 1 : 0}:${object.cols}:${object.rows}:` +
        `${object.color}:${object.altColor}:${object.tileImageUrl ?? ''}:` +
        `${object.altTileImageUrl ?? ''}|`;
    }
    return snapshot;
  }

  private _mix(hash: number, value: number): number {
    return (Math.imul(hash, 31) + (value * 1000 | 0)) | 0;
  }

  private _drawLightHalos(scene: Scene, ctx: CanvasRenderingContext2D): void {
    const {rotation, elevation} = scene.view;
    for (const light of this._omniBuf) {
      const projected = project(light.position.x, light.position.y, 0, scene.tileW, scene.tileH);
      let x = projected.sx;
      let y = projected.sy - light.position.z;
      if (elevation !== 0.5) {y *= elevation / 0.5;}
      if (rotation !== 0) {
        const radians = rotation * Math.PI / 180;
        const cos = Math.cos(radians);
        const sin = Math.sin(radians);
        const aspect = scene.tileW / scene.tileH;
        const nextX = cos * x + sin * aspect * y;
        const nextY = (-sin / aspect) * x + cos * y;
        x = nextX;
        y = nextY;
      }
      this._drawLightHalo(ctx, x, y, light.color, light.intensity);
    }
  }

  private _drawLightHalo(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    intensity: number
  ): void {
    const radius = 18 * Math.min(1.5, intensity);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, hexToRgba(color, 0.95));
    gradient.addColorStop(0.3, hexToRgba(color, 0.55));
    gradient.addColorStop(1, hexToRgba(color, 0));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff8e0';
    ctx.fill();
  }
}
