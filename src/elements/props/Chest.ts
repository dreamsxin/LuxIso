import { project } from '../../math/IsoProjection';
import { AABB } from '../../math/depthSort';
import { DrawContext } from '../IsoObject';
import { Entity } from '../../ecs/Entity';
import { HealthComponent } from '../../ecs/components/HealthComponent';
import { shiftColor, blendColor } from '../../math/color';

// Local aliases matching the old private names used throughout this file
const shift = shiftColor;
const blend = blendColor;

/**
 * Isometric treasure chest — geometry derived directly from project().
 *
 * Coordinate system (from IsoProjection.ts):
 *   sx = (x - y) * tileW/2
 *   sy = (x + y) * tileH/2 - z
 *
 * Camera looks from upper-right toward lower-left.
 * For a tile at world (cx, cy), the four ground diamond corners are:
 *   North = project(cx,   cy,   0)  → screen top      (back)
 *   East  = project(cx+s, cy,   0)  → screen right     (x-axis)
 *   South = project(cx+s, cy+s, 0)  → screen bottom   (front)
 *   West  = project(cx,   cy+s, 0)  → screen left      (y-axis)
 *
 * Visible faces from camera:
 *   Left  face : West  → South  (faces -x / left-forward)
 *   Right face : South → East   (faces -y / right-forward)
 *   Lid top    : North → East → South → West (flat diamond on top)
 *
 * Lid hinge = back edge = North–West line (top of left face, top of right face back).
 * Lid opens by rotating the South–East front edge upward around the North–West hinge.
 */
export class Chest extends Entity {
  private _woodColor: string;
  private _lidOpen   = false;
  private _lidAngle  = 0;    // 0 = closed → 1 = fully open
  private _glowPulse = 0;
  private _lastTs: number | null = null;


  constructor(id: string, x: number, y: number, color = '#a05c18') {
    super(id, x, y, 0);
    this._woodColor = color;
    // Chest is roughly rectangular; use a slightly smaller shadow radius
    this.shadowRadius = 0.32;
    this.castsShadow  = true;
  }

  get propColor(): string { return this._woodColor; }

  open():   void { this._lidOpen = true;  }
  close():  void { this._lidOpen = false; }
  toggle(): void { this._lidOpen = !this._lidOpen; }
  get isOpen(): boolean { return this._lidOpen; }

  /** Lid animation progress, 0 = closed → 1 = fully open. */
  get lidAngle(): number { return this._lidAngle; }

  /**
   * Lid smoothing per frame **at 60 FPS**, 0–1. Higher snaps faster.
   *
   * `update()` converts this to a frame-rate-independent factor the same way
   * `Camera.lerpFactor` does, so the lid takes the same wall-clock time to open
   * on a 144 Hz display as on a 60 Hz one.
   */
  lidLerpFactor = 0.10;


  get aabb(): AABB {
    // Chest body is ~tileH*1.1 px tall + lid ~tileH*0.5 px. The constructor
    // does not receive tileH, so approximate with the standard tileH=32:
    // (32*1.1 + 32*0.5) = 51.2 px, and AABB Z is in pixels. This is only used
    // for depth sorting; the draw path computes the real pixel height from tileH.
    const approxHeightPx = 32 * 1.1 + 32 * 0.5;
    return {
      minX: this.position.x - 0.4,
      minY: this.position.y - 0.4,
      maxX: this.position.x + 0.4,
      maxY: this.position.y + 0.4,
      baseZ: 0,
      maxZ: approxHeightPx,
    };
  }

  update(ts?: number): void {
    super.update(ts);

    // Frame-rate-independent lid animation. The old `+= (target - angle) * 0.10`
    // applied a fixed fraction per frame, so the lid opened 2.4x faster on a
    // 144 Hz display than at 60 Hz even though `ts` was already being passed in
    // (it was only used for the glow pulse).
    const dt = this._frameDelta(ts);
    const f = Math.max(0, Math.min(1, this.lidLerpFactor));
    const t = f >= 1 ? 1 : 1 - Math.pow(1 - f, dt * 60);
    const target = this._lidOpen ? 1 : 0;
    this._lidAngle += (target - this._lidAngle) * t;
    if (this._lidOpen) this._glowPulse = (ts ?? 0) * 0.003;
  }

