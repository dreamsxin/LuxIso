/**
 * SandDust — ambient sand-dust particle system for the desert scene.
 */
import {IsoObject, DrawContext} from '../../src/elements/IsoObject';
import {ParticleSystem, EmitterConfig} from '../../src/animation/ParticleSystem';
import {AABB} from '../../src/math/depthSort';

export class SandDustSystem extends IsoObject {
  private _ps: ParticleSystem;
  readonly cols: number;
  readonly rows: number;
  speedMult = 1;

  constructor(id: string, cols: number, rows: number) {
    super(id, 0, 0, 0);
    this.cols = cols;
    this.rows = rows;
    this.castsShadow = false;

    // Place emitter at scene centre; large spawnRadius covers whole scene.
    this._ps = new ParticleSystem(`${id}-ps`, cols / 2, rows / 2, 0);

    const preset = ParticleSystem.presets.ambientDrift({
      color: ['#e8c870', '#d4a850', '#f0d890'],
      count: 60,
      speed: [0.1, 0.4],
      size: [2, 5],
      alpha: 0.3,
      blend: 'screen',
    }) as EmitterConfig;

    this._ps.addEmitter({
      ...preset,
      shape: 'circle',
      spawnRadius: Math.max(cols, rows) * 0.6,
    });
  }

  get aabb(): AABB {
    return {minX: 0, minY: 0, maxX: this.cols, maxY: this.rows, baseZ: 0};
  }

  update(ts?: number): void {
    // Adjust emitter rate & speed based on speedMult
    // `_emitters` is TS-private on ParticleSystem; a structural cast names the
    // one field this example reaches for instead of widening to `any`.
    const internals = this._ps as unknown as {_emitters: {config: EmitterConfig}[]};
    const e = internals._emitters[0] as {config: EmitterConfig} | undefined;
    if (e?.config) {
      e.config.rate = Math.round(60 * this.speedMult);
      e.config.speed = [0.1 * this.speedMult, 0.4 * this.speedMult];
    }
    this._ps.update(ts);
  }

  draw(dc: DrawContext): void {
    this._ps.draw(dc);
  }
}
