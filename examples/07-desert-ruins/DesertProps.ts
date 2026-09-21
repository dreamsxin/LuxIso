/**
 * DesertProps — 金字塔、仙人掌、破碎石柱、石碑
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {AABB} from '../../src/math/depthSort';
import {project, drawIsoCube} from '../../src/math/IsoProjection';
import {shiftColor} from '../../src/math/color';

// shiftHex → use framework shiftColor
const shiftHex = shiftColor;

// ── 金字塔 ────────────────────────────────────────────────────────────────────

export class Pyramid extends IsoObject {
  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    this.castsShadow = true;
    this.shadowRadius = 2.5;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 1, minY: this.position.y - 1,
      maxX: this.position.x + 3, maxY: this.position.y + 3,
      baseZ: 0,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;

    // 5层，底层 2×2，每层缩小 0.35
    const layers = 5;
    const baseSize = 2.0;
    const shrink = 0.35;
    const layerH = 0.7;

    for (let i = 0; i < layers; i++) {
      const size = baseSize - i * shrink;
      const offset = i * shrink * 0.5;
      const zBase = i * layerH;
      const t = i / (layers - 1);
      const topR = Math.round(0xd4 + t * (0xf0 - 0xd4));
      const topG = Math.round(0xa8 + t * (0xc8 - 0xa8));
      const topB = Math.round(0x55 + t * (0x70 - 0x55));
      const topC = `rgb(${topR},${topG},${topB})`;
      const leftC = shiftHex(topC, -30);
      const rightC = shiftHex(topC, -15);
      drawIsoCube(ctx, originX, originY, tileW, tileH,
        x + offset, y + offset, zBase, size, size, layerH,
        topC, leftC, rightC);
    }
  }
}

// ── 仙人掌 ────────────────────────────────────────────────────────────────────

export class Cactus extends IsoObject {
  private _seed: number;

  constructor(id: string, x: number, y: number, seed = 0.5) {
    super(id, x, y, 0);
    this._seed = seed;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.3, minY: this.position.y - 0.3,
      maxX: this.position.x + 0.3, maxY: this.position.y + 0.3,
      baseZ: 0,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const h = (1.5 + this._seed * 0.8) * tileH;
    const w = tileW * 0.08;

    ctx.save();
    ctx.translate(cx, cy);

    // 主干
    const segs = 7;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const sway = Math.sin(i * 1.3 + this._seed * 5) * 1.5;
      ctx.beginPath();
      ctx.moveTo(-w + sway, -h * t0);
      ctx.lineTo(w + sway, -h * t0);
      ctx.lineTo(w * 0.8 + sway, -h * t1);
      ctx.lineTo(-w * 0.8 + sway, -h * t1);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? '#2d6a2d' : '#3d8a3d';
      ctx.fill();
    }

    // 左侧枝
    const armY = -h * 0.55;
    const armLen = tileW * 0.22;
    ctx.beginPath();
    ctx.moveTo(-w, armY);
    ctx.bezierCurveTo(-armLen * 0.5, armY + 4, -armLen, armY - 8, -armLen, armY - 16);
    ctx.lineWidth = w * 1.4;
    ctx.strokeStyle = '#2d6a2d';
    ctx.stroke();

    // 右侧枝
    ctx.beginPath();
    ctx.moveTo(w, armY - 8);
    ctx.bezierCurveTo(armLen * 0.5, armY - 4, armLen, armY - 18, armLen, armY - 26);
    ctx.lineWidth = w * 1.2;
    ctx.strokeStyle = '#3d8a3d';
    ctx.stroke();

    ctx.restore();
  }
}

// ── 破碎石柱 ──────────────────────────────────────────────────────────────────

export class BrokenPillar extends IsoObject {
  private _seed: number;
  private _topVerts: number[];

  constructor(id: string, x: number, y: number, seed = 0.3) {
    super(id, x, y, 0);
    this._seed = seed;
    // 预生成不规则顶部顶点偏移
    this._topVerts = Array.from({length: 6}, (_, i) =>
      Math.sin(seed * 17.3 + i * 2.7) * 4
    );
    this.castsShadow = true;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.4, minY: this.position.y - 0.4,
      maxX: this.position.x + 0.4, maxY: this.position.y + 0.4,
      baseZ: 0,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const pillarH = (1.2 + this._seed * 0.6) * tileH;
    const bw = tileW * 0.18;

    ctx.save();
    ctx.translate(cx, cy);

    // 底座
    ctx.beginPath();
    ctx.rect(-bw * 1.4, -6, bw * 2.8, 10);
    ctx.fillStyle = '#6a5a4a';
    ctx.fill();

    // 柱身
    ctx.beginPath();
    ctx.rect(-bw, -pillarH, bw * 2, pillarH);
    ctx.fillStyle = '#8a7a6a';
    ctx.fill();

    // 侧面阴影
    ctx.beginPath();
    ctx.rect(-bw, -pillarH, bw * 0.35, pillarH);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();

    // 不规则顶部
    const tv = this._topVerts;
    ctx.beginPath();
    ctx.moveTo(-bw + tv[0], -pillarH + tv[1]);
    ctx.lineTo(0 + tv[2], -pillarH - 8 + tv[3]);
    ctx.lineTo(bw + tv[4], -pillarH + tv[5]);
    ctx.lineTo(bw, -pillarH);
    ctx.lineTo(-bw, -pillarH);
    ctx.closePath();
    ctx.fillStyle = '#7a6a5a';
    ctx.fill();

    // 裂缝线条
    ctx.strokeStyle = 'rgba(40,30,20,0.5)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const cx2 = -bw + bw * 0.7 * i + this._seed * 5;
      ctx.beginPath();
      ctx.moveTo(cx2, -pillarH * 0.3);
      ctx.lineTo(cx2 + 3, -pillarH * 0.6);
      ctx.lineTo(cx2 - 2, -pillarH * 0.85);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ── 石碑（可交互） ────────────────────────────────────────────────────────────

export class StoneTablet extends IsoObject {
  isActivated = false;
  readonly triggerRadius = 1.5;

  private _phase = 0;
  private _lastTs = 0;
  private _seed: number;

  constructor(id: string, x: number, y: number, seed = 0.5) {
    super(id, x, y, 0);
    this._seed = seed;
    this.castsShadow = true;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.3, minY: this.position.y - 0.3,
      maxX: this.position.x + 0.3, maxY: this.position.y + 0.3,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const w = tileW * 0.14, h = tileH * 1.6;

    ctx.save();
    ctx.translate(cx, cy);

    // 石碑主体
    ctx.beginPath();
    ctx.rect(-w, -h, w * 2, h);
    ctx.fillStyle = this.isActivated ? '#6a5a8a' : '#7a6a5a';
    ctx.fill();

    // 顶部圆弧
    ctx.beginPath();
    ctx.arc(0, -h, w, Math.PI, 0);
    ctx.fillStyle = this.isActivated ? '#7a6a9a' : '#8a7a6a';
    ctx.fill();

    // 侧面阴影
    ctx.beginPath();
    ctx.rect(-w, -h, w * 0.3, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    // 符文图案
    const runeAlpha = this.isActivated
      ? 0.7 + Math.sin(this._phase * 3) * 0.3
      : 0.25 + Math.sin(this._phase * 1.5 + this._seed * 5) * 0.1;
    const runeColor = this.isActivated ? `rgba(200,160,255,${runeAlpha})` : `rgba(160,140,100,${runeAlpha})`;

    ctx.strokeStyle = runeColor;
    ctx.lineWidth = 0.8;

    // 旋转几何符文
    const rot = this._phase * (this.isActivated ? 0.8 : 0.2) + this._seed * Math.PI;
    const rr = w * 0.7;
    ctx.save();
    ctx.translate(0, -h * 0.55);
    ctx.rotate(rot);
    for (let tri = 0; tri < 2; tri++) {
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + tri * Math.PI / 3;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.5;
        if (i === 0) {ctx.moveTo(px, py);} else {ctx.lineTo(px, py);}
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // 激活光晕
    if (this.isActivated) {
      const glowR = w * 3;
      const glow = ctx.createRadialGradient(0, -h * 0.5, 0, 0, -h * 0.5, glowR);
      glow.addColorStop(0, `rgba(180,100,255,${0.3 + Math.sin(this._phase * 2) * 0.1})`);
      glow.addColorStop(1, 'rgba(120,60,200,0)');
      ctx.beginPath();
      ctx.arc(0, -h * 0.5, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    ctx.restore();
  }
}
