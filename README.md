# LuxIso

A 2D isometric rendering engine built with **TypeScript** and **Canvas 2D**, featuring dynamic lighting, shadow casting, occlusion sorting, a full ECS component system, particle effects, spatial audio, a visual scene editor, and a sprite sheet editor.

## WebGL Next Preview

The opt-in WebGL2 renderer now runs the same Scene, ECS, collision, pathfinding,
lighting, and shadow data as the Canvas2D backend.

![LuxIso WebGL2 lantern garden with dynamic lighting, projected shadows, and live diagnostics](docs/images/webgl-next-lantern-garden.png)

| Collision-aware click movement | WebGL2 / Canvas2D comparison |
|---|---|
| ![A character following an A-star path toward a highlighted floor target](docs/images/webgl-next-click-movement.png) | ![The same lantern garden rendered side by side with WebGL2 and Canvas2D](docs/images/webgl-next-renderer-comparison.png) |

See the [WebGL Next plan](webgl-next/README.md) and run `npm run dev` to open
`/webgl-next/`. Deterministic review URLs use
`/webgl-next/?fixture=night-lanterns` (or another fixture ID listed in the
[acceptance matrix](webgl-next/ACCEPTANCE.md)).

WebGL2 is currently an isolated preview, not yet an `Engine` constructor option.
Application code should continue using the Canvas2D `Engine` API until the
`0.2.0-webgl` package exposes the renderer selector.

### Rendering your own object types on the WebGL path

Built-in types are dispatched by a hardcoded `instanceof` chain. Anything else
used to become a magenta diagnostic diamond with no way to opt in, which made
every custom `IsoObject` subclass unrenderable there. Register an extractor
instead:

```ts
import { SceneExtractor } from 'luxiso/webgl-next/extraction/SceneExtractor';

SceneExtractor.register(LavaRiver, (river, ctx) => {
  const a = ctx.project(river.position.x, river.position.y);
  const b = ctx.project(river.endX, river.endY);
  ctx.builder.quad(a, [b[0], a[1]], b, [a[0], b[1]], {
    color: [1, 0.35, 0.1, 1], sample: a, lit: false, pickId: ctx.pickId,
  });
  return '/atlas/lava.png';   // optional: puts the geometry in a textured segment
});
```

`ctx` carries `builder`, `tileW`, `tileH`, `pickId`, and the same `project()` the
built-ins use. Later registrations win, so a subclass can override a base class
without unregistering it. An extractor that throws or emits no geometry falls
back to the diagnostic marker and is listed in `snapshot.unsupported` — one
broken object cannot take down the frame. `unregister(Ctor)` and
`clearExtractors()` complete the API.


## Features

