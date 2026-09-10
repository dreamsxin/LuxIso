import { SpriteSheet, AnimationClip } from './SpriteSheet';

/**
 * 8-direction enum for isometric characters.
 * SE = moving right+down on screen (positive x+y in iso world).
 */
export type Direction = 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE' | 'E' | 'SE';

/**
 * Controls animation playback for a single character.
 * Tracks the current clip, elapsed time, and current frame index.
 */
export class AnimationController {
  private sheet: SpriteSheet;
  private clip: AnimationClip;
  private elapsed = 0;
  private _frame = 0;
  private _done = false;
  private _onComplete: (() => void) | null = null;
  /**
   * Set by `playOnce`, which must not loop even when the clip is flagged
   * `loop: true` (or leaves the flag off, which also means looping). Without it
   * an attack clip cycled forever, so the completion callback never fired and
   * the controller never returned to the idle clip. `DirectionalAnimator`
   * carries the same flag for the same reason.
   */
  private _forceOnce = false;

  direction: Direction = 'S';

  constructor(sheet: SpriteSheet, initialClip = 'idle') {
    this.sheet = sheet;
    // Validate clip exists; fall back to first clip if not found
    this.clip = sheet.hasClip(initialClip)
      ? sheet.getClip(initialClip)
      : sheet.clips.values().next().value ?? { name: initialClip, frames: [], fps: 1 };
  }

  /**
   * Switch to a named animation clip.
   * No-op if already playing the same clip.
   * Warns if clip doesn't exist and returns false.
   */
  play(name: string): boolean {
    if (!this.sheet.hasClip(name)) {
      console.warn(`AnimationController: clip "${name}" not found on sheet "${this.sheet.url}"`);
      return false;
    }
    if (this.clip.name === name) return true;
    this.clip = this.sheet.getClip(name);
    this.elapsed = 0;
    this._frame = 0;
    this._done = false;
    this._forceOnce = false;
    this._onComplete = null;
    return true;
  }

  /**
   * Play a non-looping clip once, then call `onComplete`.
   * Automatically switches back to `returnTo` clip when done (default 'idle').
   *
   * The clip's own `loop` flag is overridden for this playback — see
   * `_forceOnce`. A later `play()` cancels the one-shot.
   */
  playOnce(name: string, onComplete?: () => void, returnTo = 'idle'): boolean {
    if (!this.sheet.hasClip(name)) {
      console.warn(`AnimationController: clip "${name}" not found`);
      return false;
    }
    this.clip = this.sheet.getClip(name);
    this.elapsed = 0;
    this._frame = 0;
    this._done = false;
    this._forceOnce = true;
    this._onComplete = () => {
      onComplete?.();
      if (returnTo && this.sheet.hasClip(returnTo)) this.play(returnTo);
    };
    return true;
  }

  /** Advance animation by `dt` seconds (call once per frame). */
  update(dt: number): void {
    if (this._done) return;
    this.elapsed += dt;
    const frameDuration = 1 / this.clip.fps;
    const totalFrames = this.clip.frames.length;
    if (totalFrames === 0) return;
    const totalDuration = frameDuration * totalFrames;

    const shouldLoop = this._forceOnce ? false : (this.clip.loop ?? true);
    if (shouldLoop) {
      this._frame = Math.floor((this.elapsed % totalDuration) / frameDuration);
    } else {
      if (this.elapsed >= totalDuration) {
        this._frame = totalFrames - 1;
        if (!this._done) {
          this._done = true;
          const cb = this._onComplete;
          this._onComplete = null;
          cb?.();
        }
      } else {
        this._frame = Math.floor(this.elapsed / frameDuration);
      }
    }
  }

  /** Reset playback to the beginning of the current clip. */
  reset(): void {
    this.elapsed = 0;
    this._frame = 0;
    this._done = false;
    this._forceOnce = false;
    this._onComplete = null;
  }

  get frameIndex(): number { return this._frame; }
  get done(): boolean { return this._done; }
  get currentClip(): AnimationClip { return this.clip; }
  get spriteSheet(): SpriteSheet { return this.sheet; }

  /**
   * Infer movement direction from world-space delta vector.
   * Handles 8 directions with 45° sectors.
   */
  static directionFrom(dx: number, dy: number): Direction {
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return 'S';
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const a = ((angle + 360) % 360);
    if (a < 22.5 || a >= 337.5) return 'E';
    if (a < 67.5)  return 'SE';
    if (a < 112.5) return 'S';
    if (a < 157.5) return 'SW';
    if (a < 202.5) return 'W';
    if (a < 247.5) return 'NW';
    if (a < 292.5) return 'N';
    return 'NE';
  }
}
