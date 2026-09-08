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
- **ClickMover** — click-to-move + keyboard movement helper; animated marker; collision-aware
- **Sprite animation** — `SpriteSheet` + `AnimationController` (idle/walk state machine, 8-direction)
- **Directional animator** — `DirectionalAnimator`; clip naming `action_DIR`; fallback chain; `playOnce()`
- **Particle system** — `ParticleSystem`; procedural circle/square + sprite mode; blend modes; preset factories: sparkBurst, dustPuff, crystalShatter, coinSpill, ambientDrift, plus the `FIRE` / `SMOKE` emitter configs
- **Tile collision** — `TileCollider` walkable grid; AABB slide-and-clamp; `sweepMove()` binary search with fast-path; `MovementComponent.nudge(dx,dy)` collision-resolved directional move
- **A\* Pathfinder** — 8-directional, corner-cut prevention, Bresenham LoS string-pull, min-heap O(log n); instance-level `PathCache` (per-scene, zero cross-scene pollution); `cache.invalidate()`
- **ECS** — constructor-keyed components plus priority-ordered `System` queries with variable and fixed-rate updates
- **EventBus** — `EventBus<EventMap>` couples event names to payload types; typed built-ins and custom events; `globalBus` singleton
- **Components** — `HealthComponent` (unified EventBus emit on damage/death), `MovementComponent` (nudge + A* pathTo), `TimerComponent`, `TweenComponent` (8 easings, yoyo, repeat), `TweenSequence` (chained tweens), `TriggerZoneComponent` (zero per-frame GC)
- **Props** — `Crystal`, `Boulder`, `Chest`, `Tree`, `FlowerPatch`, `Lantern`, `Cloud`, `FloatingText`; canvas-drawn, ECS-powered
- **Audio** — `AudioManager`; one-shot SFX, looping BGM with crossfade, spatial distance attenuation, 3-bus volume (master/sfx/bgm)
- **JSON scene loader** — `SceneSerializer` + `engine.loadScene()` round-trip scene environment, camera, lights, built-in objects, and collision map
- **Scene validator** — `validateSceneJson()`; runtime JSON schema check + ECS component assertions
- **Scene editor** — visual editor (`editor.ts`); undo/redo, walkable/blocked drag-paint, object list, property panel, JSON export/import; right-click delete; DirectionalLight placement; keyboard shortcuts (`V/W/L/D/C/1/2/3/B/P`); `camera.screenToWorld` for zoom/pan-accurate picking
- **Sprite editor** — sprite sheet frame inspector and animation clip builder (`sprite-editor.ts`); 8-direction live preview (cached `Map<Direction,DirCell>`); `anchorY` control; click-frame inspection with action/dir hint; JSON export + import; data URL upload support
- **AssetLoader** — instanceable image preloader; per-scene isolation; `unload(url)`; `size` getter; `register(url, img)` for data-URL injection (sprite editor); static API delegates to `AssetLoader.default` (backwards-compatible)
- **PathCache** — per-scene A* result cache; `new PathCache(capacity)`; `invalidate()`; pass to `Pathfinder.find()` for zero cross-scene pollution
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
npm run encoding:check  # verify source file encodings (runs before both builds)
npm run encoding:fix    # rewrite offending files in place
npx playwright install chromium  # one-time browser install
npm run test:webgl # run 9 deterministic captures + context/resource lifecycle tests
```

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
document.addEventListener('click', () => audio.resume(), { once: true });
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
  ]
}
```

## Coordinate System & Z Units

The engine uses a standard 2:1 isometric projection. Understanding the two
distinct Z conventions is essential for correct depth sorting:

```ts
// project(): world (x,y,z) -> screen (sx, sy)
sx = (x - y) * (tileW / 2)
sy = (x + y) * (tileH / 2) - z
```

- **`position.z` is in SCREEN PIXELS.** It is subtracted directly from `sy` by
  `project()`, so a character at `z=48` renders 48 pixels above the ground.
  `Camera.applyTransform()` applies rotation/elevation as a canvas 2D transform;
  `project()` itself ignores the `IsoView` argument (kept for API stability).
  Callers needing a view-aware screen position outside the transformed canvas
  should use `Camera.worldToScreen(..., view)`.

