/**
 * Example 11 — Trigger Zones, Tween Sequences & Minimap
 *
 * Demonstrates framework pieces no other example uses:
 *   - TriggerZoneComponent  (circle enter/exit detection, driven as a component)
 *   - TweenSequence         (multi-step chained animation; bounce on activate)
 *   - TweenComponent         (the rune gate sinking into the floor)
 *   - DirectionalAnimator    (8-direction sprite, sheet built from a data: URL)
 *   - Minimap                (offscreen-canvas HUD overview)
 *
 * Goal: walk into all three beacons (WASD / arrows / click-to-move) to charge
 * them, which lowers the rune gate and opens the way to the chest.
 */
import {
  Engine, Scene, Floor, Wall, OmniLight, Chest, Crystal,
  TileCollider, Entity, MovementComponent, TriggerZoneComponent,
  TweenComponent, TweenSequence, Easing,
  DirectionalAnimator, AnimationController,
  Minimap, DebugRenderer, InputManager, FrameClock,
  project, drawIsoCube,
} from '../../src/index';
import type {AABB, DrawContext} from '../../src/index';
import {buildHeroSheet} from './heroSheet';

const COLS = 14, ROWS = 10, TILE_W = 64, TILE_H = 32;

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = (COLS + ROWS) * (TILE_W / 2);
canvas.height = (COLS + ROWS) * (TILE_H / 2) + 60;

const engine = new Engine({canvas});
engine.originX = canvas.width / 2;
engine.originY = ROWS * (TILE_H / 2) + 10;
const status = document.getElementById('status') as HTMLElement;

// ── Scene ──────────────────────────────────────────────────────────────────

const scene = new Scene({tileW: TILE_W, tileH: TILE_H, cols: COLS, rows: ROWS});
scene.addObject(new Floor({id: 'floor', cols: COLS, rows: ROWS, color: '#3f6656', altColor: '#375b4d'}));
scene.addLight(new OmniLight({x: 5, y: 4, z: 150, color: '#ffe8a0', intensity: 1.2, radius: 380}));
scene.addLight(new OmniLight({x: 12, y: 7, z: 130, color: '#80a0ff', intensity: 0.7, radius: 260}));

// ── Collision: a wall column across x = 9, the rune gate blocks its middle ──

const GATE_X = 9;
const GATE_Y = 5;
const collider = new TileCollider(COLS, ROWS);
for (let r = 3; r <= 7; r++) {collider.setWalkable(GATE_X, r, false);}
scene.collider = collider;

for (const r of [3, 4, 6, 7]) {
  // Axis-aligned segment along +y: a diagonal (x+1, y+1) would project
  // edge-on in iso (zero screen-width) and render as an invisible sliver.
  scene.addObject(new Wall({
    id: `wall-${r}`, x: GATE_X, y: r, endX: GATE_X, endY: r + 1,
    color: '#7a6f88', height: 64,
  }));
}

// ── Hero: Entity + MovementComponent + a hand-driven DirectionalAnimator ───