  /**
   * Seconds since the previous update, clamped so a stalled tab cannot slam the
   * lid open in one step. Returns 0 for the first call — a `null` sentinel
   * rather than 0, which would collide with a legitimate timestamp of 0.
   */
  private _frameDelta(ts?: number): number {
    if (ts === undefined) return 1 / 60;
    const previous = this._lastTs;
    this._lastTs = ts;
    if (previous === null) return 0;
    return Math.min(Math.max(0, (ts - previous) / 1000), 0.1);
  }


  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY, omniLights } = dc;
    const { x, y } = this.position;

    // ── Chest footprint in world space ────────────────────────────────────
    // The chest occupies a sub-tile diamond scaled by `s` around centre (x, y).
    // We offset the four world corners so the diamond is centred on (x, y):
    //   North = (x - hs, y - hs)
    //   East  = (x + hs, y - hs)
    //   South = (x + hs, y + hs)
    //   West  = (x - hs, y + hs)
    // where hs = half-size in world units.
    const hs = 0.38;   // half-size: chest is 0.76 tiles wide

    // Project all four ground corners
    const toScreen = (wx: number, wy: number, wz = 0): P => {
      const p = project(wx, wy, wz, tileW, tileH);
      return { x: originX + p.sx, y: originY + p.sy };
    };

    // Ground plane corners (z = 0)
    const gN = toScreen(x - hs, y - hs);   // North: back tip
    const gE = toScreen(x + hs, y - hs);   // East:  right tip
    const gS = toScreen(x + hs, y + hs);   // South: front tip
    const gW = toScreen(x - hs, y + hs);   // West:  left tip

    // ── Illumination ──────────────────────────────────────────────────────
    // Sample at chest centre
    const centre = toScreen(x, y);
    let illum = 0.22;
    for (const l of omniLights) {
      const lp = project(l.position.x, l.position.y, 0, tileW, tileH);
      illum += l.illuminateAt(centre.x, centre.y,
        originX + lp.sx, originY + lp.sy - l.position.z);
    }
    illum = Math.min(1, illum);

    // ── Body height ───────────────────────────────────────────────────────
    const bH  = tileH * 1.1;    // body height in screen pixels
    const lidH = tileH * 0.50;  // lid thickness

    // Top-of-body corners (lift ground corners by bH)
    const tN = lift(gN, bH);
    const tE = lift(gE, bH);
    const tS = lift(gS, bH);
    const tW = lift(gW, bH);

    // ── Colors ────────────────────────────────────────────────────────────
    const woodLeft  = blend(shift(this._woodColor, -22), illum * 0.78);
    const woodLid   = blend(shift(this._woodColor,  20), illum * 0.90);
    const metalDark = blend('#252525', illum * 0.85);
    const metalMid  = blend('#4a4a4a', illum * 0.90);
    const metalHi   = blend('#909090', illum);
    const goldBase  = blend('#c49010', illum);
    const goldHi    = blend('#ffe070', illum);

    ctx.save();

    // ── Left face: West(ground) → South(ground) → South(top) → West(top) ─
    // This face is on the left side of the chest as seen by the camera.
    fillQuad(ctx, gW, gS, tS, tW, woodLeft);
    drawPlankLines(ctx, gW, gS, tS, tW, metalDark, 3);

    // ── Right face: South(ground) → East(ground) → East(top) → South(top) ─
    fillQuad(ctx, gS, gE, tE, tS, blend(shift(this._woodColor, -40), illum * 0.62));
    drawPlankLines(ctx, gS, gE, tE, tS, metalDark, 3);

    // ── Metal bands on both visible faces ─────────────────────────────────
    for (const frac of [0.14, 0.66]) {
      const t0 = frac, t1 = frac + 0.11;

      // Left face band (West→South vertical strip)
      const la = lerpP(tW, gW, t0), lb = lerpP(tS, gS, t0);
      const lc = lerpP(tS, gS, t1), ld = lerpP(tW, gW, t1);
      fillQuad(ctx, la, lb, lc, ld, metalMid);
      ctx.beginPath(); ctx.moveTo(ld.x, ld.y); ctx.lineTo(lc.x, lc.y);
      ctx.strokeStyle = metalHi; ctx.lineWidth = 0.7; ctx.stroke();

      // Right face band
      const ra = lerpP(tS, gS, t0), rb = lerpP(tE, gE, t0);
      const rc = lerpP(tE, gE, t1), rd = lerpP(tS, gS, t1);
      fillQuad(ctx, ra, rb, rc, rd, metalDark);
    }

    // ── Corner rivets on left face ────────────────────────────────────────
    for (const [u, v] of [[0.1,0.1],[0.9,0.1],[0.1,0.9],[0.9,0.9]] as [number,number][]) {
      const rp = lerpP2(tW, tS, gW, gS, u, v);
      ctx.beginPath(); ctx.arc(rp.x, rp.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = metalHi; ctx.fill();
      ctx.beginPath(); ctx.arc(rp.x - 0.4, rp.y - 0.5, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
    }

    // ── Latch on left face centre ─────────────────────────────────────────
    const lc2 = lerpP2(tW, tS, gW, gS, 0.5, 0.5);
    ctx.beginPath();
    ctx.ellipse(lc2.x, lc2.y, 5.5, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = goldBase; ctx.fill();
    ctx.strokeStyle = blend('#7a5000', illum); ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(lc2.x, lc2.y - 0.5, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(lc2.x - 1, lc2.y + 0.8);
    ctx.lineTo(lc2.x + 1, lc2.y + 0.8);
    ctx.lineTo(lc2.x,     lc2.y + 2.8);
    ctx.closePath(); ctx.fillStyle = '#111'; ctx.fill();
    ctx.beginPath(); ctx.arc(lc2.x - 1.5, lc2.y - 1.5, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = goldHi; ctx.fill();

    // ── Lid ───────────────────────────────────────────────────────────────
    // Hinge = back edge of body top = North(top) → West(top)  [tN → tW]
    // When closed, lid is flat: tN → tE → tS → tW  (full diamond on top)
    // When open, the front edge tE–tS rotates upward around the tN–tW hinge.
    //
    // The front edge midpoint moves along an arc. In screen space:
    //   - "up" = -y direction (z increase)
    //   - "back" = toward North = screen-up-left
    //
    // openAng: 0 = flat, π*0.60 ≈ 108° = fully open
    const openAng = this._lidAngle * Math.PI * 0.60;
    const cosA = Math.cos(openAng);
    const sinA = Math.sin(openAng);

    // Each front corner rotates around its corresponding hinge corner.
    // tE rotates around tN, tS rotates around tW.
    const rotCorner = (corner: P, hinge: P): P => {
      const dx = corner.x - hinge.x;
      const dy = corner.y - hinge.y;
      const len = Math.hypot(dx, dy);
      const nx = dx / (len || 1);
      const ny = dy / (len || 1);
      return {
        x: hinge.x + nx * len * cosA,
        y: hinge.y + ny * len * cosA - len * sinA,
      };
    };

    const rE = rotCorner(tE, tN);   // East corner rotates around North hinge
    const rS = rotCorner(tS, tW);   // South corner rotates around West hinge

    // Lid top surface: tN → rE → rS → tW
    fillQuad(ctx, tN, rE, rS, tW, woodLid);
    drawPlankLines(ctx, tN, rE, rS, tW, metalDark, 2);

    // Lid front face (the underside edge, visible when open)
    if (sinA > 0.05) {
      const frontFaceDepth = lidH * 0.35 * sinA;
      // Direction perpendicular to the front edge, pointing "inward" (toward hinge)
      const edgeDx = rS.x - rE.x, edgeDy = rS.y - rE.y;
      const edgeLen = Math.hypot(edgeDx, edgeDy) || 1;
      // Perpendicular pointing toward hinge (rotate 90° and check sign)
      const perpX = -edgeDy / edgeLen;
      const perpY =  edgeDx / edgeLen;
      const fE2: P = { x: rE.x + perpX * frontFaceDepth, y: rE.y + perpY * frontFaceDepth };
      const fS2: P = { x: rS.x + perpX * frontFaceDepth, y: rS.y + perpY * frontFaceDepth };
      fillQuad(ctx, rE, rS, fS2, fE2, blend(shift(this._woodColor, 10), illum * 0.80));
    }

    // Lid front metal band
    ctx.beginPath();
    ctx.moveTo(rE.x, rE.y - 1.5); ctx.lineTo(rS.x, rS.y - 1.5);
    ctx.lineTo(rS.x, rS.y + 2.5); ctx.lineTo(rE.x, rE.y + 2.5);
    ctx.closePath();
    ctx.fillStyle = metalMid; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(rE.x, rE.y - 1.5); ctx.lineTo(rS.x, rS.y - 1.5);
    ctx.strokeStyle = metalHi; ctx.lineWidth = 0.8; ctx.stroke();

    // ── Inner glow when open ──────────────────────────────────────────────
    if (this._lidAngle > 0.04) {
      const gAlpha = this._lidAngle * 0.75;
      const pulse  = 0.85 + Math.sin(this._glowPulse) * 0.15;
      // Glow centre: inside the open chest
      const gx = (tN.x + tE.x + tS.x + tW.x) / 4;
      const gy = (tN.y + tE.y + tS.y + tW.y) / 4 - bH * 0.1;
      const gr = (tileW / 2) * 1.4 * pulse;

      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      glow.addColorStop(0,    `rgba(255,235,90,${(gAlpha * 0.95).toFixed(3)})`);
      glow.addColorStop(0.25, `rgba(255,180,20,${(gAlpha * 0.65).toFixed(3)})`);
      glow.addColorStop(0.6,  `rgba(200,90,0,${(gAlpha * 0.25).toFixed(3)})`);
      glow.addColorStop(1,    'rgba(0,0,0,0)');

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glow;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      ctx.restore();

      // Bright rim along the open body top edge (front two edges)
      ctx.save();
      ctx.globalAlpha = this._lidAngle * 0.55;
      ctx.strokeStyle = 'rgba(255,240,130,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(tW.x, tW.y); ctx.lineTo(tS.x, tS.y);
      ctx.moveTo(tS.x, tS.y); ctx.lineTo(tE.x, tE.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // ── Health bar ────────────────────────────────────────────────────────
    const topY = Math.min(tN.y, tE.y, tS.y, tW.y);
    this.drawHealthBar(ctx, centre.x, topY - lidH - 10);
  }

  private drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const hp = this.getComponent(HealthComponent);
    if (!hp || hp.isDead) return;
    const w = 34, h = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = hp.fraction > 0.5 ? '#50e080' : hp.fraction > 0.25 ? '#f0c040' : '#e04040';
    ctx.fillRect(x - w / 2, y, w * hp.fraction, h);
  }
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

interface P { x: number; y: number; }

function lift(p: P, h: number): P {
  return { x: p.x, y: p.y - h };
}

function lerpP(a: P, b: P, t: number): P {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function lerpP2(tl: P, tr: P, bl: P, br: P, u: number, v: number): P {
  return lerpP(lerpP(tl, tr, u), lerpP(bl, br, u), v);
}

function fillQuad(ctx: CanvasRenderingContext2D, a: P, b: P, c: P, d: P, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPlankLines(
  ctx: CanvasRenderingContext2D,
  a: P, b: P, c: P, d: P,
  color: string, count: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const p0 = lerpP(a, d, t);
    const p1 = lerpP(b, c, t);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
}

// color helpers removed — imported from src/math/color.ts
