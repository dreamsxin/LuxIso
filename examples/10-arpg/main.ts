/**
 * 10 — ARPG Arena
 *
 * A closed run on the WebGL2 backend: spawn, three waves, a boss, a result.
 *
 * Demonstrates, in the order it matters:
 *   • `SceneExtractor.register` — a custom `Entity` rendered by the GL path
 *   • `HudOverlayRenderer` — the framework's `HudLayer` stacked over the GL canvas
 *   • `InputMap` + `TouchStick` — one movement axis for keyboard and thumb alike
 *   • `MovementComponent.nudge` — swept, collided player movement
 *   • `WaveDirector` — the run structure, driven by kill reports, not by the loop
 *
 * Controls: WASD / arrows or the lower-left stick to move, Space / J or the
 * ATTACK button to swing, R to restart.
 */
import {
  Scene, Floor, TileCollider, InputManager, InputMap, TouchStick, HudLayer,
  OmniLight, DirectionalLight,
} from '../../src/index';
import { SceneExtractor } from '../../webgl-next/src/extraction/SceneExtractor';
import { WebGLRenderer } from '../../webgl-next/src/renderer/WebGLRenderer';
import { HudOverlayRenderer } from '../../webgl-next/src/overlays/HudOverlayRenderer';
import { Combatant } from './Combatant';
import { registerCombatantExtractor } from './CombatantExtractor';
import { WaveDirector, type ArpgPhase } from './WaveDirector';

const COLS = 14, ROWS = 14;
const HERO_SPEED = 3.2;
const ARENA_MIN = 0.6, ARENA_MAX = COLS - 1.6;

const glCanvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud-canvas') as HTMLCanvasElement;
const fallback = document.getElementById('fallback') as HTMLDivElement;

let renderer: WebGLRenderer;
try {
  renderer = new WebGLRenderer(glCanvas);
} catch {
  fallback.style.display = 'flex';
  throw new Error('WebGL 2 unavailable');
}

registerCombatantExtractor();

// ── Scene ─────────────────────────────────────────────────────────────────────

const collider = new TileCollider(COLS, ROWS);
const scene = new Scene({ name: 'Arena', tileW: 64, tileH: 32, cols: COLS, rows: ROWS });
scene.collider = collider;
scene.dynamicLighting = true;
scene.ambientColor = '#8aa0b8';
scene.ambientIntensity = 0.42;

scene.addObject(new Floor({ id: 'floor', cols: COLS, rows: ROWS, color: '#2b3340', altColor: '#242b36' }));
scene.addLight(new DirectionalLight({ id: 'sun', angle: 225, elevation: 55, color: '#ffe8c0', intensity: 0.7 }));
scene.addLight(new OmniLight({ id: 'brazier', x: COLS / 2, y: ROWS / 2, z: 90, color: '#ffb060', intensity: 0.55, radius: 320 }));

// ── Input ─────────────────────────────────────────────────────────────────────

// The GL canvas backing store is `logical * devicePixelRatio`, so the pointer has
// to be divided back down or every HUD hit box would be off by that factor.
const input = new InputManager(glCanvas, {
  pixelRatio: () => Math.max(1, window.devicePixelRatio || 1),
});
const map = new InputMap(input);
map.define('move_up', ['w', 'W', 'ArrowUp']);
map.define('move_down', ['s', 'S', 'ArrowDown']);
map.define('move_left', ['a', 'A', 'ArrowLeft']);
map.define('move_right', ['d', 'D', 'ArrowRight']);
map.define('attack', [' ', 'Space', 'j', 'J']);
map.define('restart', ['r', 'R']);

const stick = new TouchStick({ x: 110, y: 260, radius: 56 });
map.addAxisSource(stick);

// ── HUD ───────────────────────────────────────────────────────────────────────

