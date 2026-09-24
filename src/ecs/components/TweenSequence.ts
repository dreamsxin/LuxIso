/**
 * TweenSequence — chain multiple TweenComponent configs into a sequential animation.
 *
 * Each step plays after the previous one completes. Supports delays between steps,
 * callbacks at each step, and an overall onComplete.
 *
 * @example
 *   entity.addComponent(new TweenSequence([
 *     { targets: [{ prop: 'z', from: 0, to: 48 }], duration: 0.3, easing: Easing.easeOut },
 *     { targets: [{ prop: 'z', from: 48, to: 0 }], duration: 0.5, easing: Easing.bounce },
 *   ], { repeat: -1 }));
 */
import {IsoObject} from '../../elements/IsoObject';
import {Component} from '../Component';
import {TweenComponent, TweenOptions} from './TweenComponent';

export interface TweenSequenceOptions {
  /** Number of times to repeat the full sequence. -1 = infinite. Default 0 (once). */
  repeat?: number;
  /** Called when the full sequence completes (one pass). */
  onComplete?: () => void;
}

export class TweenSequence implements Component {
  readonly componentType = 'tweenSequence' as const;

  private _steps: TweenOptions[];
  private _opts: TweenSequenceOptions;
  private _owner: IsoObject | null = null;
  private _current: TweenComponent | null = null;
  private _stepIdx = 0;
  private _iteration = 0;
  private _done = false;

  constructor(steps: TweenOptions[], opts: TweenSequenceOptions = {}) {
    this._steps = steps;
    this._opts = opts;
  }

  onAttach(owner: IsoObject): void {
    this._owner = owner;
    this._startStep(0);
  }

  onDetach(): void {
    this._owner = null;
    this._current = null;
  }

  get isDone(): boolean { return this._done; }
  get stepIndex(): number { return this._stepIdx; }

  update(ts?: number): void {
    if (!this._owner || !this._current || this._done) {return;}
    this._current.update(ts);

    if (this._current.isDone) {
      const nextIdx = this._stepIdx + 1;
      if (nextIdx < this._steps.length) {
        this._startStep(nextIdx);
      } else {
        // Sequence pass complete
        this._opts.onComplete?.();
        const repeat = this._opts.repeat ?? 0;
        this._iteration++;
        const maxIter = repeat === -1 ? Infinity : repeat + 1;
        if (this._iteration < maxIter) {
          this._startStep(0);
        } else {
          this._done = true;
          this._current = null;
        }
      }
    }
  }

  private _startStep(idx: number): void {
    this._stepIdx = idx;
    const stepOpts = this._steps[idx];
    this._current = new TweenComponent(stepOpts);
    this._current.onAttach(this._owner!);
  }
}
