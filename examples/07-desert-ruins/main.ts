/**
 * 07 — Desert Ruins
 * 沙漠遗迹：沙丘地形、金字塔、仙人掌、石柱、石碑交互、传送阵。
 */
import {
  Engine, Scene, OmniLight, DirectionalLight,
  InputManager, ParticleSystem,
} from '../../src/index';
import {SandDune} from './DesertTerrain';
import {Pyramid, Cactus, BrokenPillar, StoneTablet} from './DesertProps';
import {SandDustSystem} from './SandDust';
import {HiddenPortal} from './DesertPortal';

// ── Canvas & Engine ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = Math.min(window.innerWidth - 24, 900);
canvas.height = Math.min(window.innerHeight - 120, 580);

const engine = new Engine({canvas});
engine.originX = canvas.width / 2;
engine.originY = canvas.height * 0.38;

// ── Scene ─────────────────────────────────────────────────────────────────────

const COLS = 16, ROWS = 16;
const scene = new Scene({tileW: 64, tileH: 32, cols: COLS, rows: ROWS});
scene.dynamicLighting = true;
scene.ambientColor = '#f0c870';
scene.ambientIntensity = 0.4;
engine.setScene(scene);

// ── 光源 ──────────────────────────────────────────────────────────────────────

// 烈日方向光（高仰角 70°，暖白色）
scene.addLight(new DirectionalLight({angle: 225, elevation: 70, color: '#fff8e0', intensity: 0.85}));
// 橙色 OmniLight 在场景中央
scene.addLight(new OmniLight({
  id: 'sun-omni', x: COLS / 2, y: ROWS / 2, z: 80,
  color: '#ff9040', intensity: 0.4, radius: 600,
}));

// ── 地形 ──────────────────────────────────────────────────────────────────────

const terrain = new SandDune('terrain', COLS, ROWS);
scene.addObject(terrain);

// ── 道具 ──────────────────────────────────────────────────────────────────────

scene.addObject(new Pyramid('pyramid', 7, 7));

scene.addObject(new Cactus('cactus-0', 3, 3, 0.2));
scene.addObject(new Cactus('cactus-1', 12, 5, 0.6));
scene.addObject(new Cactus('cactus-2', 5, 12, 0.9));

scene.addObject(new BrokenPillar('pillar-0', 1, 1, 0.1));
scene.addObject(new BrokenPillar('pillar-1', 14, 2, 0.4));
scene.addObject(new BrokenPillar('pillar-2', 2, 13, 0.7));
scene.addObject(new BrokenPillar('pillar-3', 13, 13, 0.9));

// ── 石碑 ──────────────────────────────────────────────────────────────────────

const tabletDefs: Array<[string, number, number, number]> = [
  ['tablet-0', 5, 5, 0.1],
  ['tablet-1', 10, 6, 0.5],
  ['tablet-2', 7, 11, 0.8],
];
const tablets = tabletDefs.map(([id, x, y, seed]) => {
  const t = new StoneTablet(id, x, y, seed);
  scene.addObject(t);
  return t;
});

// ── 传送阵 ────────────────────────────────────────────────────────────────────

const portals = tabletDefs.map(([, x, y], i) => {
  const p = new HiddenPortal(`portal-${i}`, x, y);
  scene.addObject(p);
  return p;
});

// ── 沙尘系统 ──────────────────────────────────────────────────────────────────

const dustSystem = new SandDustSystem('dust', COLS, ROWS);
scene.addObject(dustSystem);

// ── 输入 ──────────────────────────────────────────────────────────────────────

const input = new InputManager(canvas);

// ── HUD 状态 ──────────────────────────────────────────────────────────────────

let activatedCount = 0;

// ── 控制面板 ──────────────────────────────────────────────────────────────────

function $<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function bindSlider(id: string, valId: string, cb: (v: number) => void): void {
  const el = $<HTMLInputElement>(id);
  const vl = $<HTMLSpanElement>(valId);
  el.addEventListener('input', () => { const v = Number(el.value); vl.textContent = v.toFixed(1); cb(v); });
}