const hud = new HudLayer();
hud.minHitSize = 44;
const hpBar = hud.addBar({ id: 'hp', x: 16, y: 16, w: 190, h: 15, color: '#5ad07a', label: 'HP' });
const waveLabel = hud.addLabel({ id: 'wave', x: 16, y: 50, text: '', color: '#cfe4f0', fontSize: 14 });
const phaseLabel = hud.addLabel({ id: 'phase', x: 16, y: 70, text: '', color: '#8fb8d0', fontSize: 12 });
const resultLabel = hud.addLabel({ id: 'result', x: 16, y: 96, text: '', color: '#ffd890', fontSize: 18, visible: false });
const attackButton = hud.addButton({
  id: 'attack', x: 0, y: 0, w: 92, h: 92, label: 'ATTACK',
  bgColor: 'rgba(200,80,60,0.55)', hoverColor: 'rgba(240,120,90,0.8)',
  onClick: () => swingHero(),
});
const hudOverlay = new HudOverlayRenderer(hudCanvas, hud, {
  // The stick is not a HudLayer element type, so it paints through the overlay's
  // own hook rather than by reaching for the 2D context behind its back.
  paint: (ctx) => stick.draw(ctx),
});

// ── Run state ─────────────────────────────────────────────────────────────────

let hero = spawnHero();
let enemies: Combatant[] = [];
let director = newDirector();

/**
 * Build and start a run. Rebuilt from scratch on restart rather than reset:
 * the director owns no scene state, so throwing it away cannot leak any.
 */
function newDirector(): WaveDirector {
  const d = new WaveDirector({
    waves: 3,
    intermission: 2.5,
    mobsPerWave: (wave) => 1 + wave,
    onSpawnWave: (wave, count) => {
      for (let i = 0; i < count; i++) spawnEnemy(`w${wave}-${i}`, i, count, wave);
    },
    onSpawnBoss: () => spawnBoss(),
    onPhase: (phase) => {
      resultLabel.visible = phase === 'victory' || phase === 'defeat';
      resultLabel.text = phase === 'victory'
        ? `VICTORY  ·  ${d.kills} kills in ${d.elapsed.toFixed(1)}s  ·  R to replay`
        : phase === 'defeat'
          ? `DEFEATED  ·  wave ${d.wave}  ·  ${d.kills} kills  ·  R to retry`
          : '';
    },
  });
  d.start();
  return d;
}

function spawnHero(): Combatant {
  const unit = new Combatant('hero', COLS / 2, ROWS / 2, {
    faction: 'hero', hp: 120, damage: 14, speed: HERO_SPEED,
    attackRange: 1.15, attackInterval: 0.42, radius: 15, color: '#6fd8ff', collider,
  });
  scene.addObject(unit);
  return unit;
}

/** Enemies enter on a ring around the arena so they always have to close in. */
function spawnEnemy(id: string, index: number, count: number, wave: number): void {
  const angle = (index / count) * Math.PI * 2 + wave;
  const cx = COLS / 2, cy = ROWS / 2;
  const unit = new Combatant(id, cx + Math.cos(angle) * 5.5, cy + Math.sin(angle) * 5.5, {
    hp: 24 + wave * 8, damage: 5 + wave, speed: 1.5 + wave * 0.18,
    attackInterval: 1.1, radius: 13, color: wave >= 3 ? '#e0743c' : '#c8563c', collider,
  });
  enemies.push(unit);
  scene.addObject(unit);
}

function spawnBoss(): void {
  const unit = new Combatant('boss', COLS / 2, 1.4, {
    hp: 220, damage: 14, speed: 1.35, attackRange: 1.3, attackInterval: 1.4,
    radius: 24, color: '#b048d0', collider,
  });
  enemies.push(unit);
  scene.addObject(unit);
}

function restart(): void {
  for (const unit of [hero, ...enemies]) scene.removeById(unit.id);
  enemies = [];
  hud.resetInput();
  stick.reset();
  hero = spawnHero();
  director = newDirector();
}

// ── Layout ────────────────────────────────────────────────────────────────────

/** HUD and stick positions are in logical pixels, so they follow the CSS box. */
function layoutHud(): void {
  const rect = glCanvas.getBoundingClientRect();
  attackButton.x = rect.width - attackButton.w - 22;
  attackButton.y = rect.height - attackButton.h - 22;
  stick.setCentre(102, rect.height - 102);
}

const resize = (): void => {
  const rect = glCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  renderer.resize(rect.width, rect.height);
  layoutHud();
};
new ResizeObserver(resize).observe(glCanvas);
resize();

// ── Loop ──────────────────────────────────────────────────────────────────────

