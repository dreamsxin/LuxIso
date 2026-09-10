# LuxIso WebGL Next

`webgl-next/` defines the `0.2.0-webgl` preview line. It is a renderer migration,
not a rewrite of gameplay, ECS, physics, pathfinding, input, or scene data.

## Decision

Use a focused WebGL2 renderer written in TypeScript. LuxIso is renderer-first:
its isometric occlusion graph, multi-pass lighting, shadow projection, editor
picking, and batching rules are the product. A general 2D or 3D engine would
hide the exact boundaries this migration needs to control.

Canvas2D remains available as a compatibility and visual-reference backend
during the preview cycle.

```text
Scene / ECS / physics / animation / input / serialization
                         |
                  RenderSnapshot
                    /         \
          Canvas2DRenderer   WebGLRenderer
             reference       new default after parity
```

## Goals

- Preserve the existing Scene, Entity, Component, System, EventBus, collider,
  pathfinding, and JSON contracts wherever possible.
- Replace immediate `draw(ctx)` calls with renderer-neutral render records.
- Batch floor tiles, walls, sprites, props, particles, and light data on GPU.
- Move lightmap, shadow, composition, and picking into explicit render passes.
- Resolve the legacy dual-Z convention at the new renderer boundary.
- Keep menus, settings, and text-heavy editor UI in DOM.
- Ship a Canvas2D fallback until WebGL parity and browser gates pass.

## Non-goals

- Converting LuxIso into a fully 3D engine.
- Moving simulation state into a WebGL scene graph.
- Replacing TileCollider, Pathfinder, ECS, or SceneManager.
- Shipping editor-authored GLB content in the first preview.
- Adding WebGPU before the WebGL2 resource and render contracts stabilize.

## Documents

- [ARCHITECTURE.md](./ARCHITECTURE.md): ownership, modules, render graph, data
  contracts, coordinates, assets, and lifecycle.
- [ROADMAP.md](./ROADMAP.md): incremental migration phases and rollback points.
- [ACCEPTANCE.md](./ACCEPTANCE.md): visual, performance, browser, API, and release
  gates.

## Implemented Preview Slice

The current preview implements the first runnable Phase 0-4 slice:

- renderer-neutral `RenderSnapshot` contracts and a reusable numeric geometry arena;
- extraction for Floor, Wall openings, Character, Crystal, Boulder, Chest, Tree, FlowerPatch, Lantern, and Cloud;
- canonical world-Z conversion at the extraction boundary;
- WebGL2 resource lifecycle, dynamic batching, GPU ambient/directional/omni lighting;
- analytic ground-plane ray projection for moving omni/directional lights and moving casters;
- static caster/light projection caching with automatic invalidation and live hit/miss diagnostics;
- a dedicated GPU shadow-mask framebuffer with signature-based static-frame reuse;
- contact shadows, transparent cloud/light layers, and 24-bit GPU ID picking;
- context loss/restore handling, capability reporting, and live render diagnostics;
- lazy texture resources, sprite-sheet frame UVs, floor textures, and ordered draw segments;
- alpha/add/multiply particles, DOM floating-text bridge, minimap source data, and debug overlays;
- camera frustum extraction for floor tiles and world objects;
- an editor Canvas/WebGL toggle with ID-buffer selection and Canvas input fallback;
- WebGL, side-by-side comparison, and Canvas2D fallback modes at `/webgl-next/`.
- a polished lantern-garden fixture covering compact foliage, deterministic flowers,
  warm practical lights, and seam-free multi-face crystal geometry.
- fixed-step A* click movement with collision-aware waypoints and a renderer-neutral target marker.
- a deterministic nine-case camera/light fixture matrix for golden screenshot capture.
- Playwright/Chromium fixture capture with nonblank pixel checks, exact static-frame checks,
  GPU metadata, and CI-uploaded golden candidates.
- forced context-loss/restore coverage plus repeated renderer create/dispose resource checks.

The shadow implementation traces the analytic rays needed to project each 2D
occluder onto the ground plane. It is not hardware path tracing; WebGL2 remains
a raster renderer with explicit light, shadow, and composition stages.

All-example WebGL adapters, golden-image CI, forced
context-loss automation, package publication, and the browser release matrix
remain on the later roadmap phases. Unsupported custom objects render as visible
diagnostics and are reported in the preview metrics.

True hardware ray tracing is recorded as a conditional post-WebGL research
phase. WebGL2 cannot expose RT acceleration structures, and current standard
WebGPU does not yet define them. LuxIso will retain raster projected shadows as
the portable path and will not market compute-shader path tracing as hardware
ray tracing. See [Phase 7](./ROADMAP.md#phase-7---hardware-ray-tracing-research-conditional)
for the capability gates and primary specification links.

Run the preview with `npm run dev`, then open `/webgl-next/`. Golden inputs use
`/webgl-next/?fixture=<id>`; for example, `day-ne`, `night-lanterns`,
`global-only`, or `lights-off`. A fixed fixture pauses scene simulation and
light orbiting until the user interacts with the scene or changes a camera or
light control.

Run `npx playwright install chromium` once, then `npm run test:webgl` to execute
all nine fixtures and two lifecycle tests at 1280×720, DPR 1, using
Chromium/SwiftShader. Context captures (`<fixture>-viewport.png`, framing the
enclosing `#viewport`) and JSON metadata are written under
`test-results/webgl-next/`; CI keeps them as a 14-day artifact for review. They
are review context only — the pixel-diff gate compares `<fixture>.png` baselines
in `webgl-next/e2e/__screenshots__/`, which frame `#webgl-canvas` and are
produced solely by the `webgl-baselines` workflow.

Both are element screenshots, i.e. the composited page cropped to the element's
box — not the canvas backing store. The `WebGL 2` label, the minimap canvas and
the DOM text overlays sit over `#webgl-canvas`, so they appear inside the
baseline too, and the gate covers the DOM overlay bridge as well as the GL
render. Judge a baseline by its framing, not by whether overlays are present.

The lifecycle suite forces `WEBGL_lose_context`, requires restoration within two
seconds, verifies that fixture state and the rendered frame survive restoration,
and checks registered resource counts after normal and context-lost disposal.

## Versioning

- Preview package/version: `0.2.0-webgl.x`.
- Canvas2D remains the default in early previews.
- WebGL2 becomes default only after the parity gate.
- Breaking removal of the legacy Canvas `draw()` extension API is reserved for
  a later major release; preview builds provide an adapter and migration warning.
