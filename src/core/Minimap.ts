import {Scene} from './Scene';
import {TileCollider} from '../physics/TileCollider';
import {Character} from '../elements/Character';
import {IsoObject} from '../elements/IsoObject';

export interface MinimapStyle {
  /** Background fill. Default '#1a1a2e'. */
  bg?: string;
  /** Walkable tile color. Default '#2a3a4a'. */
  walkable?: string;
  /** Blocked tile color. Default '#0a0a14'. */
  blocked?: string;
  /** Grid line color. Default 'rgba(255,255,255,0.06)'. */
  grid?: string;
  /** Player/character dot color. Default '#5590cc'. */
  playerColor?: string;
  /** Generic object dot color. Default '#cc8855'. */
  objectColor?: string;
  /** Border color. Default 'rgba(255,255,255,0.25)'. */
  border?: string;
  /** Corner radius in px. Default 6. */
  radius?: number;
  /** Transparency (0-1). Default 1.0. */
  alpha?: number;
}

/**
 * Minimap — overhead tile-grid overview rendered into an OffscreenCanvas.
 *
 * Attach to a Scene and call `draw()` each frame (or only on dirty) to blit
 * a minimap HUD overlay onto the main canvas.
 *
 * @example
 *   const minimap = new Minimap(scene, { cols: 10, rows: 10 });
 *   // In postFrame callback:
 *   minimap.draw(ctx, canvas.width - 160, 16, 144, 144);
 */
export class Minimap {
  private _scene: Scene;
  private _cols: number;
  private _rows: number;
  private _style: Required<MinimapStyle>;

  private _offscreen: OffscreenCanvas | null = null;
  private _offCtx: OffscreenCanvasRenderingContext2D | null = null;

  /** Pixel size of each tile cell on the minimap. Computed from draw() size. */
  private _cellW = 0;
  private _cellH = 0;

  constructor(scene: Scene, opts: {cols: number; rows: number; style?: MinimapStyle} = {cols: 10, rows: 10}) {
    this._scene = scene;
    this._cols = opts.cols;
    this._rows = opts.rows;
    this._style = {
      bg: opts.style?.bg ?? '#1a1a2e',
      walkable: opts.style?.walkable ?? '#2a3a4a',
      blocked: opts.style?.blocked ?? '#0a0a14',
      grid: opts.style?.grid ?? 'rgba(255,255,255,0.06)',
      playerColor: opts.style?.playerColor ?? '#5590cc',
      objectColor: opts.style?.objectColor ?? '#cc8855',
      border: opts.style?.border ?? 'rgba(255,255,255,0.25)',
      radius: opts.style?.radius ?? 6,
      alpha: opts.style?.alpha ?? 1.0,
    };
  }

  /** Update which scene is observed (e.g. after a scene transition). */
  setScene(scene: Scene): void { this._scene = scene; }

  /** Transparency (0-1). */
  get alpha(): number { return this._style.alpha; }
  set alpha(v: number) { this._style.alpha = v; }

  /**
   * Draw the minimap at (x, y) on the main canvas, sized w × h pixels.
   * Call this in your postFrame callback (after camera.restoreTransform).
   */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    this._ensureOffscreen(w, h);
    this._render(w, h);
    if (this._offscreen) {
      ctx.save();
      ctx.globalAlpha = this._style.alpha;

      // Rounded-rect clip on main canvas
      this._roundRect(ctx, x, y, w, h, this._style.radius);
      ctx.clip();
      ctx.drawImage(this._offscreen, x, y);

      // Border
      ctx.strokeStyle = this._style.border;
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, x, y, w, h, this._style.radius);
      ctx.stroke();

      ctx.restore();
    }
  }

  /**
   * Returns true if the given screen coordinate (px, py) is inside the minimap
   * boundary at (mx, my, mw, mh).
   */
  isHit(px: number, py: number, mx: number, my: number, mw: number, mh: number): boolean {
    return px >= mx && px <= mx + mw && py >= my && py <= my + mh;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _ensureOffscreen(w: number, h: number): void {
    if (!this._offscreen || this._offscreen.width !== w || this._offscreen.height !== h) {
      this._offscreen = new OffscreenCanvas(w, h);
      this._offCtx = this._offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D;
      this._cellW = w / this._cols;
      this._cellH = h / this._rows;
    }
  }

  private _render(w: number, h: number): void {
    const ctx = this._offCtx;
    if (!ctx) {return;}

    const cw = this._cellW;
    const ch = this._cellH;
    const collider: TileCollider | null = this._scene.collider;

    // Background
    ctx.fillStyle = this._style.bg;
    ctx.fillRect(0, 0, w, h);

    // Tile grid
    for (let r = 0; r < this._rows; r++) {
      for (let c = 0; c < this._cols; c++) {
        const walkable = collider ? collider.isWalkable(c, r) : true;
        ctx.fillStyle = walkable ? this._style.walkable : this._style.blocked;
        ctx.fillRect(c * cw, r * ch, cw, ch);
      }
    }

    // Grid lines
    ctx.strokeStyle = this._style.grid;
    ctx.lineWidth = 0.5;
    for (let c = 1; c < this._cols; c++) {
      ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, h); ctx.stroke();
    }
    for (let r = 1; r < this._rows; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(w, r * ch); ctx.stroke();
    }

    // Objects — iterate scene via public API
    const objects = this._getObjects();
    for (const obj of objects) {
      const px = obj.position.x * cw;
      const py = obj.position.y * ch;
      const isChar = obj instanceof Character;
      const dotR = isChar ? Math.max(3, cw * 0.35) : Math.max(2, cw * 0.22);

      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fillStyle = isChar ? this._style.playerColor : this._style.objectColor;
      ctx.fill();

      // Pulse ring for characters
      if (isChar) {
        ctx.beginPath();
        ctx.arc(px, py, dotR + 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = `${this._style.playerColor}88`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private _getObjects(): IsoObject[] {
    return [...this._scene.allObjects];
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
