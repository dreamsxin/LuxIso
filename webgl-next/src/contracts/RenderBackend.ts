import type {RenderSnapshot} from './RenderSnapshot';

export interface RenderStats {
  frame: number;
  cpuMs: number;
  /**
   * Visual draw calls only — the floor, shadow mask and composite, the sorted
   * scene, the halos and the debug range. This is the number the performance
   * budget in `ACCEPTANCE.md` is written against.
   */
  drawCalls: number;
  /**
   * The ID-buffer pass, counted separately. It re-draws the sorted scene, the
   * halos and the debug range into an offscreen target every frame, so folding
   * it into `drawCalls` roughly doubled the figure and made it useless against a
   * budget.
   */
  pickingDrawCalls: number;
  /**
   * Triangles submitted in the visual ranges this frame. Excludes the picking
   * pass, and excludes the shadow mask when it is served from cache. Slightly
   * over-reports when a segment's texture has not resolved yet, because that
   * segment is skipped at draw time but still counted here.
   */
  triangles: number;
  /** Vertices in the geometry arena, including ranges not drawn this frame. */
  vertices: number;
  bufferBytes: number;
  omniLights: number;
  segments: number;
  textures: number;
  textOverlays: number;
  unsupportedObjects: number;
  shadowMaskCacheHits: number;
  shadowMaskCacheMisses: number;
  contextLost: boolean;
}

export interface PickResult {
  pickId: number;
  objectId: string;
}

export interface RenderBackend {
  readonly kind: 'webgl2';
  readonly stats: Readonly<RenderStats>;

  resize(cssWidth: number, cssHeight: number, dpr?: number): void;
  render(snapshot: RenderSnapshot): void;
  pick(x: number, y: number): PickResult | null;
  dispose(): void;
}