class Hero extends Entity {
  readonly radius = 0.35;
  private readonly _animator: DirectionalAnimator;
  private readonly _clock = new FrameClock();
  private _prevX: number;
  private _prevY: number;

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 0);
    const sheet = buildHeroSheet();
    void sheet.preload(); // data: URL resolves immediately-ish; draw() has a fallback
    this._animator = new DirectionalAnimator(sheet, {initialAction: 'idle', initialDirection: 'S'});
    this._prevX = x;
    this._prevY = y;
  }

  get aabb(): AABB {
    return {
      minX: this.position.x - this.radius, minY: this.position.y - this.radius,
      maxX: this.position.x + this.radius, maxY: this.position.y + this.radius,
      baseZ: this.position.z, maxZ: this.position.z + 44,
    };
  }

  override update(ts?: number): void {
    // super.update drives the MovementComponent.
    super.update(ts);
    const dt = this._clock.sample(ts ?? performance.now());
    const dx = this.position.x - this._prevX;
    const dy = this.position.y - this._prevY;
    if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
      this._animator.set('walk', AnimationController.directionFrom(dx, dy));
    } else {
      this._animator.setAction('idle');
    }
    this._animator.update(dt);
    this._prevX = this.position.x;
    this._prevY = this.position.y;
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {sx, sy} = project(this.position.x, this.position.y, 0, tileW, tileH);
    const bx = originX + sx;
    const by = originY + sy;

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(bx, by, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const frame = this._animator.currentFrame();
    if (!frame) {
      // Image not decoded yet — same sphere fallback Character uses.
      ctx.fillStyle = '#5a78d6';
      ctx.beginPath();
      ctx.arc(bx, by - 12, 10, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Sheet scale is 1.4 (see buildHeroSheet); anchorY = 1 puts the feet on the anchor.
    const drawW = frame.frame.w * 1.4;
    const drawH = frame.frame.h * 1.4;
    ctx.drawImage(
      frame.image,
      frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h,
      bx - drawW / 2, by - drawH, drawW, drawH
    );
  }
}

const hero = new Hero('hero', 2, 5);
hero.addComponent(new MovementComponent({speed: 3.4, radius: 0.32, collider}));
scene.addObject(hero);

// ── Beacons: a TriggerZoneComponent charges them, TweenSequence does the pop ─

class Beacon extends Entity {
  lit = false;
  constructor(id: string, x: number, y: number) {super(id, x, y, 0);}

  get aabb(): AABB {
    return {
      minX: this.position.x - 0.34, minY: this.position.y - 0.34,
      maxX: this.position.x + 0.34, maxY: this.position.y + 0.34,
      baseZ: this.position.z, maxZ: this.position.z + 46,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    const {x, y, z} = this.position;
    const top = this.lit ? '#ffd040' : '#6ad0ff';
    drawIsoCube(ctx, originX, originY, tileW, tileH,
      x - 0.3, y - 0.3, z, 0.6, 0.6, 14,
      '#6d6480', '#4d465c', '#575069');

    // Floating shard: two shaded triangles meeting at the tip.
    const z0 = z + 14;
    const z1 = z + 44;
    const p = (px: number, py: number, pz: number) => {
      const s = project(px, py, pz, tileW, tileH);
      return [originX + s.sx, originY + s.sy] as const;
    };
    const [cx, cy] = p(x, y, z1);
    const [nx, ny] = p(x - 0.24, y, z0);
    const [ex, ey] = p(x, y - 0.24, z0);
    const [sx, sy] = p(x + 0.24, y, z0);
    const [wx, wy] = p(x, y + 0.24, z0);
    ctx.fillStyle = top;
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(nx, ny); ctx.lineTo(ex, ey);
    ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
    ctx.fill();
    ctx.fillStyle = this.lit ? '#c89020' : '#3a8fc0';
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(sx, sy); ctx.lineTo(wx, wy);
    ctx.moveTo(cx, cy); ctx.lineTo(wx, wy); ctx.lineTo(nx, ny);
    ctx.fill();

    if (this.lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30);
      glow.addColorStop(0, 'rgba(255,210,80,0.45)');
      glow.addColorStop(1, 'rgba(255,210,80,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - 30, cy - 30, 60, 60);
      ctx.restore();
    }
  }
}

const beacons = [
  new Beacon('beacon-n', 4, 2),
  new Beacon('beacon-s', 4, 8),
  new Beacon('beacon-e', 7, 5),
];
let litCount = 0;

function refreshStatus(): void {
  status.textContent = `Beacons ${litCount}/${beacons.length} — ` +
    (litCount === beacons.length ? 'the rune gate is open, reach the chest!' : 'walk into a beacon to charge it');
}

function pop(beacon: Beacon): void {
  // Chained, frame-rate-independent bounce. Absolute from/to keeps it restartable.
  beacon.addComponent(new TweenSequence([
    {targets: [{prop: 'z', from: 0, to: 24}], duration: 0.22, easing: Easing.easeOutCubic},
    {targets: [{prop: 'z', from: 24, to: 0}], duration: 0.42, easing: Easing.bounce},
  ]));
}

for (const beacon of beacons) {
  beacon.addComponent(new TriggerZoneComponent({
    radius: 1.35,
    targets: [hero],
    onEnter: who => {
      if (who !== hero.id || beacon.lit) {return;}
      beacon.lit = true;
      litCount++;
      pop(beacon);
      scene.spawnFloatingText({
        x: beacon.position.x, y: beacon.position.y, z: 52,
        text: 'charged', color: '#ffd040', duration: 1000, fontSize: 16,
      });
      refreshStatus();
      if (litCount === beacons.length) {openGate();}
    },
  }));
  scene.addObject(beacon);
}
refreshStatus();

// ── Ambient bobbing shards — TweenSequence looping forever ─────────────────

for (const [id, x, y, color] of [
  ['wisp-1', 2, 1, '#a06ae0'],
  ['wisp-2', 12, 2, '#6ae0a0'],
] as const) {
  const wisp = new Crystal(id, x, y, color, 34);
  wisp.position.z = 8;
  wisp.addComponent(new TweenSequence([
    {targets: [{prop: 'z', from: 8, to: 30}], duration: 1.6, easing: Easing.easeInOut},
    {targets: [{prop: 'z', from: 30, to: 8}], duration: 1.6, easing: Easing.easeInOut},
  ], {repeat: -1}));
  scene.addObject(wisp);
}

// ── Rune gate: a TweenComponent sinks it, then the collider cell opens ──────

class Gate extends Entity {
  constructor() {super('gate', GATE_X, GATE_Y, 0);}

  get aabb(): AABB {
    return {
      minX: GATE_X, minY: GATE_Y, maxX: GATE_X + 1, maxY: GATE_Y + 1,
      baseZ: this.position.z, maxZ: this.position.z + 64,
    };
  }

  draw(dc: DrawContext): void {
    const {ctx, tileW, tileH, originX, originY} = dc;
    drawIsoCube(ctx, originX, originY, tileW, tileH,
      GATE_X, GATE_Y, this.position.z, 1, 1, 64,
      '#b070e0', '#6e3a96', '#8a4eb8');
    // Rune band across the slab face.
    const a = project(GATE_X + 0.5, GATE_Y + 1, this.position.z + 34, tileW, tileH);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(originX + a.sx, originY + a.sy, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

const gate = new Gate();
scene.addObject(gate);

function openGate(): void {
  collider.setWalkable(GATE_X, GATE_Y, true);
  gate.addComponent(new TweenComponent({
    targets: [{prop: 'z', from: 0, to: -66}],
    duration: 0.9,
    easing: Easing.easeInCubic,
    onComplete: () => {gate.visible = false;},
  }));
}

// ── Treasure: a TriggerZoneComponent on a built-in Chest ───────────────────

const chest = new Chest('chest', 11, GATE_Y);
chest.addComponent(new TriggerZoneComponent({
  radius: 1.1,
  targets: [hero],
  onEnter: who => {
    if (who !== hero.id || chest.isOpen) {return;}
    chest.open();
    scene.spawnFloatingText({
      x: chest.position.x, y: chest.position.y, z: 56,
      text: 'Treasure!', color: '#ffd040', duration: 1400, fontSize: 20,
    });
    status.textContent = 'You looted the treasure. The demo is complete ✦';
  },
}));
scene.addObject(chest);

// ── Input: WASD/arrows (collision-resolved) + click-to-move pathfinding ────

const input = new InputManager(canvas);
const mv = hero.getComponent(MovementComponent)!;
const KEY: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
  const world = scene.camera.screenToWorld(
    cx, cy, canvas.width, canvas.height, TILE_W, TILE_H, engine.originX, engine.originY
  );
  mv.pathTo(
    Math.max(0.5, Math.min(COLS - 0.5, world.x)),
    Math.max(0.5, Math.min(ROWS - 0.5, world.y)),
    hero.position.z
  );
});

// ── HUD: minimap + optional trigger debug overlay ──────────────────────────

const minimap = new Minimap(scene, {cols: COLS, rows: ROWS});
const debug = new DebugRenderer(scene, engine.originX, engine.originY, {
  showCollision: false,
  showAABB: false,
  showLights: false,
  showTriggers: true,
  showFps: false,
});
debug.enabled = false;

// ── Loop ───────────────────────────────────────────────────────────────────

const frameClock = new FrameClock();
// Demo diagnostics (the webgl-next preview exposes `window.__luxisoPreview`
// for the same reason). Handy from the console: __ex11.hero.position.
(window as unknown as {__ex11?: unknown}).__ex11 =
  {scene, hero, chest, gate, collider, input, minimap, debug, engine};
engine.setScene(scene);
engine.start(ts => {
  // Sample once per frame; first frame after start() reports 0 (no motion), as
  // the frame-delta contract requires.
  const dt = frameClock.sample(ts);
  // Digital-diagonal movement, one resolved nudge per frame, scaled by dt so
  // 144 Hz displays do not walk 2.4x faster.
  let ix = 0, iy = 0;
  for (const [code, [dx, dy]] of Object.entries(KEY)) {
    if (input.isDown(code)) {ix += dx; iy += dy;}
  }
  if ((ix !== 0 || iy !== 0) && dt > 0) {
    const len = Math.hypot(ix, iy);
    mv.nudge(ix / len * mv.speed * dt, iy / len * mv.speed * dt);
  }

  if (input.wasPressed('KeyF')) {debug.enabled = !debug.enabled;}

  minimap.draw(engine.ctx, canvas.width - 160, 12, 148, Math.round(148 * ROWS / COLS));
  debug.draw(engine.ctx, canvas.width, canvas.height, ts);
  input.flush();
});
