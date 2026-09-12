/**
 * 低语草原 — LuxIso 综合 Demo
 * 日夜交替 60 秒一周期
 *
 * main.ts 只负责：引擎初始化、场景注册、传送协调。
 * 每个场景的逻辑（输入、粒子、背景）通过 ManagedScene 钩子自包含。
 */
import {
  Engine, InputManager, InputMap,
  SceneManager, SceneTransition, HudLayer,
  ParticleSystem, ClickMover,
  DirectionalLight, Scene,
} from '../../src/index';
import { CubeHero } from './entities/CubeHero';
import { buildPlainsScene, PLAINS_COLS, PLAINS_ROWS, PORTAL_X, PORTAL_Y } from './scenes/PlainsScene';
import { buildLakeScene, LAKE_PORTAL_X, LAKE_PORTAL_Y, LAKE_SPAWN_X, LAKE_SPAWN_Y } from './scenes/LakeScene';
import { buildDeepSeaScene, DEEP_COLS, DEEP_ROWS, DEEP_PORTAL_X, DEEP_PORTAL_Y, DEEP_SPAWN_X, DEEP_SPAWN_Y } from './scenes/DeepSeaScene';
import { DayNightCycle } from './environment/DayNightCycle';
import { drawPlainsSky, drawLakeSky, drawDeepSky } from './environment/skies';
import { Portal } from './entities/Portal';


// ── 引擎 & 输入 ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width  = Math.min(window.innerWidth,  980);
canvas.height = Math.min(window.innerHeight - 40, 660);

const engine = new Engine({ canvas });
engine.originX = canvas.width / 2;
engine.originY = canvas.height / 2 - 20;

const input = new InputManager(canvas);
const map   = new InputMap(input);
map.define('up',    ['ArrowUp',    'w', 'KeyW']);
map.define('down',  ['ArrowDown',  's', 'KeyS']);
map.define('left',  ['ArrowLeft',  'a', 'KeyA']);
map.define('right', ['ArrowRight', 'd', 'KeyD']);

// ── HUD ───────────────────────────────────────────────────────────────────

const hud = new HudLayer();
hud.addPanel({ id: 'panel', x: 12, y: 12, w: 220, h: 60, radius: 10,
  bgColor: 'rgba(0,0,0,0.4)', borderColor: 'rgba(255,255,255,0.12)' });
const sceneLabel = hud.addLabel({ id: 'scene-name', x: 22, y: 33, text: '低语草原', color: '#e8f4e8', fontSize: 15, shadow: true });
const hintLabel  = hud.addLabel({ id: 'hint', x: 22, y: 54, text: 'WASD / 点击 移动', color: 'rgba(200,230,200,0.6)', fontSize: 10, shadow: true });
const portalHint = hud.addLabel({ id: 'portal-hint', x: canvas.width - 200, y: canvas.height - 20, text: '✦ 传送阵感应到你的存在…', color: 'rgba(180,140,255,0)', fontSize: 11, shadow: true, visible: false });
const timeLabel  = hud.addLabel({ id: 'time', x: canvas.width - 80, y: 30, text: '☀ 白天', color: 'rgba(255,240,180,0.85)', fontSize: 11, shadow: true });

const transition = new SceneTransition(engine.ctx);

// ── 日夜系统 ──────────────────────────────────────────────────────────────

const dayNight = new DayNightCycle(60);
dayNight.setPhase(0.25);

// ── 场景构建 ──────────────────────────────────────────────────────────────

// 草原
const { scene: plainsScene, portal, collider: plainsCollider } = buildPlainsScene();
{ const sa = dayNight.getSceneAmbient(); plainsScene.ambientColor = sa.color; plainsScene.ambientIntensity = sa.intensity; }
const hero    = new CubeHero('hero', 3.5, 3.5);
plainsScene.addObject(hero);
plainsScene.camera.follow(hero);
plainsScene.camera.lerpFactor = 0.06;
const sunLight = plainsScene.dirLights[0] as DirectionalLight | undefined;
const plainsMover = new ClickMover({ cols: PLAINS_COLS, rows: PLAINS_ROWS, speed: 0.08, collider: plainsCollider });

