import { IsoObject } from '../../elements/IsoObject';
import { Component } from '../Component';
import { TileCollider } from '../../physics/TileCollider';
import { Pathfinder, IsoVec2 } from '../../physics/Pathfinder';
import type { EventEmitter, LuxIsoEventMap } from '../EventBus';

type MovementEventMap = Pick<LuxIsoEventMap, 'move' | 'arrival'>;

export interface MovementOptions {
  /** Movement speed in world units per second. Default 2.0. */
  speed?: number;
  /** Collision footprint radius in world units. Default 0.4. */
  radius?: number;
  /** Optional EventBus to emit move/arrival events on. */
  bus?: EventEmitter<MovementEventMap>;
  /** Optional TileCollider for collision resolution and pathfinding. */
  collider?: TileCollider | null;
}

/**
 * MovementComponent — reusable smooth movement with collision resolution
 * and A* pathfinding.
 *
 * Attach to any Entity to give it `moveTo()` / `pathTo()` / `stopMoving()`
 * behaviour, decoupled from the Character class.
 *
 * Emits on the provided EventBus:
 *   'move'    — every frame while moving: { x, y, z }
 *   'arrival' — when the final destination is reached: { id, x, y }
 */
export class MovementComponent implements Component {
  readonly componentType = 'movement' as const;

  speed:  number;
  radius: number;

  private _owner:    IsoObject | null = null;
  private _target:   { x: number; y: number; z: number } | null = null;
  private _waypoints: IsoVec2[] = [];   // remaining path waypoints
  private _bus:      EventEmitter<MovementEventMap> | null;
  private _collider: TileCollider | null;
  private _lastTs: number | null = null;
  private _fixedStepActive = false;

  constructor(opts: MovementOptions = {}) {
    this.speed     = opts.speed    ?? 2.0;
    this.radius    = opts.radius   ?? 0.4;
    this._bus      = opts.bus      ?? null;
    this._collider = opts.collider ?? null;
  }

  onAttach(owner: IsoObject): void { this._owner = owner; }
  onDetach(): void                 { this._owner = null; }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Begin smooth movement toward world position (x, y, z). No pathfinding. */
  moveTo(x: number, y: number, z?: number): void {
    this._waypoints = [];
    this._target    = { x, y, z: z ?? (this._owner?.position.z ?? 0) };
  }

  /**
   * Use A* to find a path to (x, y) and begin following it.
   */
  pathTo(x: number, y: number, z?: number): boolean {
    if (!this._collider || !this._owner) {
      this.moveTo(x, y, z);
      return true;
    }
    const path = Pathfinder.find(this._collider, this._owner.position, { x, y });
    if (!path) {
      this.stopMoving();
      return false;
    }
    if (path.length === 1) {
      this.moveTo(path[0].x, path[0].y, z);
      return true;
    }
    this._waypoints = path.slice(1); // skip current tile
    this._advanceWaypoint(z);
    return true;
  }

  /** Follow a pre-computed path. An empty path cancels the current move. */
  followPath(waypoints: IsoVec2[], z?: number): void {
    this._waypoints = [...waypoints];
    this._advanceWaypoint(z);
  }

  /** Cancel movement. */
  stopMoving(): void {
    this._target    = null;
    this._waypoints = [];
  }

  /**
   * Nudge by displacement (dx, dy) with collision resolution.
   *
   * Safe for large impulses (knockback, dash): the move is swept rather than
   * only destination-tested, so it cannot jump a one-tile wall.
   */
  nudge(dx: number, dy: number): void {
    if (!this._owner) return;
    const pos = this._owner.position;
    const resolved = this._resolve(pos.x, pos.y, dx, dy);
    pos.x += resolved.dx;
    pos.y += resolved.dy;
  }

  get isMoving(): boolean { return this._target !== null; }

  /** Remaining waypoints (read-only). */
  get remainingWaypoints(): readonly IsoVec2[] { return this._waypoints; }

  /** Attach or replace the collider. */
  setCollider(collider: TileCollider | null): void { this._collider = collider; }