const extractor = new SceneExtractor();
const PHASE_TEXT: Record<ArpgPhase, string> = {
  ready: 'ready', wave: 'clear the wave', intermission: 'next wave incoming',
  boss: 'BOSS', victory: 'victory', defeat: 'defeat',
};

/** Nearest living enemy, so the attack button does not need a target picker. */
function nearestEnemy(): Combatant | null {
  let best: Combatant | null = null;
  let bestDistance = Infinity;
  for (const enemy of enemies) {
    if (enemy.isDead) continue;
    const distance = Math.hypot(enemy.position.x - hero.position.x, enemy.position.y - hero.position.y);
    if (distance >= bestDistance) continue;
    best = enemy;
    bestDistance = distance;
  }
  return best;
}

function swingHero(): void {
  if (director.isOver || hero.isDead) return;
  hero.swing(nearestEnemy());
}

let lastTs: number | null = null;

function frame(ts: number): void {
  // First frame reports 0, and a tab that was hidden for a second is clamped:
  // the sentinel is `null`, not 0, so a genuine 0 ms frame is not special-cased.
  const dt = lastTs === null ? 0 : Math.min(Math.max(0, (ts - lastTs) / 1000), 0.1);
  lastTs = ts;

  // The HUD claims its contacts first; the stick then ignores those, so a thumb
  // on ATTACK never also steers.
  const hudHeld = hud.update(input, (id) => id === stick.touchId);
  stick.update(input, (id) => hudHeld.includes(id));
  hud.handleMove(input.pointer.x, input.pointer.y);

  if (map.wasPressed('restart')) restart();
  if (map.wasPressed('attack')) swingHero();

  step(dt);
  // One clock for the whole frame: Scene derives its own dt from this timestamp,
  // and handing it `performance.now()` instead would drift from the dt above.
  scene.update(ts);
  draw();
  input.flush();
  requestAnimationFrame(frame);
}

function step(dt: number): void {
  const fighting = director.phase === 'wave' || director.phase === 'boss';

  if (fighting && !hero.isDead) {
    const axis = map.axis('move_right', 'move_left', 'move_down', 'move_up');
    if (axis.x !== 0 || axis.y !== 0) {
      // `nudge` sweeps the step against the collider, so a fast frame cannot
      // tunnel through a wall the way a raw position write would.
      hero.movement.nudge(axis.x * HERO_SPEED * dt, axis.y * HERO_SPEED * dt);
    }
    hero.position.x = Math.min(ARENA_MAX, Math.max(ARENA_MIN, hero.position.x));
    hero.position.y = Math.min(ARENA_MAX, Math.max(ARENA_MIN, hero.position.y));
  }
  hero.tick(dt);

  for (const enemy of enemies) {
    enemy.think(dt, fighting ? hero : null);
  }

  // Report the dead once, then drop them from the scene.
  const survivors: Combatant[] = [];
  for (const enemy of enemies) {
    if (!enemy.isDead) { survivors.push(enemy); continue; }
    scene.removeById(enemy.id);
    director.reportMobDefeated();
  }
  enemies = survivors;

  if (hero.isDead) director.reportHeroDefeated();
  director.update(dt);

  hpBar.value = hero.health.fraction;
  hpBar.label = `HP ${Math.ceil(hero.health.hp)} / ${hero.health.maxHp}`;
  waveLabel.text = director.phase === 'boss'
    ? `BOSS  ·  kills ${director.kills}`
    : `WAVE ${Math.min(director.wave, director.totalWaves)} / ${director.totalWaves}  ·  kills ${director.kills}`;
  phaseLabel.text = director.phase === 'intermission'
    ? `${PHASE_TEXT.intermission}  ${director.countdown.toFixed(1)}s`
    : PHASE_TEXT[director.phase];
  attackButton.visible = !director.isOver;
}

function draw(): void {
  const rect = glCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const snapshot = extractor.extract(scene, {
    viewportWidth: rect.width,
    viewportHeight: rect.height,
    originX: rect.width / 2,
    originY: rect.height * 0.14,
    clearColor: '#0f141b',
  });
  renderer.render(snapshot);
  hudOverlay.render();
}

requestAnimationFrame(frame);

