/**
 * LowPolyTree  — 低多边形树木（多面锥冠 + 等距树干，带明暗面）
 * LowPolyGrass — 细长草叶（贝塞尔曲线，颜色渐变，风吹）
 * LowPolyFlower— 低多边形花朵（茎 + 多瓣 + 花粉光点）
 * LowPolyRock  — 低多边形石块（草原装饰）
 */
import {IsoObject, DrawContext} from '../../../src/elements/IsoObject';
import {AABB} from '../../../src/math/depthSort';
import {project} from '../../../src/math/IsoProjection';

// ── 低多边形树 ─────────────────────────────────────────────────────────────

export class LowPolyTree extends IsoObject {
  private _color: string;
  private _scale: number;
  private _swayPhase: number;
  private _variant: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, opts: {
    color?: string; scale?: number; seed?: number; variant?: number;
  } = {}) {
    super(id, x, y, 0);
    this._color = opts.color ?? '#4a8c3f';
    this._scale = opts.scale ?? 1;
    this._swayPhase = (opts.seed ?? Math.random()) * Math.PI * 2;
    this._variant = opts.variant ?? Math.floor((opts.seed ?? Math.random()) * 3);
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.5,
      minY: this.position.y - 0.5,
      maxX: this.position.x + 0.5,
      maxY: this.position.y + 0.5,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._swayPhase += dt * 0.55; // ~0.55 rad/s，缓慢摇摆
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const s = this._scale;
    const sway = Math.sin(this._swayPhase) * 1.8;

    // 地面阴影（在 translate 之前，用原始屏幕坐标）
    this._drawShadow(ctx, cx, cy, s);

    ctx.save();
    ctx.translate(cx, cy);

    // 树干（等距双面）
    this._drawTrunk(ctx, s);

    // 树冠
    ctx.save();
    ctx.translate(sway * 0.4, 0);
    this._drawCrown(ctx, s);
    ctx.restore();

    ctx.restore();
  }

  private _drawShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
    // cx/cy 已经是相机变换后的坐标，再用 getTransform 转换到真实屏幕坐标
    const m = ctx.getTransform();
    const screenX = m.a * cx + m.c * cy + m.e;
    const screenY = m.b * cx + m.d * cy + m.f;
    const zoom = m.a || 1;
    const r = 15 * s * zoom;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(screenX, screenY);
    ctx.scale(1, 0.32);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    sg.addColorStop(0, 'rgba(0,0,0,0.25)');
    sg.addColorStop(0.6, 'rgba(0,0,0,0.1)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();
  }

  private _drawTrunk(ctx: CanvasRenderingContext2D, s: number): void {
    const tw = 4 * s;
    const th = 16 * s;
    const trunkBase = '#5a3418';
    const trunkLit = '#7a4a28';
    const trunkDark = '#3d2210';

    // 左面（暗）
    ctx.beginPath();
    ctx.moveTo(-tw, 0);
    ctx.lineTo(0, th * 0.18);
    ctx.lineTo(0, -th + th * 0.18);
    ctx.lineTo(-tw, -th);
    ctx.closePath();
    ctx.fillStyle = trunkDark;
    ctx.fill();

    // 正面（中）
    ctx.beginPath();
    ctx.moveTo(0, th * 0.18);
    ctx.lineTo(tw, 0);
    ctx.lineTo(tw, -th);
    ctx.lineTo(0, -th + th * 0.18);
    ctx.closePath();
    ctx.fillStyle = trunkBase;
    ctx.fill();

    // 顶面高光
    ctx.beginPath();
    ctx.moveTo(-tw, -th);
    ctx.lineTo(0, -th + th * 0.18);
    ctx.lineTo(tw, -th);
    ctx.lineTo(0, -th - th * 0.08);
    ctx.closePath();
    ctx.fillStyle = trunkLit;
    ctx.fill();
  }

  private _drawCrown(ctx: CanvasRenderingContext2D, s: number): void {
    const th = 16 * s; // 树干高度（用于定位树冠底部）

    const configs = [
      // variant 0: 三层圆润锥
      [
        {r: 20 * s, h: 20 * s, baseY: -th - 2 * s},
        {r: 15 * s, h: 18 * s, baseY: -th - 14 * s},
        {r: 10 * s, h: 16 * s, baseY: -th - 24 * s},
      ],
      // variant 1: 两层尖锥
      [
        {r: 18 * s, h: 26 * s, baseY: -th - 2 * s},
        {r: 11 * s, h: 22 * s, baseY: -th - 18 * s},
      ],
      // variant 2: 矮胖单层
      [
        {r: 24 * s, h: 16 * s, baseY: -th - 2 * s},
        {r: 16 * s, h: 12 * s, baseY: -th - 10 * s},
      ],
    ][this._variant] ?? [];

    for (const [li, layer] of configs.entries()) {
      const baseY = layer.baseY;
      const r = layer.r;
      const h = layer.h;
      const tipY = baseY - h;

      // 低多边形树冠：6个顶点围成底圈，投影到等距
      const SIDES = 6;
      const pts: Array<{x: number; y: number}> = [];
      for (let i = 0; i < SIDES; i++) {
        const a = (i / SIDES) * Math.PI * 2;
        pts.push({x: Math.cos(a) * r, y: baseY + Math.sin(a) * r * 0.45});
      }

      // 每个侧面三角形（底边顶点 → 顶点）
      const faceColors = this._getFaceColors(li);
      for (let i = 0; i < SIDES; i++) {
        const p0 = pts[i];
        const p1 = pts[(i + 1) % SIDES];
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(0, tipY);
        ctx.closePath();
        ctx.fillStyle = faceColors[i % faceColors.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      // 底面（可见部分）
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < SIDES; i++) {ctx.lineTo(pts[i].x, pts[i].y);}
      ctx.closePath();
      ctx.fillStyle = this._shiftColor(this._color, -20);
      ctx.fill();
    }
  }

  private _getFaceColors(layerIndex: number): string[] {
    const base = this._color;
    const light = this._shiftColor(base, 25 - layerIndex * 5);
    const mid = this._shiftColor(base, 8 - layerIndex * 5);
    const dark = this._shiftColor(base, -18 - layerIndex * 5);
    // 6面交替明暗，模拟方向光
    return [light, mid, dark, dark, mid, light];
  }

  private _shiftColor(hex: string, amount: number): string {
    const parse = (s: string) => parseInt(s, 16);
    let r: number, g: number, b: number;
    if (hex.startsWith('#')) {
      r = parse(hex.slice(1, 3));
      g = parse(hex.slice(3, 5));
      b = parse(hex.slice(5, 7));
    } else {
      // rgb(...) format
      const m = hex.match(/\d+/g) ?? ['0', '0', '0'];
      [r, g, b] = m.map(Number);
    }
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    return `rgb(${clamp(r + amount)},${clamp(g + amount)},${clamp(b + amount)})`;
  }
}

