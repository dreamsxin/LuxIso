/**
 * LakeScene — 幻梦之湖场景（精细版）
 *
 * - 多层波浪：深水 + 浅水 + 水面高光
 * - 水面漂浮光粒子
 * - 低多边形石头（带高光面）
 * - 水草（贝塞尔曲线，颜色渐变）
 * - 荷叶（带阴影 + 露珠）
 * - 水雾效果
 */
import { IsoObject, DrawContext } from '../../../src/elements/IsoObject';
import { AABB } from '../../../src/math/depthSort';
import { project } from '../../../src/math/IsoProjection';
import { Scene } from '../../../src/core/Scene';
import { TileCollider } from '../../../src/physics/TileCollider';
import { DirectionalLight } from '../../../src/lighting/DirectionalLight';
import { OmniLight } from '../../../src/lighting/OmniLight';
import { Portal } from '../entities/Portal';
import { FishSchool, WaterLilyFlower } from '../entities/AquaticLife';

export const LAKE_PORTAL_X = 9;
export const LAKE_PORTAL_Y = 9;

/** Where main.ts lands the hero on entry; the collider keeps this tile clear. */
export const LAKE_SPAWN_X = 3.5;
export const LAKE_SPAWN_Y = 3.5;


// ── 波浪湖面 ───────────────────────────────────────────────────────────────

export class WaveLake extends IsoObject {
  readonly cols: number;
  readonly rows: number;
  private _time = 0;
  private _lastTs = 0;

  private _glints: Array<{ x: number; y: number; phase: number; size: number; speed: number }> = [];

  // 水纹：角色游动时产生的扩散圆环
  private _ripples: Array<{
    x: number; y: number;
    r: number;       // 当前半径（世界单位）
    maxR: number;    // 最大半径
    alpha: number;   // 当前透明度
    speed: number;   // 扩散速度
  }> = [];

  constructor(id: string, cols: number, rows: number) {
    super(id, 0, 0, 0);
    this.cols = cols;
    this.rows = rows;
    this.castsShadow = false;

    // 初始化水面光粒子
    for (let i = 0; i < 20; i++) {
      this._glints.push({
        x: Math.random() * cols,
        y: Math.random() * rows,
        phase: Math.random() * Math.PI * 2,
        size: 1 + Math.random() * 2.5,
        speed: 0.8 + Math.random() * 1.2,
      });
    }
  }

  get aabb(): AABB {
    return { minX: 0, minY: 0, maxX: this.cols, maxY: this.rows, baseZ: -10 };
  }

