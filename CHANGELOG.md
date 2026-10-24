# Changelog

All notable changes to LuxIso are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-10-24

First public release: a 2D isometric rendering engine for the browser —
TypeScript, Canvas 2D, dynamic lighting, ECS, and a scene editor. Zero runtime
dependencies.

### Core

- `Engine`: requestAnimationFrame loop with a fixed 1/60 simulation step
  (explicit per-frame step cap plus a `deferredFixedSteps` counter), a single
  `FrameClock` frame-delta contract shared by every consumer, automatic
  page-visibility pause, device-pixel-ratio-aware rendering with the
  logical-CSS-pixel contract, and JSON scene loading with prop/light registries.
- `Scene` / `SceneRenderer` / `SceneSerializer`: frustum culling, topological
  depth sorting with spatial buckets, lightmap caching, analytic shadows, and
  a versioned (`formatVersion`) save format with forward-version rejection via
  `SceneSerializer.checkVersion`.
- `SceneManager`: a transactional named-scene stack — build-before-swap with
  rollback on failure, and release-after-commit asset handling.
- `Camera`, `ClickMover`, `Minimap`, `SceneTransition`, `DebugRenderer`,
  `HudLayer` (touch-aware buttons/bars/labels with per-contact press
  arbitration), `ObjectPool`, `AssetLoader`.

### ECS

- Entities with constructor-keyed component maps; batch `System` queries with
  priorities and attach/detach lifecycle; an `EventMap`-typed `EventBus` with
  unsubscribe handles, `once`, and scoped subscription bags (`bus.bag()`).
- Built-in components: `HealthComponent`, `MovementComponent`
  (collision-resolved, path-driven), `AnimationComponent`, `TimerComponent`,
  `TweenComponent` / `TweenSequence`, `TriggerZoneComponent`.

### Elements, lighting, animation, physics, audio

- `Floor`, `Wall` (with openings), `Character` (sphere or sprite), plus
  `Crystal`, `Boulder`, `Chest`, `Tree`, `FlowerPatch`, `Lantern`, `Cloud`,
  and `FloatingText`.
- Omni and directional lights with RGB accumulation, falloff, and projected
  shadows; a lightmap cache for floors.
- Sprite sheets, an 8-direction `DirectionalAnimator` with clip fallback
  chains and `buildSheet`, and a preset-driven `ParticleSystem`.
- `TileCollider` (footprint + swept movement), `Pathfinder` (8-direction A*,
  line-of-sight string pulling, per-scene `PathCache`).
- `AudioManager`: master/sfx/bgm buses, gesture-based autoplay unlock, page
  lifecycle suspend/resume, spatial SFX through `PannerNode`, request-token
  BGM crossfades.
- Input: raw keyboard/mouse/multi-touch state, an action `InputMap` with
  analog axis composition, and the on-screen `TouchStick`.

### Tooling and documentation

- 1,188 unit tests (Vitest) with per-module coverage ratchets; an 11-test
  Playwright WebGL fixture and lifecycle suite with committed pixel-gate
  baselines; ESLint flat config; source-encoding and workflow-lint gates.
- `docs/DESIGN.md` — the framework design baseline (layering, contracts,
  extension registries, gap analysis) — and `docs/REFERENCES.md`, a curated
  collection of verified game-framework design references.
- WebGL2 preview (`webgl-next/`) renders the same scenes from a
  renderer-neutral `RenderSnapshot`; it is a repository-level preview and is
  not part of the npm bundle.

[0.1.0]: https://github.com/dreamsxin/LuxIso/releases/tag/v0.1.0
