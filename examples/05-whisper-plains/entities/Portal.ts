/**
 * Portal — 发光传送阵（精细版）
 *
 * - 地面符文：多层嵌套多边形 + 符文线条
 * - 蓝紫自发光，亮度周期脉动
 * - 上升光柱 + 扩散光晕环
 * - 旋转菱形粒子 + 上升光尘
 * - 激活时：亮度爆发 + 粒子加速 + 光环扩散
 */
import {Entity} from '../../../src/ecs/Entity';
import {DrawContext} from '../../../src/elements/IsoObject';
import {AABB} from '../../../src/math/depthSort';
import {project} from '../../../src/math/IsoProjection';

interface PortalParticle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  color: string;
  z: number;
  zSpeed: number;
  opacity: number;
}

export class Portal extends Entity {
  readonly triggerRadius = 2.0; // 与外圈八边形光圈范围匹配（tileW*1.05 ≈ 2.1 世界单位）

  private _phase = 0;
  private _activated = false;
  private _activationPulse = 0;
  private _lastTs = 0;
  private _particles: PortalParticle[] = [];
  private _shockwaves: Array<{r: number; alpha: number}> = [];
  // 大光柱
  private _beamAlpha = 0;
  private _beamTimer = 0;
  private _beamDuration = 1.4;

  /** 光柱实际屏幕高度（px），供 CubeHero.triggerDescend() 同步使用 */
  static readonly BEAM_HEIGHT_PX = 210; // beamH(420) * scaleY(0.5)

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    this.castsShadow = false;

