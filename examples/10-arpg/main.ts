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
 *   • `Pathfinder.hasLineOfSight` + `pathTo` — mobs walk straight when they can
 *     see the hero, and path around the pillars when they cannot
 *   • `WaveDirector` — the run structure, driven by kill reports, not by the loop
 *   • `AudioManager` — spatial cues panned around the hero, plus a bed that
 *     follows the phase. The sounds are synthesized into data URLs at startup
 *     (`sfx.ts`), so the demo ships no binary assets.
 *
 * Controls: WASD / arrows or the lower-left stick to move, Space / J or the
 * ATTACK button to swing, Q to cleave, E to dash, R to restart, M to mute.
 */
import {
  Scene, Floor, Boulder, TileCollider, InputManager, InputMap, TouchStick, HudLayer,
  OmniLight, DirectionalLight, SceneSerializer, Engine, AudioManager,
} from '../../src/index';
import {SceneExtractor} from '../../webgl-next/src/extraction/SceneExtractor';
import {WebGLRenderer} from '../../webgl-next/src/renderer/WebGLRenderer';
import {HudOverlayRenderer} from '../../webgl-next/src/overlays/HudOverlayRenderer';
import {registerCombatantExtractor} from './CombatantExtractor';
import {registerCombatantPersistence} from './persistence';
import {Combatant} from './Combatant';
import {ArenaRun, type ArenaRunSnapshot} from './ArenaRun';
import {ArenaAudio, ARENA_CUES, ARENA_TRACKS, resolveCues} from './ArenaAudio';

import {type ArpgPhase} from './WaveDirector';


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
// scene keeps its fighters instead of silently dropping them. A checkpoint is the
// pair: this, plus `ArenaRun.snapshot()` — K and L below.
registerCombatantPersistence({collider});

const scene = new Scene({name: 'Arena', tileW: 64, tileH: 32, cols: COLS, rows: ROWS});
scene.collider = collider;
scene.dynamicLighting = true;
scene.ambientColor = '#8aa0b8';
scene.ambientIntensity = 0.42;

scene.addObject(new Floor({id: 'floor', cols: COLS, rows: ROWS, color: '#2b3340', altColor: '#242b36'}));
scene.addLight(new DirectionalLight({id: 'sun', angle: 225, elevation: 55, color: '#ffe8c0', intensity: 0.7}));
scene.addLight(new OmniLight({
  id: 'brazier', x: COLS / 2, y: ROWS / 2, z: 90,
  color: '#ffb060', intensity: 0.55, radius: 320,
}));

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
map.define('cleave', ['q', 'Q']);
map.define('dash', ['e', 'E']);
map.define('restart', ['r', 'R']);
map.define('save', ['k', 'K']);
map.define('load', ['l', 'L']);
map.define('mute', ['m', 'M']);


const stick = new TouchStick({x: 110, y: 260, radius: 56});
map.addAxisSource(stick);

// ── HUD ───────────────────────────────────────────────────────────────────────

/** Skill button tints: available, and waiting out a cooldown. */
const SKILL_READY_BG = 'rgba(70,110,150,0.6)';
const SKILL_COOLING_BG = 'rgba(40,48,58,0.55)';

const hud = new HudLayer();
hud.minHitSize = 44;
const hpBar = hud.addBar({id: 'hp', x: 16, y: 16, w: 190, h: 15, color: '#5ad07a', label: 'HP'});
// Experience sits directly under health: both are "how the hero is doing", and
// the level is the one number a player checks between waves.
const xpBar = hud.addBar({id: 'xp', x: 16, y: 34, w: 190, h: 8, color: '#c9a44c', fontSize: 9});
const waveLabel = hud.addLabel({id: 'wave', x: 16, y: 58, text: '', color: '#cfe4f0', fontSize: 14});
const phaseLabel = hud.addLabel({id: 'phase', x: 16, y: 78, text: '', color: '#8fb8d0', fontSize: 12});
const resultLabel = hud.addLabel({
  id: 'result', x: 16, y: 104, text: '', color: '#ffd890', fontSize: 18, visible: false,
});
const noticeLabel = hud.addLabel({
  id: 'notice', x: 16, y: 130, text: '', color: '#9fd8b0', fontSize: 12, visible: false,
});
const attackButton = hud.addButton({
  id: 'attack', x: 0, y: 0, w: 92, h: 92, label: 'ATTACK',
  bgColor: 'rgba(200,80,60,0.55)', hoverColor: 'rgba(240,120,90,0.8)',
  onClick: () => { attackQueued = true; },
});
// The two skills. Their labels carry the cooldown, which is the whole reason a
// skill needs a HUD at all: the player has to know whether the key will do
// anything before pressing it.
const cleaveButton = hud.addButton({
  id: 'cleave', x: 0, y: 0, w: 92, h: 44, label: 'CLEAVE Q',
  bgColor: SKILL_READY_BG, hoverColor: 'rgba(255,190,110,0.85)', fontSize: 11,
  onClick: () => { cleaveQueued = true; },
});
const dashButton = hud.addButton({
  id: 'dash', x: 0, y: 0, w: 92, h: 44, label: 'DASH E',
  bgColor: SKILL_READY_BG, hoverColor: 'rgba(140,220,255,0.85)', fontSize: 11,
  onClick: () => { dashQueued = true; },
});
const hudOverlay = new HudOverlayRenderer(hudCanvas, hud, {
  // The stick is not a HudLayer element type, so it paints through the overlay's
  // own hook rather than by reaching for the 2D context behind its back.
  paint: ctx => stick.draw(ctx),
});

