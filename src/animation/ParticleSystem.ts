import { IsoObject, DrawContext } from '../elements/IsoObject';
import { project } from '../math/IsoProjection';
import { AABB } from '../math/depthSort';
import { SpriteSheet } from './SpriteSheet';
import { lerpColor } from '../math/color';

export enum EmitterShape { POINT, CIRCLE, SQUARE }
export enum ParticleBlend { ADD, ALPHA, MULTIPLY }

export interface EmitterConfig {
  rate: number;
  max?: number;
  maxParticles?: number;
  shape?: EmitterShape | string;
  radius?: number;
  spawnRadius?: number;
  // accept both 'life' and 'lifetime' tuple forms
  life?: [number, number];
  lifetime?: [number, number];
  // accept both 'speed' tuple and separate vz
  speed?: [number, number];
  vz?: [number, number];
  angle?: [number, number];
  size: [number, number];
  sizeFinal?: number;
  color?: string | string[];
  colorStart?: string;
  colorEnd?: string;
  alphaStart?: number;
  alphaEnd?: number;
  gravity?: number;
  spriteClip?: string;
  blend?: ParticleBlend | string;
  rotSpeed?: [number, number];
  particleShape?: string;
}

export interface ParticleOptions {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; size: number;
  color?: string; gravity?: number;
  spriteSheet?: SpriteSheet; spriteClip?: string;
  blend?: ParticleBlend | string;
  shape?: string;
  sizeFinal?: number;
  colorEnd?: string;
  alphaStart?: number;
  alphaEnd?: number;
  rotation?: number;
  rotSpeed?: number;
}

/** Allocation-free read-only view consumed by renderer backends. */
export interface ParticleRenderState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly size: number;
  readonly color: string;
  readonly colorEnd?: string;
  readonly alpha: number;
  readonly progress: number;
  readonly blend: ParticleBlend;
  readonly shape: string;
  readonly rotation: number;
  readonly spriteSheet?: SpriteSheet;
  readonly spriteClip?: string;
}

export class ParticleSystem extends IsoObject {
  private particles: Particle[] = [];
  private static _pool: Particle[] = [];
  private _emitters: { config: EmitterConfig, accumulator: number }[] = [];
  onExhausted: (() => void) | null = null;
  private _lastTs = 0;

  static presets: any = {
    crystalShatter: (_o?: any) => ({ rate: 0, life: [0.4, 0.8], speed: [2, 5], size: [4, 8], color: ['#00ffff', '#ffffff'], gravity: 10 }),
    dustPuff:       (_o?: any) => ({ rate: 0, life: [0.6, 1.0], speed: [0.5, 2], size: [8, 20], color: ['#887766'], gravity: 0 }),
    coinSpill:      (_o?: any) => ({ rate: 0, life: [0.8, 1.5], speed: [1, 4], size: [5, 10], color: ['#ffff00', '#ffd700'], gravity: 12 }),
    sparkBurst:     (_o?: any) => ({ rate: 0, life: [0.3, 0.6], speed: [4, 8], size: [2, 5], color: ['#ffffff', '#ffffcc'], gravity: 5 }),
    /** Ambient floating dust/motes that drift slowly across the scene. */
    ambientDrift: (o?: {
      color?: string | string[];
      count?: number;
      speed?: [number, number];
      size?: [number, number];
      alpha?: number;
      blend?: string;
      shape?: string;
    }) => ({
      rate:  o?.count ?? 40,
      life:  [2.0, 5.0] as [number, number],
      speed: o?.speed ?? [0.05, 0.25] as [number, number],
      angle: [0, Math.PI * 2] as [number, number],
      vz:    [0.02, 0.10] as [number, number],
      size:  o?.size  ?? [2, 6] as [number, number],
      color: o?.color ?? ['#d4b060', '#e8c880', '#c09840'],
      gravity: -0.05,
      alphaStart: o?.alpha ?? 0.35,
      alphaEnd:   0,
      blend: o?.blend ?? 'screen',
      shape: o?.shape ?? 'circle',
    }),
    FIRE:   { rate: 40, life: [0.5, 1.2], speed: [0.5, 1.5], size: [4, 12], color: ['#ff4400', '#ffaa00'], gravity: 2 },
    SMOKE:  { rate: 10, life: [1.5, 3.0], speed: [0.2, 0.6], size: [10, 30], color: ['#333', '#666'], gravity: -1 },
  };

