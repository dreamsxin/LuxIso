/**
 * EditorRenderer — drives the Engine to preview the current EditorState.
 */
import { Engine } from '../core/Engine';
import { project, unproject } from '../math/IsoProjection';
import { EditorState, EditorObject } from './EditorState';

export class EditorRenderer {
  readonly engine: Engine;
  private _state: EditorState;

  private _pendingRebuild: number | null = null;

  hoverWorld: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, state: EditorState) {
    this.engine = new Engine({ canvas });
    this._state = state;
    this._updateOrigin();
    this._rebuild();
    state.onChange(() => this._scheduleRebuild());
  }

  /**
   * Coalesce rebuilds to at most one per frame.
   *
   * `EditorState.emit()` fires on every pointermove while dragging an object and
   * on every painted walkable tile, and a rebuild allocates a whole new scene
   * graph. Rebuilding synchronously meant hundreds of scene graphs per second,
   * and — because the WebGL preview's ShadowProjectionCache is keyed on object
   * identity via a WeakMap — every rebuild also invalidated 100% of the shadow
   * projections. Only the last state within a frame is observable, so batching is
   * free.
   */
  private _scheduleRebuild(): void {
    if (this._pendingRebuild !== null) return;
    const run = (): void => {
      this._pendingRebuild = null;
      this._updateOrigin();
      this._rebuild();
    };
    this._pendingRebuild = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(run)
      : (setTimeout(run, 0) as unknown as number);
  }

  /** Apply any pending rebuild immediately. Useful before reading engine state. */
  flushRebuild(): void {
    if (this._pendingRebuild === null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._pendingRebuild);
    else clearTimeout(this._pendingRebuild as unknown as ReturnType<typeof setTimeout>);
    this._pendingRebuild = null;
    this._updateOrigin();
    this._rebuild();
  }

  private _updateOrigin(): void {
    const s = this._state.scene;
    this.engine.originX = this.engine.canvas.width / 2;
    this.engine.originY = s.rows * (s.tileH / 2) + 20;
  }

  // ── Scene rebuild ─────────────────────────────────────────────────────────

  private _rebuild(): void {
    const s = this._state.scene;
    const scene = this.engine.buildScene({
      name: s.name,
      ambientColor: '#ffffff',
      ambientIntensity: 0.55,
      cols: s.cols, rows: s.rows,
      tileW: s.tileW, tileH: s.tileH,
      floor: {
        id: s.floor.id,
        cols: s.cols, rows: s.rows,
        color: s.floor.color, altColor: s.floor.altColor,
        // Pass walkable grid so TileCollider is correctly built
        walkable: s.walkable,
      },
      walls: s.walls.map(w => ({ ...w })),
      lights: s.lights.map(l => ({ ...l })),
      characters: s.characters.map(c => ({
        id: c.id, x: c.x, y: c.y, z: c.z, radius: c.radius, color: c.color,
      })),
      props: s.props.map(({ kind, ...prop }) => ({ ...prop, type: kind })),
    });
    this.engine.setScene(scene);
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  canvasToWorld(cx: number, cy: number): { x: number; y: number } {
    const s = this._state.scene;
    const scene = this.engine.scene;
    if (scene) {
      // Use camera.screenToWorld so zoom & pan are handled correctly
      return scene.camera.screenToWorld(
        cx, cy,
        this.engine.canvas.width, this.engine.canvas.height,
        s.tileW, s.tileH,
        this.engine.originX, this.engine.originY,
      );
    }
    // Fallback when scene not yet initialised
    return unproject(cx - this.engine.originX, cy - this.engine.originY, s.tileW, s.tileH);
  }

  snapToTile(wx: number, wy: number): { x: number; y: number } {
    return { x: Math.floor(wx) + 0.5, y: Math.floor(wy) + 0.5 };
  }

  snapToGrid(wx: number, wy: number): { x: number; y: number } {
    return { x: Math.round(wx), y: Math.round(wy) };
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  start(): void {
    this.engine.start(() => this._drawOverlay());
  }

  stop(): void {
    this.engine.stop();
  }

  // ── Overlay ───────────────────────────────────────────────────────────────

  private _drawOverlay(): void {
    const ctx = this.engine.ctx;
    const s   = this._state.scene;
    const ox  = this.engine.originX;
    const oy  = this.engine.originY;
    const tw  = s.tileW, th = s.tileH;

    // ── Walkable / blocked tile overlay ──────────────────────────────────
    const isPaintTool = this._state.activeTool === 'walkable' || this._state.activeTool === 'blocked';
    // Always show blocked tiles (in red) when paint tool is active
    if (isPaintTool) {
      for (let row = 0; row < s.rows; row++) {
        for (let col = 0; col < s.cols; col++) {
          if (!this._state.isWalkable(col, row)) {
            this._drawTileHighlight(ctx, col, row, ox, oy, tw, th, 'rgba(220,60,60,0.32)');
          }
        }
      }
    }

    // ── Grid dots ─────────────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.15;
    for (let row = 0; row <= s.rows; row++) {
      for (let col = 0; col <= s.cols; col++) {
        const { sx, sy } = project(col, row, 0, tw, th);
        ctx.beginPath();
        ctx.arc(ox + sx, oy + sy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#88aaff';
        ctx.fill();
      }
    }
    ctx.restore();

    // ── Hover tile ────────────────────────────────────────────────────────
    if (this.hoverWorld) {
      const { x, y } = this.hoverWorld;
      const col = Math.floor(x), row = Math.floor(y);
      if (col >= 0 && col < s.cols && row >= 0 && row < s.rows) {
        const tool = this._state.activeTool;
        const color = tool === 'blocked'  ? 'rgba(220,60,60,0.42)'
                    : tool === 'walkable' ? 'rgba(60,220,100,0.30)'
                    : 'rgba(100,180,255,0.18)';
        this._drawTileHighlight(ctx, col, row, ox, oy, tw, th, color);
      }
    }

    // ── Wall preview ──────────────────────────────────────────────────────
    if (this._state.activeTool === 'wall' && this._state.wallStart && this.hoverWorld) {
      const ws = this._state.wallStart;
      const we = this.snapToGrid(this.hoverWorld.x, this.hoverWorld.y);
      const p0 = project(ws.x, ws.y, 0, tw, th);
      const p1 = project(we.x, we.y, 0, tw, th);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(255,200,80,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox + p0.sx, oy + p0.sy);
      ctx.lineTo(ox + p1.sx, oy + p1.sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ox + p0.sx, oy + p0.sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,200,80,0.9)';
      ctx.fill();
      ctx.restore();
    }

    // ── OmniLight anchor dot ──────────────────────────────────────────────
    for (const l of s.lights) {
      if (l.type !== 'omni') continue;
      const lz = l.z ?? 0;
      const lp = project(l.x, l.y, lz, tw, th);
      const lcx = ox + lp.sx, lcy = oy + lp.sy;
      ctx.save();
      ctx.beginPath();
      ctx.arc(lcx, lcy, 8, 0, Math.PI * 2);
      ctx.fillStyle = `${l.color}55`;
      ctx.fill();
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Cross hairs
      ctx.beginPath();
      ctx.moveTo(lcx - 5, lcy); ctx.lineTo(lcx + 5, lcy);
      ctx.moveTo(lcx, lcy - 5); ctx.lineTo(lcx, lcy + 5);
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    // ── DirectionalLight preview (anchor dot + direction arrow) ──────────
    for (const l of s.lights) {
      if (l.type !== 'directional') continue;
      const angle = l.angle ?? 0;
      const lz = l.z ?? 0;
      // Anchor at the light's stored world position (l.x, l.y, lz)
      const lp = project(l.x, l.y, lz, tw, th);
      const lcx = ox + lp.sx, lcy = oy + lp.sy;
      ctx.save();

      // Anchor dot (clickable handle)
      ctx.beginPath();
      ctx.arc(lcx, lcy, 7, 0, Math.PI * 2);
      ctx.fillStyle = `${l.color}88`;
      ctx.fill();
      ctx.strokeStyle = `${l.color}`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Direction arrow
      const len = Math.min(tw * 1.2, 80);
      ctx.strokeStyle = `${l.color}cc`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(lcx, lcy);
      ctx.lineTo(lcx + Math.cos(angle) * len, lcy + Math.sin(angle) * len);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead
      const ax = lcx + Math.cos(angle) * len;
      const ay = lcy + Math.sin(angle) * len;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + Math.cos(angle + 2.5) * 10, ay + Math.sin(angle + 2.5) * 10);
      ctx.lineTo(ax + Math.cos(angle - 2.5) * 10, ay + Math.sin(angle - 2.5) * 10);
      ctx.closePath();
      ctx.fillStyle = `${l.color}cc`;
      ctx.fill();
      ctx.restore();
    }

    // ── Selection highlight ───────────────────────────────────────────────
    if (this._state.selectedId) {
      const obj = this._state.getById(this._state.selectedId);
      if (obj) {
        const x = (obj as EditorObject & { x?: number }).x;
        const y = (obj as EditorObject & { y?: number }).y;
        const z = (obj as EditorObject & { z?: number }).z ?? 0;
        if (x !== undefined && y !== undefined) {
          const { sx, sy } = project(x, y, z, tw, th);
          // Scale the highlight ring proportionally to tileW
          const ring = tw * 0.36;
          ctx.save();
          ctx.strokeStyle = '#ffdd44';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(ox + sx, oy + sy, ring, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ── Drag object ghost position ────────────────────────────────────────
    if (this._state.dragId && this.hoverWorld) {
      const { sx, sy } = project(this.hoverWorld.x, this.hoverWorld.y, 0, tw, th);
      ctx.save();
      ctx.strokeStyle = 'rgba(100,200,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(ox + sx, oy + sy, tw * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ── Object labels (id) ────────────────────────────────────────────────
    ctx.save();
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(180,200,255,0.5)';
    for (const obj of this._state.allObjects()) {
      const o = obj as EditorObject & { x?: number; y?: number; z?: number };
      if (o.x === undefined) continue;
      const { sx, sy } = project(o.x, o.y!, o.z ?? 0, tw, th);
      ctx.fillText(obj.id, ox + sx + 14, oy + sy - 4);
    }
    ctx.restore();
  }

  private _drawTileHighlight(
    ctx: CanvasRenderingContext2D,
    col: number, row: number,
    ox: number, oy: number,
    tileW: number, tileH: number,
    color: string,
  ): void {
    // Use tile centre (col+0.5, row+0.5) so the diamond aligns with the
    // floor tile drawn by the engine and with snapToTile output.
    const { sx, sy } = project(col + 0.5, row + 0.5, 0, tileW, tileH);
    const hw = tileW / 2, hh = tileH / 2;
    const tx = ox + sx, ty = oy + sy;
    ctx.beginPath();
    ctx.moveTo(tx,      ty - hh);
    ctx.lineTo(tx + hw, ty);
    ctx.lineTo(tx,      ty + hh);
    ctx.lineTo(tx - hw, ty);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
