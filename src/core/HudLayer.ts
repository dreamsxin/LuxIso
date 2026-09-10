/**
 * HudLayer — a simple canvas-space UI system for in-game HUDs.
 *
 * Renders labels, progress bars, and buttons at fixed screen positions.
 * All elements are drawn in screen space (no camera transform).
 *
 * @example
 *   const hud = new HudLayer();
 *
 *   const hpBar = hud.addBar({ id: 'hp', x: 16, y: 16, w: 160, h: 14,
 *     value: 1, color: '#e04040', label: 'HP' });
 *
 *   const scoreLabel = hud.addLabel({ id: 'score', x: 16, y: 40,
 *     text: 'Score: 0', color: '#fff', fontSize: 14 });
 *
 *   const btn = hud.addButton({ id: 'pause', x: 10, y: 10, w: 60, h: 24,
 *     label: 'Pause', onClick: () => engine.stop() });
 *
 *   // In postFrame:
 *   hud.draw(engine.ctx, canvas.width, canvas.height);
 *
 *   // Update values:
 *   hpBar.value = player.hp / player.maxHp;
 *   scoreLabel.text = `Score: ${score}`;
 *
 *   // Handle clicks:
 *   canvas.addEventListener('click', (e) => hud.handleClick(e.offsetX, e.offsetY));
 */

// ── Element types ──────────────────────────────────────────────────────────

export interface HudLabel {
  type: 'label';
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  font: string;
  visible: boolean;
  /** Optional shadow for readability over busy backgrounds. */
  shadow: boolean;
}

export interface HudBar {
  type: 'bar';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–1 fill fraction. */
  value: number;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  labelColor: string;
  fontSize: number;
  visible: boolean;
}

export interface HudButton {
  type: 'button';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  color: string;
  bgColor: string;
  hoverColor: string;
  fontSize: number;
  visible: boolean;
  onClick: () => void;
  /** Internal hover state. */
  _hovered: boolean;
}

export interface HudPanel {
  type: 'panel';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bgColor: string;
  borderColor: string;
  radius: number;
  visible: boolean;
}

export type HudElement = HudLabel | HudBar | HudButton | HudPanel;

/**
 * The slice of `InputManager` that `HudLayer.update()` reads. Declared
 * structurally so the HUD does not depend on the input module.
 */
export interface HudInputSource {
  readonly pointer: { x: number; y: number; down: boolean };
  readonly touches: readonly { id: number; x: number; y: number }[];
}

/** Reserved contact id for the mouse, which has no `Touch.identifier`. */
const MOUSE_CONTACT = -1;


// ── Option types ───────────────────────────────────────────────────────────

export interface LabelOptions {
  id: string;
  x: number;
  y: number;
  text?: string;
  color?: string;
  fontSize?: number;
  font?: string;
  visible?: boolean;
  shadow?: boolean;
}

export interface BarOptions {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  value?: number;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  label?: string;
  labelColor?: string;
  fontSize?: number;
  visible?: boolean;
}

export interface ButtonOptions {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  color?: string;
  bgColor?: string;
  hoverColor?: string;
  fontSize?: number;
  visible?: boolean;
  onClick?: () => void;
}

export interface PanelOptions {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bgColor?: string;
  borderColor?: string;
  radius?: number;
  visible?: boolean;
}

// ── HudLayer ───────────────────────────────────────────────────────────────

export class HudLayer {
  private _elements: HudElement[] = [];
  private _map = new Map<string, HudElement>();

  /**
   * Backing-store scale the HUD resets the context to before drawing.
   *
   * `draw()` pins the transform so the HUD is always in screen space, but the
   * identity it used to reset to threw away the base transform
   * `Engine.resize()` installs for high-DPI output — the HUD then rendered at
   * `1/ratio` of its intended size. Pass a function to track a ratio that can
   * change: `hud.pixelRatio = () => engine.appliedPixelRatio`.
   */
  pixelRatio: number | (() => number) = 1;

  /**
   * Minimum hit-target edge in logical pixels, expanded symmetrically around a
   * smaller element. 0 (the default) keeps hit areas exactly as drawn; 44 is the
   * usual touch guideline. Leave it at 0 when targets sit close together, or
   * neighbours will start stealing each other's taps.
   */
  minHitSize = 0;

