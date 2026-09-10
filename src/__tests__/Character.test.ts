import { describe, it, expect } from 'vitest';
import { Character } from '../elements/Character';
import { MovementComponent } from '../ecs/components/MovementComponent';
import { TileCollider } from '../physics/TileCollider';
import { SpriteSheet } from '../animation/SpriteSheet';

function makeCollider(cols: number, rows: number, blocked: [number, number][] = []): TileCollider {
  const c = new TileCollider(cols, rows);
  for (const [col, row] of blocked) c.setWalkable(col, row, false);
  return c;
}

function frames(count: number) {
  return Array.from({ length: count }, (_, i) => ({ x: i * 16, y: 0, w: 16, h: 24 }));
}

/** Sheet with idle + walk, enough for the state machine in Character.update(). */
function makeSheet(clips = ['idle', 'walk']): SpriteSheet {
  return new SpriteSheet({
    url: '/sprites/hero.png',
    clips: clips.map(name => ({ name, frames: frames(2), fps: 8 })),
  });
}


describe('MovementComponent direct movement', () => {
  it('starts moving and arrives at target', () => {
    const ch = new Character({ id: 'p', x: 0, y: 0, speed: 10 });
    const mv = ch.addComponent(new MovementComponent({ speed: 10 }));
    mv.moveTo(2, 0);
    expect(ch.isMoving).toBe(true);

    let ts = 1000;
    // Speed 10, dist 2 -> 0.2s. 50 frames * 16.6ms = 0.8s. Should arrive.
    for (let i = 0; i < 50; i++) { ch.update(ts); ts += 16.67; }

    expect(ch.position.x).toBeCloseTo(2, 1);
    expect(ch.isMoving).toBe(false);
  });

  it('stopMoving cancels movement immediately', () => {
    const ch = new Character({ id: 'p', x: 0, y: 0, speed: 5 });
    const mv = ch.addComponent(new MovementComponent({ speed: 5 }));
    mv.moveTo(5, 0);
    mv.stopMoving();
    expect(ch.isMoving).toBe(false);
    expect(mv.remainingWaypoints.length).toBe(0);
  });
});

describe('MovementComponent pathfinding', () => {
  it('returns true on open grid and moves toward goal', () => {
    const c = makeCollider(10, 10);
    const ch = new Character({ id: 'p', x: 0.5, y: 0.5, speed: 5 });
    const mv = ch.addComponent(new MovementComponent({ speed: 5, collider: c }));
    const ok = mv.pathTo(8, 8);
    expect(ok).toBe(true);
    expect(ch.isMoving).toBe(true);
  });

  it('returns false when goal is unreachable', () => {
    const c = makeCollider(5, 5, [[2, 0],[2,1],[2,2],[2,3],[2,4]]);
    const ch = new Character({ id: 'p', x: 0.5, y: 2.5, speed: 5 });
    const mv = ch.addComponent(new MovementComponent({ speed: 5, collider: c }));
    const ok = mv.pathTo(4, 2);
    expect(ok).toBe(false);
    expect(ch.isMoving).toBe(false);
  });

  it('actually reaches the goal after enough updates', () => {
    const c = makeCollider(10, 5);
    const ch = new Character({ id: 'p', x: 0.5, y: 2.5, speed: 10 });
    const mv = ch.addComponent(new MovementComponent({ speed: 10, collider: c }));
    mv.pathTo(8, 2);

    let ts = 1000;
    for (let i = 0; i < 200; i++) { ch.update(ts); ts += 16.67; }

    expect(ch.position.x).toBeCloseTo(8.5, 0);
    expect(ch.isMoving).toBe(false);
  });

  it('falls back to direct moveTo when no collider given', () => {
    const ch = new Character({ id: 'p', x: 0, y: 0, speed: 5 });
    const mv = ch.addComponent(new MovementComponent({ speed: 5, collider: null }));
    const ok = mv.pathTo(3, 3);
    expect(ok).toBe(true);
    expect(ch.isMoving).toBe(true);
  });

  it('navigates around a wall', () => {
    // Vertical wall at col 2, rows 0–3; open at row 4
    const c = makeCollider(8, 6);
    for (let r = 0; r < 4; r++) c.setWalkable(2, r, false);

    const ch = new Character({ id: 'p', x: 0.5, y: 2.5, speed: 10 });
    const mv = ch.addComponent(new MovementComponent({ speed: 10, collider: c }));
    const ok = mv.pathTo(5, 2);
    expect(ok).toBe(true);

    let ts = 1000;
    for (let i = 0; i < 300; i++) { ch.update(ts); ts += 16.67; }

    expect(ch.position.x).toBeGreaterThan(4);
    expect(ch.isMoving).toBe(false);
  });
});

