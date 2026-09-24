/**
 * SeabedDecor — 湖底装饰
 *
 * SeabedRock  — 低多边形石头（扁平，深色）
 * SeabedWeed  — 水草（细长三棱锥，随水流摆动）
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {AABB} from '../../src/math/depthSort';
import {project} from '../../src/math/IsoProjection';
import {shiftColor} from '../../src/math/color';

// ── 湖底石头 ───────────────────────────────────────────────────────────────

export class SeabedRock extends IsoObject {
  private _size: number;
  private _seed: number;
  private _color: string;

  constructor(id: string, x: number, y: number, opts: {size?: number; seed?: number; color?: string} = {}) {
    super(id, x, y, 0);
    this._size = opts.size ?? 0.4;
    this._seed = opts.seed ?? Math.random();
    this._color = opts.color ?? '#1a2a3a';
    this.castsShadow = false;
  }

  get aabb(): AABB {
    const r = this._size * 0.5;
    return {
      minX: this.position.x - r, minY: this.position.y - r,
      maxX: this.position.x + r, maxY: this.position.y + r,
      baseZ: -6,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, -4, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const s = this._size;
    const seed = this._seed;

    ctx.save();
    ctx.translate(cx, cy);

    const VERTS = 5 + Math.floor(seed * 3);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < VERTS; i++) {
      const a = (i / VERTS) * Math.PI * 2 - Math.PI / 2;
      const r = (tileW * s * 0.4) * (0.7 + Math.sin(seed * 13.7 + i * 2.3) * 0.3);
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.45]);
    }

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < VERTS; i++) {ctx.lineTo(pts[i][0], pts[i][1]);}
    ctx.closePath();
    ctx.fillStyle = this._color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,100,140,0.3)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 顶部高光
    const topIdx = pts.reduce((b, p, i) => (p[1] < pts[b][1] ? i : b), 0);
    const p0 = pts[topIdx], p1 = pts[(topIdx + 1) % VERTS], p2 = pts[(topIdx - 1 + VERTS) % VERTS];
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,140,200,0.15)';
    ctx.fill();

    ctx.restore();
  }
}

// ── 水草（三棱锥） ─────────────────────────────────────────────────────────

export class SeabedWeed extends IsoObject {
  private _height: number;
  private _color: string;
  private _phase: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, opts: {height?: number; color?: string; seed?: number} = {}) {
    super(id, x, y, 0);
    const seed = opts.seed ?? Math.random();
    this._height = opts.height ?? (0.6 + seed * 0.8);
    this._color = opts.color ?? '#0d4a38';
    this._phase = seed * Math.PI * 2;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.1, minY: this.position.y - 0.1,
      maxX: this.position.x + 0.1, maxY: this.position.y + 0.1,
      baseZ: -6,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.8;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const sway = Math.sin(this._phase) * 3;
    const h = this._height * tileH * 0.8;

    // 底部（z=-4），顶部（z=-4+height）
    const base = project(x, y, -4, tileW, tileH);
    const tip = project(x, y, -4 + this._height, tileW, tileH);
    const bx = originX + base.sx, by = originY + base.sy;
    const tx = originX + tip.sx + sway, ty = originY + tip.sy;

    // 三棱锥：3个侧面，底部宽度随高度缩小
    const w = tileW * 0.04;
    ctx.save();

    // 左侧面
    ctx.beginPath();
    ctx.moveTo(bx - w, by); ctx.lineTo(bx, by - h * 0.15);
    ctx.lineTo(tx, ty); ctx.closePath();
    ctx.fillStyle = this._shiftColor(this._color, -10);
    ctx.fill();

    // 右侧面
    ctx.beginPath();
    ctx.moveTo(bx + w, by); ctx.lineTo(bx, by - h * 0.15);
    ctx.lineTo(tx, ty); ctx.closePath();
    ctx.fillStyle = this._color;
    ctx.fill();

    // 正面
    ctx.beginPath();
    ctx.moveTo(bx - w, by); ctx.lineTo(bx + w, by);
    ctx.lineTo(tx, ty); ctx.closePath();
    ctx.fillStyle = this._shiftColor(this._color, 15);
    ctx.fill();

    // 顶端发光点
    ctx.beginPath();
    ctx.arc(tx, ty, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(80,200,160,${0.4 + Math.sin(this._phase * 2) * 0.2})`;
    ctx.fill();

    ctx.restore();
  }

  private _shiftColor(hex: string, amt: number): string {
    return shiftColor(hex, amt);
  }
}
