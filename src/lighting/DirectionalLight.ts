import {BaseLight} from './BaseLight';

export interface DirectionalLightOptions {
  id?: string;
  /** Angle in degrees (0 = right, 90 = down in screen space) */
  angle?: number;
  /** Elevation in degrees above the ground plane (0–90) */
  elevation?: number;
  color?: string;
  intensity?: number;
}

export class DirectionalLight extends BaseLight {
  readonly type = 'directional' as const;
  /** Angle in radians */
  angle: number;
  /** Elevation in radians */
  elevation: number;

  constructor(opts: DirectionalLightOptions = {}) {
    super(opts.color ?? '#ffffff', opts.intensity ?? 0.4);
    this.id = opts.id;
    this.angle = ((opts.angle ?? 45) * Math.PI) / 180;
    this.elevation = ((opts.elevation ?? 45) * Math.PI) / 180;
  }

  /**
   * Unit vector pointing FROM the light source TOWARD the scene (incident ray).
   * angle=0 → light comes from the right (rays travel left: dx=-1).
   * angle=225° (default) → light comes from lower-left, rays travel upper-right.
   *
   * To get the "toward light" vector for dot-product with face normals,
   * negate this: sourceDir = { dx: -incidentDx, dy: -incidentDy }.
   */
  get incidentDirection(): {dx: number; dy: number} {
    // Rays travel opposite to the angle (angle describes source position, not ray direction)
    return {
      dx: -Math.cos(this.angle),
      dy: -Math.sin(this.angle),
    };
  }

  /** Unit vector pointing FROM the scene TOWARD the light source. */
  get direction(): {dx: number; dy: number} {
    return {
      dx: Math.cos(this.angle),
      dy: Math.sin(this.angle),
    };
  }
}
