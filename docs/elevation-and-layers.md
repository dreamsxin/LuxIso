# Elevation and layers

A design note, not an implementation. It exists because "put a second storey in
the scene" currently has no answer, and the reason is structural rather than a
missing field.

Status: proposal. Nothing here is built.

## 1. What the engine can and cannot express today

It can express **one** ground plane and **per-object height above it**:

- `IsoObject.position.z` is a screen-pixel offset, subtracted straight from `sy`
  (`src/math/IsoProjection.ts:64-76`).
- `AABB.baseZ` / `AABB.maxZ` give an object a vertical extent, and `topoSort`
  uses it when two footprints overlap (`src/math/depthSort.ts:37-40`).
- `Wall` has a pixel `height`; `SlopeTerrain` carries a corner height field and
  `SlopeCharacter` samples it to follow the surface
  (`examples/09-slopes/SlopeTerrain.ts:145-155`).

It cannot express a **second walkable surface above the first**. Four separate
reasons, each of which has to be addressed:

1. **`Floor` is structurally pinned to the bottom.** It never enters `topoSort`:
   `SceneRenderer._partition` routes every `Floor` into `_floorBuf`
   (`src/core/SceneRenderer.ts:140-149`), which is baked into the lightmap and
   blitted *before* the camera transform (`:87`, `:195`). Its constructor
   hardcodes the origin — `super(opts.id, 0, 0, 0)` (`src/elements/Floor.ts:57`)
   — and its `aabb` hardcodes `baseZ: 0` with no `maxZ` (`:72-74`).
   `FloorOptions` has no elevation field at all (`:9-26`).
2. **Collision is a single flat grid.** `Scene.collider` is one nullable
   `TileCollider` (`src/core/Scene.ts:28`), whose storage is `grid[row][col]` of
   booleans (`src/physics/TileCollider.ts:8`). No method takes a z or a layer;
   the file contains no occurrence of z, height, elevation or layer.
   `MovementComponent` interpolates z independently and never feeds it to
   collision (`src/ecs/components/MovementComponent.ts:229-231`, `:260`).
3. **Pathfinding is that same grid.** `Pathfinder.find(collider, …)` queries only
   `isWalkable` (`src/physics/Pathfinder.ts:262`, `:354`), 8-way with octile
   heuristic, no terrain or height cost, and returns `IsoVec2` — x and y only
   (`:368`).
4. **Picking assumes the ground plane.** `unproject` has no z parameter and is
   documented as "at z=0" (`src/math/IsoProjection.ts:78-92`).

## 2. The projection constraint that decides the design

`project` is:

```
sx = (x - y) * tileW / 2
sy = (x + y) * tileH / 2 - z
```

`sx` depends only on `x - y`, so the set of world points landing on one screen
pixel is the ray

```
(x, y, z) = (x0 + t, y0 + t, z0 + t * tileH)
```

Two consequences, and they are the whole reason this document recommends what it
does.

**Layer height should be an integer multiple of `tileH`.** At `t = 1` the ray
reaches tile `(x0+1, y0+1)` exactly `tileH` pixels higher. So a tile at
`(c, r)` on a layer raised by `tileH` occupies the same screen position as tile
`(c+1, r+1)` on the layer below. Any other step size puts the two grids out of
phase and every layer needs its own half-pixel reasoning. This is the same
alignment Excalibur gets by stacking `IsometricMap`s and adjusting `elevation`
together with `y`.

**Picking is a ray walk, not an inverse.** Given a screen point there is one
candidate `(layer, tile)` per layer, and they are all legitimate hits. The right
answer is the highest layer whose tile is actually occupied, tested top-down —
which is why `unproject`'s z=0 assumption cannot simply be patched with an extra
argument. Concretely: read `unproject` for the ground candidate, then for a layer
at elevation `e` the candidate is that result shifted by `e / tileH` tiles on
both axes. With `tileH = 32` and `e = 64`, that is two tiles on each axis — the
same offset that today silently corrupts any pick against a raised object.