- **AABB `baseZ` / `maxZ` are in WORLD-Z UNITS**, where
  `1 unit == tileH / 2 pixels` (≈16 px for `tileH=32`). The conversion factor is
  exported as `Z_UNITS_PER_PX = 1/16`. Every object's `get aabb()` getter
  converts its pixel-based height into this unit so that `depthSort`'s
  `overlapZ` comparisons and `ShadowCaster` projections are consistent across
  classes (Wall, Character, Crystal, Boulder, Chest, Cloud, …).

  ```ts
  // Example: a Wall of height 80px
  wall.aabb.maxZ === 80 * Z_UNITS_PER_PX   // = 5.0 world-Z units
  // A Character of radius 22px (upper half above anchor)
  char.aabb.maxZ === position.z*Z_UNITS_PER_PX + 22*Z_UNITS_PER_PX  // ≈ 1.375
  ```

  `position.z` stays in pixels for rendering; the pixel→world-unit conversion
  happens only inside each `aabb` getter. Do not mix the two when constructing
  custom objects—always multiply pixel heights by `Z_UNITS_PER_PX` for AABB Z.

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
├── index.ts                     # Public API barrel — 80+ exports
├── main.ts                      # Interactive demo
├── core/
│   ├── AssetLoader.ts           # Promise image cache; loadImage / loadAll / get
│   ├── Camera.ts                # follow / pan / zoom / applyTransform / clamp; frame-rate-independent lerp
│   ├── ClickMover.ts            # Click-to-move + keyboard movement; animated marker; collision-aware
│   ├── DebugRenderer.ts         # Overlay: collision grid, AABB, light radii, triggers, FPS
│   ├── Engine.ts                # RAF loop; JSON loader (floor/walls/lights/chars/props/clouds); pre/postFrame
│   ├── HudLayer.ts              # Canvas-space UI: labels, bars, buttons, panels
│   ├── InputManager.ts          # Raw keyboard/pointer state; per-frame flush
│   ├── InputMap.ts              # Action-binding layer over InputManager; axis(); toJSON/fromJSON
│   ├── LightmapCache.ts         # OffscreenCanvas floor cache; isDirty snapshot; blit()
│   ├── Minimap.ts               # OffscreenCanvas HUD overlay; walkable grid + object dots
│   ├── ObjectPool.ts            # Generic object pool; acquire/release/releaseAll; prewarm
│   ├── Scene.ts                 # Object/light container; lifecycle; Systems; IsoView transitions
│   ├── SceneRenderer.ts         # Culling; sorting; shadows; lightmap; object rendering
│   ├── SceneSerializer.ts       # Built-in scene JSON serialization
│   ├── SceneManager.ts          # Named scene stack; push/pop/replace/goto; lifecycle hooks
│   ├── SceneTransition.ts       # Canvas transition effects: fade, slide, circle-wipe; playIn/playOut/between
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
│       └── FloatingText.ts      # Floating text; auto-expires; depth-sorted; Scene.spawnFloatingText()
├── animation/
│   ├── SpriteSheet.ts           # AnimationClip (frames, fps, loop); AssetLoader preload
│   ├── AnimationController.ts   # State machine; 8-direction; idle↔walk; dt-based
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
│       ├── HealthComponent.ts   # hp / maxHp / fraction / isDead; takeDamage / heal; callbacks
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
│   ├── scenes/                  # PlainsScene, LakeScene, DeepSeaScene
│   ├── entities/                # CubeHero, Portal, Animals, AquaticLife
│   └── environment/             # LowPolyTree, DayNightCycle
├── 06-voxel-lake/               # Voxel wave simulation, seabed decor
├── 07-desert-ruins/             # Procedural terrain, interactive props, portals
├── 08-volcano/                  # Lava terrain, particle FX, burn damage, click-to-move
└── 09-slopes/                   # Height-map terrain, bilinear interpolation, smooth voxel hills

