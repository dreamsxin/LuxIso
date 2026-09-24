/**
 * DesertTerrain — 低多边形沙丘地面
 *
 * 每个格子分成两个三角形，高度用 sin/cos 叠加产生起伏。
 * 远处顶点加热浪扰动。
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {AABB} from '../../src/math/depthSort';
import {project} from '../../src/math/IsoProjection';

export class SandDune extends IsoObject {
  readonly cols: number;
  readonly rows: number;

  private _time = 0;
  private _lastTs = 0;
  heatWaveStrength = 2;

  constructor(id: string, cols: number, rows: number) {
    super(id, 0, 0, 0);
    this.cols = cols;
    this.rows = rows;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {minX: 0, minY: 0, maxX: this.cols, maxY: this.rows, baseZ: -4};
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._time += dt;
  }

  private _height(col: number, row: number): number {
    return (
      Math.sin(col * 0.7 + row * 0.4) * 0.6 +
      Math.cos(col * 0.3 - row * 0.6) * 0.4 +
      Math.sin(col * 1.1 + row * 0.9) * 0.2
    );
  }

  private _vertex(
    col: number, row: number, tileW: number, tileH: number, originX: number, originY: number
  ): {sx: number; sy: number} {
    const h = this._height(col, row);
    // 热浪扰动：远处（row < 4）
    const heatX = row < 4 ? Math.sin(this._time * 2 + col * 0.5) * this.heatWaveStrength : 0;
    const p = project(col, row, h, tileW, tileH);
    return {sx: originX + p.sx + heatX, sy: originY + p.sy};
  }

  private _color(h: number): string {
    // 波峰更亮，波谷更暗，范围 #c8a050 ~ #e8c870
    const t = (h + 1.2) / 2.4; // normalize to 0-1
    const r = Math.round(0xc8 + t * (0xe8 - 0xc8));
    const g = Math.round(0xa0 + t * (0xc8 - 0xa0));
    const b = Math.round(0x50 + t * (0x70 - 0x50));
    return `rgb(${r},${g},${b})`;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const v00 = this._vertex(col, row, tileW, tileH, originX, originY);
        const v10 = this._vertex(col + 1, row, tileW, tileH, originX, originY);
        const v01 = this._vertex(col, row + 1, tileW, tileH, originX, originY);
        const v11 = this._vertex(col + 1, row + 1, tileW, tileH, originX, originY);

        const h00 = this._height(col, row);
        const h11 = this._height(col + 1, row + 1);

        // 三角形 1: (0,0) (1,0) (1,1)
        const hA = (h00 + this._height(col + 1, row) + h11) / 3;
        ctx.beginPath();
        ctx.moveTo(v00.sx, v00.sy);
        ctx.lineTo(v10.sx, v10.sy);
        ctx.lineTo(v11.sx, v11.sy);
        ctx.closePath();
        ctx.fillStyle = this._color(hA);
        ctx.fill();

        // 三角形 2: (0,0) (1,1) (0,1)
        const hB = (h00 + h11 + this._height(col, row + 1)) / 3;
        ctx.beginPath();
        ctx.moveTo(v00.sx, v00.sy);
        ctx.lineTo(v11.sx, v11.sy);
        ctx.lineTo(v01.sx, v01.sy);
        ctx.closePath();
        ctx.fillStyle = this._color(hB);
        ctx.fill();
      }
    }
  }
}
