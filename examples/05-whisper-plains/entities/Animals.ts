/**
 * Animals — 低语草原的小动物
 *
 * Bunny  — 低多边形兔子，随机漫步，停下来左右张望
 * Deer   — 低多边形鹿，缓慢游荡，受惊时快速跑开
 * Butterfly — 蝴蝶，在花朵间飞舞
 */
import {IsoObject, DrawContext} from '../../../src/elements/IsoObject';
import {AABB} from '../../../src/math/depthSort';
import {project} from '../../../src/math/IsoProjection';

// ── 工具 ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

// ── 兔子 ──────────────────────────────────────────────────────────────────

export class Bunny extends IsoObject {
  private _phase = 0;
  private _lastTs = 0;
  private _vx = 0;
  private _vy = 0;
  private _stateTimer = 0;
  private _state: 'idle' | 'walk' | 'look' = 'idle';
  private _lookDir = 1;
  private _hopPhase = 0;
  private readonly _seed: number;
  private readonly _cols: number;
  private readonly _rows: number;

  constructor(id: string, x: number, y: number, opts: {seed?: number; cols?: number; rows?: number} = {}) {
    super(id, x, y, 0);
    this._seed = opts.seed ?? Math.random();
    this._cols = opts.cols ?? 16;
    this._rows = opts.rows ?? 16;
    this.castsShadow = false;
    this._stateTimer = this._seed * 3;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.3, minY: this.position.y - 0.3,
      maxX: this.position.x + 0.3, maxY: this.position.y + 0.3,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt;
    this._stateTimer -= dt;

    if (this._stateTimer <= 0) {
      const r = Math.random();
      if (this._state === 'idle' || this._state === 'look') {
        if (r < 0.5) {
          this._state = 'walk';
          const angle = Math.random() * Math.PI * 2;
          this._vx = Math.cos(angle) * 0.8;
          this._vy = Math.sin(angle) * 0.8;
          this._stateTimer = 1.5 + Math.random() * 2;
        } else {
          this._state = r < 0.75 ? 'look' : 'idle';
          this._lookDir = Math.random() < 0.5 ? -1 : 1;
          this._vx = 0; this._vy = 0;
          this._stateTimer = 1 + Math.random() * 2;
        }
      } else {
        this._state = Math.random() < 0.4 ? 'idle' : 'look';
        this._vx = 0; this._vy = 0;
        this._stateTimer = 0.8 + Math.random() * 1.5;
      }
    }

    if (this._state === 'walk') {
      this._hopPhase += dt * 6;
      this.position.z = Math.max(0, Math.sin(this._hopPhase) * 3);
      this.position.x = clamp(this.position.x + this._vx * dt, 1, this._cols - 1);
      this.position.y = clamp(this.position.y + this._vy * dt, 1, this._rows - 1);
      // 碰边界反弹
      if (this.position.x <= 1 || this.position.x >= this._cols - 1) {this._vx *= -1;}
      if (this.position.y <= 1 || this.position.y >= this._rows - 1) {this._vy *= -1;}
    } else {
      this.position.z = 0;
    }
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y, z} = this.position;
    const {sx, sy} = project(x, y, z, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const lookSway = this._state === 'look' ? Math.sin(this._phase * 1.5) * 2 * this._lookDir : 0;
    const facingRight = this._vx >= 0;

    ctx.save();
    ctx.translate(cx, cy);
    if (!facingRight) {ctx.scale(-1, 1);}

    // 身体（低多边形椭圆，5顶点）
    ctx.beginPath();
    ctx.moveTo(0, -5); ctx.lineTo(6, -2); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.lineTo(-6, -2);
    ctx.closePath();
    ctx.fillStyle = '#e8dcc8'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 0.5; ctx.stroke();

    // 头
    ctx.save();
    ctx.translate(lookSway, -7);
    ctx.beginPath();
    ctx.moveTo(0, -4); ctx.lineTo(4, -1); ctx.lineTo(3, 3); ctx.lineTo(-3, 3); ctx.lineTo(-4, -1);
    ctx.closePath();
    ctx.fillStyle = '#ede0cc'; ctx.fill(); ctx.stroke();

    // 耳朵（两个细长三角形）
    for (const ex of [-2, 2]) {
      ctx.beginPath();
      ctx.moveTo(ex, -4); ctx.lineTo(ex - 1, -12); ctx.lineTo(ex + 1, -12);
      ctx.closePath();
      ctx.fillStyle = ex < 0 ? '#d4b8a8' : '#e8c8b8'; ctx.fill();
    }

    // 眼睛
    ctx.beginPath(); ctx.arc(2, 0, 1, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1a0a'; ctx.fill();
    // 鼻子
    ctx.beginPath(); ctx.arc(3.5, 1.5, 0.7, 0, Math.PI * 2);
    ctx.fillStyle = '#e88080'; ctx.fill();
    ctx.restore();

    // 尾巴
    ctx.beginPath(); ctx.arc(-5, 1, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f5f0e8'; ctx.fill();

    // 腿（走路时摆动）
    if (this._state === 'walk') {
      const legSwing = Math.sin(this._hopPhase) * 4;
      ctx.strokeStyle = '#c8b89a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-2, 4); ctx.lineTo(-2 + legSwing, 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, 4); ctx.lineTo(2 - legSwing, 8); ctx.stroke();
    }

    ctx.restore();
  }
}

// ── 鹿 ────────────────────────────────────────────────────────────────────

export class Deer extends IsoObject {
  private _phase = 0;
  private _lastTs = 0;
  private _vx = 0;
  private _vy = 0;
  private _stateTimer = 0;
  private _state: 'graze' | 'walk' | 'alert' = 'graze';
  private _walkPhase = 0;
  private readonly _cols: number;
  private readonly _rows: number;
  private readonly _seed: number;

  constructor(id: string, x: number, y: number, opts: {seed?: number; cols?: number; rows?: number} = {}) {
    super(id, x, y, 0);
    this._seed = opts.seed ?? Math.random();
    this._cols = opts.cols ?? 16;
    this._rows = opts.rows ?? 16;
    this.castsShadow = false;
    this._stateTimer = this._seed * 4;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.5, minY: this.position.y - 0.5,
      maxX: this.position.x + 0.5, maxY: this.position.y + 0.5,
      baseZ: 0,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt;
    this._stateTimer -= dt;

    if (this._stateTimer <= 0) {
      const r = Math.random();
      if (this._state === 'graze') {
        this._state = r < 0.6 ? 'walk' : 'alert';
        if (this._state === 'walk') {
          const a = Math.random() * Math.PI * 2;
          this._vx = Math.cos(a) * 1.2; this._vy = Math.sin(a) * 1.2;
          this._stateTimer = 2 + Math.random() * 3;
        } else { this._vx = 0; this._vy = 0; this._stateTimer = 1 + Math.random(); }
      } else {
        this._state = 'graze'; this._vx = 0; this._vy = 0;
        this._stateTimer = 2 + Math.random() * 3;
      }
    }

    if (this._state === 'walk') {
      this._walkPhase += dt * 4;
      this.position.x = clamp(this.position.x + this._vx * dt, 1.5, this._cols - 1.5);
      this.position.y = clamp(this.position.y + this._vy * dt, 1.5, this._rows - 1.5);
      if (this.position.x <= 1.5 || this.position.x >= this._cols - 1.5) {this._vx *= -1;}
      if (this.position.y <= 1.5 || this.position.y >= this._rows - 1.5) {this._vy *= -1;}
    }
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y} = this.position;
    const {sx, sy} = project(x, y, 0, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const facingRight = this._vx >= 0 || this._state !== 'walk';
    const grazeNod = this._state === 'graze' ? Math.sin(this._phase * 0.8) * 3 : 0;
    const alertLift = this._state === 'alert' ? -4 : 0;

    ctx.save();
    ctx.translate(cx, cy);
    if (!facingRight) {ctx.scale(-1, 1);}

    // 腿（4条，走路时交替摆动）
    ctx.strokeStyle = '#8a6a40'; ctx.lineWidth = 2;
    const legSwing = this._state === 'walk' ? Math.sin(this._walkPhase) * 5 : 0;
    const legPairs = [[-5, 0], [5, 0]];
    for (const [lx] of legPairs) {
      ctx.beginPath(); ctx.moveTo(lx, 6); ctx.lineTo(lx + legSwing * (lx < 0 ? 1 : -1), 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx + 2, 6); ctx.lineTo(lx + 2 - legSwing * (lx < 0 ? 1 : -1), 16); ctx.stroke();
    }

    // 身体（低多边形，6顶点）
    ctx.beginPath();
    ctx.moveTo(-10, -2); ctx.lineTo(-6, -7); ctx.lineTo(6, -7);
    ctx.lineTo(10, -2); ctx.lineTo(8, 6); ctx.lineTo(-8, 6);
    ctx.closePath();
    ctx.fillStyle = '#c8a060'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 0.5; ctx.stroke();

    // 腹部高光
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(5, 5); ctx.lineTo(-5, 5);
    ctx.closePath(); ctx.fillStyle = '#d8b878'; ctx.fill();

    // 颈部
    ctx.beginPath();
    ctx.moveTo(4, -7); ctx.lineTo(8, -14 + grazeNod + alertLift);
    ctx.lineTo(10, -14 + grazeNod + alertLift); ctx.lineTo(7, -7);
    ctx.closePath(); ctx.fillStyle = '#b89050'; ctx.fill();

    // 头
    ctx.save();
    ctx.translate(9, -16 + grazeNod + alertLift);
    ctx.beginPath();
    ctx.moveTo(0, -3); ctx.lineTo(5, 0); ctx.lineTo(7, 4); ctx.lineTo(0, 5); ctx.lineTo(-3, 2);
    ctx.closePath(); ctx.fillStyle = '#c8a060'; ctx.fill(); ctx.stroke();

    // 鹿角（alert 状态更明显）
    if (this._state !== 'graze') {
      ctx.strokeStyle = '#7a5030'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(1, -3); ctx.lineTo(-1, -9); ctx.lineTo(-4, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-1, -9); ctx.lineTo(1, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(5, -9); ctx.lineTo(8, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, -9); ctx.lineTo(3, -12); ctx.stroke();
    }

    // 眼睛
    ctx.beginPath(); ctx.arc(4, 1, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a0a00'; ctx.fill();
    ctx.beginPath(); ctx.arc(4.5, 0.5, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    ctx.restore();

    // 尾巴
    ctx.beginPath(); ctx.arc(-9, -1, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#f0e8d0'; ctx.fill();

    ctx.restore();
  }
}

// ── 蝴蝶 ──────────────────────────────────────────────────────────────────

export class Butterfly extends IsoObject {
  private _phase: number;
  private _lastTs = 0;
  private _targetX: number;
  private _targetY: number;
  private _speed: number;
  private _wingPhase = 0;
  private _color1: string;
  private _color2: string;
  private readonly _cols: number;
  private readonly _rows: number;

  constructor(id: string, x: number, y: number, opts: {seed?: number; cols?: number; rows?: number} = {}) {
    super(id, x, y, 8 + Math.random() * 6);
    const seed = opts.seed ?? Math.random();
    this._phase = seed * Math.PI * 2;
    this._cols = opts.cols ?? 16;
    this._rows = opts.rows ?? 16;
    this._targetX = x; this._targetY = y;
    this._speed = 1.5 + seed * 1.5;
    const palettes: Array<[string, string]> = [
      ['#ff8c42', '#fff0a0'], ['#c084fc', '#f0d0ff'],
      ['#38bdf8', '#e0f8ff'], ['#f472b6', '#ffe0f0'],
      ['#4ade80', '#d0ffe0'],
    ];
    [this._color1, this._color2] = palettes[Math.floor(seed * palettes.length)];
    this.castsShadow = false;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.2, minY: this.position.y - 0.2,
      maxX: this.position.x + 0.2, maxY: this.position.y + 0.2,
      baseZ: this.position.z,
    };
  }

  update(ts?: number): void {
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;
    this._phase += dt * 0.4;
    this._wingPhase += dt * 8;

    // 飘向目标，到达后选新目标
    const dx = this._targetX - this.position.x;
    const dy = this._targetY - this.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.3) {
      this._targetX = 1.5 + Math.random() * (this._cols - 3);
      this._targetY = 1.5 + Math.random() * (this._rows - 3);
    } else {
      this.position.x += (dx / dist) * this._speed * dt;
      this.position.y += (dy / dist) * this._speed * dt;
    }
    // 上下飘动
    this.position.z = 8 + Math.sin(this._phase * 2.3) * 4;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y, z} = this.position;
    const {sx, sy} = project(x, y, z, tileW, tileH);
    const cx = originX + sx, cy = originY + sy;
    const wingOpen = Math.abs(Math.sin(this._wingPhase));

    ctx.save();
    ctx.translate(cx, cy);

    // 翅膀（4片低多边形，上下各2片）
    const ww = 8 * wingOpen, wh = 6;
    for (const side of [-1, 1]) {
      // 上翅
      ctx.beginPath();
      ctx.moveTo(0, -1); ctx.lineTo(side * ww, -wh); ctx.lineTo(side * ww * 0.6, 1);
      ctx.closePath();
      ctx.fillStyle = this._color1;
      ctx.globalAlpha = 0.85; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.5; ctx.stroke();

      // 下翅（稍小）
      ctx.beginPath();
      ctx.moveTo(0, 1); ctx.lineTo(side * ww * 0.8, wh * 0.7); ctx.lineTo(side * ww * 0.3, 3);
      ctx.closePath();
      ctx.fillStyle = this._color2;
      ctx.globalAlpha = 0.75; ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 身体（细长椭圆）
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.2, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1a0a'; ctx.fill();

    // 触角
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-0.5, -4); ctx.lineTo(-3, -9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0.5, -4); ctx.lineTo(3, -9); ctx.stroke();
    ctx.beginPath(); ctx.arc(-3, -9, 1, 0, Math.PI * 2); ctx.fillStyle = this._color1; ctx.fill();
    ctx.beginPath(); ctx.arc(3, -9, 1, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }
}
