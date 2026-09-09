import { Entity } from '../../ecs/Entity';
import { AABB } from '../../math/depthSort';
import { project } from '../../math/IsoProjection';
import { lerpColor, shiftColor } from '../../math/color';
import { DrawContext } from '../IsoObject';

export interface TreeOptions {
  id: string;
  x: number;
  y: number;
  canopyColor?: string;
  trunkColor?: string;
  heightPx?: number;
  scale?: number;
}

/** Compact stylised tree suitable for gardens, villages, and map borders. */
export class Tree extends Entity {
  private readonly _canopyColor: string;
  private readonly _trunkColor: string;
  private readonly _heightPx: number;
  private readonly _scale: number;

  constructor(options: TreeOptions) {
    super(options.id, options.x, options.y, 0);
    this._canopyColor = options.canopyColor ?? '#4f9d68';
    this._trunkColor = options.trunkColor ?? '#80583f';
    this._heightPx = Math.max(24, options.heightPx ?? 72);
    this._scale = Math.max(0.4, options.scale ?? 1);
    this.castsShadow = true;
    this.shadowRadius = 0.52 * this._scale;
  }

  get propCanopyColor(): string { return this._canopyColor; }
  get propTrunkColor(): string { return this._trunkColor; }
  get propHeightPx(): number { return this._heightPx; }
  get propScale(): number { return this._scale; }

  get aabb(): AABB {
    const radius = 0.58 * this._scale;
    return {
      minX: this.position.x - radius,
      minY: this.position.y - radius,
      maxX: this.position.x + radius,
      maxY: this.position.y + radius,
      baseZ: 0,
      maxZ: this._heightPx * this._scale * 1.08,
    };
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY, omniLights } = dc;
    const projected = project(this.position.x, this.position.y, 0, tileW, tileH);
    const cx = originX + projected.sx;
    const cy = originY + projected.sy;
    const height = this._heightPx * this._scale;
    const canopyRadius = tileW * 0.31 * this._scale;

    let illumination = 0.25;
    for (const light of omniLights) {
      const lp = project(light.position.x, light.position.y, 0, tileW, tileH);
      illumination += light.illuminateAt(cx, cy, originX + lp.sx, originY + lp.sy - light.position.z);
    }
    illumination = Math.min(1, illumination);

    const trunkWidth = Math.max(5, tileW * 0.09 * this._scale);
    const trunkTop = cy - height * 0.72;
    ctx.beginPath();
    ctx.moveTo(cx - trunkWidth * 0.72, cy);
    ctx.lineTo(cx - trunkWidth * 0.45, trunkTop);
    ctx.lineTo(cx + trunkWidth * 0.42, trunkTop);
    ctx.lineTo(cx + trunkWidth * 0.82, cy);
    ctx.closePath();
    ctx.fillStyle = lerpColor(shiftColor(this._trunkColor, -22), '#ffffff', illumination * 0.22);
    ctx.fill();

    const canopyY = cy - height * 0.78;
    const puffs: ReadonlyArray<readonly [number, number, number, string]> = [
      [-0.58, 0.15, 0.64, shiftColor(this._canopyColor, -28)],
      [0.58, 0.12, 0.62, shiftColor(this._canopyColor, -16)],
      [0, -0.38, 0.72, shiftColor(this._canopyColor, 12)],
      [-0.2, 0.2, 0.82, this._canopyColor],
      [0.28, 0.22, 0.75, shiftColor(this._canopyColor, 5)],
    ];
    for (const [dx, dy, scale, color] of puffs) {
      ctx.beginPath();
      ctx.ellipse(
        cx + canopyRadius * dx,
        canopyY + canopyRadius * dy,
        canopyRadius * scale,
        canopyRadius * scale * 0.8,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = lerpColor(color, '#ffffff', illumination * 0.18);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.ellipse(
      cx - canopyRadius * 0.2,
      canopyY - canopyRadius * 0.42,
      canopyRadius * 0.24,
      canopyRadius * 0.13,
      -0.3,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = lerpColor(shiftColor(this._canopyColor, 56), '#ffffff', illumination * 0.32);
    ctx.fill();
  }
}
