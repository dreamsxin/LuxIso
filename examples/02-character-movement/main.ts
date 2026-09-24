/**
 * Example 02 — Character Movement
 *
 * Demonstrates:
 *   - Character with A* pathfinding
 *   - TileCollider (blocked tiles)
 *   - Click-to-move
 *   - Arrow key nudge (collision-resolved via MovementComponent.nudge)
 *   - MovementComponent registered through Entity.addComponent
 */
import {
  Engine, Scene, Floor, Wall, OmniLight,
  Character, TileCollider, MovementComponent, InputManager,
} from '../../src/index';

const COLS = 10, ROWS = 10, TILE_W = 64, TILE_H = 32;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = (COLS + ROWS) * (TILE_W / 2);
canvas.height = (COLS + ROWS) * (TILE_H / 2) + 60;

const engine = new Engine({canvas});
engine.originX = canvas.width / 2;
engine.originY = ROWS * (TILE_H / 2) + 10;

// ── Scene ──────────────────────────────────────────────────────────────────

const scene = new Scene({tileW: TILE_W, tileH: TILE_H, cols: COLS, rows: ROWS});

scene.addObject(new Floor({id: 'floor', cols: COLS, rows: ROWS, color: '#4a7c59', altColor: '#3d6b4a'}));

// A few walls to demonstrate pathfinding around obstacles
for (const [col, row] of [[3, 3], [3, 4], [3, 5], [6, 2], [6, 3]]) {
  scene.addObject(new Wall({id: `w-${col}-${row}`, x: col, y: row, endX: col + 1, endY: row, color: '#8b7355'}));
}

scene.addLight(new OmniLight({x: 5, y: 5, z: 140, color: '#ffe8a0', intensity: 1.3, radius: 350}));

// ── Collision ──────────────────────────────────────────────────────────────

const collider = new TileCollider(COLS, ROWS);
// Block the wall tiles
for (const [col, row] of [[3, 3], [3, 4], [3, 5], [6, 2], [6, 3]]) {
  collider.setWalkable(col, row, false);
}
scene.collider = collider;

// ── Character ──────────────────────────────────────────────────────────────

const character = new Character({id: 'player', x: 1.5, y: 1.5});
scene.addObject(character);

// FIX: register via addComponent so Entity.update() drives it automatically.
// Previously mv.onAttach(character) was called manually, leaving the component
// outside the entity's component map and requiring a manual mv.update(ts) call.
const mv = character.addComponent(new MovementComponent({speed: 3.5, radius: 0.35, collider}));

// ── Input ──────────────────────────────────────────────────────────────────

const input = new InputManager(canvas);

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
  const world = scene.camera.screenToWorld(
    cx, cy, canvas.width, canvas.height, TILE_W, TILE_H, engine.originX, engine.originY
  );
  const tx = Math.max(0.5, Math.min(COLS - 0.5, world.x));
  const ty = Math.max(0.5, Math.min(ROWS - 0.5, world.y));
  mv.pathTo(tx, ty, character.position.z);
});

// ── Loop ───────────────────────────────────────────────────────────────────

const NUDGE = 0.05; // world units per frame

engine.setScene(scene);
engine.start(
  // onFrame (post-draw): flush input state here so wasPressed is valid for the
  // full frame (both preFrame and the draw pass) before being cleared.
  ts => {
    // Arrow key nudge — goes through collision resolution via mv.nudge(),
    // so the character can no longer clip through walls.
    if (input.isDown('ArrowUp')) {mv.nudge(0, -NUDGE);}
    if (input.isDown('ArrowDown')) {mv.nudge(0, NUDGE);}
    if (input.isDown('ArrowLeft')) {mv.nudge(-NUDGE, 0);}
    if (input.isDown('ArrowRight')) {mv.nudge( NUDGE, 0);}

    input.flush(); // clear single-frame wasPressed / wasReleased flags
    void ts; // ts available for future use (e.g. animations)
  }
);
// Note: mv.update(ts) is NOT called here — it is driven automatically by
// character.update() → component.update() inside scene.update() each frame.