// ── 低多边形小草 ───────────────────────────────────────────────────────────

export class LowPolyGrass extends IsoObject {
  private _color: string;
  private _height: number;
  private _windPhase: number;
  private _bladeCount: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, opts: {
    color?: string; height?: number; seed?: number; blades?: number;
  } = {}) {
    super(id, x, y, 0);
    this._color = opts.color ?? '#5aaa40';
    this._height = opts.height ?? 12;
    this._windPhase = (opts.seed ?? Math.random()) * Math.PI * 2;
    this._bladeCount = opts.blades ?? 4;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.12,
      minY: this.position.y - 0.12,
      maxX: this.position.x + 0.12,
      maxY: this.position.y + 0.12,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._windPhase += dt * 1.2; // ~1.2 rad/s，自然风速
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const wind = Math.sin(this._windPhase) * 2.5;
    const h = this._height;

    ctx.save();
    ctx.translate(cx, cy);

    for (let i = 0; i < this._bladeCount; i++) {
      const ox = (i - this._bladeCount / 2 + 0.5) * 3.2;
      const phaseOff = i * 0.7;
      const bladeSway = wind + Math.sin(this._windPhase + phaseOff) * 0.8;
      const bladeH = h * (0.8 + (i % 3) * 0.12);

      // 贝塞尔曲线草叶（更自然的弯曲）
      const tipX = ox + bladeSway;
      const tipY = -bladeH;
      const ctrlX = ox + bladeSway * 0.6;
      const ctrlY = -bladeH * 0.55;

      // 草叶左边缘
      ctx.beginPath();
      ctx.moveTo(ox - 1.2, 0);
      ctx.quadraticCurveTo(ctrlX - 1, ctrlY, tipX, tipY);
      ctx.lineTo(tipX + 0.5, tipY);
      ctx.quadraticCurveTo(ctrlX + 1, ctrlY, ox + 1.2, 0);
      ctx.closePath();

      // 颜色渐变：根部深，尖端亮
      const grad = ctx.createLinearGradient(ox, 0, tipX, tipY);
      grad.addColorStop(0, this._shiftColor(this._color, -15));
      grad.addColorStop(0.5, this._color);
      grad.addColorStop(1, this._shiftColor(this._color, 30));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.restore();
  }

  private _shiftColor(hex: string, amount: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    return `rgb(${clamp(r + amount)},${clamp(g + amount)},${clamp(b + amount)})`;
  }
}

// ── 低多边形小花 ───────────────────────────────────────────────────────────

