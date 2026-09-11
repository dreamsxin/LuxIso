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
import { registerCombatantExtractor } from './CombatantExtractor';
import { registerCombatantPersistence } from './persistence';
import { ArenaRun } from './ArenaRun';
import { type ArpgPhase } from './WaveDirector';

const COLS = 14, ROWS = 14;

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
// Both halves of the save/load round trip, so anything that serializes this live
// scene keeps its fighters instead of silently dropping them. A checkpoint would
// additionally need the run state, and `WaveDirector` has no snapshot API yet —
// which is why the page offers no save button.
registerCombatantPersistence({ collider });

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
  onClick: () => { attackQueued = true; },
});
const hudOverlay = new HudOverlayRenderer(hudCanvas, hud, {
  // The stick is not a HudLayer element type, so it paints through the overlay's
  // own hook rather than by reaching for the 2D context behind its back.
  paint: (ctx) => stick.draw(ctx),
});

// ── Run ───────────────────────────────────────────────────────────────────────

// The rules live in ArenaRun; this file owns the page. `onSpawn` / `onDespawn`
// are the only place the two meet.
const run = new ArenaRun({
  cols: COLS,
  rows: ROWS,
  collider,
  onSpawn: (unit) => scene.addObject(unit),
  onDespawn: (unit) => scene.removeById(unit.id),
  onPhase: (phase) => {
    resultLabel.visible = phase === 'victory' || phase === 'defeat';
    resultLabel.text = phase === 'victory'
      ? `VICTORY  ·  ${run.director.kills} kills in ${run.director.elapsed.toFixed(1)}s  ·  R to replay`
      : phase === 'defeat'
        ? `DEFEATED  ·  wave ${run.director.wave}  ·  ${run.director.kills} kills  ·  R to retry`
        : '';
  },
});
run.start();

/** Set by the ATTACK button, consumed by the next frame. */
let attackQueued = false;

function restart(): void {
  hud.resetInput();
  stick.reset();
  attackQueued = false;
  run.restart();
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

/**
 * Whether the hero should swing this frame.
 *
 * Held rather than tapped: `Combatant` already gates the rate by its cooldown, so
 * reading `wasPressed` would have made the player mash a key to reach a cadence
 * the character enforces anyway. The button's queued press still counts once.
 */
function swingRequested(): boolean {
  const requested = attackQueued || map.isDown('attack');
  attackQueued = false;
  return requested;
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

  const axis = map.axis('move_right', 'move_left', 'move_down', 'move_up');
  run.step(dt, { x: axis.x, y: axis.y, attack: swingRequested() });

  // One clock for the whole frame: Scene derives its own dt from this timestamp,
  // and handing it `performance.now()` instead would drift from the dt above.
  // Movement was already integrated by `ArenaRun` through `fixedUpdate`, which
  // `MovementComponent` latches onto — so this cannot step it a second time.
  scene.update(ts);
  refreshHud();
  draw();
  input.flush();
  requestAnimationFrame(frame);
}

function refreshHud(): void {
  const director = run.director;
  hpBar.value = run.hero.health.fraction;
  hpBar.label = `HP ${Math.ceil(run.hero.health.hp)} / ${run.hero.health.maxHp}`;
  waveLabel.text = director.phase === 'boss'
    ? `BOSS  ·  kills ${director.kills}`
    : `WAVE ${Math.min(Math.max(1, director.wave), director.totalWaves)} / ${director.totalWaves}  ·  kills ${director.kills}`;
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

