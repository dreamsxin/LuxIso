import { Entity } from '../../ecs/Entity';
import { AABB } from '../../math/depthSort';
import { project } from '../../math/IsoProjection';
import { shiftColor } from '../../math/color';
import { DrawContext } from '../IsoObject';

export interface FlowerPatchOptions {
  id: string;
  x: number;
  y: number;
  color?: string;
  accentColor?: string;
  count?: number;
  seed?: number;
}

export interface FlowerOffset {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly accent: boolean;
}

/** Deterministic patch of small flowers for paths, gardens, and clearings. */
export class FlowerPatch extends Entity {
  private readonly _color: string;
  private readonly _accentColor: string;
  private readonly _count: number;
  private readonly _seed: number;
  private readonly _offsets: FlowerOffset[];

  constructor(options: FlowerPatchOptions) {
    super(options.id, options.x, options.y, 0);
    this._color = options.color ?? '#f47ca5';
    this._accentColor = options.accentColor ?? '#fff0a6';
    this._count = Math.max(1, Math.min(16, Math.floor(options.count ?? 7)));
    this._seed = options.seed ?? 1;
    this._offsets = buildFlowerOffsets(this._count, this._seed);
    this.castsShadow = true;
    this.shadowRadius = 0.24;
  }

  get propColor(): string { return this._color; }
  get propAccentColor(): string { return this._accentColor; }
  get propCount(): number { return this._count; }
  get propSeed(): number { return this._seed; }
  get flowerOffsets(): readonly FlowerOffset[] { return this._offsets; }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.55,
      minY: this.position.y - 0.55,
      maxX: this.position.x + 0.55,
      maxY: this.position.y + 0.55,
      baseZ: 0,
      maxZ: 18,
    };
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const projected = project(this.position.x, this.position.y, 0, tileW, tileH);
    const centerX = originX + projected.sx;
    const centerY = originY + projected.sy;

    for (const flower of this._offsets) {
      const x = centerX + flower.x * tileW * 0.5;
      const baseY = centerY + flower.y * tileH * 1.15;
      const stemHeight = (7 + (flower.y + 0.5) * 4) * flower.scale;
      const headY = baseY - stemHeight;
      const radius = 2.2 * flower.scale;
      const petalColor = flower.accent ? this._accentColor : this._color;

      ctx.strokeStyle = shiftColor('#568c4c', flower.accent ? 8 : -4);
      ctx.lineWidth = Math.max(1, flower.scale);
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x, headY);
      ctx.stroke();

      ctx.fillStyle = '#70a95a';
      ctx.beginPath();
      ctx.ellipse(x - 2.2 * flower.scale, baseY - stemHeight * 0.38, 2.5 * flower.scale, 1.1 * flower.scale, -0.45, 0, Math.PI * 2);
      ctx.fill();

      for (let petal = 0; petal < 5; petal++) {
        const angle = petal * Math.PI * 2 / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * radius, headY + Math.sin(angle) * radius, radius * 0.75, 0, Math.PI * 2);
        ctx.fillStyle = petalColor;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, headY, radius * 0.72, 0, Math.PI * 2);
      ctx.fillStyle = flower.accent ? '#ef8f59' : '#ffe18a';
      ctx.fill();
    }
  }
}

function buildFlowerOffsets(count: number, seed: number): FlowerOffset[] {
  let state = (Math.floor(seed * 1000003) ^ 0x6d2b79f5) >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return Array.from({ length: count }, (_, index) => ({
    x: random() * 1.1 - 0.55,
    y: random() * 0.7 - 0.35,
    scale: 0.72 + random() * 0.45,
    accent: index % 3 === 1,
  })).sort((a, b) => a.y - b.y);
}