  // ── Per-frame update ──────────────────────────────────────────────────────

  /** 
   * Fixed-timestep update for physics. 
   * Called by Engine/Scene automatically if attached to an Entity.
   */
  fixedUpdate(dt: number): void {
    this._fixedStepActive = true;
    this._integrate(dt);
  }

  private _integrate(dt: number): void {
    if (!this._owner || !this._target) return;

    const pos  = this._owner.position;
    const dx   = this._target.x - pos.x;
    const dy   = this._target.y - pos.y;
    const dz   = this._target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const step = this.speed * dt;

    if (dist <= step) {
      // Close enough to land on the target this frame — but the landing has to
      // go through the collider too. Snapping straight to `_target` used to
      // teleport through walls whenever the last step covered the remaining
      // distance, which any dash speed does (speed 30 over a clamped 100 ms
      // frame is a 3-unit step).
      const resolved = dx === 0 && dy === 0
        ? { dx: 0, dy: 0 }
        : this._resolve(pos.x, pos.y, dx, dy);
      pos.x += resolved.dx;
      pos.y += resolved.dy;

      if (resolved.dx !== dx || resolved.dy !== dy) {
        this.stopMoving();
        return;
      }

      pos.z = this._target.z;

      if (this._waypoints.length > 0) {
        this._advanceWaypoint();
      } else {
        this._target = null;
        this._bus?.emit('arrival', { id: this._owner.id, x: pos.x, y: pos.y });
      }
    } else {
      const nx = (dx / dist) * step;
      const ny = (dy / dist) * step;

      const resolved = this._resolve(pos.x, pos.y, nx, ny);
      // Fully blocked: give up. This used to apply only while following a path,
      // so a plain `moveTo()` into a wall kept `_target` armed forever —
      // `isMoving` never went false, `arrival` never fired, and a `move` event
      // was emitted every frame with the position unchanged.
      if (this._collider && resolved.dx === 0 && resolved.dy === 0) {
        this.stopMoving();
        return;
      }

      pos.x += resolved.dx;
      pos.y += resolved.dy;
      pos.z += (dz / dist) * step;

      this._bus?.emit('move', { x: pos.x, y: pos.y, z: pos.z });
    }
  }

  /**
   * Collision-resolve a displacement.
   *
   * `resolveMove` only tests the destination footprint, so a step longer than
   * the footprint can jump straight over a one-tile wall — reachable with a
   * dash speed or a long frame (`speed * 0.1 s`). Those steps are swept
   * instead; short steps keep `resolveMove`'s wall sliding.
   */
  private _resolve(x: number, y: number, dx: number, dy: number): { dx: number; dy: number } {
    if (!this._collider) return { dx, dy };
    if (Math.hypot(dx, dy) > this.radius) {
      return this._collider.sweepMove(x, y, dx, dy, this.radius);
    }
    return this._collider.resolveMove(x, y, dx, dy, this.radius);
  }

  /**
   * Variable-timestep update for compatibility.
   */
  update(ts?: number): void {
    if (ts === undefined) return; 
    const now = ts;
    if (this._fixedStepActive) {
      this._lastTs = now;
      return;
    }
    // `null`, not 0: a timestamp of 0 is legitimate (it is what `Engine` hands
    // out on its first tick), and the old `_lastTs === 0` sentinel stayed armed
    // through it, so the frame right after it was silently dropped.
    const dt = this._lastTs === null
      ? 0
      : Math.min(Math.max(0, (now - this._lastTs) / 1000), 0.1);
    this._lastTs = now;
    if (dt > 0) this._integrate(dt);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _advanceWaypoint(z?: number): void {
    const wp = this._waypoints.shift();
    // No waypoint left means the path is finished (or was empty to begin with):
    // clear the target instead of leaving the previous one armed.
    if (!wp) {
      this._target = null;
      return;
    }
    this._target = { x: wp.x, y: wp.y, z: z ?? (this._owner?.position.z ?? 0) };
  }
}
