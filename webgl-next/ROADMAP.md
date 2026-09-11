# WebGL Next Roadmap

Each phase must leave `main` releasable. Canvas2D is the rollback path until the
final cutover gate.

## Implementation Status (2026-09-12)

| Phase | Status | Remaining gate work |
|---|---|---|
| 0 - Baseline/contracts | Implemented | Benchmark reports; three baselines are committed and pixel-gated |
| 1 - Device/resources | Implemented | Cross-browser/real-GPU restore matrix moves to Phase 5 |
| 2 - Geometry parity | Implemented preview | Golden diff approval and large-scene performance recording |
| 3 - Lighting/shadows | Implemented preview | Six of the nine fixtures still need baselines behind the 1.5% gate |
| 4 - Effects/editor | In progress | Editor move parity screenshots and sprite-editor integration; HUD path and the extractor registry are in |
| 5 - Preview release | Not started | Browser matrix, package checks, and `0.2.0-webgl.0` publication |
| 6 - Default cutover | Not started | Requires two accepted preview iterations |
| 7 - Hardware ray tracing research | Conditional | Standard WebGPU acceleration structures and browser support |

Phase 4's newest consumer is `examples/10-arpg`, a full run on the WebGL2 backend:
a custom `Entity` through `SceneExtractor.register`, `HudLayer` stacked over the GL
canvas by `HudOverlayRenderer`, and pillar cover with a line-of-sight-gated A*
chase. It is deliberately not wired into the pixel-gated fixtures — adding a HUD
to a gated fixture would turn the gate red.

## Phase 0 - Baseline and Contracts

- Capture deterministic reference scenes and screenshots.
- Record CPU frame time, draw cost, allocations, and memory for Canvas2D.
- Define `RenderBackend`, `RenderSnapshot`, primitive records, resource handles,
  and renderer selection in an experimental package.
- Freeze the new world-Z convention and legacy conversion rules.

Exit: contracts compile without WebGL implementation; reference fixtures and
benchmark commands are reproducible.

## Phase 1 - Device and Resource Core

- Create WebGL2 context, capability checks, state cache, shader library, buffer
  arenas, texture registry, resize handling, and context loss/restore.
- Implement clear/composite smoke pass and GPU/CPU frame diagnostics.
- Add a graceful unsupported-browser message and Canvas fallback.

Implemented status: Chromium/SwiftShader automation now forces context loss and
restore, enforces the two-second recovery budget, compares the restored frame,
and preserves fixture/texture state. A repeated create/dispose harness checks
that registered handles reach zero in normal and context-lost disposal paths;
pending image loads are detached when their texture registry is retired.

Exit: context restore works in an automated harness; no leaked GPU resources
after repeated create/dispose cycles.

## Phase 2 - Geometry Parity

- Extract Floor, Wall, Character, Crystal, Boulder, Chest, and Cloud records.
- Implement floor chunks, quad/wall batches, atlas sampling, camera transforms,
  frustum culling, and order-preserving batch segments.
- Run Canvas2D/WebGL side-by-side screenshots for deterministic scenes.

Exit: unlit scenes meet visual-diff and performance gates with zero missing
built-in object types.

## Phase 3 - Lighting and Shadows

- Implement ambient, directional, omni, global light, falloff, shadow mask,
  light accumulation, and composite passes.
- Cache static shadow geometry and invalidate by revisions.
- Match current view rotation/elevation and light halo behavior.

Preview status: omni and directional lights now project caster silhouettes from
the same AABB/world-Z contract used by Canvas2D, and moving lights/casters update
the shadow geometry every frame. Static analytic projections are cached per
caster/light pair with automatic input-based invalidation. The renderer now
builds a dedicated GPU shadow mask, caches it by shadow geometry/camera/target
signature, and composites it after the floor pass. The full camera/light matrix
now exposes nine deterministic URL-selectable cases covering four rotations,
low/top elevation, night, global-only, and disabled lights. Golden screenshot
candidate capture runs all cases in fixed Chromium/SwiftShader, checks nonblank
pixels and exact cross-frame stability, and uploads CI artifacts. Baseline
approval and the 1.5% diff gate remain open.

Exit: lighting fixtures pass tolerance at all supported camera views; moving a
caster/light cannot leave stale shadows.

## Phase 4 - Effects and Editor

- Add particles, floating text bridge, blend modes, sprites, animation frame
  selection, minimap source data, and debug overlays.
- Add ID-buffer picking, editor backend toggle, and selection parity tests.
- Keep editor panels and accessibility-sensitive controls in DOM.

Preview status: the WebGL fixture now exercises fixed-step, collision-aware A*
movement from playfield clicks while preserving GPU picking for interactive
objects. Editor move parity across all fixtures remains open.

Exit: the demo, editor, and every example load with WebGL2; editor place/select/
delete/import/export flows pass.

## Phase 5 - Preview Release

- Publish `0.2.0-webgl.0` with Canvas2D default and opt-in WebGL2.
- Run browser matrix, long-session memory test, resize/DPR test, context-loss
  test, and package declaration checks.
- Document custom object migration from `draw(ctx)` to render primitives.

Exit: no severity-1 parity defects; fallback telemetry and diagnostics are
actionable.

## Phase 6 - Default Cutover

- Make WebGL2 the default after two preview iterations meet acceptance gates.
- Retain `renderer: 'canvas2d'` for compatibility.
- Deprecate direct Canvas draw extensions with a versioned removal plan.

Exit: all acceptance gates pass on release CI and representative integrated
projects.

## Phase 7 - Hardware Ray Tracing Research (Conditional)

This is intentionally outside the `0.2.0-webgl` release path. WebGL2 exposes no
ray-tracing acceleration structures. The current [W3C WebGPU
specification](https://www.w3.org/TR/webgpu/) exposes compute passes but no
standard ray-tracing pipeline or acceleration-structure API; the GPUWeb [ray
tracing extension issue](https://github.com/gpuweb/gpuweb/issues/535) remains an
open `Milestone 4+` item. Native Vulkan does define [acceleration structures and
ray-tracing pipelines](https://github.com/KhronosGroup/Vulkan-Docs/blob/main/chapters/raytracing.adoc),
which proves the hardware path but not portable browser availability.

- Introduce a WebGPU backend only after the renderer-neutral snapshot and pass
  contracts survive the WebGL2 preview.
- Prototype hybrid ray-traced shadows/reflections only when a standardized
  browser API can target hardware acceleration structures.
- Keep raster shadows as the required fallback and never label a WGSL compute
  path tracer as hardware ray tracing.
- Gate any native Vulkan/DXR shell experiment behind a separate package so the
  browser engine and scene format remain portable.

Exit: one hardware-accelerated adapter runs on two browser engines or an
explicitly scoped native preview, reports acceleration-structure capability,
passes raster fallback parity, and demonstrates a measured quality/performance
gain on the reference scene.

## Work Order

1. Contracts and deterministic fixtures.
2. Device/resource lifecycle before object shaders.
3. Unlit geometry before lighting.
4. Built-in parity before custom extension APIs.
5. Editor picking after stable object IDs.
6. Optimization only after pass-level profiling.
7. Hardware ray tracing only after standardized WebGPU support or an explicitly
   approved native-only product scope.

Do not start with a monolithic shader, a renderer-owned scene graph, or a full
asset conversion. Those approaches erase rollback points and mix migration risk.
