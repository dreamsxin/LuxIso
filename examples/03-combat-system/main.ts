/**
 * Example 03 — Combat System
 *
 * Demonstrates:
 *   - HealthComponent (takeDamage, onDeath)
 *   - ParticleSystem presets
 *   - FloatingText (damage numbers)
 *   - EventBus (damage / death events)
 *   - Crystal, Boulder, Chest props
 */
import {
  Engine, Scene, Floor, OmniLight,
  Crystal, Boulder, Chest,
  HealthComponent, ParticleSystem,
  globalBus,
} from '../../src/index';

const COLS = 8, ROWS = 8, TILE_W = 64, TILE_H = 32;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = (COLS + ROWS) * (TILE_W / 2);
canvas.height = (COLS + ROWS) * (TILE_H / 2) + 60;

const engine = new Engine({canvas});
engine.originX = canvas.width / 2;
engine.originY = ROWS * (TILE_H / 2) + 10;

// ── Scene ──────────────────────────────────────────────────────────────────

const scene = new Scene({tileW: TILE_W, tileH: TILE_H, cols: COLS, rows: ROWS});
scene.addObject(new Floor({id: 'floor', cols: COLS, rows: ROWS, color: '#4a7c59', altColor: '#3d6b4a'}));
scene.addLight(new OmniLight({x: 4, y: 4, z: 140, color: '#ffe8a0', intensity: 1.3, radius: 300}));

// ── Props with health ──────────────────────────────────────────────────────

let fxId = 0;
function spawnFx(x: number, y: number, color: string, preset: 'crystal' | 'spark' | 'dust'): void {
  const id = `fx-${++fxId}`;
  const ps = new ParticleSystem(id, x, y, 0);
  if (preset === 'crystal') {ps.addEmitter(ParticleSystem.presets.crystalShatter({color}));}
  else if (preset === 'dust') {ps.addEmitter(ParticleSystem.presets.dustPuff({color}));}
  else {ps.addEmitter(ParticleSystem.presets.sparkBurst({color}));}
  ps.onExhausted = () => scene.removeById(id);
  ps.burst();
  scene.addObject(ps);
}

const crystal = new Crystal('crystal', 2, 2, '#8060e0');
crystal.addComponent(new HealthComponent({
  bus: globalBus,
  max: 60,
  onChange: () => spawnFx(crystal.position.x, crystal.position.y, '#8060e0', 'spark'),
  onDeath: () => {
    spawnFx(crystal.position.x, crystal.position.y, '#8060e0', 'crystal');
    scene.removeById('crystal');
  },
}));
scene.addObject(crystal);

const boulder = new Boulder('boulder', 4, 3);
boulder.addComponent(new HealthComponent({
  bus: globalBus,
  max: 80,
  onChange: () => spawnFx(boulder.position.x, boulder.position.y, '#888', 'dust'),
  onDeath: () => { spawnFx(boulder.position.x, boulder.position.y, '#888', 'dust'); scene.removeById('boulder'); },
}));
scene.addObject(boulder);

const chest = new Chest('chest', 6, 5);
chest.addComponent(new HealthComponent({
  bus: globalBus,
  max: 40,
  onChange: (hp, max) => {
    if (hp < max) {chest.open();}
    spawnFx(chest.position.x, chest.position.y, '#ffd040', 'spark');
  },
  onDeath: () => { chest.open(); spawnFx(chest.position.x, chest.position.y, '#ffd040', 'spark'); },
}));
scene.addObject(chest);

// ── EventBus: log damage ───────────────────────────────────────────────────

globalBus.on('damage', ({amount, targetId, sourceId}) => {
  const who = targetId ?? 'unknown';
  const from = sourceId ? ` (from ${sourceId})` : '';
  console.log(`[damage] ${who} took ${amount}${from}`);
});
globalBus.on('death', ({id}) => {
  console.log(`[death] ${id} has been destroyed`);
});

// ── Click to damage ────────────────────────────────────────────────────────

const props = [crystal, boulder, chest];

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

  for (const prop of props) {
    const {sx, sy} = scene.camera.worldToScreen(
      prop.position.x, prop.position.y, 0,
      TILE_W, TILE_H, engine.originX, engine.originY
    );
    if (Math.hypot(cx - sx, cy - sy) < 32) {
      const hp = prop.getComponent(HealthComponent);
      if (hp && !hp.isDead) {
        hp.takeDamage(20);
        scene.spawnFloatingText({
          x: prop.position.x, y: prop.position.y, z: 40,
          text: '-20', color: '#ff4040', duration: 900, fontSize: 18,
        });
      }
      break;
    }
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

engine.setScene(scene);
engine.start();