  /** contact id → element it was pressed on. -1 is the mouse. */
  private _pressedOn = new Map<number, HudElement>();
  private _lastX = new Map<number, number>();
  private _lastY = new Map<number, number>();



  // ── Add elements ───────────────────────────────────────────────────────────

  addLabel(opts: LabelOptions): HudLabel {
    const el: HudLabel = {
      type: 'label',
      id:       opts.id,
      x:        opts.x,
      y:        opts.y,
      text:     opts.text     ?? '',
      color:    opts.color    ?? '#ffffff',
      fontSize: opts.fontSize ?? 14,
      font:     opts.font     ?? 'sans-serif',
      visible:  opts.visible  ?? true,
      shadow:   opts.shadow   ?? true,
    };
    this._add(el);
    return el;
  }

  addBar(opts: BarOptions): HudBar {
    const el: HudBar = {
      type: 'bar',
      id:          opts.id,
      x:           opts.x,
      y:           opts.y,
      w:           opts.w,
      h:           opts.h,
      value:       opts.value       ?? 1,
      color:       opts.color       ?? '#44cc44',
      bgColor:     opts.bgColor     ?? 'rgba(0,0,0,0.5)',
      borderColor: opts.borderColor ?? 'rgba(255,255,255,0.2)',
      label:       opts.label       ?? '',
      labelColor:  opts.labelColor  ?? '#ffffff',
      fontSize:    opts.fontSize    ?? 10,
      visible:     opts.visible     ?? true,
    };
    this._add(el);
    return el;
  }

  addButton(opts: ButtonOptions): HudButton {
    const el: HudButton = {
      type: 'button',
      id:         opts.id,
      x:          opts.x,
      y:          opts.y,
      w:          opts.w,
      h:          opts.h,
      label:      opts.label      ?? '',
      color:      opts.color      ?? '#ffffff',
      bgColor:    opts.bgColor    ?? 'rgba(40,40,60,0.85)',
      hoverColor: opts.hoverColor ?? 'rgba(80,80,120,0.95)',
      fontSize:   opts.fontSize   ?? 12,
      visible:    opts.visible    ?? true,
      onClick:    opts.onClick    ?? (() => {}),
      _hovered:   false,
    };
    this._add(el);
    return el;
  }

  addPanel(opts: PanelOptions): HudPanel {
    const el: HudPanel = {
      type: 'panel',
      id:          opts.id,
      x:           opts.x,
      y:           opts.y,
      w:           opts.w,
      h:           opts.h,
      bgColor:     opts.bgColor     ?? 'rgba(0,0,0,0.55)',
      borderColor: opts.borderColor ?? 'rgba(255,255,255,0.15)',
      radius:      opts.radius      ?? 6,
      visible:     opts.visible     ?? true,
    };
    this._add(el);
    return el;
  }

  // ── Lookup / remove ────────────────────────────────────────────────────────

  get<T extends HudElement>(id: string): T | undefined {
    return this._map.get(id) as T | undefined;
  }

  /** All elements in draw order (back to front). */
  get elements(): readonly HudElement[] {
    return this._elements;
  }

  remove(id: string): void {
    const el = this._map.get(id);
    if (!el) return;
    this._elements = this._elements.filter(e => e !== el);
    this._map.delete(id);
    this._forget(el);
  }

  clear(): void {
    this._elements = [];
    this._map.clear();
    this.resetInput();
  }

  /**
   * Drop any press state that refers to `el`.
   *
   * Without this a contact pressed on a removed element still resolved on
   * release, so hiding or rebuilding a HUD mid-press fired a button that was no
   * longer part of the layer.
   */
  private _forget(el: HudElement): void {
    for (const [id, pressed] of [...this._pressedOn]) {
      if (pressed !== el) continue;
      this._pressedOn.delete(id);
      this._lastX.delete(id);
      this._lastY.delete(id);
    }
    if (el.type === 'button') el._hovered = false;
  }

  // ── Input handling ─────────────────────────────────────────────────────────

