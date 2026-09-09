export type { PickResult, RenderBackend, RenderStats } from './contracts/RenderBackend';
export type { GLResourceCounts } from './device/GLResourceRegistry';
export type {
  RenderCamera,
  RenderDirectionalLight,
  RenderEnvironment,
  RenderGeometry,
  RenderOmniLight,
  RenderSnapshot,
} from './contracts/RenderSnapshot';
export { SceneExtractor } from './extraction/SceneExtractor';
export { projectIso } from './extraction/projection';
export { clipShadowHullToScene, projectDirectionalShadow, projectOmniShadow } from './extraction/ShadowProjector';
export type { ProjectedShadow, ShadowPoint } from './extraction/ShadowProjector';
export { ShadowProjectionCache } from './extraction/ShadowProjectionCache';
export type { ShadowCacheStats } from './extraction/ShadowProjectionCache';
export { DomOverlayRenderer } from './overlays/DomOverlayRenderer';
export { MinimapRenderer } from './overlays/MinimapRenderer';
export { renderPointToScreen } from './overlays/cameraTransform';
export { WebGLRenderer, WebGLUnavailableError } from './renderer/WebGLRenderer';
export { computeShadowMaskCacheKey } from './renderer/ShadowMaskCacheKey';
export {
  applyPreviewLightingFixture,
  DEFAULT_PREVIEW_LIGHTING_FIXTURE_ID,
  getPreviewLightingFixture,
  PREVIEW_LIGHTING_FIXTURES,
} from './testing/PreviewLightingFixtures';
export type {
  PreviewDirectionalLightFixture,
  PreviewLightingFixture,
  PreviewOmniLightFixture,
} from './testing/PreviewLightingFixtures';
