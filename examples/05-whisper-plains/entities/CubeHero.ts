/**
 * CubeHero — 钻石守护者
 *
 * 造型：低多边形钻石（上冠 + 腰棱 + 下亭）
 * 装饰：内部旋转光芒 + 外圈折射光点
 * 动画：移动时上下浮动 + 方向倾斜 + 慢速自转
 */
import { Entity } from '../../../src/ecs/Entity';
import { DrawContext } from '../../../src/elements/IsoObject';
import { AABB } from '../../../src/math/depthSort';
import { project } from '../../../src/math/IsoProjection';
import { DirectionalLight } from '../../../src/lighting/DirectionalLight';

export class CubeHero extends Entity {
  velX = 0;
  velY = 0;

  /** 0–1，接近传送阵时由外部设置，影响钻石发光强度 */
  portalProximity = 0;

  /** 飞升动画进度，0=未激活，>0=飞升中 */
  private _ascendProgress = 0;
  private _ascendActive   = false;
  private _ascendDuration = 1.2; // 秒
  private _descendMode    = false; // true=降落模式
  private _descendStartZ  = 210;   // 降落起始 z（与光柱高度匹配）

  private _bobPhase   = 0;
  private _tiltX      = 0;
  private _tiltY      = 0;
  private _spinAngle  = 0;
  private _glintAngle = 0;
  private _lastTs     = 0;
  private _teleportFlash = 0;
  /** 入场动画：从高空落下，0=开始，1=完成 */
  private _entryProgress = 0;
  private _entryActive   = false;

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    // CubeHero draws its own shadow blob in draw(); skip ShadowCaster
    this.castsShadow = false;
  }

  triggerTeleportFlash(): void {
    this._teleportFlash = 1;
  }

  /** 触发飞升动画，返回 Promise，动画结束后 resolve */
  triggerAscend(): Promise<void> {
    this._ascendActive   = true;
    this._ascendProgress = 0;
    return new Promise(resolve => {
      const check = () => {
        if (!this._ascendActive) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  /** 触发从高空落下的入场动画 */
  triggerEntry(): void {
    this._entryActive   = true;
    this._entryProgress = 0;
  }

  /** 触发从光柱顶端降落的入场动画（配合目的地光柱）
   * @param beamZ 光柱顶端的 z 值（屏幕像素），默认 210（与 Portal.beamH * scaleY 匹配）
   */
  triggerDescend(beamZ = 210): void {
    this._entryActive   = true;
    this._entryProgress = 0;
    this._descendMode   = true;
    this._descendStartZ = beamZ;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.5,
      minY: this.position.y - 0.5,
      maxX: this.position.x + 0.5,
      maxY: this.position.y + 0.5,
      baseZ: this.position.z,
    };
  }

  update(ts?: number): void {
    super.update(ts);
    const now = ts ?? performance.now();
    const dt = this._lastTs === 0 ? 0.016 : Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    const moving = Math.hypot(this.velX, this.velY) > 0.01;

    // 上下浮动
    this._bobPhase += moving ? dt * 5.5 : dt * 1.2;
    this.position.z = Math.sin(this._bobPhase) * (moving ? 4 : 2);

    // 方向倾斜（平滑插值）
    const targetTiltX = moving ? this.velX * 10 : 0;
    const targetTiltY = moving ? this.velY * 10 : 0;
    this._tiltX += (targetTiltX - this._tiltX) * Math.min(1, dt * 9);
    this._tiltY += (targetTiltY - this._tiltY) * Math.min(1, dt * 9);

    // 慢速自转 + 折射光旋转（接近传送阵时加速）
    const spinBoost = 1 + this.portalProximity * 2.5;
    this._spinAngle  += dt * 0.6 * spinBoost;
    this._glintAngle += dt * 1.8 * spinBoost;

    if (this._teleportFlash > 0) {
      this._teleportFlash = Math.max(0, this._teleportFlash - dt * 3);
    }

    // 飞升动画：角色快速上升 + 缩小消失
    if (this._ascendActive) {
      this._ascendProgress = Math.min(1, this._ascendProgress + dt / this._ascendDuration);
      // easeInQuad 加速上升
      const t = this._ascendProgress;
      const ease = t * t;
      this.position.z = ease * 280;          // 飞升高度
      this._spinAngle += dt * (3 + t * 8);   // 加速旋转
      if (this._ascendProgress >= 1) {
        this._ascendActive = false;
      }
    }

    // 入场动画（从高空落下 + 弹跳）
    if (this._entryActive) {
      this._entryProgress = Math.min(1, this._entryProgress + dt * (this._descendMode ? 1.2 : 1.8));
      const t = this._entryProgress;

      if (this._descendMode) {
        // 降落模式：从光柱顶端匀速落下，最后轻弹
        const startZ = this._descendStartZ;
        const bounce = t < 0.85
          ? 1 - t / 0.85                                          // 线性下落
          : 0.08 * Math.pow(1 - (t - 0.85) / 0.15, 2);          // 落地小弹跳
        this.position.z = bounce * startZ;
        this._spinAngle += dt * (4 - t * 3);                     // 旋转逐渐减慢
      } else {
        // 原有弹跳入场
        const bounce = t < 0.36 ? 1 - (1 - t / 0.36) * (1 - t / 0.36)
          : t < 0.72 ? 1 - 0.25 * Math.pow(1 - (t - 0.36) / 0.36, 2)
          : 1 - 0.06 * Math.pow(1 - (t - 0.72) / 0.28, 2);
        this.position.z = (1 - bounce) * 120;
      }

      if (this._entryProgress >= 1) {
        this._entryActive  = false;
        this._descendMode  = false;
        this.position.z    = 0;
      }
    }
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY, dirLights } = dc;
    const { x, y, z } = this.position;

    // 角色当前屏幕位置（含 z 偏移）
    const { sx, sy } = project(x, y, z, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;

    // 地面投影位置（z=0），用于正确放置阴影
    const { sx: gsx, sy: gsy } = project(x, y, 0, tileW, tileH);
    const gx = originX + gsx;
    const gy = originY + gsy;

    // 先画地面阴影（响应太阳方向）
    // cy - 26 = 钻石腰棱的实际屏幕 y（亭底对齐地面）
    this._drawShadowBlob(ctx, cx, cy - 26, gx, gy, dirLights, tileW, tileH);

    ctx.save();
    // 上移钻石，使亭底（culet）对齐地面，而不是腰棱对齐地面
    // HP=26 是 _drawDiamond 里的亭部高度
    ctx.translate(cx, cy - 26);

    // 飞升时缩小 + 增亮
    if (this._ascendActive) {
      const t = this._ascendProgress;
      const scale = 1 + t * 0.4 - t * t * 0.8; // 先略微放大再缩小
      ctx.scale(scale, scale);
    }

    // 倾斜变换
    ctx.transform(1, this._tiltY * 0.009, this._tiltX * 0.013, 1, 0, 0);

    this._drawDiamond(ctx);
    this._drawGlints(ctx);

    // 传送闪光
    if (this._teleportFlash > 0) {
      ctx.globalAlpha = this._teleportFlash * 0.85;
      const flash = ctx.createRadialGradient(0, -18, 0, 0, -18, 32);
      flash.addColorStop(0, '#ffffff');
      flash.addColorStop(1, 'rgba(180,220,255,0)');
      ctx.beginPath();
      ctx.arc(0, -18, 32, 0, Math.PI * 2);
      ctx.fillStyle = flash;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // 梦幻光晕：角色周围漂浮的彩色光圈（在相机变换空间里画）
    // cy - 26 对应钻石腰棱的实际屏幕位置（亭底对齐地面后）
    this._drawDreamAura(ctx, cx, cy - 26);
  }

  // ── 地面投影阴影（响应太阳方向） ────────────────────────────────────────

  private _drawShadowBlob(
    ctx: CanvasRenderingContext2D,
    _cx: number, cy: number,
    gx: number, gy: number,
    dirLights: DirectionalLight[],
    _tileW: number, _tileH: number,
  ): void {
    const m = ctx.getTransform();
    const zoom = m.a || 1;

    // 从太阳方向光计算阴影偏移
    // 角色高度（屏幕像素）= cy - gy（角色比地面高多少像素）
    const heightPx = gy - cy; // 正值 = 角色在地面上方

    let shadowOffX = 0;
    let shadowOffY = 0;
    let shadowAlpha = 0.45;
    let shadowScaleX = 1.0;

    if (dirLights.length > 0) {
      const dl = dirLights[0];
      const elev = dl.elevation;
      if (elev > 0.01) {
        // 阴影长度 = 高度 / tan(仰角)，单位：屏幕像素
        const shadowLen = heightPx / Math.tan(elev);
        // 阴影方向 = 光源方向的反方向（屏幕空间）
        shadowOffX = -Math.cos(dl.angle) * shadowLen;
        shadowOffY = -Math.sin(dl.angle) * shadowLen;
        // 低仰角时阴影更长更淡，高仰角时更短更实
        const elevNorm = Math.min(1, elev / (Math.PI / 2));
        shadowAlpha = 0.15 + elevNorm * 0.35;
        // 低仰角时横向拉伸
        shadowScaleX = 1.0 + (1 - elevNorm) * 0.8;
      }
    }

    // 阴影中心 = 地面位置 + 偏移
    const shadowCx = gx + shadowOffX;
    const shadowCy = gy + shadowOffY;

    const screenX = m.a * shadowCx + m.c * shadowCy + m.e;
    const screenY = m.b * shadowCx + m.d * shadowCy + m.f;
    const r = 18 * zoom;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(screenX, screenY);
    ctx.scale(shadowScaleX, 0.38);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    sg.addColorStop(0,   `rgba(0,0,0,${shadowAlpha.toFixed(2)})`);
    sg.addColorStop(0.5, `rgba(0,0,0,${(shadowAlpha * 0.45).toFixed(2)})`);
    sg.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();
  }

  // ── 钻石主体 ──────────────────────────────────────────────────────────────

  private _drawDiamond(ctx: CanvasRenderingContext2D): void {
    const spin = this._spinAngle;

    // 钻石尺寸参数
    const W  = 20;   // 腰部半宽
    const HT = 22;   // 冠部高度（上半）
    const HP = 26;   // 亭部高度（下半）
    const GIRDLE = 3; // 腰棱厚度

    // 腰部顶点（8个，形成八边形腰棱）
    const SIDES = 8;
    const girdle: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 + spin;
      girdle.push({ x: Math.cos(a) * W, y: Math.sin(a) * W * 0.45 });
    }

    // 冠顶（table facet 中心）
    const tableY = -HT - GIRDLE;
    // 亭底（culet 尖点）
    const culetY = HP;

    // ── 亭部（下半，倒锥，先画避免遮挡） ──────────────────────────────────
    for (let i = 0; i < SIDES; i++) {
      const g0 = girdle[i];
      const g1 = girdle[(i + 1) % SIDES];
      // 亭部面颜色：深蓝紫，交替明暗
      const bright = i % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(g0.x, g0.y + GIRDLE);
      ctx.lineTo(g1.x, g1.y + GIRDLE);
      ctx.lineTo(0, culetY);
      ctx.closePath();
      ctx.fillStyle = bright ? '#3a6fd8' : '#1e3fa0';
      ctx.fill();
      ctx.strokeStyle = 'rgba(100,160,255,0.4)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // ── 腰棱 ──────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(girdle[0].x, girdle[0].y);
    for (let i = 1; i < SIDES; i++) ctx.lineTo(girdle[i].x, girdle[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(180,220,255,0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,230,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── 冠部（上半，多面锥） ───────────────────────────────────────────────
    // table（顶面平台）顶点
    const tableR = W * 0.52;
    const TABLE_SIDES = 8;
    const table: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < TABLE_SIDES; i++) {
      const a = (i / TABLE_SIDES) * Math.PI * 2 + spin + Math.PI / TABLE_SIDES;
      table.push({ x: Math.cos(a) * tableR, y: tableY + Math.sin(a) * tableR * 0.4 });
    }

    // 冠部侧面（girdle → table 边）
    for (let i = 0; i < SIDES; i++) {
      const g0 = girdle[i];
      const g1 = girdle[(i + 1) % SIDES];
      const t0 = table[i % TABLE_SIDES];
      const t1 = table[(i + 1) % TABLE_SIDES];

      // 交替两种蓝色，模拟折射
      const bright = i % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(g0.x, g0.y - GIRDLE);
      ctx.lineTo(g1.x, g1.y - GIRDLE);
      ctx.lineTo(t1.x, t1.y);
      ctx.lineTo(t0.x, t0.y);
      ctx.closePath();
      ctx.fillStyle = bright ? '#60aaff' : '#3a7aee';
      ctx.fill();
      ctx.strokeStyle = 'rgba(180,220,255,0.5)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // table 顶面（最亮）
    ctx.beginPath();
    ctx.moveTo(table[0].x, table[0].y);
    for (let i = 1; i < TABLE_SIDES; i++) ctx.lineTo(table[i].x, table[i].y);
    ctx.closePath();

    // 顶面渐变（模拟天光反射）
    const tableGrad = ctx.createLinearGradient(-tableR, tableY - 4, tableR, tableY + 4);
    tableGrad.addColorStop(0, '#d0eeff');
    tableGrad.addColorStop(0.5, '#a0d0ff');
    tableGrad.addColorStop(1, '#70b0ff');
    ctx.fillStyle = tableGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 内部折射光（table 面上的十字高光）
    ctx.save();
    ctx.clip(); // 裁剪到 table 面内
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    const cr = tableR * 0.7;
    ctx.beginPath();
    ctx.moveTo(-cr, tableY); ctx.lineTo(cr, tableY);
    ctx.moveTo(0, tableY - cr * 0.5); ctx.lineTo(0, tableY + cr * 0.5);
    ctx.stroke();
    ctx.restore();

    // 接近传送阵时的紫色光晕叠加
    if (this.portalProximity > 0) {
      ctx.save();
      ctx.globalAlpha = this.portalProximity * 0.5;
      ctx.globalCompositeOperation = 'screen';
      const portalGlow = ctx.createRadialGradient(0, -10, 0, 0, -10, W * 1.4);
      portalGlow.addColorStop(0, '#c080ff');
      portalGlow.addColorStop(0.5, 'rgba(160,80,255,0.4)');
      portalGlow.addColorStop(1, 'rgba(100,60,255,0)');
      ctx.beginPath();
      ctx.arc(0, -10, W * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = portalGlow;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // ── 梦幻光晕 ──────────────────────────────────────────────────────────────

  private _drawDreamAura(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const t = this._spinAngle;
    const proximity = this.portalProximity;

    // 外圈柔和光晕（始终存在，接近传送阵时增强）
    const auraR = 38 + Math.sin(t * 0.7) * 4;
    const auraAlpha = 0.12 + proximity * 0.18;
    const auraGrad = ctx.createRadialGradient(cx, cy - 12, 0, cx, cy - 12, auraR);
    auraGrad.addColorStop(0,   `rgba(160,200,255,${auraAlpha.toFixed(2)})`);
    auraGrad.addColorStop(0.5, `rgba(180,140,255,${(auraAlpha * 0.5).toFixed(2)})`);
    auraGrad.addColorStop(1,   'rgba(100,80,255,0)');
    ctx.beginPath();
    ctx.arc(cx, cy - 12, auraR, 0, Math.PI * 2);
    ctx.fillStyle = auraGrad;
    ctx.fill();

    // 环绕光点（3个，不同颜色，椭圆轨道）
    const orbitColors = ['rgba(200,180,255,', 'rgba(160,230,255,', 'rgba(255,200,220,'];
    for (let i = 0; i < 3; i++) {
      const angle = t * (0.8 + i * 0.3) + (i / 3) * Math.PI * 2;
      const orbitR = 28 + i * 4;
      const ox = cx + Math.cos(angle) * orbitR;
      const oy = cy - 12 + Math.sin(angle) * orbitR * 0.42;
      const pulse = 0.5 + Math.sin(t * 2.1 + i * 1.4) * 0.35;
      const dotR = (1.8 + i * 0.5) * pulse;
      const alpha = (0.55 + proximity * 0.3) * pulse;

      ctx.beginPath();
      ctx.arc(ox, oy, dotR + 3, 0, Math.PI * 2);
      const glowGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, dotR + 3);
      glowGrad.addColorStop(0, `${orbitColors[i]}${alpha.toFixed(2)})`);
      glowGrad.addColorStop(1, `${orbitColors[i]}0)`);
      ctx.fillStyle = glowGrad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ox, oy, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `${orbitColors[i]}${Math.min(1, alpha * 1.8).toFixed(2)})`;
      ctx.fill();
    }

    // 接近传送阵时：额外的紫色能量环
    if (proximity > 0.15) {
      const ringAlpha = (proximity - 0.15) / 0.85;
      const ringR = 32 + Math.sin(t * 3) * 3;
      ctx.beginPath();
      ctx.arc(cx, cy - 12, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180,100,255,${(ringAlpha * 0.6).toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 能量环上的光点
      for (let i = 0; i < 6; i++) {
        const a = t * 2 + (i / 6) * Math.PI * 2;
        const ex = cx + Math.cos(a) * ringR;
        const ey = cy - 12 + Math.sin(a) * ringR * 0.42;
        ctx.beginPath();
        ctx.arc(ex, ey, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220,160,255,${(ringAlpha * 0.9).toFixed(2)})`;
        ctx.fill();
      }
    }
  }

  // ── 外圈折射光点 ──────────────────────────────────────────────────────────

  private _drawGlints(ctx: CanvasRenderingContext2D): void {
    const a = this._glintAngle;
    const glints = [
      { r: 26, offset: 0,              size: 3.5, alpha: 0.9 },
      { r: 22, offset: Math.PI * 0.5,  size: 2.5, alpha: 0.7 },
      { r: 28, offset: Math.PI * 1.1,  size: 2,   alpha: 0.6 },
      { r: 20, offset: Math.PI * 1.6,  size: 3,   alpha: 0.8 },
    ];

    for (const g of glints) {
      const gx = Math.cos(a + g.offset) * g.r;
      const gy = Math.sin(a + g.offset) * g.r * 0.45 - 10;

      // 星形光点（4条线）
      ctx.save();
      ctx.translate(gx, gy);
      ctx.globalAlpha = g.alpha * (0.6 + Math.sin(a * 2 + g.offset) * 0.4);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) {
        const la = (i / 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(Math.cos(la) * g.size, Math.sin(la) * g.size);
        ctx.lineTo(-Math.cos(la) * g.size, -Math.sin(la) * g.size);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // 中心内部光芒（模拟钻石火彩）
    ctx.save();
    ctx.globalAlpha = 0.35 + Math.sin(a * 1.3) * 0.15;
    const fireGrad = ctx.createRadialGradient(0, -10, 0, 0, -10, 18);
    fireGrad.addColorStop(0, '#ffffff');
    fireGrad.addColorStop(0.3, 'rgba(180,220,255,0.6)');
    fireGrad.addColorStop(1, 'rgba(100,160,255,0)');
    ctx.beginPath();
    ctx.arc(0, -10, 18, 0, Math.PI * 2);
    ctx.fillStyle = fireGrad;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
