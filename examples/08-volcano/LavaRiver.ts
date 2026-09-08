/**
 * LavaRiver — 熔岩河流（发光橙色立方体，正弦波动）
 */
import { IsoObject, DrawContext } from '../../src/elements/IsoObject';
import { AABB } from '../../src/math/depthSort';
import { project } from '../../src/math/IsoProjection';

// 预定义熔岩格子坐标（蜿蜒穿越场景中部）
const LAVA_TILES: Array<[number, number]> = [
  [1,6],[2,6],[3,6],[3,7],[4,7],[4,8],[5,8],[5,9],
  [6,9],[6,8],[7,8],[7,7],[8,7],[8,8],[9,8],[9,9],
  [10,9],[10,8],[11,8],[11,7],[12,7],[12,6],[13,6],
  [6,10],[7,10],[8,10],[7,11],
];

interface LavaVoxel {
  wx: number;
  wy: number;
  phase: number;
}

export class LavaRiver extends IsoObject {
  waveSpeed  = 3;
  amplitude  = 0.25;

  private _voxels: LavaVoxel[] = [];
  private _tileSet: Set<string> = new Set();
  private _time = 0;
  private _lastTs = 0;

  constructor(id: string) {
    super(id, 0, 0, 0);
    this.castsShadow = false;
    this.isGroundLayer = true;   // full-map lava overlay → drawn above RockLayer, below topoSort objects

    for (const [wx, wy] of LAVA_TILES) {
      this._voxels.push({ wx, wy, phase: (wx * 0.37 + wy * 0.53) * Math.PI * 2 });
      this._tileSet.add(`${wx},${wy}`);
    }
  }

  get aabb(): AABB {
    return { minX: 0, minY: 0, maxX: 14, maxY: 14, baseZ: 0, maxZ: 0.6 };
  }

  isLava(wx: number, wy: number): boolean {
    return this._tileSet.has(`${Math.floor(wx)},${Math.floor(wy)}`);
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt  = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._time  += dt;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const t = this._time;

    for (const v of this._voxels) {
      const wave       = Math.sin(t * this.waveSpeed + v.phase);
      const brightness = 0.6 + wave * 0.4;
      const wz         = 0.3 + (wave * 0.5 + 0.5) * this.amplitude;
      const s          = 0.9;


      // 颜色：#ff4400 ~ #ff8800
      const rr = 255;
      const gg = Math.round((0x44 + (0x88 - 0x44) * brightness));
      const bb = 0;

      const zTop = wz;
      const zBot = 0;

      const tl  = project(v.wx,        v.wy,        zTop, tileW, tileH);
      const tr  = project(v.wx + s,    v.wy,        zTop, tileW, tileH);
      const br  = project(v.wx + s,    v.wy + s,    zTop, tileW, tileH);
      const bl  = project(v.wx,        v.wy + s,    zTop, tileW, tileH);
      const tlB = project(v.wx,        v.wy,        zBot, tileW, tileH);
      const blB = project(v.wx,        v.wy + s,    zBot, tileW, tileH);
      const brB = project(v.wx + s,    v.wy + s,    zBot, tileW, tileH);
      const trB = project(v.wx + s,    v.wy,        zBot, tileW, tileH);

      const ox = originX, oy = originY;

      // 左侧面（暗）
      ctx.beginPath();
      ctx.moveTo(ox + tl.sx, oy + tl.sy);
      ctx.lineTo(ox + bl.sx, oy + bl.sy);
      ctx.lineTo(ox + blB.sx, oy + blB.sy);
      ctx.lineTo(ox + tlB.sx, oy + tlB.sy);
      ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(rr*0.55)},${Math.round(gg*0.4)},0)`;
      ctx.fill();

      // 右侧面（中亮）
      ctx.beginPath();
      ctx.moveTo(ox + tr.sx, oy + tr.sy);
      ctx.lineTo(ox + br.sx, oy + br.sy);
      ctx.lineTo(ox + brB.sx, oy + brB.sy);
      ctx.lineTo(ox + trB.sx, oy + trB.sy);
      ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(rr*0.7)},${Math.round(gg*0.55)},0)`;
      ctx.fill();

      // 顶面
      ctx.beginPath();
      ctx.moveTo(ox + tl.sx, oy + tl.sy);
      ctx.lineTo(ox + tr.sx, oy + tr.sy);
      ctx.lineTo(ox + br.sx, oy + br.sy);
      ctx.lineTo(ox + bl.sx, oy + bl.sy);
      ctx.closePath();
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fill();

      // 顶面高光（screen blend）
      if (wave > 0.2) {
        const hlAlpha = (wave - 0.2) / 0.8 * 0.45;
        ctx.fillStyle = `rgba(255,200,80,${hlAlpha.toFixed(3)})`;
        ctx.globalCompositeOperation = 'screen';
        ctx.beginPath();
        ctx.moveTo(ox + tl.sx, oy + tl.sy);
        ctx.lineTo(ox + tr.sx, oy + tr.sy);
        ctx.lineTo(ox + br.sx, oy + br.sy);
        ctx.lineTo(ox + bl.sx, oy + bl.sy);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}