// 湖水
const LAKE_COLS = 13, LAKE_ROWS = 13;
const { scene: lakeScene, lake: waveLake, portal: lakePortal, collider: lakeCollider } = buildLakeScene(LAKE_COLS, LAKE_ROWS);
const lakeHero  = new CubeHero('hero-lake', LAKE_COLS / 2, LAKE_ROWS / 2);
lakeScene.addObject(lakeHero);
lakeScene.camera.follow(lakeHero);
lakeScene.camera.lerpFactor = 0.05;
const lakeMover = new ClickMover({ cols: LAKE_COLS, rows: LAKE_ROWS, speed: 0.08, collider: lakeCollider });

// 深海
const { scene: deepScene, portal: deepPortal, collider: deepCollider } = buildDeepSeaScene();
const deepHero  = new CubeHero('hero-deep', DEEP_COLS / 2, DEEP_ROWS / 2);
deepScene.addObject(deepHero);
deepScene.camera.follow(deepHero);
deepScene.camera.lerpFactor = 0.05;
const deepMover = new ClickMover({ cols: DEEP_COLS, rows: DEEP_ROWS, speed: 0.08, collider: deepCollider });

// ── 传送 ─────────────────────────────────────────────────────────────────

let teleporting = false;
let fxId = 0;

function spawnBurst(scene: Scene, x: number, y: number): void {
  const id = `tfx-${++fxId}`;
  const ps = new ParticleSystem(id, x, y, 0);
  ps.addEmitter({ maxParticles:70, rate:0, shape:'ring', lifetime:[0.5,1.4], speed:[4,12], angle:[0,Math.PI*2], vz:[3,12], gravity:-5, size:[4,12], sizeFinal:0, colorStart:'#c080ff', colorEnd:'#80c0ff', alphaStart:1, alphaEnd:0, blend:'screen', rotSpeed:[1,5], particleShape:'circle' });
  ps.addEmitter({ maxParticles:35, rate:0, shape:'point', lifetime:[0.3,0.9], speed:[1,5], angle:[0,Math.PI*2], vz:[1,6], gravity:-3, size:[2,5], sizeFinal:0, colorStart:'#ffffff', colorEnd:'#c0a0ff', alphaStart:0.9, alphaEnd:0, blend:'screen', rotSpeed:[0,2], particleShape:'circle' });
  ps.onExhausted = () => scene.removeById(id);
  ps.burst(70); scene.addObject(ps);
}

async function teleport(
  fromScene: Scene, fromHero: CubeHero, fromPortal: { activate(): void; activateBeam?(d: number): void },
  portalX: number, portalY: number,
  toName: string, fadeIn: string, fadeOut: string,
  onBeforeEnter?: () => void,
): Promise<void> {
  teleporting = true;
  fromPortal.activate();
  if ('activateBeam' in fromPortal) (fromPortal as Portal).activateBeam(1.4);
  spawnBurst(fromScene, portalX, portalY);
  fromHero.triggerTeleportFlash();
  await fromHero.triggerAscend();
  await transition.playIn('fade', { color: fadeIn, duration: 350 });
  onBeforeEnter?.();
  await mgr.replace(toName);
  await transition.playOut('fade', { color: fadeOut, duration: 700 });
  teleporting = false;
}


// ── SceneManager ──────────────────────────────────────────────────────────

const mgr = new SceneManager(engine);

let _portalTriggered = false, _portalHintAlpha = 0;
let _lakePortalTriggered = false, _deepPortalTriggered = false;
let _returningFromDeep = false; // 从深海传送回草原时为 true
let _dustTimer = 0, _dreamTimer = 0, _rippleTimer = 0, _mistTimer = 0;