bindSlider('dust-speed', 'dust-speed-val', v => { dustSystem.speedMult = v; });
bindSlider('heat-wave', 'heat-wave-val', v => { terrain.heatWaveStrength = v; });

// ── 渲染循环 ──────────────────────────────────────────────────────────────────

engine.start(
  // postFrame — HUD
  ts => {
    const ctx = engine.ctx;
    const w = canvas.width;

    // HUD 文字
    ctx.save();
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const hudText = `已激活 ${activatedCount}/3 石碑`;
    const hudColor = activatedCount === 3 ? '#ffd040' : '#c8a050';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(w / 2 - 80, 14, 160, 26);
    ctx.fillStyle = hudColor;
    ctx.fillText(hudText, w / 2, 32);
    ctx.restore();

    // 点击检测
    if (input.pointer.pressed) {
      const world = scene.camera
        ? scene.camera.screenToWorld(
            input.pointer.x, input.pointer.y,
            canvas.width, canvas.height,
            scene.tileW, scene.tileH,
            engine.originX, engine.originY
          )
        : _screenToWorld(input.pointer.x, input.pointer.y);

      for (let i = 0; i < tablets.length; i++) {
        const t = tablets[i];
        if (t.isActivated) {continue;}
        const dist = Math.hypot(world.x - t.position.x, world.y - t.position.y);
        if (dist < t.triggerRadius) {
          t.isActivated = true;
          portals[i].activate();
          activatedCount++;

          // 粒子爆发
          const burst = new ParticleSystem(`burst-${i}-${ts}`, t.position.x, t.position.y, 0);
          burst.addEmitter({
            maxParticles: 30,
            rate: 0,
            shape: 'ring',
            spawnRadius: 0.3,
            lifetime: [0.4, 0.9],
            speed: [1.5, 4],
            angle: [0, Math.PI * 2],
            vz: [1, 4],
            gravity: -5,
            size: [3, 8],
            sizeFinal: 0,
            colorStart: '#ffd040',
            colorEnd: '#ff8800',
            alphaStart: 1,
            alphaEnd: 0,
            blend: 'screen',
            particleShape: 'square',
          });
          burst.burst(30);
          // ParticleSystem has no autoRemove field; remove explicitly when
          // all particles have died so bursts don't accumulate in the scene.
          const burstId = burst.id;
          burst.onExhausted = () => { scene.removeById(burstId); };
          scene.addObject(burst);
        }
      }
    }

    input.flush();
  },
  // preFrame — 背景
  ts => {
    const ctx = engine.ctx;
    const w = canvas.width, h = canvas.height;
    const t = ts * 0.0003;

    // 沙漠天空渐变（橙黄到深蓝）
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
    sky.addColorStop(0, '#1a2a5a');
    sky.addColorStop(0.35, '#4a3a10');
    sky.addColorStop(0.65, '#c87820');
    sky.addColorStop(1, '#e8a030');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 太阳光晕
    const sunX = w * 0.72, sunY = h * 0.18;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.28);
    sunGlow.addColorStop(0, `rgba(255,240,180,${0.55 + Math.sin(t) * 0.05})`);
    sunGlow.addColorStop(0.15, `rgba(255,200,80,${0.25 + Math.sin(t * 1.3) * 0.03})`);
    sunGlow.addColorStop(0.5, 'rgba(220,140,20,0.08)');
    sunGlow.addColorStop(1, 'rgba(180,100,0,0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, w, h);

    // 太阳圆盘
    ctx.beginPath();
    ctx.arc(sunX, sunY, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#fff8c0';
    ctx.fill();
  }
);

// ── 简单 screenToWorld（无 camera 时） ────────────────────────────────────────

function _screenToWorld(sx: number, sy: number): {x: number; y: number} {
  const lsx = (sx - engine.originX);
  const lsy = (sy - engine.originY);
  const tileW = scene.tileW, tileH = scene.tileH;
  const a = lsx / (tileW / 2);
  const b = lsy / (tileH / 2);
  return {x: (a + b) / 2, y: (b - a) / 2};
}
