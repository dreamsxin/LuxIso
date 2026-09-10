import type { Scene } from '../../../src/core/Scene';
import { ParticleBlend, ParticleSystem, type ParticleRenderState } from '../../../src/animation/ParticleSystem';
import { Character } from '../../../src/elements/Character';
import { Floor } from '../../../src/elements/Floor';
import type { IsoObject } from '../../../src/elements/IsoObject';
import { Wall } from '../../../src/elements/Wall';
import { Boulder } from '../../../src/elements/props/Boulder';
import { Chest } from '../../../src/elements/props/Chest';
import { Cloud } from '../../../src/elements/props/Cloud';
import { Crystal } from '../../../src/elements/props/Crystal';
import { FloatingText } from '../../../src/elements/props/FloatingText';
import { Tree } from '../../../src/elements/props/Tree';
import { FlowerPatch } from '../../../src/elements/props/FlowerPatch';
import { Lantern } from '../../../src/elements/props/Lantern';
import { hexToRgb, shiftColor } from '../../../src/math/color';
import { topoSort } from '../../../src/math/depthSort';
import type {
  RenderDirectionalLight,
  RenderBlendMode,
  RenderDrawSegment,
  RenderMinimapItem,
  RenderOmniLight,
  RenderSnapshot,
  RenderTextOverlay,
  UnsupportedRenderObject,
} from '../contracts/RenderSnapshot';
import { GeometryBuilder, type RenderColor, type RenderPoint } from './GeometryBuilder';
import { projectIso } from './projection';
import {
  clipShadowHullToScene,
  type ProjectedShadow,
} from './ShadowProjector';
import { ShadowProjectionCache, type ShadowCacheStats } from './ShadowProjectionCache';

export interface ExtractOptions {
  viewportWidth: number;
  viewportHeight: number;
  originX?: number;
  originY?: number;
  clearColor?: string;
  selectedId?: string | null;
  showCollision?: boolean;
  debugMarkers?: readonly DebugMarker[];
}

export interface DebugMarker {
  id: string;
  x: number;
  y: number;
  color?: string;
  kind?: 'omni' | 'directional' | 'object' | 'target';
}

interface VisibleBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * What a registered extractor is handed. Deliberately narrow: geometry plus the
 * projection and the pick id, nothing that would let application code reach into
 * the extractor's frame state.
 */
export interface ExtractorContext {
  readonly builder: GeometryBuilder;
  readonly tileW: number;
  readonly tileH: number;
  /** Stable id for this object in the picking buffer — pass it in `VertexStyle`. */
  readonly pickId: number;
  /** World (x, y, z-in-pixels) → screen space, same projection the built-ins use. */
  project(x: number, y: number, zPixels?: number): RenderPoint;
}

/**
 * Emits geometry for one object. Return a texture URL to have the geometry put
 * in a textured draw segment, or nothing for flat colour.
 */
export type ObjectExtractor<T extends IsoObject = IsoObject> =
  (object: T, ctx: ExtractorContext) => string | void;

type IsoObjectCtor<T extends IsoObject = IsoObject> = abstract new (...args: never[]) => T;

/**
 * Converts the mutable Canvas scene graph into renderer-owned numeric data.
 * The geometry arena and metadata arrays are reused between frames.
 */
export class SceneExtractor {
  /**
   * Custom extractors, most recently registered first.
   *
   * Dispatch for built-in types is a hardcoded `instanceof` chain; anything else
   * used to become a magenta diagnostic diamond with no way to opt in, which
   * made every custom `IsoObject` subclass unrenderable on the WebGL path. This
   * registry is that opt-in.
   */
  private static _extractors: Array<{ ctor: IsoObjectCtor; extract: ObjectExtractor }> = [];

  /**
   * Teach the extractor how to draw an object type.
   *
   * Later registrations win, so a subclass can override a base class without
   * unregistering it. Built-in types are matched first and cannot be overridden
   * this way.
   *
   * @example
   *   SceneExtractor.register(LavaRiver, (river, ctx) => {
   *     const a = ctx.project(river.position.x, river.position.y);
   *     ctx.builder.quad(a, b, c, d, { color: [1, 0.3, 0.1, 1], sample: a, lit: false, pickId: ctx.pickId });
   *   });
   */
  static register<T extends IsoObject>(ctor: IsoObjectCtor<T>, extract: ObjectExtractor<T>): void {
    SceneExtractor.unregister(ctor);
    SceneExtractor._extractors.unshift({
      ctor,
      extract: extract as ObjectExtractor,
    });
  }

  /** Remove a registration. Returns true if one was present. */
  static unregister(ctor: IsoObjectCtor): boolean {
    const before = SceneExtractor._extractors.length;
    SceneExtractor._extractors = SceneExtractor._extractors.filter(e => e.ctor !== ctor);
    return SceneExtractor._extractors.length !== before;
  }

  /** Drop every registration. Intended for tests. */
  static clearExtractors(): void {
    SceneExtractor._extractors = [];
  }

  /** The extractor that would handle this object, or null. */
  static findExtractor(object: IsoObject): ObjectExtractor | null {
    for (const entry of SceneExtractor._extractors) {
      if (object instanceof entry.ctor) return entry.extract;
    }
    return null;
  }

  private readonly _builder = new GeometryBuilder();

  private readonly _pickIds = new WeakMap<object, number>();
  private readonly _externalPickIds = new Map<string, number>();
  private readonly _pickLookup = new Map<number, string>();
  private readonly _omniLights: RenderOmniLight[] = [];
  private readonly _directionalLights: RenderDirectionalLight[] = [];
  private readonly _unsupported: UnsupportedRenderObject[] = [];
  private readonly _segments: RenderDrawSegment[] = [];
  private readonly _textOverlays: RenderTextOverlay[] = [];
  private readonly _minimapItems: RenderMinimapItem[] = [];
  private readonly _shadowCache = new ShadowProjectionCache();
  private _minimapWalkable = new Uint8Array(0);
  private _nextPickId = 1;
  private _frame = 0;

  get shadowCacheStats(): ShadowCacheStats {
    return this._shadowCache.stats;
  }