mgr.register('plains', () => ({
  scene: plainsScene,
  onEnter() {
    sceneLabel.text = '低语草原'; hintLabel.text = 'WASD / 点击 移动 · 走向传送阵';
    hintLabel.visible = true; portalHint.visible = false;
    _portalTriggered = false; _portalHintAlpha = 0;
    plainsMover.reset();
    // 如果是从深海回来，播放降落光柱
    if (_returningFromDeep) {
      _returningFromDeep = false;
      const beam = new Portal('plains-arrival-beam', 3.5, 3.5);
      plainsScene.addObject(beam); beam.activateBeam(1.8); hero.triggerDescend(Portal.BEAM_HEIGHT_PX);
      setTimeout(() => { plainsScene.removeById('plains-arrival-beam'); }, 2600);
    }
  },
  onUpdate(dt, inp) {
    // 日夜
    dayNight.update(dt);
    const dp = dayNight.getDirLightParams();
    if (sunLight) { sunLight.color = dp.color; sunLight.intensity = dp.intensity; sunLight.angle = dp.angle * Math.PI / 180; sunLight.elevation = dp.elevation * Math.PI / 180; }
    const sa = dayNight.getSceneAmbient();
    plainsScene.ambientColor = sa.color; plainsScene.ambientIntensity = sa.intensity;
    const n = dayNight.nightness;
    timeLabel.text  = n > 0.7 ? '🌙 夜晚' : n > 0.3 ? '🌅 黄昏' : '☀ 白天';
    timeLabel.color = n > 0.7 ? 'rgba(160,200,255,0.85)' : n > 0.3 ? 'rgba(255,160,80,0.9)' : 'rgba(255,240,180,0.85)';

    // 移动
    plainsMover.update(dt, inp, map, plainsScene.camera, plainsScene.tileW, plainsScene.tileH, engine.originX, engine.originY, canvas.width, canvas.height, hero.position.x, hero.position.y);
    hero.velX = plainsMover.velX; hero.velY = plainsMover.velY;
    hero.position.x += plainsMover.velX; hero.position.y += plainsMover.velY;

    // 传送阵
    const dist = Math.hypot(hero.position.x - PORTAL_X, hero.position.y - PORTAL_Y);
    hero.portalProximity = Math.max(0, 1 - dist / 4.0);
    if (hero.portalProximity > 0.3 && !_portalTriggered) {
      _portalHintAlpha = Math.min(1, _portalHintAlpha + dt * 2);
      portalHint.visible = true; portalHint.color = `rgba(180,140,255,${(_portalHintAlpha * 0.85).toFixed(2)})`;
    } else {
      _portalHintAlpha = Math.max(0, _portalHintAlpha - dt * 3);
      portalHint.visible = _portalHintAlpha > 0.01;
      if (portalHint.visible) portalHint.color = `rgba(180,140,255,${(_portalHintAlpha * 0.85).toFixed(2)})`;
    }
    if (!_portalTriggered && dist < portal.triggerRadius) {
      _portalTriggered = true;
      portal.activate(); portal.activateBeam(1.4); spawnBurst(plainsScene, PORTAL_X, PORTAL_Y);
      hero.triggerTeleportFlash();
      hero.triggerAscend().then(async () => {
        await transition.playIn('fade', { color: '#ffffff', duration: 280 });
        await mgr.replace('lake');
        await transition.playOut('fade', { color: '#0a1a3a', duration: 650 });
        teleporting = false;
      });
      teleporting = true;
    }

    // 粒子
    _dustTimer += dt; if (_dustTimer > 0.7) { _dustTimer = 0; _spawnDust(plainsScene, PLAINS_COLS, PLAINS_ROWS); }
    if (n < 0.5) { _dreamTimer += dt; if (_dreamTimer > 0.5) { _dreamTimer = 0; _spawnDream(plainsScene, PLAINS_COLS, PLAINS_ROWS); } }
  },
  onDrawBackground: (ctx, w, h, ts) => drawPlainsSky(ctx, w, h, ts, dayNight),
  onDrawOverlay: (ctx, _w, _h, ts) => plainsMover.drawMarker(ctx, plainsScene.camera, plainsScene.tileW, plainsScene.tileH, engine.originX, engine.originY, ts),
}));

