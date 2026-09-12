import { Engine } from './core/Engine';
import { OmniLight } from './lighting/OmniLight';
import { Character } from './elements/Character';
import { Crystal } from './elements/props/Crystal';
import { Boulder } from './elements/props/Boulder';
import { Chest } from './elements/props/Chest';
import { Cloud } from './elements/props/Cloud';
import { HealthComponent } from './ecs/components/HealthComponent';
import { TweenComponent, Easing } from './ecs/components/TweenComponent';
import { TriggerZoneComponent } from './ecs/components/TriggerZoneComponent';
import { Entity } from './ecs/Entity';
import { EventBus } from './ecs/EventBus';
import { hexToRgba } from './math/color';
import { AudioManager } from './audio/AudioManager';
import { ParticleSystem } from './animation/ParticleSystem';
import { Minimap } from './core/Minimap';
import { MovementComponent } from './ecs/components/MovementComponent';
import { InputManager } from './core/InputManager';
import { HudLayer } from './core/HudLayer';

// ─── Canvas & Engine ──────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

const COLS = 16;
const ROWS = 10;
const TILE_W = 64;
const TILE_H = 32;

const canvasW = (COLS + ROWS) * (TILE_W / 2);
const canvasH = (COLS + ROWS) * (TILE_H / 2) + 120;
canvas.width = canvasW;
canvas.height = canvasH;

const engine = new Engine({ canvas });
engine.originX = canvasW / 2;
engine.originY = ROWS * (TILE_H / 2) + 20;

const input = new InputManager(canvas);

// ─── Responsive Resize ────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  const parent = canvas.parentElement;
  if (parent) {
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w !== canvas.width || h !== canvas.height) {
      const oldW = canvas.width;
      const oldH = canvas.height;
      canvas.width = w;
      canvas.height = h;
      engine.originX = w / 2;
      engine.originY = ROWS * (TILE_H / 2) + 20;
      minimapX += (w - oldW);
      minimapY += (h - oldH);
      minimapX = clamp(minimapX, 0, w - minimapSize);
      minimapY = clamp(minimapY, 0, h - minimapSize);
    }
  }
});

// ─── Audio ────────────────────────────────────────────────────────────────────

const audio = new AudioManager();
const HIT_SFX = '/sfx/hit.mp3';

// ─── Scene ────────────────────────────────────────────────────────────────────

const scene = await engine.loadScene('/scenes/level1.json');
engine.setScene(scene);

// 设置场景基础环境光，确保白天草地足够亮
scene.ambientColor     = '#fff8e8';
scene.ambientIntensity = 0.55;

const character = scene.getById('player') as Character;
const omniLight = scene.omniLights[0] as OmniLight;

// ─── EventBus ─────────────────────────────────────────────────────────────────

interface DemoEventMap {
  hit: { id: string; score: number };
  death: { id: string; score: number };
}

const bus = new EventBus<DemoEventMap>();

// ─── Score & Combo System ─────────────────────────────────────────────────────

let score = 0;
let combo = 0;
let comboTimer = 0;
const COMBO_WINDOW = 2.5; // seconds to maintain combo
let totalHits = 0;
let waveNumber = 1;
let propsAlive = 0;

// ─── HUD (canvas-space) ───────────────────────────────────────────────────────

const hud = new HudLayer();

// Score panel
hud.addPanel({ id: 'score-panel', x: 10, y: 10, w: 180, h: 72, radius: 8,
  bgColor: 'rgba(0,0,0,0.45)', borderColor: 'rgba(255,255,255,0.08)' });
const scoreLabel = hud.addLabel({ id: 'score', x: 20, y: 32,
  text: 'SCORE  0', color: 'rgba(255,240,160,0.9)', fontSize: 13, shadow: true });
const comboLabel = hud.addLabel({ id: 'combo', x: 20, y: 52,
  text: '', color: 'rgba(255,160,60,0.0)', fontSize: 11, shadow: true });
const waveLabel = hud.addLabel({ id: 'wave', x: 20, y: 70,
  text: 'WAVE 1', color: 'rgba(160,220,255,0.7)', fontSize: 10, shadow: true });

