/**
 * SlopeCharacter — a Character that rides the terrain height map.
 *
 * position.z  stores the WORLD-UNIT height (same unit as SlopeTerrain.cornerH).
 * When projecting to screen, zPx = position.z * tileH.
 *
 * Visual effects:
 *   • Body snaps to terrain z via spring interpolation (dt * 14 spring constant)
 *   • Blob shadow projected at z=0, scales with elevation
 *   • Dashed elevation indicator line (ground → body)
 *   • Footstep trail that follows the terrain surface
 *   • Speed tilt for momentum feedback
 *   • Gradient penalty: uphill slower, downhill faster (tanh-smooth)
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {project} from '../../src/math/IsoProjection';
import {AABB} from '../../src/math/depthSort';
import {SlopeTerrain} from './SlopeTerrain';

export class SlopeCharacter extends IsoObject {
  terrain: SlopeTerrain;
  speed = 3.5; // world units / second (horizontal)
  radius = 18; // screen pixels
  color = '#5590dd';

  private _targetZ = 0; // world-unit target height (terrain surface)
  private _vx = 0; private _vy = 0;
  private _lastTs = 0;
  private _footTrail: Array<{x: number; y: number; z: number; a: number}> = [];

  constructor(id: string, x: number, y: number, terrain: SlopeTerrain) {
    super(id, x, y, terrain.sampleHeight(x, y));
    this.terrain = terrain;
    this.castsShadow = false;
    this._targetZ = this.position.z;
  }

  get aabb(): AABB {
    const r = 0.5;
    // baseZ / maxZ in PIXEL space (used by depth sorter)
    return {
      minX: this.position.x - r,
      minY: this.position.y - r,
      maxX: this.position.x + r,
      maxY: this.position.y + r,
      baseZ: this.position.z * 32, // approx tileH=32
      maxZ: this.position.z * 32 + 48,
    };
  }

  /** Called each frame from main.ts with directional input and elapsed time. */
  move(dx: number, dy: number, dt: number): void {
    if (dx === 0 && dy === 0) {
      this._vx *= 0.78;
      this._vy *= 0.78;
    } else {
      const len = Math.hypot(dx, dy) || 1;
      // Slope gradient: sample a tiny step ahead
      const {x, y} = this.position;
      const ahead = 0.12;
      const hAhead = this.terrain.sampleHeight(x + dx * ahead / len, y + dy * ahead / len);
      const gradient = (hAhead - this.position.z) / ahead; // dz/ds, world units
      // tanh-shaped factor: uphill → < 1, downhill → > 1
      const slopeFactor = 1.0 - Math.tanh(gradient * 0.9) * 0.38;
      const spd = this.speed * Math.max(0.4, Math.min(1.6, slopeFactor));
      this._vx = (dx / len) * spd;
      this._vy = (dy / len) * spd;
    }

    const nx = Math.max(0.3, Math.min(this.terrain.cols - 0.3, this.position.x + this._vx * dt));
    const ny = Math.max(0.3, Math.min(this.terrain.rows - 0.3, this.position.y + this._vy * dt));
    this.position.x = nx;
    this.position.y = ny;

    // Spring-follow terrain height (world units)
    this._targetZ = this.terrain.sampleHeight(nx, ny);
    this.position.z += (this._targetZ - this.position.z) * Math.min(1, dt * 14);
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    // Footstep trail
    if (dt > 0 && (Math.abs(this._vx) > 0.05 || Math.abs(this._vy) > 0.05)) {
      this._footTrail.push({
        x: this.position.x,
        y: this.position.y,
        z: this.position.z, // world units
        a: 0.5,
      });
      if (this._footTrail.length > 14) {this._footTrail.shift();}
    }
    for (const pt of this._footTrail) {pt.a *= 0.87;}
    this._footTrail = this._footTrail.filter(p => p.a > 0.04);
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y, z} = this.position; // z in world units

    // Helper: project world coords to screen (z → pixels)
    const toScreen = (wx: number, wy: number, wz: number) => {
      const {sx, sy} = project(wx, wy, wz * tileH, tileW, tileH);
      return {x: originX + sx, y: originY + sy};
    };

    // ── Footstep trail ────────────────────────────────────────────────────
    for (const pt of this._footTrail) {
      // Trail dots sit on the terrain surface (use stored z from when placed)
      const sp = toScreen(pt.x, pt.y, pt.z);
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y, 4, 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,140,220,${(pt.a * 0.7).toFixed(2)})`;
      ctx.fill();
    }

    // Shadow & indicator anchor = terrain surface directly below character
    const groundZ = this.terrain.sampleHeight(x, y); // world units
    const gp = toScreen(x, y, groundZ);

    // Gap between character and ground (spring lag, usually small but visible on jump/slope edge)
    const gap = Math.max(0, z - groundZ);

    // ── Blob shadow on terrain surface ────────────────────────────────────
    // Scale/fade with the spring-lag gap (not absolute z, since character
    // rides the terrain — the gap is nearly 0 when settled).
    const shadowFade = Math.max(0, 1 - gap * 0.8);
    const shadowScale = 0.55 + 0.45 * shadowFade;
    ctx.save();
    ctx.globalAlpha = 0.45 * shadowFade;
    ctx.beginPath();
    ctx.ellipse(gp.x, gp.y, this.radius * shadowScale, this.radius * shadowScale * 0.38, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    // ── Elevation indicator line (terrain surface → body) ─────────────────
    const bp = toScreen(x, y, z); // body position on screen
    if (gap > 0.05) {
      ctx.save();
      ctx.strokeStyle = 'rgba(200,220,255,0.30)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(gp.x, gp.y);
      ctx.lineTo(bp.x, bp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Character body ────────────────────────────────────────────────────
    // Lean slightly in movement direction for momentum feel
    const tiltX = this._vx * 1.2;
    const tiltY = this._vy * 0.6;

    ctx.save();
    ctx.translate(bp.x + tiltX, bp.y + tiltY);

    // Light-driven highlight direction (screen space, unit vector pointing
    // TOWARD the dominant light source). Combines directional lights (angle
    // is already a screen-space direction) and omni lights (vector from body
    // to light's screen projection), weighted by intensity. Falls back to the
    // classic upper-left bias when the scene provides no lights.
    let hdx = -0.5, hdy = -0.6; // fallback (normalized below)
    let totalW = 0, accX = 0, accY = 0;
    for (const dl of dc.dirLights ?? []) {
      // dl.direction points toward the light in world space; angle is the
      // screen-space source bearing, so (cos,sin) is the toward-light screen dir.
      const w = dl.intensity;
      accX += Math.cos(dl.angle) * w;
      accY += Math.sin(dl.angle) * w;
      totalW += w;
    }
    for (const ol of dc.omniLights ?? []) {
      if (ol.isGlobal) {continue;}
      // OmniLight.position.z is in SCREEN PIXELS (same as ShadowCaster's lz),
      // while toScreen expects world-unit z (multiplied by tileH). Convert so
      // an elevated peak-glow light aims the highlight upward on screen.
      const lp = toScreen(ol.position.x, ol.position.y, ol.position.z / tileH);
      const dx = lp.x - (bp.x + tiltX), dy = lp.y - (bp.y + tiltY);
      const m = Math.hypot(dx, dy);
      if (m < 1) {continue;}
      const w = ol.intensity;
      accX += (dx / m) * w;
      accY += (dy / m) * w;
      totalW += w;
    }
    if (totalW > 0) { hdx = accX / totalW; hdy = accY / totalW; }
    const hmag = Math.hypot(hdx, hdy) || 1;
    hdx /= hmag; hdy /= hmag;

    // Radial gradient sphere - lit center biased toward the light direction
    const grd = ctx.createRadialGradient(
      hdx * this.radius * 0.35, hdy * this.radius * 0.35, 1,
       0, 0, this.radius
    );
    grd.addColorStop(0, '#a0d0ff');
    grd.addColorStop(0.55, this.color);
    grd.addColorStop(1, '#0e2860');

    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Specular highlight - sits on the lit side, tracking the light source
    ctx.beginPath();
    ctx.arc(hdx * this.radius * 0.45, hdy * this.radius * 0.45, this.radius * 0.20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.50)';
    ctx.fill();

    ctx.restore();

    // ── HUD: terrain height label above character ─────────────────────────
    ctx.save();
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(200,230,255,0.75)';
    ctx.textAlign = 'center';
    ctx.fillText(`h ${groundZ.toFixed(2)}`, bp.x, bp.y - this.radius - 4);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}