  /** 在世界坐标 (x, y) 处生成一个水纹 */
  addRipple(x: number, y: number): void {
    this._ripples.push({ x, y, r: 0.1, maxR: 1.4, alpha: 0.7, speed: 1.8 });
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._time += dt;

    for (const g of this._glints) g.phase += dt * g.speed;

    // 更新水纹
    for (const rp of this._ripples) {
      rp.r += dt * rp.speed;
      rp.alpha = Math.max(0, rp.alpha - dt * 1.1);
    }
    this._ripples = this._ripples.filter(rp => rp.alpha > 0.01);
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const t = this._time;

    // ── 波浪面 ──────────────────────────────────────────────────────────────
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const h00 = this._wave(col,     row,     t);
        const h10 = this._wave(col + 1, row,     t);
        const h11 = this._wave(col + 1, row + 1, t);
        const h01 = this._wave(col,     row + 1, t);

        const p00 = project(col,     row,     h00, tileW, tileH);
        const p10 = project(col + 1, row,     h10, tileW, tileH);
        const p11 = project(col + 1, row + 1, h11, tileW, tileH);
        const p01 = project(col,     row + 1, h01, tileW, tileH);

        const x00 = originX + p00.sx, y00 = originY + p00.sy;
        const x10 = originX + p10.sx, y10 = originY + p10.sy;
        const x11 = originX + p11.sx, y11 = originY + p11.sy;
        const x01 = originX + p01.sx, y01 = originY + p01.sy;

        const avgH = (h00 + h10 + h11 + h01) / 4;
        // 多层颜色：深水蓝 → 浅水青
        const depth = 0.42 + (avgH / 9) * 0.28;
        const r = Math.round(15  + depth * 25);
        const g = Math.round(55  + depth * 60);
        const b = Math.round(140 + depth * 55);

        ctx.beginPath();
        ctx.moveTo(x00, y00);
        ctx.lineTo(x10, y10);
        ctx.lineTo(x11, y11);
        ctx.lineTo(x01, y01);
        ctx.closePath();
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fill();

        // 波峰高光线
        if (avgH > 3.5) {
          ctx.strokeStyle = `rgba(160,220,255,${(avgH - 3.5) / 5 * 0.25})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }

    // ── 水面高光反射（screen blend） ─────────────────────────────────────────
    for (const g of this._glints) {
      const h = this._wave(g.x, g.y, t);
      const { sx, sy } = project(g.x, g.y, h, tileW, tileH);
      const gx = originX + sx;
      const gy = originY + sy;
      const brightness = 0.4 + Math.sin(g.phase) * 0.35;
      if (brightness < 0.1) continue;

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, g.size * 4);
      gr.addColorStop(0,   `rgba(200,240,255,${brightness * 0.7})`);
      gr.addColorStop(0.4, `rgba(140,200,255,${brightness * 0.3})`);
      gr.addColorStop(1,   'rgba(80,160,255,0)');
      ctx.beginPath();
      ctx.arc(gx, gy, g.size * 4, 0, Math.PI * 2);
      ctx.fillStyle = gr;
      ctx.fill();
      ctx.restore();
    }

    // ── 水雾（边缘渐变） ──────────────────────────────────────────────────────
    const fogGrad = ctx.createLinearGradient(
      originX, originY - tileH * this.rows * 0.6,
      originX, originY + tileH * this.rows * 0.4,
    );
    fogGrad.addColorStop(0, 'rgba(30,60,120,0)');
    fogGrad.addColorStop(0.7, 'rgba(30,60,120,0.08)');
    fogGrad.addColorStop(1, 'rgba(30,60,120,0.22)');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(
      originX - tileW * this.cols,
      originY - tileH * this.rows,
      tileW * this.cols * 2,
      tileH * this.rows * 2,
    );

    // ── 水纹（角色游动产生的扩散椭圆环） ─────────────────────────────────────
    const scaleY = tileH / tileW;
    for (const rp of this._ripples) {
      const h = this._wave(rp.x, rp.y, t);
      const { sx, sy } = project(rp.x, rp.y, h, tileW, tileH);
      const rx = originX + sx;
      const ry = originY + sy;
      const screenR = rp.r * (tileW / 2);

      ctx.save();
      ctx.translate(rx, ry);
      ctx.scale(1, scaleY);

      // 外环（主水纹）
      ctx.beginPath();
      ctx.arc(0, 0, screenR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(160,220,255,${(rp.alpha * 0.7).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 内环（次级水纹，稍小）
      if (rp.r > 0.3) {
        ctx.beginPath();
        ctx.arc(0, 0, screenR * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(200,240,255,${(rp.alpha * 0.35).toFixed(2)})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // 中心高光点
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,250,255,${(rp.alpha * 0.5).toFixed(2)})`;
      ctx.fill();

      ctx.restore();
    }
  }

  private _wave(col: number, row: number, t: number): number {
    return (
      Math.sin(col * 0.75 + t * 1.6) * 3.2 +
      Math.cos(row * 0.65 + t * 1.3) * 2.8 +
      Math.sin((col + row) * 0.45 + t * 2.0) * 1.8 +
      Math.cos((col - row) * 0.3  + t * 2.8) * 0.8
    );
  }
}

// ── 湖底石头 ───────────────────────────────────────────────────────────────

export class LakeRock extends IsoObject {
  private _color: string;
  private _size: number;
  private _seed: number;

  constructor(id: string, x: number, y: number, opts: { color?: string; size?: number; seed?: number } = {}) {
    super(id, x, y, 0);
    this._color = opts.color ?? '#3a4a5c';
    this._size  = opts.size  ?? 1;
    this._seed  = opts.seed  ?? 0.5;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    const r = 0.3 * this._size;
    return { minX: this.position.x - r, minY: this.position.y - r, maxX: this.position.x + r, maxY: this.position.y + r, baseZ: 0 };
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y } = this.position;
    const { sx, sy } = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const s = this._size;
    const seed = this._seed;

    ctx.save();
    ctx.translate(cx, cy);

