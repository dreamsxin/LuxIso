/**
 * VoxelLake — 由数百个小立方体组成的动态湖面
 *
 * 每个立方体独立做正弦波运动，相邻立方体相位差形成波浪扩散效果。
 * 立方体使用半透明蓝色材质，边缘高光，内部自发光。
 */
import { IsoObject, DrawContext } from '../../src/elements/IsoObject';
import { AABB } from '../../src/math/depthSort';
import { project } from '../../src/math/IsoProjection';

export interface VoxelLakeOptions {
  cols: number;          // 湖面列数（世界单位）
  rows: number;          // 湖面行数（世界单位）
  voxelSize: number;     // 每个立方体边长（世界单位，如 0.25）
  waveSpeed: number;     // 波速
  amplitude: number;     // 最大振幅（世界单位）
  waveLength: number;    // 波长
  opacity: number;       // 整体透明度 0–1
}

interface Voxel {
  gx: number;   // 网格列
  gy: number;   // 网格行
  wx: number;   // 世界 x
  wy: number;   // 世界 y
  phase: number; // 初始相位偏移
  speedJitter: number; // 速度微扰
  distFromCenter: number; // 距湖心距离（0–1）
}

export class VoxelLake extends IsoObject {
  private _voxels: Voxel[] = [];
  private _time = 0;
  private _lastTs = 0;

  readonly cols: number;
  readonly rows: number;
  readonly voxelSize: number;

  waveSpeed: number;
  amplitude: number;
  waveLength: number;
  opacity: number;

  constructor(id: string, x: number, y: number, opts: VoxelLakeOptions) {
    super(id, x, y, 0);
    this.cols       = opts.cols;
    this.rows       = opts.rows;
    this.voxelSize  = opts.voxelSize;
    this.waveSpeed  = opts.waveSpeed;
    this.amplitude  = opts.amplitude;
    this.waveLength = opts.waveLength;
    this.opacity    = opts.opacity;
    this.castsShadow = false;

    const cx = x + this.cols / 2;
    const cy = y + this.rows / 2;
    const maxDist = Math.hypot(this.cols / 2, this.rows / 2);
    const step = opts.voxelSize;

    for (let gy = 0; gy < this.rows / step; gy++) {
      for (let gx = 0; gx < this.cols / step; gx++) {
        const wx = x + gx * step + step / 2;
        const wy = y + gy * step + step / 2;
        const dist = Math.hypot(wx - cx, wy - cy) / maxDist;
        this._voxels.push({
          gx, gy, wx, wy,
          phase: (gx * 0.31 + gy * 0.47) * Math.PI * 2,
          speedJitter: 0.85 + Math.random() * 0.3,
          distFromCenter: dist,
        });
      }
    }
  }