- **Isometric math** — `project()` / `unproject()` / `depthKey()` / `drawIsoCube()`; internal (X, Y, Z) space → screen
- **Topological depth sort** — 3-D AABB graph with spatial buckets, min-heap Kahn queue, containment detection, and `maxZ` vertical extent
- **OmniLight** — RGB point light, per-channel accumulation, distance falloff, `illuminateAt()`; linear or quadratic falloff; `isGlobal` for ambient sky light; `enabled` toggle
- **DirectionalLight** — face-normal dot product; angle/elevation; per-channel color mix; `enabled` toggle
- **Lightmap cache** — `OffscreenCanvas` floor cache; auto-invalidates on light/camera change
- **Shadow casting** — `ShadowCaster` projects object silhouettes onto z=0 plane; circular footprint via `shadowRadius`; opt-in via `castsShadow = true`
- **Floor tile cache** — per-tile illumination color cached by lighting key; skips recomputation on static scenes; `invalidateCache()` for manual reset
- **Tile materials** — procedural color or `tileImage` texture; light multiply + screen blend
- **Wall openings** — door/window parallelogram clipping on wall faces
- **IsoView** — `scene.view` rotation + elevation; `scene.transitionView()` smooth animated transitions
- **Camera** — follow, pan, zoom, world-bounds clamping; frame-rate-independent lerp; `applyTransform()` fully wired into `Scene.draw()`
- **Input** — `InputManager`; keyboard, mouse and **multi-touch**; `pointer` is the primary contact, `touches` is the full list (two-thumb layouts); mouse buttons bind as `MouseLeft` / `MouseMiddle` / `MouseRight`; releases everything on blur or tab-hide; suppresses browser touch gestures by default
- **Analog input** — `TouchStick` on-screen stick (deadzone, dynamic origin, claims one contact by id); `InputMap.addAxisSource()` feeds any analog producer into `axis()`, which `ClickMover` already honours
- **ClickMover** — click-to-move + keyboard movement helper; animated marker; collision-aware; frame-rate-independent (`speed` calibrated at 60 FPS)
- **Sprite animation** — `SpriteSheet` + `AnimationController` (idle/walk state machine, 8-direction, `playOnce()` overrides the clip's own `loop` flag)
- **Directional animator** — `DirectionalAnimator`; clip naming `action_DIR`; fallback chain; `playOnce()`
- **Particle system** — `ParticleSystem`; procedural circle/square + sprite mode; blend modes; preset factories: sparkBurst, dustPuff, crystalShatter, coinSpill, ambientDrift, plus the `FIRE` / `SMOKE` emitter configs
- **Tile collision** — `TileCollider` walkable grid; AABB slide-and-clamp; `sweepMove()` binary search with fast-path; `MovementComponent.nudge(dx,dy)` collision-resolved directional move
- **A\* Pathfinder** — 8-directional, corner-cut prevention, Bresenham LoS string-pull, min-heap O(log n); instance-level `PathCache` (per-scene, zero cross-scene pollution); `cache.invalidate()`; `Pathfinder.hasLineOfSight()` for chase AI that only pays for A* behind cover
- **ECS** — constructor-keyed components plus priority-ordered `System` queries with variable and fixed-rate updates
- **EventBus** — `EventBus<EventMap>` couples event names to payload types; typed built-ins and custom events; `globalBus` singleton
- **Components** — `HealthComponent` (unified EventBus emit on damage/death), `MovementComponent` (nudge + A* pathTo), `TimerComponent`, `TweenComponent` (8 easings, yoyo, repeat), `TweenSequence` (chained tweens), `TriggerZoneComponent` (zero per-frame GC)
- **Props** — `Crystal`, `Boulder`, `Chest`, `Tree`, `FlowerPatch`, `Lantern`, `Cloud`, `FloatingText`; canvas-drawn, ECS-powered
- **Audio** — `AudioManager`; one-shot SFX, looping BGM with crossfade, spatial distance attenuation, 3-bus volume (master/sfx/bgm)
- **JSON scene loader** — `SceneSerializer` + `engine.loadScene()` round-trip scene environment, camera, lights, built-in objects, and collision map
- **Scene validator** — `validateSceneJson()`; runtime JSON schema check + ECS component assertions; duplicate-id detection; unknown types warn unless you declare the accepted set
- **Scene editor** — visual editor (`editor.ts`); undo/redo, walkable/blocked drag-paint, object list, property panel, JSON export/import; right-click delete; DirectionalLight placement; keyboard shortcuts (`V/W/L/D/C/1/2/3/B/P`); `camera.screenToWorld` for zoom/pan-accurate picking
- **Sprite editor** — sprite sheet frame inspector and animation clip builder (`sprite-editor.ts`); 8-direction live preview (cached `Map<Direction,DirCell>`); `anchorY` control; click-frame inspection with action/dir hint; JSON export + import; data URL upload support
- **AssetLoader** — instanceable image preloader; per-scene isolation; `unload(url)`; `size` getter; `register(url, img)` for data-URL injection (sprite editor); static API delegates to `AssetLoader.default` (backwards-compatible)
- **PathCache** — per-scene A* result cache; `new PathCache(capacity)`; `invalidate()`; pass to `Pathfinder.find()` or to `MovementComponent({ pathCache })` for zero cross-scene pollution
- **Lib build** — `npm run build:lib` → ESM + CJS dual output plus `dist/types`

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5 (strict) |
| Renderer | Canvas 2D default; opt-in WebGL2 preview |
| Build | Vite 8 |
| Library runtime | ES2020 |
| Tests | Vitest 4 + Playwright 1.62 (Node ≥ 22) |

## Installation

```bash
npm install luxiso
```

## Run The Demos

Clone the repository, then run:

```bash
npm install
npm run dev        # http://localhost:5173 — interactive demo
npm run build      # production build → dist/
npm run build:lib  # library bundle → dist/luxiso.mjs + luxiso.cjs + types
npm test           # run the Vitest suite (requires Node ≥ 22)
npm run test:coverage   # same suite + v8 coverage; enforces the thresholds below
npm run encoding:check  # verify source file encodings (runs before both builds)
npm run encoding:fix    # rewrite offending files in place
npx playwright install chromium  # one-time browser install
npm run test:webgl # builds, then runs 9 deterministic captures + lifecycle tests
                   # against `vite preview` (the production bundle)
```

## Testing

| Layer | Command | Scope |
|---|---|---|
| Unit | `npm test` | 1044 tests across 78 files (Vitest 4) |
| Coverage | `npm run test:coverage` | v8 provider + per-module ratchets |
| Workflows | `npm run lint:workflows` | GitHub Actions YAML: unquoted colons, tab indentation, `run:` expression injection |
| Browser | `npm run test:webgl` | 9 fixture captures + 2 context-lifecycle tests (Chromium/SwiftShader) against the built bundle |

Coverage thresholds live in `vitest.config.ts` and are deliberately set just
**below** current numbers, so they act as ratchets rather than aspirations.
Correctness-critical modules carry their own floors:

| Module | Statements | Branches |
|---|---:|---:|
| `src/math/**` | 90% | 88% |
| `src/physics/**` | 90% | 85% |
| `src/lighting/**` | 90% | 84% |
| `src/ecs/**` | 92% | 88% |
| `src/audio/**` | 94% | 84% |
| `src/animation/**` | 88% | 80% |
| `src/core/**` | 95% | 84% |
| `src/time/**` | 100% | 100% |
| `src/elements/**` | 94% | 80% |
| `webgl-next/src/resources/**` | 94% | 84% |
| `webgl-next/src/device/**` | 100% | 100% |
| Whole project | 84.6% | 78.1% |

Raise a floor when you add tests; never lower one to make a build pass. Test
count is not coverage — every P0/P1 defect found in the last audit sat in a
branch that no test reached, not in a module with a low overall percentage.

### The frame-delta contract

Anything that derives its own `dt` from a timestamp uses `FrameClock`, and
`src/__tests__/FrameDeltaContract.test.ts` asserts the contract through every
consumer in one table:

1. **A timestamp of 0 is an ordinary first frame.** The baseline is `null`, never
   `0` — `Engine`'s first tick really does hand out `0`, so a `_lastTs === 0`
   sentinel never disarms and the frame after it is silently wrong. This exact bug
   was found and fixed twelve times before the clock existed.
2. **Time going backwards yields 0, never a negative delta.**
3. **A long gap is clamped, not integrated** — `FrameClock.MOTION_MAX_DT` (0.1 s)
   for anything that moves, `TIMELINE_MAX_DT` (0.5 s) for timers and tweens.
4. **A non-finite timestamp yields 0 and never becomes the baseline.** A `NaN`
   baseline is unrecoverable: every later delta is `NaN` too.

```ts
import { FrameClock } from 'luxiso';

class Drifter extends IsoObject {
  private _clock = new FrameClock();               // TIMELINE_MAX_DT for timers

  update(ts?: number): void {
    const dt = this._clock.sample(ts ?? performance.now());
    this.position.x += this.speed * dt;
  }

  onPause(): void { this._clock.reset(); }         // do not credit paused time
}
```

Hand-writing the derivation is the thing to avoid: eleven per-module regression
tests did not stop the twelfth occurrence, because a per-module test cannot fail
for a module nobody has written yet. Use the clock, and add the consumer to that
test's `CASES` list. `DebugRenderer` is the one deliberate exception — its FPS
meter wants raw, unclamped millisecond deltas.

`src/main.ts` and the two editor entry points are excluded: they are DOM-driven
and covered by the browser suite and by hand, so counting them would only dilute
the signal.


## Demo Controls

`src/main.ts` loads `public/scenes/level1.json`:

| Interaction | Action |
|---|---|
| **Click floor tile** | Move character to tile (smooth `moveTo` with collision) |
| **Click Crystal / Boulder / Chest** | Deal 15 HP damage; health bar updates |
| **Arrow keys** | Nudge character ±0.5 world units |
| **M key** | Toggle light orbit ↔ manual mode |
| **Drag light** | Reposition light (manual mode) |
| **Ball elevation** slider | Character height 0–160 px |
| **Light elevation** slider | Light height 20–300 px |
| **Light intensity** slider | Brightness 0.1–3× |
| **Light color** picker | Real-time color change |
| **Orbit speed** slider | Auto-orbit rate |

## Quick Start

```ts
import { Engine, OmniLight, Crystal, HealthComponent, ParticleSystem, AudioManager } from 'luxiso';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const engine = new Engine({ canvas });
engine.originX = canvas.width / 2;
engine.originY = canvas.height / 2;

// Load scene from JSON
const scene = await engine.loadScene('/scenes/level1.json');
engine.setScene(scene);

// Add a prop with health
const crystal = new Crystal('gem', 3, 4, '#8060e0');
crystal.addComponent(new HealthComponent({
  max: 60,
  onDeath: () => {
    scene.spawnFloatingText({ x: 3, y: 4, z: 20, text: 'DESTROYED', color: '#ff4444' });
    scene.removeById('gem');
  },
}));
scene.addObject(crystal);

// Spatial audio
const audio = new AudioManager();
audio.bindPageLifecycle();   // unlock on the first gesture; suspend while hidden
audio.playSfx('/sfx/hit.ogg', {
  volume: AudioManager.spatialVolume({ x: 3, y: 4, listenerX: 5, listenerY: 5 }),
});


engine.start(
  (ts) => { /* postFrame: HUD, overlays */ },
  (ts) => { /* preFrame: background glow */ },
);
```

## Scene JSON Schema

```json
{
  "name": "Level 1",
  "cols": 10, "rows": 10, "tileW": 64, "tileH": 32,
  "floor": {
    "id": "mainFloor", "cols": 10, "rows": 10,
    "tileImage": "/tiles/stone.png",
    "walkable": [
      [true, true, false, true, true, true, true, true, true, true]
    ]
  },
  "walls": [
    {
      "id": "wall-n", "x": 0, "y": 0, "endX": 10, "endY": 0, "height": 80,
      "openings": [
        { "type": "window", "offsetX": 0.3, "width": 0.4, "height": 0.45, "offsetY": 0.3 },
        { "type": "door",   "offsetX": 0.7, "width": 0.25, "height": 0.85 }
      ]
    }
  ],
  "lights": [
    { "type": "omni",        "x": 5, "y": 5, "z": 120, "color": "#ffd080", "intensity": 1,    "radius": 320 },
    { "type": "directional", "angle": 45,    "elevation": 45, "color": "#c0d8ff", "intensity": 0.25 }
  ],
  "characters": [
    { "id": "player", "x": 5, "y": 5, "z": 48, "radius": 26, "color": "#5590cc" }
  ],
  "clouds": [
    { "id": "c1", "x": 2, "y": 1, "altitude": 6, "speed": 0.4, "angle": 0.3, "scale": 1.2, "seed": 0.7 }
  ],
  "props": [
    { "id": "rock", "type": "boulder", "x": 3, "y": 3, "color": "#7a7a8a", "radius": 18,
      "health": 50, "hp": 12 }
  ]
}
```

A prop's `type` is resolved through `Engine.registerProp()`; the built-in types
are `crystal`, `boulder`, `chest`, `tree`, `flowers` and `lantern`. `health` is
the **maximum** hp and must be positive when present. `hp` is optional and holds
the **current** hp of a damaged prop, which is what makes a checkpoint faithful —
it is written by `SceneSerializer.toJSON()` only when the prop is hurt, and
applied through `HealthComponent.restore()` so loading announces no damage and no
death. A prop that builds its own `HealthComponent` keeps it: only the maximum is
taken from JSON.

## Coordinate System & Z Units

The engine uses a standard 2:1 isometric projection. Understanding the two
distinct Z conventions is essential for correct depth sorting:

```ts
// project(): world (x,y,z) -> screen (sx, sy)
sx = (x - y) * (tileW / 2)
sy = (x + y) * (tileH / 2) - z
```

**There is exactly one Z unit: screen pixels.** `position.z` and every AABB's
`baseZ` / `maxZ` share it.

- `project()` subtracts `z` from `sy` directly, so a character at `z=48` renders
  48 pixels above the ground and its AABB spans `baseZ = 48`.
  `Camera.applyTransform()` applies rotation/elevation as a canvas 2D transform;
  `project()` itself ignores the `IsoView` argument (kept for API stability).
  Callers needing a view-aware screen position outside the transformed canvas
  should use `Camera.worldToScreen(..., view)`.

- Each object's `get aabb()` passes its pixel height straight through, so
  `depthSort`'s `overlapZ` comparisons and `ShadowCaster` projections are
  consistent across classes (Wall, Character, Crystal, Boulder, Chest, Cloud, …).

  ```ts
  // A Wall of height 80px
  wall.aabb.maxZ === 80
  // A Character of radius 22px (upper half rises above the anchor)
  char.aabb.maxZ === position.z + 22
  ```

- An AABB may omit `maxZ`; `depthSort` then assumes a slab of
  `MIN_Z_EXTENT_PX` (16 px) rather than an infinite column, so a floor never
  claims to overlap everything above it.

Earlier versions used two units — `position.z` in pixels, AABB Z in "world-Z
units" via a hardcoded `Z_UNITS_PER_PX = 1/16`. That constant only satisfied its
own stated rule (`1 unit == tileH / 2`) at `tileH = 32`, and the WebGL extraction
path multiplied world-Z back by `tileH / 2`, so at any other tile height the two
backends disagreed about how far up a given `z` sat. `Z_UNITS_PER_PX` is gone;
if you wrote a custom `get aabb()`, drop the `* Z_UNITS_PER_PX` and pass pixels.


## Architecture

```
Engine                     — canvas setup, RAF loop, JSON loader, pre/postFrame
└── Scene                  — object/light container, lifecycle, Camera, ECS Systems, IsoView
    ├── SceneRenderer      — frustum cull, depth sort, shadows, LightmapCache, halos
    ├── SceneSerializer    — built-in JSON schema and runtime-state export
    ├── Camera             — follow / pan / zoom / applyTransform (frame-rate-independent lerp)
    ├── System[]           — priority-ordered batch queries over matching Entity instances
    ├── Floor              — tile grid; tileImage; per-tile color cache; OmniLight + DirectionalLight RGB mix
    ├── Wall               — parallelogram faces; door/window openings; face-normal lighting
    ├── ShadowCaster       — AABB silhouette → z=0 projection; radial gradient fill
    ├── Character          — sphere/sprite entity; AnimationController (movement via MovementComponent)
    ├── Entity (ECS)       — addComponent / getComponent; per-frame component.update()
    │   ├── Crystal        — low-poly hexagonal crystal; HealthComponent
    │   ├── Boulder        — low-poly 7-sided rock; crack lines; HealthComponent
    │   ├── Chest          — isometric box; animated lid; HealthComponent
    │   ├── Cloud           — deterministic LCG low-poly puffs; drift + wrap; ground shadow
    │   ├── Tree            — low-poly canvas tree
    │   ├── FlowerPatch     — scattered flower cluster
    │   ├── Lantern         — lantern body + attached OmniLight
    │   └── FloatingText    — floating damage/status text; auto-expires; depth-sorted
    ├── ParticleSystem     — IsoObject; procedural + sprite particles; depth-sorted; preset configs
    └── LightManager
        ├── OmniLight      — illuminateAt(); RGB channel accumulation
        └── DirectionalLight — angle/elevation; incidentDirection; face-normal dot
```

## Project Structure

```
src/
├── index.ts                     # Public API barrel — 66 runtime exports (134 incl. types)
├── main.ts                      # Interactive demo
├── core/
│   ├── AssetLoader.ts           # Promise image cache; loadImage / loadAll / get
│   ├── Camera.ts                # follow / pan / zoom / applyTransform / clamp; frame-rate-independent lerp
│   ├── ClickMover.ts            # Click-to-move + keyboard movement; animated marker; collision-aware
│   ├── DebugRenderer.ts         # Overlay: collision grid, AABB, light radii, triggers, FPS
│   ├── Engine.ts                # RAF loop; JSON loader (floor/walls/lights/chars/props/clouds); pre/postFrame
│   ├── HudLayer.ts              # Canvas-space UI: labels, bars, buttons, panels
│   ├── InputManager.ts          # Keyboard/mouse/multi-touch state; touches[]; mouse-button keys; per-frame flush
│   ├── InputMap.ts              # Action-binding layer over InputManager; axis() + analog AxisSource; toJSON/fromJSON
│   ├── TouchStick.ts            # On-screen analog stick; AxisSource; deadzone, dynamic origin, per-contact claim
│   ├── LightmapCache.ts         # OffscreenCanvas floor cache; isDirty snapshot; blit()
│   ├── Minimap.ts               # OffscreenCanvas HUD overlay; walkable grid + object dots
│   ├── ObjectPool.ts            # Generic object pool; acquire/release/releaseAll; prewarm
│   ├── Scene.ts                 # Object/light container; lifecycle; Systems; IsoView transitions
│   ├── SceneRenderer.ts         # Culling; sorting; shadows; lightmap; object rendering
│   ├── SceneSerializer.ts       # Built-in scene JSON serialization
│   ├── SceneManager.ts          # Named scene stack; push/pop/replace/goto; lifecycle hooks
│   ├── SceneTransition.ts       # Canvas transition effects: fade, slide, circle-wipe; playIn/playOut/between; stays covered between phases
│   └── Validator.ts             # validateSceneJson(); validateComponents(); requireComponent()
├── elements/
│   ├── IsoObject.ts             # Abstract base: id, position (IsoVec3), aabb, draw, update
│   ├── Floor.ts                 # Tile grid + tileImage + per-tile color cache + multi-light RGB illumination
│   ├── Wall.ts                  # Parallelogram faces; openings; face-normal dir lighting
│   ├── Character.ts             # Sphere/sprite entity; AnimationController (movement via MovementComponent)
│   └── props/
│       ├── Crystal.ts           # Low-poly crystal; Entity + HealthComponent
│       ├── Boulder.ts           # Low-poly rock; Entity + HealthComponent
│       ├── Chest.ts             # Isometric chest; animated lid; Entity + HealthComponent
│       ├── Cloud.ts             # Deterministic LCG low-poly cloud; drift + wrap; ground shadow
│       ├── Tree.ts              # Low-poly tree; canvas-drawn; registered as prop 'tree'
│       ├── FlowerPatch.ts       # Scattered flower cluster; registered as prop 'flowers'
│       ├── Lantern.ts           # Lantern prop with attached OmniLight; prop 'lantern'
│       └── FloatingText.ts      # Floating text; rises at px/sec; auto-expires via Scene.update(); Scene.spawnFloatingText()
├── animation/
│   ├── SpriteSheet.ts           # AnimationClip (frames, fps, loop); AssetLoader preload
│   ├── AnimationController.ts   # State machine; 8-direction; idle↔walk; dt-based; playOnce() forces non-looping
│   ├── DirectionalAnimator.ts   # action_DIR clip naming; fallback chain; playOnce(); buildSheet()
│   └── ParticleSystem.ts        # IsoObject; circle/square + sprite particles; blend modes; presets
├── physics/
│   ├── TileCollider.ts          # Walkable grid; canOccupy(); resolveMove(); sweepMove() fast-path
│   └── Pathfinder.ts            # A* 8-dir; Bresenham LoS string-pull; min-heap; LRU result cache
├── ecs/
│   ├── Component.ts             # Component lifecycle + ComponentCtor type
│   ├── Entity.ts                # IsoObject + component Map; addComponent / getComponent
│   ├── EventBus.ts              # EventMap-typed on/off/emit; globalBus singleton
│   ├── System.ts                # Batch component queries; priority + attach/detach lifecycle
│   └── components/
│       ├── HealthComponent.ts   # hp / maxHp / fraction / isDead; takeDamage / heal / restore; callbacks
│       ├── MovementComponent.ts # ECS moveTo / pathTo / nudge; TileCollider; EventBus arrival/move
│       ├── AnimationComponent.ts # Drives a SpriteSheet/DirectionalAnimator from ECS update
│       ├── TimerComponent.ts    # delay / repeat / pause / restart
│       ├── TweenComponent.ts    # 8 easings; yoyo; repeat; delay; onComplete
│       ├── TweenSequence.ts     # Chain multiple TweenComponent steps; repeat; onComplete
│       └── TriggerZoneComponent.ts # Circle enter/exit; EventBus trigger
├── lighting/
│   ├── BaseLight.ts             # Abstract: color, intensity, illuminate()
│   ├── OmniLight.ts             # Point light; illuminateAt(sx, sy, lsx, lsy)
│   ├── DirectionalLight.ts      # angle/elevation; direction / incidentDirection vectors
│   └── ShadowCaster.ts          # AABB → z=0 silhouette projection; radial gradient
├── audio/
│   └── AudioManager.ts          # Web Audio API; SFX (fire-and-forget); BGM crossfade;
│                                #   spatial volume; master/sfx/bgm gain buses; buffer cache
├── time/
│   └── FrameClock.ts            # The frame-delta contract: null baseline, [0, maxDt] clamp, reset() on pause
├── math/
│   ├── IsoProjection.ts         # project() / unproject() / depthKey() / drawIsoCube(); IsoVec3 / IsoView
│   ├── depthSort.ts             # AABB (with maxZ); topoSort<T>() — 3-D Kahn + containment detection
│   └── color.ts                 # hexToRgb / hexToRgba / shiftColor / blendColor / lerpColor
└── editor/
    ├── EditorState.ts           # Central store; undo/redo command stack (100 deep); walkable grid; JSON I/O
    ├── EditorRenderer.ts        # Engine-backed live preview; world↔screen coordinate mapping
    ├── editor.ts                # Full editor UI; toolbar; object list; property panel; keyboard shortcuts
    └── sprite-editor.ts         # Sprite sheet frame inspector and animation clip builder

webgl-next/
├── src/                         # Snapshot extraction, WebGL2 renderer, overlays, resources
├── e2e/                         # Deterministic Playwright fixture matrix
├── index.html                   # WebGL/Canvas comparison preview
├── main.ts                      # Preview page entry point
├── style.css
├── README.md                    # Preview plan and status
├── ARCHITECTURE.md              # Current preview boundaries and render graph
├── ACCEPTANCE.md                # Visual, browser, performance, and release gates
└── ROADMAP.md                   # Incremental preview and cutover phases

examples/
├── index.html                   # Examples + tools gallery
├── 01-minimal-scene/            # Floor, walls, single OmniLight
├── 02-character-movement/       # WASD + collision + camera follow
├── 03-combat-system/            # HealthComponent, damage events, particles
├── 04-hud-debug-inputmap/       # HudLayer, DebugRenderer, InputMap
├── 05-whisper-plains/           # Full demo: day/night, multi-scene, animals, portals
│   └── environment/skies.ts     #   Plains / lake / deep-sea backdrops + shared star field
│   ├── scenes/                  # PlainsScene, LakeScene, DeepSeaScene
│   ├── entities/                # CubeHero, Portal, Animals, AquaticLife
│   └── environment/             # LowPolyTree, DayNightCycle
├── 06-voxel-lake/               # Voxel wave simulation, seabed decor
├── 07-desert-ruins/             # Procedural terrain, interactive props, portals
├── 08-volcano/                  # Lava terrain, particle FX, burn damage, click-to-move
├── 09-slopes/                   # Height-map terrain, bilinear interpolation, smooth voxel hills
└── 10-arpg/                     # WebGL2 arena: 3 waves + boss + result + checkpoint; pillar cover with LoS-gated A* chase; custom Entity via SceneExtractor.register, HudLayer over GL, keyboard + TouchStick
    ├── WaveDirector.ts          # Run structure (phases, waves, boss, result) + snapshot/restore — no Scene/Engine/DOM, unit-tested
    ├── ArenaRun.ts              # The rules: spawning, hero intent, kill reporting, life on kill, crowd separation. Driven by `step(dt, intent)`, so a full run is a unit test
    ├── Combatant.ts             # Hero / grunt / boss: Entity + HealthComponent + MovementComponent
    ├── CombatantExtractor.ts    # The SceneExtractor registration that makes it renderable on the GL path
    └── persistence.ts           # Both halves of the round trip: SceneSerializer.register (save) + Engine.registerProp (load)

public/
└── scenes/
    └── level1.json              # 16×10 demo scene: floor + walkable map, 4 walls, OmniLight + DirectionalLight, player, 3 props
```

## API Reference

### `Engine`

```ts
new Engine({ canvas: HTMLCanvasElement })
engine.originX: number                          // iso origin X in logical (CSS) pixels
engine.originY: number                          // iso origin Y
engine.canvasW / canvasH: number                // logical drawing size
engine.resize(w?, h?): void                     // logical size; omit both to fill the parent
engine.pixelRatio: number                        // auto from devicePixelRatio, clamped to [1, maxPixelRatio]; assign to pin, null for auto
engine.maxPixelRatio: number                     // default 2
engine.appliedPixelRatio: number                 // ratio the current backing store was built with
engine.loadScene(url: string): Promise<Scene>   // fetch + parse JSON; builds all objects + collider
engine.buildScene(json: object): Scene          // synchronous, no fetch
Engine.buildProps(entries): IsoObject[]         // static; props only, no Scene — for a checkpoint, an editor paste, a streamed room
engine.setScene(scene: Scene): void
engine.start(postFrame?, preFrame?): void       // postFrame runs after draw; preFrame before draw
engine.stop(): void
engine.destroy(): void                           // stop + drop the visibility listener
engine.pauseOnHide: boolean                      // default true
engine.paused: boolean                           // true while suspended because the tab is hidden
engine.ctx: CanvasRenderingContext2D
engine.canvas: HTMLCanvasElement
```

Everything the game touches is in **logical (CSS) pixels**. `resize()` sizes the
backing store to `logical × pixelRatio` and gives the 2D context a matching base
transform, so drawing code is unchanged but output is crisp on a high-DPI screen.
The constructor deliberately does *not* apply the ratio — it adopts whatever size
the page already set, so existing code keeps its exact behaviour until it opts in
by calling `resize()`.

When you do opt in, tell the input layer, or taps will be reported in backing
pixels while the HUD lays out hit boxes in logical ones:

```ts
const input = new InputManager(canvas, { pixelRatio: () => engine.appliedPixelRatio });
engine.resize(parent.clientWidth, parent.clientHeight);
```


### `Scene`

```ts
scene.addObject(obj: IsoObject): void
scene.addLight(light: BaseLight): void
scene.removeById(id: string): void
scene.getById(id: string): IsoObject | undefined
scene.getAll<T>(ctor): T[]                      // get all objects of a given class
scene.allObjects: readonly IsoObject[]          // read-only snapshot of all objects
scene.sortedObjects: readonly IsoObject[]       // current visible back-to-front render order
scene.spawnFloatingText(opts): FloatingText     // convenience: create + add FloatingText
scene.omniLights: OmniLight[]
scene.dirLights: DirectionalLight[]
scene.getLightById(id: string): BaseLight | undefined
scene.camera: Camera
scene.collider: TileCollider | null
scene.view: IsoView                             // { rotation: degrees, elevation: 0.2–1.0 }
scene.transitionView(to: Partial<IsoView>, duration?): void  // smooth animated view change
scene.ambientColor: string                      // CSS hex; drives day/night tint
scene.ambientIntensity: number                  // 0–1
scene.dynamicLighting: boolean                  // true = re-bake floor lightmap every frame
scene.toJSON(): Record<string, unknown>         // full round-trip serialization
scene.addSystem(system: System): System
scene.getSystem(SystemCtor): System | undefined
scene.removeSystem(systemOrCtor): boolean
```

Custom object types round-trip through two paired registries — one per
direction. `Engine.registerProp()` builds them on load; `SceneSerializer`
writes them on save. Without the serializer, `toJSON()` cannot know about the
type and the object is dropped (with a one-time console warning naming it):

```ts
class Mob extends Entity { constructor(id, x, y, public tier = 1) { super(id, x, y, 0); } }

Engine.registerProp('mob', (p) => new Mob(p.id, p.x, p.y, p.tier as number));
SceneSerializer.register(Mob, (mob) => ({ type: 'mob', tier: mob.tier }));

SceneSerializer.unregister(Mob): boolean
SceneSerializer.clearSerializers(): void          // props and lights alike
SceneSerializer.findSerializer(object): PropSerializer | null

// Custom lights are the same story, keyed by the light's own `type` field:
Engine.registerLight('aura', (j) => new AuraLight({ ...j }));
SceneSerializer.registerLight(AuraLight, (l) => ({ radius: l.radius }));
SceneSerializer.unregisterLight(AuraLight): boolean
SceneSerializer.findLightSerializer(light): LightSerializer | null
```

The serializer returns the `props[]` entry: `type` is required (it is the key
the factory is registered under), while `id`, `x` and `y` are filled in from the
object unless the entry overrides them. A `health` field is restored into a
`HealthComponent` by `Engine.buildScene()`. Return `null` to skip an object.
Later registrations win, so a subclass can override its base; built-in types are
matched first, so a class deriving from a built-in prop still serializes as that
built-in. A serializer that throws costs one object, not the whole save.

### `Camera`

```ts
new Camera(opts?: CameraOptions)
camera.follow(target: IsoObject): void
camera.unfollow(): void
camera.pan(dx: number, dy: number): void
camera.zoom: number                            // default 1; assigned directly, NOT clamped
camera.setZoom(zoom: number): void             // clamps to 0.25–4
camera.lerpFactor: number                      // clamped to 0–1; frame-rate-independent convergence
camera.update(dt?: number): void               // lerps toward the follow target
camera.setBounds(bounds: CameraBounds): void
camera.applyTransform(ctx, canvasW, canvasH, tileW, tileH, originX, originY, view?): void
camera.restoreTransform(ctx): void
camera.worldToScreen(wx, wy, wz, tileW, tileH, originX, originY, view?): { sx, sy }
camera.screenToWorld(cx, cy, canvasW, canvasH, tileW, tileH, originX, originY, view?): { x, y }
// Pass the same `view` you render with: worldToScreen / screenToWorld reproduce
// applyTransform's composition exactly (rotation first, then the elevation
// Y-scale). Omitting it assumes the default { rotation: 0, elevation: 0.5 }.
```

### `ClickMover`

```ts
new ClickMover({ cols, rows, speed, radius?, collider? })
mover.update(dt, input, map, camera, tileW, tileH, originX, originY, canvasW, canvasH, entityX, entityY): void
mover.velX: number; mover.velY: number         // displacement for this frame (add to position)
mover.reset(): void                            // clear target + velocity (call on scene enter)
mover.drawMarker(ctx, camera, tileW, tileH, originX, originY, ts): void  // animated click ring
ClickMover.REFERENCE_FPS                        // 60 — the rate `speed` is calibrated against
```

`speed` is world units per frame **at 60 FPS**; `update()` scales by
`dt * REFERENCE_FPS`, so ground speed is the same on a 144 Hz display as on a
60 Hz one and existing `speed` values keep their old feel. Pass `dt` in seconds
(what `Engine`'s frame callback and `ManagedScene.onUpdate` give you). On the
final frame of a click-move the mover emits the exact remaining delta, so the
entity lands on the clicked tile rather than stopping short by a step.


### `TouchStick`

```ts
new TouchStick({ x, y, radius?, deadzone?, captureRadius?, dynamicOrigin?, baseColor?, knobColor? })
stick.update(input, isTaken?): void      // poll once per frame, before reading the axis
stick.value: { x, y }                    // analog vector, length ≤ 1
stick.active: boolean
stick.touchId: number | null             // the claimed contact — check before letting buttons take it
stick.setCentre(x, y): void              // after a resize
stick.reset(): void
stick.draw(ctx): void                    // base ring + knob, in screen space
```

`TouchStick` implements `AxisSource`, so registering it makes the whole movement
chain analog without any other change:

```ts
const stick = new TouchStick({ x: 110, y: engine.canvasH - 110 });
map.addAxisSource(stick);          // () => void detach

engine.start(
  (ts) => stick.draw(engine.ctx),
  () => {
    stick.update(input);
    // ClickMover reads map.axis(), so it now honours partial deflection
    mover.update(dt, input, map, camera, /* ... */);
  },
);
```

It claims one contact by `Touch.identifier` and holds it until that finger
lifts, so a second thumb on a skill button never steals it. `axis()` sums every
active source with the digital keys and clamps to length 1 — pure-keyboard
results are unchanged, and holding a key while pushing the stick grants no extra
speed.

### `Character`

```ts
new Character({ id, x, y, z?, radius?, color?, spriteSheet?, speed? })
character.isMoving: boolean                    // delegates to MovementComponent
character.anim: AnimationController | null
character.setSpriteSheet(sheet, initialClip?): void
character.playAnimation(name: string): void
```

Movement is **not** on `Character` itself — it lives in `MovementComponent`, so a
character can be moved with or without pathfinding by adding that component:

```ts
import { Character, MovementComponent } from 'luxiso';

const hero = new Character({ id: 'hero', x: 5, y: 5, radius: 22 });
const mv = hero.addComponent(new MovementComponent({ speed: 3, collider: scene.collider! }));
mv.moveTo(8, 4);        // direct smooth movement
mv.pathTo(2, 9);        // A* through the attached collider; false = unreachable
```


### `Entity` (ECS base)

```ts
entity.addComponent<T extends Component>(c: T): T
entity.getComponent<T>(ctor: ComponentCtor<T>): T | undefined
entity.hasComponent(ctor: ComponentCtor): boolean
entity.removeComponent(ctor: ComponentCtor): void
```

### `System`

```ts
class DeathSystem extends System {
  readonly query = [HealthComponent];
  update(entities: Entity[], dt: number): void { /* batch work */ }
  fixedUpdate?(entities: Entity[], dt: number): void;
}
scene.addSystem(new DeathSystem());
```

### `EventBus`

```ts
interface GameEvents { score: { value: number }; paused: { value: boolean } }
const bus = new EventBus<GameEvents>();
bus.on('score', ({ value }) => console.log(value));
bus.emit('score', { value: 10 });
```

### `HealthComponent`

```ts
new HealthComponent({ max, current?, onDeath?, onChange? })
hp.hp: number; hp.maxHp: number; hp.fraction: number; hp.isDead: boolean
hp.takeDamage(amount): void   // negative amounts clamp to 0; they do not heal
hp.heal(amount): void         // negative amounts clamp to 0; they cannot kill
hp.setMax(max, scaleCurrentHp?): void   // a non-positive max is ignored
hp.restore(hp): void          // set current hp silently — for loading a save
```

`restore()` is the loader path: it fires no damage, heal or death notification,
so restoring "12 of 40" does not announce a hit that never happened, and
restoring 0 loads an already-dead unit without re-running `onDeath`. `Engine`
uses it for the `hp` field on a prop entry.

### `MovementComponent`

```ts
new MovementComponent({ speed?, radius?, collider?, bus?, pathCache? })
mv.moveTo(x, y, z?): void
mv.pathTo(x, y, z?): boolean     // A* via attached collider; false = unreachable
mv.followPath(waypoints, z?): void   // empty array cancels the current move
mv.nudge(dx, dy): void           // swept when longer than `radius`, so knockback cannot clip a wall
mv.stopMoving(): void
mv.setPathCache(cache | null): void  // null = the shared module-level cache
mv.pathCache: PathCache | null       // read-only
mv.isMoving: boolean
// Emits EventBus: 'move' each frame, 'arrival' on destination reached.
// With a collider attached, a move that ends up fully blocked stops instead of
// pushing into the wall: `isMoving` goes false and no 'arrival' is emitted.
```

### `TweenComponent`

```ts
new TweenComponent({
  targets: [{ prop: 'x'|'y'|'z', from, to }],
  duration,               // seconds
  easing?: Easing.easeOut,
  yoyo?: true,
  repeat?: -1,            // -1 = infinite
  delay?: 0.5,
  onComplete?: () => {},
})
// Easing: linear easeIn easeOut easeInOut easeInCubic easeOutCubic bounce elastic
tween.pause(); tween.resume(); tween.restart()
tween.progress: number   // 0–1
```

### `TweenSequence`

```ts
new TweenSequence(steps: TweenOptions[], { repeat?, onComplete? })
// Each step plays after the previous completes.
// repeat: -1 = infinite loop of the full sequence.
entity.addComponent(new TweenSequence([
  { targets: [{ prop: 'z', from: 0, to: 48 }], duration: 0.3, easing: Easing.easeOut },
  { targets: [{ prop: 'z', from: 48, to: 0 }], duration: 0.5, easing: Easing.bounce },
], { repeat: -1 }));
```

### `TimerComponent`

```ts
new TimerComponent({ duration, repeat?, onTick?, onComplete?, autoStart? })
// duration: seconds; repeat: loop; onTick: fires each cycle; onComplete: fires when non-repeating timer finishes
timer.start(): void; timer.pause(): void; timer.restart(): void; timer.reset(): void
// There is no resume(): call start() to un-pause (it keeps the elapsed time).
// Time spent paused is not credited — the clock re-baselines on the first frame back.
timer.elapsed: number   // seconds elapsed in current cycle
timer.fraction: number  // 0–1 progress through current cycle
timer.isDone: boolean; timer.isRunning: boolean
// A repeating timer catches up: if one frame spans several periods, onTick
// fires once per period rather than once per frame.
```

### `TriggerZoneComponent`

```ts
new TriggerZoneComponent({ radius?, onEnter?, onExit?, bus?, targets? })
trigger.radius: number
trigger.targets: IsoObject[]
trigger.contains(id: string): boolean
trigger.insideIds: ReadonlySet<string>
trigger.setOnEnter(cb: (id: string) => void): void   // update callback after construction
trigger.setOnExit(cb: (id: string) => void): void
// Emits EventBus: 'triggerEnter' / 'triggerExit'
```

### `ParticleSystem`

```ts
new ParticleSystem(id, x, y, z)   // z is required
ps.addEmitter(config: EmitterConfig): void
ps.burst(count?: number, randomness?: number): void
ps.spawn(opts: ParticleOptions): void
ps.particleCount: number
ps.forEachParticle(visitor): void     // allocation-free read-only view
ps.onExhausted: (() => void) | null   // fires once when the last particle dies

// Preset emitter configs. Pass the result to addEmitter():
//   ps.addEmitter(ParticleSystem.presets.sparkBurst());
ParticleSystem.presets.sparkBurst({ color?, count? })
ParticleSystem.presets.dustPuff({ color?, count? })
ParticleSystem.presets.crystalShatter({ color?, count? })
ParticleSystem.presets.coinSpill({ color?, count? })
ParticleSystem.presets.ambientDrift({ color?, count?, speed?, size?, alpha?, blend?, shape? })
ParticleSystem.presets.FIRE     // plain config object, not a function
ParticleSystem.presets.SMOKE    // plain config object, not a function

// Shared recycle pool (particles migrate between systems; reset() overwrites all
// fields, so this is safe):
ParticleSystem.poolLimit = 512   // cap; excess dead particles are dropped
ParticleSystem.poolSize          // current pooled count
ParticleSystem.clearPool()       // drop everything, e.g. between scenes
```

For the burst presets, `color` overrides the palette and `count` becomes
`maxParticles` (a cap on simultaneously live particles). There is no
`autoRemove` field — remove an exhausted system yourself, typically from
`onExhausted`, which fires exactly once per burst.



### `Pathfinder` / `PathCache`

```ts
Pathfinder.find(collider, start: IsoVec2, goal: IsoVec2, cache?: PathCache): IsoVec2[] | null
// Omitting `cache` uses a module-level LRU shared by all callers (capacity 64).
// Pass a per-scene PathCache instead to avoid cross-scene pollution:

const cache = new PathCache(64);
Pathfinder.find(scene.collider!, { x: 0, y: 0 }, { x: 9, y: 9 }, cache);
cache.invalidate();              // rarely needed — see below
cache.size; cache.capacity;

Pathfinder.invalidateCache(collider?): void
// @deprecated — only flushes the shared default cache. Prefer an explicit
// PathCache and cache.invalidate().

Pathfinder.hasLineOfSight(collider, a: IsoVec2, b: IsoVec2): boolean
// The same corner-safe Bresenham walk string-pulling uses. Chase AI wants this
// rather than A*: walk straight while the target is visible, and pay for a path
// only once cover breaks the line (see `examples/10-arpg/Combatant.ts`).
```

A component reaches the cache through its own option rather than the shared
default:

```ts
const cache = new PathCache(96);            // one per scene, or per agent group
new MovementComponent({ collider, pathCache: cache });
```

`TileCollider.setWalkable()` bumps `collider.version`, and `PathCache` checks
that version on every lookup — so opening a door automatically drops stale
paths. `invalidate()` is only needed if walkability changes through some other
mechanism.



### `Floor`

```ts
new Floor({ id, cols, rows, color?, altColor?, tileImage?, altTileImage? })
floor.invalidateCache(): void   // force re-bake on next draw (after changing color/altColor)
await floor.preload()           // preload tile textures before engine.start()
```

### `IsoProjection`

```ts
project(x, y, z, tileW, tileH): { sx, sy }
unproject(sx, sy, tileW, tileH): { x, y }      // z=0 plane
depthKey(x, y, z): number
drawIsoCube(ctx, originX, originY, tileW, tileH, wx, wy, wz, w, d, h, topColor, leftColor, rightColor): void
topoSort<T extends Sortable>(objects: T[]): T[]
```

### `AABB`

```ts
interface AABB {
  minX: number; minY: number; maxX: number; maxY: number;
  baseZ: number;    // bottom Z, in screen pixels
  maxZ?: number;    // top Z, in screen pixels; omit for flat/ground objects
}
// Setting maxZ enables vertical separation: objects that don't share Z space
// are sorted by baseZ rather than XY heuristic, preventing terrain from
// occluding elevated characters.
//
// Omitting maxZ makes depthSort assume a slab of MIN_Z_EXTENT_PX (16 px), not an
// infinite column — a floor must not claim to overlap everything above it.
export const MIN_Z_EXTENT_PX = 16;
```

### `FrameClock`

```ts
new FrameClock(maxDt = FrameClock.MOTION_MAX_DT)   // 0.1 s; TIMELINE_MAX_DT is 0.5 s
clock.sample(ts): number         // seconds since the last sample, clamped to [0, maxDt]
clock.reset(): void              // next sample is a first frame again — use on pause
clock.started: boolean           // false until the first finite sample
clock.last: number | null        // last sampled timestamp, in milliseconds
clock.maxDt: number              // read-only; a nonsensical cap falls back to MOTION_MAX_DT
```

The first sample returns 0, a backwards or repeated stamp returns 0, and a
non-finite stamp returns 0 without becoming the baseline. See
[the frame-delta contract](#the-frame-delta-contract) for why each of those is a
rule rather than a nicety.


### `AudioManager`

```ts
const audio = new AudioManager()
audio.bindPageLifecycle({ unlockOnGesture?, suspendWhileHidden?, target? }): () => void
audio.resume()

audio.masterVolume = 0.8
audio.sfxVolume = 1
audio.bgmVolume = 0.6
audio.playSfx(url, { volume?, rate?, loop?, spatial? }): AudioBufferSourceNode | null
audio.playBgm(url, fadeDuration?): Promise<void>
// Crossfades from the current track. Concurrent calls are safe: the newest
// request wins and the loser never starts, so two scene switches in one frame
// cannot leave a second track playing with nothing able to stop it.
audio.stopBgm(fadeDuration?)
// Both retire the outgoing chain — source and fade gains are disconnected once
// the fade ends, since a looping source never fires `onended` on its own.
audio.preload(url): Promise<void>
audio.preloadAll(urls): Promise<void>
audio.suspend(): void
audio.updateListener(x, y, z?): void
audio.dispose(): void   // stop BGM, close the AudioContext, drop the buffer cache
AudioManager.spatialVolume({ x, y, listenerX, listenerY, refDistance?, maxDistance? }): number
// Legacy manual falloff helper. `playSfx(url, { spatial })` uses a real
// Web Audio PannerNode with HRTF instead and should be preferred.
// refDistance defaults to 1 and maxDistance to 10 — the same values the panner
// path uses, so both give the same curve for the same options object.
```

Call `dispose()` when tearing down a game instance: browsers cap the number of
live `AudioContext`s, and the decoded-buffer cache otherwise grows across scene
reloads. `resume()` revives the manager afterwards.


### `DirectionalAnimator`

```ts
// Clip naming: '{action}_{direction}' e.g. 'walk_SE', 'idle_N'
const anim = new DirectionalAnimator(sheet, { initialAction: 'idle', initialDirection: 'S' })
anim.setAction('walk')
anim.setDirection('NE')
anim.set('attack', 'SW')
anim.playOnce('attack', 'idle', onComplete?)
anim.update(dt)
anim.currentFrame(): { frame: FrameRect; image: HTMLImageElement } | null

DirectionalAnimator.buildSheet(url, frameW, frameH, actions, scale, anchorY?)
DirectionalAnimator.clipNamesFor(action)        // all 8 '{action}_{DIR}' names
DirectionalAnimator.auditSheet(sheet, action)   // { present, missing }
```

`playOnce` overrides the clip's own `loop` flag for that playback. This matters
because `buildSheet` defaults every clip it generates to `loop: true`, so without
the override a one-shot attack would cycle forever and never hand control back to
`returnTo`. Changing direction mid-flight restarts the one-shot facing the new
way; `setAction` / `set` cancel it.

Direction fallback, applied when the exact `{action}_{DIR}` clip is absent:

| Requested | Tried in order |
|---|---|
| `S` | `S` |
| `SE` | `SE`, `S`, `E` |
| `E` | `E`, `SE`, `S` |
| `NE` | `NE`, `E`, `SE`, `S` |
| `N` | `N`, `NE`, `NW`, `E`, `W`, `S` |
| `NW` | `NW`, `W`, `SW`, `S` |
| `W` | `W`, `SW`, `S` |
| `SW` | `SW`, `S`, `W` |

If no directional variant matches, the bare action name (`'idle'`) is used; as a
last resort the sheet's first clip, with a console warning.


### `HudLayer`

```ts
const hud = new HudLayer()
hud.addLabel({ id, x, y, text?, color?, fontSize?, font?, visible?, shadow? }): HudLabel
hud.addBar({ id, x, y, w, h, value?, color?, bgColor?, borderColor?, label?, labelColor?, fontSize? }): HudBar
hud.addButton({ id, x, y, w, h, label?, color?, bgColor?, hoverColor?, fontSize?, onClick? }): HudButton
hud.addPanel({ id, x, y, w, h, bgColor?, borderColor?, radius? }): HudPanel
hud.get<T>(id: string): T | undefined
hud.remove(id: string): void
hud.clear(): void
hud.draw(ctx, canvasW?, canvasH?): void       // call in postFrame; pins the transform to screen space
hud.pixelRatio: number | (() => number)      // reset scale for draw(); () => engine.appliedPixelRatio on high-DPI
hud.update(input, isTaken?): readonly number[]  // frame-driven mouse + touch; fires on release inside
hud.hitTest(x, y): HudElement | null         // topmost non-label element at the point
hud.minHitSize: number                       // expand undersized targets (0 = as drawn, 44 = touch guideline)
hud.resetInput(): void                       // drop in-flight presses, e.g. on scene change
hud.handleClick(x, y): boolean               // immediate-fire path for a mouse `click`
hud.handleMove(x, y): void                   // update button hover states


// Mutate elements directly after creation:
const bar = hud.addBar({ id: 'hp', ... });
bar.value = player.hp / player.maxHp;        // update fill fraction each frame
const label = hud.addLabel({ id: 'score', ... });
label.text = `Score: ${score}`;
label.visible = false;                       // hide/show
```

### `Minimap`

```ts
new Minimap(scene, { cols, rows, style? })
minimap.draw(ctx, x, y, w, h)   // call in postFrame
minimap.setScene(scene)
minimap.alpha: number            // 0–1 transparency
minimap.isHit(px, py, mx, my, mw, mh): boolean  // hit-test the minimap rect

// Style options (all optional):
{
  bg: '#1a1a2e', walkable: '#2a3a4a', blocked: '#0a0a14',
  grid: 'rgba(255,255,255,0.06)',
  playerColor: '#5590cc', objectColor: '#cc8855',
  border: 'rgba(255,255,255,0.25)', radius: 6,
}
```

### `Validator`

```ts
validateSceneJson(json, { lightTypes?, propTypes? }): ValidationResult
validateComponents(entity: Entity, required: ComponentCtor[]): ValidationResult
requireComponent<T>(entity: Entity, ctor: ComponentCtor<T>): T  // throws if missing
```

Nothing in the engine calls `validateSceneJson`: `engine.buildScene()` loads what
it is given and warns about unknown types as it goes. Run the validator yourself
over hand-authored level files — in an editor, an asset pipeline, or a CI check.

A type outside the built-in set is a **warning**, because the validator has no
view of what the application registered through `Engine.registerProp()` /
`registerLight()`. Pass `propTypes` / `lightTypes` to declare the full accepted
set; doing so promotes unknown types to **errors**. Duplicate ids across floor,
walls, characters, props and lights are always errors — `Scene.removeById()`
filters every match and `getById()` returns the first, so a duplicate means one
object is unreachable and both disappear together.

## Roadmap

### Completed ✅

| Module | Notes |
|---|---|
| Isometric math (project / unproject / depthKey / drawIsoCube) | |
| Topological depth sort - 3-D AABB + containment detection + maxZ | |
| Depth sort: Z-aware containment + single pixel Z unit | `isBehind` compares `maxZ` when one footprint contains another; `position.z` and all AABB Z share one unit (screen pixels) |
| Depth sort: mixed-axis cycle fix + pairKey overflow fix | Strict `<` on equal far-sums; `i*n+j` pair key (no 65536 collision) |
| Light halo: view-aware projection under rotation/elevation | |
| Floor: OmniLight + DirectionalLight RGB illumination | |
| Floor: tileImage texture + AssetLoader | |
| Floor: per-tile color cache (dirty-flag, skips recomputation on static scenes) | |
| Wall: parallelogram faces + openings + directional lighting | |
| OmniLight: RGB point light with illuminateAt() | |
| DirectionalLight: face-normal dot product | |
| LightmapCache: OffscreenCanvas floor blit + auto-invalidate | |
| ShadowCaster: AABB → z=0 silhouette + radial gradient | |
| IsoView: scene rotation + elevation + transitionView() | |
| Camera: follow / pan / zoom — fully wired into Scene.draw() | |
| Camera: frame-rate-independent lerp | |
| ClickMover: click-to-move + keyboard + animated marker | |
| SpriteSheet + AnimationController (8-direction, idle/walk) | |
| DirectionalAnimator: action_DIR clips + fallback + playOnce | |
| ParticleSystem: procedural + sprite; preset configs; depth-sorted | |
| TileCollider: walkable grid + AABB slide-and-clamp + sweepMove | |
| A* Pathfinder: 8-directional, corner-cut prevention, Bresenham LoS string-pull, min-heap O(log n) | |
| Pathfinder: LRU result cache — instance-level `PathCache`; per-scene isolation | |
| ECS: Entity + Component + EventBus (typed events) | |
| HealthComponent / MovementComponent / TimerComponent | |
| TweenComponent: 8 easings, yoyo, repeat, delay | |
| TweenSequence: chained tween steps with repeat | |
| TriggerZoneComponent: circle enter/exit + EventBus | |
| Props: Crystal, Boulder, Chest, Cloud, FloatingText | |
| Scene.spawnFloatingText() convenience helper | |
| AudioManager: SFX + BGM crossfade + spatial volume | |
| JSON scene loader: floor/walls/lights/chars/props/clouds | |
| Scene.toJSON(): full round-trip serialization | |
| Validator: scene JSON + ECS component assertions | |
| Scene editor: object list, undo/redo, walkable drag-paint, property panel, JSON export/import; DirectionalLight; right-click delete; keyboard shortcuts | |
| Sprite editor: frame inspector, clip builder, 8-direction live preview (Map cache), anchorY, JSON export+import, data URL upload | |
| AssetLoader.register(url, img) — data-URL injection for sprite editor | |
| DirectionalAnimator.buildSheet: anchorY parameter | |
| Floor tile diamond: 4 corner grid-points (correct isometric alignment, eliminates tileH/2 offset bug) | |
| Editor coordinate system: camera.screenToWorld for zoom/pan-accurate picking; overlay z-aware projection | |
| Minimap: OffscreenCanvas HUD overlay, walkable grid + object dots | |
| Precise AABB frustum culling — in-place write-pointer compaction, zero per-frame allocation | |
| AssetLoader: instanceable; unload(url); size getter; static delegates to .default | |
| PathCache: per-scene A* cache; invalidate(); passed to Pathfinder.find() or MovementComponent({ pathCache }) | |
| ECS: HealthComponent unified EventBus emit; MovementComponent.nudge(); TriggerZone zero-GC | |
| Performance: depthSort spatial buckets + min-heap Kahn queue; renderer AABB hash; frustum cull in-place | |
| Engine: PropRegistry + LightRegistry (open for extension) | |
| Scene split: SceneRenderer + SceneSerializer | Container/lifecycle remains in Scene; public draw/toJSON APIs unchanged |
| ECS System layer + constructor component keys | Batch queries, priority order, fixed update, attach/detach lifecycle |
| EventBus event maps | Event names and payload types are coupled; custom maps supported |
| Scene.toJSON(): runtime state + built-in prop serialization | Environment, camera, view, light IDs/options, collider, built-ins |
| Lib build: ESM + CJS dual output + .d.ts (npm run build:lib) | |
| Unit tests: 1044 tests across 78 files (Vitest 4, Node ≥ 22) | |
| Coverage ratchets per module (`npm run test:coverage`) | v8 provider; per-glob floors on math/physics/lighting/ecs/animation/elements/audio/core |
| Examples: 10 progressive demos + tools gallery | |

## Known Limitations & Roadmap (Next)

See [FRAMEWORK_ANALYSIS.md](FRAMEWORK_ANALYSIS.md) for a detailed comparison with Excalibur.js, Phaser 3, Godot 4, and Bevy ECS.

| Priority | Item | Notes |
|----------|------|-------|
| P2 | `webgl-next` HUD is a stacked 2D canvas, not GL geometry | `HudOverlayRenderer` mounts the tested `HudLayer` on a transparent canvas above the GL one (DPR-aware, `pointer-events: none`), and its `paint` hook hosts widgets that draw themselves such as `TouchStick`. Fine for bars/buttons/labels; a HUD that needs to blend with the 3D scene still wants a GL path |
| P2 | Six of nine WebGL fixtures are not baseline-gated | `day-ne` / `low-angle` / `night-lanterns` compare against committed baselines at 1.5%; extending the set means adding IDs to `PIXEL_GATED_FIXTURES` and regenerating through the `webgl-baselines` workflow |
| P2 | `src/elements/**` branch coverage (80%) now trails its statement coverage | The draw bodies are covered; what is left is per-branch lighting and edge cases inside `Floor` (62% branches) and `Wall` (73%) |
| P2 | `Boulder.aabb.maxZ` is `radius * 2` but the rock draws ~`0.55 * radius` tall | Measured and pinned in `src/__tests__/Boulder.test.ts`. `maxZ` feeds `depthSort` and `ShadowCaster`, so the rock occludes and shadows as a column it does not fill. Correcting it changes gated fixture pixels (`mossy-boulder`), so it belongs with a baseline regeneration |
| P2 | `Chest.aabb.maxZ` ignores the lid swinging up | Measured and pinned in `src/__tests__/Chest.test.ts`: closed it fits the declared 51.2 px, open it does not. Same constraint as the boulder — `garden-chest` is in a gated fixture |
| P2 | Custom serialization needs one registration per direction | `Engine.registerProp()` / `registerLight()` load, `SceneSerializer.register()` / `registerLight()` save. Registering only one side is a silent half-round-trip (the save side warns once per type) |
| P2 | `EditorRenderer` rebuilds the whole scene on every state change | Debounce to one rebuild per frame, or mutate objects in place for transform-only edits |
| P2 | `webgl-next` renderer and extraction layers are the remaining coverage gap | `device/**` and `resources/**` are now unit-tested through `src/__tests__/helpers/gl.ts`; `WebGLRenderer` itself still needs the fake context extended to uniforms, buffers and framebuffer binds |
| P3 | System queries scan all Entity instances | Add archetype/query cache if profiling shows a bottleneck |
| P3 | Spatial audio `spatialVolume()` helper is a manual falloff calc | `playSfx({ spatial })` already uses a `PannerNode` + HRTF; the static helper is the legacy path. Its defaults now match the panner's (1 / 10) — they were 2 / 12, so the same options object gave two different curves |
| P3 | Editor: snap/grid toggle for fine-grained object placement | Sub-tile precision mode |
| P3 | Sprite editor: multi-sheet support, frame-range trimming | Advanced animation authoring |



## License

[MIT](LICENSE) © 2026 dreamsxin

Release maintainers should follow [RELEASING.md](RELEASING.md).