  /**
   * Topmost visible element whose hit box contains the point, or null.
   *
   * Later-added elements win, matching the draw order. Labels have no extent so
   * they never hit; every other kind does, which is what makes inventory slots
   * and tappable bars possible — only buttons used to be considered at all.
   */
  hitTest(x: number, y: number): HudElement | null {
    for (let i = this._elements.length - 1; i >= 0; i--) {
      const el = this._elements[i];
      if (!el.visible || el.type === 'label') continue;
      if (this._contains(el, x, y)) return el;
    }
    return null;
  }

  /**
   * Call with canvas-space pointer coordinates each frame (or on mousemove)
   * to update button hover states.
   */
  handleMove(x: number, y: number): void {
    for (const el of this._elements) {
      if (el.type !== 'button') continue;
      // An invisible button used to be skipped entirely, so it kept whatever
      // hover state it had and came back highlighted when shown again.
      el._hovered = el.visible && this._contains(el, x, y);
    }
  }

  /**
   * Call with canvas-space click coordinates to trigger button callbacks.
   * Returns true if any button was clicked.
   *
   * This is the immediate-fire path for a mouse `click`. On touch prefer
   * `update()`, which fires on release inside the same button the way a real
   * button behaves — and does not carry the legacy 300 ms `click` delay.
   */
  handleClick(x: number, y: number): boolean {
    const hit = this.hitTest(x, y);
    if (hit?.type !== 'button') return false;
    hit.onClick();
    return true;
  }

  /**
   * Frame-driven input for mouse and touch.
   *
   * Tracks press and release per contact, so a button fires only when the
   * finger lifts inside the same button it went down on, and highlights while
   * held. Nothing here is wired automatically anywhere else: `handleClick` had
   * to be hooked to a DOM listener by hand, and the documented `click` event is
   * the wrong one on touch.
   *
   * @param isTaken contacts another widget owns — pass
   *   `id => id === stick.touchId` so the movement stick and the skill buttons
   *   do not fight over the same finger.
   * @returns ids of the contacts this layer is currently holding.
   */
  update(input: HudInputSource, isTaken?: (id: number) => boolean): readonly number[] {
    const live = new Set<number>();

    // Touch: one press/release cycle per contact.
    for (const touch of input.touches) {
      if (isTaken?.(touch.id)) continue;
      live.add(touch.id);
      if (this._pressedOn.has(touch.id)) continue;
      const hit = this.hitTest(touch.x, touch.y);
      if (!hit) continue;
      this._pressedOn.set(touch.id, hit);
      if (hit.type === 'button') hit._hovered = true;
    }

    // Mouse shares the mechanism under a reserved id.
    if (input.pointer.down && input.touches.length === 0) {
      live.add(MOUSE_CONTACT);
      if (!this._pressedOn.has(MOUSE_CONTACT)) {
        const hit = this.hitTest(input.pointer.x, input.pointer.y);
        if (hit) {
          this._pressedOn.set(MOUSE_CONTACT, hit);
          if (hit.type === 'button') hit._hovered = true;
        }
      }
    }

    for (const [id, el] of [...this._pressedOn]) {
      if (live.has(id)) continue;
      // Released (or cancelled). Fire only if the contact ended on the element
      // it started on — dragging off a button must not trigger it.
      this._pressedOn.delete(id);
      if (el.type === 'button') el._hovered = false;
      const releaseX = id === MOUSE_CONTACT ? input.pointer.x : this._lastX.get(id);
      const releaseY = id === MOUSE_CONTACT ? input.pointer.y : this._lastY.get(id);
      this._lastX.delete(id);
      this._lastY.delete(id);
      if (releaseX === undefined || releaseY === undefined) continue;
      if (el.type === 'button' && el.visible && this._contains(el, releaseX, releaseY)) {
        el.onClick();
      }
    }

    // Remember where each live contact is, so the release above can be tested
    // against a position the event itself no longer carries.
    for (const touch of input.touches) {
      this._lastX.set(touch.id, touch.x);
      this._lastY.set(touch.id, touch.y);
    }

    return [...this._pressedOn.keys()];
  }

  /** Drop any in-flight press state, e.g. when switching scenes. */
  resetInput(): void {
    for (const el of this._pressedOn.values()) {
      if (el.type === 'button') el._hovered = false;
    }
    this._pressedOn.clear();
    this._lastX.clear();
    this._lastY.clear();
  }

