import {describe, it, expect, vi} from 'vitest';
import {TweenSequence} from '../ecs/components/TweenSequence';
import {Entity} from '../ecs/Entity';
import {AABB} from '../math/depthSort';
import {DrawContext} from '../elements/IsoObject';

class TestEntity extends Entity {
  get aabb(): AABB { return {minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0}; }
  draw(_dc: DrawContext): void {}
}

describe('TweenSequence', () => {
  it('chains multiple tweens sequentially', () => {
    const entity = new TestEntity('test', 0, 0, 0);
    const step1Complete = vi.fn();
    const step2Complete = vi.fn();
    const sequenceComplete = vi.fn();

    const sequence = new TweenSequence([
      {targets: [{prop: 'x', from: 0, to: 10}], duration: 0.1, onComplete: step1Complete},
      {targets: [{prop: 'y', from: 0, to: 20}], duration: 0.1, onComplete: step2Complete},
    ], {onComplete: sequenceComplete});

    entity.addComponent(sequence);

    // Initial state
    expect(entity.position.x).toBe(0);
    expect(entity.position.y).toBe(0);
    expect(sequence.stepIndex).toBe(0);

    // After 1st step
    sequence.update(0); // init step 1
    sequence.update(100); // complete step 1
    expect(entity.position.x).toBe(10);
    expect(step1Complete).toHaveBeenCalled();
    expect(sequence.stepIndex).toBe(1);

    // After 2nd step
    sequence.update(100); // init step 2
    sequence.update(200); // complete step 2
    expect(entity.position.y).toBe(20);
    expect(step2Complete).toHaveBeenCalled();
    expect(sequenceComplete).toHaveBeenCalled();
    expect(sequence.isDone).toBe(true);
  });

  it('repeats the sequence if specified', () => {
    const entity = new TestEntity('test', 0, 0, 0);
    const sequenceComplete = vi.fn();

    const sequence = new TweenSequence([
      {targets: [{prop: 'x', from: 0, to: 10}], duration: 0.1},
    ], {repeat: 1, onComplete: sequenceComplete}); // repeat once (total 2 passes)

    entity.addComponent(sequence);

    // 1st pass
    sequence.update(0); // init pass 1 step 1
    sequence.update(100); // complete pass 1
    expect(sequenceComplete).toHaveBeenCalledTimes(1);
    expect(sequence.isDone).toBe(false);
    expect(sequence.stepIndex).toBe(0);

    // 2nd pass
    sequence.update(100); // init pass 2 step 1
    sequence.update(200); // complete pass 2
    expect(sequenceComplete).toHaveBeenCalledTimes(2);
    expect(sequence.isDone).toBe(true);
  });
});
