import type {RenderSnapshot} from './RenderSnapshot';

export interface RenderStats {
  frame: number;
  cpuMs: number;
  drawCalls: number;
  triangles: number;
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
