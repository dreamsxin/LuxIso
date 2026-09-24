import {IsoVec3, IsoView} from '../math/IsoProjection';
import {OmniLight} from '../lighting/OmniLight';
import {DirectionalLight} from '../lighting/DirectionalLight';
import {AABB} from '../math/depthSort';

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  tileW: number;
  tileH: number;
  originX: number;
  originY: number;
  omniLights: OmniLight[];
  dirLights: DirectionalLight[];
  /**
   * Scene-level ambient light as a pre-multiplied RGB triple [r, g, b] in 0–1.
   */
  ambientRgb: [number, number, number];
  /**
   * Current isometric view parameters (rotation + elevation).
   * Pass to project() for correct rendering under non-default views.
   */
  view: IsoView;
}

/**
 * IsoObject — base class for all entities rendered in the isometric scene.
 * Provides a position and requires an AABB for depth sorting.
 */
export abstract class IsoObject {
  id: string;
  position: IsoVec3;

  /**
   * When set to a positive number, ShadowCaster uses a circular footprint
   * (radius in world units) instead of the rectangular AABB for shadow projection.
   * Ideal for spheres, cylinders, and other round objects.
   * Default undefined = use AABB rectangle.
   */
  shadowRadius?: number;

  /**
   * Set to false to opt out of the ShadowCaster system entirely.
   * Use this when the object draws its own shadow in draw().
   * Default false — objects must explicitly opt in to system shadow casting.
   * Set to true (with optional shadowRadius) for objects that want ground shadows.
   */
  castsShadow: boolean = false;

  /**
   * When false, the object is skipped during draw() and update().
   * Default true.
   */
  visible: boolean = true;

  /**
   * Mark this object as a "ground layer" — a large flat terrain surface
   * (e.g. a custom rock/lava tilemap) that should be drawn on top of the
   * floor lightmap but below all 3-D objects.
   *
   * Ground-layer objects are drawn in addObject() order and do NOT
   * participate in topoSort, avoiding spurious depth-sort cycles with
   * other ground-covering objects.
   *
   * Default false.  Set to true in objects like RockLayer or LavaRiver
   * that cover the entire map at z ≈ 0.
   */
  isGroundLayer: boolean = false;

  constructor(id: string, x: number, y: number, z: number) {
    this.id = id;
    this.position = {x, y, z};
  }

  /** World-space axis-aligned bounding box used for depth sorting. */
  abstract get aabb(): AABB;

  abstract draw(dc: DrawContext): void;
}
