/**
 * WaveDirector — the ARPG demo's run structure: three waves, then a boss.
 *
 * Deliberately free of Scene, Engine and DOM: spawning and death are reported in
 * and out through callbacks, so the whole loop (including the results screen) is
 * unit-testable without a canvas. `main.ts` owns the entities; this owns *when*.
 */

export type ArpgPhase = 'ready' | 'wave' | 'intermission' | 'boss' | 'victory' | 'defeat';

export interface WaveDirectorOptions {
  /** Normal waves before the boss. Default 3. */
  waves?: number;
  /** Mobs in wave `n` (1-based). Default `2 + n`. */
  mobsPerWave?: (wave: number) => number;
  /** Seconds of breathing room between waves. Default 2.5. */
  intermission?: number;
  onSpawnWave?: (wave: number, count: number) => void;
  onSpawnBoss?: () => void;
  onPhase?: (phase: ArpgPhase, previous: ArpgPhase) => void;
}

export class WaveDirector {
  private readonly _waves: number;
  private readonly _mobsPerWave: (wave: number) => number;
  private readonly _intermission: number;
  private readonly _opts: WaveDirectorOptions;

  private _phase: ArpgPhase = 'ready';
  private _wave = 0;
  private _alive = 0;
  private _kills = 0;
  private _elapsed = 0;
  private _countdown = 0;

  constructor(opts: WaveDirectorOptions = {}) {
    this._opts = opts;
    this._waves = Math.max(1, Math.floor(opts.waves ?? 3));
    this._mobsPerWave = opts.mobsPerWave ?? ((wave) => 2 + wave);
    this._intermission = Math.max(0, opts.intermission ?? 2.5);
  }

  get phase(): ArpgPhase { return this._phase; }
  /** 1-based wave number; 0 before the run starts. */
  get wave(): number { return this._wave; }
  get totalWaves(): number { return this._waves; }
  get mobsAlive(): number { return this._alive; }
  get kills(): number { return this._kills; }
  /** Seconds of active play, for the results screen. */
  get elapsed(): number { return this._elapsed; }
  /** Seconds left of the intermission, 0 outside it. */
  get countdown(): number { return this._phase === 'intermission' ? this._countdown : 0; }
  get isOver(): boolean { return this._phase === 'victory' || this._phase === 'defeat'; }

  /** Begin the run. Ignored once started. */
  start(): void {
    if (this._phase !== 'ready') return;
    this._beginWave(1);
  }

  /**
   * Advance the clock. `dt` is seconds; a negative or non-finite value is
   * ignored rather than rewinding the run — the same rule the engine's own
   * modules settled on.
   */
  update(dt: number): void {
    if (this.isOver || this._phase === 'ready') return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    this._elapsed += dt;
    if (this._phase !== 'intermission') return;

    this._countdown -= dt;
    if (this._countdown > 0) return;
    // A long frame must not stretch the intermission: its overshoot is already
    // counted in `_elapsed`, so the leftover countdown is simply dropped and the
    // next wave begins in the same frame.
    this._countdown = 0;
    this._beginWave(this._wave + 1);
  }

  /** Report one mob defeated. Ends the wave when the last one falls. */
  reportMobDefeated(): void {
    if (this.isOver || this._alive === 0) return;
    this._alive--;
    this._kills++;
    if (this._alive > 0) return;

    if (this._phase === 'boss') { this._setPhase('victory'); return; }
    if (this._wave >= this._waves) {
      this._setPhase('boss');
      this._alive = 1;
      this._opts.onSpawnBoss?.();
      return;
    }
    this._countdown = this._intermission;
    this._setPhase('intermission');
  }

  /** Report the hero dead. Ends the run wherever it is. */
  reportHeroDefeated(): void {
    if (this.isOver) return;
    this._setPhase('defeat');
  }

  private _beginWave(wave: number): void {
    this._wave = wave;
    const count = Math.max(1, Math.floor(this._mobsPerWave(wave)));
    this._alive = count;
    this._setPhase('wave');
    this._opts.onSpawnWave?.(wave, count);
  }

  private _setPhase(phase: ArpgPhase): void {
    if (phase === this._phase) return;
    const previous = this._phase;
    this._phase = phase;
    this._opts.onPhase?.(phase, previous);
  }
}