mgr.register('lake', () => ({
  scene: lakeScene,
  onEnter() {
    sceneLabel.text = '幻梦之湖'; hintLabel.text = '感受水之低语… 寻找深海传送门'; hintLabel.visible = true;
    _lakePortalTriggered = false;
    lakeMover.reset();
    const landX = LAKE_SPAWN_X, landY = LAKE_SPAWN_Y;
    lakeHero.position.x = landX; lakeHero.position.y = landY;
    const beam = new Portal('arrival-beam', landX, landY);
    lakeScene.addObject(beam); beam.activateBeam(1.8); lakeHero.triggerDescend(Portal.BEAM_HEIGHT_PX);
    setTimeout(() => { lakeScene.removeById('arrival-beam'); hintLabel.visible = false; }, 2600);
  },
  onUpdate(dt, inp) {
    lakeMover.update(dt, inp, map, lakeScene.camera, lakeScene.tileW, lakeScene.tileH, engine.originX, engine.originY, canvas.width, canvas.height, lakeHero.position.x, lakeHero.position.y);
    lakeHero.velX = lakeMover.velX; lakeHero.velY = lakeMover.velY;
    lakeHero.position.x += lakeMover.velX; lakeHero.position.y += lakeMover.velY;

    if (Math.hypot(lakeMover.velX, lakeMover.velY) > 0.002) {
      _rippleTimer += dt;
      if (_rippleTimer > 0.32) { _rippleTimer = 0; waveLake.addRipple(lakeHero.position.x, lakeHero.position.y); _spawnRipple(lakeScene, lakeHero.position.x, lakeHero.position.y); }
    } else { _rippleTimer = 0; }
    _mistTimer += dt; if (_mistTimer > 1.0) { _mistTimer = 0; _spawnMist(lakeScene, LAKE_COLS, LAKE_ROWS); }

    const d = Math.hypot(lakeHero.position.x - LAKE_PORTAL_X, lakeHero.position.y - LAKE_PORTAL_Y);
    if (!_lakePortalTriggered && d < lakePortal.triggerRadius) {
      _lakePortalTriggered = true;
      teleport(lakeScene, lakeHero, lakePortal, LAKE_PORTAL_X, LAKE_PORTAL_Y, 'deep', '#001830', '#000a18');
    }
  },
  onDrawBackground: drawLakeSky,
  onDrawOverlay: (ctx, _w, _h, ts) => lakeMover.drawMarker(ctx, lakeScene.camera, lakeScene.tileW, lakeScene.tileH, engine.originX, engine.originY, ts),
}));

mgr.register('deep', () => ({
  scene: deepScene,
  onEnter() {
    sceneLabel.text = '神秘深海'; hintLabel.text = '深海的秘密… 寻找回归之门'; hintLabel.visible = true;
    _deepPortalTriggered = false;
    deepMover.reset();
    deepHero.position.x = DEEP_SPAWN_X; deepHero.position.y = DEEP_SPAWN_Y;
    deepHero.triggerDescend(Portal.BEAM_HEIGHT_PX);
    // 降落光柱
    const deepBeam = new Portal('deep-arrival-beam', DEEP_SPAWN_X, DEEP_SPAWN_Y);
    deepScene.addObject(deepBeam); deepBeam.activateBeam(1.8);
    setTimeout(() => { deepScene.removeById('deep-arrival-beam'); hintLabel.visible = false; }, 2600);
  },
  onUpdate(dt, inp) {
    deepMover.update(dt, inp, map, deepScene.camera, deepScene.tileW, deepScene.tileH, engine.originX, engine.originY, canvas.width, canvas.height, deepHero.position.x, deepHero.position.y);
    deepHero.velX = deepMover.velX; deepHero.velY = deepMover.velY;
    deepHero.position.x += deepMover.velX; deepHero.position.y += deepMover.velY;

    const d = Math.hypot(deepHero.position.x - DEEP_PORTAL_X, deepHero.position.y - DEEP_PORTAL_Y);
    if (!_deepPortalTriggered && d < deepPortal.triggerRadius) {
      _deepPortalTriggered = true;
      // 传送回草原，角色降落在草原起始点（远离草原传送门）
      teleport(deepScene, deepHero, deepPortal, DEEP_PORTAL_X, DEEP_PORTAL_Y, 'plains', '#0a1a3a', '#88ccff', () => {
        hero.position.x = 3.5; hero.position.y = 3.5;
        _portalTriggered = false; _portalHintAlpha = 0;
        _returningFromDeep = true;
      });
    }
  },
  onDrawBackground: drawDeepSky,
  onDrawOverlay: (ctx, _w, _h, ts) => deepMover.drawMarker(ctx, deepScene.camera, deepScene.tileW, deepScene.tileH, engine.originX, engine.originY, ts),
}));


// ── 启动 ─────────────────────────────────────────────────────────────────

