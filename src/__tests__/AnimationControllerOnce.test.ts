import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnimationController } from '../animation/AnimationController';
import { AnimationComponent } from '../ecs/components/AnimationComponent';
import { SpriteSheet } from '../animation/SpriteSheet';
import { Entity } from '../ecs/Entity';
import type { AABB } from '../math/depthSort';
import type { DrawContext } from '../elements/IsoObject';

/**
 * AnimationController.playOnce and AnimationComponent timing.
 *
 * `DirectionalAnimator` already carries a `_forceOnce` flag because its
 * `playOnce` had to override the clip's own `loop` flag. `AnimationController`
 * — the class `Character` and `AnimationComponent` actually use — never got the
 * same treatment, even though its `playOnce` body still carries the comment
 * "Force non-looping for this playback".
 */

class TestEntity extends Entity {
  get aabb(): AABB { return { minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0 }; }
  draw(_dc: DrawContext): void {}
}

function frames(n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: i * 16, y: 0, w: 16, h: 16 }));
}

/** Every clip explicitly looping — the common authoring default. */
function loopingSheet(): SpriteSheet {
  return new SpriteSheet({
    url: 'hero.png',
    clips: [
      { name: 'idle',   frames: frames(2), fps: 10, loop: true },
      { name: 'walk',   frames: frames(4), fps: 10, loop: true },
      { name: 'attack', frames: frames(3), fps: 10, loop: true },
    ],
  });
}

/** No `loop` flag at all, which defaults to looping. */
function unflaggedSheet(): SpriteSheet {
  return new SpriteSheet({
    url: 'hero.png',
    clips: [
      { name: 'idle',   frames: frames(2), fps: 10 },
      { name: 'attack', frames: frames(3), fps: 10 },
    ],
  });
}

