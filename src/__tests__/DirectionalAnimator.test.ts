import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpriteSheet } from '../animation/SpriteSheet';
import { DirectionalAnimator } from '../animation/DirectionalAnimator';
import { AssetLoader } from '../core/AssetLoader';

/**
 * DirectionalAnimator was at 0% coverage despite carrying a fully documented
 * public API. Writing these tests surfaced two defects: `playOnce` never
 * actually played once when the clip was flagged `loop: true` (which is what
 * `buildSheet` produces by default), and the class docstring described a
 * different N-direction fallback chain than the code implements.
 */

function frames(n: number): { x: number; y: number; w: number; h: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * 16, y: 0, w: 16, h: 16 }));
}

function sheetWith(
  clips: { name: string; fps?: number; loop?: boolean; count?: number }[],
): SpriteSheet {
  return new SpriteSheet({
    url: '/sheet.png',
    clips: clips.map((c) => ({
      name: c.name,
      frames: frames(c.count ?? 4),
      fps: c.fps ?? 10,
      loop: c.loop,
    })),
  });
}

afterEach(() => {
  AssetLoader.clear();
  vi.restoreAllMocks();
});

describe('DirectionalAnimator — construction', () => {
  it('defaults to idle facing S', () => {
    const anim = new DirectionalAnimator(sheetWith([{ name: 'idle_S' }]));
    expect(anim.action).toBe('idle');
    expect(anim.direction).toBe('S');
    expect(anim.clipName).toBe('idle_S');
    expect(anim.frameIndex).toBe(0);
    expect(anim.done).toBe(false);
  });

  it('honours initialAction and initialDirection', () => {
    const sheet = sheetWith([{ name: 'walk_NE' }, { name: 'idle_S' }]);
    const anim = new DirectionalAnimator(sheet, { initialAction: 'walk', initialDirection: 'NE' });
    expect(anim.clipName).toBe('walk_NE');
    expect(anim.spriteSheet).toBe(sheet);
  });
});

describe('DirectionalAnimator — clip resolution and fallback', () => {
  it('prefers the exact action_direction clip', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'walk_S' }, { name: 'walk_SE' }]),
      { initialAction: 'walk', initialDirection: 'SE' },
    );
    expect(anim.clipName).toBe('walk_SE');
  });

  it('walks the documented fallback chain for a missing direction', () => {
    // W → SW → S: only SW exists, so SW must win over S.
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'walk_S' }, { name: 'walk_SW' }]),
      { initialAction: 'walk', initialDirection: 'W' },
    );
    expect(anim.clipName).toBe('walk_SW');
  });

  it('falls back through N → NE → NW as implemented', () => {
    // The docstring used to claim N → NE → E → SE; the table actually goes
    // N → NE → NW → E → W → S, so NW must beat E here.
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'walk_E' }, { name: 'walk_NW' }]),
      { initialAction: 'walk', initialDirection: 'N' },
    );
    expect(anim.clipName).toBe('walk_NW');
  });

  it('falls back to the bare action name when no direction variant exists', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'idle' }]),
      { initialAction: 'idle', initialDirection: 'NE' },
    );
    expect(anim.clipName).toBe('idle');
  });

  it('falls back to the first clip and warns when nothing matches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'something_else' }]),
      { initialAction: 'attack' },
    );
    expect(anim.clipName).toBe('something_else');
    expect(warn).not.toHaveBeenCalled(); // a clip was found, just not a matching one
  });

  it('warns when the sheet has no clips at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const anim = new DirectionalAnimator(sheetWith([]));
    expect(warn).toHaveBeenCalled();
    expect(anim.currentFrame()).toBeNull();
  });
});