  extract(scene: Scene, options: ExtractOptions): RenderSnapshot {
    this._shadowCache.beginFrame();
    this._builder.reset();
    this._pickLookup.clear();
    this._omniLights.length = 0;
    this._directionalLights.length = 0;
    this._unsupported.length = 0;
    this._segments.length = 0;
    this._textOverlays.length = 0;
    this._minimapItems.length = 0;

    const visibleBounds = this._visibleBounds(scene, options);

    const floorObjects = scene.allObjects.filter(
      (object): object is Floor => object.visible && object instanceof Floor,
    );
    const renderables = scene.allObjects.filter(
      (object) => object.visible &&
        !(object instanceof Floor) &&
        !object.isGroundLayer &&
        intersects(object, visibleBounds),
    );
    const sorted = topoSort([...renderables]);

    const floorStart = this._builder.mark();
    for (const floor of floorObjects) this._extractFloor(floor, scene.tileW, scene.tileH, visibleBounds);
    const floorRange = this._builder.range(floorStart);

    const shadowStart = this._builder.mark();
    for (const object of sorted) this._extractShadow(object, scene, scene.tileW, scene.tileH);
    const shadowRange = this._builder.range(shadowStart);
    this._recordSegment(shadowStart, 'multiply');

    const opaqueStart = this._builder.mark();
    for (const object of sorted) {
      if (object instanceof Cloud || object instanceof ParticleSystem || object instanceof FloatingText) continue;
      const first = this._builder.mark();
      const textureUrl = this._extractObject(object, scene.tileW, scene.tileH);
      this._recordSegment(first, 'alpha', textureUrl);
    }
    const opaqueRange = this._builder.range(opaqueStart);

    const transparentStart = this._builder.mark();
    for (const object of sorted) {
      if (object instanceof Cloud) {
        const first = this._builder.mark();
        this._extractCloud(object, scene.tileW, scene.tileH);
        this._recordSegment(first, 'alpha');
      } else if (object instanceof ParticleSystem) {
        this._extractParticles(object, scene.tileW, scene.tileH);
      } else if (object instanceof FloatingText) {
        this._extractFloatingText(object, scene.tileW, scene.tileH);
      }
    }
    const haloStart = this._builder.mark();
    this._extractLightHalos(scene, scene.tileW, scene.tileH);
    this._recordSegment(haloStart, 'add');
    const transparentRange = this._builder.range(transparentStart);

    const debugStart = this._builder.mark();
    this._extractDebug(scene, options);
    const debugRange = this._builder.range(debugStart);
    this._recordSegment(debugStart, 'alpha');

    this._extractLights(scene, scene.tileW, scene.tileH);
    this._extractMinimap(scene);
    const clearColor = rgb(options.clearColor ?? '#12161d');
    const ambientColor = rgb(scene.ambientColor);

    return {
      frame: ++this._frame,
      tileW: scene.tileW,
      tileH: scene.tileH,
      camera: {
        worldX: scene.camera.x,
        worldY: scene.camera.y,
        zoom: scene.camera.zoom,
        rotation: scene.view.rotation,
        elevation: scene.view.elevation,
        originX: options.originX ?? options.viewportWidth / 2,
        originY: options.originY ?? Math.min(180, options.viewportHeight * 0.24),
        viewportWidth: options.viewportWidth,
        viewportHeight: options.viewportHeight,
      },
      environment: {
        clearColor,
        ambientColor,
        ambientIntensity: scene.ambientIntensity,
      },
      geometry: this._builder.geometry(
        floorRange,
        shadowRange,
        opaqueRange,
        transparentRange,
        debugRange,
        this._segments,
      ),
      omniLights: this._omniLights,
      directionalLights: this._directionalLights,
      textOverlays: this._textOverlays,
      minimap: {
        cols: scene.cols,
        rows: scene.rows,
        walkable: this._minimapWalkable,
        items: this._minimapItems,
      },
      pickLookup: this._pickLookup,
      unsupported: this._unsupported,
    };
  }

