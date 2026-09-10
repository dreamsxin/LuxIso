import { Component } from '../Component';
import { IsoObject } from '../../elements/IsoObject';
import { SpriteSheet } from '../../animation/SpriteSheet';
import { AnimationController } from '../../animation/AnimationController';

export interface AnimationOptions {
  spriteSheet: SpriteSheet;
  initialClip?: string;
  autoUpdateDirection?: boolean;
}

/**
 * AnimationComponent — handles sprite animation and direction updates.
 *
 * Attach to an Entity to enable 8-direction sprite rendering.
 *
 * @example
 *   const anim = entity.addComponent(new AnimationComponent({
 *     spriteSheet: mySheet,
 *     initialClip: 'idle'
 *   }));
 *   anim.play('walk');
 */
export class AnimationComponent implements Component {
  readonly componentType = 'animation' as const;

  private _owner: IsoObject | null = null;
  private _controller: AnimationController;
  private _autoUpdateDirection: boolean;
  private _lastX = 0;
  private _lastY = 0;
  private _lastTs: number | null = null;

  constructor(opts: AnimationOptions) {
    this._controller = new AnimationController(opts.spriteSheet, opts.initialClip ?? 'idle');
    this._autoUpdateDirection = opts.autoUpdateDirection ?? true;
  }

  onAttach(owner: IsoObject): void {
    this._owner = owner;
    this._lastX = owner.position.x;
    this._lastY = owner.position.y;
  }

  onDetach(): void {
    this._owner = null;
  }

  get controller(): AnimationController {
    return this._controller;
  }

  play(clipName: string): void {
    this._controller.play(clipName);
  }

  update(ts?: number): void {
    if (!this._owner) return;

    const now = ts ?? performance.now();
    // `null`, not 0: a timestamp of 0 is legitimate, and the old
    // `_lastTs === 0` sentinel stayed armed through it, so the frame right
    // after it advanced by an invented 16 ms instead of its real delta.
    // A backwards timestamp used to rewind the clip.
    const dt = this._lastTs === null
      ? 0
      : Math.min(Math.max(0, (now - this._lastTs) / 1000), 0.1);
    this._lastTs = now;

    if (this._autoUpdateDirection) {
      const dx = this._owner.position.x - this._lastX;
      const dy = this._owner.position.y - this._lastY;
      if (Math.hypot(dx, dy) > 0.0005) {
        this._controller.direction = AnimationController.directionFrom(dx, dy);
      }
      this._lastX = this._owner.position.x;
      this._lastY = this._owner.position.y;
    }

    this._controller.update(dt);
  }
}