describe('AnimationController — playOnce', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('completes even when the clip is flagged loop: true', () => {
    const done = vi.fn();
    const anim = new AnimationController(loopingSheet(), 'idle');

    anim.playOnce('attack', done);
    anim.update(1.0); // 3 frames at 10 fps = 0.3 s, well past the end

    expect(done).toHaveBeenCalledTimes(1);
    expect(anim.currentClip.name).toBe('idle');
  });

  it('completes when the clip has no loop flag at all', () => {
    const done = vi.fn();
    const anim = new AnimationController(unflaggedSheet(), 'idle');

    anim.playOnce('attack', done);
    anim.update(1.0);

    expect(done).toHaveBeenCalledTimes(1);
  });

  it('fires the callback exactly once across many frames', () => {
    const done = vi.fn();
    const anim = new AnimationController(loopingSheet(), 'idle');
    anim.playOnce('attack', done);
    for (let i = 0; i < 20; i++) anim.update(0.05);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('advances through the one-shot, then hands back to idle at frame 0', () => {
    const anim = new AnimationController(loopingSheet(), 'idle');
    anim.playOnce('attack');
    anim.update(0.15); // mid-clip: 3 frames at 10 fps
    expect(anim.currentClip.name).toBe('attack');
    expect(anim.frameIndex).toBe(1);
    expect(anim.done).toBe(false);

    anim.update(0.2); // past the end
    expect(anim.currentClip.name).toBe('idle');
    expect(anim.frameIndex).toBe(0);
  });

  it('returns to the named clip instead of idle', () => {
    const anim = new AnimationController(loopingSheet(), 'idle');
    anim.playOnce('attack', undefined, 'walk');
    anim.update(1.0);
    expect(anim.currentClip.name).toBe('walk');
  });

  it('keeps looping the clip it returned to', () => {
    const anim = new AnimationController(loopingSheet(), 'idle');
    anim.playOnce('attack');
    anim.update(1.0);
    expect(anim.currentClip.name).toBe('idle');
    expect(anim.done).toBe(false);

    // idle is 2 frames at 10 fps: 0.25 s in, it must be cycling, not finished.
    anim.update(0.25);
    anim.update(0.25);
    expect(anim.done).toBe(false);
  });

  it('a following play() cancels the one-shot and loops again', () => {
    const done = vi.fn();
    const anim = new AnimationController(loopingSheet(), 'idle');
    anim.playOnce('attack', done);
    anim.play('walk');

    anim.update(1.0);

    expect(done).not.toHaveBeenCalled();
    expect(anim.currentClip.name).toBe('walk');
    expect(anim.done).toBe(false);
  });

  it('reset() re-arms a completed one-shot', () => {
    const anim = new AnimationController(loopingSheet(), 'idle');
    anim.playOnce('attack');
    anim.update(1.0);
    anim.reset();
    expect(anim.done).toBe(false);
    expect(anim.frameIndex).toBe(0);
  });

  it('returns false and warns for a missing clip', () => {
    const anim = new AnimationController(loopingSheet(), 'idle');
    expect(anim.playOnce('nope')).toBe(false);
    expect(anim.currentClip.name).toBe('idle');
    expect(warn).toHaveBeenCalled();
  });

  it('respects an explicitly non-looping clip', () => {
    const sheet = new SpriteSheet({
      url: 'hero.png',
      clips: [{ name: 'die', frames: frames(2), fps: 10, loop: false }],
    });
    const anim = new AnimationController(sheet, 'die');
    anim.update(1.0);
    expect(anim.done).toBe(true);
    expect(anim.frameIndex).toBe(1);
  });

  it('tolerates a clip with no frames', () => {
    const sheet = new SpriteSheet({
      url: 'hero.png',
      clips: [{ name: 'idle', frames: [], fps: 10 }],
    });
    const anim = new AnimationController(sheet, 'idle');
    expect(() => anim.update(1)).not.toThrow();
    expect(anim.frameIndex).toBe(0);
  });
});

describe('AnimationComponent — frame delta', () => {
  it('does not drop the frame after timestamp 0', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({ spriteSheet: loopingSheet(), initialClip: 'walk' });
    entity.addComponent(anim);

    anim.update(0);
    // walk is 4 frames at 10 fps, so 100 ms is exactly one frame. The old
    // `_lastTs === 0` sentinel was still armed here and advanced the clip by an
    // invented 16 ms instead, leaving it on frame 0.
    anim.update(100);
    expect(anim.controller.frameIndex).toBe(1);
  });

  it('does not advance on the very first frame', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({ spriteSheet: loopingSheet(), initialClip: 'walk' });
    entity.addComponent(anim);
    anim.update(1000);
    expect(anim.controller.frameIndex).toBe(0);
  });

  it('clamps a long stall', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({ spriteSheet: loopingSheet(), initialClip: 'walk' });
    entity.addComponent(anim);
    anim.update(1000);
    anim.update(11_000);
    // Clamped to 100 ms: one frame at 10 fps, not 100 frames' worth.
    expect(anim.controller.frameIndex).toBe(1);
  });

  it('never advances on a backwards timestamp', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({ spriteSheet: loopingSheet(), initialClip: 'walk' });
    entity.addComponent(anim);
    anim.update(1000);
    anim.update(1100);
    const frame = anim.controller.frameIndex;
    anim.update(600);
    expect(anim.controller.frameIndex).toBe(frame);
  });

  it('does nothing after onDetach', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({ spriteSheet: loopingSheet(), initialClip: 'walk' });
    entity.addComponent(anim);
    anim.update(1000);
    anim.onDetach();
    anim.update(2000);
    expect(anim.controller.frameIndex).toBe(0);
  });

  it('leaves the direction alone when autoUpdateDirection is off', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({
      spriteSheet: loopingSheet(),
      autoUpdateDirection: false,
    });
    entity.addComponent(anim);
    entity.position.x = 1;
    anim.update(1000);
    anim.update(1100);
    expect(anim.controller.direction).toBe('S');
  });

  it('ignores sub-threshold jitter when picking a direction', () => {
    const entity = new TestEntity('hero', 0, 0, 0);
    const anim = new AnimationComponent({ spriteSheet: loopingSheet() });
    entity.addComponent(anim);

    entity.position.x = 1;
    anim.update(1000);
    expect(anim.controller.direction).toBe('E');

    entity.position.x += 0.0001;
    anim.update(1100);
    expect(anim.controller.direction).toBe('E');
  });
});