  private _extractFloor(
    floor: Floor,
    tileW: number,
    tileH: number,
    visible: VisibleBounds,
  ): void {
    const pickId = this._pickId(floor);
    const startRow = Math.max(0, Math.floor(visible.minY));
    const endRow = Math.min(floor.rows, Math.ceil(visible.maxY));
    const startCol = Math.max(0, Math.floor(visible.minX));
    const endCol = Math.min(floor.cols, Math.ceil(visible.maxX));
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const first = this._builder.mark();
        const top = point(projectIso(col, row, 0, tileW, tileH));
        const right = point(projectIso(col + 1, row, 0, tileW, tileH));
        const bottom = point(projectIso(col + 1, row + 1, 0, tileW, tileH));
        const left = point(projectIso(col, row + 1, 0, tileW, tileH));
        const center = point(projectIso(col + 0.5, row + 0.5, 0, tileW, tileH));
        const even = (col + row) % 2 === 0;
        const textureUrl = even
          ? floor.tileImageUrl
          : floor.altTileImageUrl ?? floor.tileImageUrl;
        if (textureUrl) {
          this._builder.texturedQuad(top, right, bottom, left, [0, 0, 1, 1], {
            color: [1, 1, 1, 1],
            sample: center,
            normal: [0, -1],
            pickId,
          });
        } else {
          const color = rgba(even ? floor.color : floor.altColor || shiftColor(floor.color, -8));
          this._builder.quad(top, right, bottom, left, {
            color,
            sample: center,
            normal: [0, -1],
            pickId,
          });
        }
        this._recordSegment(first, 'alpha', textureUrl);
      }
    }
  }

  private _extractShadow(object: IsoObject, scene: Scene, tileW: number, tileH: number): void {
    if (!(object.castsShadow || object instanceof Character || object instanceof Cloud)) return;

    const ground = point(projectIso(object.position.x, object.position.y, 0, tileW, tileH));
    const radius = object instanceof Character
      ? object.radius * 1.25
      : object instanceof Cloud
        ? 28 * object.scale * (tileW / 64)
        : Math.max(8, (object.shadowRadius ?? 0.3) * tileW);
    const alpha = object instanceof Cloud ? 0.11 : 0.13;
    this._builder.ellipse(ground, radius, radius * 0.38, {
      color: [0.02, 0.03, 0.05, alpha],
      sample: ground,
      lit: false,
    }, 18);

    if (object instanceof Cloud) return;
    let strongestOmni: ProjectedShadow | null = null;
    for (const light of scene.omniLights) {
      const shadow = this._shadowCache.projectOmni(object, light, tileW, tileH);
      if (shadow && (!strongestOmni || shadow.alpha > strongestOmni.alpha)) strongestOmni = shadow;
    }
    this._appendProjectedShadow(strongestOmni, scene, tileW, tileH, ground, 0.46);

    let strongestDirectional: ProjectedShadow | null = null;
    for (const light of scene.dirLights) {
      const shadow = this._shadowCache.projectDirectional(object, light, tileW, tileH);
      if (shadow && (!strongestDirectional || shadow.alpha > strongestDirectional.alpha)) strongestDirectional = shadow;
    }
    this._appendProjectedShadow(strongestDirectional, scene, tileW, tileH, ground, 0.34);
  }

  private _appendProjectedShadow(
    shadow: ProjectedShadow | null,
    scene: Scene,
    tileW: number,
    tileH: number,
    sample: RenderPoint,
    alphaScale: number,
  ): void {
    if (!shadow) return;
    const clipped = clipShadowHullToScene(shadow.hull, scene.cols, scene.rows, tileW, tileH);
    if (clipped.length < 3) return;
    this._builder.polygon(clipped, {
      color: [0.015, 0.02, 0.025, shadow.alpha * alphaScale],
      sample,
      lit: false,
    });
  }

  private _extractObject(object: IsoObject, tileW: number, tileH: number): string | undefined {
    if (object instanceof Wall) {
      this._extractWall(object, tileW, tileH);
    } else if (object instanceof Character) {
      return this._extractCharacter(object, tileW, tileH);
    } else if (object instanceof Crystal) {
      this._extractCrystal(object, tileW, tileH);
    } else if (object instanceof Boulder) {
      this._extractBoulder(object, tileW, tileH);
    } else if (object instanceof Chest) {
      this._extractChest(object, tileW, tileH);
    } else if (object instanceof Tree) {
      this._extractTree(object, tileW, tileH);
    } else if (object instanceof FlowerPatch) {
      this._extractFlowerPatch(object, tileW, tileH);
    } else if (object instanceof Lantern) {
      this._extractLantern(object, tileW, tileH);
    } else {
      const custom = SceneExtractor.findExtractor(object);
      if (custom) return this._runCustomExtractor(object, custom, tileW, tileH) ?? undefined;
      this._unsupported.push({
        id: object.id,
        type: object.constructor.name,
        reason: 'No WebGL geometry extractor is registered for this object type. '
          + 'Register one with SceneExtractor.register(Ctor, fn).',
      });
      this._extractDiagnostic(object, tileW, tileH);
    }
    return undefined;
  }

  /**
   * Run a registered extractor, and fall back to the diagnostic marker if it
   * throws or emits nothing.
   *
   * A custom extractor is application code running inside the render path; left
   * unguarded, one bad projection would take down the whole frame rather than
   * showing up as one broken object.
   */
  private _runCustomExtractor(
    object: IsoObject,
    extract: ObjectExtractor,
    tileW: number,
    tileH: number,
  ): string | undefined {
    const before = this._builder.mark();
    const context: ExtractorContext = {
      builder: this._builder,
      tileW,
      tileH,
      pickId: this._pickId(object),
      project: (x, y, zPixels = 0) => point(projectIso(x, y, zPixels, tileW, tileH)),
    };
    try {
      const textureUrl = extract(object, context);
      if (this._builder.mark() === before) {
        this._unsupported.push({
          id: object.id,
          type: object.constructor.name,
          reason: 'Registered extractor produced no geometry.',
        });
        this._extractDiagnostic(object, tileW, tileH);
        return undefined;
      }
      return textureUrl ?? undefined;
    } catch (err) {
      this._unsupported.push({
        id: object.id,
        type: object.constructor.name,
        reason: `Registered extractor threw — ${String(err)}`,
      });
      this._extractDiagnostic(object, tileW, tileH);
      return undefined;
    }
  }


  private _extractWall(wall: Wall, tileW: number, tileH: number): void {
    const start = point(projectIso(wall.position.x, wall.position.y, 0, tileW, tileH));
    const end = point(projectIso(wall.endX, wall.endY, 0, tileW, tileH));
    const topEnd: RenderPoint = [end[0], end[1] - wall.wallHeight];
    const topStart: RenderPoint = [start[0], start[1] - wall.wallHeight];
    const sample: RenderPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const isXWall = wall.position.y === wall.endY;
    const normal: RenderPoint = isXWall ? [0.8944, -0.4472] : [-0.8944, -0.4472];
    const pickId = this._pickId(wall);

    this._builder.quad(start, end, topEnd, topStart, {
      color: rgba(wall.color),
      sample,
      normal,
      pickId,
    });

    for (const opening of wall.openings) {
      const startT = opening.offsetX;
      const endT = opening.offsetX + opening.width;
      const bottom = opening.offsetY ?? 0;
      const top = bottom + opening.height;
      const p0 = lerpPoint(start, end, startT, bottom * wall.wallHeight);
      const p1 = lerpPoint(start, end, endT, bottom * wall.wallHeight);
      const p2 = lerpPoint(start, end, endT, top * wall.wallHeight);
      const p3 = lerpPoint(start, end, startT, top * wall.wallHeight);
      this._builder.quad(p0, p1, p2, p3, {
        color: opening.type === 'door'
          ? [0.015, 0.02, 0.03, 0.96]
          : [0.18, 0.42, 0.62, 0.8],
        sample,
        lit: false,
        pickId,
      });
    }
  }

  private _extractCharacter(character: Character, tileW: number, tileH: number): string | undefined {
    const center = point(projectIso(
      character.position.x,
      character.position.y,
      character.position.z,
      tileW,
      tileH,
    ));
    const pickId = this._pickId(character);
    const animation = character.anim;
    const spriteSheet = animation?.spriteSheet;
    const image = spriteSheet?.image;
    const frame = animation?.currentClip.frames[animation.frameIndex];
    if (spriteSheet && image && frame) {
      const width = frame.w * spriteSheet.scale;
      const height = frame.h * spriteSheet.scale;
      const left = center[0] - width / 2;
      const top = center[1] - height * spriteSheet.anchorY;
      const u0 = frame.x / image.naturalWidth;
      const v0 = frame.y / image.naturalHeight;
      const u1 = (frame.x + frame.w) / image.naturalWidth;
      const v1 = (frame.y + frame.h) / image.naturalHeight;
      this._builder.texturedQuad(
        [left, top],
        [left + width, top],
        [left + width, top + height],
        [left, top + height],
        [u0, v0, u1, v1],
        {
          color: [1, 1, 1, 1],
          sample: center,
          lit: false,
          pickId,
        },
      );
      return spriteSheet.url;
    }
    const radius = character.radius;
    this._builder.ellipse(center, radius, radius, {
      color: rgba(shiftColor(character.color, -24)),
      sample: center,
      normal: [-0.35, -0.94],
      pickId,
    }, 24);
    this._builder.ellipse([center[0] - radius * 0.18, center[1] - radius * 0.22], radius * 0.68, radius * 0.68, {
      color: rgba(shiftColor(character.color, 28)),
      sample: center,
      normal: [-0.62, -0.78],
      pickId,
    }, 20);
    return undefined;
  }

  private _extractCrystal(crystal: Crystal, tileW: number, tileH: number): void {
    const center = point(projectIso(crystal.position.x, crystal.position.y, 0, tileW, tileH));
    const pickId = this._pickId(crystal);
    const height = crystal.propHeightPx;
    const width = tileW * 0.28;
    const leftShoulder: RenderPoint = [center[0] - width * 0.92, center[1] - height * 0.44];
    const leftUpper: RenderPoint = [center[0] - width * 0.38, center[1] - height * 0.9];
    const ridge: RenderPoint = [center[0], center[1] - height * 0.58];
    const rightUpper: RenderPoint = [center[0] + width * 0.38, center[1] - height * 0.9];
    const rightShoulder: RenderPoint = [center[0] + width * 0.92, center[1] - height * 0.42];
    const tip: RenderPoint = [center[0], center[1] - height * 1.18];

    this._builder.quad(center, leftShoulder, leftUpper, ridge, {
      color: rgba(shiftColor(crystal.propColor, -52)), sample: center, normal: [-0.8, -0.4], pickId,
    });
    this._builder.quad(center, ridge, rightUpper, rightShoulder, {
      color: rgba(crystal.propColor), sample: center, normal: [0.8, -0.4], pickId,
    });
    this._builder.triangle(leftUpper, tip, ridge, {
      color: rgba(shiftColor(crystal.propColor, 58)), sample: center, normal: [-0.25, -0.97], pickId,
    });
    this._builder.triangle(tip, rightUpper, ridge, {
      color: rgba(shiftColor(crystal.propColor, 38)), sample: center, normal: [0.25, -0.97], pickId,
    });

    // Slightly overlap the shared ridge so rasterization cannot expose the clear color.
    this._builder.triangle(
      [ridge[0] - 0.85, ridge[1] + 0.6],
      tip,
      [ridge[0] + 0.85, ridge[1] + 0.6],
      { color: rgba(shiftColor(crystal.propColor, 68)), sample: center, normal: [0, -1], pickId },
    );
    this._builder.triangle(
      [ridge[0] - 0.8, ridge[1] - 0.5],
      [ridge[0] + 0.8, ridge[1] - 0.5],
      center,
      { color: rgba(shiftColor(crystal.propColor, -18)), sample: center, normal: [0, -1], pickId },
    );

    const secondaryBase: RenderPoint = [center[0] + width * 0.72, center[1] - height * 0.04];
    const secondaryHeight = height * 0.55;
    const secondaryWidth = width * 0.48;
    const secondaryTip: RenderPoint = [secondaryBase[0], secondaryBase[1] - secondaryHeight];
    const secondaryRidge: RenderPoint = [secondaryBase[0], secondaryBase[1] - secondaryHeight * 0.48];
    this._builder.quad(
      secondaryBase,
      [secondaryBase[0] - secondaryWidth, secondaryBase[1] - secondaryHeight * 0.34],
      [secondaryBase[0] - secondaryWidth * 0.32, secondaryBase[1] - secondaryHeight * 0.72],
      secondaryRidge,
      { color: rgba(shiftColor(crystal.propColor, -30)), sample: center, normal: [-0.8, -0.4], pickId },
    );
    this._builder.triangle(
      secondaryRidge,
      secondaryTip,
      [secondaryBase[0] + secondaryWidth * 0.7, secondaryBase[1] - secondaryHeight * 0.3],
      { color: rgba(shiftColor(crystal.propColor, 28)), sample: center, normal: [0.65, -0.76], pickId },
    );
  }

  private _extractTree(tree: Tree, tileW: number, tileH: number): void {
    const center = point(projectIso(tree.position.x, tree.position.y, 0, tileW, tileH));
    const pickId = this._pickId(tree);
    const scale = tree.propScale;
    const height = tree.propHeightPx * scale;
    const canopyRadius = tileW * 0.31 * scale;
    const trunkWidth = Math.max(5, tileW * 0.09 * scale);
    const trunkTop = center[1] - height * 0.72;
    this._builder.quad(
      [center[0] - trunkWidth * 0.72, center[1]],
      [center[0] + trunkWidth * 0.82, center[1]],
      [center[0] + trunkWidth * 0.42, trunkTop],
      [center[0] - trunkWidth * 0.45, trunkTop],
      { color: rgba(shiftColor(tree.propTrunkColor, -16)), sample: center, normal: [-0.25, -0.97], pickId },
    );

    const canopyY = center[1] - height * 0.78;
    const puffs: ReadonlyArray<readonly [number, number, number, string, RenderPoint]> = [
      [-0.58, 0.15, 0.64, shiftColor(tree.propCanopyColor, -28), [-0.72, -0.69]],
      [0.58, 0.12, 0.62, shiftColor(tree.propCanopyColor, -16), [0.72, -0.69]],
      [0, -0.38, 0.72, shiftColor(tree.propCanopyColor, 12), [0, -1]],
      [-0.2, 0.2, 0.82, tree.propCanopyColor, [-0.3, -0.95]],
      [0.28, 0.22, 0.75, shiftColor(tree.propCanopyColor, 5), [0.35, -0.94]],
    ];
    for (const [dx, dy, puffScale, color, normal] of puffs) {
      this._builder.ellipse(
        [center[0] + canopyRadius * dx, canopyY + canopyRadius * dy],
        canopyRadius * puffScale,
        canopyRadius * puffScale * 0.8,
        { color: rgba(color), sample: center, normal, pickId },
        14,
      );
    }
    this._builder.ellipse(
      [center[0] - canopyRadius * 0.2, canopyY - canopyRadius * 0.42],
      canopyRadius * 0.24,
      canopyRadius * 0.13,
      { color: rgba(shiftColor(tree.propCanopyColor, 56)), sample: center, normal: [0, -1], pickId },
      10,
    );
  }

  private _extractFlowerPatch(flowers: FlowerPatch, tileW: number, tileH: number): void {
    const center = point(projectIso(flowers.position.x, flowers.position.y, 0, tileW, tileH));
    const pickId = this._pickId(flowers);
    for (const flower of flowers.flowerOffsets) {
      const x = center[0] + flower.x * tileW * 0.5;
      const baseY = center[1] + flower.y * tileH * 1.15;
      const stemHeight = (7 + (flower.y + 0.5) * 4) * flower.scale;
      const headY = baseY - stemHeight;
      const radius = 2.2 * flower.scale;
      const petalColor = flower.accent ? flowers.propAccentColor : flowers.propColor;
      const style = { color: rgba('#659c55'), sample: center, normal: [0, -1] as RenderPoint, pickId };
      this._builder.line([x, baseY], [x, headY], Math.max(1, flower.scale), style);
      this._builder.ellipse(
        [x - 2.2 * flower.scale, baseY - stemHeight * 0.38],
        2.5 * flower.scale,
        1.1 * flower.scale,
        { ...style, color: rgba('#70a95a') },
        8,
      );
      for (let petal = 0; petal < 5; petal++) {
        const angle = petal * Math.PI * 2 / 5 - Math.PI / 2;
        this._builder.ellipse(
          [x + Math.cos(angle) * radius, headY + Math.sin(angle) * radius],
          radius * 0.75,
          radius * 0.75,
          { ...style, color: rgba(petalColor) },
          8,
        );
      }
      this._builder.ellipse(
        [x, headY],
        radius * 0.72,
        radius * 0.72,
        { ...style, color: rgba(flower.accent ? '#ef8f59' : '#ffe18a') },
        8,
      );
    }
  }

  private _extractLantern(lantern: Lantern, tileW: number, tileH: number): void {
    const center = point(projectIso(lantern.position.x, lantern.position.y, 0, tileW, tileH));
    const pickId = this._pickId(lantern);
    const lampY = center[1] - lantern.propHeightPx;
    const bodyWidth = tileW * 0.16;
    const bodyHeight = tileH * 0.44;
    const sample: RenderPoint = [center[0], lampY];

    this._builder.ellipse(sample, bodyWidth * 2.7, bodyHeight * 2.3, {
      color: rgba(lantern.propGlowColor, 0.1), sample, lit: false, pickId,
    }, 18);
    this._builder.quad(
      [center[0], center[1] + tileH * 0.1],
      [center[0] + tileW * 0.12, center[1]],
      [center[0], center[1] - tileH * 0.1],
      [center[0] - tileW * 0.12, center[1]],
      { color: rgba(shiftColor(lantern.propPostColor, -22)), sample, normal: [0, -1], pickId },
    );
    this._builder.line(
      [center[0], center[1]],
      [center[0], lampY + bodyHeight * 0.5],
      Math.max(3, tileW * 0.05),
      { color: rgba(lantern.propPostColor), sample, normal: [-0.25, -0.97], pickId },
    );
    this._builder.polygon([
      [center[0], lampY - bodyHeight * 0.72],
      [center[0] + bodyWidth * 0.75, lampY - bodyHeight * 0.35],
      [center[0] + bodyWidth * 0.62, lampY + bodyHeight * 0.48],
      [center[0], lampY + bodyHeight * 0.7],
      [center[0] - bodyWidth * 0.62, lampY + bodyHeight * 0.48],
      [center[0] - bodyWidth * 0.75, lampY - bodyHeight * 0.35],
    ], { color: rgba(lantern.propGlowColor), sample, lit: false, pickId });
    this._builder.triangle(
      [center[0] - bodyWidth * 0.92, lampY - bodyHeight * 0.5],
      [center[0], lampY - bodyHeight * 0.95],
      [center[0] + bodyWidth * 0.92, lampY - bodyHeight * 0.5],
      { color: rgba(shiftColor(lantern.propPostColor, -8)), sample, normal: [0, -1], pickId },
    );
    this._builder.ellipse(
      [center[0] - bodyWidth * 0.2, lampY - bodyHeight * 0.15],
      bodyWidth * 0.13,
      bodyWidth * 0.13,
      { color: rgba('#fff7cf'), sample, lit: false, pickId },
      8,
    );
  }

  private _extractBoulder(boulder: Boulder, tileW: number, tileH: number): void {
    const center = point(projectIso(boulder.position.x, boulder.position.y, 0, tileW, tileH));
    const pickId = this._pickId(boulder);
    const radius = boulder.propRadius;
    this._builder.ellipse([center[0], center[1] - radius * 0.42], radius, radius * 0.72, {
      color: rgba(shiftColor(boulder.propColor, -18)),
      sample: center,
      normal: [0.35, -0.94],
      pickId,
    }, 12);
    this._builder.polygon([
      [center[0] - radius * 0.55, center[1] - radius * 0.55],
      [center[0] - radius * 0.1, center[1] - radius * 1.05],
      [center[0] + radius * 0.55, center[1] - radius * 0.72],
      [center[0] + radius * 0.2, center[1] - radius * 0.35],
    ], { color: rgba(shiftColor(boulder.propColor, 30)), sample: center, normal: [-0.4, -0.9], pickId });
  }

  private _extractChest(chest: Chest, tileW: number, tileH: number): void {
    const { x, y } = chest.position;
    const half = 0.38;
    const north = point(projectIso(x - half, y - half, 0, tileW, tileH));
    const east = point(projectIso(x + half, y - half, 0, tileW, tileH));
    const south = point(projectIso(x + half, y + half, 0, tileW, tileH));
    const west = point(projectIso(x - half, y + half, 0, tileW, tileH));
    const height = tileH * 1.1;
    const lift = (p: RenderPoint): RenderPoint => [p[0], p[1] - height];
    const sample = point(projectIso(x, y, 0, tileW, tileH));
    const pickId = this._pickId(chest);
    const topEast = lift(east);
    const topSouth = lift(south);
    const topWest = lift(west);
    this._builder.quad(west, south, topSouth, topWest, {
      color: rgba(shiftColor(chest.propColor, -18)), sample, normal: [-0.8944, -0.4472], pickId,
    });
    this._builder.quad(south, east, topEast, topSouth, {
      color: rgba(shiftColor(chest.propColor, -38)), sample, normal: [0.8944, -0.4472], pickId,
    });

    const metal = shiftColor('#596268', -8);
    const metalDark = shiftColor(metal, -24);
    for (const fraction of [0.14, 0.68]) {
      const end = fraction + 0.1;
      this._builder.quad(
        lerpPoint(west, south, fraction, 0),
        lerpPoint(west, south, end, 0),
        lerpPoint(west, south, end, height),
        lerpPoint(west, south, fraction, height),
        { color: rgba(metal), sample, normal: [-0.8944, -0.4472], pickId },
      );
      this._builder.quad(
        lerpPoint(south, east, fraction, 0),
        lerpPoint(south, east, end, 0),
        lerpPoint(south, east, end, height),
        lerpPoint(south, east, fraction, height),
        { color: rgba(metalDark), sample, normal: [0.8944, -0.4472], pickId },
      );
    }
    for (const fraction of [0.34, 0.67]) {
      this._builder.line(
        lerpPoint(west, west, 0, height * fraction),
        lerpPoint(south, south, 0, height * fraction),
        0.8,
        { color: rgba(shiftColor(chest.propColor, -48)), sample, normal: [-0.8944, -0.4472], pickId },
      );
      this._builder.line(
        lerpPoint(south, south, 0, height * fraction),
        lerpPoint(east, east, 0, height * fraction),
        0.8,
        { color: rgba(shiftColor(chest.propColor, -58)), sample, normal: [0.8944, -0.4472], pickId },
      );
    }

    const latch = lerpPoint(west, south, 0.52, height * 0.52);
    this._builder.ellipse(latch, 5.2, 3.8, {
      color: rgba('#d8a92f'), sample, normal: [-0.8944, -0.4472], pickId,
    }, 12);
    this._builder.ellipse([latch[0], latch[1] + 0.4], 1.5, 1.8, {
      color: rgba('#252a29'), sample, lit: false, pickId,
    }, 8);
    for (const [u, z] of [[0.08, 0.16], [0.9, 0.16], [0.08, 0.84], [0.9, 0.84]] as const) {
      this._builder.ellipse(lerpPoint(west, south, u, height * z), 1.3, 1.1, {
        color: rgba('#cbd2ce'), sample, normal: [-0.8944, -0.4472], pickId,
      }, 8);
    }

    const lidLift = chest.isOpen ? height + tileH * 0.7 : height + tileH * 0.24;
    const lidNorth: RenderPoint = [north[0], north[1] - lidLift];
    const lidEast: RenderPoint = [east[0], east[1] - lidLift];
    if (chest.isOpen) {
      this._builder.ellipse([sample[0], sample[1] - height * 0.92], tileW * 0.42, tileH * 0.7, {
        color: rgba('#ffd86b', 0.22), sample, lit: false, pickId,
      }, 18);
      this._builder.line(topWest, topSouth, 2, { color: rgba('#ffe88c'), sample, lit: false, pickId });
      this._builder.line(topSouth, topEast, 2, { color: rgba('#ffd45c'), sample, lit: false, pickId });
    }
    this._builder.quad(
      lidNorth,
      lidEast,
      topSouth,
      topWest,
      { color: rgba(shiftColor(chest.propColor, 24)), sample, normal: [0, -1], pickId },
    );
    this._builder.quad(
      lerpPoint(lidNorth, lidEast, 0.43, 0),
      lerpPoint(lidNorth, lidEast, 0.57, 0),
      lerpPoint(topWest, topSouth, 0.57, 0),
      lerpPoint(topWest, topSouth, 0.43, 0),
      { color: rgba(shiftColor(metal, 14)), sample, normal: [0, -1], pickId },
    );
    this._builder.line(lidEast, topSouth, 1.4, {
      color: rgba('#d4d9d5'), sample, normal: [0, -1], pickId,
    });
    this._builder.line(topSouth, topWest, 1.4, {
      color: rgba(metalDark), sample, normal: [0, -1], pickId,
    });
  }

  private _extractCloud(cloud: Cloud, tileW: number, tileH: number): void {
    const center = point(projectIso(cloud.position.x, cloud.position.y, cloud.position.z, tileW, tileH));
    const pickId = this._pickId(cloud);
    const scale = cloud.scale * (tileW / 64);
    const puffs: ReadonlyArray<readonly [number, number, number, number, string]> = [
      [-18, 0, 25, 12, '#c8dff5'],
      [8, -5, 29, 15, '#e8f2fc'],
      [27, 2, 22, 11, '#b8d4ee'],
      [-2, -12, 24, 13, '#f0f6ff'],
    ];
    for (const [x, y, rx, ry, color] of puffs) {
      this._builder.ellipse(
        [center[0] + x * scale, center[1] + y * scale],
        rx * scale,
        ry * scale,
        { color: rgba(color, 0.82), sample: center, normal: [0, -1], pickId },
        14,
      );
    }
  }

  private _extractParticles(system: ParticleSystem, tileW: number, tileH: number): void {
    const pickId = this._pickId(system);
    system.forEachParticle((particle) => {
      const first = this._builder.mark();
      const center = point(projectIso(particle.x, particle.y, particle.z, tileW, tileH));
      const radius = Math.max(0.5, particle.size * (tileW / 32));
      const color = particleColor(particle);
      const spriteSheet = particle.spriteSheet;
      const image = spriteSheet?.image;
      const clip = spriteSheet && particle.spriteClip
        ? spriteSheet.clips.get(particle.spriteClip)
        : undefined;
      const frame = clip?.frames[Math.min(
        clip.frames.length - 1,
        Math.floor(particle.progress * clip.frames.length),
      )];
      let textureUrl: string | undefined;

      if (spriteSheet && image && frame) {
        const height = radius * 2;
        const width = height * (frame.w / frame.h);
        const corners = rotatedQuad(center, width, height, particle.rotation);
        this._builder.texturedQuad(
          corners[0], corners[1], corners[2], corners[3],
          [
            frame.x / image.naturalWidth,
            frame.y / image.naturalHeight,
            (frame.x + frame.w) / image.naturalWidth,
            (frame.y + frame.h) / image.naturalHeight,
          ],
          { color, sample: center, lit: false, pickId },
        );
        textureUrl = spriteSheet.url;
      } else if (particle.shape === 'square') {
        const corners = rotatedQuad(center, radius * 2, radius * 2, particle.rotation);
        this._builder.quad(corners[0], corners[1], corners[2], corners[3], {
          color,
          sample: center,
          lit: false,
          pickId,
        });
      } else {
        this._builder.ellipse(center, radius, radius, {
          color,
          sample: center,
          lit: false,
          pickId,
        }, 10);
      }
      this._recordSegment(first, particleBlend(particle.blend), textureUrl);
    });
  }

  private _extractFloatingText(text: FloatingText, tileW: number, tileH: number): void {
    if (text.alpha <= 0 || !text.text) return;
    const position = projectIso(text.position.x, text.position.y, text.position.z, tileW, tileH);
    this._textOverlays.push({
      id: text.id,
      text: text.text,
      x: position.x,
      y: position.y,
      color: text.color,
      alpha: text.alpha,
      fontSize: text.fontSize,
    });
  }

  private _extractDebug(scene: Scene, options: ExtractOptions): void {
    const { tileW, tileH } = scene;
    if (options.showCollision && scene.collider) {
      for (let row = 0; row < scene.rows; row++) {
        for (let col = 0; col < scene.cols; col++) {
          if (scene.collider.isWalkable(col, row)) continue;
          const top = point(projectIso(col, row, 0, tileW, tileH));
          const right = point(projectIso(col + 1, row, 0, tileW, tileH));
          const bottom = point(projectIso(col + 1, row + 1, 0, tileW, tileH));
          const left = point(projectIso(col, row + 1, 0, tileW, tileH));
          this._builder.quad(top, right, bottom, left, {
            color: [0.9, 0.12, 0.16, 0.28],
            sample: top,
            lit: false,
          });
        }
      }
    }

    if (options.selectedId) {
      const selected = scene.getById(options.selectedId);
      if (selected) this._extractSelectionBounds(selected, tileW, tileH);
    }

    for (const marker of options.debugMarkers ?? []) {
      const center = point(projectIso(marker.x, marker.y, 0, tileW, tileH));
      const pickId = marker.kind === 'target' ? 0 : this._pickExternalId(marker.id);
      const color = rgba(marker.color ?? (marker.kind === 'directional' ? '#f6d46b' : '#ffd080'), 0.9);
      const radius = marker.id === options.selectedId ? 18 : 12;
      if (marker.kind === 'target') {
        this._builder.ellipse(center, 11, 5, {
          color: rgba(marker.color ?? '#8fe8b5', 0.28), sample: center, lit: false,
        }, 18);
        this._builder.quad(
          [center[0], center[1] - 5],
          [center[0] + 9, center[1]],
          [center[0], center[1] + 5],
          [center[0] - 9, center[1]],
          { color, sample: center, lit: false },
        );
      } else if (marker.kind === 'directional') {
        this._builder.quad(
          [center[0], center[1] - radius],
          [center[0] + radius, center[1]],
          [center[0], center[1] + radius],
          [center[0] - radius, center[1]],
          { color, sample: center, lit: false, pickId },
        );
      } else {
        this._builder.ellipse(center, radius, radius, {
          color,
          sample: center,
          lit: false,
          pickId,
        }, 16);
      }
    }
  }

  private _extractSelectionBounds(object: IsoObject, tileW: number, tileH: number): void {
    const bounds = object.aabb;
    const topZ = bounds.maxZ ?? bounds.baseZ + 1;
    const base = [
      point(projectIso(bounds.minX, bounds.minY, bounds.baseZ, tileW, tileH)),
      point(projectIso(bounds.maxX, bounds.minY, bounds.baseZ, tileW, tileH)),
      point(projectIso(bounds.maxX, bounds.maxY, bounds.baseZ, tileW, tileH)),
      point(projectIso(bounds.minX, bounds.maxY, bounds.baseZ, tileW, tileH)),
    ];
    const top = [
      point(projectIso(bounds.minX, bounds.minY, topZ, tileW, tileH)),
      point(projectIso(bounds.maxX, bounds.minY, topZ, tileW, tileH)),
      point(projectIso(bounds.maxX, bounds.maxY, topZ, tileW, tileH)),
      point(projectIso(bounds.minX, bounds.maxY, topZ, tileW, tileH)),
    ];
    const style = {
      color: [0.28, 0.92, 0.66, 0.95] as RenderColor,
      sample: base[0],
      lit: false,
    };
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      this._builder.line(base[i], base[next], 2, style);
      this._builder.line(top[i], top[next], 2, style);
      this._builder.line(base[i], top[i], 2, style);
    }
  }

  private _extractMinimap(scene: Scene): void {
    const cellCount = scene.cols * scene.rows;
    if (this._minimapWalkable.length !== cellCount) {
      this._minimapWalkable = new Uint8Array(cellCount);
    }
    for (let row = 0; row < scene.rows; row++) {
      for (let col = 0; col < scene.cols; col++) {
        this._minimapWalkable[row * scene.cols + col] = scene.collider?.isWalkable(col, row) === false ? 0 : 1;
      }
    }
    for (const object of scene.allObjects) {
      if (!object.visible || object instanceof Floor || object instanceof ParticleSystem || object instanceof FloatingText) continue;
      this._minimapItems.push({
        id: object.id,
        x: object.position.x,
        y: object.position.y,
        character: object instanceof Character,
      });
    }
  }

  private _visibleBounds(scene: Scene, options: ExtractOptions): VisibleBounds {
    const width = options.viewportWidth;
    const height = options.viewportHeight;
    const originX = options.originX ?? width / 2;
    const originY = options.originY ?? Math.min(180, height * 0.24);
    const corners = [
      scene.camera.screenToWorld(0, 0, width, height, scene.tileW, scene.tileH, originX, originY, scene.view),
      scene.camera.screenToWorld(width, 0, width, height, scene.tileW, scene.tileH, originX, originY, scene.view),
      scene.camera.screenToWorld(width, height, width, height, scene.tileW, scene.tileH, originX, originY, scene.view),
      scene.camera.screenToWorld(0, height, width, height, scene.tileW, scene.tileH, originX, originY, scene.view),
    ];
    const margin = 3;
    return {
      minX: Math.min(...corners.map((corner) => corner.x)) - margin,
      minY: Math.min(...corners.map((corner) => corner.y)) - margin,
      maxX: Math.max(...corners.map((corner) => corner.x)) + margin,
      maxY: Math.max(...corners.map((corner) => corner.y)) + margin,
    };
  }

  private _extractDiagnostic(object: IsoObject, tileW: number, tileH: number): void {
    const center = point(projectIso(
      object.position.x,
      object.position.y,
      object.position.z,
      tileW,
      tileH,
    ));
    const pickId = this._pickId(object);
    this._builder.quad(
      [center[0], center[1] - 13],
      [center[0] + 13, center[1]],
      [center[0], center[1] + 13],
      [center[0] - 13, center[1]],
      { color: [1, 0.15, 0.45, 0.9], sample: center, lit: false, pickId },
    );
  }

  private _extractLightHalos(scene: Scene, tileW: number, tileH: number): void {
    for (const light of scene.omniLights) {
      if (light.isGlobal) continue;
      const center = point(projectIso(
        light.position.x,
        light.position.y,
        light.position.z,
        tileW,
        tileH,
      ));
      this._builder.ellipse(center, 12, 12, {
        color: rgba(light.color, Math.min(0.7, light.intensity * 0.5)),
        sample: center,
        lit: false,
        pickId: light.id ? this._pickExternalId(light.id, light) : 0,
      }, 18);
    }
  }

  private _extractLights(scene: Scene, tileW: number, tileH: number): void {
    for (const light of scene.omniLights) {
      const projected = projectIso(
        light.position.x,
        light.position.y,
        light.position.z,
        tileW,
        tileH,
      );
      this._omniLights.push({
        x: projected.x,
        y: projected.y,
        radius: light.radius,
        color: rgb(light.color),
        intensity: light.intensity,
        global: light.isGlobal,
        quadratic: light.falloff === 'quadratic',
      });
    }
    for (const light of scene.dirLights) {
      const direction = light.direction;
      this._directionalLights.push({
        x: direction.dx,
        y: direction.dy,
        color: rgb(light.color),
        intensity: light.intensity * Math.max(0, Math.sin(light.elevation)),
      });
    }
  }

  private _pickId(object: IsoObject): number {
    let id = this._pickIds.get(object);
    if (id === undefined) {
      id = this._nextPickId++;
      if (id > 0xffffff) throw new Error('WebGL picking ID space exhausted.');
      this._pickIds.set(object, id);
    }
    this._pickLookup.set(id, object.id);
    return id;
  }

  private _pickExternalId(id: string, owner?: object): number {
    let pickId = owner ? this._pickIds.get(owner) : this._externalPickIds.get(id);
    if (pickId === undefined) {
      pickId = this._nextPickId++;
      if (pickId > 0xffffff) throw new Error('WebGL picking ID space exhausted.');
      if (owner) this._pickIds.set(owner, pickId);
      else this._externalPickIds.set(id, pickId);
    }
    this._pickLookup.set(pickId, id);
    return pickId;
  }

  private _recordSegment(first: number, blend: RenderBlendMode, textureUrl?: string): void {
    const count = this._builder.vertexCount - first;
    if (count <= 0) return;
    const previous = this._segments[this._segments.length - 1];
    if (
      previous &&
      previous.first + previous.count === first &&
      previous.blend === blend &&
      previous.textureUrl === textureUrl
    ) {
      previous.count += count;
      return;
    }
    this._segments.push({ first, count, blend, ...(textureUrl ? { textureUrl } : {}) });
  }
}

