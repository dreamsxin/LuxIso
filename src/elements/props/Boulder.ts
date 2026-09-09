import { project } from '../../math/IsoProjection';
import { AABB } from '../../math/depthSort';
import { DrawContext } from '../IsoObject';
import { Entity } from '../../ecs/Entity';
import { HealthComponent } from '../../ecs/components/HealthComponent';
import { blendColorRaw } from '../../math/color';

/** Low-poly isometric boulder. */
export class Boulder extends Entity {
  private color: string;
  private radius: number;

  constructor(id: string, x: number, y: number, color = '#7a7a8a', radius = 18) {
    super(id, x, y, 0);
    this.color = color;
    this.radius = radius;
    // Use circular shadow footprint to match the round visual shape
    this.shadowRadius = 0.38;
    this.castsShadow  = true;
  }

  get propColor(): string  { return this.color; }
  get propRadius(): number { return this.radius; }

  get aabb(): AABB {
    // radius is the drawn rock radius in screen pixels; the full vertical
    // extent is ~2*radius. AABB Z is in pixels too, so no conversion.
    return {
      minX: this.position.x - 0.45,
      minY: this.position.y - 0.45,
      maxX: this.position.x + 0.45,
      maxY: this.position.y + 0.45,
      baseZ: 0,
      maxZ: this.radius * 2,
    };
  }

  update(ts?: number): void {
    super.update(ts);
  }

  draw(dc: DrawContext): void {
    const { ctx, tileW, tileH, originX, originY, omniLights } = dc;
    const { x, y } = this.position;
    const { sx, sy } = project(x, y, 0, tileW, tileH);
    const cx = originX + sx;
    const cy = originY + sy;
    const r = this.radius;

    // Light
    let illum = 0.2;
    for (const l of omniLights) {
      const lp = project(l.position.x, l.position.y, 0, tileW, tileH);
      const lsx = originX + lp.sx;
      const lsy = originY + lp.sy - l.position.z;
      illum += l.illuminateAt(cx, cy, lsx, lsy);
    }
    illum = Math.min(1, illum);

    // 7-sided low-poly rock
    const VERTS = 7;
    const offsets = [0, 15, -12, 20, -8, 18, -15]; // irregular angle offsets
    const radii   = [1.0, 0.82, 0.95, 0.78, 1.0, 0.88, 0.92]; // irregular radii

    const pts: [number, number][] = [];
    for (let i = 0; i < VERTS; i++) {
      const baseAngle = (i / VERTS) * Math.PI * 2 - Math.PI / 2;
      const a = baseAngle + (offsets[i] * Math.PI) / 180;
      pts.push([cx + Math.cos(a) * r * radii[i], cy + Math.sin(a) * r * radii[i] * 0.55]);
    }

    const litColor  = `rgb(${blendColorRaw(this.color, illum * 1.1)})`;
    const darkColor = `rgb(${blendColorRaw(this.color, illum * 0.4)})`;
    const midColor  = `rgb(${blendColorRaw(this.color, illum * 0.75)})`;

    // Bottom half (darker)
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= Math.floor(VERTS / 2); i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = darkColor;
    ctx.fill();

    // Top-left face
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.3);
    for (let i = Math.floor(VERTS / 2); i < VERTS; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[0][0], pts[0][1]);
    ctx.closePath();
    ctx.fillStyle = midColor;
    ctx.fill();

    // Bright facet on top
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.15, cy - r * 0.42);
    ctx.lineTo(cx + r * 0.2,  cy - r * 0.5);
    ctx.lineTo(cx + r * 0.35, cy - r * 0.28);
    ctx.lineTo(cx,             cy - r * 0.22);
    ctx.closePath();
    ctx.fillStyle = litColor;
    ctx.fill();

    // Dark crack lines
    ctx.strokeStyle = `rgba(0,0,0,0.3)`;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.1, cy - r * 0.1);
    ctx.lineTo(cx + r * 0.3, cy + r * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.25, cy + r * 0.05);
    ctx.lineTo(cx - r * 0.1,  cy - r * 0.25);
    ctx.stroke();

    this.drawHealthBar(ctx, cx, cy - r * 0.9);
  }

  private drawHealthBar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const hp = this.getComponent(HealthComponent);
    if (!hp || hp.isDead) return;
    const w = 32, h = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - w / 2, y, w, h);
    const frac = hp.fraction;
    const barColor = frac > 0.5 ? '#50e080' : frac > 0.25 ? '#f0c040' : '#e04040';
    ctx.fillStyle = barColor;
    ctx.fillRect(x - w / 2, y, w * frac, h);
  }
}
