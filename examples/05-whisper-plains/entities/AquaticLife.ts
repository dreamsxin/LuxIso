/**
 * AquaticLife — 湖水场景的水生生物
 *
 * Fish      — 低多边形小鱼，成群游动
 * WaterLily — 升级版荷花，带花苞和开放状态
 */
import {IsoObject, DrawContext} from '../../../src/elements/IsoObject';
import {AABB} from '../../../src/math/depthSort';
import {project} from '../../../src/math/IsoProjection';

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

// ── 小鱼（鱼群） ──────────────────────────────────────────────────────────

interface FishUnit {
  x: number; y: number; z: number;
  vx: number; vy: number;
  phase: number;
  size: number;
}

export class FishSchool extends IsoObject {
  private _fish: FishUnit[] = [];
  private _lastTs = 0;
  private _phase = 0;
  private _color: string;
  private _accentColor: string;
  private readonly _cols: number;
  private readonly _rows: number;
  // 鱼群中心目标
  private _targetX: number;
  private _targetY: number;
  private _targetTimer = 0;

  constructor(id: string, x: number, y: number, opts: {
    count?: number; color?: string; accentColor?: string;
    cols?: number; rows?: number; seed?: number;
  } = {}) {
    super(id, x, y, 0);
    const seed = opts.seed ?? Math.random();
    this._cols = opts.cols ?? 13;
    this._rows = opts.rows ?? 13;
    this._color = opts.color ?? '#f97316';
    this._accentColor = opts.accentColor ?? '#fbbf24';
    this._targetX = x; this._targetY = y;
    this.castsShadow = false;

    const count = opts.count ?? 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + seed;
      this._fish.push({
        x: x + Math.cos(a) * 0.4, y: y + Math.sin(a) * 0.4,
        z: 2 + seed * 3,
        vx: Math.cos(a + Math.PI / 2) * 0.8,
        vy: Math.sin(a + Math.PI / 2) * 0.8,
        phase: seed + i * 0.7,
        size: 0.7 + (i % 3) * 0.15,
      });
    }
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 1.5, minY: this.position.y - 1.5,
      maxX: this.position.x + 1.5, maxY: this.position.y + 1.5,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt;
    this._targetTimer -= dt;

    // 鱼群换目标
    if (this._targetTimer <= 0) {
      this._targetX = 1 + Math.random() * (this._cols - 2);
      this._targetY = 1 + Math.random() * (this._rows - 2);
      this._targetTimer = 3 + Math.random() * 4;
    }

    for (const f of this._fish) {
      f.phase += dt * 3;
      // 朝群体目标 + 随机扰动
      const dx = this._targetX - f.x + Math.sin(f.phase * 0.7) * 0.5;
      const dy = this._targetY - f.y + Math.cos(f.phase * 0.5) * 0.5;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = 1.2 + Math.sin(f.phase) * 0.3;
      f.vx += (dx / dist * speed - f.vx) * dt * 2;
      f.vy += (dy / dist * speed - f.vy) * dt * 2;
      f.x = clamp(f.x + f.vx * dt, 0.5, this._cols - 0.5);
      f.y = clamp(f.y + f.vy * dt, 0.5, this._rows - 0.5);
      f.z = 2 + Math.sin(f.phase * 0.8) * 1.5;
    }
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    for (const f of this._fish) {
      const {sx, sy} = project(f.x, f.y, f.z, tileW, tileH);
      const fx = originX + sx, fy = originY + sy;
      const angle = Math.atan2(f.vy, f.vx);
      const tailWag = Math.sin(f.phase) * 0.4;
      const s = f.size;

      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(angle);

      // 身体（低多边形，5顶点）
      const bl = 9 * s, bw = 4 * s;
      ctx.beginPath();
      ctx.moveTo(bl, 0);
      ctx.lineTo(bl * 0.3, -bw); ctx.lineTo(-bl * 0.5, -bw * 0.6);
      ctx.lineTo(-bl * 0.5, bw * 0.6); ctx.lineTo(bl * 0.3, bw);
      ctx.closePath();
      ctx.fillStyle = this._color; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.4; ctx.stroke();

      // 腹部高光
      ctx.beginPath();
      ctx.moveTo(bl * 0.6, 0);
      ctx.lineTo(bl * 0.2, -bw * 0.5); ctx.lineTo(-bl * 0.2, -bw * 0.3);
      ctx.lineTo(-bl * 0.2, bw * 0.3); ctx.lineTo(bl * 0.2, bw * 0.5);
      ctx.closePath(); ctx.fillStyle = this._accentColor; ctx.fill();

      // 尾鳍（摆动）
      ctx.save(); ctx.rotate(tailWag);
      ctx.beginPath();
      ctx.moveTo(-bl * 0.5, 0); ctx.lineTo(-bl, -bw * 0.8); ctx.lineTo(-bl * 0.8, 0); ctx.lineTo(-bl, bw * 0.8);
      ctx.closePath(); ctx.fillStyle = this._color; ctx.fill();
      ctx.restore();

      // 背鳍
      ctx.beginPath();
      ctx.moveTo(bl * 0.2, -bw); ctx.lineTo(0, -bw * 1.8); ctx.lineTo(-bl * 0.2, -bw);
      ctx.closePath(); ctx.fillStyle = this._accentColor; ctx.globalAlpha = 0.7; ctx.fill();
      ctx.globalAlpha = 1;

      // 眼睛
      ctx.beginPath(); ctx.arc(bl * 0.55, -bw * 0.3, bw * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = '#1a0a00'; ctx.fill();
      ctx.beginPath(); ctx.arc(bl * 0.57, -bw * 0.35, bw * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();

      ctx.restore();
    }
  }
}

// ── 荷花（开放 + 花苞两种状态） ───────────────────────────────────────────

export class WaterLilyFlower extends IsoObject {
  private _phase: number;
  private _lastTs = 0;
  private _openness: number; // 0=花苞 1=全开
  private _color: string;
  private _padColor: string;