    // 不规则多边形（用 seed 固定形状）
    const VERTS = 6 + Math.floor(seed * 3);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < VERTS; i++) {
      const a = (i / VERTS) * Math.PI * 2 - Math.PI / 2;
      const r = (6 + Math.sin(seed * 17.3 + i * 2.1) * 2.5) * s;
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.52]);
    }

    // 主体（深色）
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < VERTS; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = this._color;
    ctx.fill();

    // 水下反光边缘
    ctx.strokeStyle = 'rgba(80,160,220,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 高光面（顶部）
    const topIdx = pts.reduce((b, p, i) => p[1] < pts[b][1] ? i : b, 0);
    const p0 = pts[topIdx];
    const p1 = pts[(topIdx + 1) % VERTS];
    const p2 = pts[(topIdx - 1 + VERTS) % VERTS];
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(120,180,220,0.2)';
    ctx.fill();

    ctx.restore();
  }
}

// ── 水草 ───────────────────────────────────────────────────────────────────

export class WaterGrass extends IsoObject {
  private _phase: number;
  private _height: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, seed = 0) {
    super(id, x, y, 0);
    this._phase  = seed * Math.PI * 2;
    this._height = 14 + seed * 8;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return { minX: this.position.x - 0.12, minY: this.position.y - 0.12, maxX: this.position.x + 0.12, maxY: this.position.y + 0.12, baseZ: 0 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 1.0;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y } = this.position;
    const { sx, sy } = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const sway = Math.sin(this._phase) * 3.5;
    const h = this._height;

    ctx.save();
    ctx.translate(cx, cy);

    const blades = [
      { ox: -2.5, hMult: 0.85, color: '#1a6a50' },
      { ox:  0.5, hMult: 1.0,  color: '#2a8a68' },
      { ox:  3.0, hMult: 0.75, color: '#1a6a50' },
    ];

    for (const b of blades) {
      const bh = h * b.hMult;
      const tipX = b.ox + sway;
      const tipY = -bh;
      const ctrlX = b.ox + sway * 0.55;
      const ctrlY = -bh * 0.5;

      ctx.beginPath();
      ctx.moveTo(b.ox - 1.5, 0);
      ctx.quadraticCurveTo(ctrlX - 1, ctrlY, tipX - 0.5, tipY);
      ctx.lineTo(tipX + 0.5, tipY);
      ctx.quadraticCurveTo(ctrlX + 1, ctrlY, b.ox + 1.5, 0);
      ctx.closePath();

      const grad = ctx.createLinearGradient(b.ox, 0, tipX, tipY);
      grad.addColorStop(0, '#0d4a38');
      grad.addColorStop(0.5, b.color);
      grad.addColorStop(1, '#4abf90');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.restore();
  }
}

// ── 荷叶 ───────────────────────────────────────────────────────────────────

