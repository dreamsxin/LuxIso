/**
 * Example 04 — HUD + DebugRenderer + InputMap
 *
 * Demonstrates:
 *   - HudLayer: HP bar, score label, pause button
 *   - DebugRenderer: F1 to toggle collision/AABB/lights overlay
 *   - InputMap: WASD + Arrow keys mapped to move actions
 *   - SceneTransition: fade on scene "restart"
 *   - ObjectPool: reusable particle burst objects
 */
import {
  Engine, Scene, Floor, Wall, OmniLight,
  Character, TileCollider, MovementComponent,
  InputManager, InputMap,
  Crystal, HealthComponent, ParticleSystem,
  HudLayer, DebugRenderer, SceneTransition, ObjectPool,
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
scene.addObject(new Wall({id: 'w1', x: 4, y: 4, endX: 5, endY: 4, color: '#8b7355'}));
scene.addObject(new Wall({id: 'w2', x: 4, y: 5, endX: 5, endY: 5, color: '#8b7355'}));

const light = new OmniLight({x: 5, y: 5, z: 140, color: '#ffe8a0', intensity: 1.3, radius: 350});
scene.addLight(light);

const collider = new TileCollider(COLS, ROWS);
collider.setWalkable(4, 4, false);
collider.setWalkable(4, 5, false);
scene.collider = collider;

// ── Character ──────────────────────────────────────────────────────────────

const character = new Character({id: 'player', x: 2, y: 2});
scene.addObject(character);

const mv = character.addComponent(new MovementComponent({speed: 4, radius: 0.35, collider}));

// ── Crystal prop ───────────────────────────────────────────────────────────

const crystal = new Crystal('gem', 7, 7, '#8060e0');
crystal.addComponent(new HealthComponent({max: 100}));
scene.addObject(crystal);

// ── Input ──────────────────────────────────────────────────────────────────

const input = new InputManager(canvas);
const map = new InputMap(input);

map.define('move_up', ['ArrowUp', 'w', 'KeyW']);
map.define('move_down', ['ArrowDown', 's', 'KeyS']);
map.define('move_left', ['ArrowLeft', 'a', 'KeyA']);
map.define('move_right', ['ArrowRight', 'd', 'KeyD']);
map.define('attack', ['Space', 'Enter']);
map.define('debug', ['F1']);

// ── HUD ────────────────────────────────────────────────────────────────────

const hud = new HudLayer();

hud.addPanel({id: 'panel', x: 10, y: 10, w: 180, h: 70, radius: 6});
const hpBar = hud.addBar({id: 'hp', x: 18, y: 20, w: 160, h: 12, color: '#e04040', label: 'HP'});
const gemBar = hud.addBar({id: 'gem', x: 18, y: 40, w: 160, h: 12, color: '#8060e0', label: 'Gem'});
const scoreLabel = hud.addLabel({id: 'score', x: 18, y: 68, text: 'Score: 0', fontSize: 12, color: '#ffdd88'});

hud.addButton({
  id: 'restart', x: canvas.width - 80, y: 10, w: 70, h: 26,
  label: 'Restart', fontSize: 12,
  onClick: () => transition.between('fade', () => { character.position.x = 2; character.position.y = 2; }),
});

// ── Debug renderer ─────────────────────────────────────────────────────────

const debug = new DebugRenderer(scene, engine.originX, engine.originY, {
  showCollision: true,
  showAABB: true,
  showLights: true,
});

map.on('debug', () => { debug.enabled = !debug.enabled; });

// ── Transition ─────────────────────────────────────────────────────────────

const transition = new SceneTransition(engine.ctx);

// ── Object pool (reusable spark data) ─────────────────────────────────────

interface SparkData {x: number; y: number; active: boolean}
const sparkPool = new ObjectPool<SparkData>(
  () => ({x: 0, y: 0, active: false}),
  s => { s.x = 0; s.y = 0; s.active = false; },
  8, 32
);

let score = 0;
let fxId = 0;

function spawnSparks(x: number, y: number): void {
  const spark = sparkPool.acquire();
  if (!spark) {return;}
  spark.x = x; spark.y = y; spark.active = true;

  const id = `fx-${++fxId}`;
  const ps = new ParticleSystem(id, x, y, 0);
  ps.addEmitter(ParticleSystem.presets.sparkBurst({color: '#8060e0', count: 10}));
  ps.onExhausted = () => { scene.removeById(id); sparkPool.release(spark); };
  ps.burst();
  scene.addObject(ps);
}

// ── Click to damage crystal ────────────────────────────────────────────────

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

  // Check HUD buttons first
  if (hud.handleClick(cx, cy)) {return;}

  const {sx, sy} = scene.camera.worldToScreen(
    crystal.position.x, crystal.position.y, 0,
    TILE_W, TILE_H, engine.originX, engine.originY
  );
  if (Math.hypot(cx - sx, cy - sy) < 32) {
    const hp = crystal.getComponent(HealthComponent);
    if (hp && !hp.isDead) {
      hp.takeDamage(10);
      score += 10;
      spawnSparks(crystal.position.x, crystal.position.y);
      scene.spawnFloatingText({
        x: crystal.position.x, y: crystal.position.y, z: 40,
        text: '-10', color: '#ff4040', duration: 800, fontSize: 16,
      });
    }
  }
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  hud.handleMove(
    (e.clientX - rect.left) * (canvas.width / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height)
  );
});

