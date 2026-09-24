import {AssetLoader} from '../core/AssetLoader';

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnimationClip {
  /** Unique animation name, e.g. 'idle', 'walk', 'attack' */
  name: string;
  /** Frame rects on the sprite sheet, in playback order */
  frames: FrameRect[];
  /** Frames per second */
  fps: number;
  /** Whether the animation loops */
  loop?: boolean;
}

export interface SpriteSheetOptions {
  /** URL of the sprite sheet image */
  url: string;
  /** Named animation clips */
  clips: AnimationClip[];
  /**
   * Scale factor applied when drawing (1 = natural pixel size).
   * Useful for hi-DPI or tile-size normalisation.
   */
  scale?: number;
  /**
   * Vertical anchor as a fraction of frame height (0 = top, 1 = bottom).
   * Default 1 (bottom-anchored, typical for isometric characters).
   */
  anchorY?: number;
}

export class SpriteSheet {
  readonly url: string;
  readonly clips: Map<string, AnimationClip>;
  readonly scale: number;
  readonly anchorY: number;

  constructor(opts: SpriteSheetOptions) {
    this.url = opts.url;
    this.scale = opts.scale ?? 1;
    this.anchorY = opts.anchorY ?? 1;
    this.clips = new Map(opts.clips.map(c => [c.name, c]));
  }

  /** Preload the underlying image. */
  async preload(): Promise<void> {
    await AssetLoader.loadImage(this.url);
  }

  /** Returns the loaded image or undefined if not yet preloaded. */
  get image(): HTMLImageElement | undefined {
    return AssetLoader.get(this.url);
  }

  /** Get a clip by name; throws if not found. */
  getClip(name: string): AnimationClip {
    const clip = this.clips.get(name);
    if (!clip) {throw new Error(`SpriteSheet: clip "${name}" not found`);}
    return clip;
  }

  hasClip(name: string): boolean {
    return this.clips.has(name);
  }
}
