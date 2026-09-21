/**
 * DesertPortal — 触碰石碑后出现的传送阵/宝箱机关
 *
 * 激活后：地面出现旋转金色符文圆圈，2秒后出现宝箱。
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {AABB} from '../../src/math/depthSort';
import {project} from '../../src/math/IsoProjection';

export class HiddenPortal extends IsoObject {
  isActivated = false;

  private _phase = 0;
  private _lastTs = 0;
  private _activationTime = 0;
  private _showChest = false;
  private _chestScale = 0;

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    this.visible = false;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 1.5, minY: this.position.y - 1.5,
      maxX: this.position.x + 1.5, maxY: this.position.y + 1.5,
      baseZ: 0,
    };
  }

  activate(): void {
    if (this.isActivated) {return;}
    this.isActivated = true;
    this.visible = true;
    this._activationTime = 0;
  }

  update(ts?: number): void {
    if (!this.isActivated) {return;}
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt;
    this._activationTime += dt;

    if (this._activationTime > 2 && !this._showChest) {
      this._showChest = true;
    }
    if (this._showChest && this._chestScale < 1) {
      this._chestScale = Math.min(1, this._chestScale + dt * 2);
    }
  }

  draw(dc: DrawContext): void {
    if (!this.isActivated) {return;}
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const scaleY = tileH / tileW;

    const pulse = 0.6 + Math.sin(this._phase * 2.5) * 0.2;

    ctx.save();
    ctx.translate(cx, cy);

    // 地面光晕
    ctx.save();
    ctx.scale(1, scaleY);
    const glowR = tileW * 1.4;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
    glow.addColorStop(0, `rgba(255,200,60,${pulse * 0.3})`);
    glow.addColorStop(0.5, `rgba(200,140,20,${pulse * 0.12})`);
    glow.addColorStop(1, 'rgba(160,100,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();

    // 旋转符文圆圈（3层）
    this._drawRuneRing(ctx, tileW * 0.9, scaleY, 8, this._phase * 0.4, `rgba(255,200,60,${pulse * 0.8})`, 1.5);
    this._drawRuneRing(ctx, tileW * 0.6, scaleY, 6, -this._phase * 0.6, `rgba(255,160,40,${pulse * 0.9})`, 1.2);
    this._drawRuneRing(ctx, tileW * 0.32, scaleY, 4, this._phase * 1.2, `rgba(255,220,80,${pulse})`, 1.0);

    // 中心光核
    ctx.save();
    ctx.scale(1, scaleY);
    const coreR = tileW * 0.12;
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
    cg.addColorStop(0, `rgba(255,255,200,${pulse})`);
    cg.addColorStop(0.5, `rgba(255,200,60,${pulse * 0.6})`);
    cg.addColorStop(1, 'rgba(200,140,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.restore();

    // 宝箱（激活2秒后弹出）
    if (this._showChest && this._chestScale > 0) {
      this._drawChest(ctx, tileW, tileH, this._chestScale);
    }

    ctx.restore();
  }

  private _drawRuneRing(
    ctx: CanvasRenderingContext2D,
    radius: number, scaleY: number, sides: number,
    rotation: number, stroke: string, lineWidth: number
  ): void {
    ctx.save();
    ctx.scale(1, scaleY);
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + rotation;
      const px = Math.cos(a) * radius, py = Math.sin(a) * radius;
      if (i === 0) {ctx.moveTo(px, py);} else {ctx.lineTo(px, py);}
    }
    ctx.closePath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // 顶点光点
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + rotation;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * radius, Math.sin(a) * radius, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.fill();
    }
    ctx.restore();
  }

  private _drawChest(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, scale: number): void {
    const w = tileW * 0.22 * scale;
    const h = tileH * 0.5 * scale;
    const bounce = Math.sin(this._phase * 4) * 3 * scale;

    ctx.save();
    ctx.translate(0, -h - bounce);

    // 箱体
    ctx.beginPath();
    ctx.rect(-w, -h * 0.6, w * 2, h * 0.6);
    ctx.fillStyle = '#8a5a20';
    ctx.fill();

    // 箱盖
    ctx.beginPath();
    ctx.rect(-w, -h, w * 2, h * 0.45);
    ctx.fillStyle = '#a06828';
    ctx.fill();

    // 金色锁扣
    ctx.beginPath();
    ctx.arc(0, -h * 0.6, w * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd040';
    ctx.fill();

    // 金色光晕
    const glowR = w * 2;
    const glow = ctx.createRadialGradient(0, -h * 0.5, 0, 0, -h * 0.5, glowR);
    glow.addColorStop(0, `rgba(255,200,60,${0.4 * scale})`);
    glow.addColorStop(1, 'rgba(255,160,0,0)');
    ctx.beginPath();
    ctx.arc(0, -h * 0.5, glowR, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.restore();
  }
}
