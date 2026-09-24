/**
 * 06 — Voxel Lake
 * 由数百个小立方体组成的动态湖面，湖底有低多边形石头和水草。
 */
import {Engine, Scene, OmniLight, DirectionalLight, Floor} from '../../src/index';
import {VoxelLake} from './VoxelLake';
import {SeabedRock, SeabedWeed} from './SeabedDecor';

// ── Canvas & Engine ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = Math.min(window.innerWidth - 24, 900);
canvas.height = Math.min(window.innerHeight - 120, 580);

const engine = new Engine({canvas});
engine.originX = canvas.width / 2;
engine.originY = canvas.height * 0.42;

// ── Scene ─────────────────────────────────────────────────────────────────────

const COLS = 12, ROWS = 12;
const scene = new Scene({tileW: 64, tileH: 32, cols: COLS, rows: ROWS});
scene.dynamicLighting = true;
scene.ambientColor = '#0a1828';
scene.ambientIntensity = 0.35;
engine.setScene(scene);

// ── 湖底地面（深色） ──────────────────────────────────────────────────────────

scene.addObject(new Floor({id: 'seabed', cols: COLS, rows: ROWS, color: '#0a1420', altColor: '#0c1828'}));

// ── 光源 ──────────────────────────────────────────────────────────────────────

scene.addLight(new DirectionalLight({angle: 225, elevation: 40, color: '#4080c0', intensity: 0.6}));
scene.addLight(new OmniLight({
  id: 'glow-center', x: COLS / 2, y: ROWS / 2, z: 60,
  color: '#2060a0', intensity: 0.5, radius: 500,
}));
scene.addLight(new OmniLight({id: 'glow-blue', x: 3, y: 4, z: 40, color: '#0080ff', intensity: 0.3, radius: 280}));
scene.addLight(new OmniLight({id: 'glow-teal', x: 9, y: 8, z: 40, color: '#00c0a0', intensity: 0.25, radius: 240}));

// ── 湖底装饰（在水面立方体之前添加，深度排序会处理遮挡） ─────────────────────

const rockPositions: Array<[number, number, number, string]> = [
  [1.5, 2.5, 0.5, '#1a2a3a'], [4.5, 1.5, 0.7, '#152030'],
  [8.5, 3.5, 0.4, '#1a2a3a'], [2.5, 7.5, 0.6, '#152030'],
  [10.5, 5.5, 0.5, '#1a2a3a'], [6.5, 10.5, 0.8, '#152030'],
  [11.5, 9.5, 0.4, '#1a2a3a'], [3.5, 10.5, 0.6, '#152030'],
  [7.5, 2.5, 0.5, '#1a2a3a'], [0.5, 5.5, 0.7, '#152030'],
];
for (const [i, [rx, ry, sz, col]] of rockPositions.entries()) {
  scene.addObject(new SeabedRock(`rock-${i}`, rx, ry, {size: sz, seed: i * 0.17, color: col}));
}

const weedPositions: Array<[number, number, number]> = [
  [2.5, 3.5, 0.1], [5.5, 2.5, 0.4], [9.5, 4.5, 0.7],
  [1.5, 6.5, 0.2], [7.5, 7.5, 0.5], [4.5, 9.5, 0.8],
  [10.5, 8.5, 0.3], [3.5, 11.5, 0.6], [8.5, 1.5, 0.9],
  [6.5, 5.5, 0.15], [11.5, 3.5, 0.55], [0.5, 9.5, 0.75],
  [5.5, 11.5, 0.35], [9.5, 10.5, 0.65], [2.5, 1.5, 0.45],
];
for (const [i, [wx, wy, seed]] of weedPositions.entries()) {
  const colors = ['#0d4a38', '#0a3a50', '#0d5a40', '#0a4060'];
  scene.addObject(new SeabedWeed(`weed-${i}`, wx, wy, {
    height: 0.5 + seed * 0.9,
    color: colors[i % colors.length],
    seed,
  }));
}

// ── 体素湖面 ──────────────────────────────────────────────────────────────────

const VOXEL_SIZE = 0.25;
const lake = new VoxelLake('lake', 0, 0, {
  cols: COLS, rows: ROWS,
  voxelSize: VOXEL_SIZE,
  waveSpeed: 1.2,
  amplitude: 1.8,
  waveLength: 1.5,
  opacity: 0.72,
});
scene.addObject(lake);

// ── 控制面板 ──────────────────────────────────────────────────────────────────

function $<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
function bindSlider(id: string, valId: string, cb: (v: number) => void): void {
  const el = $<HTMLInputElement>(id);
  const vl = $<HTMLSpanElement>(valId);
  el.addEventListener('input', () => { const v = Number(el.value); vl.textContent = v.toFixed(1); cb(v); });
}

bindSlider('wave-speed', 'wave-speed-val', v => { lake.waveSpeed = v; });
bindSlider('amplitude', 'amplitude-val', v => { lake.amplitude = v; });
bindSlider('wave-len', 'wave-len-val', v => { lake.waveLength = v; });
bindSlider('opacity', 'opacity-val', v => { lake.opacity = v; });

// ── 渲染循环 ──────────────────────────────────────────────────────────────────

engine.start(
  undefined,
  ts => {
    // 深海背景
    const ctx = engine.ctx;
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#020508');
    grad.addColorStop(0.5, '#040c14');
    grad.addColorStop(1, '#060f1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 水下光晕
    const t = ts * 0.0004;
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.6, 0, w * 0.5, h * 0.6, w * 0.55);
    glow.addColorStop(0, `rgba(0,80,160,${(0.08 + Math.sin(t) * 0.03).toFixed(3)})`);
    glow.addColorStop(0.5, `rgba(0,50,120,${(0.04 + Math.sin(t * 1.3) * 0.02).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(0,20,60,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
);