public/
└── scenes/
    └── level1.json              # 16×10 demo scene: floor + walkable map, 4 walls, OmniLight + DirectionalLight, player, 3 props
```

## API Reference

### `Engine`

```ts
new Engine({ canvas: HTMLCanvasElement })
engine.originX: number                          // iso origin X in canvas pixels
engine.originY: number                          // iso origin Y
engine.loadScene(url: string): Promise<Scene>   // fetch + parse JSON; builds all objects + collider
engine.buildScene(json: object): Scene          // synchronous, no fetch
engine.setScene(scene: Scene): void
engine.start(postFrame?, preFrame?): void       // postFrame runs after draw; preFrame before draw
engine.stop(): void
engine.ctx: CanvasRenderingContext2D
engine.canvas: HTMLCanvasElement
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
mover.velX: number; mover.velY: number         // per-frame displacement (add to position)
mover.reset(): void                            // clear target + velocity (call on scene enter)
mover.drawMarker(ctx, camera, tileW, tileH, originX, originY, ts): void  // animated click ring
```

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
hp.takeDamage(amount): void
hp.heal(amount): void
hp.setMax(max, scaleCurrentHp?): void
```

### `MovementComponent`

```ts
new MovementComponent({ speed?, collider?, bus? })
mv.moveTo(x, y, z?): void
mv.pathTo(x, y, z?): boolean     // A* via attached collider; false = unreachable
mv.followPath(waypoints, z?): void
mv.stopMoving(): void
mv.isMoving: boolean
// Emits EventBus: 'move' each frame, 'arrival' on destination reached
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
timer.elapsed: number   // seconds elapsed in current cycle
timer.fraction: number  // 0–1 progress through current cycle
timer.isDone: boolean; timer.isRunning: boolean
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
ps.onExhausted: (() => void) | null   // called when the last particle dies

// Preset emitter configs. Pass the result to addEmitter():
//   ps.addEmitter(ParticleSystem.presets.sparkBurst());
ParticleSystem.presets.sparkBurst()
ParticleSystem.presets.dustPuff()
ParticleSystem.presets.crystalShatter()
ParticleSystem.presets.coinSpill()
ParticleSystem.presets.ambientDrift({ color?, count?, speed?, size?, alpha?, blend?, shape? })
ParticleSystem.presets.FIRE     // plain config object, not a function
ParticleSystem.presets.SMOKE    // plain config object, not a function
```

