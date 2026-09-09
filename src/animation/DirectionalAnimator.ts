/**
 * DirectionalAnimator — 8-direction × multi-action sprite animation manager.
 *
 * Clip naming convention:  `{action}_{direction}`
 *   e.g.  idle_S, walk_SE, attack_NW, die_N
 *
 * Direction fallback chain (when a specific direction clip is missing):
 *   S  → S
 *   SE → S  → E
 *   E  → SE → S
 *   NE → E  → SE → S
 *   N  → NE → NW → E → W → S
 *   NW → W  → SW → S
 *   W  → SW → S
 *   SW → S  → W
 *
 * If no directional variant exists, falls back to the bare action name (e.g. 'idle').
 *
 * Usage:
 *   const anim = new DirectionalAnimator(sheet);
 *   anim.setAction('walk');
 *   anim.setDirection(AnimationController.directionFrom(dx, dy));
 *   anim.update(dt);
 *   // In draw:
 *   const { frame, image } = anim.currentFrame();
 *   ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, ...);
 */
import { SpriteSheet, AnimationClip, FrameRect } from './SpriteSheet';
import { Direction } from './AnimationController';

export type ActionName = string;

/** Fallback chains: for each direction, ordered list of directions to try. */
const FALLBACK: Record<Direction, Direction[]> = {
  S:  ['S'],
  SE: ['SE', 'S', 'E'],
  E:  ['E', 'SE', 'S'],
  NE: ['NE', 'E', 'SE', 'S'],
  N:  ['N', 'NE', 'NW', 'E', 'W', 'S'],
  NW: ['NW', 'W', 'SW', 'S'],
  W:  ['W', 'SW', 'S'],
  SW: ['SW', 'S', 'W'],
};

export interface DirectionalAnimatorOptions {
  /** Default action on construction. Default 'idle'. */
  initialAction?: ActionName;
  /** Default direction. Default 'S'. */
  initialDirection?: Direction;
}

export class DirectionalAnimator {
  private _sheet: SpriteSheet;
  private _action: ActionName;
  private _direction: Direction;
  private _clip: AnimationClip | null = null;

  private _elapsed = 0;
  private _frame   = 0;
  private _done    = false;
  private _onComplete: (() => void) | null = null;
  /**
   * Set by `playOnce`, which must not loop even when the resolved clip is
   * flagged `loop: true`. `buildSheet` defaults every clip to `loop: true`, so
   * without this an attack built through it would cycle forever and the
   * completion callback (and the return to the idle action) would never fire.
   */
  private _forceOnce = false;