// ── Loop ───────────────────────────────────────────────────────────────────

engine.setScene(scene);
engine.start(
  ts => {
    // Update HUD values
    const playerHp = 1; // placeholder — add HealthComponent to player if needed
    hpBar.value = playerHp;
    const gemHp = crystal.getComponent(HealthComponent);
    gemBar.value = gemHp ? gemHp.fraction : 0;
    scoreLabel.text = `Score: ${score}`;

    hud.draw(engine.ctx, canvas.width, canvas.height);
    debug.draw(engine.ctx, canvas.width, canvas.height, ts);
    transition.draw(canvas.width, canvas.height, ts);

    // DEBUG overlay
    const sortOrder = scene.sortedObjects.map(object => object.id).join(' -> ') || '-';
    const charPos = `char(${character.position.x.toFixed(2)},${character.position.y.toFixed(2)})`;
    engine.ctx.save();
    engine.ctx.setTransform(1, 0, 0, 1, 0, 0);
    engine.ctx.fillStyle = 'rgba(0,0,0,0.65)';
    engine.ctx.fillRect(0, canvas.height - 44, canvas.width, 44);
    engine.ctx.fillStyle = '#00ff88';
    engine.ctx.font = '11px monospace';
    engine.ctx.fillText(`${charPos}  sort: ${sortOrder}`, 8, canvas.height - 26);
    engine.ctx.fillStyle = '#aaa';
    const aabbs = scene.sortedObjects.map(object => {
      const box = object.aabb;
      const xRange = `X[${box.minX.toFixed(2)},${box.maxX.toFixed(2)}]`;
      const yRange = `Y[${box.minY.toFixed(2)},${box.maxY.toFixed(2)}]`;
      return `${object.id}:${xRange}${yRange}`;
    }).join(', ');
    engine.ctx.fillText(aabbs, 8, canvas.height - 10);
    engine.ctx.restore();
  },
  _ts => {
    // Movement via InputMap
    const {x, y} = map.axis('move_right', 'move_left', 'move_down', 'move_up');
    const SPEED = 0.08;
    if (x !== 0 || y !== 0) {
      mv.stopMoving();
      character.position.x = Math.max(0.5, Math.min(COLS - 0.5, character.position.x + x * SPEED));
      character.position.y = Math.max(0.5, Math.min(ROWS - 0.5, character.position.y + y * SPEED));
    }

    // Attack action
    if (map.wasPressed('attack')) {
      const gemHp = crystal.getComponent(HealthComponent);
      if (gemHp && !gemHp.isDead) {
        gemHp.takeDamage(20);
        score += 20;
        spawnSparks(crystal.position.x, crystal.position.y);
      }
    }

    input.flush();
  }
);