## 3. Constraints inherited from existing code

These are contracts a design has to either honour or explicitly break.

- **Z is measured in screen pixels, XY in world tiles.** Stated at
  `src/math/depthSort.ts:1-23` and `src/math/IsoProjection.ts:33-50`, which also
  records that a previous `Z_UNITS_PER_PX = 1/16` convention only held at
  `tileH = 32` and caused a Canvas2D/WebGL divergence. Do not reintroduce a
  second unit.
- **That convention is already violated in the slopes example.**
  `SlopeTerrain.aabb` returns `maxZ: this.maxH` in world units
  (`examples/09-slopes/SlopeTerrain.ts:157-163`), and `SlopeCharacter` hardcodes
  the conversion with `baseZ: this.position.z * 32, // approx tileH=32`
  (`:38-49`). Any layered design inherits this crack unless it is fixed first.
- **`MIN_Z_EXTENT_PX = 16`** is the fallback thickness when `maxZ` is absent
  (`src/math/depthSort.ts:19`, `:37-38`). Flat surfaces are 16px slabs, not
  infinite columns — chosen as half a standard 32px tile.
- **`topoSort`'s ordering key has no Z term**: `depths[i] = (minX + maxX + minY +
  maxY) / 2` (`:141`). Z only enters through `isBehind`, and only in the branch
  where footprints overlap and Z ranges do not (`:37-40`).
- **`isGroundLayer` is the existing escape hatch** for full-map flat overlays:
  drawn after the lightmap, before sorted objects, in insertion order, excluded
  from `topoSort` and from shadow casting (`src/elements/IsoObject.ts:49-67`,
  `src/core/SceneRenderer.ts:144`). It carries no z.
- **Serialisation is single-floor, and already lossy.** `json.floor` is one
  object (`src/core/Engine.ts:88-98`), and `SceneSerializer.toJSON` writes
  `floors[0]` only (`src/core/SceneSerializer.ts:184`) — additional `Floor`
  instances are dropped silently, because `Floor` is in `BUILT_IN_TYPES` and so
  never reaches the custom-prop path. The WebGL extractor, by contrast, already
  handles many floors (`webgl-next/src/extraction/SceneExtractor.ts:216-230`).
  That asymmetry is a live bug independent of this design.
- **`walkable` does not live on `Floor`.** It is a JSON field on `floor`
  (`src/core/Engine.ts:96-97`) that becomes a `TileCollider`, sized from
  *scene-level* `cols`/`rows` rather than the floor's own
  (`src/core/Engine.ts:401-402`, `:482-488`) — so a floor and its collider can
  disagree in size today with nothing reporting it.
- **Consumers assume one grid of scene dimensions**: `Minimap` (`:126-139`),
  `DebugRenderer` (`:173-191`), the GL collision overlay and minimap bitmap
  (`SceneExtractor.ts:1009-1012`, `:1101`), and `SceneSerializer` (`:185-189`).
- **`PathCache` is keyed by `"sc,sr→gc,gr"`** and scoped by collider identity
  plus `collider.version` (`src/physics/Pathfinder.ts:215-226`, `:125-131`). A
  layer dimension has to enter the key, or paths will collide across storeys.

## 4. Options considered

### A. Height field only (generalise the slopes example)

Replace the flat floor with a corner-height grid, as `SlopeTerrain` already does,
and let characters sample it.

Rejected as the primary model. A height field is a single-valued function of
`(x, y)`, so it cannot express *anything with space underneath*: no bridge, no
second storey, no cave mouth. It is also the model the engine accidentally has
already, and the thing that is missing is precisely what it cannot do.

Kept as an orthogonal feature — see the recommendation.

### B. Many `Floor` instances with an elevation field

Give `FloorOptions` an `elevation` (pixels), stop hardcoding the origin, let
several floors coexist.

Attractive because the runtime already tolerates multiple floors. But it does not
survive contact with `_floorBuf`: floors are baked into a single lightmap and
blitted before the camera transform, so "raised floor" would still draw under
everything. Making floors participate in `topoSort` instead means giving up the
per-tile lighting cache that makes `Floor.draw` affordable — the colour cache is
keyed on the whole light set (`src/elements/Floor.ts:171-188`) and assumes one
plane. The lighting rework is the real cost here, and it is hidden behind what
looks like a one-field change.

### C. An explicit layer container (recommended)

A `TileMap` owning ordered `TileMapLayer`s, each with its own elevation, tile
data, and walkability. `Floor` stays as the single-layer convenience wrapper it
is today, expressed as a `TileMap` with one layer at elevation 0.

This is chosen because it makes the layer a first-class thing that sorting,
collision, pathfinding, picking and serialisation can all agree on, and because
it admits the height field from option A *inside* a layer without conflict:
discrete layers give bridges and storeys, a per-layer height field gives ramps
and rolling ground. The two are orthogonal and both are wanted.

Excalibur reaches the same shape from the other direction — stacked
`IsometricMap`s plus `IsometricEntityComponent` so arbitrary entities join the
isometric draw order. melonJS gets it from Tiled's layer model. Neither treats
"one floor" as the base case.

## 5. Recommended shape

```
TileMap
  layers: TileMapLayer[]        // ordered by elevation, ascending
  layerHeightPx: number         // must be a multiple of tileH; default tileH