  get aabb(): AABB {
    return {
      minX: this.position.x,
      minY: this.position.y,
      maxX: this.position.x + this.cols,
      maxY: this.position.y + this.rows,
      baseZ: -8,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._time += dt;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const t = this._time;
    const s = this.voxelSize;
    const halfS = s / 2;

    for (const v of this._voxels) {
      // 波高：距湖心越近振幅越大，相位差形成扩散波
      const wave = Math.sin(
        t * this.waveSpeed * v.speedJitter
        - (v.wx + v.wy) / this.waveLength
        + v.phase
      );
      const ampScale = 0.3 + (1 - v.distFromCenter) * 0.7;
      const wz = wave * this.amplitude * ampScale;

      // 立方体高度（固定 + 波动）
      const cubeH = s * 0.6 + Math.max(0, wz) * 0.4;

      this._drawVoxel(ctx, tileW, tileH, originX, originY, v.wx, v.wy, wz, halfS, cubeH, wave);
    }
  }

  private _drawVoxel(
    ctx: CanvasRenderingContext2D,
    tileW: number, tileH: number,
    originX: number, originY: number,
    wx: number, wy: number,
    wz: number,
    halfS: number, cubeH: number,
    wave: number,
  ): void {
    const op = this.opacity;


    // 立方体 8 个顶点的世界坐标 → 屏幕坐标
    // 底面 z = wz - cubeH，顶面 z = wz
    const zTop = wz;
    const zBot = wz - cubeH;

    // 顶面 4 顶点
    const tl = project(wx - halfS, wy - halfS, zTop, tileW, tileH);
    const tr = project(wx + halfS, wy - halfS, zTop, tileW, tileH);
    const br = project(wx + halfS, wy + halfS, zTop, tileW, tileH);
    const bl = project(wx - halfS, wy + halfS, zTop, tileW, tileH);

    // 底面对应顶点（只需左、右、前）
    const blB = project(wx - halfS, wy + halfS, zBot, tileW, tileH);
    const brB = project(wx + halfS, wy + halfS, zBot, tileW, tileH);
    const trB = project(wx + halfS, wy - halfS, zBot, tileW, tileH);

    const ox = originX, oy = originY;

    // 波动亮度：波峰更亮，波谷更暗
    const brightness = 0.5 + wave * 0.25;
    const r = Math.round(20  + brightness * 40);
    const g = Math.round(80  + brightness * 80);
    const b = Math.round(160 + brightness * 60);

    // ── 左侧面（暗） ──────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(ox + tl.sx, oy + tl.sy);
    ctx.lineTo(ox + bl.sx, oy + bl.sy);
    ctx.lineTo(ox + blB.sx, oy + blB.sy);
    ctx.lineTo(ox + tl.sx, oy + tl.sy - (zTop - zBot) * 0); // 近似
    ctx.closePath();
    // 重新用正确顶点
    ctx.beginPath();
    ctx.moveTo(ox + tl.sx, oy + tl.sy);
    ctx.lineTo(ox + bl.sx, oy + bl.sy);
    ctx.lineTo(ox + blB.sx, oy + blB.sy);
    // 左侧底面对应 tl 的底点
    const tlB = project(wx - halfS, wy - halfS, zBot, tileW, tileH);
    ctx.lineTo(ox + tlB.sx, oy + tlB.sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(${Math.round(r*0.6)},${Math.round(g*0.6)},${Math.round(b*0.75)},${(op * 0.7).toFixed(2)})`;
    ctx.fill();

    // ── 右侧面（中亮） ────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(ox + tr.sx, oy + tr.sy);
    ctx.lineTo(ox + br.sx, oy + br.sy);
    ctx.lineTo(ox + brB.sx, oy + brB.sy);
    ctx.lineTo(ox + trB.sx, oy + trB.sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(${Math.round(r*0.75)},${Math.round(g*0.75)},${Math.round(b*0.85)},${(op * 0.75).toFixed(2)})`;
    ctx.fill();

    // ── 顶面（最亮，带高光） ──────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(ox + tl.sx, oy + tl.sy);
    ctx.lineTo(ox + tr.sx, oy + tr.sy);
    ctx.lineTo(ox + br.sx, oy + br.sy);
    ctx.lineTo(ox + bl.sx, oy + bl.sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(${r},${g},${b},${op.toFixed(2)})`;
    ctx.fill();

    // 顶面高光（screen blend）
    if (wave > 0.3) {
      const hlAlpha = (wave - 0.3) / 0.7 * 0.35 * op;
      ctx.fillStyle = `rgba(180,230,255,${hlAlpha.toFixed(3)})`;
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

    // 顶面边缘线（微弱高光）
    ctx.beginPath();
    ctx.moveTo(ox + tl.sx, oy + tl.sy);
    ctx.lineTo(ox + tr.sx, oy + tr.sy);
    ctx.lineTo(ox + br.sx, oy + br.sy);
    ctx.lineTo(ox + bl.sx, oy + bl.sy);
    ctx.closePath();
    ctx.strokeStyle = `rgba(120,200,255,${(op * 0.25).toFixed(2)})`;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
}
