/**
 * VolcanoTerrain  暗红色岩层地面 + 火山锥
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {AABB} from '../../src/math/depthSort';
import {project, drawIsoCube} from '../../src/math/IsoProjection';

//  岩层地面 ─

export class RockLayer extends IsoObject {
  readonly cols: number;
  readonly rows: number;

  constructor(id: string, cols: number, rows: number) {
    super(id, 0, 0, 0);
    this.cols = cols;
    this.rows = rows;
    this.castsShadow = false;
    this.isGroundLayer = true; // full-map terrain → drawn above floor, below topoSort
  }

  get aabb(): AABB {
    return {minX: 0, minY: 0, maxX: this.cols, maxY: this.rows, baseZ: 0, maxZ: 0.9};
  }

  private _height(col: number, row: number): number {
    return (
      Math.sin(col * 0.8 + row * 0.5) * 0.35 +
      Math.cos(col * 0.4 - row * 0.7) * 0.25 +
      Math.sin(col * 1.2 + row * 1.0) * 0.1
    ) * 0.8;
  }

  private _color(h: number, dark: boolean): string {
    const t = (h + 0.56) / 1.12;
    const r = Math.round(0x3a + t * (0x6a - 0x3a));
    const g = Math.round(0x1a + t * (0x2a - 0x1a));
    const b = Math.round(0x0a + t * (0x10 - 0x0a));
    const dim = dark ? 0.65 : 1;
    return `rgb(${Math.round(r * dim)},${Math.round(g * dim)},${Math.round(b * dim)})`;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const h = Math.max(0, this._height(col, row));
        const top = this._color(h, false);
        const left = this._color(h, true);
        const right = this._color(h, false);
        drawIsoCube(ctx, originX, originY, tileW, tileH,
          col, row, 0, 1, 1, h + 0.05,
          top, left, right);
      }
    }
  }
}

//  火山锥

export class VolcanoCone extends IsoObject {
  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    this.castsShadow = true;
    this.shadowRadius = 3;
  }

  get aabb(): AABB {
    // 8 layers × layerH(0.55) = 4.4 world-Z units tall
    return {
      minX: this.position.x - 1, minY: this.position.y - 1,
      maxX: this.position.x + 4, maxY: this.position.y + 4,
      baseZ: 0, maxZ: 4.4,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const layers = 8;
    const baseSize = 3.0;
    const shrink = 0.3;
    const layerH = 0.55;

    for (let i = 0; i < layers; i++) {
      const size = baseSize - i * shrink;
      const offset = i * shrink * 0.5;
      const zBase = i * layerH;
      const t = i / (layers - 1);
      const r = Math.round(0x4a + t * (0x8a - 0x4a));
      const g = Math.round(0x1a + t * (0x2a - 0x1a));
      const b = Math.round(0x08 + t * (0x10 - 0x08));
      const topC = `rgb(${r},${g},${b})`;
      const leftC = `rgb(${Math.round(r * 0.6)},${Math.round(g * 0.6)},${Math.round(b * 0.6)})`;
      const rightC = `rgb(${Math.round(r * 0.75)},${Math.round(g * 0.75)},${Math.round(b * 0.75)})`;
      drawIsoCube(ctx, originX, originY, tileW, tileH,
        x + offset, y + offset, zBase, size, size, layerH,
        topC, leftC, rightC);
    }

    // 顶部橙红发光
    const topZ = layers * layerH;
    const topOffset = (layers - 1) * shrink * 0.5 + shrink * 0.5;
    const {sx, sy} = project(x + topOffset + 0.5, y + topOffset + 0.5, topZ, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, tileW * 0.8);
    glow.addColorStop(0, 'rgba(255,120,20,0.7)');
    glow.addColorStop(0.4, 'rgba(200,60,10,0.3)');
    glow.addColorStop(1, 'rgba(150,30,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, tileW * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
  }
}
