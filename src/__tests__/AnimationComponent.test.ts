import {describe, it, expect, beforeEach} from 'vitest';
import {Entity} from '../ecs/Entity';
import {AnimationComponent} from '../ecs/components/AnimationComponent';
import {SpriteSheet} from '../animation/SpriteSheet';
import {AABB} from '../math/depthSort';
import {DrawContext} from '../elements/IsoObject';

class TestEntity extends Entity {
  get aabb(): AABB { return {minX: 0, minY: 0, maxX: 1, maxY: 1, baseZ: 0}; }
  draw(_dc: DrawContext): void {}
}

describe('AnimationComponent', () => {
  let sheet: SpriteSheet;

  beforeEach(() => {
    sheet = new SpriteSheet({
      url: 'test.png',
      clips: [
        {name: 'idle', frames: [{x: 0, y: 0, w: 32, h: 32}], fps: 10},
        {name: 'walk', frames: [{x: 32, y: 0, w: 32, h: 32}], fps: 10},
      ],
    });
  });

  it('can be attached to an entity', () => {
    const entity = new TestEntity('test', 0, 0, 0);
    const anim = new AnimationComponent({spriteSheet: sheet});
    entity.addComponent(anim);
    expect(entity.getComponent(AnimationComponent)).toBe(anim);
  });

  it('updates direction automatically when owner moves', () => {
    const entity = new TestEntity('test', 0, 0, 0);
    const anim = new AnimationComponent({spriteSheet: sheet, autoUpdateDirection: true});
    entity.addComponent(anim);

    // Initial direction (down)
    expect(anim.controller.direction).toBe('S');

    // Move East
    entity.position.x = 1;
    anim.update(100);
    expect(anim.controller.direction).toBe('E');

    // Move North-West
    entity.position.x = 0.5;
    entity.position.y = -0.5;
    anim.update(200);
    expect(anim.controller.direction).toBe('NW');
  });

  it('updates animation controller', () => {
    const entity = new TestEntity('test', 0, 0, 0);
    const anim = new AnimationComponent({spriteSheet: sheet, initialClip: 'idle'});
    entity.addComponent(anim);

    anim.play('walk');
    expect(anim.controller.currentClip.name).toBe('walk');
  });
});