// ── Audio ─────────────────────────────────────────────────────────────────────

// `bindPageLifecycle` covers the two things a browser demands and a demo always
// forgets: an AudioContext starts suspended until a gesture, and music must not
// keep playing over whatever the player switched to.
const audio = new AudioManager();
audio.bgmVolume = 0.32;
audio.bindPageLifecycle();
// Decoding needs a context, not a resumed one, so this runs before the first tap
// rather than after it. Failures are already reported by the manager.
void audio.preloadAll([
  ...Object.values(ARENA_CUES).map(cue => cue.url),
  ...Object.values(ARENA_TRACKS),
]);
const arenaAudio = new ArenaAudio(audio);
// A local pack, if one is installed. The run starts on the synthesized cues and
// swaps in whatever `/sfx/arpg-cues.json` names and the browser can decode, so a
// missing or half-filled pack costs nothing. See that file for the format.
void resolveCues({
  fetchJson: async url => {
    try {
      const res = await fetch(url);
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  },
  preload: url => audio.preload(url),
}).then(cues => arenaAudio.setCues(cues));


// ── Run ───────────────────────────────────────────────────────────────────────


// The rules live in ArenaRun; this file owns the page. `onSpawn` / `onDespawn`
// are the only place the two meet.
const run = new ArenaRun({
  cols: COLS,
  rows: ROWS,
  collider,
  onSpawn: unit => scene.addObject(unit),
  onDespawn: unit => scene.removeById(unit.id),
  onEvent: event => arenaAudio.handle(event),
  onFloatingText: opts => scene.spawnFloatingText(opts),
  onPhase: phase => {
    arenaAudio.setPhase(phase);
    resultLabel.visible = phase === 'victory' || phase === 'defeat';

    const lv = `LV ${run.progress.level}`;
    const kills = run.director.kills;
    resultLabel.text = phase === 'victory'
      ? `VICTORY  ·  ${kills} kills in ${run.director.elapsed.toFixed(1)}s  ·  ${lv}  ·  R to replay`
      : phase === 'defeat'
        ? `DEFEATED  ·  wave ${run.director.wave}  ·  ${kills} kills  ·  ${lv}  ·  R to retry`
        : '';
  },
});
run.start();

// Cover. `ArenaRun` blocked these tiles on the collider; drawing them is the
// page's job, and a boulder is a built-in the GL extractor already knows.
for (const {col, row} of run.pillars) {
  scene.addObject(new Boulder(`pillar-${col}-${row}`, col + 0.5, row + 0.5, '#6b6f7e', 22));
}

/** Set by the ATTACK button, consumed by the next frame. */
let attackQueued = false;
/** Same for the two skill buttons — a tap must survive until the next step. */
let cleaveQueued = false;
let dashQueued = false;

function restart(): void {
  hud.resetInput();
  stick.reset();
  attackQueued = false;
  cleaveQueued = false;
  dashQueued = false;
  run.restart();
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

const SAVE_KEY = 'luxiso.arpg.checkpoint';
/** Seconds left on the transient notice under the result line. */
let noticeFor = 0;

function notify(text: string): void {
  noticeLabel.text = text;
  noticeLabel.visible = true;
  noticeFor = 2.5;
}

/** A checkpoint is the pair: the serialized scene, plus the run's bookkeeping. */
function saveCheckpoint(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      scene: SceneSerializer.toJSON(scene),
      run: run.snapshot(),
    }));
    notify('checkpoint saved');
  } catch {
    // Private browsing, or a full quota.
    notify('save failed');
  }
}

function loadCheckpoint(): void {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    notify('save storage unavailable');
    return;
  }
  if (!raw) { notify('no checkpoint yet'); return; }

  try {
    const save = JSON.parse(raw) as {scene?: {props?: []}; run?: ArenaRunSnapshot};
    if (!save.scene) { notify('checkpoint unreadable'); return; }
    // `Engine.buildProps` restores objects without a Scene, so the fighters go
    // straight into the live one through `adopt`'s spawn callback.
    const fighters = Engine.buildProps(save.scene.props)
      .filter((object): object is Combatant => object instanceof Combatant);
    if (!run.adopt(fighters, save.run ?? {})) { notify('checkpoint has no hero'); return; }
    hud.resetInput();
    stick.reset();
    attackQueued = false;
    cleaveQueued = false;
    dashQueued = false;
    notify('checkpoint loaded');
  } catch {
    notify('checkpoint unreadable');
  }
}


// ── Layout ────────────────────────────────────────────────────────────────────