TileMapLayer
  elevationPx: number           // layerIndex * layerHeightPx
  cols, rows
  tiles: /* existing Floor colour/image fields */
  walkable: Uint8Array          // cols*rows, row-major — replaces boolean[][]
  heightField?: Float32Array    // optional, (cols+1)*(rows+1) corner heights
```

Four decisions worth stating explicitly, because they are the ones that will be
argued about:

**Layers are drawn as whole units, and tiles inside a layer are not sorted
against each other.** This is what `SlopeTerrain` already does (one sortable,
internal draw order) and what keeps the cost bounded. A layer enters `topoSort`
once, with `baseZ = elevationPx` and `maxZ = elevationPx + layerHeightPx`.

**Objects belong to a layer, and their `position.z` stays relative to that
layer.** An entity on layer 1 at `z = 0` is at world `z = layerHeightPx`. This
keeps existing object code unchanged — nobody has to learn absolute elevation —
and gives collision an unambiguous layer to query. The alternative (absolute z
everywhere, derive the layer by dividing) makes every gameplay call site
responsible for a conversion, which is how the `SlopeCharacter` `* 32` crack
appeared.

**Inter-layer movement is explicit, not inferred.** Stairs and ramps are declared
connections between `(layer, tile)` pairs, not detected from geometry. Inferring
them means the pathfinder has to guess the designer's intent from height deltas,
and every such guess becomes a bug report. A connection is a graph edge with a
cost; that is all the A* needs.

**One collider per layer, addressed through a container.** `Scene.collider`
becomes a `LayeredCollider` holding one grid per layer plus the connection list.
Its single-layer accessor keeps the current API working.

## 6. Staging

Each stage leaves `main` releasable and is worth landing on its own, which is the
only way a change this wide gets finished. Stage 1 and 2 have value even if the
rest is abandoned.

### Stage 1 — close the unit crack, and pin cross-layer sorting

No new capability. Fix `SlopeTerrain.aabb` and `SlopeCharacter` to use the pixel
convention instead of world units with a hardcoded `* 32`, and add `depthSort`
cases for footprint-overlapping objects at disjoint Z ranges — the branch a
layered scene will lean on hardest. One such case exists
(`src/__tests__/depthSort.test.ts:90-99`); what is missing is the *failing*
direction: footprints that do **not** overlap while the screen projections do.
Expect that to expose a genuine ordering defect, because `depths` has no Z term
and branch ① compares XY centres only. Document it rather than papering over it.

Verification: existing suite stays green; new `depthSort` cases describe current
behaviour, with any known-wrong case marked as such.

### Stage 2 — many floors, honestly serialised

Make `SceneSerializer` and `Engine.buildScene` handle a floor *array*, closing the
silent `floors[0]` drop. Still one plane — elevation stays 0 — so nothing about
rendering or collision changes. Add the size check that `Engine` currently omits
between floor dimensions and collider dimensions.

Verification: round-trip a two-floor scene through `toJSON` → `buildScene` and
assert both survive; assert the mismatched-size case produces a diagnostic.

### Stage 3 — elevation, rendering only

Introduce `TileMapLayer` with `elevationPx`, and give raised layers their own
lightmap so `_floorBuf` stops being a single plane. Layers enter `topoSort` as
whole units. Nothing walks on them yet.

This is the stage with real risk: it touches the lightmap cache, whose key
assumes one plane (`src/elements/Floor.ts:171-188`), and it changes pixel output,
so the three committed baselines will genuinely need re-minting this time.

Verification: a fixture with two layers where the upper one demonstrably occludes
an object on the lower; `ExtractionScale` numbers recorded before and after, since
per-layer lightmaps change the vertex and segment counts.

### Stage 4 — walking, pathing, picking

`LayeredCollider`, explicit stair/ramp connections, layer in the `PathCache` key,
and top-down ray picking that replaces the z=0 `unproject` assumption for scenes
with more than one layer.

Verification: a path that must climb (start and goal on different layers, only
route via a declared stair); a pick test at `tileH`-multiple elevations asserting
the upper layer wins; `PathCache` invalidation when any layer's grid version
changes.

## 7. What breaks, in order of blast radius

1. `Scene.collider` type changes. Every holder of a raw `TileCollider` reference
   is affected: `MovementComponent`, `ClickMover`, `Combatant` in the ARPG
   example. Mitigated by keeping a single-layer accessor, not by changing them
   all at once.
2. The scene JSON schema gains a layer dimension. Stage 2 makes the floor field
   an array; stage 3 adds elevation. Old scenes must keep loading — a single
   `floor` object means "one layer at elevation 0".
3. `Minimap`, `DebugRenderer` and the GL collision overlay all iterate one grid
   of scene dimensions and need a layer to render (probably "the layer the camera
   target is on", which is a gameplay question, not a rendering one).
4. Pixel baselines, at stage 3.
5. `Floor`'s public surface. It should keep working unchanged; if it cannot, that
   is a signal the layer model is wrong rather than a reason to break it.

## 8. Open questions

- **Which layer does an off-layer object belong to?** A thrown projectile between
  storeys, or a bird. Probably "the layer it was spawned on, until something moves
  it", but a rule is needed before the first bug.
- **Does the camera know about layers?** Occlusion of the player by an upper floor
  is the classic isometric problem; solutions range from hiding layers above the
  player to per-layer alpha. Out of scope here, but the layer model has to permit
  it.
- **Do lights belong to a layer?** A lantern on the ground floor should not light
  the room above through its ceiling. Today lights are global and the lightmap is
  one plane, so this question does not exist yet; at stage 3 it does.
- **How do shadows cross layers?** `ShadowProjector` casts onto the ground plane.
  An upper floor should receive shadows from objects on it, and probably occlude
  the ones below. Unresolved, and possibly the hardest single item in this
  document.
- **Should `isGroundLayer` be folded into the layer model?** It is currently an
  escape hatch with exactly the semantics a layer wants, minus elevation. Merging
  them is tempting but would change the draw order of existing terrain overlays.

## 9. Not in scope

Tiled import, although a layered model is a precondition for it — Tiled's
isometric maps are layered, and importing them into a single-plane engine would
throw away the structure. Whoever does the importer should read this first.

