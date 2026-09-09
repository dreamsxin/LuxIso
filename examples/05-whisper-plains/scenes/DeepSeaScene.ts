/**
 * DeepSeaScene — 神秘深海
 *
 * 低多边形风格：
 * - 深海地面（暗蓝色调，带沙纹）
 * - 多形态海草（扇形、管状、丝带状）
 * - 珊瑚礁（低多边形锥体，发光）
 * - 气泡系统（持续上升）
 * - 发光水母（半透明伞形）
 * - 深海传送门（返回湖水）
 */
import { IsoObject, DrawContext } from '../../../src/elements/IsoObject';
import { AABB } from '../../../src/math/depthSort';
import { project } from '../../../src/math/IsoProjection';
import { Scene } from '../../../src/core/Scene';
import { TileCollider } from '../../../src/physics/TileCollider';
import { OmniLight } from '../../../src/lighting/OmniLight';
import { Floor } from '../../../src/elements/Floor';

export const DEEP_COLS = 14;
export const DEEP_ROWS = 14;
export const DEEP_PORTAL_X = 10;
export const DEEP_PORTAL_Y = 10;

/** Where main.ts lands the hero on entry; the collider keeps this tile clear. */
export const DEEP_SPAWN_X = 3.5;
export const DEEP_SPAWN_Y = 3.5;


// ── 气泡系统 ───────────────────────────────────────────────────────────────

export class BubbleSystem extends IsoObject {
  private _bubbles: Array<{
    x: number; y: number; z: number;
    r: number; speed: number; wobble: number; phase: number; alpha: number;
  }> = [];
  private _lastTs = 0;
  private _spawnTimer = 0;
  readonly cols: number;
  readonly rows: number;

  constructor(id: string, cols: number, rows: number) {
    super(id, 0, 0, 0);
    this.cols = cols;
    this.rows = rows;
    this.castsShadow = false;
    // 初始气泡
    for (let i = 0; i < 30; i++) this._spawnBubble(Math.random() * 80);
  }

  private _spawnBubble(startZ = 0): void {
    this._bubbles.push({
      x: 0.5 + Math.random() * (this.cols - 1),
      y: 0.5 + Math.random() * (this.rows - 1),
      z: startZ,
      r: 1.5 + Math.random() * 3.5,
      speed: 12 + Math.random() * 18,
      wobble: 0.3 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.3 + Math.random() * 0.4,
    });
  }