    // 轨道粒子（两层轨道）
    for (let i = 0; i < 12; i++) {
      const inner = i < 6;
      this._particles.push({
        angle: (i / (inner ? 6 : 6)) * Math.PI * 2,
        radius: inner ? 0.45 : 0.85,
        speed: inner ? 1.4 : 0.7,
        size: inner ? 2.5 : 3.5,
        color: inner
          ? ['#c0a0ff', '#80d0ff', '#e080ff'][i % 3]
          : ['#60b0ff', '#a060ff', '#40e0ff', '#ff80c0'][i % 4],
        z: Math.random() * 24,
        zSpeed: inner ? 12 : 7,
        opacity: 0.7 + Math.random() * 0.3,
      });
    }
  }

  activate(): void {
    this._activated = true;
    this._activationPulse = 1;
    this._shockwaves.push({r: 0, alpha: 0.9});
  }

  /** 激活大光柱（传送时调用），持续 duration 秒后自动消退 */
  activateBeam(duration = 1.4): void {
    this._beamAlpha = 1;
    this._beamDuration = duration;
    this._beamTimer = 0;
  }

  get isActivated(): boolean { return this._activated; }

  get aabb(): AABB {
    return {
      minX: this.position.x - 1.5,
      minY: this.position.y - 1.5,
      maxX: this.position.x + 1.5,
      maxY: this.position.y + 1.5,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    super.update(ts);
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    this._phase += dt;

    if (this._activationPulse > 0) {
      this._activationPulse = Math.max(0, this._activationPulse - dt * 1.2);
    }

    const speedMult = this._activated ? 2.8 : 1;
    for (const p of this._particles) {
      p.angle += dt * p.speed * speedMult;
      p.z += dt * p.zSpeed * speedMult;
      if (p.z > 28) {
        p.z = 0;
        p.opacity = 0.6 + Math.random() * 0.4;
      }
    }

    // 扩散光环
    for (const sw of this._shockwaves) {
      sw.r += dt * 80;
      sw.alpha -= dt * 1.8;
    }
    this._shockwaves = this._shockwaves.filter(sw => sw.alpha > 0);

    // 大光柱消退
    if (this._beamAlpha > 0) {
      this._beamTimer += dt;
      const fadeStart = this._beamDuration * 0.6;
      if (this._beamTimer > fadeStart) {
        this._beamAlpha = Math.max(0, 1 - (this._beamTimer - fadeStart) / (this._beamDuration * 0.4));
      }
    }
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;

    const pulse = 0.55 + Math.sin(this._phase * 2.2) * 0.18
                + Math.sin(this._phase * 5.1) * 0.07
                + this._activationPulse * 0.7;
    const alpha = Math.min(1, pulse);

    ctx.save();
    ctx.translate(cx, cy);

    this._drawGroundGlow(ctx, tileW, tileH, alpha);
    this._drawRuneFloor(ctx, tileW, tileH, alpha);
    this._drawRings(ctx, tileW, tileH, alpha);
    this._drawPillars(ctx, tileW, tileH, alpha);
    this._drawParticles(ctx, tileW, tileH, alpha);
    this._drawShockwaves(ctx, tileW, tileH);
    if (this._beamAlpha > 0) {this._drawAscendBeam(ctx, tileW, tileH, this._beamAlpha);}

    ctx.restore();
  }

  // ── 地面光晕 ──────────────────────────────────────────────────────────────

  private _drawGroundGlow(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, alpha: number): void {
    const scaleY = tileH / tileW;
    ctx.save();
    ctx.scale(1, scaleY);

    // 外层大光晕
    const outerR = tileW * 1.6;
    const og = ctx.createRadialGradient(0, 0, 0, 0, 0, outerR);
    og.addColorStop(0, `rgba(140,80,255,${alpha * 0.28})`);
    og.addColorStop(0.4, `rgba(80,100,255,${alpha * 0.12})`);
    og.addColorStop(1, 'rgba(60,80,200,0)');
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fillStyle = og;
    ctx.fill();

    // 内层亮核
    const innerR = tileW * 0.5;
    const ig = ctx.createRadialGradient(0, 0, 0, 0, 0, innerR);
    ig.addColorStop(0, `rgba(220,180,255,${alpha * 0.5})`);
    ig.addColorStop(0.5, `rgba(160,100,255,${alpha * 0.2})`);
    ig.addColorStop(1, 'rgba(100,60,255,0)');
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fillStyle = ig;
    ctx.fill();

    ctx.restore();
  }

  // ── 地面符文 ──────────────────────────────────────────────────────────────

  private _drawRuneFloor(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, alpha: number): void {
    const scaleY = tileH / tileW;
    ctx.save();
    ctx.scale(1, scaleY);

    // 符文线条（旋转的六芒星线）
    const runeAlpha = alpha * 0.45;
    ctx.strokeStyle = `rgba(180,140,255,${runeAlpha})`;
    ctx.lineWidth = 0.8;

    for (let tri = 0; tri < 2; tri++) {
      const rot = this._phase * (tri === 0 ? 0.18 : -0.22) + tri * Math.PI / 3;
      const r = tileW * 0.72;
      ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rot;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) {ctx.moveTo(px, py);}
        else {ctx.lineTo(px, py);}
      }
      ctx.closePath();
      ctx.stroke();
    }

    // 内圈小符文点
    const dotR = tileW * 0.38;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this._phase * 0.4;
      const px = Math.cos(a) * dotR;
      const py = Math.sin(a) * dotR;
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,160,255,${alpha * 0.7})`;
      ctx.fill();
    }

    ctx.restore();
  }

  // ── 多边形环 ──────────────────────────────────────────────────────────────

  private _drawRings(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, alpha: number): void {
    const scaleY = tileH / tileW;

    // 外八边形（慢转）
    this._isoPolygon(ctx, tileW * 1.05, scaleY, 8,
      this._phase * 0.25,
      `rgba(100,150,255,${alpha * 0.75})`,
      `rgba(80,100,255,${alpha * 0.08})`, 1.8);

    // 中六边形（反转）
    this._isoPolygon(ctx, tileW * 0.7, scaleY, 6,
      -this._phase * 0.45,
      `rgba(170,100,255,${alpha * 0.9})`,
      `rgba(130,80,255,${alpha * 0.12})`, 1.5);

    // 内四边形（快转）
    this._isoPolygon(ctx, tileW * 0.38, scaleY, 4,
      this._phase * 1.1,
      `rgba(210,170,255,${alpha})`,
      `rgba(190,130,255,${alpha * 0.25})`, 1.5);

    // 中心光核
    ctx.save();
    ctx.scale(1, scaleY);
    const coreR = tileW * 0.14;
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR);
    cg.addColorStop(0, `rgba(255,255,255,${alpha * 0.95})`);
    cg.addColorStop(0.35, `rgba(200,160,255,${alpha * 0.7})`);
    cg.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.restore();
  }

  private _isoPolygon(
    ctx: CanvasRenderingContext2D,
    radius: number, scaleY: number, sides: number, rotation: number,
    stroke: string, fill: string, lineWidth: number
  ): void {
    ctx.save();
    ctx.scale(1, scaleY);
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 + rotation;
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      if (i === 0) {ctx.moveTo(px, py);} else {ctx.lineTo(px, py);}
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  // ── 光柱 ──────────────────────────────────────────────────────────────────

  private _drawPillars(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, alpha: number): void {
    const scaleY = tileH / tileW;
    const count = 8;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this._phase * 0.15;
      const r = tileW * 0.88;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * scaleY;
      const pillarH = 22 + Math.sin(this._phase * 2.5 + i * 0.8) * 8;
      const pillarAlpha = alpha * (0.5 + Math.sin(this._phase * 3 + i) * 0.2);

      const grad = ctx.createLinearGradient(px, py, px, py - pillarH);
      grad.addColorStop(0, `rgba(160,100,255,${pillarAlpha})`);
      grad.addColorStop(0.6, `rgba(120,80,255,${pillarAlpha * 0.4})`);
      grad.addColorStop(1, 'rgba(100,60,255,0)');

      ctx.beginPath();
      ctx.moveTo(px - 1.8, py);
      ctx.lineTo(px + 1.8, py);
      ctx.lineTo(px + 1.2, py - pillarH);
      ctx.lineTo(px - 1.2, py - pillarH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }

  // ── 粒子 ──────────────────────────────────────────────────────────────────

  private _drawParticles(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, alpha: number): void {
    const scaleY = tileH / tileW;
    for (const p of this._particles) {
      const px = Math.cos(p.angle) * p.radius * tileW;
      const py = Math.sin(p.angle) * p.radius * tileW * scaleY - p.z;
      const fadeAlpha = alpha * p.opacity * (1 - p.z / 28);
      if (fadeAlpha <= 0.02) {continue;}

      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.angle * 1.5 + this._phase);

      // 菱形粒子
      ctx.beginPath();
      ctx.moveTo(0, -p.size);
      ctx.lineTo(p.size * 0.55, 0);
      ctx.lineTo(0, p.size);
      ctx.lineTo(-p.size * 0.55, 0);
      ctx.closePath();

      // 粒子发光
      const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      pg.addColorStop(0, p.color.replace(')', `,${fadeAlpha})`).replace('#', 'rgba(').replace(/^rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/, (_, r, g, b) =>
        `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)}`));
      // 简化：直接用 fillStyle
      ctx.fillStyle = this._hexToRgba(p.color, fadeAlpha);
      ctx.fill();

      // 粒子光晕
      ctx.globalAlpha = fadeAlpha * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  // ── 扩散光环 ──────────────────────────────────────────────────────────────

  private _drawShockwaves(ctx: CanvasRenderingContext2D, tileW: number, tileH: number): void {
    const scaleY = tileH / tileW;
    for (const sw of this._shockwaves) {
      ctx.save();
      ctx.scale(1, scaleY);
      ctx.beginPath();
      ctx.arc(0, 0, sw.r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180,140,255,${sw.alpha})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── 飞升大光柱 ────────────────────────────────────────────────────────────

  private _drawAscendBeam(ctx: CanvasRenderingContext2D, tileW: number, tileH: number, alpha: number): void {
    const beamW = tileW * 0.55;
    const beamH = 420; // 光柱高度（屏幕像素）
    const scaleY = tileH / tileW;

    // 主光柱：半透明渐变矩形
    const grad = ctx.createLinearGradient(0, 0, 0, -beamH);
    grad.addColorStop(0, `rgba(200,160,255,${(alpha * 0.85).toFixed(2)})`);
    grad.addColorStop(0.2, `rgba(180,120,255,${(alpha * 0.65).toFixed(2)})`);
    grad.addColorStop(0.6, `rgba(140,100,255,${(alpha * 0.35).toFixed(2)})`);
    grad.addColorStop(1, 'rgba(120,80,255,0)');

    ctx.save();
    ctx.scale(1, scaleY);
    // 光柱形状：底部宽，顶部收窄
    ctx.beginPath();
    ctx.moveTo(-beamW * 0.5, 0);
    ctx.lineTo( beamW * 0.5, 0);
    ctx.lineTo( beamW * 0.18, -beamH);
    ctx.lineTo(-beamW * 0.18, -beamH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 光柱内芯（更亮的细线）
    const coreGrad = ctx.createLinearGradient(0, 0, 0, -beamH);
    coreGrad.addColorStop(0, `rgba(255,240,255,${(alpha * 0.9).toFixed(2)})`);
    coreGrad.addColorStop(0.3, `rgba(220,180,255,${(alpha * 0.6).toFixed(2)})`);
    coreGrad.addColorStop(0.7, `rgba(180,140,255,${(alpha * 0.25).toFixed(2)})`);
    coreGrad.addColorStop(1, 'rgba(160,120,255,0)');
    ctx.beginPath();
    ctx.moveTo(-beamW * 0.12, 0);
    ctx.lineTo( beamW * 0.12, 0);
    ctx.lineTo( beamW * 0.04, -beamH);
    ctx.lineTo(-beamW * 0.04, -beamH);
    ctx.closePath();
    ctx.fillStyle = coreGrad;
    ctx.fill();

    // 光柱边缘光晕（screen 混合）
    ctx.globalCompositeOperation = 'screen';
    const edgeGrad = ctx.createLinearGradient(0, 0, 0, -beamH * 0.7);
    edgeGrad.addColorStop(0, `rgba(180,100,255,${(alpha * 0.5).toFixed(2)})`);
    edgeGrad.addColorStop(1, 'rgba(140,80,255,0)');
    ctx.beginPath();
    ctx.moveTo(-beamW * 0.9, 0);
    ctx.lineTo( beamW * 0.9, 0);
    ctx.lineTo( beamW * 0.25, -beamH * 0.7);
    ctx.lineTo(-beamW * 0.25, -beamH * 0.7);
    ctx.closePath();
    ctx.fillStyle = edgeGrad;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // 底部爆发光环
    const burstR = beamW * 1.8;
    const burstGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, burstR);
    burstGrad.addColorStop(0, `rgba(220,180,255,${(alpha * 0.6).toFixed(2)})`);
    burstGrad.addColorStop(0.4, `rgba(160,100,255,${(alpha * 0.25).toFixed(2)})`);
    burstGrad.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.beginPath();
    ctx.arc(0, 0, burstR, 0, Math.PI * 2);
    ctx.fillStyle = burstGrad;
    ctx.fill();

    ctx.restore();
  }

  private _hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