describe('MovementComponent.followPath()', () => {
  it('advances through pre-computed waypoints', () => {
    const ch = new Character({ id: 'p', x: 0.5, y: 0.5, speed: 10 });
    const mv = ch.addComponent(new MovementComponent({ speed: 10 }));
    mv.followPath([
      { x: 2.5, y: 0.5 },
      { x: 4.5, y: 0.5 },
      { x: 4.5, y: 3.5 },
    ]);
    expect(ch.isMoving).toBe(true);

    let ts = 1000;
    for (let i = 0; i < 200; i++) { ch.update(ts); ts += 16.67; }

    expect(ch.position.x).toBeCloseTo(4.5, 0);
    expect(ch.position.y).toBeCloseTo(3.5, 0);
    expect(ch.isMoving).toBe(false);
  });
});

describe('Character — externally driven movement', () => {
  it('detects position changes applied outside update()', () => {
    // The documented ClickMover flow: `hero.position.x += mover.velX` between
    // frames. The previous code snapshotted the position at the top of update(),
    // so this delta was always measured as zero.
    const ch = new Character({ id: 'p', x: 1, y: 1 });
    ch.update(0);
    expect(ch.isMoving).toBe(false);

    ch.position.x += 0.05;
    ch.update(16);
    expect(ch.isMoving).toBe(true);
  });

  it('goes still again once the external movement stops', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1 });
    ch.position.x += 0.05;
    ch.update(0);
    ch.update(16);
    expect(ch.isMoving).toBe(false);
  });

  it('ignores sub-threshold jitter', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1 });
    ch.update(0);
    ch.position.x += 0.0001;
    ch.update(16);
    expect(ch.isMoving).toBe(false);
  });

  it('keeps the same answer when isMoving is read twice in a frame', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1 });
    ch.update(0);
    ch.position.y += 0.5;
    ch.update(16);
    expect(ch.isMoving).toBe(true);
    expect(ch.isMoving).toBe(true);
  });

  it('reports movement from an idle MovementComponent plus a direct nudge', () => {
    // An attached-but-unused component used to veto the position delta, which is
    // exactly the ClickMover-plus-component combination example-05 sets up.
    const ch = new Character({ id: 'p', x: 1, y: 1 });
    ch.addComponent(new MovementComponent({ speed: 4 }));
    ch.update(0);

    ch.position.x += 0.2;
    ch.update(16);
    expect(ch.isMoving).toBe(true);
  });
});

describe('Character — animation state machine', () => {
  it('switches to walk when moved externally and back to idle', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1, spriteSheet: makeSheet() });
    ch.update(0);
    expect(ch.anim!.currentClip.name).toBe('idle');

    ch.position.x += 0.1;
    ch.update(16);
    expect(ch.anim!.currentClip.name).toBe('walk');

    ch.update(32);
    expect(ch.anim!.currentClip.name).toBe('idle');
  });

  it('stays on walk while movement continues', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1, spriteSheet: makeSheet() });
    let ts = 0;
    for (let i = 0; i < 4; i++) {
      ch.position.x += 0.1;
      ch.update(ts += 16);
    }
    expect(ch.anim!.currentClip.name).toBe('walk');
  });

  it('stays put when the sheet has no walk clip', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1, spriteSheet: makeSheet(['idle']) });
    ch.position.x += 0.1;
    ch.update(16);
    expect(ch.anim!.currentClip.name).toBe('idle');
  });

  it('playAnimation ignores an unknown clip', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1, spriteSheet: makeSheet() });
    ch.playAnimation('cast');
    expect(ch.anim!.currentClip.name).toBe('idle');
    ch.playAnimation('walk');
    expect(ch.anim!.currentClip.name).toBe('walk');
  });

  it('has no controller without a sprite sheet, and playAnimation is inert', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1 });
    expect(ch.anim).toBeNull();
    expect(() => ch.playAnimation('walk')).not.toThrow();
  });

  it('setSpriteSheet replaces the previous controller', () => {
    const ch = new Character({ id: 'p', x: 1, y: 1, spriteSheet: makeSheet() });
    const first = ch.anim;
    ch.setSpriteSheet(makeSheet(), 'walk');
    expect(ch.anim).not.toBe(first);
    expect(ch.anim!.currentClip.name).toBe('walk');
  });
});

