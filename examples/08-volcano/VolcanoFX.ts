/**
 * VolcanoFX — 烟雾柱 + 地面裂缝火星喷发（使用框架 ParticleSystem）
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {ParticleSystem} from '../../src/animation/ParticleSystem';
import {AABB} from '../../src/math/depthSort';
import {project} from '../../src/math/IsoProjection';

// ── 烟雾柱 ────────────────────────────────────────────────────────────────────

export class SmokePlumeSystem extends IsoObject {
  densityMult = 1;
  private _ps: ParticleSystem;

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    this.castsShadow = false;

    this._ps = new ParticleSystem(`${id}-ps`, x, y, 0);
    this._ps.addEmitter({
      maxParticles: 60,
      rate: 18,
      shape: 'circle',
      spawnRadius: 0.3,
      lifetime: [1.5, 3.0],
      speed: [0.1, 0.4],
      angle: [0, Math.PI * 2],
      vz: [8, 20], // 像素/秒，烟雾向上飘
      gravity: 0,
      size: [6, 14],
      sizeFinal: 2.5,
      colorStart: '#302020',
      colorEnd: '#808080',
      alphaStart: 0.55,
      alphaEnd: 0,
      blend: 'source-over',
      rotSpeed: [-1.2, 1.2],
      particleShape: 'circle',
    });
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 2, minY: this.position.y - 2,
      maxX: this.position.x + 2, maxY: this.position.y + 2,
      baseZ: 0, maxZ: 4,
    };
  }

  update(ts?: number): void {
    // 根据 densityMult 动态调整发射率（emitter 内部字段为 .config，非 .cfg）
    // `_emitters` 是 ParticleSystem 的 TS private 字段，这里用结构化类型描述
    // 真正读到的那一个字段，避免 any。
    const emitters = (this._ps as unknown as {_emitters: {config: {rate: number}}[]})._emitters;
    const cfg = emitters[0]?.config;
    if (cfg) {cfg.rate = Math.round(18 * this.densityMult);}
    this._ps.update(ts);
  }

  draw(dc: DrawContext): void {
    this._ps.draw(dc);
  }
}

// ── 地面裂缝 + 火星喷发 ───────────────────────────────────────────────────────

export class LavaCrack extends IsoObject {
  crackSeed: number;
  private _timer = 0;
  private _nextBurst: number;
  private _lastTs = 0;
  private _burstActive = false;
  burstAge = 0;

  // 每次喷发用一个独立 ParticleSystem
  private _sparkPs: ParticleSystem;

  constructor(id: string, x: number, y: number, crackSeed = 0.5) {
    super(id, x, y, 0);
    this.crackSeed = crackSeed;
    this._nextBurst = 1 + Math.random() * 2;
    this.castsShadow = false;

    this._sparkPs = new ParticleSystem(`${id}-sparks`, x, y, 0);
    this._sparkPs.addEmitter({
      maxParticles: 40,
      rate: 0, // 只 burst，不连续发射
      shape: 'ring',
      spawnRadius: 0.15,
      lifetime: [0.4, 0.9],
      speed: [0.8, 2.5],
      angle: [0, Math.PI * 2],
      vz: [12, 30], // 像素/秒，火星向上弹射
      gravity: -25, // 像素/秒²，重力拉回
      size: [2, 5],
      sizeFinal: 0,
      colorStart: '#ff8800',
      colorEnd: '#ff2200',
      alphaStart: 1,
      alphaEnd: 0,
      blend: 'screen',
      particleShape: 'circle',
    });
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.5, minY: this.position.y - 0.5,
      maxX: this.position.x + 0.5, maxY: this.position.y + 0.5,
      baseZ: 0, maxZ: 3,
    };
  }

  get isBursting(): boolean { return this._burstActive; }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    this._timer += dt;
    if (this._timer >= this._nextBurst) {
      this._timer = 0;
      this._nextBurst = 1 + Math.random() * 2;
      this._burstActive = true;
      this.burstAge = 0;
      this._sparkPs.burst(20);
    }

    if (this._burstActive) {
      this.burstAge += dt;
      if (this.burstAge > 0.6) {this._burstActive = false;}
    }

    this._sparkPs.update(ts);
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const seed = this.crackSeed;

    // 裂缝线条
    ctx.save();
    ctx.translate(cx, cy);
    const pts: Array<[number, number]> = [
      [-tileW * 0.18, 0],
      [-tileW * 0.08, -tileH * 0.1 + Math.sin(seed * 7) * 3],
      [0, tileH * 0.05],
      [ tileW * 0.1, -tileH * 0.08 + Math.cos(seed * 11) * 3],
      [ tileW * 0.2, tileH * 0.04],
    ];

    ctx.strokeStyle = '#5a1a08';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {ctx.lineTo(pts[i][0], pts[i][1]);}
    ctx.stroke();

    // 裂缝内发光（喷发时更亮）
    const glowAlpha = this._burstActive ? 0.85 : 0.35;
    ctx.strokeStyle = `rgba(255,80,10,${glowAlpha})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {ctx.lineTo(pts[i][0], pts[i][1]);}
    ctx.stroke();

    // 喷发时裂缝口光晕
    if (this._burstActive) {
      const pulse = 1 - this.burstAge / 0.6;
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, tileW * 0.4);
      glow.addColorStop(0, `rgba(255,160,20,${(pulse * 0.7).toFixed(2)})`);
      glow.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.beginPath();
      ctx.arc(0, 0, tileW * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();

    // 火星粒子（框架 ParticleSystem）
    this._sparkPs.draw(dc);
  }
}
