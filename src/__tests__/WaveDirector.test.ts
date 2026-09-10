import { describe, it, expect, vi } from 'vitest';
import { WaveDirector } from '../../examples/10-arpg/WaveDirector';

/**
 * The ARPG demo's run structure. Every timing rule the engine's own modules
 * settled on this cycle applies here too: a non-finite or non-positive `dt` is
 * ignored, and a long frame must not stretch a countdown — the overshoot is
 * carried into the next phase instead.
 */

describe('WaveDirector', () => {
  it('starts in ready with nothing alive', () => {
    const d = new WaveDirector();
    expect(d.phase).toBe('ready');
    expect(d.wave).toBe(0);
    expect(d.mobsAlive).toBe(0);
    expect(d.kills).toBe(0);
    expect(d.isOver).toBe(false);
  });

  it('spawns wave 1 on start and reports the count', () => {
    const onSpawnWave = vi.fn();
    const d = new WaveDirector({ onSpawnWave });
    d.start();
    expect(d.phase).toBe('wave');
    expect(d.wave).toBe(1);
    expect(d.mobsAlive).toBe(3); // default 2 + n
    expect(onSpawnWave).toHaveBeenCalledWith(1, 3);
  });

  it('ignores a second start', () => {
    const onSpawnWave = vi.fn();
    const d = new WaveDirector({ onSpawnWave });
    d.start();
    d.reportMobDefeated();
    d.start();
    expect(d.mobsAlive).toBe(2);
    expect(onSpawnWave).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate elapsed before the run starts', () => {
    const d = new WaveDirector();
    d.update(1);
    expect(d.elapsed).toBe(0);
    d.start();
    d.update(0.5);
    expect(d.elapsed).toBeCloseTo(0.5);
  });

  it('ignores non-finite and non-positive dt', () => {
    const d = new WaveDirector();
    d.start();
    d.update(NaN);
    d.update(Infinity);
    d.update(0);
    d.update(-5);
    expect(d.elapsed).toBe(0);
  });

  it('enters the intermission when the last mob of a wave falls', () => {
    const d = new WaveDirector({ intermission: 2 });
    d.start();
    for (let i = 0; i < 3; i++) d.reportMobDefeated();
    expect(d.phase).toBe('intermission');
    expect(d.kills).toBe(3);
    expect(d.countdown).toBeCloseTo(2);
  });

  it('reports countdown 0 outside the intermission', () => {
    const d = new WaveDirector();
    d.start();
    expect(d.countdown).toBe(0);
  });

  it('counts the intermission down and starts the next wave', () => {
    const onSpawnWave = vi.fn();
    const d = new WaveDirector({ intermission: 2, onSpawnWave });
    d.start();
    for (let i = 0; i < 3; i++) d.reportMobDefeated();
    d.update(1.5);
    expect(d.phase).toBe('intermission');
    expect(d.countdown).toBeCloseTo(0.5);
    d.update(0.5);
    expect(d.phase).toBe('wave');
    expect(d.wave).toBe(2);
    expect(d.mobsAlive).toBe(4);
    expect(onSpawnWave).toHaveBeenLastCalledWith(2, 4);
  });

  it('carries the overshoot of a long frame into the new wave', () => {
    const d = new WaveDirector({ intermission: 2 });
    d.start();
    for (let i = 0; i < 3; i++) d.reportMobDefeated();
    d.update(5); // 2 s of intermission + 3 s of play
    expect(d.phase).toBe('wave');
    expect(d.wave).toBe(2);
    expect(d.elapsed).toBeCloseTo(5);
  });

  it('runs a zero-length intermission out on the next update', () => {
    const d = new WaveDirector({ intermission: 0 });
    d.start();
    for (let i = 0; i < 3; i++) d.reportMobDefeated();
    expect(d.phase).toBe('intermission');
    d.update(0.016);
    expect(d.phase).toBe('wave');
    expect(d.wave).toBe(2);
  });

  it('spawns the boss instead of a fourth wave', () => {
    const onSpawnBoss = vi.fn();
    const d = new WaveDirector({ waves: 2, mobsPerWave: () => 1, intermission: 1, onSpawnBoss });
    d.start();
    d.reportMobDefeated();
    d.update(1);
    expect(d.wave).toBe(2);
    d.reportMobDefeated();
    expect(d.phase).toBe('boss');
    expect(d.mobsAlive).toBe(1);
    expect(onSpawnBoss).toHaveBeenCalledTimes(1);
  });

  it('reaches victory when the boss falls', () => {
    const d = new WaveDirector({ waves: 1, mobsPerWave: () => 1 });
    d.start();
    d.reportMobDefeated();
    expect(d.phase).toBe('boss');
    d.reportMobDefeated();
    expect(d.phase).toBe('victory');
    expect(d.isOver).toBe(true);
    expect(d.kills).toBe(2);
  });

  it('freezes the clock and further kills once over', () => {
    const d = new WaveDirector({ waves: 1, mobsPerWave: () => 1 });
    d.start();
    d.reportMobDefeated();
    d.reportMobDefeated();
    const elapsed = d.elapsed;
    d.update(3);
    d.reportMobDefeated();
    expect(d.elapsed).toBe(elapsed);
    expect(d.kills).toBe(2);
    expect(d.phase).toBe('victory');
  });

  it('defeat wins over any phase and is final', () => {
    const d = new WaveDirector();
    d.start();
    d.reportHeroDefeated();
    expect(d.phase).toBe('defeat');
    d.reportHeroDefeated();
    d.reportMobDefeated();
    expect(d.phase).toBe('defeat');
    expect(d.kills).toBe(0);
    expect(d.isOver).toBe(true);
  });

  it('ignores a kill report with nothing alive', () => {
    const d = new WaveDirector({ intermission: 5 });
    d.start();
    for (let i = 0; i < 3; i++) d.reportMobDefeated();
    d.reportMobDefeated(); // stray report during the intermission
    expect(d.kills).toBe(3);
    expect(d.phase).toBe('intermission');
  });

  it('announces every phase transition once, with the previous phase', () => {
    const seen: string[][] = [];
    const d = new WaveDirector({
      waves: 1,
      mobsPerWave: () => 1,
      onPhase: (phase, previous) => seen.push([previous, phase]),
    });
    d.start();
    d.reportMobDefeated();
    d.reportMobDefeated();
    expect(seen).toEqual([
      ['ready', 'wave'],
      ['wave', 'boss'],
      ['boss', 'victory'],
    ]);
  });

  it('clamps hostile options instead of breaking the run', () => {
    const d = new WaveDirector({ waves: 0, mobsPerWave: () => -3, intermission: -1 });
    expect(d.totalWaves).toBe(1);
    d.start();
    expect(d.mobsAlive).toBe(1);
    d.reportMobDefeated();
    expect(d.phase).toBe('boss');
  });

  it('floors a fractional mob count', () => {
    const d = new WaveDirector({ mobsPerWave: () => 2.9 });
    d.start();
    expect(d.mobsAlive).toBe(2);
  });
});