/** HUD and stick positions are in logical pixels, so they follow the CSS box. */
function layoutHud(): void {
  const rect = glCanvas.getBoundingClientRect();
  attackButton.x = rect.width - attackButton.w - 22;
  attackButton.y = rect.height - attackButton.h - 22;
  // Skills stack above ATTACK, in the same column the thumb already reaches.
  cleaveButton.x = dashButton.x = attackButton.x;
  dashButton.y = attackButton.y - dashButton.h - 8;
  cleaveButton.y = dashButton.y - cleaveButton.h - 8;
  stick.setCentre(102, rect.height - 102);
}

const resize = (): void => {
  const rect = glCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {return;}
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

/**
 * Whether a skill was asked for this frame.
 *
 * Tapped, not held — the opposite of the basic attack, and for the same reason
 * read the other way round: a held key would fire the skill on the first frame
 * of every cooldown expiry, so the cooldown would decide the timing instead of
 * the player. Choosing *when* to spend a five-second skill is the decision.
 */
function skillRequested(action: 'cleave' | 'dash'): boolean {
  const queued = action === 'cleave' ? cleaveQueued : dashQueued;
  if (action === 'cleave') {cleaveQueued = false;} else {dashQueued = false;}
  return queued || map.wasPressed(action);
}

let lastTs: number | null = null;

function frame(ts: number): void {
  // First frame reports 0, and a tab that was hidden for a second is clamped:
  // the sentinel is `null`, not 0, so a genuine 0 ms frame is not special-cased.
  const dt = lastTs === null ? 0 : Math.min(Math.max(0, (ts - lastTs) / 1000), 0.1);
  lastTs = ts;

  // The HUD claims its contacts first; the stick then ignores those, so a thumb
  // on ATTACK never also steers.
  const hudHeld = hud.update(input, id => id === stick.touchId);
  stick.update(input, id => hudHeld.includes(id));
  hud.handleMove(input.pointer.x, input.pointer.y);

  if (map.wasPressed('restart')) {restart();}
  if (map.wasPressed('save')) {saveCheckpoint();}
  if (map.wasPressed('load')) {loadCheckpoint();}
  if (map.wasPressed('mute')) {
    arenaAudio.setMuted(!arenaAudio.muted);
    audio.masterVolume = arenaAudio.muted ? 0 : 1;
    notify(arenaAudio.muted ? 'sound off' : 'sound on');
  }

  const axis = map.axis('move_right', 'move_left', 'move_down', 'move_up');
  // Opened before the step, so the events the step emits are spent against this
  // frame's voice budget and are panned around where the hero already is.
  arenaAudio.beginFrame(dt, run.hero.position.x, run.hero.position.y);
  run.step(dt, {
    x: axis.x, y: axis.y,
    attack: swingRequested(),
    cleave: skillRequested('cleave'),
    dash: skillRequested('dash'),
  });


  // One clock for the whole frame: Scene derives its own dt from this timestamp,
  // and handing it `performance.now()` instead would drift from the dt above.
  // Movement was already integrated by `ArenaRun` through `fixedUpdate`, which
  // `MovementComponent` latches onto — so this cannot step it a second time.
  scene.update(ts);
  refreshHud(dt);
  draw();
  input.flush();
  requestAnimationFrame(frame);
}

function refreshHud(dt: number): void {
  const director = run.director;
  if (noticeFor > 0) {
    noticeFor = Math.max(0, noticeFor - dt);
    if (noticeFor === 0) {noticeLabel.visible = false;}
  }
  hpBar.value = run.hero.health.fraction;
  hpBar.label = `HP ${Math.ceil(run.hero.health.hp)} / ${run.hero.health.maxHp}`;
  const progress = run.progress;
  xpBar.value = progress.fraction;
  xpBar.label = progress.isMaxLevel
    ? `LV ${progress.level}  ·  MAX`
    : `LV ${progress.level}  ·  XP ${progress.xp} / ${progress.xpForNextLevel}`;
  const waveNumber = Math.min(Math.max(1, director.wave), director.totalWaves);
  waveLabel.text = director.phase === 'boss'
    ? `BOSS  ·  kills ${director.kills}`
    : `WAVE ${waveNumber} / ${director.totalWaves}  ·  kills ${director.kills}`;
  phaseLabel.text = director.phase === 'intermission'
    ? `${PHASE_TEXT.intermission}  ${director.countdown.toFixed(1)}s`
    : PHASE_TEXT[director.phase];
  attackButton.visible = !director.isOver;
  cleaveButton.visible = !director.isOver;
  dashButton.visible = !director.isOver;
  paintSkill(cleaveButton, 'cleave', 'CLEAVE Q');
  paintSkill(dashButton, 'dash', 'DASH E');
}

/** A skill button reads either its key or the seconds left on it. */
function paintSkill(
  button: {label: string; bgColor: string},
  id: 'cleave' | 'dash',
  ready: string
): void {
  const remaining = run.abilities.remaining(id);
  button.label = remaining > 0 ? `${ready.split(' ')[0]} ${remaining.toFixed(1)}s` : ready;
  button.bgColor = remaining > 0 ? SKILL_COOLING_BG : SKILL_READY_BG;
}

function draw(): void {
  const rect = glCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {return;}
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