  constructor(sheet: SpriteSheet, opts: DirectionalAnimatorOptions = {}) {
    this._sheet     = sheet;
    this._action    = opts.initialAction    ?? 'idle';
    this._direction = opts.initialDirection ?? 'S';
    this._resolveClip();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get action(): ActionName    { return this._action; }
  get direction(): Direction  { return this._direction; }
  get frameIndex(): number    { return this._frame; }
  get done(): boolean         { return this._done; }
  get spriteSheet(): SpriteSheet { return this._sheet; }

  /** Current clip name (resolved with fallback). */
  get clipName(): string { return this._clip?.name ?? this._action; }

  /**
   * Switch action (e.g. 'idle' → 'walk').
   * Resets playback if the resolved clip changes.
   */
  setAction(action: ActionName, onComplete?: () => void): void {
    const prev = this._clip?.name;
    this._action = action;
    this._onComplete = onComplete ?? null;
    this._forceOnce = false;
    this._resolveClip();
    if (this._clip?.name !== prev) this._resetPlayback();
  }

  /**
   * Update movement direction.
   * Resets playback only if the resolved clip changes.
   */
  setDirection(dir: Direction): void {
    if (dir === this._direction) return;
    const prev = this._clip?.name;
    this._direction = dir;
    this._resolveClip();
    if (this._clip?.name !== prev) this._resetPlayback();
  }

  /**
   * Convenience: set both action and direction atomically.
   * Only resets playback once if either changes.
   */
  set(action: ActionName, dir: Direction, onComplete?: () => void): void {
    const prev = this._clip?.name;
    this._action    = action;
    this._direction = dir;
    this._onComplete = onComplete ?? null;
    this._forceOnce = false;
    this._resolveClip();
    if (this._clip?.name !== prev) this._resetPlayback();
  }

  /**
   * Play a one-shot action (non-looping), then return to `returnTo`.
   * Useful for attack, hit, die animations.
   *
   * The clip's own `loop` flag is overridden for this playback — see
   * `_forceOnce`. Changing direction mid-flight restarts the one-shot facing
   * the new way; calling `setAction`/`set` cancels it.
   */
  playOnce(action: ActionName, returnTo: ActionName = 'idle', onComplete?: () => void): void {
    this._action = action;
    this._resolveClip();
    this._resetPlayback();
    this._forceOnce = true;
    this._onComplete = () => {
      onComplete?.();
      this.setAction(returnTo);
    };
  }

  /** Advance animation by `dt` seconds. */
  update(dt: number): void {
    if (!this._clip || this._done) return;
    this._elapsed += dt;

    const fps = this._clip.fps;
    const totalFrames = this._clip.frames.length;
    if (totalFrames === 0 || fps <= 0) return;

    const frameDur   = 1 / fps;
    const totalDur   = frameDur * totalFrames;
    const shouldLoop = this._forceOnce ? false : (this._clip.loop ?? true);

    if (shouldLoop) {
      this._frame = Math.floor((this._elapsed % totalDur) / frameDur);
    } else {
      if (this._elapsed >= totalDur) {
        this._frame = totalFrames - 1;
        if (!this._done) {
          this._done = true;
          const cb = this._onComplete;
          this._onComplete = null;
          cb?.();
        }
      } else {
        this._frame = Math.floor(this._elapsed / frameDur);
      }
    }
  }

  /**
   * Returns the current frame rect and the loaded image.
   * Returns null if the sheet image is not yet loaded.
   */
  currentFrame(): { frame: FrameRect; image: HTMLImageElement } | null {
    const img = this._sheet.image;
    if (!img || !this._clip || this._clip.frames.length === 0) return null;
    return { frame: this._clip.frames[this._frame], image: img };
  }

  // ── Clip resolution ────────────────────────────────────────────────────────

  /**
   * Resolve the best available clip for the current action + direction.
   * Tries directional variants first, then bare action name.
   */
  private _resolveClip(): void {
    const fallbacks = FALLBACK[this._direction] ?? [this._direction];
    for (const dir of fallbacks) {
      const name = `${this._action}_${dir}`;
      if (this._sheet.hasClip(name)) {
        this._clip = this._sheet.getClip(name);
        return;
      }
    }
    // Bare action fallback (no direction suffix)
    if (this._sheet.hasClip(this._action)) {
      this._clip = this._sheet.getClip(this._action);
      return;
    }
    // Last resort: first clip in sheet
    const first = this._sheet.clips.values().next().value;
    this._clip = first ?? null;
    if (!this._clip) {
      console.warn(`DirectionalAnimator: no clip found for action="${this._action}" dir="${this._direction}"`);
    }
  }

  private _resetPlayback(): void {
    this._elapsed = 0;
    this._frame   = 0;
    this._done    = false;
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  /**
   * Generate all 8-direction clip names for a given action.
   * Useful for verifying a sprite sheet has all required clips.
   */
  static clipNamesFor(action: ActionName): string[] {
    const dirs: Direction[] = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
    return dirs.map(d => `${action}_${d}`);
  }

  /**
   * Check which directional clips are present / missing for an action.
   */
  static auditSheet(sheet: SpriteSheet, action: ActionName): {
    present: string[];
    missing: string[];
  } {
    const all = DirectionalAnimator.clipNamesFor(action);
    return {
      present: all.filter(n => sheet.hasClip(n)),
      missing: all.filter(n => !sheet.hasClip(n)),
    };
  }

  /**
   * Build a SpriteSheet from a standard grid layout where each row is one
   * direction and each column is one frame.
   *
   * Layout (row order): S, SW, W, NW, N, NE, E, SE
   *
   * @param url        Sprite sheet image URL
   * @param frameW     Width of each frame in pixels
   * @param frameH     Height of each frame in pixels
   * @param actions    Array of action configs: { name, rowStart, frameCount, fps, loop? }
   * @param scale      Draw scale (default 1)
   */
  static buildSheet(
    url: string,
    frameW: number,
    frameH: number,
    actions: Array<{
      name: ActionName;
      /** Starting row index (0-based) for the first direction (S). */
      rowStart: number;
      frameCount: number;
      fps: number;
      loop?: boolean;
    }>,
    scale = 1,
    anchorY = 1,
  ): SpriteSheet {
    const DIRS: Direction[] = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'];
    const clips = [];

    for (const action of actions) {
      for (let di = 0; di < DIRS.length; di++) {
        const row = action.rowStart + di;
        const frames = Array.from({ length: action.frameCount }, (_, col) => ({
          x: col * frameW,
          y: row * frameH,
          w: frameW,
          h: frameH,
        }));
        clips.push({
          name:  `${action.name}_${DIRS[di]}`,
          frames,
          fps:   action.fps,
          loop:  action.loop ?? true,
        });
      }
    }

    return new SpriteSheet({ url, clips, scale, anchorY });
  }
}