  get aabb(): AABB {
    return { minX: 0, minY: 0, maxX: this.cols, maxY: this.rows, baseZ: 0 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    for (const b of this._bubbles) {
      b.z += dt * b.speed;
      b.phase += dt * b.wobble * 2;
      b.x += Math.sin(b.phase) * dt * 0.15;
    }
    this._bubbles = this._bubbles.filter(b => b.z < 100);

    this._spawnTimer += dt;
    if (this._spawnTimer > 0.18) { this._spawnTimer = 0; this._spawnBubble(); }
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    for (const b of this._bubbles) {
      const { sx, sy } = project(b.x, b.y, b.z, tileW, tileH);
      const bx = originX + sx;
      const by = originY + sy;
      const fade = Math.min(1, (100 - b.z) / 20) * b.alpha;
      if (fade < 0.02) continue;

      ctx.save();
      // 气泡主体（半透明圆）
      ctx.beginPath();
      ctx.arc(bx, by, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(160,220,255,${(fade * 0.8).toFixed(2)})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // 气泡内部高光
      ctx.beginPath();
      ctx.arc(bx - b.r * 0.3, by - b.r * 0.3, b.r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,245,255,${(fade * 0.6).toFixed(2)})`;
      ctx.fill();
      ctx.restore();
    }
  }
}

// ── 深海水草（三种形态） ───────────────────────────────────────────────────

export class DeepSeaWeed extends IsoObject {
  private _phase: number;
  private _lastTs = 0;
  private _variant: number; // 0=扇形 1=管状 2=丝带
  private _color: string;
  private _height: number;

  constructor(id: string, x: number, y: number, opts: { seed?: number; variant?: number } = {}) {
    super(id, x, y, 0);
    const seed = opts.seed ?? Math.random();
    this._phase   = seed * Math.PI * 2;
    this._variant = opts.variant ?? Math.floor(seed * 3);
    this._height  = 18 + seed * 22;
    const colors  = ['#0d7a5a', '#0a6a8a', '#1a5a7a', '#0d8a6a', '#0a5a9a'];
    this._color   = colors[Math.floor(seed * colors.length)];
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return { minX: this.position.x - 0.2, minY: this.position.y - 0.2, maxX: this.position.x + 0.2, maxY: this.position.y + 0.2, baseZ: 0 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.7;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y } = this.position;
    const { sx, sy } = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    ctx.save();
    ctx.translate(cx, cy);
    if (this._variant === 0) this._drawFan(ctx);
    else if (this._variant === 1) this._drawTube(ctx);
    else this._drawRibbon(ctx);
    ctx.restore();
  }

  private _drawFan(ctx: CanvasRenderingContext2D): void {
    const sway = Math.sin(this._phase) * 4;
    const h = this._height;
    const SEGS = 5;
    for (let i = 0; i < SEGS; i++) {
      const t0 = i / SEGS, t1 = (i + 1) / SEGS;
      const y0 = -h * t0, y1 = -h * t1;
      const w0 = (1 - t0) * 8, w1 = (1 - t1) * 8;
      const ox = sway * t0;
      ctx.beginPath();
      ctx.moveTo(ox - w0, y0);
      ctx.lineTo(ox + w0, y0);
      ctx.lineTo(ox + sway * t1 - w1 + sway * 0.1, y1);
      ctx.lineTo(ox + sway * t1 + w1 + sway * 0.1, y1);
      ctx.closePath();
      const bright = i % 2 === 0;
      ctx.fillStyle = bright ? this._color : this._shiftColor(this._color, -15);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,180,200,0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    // 顶端发光点
    ctx.beginPath();
    ctx.arc(sway, -h, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80,220,200,${0.4 + Math.sin(this._phase * 2) * 0.2})`;
    ctx.fill();
  }

  private _drawTube(ctx: CanvasRenderingContext2D): void {
    const sway = Math.sin(this._phase) * 3;
    const h = this._height;
    const SEGS = 6;
    for (let i = 0; i < SEGS; i++) {
      const t = i / SEGS;
      const y0 = -h * t, y1 = -h * (t + 1 / SEGS);
      const ox = sway * t;
      const w = 3.5 - t * 1.5;
      ctx.beginPath();
      ctx.moveTo(ox - w, y0);
      ctx.lineTo(ox + w, y0);
      ctx.lineTo(ox + sway / SEGS - w * 0.8, y1);
      ctx.lineTo(ox + sway / SEGS + w * 0.8, y1);
      ctx.closePath();
      const lum = Math.floor(t * 40);
      ctx.fillStyle = this._shiftColor(this._color, lum);
      ctx.fill();
    }
    // 管口光晕
    ctx.beginPath();
    ctx.arc(sway, -h, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(100,240,220,${0.35 + Math.sin(this._phase * 1.5) * 0.2})`;
    ctx.fill();
  }

  private _drawRibbon(ctx: CanvasRenderingContext2D): void {
    const h = this._height;
    const SEGS = 8;
    for (let i = 0; i < SEGS; i++) {
      const t0 = i / SEGS, t1 = (i + 1) / SEGS;
      const wave0 = Math.sin(this._phase + t0 * Math.PI * 2) * 5;
      const wave1 = Math.sin(this._phase + t1 * Math.PI * 2) * 5;
      const y0 = -h * t0, y1 = -h * t1;
      ctx.beginPath();
      ctx.moveTo(wave0 - 2, y0);
      ctx.lineTo(wave0 + 2, y0);
      ctx.lineTo(wave1 + 2, y1);
      ctx.lineTo(wave1 - 2, y1);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? this._color : this._shiftColor(this._color, 20);
      ctx.fill();
    }
  }

  private _shiftColor(hex: string, amt: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const c = (v: number) => Math.max(0, Math.min(255, v + amt));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }
}

// ── 珊瑚礁 ────────────────────────────────────────────────────────────────

export class Coral extends IsoObject {
  private _phase: number;
  private _lastTs = 0;
  private _color: string;
  private _size: number;
  private _branches: Array<{ angle: number; len: number; width: number }>;

  constructor(id: string, x: number, y: number, opts: { seed?: number; color?: string } = {}) {
    super(id, x, y, 0);
    const seed = opts.seed ?? Math.random();
    this._phase  = seed * Math.PI * 2;
    this._size   = 0.7 + seed * 0.8;
    const colors = ['#ff6b6b', '#ff8c42', '#ff4da6', '#c084fc', '#f97316'];
    this._color  = opts.color ?? colors[Math.floor(seed * colors.length)];
    this.castsShadow = false;
    // 生成固定分支
    const n = 3 + Math.floor(seed * 4);
    this._branches = Array.from({ length: n }, (_, i) => ({
      angle:  (i / n) * Math.PI * 1.6 - Math.PI * 0.8 + (seed * 0.4 - 0.2),
      len:    (14 + seed * 12) * this._size,
      width:  (2.5 + seed * 1.5) * this._size,
    }));
  }

  get aabb(): AABB {
    const r = 0.4 * this._size;
    return { minX: this.position.x - r, minY: this.position.y - r, maxX: this.position.x + r, maxY: this.position.y + r, baseZ: 0 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.5;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y } = this.position;
    const { sx, sy } = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    ctx.save();
    ctx.translate(cx, cy);

    const sway = Math.sin(this._phase) * 1.5;

    for (const br of this._branches) {
      const tipX = Math.cos(br.angle) * br.len + sway;
      const tipY = -Math.abs(Math.sin(br.angle)) * br.len * 0.6 - br.len * 0.3;
      const SEGS = 4;
      for (let i = 0; i < SEGS; i++) {
        const t0 = i / SEGS, t1 = (i + 1) / SEGS;
        const x0 = tipX * t0, y0 = tipY * t0;
        const x1 = tipX * t1, y1 = tipY * t1;
        const w = br.width * (1 - t0 * 0.6);
        const nx = -(y1 - y0), ny = (x1 - x0);
        const nl = Math.hypot(nx, ny) || 1;
        ctx.beginPath();
        ctx.moveTo(x0 - nx / nl * w, y0 - ny / nl * w);
        ctx.lineTo(x0 + nx / nl * w, y0 + ny / nl * w);
        ctx.lineTo(x1 + nx / nl * w * 0.7, y1 + ny / nl * w * 0.7);
        ctx.lineTo(x1 - nx / nl * w * 0.7, y1 - ny / nl * w * 0.7);
        ctx.closePath();
        ctx.fillStyle = i % 2 === 0 ? this._color : this._lighten(this._color, 25);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }
      // 枝端发光点
      const glowA = 0.5 + Math.sin(this._phase * 2 + br.angle) * 0.3;
      ctx.beginPath();
      ctx.arc(tipX, tipY, br.width * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,220,180,${glowA.toFixed(2)})`;
      ctx.fill();
    }

    // 底座
    ctx.beginPath();
    ctx.ellipse(0, 0, 6 * this._size, 3 * this._size, 0, 0, Math.PI * 2);
    ctx.fillStyle = this._darken(this._color, 30);
    ctx.fill();

    ctx.restore();
  }

  private _lighten(hex: string, amt: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const c = (v: number) => Math.max(0, Math.min(255, v + amt));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }
  private _darken(hex: string, amt: number): string { return this._lighten(hex, -amt); }
}

// ── 发光水母 ───────────────────────────────────────────────────────────────

export class Jellyfish extends IsoObject {
  private _phase: number;
  private _lastTs = 0;
  private _color: string;
  private _size: number;
  private _driftX: number;
  private _driftY: number;

  constructor(id: string, x: number, y: number, opts: { seed?: number } = {}) {
    super(id, x, y, 20 + Math.random() * 30);
    const seed = opts.seed ?? Math.random();
    this._phase  = seed * Math.PI * 2;
    this._size   = 0.6 + seed * 0.7;
    const colors = ['#c084fc', '#818cf8', '#38bdf8', '#34d399', '#f472b6'];
    this._color  = colors[Math.floor(seed * colors.length)];
    this._driftX = (Math.random() - 0.5) * 0.04;
    this._driftY = (Math.random() - 0.5) * 0.04;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return { minX: this.position.x - 0.5, minY: this.position.y - 0.5, maxX: this.position.x + 0.5, maxY: this.position.y + 0.5, baseZ: this.position.z };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.9;
    // 缓慢漂移 + 上下浮动
    this.position.x = Math.max(1, Math.min(DEEP_COLS - 1, this.position.x + this._driftX * Math.sin(this._phase * 0.3)));
    this.position.y = Math.max(1, Math.min(DEEP_ROWS - 1, this.position.y + this._driftY * Math.cos(this._phase * 0.25)));
    this.position.z = (20 + Math.sin(this._phase * 0.7) * 12) * this._size;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y, z } = this.position;
    const { sx, sy } = project(x, y, z, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const s = this._size;
    const pulse = 0.85 + Math.sin(this._phase * 2) * 0.15;

    ctx.save();
    ctx.translate(cx, cy);

    // 伞体（低多边形半圆，8段）
    const R = 14 * s * pulse;
    const SIDES = 8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * Math.PI;
      ctx.lineTo(Math.cos(a) * R, -Math.sin(a) * R * 0.55);
    }
    ctx.closePath();
    // 半透明渐变填充
    const grad = ctx.createRadialGradient(0, -R * 0.2, 0, 0, -R * 0.2, R);
    grad.addColorStop(0,   this._rgba(this._color, 0.55));
    grad.addColorStop(0.6, this._rgba(this._color, 0.25));
    grad.addColorStop(1,   this._rgba(this._color, 0.05));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = this._rgba(this._color, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 伞体内部低多边形分割线
    ctx.strokeStyle = this._rgba(this._color, 0.3);
    ctx.lineWidth = 0.5;
    for (let i = 1; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * R, -Math.sin(a) * R * 0.55);
      ctx.stroke();
    }

    // 触须（6条，随波浪摆动）
    const tentacleCount = 6;
    for (let i = 0; i < tentacleCount; i++) {
      const tx = (i / (tentacleCount - 1) - 0.5) * R * 1.6;
      const wave = Math.sin(this._phase * 1.5 + i * 0.8) * 5;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.bezierCurveTo(tx + wave, 8 * s, tx - wave, 16 * s, tx + wave * 0.5, 24 * s);
      ctx.strokeStyle = this._rgba(this._color, 0.4 + Math.sin(this._phase + i) * 0.15);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 顶部发光核心
    ctx.beginPath();
    ctx.arc(0, -R * 0.3, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${(0.4 + Math.sin(this._phase * 3) * 0.2).toFixed(2)})`;
    ctx.fill();

    ctx.restore();
  }

  private _rgba(hex: string, a: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${a.toFixed(2)})`;
  }
}

// ── 深海传送门（返回湖水） ─────────────────────────────────────────────────

export class DeepPortal extends IsoObject {
  readonly triggerRadius = 1.8;
  private _phase = 0;
  private _lastTs = 0;
  private _pulse = 0;

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    this.castsShadow = false;
  }

  activate(): void { this._pulse = 1; }

  get aabb(): AABB {
    return { minX: this.position.x - 1.5, minY: this.position.y - 1.5, maxX: this.position.x + 1.5, maxY: this.position.y + 1.5, baseZ: 0 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt;
    if (this._pulse > 0) this._pulse = Math.max(0, this._pulse - dt * 1.5);
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y } = this.position;
    const { sx, sy } = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const scaleY = tileH / tileW;
    const alpha = 0.6 + Math.sin(this._phase * 1.8) * 0.2 + this._pulse * 0.4;

    ctx.save();
    ctx.translate(cx, cy);

    // 地面光晕（青绿色，深海风格）
    ctx.save();
    ctx.scale(1, scaleY);
    const outerR = tileW * 1.4;
    const og = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR);
    og.addColorStop(0,   `rgba(0,200,180,${(alpha * 0.3).toFixed(2)})`);
    og.addColorStop(0.5, `rgba(0,150,180,${(alpha * 0.12).toFixed(2)})`);
    og.addColorStop(1,   'rgba(0,100,150,0)');
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fillStyle = og;
    ctx.fill();
    ctx.restore();

    // 旋转六边形环
    for (let ring = 0; ring < 3; ring++) {
      const r = tileW * (0.35 + ring * 0.32);
      const rot = this._phase * (ring % 2 === 0 ? 0.3 : -0.4) + ring * Math.PI / 3;
      ctx.save();
      ctx.scale(1, scaleY);
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rot;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(0,220,200,${(alpha * (0.8 - ring * 0.2)).toFixed(2)})`;
      ctx.lineWidth = 1.5 - ring * 0.3;
      ctx.stroke();
      ctx.restore();
    }

    // 中心光核
    ctx.save();
    ctx.scale(1, scaleY);
    const coreR = tileW * 0.12;
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
    cg.addColorStop(0,   `rgba(200,255,250,${alpha.toFixed(2)})`);
    cg.addColorStop(0.5, `rgba(0,220,200,${(alpha * 0.7).toFixed(2)})`);
    cg.addColorStop(1,   'rgba(0,180,160,0)');
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.restore();

    // 上升光柱（细，青绿）
    const beamH = 60 + Math.sin(this._phase * 2) * 10;
    const beamGrad = ctx.createLinearGradient(0, 0, 0, -beamH);
    beamGrad.addColorStop(0,   `rgba(0,220,200,${(alpha * 0.6).toFixed(2)})`);
    beamGrad.addColorStop(0.5, `rgba(0,180,160,${(alpha * 0.25).toFixed(2)})`);
    beamGrad.addColorStop(1,   'rgba(0,150,140,0)');
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(4, 0);
    ctx.lineTo(2, -beamH); ctx.lineTo(-2, -beamH);
    ctx.closePath();
    ctx.fillStyle = beamGrad;
    ctx.fill();

    // 符文点（8个旋转点）
    const dotR = tileW * 0.55;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this._phase * 0.5;
      ctx.save();
      ctx.scale(1, scaleY);
      const px = Math.cos(a) * dotR;
      const py = Math.sin(a) * dotR;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,255,230,${(alpha * 0.8).toFixed(2)})`;
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }
}

// ── 构建深海场景 ───────────────────────────────────────────────────────────

export function buildDeepSeaScene(): { scene: Scene; portal: DeepPortal; bubbles: BubbleSystem; collider: TileCollider } {
  const scene = new Scene({ tileW: 64, tileH: 32, cols: DEEP_COLS, rows: DEEP_ROWS });
  scene.ambientColor     = '#001830';
  scene.ambientIntensity = 0.18;

  // ── 碰撞地图 ──────────────────────────────────────────────────────────────
  // 珊瑚是实体障碍；海草与水母是软性/漂浮装饰，保持可走。
  const collider = new TileCollider(DEEP_COLS, DEEP_ROWS);
  scene.collider = collider;


  // 深海地面（深蓝黑色）
  scene.addObject(new Floor({ id: 'seafloor', cols: DEEP_COLS, rows: DEEP_ROWS, color: '#0a1a2e', altColor: '#0d2040' }));

  // 光源：深海幽光（多个低强度点光源）
  scene.addLight(new OmniLight({ id: 'sea-center', x: DEEP_COLS / 2, y: DEEP_ROWS / 2, z: 60, color: '#00c8b4', intensity: 0.45, radius: 500 }));
  scene.addLight(new OmniLight({ id: 'sea-portal', x: DEEP_PORTAL_X, y: DEEP_PORTAL_Y, z: 40, color: '#00e0c8', intensity: 0.6, radius: 320 }));
  scene.addLight(new OmniLight({ id: 'sea-glow1',  x: 3, y: 4,  z: 30, color: '#c084fc', intensity: 0.3, radius: 200 }));
  scene.addLight(new OmniLight({ id: 'sea-glow2',  x: 11, y: 3, z: 30, color: '#f472b6', intensity: 0.25, radius: 180 }));
  scene.addLight(new OmniLight({ id: 'sea-glow3',  x: 5, y: 11, z: 30, color: '#38bdf8', intensity: 0.28, radius: 200 }));

  // 气泡系统
  const bubbles = new BubbleSystem('bubbles', DEEP_COLS, DEEP_ROWS);
  scene.addObject(bubbles);

  // 深海水草（密集分布）
  const weedPositions: Array<[number, number, number, number]> = [
    [1.5, 2.5, 0, 0], [2.5, 1.5, 0.3, 1], [4.0, 3.0, 0.6, 2],
    [1.0, 5.5, 0.9, 0], [3.5, 6.0, 0.15, 1], [6.0, 2.0, 0.45, 2],
    [7.5, 4.5, 0.75, 0], [5.5, 7.5, 0.05, 1], [8.5, 1.5, 0.35, 2],
    [2.0, 9.0, 0.65, 0], [4.5, 10.5, 0.85, 1], [9.5, 6.5, 0.25, 2],
    [11.5, 2.5, 0.55, 0], [12.5, 5.5, 0.7, 1], [10.5, 9.5, 0.4, 2],
    [1.5, 12.5, 0.9, 0], [6.5, 12.0, 0.2, 1], [12.0, 11.5, 0.8, 2],
    [8.0, 11.0, 0.1, 0], [3.0, 11.5, 0.5, 1],
  ];
  for (const [i, [wx, wy, seed, variant]] of weedPositions.entries()) {
    scene.addObject(new DeepSeaWeed(`weed-${i}`, wx, wy, { seed, variant }));
  }

  // 珊瑚礁
  const coralPositions: Array<[number, number, number, string?]> = [
    [2.5, 3.5, 0.2], [5.5, 2.5, 0.5, '#ff6b6b'], [8.5, 3.5, 0.8],
    [1.5, 7.5, 0.3, '#c084fc'], [4.5, 8.5, 0.6], [7.5, 7.5, 0.1, '#f97316'],
    [11.5, 4.5, 0.4], [12.5, 8.5, 0.7, '#ff4da6'], [9.5, 11.5, 0.9],
    [3.5, 12.5, 0.15, '#ff6b6b'], [6.5, 11.5, 0.55],
  ];
  for (const [i, [cx, cy, seed, color]] of coralPositions.entries()) {
    scene.addObject(new Coral(`coral-${i}`, cx as number, cy as number, { seed: seed as number, color }));
    collider.setWalkable(Math.floor(cx as number), Math.floor(cy as number), false);
  }


  // 水母（漂浮在不同高度）
  const jellyfishPositions: Array<[number, number, number]> = [
    [3.5, 4.5, 0.1], [7.5, 3.5, 0.4], [5.5, 6.5, 0.7],
    [10.5, 5.5, 0.2], [2.5, 8.5, 0.6], [8.5, 9.5, 0.9],
    [11.5, 10.5, 0.35], [4.5, 11.5, 0.75],
  ];
  for (const [i, [jx, jy, seed]] of jellyfishPositions.entries()) {
    scene.addObject(new Jellyfish(`jelly-${i}`, jx, jy, { seed }));
  }

  // 深海传送门
  const portal = new DeepPortal('deep-portal', DEEP_PORTAL_X, DEEP_PORTAL_Y);
  scene.addObject(portal);

  // 出生点与传送门格必须可走，否则角色会被 resolveMove 卡死在障碍里。
  collider.setWalkable(Math.floor(DEEP_SPAWN_X), Math.floor(DEEP_SPAWN_Y), true);
  collider.setWalkable(DEEP_PORTAL_X, DEEP_PORTAL_Y, true);

  return { scene, portal, bubbles, collider };
}
