# WebGL Next Architecture

## Ownership Rules

1. Simulation owns authoritative state: entities, components, timers, health,
   collision, pathfinding, progression, and serializable values.
2. The renderer owns GPU resources, render passes, animation presentation,
   camera matrices, picking buffers, and diagnostics.
3. `RenderSnapshot` is the only simulation-to-render bridge. Renderer objects
   never become save data or gameplay truth.
4. Input remains action-based. DOM/editor controls and playfield pointer events
   map to actions before changing simulation state.
5. Text-heavy HUD, menus, settings, and accessible controls remain DOM overlays.

## Module Shape

```text
webgl-next/src/
  contracts/
    RenderBackend.ts
    RenderSnapshot.ts
  extraction/
    SceneExtractor.ts
    GeometryBuilder.ts
    projection.ts
    ShadowProjector.ts
    ShadowProjectionCache.ts
  device/
    GLResourceRegistry.ts
  resources/
    TextureRegistry.ts
  renderer/
    WebGLRenderer.ts
    ShadowMaskCacheKey.ts
    shaders.ts
  overlays/
    DomOverlayRenderer.ts
    MinimapRenderer.ts
    cameraTransform.ts
  editor/
    EditorWebGLPreview.ts
  testing/
    PreviewLightingFixtures.ts

webgl-next/e2e/
  fixtures.pw.ts
```

This is the implemented preview shape, not a proposed package tree. Passes are
currently explicit methods inside `WebGLRenderer`; they can move into separate
modules after profiling shows a maintenance or reuse benefit. The eventual
production code may live under `src/render/`; this directory keeps the preview
isolated until its contracts are proven.

## Public Boundary

```ts
interface RenderBackend {
  readonly kind: 'webgl2';
  readonly stats: Readonly<RenderStats>;
  resize(cssWidth: number, cssHeight: number, dpr?: number): void;
  render(snapshot: RenderSnapshot): void;
  pick(x: number, y: number): PickResult | null;
  dispose(): void;
}

interface RenderSnapshot {
  frame: number;
  tileW: number;
  tileH: number;
  camera: RenderCamera;
  environment: RenderEnvironment;
  geometry: RenderGeometry;
  omniLights: RenderOmniLight[];
  directionalLights: RenderDirectionalLight[];
  textOverlays: RenderTextOverlay[];
  minimap: RenderMinimapSource;
  pickLookup: ReadonlyMap<number, string>;
  unsupported: UnsupportedRenderObject[];
}
```

`RenderGeometry` owns one reusable interleaved `Float32Array` arena plus ordered
ranges for floor, shadows, opaque, transparent, and debug geometry. Extraction
writes renderer-neutral numeric records; Scene/ECS state never stores WebGL
handles.

## Coordinate Convention

- X and Y: world tile units.
- Z: world vertical units, where one Z unit equals `tileH / 2` projected pixels
  at zoom 1 and default elevation.
- Projection scale belongs to the camera/view, not individual objects.
- GPU uses camera-relative coordinates to reduce precision loss on large maps.
- Z is screen pixels everywhere — `position.z`, AABB `baseZ`/`maxZ` and
  `projectIso` all share one unit, so extraction needs no conversion step.

This is the migration point for removing the dual-Z public contract without
changing serialized legacy scenes immediately.

## Render Graph

```text
Scene extraction + frustum cull
              |
      depth constraints / buckets
              |
  floor pass -> shadow mask ----+
              light accumulation |
                    |             |
opaque batches -> composite <-----+
                    |
       transparent / particles
                    |
          picking + debug overlays
```

### Pass Policy

- Floor: instanced diamonds or chunk meshes, atlas-indexed materials.
- Opaque: depth-sorted batches. Preserve LuxIso graph ordering where overlapping
  AABBs require it; batch only within compatible order segments.
- Shadows: project caster geometry into a white mask render target, multiply
  overlapping attenuation, and composite after the floor. Cache static caster
  projections by object/light inputs and cache the GPU mask by geometry,
  camera, viewport, and render-target signature.
- Lights: pack directional and omni lights into uniforms initially; move to a
  texture buffer only when limits require it.
- Composite: combine albedo, ambient, light accumulation, and shadow mask.
- Transparent: particles, halos, clouds, and floating effects after opaque
  composition with explicit blend modes.
- Picking: render stable 24-bit object IDs into a small on-demand framebuffer;
  editor selection never depends on color-visible pixels.

## Resource Lifecycle

- `GLResourceRegistry` owns buffers, programs, framebuffers, textures, and VAOs
  created by the renderer; `TextureRegistry` owns lazy image-backed textures.
- Texture URLs are extraction records, not Scene/ECS GPU handles.
- The renderer exposes explicit `dispose()` and rebuilds registered resources
  after context restore.
- Context loss abandons invalid GPU handles, detaches outstanding image callbacks,
  and keeps simulation/snapshot ownership outside the renderer.
- Context loss stops submission but not simulation. Context restore recreates
  resources from registered recreate callbacks and CPU-side descriptors.
- Resize recreates size-dependent targets only.
- Shader compilation failures include source key and mapped line diagnostics.

## Assets

The preview currently receives image URLs from extracted sprite/floor records
and loads them lazily through `TextureRegistry`. The manifest layout below is
the target packaging policy for the preview release, not an existing runtime
requirement:

```text
assets/manifest.json
  environment/*
  characters/*
  props/*
  fx/*
  ui/*
  audio/*
```

- 2D content uses atlas keys with PNG/WebP sources and metadata.
- Color space, premultiplication, filtering, wrap mode, and mip policy are
  declared in the manifest.
- Optional future 3D props use GLB/glTF 2.0 with consistent pivots, meters-to-
  world-unit scale, compressed textures, collision proxies, and LOD metadata.
- Raw authoring assets are never loaded directly by runtime code.

## Input, UI, Save, and Debug

- Existing `InputMap` remains the physical-input-to-action boundary.
- WebGL playfield receives pointer coordinates; picking resolves object IDs;
  game/editor commands remain outside renderer callbacks.
- Save data continues to use Scene/ECS serialization, never GPU handles.
- Debug UI reads `RenderStats` in DOM or the existing HUD layer.
- Required probes: CPU extraction, graph sort, upload bytes, draw calls, batch
  breaks, GPU pass timings, texture memory, and context-loss count.

## Compatibility Strategy

- Adding renderer selection to `Engine` remains a preview-release task; the
  current public `Engine` still owns a Canvas2D context.
- WebGL2 consumes `RenderSnapshot`; the current Canvas2D comparison path still
  calls `Scene.draw()` directly as the visual reference. Unifying backend
  selection without changing Scene ownership remains Phase 5/6 work.
- Built-in objects implement extraction first; custom `draw(ctx)` objects use a
  compatibility surface or remain Canvas-only with a clear diagnostic.
- Scene JSON remains renderer-neutral.
- The editor and standalone preview can switch between WebGL2 and Canvas2D for
  A/B comparison without changing serialized scene state.