export class LilyPad extends IsoObject {
  private _phase: number;
  private _size: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, seed = 0) {
    super(id, x, y, 2);
    this._phase = seed * Math.PI * 2;
    this._size  = 10 + seed * 4;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return { minX: this.position.x - 0.4, minY: this.position.y - 0.4, maxX: this.position.x + 0.4, maxY: this.position.y + 0.4, baseZ: 2 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.5;
    this.position.z = 2 + Math.sin(this._phase) * 1.8;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y, z } = this.position;
    const { sx, sy } = project(x, y, z, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const r = this._size;

    ctx.save();
    ctx.translate(cx, cy);

    // 荷叶阴影
    ctx.save();
    ctx.scale(1, 0.28);
    const sg = ctx.createRadialGradient(0, 2, 0, 0, 2, r * 1.1);
    sg.addColorStop(0, 'rgba(0,0,0,0.18)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 2, r * 1.1, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();

    // 荷叶主体（低多边形，8边形近似圆，带缺口）
    ctx.save();
    ctx.scale(1, 0.48);
    const SIDES = 8;
    ctx.beginPath();
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 - Math.PI * 0.12;
      if (i === 0) ctx.moveTo(0, 0);
      else if (i === 1) {
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      } else {
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    ctx.lineTo(0, 0);
    ctx.closePath();

    // 荷叶渐变（边缘深，中心亮）
    const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    lg.addColorStop(0,   '#3aaa50');
    lg.addColorStop(0.6, '#2a8a3e');
    lg.addColorStop(1,   '#1a6a2e');
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    // 叶脉（放射线）
    ctx.save();
    ctx.scale(1, 0.48);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 1.75 + 0.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      ctx.stroke();
    }
    ctx.restore();

    // 露珠（2颗）
    const drops = [{ x: r * 0.3, y: -r * 0.15, r: 2.2 }, { x: -r * 0.15, y: r * 0.1, r: 1.5 }];
    for (const d of drops) {
      const dy = d.y * 0.48;
      ctx.beginPath();
      ctx.arc(d.x, dy, d.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(180,235,255,0.85)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.x - d.r * 0.3, dy - d.r * 0.3, d.r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
    }

    ctx.restore();
  }
}

// ── 水面漂浮荷花（装饰） ───────────────────────────────────────────────────

export class LotusFlower extends IsoObject {
  private _phase: number;
  private _lastTs = 0;

  constructor(id: string, x: number, y: number, seed = 0) {
    super(id, x, y, 4);
    this._phase = seed * Math.PI * 2;
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return { minX: this.position.x - 0.3, minY: this.position.y - 0.3, maxX: this.position.x + 0.3, maxY: this.position.y + 0.3, baseZ: 4 };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.4;
    this.position.z = 4 + Math.sin(this._phase) * 1.5;
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY } = dc;
    const { x, y, z } = this.position;
    const { sx, sy } = project(x, y, z, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;

    ctx.save();
    ctx.translate(cx, cy);

    // 花瓣（3层，从外到内）
    const layers = [
      { n: 8, r: 9,  len: 7,  color: '#ffb8d0', alpha: 0.9 },
      { n: 6, r: 6,  len: 6,  color: '#ffd0e0', alpha: 0.95 },
      { n: 5, r: 3.5,len: 5,  color: '#fff0f5', alpha: 1.0 },
    ];

    for (const [li, layer] of layers.entries()) {
      const rot = this._phase * (li % 2 === 0 ? 0.1 : -0.08) + li * 0.3;
      for (let i = 0; i < layer.n; i++) {
        const a = (i / layer.n) * Math.PI * 2 + rot;
        const px = Math.cos(a) * layer.r;
        const py = Math.sin(a) * layer.r * 0.5;
        const tx = Math.cos(a) * (layer.r + layer.len);
        const ty = Math.sin(a) * (layer.r + layer.len) * 0.5;

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(px - Math.sin(a) * 2, py + Math.cos(a) * 1);
        ctx.lineTo(tx, ty);
        ctx.lineTo(px + Math.sin(a) * 2, py - Math.cos(a) * 1);
        ctx.closePath();

        const pg = ctx.createLinearGradient(0, 0, tx, ty);
        pg.addColorStop(0, `rgba(255,180,200,${layer.alpha})`);
        pg.addColorStop(1, layer.color);
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,150,180,0.2)';
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }
    }

    // 花心
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff9c4';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();

    ctx.restore();
  }
}

// ── 构建湖水场景 ───────────────────────────────────────────────────────────

export function buildLakeScene(cols: number, rows: number): { scene: Scene; lake: WaveLake; portal: Portal; collider: TileCollider } {
  const scene = new Scene({ tileW: 64, tileH: 32, cols, rows });

  // ── 碰撞地图 ──────────────────────────────────────────────────────────────
  // 石头是实体障碍，此前湖水场景没有 collider，角色会直接穿过它们。
  // 水草/荷叶/荷花是软性装饰，保持可走。
  const collider = new TileCollider(cols, rows);
  scene.collider = collider;

  const lake = new WaveLake('lake', cols, rows);
  scene.addObject(lake);


  scene.addLight(new DirectionalLight({ angle: 225, elevation: 42, color: '#90c0ff', intensity: 0.85 }));
  scene.addLight(new OmniLight({ x: cols / 2, y: rows / 2, z: 80, color: '#3870c0', intensity: 0.55, radius: 600 }));
  // 月光补光（冷白）
  scene.addLight(new OmniLight({ x: cols * 0.3, y: rows * 0.3, z: 200, color: '#c0d8ff', intensity: 0.3, radius: 800 }));

  // 石头
  const rocks = [
    [2,3,0.8,'#3a4a5c',0.2],[5,2,1.1,'#2d3a4c',0.6],[8,4,0.7,'#4a5a6c',0.4],
    [3,7,0.9,'#3a4a5c',0.8],[7,6,1.0,'#2d3a4c',0.1],[1,5,0.6,'#4a5a6c',0.5],
    [9,8,0.8,'#3a4a5c',0.3],[4,9,1.2,'#2d3a4c',0.7],[6,1,0.7,'#4a5a6c',0.9],
    [10,3,0.9,'#3a4a5c',0.4],[11,7,0.6,'#2d3a4c',0.2],[2,10,1.0,'#4a5a6c',0.6],
  ];
  for (const [i, [rx,ry,sz,col,seed]] of rocks.entries()) {
    scene.addObject(new LakeRock(`rock-${i}`, rx as number, ry as number, { color: col as string, size: sz as number, seed: seed as number }));
    collider.setWalkable(Math.floor(rx as number), Math.floor(ry as number), false);
  }


  // 水草
  const grasses = [
    [1.5,2.5],[4.5,1.5],[7.5,3.5],[2.5,6.5],
    [8.5,5.5],[5.5,8.5],[10.5,2.5],[3.5,9.5],
    [0.5,4.5],[6.5,0.5],[9.5,7.5],[11.5,4.5],
  ];
  for (const [i,[gx,gy]] of grasses.entries()) {
    scene.addObject(new WaterGrass(`wgrass-${i}`, gx as number, gy as number, i * 0.65));
  }

  // 荷叶
  const pads = [[3,4],[6,3],[5,6],[8,7],[2,8],[9,5],[4,11],[7,10],[11,9],[1,10]];
  for (const [i,[px,py]] of pads.entries()) {
    scene.addObject(new LilyPad(`pad-${i}`, px as number, py as number, i * 0.48));
  }

  // 荷花
  const lotuses = [[4,5],[7,4],[6,8],[9,6],[3,9]];
  for (const [i,[lx,ly]] of lotuses.entries()) {
    scene.addObject(new LotusFlower(`lotus-${i}`, lx as number, ly as number, i * 0.6));
  }

  // 深海传送门
  const portal = new Portal('lake-portal', LAKE_PORTAL_X, LAKE_PORTAL_Y);
  scene.addObject(portal);
  scene.addLight(new OmniLight({ id: 'portal-glow', x: LAKE_PORTAL_X, y: LAKE_PORTAL_Y, z: 50, color: '#a060ff', intensity: 0.5, radius: 280 }));

  // ── 鱼群 ──────────────────────────────────────────────────────────────────
  const fishGroups: Array<[number, number, string, string, number, number]> = [
    [3.5, 3.5, '#f97316', '#fbbf24', 6, 0.1],
    [8.5, 5.5, '#38bdf8', '#7dd3fc', 5, 0.4],
    [5.5, 9.5, '#f472b6', '#fda4af', 7, 0.7],
    [10.5, 7.5, '#4ade80', '#86efac', 4, 0.55],
    [2.5, 7.5, '#c084fc', '#e9d5ff', 5, 0.25],
  ];
  for (const [i, [fx, fy, color, accent, count, seed]] of fishGroups.entries()) {
    scene.addObject(new FishSchool(`fish-${i}`, fx, fy, { count, color, accentColor: accent, cols, rows, seed }));
  }

  // ── 荷花（升级版，带开放/花苞状态） ──────────────────────────────────────
  const lilyPositions: Array<[number, number, number, number]> = [
    [2.5, 4.5, 0.1, 1.0], [5.5, 3.5, 0.3, 0.6], [7.5, 5.5, 0.5, 1.0],
    [4.5, 7.5, 0.7, 0.4], [9.5, 4.5, 0.2, 1.0], [3.5, 10.5, 0.8, 0.7],
    [8.5, 10.5, 0.45, 1.0], [11.5, 6.5, 0.6, 0.5], [6.5, 11.5, 0.15, 1.0],
    [1.5, 8.5, 0.9, 0.3],
  ];
  for (const [i, [lx, ly, seed, open]] of lilyPositions.entries()) {
    if (Math.hypot(lx - LAKE_PORTAL_X, ly - LAKE_PORTAL_Y) < 2) continue;
    scene.addObject(new WaterLilyFlower(`lily-${i}`, lx, ly, { seed, open }));
  }

  // 出生点与传送门格必须可走，否则角色会被 resolveMove 卡死在障碍里。
  collider.setWalkable(Math.floor(LAKE_SPAWN_X), Math.floor(LAKE_SPAWN_Y), true);
  collider.setWalkable(LAKE_PORTAL_X, LAKE_PORTAL_Y, true);

  return { scene, lake, portal, collider };
}

