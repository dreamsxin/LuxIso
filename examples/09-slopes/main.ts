/**
 * 09 — Slopes
 *
 * Demonstrates:
 *   • Height-map terrain: smooth voxel hills with correct 3-face iso geometry
 *   • Per-face lighting (top / right / left faces have different shade)
 *   • Character z follows terrain surface (bilinear interpolation, spring damping)
 *   • Uphill slower / downhill faster via gradient-based speed factor
 *   • Blob shadow projects onto z=0, scales with elevation
 *   • Dashed elevation indicator line + footstep trail on terrain surface
 *
 * Controls: WASD / Arrow keys
 */
import {
  Engine, Scene, OmniLight, DirectionalLight, InputManager, BaseLight,
} from '../../src/index';
import {SlopeTerrain} from './SlopeTerrain';
import {SlopeCharacter} from './SlopeCharacter';

// ── Canvas & Engine ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = Math.min(window.innerWidth - 24, 960);
canvas.height = Math.min(window.innerHeight - 120, 620);

const engine = new Engine({canvas});
engine.originX = canvas.width / 2;
engine.originY = canvas.height * 0.40;

// ── Scene ─────────────────────────────────────────────────────────────────────

const COLS = 14, ROWS = 14;
const scene = new Scene({tileW: 64, tileH: 32, cols: COLS, rows: ROWS});
scene.dynamicLighting = true;
scene.ambientColor = '#b8ccc0';
scene.ambientIntensity = 0.40;
engine.setScene(scene);

// ── Lights ────────────────────────────────────────────────────────────────────

// Each light carries an id + label so the toggle UI (keys 1/2/3) can name it.
// Toggling flips `light.enabled`; Scene's omniLights/dirLights getters filter
// on `enabled !== false`, so a disabled light is skipped everywhere (lightmap
// bake, shadow casting, DrawContext) with no manual add/remove needed.
const sunLight = new DirectionalLight({
  id: 'sun', angle: 215, elevation: 60, color: '#fff4d0', intensity: 0.85,
});
const fillLight = new DirectionalLight({
  id: 'fill', angle: 35, elevation: 20, color: '#b0c8ff', intensity: 0.22,
});
const peakGlow = new OmniLight({
  id: 'peak-glow', x: 7, y: 6, z: 120,
  color: '#d0f0b0', intensity: 0.45, radius: 380,
});
scene.addLight(sunLight);
scene.addLight(fillLight);
scene.addLight(peakGlow);

// Toggleable light registry: key 1/2/3 flips each light's `enabled` flag.
const toggleLights = [
  {light: sunLight as BaseLight, key: '1', label: 'Sun (dir 215°)'},
  {light: fillLight as BaseLight, key: '2', label: 'Fill (dir 35°)'},
  {light: peakGlow as BaseLight, key: '3', label: 'Peak-glow (omni)'},
];

// ── Terrain ───────────────────────────────────────────────────────────────────

const terrain = new SlopeTerrain('terrain', COLS, ROWS);
scene.addObject(terrain);

// ── Character ─────────────────────────────────────────────────────────────────

const hero = new SlopeCharacter('hero', COLS / 2, ROWS / 2 + 2, terrain);
scene.addObject(hero);

// ── Input ─────────────────────────────────────────────────────────────────────

const input = new InputManager(canvas);

// ── Render loop ───────────────────────────────────────────────────────────────

let prevTs = 0;