  private _contains(el: HudElement, x: number, y: number): boolean {
    if (el.type === 'label') return false;
    const padX = Math.max(0, (this.minHitSize - el.w) / 2);
    const padY = Math.max(0, (this.minHitSize - el.h) / 2);
    return x >= el.x - padX && x <= el.x + el.w + padX
        && y >= el.y - padY && y <= el.y + el.h + padY;
  }


  // ── Draw ───────────────────────────────────────────────────────────────────

  /**
   * Draw all visible HUD elements.
   * Call in your postFrame callback (after scene.draw).
   */
  draw(ctx: CanvasRenderingContext2D, _canvasW?: number, _canvasH?: number): void {
    ctx.save();
    // Pin to screen space, but at the backing-store scale rather than identity:
    // resetting to identity would discard the high-DPI base transform and draw
    // the whole HUD at 1/ratio size in the corner.
    const ratio = typeof this.pixelRatio === 'function' ? this.pixelRatio() : this.pixelRatio;
    const safe = ratio > 0 ? ratio : 1;
    ctx.setTransform(safe, 0, 0, safe, 0, 0);


    for (const el of this._elements) {
      if (!el.visible) continue;
      switch (el.type) {
        case 'panel':  this._drawPanel(ctx, el);  break;
        case 'label':  this._drawLabel(ctx, el);  break;
        case 'bar':    this._drawBar(ctx, el);    break;
        case 'button': this._drawButton(ctx, el); break;
      }
    }

    ctx.restore();
  }

  // ── Private draw helpers ───────────────────────────────────────────────────

  private _drawPanel(ctx: CanvasRenderingContext2D, el: HudPanel): void {
    ctx.save();
    this._roundRect(ctx, el.x, el.y, el.w, el.h, el.radius);
    ctx.fillStyle = el.bgColor;
    ctx.fill();
    if (el.borderColor) {
      ctx.strokeStyle = el.borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private _drawLabel(ctx: CanvasRenderingContext2D, el: HudLabel): void {
    ctx.save();
    ctx.font = `${el.fontSize}px ${el.font}`;
    if (el.shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(el.text, el.x + 1, el.y + 1);
    }
    ctx.fillStyle = el.color;
    ctx.fillText(el.text, el.x, el.y);
    ctx.restore();
  }

  private _drawBar(ctx: CanvasRenderingContext2D, el: HudBar): void {
    ctx.save();
    const v = Math.max(0, Math.min(1, el.value));

    // Background
    ctx.fillStyle = el.bgColor;
    ctx.fillRect(el.x, el.y, el.w, el.h);

    // Fill
    if (v > 0) {
      ctx.fillStyle = el.color;
      ctx.fillRect(el.x, el.y, el.w * v, el.h);
    }

    // Border
    ctx.strokeStyle = el.borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(el.x, el.y, el.w, el.h);

    // Label
    if (el.label) {
      ctx.font = `${el.fontSize}px sans-serif`;
      ctx.fillStyle = el.labelColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(el.label, el.x + 4, el.y + el.h / 2);
    }

    ctx.restore();
  }

  private _drawButton(ctx: CanvasRenderingContext2D, el: HudButton): void {
    ctx.save();
    this._roundRect(ctx, el.x, el.y, el.w, el.h, 4);
    ctx.fillStyle = el._hovered ? el.hoverColor : el.bgColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = `${el.fontSize}px sans-serif`;
    ctx.fillStyle = el.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.label, el.x + el.w / 2, el.y + el.h / 2);
    ctx.restore();
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number, r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Register an element, replacing any existing one with the same id **in
   * place** so the draw order is preserved.
   *
   * The map used to be overwritten while the array was appended to, so a HUD
   * rebuilt on scene entry kept drawing every previous generation of each
   * element and only the newest was reachable through `get()`.
   */
  private _add(el: HudElement): void {
    const existing = this._map.get(el.id);
    if (existing) {
      const index = this._elements.indexOf(existing);
      if (index >= 0) this._elements[index] = el;
      else this._elements.push(el);
      this._forget(existing);
    } else {
      this._elements.push(el);
    }
    this._map.set(el.id, el);
  }
}