// Hint label (bottom center)
hud.addLabel({ id: 'hint', x: canvasW / 2 - 140, y: canvasH - 18,
  text: 'Click props to attack  ·  Click floor to move  ·  R = reset  ·  M = light mode',
  color: 'rgba(255,255,255,0.18)', fontSize: 10, shadow: false });

// Proximity hint
const proximityLabel = hud.addLabel({ id: 'proximity', x: 0, y: 0,
  text: '', color: 'rgba(255,255,255,0)', fontSize: 11, shadow: true, visible: false });

// ─── Particle helper ──────────────────────────────────────────────────────────

let _fxCounter = 0;
type FxPreset = 'spark' | 'crystal' | 'dust' | 'coin';

function spawnFx(x: number, y: number, preset: FxPreset, color?: string, _count?: number): void {
  const id = `fx-${++_fxCounter}`;
  const ps = new ParticleSystem(id, x, y, 0);
  switch (preset) {
    case 'crystal': ps.addEmitter({ rate: 0, life: [0.4, 0.8] as [number,number], speed: [2, 5] as [number,number], size: [4, 8] as [number,number], color: color ? [color] : ['#00ffff', '#ffffff'], gravity: 10 }); break;
    case 'dust':    ps.addEmitter({ rate: 0, life: [0.6, 1.0] as [number,number], speed: [0.5, 2] as [number,number], size: [8, 20] as [number,number], color: color ? [color] : ['#887766'], gravity: 0 }); break;
    case 'coin':    ps.addEmitter({ rate: 0, life: [0.8, 1.5] as [number,number], speed: [1, 4] as [number,number], size: [5, 10] as [number,number], color: ['#ffff00', '#ffd700'], gravity: 12 }); break;
    default:        ps.addEmitter({ rate: 0, life: [0.3, 0.6] as [number,number], speed: [4, 8] as [number,number], size: [2, 5] as [number,number], color: color ? [color] : ['#ffffff', '#ffffcc'], gravity: 5 }); break;
  }
  ps.onExhausted = () => scene.removeById(id);
  ps.burst();
  scene.addObject(ps);
}

// Footstep dust when player moves
let _footTimer = 0;
function maybeSpawnFootstep(dt: number): void {
  const moving = playerMv.isMoving ||
    input.isDown('ArrowUp') || input.isDown('ArrowDown') ||
    input.isDown('ArrowLeft') || input.isDown('ArrowRight');
  if (!moving) { _footTimer = 0; return; }
  _footTimer += dt;
  if (_footTimer < 0.22) return;
  _footTimer = 0;
  const id = `foot-${++_fxCounter}`;
  const ps = new ParticleSystem(id, character.position.x, character.position.y, 0);
  ps.addEmitter({ rate: 0, life: [0.3, 0.6], speed: [0.3, 0.9], size: [2, 4], color: ['#c8b090', '#a09070'], gravity: 0 });
  ps.onExhausted = () => scene.removeById(id);
  ps.burst(4);
  scene.addObject(ps);
}

// ─── Prop definitions & respawn ───────────────────────────────────────────────

interface PropDef {
  id: string;
  type: 'crystal' | 'boulder' | 'chest';
  x: number;
  y: number;
  maxHp: number;
  damage: number;
  scoreValue: number;
  color?: string;
}

const PROP_DEFS: PropDef[] = [
  { id: 'crystal-1', type: 'crystal', x: 3,   y: 3,   maxHp: 60,  damage: 15, scoreValue: 30  },
  { id: 'boulder-1', type: 'boulder', x: 7,   y: 6,   maxHp: 100, damage: 15, scoreValue: 20  },
  { id: 'chest-1',   type: 'chest',   x: 11,  y: 4,   maxHp: 40,  damage: 15, scoreValue: 50  },
];

// Live prop references (null = dead / respawning)
const liveProps = new Map<string, Entity>();