engine.start(
  // onFrame — called after scene.draw()
  ts => {
    const dt = prevTs === 0 ? 1 / 60 : Math.min((ts - prevTs) / 1000, 0.1);
    prevTs = ts;

    // ── Input → movement ─────────────────────────────────────────────────
    let dx = 0, dy = 0;
    if (input.isDown('ArrowLeft') || input.isDown('a') || input.isDown('A')) {dx -= 1;}
    if (input.isDown('ArrowRight') || input.isDown('d') || input.isDown('D')) {dx += 1;}
    if (input.isDown('ArrowUp') || input.isDown('w') || input.isDown('W')) {dy -= 1;}
    if (input.isDown('ArrowDown') || input.isDown('s') || input.isDown('S')) {dy += 1;}
    hero.move(dx, dy, dt);

    // ── Light toggle (keys 1/2/3) ─────────────────────────────────────────
    // Flips `enabled` on the matching light. Scene re-bakes the lightmap
    // automatically next frame because the lights-snapshot changed.
    for (const t of toggleLights) {
      if (input.wasPressed(t.key)) {
        t.light.enabled = !t.light.enabled;
      }
    }

    // ── HUD ───────────────────────────────────────────────────────────────
    const ctx = engine.ctx;
    const cw = canvas.width, ch = canvas.height;

    // Height legend bar (right side)
    const barW = 12, barH = 110;
    const barX = cw - 32, barY = ch / 2 - barH / 2;
    const lg = ctx.createLinearGradient(0, barY, 0, barY + barH);
    lg.addColorStop(0, '#e6e8eb'); // snow
    lg.addColorStop(0.32, '#5f5549'); // rock
    lg.addColorStop(0.62, '#487838'); // grass
    lg.addColorStop(0.90, '#b4a56e'); // sand
    lg.addColorStop(1, '#2a5078'); // water
    ctx.fillStyle = lg;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${terrain.maxH.toFixed(1)}`, barX - 3, barY + 6);
    ctx.fillText('0.0', barX - 3, barY + barH + 4);
    ctx.textAlign = 'left';

    // Info panel
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(10, 10, 248, 64);
    ctx.fillStyle = '#c8e0cc';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.fillText('09 — Slopes', 18, 28);
    ctx.fillStyle = '#8aaa94';
    ctx.font = '10px monospace';
    ctx.fillText(`pos   (${hero.position.x.toFixed(2)}, ${hero.position.y.toFixed(2)})`, 18, 44);
    ctx.fillText(`height  ${hero.position.z.toFixed(3)} wu  /  ${(hero.position.z * 32).toFixed(0)} px`, 18, 58);
    ctx.restore();

    // Light toggle panel (top-right): lists each light with its hotkey and
    // on/off state. A disabled light is dimmed and marked (off).
    ctx.save();
    const panelW = 196, panelH = 14 + toggleLights.length * 16;
    const panelX = cw - panelW - 12, panelY = 12;
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    for (let i = 0; i < toggleLights.length; i++) {
      const t = toggleLights[i];
      const on = t.light.enabled !== false;
      const y = panelY + 18 + i * 16;
      // Hotkey chip
      ctx.fillStyle = on ? '#d0f0b0' : '#445544';
      ctx.fillText(`[${t.key}]`, panelX + 8, y);
      // Status dot
      ctx.fillStyle = on ? t.light.color : '#334433';
      ctx.beginPath();
      ctx.arc(panelX + 34, y - 3, 4, 0, Math.PI * 2);
      ctx.fill();
      // Label
      ctx.fillStyle = on ? '#c8e0cc' : '#4a5a4a';
      ctx.fillText(`${t.label}  ${on ? 'on' : 'off'}`, panelX + 44, y);
    }
    ctx.restore();

    // Controls hint
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(10, ch - 28, 320, 20);
    ctx.fillStyle = '#607870';
    ctx.font = '10px monospace';
    ctx.fillText('WASD / ↑↓←-> move   ·   1/2/3 toggle lights', 16, ch - 13);
    ctx.restore();

    input.flush();
  },

  // preFrame — sky background drawn before scene
  () => {
    const ctx = engine.ctx;
    const cw = canvas.width, ch = canvas.height;
    const sky = ctx.createLinearGradient(0, 0, 0, ch * 0.65);
    sky.addColorStop(0, '#0e1c30');
    sky.addColorStop(0.5, '#1a3428');
    sky.addColorStop(1, '#263c2a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cw, ch);
  }
);