  constructor(id: string, x: number, y: number, z: number) {
    super(id, x, y, z);
    this.castsShadow = false;
  }

  addEmitter(config: EmitterConfig): void {
    this._emitters.push({ config, accumulator: 0 });
  }

  get particleCount(): number {
    return this.particles.length;
  }

  forEachParticle(visitor: (particle: ParticleRenderState) => void): void {
    for (const particle of this.particles) visitor(particle);
  }

  spawn(opts: ParticleOptions): void {
    let p = ParticleSystem._pool.pop();
    if (p) p.reset(opts); else p = new Particle(opts);
    this.particles.push(p);
  }

  burst(count = 20, randomness = 0.5): void {
    // Legacy: burst first emitter
    const e = this._emitters[0];
    if (!e) return;
    const c = e.config;
    for (let i = 0; i < count; i++) {
      this.spawnFromEmitter(c, randomness);
    }
  }

  get aabb(): AABB {
    // position.z and AABB Z share one unit: screen pixels.
    const baseZ = this.position.z;
    if (this.particles.length === 0) {
      return { minX: this.position.x - 0.5, minY: this.position.y - 0.5, maxX: this.position.x + 0.5, maxY: this.position.y + 0.5, baseZ };
    }
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const p of this.particles) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, baseZ };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt  = this._lastTs === 0 ? 1 / 60 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    for (const e of this._emitters) {
      if (e.config.rate <= 0) continue;
      e.accumulator += dt;
      const interval = 1 / e.config.rate;
      while (e.accumulator >= interval) {
        e.accumulator -= interval;
        this.spawnFromEmitter(e.config);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p.update(dt)) {
        this.particles.splice(i, 1);
        ParticleSystem._pool.push(p);
      }
    }
    if (this.particles.length === 0 && this._emitters.every(e => e.config.rate <= 0)) {
      this.onExhausted?.();
    }
  }

  private spawnFromEmitter(c: EmitterConfig, randomness = 1.0): void {
    const limit = c.maxParticles ?? c.max;
    if (limit !== undefined && this.particles.length >= limit) return;

    const rx = (Math.random() - 0.5) * (c.spawnRadius ?? c.radius ?? 0);
    const ry = (Math.random() - 0.5) * (c.spawnRadius ?? c.radius ?? 0);
    const lifeRange = c.life ?? c.lifetime ?? [0.5, 1.0];
    const life = lifeRange[0] + Math.random() * (lifeRange[1] - lifeRange[0]);
    const speedRange = c.speed ?? [1, 2];
    const speed = (speedRange[0] + Math.random() * (speedRange[1] - speedRange[0])) * randomness;
    const size = c.size[0] + Math.random() * (c.size[1] - c.size[0]);
    const angleRange = c.angle ?? [0, Math.PI * 2];
    const angle = angleRange[0] + Math.random() * (angleRange[1] - angleRange[0]);
    const vzRange = c.vz;
    const vzVal = vzRange ? vzRange[0] + Math.random() * (vzRange[1] - vzRange[0]) : speed;
    const color = Array.isArray(c.color)
      ? c.color[Math.floor(Math.random() * c.color.length)]
      : (c.color ?? c.colorStart ?? '#fff');
    this.spawn({
      x: this.position.x + rx, y: this.position.y + ry, z: this.position.z,
      vx: Math.cos(angle) * speed * 0.2, vy: Math.sin(angle) * speed * 0.2, vz: vzVal,
      life,
      size,
      color,
      gravity: c.gravity,
      spriteClip: c.spriteClip,
      blend: c.blend,
      shape: c.particleShape ?? (typeof c.shape === 'string' ? c.shape : undefined),
      sizeFinal: c.sizeFinal,
      colorEnd: c.colorEnd,
      alphaStart: c.alphaStart,
      alphaEnd: c.alphaEnd,
      rotSpeed: c.rotSpeed
        ? c.rotSpeed[0] + Math.random() * (c.rotSpeed[1] - c.rotSpeed[0])
        : 0,
    });
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    for (const p of this.particles) {
      const { sx, sy } = project(p.x, p.y, p.z, tileW, tileH);
      const bx = originX + sx;
      const by = originY + sy;
      const radius = p.size * (tileW / 32);
      ctx.save();
      ctx.globalCompositeOperation = particleCompositeOperation(p.blend);
      ctx.translate(bx, by);
      ctx.rotate(p.rotation);
      const image = p.spriteSheet?.image;
      const clip = p.spriteSheet && p.spriteClip ? p.spriteSheet.clips.get(p.spriteClip) : undefined;
      const frame = clip?.frames[Math.min(
        clip.frames.length - 1,
        Math.floor(p.progress * clip.frames.length),
      )];
      ctx.globalAlpha = p.alpha;
      if (image && frame) {
        const height = radius * 2;
        const width = height * (frame.w / frame.h);
        ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, -width / 2, -height / 2, width, height);
      } else {
        ctx.beginPath();
        if (p.shape === 'square') {
          ctx.rect(-radius, -radius, radius * 2, radius * 2);
        } else {
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
        }
        ctx.fillStyle = p.colorEnd ? lerpColor(p.color, p.colorEnd, p.progress) : p.color;
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

class Particle implements ParticleRenderState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; color: string; gravity: number;
  colorEnd?: string;
  blend = ParticleBlend.ALPHA;
  shape = 'circle';
  rotation = 0;
  spriteSheet?: SpriteSheet;
  spriteClip?: string;
  alpha = 1.0;
  private _sizeStart = 0;
  private _sizeFinal = 0;
  private _alphaStart = 1;
  private _alphaEnd = 0;
  private _rotSpeed = 0;
  constructor(opts: ParticleOptions) {
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.life = 0; this.maxLife = 0; this.size = 0; this.color = '#fff'; this.gravity = 0;
    this.reset(opts);
  }
  reset(opts: ParticleOptions): void {
    this.x = opts.x; this.y = opts.y; this.z = opts.z;
    this.vx = opts.vx; this.vy = opts.vy; this.vz = opts.vz;
    this.life = opts.life; this.maxLife = opts.life;
    this.size = opts.size;
    this._sizeStart = opts.size;
    this._sizeFinal = opts.sizeFinal ?? opts.size;
    this.color = opts.color ?? '#fff';
    this.colorEnd = opts.colorEnd;
    this.gravity = opts.gravity ?? 0;
    this._alphaStart = opts.alphaStart ?? 1;
    this._alphaEnd = opts.alphaEnd ?? 0;
    this.alpha = this._alphaStart;
    this.blend = normalizeParticleBlend(opts.blend);
    this.shape = opts.shape ?? 'circle';
    this.rotation = opts.rotation ?? 0;
    this._rotSpeed = opts.rotSpeed ?? 0;
    this.spriteSheet = opts.spriteSheet;
    this.spriteClip = opts.spriteClip;
  }
  update(dt: number): boolean {
    this.life -= dt;
    if (this.life <= 0) return false;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.vz -= this.gravity * dt;
    this.rotation += this._rotSpeed * dt;
    const t = this.progress;
    this.alpha = this._alphaStart + (this._alphaEnd - this._alphaStart) * t;
    this.size = this._sizeStart + (this._sizeFinal - this._sizeStart) * t;
    return true;
  }

  get progress(): number {
    return this.maxLife <= 0 ? 1 : Math.max(0, Math.min(1, 1 - this.life / this.maxLife));
  }
}

function normalizeParticleBlend(value?: ParticleBlend | string): ParticleBlend {
  if (typeof value === 'number') return value;
  switch (value?.toLowerCase()) {
    case 'add':
    case 'additive':
    case 'lighter':
    case 'screen':
      return ParticleBlend.ADD;
    case 'multiply':
      return ParticleBlend.MULTIPLY;
    default:
      return ParticleBlend.ALPHA;
  }
}

function particleCompositeOperation(blend: ParticleBlend): GlobalCompositeOperation {
  if (blend === ParticleBlend.ADD) return 'lighter';
  if (blend === ParticleBlend.MULTIPLY) return 'multiply';
  return 'source-over';
}