describe('DirectionalAnimator — playback', () => {
  it('advances frames at the clip fps and loops', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'walk_S', fps: 10, count: 4, loop: true }]),
      { initialAction: 'walk' },
    );
    anim.update(0.05); expect(anim.frameIndex).toBe(0);
    anim.update(0.05); expect(anim.frameIndex).toBe(1);
    anim.update(0.2);  expect(anim.frameIndex).toBe(3);
    anim.update(0.1);  expect(anim.frameIndex).toBe(0); // wrapped
    expect(anim.done).toBe(false);
  });

  it('holds the last frame and reports done for a non-looping clip', () => {
    const done = vi.fn();
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'attack_S', fps: 10, count: 3, loop: false }]),
      { initialAction: 'idle' },
    );
    anim.setAction('attack', done);

    anim.update(1.0);
    expect(anim.frameIndex).toBe(2);
    expect(anim.done).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);

    anim.update(1.0); // further updates must not re-fire
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('tolerates a zero-fps or empty clip without dividing by zero', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'idle_S', fps: 0 }]),
    );
    expect(() => anim.update(1)).not.toThrow();
    expect(anim.frameIndex).toBe(0);
  });
});

describe('DirectionalAnimator — playOnce', () => {
  it('does not loop even when the clip is flagged loop: true', () => {
    // This is exactly what DirectionalAnimator.buildSheet produces by default,
    // so before the fix playOnce cycled forever and never returned to idle.
    const returned = vi.fn();
    const anim = new DirectionalAnimator(
      sheetWith([
        { name: 'idle_S', loop: true },
        { name: 'attack_S', fps: 10, count: 3, loop: true },
      ]),
      { initialAction: 'idle' },
    );

    anim.playOnce('attack', 'idle', returned);
    expect(anim.clipName).toBe('attack_S');

    anim.update(1.0);

    expect(returned).toHaveBeenCalledTimes(1);
    expect(anim.action).toBe('idle');
    expect(anim.clipName).toBe('idle_S');
  });

  it('returns to the requested action, defaulting to idle', () => {
    const anim = new DirectionalAnimator(
      sheetWith([
        { name: 'idle_S' },
        { name: 'run_S' },
        { name: 'hit_S', fps: 20, count: 2, loop: true },
      ]),
    );
    anim.playOnce('hit', 'run');
    anim.update(1.0);
    expect(anim.action).toBe('run');
  });

  it('resumes looping once the one-shot has handed control back', () => {
    const anim = new DirectionalAnimator(
      sheetWith([
        { name: 'idle_S', fps: 10, count: 4, loop: true },
        { name: 'hit_S', fps: 10, count: 2, loop: true },
      ]),
    );
    anim.playOnce('hit');
    anim.update(1.0);
    expect(anim.action).toBe('idle');
    expect(anim.done).toBe(false);

    anim.update(0.5);
    anim.update(0.5);
    expect(anim.done).toBe(false); // idle keeps cycling
  });

  it('is cancelled by an explicit setAction', () => {
    const returned = vi.fn();
    const anim = new DirectionalAnimator(
      sheetWith([
        { name: 'idle_S', loop: true },
        { name: 'walk_S', loop: true },
        { name: 'attack_S', fps: 10, count: 3, loop: true },
      ]),
    );
    anim.playOnce('attack', 'idle', returned);
    anim.setAction('walk');

    anim.update(1.0);
    expect(anim.action).toBe('walk');
    expect(anim.done).toBe(false); // walk loops again
    expect(returned).not.toHaveBeenCalled();
  });
});

describe('DirectionalAnimator — reset semantics', () => {
  it('keeps playback position when the resolved clip is unchanged', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'walk_S', fps: 10, count: 4 }]),
      { initialAction: 'walk' },
    );
    anim.update(0.25);
    const at = anim.frameIndex;
    expect(at).toBe(2);

    // W falls back to walk_S here, i.e. the same clip → no reset.
    anim.setDirection('W');
    expect(anim.frameIndex).toBe(at);
  });

  it('restarts playback when the resolved clip changes', () => {
    const anim = new DirectionalAnimator(
      sheetWith([
        { name: 'walk_S', fps: 10, count: 4 },
        { name: 'walk_E', fps: 10, count: 4 },
      ]),
      { initialAction: 'walk' },
    );
    anim.update(0.25);
    expect(anim.frameIndex).toBe(2);

    anim.setDirection('E');
    expect(anim.clipName).toBe('walk_E');
    expect(anim.frameIndex).toBe(0);
  });

  it('ignores setDirection when the direction is unchanged', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'walk_S', fps: 10, count: 4 }]),
      { initialAction: 'walk' },
    );
    anim.update(0.25);
    anim.setDirection('S');
    expect(anim.frameIndex).toBe(2);
  });

  it('set() applies action and direction together', () => {
    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'idle_S' }, { name: 'walk_NE' }]),
    );
    anim.set('walk', 'NE');
    expect(anim.action).toBe('walk');
    expect(anim.direction).toBe('NE');
    expect(anim.clipName).toBe('walk_NE');
  });
});