await mgr.push('plains');

let _lastTs = 0;

engine.start(
  (ts) => {
    // onDrawOverlay 由 SceneManager 驱动
    mgr.currentManaged?.onDrawOverlay?.(engine.ctx, canvas.width, canvas.height, ts);
    hud.draw(engine.ctx, canvas.width, canvas.height);
    transition.draw(canvas.width, canvas.height, ts);
  },
  (ts) => {
    const dt = _lastTs === 0 ? 0.016 : Math.min((ts - _lastTs) / 1000, 0.1);
    _lastTs = ts;

    // 背景
    mgr.currentManaged?.onDrawBackground?.(engine.ctx, canvas.width, canvas.height, ts);

    if (teleporting) { input.flush(); return; }

    // 场景逻辑
    mgr.update(dt, input);
    input.flush();
  },
);

// ── 粒子工具 ─────────────────────────────────────────────────────────────

function _spawnDust(scene: Scene, cols: number, rows: number): void {
  const id = `dust-${++fxId}`;
  const ps = new ParticleSystem(id, 2 + Math.random()*(cols-4), 2 + Math.random()*(rows-4), 0);
  ps.addEmitter({ maxParticles:5, rate:0, shape:'point', lifetime:[2.0,3.5], speed:[0.08,0.35], angle:[0,Math.PI*2], vz:[0.8,2.5], gravity:-0.4, size:[1,3], sizeFinal:0, colorStart:'#ffe8a0', colorEnd:'#ffd060', alphaStart:0.45, alphaEnd:0, blend:'screen', rotSpeed:[0,1], particleShape:'circle' });
  ps.onExhausted = () => scene.removeById(id); ps.burst(5); scene.addObject(ps);
}

function _spawnDream(scene: Scene, cols: number, rows: number): void {
  const id = `dream-${++fxId}`;
  const ps = new ParticleSystem(id, 1 + Math.random()*(cols-2), 1 + Math.random()*(rows-2), 0);
  ps.addEmitter({ maxParticles:3, rate:0, shape:'point', lifetime:[3.5,6.0], speed:[0.05,0.18], angle:[0,Math.PI*2], vz:[0.3,1.2], gravity:-0.12, size:[2,5], sizeFinal:0, colorStart:'#c0a8ff', colorEnd:'#80c0ff', alphaStart:0.55, alphaEnd:0, blend:'screen', rotSpeed:[0,0.5], particleShape:'circle' });
  ps.onExhausted = () => scene.removeById(id); ps.burst(3); scene.addObject(ps);
}

function _spawnRipple(scene: Scene, x: number, y: number): void {
  const id = `rpl-${++fxId}`;
  const ps = new ParticleSystem(id, x, y, 1);
  ps.addEmitter({ maxParticles:12, rate:0, shape:'ring', lifetime:[0.4,0.9], speed:[0.8,2.2], angle:[0,Math.PI*2], vz:[0,0.4], gravity:0, size:[3,7], sizeFinal:0, colorStart:'#a0e0ff', colorEnd:'#60b0ff', alphaStart:0.6, alphaEnd:0, blend:'screen', rotSpeed:[0,0], particleShape:'circle' });
  ps.onExhausted = () => scene.removeById(id); ps.burst(12); scene.addObject(ps);
}

function _spawnMist(scene: Scene, cols: number, rows: number): void {
  const id = `mist-${++fxId}`;
  const ps = new ParticleSystem(id, 1 + Math.random()*(cols-2), 1 + Math.random()*(rows-2), 2);
  ps.addEmitter({ maxParticles:4, rate:0, shape:'point', lifetime:[2.5,5.0], speed:[0.04,0.18], angle:[0,Math.PI*2], vz:[0.4,1.2], gravity:-0.15, size:[5,12], sizeFinal:0, colorStart:'#80c0ff', colorEnd:'#4080c0', alphaStart:0.2, alphaEnd:0, blend:'screen', rotSpeed:[0,0.3], particleShape:'circle' });
  ps.onExhausted = () => scene.removeById(id); ps.burst(4); scene.addObject(ps);
}

// ── 背景绘制 ─────────────────────────────────────────────────────────────
// 三个天空的绘制在 environment/skies.ts，本文件只负责接线。