  constructor(id: string, x: number, y: number, opts: {seed?: number; open?: number} = {}) {
    super(id, x, y, 3);
    const seed = opts.seed ?? Math.random();
    this._phase = seed * Math.PI * 2;
    this._openness = opts.open ?? (seed > 0.4 ? 1 : 0.3 + seed * 0.5);
    const colors: Array<[string, string]> = [
      ['#fce7f3', '#fbcfe8'], ['#fff7ed', '#fed7aa'],
      ['#f0fdf4', '#bbf7d0'], ['#eff6ff', '#bfdbfe'],
      ['#fdf4ff', '#e9d5ff'],
    ];
    [this._color, this._padColor] = colors[Math.floor(seed * colors.length)];
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.5, minY: this.position.y - 0.5,
      maxX: this.position.x + 0.5, maxY: this.position.y + 0.5,
      baseZ: 3,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.35;
    this.position.z = 3 + Math.sin(this._phase) * 1.2;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y, z} = this.position;
    const {sx, sy} = project(x, y, z, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const scaleY = tileH / tileW;

    ctx.save();
    ctx.translate(cx, cy);

    // 荷叶垫（椭圆，等距压扁）
    ctx.save();
    ctx.scale(1, scaleY);
    const padR = 11;
    ctx.beginPath();
    // 带缺口的荷叶
    ctx.moveTo(0, 0);
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 1.8 - Math.PI * 0.1;
      ctx.lineTo(Math.cos(a) * padR, Math.sin(a) * padR);
    }
    ctx.closePath();
    const padGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, padR);
    padGrad.addColorStop(0, '#4ade80'); padGrad.addColorStop(0.6, '#22c55e'); padGrad.addColorStop(1, '#16a34a');
    ctx.fillStyle = padGrad; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.6; ctx.stroke();
    // 叶脉
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 1.6 - Math.PI * 0.05;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * padR * 0.9, Math.sin(a) * padR * 0.9); ctx.stroke();
    }
    ctx.restore();

    // 花朵
    const open = this._openness;
    const petalCount = open > 0.6 ? 8 : 5;
    const petalLen = 5 + open * 5;
    const petalSpread = open * 0.6; // 0=直立 0.6=平展

    for (let i = 0; i < petalCount; i++) {
      const a = (i / petalCount) * Math.PI * 2 + this._phase * 0.05;
      const px = Math.cos(a) * (3 + open * 3);
      const py = Math.sin(a) * (3 + open * 3) * scaleY;
      const tipX = Math.cos(a) * (3 + petalLen);
      const tipY = Math.sin(a) * (3 + petalLen) * scaleY - petalLen * (1 - petalSpread);

      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(px - Math.sin(a) * 2, py - 2, tipX, tipY);
      ctx.quadraticCurveTo(px + Math.sin(a) * 2, py - 2, 0, -2);
      ctx.closePath();

      const pGrad = ctx.createLinearGradient(0, -2, tipX, tipY);
      pGrad.addColorStop(0, this._padColor); pGrad.addColorStop(1, this._color);
      ctx.fillStyle = pGrad; ctx.fill();
      ctx.strokeStyle = 'rgba(200,150,180,0.2)'; ctx.lineWidth = 0.3; ctx.stroke();
    }

    // 花心（黄色）
    ctx.beginPath(); ctx.arc(0, -2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, -2, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b'; ctx.fill();

    // 花粉光点
    for (let i = 0; i < 5; i++) {
      const a = this._phase * 2 + (i / 5) * Math.PI * 2;
      const pr = 2 + Math.sin(this._phase * 3 + i) * 0.5;
      ctx.beginPath(); ctx.arc(Math.cos(a) * pr, -2 + Math.sin(a) * pr * scaleY, 0.7, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,240,100,${0.6 + Math.sin(this._phase * 4 + i) * 0.3})`; ctx.fill();
    }

    ctx.restore();
  }
}