function point(value: { x: number; y: number }): RenderPoint {
  return [value.x, value.y];
}

function rgb(color: string): readonly [number, number, number] {
  const [r, g, b] = hexToRgb(color);
  return [r / 255, g / 255, b / 255];
}

function rgba(color: string, alpha = 1): RenderColor {
  const [r, g, b] = rgb(color);
  return [r, g, b, alpha];
}

function lerpPoint(a: RenderPoint, b: RenderPoint, t: number, lift: number): RenderPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - lift];
}

function particleBlend(blend: ParticleBlend): RenderBlendMode {
  if (blend === ParticleBlend.ADD) return 'add';
  if (blend === ParticleBlend.MULTIPLY) return 'multiply';
  return 'alpha';
}

function particleColor(particle: ParticleRenderState): RenderColor {
  const start = rgb(particle.color);
  const end = particle.colorEnd ? rgb(particle.colorEnd) : start;
  const t = particle.progress;
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
    particle.alpha,
  ];
}

function rotatedQuad(
  center: RenderPoint,
  width: number,
  height: number,
  rotation: number,
): readonly [RenderPoint, RenderPoint, RenderPoint, RenderPoint] {
  const halfW = width / 2;
  const halfH = height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotate = (x: number, y: number): RenderPoint => [
    center[0] + x * cos - y * sin,
    center[1] + x * sin + y * cos,
  ];
  return [
    rotate(-halfW, -halfH),
    rotate(halfW, -halfH),
    rotate(halfW, halfH),
    rotate(-halfW, halfH),
  ];
}

function intersects(object: IsoObject, visible: VisibleBounds): boolean {
  const bounds = object.aabb;
  return bounds.maxX >= visible.minX &&
    bounds.minX <= visible.maxX &&
    bounds.maxY >= visible.minY &&
    bounds.minY <= visible.maxY;
}