export class LowPolyFlower extends IsoObject {
  private _petalColor: string;
  private _stemColor: string;
  private _phase: number;
  private _petalCount: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, opts: {color?: string; seed?: number} = {}) {
    super(id, x, y, 0);
    const colors = ['#ff6b9d', '#ffb347', '#ff6b6b', '#ffd700', '#c084fc', '#67e8f9'];
    const idx = Math.floor((opts.seed ?? Math.random()) * colors.length) % colors.length;
    this._petalColor = opts.color ?? colors[idx];
    this._stemColor = '#4a7c35';
    this._phase = (opts.seed ?? Math.random()) * Math.PI * 2;
    this._petalCount = 5 + (idx % 2);
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.12,
      minY: this.position.y - 0.12,
      maxX: this.position.x + 0.12,
      maxY: this.position.y + 0.12,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 1.4; // 明显的摇曳速度
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const bob = Math.sin(this._phase) * 2.5; // 加大上下幅度
    const sway = Math.sin(this._phase * 0.7) * 2; // 左右摇摆
    const stemH = 10;

    ctx.save();
    ctx.translate(cx, cy);

    // 茎（细线，随风摇摆）
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(sway * 0.8, -stemH * 0.5, sway, -stemH + bob);
    ctx.strokeStyle = this._stemColor;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 花朵
    ctx.save();
    ctx.translate(sway, -stemH + bob);

    // 花瓣（低多边形菱形）
    const n = this._petalCount;
    const petalR = 5;
    const petalLen = 5.5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this._phase * 0.35;
      const px = Math.cos(a) * petalR;
      const py = Math.sin(a) * petalR * 0.55;
      const tx = Math.cos(a) * (petalR + petalLen);
      const ty = Math.sin(a) * (petalR + petalLen) * 0.55;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(px - Math.sin(a) * 2, py + Math.cos(a) * 1.2);
      ctx.lineTo(tx, ty);
      ctx.lineTo(px + Math.sin(a) * 2, py - Math.cos(a) * 1.2);
      ctx.closePath();

      // 花瓣渐变：中心亮，边缘深
      const grad = ctx.createLinearGradient(0, 0, tx, ty);
      grad.addColorStop(0, this._lighten(this._petalColor, 40));
      grad.addColorStop(1, this._petalColor);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.4;
      ctx.stroke();
    }

    // 花心（多层圆）
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff9c4';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();

    // 花粉光点
    for (let i = 0; i < 4; i++) {
      const pa = this._phase * 2 + (i / 4) * Math.PI * 2;
      const pr = 2.5 + Math.sin(this._phase * 3 + i) * 0.8;
      ctx.beginPath();
      ctx.arc(Math.cos(pa) * pr, Math.sin(pa) * pr * 0.6, 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,240,100,${0.6 + Math.sin(this._phase * 4 + i) * 0.3})`;
      ctx.fill();
    }

    ctx.restore();
    ctx.restore();
  }

  private _lighten(hex: string, amount: number): string {
    // 兼容 #rrggbb 和 rgb(...) 两种格式
    let r: number, g: number, b: number;
    if (hex && hex.startsWith('#') && hex.length >= 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      const m = hex?.match(/\d+/g) ?? ['200', '150', '200'];
      r = Number(m[0]); g = Number(m[1]); b = Number(m[2]);
    }
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    return `rgb(${clamp(r + amount)},${clamp(g + amount)},${clamp(b + amount)})`;
  }
}

// ── 低多边形石块（草原装饰） ───────────────────────────────────────────────

export class LowPolyRock extends IsoObject {
  private _color: string;
  private _size: number;
  private _seed: number;

  constructor(id: string, x: number, y: number, opts: {color?: string; size?: number; seed?: number} = {}) {
    super(id, x, y, 0);
    this._color = opts.color ?? '#8a8a9a';
    this._size = opts.size ?? 1;
    this._seed = opts.seed ?? Math.random();
    this.castsShadow = false;
  }

  get aabb(): AABB {
    const r = 0.25 * this._size;
    return {
      minX: this.position.x - r, minY: this.position.y - r,
      maxX: this.position.x + r, maxY: this.position.y + r,
      baseZ: 0,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const s = this._size;
    const seed = this._seed;

    ctx.save();
    ctx.translate(cx, cy);

    // 用 seed 生成固定的不规则多边形
    const VERTS = 5 + Math.floor(seed * 3);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < VERTS; i++) {
      const a = (i / VERTS) * Math.PI * 2 - Math.PI / 2;
      const r = (7 + Math.sin(seed * 13.7 + i * 2.3) * 3) * s;
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.5]);
    }

    // 主体
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < VERTS; i++) {ctx.lineTo(pts[i][0], pts[i][1]);}
    ctx.closePath();
    ctx.fillStyle = this._color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // 高光面（顶部三角）
    const topIdx = pts.reduce((best, p, i) => (p[1] < pts[best][1] ? i : best), 0);
    const p0 = pts[topIdx];
    const p1 = pts[(topIdx + 1) % VERTS];
    const p2 = pts[(topIdx - 1 + VERTS) % VERTS];
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();

    ctx.restore();
  }
}
