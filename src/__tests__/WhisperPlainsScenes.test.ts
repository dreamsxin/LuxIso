import { describe, it, expect } from 'vitest';
import { buildLakeScene, LAKE_PORTAL_X, LAKE_PORTAL_Y, LAKE_SPAWN_X, LAKE_SPAWN_Y } from '../../examples/05-whisper-plains/scenes/LakeScene';
import {
  buildDeepSeaScene,
  DEEP_PORTAL_X, DEEP_PORTAL_Y, DEEP_SPAWN_X, DEEP_SPAWN_Y,
} from '../../examples/05-whisper-plains/scenes/DeepSeaScene';
import { Pathfinder } from '../physics/Pathfinder';

/**
 * example-05 scene reachability.
 *
 * The Lake and DeepSea scenes shipped without a TileCollider at all, so the
 * hero walked straight through rocks and coral. Now that they block those
 * tiles, the risk flips: a badly placed obstacle could wall the portal off and
 * make the demo unfinishable. These tests pin both ends of that — the props
 * are solid, and the portal is still reachable from where the hero lands.
 */

describe('example-05 LakeScene collider', () => {
  const { collider } = buildLakeScene(13, 13);

  it('blocks the rock tiles', () => {
    // A sample from the hardcoded rock list in LakeScene.
    expect(collider.isWalkable(2, 3)).toBe(false);
    expect(collider.isWalkable(7, 6)).toBe(false);
    expect(collider.isWalkable(11, 7)).toBe(false);
  });

  it('leaves soft decoration walkable', () => {
    // Lily pads and water grass are flat props, not obstacles.
    expect(collider.isWalkable(5, 6)).toBe(true);
    expect(collider.isWalkable(1, 2)).toBe(true);
  });

  it('keeps the spawn tile and the portal tile clear', () => {
    expect(collider.isWalkable(Math.floor(LAKE_SPAWN_X), Math.floor(LAKE_SPAWN_Y))).toBe(true);
    expect(collider.isWalkable(LAKE_PORTAL_X, LAKE_PORTAL_Y)).toBe(true);
  });

  it('leaves the portal reachable from the spawn point', () => {
    const path = Pathfinder.find(
      collider,
      { x: LAKE_SPAWN_X, y: LAKE_SPAWN_Y },
      { x: LAKE_PORTAL_X, y: LAKE_PORTAL_Y },
    );
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });
});

describe('example-05 DeepSeaScene collider', () => {
  const { collider } = buildDeepSeaScene();

  it('blocks the coral tiles', () => {
    expect(collider.isWalkable(2, 3)).toBe(false);
    expect(collider.isWalkable(7, 7)).toBe(false);
    expect(collider.isWalkable(12, 8)).toBe(false);
  });

  it('leaves seaweed and jellyfish tiles walkable', () => {
    // Weeds bend and jellyfish float; neither should stop the hero.
    expect(collider.isWalkable(1, 2)).toBe(true);
    expect(collider.isWalkable(5, 6)).toBe(true);
  });

  it('keeps the spawn tile and the portal tile clear', () => {
    expect(collider.isWalkable(Math.floor(DEEP_SPAWN_X), Math.floor(DEEP_SPAWN_Y))).toBe(true);
    expect(collider.isWalkable(DEEP_PORTAL_X, DEEP_PORTAL_Y)).toBe(true);
  });

  it('leaves the portal reachable from the spawn point', () => {
    const path = Pathfinder.find(
      collider,
      { x: DEEP_SPAWN_X, y: DEEP_SPAWN_Y },
      { x: DEEP_PORTAL_X, y: DEEP_PORTAL_Y },
    );
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });
});