function buildProp(def: PropDef): Entity {
  let prop: Entity;
  if (def.type === 'crystal') prop = new Crystal(def.id, def.x, def.y);
  else if (def.type === 'boulder') prop = new Boulder(def.id, def.x, def.y);
  else prop = new Chest(def.id, def.x, def.y);

  prop.position.z = -30; // start below ground for pop-in tween

  prop.addComponent(new HealthComponent({ max: def.maxHp }));

  // Pop-in tween
  prop.addComponent(new TweenComponent({
    targets: [{ prop: 'z', from: -30, to: 0 }],
    duration: 0.45,
    easing: Easing.easeOutCubic,
  }));

  // Trigger zone — glows when player is near
  const zone = new TriggerZoneComponent({
    radius: 1.4,
    targets: [character],
    onEnter: () => {
      proximityLabel.visible = true;
      proximityLabel.text = def.type === 'chest' ? '✦ 宝箱' : def.type === 'crystal' ? '◆ 水晶' : '● 巨石';
    },
    onExit: () => { proximityLabel.visible = false; },
  });
  prop.addComponent(zone);

  const hp = prop.getComponent(HealthComponent)!;

  hp.onChange = () => {
    bus.emit('hit', { id: def.id, score: def.scoreValue });
  };

  hp.onDeath = () => {
    bus.emit('death', { id: def.id, score: def.scoreValue });
    liveProps.delete(def.id);
    propsAlive--;

    // Spawn death FX
    if (def.type === 'crystal') spawnFx(def.x, def.y, 'crystal', '#8060e0', 20);
    else if (def.type === 'boulder') spawnFx(def.x, def.y, 'dust', undefined, 16);
    else { (prop as Chest).open(); spawnFx(def.x, def.y, 'coin', undefined, 18); }

    scene.removeById(def.id);

    // Respawn after delay (longer each wave)
    const delay = 3000 + waveNumber * 500;
    setTimeout(() => spawnProp(def), delay);
  };

  return prop;
}

function spawnProp(def: PropDef): void {
  const prop = buildProp(def);
  scene.addObject(prop);
  liveProps.set(def.id, prop);
  propsAlive++;

  // Spawn arrival sparkle
  spawnFx(def.x, def.y, 'spark', def.type === 'crystal' ? '#a080ff' : def.type === 'chest' ? '#ffd040' : '#aaaaaa', 6);
}

// Initial spawn
for (const def of PROP_DEFS) spawnProp(def);

// ─── Score / combo event handlers ─────────────────────────────────────────────

bus.on('hit', ({ score: s }) => {
  combo++;
  comboTimer = COMBO_WINDOW;
  totalHits++;
  const multiplier = Math.min(combo, 8);
  score += s * multiplier;
  updateScoreHud();
});

bus.on('death', ({ score: s }) => {
  const multiplier = Math.min(combo, 8);
  score += s * 2 * multiplier;
  updateScoreHud();
  // Check wave clear
  if (propsAlive === 0) {
    waveNumber++;
    waveLabel.text = `WAVE ${waveNumber}`;
    spawnFx(character.position.x, character.position.y, 'spark', '#ffe080', 20);
  }
});