describe('DirectionalAnimator — currentFrame', () => {
  it('returns null until the sheet image is available', () => {
    const anim = new DirectionalAnimator(sheetWith([{ name: 'idle_S' }]));
    expect(anim.currentFrame()).toBeNull();
  });

  it('returns the active frame rect once the image is registered', () => {
    const image = {} as HTMLImageElement;
    AssetLoader.register('/sheet.png', image);

    const anim = new DirectionalAnimator(
      sheetWith([{ name: 'idle_S', fps: 10, count: 4 }]),
    );
    anim.update(0.15);

    const current = anim.currentFrame();
    expect(current).not.toBeNull();
    expect(current!.image).toBe(image);
    expect(current!.frame).toEqual({ x: 16, y: 0, w: 16, h: 16 });
  });
});

describe('DirectionalAnimator — static helpers', () => {
  it('clipNamesFor lists all eight directions', () => {
    const names = DirectionalAnimator.clipNamesFor('walk');
    expect(names.length).toBe(8);
    expect(names).toContain('walk_S');
    expect(names).toContain('walk_NW');
    expect(new Set(names).size).toBe(8);
  });

  it('auditSheet splits present from missing clips', () => {
    const sheet = sheetWith([{ name: 'walk_S' }, { name: 'walk_E' }, { name: 'idle_S' }]);
    const { present, missing } = DirectionalAnimator.auditSheet(sheet, 'walk');
    expect(present.sort()).toEqual(['walk_E', 'walk_S']);
    expect(missing.length).toBe(6);
    expect(missing).not.toContain('walk_S');
  });

  it('buildSheet lays one direction per row and one frame per column', () => {
    const sheet = DirectionalAnimator.buildSheet(
      '/hero.png', 32, 48,
      [{ name: 'walk', rowStart: 0, frameCount: 3, fps: 8 }],
      2, 0.75,
    );

    expect(sheet.url).toBe('/hero.png');
    expect(sheet.scale).toBe(2);
    expect(sheet.anchorY).toBe(0.75);
    expect(sheet.clips.size).toBe(8);

    // Row order is S, SW, W, NW, N, NE, E, SE.
    expect(sheet.getClip('walk_S').frames[0]).toEqual({ x: 0, y: 0, w: 32, h: 48 });
    expect(sheet.getClip('walk_S').frames[2]).toEqual({ x: 64, y: 0, w: 32, h: 48 });
    expect(sheet.getClip('walk_SW').frames[0]).toEqual({ x: 0, y: 48, w: 32, h: 48 });
    expect(sheet.getClip('walk_SE').frames[0]).toEqual({ x: 0, y: 7 * 48, w: 32, h: 48 });
  });

  it('buildSheet defaults clips to looping, which is why playOnce overrides it', () => {
    const sheet = DirectionalAnimator.buildSheet(
      '/hero.png', 16, 16,
      [{ name: 'attack', rowStart: 0, frameCount: 2, fps: 12 }],
    );
    expect(sheet.getClip('attack_S').loop).toBe(true);

    const explicit = DirectionalAnimator.buildSheet(
      '/hero.png', 16, 16,
      [{ name: 'attack', rowStart: 0, frameCount: 2, fps: 12, loop: false }],
    );
    expect(explicit.getClip('attack_S').loop).toBe(false);
  });

  it('buildSheet offsets each action by its rowStart', () => {
    const sheet = DirectionalAnimator.buildSheet(
      '/hero.png', 16, 16,
      [
        { name: 'idle', rowStart: 0, frameCount: 1, fps: 4 },
        { name: 'walk', rowStart: 8, frameCount: 1, fps: 8 },
      ],
    );
    expect(sheet.clips.size).toBe(16);
    expect(sheet.getClip('walk_S').frames[0].y).toBe(8 * 16);
  });
});