Only `ambientDrift` reads its options argument; the other factories currently
ignore any argument and return a fixed config. There is no `autoRemove` field —
remove an exhausted system yourself, e.g. from `onExhausted`.


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
  baseZ: number;    // bottom Z of the bounding volume
  maxZ?: number;    // top Z; omit for flat/ground objects (treated as infinite upward extent)
}
// Setting maxZ enables vertical separation: objects that don't share Z space
// are sorted by baseZ rather than XY heuristic, preventing terrain from
// occluding elevated characters.
```

### `AudioManager`

```ts
const audio = new AudioManager()
audio.resume()
audio.masterVolume = 0.8
audio.sfxVolume = 1
audio.bgmVolume = 0.6
audio.playSfx(url, { volume?, rate?, loop?, spatial? }): AudioBufferSourceNode | null
audio.playBgm(url, fadeDuration?): Promise<void>
audio.stopBgm(fadeDuration?)
audio.preload(url): Promise<void>
audio.preloadAll(urls): Promise<void>
audio.suspend(): void
audio.updateListener(x, y, z?): void
audio.dispose(): void   // stop BGM, close the AudioContext, drop the buffer cache
AudioManager.spatialVolume({ x, y, listenerX, listenerY, refDistance?, maxDistance? }): number
// Legacy manual falloff helper. `playSfx(url, { spatial })` uses a real
// Web Audio PannerNode with HRTF instead and should be preferred.
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
DirectionalAnimator.auditSheet(sheet, action)   // { present, missing }
```

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
hud.draw(ctx, canvasW?, canvasH?): void       // call in postFrame; resets transform to screen space
hud.handleClick(x, y): boolean               // returns true if a button was hit
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

## Roadmap

### Completed ✅

| Module | Notes |
|---|---|
| Isometric math (project / unproject / depthKey / drawIsoCube) | |
| Topological depth sort - 3-D AABB + containment detection + maxZ | |
| Depth sort: Z-aware containment + unified Z-unit convention | `isBehind` now compares `maxZ` when one footprint contains another; all object AABBs use `Z_UNITS_PER_PX` (1 unit = tileH/2 px) |
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
| PathCache: per-scene A* cache; invalidate(); passed to Pathfinder.find() | |
| ECS: HealthComponent unified EventBus emit; MovementComponent.nudge(); TriggerZone zero-GC | |
| Performance: depthSort spatial buckets + min-heap Kahn queue; renderer AABB hash; frustum cull in-place | |
| Engine: PropRegistry + LightRegistry (open for extension) | |
| Scene split: SceneRenderer + SceneSerializer | Container/lifecycle remains in Scene; public draw/toJSON APIs unchanged |
| ECS System layer + constructor component keys | Batch queries, priority order, fixed update, attach/detach lifecycle |
| EventBus event maps | Event names and payload types are coupled; custom maps supported |
| Scene.toJSON(): runtime state + built-in prop serialization | Environment, camera, view, light IDs/options, collider, built-ins |
| Lib build: ESM + CJS dual output + .d.ts (npm run build:lib) | |
| Unit tests: 293 tests across 39 files (Vitest 4, Node ≥ 22) | |
| Examples: 9 progressive demos + tools gallery | |

## Known Limitations & Roadmap (Next)

See [FRAMEWORK_ANALYSIS.md](FRAMEWORK_ANALYSIS.md) for a detailed comparison with Excalibur.js, Phaser 3, Godot 4, and Bevy ECS.

| Priority | Item | Notes |
|----------|------|-------|
| P1 | `example-05` movement bypasses `MovementComponent` | `ClickMover` mutates `position` directly; only the Plains scene has a `TileCollider` at all, so Lake/DeepSea heroes are bounds-clamped but not collision-aware |
| P1 | `example-05` sky draw functions (400+ lines) inline in `main.ts` | Split to `environment/*.ts` |
| P1 | WebGL golden captures are not compared against a baseline | CI only asserts colour-histogram heuristics; the 1.5% pixel-diff gate in [ACCEPTANCE.md](webgl-next/ACCEPTANCE.md) is not active |
| P1 | Playwright suite runs the Vite **dev** server, not the build | `playwright.webgl.config.ts` starts `npm run dev`, so the production bundle is never exercised |
| P2 | No coverage reporting | Add `@vitest/coverage-v8` plus per-module thresholds; test count is not coverage |
| P2 | `SceneManager` does not auto-clear `AssetLoader` on scene exit | Add `assetLoader?` to `ManagedScene` |
| P2 | Custom prop serialization requires application code | Add serializer registry paired with `registerProp()` |
| P2 | `EditorRenderer` rebuilds the whole scene on every state change | Debounce to one rebuild per frame, or mutate objects in place for transform-only edits |
| P2 | `webgl-next` `TextureRegistry` never evicts | Reference-count or LRU-evict per frame; `dispose()` should delete its own GL textures |
| P3 | System queries scan all Entity instances | Add archetype/query cache if profiling shows a bottleneck |
| P3 | Spatial audio `spatialVolume()` helper is a manual falloff calc | `playSfx({ spatial })` already uses a `PannerNode` + HRTF; the static helper is the legacy path |
| P3 | Editor: snap/grid toggle for fine-grained object placement | Sub-tile precision mode |
| P3 | Sprite editor: multi-sheet support, frame-range trimming | Advanced animation authoring |
| P3 | Dual Z-unit convention is a public API cost | Unify world height units in a new major; keep explicit converters for the old API |


## License

[MIT](LICENSE) © 2026 dreamsxin

Release maintainers should follow [RELEASING.md](RELEASING.md).