function updateScoreHud(): void {
  scoreLabel.text = `SCORE  ${score}`;
  if (combo >= 2) {
    const mult = Math.min(combo, 8);
    comboLabel.text = `${combo}× COMBO  ×${mult}`;
    const alpha = Math.min(1, 0.5 + combo * 0.08);
    comboLabel.color = `rgba(255,${Math.max(80, 200 - combo * 15)},40,${alpha.toFixed(2)})`;
  } else {
    comboLabel.color = 'rgba(255,160,60,0.0)';
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function resetScene(): void {
  // Remove all live props
  for (const [id] of liveProps) scene.removeById(id);
  liveProps.clear();
  propsAlive = 0;
  score = 0; combo = 0; comboTimer = 0; totalHits = 0; waveNumber = 1;
  scoreLabel.text = 'SCORE  0';
  comboLabel.color = 'rgba(255,160,60,0.0)';
  waveLabel.text = 'WAVE 1';
  character.position.x = 5; character.position.y = 5; character.position.z = 48;
  playerMv.stopMoving();
  for (const def of PROP_DEFS) spawnProp(def);
  spawnFx(character.position.x, character.position.y, 'spark', '#80c0ff', 12);
}

// ─── Clouds ───────────────────────────────────────────────────────────────────

const clouds: Cloud[] = [
  new Cloud({ id: 'cloud-1', x: 2,   y: 1,   altitude: 7,   speed: 0.35, angle: 0.25,  scale: 1.1, seed: 0.18 }),
  new Cloud({ id: 'cloud-2', x: 7,   y: 3,   altitude: 8.5, speed: 0.22, angle: -0.15, scale: 0.8, seed: 0.62 }),
  new Cloud({ id: 'cloud-3', x: 4.5, y: 8,   altitude: 6,   speed: 0.48, angle: 0.40,  scale: 1.3, seed: 0.85 }),
  new Cloud({ id: 'cloud-4', x: 9,   y: 6.5, altitude: 9,   speed: 0.18, angle: -0.30, scale: 0.7, seed: 0.41 }),
];
for (const cloud of clouds) {
  cloud.boundsX = COLS;
  cloud.boundsY = ROWS;
  scene.addObject(cloud);
}

// ─── MovementComponent on player ─────────────────────────────────────────────

const playerMv = new MovementComponent({
  speed:    3.5,
  radius:   0.35,
  collider: scene.collider ?? undefined,
});
character.addComponent(playerMv);

// ─── Minimap ──────────────────────────────────────────────────────────────────

const minimap = new Minimap(scene, { cols: COLS, rows: ROWS, style: { alpha: 0.7 } });
let minimapVisible = true;
let minimapSize    = 150;
let minimapX       = canvas.width - minimapSize - 14;
let minimapY       = canvas.height - minimapSize - 14;

// ─── Light orbit state ────────────────────────────────────────────────────────

const LIGHT_CENTER_X = 5;
const LIGHT_CENTER_Y = 5;
const LIGHT_ORBIT_R = 3.2;

type LightMode = 'orbit' | 'manual';
let lightMode: LightMode = 'orbit';
let orbitTime = 0;
let orbitSpeed = 0.6;

// Rainbow light mode
let rainbowMode = false;
let rainbowHue = 0;

// ─── UI helpers ───────────────────────────────────────────────────────────────

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ─── Panel controls ───────────────────────────────────────────────────────────

const minimapToggle    = $<HTMLInputElement>('minimap-toggle');
const minimapSizeSlider = $<HTMLInputElement>('minimap-size');
const minimapAlphaSlider = $<HTMLInputElement>('minimap-alpha');

minimapToggle.addEventListener('change', () => { minimapVisible = minimapToggle.checked; });
minimapSizeSlider.addEventListener('input', () => { minimapSize = Number(minimapSizeSlider.value); });
minimapAlphaSlider.addEventListener('input', () => { minimap.alpha = Number(minimapAlphaSlider.value); });

// ── Camera view controls ──────────────────────────────────────────────────────

const camRotSlider  = $<HTMLInputElement>('cam-rotation');
const camRotVal     = $<HTMLSpanElement>('cam-rotation-val');
const camElevSlider = $<HTMLInputElement>('cam-elevation');
const camElevVal    = $<HTMLSpanElement>('cam-elevation-val');

function syncCamSliders(): void {
  camRotSlider.value  = String(Math.round(scene.view.rotation));
  camRotVal.textContent = `${Math.round(scene.view.rotation)}°`;
  camElevSlider.value = scene.view.elevation.toFixed(2);
  camElevVal.textContent = scene.view.elevation.toFixed(2);
}

camRotSlider.addEventListener('input', () => {
  const rot = Number(camRotSlider.value);
  camRotVal.textContent = `${rot}°`;
  scene.transitionView({ rotation: rot }, 0.25);
  updateCamPresetHighlight();
});

camElevSlider.addEventListener('input', () => {
  const elev = Number(camElevSlider.value);
  camElevVal.textContent = elev.toFixed(2);
  scene.transitionView({ elevation: elev }, 0.25);
  updateCamPresetHighlight();
});

// Preset buttons
const camPresets = document.querySelectorAll<HTMLButtonElement>('.cam-preset');
camPresets.forEach(btn => {
  btn.addEventListener('click', () => {
    const rot  = Number(btn.dataset.rot);
    const elev = Number(btn.dataset.elev);
    scene.transitionView({ rotation: rot, elevation: elev }, 0.5);
    setTimeout(syncCamSliders, 520);
    updateCamPresetHighlight(btn);
  });
});

$<HTMLButtonElement>('cam-reset').addEventListener('click', () => {
  scene.transitionView({ rotation: 0, elevation: 0.5 }, 0.5);
  setTimeout(syncCamSliders, 520);
  updateCamPresetHighlight();
});

function updateCamPresetHighlight(active?: HTMLButtonElement): void {
  camPresets.forEach(b => b.classList.remove('active'));
  if (active) { active.classList.add('active'); return; }
  // Auto-match if current view matches a preset
  camPresets.forEach(b => {
    const rot  = Number(b.dataset.rot);
    const elev = Number(b.dataset.elev);
    if (Math.abs(scene.view.rotation - rot) < 1 && Math.abs(scene.view.elevation - elev) < 0.01) {
      b.classList.add('active');
    }
  });
}
updateCamPresetHighlight();

const ballElevSlider = $<HTMLInputElement>('ball-elev');
const ballElevVal    = $<HTMLSpanElement>('ball-elev-val');
ballElevSlider.addEventListener('input', () => {
  character.position.z = Number(ballElevSlider.value);
  ballElevVal.textContent = ballElevSlider.value;
});

const lightElevSlider      = $<HTMLInputElement>('light-elev');
const lightElevVal         = $<HTMLSpanElement>('light-elev-val');
const lightIntensitySlider = $<HTMLInputElement>('light-intensity');
const lightIntensityVal    = $<HTMLSpanElement>('light-intensity-val');
const lightSpeedSlider     = $<HTMLInputElement>('light-speed');
const lightSpeedVal        = $<HTMLSpanElement>('light-speed-val');
const lightColorPicker     = $<HTMLInputElement>('light-color');
const modeBtn              = $<HTMLButtonElement>('mode-btn');
const rainbowBtn           = $<HTMLButtonElement>('rainbow-btn');
const resetBtn             = $<HTMLButtonElement>('reset-btn');

lightElevSlider.addEventListener('input', () => {
  omniLight.position.z = Number(lightElevSlider.value);
  lightElevVal.textContent = lightElevSlider.value;
});
lightIntensitySlider.addEventListener('input', () => {
  omniLight.intensity = Number(lightIntensitySlider.value);
  lightIntensityVal.textContent = lightIntensitySlider.value;
});
lightSpeedSlider.addEventListener('input', () => {
  orbitSpeed = Number(lightSpeedSlider.value);
  lightSpeedVal.textContent = lightSpeedSlider.value;
});
lightColorPicker.addEventListener('input', () => {
  rainbowMode = false;
  rainbowBtn.classList.remove('active');
  omniLight.color = lightColorPicker.value;
});

rainbowBtn.addEventListener('click', () => {
  rainbowMode = !rainbowMode;
  rainbowBtn.classList.toggle('active', rainbowMode);
});

resetBtn.addEventListener('click', () => resetScene());

function updateModeBtn(): void {
  modeBtn.textContent = lightMode === 'orbit' ? 'Orbit' : 'Manual';
  modeBtn.classList.toggle('active', lightMode === 'manual');
  lightSpeedSlider.closest('.row')!.classList.toggle('disabled', lightMode === 'manual');
}
modeBtn.addEventListener('click', () => {
  lightMode = lightMode === 'orbit' ? 'manual' : 'orbit';
  updateModeBtn();
});
updateModeBtn();

// ─── Drag & click ─────────────────────────────────────────────────────────────

const HIT_RADIUS = 30;
type DragTarget = 'ball' | 'light' | 'minimap' | null;
let dragging: DragTarget = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

function getBallScreenPos(): { bx: number; by: number } {
  const { sx, sy } = scene.camera.worldToScreen(
    character.position.x, character.position.y, character.position.z,
    TILE_W, TILE_H, engine.originX, engine.originY,
  );
  return { bx: sx, by: sy };
}

function getLightScreenPos(): { lx: number; ly: number } {
  const { sx, sy } = scene.camera.worldToScreen(
    omniLight.position.x, omniLight.position.y, omniLight.position.z,
    TILE_W, TILE_H, engine.originX, engine.originY,
  );
  return { lx: sx, ly: sy };
}

function getEntityScreenPos(e: Entity): { ex: number; ey: number } {
  const { sx, sy } = scene.camera.worldToScreen(
    e.position.x, e.position.y, 0,
    TILE_W, TILE_H, engine.originX, engine.originY,
  );
  return { ex: sx, ey: sy };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function clampWorld(x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, 0.5, COLS - 0.5), y: clamp(y, 0.5, ROWS - 0.5) };
}

const PROP_HIT_R = 28;

function hitTestProps(cx: number, cy: number): Entity | null {
  for (const [, prop] of liveProps) {
    const { ex, ey } = getEntityScreenPos(prop);
    if (Math.hypot(cx - ex, cy - ey) < PROP_HIT_R) return prop;
  }
  return null;
}

function handlePointerDown(cx: number, cy: number): void {
  if (minimapVisible && minimap.isHit(cx, cy, minimapX, minimapY, minimapSize, minimapSize)) {
    dragging = 'minimap';
    dragOffsetX = cx - minimapX;
    dragOffsetY = cy - minimapY;
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (lightMode === 'manual') {
    const { lx, ly } = getLightScreenPos();
    if (Math.hypot(cx - lx, cy - ly) < HIT_RADIUS) {
      dragging = 'light';
      dragOffsetX = cx - lx;
      dragOffsetY = cy - ly;
      canvas.style.cursor = 'grabbing';
      return;
    }
  }
  const { bx, by } = getBallScreenPos();
  if (Math.hypot(cx - bx, cy - by) < HIT_RADIUS) {
    dragging = 'ball';
    dragOffsetX = cx - bx;
    dragOffsetY = cy - by;
    playerMv.stopMoving();
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Prop click → deal damage
  const prop = hitTestProps(cx, cy);
  if (prop) {
    audio.resume();
    const hp = prop.getComponent(HealthComponent);
    if (hp && !hp.isDead) {
      const def = PROP_DEFS.find(d => d.id === prop.id)!;
      const vol = AudioManager.spatialVolume({
        x: prop.position.x, y: prop.position.y,
        listenerX: character.position.x, listenerY: character.position.y,
        refDistance: 1, maxDistance: 14,
      });
      audio.playSfx(HIT_SFX, { volume: vol });
      hp.takeDamage(def.damage);

      const mult = Math.min(combo, 8);
      const dmgText = mult > 1 ? `-${def.damage}  ×${mult}` : `-${def.damage}`;
      const dmgColor = mult >= 4 ? '#ff8020' : mult >= 2 ? '#ffcc40' : '#ff4040';
      scene.spawnFloatingText({ x: prop.position.x, y: prop.position.y, z: 32,
        text: dmgText, color: dmgColor, duration: 800, fontSize: mult >= 2 ? 22 : 18 });

      // Hit spark
      spawnFx(prop.position.x, prop.position.y, 'spark',
        def.type === 'crystal' ? '#a060ff' : def.type === 'chest' ? '#ffd040' : '#aaaaaa', 5);
    }
    return;
  }

  // Floor click → A* pathfinding
  const world   = scene.camera.screenToWorld(cx, cy, canvasW, canvasH, TILE_W, TILE_H, engine.originX, engine.originY);
  const clamped = clampWorld(world.x, world.y);
  const reached = playerMv.pathTo(clamped.x, clamped.y, character.position.z);
  if (!reached) flashUnreachable();
}

function handlePointerMove(cx: number, cy: number): void {
  if (dragging === 'minimap') {
    minimapX = clamp(cx - dragOffsetX, 0, canvas.width - minimapSize);
    minimapY = clamp(cy - dragOffsetY, 0, canvas.height - minimapSize);
    return;
  }
  if (dragging === 'ball') {
    const world = scene.camera.screenToWorld(
      cx - dragOffsetX, cy - dragOffsetY + character.position.z,
      canvasW, canvasH, TILE_W, TILE_H, engine.originX, engine.originY,
    );
    const w = clampWorld(world.x, world.y);
    character.position.x = w.x;
    character.position.y = w.y;
    return;
  }
  if (dragging === 'light') {
    const world = scene.camera.screenToWorld(
      cx - dragOffsetX, cy - dragOffsetY + omniLight.position.z,
      canvasW, canvasH, TILE_W, TILE_H, engine.originX, engine.originY,
    );
    const w = clampWorld(world.x, world.y);
    omniLight.position.x = w.x;
    omniLight.position.y = w.y;
    return;
  }

  // Hover cursor
  const { bx, by } = getBallScreenPos();
  const onBall = Math.hypot(cx - bx, cy - by) < HIT_RADIUS;
  const onProp = hitTestProps(cx, cy) !== null;
  const onMinimap = minimapVisible && minimap.isHit(cx, cy, minimapX, minimapY, minimapSize, minimapSize);
  let onLight = false;
  if (lightMode === 'manual') {
    const { lx, ly } = getLightScreenPos();
    onLight = Math.hypot(cx - lx, cy - ly) < HIT_RADIUS;
  }
  canvas.style.cursor = onBall || onLight || onMinimap ? 'grab' : onProp ? 'pointer' : 'crosshair';

  // Update proximity label position to follow cursor
  if (proximityLabel.visible) {
    proximityLabel.x = cx + 14;
    proximityLabel.y = cy - 8;
  }
}

function handlePointerUp(): void {
  dragging = null;
  canvas.style.cursor = 'crosshair';
}

const KEY_STEP = 0.5;

// ─── Unreachable flash ────────────────────────────────────────────────────────

let _flashAlpha = 0;
function flashUnreachable(): void { _flashAlpha = 0.28; }

// ─── HUD (HTML overlay) ───────────────────────────────────────────────────────

const hudBall     = $<HTMLSpanElement>('hud-ball');
const hudPath     = $<HTMLSpanElement>('hud-path');
const hudLight    = $<HTMLSpanElement>('hud-light');

function updateHtmlHud(): void {
  const p = character.position;
  const l = omniLight.position;
  hudBall.textContent  = `player  x:${p.x.toFixed(1)} y:${p.y.toFixed(1)} z:${p.z.toFixed(0)}`;
  const wps = playerMv.remainingWaypoints.length;
  hudPath.textContent  = playerMv.isMoving ? `path    waypoints:${wps} remaining` : `path    idle`;
  hudLight.textContent = `light   x:${l.x.toFixed(1)} y:${l.y.toFixed(1)} z:${l.z.toFixed(0)}`;
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function drawHintRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, HIT_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Prop highlight ring (pulsing when player is near)
function drawPropHighlight(ctx: CanvasRenderingContext2D, ts: number): void {
  for (const [, prop] of liveProps) {
    const zone = prop.getComponent(TriggerZoneComponent);
    if (!zone || !zone.contains(character.id)) continue;
    const { ex, ey } = getEntityScreenPos(prop);
    const pulse = 0.5 + Math.sin(ts * 0.005) * 0.3;
    ctx.beginPath();
    ctx.arc(ex, ey, PROP_HIT_R + 4, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,220,80,${pulse.toFixed(2)})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** First-frame sentinel. `null`, not 0 — `Engine`'s first timestamp *is* 0. */
let _lastTs: number | null = null;

engine.start(
  // postFrame — overlays
  (ts) => {
    const ctx = engine.ctx;

    // Unreachable flash
    if (_flashAlpha > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,60,60,${_flashAlpha.toFixed(2)})`;
      ctx.lineWidth   = 6;
      ctx.strokeRect(3, 3, canvasW - 6, canvasH - 6);
      ctx.restore();
      _flashAlpha = Math.max(0, _flashAlpha - 0.018);
    }

    // A* path visualisation
    const wps = playerMv.remainingWaypoints;
    if (wps.length > 0) {
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(85,144,204,0.55)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      const { bx, by } = getBallScreenPos();
      ctx.moveTo(bx, by);
      for (const wp of wps) {
        const { sx, sy } = scene.camera.worldToScreen(
          wp.x, wp.y, character.position.z,
          TILE_W, TILE_H, engine.originX, engine.originY,
        );
        ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(85,144,204,0.7)';
      for (const wp of wps) {
        const { sx, sy } = scene.camera.worldToScreen(
          wp.x, wp.y, character.position.z,
          TILE_W, TILE_H, engine.originX, engine.originY,
        );
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Prop highlight rings
    drawPropHighlight(ctx, ts);

    if (dragging === null) {
      const { bx, by } = getBallScreenPos();
      drawHintRing(ctx, bx, by, 'rgba(255,255,255,0.15)');
      if (lightMode === 'manual') {
        const { lx, ly } = getLightScreenPos();
        drawHintRing(ctx, lx, ly, 'rgba(255,220,80,0.35)');
      }
    }

    // Minimap
    if (minimapVisible) {
      minimap.draw(engine.ctx, minimapX, minimapY, minimapSize, minimapSize);
    }

    // Canvas-space HUD (score, combo, wave, hints)
    hud.draw(ctx, canvasW, canvasH);

    updateHtmlHud();
  },

  // preFrame — input + update + background glow
  (ts) => {
    const dt = _lastTs === null
      ? 0
      : Math.min(Math.max(0, (ts - _lastTs) / 1000), 0.1);
    _lastTs = ts;

    // Combo decay
    if (combo > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        combo = 0;
        comboLabel.color = 'rgba(255,160,60,0.0)';
      }
    }

    // Keyboard
    if (!(document.activeElement instanceof HTMLInputElement)) {
      if (input.wasPressed('m') || input.wasPressed('M')) {
        lightMode = lightMode === 'orbit' ? 'manual' : 'orbit';
        updateModeBtn();
      }
      if (input.wasPressed('r') || input.wasPressed('R')) resetScene();
      if (input.wasPressed('c') || input.wasPressed('C')) {
        rainbowMode = !rainbowMode;
        rainbowBtn.classList.toggle('active', rainbowMode);
      }
      if (input.isDown('ArrowUp'))    character.position.y = clamp(character.position.y - KEY_STEP * 0.1, 0.5, ROWS - 0.5);
      if (input.isDown('ArrowDown'))  character.position.y = clamp(character.position.y + KEY_STEP * 0.1, 0.5, ROWS - 0.5);
      if (input.isDown('ArrowLeft'))  character.position.x = clamp(character.position.x - KEY_STEP * 0.1, 0.5, COLS - 0.5);
      if (input.isDown('ArrowRight')) character.position.x = clamp(character.position.x + KEY_STEP * 0.1, 0.5, COLS - 0.5);
    }

    // Pointer
    const { x: cx, y: cy, pressed, released } = input.pointer;
    if (pressed)        handlePointerDown(cx, cy);
    else if (released)  handlePointerUp();
    else                handlePointerMove(cx, cy);

    playerMv.update(ts);
    maybeSpawnFootstep(dt);

    // Rainbow light
    if (rainbowMode) {
      rainbowHue = (rainbowHue + dt * 60) % 360;
      const h = rainbowHue;
      const r = Math.round(128 + 127 * Math.sin((h) * Math.PI / 180));
      const g = Math.round(128 + 127 * Math.sin((h + 120) * Math.PI / 180));
      const b = Math.round(128 + 127 * Math.sin((h + 240) * Math.PI / 180));
      omniLight.color = `rgb(${r},${g},${b})`;
      lightColorPicker.value = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    }

    // Light orbit
    if (lightMode === 'orbit') {
      orbitTime = ts * 0.001 * orbitSpeed;
      omniLight.position.x = LIGHT_CENTER_X + Math.cos(orbitTime) * LIGHT_ORBIT_R;
      omniLight.position.y = LIGHT_CENTER_Y + Math.sin(orbitTime) * LIGHT_ORBIT_R;
    }

    // Background glow
    const { sx: lsx, sy: lsy } = scene.camera.worldToScreen(
      omniLight.position.x, omniLight.position.y, omniLight.position.z,
      TILE_W, TILE_H, engine.originX, engine.originY,
    );
    const ctx = engine.ctx;
    const r = (omniLight.radius ?? 320) * scene.camera.zoom * 1.2;
    const bgGlow = ctx.createRadialGradient(lsx, lsy, 0, lsx, lsy, r);
    bgGlow.addColorStop(0, hexToRgba(omniLight.color, 0.08));
    bgGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, canvasW, canvasH);

    input.flush();
  },
);
