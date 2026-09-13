import { Entity } from '../../ecs/Entity';
import { AABB } from '../../math/depthSort';
import { project } from '../../math/IsoProjection';
import { hexToRgba, shiftColor } from '../../math/color';
import { DrawContext } from '../IsoObject';

export interface LanternOptions {
  id: string;
  x: number;
  y: number;
  postColor?: string;
  glowColor?: string;
  heightPx?: number;
}

/** Warm garden lantern. Pair with an OmniLight when it should illuminate a scene. */
export class Lantern extends Entity {
  private readonly _postColor: string;
  private readonly _glowColor: string;
  private readonly _heightPx: number;

  constructor(options: LanternOptions) {
    super(options.id, options.x, options.y, 0);
    this._postColor = options.postColor ?? '#40504b';
    this._glowColor = options.glowColor ?? '#ffd166';
    this._heightPx = Math.max(24, options.heightPx ?? 50);
    this.castsShadow = true;
    this.shadowRadius = 0.2;
  }

  get propPostColor(): string { return this._postColor; }
  get propGlowColor(): string { return this._glowColor; }
  get propHeightPx(): number { return this._heightPx; }

  /**
   * Roof apex above the lamp centre, as a fraction of `tileH`.
   *
   * `draw` puts the cap apex at `lampY - bodyHeight * 0.95` with
   * `bodyHeight = tileH * 0.44`, so the silhouette's top is
   * `heightPx + 0.418 * tileH`.
   */
  static readonly ROOF_RISE = 0.44 * 0.95;

  get aabb(): AABB {
    // `maxZ` used to be `heightPx + 8`: a constant, where the part it stands for
    // scales with the tile. At the standard 32 px tile the roof reaches
    // `heightPx + 13.38`, so the box understated the lantern by 5.4 px and would
    // drift further on a taller tile. `aabb` has no `tileH` — the getter takes no
    // draw context — so it is quoted for the standard 64x32 tile, the same
    // approximation `Chest.aabb` documents.
    //
    // The additive glow ellipse reaches `heightPx + 1.012 * tileH` and is
    // excluded on purpose: it is light, not geometry, and giving it occluding
    // height would make the lantern sort in front of things it does not cover.
    return {
      minX: this.position.x - 0.24,
      minY: this.position.y - 0.24,
      maxX: this.position.x + 0.24,
      maxY: this.position.y + 0.24,
      baseZ: 0,
      maxZ: this._heightPx + 32 * Lantern.ROOF_RISE,
    };
  }


  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const projected = project(this.position.x, this.position.y, 0, tileW, tileH);
    const cx = originX + projected.sx;
    const cy = originY + projected.sy;
    const height = this._heightPx;
    const lampY = cy - height;
    const bodyW = tileW * 0.16;
    const bodyH = tileH * 0.44;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hexToRgba(this._glowColor, 0.1);
    ctx.beginPath();
    ctx.ellipse(cx, lampY, bodyW * 2.7, bodyH * 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = shiftColor(this._postColor, -22);
    ctx.beginPath();
    ctx.moveTo(cx, cy + tileH * 0.1);
    ctx.lineTo(cx + tileW * 0.12, cy);
    ctx.lineTo(cx, cy - tileH * 0.1);
    ctx.lineTo(cx - tileW * 0.12, cy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = this._postColor;
    ctx.fillRect(cx - Math.max(1.5, tileW * 0.025), lampY + bodyH * 0.5, Math.max(3, tileW * 0.05), height - bodyH * 0.35);

    ctx.beginPath();
    ctx.moveTo(cx, lampY - bodyH * 0.72);
    ctx.lineTo(cx + bodyW * 0.75, lampY - bodyH * 0.35);
    ctx.lineTo(cx + bodyW * 0.62, lampY + bodyH * 0.48);
    ctx.lineTo(cx, lampY + bodyH * 0.7);
    ctx.lineTo(cx - bodyW * 0.62, lampY + bodyH * 0.48);
    ctx.lineTo(cx - bodyW * 0.75, lampY - bodyH * 0.35);
    ctx.closePath();
    ctx.fillStyle = this._glowColor;
    ctx.fill();
    ctx.strokeStyle = shiftColor(this._postColor, 18);
    ctx.lineWidth = Math.max(1.2, tileW * 0.025);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.92, lampY - bodyH * 0.5);
    ctx.lineTo(cx, lampY - bodyH * 0.95);
    ctx.lineTo(cx + bodyW * 0.92, lampY - bodyH * 0.5);
    ctx.closePath();
    ctx.fillStyle = shiftColor(this._postColor, -8);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx - bodyW * 0.2, lampY - bodyH * 0.15, bodyW * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#fff7cf';
    ctx.fill();
  }
}
